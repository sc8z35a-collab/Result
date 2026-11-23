import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {createCanvas} from '@napi-rs/canvas';

import {Match} from '../dist/js/match.js';
import {AI_VERSION_LIST, aiVersionDisplay, ArenaCompositeAI, normalizeAiModelId} from '../dist/js/ai-arena.js';
import {
  NV3, NV3_VERSION, NV3_EGO_DIM, NV3_NUM_ENTITIES, NV3_ENTITY_DIM,
  validateNV3Bundle, getNV3Status, importNV3WeightsJSON, resetNV3Weights
} from '../dist/js/nv3.js';
import {NV3_BUNDLED_WEIGHTS} from '../dist/js/nv3-weights.js';
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
// 1. NV 3 Registration as 12th AI Generation in Match, Lab & ArenaCompositeAI
// ============================================================================
test('NV3-01 | NV 3 registers cleanly as 12th AI generation in Match, Lab, and ArenaCompositeAI', () => {
  assert.equal(NV3_VERSION, 'NV 3');
  assert.equal(AI_VERSION_LIST.length, 12);
  assert.equal(AI_VERSION_LIST[0].id, 'nv3');
  assert.equal(normalizeAiModelId('NV 3'), 'nv3');
  assert.equal(normalizeAiModelId('NV3'), 'nv3');
  assert.equal(aiVersionDisplay('nv3'), 'NV 3');

  const mPure = new Match({mode: '3v3', limit: 'unlimited', aiModel: 'nv3'});
  assert(mPure.nv instanceof NV3, 'Pure NV 3 match must instantiate NV3 engine directly');
  assert(mPure.actors.filter(a => !a.human).every(a => a.aiVersion === 'NV 3'));

  const mVs = new Match({
    mode: 'lab', limit: 'unlimited',
    lab: {playerRole: 'spectate', teamACount: 3, teamBCount: 3, teamAAi: 'nv3', teamBAi: 'human'}
  });
  assert(mVs.nv instanceof ArenaCompositeAI, 'NV 3 vs NV2.6 Force must use ArenaCompositeAI');
  assert(mVs.actors.filter(a => a.team === 0).every(a => a.aiVersion === 'NV 3'));
  assert(mVs.actors.filter(a => a.team === 1).every(a => a.aiVersion === 'NV2.6 Force'));

  const mVsRnv = new Match({
    mode: 'lab', limit: 'unlimited',
    lab: {playerRole: 'spectate', teamACount: 2, teamBCount: 2, teamAAi: 'nv3', teamBAi: 'rnv1'}
  });
  assert(mVsRnv.nv instanceof ArenaCompositeAI, 'NV 3 vs RNV1 FAST must use ArenaCompositeAI');
  assert(mVsRnv.actors.filter(a => a.team === 0).every(a => a.aiVersion === 'NV 3'));
  assert(mVsRnv.actors.filter(a => a.team === 1).every(a => a.aiVersion === 'RNV1 FAST'));

  const mMirror = new Match({
    mode: 'lab', limit: 'unlimited',
    lab: {playerRole: 'spectate', teamACount: 2, teamBCount: 2, teamAAi: 'nv3', teamBAi: 'nv3'}
  });
  assert(mMirror.nv instanceof NV3, 'NV 3 vs NV 3 mirror match should instantiate single NV3 engine');
});

// ============================================================================
// 2. NV3PolicyNet Validation, Corruption Rejection & Masked Cross-Attention
// ============================================================================
test('NV3-02 | NV3PolicyNet validates bundles, rejects corrupted weights, and runs zero-NaN cross-attention GRU pass', () => {
  const ok = validateNV3Bundle(NV3_BUNDLED_WEIGHTS);
  assert.equal(ok.ok, true, 'Starter NV 3 bundled weights must validate cleanly');
  const net = ok.net;
  assert.equal(net.egoObsDim, NV3_EGO_DIM);
  assert.equal(net.numEntities, NV3_NUM_ENTITIES);
  assert.equal(net.entityDim, NV3_ENTITY_DIM);

  assert.equal(validateNV3Bundle({version: 'RNV1', schema: 1}).ok, false);
  assert.equal(validateNV3Bundle({...NV3_BUNDLED_WEIGHTS, tensors: {}}).ok, false);
  assert.equal(importNV3WeightsJSON('{bad json', false).ok, false);

  const h = new Float32Array(net.gruDim);
  const ego = new Float32Array(NV3_EGO_DIM);
  const ent = new Float32Array(NV3_NUM_ENTITIES * NV3_ENTITY_DIM);
  ent[0] = 1.0; // VIS_0 valid
  // VIS_1..3, MEM_0..2, ALLY_0 invalid -> must be masked to -1e4
  for (let step = 0; step < 6; step++) {
    const out = net.forward(ego, ent, h);
    for (const v of out.moveMean) assert(Number.isFinite(v) && v >= -1 && v <= 1);
    for (const v of out.aimResMean) assert(Number.isFinite(v) && v >= -1 && v <= 1);
    for (const v of out.emotionPred) assert(Number.isFinite(v) && v >= 0 && v <= 1);
    assert.equal(out.aimLogits[2], -1e4, 'Invalid VIS_1 aim slot must be masked');
    assert.equal(out.aimLogits[5], -1e4, 'Invalid MEM_0 aim slot must be masked');
    assert.equal(out.aimLogits[8], -1e4, 'Invalid ALLY_0 aim slot must be masked');
    for (const v of h) assert(Number.isFinite(v), 'GRU hidden state must stay finite');
  }
});

// ============================================================================
// 3. 100% Fair-Play Zero-Wallhack & Shaffer Cloak Proof
// ============================================================================
test('NV3-03 | 100% Fair-Play Proof: occluded and Shaffer-cloaked enemies NEVER leak into NV 3 observations', () => {
  const m = new Match({
    mode: 'lab', limit: 'unlimited',
    lab: {playerRole: 'spectate', teamACount: 1, teamBCount: 1, teamAAi: 'nv3', teamBAi: 'human'}
  });
  const [nv3Actor, enemy] = m.actors;
  const nv3Eng = m.nv.engines[0];
  const brain = nv3Eng.brains.get(nv3Actor.id);

  // 1. Place enemy cleanly behind steel container at [-7.5, 46] -> zero LOS!
  place(nv3Actor, -4.0, 52.0, 0);
  place(enemy, -10.2, 46.0, Math.PI);
  assert(obstruction(eyeOf(nv3Actor), targetPoint(enemy)) <= 1, 'Enemy must be occluded behind container');

  nv3Eng.buildNV3Observation(nv3Actor, brain);
  assert.equal(brain.entObs[0], 0, 'Occluded enemy MUST NOT appear in VIS_0 (zero wallhack!)');
  assert.equal(brain.visList.length, 0);

  // 2. Move enemy into direct unobstructed LOS in front of NV 3 -> VIS_0 activates!
  place(enemy, -4.0, 42.0, Math.PI);
  assert(obstruction(eyeOf(nv3Actor), targetPoint(enemy)) > 1, 'Enemy must now have clear LOS');
  nv3Eng.buildNV3Observation(nv3Actor, brain);
  assert.equal(brain.entObs[0], 1, 'Visible enemy in front FOV must activate VIS_0');
  assert.equal(brain.visList.length, 1);

  // 3. Activate Shaffer cloak on enemy -> NV 3 immediately purges visual contact!
  enemy.shafferTimer = 10.0;
  m.nv.onShafferCloak(enemy);
  nv3Eng.buildNV3Observation(nv3Actor, brain);
  assert.equal(brain.entObs[0], 0, 'Shaffer-cloaked enemy MUST NEVER appear in NV 3 visual observations');
  assert.equal(brain.visList.length, 0);
});

// ============================================================================
// 4. Live 3v3 360Hz Sentient Emotions, 16-Bone Expr, Vocal Signals & CPU Budget
// ============================================================================
test('NV3-04 | Live 3v3 NV 3 vs NV2.6 Force runs 360Hz with live emotions, 16-bone expr, and Klatt npcSignal events', () => {
  const voiceSignals = [];
  const m = new Match({
    mode: 'lab', limit: 'unlimited',
    lab: {
      playerRole: 'spectate',
      teamACount: 3, teamBCount: 3,
      teamAAi: 'nv3', teamBAi: 'human',
      teamAGun: 'MS10', teamBGun: 'MS10',
      npcSkills: true
    }
  }, ev => {
    if (ev?.type === 'npcSignal' && ev.team === 0) voiceSignals.push(ev);
  });

  const startPos = m.actors.filter(a => a.team === 0).map(a => [a.x, a.z]);
  const dt = 1 / 360;
  const ticks = 360 * 3;
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) m.step(dt, {});
  const msPerTick = (performance.now() - t0) / ticks;

  const nv3Eng = m.nv.engines[0];
  const nv3Actors = m.actors.filter(a => a.team === 0);
  let totalMoved = 0;
  for (let i = 0; i < nv3Actors.length; i++) {
    const a = nv3Actors[i];
    const b = nv3Eng.brains.get(a.id);
    assert(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z));
    assert(a.expr && Number.isFinite(a.expr.headYaw) && Number.isFinite(a.expr.breathWave));
    for (let e = 0; e < 8; e++) {
      assert(Number.isFinite(b.emotions[e]) && b.emotions[e] >= 0 && b.emotions[e] <= 1, '8-D emotions must stay in [0, 1]');
    }
    for (let s = 0; s < 4; s++) {
      assert(Number.isFinite(b.somatic[s]) && b.somatic[s] >= 0 && b.somatic[s] <= 1, '4-D somatic must stay in [0, 1]');
    }
    totalMoved += Math.hypot(a.x - startPos[i][0], a.z - startPos[i][1]);
  }
  // Test startle & player squad order emotional/vocal responsiveness
  const a0 = nv3Actors[0];
  nv3Eng.onHit(a0, m.actors[3], [1, 0, 0], 18, false);
  const ack = m.nv.issuePlayerSquadOrder('SWING', {team: 0});
  assert(typeof ack === 'string' && ack.length > 0, 'NV 3 ally must respond to player squad orders');
  assert(voiceSignals.length > 0, 'NV 3 must emit observable fair-play Klatt npcSignal events');
  assert(totalMoved > 4.0, `NV 3 squad must navigate actively (totalMoved=${totalMoved.toFixed(2)}m)`);
  assert(nv3Eng.metrics.neuralInferences > 50, 'NV 3 must execute 20Hz neural inferences');
  assert(msPerTick < 2.5, `360Hz tick must remain within real-time budget (got ${msPerTick.toFixed(3)}ms/tick)`);
});

// ============================================================================
// 5. JSDOM UI Test: Lab NV 3 Option, Weight Import & Standard-Mode Toggle
// ============================================================================
test('NV3-05 | UI: Lab exposes NV 3 + RNV1 FAST, imports NV 3 weights, and toggles standard-mode NV 3 without breaking default NV2.6 Force', async t => {
  resetNV3Weights();
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
    resetNV3Weights();
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

  await import(new URL('js/app.js?nv3test=' + Date.now(), distUrl));
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setImmediate(r));
    if (d.getElementById('app').classList.contains('render-ready')) break;
  }
  const $ = id => d.getElementById(id);
  let ms = 0;
  const frame = (dt = 16.667) => { ms += dt; frames.shift()(ms); };

  // Default standard mode remains NV2.6 Force!
  const defPrefs = readPreferences({});
  assert.equal(defPrefs.rules.aiModel, 'human');

  $('play').click();
  $('modes').querySelector('[data-value="lab"]').click();

  assert.notEqual($('labAiA').querySelector('option[value="nv3"]'), null, 'Lab Team A AI must include NV 3');
  assert.notEqual($('labAiB').querySelector('option[value="nv3"]'), null, 'Lab Team B AI must include NV 3');
  assert.notEqual($('nv3StudioBar'), null, 'NV 3 Studio bar must render in Lab panel');
  assert($('nv3ColabLink').href.includes('NV3_Omega_Colab_A100_Studio.ipynb'), 'NV 3 Colab A100 link must be present');
  assert($('rnv1StatusBadge').textContent.includes('RNV1 FAST'), 'RNV1 Studio bar must show RNV1 FAST');

  const trainedBundle = {
    ...NV3_BUNDLED_WEIGHTS,
    meta: {...NV3_BUNDLED_WEIGHTS.meta, trained: true, steps: 300_000_000, evalKD: 4.12}
  };
  const imp = importNV3WeightsJSON(JSON.stringify(trainedBundle), true);
  assert.equal(imp.ok, true);
  assert.equal(getNV3Status().trained, true);
  assert($('nv3StatusBadge').textContent.includes('300M'), 'NV 3 badge must show 300M imported steps');

  $('nv3StdBtn').click();
  assert.equal($('nv3StdBtn').getAttribute('aria-pressed'), 'true');
  $('modes').querySelector('[data-value="3v3"]').click();
  assert.equal($('lobbyAiLabel').textContent, 'NV 3');
  $('start').click();
  frame();
  assert.equal(currentMatch.aiModel, 'nv3');
  assert(currentMatch.nv instanceof NV3);
  assert(currentMatch.actors.filter(a => !a.human).every(a => a.aiVersion === 'NV 3'));

  const nv3Prefs = readPreferences({rules: {useNv3Standard: true}});
  assert.equal(nv3Prefs.rules.useNv3Standard, true);
  assert.equal(nv3Prefs.rules.aiModel, 'nv3');
});
