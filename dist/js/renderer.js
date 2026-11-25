import {STRIDE, layers, Mesh, add, sub, scale, unit, cross, dot, multiply, invert4, lookAt, perspective, clamp, extractFrustum, aabbInFrustum, sphereInFrustum} from './geometry.js';
import {bodyCenter, torso} from './posture.js';
import {loadTextures, loadScenery, labelNames} from './materials.js';
import {buildHarbor} from './harbor.js';
import {character, viewModel, movingDetails, muzzleFlashMesh} from './models.js';
import {weapons, npcWeapons} from './match.js';
import * as shader from './shaders.js';
import {HDRDisplay} from './hdr.js';
import {ShadowFlame, shadowModes} from './shadowflame.js';
import {KHDRPipeline} from './khdr.js';
import {FluxGI} from './fluxgi.js';
import {SchlierenOptics} from './schlieren.js';
import {AERO_W, AERO_H} from './aerovortex.js';
import {THERMO_W, THERMO_H} from './thermoflux.js';
import {WATER_HEIGHT} from './yard.js';
import {RIG_BONE_COUNT, IDENTITY_PALETTE, solveCharacterPalette} from './rig.js';
import {HemoFluxGL} from './hemoflux.js';

const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export const sizes = {HD: [1280, 720], FHD: [1920, 1080], '2K': [2560, 1440]};
export const liteSizes = {HD: [854, 480], FHD: [960, 540], '2K': [1280, 720]};
export function effectiveSize(config) {
  const table = config?.lightMode ? liteSizes : sizes;
  return Object.hasOwn(table, config?.resolution) ? table[config.resolution] : table.HD;
}
export const qualityLevels = {standard: 0, high: 1, extra: 2};
export {shadowModes};

function program(gl, vs, fs) {
  const obj = gl.createProgram(), sh = [];
  for (const [type, code] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    gl.attachShader(obj, s);
    sh.push(s);
  }
  gl.linkProgram(obj);
  if (!gl.getProgramParameter(obj, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(obj));
  for (const s of sh) gl.deleteShader(s);
  const loc = {};
  for (let i = 0; i < gl.getProgramParameter(obj, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(obj, i).name;
    loc[name.replace('[0]', '')] = gl.getUniformLocation(obj, name);
  }
  return {obj, ...loc};
}

function bindAttribs(gl) {
  let offset = 0;
  for (let i = 0; i < 6; i++) {
    const n = i === 0 || i === 1 || i === 4 ? 3 : i === 2 ? 2 : 1;
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, n, gl.FLOAT, false, STRIDE * 4, offset * 4);
    offset += n;
  }
}

function gpuDynamicMesh(gl, initialFloats = 16384) {
  const vao = gl.createVertexArray(), buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, initialFloats * 4, gl.DYNAMIC_DRAW);
  bindAttribs(gl);
  gl.bindVertexArray(null);
  return {vao, buf, count: 0, capFloats: initialFloats, indexed: false, cull: false};
}

// Bit-exact vertex deduplication + degenerate triangle pruning + outward CCW Auto-Winding
function buildIndexedMesh(gl, rawData, triList = null, autoWind = true) {
  const f32 = rawData instanceof Float32Array ? rawData : new Float32Array(rawData || []);
  const totalVerts = (f32.length / STRIDE) | 0;
  const triCount = triList ? triList.length : (totalVerts / 3) | 0;
  if (triCount <= 0) {
    return {vao: null, buf: null, ibo: null, count: 0, indexType: gl.UNSIGNED_SHORT, indexed: true, cull: autoWind};
  }

  const i32 = new Int32Array(f32.buffer, f32.byteOffset, f32.length);
  const vMap = new Map();
  const uniqueVerts = [];
  const rawIdx = new Uint32Array(triCount * 3);
  let idxLen = 0;

  const getVert = (v) => {
    const b = v * STRIDE;
    const key =
      i32[b] + ',' + i32[b + 1] + ',' + i32[b + 2] + ',' +
      i32[b + 3] + ',' + i32[b + 4] + ',' + i32[b + 5] + ',' +
      i32[b + 6] + ',' + i32[b + 7] + ',' + i32[b + 8] + ',' +
      i32[b + 9] + ',' + i32[b + 10] + ',' + i32[b + 11] + ',' + i32[b + 12];
    let id = vMap.get(key);
    if (id === undefined) {
      id = uniqueVerts.length / STRIDE;
      vMap.set(key, id);
      for (let k = 0; k < STRIDE; k++) uniqueVerts.push(f32[b + k]);
    }
    return id;
  };

  for (let t = 0; t < triCount; t++) {
    const v0 = triList ? triList[t] : t * 3;
    const v1 = v0 + 1, v2 = v0 + 2;
    const a = v0 * STRIDE, b = v1 * STRIDE, c = v2 * STRIDE;
    const ux = f32[b] - f32[a], uy = f32[b + 1] - f32[a + 1], uz = f32[b + 2] - f32[a + 2];
    const vx = f32[c] - f32[a], vy = f32[c + 1] - f32[a + 1], vz = f32[c + 2] - f32[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-14) continue; // prune degenerate zero-area triangle

    const i0 = getVert(v0);
    let i1 = getVert(v1);
    let i2 = getVert(v2);
    if (autoWind) {
      const nx = f32[a + 3] + f32[b + 3] + f32[c + 3];
      const ny = f32[a + 4] + f32[b + 4] + f32[c + 4];
      const nz = f32[a + 5] + f32[b + 5] + f32[c + 5];
      if (cx * nx + cy * ny + cz * nz < 0) {
        const tmp = i1; i1 = i2; i2 = tmp;
      }
    }
    rawIdx[idxLen++] = i0;
    rawIdx[idxLen++] = i1;
    rawIdx[idxLen++] = i2;
  }

  const uCount = uniqueVerts.length / STRIDE;
  const use16 = uCount <= 65535;
  const idxBuf = use16 ? new Uint16Array(idxLen) : rawIdx.subarray(0, idxLen);
  if (use16) {
    for (let i = 0; i < idxLen; i++) idxBuf[i] = rawIdx[i];
  }

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  const ibo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uniqueVerts), gl.STATIC_DRAW);
  bindAttribs(gl);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxBuf, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return {
    vao,
    buf,
    ibo,
    count: idxLen,
    indexType: use16 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
    indexed: true,
    cull: autoWind
  };
}

// SpatialMesh-BVH + EarlyZ-SplitOpaque: Partitions static harbor into frustum-cullable, front-to-back sortable
// indexed CCW opaque chunks (zero discard -> 100% hardware Early-Z!), an unculled double-sided mountain bucket,
// and a tiny alpha-cutout label decal mesh (drawn with discard).
function partitionStaticMesh(gl, mesh) {
  const f32 = mesh.data instanceof Float32Array ? mesh.data : new Float32Array(mesh.data);
  const totalVerts = (f32.length / STRIDE) | 0;
  const buckets = new Map();
  const doubleSidedTris = [];
  const cutoutTris = [];
  const cutoutLayers = new Set();
  for (let i = 0; i < labelNames.length; i++) {
    const id = layers[labelNames[i]];
    if (id != null) cutoutLayers.add(id);
  }

  for (let v0 = 0; v0 < totalVerts; v0 += 3) {
    const a = v0 * STRIDE, b = (v0 + 1) * STRIDE, c = (v0 + 2) * STRIDE;
    const ux = f32[b] - f32[a], uy = f32[b + 1] - f32[a + 1], uz = f32[b + 2] - f32[a + 2];
    const vx = f32[c] - f32[a], vy = f32[c + 1] - f32[a + 1], vz = f32[c + 2] - f32[a + 2];
    const crx = uy * vz - uz * vy, cry = uz * vx - ux * vz, crz = ux * vy - uy * vx;
    const cr2 = crx * crx + cry * cry + crz * crz;
    if (cr2 < 1e-14) continue;

    if (cutoutLayers.has(Math.round(f32[a + 8]))) {
      cutoutTris.push(v0);
      continue;
    }

    const kind = f32[a + 12];
    const nx = f32[a + 3] + f32[b + 3] + f32[c + 3];
    const ny = f32[a + 4] + f32[b + 4] + f32[c + 4];
    const nz = f32[a + 5] + f32[b + 5] + f32[c + 5];
    const n2 = nx * nx + ny * ny + nz * nz;
    const dp = crx * nx + cry * ny + crz * nz;

    // Distant mountain ring (kind >= 4.5) or vertical quad with orthogonal baked normal -> keep unculled, non-shadow
    if (kind >= 4.5 || n2 < 1e-10 || (dp * dp) < 0.0025 * cr2 * n2) {
      doubleSidedTris.push(v0);
      continue;
    }

    const p0x = f32[a], p0y = f32[a + 1], p0z = f32[a + 2];
    const p1x = f32[b], p1y = f32[b + 1], p1z = f32[b + 2];
    const p2x = f32[c], p2y = f32[c + 1], p2z = f32[c + 2];
    const cx = (p0x + p1x + p2x) * (1 / 3);
    const cz = (p0z + p1z + p2z) * (1 / 3);

    let key;
    if (cx >= -28 && cx <= 28 && cz >= -106 && cz <= 106) {
      const gx = clamp(Math.floor(((cx + 28) / 56) * 3), 0, 2);
      const gz = clamp(Math.floor(((cz + 106) / 212) * 10), 0, 9);
      key = 'Y_' + gx + '_' + gz;
    } else {
      key = 'O_' + Math.floor(cx / 64) + '_' + Math.floor(cz / 64);
    }

    let cell = buckets.get(key);
    if (!cell) {
      cell = {
        tris: [],
        minX: Infinity, minY: Infinity, minZ: Infinity,
        maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity
      };
      buckets.set(key, cell);
    }
    cell.tris.push(v0);
    if (p0x < cell.minX) cell.minX = p0x; if (p0x > cell.maxX) cell.maxX = p0x;
    if (p1x < cell.minX) cell.minX = p1x; if (p1x > cell.maxX) cell.maxX = p1x;
    if (p2x < cell.minX) cell.minX = p2x; if (p2x > cell.maxX) cell.maxX = p2x;
    if (p0y < cell.minY) cell.minY = p0y; if (p0y > cell.maxY) cell.maxY = p0y;
    if (p1y < cell.minY) cell.minY = p1y; if (p1y > cell.maxY) cell.maxY = p1y;
    if (p2y < cell.minY) cell.minY = p2y; if (p2y > cell.maxY) cell.maxY = p2y;
    if (p0z < cell.minZ) cell.minZ = p0z; if (p0z > cell.maxZ) cell.maxZ = p0z;
    if (p1z < cell.minZ) cell.minZ = p1z; if (p1z > cell.maxZ) cell.maxZ = p1z;
    if (p2z < cell.minZ) cell.minZ = p2z; if (p2z > cell.maxZ) cell.maxZ = p2z;
  }

  const chunks = [];
  for (const cell of buckets.values()) {
    const built = buildIndexedMesh(gl, f32, cell.tris, true);
    if (built.count <= 0) continue;
    const castsShadow =
      cell.maxX > -118 && cell.minX < 118 &&
      cell.maxZ > -118 && cell.minZ < 118 &&
      !(cell.maxY < 0.04 && cell.minY > -0.02);
    chunks.push({
      mesh: built,
      minX: cell.minX, minY: cell.minY, minZ: cell.minZ,
      maxX: cell.maxX, maxY: cell.maxY, maxZ: cell.maxZ,
      cx: (cell.minX + cell.maxX) * 0.5,
      cy: (cell.minY + cell.maxY) * 0.5,
      cz: (cell.minZ + cell.maxZ) * 0.5,
      castsShadow,
      d2: 0
    });
  }

  const doubleSided = doubleSidedTris.length > 0 ? buildIndexedMesh(gl, f32, doubleSidedTris, false) : null;
  const cutout = cutoutTris.length > 0 ? buildIndexedMesh(gl, f32, cutoutTris, false) : null;
  return {isSpatial: true, chunks, doubleSided, cutout, _vis: []};
}

function makeTarget(gl, w, h, withDepth = false) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
    gl.texParameteri(gl.TEXTURE_2D, k, v);
  }
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let rb = null;
  if (withDepth) {
    rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  }
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    destroyTarget(gl, {tex, rb, fb});
    throw Error('オフスクリーンバッファを作成できません');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return {fb, tex, rb, w, h};
}

function destroyTarget(gl, t) {
  if (!t) return;
  if (t.tex) gl.deleteTexture(t.tex);
  if (t.rb) gl.deleteRenderbuffer(t.rb);
  if (t.fb) gl.deleteFramebuffer(t.fb);
}

function writeMatrix(out, rx, ry, rz, ux, uy, uz, bx, by, bz, px, py, pz) {
  out[0] = rx; out[1] = ry; out[2] = rz; out[3] = 0;
  out[4] = ux; out[5] = uy; out[6] = uz; out[7] = 0;
  out[8] = bx; out[9] = by; out[10] = bz; out[11] = 0;
  out[12] = px; out[13] = py; out[14] = pz; out[15] = 1;
  return out;
}

function writeRotatedBasisMatrix(out, right, up, fwd, pitch, yaw, roll, px, py, pz) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const u1x = up[0] * cp - fwd[0] * sp, u1y = up[1] * cp - fwd[1] * sp, u1z = up[2] * cp - fwd[2] * sp;
  const f1x = fwd[0] * cp + up[0] * sp, f1y = fwd[1] * cp + up[1] * sp, f1z = fwd[2] * cp + up[2] * sp;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const r2x = right[0] * cy + f1x * sy, r2y = right[1] * cy + f1y * sy, r2z = right[2] * cy + f1z * sy;
  const f2x = f1x * cy - right[0] * sy, f2y = f1y * cy - right[1] * sy, f2z = f1z * cy - right[2] * sy;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const r3x = r2x * cr + u1x * sr, r3y = r2y * cr + u1y * sr, r3z = r2z * cr + u1z * sr;
  const u3x = u1x * cr - r2x * sr, u3y = u1y * cr - r2y * sr, u3z = u1z * cr - r2z * sr;
  return writeMatrix(out, r3x, r3y, r3z, u3x, u3y, u3z, -f2x, -f2y, -f2z, px, py, pz);
}

export class Renderer {
  constructor(canvas, hdrCanvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {alpha: false, antialias: true, premultipliedAlpha: false, powerPreference: 'high-performance'});
    if (!this.gl) throw Error('WebGL 2 を初期化できません');
    this.hdrDisplay = new HDRDisplay(hdrCanvas);
    this.mirrorAt = -10;
    this._mirrorEye = new Float32Array([1e9, 1e9, 1e9]);
    this._mirrorFwd = new Float32Array([0, 0, 0]);
    this.lastRenderTime = null;
    this.native = true;
    this.floatHDR = false;
    this.mirrorDim = [512, 288];
    this._cullEnabled = false;
    const maxTarget = Math.min(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE), this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE));
    this.maxWidth = Math.min(maxTarget, this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS)[0]);
    this.maxHeight = Math.min(maxTarget, this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS)[1]);
  }
  setCull(on) {
    if (this._cullEnabled === on) return;
    this._cullEnabled = on;
    if (on) this.gl.enable(this.gl.CULL_FACE);
    else this.gl.disable(this.gl.CULL_FACE);
  }
  async init() {
    const gl = this.gl;
    this.world = program(gl, shader.worldVS, shader.worldFS);
    this.worldOpaque = program(gl, shader.worldVS, shader.worldOpaqueFS);
    this.skyP = program(gl, shader.skyVS, shader.skyFS);
    this.sf = new ShadowFlame(gl, shader.postVS);
    this.khdr = new KHDRPipeline(gl, shader.postVS);
    this.fluxGI = new FluxGI();
    this.fluxGI.initGL(gl);
    this.schlieren = new SchlierenOptics();
    this.hemoFluxGL = new HemoFluxGL(gl, shader.shared, shader.postVS);
    this.floatHDR = this.khdr.floatHDR;

    const [textures, wave] = await Promise.all([loadTextures(gl), loadScenery(false)]);
    this.textures = textures;
    this.wave = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.wave);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, wave);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL 水面テクスチャを割り当てられませんでした');

    // SpatialMesh-BVH + EarlyZ-SplitOpaque + Indexed Auto-Wound Meshes
    this.terrain = partitionStaticMesh(gl, buildHarbor());
    this.actors = {};
    this.actorsMid = {};
    this.actorsLite = {};
    this.devices = {};
    for (const g of Object.keys(weapons)) {
      this.devices[g] = buildIndexedMesh(gl, viewModel(g).data, null, true);
      if (npcWeapons.includes(g)) for (const team of [0, 1]) {
        this.actors[team + g] = buildIndexedMesh(gl, character(team, g, 'standard', 'high').data, null, true);
        this.actors['spy_' + team + g] = buildIndexedMesh(gl, character(team, g, 'spy', 'high').data, null, true);
      }
    }
    this.effects = gpuDynamicMesh(gl, 65536);
    this.fpFlash = gpuDynamicMesh(gl, 4096);
    this.empty = gl.createVertexArray();

    this.ensureMirror(512, 288);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.disable(gl.CULL_FACE);
    this._cullEnabled = false;

    const worldSamplers = {
      uMats: 0,
      uSfStaticPCF: 1,
      uSky: 2,
      uFluxGI: 6,
      uSfDynPCF: 8,
      uSfStaticRaw: 12,
      uSfNearRaw: 13
    };
    this.setSamplers(this.world, worldSamplers);
    this.setSamplers(this.worldOpaque, worldSamplers);
    this.setSamplers(this.skyP, {uSky: 2, uWaves: 3, uMirror: 4});

    // Zero-GC per-frame uniform & scratch pools
    this.actorData = new Float32Array(24);
    this.activeActorCount = 0;
    this.lightPos = new Float32Array(24);
    this.lightCol = new Float32Array(18);
    this.activeLightCount = 0;
    this.flirActors = new Float32Array(24);
    this.flirBlend = 0;
    this.weatherVec = new Float32Array([1, 0, 0, 0]);

    this._actorPalPool = Array.from({length: 16}, () => new Float32Array(RIG_BONE_COUNT * 12));
    this._actorMatPool = Array.from({length: 16}, () => new Float32Array(16));
    this._actorPalettes = new Map();
    this._actorModels = new Map();
    this._sfPrepOpts = {palettes: this._actorPalettes, models: this._actorModels};
    this._visActors = [];

    this._mainFrustum = new Float32Array(24);
    this._mirrorFrustum = new Float32Array(24);
    this._projMat = new Float32Array(16);
    this._viewMat = new Float32Array(16);
    this._vpMat = new Float32Array(16);
    this._mirrorViewMat = new Float32Array(16);
    this._mirrorVPMat = new Float32Array(16);
    this._invVPMat = new Float32Array(16);
    this._fpProjMat = new Float32Array(16);
    this._fpVPMat = new Float32Array(16);
    this._fpModelMat = new Float32Array(16);
    this._camRays = {r00: new Float32Array(3), rDX: new Float32Array(3), rDY: new Float32Array(3)};
    this._eyeF32 = new Float32Array(3);
    this._refEyeF32 = new Float32Array(3);
    this._refTgtF32 = new Float32Array(3);
    this._fwdF32 = new Float32Array(3);
    this._rightF32 = new Float32Array(3);
    this._upF32 = new Float32Array(3);

    this._fxStream = new Mesh(4096);
    this._flashStream = new Mesh(256);
    this._fxOpts = {
      showChrono: false,
      deathTrace: null,
      spectating: false,
      viewerActor: null,
      fpActorId: -1,
      streamMesh: this._fxStream,
      frustum: this._mainFrustum
    };
    this._lightCand = Array.from({length: 96}, () => ({x: 0, y: 0, z: 0, i: 0, r: 0, g: 0, b: 0, pri: 0}));
    this._drawShadowCb = (m, frustum) => this.drawShadow(m, frustum);
    this._aeroTexMatch = null;
    this._thermoTexMatch = null;

    // Persistent zero-leak GPU streaming textures for AeroVortex 1.0 & ThermoFlux 1.0 (12 KB/frame each)
    const makeStreamTex = (w, h) => {
      const tx = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tx;
    };
    this.aeroTex = makeStreamTex(AERO_W, AERO_H);
    this.thermoTex = makeStreamTex(THERMO_W, THERMO_H);
  }
  ensureMirror(w, h) {
    if (this.mirrorTarget && this.mirrorTarget.w === w && this.mirrorTarget.h === h) return;
    const gl = this.gl;
    destroyTarget(gl, this.mirrorTarget);
    this.mirrorTarget = makeTarget(gl, w, h, true);
    this.mirrorTex = this.mirrorTarget.tex;
    this.mirrorFB = this.mirrorTarget.fb;
    this.mirrorDim = [w, h];
  }
  setSamplers(p, pairs) {
    this.gl.useProgram(p.obj);
    for (const [k, v] of Object.entries(pairs)) if (p[k] != null) this.gl.uniform1i(p[k], v);
  }
  isLite() {
    return !!this.config?.lightMode;
  }
  ensureLiteMeshes() {
    if (this.terrainLite) return;
    const gl = this.gl;
    this.terrainLite = partitionStaticMesh(gl, buildHarbor('lite'));
    if (!this.actorsLite) this.actorsLite = {};
    for (const g of npcWeapons) for (const team of [0, 1]) {
      const k1 = team + g, k2 = 'spy_' + team + g;
      if (!this.actorsLite[k1]) this.actorsLite[k1] = buildIndexedMesh(gl, character(team, g, 'standard', 'lite').data, null, true);
      if (!this.actorsLite[k2]) this.actorsLite[k2] = buildIndexedMesh(gl, character(team, g, 'spy', 'lite').data, null, true);
    }
  }
  actorMesh(a, tier = 'high') {
    const mode = tier === true ? 'lite' : (tier === false || !tier) ? 'high' : tier;
    const map = mode === 'lite' ? (this.actorsLite || (this.actorsLite = {}))
      : mode === 'mid' ? (this.actorsMid || (this.actorsMid = {}))
      : this.actors;
    const team = a.team ? 1 : 0;
    const gun = Object.hasOwn(weapons, a.gun) ? a.gun : 'SW T';
    const key = (a.isSpy ? 'spy_' : '') + team + gun;
    if (!map[key]) {
      map[key] = buildIndexedMesh(this.gl, character(team, gun, a.isSpy ? 'spy' : 'standard', mode).data, null, true);
    }
    return map[key];
  }
  quality() {
    if (this.isLite()) return -1;
    return Object.hasOwn(qualityLevels, this.config?.graphics) ? qualityLevels[this.config.graphics] : 1;
  }
  shadowMode() {
    if (this.isLite()) return 0;
    if (Object.hasOwn(shadowModes, this.config?.shadowMode)) return shadowModes[this.config.shadowMode];
    return this.config?.shadows ? 2 : 0;
  }
  useOffscreen() {
    if (this.isLite()) return false;
    return this.quality() >= 2 || !!this.config?.khdr || this.shadowMode() >= 2 || this.config?.schlieren !== false || this.config?.aeroVortex !== false || this.config?.thermoFlux !== false;
  }
  settings(config) {
    const prevKHDR = !this.config?.lightMode && !!this.config?.khdr;
    this.config = {...config};
    const lite = this.isLite();
    if (lite) this.ensureLiteMeshes();
    this.hdrDisplay.choose(!lite && config.hdr, !lite && config.khdr);
    if (!lite && config.khdr && !prevKHDR) this.khdr?.resetAdaptation();
    this.resize();
    this.mirrorAt = -10;
  }
  resize() {
    if (!this.config) return;
    let [w, h] = effectiveSize(this.config);
    if (innerHeight > innerWidth) [w, h] = [h, w];
    const ratio = Math.min(1, this.maxWidth / w, this.maxHeight / h);
    w = Math.max(1, Math.floor(w * ratio));
    h = Math.max(1, Math.floor(h * ratio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.aspect = this.canvas.clientWidth && this.canvas.clientHeight ? this.canvas.clientWidth / this.canvas.clientHeight : w / h;
    if (this.useOffscreen()) {
      this.khdr.ensure(w, h);
      this.floatHDR = this.khdr.floatHDR;
    } else this.khdr.releaseTargets();
    if (this.shadowMode() < 2) this.sf.releaseScreen();
    if (!this.isLite()) {
      if (this.quality() >= 2) this.ensureMirror(1024, 576);
      else this.ensureMirror(512, 288);
    }
  }
  uploadDynamic(gpuM, streamMesh) {
    const len = streamMesh._len;
    gpuM.count = (len / STRIDE) | 0;
    if (len <= 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, gpuM.buf);
    if (len > gpuM.capFloats) {
      let cap = gpuM.capFloats || 4096;
      while (cap < len) cap <<= 1;
      gpuM.capFloats = cap;
      gl.bufferData(gl.ARRAY_BUFFER, cap * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, streamMesh._buf.subarray(0, len));
  }
  draw(mesh) {
    if (!mesh || !mesh.count) return;
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    if (mesh.indexed) gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
    else gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
  prepareSpatial(spatial, frustum, eye) {
    if (!spatial || !spatial.isSpatial) return null;
    const chunks = spatial.chunks;
    const vis = spatial._vis;
    vis.length = 0;
    const ex = eye[0], ey = eye[1], ez = eye[2];
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      if (frustum && !aabbInFrustum(frustum, c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ)) continue;
      const dx = c.cx - ex, dy = c.cy - ey, dz = c.cz - ez;
      c.d2 = dx * dx + dy * dy + dz * dz;
      vis.push(c);
    }
    // Front-to-back sort maximizes hardware Early-Z rejection in worldFS!
    for (let i = 1; i < vis.length; i++) {
      const cur = vis[i];
      let j = i - 1;
      while (j >= 0 && vis[j].d2 > cur.d2) {
        vis[j + 1] = vis[j];
        j--;
      }
      vis[j + 1] = cur;
    }
    return vis;
  }
  drawSpatial(spatial, frustum, eye, preSorted = false) {
    if (!spatial) return;
    if (!spatial.isSpatial) {
      this.setCull(!!spatial.cull);
      this.draw(spatial);
      return;
    }
    const vis = preSorted ? spatial._vis : this.prepareSpatial(spatial, frustum, eye);
    this.setCull(true);
    for (let i = 0; i < vis.length; i++) this.draw(vis[i].mesh);
    if (spatial.doubleSided) {
      this.setCull(false);
      this.draw(spatial.doubleSided);
    }
  }
  drawShadow(mesh, frustum = null) {
    if (!mesh) return;
    if (!mesh.isSpatial) {
      this.setCull(!!mesh.cull);
      this.draw(mesh);
      return;
    }
    this.setCull(true);
    const chunks = mesh.chunks;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      if (!c.castsShadow) continue;
      if (frustum && !aabbInFrustum(frustum, c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ)) continue;
      this.draw(c.mesh);
    }
  }
  collectLights(match, eye, fwd, right, up, time, view = null) {
    this.activeLightCount = 0;
    if (!match) return;
    const cand = this._lightCand;
    let n = 0;
    const pushL = (x, y, z, intensity, r, g, b, pri) => {
      let slot;
      if (n < cand.length) {
        slot = cand[n++];
      } else {
        slot = {x: 0, y: 0, z: 0, i: 0, r: 0, g: 0, b: 0, pri: 0};
        cand.push(slot);
        n++;
      }
      slot.x = x; slot.y = y; slot.z = z; slot.i = intensity;
      slot.r = r; slot.g = g; slot.b = b; slot.pri = pri;
    };

    const ex = eye[0], ey = eye[1], ez = eye[2];
    const fpActor = view?.firstPerson ? (view.spectateActor || match.player) : null;
    const spectating = !!match.spectating;
    if (fpActor?.alive && fpActor.flash > .005) {
      const f = clamp(fpActor.flash / .11, 0, 1);
      const mx = ex + fwd[0] * .85 + right[0] * .14 - up[0] * .12;
      const my = ey + fwd[1] * .85 + right[1] * .14 - up[1] * .12;
      const mz = ez + fwd[2] * .85 + right[2] * .14 - up[2] * .12;
      const isScherpFp = fpActor.aa?.level === '1.5' && fpActor.aa?.locked;
      let r = 1.8, g = 1.2, b = .52;
      if (isScherpFp) { r = .36; g = 2.08; b = 1.48; }
      else if (fpActor.gun === 'MS10') { r = .48; g = 1.45; b = 1.8; }
      else if (fpActor.gun === 'DF40 II') {
        if (fpActor.df40?.aa14Active) { r = 1.95; g = .86; b = 1.65; }
        else { r = .74; g = 1.05; b = 1.98; }
      }
      else if (fpActor.gun === 'RD40') { r = 1.95; g = .74; b = .58; }
      else if (fpActor.gun === 'RD 50') { r = 1.92; g = 1.42; b = .52; }
      else if (fpActor.gun === 'RD30') { r = 1.90; g = 1.22; b = .46; }
      else if (fpActor.gun === 'RD20') { r = .46; g = 1.52; b = 1.88; }
      else if (fpActor.gun === 'DF1 OUT') { r = .48; g = 1.45; b = 1.25; }
      pushL(mx, my, mz, f * 3.0, r, g, b, 100);
    }

    const viewerTeam = (view?.spectateActor || match.player)?.team ?? 0;
    const fpId = fpActor ? fpActor.id : -1;
    const effects = match.effects;
    for (let i = 0; i < effects.length; i++) {
      const e = effects[i];
      const k = e.kind;
      if (!spectating && k === 'muzzle' && e.shafferCloaked && e.team !== viewerTeam) continue;
      if (!spectating && k === 'shaffer' && e.team !== viewerTeam) continue;
      const ep = e.p;
      const dx = ep[0] - ex, dy = ep[1] - ey, dz = ep[2] - ez;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 2304) continue; // 48^2
      const d = Math.sqrt(d2);
      const frac = clamp(e.life / (e.max || .2), 0, 1);
      const isScherpFx = e.aaTier === '1.5';
      if (k === 'kill') pushL(ep[0], ep[1], ep[2], frac * 3.8, isScherpFx ? .42 : 1.85, isScherpFx ? 1.95 : 1.25, isScherpFx ? 1.42 : .48, 94 - d);
      else if (k === 'baizerBreak') pushL(ep[0], ep[1], ep[2], frac * 3.4, 1.45, .45, 2.15, 89 - d);
      else if (k === 'break') pushL(ep[0], ep[1], ep[2], frac * 3.2, .42, 1.65, 1.95, 88 - d);
      else if (k === 'baizerPickup') pushL(ep[0], ep[1], ep[2], frac * 4.2, 1.45, .42, 2.15, 85 - d);
      else if (k === 'rocketBlast') pushL(ep[0], ep[1], ep[2], frac * 5.8, 2.35, 1.15, .28, 98 - d);
      else if (k === 'tanker') pushL(ep[0], ep[1], ep[2], frac * 4.8, .55, 1.65, 1.45, 86 - d);
      else if (k === 'heal') pushL(ep[0], ep[1], ep[2], frac * 3.8, .42, 1.95, 1.25, 84 - d);
      else if (k === 'shaffer') pushL(ep[0], ep[1], ep[2], frac * 3.4, .68, .92, 1.95, 82 - d);
      else if (k === 'ricochet' || k === 'penetrate') pushL(ep[0], ep[1], ep[2], frac * 2.6, isScherpFx ? .36 : 1.85, isScherpFx ? 1.95 : 1.28, isScherpFx ? 1.40 : .46, 76 - d);
      else if (k === 'muzzle' && e.actor !== fpId) {
        let r = 1.85, g = 1.15, b = .44;
        if (isScherpFx) { r = .36; g = 1.95; b = 1.42; }
        else if (e.gun === 'MS10') { r = .42; g = 1.5; b = 1.95; }
        else if (e.gun === 'RD 50') { r = 1.92; g = 1.42; b = .50; }
        else if (e.gun === 'RD20') { r = .46; g = 1.52; b = 1.88; }
        else if (e.gun === 'RD30') { r = 1.90; g = 1.20; b = .44; }
        else if (e.source === 'p1') { r = 1.45; g = .65; b = 1.95; }
        pushL(ep[0], ep[1], ep[2], frac * 2.8, r, g, b, 70 - d);
      }
      else if (k === 'baizer') pushL(ep[0], ep[1], ep[2], frac * 2.2, 1.35, .45, 2.00, 69 - d);
      else if (k === 'shield') pushL(ep[0], ep[1], ep[2], frac * 2.0, .42, 1.55, 1.85, 68 - d);
      else if (k === 'hit' || k === 'wall') {
        let r = k === 'hit' ? 1.72 : 1.52, g = k === 'hit' ? 1.08 : .98, b = .44;
        if (isScherpFx) { r = .36; g = 1.85; b = 1.38; }
        else if (e.source === 'p1') { r = 1.35; g = .62; b = 1.85; }
        else if (e.gun === 'MS10') { r = .46; g = 1.5; b = 1.85; }
        else if (e.gun === 'DF40 II') { r = .74; g = 1.0; b = 1.88; }
        else if (e.gun === 'RD40') { r = 1.85; g = .68; b = .50; }
        else if (e.gun === 'RD 50') { r = 1.88; g = 1.38; b = .48; }
        else if (e.gun === 'RD30') { r = 1.82; g = 1.14; b = .44; }
        else if (e.gun === 'RD20') { r = .48; g = 1.48; b = 1.80; }
        pushL(ep[0], ep[1], ep[2], frac * (k === 'hit' ? 1.8 : 1.5), r, g, b, (k === 'hit' ? 62 : 52) - d);
      }
    }

    const shots = match.shots;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (s.materialPass || (!spectating && s.shafferCloaked && s.team !== viewerTeam)) continue;
      const sp = s.p;
      const dx = sp[0] - ex, dz = sp[2] - ez;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1764) continue; // 42^2
      const d = Math.sqrt(d2);
      let r, g, b;
      if (s.aaTier === '1.5') { r = .32; g = 2.08; b = 1.48; }
      else if (s.source === 'p1') { r = 1.45; g = .68; b = 2.05; }
      else if (s.gun === 'MS10') { r = .38; g = 1.65; b = 2.1; }
      else if (s.gun === 'DF40 II') {
        if (s.aaTier === '1.4') { r = 1.98; g = .82; b = 1.68; }
        else { r = .72; g = 1.08; b = 2.02; }
      }
      else if (s.gun === 'RD40') { r = 1.95; g = .64; b = .58; }
      else if (s.gun === 'RD 50') { r = 1.92; g = 1.40; b = .48; }
      else if (s.gun === 'RD30') { r = 1.88; g = 1.18; b = .44; }
      else if (s.gun === 'RD20') { r = .44; g = 1.56; b = 1.92; }
      else if (s.guided) { r = .38; g = 1.85; b = 1.65; }
      else if (s.team) { r = 1.65; g = .86; b = .38; }
      else { r = .58; g = 1.55; b = 1.28; }
      const inten = s.aaTier === '1.5' ? 2.2 : s.gun === 'MS10' ? 2.4 : (s.gun === 'DF40 II' || s.gun === 'RD40' || s.source === 'p1' || s.guided) ? 1.8 : 1.35;
      pushL(sp[0], sp[1], sp[2], inten, r, g, b, 58 - d);
    }

    if (match.tankers) {
      const tankers = match.tankers;
      for (let i = 0; i < tankers.length; i++) {
        const tk = tankers[i];
        const dx = tk.x - ex, dz = tk.z - ez;
        const d2 = dx * dx + dz * dz;
        if (d2 > 3136) continue; // 56^2
        const d = Math.sqrt(d2);
        const ready = tk.cooldown <= 0;
        const pulse = ready ? (.95 + Math.sin(time * 3.6 + tk.id) * .25) : .45;
        pushL(tk.x, 2.35, tk.z, (ready ? 2.8 : 1.1) * pulse, ready ? .42 : 1.2, ready ? 1.35 : .75, ready ? 1.22 : .32, 35 - d * .5);
      }
    }
    if (match.baizers) {
      const baizers = match.baizers;
      for (let i = 0; i < baizers.length; i++) {
        const bz = baizers[i];
        if (bz.cooldown > 0) continue;
        const dx = bz.x - ex, dz = bz.z - ez;
        const d2 = dx * dx + dz * dz;
        if (d2 > 1444) continue; // 38^2
        const d = Math.sqrt(d2);
        const is400 = bz.amount >= 40;
        const pulse = .92 + Math.sin(time * 4.4 + bz.id * 1.7) * .24;
        pushL(bz.x, 1.05, bz.z, (is400 ? 2.6 : 1.85) * pulse, is400 ? 1.35 : 1.05, is400 ? .42 : .36, is400 ? 2.15 : 1.85, (is400 ? 40 : 34) - d * .6);
      }
    }
    if (match.ammoBoxes) {
      const boxes = match.ammoBoxes;
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (box.cooldown > 0) continue;
        const dx = box.x - ex, dz = box.z - ez;
        const d2 = dx * dx + dz * dz;
        if (d2 > 1156) continue; // 34^2
        const d = Math.sqrt(d2);
        const pulse = .9 + Math.sin(time * 3.8 + box.id * 1.4) * .2;
        pushL(box.x, .75, box.z, 1.65 * pulse, 1.45, 1.08, .32, 30 - d * .6);
      }
    }

    // Partial selection of top 6 lights (O(6 * n) zero-alloc!)
    const take = Math.min(6, n);
    this.activeLightCount = take;
    const lp = this.lightPos, lc = this.lightCol;
    for (let k = 0; k < take; k++) {
      let best = k;
      let bestPri = cand[k].pri;
      for (let j = k + 1; j < n; j++) {
        if (cand[j].pri > bestPri) {
          bestPri = cand[j].pri;
          best = j;
        }
      }
      if (best !== k) {
        const tmp = cand[k]; cand[k] = cand[best]; cand[best] = tmp;
      }
      const L = cand[k];
      const p4 = k * 4, c3 = k * 3;
      lp[p4] = L.x; lp[p4 + 1] = L.y; lp[p4 + 2] = L.z; lp[p4 + 3] = L.i;
      lc[c3] = L.r; lc[c3 + 1] = L.g; lc[c3 + 2] = L.b;
    }
    for (let k = take; k < 6; k++) {
      const p4 = k * 4, c3 = k * 3;
      lp[p4] = lp[p4 + 1] = lp[p4 + 2] = lp[p4 + 3] = 0;
      lc[c3] = lc[c3 + 1] = lc[c3 + 2] = 0;
    }
  }
  _bindWorldUniforms(p, vp, eye, output, khdrOn, sfMode, quality, time, fluxGIOn, res) {
    const gl = this.gl;
    gl.useProgram(p.obj);
    if (p.uFluxGIOn != null) gl.uniform1i(p.uFluxGIOn, fluxGIOn ? 1 : 0);
    if (p.uResCount != null) {
      const rc = res ? res.uResCount : 0;
      gl.uniform1i(p.uResCount, rc);
      if (rc > 0) {
        if (p.uResPos) gl.uniform4fv(p.uResPos, res.uResPos);
        if (p.uResDim) gl.uniform4fv(p.uResDim, res.uResDim);
        if (p.uResHit) gl.uniform4fv(p.uResHit, res.uResHit);
      }
    }
    gl.uniformMatrix4fv(p.uVP, false, vp);
    gl.uniformMatrix4fv(p.uModel, false, I);
    this.sf.applyWorldUniforms(p, sfMode);
    if (p.uRecoil) gl.uniform2f(p.uRecoil, 0, 0);
    if (p.uAnim) gl.uniform4f(p.uAnim, 0, 0, 0, 0);
    if (p.uAnim2) gl.uniform4f(p.uAnim2, 0, 0, 0, 0);
    gl.uniform2f(p.uHitFX, 0, 0);
    gl.uniform1f(p.uGunHeat, 0);
    gl.uniform1f(p.uTime, time);
    gl.uniform1i(p.uMode, 0);
    gl.uniform1i(p.uOutput, output);
    gl.uniform1i(p.uKHDR, khdrOn ? 1 : 0);
    gl.uniform1i(p.uQuality, quality);
    if (p.uActiveActors != null) gl.uniform1i(p.uActiveActors, this.activeActorCount);
    if (p.uLightCount != null) gl.uniform1i(p.uLightCount, this.activeLightCount);
    gl.uniform3fv(p.uEye, eye);
    gl.uniform4fv(p.uActors, this.actorData);
    gl.uniform4fv(p.uLights, this.lightPos);
    gl.uniform3fv(p.uLightCol, this.lightCol);
    if (p.uWeather != null) gl.uniform4fv(p.uWeather, this.weatherVec);
  }
  worldPass(vp, eye, output, khdrOn, sfMode, quality, time, terrainMesh = this.terrain, fluxGIOn = false, res = null, frustum = null, preSorted = false, deferCutout = false) {
    const gl = this.gl;
    if (this.fluxGI?.tex) {
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, this.fluxGI.tex);
    }
    // EarlyZ-SplitOpaque: draw 99.6% solid terrain with worldOpaque (ZERO discard -> full hardware Early-Z!)
    this._bindWorldUniforms(this.worldOpaque, vp, eye, output, khdrOn, sfMode, quality, time, fluxGIOn, res);
    this.drawSpatial(terrainMesh, frustum, eye, preSorted);
    // Tiny alpha-cutout label decal pass (~0.4% of harbor tris) with discard
    if (!deferCutout && terrainMesh?.cutout && terrainMesh.cutout.count > 0) {
      this._bindWorldUniforms(this.world, vp, eye, output, khdrOn, sfMode, quality, time, fluxGIOn, res);
      this.setCull(false);
      this.draw(terrainMesh.cutout);
      gl.useProgram(this.worldOpaque.obj);
    }
  }
  render(cam, time, match = null, view = {}) {
    const gl = this.gl,
      cfg = this.config || {},
      lite = this.isLite(),
      quality = this.quality(),
      extra = !lite && quality >= 2,
      khdrOn = !lite && !!cfg.khdr,
      fluxGIOn = !lite && cfg.fluxGI !== false,
      schlierenOn = !lite && cfg.schlieren !== false,
      aeroOn = !lite && cfg.aeroVortex !== false && !!match?.aeroVortex,
      thermoOn = !lite && cfg.thermoFlux !== false && !!match?.thermoFlux,
      resonanceOn = !lite && cfg.resonance !== false && !!match?.resonance,
      hemoOn = cfg.hemoFlux !== false && !!match?.hemoFlux,
      chronoOn = cfg.chronoTrace !== false && !!match?.chronoTrace,
      sfMode = this.shadowMode(),
      offscreen = this.useOffscreen(),
      eye = cam.pos,
      tgt = cam.target;

    // Scalar camera basis (zero array allocations)
    let fx0 = tgt[0] - eye[0], fy0 = tgt[1] - eye[1], fz0 = tgt[2] - eye[2];
    const fl = Math.sqrt(fx0 * fx0 + fy0 * fy0 + fz0 * fz0) || 1;
    fx0 /= fl; fy0 /= fl; fz0 /= fl;
    // right = normalize(cross(fwd, [0,1,0])) = normalize([-fz0, 0, fx0])
    let rx0 = -fz0, ry0 = 0, rz0 = fx0;
    const rl = Math.sqrt(rx0 * rx0 + rz0 * rz0) || 1;
    rx0 /= rl; rz0 /= rl;
    // up = cross(right, fwd)
    const ux0 = ry0 * fz0 - rz0 * fy0, uy0 = rz0 * fx0 - rx0 * fz0, uz0 = rx0 * fy0 - ry0 * fx0;

    const eyeF = this._eyeF32; eyeF[0] = eye[0]; eyeF[1] = eye[1]; eyeF[2] = eye[2];
    const fwdF = this._fwdF32; fwdF[0] = fx0; fwdF[1] = fy0; fwdF[2] = fz0;
    const rightF = this._rightF32; rightF[0] = rx0; rightF[1] = ry0; rightF[2] = rz0;
    const upF = this._upF32; upF[0] = ux0; upF[1] = uy0; upF[2] = uz0;
    this.lastCamBasis = {eye: eyeF, right: rightF, up: upF, fwd: fwdF};

    const fy = Math.tan(cam.fov * Math.PI / 360),
      fx = fy * this.aspect;
    perspective(cam.fov * Math.PI / 180, this.aspect, .075, 1400, this._projMat);
    lookAt(eye, tgt, [0, 1, 0], this._viewMat);
    const vp = multiply(this._projMat, this._viewMat, this._vpMat);
    extractFrustum(vp, this._mainFrustum);

    const spectating = !!match?.spectating,
      fpActor = view.firstPerson ? (view.spectateActor || match?.player || null) : null,
      viewerTeam = (view.spectateActor || match?.player)?.team ?? 0;

    if (lite) this.ensureLiteMeshes();
    const activeTerrain = lite ? this.terrainLite : this.terrain;

    const dt = this.lastRenderTime === null ? 1 / 60 : clamp(time - this.lastRenderTime, 0, .15);
    if (this.lastMatch !== match) {
      this.lastMatch = match;
      this.schlieren.reset();
      this.fluxGI.dynamicFlux.fill(0);
      this.khdr.resetAdaptation();
      this.flirBlend = 0;
      this.mirrorAt = -10;
      this._aeroTexMatch = null;
      this._thermoTexMatch = null;
    }
    this.lastRenderTime = time;

    if (offscreen) this.khdr.ensure(this.canvas.width, this.canvas.height);
    this.lastVP = vp;

    // Advance FluxGI 1.0, SchlierenOptics 1.0, AeroVortex 1.0, ThermoFlux 1.0, ResonanceCore 1.0 & HemoFlux 1.0 fields
    if (fluxGIOn && this.fluxGI) this.fluxGI.update(match, view.paused ? 0 : dt, true);
    if (resonanceOn) match.resonance.packUniforms();
    if (schlierenOn && this.schlieren) {
      this.schlieren.step(match, view.paused ? 0 : dt);
      this.schlieren.project(vp, eye, cam.fov, this.aspect);
    }
    const rainFactor = match?.weather === 'disaster' ? 1 : match?.weather === 'storm' ? 0.65 : match?.weather === 'rain' ? 0.35 : 0;
    const visorCount = (hemoOn && !lite && match?.hemoFlux) ? match.hemoFlux.stepVisor(view.paused ? 0 : dt, rainFactor) : 0;
    const flirTarget = (thermoOn && view.flir) ? 1 : 0;
    this.flirBlend = !thermoOn || view.flirSnap ? flirTarget : this.flirBlend + (flirTarget - this.flirBlend) * (1 - Math.exp(-16 * dt));

    // Dirty-gated GPU texture streaming for AeroVortex & ThermoFlux (0 work on clean frames between PDE ticks!)
    if (aeroOn && this.aeroTex) {
      const av = match.aeroVortex;
      if (av._uploadedVersion !== av._stateVersion || this._aeroTexMatch !== match) {
        av._packTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.aeroTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, AERO_W, AERO_H, gl.RGBA, gl.UNSIGNED_BYTE, av.texData);
        av._uploadedVersion = av._stateVersion;
        this._aeroTexMatch = match;
      }
    }
    if (thermoOn && this.flirBlend > 0.005 && this.thermoTex) {
      const tf = match.thermoFlux;
      if (tf._uploadedVersion !== tf._stateVersion || this._thermoTexMatch !== match) {
        tf._packTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.thermoTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, THERMO_W, THERMO_H, gl.RGBA, gl.UNSIGNED_BYTE, tf.texData);
        tf._uploadedVersion = tf._stateVersion;
        this._thermoTexMatch = match;
      }
    }

    // Update weather uniform from match.weatherSpec + dynamic lightning flash
    const ws = match?.weatherSpec;
    this.weatherVec[0] = ws ? ws.fogScale : 1;
    this.weatherVec[1] = ws ? ws.stormDark : 0;
    this.weatherVec[2] = ws ? ws.disasterTint : 0;
    this.weatherVec[3] = match?.lightningFlash || 0;

    // Pack tightly-bound active actors (Shadow Flame + FLIR) AND solve RigCore-Zero palettes ONCE per actor!
    this.actorData.fill(0);
    this.flirActors.fill(0);
    this.activeActorCount = 0;
    this._actorPalettes.clear();
    this._actorModels.clear();
    if (match) {
      const actors = match.actors;
      let ak = 0, fk = 0, pk = 0;
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        if (a.isDrone) continue;
        const cloakedFromViewer = !spectating && a.team !== viewerTeam && (a.shafferTimer || 0) > 0;
        if (!lite && a.alive && !cloakedFromViewer && ak < 6) {
          const o4 = ak * 4;
          this.actorData[o4] = a.x;
          this.actorData[o4 + 1] = a.y;
          this.actorData[o4 + 2] = a.z;
          this.actorData[o4 + 3] = 1 + (a.crouch || 0);
          ak++;
        }
        if (a.alive && a !== fpActor && !cloakedFromViewer) {
          if (!lite && fk < 6) {
            const [cx, cz] = bodyCenter(a);
            const cy = a.y + 0.92 * torso(a);
            const bioHeat = clamp(0.86 + (a.sprintAmt || 0) * 0.14 + (a.flash > 0 ? 0.25 : 0) + (a.hitFlash || 0) * 0.22, 0.5, 1.35);
            const f4 = fk * 4;
            this.flirActors[f4] = cx;
            this.flirActors[f4 + 1] = cy;
            this.flirActors[f4 + 2] = cz;
            this.flirActors[f4 + 3] = bioHeat;
            fk++;
          }
          // Ensure ShadowSilhouette-ExactProxy (16-bone exact shadow hull) exists + solve bone palette ONCE!
          if (sfMode > 0) this.actorMesh(a, 'lite');
          let palBuf = this._actorPalPool[pk];
          if (!palBuf) {
            palBuf = new Float32Array(RIG_BONE_COUNT * 12);
            this._actorPalPool.push(palBuf);
          }
          let matBuf = this._actorMatPool[pk];
          if (!matBuf) {
            matBuf = new Float32Array(16);
            this._actorMatPool.push(matBuf);
          }
          pk++;
          solveCharacterPalette(a, time, palBuf);
          const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
          writeMatrix(matBuf, cy, 0, sy, 0, 1, 0, -sy, 0, cy, a.x, a.y, a.z);
          this._actorPalettes.set(a.id, palBuf);
          this._actorModels.set(a.id, matBuf);
        }
      }
      this.activeActorCount = ak;
    }

    if (lite) {
      this.activeLightCount = 0;
      this.lightPos.fill(0);
      this.lightCol.fill(0);
    } else {
      this.collectLights(match, eyeF, fwdF, rightF, upF, time, view);
    }

    // 1. Shadow Flame 1.0 Depth Pass (SF-SplitCascade + ShadowSilhouette-ExactProxy + RigCore-Zero palette sharing!)
    this.sf.prepare(sfMode, eyeF, fwdF, match, activeTerrain, this.actorsLite, this._drawShadowCb, time, fpActor, this._sfPrepOpts);
    this.sf.bindTextures(sfMode);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.sky);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.wave);

    // 2. Planar Harbor Water Reflection Pass (idle-skip when stationary + frustum-culled spatial chunks)
    const seeWater = !lite && (!match || eyeF[0] < 1 || fwdF[0] - Math.abs(rightF[0]) * fx < -.16);
    if (seeWater) {
      const mEx = eyeF[0] - this._mirrorEye[0], mEy = eyeF[1] - this._mirrorEye[1], mEz = eyeF[2] - this._mirrorEye[2];
      const mFx = fwdF[0] - this._mirrorFwd[0], mFy = fwdF[1] - this._mirrorFwd[1], mFz = fwdF[2] - this._mirrorFwd[2];
      const camMoved = (mEx * mEx + mEy * mEy + mEz * mEz) > 0.0016 || (mFx * mFx + mFy * mFy + mFz * mFz) > 0.00003;
      const mirrorInterval = camMoved ? (extra ? .045 : .18) : .35;
      if (!this.mirrorVP || time - this.mirrorAt > mirrorInterval || time < this.mirrorAt) {
        this.mirrorAt = time;
        this._mirrorEye[0] = eyeF[0]; this._mirrorEye[1] = eyeF[1]; this._mirrorEye[2] = eyeF[2];
        this._mirrorFwd[0] = fwdF[0]; this._mirrorFwd[1] = fwdF[1]; this._mirrorFwd[2] = fwdF[2];
        const re = this._refEyeF32, rt = this._refTgtF32;
        re[0] = eye[0]; re[1] = 2 * WATER_HEIGHT - eye[1]; re[2] = eye[2];
        rt[0] = tgt[0]; rt[1] = 2 * WATER_HEIGHT - tgt[1]; rt[2] = tgt[2];
        lookAt(re, rt, [0, -1, 0], this._mirrorViewMat);
        this.mirrorVP = multiply(this._projMat, this._mirrorViewMat, this._mirrorVPMat);
        extractFrustum(this.mirrorVP, this._mirrorFrustum);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.mirrorFB);
        gl.viewport(0, 0, this.mirrorDim[0], this.mirrorDim[1]);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.worldPass(this.mirrorVP, re, 3, khdrOn, sfMode, Math.min(1, quality), time, activeTerrain, fluxGIOn, resonanceOn ? match.resonance : null, this._mirrorFrustum);
      }
    }
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.mirrorTex);

    // 3. Main World + Actors + Moving Effects + Sky/Sea Pass
    const targetFB = offscreen && this.khdr.targets ? this.khdr.targets.scene.fb : null;
    const finalOutput = lite ? 0 : (this.hdrDisplay.active ? 2 : (cfg.hdr || khdrOn) ? 1 : 0);
    const sceneOutput = targetFB ? (this.khdr.floatHDR ? 5 : 4) : finalOutput;

    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFB);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(.24, .35, .39, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Pre-cull & front-to-back sort visible opaque chunks + visible Nyquist actors ONCE
    const visChunks = this.prepareSpatial(activeTerrain, this._mainFrustum, eyeF);
    const visA = this._visActors;
    visA.length = 0;
    if (match && this._actorPalettes.size > 0) {
      const actors = match.actors;
      const ex = eyeF[0], ey = eyeF[1], ez = eyeF[2];
      const pxScale = (this.canvas.height * 0.5) / Math.max(0.1, fy);
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        const pal = this._actorPalettes.get(a.id);
        if (!pal) continue;
        if (!sphereInFrustum(this._mainFrustum, a.x, a.y + 0.95, a.z, 1.55)) continue;
        const dx = a.x - ex, dy = a.y + 0.95 - ey, dz = a.z - ez;
        const d2 = dx * dx + dy * dy + dz * dz;
        let tier = 'lite';
        if (!lite) {
          const ppm = pxScale / Math.max(1, Math.sqrt(d2));
          tier = ppm >= 68 ? 'high' : ppm >= 26 ? 'mid' : 'lite';
        }
        visA.push({a, pal, model: this._actorModels.get(a.id), mesh: this.actorMesh(a, tier), d2});
      }
      for (let i = 1; i < visA.length; i++) {
        const cur = visA[i];
        let j = i - 1;
        while (j >= 0 && visA[j].d2 > cur.d2) { visA[j + 1] = visA[j]; j--; }
        visA[j + 1] = cur;
      }
    }

    // NearOccluder-ZPrepass (Hi-Z Prime): primes depth from near occluder chunks (<=47m) & near/mid actors
    // so occluded background pixels skip 100% of world shading while avoiding double-transforming tiny far geometry!
    const hasResDisp = resonanceOn && (match?.resonance?.uResCount || 0) > 0;
    const useZPre = !lite && quality >= 1 && !hasResDisp && !!this.sf?.depthProg && !!visChunks;
    if (useZPre) {
      const dp = this.sf.depthProg;
      gl.colorMask(false, false, false, false);
      gl.useProgram(dp.obj);
      gl.uniformMatrix4fv(dp.uVP, false, vp);
      gl.uniformMatrix4fv(dp.uModel, false, I);
      gl.uniform1i(dp.uMode, 0);
      this.setCull(true);
      for (let i = 0; i < visChunks.length; i++) {
        if (visChunks[i].d2 > 2200) break; // visChunks is already sorted front-to-back!
        this.draw(visChunks[i].mesh);
      }
      if (visA.length > 0) {
        gl.uniform1i(dp.uMode, 1);
        for (let i = 0; i < visA.length; i++) {
          const item = visA[i];
          if (item.d2 > 1100) break;
          gl.uniformMatrix4fv(dp.uModel, false, item.model);
          if (dp.uBones != null) gl.uniform4fv(dp.uBones, item.pal);
          this.draw(item.mesh);
        }
      }
      gl.colorMask(true, true, true, true);
    }

    this.worldPass(vp, eyeF, sceneOutput, khdrOn, sfMode, quality, time, activeTerrain, fluxGIOn, resonanceOn ? match.resonance : null, this._mainFrustum, !!visChunks, true);

    // Actors, moving FX, and viewmodel are 100% opaque -> run on worldOpaque for full hardware Early-Z!
    const p = this.worldOpaque;
    if (visA.length > 0) {
      gl.uniform1i(p.uMode, 1);
      this.setCull(true);
      for (let i = 0; i < visA.length; i++) {
        const item = visA[i];
        const a = item.a;
        gl.uniformMatrix4fv(p.uModel, false, item.model);
        if (p.uBones != null) gl.uniform4fv(p.uBones, item.pal);
        gl.uniform2f(p.uHitFX, a.hitFlash || 0, Math.max(a.shieldFlash || 0, a.baizerFlash || 0));
        this.draw(item.mesh);
      }
    }

    // Draw tiny alpha-cutout label decals (~0.4% of harbor) with discard against primed depth buffer
    if (activeTerrain?.cutout && activeTerrain.cutout.count > 0) {
      this._bindWorldUniforms(this.world, vp, eyeF, sceneOutput, khdrOn, sfMode, quality, time, fluxGIOn, resonanceOn ? match.resonance : null);
      this.setCull(false);
      this.draw(activeTerrain.cutout);
      gl.useProgram(p.obj);
    }

    gl.uniform1i(p.uMode, 0);
    if (p.uResCount != null) gl.uniform1i(p.uResCount, 0);
    gl.uniformMatrix4fv(p.uModel, false, I);
    gl.uniform2f(p.uHitFX, 0, 0);
    const deathTrace = (!spectating && chronoOn && match?.player && !match.player.alive) ? (match.chronoTrace.lastPlayerDeathTrace || null) : null;
    const fxOpts = this._fxOpts;
    fxOpts.showChrono = chronoOn && !!view.chrono;
    fxOpts.deathTrace = deathTrace;
    fxOpts.spectating = spectating;
    fxOpts.viewerActor = view.spectateActor || match?.player || null;
    fxOpts.fpActorId = fpActor ? fpActor.id : -1;
    fxOpts.camPos = cam.pos;
    fxOpts.hemoFluxGL = !!(hemoOn && this.hemoFluxGL);
    const fxMesh = movingDetails(match, time, !lite && (extra || khdrOn), lite, fxOpts);
    this.uploadDynamic(this.effects, fxMesh);
    if (this.effects.count > 0) {
      this.setCull(false);
      this.draw(this.effects);
    }

    this.setCull(false);
    const sk = this.skyP;
    gl.useProgram(sk.obj);
    gl.uniform3fv(sk.uEye, eyeF);
    gl.uniform3fv(sk.uForward, fwdF);
    gl.uniform3fv(sk.uRight, rightF);
    gl.uniform3fv(sk.uUp, upF);
    gl.uniform2f(sk.uFov, fx, fy);
    gl.uniform1f(sk.uTime, time);
    gl.uniform1i(sk.uOutput, sceneOutput);
    gl.uniform1i(sk.uKHDR, khdrOn ? 1 : 0);
    gl.uniform1i(sk.uQuality, quality);
    gl.uniform1i(sk.uHasMirror, seeWater && this.mirrorVP ? 1 : 0);
    gl.uniformMatrix4fv(sk.uMirrorVP, false, this.mirrorVP || I);
    if (sk.uWeather != null) gl.uniform4fv(sk.uWeather, this.weatherVec);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3b. HemoFlux 1.0 Dedicated Physically-Based 3D Blood Pass (Forensic BPA Decals, Huppert Pools, Wall Rivulets, Backlit Aerosol Mist, Glossy Ribbons & Droplets)
    if (hemoOn && this.hemoFluxGL && match?.hemoFlux) {
      this.hemoFluxGL.renderWorld(match.hemoFlux, {
        vp,
        eye: eyeF,
        right: rightF,
        up: upF,
        frustum: this._mainFrustum,
        output: sceneOutput,
        khdrOn,
        quality,
        weatherVec: this.weatherVec,
        lightPos: this.lightPos,
        lightCol: this.lightCol,
        lightCount: this.activeLightCount,
        lite
      });
      this._cullEnabled = false;
    }

    // 4. Shadow Flame 1.0 Pro Half-Res Screen-Space Pass (Analytical Ray Basis + Hoisted Linear Stepping!)
    let sfScreenTex = null;
    if (offscreen && sfMode >= 2 && this.khdr.targets?.scene?.depthTex) {
      const cr = this._camRays;
      cr.r00[0] = fx0 - fx * rx0 - fy * ux0;
      cr.r00[1] = fy0 - fx * ry0 - fy * uy0;
      cr.r00[2] = fz0 - fx * rz0 - fy * uz0;
      cr.rDX[0] = 2 * fx * rx0; cr.rDX[1] = 2 * fx * ry0; cr.rDX[2] = 2 * fx * rz0;
      cr.rDY[0] = 2 * fy * ux0; cr.rDY[1] = 2 * fy * uy0; cr.rDY[2] = 2 * fy * uz0;
      sfScreenTex = this.sf.runScreenPass(
        this.khdr.targets.scene.depthTex,
        vp,
        eyeF,
        time,
        this.empty,
        this.canvas.width,
        this.canvas.height,
        cr
      );
      this.sf.bindTextures(sfMode);
    }

    // 5. First-person weapon with full kinematic spring recoil, blowback, RD40 lock/track/D01 gimbal choreography, 4-phase reload & 3D muzzle flash.
    if (fpActor?.alive && view.firstPerson) {
      const a = fpActor,
        motion = view.motion || {},
        kZ = motion.kickZ ?? (view.kick || 0) * .062,
        kY = motion.kickY ?? (view.kick || 0) * .014,
        kPitch = motion.pitchKick ?? (view.kick || 0) * .095,
        kYaw = motion.yawKick || 0,
        kRoll = motion.rollKick || 0,
        swayX = motion.swayX || 0,
        swayY = motion.swayY || 0,
        landDrop = motion.landDrop || 0,
        blowback = motion.blowback ?? (a.recoil || 0),
        gunHeat = motion.heat || 0,
        rdX = motion.rdX || 0,
        rdY = motion.rdY || 0,
        rdZ = motion.rdZ || 0,
        rdPitch = motion.rdPitch || 0,
        rdYaw = motion.rdYaw || 0,
        rdRoll = motion.rdRoll || 0,
        rdLock = motion.rdLock || 0,
        rdD01 = motion.rdD01 || 0,
        rdLockPulse = motion.rdLockPulse || 0,
        rdBarrelPhase = motion.rdBarrelPhase || 0,
        progress = a.reload > 0 ? clamp(1 - a.reload / weapons[a.gun].reload, 0, 1) : 0;

      // Tactile 4-phase reload choreography: 1) cant & mag drop -> 2) swap dip -> 3) mag-seat punch -> 4) bolt-rack pullback
      let relDrop = 0, relPitch = 0, relRoll = 0, relYaw = 0, relX = 0, relZ = 0;
      if (progress > 0) {
        const s = Math.sin(progress * Math.PI);
        const eject = progress < .24 ? Math.sin(progress / .24 * Math.PI) : 0;
        const swapDip = progress > .20 && progress < .62 ? Math.sin((progress - .20) / .42 * Math.PI) : 0;
        const slam = progress > .60 && progress < .80 ? Math.sin((progress - .60) / .20 * Math.PI) : 0;
        const rack = progress > .79 && progress < .96 ? Math.sin((progress - .79) / .17 * Math.PI) : 0;
        relDrop = s * .145 + swapDip * .085 - slam * .044 - rack * .016;
        relPitch = -s * .52 - swapDip * .22 + eject * .12 + slam * .22 + rack * .09;
        relRoll = s * .46 + swapDip * .16 - slam * .14 + rack * .18;
        relYaw = s * .14 - rack * .12;
        relX = -s * .060 - swapDip * .024 + rack * .018;
        relZ = -swapDip * .048 + slam * .026 - rack * .048;
      }

      const stride = Math.sin(a.stride * 2.65),
        speed = Math.min(1, Math.hypot(a.vx, a.vz) / 4.8),
        crouchRoll = a.crouch * .12,
        crouchX = -a.crouch * .022;
      const bx = .205 + stride * .010 * speed + swayX + relX + crouchX + rdX;
      const by = -.205 + Math.cos(a.stride * 5.3) * .006 * speed - relDrop + kY + swayY - landDrop + rdY;
      const bz = .54 - kZ + relZ + rdZ;

      const baseX = eyeF[0] + rx0 * bx + ux0 * by + fx0 * bz;
      const baseY = eyeF[1] + ry0 * bx + uy0 * by + fy0 * bz;
      const baseZ = eyeF[2] + rz0 * bx + uz0 * by + fz0 * bz;
      const modelM = writeRotatedBasisMatrix(
        this._fpModelMat, rightF, upF, fwdF,
        relPitch + kPitch + rdPitch - swayY * 1.4,
        relYaw + kYaw + rdYaw + swayX * 1.6,
        relRoll + kRoll + rdRoll + crouchRoll - swayX * 2.2,
        baseX, baseY, baseZ
      );
      perspective(66 * Math.PI / 180, this.aspect, .04, 50, this._fpProjMat);
      const fpVP = multiply(this._fpProjMat, this._viewMat, this._fpVPMat);

      const vmFB = (targetFB && this.khdr.targets?.scene?.vmFb) ? this.khdr.targets.scene.vmFb : targetFB;
      gl.bindFramebuffer(gl.FRAMEBUFFER, vmFB);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(p.obj);
      gl.uniformMatrix4fv(p.uVP, false, fpVP);
      gl.uniform1i(p.uMode, 2);
      gl.uniform1i(p.uOutput, sceneOutput);
      gl.uniform1i(p.uKHDR, khdrOn ? 1 : 0);
      gl.uniform2f(p.uRecoil, blowback, a.recoilSide || 0);
      if (p.uAnim) gl.uniform4f(p.uAnim, rdLock, rdD01, rdLockPulse, rdBarrelPhase);
      if (p.uAnim2) gl.uniform4f(p.uAnim2, (weapons[a.gun]?.pellets || 1) > 1 ? 1 : 0, time, 0, 0);
      gl.uniform2f(p.uHitFX, lite ? 0 : rdLock, lite ? 0 : rdD01);
      gl.uniform1f(p.uGunHeat, lite ? 0 : gunHeat);
      gl.uniformMatrix4fv(p.uModel, false, modelM);
      this.setCull(true);
      this.draw(this.devices[a.gun]);

      if (a.flash > .005) {
        const mf = muzzleFlashMesh(a.gun, clamp(a.flash / .11, 0, 1), a.shotCount || 1, !lite && (extra || khdrOn), lite, this._flashStream);
        this.uploadDynamic(this.fpFlash, mf);
        if (this.fpFlash.count > 0) {
          gl.uniform2f(p.uRecoil, 0, 0);
          if (p.uAnim) gl.uniform4f(p.uAnim, 0, 0, 0, 0);
          gl.uniform2f(p.uHitFX, 0, 0);
          gl.uniform1f(p.uGunHeat, 0);
          this.setCull(false);
          this.draw(this.fpFlash);
        }
      }
    }

    // 6. Unified KHDR / Shadow Flame Pro / SchlierenOptics 1.0 / AeroVortex 1.0 / ThermoFlux 1.0 Composite
    if (offscreen && this.khdr.targets) {
      this.setCull(false);
      const aeroActive = aeroOn && (match?.aeroVortex?.stats?.totalSmoke || 0) > 0.02;
      const needInvVP = aeroActive || this.flirBlend > 0.005;
      const invVP = needInvVP ? (sfScreenTex && this.sf.invVP ? this.sf.invVP : invert4(vp, this._invVPMat)) : null;
      this.khdr.composite({
        w: this.canvas.width,
        h: this.canvas.height,
        finalOutput,
        khdrOn,
        hasBloom: extra || khdrOn,
        useFXAA: extra || khdrOn,
        sfScreenTex,
        dt,
        shake: view.shake || 0,
        hurt: view.hurt || 0,
        time,
        emptyVao: this.empty,
        schlierenOn,
        shockCount: schlierenOn && this.schlieren ? this.schlieren.activeCount : 0,
        shocks: this.schlieren?.uShocks || null,
        shockMeta: this.schlieren?.uShockMeta || null,
        gunHeat: schlierenOn && view.firstPerson ? (view.motion?.heat || 0) : 0,
        aspect: this.aspect,
        aeroOn: aeroActive,
        aeroTex: this.aeroTex,
        aeroBounds: aeroActive ? match.aeroVortex.smokeBounds : null,
        thermoTex: this.thermoTex,
        fluxGITex: this.fluxGI?.tex || null,
        fluxGIOn,
        flirBlend: this.flirBlend,
        flirActors: this.flirActors,
        invVP,
        camEye: eyeF,
        visorOn: hemoOn && !lite && visorCount > 0,
        visorCount,
        visorDrops: match?.hemoFlux?.uVisorDrop || null,
        visorMeta: match?.hemoFlux?.uVisorMeta || null
      });
    } else if (hemoOn && !lite && visorCount > 0 && this.hemoFluxGL && match?.hemoFlux) {
      this.hemoFluxGL.renderVisorDirect(match.hemoFlux, {
        aspect: this.aspect,
        output: finalOutput,
        khdrOn,
        weatherVec: this.weatherVec,
        emptyVao: this.empty
      });
    }

    this.hdrDisplay.present(this.canvas);
  }
}
