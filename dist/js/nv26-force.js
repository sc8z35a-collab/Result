// ============================================================================
// NV2.6 Force — S-Tier Embodied Squad-Force Cognitive, Kinetic & Vocal Engine
// ============================================================================
// Built cleanly atop NV2.5 humain -> NV 2.4 Manusia -> NV2.3 HUMAN -> NV2,
// strictly preserving 100% FAIR-PLAY (ZERO wallhack, ZERO aimbot, ZERO 0ms
// telepathy, ZERO hidden enemy coordinate reads) while achieving AAA+ / S-Tier
// observable humanity, living body language, spatial vocal presence, and true
// synchronized tactical force multiplication:
//
//   1. ForceBodyLanguageV26  : 360Hz 16-Bone GPU Skeletal Expression Kernel
//                              - Decoupled Cervical Head-Yaw (eye-first / scan /
//                                buddy-glance / startle snap-look on Neck+Head!)
//                              - Closed-Form 2-Bone IK Tactical Hand Signals
//                                (WAVE_SWING, HOLD_TRAP, POINT_CONTACT,
//                                STARTLE_JOLT, BREATH_SLUMP) mirrored in Shadow Flame!
//                              - Cardiac-Coupled Ribcage Breathing & Radio Visor Pulse
//   2. ForceVoiceProfiles    : Callsign-Unique Klatt Physical Vocal-Tract &
//                              Stress-Coupled Japanese Tactical Prosody Catalog
//                              (NAGI / KAI / RIN / SORA / AO + Enemy Overheard Shouts)
//   3. ForcePsycheV26        : Stress/BPM -> Real-Time Glottal Vocal Prosody Engine
//                              + Somatic Startle Gasp & Deep-Breath Exhale Events
//   4. ForceCounterBrainV26  : Fair-Play Strafe Reversal-Apex Predictor,
//                              Post-Kill Anti-Trade Cover-Slide, & Bait-Partner ToM
//   5. ForceTempoCoordV26    : Shared-Clock 3-2-1 Synchronized Orthogonal Crossfire
//                              Double-Swing, Bait-and-Switch Partner Overwatch,
//                              Reload-Cover Suppression Pinning, & Interactive
//                              Player Squad Orders (1: SWING / 2: COVER / 3: TRAP)
//   6. ForceSensorimotorV26  : Reversal-Apex Precision Intercept + Counted Swing
//                              Quiet-Eye Pre-Charge + Live Eye-Lead Export to GPU Rig
//   7. ForceTacticsV26       : Crossfire Staging, Bait-Partner Anchor, Player-Order
//                              Execution & Gesture-Coupled Expressive Rig Posture
//   8. ForceSocialVoiceV26   : 13-Channel Expressive Radio & 3D Spatial Vocal Bus
//                              (Allies -> Tactical Headset Radio + Sync Countdown;
//                              Enemies -> Strictly Fair-Play Acoustic Field Shouts!)
// ============================================================================

import {clamp, angleDiff} from './geometry.js';
import {walkable, obstruction} from './yard.js';
import {
  HumainAffectivePsycheV25,
  HumainMetaMindV25,
  HumainMultisensoryV25,
  HumainSensorimotorV25,
  HumainFixationGazeV25,
  HumainEmbodiedTacticsV25,
  HumainSocialMindV25,
  CALLSIGN_PROFILES_V25,
  COMMS_CHANNELS_V25
} from './nv25-humain.js';

export const NV26_FORCE_VERSION = 'NV2.6 Force';

export const FORCE_GESTURES = Object.freeze({
  NONE: 0,
  WAVE_SWING: 1,      // Left-arm military "ADVANCE / SYNC SWING!" forward wave
  HOLD_TRAP: 2,       // Low tight open-palm "HOLD / BAIT TRAP" stance signal
  POINT_CONTACT: 3,   // Forward-left "CONTACT / TARGET!" pointing gesture
  STARTLE_JOLT: -1,   // Defensive shoulder-hunch + spine recoil startle flinch
  BREATH_SLUMP: -2    // Deep-breath restorative shoulder drop / CoM braking lean
});

export const COMMS_CHANNELS_V26 = Object.freeze({
  ...COMMS_CHANNELS_V25,
  PLAYER_ORDER_SWING: 'PLAYER_ORDER_SWING',
  PLAYER_ORDER_COVER: 'PLAYER_ORDER_COVER',
  PLAYER_ORDER_TRAP: 'PLAYER_ORDER_TRAP',
  BAIT_PARTNER: 'BAIT_PARTNER',
  SUPPRESS_PIN: 'SUPPRESS_PIN'
});

// Distinct physical Klatt vocal-tract parameters per Harbor Range callsign
export const VOICE_PROFILES_V26 = Object.freeze({
  NAGI: Object.freeze({f0Hz: 146, tractScale: 0.98, tempo: 0.96, grit: 0.24, composure: 0.92, gender: 'm'}),
  KAI:  Object.freeze({f0Hz: 184, tractScale: 1.07, tempo: 1.14, grit: 0.28, composure: 0.84, gender: 'm'}),
  RIN:  Object.freeze({f0Hz: 224, tractScale: 1.16, tempo: 1.05, grit: 0.18, composure: 0.88, gender: 'f'}),
  SORA: Object.freeze({f0Hz: 132, tractScale: 0.93, tempo: 0.89, grit: 0.34, composure: 0.95, gender: 'm'}),
  AO:   Object.freeze({f0Hz: 198, tractScale: 1.11, tempo: 1.18, grit: 0.30, composure: 0.78, gender: 'm'}),
  YOU:  Object.freeze({f0Hz: 162, tractScale: 1.02, tempo: 1.04, grit: 0.22, composure: 0.90, gender: 'm'})
});

export const CALLSIGN_PROFILES_V26 = Object.freeze({
  NAGI: Object.freeze({...CALLSIGN_PROFILES_V25.NAGI, voice: VOICE_PROFILES_V26.NAGI, syncDiscipline: 0.94, baitIQ: 0.92}),
  KAI:  Object.freeze({...CALLSIGN_PROFILES_V25.KAI,  voice: VOICE_PROFILES_V26.KAI,  syncDiscipline: 0.88, baitIQ: 0.86}),
  RIN:  Object.freeze({...CALLSIGN_PROFILES_V25.RIN,  voice: VOICE_PROFILES_V26.RIN,  syncDiscipline: 0.91, baitIQ: 0.90}),
  SORA: Object.freeze({...CALLSIGN_PROFILES_V25.SORA, voice: VOICE_PROFILES_V26.SORA, syncDiscipline: 0.96, baitIQ: 0.94}),
  AO:   Object.freeze({...CALLSIGN_PROFILES_V25.AO,   voice: VOICE_PROFILES_V26.AO,   syncDiscipline: 0.84, baitIQ: 0.82})
});

// Concise, natural Japanese tactical radio lines (allies) & overheard short shouts (enemies)
export const CALLOUT_LINES_V26 = Object.freeze({
  CONTACT:            ['接敵！視認した！', 'ターゲット捕捉、交戦に入る！', '敵確認、射線通ってる！'],
  SHIELD_BREAK:       ['シールド割った！押せる！', 'アーマー砕いた、今が好機だ！', '割ったぞ、詰める！'],
  AMBUSH:             ['くっ、裏だ！側面から撃たれた！', '待て、奇襲だ！カバー頼む！', '死角からだ、体勢立て直す！'],
  RELOAD_COVER:       ['リロード中、カバー頼む！', '弾倉交換！数秒押さえてくれ！', 'リロード入る、射線気をつけて！'],
  TRADE_REQUEST:      ['削られた、トレード頼む！', '前へ出られた、横から抜いてくれ！', 'ピンチだ、クロス組んでくれ！'],
  MAN_DOWN:           ['やられた…！敵はその付近だ！', 'ダウンした…トレード頼む！', 'くそっ、落とされた！'],
  FLANK_CLEAR:        ['側面クリア、背後なし！', 'こっちのレーン安全、前へ出られる！', '裏どり警戒クリア！'],
  BAIT_READY:         ['負傷ベイト罠セット…釣るぞ！', '削られたフリで誘い込む、角で待つ！', '追ってくるぞ…ベイトで迎え撃つ！'],
  BAIT_PARTNER:       ['了解、ベイトのクロス射線張った！', '罠に合わせて横から撃ち抜く！', '釣り待ち構えてる、来たら同時に撃つ！'],
  SWING_NOW:          ['3・2・1、同期ダブルスイング！', '息合わせるぞ…今、同時に出ろ！', 'クロス展開、3・2・GO！'],
  SUPPRESS_PIN:       ['制圧射撃で頭下げさせる、動け！', '角に牽制撃つ、今のうちにリロードしろ！', '押さえ込んだ、詰めろ！'],
  PLAYER_ORDER_SWING: ['了解！同期ダブルスイング、合わせる！', 'ラジャー！3・2・1で同時に出る！'],
  PLAYER_ORDER_COVER: ['了解！あんたの死角カバーに入る！', '任せろ、クロス射線で援護する！'],
  PLAYER_ORDER_TRAP:  ['了解！角でベイト待機、敵を釣る！', 'ラジャー、オフアングルで待ち伏せる！'],
  // Short somatic/overheard cues (never reveal exact coordinates!)
  STARTLE_GASP:       ['っ！？背後か！', 'うわっ、横から！', 'ちっ、気づかれた！'],
  BREATH_RESET:       ['ふぅ…よし、落ち着け', '……集中戻した', '呼吸整えた、次いくぞ'],
  CHANGE_OF_MIND:     ['待て、複数だ…一旦引く！', 'まずい、射線多い…引き直す！'],
  ENEMY_SHOUT: {
    CONTACT:       ['「敵見つけた！」', '「いたぞ、撃て！」'],
    SHIELD_BREAK:  ['「割った！押し込め！」', '「今だ、詰めろ！」'],
    AMBUSH:        ['「背後だっ！？」', '「くそ、側面から！」'],
    RELOAD_COVER:  ['「リロード中だ、押さえろ！」', '「弾切れた、カバー！」'],
    SWING_NOW:     ['「同時に出るぞ、行け！」', '「二人で詰めろ！」'],
    BAIT_READY:    ['「…角で待つぞ」', '「引き込め…」'],
    MAN_DOWN:      ['「やられたっ！」', '「味方が落ちた！」'],
    TRADE_REQUEST: ['「援護頼む！」', '「横からカバー！」'],
    STARTLE:       ['「っ！？」', '「後ろか！？」']
  }
});

/** Human-readable Harbor Range tactical sector label (fair-play radio callout language!). */
export function sectorNameJa(x, z) {
  const ew = x < -7.5 ? '西' : x > 7.5 ? '東' : '中央';
  const ns = z < -42 ? '北埠頭' : z < -12 ? '北コンテ' : z <= 12 ? '中央クロス' : z <= 42 ? '南コンテ' : '南岸壁';
  if (ew === '中央' && ns === '中央クロス') return '中央クロス';
  return `${ns}·${ew}`;
}

/** Coarse human-audible bearing relative to listener's facing (ZERO exact coordinates!). */
export function relativeDirectionJa(srcX, srcZ, listener) {
  if (!listener) return '付近';
  const dx = srcX - listener.x, dz = srcZ - listener.z;
  const dist = Math.hypot(dx, dz);
  const bearing = Math.atan2(dx, -dz);
  const rel = angleDiff(bearing, listener.yaw || 0);
  const abs = Math.abs(rel);
  const distWord = dist < 11 ? '至近' : dist < 24 ? '近距離' : 'コンテ裏';
  let dirWord = '正面';
  if (abs < 0.42) dirWord = '正面';
  else if (abs < 1.15) dirWord = rel > 0 ? '右前方' : '左前方';
  else if (abs < 2.00) dirWord = rel > 0 ? '右側面' : '左側面';
  else if (abs < 2.65) dirWord = rel > 0 ? '右後方' : '左後方';
  else dirWord = '背後';
  return `${dirWord}·${distWord}`;
}

function pickLine(list, rng) {
  if (!Array.isArray(list) || !list.length) return '';
  return list[Math.floor((rng ? rng() : 0.37) * list.length) % list.length];
}

function getVoiceProfile(actor) {
  const key = actor?.name ? String(actor.name).toUpperCase() : '';
  return VOICE_PROFILES_V26[key] || VOICE_PROFILES_V26.NAGI;
}

// ============================================================================
// CORE 1. ForceBodyLanguageV26: 360Hz 16-Bone GPU Skeletal Micro-Expression
//         Kernel (Head-Look Decoupling, 2-Bone IK Hand Signals, Cardiac Breath)
// ============================================================================
export class ForceBodyLanguageV26 {
  constructor(rng) {
    this.rng = rng || Math.random;
    this.headYaw = 0;           // Smoothed cervical yaw offset relative to torso (-0.88..+0.88 rad)
    this.gesture = 0;           // Active FORCE_GESTURES code
    this.gestureUntil = -10;
    this.gestureBlend = 0;      // Smooth 0..1 envelope
    this.gesturePriority = 0;
    this.tension = 0.25;        // 0..1 somatic arousal/cardiac tension
    this.breathPhase = this.rng() * Math.PI * 2;
    this.pulse = 0;             // Subtle radio/trap visor pulse (0..1)
    this.speakingUntil = -10;
    this.startleArcUntil = -10;
    this.lastGestureAt = -10;
  }

  reset() {
    this.headYaw = 0;
    this.gesture = 0;
    this.gestureUntil = -10;
    this.gestureBlend = 0;
    this.gesturePriority = 0;
    this.tension = 0.22;
    this.pulse = 0;
    this.speakingUntil = -10;
    this.startleArcUntil = -10;
  }

  /** Trigger a physically animated 16-bone IK gesture with priority arbitration. */
  triggerGesture(code, duration, t, priority = 1, metrics = null) {
    if (!code) return false;
    if (t < this.gestureUntil && priority < this.gesturePriority) return false;
    const changed = this.gesture !== code || t >= this.gestureUntil;
    this.gesture = code;
    this.gestureUntil = Math.max(this.gestureUntil, t + duration);
    this.gesturePriority = priority;
    this.lastGestureAt = t;
    if (code === FORCE_GESTURES.STARTLE_JOLT) {
      this.startleArcUntil = Math.max(this.startleArcUntil, t + 0.34);
    }
    if (changed && metrics) {
      metrics.forceGestures = (metrics.forceGestures || 0) + 1;
      if (code === FORCE_GESTURES.STARTLE_JOLT) metrics.forceStartleVisuals = (metrics.forceStartleVisuals || 0) + 1;
    }
    return true;
  }

  onRadioSpeak(t, dur = 1.15) {
    this.speakingUntil = Math.max(this.speakingUntil, t + dur);
  }

  /**
   * 360Hz zero-allocation update writing `actor.expr` for WebGL2 `uExpr`,
   * Shadow Flame 1.0 shadow vertex shader, and SoftwareRenderer fallback!
   */
  step(actor, b, dt, t, mind = null, aim = null, gaze = null) {
    // 1. Cervical Head-Yaw Decoupling: Head turns BEFORE torso during eye-first saccades,
    //    epistemic lane checks, buddy glances, acoustic snap-looks, and startle threat checks!
    let targetHeadYaw = 0;
    if (mind?.isStartled?.(t) && Number.isFinite(mind.startleYaw)) {
      targetHeadYaw = clamp(angleDiff(mind.startleYaw, actor.yaw), -0.88, 0.88);
    } else if (gaze && t < (gaze.buddyGlanceUntil || -10)) {
      targetHeadYaw = clamp(angleDiff(gaze.buddyGlanceYaw, actor.yaw), -0.82, 0.82);
    } else if (gaze && t < (gaze.epistemicUntil || -10)) {
      targetHeadYaw = clamp(angleDiff(gaze.epistemicYaw, actor.yaw), -0.80, 0.80);
    } else if (aim && Number.isFinite(aim.eyeYaw)) {
      // Natural oculomotor-cervical lead: head anticipates torso turn by ~78% of eye offset!
      targetHeadYaw = clamp(angleDiff(aim.eyeYaw, actor.yaw) * 0.78, -0.78, 0.78);
    }
    const headRate = 1 - Math.exp(-(mind?.isStartled?.(t) ? 24.0 : 14.5) * dt);
    this.headYaw += (targetHeadYaw - this.headYaw) * headRate;

    // 2. Smooth 2-Bone IK Gesture Envelope — immediately releases hand back to rifle if actively firing or reloading!
    const firingNow = (actor.flash || 0) > 0.005 || (actor.recoil || 0) > 0.25 || (actor.reload || 0) > 0;
    const combatSnap = b.seen && b.target && this.gesture > 0 && (t - this.lastGestureAt > 0.28);
    const active = t < this.gestureUntil && !firingNow && !combatSnap;
    const wantBlend = active ? 1.0 : 0.0;
    const blendRate = 1 - Math.exp(-(active ? 16.0 : 20.0) * dt);
    this.gestureBlend += (wantBlend - this.gestureBlend) * blendRate;
    if (this.gestureBlend < 0.015 && !active) {
      this.gesture = 0;
      this.gestureBlend = 0;
      this.gesturePriority = 0;
    }

    // 3. Cardiac-Coupled Somatic Tension & Breath Rhythm
    const bpm = mind?.heartRate || 82;
    const breathHold = (mind?.breathHold || 0) > 0.55;
    const targetTension = breathHold
      ? 0.05
      : clamp((bpm - 68) / 105 + (mind?.stress || 0) * 0.32 + (mind?.postFightShake || 0) * 0.25, 0.08, 1.0);
    this.tension += (targetTension - this.tension) * (1 - Math.exp(-5.0 * dt));
    const breathHz = mind?.getBreathRateHz ? mind.getBreathRateHz() : (0.28 + this.tension * 0.34);
    this.breathPhase = (this.breathPhase + dt * breathHz * Math.PI * 2) % (Math.PI * 2);

    // 4. Subtle Diegetic Radio / Bait Pulse
    const speaking = t < this.speakingUntil;
    const trapHeld = !!(b.tom && t < (b.tom.baitTrapUntil || -10)) || b.state === 'ベイト連携待機';
    const targetPulse = speaking ? 1.0 : trapHeld ? 0.45 : 0.0;
    this.pulse += (targetPulse - this.pulse) * (1 - Math.exp(-10.0 * dt));

    // Encode gesture ID + smooth blend into a single GPU scalar `uExpr.y`:
    //   sign(gesture) * (abs(gesture) + clamp(blend, 0, 0.999) - 1) -> decoded cleanly in rig.js!
    //   Wait: even simpler & branch-clean for GLSL:
    //   `uExpr.y = gestureId` (integer -2..+3) and pack `blend` cleanly? Wait: we have 4 floats in `uExpr`!
    //   Let's encode:
    //     uExpr.x = headYaw (-0.9..+0.9 rad)
    //     uExpr.y = gestureEncoded: 0 if none, else sign * ((absId - 1) + clamp(blend, 0.001, 0.999))
    //       -> +0..+1: WAVE_SWING (id 1), +1..+2: HOLD_TRAP (id 2), +2..+3: POINT_CONTACT (id 3)
    //       -> -0..-1: STARTLE_JOLT (id -1), -1..-2: BREATH_SLUMP (id -2)
    //     uExpr.z = tension (0..1)
    //     uExpr.w = sin(breathPhase) * (breathHold ? 0.08 : (0.35 + tension * 0.65))
    let gestureEncoded = 0;
    if (this.gesture !== 0 && this.gestureBlend > 0.01) {
      const sgn = this.gesture > 0 ? 1 : -1;
      const absId = Math.abs(this.gesture);
      gestureEncoded = sgn * ((absId - 1) + clamp(this.gestureBlend, 0.001, 0.999));
    }
    const breathWave = Math.sin(this.breathPhase) * (breathHold ? 0.08 : (0.38 + this.tension * 0.62));

    // Reuse existing actor.expr object to maintain ZERO GC allocations at 360Hz!
    if (!actor.expr) {
      actor.expr = {
        headYaw: 0, gesture: 0, gestureBlend: 0, gestureEncoded: 0,
        tension: 0.25, breathWave: 0, pulse: 0,
        speaking: false, startleArc: 0, syncRally: false, baitReady: false
      };
    }
    const ex = actor.expr;
    ex.headYaw = this.headYaw;
    ex.gesture = this.gesture;
    ex.gestureBlend = this.gestureBlend;
    ex.gestureEncoded = gestureEncoded;
    ex.tension = this.tension;
    ex.breathWave = breathWave;
    ex.pulse = this.pulse;
    ex.speaking = speaking;
    ex.startleArc = t < this.startleArcUntil ? clamp((this.startleArcUntil - t) / 0.34, 0, 1) : 0;
    ex.syncRally = b.state === '同期ダブルスイング' || b.state === '同期待機' || b.state === 'プレイヤー命令突入';
    ex.baitReady = b.state === '負傷ベイトトラップ' || b.state === 'ベイト連携待機' || b.state === 'プレイヤー罠待機';
    return ex;
  }
}

// ============================================================================
// CORE 3. ForcePsycheV26: Vocal Stress Prosody + Observable Emotional Hooks
// ============================================================================
export class ForcePsycheV26 extends HumainAffectivePsycheV25 {
  constructor(actor, rng, isNv21 = false) {
    super(actor, rng, isNv21);
    this.voice = getVoiceProfile(actor);
    this.pendingAudioEvent = null; // One-shot observable somatic cue (startle_gasp / breath_reset)
  }

  reset() {
    super.reset();
    this.pendingAudioEvent = null;
  }

  /** Compute real-time physical Klatt glottal vocal prosody from live BPM, stress & appraisal. */
  getVocalProsody(t = 0) {
    const stress = clamp(this.stress || 0, 0, 1);
    const bpm = this.heartRate || 82;
    const arousal = clamp((bpm - 72) / 100, 0, 1);
    const startled = this.isStartleFrozen(t) || this.isStartled(t);
    return {
      f0Hz: this.voice.f0Hz * (1 + stress * 0.22 + arousal * 0.10 + (startled ? 0.18 : 0)),
      tractScale: this.voice.tractScale,
      tempo: this.voice.tempo * (1 + stress * 0.20 + (this.challengeBalance > 0.3 ? 0.06 : 0)),
      breathiness: clamp(0.14 + arousal * 0.36 + stress * 0.22, 0.10, 0.82),
      grit: clamp(this.voice.grit + stress * 0.30, 0.10, 0.85),
      stress,
      bpm: Math.round(bpm),
      urgency: clamp(stress * 0.65 + arousal * 0.35 + (startled ? 0.35 : 0), 0, 1)
    };
  }

  onUnexpectedShock(surprise, t) {
    const triggered = super.onUnexpectedShock(surprise, t);
    if (triggered) {
      this.pendingAudioEvent = {kind: 'startle', surprise, at: t};
    }
    return triggered;
  }

  onDamaged(actor, attacker, power, t, metrics = null, impactDir = null) {
    const res = super.onDamaged(actor, attacker, power, t, metrics, impactDir);
    if (res?.startled) {
      this.pendingAudioEvent = {kind: 'startle', surprise: 0.85, at: t};
    }
    return res;
  }

  triggerBreathReset(t, metrics = null) {
    const ok = super.triggerBreathReset(t, metrics);
    if (ok) {
      this.pendingAudioEvent = {kind: 'breath_reset', at: t};
    }
    return ok;
  }

  consumePendingAudioEvent() {
    const ev = this.pendingAudioEvent;
    this.pendingAudioEvent = null;
    return ev;
  }
}

// ============================================================================
// CORE 4. ForceCounterBrainV26: Fair-Play Strafe Reversal-Apex Predictor &
//         Post-Kill Anti-Trade Cover-Slide Reflex
// ============================================================================
export class ForceCounterBrainV26 extends HumainMetaMindV25 {
  constructor(rng, persona = null, isNv21 = false) {
    super(rng, persona, isNv21);
    this.enemyStrafe = new Map();     // enemyId -> {lastLatSign, lastFlipAt, avgPeriod, flips, apexUntil}
    this.postKillSlideUntil = -10;    // Brief anti-trade lateral tuck immediately after scoring a kill!
    this.postKillSlideVec = [0, 0];
    this.lastSlideAt = -10;
  }

  reset() {
    super.reset();
    this.postKillSlideUntil = -10;
  }

  /**
   * 100% Fair-Play Visual Strafe Reversal Detector:
   * Called ONLY on visibly seen enemies! Tracks lateral velocity sign flips relative to
   * our sightline and flags the exact ~160ms deceleration reversal apex where human
   * velocity briefly touches zero -> surgical counter-strafe intercept window!
   */
  observeEnemyStrafe(actor, enemy, t) {
    const dx = enemy.x - actor.x, dz = enemy.z - actor.z;
    const d = Math.hypot(dx, dz) || 1;
    // Perpendicular right vector to sightline
    const rx = -dz / d, rz = dx / d;
    const vLat = (enemy.vx || 0) * rx + (enemy.vz || 0) * rz;
    const sign = Math.abs(vLat) > 1.35 ? (vLat > 0 ? 1 : -1) : 0;

    let st = this.enemyStrafe.get(enemy.id);
    if (!st) {
      st = {lastLatSign: sign, prevSpeed: Math.abs(vLat), lastFlipAt: t, avgPeriod: 0.45, flips: 0, apexUntil: -10};
      this.enemyStrafe.set(enemy.id, st);
      return st;
    }

    // Reversal apex: was strafing briskly (>1.8 m/s), now decelerating through reversal (<1.35 m/s) or flipped sign!
    if ((sign !== 0 && st.lastLatSign !== 0 && sign !== st.lastLatSign) || (st.prevSpeed > 1.8 && Math.abs(vLat) < 1.35)) {
      const period = t - st.lastFlipAt;
      if (period > 0.14 && period < 1.45) {
        st.avgPeriod = st.avgPeriod * 0.65 + period * 0.35;
        st.flips++;
        st.lastFlipAt = t;
        st.apexUntil = t + 0.21;
      }
    }
    if (sign !== 0) st.lastLatSign = sign;
    st.prevSpeed = st.prevSpeed * 0.55 + Math.abs(vLat) * 0.45;
    return st;
  }

  isEnemyAtReversalApex(enemyId, t) {
    const st = this.enemyStrafe.get(enemyId);
    return !!(st && st.flips >= 1 && t < st.apexUntil);
  }

  /**
   * NV2.6 Force Wounded Bait-and-Switch Trap:
   * Slightly broader tactical HP window (42..72) so healthy teammates can partner-overwatch
   * the baiter's corner in 3v3 firefights!
   */
  tryStartWoundedBaitTrap(actor, b, t, metrics = null) {
    if (t < this.baitTrapUntil) {
      if (b.seen || actor.hp < 34) {
        this.baitTrapUntil = -10;
        return null;
      }
      return {active: true, yaw: this.baitTrapYaw};
    }
    if (t < this.baitTrapCooldownUntil || b.seen || !b.cover || !b.lastPos) return null;
    if (actor.hp < 44 || actor.hp > 62 || actor.mag < 6 || actor.reload > 0) return null;
    if (t - (b.underFireAt || -10) > 2.6) return null;
    const habit = this.getEnemyHabit(b.targetId ?? -1);
    const dThreat = Math.hypot(b.lastPos[0] - actor.x, b.lastPos[1] - actor.z);
    if (dThreat < 6.5 || dThreat > 25) return null;

    if (this.rng() < 0.36 + habit.greed * 0.34) {
      this.baitTrapYaw = Math.atan2(b.lastPos[0] - actor.x, -(b.lastPos[1] - actor.z));
      this.baitTrapUntil = t + 0.95 + this.rng() * 0.40;
      this.baitTrapCooldownUntil = t + 12.5;
      if (metrics) metrics.humainBaitTraps++;
      return {active: true, yaw: this.baitTrapYaw, justStarted: true};
    }
    this.baitTrapCooldownUntil = t + 3.4;
    return null;
  }

  /**
   * Anti-Trade Post-Kill Cover Slide:
   * Right after eliminating a target, immediately slip laterally toward cover safety
   * (or the LOS-breaking walkable flank!) to deny an enemy teammate's trade-swing refrag!
   */
  triggerAntiTradeSlide(actor, victimPos, otherThreatPos, t, metrics = null, coverPos = null) {
    if (!victimPos || t - this.lastSlideAt < 3.0) return false;
    const refX = otherThreatPos ? otherThreatPos[0] : victimPos[0];
    const refZ = otherThreatPos ? otherThreatPos[1] : victimPos[1];

    // Prefer sliding directly toward our nearby cover node if one exists!
    if (coverPos) {
      const cdx = coverPos[0] - actor.x, cdz = coverPos[1] - actor.z;
      const cd = Math.hypot(cdx, cdz);
      if (cd > 0.7 && cd < 8.5) {
        const cx = cdx / cd, cz = cdz / cd;
        if (walkable(actor.x + cx * 1.25, actor.z + cz * 1.25, 0.44, actor.y)) {
          this.postKillSlideVec = [cx, cz];
          this.postKillSlideUntil = t + 0.36;
          this.lastSlideAt = t;
          if (metrics) metrics.forcePostKillSlides = (metrics.forcePostKillSlides || 0) + 1;
          return true;
        }
      }
    }

    const dx = refX - actor.x, dz = refZ - actor.z;
    const d = Math.hypot(dx, dz) || 1;
    // Evaluate both walkable lateral directions and pick the one that breaks LOS from the threat!
    const prefSide = (this.persona?.habitSide || 1) * (this.rng() < 0.72 ? 1 : -1);
    let chosen = null;
    for (const side of [prefSide, -prefSide]) {
      const sx = (-dz / d) * side, sz = (dx / d) * side;
      const nx = actor.x + sx * 1.45, nz = actor.z + sz * 1.45;
      if (!walkable(nx, nz, 0.44, actor.y)) continue;
      const breaksLos = obstruction([nx, actor.y + 1.38, nz], [refX, 1.42, refZ]) <= 1;
      if (!chosen || breaksLos) {
        chosen = [sx, sz];
        if (breaksLos) break;
      }
    }
    if (chosen) {
      this.postKillSlideVec = chosen;
      this.postKillSlideUntil = t + 0.36;
      this.lastSlideAt = t;
      if (metrics) metrics.forcePostKillSlides = (metrics.forcePostKillSlides || 0) + 1;
      return true;
    }
    return false;
  }
}

// ============================================================================
// CORE 5. ForceTempoCoordV26: Shared-Clock 3-2-1 Synchronized Orthogonal
//         Crossfire, Bait-and-Switch Partner Overwatch & Player 1/2/3 Orders
// ============================================================================
export class ForceTempoCoordV26 {
  constructor() {
    this.teamSync = [null, null];     // Active counted 3-2-1 double-swing plan per team
    this.teamBait = [null, null];     // Active bait-and-switch trap coordination per team
    this.playerOrder = null;          // Active interactive Player 1/2/3 squad command
  }

  reset() {
    this.teamSync = [null, null];
    this.teamBait = [null, null];
    this.playerOrder = null;
  }

  /** Schedule a shared-clock 3-2-1 Synchronized Crossfire Double-Swing for a team! */
  scheduleSyncSwing(team, initiatorId, initiatorX, initiatorZ, targetX, targetZ, enemyId, t, delay = 0.72) {
    const prev = this.teamSync[team];
    if (prev && t < prev.expireAt - 0.5) return prev;
    const goAt = t + clamp(delay, 0.38, 1.05);
    const plan = {
      team,
      initiatorId,
      initiatorPos: [initiatorX, initiatorZ],
      targetPos: [targetX, targetZ],
      enemyId: enemyId ?? -1,
      issuedAt: t,
      goAt,
      expireAt: goAt + 2.35,
      participants: new Set([initiatorId]),
      counted: false
    };
    this.teamSync[team] = plan;
    return plan;
  }

  getActiveSync(team, t) {
    const plan = this.teamSync[team];
    if (!plan || t > plan.expireAt) return null;
    return plan;
  }

  /** Score angular crossfire separation (>= 32 deg from initiator -> lethal two-angle squeeze!). */
  scoreCrossfireAngle(candX, candZ, targetPos, initiatorPos) {
    if (!targetPos || !initiatorPos) return 0;
    const a1 = Math.atan2(initiatorPos[0] - targetPos[0], initiatorPos[1] - targetPos[1]);
    const a2 = Math.atan2(candX - targetPos[0], candZ - targetPos[1]);
    const sep = Math.abs(angleDiff(a1, a2)); // 0..PI
    // Peak crossfire bonus around 45..110 deg orthogonal angle!
    if (sep < 0.45) return -4;
    if (sep < 1.85) return 14 * Math.sin(clamp((sep - 0.35) / 1.5, 0, 1) * Math.PI * 0.75);
    return 9;
  }

  /** Register an active Wounded Bait Trap so a healthy teammate sets up Bait-Partner Overwatch! */
  registerBaitTrap(team, baiterId, baiterX, baiterZ, threatX, threatZ, enemyId, t) {
    this.teamBait[team] = {
      team,
      baiterId,
      baiterPos: [baiterX, baiterZ],
      threatPos: [threatX, threatZ],
      enemyId: enemyId ?? -1,
      until: t + 2.6,
      partnerId: -1
    };
    return this.teamBait[team];
  }

  getActiveBait(team, t) {
    const bp = this.teamBait[team];
    if (!bp || t > bp.until) return null;
    return bp;
  }

  /** Interactive Player Squad Command (1: SWING, 2: COVER, 3: TRAP) — 100% Fair-Play! */
  issuePlayerOrder(kind, player, targetPos, t) {
    const dur = kind === 'SWING' ? 5.0 : kind === 'COVER' ? 6.5 : 7.0;
    this.playerOrder = {
      kind, // 'SWING' | 'COVER' | 'TRAP'
      team: player.team,
      playerId: player.id,
      playerPos: [player.x, player.z],
      targetPos: [clamp(targetPos[0], -23, 23), clamp(targetPos[1], -96, 96)],
      issuedAt: t,
      goAt: kind === 'SWING' ? t + 0.72 : t + 0.18,
      until: t + dur,
      acknowledgedBy: new Set()
    };
    if (kind === 'SWING') {
      this.scheduleSyncSwing(player.team, player.id, player.x, player.z, targetPos[0], targetPos[1], -1, t, 0.72);
    }
    return this.playerOrder;
  }

  getPlayerOrder(team, t) {
    if (!this.playerOrder || this.playerOrder.team !== team || t > this.playerOrder.until) return null;
    return this.playerOrder;
  }
}

// ============================================================================
// CORE 6. ForceSensorimotorV26: Reversal-Apex Precision Intercept + Counted
//         Sync-Swing Quiet-Eye Pre-Charge
// ============================================================================
export class ForceSensorimotorV26 extends HumainSensorimotorV25 {
  constructor(rng, isNv21 = false, persona = null) {
    super(rng, isNv21, persona);
    this.lastReversalLockAt = -10;
  }

  step(a, dt, t, opts = {}) {
    const {seenTarget, tom, metrics, syncStaging, syncExecuting, baitOverwatch} = opts;

    // Pre-charge Quiet Eye behind cover during counted 3-2-1 Sync Double-Swing or Bait-Partner Overwatch!
    if ((syncStaging || syncExecuting || baitOverwatch) && !seenTarget && Math.hypot(a.vx || 0, a.vz || 0) < 3.4) {
      this.quietEyeAccum = Math.max(this.quietEyeAccum, 0.115);
    }

    const res = super.step(a, dt, t, opts);

    // Fair-Play Strafe Reversal-Apex Precision Bonus:
    // Catching a visually observed strafing enemy right at their directional deceleration apex!
    let reversalLock = false;
    if (seenTarget && tom?.isEnemyAtReversalApex?.(seenTarget.id, t) && res.alignPerceived < 0.085 && !res.liftingMouse) {
      reversalLock = true;
      if (t - this.lastReversalLockAt > 0.65) {
        this.lastReversalLockAt = t;
        if (metrics) metrics.forceReversalLocks = (metrics.forceReversalLocks || 0) + 1;
      }
    }

    const squadComposure = (syncExecuting || baitOverwatch) && !res.liftingMouse ? 0.82 : 1.0;
    const spreadMult = (reversalLock ? 0.78 : 1.0) * squadComposure;

    return {
      ...res,
      microSpread: res.microSpread * spreadMult,
      reversalLock
    };
  }
}

// ============================================================================
// CORE 7. ForceTacticsV26: Gesture-Coupled Expressive Posture + Suppression Pin
// ============================================================================
export class ForceTacticsV26 extends HumainEmbodiedTacticsV25 {
  constructor(rng, persona = null, isNv21 = false) {
    super(rng, persona, isNv21);
    this.suppressPinUntil = -10;
    this.suppressPinPos = null;
    this.lastSuppressPinAt = -10;
  }

  reset() {
    super.reset();
    this.suppressPinUntil = -10;
    this.suppressPinPos = null;
  }

  /** Schedule a short fair-play corner-lip pinning burst to cover a reloading/flanking ally! */
  scheduleSuppressPin(targetPos, t, dur = 0.65) {
    if (!targetPos || t - this.lastSuppressPinAt < 6.5) return false;
    this.suppressPinPos = [targetPos[0], 1.28, targetPos[1]];
    this.suppressPinUntil = t + dur;
    this.lastSuppressPinAt = t;
    return true;
  }

  getActiveSuppressPin(actor, t, metrics = null) {
    if (!this.suppressPinPos || t >= this.suppressPinUntil) return null;
    if (actor.reload > 0 || actor.mag < 14 || actor.hp < 72) return null;
    const dPin = Math.hypot(this.suppressPinPos[0] - actor.x, this.suppressPinPos[2] - actor.z);
    if (dPin < 10 || dPin > 28) return null;
    // Strictly check clear ballistic corridor to the observed corner lip!
    const eye = [actor.x, actor.y + 1.44, actor.z];
    if (obstruction(eye, this.suppressPinPos) <= 1) return null;
    if (metrics) metrics.forceSuppressPins = (metrics.forceSuppressPins || 0) + 1;
    this.suppressPinUntil = -10; // Count once per burst window
    return {kind: 'suppress_pin', aimPos: this.suppressPinPos, counted: true};
  }

  refineExpressivePose(actor, b, basePose, t, mind) {
    const p = super.refineExpressivePose(actor, b, basePose, t, mind);
    const gest = b.body?.gesture || 0;
    const trapStance = b.state === '負傷ベイトトラップ' || b.state === 'ベイト連携待機' || b.state === 'プレイヤー罠待機';
    const syncStance = b.state === '同期ダブルスイング' || b.state === '同期待機' || b.state === 'プレイヤー命令突入';
    return {
      crouch: (p.crouch || trapStance || gest === FORCE_GESTURES.STARTLE_JOLT) && !b.vault && actor.onGround,
      lean: trapStance ? clamp(p.lean * 0.65, -0.55, 0.55) : p.lean,
      ads: p.ads || trapStance || syncStance
    };
  }
}

// ============================================================================
// CORE 8. ForceSocialVoiceV26: Expressive Radio & 3D Spatial Vocal Signal Bus
// ============================================================================
export class ForceSocialVoiceV26 extends HumainSocialMindV25 {
  constructor(rng) {
    super(rng);
    this.stats.BAIT_PARTNER = 0;
    this.stats.SUPPRESS_PIN = 0;
    this.stats.PLAYER_ORDER_SWING = 0;
    this.stats.PLAYER_ORDER_COVER = 0;
    this.stats.PLAYER_ORDER_TRAP = 0;
    this.lastRadioBroadcastAt = -10;
    this.lastEnemyShoutAt = -10;
  }

  /**
   * Build a 100% fair-play observable audio-visual NPC signal payload (`match.event('npcSignal', ...)`).
   * - Ally team signals: Tactical radio line + Klatt vocal profile + prosody + optional 3-2-1 syncGoAt!
   * - Enemy team signals: Strictly spatial world-position vocalization ONLY (zero exact target coords!).
   */
  buildSignalPayload(actor, kind, t, opts = {}) {
    const profile = getVoiceProfile(actor);
    const prosody = opts.prosody || {
      f0Hz: profile.f0Hz,
      tractScale: profile.tractScale,
      tempo: profile.tempo,
      breathiness: 0.22,
      grit: profile.grit,
      stress: clamp(opts.stress || 0.25, 0, 1),
      bpm: 92,
      urgency: clamp(opts.stress || 0.25, 0, 1)
    };
    const isAlly = opts.playerTeam != null ? (actor.team === opts.playerTeam) : (actor.team === 0);

    let lineJa = '';
    if (isAlly) {
      const pool = CALLOUT_LINES_V26[kind] || CALLOUT_LINES_V26.CONTACT;
      lineJa = pickLine(pool, this.rng);
    } else {
      const ePool = CALLOUT_LINES_V26.ENEMY_SHOUT[kind] || CALLOUT_LINES_V26.ENEMY_SHOUT.CONTACT;
      lineJa = pickLine(ePool, this.rng);
    }

    const sectorJa = isAlly && Number.isFinite(opts.refX) && Number.isFinite(opts.refZ)
      ? sectorNameJa(opts.refX, opts.refZ)
      : (isAlly ? sectorNameJa(actor.x, actor.z) : '');

    return {
      type: 'npcSignal',
      actor,
      team: actor.team,
      callsign: actor.name || 'UNIT',
      kind, // 'CONTACT' | 'SHIELD_BREAK' | 'AMBUSH' | 'SWING_NOW' | 'BAIT_READY' | 'STARTLE' | 'BREATH_RESET' | ...
      isRadio: isAlly && kind !== 'BREATH_RESET' && kind !== 'STARTLE',
      pos: [actor.x, actor.y + 1.54, actor.z], // Speaker's own mouth world position (for 3D physical acoustics!)
      lineJa,
      sectorJa,
      prosody,
      stress: prosody.stress,
      urgency: prosody.urgency,
      syncGoAt: opts.syncGoAt ?? null,
      gesture: opts.gesture ?? 0,
      time: t
    };
  }

  /** Rate-limited radio/spatial dispatch so voice comms stay punchy, crisp, and never spammy! */
  canEmitSignal(isAlly, kind, t) {
    if (kind === 'STARTLE' || kind === 'SWING_NOW' || kind === 'PLAYER_ORDER_SWING'
      || kind === 'PLAYER_ORDER_COVER' || kind === 'PLAYER_ORDER_TRAP' || kind === 'MAN_DOWN') {
      const minGap = isAlly ? 0.55 : 0.70;
      if (isAlly && t - this.lastRadioBroadcastAt < minGap) return false;
      if (!isAlly && t - this.lastEnemyShoutAt < minGap) return false;
    } else {
      const minGap = isAlly ? 1.55 : 1.95;
      if (isAlly && t - this.lastRadioBroadcastAt < minGap) return false;
      if (!isAlly && t - this.lastEnemyShoutAt < minGap) return false;
    }
    if (isAlly) this.lastRadioBroadcastAt = t;
    else this.lastEnemyShoutAt = t;
    return true;
  }

  emitCallout(team, callerId, enemyId, x, z, kind, t, metrics = null, extra = null) {
    if (kind === 'BAIT_PARTNER' || kind === 'SUPPRESS_PIN'
      || kind === 'PLAYER_ORDER_SWING' || kind === 'PLAYER_ORDER_COVER' || kind === 'PLAYER_ORDER_TRAP') {
      const key = `${callerId}:${kind}`;
      const last = this.lastCallByActor.get(key) ?? -10;
      if (t - last < 1.15) return false;
      this.lastCallByActor.set(key, t);
      const delay = 0.18 + this.rng() * 0.14;
      this.queue.push({
        team, callerId, enemyId,
        x: clamp(x, -23, 23),
        z: clamp(z, -96, 96),
        kind,
        lane: extra?.lane ?? (x < -7 ? -1 : x > 7 ? 1 : 0),
        callerX: extra?.callerX ?? x,
        callerZ: extra?.callerZ ?? z,
        extra: extra || null,
        deliverAt: t + delay
      });
      if (this.queue.length > 40) this.queue.shift();
      this.stats[kind] = (this.stats[kind] || 0) + 1;
      if (metrics) metrics.humanCallouts++;
      return true;
    }
    return super.emitCallout(team, callerId, enemyId, x, z, kind, t, metrics, extra);
  }
}

// Re-export untouched NV2.5 modules + semantic aliases
export {
  HumainActiveInferenceV25 as ForceActiveInferenceV26,
  HumainDecisionDDM_V25 as ForceDecisionDDM_V26,
  HumainMultisensoryV25 as ForceMultisensoryV26,
  HumainFixationGazeV25 as ForceFixationGazeV26
} from './nv25-humain.js';
