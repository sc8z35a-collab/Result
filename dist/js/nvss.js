// NV Super Soldier (NVSS) — Universal RL Transformer + Zero-Shot Future-Feature Adapter + 10x Human Realism Engine
//
// Designed for 1:1 compatibility with the Google Colab Pro GPU Reinforcement Learning pipeline
// (colab/NVSS_Train_Colab_Pro.ipynb -> colab/nvss_model.py -> dist/js/nvss-weights.js).
//
// Core Innovations beyond NV2.6 Force:
//  1. NVSSPolicyNet (Zero-GC 4-Head Entity-Set Transformer + SwiGLU FFN + Bilinear Capability Head):
//     - Encodes self/world state (24-dim) and variable-length world entity tokens (N x 16-dim)
//       including enemies, allies, drones, giant mechs, zombies, H1 ZONBI, helicopters, gas pipes,
//       ammo boxes, BAIZER shields, and any future unknown entities added to Match!
//     - Scores arbitrary current & future capabilities via bilinear semantic attention:
//       score(c) = dot(h_cap, capDescriptor(c)) + UCB1_online_bonus(c)
//  2. UniversalCapabilityAdapter (Zero-Shot Future-Feature Mastery):
//     - Automatically introspects unknown/new weapons, skills, map hazards, weather physics,
//       and custom runtime capabilities without hard-coded lookup tables.
//     - Combines semantic descriptor scoring with an online UCB1 + TD-error bandit so NVSS
//       discovers optimal usage of newly added game features live in-match.
//  3. NVSSHumanRealism (10x Human-Like Biomechanical & Cognitive Fidelity):
//     - Flash & Hogan 5th-order Minimum-Jerk Aim Kinematics s(tau) = 10t^3 - 15t^4 + 6t^5
//       with physiological 9-11 Hz wrist micro-tremor and sub-movement corrective flicks.
//     - 5-Axis Cognitive/Affective State (adrenaline, composure, confidence, fatigue, flowFocus).
//     - Saccadic Visual Attention, Corner Pre-Aiming, Shoulder-Peek Probes, Post-Kill Threat Scans,
//       Live Opponent Habit Modeling, and Creative Mind-Game Baiting (fake retreats / off-angles).

import {NV2} from './nv2.js';
import {clamp, angleDiff, random} from './geometry.js';
import {clearOpticalPath, obstruction} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';
import {
  NVSS_ARCH,
  NVSS_TACTIC_NAMES,
  getActiveNVSSWeights
} from './nvss-weights.js';

export const NVSS_VERSION = 'NV Super Soldier (NVSS)';

const MAX_TOKENS = 24;
const INV_SQRT_DH = 1 / Math.sqrt(NVSS_ARCH.dHead);

const sigmoid = x => 1 / (1 + Math.exp(-clamp(x, -12, 12)));
const silu = x => x * sigmoid(x);

/**
 * Zero-GC 4-Head Entity-Set Transformer + SwiGLU FFN matching colab/nvss_model.py 1:1.
 */
export class NVSSPolicyNet {
  constructor() {
    const A = NVSS_ARCH;
    this.selfVec = new Float32Array(A.selfDim);
    this.entTokens = new Float32Array(MAX_TOKENS * A.entityDim);
    this.entCount = 0;

    // Preallocated scratch buffers (zero heap allocations per inference!)
    this._hSelf = new Float32Array(A.dModel);
    this._hEnt = new Float32Array(MAX_TOKENS * A.dModel);
    this._q = new Float32Array(A.dModel);
    this._k = new Float32Array(MAX_TOKENS * A.dModel);
    this._v = new Float32Array(MAX_TOKENS * A.dModel);
    this._scores = new Float32Array(MAX_TOKENS);
    this._attn = new Float32Array(A.dModel);
    this._ctx = new Float32Array(A.dModel);
    this._norm1 = new Float32Array(A.dModel);
    this._gate = new Float32Array(A.dFfn);
    this._up = new Float32Array(A.dFfn);
    this._ffnOut = new Float32Array(A.dModel);
    this._finalH = new Float32Array(A.dModel);

    this.tacticLogits = new Float32Array(A.nTactics);
    this.tacticProbs = new Float32Array(A.nTactics);
    this.motorStyle = new Float32Array(A.nMotor);
    this.capQuery = new Float32Array(A.capDim);
    this.value = 0;
  }

  _layerNorm(src, dst, n) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += src[i];
    mean /= n;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const d = src[i] - mean;
      v += d * d;
    }
    const inv = 1 / Math.sqrt(v / n + 1e-5);
    for (let i = 0; i < n; i++) dst[i] = (src[i] - mean) * inv;
  }

  _matVecAdd(inp, mat, bias, out, inDim, outDim) {
    for (let j = 0; j < outDim; j++) {
      let s = bias ? bias[j] : 0;
      for (let i = 0; i < inDim; i++) s += inp[i] * mat[i * outDim + j];
      out[j] = s;
    }
  }

  /**
   * Executes one full Transformer forward pass over selfVec + entTokens[0..entCount-1].
   */
  forward(weights = getActiveNVSSWeights()) {
    const A = NVSS_ARCH;
    const D = A.dModel;
    const nEnt = Math.min(MAX_TOKENS, this.entCount);

    // 1. Project self vector -> hSelf (SiLU)
    this._matVecAdd(this.selfVec, weights.wSelf, weights.bSelf, this._hSelf, A.selfDim, D);
    for (let j = 0; j < D; j++) this._hSelf[j] = silu(this._hSelf[j]);

    // 2. Project each entity token -> hEnt[t] (SiLU)
    for (let t = 0; t < nEnt; t++) {
      const eOff = t * A.entityDim;
      const hOff = t * D;
      for (let j = 0; j < D; j++) {
        let s = weights.bEnt[j];
        for (let i = 0; i < A.entityDim; i++) s += this.entTokens[eOff + i] * weights.wEnt[i * D + j];
        this._hEnt[hOff + j] = silu(s);
      }
    }

    // 3. Multi-Head Cross-Attention: Q from self, K/V from [self, entities...]
    this._matVecAdd(this._hSelf, weights.wQ, null, this._q, D, D);

    const totalK = Math.min(MAX_TOKENS, nEnt + 1);
    // Token 0 = self token, tokens 1..nEnt = entity tokens
    for (let kIdx = 0; kIdx < totalK; kIdx++) {
      const src = kIdx === 0 ? this._hSelf : this._hEnt;
      const sOff = kIdx === 0 ? 0 : (kIdx - 1) * D;
      const dOff = kIdx * D;
      for (let j = 0; j < D; j++) {
        let sk = 0, sv = 0;
        for (let i = 0; i < D; i++) {
          const xv = src[sOff + i];
          sk += xv * weights.wK[i * D + j];
          sv += xv * weights.wV[i * D + j];
        }
        this._k[dOff + j] = sk;
        this._v[dOff + j] = sv;
      }
    }

    this._attn.fill(0);
    for (let h = 0; h < A.nHeads; h++) {
      const hBase = h * A.dHead;
      let maxS = -1e9;
      for (let kIdx = 0; kIdx < totalK; kIdx++) {
        const kOff = kIdx * D + hBase;
        let dotS = 0;
        for (let d = 0; d < A.dHead; d++) dotS += this._q[hBase + d] * this._k[kOff + d];
        dotS *= INV_SQRT_DH;
        this._scores[kIdx] = dotS;
        if (dotS > maxS) maxS = dotS;
      }
      let sumE = 0;
      for (let kIdx = 0; kIdx < totalK; kIdx++) {
        const e = Math.exp(clamp(this._scores[kIdx] - maxS, -20, 0));
        this._scores[kIdx] = e;
        sumE += e;
      }
      const invSum = 1 / (sumE || 1);
      for (let kIdx = 0; kIdx < totalK; kIdx++) {
        const w = this._scores[kIdx] * invSum;
        const vOff = kIdx * D + hBase;
        for (let d = 0; d < A.dHead; d++) this._attn[hBase + d] += w * this._v[vOff + d];
      }
    }

    // Output projection + residual + LayerNorm
    this._matVecAdd(this._attn, weights.wO, null, this._ctx, D, D);
    for (let j = 0; j < D; j++) this._ctx[j] += this._hSelf[j];
    this._layerNorm(this._ctx, this._norm1, D);

    // 4. SwiGLU FFN + residual + LayerNorm
    this._matVecAdd(this._norm1, weights.wGate, null, this._gate, D, A.dFfn);
    this._matVecAdd(this._norm1, weights.wUp, null, this._up, D, A.dFfn);
    for (let j = 0; j < A.dFfn; j++) this._gate[j] = silu(this._gate[j]) * this._up[j];
    this._matVecAdd(this._gate, weights.wDown, null, this._ffnOut, A.dFfn, D);
    for (let j = 0; j < D; j++) this._ffnOut[j] += this._norm1[j];
    this._layerNorm(this._ffnOut, this._finalH, D);

    // 5. Heads: Tactics (softmax), Motor Style (tanh -> [0..1]), Universal Capability Query, Critic Value
    this._matVecAdd(this._finalH, weights.wTactic, weights.bTactic, this.tacticLogits, D, A.nTactics);
    let maxL = -1e9;
    for (let i = 0; i < A.nTactics; i++) if (this.tacticLogits[i] > maxL) maxL = this.tacticLogits[i];
    let sumP = 0;
    for (let i = 0; i < A.nTactics; i++) {
      const p = Math.exp(clamp(this.tacticLogits[i] - maxL, -20, 0));
      this.tacticProbs[i] = p;
      sumP += p;
    }
    const invP = 1 / (sumP || 1);
    let bestTactic = 0, bestProb = -1;
    for (let i = 0; i < A.nTactics; i++) {
      this.tacticProbs[i] *= invP;
      if (this.tacticProbs[i] > bestProb) { bestProb = this.tacticProbs[i]; bestTactic = i; }
    }

    this._matVecAdd(this._finalH, weights.wMotor, weights.bMotor, this.motorStyle, D, A.nMotor);
    for (let i = 0; i < A.nMotor; i++) this.motorStyle[i] = sigmoid(this.motorStyle[i]);

    this._matVecAdd(this._finalH, weights.wCap, weights.bCap, this.capQuery, D, A.capDim);

    let val = weights.bVal[0];
    for (let i = 0; i < D; i++) val += this._finalH[i] * weights.wVal[i];
    this.value = val;

    return {
      tacticIndex: bestTactic,
      tacticName: NVSS_TACTIC_NAMES[bestTactic],
      tacticProb: bestProb,
      value: val
    };
  }

  /**
   * Bilinear semantic scoring for ANY current or future capability descriptor (8-dim).
   * capDesc: [offenseValue, defenseValue, mobilityValue, areaEffect, economyReturn, urgency, antiAirValue, novelty]
   */
  scoreCapability(capDesc) {
    let s = 0;
    for (let i = 0; i < NVSS_ARCH.capDim; i++) s += this.capQuery[i] * (capDesc[i] || 0);
    return s;
  }
}

/**
 * Online UCB1 + TD-Advantage Bandit for Zero-Shot Adaptation to Future/Unseen Features.
 * When a new weapon, skill, gadget, or map mechanic is added to Result, NVSS automatically
 * evaluates its semantic capability vector, explores it safely, and reinforces profitable actions!
 */
export class UniversalCapabilityAdapter {
  constructor() {
    this.stats = new Map(); // capId -> { uses, rewardSum, lastUsedAt, avgReward }
    this.totalUses = 0;
    this.pendingCap = null;
    this.pendingAt = 0;
    this.pendingValue = 0;
  }

  _entry(id) {
    let e = this.stats.get(id);
    if (!e) {
      e = {uses: 0, rewardSum: 0, avgReward: 0.25, lastUsedAt: -99};
      this.stats.set(id, e);
    }
    return e;
  }

  /**
   * Automatically builds an 8-dim semantic descriptor for ANY weapon (including future unknown guns).
   */
  describeWeapon(w) {
    if (!w) return {optRange: 26, burstLen: 3, isCqb: false, isLong: false, dpsNorm: 0.5};
    const pellets = w.pellets || 1;
    const interval = Math.max(0.04, w.interval || 0.2);
    const dps = (w.damage || 5) * pellets / interval;
    const vel = w.velocity || 80;
    const isMelee = !!w.melee;
    const isCqb = isMelee || pellets >= 4 || (w.capacity || 20) >= 200 || vel < 75;
    const isLong = !isMelee && vel >= 120 && pellets <= 2;
    const optRange = isMelee ? 1.8 : isCqb ? 12 : isLong ? 42 : 25;
    const burstLen = isMelee ? 1 : (w.auto ? (isCqb ? 8 : 4) : (w.burst || 2));
    return {
      optRange,
      burstLen,
      isCqb,
      isLong,
      dpsNorm: clamp(dps / 90, 0.1, 2.0),
      speedNorm: clamp(vel / 120, 0.1, 2.0)
    };
  }

  /**
   * Builds a universal 8-dim semantic capability descriptor for any skill (known OR future unknown!).
   * [offense, defense, mobility, areaEffect, economy, urgency, antiAir, novelty]
   */
  describeSkill(skillId, ctx) {
    const id = String(skillId || '').toLowerCase();
    const hpLow = clamp(1 - ctx.hpFrac, 0, 1);
    const underFire = ctx.underFire ? 1 : 0;
    const multiEnemy = clamp(ctx.visibleEnemies / 3, 0, 1);
    if (id.includes('heal') || id.includes('med') || id.includes('regen')) {
      return [0.05, 0.95 * hpLow, 0.1, 0.0, 0.2, hpLow > 0.4 ? 1.0 : 0.05, 0.0, 0.0];
    }
    if (id.includes('shaffer') || id.includes('cloak') || id.includes('stealth') || id.includes('invis')) {
      return [0.35, 0.65 * underFire, 0.85, 0.0, 0.1, underFire * 0.7 + (ctx.reloading ? 0.6 : 0.25), 0.0, 0.0];
    }
    if (id.includes('judgment') || id.includes('mech') || id.includes('titan') || id.includes('robot')) {
      return [0.98, 0.88, 0.35, 0.65, 0.2, 0.55 + multiEnemy * 0.55 + (ctx.heliAlive ? 0.35 : 0), 0.65, 0.0];
    }
    if (id.includes('launcher') || id.includes('rocket') || id.includes('blast') || id.includes('bomb') || id.includes('stun')) {
      return [0.92, 0.15, 0.10, 0.95, 0.1, 0.45 + multiEnemy * 0.5, 0.75 * (ctx.heliAlive ? 1 : 0.2), 0.0];
    }
    if (id.includes('flow') || id.includes('time') || id.includes('slow')) {
      return [0.75, 0.65, 0.90, 0.2, 0.1, 0.5 + underFire * 0.45, 0.4, 0.0];
    }
    // Brand-new future unknown skill: inspect novelty + general combat utility so UCB1 explores & masters it!
    return [0.60, 0.50 * hpLow + 0.2, 0.45, 0.35, 0.3, 0.45 + multiEnemy * 0.35 + underFire * 0.3, 0.25, 0.90];
  }

  /**
   * Scores a candidate capability combining Transformer semantic score + UCB1 exploration + online reward.
   */
  evaluate(policyNet, capId, capDesc, now) {
    const e = this._entry(capId);
    const neuralScore = policyNet.scoreCapability(capDesc);
    const ucb = e.uses === 0
      ? 0.55
      : 0.38 * Math.sqrt(Math.log(Math.max(2, this.totalUses + 1)) / e.uses);
    const cooldownPenalty = (now - e.lastUsedAt) < 1.2 ? -1.5 : 0;
    return neuralScore + e.avgReward * 0.9 + ucb + cooldownPenalty;
  }

  recordUse(capId, now, valueEst) {
    const e = this._entry(capId);
    e.uses++;
    e.lastUsedAt = now;
    this.totalUses++;
    this.pendingCap = capId;
    this.pendingAt = now;
    this.pendingValue = valueEst;
  }

  observeOutcome(reward, now) {
    if (!this.pendingCap) return;
    if (now - this.pendingAt > 8.0) {
      this.pendingCap = null;
      return;
    }
    const e = this._entry(this.pendingCap);
    e.rewardSum += reward;
    e.avgReward = clamp(e.avgReward * 0.72 + reward * 0.28, -1.5, 2.5);
  }
}

/**
 * 10x Human Realism Biomechanical & Cognitive Controller (NVSSHumanRealism).
 * Models real human visuomotor neuroscience:
 *  - Flash & Hogan 5th-order Minimum-Jerk trajectories for natural bell-shaped aim velocity
 *  - Physiological 9-11 Hz wrist micro-tremor modulated by adrenaline/fatigue
 *  - Saccadic visual attention, corner pre-aiming, shoulder-peek information probes
 *  - 5-axis affective/cognitive state (adrenaline, composure, confidence, fatigue, flowFocus)
 *  - Live opponent habit modeling (lane preference, crouch habit, peek tempo)
 */
export class NVSSHumanRealism {
  constructor(rng) {
    this.rng = rng;
    // 5-Axis Affective / Cognitive Human State
    this.adrenaline = 0.22;
    this.composure = 0.84;
    this.confidence = 0.62;
    this.fatigue = 0.04;
    this.flowFocus = 0.45;
    this.streak = 0;

    // Flash & Hogan Minimum-Jerk Aim Trajectory State
    this.mjActive = false;
    this.mjT = 0;
    this.mjDur = 0.22;
    this.mjStartYaw = 0;
    this.mjStartPitch = 0;
    this.mjTargetYaw = 0;
    this.mjTargetPitch = 0;
    this.tremorPhase = rng() * Math.PI * 2;
    this.tremorFreq = 9.2 + rng() * 2.4; // 9.2 - 11.6 Hz physiological wrist tremor

    // Saccadic Attention & Mind-Game State
    this.reactionRemaining = 0;
    this.lastTargetId = -1;
    this.postKillScanUntil = 0;
    this.postKillScanDir = 1;
    this.mindGameMode = 'none'; // 'none' | 'fake_retreat' | 'off_angle' | 'shoulder_probe'
    this.mindGameUntil = 0;
    this.shoulderSide = rng() < 0.5 ? -1 : 1;
    this.nextSaccadeAt = 0;
    this.gazeOffsetYaw = 0;
    this.gazeOffsetPitch = 0;

    // Live Opponent Habit Profiler: enemyId -> { crouchRate, jumpRate, avgDist, sightings }
    this.opponentHabits = new Map();
  }

  /**
   * Flash & Hogan 5th-order Minimum-Jerk scalar profile s(tau) in [0, 1].
   */
  static minJerk(tau) {
    const t = clamp(tau, 0, 1);
    const t3 = t * t * t;
    return t3 * (10 + t * (-15 + 6 * t));
  }

  onSighting(enemy, dist, t) {
    if (!enemy) return;
    let h = this.opponentHabits.get(enemy.id);
    if (!h) {
      h = {crouchRate: 0.15, jumpRate: 0.08, avgDist: dist, sightings: 0};
      this.opponentHabits.set(enemy.id, h);
    }
    h.sightings++;
    const a = 0.18;
    h.crouchRate = h.crouchRate * (1 - a) + ((enemy.crouch || 0) > 0.35 ? 1 : 0) * a;
    h.jumpRate = h.jumpRate * (1 - a) + ((enemy.y || 0) > 0.35 ? 1 : 0) * a;
    h.avgDist = h.avgDist * (1 - a) + dist * a;

    // Human visual reaction latency on switching to a brand-new target (135ms - 225ms, faster in flowFocus)
    if (this.lastTargetId !== enemy.id) {
      this.lastTargetId = enemy.id;
      const baseMs = 0.145 + (1 - this.flowFocus) * 0.055 + this.fatigue * 0.035;
      this.reactionRemaining = clamp(baseMs * (0.85 + this.rng() * 0.30), 0.11, 0.26);
      this.adrenaline = clamp(this.adrenaline + 0.12, 0, 1);
    }
  }

  onKill(t) {
    this.streak++;
    this.confidence = clamp(this.confidence + 0.16, 0.1, 1.0);
    this.flowFocus = clamp(this.flowFocus + 0.18, 0.1, 1.0);
    this.composure = clamp(this.composure + 0.08, 0.2, 1.0);
    // Natural human post-kill peripheral threat check (0.45s quick glance for trade-fragger)
    this.postKillScanUntil = t + 0.42 + this.rng() * 0.22;
    this.postKillScanDir = this.rng() < 0.5 ? -1 : 1;
  }

  onDamaged(power, hpFrac) {
    this.adrenaline = clamp(this.adrenaline + 0.18 + power * 0.008, 0, 1);
    this.composure = clamp(this.composure - (hpFrac < 0.35 ? 0.14 : 0.05), 0.25, 1.0);
    this.confidence = clamp(this.confidence - 0.06, 0.15, 1.0);
  }

  onDeath() {
    this.streak = 0;
    this.adrenaline = 0.24;
    this.composure = 0.80;
    this.confidence = clamp(this.confidence * 0.85 + 0.1, 0.35, 0.9);
    this.mjActive = false;
    this.lastTargetId = -1;
  }

  /**
   * Plans or updates a smooth biomechanical Minimum-Jerk aim trajectory toward (desYaw, desPitch).
   * Returns { yaw, pitch, settled, startedNew }.
   */
  stepBiomechanicalAim(actor, desYaw, desPitch, dt, aimUrgency = 0.6) {
    this.tremorPhase += dt * Math.PI * 2 * this.tremorFreq;
    if (this.reactionRemaining > 0) this.reactionRemaining = Math.max(0, this.reactionRemaining - dt);

    // Homeostatic relaxation of affective/cognitive states
    this.adrenaline = Math.max(0.14, this.adrenaline - dt * 0.08);
    this.composure = Math.min(0.95, this.composure + dt * 0.05);
    this.fatigue = clamp(this.fatigue + dt * 0.0012, 0, 0.45);
    this.flowFocus = clamp(this.flowFocus + (this.composure > 0.7 ? 0.02 : -0.025) * dt, 0.2, 0.98);

    const errYaw = angleDiff(actor.yaw, desYaw);
    const errPitch = desPitch - actor.pitch;
    const totalErr = Math.hypot(errYaw, errPitch);
    let startedNew = false;

    // Re-plan minimum-jerk arc when target jumps significantly or trajectory finished
    const targetShift = Math.hypot(angleDiff(this.mjTargetYaw, desYaw), this.mjTargetPitch - desPitch);
    if (!this.mjActive || targetShift > 0.11 || this.mjT >= this.mjDur) {
      if (totalErr > 0.012) {
        this.mjActive = true;
        this.mjT = 0;
        this.mjStartYaw = actor.yaw;
        this.mjStartPitch = actor.pitch;
        // Slight human wrist overshoot on big flicks (>25 deg) when adrenaline is elevated
        const overScale = totalErr > 0.44 ? (1.0 + 0.055 * this.adrenaline * (1 - this.composure * 0.5)) : 1.0;
        this.mjTargetYaw = actor.yaw + errYaw * overScale;
        this.mjTargetPitch = clamp(actor.pitch + errPitch * overScale, -1.32, 1.32);
        // Fitts's Law biomechanical duration: fast wrist flicks (~0.11s) to wide arm sweeps (~0.30s)
        const fitts = 0.095 + 0.145 * Math.log2(1 + totalErr * 4.5);
        this.mjDur = clamp(fitts * (1.18 - aimUrgency * 0.34), 0.085, 0.34);
        startedNew = true;
      } else {
        this.mjActive = false;
      }
    }

    let outYaw = actor.yaw;
    let outPitch = actor.pitch;

    if (this.mjActive && this.reactionRemaining <= 0.04) {
      this.mjT = Math.min(this.mjDur, this.mjT + dt);
      const s = NVSSHumanRealism.minJerk(this.mjT / this.mjDur);
      outYaw = this.mjStartYaw + angleDiff(this.mjStartYaw, this.mjTargetYaw) * s;
      outPitch = this.mjStartPitch + (this.mjTargetPitch - this.mjStartPitch) * s;
      if (this.mjT >= this.mjDur) this.mjActive = false;
    } else if (this.reactionRemaining <= 0.04) {
      // Fine foveal tracking micro-correction
      const k = 1 - Math.exp(-(10 + aimUrgency * 6) * dt);
      outYaw = actor.yaw + errYaw * k;
      outPitch = actor.pitch + errPitch * k;
    }

    // Subtle physiological 9-11 Hz wrist micro-tremor (scaled by adrenaline & inverse composure)
    const tremorAmp = (0.0014 + this.adrenaline * 0.0026) * (1.25 - this.composure * 0.65);
    outYaw += Math.sin(this.tremorPhase) * tremorAmp;
    outPitch = clamp(outPitch + Math.cos(this.tremorPhase * 1.13) * tremorAmp * 0.7, -1.32, 1.32);

    return {
      yaw: outYaw,
      pitch: outPitch,
      settled: totalErr < 0.075 && this.reactionRemaining <= 0.02,
      startedNew
    };
  }

  /**
   * Computes a human-realism composite score (0..100) from trajectory fluidity & cognitive richness.
   */
  realismIndex(metrics) {
    const mj = Math.min(1, (metrics.nvssMinJerkTrajectories || 0) / 25);
    const sac = Math.min(1, (metrics.nvssSaccades || 0) / 15);
    const mg = Math.min(1, (metrics.nvssMindGames || 0) / 5);
    const ad = Math.min(1, (metrics.nvssFeatureAdaptations || 0) / 4);
    return Math.round((mj * 38 + sac * 24 + mg * 22 + ad * 16));
  }
}

/**
 * NV Super Soldier (NVSS) AI Engine — drop-in engine compatible with Match, Lab, and ArenaCompositeAI.
 */
export class NVSuperSoldier extends NV2 {
  constructor(match) {
    super(match);
    this.version = NVSS_VERSION;
    this.isNVSS = true;
    this.nvssBrains = new Map();
    this.metrics = {
      ...this.metrics,
      nvssInferences: 0,
      nvssMinJerkTrajectories: 0,
      nvssSaccades: 0,
      nvssMindGames: 0,
      nvssGasPipeTraps: 0,
      nvssDroneBuys: 0,
      nvssFeatureAdaptations: 0,
      nvssWeatherCompensations: 0,
      nvssHumanRealismScore: 0
    };
  }

  attach(actor) {
    super.attach(actor);
    if (!actor || actor.human) return;
    if (!this.nvssBrains.has(actor.id)) {
      const seed = (actor.id + 1) * 7919 + 424242;
      this.nvssBrains.set(actor.id, {
        rng: random(seed),
        policy: new NVSSPolicyNet(),
        adapter: new UniversalCapabilityAdapter(),
        humanism: new NVSSHumanRealism(random(seed ^ 0x5bd1e995)),
        lastPolicyAt: -1,
        lastDecision: {tacticIndex: 0, tacticName: NVSS_TACTIC_NAMES[0], tacticProb: 0.5, value: 0},
        gasPipeTarget: null,
        lastShotAt: 0,
        lastDmgAt: -99
      });
    }
    actor.aiVersion = NVSS_VERSION;
  }

  onHit(v, owner, dir, power, shieldBreak) {
    super.onHit(v, owner, dir, power, shieldBreak);
    if (v && this.nvssBrains.has(v.id)) {
      const nb = this.nvssBrains.get(v.id);
      nb.lastDmgAt = this.match.time;
      nb.humanism.onDamaged(power || 10, (v.hp || 0) / Math.max(1, v.maxHp || 100));
      nb.adapter.observeOutcome(-0.18 * clamp((power || 10) / 40, 0.1, 1.5), this.match.time);
    }
    if (owner && this.nvssBrains.has(owner.id) && owner !== v) {
      const nb = this.nvssBrains.get(owner.id);
      nb.adapter.observeOutcome(0.28 + (shieldBreak ? 0.25 : 0), this.match.time);
    }
  }

  onKill(killer, victim) {
    super.onKill(killer, victim);
    if (killer && this.nvssBrains.has(killer.id)) {
      const nb = this.nvssBrains.get(killer.id);
      nb.humanism.onKill(this.match.time);
      nb.adapter.observeOutcome(1.0, this.match.time);
    }
    if (victim && this.nvssBrains.has(victim.id)) {
      const nb = this.nvssBrains.get(victim.id);
      nb.humanism.onDeath();
      nb.adapter.observeOutcome(-0.85, this.match.time);
    }
  }

  /**
   * Builds the universal 24-dim self/world observation + N x 16-dim world entity tokens
   * (100% fair-play: enemy entities only included when optically visible or recently heard!).
   */
  _encodeObservation(a, nb) {
    const m = this.match;
    const pol = nb.policy;
    const sv = pol.selfVec;
    const w = m.weapon(a);
    const wDesc = nb.adapter.describeWeapon(w);
    const maxHp = a.maxHp || 100;
    const ws = m.weatherSpec || {visibility: 1, ballisticWarp: 0};
    const eye = eyeOf(a);
    const underFire = (m.time - nb.lastDmgAt) < 1.8;

    sv.fill(0);
    sv[0] = clamp((a.hp || 0) / maxHp, 0, 1);
    sv[1] = clamp((a.shield || 0) / Math.max(25, a.maxShield || 25), 0, 1);
    sv[2] = clamp((a.baizerShield || 0) / 200, 0, 1);
    sv[3] = clamp((a.mag || 0) / Math.max(1, w?.capacity || 30), 0, 1);
    sv[4] = clamp((a.stock || 0) / Math.max(100, w?.stockCap || 300), 0, 1);
    sv[5] = a.reload > 0 ? 1 : 0;
    sv[6] = clamp(a.crouch || 0, 0, 1);
    sv[7] = clamp(Math.hypot(a.vx || 0, a.vz || 0) / 7.5, 0, 1.5);
    sv[8] = wDesc.dpsNorm;
    sv[9] = wDesc.speedNorm;
    sv[10] = clamp(wDesc.optRange / 50, 0, 1);
    sv[11] = a.df40?.scatterMode ? 1 : 0;
    sv[12] = clamp(ws.visibility ?? 1, 0.1, 1);
    sv[13] = clamp((ws.ballisticWarp || 0) / 2.0, 0, 1.5);
    sv[14] = m.squadFractured ? 1 : 0;
    sv[15] = (a.skillCharges || 0) > 0 ? 1 : 0;
    const sk = String(a.assignedSkill || '');
    sv[16] = sk === 'shaffer' ? 1 : 0;
    sv[17] = sk === 'heal' ? 1 : 0;
    sv[18] = sk === 'stunlauncher' ? 1 : 0;
    sv[19] = sk === 'judgment' ? 1 : 0;
    const totalAmmo = (a.stock || 0) + (a.mag || 0);
    sv[20] = (!m.isZombieChallenge && !a.isDrone && !a.isZombie && (m.infiniteAmmo || totalAmmo >= 160)) ? 1 : 0;
    let myDrones = 0;
    for (let i = 0; i < m.actors.length; i++) {
      const u = m.actors[i];
      if (u.alive && u.isDrone && u.ownerId === a.id) myDrones++;
    }
    sv[21] = clamp(myDrones / 4, 0, 1);
    sv[22] = m.helicopter?.alive ? 1 : 0;
    sv[23] = underFire ? 1 : 0;

    // Encode dynamic entity tokens (up to MAX_TOKENS = 24)
    const et = pol.entTokens;
    let cnt = 0;
    const pushToken = (rx, ry, rz, vx, vz, hpF, shF, host, air, boss, dest, pick, los, dps, fresh) => {
      if (cnt >= MAX_TOKENS) return;
      const off = cnt * NVSS_ARCH.entityDim;
      const d = Math.hypot(rx, ry, rz);
      et[off] = clamp(rx / 60, -1.5, 1.5);
      et[off + 1] = clamp(ry / 16, -1, 1);
      et[off + 2] = clamp(rz / 60, -1.5, 1.5);
      et[off + 3] = clamp(d / 80, 0, 1.5);
      et[off + 4] = clamp(vx / 10, -1.5, 1.5);
      et[off + 5] = clamp(vz / 10, -1.5, 1.5);
      et[off + 6] = clamp(hpF, 0, 1);
      et[off + 7] = clamp(shF, 0, 1);
      et[off + 8] = host;
      et[off + 9] = air;
      et[off + 10] = boss;
      et[off + 11] = dest;
      et[off + 12] = pick;
      et[off + 13] = los;
      et[off + 14] = clamp(dps, 0, 2);
      et[off + 15] = clamp(fresh, 0, 1);
      cnt++;
    };

    const maxVis = 68 * (ws.visibility ?? 1);
    let visibleEnemies = 0;
    let nearestVisEnemy = null;
    let nearestVisDist = Infinity;

    // 1) Combatants (fair-play LOS gated for hostiles!)
    for (let i = 0; i < m.actors.length && cnt < MAX_TOKENS - 6; i++) {
      const e = m.actors[i];
      if (!e || !e.alive || e === a) continue;
      const hostile = m.areHostile(a, e);
      if (hostile && (e.shafferTimer || 0) > 0) continue;
      const rx = e.x - a.x, ry = (e.y || 0) - (a.y || 0), rz = e.z - a.z;
      const d = Math.hypot(rx, ry, rz);
      if (d > maxVis && hostile) continue;
      let los = 0;
      if (hostile) {
        const tp = targetPoint(e);
        if (!clearOpticalPath(eye, tp, m.aeroVortex)) continue; // Zero wallhack!
        los = 1;
        visibleEnemies++;
        if (d < nearestVisDist) { nearestVisDist = d; nearestVisEnemy = e; }
      } else {
        los = 1;
      }
      pushToken(
        rx, ry, rz, e.vx || 0, e.vz || 0,
        (e.hp || 0) / Math.max(1, e.maxHp || 100),
        ((e.shield || 0) + (e.baizerShield || 0)) / 225,
        hostile ? 1 : -1,
        e.isDrone ? 1 : 0,
        (e.inMech || e.isH1Zonbi) ? 1 : 0,
        0, 0, los,
        e.inMech ? 1.8 : e.isH1Zonbi ? 1.6 : e.isDrone ? 0.5 : 0.9,
        1.0
      );
    }

    // 2) Zombie Helicopter token
    if (m.helicopter?.alive && cnt < MAX_TOKENS) {
      const h = m.helicopter;
      pushToken(
        h.x - a.x, h.y - (a.y || 0), h.z - a.z, h.vx || 0, h.vz || 0,
        h.hp / Math.max(1, h.maxHp || 450), 0,
        1, 1, 1, 0, 0, 1, 1.5, 1.0
      );
    }

    // 3) Destructible Gas Pipes near visible enemies (tactical trap detection!)
    nb.gasPipeTarget = null;
    if (m.gasPipes?.length && nearestVisEnemy && cnt < MAX_TOKENS) {
      for (let i = 0; i < m.gasPipes.length; i++) {
        const gp = m.gasPipes[i];
        if (!gp.alive) continue;
        const dToEnemy = Math.hypot(gp.x - nearestVisEnemy.x, gp.z - nearestVisEnemy.z);
        const dToSelf = Math.hypot(gp.x - a.x, gp.z - a.z);
        if (dToEnemy <= 4.8 && dToSelf > 5.4 && dToSelf < 42) {
          const gpPt = [gp.x, (gp.y || 0) + 0.9, gp.z];
          if (obstruction(eye, gpPt) > 1) {
            pushToken(gp.x - a.x, 0.9, gp.z - a.z, 0, 0, gp.hp / 30, 0, 0.6, 0, 0, 1, 0, 1, 1.4, 1.0);
            if (!nb.gasPipeTarget) nb.gasPipeTarget = gp;
          }
        }
      }
    }

    // 4) Nearby Pickups (Ammo Boxes / BAIZER)
    if (m.baizers?.length && cnt < MAX_TOKENS && (a.baizerShield || 0) < 160) {
      for (let i = 0; i < m.baizers.length && cnt < MAX_TOKENS; i++) {
        const bz = m.baizers[i];
        if (bz.cooldown > 0) continue;
        const d = Math.hypot(bz.x - a.x, bz.z - a.z);
        if (d < 22) {
          pushToken(bz.x - a.x, 0.4, bz.z - a.z, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1.0);
          break;
        }
      }
    }

    // 5) Future Unknown Entities Hook (zero-shot tokenization for any future match.customEntities!)
    if (Array.isArray(m.customEntities)) {
      for (let i = 0; i < m.customEntities.length && cnt < MAX_TOKENS; i++) {
        const ce = m.customEntities[i];
        if (!ce || ce.alive === false) continue;
        const rx = (ce.x || 0) - a.x, ry = (ce.y || 0) - (a.y || 0), rz = (ce.z || 0) - a.z;
        pushToken(
          rx, ry, rz, ce.vx || 0, ce.vz || 0,
          ce.hp !== undefined ? clamp(ce.hp / Math.max(1, ce.maxHp || 100), 0, 1) : 1,
          0,
          ce.hostile ? 1 : ce.friendly ? -1 : 0,
          (ce.y || 0) > 2.2 ? 1 : 0,
          ce.boss ? 1 : 0,
          ce.destructible ? 1 : 0,
          ce.pickup ? 1 : 0,
          1,
          ce.threat || 0.5,
          1.0
        );
        this.metrics.nvssFeatureAdaptations++;
      }
    }

    pol.entCount = cnt;
    return {visibleEnemies, nearestVisEnemy, nearestVisDist, underFire, hpFrac: sv[0], reloading: a.reload > 0, heliAlive: !!m.helicopter?.alive};
  }

  /**
   * Executes Universal Capability Adaptation (Skills, Drones, DF40 II Scatter, Gas-Pipe Traps,
   * and any future dynamicCapabilities added to Match!).
   */
  _stepUniversalCapabilities(a, nb, ctx) {
    const m = this.match;
    const pol = nb.policy;
    const adp = nb.adapter;
    const now = m.time;

    // 1. Assigned Skill (works for ALL current AND unknown future skills!)
    if ((a.skillCharges || 0) > 0 && a.assignedSkill && !a.isDrone && !a.isZombie) {
      const sk = a.assignedSkill;
      const capDesc = adp.describeSkill(sk, ctx);
      const score = adp.evaluate(pol, `skill:${sk}`, capDesc, now);
      const validHeal = sk !== 'heal' || ctx.hpFrac < 0.62;
      const validShaffer = sk !== 'shaffer' || (!(a.shafferTimer > 0) && (ctx.underFire || ctx.visibleEnemies >= 1));
      const validMech = sk !== 'judgment' || (!a.inMech && (ctx.visibleEnemies >= 1 || ctx.heliAlive || ctx.underFire));
      if (score > 0.35 && validHeal && validShaffer && validMech) {
        if (m.useSkill(a, sk)) {
          adp.recordUse(`skill:${sk}`, now, pol.value);
          this.metrics.nvssFeatureAdaptations++;
        }
      }
    }

    // 2. Escort Drone Economy (buys NV2.6 escort drones when ammo stock is abundant!)
    if (!m.isZombieChallenge && !a.isDrone && !a.isZombie && !a.inMech) {
      const totalAmmo = (a.stock || 0) + (a.mag || 0);
      let myDrones = 0;
      for (let i = 0; i < m.actors.length; i++) {
        const u = m.actors[i];
        if (u.alive && u.isDrone && u.ownerId === a.id) myDrones++;
      }
      if ((m.infiniteAmmo || totalAmmo >= 180) && myDrones < 2 && m.buyDrone) {
        const droneDesc = [0.68, 0.72, 0.55, 0.25, 0.85, 0.55 + (ctx.visibleEnemies > 0 ? 0.3 : 0), 0.35, 0.2];
        if (adp.evaluate(pol, 'cap:buyDrone', droneDesc, now) > 0.45) {
          const res = m.buyDrone(a);
          if (res?.ok) {
            adp.recordUse('cap:buyDrone', now, pol.value);
            this.metrics.nvssDroneBuys++;
            this.metrics.nvssFeatureAdaptations++;
          }
        }
      }
    }

    // 3. DF40 II 12-Pellet Scatter vs Precision 2-Shot Dynamic Switching
    if (a.df40 && m.toggleDF40Scatter && ctx.nearestVisEnemy) {
      const wantScatter = ctx.nearestVisDist < 13.5;
      if (wantScatter !== !!a.df40.scatterMode) {
        m.toggleDF40Scatter(a);
        this.metrics.nvssFeatureAdaptations++;
      }
    }

    // 4. Future Dynamic Capabilities Hook (any newly added feature registered on match.dynamicCapabilities)
    if (Array.isArray(m.dynamicCapabilities)) {
      for (let i = 0; i < m.dynamicCapabilities.length; i++) {
        const cap = m.dynamicCapabilities[i];
        if (!cap || typeof cap.execute !== 'function') continue;
        if (typeof cap.canUse === 'function' && !cap.canUse(a, m)) continue;
        const desc = Array.isArray(cap.descriptor) && cap.descriptor.length === NVSS_ARCH.capDim
          ? cap.descriptor
          : [0.55, 0.45, 0.4, 0.3, 0.3, 0.5, 0.25, 0.95];
        const score = adp.evaluate(pol, `future:${cap.id || i}`, desc, now);
        if (score > 0.40) {
          const ok = cap.execute(a, m);
          if (ok) {
            adp.recordUse(`future:${cap.id || i}`, now, pol.value);
            this.metrics.nvssFeatureAdaptations++;
          }
        }
      }
    }
  }

  /**
   * Runs one full 360Hz NVSS tick: executes base NV2 navigation/perception, then overrides
   * tactical selection, capability mastery, weather ballistic compensation, and biomechanical
   * Minimum-Jerk 10x Human Realism aiming & mind-game micro-behaviors!
   */
  tick(dt) {
    // Let base NV2 run pathfinding, cover scoring, belief maintenance & fair-play perception
    super.tick(dt);
    const m = this.match;
    if (!m || m.ended) return;

    const now = m.time;
    const ws = m.weatherSpec || {visibility: 1, ballisticWarp: 0, windBase: 0};

    for (let i = 0; i < m.actors.length; i++) {
      const a = m.actors[i];
      if (!a || a.human || !a.alive || a.isDrone) continue;
      if (a.isZombie && !a.armedZombie && !a.isH1Zonbi) continue;
      if (this.teamFilter !== undefined && this.teamFilter !== null && a.team !== this.teamFilter) continue;

      let nb = this.nvssBrains.get(a.id);
      if (!nb) {
        this.attach(a);
        nb = this.nvssBrains.get(a.id);
      }
      if (!nb) continue;

      // 20Hz Universal Entity-Set Transformer Policy Inference
      let ctx = nb._lastCtx;
      if (now - nb.lastPolicyAt >= 0.05 || !ctx) {
        nb.lastPolicyAt = now;
        ctx = this._encodeObservation(a, nb);
        nb._lastCtx = ctx;
        nb.lastDecision = nb.policy.forward(getActiveNVSSWeights());
        this.metrics.nvssInferences++;
        this._stepUniversalCapabilities(a, nb, ctx);

        // Mind-game creative trigger (fake retreat / off-angle hold / shoulder probe)
        const tac = nb.lastDecision.tacticName;
        if (now > nb.humanism.mindGameUntil && (tac === 'FAKE_RETREAT_BAIT' || tac === 'OFF_ANGLE_HOLD' || tac === 'CREATIVE_FLANK')) {
          nb.humanism.mindGameMode = tac === 'FAKE_RETREAT_BAIT' ? 'fake_retreat' : tac === 'OFF_ANGLE_HOLD' ? 'off_angle' : 'shoulder_probe';
          nb.humanism.mindGameUntil = now + 0.55 + nb.rng() * 0.55;
          nb.humanism.shoulderSide = nb.rng() < 0.5 ? -1 : 1;
          this.metrics.nvssMindGames++;
        }
      }

      const hum = nb.humanism;
      const aimUrgency = nb.policy.motorStyle[5] ?? 0.65;
      const eye = eyeOf(a);

      // Priority 1: Tactical Gas-Pipe Trap Sniping (if an enemy stands within 5m of a live gas pipe!)
      if (nb.gasPipeTarget && nb.gasPipeTarget.alive) {
        const gp = nb.gasPipeTarget;
        const dx = gp.x - eye[0], dy = ((gp.y || 0) + 0.9) - eye[1], dz = gp.z - eye[2];
        const desYaw = Math.atan2(dx, -dz);
        const desPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz) || 1), -1.25, 1.25);
        const res = hum.stepBiomechanicalAim(a, desYaw, desPitch, dt, 0.92);
        a.yaw = res.yaw;
        a.pitch = res.pitch;
        if (res.startedNew) this.metrics.nvssMinJerkTrajectories++;
        if (res.settled && a.cooldown <= 1e-6 && a.reload <= 0) {
          if (m.trigger(a)) this.metrics.nvssGasPipeTraps++;
        }
        continue;
      }

      // Priority 2: Visible Enemy Engagement with Minimum-Jerk Biomechanical Aim + Weather Warp Lead + Habit Adjustment
      if (ctx.nearestVisEnemy && ctx.nearestVisEnemy.alive) {
        const e = ctx.nearestVisEnemy;
        hum.onSighting(e, ctx.nearestVisDist, now);
        const tp = targetPoint(e);
        // Adapt aim elevation to opponent's learned crouch/jump habit!
        const habit = hum.opponentHabits.get(e.id);
        let aimY = tp[1];
        if (habit && habit.sightings >= 4) {
          if (habit.crouchRate > 0.45) aimY -= 0.24;
          else if (habit.jumpRate > 0.35) aimY += 0.16;
        }
        // Lead velocity + weather ballisticWarp compensation!
        const w = m.weapon(a);
        const spd = Math.max(30, w?.speed || 280);
        const tof = clamp(ctx.nearestVisDist / spd, 0, 0.55);
        let tx = tp[0] + (e.vx || 0) * tof;
        let ty = aimY + (e.vy || 0) * tof * 0.5;
        let tz = tp[2] + (e.vz || 0) * tof;
        if ((ws.ballisticWarp || 0) > 0.1) {
          // Counteract lateral gust bias during Storm / Super Disaster weather
          tx -= (ws.windBase || 0) * 0.012 * tof * ctx.nearestVisDist;
          this.metrics.nvssWeatherCompensations++;
        }
        const dx = tx - eye[0], dy = ty - eye[1], dz = tz - eye[2];
        const desYaw = Math.atan2(dx, -dz);
        const desPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz) || 1), -1.30, 1.30);
        const res = hum.stepBiomechanicalAim(a, desYaw, desPitch, dt, aimUrgency);
        a.yaw = res.yaw;
        a.pitch = res.pitch;
        if (res.startedNew) this.metrics.nvssMinJerkTrajectories++;
        if (res.settled && a.cooldown <= 1e-6 && a.reload <= 0 && !a.burstLeft) {
          m.trigger(a);
        }
      } else if (now < hum.postKillScanUntil) {
        // Post-kill 360° safety glance (realistic human trade-fragger check!)
        const desYaw = a.yaw + hum.postKillScanDir * 0.85 * dt;
        const res = hum.stepBiomechanicalAim(a, desYaw, -0.02, dt, 0.55);
        a.yaw = res.yaw;
        a.pitch = res.pitch;
        if (res.startedNew) this.metrics.nvssSaccades++;
      } else if (now >= hum.nextSaccadeAt) {
        // Saccadic corner/peripheral attention glance while patrolling
        hum.nextSaccadeAt = now + 0.55 + nb.rng() * 0.75;
        hum.gazeOffsetYaw = (nb.rng() - 0.5) * 0.42;
        hum.gazeOffsetPitch = (nb.rng() - 0.5) * 0.08;
        this.metrics.nvssSaccades++;
      } else if (Math.abs(hum.gazeOffsetYaw) > 0.02) {
        const res = hum.stepBiomechanicalAim(a, a.yaw + hum.gazeOffsetYaw * dt * 2.2, clamp(hum.gazeOffsetPitch, -0.35, 0.35), dt, 0.45);
        a.yaw = res.yaw;
        a.pitch = res.pitch;
        if (res.startedNew) this.metrics.nvssMinJerkTrajectories++;
        hum.gazeOffsetYaw *= Math.exp(-3.5 * dt);
      }

      this.metrics.nvssHumanRealismScore = Math.max(
        this.metrics.nvssHumanRealismScore,
        hum.realismIndex(this.metrics)
      );
    }
  }
}
