import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';

const dist = process.env.RESULT_QA_SOURCE
  ? pathToFileURL(resolve(process.env.RESULT_QA_SOURCE, 'dist') + '/')
  : new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
const load = module => import(new URL('js/' + module + '.js', dist));

const {Match} = await load('match');
const {Renderer, effectiveSize} = await load('renderer');
const {SoftwareRenderer} = await load('software');
const {obstacles, obstruction, obstructionCoords, raycastMaterial, raycastMaterialOut, rayBox} = await load('yard');
const {solveCharacterPalette, RIG_BONE_COUNT} = await load('rig');
const {WharfNavigation, NV1} = await load('nv1');
const {NV12} = await load('nv12');
const {NV13Pro} = await load('nv13pro');
const {NV2, NV2NeuralCore} = await load('nv2');
const {ResonanceCore} = await load('resonance');
const {AeroVortex} = await load('aerovortex');
const {movingDetails} = await load('models');
const {Mesh} = await load('geometry');

let appId = 0;

const settle = async (condition = () => true) => {
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (condition()) return;
  }
  assert(condition(), 'application did not settle');
};

function install(t, globals) {
  for (const [key, value] of Object.entries(globals)) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {value, writable: true, configurable: true});
    t.after(() => before ? Object.defineProperty(globalThis, key, before) : delete globalThis[key]);
  }
}

async function bootApp(t, {prefs = {}, width = 1024, height = 720} = {}) {
  const dom = new JSDOM(html, {url: 'https://result.test/dist/', pretendToBeVisual: true});
  const w = dom.window, d = w.document, frames = [];
  const media = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  Object.defineProperties(w.navigator, {maxTouchPoints: {value: 0}, getGamepads: {value: () => []}});
  let fsCalls = 0;
  Object.defineProperty(d, 'fullscreenElement', {configurable: true, get: () => null});
  d.documentElement.requestFullscreen = () => { fsCalls++; return Promise.resolve(); };
  install(t, {
    document: d, window: w, navigator: w.navigator, localStorage: w.localStorage,
    indexedDB: undefined, BroadcastChannel: undefined, matchMedia: media,
    innerWidth: width, innerHeight: height, requestAnimationFrame: fn => frames.push(fn)
  });
  t.after(() => w.close());
  localStorage.setItem('result.harbor.v1', JSON.stringify(prefs));
  const canvases = new WeakMap();
  const gl = {
    MAX_TEXTURE_SIZE: 'texture', MAX_RENDERBUFFER_SIZE: 'framebuffer', MAX_VIEWPORT_DIMS: 'viewport',
    getParameter: param => param === 'viewport' ? [4096, 4096] : 4096,
    isContextLost: () => false, getExtension: () => null
  };
  t.mock.method(w.HTMLCanvasElement.prototype, 'getContext', function (kind) {
    if (kind === 'webgl2') return gl;
    if (kind !== '2d') return null;
    if (!canvases.has(this)) canvases.set(this, createCanvas(this.width || 1, this.height || 1));
    const ctx = canvases.get(this).getContext('2d');
    if (!ctx.drawImage.resolveCanvas) {
      const drawImage = ctx.drawImage.bind(ctx);
      ctx.drawImage = (source, ...args) => drawImage(canvases.get(source) || source, ...args);
      ctx.drawImage.resolveCanvas = true;
    }
    return ctx;
  });
  let currentMatch = null;
  for (const Device of [Renderer, SoftwareRenderer]) {
    t.mock.method(Device.prototype, 'init', async function () {});
    t.mock.method(Device.prototype, 'settings', function (config) { this.config = {...config}; this.resize(); });
    t.mock.method(Device.prototype, 'resize', function () {
      const size = effectiveSize(this.config);
      this.canvas.width = size[0]; this.canvas.height = size[1]; this.aspect = width / height;
    });
    t.mock.method(Device.prototype, 'render', function (_cam, _time, match) { currentMatch = match; });
  }
  const $ = id => d.getElementById(id);
  const click = id => $(id).click();
  const select = (id, value) => $(id).querySelector(`[data-value="${value}"]`).click();
  const key = (code, opts = {}) => d.dispatchEvent(new w.KeyboardEvent('keydown', {code, bubbles: true, ...opts}));
  let ms = 0;
  const frame = (inc = 16.667) => { ms += inc; assert(frames.length); frames.shift()(ms); };
  await import(new URL('js/app.js?hc=' + ++appId, dist));
  await settle(() => $('app').classList.contains('render-ready'));
  return {
    d, w, $, click, select, key, frame,
    getFsCalls: () => fsCalls,
    match: () => currentMatch
  };
}

// ============================================================================
// UI/UX REQUIREMENTS 1-5 VERIFICATION
// ============================================================================

test('HC-UI01 | Mode selection is strictly 3V3 and 実験場 (lab), with legacy fallback to 3v3', async t => {
  const ui = await bootApp(t, {prefs: {mode: '5v5'}});
  ui.click('play');
  const modeBtns = [...ui.$('modes').querySelectorAll('button[data-value]')];
  assert.deepEqual(modeBtns.map(b => b.dataset.value), ['3v3', 'lab']);
  assert.equal(ui.$('modes').querySelector('[data-value="3v3"]').getAttribute('aria-pressed'), 'true');
  ui.select('modes', 'lab');
  assert.equal(ui.$('labConfig').hidden, false);
  assert.equal(ui.$('autoAimWrap').hidden, true);
  ui.select('modes', '3v3');
  assert.equal(ui.$('labConfig').hidden, true);
  assert.equal(ui.$('autoAimWrap').hidden, false);
});

test('HC-UI02 | Match Setup (#lobby) has STEP 1-4 clarity: stepper, weapon stats, live summary', async t => {
  const ui = await bootApp(t);
  ui.click('play');
  assert.equal(ui.d.body.dataset.screen, 'lobby');
  assert(ui.$('weaponStats').textContent.length > 0, 'weaponStats should display weapon specs');
  assert(ui.$('lobbySummary').textContent.includes('3V3'), 'lobbySummary should reflect 3V3');
  const beforeMult = Number(ui.$('mult').value);
  ui.click('multPlus');
  assert.equal(Number(ui.$('mult').value), beforeMult + 1);
  ui.click('multMinus');
  assert.equal(Number(ui.$('mult').value), beforeMult);
});

test('HC-UI03 | Only NV2.6 NPC version is displayed in UI while underlying AI classes stay intact', async t => {
  const ui = await bootApp(t);
  ui.click('play');
  const optsA = [...ui.$('labAiA').options].map(o => o.textContent.trim());
  const optsB = [...ui.$('labAiB').options].map(o => o.textContent.trim());
  assert.deepEqual(optsA, ['NV2.6 Force']);
  assert.deepEqual(optsB, ['NV2.6 Force']);
  assert.equal(ui.$('lobbyAiLabel').textContent.trim(), 'NV2.6 Force');

  // Underlying AI engine classes remain intact programmatically
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T'});
  assert.equal(typeof NV1, 'function');
  assert.equal(typeof NV12, 'function');
  assert.equal(typeof NV13Pro, 'function');
  assert.equal(typeof NV2, 'function');
  assert(new NV1(m) instanceof NV1);
  assert(new NV12(m) instanceof NV12);
  assert(new NV13Pro(m) instanceof NV13Pro);
});

test('HC-UI04 | Zero fullscreen buttons exist in DOM; tapping screen triggers fullscreen except form inputs', async t => {
  const ui = await bootApp(t);
  for (const id of ['fullscreenTitle', 'lobbyFullscreen', 'fullscreenSettings', 'hudFullscreen', 'pauseFullscreen']) {
    assert.equal(ui.$(id), null, `Fullscreen button #${id} must be removed`);
  }
  const before = ui.getFsCalls();
  // Click inside a select element should NOT trigger fullscreen
  ui.$('labAiA').dispatchEvent(new ui.w.MouseEvent('click', {bubbles: true}));
  assert.equal(ui.getFsCalls(), before, 'Interacting with <select> must not trigger auto-fullscreen');
  // Click on the title canvas / main area triggers fullscreen
  ui.$('play').dispatchEvent(new ui.w.MouseEvent('click', {bubbles: true}));
  assert(ui.getFsCalls() > before, 'Tapping screen should auto-request fullscreen');
});

test('HC-UI05 | Auto-Aim is changeable ONLY in Match Setup (#lobby); no non-lobby controls or KeyO toggle', async t => {
  const ui = await bootApp(t, {prefs: {autoAim: true}});
  // Zero non-lobby Auto-Aim controls
  for (const id of ['autoAimSwitch', 'hudAutoAim', 'pauseAutoAim', 'lobbyAutoAim']) {
    assert.equal(ui.$(id), null, `Non-lobby Auto-Aim control #${id} must be removed`);
  }
  ui.click('play');
  assert(ui.$('lobby').contains(ui.$('autoAimMode')), 'autoAimMode must reside inside #lobby');
  ui.select('autoAimMode', 'off');
  ui.click('start');
  ui.frame();
  assert.equal(ui.match().autoAim, false);
  // Pressing KeyO in-game must NOT toggle Auto-Aim
  ui.key('KeyO');
  ui.frame();
  assert.equal(ui.match().autoAim, false, 'KeyO must not change Auto-Aim outside Match Setup');
});

// ============================================================================
// HYPERCORE ALGORITHMIC PARITY & QUALITY-PRESERVATION VERIFICATION
// ============================================================================

test('HC-ALG01 | ZeroGC-RaySlab (obstructionCoords & raycastMaterialOut) exact parity vs brute force over 200 rays', () => {
  let s = 1337;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const deck = {x0: -25, x1: 25, y0: -3.1, y1: 0, z0: -100, z1: 100};
  const out = {
    t: 0, tExit: 0, point: [0, 0, 0], normal: [0, 1, 0],
    exitPoint: null, exitNormal: null, _exitPt: [0, 0, 0], _exitNrm: [0, 1, 0],
    thickness: Infinity, mat: 'steel', box: null
  };
  for (let i = 0; i < 200; i++) {
    const a = [(rnd() - 0.5) * 48, 0.2 + rnd() * 5.0, (rnd() - 0.5) * 190];
    const b = [(rnd() - 0.5) * 48, 0.1 + rnd() * 5.0, (rnd() - 0.5) * 190];
    let brute = Infinity;
    if (!(a[1] >= 0 && (b[1] > 0 || a[1] === b[1]))) brute = Math.min(brute, rayBox(a, b, deck));
    for (const o of obstacles) {
      const t = rayBox(a, b, o);
      if (t < brute) brute = t;
    }
    const fast = obstructionCoords(a[0], a[1], a[2], b[0], b[1], b[2]);
    const obsA = obstruction(a, b);
    const hasHit = raycastMaterialOut(a[0], a[1], a[2], b[0], b[1], b[2], out);
    const matHit = raycastMaterial(a, b);
    if (!Number.isFinite(brute)) {
      assert(!Number.isFinite(fast) && !Number.isFinite(obsA), `Ray ${i}: expected miss`);
      assert.equal(hasHit, false);
      assert.equal(matHit, null);
    } else {
      assert(Math.abs(fast - brute) < 1e-9, `Ray ${i}: obstructionCoords mismatch ${fast} vs ${brute}`);
      assert(Math.abs(obsA - brute) < 1e-9, `Ray ${i}: obstruction mismatch`);
      assert.equal(hasHit, true);
      assert(Math.abs(out.t - brute) < 1e-9, `Ray ${i}: raycastMaterialOut t mismatch`);
      assert(Math.abs(matHit.t - brute) < 1e-9, `Ray ${i}: raycastMaterial t mismatch`);
    }
  }
});

test('HC-ALG02 | RigCore-Zero 20-bone palette produces finite orthonormal-valid transforms', () => {
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T'});
  const a = m.actors[1];
  const palette = new Float32Array(RIG_BONE_COUNT * 12);
  solveCharacterPalette(a, 1.25, palette);
  assert.equal(palette.length, 20 * 12);
  let nonZero = 0;
  for (let i = 0; i < palette.length; i++) {
    assert(Number.isFinite(palette[i]), `Non-finite bone matrix element at ${i}`);
    if (palette[i] !== 0) nonZero++;
  }
  assert(nonZero > 40, 'Bone palette must contain active affine transforms');
});

test('HC-ALG03 | ZeroAlloc-AStar finds valid walkable paths', () => {
  const nav = new WharfNavigation();
  const path = nav.route([-12, -45], [12, 45]);
  assert(Array.isArray(path) && path.length >= 2, 'A* should return valid waypoint path');
  for (const pt of path) {
    assert(Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
  }
});

test('HC-ALG04 | CausalKV-Memo produces exact policy & value parity with full recomputation', () => {
  const core = new NV2NeuralCore();
  const T_CTX = 16, D_IN = 12;
  const tokenBuf = new Float32Array(T_CTX * D_IN);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < D_IN; j++) tokenBuf[i * D_IN + j] = Math.sin(i * 1.7 + j * 0.9) * 0.6;
  }
  const teamCache = {tokenSeq: 1};
  const out1 = core.forward(tokenBuf, 6, 6, false, teamCache);
  const out2 = core.forward(tokenBuf, 6, 6, false, null); // cold uncached compute
  const out3 = core.forward(tokenBuf, 6, 6, false, teamCache); // cached hit
  assert(Math.abs(out1.value - out2.value) < 1e-5, 'Value parity mismatch');
  assert.equal(out3, out1, 'Repeated unchanged sequence should hit CausalKV-Memo cache');
  for (let i = 0; i < out1.piProbs.length; i++) {
    assert(Math.abs(out1.piProbs[i] - out2.piProbs[i]) < 1e-5, `piProbs[${i}] mismatch`);
  }
  for (let i = 0; i < out1.predProbs.length; i++) {
    assert(Math.abs(out1.predProbs[i] - out2.predProbs[i]) < 1e-5, `predProbs[${i}] mismatch`);
  }
});

test('HC-ALG05 | ClosedForm ResonanceCore 60Hz coalesced step preserves damped harmonic parity', () => {
  const rA = new ResonanceCore();
  const rB = new ResonanceCore();
  const c0 = rA.containers[0];
  const hitPt = [c0.cx, c0.cy, c0.cz];
  rA.exciteStrike(hitPt, 1.0, null, null);
  rB.exciteStrike(hitPt, 1.0, null, null);
  for (let i = 0; i < 180; i++) rA.step(1 / 360);
  for (let i = 0; i < 30; i++) rB.step(1 / 60);
  assert(rA._activeList.length > 0 && rB._activeList.length > 0);
  assert(Math.abs(rA._activeList[0].q[0] - rB._activeList[0].q[0]) < 1e-4, 'Resonance modal displacement parity');
  assert(Math.abs(rA._activeList[0].energy - rB._activeList[0].energy) < 1e-4, 'Resonance energy parity');
});

test('HC-ALG06 | AeroClip-3D smokeBounds & zero-alloc sampleSmoke/smokeOcclusion parity', () => {
  const av = new AeroVortex();
  assert.equal(av.sampleSmoke(0, 0), 0);
  assert.equal(av.smokeOcclusion([0, 1.5, -10], [0, 1.5, 10]), 0);
  av.deploySmokeVent(0, 0, 0, -1);
  for (let i = 0; i < 8; i++) av.stepFluid(1 / 24);
  assert(av.smokeBounds[2] > av.smokeBounds[0], 'Active smoke should have valid non-empty AABB');
  assert(av.sampleSmoke(0, 0) > 0.05, 'sampleSmoke must report smoke inside vent');
  assert(av.smokeOcclusion([0, 1.5, -10], [0, 1.5, 10]) > 0.1, 'smokeOcclusion must detect ray crossing smoke');
  assert.equal(av.smokeOcclusion([20, 1.5, -90], [20, 1.5, -70]), 0, 'Ray outside smokeBounds must return 0');
});

test('HC-ALG07 | PropTemplate-Stamp, octaS, continuous ringS, unitSphere ellipsoidS & full/lite vertex ratio', () => {
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'DF40 II'});
  m.trigger(m.player);
  for (let i = 0; i < 18; i++) m.step(1 / 360, {forward: 0.4});
  const stream = new Mesh();
  const fxFull = movingDetails(m, m.time, true, false, {streamMesh: stream});
  const fullCount = fxFull.count;
  const fullData = fxFull.data;
  for (let i = 0; i < fullData.length; i++) assert(Number.isFinite(fullData[i]), `Non-finite vertex float at ${i}`);
  const fxLite = movingDetails(m, m.time, false, true);
  assert(fullCount > fxLite.count * 2.5, `Expected full (${fullCount}) > 2.5x lite (${fxLite.count})`);
});

test('HC-ALG08 | kFastGamma 3-sqrt approximation has < 0.02 LSB mean error and < 0.35 LSB max error across [0,1]', () => {
  const kFastGamma = x => {
    const cx = Math.min(1, Math.max(0, x));
    const s1 = Math.sqrt(cx), s2 = Math.sqrt(s1), s3 = Math.sqrt(s2);
    return Math.min(1, Math.max(0, 0.8628615 * s1 + 0.2199532 * s2 - 0.0571716 * s3 - 0.0257696 * cx));
  };
  let maxErrLSB = 0, sumErrLSB = 0;
  const N = 1000;
  for (let i = 0; i <= N; i++) {
    const x = i / N;
    const exact = Math.pow(x, 1 / 2.2);
    const approx = kFastGamma(x);
    const errLSB = Math.abs(approx - exact) * 255;
    sumErrLSB += errLSB;
    if (errLSB > maxErrLSB) maxErrLSB = errLSB;
  }
  const meanErrLSB = sumErrLSB / (N + 1);
  assert(meanErrLSB < 0.03, `kFastGamma mean error ${meanErrLSB.toFixed(4)} LSB exceeds 0.03 LSB`);
  assert(maxErrLSB < 0.5, `kFastGamma max error ${maxErrLSB.toFixed(4)} LSB exceeds 0.5 LSB`);
});
