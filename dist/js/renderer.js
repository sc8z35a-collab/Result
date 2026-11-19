import {STRIDE, add, sub, scale, unit, cross, multiply, lookAt, perspective, ortho, clamp, forward} from './geometry.js';
import {loadTextures} from './materials.js';
import {buildHarbor} from './harbor.js';
import {character, viewModel, movingDetails} from './models.js';
import {weapons, npcWeapons} from './match.js';
import * as shader from './shaders.js';
import {HDRDisplay} from './hdr.js';
const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export const sizes = {HD: [1280, 720], FHD: [1920, 1080], '2K': [2560, 1440]};
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
const matrix = (right, up, back, p) => new Float32Array([...right, 0, ...up, 0, ...back, 0, ...p, 1]);
export class Renderer {
  constructor(canvas, hdrCanvas) {
    this.canvas = canvas;
    this.hdrDisplay = new HDRDisplay(hdrCanvas);
    this.gl = canvas.getContext('webgl2', {alpha: false, antialias: true, premultipliedAlpha: false, powerPreference: 'high-performance'});
    if (!this.gl)throw Error('WebGL 2 を初期化できません');
    this.mirrorAt = -10;
    this.shadowReady = false;
    this.native = true
  }
  async init() {
    const gl = this.gl;
    this.world = program(gl, shader.worldVS, shader.worldFS);
    this.skyP = program(gl, shader.skyVS, shader.skyFS);
    this.depth = program(gl, shader.shadowVS, shader.shadowFS);
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
    this.mirrorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.mirrorTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 512, 288);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.mirrorFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mirrorFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.mirrorTex, 0);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 512, 288);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)throw Error('水面バッファを作成できません');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    this.setSamplers(this.world, {uMats: 0, uShadow: 1, uSky: 2});
    this.setSamplers(this.skyP, {uSky: 2, uWaves: 3, uMirror: 4});
    this.actorData = new Float32Array(24)
  }
  setSamplers(p, pairs) {
    this.gl.useProgram(p.obj);
    for (const [k, v] of Object.entries(pairs))if (p[k] != null)this.gl.uniform1i(p[k], v)
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
    this.aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight)
  }
  draw(mesh) {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count)
  }
  makeShadows() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.depth.obj);
    gl.uniformMatrix4fv(this.depth.uVP, false, this.light);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.1, 2);
    this.draw(this.terrain);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    this.shadowReady = true
  }
  worldPass(vp, eye, output, match, shadow) {
    const gl = this.gl, p = this.world;
    gl.useProgram(p.obj);
    gl.uniformMatrix4fv(p.uVP, false, vp);
    gl.uniformMatrix4fv(p.uModel, false, I);
    gl.uniformMatrix4fv(p.uLight, false, this.light);
    gl.uniform2f(p.uGait, 0, 0);
    gl.uniform1i(p.uMode, 0);
    gl.uniform1i(p.uOutput, output);
    gl.uniform1i(p.uShadows, shadow ? 1 : 0);
    gl.uniform3fv(p.uEye, eye);
    gl.uniform4fv(p.uActors, this.actorData);
    this.draw(this.terrain)
  }
  render(cam, time, match = null, view = {}) {
    const gl = this.gl,
      cfg = this.config,
      eye = cam.pos,
      fwd = unit(sub(cam.target, eye)),
      right = unit(cross(fwd, [0, 1, 0])),
      up = cross(right, fwd),
      fy = Math.tan(cam.fov * Math.PI / 360),
      fx = fy * this.aspect,
      proj = perspective(cam.fov * Math.PI / 180, this.aspect),
      vp = multiply(proj, lookAt(eye, cam.target));
    this.lastVP = vp;
    this.actorData.fill(0);
    if (match)match.actors.forEach((a, i) => this.actorData.set([a.x, a.y, a.z, a.alive ? 1 : 0], i * 4));
    if (cfg.shadows && !this.shadowReady)this.makeShadows();
    for (const [i, type, tex] of [[0, gl.TEXTURE_2D_ARRAY, this.textures.tex], [1, gl.TEXTURE_2D, this.shadowTex], [2, gl.TEXTURE_2D, this.textures.sky], [3, gl.TEXTURE_2D, this.wave], [4, gl.TEXTURE_2D, this.mirrorTex]]) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(type, tex)
    }
    const seeWater = !match || eye[0] < 1 || fwd[0] < -.16;
    if (seeWater && (time - this.mirrorAt > .18 || time < this.mirrorAt)) {
      this.mirrorAt = time;
      const ref = p => [p[0], -3.36 - p[1], p[2]], re = ref(eye);
      this.mirrorVP = multiply(proj, lookAt(re, ref(cam.target), [0, -1, 0]));
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mirrorFB);
      gl.viewport(0, 0, 512, 288);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.worldPass(this.mirrorVP, re, 3, null, cfg.shadows)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(.24, .35, .39, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const output = this.hdrDisplay.active ? 2 : cfg.hdr ? 1 : 0;
    this.worldPass(vp, eye, output, match, cfg.shadows);
    const p = this.world;
    if (match) {
      gl.uniform1i(p.uMode, 1);
      for (const a of match.actors) {
        if (!a.alive || (a.human && a.alive))continue;
        const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
        gl.uniformMatrix4fv(p.uModel, false, matrix([cy, 0, sy], [0, 1, 0], [-sy, 0, cy], [a.x, a.y, a.z]));
        gl.uniform2f(p.uGait, a.stride * 2.75, clamp(Math.hypot(a.vx, a.vz) / 4, 0, 1));
        gl.uniform3f(p.uPose, a.crouch, a.lean, a.aimPose);
        this.draw(this.actors[a.team + a.gun])
      }
    }
    gl.uniform1i(p.uMode, 0);
    gl.uniformMatrix4fv(p.uModel, false, I);
    const fxMesh = movingDetails(match, time);
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
    gl.uniform1i(sk.uOutput, output);
    gl.uniform1i(sk.uHasMirror, seeWater && this.mirrorVP ? 1 : 0);
    gl.uniformMatrix4fv(sk.uMirrorVP, false, this.mirrorVP || I);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (match?.player.alive && view.firstPerson) {
      const a = match.player,
        k = view.kick || 0,
        progress = a.reload > 0 ? 1 - a.reload / weapons[a.gun].reload : 0,
        drop = Math.sin(progress * Math.PI),
        stride = Math.sin(a.stride * 2.6),
        speed = Math.min(1, Math.hypot(a.vx, a.vz) / 4);
      const bx = .210 + stride * .008 * speed, by = -.206 + Math.cos(a.stride * 5.2) * .005 * speed - drop * .14 + k * .014, bz = .55 - k * .062;
      const base = add(eye, add(scale(right, bx), add(scale(up, by), scale(fwd, bz))));
      const angle = -drop * .7 + k * .095,
        gu = add(scale(up, Math.cos(angle)), scale(fwd, -Math.sin(angle))),
        gb = add(scale(fwd, -Math.cos(angle)), scale(up, -Math.sin(angle)));
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(p.obj);
      gl.uniform1i(p.uMode, 2);
      gl.uniformMatrix4fv(p.uModel, false, matrix(right, gu, gb, base));
      this.draw(this.devices[a.gun])
    }
    this.hdrDisplay.present(this.canvas)
  }
}
