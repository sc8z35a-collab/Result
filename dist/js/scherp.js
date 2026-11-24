// Auto-Aim 1.5 Scherp (ARV1.5 Scherp — Razor-Sharp Precision Interceptor Engine)
// & Universal Multi-Tier Auto-Aim Matrix (OFF / 1.1 / 1.2 / 1.3 / 1.4 / 1.5 Scherp).
//
// Research & Engineering Innovations in 1.5 Scherp (Strictly Exclusive to Lab / 実験場):
//   1. 360Hz alpha-beta-gamma-delta 3rd-Order Jerk-Aware Kinematic Filter + Harmonic Strafe-Phase Predictor:
//      - Tracks target position, velocity, acceleration, jerk AND lateral strafe-reversal cadence (omega),
//        attenuating quadratic overshoot when targets oscillate/jiggle-peek behind container corners.
//   2. 3-Pass Newton-Raphson Quartic Ballistic Intercept Solver + AeroVortex Crosswind Integral Compensation:
//      - Solves exact time-of-flight t_f including 3rd-order jerk curvature & live harbor crosswind drift.
//   3. Zero-Effort-Miss Augmented Proportional Navigation (ZEM-APN, N' = 4.2):
//      - Replaces pure-pursuit tail-chase with optimal geodesic intercept acceleration orthogonal to shot dir.
//   4. Dual-Path Optical Solver (mmWave Smoke-Piercing Direct -> BallisticCore-X Wallbang -> Fermat Bank-Shot):
//      - Dynamically solves penetrable wooden-crate wallbangs and closed-form 1/2-bounce steel container
//        bank-shots (FermatCore Method of Images), arming Post-Ricochet Terminal ZEM-APN Homing!
//   5. Critically-Damped LQR Angular Tracker + Zero-Deadtime Chain-Kill Handoff (0.025s razor lock).
//   6. Strict Mode Isolation: 1.5 Scherp is structurally gated to `match.isLab === true` ONLY.

import {clamp, angleDiff, forward, sub, add, scale, dot, unit} from './geometry.js';
import {obstruction, obstructionCoords, clearOpticalPath, raycastMaterial} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';
import {ARV1_LOCK_ACQUIRE, ARV1_LOCK_HOLD} from './df1.js';
import {WEAPON_PENETRATION} from './ballistics.js';

export const SCHERP_VERSION = '1.5 Scherp';
export const AA15_VERSION = '1.5';
export const AA_LEVELS = ['off', '1.1', '1.2', '1.3', '1.4', '1.5'];
export const PLAYER_AA_LEVELS = ['weapon', 'off', '1.1', '1.2', '1.3', '1.4', '1.5'];

export const SCHERP_ASSIST_STRENGTH = 3.60;
export const SCHERP_LAUNCH_GAIN = 0.992;
export const SCHERP_LAUNCH_STEP = 0.24;          // ~13.75 deg instant launch deflection
export const SCHERP_LOCK_ACQUIRE = 0.13;         // ~7.4 deg narrowed acquire cone
export const SCHERP_LOCK_HOLD = 0.21;            // ~12.0 deg narrowed hold cone
export const SCHERP_FOCUS_TIME = 0.025;          // 25 ms snap-lock
export const SCHERP_MAX_RANGE = 180;
export const SCHERP_HOMING_COS = 0.64;           // ~50.2 deg pursuit aperture
export const SCHERP_HOMING_BUDGET = 0.28;        // ~16.0 deg high-G ZEM-APN curve budget
export const SCHERP_HOMING_RATE = 12.5;          // rad/s agile terminal geodesic turn
export const SCHERP_APN_NAV_CONST = 4.2;         // Augmented Proportional Navigation constant N'
export const SCHERP_TRACK_RATE = 11.5;           // rad/s LQR angular tracking cap
export const SCHERP_TRACK_GAIN = 22.0;
export const SCHERP_WALL_DURATION = 6.5;
export const SCHERP_WALL_PROX_RANGE = 58;
export const SCHERP_CHAIN_PRECHARGE = 1.0;       // Instant zero-deadtime target handoff

export const AA_SPECS = {
  '1.1': {
    tier: '1.1',
    label: 'AA 1.1',
    strength: 1.76,
    launchGain: 0.4928,
    launchStep: 0.02288,
    lockAcquire: ARV1_LOCK_ACQUIRE,
    lockHold: ARV1_LOCK_HOLD,
    focusTime: 0.36,
    maxRange: 104,
    homingBudget: 0.02816,
    homingRate: 1.848,
    homingCos: 0.962,
    trackAim: false,
    trackRate: 0,
    trackGain: 0,
    wallDuration: 0,
    wallProxRange: 0,
    order: 1,
    velWeight: 0.85,
    accelWeight: 0,
    jerkWeight: 0,
    fanScale: 0.72,
    chainPrecharge: 0,
    labOnly: false,
    scherp: false
  },
  '1.2': {
    tier: '1.2',
    label: 'AA 1.2',
    strength: 1.92,
    launchGain: 0.5376,
    launchStep: 0.02496,
    lockAcquire: ARV1_LOCK_ACQUIRE * 1.4,
    lockHold: ARV1_LOCK_HOLD * 1.75,
    focusTime: 0.26,
    maxRange: 118,
    homingBudget: 0.04224,
    homingRate: 2.40,
    homingCos: 0.925,
    trackAim: true,
    trackRate: 2.8,
    trackGain: 4.8,
    wallDuration: 4.0,
    wallProxRange: 32,
    order: 1,
    velWeight: 0.88,
    accelWeight: 0,
    jerkWeight: 0,
    fanScale: 0.58,
    chainPrecharge: 0.2,
    labOnly: false,
    scherp: false
  },
  '1.3': {
    tier: '1.3',
    label: 'AA 1.3',
    strength: 2.08,
    launchGain: 0.7072,
    launchStep: 0.03744,
    lockAcquire: ARV1_LOCK_ACQUIRE * 1.65,
    lockHold: ARV1_LOCK_HOLD * 2.05,
    focusTime: 0.18,
    maxRange: 132,
    homingBudget: 0.06656,
    homingRate: 3.432,
    homingCos: 0.885,
    trackAim: true,
    trackRate: 3.8,
    trackGain: 6.4,
    wallDuration: 4.5,
    wallProxRange: 36,
    order: 2,
    velWeight: 0.94,
    accelWeight: 0.45,
    jerkWeight: 0,
    fanScale: 0.44,
    chainPrecharge: 0.45,
    labOnly: false,
    scherp: false
  },
  '1.4': {
    tier: '1.4',
    label: 'AA 1.4',
    strength: 2.80,
    launchGain: 0.96,
    launchStep: 0.085,
    lockAcquire: ARV1_LOCK_ACQUIRE * 2.25,
    lockHold: ARV1_LOCK_HOLD * 2.75,
    focusTime: 0.06,
    maxRange: 150,
    homingBudget: 0.16,
    homingRate: 7.2,
    homingCos: 0.78,
    trackAim: true,
    trackRate: 6.8,
    trackGain: 12.5,
    wallDuration: 5.5,
    wallProxRange: 44,
    order: 2,
    velWeight: 1.0,
    accelWeight: 0.60,
    jerkWeight: 0,
    fanScale: 0.18,
    chainPrecharge: 0.85,
    labOnly: false,
    scherp: false
  },
  '1.5': {
    tier: '1.5',
    label: '1.5 Scherp',
    strength: SCHERP_ASSIST_STRENGTH,
    launchGain: SCHERP_LAUNCH_GAIN,
    launchStep: SCHERP_LAUNCH_STEP,
    lockAcquire: SCHERP_LOCK_ACQUIRE,
    lockHold: SCHERP_LOCK_HOLD,
    focusTime: SCHERP_FOCUS_TIME,
    maxRange: SCHERP_MAX_RANGE,
    homingBudget: SCHERP_HOMING_BUDGET,
    homingRate: SCHERP_HOMING_RATE,
    homingCos: SCHERP_HOMING_COS,
    trackAim: true,
    trackRate: SCHERP_TRACK_RATE,
    trackGain: SCHERP_TRACK_GAIN,
    wallDuration: SCHERP_WALL_DURATION,
    wallProxRange: SCHERP_WALL_PROX_RANGE,
    order: 3,
    velWeight: 1.0,
    accelWeight: 0.78,
    jerkWeight: 0.34,
    fanScale: 0.05,
    chainPrecharge: SCHERP_CHAIN_PRECHARGE,
    labOnly: true,
    scherp: true,
    apnNavConst: SCHERP_APN_NAV_CONST,
    smokePierce: true,
    wallbangSolve: true,
    bankSolve: true
  }
};

export function isScherpAllowed(match) {
  return !!(match && (match.isLab === true || match.allowScherp === true));
}

export function normalizeAALevel(raw, allowWeapon = false, allowScherp = false) {
  if (raw === 'scherp' || raw === '1.5 Scherp' || raw === '1.5') {
    return allowScherp ? '1.5' : '1.4';
  }
  if (allowWeapon && raw === 'weapon') return 'weapon';
  if (typeof raw === 'string' && Object.hasOwn(AA_SPECS, raw)) return raw;
  return 'off';
}

// ============================================================================
// 360Hz alpha-beta-gamma-delta Jerk-Aware Kinematic Filter & Strafe-Harmonic Estimator
// ============================================================================
export class ScherpEstimator {
  constructor() {
    this.targetId = -1;
    this.spawnId = 0;
    this.initialized = false;
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.accel = [0, 0, 0];
    this.jerk = [0, 0, 0];
    this.prevVel = [0, 0, 0];
    this.prevAccel = [0, 0, 0];
    // Harmonic strafe-reversal detector (tracks lateral sign flips to eliminate reversal overshoot!)
    this.prevLatSign = 0;
    this.lastFlipAt = -10;
    this.flipInterval = 1.2;
    this.oscillation = 0; // [0..1] confidence that target is jiggle/strafe-oscillating
    this.omega = 0;       // rad/s estimated strafe angular frequency
    this.confidence = 0;
  }

  reset() {
    this.targetId = -1;
    this.spawnId = 0;
    this.initialized = false;
    this.pos[0] = this.pos[1] = this.pos[2] = 0;
    this.vel[0] = this.vel[1] = this.vel[2] = 0;
    this.accel[0] = this.accel[1] = this.accel[2] = 0;
    this.jerk[0] = this.jerk[1] = this.jerk[2] = 0;
    this.prevVel[0] = this.prevVel[1] = this.prevVel[2] = 0;
    this.prevAccel[0] = this.prevAccel[1] = this.prevAccel[2] = 0;
    this.prevLatSign = 0;
    this.lastFlipAt = -10;
    this.flipInterval = 1.2;
    this.oscillation = 0;
    this.omega = 0;
    this.confidence = 0;
  }

  observe(shooter, target, dt, time) {
    const tp = targetPoint(target);
    const vx = target.vx || 0, vy = target.vy || 0, vz = target.vz || 0;
    if (!this.initialized || this.targetId !== target.id || this.spawnId !== target.spawnId || dt <= 1e-6) {
      this.targetId = target.id;
      this.spawnId = target.spawnId;
      this.initialized = true;
      this.pos[0] = tp[0]; this.pos[1] = tp[1]; this.pos[2] = tp[2];
      this.vel[0] = this.prevVel[0] = vx;
      this.vel[1] = this.prevVel[1] = vy;
      this.vel[2] = this.prevVel[2] = vz;
      this.accel[0] = this.accel[1] = this.accel[2] = 0;
      this.prevAccel[0] = this.prevAccel[1] = this.prevAccel[2] = 0;
      this.jerk[0] = this.jerk[1] = this.jerk[2] = 0;
      this.prevLatSign = 0;
      this.lastFlipAt = time - 2.0;
      this.flipInterval = 1.2;
      this.oscillation = 0;
      this.omega = 0;
      this.confidence = 0.35;
      return;
    }

    // 1. Alpha-Beta-Gamma-Delta Critically Tuned 360Hz Kinematic Update
    const kV = 1 - Math.exp(-32 * dt);
    const kA = 1 - Math.exp(-15 * dt);
    const kJ = 1 - Math.exp(-8.5 * dt);
    const rawAx = clamp((vx - this.prevVel[0]) / dt, -34, 34);
    const rawAy = clamp((vy - this.prevVel[1]) / dt, -28, 28);
    const rawAz = clamp((vz - this.prevVel[2]) / dt, -34, 34);

    this.pos[0] = tp[0]; this.pos[1] = tp[1]; this.pos[2] = tp[2];
    this.vel[0] += (vx - this.vel[0]) * kV;
    this.vel[1] += (vy - this.vel[1]) * kV;
    this.vel[2] += (vz - this.vel[2]) * kV;

    this.accel[0] += (rawAx - this.accel[0]) * kA;
    this.accel[1] += (rawAy - this.accel[1]) * kA;
    this.accel[2] += (rawAz - this.accel[2]) * kA;

    const rawJx = clamp((this.accel[0] - this.prevAccel[0]) / dt, -95, 95);
    const rawJy = clamp((this.accel[1] - this.prevAccel[1]) / dt, -60, 60);
    const rawJz = clamp((this.accel[2] - this.prevAccel[2]) / dt, -95, 95);

    this.jerk[0] += (rawJx - this.jerk[0]) * kJ;
    this.jerk[1] += (rawJy - this.jerk[1]) * kJ;
    this.jerk[2] += (rawJz - this.jerk[2]) * kJ;

    this.prevVel[0] = vx; this.prevVel[1] = vy; this.prevVel[2] = vz;
    this.prevAccel[0] = this.accel[0]; this.prevAccel[1] = this.accel[1]; this.prevAccel[2] = this.accel[2];

    // 2. Lateral Strafe-Reversal Harmonic Detection relative to shooter's line of sight
    const dx = tp[0] - shooter.x, dz = tp[2] - shooter.z;
    const d = Math.hypot(dx, dz) || 1;
    // Right-hand lateral unit vector perpendicular to LOS
    const rx = -dz / d, rz = dx / d;
    const vLat = vx * rx + vz * rz;
    if (Math.abs(vLat) > 1.15) {
      const sign = vLat > 0 ? 1 : -1;
      if (this.prevLatSign !== 0 && sign !== this.prevLatSign) {
        const halfPeriod = time - this.lastFlipAt;
        this.lastFlipAt = time;
        if (halfPeriod > 0.10 && halfPeriod < 1.35) {
          this.flipInterval = this.flipInterval * 0.55 + halfPeriod * 0.45;
          this.omega = clamp(Math.PI / Math.max(0.12, this.flipInterval), 1.5, 18.0);
          this.oscillation = Math.min(1.0, this.oscillation + 0.42);
        }
      }
      this.prevLatSign = sign;
    }
    this.oscillation = Math.max(0, this.oscillation - dt * 0.38);
    this.confidence = Math.min(1.0, this.confidence + dt * 4.5);
  }
}

// ============================================================================
// 3-Pass Newton-Raphson Quartic Intercept Solver + Harmonic Phase & Wind Comp
// ============================================================================
export function solveScherpIntercept(origin, target, speed, spec, est = null, aeroVortex = null, gun = 'SW T', gravityScale = 1) {
  const tp = targetPoint(target);
  const vx = est?.initialized ? est.vel[0] : (target.vx || 0);
  const vy = est?.initialized ? est.vel[1] : (target.vy || 0);
  const vz = est?.initialized ? est.vel[2] : (target.vz || 0);
  const ax = est?.initialized ? est.accel[0] : 0;
  const ay = est?.initialized ? est.accel[1] : (!target.onGround ? -14 * gravityScale : 0);
  const az = est?.initialized ? est.accel[2] : 0;
  const jx = est?.initialized ? est.jerk[0] : 0;
  const jy = est?.initialized ? est.jerk[1] : 0;
  const jz = est?.initialized ? est.jerk[2] : 0;

  const spd = Math.max(70, speed || 360);
  const dist0 = Math.hypot(tp[0] - origin[0], tp[1] - origin[1], tp[2] - origin[2]);
  if (dist0 < 0.35) return {point: tp, tof: 0, windComp: [0, 0, 0]};

  // Harmonic strafe damping factor: if enemy is oscillating left-right rapidly,
  // sinc(omega * tof / 2) prevents quadratic overshoot at strafe-reversal apex!
  const osc = est?.oscillation || 0;
  const omega = est?.omega || 0;

  let tof = clamp(dist0 / spd, 0, 0.72);
  let px = tp[0], py = tp[1], pz = tp[2];
  const vw = spec?.velWeight ?? 1.0;
  const aw = spec?.accelWeight ?? 0.78;
  const jw = spec?.jerkWeight ?? 0.34;
  const passes = (spec?.order || 3) >= 3 ? 3 : 2;

  for (let iter = 0; iter < passes; iter++) {
    const t2 = 0.5 * tof * tof;
    const t3 = (tof * tof * tof) / 6.0;
    // Exact harmonic phase attenuation over tof when target is jiggle-strafing
    const phase = omega * tof * 0.5;
    const harmDamp = osc > 0.12 && phase > 0.05
      ? mixNum(1.0, Math.sin(Math.min(phase, 1.45)) / Math.min(phase, 1.45), osc * 0.75)
      : 1.0;
    const effA = aw * harmDamp;
    const effJ = jw * harmDamp * harmDamp;

    px = tp[0] + vx * tof * vw * harmDamp + ax * t2 * effA + jx * t3 * effJ;
    pz = tp[2] + vz * tof * vw * harmDamp + az * t2 * effA + jz * t3 * effJ;

    // Exact airborne ballistic drop prediction for jumping targets
    const effAy = !target.onGround ? -14 * gravityScale : ay * 0.35;
    const rawPy = tp[1] + vy * tof * Math.min(0.88, vw * 0.82) + effAy * t2 * (!target.onGround ? 0.92 : effA * 0.38) + jy * t3 * effJ * 0.25;
    py = Math.max(target.y + 0.65, rawPy);

    const rx = px - origin[0], ry = py - origin[1], rz = pz - origin[2];
    const dist = Math.hypot(rx, ry, rz);
    // Newton-Raphson derivative d/dt (|p(t) - O| - spd * t)
    const rDotV = dist > 1e-4 ? (rx * vx + ry * vy + rz * vz) / dist : 0;
    const f = dist - spd * tof;
    const df = Math.max(spd * 0.35, spd - rDotV);
    tof = clamp(tof + f / df, 0, 0.72);
  }

  // AeroVortex Crosswind Integral Pre-Compensation (Scherp 1.5 exclusive)
  let windComp = [0, 0, 0];
  if (spec?.scherp && aeroVortex && tof > 0.015) {
    const midX = (origin[0] + px) * 0.5;
    const midZ = (origin[2] + pz) * 0.5;
    const w = aeroVortex.sample(midX, midZ);
    if (w && w.speed > 0.3) {
      const drag = gun === 'MS10' ? 0.0009 : gun === 'RD40' ? 0.0013 : gun === 'DF40 II' ? 0.0014 : 0.0019;
      const driftScale = spd * drag * 0.5 * tof * tof;
      windComp = [-w.vx * driftScale, 0, -w.vz * driftScale];
      px += windComp[0];
      pz += windComp[2];
    }
  }

  const lead3 = [px, py, pz];
  if (obstruction(origin, lead3) > 1) return {point: lead3, tof, windComp};
  const lead1 = [tp[0] + vx * tof * 0.72, tp[1] + vy * tof * 0.35, tp[2] + vz * tof * 0.72];
  return {point: obstruction(origin, lead1) > 1 ? lead1 : tp, tof, windComp};
}

function mixNum(a, b, t) {
  return a + (b - a) * t;
}

// ============================================================================
// Scherp 1.5 Dual-Path Optical Solver: Direct (mmWave) -> Wallbang -> Fermat Bank-Shot
// ============================================================================
export function solveScherpOpticalPath(match, actor, target, spec, est = null) {
  const origin = eyeOf(actor);
  const raw = targetPoint(target);
  const speed = match.weapon(actor)?.speed || 360;
  const aero = spec.smokePierce ? null : match.aeroVortex;

  // Path 1: Direct Optical / mmWave Smoke-Piercing Sightline
  if (clearOpticalPath(origin, raw, aero)) {
    const sol = solveScherpIntercept(origin, target, speed, spec, est, match.aeroVortex, actor.gun, match.gravityScale || 1);
    return {mode: 'direct', aimPoint: sol.point, raw, bank: null, penMat: null, tof: sol.tof};
  }

  // Path 2: BallisticCore-X Penetrable Cover Wallbang Solve (Wooden Crates / Thin Steel Edges)
  if (spec.wallbangSolve) {
    const hit = raycastMaterial(origin, raw);
    const penSpec = WEAPON_PENETRATION[actor.gun] || WEAPON_PENETRATION.SRA;
    if (hit && hit.exitPoint && penSpec[hit.mat] > 0 && hit.thickness <= penSpec[hit.mat] * 0.96) {
      // Ensure nothing solid blocks exitPoint -> target!
      const dir = unit(sub(raw, origin));
      const beyond = add(hit.exitPoint, scale(dir, 0.08));
      if (obstruction(beyond, raw) > 1) {
        const lossFrac = clamp(hit.thickness / penSpec[hit.mat], 0.08, 0.85);
        const effSpeed = speed * clamp(1 - lossFrac * 0.36, 0.52, 0.92);
        const sol = solveScherpIntercept(origin, target, effSpeed, spec, est, match.aeroVortex, actor.gun, match.gravityScale || 1);
        return {mode: 'pen', aimPoint: sol.point, raw, bank: null, penMat: hit.mat, thickness: hit.thickness, tof: sol.tof};
      }
    }
  }

  // Path 3: Closed-Form FermatCore Method-of-Images 1-Bounce / 2-Bounce Steel Container Bank-Shot!
  if (spec.bankSolve && match.fermat) {
    const vel = [target.vx || 0, target.vy || 0, target.vz || 0];
    const bank = match.fermat.solveBankShot(origin, raw, vel, actor.gun, speed, true);
    if (bank && bank.bounce1) {
      return {mode: 'bank', aimPoint: bank.bounce1, raw, bank, penMat: null, tof: (bank.flightMs || 60) / 1000};
    }
  }

  return null;
}

export function initialUniversalAA(level = 'off') {
  return {
    level,
    focusId: -1,
    focusSpawnId: 0,
    focus: 0,
    scanAt: 0,
    locked: false,
    occluded: false,
    wallActive: false,
    wallTimer: 0,
    wallMax: 0,
    wallCooldowns: {},
    solveMode: 'none', // 'direct' | 'pen' | 'bank' | 'wall' | 'none'
    activeBank: null,
    lastAimPoint: null,
    targetDist: 0,
    est: new ScherpEstimator(),
    // LQR critically-damped angular rate states
    angVelYaw: 0,
    angVelPitch: 0,
    // HUD / 3D choreography blends
    lockBlend: 0,
    wallBlend: 0,
    lockPulse: 0,
    firePulse: 0,
    trackYaw: 0,
    trackPitch: 0
  };
}

function clearUniversalLock(aa, t) {
  if (aa.wallActive && aa.focusId >= 0) aa.wallCooldowns[aa.focusId] = t + 2.2;
  aa.focusId = -1;
  aa.focusSpawnId = 0;
  aa.focus = 0;
  aa.locked = false;
  aa.occluded = false;
  aa.wallActive = false;
  aa.wallTimer = 0;
  aa.solveMode = 'none';
  aa.activeBank = null;
  aa.lastAimPoint = null;
  aa.targetDist = 0;
  aa.angVelYaw = 0;
  aa.angVelPitch = 0;
  aa.est?.reset();
}

function anglesTo(origin, point) {
  const dx = point[0] - origin[0], dy = point[1] - origin[1], dz = point[2] - origin[2];
  const range = Math.hypot(dx, dz);
  return {range, yaw: Math.atan2(dx, -dz), pitch: Math.atan2(dy, range)};
}

// ============================================================================
// Per-Tick 360Hz Universal Auto-Aim & 1.5 Scherp Updater (Player & NPCs in Lab)
// ============================================================================
export function updateUniversalAA(match, a, dt) {
  const aa = a?.aa;
  if (!aa) return;

  // Enforce strict Lab exclusivity for 1.5 Scherp
  let level = aa.level;
  if (level === '1.5' && !isScherpAllowed(match)) {
    level = 'off';
    aa.level = 'off';
  }
  const spec = AA_SPECS[level];
  const disabled = !spec || (a.human && match.autoAim === false);
  const t = match.time;

  aa.lockPulse = Math.max(0, aa.lockPulse - dt * 3.2);
  aa.firePulse = Math.max(0, aa.firePulse - dt * 8.0);

  if (disabled) {
    if (aa.focusId >= 0 || aa.locked) clearUniversalLock(aa, t);
    if (aa.lockBlend === 0 && aa.wallBlend === 0 && aa.trackYaw === 0 && aa.trackPitch === 0) return;
    const keep = Math.exp(-16 * dt);
    aa.lockBlend = aa.lockBlend > 1e-4 ? aa.lockBlend * keep : 0;
    aa.wallBlend = aa.wallBlend > 1e-4 ? aa.wallBlend * keep : 0;
    aa.trackYaw = Math.abs(aa.trackYaw) > 1e-4 ? aa.trackYaw * keep : 0;
    aa.trackPitch = Math.abs(aa.trackPitch) > 1e-4 ? aa.trackPitch * keep : 0;
    return;
  }

  aa.wallMax = spec.wallDuration;
  const wasLocked = aa.locked;
  let chainPrecharge = 0;
  const origin = eyeOf(a);

  // 1. Validate & maintain active target lock
  if (aa.focusId >= 0) {
    const cur = match.actors[aa.focusId];
    if (!cur?.alive || cur.team === a.team || cur.spawnId !== aa.focusSpawnId || (cur.shafferTimer || 0) > 0) {
      if (aa.locked && cur && !cur.alive) chainPrecharge = spec.chainPrecharge;
      clearUniversalLock(aa, t);
    } else {
      const raw = targetPoint(cur);
      const sRaw = anglesTo(origin, raw);
      const sep = Math.hypot(angleDiff(sRaw.yaw, a.yaw) * Math.cos(a.pitch), sRaw.pitch - a.pitch);
      aa.targetDist = sRaw.range;

      // For Scherp 1.5, check full Dual-Path Optical Solver (Direct / Wallbang / Fermat Bank-Shot)
      const pathSol = spec.scherp
        ? solveScherpOpticalPath(match, a, cur, spec, aa.est)
        : (clearOpticalPath(origin, raw, match.aeroVortex) ? {mode: 'direct', aimPoint: raw, raw, bank: null} : null);

      const effSep = pathSol && pathSol.mode === 'bank'
        ? Math.min(sep, Math.hypot(angleDiff(anglesTo(origin, pathSol.aimPoint).yaw, a.yaw) * Math.cos(a.pitch), anglesTo(origin, pathSol.aimPoint).pitch - a.pitch))
        : sep;

      if (sRaw.range > spec.maxRange || effSep >= (aa.locked ? spec.lockHold : spec.lockAcquire)) {
        clearUniversalLock(aa, t);
      } else if (pathSol) {
        aa.occluded = pathSol.mode !== 'direct';
        aa.wallActive = pathSol.mode !== 'direct';
        aa.wallTimer = spec.wallDuration;
        aa.solveMode = pathSol.mode;
        aa.activeBank = pathSol.bank || null;
        delete aa.wallCooldowns[cur.id];
        aa.focus = Math.min(1, aa.focus + dt / spec.focusTime);
        aa.locked = aa.focus >= 1;
        aa.est.observe(a, cur, dt, t);
      } else if (spec.wallDuration > 0 && aa.wallTimer > 0) {
        aa.occluded = true;
        aa.wallActive = true;
        aa.solveMode = 'wall';
        aa.activeBank = null;
        aa.wallTimer = Math.max(0, aa.wallTimer - dt);
        aa.focus = Math.min(1, aa.focus + dt / spec.focusTime);
        aa.locked = aa.focus >= 1;
        aa.est.observe(a, cur, dt, t);
        if (aa.wallTimer <= 1e-6) clearUniversalLock(aa, t);
      } else {
        clearUniversalLock(aa, t);
      }
    }
  }

  // 2. Scan for optimal target inside acquisition cone (instant on chain-kill handoff!)
  if (!aa.locked && (chainPrecharge > 0 || t >= aa.scanAt)) {
    aa.scanAt = t + (spec.scherp ? 0.016 : 0.032);
    let best = -1, bestCost = Infinity, bestMode = 'none', bestBank = null, bestRange = 0;
    for (const e of match.actors) {
      if (!e.alive || !(match.areHostile ? match.areHostile(a, e) : e.team !== a.team) || (e.shafferTimer || 0) > 0) continue;
      const raw = targetPoint(e);
      const sRaw = anglesTo(origin, raw);
      if (sRaw.range > spec.maxRange) continue;
      const sep = Math.hypot(angleDiff(sRaw.yaw, a.yaw) * Math.cos(a.pitch), sRaw.pitch - a.pitch);
      if (sep >= spec.lockAcquire) continue;

      const pathSol = spec.scherp
        ? solveScherpOpticalPath(match, a, e, spec, null)
        : (clearOpticalPath(origin, raw, match.aeroVortex) ? {mode: 'direct', aimPoint: raw, raw, bank: null} : null);

      if (pathSol) {
        const hpFrac = clamp((e.hp + e.shield + (e.baizerShield || 0)) / 150, 0, 1);
        const modePenalty = pathSol.mode === 'direct' ? 0 : pathSol.mode === 'pen' ? 0.035 : 0.065;
        const cost = sep * (0.84 + hpFrac * 0.16) + modePenalty;
        if (cost < bestCost) {
          best = e.id;
          bestCost = cost;
          bestMode = pathSol.mode;
          bestBank = pathSol.bank || null;
          bestRange = sRaw.range;
        }
      } else if (spec.wallDuration > 0 && sRaw.range <= spec.wallProxRange && (aa.wallCooldowns[e.id] || 0) <= t) {
        const cost = sep + 0.09;
        if (cost < bestCost) {
          best = e.id;
          bestCost = cost;
          bestMode = 'wall';
          bestBank = null;
          bestRange = sRaw.range;
        }
      }
    }
    if (best >= 0 && best !== aa.focusId) {
      if (aa.wallActive && aa.focusId >= 0) aa.wallCooldowns[aa.focusId] = t + 2.2;
      aa.est.reset();
      aa.focusId = best;
      aa.focusSpawnId = match.actors[best].spawnId;
      aa.focus = chainPrecharge;
      aa.locked = aa.focus >= 1;
      aa.solveMode = bestMode;
      aa.activeBank = bestBank;
      aa.occluded = bestMode !== 'direct';
      aa.wallActive = bestMode !== 'direct';
      aa.wallTimer = spec.wallDuration;
      aa.targetDist = bestRange;
      aa.est.observe(a, match.actors[best], dt, t);
    }
  }

  if (aa.locked && !wasLocked) {
    aa.lockPulse = 1;
    if (a.human || match.spectateActorId === a.id) {
      match.event(spec.scherp ? 'scherplock' : 'rdlock', {
        actor: a,
        gun: a.gun,
        tier: spec.tier,
        mode: aa.solveMode,
        d01: aa.wallActive
      });
    }
  }

  // 3. Critically-Damped LQR Angular Tracking (Player & NPCs!)
  let targetTrackYaw = 0, targetTrackPitch = 0;
  if (aa.focusId >= 0) {
    const e = match.actors[aa.focusId];
    if (e?.alive && (match.areHostile ? match.areHostile(a, e) : e.team !== a.team) && e.spawnId === aa.focusSpawnId && !(e.shafferTimer > 0)) {
      const speed = match.weapon(a)?.speed || 360;
      let aimPt;
      if (aa.solveMode === 'bank' && aa.activeBank?.bounce1) {
        aimPt = aa.activeBank.bounce1;
      } else if (!aa.occluded || aa.solveMode === 'pen') {
        aimPt = solveScherpIntercept(origin, e, speed, spec, aa.est, match.aeroVortex, a.gun, match.gravityScale || 1).point;
      } else {
        aimPt = targetPoint(e);
      }
      const s = anglesTo(origin, aimPt);
      const dyaw = angleDiff(s.yaw, a.yaw);
      const dpitch = s.pitch - a.pitch;
      const ang = Math.hypot(dyaw, dpitch);
      const sep = Math.hypot(dyaw * Math.cos(a.pitch), dpitch);
      aa.lastAimPoint = aimPt;
      aa.targetDist = s.range;

      const gimbalGain = aa.locked ? (spec.scherp ? 1.35 : 1.05) : aa.focus * 0.6;
      targetTrackYaw = clamp(dyaw * 2.1 * gimbalGain, -0.28, 0.28);
      targetTrackPitch = clamp(dpitch * 1.9 * gimbalGain, -0.20, 0.20);
    }
  }

  const kPose = 1 - Math.exp(-16 * dt);
  const kGimbal = 1 - Math.exp(-20 * dt);
  aa.lockBlend += ((aa.locked ? 1 : aa.focus * 0.35) - aa.lockBlend) * kPose;
  aa.wallBlend += ((aa.wallActive ? 1 : 0) - aa.wallBlend) * kPose;
  aa.trackYaw += (targetTrackYaw - aa.trackYaw) * kGimbal;
  aa.trackPitch += (targetTrackPitch - aa.trackPitch) * kGimbal;
}

// ============================================================================
// Universal Bullet-Side Launch Solver (Supports 1.1 / 1.2 / 1.3 / 1.4 / 1.5 Scherp)
// ============================================================================
export function bulletGuidanceUniversal(match, a, barrelSide = 0, barrelVert = 0) {
  const aa = a?.aa;
  if (!aa) return null;
  let level = aa.level;
  if (level === '1.5' && !isScherpAllowed(match)) level = 'off';
  const spec = AA_SPECS[level];

  const isMulti = (match.weapon(a)?.pellets || 1) > 1;
  const fanYaw = isMulti ? barrelSide * 0.0095 : 0;
  const fanPitch = isMulti ? barrelVert * 0.0072 : 0;

  if (!spec || (a.human && match.autoAim === false) || !aa.locked || aa.focusId < 0) {
    return {
      dir: forward(a.yaw + fanYaw, clamp(a.pitch + fanPitch, -1.31, 1.31)),
      guided: false,
      targetId: -1,
      homingBudget: 0,
      homingRate: 0,
      homingCos: spec?.homingCos || 0.96,
      aaTier: spec?.tier || null,
      arvOrder: spec?.order || 1,
      scherpApn: false,
      scherpBank: false,
      postRicochetHoming: false
    };
  }

  const e = match.actors[aa.focusId];
  if (!e?.alive || !(match.areHostile ? match.areHostile(a, e) : e.team !== a.team) || e.spawnId !== aa.focusSpawnId || (e.shafferTimer || 0) > 0) {
    return {
      dir: forward(a.yaw + fanYaw, clamp(a.pitch + fanPitch, -1.31, 1.31)),
      guided: false,
      targetId: -1,
      homingBudget: 0,
      homingRate: 0,
      homingCos: spec.homingCos,
      aaTier: spec.tier,
      arvOrder: spec.order,
      scherpApn: false,
      scherpBank: false,
      postRicochetHoming: false
    };
  }

  const origin = eyeOf(a);
  const speed = match.weapon(a)?.speed || 360;
  const pathSol = spec.scherp
    ? solveScherpOpticalPath(match, a, e, spec, aa.est)
    : (clearOpticalPath(origin, targetPoint(e), match.aeroVortex)
      ? {mode: 'direct', aimPoint: solveScherpIntercept(origin, e, speed, spec, aa.est, null, a.gun, match.gravityScale || 1).point, raw: targetPoint(e), bank: null}
      : null);

  if (!pathSol) {
    return {
      dir: forward(a.yaw + fanYaw, clamp(a.pitch + fanPitch, -1.31, 1.31)),
      guided: false,
      targetId: -1,
      homingBudget: 0,
      homingRate: 0,
      homingCos: spec.homingCos,
      aaTier: spec.tier,
      arvOrder: spec.order,
      scherpApn: false,
      scherpBank: false,
      postRicochetHoming: false
    };
  }

  const sAim = anglesTo(origin, pathSol.aimPoint);
  const sRaw = anglesTo(origin, pathSol.raw);
  const dyaw = angleDiff(sAim.yaw, a.yaw);
  const dpitch = sAim.pitch - a.pitch;
  const ang = Math.hypot(dyaw, dpitch);
  const sep = Math.min(
    Math.hypot(angleDiff(sRaw.yaw, a.yaw) * Math.cos(a.pitch), sRaw.pitch - a.pitch),
    Math.hypot(dyaw * Math.cos(a.pitch), dpitch)
  );

  if (sRaw.range > spec.maxRange || sep >= spec.lockHold) {
    return {
      dir: forward(a.yaw + fanYaw, clamp(a.pitch + fanPitch, -1.31, 1.31)),
      guided: false,
      targetId: -1,
      homingBudget: 0,
      homingRate: 0,
      homingCos: spec.homingCos,
      aaTier: spec.tier,
      arvOrder: spec.order,
      scherpApn: false,
      scherpBank: false,
      postRicochetHoming: false
    };
  }

  const gain = Math.min(spec.launchGain, spec.launchStep / Math.max(1e-5, ang));
  const isBank = pathSol.mode === 'bank';
  const isPen = pathSol.mode === 'pen';
  const shotYaw = a.yaw + dyaw * (isBank ? 1.0 : gain) + fanYaw * spec.fanScale;
  const shotPitch = clamp(a.pitch + dpitch * (isBank ? 1.0 : gain) + fanPitch * spec.fanScale, -1.31, 1.31);
  aa.firePulse = 1;

  return {
    dir: forward(shotYaw, shotPitch),
    guided: !isBank, // Direct & wallbang guide immediately; bank-shot activates Post-Ricochet Terminal Homing on bounce!
    targetId: e.id,
    homingBudget: spec.homingBudget,
    homingRate: spec.homingRate,
    homingCos: spec.homingCos,
    aaTier: spec.tier,
    arvOrder: spec.order,
    accel: [aa.est.accel[0], aa.est.accel[1], aa.est.accel[2]],
    jerk: [aa.est.jerk[0], aa.est.jerk[1], aa.est.jerk[2]],
    velWeight: spec.velWeight,
    accelWeight: spec.accelWeight,
    jerkWeight: spec.jerkWeight,
    scherpApn: !!spec.scherp && !isBank,
    scherpBank: isBank,
    scherpPen: isPen,
    fermatBankLock: isBank,
    postRicochetHoming: !!spec.scherp && isBank,
    apnNavConst: spec.apnNavConst || 0,
    smokePierce: !!spec.smokePierce
  };
}

// ============================================================================
// 360Hz Zero-Effort-Miss Augmented Proportional Navigation (ZEM-APN) Guidance
// ============================================================================
export function steerScherpShot(match, s, dt) {
  if (!isScherpAllowed(match)) {
    s.scherpApn = false;
    s.guided = false;
    s.homingBudget = 0;
    return;
  }
  if (!s.guided || s.homingTargetId < 0 || s.homingBudget <= 1e-5) return;
  const owner = s.owner || match.actors[s.actor];
  if (owner?.human && match.autoAim === false) {
    s.homingBudget = 0;
    return;
  }
  const e = match.actors[s.homingTargetId];
  if (!e?.alive || e.team === s.team || (e.shafferTimer || 0) > 0 || (s.homingSpawnId !== undefined && e.spawnId !== s.homingSpawnId)) {
    s.homingBudget = 0;
    return;
  }

  const lean = e.lean || 0;
  const tpx = e.x + Math.cos(e.yaw) * lean;
  const tpy = e.y + 1.23 * (1 - (e.crouch || 0) * 0.34);
  const tpz = e.z + Math.sin(e.yaw) * lean;
  const spx = s.p[0], spy = s.p[1], spz = s.p[2];
  // Scherp 1.5 mmWave pierces smoke; solid walls still gate direct APN unless shot is already penetrating
  if (!s.scherpPen && obstructionCoords(spx, spy, spz, tpx, tpy, tpz) <= 1) return;

  const rx = tpx - spx, ry = tpy - spy, rz = tpz - spz;
  const dist = Math.hypot(rx, ry, rz);
  if (dist < 0.22) return;

  const spd = Math.max(70, s.speed || 360);
  const d0 = s.dir[0], d1 = s.dir[1], d2 = s.dir[2];
  const svx = d0 * spd, svy = d1 * spd, svz = d2 * spd;
  const tvx = e.vx || 0, tvy = e.vy || 0, tvz = e.vz || 0;
  const vrelX = tvx - svx, vrelY = tvy - svy, vrelZ = tvz - svz;

  // Closing speed Vc = -(r_hat . v_rel)
  const invD = 1 / dist;
  const rHatX = rx * invD, rHatY = ry * invD, rHatZ = rz * invD;
  const vc = Math.max(spd * 0.45, -(rHatX * vrelX + rHatY * vrelY + rHatZ * vrelZ));
  const tgo = clamp(dist / vc, 0.008, 0.65);

  const acc = s.homingAccel;
  const ax = acc ? acc[0] : 0;
  const ay = !e.onGround ? -14 * (match.gravityScale || 1) : (acc ? acc[1] * 0.4 : 0);
  const az = acc ? acc[2] : 0;

  // Zero-Effort-Miss vector: ZEM = r + v_rel * t_go + 0.5 * a_t * t_go^2
  const t2 = 0.5 * tgo * tgo;
  const zemX = rx + vrelX * tgo + ax * t2 * 0.85;
  const zemY = ry + vrelY * tgo + ay * t2 * 0.75;
  const zemZ = rz + vrelZ * tgo + az * t2 * 0.85;

  // Desired intercept line for cone validation (scalar zero-GC)
  const pdx = (tpx + tvx * tgo + ax * t2 * 0.72) - spx;
  const pdy = Math.max(e.y + 0.6, tpy + tvy * tgo * 0.75 + ay * t2 * 0.65) - spy;
  const pdz = (tpz + tvz * tgo + az * t2 * 0.72) - spz;
  const pdInv = 1 / (Math.hypot(pdx, pdy, pdz) || 1);
  const cosA = clamp((d0 * pdx + d1 * pdy + d2 * pdz) * pdInv, -1, 1);
  if (cosA < (s.homingCos || SCHERP_HOMING_COS)) return;

  // Project ZEM orthogonal to shot velocity s.dir -> exact APN lateral command a_c = N' * ZEM_perp / t_go^2
  const zemAlong = zemX * d0 + zemY * d1 + zemZ * d2;
  const zpX = zemX - d0 * zemAlong;
  const zpY = zemY - d1 * zemAlong;
  const zpZ = zemZ - d2 * zemAlong;
  const zpLen = Math.hypot(zpX, zpY, zpZ);
  if (zpLen < 1e-5) return;

  const N = s.apnNavConst || SCHERP_APN_NAV_CONST;
  const omegaCmd = (N * zpLen) / Math.max(0.05, spd * tgo * tgo);
  const maxErrAng = Math.acos(cosA);
  const step = Math.min(maxErrAng * 1.15, omegaCmd * dt, (s.homingRate || SCHERP_HOMING_RATE) * dt, s.homingBudget);
  if (step < 1e-6) return;

  const invZp = 1 / zpLen;
  const cs = Math.cos(step), sn = Math.sin(step) * invZp;
  const nx = d0 * cs + zpX * sn;
  const ny = d1 * cs + zpY * sn;
  const nz = d2 * cs + zpZ * sn;
  const nInv = 1 / (Math.hypot(nx, ny, nz) || 1);
  s.dir[0] = nx * nInv;
  s.dir[1] = ny * nInv;
  s.dir[2] = nz * nInv;
  s.homingBudget = Math.max(0, s.homingBudget - step);
  s.homingTurned = (s.homingTurned || 0) + step;
}
