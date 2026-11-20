// NV2 Human — Computational Cognitive & Biomechanical Human-Like FPS AI Architecture (360Hz Native).
//
// Research-Grade Humanization Pillars (100% Fair-Play — Zero Wallhack, Zero Aimbot):
//   1. Individual Human Tactical Archetypes (`DUELIST`, `ANCHOR`, `TACTICIAN`, `SHARPSHOOTER`):
//      - Distinct traits per NPC (boldness, patience, flick speed, burst discipline, check-six frequency,
//        acoustic curiosity, stress resilience, handedness bias) so every teammate & opponent feels unique.
//   2. Yerkes-Dodson Arousal / Flow / Stress & Startle Reflex (`HumanMind`):
//      - Inverted-U cognitive arousal curve (calm -> Flow "Zone" -> high-stress suppression).
//      - Genuine human Startle Reflex (115-205ms freeze/flinch + wide panic flick overshoot) when ambushed
//        from outside the front attention cone, plus post-tag re-peek hesitation & post-kill habit reloads.
//   3. Foveal / Parafoveal / Peripheral Visual Attention & Inattentional Blindness (`HumanVisionModel`):
//      - Fast foveal recognition (±18°), slower parafoveal (18°-42°), motion/muzzle-flash-gated peripheral
//        vision (42°-78°), and tunnel-vision slowdown against secondary flankers while dueling.
//   4. Two-Phase Fitts's Law / Minimum-Jerk Biomechanical Aiming (`HumanMotorAim`):
//      - Phase 1: Minimum-jerk quintic ballistic primary flick (bell-shaped velocity curve, Fitts's Law
//        duration T = a + b*log2(1 + D/W)) with Harris & Wolpert signal-dependent endpoint scatter
//        (realistic undershoot/overshoot proportional to flick amplitude).
//      - Phase 2: Visual verification pause (~75-115ms) -> tight corrective micro-saccade -> trigger pull.
//      - Delayed human wrist recoil pull-down (~105ms recognition lag) + voluntary burst-reset pauses +
//        exertion-modulated respiratory sway & high-stress physiological micro-tremor.
//   5. Natural Corner-Slicing Pre-Aim, Acoustic Curiosity & "Checking Six" (`HumanGazeDirector`):
//      - Pre-aims open harbor sightlines & container corner edges instead of staring into walls, snaps
//        head naturally toward arrived EchoPulse sounds, holds post-peek corners, and checks blind flanks.
//   6. Realistic Human Squad Comms Delay (`HumanCommsRelay`):
//      - Replaces 0ms hive-mind telepathy with natural 0.38-0.72s voice-callout latency & slight spatial fuzz.

import {clamp, mix, angleDiff} from './geometry.js';
import {raycastMaterial} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';

export const NV2_HUMAN_VERSION = 'NV2 Human';

export const HUMAN_ARCHETYPES = Object.freeze({
  DUELIST: {
    id: 'DUELIST',
    ja: '積極デュエリスト',
    boldness: 0.84,
    patience: 0.34,
    flickSpeed: 1.12,
    burstDiscipline: 0.56,
    curiosity: 0.62,
    stressResilience: 0.72,
    checkSixRate: 0.45,
    repeekCaution: 0.38,
    reactionScale: 0.94,
    wanderScale: 1.04
  },
  ANCHOR: {
    id: 'ANCHOR',
    ja: '堅実アンカー',
    boldness: 0.42,
    patience: 0.86,
    flickSpeed: 0.95,
    burstDiscipline: 0.88,
    curiosity: 0.58,
    stressResilience: 0.85,
    checkSixRate: 0.58,
    repeekCaution: 0.76,
    reactionScale: 1.02,
    wanderScale: 0.88
  },
  TACTICIAN: {
    id: 'TACTICIAN',
    ja: '戦術タクティシャン',
    boldness: 0.60,
    patience: 0.70,
    flickSpeed: 1.02,
    burstDiscipline: 0.76,
    curiosity: 0.92,
    stressResilience: 0.78,
    checkSixRate: 0.88,
    repeekCaution: 0.68,
    reactionScale: 0.98,
    wanderScale: 0.95
  },
  SHARPSHOOTER: {
    id: 'SHARPSHOOTER',
    ja: '精密マークスマン',
    boldness: 0.52,
    patience: 0.80,
    flickSpeed: 1.05,
    burstDiscipline: 0.92,
    curiosity: 0.66,
    stressResilience: 0.80,
    checkSixRate: 0.52,
    repeekCaution: 0.72,
    reactionScale: 0.96,
    wanderScale: 0.84
  }
});

/** Select a distinct, memorable human persona based on callsign, weapon & slot. */
export function assignHumanArchetype(actor, rng) {
  const name = actor?.name || '';
  let base = HUMAN_ARCHETYPES.TACTICIAN;
  if (name === 'KAI' || name === 'RIN') base = HUMAN_ARCHETYPES.DUELIST;
  else if (name === 'NAGI' || name === 'SORA') base = HUMAN_ARCHETYPES.ANCHOR;
  else if (name === 'AO') base = HUMAN_ARCHETYPES.TACTICIAN;
  else if (actor?.gun === 'SW T' || actor?.gun === 'MS10') base = HUMAN_ARCHETYPES.SHARPSHOOTER;
  else {
    const list = Object.values(HUMAN_ARCHETYPES);
    base = list[(actor?.id || 0) % list.length];
  }
  const j = () => (rng ? (rng() - 0.5) * 0.12 : 0);
  return {
    ...base,
    boldness: clamp(base.boldness + j(), 0.2, 0.96),
    patience: clamp(base.patience + j(), 0.2, 0.96),
    flickSpeed: clamp(base.flickSpeed + j() * 0.6, 0.82, 1.24),
    burstDiscipline: clamp(base.burstDiscipline + j(), 0.35, 0.96),
    curiosity: clamp(base.curiosity + j(), 0.35, 0.98),
    checkSixRate: clamp(base.checkSixRate + j(), 0.25, 0.95),
    repeekCaution: clamp(base.repeekCaution + j(), 0.2, 0.92),
    habitSide: (rng ? rng() : 0.5) < 0.5 ? -1 : 1
  };
}

// ============================================================================
// 1. HumanMind: Yerkes-Dodson Arousal, Flow, Stress, Startle & Combat Habits
// ============================================================================
export class HumanMind {
  constructor(actor, rng, isNv21 = false) {
    this.rng = rng;
    this.isNv21 = !!isNv21;
    this.persona = assignHumanArchetype(actor, rng);

    // Continuous physiological & emotional states
    this.arousal = 0.28;        // 0..1 (optimal Flow zone: 0.45..0.72)
    this.stress = 0.08;         // 0..1 (suppression / panic > 0.68)
    this.confidence = 0.0;      // -1..+1 (kill momentum vs tilt/caution)
    this.exertion = 0.0;        // 0..1 (sprint fatigue -> heavier breath sway)
    this.startle = 0.0;         // 0..1 (acute flank ambush surprise)
    this.startleUntil = -10;
    this.startleYaw = 0;

    // Human combat micro-habits
    this.repeekCautiousUntil = -10;
    this.postKillReloadAt = -10;
    this.lastCombatAt = -10;
    this.strafePhase = 0;
    this.lastDamageBurst = 0;
    this.suppressionCount = 0;
    this.stateTag = '平常索敵';
  }

  reset() {
    this.arousal = 0.28;
    this.stress = 0.08;
    this.confidence *= 0.45; // carry mild match momentum across respawns like a real player!
    this.exertion = 0;
    this.startle = 0;
    this.startleUntil = -10;
    this.repeekCautiousUntil = -10;
    this.postKillReloadAt = -10;
    this.lastDamageBurst = 0;
    this.suppressionCount = 0;
    this.stateTag = '平常索敵';
  }

  /**
   * Yerkes-Dodson Inverted-U Performance Factor:
   * Returns 0.85..1.14 (higher = sharper "Flow State" zone; drops under extreme stress/panic).
   */
  getFlowFactor() {
    const opt = 1 - Math.abs(this.arousal - 0.56) * 0.45;
    const stressPenalty = Math.max(0, this.stress - 0.52) * 0.58;
    const confBoost = clamp(this.confidence, -0.5, 0.7) * 0.12;
    return clamp(0.86 + opt * 0.18 + confBoost - stressPenalty, 0.74, 1.15);
  }

  isInFlow() {
    return this.arousal >= 0.42 && this.arousal <= 0.78 && this.stress < 0.52 && this.confidence >= 0.08;
  }

  isStartled(t) {
    return t < this.startleUntil;
  }

  isSuppressed() {
    return this.stress > 0.64;
  }

  shouldHesitateRepeek(t) {
    return t < this.repeekCautiousUntil;
  }

  /** Variable asymmetric human A-D-A-D strafe cadence (non-metronomic!). */
  nextStrafeInterval(isSpy = false) {
    this.strafePhase = (this.strafePhase + 1) % 3;
    const base = isSpy ? 0.21 : 0.30;
    // Humans alternate shorter micro-jabs and slightly longer committed steps
    const rhythm = this.strafePhase === 1 ? 0.68 : this.strafePhase === 2 ? 1.24 : 0.96;
    const stressFast = 1 - this.stress * 0.22;
    return clamp((base + this.rng() * (isSpy ? 0.24 : 0.42)) * rhythm * stressFast, 0.16, 0.82);
  }

  /** Choose next strafe direction with subtle human handedness preference. */
  nextStrafeSign(prevSign) {
    const flipProb = 0.72 + (prevSign === this.persona.habitSide ? -0.08 : 0.08);
    return this.rng() < flipProb ? -prevSign : prevSign;
  }

  step(actor, dt, t, seenEnemy) {
    const speed = Math.hypot(actor.vx || 0, actor.vz || 0);
    const sprinting = (actor.sprintAmt || 0) > 0.4 && speed > 4.2;
    this.exertion = clamp(this.exertion + (sprinting ? 0.26 : -0.20) * dt, 0, 1);

    const engaged = !!seenEnemy || (t - this.lastCombatAt < 2.4);
    const targetArousal = seenEnemy ? 0.64 : engaged ? 0.48 : 0.26;
    this.arousal += (targetArousal - this.arousal) * (1 - Math.exp(-1.4 * dt));

    const resilience = this.persona.stressResilience * (this.isNv21 ? 1.22 : 1.0);
    const hpStress = actor.hp < 55 ? (55 - actor.hp) / 140 : 0;
    const targetStress = hpStress * (1.2 - resilience * 0.35);
    this.stress = clamp(this.stress + (targetStress - this.stress) * (1 - Math.exp(-(0.55 * resilience) * dt)), 0, 1);
    this.confidence *= Math.exp(-0.045 * dt);
    this.startle *= Math.exp(-5.2 * dt);
    this.lastDamageBurst = Math.max(0, this.lastDamageBurst - dt * 16);

    if (t < this.startleUntil) this.stateTag = '驚愕反応';
    else if (this.stress > 0.64) this.stateTag = '制圧警戒';
    else if (this.isInFlow()) this.stateTag = '集中フロー';
    else if (t < this.repeekCautiousUntil) this.stateTag = '再覗き牽制';
    else if (seenEnemy) this.stateTag = '交戦追従';
    else this.stateTag = '角クリア索敵';
  }

  onVisualContact(t) {
    this.lastCombatAt = t;
    this.arousal = clamp(this.arousal + 0.14, 0, 1);
  }

  onBulletWhiz(dist, t) {
    this.lastCombatAt = t;
    const closeness = clamp(1 - dist / 2.6, 0.15, 1);
    const res = this.persona.stressResilience * (this.isNv21 ? 1.25 : 1.0);
    this.stress = clamp(this.stress + (0.14 * closeness) / res, 0, 1);
    this.arousal = clamp(this.arousal + 0.12 * closeness, 0, 1);
    this.suppressionCount++;
  }

  onDamaged(actor, attacker, power, t, metrics, impactDir) {
    const quietFor = t - this.lastCombatAt;
    this.lastCombatAt = t;
    this.lastDamageBurst += power;
    const res = this.persona.stressResilience * (this.isNv21 ? 1.25 : 1.0);
    this.stress = clamp(this.stress + (0.16 + power * 0.015) / res, 0, 1);
    this.arousal = clamp(this.arousal + 0.22, 0, 1);
    this.confidence = clamp(this.confidence - 0.10 - power * 0.008, -1, 1);

    // Trigger authentic Human Re-Peek Hesitation if tagged hard while peeking!
    if (this.lastDamageBurst >= 15 || actor.shield <= 0) {
      const wait = (0.45 + this.rng() * 0.65) * (0.65 + this.persona.repeekCaution * 0.75) * (this.isNv21 ? 0.62 : 1.0);
      this.repeekCautiousUntil = Math.max(this.repeekCautiousUntil, t + wait);
    }

    // Check if ambushed from outside front ±52 deg attention cone -> HUMAN STARTLE REFLEX!
    if (attacker || impactDir) {
      const dx = attacker ? attacker.x - actor.x : -impactDir[0];
      const dz = attacker ? attacker.z - actor.z : -impactDir[2];
      const threatYaw = Math.atan2(dx, -dz);
      const angOff = Math.abs(angleDiff(threatYaw, actor.yaw));
      const surprise = angOff > 0.90 || (quietFor > 3.2 && angOff > 0.45);
      if (surprise && t > this.startleUntil + 0.65) {
        const freezeDur = (this.isNv21 ? 0.085 : 0.125) + this.rng() * (this.isNv21 ? 0.045 : 0.080);
        this.startle = clamp(0.62 + (angOff / Math.PI) * 0.38, 0.5, 1.0);
        this.startleUntil = t + freezeDur;
        this.startleYaw = threatYaw;
        if (metrics) metrics.humanStartles++;
        return {startled: true, freezeDur, threatYaw};
      }
    }
    return {startled: false, freezeDur: 0, threatYaw: actor.yaw};
  }

  onHitDealt(shieldBroken, t) {
    this.lastCombatAt = t;
    this.confidence = clamp(this.confidence + (shieldBroken ? 0.22 : 0.07), -1, 1);
    this.stress = Math.max(0, this.stress - (shieldBroken ? 0.14 : 0.04));
    this.arousal = clamp(this.arousal + 0.06, 0, 0.82);
  }

  onKill(t) {
    this.lastCombatAt = t;
    this.confidence = clamp(this.confidence + 0.36, -1, 1);
    this.stress = Math.max(0, this.stress - 0.24);
    // Classic human post-kill habit: brief check & reload behind cover if mag is depleted
    this.postKillReloadAt = t + 0.32 + this.rng() * 0.28;
  }
}

// ============================================================================
// 2. HumanVisionModel: Foveal / Parafoveal / Peripheral Visual Psychophysics
// ============================================================================
export class HumanVisionModel {
  constructor(rng, isNv21 = false) {
    this.rng = rng;
    this.isNv21 = !!isNv21;
    this.accum = new Map(); // enemyId -> {progress, lastUpdateAt, zone}
  }

  reset() {
    this.accum.clear();
  }

  /**
   * Accumulates realistic human visual recognition for a geometrically unobstructed enemy.
   * - Foveal (<=18 deg): fast recognition (~110-155ms)
   * - Parafoveal (18-42 deg): moderate (~165-245ms)
   * - Peripheral (42-78 deg): slow on stationary crouched targets, 2.4x faster on sprint or muzzle flash!
   * - Tunnel vision: slows peripheral detection of a 2nd enemy while dueling someone else.
   */
  evaluateSighting(actor, enemy, dt, t, mind, currentlyDuelingId = -1, metrics = null) {
    const dx = enemy.x - actor.x;
    const dz = enemy.z - actor.z;
    const dist = Math.hypot(dx, dz);
    const aimYaw = Math.atan2(dx, -dz);
    const ang = Math.abs(angleDiff(aimYaw, actor.yaw));

    // Close-quarters (<4.5m) spatial presence is noticed rapidly
    if (dist < 4.5 && ang < 1.65) {
      this.accum.set(enemy.id, {progress: 1, lastUpdateAt: t, zone: 'foveal'});
      return {recognized: true, zone: 'foveal', progress: 1, ang};
    }

    const maxFov = this.isNv21 ? 1.56 : 1.34; // ~89 deg half-angle NV2.1, ~77 deg NV2 Human
    if (ang > maxFov) {
      const prev = this.accum.get(enemy.id);
      if (prev) prev.progress = Math.max(0, prev.progress - dt * 2.5);
      return {recognized: false, zone: 'blind', progress: prev?.progress || 0, ang};
    }

    let zone = 'foveal';
    let baseTime = this.isNv21 ? 0.058 : 0.098; // Foveal (<=18 deg / 0.314 rad)
    if (ang > 0.73) {
      zone = 'peripheral';
      baseTime = this.isNv21 ? 0.145 : 0.255;
    } else if (ang > 0.314) {
      zone = 'parafoveal';
      baseTime = this.isNv21 ? 0.090 : 0.155;
    }

    // Human visual salience modifiers (motion, muzzle flash, close eye-contact, silhouette contrast, distance)
    const enemySpeed = Math.hypot(enemy.vx || 0, enemy.vz || 0);
    let salience = 1.0;
    if (zone === 'foveal' && dist < 20) salience *= 1.65;     // Dead-center close eye contact registers rapidly!
    if ((enemy.flash || 0) > 0.008) salience *= 2.55;         // Muzzle flash pops instantly!
    else if (enemySpeed > 3.6) salience *= 1.75;              // Sprinting motion catches peripheral eye!
    else if (enemySpeed < 0.7 && (enemy.crouch || 0) > 0.4 && zone === 'peripheral') {
      salience *= 0.52;                                       // Still crouched ambush blends in!
    }
    if (dist > 45) salience *= clamp(1 - (dist - 45) / 110, 0.55, 1.0);

    // Target fixation / Inattentional blindness when locked in a 1v1 duel!
    if (currentlyDuelingId >= 0 && currentlyDuelingId !== enemy.id && zone !== 'foveal') {
      salience *= (enemy.flash || 0) > 0.008 ? 0.92 : 0.64;
    }

    // Flow state & persona reaction tuning
    const flow = mind ? mind.getFlowFactor() : 1.0;
    const pScale = mind?.persona?.reactionScale || 1.0;
    const reqTime = Math.max(0.032, (baseTime * pScale) / (salience * flow));

    let entry = this.accum.get(enemy.id);
    if (!entry || t - entry.lastUpdateAt > 0.75) {
      entry = {progress: 0, lastUpdateAt: t, zone, missedCounted: false};
      this.accum.set(enemy.id, entry);
    }
    const stepDt = Math.min(0.18, Math.max(0.016, dt));
    entry.progress = clamp(entry.progress + stepDt / reqTime, 0, 1);
    entry.lastUpdateAt = t;
    entry.zone = zone;

    if (entry.progress < 1) {
      if (zone === 'peripheral' && !entry.missedCounted && metrics) {
        entry.missedCounted = true;
        metrics.humanPeripheralMisses++;
      }
      return {recognized: false, zone, progress: entry.progress, ang};
    }
    return {recognized: true, zone, progress: 1, ang};
  }

  decayUnseen(dt, t) {
    for (const [id, entry] of this.accum) {
      if (t - entry.lastUpdateAt > 0.35) {
        entry.progress = Math.max(0, entry.progress - dt * 1.6);
        if (entry.progress <= 0.01) this.accum.delete(id);
      }
    }
  }
}

// ============================================================================
// 3. HumanMotorAim: Two-Phase Fitts's Law / Minimum-Jerk Biomechanical Aim
//    (Full drop-in superset of HumanAimController!)
// ============================================================================
export class HumanMotorAim {
  constructor(rng, isNv21 = false, persona = null) {
    this.rng = rng;
    this.isNv21 = !!isNv21;
    this.persona = persona || HUMAN_ARCHETYPES.TACTICIAN;

    const rScale = this.persona.reactionScale || 1.0;
    const fScale = this.persona.flickSpeed || 1.0;
    const wScale = this.persona.wanderScale || 1.0;

    if (this.isNv21) {
      this.reactionDelay = (0.088 + rng() * 0.030) * rScale;
      this.acquireMin = 0.070;
      this.acquireMax = 0.124;
      this.maxYawRate = 9.8 * fScale;
      this.maxPitchRate = 7.2 * fScale;
      this.stiffness = 82.0;
      this.damping = 15.6;
      this.baseWander = 0.0064 * wScale;
      this.angVelErr = 0.021;
      this.leadSkill = 0.86 + rng() * 0.12;
      this.recoilScale = 0.58;
      this.bloomScale = 0.58;
      this.flinchScale = 0.46;
    } else {
      this.reactionDelay = (0.160 + rng() * 0.058) * rScale;
      this.acquireMin = 0.155;
      this.acquireMax = 0.265;
      this.maxYawRate = 7.4 * fScale;
      this.maxPitchRate = 5.4 * fScale;
      this.stiffness = 58.0;
      this.damping = 12.2;
      this.baseWander = 0.0098 * wScale;
      this.angVelErr = 0.032;
      this.leadSkill = 0.70 + rng() * 0.22;
      this.recoilScale = 0.88;
      this.bloomScale = 0.86;
      this.flinchScale = 0.90;
    }

    // Visual target memory ring-buffer (direct LOS only)
    this.targetId = -1;
    this.history = [];
    this.lastRecordAt = -10;
    this.lastSeenAt = -10;
    this.acquireReadyAt = 0;

    // Two-Phase Biomechanical Fitts's Law Minimum-Jerk Flick State
    this.motorPhase = 'TRACK'; // 'TRACK' | 'FLICK' | 'SETTLE'
    this.flickStartAt = -10;
    this.flickDur = 0.14;
    this.flickStartYaw = 0;
    this.flickStartPitch = 0;
    this.flickGoalYaw = 0;
    this.flickGoalPitch = 0;
    this.settleUntil = -10;

    // Spring-damper physical hand velocity (used during SETTLE / TRACK / scanning)
    this.velYaw = 0;
    this.velPitch = 0;

    // Ornstein-Uhlenbeck human wander + dynamic respiratory sway + stress tremor
    this.phaseA = rng() * 6.283;
    this.phaseB = rng() * 6.283;
    this.breathPhase = rng() * 6.283;
    this.wanderY = 0;
    this.wanderP = 0;
    this.wanderGoalY = (rng() - 0.5) * 1.1;
    this.wanderGoalP = (rng() - 0.5) * 0.8;
    this.wanderNextAt = 0;
    this.leadNoise = 0;
    this.leadNextAt = 0;

    // Human delayed recoil climb & active wrist pull-down compensation
    this.recoilY = 0;
    this.recoilP = 0;
    this.recoilCompP = 0;
    this.burstStartAt = -10;
    this.lastShotAt = -10;
    this.bloom = 0;
    this.flinchY = 0;
    this.flinchP = 0;
    this.lastTgtVx = 0;
    this.lastTgtVz = 0;
    this.strafeShock = 0;

    this.avgErrorRad = 0;
    this.samples = 0;
    this.flickCount = 0;
    this.overshootCount = 0;
  }

  reset(t = 0) {
    this.targetId = -1;
    this.history.length = 0;
    this.lastRecordAt = -10;
    this.lastSeenAt = -10;
    this.acquireReadyAt = t + 0.15;
    this.motorPhase = 'TRACK';
    this.velYaw = 0;
    this.velPitch = 0;
    this.recoilY = 0;
    this.recoilP = 0;
    this.recoilCompP = 0;
    this.bloom = 0;
    this.flinchY = 0;
    this.flinchP = 0;
    this.strafeShock = 0;
  }

  /**
   * Trigger a Phase-1 Minimum-Jerk Ballistic Primary Flick following Fitts's Law:
   *   T = a + b * log2(1 + angle / targetWidth)
   * with Harris & Wolpert signal-dependent motor noise (natural undershoot/overshoot!).
   */
  triggerBallisticFlick(curYaw, curPitch, targetYaw, targetPitch, t, stress = 0, startled = false, metrics = null) {
    const dy = angleDiff(targetYaw, curYaw);
    const dp = targetPitch - curPitch;
    const amp = Math.hypot(dy, dp);
    if (amp < 0.13) return false;

    const fScale = this.persona.flickSpeed || 1.0;
    const baseA = this.isNv21 ? 0.042 : 0.056;
    const baseB = this.isNv21 ? 0.048 : 0.068;
    const fittsDur = (baseA + baseB * Math.log2(1 + amp / 0.048)) / fScale;
    this.flickDur = clamp(fittsDur * (startled ? 0.88 : 1.0), 0.060, 0.28);

    // Harris & Wolpert signal-dependent endpoint scatter: larger flicks & startle produce realistic overshoot/undershoot!
    const noiseAmp = (this.isNv21 ? 0.055 : 0.092) * (1 + stress * 0.48 + (startled ? 0.60 : 0));
    const gainErr = 1 + (this.rng() * 2 - 1) * noiseAmp;
    if (Math.abs(gainErr - 1) > 0.048) {
      this.overshootCount++;
      if (metrics) metrics.humanOvershoots++;
    }
    const crossErr = (this.rng() - 0.5) * amp * noiseAmp * 0.42;

    this.motorPhase = 'FLICK';
    this.flickStartAt = t;
    this.flickStartYaw = curYaw;
    this.flickStartPitch = curPitch;
    this.flickGoalYaw = curYaw + dy * gainErr;
    this.flickGoalPitch = clamp(curPitch + dp * gainErr + crossErr, -0.88, 0.88);
    // Visual verification pause before Phase-2 micro-correction completes
    this.settleUntil = t + this.flickDur + (this.isNv21 ? 0.038 : 0.064) + this.rng() * 0.028;
    this.flickCount++;
    if (metrics) metrics.humanFlicks++;
    return true;
  }

  observeVisibleTarget(target, t, ambushPreAim = false) {
    const tp = targetPoint(target);
    const switched = target.id !== this.targetId;
    const reacquired = t - this.lastSeenAt > 0.55;

    if (switched || reacquired) {
      this.targetId = target.id;
      this.history.length = 0;
      const baseAcq = mix(this.acquireMin, this.acquireMax, this.rng());
      this.acquireReadyAt = t + (ambushPreAim ? baseAcq * 0.48 : baseAcq);
      this.wanderGoalY = (this.rng() - 0.5) * (this.isNv21 ? 1.1 : 1.5);
      this.wanderGoalP = (this.rng() - 0.5) * (this.isNv21 ? 0.8 : 1.1);
      this.lastTgtVx = target.vx || 0;
      this.lastTgtVz = target.vz || 0;
    }

    const dvx = (target.vx || 0) - this.lastTgtVx;
    const dvz = (target.vz || 0) - this.lastTgtVz;
    const accelJump = Math.hypot(dvx, dvz);
    if (!switched && accelJump > 2.5) {
      this.strafeShock = clamp(this.strafeShock + accelJump * (this.isNv21 ? 0.040 : 0.082), 0, 1.15);
    }
    this.lastTgtVx = target.vx || 0;
    this.lastTgtVz = target.vz || 0;

    if (t - this.lastRecordAt >= 0.014 || this.history.length === 0) {
      this.lastRecordAt = t;
      this.history.push({
        t,
        x: tp[0], y: tp[1], z: tp[2],
        vx: target.vx || 0, vy: target.vy || 0, vz: target.vz || 0,
        onGround: !!target.onGround
      });
      while (this.history.length > 36 || (this.history.length > 2 && t - this.history[0].t > 0.52)) {
        this.history.shift();
      }
    }
    this.lastSeenAt = t;
  }

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
          x: mix(a.x, b.x, u), y: mix(a.y, b.y, u), z: mix(a.z, b.z, u),
          vx: mix(a.vx, b.vx, u), vy: mix(a.vy, b.vy, u), vz: mix(a.vz, b.vz, u),
          onGround: u < 0.5 ? a.onGround : b.onGround
        };
      }
    }
    return h[0];
  }

  onShotFired(gun, isBursting = false, t = 0) {
    const gunKick = gun === 'MS10' ? 0.0068 : gun === 'D1' ? 0.0056 : gun === 'SRA' ? 0.0068 : gun === 'RD30' ? 0.0060 : 0.0084;
    const s = this.recoilScale;
    if (t - this.lastShotAt > 0.34) {
      this.burstStartAt = t;
      this.recoilCompP = 0;
    }
    this.lastShotAt = t;
    // Authentic upward kick + alternating horizontal spray drift
    this.recoilP = clamp(this.recoilP + gunKick * s * (0.72 + this.rng() * 0.58), -0.02, 0.052);
    this.recoilY = clamp(this.recoilY + (this.rng() - 0.5) * gunKick * 1.38 * s, -0.038, 0.038);
    this.bloom = clamp(this.bloom + (isBursting ? 0.0044 : 0.0030) * this.bloomScale, 0, 0.026);
  }

  onHitShock(power = 6, startled = false) {
    const mag = (0.0085 + power * 0.0014) * this.flinchScale * (startled ? 1.48 : 1.0);
    this.flinchP = clamp(this.flinchP + mag * (0.50 + this.rng() * 0.60), -0.06, 0.072);
    this.flinchY = clamp(this.flinchY + (this.rng() - 0.5) * mag * 2.2, -0.06, 0.06);
    this.strafeShock = clamp(this.strafeShock + (startled ? 0.55 : 0.32) * this.flinchScale, 0, 1.25);
  }

  onWhizShock() {
    const mag = 0.0052 * this.flinchScale;
    this.flinchY = clamp(this.flinchY + (this.rng() - 0.5) * mag * 1.7, -0.042, 0.042);
    this.flinchP = clamp(this.flinchP + (this.rng() - 0.35) * mag, -0.038, 0.042);
  }

  step(a, dt, t, opts) {
    const {
      seenTarget,
      wpn,
      fallbackYaw,
      fallbackPitch = 0,
      suppressPos = null,
      counterStrafing = false,
      dodging = false,
      backstabBonus = false,
      mind = null,
      metrics = null
    } = opts;

    const stress = mind ? mind.stress : 0.1;
    const exertion = mind ? mind.exertion : 0;
    const flow = mind ? mind.getFlowFactor() : 1.0;
    const startled = mind ? mind.isStartled(t) : false;

    // 1. Human Recoil Compensation with ~105ms visual-motor recognition lag!
    const spraying = t - this.lastShotAt < 0.28;
    const sprayAge = t - this.burstStartAt;
    if (spraying && sprayAge > 0.105) {
      // Human wrist actively pulls down to counter upward climb (76-90% human accuracy!)
      const pullSkill = (this.isNv21 ? 0.88 : 0.78) * flow;
      this.recoilCompP = mix(this.recoilCompP, this.recoilP * pullSkill, 1 - Math.exp(-11.0 * dt));
    } else if (!spraying) {
      this.recoilCompP *= Math.exp(-10.0 * dt);
    }

    const recDecay = Math.exp(-(this.isNv21 ? 11.5 : 8.8) * dt);
    this.recoilY *= recDecay;
    this.recoilP *= recDecay;
    this.bloom = Math.max(0, this.bloom - dt * (this.isNv21 ? 0.046 : 0.033));
    const flDecay = Math.exp(-(this.isNv21 ? 12.0 : 8.5) * dt);
    this.flinchY *= flDecay;
    this.flinchP *= flDecay;
    this.strafeShock *= Math.exp(-(this.isNv21 ? 5.6 : 3.9) * dt);

    // 2. Smooth OU Wander + Exertion-Modulated Breathing + Stress Physiological Tremor
    if (t >= this.wanderNextAt) {
      this.wanderGoalY = (this.rng() - 0.5) * 1.85;
      this.wanderGoalP = (this.rng() - 0.5) * 1.25;
      this.wanderNextAt = t + (this.isNv21 ? 0.14 + this.rng() * 0.15 : 0.18 + this.rng() * 0.24);
    }
    if (t >= this.leadNextAt) {
      this.leadNoise = (this.rng() - 0.5) * (this.isNv21 ? 0.19 : 0.34);
      this.leadNextAt = t + 0.30 + this.rng() * 0.36;
    }
    const wSmooth = 1 - Math.exp(-(this.isNv21 ? 6.8 : 4.8) * dt);
    this.wanderY += (this.wanderGoalY - this.wanderY) * wSmooth;
    this.wanderP += (this.wanderGoalP - this.wanderP) * wSmooth;

    // Breathing frequency rises smoothly from 0.28Hz (calm) to 0.58Hz (sprint/stressed)
    const breathHz = 0.28 + exertion * 0.18 + stress * 0.14;
    this.breathPhase += dt * breathHz * Math.PI * 2;
    const breathAmp = 1 + exertion * 0.55 + stress * 0.35;
    const breathY = (Math.sin(this.breathPhase + this.phaseA) * 0.16 + Math.sin(t * 5.2 + this.phaseB) * 0.06) * breathAmp;
    const breathP = (Math.cos(this.breathPhase + this.phaseB) * 0.17 + Math.sin(t * 4.4 + this.phaseA) * 0.06) * breathAmp;
    // High-adrenaline 7.8Hz micro-tremor when stress > 0.55
    const tremor = stress > 0.55 ? (stress - 0.55) * 0.0085 : 0;
    const tremorY = tremor * Math.sin(t * 49.0 + this.phaseA);
    const tremorP = tremor * Math.cos(t * 43.0 + this.phaseB);

    const eye = eyeOf(a);
    let idealYaw = fallbackYaw;
    let idealPitch = fallbackPitch;
    let dist = 25;
    let trueYaw = fallbackYaw;
    let truePitch = fallbackPitch;
    let readyToFire = false;
    let targetAngSpeed = 0;

    if (seenTarget) {
      const prevTgtId = this.targetId;
      this.observeVisibleTarget(seenTarget, t, backstabBonus);
      const perc = this.sampleDelayedTarget(t);

      const liveTp = targetPoint(seenTarget);
      const lrx = liveTp[0] - eye[0], lry = liveTp[1] - eye[1], lrz = liveTp[2] - eye[2];
      dist = Math.hypot(lrx, lry, lrz);
      trueYaw = Math.atan2(lrx, -lrz);
      truePitch = clamp(Math.atan2(lry, Math.hypot(lrx, lrz)), -0.78, 0.78);

      if (perc) {
        const pdx = perc.x - eye[0], pdy = perc.y - eye[1], pdz = perc.z - eye[2];
        const pHoriz = Math.max(0.8, Math.hypot(pdx, pdz));
        const pDist = Math.hypot(pdx, pdy, pdz);
        const perpVel = Math.abs((-pdz * perc.vx + pdx * perc.vz) / pHoriz);
        targetAngSpeed = perpVel / pHoriz;

        const leadT = clamp(pDist / Math.max(80, wpn.speed), 0, 0.38);
        const leadMul = clamp(this.leadSkill + this.leadNoise, 0.38, 1.06);
        const extrapT = this.reactionDelay * (this.isNv21 ? 0.84 : 0.72);
        const aimX = perc.x + perc.vx * (leadT * leadMul + extrapT);
        const aimY = perc.y + perc.vy * (leadT * 0.38 + extrapT * 0.25) + (perc.onGround ? 0 : 0.05);
        const aimZ = perc.z + perc.vz * (leadT * leadMul + extrapT);

        const rx = aimX - eye[0], ry = aimY - eye[1], rz = aimZ - eye[2];
        idealYaw = Math.atan2(rx, -rz);
        idealPitch = clamp(Math.atan2(ry, Math.hypot(rx, rz)), -0.78, 0.78);

        // Launch Phase-1 Fitts's Law Ballistic Primary Flick on target switch or large (>22 deg) flank turn!
        const errMag = Math.hypot(angleDiff(idealYaw, a.yaw), idealPitch - a.pitch);
        if ((prevTgtId !== seenTarget.id || errMag > 0.38) && this.motorPhase === 'TRACK' && errMag > 0.14) {
          this.triggerBallisticFlick(a.yaw, a.pitch, idealYaw, idealPitch, t, stress, startled, metrics);
        }

        const ownSpeed = Math.hypot(a.vx, a.vz);
        const moveMul = counterStrafing ? 0.70
          : !a.onGround ? 1.50
          : dodging ? (this.isNv21 ? 1.12 : 1.28)
          : (1 + clamp(ownSpeed / 5.2, 0, 1.1) * (this.isNv21 ? 0.20 : 0.28));
        const stanceMul = (1 - a.crouch * 0.22 - a.aimPose * 0.14) * (backstabBonus ? 0.74 : 1.0);
        const rangeMul = 0.86 + clamp((pDist - 12) / 48, 0, 0.42);
        const stressErr = targetAngSpeed * this.angVelErr + this.strafeShock * (this.isNv21 ? 0.010 : 0.017);
        const flowDiv = 1 / Math.max(0.75, flow);
        const errAmp = (this.baseWander * moveMul * stanceMul * rangeMul * flowDiv) + stressErr + this.bloom;

        const netRecoilP = Math.max(-0.014, this.recoilP - this.recoilCompP);
        idealYaw += (this.wanderY * 0.74 + breathY) * errAmp + this.recoilY + this.flinchY + tremorY;
        idealPitch = clamp(
          idealPitch + (this.wanderP * 0.62 + breathP) * errAmp * 0.68 + netRecoilP + this.flinchP + tremorP,
          -0.88, 0.88
        );

        // Humans hold fire during acute startle freeze and mid-ballistic-flick!
        readyToFire = t >= this.acquireReadyAt && !startled && this.motorPhase !== 'FLICK';
      }
    } else if (suppressPos) {
      const rx = suppressPos[0] - eye[0], ry = suppressPos[1] - eye[1], rz = suppressPos[2] - eye[2];
      dist = Math.hypot(rx, ry, rz);
      idealYaw = Math.atan2(rx, -rz) + (this.wanderY * 0.045 + this.recoilY);
      idealPitch = clamp(Math.atan2(ry, Math.hypot(rx, rz)) + (this.wanderP * 0.032 + Math.max(0, this.recoilP - this.recoilCompP)), -0.78, 0.78);
      trueYaw = idealYaw;
      truePitch = idealPitch;
      readyToFire = !startled;
    } else {
      if (t - this.lastSeenAt > 0.85) this.history.length = 0;
      if (this.motorPhase !== 'TRACK' && t >= this.settleUntil) this.motorPhase = 'TRACK';
    }

    // 3. Execute Biomechanical Two-Phase Control: Minimum-Jerk FLICK -> SETTLE -> Spring-Damper TRACK!
    if (this.motorPhase === 'FLICK') {
      const u = clamp((t - this.flickStartAt) / Math.max(0.04, this.flickDur), 0, 1);
      // Exact Minimum-Jerk Quintic Polynomial s(u) = 10u^3 - 15u^4 + 6u^5 (bell-shaped velocity!)
      const u2 = u * u, u3 = u2 * u;
      const s = u3 * (10 - 15 * u + 6 * u2);
      const ds = (30 * u2 * (1 - u) * (1 - u)) / Math.max(0.04, this.flickDur);
      const dYaw = angleDiff(this.flickGoalYaw, this.flickStartYaw);
      const dPitch = this.flickGoalPitch - this.flickStartPitch;
      a.yaw = this.flickStartYaw + dYaw * s;
      a.pitch = clamp(this.flickStartPitch + dPitch * s, -0.92, 0.92);
      this.velYaw = dYaw * ds * 0.35;
      this.velPitch = dPitch * ds * 0.35;
      if (u >= 1) this.motorPhase = 'SETTLE';
    } else {
      if (this.motorPhase === 'SETTLE' && t >= this.settleUntil) {
        this.motorPhase = 'TRACK';
      }
      const errY = angleDiff(idealYaw, a.yaw);
      const errP = idealPitch - a.pitch;
      const active = !!(seenTarget || suppressPos);
      const settleMul = this.motorPhase === 'SETTLE' ? 0.78 : 1.0;
      const kP = (active ? this.stiffness : this.stiffness * 0.56) * settleMul * flow;
      const kD = active ? this.damping : this.damping * 0.84;
      const maxY = (active ? this.maxYawRate : this.maxYawRate * 0.72) * (1 - a.aimPose * 0.08);
      const maxP = active ? this.maxPitchRate : this.maxPitchRate * 0.68;

      const sdt = Math.min(dt, 0.025);
      this.velYaw = clamp(this.velYaw + (kP * errY - kD * this.velYaw) * sdt, -maxY, maxY);
      this.velPitch = clamp(this.velPitch + (kP * errP - kD * this.velPitch) * sdt, -maxP, maxP);
      a.yaw += this.velYaw * dt;
      a.pitch = clamp(a.pitch + this.velPitch * dt, -0.92, 0.92);
    }

    const alignPerceived = Math.hypot(angleDiff(idealYaw, a.yaw), (idealPitch - a.pitch) * 0.8);
    const alignTrue = Math.hypot(angleDiff(trueYaw, a.yaw), (truePitch - a.pitch) * 0.8);
    if (seenTarget) {
      this.samples++;
      this.avgErrorRad += (alignTrue - this.avgErrorRad) * 0.04;
    }

    // Human burst-reset discipline: pause briefly when bloom/recoil climbs above persona comfort at range!
    const bloomCap = 0.014 + (1 - (this.persona.burstDiscipline || 0.7)) * 0.010;
    const wantBurstReset = this.bloom > bloomCap && dist > 22;
    const microSpread = ((this.isNv21 ? 0.0052 : 0.0090) + this.bloom * 0.34) / Math.max(0.8, flow);

    return {
      readyToFire,
      alignPerceived,
      alignTrue,
      dist,
      microSpread,
      targetAngSpeed,
      motorPhase: this.motorPhase,
      wantBurstReset
    };
  }
}

// ============================================================================
// 4. HumanGazeDirector: Corner-Slicing Pre-Aim, Acoustic Curiosity & Check-Six
// ============================================================================
export class HumanGazeDirector {
  constructor(rng, persona) {
    this.rng = rng;
    this.persona = persona || HUMAN_ARCHETYPES.TACTICIAN;
    this.nextSliceAt = 0;
    this.sliceYaw = 0;
    this.slicePitch = -0.015;
    this.soundFocusYaw = 0;
    this.soundFocusUntil = -10;
    this.checkSixYaw = 0;
    this.checkSixUntil = -10;
    this.nextCheckSixAt = 4.2 + rng() * 4.5;
  }

  reset(t = 0) {
    this.nextSliceAt = t;
    this.soundFocusUntil = -10;
    this.checkSixUntil = -10;
    this.nextCheckSixAt = t + 4.0 + this.rng() * 4.5;
  }

  /** Trigger natural acoustic curiosity head-turn toward arrived EchoPulse / knock sound. */
  onAcousticCue(actor, perceivedPos, t, isUrgent = false, metrics = null) {
    if (!perceivedPos) return;
    const dx = perceivedPos[0] - actor.x;
    const dz = perceivedPos[2] - actor.z;
    if (dx * dx + dz * dz < 1.5) return;
    if (!isUrgent && this.rng() > this.persona.curiosity) return;
    this.soundFocusYaw = Math.atan2(dx, -dz);
    this.soundFocusUntil = t + (isUrgent ? 1.15 : 0.65) + this.rng() * 0.45;
    if (metrics) metrics.humanCornerScans++;
  }

  /**
   * Computes natural human crosshair placement when no enemy is currently visible:
   *  1) Startle snap toward surprise threat
   *  2) Acoustic curiosity glance toward heard gunshot/footstep
   *  3) Post-peek corner hold on recently vanished enemy
   *  4) Periodic "check-six" / side-alley glance while traversing lanes
   *  5) Smart 5-ray corner-slicing pre-aim (stares down open corridors/corners, NEVER into walls!)
   */
  computeIdleGaze(actor, b, moveYaw, t, mind, metrics = null) {
    // 1. Acute startle whip toward surprise ambush bearing
    if (mind && mind.isStartled(t)) {
      return {yaw: mind.startleYaw, pitch: 0.0};
    }

    // 2. Acoustic curiosity look toward recently arrived sound
    if (t < this.soundFocusUntil) {
      return {yaw: this.soundFocusYaw, pitch: -0.01};
    }

    // 3. Post-peek corner hold (holds crosshair at chest/head height on enemy's vanishing corner for 1.2-2.4s)
    if (b.lastSeenTargetPos && t - (b.lastSeenTargetAt || -10) < (1.2 + this.persona.patience * 1.3)) {
      const dx = b.lastSeenTargetPos[0] - actor.x;
      const dz = b.lastSeenTargetPos[2] - actor.z;
      if (dx * dx + dz * dz > 2.0) {
        return {yaw: Math.atan2(dx, -dz), pitch: -0.01};
      }
    }

    // 4. Periodic human "check-six" / blind-alley flank glance!
    if (t < this.checkSixUntil) {
      return {yaw: this.checkSixYaw, pitch: -0.015};
    }
    if (t >= this.nextCheckSixAt && b.state !== '戦術退避') {
      const rate = this.persona.checkSixRate || 0.6;
      this.nextCheckSixAt = t + (4.2 + this.rng() * 5.2) / Math.max(0.35, rate);
      const side = this.rng() < 0.5 ? -1 : 1;
      this.checkSixYaw = moveYaw + side * (1.05 + this.rng() * 0.65); // 60..98 deg flank check
      this.checkSixUntil = t + 0.28 + this.rng() * 0.18;
      if (metrics) metrics.humanCheckSix++;
      return {yaw: this.checkSixYaw, pitch: -0.015};
    }

    // 5. Smart 5-Ray Corner-Slicing Pre-Aim (runs at ~4 Hz -> zero CPU overhead!)
    if (t >= this.nextSliceAt) {
      this.nextSliceAt = t + 0.24 + this.rng() * 0.08;
      const eye = eyeOf(actor);
      const baseYaw = b.lastPos
        ? mixAngle(moveYaw, Math.atan2(b.lastPos[0] - actor.x, -(b.lastPos[1] - actor.z)), 0.45)
        : moveYaw;
      const offsets = [-0.58, -0.28, 0, 0.28, 0.58];
      let bestYaw = baseYaw;
      let bestScore = -1;
      for (let i = 0; i < offsets.length; i++) {
        const y = baseYaw + offsets[i];
        const end = [eye[0] + Math.sin(y) * 18, eye[1], eye[2] - Math.cos(y) * 18];
        const hit = raycastMaterial(eye, end);
        const clearDist = hit ? hit.t * 18 : 18;
        // Favor deep open sightlines & slight bias toward travel direction (never stare at a close wall!)
        const sc = clearDist - Math.abs(offsets[i]) * 2.2;
        if (sc > bestScore) {
          bestScore = sc;
          bestYaw = y;
        }
      }
      this.sliceYaw = bestYaw;
      this.slicePitch = -0.015 + (this.rng() - 0.5) * 0.025;
      if (metrics) metrics.humanCornerScans++;
    }
    return {yaw: this.sliceYaw, pitch: this.slicePitch};
  }
}

function mixAngle(a, b, t) {
  return a + angleDiff(b, a) * t;
}

// ============================================================================
// 5. HumanCommsRelay: Delayed Human Squad Callouts (0.38-0.72s Voice Latency)
// ============================================================================
export class HumanCommsRelay {
  constructor(rng) {
    this.rng = rng;
    this.queue = []; // {team, callerId, enemyId, x, z, kind, deliverAt}
    this.lastCallByActor = new Map();
  }

  emitCallout(team, callerId, enemyId, x, z, kind, t, metrics = null) {
    const last = this.lastCallByActor.get(callerId) || -10;
    if (t - last < (kind === 'ambush' ? 0.9 : 1.4)) return false;
    this.lastCallByActor.set(callerId, t);

    // Human voice callout delay (380-720ms) + natural spatial fuzz (±1.3-2.5m like "左コンテナ裏！")
    const delay = 0.38 + this.rng() * 0.34;
    const fuzz = 1.3 + this.rng() * 1.2;
    const ang = this.rng() * Math.PI * 2;
    this.queue.push({
      team,
      callerId,
      enemyId,
      x: clamp(x + Math.cos(ang) * fuzz, -23, 23),
      z: clamp(z + Math.sin(ang) * fuzz, -96, 96),
      kind,
      deliverAt: t + delay
    });
    if (this.queue.length > 24) this.queue.shift();
    if (metrics) metrics.humanCallouts++;
    return true;
  }

  drainReady(team, t) {
    const out = [];
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].team === team && this.queue[i].deliverAt <= t) {
        out.push(this.queue[i]);
        this.queue.splice(i, 1);
      }
    }
    return out;
  }
}
