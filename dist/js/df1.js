import {clamp, angleDiff, forward, unit, sub, add, scale, dot} from './geometry.js';
import {obstruction, clearOpticalPath} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';

export const DF = 'DF1 OUT';
// DF1 OUT ARV1.1 Bullet-Side Smart Auto-Aim:
// Base 1.6x bullet-side guidance further enhanced by Auto-Aim 1.1 (x1.1 => 1.76x total strength)
// + faster focus lock-on + LOS-safe kinematic velocity lead prediction (strictly zero camera mutation!).
export const ARV1_VERSION = '1.1';
export const ARV1_BASE_STRENGTH = 1.6;
export const ARV1_UPGRADE_MULT = 1.1;
export const ARV1_ASSIST_STRENGTH = ARV1_BASE_STRENGTH * ARV1_UPGRADE_MULT; // 1.76x
export const ARV1_LAUNCH_GAIN = 0.28 * ARV1_ASSIST_STRENGTH;                // 0.4928
export const ARV1_LAUNCH_STEP = 0.013 * ARV1_ASSIST_STRENGTH;               // 0.02288 rad
export const ARV1_LOCK_ACQUIRE = 0.032 * Math.sqrt(ARV1_ASSIST_STRENGTH);   // ~0.0424 rad (~2.4 deg)
export const ARV1_LOCK_HOLD = 0.046 * Math.sqrt(ARV1_ASSIST_STRENGTH);      // ~0.0610 rad (~3.5 deg)
export const ARV1_ASSIST_MAX_ANG = 0.11 * Math.sqrt(ARV1_ASSIST_STRENGTH);  // ~0.1459 rad
const DF_BULLET_SPEED = 360 * 0.65;

export function initialDF() {
  return {
    pattern: 'central',
    boost: false,
    p1: 20,
    p1Clock: 0,
    heat: 0,
    cooling: 0,
    lastBoost: -10,
    extraPhase: 0,
    ads: false,
    scope: 'plastic',
    focusId: -1,
    focus: 0,
    scanAt: 0,
    locked: false,
    shotIndex: 0,
    burstPattern: 'central'
  }
}

// ARV1.1 LOS-safe kinematic velocity lead predictor for strafing / dodging targets.
function leadPoint(origin, e, speed = DF_BULLET_SPEED) {
  const tp = targetPoint(e);
  const vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
  if (vx * vx + vy * vy + vz * vz < 0.04) return tp;
  const dist = Math.hypot(tp[0] - origin[0], tp[1] - origin[1], tp[2] - origin[2]);
  const tof = clamp(dist / Math.max(60, speed), 0, 0.42);
  const lead = [tp[0] + vx * tof * 0.85, tp[1] + vy * tof * 0.35, tp[2] + vz * tof * 0.85];
  return obstruction(origin, lead) > 1 ? lead : tp;
}

function aimAt(a, e, useLead = false) {
  const origin = eyeOf(a),
    raw = targetPoint(e),
    p = useLead ? leadPoint(origin, e, DF_BULLET_SPEED) : raw,
    dx = p[0] - origin[0],
    dy = p[1] - origin[1],
    dz = p[2] - origin[2],
    range = Math.hypot(dx, dz);
  return {origin, p, raw, range, yaw: Math.atan2(dx, -dz), pitch: Math.atan2(dy, range)}
}

function canSee(match, a, origin, point) {
  const thermal = a.df?.ads && a.df.scope === 'thermal';
  return clearOpticalPath(origin, point, thermal ? null : match.aeroVortex);
}

export function senseFocus(match, a, dt) {
  const d = a.df, t = match.time;
  if (a.human && match.autoAim === false) {
    d.focusId = -1;
    d.focus = 0;
    d.locked = false;
    return;
  }
  const current = match.actors[d.focusId];
  const usable = (e, cone) => {
    if (!e?.alive || e.team === a.team || (e.shafferTimer || 0) > 0) return Infinity;
    const s = aimAt(a, e);
    const sep = Math.hypot(angleDiff(s.yaw, a.yaw) * Math.cos(a.pitch), s.pitch - a.pitch);
    return s.range <= 104 && sep < cone && canSee(match, a, s.origin, s.raw) ? sep : Infinity;
  };
  if (current && (!current.alive || current.spawnId !== d.focusSpawnId || (current.shafferTimer || 0) > 0)) {
    d.focusId = -1;
    d.focus = 0;
    d.locked = false;
  }
  if (t >= d.scanAt) {
    d.scanAt = t + .048;
    let best = d.focusId, cost = usable(match.actors[best], d.locked ? ARV1_LOCK_HOLD : ARV1_LOCK_ACQUIRE);
    if (!d.locked || !Number.isFinite(cost)) {
      if (!Number.isFinite(cost)) best = -1;
      for (const e of match.actors) {
        const sep = usable(e, ARV1_LOCK_ACQUIRE);
        if (sep < cost) {
          best = e.id;
          cost = sep;
        }
      }
    }
    if (best !== d.focusId) {
      d.focus = 0;
      d.locked = false;
      d.focusId = best;
      d.focusSpawnId = match.actors[best]?.spawnId;
    }
  }
  if (d.focusId >= 0) {
    d.focus = Math.min(1, d.focus + dt / .36);
    d.locked = d.focus >= 1
  } else {
    d.focus = 0;
    d.locked = false;
  }
}

// Validate ARV1.1 lock state on trigger WITHOUT mutating player camera yaw/pitch.
// All auto-aim redirection happens strictly on the fired projectile side (bulletGuidanceDF + steerGuidedShot).
export function assist(match, a) {
  if (a.human && match.autoAim === false) return null;
  const d = a.df, e = match.actors[d.focusId];
  if (!d.locked || !e?.alive || e.team === a.team || e.spawnId !== d.focusSpawnId || (e.shafferTimer || 0) > 0) return null;
  const raw = aimAt(a, e);
  const s = aimAt(a, e, true), yaw = angleDiff(s.yaw, a.yaw), pitch = s.pitch - a.pitch, ang = Math.hypot(yaw, pitch);
  const separation = Math.hypot(angleDiff(raw.yaw, a.yaw) * Math.cos(a.pitch), raw.pitch - a.pitch);
  if (raw.range > 104 || separation >= ARV1_LOCK_HOLD || !canSee(match, a, raw.origin, raw.raw)) {
    d.locked = false;
    d.focus = 0;
    d.focusId = -1;
    return null
  }
  const gain = Math.min(ARV1_LAUNCH_GAIN, ARV1_LAUNCH_STEP / Math.max(.00001, ang));
  return {target: e, targetId: e.id, dyaw: yaw * gain, dpitch: pitch * gain, ang}
}

export function scheduleDF(a) {
  const d = a.df, main = Math.min(3, a.mag), queue = Array(main).fill('main');
  d.shotIndex = 0;
  d.burstPattern = d.pattern;
  if (main === 3 && d.boost && d.cooling <= 0 && d.p1) {
    const extra = Math.min(1 + d.extraPhase, d.p1);
    d.extraPhase = 1 - d.extraPhase;
    for (let i = 0; i < extra; i++)queue.push('p1')
  }
  return queue
}

const SPREAD_FAN = [[0, .003], [-.034, -.011], [.034, -.011], [-.020, .026], [.020, .026]];

export function directionDF(a) {
  const d = a.df, i = d.shotIndex++;
  if (d.burstPattern !== 'spread')return forward(a.yaw, a.pitch);
  const fan = SPREAD_FAN[i % 5];
  return forward(a.yaw + fan[0], a.pitch + fan[1])
}

// Bullet-side ARV1.1 auto-aim launch solver (1.76x strength + velocity lead):
// Deflects the projectile's initial trajectory toward the locked target and arms smooth 360Hz in-flight guidance
// while leaving the player's camera orientation (a.yaw, a.pitch) 100% untouched.
export function bulletGuidanceDF(match, a) {
  const d = a.df, i = d.shotIndex++;
  const isSpread = d.burstPattern === 'spread';
  const fan = isSpread ? SPREAD_FAN[i % 5] : [0, 0];
  const lock = assist(match, a);
  if (!lock) {
    return {
      dir: forward(a.yaw + fan[0], clamp(a.pitch + fan[1], -1.31, 1.31)),
      guided: false,
      targetId: -1,
      homingBudget: 0,
      homingRate: 0
    };
  }
  const shotYaw = a.yaw + lock.dyaw + fan[0];
  const shotPitch = clamp(a.pitch + lock.dpitch + fan[1], -1.31, 1.31);
  // Central pattern gets full 1.76x ARV1.1 smart-bullet homing; spread pattern keeps fan dispersion with lighter guidance
  const spreadScale = isSpread ? (i % 5 === 0 ? 0.84 : 0.52) : 1.0;
  return {
    dir: forward(shotYaw, shotPitch),
    guided: true,
    targetId: lock.targetId,
    homingBudget: 0.016 * ARV1_ASSIST_STRENGTH * spreadScale, // 0.02816 rad max mid-flight curve
    homingRate: 1.05 * ARV1_ASSIST_STRENGTH * spreadScale     // 1.848 rad/s smooth bullet-side tracking
  };
}

// Per-tick 360Hz ARV1.1 / ARV1.2 / ARV1.3 / AA1.4 smart-bullet in-flight homing with kinematic lead prediction.
export function steerGuidedShot(match, s, dt) {
  if (!s.guided || s.homingTargetId < 0 || s.homingBudget <= 1e-5)return;
  const owner = s.owner || match.actors[s.actor];
  if (owner?.human && match.autoAim === false) {
    s.homingBudget = 0;
    return;
  }
  const e = match.actors[s.homingTargetId];
  if (!e?.alive || e.team === s.team || (e.shafferTimer || 0) > 0 || (s.homingSpawnId !== undefined && e.spawnId !== s.homingSpawnId)) {
    s.homingBudget = 0;
    return
  }
  const rawTp = targetPoint(e);
  if (!clearOpticalPath(s.p, rawTp, s.thermalGuidance ? null : match.aeroVortex)) return;
  let tp;
  if (s.arvOrder === 2) {
    const spd = Math.max(70, s.speed || DF_BULLET_SPEED);
    const vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
    const acc = s.homingAccel;
    const ax = acc ? acc[0] : 0, ay = acc ? acc[1] : 0, az = acc ? acc[2] : 0;
    const vw = s.homingVelWeight ?? 0.94, aw = s.homingAccelWeight ?? 0.45;
    const d0 = Math.hypot(rawTp[0] - s.p[0], rawTp[1] - s.p[1], rawTp[2] - s.p[2]);
    let tof = clamp(d0 / spd, 0, 0.55);
    let px = rawTp[0], py = rawTp[1], pz = rawTp[2];
    for (let iter = 0; iter < 2; iter++) {
      const t2 = 0.5 * tof * tof;
      px = rawTp[0] + vx * tof * vw + ax * t2 * aw;
      py = rawTp[1] + vy * tof * Math.min(0.55, vw * 0.48) + ay * t2 * Math.min(0.3, aw * 0.4);
      pz = rawTp[2] + vz * tof * vw + az * t2 * aw;
      tof = clamp(Math.hypot(px - s.p[0], py - s.p[1], pz - s.p[2]) / spd, 0, 0.55);
    }
    const cand = [px, py, pz];
    tp = obstruction(s.p, cand) > 1 ? cand : leadPoint(s.p, e, spd);
  } else {
    tp = leadPoint(s.p, e, s.speed || DF_BULLET_SPEED);
  }
  const toT = sub(tp, s.p);
  const dist = Math.hypot(toT[0], toT[1], toT[2]);
  if (dist < .22)return;
  const desired = [toT[0] / dist, toT[1] / dist, toT[2] / dist];
  const cosA = clamp(dot(s.dir, desired), -1, 1);
  // Enforce forward lock cone (ARV1.1 ~15.8°, RD40 ARV1.2 ~22.3°, DF40 II ARV1.3 ~27.7°, AA1.4 ~38.7°)
  if (cosA < (s.homingCos || 0.962))return;
  const ang = Math.acos(cosA);
  if (ang < 1e-5)return;
  const step = Math.min(ang, s.homingRate * dt, s.homingBudget);
  // Exact geodesic rotation of s.dir toward desired by step radians
  const perp = sub(desired, scale(s.dir, cosA));
  const plen = Math.hypot(perp[0], perp[1], perp[2]);
  if (plen < 1e-7)return;
  const pUnit = [perp[0] / plen, perp[1] / plen, perp[2] / plen];
  s.dir = unit(add(scale(s.dir, Math.cos(step)), scale(pUnit, Math.sin(step))));
  s.homingBudget = Math.max(0, s.homingBudget - step);
  s.homingTurned = (s.homingTurned || 0) + step;
}

export function spendP1(a, t) {
  const d = a.df;
  if (d.p1 <= 0 || d.cooling > 0 || !d.boost)return false;
  d.p1--;
  d.lastBoost = t;
  d.heat = Math.min(100, d.heat + 21);
  if (d.heat >= 100) {
    d.cooling = 5;
    d.boost = false
  }
  return true
}

export function updateDF(match, a, dt) {
  const d = a.df;
  if (d.p1 < 20) {
    d.p1Clock += dt * (a.ammoRate || 1);
    if (d.p1Clock + 1e-8 >= 8) {
      d.p1++;
      d.p1Clock = Math.max(0, d.p1Clock - 8)
    }
  } else d.p1Clock = 0;
  if (d.cooling > 0) {
    d.cooling = Math.max(0, d.cooling - dt);
    d.heat = d.cooling * 20
  } else if (match.time - d.lastBoost > 1.15)d.heat = Math.max(0, d.heat - 11 * dt);
  senseFocus(match, a, dt)
}
