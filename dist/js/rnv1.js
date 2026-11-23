// ============================================================================
// RNV1 — Result Reinforcement Neural V1 (360Hz Fair-Play Browser Runtime)
// ============================================================================
// Pure zero-dependency Float32Array neural policy runtime matching the PyTorch
// A100 GPU Training Studio (`training/rnv1_studio/model.py` & `env_gpu.py`)
// bit-for-bit:
//   - 100% Fair-Play 144-dim egocentric observation (ZERO wallhack, ZERO Shaffer leak)
//   - Recurrent Residual Policy Net: Linear(144->H) + LN + SiLU -> ResBlock(H)
//     -> GRUCell(H->H) -> Hybrid Tactical Heads (Continuous + Aim-Pointer + Binary + Util)
//   - 20 Hz neural decision cadence with smooth 360 Hz motor & posture execution
//   - Row-wise Int8 (q8) & Float32 (f32) weight bundle loader with strict validation
//   - localStorage persistence (`result.rnv1.weights.v1`) + auto-fetch `./assets/rnv1-weights.json`
// ============================================================================

import {clamp, mix, angleDiff, random, dot} from './geometry.js';
import {
  FIELD, walkable, obstruction, raycastMaterial, clearOpticalPath, moveActor, floorAt
} from './yard.js';
import {eyeOf, targetPoint, postureStep, vertical} from './posture.js';
import {RNV1_BUNDLED_WEIGHTS} from './rnv1-weights.js';

export const RNV1_VERSION = 'RNV1';
export const RNV1_SCHEMA = 1;
export const RNV1_OBS_DIM = 144;
export const RNV1_STORAGE_KEY = 'result.rnv1.weights.v1';

// Canonical kinematics & perception constants (exact mirror of training/rnv1_studio/spec.py)
const POLICY_DT = 1 / 20; // 0.05 s (20 Hz neural decision tick)
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
const RADIO_DELAY = 0.25;
const INCOMING_RANGE = 24.0;
const INCOMING_MIN_AGE = 0.03;
const LIDAR_MAX_DIST = 25.0;

const DEG2RAD = Math.PI / 180;
const LIDAR_CHEST_RAD = [0, 20, -20, 45, -45, 75, -75, 110, -110, 145, -145, 180].map(d => d * DEG2RAD);
const LIDAR_LOW_RAD = [0, 25, -25, 55, -55, 180].map(d => d * DEG2RAD);
const LIDAR_MAT_RAD = [0, 15, -15, 35].map(d => d * DEG2RAD);

const REQUIRED_TENSORS = [
  'enc_fc.weight', 'enc_fc.bias', 'enc_ln.weight', 'enc_ln.bias',
  'res_fc.weight', 'res_fc.bias', 'res_ln.weight', 'res_ln.bias',
  'gru.weight_ih', 'gru.weight_hh', 'gru.bias_ih', 'gru.bias_hh',
  'head_cont.weight', 'head_cont.bias',
  'head_aim.weight', 'head_aim.bias',
  'head_bin.weight', 'head_bin.bias',
  'head_util.weight', 'head_util.bias'
];

const sigmoid = x => 1 / (1 + Math.exp(-clamp(x, -16, 16)));
const silu = x => x / (1 + Math.exp(-clamp(x, -16, 16)));
const nonlinTurn = u => Math.sign(u) * (0.25 * Math.abs(u) + 0.75 * u * u);

// Cross-environment Base64 -> Uint8Array decoder (Browser + Node.js)
function base64ToBytes(b64) {
  if (typeof b64 !== 'string' || !b64.length) {
    throw new Error('RNV1 weight tensor missing base64 data');
  }
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
  if (!spec || typeof spec !== 'object') throw new Error('Invalid tensor entry');
  const shape = spec.shape;
  if (!Array.isArray(shape) || shape.length !== expectedShape.length) {
    throw new Error(`Tensor shape mismatch: got ${JSON.stringify(shape)}, expected ${JSON.stringify(expectedShape)}`);
  }
  let size = 1;
  for (let i = 0; i < expectedShape.length; i++) {
    if (shape[i] !== expectedShape[i]) {
      throw new Error(`Tensor dim ${i} mismatch: got ${shape[i]}, expected ${expectedShape[i]}`);
    }
    size *= expectedShape[i];
  }

  if (spec.dtype === 'f32') {
    const bytes = base64ToBytes(spec.data);
    if (bytes.byteLength !== size * 4) {
      throw new Error(`f32 byteLength mismatch: ${bytes.byteLength} vs ${size * 4}`);
    }
    const copy = bytes.slice().buffer;
    const arr = new Float32Array(copy);
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) throw new Error('Non-finite float in RNV1 weights');
    }
    return arr;
  }

  if (spec.dtype === 'q8') {
    if (expectedShape.length !== 2) throw new Error('q8 quantization only valid for 2D matrices');
    const [rows, cols] = expectedShape;
    const qBytes = base64ToBytes(spec.data);
    const sBytes = base64ToBytes(spec.scales);
    if (qBytes.byteLength !== rows * cols) {
      throw new Error(`q8 data length mismatch: ${qBytes.byteLength} vs ${rows * cols}`);
    }
    if (sBytes.byteLength !== rows * 4) {
      throw new Error(`q8 scales length mismatch: ${sBytes.byteLength} vs ${rows * 4}`);
    }
    const q = new Int8Array(qBytes.buffer, qBytes.byteOffset, qBytes.byteLength);
    const scales = new Float32Array(sBytes.slice().buffer);
    const out = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      const sc = scales[r];
      if (!Number.isFinite(sc)) throw new Error('Non-finite scale in RNV1 q8 weights');
      const off = r * cols;
      for (let c = 0; c < cols; c++) {
        out[off + c] = q[off + c] * sc;
      }
    }
    return out;
  }

  throw new Error(`Unsupported RNV1 tensor dtype: ${spec.dtype}`);
}

export function validateRNV1Bundle(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    return {ok: false, error: '重みデータがオブジェクトではありません'};
  }
  if (bundle.version !== RNV1_VERSION) {
    return {ok: false, error: `バージョン不一致 (${bundle.version} !== ${RNV1_VERSION})`};
  }
  if (bundle.schema !== RNV1_SCHEMA) {
    return {ok: false, error: `スキーマ不一致 (${bundle.schema} !== ${RNV1_SCHEMA})`};
  }
  const obsDim = Number(bundle.obsDim);
  const H = Number(bundle.hiddenDim);
  if (obsDim !== RNV1_OBS_DIM) {
    return {ok: false, error: `観測次元不一致 (${obsDim} !== ${RNV1_OBS_DIM})`};
  }
  if (!Number.isInteger(H) || H < 32 || H > 512) {
    return {ok: false, error: `不正な隠れ層サイズ (${H})`};
  }
  if (!bundle.tensors || typeof bundle.tensors !== 'object') {
    return {ok: false, error: 'tensors フィールドがありません'};
  }
  for (const name of REQUIRED_TENSORS) {
    if (!bundle.tensors[name]) return {ok: false, error: `必須テンソル欠損: ${name}`};
  }
  try {
    const net = new RNV1PolicyNet(bundle);
    return {ok: true, net};
  } catch (err) {
    return {ok: false, error: err?.message || String(err)};
  }
}

// ============================================================================
// RNV1PolicyNet — Zero-GC Float32Array Forward Pass (Bit-Exact to model.py)
// ============================================================================
export class RNV1PolicyNet {
  constructor(bundle) {
    this.obsDim = Number(bundle.obsDim);
    this.hiddenDim = Number(bundle.hiddenDim);
    this.meta = {...(bundle.meta || {})};
    const H = this.hiddenDim;
    const O = this.obsDim;
    const T = bundle.tensors;

    this.encW = decodeTensor(T['enc_fc.weight'], [H, O]);
    this.encB = decodeTensor(T['enc_fc.bias'], [H]);
    this.encLnG = decodeTensor(T['enc_ln.weight'], [H]);
    this.encLnB = decodeTensor(T['enc_ln.bias'], [H]);

    this.resW = decodeTensor(T['res_fc.weight'], [H, H]);
    this.resB = decodeTensor(T['res_fc.bias'], [H]);
    this.resLnG = decodeTensor(T['res_ln.weight'], [H]);
    this.resLnB = decodeTensor(T['res_ln.bias'], [H]);

    this.gruWih = decodeTensor(T['gru.weight_ih'], [3 * H, H]);
    this.gruWhh = decodeTensor(T['gru.weight_hh'], [3 * H, H]);
    this.gruBih = decodeTensor(T['gru.bias_ih'], [3 * H]);
    this.gruBhh = decodeTensor(T['gru.bias_hh'], [3 * H]);

    this.contW = decodeTensor(T['head_cont.weight'], [5, H]);
    this.contB = decodeTensor(T['head_cont.bias'], [5]);
    this.aimW = decodeTensor(T['head_aim.weight'], [6, H]);
    this.aimB = decodeTensor(T['head_aim.bias'], [6]);
    this.binW = decodeTensor(T['head_bin.weight'], [5, H]);
    this.binB = decodeTensor(T['head_bin.bias'], [5]);
    this.utilW = decodeTensor(T['head_util.weight'], [3, H]);
    this.utilB = decodeTensor(T['head_util.bias'], [3]);

    this.paramCount =
      this.encW.length + this.encB.length + this.encLnG.length + this.encLnB.length +
      this.resW.length + this.resB.length + this.resLnG.length + this.resLnB.length +
      this.gruWih.length + this.gruWhh.length + this.gruBih.length + this.gruBhh.length +
      this.contW.length + this.contB.length + this.aimW.length + this.aimB.length +
      this.binW.length + this.binB.length + this.utilW.length + this.utilB.length;

    // Pre-allocated zero-GC scratch buffers
    this._s1 = new Float32Array(H);
    this._s2 = new Float32Array(H);
    this._gi = new Float32Array(3 * H);
    this._gh = new Float32Array(3 * H);
    this._cont = new Float32Array(5);
    this._aim = new Float32Array(6);
    this._bin = new Float32Array(5);
    this._util = new Float32Array(3);
  }

  /** Exact mirror of RNV1Actor.encode_and_step(obs, h_prev). Mutates `hState` in-place. */
  forward(obs, hState) {
    const H = this.hiddenDim;
    const O = this.obsDim;
    const s1 = this._s1;
    const s2 = this._s2;

    // 1. x1 = silu(enc_ln(enc_fc(obs)))
    const encW = this.encW, encB = this.encB;
    let mean = 0;
    for (let r = 0; r < H; r++) {
      let acc = encB[r];
      const off = r * O;
      for (let c = 0; c < O; c++) acc += encW[off + c] * obs[c];
      s1[r] = acc;
      mean += acc;
    }
    mean /= H;
    let vSum = 0;
    for (let i = 0; i < H; i++) {
      const d = s1[i] - mean;
      vSum += d * d;
    }
    const invStd1 = 1 / Math.sqrt(vSum / H + 1e-5);
    const g1 = this.encLnG, b1 = this.encLnB;
    for (let i = 0; i < H; i++) {
      s1[i] = silu(((s1[i] - mean) * invStd1) * g1[i] + b1[i]);
    }

    // 2. x2 = x1 + silu(res_ln(res_fc(x1)))
    const resW = this.resW, resB = this.resB;
    mean = 0;
    for (let r = 0; r < H; r++) {
      let acc = resB[r];
      const off = r * H;
      for (let c = 0; c < H; c++) acc += resW[off + c] * s1[c];
      s2[r] = acc;
      mean += acc;
    }
    mean /= H;
    vSum = 0;
    for (let i = 0; i < H; i++) {
      const d = s2[i] - mean;
      vSum += d * d;
    }
    const invStd2 = 1 / Math.sqrt(vSum / H + 1e-5);
    const g2 = this.resLnG, b2 = this.resLnB;
    for (let i = 0; i < H; i++) {
      s2[i] = s1[i] + silu(((s2[i] - mean) * invStd2) * g2[i] + b2[i]);
    }

    // 3. PyTorch-exact GRUCell(x2, hState)
    const gi = this._gi, gh = this._gh;
    const Wih = this.gruWih, Whh = this.gruWhh, bih = this.gruBih, bhh = this.gruBhh;
    const H3 = 3 * H;
    for (let r = 0; r < H3; r++) {
      let ai = bih[r];
      let ah = bhh[r];
      const off = r * H;
      for (let c = 0; c < H; c++) {
        ai += Wih[off + c] * s2[c];
        ah += Whh[off + c] * hState[c];
      }
      gi[r] = ai;
      gh[r] = ah;
    }
    const H2 = 2 * H;
    for (let i = 0; i < H; i++) {
      const rGate = sigmoid(gi[i] + gh[i]);
      const zGate = sigmoid(gi[H + i] + gh[H + i]);
      const nGate = Math.tanh(gi[H2 + i] + rGate * gh[H2 + i]);
      hState[i] = (1 - zGate) * nGate + zGate * hState[i];
    }

    // 4. Policy heads
    const cont = this._cont, aim = this._aim, bin = this._bin, util = this._util;
    for (let r = 0; r < 5; r++) {
      let acc = this.contB[r];
      const off = r * H;
      for (let c = 0; c < H; c++) acc += this.contW[off + c] * hState[c];
      cont[r] = Math.tanh(acc);
    }
    for (let r = 0; r < 6; r++) {
      let acc = this.aimB[r];
      const off = r * H;
      for (let c = 0; c < H; c++) acc += this.aimW[off + c] * hState[c];
      aim[r] = acc;
    }
    for (let r = 0; r < 5; r++) {
      let acc = this.binB[r];
      const off = r * H;
      for (let c = 0; c < H; c++) acc += this.binW[off + c] * hState[c];
      bin[r] = acc;
    }
    for (let r = 0; r < 3; r++) {
      let acc = this.utilB[r];
      const off = r * H;
      for (let c = 0; c < H; c++) acc += this.utilW[off + c] * hState[c];
      util[r] = acc;
    }

    // Mask invalid visual/memory aim slots (identical to RNV1ActorCritic._mask_aim_logits)
    if (obs[59] <= 0.5) aim[1] = -1e4;
    if (obs[73] <= 0.5) aim[2] = -1e4;
    if (obs[87] <= 0.5) aim[3] = -1e4;
    if (obs[101] <= 0.5) aim[4] = -1e4;
    if (obs[110] <= 0.5) aim[5] = -1e4;

    return {cont, aim, bin, util};
  }
}

// ============================================================================
// Global Active RNV1 Weight Registry (localStorage -> fetched asset -> bundled)
// ============================================================================
let activeNet = null;
let activeSource = 'bootstrap';
let activeBundleRaw = null;
const weightListeners = new Set();

function notifyWeightChange() {
  const status = getRNV1Status();
  for (const fn of weightListeners) {
    try { fn(status); } catch {}
  }
}

function ensureActiveNet() {
  if (activeNet) return activeNet;
  // 1. Try persisted custom Colab-trained weights in localStorage
  try {
    const saved = globalThis.localStorage?.getItem(RNV1_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const res = validateRNV1Bundle(parsed);
      if (res.ok) {
        activeNet = res.net;
        activeBundleRaw = parsed;
        activeSource = 'imported';
        return activeNet;
      }
    }
  } catch {}
  // 2. Fallback to bundled starter weights
  const res = validateRNV1Bundle(RNV1_BUNDLED_WEIGHTS);
  if (res.ok) {
    activeNet = res.net;
    activeBundleRaw = RNV1_BUNDLED_WEIGHTS;
    activeSource = activeNet.meta?.trained ? 'bundled' : 'bootstrap';
    return activeNet;
  }
  throw new Error('Failed to initialize RNV1 weights: ' + res.error);
}

export function onRNV1WeightsChange(fn) {
  weightListeners.add(fn);
  return () => weightListeners.delete(fn);
}

export function getRNV1Status() {
  const net = ensureActiveNet();
  const m = net.meta || {};
  return {
    version: RNV1_VERSION,
    loaded: true,
    trained: !!m.trained,
    source: activeSource,
    origin: m.origin || 'bootstrap',
    preset: m.preset || '',
    steps: Number(m.steps || 0),
    evalWinRate: m.evalWinRate ?? null,
    evalKD: m.evalKD ?? null,
    trainKD: m.trainKD ?? null,
    paramCount: net.paramCount,
    hiddenDim: net.hiddenDim,
    autoActivate: !!m.autoActivate,
    exportedAt: m.exportedAt || null
  };
}

export function setRNV1Weights(bundle, {persist = true, source = 'imported'} = {}) {
  const res = validateRNV1Bundle(bundle);
  if (!res.ok) return {ok: false, error: res.error};
  activeNet = res.net;
  activeBundleRaw = bundle;
  activeSource = source;
  if (persist) {
    try {
      globalThis.localStorage?.setItem(RNV1_STORAGE_KEY, JSON.stringify(bundle));
    } catch {}
  }
  notifyWeightChange();
  return {ok: true, status: getRNV1Status()};
}

export function importRNV1WeightsJSON(jsonText, opts = {}) {
  try {
    const parsed = JSON.parse(jsonText);
    return setRNV1Weights(parsed, {persist: opts.persist !== false, source: opts.source || 'imported'});
  } catch (err) {
    return {ok: false, error: 'JSON解析エラー: ' + (err?.message || String(err))};
  }
}

export function resetRNV1Weights() {
  try { globalThis.localStorage?.removeItem(RNV1_STORAGE_KEY); } catch {}
  activeNet = null;
  activeBundleRaw = null;
  activeSource = 'bootstrap';
  ensureActiveNet();
  notifyWeightChange();
  return getRNV1Status();
}

/** Auto-loads `./assets/rnv1-weights.json` if user committed Colab weights into dist/assets/. */
export async function preloadBundledRNV1Weights(url = './assets/rnv1-weights.json') {
  ensureActiveNet();
  if (activeSource === 'imported' && activeNet?.meta?.trained) return getRNV1Status();
  if (typeof fetch !== 'function') return getRNV1Status();
  try {
    const resp = await fetch(url, {cache: 'no-cache'});
    if (!resp.ok) return getRNV1Status();
    const json = await resp.json();
    const res = setRNV1Weights(json, {persist: false, source: 'asset'});
    return res.ok ? res.status : getRNV1Status();
  } catch {
    return getRNV1Status();
  }
}

// ============================================================================
// Exact Fair-Play Horizontal Lidar & Observation Builder (144 dims)
// ============================================================================
function castHorizontalRay(ox, oy, oz, yaw, maxDist) {
  const dx = Math.sin(yaw);
  const dz = -Math.cos(yaw);
  // Clip to wharf bounds first
  let boundT = maxDist;
  if (Math.abs(dx) > 1e-6) {
    const tx = (dx > 0 ? FIELD.width / 2 - ox : -FIELD.width / 2 - ox) / dx;
    if (tx >= 0 && tx < boundT) boundT = tx;
  }
  if (Math.abs(dz) > 1e-6) {
    const tz = (dz > 0 ? FIELD.length / 2 - oz : -FIELD.length / 2 - oz) / dz;
    if (tz >= 0 && tz < boundT) boundT = tz;
  }
  const b = [ox + dx * boundT, oy, oz + dz * boundT];
  const hit = raycastMaterial([ox, oy, oz], b);
  if (hit && hit.t <= 1) {
    return {dist: hit.t * boundT, mat: hit.mat || 'steel'};
  }
  return {dist: boundT, mat: 'none'};
}

function recordContactMemory(b, x, y, z, t, kind) {
  const m0 = b.mem[0];
  const far = !m0.kind || Math.hypot(x - m0.x, z - m0.z) > 6.5;
  if (far && m0.kind) {
    const m1 = b.mem[1];
    m1.x = m0.x; m1.y = m0.y; m1.z = m0.z; m1.t = m0.t; m1.kind = m0.kind;
  }
  m0.x = x; m0.y = y; m0.z = z; m0.t = t; m0.kind = kind;
}

export function buildRNV1Observation(match, a, b, outObs) {
  const obs = outObs || b.obs;
  obs.fill(0);
  const t = match.time;
  const w = match.weapon(a);
  const eye = eyeOf(a);
  const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
  const localFwd = (a.vx || 0) * sy - (a.vz || 0) * cy;
  const localSide = (a.vx || 0) * cy + (a.vz || 0) * sy;
  const maxHp = a.maxHp || match.hpMax || 100;

  // ---- Block A: Ego Kinematics, Vitals & Weapon (0..34) ----
  obs[0] = clamp(a.x / 25.0, -1, 1);
  obs[1] = clamp(a.z / 100.0, -1, 1);
  obs[2] = clamp(a.y / 3.0, 0, 1.5);
  obs[3] = a.team === 0 ? 1.0 : -1.0;
  obs[4] = sy;
  obs[5] = cy;
  obs[6] = clamp(a.pitch / 1.2, -1, 1);
  obs[7] = clamp(localFwd / 6.75, -1, 1);
  obs[8] = clamp(localSide / 6.75, -1, 1);
  obs[9] = clamp((a.vy || 0) / 6.5, -1, 1);
  obs[10] = clamp(a.crouch || 0, 0, 1);
  obs[11] = clamp((a.lean || 0) / 0.32, -1, 1);
  obs[12] = a.onGround ? 1.0 : 0.0;
  obs[13] = clamp(a.aimPose || 0, 0, 1);
  obs[14] = clamp(a.hp / maxHp, 0, 1);
  obs[15] = clamp((a.shield || 0) / 25.0, 0, 1);
  obs[16] = clamp((a.baizerShield || 0) / 100.0, 0, 1);
  obs[17] = clamp(a.mag / (w.capacity || 10), 0, 1);
  obs[18] = clamp((a.stock || 0) / 300.0, 0, 1);
  obs[19] = a.reload > 0 ? clamp(a.reload / (w.reload || 1.5), 0, 1) : 0.0;
  obs[20] = a.cooldown > 0 ? clamp(a.cooldown / (w.interval || 0.24), 0, 1) : 0.0;

  obs[21] = (w.damage || 6) / 10.0;
  obs[22] = (w.speed || 360) / 650.0;
  obs[23] = (w.interval || 0.24) / 0.30;
  obs[24] = (w.burst || 1) / 3.0;
  obs[25] = (w.pellets || 1) / 4.0;
  obs[26] = w.auto ? 1.0 : 0.0;
  obs[27] = (w.stockRegen || 1.0) / 4.0;

  obs[28] = a.shafferTimer > 0 ? clamp(a.shafferTimer / 12.0, 0, 1) : 0.0;
  obs[29] = (a.smokeCooldown || 0) <= 0.01 ? 1.0 : 0.0;
  obs[30] = clamp((a.skillCharges || 0) / 3.0, 0, 1);
  obs[31] = a.assignedSkill === 'heal' ? 1.0 : a.assignedSkill === 'shaffer' ? -1.0 : 0.0;
  const ufDecay = clamp(1.0 - (t - b.underFireAt) / 2.5, 0, 1);
  obs[32] = ufDecay;
  obs[33] = (b.hitDirX * cy + b.hitDirZ * sy) * ufDecay;
  obs[34] = (b.hitDirX * sy - b.hitDirZ * cy) * ufDecay;

  // ---- Block B: Egocentric Spatial & Cover Lidar (35..58) ----
  let minChest = LIDAR_MAX_DIST;
  for (let i = 0; i < 12; i++) {
    const r = castHorizontalRay(a.x, a.y + 1.25, a.z, a.yaw + LIDAR_CHEST_RAD[i], LIDAR_MAX_DIST);
    if (r.dist < minChest) minChest = r.dist;
    obs[35 + i] = clamp(r.dist / LIDAR_MAX_DIST, 0, 1);
  }
  for (let i = 0; i < 6; i++) {
    const ang = a.yaw + LIDAR_LOW_RAD[i];
    const lo = castHorizontalRay(a.x, a.y + 0.55, a.z, ang, LIDAR_MAX_DIST);
    const hi = castHorizontalRay(a.x, a.y + 1.45, a.z, ang, LIDAR_MAX_DIST);
    obs[47 + i] = clamp((hi.dist - lo.dist) / LIDAR_MAX_DIST, 0, 1);
  }
  let fwdMatWood = false;
  for (let i = 0; i < 4; i++) {
    const r = castHorizontalRay(a.x, a.y + 1.25, a.z, a.yaw + LIDAR_MAT_RAD[i], LIDAR_MAX_DIST);
    obs[53 + i] = r.mat === 'wood' ? 1.0 : r.mat === 'steel' ? -1.0 : 0.0;
    if (i === 0 && r.mat === 'wood') fwdMatWood = true;
  }
  obs[57] = minChest < 2.4 ? 1.0 : 0.0;
  obs[58] = clamp(a.y / 2.62, 0, 1);

  // ---- Block C: Fair-Play Visible Enemies (59..100, Top 3 x 14) ----
  const visList = b.visList;
  visList.length = 0;
  for (let i = 0; i < match.actors.length; i++) {
    const e = match.actors[i];
    if (!e.alive || e.team === a.team || (e.shafferTimer || 0) > 0) continue;
    const dx = e.x - a.x, dz = e.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist > MAX_VISION_RANGE) continue;
    const bearing = Math.atan2(dx, -dz);
    const relYaw = angleDiff(bearing, a.yaw);
    const prevSeenAt = b.lastSeenById.get(e.id) ?? -10;
    const fovLim = (t - prevSeenAt < 1.2) ? TRACK_FOV_HALF : NORMAL_FOV_HALF;
    if (dist > PROXIMITY_SENSE_RANGE && Math.abs(relYaw) > fovLim) continue;
    const tp = targetPoint(e);
    if (!clearOpticalPath(eye, tp, match.aeroVortex)) continue;
    b.lastSeenById.set(e.id, t);
    const eMaxHp = e.maxHp || match.hpMax || 100;
    const prio = dist * (0.65 + 0.35 * (e.hp / eMaxHp));
    visList.push({e, tp, dx, dz, dist: Math.max(1e-4, dist), relYaw, prio});
  }
  visList.sort((u, v) => u.prio - v.prio);

  b.visTargets.length = 0;
  const nVis = Math.min(3, visList.length);
  for (let k = 0; k < nVis; k++) {
    const item = visList[k];
    const {e, tp, dx, dz, dist, relYaw} = item;
    b.visTargets.push({
      id: e.id, x: e.x, y: tp[1], z: e.z,
      vx: e.vx || 0, vy: e.vy || 0, vz: e.vz || 0, dist
    });
    const relPitch = Math.atan2(tp[1] - eye[1], dist) - a.pitch;
    const relVxLoc = (e.vx || 0) * cy + (e.vz || 0) * sy;
    const relVzLoc = (e.vx || 0) * sy - (e.vz || 0) * cy;
    const eFace = (Math.sin(e.yaw) * (-dx) - Math.cos(e.yaw) * (-dz)) / dist;
    const base = 59 + k * 14;
    obs[base + 0] = 1.0;
    obs[base + 1] = Math.sin(relYaw);
    obs[base + 2] = Math.cos(relYaw);
    obs[base + 3] = clamp(relPitch / 1.2, -1, 1);
    obs[base + 4] = clamp(dist / MAX_VISION_RANGE, 0, 1);
    obs[base + 5] = 1.0 / (1.0 + dist / 12.0);
    obs[base + 6] = clamp(relVxLoc / 7.0, -1, 1);
    obs[base + 7] = clamp(relVzLoc / 7.0, -1, 1);
    obs[base + 8] = clamp(e.crouch || 0, 0, 1);
    obs[base + 9] = e.onGround ? 1.0 : 0.0;
    obs[base + 10] = clamp(eFace, -1, 1);
    obs[base + 11] = clamp(((e.shield || 0) + (e.baizerShield || 0)) / 125.0, 0, 1);
    obs[base + 12] = (e.flash || 0) > 0.005 ? 1.0 : 0.0;
    obs[base + 13] = (e.reload || 0) > 0 ? 1.0 : 0.0;
  }

  // Record primary visual sighting into fair-play memory & squad radio
  if (nVis > 0) {
    const p0 = b.visTargets[0];
    recordContactMemory(b, p0.x, p0.y, p0.z, t, 1);
    b.seen = {x: p0.x, y: p0.y, z: p0.z, vx: p0.vx, vz: p0.vz};
    b.seenAt = t;
    b.targetId = p0.id;
  } else {
    b.seen = null;
    b.targetId = -1;
  }

  // ---- Block D: Fair-Play Memory / Acoustic / Radio Contacts (101..118, 2 x 9) ----
  b.memTargets.length = 0;
  for (let m = 0; m < 2; m++) {
    const slot = b.mem[m];
    const age = t - slot.t;
    const ttl = slot.kind === 1 ? MEMORY_TTL : ACOUSTIC_TTL;
    if (!slot.kind || age < 0 || age >= ttl) {
      b.memTargets.push(null);
      continue;
    }
    const mdx = slot.x - a.x, mdz = slot.z - a.z;
    const mdist = Math.hypot(mdx, mdz);
    const dupVis = nVis > 0 && Math.hypot(slot.x - b.visTargets[0].x, slot.z - b.visTargets[0].z) < 3.0;
    if (mdist <= 1.0 || dupVis) {
      b.memTargets.push(null);
      continue;
    }
    b.memTargets.push({x: slot.x, y: slot.y, z: slot.z, dist: mdist});
    const mry = angleDiff(Math.atan2(mdx, -mdz), a.yaw);
    const base = 101 + m * 9;
    obs[base + 0] = 1.0;
    obs[base + 1] = Math.sin(mry);
    obs[base + 2] = Math.cos(mry);
    obs[base + 3] = clamp(mdist / MAX_VISION_RANGE, 0, 1);
    obs[base + 4] = clamp(1.0 - age / MEMORY_TTL, 0, 1);
    obs[base + 5] = slot.kind === 1 ? 1.0 : 0.0;
    obs[base + 6] = slot.kind === 2 ? 1.0 : 0.0;
    obs[base + 7] = slot.kind === 3 ? 1.0 : 0.0;
    obs[base + 8] = (fwdMatWood && Math.abs(mry) < 0.35) ? 1.0 : 0.0;
  }

  // ---- Block E: Teammates, BAIZER, Tankers, Incoming Threat, Match Context (119..143) ----
  const allies = b.allyList;
  allies.length = 0;
  let aliveAllies = 0, aliveEnemies = 0;
  for (let i = 0; i < match.actors.length; i++) {
    const o = match.actors[i];
    if (!o.alive) continue;
    if (o.team === a.team) {
      aliveAllies++;
      if (o.id !== a.id) {
        allies.push({o, dist: Math.hypot(o.x - a.x, o.z - a.z)});
      }
    } else {
      aliveEnemies++;
    }
  }
  allies.sort((u, v) => u.dist - v.dist);
  const nAl = Math.min(2, allies.length);
  for (let j = 0; j < nAl; j++) {
    const {o, dist} = allies[j];
    const ary = angleDiff(Math.atan2(o.x - a.x, -(o.z - a.z)), a.yaw);
    const oMaxHp = o.maxHp || match.hpMax || 100;
    const base = 119 + j * 6;
    obs[base + 0] = 1.0;
    obs[base + 1] = Math.sin(ary);
    obs[base + 2] = Math.cos(ary);
    obs[base + 3] = clamp(dist / 80.0, 0, 1);
    obs[base + 4] = clamp(o.hp / oMaxHp, 0, 1);
    obs[base + 5] = ((o.flash || 0) > 0.005 || (o.hitFlash || 0) > 0.05) ? 1.0 : 0.0;
  }

  // Nearest ready BAIZER (131..134)
  if ((a.baizerShield || 0) < 100 && match.baizers) {
    let bestBz = null, bestD = Infinity;
    for (let i = 0; i < match.baizers.length; i++) {
      const bz = match.baizers[i];
      if (bz.cooldown > 0) continue;
      const d = Math.hypot(bz.x - a.x, bz.z - a.z);
      if (d < bestD) { bestD = d; bestBz = bz; }
    }
    if (bestBz) {
      const ry = angleDiff(Math.atan2(bestBz.x - a.x, -(bestBz.z - a.z)), a.yaw);
      obs[131] = 1.0;
      obs[132] = Math.sin(ry);
      obs[133] = Math.cos(ry);
      obs[134] = clamp(bestD / 60.0, 0, 1);
    }
  }

  // Nearest ready Tanker (135..138)
  if (match.tankers) {
    let bestTk = null, bestD = Infinity;
    for (let i = 0; i < match.tankers.length; i++) {
      const tk = match.tankers[i];
      if (tk.cooldown > 0) continue;
      const d = Math.hypot(tk.x - a.x, tk.z - a.z);
      if (d < bestD) { bestD = d; bestTk = tk; }
    }
    if (bestTk) {
      const ry = angleDiff(Math.atan2(bestTk.x - a.x, -(bestTk.z - a.z)), a.yaw);
      obs[135] = 1.0;
      obs[136] = Math.sin(ry);
      obs[137] = Math.cos(ry);
      obs[138] = clamp(bestD / 80.0, 0, 1);
    }
  }

  // Fair-Play Visible Incoming Projectile Warning (139..141)
  let bestInc = null, bestIncD = INCOMING_RANGE;
  for (let i = 0; i < match.shots.length; i++) {
    const s = match.shots[i];
    if (s.team === a.team || s.shafferCloaked || (s.age || 0) < INCOMING_MIN_AGE) continue;
    const sdx = a.x - s.p[0], sdz = a.z - s.p[2];
    const sd = Math.hypot(sdx, sdz);
    if (sd < 1.5 || sd >= bestIncD) continue;
    const proj = sdx * s.dir[0] + sdz * s.dir[2];
    if (proj <= 0) continue;
    const perp = Math.abs(sdx * s.dir[2] - sdz * s.dir[0]);
    if (perp >= 2.1) continue;
    if (obstruction(s.p, eye) <= 1) continue;
    bestIncD = sd;
    bestInc = s;
  }
  if (bestInc) {
    const svx = bestInc.dir[0], svz = bestInc.dir[2];
    const sideSign = ((a.x - bestInc.p[0]) * svz - (a.z - bestInc.p[2]) * svx) >= 0 ? 1 : -1;
    const escX = svz * sideSign, escZ = -svx * sideSign;
    obs[139] = 1.0;
    obs[140] = escX * cy + escZ * sy;
    obs[141] = escX * sy - escZ * cy;
  }

  // Match & Squad Balance (142..143)
  const myScore = match.scores[a.team] || 0;
  const enScore = match.scores[1 - a.team] || 0;
  obs[142] = clamp((aliveAllies - aliveEnemies) / 5.0, -1, 1);
  obs[143] = clamp((myScore - enScore) / 10.0, -1, 1);

  return obs;
}

// Lightweight fair-play fallback action mixer ONLY used while running untrained bootstrap weights
function computeBootstrapPolicy(obs, rng) {
  const hasV0 = obs[59] > 0.5;
  const v0Sin = obs[60], v0Cos = obs[61], v0Dist = obs[63] * 92.0;
  const hasM0 = obs[101] > 0.5;
  const m0Sin = obs[102];
  const hp = obs[14], mag = obs[17];
  const lidarF = obs[35], lidarR = obs[36], lidarL = obs[37];
  const hasInc = obs[139] > 0.5, incSide = obs[140];
  const hasBz = obs[131] > 0.5, bzSin = obs[132], bzD = obs[134] * 60.0;

  const aimMode = hasV0 ? 1 : hasM0 ? 4 : 0;
  const steerOpen = lidarF < 0.22 ? (lidarR > lidarL ? 0.85 : -0.85) : (lidarR - lidarL) * 0.7;
  const goBz = !hasV0 && !hasM0 && hasBz && bzD < 22.0;
  const j = (rng() - 0.5) * 2;
  const strafe = hasInc ? incSide : (j >= 0 ? 1 : -1);

  const cmdFwd = hasV0
    ? (hp < 0.35 ? -0.85 : v0Dist > 26 ? 0.75 : v0Dist < 9 ? -0.55 : 0.1)
    : (lidarF < 0.14 ? -0.45 : 0.92);
  const cmdSide = hasV0 ? strafe * 0.78 : (goBz ? bzSin * 0.65 : steerOpen * 0.55);
  const cmdYaw = hasV0 ? j * 0.08 : hasM0 ? clamp(m0Sin * 1.4, -1, 1) : goBz ? clamp(bzSin * 1.3, -1, 1) : steerOpen;
  const cmdLean = hasV0 ? strafe * 0.55 : 0;

  return {
    cmdFwd, cmdSide, cmdYaw, cmdPitch: 0, cmdLean, aimMode,
    wantFire: hasV0 && v0Cos > 0.95 && Math.abs(v0Sin) < 0.25,
    wantSprint: !hasV0 && lidarF > 0.24,
    wantCrouch: (hasV0 && hp < 0.55) || hasInc,
    wantJump: !hasV0 && lidarF < 0.12 && obs[47] > 0.18,
    wantReload: !hasV0 && mag < 0.35,
    utilMode: (obs[30] > 0.1 && (hp < 0.55 || hasV0)) ? 2 : (obs[29] > 0.5 && hp < 0.45 && obs[32] > 0.4) ? 1 : 0
  };
}

// ============================================================================
// RNV1 Engine Class (Full Match AI Interface, 360Hz Native)
// ============================================================================
export class RNV1 {
  constructor(match) {
    this.match = match;
    this.version = RNV1_VERSION;
    this.net = ensureActiveNet();
    this.brains = new Map();
    this.teamFilter = null;
    this.metrics = {
      crouch: 0, jump: 0, scope: 0, peek: 0, intuition: 0, learning: 0,
      cover: 0, flank: 0, disengage: 0, ambush: 0, resupply: 0, evade: 0, focusFire: 0,
      beliefTrack: 0, commanderOrders: 0, suppress: 0, crossfire: 0,
      neuralInferences: 0, neuralUpdates: 0, lookaheadPlans: 0, npcShots: 0, npcHits: 0,
      rnv1Inferences: 0, rnv1Smokes: 0, rnv1Skills: 0
    };
  }

  attach(actor) {
    this.net = ensureActiveNet();
    const rng = random(9101 + actor.id * 7919 + (actor.deaths || 0) * 251);
    const H = this.net.hiddenDim;
    const b = {
      rng,
      state: this.net.meta?.trained ? 'RNV1 戦術推論' : 'RNV1 初期推論',
      h: new Float32Array(H),
      obs: new Float32Array(RNV1_OBS_DIM),
      nextPolicyAt: this.match.time + rng() * POLICY_DT,
      jumpCd: 0,
      underFireAt: -10,
      hitDirX: 0,
      hitDirZ: 0,
      lastRadioAt: -10,
      targetId: -1,
      seen: null,
      seenAt: -10,
      lastSeenById: new Map(),
      visList: [],
      visTargets: [],
      memTargets: [],
      allyList: [],
      mem: [
        {x: 0, y: 1.2, z: 0, t: -20, kind: 0},
        {x: 0, y: 1.2, z: 0, t: -20, kind: 0}
      ],
      // Active 20Hz motor command held smoothly across 360Hz substeps
      cmdFwd: 0,
      cmdSide: 0,
      cmdYaw: 0,
      cmdPitch: 0,
      cmdLean: 0,
      aimMode: 0,
      wantFire: false,
      wantSprint: false,
      wantCrouch: false,
      wantJump: false,
      wantReload: false,
      utilMode: 0,
      desiredYaw: actor.yaw,
      desiredPitch: 0,
      usingTargetSlew: false,
      breathPhase: rng() * Math.PI * 2,
      headYaw: 0
    };
    this.brains.set(actor.id, b);
  }

  learn() {
    // RNV1 learns offline at massive scale on Colab Pro A100; runtime weights stay pure & deterministic.
  }

  onHit(v, owner, dir) {
    if (!v || v.human) return;
    const b = this.brains.get(v.id);
    if (!b) return;
    b.underFireAt = this.match.time;
    if (dir) {
      b.hitDirX = -dir[0];
      b.hitDirZ = -dir[2];
    }
    if (owner && !owner.human && owner.team !== v.team) {
      this.metrics.npcHits++;
    }
  }

  onKill() {}
  onReload() {}
  onTanker() {}

  onShotFired(actor) {
    if (!actor || (actor.shafferTimer || 0) > 0) return;
    if (!actor.human && this.brains.has(actor.id)) this.metrics.npcShots++;
    const t = this.match.time;
    for (const listener of this.match.actors) {
      if (!listener.alive || listener.human || listener.team === actor.team) continue;
      if (this.teamFilter != null && listener.team !== this.teamFilter) continue;
      const b = this.brains.get(listener.id);
      if (!b) continue;
      const d = Math.hypot(actor.x - listener.x, actor.z - listener.z);
      if (d < MAX_ACOUSTIC_RANGE) {
        const jx = (b.rng() - 0.5) * 5.0;
        const jz = (b.rng() - 0.5) * 5.0;
        recordContactMemory(b, actor.x + jx, actor.y + 1.2, actor.z + jz, t, 2);
      }
    }
  }

  onBulletWhiz(v, s) {
    if (!v || v.human || !s?.dir) return;
    const b = this.brains.get(v.id);
    if (!b) return;
    b.underFireAt = this.match.time;
    b.hitDirX = -s.dir[0];
    b.hitDirZ = -s.dir[2];
  }

  onEchoArrival(rep) {
    if (!rep) return;
    const listener = this.match.actors[rep.listenerId];
    if (!listener?.alive || listener.human) return;
    if (this.teamFilter != null && listener.team !== this.teamFilter) return;
    const src = rep.sourceActor;
    if (src && (src.shafferTimer || 0) > 0 && rep.kind !== 'ricochet' && rep.kind !== 'penetrate') return;
    const b = this.brains.get(listener.id);
    if (!b || !rep.perceivedPos) return;
    recordContactMemory(b, rep.perceivedPos[0], Math.max(1.1, rep.perceivedPos[1]), rep.perceivedPos[2], this.match.time, 2);
  }

  onShafferCloak(actor) {
    if (!actor) return;
    for (const [id, b] of this.brains) {
      const owner = this.match.actors[id];
      if (!owner || owner.team === actor.team) continue;
      if (b.targetId === actor.id) {
        b.targetId = -1;
        b.seen = null;
      }
      b.lastSeenById.delete(actor.id);
    }
  }

  onMatchEnd() {}
  issuePlayerSquadOrder() { return null; }

  _shareRadioContact(sender, b, target) {
    const t = this.match.time;
    if (t - b.lastRadioAt < RADIO_DELAY) return;
    b.lastRadioAt = t;
    for (const mate of this.match.actors) {
      if (!mate.alive || mate.human || mate.id === sender.id || mate.team !== sender.team) continue;
      const mb = this.brains.get(mate.id);
      if (!mb || mb.seen) continue;
      recordContactMemory(mb, target.x, target.y, target.z, t, 3);
    }
  }

  _decidePolicy(a, b) {
    const net = ensureActiveNet();
    if (net !== this.net) {
      this.net = net;
      if (b.h.length !== net.hiddenDim) b.h = new Float32Array(net.hiddenDim);
    }

    const obs = buildRNV1Observation(this.match, a, b, b.obs);
    const out = net.forward(obs, b.h);
    this.metrics.neuralInferences++;
    this.metrics.rnv1Inferences++;

    if (b.visTargets.length > 0) {
      this._shareRadioContact(a, b, b.visTargets[0]);
    }

    if (net.meta?.trained) {
      // 100% pure Colab A100 trained neural policy execution!
      b.cmdFwd = clamp(out.cont[0], -1, 1);
      b.cmdSide = clamp(out.cont[1], -1, 1);
      b.cmdYaw = clamp(out.cont[2], -1, 1);
      b.cmdPitch = clamp(out.cont[3], -1, 1);
      b.cmdLean = clamp(out.cont[4], -1, 1);

      let bestAim = 0, bestAimV = out.aim[0];
      for (let i = 1; i < 6; i++) {
        if (out.aim[i] > bestAimV) { bestAimV = out.aim[i]; bestAim = i; }
      }
      b.aimMode = bestAim;

      b.wantFire = out.bin[0] > 0.0;
      b.wantSprint = out.bin[1] > 0.0;
      b.wantCrouch = out.bin[2] > 0.0;
      b.wantJump = out.bin[3] > 0.0;
      b.wantReload = out.bin[4] > 0.0;

      let bestUtil = 0, bestUtilV = out.util[0];
      for (let i = 1; i < 3; i++) {
        if (out.util[i] > bestUtilV) { bestUtilV = out.util[i]; bestUtil = i; }
      }
      b.utilMode = bestUtil;
      b.state = b.visTargets.length ? 'RNV1 交戦' : b.memTargets[0] ? 'RNV1 索敵' : 'RNV1 展開';
    } else {
      // Bootstrap starter mode (before user imports A100-trained rnv1-weights.json):
      // Still runs full neural forward pass above, blended cleanly with starter policy so RNV1 fights coherently out-of-the-box.
      const bp = computeBootstrapPolicy(obs, b.rng);
      b.cmdFwd = clamp(bp.cmdFwd + out.cont[0] * 0.12, -1, 1);
      b.cmdSide = clamp(bp.cmdSide + out.cont[1] * 0.12, -1, 1);
      b.cmdYaw = clamp(bp.cmdYaw + out.cont[2] * 0.08, -1, 1);
      b.cmdPitch = clamp(bp.cmdPitch + out.cont[3] * 0.05, -1, 1);
      b.cmdLean = clamp(bp.cmdLean + out.cont[4] * 0.12, -1, 1);
      b.aimMode = bp.aimMode;
      b.wantFire = bp.wantFire;
      b.wantSprint = bp.wantSprint;
      b.wantCrouch = bp.wantCrouch;
      b.wantJump = bp.wantJump;
      b.wantReload = bp.wantReload;
      b.utilMode = bp.utilMode;
      b.state = b.visTargets.length ? 'RNV1(初期) 交戦' : 'RNV1(初期) 展開';
    }

    // Compute desired aim orientation from chosen aimMode (exact mirror of env_gpu.py)
    const eye = eyeOf(a);
    const w = this.match.weapon(a);
    b.usingTargetSlew = false;
    b.desiredYaw = a.yaw;
    b.desiredPitch = clamp(b.cmdPitch * 0.55, -MAX_PITCH, MAX_PITCH);

    if (b.aimMode >= 1 && b.aimMode <= 3) {
      const vt = b.visTargets[b.aimMode - 1];
      if (vt) {
        const leadT = clamp(vt.dist / (w.speed || 360), 0, 0.45);
        const px = vt.x + vt.vx * leadT - a.x;
        const py = vt.y + vt.vy * leadT * 0.5 - eye[1];
        const pz = vt.z + vt.vz * leadT - a.z;
        const baseY = Math.atan2(px, -pz);
        const baseP = Math.atan2(py, Math.max(0.25, Math.hypot(px, pz)));
        b.desiredYaw = baseY + b.cmdYaw * VIS_RESIDUAL_YAW;
        b.desiredPitch = clamp(baseP + b.cmdPitch * VIS_RESIDUAL_PITCH, -MAX_PITCH, MAX_PITCH);
        b.usingTargetSlew = true;
      }
    } else if (b.aimMode === 4 || b.aimMode === 5) {
      const mt = b.memTargets[b.aimMode - 4];
      if (mt) {
        const px = mt.x - a.x;
        const py = mt.y - eye[1];
        const pz = mt.z - a.z;
        const baseY = Math.atan2(px, -pz);
        const baseP = Math.atan2(py, Math.max(0.25, Math.hypot(px, pz)));
        b.desiredYaw = baseY + b.cmdYaw * MEM_RESIDUAL_YAW;
        b.desiredPitch = clamp(baseP + b.cmdPitch * MEM_RESIDUAL_PITCH, -MAX_PITCH, MAX_PITCH);
        b.usingTargetSlew = true;
      }
    }

    // Immediate tactical actions triggered on policy cadence
    if (b.utilMode === 1 && (a.smokeCooldown || 0) <= 0.01) {
      if (this.match.deploySmokeVent(a)) this.metrics.rnv1Smokes++;
    } else if (b.utilMode === 2 && this.match.lab?.npcSkills && (a.skillCharges || 0) > 0 && a.assignedSkill) {
      if (this.match.useSkill(a, a.assignedSkill)) this.metrics.rnv1Skills++;
    }
    if (b.wantReload && a.reload <= 0 && !a.burstLeft && a.mag < w.capacity && a.stock > 0) {
      this.match.reload(a);
    }
  }

  tick(dt) {
    const t = this.match.time;
    for (let i = 0; i < this.match.actors.length; i++) {
      const a = this.match.actors[i];
      if (!a.alive || a.human || (this.teamFilter != null && a.team !== this.teamFilter)) continue;
      let b = this.brains.get(a.id);
      if (!b) {
        this.attach(a);
        b = this.brains.get(a.id);
      }

      if (b.jumpCd > 0) b.jumpCd = Math.max(0, b.jumpCd - dt);

      // 20 Hz Neural Decision Cadence
      if (t >= b.nextPolicyAt) {
        this._decidePolicy(a, b);
        b.nextPolicyAt = t + POLICY_DT;
      }

      // 360 Hz Smooth Motor Execution (exact parity with env_gpu.py + match.js)
      const aa = a.aa;
      const aaTracking = !!(aa?.locked && aa.level !== 'off' && aa.level !== '1.1');
      const scherpFireReady = !!(aa?.locked && aa.level === '1.5' && (aa.solveMode === 'direct' || aa.solveMode === 'pen' || aa.solveMode === 'bank'));

      if (!aaTracking) {
        if (b.usingTargetSlew) {
          const maxDy = MAX_TRACK_YAW_RATE * dt;
          const maxDp = MAX_TRACK_PITCH_RATE * dt;
          a.yaw += clamp(angleDiff(b.desiredYaw, a.yaw), -maxDy, maxDy);
          a.pitch = clamp(a.pitch + clamp(b.desiredPitch - a.pitch, -maxDp, maxDp), -MAX_PITCH, MAX_PITCH);
        } else {
          a.yaw += nonlinTurn(b.cmdYaw) * MAX_FREE_YAW_RATE * dt;
          const maxDp = MAX_TRACK_PITCH_RATE * dt;
          a.pitch = clamp(a.pitch + clamp(b.desiredPitch - a.pitch, -maxDp, maxDp), -MAX_PITCH, MAX_PITCH);
        }
        a.yaw = Math.atan2(Math.sin(a.yaw), Math.cos(a.yaw));
      }

      const wantCrouch = b.wantCrouch && a.onGround;
      const wantAds = b.usingTargetSlew && !b.wantSprint;
      postureStep(a, dt, wantCrouch, b.cmdLean * 0.32, wantAds);

      // Kinematics & Harbor obstacle sliding
      const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
      const norm = Math.max(1, Math.hypot(b.cmdFwd, b.cmdSide));
      const sprinting = b.wantSprint && !b.wantFire && (a.crouch || 0) < 0.25;
      const spd = (sprinting ? SPRINT_SPEED : WALK_SPEED) * (1 - (a.crouch || 0) * CROUCH_SPEED_LOSS) * (1 - (a.aimPose || 0) * 0.14);
      const tvx = (cy * b.cmdSide + sy * b.cmdFwd) / norm * spd;
      const tvz = (sy * b.cmdSide - cy * b.cmdFwd) / norm * spd;
      const kV = 1 - Math.exp(-(a.onGround ? 14 : 4.5) * dt);
      a.vx += (tvx - a.vx) * kV;
      a.vz += (tvz - a.vz) * kV;

      const ox = a.x, oz = a.z;
      moveActor(a, a.vx * dt, a.vz * dt);
      a.stride += Math.hypot(a.x - ox, a.z - oz);

      if (b.wantJump && a.onGround && b.jumpCd <= 0) {
        a.vy = JUMP_VY;
        a.onGround = false;
        b.jumpCd = 0.75;
        b.wantJump = false;
        this.metrics.jump++;
      }
      vertical(a, dt, floorAt, this.match.gravityScale || 1);

      // Trigger execution (pure learned trigger discipline + Lab Scherp 1.5 cooperative fire)
      if ((scherpFireReady || b.wantFire) && a.mag > 0 && a.reload <= 0 && a.cooldown <= 1e-7 && !a.burstLeft) {
        if (scherpFireReady && aa.solveMode === 'bank') a._fermatAiShot = true;
        this.match.trigger(a);
        a._fermatAiShot = false;
      }

      // Expressive 16-bone GPU rig micro-signals (head-lead + cardiac breath)
      b.breathPhase = (b.breathPhase + dt * 2.1) % (Math.PI * 2);
      const tgtHead = b.usingTargetSlew ? clamp(angleDiff(b.desiredYaw, a.yaw) * 0.72, -0.78, 0.78) : 0;
      b.headYaw += (tgtHead - b.headYaw) * (1 - Math.exp(-14 * dt));
      a.expr = {
        headYaw: b.headYaw,
        gesture: 0,
        gestureBlend: 0,
        gestureEncoded: 0,
        tension: b.visTargets.length ? 0.65 : 0.25,
        breathWave: Math.sin(b.breathPhase) * 0.45,
        pulse: this.net.meta?.trained ? 0.35 : 0.12,
        speaking: false,
        startleArc: 0,
        syncRally: false,
        baitReady: false
      };
    }
  }
}
