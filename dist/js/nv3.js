// ============================================================================
// NV 3 — Sentient Human Neural NPC (360Hz Fair-Play Browser Runtime)
// ============================================================================
// Zero-dependency Float32Array browser runtime bit-exact to `NV3BrowserCore`
// (`training/nv3_omega_studio/model_nv3.py` & `env_omega_gpu.py`):
//   - 100% Fair-Play 112-dim Ego + 12x16 Entity Observation (ZERO wallhack, ZERO Shaffer leak)
//   - 4-Head Masked Entity Cross-Attention + GRUCell(256) + 7 Embodied Policy Heads + 8-D Emotion Appraisal
//   - Live 8-D Emotions (Composure, Fear, Courage, Focus, Frustration, Trust, Curiosity, Relief)
//   - Live 4-D Somatic State (Heart Rate BPM, Fatigue, Self-Vulnerability, Ego Confidence)
//   - 16-D Callsign Personality DNA (NAGI / KAI / RIN / SORA / AO / HARU / MIKO)
//   - 360Hz Zero-GC 16-Bone `actor.expr` Kinematics (Head-Look, 5 IK Gestures, Breath Wave)
//   - Physical Klatt Vocal DSP `npcSignal` Radio & Overheard Emotional Shouts
//   - Row-wise Int8 (q8) & Float32 (f32) weight loader (`result.nv3.weights.v1` + `./assets/nv3-weights.json`)
// ============================================================================

import {clamp, mix, angleDiff, random} from './geometry.js';
import {
  FIELD, walkable, obstruction, raycastMaterial, clearOpticalPath, moveActor, floorAt
} from './yard.js';
import {eyeOf, targetPoint, postureStep, vertical} from './posture.js';
import {FORCE_GESTURES, VOICE_PROFILES_V26} from './nv26-force.js';
import {NV3_BUNDLED_WEIGHTS} from './nv3-weights.js';

export const NV3_VERSION = 'NV 3';
export const NV3_SCHEMA = 1;
export const NV3_EGO_DIM = 112;
export const NV3_NUM_ENTITIES = 12;
export const NV3_ENTITY_DIM = 16;
export const NV3_STORAGE_KEY = 'result.nv3.weights.v1';

// Exact canonical constants mirroring training/nv3_omega_studio/spec.py & env_omega_gpu.py
const POLICY_DT = 1 / 20;
const WALK_SPEED = 4.68;
const SPRINT_SPEED = 5.85;
const CROUCH_SPEED_LOSS = 0.46;
const JUMP_VY = 5.35;
const MAX_FREE_YAW_RATE = 6.2;
const MAX_TRACK_YAW_RATE = 9.5;
const MAX_TRACK_PITCH_RATE = 6.8;
const VIS_RESIDUAL_YAW = 0.14;
const VIS_RESIDUAL_PITCH = 0.11;
const MEM_RESIDUAL_YAW = 0.25;
const MEM_RESIDUAL_PITCH = 0.12;
const MAX_PITCH = 1.15;

const MAX_VISION_RANGE = 92.0;
const NORMAL_FOV_HALF = 1.26;
const TRACK_FOV_HALF = 1.65;
const PROXIMITY_SENSE_RANGE = 5.5;
const MAX_ACOUSTIC_RANGE = 48.0;
const MEMORY_TTL = 6.0;
const ACOUSTIC_TTL = 4.5;
const INCOMING_RANGE = 24.0;
const INCOMING_MIN_AGE = 0.03;
const LIDAR_MAX_DIST = 25.0;

const DEG2RAD = Math.PI / 180;
const LIDAR_CHEST_RAD = Array.from({length: 16}, (_, i) => i * 22.5 * DEG2RAD);
const LIDAR_LOW_RAD = [0, 30, -30, 60, -60, 120, -120, 180].map(d => d * DEG2RAD);
const LIDAR_MAT_RAD = [0, 20, -20, 40].map(d => d * DEG2RAD);

const SECTOR_CENTERS = [
  [-11.0, 56.0], [11.0, 56.0],
  [-11.0, 0.0],  [11.0, 0.0],
  [-11.0, -56.0],[11.0, -56.0]
];
const SECTOR_NAMES_JA = ['南西レーン', '南東レーン', '中央西', '中央東', '北西レーン', '北東レーン'];

export const NV3_EMOTION_NAMES = Object.freeze([
  'composure', 'fear_dread', 'courage_resolve', 'focus_flow',
  'frustration_tilt', 'trust_bond', 'curiosity_suspicion', 'relief_triumph'
]);

export const NV3_INTENT_LABELS = Object.freeze([
  '正面交戦', '遮蔽ピーク', '側面展開', '戦術退避',
  '仲間援護', 'ベイト罠', '目標確保', '深呼吸リセット'
]);

export const NV3_CALLSIGN_DNA = Object.freeze({
  NAGI: [0.35, 0.55, 0.78, 0.15, 0.68, 0.62, 0.80, 0.45, 0.85, 0.82, 0.72, 0.70, 0.10, 0.65, 0.45, 0.55],
  KAI:  [0.82, -0.15, 0.72, 0.75, -0.10, 0.58, 0.25, 0.72, 0.60, 0.35, 0.20, 0.55, 0.68, 0.30, 0.82, 0.75],
  RIN:  [0.20, 0.65, 0.48, 0.10, 0.85, 0.75, 0.65, 0.90, 0.70, 0.88, 0.82, 0.88, 0.15, 0.92, 0.25, 0.82],
  SORA: [0.45, 0.72, 0.85, -0.10, 0.78, 0.45, 0.92, 0.25, 0.90, 0.85, 0.90, 0.65, -0.25, 0.55, 0.55, 0.35],
  AO:   [0.90, -0.35, 0.40, 0.88, -0.35, 0.65, -0.15, 0.60, 0.55, 0.20, 0.10, 0.50, 0.85, 0.40, 0.75, 0.88],
  HARU: [0.55, 0.25, 0.80, 0.42, 0.40, 0.70, 0.55, 0.60, 0.68, 0.60, 0.55, 0.72, 0.35, 0.50, 0.65, 0.60],
  MIKO: [0.40, 0.45, 0.65, 0.30, 0.58, 0.82, 0.60, 0.80, 0.62, 0.74, 0.65, 0.80, 0.28, 0.75, 0.50, 0.78]
});

const NV3_CALLOUT_LINES = Object.freeze({
  SWING_NOW:      ['息を合わせろ…今だ、一緒に飛び出すぞ！', 'チャンスだ！3・2・1で同時スイング！', 'クロス組めた、一気に出よう！'],
  BAIT_READY:     ['ここで待って引きつける…横から頼んだぞ。', '負傷したフリで誘う、角で構えててくれ。', '足音近いな…罠張って迎え撃つ。'],
  CONTACT:        ['視界に敵を捉えた、交戦する！', '敵発見！射線に注意しろ！', 'ターゲット視認、撃ち合いに入る！'],
  TRADE_REQUEST:  ['まずい、削られた…カバー頼む！', '弾切れかけだ、数秒だけ押さえてくれ！', 'ピンチだ！横からトレード頼む！'],
  BREATH_RESET:   ['ふぅ……よし、落ち着け。まだいける。', '一度呼吸を整える……視野を広げろ。', '焦るな……心拍を落とせ、次は外さない。'],
  STARTLE:        ['っ、くそっ、死角からか！', 'わっ、側面を取られた！体勢戻す！'],
  SHIELD_BREAK:   ['シールド割った！今なら押し切れる！', 'アーマー砕いた、逃がすな！'],
  MAN_DOWN:       ['くっ…やられた！敵はその近くにいる！', 'すまない、落ちた…仇を取ってくれ！'],
  ENEMY_SHOUT: {
    SWING_NOW: ['行くぞ！', '一気に詰める！'],
    BAIT_READY: ['…来い。', 'そこか…'],
    CONTACT: ['いたぞ！', '見つけた！'],
    TRADE_REQUEST: ['カバーしろ！', 'くっ、下がる！'],
    BREATH_RESET: ['ふぅ…', '落ち着け…'],
    STARTLE: ['っ！？', 'チッ！'],
    SHIELD_BREAK: ['割った！', '押せ！'],
    MAN_DOWN: ['ぐっ…！', 'くそっ…！']
  }
});

const REQUIRED_TENSORS = [
  'ego_fc.weight', 'ego_fc.bias', 'ego_ln.weight', 'ego_ln.bias',
  'ent_fc.weight', 'ent_fc.bias', 'ent_ln.weight', 'ent_ln.bias',
  'attn_q.weight', 'attn_q.bias', 'attn_k.weight', 'attn_k.bias',
  'attn_v.weight', 'attn_v.bias', 'attn_o.weight', 'attn_o.bias',
  'fuse_fc.weight', 'fuse_fc.bias', 'fuse_ln.weight', 'fuse_ln.bias',
  'gru.weight_ih', 'gru.weight_hh', 'gru.bias_ih', 'gru.bias_hh',
  'head_intent.weight', 'head_intent.bias',
  'head_social.weight', 'head_social.bias',
  'head_aim.weight', 'head_aim.bias',
  'head_move.weight', 'head_move.bias',
  'head_aim_res.weight', 'head_aim_res.bias',
  'head_bin.weight', 'head_bin.bias',
  'head_util.weight', 'head_util.bias',
  'head_emotion.weight', 'head_emotion.bias',
  'aux_danger.weight', 'aux_danger.bias'
];

const sigmoid = x => 1 / (1 + Math.exp(-clamp(x, -16, 16)));
const silu = x => x / (1 + Math.exp(-clamp(x, -16, 16)));
const nonlinTurn = u => Math.sign(u) * (0.25 * Math.abs(u) + 0.75 * u * u);

function base64ToBytes(b64) {
  if (typeof b64 !== 'string' || !b64.length) throw new Error('NV 3 tensor missing base64 data');
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeTensor(spec, expectedShape) {
  if (!spec || typeof spec !== 'object') throw new Error('Invalid NV 3 tensor entry');
  const shape = spec.shape;
  if (!Array.isArray(shape) || shape.length !== expectedShape.length) {
    throw new Error(`NV 3 tensor shape mismatch: ${JSON.stringify(shape)} vs ${JSON.stringify(expectedShape)}`);
  }
  let size = 1;
  for (let i = 0; i < expectedShape.length; i++) {
    if (shape[i] !== expectedShape[i]) {
      throw new Error(`NV 3 tensor dim ${i} mismatch: ${shape[i]} vs ${expectedShape[i]}`);
    }
    size *= expectedShape[i];
  }
  if (spec.dtype === 'f32') {
    const bytes = base64ToBytes(spec.data);
    if (bytes.byteLength !== size * 4) throw new Error(`NV 3 f32 byteLength mismatch`);
    const arr = new Float32Array(bytes.slice().buffer);
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) throw new Error('Non-finite float in NV 3 weights');
    }
    return arr;
  }
  if (spec.dtype === 'q8') {
    if (expectedShape.length !== 2) throw new Error('NV 3 q8 only valid for 2D matrices');
    const [rows, cols] = expectedShape;
    const qBytes = base64ToBytes(spec.data);
    const sBytes = base64ToBytes(spec.scales);
    if (qBytes.byteLength !== rows * cols || sBytes.byteLength !== rows * 4) {
      throw new Error('NV 3 q8 buffer size mismatch');
    }
    const q = new Int8Array(qBytes.buffer, qBytes.byteOffset, qBytes.byteLength);
    const scales = new Float32Array(sBytes.slice().buffer);
    const out = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      const sc = scales[r];
      if (!Number.isFinite(sc)) throw new Error('Non-finite scale in NV 3 q8 weights');
      const off = r * cols;
      for (let c = 0; c < cols; c++) out[off + c] = q[off + c] * sc;
    }
    return out;
  }
  throw new Error(`Unsupported NV 3 tensor dtype: ${spec.dtype}`);
}

export function validateNV3Bundle(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    return {ok: false, error: '重みデータがオブジェクトではありません'};
  }
  if (bundle.version !== NV3_VERSION && bundle.version !== 'NV3') {
    return {ok: false, error: `バージョン不一致 (${bundle.version} !== ${NV3_VERSION})`};
  }
  if (bundle.schema !== NV3_SCHEMA) {
    return {ok: false, error: `スキーマ不一致 (${bundle.schema} !== ${NV3_SCHEMA})`};
  }
  if (Number(bundle.egoObsDim) !== NV3_EGO_DIM || Number(bundle.numEntities) !== NV3_NUM_ENTITIES || Number(bundle.entityDim) !== NV3_ENTITY_DIM) {
    return {ok: false, error: 'NV 3 観測テンソル次元が一致しません'};
  }
  if (!bundle.tensors || typeof bundle.tensors !== 'object') {
    return {ok: false, error: 'tensors フィールドがありません'};
  }
  for (const name of REQUIRED_TENSORS) {
    if (!bundle.tensors[name]) return {ok: false, error: `必須テンソル欠損: ${name}`};
  }
  try {
    const net = new NV3PolicyNet(bundle);
    return {ok: true, net};
  } catch (err) {
    return {ok: false, error: err?.message || String(err)};
  }
}

function matvecAdd(W, b, x, out, rows, cols) {
  for (let r = 0; r < rows; r++) {
    let s = b[r];
    const off = r * cols;
    for (let c = 0; c < cols; c++) s += W[off + c] * x[c];
    out[r] = s;
  }
}

function layerNormSiLU(x, g, b, out, n) {
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - mean;
    v += d * d;
  }
  const inv = 1 / Math.sqrt(v / n + 1e-5);
  for (let i = 0; i < n; i++) {
    const y = (x[i] - mean) * inv * g[i] + b[i];
    out[i] = silu(y);
  }
}

// ============================================================================
// NV3PolicyNet — Bit-Exact Zero-GC Mirror of PyTorch `NV3BrowserCore`
// ============================================================================
export class NV3PolicyNet {
  constructor(bundle) {
    this.egoObsDim = Number(bundle.egoObsDim);
    this.numEntities = Number(bundle.numEntities);
    this.entityDim = Number(bundle.entityDim);
    this.egoDim = Number(bundle.egoDim);
    this.entDim = Number(bundle.entDim);
    this.gruDim = Number(bundle.gruDim);
    this.nHeads = Number(bundle.nHeads);
    this.dHead = Math.floor(this.entDim / this.nHeads);
    this.meta = {...(bundle.meta || {})};

    const E = this.egoDim;
    const U = this.entDim;
    const H = this.gruDim;
    const T = bundle.tensors;

    this.egoW = decodeTensor(T['ego_fc.weight'], [E, this.egoObsDim]);
    this.egoB = decodeTensor(T['ego_fc.bias'], [E]);
    this.egoLnG = decodeTensor(T['ego_ln.weight'], [E]);
    this.egoLnB = decodeTensor(T['ego_ln.bias'], [E]);

    this.entW = decodeTensor(T['ent_fc.weight'], [U, this.entityDim]);
    this.entB = decodeTensor(T['ent_fc.bias'], [U]);
    this.entLnG = decodeTensor(T['ent_ln.weight'], [U]);
    this.entLnB = decodeTensor(T['ent_ln.bias'], [U]);

    this.qW = decodeTensor(T['attn_q.weight'], [U, E]);
    this.qB = decodeTensor(T['attn_q.bias'], [U]);
    this.kW = decodeTensor(T['attn_k.weight'], [U, U]);
    this.kB = decodeTensor(T['attn_k.bias'], [U]);
    this.vW = decodeTensor(T['attn_v.weight'], [U, U]);
    this.vB = decodeTensor(T['attn_v.bias'], [U]);
    this.oW = decodeTensor(T['attn_o.weight'], [U, U]);
    this.oB = decodeTensor(T['attn_o.bias'], [U]);

    this.fuseW = decodeTensor(T['fuse_fc.weight'], [H, E + U]);
    this.fuseB = decodeTensor(T['fuse_fc.bias'], [H]);
    this.fuseLnG = decodeTensor(T['fuse_ln.weight'], [H]);
    this.fuseLnB = decodeTensor(T['fuse_ln.bias'], [H]);

    this.gruWih = decodeTensor(T['gru.weight_ih'], [3 * H, H]);
    this.gruWhh = decodeTensor(T['gru.weight_hh'], [3 * H, H]);
    this.gruBih = decodeTensor(T['gru.bias_ih'], [3 * H]);
    this.gruBhh = decodeTensor(T['gru.bias_hh'], [3 * H]);

    this.intentW = decodeTensor(T['head_intent.weight'], [8, H]);
    this.intentB = decodeTensor(T['head_intent.bias'], [8]);
    this.socialW = decodeTensor(T['head_social.weight'], [6, H]);
    this.socialB = decodeTensor(T['head_social.bias'], [6]);
    this.aimW = decodeTensor(T['head_aim.weight'], [9, H]);
    this.aimB = decodeTensor(T['head_aim.bias'], [9]);
    this.moveW = decodeTensor(T['head_move.weight'], [3, H]);
    this.moveB = decodeTensor(T['head_move.bias'], [3]);
    this.aimResW = decodeTensor(T['head_aim_res.weight'], [2, H]);
    this.aimResB = decodeTensor(T['head_aim_res.bias'], [2]);
    this.binW = decodeTensor(T['head_bin.weight'], [5, H]);
    this.binB = decodeTensor(T['head_bin.bias'], [5]);
    this.utilW = decodeTensor(T['head_util.weight'], [3, H]);
    this.utilB = decodeTensor(T['head_util.bias'], [3]);
    this.emoW = decodeTensor(T['head_emotion.weight'], [8, H]);
    this.emoB = decodeTensor(T['head_emotion.bias'], [8]);
    this.dangerW = decodeTensor(T['aux_danger.weight'], [2, H]);
    this.dangerB = decodeTensor(T['aux_danger.bias'], [2]);

    this.paramCount = Number(this.meta.paramCount) || Object.values(T).reduce((acc, t) => {
      let n = 1;
      for (const d of t.shape) n *= d;
      return acc + n;
    }, 0);

    // Zero-GC scratch buffers
    this._eRaw = new Float32Array(E);
    this._e = new Float32Array(E);
    this._uTmp = new Float32Array(U);
    this._u = new Float32Array(this.numEntities * U);
    this._q = new Float32Array(U);
    this._k = new Float32Array(this.numEntities * U);
    this._v = new Float32Array(this.numEntities * U);
    this._scores = new Float32Array(this.numEntities);
    this._ctxPre = new Float32Array(U);
    this._ctx = new Float32Array(U);
    this._cat = new Float32Array(E + U);
    this._fRaw = new Float32Array(H);
    this._f = new Float32Array(H);
    this._gi = new Float32Array(3 * H);
    this._gh = new Float32Array(3 * H);
    this._entSlice = new Float32Array(this.entityDim);

    this._out = {
      intentLogits: new Float32Array(8),
      socialLogits: new Float32Array(6),
      aimLogits: new Float32Array(9),
      moveMean: new Float32Array(3),
      aimResMean: new Float32Array(2),
      binLogits: new Float32Array(5),
      utilLogits: new Float32Array(3),
      emotionPred: new Float32Array(8),
      auxDanger: new Float32Array(2)
    };
  }

  /** Exact forward step mirroring `NV3BrowserCore.step(ego, entities, h_prev)`. Updates `h` in-place! */
  forward(ego, entities, h) {
    const E = this.egoDim;
    const U = this.entDim;
    const H = this.gruDim;
    const NE = this.numEntities;
    const ED = this.entityDim;
    const nH = this.nHeads;
    const dH = this.dHead;

    // 1. Ego encoder
    matvecAdd(this.egoW, this.egoB, ego, this._eRaw, E, this.egoObsDim);
    layerNormSiLU(this._eRaw, this.egoLnG, this.egoLnB, this._e, E);

    // 2. Entity encoder + K/V projection (skip empty invalid slots for ~2.5x faster 360Hz inference!)
    let anyValid = false;
    for (let i = 0; i < NE; i++) {
      const eOff = i * ED;
      if (entities[eOff] <= 0.5) continue;
      anyValid = true;
      for (let d = 0; d < ED; d++) this._entSlice[d] = entities[eOff + d];
      matvecAdd(this.entW, this.entB, this._entSlice, this._uTmp, U, ED);
      const uOff = i * U;
      let mean = 0;
      for (let j = 0; j < U; j++) mean += this._uTmp[j];
      mean /= U;
      let vr = 0;
      for (let j = 0; j < U; j++) { const d = this._uTmp[j] - mean; vr += d * d; }
      const inv = 1 / Math.sqrt(vr / U + 1e-5);
      for (let j = 0; j < U; j++) {
        this._u[uOff + j] = silu((this._uTmp[j] - mean) * inv * this.entLnG[j] + this.entLnB[j]);
      }
      for (let r = 0; r < U; r++) {
        let sk = this.kB[r];
        let sv = this.vB[r];
        const wOff = r * U;
        for (let c = 0; c < U; c++) {
          const uc = this._u[uOff + c];
          sk += this.kW[wOff + c] * uc;
          sv += this.vW[wOff + c] * uc;
        }
        this._k[uOff + r] = sk;
        this._v[uOff + r] = sv;
      }
    }

    // 3. 4-Head Masked Cross-Attention (Ego Query attends to 12 Entities)
    matvecAdd(this.qW, this.qB, this._e, this._q, U, E);
    const invSqrt = 1 / Math.sqrt(dH);
    this._ctxPre.fill(0);
    if (anyValid) {
      for (let hd = 0; hd < nH; hd++) {
        const hOff = hd * dH;
        let maxS = -1e9;
        for (let i = 0; i < NE; i++) {
          if (entities[i * ED] > 0.5) {
            let dot = 0;
            const kOff = i * U + hOff;
            for (let d = 0; d < dH; d++) dot += this._q[hOff + d] * this._k[kOff + d];
            const s = dot * invSqrt;
            this._scores[i] = s;
            if (s > maxS) maxS = s;
          } else {
            this._scores[i] = -1e4;
          }
        }
        let sumExp = 0;
        for (let i = 0; i < NE; i++) {
          const w = Math.exp(clamp(this._scores[i] - maxS, -50, 0));
          this._scores[i] = w;
          sumExp += w;
        }
        const invSum = sumExp > 1e-12 ? (1 / sumExp) : 0;
        for (let i = 0; i < NE; i++) {
          const w = this._scores[i] * invSum;
          if (w <= 0) continue;
          const vOff = i * U + hOff;
          for (let d = 0; d < dH; d++) this._ctxPre[hOff + d] += w * this._v[vOff + d];
        }
      }
    }
    matvecAdd(this.oW, this.oB, this._ctxPre, this._ctx, U, U);

    // 4. Fuse Ego + Attention Context -> GRUCell(256)
    for (let i = 0; i < E; i++) this._cat[i] = this._e[i];
    for (let i = 0; i < U; i++) this._cat[E + i] = this._ctx[i];
    matvecAdd(this.fuseW, this.fuseB, this._cat, this._fRaw, H, E + U);
    layerNormSiLU(this._fRaw, this.fuseLnG, this.fuseLnB, this._f, H);

    matvecAdd(this.gruWih, this.gruBih, this._f, this._gi, 3 * H, H);
    matvecAdd(this.gruWhh, this.gruBhh, h, this._gh, 3 * H, H);
    const H2 = 2 * H;
    for (let i = 0; i < H; i++) {
      const r = sigmoid(this._gi[i] + this._gh[i]);
      const z = sigmoid(this._gi[H + i] + this._gh[H + i]);
      const n = Math.tanh(this._gi[H2 + i] + r * this._gh[H2 + i]);
      h[i] = (1 - z) * n + z * h[i];
    }

    // 5. All 7 Embodied Policy Heads + 8-D Emotion + Danger Intuition
    const out = this._out;
    matvecAdd(this.intentW, this.intentB, h, out.intentLogits, 8, H);
    matvecAdd(this.socialW, this.socialB, h, out.socialLogits, 6, H);
    matvecAdd(this.aimW, this.aimB, h, out.aimLogits, 9, H);
    matvecAdd(this.moveW, this.moveB, h, out.moveMean, 3, H);
    matvecAdd(this.aimResW, this.aimResB, h, out.aimResMean, 2, H);
    matvecAdd(this.binW, this.binB, h, out.binLogits, 5, H);
    matvecAdd(this.utilW, this.utilB, h, out.utilLogits, 3, H);
    matvecAdd(this.emoW, this.emoB, h, out.emotionPred, 8, H);
    matvecAdd(this.dangerW, this.dangerB, h, out.auxDanger, 2, H);

    for (let i = 0; i < 3; i++) out.moveMean[i] = Math.tanh(out.moveMean[i]);
    for (let i = 0; i < 2; i++) out.aimResMean[i] = Math.tanh(out.aimResMean[i]);
    for (let i = 0; i < 8; i++) out.emotionPred[i] = sigmoid(out.emotionPred[i]);

    // Apply exact aim-pointer mask (0=FREE_LOOK always valid; 1..4=VIS 0..3; 5..7=MEM 0..2; 8=ALLY_0)
    for (let k = 0; k < 4; k++) {
      if (entities[k * ED] <= 0.5) out.aimLogits[1 + k] = -1e4;
    }
    for (let m = 0; m < 3; m++) {
      if (entities[(4 + m) * ED] <= 0.5) out.aimLogits[5 + m] = -1e4;
    }
    if (entities[7 * ED] <= 0.5) out.aimLogits[8] = -1e4;

    return out;
  }
}

// ============================================================================
// Global Weight Registry (localStorage + auto-fetch `./assets/nv3-weights.json`)
// ============================================================================
let activeNV3Net = null;
let activeNV3Source = 'bundled';
const nv3Listeners = new Set();

function notifyNV3Listeners() {
  const status = getNV3Status();
  for (const fn of nv3Listeners) {
    try { fn(status); } catch {}
  }
}

export function onNV3WeightsChanged(fn) {
  if (typeof fn === 'function') nv3Listeners.add(fn);
  return () => nv3Listeners.delete(fn);
}

function initNV3Registry() {
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem(NV3_STORAGE_KEY);
      if (saved) {
        const res = validateNV3Bundle(JSON.parse(saved));
        if (res.ok) {
          activeNV3Net = res.net;
          activeNV3Source = 'custom';
          return;
        }
      }
    } catch {}
  }
  const bundled = validateNV3Bundle(NV3_BUNDLED_WEIGHTS);
  if (bundled.ok) {
    activeNV3Net = bundled.net;
    activeNV3Source = bundled.net.meta?.trained ? 'trained-bundled' : 'bundled';
  }
}
initNV3Registry();

export async function loadNV3WeightsFromUrl(url = './assets/nv3-weights.json') {
  if (typeof fetch !== 'function') return {ok: false, error: 'fetch unavailable'};
  if (activeNV3Source === 'custom') return {ok: true, skipped: true, status: getNV3Status()};
  try {
    const resp = await fetch(url, {cache: 'no-cache'});
    if (!resp.ok) return {ok: false, error: `HTTP ${resp.status}`};
    const bundle = await resp.json();
    const res = validateNV3Bundle(bundle);
    if (!res.ok) return res;
    activeNV3Net = res.net;
    activeNV3Source = res.net.meta?.trained ? 'asset-trained' : 'asset';
    notifyNV3Listeners();
    return {ok: true, status: getNV3Status()};
  } catch (err) {
    return {ok: false, error: err?.message || String(err)};
  }
}

export function importNV3WeightsJSON(jsonOrObject, persist = true) {
  let bundle = jsonOrObject;
  if (typeof jsonOrObject === 'string') {
    try { bundle = JSON.parse(jsonOrObject); }
    catch { return {ok: false, error: 'JSON の解析に失敗しました'}; }
  }
  const res = validateNV3Bundle(bundle);
  if (!res.ok) return res;
  activeNV3Net = res.net;
  activeNV3Source = 'custom';
  if (persist && typeof localStorage !== 'undefined') {
    try { localStorage.setItem(NV3_STORAGE_KEY, JSON.stringify(bundle)); } catch {}
  }
  notifyNV3Listeners();
  return {ok: true, status: getNV3Status()};
}

export function resetNV3Weights() {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(NV3_STORAGE_KEY); } catch {}
  }
  const bundled = validateNV3Bundle(NV3_BUNDLED_WEIGHTS);
  activeNV3Net = bundled.ok ? bundled.net : null;
  activeNV3Source = bundled.ok && bundled.net.meta?.trained ? 'trained-bundled' : 'bundled';
  notifyNV3Listeners();
  return getNV3Status();
}

export function getActiveNV3Net() {
  return activeNV3Net;
}

export function getNV3Status() {
  const m = activeNV3Net?.meta || {};
  return {
    loaded: !!activeNV3Net,
    source: activeNV3Source,
    trained: !!m.trained,
    steps: Number(m.steps || 0),
    paramCount: activeNV3Net?.paramCount || 0,
    teacherParams: Number(m.teacherParams || 4187585),
    evalWinRate: m.evalWinRate ?? null,
    evalKD: m.evalKD ?? null,
    preset: m.preset || '',
    gpu: m.gpu || '',
    quantize: m.quantize || 'q8'
  };
}

// ============================================================================
// Helper: Fair-Play Vision, Lidar, Callsign DNA & Sector Naming
// ============================================================================
function pickDNAForActor(actor) {
  const raw = String(actor.name || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (NV3_CALLSIGN_DNA[raw]) return Float32Array.from(NV3_CALLSIGN_DNA[raw]);
  const keys = Object.keys(NV3_CALLSIGN_DNA);
  const base = NV3_CALLSIGN_DNA[keys[Math.abs(actor.id || 0) % keys.length]];
  return Float32Array.from(base);
}

function getVoiceForActor(actor) {
  const raw = String(actor.name || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (VOICE_PROFILES_V26[raw]) return VOICE_PROFILES_V26[raw];
  const keys = ['NAGI', 'KAI', 'RIN', 'SORA', 'AO'];
  return VOICE_PROFILES_V26[keys[Math.abs(actor.id || 0) % keys.length]];
}

function sectorNameJa(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < SECTOR_CENTERS.length; i++) {
    const d = Math.hypot(x - SECTOR_CENTERS[i][0], z - SECTOR_CENTERS[i][1]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return SECTOR_NAMES_JA[best];
}

function isSmokeOccluded(match, ax, az, bx, bz) {
  const smokes = match.smokes;
  if (!smokes || !smokes.length) return false;
  const dx = bx - ax;
  const dz = bz - az;
  const ab2 = dx * dx + dz * dz;
  if (ab2 < 1e-6) return false;
  for (const s of smokes) {
    if (!s || (s.life ?? 0) <= 0) continue;
    const rad = s.radius || 3.85;
    const u = clamp(((s.x - ax) * dx + (s.z - az) * dz) / ab2, 0, 1);
    if (Math.hypot(ax + dx * u - s.x, az + dz * u - s.z) < rad) return true;
  }
  return false;
}

function castRayDistMat(ox, oy, oz, yaw, maxDist) {
  const dx = Math.sin(yaw);
  const dz = -Math.cos(yaw);
  let boundT = maxDist;
  if (Math.abs(dx) > 1e-6) {
    const tx = (dx > 0 ? FIELD.width * 0.5 - ox : -FIELD.width * 0.5 - ox) / dx;
    if (tx >= 0 && tx < boundT) boundT = tx;
  }
  if (Math.abs(dz) > 1e-6) {
    const tz = (dz > 0 ? FIELD.length * 0.5 - oz : -FIELD.length * 0.5 - oz) / dz;
    if (tz >= 0 && tz < boundT) boundT = tz;
  }
  const hit = raycastMaterial([ox, oy, oz], [ox + dx * boundT, oy, oz + dz * boundT]);
  if (!hit || hit.t > 1) return {dist: boundT, mat: 0};
  const mStr = hit.mat || hit.material || '';
  const mat = mStr === 'wood' ? 1 : (mStr === 'steel' ? -1 : 0);
  return {dist: clamp(hit.t * boundT, 0, maxDist), mat};
}

function argmax(arr) {
  let best = 0;
  let bestV = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > bestV) { bestV = arr[i]; best = i; }
  }
  return best;
}

// ============================================================================
// NV 3 Engine (360Hz Sentient Human NPC Controller)
// ============================================================================
export class NV3 {
  constructor(match) {
    this.match = match;
    this.version = NV3_VERSION;
    this.teamFilter = null;
    this.brains = new Map();
    this.net = activeNV3Net;
    this.lastRadioAt = [-10, -10];
    this.metrics = {
      crouch: 0, jump: 0, scope: 0, peek: 0, intuition: 0, learning: 0,
      cover: 0, flank: 0, disengage: 0, ambush: 0, resupply: 0, evade: 0, focusFire: 0,
      beliefTrack: 0, commanderOrders: 0, suppress: 0, crossfire: 0,
      neuralInferences: 0, neuralUpdates: 0, lookaheadPlans: 0, npcShots: 0, npcHits: 0,
      nv3EmotionsUpdated: 0, nv3Gestures: 0, nv3Breaths: 0, nv3VoiceSignals: 0,
      nv3Smokes: 0, nv3Skills: 0
    };
  }

  attach(actor) {
    if (actor.human) return;
    if (this.teamFilter !== null && actor.team !== this.teamFilter) return;
    const rng = random(30301 + actor.id * 7919 + (actor.deaths || 0) * 257);
    const hDim = this.net?.gruDim || 256;
    const dna = pickDNAForActor(actor);
    const emo = new Float32Array([0.78, 0.08, 0.50 + 0.25 * dna[0], 0.42, 0.05, 0.58 + 0.22 * dna[2], 0.40 + 0.20 * dna[5], 0.15]);
    const som = new Float32Array([0.16, 0.0, 0.10, 0.55]);
    const brain = {
      actorId: actor.id,
      rng,
      dna,
      voice: getVoiceForActor(actor),
      emotions: emo,
      somatic: som,
      h: new Float32Array(hDim),
      egoObs: new Float32Array(NV3_EGO_DIM),
      entObs: new Float32Array(NV3_NUM_ENTITIES * NV3_ENTITY_DIM),
      sectorBelief: new Float32Array([0.16, 0.16, 0.16, 0.16, 0.16, 0.16]),
      sectorEntropy: new Float32Array([0.50, 0.50, 0.50, 0.50, 0.50, 0.50]),
      memories: [],         // Fair-play visual / acoustic / radio contacts {x, y, z, t, kind}
      lastSeenMap: new Map(),
      prevEnemyVel: new Map(),
      visList: [],
      memList: [],
      ally0: null,
      seen: null,
      seenAt: -10,
      targetId: -1,
      underFireAt: -10,
      lastFireAt: -10,
      lastKillAt: -10,
      recentDmg: 0,
      hitDirX: 0,
      hitDirZ: 0,
      killStreak: 0,
      deathStreak: 0,
      decisionTimer: rng() * POLICY_DT,
      jumpCd: 0,
      socialCd: 0,
      breathCd: 0,
      lastSocial: 0,
      state: '索敵・状況把握',
      intentIdx: 0,
      // Smooth 360Hz embodied command state
      cmdMoveFwd: 0,
      cmdMoveSide: 0,
      cmdLean: 0,
      cmdAimMode: 0,
      cmdYawRes: 0,
      cmdPitchRes: 0,
      cmdFire: false,
      cmdSprint: false,
      cmdCrouch: false,
      cmdJump: false,
      cmdReload: false,
      cmdUtil: 0,
      // 16-bone `actor.expr` kinematics state
      headYaw: 0,
      gesture: FORCE_GESTURES.NONE,
      gestureUntil: -1,
      gestureDur: 0.6,
      startleUntil: -1,
      speakUntil: -1,
      breathPhase: rng() * Math.PI * 2,
      dangerPred: 0,
      playerOrder: null,
      playerOrderUntil: -1
    };
    this.brains.set(actor.id, brain);
  }

  _pushMemory(brain, x, y, z, t, kind) {
    for (let i = 0; i < brain.memories.length; i++) {
      const m = brain.memories[i];
      if (Math.hypot(m.x - x, m.z - z) < 4.5 && m.kind === kind) {
        m.x = x; m.y = y; m.z = z; m.t = t;
        return;
      }
    }
    brain.memories.unshift({x, y, z, t, kind});
    if (brain.memories.length > 6) brain.memories.length = 6;
  }

  _triggerGesture(brain, code, dur, t) {
    if (code === FORCE_GESTURES.NONE) return;
    brain.gesture = code;
    brain.gestureDur = dur;
    brain.gestureUntil = t + dur;
    if (code === FORCE_GESTURES.STARTLE_JOLT) brain.startleUntil = t + 0.34;
    this.metrics.nv3Gestures++;
  }

  _emitVoiceSignal(actor, brain, kind, t, refX = null, refZ = null) {
    const team = actor.team;
    const isAllyToPlayer = this.match.actors.some(a => a.human && a.team === team) || team === 0;
    const minGap = (kind === 'STARTLE' || kind === 'SWING_NOW' || kind === 'MAN_DOWN') ? 0.75 : 2.1;
    if (t - this.lastRadioAt[team] < minGap) return;
    this.lastRadioAt[team] = t;

    const emo = brain.emotions;
    const som = brain.somatic;
    const vp = brain.voice;
    const stress = clamp(emo[1] * 0.65 + emo[4] * 0.35 + som[0] * 0.25, 0, 1);
    const bpm = Math.round(70 + som[0] * 115);
    const prosody = {
      f0Hz: vp.f0Hz * (1 + stress * 0.16 - emo[0] * 0.05),
      tractScale: vp.tractScale,
      tempo: vp.tempo * (0.92 + stress * 0.24 + emo[2] * 0.08),
      breathiness: clamp(0.16 + som[1] * 0.35 + (kind === 'BREATH_RESET' ? 0.35 : 0), 0.1, 0.85),
      grit: clamp(vp.grit + emo[4] * 0.28 + emo[2] * 0.12, 0.1, 0.9),
      stress,
      bpm,
      urgency: clamp(stress * 0.7 + emo[2] * 0.3, 0, 1)
    };

    const pool = isAllyToPlayer
      ? (NV3_CALLOUT_LINES[kind] || NV3_CALLOUT_LINES.CONTACT)
      : (NV3_CALLOUT_LINES.ENEMY_SHOUT[kind] || NV3_CALLOUT_LINES.ENEMY_SHOUT.CONTACT);
    const lineJa = pool[Math.floor(brain.rng() * pool.length)];
    const sectorJa = isAllyToPlayer ? sectorNameJa(refX ?? actor.x, refZ ?? actor.z) : '';

    brain.speakUntil = t + (isAllyToPlayer ? 1.45 : 0.75);
    this.metrics.nv3VoiceSignals++;
    this.match.event('npcSignal', {
      type: 'npcSignal',
      actor,
      team,
      callsign: actor.name || 'NV3',
      kind,
      isRadio: isAllyToPlayer && kind !== 'BREATH_RESET' && kind !== 'STARTLE',
      pos: [actor.x, actor.y + 1.54, actor.z],
      lineJa,
      sectorJa,
      prosody,
      stress,
      urgency: prosody.urgency,
      syncGoAt: kind === 'SWING_NOW' ? (t + 0.9) : null,
      gesture: brain.gesture,
      time: t
    });
  }

  _updateEmotionsAndSomatic(actor, brain, dt, socialAct, intentAct, inCover, visCnt, allyWoundedNear, learnedEmo) {
    const t = this.match.time;
    const maxHp = actor.maxHp || this.match.hpMax || 100;
    const hpR = clamp(actor.hp / maxHp, 0, 1);
    const shR = clamp(((actor.shield || 0) + (actor.baizerShield || 0)) / 125, 0, 1);
    const underFire = clamp(1 - (t - brain.underFireAt) / 2.2, 0, 1);
    const justKilled = clamp(1 - (t - brain.lastKillAt) / 3.0, 0, 1);
    const calmTime = clamp((t - Math.max(brain.underFireAt, brain.lastFireAt)) / 4.0, 0, 1);
    const hSpd = Math.hypot(actor.vx || 0, actor.vz || 0);

    const dna = brain.dna;
    const outnumbered = clamp((visCnt - 1) * 0.45, 0, 1);
    const vuln = clamp((1 - hpR) * 0.65 + (inCover ? 0 : 0.25) * underFire + outnumbered * 0.35 - shR * 0.30, 0, 1);

    const tFear = clamp(vuln * (0.80 + 0.25 * dna[1] - 0.22 * dna[0]) + underFire * 0.25, 0, 1);
    const tCour = clamp(0.35 + 0.25 * dna[0] + 0.25 * allyWoundedNear * (0.6 + 0.4 * dna[2]) + 0.20 * justKilled + 0.15 * dna[8] * (1 - tFear * 0.5), 0, 1);
    const tComp = clamp(0.82 - 0.55 * tFear - 0.40 * brain.emotions[4] + (inCover ? 0.22 : 0) + 0.15 * dna[6], 0, 1);
    const tFoc  = clamp(0.32 + (visCnt > 0 ? 0.40 : 0) * tComp + 0.22 * clamp(brain.killStreak * 0.25, 0, 1), 0, 1);
    const tFrus = clamp(brain.deathStreak * 0.22 * (1 - 0.35 * dna[6]) + (brain.recentDmg / 100) * 0.25 - justKilled * 0.35, 0, 1);
    const tTrus = clamp(0.45 + 0.25 * dna[2] + 0.25 * allyWoundedNear, 0, 1);
    let meanEnt = 0;
    for (let i = 0; i < 6; i++) meanEnt += brain.sectorEntropy[i];
    meanEnt /= 6;
    const tCur  = clamp(meanEnt * (0.70 + 0.25 * dna[5]) * (visCnt > 0 ? 0.6 : 1.0), 0, 1);
    const tRel  = clamp(justKilled * 0.65 + calmTime * (inCover ? 0.35 : 0) * (hpR < 0.75 ? 1 : 0), 0, 1);

    const phys = [tComp, tFear, tCour, tFoc, tFrus, tTrus, tCur, tRel];
    const rate = 1 - Math.exp(-2.4 * dt);
    const emo = brain.emotions;
    for (let i = 0; i < 8; i++) {
      const tgt = learnedEmo ? (0.65 * phys[i] + 0.35 * learnedEmo[i]) : phys[i];
      emo[i] = clamp(emo[i] + (tgt - emo[i]) * rate, 0, 1);
    }

    // Conscious Breath-Reset actively calms heart rate & frustration!
    const doingBreath = (socialAct === 5 || intentAct === 7) && brain.breathCd <= 0 && visCnt === 0;
    if (doingBreath) {
      emo[0] = clamp(emo[0] + 0.28, 0, 1);
      emo[1] = clamp(emo[1] - 0.22, 0, 1);
      emo[4] = clamp(emo[4] - 0.32, 0, 1);
      brain.breathCd = 6.0;
      brain.somatic[0] = clamp(brain.somatic[0] - 0.25, 0.10, 1);
      brain.somatic[1] = clamp(brain.somatic[1] - 0.20, 0, 1);
      this.metrics.nv3Breaths++;
      this._triggerGesture(brain, FORCE_GESTURES.BREATH_SLUMP, 0.85, t);
      this._emitVoiceSignal(actor, brain, 'BREATH_RESET', t);
    } else {
      brain.breathCd = Math.max(0, brain.breathCd - dt);
    }

    const tHr = clamp(0.14 + 0.45 * emo[1] + 0.22 * emo[2] + 0.18 * (hSpd / 6.0) + 0.22 * underFire, 0, 1);
    brain.somatic[0] = clamp(brain.somatic[0] + (tHr - brain.somatic[0]) * (1 - Math.exp(-1.8 * dt)), 0.10, 1);
    const fatD = (hSpd > 4.9 ? 0.06 : -0.10) * dt + (brain.somatic[0] > 0.72 ? 0.03 * dt : 0);
    brain.somatic[1] = clamp(brain.somatic[1] + fatD, 0, 1);
    brain.somatic[2] = vuln;
    const tConf = clamp(0.50 + 0.14 * brain.killStreak - 0.14 * brain.deathStreak + 0.20 * (hpR - 0.5), 0, 1);
    brain.somatic[3] = clamp(brain.somatic[3] + (tConf - brain.somatic[3]) * (1 - Math.exp(-1.5 * dt)), 0, 1);
    brain.recentDmg = Math.max(0, brain.recentDmg - 16 * dt);
    this.metrics.nv3EmotionsUpdated++;
  }

  /** Build exact 100% Fair-Play 112-dim Ego + 12x16 Entity tensors matching `HarborOmegaEnvGPU`. */
  buildNV3Observation(actor, brain) {
    const m = this.match;
    const t = m.time;
    const ego = brain.egoObs;
    const ent = brain.entObs;
    ego.fill(0);
    ent.fill(0);

    const sy = Math.sin(actor.yaw);
    const cy = Math.cos(actor.yaw);
    const vx = actor.vx || 0;
    const vz = actor.vz || 0;
    const localFwd = vx * sy - vz * cy;
    const localSide = vx * cy + vz * sy;
    const w = typeof m.weapon === 'function' ? m.weapon(actor) : (actor.weapon || {});
    const teamSign = actor.team === 0 ? 1 : -1;
    const maxHp = actor.maxHp || m.hpMax || 100;

    // Ego Block 1: Kinematics & Weapon (0..35)
    ego[0] = clamp(actor.x / (FIELD.width * 0.5), -1, 1);
    ego[1] = clamp(actor.z / (FIELD.length * 0.5), -1, 1);
    ego[2] = clamp(actor.y / 3.0, 0, 1.5);
    ego[3] = teamSign;
    ego[4] = sy;
    ego[5] = cy;
    ego[6] = clamp((actor.pitch || 0) / 1.2, -1, 1);
    ego[7] = clamp(localFwd / 6.75, -1, 1);
    ego[8] = clamp(localSide / 6.75, -1, 1);
    ego[9] = clamp((actor.vy || 0) / 6.5, -1, 1);
    ego[10] = actor.crouch || 0;
    ego[11] = clamp((actor.lean || 0) / 0.32, -1, 1);
    ego[12] = actor.onGround ? 1 : 0;
    ego[13] = actor.aimPose || 0;
    ego[14] = clamp(actor.hp / maxHp, 0, 1);
    ego[15] = clamp((actor.shield || 0) / 65, 0, 1);
    ego[16] = clamp((actor.baizerShield || 0) / 60, 0, 1);
    ego[17] = clamp((actor.mag || 0) / Math.max(1, w.capacity || 20), 0, 1);
    ego[18] = clamp((actor.stock || 0) / 300, 0, 1);
    ego[19] = clamp((actor.reload || 0) / Math.max(0.1, w.reload || 2.0), 0, 1);
    ego[20] = clamp((actor.cooldown || 0) / Math.max(0.05, w.interval || 0.12), 0, 1);
    ego[21] = (w.damage || 6) / 10;
    ego[22] = (w.speed || 300) / 650;
    ego[23] = (w.interval || 0.12) / 0.30;
    ego[24] = (w.burst || 1) / 3;
    ego[25] = (w.pellets || 1) / 4;
    ego[26] = w.auto ? 1 : 0;
    ego[27] = (w.stockRegen || 2.5) / 4;
    ego[28] = clamp((actor.shafferTimer || 0) / 7.0, 0, 1);
    ego[29] = (actor.smokeCooldown || 0) <= 0.01 ? 1 : 0;
    ego[30] = clamp((actor.skillCharges || 0) / 3, 0, 1);
    ego[31] = actor.assignedSkill === 'heal' ? 1 : (actor.assignedSkill === 'shaffer' ? -1 : 0);
    const ufDecay = clamp(1 - (t - brain.underFireAt) / 2.5, 0, 1);
    ego[32] = ufDecay;
    ego[33] = (brain.hitDirX * cy + brain.hitDirZ * sy) * ufDecay;
    ego[34] = (brain.hitDirX * sy - brain.hitDirZ * cy) * ufDecay;
    ego[35] = clamp(brain.recentDmg / 80, 0, 1);

    // Ego Block 2: 8-D Emotions (36..43), 4-D Somatic (44..47), 16-D DNA (48..63)
    for (let i = 0; i < 8; i++) ego[36 + i] = brain.emotions[i];
    for (let i = 0; i < 4; i++) ego[44 + i] = brain.somatic[i];
    for (let i = 0; i < 16; i++) ego[48 + i] = brain.dna[i];

    // Ego Block 3: 3D Egocentric Lidar + Cover Topology (64..95)
    const chestY = actor.y + 1.25;
    const lowY = actor.y + 0.45;
    const headY = actor.y + 1.65;
    let minChest = LIDAR_MAX_DIST;
    let frontMat = 0;
    for (let i = 0; i < 16; i++) {
      const r = castRayDistMat(actor.x, chestY, actor.z, actor.yaw + LIDAR_CHEST_RAD[i], LIDAR_MAX_DIST);
      ego[64 + i] = clamp(r.dist / LIDAR_MAX_DIST, 0, 1);
      if (r.dist < minChest) minChest = r.dist;
    }
    for (let i = 0; i < 8; i++) {
      const ang = actor.yaw + LIDAR_LOW_RAD[i];
      const rl = castRayDistMat(actor.x, lowY, actor.z, ang, LIDAR_MAX_DIST).dist;
      const rh = castRayDistMat(actor.x, headY, actor.z, ang, LIDAR_MAX_DIST).dist;
      ego[80 + i] = clamp((rh - rl) / LIDAR_MAX_DIST, 0, 1);
    }
    for (let i = 0; i < 4; i++) {
      const r = castRayDistMat(actor.x, chestY, actor.z, actor.yaw + LIDAR_MAT_RAD[i], LIDAR_MAX_DIST);
      ego[88 + i] = r.mat;
      if (i === 0) frontMat = r.mat;
    }
    ego[92] = minChest < 2.5 ? 1 : 0;
    ego[93] = ego[64 + 12] * LIDAR_MAX_DIST > 3.5 ? 1 : 0;
    ego[94] = ego[64 + 4] * LIDAR_MAX_DIST > 3.5 ? 1 : 0;
    ego[95] = ego[64 + 8] * LIDAR_MAX_DIST > 3.5 ? 1 : 0;

    // Update 6-sector Friston subjective uncertainty entropies (fair-play FOV clearing)
    for (let s = 0; s < 6; s++) {
      const sdx = SECTOR_CENTERS[s][0] - actor.x;
      const sdz = SECTOR_CENTERS[s][1] - actor.z;
      const sdist = Math.hypot(sdx, sdz);
      const sry = Math.abs(angleDiff(Math.atan2(sdx, -sdz), actor.yaw));
      const looking = sry < 0.78 && sdist < 68.0;
      brain.sectorEntropy[s] = clamp(brain.sectorEntropy[s] + (looking ? -0.35 : 0.045) * POLICY_DT, 0.05, 1.0);
      brain.sectorBelief[s] = clamp(brain.sectorBelief[s] + (looking ? -0.22 : 0.015) * POLICY_DT, 0.02, 1.0);
    }

    // Entity Slots 0..3: Strictly Fair-Play Visible Enemies (ZERO wallhack, ZERO Shaffer!)
    const eye = eyeOf(actor);
    const vis = [];
    for (const o of m.actors) {
      if (!o.alive || o.team === actor.team) continue;
      if ((o.shafferTimer || 0) > 0) continue; // 100% Shaffer stealth respect!
      const dx = o.x - actor.x;
      const dz = o.z - actor.z;
      const hd = Math.hypot(dx, dz);
      if (hd > MAX_VISION_RANGE) continue;
      const ry = angleDiff(Math.atan2(dx, -dz), actor.yaw);
      const recent = (t - (brain.lastSeenMap.get(o.id) ?? -99)) < 1.2;
      if (Math.abs(ry) > (recent ? TRACK_FOV_HALF : NORMAL_FOV_HALF) && hd > PROXIMITY_SENSE_RANGE) continue;
      const tp = targetPoint(o);
      if (!clearOpticalPath(eye, tp, m.aeroVortex)) continue;
      if (isSmokeOccluded(m, actor.x, actor.z, o.x, o.z)) continue;
      brain.lastSeenMap.set(o.id, t);
      const oMaxHp = o.maxHp || m.hpMax || 100;
      const prio = hd * (0.60 + 0.40 * clamp(o.hp / oMaxHp, 0, 1));
      vis.push({o, tp, dx, dz, hd: Math.max(1e-4, hd), ry, prio});
    }
    vis.sort((a, b) => a.prio - b.prio);
    brain.visList = vis.slice(0, 4);

    if (brain.visList.length > 0) {
      const v0 = brain.visList[0];
      brain.seen = {x: v0.o.x, y: v0.tp[1], z: v0.o.z, vx: v0.o.vx || 0, vz: v0.o.vz || 0};
      brain.seenAt = t;
      brain.targetId = v0.o.id;
    } else {
      brain.seen = null;
      brain.targetId = -1;
    }

    for (let k = 0; k < brain.visList.length; k++) {
      const v = brain.visList[k];
      const o = v.o;
      const off = k * NV3_ENTITY_DIM;
      const rp = Math.atan2(v.tp[1] - eye[1], v.hd) - (actor.pitch || 0);
      const evx = o.vx || 0;
      const evz = o.vz || 0;
      const rvxL = evx * cy + evz * sy;
      const rvzL = evx * sy - evz * cy;
      const prevV = brain.prevEnemyVel.get(o.id) ?? rvxL;
      brain.prevEnemyVel.set(o.id, rvxL);
      const revApex = (rvxL * prevV <= 0 || Math.abs(rvxL) < 0.85) ? 1 : 0;
      const eFace = (Math.sin(o.yaw) * (-v.dx) - Math.cos(o.yaw) * (-v.dz)) / v.hd;

      ent[off + 0] = 1;
      ent[off + 1] = 1;
      ent[off + 2] = Math.sin(v.ry);
      ent[off + 3] = Math.cos(v.ry);
      ent[off + 4] = clamp(rp / 1.2, -1, 1);
      ent[off + 5] = clamp(v.hd / MAX_VISION_RANGE, 0, 1);
      ent[off + 6] = 1 / (1 + v.hd / 12);
      ent[off + 7] = clamp(rvxL / 7, -1, 1);
      ent[off + 8] = clamp(rvzL / 7, -1, 1);
      ent[off + 9] = o.crouch || 0;
      ent[off + 10] = clamp(eFace, -1, 1);
      ent[off + 11] = clamp(((o.shield || 0) + (o.baizerShield || 0)) / 125, 0, 1);
      ent[off + 12] = (o.flash || 0) > 0.005 ? 1 : 0;
      ent[off + 13] = (o.reload || 0) > 0 ? 1 : 0;
      ent[off + 14] = revApex;
      ent[off + 15] = clamp(1 - v.prio / 80, 0, 1);

      if (k === 0) {
        this._pushMemory(brain, o.x, v.tp[1], o.z, t, 1);
        let bestS = 0, bestSD = Infinity;
        for (let s = 0; s < 6; s++) {
          const sd = Math.hypot(SECTOR_CENTERS[s][0] - o.x, SECTOR_CENTERS[s][1] - o.z);
          if (sd < bestSD) { bestSD = sd; bestS = s; }
        }
        brain.sectorBelief[bestS] = clamp(brain.sectorBelief[bestS] + 0.55, 0.02, 1.0);
      }
    }

    // Entity Slots 4..6: Top 3 Fair-Play Memory / Acoustic / Radio Contacts
    brain.memList = [];
    const vis0 = brain.visList[0] || null;
    for (const mem of brain.memories) {
      if (brain.memList.length >= 3) break;
      const age = t - mem.t;
      const ttl = mem.kind === 1 ? MEMORY_TTL : ACOUSTIC_TTL;
      if (age < 0 || age >= ttl) continue;
      const mdx = mem.x - actor.x;
      const mdz = mem.z - actor.z;
      const md = Math.hypot(mdx, mdz);
      if (md <= 1.0) continue;
      if (vis0 && Math.hypot(mem.x - vis0.o.x, mem.z - vis0.o.z) < 3.0) continue;
      const mIdx = brain.memList.length;
      brain.memList.push(mem);
      const mry = angleDiff(Math.atan2(mdx, -mdz), actor.yaw);
      const off = (4 + mIdx) * NV3_ENTITY_DIM;
      ent[off + 0] = 1;
      ent[off + 1] = 0.5;
      ent[off + 2] = Math.sin(mry);
      ent[off + 3] = Math.cos(mry);
      ent[off + 5] = clamp(md / MAX_VISION_RANGE, 0, 1);
      ent[off + 6] = 1 / (1 + md / 12);
      ent[off + 7] = clamp(1 - age / MEMORY_TTL, 0, 1);
      ent[off + 8] = mem.kind === 1 ? 1 : 0;
      ent[off + 9] = mem.kind === 2 ? 1 : 0;
      ent[off + 10] = mem.kind === 3 ? 1 : 0;
      ent[off + 11] = (frontMat === 1 && Math.abs(mry) < 0.35) ? 1 : 0;
      ent[off + 12] = (frontMat === -1 && Math.abs(mry) < 0.45) ? 1 : 0;
      ent[off + 13] = brain.emotions[6];
    }

    // Entity Slots 7..9: Top 3 Alive Teammates (Empathy, Wounded Distress, Crossfire Orthogonality)
    const allies = [];
    for (const al of m.actors) {
      if (!al.alive || al.team !== actor.team || al.id === actor.id) continue;
      const adx = al.x - actor.x;
      const adz = al.z - actor.z;
      allies.push({al, adx, adz, ad: Math.max(1e-4, Math.hypot(adx, adz))});
    }
    allies.sort((a, b) => a.ad - b.ad);
    brain.ally0 = allies[0]?.al || null;
    let allyWoundedNear = 0;

    for (let j = 0; j < Math.min(3, allies.length); j++) {
      const a = allies[j];
      const al = a.al;
      const alBrain = this.brains.get(al.id);
      const ary = angleDiff(Math.atan2(a.adx, -a.adz), actor.yaw);
      const alMaxHp = al.maxHp || m.hpMax || 100;
      const ahp = clamp(al.hp / alMaxHp, 0, 1);
      const awound = (ahp < 0.62 && a.ad < 35) ? 1 : 0;
      if (awound > allyWoundedNear) allyWoundedNear = awound;

      let orthoCf = 0;
      if (vis0) {
        const v1x = actor.x - vis0.o.x, v1z = actor.z - vis0.o.z;
        const v2x = al.x - vis0.o.x, v2z = al.z - vis0.o.z;
        const cosCf = (v1x * v2x + v1z * v2z) / Math.max(1e-4, Math.hypot(v1x, v1z) * Math.hypot(v2x, v2z));
        orthoCf = 1 - Math.abs(cosCf);
      }

      const off = (7 + j) * NV3_ENTITY_DIM;
      ent[off + 0] = 1;
      ent[off + 1] = -0.5;
      ent[off + 2] = Math.sin(ary);
      ent[off + 3] = Math.cos(ary);
      ent[off + 5] = clamp(a.ad / 80, 0, 1);
      ent[off + 6] = 1 / (1 + a.ad / 15);
      ent[off + 7] = ahp;
      ent[off + 8] = clamp(((al.shield || 0) + (al.baizerShield || 0)) / 125, 0, 1);
      ent[off + 9] = alBrain && ((t - alBrain.lastFireAt) < 1.5 || (t - alBrain.underFireAt) < 1.5) ? 1 : 0;
      ent[off + 10] = awound;
      ent[off + 11] = (al.reload || 0) > 0 ? 1 : 0;
      ent[off + 12] = alBrain ? alBrain.emotions[1] : 0.15;
      ent[off + 13] = alBrain ? alBrain.emotions[2] : 0.55;
      ent[off + 14] = orthoCf;
      ent[off + 15] = (alBrain && alBrain.lastSocial === 1) ? 1 : 0;
    }

    // Entity Slot 10: Objectives (BAIZER + Tanker)
    let bestBz = null, bestBzD = Infinity;
    for (const bz of (m.baizers || [])) {
      if ((bz.cooldown || 0) > 0 || (actor.baizerShield || 0) >= 60) continue;
      const d = Math.hypot(bz.x - actor.x, bz.z - actor.z);
      if (d < bestBzD) { bestBzD = d; bestBz = bz; }
    }
    let bestTk = null, bestTkD = Infinity;
    for (const tk of (m.tankers || [])) {
      if ((tk.cooldown || 0) > 0) continue;
      const d = Math.hypot(tk.x - actor.x, tk.z - actor.z);
      if (d < bestTkD) { bestTkD = d; bestTk = tk; }
    }
    const oOff = 10 * NV3_ENTITY_DIM;
    ent[oOff + 0] = (bestBz || bestTk) ? 1 : 0;
    if (bestBz) {
      const bry = angleDiff(Math.atan2(bestBz.x - actor.x, -(bestBz.z - actor.z)), actor.yaw);
      ent[oOff + 1] = -1;
      ent[oOff + 2] = Math.sin(bry);
      ent[oOff + 3] = Math.cos(bry);
      ent[oOff + 5] = clamp(bestBzD / 60, 0, 1);
      ent[oOff + 6] = 1 / (1 + bestBzD / 15);
      ent[oOff + 7] = (bestBz.amount || 30) / 40;
      ent[oOff + 8] = clamp(1 - (actor.baizerShield || 0) / 60, 0, 1);
    }
    if (bestTk) {
      const tryA = angleDiff(Math.atan2(bestTk.x - actor.x, -(bestTk.z - actor.z)), actor.yaw);
      ent[oOff + 9] = 1;
      ent[oOff + 10] = Math.sin(tryA);
      ent[oOff + 11] = Math.cos(tryA);
      ent[oOff + 12] = clamp(bestTkD / 80, 0, 1);
      ent[oOff + 13] = (actor.stock || 0) < 60 ? 1 : 0;
    }

    // Entity Slot 11: Fair-Play Visible Incoming Enemy Projectile Hazard
    let bestSh = null, bestShD = Infinity;
    for (const s of (m.shots || [])) {
      if (!s || s.team === actor.team || s.shafferCloaked || (s.age || 0) < INCOMING_MIN_AGE) continue;
      const sp = s.p || s.pos;
      if (!sp) continue;
      const sdx = actor.x - sp[0];
      const sdz = actor.z - sp[2];
      const sd = Math.hypot(sdx, sdz);
      if (sd <= 1.5 || sd >= INCOMING_RANGE) continue;
      const proj = sdx * s.dir[0] + sdz * s.dir[2];
      const perp = Math.abs(sdx * s.dir[2] - sdz * s.dir[0]);
      if (proj > 0 && perp < 2.1 && obstruction(sp, eye) > 1 && sd < bestShD) {
        bestShD = sd; bestSh = s;
      }
    }
    if (bestSh) {
      const sp = bestSh.p || bestSh.pos;
      const hOff = 11 * NV3_ENTITY_DIM;
      const sdx = actor.x - sp[0];
      const sdz = actor.z - sp[2];
      const sgn = (sdx * bestSh.dir[2] - sdz * bestSh.dir[0]) >= 0 ? 1 : -1;
      const exW = bestSh.dir[2] * sgn;
      const ezW = -bestSh.dir[0] * sgn;
      ent[hOff + 0] = 1;
      ent[hOff + 2] = exW * cy + ezW * sy;
      ent[hOff + 3] = exW * sy - ezW * cy;
      ent[hOff + 5] = clamp(bestShD / INCOMING_RANGE, 0, 1);
      ent[hOff + 6] = 1 / (1 + bestShD / 6);
      ent[hOff + 7] = clamp(bestShD / Math.max(60, bestSh.speed || 260), 0, 1);
    }

    // Finish Ego Block 3: Friston Sectors (96..107) + Match Context (108..111)
    for (let s = 0; s < 6; s++) {
      ego[96 + s] = brain.sectorBelief[s];
      ego[102 + s] = brain.sectorEntropy[s];
    }
    let alT0 = 0, alT1 = 0;
    for (const a of m.actors) {
      if (!a.alive) continue;
      if (a.team === 0) alT0++; else alT1++;
    }
    const sc0 = m.scores?.[0] || 0;
    const sc1 = m.scores?.[1] || 0;
    const goal = Array.isArray(m.targets) ? Math.max(1, m.targets[0] || 15) : Math.max(1, m.goal || 15);
    ego[108] = clamp((actor.team === 0 ? (alT0 - alT1) : (alT1 - alT0)) / 5, -1, 1);
    ego[109] = clamp((actor.team === 0 ? (sc0 - sc1) : (sc1 - sc0)) / 10, -1, 1);
    ego[110] = clamp(Math.max(sc0, sc1) / goal, 0, 1);
    ego[111] = clamp(actor.y / 2.62, 0, 1);

    return {inCover: ego[92] > 0.5, allyWoundedNear};
  }

  /**
   * Cognitive-Affective Fallback Action (ONLY active while starter weights have `meta.trained === false`;
   * once A100-trained `nv3-weights.json` is imported, 100% pure distilled neural network takes full command!)
   */
  _starterCognitivePolicy(actor, brain, ego, ent) {
    const hasV0 = ent[0] > 0.5;
    const v0Sin = ent[2], v0Cos = ent[3], v0Dist = ent[5] * MAX_VISION_RANGE;
    const hasM0 = ent[4 * NV3_ENTITY_DIM] > 0.5;
    const m0Sin = ent[4 * NV3_ENTITY_DIM + 2];
    const hasInc = ent[11 * NV3_ENTITY_DIM] > 0.5;
    const incSide = ent[11 * NV3_ENTITY_DIM + 2];
    const hp = ego[14], mag = ego[17], inCov = ego[92] > 0.5;
    const lf = ego[64], lr = ego[65], ll = ego[79], lr2 = ego[66], ll2 = ego[78];
    const fear = brain.emotions[1], tilt = brain.emotions[4], brav = brain.dna[0];

    const aimMode = hasV0 ? 1 : (hasM0 ? 5 : 0);
    const intentIdx = hasV0 ? ((hp < 0.40 || fear > 0.72) ? 3 : (inCov ? 1 : 0)) : (brain.somatic[0] > 0.62 && inCov ? 7 : 2);
    let socialIdx = 0;
    if (!hasV0 && inCov && (tilt > 0.36 || brain.somatic[0] > 0.62)) socialIdx = 5;
    else if (hasV0 && brain.rng() < 0.08) socialIdx = 3;
    else if (hasV0 && ent[7 * NV3_ENTITY_DIM + 14] > 0.55 && brain.rng() < 0.06) socialIdx = 1;

    const goalZ = -(ego[3]) * 0.45;
    const goalX = -ego[0] * 0.32;
    const goalTurn = clamp(angleDiff(Math.atan2(goalX - ego[0], -(goalZ - ego[1])), actor.yaw) * 1.15, -1, 1);
    const avoid = (lr + lr2) > (ll + ll2) ? 0.90 : -0.90;
    const navTurn = lf < 0.24 ? avoid : clamp(goalTurn * 0.72 + ((lr + lr2) - (ll + ll2)) * 0.45, -1, 1);
    const strafe = hasInc ? incSide : (Math.sin(this.match.time * (2.2 + brav) + actor.id * 1.7) >= 0 ? 1 : -1);

    const moveFwd = hasV0
      ? ((hp < 0.40 || fear > 0.74) ? -0.82 : (v0Dist > 26 ? 0.70 : (v0Dist < 9 ? -0.50 : 0.10)))
      : (lf < 0.14 ? -0.35 : 0.92);
    const moveSide = hasV0 ? strafe * 0.78 : (lf < 0.22 ? avoid * 0.70 : navTurn * 0.35);
    const leanCmd = (hasV0 && inCov) ? strafe * 0.75 : 0;
    const yawRes = hasV0 ? 0 : (hasM0 ? clamp(m0Sin * 1.4, -1, 1) : navTurn);
    const fire = hasV0 && v0Cos > 0.95 && Math.abs(v0Sin) < 0.24;
    const sprint = !hasV0 && lf > 0.24;
    const crouch = (hasV0 && (hp < 0.55 || inCov)) || hasInc;
    const jump = !hasV0 && lf < 0.12 && ego[80] > 0.18;
    const reload = !hasV0 && mag < 0.35;
    const util = (ego[30] > 0.1 && (hp < 0.55 || hasV0)) ? 2 : ((ego[29] > 0.5 && hp < 0.45 && ego[32] > 0.35) ? 1 : 0);

    return {intentIdx, socialIdx, aimMode, moveFwd, moveSide, leanCmd, yawRes, pitchRes: 0, fire, sprint, crouch, jump, reload, util};
  }

  _decide20Hz(actor, brain) {
    const m = this.match;
    const t = m.time;
    const {inCover, allyWoundedNear} = this.buildNV3Observation(actor, brain);

    // Hot-swap if user imported newly trained A100 nv3-weights.json live!
    if (activeNV3Net && activeNV3Net !== this.net) {
      this.net = activeNV3Net;
      brain.h = new Float32Array(this.net.gruDim);
    }

    let intentIdx = 0, socialIdx = 0, aimMode = 0;
    let moveFwd = 0, moveSide = 0, leanCmd = 0, yawRes = 0, pitchRes = 0;
    let fire = false, sprint = false, crouch = false, jump = false, reload = false, util = 0;
    let learnedEmo = null;

    if (this.net) {
      const outs = this.net.forward(brain.egoObs, brain.entObs, brain.h);
      this.metrics.neuralInferences++;
      learnedEmo = outs.emotionPred;
      brain.dangerPred = sigmoid(outs.auxDanger[0]);

      if (this.net.meta?.trained) {
        // 100% Pure A100-Distilled Sentient Neural Mind!
        intentIdx = argmax(outs.intentLogits);
        socialIdx = argmax(outs.socialLogits);
        aimMode = argmax(outs.aimLogits);
        moveFwd = outs.moveMean[0];
        moveSide = outs.moveMean[1];
        leanCmd = outs.moveMean[2];
        yawRes = outs.aimResMean[0];
        pitchRes = outs.aimResMean[1];
        fire = outs.binLogits[0] > 0;
        sprint = outs.binLogits[1] > 0;
        crouch = outs.binLogits[2] > 0;
        jump = outs.binLogits[3] > 0;
        reload = outs.binLogits[4] > 0;
        util = argmax(outs.utilLogits);
      } else {
        // Starter weights: run full GRU + emotion appraisal blended with fair-play cognitive-affective controller
        const s = this._starterCognitivePolicy(actor, brain, brain.egoObs, brain.entObs);
        intentIdx = s.intentIdx; socialIdx = s.socialIdx; aimMode = s.aimMode;
        moveFwd = clamp(s.moveFwd + outs.moveMean[0] * 0.10, -1, 1);
        moveSide = clamp(s.moveSide + outs.moveMean[1] * 0.10, -1, 1);
        leanCmd = clamp(s.leanCmd + outs.moveMean[2] * 0.10, -1, 1);
        yawRes = clamp(s.yawRes + outs.aimResMean[0] * 0.06, -1, 1);
        pitchRes = clamp(s.pitchRes + outs.aimResMean[1] * 0.04, -1, 1);
        fire = s.fire; sprint = s.sprint; crouch = s.crouch; jump = s.jump; reload = s.reload; util = s.util;
      }
    } else {
      const s = this._starterCognitivePolicy(actor, brain, brain.egoObs, brain.entObs);
      intentIdx = s.intentIdx; socialIdx = s.socialIdx; aimMode = s.aimMode;
      moveFwd = s.moveFwd; moveSide = s.moveSide; leanCmd = s.leanCmd;
      yawRes = s.yawRes; pitchRes = s.pitchRes;
      fire = s.fire; sprint = s.sprint; crouch = s.crouch; jump = s.jump; reload = s.reload; util = s.util;
    }

    // Apply player F1/F2/F3 squad order softly (human teammate responsiveness!)
    if (brain.playerOrder && t < brain.playerOrderUntil) {
      if (brain.playerOrder === 'SWING') { intentIdx = 4; socialIdx = socialIdx || 1; }
      else if (brain.playerOrder === 'TRAP') { intentIdx = 5; socialIdx = socialIdx || 2; }
      else if (brain.playerOrder === 'COVER') { intentIdx = 4; }
    }

    // Update live 8-D Emotion + 4-D Somatic Appraisal
    this._updateEmotionsAndSomatic(actor, brain, POLICY_DT, socialIdx, intentIdx, inCover, brain.visList.length, allyWoundedNear, learnedEmo);

    // Execute Social Gestures, Squad Radio & Emotional Contagion!
    brain.socialCd = Math.max(0, brain.socialCd - POLICY_DT);
    brain.lastSocial = 0;
    if (socialIdx > 0 && brain.socialCd <= 0) {
      brain.lastSocial = socialIdx;
      brain.socialCd = 2.4;
      if (socialIdx === 1) {
        this._triggerGesture(brain, FORCE_GESTURES.WAVE_SWING, 0.78, t);
        this._emitVoiceSignal(actor, brain, 'SWING_NOW', t);
        for (const [id, ob] of this.brains) {
          const oa = m.actors[id];
          if (oa && oa.alive && oa.team === actor.team && oa.id !== actor.id) {
            ob.emotions[2] = clamp(ob.emotions[2] + 0.14, 0, 1);
          }
        }
      } else if (socialIdx === 2) {
        this._triggerGesture(brain, FORCE_GESTURES.HOLD_TRAP, 0.95, t);
        this._emitVoiceSignal(actor, brain, 'BAIT_READY', t);
      } else if (socialIdx === 3 && brain.visList[0]) {
        const v0 = brain.visList[0];
        this._triggerGesture(brain, FORCE_GESTURES.POINT_CONTACT, 0.65, t);
        this._emitVoiceSignal(actor, brain, 'CONTACT', t, v0.o.x, v0.o.z);
        for (const [id, ob] of this.brains) {
          const oa = m.actors[id];
          if (oa && oa.alive && oa.team === actor.team && oa.id !== actor.id) {
            this._pushMemory(ob, v0.o.x, v0.tp[1], v0.o.z, t, 3);
          }
        }
      } else if (socialIdx === 4) {
        this._triggerGesture(brain, FORCE_GESTURES.POINT_CONTACT, 0.65, t);
        this._emitVoiceSignal(actor, brain, 'TRADE_REQUEST', t);
      }
    }

    // Track telemetry metrics cleanly
    brain.intentIdx = intentIdx;
    brain.state = NV3_INTENT_LABELS[intentIdx] || '交戦';
    if (intentIdx === 1) this.metrics.peek++;
    else if (intentIdx === 2) this.metrics.flank++;
    else if (intentIdx === 3) this.metrics.disengage++;
    else if (intentIdx === 4) this.metrics.crossfire++;
    else if (intentIdx === 5) this.metrics.ambush++;
    else if (intentIdx === 6) this.metrics.resupply++;
    if (inCover) this.metrics.cover++;
    if (brain.entObs[11 * NV3_ENTITY_DIM] > 0.5) this.metrics.evade++;

    // Utility: Smoke / Skill / Reload using exact Match API
    const w = typeof m.weapon === 'function' ? m.weapon(actor) : (actor.weapon || {});
    if (util === 1 && (actor.smokeCooldown || 0) <= 0.01 && typeof m.deploySmokeVent === 'function') {
      if (m.deploySmokeVent(actor)) this.metrics.nv3Smokes++;
    } else if (util === 2 && m.lab?.npcSkills && (actor.skillCharges || 0) > 0 && actor.assignedSkill && typeof m.useSkill === 'function') {
      if (m.useSkill(actor, actor.assignedSkill)) this.metrics.nv3Skills++;
    }
    if (reload && (actor.reload || 0) <= 0 && !actor.burstLeft && (actor.mag || 0) < (w.capacity || 20) && (actor.stock || 0) > 0) {
      if (typeof m.reload === 'function') m.reload(actor);
    }

    brain.cmdMoveFwd = clamp(moveFwd, -1, 1);
    brain.cmdMoveSide = clamp(moveSide, -1, 1);
    brain.cmdLean = clamp(leanCmd, -1, 1) * 0.32;
    brain.cmdAimMode = aimMode;
    brain.cmdYawRes = clamp(yawRes, -1, 1);
    brain.cmdPitchRes = clamp(pitchRes, -1, 1);
    brain.cmdFire = fire;
    brain.cmdSprint = sprint;
    brain.cmdCrouch = crouch;
    brain.cmdJump = jump;
    brain.cmdReload = reload;
    brain.cmdUtil = util;
  }

  _updateExpr360Hz(actor, brain, dt) {
    const t = this.match.time;
    const emo = brain.emotions;
    const som = brain.somatic;

    // 1. Cervical head-look (natural glance toward threat, curiosity corridor, or buddy!)
    let targetHead = 0;
    if (brain.cmdAimMode === 8 && brain.ally0 && brain.ally0.alive) {
      const ary = angleDiff(Math.atan2(brain.ally0.x - actor.x, -(brain.ally0.z - actor.z)), actor.yaw);
      targetHead = clamp(ary, -0.62, 0.62);
    } else if (brain.visList.length > 1) {
      targetHead = clamp(brain.visList[1].ry * 0.35, -0.52, 0.52);
    } else if (brain.visList.length === 0) {
      targetHead = Math.sin(t * (1.2 + emo[6] * 0.9) + actor.id * 2.1) * (0.18 + 0.28 * emo[6]);
    }
    brain.headYaw = mix(brain.headYaw, targetHead, 1 - Math.exp(-8.5 * dt));

    // 2. Active IK gesture blend encoding (exact mirror of NV2.6 Force renderer protocol!)
    let gestureBlend = 0;
    if (brain.gesture !== FORCE_GESTURES.NONE && t < brain.gestureUntil) {
      const rem = brain.gestureUntil - t;
      const frac = clamp(1 - rem / Math.max(0.1, brain.gestureDur), 0, 1);
      gestureBlend = frac < 0.22 ? (frac / 0.22) : (frac > 0.72 ? (1 - frac) / 0.28 : 1.0);
    } else {
      brain.gesture = FORCE_GESTURES.NONE;
    }
    let gestureEncoded = 0;
    if (brain.gesture !== 0 && gestureBlend > 0.01) {
      const sgn = brain.gesture > 0 ? 1 : -1;
      gestureEncoded = sgn * ((Math.abs(brain.gesture) - 1) + clamp(gestureBlend, 0.001, 0.999));
    }

    // 3. Physiological breathing & cardiac pulse wave
    const tension = clamp(emo[1] * 0.55 + emo[4] * 0.25 + som[0] * 0.35, 0.05, 1.0);
    const breathHz = 0.24 + tension * 0.38;
    brain.breathPhase = (brain.breathPhase + dt * breathHz * Math.PI * 2) % (Math.PI * 2);
    const breathWave = Math.sin(brain.breathPhase) * (0.35 + tension * 0.65);

    if (!actor.expr) {
      actor.expr = {
        headYaw: 0, gesture: 0, gestureBlend: 0, gestureEncoded: 0,
        tension: 0.25, breathWave: 0, pulse: 0,
        speaking: false, startleArc: 0, syncRally: false, baitReady: false
      };
    }
    const ex = actor.expr;
    ex.headYaw = brain.headYaw;
    ex.gesture = brain.gesture;
    ex.gestureBlend = gestureBlend;
    ex.gestureEncoded = gestureEncoded;
    ex.tension = tension;
    ex.breathWave = breathWave;
    ex.pulse = som[0];
    ex.speaking = t < brain.speakUntil;
    ex.startleArc = t < brain.startleUntil ? clamp((brain.startleUntil - t) / 0.34, 0, 1) : 0;
    ex.syncRally = brain.intentIdx === 4 || brain.gesture === FORCE_GESTURES.WAVE_SWING;
    ex.baitReady = brain.intentIdx === 5 || brain.gesture === FORCE_GESTURES.HOLD_TRAP;
  }

  _execute360Hz(actor, brain, dt) {
    const eye = eyeOf(actor);
    const w = typeof this.match.weapon === 'function' ? this.match.weapon(actor) : (actor.weapon || {});
    const projSpd = Math.max(80, w.speed || 300);

    // 1. Human-bounded smooth aiming (ZERO aimbot snap! Cooperates with Lab Scherp AA when enabled)
    let desiredYaw = actor.yaw;
    let desiredPitch = clamp(brain.cmdPitchRes * 0.55, -MAX_PITCH, MAX_PITCH);
    let usingSlew = false;

    if (brain.cmdAimMode >= 1 && brain.cmdAimMode <= 4) {
      const v = brain.visList[brain.cmdAimMode - 1];
      if (v && v.o.alive && (v.o.shafferTimer || 0) <= 0) {
        const lt = clamp(v.hd / projSpd, 0, 0.45);
        const px = v.o.x + (v.o.vx || 0) * lt - actor.x;
        const py = v.tp[1] + (v.o.vy || 0) * lt * 0.5 - eye[1];
        const pz = v.o.z + (v.o.vz || 0) * lt - actor.z;
        desiredYaw = Math.atan2(px, -pz) + brain.cmdYawRes * VIS_RESIDUAL_YAW;
        desiredPitch = clamp(Math.atan2(py, Math.max(0.25, Math.hypot(px, pz))) + brain.cmdPitchRes * VIS_RESIDUAL_PITCH, -MAX_PITCH, MAX_PITCH);
        usingSlew = true;
      }
    } else if (brain.cmdAimMode >= 5 && brain.cmdAimMode <= 7) {
      const mem = brain.memList[brain.cmdAimMode - 5];
      if (mem) {
        const px = mem.x - actor.x;
        const py = mem.y - eye[1];
        const pz = mem.z - actor.z;
        desiredYaw = Math.atan2(px, -pz) + brain.cmdYawRes * MEM_RESIDUAL_YAW;
        desiredPitch = clamp(Math.atan2(py, Math.max(0.25, Math.hypot(px, pz))) + brain.cmdPitchRes * MEM_RESIDUAL_PITCH, -MAX_PITCH, MAX_PITCH);
        usingSlew = true;
      }
    } else if (brain.cmdAimMode === 8 && brain.ally0 && brain.ally0.alive && brain.visList.length === 0) {
      desiredYaw = Math.atan2(brain.ally0.x - actor.x, -(brain.ally0.z - actor.z));
      usingSlew = true;
    }

    const aa = actor.aa;
    const aaTracking = !!(aa?.locked && aa.level !== 'off' && aa.level !== '1.1');
    const scherpFireReady = !!(aa?.locked && aa.level === '1.5' && (aa.solveMode === 'direct' || aa.solveMode === 'pen' || aa.solveMode === 'bank'));

    if (!aaTracking) {
      if (usingSlew) {
        const dy = clamp(angleDiff(desiredYaw, actor.yaw), -MAX_TRACK_YAW_RATE * dt, MAX_TRACK_YAW_RATE * dt);
        actor.yaw = Math.atan2(Math.sin(actor.yaw + dy), Math.cos(actor.yaw + dy));
      } else {
        const fy = nonlinTurn(brain.cmdYawRes) * MAX_FREE_YAW_RATE * dt;
        actor.yaw = Math.atan2(Math.sin(actor.yaw + fy), Math.cos(actor.yaw + fy));
      }
      const dp = clamp(desiredPitch - (actor.pitch || 0), -MAX_TRACK_PITCH_RATE * dt, MAX_TRACK_PITCH_RATE * dt);
      actor.pitch = clamp((actor.pitch || 0) + dp, -MAX_PITCH, MAX_PITCH);
    }

    // 2. Smooth posture & fatigue-coupled kinematics (exact Match postureStep/vertical signatures!)
    const wantCrouch = brain.cmdCrouch && actor.onGround;
    const wantAds = usingSlew && !brain.cmdSprint;
    postureStep(actor, dt, wantCrouch, brain.cmdLean, wantAds);
    if (wantCrouch) this.metrics.crouch++;

    const sy = Math.sin(actor.yaw);
    const cy = Math.cos(actor.yaw);
    const norm = Math.max(1, Math.hypot(brain.cmdMoveFwd, brain.cmdMoveSide));
    const sprinting = brain.cmdSprint && !brain.cmdFire && (actor.crouch || 0) < 0.25;
    const fatSlow = 1 - 0.08 * brain.somatic[1];
    const spd = (sprinting ? SPRINT_SPEED : WALK_SPEED) * fatSlow * (1 - (actor.crouch || 0) * CROUCH_SPEED_LOSS) * (1 - (actor.aimPose || 0) * 0.14);
    const tvx = (cy * brain.cmdMoveSide + sy * brain.cmdMoveFwd) / norm * spd;
    const tvz = (sy * brain.cmdMoveSide - cy * brain.cmdMoveFwd) / norm * spd;
    const kv = actor.onGround ? (1 - Math.exp(-14 * dt)) : (1 - Math.exp(-4.5 * dt));
    actor.vx = (actor.vx || 0) + (tvx - (actor.vx || 0)) * kv;
    actor.vz = (actor.vz || 0) + (tvz - (actor.vz || 0)) * kv;

    const ox = actor.x, oz = actor.z;
    moveActor(actor, actor.vx * dt, actor.vz * dt);
    actor.stride = (actor.stride || 0) + Math.hypot(actor.x - ox, actor.z - oz);

    if (brain.jumpCd > 0) brain.jumpCd = Math.max(0, brain.jumpCd - dt);
    if (brain.cmdJump && actor.onGround && brain.jumpCd <= 0) {
      actor.vy = JUMP_VY;
      actor.onGround = false;
      brain.jumpCd = 0.75;
      brain.cmdJump = false;
      this.metrics.jump++;
    }
    vertical(actor, dt, floorAt, this.match.gravityScale || 1);

    // 3. Fire trigger (exact Match.trigger API!)
    if ((scherpFireReady || brain.cmdFire) && actor.mag > 0 && actor.reload <= 0 && actor.cooldown <= 1e-7 && !actor.burstLeft) {
      if (scherpFireReady && aa.solveMode === 'bank') actor._fermatAiShot = true;
      this.match.trigger(actor);
      actor._fermatAiShot = false;
      brain.lastFireAt = this.match.time;
    }

    // 4. Update 16-bone `actor.expr`
    this._updateExpr360Hz(actor, brain, dt);
  }

  tick(dt) {
    for (const actor of this.match.actors) {
      if (actor.human || !actor.alive) continue;
      if (this.teamFilter !== null && actor.team !== this.teamFilter) continue;
      let brain = this.brains.get(actor.id);
      if (!brain) {
        this.attach(actor);
        brain = this.brains.get(actor.id);
      }
      if (!brain) continue;

      brain.decisionTimer -= dt;
      if (brain.decisionTimer <= 0) {
        brain.decisionTimer += POLICY_DT;
        if (brain.decisionTimer < -POLICY_DT) brain.decisionTimer = 0;
        this._decide20Hz(actor, brain);
      }
      this._execute360Hz(actor, brain, dt);
    }
  }

  // ---- Engine Event Hooks (100% Fair-Play Sensory Feedback) ----
  learn() {}

  onHit(victim, owner, dir, power, shieldBreak) {
    const t = this.match.time;
    if (victim && !victim.human) {
      const vb = this.brains.get(victim.id);
      if (vb) {
        const surprise = (t - vb.underFireAt) > 1.8 && vb.visList.length === 0;
        vb.underFireAt = t;
        vb.recentDmg += Math.max(1, power || 6);
        if (dir) {
          vb.hitDirX = -dir[0];
          vb.hitDirZ = -dir[2];
        }
        if (surprise) {
          vb.emotions[1] = clamp(vb.emotions[1] + 0.25, 0, 1);
          vb.emotions[0] = clamp(vb.emotions[0] - 0.20, 0, 1);
          this._triggerGesture(vb, FORCE_GESTURES.STARTLE_JOLT, 0.34, t);
          this._emitVoiceSignal(victim, vb, 'STARTLE', t);
        }
      }
    }
    if (owner && !owner.human && owner.team !== victim?.team) {
      const ob = this.brains.get(owner.id);
      if (ob) {
        this.metrics.npcHits++;
        ob.emotions[3] = clamp(ob.emotions[3] + 0.08, 0, 1);
        if (shieldBreak) {
          ob.emotions[2] = clamp(ob.emotions[2] + 0.18, 0, 1);
          this._emitVoiceSignal(owner, ob, 'SHIELD_BREAK', t, victim?.x, victim?.z);
        }
      }
    }
  }

  onKill(killer, victim) {
    const t = this.match.time;
    if (killer && !killer.human) {
      const kb = this.brains.get(killer.id);
      if (kb) {
        kb.lastKillAt = t;
        kb.killStreak++;
        kb.deathStreak = 0;
        kb.emotions[7] = clamp(kb.emotions[7] + 0.45, 0, 1);
        kb.emotions[4] = clamp(kb.emotions[4] - 0.35, 0, 1);
      }
    }
    if (victim && !victim.human) {
      const vb = this.brains.get(victim.id);
      if (vb) {
        vb.deathStreak++;
        vb.killStreak = 0;
        vb.h.fill(0);
        vb.memories.length = 0;
        vb.recentDmg = 0;
        this._emitVoiceSignal(victim, vb, 'MAN_DOWN', t);
      }
    }
  }

  onReload(actor) {
    const t = this.match.time;
    if (!actor || actor.human) return;
    const b = this.brains.get(actor.id);
    if (b && b.visList.length > 0) {
      this._emitVoiceSignal(actor, b, 'TRADE_REQUEST', t);
    }
  }

  onTanker() {}

  onShotFired(shooter) {
    if (!shooter || (shooter.shafferTimer || 0) > 0) return;
    if (!shooter.human && this.brains.has(shooter.id)) this.metrics.npcShots++;
    const t = this.match.time;
    for (const [id, b] of this.brains) {
      const a = this.match.actors[id];
      if (!a || !a.alive || a.team === shooter.team) continue;
      const d = Math.hypot(shooter.x - a.x, shooter.z - a.z);
      if (d < MAX_ACOUSTIC_RANGE) {
        const jitter = clamp(d * 0.07, 1.0, 4.5);
        this._pushMemory(b, shooter.x + (b.rng() - 0.5) * jitter, shooter.y + 1.2, shooter.z + (b.rng() - 0.5) * jitter, t, 2);
      }
    }
  }

  onBulletWhiz(victim, shot) {
    if (!victim || victim.human) return;
    const b = this.brains.get(victim.id);
    if (!b) return;
    b.underFireAt = this.match.time;
    b.emotions[1] = clamp(b.emotions[1] + 0.08, 0, 1);
    if (shot?.dir) {
      b.hitDirX = -shot.dir[0];
      b.hitDirZ = -shot.dir[2];
    }
  }

  onEchoArrival(rep) {
    if (!rep) return;
    const src = rep.sourceActor;
    if (src && (src.shafferTimer || 0) > 0 && rep.kind !== 'ricochet' && rep.kind !== 'penetrate') return;
    const b = this.brains.get(rep.listenerId);
    const pos = rep.perceivedPos || rep.apparentPos;
    if (!b || !pos) return;
    this._pushMemory(b, pos[0], Math.max(1.1, pos[1] || 1.2), pos[2], this.match.time, 2);
  }

  onShafferCloak(cloakedActor) {
    if (!cloakedActor) return;
    // Immediately purge visual contact upon Shaffer activation — 100% Fair-Play!
    for (const [id, b] of this.brains) {
      const a = this.match.actors[id];
      if (!a || a.team === cloakedActor.team) continue;
      b.visList = b.visList.filter(v => v.o.id !== cloakedActor.id);
      b.lastSeenMap.delete(cloakedActor.id);
      if (b.targetId === cloakedActor.id) {
        b.targetId = -1;
        b.seen = null;
      }
    }
  }

  onMatchEnd() {}

  issuePlayerSquadOrder(kind, playerActor) {
    const t = this.match.time;
    const team = playerActor?.team ?? 0;
    let ack = null;
    for (const [id, b] of this.brains) {
      const a = this.match.actors[id];
      if (!a || !a.alive || a.team !== team) continue;
      b.playerOrder = kind;
      b.playerOrderUntil = t + 7.5;
      b.emotions[5] = clamp(b.emotions[5] + 0.16, 0, 1);
      if (!ack) {
        ack = a.name;
        const sigKind = kind === 'SWING' ? 'SWING_NOW' : (kind === 'TRAP' ? 'BAIT_READY' : 'CONTACT');
        this._triggerGesture(b, kind === 'SWING' ? FORCE_GESTURES.WAVE_SWING : FORCE_GESTURES.HOLD_TRAP, 0.78, t);
        this._emitVoiceSignal(a, b, sigKind, t);
      }
    }
    this.metrics.commanderOrders++;
    return ack;
  }
}
