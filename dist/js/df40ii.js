import {clamp, angleDiff, forward} from './geometry.js';
import {obstruction, clearOpticalPath} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';
import {ARV1_LOCK_ACQUIRE, ARV1_LOCK_HOLD} from './df1.js';

export const DF40II = 'DF40 II';
export const ARV13_VERSION = '1.3';
export const AA13_VERSION = '1.3';
export const AA14_VERSION = '1.4';
export const DF40II_BULLET_SPEED = 360 * 0.8; // 288 m/s (velocity ratio 80)

// DF40 II — Player-Only Tri-Barrel Full-Auto Smart Carbine
//   Base System: ARV1.3 + Auto-Aim 1.3 (evolved from RD40's Auto-Aim 1.2 / ARV1.2)
//     - 2.08x smart guidance strength (vs 1.92x on AA1.2), 1.65x lock acquire cone, 2.05x lock hold cone
//     - Faster 0.18s focus lock + zero-deadtime target-handoff pre-charge (0.45)
//     - 2nd-order iterative velocity + acceleration ballistic lead compensation
//     - Tri-barrel convergent launch guidance + 360Hz geodesic in-flight homing
//     - ARV1.3 Sensor Continuity (4.5s behind-cover lock & smooth magnetic tracking)
//   Overdrive System: Auto-Aim 1.4 (temporary super-tier with thermal overheat & forced purge cooldown)
//     - 2.80x hyper-guidance, 2.25x lock acquire cone, 2.75x lock hold cone, 0.06s snap-lock
//     - Pinpoint zero-fan tri-barrel convergence + 38.7° wide high-G 360Hz homing + 6.8 rad/s tracking
//     - Continuous + lock + firing thermal buildup; reaching 100% triggers OVERHEAT (6.0s cooldown purge)

export const DF40II_BASE_STRENGTH = 1.6;

// Auto-Aim 1.3 / ARV1.3 constants
export const AA13_UPGRADE_MULT = 1.3;
export const AA13_ASSIST_STRENGTH = DF40II_BASE_STRENGTH * AA13_UPGRADE_MULT; // 2.08x
export const AA13_LAUNCH_GAIN = Math.min(0.92, 0.34 * AA13_ASSIST_STRENGTH);  // 0.7072
export const AA13_LAUNCH_STEP = 0.018 * AA13_ASSIST_STRENGTH;                 // 0.03744 rad
export const AA13_LOCK_SCALE = 1.65;
export const AA13_HOLD_SCALE = 2.05;
export const AA13_LOCK_ACQUIRE = ARV1_LOCK_ACQUIRE * AA13_LOCK_SCALE;         // ~0.1707 rad
export const AA13_LOCK_HOLD = ARV1_LOCK_HOLD * AA13_HOLD_SCALE;               // ~0.2964 rad
export const AA13_FOCUS_TIME = 0.18;
export const AA13_MAX_RANGE = 132;
export const AA13_HOMING_COS = 0.885;                                         // ~27.7° wide pursuit cone
export const AA13_HOMING_BUDGET = 0.032 * AA13_ASSIST_STRENGTH;               // 0.06656 rad max curve
export const AA13_HOMING_RATE = 1.65 * AA13_ASSIST_STRENGTH;                  // 3.432 rad/s
export const AA13_TRACK_RATE = 3.8;                                           // rad/s magnetic tracking cap
export const AA13_TRACK_GAIN = 6.4;
export const AA13_WALL_DURATION = 4.5;
export const AA13_WALL_PROX_RANGE = 36;
export const AA13_WALL_COOLDOWN = 2.5;
export const AA13_CHAIN_PRECHARGE = 0.45;

// Auto-Aim 1.4 Overdrive constants
export const AA14_UPGRADE_MULT = 1.75;
export const AA14_ASSIST_STRENGTH = DF40II_BASE_STRENGTH * AA14_UPGRADE_MULT; // 2.80x
export const AA14_LAUNCH_GAIN = 0.96;
export const AA14_LAUNCH_STEP = 0.085;                                        // ~4.87° instant launch deflection
export const AA14_LOCK_SCALE = 2.25;
export const AA14_HOLD_SCALE = 2.75;
export const AA14_LOCK_ACQUIRE = ARV1_LOCK_ACQUIRE * AA14_LOCK_SCALE;         // ~0.2328 rad
export const AA14_LOCK_HOLD = ARV1_LOCK_HOLD * AA14_HOLD_SCALE;               // ~0.3976 rad
export const AA14_FOCUS_TIME = 0.06;                                          // 3x faster snap lock
export const AA14_MAX_RANGE = 150;
export const AA14_HOMING_COS = 0.78;                                          // ~38.7° hyper-wide pursuit cone
export const AA14_HOMING_BUDGET = 0.16;                                       // ~9.2° high-G curve budget
export const AA14_HOMING_RATE = 7.2;                                          // rad/s agile homing turn rate
export const AA14_TRACK_RATE = 6.8;                                           // rad/s hyper-magnetic tracking cap
export const AA14_TRACK_GAIN = 12.5;
export const AA14_WALL_DURATION = 5.5;
export const AA14_WALL_PROX_RANGE = 44;
export const AA14_CHAIN_PRECHARGE = 0.85;

// Auto-Aim 1.4 Thermal / Overheat Physics
export const AA14_HEAT_PASSIVE_RATE = 14.0;   // heat/s baseline while active
export const AA14_HEAT_LOCK_RATE = 4.0;       // extra heat/s while actively locked & tracking
export const AA14_HEAT_PER_SALVO = 1.6;       // extra heat per 3-round salvo while AA1.4 active
export const AA14_COOL_RATE = 22.0;           // heat/s normal dissipation when turned off early
export const AA14_COOL_DELAY = 0.45;          // seconds after deactivation before cooling starts
export const AA14_OVERHEAT_COOLDOWN = 6.0;    // forced thermal purge lockout duration (seconds)
export const AA14_REARM_MAX_HEAT = 90.0;      // max residual heat allowed to re-engage AA1.4

export const DF40II_TIERS = {
  [AA13_VERSION]: {
    tier: AA13_VERSION,
    arv: ARV13_VERSION,
    label: 'ARV1.3 · AA1.3',
    strength: AA13_ASSIST_STRENGTH,
    launchGain: AA13_LAUNCH_GAIN,
    launchStep: AA13_LAUNCH_STEP,
    lockAcquire: AA13_LOCK_ACQUIRE,
    lockHold: AA13_LOCK_HOLD,
    focusTime: AA13_FOCUS_TIME,
    maxRange: AA13_MAX_RANGE,
    homingBudget: AA13_HOMING_BUDGET,
    homingRate: AA13_HOMING_RATE,
    homingCos: AA13_HOMING_COS,
    speed: DF40II_BULLET_SPEED,
    trackRate: AA13_TRACK_RATE,
    trackGain: AA13_TRACK_GAIN,
    wallDuration: AA13_WALL_DURATION,
    wallProxRange: AA13_WALL_PROX_RANGE,
    velWeight: 0.94,
    accelWeight: 0.45,
    fanScale: 0.46,
    chainPrecharge: AA13_CHAIN_PRECHARGE
  },
  [AA14_VERSION]: {
    tier: AA14_VERSION,
    arv: ARV13_VERSION,
    label: 'ARV1.3 · AA1.4',
    strength: AA14_ASSIST_STRENGTH,
    launchGain: AA14_LAUNCH_GAIN,
    launchStep: AA14_LAUNCH_STEP,
    lockAcquire: AA14_LOCK_ACQUIRE,
    lockHold: AA14_LOCK_HOLD,
    focusTime: AA14_FOCUS_TIME,
    maxRange: AA14_MAX_RANGE,
    homingBudget: AA14_HOMING_BUDGET,
    homingRate: AA14_HOMING_RATE,
    homingCos: AA14_HOMING_COS,
    speed: DF40II_BULLET_SPEED,
    trackRate: AA14_TRACK_RATE,
    trackGain: AA14_TRACK_GAIN,
    wallDuration: AA14_WALL_DURATION,
    wallProxRange: AA14_WALL_PROX_RANGE,
    velWeight: 1.0,
    accelWeight: 0.60,
    fanScale: 0.18,
    chainPrecharge: AA14_CHAIN_PRECHARGE
  }
};

export function activeDF40Spec(d) {
  return d?.aa14Active && !d?.aa14Overheated ? DF40II_TIERS[AA14_VERSION] : DF40II_TIERS[AA13_VERSION];
}

export function initialDF40II() {
  return {
    gun: DF40II,
    arvVersion: ARV13_VERSION,
    aaVersion: AA13_VERSION,
    focusId: -1,
    focusSpawnId: 0,
    focus: 0,
    scanAt: 0,
    locked: false,
    occluded: false,
    d01Active: false,
    d01Timer: 0,
    d01Max: AA13_WALL_DURATION,
    d01Cooldowns: {},
    lastAimPoint: null,
    targetDist: 0,
    // ARV1.3 2nd-order target kinematic estimator (velocity + smoothed acceleration)
    prevTargetId: -1,
    prevTargetSpawnId: 0,
    prevTargetVel: [0, 0, 0],
    targetAccel: [0, 0, 0],
    // Auto-Aim 1.4 temporary overdrive + overheat thermal core
    aa14Active: false,
    aa14Heat: 0,
    aa14Overheated: false,
    aa14Cooldown: 0,
    aa14LastOffAt: -10,
    aa14Pulse: 0,
    aa14ReadyPulse: 0,
    aa14Blend: 0,
    // Kinetic 3D first-person choreography telemetry
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

// ARV1.3 iterative 2nd-order ballistic lead solver (velocity + smoothed target acceleration) with LOS safety.
export function leadPointARV13(origin, e, speed = DF40II_BULLET_SPEED, accel = null, velWeight = 0.94, accelWeight = 0.45) {
  const tp = targetPoint(e);
  const vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
  const ax = accel ? accel[0] : 0;
  const ay = accel ? accel[1] : 0;
  const az = accel ? accel[2] : 0;
  const v2 = vx * vx + vy * vy + vz * vz;
  const a2 = ax * ax + ay * ay + az * az;
  if (v2 < 0.02 && a2 < 0.25) return tp;

  const spd = Math.max(70, speed);
  const dist0 = Math.hypot(tp[0] - origin[0], tp[1] - origin[1], tp[2] - origin[2]);
  let tof = clamp(dist0 / spd, 0, 0.55);

  // Two-pass fixed-point TOF refinement for slower/medium projectile speed (80 = 288 m/s)
  let px = tp[0], py = tp[1], pz = tp[2];
  for (let iter = 0; iter < 2; iter++) {
    const t2 = 0.5 * tof * tof;
    px = tp[0] + vx * tof * velWeight + ax * t2 * accelWeight;
    py = tp[1] + vy * tof * Math.min(0.55, velWeight * 0.48) + ay * t2 * Math.min(0.3, accelWeight * 0.4);
    pz = tp[2] + vz * tof * velWeight + az * t2 * accelWeight;
    const dist1 = Math.hypot(px - origin[0], py - origin[1], pz - origin[2]);
    tof = clamp(dist1 / spd, 0, 0.55);
  }
  const lead2 = [px, py, pz];
  if (obstruction(origin, lead2) > 1) return lead2;

  // Fallback to safe 1st-order linear lead if 2nd-order point clips behind corner geometry
  const lead1 = [tp[0] + vx * tof * 0.72, tp[1] + vy * tof * 0.3, tp[2] + vz * tof * 0.72];
  return obstruction(origin, lead1) > 1 ? lead1 : tp;
}

function aimAt(a, e, spec, accel = null, useLead = false) {
  const origin = eyeOf(a),
    raw = targetPoint(e),
    p = useLead ? leadPointARV13(origin, e, spec.speed, accel, spec.velWeight, spec.accelWeight) : raw,
    dx = p[0] - origin[0],
    dy = p[1] - origin[1],
    dz = p[2] - origin[2],
    range = Math.hypot(dx, dz);
  return {origin, p, raw, range, yaw: Math.atan2(dx, -dz), pitch: Math.atan2(dy, range)};
}

function endWallTrack(d, t) {
  if (d.d01Active && d.focusId >= 0) d.d01Cooldowns[d.focusId] = t + AA13_WALL_COOLDOWN;
}

function resetAccel(d) {
  d.prevTargetId = -1;
  d.prevTargetSpawnId = 0;
  d.prevTargetVel[0] = d.prevTargetVel[1] = d.prevTargetVel[2] = 0;
  d.targetAccel[0] = d.targetAccel[1] = d.targetAccel[2] = 0;
}

function clearLock(d, t) {
  endWallTrack(d, t);
  d.focusId = -1;
  d.focusSpawnId = 0;
  d.focus = 0;
  d.locked = false;
  d.occluded = false;
  d.d01Active = false;
  d.d01Timer = 0;
  d.lastAimPoint = null;
  d.targetDist = 0;
  resetAccel(d);
}

function updateTargetAccel(d, e, dt) {
  const vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
  if (d.prevTargetId !== e.id || d.prevTargetSpawnId !== e.spawnId || dt <= 1e-6) {
    d.prevTargetId = e.id;
    d.prevTargetSpawnId = e.spawnId;
    d.prevTargetVel[0] = vx;
    d.prevTargetVel[1] = vy;
    d.prevTargetVel[2] = vz;
    d.targetAccel[0] = d.targetAccel[1] = d.targetAccel[2] = 0;
    return;
  }
  const rawAx = clamp((vx - d.prevTargetVel[0]) / dt, -24, 24);
  const rawAy = clamp((vy - d.prevTargetVel[1]) / dt, -24, 24);
  const rawAz = clamp((vz - d.prevTargetVel[2]) / dt, -24, 24);
  const k = 1 - Math.exp(-10 * dt);
  d.targetAccel[0] += (rawAx - d.targetAccel[0]) * k;
  d.targetAccel[1] += (rawAy - d.targetAccel[1]) * k;
  d.targetAccel[2] += (rawAz - d.targetAccel[2]) * k;
  d.prevTargetVel[0] = vx;
  d.prevTargetVel[1] = vy;
  d.prevTargetVel[2] = vz;
}

export function triggerAA14Overheat(match, a) {
  const d = a?.df40;
  if (!d || d.aa14Overheated) return false;
  d.aa14Active = false;
  d.aa14Overheated = true;
  d.aa14Heat = 100;
  d.aa14Cooldown = AA14_OVERHEAT_COOLDOWN;
  d.aa14LastOffAt = match.time;
  d.aaVersion = AA13_VERSION;
  d.d01Max = AA13_WALL_DURATION;
  if (d.d01Timer > d.d01Max) d.d01Timer = d.d01Max;
  d.aa14Pulse = 1;
  if (a.human) {
    match.event('aa14', {actor: a, gun: a.gun, state: 'overheat', cooldown: d.aa14Cooldown});
  }
  return true;
}

export function toggleAA14(match, a) {
  const d = a?.df40;
  if (!d || !a.alive || match.ended) return {ok: false, reason: 'unavailable'};
  if (d.aa14Active) {
    d.aa14Active = false;
    d.aa14LastOffAt = match.time;
    d.aaVersion = AA13_VERSION;
    d.d01Max = AA13_WALL_DURATION;
    if (d.d01Timer > d.d01Max) d.d01Timer = d.d01Max;
    d.aa14Pulse = 0.65;
    if (a.human) match.event('aa14', {actor: a, gun: a.gun, state: 'off', heat: d.aa14Heat});
    return {ok: true, active: false, state: 'off', heat: d.aa14Heat};
  }
  if (a.human && match.autoAim === false) {
    if (a.human) match.event('aa14', {actor: a, gun: a.gun, state: 'blocked', reason: 'autoaim_off'});
    return {ok: false, reason: 'autoaim_off'};
  }
  if (d.aa14Overheated || d.aa14Cooldown > 1e-6) {
    if (a.human) match.event('aa14', {actor: a, gun: a.gun, state: 'blocked', cooldown: d.aa14Cooldown});
    return {ok: false, reason: 'overheated', cooldown: d.aa14Cooldown};
  }
  if (d.aa14Heat >= AA14_REARM_MAX_HEAT) {
    if (a.human) match.event('aa14', {actor: a, gun: a.gun, state: 'blocked', heat: d.aa14Heat});
    return {ok: false, reason: 'hot', heat: d.aa14Heat};
  }
  d.aa14Active = true;
  d.aaVersion = AA14_VERSION;
  d.aa14Pulse = 1;
  if (a.human) match.event('aa14', {actor: a, gun: a.gun, state: 'on', heat: d.aa14Heat});
  return {ok: true, active: true, state: 'on', heat: d.aa14Heat};
}

export function onFireDF40II(match, a, salvo = 4) {
  const d = a?.df40;
  if (!d) return;
  d.firePulse = 1;
  d.barrelPhase = ((d.barrelPhase || 0) + 1) % 4;
  if (d.aa14Active && !d.aa14Overheated) {
    d.aa14Heat = Math.min(100, d.aa14Heat + AA14_HEAT_PER_SALVO * (salvo / 4));
    if (d.aa14Heat >= 100 - 1e-6) {
      triggerAA14Overheat(match, a);
    }
  }
}

// Per-tick 360Hz ARV1.3 + Auto-Aim 1.3 / Auto-Aim 1.4 Overdrive & Thermal Overheat updater.
export function updateDF40II(match, a, dt) {
  const d = a.df40;
  if (!d) return;
  const t = match.time;
  const autoAimOff = !!(a.human && match.autoAim === false);
  if (autoAimOff && d.aa14Active) {
    d.aa14Active = false;
    d.aa14LastOffAt = t;
    d.aaVersion = AA13_VERSION;
  }

  // 1. Update Auto-Aim 1.4 thermal state & overheat purge lockout
  if (d.aa14Overheated) {
    d.aa14Active = false;
    d.aa14Cooldown = Math.max(0, d.aa14Cooldown - dt);
    d.aa14Heat = (d.aa14Cooldown / AA14_OVERHEAT_COOLDOWN) * 100;
    if (d.aa14Cooldown <= 1e-7) {
      d.aa14Cooldown = 0;
      d.aa14Overheated = false;
      d.aa14Heat = 0;
      d.aa14ReadyPulse = 1;
      if (a.human) match.event('aa14', {actor: a, gun: a.gun, state: 'ready'});
    }
  } else if (d.aa14Active) {
    const heatRate = AA14_HEAT_PASSIVE_RATE + (d.locked ? AA14_HEAT_LOCK_RATE : 0);
    d.aa14Heat = Math.min(100, d.aa14Heat + heatRate * dt);
    if (d.aa14Heat >= 100 - 1e-6) {
      triggerAA14Overheat(match, a);
    }
  } else if (d.aa14Heat > 0 && t - d.aa14LastOffAt >= AA14_COOL_DELAY) {
    d.aa14Heat = Math.max(0, d.aa14Heat - AA14_COOL_RATE * dt);
  }

  const spec = activeDF40Spec(d);
  d.aaVersion = spec.tier;
  d.d01Max = spec.wallDuration;
  if (d.d01Timer > d.d01Max) d.d01Timer = d.d01Max;
  const wasLocked = d.locked;
  const wasD01 = d.d01Active;
  let chainPrecharge = 0;

  // Decay impulse pulses
  d.lockPulse = Math.max(0, d.lockPulse - dt * 3.0);
  d.d01Pulse = Math.max(0, d.d01Pulse - dt * 2.2);
  d.firePulse = Math.max(0, d.firePulse - dt * 8.0);
  d.aa14Pulse = Math.max(0, d.aa14Pulse - dt * 2.4);
  d.aa14ReadyPulse = Math.max(0, d.aa14ReadyPulse - dt * 1.8);

  if (autoAimOff) {
    if (d.focusId >= 0 || d.locked || d.d01Active) clearLock(d, t);
    const kPose = 1 - Math.exp(-15 * dt);
    const kGimbal = 1 - Math.exp(-18 * dt);
    d.lockBlend += (0 - d.lockBlend) * kPose;
    d.d01Blend += (0 - d.d01Blend) * kPose;
    d.aa14Blend += (0 - d.aa14Blend) * kPose;
    d.trackYaw += (0 - d.trackYaw) * kGimbal;
    d.trackPitch += (0 - d.trackPitch) * kGimbal;
    return;
  }

  // 2. Validate & maintain active ARV1.3 target lock (plus zero-deadtime handoff on elimination)
  if (d.focusId >= 0) {
    const cur = match.actors[d.focusId];
    if (!cur?.alive || cur.team === a.team || cur.spawnId !== d.focusSpawnId || (cur.shafferTimer || 0) > 0) {
      if (d.locked && cur && !cur.alive) chainPrecharge = spec.chainPrecharge;
      clearLock(d, t);
    } else {
      const s = aimAt(a, cur, spec, null, false);
      const sep = Math.hypot(angleDiff(s.yaw, a.yaw) * Math.cos(a.pitch), s.pitch - a.pitch);
      const hasLOS = clearOpticalPath(s.origin, s.raw, match.aeroVortex);
      d.targetDist = s.range;
      if (s.range > spec.maxRange || sep >= (d.locked ? spec.lockHold : spec.lockAcquire)) {
        clearLock(d, t);
      } else if (hasLOS) {
        d.occluded = false;
        d.d01Active = false;
        d.d01Timer = spec.wallDuration;
        delete d.d01Cooldowns[cur.id];
        d.focus = Math.min(1, d.focus + dt / spec.focusTime);
        d.locked = d.focus >= 1;
        updateTargetAccel(d, cur, dt);
      } else if (d.d01Timer > 0) {
        d.occluded = true;
        d.d01Active = true;
        d.d01Timer = Math.max(0, d.d01Timer - dt);
        d.focus = Math.min(1, d.focus + dt / spec.focusTime);
        d.locked = d.focus >= 1;
        updateTargetAccel(d, cur, dt);
        if (d.d01Timer <= 1e-6) {
          clearLock(d, t);
        }
      } else {
        clearLock(d, t);
      }
    }
  }

  // 3. Scan for new target inside active Auto-Aim 1.3 / 1.4 acquisition cone (instant scan on chain handoff)
  if (!d.locked && (chainPrecharge > 0 || t >= d.scanAt)) {
    d.scanAt = t + (d.aa14Active ? 0.025 : 0.035);
    let best = -1, bestCost = Infinity, bestOccluded = false, bestRange = 0;
    for (const e of match.actors) {
      if (!e.alive || e.team === a.team || (e.shafferTimer || 0) > 0) continue;
      const s = aimAt(a, e, spec, null, false);
      if (s.range > spec.maxRange) continue;
      const sep = Math.hypot(angleDiff(s.yaw, a.yaw) * Math.cos(a.pitch), s.pitch - a.pitch);
      if (sep >= spec.lockAcquire) continue;
      const hasLOS = clearOpticalPath(s.origin, s.raw, match.aeroVortex);
      if (hasLOS) {
        // ARV1.3 threat-weighted angular priority (favors closest angular match & low-HP finish)
        const cost = sep * (1 - clamp((125 - (e.hp + e.shield)) / 125, 0, 1) * 0.12);
        if (cost < bestCost) {
          best = e.id;
          bestCost = cost;
          bestOccluded = false;
          bestRange = s.range;
        }
      } else if (s.range <= spec.wallProxRange && (d.d01Cooldowns[e.id] || 0) <= t) {
        const sensorCost = sep + 0.075;
        if (sensorCost < bestCost) {
          best = e.id;
          bestCost = sensorCost;
          bestOccluded = true;
          bestRange = s.range;
        }
      }
    }
    if (best >= 0 && best !== d.focusId) {
      endWallTrack(d, t);
      resetAccel(d);
      d.focusId = best;
      d.focusSpawnId = match.actors[best].spawnId;
      d.focus = chainPrecharge;
      d.locked = d.focus >= 1;
      d.occluded = bestOccluded;
      d.d01Active = bestOccluded;
      d.d01Timer = spec.wallDuration;
      d.targetDist = bestRange;
    }
  }

  // Emit state-transition cues for human DF40 II
  if (d.locked && !wasLocked) {
    d.lockPulse = 1;
    if (a.human) match.event('rdlock', {actor: a, gun: a.gun, d01: d.d01Active, aa14: d.aa14Active});
  }
  if (d.d01Active && !wasD01) {
    d.d01Pulse = 1;
    if (a.human) match.event('d01', {actor: a, gun: a.gun, aa14: d.aa14Active});
  }

  // 4. Predictive magnetic aim tracking (Auto-Aim 1.3 smooth tracking / Auto-Aim 1.4 hyper-magnetic lock) + 3D gimbal lead
  let targetTrackYaw = 0, targetTrackPitch = 0;
  if (d.focusId >= 0) {
    const e = match.actors[d.focusId];
    if (e?.alive && e.team !== a.team && e.spawnId === d.focusSpawnId && !(e.shafferTimer > 0)) {
      const s = aimAt(a, e, spec, d.targetAccel, !d.occluded);
      const dyaw = angleDiff(s.yaw, a.yaw);
      const dpitch = s.pitch - a.pitch;
      const ang = Math.hypot(dyaw, dpitch);
      const sep = Math.hypot(dyaw * Math.cos(a.pitch), dpitch);
      d.lastAimPoint = s.raw;
      d.targetDist = s.range;
      const gimbalGain = d.locked ? (d.aa14Active ? 1.2 : 1.0) : d.focus * 0.6;
      targetTrackYaw = clamp(dyaw * 2.0 * gimbalGain, -0.25, 0.25);
      targetTrackPitch = clamp(dpitch * 1.8 * gimbalGain, -0.18, 0.18);

      if (d.locked && ang > 1e-4 && sep < spec.lockHold) {
        const rate = d.d01Active ? spec.trackGain * 0.88 : spec.trackGain;
        const step = Math.min(ang, ang * (1 - Math.exp(-rate * dt)), spec.trackRate * dt);
        const frac = step / ang;
        a.yaw += dyaw * frac;
        a.pitch = clamp(a.pitch + dpitch * frac, -1.31, 1.31);
      }
    }
  }

  // Smoothly interpolate weapon pose blends & gimbal telemetry
  const kPose = 1 - Math.exp(-15 * dt);
  const kGimbal = 1 - Math.exp(-18 * dt);
  d.lockBlend += ((d.locked ? 1 : d.focus * 0.35) - d.lockBlend) * kPose;
  d.d01Blend += ((d.d01Active ? 1 : 0) - d.d01Blend) * kPose;
  d.aa14Blend += ((d.aa14Active ? 1 : 0) - d.aa14Blend) * kPose;
  d.trackYaw += (targetTrackYaw - d.trackYaw) * kGimbal;
  d.trackPitch += (targetTrackPitch - d.trackPitch) * kGimbal;
}

// ARV1.3 Quad-Barrel Subtle-Spread Smart Launch Solver (4-round shotgun-like cluster; AA1.3 base / AA1.4 Overdrive).
export function bulletGuidanceDF40II(match, a, barrelSide = 0, barrelVert = 0) {
  const d = a.df40;
  const spec = activeDF40Spec(d);
  const rng = match?.rng || Math.random;
  // Subtle shotgun-like 4-pellet cone (~1.3° total unlocked, tightened cleanly under AA1.3 / AA1.4 lock)
  const jitterYaw = (rng() - 0.5) * 0.0044;
  const jitterPitch = (rng() - 0.5) * 0.0036;
  const baseFanYaw = barrelSide * 0.0115 + jitterYaw;
  const baseFanPitch = barrelVert * 0.0085 + jitterPitch;
  const e = d && d.focusId >= 0 ? match.actors[d.focusId] : null;
  if ((a.human && match.autoAim === false) || !d || !d.locked || !e?.alive || e.team === a.team || e.spawnId !== d.focusSpawnId || (e.shafferTimer || 0) > 0) {
    return {
      dir: forward(a.yaw + baseFanYaw, clamp(a.pitch + baseFanPitch, -1.31, 1.31)),
      guided: false,
      targetId: -1,
      homingBudget: 0,
      homingRate: 0,
      homingCos: spec.homingCos,
      aaTier: spec.tier,
      arvOrder: 2,
      accel: null
    };
  }
  const raw = aimAt(a, e, spec, null, false);
  const s = aimAt(a, e, spec, d.targetAccel, true);
  const yaw = angleDiff(s.yaw, a.yaw);
  const pitch = s.pitch - a.pitch;
  const ang = Math.hypot(yaw, pitch);
  const separation = Math.hypot(angleDiff(raw.yaw, a.yaw) * Math.cos(a.pitch), raw.pitch - a.pitch);
  if (raw.range > spec.maxRange || separation >= spec.lockHold || !clearOpticalPath(raw.origin, raw.raw, match.aeroVortex)) {
    return {
      dir: forward(a.yaw + baseFanYaw, clamp(a.pitch + baseFanPitch, -1.31, 1.31)),
      guided: false,
      targetId: -1,
      homingBudget: 0,
      homingRate: 0,
      homingCos: spec.homingCos,
      aaTier: spec.tier,
      arvOrder: 2,
      accel: null
    };
  }
  const gain = Math.min(spec.launchGain, spec.launchStep / Math.max(0.00001, ang));
  // Subtle shotgun-like quad pattern tightened dynamically by ARV1.3 / AA1.4 lock!
  const shotYaw = a.yaw + yaw * gain + baseFanYaw * spec.fanScale;
  const shotPitch = clamp(a.pitch + pitch * gain + baseFanPitch * spec.fanScale, -1.31, 1.31);
  return {
    dir: forward(shotYaw, shotPitch),
    guided: true,
    targetId: e.id,
    homingBudget: spec.homingBudget,
    homingRate: spec.homingRate,
    homingCos: spec.homingCos,
    aaTier: spec.tier,
    arvOrder: 2,
    accel: [d.targetAccel[0], d.targetAccel[1], d.targetAccel[2]],
    velWeight: spec.velWeight,
    accelWeight: spec.accelWeight
  };
}
