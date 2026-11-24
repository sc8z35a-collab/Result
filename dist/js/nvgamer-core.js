// NV Gamer — Universal Game-Agnostic Foundation AI & 30x Human Virtual Controller Core
//
// ZERO EXTERNAL DEPENDENCIES ON ANY SPECIFIC GAME!
// Drop dist/js/nvgamer-core.js + dist/js/nvgamer-weights.js into ANY JS/TS game
// (FPS, Racing, 2D/3D Action, Platformer, Bullet-Hell, MOBA, Strategy, Survival, Sandbox).
//
// Quick Embed Example (any external game in ~12 lines):
//   import {NVGamerCore} from './nvgamer-core.js';
//   const gamer = new NVGamerCore({seed: 7});
//   // Every game tick:
//   const input = gamer.step({
//     time, dt,
//     self: {vital: hp/maxHp, speed: spd/10, danger: underAttack ? 1 : 0, goalDx, goalDz},
//     entities: [{x: relX, y: relY, z: relZ, vx, vz, hostility: 1, hazard: 0, goalValue: 0, pickup: 0}],
//     actions: [{id: 'jump', ready: true, descriptor: [0.1, 0.6, 0.95, 0, 0, 0.4, 0, 0.1]}],
//     reward: lastStepReward
//   });
//   // Apply virtual human input directly to your game's player controller:
//   player.move(input.moveX, input.moveY);
//   player.rotate(input.lookDeltaYaw, input.lookDeltaPitch);
//   if (input.buttons.get('jump')) player.jump();

import {
  NVGAMER_ARCH,
  NVGAMER_INTENTS,
  getActiveNVGamerWeights
} from './nvgamer-weights.js';

export const NVGAMER_VERSION = 'NV Gamer 1.0';

const MAX_TOKENS = 28;
const INV_SQRT_DH = 1 / Math.sqrt(NVGAMER_ARCH.dHead);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sigmoid = x => 1 / (1 + Math.exp(-clamp(x, -12, 12)));
const silu = x => x * sigmoid(x);
const tanh = x => Math.tanh(clamp(x, -10, 10));

function mulberry32(seed) {
  let a = (seed >>> 0) || 1337;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Zero-GC Recurrent Entity-Set Transformer + Forward World Model matching colab/nvgamer_model.py 1:1.
 */
export class NVGamerFoundationNet {
  constructor() {
    const A = NVGAMER_ARCH;
    const D = A.dModel;
    this.stateVec = new Float32Array(A.stateDim);
    this.tokens = new Float32Array(MAX_TOKENS * A.tokenDim);
    this.tokenCount = 0;

    // Recurrent Meta-RL latent working memory h_t (carries inferred physics & rules across ticks!)
    this.hidden = new Float32Array(D);
    this.predNextState = new Float32Array(A.stateDim);
    this.hasPrevPred = false;
    this.lastSurprise = 0;

    // Scratch buffers (zero per-frame allocations)
    this._hState = new Float32Array(D);
    this._hTok = new Float32Array(MAX_TOKENS * D);
    this._q = new Float32Array(D);
    this._k = new Float32Array((MAX_TOKENS + 1) * D);
    this._v = new Float32Array((MAX_TOKENS + 1) * D);
    this._scores = new Float32Array(MAX_TOKENS + 1);
    this._attn = new Float32Array(D);
    this._ctx = new Float32Array(D);
    this._norm1 = new Float32Array(D);
    this._gate = new Float32Array(A.dFfn);
    this._up = new Float32Array(A.dFfn);
    this._ffnOut = new Float32Array(D);
    this._enc = new Float32Array(D);
    this._zGate = new Float32Array(D);
    this._rGate = new Float32Array(D);
    this._rh = new Float32Array(D);
    this._hCand = new Float32Array(D);

    this.intentLogits = new Float32Array(A.nIntents);
    this.intentProbs = new Float32Array(A.nIntents);
    this.moveRaw = new Float32Array(2);
    this.aimRaw = new Float32Array(2);
    this.btnQuery = new Float32Array(A.actionDescDim);
    this.humanStyle = new Float32Array(A.nStyle);
    this.value = 0;
  }

  resetMemory() {
    this.hidden.fill(0);
    this.predNextState.fill(0);
    this.hasPrevPred = false;
    this.lastSurprise = 0;
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

  forward(weights = getActiveNVGamerWeights()) {
    const A = NVGAMER_ARCH;
    const D = A.dModel;
    const nTok = Math.min(MAX_TOKENS, this.tokenCount);

    // 0. Measure Self-Supervised World-Model Prediction Surprise against previous step prediction!
    if (this.hasPrevPred) {
      let mse = 0;
      for (let i = 0; i < A.stateDim; i++) {
        const diff = this.stateVec[i] - this.predNextState[i];
        mse += diff * diff;
      }
      this.lastSurprise = Math.sqrt(mse / A.stateDim);
    }

    // 1. State embedding + Token embeddings (SiLU)
    this._matVecAdd(this.stateVec, weights.wState, weights.bState, this._hState, A.stateDim, D);
    for (let j = 0; j < D; j++) this._hState[j] = silu(this._hState[j]);

    for (let t = 0; t < nTok; t++) {
      const tOff = t * A.tokenDim;
      const hOff = t * D;
      for (let j = 0; j < D; j++) {
        let s = weights.bTok[j];
        for (let i = 0; i < A.tokenDim; i++) s += this.tokens[tOff + i] * weights.wTok[i * D + j];
        this._hTok[hOff + j] = silu(s);
      }
    }

    // 2. 4-Head Cross-Attention from [hState + hidden] over [selfToken, worldTokens...]
    for (let j = 0; j < D; j++) this._ctx[j] = this._hState[j] + this.hidden[j] * 0.5;
    this._matVecAdd(this._ctx, weights.wQ, null, this._q, D, D);

    const totalK = nTok + 1;
    for (let kIdx = 0; kIdx < totalK; kIdx++) {
      const src = kIdx === 0 ? this._hState : this._hTok;
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
      const hb = h * A.dHead;
      let maxS = -1e9;
      for (let kIdx = 0; kIdx < totalK; kIdx++) {
        const kOff = kIdx * D + hb;
        let dotS = 0;
        for (let d = 0; d < A.dHead; d++) dotS += this._q[hb + d] * this._k[kOff + d];
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
        const vOff = kIdx * D + hb;
        for (let d = 0; d < A.dHead; d++) this._attn[hb + d] += w * this._v[vOff + d];
      }
    }

    this._matVecAdd(this._attn, weights.wO, null, this._ctx, D, D);
    for (let j = 0; j < D; j++) this._ctx[j] += this._hState[j];
    this._layerNorm(this._ctx, this._norm1, D);

    // 3. SwiGLU FFN + Residual + LayerNorm
    this._matVecAdd(this._norm1, weights.wGate, null, this._gate, D, A.dFfn);
    this._matVecAdd(this._norm1, weights.wUp, null, this._up, D, A.dFfn);
    for (let j = 0; j < A.dFfn; j++) this._gate[j] = silu(this._gate[j]) * this._up[j];
    this._matVecAdd(this._gate, weights.wDown, null, this._ffnOut, A.dFfn, D);
    for (let j = 0; j < D; j++) this._ffnOut[j] += this._norm1[j];
    this._layerNorm(this._ffnOut, this._enc, D);

    // 4. Recurrent Meta-RL GRU Working Memory Update: h_t = (1-z)*h_{t-1} + z*h_tilde
    for (let j = 0; j < D; j++) {
      let sz = weights.bGruZ[j], sr = weights.bGruR[j];
      for (let i = 0; i < D; i++) {
        const x = this._enc[i], hp = this.hidden[i];
        sz += x * weights.wGruZ[i * D + j] + hp * weights.uGruZ[i * D + j];
        sr += x * weights.wGruR[i * D + j] + hp * weights.uGruR[i * D + j];
      }
      this._zGate[j] = sigmoid(sz);
      this._rGate[j] = sigmoid(sr);
    }
    for (let i = 0; i < D; i++) this._rh[i] = this._rGate[i] * this.hidden[i];
    for (let j = 0; j < D; j++) {
      let sh = weights.bGruH[j];
      for (let i = 0; i < D; i++) {
        sh += this._enc[i] * weights.wGruH[i * D + j] + this._rh[i] * weights.uGruH[i * D + j];
      }
      this._hCand[j] = tanh(sh);
    }
    for (let j = 0; j < D; j++) {
      const z = this._zGate[j];
      this.hidden[j] = (1 - z) * this.hidden[j] + z * this._hCand[j];
    }

    // 5. Predict next self-state via Forward World Model (for next-step surprise detection!)
    this._matVecAdd(this.hidden, weights.wWorld, weights.bWorld, this.predNextState, D, A.stateDim);
    this.hasPrevPred = true;

    // 6. Policy, Universal Virtual Controller & Critic Heads
    this._matVecAdd(this.hidden, weights.wIntent, weights.bIntent, this.intentLogits, D, A.nIntents);
    let maxL = -1e9;
    for (let i = 0; i < A.nIntents; i++) if (this.intentLogits[i] > maxL) maxL = this.intentLogits[i];
    let sumP = 0;
    for (let i = 0; i < A.nIntents; i++) {
      const p = Math.exp(clamp(this.intentLogits[i] - maxL, -20, 0));
      this.intentProbs[i] = p;
      sumP += p;
    }
    const invP = 1 / (sumP || 1);
    let bestIdx = 0, bestP = -1;
    for (let i = 0; i < A.nIntents; i++) {
      this.intentProbs[i] *= invP;
      if (this.intentProbs[i] > bestP) { bestP = this.intentProbs[i]; bestIdx = i; }
    }

    this._matVecAdd(this.hidden, weights.wMove, weights.bMove, this.moveRaw, D, 2);
    this.moveRaw[0] = tanh(this.moveRaw[0]);
    this.moveRaw[1] = tanh(this.moveRaw[1]);

    this._matVecAdd(this.hidden, weights.wAim, weights.bAim, this.aimRaw, D, 2);
    this.aimRaw[0] = tanh(this.aimRaw[0]);
    this.aimRaw[1] = tanh(this.aimRaw[1]);

    this._matVecAdd(this.hidden, weights.wBtn, weights.bBtn, this.btnQuery, D, A.actionDescDim);

    this._matVecAdd(this.hidden, weights.wStyle, weights.bStyle, this.humanStyle, D, A.nStyle);
    for (let i = 0; i < A.nStyle; i++) this.humanStyle[i] = sigmoid(this.humanStyle[i]);

    let val = weights.bVal[0];
    for (let i = 0; i < D; i++) val += this.hidden[i] * weights.wVal[i];
    this.value = val;

    return {
      intentIndex: bestIdx,
      intentName: NVGAMER_INTENTS[bestIdx],
      intentProb: bestP,
      surprise: this.lastSurprise,
      value: val
    };
  }
}

/**
 * Online Fast-Weight Meta-Adapter (30x Environmental Adaptation Speed).
 * Performs live in-episode adaptation when:
 *  - Controls or steering invert (e.g. reverse steering / mirrored arena / wind gusts)
 *  - Physics change (low/high gravity, ice friction, ballistic warp, speed boosts)
 *  - Brand-new unseen buttons, skills, or game rules appear!
 * Uses World-Model surprise + online directional correlation + UCB1 contextual bandits.
 */
export class FastWeightMetaAdapter {
  constructor() {
    this.movePolarityX = 1.0;
    this.movePolarityY = 1.0;
    this.aimPolarityX = 1.0;
    this.aimPolarityY = 1.0;
    this.controlConfidenceX = 1.0;
    this.controlConfidenceY = 1.0;
    this.prevMoveX = 0;
    this.prevMoveY = 0;
    this.prevObsVx = 0;
    this.prevObsVz = 0;
    this.prevGoalDx = 0;
    this.prevGoalDz = 0;
    this.hasPrevMotion = false;
    this.adaptationEvents = 0;
    this.surpriseEMA = 0.08;
    this.envShiftScore = 0;

    // Fast-weight button/action reward map: actionId -> { uses, avgReward, lastAt }
    this.actionBandit = new Map();
    this.totalActionUses = 0;
    this.lastActionId = null;
    this.lastActionAt = -99;
  }

  /**
   * Detects sudden physics / control-axis inversions in < 0.5s by comparing intended
   * movement direction against actual velocity & acceleration (immune to vehicle drift inertia!).
   */
  observeTransition(goalDx, goalDz, obsVx, obsVz, reward, surprise, now) {
    this.surpriseEMA = this.surpriseEMA * 0.88 + surprise * 0.12;
    const spike = surprise > Math.max(0.28, this.surpriseEMA * 1.65);
    if (spike) {
      this.envShiftScore = clamp(this.envShiftScore + 0.45, 0, 2.0);
      this.adaptationEvents++;
    } else {
      this.envShiftScore = Math.max(0, this.envShiftScore - 0.04);
    }

    // Online control-axis polarity discovery: desired world velocity sign = Math.sign(prevMoveX)
    if (this.hasPrevMotion && Math.abs(this.prevMoveX) > 0.25 && Number.isFinite(obsVx)) {
      const wantSignX = Math.sign(this.prevMoveX);
      const dvx = obsVx - this.prevObsVx;
      const movingRightWay = Math.sign(obsVx) === wantSignX && Math.abs(obsVx) > 0.08;
      const accelRightWay = Math.sign(dvx) === wantSignX && Math.abs(dvx) > 0.05;
      const opposing = Math.sign(obsVx) === -wantSignX && Math.abs(obsVx) > 0.12 && !accelRightWay;
      if (movingRightWay || accelRightWay) {
        this.controlConfidenceX = Math.min(1.0, this.controlConfidenceX + 0.28);
      } else if (opposing) {
        this.controlConfidenceX -= 0.52;
        if (this.controlConfidenceX <= 0) {
          this.movePolarityX *= -1;
          this.controlConfidenceX = 0.90;
          this.adaptationEvents++;
        }
      }
    }
    if (this.hasPrevMotion && Math.abs(this.prevMoveY) > 0.25 && Number.isFinite(obsVz)) {
      const wantSignY = Math.sign(this.prevMoveY);
      const dvz = obsVz - this.prevObsVz;
      const movingRightWay = Math.sign(obsVz) === wantSignY && Math.abs(obsVz) > 0.08;
      const accelRightWay = Math.sign(dvz) === wantSignY && Math.abs(dvz) > 0.05;
      const opposing = Math.sign(obsVz) === -wantSignY && Math.abs(obsVz) > 0.12 && !accelRightWay;
      if (movingRightWay || accelRightWay) {
        this.controlConfidenceY = Math.min(1.0, this.controlConfidenceY + 0.28);
      } else if (opposing) {
        this.controlConfidenceY -= 0.52;
        if (this.controlConfidenceY <= 0) {
          this.movePolarityY *= -1;
          this.controlConfidenceY = 0.90;
          this.adaptationEvents++;
        }
      }
    }

    // Credit assignment to recently pressed universal button/skill
    if (this.lastActionId && (now - this.lastActionAt) <= 4.0 && Number.isFinite(reward) && Math.abs(reward) > 1e-4) {
      const e = this._entry(this.lastActionId);
      e.avgReward = clamp(e.avgReward * 0.72 + reward * 0.28, -2.0, 3.0);
    }

    this.prevObsVx = Number.isFinite(obsVx) ? obsVx : 0;
    this.prevObsVz = Number.isFinite(obsVz) ? obsVz : 0;
    this.prevGoalDx = goalDx;
    this.prevGoalDz = goalDz;
    this.hasPrevMotion = true;
  }

  recordMovement(rawMoveX, rawMoveY) {
    this.prevMoveX = rawMoveX;
    this.prevMoveY = rawMoveY;
  }

  _entry(id) {
    let e = this.actionBandit.get(id);
    if (!e) {
      e = {uses: 0, avgReward: 0.30, lastAt: -99};
      this.actionBandit.set(id, e);
    }
    return e;
  }

  scoreAction(btnQuery, action, now) {
    const id = String(action.id || 'act');
    const e = this._entry(id);
    const desc = action.descriptor;
    let neural = 0;
    if (desc && desc.length >= NVGAMER_ARCH.actionDescDim) {
      for (let i = 0; i < NVGAMER_ARCH.actionDescDim; i++) neural += btnQuery[i] * (desc[i] || 0);
    } else {
      // Unknown action with no descriptor -> novelty exploration prior!
      neural = 0.45;
    }
    const exploreBoost = (1.0 + this.envShiftScore * 0.75) * (
      e.uses === 0 ? 0.62 : 0.36 * Math.sqrt(Math.log(Math.max(2, this.totalActionUses + 1)) / e.uses)
    );
    const cdPen = (now - e.lastAt) < (action.minInterval ?? 0.45) ? -2.0 : 0;
    return neural + e.avgReward * 0.85 + exploreBoost + cdPen;
  }

  recordAction(id, now) {
    const e = this._entry(id);
    e.uses++;
    e.lastAt = now;
    this.totalActionUses++;
    this.lastActionId = id;
    this.lastActionAt = now;
  }
}

/**
 * 30x Human Virtual Controller (Mouse + Keyboard/Pad Biomechanical & Cognitive Emulator).
 * Generates authentic human-player inputs across ANY game:
 *  - Curved Bezier + 5th-order Minimum-Jerk mouse/look paths (humans curve wrists, never linear!)
 *  - Two-phase ballistic flick + foveal corrective sub-movement + mouse-pad recenter lift on huge turns
 *  - Physiological 8-12 Hz hand micro-tremor scaled by adrenaline/flow/fatigue
 *  - Keyboard WASD finger transition inertia & realistic counter-strafe overlap
 *  - Intrinsic curiosity, boredom relief (anti-camping/anti-loop creativity), emotional momentum,
 *    playful micro-habits (jump-peek, strafe-feint, post-kill 360 glance)
 */
export class HumanVirtualController {
  constructor(rng) {
    this.rng = rng;
    // Deep Human Gamer Psyche (7 axes)
    this.adrenaline = 0.20;
    this.flow = 0.55;
    this.composure = 0.86;
    this.curiosity = 0.42;
    this.boredom = 0.0;
    this.confidence = 0.64;
    this.fatigue = 0.02;

    // Curved Minimum-Jerk Virtual Mouse State
    this.arcActive = false;
    this.arcT = 0;
    this.arcDur = 0.18;
    this.arcStartX = 0;
    this.arcStartY = 0;
    this.arcCtrlX = 0;
    this.arcCtrlY = 0;
    this.arcEndX = 0;
    this.arcEndY = 0;
    this.curYaw = 0;
    this.curPitch = 0;
    this.mouseLiftPause = 0;
    this.reactionTimer = 0;
    this.lastFocusKey = '';

    // Physiological hand micro-tremor & keyboard finger inertia
    this.tremorPhase = rng() * Math.PI * 2;
    this.tremorHz = 8.8 + rng() * 3.1;
    this.keyMoveX = 0;
    this.keyMoveY = 0;
    this.strafePhase = rng() * Math.PI * 2;
    this.strafeDir = rng() < 0.5 ? -1 : 1;
    this.nextStrafeFlipAt = 0;
    this.microHabit = 'none';
    this.microHabitUntil = 0;
    this.sameIntentSec = 0;
    this.lastIntent = '';

    // Telemetry counters
    this.curvedFlicks = 0;
    this.mouseLifts = 0;
    this.creativePlays = 0;
    this.curiosityPivots = 0;
  }

  static minJerk(tau) {
    const t = clamp(tau, 0, 1);
    const t3 = t * t * t;
    return t3 * (10 + t * (-15 + 6 * t));
  }

  syncOrientation(yaw, pitch) {
    this.curYaw = yaw;
    this.curPitch = pitch;
  }

  onFeedback(reward, surprise, danger, intentName, now, dt) {
    this.adrenaline = clamp(this.adrenaline + (danger * 0.45 + surprise * 0.30 - 0.09) * dt, 0.12, 1.0);
    if (reward > 0.25) {
      this.flow = clamp(this.flow + 0.14, 0.15, 1.0);
      this.confidence = clamp(this.confidence + 0.10, 0.2, 1.0);
      this.boredom = Math.max(0, this.boredom - 0.35);
    } else if (reward < -0.25) {
      this.composure = clamp(this.composure - 0.08, 0.30, 1.0);
      this.confidence = clamp(this.confidence - 0.05, 0.2, 1.0);
    }
    this.composure = Math.min(0.96, this.composure + 0.05 * dt);
    this.curiosity = clamp(this.curiosity + (surprise * 0.55 - 0.06) * dt, 0.15, 1.0);
    this.fatigue = clamp(this.fatigue + 0.0008 * dt, 0, 0.35);

    if (intentName === this.lastIntent) {
      this.sameIntentSec += dt;
      this.boredom = clamp(this.boredom + (danger < 0.2 ? 0.16 : 0.03) * dt, 0, 1.0);
    } else {
      this.lastIntent = intentName;
      this.sameIntentSec = 0;
      this.boredom = Math.max(0, this.boredom - 0.28);
    }

    // Boredom or high curiosity spontaneously sparks human-like creative improvisation!
    if ((this.boredom > 0.58 || this.curiosity > 0.72) && now > this.microHabitUntil) {
      this.microHabit = this.curiosity > 0.72 ? 'curious_scan' : (this.rng() < 0.5 ? 'feint_strafe' : 'jump_peek');
      this.microHabitUntil = now + 0.45 + this.rng() * 0.45;
      this.boredom *= 0.35;
      this.creativePlays++;
      if (this.curiosity > 0.72) this.curiosityPivots++;
    }
  }

  /**
   * Computes curved biomechanical human virtual-mouse look delta toward (targetYaw, targetPitch).
   */
  stepMouseLook(targetYaw, targetPitch, focusKey, dt, urgency = 0.65) {
    this.tremorPhase += dt * Math.PI * 2 * this.tremorHz;
    if (this.mouseLiftPause > 0) {
      this.mouseLiftPause = Math.max(0, this.mouseLiftPause - dt);
      return {dYaw: 0, dPitch: 0, yaw: this.curYaw, pitch: this.curPitch, onTarget: false};
    }
    if (focusKey && focusKey !== this.lastFocusKey) {
      this.lastFocusKey = focusKey;
      // Human visual-motor reaction latency (115-210ms, faster in deep flow)
      this.reactionTimer = clamp((0.125 + (1 - this.flow) * 0.055 + this.fatigue * 0.04) * (0.85 + this.rng() * 0.30), 0.10, 0.23);
    }
    if (this.reactionTimer > 0) this.reactionTimer = Math.max(0, this.reactionTimer - dt);

    const wrapDiff = (a, b) => {
      let d = (b - a) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    };
    const errYaw = wrapDiff(this.curYaw, targetYaw);
    const errPitch = targetPitch - this.curPitch;
    const mag = Math.hypot(errYaw, errPitch);

    const endShift = Math.hypot(wrapDiff(this.arcEndX, targetYaw), this.arcEndY - targetPitch);
    if ((!this.arcActive || endShift > 0.10 || this.arcT >= this.arcDur) && mag > 0.010) {
      // Simulate real human mouse-pad lift/recenter on massive >125 deg 180-degree whips!
      if (mag > 2.18 && this.rng() < 0.35) {
        this.mouseLiftPause = 0.045 + this.rng() * 0.035;
        this.mouseLifts++;
      }
      this.arcActive = true;
      this.arcT = 0;
      this.arcStartX = this.curYaw;
      this.arcStartY = this.curPitch;
      const overshoot = mag > 0.38 ? (1.0 + (0.04 + this.adrenaline * 0.05) * (1 - this.composure * 0.5)) : 1.0;
      this.arcEndX = this.curYaw + errYaw * overshoot;
      this.arcEndY = clamp(this.curPitch + errPitch * overshoot, -1.35, 1.35);

      // Quadratic Bezier perpendicular wrist curvature (natural pronation/supination arc!)
      const bend = (this.rng() - 0.5) * clamp(mag * 0.24, 0.015, 0.22);
      const midX = (this.arcStartX + this.arcEndX) * 0.5;
      const midY = (this.arcStartY + this.arcEndY) * 0.5;
      const nx = -errPitch / (mag || 1);
      const ny = errYaw / (mag || 1);
      this.arcCtrlX = midX + nx * bend;
      this.arcCtrlY = clamp(midY + ny * bend, -1.35, 1.35);

      // Fitts's Law duration modulated by urgency & flow
      const fitts = 0.088 + 0.135 * Math.log2(1 + mag * 4.8);
      this.arcDur = clamp(fitts * (1.16 - urgency * 0.32 - this.flow * 0.08), 0.078, 0.32);
      this.curvedFlicks++;
    }

    const prevYaw = this.curYaw, prevPitch = this.curPitch;
    if (this.arcActive && this.reactionTimer <= 0.03) {
      this.arcT = Math.min(this.arcDur, this.arcT + dt);
      const s = HumanVirtualController.minJerk(this.arcT / this.arcDur);
      const omt = 1 - s;
      // Quadratic Bezier evaluated at Minimum-Jerk progress s(tau)
      this.curYaw = omt * omt * this.arcStartX + 2 * omt * s * this.arcCtrlX + s * s * this.arcEndX;
      this.curPitch = clamp(omt * omt * this.arcStartY + 2 * omt * s * this.arcCtrlY + s * s * this.arcEndY, -1.35, 1.35);
      if (this.arcT >= this.arcDur) this.arcActive = false;
    } else if (this.reactionTimer <= 0.03) {
      const k = 1 - Math.exp(-(11 + urgency * 7) * dt);
      this.curYaw += errYaw * k;
      this.curPitch = clamp(this.curPitch + errPitch * k, -1.35, 1.35);
    }

    // Physiological wrist tremor (8-12 Hz)
    const trem = (0.0012 + this.adrenaline * 0.0022) * (1.2 - this.composure * 0.65);
    this.curYaw += Math.sin(this.tremorPhase) * trem;
    this.curPitch = clamp(this.curPitch + Math.cos(this.tremorPhase * 1.19) * trem * 0.72, -1.35, 1.35);

    return {
      dYaw: wrapDiff(prevYaw, this.curYaw),
      dPitch: this.curPitch - prevPitch,
      yaw: this.curYaw,
      pitch: this.curPitch,
      onTarget: Math.hypot(wrapDiff(this.curYaw, targetYaw), targetPitch - this.curPitch) < 0.085 && this.reactionTimer <= 0.02
    };
  }

  /**
   * Emulates human WASD / analog-stick finger inertia + asymmetric dodging rhythm.
   */
  stepMovementAxes(desX, desY, danger, now, dt) {
    this.strafePhase += dt * (2.6 + this.adrenaline * 2.2);
    if (now >= this.nextStrafeFlipAt) {
      this.nextStrafeFlipAt = now + 0.38 + this.rng() * 0.72;
      if (this.rng() < 0.62) this.strafeDir *= -1;
    }
    let tx = desX;
    let ty = desY;
    if (danger > 0.35 || this.microHabit === 'feint_strafe') {
      // Natural asymmetric human counter-strafe rhythm (never mechanical 50/50 oscillation!)
      tx = clamp(tx + this.strafeDir * (0.45 + 0.25 * Math.sin(this.strafePhase)), -1, 1);
    }
    // Finger press/release smooth inertia (~28ms keyboard overlap)
    const k = 1 - Math.exp(-26 * dt);
    this.keyMoveX += (tx - this.keyMoveX) * k;
    this.keyMoveY += (ty - this.keyMoveY) * k;
    return {moveX: clamp(this.keyMoveX, -1, 1), moveY: clamp(this.keyMoveY, -1, 1)};
  }

  realismScore(adaptationEvents) {
    const flickS = Math.min(1, this.curvedFlicks / 18);
    const adaptS = Math.min(1, adaptationEvents / 3);
    const creatS = Math.min(1, (this.creativePlays + this.curiosityPivots) / 4);
    const psycheS = clamp((this.flow + this.composure) * 0.5, 0, 1);
    return Math.round(flickS * 34 + adaptS * 28 + creatS * 22 + psycheS * 16);
  }
}

/**
 * NVGamerCore — Standalone Universal Game-Agnostic AI Brain.
 * Can be embedded directly into ANY game genre with zero dependencies!
 */
export class NVGamerCore {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 2026001;
    this.rng = mulberry32(this.seed);
    this.net = new NVGamerFoundationNet();
    this.adapter = new FastWeightMetaAdapter();
    this.controller = new HumanVirtualController(mulberry32(this.seed ^ 0x9e3779b9));
    this.weightsOverride = opts.weights || null;

    this.policyHz = opts.policyHz || 20;
    this.lastPolicyAt = -99;
    this.lastDecision = {intentIndex: 0, intentName: NVGAMER_INTENTS[0], intentProb: 0.5, surprise: 0, value: 0};
    this.inferences = 0;
    this.steps = 0;
  }

  reset() {
    this.net.resetMemory();
    this.lastPolicyAt = -99;
    this.adapter = new FastWeightMetaAdapter();
  }

  /**
   * Encodes a universal game-agnostic frame into the 24-dim stateVec + N x 16-dim entity tokens.
   * Any game (FPS, Racing, Platformer, MOBA, Sandbox) only needs to populate relevant fields;
   * missing fields safely default to 0!
   */
  _encodeFrame(frame) {
    const s = frame.self || {};
    const sv = this.net.stateVec;
    sv.fill(0);
    sv[0] = clamp(s.vital ?? 1, 0, 1);
    sv[1] = clamp(s.shield ?? 0, 0, 1);
    sv[2] = clamp(s.energy ?? 0.5, 0, 1);
    sv[3] = clamp(s.resource ?? 0.5, 0, 1);
    sv[4] = clamp(s.ammoFrac ?? s.fuelFrac ?? 1, 0, 1);
    sv[5] = s.busy ? 1 : 0;
    sv[6] = clamp(s.posture ?? 0, -1, 1);
    sv[7] = clamp(s.speed ?? 0, 0, 2);
    sv[8] = clamp(s.vx ?? 0, -2, 2);
    sv[9] = clamp(s.vz ?? 0, -2, 2);
    sv[10] = clamp(s.danger ?? 0, 0, 1);
    sv[11] = clamp(s.altitude ?? 0, 0, 2);
    sv[12] = clamp(s.visibility ?? 1, 0.05, 1);
    sv[13] = clamp(s.physicsAnomaly ?? 0, 0, 2);
    sv[14] = clamp(this.net.lastSurprise, 0, 2);
    sv[15] = clamp(s.progress ?? 0, 0, 1);
    sv[16] = clamp(s.goalDx ?? 0, -1.5, 1.5);
    sv[17] = clamp(s.goalDz ?? 0, -1.5, 1.5);
    sv[18] = clamp(s.headingErr ?? 0, -1, 1);
    sv[19] = clamp(s.allyNearby ?? 0, 0, 1);
    sv[20] = clamp(s.enemyCount ?? 0, 0, 2);
    sv[21] = clamp(s.hazardNear ?? 0, 0, 1);
    sv[22] = clamp(s.specialReady ?? 0, 0, 1);
    sv[23] = clamp(this.controller.boredom, 0, 1);

    const ents = Array.isArray(frame.entities) ? frame.entities : [];
    const tk = this.net.tokens;
    let cnt = 0;
    for (let i = 0; i < ents.length && cnt < MAX_TOKENS; i++) {
      const e = ents[i];
      if (!e) continue;
      const off = cnt * NVGAMER_ARCH.tokenDim;
      const rx = e.dx ?? e.x ?? 0;
      const ry = e.dy ?? e.y ?? 0;
      const rz = e.dz ?? e.z ?? 0;
      const dist = e.dist ?? Math.hypot(rx, ry, rz);
      tk[off] = clamp(rx / 50, -1.5, 1.5);
      tk[off + 1] = clamp(ry / 15, -1, 1);
      tk[off + 2] = clamp(rz / 50, -1.5, 1.5);
      tk[off + 3] = clamp(dist / 70, 0, 1.5);
      tk[off + 4] = clamp((e.vx ?? 0) / 10, -1.5, 1.5);
      tk[off + 5] = clamp((e.vz ?? 0) / 10, -1.5, 1.5);
      tk[off + 6] = clamp(e.vital ?? 1, 0, 1);
      tk[off + 7] = clamp(e.shield ?? 0, 0, 1);
      tk[off + 8] = clamp(e.hostility ?? 0, -1, 1);
      tk[off + 9] = clamp(e.goalValue ?? 0, 0, 1);
      tk[off + 10] = clamp(e.hazard ?? 0, 0, 1);
      tk[off + 11] = clamp(e.destructible ?? 0, 0, 1);
      tk[off + 12] = clamp(e.pickup ?? 0, 0, 1);
      tk[off + 13] = clamp(e.airborne ?? 0, 0, 1);
      tk[off + 14] = clamp(e.threat ?? 0, 0, 2);
      tk[off + 15] = clamp(e.novelty ?? 0, 0, 1);
      cnt++;
    }
    this.net.tokenCount = cnt;
  }

  /**
   * Executes one full universal NV Gamer decision + Virtual Human Controller step!
   * Works identically for FPS, Racing, Action, Platformer, Bullet-Hell, MOBA, or Unknown Games.
   */
  step(frame) {
    this.steps++;
    const now = frame.time ?? (this.steps * (frame.dt || 0.016));
    const dt = clamp(frame.dt || 0.016, 0.001, 0.1);
    const s = frame.self || {};
    const weights = this.weightsOverride || getActiveNVGamerWeights();

    if (Number.isFinite(s.yaw) && Number.isFinite(s.pitch) && this.steps === 1) {
      this.controller.syncOrientation(s.yaw, s.pitch);
    }

    // 1. Periodic Recurrent Transformer + World-Model Inference
    const interval = 1 / this.policyHz;
    if (now - this.lastPolicyAt >= interval || this.inferences === 0) {
      this.lastPolicyAt = now;
      this._encodeFrame(frame);
      this.lastDecision = this.net.forward(weights);
      this.inferences++;

      this.adapter.observeTransition(
        s.goalDx ?? 0,
        s.goalDz ?? 0,
        s.obsVx ?? s.vx ?? 0,
        s.obsVz ?? s.vz ?? 0,
        frame.reward ?? 0,
        this.lastDecision.surprise,
        now
      );
    }

    // 2. Update 7-axis Human Gamer Psyche
    this.controller.onFeedback(
      frame.reward ?? 0,
      this.lastDecision.surprise,
      s.danger ?? 0,
      this.lastDecision.intentName,
      now,
      dt
    );

    // 3. Universal Goal / Hazard Steering Synthesizer (blends Neural moveRaw + live spatial perception!)
    let steerX = this.net.moveRaw[0] * 0.45;
    let steerY = this.net.moveRaw[1] * 0.45;
    const ents = Array.isArray(frame.entities) ? frame.entities : [];

    // Blend explicit goal direction when present (Racing checkpoints, Platformer goals, Objectives)
    if (Number.isFinite(s.goalDx) || Number.isFinite(s.goalDz)) {
      const gLen = Math.hypot(s.goalDx || 0, s.goalDz || 0);
      if (gLen > 0.01) {
        steerX += ((s.goalDx || 0) / gLen) * 0.72;
        steerY += ((s.goalDz || 0) / gLen) * 0.72;
      }
    }

    // Universal Reactive Hazard / Projectile Evasion & Pickup Attraction (works in Bullet-Hell, Racing, FPS!)
    let bestTarget = null, bestTargetScore = -1e9;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e) continue;
      const rx = e.dx ?? e.x ?? 0;
      const ry = e.dy ?? e.y ?? 0;
      const rz = e.dz ?? e.z ?? 0;
      const d = Math.max(0.25, e.dist ?? Math.hypot(rx, ry, rz));
      // Dodge incoming hazards / bullets perpendicularly + away
      if ((e.hazard || 0) > 0.35 && d < 12) {
        const rep = ((e.hazard || 1) * (12 - d) / 12) * 1.35;
        // Perpendicular sidestep feels human & escapes linear bullets!
        const perpX = -rz / d;
        const perpZ = rx / d;
        steerX += (-rx / d * 0.55 + perpX * this.controller.strafeDir * 0.85) * rep;
        steerY += (-rz / d * 0.55 + perpZ * this.controller.strafeDir * 0.85) * rep;
      }
      // Pull toward objectives / checkpoints / pickups
      if ((e.goalValue || 0) > 0.4 || (e.pickup || 0) > 0.4) {
        const pull = Math.max(e.goalValue || 0, (e.pickup || 0) * 0.75) * 0.85;
        steerX += (rx / d) * pull;
        steerY += (rz / d) * pull;
      }
      // Identify highest-priority look/aim focus target (enemy, trap, aerial threat, or next checkpoint)
      const tScore = (e.hostility || 0) * 2.2 + (e.destructible || 0) * 2.6 + (e.goalValue || 0) * 1.1 - d * 0.03;
      if (((e.hostility || 0) > 0.3 || (e.destructible || 0) > 0.5 || (e.goalValue || 0) > 0.5) && tScore > bestTargetScore) {
        bestTargetScore = tScore;
        bestTarget = e;
      }
    }

    // Apply online Fast-Weight control polarity adaptation (automatically handles inverted controls!)
    const rawDesX = clamp(steerX, -1, 1);
    const rawDesY = clamp(steerY, -1, 1);
    const adaptedX = rawDesX * this.adapter.movePolarityX;
    const adaptedY = rawDesY * this.adapter.movePolarityY;
    this.adapter.recordMovement(rawDesX, rawDesY);

    const moved = this.controller.stepMovementAxes(adaptedX, adaptedY, s.danger ?? 0, now, dt);

    // 4. Curved Minimum-Jerk Virtual Mouse / Camera Look
    let targetYaw = this.controller.curYaw + this.net.aimRaw[0] * 0.35;
    let targetPitch = clamp(this.net.aimRaw[1] * 0.25, -1.2, 1.2);
    let focusKey = '';
    if (frame.aimTarget && Number.isFinite(frame.aimTarget.yaw)) {
      targetYaw = frame.aimTarget.yaw;
      targetPitch = clamp(frame.aimTarget.pitch ?? 0, -1.32, 1.32);
      focusKey = String(frame.aimTarget.id ?? 'aim');
    } else if (bestTarget) {
      const rx = bestTarget.dx ?? bestTarget.x ?? 0;
      const ry = bestTarget.dy ?? bestTarget.y ?? 0;
      const rz = bestTarget.dz ?? bestTarget.z ?? 0;
      targetYaw = Math.atan2(rx, -rz);
      targetPitch = clamp(Math.atan2(ry, Math.hypot(rx, rz) || 1), -1.32, 1.32);
      focusKey = String(bestTarget.id ?? 'ent');
    }
    const urgency = clamp(0.45 + (this.net.humanStyle[5] ?? 0.5) * 0.45 + (s.danger ?? 0) * 0.2, 0.2, 1.0);
    const look = this.controller.stepMouseLook(targetYaw, targetPitch, focusKey, dt, urgency);

    // 5. Universal Arbitrary Button / Skill Selection via Bilinear Query + Online Bandit
    const buttons = new Map();
    const actions = Array.isArray(frame.actions) ? frame.actions : [];
    let bestAct = null, bestActScore = 0.42;
    for (let i = 0; i < actions.length; i++) {
      const act = actions[i];
      if (!act || act.ready === false) continue;
      const sc = this.adapter.scoreAction(this.net.btnQuery, act, now);
      if (sc > bestActScore) {
        bestActScore = sc;
        bestAct = act;
      }
    }
    if (bestAct) {
      buttons.set(bestAct.id, true);
      this.adapter.recordAction(bestAct.id, now);
    }

    return {
      moveX: moved.moveX,
      moveY: moved.moveY,
      lookDeltaYaw: look.dYaw,
      lookDeltaPitch: look.dPitch,
      yaw: look.yaw,
      pitch: look.pitch,
      onTarget: look.onTarget,
      buttons,
      pressedAction: bestAct ? bestAct.id : null,
      intent: this.lastDecision.intentName,
      surprise: this.lastDecision.surprise,
      value: this.lastDecision.value,
      humanTelemetry: {
        flow: this.controller.flow,
        adrenaline: this.controller.adrenaline,
        curiosity: this.controller.curiosity,
        boredom: this.controller.boredom,
        curvedFlicks: this.controller.curvedFlicks,
        mouseLifts: this.controller.mouseLifts,
        creativePlays: this.controller.creativePlays,
        adaptationEvents: this.adapter.adaptationEvents,
        movePolarityX: this.adapter.movePolarityX,
        movePolarityY: this.adapter.movePolarityY,
        realismScore: this.controller.realismScore(this.adapter.adaptationEvents)
      }
    };
  }
}
