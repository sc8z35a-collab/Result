// NV2.3 HUMAN — Next-Generation Fair-Play Computational Cognitive, Neuromotor & Tactical FPS AI (360Hz Native).
//
// 100% Fair-Play Guarantee (Zero Wallhack, Zero Aimbot, Zero Hidden Enemy Queries):
//   All cognition operates strictly on direct unobstructed LOS, arrived 343 m/s EchoPulse waves,
//   5,100 m/s ResonanceCore structural steel knocks, bullet-whiz tracer back-traces, and delayed
//   (0.34–0.74s) spatially fuzzed teammate voice callouts.
//
// 6 Core Subsystems:
//   1. HumanPsycheV23:
//      - 12-dimensional personality profiles with unique callsign identities (NAGI / KAI / RIN / SORA / AO).
//      - Extended Yerkes-Dodson inverted-U arousal/flow curve, Team Morale Contagion, 1vX Clutch Awakening,
//        Startle Reflex freeze, Re-peek hesitation, and Episodic Memory (Nemesis, Trauma Danger Angles,
//        Per-Enemy Mental Models).
//   2. HumanPerceptionV23:
//      - Foveal / Parafoveal / Peripheral retinal vision + high-yaw-rate Saccadic Suppression + Attention
//        Priming (+38% recognition speed) + Hick-Hyman multi-enemy cognitive load + Cowan 4-slot Object
//        Permanence Working Memory + Bullet-Whiz Tracer Back-Trace + Rooftop Footstep Upward Cue +
//        ResonanceCore Steel-Knock Reposition + EchoPulse Canyon Echo Experience Learning.
//   3. HumanOFC_AimV23:
//      - Optimal Feedback Control (Todorov minimum-intervention) + Predictive Primary Saccade (Fitts's Law
//        + Minimum-Jerk quintic + natural undershoot bias + Harris & Wolpert multiplicative noise) +
//        Quiet Eye pre-shot stabilization & click timing + Visual-Delay-Buffered Velocity-Matched Smooth
//        Pursuit (silky on constant velocity, authentically swims on abrupt A-D reversals) + Weapon-Specific
//        Recoil Muscle Memory + RD20/RD30/RD40/DF1 ARV lock-completion patience.
//   4. HumanGazeV23:
//      - 9-Ray Depth-Discontinuity Edge Detection (pre-aims container corner edges & slices the pie) +
//        Buddy Mutual-Cover Gaze Sharing (splits flank / Check-Six watch sectors with teammates) +
//        Elevated Rooftop Acoustic Look-Up + Tracer Back-Trace Snap.
//   5. HumanTacticsV23:
//      - Tactical Silent Walk (sprintAmt <= 0.30 -> zero EchoPulse footsteps) vs Adrenaline Sprint,
//        5 Peek Styles (Info Jiggle / Cutting the Pie / Wide Swing / Crouch Mixup / Off-Angle),
//        1vX Sightline Angle Isolation, Shield Recovery Cycle Discipline, and 4-Way Harbor Physics Mastery
//        (BallisticCore-X wood-crate wallbang, FermatCore 1-bounce bank intuition, ResonanceCore intimidation
//        container knock, AeroVortex smoke cover & wind-drifted edge watch).
//   6. HumanSquadCommsV23:
//      - 7 delayed human voice callout channels (CONTACT / SHIELD_BREAK / AMBUSH / RELOAD_COVER /
//        TRADE_REQUEST / MAN_DOWN / FLANK_CLEAR) coupled to concrete squad behaviors (Reload Cover +
//        0.45–0.95s Trade Swing refrags).

import {clamp, mix, angleDiff} from './geometry.js';
import {walkable, obstruction, raycastMaterial} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';
import {WEAPON_PENETRATION} from './ballistics.js';

export const NV23_HUMAN_VERSION = 'NV2.3 HUMAN';
export const NV2_HUMAN_VERSION = NV23_HUMAN_VERSION;

// 4 Core Tactical Archetypes (with all 12 personality dimensions + legacy fields for full compatibility)
export const HUMAN_ARCHETYPES = Object.freeze({
  DUELIST: {
    id: 'DUELIST',
    ja: '積極デュエリスト',
    // 12-Dimensional Cognitive-Motor Personality Vector
    aggression: 0.85,
    patience: 0.36,
    clutchComposure: 0.72,
    stressResilience: 0.74,
    flickTempo: 1.13,
    trackingPrecision: 0.78,
    burstDiscipline: 0.62,
    tacticalIQ: 0.66,
    stealthPreference: 0.34,
    teamSynergy: 0.68,
    curiosity: 0.66,
    tiltSensitivity: 0.56,
    // Legacy compatibility fields
    boldness: 0.85,
    flickSpeed: 1.13,
    checkSixRate: 0.48,
    repeekCaution: 0.44,
    reactionScale: 0.93,
    wanderScale: 1.02
  },
  ANCHOR: {
    id: 'ANCHOR',
    ja: '堅実アンカー',
    aggression: 0.44,
    patience: 0.86,
    clutchComposure: 0.88,
    stressResilience: 0.88,
    flickTempo: 0.97,
    trackingPrecision: 0.84,
    burstDiscipline: 0.88,
    tacticalIQ: 0.76,
    stealthPreference: 0.72,
    teamSynergy: 0.90,
    curiosity: 0.64,
    tiltSensitivity: 0.28,
    boldness: 0.44,
    flickSpeed: 0.97,
    checkSixRate: 0.64,
    repeekCaution: 0.78,
    reactionScale: 0.99,
    wanderScale: 0.86
  },
  TACTICIAN: {
    id: 'TACTICIAN',
    ja: '戦術タクティシャン',
    aggression: 0.58,
    patience: 0.74,
    clutchComposure: 0.84,
    stressResilience: 0.80,
    flickTempo: 1.03,
    trackingPrecision: 0.88,
    burstDiscipline: 0.82,
    tacticalIQ: 0.94,
    stealthPreference: 0.84,
    teamSynergy: 0.84,
    curiosity: 0.94,
    tiltSensitivity: 0.32,
    boldness: 0.58,
    flickSpeed: 1.03,
    checkSixRate: 0.88,
    repeekCaution: 0.72,
    reactionScale: 0.96,
    wanderScale: 0.90
  },
  SHARPSHOOTER: {
    id: 'SHARPSHOOTER',
    ja: '精密マークスマン',
    aggression: 0.52,
    patience: 0.82,
    clutchComposure: 0.82,
    stressResilience: 0.82,
    flickTempo: 1.06,
    trackingPrecision: 0.92,
    burstDiscipline: 0.93,
    tacticalIQ: 0.78,
    stealthPreference: 0.62,
    teamSynergy: 0.74,
    curiosity: 0.70,
    tiltSensitivity: 0.34,
    boldness: 0.52,
    flickSpeed: 1.06,
    checkSixRate: 0.56,
    repeekCaution: 0.74,
    reactionScale: 0.95,
    wanderScale: 0.80
  }
});

// Distinct 12-Dimensional Intrinsic Identities for Harbor Range Callsigns (NAGI / KAI / RIN / SORA / AO)
export const CALLSIGN_PROFILES = Object.freeze({
  NAGI: {
    base: 'ANCHOR',
    callsign: 'NAGI',
    ja: '沈着アンカー',
    spyJa: '沈着ステルス・スパイ',
    aggression: 0.48,
    patience: 0.88,
    clutchComposure: 0.94,
    stressResilience: 0.90,
    flickTempo: 0.99,
    trackingPrecision: 0.86,
    burstDiscipline: 0.88,
    tacticalIQ: 0.82,
    stealthPreference: 0.82,
    teamSynergy: 0.94,
    curiosity: 0.72,
    tiltSensitivity: 0.22,
    checkSixRate: 0.72,
    repeekCaution: 0.78,
    reactionScale: 0.96,
    wanderScale: 0.84
  },
  KAI: {
    base: 'DUELIST',
    callsign: 'KAI',
    ja: '電光デュエリスト',
    spyJa: '電光アサシン・スパイ',
    aggression: 0.88,
    patience: 0.42,
    clutchComposure: 0.80,
    stressResilience: 0.78,
    flickTempo: 1.16,
    trackingPrecision: 0.85,
    burstDiscipline: 0.76,
    tacticalIQ: 0.78,
    stealthPreference: 0.54,
    teamSynergy: 0.82,
    curiosity: 0.74,
    tiltSensitivity: 0.44,
    checkSixRate: 0.58,
    repeekCaution: 0.52,
    reactionScale: 0.91,
    wanderScale: 0.92
  },
  RIN: {
    base: 'DUELIST',
    callsign: 'RIN',
    ja: '熱血突破フラッガー',
    spyJa: '突破スパイ',
    aggression: 0.90,
    patience: 0.32,
    clutchComposure: 0.68,
    stressResilience: 0.70,
    flickTempo: 1.14,
    trackingPrecision: 0.78,
    burstDiscipline: 0.60,
    tacticalIQ: 0.62,
    stealthPreference: 0.30,
    teamSynergy: 0.66,
    curiosity: 0.64,
    tiltSensitivity: 0.66,
    checkSixRate: 0.46,
    repeekCaution: 0.44,
    reactionScale: 0.93,
    wanderScale: 1.00
  },
  SORA: {
    base: 'SHARPSHOOTER',
    callsign: 'SORA',
    ja: '冷静精密スナイパー',
    spyJa: '精密スパイ',
    aggression: 0.46,
    patience: 0.86,
    clutchComposure: 0.86,
    stressResilience: 0.86,
    flickTempo: 1.05,
    trackingPrecision: 0.93,
    burstDiscipline: 0.94,
    tacticalIQ: 0.80,
    stealthPreference: 0.68,
    teamSynergy: 0.78,
    curiosity: 0.70,
    tiltSensitivity: 0.26,
    checkSixRate: 0.60,
    repeekCaution: 0.78,
    reactionScale: 0.94,
    wanderScale: 0.78
  },
  AO: {
    base: 'TACTICIAN',
    callsign: 'AO',
    ja: '知略タクティシャン',
    spyJa: '知略スパイ',
    aggression: 0.56,
    patience: 0.76,
    clutchComposure: 0.85,
    stressResilience: 0.82,
    flickTempo: 1.04,
    trackingPrecision: 0.90,
    burstDiscipline: 0.84,
    tacticalIQ: 0.96,
    stealthPreference: 0.88,
    teamSynergy: 0.88,
    curiosity: 0.96,
    tiltSensitivity: 0.28,
    checkSixRate: 0.92,
    repeekCaution: 0.74,
    reactionScale: 0.95,
    wanderScale: 0.86
  }
});

// Weapon-specific recoil muscle-memory & Quiet Eye tuning profiles
export const WEAPON_RECOIL_PROFILE = Object.freeze({
  'SW T': {kickP: 0.0080, kickY: 0.0046, pullSkill: 0.86, driftBias: 0.12, quietReq: 0.058, arvWait: false, bloomPerShot: 0.0034},
  MS10:   {kickP: 0.0066, kickY: 0.0042, pullSkill: 0.90, driftBias: 0.18, quietReq: 0.048, arvWait: false, bloomPerShot: 0.0032},
  SRA:    {kickP: 0.0064, kickY: 0.0048, pullSkill: 0.85, driftBias: -0.15, quietReq: 0.044, arvWait: false, bloomPerShot: 0.0034},
  D1:     {kickP: 0.0054, kickY: 0.0044, pullSkill: 0.84, driftBias: 0.14, quietReq: 0.036, arvWait: false, bloomPerShot: 0.0028},
  RD30:   {kickP: 0.0058, kickY: 0.0042, pullSkill: 0.88, driftBias: -0.12, quietReq: 0.040, arvWait: true,  bloomPerShot: 0.0030},
  RD20:   {kickP: 0.0060, kickY: 0.0040, pullSkill: 0.89, driftBias: 0.10, quietReq: 0.042, arvWait: true,  bloomPerShot: 0.0029},
  RD40:   {kickP: 0.0052, kickY: 0.0036, pullSkill: 0.92, driftBias: 0.08, quietReq: 0.036, arvWait: true,  bloomPerShot: 0.0025},
  'DF1 OUT': {kickP: 0.0056, kickY: 0.0042, pullSkill: 0.88, driftBias: 0.10, quietReq: 0.038, arvWait: true, bloomPerShot: 0.0028}
});

/** Select a distinct 12-dimensional human persona based on callsign, Spy role, weapon & slot. */
export function assignHumanArchetype(actor, rng, isNv21 = false) {
  const name = actor?.name || '';
  const cs = CALLSIGN_PROFILES[name] || null;
  let base;
  if (cs) {
    base = {...HUMAN_ARCHETYPES[cs.base], ...cs, id: cs.base};
  } else if (actor?.gun === 'SW T' || actor?.gun === 'MS10') {
    base = {...HUMAN_ARCHETYPES.SHARPSHOOTER};
  } else if (actor?.gun === 'RD30' || actor?.gun === 'RD20') {
    base = {...HUMAN_ARCHETYPES.TACTICIAN};
  } else {
    const list = Object.values(HUMAN_ARCHETYPES);
    base = {...list[(actor?.id || 0) % list.length]};
  }
  const j = (amp = 0.08) => (rng ? (rng() - 0.5) * amp : 0);
  const aggression = clamp(base.aggression + j(0.08), 0.18, 0.96);
  const patience = clamp(base.patience + j(0.08), 0.18, 0.96);
  const flickTempo = clamp(base.flickTempo + j(0.05) + (isNv21 ? 0.06 : 0), 0.84, 1.28);
  const stealthPreference = clamp(base.stealthPreference + j(0.08) + (isNv21 ? 0.16 : 0), 0.15, 0.98);
  return {
    ...base,
    ja: isNv21 && cs?.spyJa ? cs.spyJa : base.ja,
    callsign: name || base.id,
    aggression,
    patience,
    clutchComposure: clamp(base.clutchComposure + j(0.06) + (isNv21 ? 0.06 : 0), 0.30, 0.98),
    stressResilience: clamp(base.stressResilience + j(0.06) + (isNv21 ? 0.08 : 0), 0.35, 0.98),
    flickTempo,
    trackingPrecision: clamp(base.trackingPrecision + j(0.06) + (isNv21 ? 0.06 : 0), 0.45, 0.98),
    burstDiscipline: clamp(base.burstDiscipline + j(0.08), 0.38, 0.97),
    tacticalIQ: clamp(base.tacticalIQ + j(0.06) + (isNv21 ? 0.08 : 0), 0.40, 0.99),
    stealthPreference,
    teamSynergy: clamp(base.teamSynergy + j(0.08), 0.35, 0.98),
    curiosity: clamp(base.curiosity + j(0.08), 0.35, 0.98),
    tiltSensitivity: clamp(base.tiltSensitivity + j(0.06), 0.12, 0.88),
    // Legacy aliases preserved
    boldness: aggression,
    flickSpeed: flickTempo,
    checkSixRate: clamp((base.checkSixRate ?? 0.6) + j(0.08), 0.25, 0.96),
    repeekCaution: clamp((base.repeekCaution ?? 0.62) + j(0.08), 0.25, 0.94),
    reactionScale: clamp((base.reactionScale ?? 0.96) + j(0.04) - (isNv21 ? 0.05 : 0), 0.80, 1.12),
    wanderScale: clamp((base.wanderScale ?? 0.90) + j(0.06) - (isNv21 ? 0.08 : 0), 0.68, 1.15),
    habitSide: (rng ? rng() : 0.5) < 0.5 ? -1 : 1
  };
}

function mixAngle(a, b, t) {
  return a + angleDiff(b, a) * t;
}

function sectorKey(x, z) {
  return `${Math.round(x / 10)},${Math.round(z / 16)}`;
}

// ============================================================================
// CORE 1. HumanPsycheV23: 12-Dim Personality, Extended Yerkes-Dodson,
//         Team Morale Contagion, 1vX Clutch Awakening & Episodic Memory
// ============================================================================
export class HumanPsycheV23 {
  constructor(actor, rng, isNv21 = false) {
    this.rng = rng;
    this.isNv21 = !!isNv21;
    this.actorId = actor?.id ?? -1;
    this.persona = assignHumanArchetype(actor, rng, isNv21);
    this.traits = this.persona;

    // Continuous physiological & emotional states
    this.arousal = 0.30;           // 0..1 (Flow optimal zone personalized by aggression/patience)
    this.stress = 0.07;            // 0..1 (suppression / panic > 0.64)
    this.confidence = 0.04;        // -1..+1 (kill momentum vs tilt)
    this.morale = 0.0;             // -1..+1 (squad morale contagion)
    this.clutchLevel = 0.0;        // 0..1 (1vX clutch awakening)
    this.adrenaline = 0.0;         // 0..1 (acute combat/dodge rush)
    this.exertion = 0.0;           // 0..1 (sprint fatigue -> heavier respiratory sway)
    this.startle = 0.0;            // 0..1 (acute flank ambush surprise)
    this.startleUntil = -10;
    this.startleYaw = 0;

    // Combat micro-habits
    this.repeekCautiousUntil = -10;
    this.postKillReloadAt = -10;
    this.lastCombatAt = -10;
    this.strafePhase = 0;
    this.lastDamageBurst = 0;
    this.suppressionCount = 0;
    this.stateTag = '角クリア索敵';

    // Episodic Memory (persists across respawns within the match!)
    this.nemesisMap = new Map();   // enemyId -> {killedBy, killedThem, dmgTaken, lastAt}
    this.nemesisId = -1;
    this.traumaAngles = [];        // [{x, z, threatX, threatZ, weight, at}] (max 8)
    this.enemyModels = new Map();  // enemyId -> {aggression, strafeFreq, avgRange, crouchRate, lastGun, samples, prevVx, prevVz, reversals}
  }

  reset() {
    this.arousal = 0.30;
    this.stress = 0.08;
    // Carry mild match momentum & morale across respawns like a real human player!
    this.confidence *= 0.48;
    this.morale *= 0.65;
    this.clutchLevel = 0;
    this.adrenaline = 0;
    this.exertion = 0;
    this.startle = 0;
    this.startleUntil = -10;
    this.repeekCautiousUntil = -10;
    this.postKillReloadAt = -10;
    this.lastDamageBurst = 0;
    this.suppressionCount = 0;
    this.stateTag = '角クリア索敵';
    // NOTE: nemesisMap, traumaAngles, and enemyModels intentionally survive respawns!
  }

  /**
   * Extended Yerkes-Dodson Inverted-U Performance Factor (0.76..1.20):
   * Personalized optimal arousal peak + Clutch Awakening bonus + Team Morale + Confidence - High-Stress collapse.
   */
  getFlowFactor() {
    const optPeak = clamp(0.55 + (this.persona.aggression - 0.5) * 0.09 - (this.persona.patience - 0.5) * 0.05, 0.46, 0.68);
    const delta = this.arousal - optPeak;
    const invertedU = Math.exp(-(delta * delta) / 0.14); // smooth bell peak = 1.0 at optPeak
    const effectiveStress = Math.max(0, this.stress - this.clutchLevel * this.persona.clutchComposure * 0.24);
    const stressPenalty = Math.max(0, effectiveStress - 0.50) * (0.62 - this.persona.stressResilience * 0.16);
    const confBoost = clamp(this.confidence, -0.55, 0.75) * 0.12;
    const moraleBoost = clamp(this.morale, -0.6, 0.6) * 0.06;
    const clutchBoost = this.clutchLevel * this.persona.clutchComposure * 0.11;
    return clamp(0.84 + invertedU * 0.20 + confBoost + moraleBoost + clutchBoost - stressPenalty, 0.74, 1.20);
  }

  isInFlow() {
    return this.arousal >= 0.40 && this.arousal <= 0.80 && this.stress < 0.54 && (this.confidence >= 0.05 || this.clutchLevel > 0.45);
  }

  isClutching() {
    return this.clutchLevel >= 0.45;
  }

  isStartled(t) {
    return t < this.startleUntil;
  }

  isSuppressed() {
    const thresh = 0.64 + this.clutchLevel * 0.10;
    return this.stress > thresh;
  }

  shouldHesitateRepeek(t) {
    return t < this.repeekCautiousUntil;
  }

  /** Variable asymmetric human A-D-A-D strafe cadence modulated by clutch & enemy mental model. */
  nextStrafeInterval(isSpy = false, enemyId = -1) {
    this.strafePhase = (this.strafePhase + 1) % 4;
    const base = isSpy ? 0.19 : 0.27;
    const rhythms = [0.94, 0.64, 1.22, 0.82];
    const rhythm = rhythms[this.strafePhase];
    const model = enemyId >= 0 ? this.enemyModels.get(enemyId) : null;
    // Against precision marksmen (SW T / MS10) or hyper-accurate nemesis, tighten micro-jabs!
    const sharpAdjust = (model?.lastGun === 'MS10' || model?.lastGun === 'SW T' || enemyId === this.nemesisId) ? 0.86 : 1.0;
    const stressFast = 1 - this.stress * 0.20;
    return clamp((base + this.rng() * (isSpy ? 0.20 : 0.34)) * rhythm * sharpAdjust * stressFast, 0.15, 0.76);
  }

  nextStrafeSign(prevSign) {
    const flipProb = 0.74 + (prevSign === this.persona.habitSide ? -0.07 : 0.07);
    return this.rng() < flipProb ? -prevSign : prevSign;
  }

  step(actor, dt, t, seenEnemy, context = null) {
    const speed = Math.hypot(actor.vx || 0, actor.vz || 0);
    const sprinting = (actor.sprintAmt || 0) > 0.35 && speed > 4.4;
    this.exertion = clamp(this.exertion + (sprinting ? 0.24 : -0.22) * dt, 0, 1);

    // 1vX Clutch Awakening detection (strictly public match alive counts!)
    const aliveAllies = context?.aliveAllies ?? 2;
    const aliveEnemies = context?.aliveEnemies ?? 2;
    const isClutchSit = (aliveAllies === 1 && aliveEnemies >= 2)
      || (aliveAllies === 1 && aliveEnemies === 1 && actor.hp < 52);
    const targetClutch = isClutchSit ? clamp(0.65 + this.persona.clutchComposure * 0.35, 0.55, 1.0) : 0;
    this.clutchLevel += (targetClutch - this.clutchLevel) * (1 - Math.exp(-(isClutchSit ? 2.6 : 1.8) * dt));

    const engaged = !!seenEnemy || (t - this.lastCombatAt < 2.6);
    const nemesisBoost = seenEnemy && seenEnemy.id === this.nemesisId ? 0.10 : 0;
    const targetArousal = clamp((seenEnemy ? 0.62 : engaged ? 0.48 : 0.28) + this.clutchLevel * 0.14 + nemesisBoost, 0.18, 0.92);
    this.arousal += (targetArousal - this.arousal) * (1 - Math.exp(-1.55 * dt));

    const resilience = this.persona.stressResilience * (this.isNv21 ? 1.18 : 1.0) * (1 + this.clutchLevel * 0.22);
    const hpStress = actor.hp < 56 ? (56 - actor.hp) / 148 : 0;
    const targetStress = hpStress * (1.16 - resilience * 0.34);
    this.stress = clamp(this.stress + (targetStress - this.stress) * (1 - Math.exp(-(0.62 * resilience) * dt)), 0, 1);

    this.confidence *= Math.exp(-0.040 * dt);
    this.morale *= Math.exp(-0.032 * dt);
    this.adrenaline *= Math.exp(-0.85 * dt);
    this.startle *= Math.exp(-5.6 * dt);
    this.lastDamageBurst = Math.max(0, this.lastDamageBurst - dt * 16);

    // Decay old trauma danger angles smoothly (~45s half-life)
    for (let i = this.traumaAngles.length - 1; i >= 0; i--) {
      this.traumaAngles[i].weight *= Math.exp(-0.018 * dt);
      if (this.traumaAngles[i].weight < 0.08 || t - this.traumaAngles[i].at > 65) {
        this.traumaAngles.splice(i, 1);
      }
    }

    if (t < this.startleUntil) this.stateTag = '驚愕反応';
    else if (this.isClutching()) this.stateTag = 'クラッチ覚醒';
    else if (this.isSuppressed()) this.stateTag = '制圧警戒';
    else if (this.isInFlow()) this.stateTag = '集中フロー';
    else if (t < this.repeekCautiousUntil) this.stateTag = '再覗き牽制';
    else if (seenEnemy) this.stateTag = seenEnemy.id === this.nemesisId ? '宿敵対峙' : '交戦追従';
    else this.stateTag = '角クリア索敵';
  }

  /** Team morale contagion when a teammate secures a kill or falls in battle. */
  onTeamEvent(kind, t, sameArea = false) {
    const syn = 0.55 + this.persona.teamSynergy * 0.65;
    if (kind === 'ally_kill') {
      this.morale = clamp(this.morale + 0.24 * syn, -1, 1);
      this.confidence = clamp(this.confidence + 0.12 * syn, -1, 1);
      this.stress = Math.max(0, this.stress - 0.10 * syn);
    } else if (kind === 'ally_death') {
      this.morale = clamp(this.morale - 0.26 * syn, -1, 1);
      this.arousal = clamp(this.arousal + (sameArea ? 0.16 : 0.08), 0, 0.92);
      if (!this.isClutching()) {
        this.stress = clamp(this.stress + (sameArea ? 0.14 : 0.07) / Math.max(0.5, this.persona.stressResilience), 0, 1);
      }
    } else if (kind === 'shield_break_callout') {
      this.arousal = clamp(this.arousal + 0.10, 0, 0.88);
      this.confidence = clamp(this.confidence + 0.08, -1, 1);
    }
    this.lastCombatAt = Math.max(this.lastCombatAt, t - 0.5);
  }

  /** Fair-play visual observation -> updates per-enemy personal mental model. */
  observeEnemyBehavior(actor, enemy, t) {
    if (!enemy) return;
    let m = this.enemyModels.get(enemy.id);
    const d = Math.hypot(enemy.x - actor.x, enemy.z - actor.z);
    const evx = enemy.vx || 0, evz = enemy.vz || 0;
    const spd = Math.hypot(evx, evz);
    if (!m) {
      m = {
        aggression: 0.5,
        strafeFreq: 0.35,
        avgRange: d,
        crouchRate: (enemy.crouch || 0) > 0.35 ? 0.4 : 0.1,
        lastGun: enemy.gun,
        samples: 1,
        prevVx: evx,
        prevVz: evz,
        reversals: 0,
        lastObsAt: t
      };
      this.enemyModels.set(enemy.id, m);
      return;
    }
    const dt = t - m.lastObsAt;
    if (dt < 0.06) return;
    m.lastObsAt = t;
    m.samples++;
    m.lastGun = enemy.gun;
    m.avgRange = mix(m.avgRange, d, 0.14);
    m.crouchRate = mix(m.crouchRate, (enemy.crouch || 0) > 0.35 ? 1 : 0, 0.12);

    const closing = ((actor.x - enemy.x) * evx + (actor.z - enemy.z) * evz) / Math.max(1, d);
    if (closing > 1.5) m.aggression = clamp(m.aggression + 0.05, 0, 1);
    else if (closing < -1.0) m.aggression = clamp(m.aggression - 0.04, 0, 1);

    // Detect A-D strafe direction reversal in visual observations
    const dotPrev = evx * m.prevVx + evz * m.prevVz;
    if (spd > 1.8 && Math.hypot(m.prevVx, m.prevVz) > 1.8 && dotPrev < -1.5 && dt < 0.55) {
      m.reversals++;
      m.strafeFreq = clamp(m.strafeFreq + 0.10, 0.1, 1.0);
    } else {
      m.strafeFreq = mix(m.strafeFreq, spd > 2.4 ? 0.52 : 0.22, 0.05);
    }
    m.prevVx = evx;
    m.prevVz = evz;
  }

  getEnemyModel(enemyId) {
    return this.enemyModels.get(enemyId) || null;
  }

  /** Record a Trauma Danger Angle where we got ambushed or eliminated. */
  recordTraumaAngle(x, z, threatX, threatZ, weight, t) {
    for (const tr of this.traumaAngles) {
      if (Math.hypot(tr.x - x, tr.z - z) < 6.5) {
        tr.weight = clamp(tr.weight + weight * 0.65, 0, 1.5);
        tr.threatX = mix(tr.threatX, threatX, 0.45);
        tr.threatZ = mix(tr.threatZ, threatZ, 0.45);
        tr.at = t;
        return;
      }
    }
    this.traumaAngles.push({x, z, threatX, threatZ, weight: clamp(weight, 0.25, 1.4), at: t});
    if (this.traumaAngles.length > 8) {
      this.traumaAngles.sort((a, b) => b.weight - a.weight);
      this.traumaAngles.length = 8;
    }
  }

  /** Check if actor is approaching a remembered Trauma Danger Angle (for cautious pre-aim!). */
  nearestTraumaAngle(x, z, maxDist = 20) {
    let best = null, bestScore = 0;
    for (const tr of this.traumaAngles) {
      const d = Math.hypot(tr.x - x, tr.z - z);
      if (d > maxDist || tr.weight < 0.25) continue;
      const sc = tr.weight * (1 - d / maxDist);
      if (sc > bestScore) { bestScore = sc; best = tr; }
    }
    return best;
  }

  onVisualContact(t, enemy = null) {
    this.lastCombatAt = t;
    const nemBonus = enemy && enemy.id === this.nemesisId ? 0.08 : 0;
    this.arousal = clamp(this.arousal + 0.13 + nemBonus, 0, 0.92);
  }

  onBulletWhiz(dist, t) {
    this.lastCombatAt = t;
    const closeness = clamp(1 - dist / 2.5, 0.18, 1);
    const res = this.persona.stressResilience * (this.isNv21 ? 1.20 : 1.0) * (1 + this.clutchLevel * 0.25);
    this.stress = clamp(this.stress + (0.12 * closeness) / res, 0, 1);
    this.arousal = clamp(this.arousal + 0.11 * closeness, 0, 0.95);
    this.adrenaline = clamp(this.adrenaline + 0.22 * closeness, 0, 1);
    this.suppressionCount++;
  }

  onSeismicKnock(t) {
    this.lastCombatAt = t;
    const res = this.persona.stressResilience * (this.isNv21 ? 1.2 : 1.0);
    this.stress = clamp(this.stress + 0.14 / res, 0, 1);
    this.arousal = clamp(this.arousal + 0.18, 0, 0.95);
    this.adrenaline = clamp(this.adrenaline + 0.35, 0, 1);
  }

  onDamaged(actor, attacker, power, t, metrics, impactDir) {
    const quietFor = t - this.lastCombatAt;
    this.lastCombatAt = t;
    this.lastDamageBurst += power;
    const res = this.persona.stressResilience * (this.isNv21 ? 1.22 : 1.0) * (1 + this.clutchLevel * 0.24);
    this.stress = clamp(this.stress + (0.14 + power * 0.013) / res, 0, 1);
    this.arousal = clamp(this.arousal + 0.20, 0, 0.96);
    this.adrenaline = clamp(this.adrenaline + 0.30, 0, 1);
    const tilt = 0.72 + this.persona.tiltSensitivity * 0.55;
    this.confidence = clamp(this.confidence - (0.08 + power * 0.007) * tilt, -1, 1);

    if (attacker && attacker.team !== actor.team) {
      let rec = this.nemesisMap.get(attacker.id);
      if (!rec) { rec = {killedBy: 0, killedThem: 0, dmgTaken: 0, lastAt: t}; this.nemesisMap.set(attacker.id, rec); }
      rec.dmgTaken += power;
      rec.lastAt = t;
      if (power >= 12) this.recordTraumaAngle(actor.x, actor.z, attacker.x, attacker.z, 0.45, t);
    }

    // Authentic Human Re-Peek Hesitation when tagged hard or shield cracked!
    if (this.lastDamageBurst >= 13 || actor.shield <= 0) {
      const wait = (0.42 + this.rng() * 0.56) * (0.62 + this.persona.repeekCaution * 0.72) * (this.isNv21 ? 0.64 : 1.0);
      this.repeekCautiousUntil = Math.max(this.repeekCautiousUntil, t + wait);
    }

    // Rear / blind-flank ambush -> Authentic Human Startle Reflex!
    if (attacker || impactDir) {
      const dx = attacker ? attacker.x - actor.x : -impactDir[0];
      const dz = attacker ? attacker.z - actor.z : -impactDir[2];
      const threatYaw = Math.atan2(dx, -dz);
      const angOff = Math.abs(angleDiff(threatYaw, actor.yaw));
      const surprise = angOff > 0.90 || (quietFor > 3.2 && angOff > 0.45);
      if (surprise && t > this.startleUntil + 0.65) {
        const freezeDur = (this.isNv21 ? 0.075 : 0.122) + this.rng() * (this.isNv21 ? 0.042 : 0.078);
        this.startle = clamp(0.60 + (angOff / Math.PI) * 0.38, 0.5, 1.0);
        this.startleUntil = t + freezeDur;
        this.startleYaw = threatYaw;
        if (attacker) this.recordTraumaAngle(actor.x, actor.z, attacker.x, attacker.z, 0.72, t);
        if (metrics) metrics.humanStartles++;
        return {startled: true, freezeDur, threatYaw};
      }
    }
    return {startled: false, freezeDur: 0, threatYaw: actor.yaw};
  }

  onDeath(actor, killer, t) {
    if (killer && killer.team !== actor.team) {
      let rec = this.nemesisMap.get(killer.id);
      if (!rec) { rec = {killedBy: 0, killedThem: 0, dmgTaken: 0, lastAt: t}; this.nemesisMap.set(killer.id, rec); }
      rec.killedBy++;
      rec.lastAt = t;
      // Designate Nemesis if an enemy has eliminated us >= 2 times (or dominates our head-to-head)
      if (rec.killedBy >= 2 && rec.killedBy > rec.killedThem) {
        this.nemesisId = killer.id;
      }
      this.recordTraumaAngle(actor.x, actor.z, killer.x, killer.z, 1.0, t);
    }
  }

  onHitDealt(shieldBroken, t) {
    this.lastCombatAt = t;
    this.confidence = clamp(this.confidence + (shieldBroken ? 0.24 : 0.08), -1, 1);
    this.stress = Math.max(0, this.stress - (shieldBroken ? 0.15 : 0.05));
    this.arousal = clamp(this.arousal + 0.05, 0, 0.84);
  }

  onKill(t, victim = null) {
    this.lastCombatAt = t;
    const nemRevenge = victim && victim.id === this.nemesisId;
    this.confidence = clamp(this.confidence + (nemRevenge ? 0.48 : 0.36), -1, 1);
    this.morale = clamp(this.morale + (nemRevenge ? 0.28 : 0.16), -1, 1);
    this.stress = Math.max(0, this.stress - (nemRevenge ? 0.32 : 0.24));
    if (victim) {
      const rec = this.nemesisMap.get(victim.id);
      if (rec) {
        rec.killedThem++;
        if (this.nemesisId === victim.id && rec.killedThem >= rec.killedBy) this.nemesisId = -1;
      }
    }
    this.postKillReloadAt = t + 0.30 + this.rng() * 0.26;
  }
}

// ============================================================================
// CORE 2. HumanPerceptionV23: 3-Zone Retinal Vision, Saccadic Suppression,
//         +38% Attention Priming, Hick-Hyman Load, Cowan 4-Slot Working Memory,
//         Bullet-Whiz Tracer Back-Trace, Rooftop Cue, Steel Knock & Canyon Learning
// ============================================================================
export class HumanPerceptionV23 {
  constructor(rng, isNv21 = false) {
    this.rng = rng;
    this.isNv21 = !!isNv21;
    this.accum = new Map();             // enemyId -> {progress, lastUpdateAt, zone, missedCounted}
    this.workingMemory = new Map();     // Cowan K=4 capacity: enemyId -> slot
    this.maxMemorySlots = 4;
    this.primes = [];                   // [{yaw, pitch, x, z, expiresAt, source}]
    this.canyonEchoMemory = new Map();  // sectorKey -> {decoys, skepticism, lastAt}
    this.pendingEchoCheck = null;       // {sector, pos, yaw, at, isDecoy, sourceId}
    this.knockedUntil = -10;
    this.knockedContainerId = -1;
    this.knockRepositionUntil = -10;
    this.lastYaw = 0;
    this.lastYawAt = -10;
    this.lastWhizTrace = null;          // {yaw, pitch, estX, estZ, at}
    this.lastWhizAt = -10;
  }

  reset() {
    this.accum.clear();
    this.workingMemory.clear();
    this.primes.length = 0;
    this.pendingEchoCheck = null;
    this.knockedUntil = -10;
    this.knockedContainerId = -1;
    this.knockRepositionUntil = -10;
    this.lastWhizTrace = null;
    this.lastWhizAt = -10;
    // NOTE: canyonEchoMemory intentionally persists across respawns (experiential map learning!)
  }

  /** Prime directional visual attention (+38% recognition speed in +/-24 deg window). */
  primeAttention(yaw, pitch, x, z, duration, source, t) {
    this.primes.push({yaw, pitch: pitch || 0, x, z, expiresAt: t + duration, source});
    if (this.primes.length > 6) this.primes.shift();
  }

  isBearingPrimed(aimYaw, t) {
    for (let i = this.primes.length - 1; i >= 0; i--) {
      const pr = this.primes[i];
      if (t > pr.expiresAt) { this.primes.splice(i, 1); continue; }
      if (Math.abs(angleDiff(aimYaw, pr.yaw)) <= 0.42) return pr;
    }
    return null;
  }

  /**
   * Cowan 4-Slot Object Permanence Working Memory:
   * Strictly populated from fair-play sightings, arrived EchoPulse, delayed callouts, or knocks.
   */
  upsertWorkingMemory(enemyId, data, t) {
    if (enemyId < 0 || !data) return null;
    const prev = this.workingMemory.get(enemyId);
    const slot = {
      enemyId,
      x: data.x,
      y: data.y ?? 1.2,
      z: data.z,
      vx: data.vx ?? (prev?.vx || 0),
      vz: data.vz ?? (prev?.vz || 0),
      yaw: data.yaw ?? (prev?.yaw || 0),
      gun: data.gun ?? (prev?.gun || 'SRA'),
      hp: data.hp ?? (prev?.hp ?? 100),
      confidence: clamp(data.confidence ?? 0.85, 0.1, 1.0),
      source: data.source || 'visual',
      lastSeenAt: data.source === 'visual' ? t : (prev?.lastSeenAt ?? -10),
      updatedAt: t,
      elevated: (data.y ?? 0) > 1.8,
      behindMat: data.behindMat ?? (prev?.behindMat || null),
      containerId: data.containerId ?? (prev?.containerId ?? -1)
    };
    this.workingMemory.set(enemyId, slot);

    // Enforce Cowan capacity K = 4 (evict lowest confidence / stalest entry)
    if (this.workingMemory.size > this.maxMemorySlots) {
      let worstId = -1, worstScore = Infinity;
      for (const [id, s] of this.workingMemory) {
        if (id === enemyId) continue;
        const sc = s.confidence - (t - s.updatedAt) * 0.18;
        if (sc < worstScore) { worstScore = sc; worstId = id; }
      }
      if (worstId >= 0) this.workingMemory.delete(worstId);
    }
    return slot;
  }

  clearMemorySlot(enemyId) {
    this.workingMemory.delete(enemyId);
    this.accum.delete(enemyId);
  }

  /** Return freshest object-permanence memory slot (optionally projected slightly by observed velocity). */
  getPrimaryMemory(t, maxAge = 4.5) {
    let best = null, bestSc = -Infinity;
    for (const slot of this.workingMemory.values()) {
      const age = t - slot.updatedAt;
      if (age > maxAge) continue;
      const sc = slot.confidence * 2.0 - age * 0.35 + (slot.source === 'visual' ? 0.5 : 0);
      if (sc > bestSc) { bestSc = sc; best = slot; }
    }
    return best;
  }

  getMemorySlot(enemyId, t, maxAge = 4.5) {
    const slot = this.workingMemory.get(enemyId);
    if (!slot || t - slot.updatedAt > maxAge) return null;
    return slot;
  }

  /**
   * 3-Zone Retinal Vision + Saccadic Suppression + Attention Priming (+38%) + Hick-Hyman Multi-Enemy Load.
   * ONLY called after yard.js confirms direct unobstructed LOS (`obstruction > 1`) & smoke check!
   */
  evaluateSighting(actor, enemy, dt, t, mind, currentlyDuelingId = -1, metrics = null, extra = null) {
    const dx = enemy.x - actor.x;
    const dz = enemy.z - actor.z;
    const dist = Math.hypot(dx, dz);
    const aimYaw = Math.atan2(dx, -dz);
    const ang = Math.abs(angleDiff(aimYaw, actor.yaw));

    // Close-quarters (<4.5m) spatial presence registers instantaneously inside front hemisphere
    if (dist < 4.5 && ang < 1.65) {
      this.accum.set(enemy.id, {progress: 1, lastUpdateAt: t, zone: 'foveal', missedCounted: false});
      return {recognized: true, zone: 'foveal', progress: 1, ang, primed: false, saccadicSuppressed: false};
    }

    const maxFov = this.isNv21 ? 1.56 : 1.38; // ~89 deg Spy, ~79 deg Standard NV2.3
    if (ang > maxFov) {
      const prev = this.accum.get(enemy.id);
      if (prev) prev.progress = Math.max(0, prev.progress - dt * 2.5);
      return {recognized: false, zone: 'blind', progress: prev?.progress || 0, ang, primed: false, saccadicSuppressed: false};
    }

    let zone = 'foveal';
    let baseTime = this.isNv21 ? 0.048 : 0.088; // Foveal (<=18 deg / 0.314 rad)
    if (ang > 0.733) {
      zone = 'peripheral';
      baseTime = this.isNv21 ? 0.135 : 0.245;
    } else if (ang > 0.314) {
      zone = 'parafoveal';
      baseTime = this.isNv21 ? 0.080 : 0.145;
    }

    // Visual salience modifiers
    const enemySpeed = Math.hypot(enemy.vx || 0, enemy.vz || 0);
    let salience = 1.0;
    if (zone === 'foveal' && dist < 22) salience *= 1.68;
    const hasFlash = (enemy.flash || 0) > 0.008;
    if (hasFlash) salience *= 2.60;
    else if (enemySpeed > 3.5) salience *= 1.78;
    else if (enemySpeed < 0.75 && (enemy.crouch || 0) > 0.4 && zone === 'peripheral') {
      salience *= 0.50;
    }
    if (dist > 45) salience *= clamp(1 - (dist - 45) / 110, 0.56, 1.0);

    // 1. Attention Priming (+38% recognition boost when looking/primed toward cue bearing!)
    const prime = this.isBearingPrimed(aimYaw, t);
    let primed = false;
    if (prime) {
      salience *= 1.38;
      primed = true;
    }

    // 2. Saccadic Suppression during rapid head whips (|yawRate| > 4.2 rad/s)!
    let yawRate = extra?.yawRate;
    if (!Number.isFinite(yawRate)) {
      const ydt = t - this.lastYawAt;
      yawRate = ydt > 0.004 && ydt < 0.35 ? Math.abs(angleDiff(actor.yaw, this.lastYaw)) / ydt : 0;
    }
    let saccadicSuppressed = false;
    if (yawRate > 4.2 && !hasFlash && dist > 6.0) {
      const supScale = clamp(1 - (yawRate - 4.2) * 0.14, 0.28, 0.85);
      salience *= supScale;
      saccadicSuppressed = true;
      if (metrics) metrics.humanSaccadicSuppressions++;
    }

    // 3. Target fixation / Inattentional blindness when locked in a 1v1 duel
    if (currentlyDuelingId >= 0 && currentlyDuelingId !== enemy.id && zone !== 'foveal') {
      salience *= hasFlash ? 0.92 : 0.62;
    }

    // 4. Hick-Hyman Multi-Enemy Cognitive Load: RT scales as 1 + 0.16 * log2(N) for N >= 2 simultaneous enemies
    const visibleCount = Math.max(1, extra?.visibleCount || 1);
    const hickMul = visibleCount >= 2 ? (1 + 0.16 * Math.log2(visibleCount) * (mind?.isClutching() ? 0.72 : 1.0)) : 1.0;

    // 5. Flow state & persona reaction tuning
    const flow = mind ? mind.getFlowFactor() : 1.0;
    const pScale = mind?.persona?.reactionScale || 1.0;
    const reqTime = Math.max(0.028, (baseTime * pScale * hickMul) / (salience * flow));

    let entry = this.accum.get(enemy.id);
    if (!entry || t - entry.lastUpdateAt > 0.75) {
      entry = {progress: 0, lastUpdateAt: t, zone, missedCounted: false, primeCounted: false};
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
      return {recognized: false, zone, progress: entry.progress, ang, primed, saccadicSuppressed};
    }

    if (primed && !entry.primeCounted && metrics) {
      entry.primeCounted = true;
      metrics.humanPrimedSpots++;
    }

    // Experiential EchoPulse Canyon Learning: if we recently checked an echo cue and just spotted
    // the shooter at a >30 deg different bearing, learn that this container canyon echoes!
    if (this.pendingEchoCheck && t - this.pendingEchoCheck.at < 2.6) {
      const diff = Math.abs(angleDiff(aimYaw, this.pendingEchoCheck.yaw));
      if (diff > 0.52) {
        this._learnCanyonEcho(this.pendingEchoCheck.sector, t, 0.36, metrics);
        this.pendingEchoCheck = null;
      }
    }

    return {recognized: true, zone, progress: 1, ang, primed, saccadicSuppressed};
  }

  /** Update yaw tracker & decay unseen visual accumulators and Cowan working memory. */
  decayUnseen(dt, t, actor = null) {
    if (actor) {
      this.lastYaw = actor.yaw;
      this.lastYawAt = t;
    }
    for (const [id, entry] of this.accum) {
      if (t - entry.lastUpdateAt > 0.35) {
        entry.progress = Math.max(0, entry.progress - dt * 1.65);
        if (entry.progress <= 0.01) this.accum.delete(id);
      }
    }
    for (const [id, slot] of this.workingMemory) {
      const age = t - slot.updatedAt;
      slot.confidence = Math.max(0.05, slot.confidence * Math.exp(-0.18 * dt));
      if (age > 7.5 || slot.confidence <= 0.06) this.workingMemory.delete(id);
    }
    // Check if an echo cue we turned toward had no enemy at the wall (empty steel canyon bounce!)
    if (this.pendingEchoCheck && t - this.pendingEchoCheck.at > 0.95 && actor) {
      const checkAng = Math.abs(angleDiff(actor.yaw, this.pendingEchoCheck.yaw));
      if (checkAng < 0.35 && this.pendingEchoCheck.isDecoy) {
        this._learnCanyonEcho(this.pendingEchoCheck.sector, t, 0.32, null);
      }
      this.pendingEchoCheck = null;
    }
  }

  _learnCanyonEcho(sector, t, delta, metrics = null) {
    let mem = this.canyonEchoMemory.get(sector);
    if (!mem) {
      mem = {decoys: 0, skepticism: 0, lastAt: t};
      this.canyonEchoMemory.set(sector, mem);
    }
    mem.decoys++;
    mem.skepticism = clamp(mem.skepticism + delta, 0, 0.92);
    mem.lastAt = t;
    if (metrics) metrics.humanEchoLearned++;
  }

  /**
   * Bullet-Whiz Tracer Back-Trace (100% Fair-Play: uses ONLY `-shot.dir`, NEVER reads shooter position!).
   * Infers approximate firing corridor bearing with human angular fuzz & primes visual attention.
   */
  onBulletWhiz(actor, shot, dist, t, mind = null, metrics = null) {
    if (!shot?.dir) return null;
    if (t - this.lastWhizAt < 0.12 && this.lastWhizTrace) return this.lastWhizTrace;
    this.lastWhizAt = t;
    const revX = -shot.dir[0], revY = -shot.dir[1], revZ = -shot.dir[2];
    const fuzz = (this.isNv21 ? 0.11 : 0.18) * (1 + (mind?.stress || 0) * 0.35);
    const rawYaw = Math.atan2(revX, -revZ);
    const bearingYaw = rawYaw + (this.rng() - 0.5) * fuzz;
    const horiz = Math.hypot(revX, revZ) || 1;
    const bearingPitch = clamp(Math.atan2(revY, horiz) + (this.rng() - 0.5) * fuzz * 0.5, -0.55, 0.65);

    // Project approximate corridor point along visible line-of-fire (stopped by first obstacle!)
    const eye = eyeOf(actor);
    const probeDist = 18;
    const end = [eye[0] + Math.sin(bearingYaw) * probeDist, eye[1], eye[2] - Math.cos(bearingYaw) * probeDist];
    const hit = raycastMaterial(eye, end);
    const clearD = hit ? Math.max(3.5, hit.t * probeDist - 0.8) : 15;
    const estX = clamp(actor.x + Math.sin(bearingYaw) * clearD, -23, 23);
    const estZ = clamp(actor.z - Math.cos(bearingYaw) * clearD, -96, 96);

    this.primeAttention(bearingYaw, bearingPitch, estX, estZ, 2.2, 'whiz', t);
    this.lastWhizTrace = {yaw: bearingYaw, pitch: bearingPitch, estX, estZ, at: t};
    if (metrics) metrics.humanWhizTraces++;
    return this.lastWhizTrace;
  }

  /**
   * Arrived 343 m/s EchoPulse handler:
   *  - Computes 3D elevation pitch for container-roof footsteps/shots (`elevated: true`).
   *  - Applies experiential Canyon Echo Learning (`canyonEchoMemory`) so veteran NPCs learn not to get
   *    fooled repeatedly in the same corrugated steel echo canyon!
   *  - Primes visual attention (+38%) and updates Cowan working memory.
   */
  onEchoArrival(actor, rep, t, mind = null, metrics = null) {
    if (!rep?.perceivedPos) return null;
    const eye = eyeOf(actor);
    const px = rep.perceivedPos[0], py = rep.perceivedPos[1], pz = rep.perceivedPos[2];
    const dx = px - eye[0], dy = py - eye[1], dz = pz - eye[2];
    const horiz = Math.hypot(dx, dz) || 1;
    let cueYaw = Math.atan2(dx, -dz);
    const elevated = dy > 0.95;
    const cuePitch = elevated ? clamp(Math.atan2(dy, horiz), 0.14, 0.72) : -0.01;
    const sector = sectorKey(px, pz);

    // Check learned canyon echo skepticism
    const canyon = this.canyonEchoMemory.get(sector);
    let discountedEcho = false;
    let conf = rep.kind === 'fire' ? 0.72 : rep.kind === 'step' ? 0.64 : 0.68;
    if (rep.occluded && canyon && canyon.skepticism > 0.30) {
      // Learned that this steel alley produces slapback bounces -> discount raw wall reflection!
      discountedEcho = true;
      conf *= (1 - canyon.skepticism * 0.55);
      // Shift attention slightly away from the bare reflection wall toward open lane/flank
      const iq = mind?.persona?.tacticalIQ ?? 0.7;
      if (this.rng() < canyon.skepticism * iq) {
        const altSign = this.rng() < 0.5 ? -1 : 1;
        cueYaw += altSign * (0.45 + this.rng() * 0.35);
      }
      if (metrics) metrics.humanEchoLearned++;
    } else if (rep.occluded && (rep.kind === 'fire' || rep.kind === 'ricochet')) {
      this.pendingEchoCheck = {
        sector,
        pos: [px, py, pz],
        yaw: cueYaw,
        at: t,
        isDecoy: !!rep.isDecoy,
        sourceId: rep.sourceActor?.id ?? -1
      };
    }

    this.primeAttention(cueYaw, cuePitch, px, pz, elevated ? 2.4 : 1.9, elevated ? 'roof_echo' : 'echo', t);

    if (rep.sourceActor && !discountedEcho) {
      this.upsertWorkingMemory(rep.sourceActor.id, {
        x: px, y: py, z: pz,
        confidence: conf,
        source: elevated ? 'roof_echo' : 'echo'
      }, t);
    }

    return {
      yaw: cueYaw,
      pitch: cuePitch,
      elevated,
      discountedEcho,
      pos: [px, py, pz],
      urgent: rep.kind === 'fire' || rep.kind === 'ricochet' || elevated
    };
  }

  /** Victim received 5,100 m/s ResonanceCore steel knock -> immediate reposition directive! */
  onSeismicKnockVictim(actor, container, strikePoint, t, metrics = null) {
    this.knockedUntil = t + 1.8;
    this.knockedContainerId = container?.id ?? -1;
    this.knockRepositionUntil = t + 1.65;
    if (strikePoint) {
      const dx = strikePoint[0] - actor.x, dz = strikePoint[2] - actor.z;
      const yaw = Math.atan2(dx, -dz);
      this.primeAttention(yaw, 0, strikePoint[0], strikePoint[2], 2.4, 'knock', t);
    }
    if (metrics) metrics.humanKnockRepositions++;
  }

  /** Attacker heard damp-shifted hollow container knock -> confirm enemy hugging far side of container! */
  onSeismicKnockConfirmed(enemy, container, t) {
    if (!enemy || !container) return;
    this.upsertWorkingMemory(enemy.id, {
      x: container.cx,
      y: container.cy,
      z: container.cz,
      confidence: 0.86,
      source: 'resonance_knock',
      behindMat: 'steel',
      containerId: container.id
    }, t);
  }

  needsKnockReposition(t) {
    return t < this.knockRepositionUntil;
  }
}

// ============================================================================
// CORE 3. HumanOFC_AimV23: Optimal Feedback Control (OFC) + Predictive Primary
//         Saccade (Fitts + Minimum-Jerk + Undershoot Bias + Multiplicative Noise)
//         + Quiet Eye Click-Timing + Delayed Velocity-Matched Smooth Pursuit
//         + Weapon Muscle Memory + ARV Lock Patience
// ============================================================================
export class HumanOFC_AimV23 {
  constructor(rng, isNv21 = false, persona = null) {
    this.rng = rng;
    this.isNv21 = !!isNv21;
    this.persona = persona || HUMAN_ARCHETYPES.TACTICIAN;

    const rScale = this.persona.reactionScale || 0.96;
    const fScale = this.persona.flickTempo || this.persona.flickSpeed || 1.0;
    const wScale = this.persona.wanderScale || 0.90;
    const trackP = this.persona.trackingPrecision || 0.82;

    if (this.isNv21) {
      this.reactionDelay = (0.082 + rng() * 0.028) * rScale;
      this.acquireMin = 0.062;
      this.acquireMax = 0.112;
      this.maxYawRate = 10.4 * fScale;
      this.maxPitchRate = 7.6 * fScale;
      this.ofcPosGain = 14.2;
      this.ofcVelTrack = 18.0;
      this.baseWander = 0.0066 * wScale;
      this.angVelErr = 0.018 * (1.25 - trackP * 0.35);
      this.leadSkill = clamp(0.84 + trackP * 0.14 + (rng() - 0.5) * 0.08, 0.72, 1.02);
      this.recoilScale = 0.58;
      this.bloomScale = 0.58;
      this.flinchScale = 0.46;
    } else {
      this.reactionDelay = (0.145 + rng() * 0.048) * rScale;
      this.acquireMin = 0.125;
      this.acquireMax = 0.215;
      this.maxYawRate = 7.8 * fScale;
      this.maxPitchRate = 5.6 * fScale;
      this.ofcPosGain = 10.6;
      this.ofcVelTrack = 13.2;
      this.baseWander = 0.0145 * wScale;
      this.angVelErr = 0.029 * (1.25 - trackP * 0.35);
      this.leadSkill = clamp(0.68 + trackP * 0.22 + (rng() - 0.5) * 0.12, 0.56, 0.98);
      this.recoilScale = 0.88;
      this.bloomScale = 0.88;
      this.flinchScale = 0.90;
    }

    // Legacy aliases for diagnostics/tests
    this.stiffness = this.isNv21 ? 82 : 60;
    this.damping = this.isNv21 ? 15.6 : 12.6;

    // Strictly direct-LOS visual perception ring buffer
    this.targetId = -1;
    this.history = [];
    this.lastRecordAt = -10;
    this.lastSeenAt = -10;
    this.acquireReadyAt = 0;

    // Motor state machine: 'PURSUIT' | 'FLICK' | 'SETTLE' | 'QUIET_EYE'
    this.motorPhase = 'PURSUIT';
    this.flickStartAt = -10;
    this.flickDur = 0.12;
    this.flickStartYaw = 0;
    this.flickStartPitch = 0;
    this.flickGoalYaw = 0;
    this.flickGoalPitch = 0;
    this.settleUntil = -10;
    this.lastFlickGain = 1.0;

    // Physical hand angular velocity
    this.velYaw = 0;
    this.velPitch = 0;

    // Quiet Eye & ARV lock patience states
    this.quietEyeAccum = 0;
    this.quietEyeReady = false;
    this.arvWaitStart = -10;

    // Smooth OU human drift + respiratory sway + high-stress tremor
    this.phaseA = rng() * 6.283;
    this.phaseB = rng() * 6.283;
    this.breathPhase = rng() * 6.283;
    this.wanderY = 0;
    this.wanderP = 0;
    this.wanderGoalY = (rng() - 0.5) * 1.0;
    this.wanderGoalP = (rng() - 0.5) * 0.7;
    this.wanderNextAt = 0;
    this.leadNoise = 0;
    this.leadNextAt = 0;

    // Weapon-specific muscle memory recoil & flinch
    this.recoilY = 0;
    this.recoilP = 0;
    this.recoilCompP = 0;
    this.recoilCompY = 0;
    this.burstStartAt = -10;
    this.lastShotAt = -10;
    this.shotsInBurst = 0;
    this.bloom = 0;
    this.flinchY = 0;
    this.flinchP = 0;
    this.lastTgtVx = 0;
    this.lastTgtVz = 0;
    this.strafeShock = 0;

    // Telemetry
    this.avgErrorRad = 0;
    this.samples = 0;
    this.flickCount = 0;
    this.overshootCount = 0;
    this.undershootCount = 0;
  }

  reset(t = 0) {
    this.targetId = -1;
    this.history.length = 0;
    this.lastRecordAt = -10;
    this.lastSeenAt = -10;
    this.acquireReadyAt = t + 0.14;
    this.motorPhase = 'PURSUIT';
    this.velYaw = 0;
    this.velPitch = 0;
    this.quietEyeAccum = 0;
    this.quietEyeReady = false;
    this.arvWaitStart = -10;
    this.recoilY = 0;
    this.recoilP = 0;
    this.recoilCompP = 0;
    this.recoilCompY = 0;
    this.shotsInBurst = 0;
    this.bloom = 0;
    this.flinchY = 0;
    this.flinchP = 0;
    this.strafeShock = 0;
  }

  /**
   * Predictive Primary Saccade:
   *  - Fitts's Law duration T = (a + b * log2(1 + D / W)) / flickTempo
   *  - Minimum-Jerk quintic trajectory s(u) = 10u^3 - 15u^4 + 6u^5
   *  - Authentic human undershoot tendency (~0.935x normal) + Harris & Wolpert signal-dependent multiplicative noise
   *    (under startle/stress, widens and produces realistic panic overshoot!)
   */
  triggerBallisticFlick(curYaw, curPitch, targetYaw, targetPitch, t, stress = 0, startled = false, metrics = null, targetDist = 20) {
    const dy = angleDiff(targetYaw, curYaw);
    const dp = targetPitch - curPitch;
    const amp = Math.hypot(dy, dp);
    if (amp < 0.12) return false;

    const fScale = this.persona.flickTempo || this.persona.flickSpeed || 1.0;
    const targetWidthRad = clamp(0.39 / Math.max(4, targetDist), 0.016, 0.075);
    const baseA = this.isNv21 ? 0.036 : 0.048;
    const baseB = this.isNv21 ? 0.042 : 0.060;
    const fittsDur = (baseA + baseB * Math.log2(1 + amp / targetWidthRad)) / fScale;
    this.flickDur = clamp(fittsDur * (startled ? 0.88 : 1.0), 0.052, 0.27);

    // Meyer et al. undershoot bias (~0.935x) + Harris & Wolpert signal-dependent multiplicative noise!
    const gainMean = startled ? 1.045 : (this.isNv21 ? 0.955 : 0.935);
    const sigma = (this.isNv21 ? 0.052 : 0.088) * (1 + stress * 0.50 + (startled ? 0.68 : 0));
    const triNoise = (this.rng() + this.rng() - 1.0) * sigma * 1.45; // symmetric bell-like distribution
    const gainErr = clamp(gainMean + triNoise, 0.72, 1.28);
    this.lastFlickGain = gainErr;

    if (gainErr > 1.035) {
      this.overshootCount++;
      if (metrics) metrics.humanOvershoots++;
    } else if (gainErr < 0.965) {
      this.undershootCount++;
    }

    const crossErr = (this.rng() - 0.5) * amp * sigma * 0.38;

    this.motorPhase = 'FLICK';
    this.flickStartAt = t;
    this.flickStartYaw = curYaw;
    this.flickStartPitch = curPitch;
    this.flickGoalYaw = curYaw + dy * gainErr;
    this.flickGoalPitch = clamp(curPitch + dp * gainErr + crossErr, -0.88, 0.88);
    // Brief visual-verification settle before corrective micro-saccade completes
    this.settleUntil = t + this.flickDur + (this.isNv21 ? 0.032 : 0.054) + this.rng() * 0.022;
    this.quietEyeAccum = 0;
    this.flickCount++;
    if (metrics) metrics.humanFlicks++;
    return true;
  }

  observeVisibleTarget(target, t, ambushPreAim = false, primed = false) {
    const tp = targetPoint(target);
    const switched = target.id !== this.targetId;
    const reacquired = t - this.lastSeenAt > 0.55;

    if (switched || reacquired) {
      this.targetId = target.id;
      this.history.length = 0;
      const baseAcq = mix(this.acquireMin, this.acquireMax, this.rng());
      const acqMul = ambushPreAim ? 0.48 : primed ? 0.70 : 1.0;
      this.acquireReadyAt = t + baseAcq * acqMul;
      this.quietEyeAccum = 0;
      this.arvWaitStart = -10;
      this.wanderGoalY = (this.rng() - 0.5) * (this.isNv21 ? 0.95 : 1.35);
      this.wanderGoalP = (this.rng() - 0.5) * (this.isNv21 ? 0.72 : 1.00);
      this.lastTgtVx = target.vx || 0;
      this.lastTgtVz = target.vz || 0;
    }

    const dvx = (target.vx || 0) - this.lastTgtVx;
    const dvz = (target.vz || 0) - this.lastTgtVz;
    const accelJump = Math.hypot(dvx, dvz);
    // Abrupt A-D reversal spikes tracking shock -> crosshair authentically swims past!
    if (!switched && accelJump > 2.4) {
      this.strafeShock = clamp(this.strafeShock + accelJump * (this.isNv21 ? 0.044 : 0.088), 0, 1.25);
      this.quietEyeAccum *= 0.35;
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
      while (this.history.length > 38 || (this.history.length > 2 && t - this.history[0].t > 0.54)) {
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
    const prof = WEAPON_RECOIL_PROFILE[gun] || WEAPON_RECOIL_PROFILE.SRA;
    const s = this.recoilScale;
    if (t - this.lastShotAt > 0.34) {
      this.burstStartAt = t;
      this.recoilCompP = 0;
      this.recoilCompY = 0;
      this.shotsInBurst = 0;
    }
    this.lastShotAt = t;
    this.shotsInBurst++;
    // Weapon-specific vertical climb + recognizable horizontal drift pattern
    this.recoilP = clamp(this.recoilP + prof.kickP * s * (0.74 + this.rng() * 0.52), -0.02, 0.050);
    const driftDir = prof.driftBias * Math.sin(this.shotsInBurst * 0.85) + (this.rng() - 0.5) * 1.15;
    this.recoilY = clamp(this.recoilY + driftDir * prof.kickY * s, -0.036, 0.036);
    this.bloom = clamp(this.bloom + (isBursting ? prof.bloomPerShot * 1.32 : prof.bloomPerShot) * this.bloomScale, 0, 0.024);
  }

  onHitShock(power = 6, startled = false) {
    const mag = (0.0080 + power * 0.0013) * this.flinchScale * (startled ? 1.46 : 1.0);
    this.flinchP = clamp(this.flinchP + mag * (0.50 + this.rng() * 0.55), -0.055, 0.068);
    this.flinchY = clamp(this.flinchY + (this.rng() - 0.5) * mag * 2.1, -0.055, 0.055);
    this.strafeShock = clamp(this.strafeShock + (startled ? 0.52 : 0.30) * this.flinchScale, 0, 1.25);
    this.quietEyeAccum *= 0.25;
  }

  onWhizShock() {
    const mag = 0.0048 * this.flinchScale;
    this.flinchY = clamp(this.flinchY + (this.rng() - 0.5) * mag * 1.65, -0.040, 0.040);
    this.flinchP = clamp(this.flinchP + (this.rng() - 0.35) * mag, -0.036, 0.040);
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
      primed = false,
      mind = null,
      metrics = null
    } = opts;

    const stress = mind ? mind.stress : 0.1;
    const exertion = mind ? mind.exertion : 0;
    const flow = mind ? mind.getFlowFactor() : 1.0;
    const startled = mind ? mind.isStartled(t) : false;
    const clutch = mind ? mind.clutchLevel : 0;
    const gunProf = WEAPON_RECOIL_PROFILE[a.gun] || WEAPON_RECOIL_PROFILE.SRA;

    // 1. Weapon-Specific Recoil Muscle Memory (delayed ~95ms recognition, then crisp pull-down + drift counter!)
    const spraying = t - this.lastShotAt < 0.28;
    const sprayAge = t - this.burstStartAt;
    const recLag = this.isNv21 ? 0.080 : 0.098;
    if (spraying && sprayAge > recLag) {
      const mastery = clamp(gunProf.pullSkill * (0.86 + (this.persona.burstDiscipline || 0.75) * 0.18) * flow, 0.70, 0.95);
      const kPull = 1 - Math.exp(-12.5 * dt);
      this.recoilCompP = mix(this.recoilCompP, this.recoilP * mastery, kPull);
      this.recoilCompY = mix(this.recoilCompY, this.recoilY * (mastery * 0.22), kPull);
    } else if (!spraying) {
      const kRel = Math.exp(-10.5 * dt);
      this.recoilCompP *= kRel;
      this.recoilCompY *= kRel;
    }

    const recDecay = Math.exp(-(this.isNv21 ? 12.0 : 9.2) * dt);
    this.recoilY *= recDecay;
    this.recoilP *= recDecay;
    this.bloom = Math.max(0, this.bloom - dt * (this.isNv21 ? 0.050 : 0.036));
    const flDecay = Math.exp(-(this.isNv21 ? 12.5 : 9.0) * dt);
    this.flinchY *= flDecay;
    this.flinchP *= flDecay;
    this.strafeShock *= Math.exp(-(this.isNv21 ? 5.8 : 4.2) * dt);

    // 2. Smooth OU Human Drift + Respiratory Sway (steadied in Clutch/Quiet Eye) + Stress Tremor
    if (t >= this.wanderNextAt) {
      this.wanderGoalY = (this.rng() - 0.5) * 1.75;
      this.wanderGoalP = (this.rng() - 0.5) * 1.15;
      this.wanderNextAt = t + (this.isNv21 ? 0.14 + this.rng() * 0.14 : 0.18 + this.rng() * 0.22);
    }
    if (t >= this.leadNextAt) {
      this.leadNoise = (this.rng() - 0.5) * (this.isNv21 ? 0.16 : 0.28);
      this.leadNextAt = t + 0.30 + this.rng() * 0.34;
    }
    const wSmooth = 1 - Math.exp(-(this.isNv21 ? 7.2 : 5.2) * dt);
    this.wanderY += (this.wanderGoalY - this.wanderY) * wSmooth;
    this.wanderP += (this.wanderGoalP - this.wanderP) * wSmooth;

    const breathHz = 0.27 + exertion * 0.17 + stress * 0.13 - clutch * 0.05;
    this.breathPhase += dt * Math.max(0.18, breathHz) * Math.PI * 2;
    const breathAmp = (1 + exertion * 0.52 + stress * 0.30) * (1 - clutch * 0.18);
    const breathY = (Math.sin(this.breathPhase + this.phaseA) * 0.15 + Math.sin(t * 5.0 + this.phaseB) * 0.05) * breathAmp;
    const breathP = (Math.cos(this.breathPhase + this.phaseB) * 0.16 + Math.sin(t * 4.2 + this.phaseA) * 0.05) * breathAmp;
    const tremor = stress > 0.58 ? (stress - 0.58) * (1 - clutch * 0.35) * 0.0080 : 0;
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
    let percOmegaYaw = 0;
    let percOmegaPitch = 0;
    let targetHalfWidth = 0.035;
    let holdingForArv = false;
    let quietEyeShot = false;

    if (seenTarget) {
      const prevTgtId = this.targetId;
      this.observeVisibleTarget(seenTarget, t, backstabBonus, primed);
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
        targetHalfWidth = clamp(0.39 / Math.max(2.5, pDist), 0.011, 0.095);

        // Delayed target angular velocity for velocity-matched Smooth Pursuit (self-strafe parallax corrected via OFC feedback!)
        const relVx = perc.vx;
        const relVz = perc.vz;
        percOmegaYaw = clamp((-pdz * relVx + pdx * relVz) / (pHoriz * pHoriz), -5.5, 5.5);
        const radVel = (pdx * relVx + pdz * relVz) / pHoriz;
        percOmegaPitch = clamp((pHoriz * perc.vy - pdy * radVel) / Math.max(1, pDist * pDist), -3.5, 3.5);
        targetAngSpeed = Math.abs(percOmegaYaw);

        // Delayed ballistic lead + partial human reaction-delay velocity extrapolation
        const leadT = clamp(pDist / Math.max(80, wpn.speed), 0, 0.36);
        const leadMul = clamp(this.leadSkill + this.leadNoise, 0.44, 1.05);
        const extrapT = this.reactionDelay * (this.isNv21 ? 0.86 : 0.76);
        const aimX = perc.x + perc.vx * (leadT * leadMul + extrapT);
        const aimY = perc.y + perc.vy * (leadT * 0.40 + extrapT * 0.28) + (perc.onGround ? 0 : 0.04);
        const aimZ = perc.z + perc.vz * (leadT * leadMul + extrapT);

        const rx = aimX - eye[0], ry = aimY - eye[1], rz = aimZ - eye[2];
        idealYaw = Math.atan2(rx, -rz);
        idealPitch = clamp(Math.atan2(ry, Math.hypot(rx, rz)), -0.78, 0.78);

        // Trigger Predictive Primary Saccade (Fitts + Minimum-Jerk + Undershoot) on target switch or large angle!
        const errMag = Math.hypot(angleDiff(idealYaw, a.yaw), idealPitch - a.pitch);
        if ((prevTgtId !== seenTarget.id || errMag > 0.30) && this.motorPhase !== 'FLICK' && errMag > 0.13) {
          this.triggerBallisticFlick(a.yaw, a.pitch, idealYaw, idealPitch, t, stress, startled, metrics, pDist);
        }

        // Dynamic human hand error envelope
        const ownSpeed = Math.hypot(a.vx, a.vz);
        const moveMul = counterStrafing ? 0.62
          : !a.onGround ? 1.54
          : dodging ? (this.isNv21 ? 1.15 : 1.32)
          : (1 + clamp(ownSpeed / 4.8, 0, 1.15) * (this.isNv21 ? 0.24 : 0.46));
        const stanceMul = (1 - a.crouch * 0.24 - a.aimPose * 0.14) * (backstabBonus ? 0.72 : 1.0);
        const rangeMul = 0.86 + clamp((pDist - 12) / 50, 0, 0.42);
        const stressErr = targetAngSpeed * this.angVelErr + this.strafeShock * (this.isNv21 ? 0.011 : 0.019);
        const flowDiv = 1 / Math.max(0.76, flow);
        const errAmp = (this.baseWander * moveMul * stanceMul * rangeMul * flowDiv) + stressErr + this.bloom;

        const netRecoilP = Math.max(-0.012, this.recoilP - this.recoilCompP);
        const netRecoilY = this.recoilY - this.recoilCompY;
        idealYaw += (this.wanderY * 0.90 + breathY) * errAmp + netRecoilY + this.flinchY + tremorY;
        idealPitch = clamp(
          idealPitch + (this.wanderP * 0.74 + breathP) * errAmp * 0.70 + netRecoilP + this.flinchP + tremorP,
          -0.88, 0.88
        );

        // Quiet Eye pre-shot stabilization accumulation
        const curAlign = Math.hypot(angleDiff(idealYaw, a.yaw), (idealPitch - a.pitch) * 0.8);
        const velErr = Math.abs(this.velYaw - percOmegaYaw);
        const quietTol = clamp(targetHalfWidth * 1.55, 0.026, 0.090);
        if (this.motorPhase !== 'FLICK' && !startled && curAlign < quietTol && velErr < 2.2) {
          this.quietEyeAccum = Math.min(0.25, this.quietEyeAccum + dt);
        } else {
          this.quietEyeAccum = Math.max(0, this.quietEyeAccum - dt * 3.2);
        }
        const quietReq = gunProf.quietReq * (this.isNv21 ? 0.75 : 1.0) / Math.max(0.85, flow);
        this.quietEyeReady = this.quietEyeAccum >= quietReq;

        // First-shot Quiet Eye click timing gate (skip wait in CQB < 13m, mid-spray, high panic, or after 0.14s patience cap)
        const needQuietGate = dist >= 13 && !spraying && stress < 0.68 && t < this.acquireReadyAt + 0.14;
        const clickGateOk = !needQuietGate || this.quietEyeReady || curAlign < targetHalfWidth * 0.65;
        quietEyeShot = this.quietEyeReady;

        // Weapon ARV1.1 / ARV1.1 mini lock patience (RD20 / RD30 / RD40 / DF1 OUT)
        const lockObj = a.rd || a.df;
        if (gunProf.arvWait && lockObj && !lockObj.locked && lockObj.focus >= 0.58 && dist > 14 && stress < 0.72) {
          if (this.arvWaitStart < 0) this.arvWaitStart = t;
          if (t - this.arvWaitStart < 0.17) holdingForArv = true;
        } else if (lockObj?.locked && this.arvWaitStart > 0) {
          if (metrics) metrics.humanArvWaits++;
          this.arvWaitStart = -10;
        } else {
          this.arvWaitStart = -10;
        }

        readyToFire = t >= this.acquireReadyAt && !startled && this.motorPhase !== 'FLICK' && clickGateOk && !holdingForArv;
      }
    } else if (suppressPos) {
      const rx = suppressPos[0] - eye[0], ry = suppressPos[1] - eye[1], rz = suppressPos[2] - eye[2];
      dist = Math.hypot(rx, ry, rz);
      idealYaw = Math.atan2(rx, -rz) + (this.wanderY * 0.036 + (this.recoilY - this.recoilCompY));
      idealPitch = clamp(Math.atan2(ry, Math.hypot(rx, rz)) + (this.wanderP * 0.026 + Math.max(0, this.recoilP - this.recoilCompP)), -0.78, 0.78);
      trueYaw = idealYaw;
      truePitch = idealPitch;
      readyToFire = !startled;
    } else {
      if (t - this.lastSeenAt > 0.85) this.history.length = 0;
      this.quietEyeAccum = 0;
      this.arvWaitStart = -10;
      if (this.motorPhase !== 'PURSUIT' && t >= this.settleUntil) this.motorPhase = 'PURSUIT';
    }

    // 3. Execute Biomechanical Control: Minimum-Jerk FLICK -> SETTLE -> OFC + Velocity-Matched Smooth Pursuit!
    if (this.motorPhase === 'FLICK') {
      const u = clamp((t - this.flickStartAt) / Math.max(0.04, this.flickDur), 0, 1);
      const u2 = u * u, u3 = u2 * u;
      const s = u3 * (10 - 15 * u + 6 * u2);
      const ds = (30 * u2 * (1 - u) * (1 - u)) / Math.max(0.04, this.flickDur);
      const dYaw = angleDiff(this.flickGoalYaw, this.flickStartYaw);
      const dPitch = this.flickGoalPitch - this.flickStartPitch;
      a.yaw = this.flickStartYaw + dYaw * s;
      a.pitch = clamp(this.flickStartPitch + dPitch * s, -0.92, 0.92);
      this.velYaw = dYaw * ds * 0.42;
      this.velPitch = dPitch * ds * 0.42;
      if (u >= 1) this.motorPhase = 'SETTLE';
    } else {
      if (this.motorPhase === 'SETTLE' && t >= this.settleUntil) {
        this.motorPhase = this.quietEyeReady ? 'QUIET_EYE' : 'PURSUIT';
      } else if (this.motorPhase === 'PURSUIT' && this.quietEyeReady) {
        this.motorPhase = 'QUIET_EYE';
      } else if (this.motorPhase === 'QUIET_EYE' && !this.quietEyeReady) {
        this.motorPhase = 'PURSUIT';
      }

      const errY = angleDiff(idealYaw, a.yaw);
      const errP = idealPitch - a.pitch;
      const active = !!(seenTarget || suppressPos);
      const settleMul = this.motorPhase === 'SETTLE' ? 0.86 : 1.0;

      // Optimal Feedback Control (Todorov minimum-intervention scaling inside target envelope)
      const errNormY = Math.abs(errY) / Math.max(0.014, targetHalfWidth);
      const errNormP = Math.abs(errP) / Math.max(0.014, targetHalfWidth);
      const ofcGainY = active ? (0.72 + 0.38 * clamp(errNormY, 0, 1.35)) * settleMul * flow : 0.54;
      const ofcGainP = active ? (0.72 + 0.38 * clamp(errNormP, 0, 1.35)) * settleMul * flow : 0.52;

      // Delayed Velocity-Matched Smooth Pursuit feedforward (drops during abrupt A-D reversal shock!)
      const trackSkill = this.persona.trackingPrecision || 0.82;
      const pursuitGain = seenTarget
        ? clamp((0.76 + trackSkill * 0.20) * flow - this.strafeShock * 0.42, 0.25, 0.96)
        : 0;

      const maxY = (active ? this.maxYawRate : this.maxYawRate * 0.72) * (1 - a.aimPose * 0.08);
      const maxP = active ? this.maxPitchRate : this.maxPitchRate * 0.68;

      const desiredVelY = clamp(this.ofcPosGain * ofcGainY * errY + pursuitGain * percOmegaYaw, -maxY, maxY);
      const desiredVelP = clamp(this.ofcPosGain * 0.88 * ofcGainP * errP + pursuitGain * percOmegaPitch * 0.85, -maxP, maxP);

      const sdt = Math.min(dt, 0.025);
      const kVel = 1 - Math.exp(-(active ? this.ofcVelTrack : this.ofcVelTrack * 0.62) * sdt);
      this.velYaw += (desiredVelY - this.velYaw) * kVel;
      this.velPitch += (desiredVelP - this.velPitch) * kVel;

      a.yaw += this.velYaw * dt;
      a.pitch = clamp(a.pitch + this.velPitch * dt, -0.92, 0.92);
    }

    const alignPerceived = Math.hypot(angleDiff(idealYaw, a.yaw), (idealPitch - a.pitch) * 0.8);
    const alignTrue = Math.hypot(angleDiff(trueYaw, a.yaw), (truePitch - a.pitch) * 0.8);
    if (seenTarget) {
      this.samples++;
      this.avgErrorRad += (alignTrue - this.avgErrorRad) * 0.04;
    }

    const bloomCap = 0.013 + (1 - (this.persona.burstDiscipline || 0.76)) * 0.010;
    const wantBurstReset = this.bloom > bloomCap && dist > 20;
    const ownMoveSpread = counterStrafing ? 0.70 : (1 + clamp(Math.hypot(a.vx, a.vz) / 4.6, 0, 1.2) * (this.isNv21 ? 0.25 : 0.48));
    const quietTighten = quietEyeShot ? 0.88 : 1.0;
    const microSpread = (((this.isNv21 ? 0.0062 : 0.0132) + this.bloom * 0.38) * ownMoveSpread * quietTighten) / Math.max(0.84, flow);

    return {
      readyToFire,
      alignPerceived,
      alignTrue,
      dist,
      microSpread,
      targetAngSpeed,
      motorPhase: this.motorPhase,
      wantBurstReset,
      quietEyeShot,
      holdingForArv,
      yawRate: Math.abs(this.velYaw)
    };
  }
}

// ============================================================================
// CORE 4. HumanGazeV23: 9-Ray Depth-Discontinuity Container Corner Pre-Aim
//         (Cutting the Pie) + Buddy Mutual-Cover Gaze Sharing + Rooftop Look-Up
// ============================================================================
const GAZE_RAYS_9 = [-0.84, -0.60, -0.38, -0.18, 0.0, 0.18, 0.38, 0.60, 0.84];

export class HumanGazeV23 {
  constructor(rng, persona, isNv21 = false) {
    this.rng = rng;
    this.persona = persona || HUMAN_ARCHETYPES.TACTICIAN;
    this.isNv21 = !!isNv21;
    this.nextSliceAt = 0;
    this.sliceYaw = 0;
    this.slicePitch = -0.012;
    this.soundFocusYaw = 0;
    this.soundFocusPitch = -0.01;
    this.soundFocusUntil = -10;
    this.whizFocusYaw = 0;
    this.whizFocusPitch = 0;
    this.whizFocusUntil = -10;
    this.checkSixYaw = 0;
    this.checkSixUntil = -10;
    this.nextCheckSixAt = 3.8 + rng() * 4.2;
    this.lastEdgeDetected = false;
    this._depths = new Float32Array(9);
    this._rayYaws = new Float32Array(9);
    this._rayEnd = [0, 0, 0];
  }

  reset(t = 0) {
    this.nextSliceAt = t;
    this.soundFocusUntil = -10;
    this.whizFocusUntil = -10;
    this.checkSixUntil = -10;
    this.nextCheckSixAt = t + 3.8 + this.rng() * 4.2;
    this.lastEdgeDetected = false;
  }

  /** Acoustic curiosity head-turn with 3D rooftop elevation pitch! */
  onAcousticCue(actor, perceivedPos, t, isUrgent = false, metrics = null, explicitPitch = null) {
    if (!perceivedPos) return;
    const eye = eyeOf(actor);
    const dx = perceivedPos[0] - eye[0];
    const dy = (perceivedPos[1] ?? eye[1]) - eye[1];
    const dz = perceivedPos[2] - eye[2];
    const horiz = Math.hypot(dx, dz);
    if (horiz < 1.2 && Math.abs(dy) < 0.8) return;
    const elevated = dy > 0.95;
    if (!isUrgent && !elevated && this.rng() > this.persona.curiosity) return;
    this.soundFocusYaw = Math.atan2(dx, -dz);
    this.soundFocusPitch = explicitPitch !== null
      ? explicitPitch
      : elevated ? clamp(Math.atan2(dy, Math.max(1, horiz)), 0.14, 0.72) : -0.01;
    this.soundFocusUntil = t + (isUrgent || elevated ? 1.25 : 0.70) + this.rng() * 0.40;
    if (metrics) {
      metrics.humanCornerScans++;
      if (elevated) metrics.humanRoofLookups++;
    }
  }

  /** Tracer back-trace snap toward incoming bullet line! */
  onWhizCue(yaw, pitch, t) {
    this.whizFocusYaw = yaw;
    this.whizFocusPitch = clamp(pitch || 0, -0.45, 0.55);
    this.whizFocusUntil = t + 0.95;
  }

  /**
   * 9-Ray Depth-Discontinuity Corner-Edge Scanner + Buddy Mutual-Cover Sector Sharing:
   *  1) Startle whip toward ambush bearing
   *  2) Bullet-whiz tracer back-trace snap
   *  3) Acoustic curiosity / Rooftop upward look
   *  4) Post-peek corner hold (using Cowan working memory or lastSeenTargetPos)
   *  5) Buddy Mutual-Cover Check-Six / Uncovered Sector Watch
   *  6) 9-Ray Depth-Discontinuity Edge Detection (locks onto container corners & slices the pie!)
   */
  computeIdleGaze(actor, b, moveYaw, t, mind, metrics = null, ctx = null) {
    // 1. Acute startle whip toward surprise ambush
    if (mind && mind.isStartled(t)) {
      return {yaw: mind.startleYaw, pitch: 0.0, edgeLocked: false};
    }

    // 2. Tracer back-trace glance
    if (t < this.whizFocusUntil) {
      return {yaw: this.whizFocusYaw, pitch: this.whizFocusPitch, edgeLocked: false};
    }

    // 3. Acoustic curiosity / Rooftop upward gaze
    if (t < this.soundFocusUntil) {
      return {yaw: this.soundFocusYaw, pitch: this.soundFocusPitch, edgeLocked: false};
    }

    // 4. Post-peek corner / smoke-edge hold on recently vanished enemy
    if (b.smokeWatchYaw !== undefined && t < (b.smokeWatchUntil || -10)) {
      return {yaw: b.smokeWatchYaw, pitch: -0.01, edgeLocked: true};
    }
    const holdDur = 1.3 + this.persona.patience * 1.4;
    if (b.lastSeenTargetPos && t - (b.lastSeenTargetAt || -10) < holdDur) {
      const eye = eyeOf(actor);
      const dx = b.lastSeenTargetPos[0] - eye[0];
      const dy = b.lastSeenTargetPos[1] - eye[1];
      const dz = b.lastSeenTargetPos[2] - eye[2];
      const horiz = Math.hypot(dx, dz);
      if (horiz > 1.8) {
        return {yaw: Math.atan2(dx, -dz), pitch: clamp(Math.atan2(dy, horiz), -0.35, 0.58), edgeLocked: true};
      }
    }

    // 5. Buddy Mutual-Cover Gaze Sharing & Periodic Check-Six!
    if (t < this.checkSixUntil) {
      return {yaw: this.checkSixYaw, pitch: -0.012, edgeLocked: false};
    }
    const allies = ctx?.allies || null;
    if (t >= this.nextCheckSixAt && b.state !== '戦術退避') {
      const rate = this.persona.checkSixRate || 0.65;
      this.nextCheckSixAt = t + (3.6 + this.rng() * 4.4) / Math.max(0.35, rate);
      let checkYaw = moveYaw + (this.rng() < 0.5 ? -1 : 1) * (1.15 + this.rng() * 0.72);
      // If a nearby buddy is already watching the forward/left sector, deliberately cover the opposite / rear-six sector!
      if (allies && allies.length) {
        let nearBuddy = null, bestD = 22;
        for (const mate of allies) {
          if (mate.id === actor.id || !mate.alive) continue;
          const d = Math.hypot(mate.x - actor.x, mate.z - actor.z);
          if (d < bestD) { bestD = d; nearBuddy = mate; }
        }
        if (nearBuddy) {
          const mateRel = angleDiff(nearBuddy.yaw, moveYaw);
          if (Math.abs(mateRel) < 0.65) {
            // Buddy watches front -> check rear/side blind flank!
            const side = mateRel >= 0 ? -1 : 1;
            checkYaw = moveYaw + side * (1.75 + this.rng() * 0.85);
            if (metrics) metrics.humanBuddyCoverGaze++;
          }
        }
      }
      this.checkSixYaw = checkYaw;
      this.checkSixUntil = t + 0.28 + this.rng() * 0.18;
      if (metrics) metrics.humanCheckSix++;
      return {yaw: this.checkSixYaw, pitch: -0.012, edgeLocked: false};
    }

    // 6. 9-Ray Depth-Discontinuity Corner-Edge Detection (runs at ~5Hz -> <0.008ms/tick amortized!)
    if (t >= this.nextSliceAt) {
      this.nextSliceAt = t + 0.19 + this.rng() * 0.06;
      const eye = eyeOf(actor);

      // Compute primary threat heading from Cowan working memory, Trauma danger angle, or lastPos
      const mem = b.vision?.getPrimaryMemory(t, 4.8);
      const trauma = mind?.nearestTraumaAngle(actor.x, actor.z, 22);
      let threatYaw = moveYaw;
      let hasThreat = false;
      if (mem) {
        threatYaw = Math.atan2(mem.x - actor.x, -(mem.z - actor.z));
        hasThreat = true;
      } else if (b.lastPos) {
        threatYaw = Math.atan2(b.lastPos[0] - actor.x, -(b.lastPos[1] - actor.z));
        hasThreat = true;
      } else if (trauma) {
        threatYaw = Math.atan2(trauma.threatX - actor.x, -(trauma.threatZ - actor.z));
        hasThreat = true;
      }

      // Check buddy watch sector so two side-by-side teammates split angles instead of staring identically!
      let buddyYaw = null;
      if (allies && allies.length) {
        let bestD = 18;
        for (const mate of allies) {
          if (mate.id === actor.id || !mate.alive) continue;
          const d = Math.hypot(mate.x - actor.x, mate.z - actor.z);
          if (d < bestD) { bestD = d; buddyYaw = mate.yaw; }
        }
      }

      const baseYaw = hasThreat ? mixAngle(moveYaw, threatYaw, 0.56) : moveYaw;
      const maxRange = 22;
      const depths = this._depths;
      const rayYaws = this._rayYaws;
      const end = this._rayEnd;
      end[1] = eye[1];
      for (let i = 0; i < 9; i++) {
        const y = baseYaw + GAZE_RAYS_9[i];
        rayYaws[i] = y;
        end[0] = eye[0] + Math.sin(y) * maxRange;
        end[2] = eye[2] - Math.cos(y) * maxRange;
        const hit = raycastMaterial(eye, end);
        depths[i] = hit ? hit.t * maxRange : maxRange;
      }

      // Detect sharp depth discontinuities (container corner edges: near wall < 11m next to open lane > near + 4.2m!)
      let bestEdgeYaw = null, bestEdgeScore = -Infinity;
      for (let i = 0; i < 8; i++) {
        const dA = depths[i], dB = depths[i + 1];
        const jump = Math.abs(dB - dA);
        const nearD = Math.min(dA, dB);
        const farD = Math.max(dA, dB);
        if (jump >= 4.2 && nearD <= 11.5 && farD >= 8.0) {
          // Place crosshair tightly on the OPEN side of the container corner edge (true cutting-the-pie!)
          const openYaw = dB > dA ? mixAngle(rayYaws[i], rayYaws[i + 1], 0.68) : mixAngle(rayYaws[i + 1], rayYaws[i], 0.68);
          let sc = jump * 1.15 + farD * 0.45 - Math.abs(angleDiff(openYaw, threatYaw)) * 7.5;
          if (buddyYaw !== null) {
            const sepFromBuddy = Math.abs(angleDiff(openYaw, buddyYaw));
            if (sepFromBuddy > 0.65) sc += 4.5; // split sightline with buddy!
            else sc -= 3.0;
          }
          if (sc > bestEdgeScore) { bestEdgeScore = sc; bestEdgeYaw = openYaw; }
        }
      }

      if (bestEdgeYaw !== null) {
        this.sliceYaw = bestEdgeYaw;
        this.slicePitch = -0.01 + (this.rng() - 0.5) * 0.016;
        this.lastEdgeDetected = true;
        if (metrics) {
          metrics.humanCornerEdges++;
          metrics.humanCornerScans++;
          if (buddyYaw !== null && Math.abs(angleDiff(bestEdgeYaw, buddyYaw)) > 0.65) {
            metrics.humanBuddyCoverGaze++;
          }
        }
      } else {
        // No close corner edge -> aim down deepest unobstructed lane biased toward threat & away from buddy overlap
        let bestYaw = baseYaw, bestScore = -Infinity;
        for (let i = 0; i < 9; i++) {
          let sc = depths[i] - Math.abs(GAZE_RAYS_9[i]) * 2.4 - Math.abs(angleDiff(rayYaws[i], threatYaw)) * 3.0;
          if (buddyYaw !== null && Math.abs(angleDiff(rayYaws[i], buddyYaw)) > 0.70) sc += 3.2;
          if (sc > bestScore) { bestScore = sc; bestYaw = rayYaws[i]; }
        }
        this.sliceYaw = bestYaw;
        this.slicePitch = -0.012 + (this.rng() - 0.5) * 0.020;
        this.lastEdgeDetected = false;
        if (metrics) metrics.humanCornerScans++;
      }
    }
    return {yaw: this.sliceYaw, pitch: this.slicePitch, edgeLocked: this.lastEdgeDetected};
  }
}

// ============================================================================
// CORE 5. HumanTacticsV23: Silent Walk vs Adrenaline Sprint, 5 Peek Styles,
//         1vX Sightline Isolation, Shield Recovery Cycling, & 4-Way Physics
//         Mastery (BallisticCore-X, FermatCore, ResonanceCore, AeroVortex)
// ============================================================================
export const PEEK_STYLES = Object.freeze({
  INFO_JIGGLE: 'INFO_JIGGLE',
  CUTTING_PIE: 'CUTTING_PIE',
  WIDE_SWING: 'WIDE_SWING',
  CROUCH_MIXUP: 'CROUCH_MIXUP',
  OFF_ANGLE: 'OFF_ANGLE'
});

export class HumanTacticsV23 {
  constructor(rng, persona, isNv21 = false) {
    this.rng = rng;
    this.persona = persona || HUMAN_ARCHETYPES.TACTICIAN;
    this.isNv21 = !!isNv21;
    this.currentPeekStyle = PEEK_STYLES.CUTTING_PIE;
    this.nextPhysicsAt = 0;
    this.nextIsolateAt = 0;
    this.nextKnockAt = 0;
    this.activePhysicsAction = null; // {kind: 'wood_wallbang'|'fermat_bank'|'resonance_knock', aimPos, expiresAt}
    this.silentWalking = false;
    this.shieldCycleUntil = -10;
    this.isoOffset = null;           // [x, z] micro-step to isolate 1vX into 1v1
    this.isoUntil = -10;
  }

  reset() {
    this.currentPeekStyle = PEEK_STYLES.CUTTING_PIE;
    this.nextPhysicsAt = 0;
    this.nextIsolateAt = 0;
    this.nextKnockAt = 0;
    this.activePhysicsAction = null;
    this.silentWalking = false;
    this.shieldCycleUntil = -10;
    this.isoOffset = null;
    this.isoUntil = -10;
  }

  /**
   * Tactical Silent Walk (`sprintAmt <= 0.30` -> ZERO EchoPulse footsteps!) vs Adrenaline Sprint.
   * Returns `{sprinting, silentWalk, paceFactor}`.
   */
  computeMovementPace(actor, b, t, mind, isSpy = false) {
    const emergency = b.state === '戦術退避' || b.state === '一斉突入' || b.state === 'トレード突入'
      || b.state === 'リロード狩り' || b.state === '離脱・再潜伏' || b.state === '裏どり急襲'
      || t < (b.dodgeUntil || -1) || t - (b.underFireAt || -10) < 1.5;

    const stealthStates = b.state === '潜入裏どり中' || b.state === '連携側面展開' || b.state === 'ベイズ追跡'
      || b.state === '予測待ち伏せ' || b.state === '視認偵察' || b.state === '戦術掃討';

    // Distance to nearest suspected/remembered enemy (strictly fair-play!)
    const mem = b.vision?.getPrimaryMemory(t, 6.5);
    const refPos = mem ? [mem.x, mem.z] : b.lastPos;
    const dThreat = refPos ? Math.hypot(refPos[0] - actor.x, refPos[1] - actor.z) : 99;

    const stealthScore = (this.persona.stealthPreference || 0.55) + (mind?.clutchLevel || 0) * 0.28 + (isSpy ? 0.22 : 0);
    const shouldSilent = !emergency && !b.seen && stealthStates
      && dThreat > 4.5 && dThreat < 27.5
      && (stealthScore > 0.56 || b.state === '潜入裏どり中');

    if (shouldSilent) {
      this.silentWalking = true;
      // Keep hSpd <= 4.15 m/s (< 4.65 m/s threshold in match.js:481 -> sprintAmt stays <= 0.30 -> silent!)
      return {
        sprinting: false,
        silentWalk: true,
        paceFactor: clamp(0.84 - (actor.crouch || 0) * 0.22, 0.55, 0.86)
      };
    }

    this.silentWalking = false;
    const sprinting = emergency
      || b.state === '補給確保' || b.state === '前進展開'
      || (stealthStates && dThreat >= 27.5)
      || (this.currentPeekStyle === PEEK_STYLES.WIDE_SWING && b.state === 'ピーク射撃');

    const adrenalineBoost = (mind?.adrenaline || 0) * 0.04;
    const sprintPace = (isSpy ? 1.26 : 1.21) + adrenalineBoost;
    const basePace = b.vault ? 1.16 : sprinting ? sprintPace : 1.0 - (actor.crouch || 0) * 0.35 - (actor.aimPose || 0) * 0.08;
    return {sprinting, silentWalk: false, paceFactor: basePace};
  }

  /**
   * Choose among 5 authentic human tactical peek styles based on persona, enemy weapon, HP, Nemesis, & shield.
   */
  selectPeekStyle(actor, b, target, t, mind, metrics = null) {
    const agg = this.persona.aggression || 0.6;
    const pat = this.persona.patience || 0.6;
    const vsLockGun = target && (target.gun === 'DF1 OUT' || target.gun === 'RD40' || target.gun === 'RD30' || target.gun === 'RD20');
    const vsSniper = target && (target.gun === 'MS10' || target.gun === 'SW T');
    const isNemesis = target && mind && target.id === mind.nemesisId;
    const lowEnemy = target && (target.hp + target.shield < 50 || target.reload > 0.15);

    // Normalized weighted categorical sampling across all 5 human peek styles!
    let wJiggle = 0.20 + (vsLockGun ? 0.52 : 0) + (vsSniper ? 0.30 : 0) + (mind?.shouldHesitateRepeek(t) ? 0.36 : 0);
    let wPie    = 0.30 + pat * 0.22;
    let wWide   = Math.max(0.06, 0.18 + agg * 0.30 + (lowEnemy && actor.hp > 58 ? 0.55 : 0) - (actor.hp < 48 ? 0.12 : 0));
    let wCrouch = 0.20 + (1 - pat) * 0.16 + (actor.hp >= 52 ? 0.08 : 0);
    let wOff    = 0.14 + pat * 0.18 + (isNemesis ? 0.32 : 0);
    const total = wJiggle + wPie + wWide + wCrouch + wOff;
    let r = this.rng() * total;
    let style = PEEK_STYLES.OFF_ANGLE;
    if ((r -= wJiggle) < 0) style = PEEK_STYLES.INFO_JIGGLE;
    else if ((r -= wPie) < 0) style = PEEK_STYLES.CUTTING_PIE;
    else if ((r -= wWide) < 0) style = PEEK_STYLES.WIDE_SWING;
    else if ((r -= wCrouch) < 0) style = PEEK_STYLES.CROUCH_MIXUP;

    this.currentPeekStyle = style;
    if (metrics) {
      if (style === PEEK_STYLES.INFO_JIGGLE) metrics.humanPeekJiggle++;
      else if (style === PEEK_STYLES.CUTTING_PIE) metrics.humanPeekPie++;
      else if (style === PEEK_STYLES.WIDE_SWING) metrics.humanPeekWide++;
      else if (style === PEEK_STYLES.CROUCH_MIXUP) metrics.humanPeekCrouch++;
      else if (style === PEEK_STYLES.OFF_ANGLE) metrics.humanPeekOffAngle++;
    }
    return style;
  }

  /**
   * Compute tactical peek coordinate for the selected peek style (validating walkability!).
   */
  computePeekGoal(cov, style, b, target) {
    if (!cov?.peek) return [cov.x, cov.z];
    const px = cov.peek[0], pz = cov.peek[1];
    const vx = px - cov.x, vz = pz - cov.z;
    if (style === PEEK_STYLES.INFO_JIGGLE) {
      return [mix(cov.x, px, 0.52), mix(cov.z, pz, 0.52)];
    }
    if (style === PEEK_STYLES.WIDE_SWING) {
      const wx = clamp(cov.x + vx * 1.45, -23.5, 23.5);
      const wz = clamp(cov.z + vz * 1.45, -97.5, 97.5);
      return walkable(wx, wz, 0.48) ? [wx, wz] : [px, pz];
    }
    if (style === PEEK_STYLES.OFF_ANGLE && target) {
      // Pull slightly back & wider from the obvious container edge for an unexpected off-angle!
      const dx = cov.x - target.x, dz = cov.z - target.z;
      const d = Math.hypot(dx, dz) || 1;
      const ox = clamp(px + (dx / d) * 1.55 + vx * 0.35, -23.5, 23.5);
      const oz = clamp(pz + (dz / d) * 1.55 + vz * 0.35, -97.5, 97.5);
      if (walkable(ox, oz, 0.48) && obstruction([ox, 1.4, oz], [target.x, 1.4, target.z]) > 1) {
        return [ox, oz];
      }
    }
    return [px, pz];
  }

  /**
   * Shield Recovery Cycle Discipline:
   * When behind cover with depleted/low shield (<= 2) and approaching the 5.0s shield regen tick,
   * hold cover cleanly so fresh shield comes online before re-peeking!
   */
  shouldCycleShield(actor, b, t, mind, metrics = null) {
    if (b.seen || !b.cover) return false;
    if (actor.shield <= 2 && (actor.shieldClock || 0) >= 2.2 && actor.hp < 95 && b.state !== '一斉突入' && b.state !== 'トレード突入') {
      if (t >= this.shieldCycleUntil) {
        this.shieldCycleUntil = t + Math.min(1.65, Math.max(0.55, 5.05 - (actor.shieldClock || 0)));
        if (metrics) metrics.humanShieldCycles++;
      }
      return true;
    }
    return t < this.shieldCycleUntil && actor.shield <= 2;
  }

  /**
   * 1vX Sightline Isolation: when exposed to >= 2 visible enemies simultaneously,
   * compute a walkable lateral cover step that occludes the secondary threat while isolating a 1v1!
   */
  evaluateAngleIsolation(actor, b, t, metrics = null) {
    if (t < this.isoUntil && this.isoOffset) return this.isoOffset;
    const vis = b.visibleEnemies;
    if (!vis || vis.length < 2 || t < this.nextIsolateAt) return null;
    this.nextIsolateAt = t + 0.16;

    const primary = b.target && vis.some(e => e.id === b.target.id) ? b.target : vis[0];
    const secondary = vis.find(e => e.id !== primary.id);
    if (!primary || !secondary) return null;

    // Sample 6 nearby lateral micro-steps (1.6m..2.8m) to find a spot that blocks secondary's LOS!
    const toSecX = secondary.x - actor.x, toSecZ = secondary.z - actor.z;
    const baseAng = Math.atan2(toSecX, toSecZ);
    const secEye = [secondary.x, secondary.y + 1.42, secondary.z];
    const priEye = [primary.x, primary.y + 1.42, primary.z];

    let bestPt = null, bestSc = 0;
    for (const off of [1.2, -1.2, 1.9, -1.9, 2.5, -2.5]) {
      const ang = baseAng + off;
      const cx = clamp(actor.x + Math.sin(ang) * 2.1, -23.5, 23.5);
      const cz = clamp(actor.z + Math.cos(ang) * 2.1, -97.5, 97.5);
      if (!walkable(cx, cz, 0.45, actor.y)) continue;
      const sampleEye = [cx, actor.y + 1.42, cz];
      const blocksSec = obstruction(sampleEye, secEye) <= 1;
      if (!blocksSec) continue;
      const keepsPri = obstruction(sampleEye, priEye) > 1;
      const sc = 10 + (keepsPri ? 8 : 2);
      if (sc > bestSc) { bestSc = sc; bestPt = [cx, cz]; }
    }

    if (bestPt) {
      this.isoOffset = bestPt;
      this.isoUntil = t + 0.55;
      if (metrics) metrics.humanAngleIsolations++;
      return bestPt;
    }
    return null;
  }

  /**
   * 4-Way Harbor Physics Mastery (100% Fair-Play: operates ONLY on Cowan working memory + static map / fluid):
   *   (1) BallisticCore-X Wood Crate Wallbang
   *   (2) FermatCore 1-Bounce Bank-Shot Intuition
   *   (3) ResonanceCore Steel Container Intimidation Knock
   *   (4) AeroVortex Smoke Cover & Wind-Drifted Smoke-Edge Watch
   */
  evaluatePhysicsTactics(actor, b, match, t, mind, metrics = null) {
    if (this.activePhysicsAction && t < this.activePhysicsAction.expiresAt) {
      return this.activePhysicsAction;
    }
    this.activePhysicsAction = null;
    if (b.seen || t < this.nextPhysicsAt || actor.reload > 0) return null;
    this.nextPhysicsAt = t + 0.24 + this.rng() * 0.08;

    const wpn = match.weapon(actor);
    const iq = this.persona.tacticalIQ || 0.72;
    const eye = eyeOf(actor);
    const mem = b.vision?.getPrimaryMemory(t, 2.4);
    const memPos = mem
      ? [mem.x, Math.max(1.15, mem.y), mem.z]
      : (b.lastSeenTargetPos && t - (b.lastSeenTargetAt || -10) < 2.0 ? b.lastSeenTargetPos : null);
    if (!memPos) return null;

    const dist = Math.hypot(memPos[0] - eye[0], memPos[1] - eye[1], memPos[2] - eye[2]);
    if (dist < 3.0 || dist > 44.0) return null;

    // 4. AeroVortex Smoke Edge Watch (if enemy vanished behind dense smoke, hold crosshair on wind-drifted edge!)
    const av = match.aeroVortex;
    if (av && av.stats.totalSmoke > 1.8) {
      const tau = av.smokeOcclusion(eye, memPos);
      if (tau > 0.72) {
        const wind = av.sample(memPos[0], memPos[2]);
        const perpX = -(memPos[2] - eye[2]) / dist, perpZ = (memPos[0] - eye[0]) / dist;
        const driftSign = (wind.vx * perpX + wind.vz * perpZ) >= 0 ? 1 : -1;
        const edgeX = memPos[0] + perpX * driftSign * 2.4;
        const edgeZ = memPos[2] + perpZ * driftSign * 2.4;
        b.smokeWatchYaw = Math.atan2(edgeX - eye[0], -(edgeZ - eye[2]));
        b.smokeWatchUntil = t + 1.15;
        if (metrics) metrics.humanSmokePlays++;
        return null; // Watch smoke edge silently instead of wasting ammo blind!
      }
    }

    if (actor.mag < Math.max(3, wpn.capacity * 0.34) || b.state === '戦術退避' || b.state === '態勢立て直し') return null;
    if (b.spy && (b.spy.mode === 'SPY_INFILTRATE' || b.spy.mode === 'SPY_VANISH')) return null;

    // 1. BallisticCore-X Wood Crate Wallbang Check!
    const penSpec = WEAPON_PENETRATION[actor.gun];
    const hit = raycastMaterial(eye, memPos);
    if (hit && hit.mat === 'wood' && penSpec && hit.thickness <= penSpec.wood * 0.92 && dist < 34) {
      const memAge = mem ? (t - mem.lastSeenAt) : (t - (b.lastSeenTargetAt || -10));
      if (memAge < 1.65 && (this.isNv21 || this.rng() < 0.42 + iq * 0.48)) {
        this.activePhysicsAction = {
          kind: 'wood_wallbang',
          aimPos: memPos,
          expiresAt: t + 0.58,
          counted: false
        };
        return this.activePhysicsAction;
      }
    }

    // 2. FermatCore 1-Bounce Bank-Shot Intuition (open to high-IQ NV2.3 HUMAN + Spy!)
    if (match.fermat && dist < 38 && (this.isNv21 || iq >= 0.58)) {
      const memAge = mem ? (t - mem.updatedAt) : (t - (b.lastSeenTargetAt || -10));
      if (memAge >= 0.14 && memAge < 2.05) {
        const bank = match.fermat.solveBankShot(eye, memPos, null, actor.gun, wpn.speed, false);
        if (bank && bank.bounces === 1) {
          this.activePhysicsAction = {
            kind: 'fermat_bank',
            aimPos: bank.bounce1,
            bank,
            expiresAt: t + 0.55,
            counted: false
          };
          return this.activePhysicsAction;
        }
      }
    }

    // 3. ResonanceCore Steel Container Intimidation Knock (rattle camper behind steel box!)
    if (match.resonance && hit && hit.mat === 'steel' && dist < 24 && t >= this.nextKnockAt
      && actor.mag >= wpn.capacity * 0.44 && (this.isNv21 || iq >= 0.65)) {
      const box = match.resonance.findContainerAt(hit.point, 0.36);
      if (box) {
        // Check if remembered enemy position is closely hugging this struck container (< 2.6m)
        const dxC = Math.max(0, Math.abs(memPos[0] - box.cx) - box.hx);
        const dzC = Math.max(0, Math.abs(memPos[2] - box.cz) - box.hz);
        if (Math.hypot(dxC, dzC) <= 2.8) {
          this.nextKnockAt = t + 5.2 + this.rng() * 3.0;
          this.activePhysicsAction = {
            kind: 'resonance_knock',
            aimPos: hit.point,
            expiresAt: t + 0.42,
            counted: false
          };
          return this.activePhysicsAction;
        }
      }
    }

    return null;
  }
}

// ============================================================================
// CORE 6. HumanSquadCommsV23: 7 Delayed Voice Callout Channels + Behavioral Execution
//         (CONTACT / SHIELD_BREAK / AMBUSH / RELOAD_COVER / TRADE_REQUEST / MAN_DOWN / FLANK_CLEAR)
// ============================================================================
export const COMMS_CHANNELS = Object.freeze({
  CONTACT: 'CONTACT',
  SHIELD_BREAK: 'SHIELD_BREAK',
  AMBUSH: 'AMBUSH',
  RELOAD_COVER: 'RELOAD_COVER',
  TRADE_REQUEST: 'TRADE_REQUEST',
  MAN_DOWN: 'MAN_DOWN',
  FLANK_CLEAR: 'FLANK_CLEAR'
});

const KIND_NORMALIZE = {
  spot: 'CONTACT',
  CONTACT: 'CONTACT',
  break: 'SHIELD_BREAK',
  SHIELD_BREAK: 'SHIELD_BREAK',
  ambush: 'AMBUSH',
  AMBUSH: 'AMBUSH',
  reload_cover: 'RELOAD_COVER',
  RELOAD_COVER: 'RELOAD_COVER',
  trade_request: 'TRADE_REQUEST',
  TRADE_REQUEST: 'TRADE_REQUEST',
  man_down: 'MAN_DOWN',
  MAN_DOWN: 'MAN_DOWN',
  flank_clear: 'FLANK_CLEAR',
  FLANK_CLEAR: 'FLANK_CLEAR'
};

const EMPTY_LIST = Object.freeze([]);

export class HumanSquadCommsV23 {
  constructor(rng) {
    this.rng = rng;
    this.queue = [];
    this.lastCallByActor = new Map();
    this.stats = {
      CONTACT: 0,
      SHIELD_BREAK: 0,
      AMBUSH: 0,
      RELOAD_COVER: 0,
      TRADE_REQUEST: 0,
      MAN_DOWN: 0,
      FLANK_CLEAR: 0
    };
  }

  emitCallout(team, callerId, enemyId, x, z, kind, t, metrics = null, extra = null) {
    const ch = KIND_NORMALIZE[kind] || 'CONTACT';
    const key = `${callerId}:${ch}`;
    const last = this.lastCallByActor.get(key) ?? -10;
    const minCd = ch === 'MAN_DOWN' ? 0.1
      : ch === 'AMBUSH' || ch === 'TRADE_REQUEST' ? 0.85
      : ch === 'SHIELD_BREAK' || ch === 'RELOAD_COVER' ? 1.05
      : ch === 'FLANK_CLEAR' ? 4.2
      : 1.35;
    if (t - last < minCd) return false;
    this.lastCallByActor.set(key, t);

    // Realistic human voice callout speech latency (0.34–0.74s, NEVER 0ms telepathy!)
    const urgent = ch === 'AMBUSH' || ch === 'TRADE_REQUEST' || ch === 'MAN_DOWN' || ch === 'SHIELD_BREAK';
    const delay = (urgent ? 0.34 : 0.42) + this.rng() * 0.32;
    const fuzz = (ch === 'FLANK_CLEAR' ? 0.5 : 1.15) + this.rng() * 1.15;
    const ang = this.rng() * Math.PI * 2;

    this.queue.push({
      team,
      callerId,
      enemyId,
      x: clamp(x + Math.cos(ang) * fuzz, -23, 23),
      z: clamp(z + Math.sin(ang) * fuzz, -96, 96),
      kind: ch,
      lane: extra?.lane ?? (x < -7 ? -1 : x > 7 ? 1 : 0),
      callerX: extra?.callerX ?? x,
      callerZ: extra?.callerZ ?? z,
      extra: extra || null,
      deliverAt: t + delay
    });
    if (this.queue.length > 36) this.queue.shift();
    if (this.stats[ch] !== undefined) this.stats[ch]++;
    if (metrics) metrics.humanCallouts++;
    return true;
  }

  drainReady(team, t) {
    if (!this.queue.length) return EMPTY_LIST;
    let out = null;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].team === team && this.queue[i].deliverAt <= t) {
        if (!out) out = [];
        out.push(this.queue[i]);
        this.queue.splice(i, 1);
      }
    }
    return out || EMPTY_LIST;
  }
}

// Backward-compatible aliases
export const HumanMind = HumanPsycheV23;
export const HumanVisionModel = HumanPerceptionV23;
export const HumanMotorAim = HumanOFC_AimV23;
export const HumanGazeDirector = HumanGazeV23;
export const HumanCommsRelay = HumanSquadCommsV23;
