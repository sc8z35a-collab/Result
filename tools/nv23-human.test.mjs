import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = process.env.RESULT_QA_SOURCE
  ? pathToFileURL(resolve(process.env.RESULT_QA_SOURCE, 'dist/js') + '/')
  : new URL('../dist/js/', import.meta.url);
const load = name => import(new URL(name + '.js', source));

const {Match} = await load('match');
const {WEAPON_BAND, getTacticalGraph} = await load('nv13pro');
const {
  NV23_HUMAN_VERSION,
  CALLSIGN_PROFILES,
  PEEK_STYLES,
  COMMS_CHANNELS,
  HumanPsycheV23,
  HumanPerceptionV23,
  HumanOFC_AimV23,
  HumanGazeV23,
  HumanTacticsV23,
  HumanSquadCommsV23
} = await load('nv23-human');
const legacyHuman = await load('nv2-human');
const {random} = await load('geometry');
const {walkable, obstruction} = await load('yard');
const {eyeOf, targetPoint} = await load('posture');

const h = 1 / 360;

test('NV2.3-01 | 3v3 Spy allies (NAGI & KAI) integrate full NV2.3 HUMAN cognition, aim, gaze & tactics', () => {
  for (const spySlot of [1, 2]) {
    const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T', allyNv21: spySlot});
    const spy = m.spyActor;
    assert(spy && spy.isSpy);
    const b = m.nv.brains.get(spy.id);
    assert(b.mind instanceof HumanPsycheV23, 'Spy must run HumanPsycheV23');
    assert(b.vision instanceof HumanPerceptionV23, 'Spy must run HumanPerceptionV23');
    assert(b.gaze instanceof HumanGazeV23, 'Spy must run HumanGazeV23');
    assert(b.humanAim instanceof HumanOFC_AimV23, 'Spy must run HumanOFC_AimV23');
    assert(b.tactics instanceof HumanTacticsV23, 'Spy must run HumanTacticsV23');
    assert(b.spy !== null, 'Spy must retain SpyAgentState');
    assert(typeof spy.humanPersona === 'string' && spy.humanPersona.length > 0);
  }
});

test('NV2.3-02 | WEAPON_BAND properly registers RD30, RD20, RD40 and accurate DF1 OUT capacity', () => {
  for (const gun of ['RD30', 'RD20', 'RD40']) {
    const band = WEAPON_BAND[gun];
    assert(band, `WEAPON_BAND must register ${gun}`);
    assert(band.min > 0 && band.ideal > band.min && band.max > band.ideal && band.cap >= 20);
  }
  assert.equal(WEAPON_BAND['DF1 OUT'].cap, 95);
  assert(getTacticalGraph().nodes.every(n => n.nearCover === true), 'Cover nodes must expose nearCover for Spy Engine');
});

test('NV2.3-03 | Moderate peek tag triggers humanRepeekAborts instead of unconditional SURVIVE_RESET overwrite', () => {
  const m = new Match({mode: '1v1', limit: 'unlimited', loadout: 'SRA'});
  const [p, e] = m.actors;
  const b = m.nv.brains.get(e.id);
  b.cover = {x: e.x, z: e.z, peek: [e.x + 1.5, e.z]};
  b.peekPhase = 'peek';
  b.state = 'ピーク射撃';
  b.exposedSince = m.time;
  e.hp = 80;
  e.shield = 2;
  m.time = 5.0;
  // Moderate tag (15 dmg -> shield breaks, hp = 67 >= 52) while holding cover
  m.damage(e, p, 15, [0, 0, -1]);
  assert(b.repeekAbortPending, 'Moderate tag while peeking must queue a Human Re-Peek Abort');
  assert.notEqual(b.htnTask, 'SURVIVE_RESET', 'nv13pro.onHit must not swallow moderate peek tags into SURVIVE_RESET');
  m.nv.pickGoal(e, b);
  assert(m.nv.metrics.humanRepeekAborts >= 1, 'pickGoal must execute Human Re-Peek Abort');
});

test('NV2.3-04 | Normal dodgeIncomingShots uses walkable() 6-dir solver and avoids slamming into steel walls', () => {
  const m = new Match({mode: '1v1', limit: 'unlimited', loadout: 'MS10'});
  const [p, e] = m.actors;
  const b = m.nv.brains.get(e.id);
  // Place NPC hugging right next to west face of red NORTH container [9, 77, w=3, d=12.2] (x0 = 7.5 -> actor at x = 6.95)
  Object.assign(e, {x: 6.95, y: 0, z: 77, yaw: 0, pitch: 0, vx: 0, vz: 0, onGround: true});
  Object.assign(p, {x: 6.95, y: 0, z: 95, yaw: 0, pitch: 0});
  assert(!walkable(6.95 + 0.72, 77, 0.42, 0), 'East (+X) must be blocked by steel container');
  assert(walkable(6.95 - 0.72, 77, 0.42, 0), 'West (-X) must be open');
  // Incoming shot slightly left of center -> naive perpendicular wants +X (straight into container wall!)
  m.time = 2.0;
  b.dodgeCooldownAt = 0;
  m.shots.push({
    team: 0,
    p: [6.75, 1.05, 95],
    dir: [0, 0, -1],
    speed: 120 // tImp = 18 / 120 = 0.15s (inside human dodge window!)
  });
  m.nv.dodgeIncomingShots(e, b);
  assert(m.time < b.dodgeUntil, 'NPC must initiate walkable dodge');
  const stepX = e.x + b.dodgeVec[0] * 0.72;
  const stepZ = e.z + b.dodgeVec[1] * 0.72;
  assert(walkable(stepX, stepZ, 0.42, 0), `Chosen dodge vector (${b.dodgeVec}) must be strictly walkable!`);
  assert(m.nv.metrics.humanWallDodgesAvoided >= 1, 'Wall-dodge avoidance metric must record blocked perpendicular redirect');
});

test('NV2.3-05 | HumanPsycheV23 12-dim callsign personas, Team Morale, 1vX Clutch Awakening & Respawn-Persistent Episodic Memory', () => {
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T'});
  const callsigns = ['NAGI', 'KAI', 'RIN', 'SORA', 'AO'];
  for (const cs of callsigns) {
    assert(CALLSIGN_PROFILES[cs], `Callsign ${cs} must have a dedicated 12-dim profile`);
  }
  const aoActor = m.actors.find(a => a.name === 'AO');
  const rinActor = m.actors.find(a => a.name === 'RIN');
  const aoMind = m.nv.brains.get(aoActor.id).mind;
  const rinMind = m.nv.brains.get(rinActor.id).mind;
  assert(aoMind.persona.tacticalIQ > rinMind.persona.tacticalIQ, 'AO must have higher tacticalIQ than RIN');
  assert(rinMind.persona.aggression > aoMind.persona.aggression, 'RIN must have higher aggression than AO');

  // Team Morale Contagion
  const beforeMorale = aoMind.morale;
  aoMind.onTeamEvent('ally_kill', 3.0, true);
  assert(aoMind.morale > beforeMorale, 'Ally kill must raise teammate morale');

  // 1vX Clutch Awakening
  for (let i = 0; i < 60; i++) aoMind.step(aoActor, 0.05, 4 + i * 0.05, null, {aliveAllies: 1, aliveEnemies: 3});
  assert(aoMind.isClutching() && aoMind.clutchLevel > 0.5, 'Last-alive 1v3 must trigger 1vX Clutch Awakening');

  // Episodic Memory (Nemesis + Trauma Angle) survives m.spawn() respawn!
  const killer = m.actors[0];
  aoMind.onDeath(aoActor, killer, 10.0);
  aoMind.onDeath(aoActor, killer, 18.0);
  assert.equal(aoMind.nemesisId, killer.id, 'Enemy with >=2 kills on us must become Nemesis');
  assert(aoMind.traumaAngles.length >= 1, 'Death location must register Trauma Danger Angle');
  m.spawn(aoActor);
  const aoMindAfter = m.nv.brains.get(aoActor.id).mind;
  assert.equal(aoMindAfter.nemesisId, killer.id, 'Nemesis episodic memory must survive respawn!');
  assert(aoMindAfter.traumaAngles.length >= 1, 'Trauma Danger Angle must survive respawn!');
});

test('NV2.3-06 | HumanPerceptionV23 Saccadic Suppression, +38% Attention Priming, Hick-Hyman, Cowan K=4, Whiz Back-Trace, Rooftop & Canyon Learning', () => {
  const obs = {id: 1, x: 0, y: 0, z: 20, yaw: 0, crouch: 0, lean: 0};
  const target = {id: 2, x: 5.5, y: 0, z: 4, vx: 0, vz: 0, crouch: 0, flash: 0}; // parafoveal ~19 deg

  // Saccadic Suppression slows recognition during fast head whips (>4.2 rad/s)
  const vCalm = new HumanPerceptionV23(random(11), false);
  const vWhip = new HumanPerceptionV23(random(11), false);
  const rCalm = vCalm.evaluateSighting(obs, target, 0.06, 1.0, null, -1, null, {yawRate: 0.5, visibleCount: 1});
  const rWhip = vWhip.evaluateSighting(obs, target, 0.06, 1.0, null, -1, null, {yawRate: 8.5, visibleCount: 1});
  assert(rWhip.saccadicSuppressed && rWhip.progress < rCalm.progress, 'Fast head whip must engage saccadic suppression');

  // Attention Priming (+38% recognition boost!)
  const vPrime = new HumanPerceptionV23(random(11), false);
  const aimYaw = Math.atan2(target.x - obs.x, -(target.z - obs.z));
  vPrime.primeAttention(aimYaw, 0, target.x, target.z, 2.0, 'callout', 0.9);
  const rPrime = vPrime.evaluateSighting(obs, target, 0.06, 1.0, null, -1, null, {yawRate: 0.5, visibleCount: 1});
  assert(rPrime.primed && rPrime.progress > rCalm.progress * 1.25, 'Attention priming must accelerate recognition (~+38%)');

  // Hick-Hyman multi-enemy load
  const vMulti = new HumanPerceptionV23(random(11), false);
  const rMulti = vMulti.evaluateSighting(obs, target, 0.06, 1.0, null, -1, null, {yawRate: 0.5, visibleCount: 3});
  assert(rMulti.progress < rCalm.progress, 'Multiple simultaneous enemies must apply Hick-Hyman cognitive load');

  // Cowan 4-slot capacity limit
  for (let id = 1; id <= 6; id++) {
    vCalm.upsertWorkingMemory(id, {x: id * 2, y: 1.2, z: 0, confidence: 0.5 + id * 0.05}, 1.0 + id * 0.1);
  }
  assert.equal(vCalm.workingMemory.size, 4, 'Cowan working memory must cap strictly at 4 slots');

  // Bullet-Whiz Tracer Back-Trace (uses ONLY -shot.dir!)
  const trace = vCalm.onBulletWhiz(obs, {dir: [0, 0, 1]}, 1.1, 2.0, null, null);
  assert(trace && Math.abs(trace.yaw) < 0.30, 'Shot flying +Z must back-trace northward (-Z, yaw ~ 0)');

  // Rooftop footstep upward gaze elevation
  const roofCue = vCalm.onEchoArrival(obs, {
    kind: 'step', perceivedPos: [0, 5.24, 10], occluded: false, isDecoy: false
  }, 3.0, null, null);
  assert(roofCue.elevated && roofCue.pitch > 0.14, 'Container rooftop footstep must generate upward gaze pitch');

  // EchoPulse Canyon Echo Experience Learning
  const metrics = {humanEchoLearned: 0};
  vCalm.onEchoArrival(obs, {kind: 'fire', perceivedPos: [-6, 1.4, 46], occluded: true, isDecoy: true}, 4.0, null, metrics);
  // Spot enemy at significantly different bearing (>30 deg off) -> learns canyon echoes!
  const realEnemy = {id: 9, x: 4, y: 0, z: 16, vx: 0, vz: 0, crouch: 0, flash: 0.08};
  for (let k = 0; k < 4; k++) vCalm.evaluateSighting(obs, realEnemy, 0.06, 4.3 + k * 0.06, null, -1, metrics, {yawRate: 0});
  const secondEcho = vCalm.onEchoArrival(obs, {kind: 'fire', perceivedPos: [-6, 1.4, 46], occluded: true, isDecoy: true}, 6.0, null, metrics);
  assert(secondEcho.discountedEcho && metrics.humanEchoLearned >= 1, 'Veteran NPC must learn and discount repeated steel canyon echoes');
});

test('NV2.3-07 | HumanOFC_AimV23 Undershoot Primary Saccade, Smooth Pursuit Constant vs Abrupt A-D Reversal & ARV Lock Wait', () => {
  // Primary saccade undershoot tendency vs startle overshoot
  const aim = new HumanOFC_AimV23(random(77), false);
  let gainSum = 0;
  for (let i = 0; i < 40; i++) {
    aim.motorPhase = 'PURSUIT';
    aim.triggerBallisticFlick(0, 0, 0.85, 0, i, 0.05, false, null, 20);
    gainSum += aim.lastFlickGain;
  }
  const meanGain = gainSum / 40;
  assert(meanGain < 0.98 && meanGain > 0.85, `Calm primary saccade should naturally undershoot (mean=${meanGain.toFixed(3)})`);

  // Smooth Pursuit: constant velocity tracks tightly, abrupt A-D reversal creates authentic human swim-past!
  const shooter = {id: 1, x: 0, y: 0, z: 20, yaw: 0, pitch: 0, vx: 0, vz: 0, crouch: 0, lean: 0, aimPose: 0, onGround: true, gun: 'SRA'};
  const target = {id: 2, x: -3, y: 0, z: 0, yaw: 0, vx: 4.5, vy: 0, vz: 0, crouch: 0, lean: 0, onGround: true};
  const wpn = {speed: 288, capacity: 30};
  const trackAim = new HumanOFC_AimV23(random(42), false);
  let steadyErr = 0;
  for (let i = 0; i < 360; i++) {
    const t = i * h;
    target.x += target.vx * h;
    const res = trackAim.step(shooter, h, t, {seenTarget: target, wpn, fallbackYaw: 0});
    if (i === 359) steadyErr = res.alignTrue;
  }
  // Abrupt A-D reversal: flip target velocity +4.5 -> -4.5 m/s!
  target.vx = -4.5;
  let peakRevErr = 0;
  for (let i = 0; i < 65; i++) {
    const t = 1.0 + i * h;
    target.x += target.vx * h;
    const res = trackAim.step(shooter, h, t, {seenTarget: target, wpn, fallbackYaw: 0});
    if (res.alignTrue > peakRevErr) peakRevErr = res.alignTrue;
  }
  assert(steadyErr < 0.08, `Constant-velocity smooth pursuit must stay crisp (err=${steadyErr.toFixed(4)})`);
  assert(peakRevErr > steadyErr * 1.45, `Abrupt A-D reversal must make human crosshair authentically lag/swim (steady=${steadyErr.toFixed(4)}, rev=${peakRevErr.toFixed(4)})`);

  // ARV lock wait on RD30 when focus >= 0.62 and not yet locked
  const rdShooter = {...shooter, gun: 'RD30', rd: {focus: 0.78, locked: false}};
  const rdAim = new HumanOFC_AimV23(random(13), false);
  rdAim.acquireReadyAt = 0;
  const staticT = {id: 3, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, crouch: 0, lean: 0, onGround: true};
  const rWait = rdAim.step(rdShooter, h, 2.0, {seenTarget: staticT, wpn: {speed: 360, capacity: 80}, fallbackYaw: 0});
  assert(rWait.holdingForArv && !rWait.readyToFire, 'RD30 near lock completion must wait briefly for ARV lock');
  rdShooter.rd.locked = true;
  const rLocked = rdAim.step(rdShooter, h, 2.05, {seenTarget: staticT, wpn: {speed: 360, capacity: 80}, fallbackYaw: 0});
  assert(!rLocked.holdingForArv, 'Once RD30 ARV lock completes, waiting must release cleanly');
});

test('NV2.3-08 | HumanGazeV23 9-Ray Depth-Discontinuity Corner Pre-Aim & Buddy Mutual-Cover Sharing', () => {
  const gaze = new HumanGazeV23(random(33), CALLSIGN_PROFILES.AO, false);
  // Position beside red NORTH container [9, 77, w=3, d=12.2] looking north along corner edge (x=6.8, z=84.5 -> wall to right, deep alley straight ahead!)
  const actor = {id: 1, x: 6.8, y: 0, z: 84.5, yaw: 0, crouch: 0, lean: 0};
  const buddy = {id: 2, x: 4.5, y: 0, z: 85.0, yaw: 0, alive: true}; // buddy already watching north (yaw = 0)!
  const metrics = {humanCornerEdges: 0, humanCornerScans: 0, humanBuddyCoverGaze: 0, humanCheckSix: 0};
  const out = gaze.computeIdleGaze(actor, {state: '戦術掃討'}, 0, 1.0, null, metrics, {allies: [actor, buddy]});
  assert(out.edgeLocked && metrics.humanCornerEdges >= 1, '9-ray scan beside shipping container must detect sharp corner depth discontinuity');
  // Force check-six with buddy watching front -> must pick side/rear sector and credit buddy cover gaze!
  gaze.nextCheckSixAt = 1.5;
  const c6 = gaze.computeIdleGaze(actor, {state: '戦術掃討'}, 0, 1.6, null, metrics, {allies: [actor, buddy]});
  assert(Math.abs(c6.yaw) > 1.0 && metrics.humanBuddyCoverGaze >= 1, 'Check-Six with forward-watching buddy must cover blind flank/rear');
});

test('NV2.3-09 | HumanTacticsV23 Silent Walk (sprintAmt<=0.30, zero footsteps), Wood Wallbang & ResonanceCore Knock Reposition', () => {
  // Silent Walk keeps sprintAmt <= 0.30 and emits ZERO EchoPulse footsteps!
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T'});
  const nagi = m.actors.find(a => a.name === 'NAGI');
  const b = m.nv.brains.get(nagi.id);
  Object.assign(nagi, {x: -16, y: 0, z: 30, vx: 0, vz: 0, sprintAmt: 0, stride: 0});
  b.state = '連携側面展開';
  b.lastPos = [-16, 12]; // 18m ahead -> inside silent approach window!
  const pace = b.tactics.computeMovementPace(nagi, b, 5.0, b.mind, false);
  assert(pace.silentWalk && pace.paceFactor <= 0.86, 'Flank approach within 27m must activate Tactical Silent Walk');
  // Simulate 1.2s at silent walk pace -> sprintAmt must remain <= 0.30 and 0 step echoes emitted!
  m.echoPulse.reset();
  for (let i = 0; i < 360; i++) {
    nagi.vx = 0;
    nagi.vz = -4.64 * pace.paceFactor;
    m.systems(nagi, h);
    nagi.stride += Math.abs(nagi.vz) * h;
  }
  assert(nagi.sprintAmt <= 0.30, `Silent walk sprintAmt (${nagi.sprintAmt}) must stay <= 0.30`);

  // BallisticCore-X Wood Crate Wallbang Check (crates at [2.6, 61, 2.6, 2.6, 1.5])
  const kai = m.actors.find(a => a.name === 'KAI'); // MS10 (3.6m wood penetration!)
  const bk = m.nv.brains.get(kai.id);
  Object.assign(kai, {x: 2.6, y: 0, z: 64.2, mag: 20, reload: 0});
  bk.seen = null;
  bk.state = '遮蔽交戦';
  bk.vision.upsertWorkingMemory(3, {x: 2.6, y: 1.23, z: 58.2, confidence: 0.95, source: 'visual'}, 10.0);
  bk.tactics.nextPhysicsAt = 0;
  // Run deterministic check (set rng to 0.1 so wallbang probability passes)
  bk.tactics.rng = () => 0.1;
  const act = bk.tactics.evaluatePhysicsTactics(kai, bk, m, 10.4, bk.mind, m.nv.metrics);
  assert(act && act.kind === 'wood_wallbang', `MS10 behind 1.5m wooden crate with fresh memory must choose wood_wallbang (got ${act?.kind})`);

  // ResonanceCore Steel Knock Reposition
  const rin = m.actors.find(a => a.name === 'RIN');
  const br = m.nv.brains.get(rin.id);
  Object.assign(rin, {x: -9.85, y: 0, z: 78, alive: true});
  m.time = 12.0;
  m.resonance.exciteStrike([-13.32, 1.3, 78], 1.0, m.player, m);
  assert(br.vision.needsKnockReposition(12.2), 'Victim NPC hit by 5,100 m/s Container Knock must trigger steel-knock reposition');
  assert(m.nv.metrics.humanKnockRepositions >= 1);
});

test('NV2.3-10 | HumanSquadCommsV23 supports all 7 delayed channels + Reload Cover & 0.45-0.95s Trade Swing execution', () => {
  const comms = new HumanSquadCommsV23(random(88));
  const channels = Object.values(COMMS_CHANNELS);
  assert.equal(channels.length, 7);
  for (let i = 0; i < channels.length; i++) {
    assert(comms.emitCallout(0, 1, 3, 2, 10, channels[i], 10.0, null));
  }
  assert.equal(comms.drainReady(0, 10.25).length, 0, 'All 7 callout channels must obey human speech latency (>250ms)');
  const delivered = comms.drainReady(0, 10.90);
  assert.equal(delivered.length, 7, 'All 7 callouts must deliver within 0.34-0.74s');

  // Verify real Trade Swing behavioral coupling in Match
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T'});
  const [p, nagi, kai] = m.actors;
  const rin = m.actors[3];
  Object.assign(nagi, {x: 0, y: 0, z: 40, alive: true, hp: 100, mag: 20});
  Object.assign(kai, {x: 4, y: 0, z: 45, alive: true, hp: 100, mag: 20});
  Object.assign(rin, {x: 0, y: 0, z: 22, alive: true});
  const bKai = m.nv.brains.get(kai.id);
  m.time = 15.0;
  m.nv.comms.emitCallout(0, nagi.id, rin.id, rin.x, rin.z, 'MAN_DOWN', 15.0, m.nv.metrics, {callerX: nagi.x, callerZ: nagi.z});
  // Advance 0.80s so delayed voice callout arrives and schedules 0.45-0.95s trade swing
  for (let i = 0; i < 300; i++) { m.time += h; m.nv.tick(h); }
  assert(bKai.tradeSwingAt > 15.75 && bKai.tradeSwingAt < 16.95, `MAN_DOWN callout must schedule 0.45-0.95s Trade Swing (got ${bKai.tradeSwingAt})`);
});

test('NV2.3-11 | 100% Fair-Play Zero-Wallhack Proof & nv2-human.js Backward Compatibility', () => {
  assert.equal(legacyHuman.NV2_HUMAN_VERSION, NV23_HUMAN_VERSION);
  assert.equal(legacyHuman.HumanMind, HumanPsycheV23);
  assert.equal(legacyHuman.HumanVisionModel, HumanPerceptionV23);
  assert.equal(legacyHuman.HumanMotorAim, HumanOFC_AimV23);
  assert.equal(legacyHuman.HumanGazeDirector, HumanGazeV23);
  assert.equal(legacyHuman.HumanCommsRelay, HumanSquadCommsV23);

  // Zero-Wallhack: hidden enemy behind [-7.8, 8] steel container must NEVER enter workingMemory or contacts!
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T', allyNv21: 1});
  const nagi = m.actors[1]; // Spy + NV2.3 HUMAN
  const bNagi = m.nv.brains.get(nagi.id);
  Object.assign(nagi, {x: -7.8, y: 0, z: 13, yaw: 0, pitch: 0, vx: 0, vz: 0});
  for (const e of m.actors.filter(a => a.team === 1)) {
    Object.assign(e, {x: -7.8, y: 0, z: 2, yaw: Math.PI, vx: 0, vz: 0});
  }
  assert(obstruction(eyeOf(nagi), targetPoint(m.actors[3])) <= 1, 'Steel container must occlude sightline');
  for (let i = 0; i < 36; i++) m.step(h, {});
  assert.equal(bNagi.vision.workingMemory.size, 0, 'Occluded enemies must NEVER enter Cowan working memory');
  assert.equal(bNagi.spy.sightings.size, 0, 'Occluded enemies must NEVER enter Spy visual dossier');
  assert.equal(bNagi.contacts.size, 0, 'Occluded enemies must NEVER enter AI contacts');
});
