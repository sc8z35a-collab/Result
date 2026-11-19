import {clamp, angleDiff, forward, unit, sub} from './geometry.js';
import {obstruction} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';
import {ARV1_LOCK_ACQUIRE, ARV1_LOCK_HOLD} from './df1.js';

export const RD = 'RD40';
// RD40 Twin-Linked Full-Auto Carbine — Auto-Aim 1.2 + D01 SENSOR Through-Wall Tracker:
// - Auto-Aim 1.2: 1.6x base * 1.2 = 1.92x guidance strength + velocity lead prediction
// - Lock acquisition cone expanded 1.4x vs ARV1.1
// - Lock persistence/tracking cone dramatically widened (1.75x ARV1.1 hold cone) so lock sticks reliably
// - D01 SENSOR: sustains lock & smooth magnetic aim tracking through walls/cover for up to 4.0s
export const RD40_AA_VERSION = '1.2';
export const RD40_BASE_STRENGTH = 1.6;
export const RD40_UPGRADE_MULT = 1.2;
export const RD40_ASSIST_STRENGTH = RD40_BASE_STRENGTH * RD40_UPGRADE_MULT; // 1.92x
export const RD40_LAUNCH_GAIN = 0.28 * RD40_ASSIST_STRENGTH;                // 0.5376
export const RD40_LAUNCH_STEP = 0.013 * RD40_ASSIST_STRENGTH;               // 0.02496 rad
export const RD40_LOCK_SCALE = 1.4;
export const RD40_HOLD_SCALE = 1.75;
export const RD40_LOCK_ACQUIRE = ARV1_LOCK_ACQUIRE * RD40_LOCK_SCALE;       // ~0.14485 rad (1.4x ARV1.1)
export const RD40_LOCK_HOLD = ARV1_LOCK_HOLD * RD40_HOLD_SCALE;             // ~0.25305 rad (expanded hold cone)
export const RD40_ASSIST_MAX_ANG = RD40_LOCK_HOLD;
export const RD40_D01_DURATION = 4.0;                                       // seconds of behind-wall tracking
export const RD40_D01_PROX_RANGE = 32;                                      // close-range through-wall ping reach
export const RD40_D01_COOLDOWN = 2.5;                                       // re-acquire cooldown after expiry behind cover
export const RD40_HOMING_COS = 0.925;                                       // ~22.3° wide 360Hz in-flight tracking cone
export const RD40_HOMING_BUDGET = 0.022 * RD40_ASSIST_STRENGTH;             // 0.04224 rad max curve
export const RD40_HOMING_RATE = 1.25 * RD40_ASSIST_STRENGTH;                // 2.40 rad/s smooth curve
export const RD40_TRACK_RATE = 2.8;                                         // rad/s silky magnetic aim tracking cap
const RD_BULLET_SPEED = 360 * 1.4;                                          // 504 m/s (velocity ratio 140)

export function initialRD40() {
  return {
    focusId: -1,
    focus: 0,
    scanAt: 0,
    locked: false,
    occluded: false,
    d01Active: false,
    d01Timer: 0,
    d01Max: RD40_D01_DURATION,
    d01Cooldowns: {},
    lastAimPoint: null
  };
}

function leadPoint(origin, e, speed = RD_BULLET_SPEED) {
  const tp = targetPoint(e);
  const vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
  if (vx * vx + vy * vy + vz * vz < 0.04) return tp;
  const dist = Math.hypot(tp[0] - origin[0], tp[1] - origin[1], tp[2] - origin[2]);
  const tof = clamp(dist / Math.max(80, speed), 0, 0.36);
  const lead = [tp[0] + vx * tof * 0.88, tp[1] + vy * tof * 0.35, tp[2] + vz * tof * 0.88];
  return obstruction(origin, lead) > 1 ? lead : tp;
}

function aimAt(a, e, useLead = false) {
  const origin = eyeOf(a),
    raw = targetPoint(e),
    p = useLead ? leadPoint(origin, e, RD_BULLET_SPEED) : raw,
    dx = p[0] - origin[0],
    dy = p[1] - origin[1],
    dz = p[2] - origin[2],
    range = Math.hypot(dx, dz);
  return {origin, p, raw, range, yaw: Math.atan2(dx, -dz), pitch: Math.atan2(dy, range)};
}

function clearLock(d) {
  d.focusId = -1;
  d.focus = 0;
  d.locked = false;
  d.occluded = false;
  d.d01Active = false;
  d.d01Timer = 0;
  d.lastAimPoint = null;
}

// Per-tick 360Hz RD40 Auto-Aim 1.2 + D01 SENSOR lock acquisition, expanded tracking hold,
// finite through-wall persistence, and smooth magnetic aim tracking.
export function updateRD40(match, a, dt) {
  const d = a.rd;
  if (!d) return;
  const t = match.time;

  // 1. Validate & maintain active target across the expanded RD40_LOCK_HOLD cone (including behind walls via D01 SENSOR)
  if (d.focusId >= 0) {
    const cur = match.actors[d.focusId];
    if (!cur?.alive || cur.team === a.team) {
      clearLock(d);
    } else {
      const s = aimAt(a, cur, false);
      const sep = Math.hypot(angleDiff(s.yaw, a.yaw) * Math.cos(a.pitch), s.pitch - a.pitch);
      const hasLOS = obstruction(s.origin, s.raw) > 1;
      if (s.range > 118 || sep >= RD40_LOCK_HOLD) {
        clearLock(d);
      } else if (hasLOS) {
        d.occluded = false;
        d.d01Active = false;
        d.d01Timer = RD40_D01_DURATION;
        delete d.d01Cooldowns[cur.id];
        d.focus = Math.min(1, d.focus + dt / 0.26);
        d.locked = d.focus >= 1;
      } else if (d.d01Timer > 0) {
        // D01 SENSOR keeps lock & aim tracking alive while target moves behind a wall/container!
        d.occluded = true;
        d.d01Active = true;
        d.d01Timer = Math.max(0, d.d01Timer - dt);
        d.focus = Math.min(1, d.focus + dt / 0.26);
        d.locked = d.focus >= 1;
        if (d.d01Timer <= 1e-6) {
          d.d01Cooldowns[cur.id] = t + RD40_D01_COOLDOWN;
          clearLock(d);
        }
      } else {
        clearLock(d);
      }
    }
  }

  // 2. Scan for new target inside 1.4x expanded RD40_LOCK_ACQUIRE cone (direct LOS prioritized, then close-range D01 SENSOR)
  if (d.focusId < 0 || (!d.locked && t >= d.scanAt)) {
    if (t >= d.scanAt || d.focusId < 0) {
      d.scanAt = t + 0.04;
      let best = -1, bestCost = Infinity, bestOccluded = false;
      for (const e of match.actors) {
        if (!e.alive || e.team === a.team) continue;
        const s = aimAt(a, e, false);
        if (s.range > 115) continue;
        const sep = Math.hypot(angleDiff(s.yaw, a.yaw) * Math.cos(a.pitch), s.pitch - a.pitch);
        if (sep >= RD40_LOCK_ACQUIRE) continue;
        const hasLOS = obstruction(s.origin, s.raw) > 1;
        if (hasLOS) {
          if (sep < bestCost) {
            best = e.id;
            bestCost = sep;
            bestOccluded = false;
          }
        } else if (s.range <= RD40_D01_PROX_RANGE && (d.d01Cooldowns[e.id] || 0) <= t) {
          // Close-range D01 SENSOR detection through cover (slightly higher cost so visible enemies always win priority)
          const sensorCost = sep + 0.08;
          if (sensorCost < bestCost) {
            best = e.id;
            bestCost = sensorCost;
            bestOccluded = true;
          }
        }
      }
      if (best >= 0 && best !== d.focusId) {
        d.focusId = best;
        d.focus = 0;
        d.locked = false;
        d.occluded = bestOccluded;
        d.d01Active = bestOccluded;
        d.d01Timer = RD40_D01_DURATION;
      }
    }
  }

  // 3. Smooth Auto-Aim 1.2 + D01 SENSOR continuous magnetic aim tracking (follows enemies seamlessly even behind walls!)
  if (d.locked && d.focusId >= 0) {
    const e = match.actors[d.focusId];
    if (e?.alive && e.team !== a.team) {
      const s = aimAt(a, e, !d.occluded);
      const dyaw = angleDiff(s.yaw, a.yaw);
      const dpitch = s.pitch - a.pitch;
      const ang = Math.hypot(dyaw, dpitch);
      d.lastAimPoint = s.raw;
      if (ang > 1e-4 && ang < RD40_LOCK_HOLD) {
        const rate = d.d01Active ? 4.4 : 4.8;
        const step = Math.min(ang, ang * (1 - Math.exp(-rate * dt)), RD40_TRACK_RATE * dt);
        const frac = step / ang;
        a.yaw += dyaw * frac;
        a.pitch = clamp(a.pitch + dpitch * frac, -1.31, 1.31);
      }
    }
  }
}

// Auto-Aim 1.2 twin-barrel launch solver (1.92x strength + velocity lead + widened 360Hz homing envelope).
export function bulletGuidanceRD40(match, a, barrelSide = 0) {
  const d = a.rd;
  const microFan = barrelSide * 0.0022;
  const e = d && d.focusId >= 0 ? match.actors[d.focusId] : null;
  if (!d || !d.locked || !e?.alive || e.team === a.team) {
    return {
      dir: forward(a.yaw + microFan, clamp(a.pitch, -1.31, 1.31)),
      guided: false,
      targetId: -1,
      homingBudget: 0,
      homingRate: 0,
      homingCos: RD40_HOMING_COS
    };
  }
  const s = aimAt(a, e, true);
  const yaw = angleDiff(s.yaw, a.yaw);
  const pitch = s.pitch - a.pitch;
  const ang = Math.hypot(yaw, pitch);
  const hasLOS = obstruction(s.origin, s.raw) > 1;
  // When target is behind cover (D01 SENSOR active), preserve lock & aim tracking, while bullets stay physically fair (no shooting through walls).
  if (!hasLOS || ang > RD40_ASSIST_MAX_ANG) {
    return {
      dir: forward(a.yaw + microFan, clamp(a.pitch, -1.31, 1.31)),
      guided: false,
      targetId: -1,
      homingBudget: 0,
      homingRate: 0,
      homingCos: RD40_HOMING_COS
    };
  }
  const gain = Math.min(RD40_LAUNCH_GAIN, RD40_LAUNCH_STEP / Math.max(0.00001, ang));
  const shotYaw = a.yaw + yaw * gain + microFan * 0.45;
  const shotPitch = clamp(a.pitch + pitch * gain, -1.31, 1.31);
  return {
    dir: forward(shotYaw, shotPitch),
    guided: true,
    targetId: e.id,
    homingBudget: RD40_HOMING_BUDGET,
    homingRate: RD40_HOMING_RATE,
    homingCos: RD40_HOMING_COS
  };
}
