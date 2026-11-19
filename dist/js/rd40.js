import {clamp, angleDiff, forward} from './geometry.js';
import {obstruction} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';
import {ARV1_LOCK_ACQUIRE, ARV1_LOCK_HOLD} from './df1.js';

export const RD20 = 'RD20';
export const RD30 = 'RD30';
export const RD = 'RD40';

// RD-Series Smart-Carbine Family (ARV1.1 / ARV1.1 mini / ARV1.2 + D01 SENSOR):
// - RD20: Auto-Aim 1.1 (1.76x bullet-side smart guidance + velocity lead)
// - RD30: Auto-Aim 1.1 mini (compact bullet-side smart guidance; open to both Player & NPCs)
// - RD40: Player-only flagship with Auto-Aim 1.2 (1.92x, 1.4x lock cone, 1.75x expanded hold cone)
//         + D01 SENSOR (4.0s through-wall lock & aim tracking) + live kinetic motion telemetry
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

export const RD30_MINI_STRENGTH = 1.6 * 0.72;                               // 1.152x compact ARV1.1 mini
export const RD20_AA_STRENGTH = 1.6 * 1.1;                                  // 1.76x ARV1.1

export const RD_SPECS = {
  [RD20]: {
    tier: '1.1',
    label: 'ARV1.1',
    strength: RD20_AA_STRENGTH,
    launchGain: 0.28 * RD20_AA_STRENGTH,
    launchStep: 0.013 * RD20_AA_STRENGTH,
    lockAcquire: ARV1_LOCK_ACQUIRE,
    lockHold: ARV1_LOCK_HOLD,
    focusTime: 0.36,
    maxRange: 102,
    homingBudget: 0.016 * RD20_AA_STRENGTH,
    homingRate: 1.05 * RD20_AA_STRENGTH,
    homingCos: 0.962,
    speed: 360 * 0.7,
    trackAim: false,
    d01Duration: 0
  },
  [RD30]: {
    tier: '1.1 mini',
    label: 'ARV1.1 mini',
    strength: RD30_MINI_STRENGTH,
    launchGain: 0.24 * RD30_MINI_STRENGTH,
    launchStep: 0.011 * RD30_MINI_STRENGTH,
    lockAcquire: ARV1_LOCK_ACQUIRE * 0.85,
    lockHold: ARV1_LOCK_HOLD * 0.90,
    focusTime: 0.42,
    maxRange: 92,
    homingBudget: 0.011 * RD30_MINI_STRENGTH,
    homingRate: 0.78 * RD30_MINI_STRENGTH,
    homingCos: 0.974,
    speed: 360 * 1.0,
    trackAim: false,
    d01Duration: 0
  },
  [RD]: {
    tier: '1.2',
    label: 'ARV1.2',
    strength: RD40_ASSIST_STRENGTH,
    launchGain: RD40_LAUNCH_GAIN,
    launchStep: RD40_LAUNCH_STEP,
    lockAcquire: RD40_LOCK_ACQUIRE,
    lockHold: RD40_LOCK_HOLD,
    focusTime: 0.26,
    maxRange: 118,
    homingBudget: RD40_HOMING_BUDGET,
    homingRate: RD40_HOMING_RATE,
    homingCos: RD40_HOMING_COS,
    speed: 360 * 1.4,
    trackAim: true,
    d01Duration: RD40_D01_DURATION
  }
};

export const isRDWeapon = gun => gun in RD_SPECS;

export function initialRD(gun = RD) {
  const spec = RD_SPECS[gun] || RD_SPECS[RD];
  return {
    gun,
    tier: spec.tier,
    label: spec.label,
    focusId: -1,
    focus: 0,
    scanAt: 0,
    locked: false,
    occluded: false,
    d01Active: false,
    d01Timer: 0,
    d01Max: spec.d01Duration,
    d01Cooldowns: {},
    lastAimPoint: null,
    targetDist: 0,
    // Rich kinetic motion telemetry (powers RD40 3D gimbal tracking, lock-snap, D01 sensor stance & HUD FX)
    lockBlend: 0,
    d01Blend: 0,
    lockPulse: 0,
    d01Pulse: 0,
    firePulse: 0,
    barrelPhase: 0,
    trackYaw: 0,
    trackPitch: 0
  };
}
export const initialRD40 = () => initialRD(RD);

function leadPoint(origin, e, speed) {
  const tp = targetPoint(e);
  const vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
  if (vx * vx + vy * vy + vz * vz < 0.04) return tp;
  const dist = Math.hypot(tp[0] - origin[0], tp[1] - origin[1], tp[2] - origin[2]);
  const tof = clamp(dist / Math.max(70, speed), 0, 0.38);
  const lead = [tp[0] + vx * tof * 0.86, tp[1] + vy * tof * 0.35, tp[2] + vz * tof * 0.86];
  return obstruction(origin, lead) > 1 ? lead : tp;
}

function aimAt(a, e, speed, useLead = false) {
  const origin = eyeOf(a),
    raw = targetPoint(e),
    p = useLead ? leadPoint(origin, e, speed) : raw,
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
  d.targetDist = 0;
}

// Per-tick 360Hz RD-Series smart-aim & D01 SENSOR updater + kinetic motion telemetry.
export function updateRD(match, a, dt) {
  const d = a.rd;
  if (!d) return;
  const spec = RD_SPECS[d.gun || a.gun] || RD_SPECS[RD];
  const t = match.time;
  const wasLocked = d.locked;
  const wasD01 = d.d01Active;

  // Decay impulse pulses smoothly
  d.lockPulse = Math.max(0, d.lockPulse - dt * 2.8);
  d.d01Pulse = Math.max(0, d.d01Pulse - dt * 2.1);
  d.firePulse = Math.max(0, d.firePulse - dt * 7.5);

  // 1. Validate & maintain active target across the weapon's lock hold cone (plus D01 SENSOR on RD40)
  if (d.focusId >= 0) {
    const cur = match.actors[d.focusId];
    if (!cur?.alive || cur.team === a.team) {
      clearLock(d);
    } else {
      const s = aimAt(a, cur, spec.speed, false);
      const sep = Math.hypot(angleDiff(s.yaw, a.yaw) * Math.cos(a.pitch), s.pitch - a.pitch);
      const hasLOS = obstruction(s.origin, s.raw) > 1;
      d.targetDist = s.range;
      if (s.range > spec.maxRange || sep >= spec.lockHold) {
        clearLock(d);
      } else if (hasLOS) {
        d.occluded = false;
        d.d01Active = false;
        d.d01Timer = spec.d01Duration;
        if (spec.d01Duration > 0) delete d.d01Cooldowns[cur.id];
        d.focus = Math.min(1, d.focus + dt / spec.focusTime);
        d.locked = d.focus >= 1;
      } else if (spec.d01Duration > 0 && d.d01Timer > 0) {
        // RD40 D01 SENSOR keeps lock & smooth aim tracking alive behind walls/cover!
        d.occluded = true;
        d.d01Active = true;
        d.d01Timer = Math.max(0, d.d01Timer - dt);
        d.focus = Math.min(1, d.focus + dt / spec.focusTime);
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

  // 2. Scan for new target inside the weapon's lock acquisition cone
  if (d.focusId < 0 || (!d.locked && t >= d.scanAt)) {
    if (t >= d.scanAt || d.focusId < 0) {
      d.scanAt = t + 0.04;
      let best = -1, bestCost = Infinity, bestOccluded = false, bestRange = 0;
      for (const e of match.actors) {
        if (!e.alive || e.team === a.team) continue;
        const s = aimAt(a, e, spec.speed, false);
        if (s.range > spec.maxRange) continue;
        const sep = Math.hypot(angleDiff(s.yaw, a.yaw) * Math.cos(a.pitch), s.pitch - a.pitch);
        if (sep >= spec.lockAcquire) continue;
        const hasLOS = obstruction(s.origin, s.raw) > 1;
        if (hasLOS) {
          if (sep < bestCost) {
            best = e.id;
            bestCost = sep;
            bestOccluded = false;
            bestRange = s.range;
          }
        } else if (spec.d01Duration > 0 && s.range <= RD40_D01_PROX_RANGE && (d.d01Cooldowns[e.id] || 0) <= t) {
          const sensorCost = sep + 0.08;
          if (sensorCost < bestCost) {
            best = e.id;
            bestCost = sensorCost;
            bestOccluded = true;
            bestRange = s.range;
          }
        }
      }
      if (best >= 0 && best !== d.focusId) {
        d.focusId = best;
        d.focus = 0;
        d.locked = false;
        d.occluded = bestOccluded;
        d.d01Active = bestOccluded;
        d.d01Timer = spec.d01Duration;
        d.targetDist = bestRange;
      }
    }
  }

  // Emit state-transition pulses & audio cues for human RD40 (lock acquired & D01 SENSOR wall-track engaged)
  if (d.locked && !wasLocked) {
    d.lockPulse = 1;
    if (a.human && spec.trackAim) match.event('rdlock', {actor: a, gun: a.gun, d01: d.d01Active});
  }
  if (d.d01Active && !wasD01) {
    d.d01Pulse = 1;
    if (a.human && spec.trackAim) match.event('d01', {actor: a, gun: a.gun});
  }

  // 3. Smooth Auto-Aim 1.2 + D01 SENSOR magnetic aim tracking & 3D gimbal lead telemetry (RD40)
  let targetTrackYaw = 0, targetTrackPitch = 0;
  if (d.focusId >= 0) {
    const e = match.actors[d.focusId];
    if (e?.alive && e.team !== a.team) {
      const s = aimAt(a, e, spec.speed, !d.occluded);
      const dyaw = angleDiff(s.yaw, a.yaw);
      const dpitch = s.pitch - a.pitch;
      const ang = Math.hypot(dyaw, dpitch);
      d.lastAimPoint = s.raw;
      d.targetDist = s.range;
      // Live gimbal tracking offset for badass 3D weapon aim-tracking animation
      const gimbalGain = d.locked ? 1.0 : d.focus * 0.55;
      targetTrackYaw = clamp(dyaw * 1.85 * gimbalGain, -0.22, 0.22);
      targetTrackPitch = clamp(dpitch * 1.65 * gimbalGain, -0.16, 0.16);

      if (spec.trackAim && d.locked && ang > 1e-4 && ang < spec.lockHold) {
        const rate = d.d01Active ? 4.4 : 4.8;
        const step = Math.min(ang, ang * (1 - Math.exp(-rate * dt)), RD40_TRACK_RATE * dt);
        const frac = step / ang;
        a.yaw += dyaw * frac;
        a.pitch = clamp(a.pitch + dpitch * frac, -1.31, 1.31);
      }
    }
  }

  // Smoothly interpolate weapon pose blends & gimbal vectors
  const kPose = 1 - Math.exp(-13 * dt);
  const kGimbal = 1 - Math.exp(-16 * dt);
  d.lockBlend += ((d.locked ? 1 : d.focus * 0.35) - d.lockBlend) * kPose;
  d.d01Blend += ((d.d01Active ? 1 : 0) - d.d01Blend) * kPose;
  d.trackYaw += (targetTrackYaw - d.trackYaw) * kGimbal;
  d.trackPitch += (targetTrackPitch - d.trackPitch) * kGimbal;
}
export const updateRD40 = updateRD;

// RD-Series bullet-side smart auto-aim launch solver (RD20 ARV1.1, RD30 ARV1.1 mini, RD40 ARV1.2).
export function bulletGuidanceRD(match, a, barrelSide = 0) {
  const d = a.rd;
  const spec = RD_SPECS[d?.gun || a.gun] || RD_SPECS[RD];
  const microFan = barrelSide * (a.gun === RD ? 0.0022 : 0.0042);
  const e = d && d.focusId >= 0 ? match.actors[d.focusId] : null;
  if (!d || !d.locked || !e?.alive || e.team === a.team) {
    return {
      dir: forward(a.yaw + microFan, clamp(a.pitch, -1.31, 1.31)),
      guided: false,
      targetId: -1,
      homingBudget: 0,
      homingRate: 0,
      homingCos: spec.homingCos
    };
  }
  const s = aimAt(a, e, spec.speed, true);
  const yaw = angleDiff(s.yaw, a.yaw);
  const pitch = s.pitch - a.pitch;
  const ang = Math.hypot(yaw, pitch);
  const hasLOS = obstruction(s.origin, s.raw) > 1;
  if (!hasLOS || ang > spec.lockHold) {
    return {
      dir: forward(a.yaw + microFan, clamp(a.pitch, -1.31, 1.31)),
      guided: false,
      targetId: -1,
      homingBudget: 0,
      homingRate: 0,
      homingCos: spec.homingCos
    };
  }
  // Keep NPC smart-guidance authentically human when NPCs equip RD30 / RD20
  const npcScale = a.human ? 1.0 : 0.38;
  const gain = Math.min(spec.launchGain * npcScale, (spec.launchStep * npcScale) / Math.max(0.00001, ang));
  const shotYaw = a.yaw + yaw * gain + microFan * 0.45;
  const shotPitch = clamp(a.pitch + pitch * gain, -1.31, 1.31);
  return {
    dir: forward(shotYaw, shotPitch),
    guided: true,
    targetId: e.id,
    homingBudget: spec.homingBudget * npcScale,
    homingRate: spec.homingRate * npcScale,
    homingCos: spec.homingCos
  };
}
export const bulletGuidanceRD40 = bulletGuidanceRD;
