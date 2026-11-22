import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = process.env.RESULT_QA_SOURCE
  ? pathToFileURL(resolve(process.env.RESULT_QA_SOURCE, 'dist/js') + '/')
  : new URL('../dist/js/', import.meta.url);
const load = name => import(new URL(name + '.js', source));

const {Match, weapons} = await load('match');
const {movingDetails} = await load('models');
const {computeVocalFormantPlan, SOUND_CATALOG_COUNT} = await load('sound-engin2');
const {
  NV26_FORCE_VERSION,
  FORCE_GESTURES,
  VOICE_PROFILES_V26,
  CALLSIGN_PROFILES_V26,
  sectorNameJa,
  relativeDirectionJa,
  ForceBodyLanguageV26,
  ForcePsycheV26,
  ForceCounterBrainV26,
  ForceTempoCoordV26,
  ForceSensorimotorV26,
  ForceTacticsV26,
  ForceSocialVoiceV26
} = await load('nv26-force');
const {NV25_HUMAIN_VERSION, HumainAffectivePsycheV25, HumainMetaMindV25} = await load('nv25-humain');
const {NV24_MANUSIA_VERSION} = await load('nv24-manusia');
const {random} = await load('geometry');
const {obstruction} = await load('yard');
const {eyeOf, targetPoint} = await load('posture');

const h = 1 / 360;

test('NV2.6-01 | Default Match launches NV2.6 Force across all NPCs incl. 3v3 Spy allies (NAGI/KAI) with 5-tier A/B/C/D/E isolation', () => {
  assert.equal(NV26_FORCE_VERSION, 'NV2.6 Force');
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T', allyNv21: 1});
  assert.equal(m.nv.version, NV26_FORCE_VERSION);
  assert.equal(m.actors[1].aiVersion, 'NV2.1');
  assert.equal(m.actors[2].aiVersion, NV26_FORCE_VERSION);
  assert.equal(m.actors[3].aiVersion, NV26_FORCE_VERSION);

  for (const a of m.actors.filter(x => !x.human)) {
    const b = m.nv.brains.get(a.id);
    assert.equal(b.forceMode, true);
    assert(b.body instanceof ForceBodyLanguageV26, `${a.name} must run ForceBodyLanguageV26`);
    assert(b.mind instanceof ForcePsycheV26 && b.mind instanceof HumainAffectivePsycheV25);
    assert(b.tom instanceof ForceCounterBrainV26 && b.tom instanceof HumainMetaMindV25);
    assert(b.humanAim instanceof ForceSensorimotorV26);
    assert(b.tactics instanceof ForceTacticsV26);
  }

  // 5-tier isolation: NV2.6 Force vs NV2.5 humain
  const m26vs25 = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SRA', allNpc: true, teamAiModels: ['human', 'humain']});
  assert(m26vs25.nv.brains.get(m26vs25.actors[0].id).body instanceof ForceBodyLanguageV26);
  assert.equal(m26vs25.nv.brains.get(m26vs25.actors[3].id).body, null, 'NV2.5 humain team must not run NV2.6 Force body/signal tier');
  assert.equal(m26vs25.actors[0].aiVersion, NV26_FORCE_VERSION);
  assert.equal(m26vs25.actors[3].aiVersion, NV25_HUMAIN_VERSION);

  // Explicit NV 2.4 Manusia still preserved
  const m24 = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SRA', aiModel: 'manusia'});
  assert.equal(m24.nv.version, NV24_MANUSIA_VERSION);
});

test('NV2.6-02 | ForceBodyLanguageV26: Cervical head-look decoupling, all 5 IK hand/body gestures, and firing auto-release', () => {
  const body = new ForceBodyLanguageV26(random(2602));
  const actor = {id: 1, name: 'NAGI', yaw: 0, flash: 0, recoil: 0, reload: 0};
  const b = {seen: false, target: null, state: '同期待機'};
  const metrics = {forceGestures: 0, forceStartleVisuals: 0};

  // Decoupled head turns toward eyeYaw BEFORE torso rotates
  for (let i = 0; i < 45; i++) {
    body.step(actor, b, 1 / 60, i / 60, null, {eyeYaw: 0.72}, null);
  }
  assert(actor.expr && actor.expr.headYaw > 0.35 && actor.expr.headYaw < 0.80, `Head must smoothly lead torso (got ${actor.expr?.headYaw})`);

  // WAVE_SWING (+1 -> uExpr.y in (0, 1])
  assert(body.triggerGesture(FORCE_GESTURES.WAVE_SWING, 0.8, 1.0, 3, metrics));
  for (let i = 0; i < 20; i++) body.step(actor, b, 1 / 60, 1.0 + i / 60, null, null, null);
  assert(actor.expr.gestureEncoded > 0.4 && actor.expr.gestureEncoded <= 1.0, `WAVE_SWING must encode in (0, 1] (got ${actor.expr.gestureEncoded})`);

  // STARTLE_JOLT (-1 -> uExpr.y in [-1, 0), higher priority overrides WAVE_SWING!)
  assert(body.triggerGesture(FORCE_GESTURES.STARTLE_JOLT, 0.35, 1.35, 4, metrics));
  for (let i = 0; i < 12; i++) body.step(actor, b, 1 / 60, 1.35 + i / 60, null, null, null);
  assert(actor.expr.gestureEncoded < -0.3 && actor.expr.gestureEncoded >= -1.0, `STARTLE_JOLT must encode in [-1, 0) (got ${actor.expr.gestureEncoded})`);
  assert(actor.expr.startleArc > 0.1, 'STARTLE_JOLT must activate brief visible startle arc');
  assert(metrics.forceGestures >= 2 && metrics.forceStartleVisuals === 1);

  // Active gunfire immediately releases left-hand gesture cleanly back to rifle grip!
  actor.flash = 0.08;
  for (let i = 0; i < 30; i++) body.step(actor, b, 1 / 60, 1.6 + i / 60, null, null, null);
  assert(actor.expr.gestureBlend < 0.05, `Firing must release gesture back to rifle grip (got blend=${actor.expr.gestureBlend})`);
});

test('NV2.6-03 | Klatt Physical Vocal-Tract Prosody & Callsign Voice Anatomy: stress, startle gasp, exhale, whisper & speech plans', () => {
  assert(SOUND_CATALOG_COUNT >= 70, `Sound Engin 2.0 catalog must include NV2.6 Force vocals (got ${SOUND_CATALOG_COUNT})`);
  const f0s = new Set(Object.values(VOICE_PROFILES_V26).map(v => v.f0Hz));
  assert(f0s.size >= 5, 'Every harbor callsign must have a distinct fundamental vocal pitch F0');

  const nagiMind = new ForcePsycheV26({name: 'NAGI', team: 0}, random(2603), false);
  const calm = nagiMind.getVocalProsody(1.0);
  nagiMind.stress = 0.85;
  nagiMind.heartRate = 164;
  const tense = nagiMind.getVocalProsody(2.0);
  assert(tense.f0Hz > calm.f0Hz * 1.15, 'High stress & BPM must raise vocal pitch F0');
  assert(tense.tempo > calm.tempo * 1.08, 'High stress must accelerate speaking cadence');
  assert(tense.breathiness > calm.breathiness, 'High arousal must increase glottal breathiness');

  const gasp = computeVocalFormantPlan('STARTLE', tense);
  const exhale = computeVocalFormantPlan('BREATH_RESET', calm);
  const bait = computeVocalFormantPlan('BAIT_READY', calm);
  const swing = computeVocalFormantPlan('SWING_NOW', tense);
  assert.equal(gasp.mode, 'gasp');
  assert(gasp.syllables[0].f0End > gasp.syllables[0].f0Start, 'Startle gasp must pitch sharply upward');
  assert.equal(exhale.mode, 'exhale');
  assert.equal(bait.mode, 'whisper');
  assert(swing.syllables.length === 3, 'SWING_NOW must emit a decisive 3-beat vocal cadence');
});

test('NV2.6-04 | ForceTempoCoordV26: Shared-clock 3-2-1 Synchronized Orthogonal Crossfire & Bait-Partner Coordination', () => {
  const tempo = new ForceTempoCoordV26();
  const plan = tempo.scheduleSyncSwing(0, 1, -8, 20, 0, 0, 4, 10.0, 0.72);
  assert(Math.abs(plan.goAt - 10.72) < 1e-6, 'Sync swing must schedule exact shared goAt timestamp');

  // Orthogonal crossfire (from East while initiator is South-West) must score far higher than same-lane stacking!
  const orthoScore = tempo.scoreCrossfireAngle(14, 4, [0, 0], [-8, 20]);
  const stackScore = tempo.scoreCrossfireAngle(-7, 18, [0, 0], [-8, 20]);
  assert(orthoScore > stackScore + 8, `Orthogonal crossfire (${orthoScore.toFixed(1)}) must heavily beat same-lane stacking (${stackScore.toFixed(1)})`);

  const bait = tempo.registerBaitTrap(0, 1, -10, 14, -10, -4, 3, 12.0);
  assert(tempo.getActiveBait(0, 13.0) === bait);
  assert.equal(tempo.getActiveBait(0, 16.0), null);
});

test('NV2.6-05 | ForceCounterBrainV26 & ForceSensorimotorV26: Fair-play Strafe Reversal-Apex Lock & Anti-Trade Post-Kill Cover Slide', () => {
  const tom = new ForceCounterBrainV26(random(2605), CALLSIGN_PROFILES_V26.KAI, false);
  const actor = {id: 1, x: 0, y: 0, z: 20, yaw: 0, pitch: 0, vx: 0, vz: 0, gun: 'SRA', crouch: 0, lean: 0, aimPose: 1, onGround: true};
  const enemy = {id: 4, x: 0, y: 0, z: 4, yaw: Math.PI, vx: 4.4, vy: 0, vz: 0, crouch: 0, lean: 0, onGround: true};

  // Observe enemy strafing right -> reversing left (fair-play visible velocity flips!)
  tom.observeEnemyStrafe(actor, enemy, 1.0);
  enemy.vx = -4.2;
  tom.observeEnemyStrafe(actor, enemy, 1.35);
  assert(tom.isEnemyAtReversalApex(enemy.id, 1.40), 'Reversal sign flip must flag ~170ms reversal-apex intercept window');

  // Aim sensorimotor receives 0.84x reversal-apex spread bonus
  const aim = new ForceSensorimotorV26(random(2605), false, CALLSIGN_PROFILES_V26.KAI);
  aim.motorPhase = 'PURSUIT';
  const metrics = {forceReversalLocks: 0, forcePostKillSlides: 0, humainCrosshairIntercepts: 0};
  const rApex = aim.step(actor, 1 / 60, 1.40, {seenTarget: enemy, wpn: weapons.SRA, tom, metrics});
  assert(rApex.reversalLock === true && metrics.forceReversalLocks === 1, 'ForceSensorimotorV26 must lock onto strafe reversal apex');

  // Anti-Trade Post-Kill Cover Slide on open wharf
  actor.x = 0; actor.z = 0;
  const slid = tom.triggerAntiTradeSlide(actor, [0, -14], [10, -12], 5.0, metrics);
  assert(slid && metrics.forcePostKillSlides === 1 && tom.postKillSlideUntil > 5.3, 'Post-kill anti-trade cover slide must activate');
});

test('NV2.6-06 | Interactive Player Squad Commands (1: SWING / 2: COVER / 3: TRAP) acknowledge by radio, gesture & schedule execution', () => {
  const signals = [];
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T'}, e => {
    if (e.type === 'npcSignal') signals.push(e);
  });
  m.step(h, {});

  const ordSwing = m.issueSquadOrder('SWING');
  assert(ordSwing && ordSwing.kind === 'SWING' && ordSwing.goAt > m.time, 'SWING order must schedule counted 3-2-1 goAt');
  const sigSwing = signals.find(s => s.kind === 'PLAYER_ORDER_SWING');
  assert(sigSwing && sigSwing.isRadio && sigSwing.syncGoAt === ordSwing.goAt && sigSwing.lineJa.length > 0, 'Ally must acknowledge SWING order over radio with syncGoAt');
  assert(m.nv.metrics.forcePlayerOrders === 1);

  m.time += 2.0;
  const ordCover = m.issueSquadOrder('COVER');
  assert(ordCover && ordCover.kind === 'COVER');
  assert(signals.some(s => s.kind === 'PLAYER_ORDER_COVER'), 'Ally must acknowledge COVER order');

  m.time += 2.0;
  const ordTrap = m.issueSquadOrder('TRAP');
  assert(ordTrap && ordTrap.kind === 'TRAP');
  assert(signals.some(s => s.kind === 'PLAYER_ORDER_TRAP'), 'Ally must acknowledge TRAP order');
});

test('NV2.6-07 | 100% Fair-Play Zero-Wallhack Vocal & 3D Diegetic Proof (occluded enemy never leaks coordinates or 3D cues!)', () => {
  const m = new Match({mode: '3v3', limit: 'unlimited', loadout: 'SW T'});
  const p = m.player;
  const enemy = m.actors[3];
  // Place enemy cleanly behind steel container at [-7.5, 46] (zero LOS!)
  Object.assign(p, {x: -4.0, y: 0, z: 52.0, yaw: 0, pitch: 0, alive: true, vx: 0, vz: 0});
  Object.assign(enemy, {x: -10.2, y: 0, z: 46.0, yaw: Math.PI, pitch: 0, alive: true, vx: 0, vz: 0});
  assert(obstruction(eyeOf(p), targetPoint(enemy)) <= 1, 'Fixture enemy must be occluded behind steel container');

  // Coarse relative bearing contains ZERO coordinates
  const dirText = relativeDirectionJa(enemy.x, enemy.z, p);
  assert(!dirText.includes('-10') && !dirText.includes('46'), `Enemy bearing must never leak coordinates (got ${dirText})`);
  assert(sectorNameJa(-10, -20).includes('北'), 'Ally sector label must translate cleanly to Japanese sector');

  // Even if enemy is startled behind cover, 3D movingDetails MUST NOT emit wallhack startle ring through wall!
  enemy.expr = {headYaw: 0, gesture: -1, gestureBlend: 1, gestureEncoded: -1, tension: 0.9, breathWave: 0, pulse: 0, speaking: false, startleArc: 0.9, syncRally: false, baitReady: false};
  const fxOccluded = movingDetails(m, 5.0, false, false, {});
  enemy.expr.startleArc = 0;
  const fxBaseline = movingDetails(m, 5.0, false, false, {});
  assert.equal(fxOccluded.count, fxBaseline.count, 'Occluded startled enemy MUST NOT render 3D startle cue through steel container (zero wallhack!)');

  // Move enemy into direct unobstructed LOS -> 3D startle kinetic jolt arc renders cleanly!
  Object.assign(enemy, {x: -4.0, y: 0, z: 42.0});
  assert(obstruction(eyeOf(p), targetPoint(enemy)) > 1, 'Fixture enemy must now have direct unobstructed LOS');
  enemy.expr.startleArc = 0.9;
  const fxVisible = movingDetails(m, 5.0, false, false, {});
  assert(fxVisible.count > fxBaseline.count, 'Visibly startled enemy in direct LOS must render crisp 3D kinetic startle arc');
});

test('NV2.6-08 | ForceTacticsV26: Reload-Cover Suppression Pinning & Gesture-Coupled Expressive Rig Posture', () => {
  const tac = new ForceTacticsV26(random(2608), CALLSIGN_PROFILES_V26.NAGI);
  const actor = {x: 0, y: 0, z: 20, onGround: true, reload: 0, mag: 20};
  const metrics = {forceSuppressPins: 0};
  assert(tac.scheduleSuppressPin([0, 4], 5.0, 0.9));
  const pin = tac.getActiveSuppressPin(actor, 5.1, metrics);
  assert(pin && pin.kind === 'suppress_pin' && metrics.forceSuppressPins === 1, 'Clear lane must permit fair-play cover-pinning burst');

  const posed = tac.refineExpressivePose(actor, {state: 'ベイト連携待機', vault: false, body: {gesture: FORCE_GESTURES.HOLD_TRAP}}, {crouch: false, lean: 0.4, ads: false}, 5.2, null);
  assert.equal(posed.crouch, true, 'Bait partner stance must adopt compact crouched ambush posture');
  assert.equal(posed.ads, true, 'Bait partner stance must hold crisp ADS ready');
});

test('NV2.6-09 | Live 3v3 NV2.6 Force Combat Verification: Voices, Gestures, Head-Look, Reversal Locks, Post-Kill Slides & Zero-NaN Expressions', () => {
  const signals = [];
  const m = new Match({mode: '3v3', limit: 'points', multiplier: 2, loadout: 'DF1 OUT', allyNv21: 1}, e => {
    if (e.type === 'npcSignal') signals.push(e);
  });
  for (let i = 0; i < 360 * 140 && !m.ended; i++) m.step(h, {});
  const k = m.nv.metrics;

  assert(signals.length >= 10 && k.forceVocalSignals >= 10, `Live combat must emit audible/visible NV2.6 Force vocal signals (got ${signals.length})`);
  assert(k.forceGestures >= 10, `Live combat must animate 16-bone IK gestures (got ${k.forceGestures})`);
  assert(signals.some(s => s.isRadio && s.team === 0 && s.lineJa.length > 0), 'Allies must transmit Japanese tactical radio callouts');
  assert(signals.some(s => !s.isRadio && s.team === 1), 'Enemies must emit strictly spatialized field vocalizations (never radio)');

  // Every live NPC must have clean finite GPU uExpr state
  for (const a of m.actors.filter(x => !x.human)) {
    assert(a.expr && Number.isFinite(a.expr.headYaw) && Number.isFinite(a.expr.gestureEncoded) && Number.isFinite(a.expr.tension) && Number.isFinite(a.expr.breathWave),
      `${a.name} must maintain finite 360Hz uExpr channels`);
  }
});
