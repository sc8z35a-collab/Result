import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { IDBFactory, forceCloseDatabase } from 'fake-indexeddb';

const source = process.env.RESULT_QA_SOURCE
  ? pathToFileURL(resolve(process.env.RESULT_QA_SOURCE, 'dist/js') + '/')
  : new URL('../dist/js/', import.meta.url);
const load = name => import(new URL(name + '.js', source));
const {Match} = await load('match');
const {PilotWallet} = await load('wallet');
const {eyeOf, targetPoint, vertical} = await load('posture');
const {obstruction, rayBox, raycastMaterial, floorAt, moveActor} = await load('yard');
const {ThermalOptic} = await load('optic');
const {SoundEngin2} = await load('audio');
const {ChronoTrace} = await load('chronotrace');
const {FluxGI} = await load('fluxgi');
const {SchlierenOptics} = await load('schlieren');
const {SynapseProfiler} = await load('synapse');
const {unit, sub, forward, STRIDE} = await load('geometry');
const {ARV1_LOCK_ACQUIRE, steerGuidedShot} = await load('df1');
const {computeSpyDodge} = await load('nv21-spy');
const {computeAcousticPath} = await load('audio');
const h = 1 / 360;
const game = (loadout = 'SW T', options = {}, listener = () => {}) => new Match({
  mode: '1v1', limit: 'unlimited', loadout, ...options
}, listener);
const place = (a, x, z, yaw = 0) => Object.assign(a, {x, y: 0, z, yaw, pitch: 0, vx: 0, vy: 0, vz: 0, crouch: 0});
const aim = (a, b) => {
  const [x, y, z] = sub(targetPoint(b), eyeOf(a));
  a.yaw = Math.atan2(x, -z);
  a.pitch = Math.atan2(y, Math.hypot(x, z));
};
function tickActor(m, a, amount) {
  for (let i = 0; i < amount; i++) {
    m.time += h;
    m.systems(a, h);
  }
}
function storage(t, database, seed = {}) {
  const before = [globalThis.indexedDB, globalThis.localStorage];
  const data = new Map(Object.entries(seed));
  globalThis.indexedDB = database;
  globalThis.localStorage = {
    get length() { return data.size; },
    key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(String(key), String(value)),
    removeItem: key => data.delete(String(key))
  };
  t.after(() => { [globalThis.indexedDB, globalThis.localStorage] = before; });
  return data;
}
async function open(db, profile, version) {
  return await new Promise((resolve, reject) => {
    const req = db.open(profile, version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

test('05 | A waiting database open falls back without freezing the wallet', async t => {
  const db = new IDBFactory();
  storage(t, db);
  const first = new PilotWallet(() => {}, 'blocked');
  await first.ready;
  first.db.onversionchange = null;
  db.deleteDatabase('blocked');
  t.after(() => first.db?.close());
  const wallet = new PilotWallet(() => {}, 'blocked');
  await Promise.race([wallet.ready, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('wallet did not open')), 2000);
    t.after(() => clearTimeout(timer));
  })]);
  assert.equal(wallet.db, null);
});

test('06 | IndexedDB recovery preserves the fallback credits and purchased EVR1 once', async t => {
  storage(t, undefined);
  const fallback = new PilotWallet(() => {}, 'recover');
  await fallback.ready;
  assert(await fallback.change('match/1'));
  assert(await fallback.change('match/2'));
  assert(await fallback.change());
  const db = globalThis.indexedDB = new IDBFactory();
  for (let i = 0; i < 2; i++) {
    const wallet = new PilotWallet(() => {}, 'recover');
    await wallet.ready;
    assert(wallet.db);
    assert.deepEqual(wallet.state, {units: 15, evr: true});
    assert(!await wallet.change('match/1'));
    assert(!await wallet.change());
    wallet.db.close();
  }
  const conn = await open(db, 'recover', 1);
  conn.close();
});

test('07 | A failed fallback write leaves the balance and optic unchanged', async t => {
  storage(t, undefined, {'quota-fallback': '{"units":10,"evr":false,"receipts":["previous"]}'});
  const wallet = new PilotWallet(() => {}, 'quota');
  await wallet.ready;
  localStorage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
  await assert.rejects(wallet.change(), {name: 'QuotaExceededError'});
  assert.deepEqual(wallet.state, {units: 10, evr: false});
  await assert.rejects(wallet.change('new'), {name: 'QuotaExceededError'});
  assert.deepEqual(wallet.state, {units: 10, evr: false});
});

test('08 | Fallback writes for different receipts do not overwrite each other', async t => {
  storage(t, undefined);
  const a = new PilotWallet(() => {}, 'separate');
  const b = new PilotWallet(() => {}, 'separate');
  await Promise.all([a.ready, b.ready]);
  // Simulate a second tab writing between the first tab's read and write.
  const write = localStorage.setItem;
  let interleaved = false;
  localStorage.setItem = (key, value) => {
    if (!interleaved) {
      interleaved = true;
      assert(b.changeBackup('match/2'));
    }
    write(key, value);
  };
  assert(await a.change('match/1'));
  await b.read();
  assert.equal(b.state.units, 20);
  assert(!await b.change('match/2'));
});

test('09 | A closed or version-changed IndexedDB connection is reopened', async t => {
  const idb = new IDBFactory();
  storage(t, idb);
  const wallet = new PilotWallet(() => {}, 'reopen');
  await wallet.ready;
  assert(await wallet.change('m/1'));
  const old = wallet.db;
  forceCloseDatabase(old);
  await new Promise(resolve => setImmediate(resolve));
  assert(await wallet.change('m/2'));
  t.after(() => wallet.db?.close());
  const upgrade = await Promise.race([open(idb, 'reopen', 2), new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('version upgrade blocked')), 600);
    t.after(() => clearTimeout(timer));
  })]);
  upgrade.close();
  assert(await wallet.change('m/3'));
  assert.equal(wallet.db.version, 2);
  assert.equal(wallet.state.units, 30);
});

test('13 | Contested tanker goes to the nearest eligible actor', () => {
  const m = game(), [a, b] = m.actors, tk = m.tankers[0];
  place(a, tk.x + 4, tk.z); place(b, tk.x - 2, tk.z);
  m.updateTankers(h);
  assert.equal(tk.lastTeam, 1);
  assert.deepEqual([a.stock, b.stock], [100, 200]);
});

test('14 | Actors on nearby roofs cannot capture a ground-level tanker', () => {
  const m = game(), tk = m.tankers[0];
  place(m.player, tk.x, tk.z);
  m.player.y = tk.h;
  m.updateTankers(h);
  assert.equal(tk.cooldown, 0);
  assert.equal(m.player.stock, 100);
});

test('15 | Toggling P1 off removes queued boost rounds without delaying the next trigger', () => {
  const m = game('DF1 OUT'), a = m.player;
  a.df.boost = true;
  a.df.extraPhase = 1;
  m.trigger(a);
  tickActor(m, a, 58);
  a.df.boost = false;
  tickActor(m, a, 29);
  assert.deepEqual([a.burstLeft, a.df.p1], [0, 20]);
  assert(m.trigger(a));
});

test('16 | An in-flight projectile cannot hit beyond its remaining lifetime', () => {
  const m = game('MS10'), [p, e] = m.actors;
  place(p, 2, 82); place(e, 2, 80.8);
  m.trigger(p);
  const shot = m.shots[0];
  shot.life = .0001;
  assert(!m.projectile(shot, h));
  assert.equal(e.shield, 10);
});

test('17 | A shot splashes at the rendered water plane', () => {
  let splash;
  const m = game('MS10', {}, e => { if (e.type === 'impact') splash = e; });
  place(m.player, -23.5, 0, -Math.PI / 2);
  m.player.pitch = -.25;
  m.trigger(m.player);
  for (let i = 0; i < 45 && !splash; i++) m.step(h, {});
  assert.equal(splash.mat, 'water');
  assert(Math.abs(splash.point[1] + 1.68) < 1e-6);
});

test('18 | The seawall intercepts a below-deck shot from the water', () => {
  const hit = raycastMaterial([-27, -.65, 0], [-24, -.65, 0]);
  assert.equal(hit.mat, 'concrete');
  assert.deepEqual(hit.normal, [-1, 0, 0]);
  assert.equal(hit.point[0], -25);
});

test('19 | A shot close to a box corner uses the face it actually struck', () => {
  const a = [7.501, 1, 84], b = [7.501, 1, 82];
  const hit = raycastMaterial(a, b);
  assert.deepEqual(hit.normal, [0, 0, 1]);
  assert(Math.abs(hit.thickness - 12.2) < 1e-6);
  assert.equal(obstruction(a, b), hit.t);
});

test('20 | An upward jump near a ledge preserves upward velocity', () => {
  const a = {x: 0, y: .836, z: 0, vy: 3, onGround: false};
  vertical(a, h, () => .86);
  assert(a.y < .86 && a.vy > 2 && !a.onGround);
});

test('21 | A blocked movement axis reports zero velocity', () => {
  const m = game();
  const a = place(m.player, 7.08, 77);
  a.vx = 5;
  moveActor(a, .15, 0);
  assert.equal(a.x, 7.08);
  assert.equal(a.vx, 0);
});

test('22 | Ejected brass lands on a container roof', () => {
  let landed;
  const m = game('SW T', {}, e => { if (e.type === 'casing') landed = e; });
  m.casings.push({p: [9, 2.70, 77], v: [0, -2, 0], life: .6, rot: 0, spin: 1});
  for (let i = 0; i < 20 && !landed; i++) m.step(h, {});
  assert(Math.abs(landed.point[1] - 2.65) < 1e-6);
});

test('23 | NPC movement stamps thermal footprints in the same tick', () => {
  const m = game(), e = m.actors[1];
  m.nv.tick = () => { e.stride += .02; };
  e.stride = 1.145;
  m.step(h, {});
  assert.equal(m.thermoFlux.stats.footprintsStamped, 1);
});

test('24 | NPCs receive opposing footsteps after sound propagation', () => {
  const m = game(), [a, b] = m.actors;
  place(a, 2, 80); place(b, 2, 90);
  m.echoPulse.emit(m, {kind: 'step', pos: [2, .15, 80], actor: a, team: 0});
  assert.equal(m.echoPulse.step(m).length, 0);
  m.time = .1;
  const [report] = m.echoPulse.step(m);
  assert.equal(report.listenerId, b.id);
  assert.equal(report.kind, 'step');
});

test('25 | Delayed audio cannot reach a previous incarnation of a respawned player', () => {
  const m = game(), [a, b] = m.actors;
  place(a, 2, 80); place(b, 2, 90);
  m.echoPulse.emit(m, {kind: 'fire', pos: eyeOf(a), actor: a, team: 0});
  m.spawn(b);
  m.time = .2;
  assert.equal(m.echoPulse.step(m).length, 0);
});

test('26 | An ally tanker cue does not update the enemy location map', () => {
  const m = game('SW T', {mode: '3v3'});
  const [p, a] = m.actors;
  place(p, 2, 80); place(a, 2, 90);
  m.nv.tick = () => {};
  m.echoPulse.emit(m, {kind: 'tanker', pos: eyeOf(a), actor: a, team: 0});
  let updates = 0;
  m.spectraField.observe = team => { if (team === p.team) updates++; };
  for (let i = 0; i < 30; i++) m.step(h, {});
  assert.equal(updates, 0);
  assert(m.echoPulse.getCompassArcs(p, m.time).length);
});

test('27 | Smoke-obscured targets never enter the AI visual contact memory', () => {
  const m = game('SW T', {aiModel: 'classic'}), [p, e] = m.actors;
  place(p, 2, 75); place(e, 2, 85);
  m.aeroVortex.stats.totalSmoke = 6;
  m.aeroVortex.smokeOcclusion = () => 1.2;
  const brain = m.nv.brains.get(e.id);
  m.nv.perceive(e, brain);
  assert(!brain.contacts.has(p.id));
  assert(!m.nv.intel[1].has(p.id));
});

test('28 | Human perception misses do not update the squad intel', () => {
  const m = game(), [p, e] = m.actors;
  place(p, 2, 75); place(e, 2, 85);
  const brain = m.nv.brains.get(e.id);
  brain.vision.evaluateSighting = () => ({recognized: false});
  m.nv.perceive(e, brain);
  assert(!m.nv.intel[1].has(p.id));
});

test('29 | DF1 OUT retains a valid lock when a second target crosses the reticle', () => {
  const m = game('DF1 OUT', {mode: '1v2'}), [p, a, b] = m.actors;
  place(p, 2, 85); place(a, 2.6, 75); place(b, 6, 74);
  tickActor(m, p, 160);
  assert(p.df.locked && p.df.focusId === a.id);
  place(b, 2, 74);
  tickActor(m, p, 22);
  assert(p.df.locked && p.df.focusId === a.id);
});

test('30 | Boresight acquisition cannot finish outside the smaller acquisition cone', () => {
  const m = game('DF1 OUT'), [a, b] = m.actors;
  place(a, 2, 85); place(b, 2, 75);
  tickActor(m, a, 15);
  a.yaw = ARV1_LOCK_ACQUIRE * 1.18;
  tickActor(m, a, 155);
  assert.equal(a.df.locked, false);
});

test('31 | RD20 cannot guide toward a target that moved out of range between ticks', () => {
  const m = game('RD20'), [p, e] = m.actors;
  place(p, 22, 70); place(e, 22, -31.995);
  tickActor(m, p, 150);
  assert(p.rd.locked);
  place(e, 22, -32.01);
  assert(m.trigger(p));
  assert(!m.shots[0].guided);
});

test('32 | Taking the crosshair off a hidden target cannot immediately refresh D01 tracking', () => {
  const m = game('RD40'), [p, e] = m.actors;
  place(p, -7.8, 13); place(e, -7.8, 2);
  tickActor(m, p, 110);
  assert(p.rd.d01Active);
  p.yaw = Math.PI;
  tickActor(m, p, 1);
  p.yaw = 0;
  tickActor(m, p, 30);
  assert.equal(p.rd.d01Active, false);
});

test('33 | Homing bullets do not turn toward an enemy’s new spawn', () => {
  const m = game('DF1 OUT'), [p, e] = m.actors;
  place(p, 2, 85); place(e, 2, 75);
  aim(p, e); tickActor(m, p, 160);
  assert(m.trigger(p));
  const shot = m.shots[0], before = [...shot.dir];
  assert(shot.guided);
  m.spawn(e);
  place(e, 2.2, 75);
  steerGuidedShot(m, shot, h);
  assert.deepEqual(shot.dir, before);
});

test('34 | Dry-fire events are rate-limited with the trigger held', () => {
  let dry = 0;
  const m = game('RD40', {}, e => { dry += Number(e.type === 'dry'); });
  m.player.mag = 0;
  for (let i = 0; i < 36; i++) {
    m.time += h;
    m.trigger(m.player);
  }
  assert.equal(dry, 1);
});

test('36 | The final kill trace is ready when the results open', () => {
  let result;
  const m = game('MS10', {limit: 'points', multiplier: 1}, e => {
    if (e.type === 'end') result = m.chronoTrace.stats.killsRecorded;
  });
  const [p, e] = m.actors;
  place(p, 2, 85); place(e, 2, 75);
  e.shield = 0; e.hp = 1;
  aim(p, e); m.trigger(p);
  for (let i = 0; i < 36 && !m.ended; i++) m.step(h, {});
  assert.equal(result, 1);
});

test('37 | A point-blank kill and a shield hit each get a ChronoTrace record', () => {
  const c = new ChronoTrace();
  for (const outcome of ['kill', 'shield']) {
    const s = {p: [0, 1.5, 0], gun: 'MS10', team: 0, speed: 648, owner: {human: true}};
    c.beginShot(s, 0);
    c.finishShot(s, [.6, 1.5, 0], outcome, .001);
  }
  assert.deepEqual(c.traces.map(t => t.outcome), ['kill', 'shield']);
});

test('38 | Scanner uses the newest record and drops stale telemetry', () => {
  const c = new ChronoTrace();
  const s = {p: [0, 1.5, 0], gun: 'MS10', team: 1, speed: 648, owner: {name: 'OLD'}};
  c.beginShot(s, 1); c.finishShot(s, [5, 1.5, 0], 'kill', 1.1, {human: true});
  s.owner.name = 'NEW';
  c.beginShot(s, 2); c.finishShot(s, [6, 1.5, 0], 'hit', 2.1);
  assert(c.formatTelemetry().includes('NEW'));
  c.prune(30);
  assert.equal(c.formatTelemetry(), '');
  assert.equal(c.lastPlayerDeathTrace, null);
});

test('39 | ChronoTrace rendering uses match time after menus and pauses', async () => {
  const {movingDetails} = await load('models');
  const m = game();
  const s = {p: [2, 1.4, 82], gun: 'MS10', team: 0, speed: 648};
  m.chronoTrace.beginShot(s, .1);
  m.chronoTrace.finishShot(s, [2, 1.4, 75], 'hit', .11);
  m.time = .2;
  const base = movingDetails(m, 90, false, true);
  const scanner = movingDetails(m, 90, false, true, {showChrono: true});
  assert(scanner.data.length > base.data.length + STRIDE);
});

test('40 | The sampled ballistic path ends at the impact, without drawing through the target', () => {
  const m = game('MS10'), [p, e] = m.actors;
  place(p, 2, 85); place(e, 2, 78.5);
  aim(p,e); m.trigger(p);
  const s = m.shots[0];
  s.trace.pts[0] = [2, eyeOf(p)[1], 85, 0];
  while (m.projectile(s, h)) m.time += h;
  const first = s.trace.pts[0], last = s.trace.pts.at(-1);
  assert(s.trace.pts.every(pt => pt[2] >= last[2] - 1e-6));
  assert(Math.abs(s.trace.distM - Math.hypot(...sub(last.slice(0,3), first.slice(0,3)))) < 1e-6);
});

test('41 | The first trace sample matches the actual simulated origin', () => {
  const m = game('MS10');
  m.trigger(m.player);
  const shot = m.shots[0];
  assert.deepEqual(shot.trace.pts[0].slice(0, 3), shot.p);
});

test('42 | A ray leaving the exact surface is not considered obstructed at t=0', () => {
  const box = {x0: -1, x1: 1, y0: 0, y1: 2, z0: -1, z1: 1};
  assert.equal(rayBox([1, 1, 0], [2, 1, 0], box), Infinity);
});

test('43 | Standing beyond the diagonal roof edge does not hover in the air', () => {
  assert.equal(floorAt(7.28, 70.68, 2.62), 0);
});

test('44 | Background noise does not enter the model as a known enemy’s live velocity', () => {
  const m = game(), e = m.actors[1];
  e.vx = 4;
  m.fermat.recordIntel(0, e, 0, 'echo', [2, 1.1, 75]);
  assert.deepEqual(m.fermat.intel[0].get(e.id).vel, [0, 0, 0]);
});

test('45 | Targets outside allies’ views do not create visual bank-shot intel', () => {
  const m = game(), [p, e] = m.actors;
  place(p, 2, 70); place(e, 2, 82);
  m.fermat.refreshTeamVisualIntel(m);
  assert(!m.fermat.intel[0].has(e.id));
});

test('46 | A stale bank-shot preview cannot stabilize a shot after its target respawns', () => {
  const m = game('MS10'), [p, e] = m.actors, dir = forward(p.yaw, p.pitch);
  m.fermat.playerBank = {aimDir: dir, enemyId: e.id, enemySpawnId: e.spawnId, origin: eyeOf(p)};
  m.fermat.lastPlayerUpdate = m.time;
  m.spawn(e);
  assert(!m.fermat.isShotFermatAligned(p, dir, m));
});

test('47 | Re-enabling the Fermat preview computes a fresh result immediately', () => {
  const m = game();
  m.fermat.lastPlayerUpdate = 1;
  m.fermat.updatePlayerOracle(m, 1.01, false);
  m.fermat.updatePlayerOracle(m, 1.01, true);
  assert.equal(m.fermat.lastPlayerUpdate, 1.01);
});

test('48 | Learning count includes the current completed match once', t => {
  storage(t, undefined);
  const sy = new SynapseProfiler();
  sy.observeReload();
  sy.save(); sy.save();
  assert.equal(sy.getSummary().matchesLearned, 1);
  assert.equal(new SynapseProfiler().getSummary().matchesLearned, 1);
});

test('49 | A match ended before a single observation is not counted as training', t => {
  storage(t, undefined);
  const sy = new SynapseProfiler();
  sy.save();
  assert.equal(new SynapseProfiler().getSummary().matchesLearned, 0);
});

test('50 | EVR1 cannot see heated floor behind a solid container', () => {
  const m = game(), [p, e] = m.actors;
  place(p, -7.8, 13); e.alive = false;
  const output = createCanvas(256, 192), src = createCanvas(640, 480);
  const ctx = src.getContext('2d');
  ctx.fillStyle = '#303030'; ctx.fillRect(0, 0, 640, 480);
  m.thermoFlux.sampleTemp = (_, z) => ({dyn: z < 6.5 ? 1 : 0});
  const camera = {pos: eyeOf(p), target: [-7.8, 0, 2], fov: 21.5};
  new ThermalOptic(output).draw({canvas: src, aspect: 4/3}, m, camera, 1);
  const data = output.getContext('2d').getImageData(0, 0, 256, 192).data;
  assert(!data.some((value, i) => i % 4 === 0 && value > 160));
});

test('51 | A paused Schlieren shock does not lose lifetime', () => {
  const fx = new SchlierenOptics();
  fx.emit('kill', [0, 1, 0]);
  fx.step(null, 0);
  assert.equal(fx.waves[0].age, 0);
});

test('52 | Indirect light intensity stays consistent between 60 and 120 FPS', () => {
  const create = () => new FluxGI();
  const a = create(), b = create(), m = game();
  m.effects = [{kind: 'muzzle', gun: 'SRA', p: [2, 1, 85], life: .03, max: .12}];
  m.tankers = [];
  for (let i = 0; i < 30; i++) a.update(m, 1/60, false);
  for (let i = 0; i < 60; i++) b.update(m, 1/120, false);
  assert(Math.abs(a.sampleFlux(2, 85).g - b.sampleFlux(2, 85).g) < .002);
});

test('53 | Audio engine plays an impact immediately after enabling', () => {
  const engine = new SoundEngin2();
  engine.ctx = {currentTime: .003};
  engine.on = true;
  engine._playBuffer = () => {};
  engine.playImpact({point: [0, 0, 79], mat: 'wood'});
  assert.equal(engine.stats.impacts, 1);
});

test('54 | A distant splash scheduled later cannot suppress a subsequent close splash', () => {
  const engine = new SoundEngin2();
  engine.ctx = {currentTime: 2};
  engine._playBuffer = () => {};
  engine._playWaterSplash([0, 0, 0], 2.2, 1, 1000, .2);
  engine.ctx.currentTime = 2.06;
  engine._playWaterSplash([0, 0, 0], 2.07, 1, 1000, .2);
  assert.equal(engine.stats.waterSplashes, 2);
});

test('55 | Muting discards scheduled voices before re-enabling sound', async () => {
  const engine = new SoundEngin2();
  let stopped = 0;
  const voice = {stop: () => stopped++, disconnect() {}};
  engine._trackVoice(voice);
  await engine.enable(false);
  assert.equal(stopped, 1);
  assert.equal(engine.activeVoices, 0);
});

test('56 | Listener velocity resets across camera teleports and restarts', () => {
  const engine = new SoundEngin2();
  engine.ctx = {currentTime: 2, sampleRate: 48000};
  engine.on = true;
  engine.resetMatch();
  engine.update(.016, null, {pos: [12, 2, 5], target: [12, 2, 4]});
  assert.deepEqual(engine.listenerVel, [0, 0, 0]);
});

test('57 | Crouching outside hearing range does not replay as the observer approaches', () => {
  const engine = new SoundEngin2(), m = game(), [p, e] = m.actors;
  engine.ctx = {currentTime: 2, sampleRate: 48000};
  engine.on = true;
  const played = [];
  engine._playStanceFoley = (_actor, _player, kind) => played.push(kind);
  engine.update(.016, m);
  e.crouch = 1;
  engine.update(.016, m);
  place(e, 0, 77); e.crouch = 1;
  engine.update(.016, m);
  assert.deepEqual(played, []);
});

test('58 | An NPC entering audio range mid-reload only plays the current stage', () => {
  const engine = new SoundEngin2(), m = game(), e = m.actors[1];
  engine.ctx = {currentTime: 2, sampleRate: 48000};
  engine.on = true;
  const stages = [];
  engine._playReloadStage = (_actor, _player, stage) => stages.push(stage);
  e.reload = 1;
  e.reloadFrac = .6;
  engine.update(.016, m);
  place(e, 0, 77);
  engine.update(.016, m);
  assert.deepEqual(stages, []);
});

test('59 | Switching from stereo to HRTF replaces the persistent tanker panner', () => {
  const engine = new SoundEngin2();
  engine.setMode('stereo');
  const generic = () => ({connect() {}, disconnect() {}});
  engine.ctx = {currentTime: 2, createPanner: generic, createStereoPanner: () => ({...generic(), pan: {}})};
  engine.tankerGain = generic();
  engine.ambienceBus = generic();
  engine.tankerPanner = engine._createSpatialNode([1, 2, 3], 0, true);
  assert(!engine.tankerPanner.is3D);
  engine.setMode('hrtf');
  assert(engine.tankerPanner.is3D);
});

test('60 | The tanker’s own steel hull does not block its external turbine sound', () => {
  const engine = new SoundEngin2(), m = game();
  const tanker = m.tankers[0];
  engine.ctx = {currentTime: .5, sampleRate: 48000};
  engine.on = true;
  engine.listenerPos = [tanker.x + 5, 1.61, tanker.z];
  let gain;
  engine.tankerGain = {gain:{setTargetAtTime: value => { gain = value; }}};
  engine.update(.016, m);
  assert(gain > .035, 'the turbine sounds occluded from an unobstructed side of the tanker');
});

test('61 | Delayed audio deliveries are sorted from oldest to newest', () => {
  const m = game(), [p,e] = m.actors;
  place(p, 2, 80); place(e, 2, 90);
  for (const time of [0, .005]) {
    m.time = time;
    m.echoPulse.emit(m, {kind:'fire', pos: eyeOf(p), actor:p, team:0});
  }
  m.time = .1;
  const reports = m.echoPulse.step(m);
  assert.equal(reports.length, 2);
  assert(reports[0].arriveAt < reports[1].arriveAt);
});

test('C09 | An aborted IndexedDB award is durably saved and reconciled by receipt', async t => {
  storage(t, new IDBFactory());
  const wallet = new PilotWallet(() => {}, 'aborted-award');
  await wallet.ready;
  t.after(() => wallet.db?.close());
  const transact = wallet.db.transaction;
  let failNextWrite = true;
  t.mock.method(wallet.db, 'transaction', function (stores, mode) {
    const tx = transact.call(this, stores, mode);
    if (mode === 'readwrite' && failNextWrite) {
      failNextWrite = false;
      queueMicrotask(() => tx.abort());
    }
    return tx;
  });
  assert(await wallet.change('match/award'));
  assert.equal(wallet.state.units, 10);
  const reopened = new PilotWallet(() => {}, 'aborted-award');
  await reopened.ready;
  t.after(() => reopened.db?.close());
  assert(reopened.db);
  assert.equal(reopened.state.units, 10);
  assert(!await reopened.change('match/award'));
  assert.equal(reopened.state.units, 10);
});

test('C10 | A temporarily unavailable database preserves confirmed EVR1 and credits', async t => {
  const db = new IDBFactory();
  storage(t, db);
  const original = new PilotWallet(() => {}, 'cached-account');
  await original.ready;
  assert(await original.change('match/1'));
  assert(await original.change());
  assert(await original.change('match/2'));
  original.db.close();

  globalThis.indexedDB = undefined;
  const offline = new PilotWallet(() => {}, 'cached-account');
  await offline.ready;
  assert.deepEqual(offline.state, {units:15, evr:true});
  assert(!await offline.change('match/2'));
  assert(!await offline.change());
  assert(await offline.change('match/3'));
  assert.deepEqual(offline.state, {units:25, evr:true});

  globalThis.indexedDB = db;
  const online = new PilotWallet(() => {}, 'cached-account');
  await online.ready;
  t.after(() => online.db?.close());
  assert.deepEqual(online.state, {units:25, evr:true});
  assert(!await online.change('match/3'));
});

test('C11 | Another tab holding the wallet lock cannot block boot or awards', async t => {
  storage(t, new IDBFactory(), {
    'held-lock-fallback': '{"units":10,"evr":false,"receipts":["match/1"]}'
  });
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {configurable:true, value:{locks:{
    request: (_name, options, action) => options?.ifAvailable ? action(null) : new Promise(() => {})
  }}});
  t.after(() => before ? Object.defineProperty(globalThis, 'navigator', before) : delete globalThis.navigator);
  const connected = new PilotWallet(() => {}, 'held-lock');
  assert.equal(await Promise.race([connected.ready.then(() => 'ready'), delay(600, 'waiting')]), 'ready');
  assert.equal(connected.state.units, 10);
  connected.db.close();

  globalThis.indexedDB = undefined;
  const offline = new PilotWallet(() => {}, 'held-lock');
  await offline.ready;
  assert.equal(await Promise.race([offline.change('match/2'), delay(600, 'waiting')]), true);
  assert.equal(offline.state.units, 20);
});

test('C12 | Ending a match immediately checkpoints the current NV2 training once', t => {
  const data = storage(t, undefined);
  const m = game();
  m.nv.neural.stepCount = m.nv.neural.updates = 4;
  m.end();
  const key = 'result.nv2.weights.v1';
  assert(data.has(key));
  assert.equal(JSON.parse(data.get(key)).updates, 4);
  m.nv.neural.updates++;
  m.end();
  assert.equal(game().nv.neural.updates, 4);
});

test('C13 | A damaged NV2 checkpoint cannot replace part of the model or corrupt counters', t => {
  const data = storage(t, undefined);
  const model = game().nv.neural;
  const original = model.trainable[0].w[0];
  model.saveWeights();
  const key = 'result.nv2.weights.v1';
  const saved = JSON.parse(data.get(key));
  saved.w[0][0] = 2;
  saved.w.at(-1).pop();
  data.set(key, JSON.stringify(saved));
  assert.equal(game().nv.neural.trainable[0].w[0], original);

  saved.w.at(-1).push(0);
  saved.step = 'broken';
  data.set(key, JSON.stringify(saved));
  const reloaded = game().nv.neural;
  assert.equal(reloaded.stepCount, 0);
  assert.equal(reloaded.trainable[0].w[0], original);
});

test('C14 | Taking a hit through cover reveals the impact bearing without the attacker location', () => {
  const m = game(), [p, e] = m.actors;
  place(p, -7.8, 2); place(e, -7.8, 13, Math.PI);
  assert(obstruction(eyeOf(e), targetPoint(p)) <= 1);
  const brain = m.nv.brains.get(e.id);
  m.damage(e, p, 6, [0, 0, 1], {ricochet:true});
  assert(!brain.contacts.has(p.id));
  assert(!m.nv.intel[e.team].has(p.id));
  assert(!m.nv.teams[e.team].beliefs.has(p.id));
  assert.equal(brain.threatDir[1], -1);
  assert(brain.mind.startleUntil > m.time);

  place(p, 2, 80); place(e, 2, 90);
  assert(obstruction(eyeOf(e), targetPoint(p)) > 1);
  m.damage(e, p, 3, [0, 0, 1]);
  assert.equal(brain.contacts.get(p.id)?.z, p.z);
});

test('C15 | NPCs only react to reloads once an audible cue reaches them', () => {
  const m = game(), [p, e] = m.actors;
  const team = m.nv.teams[e.team];
  place(p, 2, 75); place(e, 2, 90);
  const delaySeconds = computeAcousticPath(eyeOf(p), eyeOf(e)).delay;
  p.mag--;
  const greedy = m.synapse.fp.reloadGreed;
  assert(m.reload(p));
  assert((team.profiles.get(p.id)?.reloadUntil ?? -1) <= m.time);
  assert.equal(m.synapse.fp.reloadGreed, greedy);
  m.time = delaySeconds - .001;
  assert.equal(m.echoPulse.step(m).length, 0);
  m.time = delaySeconds + .001;
  for (const cue of m.echoPulse.step(m)) m.nv.onEchoArrival(cue);
  assert(team.profiles.get(p.id).reloadUntil > m.time);
  assert(m.synapse.fp.reloadGreed > greedy);

  place(p, -7.8, -6); place(e, -7.8, 16);
  const muffled = computeAcousticPath(eyeOf(p), eyeOf(e));
  assert(muffled.occluded);
  const before = team.profiles.get(p.id).reloadUntil;
  m.time = 3;
  p.reload = 0;
  assert(m.reload(p));
  m.time += muffled.delay + .002;
  for (const cue of m.echoPulse.step(m)) m.nv.onEchoArrival(cue);
  assert.equal(team.profiles.get(p.id).reloadUntil, before);
});

test('C16 | Both NPC dodge solvers ignore bullets stopped by cover or expired by arrival', () => {
  const m = game(), [, e] = m.actors;
  const brain = m.nv.brains.get(e.id);
  const spy = {dodgeUrgency:0};
  place(e, -7.8, 16);
  const shot = {p:[-7.8, 1.02, -10], dir:[0, 0, 1], team:0, speed:234, life:.5};
  assert(obstruction(shot.p, [e.x, 1.02, e.z]) <= 1);
  m.shots = [shot];
  m.time = 1;
  m.nv.dodgeIncomingShots(e, brain);
  assert(brain.dodgeUntil <= m.time);
  assert.equal(computeSpyDodge(m.nv, e, brain, spy), false);

  place(e, 2, 90);
  shot.p = [2, 1.02, 67];
  assert(obstruction(shot.p, [e.x, 1.02, e.z]) > 1);
  shot.life = .02;
  m.nv.dodgeIncomingShots(e, brain);
  assert(brain.dodgeUntil <= m.time);
  assert.equal(computeSpyDodge(m.nv, e, brain, spy), false);
  shot.life = .5;
  m.nv.dodgeIncomingShots(e, brain);
  assert(brain.dodgeUntil > m.time);
  assert.equal(computeSpyDodge(m.nv, e, brain, spy), true);
});

test('C17 | High and outgoing rounds do not put an NPC under imaginary suppression', () => {
  const m = game(), [, e] = m.actors;
  const brain = m.nv.brains.get(e.id);
  place(e, 2, 90);
  m.time = 2;
  const shot = {p:[2, 10, 80], dir:[0, 0, 1], team:0, speed:234, life:.5};
  m.shots = [shot];
  m.nv.detectIncoming(e, brain);
  assert(brain.underFireAt < m.time);
  shot.p = [2, 1.02, 91];
  m.nv.detectIncoming(e, brain);
  assert(brain.underFireAt < m.time);
  shot.p = [2, 1.02, 80];
  m.nv.detectIncoming(e, brain);
  assert.equal(brain.underFireAt, m.time);
});

function setSmoke(m, thick) {
  m.aeroVortex.stats.totalSmoke = thick ? 6 : 0;
  m.aeroVortex.smokeOcclusion = () => thick ? 1 : 0;
}

test('C18 | Smoke prevents standard optical lock acquisition and immediate guided launch', () => {
  for (const gun of ['DF1 OUT', 'RD20', 'RD30']) {
    const m = game(gun), [p, e] = m.actors;
    place(p, 2, 75); place(e, 2, 90);
    aim(p, e);
    const lock = p.df || p.rd;
    setSmoke(m, true);
    tickActor(m, p, 200);
    assert.equal(lock.focusId, -1, gun);
    setSmoke(m, false);
    tickActor(m, p, 200);
    assert.equal(lock.locked, true, gun);
    setSmoke(m, true);
    assert(m.trigger(p));
    assert(m.shots.length > 0 && m.shots.every(shot => !shot.guided), gun);
  }
  const m = game('DF1 OUT'), [p, e] = m.actors;
  place(p, 2, 75); place(e, 2, 90);
  aim(p, e);
  Object.assign(p.df, {scope:'thermal', ads:true});
  setSmoke(m, true);
  tickActor(m, p, 200);
  assert(p.df.locked, 'EVR1 retains its thermal lock');
});

test('C19 | Moving behind smoke stops new midflight corrections from standard optics', () => {
  const m = game('DF1 OUT'), [p, e] = m.actors;
  place(p, 2, 75); place(e, 2, 90);
  aim(p, e);
  tickActor(m, p, 200);
  assert(m.trigger(p));
  const [shot] = m.shots;
  assert(shot.guided);
  const direction = [...shot.dir], budget = shot.homingBudget;
  e.x += 1;
  setSmoke(m, true);
  steerGuidedShot(m, shot, h);
  assert.deepEqual(shot.dir, direction);
  assert.equal(shot.homingBudget, budget);
  setSmoke(m, false);
  steerGuidedShot(m, shot, h);
  assert(shot.homingBudget < budget);
});

test('C20 | Cover takes flight time to penetrate and cannot be exited by an expired shot', () => {
  const m = game('MS10'), [p, e] = m.actors;
  place(e, 2.6, 58);
  m.aeroVortex.sample = () => ({speed:0});
  const shot = life => {
    const s = {p:[2.6, 1.3, 62.7], dir:[0, 0, -1], speed:648, damage:9, gun:'MS10', owner:p, team:p.team, life};
    m.chronoTrace.beginShot(s, m.time);
    return s;
  };
  const short = shot(.002);
  m.time += h;
  assert.equal(m.projectile(short, h), false);
  assert.equal(m.techStats.penetrations, 0);
  assert.equal(short.trace.outcome, 'wall');
  assert(!m.effects.some(effect => effect.kind === 'penetrate'));

  const long = shot(.1);
  m.time += h;
  assert(m.projectile(long, h));
  assert.equal(m.techStats.penetrations, 0);
  m.time += h;
  assert(m.projectile(long, h));
  assert.equal(m.techStats.penetrations, 1);
  const [, enter, exit] = long.trace.pts;
  assert(exit[3] > enter[3]);
  for (let i = 0; i < 10 && !long.trace.closed; i++) {
    m.time += h;
    m.projectile(long, h);
  }
  assert.equal(m.techStats.wallbangHits, 1);
});
