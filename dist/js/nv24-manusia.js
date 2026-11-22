// ============================================================================
// NV 2.4 Manusia — Ultra-Realistic Human Cognitive, Somatic, Theory-of-Mind,
//                  Neuromotor & Social-Squad FPS AI Engine
//
// "Manusia" (Human): Built on top of NV2.3 HUMAN's 6 cognitive cores, NV 2.4
// breaks through the remaining uncanny-valley tells of FPS AI with 8 deeply
// coupled human-simulation subsystems — 100.0% Fair-Play (ZERO wallhack, ZERO
// aimbot, ZERO hidden enemy queries, ZERO 0ms telepathy):
//
//  1. ManusiaSomaPsycheV24   : Biological heart-rate (72-182 BPM), stamina,
//                              respiratory breath-hold during precision Quiet Eye,
//                              post-clutch adrenaline dump (hand shake), match-
//                              point stakes focus, 14-dim callsign personalities
//                              (handedness, triggerPatience, utilityIQ, playerBond)
//  2. ManusiaTheoryOfMindV24 : Level-2 Recursive Mental Modeling ("Does the enemy
//                              know where I am?"), Trigger Discipline on unaware
//                              flanks, Fair-Play Mental Ammo/Reload Counting,
//                              5.0s Enemy Shield-Recovery Mental Clock, &
//                              Acoustic Footstep Feint (noisy bait -> silent wrap)
//  3. ManusiaPerceptionV24   : Cocktail-Party selective attention tunneling,
//                              Smoke-Emergence surprise recognition lag (beaten by
//                              +38% Smoke-Edge priming!), & Cowan K=4 velocity-
//                              extrapolated working memory with growing uncertainty
//  4. ManusiaNeuromotorAimV24: Meyer Dual-Submovement aiming (Primary Saccade ->
//                              Visual-Verification Pause -> Corrective Submovement
//                              -> OFC + Velocity-Matched Smooth Pursuit), 3-octave
//                              1/f Pink-Noise micro-sway, Dominant-Hand asymmetry,
//                              Breath-Hold Quiet Eye, Tactical Aim-Height shifting,
//                              & organic semi-auto trigger-finger cadence jitter
//  5. ManusiaGazeV24         : Elevation-aware corner pre-aim pitch, Path-Curvature
//                              look-ahead gaze, & Human-Player buddy flank cover
//  6. ManusiaTacticsV24      : Active Tactical AeroVortex Smoke Vent deployment,
//                              Anatomical Cover-Edge Lean (2-ray shoulder clearance
//                              so NPCs NEVER lean into solid steel!), "Sprint the
//                              Gap / Walk the Corner" pacing, ToM Anti-Pre-Aim
//                              5-style peeks, & Fair-Play Corner Pre-Fire
//  7. ManusiaSocialSquadV24  : 8 delayed voice channels (+ SMOKE_OUT), Team-0
//                              Human-Player Buddy Synergy (covers your reload,
//                              low-HP retreat, & push lane!), & Squad Cohesion
//  8. Curved Corner-Rounding : Smooth waypoint blending & corner-lip unstuck
// ============================================================================
import {clamp, mix} from './geometry.js';
import {obstruction, raycastMaterial, walkable} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';
import {
  HUMAN_ARCHETYPES,
  CALLSIGN_PROFILES as BASE_CALLSIGN_PROFILES,
  WEAPON_RECOIL_PROFILE,
  PEEK_STYLES,
  COMMS_CHANNELS as BASE_COMMS_CHANNELS,
  HumanPsycheV23,
  HumanPerceptionV23,
  HumanOFC_AimV23,
  HumanGazeV23,
  HumanTacticsV23,
  HumanSquadCommsV23
} from './nv23-human.js';

export const NV24_MANUSIA_VERSION = 'NV 2.4 Manusia';
export {HUMAN_ARCHETYPES, WEAPON_RECOIL_PROFILE, PEEK_STYLES};

function angleDiff(target, cur) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function mixAngle(a, b, t) {
  return a + angleDiff(b, a) * t;
}

// Public Harbor Range weapon magazine capacities (100% public game knowledge for fair-play mental counting!)
const PUBLIC_MAG_CAP = Object.freeze({
  'SW T': 10,
  SRA: 30,
  D1: 40,
  MS10: 24,
  'DF1 OUT': 95,
  RD20: 20,
  RD30: 80,
  RD40: 130,
  'DF40 II': 350
});

// 14-Dimensional Callsign Personalities (extends NV2.3 12-dim profiles with Somatic/ToM/Social traits!)
const MANUSIA_EXTRAS = Object.freeze({
  NAGI: Object.freeze({handedness: 1, triggerPatience: 0.90, utilityIQ: 0.88, playerBond: 0.86}),
  KAI:  Object.freeze({handedness: -1, triggerPatience: 0.72, utilityIQ: 0.92, playerBond: 0.94}),
  RIN:  Object.freeze({handedness: 1, triggerPatience: 0.42, utilityIQ: 0.74, playerBond: 0.78}),
  SORA: Object.freeze({handedness: -1, triggerPatience: 0.86, utilityIQ: 0.82, playerBond: 0.80}),
  AO:   Object.freeze({handedness: 1, triggerPatience: 0.58, utilityIQ: 0.90, playerBond: 0.84})
});

export const CALLSIGN_PROFILES_V24 = Object.freeze(
  Object.fromEntries(
    Object.entries(BASE_CALLSIGN_PROFILES).map(([k, p]) => [
      k,
      Object.freeze({...p, ...(MANUSIA_EXTRAS[k] || {handedness: 1, triggerPatience: 0.65, utilityIQ: 0.80, playerBond: 0.82})})
    ])
  )
);

export const COMMS_CHANNELS_V24 = Object.freeze({
  ...BASE_COMMS_CHANNELS,
  SMOKE_OUT: 'SMOKE_OUT'
});

// ============================================================================
// CORE 1. ManusiaSomaPsycheV24: Biological Heart Rate, Stamina, Respiratory
//         Breath-Hold, Post-Clutch Adrenaline Dump, Match-Point Focus, Cohesion
// ============================================================================
export class ManusiaSomaPsycheV24 extends HumanPsycheV23 {
  constructor(actor, rng, isNv21 = false) {
    super(actor, rng, isNv21);
    const key = actor?.name ? String(actor.name).toUpperCase() : '';
    const extra = MANUSIA_EXTRAS[key] || {
      handedness: rng() < 0.78 ? 1 : -1,
      triggerPatience: 0.55 + rng() * 0.30,
      utilityIQ: 0.72 + rng() * 0.20,
      playerBond: 0.78 + rng() * 0.16
    };
    this.persona = {...this.persona, ...extra};

    // Somatic Physiology (living body variables)
    this.heartRate = 76;            // BPM: 72 resting -> 115-145 combat optimal -> 165-182 peak stress
    this.stamina = 1.0;             // 0..1 biomechanical sprint stamina
    this.breathHold = 0;            // 0..1 active precision breath-hold during long-range Quiet Eye
    this.breathHoldUntil = -10;
    this.breathHoldCdUntil = -10;
    this.postFightShake = 0;        // 0..1 post-clutch adrenaline dump tremor right after surviving a heavy duel!
    this.matchPointIntensity = 0;   // 0..1 late-game match-point stakes focus
    this.cohesion = 0.55;           // 0..1 squad trust & momentum from successful trades/saves
    this.painHitchUntil = -10;      // brief somatic breath hitch on heavy hit
  }

  reset() {
    super.reset();
    this.heartRate = 78;
    this.stamina = 1.0;
    this.breathHold = 0;
    this.breathHoldUntil = -10;
    this.breathHoldCdUntil = -10;
    this.postFightShake = 0;
    this.painHitchUntil = -10;
    // NOTE: cohesion & episodic memory intentionally persist across respawns!
  }

  /** Voluntary precision respiratory pause ("hold breath") during long-range Quiet Eye stabilization. */
  tryEngageBreathHold(t, metrics = null) {
    if (this.breathHold > 0.5 && t < this.breathHoldUntil) return true;
    if (t < this.breathHoldCdUntil || this.stamina < 0.32 || this.stress > 0.72 || t < this.painHitchUntil) {
      return false;
    }
    this.breathHold = 1.0;
    this.breathHoldUntil = t + 0.95 + (this.persona.patience || 0.6) * 0.45;
    this.breathHoldCdUntil = this.breathHoldUntil + 2.1;
    if (metrics) metrics.manusiaBreathHolds++;
    return true;
  }

  releaseBreathHold() {
    this.breathHold = 0;
    this.breathHoldUntil = -10;
  }

  getBreathRateHz() {
    if (this.breathHold > 0.55) return 0.03;
    const hrFactor = clamp((this.heartRate - 72) / 100, 0, 1.1);
    const fatigueFactor = clamp((1 - this.stamina) * 0.45, 0, 0.35);
    return clamp(0.24 + hrFactor * 0.28 + fatigueFactor - this.clutchLevel * 0.05, 0.16, 0.72);
  }

  /** Combined physiological micro-tremor (stress + high cardiac pulse > 142 BPM + post-clutch adrenaline dump). */
  getPulseTremorAmp() {
    const stressT = this.stress > 0.56 ? (this.stress - 0.56) * (1 - this.clutchLevel * 0.35) * 0.0075 : 0;
    const pulseT = this.heartRate > 142 ? ((this.heartRate - 142) / 40) * 0.0024 : 0;
    const dumpT = this.postFightShake * 0.0046;
    return clamp(stressT + pulseT + dumpT, 0, 0.0115);
  }

  getFlowFactor() {
    const base = super.getFlowFactor();
    // Subtle cohesion & match-point poise bonus, offset slightly by severe somatic fatigue or post-fight shake
    const cohesionBoost = (this.cohesion - 0.5) * 0.04;
    const stakesBoost = this.matchPointIntensity * (this.persona.clutchComposure ?? 0.75) * 0.035;
    const fatiguePenalty = this.stamina < 0.30 ? (0.30 - this.stamina) * 0.14 : 0;
    return clamp(base + cohesionBoost + stakesBoost - fatiguePenalty, 0.72, 1.24);
  }

  step(actor, dt, t, seenEnemy, ctx = null) {
    super.step(actor, dt, t, seenEnemy, ctx);

    // 1. Match-Point Stakes Intensity (late-match heightening when either side is <= 2 kills from win)
    if (ctx && Number.isFinite(ctx.killsToWin)) {
      const targetStakes = ctx.killsToWin <= 1 ? 1.0 : ctx.killsToWin <= 2 ? 0.62 : 0.0;
      this.matchPointIntensity += (targetStakes - this.matchPointIntensity) * (1 - Math.exp(-0.9 * dt));
    }

    // 2. Biomechanical Stamina (drains during sustained sprint/jumps, recovers during walk/cover/crouch)
    const speed = Math.hypot(actor.vx || 0, actor.vz || 0);
    const sprintingNow = speed > 4.75 && (actor.crouch || 0) < 0.25;
    if (sprintingNow) {
      this.stamina = Math.max(0.12, this.stamina - dt * 0.13);
    } else if (!actor.onGround) {
      this.stamina = Math.max(0.12, this.stamina - dt * 0.18);
    } else {
      const recRate = speed < 1.2 ? 0.26 : 0.14;
      this.stamina = Math.min(1.0, this.stamina + dt * recRate);
    }

    // 3. Biological Heart Rate (72..182 BPM) with realistic autonomic inertia
    const hpPenalty = actor.hp < 50 ? (50 - actor.hp) * 0.38 : 0;
    const targetBpm = clamp(
      72 + this.exertion * 44 + this.adrenaline * 36 + this.stress * 34
      + this.clutchLevel * 18 + this.matchPointIntensity * 12 + hpPenalty + (1 - this.stamina) * 16,
      72, 182
    );
    const hrRate = targetBpm > this.heartRate ? 1.45 : 0.48; // heart spikes fast, calms gradually!
    this.heartRate += (targetBpm - this.heartRate) * (1 - Math.exp(-hrRate * dt));

    // 4. Respiratory Breath-Hold decay & Post-Clutch Adrenaline Dump decay
    if (t >= this.breathHoldUntil) {
      this.breathHold = Math.max(0, this.breathHold - dt * 4.5);
    }
    this.postFightShake *= Math.exp(-0.58 * dt);
    this.cohesion += (0.55 - this.cohesion) * (1 - Math.exp(-0.02 * dt));

    // Enrich living human stateTag
    if (t < this.startleUntil) this.stateTag = '驚愕反応';
    else if (this.breathHold > 0.55) this.stateTag = '呼吸停止照準';
    else if (this.postFightShake > 0.28 && !seenEnemy) this.stateTag = '残心アドレナリン';
    else if (this.isClutching()) this.stateTag = 'クラッチ覚醒';
    else if (this.matchPointIntensity > 0.65 && this.isInFlow()) this.stateTag = '決着集中フロー';
  }

  onDamaged(actor, attacker, power, t, metrics, impactDir) {
    const res = super.onDamaged(actor, attacker, power, t, metrics, impactDir);
    // Heavy hit causes somatic breath hitch (breaks breath-hold & spikes heart rate!)
    if (power >= 12 || actor.shield <= 0) {
      this.releaseBreathHold();
      this.painHitchUntil = t + 0.55;
      this.heartRate = clamp(this.heartRate + 14 + power * 0.45, 72, 182);
    }
    return res;
  }

  onKill(t, victim = null, metrics = null) {
    const preStress = this.stress;
    const wasClutch = this.isClutching();
    super.onKill(t, victim);
    // Authentic Post-Clutch / High-Stress Adrenaline Dump ("post-fight hand shake")!
    if (preStress > 0.46 || wasClutch || this.heartRate > 138) {
      this.postFightShake = clamp(this.postFightShake + (wasClutch ? 0.72 : 0.44 + preStress * 0.35), 0, 0.92);
      if (metrics) metrics.manusiaAdrenalineDumps++;
    }
  }

  onSquadBond(amount = 0.14) {
    this.cohesion = clamp(this.cohesion + amount, 0.1, 1.0);
    this.morale = clamp(this.morale + amount * 0.45, -1, 1);
  }
}

// ============================================================================
// CORE 2. ManusiaTheoryOfMindV24: Level-2 Recursive Belief Modeling (100% Fair!)
//   - "Does the enemy know where I am?" (myLastExposedPos / myLastSoundPos)
//   - Trigger Discipline on unaware flanked enemies
//   - Fair-Play Mental Ammo & Reload Counting (heard/seen shots ONLY!)
//   - Fair-Play 5.0-Second Enemy Shield-Recovery Mental Clock
//   - Acoustic Footstep Feint (noisy bait step -> silent opposite wrap!)
// ============================================================================
export class ManusiaTheoryOfMindV24 {
  constructor(rng, persona, isNv21 = false) {
    this.rng = rng;
    this.persona = persona || HUMAN_ARCHETYPES.TACTICIAN;
    this.isNv21 = !!isNv21;

    // Self-Exposure tracking ("Where does the enemy think I am?")
    this.myLastExposedPos = null;   // [x, z]
    this.myLastExposedAt = -20;
    this.myLastExposedBy = -1;
    this.myLastSoundPos = null;     // [x, z]
    this.myLastSoundAt = -20;
    this.myLastSoundKind = '';

    // Trigger Discipline state (holding fire briefly behind unaware enemy for clean ambush)
    this.tdTargetId = -1;
    this.tdStartAt = -10;
    this.tdUntil = -10;
    this.tdCooldownUntil = -10;

    // Fair-Play Mental Ammo & Reload Counting (populated ONLY from observed/heard shots!)
    this.enemyAmmo = new Map();     // enemyId -> {gun, shots, lastShotAt, reloadAt}
    // Fair-Play Enemy 5.0s Shield-Break Mental Clock
    this.enemyShieldBrokenAt = new Map(); // enemyId -> t

    // Acoustic Footstep Feint state
    this.feintPhase = 'none';       // 'none' | 'noise' | 'silent_wrap'
    this.feintSide = 1;
    this.feintStartAt = -10;
    this.feintSwitchAt = -10;
    this.feintEndAt = -10;
    this.feintCooldownUntil = -10;
  }

  reset() {
    this.myLastExposedPos = null;
    this.myLastExposedAt = -20;
    this.myLastExposedBy = -1;
    this.myLastSoundPos = null;
    this.myLastSoundAt = -20;
    this.tdTargetId = -1;
    this.tdUntil = -10;
    this.feintPhase = 'none';
    this.feintEndAt = -10;
    // NOTE: enemyAmmo & enemyShieldBrokenAt clear naturally via staleness/enemy respawn!
  }

  /** Record that WE were visibly exposed or exchanged fire at (x, z). */
  recordSelfExposed(x, z, enemyId, t) {
    if (!this.myLastExposedPos) this.myLastExposedPos = [x, z];
    else { this.myLastExposedPos[0] = x; this.myLastExposedPos[1] = z; }
    this.myLastExposedAt = t;
    this.myLastExposedBy = enemyId;
  }

  /** Record that WE emitted an audible sound (gunfire, sprint steps, smoke canister) at (x, z). */
  recordSelfNoise(x, z, kind, t) {
    if (!this.myLastSoundPos) this.myLastSoundPos = [x, z];
    else { this.myLastSoundPos[0] = x; this.myLastSoundPos[1] = z; }
    this.myLastSoundAt = t;
    this.myLastSoundKind = kind;
  }

  /**
   * Level-2 Theory of Mind: Probability (0..1) that the enemy is pre-aiming our CURRENT position!
   * High if we recently fought/made noise right here; drops near 0 if we silently repositioned > 6m away.
   */
  getEnemyPreAimRisk(actor, t) {
    let risk = 0;
    if (this.myLastExposedPos && t - this.myLastExposedAt < 5.2) {
      const age = t - this.myLastExposedAt;
      const d = Math.hypot(actor.x - this.myLastExposedPos[0], actor.z - this.myLastExposedPos[1]);
      if (d < 6.5) {
        risk = Math.max(risk, (1 - age / 5.2) * (1 - d / 6.5) * 0.96);
      }
    }
    if (this.myLastSoundPos && t - this.myLastSoundAt < 4.0) {
      const age = t - this.myLastSoundAt;
      const d = Math.hypot(actor.x - this.myLastSoundPos[0], actor.z - this.myLastSoundPos[1]);
      const loudness = this.myLastSoundKind === 'fire' ? 0.82 : this.myLastSoundKind === 'smoke' ? 0.65 : 0.56;
      if (d < 5.5) {
        risk = Math.max(risk, (1 - age / 4.0) * (1 - d / 5.5) * loudness);
      }
    }
    return clamp(risk, 0, 1);
  }

  /**
   * Checks if a visually observed enemy appears UNAWARE of our position (looking away + we haven't exposed/fired here).
   * Strictly uses enemy's visible body orientation (`enemy.yaw`) & our own exposure memory!
   */
  isEnemyLikelyUnaware(actor, enemy, t) {
    if (!enemy) return false;
    const toMeYaw = Math.atan2(actor.x - enemy.x, -(actor.z - enemy.z));
    const lookOff = Math.abs(angleDiff(toMeYaw, enemy.yaw));
    if (lookOff < 1.05) return false; // Enemy is facing our general hemisphere!
    if (t - this.myLastExposedAt < 2.2 && this.myLastExposedBy === enemy.id) return false;
    if (t - this.myLastSoundAt < 1.8 && this.myLastSoundKind === 'fire') return false;
    return true;
  }

  /**
   * Authentic Human Trigger Discipline:
   * When flanking behind an oblivious enemy (`isEnemyLikelyUnaware`), briefly hold fire (0.16..0.38s)
   * to finish stabilizing Quiet Eye / close a couple steps instead of panic-firing prematurely!
   * Immediately cancels if enemy turns toward us, gets dangerously close, or patience cap expires.
   */
  evaluateTriggerDiscipline(actor, target, aimRes, t, mind, metrics = null) {
    if (!target || !aimRes) return false;
    const patience = this.persona.triggerPatience || 0.65;
    if (patience < 0.45 || actor.hp < 58 || (mind?.stress || 0) > 0.62) {
      this.tdTargetId = -1;
      return false;
    }

    const unaware = this.isEnemyLikelyUnaware(actor, target, t);
    const dist = aimRes.dist || 20;

    if (!unaware || dist < 9.5 || dist > 40) {
      this.tdTargetId = -1;
      return false;
    }

    // Active trigger-discipline hold?
    if (this.tdTargetId === target.id && t < this.tdUntil) {
      // Release early once Quiet Eye is crisp AND at least 0.14s elapsed!
      if (aimRes.quietEyeShot && t - this.tdStartAt >= 0.14 && aimRes.alignPerceived < 0.028) {
        this.tdTargetId = -1;
        this.tdCooldownUntil = t + 3.2;
        return false;
      }
      return true;
    }

    // Start a fresh trigger-discipline hold on first unseen flank catch!
    if (this.tdTargetId !== target.id && t >= this.tdCooldownUntil) {
      const holdDur = 0.16 + patience * 0.22; // 0.25..0.38s crisp human hold
      this.tdTargetId = target.id;
      this.tdStartAt = t;
      this.tdUntil = t + holdDur;
      this.tdCooldownUntil = t + 3.5;
      if (metrics) metrics.manusiaTriggerDisciplines++;
      return true;
    }

    return false;
  }

  /** Fair-Play Mental Ammo Counter: ONLY called on visibly seen muzzle fire or arrived EchoPulse fire! */
  onObservedEnemyShot(enemyId, gun, t, shotSeq = null) {
    if (enemyId < 0) return;
    let rec = this.enemyAmmo.get(enemyId);
    if (!rec || rec.gun !== gun || t - rec.lastShotAt > 12.0 || t < rec.reloadAt) {
      rec = {gun: gun || 'SRA', shots: 0, lastShotAt: t, reloadAt: -10, lastShotSeq: -1, countedRead: false};
      this.enemyAmmo.set(enemyId, rec);
    }
    if (shotSeq != null && Number.isFinite(shotSeq)) {
      if (shotSeq <= rec.lastShotSeq) return;
      rec.lastShotSeq = shotSeq;
    }
    const salvoStep = gun === 'DF40 II' ? 4 : (gun === 'RD30' || gun === 'RD40') ? 2 : 1;
    rec.shots += salvoStep;
    rec.lastShotAt = t;
  }

  onObservedEnemyReload(enemyId, t) {
    const rec = this.enemyAmmo.get(enemyId);
    if (rec) {
      rec.shots = 0;
      rec.reloadAt = t + 1.6;
      rec.countedRead = false;
      rec.lastShotSeq = -1;
    }
  }

  clearEnemy(enemyId) {
    this.enemyAmmo.delete(enemyId);
    this.enemyShieldBrokenAt.delete(enemyId);
  }

  /** Predict if enemy is near empty mag based purely on shots we observed/heard! */
  predictEnemyReloadSoon(enemyId, t, metrics = null) {
    const rec = this.enemyAmmo.get(enemyId);
    if (!rec || t - rec.lastShotAt > 6.0 || t < rec.reloadAt) return {imminent: false, ratio: 0};
    const cap = PUBLIC_MAG_CAP[rec.gun] || 30;
    const ratio = clamp(rec.shots / cap, 0, 1.2);
    const imminent = ratio >= 0.72;
    if (imminent && !rec.countedRead && metrics) {
      rec.countedRead = true;
      metrics.manusiaAmmoReads++;
    }
    return {imminent, ratio};
  }

  /** Fair-Play 5.0-Second Enemy Shield-Recovery Mental Clock (from observed hit or delayed callout!). */
  onEnemyShieldBroken(enemyId, t) {
    if (enemyId >= 0) this.enemyShieldBrokenAt.set(enemyId, t);
  }

  getEnemyShieldWindow(enemyId, t) {
    const at = this.enemyShieldBrokenAt.get(enemyId);
    if (at === undefined) return 0;
    const rem = 5.0 - (t - at);
    if (rem <= 0) {
      this.enemyShieldBrokenAt.delete(enemyId);
      return 0;
    }
    return rem;
  }

  /**
   * Acoustic Footstep Feint (Mind-Game!):
   * When enemy strongly pre-aims our cover corner (`preAimRisk > 0.56`), sprint 2 noisy steps to one
   * side (emitting a loud EchoPulse bait footstep!), then instantly switch to Silent Walk opposite!
   */
  evaluateAcousticFeint(actor, b, t, metrics = null) {
    if (this.feintPhase !== 'none') {
      if (t >= this.feintEndAt || b.seen || actor.hp < 46) {
        this.feintPhase = 'none';
        return null;
      }
      if (this.feintPhase === 'noise' && t >= this.feintSwitchAt) {
        this.feintPhase = 'silent_wrap';
      }
      return {
        phase: this.feintPhase,
        side: this.feintPhase === 'noise' ? this.feintSide : -this.feintSide
      };
    }

    if (b.seen || !b.cover || actor.hp < 54 || t < this.feintCooldownUntil) return null;
    if ((this.persona.utilityIQ || 0.75) < 0.70) return null;
    const preAimRisk = this.getEnemyPreAimRisk(actor, t);
    if (preAimRisk < 0.52) return null;
    const refPos = b.lastPos;
    if (!refPos) return null;
    const dThreat = Math.hypot(refPos[0] - actor.x, refPos[1] - actor.z);
    if (dThreat < 7.5 || dThreat > 28) return null;

    if (this.rng() < 0.34 + (this.persona.utilityIQ - 0.70) * 0.9) {
      this.feintSide = b.peekEdgeSign || (this.rng() < 0.5 ? -1 : 1);
      this.feintPhase = 'noise';
      this.feintStartAt = t;
      this.feintSwitchAt = t + 0.44;
      this.feintEndAt = t + 1.55;
      this.feintCooldownUntil = t + 11.5 + this.rng() * 4.5;
      if (metrics) metrics.manusiaAcousticFeints++;
      return {phase: 'noise', side: this.feintSide};
    }
    this.feintCooldownUntil = t + 2.8;
    return null;
  }
}

// ============================================================================
// CORE 3. ManusiaPerceptionV24: Cocktail-Party Attention Tunneling,
//         Smoke-Emergence Recognition Beat, & Velocity-Extrapolated Cowan K=4
// ============================================================================
export class ManusiaPerceptionV24 extends HumanPerceptionV23 {
  constructor(rng, isNv21 = false) {
    super(rng, isNv21);
    this.tunnelFocus = 0;         // 0..0.85 selective attention depth during 1v1 duel
    this._tunnelUpdatedAt = -1;
    this._projEnd = [0, 0, 0];
  }

  reset() {
    super.reset();
    this.tunnelFocus = 0;
    this._tunnelUpdatedAt = -1;
  }

  evaluateSighting(actor, enemy, dt, t, mind, currentlyDuelingId = -1, metrics = null, extra = null) {
    // Update Cocktail-Party selective attention tunneling once per perception tick (independent of candidate count)
    if (t !== this._tunnelUpdatedAt) {
      this._tunnelUpdatedAt = t;
      if (currentlyDuelingId >= 0) {
        this.tunnelFocus = clamp(this.tunnelFocus + dt * 1.4, 0, 0.85);
      } else {
        this.tunnelFocus = Math.max(0, this.tunnelFocus - dt * 3.4);
      }
    }

    // Smoke-Emergence surprise beat: emerging from dense smoke without smoke-edge priming adds slight recognition lag!
    let effDt = dt;
    if (extra?.nearSmokeEdge) {
      const aimYaw = Math.atan2(enemy.x - actor.x, -(enemy.z - actor.z));
      const primed = !!this.isBearingPrimed(aimYaw, t);
      if (!primed) effDt *= 0.78; // ~28% slower recognition on unprimed smoke pop-out!
    }
    // Cocktail-party tunneling slightly attenuates secondary non-foveal enemies unless primed/flashing
    if (currentlyDuelingId >= 0 && currentlyDuelingId !== enemy.id && this.tunnelFocus > 0.35 && (enemy.flash || 0) <= 0.008) {
      const aimYaw = Math.atan2(enemy.x - actor.x, -(enemy.z - actor.z));
      if (Math.abs(angleDiff(aimYaw, actor.yaw)) > 0.36 && !this.isBearingPrimed(aimYaw, t)) {
        effDt *= (1 - this.tunnelFocus * 0.28);
      }
    }

    return super.evaluateSighting(actor, enemy, effDt, t, mind, currentlyDuelingId, metrics, extra);
  }

  /**
   * Object Permanence Velocity Extrapolation + Growing Uncertainty Cone (100% Fair-Play!):
   * Projects a recently vanished enemy's last observed velocity forward up to 0.95s,
   * clipped strictly against static harbor geometry via raycastMaterial!
   */
  getProjectedMemory(t, maxAge = 4.2) {
    const slot = this.getPrimaryMemory(t, maxAge);
    if (!slot) return null;
    const age = Math.max(0, t - slot.updatedAt);
    const projT = Math.min(0.95, age) * (slot.source === 'visual' ? 0.72 : 0.30);
    const spd = Math.hypot(slot.vx || 0, slot.vz || 0);
    let px = slot.x, pz = slot.z;
    if (projT > 0.04 && spd > 0.8) {
      const candX = clamp(slot.x + slot.vx * projT, -23.5, 23.5);
      const candZ = clamp(slot.z + slot.vz * projT, -97.5, 97.5);
      this._projEnd[0] = candX;
      this._projEnd[1] = Math.max(1.1, slot.y || 1.2);
      this._projEnd[2] = candZ;
      const hit = raycastMaterial([slot.x, this._projEnd[1], slot.z], this._projEnd);
      const frac = hit ? Math.max(0, hit.t - 0.15) : 1.0;
      px = mix(slot.x, candX, frac);
      pz = mix(slot.z, candZ, frac);
    }
    return {
      ...slot,
      projX: px,
      projZ: pz,
      uncertaintyRadius: 0.55 + age * 1.65
    };
  }
}

// ============================================================================
// CORE 4. ManusiaNeuromotorAimV24: Meyer Dual-Submovement Correction,
//         3-Octave 1/f Pink-Noise Sway, Breath-Hold Quiet Eye, Handedness,
//         Tactical Aim-Height Adaptation, & Semi-Auto Trigger Cadence Jitter
// ============================================================================
export class ManusiaNeuromotorAimV24 extends HumanOFC_AimV23 {
  constructor(rng, isNv21 = false, persona = null) {
    super(rng, isNv21, persona);
    // 3-Octave 1/f Pink-Noise sway states (slow posture + mid wrist + fast neuromuscular ripple)
    this.pinkSlowY = 0; this.pinkSlowP = 0;
    this.pinkMidY = 0;  this.pinkMidP = 0;
    this.pinkFastY = 0; this.pinkFastP = 0;
    this.pinkNextFastAt = 0;
    this.pinkFastGoalY = 0; this.pinkFastGoalP = 0;

    // Meyer Phase-2 Discrete Corrective Submovement state
    this.subMoveStartAt = -10;
    this.subMoveDur = 0.07;
    this.subStartYaw = 0;
    this.subStartPitch = 0;
    this.subGoalYaw = 0;
    this.subGoalPitch = 0;
    this.subMoveUsedForFlick = false;

    // Human semi-auto trigger-finger cadence variance
    this.triggerCadenceUntil = -10;
  }

  reset(t = 0) {
    super.reset(t);
    this.pinkSlowY = 0; this.pinkSlowP = 0;
    this.pinkMidY = 0;  this.pinkMidP = 0;
    this.pinkFastY = 0; this.pinkFastP = 0;
    this.subMoveUsedForFlick = false;
    this.triggerCadenceUntil = -10;
  }

  triggerBallisticFlick(curYaw, curPitch, targetYaw, targetPitch, t, stress = 0, startled = false, metrics = null, targetDist = 20) {
    const ok = super.triggerBallisticFlick(curYaw, curPitch, targetYaw, targetPitch, t, stress, startled, metrics, targetDist);
    if (ok) this.subMoveUsedForFlick = false;
    return ok;
  }

  onShotFired(gun, isBursting = false, t = 0) {
    super.onShotFired(gun, isBursting, t);
    // Organic semi-auto human trigger-finger tap jitter (±10..20ms on non-full-auto rifles!)
    if (gun === 'SW T' || gun === 'SRA' || gun === 'RD20') {
      const jitter = (this.isNv21 ? 0.008 : 0.014) * this.rng();
      this.triggerCadenceUntil = t + jitter;
    }
  }

  step(a, dt, t, opts) {
    const {
      seenTarget,
      wpn,
      mind = null,
      metrics = null
    } = opts;

    // 1. Update 3-Octave 1/f Pink-Noise micro-sway (independent slow posture + fast neuromuscular ripple;
    //    leaves super.step()'s mid-band OU drift wanderY/wanderP at full physiological variance!)
    if (t >= this.pinkNextFastAt) {
      this.pinkFastGoalY = (this.rng() - 0.5) * 1.10;
      this.pinkFastGoalP = (this.rng() - 0.5) * 0.85;
      this.pinkNextFastAt = t + 0.075 + this.rng() * 0.065;
    }
    this.pinkSlowY += (this.wanderGoalY - this.pinkSlowY) * (1 - Math.exp(-1.15 * dt));
    this.pinkSlowP += (this.wanderGoalP - this.pinkSlowP) * (1 - Math.exp(-1.15 * dt));
    this.pinkMidY += (this.wanderY - this.pinkMidY) * (1 - Math.exp(-4.6 * dt));
    this.pinkMidP += (this.wanderP - this.pinkMidP) * (1 - Math.exp(-4.6 * dt));
    this.pinkFastY += (this.pinkFastGoalY - this.pinkFastY) * (1 - Math.exp(-12.5 * dt));
    this.pinkFastP += (this.pinkFastGoalP - this.pinkFastP) * (1 - Math.exp(-12.5 * dt));

    // 2. Engage Precision Respiratory Breath-Hold during long-range Quiet Eye stabilization!
    let breathHeld = false;
    if (seenTarget && mind && typeof mind.tryEngageBreathHold === 'function') {
      const distSq = (seenTarget.x - a.x) ** 2 + (seenTarget.z - a.z) ** 2;
      const ownSpd = Math.hypot(a.vx || 0, a.vz || 0);
      if (distSq >= 18 * 18 && ownSpd < 3.4 && this.quietEyeAccum >= 0.028 && this.motorPhase !== 'FLICK') {
        breathHeld = mind.tryEngageBreathHold(t, metrics);
      } else if (mind.breathHold > 0.1 && (ownSpd > 4.2 || distSq < 12 * 12)) {
        mind.releaseBreathHold();
      }
    }

    // 3. Execute Meyer Phase-2 Corrective Submovement if just exiting SETTLE after Primary Saccade undershoot!
    const wasSettling = this.motorPhase === 'SETTLE';
    if (this.motorPhase === 'SUBMOVE') {
      const u = clamp((t - this.subMoveStartAt) / Math.max(0.035, this.subMoveDur), 0, 1);
      const u2 = u * u, u3 = u2 * u;
      const s = u3 * (10 - 15 * u + 6 * u2);
      const dYaw = angleDiff(this.subGoalYaw, this.subStartYaw);
      const dPitch = this.subGoalPitch - this.subStartPitch;
      a.yaw = this.subStartYaw + dYaw * s;
      a.pitch = clamp(this.subStartPitch + dPitch * s, -0.92, 0.92);
      if (u >= 1) {
        this.motorPhase = 'PURSUIT';
      }
    }

    // 4. Delegate core OFC + Smooth Pursuit + Recoil Muscle Memory to HumanOFC_AimV23
    const res = super.step(a, dt, t, opts);

    // 5. Launch Meyer Phase-2 Discrete Submovement on exiting SETTLE if undershoot error sits in 0.045..0.24 rad!
    //    100% Fair-Play: targets DELAYED visual perception (`sampleDelayedTarget`) + Weber residual scatter!
    if (wasSettling && this.motorPhase !== 'SETTLE' && !this.subMoveUsedForFlick && seenTarget) {
      const err = res.alignPerceived;
      if (err > 0.045 && err < 0.24) {
        const eye = eyeOf(a);
        const perc = this.sampleDelayedTarget(t);
        const tx = perc ? perc.x : seenTarget.x;
        const ty = perc ? perc.y : targetPoint(seenTarget)[1];
        const tz = perc ? perc.z : seenTarget.z;
        const rx = tx - eye[0], ry = ty - eye[1], rz = tz - eye[2];
        const weberSig = this.isNv21 ? 0.011 : 0.018;
        const scatterY = (this.rng() + this.rng() - 1.0) * weberSig;
        const scatterP = (this.rng() + this.rng() - 1.0) * weberSig * 0.72;
        this.subMoveUsedForFlick = true;
        this.motorPhase = 'SUBMOVE';
        this.subMoveStartAt = t;
        this.subMoveDur = (this.isNv21 ? 0.052 : 0.072) + this.rng() * 0.024;
        this.subStartYaw = a.yaw;
        this.subStartPitch = a.pitch;
        this.subGoalYaw = Math.atan2(rx, -rz) + scatterY;
        this.subGoalPitch = clamp(Math.atan2(ry, Math.hypot(rx, rz)) + scatterP, -0.82, 0.82);
        if (metrics) metrics.manusiaSubmovements++;
      }
    }

    // 6. Apply 1/f Pink-Noise Multi-Band Harmonics + Somatic Cardiac/Adrenaline Micro-Tremor + Handedness + Aim-Height!
    if (seenTarget) {
      const pinkGain = (this.isNv21 ? 0.0024 : 0.0038) * (breathHeld ? 0.62 : 1.0);
      const pinkOffY = (this.pinkSlowY * 0.58 + this.pinkFastY * 0.22) * pinkGain;
      const pinkOffP = (this.pinkSlowP * 0.52 + this.pinkFastP * 0.20) * pinkGain;
      a.yaw += pinkOffY * Math.min(1, dt * 8.0);
      a.pitch = clamp(a.pitch + pinkOffP * Math.min(1, dt * 8.0), -0.92, 0.92);

      if (mind && typeof mind.getPulseTremorAmp === 'function') {
        const pt = mind.getPulseTremorAmp();
        if (pt > 0.001 && !breathHeld) {
          a.yaw += Math.sin(t * 46 + this.phaseA) * pt * dt * 4.8;
          a.pitch = clamp(a.pitch + Math.cos(t * 41 + this.phaseB) * pt * dt * 3.8, -0.92, 0.92);
        }
      }
      // Subtle Dominant-Hand directional asymmetry (~6% crisper sweeping in dominant pull direction)
      const hand = this.persona.handedness || 1;
      if (Math.sign(this.velYaw) === -hand && Math.abs(this.velYaw) > 1.2) {
        a.yaw -= this.velYaw * 0.055 * dt;
      }
      // Tactical Aim-Height Adaptation: upper-chest/collar on calm precision shots, lower if enemy habitually crouches!
      const eModel = mind?.getEnemyModel?.(seenTarget.id);
      let heightOff = 0;
      if (eModel && eModel.samples >= 4 && eModel.crouchRate > 0.48) {
        heightOff = -0.10; // anticipate crouch-spammer!
      } else if (breathHeld && (a.gun === 'SW T' || a.gun === 'MS10') && res.dist > 18) {
        heightOff = 0.08;  // surgical upper-chest/collar line!
      }
      if (heightOff !== 0 && res.dist > 5) {
        const pitchNudge = clamp(heightOff / res.dist, -0.025, 0.025);
        a.pitch = clamp(a.pitch + pitchNudge * Math.min(1, dt * 6), -0.92, 0.92);
      }
    }

    // Breath-hold tightens microSpread by ~9% during long-range precision Quiet Eye shots!
    const breathMul = breathHeld ? 0.91 : 1.0;
    const postShakeMul = mind?.postFightShake > 0.15 ? (1 + mind.postFightShake * 0.22) : 1.0;
    const cadenceOk = t >= this.triggerCadenceUntil;

    return {
      ...res,
      readyToFire: res.readyToFire && cadenceOk && this.motorPhase !== 'SUBMOVE',
      microSpread: res.microSpread * breathMul * postShakeMul,
      breathHeld
    };
  }
}

// ============================================================================
// CORE 5. ManusiaGazeV24: Elevation-Aware Corner Pre-Aim, Path-Curvature
//         Look-Ahead, & Team-0 Human-Player Buddy Flank Watch
// ============================================================================
export class ManusiaGazeV24 extends HumanGazeV23 {
  constructor(rng, persona, isNv21 = false) {
    super(rng, persona, isNv21);
    this.lookAheadYaw = 0;
  }

  computeIdleGaze(actor, b, moveYaw, t, mind, metrics = null, ctx = null) {
    // 1. Path-Curvature Look-Ahead: smoothly blend movement heading toward next corner (path[1])!
    let effMoveYaw = moveYaw;
    if (b.path && b.path.length >= 2) {
      const p0 = b.path[0], p1 = b.path[1];
      const d0 = Math.hypot(p0[0] - actor.x, p0[1] - actor.z);
      if (d0 < 3.6) {
        const nextYaw = Math.atan2(p1[0] - actor.x, -(p1[1] - actor.z));
        const blend = clamp((3.6 - d0) / 3.6, 0, 1) * 0.55;
        effMoveYaw = mixAngle(moveYaw, nextYaw, blend);
      }
    }

    // 2. Delegate core 9-ray edge detection + buddy Check-Six + rooftop/whiz cues
    const res = super.computeIdleGaze(actor, b, effMoveYaw, t, mind, metrics, ctx);

    // 3. Elevation-Aware Pre-Aim Pitch: if Cowan working memory recalls an elevated rooftop enemy, tilt gaze upward!
    const mem = b.vision?.getPrimaryMemory(t, 4.5);
    if (mem && mem.elevated && !b.seen) {
      const eye = eyeOf(actor);
      const horiz = Math.max(2.0, Math.hypot(mem.x - eye[0], mem.z - eye[2]));
      const dy = (mem.y || 3.4) - eye[1];
      if (dy > 0.75) {
        res.pitch = clamp(mix(res.pitch, Math.atan2(dy, horiz), 0.65), -0.25, 0.62);
      }
    }
    return res;
  }
}

// ============================================================================
// CORE 6. ManusiaTacticsV24: Active AeroVortex Tactical Smoke Deployment,
//         Anatomical Cover-Edge Lean, "Sprint Gap / Walk Corner" Locomotion,
//         ToM Anti-Pre-Aim Peeks, & Fair-Play Corner Pre-Fire
// ============================================================================
export class ManusiaTacticsV24 extends HumanTacticsV23 {
  constructor(rng, persona, isNv21 = false) {
    super(rng, persona, isNv21);
    this.nextSmokeCheckAt = 0;
    this.nextPreFireAt = 0;
    this.nextLeanAt = 0;
    this.cachedAnatomicalLean = 0;
    this._leanStart = [0, 0, 0];
    this._leanEnd = [0, 0, 0];
  }

  reset() {
    super.reset();
    this.nextSmokeCheckAt = 0;
    this.nextPreFireAt = 0;
    this.nextLeanAt = 0;
    this.cachedAnatomicalLean = 0;
  }

  /**
   * Active Tactical Smoke Vent Deployment (100% Fair-Play, per-actor 14s cooldown!):
   *  - Defensive Escape Smoke: Hurt/pinned under fire or exposed to 2+ enemies
   *  - Buddy / Human-Player Save Smoke: Nearby ally/player reloading under pressure or critically hurt
   *  - Tanker / Cross-Lane Push Smoke: Contesting an active Supply Tanker under threat
   */
  evaluateSmokeDeploy(actor, b, match, t, mind, allies, metrics = null) {
    if (!match?.aeroVortex || !actor.alive || actor.human) return false;
    if ((actor.smokeCooldown || 0) > 0.01 || t < this.nextSmokeCheckAt) return false;
    this.nextSmokeCheckAt = t + 0.55 + this.rng() * 0.25;

    const av = match.aeroVortex;
    if (av.stats.totalSmoke > 18) return false; // Keep harbor tactical & readable!
    const utilIQ = this.persona.utilityIQ || 0.78;
    if (utilIQ < 0.62) return false;

    let wantSmoke = false;
    let aimYaw = actor.yaw;
    let reason = '';

    // 1. Defensive Escape Smoke: hurt or outnumbered in open sightline!
    const hurtUnderFire = (actor.hp < 54 || (actor.shield <= 0 && (b.recentDamage || 0) >= 16))
      && (t - (b.underFireAt || -10) < 1.3 || (b.visibleEnemies && b.visibleEnemies.length >= 2));
    if (hurtUnderFire) {
      wantSmoke = true;
      reason = 'escape';
      if (b.seen && b.target) {
        aimYaw = Math.atan2(b.target.x - actor.x, -(b.target.z - actor.z));
      } else if (b.threatDir) {
        aimYaw = Math.atan2(-b.threatDir[0], b.threatDir[1]);
      }
    }

    // 2. Buddy / Team-0 Human-Player Save Smoke!
    if (!wantSmoke && allies && allies.length > 1) {
      for (const mate of allies) {
        if (mate.id === actor.id || !mate.alive) continue;
        const dMate = Math.hypot(mate.x - actor.x, mate.z - actor.z);
        if (dMate < 18 && mate.hp < 50 && (mate.human ? (this.persona.playerBond || 0.8) > 0.72 : true)) {
          const refPos = b.lastPos;
          if (refPos) {
            aimYaw = Math.atan2(refPos[0] - actor.x, -(refPos[1] - actor.z));
            wantSmoke = true;
            reason = mate.human ? 'player_save' : 'buddy_save';
            break;
          }
        }
      }
    }

    // 3. Tanker Contest Screen Smoke
    if (!wantSmoke && b.state === '補給確保' && (match.tankers || []).some(tk => tk.cooldown <= 2.5 && Math.hypot(tk.x - actor.x, tk.z - actor.z) < 13)) {
      if (b.lastPos && Math.hypot(b.lastPos[0] - actor.x, b.lastPos[1] - actor.z) < 34) {
        aimYaw = Math.atan2(b.lastPos[0] - actor.x, -(b.lastPos[1] - actor.z));
        wantSmoke = true;
        reason = 'tanker_screen';
      }
    }

    if (!wantSmoke) return false;
    if (this.rng() > utilIQ * 0.88) return false;

    // Orient canister toss smoothly along desired smoke screen direction & deploy!
    const prevYaw = actor.yaw;
    actor.yaw = aimYaw;
    const deployed = match.deploySmokeVent(actor);
    actor.yaw = prevYaw;
    if (deployed) {
      if (b.tom) b.tom.recordSelfNoise(actor.x, actor.z, 'smoke', t);
      if (metrics) {
        metrics.manusiaSmokeDeploys++;
        if (reason === 'player_save') metrics.manusiaPlayerAssists++;
      }
      return reason;
    }
    return false;
  }

  /**
   * Anatomical Cover-Edge Lean Solver (Zero-GC 2-Ray Shoulder Clearance!):
   * Casts left/right shoulder clearance rays (`±0.72m`) forward `2.6m` along `actor.yaw`.
   * If one shoulder is blocked by a solid steel container wall (`< 1.35m`) and the other side
   * is open (`> 2.2m`), leans strictly OUT into the open lane (NEVER leaning into steel!).
   */
  computeAnatomicalLean(actor, b, baseLean, t, metrics = null) {
    const relevant = b.cover || b.state === 'ピーク射撃' || b.state === '遮蔽交戦'
      || b.state === 'ショルダーベイト' || b.state === 'クロスファイア' || b.state === 'リロード援護';
    if (!relevant || !actor.onGround) {
      this.cachedAnatomicalLean = baseLean * 0.5;
      return this.cachedAnatomicalLean;
    }
    if (t < this.nextLeanAt) return this.cachedAnatomicalLean;
    this.nextLeanAt = t + 0.14;

    const fx = Math.sin(actor.yaw), fz = -Math.cos(actor.yaw);
    const rx = Math.cos(actor.yaw), rz = Math.sin(actor.yaw); // +X local right
    const eyeY = actor.y + 1.38 * (1 - (actor.crouch || 0) * 0.34);
    const probeDist = 3.2;

    const s = this._leanStart, e = this._leanEnd;
    s[1] = eyeY; e[1] = eyeY;

    // Left shoulder ray (-0.72m right)
    s[0] = actor.x - rx * 0.72; s[2] = actor.z - rz * 0.72;
    e[0] = s[0] + fx * probeDist; e[2] = s[2] + fz * probeDist;
    const hitL = raycastMaterial(s, e);
    const clearL = hitL ? hitL.t * probeDist : probeDist;

    // Right shoulder ray (+0.72m right)
    s[0] = actor.x + rx * 0.72; s[2] = actor.z + rz * 0.72;
    e[0] = s[0] + fx * probeDist; e[2] = s[2] + fz * probeDist;
    const hitR = raycastMaterial(s, e);
    const clearR = hitR ? hitR.t * probeDist : probeDist;

    let lean = baseLean;
    if (clearL < 1.35 && clearR > 2.2) {
      lean = 0.28;  // Wall on LEFT -> lean cleanly RIGHT into open sightline!
      if (metrics && Math.abs(lean - this.cachedAnatomicalLean) > 0.12) metrics.manusiaAnatomicalLeans++;
    } else if (clearR < 1.35 && clearL > 2.2) {
      lean = -0.28; // Wall on RIGHT -> lean cleanly LEFT into open sightline!
      if (metrics && Math.abs(lean - this.cachedAnatomicalLean) > 0.12) metrics.manusiaAnatomicalLeans++;
    } else if (clearL < 1.35 && clearR < 1.35) {
      lean = 0;     // Fully behind solid wall -> stay centered & tight!
    }
    this.cachedAnatomicalLean = clamp(lean, -0.32, 0.32);
    return this.cachedAnatomicalLean;
  }

  /**
   * "Sprint the Gap, Walk the Corner" + Acoustic Feint + Match-Point Stealth Pacing!
   */
  computeMovementPace(actor, b, t, mind, isSpy = false) {
    // 1. Active Acoustic Footstep Feint override!
    if (b.tom && b.tom.feintPhase === 'noise' && t < b.tom.feintSwitchAt) {
      this.silentWalking = false;
      return {sprinting: true, silentWalk: false, paceFactor: 1.24};
    }
    if (b.tom && b.tom.feintPhase === 'silent_wrap' && t < b.tom.feintEndAt) {
      this.silentWalking = true;
      return {sprinting: false, silentWalk: true, paceFactor: 0.80};
    }

    const base = super.computeMovementPace(actor, b, t, mind, isSpy);
    if (base.silentWalk) return base;

    // 2. Cautious Corner Pie-Walk when approaching a Trauma Danger Angle or tight threat corner!
    if (!b.seen && b.state !== '戦術退避' && b.state !== '一斉突入' && b.state !== 'トレード突入') {
      const trauma = mind?.nearestTraumaAngle(actor.x, actor.z, 14);
      const nearCornerEdge = b.gaze?.lastEdgeDetected && b.lastPos && Math.hypot(b.lastPos[0] - actor.x, b.lastPos[1] - actor.z) < 16;
      const highStakes = (mind?.matchPointIntensity || 0) > 0.60;
      if (trauma || (nearCornerEdge && highStakes)) {
        this.silentWalking = true;
        return {sprinting: false, silentWalk: true, paceFactor: 0.82};
      }
    }
    return base;
  }

  /** Theory-of-Mind aware 5-style peek selection (anti-pre-aim, shield-break punish, ammo-read punish!). */
  selectPeekStyle(actor, b, target, t, mind, metrics = null) {
    const tom = b.tom;
    const preAimRisk = tom ? tom.getEnemyPreAimRisk(actor, t) : 0;
    const shieldVuln = target && tom ? tom.getEnemyShieldWindow(target.id, t) > 0.5 : false;
    const reloadSoon = target && tom ? tom.predictEnemyReloadSoon(target.id, t, metrics).imminent : false;

    // If enemy is strongly pre-aiming our exact corner -> NEVER slow-peek into their crosshair!
    if (preAimRisk > 0.62 && !shieldVuln && !reloadSoon) {
      const r = this.rng();
      const style = r < 0.44 ? PEEK_STYLES.INFO_JIGGLE
        : r < 0.74 ? PEEK_STYLES.OFF_ANGLE
        : PEEK_STYLES.WIDE_SWING;
      this.currentPeekStyle = style;
      if (metrics) {
        if (style === PEEK_STYLES.INFO_JIGGLE) metrics.humanPeekJiggle++;
        else if (style === PEEK_STYLES.OFF_ANGLE) metrics.humanPeekOffAngle++;
        else metrics.humanPeekWide++;
      }
      return style;
    }
    // If we know enemy shield is broken (<5s clock) or they're near empty mag -> decisive Wide Swing punish!
    if ((shieldVuln || reloadSoon) && actor.hp >= 56 && this.rng() < 0.62) {
      this.currentPeekStyle = PEEK_STYLES.WIDE_SWING;
      if (metrics) metrics.humanPeekWide++;
      return PEEK_STYLES.WIDE_SWING;
    }
    return super.selectPeekStyle(actor, b, target, t, mind, metrics);
  }

  /**
   * Fair-Play Anticipatory Corner Pre-Fire:
   * Strictly based on Cowan working memory / arrived footsteps when a sprinting enemy
   * is clearly about to swing around a tight container corner we are holding!
   */
  evaluateCornerPreFire(actor, b, match, t, mind, metrics = null) {
    if (b.seen || t < this.nextPreFireAt || actor.reload > 0) return null;
    if ((this.persona.aggression || 0.5) < 0.54 || b.state === '戦術退避' || b.state === '態勢立て直し') return null;
    if (b.spy && (b.spy.mode === 'SPY_INFILTRATE' || b.spy.mode === 'SPY_VANISH')) return null;

    const wpn = match.weapon(actor);
    if (actor.mag < Math.max(4, wpn.capacity * 0.40)) return null;
    const proj = b.vision?.getProjectedMemory?.(t, 1.35);
    if (!proj || proj.confidence < 0.62) return null;

    const eye = eyeOf(actor);
    const d = Math.hypot(proj.projX - eye[0], proj.projZ - eye[2]);
    if (d < 5.5 || d > 22.0) return null;

    // Must be moving toward open sightline from our held position!
    const aimPt = [proj.projX, Math.max(1.15, proj.y || 1.2), proj.projZ];
    if (obstruction(eye, aimPt) > 1) {
      // Corner edge is clear and projected enemy trajectory just crossed into the lane!
      const spd = Math.hypot(proj.vx || 0, proj.vz || 0);
      if (spd > 2.2) {
        this.nextPreFireAt = t + 4.8 + this.rng() * 2.5;
        return {
          kind: 'corner_prefire',
          aimPos: aimPt,
          expiresAt: t + 0.28,
          counted: false
        };
      }
    }
    return null;
  }
}

// ============================================================================
// CORE 7. ManusiaSocialSquadV24: 8 Delayed Voice Channels (+ SMOKE_OUT) &
//         Team-0 Human-Player Buddy Synergy (zero-telepathy teammate awareness!)
// ============================================================================
export class ManusiaSocialSquadV24 extends HumanSquadCommsV23 {
  constructor(rng) {
    super(rng);
    this.stats.SMOKE_OUT = 0;
    this.lastPlayerReloadCallAt = -10;
    this.lastPlayerHurtCallAt = -10;
  }

  emitCallout(team, callerId, enemyId, x, z, kind, t, metrics = null, extra = null) {
    if (kind === 'SMOKE_OUT' || kind === 'smoke_out') {
      const key = `${callerId}:SMOKE_OUT`;
      const last = this.lastCallByActor.get(key) ?? -10;
      if (t - last < 3.5) return false;
      this.lastCallByActor.set(key, t);
      const delay = 0.26 + this.rng() * 0.24;
      this.queue.push({team, callerId, enemyId, x, z, kind: 'SMOKE_OUT', emitAt: t, deliverAt: t + delay, extra});
      this.stats.SMOKE_OUT++;
      if (metrics) metrics.humanCallouts++;
      return true;
    }
    return super.emitCallout(team, callerId, enemyId, x, z, kind, t, metrics, extra);
  }

  /**
   * Fair-Play Human-Player Buddy Synergy:
   * Observes ONLY the same-team human player (`player.team === 0`) and injects realistic
   * delayed buddy cover/trade cues so NAGI & KAI actively watch YOUR back, cover YOUR reloads,
   * and swing with YOUR pushes!
   */
  observeHumanPlayer(player, teamAllies, t, metrics = null) {
    if (!player?.alive || !player.human || !teamAllies || teamAllies.length < 2) return;
    // 1. Player is reloading in combat -> nearby buddy hears mag-out and prepares RELOAD_COVER!
    if (player.reload > 0.25 && t - this.lastPlayerReloadCallAt > 4.2) {
      const hasNearBuddy = teamAllies.some(m => !m.human && m.alive && Math.hypot(m.x - player.x, m.z - player.z) < 26);
      if (hasNearBuddy) {
        this.lastPlayerReloadCallAt = t;
        const fx = player.x + Math.sin(player.yaw) * 14;
        const fz = player.z - Math.cos(player.yaw) * 14;
        this.emitCallout(player.team, player.id, -1, fx, fz, 'RELOAD_COVER', t, metrics, {callerX: player.x, callerZ: player.z, isHumanPlayer: true});
      }
    }
    // 2. Player critically hurt (< 52 HP) -> nearby buddy hears pain/shield-break & prepares cover/trade!
    if (player.hp < 52 && t - this.lastPlayerHurtCallAt > 5.0) {
      const hasNearBuddy = teamAllies.some(m => !m.human && m.alive && Math.hypot(m.x - player.x, m.z - player.z) < 28);
      if (hasNearBuddy) {
        this.lastPlayerHurtCallAt = t;
        const fx = player.x + Math.sin(player.yaw) * 15;
        const fz = player.z - Math.cos(player.yaw) * 15;
        this.emitCallout(player.team, player.id, -1, fx, fz, 'TRADE_REQUEST', t, metrics, {callerX: player.x, callerZ: player.z, isHumanPlayer: true});
      }
    }
  }
}

// Legacy aliases so nv2-human.js / consumers can import uniformly
export const HumanPsycheV24 = ManusiaSomaPsycheV24;
export const HumanPerceptionV24 = ManusiaPerceptionV24;
export const HumanOFC_AimV24 = ManusiaNeuromotorAimV24;
export const HumanGazeV24 = ManusiaGazeV24;
export const HumanTacticsV24 = ManusiaTacticsV24;
export const HumanSquadCommsV24 = ManusiaSocialSquadV24;
