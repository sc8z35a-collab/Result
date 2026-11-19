import {STRIDE, add, sub, scale, unit, cross, dot, multiply, lookAt, perspective, ortho, clamp} from './geometry.js';
import {loadTextures} from './materials.js';
import {buildHarbor} from './harbor.js';
import {character, viewModel, movingDetails, muzzleFlashMesh} from './models.js';
import {weapons, npcWeapons} from './match.js';
import * as shader from './shaders.js';
import {HDRDisplay} from './hdr.js';

const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export const sizes = {HD: [1280, 720], FHD: [1920, 1080], '2K': [2560, 1440]};
export const qualityLevels = {standard: 0, high: 1, extra: 2};

function program(gl, vs, fs) {
  const obj = gl.createProgram(), sh = [];
  for (const [type, code] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));
    gl.attachShader(obj, s);
    sh.push(s)
  }
  gl.linkProgram(obj);
  if (!gl.getProgramParameter(obj, gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(obj));
  for (const s of sh)gl.deleteShader(s);
  const loc = {};
  for (let i = 0; i < gl.getProgramParameter(obj, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(obj, i).name;
    loc[name.replace('[0]', '')] = gl.getUniformLocation(obj, name)
  }
  return {obj, ...loc}
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
    offset += n
  });
  gl.bindVertexArray(null);
  return {vao, buf, count: mesh?.count || 0}
}

function makeTarget(gl, w, h, withDepth = false) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
    gl.texParameteri(gl.TEXTURE_2D, k, v)
  }
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let rb = null;
  if (withDepth) {
    rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb)
  }
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)throw Error('オフスクリーンバッファを作成できません');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return {fb, tex, rb, w, h}
}

function destroyTarget(gl, t) {
  if (!t)return;
  if (t.tex)gl.deleteTexture(t.tex);
  if (t.rb)gl.deleteRenderbuffer(t.rb);
  if (t.fb)gl.deleteFramebuffer(t.fb)
}

const matrix = (right, up, back, p) => new Float32Array([...right, 0, ...up, 0, ...back, 0, ...p, 1]);

function rotateBasis(right, up, fwd, pitch, yaw, roll) {
  // Apply pitch (around right), yaw (around up), and roll (around fwd) cleanly for weapon kinematics.
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  let u1 = add(scale(up, cp), scale(fwd, -sp));
  let f1 = add(scale(fwd, cp), scale(up, sp));
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  let r2 = add(scale(right, cy), scale(f1, sy));
  let f2 = add(scale(f1, cy), scale(right, -sy));
  const cr = Math.cos(roll), sr = Math.sin(roll);
  let r3 = add(scale(r2, cr), scale(u1, sr));
  let u3 = add(scale(u1, cr), scale(r2, -sr));
  return {right: r3, up: u3, back: scale(f2, -1)}
}

export class Renderer {
  constructor(canvas, hdrCanvas) {
    this.canvas = canvas;
    this.hdrDisplay = new HDRDisplay(hdrCanvas);
    this.gl = canvas.getContext('webgl2', {alpha: false, antialias: true, premultipliedAlpha: false, powerPreference: 'high-performance'});
    if (!this.gl)throw Error('WebGL 2 を初期化できません');
    this.mirrorAt = -10;
    this.shadowReady = false;
    this.native = true;
    this.post = null;
    this.postSize = [0, 0];
    this.mirrorDim = [512, 288]
  }
  async init() {
    const gl = this.gl;
    this.world = program(gl, shader.worldVS, shader.worldFS);
    this.skyP = program(gl, shader.skyVS, shader.skyFS);
    this.depth = program(gl, shader.shadowVS, shader.shadowFS);
    this.bloomEx = program(gl, shader.postVS, shader.bloomExtractFS);
    this.blurP = program(gl, shader.postVS, shader.blurFS);
    this.compP = program(gl, shader.postVS, shader.compositeFS);

    const [textures, wave] = await Promise.all([loadTextures(gl), new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = './assets/waves.webp'
    })]);
    this.textures = textures;
    this.wave = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.wave);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, wave);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    this.terrain = gpuMesh(gl, buildHarbor());
    this.actors = {};
    this.devices = {};
    for (const g of Object.keys(weapons)) {
      this.devices[g] = gpuMesh(gl, viewModel(g));
      if (npcWeapons.includes(g))for (const team of [0, 1])this.actors[team + g] = gpuMesh(gl, character(team, g))
    }
    this.effects = gpuMesh(gl, null, true);
    this.fpFlash = gpuMesh(gl, null, true);
    this.empty = gl.createVertexArray();

    const s = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.shadowSize = s;
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, s, s);
    for (const [key, val] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE],
      [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL]
    ])gl.texParameteri(gl.TEXTURE_2D, key, val);
    this.shadowFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)throw Error('影バッファを作成できません');
    this.light = multiply(ortho(-109, 109, -71, 71, 12, 405), lookAt(scale(unit([-.66, .28, -.70]), 204), [0, 0, 0]));

    this.ensureMirror(512, 288);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    this.setSamplers(this.world, {uMats: 0, uShadow: 1, uSky: 2});
    this.setSamplers(this.skyP, {uSky: 2, uWaves: 3, uMirror: 4});
    this.setSamplers(this.bloomEx, {uScene: 5});
    this.setSamplers(this.blurP, {uTex: 5});
    this.setSamplers(this.compP, {uScene: 5, uBloomA: 6, uBloomB: 7});
    this.actorData = new Float32Array(24);
    this.lightPos = new Float32Array(24);
    this.lightCol = new Float32Array(18)
  }
  ensureMirror(w, h) {
    if (this.mirrorTarget && this.mirrorTarget.w === w && this.mirrorTarget.h === h)return;
    const gl = this.gl;
    destroyTarget(gl, this.mirrorTarget);
    this.mirrorTarget = makeTarget(gl, w, h, true);
    this.mirrorTex = this.mirrorTarget.tex;
    this.mirrorFB = this.mirrorTarget.fb;
    this.mirrorDim = [w, h]
  }
  ensurePost(w, h) {
    if (this.post && this.postSize[0] === w && this.postSize[1] === h)return;
    const gl = this.gl;
    if (this.post) {
      for (const t of Object.values(this.post))destroyTarget(gl, t);
    }
    const hw = Math.max(64, w >> 1), hh = Math.max(64, h >> 1);
    const qw = Math.max(32, w >> 2), qh = Math.max(32, h >> 2);
    this.post = {
      scene: makeTarget(gl, w, h, true),
      a0: makeTarget(gl, hw, hh, false),
      a1: makeTarget(gl, hw, hh, false),
      b0: makeTarget(gl, qw, qh, false),
      b1: makeTarget(gl, qw, qh, false)
    };
    this.postSize = [w, h]
  }
  setSamplers(p, pairs) {
    this.gl.useProgram(p.obj);
    for (const [k, v] of Object.entries(pairs))if (p[k] != null)this.gl.uniform1i(p[k], v)
  }
  quality() {
    return qualityLevels[this.config?.graphics] ?? 1
  }
  settings(config) {
    this.config = {...config};
    this.hdrDisplay.choose(config.hdr);
    this.resize();
    this.mirrorAt = -10
  }
  resize() {
    if (!this.config)return;
    let [w, h] = sizes[this.config.resolution] || sizes.HD;
    if (innerHeight > innerWidth)[w, h] = [h, w];
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h
    }
    this.aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    if (this.quality() >= 2) {
      this.ensurePost(w, h);
      this.ensureMirror(1024, 576)
    } else {
      this.ensureMirror(512, 288)
    }
  }
  draw(mesh) {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count)
  }
  makeShadows(match = null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.depth.obj);
    gl.uniformMatrix4fv(this.depth.uVP, false, this.light);
    gl.uniformMatrix4fv(this.depth.uModel, false, I);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.1, 2);
    this.draw(this.terrain);
    if (match && this.quality() >= 2) {
      for (const a of match.actors) {
        if (!a.alive || a.human)continue;
        const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
        gl.uniformMatrix4fv(this.depth.uModel, false, matrix([cy, 0, sy], [0, 1, 0], [-sy, 0, cy], [a.x, a.y, a.z]));
        this.draw(this.actors[a.team + a.gun])
      }
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    this.shadowReady = true
  }
  collectLights(match, eye, fwd, right, up, time) {
    this.lightPos.fill(0);
    this.lightCol.fill(0);
    if (!match)return;
    const list = [];
    const pl = match.player;
    if (pl?.alive && pl.flash > .005) {
      const f = clamp(pl.flash / .11, 0, 1);
      const mp = add(eye, add(scale(fwd, .85), add(scale(right, .14), scale(up, -.12))));
      const col = pl.gun === 'MS10' ? [.48, 1.45, 1.8] : pl.gun === 'DF1 OUT' ? [.48, 1.45, 1.25] : [1.8, 1.2, .52];
      list.push({p: mp, i: f * 3.8, c: col, pri: 100})
    }
    for (const e of match.effects) {
      if (list.length >= 12)break;
      const d = Math.hypot(e.p[0] - eye[0], e.p[1] - eye[1], e.p[2] - eye[2]);
      if (d > 48)continue;
      const frac = clamp(e.life / (e.max || .2), 0, 1);
      if (e.kind === 'kill') list.push({p: e.p, i: frac * 5.2, c: [1.8, 1.25, .48], pri: 90 - d});
      else if (e.kind === 'break') list.push({p: e.p, i: frac * 4.5, c: [.45, 1.65, 1.9], pri: 85 - d});
      else if (e.kind === 'tanker') list.push({p: e.p, i: frac * 6.0, c: [.55, 1.8, 1.55], pri: 88 - d});
      else if (e.kind === 'muzzle' && !e.human) list.push({p: e.p, i: frac * 3.0, c: e.gun === 'MS10' ? [.42, 1.4, 1.8] : [1.7, 1.05, .42], pri: 70 - d});
      else if (e.kind === 'shield') list.push({p: e.p, i: frac * 2.5, c: [.45, 1.5, 1.65], pri: 65 - d});
      else if (e.kind === 'hit' || e.kind === 'wall') list.push({p: e.p, i: frac * 2.0, c: e.gun === 'MS10' ? [.48, 1.4, 1.7] : [1.5, .95, .42], pri: 50 - d})
    }
    for (const s of match.shots) {
      const d = Math.hypot(s.p[0] - eye[0], s.p[2] - eye[2]);
      if (d > 38)continue;
      const c = s.gun === 'MS10' ? [.42, 1.5, 1.9] : s.team ? [1.5, .82, .38] : [.55, 1.5, 1.25];
      list.push({p: s.p, i: s.gun === 'MS10' ? 2.4 : 1.35, c, pri: 55 - d})
    }
    if (match.tankers) {
      for (const tk of match.tankers) {
        const d = Math.hypot(tk.x - eye[0], tk.z - eye[2]);
        if (d > 56)continue;
        const ready = tk.cooldown <= 0;
        const pulse = ready ? (.95 + Math.sin(time * 3.6 + tk.id) * .25) : .45;
        list.push({p: [tk.x, 2.35, tk.z], i: (ready ? 2.8 : 1.1) * pulse, c: ready ? [.42, 1.35, 1.22] : [1.2, .75, .32], pri: 35 - d * .5})
      }
    }
    list.sort((a, b) => b.pri - a.pri);
    for (let k = 0; k < Math.min(6, list.length); k++) {
      const L = list[k];
      this.lightPos.set([L.p[0], L.p[1], L.p[2], L.i], k * 4);
      this.lightCol.set(L.c, k * 3)
    }
  }
  worldPass(vp, eye, output, match, shadow, quality, time) {
    const gl = this.gl, p = this.world;
    gl.useProgram(p.obj);
    gl.uniformMatrix4fv(p.uVP, false, vp);
    gl.uniformMatrix4fv(p.uModel, false, I);
    gl.uniformMatrix4fv(p.uLight, false, this.light);
    gl.uniform2f(p.uGait, 0, 0);
    gl.uniform3f(p.uPose, 0, 0, 0);
    gl.uniform3f(p.uHit, 0, 0, 0);
    gl.uniform2f(p.uRecoil, 0, 0);
    gl.uniform2f(p.uHitFX, 0, 0);
    gl.uniform1f(p.uGunHeat, 0);
    gl.uniform1f(p.uTime, time);
    gl.uniform1i(p.uMode, 0);
    gl.uniform1i(p.uOutput, output);
    gl.uniform1i(p.uQuality, quality);
    gl.uniform1i(p.uShadows, shadow ? 1 : 0);
    gl.uniform3fv(p.uEye, eye);
    gl.uniform4fv(p.uActors, this.actorData);
    gl.uniform4fv(p.uLights, this.lightPos);
    gl.uniform3fv(p.uLightCol, this.lightCol);
    this.draw(this.terrain)
  }
  blurPass(src, dst, dx, dy) {
    const gl = this.gl, bp = this.blurP;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(bp.obj);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(bp.uDir, dx / src.w, dy / src.h);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  render(cam, time, match = null, view = {}) {
    const gl = this.gl,
      cfg = this.config,
      quality = this.quality(),
      extra = quality >= 2,
      eye = cam.pos,
      fwd = unit(sub(cam.target, eye)),
      right = unit(cross(fwd, [0, 1, 0])),
      up = cross(right, fwd),
      fy = Math.tan(cam.fov * Math.PI / 360),
      fx = fy * this.aspect,
      proj = perspective(cam.fov * Math.PI / 180, this.aspect),
      vp = multiply(proj, lookAt(eye, cam.target));

    if (extra) this.ensurePost(this.canvas.width, this.canvas.height);
    this.lastVP = vp;
    this.actorData.fill(0);
    if (match)match.actors.forEach((a, i) => this.actorData.set([a.x, a.y, a.z, a.alive ? 1 : 0], i * 4));
    this.collectLights(match, eye, fwd, right, up, time);

    if (cfg.shadows && (!this.shadowReady || (extra && match)))this.makeShadows(match);

    for (const [i, type, tex] of [[0, gl.TEXTURE_2D_ARRAY, this.textures.tex], [1, gl.TEXTURE_2D, this.shadowTex], [2, gl.TEXTURE_2D, this.textures.sky], [3, gl.TEXTURE_2D, this.wave], [4, gl.TEXTURE_2D, this.mirrorTex]]) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(type, tex)
    }

    const seeWater = !match || eye[0] < 1 || fwd[0] < -.16;
    const mirrorInterval = extra ? .045 : .18;
    if (seeWater && (time - this.mirrorAt > mirrorInterval || time < this.mirrorAt)) {
      this.mirrorAt = time;
      const ref = p => [p[0], -3.36 - p[1], p[2]], re = ref(eye);
      this.mirrorVP = multiply(proj, lookAt(re, ref(cam.target), [0, -1, 0]));
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mirrorFB);
      gl.viewport(0, 0, this.mirrorDim[0], this.mirrorDim[1]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.worldPass(this.mirrorVP, re, 3, null, cfg.shadows, Math.min(1, quality), time)
    }

    const targetFB = extra && this.post ? this.post.scene.fb : null;
    const finalOutput = this.hdrDisplay.active ? 2 : cfg.hdr ? 1 : 0;
    const sceneOutput = targetFB ? 4 : finalOutput;

    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFB);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(.24, .35, .39, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.worldPass(vp, eye, sceneOutput, match, cfg.shadows, quality, time);

    const p = this.world;
    if (match) {
      gl.uniform1i(p.uMode, 1);
      for (const a of match.actors) {
        if (!a.alive || (a.human && a.alive))continue;
        const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
        const rVec = [cy, 0, sy], bVec = [-sy, 0, cy];
        let hitX = 0, hitZ = 1;
        if (a.hitDir) {
          hitX = clamp(dot(a.hitDir, rVec), -1, 1);
          hitZ = clamp(dot(a.hitDir, bVec), -1, 1)
        }
        gl.uniformMatrix4fv(p.uModel, false, matrix(rVec, [0, 1, 0], bVec, [a.x, a.y, a.z]));
        gl.uniform2f(p.uGait, a.stride * 2.75, clamp(Math.hypot(a.vx, a.vz) / 4, 0, 1));
        gl.uniform3f(p.uPose, a.crouch, a.lean, a.aimPose);
        gl.uniform3f(p.uHit, a.hitRecoil || 0, hitX, hitZ);
        gl.uniform2f(p.uRecoil, a.recoil || 0, a.recoilSide || 0);
        gl.uniform2f(p.uHitFX, a.hitFlash || 0, a.shieldFlash || 0);
        this.draw(this.actors[a.team + a.gun])
      }
    }

    gl.uniform1i(p.uMode, 0);
    gl.uniformMatrix4fv(p.uModel, false, I);
    gl.uniform3f(p.uHit, 0, 0, 0);
    gl.uniform2f(p.uRecoil, 0, 0);
    gl.uniform2f(p.uHitFX, 0, 0);
    const fxMesh = movingDetails(match, time, extra);
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
    gl.uniform1i(sk.uQuality, quality);
    gl.uniform1i(sk.uHasMirror, seeWater && this.mirrorVP ? 1 : 0);
    gl.uniformMatrix4fv(sk.uMirrorVP, false, this.mirrorVP || I);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // First-person weapon with full kinematic spring recoil, blowback, reload choreography, sway, and 3D muzzle flash.
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
        progress = a.reload > 0 ? 1 - a.reload / weapons[a.gun].reload : 0;

      // Multi-stage reload choreography: tilt out -> drop mag -> slam in -> level back
      let relDrop = 0, relPitch = 0, relRoll = 0, relX = 0;
      if (progress > 0) {
        const s = Math.sin(progress * Math.PI);
        const slam = progress > .62 && progress < .82 ? Math.sin((progress - .62) / .20 * Math.PI) : 0;
        relDrop = s * .15 - slam * .028;
        relPitch = -s * .58 + slam * .14;
        relRoll = s * .42;
        relX = -s * .055
      }

      const stride = Math.sin(a.stride * 2.65),
        speed = Math.min(1, Math.hypot(a.vx, a.vz) / 4.8),
        crouchRoll = a.crouch * .12,
        crouchX = -a.crouch * .022;
      const bx = .205 + stride * .010 * speed + swayX + relX + crouchX;
      const by = -.205 + Math.cos(a.stride * 5.3) * .006 * speed - relDrop + kY + swayY - landDrop;
      const bz = .54 - kZ;

      const base = add(eye, add(scale(right, bx), add(scale(up, by), scale(fwd, bz))));
      const basis = rotateBasis(right, up, fwd, relPitch + kPitch - swayY * 1.4, kYaw + swayX * 1.6, relRoll + kRoll + crouchRoll - swayX * 2.2);
      // Dedicated FPS viewmodel FOV (66°) keeps the weapon crisp & unclipped even at 2/3 world view width!
      const fpVP = multiply(perspective(66 * Math.PI / 180, this.aspect, .04, 50), lookAt(eye, cam.target));
      const modelM = matrix(basis.right, basis.up, basis.back, base);

      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(p.obj);
      gl.uniformMatrix4fv(p.uVP, false, fpVP);
      gl.uniform1i(p.uMode, 2);
      gl.uniform2f(p.uRecoil, blowback, a.recoilSide || 0);
      gl.uniform1f(p.uGunHeat, gunHeat);
      gl.uniformMatrix4fv(p.uModel, false, modelM);
      this.draw(this.devices[a.gun]);

      if (a.flash > .005) {
        const mf = muzzleFlashMesh(a.gun, clamp(a.flash / .11, 0, 1), a.shotCount || 1, extra);
        this.fpFlash.count = mf.count;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fpFlash.buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mf.data), gl.DYNAMIC_DRAW);
        gl.uniform2f(p.uRecoil, 0, 0);
        gl.uniform1f(p.uGunHeat, 0);
        this.draw(this.fpFlash)
      }
    }

    // Extra Graphics Post-Processing: Dual-stage HDR Bloom + FXAA + Dynamic Chromatic Aberration + Cinematic Grade
    if (targetFB && this.post) {
      gl.disable(gl.DEPTH_TEST);
      // 1. Extract HDR highlights to half-res bloom A0
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.post.a0.fb);
      gl.viewport(0, 0, this.post.a0.w, this.post.a0.h);
      gl.useProgram(this.bloomEx.obj);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.post.scene.tex);
      gl.bindVertexArray(this.empty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 2. Separable Gaussian blur on half-res A (tight bloom)
      this.blurPass(this.post.a0, this.post.a1, 1, 0);
      this.blurPass(this.post.a1, this.post.a0, 0, 1);

      // 3. Downsample + wide separable Gaussian blur on quarter-res B (cinematic halo)
      this.blurPass(this.post.a0, this.post.b0, 1.4, 0);
      this.blurPass(this.post.b0, this.post.b1, 0, 1.4);
      this.blurPass(this.post.b1, this.post.b0, 2.0, 0);
      this.blurPass(this.post.b0, this.post.b1, 0, 2.0);

      // 4. Composite FXAA + Dual Bloom + Chromatic Aberration + Vignette + Tone Mapping
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.compP.obj);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.post.scene.tex);
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, this.post.a0.tex);
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, this.post.b1.tex);
      gl.uniform1i(this.compP.uOutput, finalOutput);
      gl.uniform1f(this.compP.uShake, clamp(view.shake || 0, 0, 1));
      gl.uniform1f(this.compP.uHurt, clamp(view.hurt || 0, 0, 1));
      gl.uniform1f(this.compP.uTime, time);
      gl.bindVertexArray(this.empty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST)
    }

    this.hdrDisplay.present(this.canvas)
  }
}
