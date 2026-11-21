import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = process.env.RESULT_QA_SOURCE
  ? pathToFileURL(resolve(process.env.RESULT_QA_SOURCE, 'dist/js') + '/')
  : new URL('../dist/js/', import.meta.url);
const load = name => import(new URL(name + '.js', source));

const {Match, weapons} = await load('match');
const {
  NV24_MANUSIA_VERSION,
  CALLSIGN_PROFILES_V24,
  COMMS_CHANNELS_V24,
  PEEK_STYLES,
  ManusiaSomaPsycheV24,
  ManusiaTheoryOfMindV24,
  ManusiaPerceptionV24,
  ManusiaNeuromotorAimV24,
  ManusiaGazeV24,
  ManusiaTacticsV24,
  ManusiaSocialSquadV24
} = await load('nv24-manusia');
const {HumanPsycheV23} = await load('nv23-human');
const {random} = await load('geometry');
const {obstruction} = await load('yard');
const {eyeOf, targetPoint} = await load('posture');

const h = 1 / 360;

test('NV2.4-01 | Default Match launches NV 2.4 Manusia across all NPCs including 3v3 Spy allies (NAGI/KAI) with nv23/classic A/B/C isolation', () => {
  assert.equal(NV24_MANUSIA_VERSION, 'NV 2.4 Manusia');
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T', allyNv21: 1});
  assert.equal(m.nv.version, NV24_MANUSIA_VERSION);
  const nagi = m.actors[1];
  const kai = m.actors[2];
  assert.equal(nagi.isSpy, true);
  assert.equal(nagi.aiVersion, 'NV2.1');
  assert.equal(kai.aiVersion, NV24_MANUSIA_VERSION);

  for (const a of m.actors.filter(x => !x.human)) {
    const b = m.nv.brains.get(a.id);
    assert(b.mind instanceof ManusiaSomaPsycheV24 && b.mind instanceof HumanPsycheV23, `${a.name} must run ManusiaSomaPsycheV24`);
    assert(b.tom instanceof ManusiaTheoryOfMindV24, `${a.name} must run ManusiaTheoryOfMindV24`);
    assert(b.vision instanceof ManusiaPerceptionV24, `${a.name} must run ManusiaPerceptionV24`);
    assert(b.humanAim instanceof ManusiaNeuromotorAimV24, `${a.name} must run ManusiaNeuromotorAimV24`);
    assert(b.gaze instanceof ManusiaGazeV24, `${a.name} must run ManusiaGazeV24`);
    assert(b.tactics instanceof ManusiaTacticsV24, `${a.name} must run ManusiaTacticsV24`);
  }

  // A/B/C tier isolation: team 0 = manusia, team 1 = nv23
  const mAb = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SRA', allNpc: true, teamAiModels: ['human', 'nv23']});
  assert(mAb.nv.brains.get(mAb.actors[0].id).tom instanceof ManusiaTheoryOfMindV24);
  assert.equal(mAb.nv.brains.get(mAb.actors[3].id).tom, null, 'NV2.3 team must not instantiate V2.4 TheoryOfMind');
  assert.equal(mAb.actors[3].aiVersion, 'NV2.3 HUMAN');
});

test('NV2.4-02 | ManusiaSomaPsycheV24: Heart Rate (BPM), Stamina, Precision Breath-Hold, Post-Clutch Adrenaline Dump & Match-Point Focus', () => {
  for (const cs of ['NAGI', 'KAI', 'RIN', 'SORA', 'AO']) {
    const p = CALLSIGN_PROFILES_V24[cs];
    assert(p && (p.handedness === 1 || p.handedness === -1) && p.triggerPatience > 0 && p.utilityIQ > 0 && p.playerBond > 0);
  }
  const actor = {id: 1, team: 0, name: 'SORA', x: 0, y: 0, z: 20, yaw: 0, hp: 100, shield: 10, vx: 5.5, vz: 0, crouch: 0, onGround: true};
  const mind = new ManusiaSomaPsycheV24(actor, random(42), false);
  const bpmRest = mind.heartRate;
  // Sustained sprint + combat drains stamina & elevates biological heart rate
  for (let i = 0; i < 60; i++) {
    mind.step(actor, 0.05, 1 + i * 0.05, true, {aliveAllies: 1, aliveEnemies: 3, killsToWin: 1});
  }
  assert(mind.stamina < 0.75, `Sustained sprint must drain somatic stamina (got ${mind.stamina})`);
  assert(mind.heartRate > bpmRest + 15, `Combat + sprint must elevate heart rate BPM (rest=${bpmRest}, now=${mind.heartRate})`);
  assert(mind.matchPointIntensity > 0.75, `killsToWin=1 must raise Match-Point intensity (got ${mind.matchPointIntensity})`);

  // Precision respiratory breath-hold slows breathing rate & counts telemetry
  mind.stamina = 0.85;
  mind.stress = 0.20;
  const m = {manusiaBreathHolds: 0, manusiaAdrenalineDumps: 0};
  assert(mind.tryEngageBreathHold(10.0, m), 'Calm marksman must engage respiratory breath-hold');
  assert.equal(m.manusiaBreathHolds, 1);
  assert(mind.getBreathRateHz() < 0.06, 'Active breath-hold must pause respiratory oscillation');

  // High-stress / clutch kill triggers Post-Clutch Adrenaline Dump hand tremor
  mind.stress = 0.72;
  mind.onKill(12.0, {id: 4}, m);
  assert(mind.postFightShake > 0.45 && m.manusiaAdrenalineDumps === 1, 'High-stress kill must trigger Post-Clutch Adrenaline Dump');
  assert(mind.getPulseTremorAmp() > 0.001, 'Post-fight adrenaline dump must produce measurable micro-tremor');
});

test('NV2.4-03 | ManusiaTheoryOfMindV24: Self-Exposure Pre-Aim Risk & Unaware-Flank Trigger Discipline', () => {
  const tom = new ManusiaTheoryOfMindV24(random(77), CALLSIGN_PROFILES_V24.NAGI, true);
  const me = {id: 1, x: 0, y: 0, z: 20, yaw: 0, hp: 95};
  // Fresh exposure -> high enemy pre-aim risk at current corner
  tom.recordSelfExposed(0, 20, 4, 10.0);
  const riskHere = tom.getEnemyPreAimRisk(me, 10.6);
  assert(riskHere > 0.65, `Recent exposure at same corner must give high pre-aim risk (got ${riskHere})`);
  // Silently rotating 10m away drops enemy pre-aim risk to 0!
  me.x = 10;
  assert(tom.getEnemyPreAimRisk(me, 11.0) < 0.05, 'Silent rotation away from last exposed spot must collapse pre-aim risk');

  // Unaware rear-facing enemy at 18m triggers authentic Trigger Discipline hold!
  const unawareEnemy = {id: 4, x: 10, y: 0, z: 2, yaw: 0}; // facing -Z (away from me at +Z!)
  const m = {manusiaTriggerDisciplines: 0};
  const hold = tom.evaluateTriggerDiscipline(me, unawareEnemy, {dist: 18, quietEyeShot: false, alignPerceived: 0.04}, 14.0, {stress: 0.1}, m);
  assert.equal(hold, true, 'Patient flanker behind unaware enemy must engage brief Trigger Discipline hold');
  assert.equal(m.manusiaTriggerDisciplines, 1);
  // Instant break as soon as enemy turns around toward us!
  unawareEnemy.yaw = Math.PI; // now facing +Z directly at me!
  const holdTurned = tom.evaluateTriggerDiscipline(me, unawareEnemy, {dist: 18, quietEyeShot: false, alignPerceived: 0.04}, 14.05, {stress: 0.1}, m);
  assert.equal(holdTurned, false, 'Trigger Discipline must cancel immediately if enemy turns to face us');
});

test('NV2.4-04 | ManusiaTheoryOfMindV24: Fair-Play Mental Ammo Counter, 5s Enemy Shield Clock & Acoustic Footstep Feint', () => {
  const tom = new ManusiaTheoryOfMindV24(random(88), CALLSIGN_PROFILES_V24.KAI, false);
  const m = {manusiaAmmoReads: 0, manusiaAcousticFeints: 0};
  // Count 8 heard SW T shots (cap = 10 -> 80% spent -> reload imminent!)
  for (let i = 0; i < 8; i++) tom.onObservedEnemyShot(4, 'SW T', 10 + i * 0.3);
  const pred = tom.predictEnemyReloadSoon(4, 12.6, m);
  assert(pred.imminent && pred.ratio >= 0.75 && m.manusiaAmmoReads === 1, 'Mental ammo counter must predict imminent SW T reload after 8 observed shots');
  tom.onObservedEnemyReload(4, 12.8);
  assert.equal(tom.predictEnemyReloadSoon(4, 13.0, m).imminent, false, 'Observed enemy reload must reset mental ammo counter');

  // 5.0-second enemy shield-recovery mental clock
  tom.onEnemyShieldBroken(4, 20.0);
  assert(tom.getEnemyShieldWindow(4, 22.0) > 2.5, 'Enemy shield must remain tracked as vulnerable within 5.0s window');
  assert.equal(tom.getEnemyShieldWindow(4, 25.5), 0, 'Enemy shield vulnerability clock must expire after 5.0s');

  // Acoustic Footstep Feint (noisy bait sprint -> silent opposite wrap!)
  const actor = {id: 2, x: 0, y: 0, z: 20, hp: 90};
  tom.recordSelfExposed(0, 20, 4, 30.0);
  const b = {seen: null, cover: {x: 0, z: 20}, lastPos: [0, 5], peekEdgeSign: 1};
  let f = null;
  for (let k = 0; k < 15 && !f; k++) {
    tom.feintCooldownUntil = -10;
    f = tom.evaluateAcousticFeint(actor, b, 30.5 + k * 0.01, m);
  }
  assert(f && f.phase === 'noise' && m.manusiaAcousticFeints >= 1, 'High pre-aim risk behind cover must initiate Acoustic Footstep Feint');
  const f2 = tom.evaluateAcousticFeint(actor, b, tom.feintSwitchAt + 0.05, m);
  assert(f2 && f2.phase === 'silent_wrap' && f2.side === -f.side, 'Acoustic Feint must transition from noisy sprint to silent opposite wrap');
});

test('NV2.4-05 | ManusiaPerceptionV24: Smoke-Emergence Lag (beaten by +38% priming) & Clipped Velocity-Extrapolated Cowan Memory', () => {
  const obs = {id: 1, x: 0, y: 0, z: 20, yaw: 0};
  const paraE = {id: 6, x: 5.5, y: 0, z: 8, vx: 0, vz: 0, crouch: 0, flash: 0};
  const vClear = new ManusiaPerceptionV24(random(33), false);
  const vSmoke = new ManusiaPerceptionV24(random(33), false);
  const vPrimedSmoke = new ManusiaPerceptionV24(random(33), false);
  vPrimedSmoke.primeAttention(Math.atan2(paraE.x - obs.x, -(paraE.z - obs.z)), 0, paraE.x, paraE.z, 2.0, 'smoke_edge', 1.0);

  const rClear = vClear.evaluateSighting(obs, paraE, 0.04, 1.0, null, -1, null, {yawRate: 0.1, visibleCount: 1, nearSmokeEdge: false});
  const rSmoke = vSmoke.evaluateSighting(obs, paraE, 0.04, 1.0, null, -1, null, {yawRate: 0.1, visibleCount: 1, nearSmokeEdge: true});
  const rPrimed = vPrimedSmoke.evaluateSighting(obs, paraE, 0.04, 1.05, null, -1, null, {yawRate: 0.1, visibleCount: 1, nearSmokeEdge: true});
  assert(rSmoke.progress < rClear.progress, 'Unprimed smoke-edge pop-out must incur realistic recognition surprise lag');
  assert(rPrimed.progress > rSmoke.progress * 1.35, 'Primed Smoke-Edge Watch must beat unprimed smoke-emergence lag');

  // Velocity-extrapolated Cowan working memory with growing uncertainty
  vClear.upsertWorkingMemory(4, {x: 2, y: 1.2, z: 80, vx: 3.0, vz: 0, confidence: 0.95, source: 'visual'}, 5.0);
  const p1 = vClear.getProjectedMemory(5.5, 4.0);
  const p2 = vClear.getProjectedMemory(6.8, 4.0);
  assert(p1 && p1.projX > 2.4 && p2.uncertaintyRadius > p1.uncertaintyRadius, 'Cowan memory must extrapolate velocity and grow uncertainty over time');
});

test('NV2.4-06 | ManusiaNeuromotorAimV24: Meyer Dual-Submovement, 1/f Pink-Noise, Breath-Hold Tightening & Semi-Auto Trigger Cadence', () => {
  const aim = new ManusiaNeuromotorAimV24(random(66), false, CALLSIGN_PROFILES_V24.SORA);
  const act = {id: 1, x: 0, y: 0, z: 25, yaw: 0, pitch: 0, vx: 0, vz: 0, crouch: 0, aimPose: 1, onGround: true, gun: 'SW T', rd: null, df: null};
  const tgt = {id: 4, x: 6, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, crouch: 0, lean: 0, onGround: true};
  const mind = new ManusiaSomaPsycheV24(act, random(67), false);
  const metrics = {humanFlicks: 0, humanOvershoots: 0, manusiaSubmovements: 0, manusiaBreathHolds: 0};

  // Trigger large flick -> settle -> observe Meyer Phase-2 SUBMOVE or smooth arrival + Breath Hold!
  let t = 1.0;
  let sawBreathHold = false;
  for (let i = 0; i < 180; i++) {
    t += 1 / 120;
    const res = aim.step(act, 1 / 120, t, {seenTarget: tgt, wpn: weapons['SW T'], fallbackYaw: 0, fallbackPitch: 0, mind, metrics});
    if (res.breathHeld) sawBreathHold = true;
  }
  assert(metrics.humanFlicks >= 1, 'Large target offset must trigger Primary Ballistic Saccade');
  assert(sawBreathHold && metrics.manusiaBreathHolds >= 1, 'Long-range calm marksman must engage Respiratory Breath-Hold during Quiet Eye');

  // Semi-auto trigger cadence jitter
  aim.onShotFired('SW T', false, 10.0);
  assert(aim.triggerCadenceUntil >= 10.0 && aim.triggerCadenceUntil <= 10.025, 'Semi-auto trigger tap must add realistic organic cadence jitter');
});

test('NV2.4-07 | ManusiaTacticsV24: Active Tactical Smoke Deployment (14s NPC cooldown) & Anatomical Cover-Edge Lean (never into steel!)', () => {
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SRA', allyNv21: 0});
  const kai = m.actors[2];
  const bKai = m.nv.brains.get(kai.id);
  // Put KAI hurt & under fire -> should deploy defensive AeroVortex smoke vent!
  m.time = 5.0;
  kai.hp = 42;
  kai.shield = 0;
  bKai.underFireAt = 4.8;
  bKai.recentDamage = 24;
  bKai.tactics.nextSmokeCheckAt = -1;
  let deployed = false;
  for (let k = 0; k < 10 && !deployed; k++) {
    bKai.tactics.nextSmokeCheckAt = -1;
    deployed = !!bKai.tactics.evaluateSmokeDeploy(kai, bKai, m, 5.0 + k * 0.01, bKai.mind, m.actors.filter(a => a.team === 0), m.nv.metrics);
  }
  assert(deployed && m.nv.metrics.manusiaSmokeDeploys >= 1, 'Hurt NV 2.4 Manusia NPC under fire must deploy defensive AeroVortex smoke');
  assert(kai.smokeCooldown >= 13.5, 'NPC smoke deployment must enforce fair 14s per-actor cooldown');
  assert.equal(m.smokeCooldown, 0, 'NPC smoke deployment must NOT touch human player HUD smokeCooldown');

  // Anatomical Cover-Edge Lean beside steel container [9, 77, w=3, d=12.2] (west face x = 7.5, z = 70.9..83.1):
  // Stand just south-west of the west corner facing -Z: container wall is on the RIGHT (+X), open lane is on the LEFT (-X)!
  const leanActor = {id: 9, x: 7.1, y: 0, z: 83.6, yaw: 0, crouch: 0, onGround: true};
  const leanB = {cover: {x: 7.1, z: 83.6}, state: 'ピーク射撃'};
  const tac = new ManusiaTacticsV24(random(51), CALLSIGN_PROFILES_V24.KAI, false);
  const lean = tac.computeAnatomicalLean(leanActor, leanB, 0.25, 10.0, {manusiaAnatomicalLeans: 0});
  assert(lean < 0, `With steel container on RIGHT and open lane on LEFT, anatomical lean MUST lean LEFT (< 0, got ${lean})`);
});

test('NV2.4-08 | ManusiaSocialSquadV24: 8 Delayed Voice Channels, Human-Player Buddy Synergy & 100% Fair-Play Zero-Wallhack Proof', () => {
  assert.equal(Object.keys(COMMS_CHANNELS_V24).length, 8);
  const comms = new ManusiaSocialSquadV24(random(99));
  comms.emitCallout(0, 1, -1, 4, 20, 'SMOKE_OUT', 10.0, null);
  assert.equal(comms.drainReady(0, 10.10).length, 0, 'SMOKE_OUT callout must obey realistic human delay');
  assert.equal(comms.drainReady(0, 10.80).length, 1, 'SMOKE_OUT callout must deliver after delay');

  // Human-Player Buddy Synergy: reloading human player on Team 0 triggers delayed RELOAD_COVER for nearby buddy!
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SRA', allyNv21: 0});
  const player = m.player;
  const kai = m.actors[2];
  Object.assign(player, {x: 0, y: 0, z: 40, yaw: 0, reload: 1.0, alive: true});
  Object.assign(kai, {x: 4, y: 0, z: 42, yaw: 0, hp: 100, mag: 20, reload: 0, alive: true});
  m.time = 10.0;
  m.nv.comms.observeHumanPlayer(player, m.actors.filter(a => a.team === 0), 10.0, m.nv.metrics);
  for (let i = 0; i < 320; i++) { m.time += h; m.nv.tick(h); }
  assert(m.nv.metrics.manusiaPlayerAssists >= 1, 'Nearby NV 2.4 Manusia buddy must respond to human player reload with cover assist');

  // 100% Fair-Play Zero-Wallhack Proof behind steel container
  const mFair = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T', allyNv21: 1});
  const nagi = mFair.actors[1];
  const bNagi = mFair.nv.brains.get(nagi.id);
  Object.assign(nagi, {x: -7.8, y: 0, z: 13, yaw: 0, pitch: 0, vx: 0, vz: 0});
  for (const e of mFair.actors.filter(a => a.team === 1)) {
    Object.assign(e, {x: -7.8, y: 0, z: 2, yaw: Math.PI, vx: 0, vz: 0});
  }
  assert(obstruction(eyeOf(nagi), targetPoint(mFair.actors[3])) <= 1, 'Test geometry must be occluded by steel container');
  for (let i = 0; i < 36; i++) mFair.step(h, {});
  assert.equal(bNagi.vision.workingMemory.size, 0, 'Occluded enemies must NEVER enter Manusia workingMemory');
  assert.equal(bNagi.tom.enemyAmmo.size, 0, 'Unheard/unseen occluded enemies must NEVER populate ToM mental ammo tracker');
  assert.equal(bNagi.contacts.size, 0, 'Occluded enemies must NEVER enter AI contacts');
});
