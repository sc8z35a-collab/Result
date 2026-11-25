import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from '../dist/js/match.js';
import {movingDetails} from '../dist/js/models.js';
import {shared, postVS} from '../dist/js/shaders.js';
import {
  HEMOFLUX_VERSION,
  MAX_VISOR_DROPS,
  SURFACE_PROPS,
  HemoFluxEngine,
  HemoFluxGL,
  getHemoFluxShaderSources
} from '../dist/js/hemoflux.js';
import {readPreferences} from '../dist/js/preferences.js';
import {extractFrustum, perspective, lookAt, multiply} from '../dist/js/geometry.js';

function makeMockGL() {
  const draws = [];
  const programs = [];
  const gl = new Proxy({
    createProgram: () => { const p = {shaders: []}; programs.push(p); return p; },
    createShader: (type) => ({type, code: ''}),
    shaderSource: (s, code) => { s.code = code; },
    attachShader: (p, s) => { p.shaders.push(s); },
    getShaderParameter: () => true,
    getProgramParameter: (_, key) => (key === 0x8B86 || key === 'ACTIVE_UNIFORMS') ? 0 : true,
    getUniformLocation: (_, name) => name,
    createVertexArray: () => ({}),
    createBuffer: () => ({}),
    drawArrays: (mode, first, count) => { draws.push({mode, first, count}); },
    TRIANGLES: 4,
    VERTEX_SHADER: 0x8B31,
    FRAGMENT_SHADER: 0x8B30,
    COMPILE_STATUS: 0x8B81,
    LINK_STATUS: 0x8B82,
    ACTIVE_UNIFORMS: 0x8B86
  }, {
    get: (obj, key) => obj[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : () => {})
  });
  return {gl, draws, programs};
}

test('HF-01 | Wound Taxonomy: anatomical zones (head/neck/thorax/limb), weapon modes & human vs zombie physiology', () => {
  const hf = new HemoFluxEngine(() => 0.42);
  const human = {x: 0, y: 0, z: 0, crouch: 0, isZombie: false, isH1Zonbi: false};
  const zombie = {x: 0, y: 0, z: 0, crouch: 0, isZombie: true, isH1Zonbi: false};

  const wHead = hf.classifyWound(human, [0, 1.56, 0], 45, true, {shot: {gun: 'MS10'}});
  const wNeck = hf.classifyWound(human, [0, 1.28, 0], 25, false, {shot: {gun: 'SW T'}});
  const wThorax = hf.classifyWound(human, [0, 0.95, 0], 22, false, {shot: {gun: 'DF40 II', pellets: 12}});
  const wLimb = hf.classifyWound(human, [0, 0.45, 0], 18, false, {melee: true});
  const wBlast = hf.classifyWound(zombie, [0, 1.0, 0], 50, false, {gasPipe: true});

  assert.equal(hf.version, HEMOFLUX_VERSION);
  assert.equal(wHead.zone, 'head');
  assert.equal(wHead.mode, 'high_velocity');
  assert.equal(wHead.highCaliber, true);
  assert.equal(wNeck.zone, 'neck');
  assert.equal(wThorax.zone, 'thorax');
  assert.equal(wThorax.mode, 'scatter');
  assert.equal(wLimb.zone, 'limb');
  assert.equal(wLimb.mode, 'melee');
  assert.equal(wBlast.mode, 'blast');
  assert.equal(wBlast.isZombie, true);
  assert.ok(wHead.baseOxygen > 0.85, 'Human arterial hit must have high O2 oxygenation');
  assert.ok(wBlast.baseOxygen < 0.35, 'Zombie hit must have hypoxic dark venous oxygenation');
  assert.ok(wBlast.viscosity > wHead.viscosity, 'Zombie necrotic blood must be more viscous');
});

test('HF-02 | Multi-Phase Ejecta: coherent liquid arterial ribbons, Weber aerodynamic breakup & size-dependent drag', () => {
  const m = new Match({mode: '1v1', limit: 'unlimited', loadout: 'MS10'});
  const [p, e] = m.actors;
  e.x = 0; e.y = 0; e.z = 50; e.shield = 0; e.hp = 100;

  m.damage(e, p, 45, [0, 0.05, -1], {point: [0, 1.55, 50], shot: {gun: 'MS10'}});
  const hf = m.hemoFlux;
  assert.equal(m.bloodDroplets, hf.droplets, 'Match.bloodDroplets must alias HemoFlux droplets');
  assert.equal(m.bloodMist, hf.mists, 'Match.bloodMist must alias HemoFlux mists');
  assert.equal(m.bloodDecals, hf.decals, 'Match.bloodDecals must alias HemoFlux decals');
  assert.ok(hf.droplets.length >= 20, 'High-caliber headshot must emit rich multi-regime droplet fan');
  assert.ok(hf.ribbons.length >= 2, 'High-velocity impact must spawn coherent liquid arterial ribbons');
  assert.ok(hf.mists.length >= 4, 'Headshot must spawn volumetric hemoglobin aerosol mist cloud');
  assert.equal(hf.stats.headshots, 1);

  // Step physics and verify Weber breakup, ribbon tip shedding & surface impacts!
  const dt = 1 / 120;
  for (let i = 0; i < 180; i++) m.updateBlood(dt);
  assert.ok(hf.stats.weberBreakups >= 1, 'Fast large droplets must undergo Weber aerodynamic breakup');
  assert.ok(hf.decals.length >= 8, 'Ballistic droplets must stain floor/surfaces with Forensic BPA decals');
  assert.ok(hf.decals.some(d => d.stretch > 1.35), 'Oblique droplet impacts must produce elongated forensic teardrops');
});

test('HF-03 | Vertical Container Wall Blow-Through, Surface Material Porosity & Casson Gravity Rivulets', () => {
  const m = new Match({mode: '1v1', limit: 'unlimited', loadout: 'MS10'});
  const [p, e] = m.actors;
  // Place victim directly in front of the steel shipping container at [8.3, 48, 12.2, 2.65, 0]
  // Container Z spans [46.675, 49.325], X spans [2.2, 14.4]
  e.x = 8.0; e.y = 0; e.z = 50.1; e.shield = 0; e.hp = 100;

  m.damage(e, p, 120, [0, 0.02, -1], {point: [8.0, 1.35, 50.1], shot: {gun: 'MS10'}});
  const hf = m.hemoFlux;
  assert.ok(hf.rivulets.length >= 1, 'Close-range shot into steel container wall must spawn vertical gravity drip rivulets');
  assert.ok(hf.stats.killPools >= 1, 'Lethal hit must spawn an expanding Huppert viscous kill pool');

  const rv = hf.rivulets[0];
  const initialLen = rv.len;
  const pool = hf.decals.find(d => d.pool);
  assert.ok(pool, 'Kill pool decal must exist');
  const initialPoolR = pool.r;
  assert.equal(rv.porosity, SURFACE_PROPS.steel.porosity, 'Steel container rivulet must inherit non-porous steel surface properties');

  for (let i = 0; i < 240; i++) m.updateBlood(1 / 60);
  assert.ok(rv.len > initialLen + 0.05, 'Wall gravity rivulet must visibly creep downward along container wall');
  assert.ok(pool.r > initialPoolR + 0.35, 'Huppert viscous kill pool must expand smoothly over time');
});

test('HF-04 | Live Pulsatile Arterial Bleeders Leave Fleeing Ground Blood Drop Trails', () => {
  const m = new Match({mode: '1v1', limit: 'unlimited', loadout: 'SW T'});
  const [p, e] = m.actors;
  e.x = 0; e.y = 0; e.z = 60; e.shield = 0; e.hp = 100;
  e.vx = 3.2; e.vz = 0;

  m.damage(e, p, 35, [0, 0, -1], {point: [0, 1.25, 60], shot: {gun: 'SW T'}});
  const hf = m.hemoFlux;
  assert.equal(hf.bleeders.length, 1, 'Severe neck/thorax trauma must attach a live pulsatile arterial bleeder');

  // Clear initial droplets so we prove NEW trailing blood drops are emitted while actor flees!
  hf.droplets.length = 0;
  hf.decals.length = 0;
  for (let i = 0; i < 90; i++) {
    e.x += e.vx * (1 / 60);
    m.updateBlood(1 / 60);
  }
  assert.ok(hf.droplets.length + hf.decals.length >= 3, 'Wounded fleeing actor must leave pulsatile arterial drips & trail stains');
});

test('HF-05 | Weather Wind Deflection & Directional Optical Visor Blood with Reticle Clearance + Stick-Slip Sliding', () => {
  const mClear = new Match({mode: '1v1', limit: 'unlimited', weather: 'clear'});
  const mStorm = new Match({mode: '1v1', limit: 'unlimited', weather: 'disaster'});
  for (const m of [mClear, mStorm]) {
    const [p, e] = m.actors;
    e.x = 0; e.y = 0; e.z = 50; e.shield = 0; e.hp = 100;
    m.damage(e, p, 30, [0, 0, -1], {point: [0, 1.2, 50]});
    for (let i = 0; i < 60; i++) m.updateBlood(1 / 60);
  }
  const avgXClear = mClear.hemoFlux.mists.reduce((s, x) => s + x.x, 0) / Math.max(1, mClear.hemoFlux.mists.length);
  const avgXStorm = mStorm.hemoFlux.mists.reduce((s, x) => s + x.x, 0) / Math.max(1, mStorm.hemoFlux.mists.length);
  assert.ok(Math.abs(avgXStorm - avgXClear) > 0.05, 'Disaster wind must measurably advect airborne hemoglobin mist');

  // Optical Visor Blood: directional placement + reticle clearance + downward Casson stick-slip sliding!
  const hf = mClear.hemoFlux;
  hf.onVisorSplatter(
    {point: [3, 1.4, 48], dir: [-1, 0, 0], hpLoss: 40, isKill: true, distToPlayer: 2.0, oxygen: 0.94},
    true,
    [0, 1.5, 50], [1, 0, 0], [0, 1, 0], [0, 0, -1]
  );
  assert.ok(hf.visorDrops.length >= 5 && hf.visorDrops.length <= MAX_VISOR_DROPS);
  const firstDrop = hf.visorDrops[0];
  const v0 = firstDrop.v;
  const activeCount = hf.stepVisor(0.016, 0);
  assert.equal(activeCount, hf.visorDrops.length);
  for (let i = 0; i < 60; i++) hf.stepVisor(1 / 60, 0);
  assert.ok(firstDrop.v < v0, 'Visor blood droplet must slide downward under Casson stick-slip gravity');
  assert.equal(firstDrop.startV, v0, 'Visor droplet must preserve startV for translucent gravity smear trail');
  for (let i = 0; i < hf.visorActiveCount * 4; i++) {
    assert.ok(Number.isFinite(hf.uVisorDrop[i]), 'uVisorDrop must contain zero NaNs');
    assert.ok(Number.isFinite(hf.uVisorMeta[i]), 'uVisorMeta must contain zero NaNs');
  }
  hf.clearVisor();
  assert.equal(hf.visorActiveCount, 0);
});

test('HF-06 | HemoFluxGL Batched WebGL2 Render Passes, movingDetails Zero-Double-Draw & Preferences Default', () => {
  const prefs = readPreferences({});
  assert.equal(prefs.settings.hemoFlux, true, 'HemoFlux 1.0 must be enabled by default in preferences');

  const src = getHemoFluxShaderSources(shared, postVS);
  assert.ok(src.decal[1].includes('bGGX') && src.decal[1].includes('gradUV'));
  assert.ok(src.mist[1].includes('hg='));
  assert.ok(src.drop[1].includes('pinch'));
  assert.ok(src.visor[1].includes('hemoVisorEvaluate'));

  const m = new Match({mode: '1v1', limit: 'unlimited', loadout: 'MS10'});
  const [p, e] = m.actors;
  e.x = 8.0; e.y = 0; e.z = 50.1; e.shield = 0; e.hp = 100;
  m.damage(e, p, 120, [0, 0.02, -1], {point: [8.0, 1.35, 50.1], shot: {gun: 'MS10'}});
  m.hemoFlux.onVisorSplatter({point: [8, 1.35, 50], dir: [0, 0, -1], hpLoss: 50, isKill: true, distToPlayer: 1.5}, true);
  m.hemoFlux.stepVisor(0.016, 0);

  // movingDetails must suppress legacy opaque geometry when hemoFluxGL=true, and emit fallback when falsy!
  const withGL = movingDetails(m, 1.0, true, false, {hemoFluxGL: true});
  const withoutGL = movingDetails(m, 1.0, true, false, {hemoFluxGL: false});
  assert.ok(withoutGL.count > withGL.count, 'movingDetails must skip legacy blood geometry when HemoFluxGL is active');

  // Verify HemoFluxGL executes all 4 batched WebGL2 passes cleanly!
  const {gl, draws, programs} = makeMockGL();
  const hfgl = new HemoFluxGL(gl, shared, postVS);
  assert.equal(programs.length, 4, 'HemoFluxGL must compile exactly 4 programs (decal, mist, drop, visor)');

  const eye = new Float32Array([8.0, 1.6, 54.0]);
  const proj = perspective(60 * Math.PI / 180, 16 / 9, 0.1, 200);
  const view = lookAt(eye, [8.0, 1.2, 49.0], [0, 1, 0]);
  const vp = multiply(proj, view);
  const frustum = extractFrustum(vp);

  hfgl.renderWorld(m.hemoFlux, {
    vp, eye,
    right: new Float32Array([1, 0, 0]),
    up: new Float32Array([0, 1, 0]),
    frustum,
    output: 1, khdrOn: true, quality: 2,
    weatherVec: new Float32Array([1, 0, 0, 0]),
    lightPos: new Float32Array(24), lightCol: new Float32Array(18), lightCount: 0,
    lite: false
  });
  hfgl.renderVisorDirect(m.hemoFlux, {
    aspect: 16 / 9, output: 1, khdrOn: true,
    weatherVec: new Float32Array([1, 0, 0, 0]), emptyVao: {}
  });
  // Expect 4 batched draw calls: decals+rivulets, mist, droplets+ribbons, direct visor!
  assert.equal(draws.length, 4, 'HemoFluxGL must batch all 4 passes into 4 draw calls');
  assert.ok(draws[0].count >= 6, 'Decal+rivulet batch must emit triangles');
  assert.ok(draws[1].count >= 6, 'Mist batch must emit triangles');
  assert.ok(draws[2].count >= 12, 'Droplet+ribbon batch must emit triangles');
  assert.equal(draws[3].count, 3, 'Direct visor pass must draw fullscreen triangle');
});

test('HF-07 | 360Hz Real-Time Performance Budget: heavy combat blood load stays well under 0.35 ms/tick', () => {
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'MS10'});
  const [p] = m.actors;
  for (let k = 1; k < m.actors.length; k++) {
    const v = m.actors[k];
    v.shield = 0; v.hp = 100;
    m.damage(v, p, 40, [0.2, 0.05, -0.98], {point: [v.x, v.y + 1.3, v.z], shot: {gun: 'MS10'}});
    m.damage(v, p, 120, [0.1, 0.02, -0.99], {point: [v.x, v.y + 1.5, v.z], shot: {gun: 'MS10'}});
  }
  const t0 = performance.now();
  const N = 360;
  for (let i = 0; i < N; i++) m.updateBlood(1 / 360);
  const msPerTick = (performance.now() - t0) / N;
  assert.ok(msPerTick < 0.35, `Expected <0.35ms/tick at 360Hz under heavy blood load, got ${msPerTick.toFixed(4)}ms`);
});
