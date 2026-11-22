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
  NV25_HUMAIN_VERSION,
  CALLSIGN_PROFILES_V25,
  COMMS_CHANNELS_V25,
  PEEK_STYLES,
  HumainActiveInferenceV25,
  HumainDecisionDDM_V25,
  HumainAffectivePsycheV25,
  HumainMetaMindV25,
  HumainMultisensoryV25,
  HumainSensorimotorV25,
  HumainFixationGazeV25,
  HumainEmbodiedTacticsV25,
  HumainSocialMindV25
} = await load('nv25-humain');
const {ManusiaSomaPsycheV24, ManusiaTheoryOfMindV24} = await load('nv24-manusia');
const {HumanPsycheV23} = await load('nv23-human');
const {random} = await load('geometry');

const h = 1 / 360;

test('NV2.5-01 | Default Match launches NV2.5 humain across all NPCs incl. 3v3 Spy allies (NAGI/KAI) with 4-tier A/B/C/D isolation', () => {
  assert.equal(NV25_HUMAIN_VERSION, 'NV2.5 humain');
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T', allyNv21: 1});
  assert.equal(m.nv.version, NV25_HUMAIN_VERSION);
  assert.equal(m.actors[1].aiVersion, 'NV2.1');
  assert.equal(m.actors[2].aiVersion, NV25_HUMAIN_VERSION);

  for (const a of m.actors.filter(x => !x.human)) {
    const b = m.nv.brains.get(a.id);
    assert(b.inference instanceof HumainActiveInferenceV25, `${a.name} must run HumainActiveInferenceV25`);
    assert(b.ddm instanceof HumainDecisionDDM_V25, `${a.name} must run HumainDecisionDDM_V25`);
    assert(b.mind instanceof HumainAffectivePsycheV25 && b.mind instanceof ManusiaSomaPsycheV24 && b.mind instanceof HumanPsycheV23);
    assert(b.tom instanceof HumainMetaMindV25 && b.tom instanceof ManusiaTheoryOfMindV24);
    assert(b.vision instanceof HumainMultisensoryV25);
    assert(b.humanAim instanceof HumainSensorimotorV25);
    assert(b.gaze instanceof HumainFixationGazeV25);
    assert(b.tactics instanceof HumainEmbodiedTacticsV25);
  }

  // 4-tier isolation: humain vs manusia
  const m25vs24 = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SRA', allNpc: true, teamAiModels: ['human', 'manusia']});
  assert(m25vs24.nv.brains.get(m25vs24.actors[0].id).inference instanceof HumainActiveInferenceV25);
  assert.equal(m25vs24.nv.brains.get(m25vs24.actors[3].id).inference, null, 'NV 2.4 Manusia team must not run NV2.5 Active Inference');
  assert.equal(m25vs24.actors[0].aiVersion, 'NV2.5 humain');
  assert.equal(m25vs24.actors[3].aiVersion, 'NV 2.4 Manusia');
});

test('NV2.5-02 | HumainActiveInferenceV25: Fair-play 6-zone epistemic entropy clears on look, grows unseen, spikes surprise on blind flank', () => {
  const ai = new HumainActiveInferenceV25(random(2502), CALLSIGN_PROFILES_V25.NAGI);
  ai.reset(0, 0);
  const actor = {x: 0, y: 0, z: 30, yaw: 0, team: 0}; // Looking North toward Mid/North
  const initEnt = ai.entropy[2];
  for (let i = 0; i < 180; i++) ai.step(actor, 1 / 60, i / 60, null);
  assert(ai.entropy[2] < initEnt || ai.entropy[3] < initEnt, 'Scanning forward zones must reduce epistemic entropy');

  // Unexpected sighting in own rear South-West zone (low prior) triggers high Karl Friston Prediction Error (surprise)!
  const surpriseRear = ai.observeEvidence(-14, 52, 0.9, 3.0);
  const surpriseExpected = ai.observeEvidence(-14, -48, 0.9, 3.1);
  assert(surpriseRear > surpriseExpected, `Blind rear flank must cause higher prediction error (${surpriseRear} vs ${surpriseExpected})`);

  // FLANK_CLEAR collapses zone threat prior & entropy
  ai.observeFlankClear(-14, 52, 3.2);
  assert(ai.entropy[0] <= 0.20, 'FLANK_CLEAR must drop cleared zone entropy');

  const metrics = {humainEpistemicScans: 0};
  ai.epistemicUrgency = 0.85;
  ai.entropy[5] = 0.95;
  ai.lastClearedAt[5] = -5;
  const look = ai.selectEpistemicLook(actor, 6.0, metrics);
  assert(look && Number.isFinite(look.yaw) && metrics.humainEpistemicScans === 1, 'High entropy must select epistemic look target');
});

test('NV2.5-03 | HumainDecisionDDM_V25: Continuous drift-diffusion evidence triggers Mid-Motion Change-of-Mind (CoM) & Ambiguity Hesitation', () => {
  const ddm = new HumainDecisionDDM_V25(random(2503), CALLSIGN_PROFILES_V25.KAI);
  ddm.reset(0);
  const metrics = {humainChangeOfMinds: 0, humainHesitations: 0};
  const actor = {hp: 100, shield: 10, mag: 24, reload: 0};
  const b = {visibleEnemies: [{id: 3}], seen: true, targetId: 3, underFireAt: -10, recentDamage: 0, state: '一斉突入', peekPhase: 'peek'};
  const mind = {challengeBalance: 0.6, hotHand: 0.5, matchPointIntensity: 0, isSuppressed: () => false};
  const tom = {getEnemyShieldWindow: () => 2.5, predictEnemyReloadSoon: () => ({imminent: true}), getEnemyPreAimRisk: () => 0.1};

  // Accumulate strong COMMIT evidence
  for (let i = 0; i < 90; i++) ddm.step(actor, b, 1 / 60, i / 60, mind, tom, metrics);
  assert.equal(ddm.decision, 'COMMIT', 'Strong favorable evidence must cross COMMIT bound');

  // Suddenly 2nd enemy appears & heavy damage hits -> Resulaj Mid-Motion Change-of-Mind abort!
  actor.hp = 44;
  actor.shield = 0;
  b.visibleEnemies = [{id: 3}, {id: 4}];
  b.underFireAt = 1.6;
  b.recentDamage = 32;
  let aborted = false;
  for (let i = 0; i < 120; i++) {
    const out = ddm.step(actor, b, 1 / 60, 1.6 + i / 60, mind, tom, metrics);
    if (out.changeOfMindAbort) aborted = true;
  }
  assert(aborted && metrics.humainChangeOfMinds >= 1, 'Sudden 1v2 heavy tag while pushing must trigger Change-of-Mind abort');

  // Conflicting mid-range evidence triggers brief human hesitation
  ddm.evCommit = 0.44;
  ddm.evRetreat = 0.42;
  b.underFireAt = -10;
  const hOut = ddm.step(actor, b, 1 / 60, 8.0, mind, tom, metrics);
  assert(hOut.hesitating && metrics.humainHesitations >= 1, 'Colliding Commit/Retreat evidence must trigger ambiguity micro-hesitation');
});

test('NV2.5-04 | HumainAffectivePsycheV25: Blascovich Challenge vs Threat appraisal, Allostatic Deep-Breath Reset, Nemesis Respect & Startle Freeze', () => {
  for (const cs of ['NAGI', 'KAI', 'RIN', 'SORA', 'AO']) {
    const p = CALLSIGN_PROFILES_V25[cs];
    assert(p.epistemicCuriosity > 0.7 && p.composureRecovery > 0.7 && p.ddmBound > 0.7 && p.mixupIQ > 0.7);
  }
  const mind = new HumainAffectivePsycheV25({id: 1, name: 'NAGI', hp: 100, shield: 10}, random(2504), false);
  const metrics = {humainBreathResets: 0, manusiaAdrenalineDumps: 0};

  // Kill builds Hot-Hand & Challenge appraisal
  mind.onKill(2.0, {id: 4}, metrics);
  assert(mind.hotHand > 0.3 && mind.challengeBalance > 0.3, 'Kill must raise hot-hand and challenge appraisal');

  // Repeated deaths to same killer build Nemesis Tactical Respect & shift to Threat appraisal
  mind.onDeath({id: 1, x: 0, z: 0}, {id: 5}, 3.0);
  mind.onDeath({id: 1, x: 0, z: 0}, {id: 5}, 6.0);
  assert(mind.getNemesisRespect(5) >= 0.8, 'Repeated deaths to same enemy must build Nemesis Tactical Respect');
  assert(mind.challengeBalance < 0, 'Death streak must shift appraisal toward Threat');

  // Unexpected high-surprise shock causes brief physiological Startle Freeze
  assert.equal(mind.onUnexpectedShock(0.75, 7.0), true);
  assert.equal(mind.isStartleFrozen(7.04), true, 'High surprise must briefly startle-freeze motor output');
  assert.equal(mind.isStartleFrozen(7.30), false, 'Startle freeze must clear quickly (< 150ms)');

  // Calm lull recovers Allostatic Load via Deep-Breath Reset
  mind.allostaticLoad = 0.65;
  mind.stress = 0.50;
  mind.heartRate = 96;
  const calmActor = {hp: 100, shield: 10, vx: 0, vz: 0, onGround: true};
  for (let i = 0; i < 240; i++) mind.step(calmActor, 1 / 60, 8.0 + i / 60, null, {aliveAllies: 3, aliveEnemies: 3, metrics});
  assert(metrics.humainBreathResets >= 1, 'Sustained calm lull after load must trigger Deep-Breath Reset');
});

test('NV2.5-05 | HumainMetaMindV25: Self-habit Pattern Break, Fair-Play Greed/Camp Profiling, Wounded Bait Trap & Post-Kill Trade Check', () => {
  const meta = new HumainMetaMindV25(random(2505), CALLSIGN_PROFILES_V25.RIN, false);
  const metrics = {humainPatternBreaks: 0, humainBaitTraps: 0, humainPostKillChecks: 0};

  // Self-habit repetition detection
  assert.equal(meta.recordOwnPeek(PEEK_STYLES.WIDE, 1.0, metrics), false);
  assert.equal(meta.recordOwnPeek(PEEK_STYLES.WIDE, 2.0, metrics), true);
  assert.equal(metrics.humainPatternBreaks, 1, 'Repeating identical peek style must trigger conscious pattern break');

  // Observe enemy greedily chasing while we are wounded
  const actor = {x: 0, y: 0, z: 10, hp: 52, mag: 16, reload: 0};
  const enemy = {id: 4, x: 0, y: 0, z: -6, vx: 0, vz: 4.5};
  meta.observeEnemyHabit(actor, enemy, 1.0, true);
  meta.observeEnemyHabit(actor, {id: 4, x: 0, y: 0, z: -2, vx: 0, vz: 4.5}, 2.0, true);
  assert(meta.getEnemyHabit(4).greed > 0.50, 'Observed pursuit on wounded player must raise enemy greed score');

  // Wounded Bait Trap behind cover
  const b = {seen: false, cover: {x: 0, z: 10}, lastPos: [0, -2], targetId: 4, underFireAt: 2.2};
  let trap = null;
  for (let k = 0; k < 6 && !trap; k++) {
    meta.baitTrapCooldownUntil = -10;
    trap = meta.tryStartWoundedBaitTrap(actor, b, 3.0 + k * 0.1, metrics);
  }
  assert(trap && trap.active && metrics.humainBaitTraps >= 1, 'Wounded actor facing greedy enemy behind cover must set Wounded Bait Trap');

  // Post-kill Trade-Check ritual
  meta.triggerPostKillCheck(actor, [0, -2], 5.0, metrics);
  assert(meta.postKillCheckUntil > 5.2 && metrics.humainPostKillChecks === 1, 'Kill must schedule Post-Kill Trade-Check gaze ritual');
});

test('NV2.5-06 | HumainMultisensoryV25: Cross-Modal Audio-Visual Super-Additive Lock & Static Crouched Off-Angle Camouflage Delay', () => {
  const vAudio = new HumainMultisensoryV25(random(2506), false);
  const vSilent = new HumainMultisensoryV25(random(2506), false);
  const metrics = {humainCrossModalLocks: 0, humainCamoDelays: 0};
  const actor = {x: 0, y: 0, z: 20, yaw: 0, pitch: 0};
  const enemyMoving = {id: 3, x: 9, y: 0, z: 6, vx: 2.5, vz: 0, crouch: 0, flash: 0};
  const enemyStillCrouched = {id: 4, x: 9, y: 0, z: 6, vx: 0, vz: 0, crouch: 0.9, flash: 0};

  // Feed arrived audio cue from enemy bearing -> super-additive cross-modal speedup!
  vAudio.onEchoArrival(actor, {perceivedPos: [9, 1.4, 6], kind: 'step', isDecoy: false}, 1.0, null, null);
  const rAudio = vAudio.evaluateSighting(actor, enemyMoving, 0.04, 1.15, null, -1, metrics);
  const rBase = vSilent.evaluateSighting(actor, enemyMoving, 0.04, 1.15, null, -1, null);
  assert(rAudio.progress > rBase.progress && metrics.humainCrossModalLocks >= 1, 'Aligned audio+visual cues must boost recognition super-additively');

  // Static crouched enemy at range without muzzle flash blends into background (camouflage realism!)
  const rCamo = vSilent.evaluateSighting(actor, enemyStillCrouched, 0.04, 2.0, null, -1, metrics);
  assert(rCamo.progress < rBase.progress && metrics.humainCamoDelays >= 1, 'Static crouched off-angle enemy must incur human figure-ground camo delay');
});

test('NV2.5-07 | HumainSensorimotorV25: 2-Stroke Mouse-Lift 180-deg Whip, Oculomotor Eye-Lead, Spray-Stop Overpull & Crosshair Intercept', () => {
  const aim = new HumainSensorimotorV25(random(2507), false, CALLSIGN_PROFILES_V25.SORA);
  const metrics = {humainMouseLifts: 0, humainRecoilOverpulls: 0, humainCrosshairIntercepts: 0, humanFlicks: 0, humanOvershoots: 0};

  // Large ~165 deg rear turn triggers authentic 2-stroke mouse-lift whip!
  const ok = aim.triggerBallisticFlick(0, 0, 2.90, 0, 1.0, 0.2, false, metrics, 14);
  assert(ok && aim.liftPending && metrics.humainMouseLifts === 1, 'Turn > 112 deg must trigger 2-stroke mouse-lift whip');

  const a = {id: 1, x: 0, y: 0, z: 10, yaw: 0, pitch: 0, vx: 0, vz: 0, gun: 'D1', onGround: true, crouch: 0};
  const tgt = {id: 4, x: 4, y: 0, z: 28, vx: 1.5, vz: 0, vy: 0, onGround: true, crouch: 0};
  const wpn = weapons['D1'];
  // Verify liftingMouse pauses firing during mousepad lift window
  let sawLiftPause = false;
  for (let i = 0; i < 60; i++) {
    const t = 1.0 + i * 0.008;
    const out = aim.step(a, 0.008, t, {seenTarget: tgt, wpn, fallbackYaw: 0, fallbackPitch: 0, metrics});
    if (out.liftingMouse) {
      sawLiftPause = true;
      assert.equal(out.readyToFire, false, 'Must not fire during mouse-lift re-centering');
    }
  }
  assert(sawLiftPause, '2-stroke 180-deg turn must enter mouse-lift pause phase');

  // Spray-stop recoil overpull after >=4-shot burst
  aim.shotsInBurst = 6;
  aim.lastShotAt = 5.0;
  aim.step(a, 0.016, 5.04, {seenTarget: tgt, wpn, fallbackYaw: 0, fallbackPitch: 0, metrics});
  aim.step(a, 0.016, 5.25, {seenTarget: tgt, wpn, fallbackYaw: 0, fallbackPitch: 0, metrics});
  assert(metrics.humainRecoilOverpulls >= 1, 'Stopping a >=4-shot spray must induce subtle human wrist overpull');
});

test('NV2.5-08 | HumainSocialMindV25 & HumainEmbodiedTacticsV25: 10-channel Comms (+BAIT_READY/SWING_NOW), Asymmetric Strafes & Player Push Mirroring', () => {
  for (const ch of ['CONTACT', 'SHIELD_BREAK', 'AMBUSH', 'RELOAD_COVER', 'TRADE_REQUEST', 'MAN_DOWN', 'FLANK_CLEAR', 'SMOKE_OUT', 'BAIT_READY', 'SWING_NOW']) {
    assert(COMMS_CHANNELS_V25[ch], `Channel ${ch} must exist in COMMS_CHANNELS_V25`);
  }
  const comms = new HumainSocialMindV25(random(2508));
  const metrics = {humanCallouts: 0, manusiaPlayerAssists: 0, humainAsymStrafes: 0};

  // Player pushing forward with ADS triggers delayed SWING_NOW so NAGI/KAI swing WITH player!
  const player = {id: 0, team: 0, human: true, alive: true, x: 0, z: 20, yaw: 0, vx: 0, vz: -4.2, hp: 92, reload: 0, aimPose: 0.7};
  const ally = {id: 1, team: 0, human: false, alive: true, x: 3, z: 22, hp: 100};
  assert.equal(comms.observeHumanPlayer(player, [player, ally], 3.0, metrics), true);
  assert.equal(comms.drainReady(0, 3.01).length, 0, 'SWING_NOW must never be 0ms telepathy');
  const ready = comms.drainReady(0, 3.60);
  assert(ready.some(c => c.kind === 'SWING_NOW' && c.extra?.isHumanPlayer), 'Delayed SWING_NOW must arrive for Team-0 player push');

  // Non-periodic asymmetric strafe choreography produces varied durations & double-taps
  const tac = new HumainEmbodiedTacticsV25(random(2508), CALLSIGN_PROFILES_V25.NAGI, false);
  const durs = new Set();
  let sign = 1;
  for (let i = 0; i < 20; i++) {
    const out = tac.nextAsymmetricStrafe(sign, {challengeBalance: 0.4}, false, metrics);
    sign = out.sign;
    durs.add(out.dur.toFixed(2));
  }
  assert(durs.size >= 8 && metrics.humainAsymStrafes >= 3, 'Asymmetric strafe choreography must vary rhythm non-periodically');
});

test('NV2.5-09 | Live 3v3 NV2.5 humain + NAGI Spy match activates core NV2.5 humain systems within 360Hz CPU budget', () => {
  const m = new Match({mode: '3v3', limit: 'points', multiplier: 2, loadout: 'SRA', allyNv21: 1});
  const t0 = performance.now();
  let ticks = 0;
  for (let i = 0; i < 360 * 110 && !m.ended; i++) {
    m.step(h, {});
    ticks++;
  }
  const msPerTick = (performance.now() - t0) / ticks;
  const nm = m.nv.metrics;
  assert(msPerTick < 1.0, `NV2.5 humain 360Hz CPU exceeded (${msPerTick.toFixed(4)} ms/tick)`);
  assert(nm.humainEpistemicScans > 0, `Active-Inference epistemic scans must fire (got ${nm.humainEpistemicScans})`);
  assert(nm.humainAsymStrafes > 0, `Asymmetric human strafes must fire (got ${nm.humainAsymStrafes})`);
  assert(nm.humainCrossModalLocks > 0, `Cross-modal audio-visual locks must fire (got ${nm.humainCrossModalLocks})`);
  assert(nm.humainBuddyGlances > 0, `Expressive social buddy glances must fire (got ${nm.humainBuddyGlances})`);
  assert(nm.humainPostKillChecks > 0, `Post-kill trade checks must fire (got ${nm.humainPostKillChecks})`);
  assert(nm.manusiaAnatomicalLeans > 0 && nm.manusiaCurvedTurns > 0, 'Inherited NV 2.4 Manusia locomotion & anatomical lean must remain active');
});
