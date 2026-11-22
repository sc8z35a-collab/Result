// ============================================================================
// NV2.5 humain — Next-Generation Embodied Cognitive-Neuroscience Human AI
// ============================================================================
// Built directly on top of NV 2.4 Manusia (`dist/js/nv24-manusia.js`) and
// NV2.3 HUMAN (`dist/js/nv23-human.js`) so `instanceof Human*V23` and
// `instanceof Manusia*V24` remain 100% preserved while enabling genuine
// 4-generation A/B/C/D benchmarking (humain vs manusia vs nv23 vs classic).
//
// 100% FAIR-PLAY GUARANTEE:
//   ZERO wallhack, ZERO aimbot, ZERO hidden enemy HP/mag/reload reads,
//   ZERO 0ms telepathy. Every belief, decision, gaze saccade, submovement,
//   mouse-lift stroke, bait trap, and squad swing derives strictly from
//   fair-play LOS, 343 m/s EchoPulse acoustics, bullet-whiz reverse vectors,
//   public weapon specs, and latency-delayed voice callouts.
//
// 8 REVOLUTIONARY HUMAN-SIMULATION CORES:
//   1. HumainActiveInferenceV25  — Karl Friston Free-Energy Spatial Belief,
//                                  6-Zone Subjective Epistemic Entropy, Overdue
//                                  Flank Intuition & Prediction-Error Surprise
//   2. HumainDecisionDDM_V25     — Ratcliff Drift-Diffusion Evidence Accumulator,
//                                  Collapsing Urgency Bounds, Ambiguity Hesitation
//                                  & Resulaj Mid-Motion Change-of-Mind (CoM)
//   3. HumainAffectivePsycheV25  — Blascovich Challenge-vs-Threat Biopsychosocial
//                                  Appraisal, Allostatic Load & Deep-Breath Reset,
//                                  Hot-Hand Momentum, Nemesis Tactical Respect,
//                                  Acoustic Startle Freeze & Emotional Contagion
//   4. HumainMetaMindV25         — Self-Habit Anti-Pattern Conditioning (Mix-Ups),
//                                  Per-Enemy Greed/Camp Profiling, Wounded Bait
//                                  Traps & Post-Kill Trade-Check Ritual
//   5. HumainMultisensoryV25     — Cross-Modal Audio-Visual Super-Additive Fusion,
//                                  Static Off-Angle Camouflage Realism & Epistemic
//                                  Surprise Coupling
//   6. HumainSensorimotorV25     — Oculomotor Eye-First / Hand-Follows Lead,
//                                  2-Stroke Mouse-Lift 180-deg Whip, Henneman
//                                  Torque-Scaled Motor Noise, Spray-Stop Recoil
//                                  Overpull & Crosshair-Placement Intercept Fire
//   7. HumainFixationGazeV25     — Discrete Fixation-Saccade Scan Rhythm, Active-
//                                  Inference High-Entropy Lane Glances, Post-Kill
//                                  Trade-Check Gaze & Expressive Buddy Glances
//   8. HumainEmbodiedTacticsV25  — Non-Periodic Asymmetric Strafe Choreography,
//      & HumainSocialMindV25       Synchronized Squad Double-Swing (SWING_NOW),
//                                  Bait-and-Switch (BAIT_READY), Human-Player
//                                  Push Mirroring & Expressive 16-Bone Posture
// ============================================================================

import {clamp, mix} from './geometry.js';
import {raycastMaterial, walkable} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';
import {
  HUMAN_ARCHETYPES,
  WEAPON_RECOIL_PROFILE,
  PEEK_STYLES
} from './nv23-human.js';
import {
  CALLSIGN_PROFILES_V24,
  COMMS_CHANNELS_V24,
  ManusiaSomaPsycheV24,
  ManusiaTheoryOfMindV24,
  ManusiaPerceptionV24,
  ManusiaNeuromotorAimV24,
  ManusiaGazeV24,
  ManusiaTacticsV24,
  ManusiaSocialSquadV24
} from './nv24-manusia.js';

export const NV25_HUMAIN_VERSION = 'NV2.5 humain';
export {HUMAN_ARCHETYPES, WEAPON_RECOIL_PROFILE, PEEK_STYLES};

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function mixAngle(a, b, t) {
  return a + angleDiff(b, a) * t;
}

// 16-Dimensional Living Callsign Personalities (adding epistemicCuriosity & composureRecovery!)
const HUMAIN_EXTRAS = Object.freeze({
  NAGI: Object.freeze({epistemicCuriosity: 0.90, composureRecovery: 0.86, ddmBound: 0.84, mixupIQ: 0.92}),
  KAI:  Object.freeze({epistemicCuriosity: 0.82, composureRecovery: 0.92, ddmBound: 0.96, mixupIQ: 0.84}),
  RIN:  Object.freeze({epistemicCuriosity: 0.86, composureRecovery: 0.94, ddmBound: 1.02, mixupIQ: 0.86}),
  SORA: Object.freeze({epistemicCuriosity: 0.88, composureRecovery: 0.80, ddmBound: 0.82, mixupIQ: 0.90}),
  AO:   Object.freeze({epistemicCuriosity: 0.84, composureRecovery: 0.88, ddmBound: 0.92, mixupIQ: 0.88})
});

export const CALLSIGN_PROFILES_V25 = Object.freeze(
  Object.fromEntries(
    Object.entries(CALLSIGN_PROFILES_V24).map(([k, v]) => [k, Object.freeze({...v, ...(HUMAIN_EXTRAS[k] || {})})])
  )
);

// 10-Channel Stress-Modulated Delayed Squad Voice Comms (+ BAIT_READY & SWING_NOW!)
export const COMMS_CHANNELS_V25 = Object.freeze({
  ...COMMS_CHANNELS_V24,
  BAIT_READY: 'BAIT_READY',
  SWING_NOW: 'SWING_NOW'
});

// 6 Harbor Macro-Zones for Subjective Active-Inference Epistemic Belief (Zero-GC fixed tables!)
// 0: South-West (-12, +45), 1: South-East (+12, +45)
// 2: Mid-West   (-13,   0), 3: Mid-East   (+13,   0)
// 4: North-West (-12, -45), 5: North-East (+12, -45)
const ZONE_CENTERS_X = new Float32Array([-12, 12, -13, 13, -12, 12]);
const ZONE_CENTERS_Z = new Float32Array([45, 45, 0, 0, -45, -45]);
const ZONE_COUNT = 6;

function posToZone(x, z) {
  const col = x >= 0 ? 1 : 0;
  const row = z > 22 ? 0 : z < -22 ? 2 : 1;
  return row * 2 + col;
}

// ============================================================================
// CORE 1. HumainActiveInferenceV25: Karl Friston Free-Energy Spatial Belief,
//         6-Zone Epistemic Entropy, Overdue Flank Intuition & Surprise
// ============================================================================
export class HumainActiveInferenceV25 {
  constructor(rng, persona = null) {
    this.rng = rng;
    this.persona = persona || {};
    // Subjective probability mass P(unseen threat in zone i) & epistemic entropy H_i (0=just cleared, 1=unknown)
    this.prior = new Float32Array(ZONE_COUNT);
    this.entropy = new Float32Array(ZONE_COUNT);
    this.lastClearedAt = new Float32Array(ZONE_COUNT);
    this.epistemicUrgency = 0.35; // Global Free-Energy info-seeking pressure (0..1)
    this.lastSurprise = 0;        // Last visual/acoustic prediction error (0..1)
    this.lastSurpriseAt = -10;
    this.lastForageAt = -10;
    this.reset(0, 0);
  }

  reset(t = 0, team = 0) {
    for (let i = 0; i < ZONE_COUNT; i++) {
      // Fair-play initial tactical prior: enemies start on the opposite side of the harbor!
      const isEnemyHalf = team === 0 ? i >= 4 : i <= 1;
      const isMid = i === 2 || i === 3;
      this.prior[i] = isEnemyHalf ? 0.32 : isMid ? 0.14 : 0.04;
      this.entropy[i] = isEnemyHalf ? 0.85 : isMid ? 0.65 : 0.25;
      this.lastClearedAt[i] = t - (isEnemyHalf ? 8 : 2);
    }
    this.epistemicUrgency = 0.35;
    this.lastSurprise = 0;
    this.lastSurpriseAt = -10;
    this.lastForageAt = -10;
  }

  /**
   * 360Hz-normalized Free-Energy belief evolution:
   *  - Entropy gradually grows in unseen zones (hidden enemies could rotate!)
   *  - Looking down a zone's bearing clears its local entropy (100% fair-play cone check!)
   *  - Probability mass diffuses organically across adjacent West/East/Mid harbor lanes.
   */
  step(actor, dt, t, seenEnemy) {
    const yaw = actor.yaw;
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    const myZone = posToZone(actor.x, actor.z);

    // Clear the zone we're physically occupying if no threat spotted here
    if (!seenEnemy) {
      this.entropy[myZone] = Math.max(0.06, this.entropy[myZone] - dt * 0.42);
      this.prior[myZone] = Math.max(0.02, this.prior[myZone] - dt * 0.18);
      this.lastClearedAt[myZone] = t;
    }

    let entSum = 0;
    let maxP = 0.001;
    for (let i = 0; i < ZONE_COUNT; i++) {
      const dx = ZONE_CENTERS_X[i] - actor.x;
      const dz = ZONE_CENTERS_Z[i] - actor.z;
      const dist = Math.hypot(dx, dz) || 1;
      const dot = (dx * fx + dz * fz) / dist;

      if (!seenEnemy && dot > 0.78 && dist < 44) {
        // Actor is actively scanning toward zone i -> epistemic entropy drops!
        this.entropy[i] = Math.max(0.08, this.entropy[i] - dt * 0.30);
        this.prior[i] = Math.max(0.03, this.prior[i] - dt * 0.07);
        this.lastClearedAt[i] = t;
      } else {
        // Unwatched zone grows uncertain over time (enemy could be flanking!)
        const growth = (0.045 + (this.persona.epistemicCuriosity || 0.85) * 0.028) * dt;
        this.entropy[i] = Math.min(1.0, this.entropy[i] + growth);
        this.prior[i] = clamp(this.prior[i] + (0.167 - this.prior[i]) * dt * 0.055, 0.02, 0.92);
      }
      entSum += this.entropy[i] * (0.45 + this.prior[i]);
      if (this.prior[i] > maxP) maxP = this.prior[i];
    }

    // Normalize prior gently toward sum ~ 1.0
    const sumP = this.prior[0] + this.prior[1] + this.prior[2] + this.prior[3] + this.prior[4] + this.prior[5];
    if (sumP > 0.01) {
      const inv = 1 / sumP;
      for (let i = 0; i < ZONE_COUNT; i++) this.prior[i] *= inv;
    }

    const targetUrgency = seenEnemy ? 0.12 : clamp(entSum / 2.6, 0.12, 1.0);
    this.epistemicUrgency += (targetUrgency - this.epistemicUrgency) * (1 - Math.exp(-1.8 * dt));
    if (t - this.lastSurpriseAt > 2.2) {
      this.lastSurprise *= Math.exp(-1.5 * dt);
    }
  }

  /** Fair-play observation update (visual contact, EchoPulse sound, whiz corridor, or delayed callout!). */
  observeEvidence(x, z, weight = 0.55, t = 0) {
    const zIdx = posToZone(x, z);
    // Compute Karl Friston Prediction Error (Surprise = -log-like mismatch from subjective prior!)
    const expected = this.prior[zIdx];
    const surprise = clamp((1 - expected * 2.4) * weight, 0, 1);
    if (weight >= 0.45) {
      this.lastSurprise = Math.max(this.lastSurprise * 0.5, surprise);
      this.lastSurpriseAt = t;
    }
    this.prior[zIdx] = clamp(this.prior[zIdx] + weight * 0.42, 0.04, 0.95);
    this.entropy[zIdx] = Math.max(0.05, this.entropy[zIdx] * (1 - weight * 0.65));
    return surprise;
  }

  /** Delayed FLANK_CLEAR callout collapses subjective threat prior in the cleared corridor! */
  observeFlankClear(x, z, t = 0) {
    const zIdx = posToZone(x, z);
    this.prior[zIdx] *= 0.35;
    this.entropy[zIdx] = Math.min(this.entropy[zIdx], 0.18);
    this.lastClearedAt[zIdx] = t;
  }

  /**
   * Expected Free-Energy Gaze Selection:
   * Picks the harbor zone with the highest Expected Information Gain (`entropy * (0.35 + prior) * overdue`)
   * within natural look distance so the human checks overdue blind lanes instead of staring at cleared walls!
   */
  selectEpistemicLook(actor, t, metrics = null) {
    if (this.epistemicUrgency < 0.36) return null;
    let bestIdx = -1;
    let bestGain = 0.24;
    const myZone = posToZone(actor.x, actor.z);

    for (let i = 0; i < ZONE_COUNT; i++) {
      if (i === myZone) continue;
      const dx = ZONE_CENTERS_X[i] - actor.x;
      const dz = ZONE_CENTERS_Z[i] - actor.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 10 || dist > 96) continue;
      const stale = clamp((t - this.lastClearedAt[i]) / 8.5, 0.15, 1.35);
      const distW = clamp(1.18 - dist / 115, 0.32, 1.0);
      const gain = this.entropy[i] * (0.35 + this.prior[i] * 1.45) * stale * distW;
      if (gain > bestGain) {
        bestGain = gain;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return null;

    const tx = ZONE_CENTERS_X[bestIdx];
    const tz = ZONE_CENTERS_Z[bestIdx];
    const yaw = Math.atan2(tx - actor.x, -(tz - actor.z));
    if (t - this.lastForageAt > 1.35) {
      this.lastForageAt = t;
      if (metrics) metrics.humainEpistemicScans++;
    }
    return {zone: bestIdx, yaw, x: tx, z: tz, gain: bestGain};
  }
}

// ============================================================================
// CORE 2. HumainDecisionDDM_V25: Ratcliff Drift-Diffusion Evidence Accumulator,
//         Collapsing Urgency Bounds, Ambiguity Hesitation & Change-of-Mind (CoM)
// ============================================================================
export class HumainDecisionDDM_V25 {
  constructor(rng, persona = null) {
    this.rng = rng;
    this.persona = persona || {};
    this.evCommit = 0;            // Continuous evidence for aggressive push/peek (-1..+1)
    this.evRetreat = 0;           // Continuous evidence for defensive reset (-1..+1)
    this.decision = 'HOLD';       // 'COMMIT' | 'HOLD' | 'RETREAT'
    this.prevDecision = 'HOLD';
    this.decisionAt = -10;
    this.hesitateUntil = -10;     // Brief human micro-hesitation on conflicting cues!
    this.comAbortUntil = -10;     // Resulaj Mid-Motion Change-of-Mind abort window!
    this.lastComAt = -10;
    this.lastHesitateAt = -10;
  }

  reset(t = 0) {
    this.evCommit = 0;
    this.evRetreat = 0;
    this.decision = 'HOLD';
    this.prevDecision = 'HOLD';
    this.decisionAt = t;
    this.hesitateUntil = -10;
    this.comAbortUntil = -10;
  }

  /**
   * Integrate noisy continuous Drift-Diffusion evidence (strictly 100% fair-play sensory inputs!):
   *   dx = v(t)*dt + sigma*sqrt(dt)*noise
   * Detects:
   *  1. Ambiguity Hesitation (conflicting commit & retreat evidence -> brief 0.12-0.22s micro-pause)
   *  2. Resulaj Mid-Motion Change-of-Mind (was actively pushing/committing when sudden 2nd enemy,
   *     heavy tag, or threat appraisal flips evidence -> clean mid-step abort back to cover!)
   */
  step(actor, b, dt, t, mind, tom, metrics = null) {
    const hpRatio = clamp((actor.hp + (actor.shield || 0) * 0.8 + (actor.baizerShield || 0) * 0.6) / 125, 0, 1);
    const visCount = b.visibleEnemies ? b.visibleEnemies.length : (b.seen ? 1 : 0);
    const underFire = t - (b.underFireAt || -10) < 0.85;
    const challenge = mind?.challengeBalance ?? 0;
    const hotHand = mind?.hotHand ?? 0;
    const shieldWin = (tom && b.targetId >= 0) ? tom.getEnemyShieldWindow(b.targetId, t) : 0;
    const ammoSoon = (tom && b.targetId >= 0) ? tom.predictEnemyReloadSoon(b.targetId, t).imminent : false;
    const preAimRisk = tom ? tom.getEnemyPreAimRisk(actor, t) : 0;

    // 1. Continuous Drift Rates v_commit & v_retreat
    let vCommit = 0;
    vCommit += (hpRatio - 0.52) * 1.10;
    vCommit += challenge * 0.45 + hotHand * 0.35;
    if (shieldWin > 0.5) vCommit += 0.85;
    if (ammoSoon) vCommit += 0.72;
    if (b.tradeTargetPos && t < (b.tradeSwingUntil || -10)) vCommit += 0.90;
    if (visCount >= 2) vCommit -= 1.25;
    if (preAimRisk > 0.58) vCommit -= 0.55;
    if (underFire && actor.hp < 58) vCommit -= 1.35;

    let vRetreat = 0;
    vRetreat += (0.58 - hpRatio) * 1.65;
    if (visCount >= 2 && actor.hp < 82) vRetreat += 1.10;
    if (underFire && (b.recentDamage || 0) >= 18) vRetreat += 1.25;
    if (actor.mag <= 3 || actor.reload > 0) vRetreat += 0.95;
    if (mind?.isSuppressed?.()) vRetreat += 0.75;
    vRetreat -= challenge * 0.35 + (shieldWin > 1.0 && actor.hp > 60 ? 0.50 : 0);

    // 2. Leaky Drift-Diffusion integration with realistic neural noise
    const noiseScale = 0.24 * Math.sqrt(Math.max(0.002, dt));
    const n1 = (this.rng() + this.rng() - 1.0) * noiseScale;
    const n2 = (this.rng() + this.rng() - 1.0) * noiseScale;
    const leak = Math.exp(-1.75 * dt);
    this.evCommit = clamp(this.evCommit * leak + vCommit * dt + n1, -1.2, 1.3);
    this.evRetreat = clamp(this.evRetreat * leak + vRetreat * dt + n2, -1.2, 1.3);

    // 3. Collapsing Urgency Bound (low HP or match point shrinks threshold for crisp survival instincts!)
    const baseBound = this.persona.ddmBound || 0.90;
    const urgencyCollapse = (actor.hp < 48 ? 0.24 : 0) + (mind?.matchPointIntensity || 0) * 0.10;
    const bound = Math.max(0.46, baseBound - urgencyCollapse);

    // 4. Decision Crossing & Mid-Motion Change-of-Mind (Resulaj et al. 2009)!
    this.prevDecision = this.decision;
    let next = this.decision;
    if (this.evRetreat >= bound) {
      next = 'RETREAT';
    } else if (this.evCommit >= bound && this.evRetreat < bound * 0.65) {
      next = 'COMMIT';
    } else if (Math.abs(this.evCommit) < bound * 0.45 && Math.abs(this.evRetreat) < bound * 0.45) {
      next = 'HOLD';
    }

    // Mid-Motion Change-of-Mind: was actively committing/pushing, then sudden counter-evidence flips to RETREAT!
    const wasCommitting = this.prevDecision === 'COMMIT'
      || b.state === '一斉突入' || b.state === 'トレード突入' || b.state === '前進展開' || b.peekPhase === 'peek';
    if (wasCommitting && next === 'RETREAT' && t - this.lastComAt > 2.4 && (visCount >= 2 || (underFire && actor.hp < 72))) {
      this.comAbortUntil = t + 0.55;
      this.lastComAt = t;
      if (metrics) metrics.humainChangeOfMinds++;
    }

    // Authentic Human Micro-Hesitation when Commit & Retreat evidence collide near boundary!
    const conflict = this.evCommit > 0.34 && this.evRetreat > 0.34 && Math.abs(this.evCommit - this.evRetreat) < 0.22;
    if (conflict && !underFire && t - this.lastHesitateAt > 3.8 && t > this.hesitateUntil) {
      this.hesitateUntil = t + 0.13 + this.rng() * 0.10;
      this.lastHesitateAt = t;
      if (metrics) metrics.humainHesitations++;
    }

    if (next !== this.decision) {
      this.decision = next;
      this.decisionAt = t;
    }

    return {
      decision: this.decision,
      hesitating: t < this.hesitateUntil,
      changeOfMindAbort: t < this.comAbortUntil
    };
  }
}

// ============================================================================
// CORE 3. HumainAffectivePsycheV25: Blascovich Challenge-vs-Threat Appraisal,
//         Allostatic Load & Deep-Breath Reset, Hot-Hand Momentum, Nemesis
//         Tactical Respect, Acoustic Startle Freeze & Emotional Contagion
// ============================================================================
export class HumainAffectivePsycheV25 extends ManusiaSomaPsycheV24 {
  constructor(actor, rng, isNv21 = false) {
    super(actor, rng, isNv21);
    const key = actor?.name ? String(actor.name).toUpperCase() : '';
    const extra = HUMAIN_EXTRAS[key] || {
      epistemicCuriosity: 0.80 + rng() * 0.14,
      composureRecovery: 0.80 + rng() * 0.15,
      ddmBound: 0.84 + rng() * 0.18,
      mixupIQ: 0.80 + rng() * 0.14
    };
    this.persona = {...this.persona, ...extra};

    // Biopsychosocial Affective State
    this.challengeBalance = 0.15;    // -1 (Threat/Tilt) .. +1 (Challenge/Zone)
    this.allostaticLoad = 0;         // 0..1 cumulative mental battle fatigue
    this.hotHand = 0;                // 0..1 kill-streak confidence momentum
    this.startleFreezeUntil = -10;   // Brief 60-105ms acoustic startle motor arrest
    this.calmLullAccum = 0;          // Quiet recovery seconds -> triggers Deep-Breath Reset!
    this.lastBreathResetAt = -10;
    this.killStreak = 0;
    this.deathStreak = 0;
    this.nemesisRespectMap = new Map(); // enemyId -> tactical respect (0..1)
  }

  reset() {
    super.reset();
    this.startleFreezeUntil = -10;
    this.calmLullAccum = 0;
    // Allostatic load & challenge balance soften slightly on respawn while keeping match narrative!
    this.allostaticLoad *= 0.45;
    this.hotHand *= 0.25;
  }

  getNemesisRespect(enemyId) {
    return this.nemesisRespectMap.get(enemyId) || 0;
  }

  isStartleFrozen(t) {
    return t < this.startleFreezeUntil;
  }

  /** Trigger brief physiological acoustic startle freeze ONLY on genuine blind-side unexpected shocks! */
  onUnexpectedShock(surprise, t) {
    if (surprise < 0.68 || t < this.startleFreezeUntil + 2.4) return false;
    const freezeDur = (this.isNv21 ? 0.042 : 0.058) + (surprise - 0.68) * 0.045;
    this.startleFreezeUntil = t + freezeDur;
    this.stress = clamp(this.stress + 0.14 * surprise, 0, 1);
    this.challengeBalance = clamp(this.challengeBalance - 0.14 * surprise, -1, 1);
    return true;
  }

  /** Emotional contagion from calm veteran or distressed teammate callout! */
  onEmotionalContagion(kind, senderComposure = 0.85, close = false) {
    const scale = close ? 1.0 : 0.45;
    if (kind === 'reassure' || kind === 'ally_kill') {
      this.stress = Math.max(0, this.stress - 0.07 * senderComposure * scale);
      this.challengeBalance = clamp(this.challengeBalance + 0.12 * scale, -1, 1);
    } else if (kind === 'ally_death' || kind === 'ambush_cry') {
      this.stress = clamp(this.stress + 0.11 * scale, 0, 1);
      this.challengeBalance = clamp(this.challengeBalance - 0.14 * scale, -1, 1);
    }
  }

  onDamaged(actor, attacker, power, t, metrics = null, impactDir = null) {
    const res = super.onDamaged(actor, attacker, power, t, metrics, impactDir);
    this.allostaticLoad = clamp(this.allostaticLoad + power * 0.0045, 0, 1);
    this.challengeBalance = clamp(this.challengeBalance - power * 0.006, -1, 1);
    this.calmLullAccum = 0;
    if (res?.startled) {
      this.onUnexpectedShock(0.68, t);
    }
    return res;
  }

  onKill(t, victim = null, metrics = null) {
    super.onKill(t, victim, metrics);
    this.killStreak++;
    this.deathStreak = 0;
    this.hotHand = clamp(this.hotHand + 0.42, 0, 1);
    this.challengeBalance = clamp(this.challengeBalance + 0.34, -1, 1);
    this.allostaticLoad = Math.max(0, this.allostaticLoad - 0.14);
  }

  onDeath(actor, killer, t, traumaPos = undefined) {
    super.onDeath(actor, killer, t, traumaPos);
    this.killStreak = 0;
    this.deathStreak++;
    this.hotHand = 0;
    this.challengeBalance = clamp(this.challengeBalance - 0.36, -1, 1);
    if (killer && killer.id !== undefined) {
      const prev = this.nemesisRespectMap.get(killer.id) || 0;
      this.nemesisRespectMap.set(killer.id, clamp(prev + 0.42, 0, 1));
    }
  }

  /** Supply tanker resupply / calm lull triggers restorative Deep-Breath Composure Reset! */
  triggerBreathReset(t, metrics = null) {
    if (t - this.lastBreathResetAt < 6.5) return false;
    this.lastBreathResetAt = t;
    this.allostaticLoad = Math.max(0, this.allostaticLoad - 0.36);
    this.stress = Math.max(0.05, this.stress * 0.62);
    this.challengeBalance = clamp(this.challengeBalance + 0.22, -1, 1);
    this.calmLullAccum = 0;
    if (metrics) metrics.humainBreathResets++;
    return true;
  }

  getFlowFactor() {
    const base = super.getFlowFactor();
    // Blascovich Biopsychosocial Model: Challenge state channels arousal productively; Threat/Allostatic load dampens!
    const appraisalMod = this.challengeBalance > 0
      ? this.challengeBalance * 0.036 + this.hotHand * 0.022
      : this.challengeBalance * 0.035;
    const loadPenalty = this.allostaticLoad > 0.62 ? (this.allostaticLoad - 0.62) * 0.08 : 0;
    return clamp(base + appraisalMod - loadPenalty, 0.72, 1.24);
  }

  step(actor, dt, t, seenEnemy, ctx = null) {
    super.step(actor, dt, t, seenEnemy, ctx);

    // 1. Update Blascovich Cognitive Appraisal (Resources vs Demands)
    const resources = clamp((actor.hp + (actor.shield || 0) + (actor.baizerShield || 0) * 0.6) / 125, 0, 1) * 0.45
      + (this.cohesion || 0.55) * 0.25 + this.hotHand * 0.22 + (ctx?.aliveAllies || 1) * 0.08;
    const demands = this.stress * 0.48 + (ctx?.aliveEnemies || 1) * 0.14
      + (this.deathStreak >= 2 ? 0.22 : 0) + (seenEnemy ? 0.16 : 0);
    const targetBal = clamp((resources - demands) * 1.45, -1, 1);
    this.challengeBalance += (targetBal - this.challengeBalance) * (1 - Math.exp(-0.55 * dt));

    // 2. Allostatic Load accumulation under sustained high BPM (>132) & calm-lull Deep-Breath Reset!
    if (this.heartRate > 132 || seenEnemy) {
      this.allostaticLoad = clamp(this.allostaticLoad + dt * 0.028, 0, 1);
      this.calmLullAccum = 0;
    } else {
      const rec = 0.045 * (this.persona.composureRecovery || 0.86);
      this.allostaticLoad = Math.max(0, this.allostaticLoad - dt * rec);
      if (this.allostaticLoad > 0.28 || this.stress > 0.34) {
        this.calmLullAccum += dt;
        if (this.calmLullAccum >= 3.2) {
          this.triggerBreathReset(t, ctx?.metrics || null);
        }
      }
    }
    this.hotHand *= Math.exp(-0.045 * dt);

    // 3. Rich Living-Human Emotional State Tag
    if (t < this.startleFreezeUntil) this.stateTag = '驚愕硬直';
    else if (this.breathHold > 0.55) this.stateTag = '呼吸停止照準';
    else if (t - this.lastBreathResetAt < 1.2) this.stateTag = '深呼吸リセット';
    else if (this.clutchLevel > 0.45) this.stateTag = 'クラッチ極集中';
    else if (this.challengeBalance > 0.42 && this.hotHand > 0.32) this.stateTag = 'ゾーン覚醒';
    else if (this.challengeBalance < -0.35 && this.stress > 0.52) this.stateTag = '焦燥ティルト';
    else if (this.challengeBalance > 0.22) this.stateTag = '強気攻勢';
    else this.stateTag = '冷静警戒';
  }
}

// ============================================================================
// CORE 4. HumainMetaMindV25: Self-Habit Anti-Pattern Conditioning (Mix-Ups),
//         Per-Enemy Greed/Camp Profiling, Wounded Bait Traps & Post-Kill Check
// ============================================================================
export class HumainMetaMindV25 extends ManusiaTheoryOfMindV24 {
  constructor(rng, persona = null, isNv21 = false) {
    super(rng, persona, isNv21);
    this.recentPeeks = [];            // Ring of last 4 own peek styles -> self-predictability detector!
    this.enemyHabits = new Map();     // enemyId -> {greed, camp, lastPos, lastAt, samples}
    this.baitTrapUntil = -10;         // Active Wounded Bait Trap window!
    this.baitTrapYaw = 0;
    this.baitTrapCooldownUntil = -10;
    this.postKillCheckUntil = -10;    // Post-Kill Trade-Fragger verification ritual!
    this.postKillCheckYaw = 0;
    this.lastPatternBreakAt = -10;
  }

  reset() {
    super.reset();
    this.baitTrapUntil = -10;
    this.postKillCheckUntil = -10;
    // NOTE: enemyHabits & recentPeeks intentionally persist across respawns (episodic match learning!)
  }

  /** Record own chosen peek style; detect self-habit repetition & trigger conscious Mix-Up Pattern Break! */
  recordOwnPeek(style, t, metrics = null) {
    this.recentPeeks.push(style);
    if (this.recentPeeks.length > 4) this.recentPeeks.shift();
    if (this.recentPeeks.length >= 2) {
      const n = this.recentPeeks.length;
      if (this.recentPeeks[n - 1] === this.recentPeeks[n - 2] && t - this.lastPatternBreakAt > 3.2) {
        this.lastPatternBreakAt = t;
        if (metrics) metrics.humainPatternBreaks++;
        return true; // Self-awareness: "I just did the exact same peek twice -> break pattern next!"
      }
    }
    return false;
  }

  getLastPeekStyle() {
    return this.recentPeeks.length ? this.recentPeeks[this.recentPeeks.length - 1] : null;
  }

  /**
   * 100% Fair-Play Per-Enemy Greed vs Camp Profiler:
   * Observes whether a visible enemy aggressively rushes forward after tagging us (`greed`)
   * or holds stationary angles between sightings (`camp`).
   */
  observeEnemyHabit(actor, enemy, t, weAreWounded = false) {
    let h = this.enemyHabits.get(enemy.id);
    if (!h) {
      h = {greed: 0.35, camp: 0.35, lastX: enemy.x, lastZ: enemy.z, lastAt: t, samples: 0};
      this.enemyHabits.set(enemy.id, h);
      return h;
    }
    const dt = t - h.lastAt;
    if (dt < 0.35) return h;
    const moved = Math.hypot(enemy.x - h.lastX, enemy.z - h.lastZ);
    const toMeX = actor.x - enemy.x, toMeZ = actor.z - enemy.z;
    const d = Math.hypot(toMeX, toMeZ) || 1;
    const closingSpd = ((enemy.vx || 0) * toMeX + (enemy.vz || 0) * toMeZ) / d;

    if (weAreWounded && closingSpd > 2.2) {
      h.greed = clamp(h.greed + 0.24, 0, 1);
      h.camp = clamp(h.camp - 0.12, 0, 1);
    } else if (dt > 1.8 && moved < 2.2) {
      h.camp = clamp(h.camp + 0.18, 0, 1);
      h.greed = clamp(h.greed - 0.08, 0, 1);
    } else {
      h.greed = clamp(h.greed + (closingSpd > 2.6 ? 0.08 : -0.04), 0, 1);
    }
    h.lastX = enemy.x;
    h.lastZ = enemy.z;
    h.lastAt = t;
    h.samples++;
    return h;
  }

  getEnemyHabit(enemyId) {
    return this.enemyHabits.get(enemyId) || {greed: 0.35, camp: 0.35, samples: 0};
  }

  /**
   * Wounded Bait Trap ("Punish the Greedy Pursuer"!):
   * When moderately wounded (HP 48..64) behind cover after getting tagged by an aggressive opponent,
   * stop briefly just around the corner pre-aiming the chase entry to punish the over-pursuit!
   */
  tryStartWoundedBaitTrap(actor, b, t, metrics = null) {
    if (t < this.baitTrapUntil) {
      if (b.seen || actor.hp < 36) {
        this.baitTrapUntil = -10;
        return null;
      }
      return {active: true, yaw: this.baitTrapYaw};
    }
    if (t < this.baitTrapCooldownUntil || b.seen || !b.cover || !b.lastPos) return null;
    if (actor.hp < 48 || actor.hp > 66 || actor.mag < 6 || actor.reload > 0) return null;
    if (t - (b.underFireAt || -10) > 2.6) return null;
    const habit = this.getEnemyHabit(b.targetId ?? -1);
    const dThreat = Math.hypot(b.lastPos[0] - actor.x, b.lastPos[1] - actor.z);
    if (dThreat < 6.5 || dThreat > 26) return null;
    if (habit.greed < 0.34 && (this.persona.mixupIQ || 0.85) < 0.84) return null;

    if (this.rng() < 0.38 + habit.greed * 0.36) {
      this.baitTrapYaw = Math.atan2(b.lastPos[0] - actor.x, -(b.lastPos[1] - actor.z));
      this.baitTrapUntil = t + 1.25 + this.rng() * 0.55;
      this.baitTrapCooldownUntil = t + 11.5;
      if (metrics) metrics.humainBaitTraps++;
      return {active: true, yaw: this.baitTrapYaw, justStarted: true};
    }
    this.baitTrapCooldownUntil = t + 3.2;
    return null;
  }

  /** Post-Kill Trade-Fragger Check Ritual: scan around the kill zone for 0.26-0.46s before dropping guard! */
  triggerPostKillCheck(actor, victimPos, t, metrics = null) {
    if (!victimPos) return;
    const baseYaw = Math.atan2(victimPos[0] - actor.x, -(victimPos[1] - actor.z));
    // Sweep slightly toward the wide flanking lip around where the victim died (where a trader will swing!)
    const side = (this.persona.habitSide || 1) * (this.rng() < 0.5 ? 0.24 : -0.24);
    this.postKillCheckYaw = baseYaw + side;
    this.postKillCheckUntil = t + 0.28 + this.rng() * 0.18;
    if (metrics) metrics.humainPostKillChecks++;
  }
}

// ============================================================================
// CORE 5. HumainMultisensoryV25: Cross-Modal Audio-Visual Super-Additive Fusion,
//         Static Off-Angle Camouflage Realism & Epistemic Surprise Coupling
// ============================================================================
export class HumainMultisensoryV25 extends ManusiaPerceptionV24 {
  constructor(rng, isNv21 = false) {
    super(rng, isNv21);
    this.lastAudioCueYaw = 0;
    this.lastAudioCueAt = -10;
    this._countedCrossModal = new Map();
    this._countedCamo = new Map();
  }

  reset() {
    super.reset();
    this.lastAudioCueAt = -10;
    this._countedCrossModal.clear();
    this._countedCamo.clear();
  }

  onEchoArrival(actor, rep, t, mind = null, metrics = null) {
    const res = super.onEchoArrival(actor, rep, t, mind, metrics);
    if (res && Number.isFinite(res.yaw)) {
      this.lastAudioCueYaw = res.yaw;
      this.lastAudioCueAt = t;
    }
    return res;
  }

  onBulletWhiz(actor, shot, dist, t, mind = null, metrics = null) {
    const res = super.onBulletWhiz(actor, shot, dist, t, mind, metrics);
    if (res && Number.isFinite(res.yaw)) {
      this.lastAudioCueYaw = res.yaw;
      this.lastAudioCueAt = t;
    }
    return res;
  }

  evaluateSighting(actor, enemy, dt, t, mind, currentlyDuelingId = -1, metrics = null, extra = null) {
    let effDt = dt;
    const dx = enemy.x - actor.x, dz = enemy.z - actor.z;
    const dist = Math.hypot(dx, dz);
    const aimYaw = Math.atan2(dx, -dz);
    const enemySpd = Math.hypot(enemy.vx || 0, enemy.vz || 0);
    const hasFlash = (enemy.flash || 0) > 0.008;

    // 1. Cross-Modal Audio-Visual Super-Additive Binding (Stein & Meredith):
    //    Recent EchoPulse/whiz audio within ±0.48 rad (28 deg) & 0.65s snaps visual recognition faster!
    const audioMatch = (t - this.lastAudioCueAt < 0.65)
      && Math.abs(angleDiff(aimYaw, this.lastAudioCueYaw)) < 0.48;
    if (audioMatch) {
      effDt *= 1.32;
      if (metrics && (t - (this._countedCrossModal.get(enemy.id) || -10) > 2.6)) {
        this._countedCrossModal.set(enemy.id, t);
        metrics.humainCrossModalLocks++;
      }
    }

    // 2. Figure-Ground Static Off-Angle Camouflage Realism:
    //    A completely motionless, crouched enemy at mid/long range without muzzle flash blends into harbor steel!
    if (!hasFlash && !audioMatch && enemySpd < 0.45 && (enemy.crouch || 0) > 0.35 && dist > 11) {
      effDt *= 0.72; // ~38% slower spotting of silent crouched ambushers!
      if (metrics && (t - (this._countedCamo.get(enemy.id) || -10) > 3.2)) {
        this._countedCamo.set(enemy.id, t);
        metrics.humainCamoDelays++;
      }
    }

    // 3. Acoustic Startle Freeze briefly pauses visual accumulation for 45-65ms
    if (mind?.isStartleFrozen?.(t)) {
      effDt *= 0.55;
    }

    const res = super.evaluateSighting(actor, enemy, effDt, t, mind, currentlyDuelingId, metrics, extra);
    if (audioMatch && res) {
      res.primed = true; // Stein & Meredith multisensory cortex priming speeds up target acquisition!
    }
    return res;
  }
}

// ============================================================================
// CORE 6. HumainSensorimotorV25: Oculomotor Eye-First Lead, 2-Stroke Mouse-Lift
//         180-deg Whip, Henneman Torque Noise, Spray-Stop Recoil Overpull &
//         Pro Crosshair-Placement Intercept Timing
// ============================================================================
export class HumainSensorimotorV25 extends ManusiaNeuromotorAimV24 {
  constructor(rng, isNv21 = false, persona = null) {
    super(rng, isNv21, persona);
    // Oculomotor Eye-First / Hand-Follows decoupling (eyes lead gun barrel by 55-100ms!)
    this.eyeYaw = 0;
    this.eyePitch = 0;

    // 2-Stroke Mouse-Lift 180-deg Whip state (authentic mouse-pad edge reset!)
    this.liftResumeAt = -10;
    this.liftFinalYaw = 0;
    this.liftFinalPitch = 0;
    this.liftPending = false;
    this.lastMouseLiftAt = -10;

    // Spray-Stop Recoil Overpull micro-recovery
    this.overpullPitch = 0;
    this.wasSpraying = false;
    this.prevSprayShots = 0;
    this.lastOverpullAt = -10;

    // Crosshair-Placement Intercept tracker
    this.lastInterceptAt = -10;
  }

  reset(t = 0) {
    super.reset(t);
    this.liftResumeAt = -10;
    this.liftPending = false;
    this.overpullPitch = 0;
    this.wasSpraying = false;
    this.prevSprayShots = 0;
  }

  /**
   * 2-Stroke Mouse-Lift Wide/180-deg Turn:
   * Humans cannot smoothly spin 85-180 deg in one constant robotic sweep!
   * Turns > 1.48 rad (~85 deg) break into Primary Stroke (~64%) -> 45-80ms Mouse-Lift -> Stroke 2!
   */
  triggerBallisticFlick(curYaw, curPitch, targetYaw, targetPitch, t, stress = 0, startled = false, metrics = null, targetDist = 20) {
    const dy = angleDiff(targetYaw, curYaw);
    if (Math.abs(dy) > 1.48 && t - this.lastMouseLiftAt > 1.4) {
      const stroke1Frac = 0.58 + this.rng() * 0.12;
      const midYaw = curYaw + dy * stroke1Frac;
      const midPitch = mix(curPitch, targetPitch, 0.55);
      const ok = super.triggerBallisticFlick(curYaw, curPitch, midYaw, midPitch, t, stress, startled, metrics, targetDist);
      if (ok) {
        this.liftPending = true;
        this.liftFinalYaw = targetYaw;
        this.liftFinalPitch = targetPitch;
        this.liftResumeAt = t + this.flickDur + (this.isNv21 ? 0.044 : 0.062) + this.rng() * 0.022;
        this.lastMouseLiftAt = t;
        if (metrics) metrics.humainMouseLifts++;
      }
      return ok;
    }
    this.liftPending = false;
    return super.triggerBallisticFlick(curYaw, curPitch, targetYaw, targetPitch, t, stress, startled, metrics, targetDist);
  }

  step(a, dt, t, opts) {
    const {
      seenTarget,
      fallbackYaw = a.yaw,
      fallbackPitch = 0,
      mind = null,
      metrics = null,
      urgentRearWhip = false,
      holdingTrapAngle = false
    } = opts;

    // 1. Oculomotor Eye-First Lead: eyes rapidly saccade ahead of rifle inertia!
    const desiredEyeYaw = seenTarget
      ? Math.atan2(seenTarget.x - a.x, -(seenTarget.z - a.z))
      : fallbackYaw;
    const desiredEyePitch = seenTarget ? a.pitch : fallbackPitch;
    const eyeAlreadyOnTarget = !!(seenTarget && Math.abs(angleDiff(this.eyeYaw, desiredEyeYaw)) < 0.28);
    const eyeRate = 1 - Math.exp(-26.0 * dt);
    this.eyeYaw = mixAngle(this.eyeYaw, desiredEyeYaw, eyeRate);
    this.eyePitch += (desiredEyePitch - this.eyePitch) * eyeRate;

    // Pre-charge Quiet Eye while calmly holding a Wounded Bait Trap or Post-Kill Check corner!
    if (holdingTrapAngle && !seenTarget && Math.hypot(a.vx || 0, a.vz || 0) < 1.8) {
      this.quietEyeAccum = Math.max(this.quietEyeAccum, 0.085);
    }

    // 2. Execute 2-Stroke Mouse-Lift Pause & Second Stroke ONLY on genuine combat/ambush whips!
    if (!seenTarget && urgentRearWhip && !this.liftPending && this.motorPhase !== 'FLICK' && t - this.lastMouseLiftAt > 2.4) {
      const rearDelta = Math.abs(angleDiff(fallbackYaw, a.yaw));
      if (rearDelta > 1.65) {
        this.triggerBallisticFlick(a.yaw, a.pitch, fallbackYaw, fallbackPitch, t, mind?.stress || 0, false, metrics, 16);
      }
    }
    let liftingMouse = false;
    if (this.liftPending) {
      if (seenTarget) {
        const directYaw = Math.atan2(seenTarget.x - a.x, -(seenTarget.z - a.z));
        if (Math.abs(angleDiff(directYaw, a.yaw)) < 0.22) {
          // Enemy stepped right into view -> immediately plant mouse and engage!
          this.liftPending = false;
        }
      }
      if (this.liftPending && this.motorPhase !== 'FLICK') {
        if (t < this.liftResumeAt) {
          // Physical hand lifting & re-centering mouse on mousepad -> momentary yaw stall!
          liftingMouse = true;
          this.velYaw *= Math.exp(-22 * dt);
        } else {
          this.liftPending = false;
          const finishYaw = seenTarget
            ? Math.atan2(seenTarget.x - a.x, -(seenTarget.z - a.z))
            : this.liftFinalYaw;
          super.triggerBallisticFlick(a.yaw, a.pitch, finishYaw, this.liftFinalPitch, t, mind?.stress || 0, false, metrics, 16);
        }
      }
    }

    // 3. Detect Spray-Stop Recoil Overpull (triggers ONCE when a >=5-shot sustained spray actually ends!)
    const sinceShot = t - this.lastShotAt;
    if (sinceShot < 0.22 && this.shotsInBurst >= 5) {
      this.wasSpraying = true;
      this.prevSprayShots = Math.max(this.prevSprayShots, this.shotsInBurst);
    } else if (this.wasSpraying && sinceShot >= 0.24 && this.prevSprayShots >= 5) {
      this.wasSpraying = false;
      this.prevSprayShots = 0;
      if (t - this.lastOverpullAt > 1.15) {
        this.lastOverpullAt = t;
        this.overpullPitch = -(0.005 + this.rng() * 0.005);
        if (metrics) metrics.humainRecoilOverpulls++;
      }
    }

    // 4. Delegate to NV 2.4 Manusia neuromotor layer (OFC + Meyer SUBMOVE + 1/f Pink Noise + Breath-Hold)
    //    If oculomotor eye-gaze was ALREADY locked on the target's corner, treat acquisition as primed!
    const stepOpts = eyeAlreadyOnTarget && !opts.primed ? {...opts, primed: true} : opts;
    const res = super.step(a, dt, t, stepOpts);

    // 5. Apply Spray-Stop Overpull spring-back & Henneman High-Torque Motor-Unit Noise
    if (Math.abs(this.overpullPitch) > 0.0005) {
      a.pitch = clamp(a.pitch + this.overpullPitch * Math.min(1, dt * 11), -0.92, 0.92);
      this.overpullPitch *= Math.exp(-11.0 * dt);
    }

    // Henneman Size-Principle: rapid high-torque swings recruit coarser motor units -> subtle velocity-scaled spread!
    const angSpeed = Math.abs(this.velYaw || 0);
    const torqueNoiseMul = angSpeed > 3.2 ? (1 + clamp((angSpeed - 3.2) * 0.035, 0, 0.12)) : 1.0;

    // 6. Pro Crosshair-Placement Intercept Timing:
    //    When crosshair is planted calmly on a corridor and a MOVING enemy crosses into the angle,
    //    real human click-timing delivers surgical intercept accuracy (0.82x spread on moving targets!).
    let interceptShot = false;
    if (seenTarget && !liftingMouse && angSpeed < 1.05 && res.alignPerceived < 0.062 && this.motorPhase === 'PURSUIT') {
      const tgtSpd = Math.hypot(seenTarget.vx || 0, seenTarget.vz || 0);
      if (tgtSpd > 1.4 && Math.hypot(a.vx || 0, a.vz || 0) < 3.0) {
        interceptShot = true;
        if (t - this.lastInterceptAt > 0.70) {
          this.lastInterceptAt = t;
          if (metrics) metrics.humainCrosshairIntercepts++;
        }
      }
    }

    const startleFrozen = !!mind?.isStartleFrozen?.(t) && res.alignPerceived > 0.09;
    const interceptMul = interceptShot ? 0.82 : 1.0;

    return {
      ...res,
      readyToFire: res.readyToFire && !liftingMouse && !startleFrozen,
      microSpread: res.microSpread * torqueNoiseMul * interceptMul,
      eyeYaw: this.eyeYaw,
      liftingMouse,
      interceptShot
    };
  }
}

// ============================================================================
// CORE 7. HumainFixationGazeV25: Discrete Fixation-Saccade Scan Rhythm,
//         Active-Inference High-Entropy Lane Glances, Post-Kill Trade-Check
//         Gaze & Expressive Social Buddy Glances
// ============================================================================
export class HumainFixationGazeV25 extends ManusiaGazeV24 {
  constructor(rng, persona, isNv21 = false) {
    super(rng, persona, isNv21);
    this.fixationYaw = 0;
    this.fixationPitch = 0;
    this.fixationHoldUntil = -10;
    this.epistemicGlanceUntil = -10;
    this.epistemicGlanceYaw = 0;
    this.nextEpistemicGlanceAt = 2.5 + rng() * 2.0;
    this.buddyGlanceUntil = -10;
    this.buddyGlanceYaw = 0;
    this.nextBuddyGlanceAt = 3.5 + rng() * 3.5;
  }

  computeIdleGaze(actor, b, moveYaw, t, mind, metrics = null, ctx = null) {
    // 1. Post-Kill Trade-Check Gaze Ritual (verify no trader is swinging after a kill!)
    if (b.tom && t < (b.tom.postKillCheckUntil || -10)) {
      return {yaw: b.tom.postKillCheckYaw, pitch: 0.01};
    }

    // 2. Active Wounded Bait Trap pre-aim lock on the chase lip!
    if (b.tom && t < (b.tom.baitTrapUntil || -10)) {
      return {yaw: b.tom.baitTrapYaw, pitch: 0.0};
    }

    // 3. Expressive Social Buddy Glance (STRICTLY during calm lulls — never look away mid-fight!)
    const inCalmLull = (mind?.stress || 0) < 0.28 && (t - (b.seenAt || -10) > 4.2) && (t - (b.underFireAt || -10) > 4.2);
    if (t < this.buddyGlanceUntil && inCalmLull) {
      return {yaw: this.buddyGlanceYaw, pitch: 0.02};
    }
    if (inCalmLull && t >= this.nextBuddyGlanceAt && ctx?.allies?.length > 1) {
      this.nextBuddyGlanceAt = t + 5.2 + this.rng() * 4.5;
      let pick = null;
      for (let i = 0; i < ctx.allies.length; i++) {
        const mate = ctx.allies[i];
        if (mate.id === actor.id || !mate.alive) continue;
        const d = Math.hypot(mate.x - actor.x, mate.z - actor.z);
        if (d > 2.4 && d < 16 && (!pick || mate.human)) pick = mate;
      }
      if (pick) {
        this.buddyGlanceYaw = Math.atan2(pick.x - actor.x, -(pick.z - actor.z));
        this.buddyGlanceUntil = t + 0.22 + this.rng() * 0.12;
        if (metrics) metrics.humainBuddyGlances++;
        return {yaw: this.buddyGlanceYaw, pitch: 0.02};
      }
    }

    // 4. Periodic Active-Inference Epistemic Lane Glance (brief 0.30-0.42s check every 2.8-4.2s,
    //    NEVER locking gaze backward continuously while moving down a forward corridor!)
    if (t < this.epistemicGlanceUntil) {
      return {yaw: this.epistemicGlanceYaw, pitch: 0};
    }
    const hasFreshMem = !!b.vision?.getPrimaryMemory(t, 3.2);
    if (!hasFreshMem && b.inference && t >= this.nextEpistemicGlanceAt && (t - (b.seenAt || -10) > 2.2)) {
      this.nextEpistemicGlanceAt = t + 2.8 + this.rng() * 1.4;
      const ep = b.inference.selectEpistemicLook(actor, t, metrics);
      if (ep) {
        this.epistemicGlanceYaw = ep.yaw;
        this.epistemicGlanceUntil = t + 0.30 + this.rng() * 0.12;
        return {yaw: ep.yaw, pitch: 0};
      }
    }

    // 5. Discrete Fixation-Saccade Hold (breaks immediately if turning sharply into a new movement lane!)
    const ownSpd = Math.hypot(actor.vx || 0, actor.vz || 0);
    const turnedLane = ownSpd > 2.2 && Math.abs(angleDiff(moveYaw, this.fixationYaw)) > 1.05;
    if (t < this.fixationHoldUntil && !b.vision?.primedCue && !turnedLane) {
      return {yaw: this.fixationYaw, pitch: this.fixationPitch};
    }

    // 6. Delegate to NV 2.4 Manusia 9-ray edge pre-aim + curvature look-ahead + rooftop elevation
    const res = super.computeIdleGaze(actor, b, moveYaw, t, mind, metrics, ctx);
    if (Math.abs(angleDiff(res.yaw, this.fixationYaw)) > 0.16 || turnedLane) {
      this.fixationYaw = res.yaw;
      this.fixationPitch = res.pitch;
      this.fixationHoldUntil = t + 0.20 + this.rng() * 0.16;
    }
    return res;
  }
}

// ============================================================================
// CORE 8A. HumainEmbodiedTacticsV25: Non-Periodic Asymmetric Strafe Choreography,
//          Synchronized Double-Swing, Self-Habit Anti-Pattern Peeks &
//          Expressive 16-Bone Micro-Posture
// ============================================================================
export class HumainEmbodiedTacticsV25 extends ManusiaTacticsV24 {
  constructor(rng, persona, isNv21 = false) {
    super(rng, persona, isNv21);
    this.strafePatternIdx = 0;
    this.strafeDoubleTapLeft = 0;
    this.lastSyncEmitAt = -10;
  }

  reset() {
    super.reset();
    this.strafePatternIdx = 0;
    this.strafeDoubleTapLeft = 0;
  }

  /**
   * Anti-Pattern Mix-Up Peek Selection:
   * Avoids repeating the previous peek style when Nemesis Respect or self-predictability is high!
   */
  selectPeekStyle(actor, b, target, t, mind, metrics = null) {
    const baseStyle = super.selectPeekStyle(actor, b, target, t, mind, metrics);
    if (!b.tom || typeof b.tom.recordOwnPeek !== 'function') return baseStyle;

    const lastStyle = b.tom.getLastPeekStyle();
    const respect = mind?.getNemesisRespect?.(target?.id ?? b.targetId ?? -1) || 0;
    let finalStyle = baseStyle;

    // Conscious Mix-Up: if repeating same style against high pre-aim or respected Nemesis, break pattern!
    if (lastStyle && baseStyle === lastStyle && (respect > 0.30 || b.tom.getEnemyPreAimRisk(actor, t) > 0.36 || this.rng() < 0.35)) {
      const alts = [PEEK_STYLES.INFO_JIGGLE, PEEK_STYLES.WIDE_SWING, PEEK_STYLES.CROUCH_MIXUP, PEEK_STYLES.OFF_ANGLE]
        .filter(s => s !== lastStyle);
      finalStyle = alts[Math.floor(this.rng() * alts.length)] || baseStyle;
      this.currentPeekStyle = finalStyle;
      if (metrics) metrics.humainPatternBreaks++;
    }
    b.tom.recordOwnPeek(finalStyle, t, metrics);
    return finalStyle;
  }

  /**
   * Non-Periodic Asymmetric Human Strafe Choreography ("A-D-A-A-D" combat dance):
   * Replaces robotic periodic sign-flipping with irregular micro-bursts, occasional
   * double-tap same-direction fakes, and momentum-aware durations!
   */
  nextAsymmetricStrafe(curSign, mind, isSpy, metrics = null) {
    let nextSign = -curSign;
    let dur;
    if (this.strafeDoubleTapLeft > 0) {
      // Same-direction micro-hesitate double-tap ("A -> pause -> A") to throw off enemy Smooth Pursuit!
      this.strafeDoubleTapLeft--;
      nextSign = curSign;
      dur = 0.16 + this.rng() * 0.14;
    } else {
      const r = this.rng();
      if (r < 0.24) {
        // Quick stutter-juke + queue a same-side double-tap!
        nextSign = -curSign;
        this.strafeDoubleTapLeft = 1;
        dur = 0.14 + this.rng() * 0.11;
        if (metrics) metrics.humainAsymStrafes++;
      } else if (r < 0.68) {
        // Medium asymmetric combat stride
        nextSign = -curSign;
        dur = (isSpy ? 0.22 : 0.28) + this.rng() * 0.26;
      } else {
        // Extended commit stride (bold under Challenge / Hot-Hand!)
        nextSign = r < 0.86 ? -curSign : curSign;
        const bold = (mind?.challengeBalance || 0) > 0.25 ? 0.12 : 0;
        dur = (isSpy ? 0.36 : 0.44) + this.rng() * 0.24 + bold;
        if (metrics) metrics.humainAsymStrafes++;
      }
    }
    return {sign: nextSign || 1, dur};
  }

  /**
   * Expressive 16-Bone Rig Micro-Posture (100% compatible with existing WebGL2 & Software rig!):
   *  - Low-ready relaxed stance when moving safely in cleared sectors (`ads: false`)
   *  - Crisp ADS raise when primed, holding angle, bait-trapping, or post-kill checking
   *  - Brief authentic startle crouch-duck flinch on unexpected close whiz/shock!
   */
  refineExpressivePose(actor, b, basePose, t, mind) {
    const startleDuck = !!mind?.isStartleFrozen?.(t);
    const holdingCombatAngle = !!(
      b.seen
      || (b.tom && (t < b.tom.baitTrapUntil || t < b.tom.postKillCheckUntil))
      || (b.vision && b.vision.primedCue && t < b.vision.primedCue.until)
      || b.state === 'ピーク射撃' || b.state === 'リロード援護' || b.state === 'トレード突入' || b.state === '同期ダブルスイング'
    );
    const safeCalm = !holdingCombatAngle && (mind?.stress || 0) < 0.28 && (t - (b.seenAt || -10) > 3.5);
    return {
      crouch: (basePose.crouch || startleDuck) && !b.vault && actor.onGround,
      lean: basePose.lean,
      ads: safeCalm ? false : (basePose.ads || (holdingCombatAngle && actor.reload <= 0))
    };
  }
}

// ============================================================================
// CORE 8B. HumainSocialMindV25: 10-Channel Stress-Modulated Delayed Squad Comms
//          (+ BAIT_READY / SWING_NOW) & Bilateral Human-Player Push Mirroring
// ============================================================================
export class HumainSocialMindV25 extends ManusiaSocialSquadV24 {
  constructor(rng) {
    super(rng);
    this.stats.BAIT_READY = 0;
    this.stats.SWING_NOW = 0;
    this.lastPlayerPushAt = -10;
    this.playerPrevX = 0;
    this.playerPrevZ = 0;
  }

  emitCallout(team, callerId, enemyId, x, z, kind, t, metrics = null, extra = null) {
    // Stress-modulated human speech latency & slight panic coordinate fuzz (NEVER 0ms or omniscient!)
    const stress = clamp(extra?.stress || 0, 0, 1);
    const fuzz = stress > 0.55 ? (stress - 0.55) * 2.2 : 0;
    const fx = x + (fuzz ? (this.rng() - 0.5) * fuzz : 0);
    const fz = z + (fuzz ? (this.rng() - 0.5) * fuzz : 0);

    // Handle new V25 channels cleanly while delegating existing channels to parent
    if (kind === 'BAIT_READY' || kind === 'SWING_NOW') {
      const key = `${callerId}:${kind}`;
      const last = this.lastCallByActor.get(key) ?? -10;
      if (t - last < 1.25) return false;
      this.lastCallByActor.set(key, t);
      const delay = (0.24 + this.rng() * 0.18) * (1 + stress * 0.22);
      this.queue.push({
        team,
        callerId,
        enemyId,
        x: clamp(fx, -23, 23),
        z: clamp(fz, -96, 96),
        kind,
        lane: extra?.lane ?? (fx < -7 ? -1 : fx > 7 ? 1 : 0),
        callerX: extra?.callerX ?? fx,
        callerZ: extra?.callerZ ?? fz,
        extra: extra || null,
        deliverAt: t + delay
      });
      if (this.queue.length > 36) this.queue.shift();
      this.stats[kind] = (this.stats[kind] || 0) + 1;
      if (metrics) metrics.humanCallouts++;
      return true;
    }

    return super.emitCallout(team, callerId, enemyId, fx, fz, kind, t, metrics, extra);
  }

  /**
   * Bilateral Team-0 Human-Player Buddy Synergy & Push Mirroring:
   *  - Inherits reload-cover & low-HP rescue assists from ManusiaSocialSquadV24
   *  - Detects when the Team-0 human player is actively pushing forward into combat
   *    and signals nearby NAGI/KAI with a delayed `SWING_NOW` so they swing WITH the player!
   */
  observeHumanPlayer(player, allies, t, metrics = null) {
    const baseAssisted = super.observeHumanPlayer(player, allies, t, metrics);
    if (!player || !player.alive || !player.human || !allies || allies.length < 2) return baseAssisted;

    const pSpd = Math.hypot(player.vx || 0, player.vz || 0);
    const pushingForward = pSpd > 3.2 && player.hp >= 62 && player.reload <= 0
      && ((player.flash || 0) > 0.004 || player.aimPose > 0.45);
    if (pushingForward && t - this.lastPlayerPushAt > 4.2) {
      const hasCloseBuddy = allies.some(m => !m.human && m.alive && Math.hypot(m.x - player.x, m.z - player.z) < 22);
      if (hasCloseBuddy) {
        this.lastPlayerPushAt = t;
        const leadX = clamp(player.x + Math.sin(player.yaw) * 9, -23, 23);
        const leadZ = clamp(player.z - Math.cos(player.yaw) * 9, -96, 96);
        this.emitCallout(player.team, player.id, -1, leadX, leadZ, 'SWING_NOW', t, metrics, {
          callerX: player.x, callerZ: player.z, isHumanPlayer: true
        });
        if (metrics) metrics.manusiaPlayerAssists++;
        return true;
      }
    }
    return baseAssisted;
  }
}

// Convenient semantic aliases
export const HumanPsycheV25 = HumainAffectivePsycheV25;
export const HumanPerceptionV25 = HumainMultisensoryV25;
export const HumanOFC_AimV25 = HumainSensorimotorV25;
export const HumanGazeV25 = HumainFixationGazeV25;
export const HumanTacticsV25 = HumainEmbodiedTacticsV25;
export const HumanSquadCommsV25 = HumainSocialMindV25;
