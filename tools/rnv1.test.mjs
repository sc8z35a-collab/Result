import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {createCanvas} from '@napi-rs/canvas';

import {Match} from '../dist/js/match.js';
import {AI_VERSION_LIST, aiVersionDisplay, ArenaCompositeAI, normalizeAiModelId} from '../dist/js/ai-arena.js';
import {
  RNV1, RNV1_VERSION, RNV1_OBS_DIM, RNV1PolicyNet,
  validateRNV1Bundle, getRNV1Status, importRNV1WeightsJSON, resetRNV1Weights, buildRNV1Observation
} from '../dist/js/rnv1.js';
import {RNV1_BUNDLED_WEIGHTS} from '../dist/js/rnv1-weights.js';
import {obstruction} from '../dist/js/yard.js';
import {eyeOf, targetPoint} from '../dist/js/posture.js';
import {readPreferences} from '../dist/js/preferences.js';
import {Renderer, effectiveSize} from '../dist/js/renderer.js';
import {SoftwareRenderer} from '../dist/js/software.js';

const distUrl = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', distUrl), 'utf8');

function place(a, x, z, yaw = 0, y = 0) {
  a.x = x; a.y = y; a.z = z; a.yaw = yaw; a.pitch = 0;
  a.vx = a.vy = a.vz = 0;
  a.alive = true; a.onGround = true;
}

// ============================================================================
// 1. RNV1 Registration in AI_VERSION_LIST, Match & ArenaCompositeAI
// ============================================================================
test('RNV1-01 | RNV1 registers cleanly as 11th AI generation in Match, Lab, and ArenaCompositeAI', () => {
  assert.equal(RNV1_VERSION, 'RNV1');
  assert.equal(AI_VERSION_LIST.length, 11);
  assert.equal(AI_VERSION_LIST[0].id, 'rnv1');
  assert.equal(normalizeAiModelId('RNV1'), 'rnv1');
  assert.equal(aiVersionDisplay('rnv1'), 'RNV1');

  // Direct pure RNV1 match
  const mPure = new Match({mode: '3v3', limit: 'unlimited', aiModel: 'rnv1'});
  assert(mPure.nv instanceof RNV1, 'Pure RNV1 match must instantiate RNV1 engine directly');
  assert(mPure.actors.filter(a => !a.human).every(a => a.aiVersion === 'RNV1'));

  // Lab head-to-head RNV1 vs NV2.6 Force
  const mVs = new Match({
    mode: 'lab', limit: 'unlimited',
    lab: {playerRole: 'spectate', teamACount: 3, teamBCount: 3, teamAAi: 'rnv1', teamBAi: 'human'}
  });
  assert(mVs.nv instanceof ArenaCompositeAI, 'RNV1 vs NV2.6 Force must use ArenaCompositeAI');
  assert(mVs.actors.filter(a => a.team === 0).every(a => a.aiVersion === 'RNV1'));
  assert(mVs.actors.filter(a => a.team === 1).every(a => a.aiVersion === 'NV2.6 Force'));

  // Lab RNV1 vs RNV1 mirror match
  const mMirror = new Match({
    mode: 'lab', limit: 'unlimited',
    lab: {playerRole: 'spectate', teamACount: 2, teamBCount: 2, teamAAi: 'rnv1', teamBAi: 'rnv1'}
  });
  assert(mMirror.nv instanceof RNV1, 'RNV1 vs RNV1 mirror match should instantiate single RNV1 engine');
});

// ============================================================================
// 2. Weight Bundle Validation, Corruption Rejection & Forward-Pass Integrity
// ============================================================================
test('RNV1-02 | RNV1PolicyNet validates bundles, rejects corrupted weights, and runs zero-NaN GRU forward pass', () => {
  const ok = validateRNV1Bundle(RNV1_BUNDLED_WEIGHTS);
  assert.equal(ok.ok, true, 'Starter bundled weights must validate cleanly');
  const net = ok.net;
  assert.equal(net.obsDim, RNV1_OBS_DIM);
  assert(net.paramCount > 20000);

  // Reject wrong version / truncated data / missing tensor
  assert.equal(validateRNV1Bundle({version: 'NV2', schema: 1}).ok, false);
  assert.equal(validateRNV1Bundle({...RNV1_BUNDLED_WEIGHTS, tensors: {}}).ok, false);
  const badRes = importRNV1WeightsJSON('{bad json', {persist: false});
  assert.equal(badRes.ok, false);

  // Run multi-step GRU forward pass and verify slot masking & finite outputs
  const h = new Float32Array(net.hiddenDim);
  const obs = new Float32Array(RNV1_OBS_DIM);
  obs[59] = 1.0;  // VIS_0 valid
  obs[73] = 0.0;  // VIS_1 invalid -> masked to -1e4
  obs[101] = 0.0; // MEM_0 invalid -> masked to -1e4
  for (let step = 0; step < 8; step++) {
    const out = net.forward(obs, h);
    for (const v of out.cont) {
      assert(Number.isFinite(v) && v >= -1 && v <= 1, 'Continuous outputs must be finite in [-1, 1]');
    }
    assert.equal(out.aim[2], -1e4, 'Invalid VIS_1 slot must be masked');
    assert.equal(out.aim[4], -1e4, 'Invalid MEM_0 slot must be masked');
    for (const v of h) assert(Number.isFinite(v), 'GRU hidden state must remain finite');
  }
});

// ============================================================================
// 3. 100% Fair-Play Zero-Wallhack & Shaffer Cloak Proof
// ============================================================================
test('RNV1-03 | 100% Fair-Play Proof: occluded and Shaffer-cloaked enemies NEVER leak into RNV1 observations', () => {
  const m = new Match({
    mode: 'lab', limit: 'unlimited',
    lab: {playerRole: 'spectate', teamACount: 1, teamBCount: 1, teamAAi: 'rnv1', teamBAi: 'human'}
  });
  const [rnvActor, enemy] = m.actors;
  const brain = m.nv.brains.get(rnvActor.id);
  const obs = new Float32Array(RNV1_OBS_DIM);

  // 1. Place enemy cleanly behind steel container at [-7.5, 46] -> zero LOS!
  place(rnvActor, -4.0, 52.0, 0);
  place(enemy, -10.2, 46.0, Math.PI);
  assert(obstruction(eyeOf(rnvActor), targetPoint(enemy)) <= 1, 'Enemy must be occluded behind container');

  buildRNV1Observation(m, rnvActor, brain, obs);
  assert.equal(obs[59], 0, 'Occluded enemy MUST NOT appear in VIS_0 (zero wallhack!)');
  assert.equal(obs[73], 0, 'Occluded enemy MUST NOT appear in VIS_1');
  assert.equal(brain.visTargets.length, 0);

  // 2. Move enemy into direct unobstructed LOS in front of RNV1 -> VIS_0 activates!
  place(enemy, -4.0, 42.0, Math.PI);
  assert(obstruction(eyeOf(rnvActor), targetPoint(enemy)) > 1, 'Enemy must now have clear LOS');
  buildRNV1Observation(m, rnvActor, brain, obs);
  assert.equal(obs[59], 1, 'Visible enemy in front FOV must activate VIS_0');
  assert.equal(brain.visTargets.length, 1);

  // 3. Activate Shaffer cloak on enemy -> RNV1 immediately loses visual contact!
  enemy.shafferTimer = 10.0;
  m.nv.onShafferCloak(enemy);
  buildRNV1Observation(m, rnvActor, brain, obs);
  assert.equal(obs[59], 0, 'Shaffer-cloaked enemy MUST NEVER appear in RNV1 visual observations');
  assert.equal(brain.visTargets.length, 0);
});

// ============================================================================
// 4. Live 3v3 RNV1 vs NV2.6 Force 360Hz Combat & CPU Budget Verification
// ============================================================================
test('RNV1-04 | Live 3v3 RNV1 vs NV2.6 Force runs cleanly at 360Hz within real-time CPU budget', () => {
  const m = new Match({
    mode: 'lab', limit: 'unlimited',
    lab: {
      playerRole: 'spectate',
      teamACount: 3, teamBCount: 3,
      teamAAi: 'rnv1', teamBAi: 'human',
      teamAGun: 'MS10', teamBGun: 'MS10',
      npcSkills: true
    }
  });
  const startPos = m.actors.filter(a => a.team === 0).map(a => [a.x, a.z]);
  const dt = 1 / 360;
  const ticks = 360 * 3; // 3 full simulated seconds @ 360Hz
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) m.step(dt, {});
  const elapsedMs = performance.now() - t0;
  const msPerTick = elapsedMs / ticks;

  const rnvActors = m.actors.filter(a => a.team === 0);
  let totalMoved = 0;
  for (let i = 0; i < rnvActors.length; i++) {
    const a = rnvActors[i];
    assert(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z), 'RNV1 coordinates must be finite');
    assert(Number.isFinite(a.yaw) && Number.isFinite(a.pitch), 'RNV1 orientation must be finite');
    assert(a.expr && Number.isFinite(a.expr.headYaw), 'RNV1 must populate finite GPU rig expression signals');
    totalMoved += Math.hypot(a.x - startPos[i][0], a.z - startPos[i][1]);
  }
  assert(totalMoved > 4.0, `RNV1 squad must actively navigate the wharf (totalMoved=${totalMoved.toFixed(2)}m)`);
  assert(m.nv.metrics.neuralInferences > 50, `RNV1 must run 20Hz neural inferences (got ${m.nv.metrics.neuralInferences})`);
  assert(msPerTick < 2.2, `360Hz tick must stay well under 2.778ms budget (got ${msPerTick.toFixed(3)}ms/tick)`);
});

// ============================================================================
// 5. JSDOM UI Test: Lab RNV1 Option, Weight JSON Import & Standard-Mode Toggle
// ============================================================================
test('RNV1-05 | UI: Lab Mode exposes RNV1, imports trained weight JSON, and toggles RNV1 in standard modes', async t => {
  resetRNV1Weights();
  const dom = new JSDOM(html, {url: 'https://result.test/dist/', pretendToBeVisual: true});
  const w = dom.window, d = w.document, frames = [];
  const media = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  Object.defineProperties(w.navigator, {maxTouchPoints: {value: 0}, getGamepads: {value: () => []}});
  const prev = {};
  const globals = {
    document: d, window: w, navigator: w.navigator, localStorage: w.localStorage,
    indexedDB: undefined, BroadcastChannel: undefined, matchMedia: media,
    innerWidth: 1280, innerHeight: 720, requestAnimationFrame: fn => frames.push(fn)
  };
  for (const [k, v] of Object.entries(globals)) {
    prev[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, {value: v, writable: true, configurable: true});
  }
  t.after(() => {
    resetRNV1Weights();
    for (const [k, desc] of Object.entries(prev)) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete globalThis[k];
    }
    w.close();
  });

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
    return canvases.get(this).getContext('2d');
  });
  let currentMatch = null;
  for (const Device of [Renderer, SoftwareRenderer]) {
    t.mock.method(Device.prototype, 'init', async function () {});
    t.mock.method(Device.prototype, 'settings', function (cfg) { this.config = {...cfg}; this.resize(); });
    t.mock.method(Device.prototype, 'resize', function () {
      const [x, y] = effectiveSize(this.config);
      this.canvas.width = x; this.canvas.height = y;
      this.aspect = 1280 / 720;
    });
    t.mock.method(Device.prototype, 'render', function (_cam, _time, m) {
      currentMatch = m;
    });
  }

  await import(new URL('js/app.js?rnv1test=' + Date.now(), distUrl));
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setImmediate(r));
    if (d.getElementById('app').classList.contains('render-ready')) break;
  }
  const $ = id => d.getElementById(id);
  let ms = 0;
  const frame = (dt = 16.667) => { ms += dt; frames.shift()(ms); };

  $('play').click();
  $('modes').querySelector('[data-value="lab"]').click();

  assert.notEqual($('labAiA').querySelector('option[value="rnv1"]'), null, 'Lab Team A AI must include RNV1');
  assert.notEqual($('labAiB').querySelector('option[value="rnv1"]'), null, 'Lab Team B AI must include RNV1');
  assert.notEqual($('rnv1StudioBar'), null, 'RNV1 Studio bar must render in Lab panel');
  assert($('rnv1ColabLink').href.includes('colab.research.google.com'), 'Colab A100 1-click link must be present');

  // Simulate importing a trained A100 weights JSON bundle
  const trainedBundle = {
    ...RNV1_BUNDLED_WEIGHTS,
    meta: {...RNV1_BUNDLED_WEIGHTS.meta, trained: true, steps: 100_000_000, evalKD: 3.45, origin: 'colab-a100-studio'}
  };
  const imp = importRNV1WeightsJSON(JSON.stringify(trainedBundle), {persist: true});
  assert.equal(imp.ok, true);
  assert.equal(getRNV1Status().trained, true);
  assert($('rnv1StatusBadge').textContent.includes('100M'), 'Badge must display imported A100 step count');

  // Toggle standard-mode RNV1 ON and start a standard 3v3 match -> NPCs run RNV1!
  $('rnv1StdBtn').click();
  assert.equal($('rnv1StdBtn').getAttribute('aria-pressed'), 'true');
  $('modes').querySelector('[data-value="3v3"]').click();
  assert.equal($('lobbyAiLabel').textContent, 'RNV1');
  $('start').click();
  frame();
  assert.equal(currentMatch.aiModel, 'rnv1');
  assert(currentMatch.nv instanceof RNV1);
  assert(currentMatch.actors.filter(a => !a.human).every(a => a.aiVersion === 'RNV1'));

  // Verify preference persistence
  const prefs = readPreferences({rules: {useRnv1Standard: true}});
  assert.equal(prefs.rules.useRnv1Standard, true);
  assert.equal(prefs.rules.aiModel, 'rnv1');
});
