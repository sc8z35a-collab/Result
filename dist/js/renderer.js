import {STRIDE, add, sub, scale, unit, cross, dot, multiply, invert4, lookAt, perspective, clamp} from './geometry.js';
import {bodyCenter, torso} from './posture.js';
import {loadTextures, loadScenery} from './materials.js';
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

function gpuMesh(gl, mesh, dynamic = false) {
  const vao = gl.createVertexArray(), buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh?.data || []), dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  let offset = 0;
  [3, 3, 2, 1, 3, 1].forEach((n, i) => {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, n, gl.FLOAT, false, STRIDE * 4, offset * 4);
    offset += n;
  });
  gl.bindVertexArray(null);
  return {vao, buf, count: mesh?.count || 0};
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

const matrix = (right, up, back, p) => new Float32Array([...right, 0, ...up, 0, ...back, 0, ...p, 1]);

function rotateBasis(right, up, fwd, pitch, yaw, roll) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  let u1 = add(scale(up, cp), scale(fwd, -sp));
  let f1 = add(scale(fwd, cp), scale(up, sp));
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  let r2 = add(scale(right, cy), scale(f1, sy));
  let f2 = add(scale(f1, cy), scale(right, -sy));
  const cr = Math.cos(roll), sr = Math.sin(roll);
  let r3 = add(scale(r2, cr), scale(u1, sr));
  let u3 = add(scale(u1, cr), scale(r2, -sr));
  return {right: r3, up: u3, back: scale(f2, -1)};
}

export class Renderer {
  constructor(canvas, hdrCanvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {alpha: false, antialias: true, premultipliedAlpha: false, powerPreference: 'high-performance'});
    if (!this.gl) throw Error('WebGL 2 を初期化できません');
    this.hdrDisplay = new HDRDisplay(hdrCanvas);
    this.mirrorAt = -10;
    this.lastRenderTime = null;
    this.native = true;
    this.floatHDR = false;
    this.mirrorDim = [512, 288];
    const maxTarget = Math.min(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE), this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE));
    this.maxWidth = Math.min(maxTarget, this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS)[0]);
    this.maxHeight = Math.min(maxTarget, this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS)[1]);
  }
  async init() {
    const gl = this.gl;
    this.world = program(gl, shader.worldVS, shader.worldFS);
    this.skyP = program(gl, shader.skyVS, shader.skyFS);
    this.sf = new ShadowFlame(gl, shader.postVS);
    this.khdr = new KHDRPipeline(gl, shader.postVS);
    this.fluxGI = new FluxGI();
    this.fluxGI.initGL(gl);
    this.schlieren = new SchlierenOptics();
    this.floatHDR = this.khdr.floatHDR;

    const [textures, wave] = await Promise.all([loadTextures(gl), loadScenery(false)]);
    this.textures = textures;
    this.wave = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.wave);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, wave);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL 水面テクスチャを割り当てられませんでした');

    this.terrain = gpuMesh(gl, buildHarbor());
    this.actors = {};
    this.devices = {};
    for (const g of Object.keys(weapons)) {
      this.devices[g] = gpuMesh(gl, viewModel(g));
      if (npcWeapons.includes(g)) for (const team of [0, 1]) {
        this.actors[team + g] = gpuMesh(gl, character(team, g, 'standard', 'high'));
        this.actors['spy_' + team + g] = gpuMesh(gl, character(team, g, 'spy', 'high'));
      }
    }
    this.effects = gpuMesh(gl, null, true);
    this.fpFlash = gpuMesh(gl, null, true);
    this.empty = gl.createVertexArray();

    this.ensureMirror(512, 288);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    this.setSamplers(this.world, {
      uMats: 0,
      uSfStaticPCF: 1,
      uSky: 2,
      uFluxGI: 6,
      uSfDynPCF: 8,
      uSfStaticRaw: 12,
      uSfNearRaw: 13
    });
    this.setSamplers(this.skyP, {uSky: 2, uWaves: 3, uMirror: 4});

    this.actorData = new Float32Array(24);
    this.lightPos = new Float32Array(24);
    this.lightCol = new Float32Array(18);
    this.flirActors = new Float32Array(24);
    this.flirBlend = 0;

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
    this.terrainLite = gpuMesh(gl, buildHarbor('lite'));
    this.actorsLite = {};
    for (const g of npcWeapons) for (const team of [0, 1]) {
      this.actorsLite[team + g] = gpuMesh(gl, character(team, g, 'standard', 'lite'));
      this.actorsLite['spy_' + team + g] = gpuMesh(gl, character(team, g, 'spy', 'lite'));
    }
  }
  actorMesh(a, lite) {
    const map = lite ? this.actorsLite : this.actors;
    const team = a.team ? 1 : 0;
    const gun = Object.hasOwn(weapons, a.gun) ? a.gun : 'SW T';
    const key = (a.isSpy ? 'spy_' : '') + team + gun;
    if (!map[key]) {
      map[key] = gpuMesh(this.gl, character(team, gun, a.isSpy ? 'spy' : 'standard', lite ? 'lite' : 'high'));
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
  draw(mesh) {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
  collectLights(match, eye, fwd, right, up, time) {
    this.lightPos.fill(0);
    this.lightCol.fill(0);
    if (!match) return;
    const list = [];
    const pl = match.player;
    if (pl?.alive && pl.flash > .005) {
      const f = clamp(pl.flash / .11, 0, 1);
      const mp = add(eye, add(scale(fwd, .85), add(scale(right, .14), scale(up, -.12))));
      const col = pl.gun === 'MS10' ? [.48, 1.45, 1.8]
        : pl.gun === 'DF40 II' ? (pl.df40?.aa14Active ? [1.95, .86, 1.65] : [.74, 1.05, 1.98])
        : pl.gun === 'RD40' ? [1.95, .74, .58]
        : pl.gun === 'RD30' ? [1.90, 1.22, .46]
        : pl.gun === 'RD20' ? [.46, 1.52, 1.88]
        : pl.gun === 'DF1 OUT' ? [.48, 1.45, 1.25]
        : [1.8, 1.2, .52];
      list.push({p: mp, i: f * 3.8, c: col, pri: 100});
    }
    for (const e of match.effects) {
      const d = Math.hypot(e.p[0] - eye[0], e.p[1] - eye[1], e.p[2] - eye[2]);
      if (d > 48) continue;
      const frac = clamp(e.life / (e.max || .2), 0, 1);
      if (e.kind === 'kill') list.push({p: e.p, i: frac * 6.4, c: [2.0, 1.35, .52], pri: 94 - d});
      else if (e.kind === 'break') list.push({p: e.p, i: frac * 5.6, c: [.42, 1.85, 2.15], pri: 88 - d});
      else if (e.kind === 'tanker') list.push({p: e.p, i: frac * 6.0, c: [.55, 1.8, 1.55], pri: 86 - d});
      else if (e.kind === 'ricochet' || e.kind === 'penetrate') list.push({p: e.p, i: frac * 4.2, c: [1.98, 1.38, .48], pri: 76 - d});
      else if (e.kind === 'muzzle' && !e.human) list.push({p: e.p, i: frac * 3.4, c: e.gun === 'MS10' ? [.42, 1.5, 1.95] : e.gun === 'RD20' ? [.46, 1.52, 1.88] : e.gun === 'RD30' ? [1.90, 1.20, .44] : e.source === 'p1' ? [1.45, .65, 1.95] : [1.85, 1.15, .44], pri: 70 - d});
      else if (e.kind === 'shield') list.push({p: e.p, i: frac * 3.4, c: [.42, 1.7, 1.95], pri: 68 - d});
      else if (e.kind === 'hit' || e.kind === 'wall') {
        const ic = e.source === 'p1' ? [1.45, .65, 1.95]
          : e.gun === 'MS10' ? [.46, 1.6, 1.95]
          : e.gun === 'DF40 II' ? [.78, 1.05, 1.98]
          : e.gun === 'RD40' ? [1.95, .72, .52]
          : e.gun === 'RD30' ? [1.90, 1.18, .44]
          : e.gun === 'RD20' ? [.48, 1.54, 1.88]
          : e.kind === 'hit' ? [1.85, 1.15, .45] : [1.65, 1.05, .45];
        list.push({p: e.p, i: frac * (e.kind === 'hit' ? 3.1 : 2.5), c: ic, pri: (e.kind === 'hit' ? 62 : 52) - d});
      }
    }
    for (const s of match.shots) {
      if (s.materialPass) continue;
      const d = Math.hypot(s.p[0] - eye[0], s.p[2] - eye[2]);
      if (d > 42) continue;
      const c = s.source === 'p1' ? [1.45, .68, 2.05]
        : s.gun === 'MS10' ? [.38, 1.65, 2.1]
        : s.gun === 'DF40 II' ? (s.aaTier === '1.4' ? [1.98, .82, 1.68] : [.72, 1.08, 2.02])
        : s.gun === 'RD40' ? [1.95, .64, .58]
        : s.gun === 'RD30' ? [1.88, 1.18, .44]
        : s.gun === 'RD20' ? [.44, 1.56, 1.92]
        : s.guided ? [.38, 1.85, 1.65]
        : s.team ? [1.65, .86, .38] : [.58, 1.55, 1.28];
      list.push({p: s.p, i: s.gun === 'MS10' ? 2.9 : (s.gun === 'DF40 II' || s.gun === 'RD40' || s.source === 'p1' || s.guided) ? 2.2 : 1.6, c, pri: 58 - d});
    }
    if (match.tankers) {
      for (const tk of match.tankers) {
        const d = Math.hypot(tk.x - eye[0], tk.z - eye[2]);
        if (d > 56) continue;
        const ready = tk.cooldown <= 0;
        const pulse = ready ? (.95 + Math.sin(time * 3.6 + tk.id) * .25) : .45;
        list.push({p: [tk.x, 2.35, tk.z], i: (ready ? 2.8 : 1.1) * pulse, c: ready ? [.42, 1.35, 1.22] : [1.2, .75, .32], pri: 35 - d * .5});
      }
    }
    list.sort((a, b) => b.pri - a.pri);
    for (let k = 0; k < Math.min(6, list.length); k++) {
      const L = list[k];
      this.lightPos.set([L.p[0], L.p[1], L.p[2], L.i], k * 4);
      this.lightCol.set(L.c, k * 3);
    }
  }
  worldPass(vp, eye, output, khdrOn, sfMode, quality, time, terrainMesh = this.terrain, fluxGIOn = false, res = null) {
    const gl = this.gl, p = this.world;
    gl.useProgram(p.obj);
    if (this.fluxGI?.tex) {
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, this.fluxGI.tex);
    }
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
    gl.uniform2f(p.uGait, 0, 0);
    gl.uniform3f(p.uPose, 0, 0, 0);
    gl.uniform3f(p.uHit, 0, 0, 0);
    gl.uniform2f(p.uRecoil, 0, 0);
    if (p.uAnim) gl.uniform4f(p.uAnim, 0, 0, 0, 0);
    if (p.uAnim2) gl.uniform4f(p.uAnim2, 0, 0, 0, 0);
    gl.uniform2f(p.uHitFX, 0, 0);
    gl.uniform1f(p.uGunHeat, 0);
    gl.uniform1f(p.uTime, time);
    gl.uniform1i(p.uMode, 0);
    gl.uniform1i(p.uOutput, output);
    gl.uniform1i(p.uKHDR, khdrOn ? 1 : 0);
    gl.uniform1i(p.uQuality, quality);
    gl.uniform3fv(p.uEye, eye);
    gl.uniform4fv(p.uActors, this.actorData);
    gl.uniform4fv(p.uLights, this.lightPos);
    gl.uniform3fv(p.uLightCol, this.lightCol);
    this.draw(terrainMesh);
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
      chronoOn = cfg.chronoTrace !== false && !!match?.chronoTrace,
      sfMode = this.shadowMode(),
      offscreen = this.useOffscreen(),
      eye = cam.pos,
      fwd = unit(sub(cam.target, eye)),
      right = unit(cross(fwd, [0, 1, 0])),
      up = cross(right, fwd),
      fy = Math.tan(cam.fov * Math.PI / 360),
      fx = fy * this.aspect,
      proj = perspective(cam.fov * Math.PI / 180, this.aspect),
      vp = multiply(proj, lookAt(eye, cam.target));

    if (lite) this.ensureLiteMeshes();
    const activeTerrain = lite ? this.terrainLite : this.terrain;
    const activeActors = lite ? this.actorsLite : this.actors;

    const dt = this.lastRenderTime === null ? 1 / 60 : clamp(time - this.lastRenderTime, 0, .15);
    if (this.lastMatch !== match) {
      this.lastMatch = match;
      this.schlieren.reset();
      this.fluxGI.dynamicFlux.fill(0);
      this.khdr.resetAdaptation();
      this.flirBlend = 0;
      this.mirrorAt = -10;
    }
    this.lastRenderTime = time;

    if (offscreen) this.khdr.ensure(this.canvas.width, this.canvas.height);
    this.lastVP = vp;

    // Advance FluxGI 1.0, SchlierenOptics 1.0, AeroVortex 1.0, ThermoFlux 1.0 & ResonanceCore 1.0 GPU fields
    if (fluxGIOn && this.fluxGI) this.fluxGI.update(match, view.paused ? 0 : dt, true);
    if (resonanceOn) match.resonance.packUniforms();
    if (schlierenOn && this.schlieren) {
      this.schlieren.step(match, view.paused ? 0 : dt);
      this.schlieren.project(vp, eye, cam.fov, this.aspect);
    }
    const flirTarget = (thermoOn && view.flir) ? 1 : 0;
    this.flirBlend = !thermoOn || view.flirSnap ? flirTarget : this.flirBlend + (flirTarget - this.flirBlend) * (1 - Math.exp(-16 * dt));
    if (aeroOn && this.aeroTex) {
      match.aeroVortex._packTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.aeroTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, AERO_W, AERO_H, gl.RGBA, gl.UNSIGNED_BYTE, match.aeroVortex.texData);
    }
    if (thermoOn && this.flirBlend > 0.005 && this.thermoTex) {
      match.thermoFlux._packTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.thermoTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, THERMO_W, THERMO_H, gl.RGBA, gl.UNSIGNED_BYTE, match.thermoFlux.texData);
    }

    // Pack live actor positions + crouch factor (Shadow Flame) & bio-thermal centers (ThermoFlux FLIR)
    this.actorData.fill(0);
    this.flirActors.fill(0);
    if (match && !lite) {
      let fk = 0;
      match.actors.forEach((a, i) => {
        this.actorData.set([a.x, a.y, a.z, a.alive ? 1 + (a.crouch || 0) : 0], i * 4);
        if (a.alive && !a.human && fk < 6) {
          const [cx, cz] = bodyCenter(a);
          const cy = a.y + 0.92 * torso(a);
          const bioHeat = clamp(0.86 + (a.sprintAmt || 0) * 0.14 + (a.flash > 0 ? 0.25 : 0) + (a.hitFlash || 0) * 0.22, 0.5, 1.35);
          this.flirActors.set([cx, cy, cz, bioHeat], fk * 4);
          fk++;
        }
      });
    }
    if (lite) {
      this.lightPos.fill(0);
      this.lightCol.fill(0);
    } else {
      this.collectLights(match, eye, fwd, right, up, time);
    }

    // 1. Shadow Flame 1.0 Depth Pass (Off in Lightweight Mode / 1.0 Flash Dual-Cache / 1.0 Pro Focus-Snapped Dual-Cascade)
    if (match && sfMode > 0) {
      for (const a of match.actors) if (a.alive && !a.human) this.actorMesh(a, lite);
    }
    this.sf.prepare(sfMode, eye, fwd, match, activeTerrain, activeActors, m => this.draw(m), time);
    this.sf.bindTextures(sfMode);

    for (const [i, type, tex] of [
      [0, gl.TEXTURE_2D_ARRAY, this.textures.tex],
      [2, gl.TEXTURE_2D, this.textures.sky],
      [3, gl.TEXTURE_2D, this.wave]
    ]) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(type, tex);
    }

    // 2. Planar Harbor Water Reflection Pass (skipped in Lightweight Mode)
    const seeWater = !lite && (!match || eye[0] < 1 || fwd[0] - Math.abs(right[0]) * fx < -.16);
    const mirrorInterval = extra ? .045 : .18;
    if (seeWater && (time - this.mirrorAt > mirrorInterval || time < this.mirrorAt)) {
      this.mirrorAt = time;
      const ref = p => [p[0], 2 * WATER_HEIGHT - p[1], p[2]], re = ref(eye);
      this.mirrorVP = multiply(proj, lookAt(re, ref(cam.target), [0, -1, 0]));
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mirrorFB);
      gl.viewport(0, 0, this.mirrorDim[0], this.mirrorDim[1]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.worldPass(this.mirrorVP, re, 3, khdrOn, sfMode, Math.min(1, quality), time, activeTerrain, fluxGIOn, resonanceOn ? match.resonance : null);
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

    this.worldPass(vp, eye, sceneOutput, khdrOn, sfMode, quality, time, activeTerrain, fluxGIOn, resonanceOn ? match.resonance : null);

    const p = this.world;
    if (match) {
      gl.uniform1i(p.uMode, 1);
      for (const a of match.actors) {
        if (!a.alive || (a.human && a.alive)) continue;
        const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
        const rVec = [cy, 0, sy], bVec = [-sy, 0, cy];
        let hitX = 0, hitZ = 1;
        if (a.hitDir) {
          hitX = clamp(dot(a.hitDir, rVec), -1, 1);
          hitZ = clamp(dot(a.hitDir, bVec), -1, 1);
        }
        gl.uniformMatrix4fv(p.uModel, false, matrix(rVec, [0, 1, 0], bVec, [a.x, a.y, a.z]));
        gl.uniform2f(p.uGait, a.stride * 2.85, clamp(Math.hypot(a.vx, a.vz) / 4.2, 0, 1.2));
        gl.uniform3f(p.uPose, a.crouch, a.lean, a.aimPose);
        gl.uniform3f(p.uHit, a.hitRecoil || 0, hitX, hitZ);
        gl.uniform2f(p.uRecoil, a.recoil || 0, a.recoilSide || 0);
        if (p.uAnim) gl.uniform4f(p.uAnim, a.fwdVel || 0, a.sideVel || 0, a.airBlend || 0, a.landCompress || 0);
        if (p.uAnim2) gl.uniform4f(p.uAnim2, a.pitch || 0, time + a.id * 1.13, a.sprintAmt || 0, a.reloadFrac || 0);
        gl.uniform2f(p.uHitFX, a.hitFlash || 0, a.shieldFlash || 0);
        this.draw(this.actorMesh(a, lite));
      }
    }

    gl.uniform1i(p.uMode, 0);
    if (p.uResCount != null) gl.uniform1i(p.uResCount, 0);
    gl.uniformMatrix4fv(p.uModel, false, I);
    gl.uniform3f(p.uHit, 0, 0, 0);
    gl.uniform2f(p.uRecoil, 0, 0);
    gl.uniform2f(p.uHitFX, 0, 0);
    const deathTrace = (chronoOn && match?.player && !match.player.alive) ? (match.chronoTrace.lastPlayerDeathTrace || null) : null;
    const fxMesh = movingDetails(match, time, !lite && (extra || khdrOn), lite, {showChrono: chronoOn && !!view.chrono, deathTrace});
    this.effects.count = fxMesh.count;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.effects.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fxMesh.data), gl.DYNAMIC_DRAW);
    this.draw(this.effects);

    const sk = this.skyP;
    gl.useProgram(sk.obj);
    gl.uniform3fv(sk.uEye, eye);
    gl.uniform3fv(sk.uForward, fwd);
    gl.uniform3fv(sk.uRight, right);
    gl.uniform3fv(sk.uUp, up);
    gl.uniform2f(sk.uFov, fx, fy);
    gl.uniform1f(sk.uTime, time);
    gl.uniform1i(sk.uOutput, sceneOutput);
    gl.uniform1i(sk.uKHDR, khdrOn ? 1 : 0);
    gl.uniform1i(sk.uQuality, quality);
    gl.uniform1i(sk.uHasMirror, seeWater && this.mirrorVP ? 1 : 0);
    gl.uniformMatrix4fv(sk.uMirrorVP, false, this.mirrorVP || I);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 4. Shadow Flame 1.0 Pro Half-Res Screen-Space Pass (SSCS + GTAO-Lite + Volumetric Shadow Shafts)
    // Runs BEFORE viewmodel clears depth so sceneDepthTex contains 100% pure world + actor geometry!
    let sfScreenTex = null;
    if (offscreen && sfMode >= 2 && this.khdr.targets?.scene?.depthTex) {
      sfScreenTex = this.sf.runScreenPass(
        this.khdr.targets.scene.depthTex,
        vp,
        eye,
        time,
        this.empty,
        this.canvas.width,
        this.canvas.height
      );
      this.sf.bindTextures(sfMode);
    }

    // 5. First-person weapon with full kinematic spring recoil, blowback, RD40 lock/track/D01 gimbal choreography, reload & 3D muzzle flash.
    if (match?.player.alive && view.firstPerson) {
      const a = match.player,
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
        progress = a.reload > 0 ? 1 - a.reload / weapons[a.gun].reload : 0;

      let relDrop = 0, relPitch = 0, relRoll = 0, relX = 0;
      if (progress > 0) {
        const s = Math.sin(progress * Math.PI);
        const slam = progress > .62 && progress < .82 ? Math.sin((progress - .62) / .20 * Math.PI) : 0;
        relDrop = s * .15 - slam * .028;
        relPitch = -s * .58 + slam * .14;
        relRoll = s * .42;
        relX = -s * .055;
      }

      const stride = Math.sin(a.stride * 2.65),
        speed = Math.min(1, Math.hypot(a.vx, a.vz) / 4.8),
        crouchRoll = a.crouch * .12,
        crouchX = -a.crouch * .022;
      const bx = .205 + stride * .010 * speed + swayX + relX + crouchX + rdX;
      const by = -.205 + Math.cos(a.stride * 5.3) * .006 * speed - relDrop + kY + swayY - landDrop + rdY;
      const bz = .54 - kZ + rdZ;

      const base = add(eye, add(scale(right, bx), add(scale(up, by), scale(fwd, bz))));
      const basis = rotateBasis(right, up, fwd, relPitch + kPitch + rdPitch - swayY * 1.4, kYaw + rdYaw + swayX * 1.6, relRoll + kRoll + rdRoll + crouchRoll - swayX * 2.2);
      const fpVP = multiply(perspective(66 * Math.PI / 180, this.aspect, .04, 50), lookAt(eye, cam.target));
      const modelM = matrix(basis.right, basis.up, basis.back, base);

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
      this.draw(this.devices[a.gun]);

      if (a.flash > .005) {
        const mf = muzzleFlashMesh(a.gun, clamp(a.flash / .11, 0, 1), a.shotCount || 1, !lite && (extra || khdrOn), lite);
        this.fpFlash.count = mf.count;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fpFlash.buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mf.data), gl.DYNAMIC_DRAW);
        gl.uniform2f(p.uRecoil, 0, 0);
        if (p.uAnim) gl.uniform4f(p.uAnim, 0, 0, 0, 0);
        gl.uniform2f(p.uHitFX, 0, 0);
        gl.uniform1f(p.uGunHeat, 0);
        this.draw(this.fpFlash);
      }
    }

    // 6. Unified KHDR / Shadow Flame Pro / SchlierenOptics 1.0 / AeroVortex 1.0 / ThermoFlux 1.0 Composite
    if (offscreen && this.khdr.targets) {
      const needInvVP = (aeroOn && (match?.aeroVortex?.stats?.totalSmoke || 0) > 0.02) || this.flirBlend > 0.005;
      const invVP = needInvVP ? invert4(vp) : null;
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
        aeroOn: aeroOn && (match?.aeroVortex?.stats?.totalSmoke || 0) > 0.02,
        aeroTex: this.aeroTex,
        thermoTex: this.thermoTex,
        fluxGITex: this.fluxGI?.tex || null,
        fluxGIOn,
        flirBlend: this.flirBlend,
        flirActors: this.flirActors,
        invVP,
        camEye: eye
      });
    }

    this.hdrDisplay.present(this.canvas);
  }
}
