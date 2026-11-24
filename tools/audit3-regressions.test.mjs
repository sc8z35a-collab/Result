import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { IDBFactory, forceCloseDatabase } from 'fake-indexeddb';

const source = process.env.RESULT_QA_SOURCE
  ? pathToFileURL(resolve(process.env.RESULT_QA_SOURCE, 'dist/js') + '/')
  : new URL('../dist/js/', import.meta.url);
const distRoot = process.env.RESULT_QA_SOURCE
  ? resolve(process.env.RESULT_QA_SOURCE, 'dist')
  : resolve(new URL('../dist', import.meta.url).pathname);
const load = name => import(new URL(name + '.js', source));

const {Match} = await load('match');
const {PilotWallet} = await load('wallet');
const {PilotEquipment} = await load('df-hud');
const {eyeOf, targetPoint, vertical} = await load('posture');
const {obstacles, walkable, floorAt, moveActor, obstruction, clearOpticalPath} = await load('yard');
const {solveBallisticImpact} = await load('ballistics');
const {ThermoFlux} = await load('thermoflux');
const {AeroVortex} = await load('aerovortex');
const {SpectraField, worldToSpecCell} = await load('spectrafield');
const {SchlierenOptics} = await load('schlieren');
const {ChronoTrace} = await load('chronotrace');
const {ThermalOptic} = await load('optic');
const {SynapseProfiler} = await load('synapse');
const {SoundEngin2} = await load('audio');
const {SoftwareRenderer} = await load('software');
const {ShadowFlame} = await load('shadowflame');
const {worldVS} = await load('shaders');
const {character} = await load('models');
const {WEAPON_BAND} = await load('nv13pro');
const {WEAPON_RECOIL_PROFILE} = await load('nv23-human');
const {ManusiaSomaPsycheV24, ManusiaTheoryOfMindV24, ManusiaPerceptionV24, ManusiaNeuromotorAimV24} = await load('nv24-manusia');
const {computeSpyDodge} = await load('nv21-spy');
const {triggerAA14Overheat, updateDF40II} = await load('df40ii');
const {updateRD} = await load('rd40');
const {sub, unit} = await load('geometry');

const h = 1 / 360;
const game = (loadout = 'SW T', options = {}, listener = () => {}) => new Match({
  mode: '1v1', limit: 'unlimited', loadout, ...options
}, listener);
const place = (a, x, z, yaw = 0, y = 0) => Object.assign(a, {x, y, z, yaw, pitch: 0, vx: 0, vy: 0, vz: 0, crouch: 0, onGround: y === 0});
const aimAt = (a, b) => {
  const [dx, dy, dz] = sub(targetPoint(b), eyeOf(a));
  a.yaw = Math.atan2(dx, -dz);
  a.pitch = Math.atan2(dy, Math.hypot(dx, dz));
};

function mockStorage(t, database, seed = {}) {
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

function makeFakeAudioContext(initialTime = 0) {
  let now = initialTime;
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
    cancelScheduledValues() {}
  });
  const node = () => ({
    gain: param(),
    frequency: param(),
    Q: param(),
    pan: param(),
    positionX: param(), positionY: param(), positionZ: param(),
    playbackRate: param(),
    threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
    curve: null,
    oversample: 'none',
    connect() { return this; },
    disconnect() {},
    start() {},
    stop() {}
  });
  const ctx = {
    state: 'running',
    sampleRate: 48000,
    get currentTime() { return now; },
    set currentTime(v) { now = v; },
    destination: node(),
    listener: {
      positionX: param(), positionY: param(), positionZ: param(),
      forwardX: param(), forwardY: param(), forwardZ: param(),
      upX: param(), upY: param(), upZ: param()
    },
    createGain: node,
    createBiquadFilter: node,
    createDynamicsCompressor: node,
    createStereoPanner: node,
    createPanner: node,
    createWaveShaper: node,
    createAnalyser: node,
    createConvolver: () => ({...node(), buffer: null}),
    createOscillator: node,
    createBufferSource: node,
    createBuffer: (ch, len) => {
      const channels = Array.from({length: ch}, () => new Float32Array(len));
      return {
        numberOfChannels: ch,
        length: len,
        getChannelData: i => channels[i] || channels[0],
        copyToChannel: (src, i = 0) => { (channels[i] || channels[0]).set(src.subarray(0, len)); }
      };
    },
    async resume() { this.state = 'running'; },
    async close() { this.state = 'closed'; }
  };
  return ctx;
}

// ============================================================================
// P0 — Critical
// ============================================================================

test('A01 | Dropping off a container ledge into the 0.24..0.40 margin never freezes movement', () => {
  const m = game();
  const a = m.player;
  // Container at x=[7.5, 10.5], z=[70.9, 83.1], y1=2.62
  place(a, 7.22, 77, -Math.PI / 2, 2.60);
  assert.equal(floorAt(a.x, a.z, 2.62), 0, 'Must be outside 0.24 support ring');
  assert.equal(walkable(a.x, a.z, 0.4, a.y), false, 'Starts embedded inside 0.40 collision ring');
  a.vx = -4.6;
  moveActor(a, a.vx * h, 0);
  assert(walkable(a.x, a.z, 0.4, a.y), 'Actor must depenetrate out of ledge margin');
  assert(a.x < 7.11, `Actor must slide clear of x0=7.5 wall (got x=${a.x})`);
  // Also verify zero-input vertical drop escapes instead of falling embedded
  place(a, 7.22, 77, 0, 2.55);
  moveActor(a, 0, 0);
  assert(walkable(a.x, a.z, 0.4, a.y), 'Zero-input drop must also depenetrate cleanly');
});

test('A02 | Non-npcWeapons NPCs (RD40, DF40 II, DF1 OUT) resolve meshes without crashing software or shadow passes', () => {
  const stubCanvas = createCanvas(64, 36);
  const sw = new SoftwareRenderer(stubCanvas);
  sw.actors = {};
  sw.actorsLite = {};
  for (const gun of ['RD40', 'DF40 II', 'DF1 OUT', 'UNKNOWN_GUN']) {
    const npc = {team: 1, gun, isSpy: false};
    const hi = sw.actorMesh(npc, false);
    const lo = sw.actorMesh(npc, true);
    assert(hi && hi.data.length > 0, `High/low mesh must build lazily for ${gun}`);
    assert(lo && lo.data.length > 0, `Lite mesh must build lazily for ${gun}`);
  }
  // ShadowFlame drawActorsShadow falls back cleanly to SW T when weapon key is absent
  const drawn = [];
  const fakeGL = {
    uniform1i() {}, uniformMatrix4fv() {}, uniform2f() {}, uniform3f() {}, uniform4f() {}
  };
  const sf = Object.assign(Object.create(ShadowFlame.prototype), {
    gl: fakeGL,
    depthProg: {uMode: 1, uModel: 2, uGait: 3, uPose: 4, uHit: 5}
  });
  const actorsMap = {'1SW T': {id: 'fallback-swt'}};
  sf.drawActorsShadow({
    actors: [{id: 1, alive: true, human: false, team: 1, gun: 'DF40 II', isSpy: false, yaw: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, stride: 0, crouch: 0, lean: 0, aimPose: 0}]
  }, mesh => drawn.push(mesh), actorsMap, 0);
  assert.deepEqual(drawn, [{id: 'fallback-swt'}]);
});

test('A03 | SoftwareRenderer initializes tone, reuses #software-surface, and app.js guards recoverRenderer', () => {
  const created = [];
  const parent = {
    querySelector: sel => (sel === '#software-surface' ? created[0] || null : null)
  };
  const fakeInput = {
    parentNode: parent,
    clientWidth: 128,
    clientHeight: 72,
    getContext: () => null,
    after: el => created.push(el)
  };
  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement: () => Object.assign(createCanvas(1, 1), {id: ''})
  };
  try {
    const sw1 = new SoftwareRenderer(fakeInput);
    assert(sw1.tone === sw1.tones.sdr && sw1.tone.length > 0, 'tone LUT must be initialized in constructor');
    assert.equal(created.length, 1);
    const sw2 = new SoftwareRenderer(fakeInput);
    assert.equal(created.length, 1, 'Second SoftwareRenderer must reuse existing #software-surface');
    assert.equal(sw2.canvas, sw1.canvas);
  } finally {
    globalThis.document = prevDoc;
  }
  const appSrc = readFileSync(resolve(distRoot, 'js/app.js'), 'utf8');
  assert(appSrc.includes('if (recovering) return;'), 'recoverRenderer must guard against re-entrancy');
  assert(!appSrc.includes('catch (error) { recoverRenderer(error); }'), 'setGraphics/resize must not unconditionally invoke recoverRenderer on SoftwareRenderer');
});

// ============================================================================
// P1 — High Severity
// ============================================================================

test('A04 | Fresh ThermoFlux constructor initializes neutral teamTag=-1 and stampTime=-100', () => {
  const tf = new ThermoFlux();
  tf.depositHeat(2, 70, 1.0, 1);
  assert.equal(tf.findEnemySpoor([2, 1.62, 74], 0, 1.0, 14), null, 'Neutral crater heat must not spoof Team 0 spoor');
  tf.stampFootprint(2, 70, 0, 1.0, 0.5);
  const spoor = tf.findEnemySpoor([2, 1.62, 74], 0, 1.2, 14);
  assert(spoor && Math.hypot(spoor.x - 2, spoor.z - 70) < 3, 'Genuine Team 0 footprint must be tracked');
});

test('A05 | AeroVortex updates stats.totalSmoke immediately upon smoke deployment before any fluid step', () => {
  const m = game();
  place(m.player, 2, 76, 0);
  assert.equal(m.aeroVortex.stats.totalSmoke, 0);
  assert(m.deploySmokeVent(m.player));
  assert(m.aeroVortex.stats.totalSmoke > 1.8, `totalSmoke must update immediately (got ${m.aeroVortex.stats.totalSmoke})`);
  assert.equal(clearOpticalPath([2, 1.4, 76], [2, 1.4, 66], m.aeroVortex), false, 'LOS must be occluded immediately without waiting for 24Hz fluid step');
});

test('A06 | Downward crate wallbang stops at the concrete wharf deck instead of exiting underground', () => {
  const crate = obstacles.find(o => o.mat === 'wood' && o.y0 === 0);
  assert(crate, 'Map must contain a ground-level wooden crate');
  const cx = (crate.x0 + crate.x1) * 0.5;
  const cz = (crate.z0 + crate.z1) * 0.5;
  const hit = {
    point: [cx, crate.y1, cz],
    normal: [0, 1, 0],
    exitPoint: [cx, 0, cz],
    exitNormal: [0, -1, 0],
    thickness: crate.y1,
    mat: 'wood'
  };
  const shot = {gun: 'MS10', dir: [0, -1, 0], speed: 500, damage: 30, penetrations: 0, ricochets: 0};
  const res = solveBallisticImpact(shot, hit, () => 0.5);
  assert.equal(res.action, 'stop', 'Downward crate exit into concrete deck must stop instead of spawning underground');
});

test('A07 | ManusiaNeuromotorAimV24 Meyer Phase-2 SUBMOVE is not overwritten by super.step()', () => {
  const aim = new ManusiaNeuromotorAimV24(() => 0.5, false);
  const a = {id: 1, x: 0, y: 0, z: 20, yaw: 0, pitch: 0, vx: 0, vz: 0, aimPose: 0};
  const target = {id: 2, x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0, crouch: 0, lean: 0};
  aim.motorPhase = 'SUBMOVE';
  aim.subMoveStartAt = 10.0;
  aim.subMoveDur = 0.08;
  aim.subStartYaw = 0.0;
  aim.subStartPitch = 0.0;
  aim.subGoalYaw = 0.14;
  aim.subGoalPitch = 0.02;
  aim.step(a, 1 / 60, 10.04, {seenTarget: target, wpn: {gun: 'SRA'}});
  // At u = 0.5, quintic s(0.5) = 0.5 => exact yaw = 0.07, pitch = 0.01
  assert(Math.abs(a.yaw - 0.07) < 1e-4, `Meyer SUBMOVE yaw must be preserved (got ${a.yaw})`);
  assert(Math.abs(a.pitch - 0.01) < 1e-4, `Meyer SUBMOVE pitch must be preserved (got ${a.pitch})`);
});

test('A08 | Unseen kill never leaks exact killer world coordinates via MAN_DOWN callout or traumaAngles', () => {
  const m = new Match({mode: '3v3', limit: 'unlimited', aiModel: 'human'});
  const victim = m.actors.find(a => !a.human && a.team === 0);
  const killer = m.actors.find(a => a.team === 1);
  // Put steel container [9, 77] between killer and victim; victim faces away
  place(victim, 5.2, 77, -Math.PI / 2);
  place(killer, 12.8, 77, -Math.PI / 2);
  assert(obstruction(eyeOf(victim), targetPoint(killer)) <= 1, 'Container must block LOS');
  const bV = m.nv.brains.get(victim.id);
  bV.contacts.clear();
  bV.seen = null;
  // Ricochet impact arriving from +Z (dir = [0, 0, -1], so -dir = [0, 0, +1])
  m.damage(victim, killer, 200, [0, 0, -1], {ricochet: true});
  const manDown = m.nv.comms.queue.find(c => c.kind === 'MAN_DOWN' && c.callerId === victim.id);
  assert(manDown, 'MAN_DOWN callout must still be emitted');
  assert.equal(manDown.enemyId, -1, 'Unseen killer ID must not be broadcast');
  assert(Math.hypot(manDown.x - victim.x, manDown.z - victim.z) <= 2.4, 'Unseen MAN_DOWN must report fallen ally position (with callout fuzz), not hidden killer coordinates');
  assert(Math.hypot(manDown.x - killer.x, manDown.z - killer.z) > 4.5, 'Unseen MAN_DOWN must not leak killer location');
  const tr = bV.mind.traumaAngles[bV.mind.traumaAngles.length - 1];
  assert(tr, 'Trauma danger angle should still be recorded from incoming impact bearing');
  // Threat direction toward -dir [0, 0, +1] has threatZ > victim.z and threatX ≈ victim.x (NOT killer.x = 12.8!)
  const trYaw = Math.atan2(tr.threatX - tr.x, -(tr.threatZ - tr.z));
  assert(Math.abs(Math.cos(trYaw) + 1) < 0.25, `Trauma angle must follow incoming impact vector, not hidden killer (trYaw=${trYaw})`);
});

test('A09 | Multi-pellet same-tick hits and 0-shield hits do not falsely trigger SHIELD_BREAK', () => {
  const m = new Match({mode: '3v3', limit: 'unlimited', aiModel: 'human'});
  const attacker = m.actors.find(a => !a.human && a.team === 0);
  const victim = m.actors.find(a => a.team === 1);
  place(attacker, 2, 70, 0);
  place(victim, 2, 60, Math.PI);
  const bA = m.nv.brains.get(attacker.id);
  let tomBreaks = 0;
  const origBreak = bA.tom.onEnemyShieldBroken.bind(bA.tom);
  bA.tom.onEnemyShieldBroken = (...args) => { tomBreaks++; return origBreak(...args); };
  // 2 simultaneous pellets in the same tick: pellet 1 breaks 10 shield, pellet 2 hits flesh while shieldFlash === 1
  m.damage(victim, attacker, 12, [0, 0, -1]);
  m.damage(victim, attacker, 12, [0, 0, -1]);
  const breaks = m.nv.comms.queue.filter(c => c.kind === 'SHIELD_BREAK' && c.callerId === attacker.id);
  assert.equal(breaks.length, 1, `Simultaneous multi-pellet hit must emit SHIELD_BREAK exactly once (got ${breaks.length})`);
  assert.equal(tomBreaks, 1, `ToM shield break clock must trigger exactly once across multi-pellet salvo (got ${tomBreaks})`);
  // Victim with shield already 0 and hp 100 must NEVER trigger shield break
  const victim2 = m.actors.find(a => a.team === 1 && a.id !== victim.id);
  victim2.shield = 0;
  victim2.hp = 100;
  m.time += 2.0;
  const beforeCount = m.nv.comms.queue.filter(c => c.kind === 'SHIELD_BREAK').length;
  m.damage(victim2, attacker, 10, [0, 0, -1]);
  const afterCount = m.nv.comms.queue.filter(c => c.kind === 'SHIELD_BREAK').length;
  assert.equal(afterCount, beforeCount, 'Hit on 0-shield actor at 100 HP must not false-trigger SHIELD_BREAK');
  assert.equal(tomBreaks, 1, 'Hit on 0-shield actor must not trigger ToM shield break');
});

test('A10 | saveAwards queues concurrent manual retry instead of dropping it and updates pending state cleanly', async () => {
  let resolveFirst;
  const saved = [];
  const wallet = {
    state: {units: 0, evr: false},
    change: receipt => new Promise(resolve => {
      if (receipt === 'r2') {
        resolveFirst = () => { saved.push(receipt); wallet.state.units += 10; resolve(true); };
      } else {
        saved.push(receipt);
        wallet.state.units += 10;
        resolve(true);
      }
    })
  };
  const eq = Object.assign(Object.create(PilotEquipment.prototype), {
    wallet,
    getMatch: () => null,
    notice: () => {},
    accountView: () => {},
    pendingAwards: new Map([['r1', 'm1'], ['r2', 'm1']]),
    failedAwards: new Set(['r1']),
    savingAwards: false
  });
  const p = eq.saveAwards('r2'); // skips r1 because it is in failedAwards
  eq.saveAwards();               // manual retry arrives while r2 is in flight!
  resolveFirst();
  await p;
  assert.deepEqual(saved, ['r2', 'r1'], 'Queued manual retry must process previously failed receipt r1');
  assert.equal(eq.pendingAwards.size, 0);
  assert.equal(eq.failedAwards.size, 0);
});

test('A11 | Wallet ignores malformed backup award keys, reconnects on read(), and recovers purchase on InvalidStateError', async t => {
  const idb = new IDBFactory();
  mockStorage(t, idb, {'audit3-wallet-fallback/award/': '1', 'audit3-wallet-fallback/award/valid/1': '1'});
  const w = new PilotWallet(() => {}, 'audit3-wallet');
  t.after(() => w.db?.close());
  await w.ready;
  const b = w.readBackup();
  assert(!b.receipts.has(''), 'Empty receipt key must be ignored by readBackup');
  assert(b.receipts.has('valid/1'));
  // Simulate closed DB -> read() should reconnect cleanly
  w.db.close();
  w.db = null;
  await w.read();
  assert(w.db !== null, 'read() must reconnect closed IndexedDB');
  assert.equal(w.state.units, 10);
  // Simulate InvalidStateError during EVR1 purchase (receipt === null) -> reconnect and commit
  forceCloseDatabase(w.db);
  const bought = await w.change(null);
  assert.equal(bought, true, 'Purchase must recover from InvalidStateError by reconnecting');
  assert.equal(w.state.evr, true);
  assert.equal(w.state.units, 5);
});

test('A12 | Recreating a closed AudioContext resets all rate-limit timestamps so sounds are not muted', async t => {
  let ctxTime = 300;
  const created = [];
  const prevWin = globalThis.window;
  globalThis.window = {
    AudioContext: function FakeAudioCtx() {
      const c = makeFakeAudioContext(ctxTime);
      created.push(c);
      return c;
    }
  };
  t.after(() => { globalThis.window = prevWin; });

  const s = new SoundEngin2();
  await s.enable(true);
  const player = {id: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0};
  s.event({type: 'rdlock', actor: player, d01: false}, player);
  s.event({type: 'd01', actor: player}, player);
  assert.equal(s.lastRdLockAt, 300);
  assert.equal(s.lastD01At, 300);

  // Close context and reopen a brand-new AudioContext starting at t = 0.1
  created[0].state = 'closed';
  ctxTime = 0.1;
  await s.enable(true);
  assert.equal(s.lastRdLockAt, -Infinity);
  assert.equal(s.lastD01At, -Infinity);
  const before = s.stats.systemCues;
  s.event({type: 'rdlock', actor: player, d01: false}, player);
  assert.equal(s.stats.systemCues, before + 1, 'Rate-limited cue must play immediately on recreated AudioContext');
});

test('A13 | Smoke vent and NPC stance foley respect distance cutoff, attenuation, occlusion LPF, and delay', () => {
  const s = new SoundEngin2();
  s.on = true;
  s.ctx = makeFakeAudioContext(10);
  s.listenerPos = [0, 1.62, 0];
  s.foleyBus = s.ctx.createGain();
  s.sub300Buf = s.ctx.createBuffer(1, 100);
  s.whiteNoiseBuf = s.ctx.createBuffer(1, 100);
  s.clothBuf = s.ctx.createBuffer(1, 100);
  const calls = [];
  s._playBuffer = opts => calls.push(opts);

  const player = {id: 0, x: 0, y: 0, z: 0};
  // Far smoke at 120m must be culled
  s.event({type: 'smoke', point: [0, 1.0, 120]}, player);
  assert.equal(calls.length, 0, 'Smoke 120m away must be culled');
  // Near smoke at 10m plays with speed-of-sound delay and attenuation
  s.event({type: 'smoke', point: [0, 1.0, 10]}, player);
  assert.equal(calls.length, 2);
  assert(calls[0].start > 10.02, 'Smoke must include d/343 speed-of-sound delay');
  assert(calls[0].gain < 0.16, 'Smoke at 10m must be distance-attenuated');
  assert(Number.isFinite(calls[0].lpf), 'Smoke must pass occlusion LPF');

  // NPC stance foley behind container vs far away
  calls.length = 0;
  s.listenerPos = [5.2, 1.62, 77];
  s._playStanceFoley({x: 12.8, y: 0, z: 77, yaw: 0, crouch: 1, lean: 0}, false, 'crouch', 10);
  assert.equal(calls.length, 1);
  assert(calls[0].lpf < 6000, `Occluded NPC stance foley must be low-pass filtered (got ${calls[0].lpf})`);
  assert(calls[0].start > 10.015, 'NPC stance foley must have acoustic delay');
  calls.length = 0;
  s._playStanceFoley({x: 5.2, y: 0, z: 40, yaw: 0, crouch: 1, lean: 0}, false, 'crouch', 10);
  assert.equal(calls.length, 0, 'Distant NPC stance foley (>14m) must be culled');
});

test('A14 | Reload echo resets Theory-of-Mind mental ammo for ALL listening teammates, not just the first', () => {
  const m = new Match({mode: '3v3', limit: 'unlimited', aiModel: 'human'});
  const allies = m.actors.filter(a => !a.human && a.team === 0);
  const enemy = m.actors.find(a => a.team === 1);
  assert(allies.length >= 2);
  m.time = 5.0;
  enemy.reload = 1.8;
  for (const al of allies) {
    const b = m.nv.brains.get(al.id);
    b.tom.onObservedEnemyShot(enemy.id, enemy.gun, 4.5, 1);
    b.tom.onObservedEnemyShot(enemy.id, enemy.gun, 4.7, 2);
    assert(b.tom.enemyAmmo.get(enemy.id).shots > 0);
  }
  const repBase = {
    kind: 'reload', sourceActor: enemy, sourceSpawnId: enemy.spawnId,
    perceivedPos: [enemy.x, 1.5, enemy.z], emittedAt: 5.0, reloadUntil: 6.8
  };
  m.nv.onEchoArrival({...repBase, listenerId: allies[0].id});
  m.nv.onEchoArrival({...repBase, listenerId: allies[1].id});
  assert.equal(m.nv.brains.get(allies[0].id).tom.enemyAmmo.get(enemy.id).shots, 0);
  assert.equal(m.nv.brains.get(allies[1].id).tom.enemyAmmo.get(enemy.id).shots, 0, 'Second teammate must also reset ToM ammo counter');
});

test('A15 | Theory-of-Mind deduplicates same shot across visual ticks and echo arrival, and resets countedRead on reload', () => {
  const tom = new ManusiaTheoryOfMindV24(() => 0.5, null, false);
  const metrics = {manusiaAmmoReads: 0};
  // Same shotSeq=1 seen on two consecutive visual perception ticks + arrived echo must count ONLY once
  tom.onObservedEnemyShot(5, 'SRA', 10.00, 1);
  tom.onObservedEnemyShot(5, 'SRA', 10.05, 1);
  tom.onObservedEnemyShot(5, 'SRA', 10.09, 1);
  assert.equal(tom.enemyAmmo.get(5).shots, 1, 'Identical shotSeq must be counted once');

  // Fill mag #1 (SW T cap=10 -> 8 shots triggers imminent read)
  for (let i = 1; i <= 8; i++) tom.onObservedEnemyShot(4, 'SW T', 12 + i * 0.25, i);
  assert.equal(tom.predictEnemyReloadSoon(4, 14.5, metrics).imminent, true);
  assert.equal(metrics.manusiaAmmoReads, 1);

  // Enemy reloads -> countedRead resets so mag #2 counts a fresh read!
  tom.onObservedEnemyReload(4, 15.0);
  for (let i = 9; i <= 16; i++) tom.onObservedEnemyShot(4, 'SW T', 17.0 + (i - 8) * 0.25, i);
  assert.equal(tom.predictEnemyReloadSoon(4, 19.5, metrics).imminent, true);
  assert.equal(metrics.manusiaAmmoReads, 2, 'Second mag exhaustion after reload must count as a new ammo read');
});

test('A16 | NV-Synapse sanitizes matchesLearned and decays tankerAffinity/reloadGreed during normal play', t => {
  mockStorage(t, undefined, {
    'result-nv-synapse-v1': JSON.stringify({matchesLearned: 'Infinity', fp: {tankerAffinity: 0.25}})
  });
  const syn = new SynapseProfiler();
  assert.equal(syn.matchesLearned, 0, 'Invalid matchesLearned must sanitize to 0');
  syn.observeTankerCapture();
  syn.observeTankerCapture();
  // Ensure normal West-flank play without further captures adapts out of TANKER_HUNTER
  for (let i = 0; i < 55; i++) {
    syn.observe([-16, 0, 40 - (i % 4) * 20], {time: i * 1.0, observerPos: [0, 0, -25], vx: 0, vz: -3.5, isVisual: true});
  }
  assert(syn.fp.tankerAffinity < 0.54, `tankerAffinity must decay during sustained non-tanker play (got ${syn.fp.tankerAffinity})`);
  assert.equal(syn.activeArchetype, 'WEST_FLANKER');
});

test('A17 | computeSpyDodge respects rooftop elevation a.y and aborts instead of dodging into solid walls', () => {
  const m = new Match({mode: '3v3', limit: 'unlimited', aiModel: 'human', allyNv21: 1});
  const spy = m.actors.find(a => a.isSpy);
  const b = m.nv.brains.get(spy.id);
  // Place Spy on container roof [9, 77, w=3, d=12.2, y1=2.62]
  place(spy, 9, 77, 0, 2.62);
  spy.onGround = true;
  m.time = 10.0;
  b.dodgeUntil = 0;
  m.shots = [{p: [9, 3.6, 85], dir: [0, 0, -1], team: 1 - spy.team, speed: 250, life: 0.5}];
  computeSpyDodge(m.nv, spy, b, b.spy, m.time);
  assert(m.time < b.dodgeUntil, 'Spy on container roof (y=2.62) must find a walkable rooftop dodge');
  assert(walkable(spy.x + b.dodgeVec[0] * 0.72, spy.z + b.dodgeVec[1] * 0.72, 0.41, spy.y));

  // Surround spy inside solid container where all 6 dodge steps of 0.72m fail
  place(spy, 9, 77, 0, 0);
  b.dodgeUntil = 0;
  const prevDodges = m.nv.metrics.projDodges;
  m.shots = [{p: [9, 1.0, 85], dir: [0, 0, -1], team: 1 - spy.team, speed: 250, life: 0.5}];
  computeSpyDodge(m.nv, spy, b, b.spy, m.time);
  assert.equal(b.dodgeUntil, 0, 'Must NOT commit a wall-slamming dodge when all 6 escape vectors are blocked');
  assert.equal(m.nv.metrics.projDodges, prevDodges);
});

test('A18 | SpectraField rooftop sight-cone collapse does not erase hidden ground probability behind containers', () => {
  const sf = new SpectraField();
  // Hidden ground cell on the east side of container [9, 77, w=3, d=12.2, y1=2.62]
  const hiddenX = 12.2, hiddenZ = 77;
  sf.observe(0, hiddenX, hiddenZ, {sigma: 2.0, weight: 0.95});
  const [ix, iz] = worldToSpecCell(hiddenX, hiddenZ);
  const idx = iz * sf.w + ix;
  const before = sf.fields[0][idx];
  // Observer on elevated container roof at x = 0, y = 2.62 looking east (+X -> yaw = PI/2) across container [9, 77]
  const roofObs = {alive: true, x: 0, y: 2.62, z: 77, yaw: Math.PI / 2, pitch: 0, crouch: 0, lean: 0};
  assert(obstruction(eyeOf(roofObs), [hiddenX, 1.15, hiddenZ]) <= 1, 'Container must occlude ground cell from roof observer');
  sf.collapseSightCone(0, roofObs, null);
  assert(sf.fields[0][idx] >= before * 0.95, `Hidden ground probability behind container must not be collapsed from rooftop (before=${before}, after=${sf.fields[0][idx]})`);
});

test('A19 | SchlierenOptics auto-resets seed tracking across Match instances and emits DF40 II Mach shocks', () => {
  const sc = new SchlierenOptics();
  const m1 = {effects: [{seed: 1, kind: 'kill', p: [0, 1, 0]}]};
  sc.step(m1, 0.016);
  assert.equal(sc.waves.length, 1);
  // New match reuses seed: 1 without explicit reset()
  const m2 = {
    effects: [
      {seed: 1, kind: 'kill', p: [2, 1, 2]},
      {seed: 2, kind: 'muzzle', gun: 'DF40 II', human: false, p: [4, 1.5, 4]}
    ]
  };
  sc.step(m2, 0.016);
  assert.equal(sc.waves.length, 3, 'New match seed:1 and DF40 II Mach muzzle must both spawn shockwaves');
});

test('A20 | Stale pre-death echoes do not repopulate working memory or SpectraField after enemy death', () => {
  const m = new Match({mode: '3v3', limit: 'unlimited', aiModel: 'human'});
  const listener = m.actors.find(a => !a.human && a.team === 0);
  const enemy = m.actors.find(a => a.team === 1);
  place(listener, 2, 80, 0);
  place(enemy, 2, 20, Math.PI);
  const bL = m.nv.brains.get(listener.id);
  bL.vision.clearMemorySlot(enemy.id);
  // Enemy fires (echo takes 60 / 343 = ~0.175s to arrive), then dies immediately
  m.fire(enemy);
  m.damage(enemy, listener, 200);
  assert.equal(enemy.alive, false);
  const specBefore = m.spectraField.stats.likelihoodUpdates;
  m.time += 0.30;
  m.step(h, {});
  assert.equal(bL.vision.workingMemory.has(enemy.id), false, 'Dead enemy must not re-enter Cowan working memory from stale echo');
  assert.equal(m.spectraField.stats.likelihoodUpdates, specBefore, 'Stale dead-enemy echo must not pollute SpectraField');
});

// ============================================================================
// P2 — Medium Severity
// ============================================================================

test('A21 | Viewmodel vertex shader uses smoothstep masks and gates multi-barrel recoil on uAnim2.x', () => {
  assert(!worldVS.includes('step(.012,abs(p.x))'), 'Discontinuous barrel step mask must be removed');
  assert(!worldVS.includes('step(.048,abs(p.x))'), 'Discontinuous rail step mask must be removed');
  assert(worldVS.includes('uAnim2.x*') && worldVS.includes('smoothstep(.016,.026,abs(p.x))'), 'Multi-barrel recoil must be gated on uAnim2.x with smoothstep');
  assert(worldVS.includes('smoothstep(.042,.054,abs(p.x))'), 'Rail pulse must use smoothstep');
});

test('A22 | DF40 II clamps d.d01Timer to d.d01Max when AA1.4 turns off or overheats', () => {
  const m = game('DF40 II');
  const p = m.player;
  assert(m.toggleAA14(p).active);
  p.df40.d01Active = true;
  p.df40.d01Timer = 5.5;
  p.df40.d01Max = 5.5;
  m.toggleAA14(p);
  assert.equal(p.df40.d01Max, 4.5);
  assert(p.df40.d01Timer <= 4.5, `d01Timer must clamp to 4.5 on AA1.4 off (got ${p.df40.d01Timer})`);

  assert(m.toggleAA14(p).active);
  p.df40.d01Timer = 5.5;
  triggerAA14Overheat(m, p);
  assert.equal(p.df40.d01Max, 4.5);
  assert(p.df40.d01Timer <= 4.5, `d01Timer must clamp to 4.5 on AA1.4 overheat (got ${p.df40.d01Timer})`);
});

test('A23 | DF40 II and RD40 magnetic aim tracking works at steep pitch and RD40 checks focusSpawnId', () => {
  for (const gun of ['DF40 II', 'RD40']) {
    const m = game(gun);
    const [p, e] = m.actors;
    place(p, 2, 70, 0, 5.5);
    place(e, 2.9, 68.0, Math.PI, 0); // steeply below player (~-1.15 rad pitch)
    aimAt(p, e);
    const targetYaw = p.yaw;
    // Offset yaw by 0.25 rad: at pitch ~ -1.15 (cos ~ 0.4), sep ~ 0.10 < lockHold while raw hypot > lockHold!
    p.yaw = targetYaw - 0.25;
    const d = gun === 'DF40 II' ? p.df40 : p.rd;
    d.focusId = e.id;
    d.focusSpawnId = e.spawnId;
    d.focus = 1;
    d.locked = true;
    const yawBefore = p.yaw;
    if (gun === 'DF40 II') updateDF40II(m, p, 0.05);
    else updateRD(m, p, 0.05);
    assert(p.yaw > yawBefore + 0.005, `${gun} magnetic tracking must engage at steep pitch (before=${yawBefore}, after=${p.yaw})`);
  }
  // RD40 must NOT track target with mismatched spawnId
  const m = game('RD40');
  const [p, e] = m.actors;
  place(p, 2, 70, 0);
  place(e, 2.8, 60, Math.PI);
  p.rd.focusId = e.id;
  p.rd.focusSpawnId = e.spawnId + 99;
  p.rd.focus = 1;
  p.rd.locked = true;
  const yaw0 = p.yaw;
  updateRD(m, p, 0.05);
  assert.equal(p.yaw, yaw0, 'RD40 must ignore mismatched spawnId');
});

test('A24 | ManusiaSomaPsycheV24.getFlowFactor uses persona.clutchComposure rather than typo clutchPoise', () => {
  const high = new ManusiaSomaPsycheV24({name: 'A'}, () => 0.5, false);
  const low = new ManusiaSomaPsycheV24({name: 'A'}, () => 0.5, false);
  high.persona.clutchComposure = 1.0;
  low.persona.clutchComposure = 0.1;
  high.matchPointIntensity = low.matchPointIntensity = 1.0;
  assert(high.getFlowFactor() > low.getFlowFactor() + 0.02, 'Higher clutchComposure must yield higher match-point flow factor');
});

test('A25 | ManusiaPerceptionV24.tunnelFocus updates once per perception tick regardless of candidate count', () => {
  const p1 = new ManusiaPerceptionV24(() => 0.5, false);
  const p3 = new ManusiaPerceptionV24(() => 0.5, false);
  const obs = {id: 0, x: 0, y: 0, z: 20, yaw: 0, pitch: 0, crouch: 0, lean: 0};
  const e1 = {id: 1, x: 0, y: 0, z: 5, vx: 0, vz: 0, crouch: 0, flash: 0};
  const e2 = {id: 2, x: 3, y: 0, z: 5, vx: 0, vz: 0, crouch: 0, flash: 0};
  const e3 = {id: 3, x: -3, y: 0, z: 5, vx: 0, vz: 0, crouch: 0, flash: 0};
  p1.evaluateSighting(obs, e1, 0.05, 5.0, null, 1);
  p3.evaluateSighting(obs, e1, 0.05, 5.0, null, 1);
  p3.evaluateSighting(obs, e2, 0.05, 5.0, null, 1);
  p3.evaluateSighting(obs, e3, 0.05, 5.0, null, 1);
  assert.equal(p3.tunnelFocus, p1.tunnelFocus, 'tunnelFocus must not scale with candidate enemy count');
});

test('A26 | Smoke vent emits kind="smoke" instead of triggering false Supply Tanker alerts or FermatCore enemy pings', () => {
  const m = game();
  const [p, e] = m.actors;
  place(p, 2, 76, 0);
  place(e, 2, 62, Math.PI);
  assert(m.deploySmokeVent(e));
  assert(m.echoPulse.playerWaves.some(w => w.kind === 'smoke'), 'Smoke vent must emit kind="smoke" wave');
  assert(!m.echoPulse.playerWaves.some(w => w.kind === 'tanker'), 'Smoke vent must NOT emit kind="tanker"');
  m.time += 0.2;
  m.step(h, {});
  assert.equal(m.fermat.intel[0].has(e.id), false, 'Smoke canister position must not register as FermatCore enemy echo intel');
});

test('A27 | EchoPulse safely handles null actor on reload and propagates gun & shotSeq to NPC queue', () => {
  const m = game();
  const [p, e] = m.actors;
  place(p, 2, 76, 0);
  place(e, 2, 68, Math.PI);
  assert.doesNotThrow(() => m.echoPulse.emit(m, {kind: 'reload', pos: [2, 1.5, 76], actor: null, team: 0, loudness: 0.9}));
  p.gun = 'DF40 II';
  p.shotCount = 7;
  m.echoPulse.emit(m, {kind: 'fire', pos: [2, 1.5, 76], actor: p, team: 0, loudness: 1.1, gun: 'DF40 II'});
  const q = m.echoPulse.queue.find(r => r.kind === 'fire' && r.listenerId === e.id);
  assert(q && q.gun === 'DF40 II' && q.shotSeq === 7, 'NPC echo queue must carry gun and shotSeq');
});

test('A28 | EVR1 thermal optic scans full vertical ground viewport and skips open ocean outside harbor bounds', () => {
  const m = game();
  const opticCanvas = createCanvas(256, 192);
  const srcCanvas = createCanvas(320, 240);
  const sctx = srcCanvas.getContext('2d');
  sctx.fillStyle = '#000000';
  sctx.fillRect(0, 0, 320, 240);
  const optic = new ThermalOptic(opticCanvas);
  const renderer = {canvas: srcCanvas, aspect: 4 / 3};
  // 1) Deposit strong heat at (0, 62) and aim steeply downward slightly below it so it lands in the top 35% of 256x192!
  m.thermoFlux.depositHeat(0, 62, 1.5, 3);
  const camDown = {pos: [0, 5.2, 70], target: [0, 0, 63.2], fov: 40};
  optic.draw(renderer, m, camDown, 1);
  const img1 = optic.ctx.getImageData(0, 0, 256, 192).data;
  let maxTopRow = 0;
  for (let py = 0; py < Math.floor(192 * 0.35); py++) {
    for (let px = 64; px < 192; px++) {
      maxTopRow = Math.max(maxTopRow, img1[(py * 256 + px) * 4]);
    }
  }
  assert(maxTopRow > 100, `Steep downward EVR1 view must render ground thermal spoor in top 35% rows (max=${maxTopRow})`);

  // 2) Deposit heat along western dock edge x=-24.5, then look west out over open ocean x < -25
  m.thermoFlux.reset();
  m.thermoFlux.depositHeat(-24.5, 0, 1.5, 1);
  const camSea = {pos: [-24, 3.0, 0], target: [-36, 0, 0], fov: 40};
  optic.draw(renderer, m, camSea, 2);
  const img2 = optic.ctx.getImageData(0, 0, 256, 192).data;
  let maxSea = 0;
  for (let py = 0; py < 192; py++) {
    for (let px = 64; px < 192; px++) {
      maxSea = Math.max(maxSea, img2[(py * 256 + px) * 4]);
    }
  }
  assert(maxSea < 50, `Open ocean outside x=-25 must not render clamped dock-edge heat (max=${maxSea})`);
});

test('A29 | ChronoTrace records true exitNormal and orients wallbang exit portal along it', () => {
  const ct = new ChronoTrace();
  const shot = {id: 1, gun: 'MS10', team: 0, owner: {name: 'A'}, p: [0, 1, 0], speed: 500};
  ct.beginShot(shot, 1.0);
  // Enters south face [0, 0, 1], exits orthogonal east face [1, 0, 0]
  ct.recordPenetration(shot, [0, 1, 5], [1, 1, 6], [0, 0, 1], 1.4, 'wood', 1.01, 1.015, [1, 0, 0]);
  ct.finishShot(shot, [5, 1, 10], 'kill', 1.03, {name: 'B'});
  assert.deepEqual(shot.trace.penetrations[0].exitNormal, [1, 0, 0]);
  const mesh = {
    beams: [],
    beam(a, b) { this.beams.push([a, b]); },
    ellipsoid() {}
  };
  ct.appendForensicGeometry(mesh, 1.5, {showAll: true});
  // Exit portal ring centered at [1.04, 1, 6] lies in the YZ plane (all ring points have x ≈ 1.04)
  const exitBeams = mesh.beams.filter(([a, b]) => Math.abs(a[0] - 1.04) < 0.01 && Math.abs(b[0] - 1.04) < 0.01);
  assert(exitBeams.length >= 6, 'Exit portal ring must lie orthogonal to exitNormal [1,0,0]');
});

test('A30 | Incoming ricochet hit pans audio and points HUD damage arc along -e.dir instead of hidden shooter', () => {
  const s = new SoundEngin2();
  s.on = true;
  s.ctx = makeFakeAudioContext(5);
  s.listenerPos = [0, 1.62, 0];
  s.listenerFwd = [0, 0, -1];
  s.listenerRight = [1, 0, 0];
  s.uiBus = s.ctx.createGain();
  s.sub300Buf = s.ctx.createBuffer(1, 100);
  s.pinkNoiseBuf = s.ctx.createBuffer(1, 100);
  const pans = [];
  s._playBuffer = opts => pans.push(opts.pan);

  const player = {id: 0, x: 0, y: 0, z: 0, yaw: 0};
  const hiddenShooterLeft = {id: 1, x: -20, y: 0, z: -5, crouch: 0, lean: 0};
  // Ricochet bullet travels in -X (dir=[-1,0,0]), so it hits player from the RIGHT (+X = -dir)
  s._playIncomingHit({actor: hiddenShooterLeft, victim: player, ricochet: true, dir: [-1, 0, 0]}, player, 5);
  assert(pans.length >= 1 && pans[0] > 0.5, `Ricochet from right must pan right (got ${pans[0]})`);

  const appSrc = readFileSync(resolve(distRoot, 'js/app.js'), 'utf8');
  assert(appSrc.includes('if (!e.ricochet && e.actor && e.actor !== p)'), 'HUD damage arc must use -e.dir on ricochet hits');
});

test('A31 | Death immediately clears active ADS/lock/D01/AA1.4 state and app.js hides reticle during ADS & clears touchFire on respawn', () => {
  for (const gun of ['DF1 OUT', 'RD40', 'DF40 II']) {
    const m = game(gun);
    const [p, e] = m.actors;
    if (p.df) { p.df.ads = true; p.df.locked = true; p.df.boost = true; }
    if (p.rd) { p.rd.locked = true; p.rd.d01Active = true; p.rd.d01Timer = 3.2; }
    if (p.df40) { p.df40.aa14Active = true; p.df40.locked = true; p.df40.d01Active = true; }
    m.damage(p, e, 200);
    assert.equal(p.alive, false);
    if (p.df) assert.deepEqual([p.df.ads, p.df.locked, p.df.boost], [false, false, false]);
    if (p.rd) assert.deepEqual([p.rd.locked, p.rd.d01Active, p.rd.d01Timer], [false, false, 0]);
    if (p.df40) assert.deepEqual([p.df40.aa14Active, p.df40.locked, p.df40.d01Active], [false, false, false]);
  }
  const appSrc = readFileSync(resolve(distRoot, 'js/app.js'), 'utf8');
  assert(appSrc.includes("$('reticle').hidden = !a.alive || !!a.df?.ads;"), 'hud() must keep reticle hidden during DF1 OUT ADS');
  assert(appSrc.includes('fireTouch = fireTouchLast = mousePointer = null;'), 'Player respawn must clear touch/mouse fire pointers');
});

test('A32 | DF40 II AI weapon tables use 300 salvo capacity and dedicated recoil/ARV profile', () => {
  assert.equal(WEAPON_BAND['DF40 II'].cap, 300);
  assert(WEAPON_RECOIL_PROFILE['DF40 II'], 'DF40 II must have a dedicated WEAPON_RECOIL_PROFILE entry');
  assert.equal(WEAPON_RECOIL_PROFILE['DF40 II'].arvWait, true);
});

test('A33 | Actor separation push does not repel NPCs away from enemies hidden behind solid walls', () => {
  const m = new Match({mode: '1v1', limit: 'unlimited', aiModel: 'human'});
  const [p, e] = m.actors;
  // Thin concrete barrier at x=-23.7, z=-94 (w=0.9, d=1.2, h=0.86) or container edge; use a barrier/container
  const wall = obstacles.find(o => o.y1 >= 2.0 && (o.x1 - o.x0) <= 3.1);
  // Place actors just outside opposite faces of a 0.9m barrier? Check if any obstacle has width < 1.2m and y1 >= 1.65 (crane leg or thin obstacle)
  const thin = obstacles.find(o => o.y1 >= 1.65 && Math.min(o.x1 - o.x0, o.z1 - o.z0) <= 1.2);
  // Even if thin wall is 0.4m thick, verify code checks obstruction(eyeOf(a), eyeOf(mate)) <= 1
  const nv2Src = readFileSync(resolve(distRoot, 'js/nv2.js'), 'utf8');
  assert(nv2Src.includes('if (mate.team !== a.team && obstruction(eyeOf(a), eyeOf(mate)) <= 1) continue;'));
  if (thin) {
    const cx = (thin.x0 + thin.x1) * 0.5;
    place(p, cx, thin.z0 - 0.15);
    place(e, cx, thin.z1 + 0.15);
    assert(obstruction(eyeOf(e), eyeOf(p)) <= 1);
  }
});

test('A34 | FermatCore D01 behind-wall intel rejects stale focusSpawnId after target respawn', () => {
  const m = game('DF40 II');
  const [p, e] = m.actors;
  place(p, 5.2, 77, Math.PI / 2);
  place(e, 12.8, 77, -Math.PI / 2);
  assert(obstruction(eyeOf(p), targetPoint(e)) <= 1);
  p.df40.d01Active = true;
  p.df40.focusId = e.id;
  p.df40.focusSpawnId = e.spawnId + 1; // stale spawnId
  m.fermat.refreshTeamVisualIntel(m);
  assert.equal(m.fermat.intel[0].has(e.id), false, 'Stale focusSpawnId must not grant D01 intel');
  p.df40.focusSpawnId = e.spawnId;
  m.fermat.refreshTeamVisualIntel(m);
  assert.equal(m.fermat.intel[0].get(e.id)?.source, 'd01', 'Matching focusSpawnId must grant D01 intel');
});

// ============================================================================
// P3 — Low Severity
// ============================================================================

test('A35 | CSS offsets #chronoBanner below #flirFrame badge when FLIR is active on desktop and touch', () => {
  const css = readFileSync(resolve(distRoot, 'style.css'), 'utf8');
  assert(css.includes('#app[data-flir-active="true"] #chronoBanner'), 'Desktop FLIR offset rule must exist');
  assert(css.includes('body.touch #app[data-flir-active="true"] #chronoBanner'), 'Touch FLIR offset rule must exist');
  assert(css.includes('#echoCompass i.ep-smoke'), 'Smoke compass arc style must exist');
});

test('A36 | ShadowFlame Pro refreshes near shadow cascade when transitioning from match to title screen', () => {
  let clears = 0;
  const fakeGL = {
    TEXTURE0: 0, TEXTURE_2D: 1, FRAMEBUFFER: 2, DEPTH_BUFFER_BIT: 4, POLYGON_OFFSET_FILL: 8,
    activeTexture() {}, bindTexture() {}, bindFramebuffer() {}, viewport() {},
    clear() { clears++; }, useProgram() {}, uniformMatrix4fv() {}, uniform1i() {},
    uniform2f() {}, uniform3f() {}, uniform4f() {}, enable() {}, polygonOffset() {}, disable() {}
  };
  const sf = Object.assign(Object.create(ShadowFlame.prototype), {
    gl: fakeGL,
    staticReady: true,
    staticTarget: {compare: false, tex: {}},
    nearTarget: {fb: {}},
    nearSize: 1536,
    depthProg: {obj: {}, uVP: 1, uModel: 2, uMode: 3, uGait: 4, uPose: 5, uHit: 6},
    lastNearKey: '',
    lastHadMatch: false,
    snappedOrtho: () => ({mat: new Float32Array(16), span: 95, key: 'same-key'}),
    drawActorsShadow() {}
  });
  const fakeMatch = {actors: []};
  sf.prepare(2, [0, 2, 0], [0, 0, -1], fakeMatch, {}, {}, () => {}, 1);
  assert.equal(clears, 1);
  // Transition to title (match = null) with identical snap.key MUST still rebuild once to wipe actor shadows!
  sf.prepare(2, [0, 2, 0], [0, 0, -1], null, {}, {}, () => {}, 2);
  assert.equal(clears, 2, 'Transition from match to title must clear stale NPC shadows');
  // Second static title frame with identical snap.key skips cleanly
  sf.prepare(2, [0, 2, 0], [0, 0, -1], null, {}, {}, () => {}, 3);
  assert.equal(clears, 2, 'Subsequent static title frames still skip redundant shadow rebuilds');
});

test('A37 | Respawning after dying crouched or in ADS does not trigger phantom stance/ADS foley', () => {
  const s = new SoundEngin2();
  s.on = true;
  s.ctx = makeFakeAudioContext(10);
  const foleyCalls = [];
  s._playStanceFoley = (...args) => foleyCalls.push(['stance', ...args]);
  s._playAdsClick = (...args) => foleyCalls.push(['ads', ...args]);
  s._applyEnclosureMix = () => {};
  const player = {id: 0, alive: true, x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, stride: 0, onGround: true, crouch: 1, lean: 0, reload: 0, df: {ads: true, scope: 'thermal'}};
  const fakeMatch = {player, actors: [player], tankers: []};
  const cam = {pos: [0, 1.6, 0], target: [0, 1.6, -1]};
  s.update(0.016, fakeMatch, cam); // record alive crouched + ADS
  player.alive = false;
  s.update(0.016, fakeMatch, cam); // dead
  player.alive = true;
  player.crouch = 0;
  player.df.ads = false;
  foleyCalls.length = 0;
  s.update(0.016, fakeMatch, cam); // respawn upright + hipfire
  assert.equal(foleyCalls.length, 0, `Respawn must not play phantom stand/ADS foley (got ${foleyCalls.length})`);
});

test('A38 | Lightweight character LOD builds distinct twin/tri-barrel weapon silhouettes for RD40 and DF40 II', () => {
  const swt = character(0, 'SW T', 'standard', 'lite');
  const rd40 = character(0, 'RD40', 'standard', 'lite');
  const df40 = character(0, 'DF40 II', 'standard', 'lite');
  assert(rd40.count > swt.count, 'RD40 lite LOD must include twin-barrel silhouette geometry');
  assert(df40.count > rd40.count, 'DF40 II lite LOD must include tri-barrel silhouette geometry');
});
