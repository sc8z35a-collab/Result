// NV2.1 Spy Engine + Human Neuromotor Aim Controller (360Hz Native, Zero Wallhack)
//
// Two core subsystems:
//  1. HumanAimController (used by ALL NPCs — both NV2 and NV2.1):
//     Replaces superhuman laser-lock aiming with physically grounded human neuromotor control:
//       - Visual reaction delay ring-buffer (~210-280ms NV2, ~110-150ms NV2.1) so sudden player
//         strafe reversals, jumps, and crouches genuinely make NPC crosshairs trail behind & miss.
//       - First-sight target acquisition latency before opening fire.
//       - Second-order damped spring-mass wrist/hand tracking with angular speed caps & flick overshoot.
//       - Temporally smooth multi-frequency human aim wander (breathing / wrist drift) scaling with
//         target angular velocity, own motion, distance, and stance.
//       - Imperfect delayed velocity lead (no superhuman 2nd-order acceleration cheat).
//       - Sustained-fire recoil climb, horizontal walk, burst bloom, and hit/whiz flinch impulses.
//
//  2. SpyEngine (exclusive to NV2.1 ally NPCs):
//     - Strictly visual-sighting-based enemy dossier (zero wallhack — only updated on direct LOS).
//     - Visual trajectory & tactical intent predictor (HOLDING_ANGLE, DUELING_ALLY, TANKER_ROTATE,
//       RETREAT_HEAL, PUSHING_LANE) with enemy watch-cone & rear blind-spot estimation.
//     - 4-state stealth state machine: SPY_RECON -> SPY_INFILTRATE -> SPY_STRIKE -> SPY_VANISH.
//     - FOV-occluded stealth A* weights that route behind containers into the enemy's back.
//     - Silent trigger discipline while infiltrating; lethal ambush execution from behind/flank.
//     - Upgraded 360Hz multi-projectile + pre-emptive enemy aim-cone 6-vector walkable dodge solver
//       with high-shot crouch-duck and agile low-shot evasive hop.

import {clamp, mix, angleDiff} from './geometry.js';
import {walkable, obstruction} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';

const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// ============================================================================
// 1. Human Neuromotor Aim Controller (NV2 & NV2.1)
// ============================================================================
export class HumanAimController {
  constructor(rng, isNv21 = false) {
    this.rng = rng;
    this.isNv21 = !!isNv21;

    // Distinct per-NPC human motor profile (NV2.1 is elite-human fast, NV2 is skilled-human realistic)
    if (this.isNv21) {
      this.reactionDelay = 0.090 + rng() * 0.032;    // 90..122ms elite-human visual reaction lag
      this.acquireMin = 0.075;
      this.acquireMax = 0.130;
      this.maxYawRate = 9.4;                         // snappy human flick speed (rad/s)
      this.maxPitchRate = 7.0;
      this.stiffness = 78.0;                         // spring kP
      this.damping = 15.2;                           // crisp damping (zeta ~ 0.86, subtle natural overshoot)
      this.baseWander = 0.0068;                      // ~0.39 deg smooth steady-hand micro-drift
      this.angVelErr = 0.022;                        // crisp tracking, still lags on abrupt reversals
      this.leadSkill = 0.86 + rng() * 0.12;          // humanly imperfect velocity lead
      this.recoilScale = 0.60;
      this.bloomScale = 0.60;
      this.flinchScale = 0.48;
    } else {
      this.reactionDelay = 0.165 + rng() * 0.060;    // 165..225ms realistic human reaction lag
      this.acquireMin = 0.165;
      this.acquireMax = 0.275;
      this.maxYawRate = 6.8;                         // realistic human mouse/stick turn rate
      this.maxPitchRate = 5.0;
      this.stiffness = 54.0;
      this.damping = 11.6;                           // slight under-damping (zeta ~ 0.79 -> visible flick overshoot)
      this.baseWander = 0.0102;                      // ~0.58 deg natural human hand sway across silhouette
      this.angVelErr = 0.034;                        // noticeably trails & misses when target strafes/reverses!
      this.leadSkill = 0.68 + rng() * 0.22;          // humanly imperfect lead estimation
      this.recoilScale = 0.90;
      this.bloomScale = 0.88;
      this.flinchScale = 0.92;
    }

    // Visual target memory ring-buffer (stores direct-LOS observations only)
    this.targetId = -1;
    this.history = [];
    this.lastRecordAt = -10;
    this.lastSeenAt = -10;
    this.acquireReadyAt = 0;

    // Spring-damper physical hand velocity
    this.velYaw = 0;
    this.velPitch = 0;

    // Temporally smooth Ornstein-Uhlenbeck / Lissajous human wander state
    this.phaseA = rng() * 6.283;
    this.phaseB = rng() * 6.283;
    this.wanderY = 0;
    this.wanderP = 0;
    this.wanderGoalY = (rng() - 0.5) * 1.1;
    this.wanderGoalP = (rng() - 0.5) * 0.8;
    this.wanderNextAt = 0;
    this.leadNoise = 0;
    this.leadNextAt = 0;

    // Sustained recoil climb, horizontal drift, burst bloom & flinch shock
    this.recoilY = 0;
    this.recoilP = 0;
    this.bloom = 0;
    this.flinchY = 0;
    this.flinchP = 0;
    this.lastTgtVx = 0;
    this.lastTgtVz = 0;
    this.strafeShock = 0;

    // Diagnostics for verification & tuning
    this.avgErrorRad = 0;
    this.samples = 0;
  }

  reset(t = 0) {
    this.targetId = -1;
    this.history.length = 0;
    this.lastRecordAt = -10;
    this.lastSeenAt = -10;
    this.acquireReadyAt = t + 0.15;
    this.velYaw = 0;
    this.velPitch = 0;
    this.recoilY = 0;
    this.recoilP = 0;
    this.bloom = 0;
    this.flinchY = 0;
    this.flinchP = 0;
    this.strafeShock = 0;
  }

  // Record live visual sighting into delayed perception buffer (strictly when LOS is true)
  observeVisibleTarget(target, t, ambushPreAim = false) {
    const tp = targetPoint(target);
    const switched = target.id !== this.targetId;
    const reacquired = t - this.lastSeenAt > 0.55;

    if (switched || reacquired) {
      this.targetId = target.id;
      this.history.length = 0;
      const baseAcq = mix(this.acquireMin, this.acquireMax, this.rng());
      this.acquireReadyAt = t + (ambushPreAim ? baseAcq * 0.50 : baseAcq);
      // Slight initial misread on sudden target switch (forces human flick correction!)
      this.wanderGoalY = (this.rng() - 0.5) * (this.isNv21 ? 1.15 : 1.55);
      this.wanderGoalP = (this.rng() - 0.5) * (this.isNv21 ? 0.85 : 1.15);
      this.lastTgtVx = target.vx || 0;
      this.lastTgtVz = target.vz || 0;
    }

    // Detect sudden target strafe reversal or jump -> momentarily spikes human tracking error!
    const dvx = (target.vx || 0) - this.lastTgtVx;
    const dvz = (target.vz || 0) - this.lastTgtVz;
    const accelJump = Math.hypot(dvx, dvz);
    if (!switched && accelJump > 2.6) {
      this.strafeShock = clamp(this.strafeShock + accelJump * (this.isNv21 ? 0.042 : 0.085), 0, 1.15);
    }
    this.lastTgtVx = target.vx || 0;
    this.lastTgtVz = target.vz || 0;

    if (t - this.lastRecordAt >= 0.014 || this.history.length === 0) {
      this.lastRecordAt = t;
      this.history.push({
        t,
        x: tp[0],
        y: tp[1],
        z: tp[2],
        vx: target.vx || 0,
        vy: target.vy || 0,
        vz: target.vz || 0,
        onGround: !!target.onGround
      });
      // Keep ~0.52s of visual history
      while (this.history.length > 36 || (this.history.length > 2 && t - this.history[0].t > 0.52)) {
        this.history.shift();
      }
    }
    this.lastSeenAt = t;
  }

  // Retrieve target's perceived state at (t - reactionDelay)
  sampleDelayedTarget(t) {
    const h = this.history;
    if (!h.length) return null;
    const queryT = t - this.reactionDelay;
    if (queryT <= h[0].t) return h[0];
    const last = h[h.length - 1];
    if (queryT >= last.t) return last;
    for (let i = h.length - 2; i >= 0; i--) {
      if (h[i].t <= queryT) {
        const a = h[i], b = h[i + 1];
        const span = Math.max(1e-5, b.t - a.t);
        const u = clamp((queryT - a.t) / span, 0, 1);
        return {
          t: queryT,
          x: mix(a.x, b.x, u),
          y: mix(a.y, b.y, u),
          z: mix(a.z, b.z, u),
          vx: mix(a.vx, b.vx, u),
          vy: mix(a.vy, b.vy, u),
          vz: mix(a.vz, b.vz, u),
          onGround: u < 0.5 ? a.onGround : b.onGround
        };
      }
    }
    return h[0];
  }

  onShotFired(gun, isBursting = false) {
    const gunKick = gun === 'MS10' ? 0.0068 : gun === 'D1' ? 0.0056 : gun === 'SRA' ? 0.0070 : 0.0086;
    const s = this.recoilScale;
    // Authentic upward muzzle climb + slight alternating horizontal recoil pull
    this.recoilP = clamp(this.recoilP + gunKick * s * (0.70 + this.rng() * 0.60), -0.02, 0.048);
    this.recoilY = clamp(this.recoilY + (this.rng() - 0.5) * gunKick * 1.35 * s, -0.036, 0.036);
    this.bloom = clamp(this.bloom + (isBursting ? 0.0044 : 0.0030) * this.bloomScale, 0, 0.024);
  }

  onHitShock(power = 6) {
    const mag = (0.0085 + power * 0.0014) * this.flinchScale;
    this.flinchP = clamp(this.flinchP + mag * (0.50 + this.rng() * 0.60), -0.055, 0.065);
    this.flinchY = clamp(this.flinchY + (this.rng() - 0.5) * mag * 2.1, -0.055, 0.055);
    // Getting shot momentarily disrupts smooth tracking!
    this.strafeShock = clamp(this.strafeShock + 0.34 * this.flinchScale, 0, 1.15);
  }

  onWhizShock() {
    const mag = 0.0055 * this.flinchScale;
    this.flinchY = clamp(this.flinchY + (this.rng() - 0.5) * mag * 1.7, -0.042, 0.042);
    this.flinchP = clamp(this.flinchP + (this.rng() - 0.35) * mag, -0.038, 0.042);
  }

  // Advance physical human aiming controller by dt (360Hz-safe continuous ODEs!)
  step(a, dt, t, opts) {
    const {
      seenTarget,       // live target actor if currently in direct LOS, else null
      wpn,              // weapon stats
      fallbackYaw,      // desired yaw when scanning / pre-aiming / suppressing
      fallbackPitch = 0,
      suppressPos = null,
      counterStrafing = false,
      dodging = false,
      backstabBonus = false
    } = opts;

    // 1. Decay recoil, bloom, flinch, and strafe shock smoothly
    const recDecay = Math.exp(-(this.isNv21 ? 11.5 : 8.6) * dt);
    this.recoilY *= recDecay;
    this.recoilP *= recDecay;
    this.bloom = Math.max(0, this.bloom - dt * (this.isNv21 ? 0.045 : 0.032));
    const flDecay = Math.exp(-(this.isNv21 ? 12.0 : 8.5) * dt);
    this.flinchY *= flDecay;
    this.flinchP *= flDecay;
    this.strafeShock *= Math.exp(-(this.isNv21 ? 5.6 : 3.8) * dt);

    // 2. Smooth low-frequency human aim wander (breathing + micro-hand drift)
    if (t >= this.wanderNextAt) {
      this.wanderGoalY = (this.rng() - 0.5) * 1.85;
      this.wanderGoalP = (this.rng() - 0.5) * 1.25;
      this.wanderNextAt = t + (this.isNv21 ? 0.14 + this.rng() * 0.15 : 0.18 + this.rng() * 0.24);
    }
    if (t >= this.leadNextAt) {
      this.leadNoise = (this.rng() - 0.5) * (this.isNv21 ? 0.20 : 0.36);
      this.leadNextAt = t + 0.32 + this.rng() * 0.36;
    }
    const wSmooth = 1 - Math.exp(-(this.isNv21 ? 6.8 : 4.8) * dt);
    this.wanderY += (this.wanderGoalY - this.wanderY) * wSmooth;
    this.wanderP += (this.wanderGoalP - this.wanderP) * wSmooth;

    const breathY = Math.sin(t * 2.35 + this.phaseA) * 0.18 + Math.sin(t * 5.1 + this.phaseB) * 0.08;
    const breathP = Math.cos(t * 1.95 + this.phaseB) * 0.15 + Math.sin(t * 4.3 + this.phaseA) * 0.07;

    const eye = eyeOf(a);
    let idealYaw = fallbackYaw;
    let idealPitch = fallbackPitch;
    let dist = 25;
    let trueYaw = fallbackYaw;
    let truePitch = fallbackPitch;
    let readyToFire = false;
    let targetAngSpeed = 0;

    if (seenTarget) {
      this.observeVisibleTarget(seenTarget, t, backstabBonus);
      const perc = this.sampleDelayedTarget(t);

      // Exact live angle (only used for diagnostics & distance, never fed raw to lock!)
      const liveTp = targetPoint(seenTarget);
      const lrx = liveTp[0] - eye[0], lry = liveTp[1] - eye[1], lrz = liveTp[2] - eye[2];
      dist = Math.hypot(lrx, lry, lrz);
      trueYaw = Math.atan2(lrx, -lrz);
      truePitch = clamp(Math.atan2(lry, Math.hypot(lrx, lrz)), -0.78, 0.78);

      if (perc) {
        const pdx = perc.x - eye[0], pdy = perc.y - eye[1], pdz = perc.z - eye[2];
        const pHoriz = Math.max(0.8, Math.hypot(pdx, pdz));
        const pDist = Math.hypot(pdx, pdy, pdz);

        // Perceived angular crossing speed of target (strafing sideways makes tracking harder!)
        const perpVel = Math.abs((-pdz * perc.vx + pdx * perc.vz) / pHoriz);
        targetAngSpeed = perpVel / pHoriz;

        // Imperfect delayed velocity lead (plus partial human extrapolation over own reaction delay)
        const leadT = clamp(pDist / Math.max(80, wpn.speed), 0, 0.38);
        const leadMul = clamp(this.leadSkill + this.leadNoise, 0.36, 1.06);
        // Humans extrapolate perceived velocity across reaction delay -> smooth steady tracking, genuine overshoot on reversal!
        const extrapT = this.reactionDelay * (this.isNv21 ? 0.84 : 0.70);
        const aimX = perc.x + perc.vx * (leadT * leadMul + extrapT);
        const aimY = perc.y + perc.vy * (leadT * 0.38 + extrapT * 0.25) + (perc.onGround ? 0 : 0.05);
        const aimZ = perc.z + perc.vz * (leadT * leadMul + extrapT);

        const rx = aimX - eye[0], ry = aimY - eye[1], rz = aimZ - eye[2];
        idealYaw = Math.atan2(rx, -rz);
        idealPitch = clamp(Math.atan2(ry, Math.hypot(rx, rz)), -0.78, 0.78);

        // Compute dynamic human aim offset amplitude
        const ownSpeed = Math.hypot(a.vx, a.vz);
        const moveMul = counterStrafing ? 0.72
          : !a.onGround ? 1.50
          : dodging ? (this.isNv21 ? 1.12 : 1.30)
          : (1 + clamp(ownSpeed / 5.2, 0, 1.1) * (this.isNv21 ? 0.20 : 0.30));
        const stanceMul = (1 - a.crouch * 0.22 - a.aimPose * 0.14) * (backstabBonus ? 0.74 : 1.0);
        const rangeMul = 0.86 + clamp((pDist - 12) / 48, 0, 0.42);
        const stressErr = targetAngSpeed * this.angVelErr + this.strafeShock * (this.isNv21 ? 0.010 : 0.018);
        const errAmp = (this.baseWander * moveMul * stanceMul * rangeMul) + stressErr + this.bloom;

        idealYaw += (this.wanderY * 0.74 + breathY) * errAmp + this.recoilY + this.flinchY;
        idealPitch = clamp(
          idealPitch + (this.wanderP * 0.62 + breathP) * errAmp * 0.68 + this.recoilP + this.flinchP,
          -0.88, 0.88
        );

        readyToFire = t >= this.acquireReadyAt;
      }
    } else if (suppressPos) {
      const rx = suppressPos[0] - eye[0], ry = suppressPos[1] - eye[1], rz = suppressPos[2] - eye[2];
      dist = Math.hypot(rx, ry, rz);
      idealYaw = Math.atan2(rx, -rz) + (this.wanderY * 0.05 + this.recoilY);
      idealPitch = clamp(Math.atan2(ry, Math.hypot(rx, rz)) + (this.wanderP * 0.035 + this.recoilP), -0.78, 0.78);
      trueYaw = idealYaw;
      truePitch = idealPitch;
      readyToFire = true;
    } else {
      // Scanning / rotating toward movement or pre-aim direction
      if (t - this.lastSeenAt > 0.85) this.history.length = 0;
    }

    // 3. Second-Order Damped Spring-Mass Wrist/Arm Tracking (continuous, 360Hz stable)
    const errY = angleDiff(idealYaw, a.yaw);
    const errP = idealPitch - a.pitch;
    const active = !!(seenTarget || suppressPos);
    const kP = active ? this.stiffness : this.stiffness * 0.58;
    const kD = active ? this.damping : this.damping * 0.82;
    const maxY = (active ? this.maxYawRate : this.maxYawRate * 0.72) * (1 - a.aimPose * 0.08);
    const maxP = active ? this.maxPitchRate : this.maxPitchRate * 0.68;

    // Sub-step clamp for large dt safety
    const sdt = Math.min(dt, 0.025);
    this.velYaw = clamp(this.velYaw + (kP * errY - kD * this.velYaw) * sdt, -maxY, maxY);
    this.velPitch = clamp(this.velPitch + (kP * errP - kD * this.velPitch) * sdt, -maxP, maxP);

    a.yaw += this.velYaw * dt;
    a.pitch = clamp(a.pitch + this.velPitch * dt, -0.92, 0.92);

    // Alignment relative to the NPC's OWN perceived aim line (humans fire when THEY think crosshair is close!)
    const alignPerceived = Math.hypot(angleDiff(idealYaw, a.yaw), (idealPitch - a.pitch) * 0.8);
    const alignTrue = Math.hypot(angleDiff(trueYaw, a.yaw), (truePitch - a.pitch) * 0.8);
    if (seenTarget) {
      this.samples++;
      this.avgErrorRad += (alignTrue - this.avgErrorRad) * 0.04;
    }

    // Natural per-shot micro-spread (tiny residual mechanical/trigger-pull dispersion on top of smooth human sway)
    const microSpread = (this.isNv21 ? 0.0055 : 0.0095) + this.bloom * 0.35;

    return {
      readyToFire,
      alignPerceived,
      alignTrue,
      dist,
      microSpread,
      targetAngSpeed
    };
  }
}

// ============================================================================
// 2. NV2.1 Spy Engine — Visual Sighting -> Prediction -> Stealth Backstab -> Vanish
//    + Upgraded 360Hz Multi-Projectile & Pre-Emptive Aim-Cone Evade Solver
// ============================================================================
export const SPY_STATE_LABELS = {
  SPY_RECON: '視認偵察',
  SPY_INFILTRATE: '潜入裏どり中',
  SPY_STRIKE: '裏どり急襲',
  SPY_VANISH: '離脱・再潜伏'
};

export class SpyAgentState {
  constructor() {
    this.mode = 'SPY_RECON';          // SPY_RECON | SPY_INFILTRATE | SPY_STRIKE | SPY_VANISH
    this.modeUntil = 0;
    this.markId = -1;                 // enemy actor ID currently being stalked from behind
    this.sightings = new Map();       // enemyId -> VisualDossier (STRICTLY visual LOS only!)
    this.prediction = null;           // latest {enemyId, predX, predZ, predYaw, intent, conf, at}
    this.ambushNodeId = -1;
    this.vanishNodeId = -1;
    this.vanishUntil = -1;
    this.holdFire = false;
    this.lastBackstabAt = -10;
    this.lastDodgeJumpAt = -5;
    this.dodgeUrgency = 0;
    this.lastDodgeKind = '';
    this.reconLane = 1;               // alternates west (-1) / east (+1) stealth perimeter
  }

  clearSighting(enemyId) {
    this.sightings.delete(enemyId);
    if (this.markId === enemyId) {
      this.markId = -1;
      this.prediction = null;
      this.ambushNodeId = -1;
    }
  }
}

// Record a direct visual sighting (ONLY called when spy has clear LOS within visual FOV!)
export function recordVisualSighting(spyState, spyActor, enemy, t, metrics) {
  let dos = spyState.sightings.get(enemy.id);
  const lane = enemy.x < -6 ? -1 : enemy.x > 6 ? 1 : 0;
  const spd = Math.hypot(enemy.vx || 0, enemy.vz || 0);
  if (!dos) {
    dos = {
      enemyId: enemy.id,
      x: enemy.x,
      y: enemy.y,
      z: enemy.z,
      vx: enemy.vx || 0,
      vy: enemy.vy || 0,
      vz: enemy.vz || 0,
      yaw: enemy.yaw,
      gun: enemy.gun,
      hp: enemy.hp,
      shield: enemy.shield,
      reloading: enemy.reload > 0.08,
      lane,
      avgSpeed: spd,
      stationaryTime: spd < 1.3 ? 0.1 : 0,
      firstSeenAt: t,
      lastSeenAt: t,
      sightCount: 1,
      history: [{t, x: enemy.x, z: enemy.z, vx: enemy.vx || 0, vz: enemy.vz || 0, yaw: enemy.yaw}]
    };
    spyState.sightings.set(enemy.id, dos);
    if (metrics) metrics.spySightings++;
  } else {
    const dt = Math.max(0.01, t - dos.lastSeenAt);
    const prevX = dos.x, prevZ = dos.z;
    // Estimate observed velocity smoothly from visual displacement + observable motion
    const obsVx = dt < 0.75 ? mix((enemy.x - prevX) / dt, enemy.vx || 0, 0.55) : (enemy.vx || 0);
    const obsVz = dt < 0.75 ? mix((enemy.z - prevZ) / dt, enemy.vz || 0, 0.55) : (enemy.vz || 0);
    const prevDt = t - dos.lastSeenAt;
    if (prevDt > 1.0 && metrics) metrics.spySightings++;

    dos.x = enemy.x;
    dos.y = enemy.y;
    dos.z = enemy.z;
    dos.vx = obsVx;
    dos.vy = enemy.vy || 0;
    dos.vz = obsVz;
    dos.yaw = enemy.yaw;
    dos.gun = enemy.gun;
    dos.hp = enemy.hp;
    dos.shield = enemy.shield;
    dos.reloading = enemy.reload > 0.08;
    dos.lane = lane;
    dos.avgSpeed = mix(dos.avgSpeed, Math.hypot(obsVx, obsVz), 0.35);
    dos.stationaryTime = dos.avgSpeed < 1.35 ? Math.min(8, dos.stationaryTime + Math.min(0.4, dt)) : Math.max(0, dos.stationaryTime - dt * 1.4);
    dos.lastSeenAt = t;
    dos.sightCount++;

    const lastH = dos.history[dos.history.length - 1];
    if (!lastH || t - lastH.t >= 0.14) {
      dos.history.push({t, x: enemy.x, z: enemy.z, vx: obsVx, vz: obsVz, yaw: enemy.yaw});
      if (dos.history.length > 8) dos.history.shift();
    }
  }
}

// Predict enemy future position, watch direction, and tactical behavior strictly from visual dossier!
export function predictFromVisualDossier(dos, spyActor, match, t) {
  const elapsed = Math.max(0, t - dos.lastSeenAt);
  const conf = Math.exp(-elapsed / 6.8);
  if (conf < 0.22) return null;

  // Determine enemy intent from visual observations ONLY
  let intent = 'PUSHING_LANE';
  let predHorizon = clamp(elapsed * 0.78 + 1.15, 0.65, 3.0);
  let vx = dos.vx, vz = dos.vz;
  let predYaw = dos.yaw;

  // Check if enemy was visually facing toward one of our alive teammates (distracted duel!)
  let distractedByAlly = false;
  const eFx = Math.sin(dos.yaw), eFz = -Math.cos(dos.yaw);
  for (const ally of match.actors) {
    if (!ally.alive || ally.team !== spyActor.team || ally.id === spyActor.id) continue;
    const dx = ally.x - dos.x, dz = ally.z - dos.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < 46 && (dx * eFx + dz * eFz) / d > 0.72) {
      distractedByAlly = true;
      break;
    }
  }

  // Check if enemy velocity visually aimed toward a supply tanker
  let tankerGoal = null;
  const spd = Math.hypot(vx, vz);
  if (spd > 1.4 && match.tankers) {
    for (const tk of match.tankers) {
      if (tk.cooldown > 5.0) continue;
      const dx = tk.x - dos.x, dz = tk.z - dos.z, d = Math.hypot(dx, dz);
      if (d < 28 && d > 2.5 && (dx * vx + dz * vz) / (d * spd) > 0.74) {
        tankerGoal = tk;
        break;
      }
    }
  }

  const enemyTeam = 1 - spyActor.team;
  const towardEnemySpawnZ = enemyTeam === 1 ? -1 : 1;

  if (dos.hp + dos.shield < 54 && vz * towardEnemySpawnZ > 1.2) {
    intent = 'RETREAT_HEAL';
    predHorizon = clamp(elapsed * 0.68 + 1.35, 0.8, 2.8);
  } else if (tankerGoal) {
    intent = 'TANKER_ROTATE';
    const dTk = dist2(dos.x, dos.z, tankerGoal.x, tankerGoal.z);
    const frac = clamp((spd * predHorizon) / Math.max(1, dTk), 0.25, 0.92);
    const px = clamp(mix(dos.x, tankerGoal.x, frac), -22, 22);
    const pz = clamp(mix(dos.z, tankerGoal.z, frac), -94, 94);
    predYaw = Math.atan2(tankerGoal.x - dos.x, -(tankerGoal.z - dos.z));
    return {
      enemyId: dos.enemyId,
      intent,
      conf,
      predX: px,
      predZ: pz,
      predYaw,
      watchX: Math.sin(predYaw),
      watchZ: -Math.cos(predYaw),
      rearX: -Math.sin(predYaw),
      rearZ: Math.cos(predYaw),
      distracted: distractedByAlly,
      at: t
    };
  } else if (dos.stationaryTime > 0.65 || dos.avgSpeed < 1.35) {
    intent = distractedByAlly ? 'DUELING_ALLY' : 'HOLDING_ANGLE';
    predHorizon = Math.min(0.65, elapsed * 0.35 + 0.35);
    vx *= 0.35;
    vz *= 0.35;
  } else if (distractedByAlly) {
    intent = 'DUELING_ALLY';
    predHorizon = clamp(elapsed * 0.62 + 0.95, 0.5, 2.4);
  }

  // Project walkable predicted location along observed visual velocity
  let predX = clamp(dos.x + vx * predHorizon, -22, 22);
  let predZ = clamp(dos.z + vz * predHorizon, -94, 94);
  if (!walkable(predX, predZ)) {
    // Pull back halfway if projected path hits a container
    predX = clamp(dos.x + vx * predHorizon * 0.45, -22, 22);
    predZ = clamp(dos.z + vz * predHorizon * 0.45, -94, 94);
    if (!walkable(predX, predZ)) {
      predX = dos.x;
      predZ = dos.z;
    }
  }

  // If moving significantly, blend watch direction slightly toward travel direction unless dueling ally
  if (spd > 2.2 && !distractedByAlly) {
    const moveYaw = Math.atan2(vx, -vz);
    predYaw = dos.yaw + angleDiff(moveYaw, dos.yaw) * 0.35;
  }

  return {
    enemyId: dos.enemyId,
    intent,
    conf,
    predX,
    predZ,
    predYaw,
    watchX: Math.sin(predYaw),
    watchZ: -Math.cos(predYaw),
    rearX: -Math.sin(predYaw),
    rearZ: Math.cos(predYaw),
    distracted: distractedByAlly,
    at: t
  };
}

// Compute dot product indicating whether spy is behind the enemy's back (> 0.25 = rear/blind-flank, > 0.6 = pure backstab!)
export function rearAdvantage(spyX, spyZ, targetX, targetZ, targetYaw) {
  const dx = spyX - targetX, dz = spyZ - targetZ;
  const d = Math.hypot(dx, dz) || 1;
  const rearX = -Math.sin(targetYaw), rearZ = Math.cos(targetYaw);
  return (dx * rearX + dz * rearZ) / d;
}

// Build FOV-occluded stealth A* weights that keep NV2.1 out of visually predicted enemy sight cones!
export function buildSpyStealthWeights(baseWeights, nav, spyState, spyActor, match, t) {
  const weights = new Map(baseWeights);
  const W = nav.W, H = nav.H;
  const predictions = [];

  for (const [id, dos] of spyState.sightings) {
    const e = match.actors[id];
    if (!e?.alive) continue;
    if (t - dos.lastSeenAt > 8.5) continue;
    const pr = predictFromVisualDossier(dos, spyActor, match, t);
    if (pr && pr.conf > 0.25) predictions.push(pr);
  }
  if (!predictions.length) return weights;

  // Penalize grid cells inside any visually predicted enemy's front vision cone (within 36m)
  for (const pr of predictions) {
    const minGx = clamp(Math.floor((pr.predX - 30 + 25) * 0.5), 0, W - 1);
    const maxGx = clamp(Math.ceil((pr.predX + 30 + 25) * 0.5), 0, W - 1);
    const minGz = clamp(Math.floor((pr.predZ - 34 + 99) * 0.5), 0, H - 1);
    const maxGz = clamp(Math.ceil((pr.predZ + 34 + 99) * 0.5), 0, H - 1);
    for (let gz = minGz; gz <= maxGz; gz++) {
      const cz = -99 + gz * 2 + 1;
      const row = gz * W;
      for (let gx = minGx; gx <= maxGx; gx++) {
        const cx = -25 + gx * 2 + 1;
        const dx = cx - pr.predX, dz = cz - pr.predZ;
        const d2 = dx * dx + dz * dz;
        if (d2 < 9 || d2 > 1156) continue; // skip <3m or >34m
        const d = Math.sqrt(d2);
        const frontDot = (dx * pr.watchX + dz * pr.watchZ) / d;
        // Inside enemy front +-68 deg visual cone -> heavy stealth penalty so A* wraps behind containers!
        if (frontDot > 0.36) {
          const conePen = (frontDot - 0.30) * (1 - d / 38) * 26 * pr.conf;
          if (conePen > 0.6) {
            const idx = row + gx;
            weights.set(idx, (weights.get(idx) || 0) + conePen);
          }
        }
      }
    }
  }
  return weights;
}

// Main NV2.1 Spy Strategic Planner — selects SPY_RECON / SPY_INFILTRATE / SPY_STRIKE / SPY_VANISH
export function planSpyTactics(nv, a, b, spyState) {
  const t = nv.match.time;
  const g = nv.graph;
  const cog = nv.teams[a.team];
  const wpn = nv.match.weapon(a);

  // Expire dead or stale (>10s unseen) visual dossiers
  for (const [id, dos] of spyState.sightings) {
    const e = nv.match.actors[id];
    if (!e?.alive || t - dos.lastSeenAt > 10.5) spyState.sightings.delete(id);
  }

  // Check if Spy needs to VANISH (low HP, low mag under threat, or pinched by 2+ visible enemies watching us)
  let enemiesLookingAtMe = 0;
  for (const e of b.visibleEnemies || []) {
    const dx = a.x - e.x, dz = a.z - e.z, d = Math.hypot(dx, dz) || 1;
    const lookDot = (dx * Math.sin(e.yaw) + dz * (-Math.cos(e.yaw))) / d;
    if (lookDot > 0.65) enemiesLookingAtMe++;
  }

  const mustVanish = a.hp < 52
    || (a.hp < 68 && enemiesLookingAtMe >= 2)
    || (a.mag <= Math.max(2, Math.floor(wpn.capacity * 0.16)) && a.stock > 0 && enemiesLookingAtMe >= 1)
    || t < spyState.vanishUntil;

  if (mustVanish) {
    spyState.mode = 'SPY_VANISH';
    spyState.holdFire = a.hp < 44 || a.mag <= 1;
    if (t >= spyState.vanishUntil) spyState.vanishUntil = t + 2.35;

    // Pick best occluded flank cover away from known visual threats
    const threats = [];
    for (const [, dos] of spyState.sightings) threats.push({x: dos.x, z: dos.z});
    if (!threats.length && b.lastPos) threats.push({x: b.lastPos[0], z: b.lastPos[1]});

    let bestNode = null, bestSc = -Infinity;
    for (let i = 0; i < g.N; i++) {
      const n = g.nodes[i];
      if (!n.nearCover) continue;
      const dMe = dist2(a.x, a.z, n.x, n.z);
      if (dMe < 4.5 || dMe > 28) continue;
      let sc = 18 - dMe * 0.55 - cog.threat[n.cell] * 4.5;
      if (n.lane !== 0) sc += 6.5; // prefer outer shadow corridors
      let hidden = 0;
      for (const th of threats) {
        const dT = dist2(n.x, n.z, th.x, th.z);
        if (dT > 12) sc += Math.min(12, (dT - 12) * 0.45);
        if (obstruction([n.x, 1.45, n.z], [th.x, 1.45, th.z]) <= 1) hidden++;
      }
      sc += hidden * 14;
      if (sc > bestSc) { bestSc = sc; bestNode = n; }
    }
    if (bestNode) {
      spyState.vanishNodeId = bestNode.id;
      const weights = buildSpyStealthWeights(nv.tacticalWeights(a, b), nv.nav, spyState, a, nv.match, t);
      b.path = nv.nav.route([a.x, a.z], [bestNode.x, bestNode.z], weights);
      b.state = '離脱・再潜伏';
      b.htnTask = 'SPY_VANISH';
      b.planAt = t + 0.24;
      return true;
    }
    return false;
  }

  // Evaluate visual predictions across all visually sighted enemies to pick prime backstab mark!
  let bestPred = null, bestMarkScore = -Infinity;
  for (const [, dos] of spyState.sightings) {
    const e = nv.match.actors[dos.enemyId];
    if (!e?.alive) continue;
    const pr = predictFromVisualDossier(dos, a, nv.match, t);
    if (!pr) continue;
    const d = dist2(a.x, a.z, pr.predX, pr.predZ);
    const rear = rearAdvantage(a.x, a.z, pr.predX, pr.predZ, pr.predYaw);
    let sc = pr.conf * 34 - d * 0.48 + rear * 22;
    if (pr.distracted) sc += 18;
    if (pr.intent === 'HOLDING_ANGLE' || pr.intent === 'DUELING_ALLY') sc += 14;
    if (dos.hp + dos.shield < 58) sc += 12;
    if (dos.reloading) sc += 10;
    if (dos.enemyId === spyState.markId) sc += 8; // stickiness
    if (sc > bestMarkScore) { bestMarkScore = sc; bestPred = pr; }
  }

  // No fresh visual sightings -> SPY_RECON along stealth outer flank corridors to visually spot enemies!
  if (!bestPred) {
    spyState.mode = 'SPY_RECON';
    spyState.holdFire = false;
    spyState.markId = -1;
    spyState.prediction = null;

    // Pick a stealth observation vantage along outer lane (-1 or +1) mid-field
    const targetZ = a.team === 0 ? -10 : 10;
    if (Math.abs(a.x) < 6 && b.rng() < 0.35) spyState.reconLane = a.x >= 0 ? 1 : -1;
    let bestN = null, bestS = -Infinity;
    for (let i = 0; i < g.N; i++) {
      const n = g.nodes[i];
      if (n.lane !== spyState.reconLane) continue;
      const dMe = dist2(a.x, a.z, n.x, n.z);
      if (dMe < 7 || dMe > 42) continue;
      const sc = 24 - Math.abs(n.z - targetZ) * 0.35 - Math.abs(dMe - 20) * 0.35 + (n.nearCover ? 7 : 0) - cog.threat[n.cell] * 3.5;
      if (sc > bestS) { bestS = sc; bestN = n; }
    }
    if (bestN) {
      b.path = nv.nav.route([a.x, a.z], [bestN.x, bestN.z], nv.tacticalWeights(a, b));
      b.state = '視認偵察';
      b.htnTask = 'SPY_RECON';
      b.planAt = t + 0.28;
      return true;
    }
    return false;
  }

  // We have a valid visual prediction!
  if (!spyState.prediction || spyState.prediction.enemyId !== bestPred.enemyId || t - spyState.prediction.at > 0.7) {
    nv.metrics.spyPredictions++;
  }
  spyState.markId = bestPred.enemyId;
  spyState.prediction = bestPred;

  const markActor = nv.match.actors[bestPred.enemyId];
  const markSeenNow = !!(b.seen && b.target && b.target.id === bestPred.enemyId)
    || (b.visibleEnemies || []).some(e => e.id === bestPred.enemyId);

  const curDist = dist2(a.x, a.z, bestPred.predX, bestPred.predZ);
  const curRear = rearAdvantage(a.x, a.z, bestPred.predX, bestPred.predZ, bestPred.predYaw);
  const liveRear = markSeenNow && markActor
    ? rearAdvantage(a.x, a.z, markActor.x, markActor.z, markActor.yaw)
    : curRear;

  // Determine whether we have arrived in the enemy's blind spot / flank strike zone -> SPY_STRIKE!
  const spottedByMark = markSeenNow && markActor && liveRear < -0.52 && curDist < 34;
  const keepStriking = spyState.mode === 'SPY_STRIKE' && t < (spyState.strikeUntil || 0) && curDist <= 26;
  const inAmbushZone = keepStriking || (markSeenNow && (
    (liveRear > 0.05 && curDist <= 26)
    || curDist <= 17
    || spottedByMark
    || (t - b.underFireAt < 0.75)
  ));

  if (inAmbushZone) {
    if (spyState.mode !== 'SPY_STRIKE') nv.metrics.spyFlanks++;
    spyState.mode = 'SPY_STRIKE';
    if (markSeenNow) spyState.strikeUntil = t + 2.1;
    spyState.holdFire = false;
    b.target = markActor || b.target;
    if (markActor) b.targetId = markActor.id;

    // Close and orbit around enemy's blind back while shooting!
    const idealStrikeD = a.gun === 'D1' ? 10 : a.gun === 'MS10' ? 12.5 : 14;
    const tx = markSeenNow && markActor ? markActor.x : bestPred.predX;
    const tz = markSeenNow && markActor ? markActor.z : bestPred.predZ;
    const tyaw = markSeenNow && markActor ? markActor.yaw : bestPred.predYaw;
    const rx = -Math.sin(tyaw), rz = Math.cos(tyaw); // behind enemy
    const side = (a.x - tx) * Math.cos(tyaw) + (a.z - tz) * Math.sin(tyaw) >= 0 ? 1 : -1;
    const gx = clamp(tx + rx * Math.min(idealStrikeD, Math.max(6.5, curDist * 0.72)) + Math.cos(tyaw) * side * 3.4, -22, 22);
    const gz = clamp(tz + rz * Math.min(idealStrikeD, Math.max(6.5, curDist * 0.72)) + Math.sin(tyaw) * side * 3.4, -94, 94);
    b.path = nv.nav.route([a.x, a.z], [gx, gz], nv.tacticalWeights(a, b));
    b.state = '裏どり急襲';
    b.htnTask = 'SPY_STRIKE';
    b.peekPhase = 'peek';
    b.planAt = t + 0.16;
    return true;
  }

  // Otherwise: SPY_INFILTRATE — plot stealth container-occluded flanking path behind the enemy's back!
  if (spyState.mode !== 'SPY_INFILTRATE') nv.metrics.spyFlanks++;
  spyState.mode = 'SPY_INFILTRATE';

  // Silent trigger discipline: hold fire if glimpsing an unaware target while wrapping into their blind spot!
  spyState.holdFire = !!(
    markSeenNow && !spottedByMark && enemiesLookingAtMe === 0
    && t - b.underFireAt > 1.1
    && (liveRear < 0.22 || curDist > 21)
  );

  // Choose optimal stealth backstab node in the enemy's rear/flank blind spot
  let bestAmbush = null, bestSc = -Infinity;
  const enemyLane = bestPred.predX < -6 ? -1 : bestPred.predX > 6 ? 1 : 0;
  for (let i = 0; i < g.N; i++) {
    const n = g.nodes[i];
    const dE = dist2(n.x, n.z, bestPred.predX, bestPred.predZ);
    if (dE < 7.5 || dE > 27) continue;
    const dMe = dist2(a.x, a.z, n.x, n.z);
    if (dMe > 56) continue;
    const rAdv = rearAdvantage(n.x, n.z, bestPred.predX, bestPred.predZ, bestPred.predYaw);
    if (rAdv < -0.10) continue; // skip frontal head-on nodes!

    let sc = rAdv * 36 + (18 - Math.abs(dE - 13.5)) * 1.15 - dMe * 0.42 - cog.threat[n.cell] * 3.2;
    if (n.nearCover) sc += 8.5;
    if (n.lane !== enemyLane) sc += 7.5; // wrap via side lane around containers
    if (n.id === spyState.ambushNodeId) sc += 5.0; // avoid path thrashing
    if (sc > bestSc) { bestSc = sc; bestAmbush = n; }
  }

  if (bestAmbush) {
    spyState.ambushNodeId = bestAmbush.id;
    const stealthWeights = buildSpyStealthWeights(nv.tacticalWeights(a, b), nv.nav, spyState, a, nv.match, t);
    b.path = nv.nav.route([a.x, a.z], [bestAmbush.x, bestAmbush.z], stealthWeights);
    b.state = '潜入裏どり中';
    b.htnTask = 'SPY_INFILTRATE';
    b.planAt = t + 0.22;
    return true;
  }

  return false;
}

// ============================================================================
// 3. NV2.1 Upgraded 360Hz Multi-Projectile + Pre-Emptive Aim-Cone Dodge Solver
// ============================================================================
const DODGE_ANGLES = [0, 0.55, -0.55, 1.05, -1.05, Math.PI];

export function computeSpyDodge(nv, a, b, spyState) {
  const t = nv.match.time;
  const shots = nv.match.shots;
  const ax = a.x, ay = a.y + 1.02, az = a.z;

  // Collect ALL active incoming enemy bullets within 44m and 0.42s impact window
  const incoming = [];
  let minImp = 0.44;
  let highThreat = false;
  let lowCloseThreat = false;

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (s.team === a.team) continue;
    const rx = ax - s.p[0], ry = ay - s.p[1], rz = az - s.p[2];
    const d2 = rx * rx + ry * ry + rz * rz;
    if (d2 > 1936 || d2 < 0.20) continue; // >44m or already passed
    const along = rx * s.dir[0] + ry * s.dir[1] + rz * s.dir[2];
    if (along <= 0) continue;
    const tImp = along / Math.max(80, s.speed);
    if (tImp > 0.42) continue;

    const cpx = s.p[0] + s.dir[0] * along;
    const cpy = s.p[1] + s.dir[1] * along;
    const cpz = s.p[2] + s.dir[2] * along;
    const missH = Math.hypot(cpx - ax, cpz - az);
    if (missH < 1.38 && Math.abs(cpy - ay) < 1.08) {
      incoming.push({
        px: s.p[0], pz: s.p[2],
        dx: s.dir[0], dz: s.dir[2],
        cpx, cpy, cpz,
        tImp,
        missH
      });
      if (tImp < minImp) minImp = tImp;
      if (missH < 0.96 && cpy > a.y + 1.08) highThreat = true;
      if (missH < 0.85 && cpy < a.y + 0.90 && tImp < 0.16) lowCloseThreat = true;
    }
  }

  // Also check PRE-EMPTIVE aim-cone threats: visible enemy pointing straight at NV2.1!
  let aimRay = null;
  for (const e of b.visibleEnemies || []) {
    if (!e.alive || e.reload > 0.12) continue;
    const ex = ax - e.x, ez = az - e.z;
    const d = Math.hypot(ex, ez);
    if (d < 2 || d > 44) continue;
    const fx = Math.sin(e.yaw), fz = -Math.cos(e.yaw);
    const aimDot = (ex * fx + ez * fz) / d;
    if (aimDot > 0.945) {
      aimRay = {ex: e.x, ez: e.z, fx, fz, d, aimDot};
      break;
    }
  }

  if (!incoming.length && !aimRay) {
    spyState.dodgeUrgency *= 0.88;
    return false;
  }

  // Reference perpendicular axis derived from most urgent incoming bullet or enemy aim-line
  let refX, refZ;
  if (incoming.length) {
    incoming.sort((u, v) => u.tImp - v.tImp);
    const top = incoming[0];
    const px = -top.dz, pz = top.dx;
    const sideDot = (top.cpx - ax) * px + (top.cpz - az) * pz;
    const sign = sideDot >= 0 ? -1 : 1;
    refX = px * sign;
    refZ = pz * sign;
  } else {
    const px = -aimRay.fz, pz = aimRay.fx;
    const sign = b.strafe >= 0 ? 1 : -1;
    refX = px * sign;
    refZ = pz * sign;
  }
  const refLen = Math.hypot(refX, refZ) || 1;
  refX /= refLen;
  refZ /= refLen;

  // Test 6 candidate escape directions with walkable wall-clearance & multi-bullet clearance scoring!
  const baseAng = Math.atan2(refX, refZ);
  let bestVx = refX, bestVz = refZ, bestScore = -Infinity;

  for (let k = 0; k < DODGE_ANGLES.length; k++) {
    const ang = baseAng + DODGE_ANGLES[k];
    const vx = Math.sin(ang), vz = Math.cos(ang);
    const clear1 = walkable(ax + vx * 0.72, az + vz * 0.72);
    const clear2 = walkable(ax + vx * 1.38, az + vz * 1.38);
    if (!clear1) continue;

    // Evaluate future body position ~0.18s into evade burst (1.15m lateral displacement)
    const fx = ax + vx * 1.15, fz = az + vz * 1.15;
    let sc = clear2 ? 8.0 : 1.5;

    // Maximize minimum clearance from ALL simultaneous incoming bullets!
    let worstClear = 9.0;
    for (let j = 0; j < incoming.length; j++) {
      const s = incoming[j];
      const dBullet = Math.hypot(fx - s.cpx, fz - s.cpz);
      if (dBullet < worstClear) worstClear = dBullet;
      sc += Math.min(2.6, dBullet) * (1.5 / (s.tImp + 0.08));
    }
    if (incoming.length) sc += worstClear * 6.5;

    // Clearance away from enemy's live aim-line
    if (aimRay) {
      const rx = fx - aimRay.ex, rz = fz - aimRay.ez;
      const along = rx * aimRay.fx + rz * aimRay.fz;
      const perp = Math.hypot(rx - aimRay.fx * along, rz - aimRay.fz * along);
      sc += Math.min(2.8, perp) * 3.8;
    }

    // Bonus for stepping toward cover if we have a cover anchor
    if (b.cover) {
      const curCov = dist2(ax, az, b.cover.x, b.cover.z);
      const nextCov = dist2(fx, fz, b.cover.x, b.cover.z);
      sc += (curCov - nextCov) * 1.6;
    }

    // Subtle continuity bonus with current dodge vector so motion stays crisp (not vibrating in place)
    if (t < b.dodgeUntil) {
      sc += (vx * b.dodgeVec[0] + vz * b.dodgeVec[1]) * 1.4;
    }

    if (sc > bestScore) {
      bestScore = sc;
      bestVx = vx;
      bestVz = vz;
    }
  }

  b.dodgeVec[0] = bestVx;
  b.dodgeVec[1] = bestVz;
  const hadDodge = t < b.dodgeUntil;
  const dur = incoming.length ? 0.29 : 0.19;
  b.dodgeUntil = Math.max(b.dodgeUntil, t + dur);
  spyState.dodgeUrgency = incoming.length ? 1.0 : 0.65;
  spyState.lastDodgeKind = highThreat ? 'DUCK' : lowCloseThreat ? 'HOP' : incoming.length ? 'SIDESTEP' : 'WEAVE';

  if (!hadDodge) {
    nv.metrics.projDodges++;
    nv.metrics.spyDodges++;
  }

  // High incoming shot -> instant tactical crouch-duck below bullet line!
  if (highThreat && a.onGround && t > b.crouchFeintUntil) {
    b.crouchFeintUntil = t + 0.34;
  }
  // Low/mid sudden close burst in open ground -> agile evasive lateral hop!
  if (lowCloseThreat && !highThreat && a.onGround && t - spyState.lastDodgeJumpAt > 2.6) {
    a.vy = 4.65;
    a.onGround = false;
    spyState.lastDodgeJumpAt = t;
    nv.metrics.jump++;
  }

  return true;
}
