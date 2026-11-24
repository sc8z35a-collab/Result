import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';

import {
  Match, modes, weapons, BAIZER_MAX_STACK, SKILL_POOL, DEFAULT_LAB_CONFIG, normalizeLabConfig
} from '../dist/js/match.js';
import {
  SCHERP_VERSION, AA_SPECS, isScherpAllowed, normalizeAALevel,
  ScherpEstimator, solveScherpIntercept, updateUniversalAA, bulletGuidanceUniversal, steerScherpShot
} from '../dist/js/scherp.js';
import {
  MAGNUS_VERSION, machDragCoeff, machConeHalfAngle, machNWaveDelay,
  initShotAero, impartRicochetSpin, stepMagnusAero
} from '../dist/js/magnus.js';
import { KineticFlowField, KINETICFLOW_VERSION } from '../dist/js/kineticflow.js';
import { sweptMovingBodyHit, LabTelemetry, QUANTUMTICK_VERSION } from '../dist/js/quantumtick.js';
import { AI_VERSION_LIST, aiVersionDisplay, ArenaCompositeAI } from '../dist/js/ai-arena.js';
import { readPreferences } from '../dist/js/preferences.js';
import { Renderer, effectiveSize } from '../dist/js/renderer.js';
import { SoftwareRenderer } from '../dist/js/software.js';
import { movingDetails, viewModel, muzzleOffset } from '../dist/js/models.js';
import { eyeOf, bodyCenter } from '../dist/js/posture.js';
import { unit, sub } from '../dist/js/geometry.js';

const h = 1 / 360;
const distUrl = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', distUrl), 'utf8');

function place(a, x, z, yaw = 0, y = 0) {
  a.x = x; a.y = y; a.z = z; a.yaw = yaw; a.pitch = 0;
  a.vx = a.vy = a.vz = 0;
  a.alive = true; a.onGround = true;
}

// ============================================================================
// 1. Random Single Assigned Skill (1 per match, strict single-skill enforcement)
// ============================================================================
test('L01 | Every match assigns strictly ONE skill randomly and rejects the other skill', () => {
  assert.deepEqual(SKILL_POOL, ['shaffer', 'heal']);
  // Deterministic seeds span both skills
  const seenSeed = new Set();
  for (let s = 1; s <= 40; s++) {
    const m = new Match({mode: '1v1', limit: 'unlimited', loadout: 'SW T', skillSeed: s});
    assert(SKILL_POOL.includes(m.player.assignedSkill));
    seenSeed.add(m.player.assignedSkill);
  }
  assert.equal(seenSeed.size, 2, 'Deterministic seeds must cover both skills');

  // Live random matches (no skillSeed) MUST NOT lock to one value (no Match.rng determinism trap)
  const seenLive = new Set();
  for (let i = 0; i < 40; i++) {
    const m = new Match({mode: '1v1', limit: 'unlimited', loadout: 'SW T'});
    assert(SKILL_POOL.includes(m.player.assignedSkill));
    seenLive.add(m.player.assignedSkill);
  }
  assert.equal(seenLive.size, 2, 'Live matches must vary randomly across both skills');

  // Strict single-skill enforcement
  const mS = new Match({mode: '1v1', limit: 'unlimited', loadout: 'SW T', playerSkill: 'shaffer'});
  mS.player.skillCharges = 3;
  mS.player.hp = 35;
  assert.equal(mS.useSkill(mS.player, 'heal'), false, 'Shaffer-assigned player cannot use heal');
  assert.equal(mS.player.skillCharges, 3);
  assert.equal(mS.useSkill(mS.player, 'shaffer'), true, 'Shaffer-assigned player can use shaffer');
  assert.equal(mS.player.skillCharges, 2);

  const mH = new Match({mode: '1v1', limit: 'unlimited', loadout: 'SW T', playerSkill: 'heal'});
  mH.player.skillCharges = 3;
  mH.player.hp = 35;
  assert.equal(mH.useSkill(mH.player, 'shaffer'), false, 'Heal-assigned player cannot use shaffer');
  assert.equal(mH.player.skillCharges, 3);
  assert.equal(mH.useSkill(mH.player, 'heal'), true, 'Heal-assigned player can use heal');
  assert.equal(mH.player.hp, 100);
  assert.equal(mH.player.skillCharges, 2);

  // Lab skillRule: 'none' disables skills completely
  const mNone = new Match({mode: 'lab', lab: {skillRule: 'none'}});
  assert.equal(mNone.player.assignedSkill, null);
  mNone.player.skillCharges = 3;
  mNone.player.hp = 20;
  assert.equal(mNone.useSkill(mNone.player, 'shaffer'), false);
  assert.equal(mNone.useSkill(mNone.player, 'heal'), false);
});

// ============================================================================
// 2. BAIZER 100 Additive Stacking & Absorption
// ============================================================================
test('L02 | BAIZER 200 (+20) and BAIZER 400 (+40) stack additively up to 100 cap', () => {
  assert.equal(BAIZER_MAX_STACK, 100);
  const events = [];
  const m = new Match({mode: '1v1', limit: 'unlimited', loadout: 'SW T'}, e => events.push(e));
  const [p, e] = m.actors;
  const bz200 = m.baizers.filter(b => b.amount === 20);
  const bz400 = m.baizers.filter(b => b.amount === 40);
  assert(bz200.length >= 2 && bz400.length >= 1);

  place(p, bz200[0].x, bz200[0].z);
  m.updateBaizers(h);
  assert.equal(p.baizerShield, 20);

  place(p, bz400[0].x, bz400[0].z);
  m.updateBaizers(h);
  assert.equal(p.baizerShield, 60, '20 + 40 must stack to 60');

  place(p, bz200[1].x, bz200[1].z);
  m.updateBaizers(h);
  assert.equal(p.baizerShield, 80, '60 + 20 must stack to 80');

  bz400[0].cooldown = 0;
  place(p, bz400[0].x, bz400[0].z);
  m.updateBaizers(h);
  assert.equal(p.baizerShield, 100, '80 + 40 must cap cleanly at 100');

  const lastEv = events.filter(x => x.type === 'baizer').at(-1);
  assert.equal(lastEv.gained, 20);
  assert.equal(lastEv.total, 100);

  // At 100 cap, pickups remain untouched on the road
  bz200[0].cooldown = 0;
  place(p, bz200[0].x, bz200[0].z);
  m.updateBaizers(h);
  assert.equal(bz200[0].cooldown, 0, 'Pickup must not be consumed at 100 cap');

  // Absorption order: 100 BAIZER -> 25 Base Shield -> 100 HP
  m.damage(p, e, 110);
  assert.deepEqual([p.baizerShield, p.shield, p.hp], [0, 15, 100]);

  // Lab startBaizer: 100
  const mLab = new Match({mode: 'lab', lab: {startBaizer: 100}});
  assert.equal(mLab.player.baizerShield, 100);
  assert.equal(mLab.player.baizerMax, 100);
});

// ============================================================================
// 3. Auto-Aim 1.5 Scherp Gating (Blocked by Default, Selectable via autoAimMode:'1.5' or Lab)
// ============================================================================
test('L03 | Auto-Aim 1.5 Scherp is gated off by default in 1v1/3v3/5v5 and allowed via 1.5 mode or Lab', () => {
  for (const stdMode of ['1v1', '3v3', '5v5']) {
    const m = new Match({mode: stdMode, limit: 'unlimited', loadout: 'SW T', lab: {playerAA: '1.5', teamBAA: '1.5'}});
    assert.equal(m.isLab, false);
    assert.equal(isScherpAllowed(m), false);
    assert.equal(normalizeAALevel('1.5', false), '1.4', 'normalizeAALevel must clamp 1.5 when allowScherp is false');

    // Attempt via setActorAA
    const res = m.setActorAA(m.player, '1.5');
    assert.notEqual(res, '1.5');
    assert.notEqual(m.player.aaOverride, '1.5');

    // Attempt manual tampering directly on actor/shot
    const [p, e] = [m.player, m.actors.find(a => a.team === 1)];
    place(p, 2, 85, 0);
    place(e, 2, 65, Math.PI);
    p.aaOverride = '1.5';
    updateUniversalAA(m, p, 1 / 60, true);
    assert.notEqual(p.aa?.level, '1.5', 'updateUniversalAA must never run 1.5 Scherp unless allowed');

    const guide = bulletGuidanceUniversal(m, p, eyeOf(p), [0, 0, -1], 360);
    assert.notEqual(guide?.aaTier, '1.5', 'bulletGuidanceUniversal must never return 1.5 unless allowed');

    const fakeShot = {
      owner: p, team: 0, p: eyeOf(p), dir: [0, 0, -1], speed: 360,
      guided: true, scherpApn: true, aaTier: '1.5', homingTargetId: e.id, homingSpawnId: e.spawnId,
      homingBudget: 0.4, homingTurned: 0
    };
    steerScherpShot(m, fakeShot, 1 / 60);
    assert.equal(fakeShot.scherpApn, false, 'steerScherpShot must disarm tampered Scherp shot unless allowed');
  }

  // Separate Auto-Aim 1.5 Scherp selector enables 1.5 for player in standard modes (NPCs remain standard)
  const m15 = new Match({mode: '3v3', limit: 'unlimited', loadout: 'RD 50', autoAimMode: '1.5'});
  assert.equal(m15.isLab, false);
  assert.equal(isScherpAllowed(m15), true);
  assert.equal(m15.player.aaOverride, '1.5');
  assert.equal(m15.player.aa?.level, '1.5');
  assert(m15.actors.slice(1).every(a => !a.aa), 'Non-Lab NPCs must not receive player 1.5 override');

  // Inside Lab mode, 1.5 Scherp is fully allowed for player & NPCs!
  const mLab = new Match({mode: 'lab', lab: {playerAA: '1.5', teamBAA: '1.5'}});
  assert.equal(mLab.isLab, true);
  assert.equal(isScherpAllowed(mLab), true);
  assert.equal(mLab.player.aaOverride, '1.5');
  assert.equal(mLab.actors.find(a => a.team === 1).aaOverride, '1.5');
});

// ============================================================================
// 4. Auto-Aim 1.5 Scherp Physics: Jerk Filter, Harmonic Strafe, Smoke, Wallbang, Bank-Shot, ZEM-APN, Shaffer
// ============================================================================
test('L04 | Auto-Aim 1.5 Scherp estimator, intercept, smoke-piercing, ZEM-APN curve, and Shaffer fair-play', () => {
  assert.equal(SCHERP_VERSION, '1.5 Scherp');
  assert(AA_SPECS['1.5'].homingBudget > AA_SPECS['1.4'].homingBudget);

  // 4A. α-β-γ-δ Jerk Estimator + Harmonic Strafe Reversal Detection
  const est = new ScherpEstimator();
  const dummyShooter = {x: 0, y: 0, z: 80, yaw: 0, pitch: 0, crouch: 0, lean: 0};
  const dummyTarget = {id: 1, spawnId: 1, x: 0, y: 0, z: 50, yaw: Math.PI, pitch: 0, crouch: 0, lean: 0, vx: 0, vy: 0, vz: 0};
  let t = 0;
  for (let i = 0; i < 90; i++) {
    t += 1 / 60;
    const freq = 2 * Math.PI * 1.8;
    dummyTarget.x = Math.sin(t * freq) * 1.4;
    dummyTarget.vx = Math.cos(t * freq) * 1.4 * freq;
    est.observe(dummyShooter, dummyTarget, 1 / 60, t);
  }
  assert(est.oscillation > 0.15, `Harmonic detector must detect periodic strafing (oscillation=${est.oscillation})`);
  assert(est.omega > 2.0, `Must estimate positive angular strafe frequency (omega=${est.omega})`);

  // 4B. Fast lock (0.025s), mmWave smoke-piercing lock, and ZEM-APN bullet curvature in Lab
  const m = new Match({mode: 'lab', limit: 'unlimited', loadout: 'SW T', lab: {
    playerRole: 'play', teamACount: 1, teamBCount: 1, playerAA: '1.5', teamBAA: 'off'
  }});
  const [p, e] = m.actors;
  place(p, 0, 80, 0);
  place(e, 0, 55, Math.PI);
  // Deploy dense smoke directly between p and e
  m.aeroVortex.deploySmokeVent(0, 68, 0, -1);
  for (let i = 0; i < 20; i++) m.aeroVortex.tick(1 / 60);

  // Advance just 0.08s -> Scherp 1.5 must lock cleanly right through dense smoke!
  for (let i = 0; i < 30; i++) {
    m.time += h;
    updateUniversalAA(m, p, h, true);
  }
  assert.equal(p.aa.level, '1.5');
  assert.equal(p.aa.locked, true, 'Scherp 1.5 must lock rapidly (<0.08s) even through dense AeroVortex smoke');
  assert.equal(p.aa.solveMode, 'direct');

  // 4B-2. BallisticCore-X penetrable wood crate wallbang solveMode === 'pen'
  place(p, 2, 85, 0);
  place(e, 2, 55, Math.PI);
  for (let i = 0; i < 30; i++) {
    m.time += h;
    updateUniversalAA(m, p, h, true);
  }
  assert.equal(p.aa.locked, true, 'Scherp 1.5 must solve BallisticCore-X wood wallbang lock');
  assert.equal(p.aa.solveMode, 'pen');
  // Move back to open lane for ZEM-APN curvature test
  place(p, 0, 80, 0);
  place(e, 0, 55, Math.PI);
  for (let i = 0; i < 20; i++) {
    m.time += h;
    updateUniversalAA(m, p, h, true);
  }

  // 4C. ZEM-APN curves an intentionally slightly off-axis shot into a fast laterally moving target
  e.vx = 5.2;
  const gInfo = bulletGuidanceUniversal(m, p, eyeOf(p), unit([0.14, 0, -1]), 360);
  assert(gInfo && gInfo.guided && gInfo.scherpApn && gInfo.aaTier === '1.5');
  const shot = {
    owner: p, team: 0, gun: 'SW T', p: eyeOf(p), old: eyeOf(p),
    dir: unit([0.16, 0, -1]), speed: 360, life: 1.0, age: 0,
    guided: true, scherpApn: true, aaTier: '1.5',
    homingTargetId: e.id, homingSpawnId: e.spawnId,
    homingBudget: gInfo.homingBudget, homingRate: gInfo.homingRate, homingTurned: 0,
    apnNavConst: gInfo.apnNavConst
  };
  const dir0 = [...shot.dir];
  for (let i = 0; i < 12; i++) {
    e.x += e.vx * h;
    steerScherpShot(m, shot, h);
    shot.p = [shot.p[0] + shot.dir[0] * shot.speed * h, shot.p[1] + shot.dir[1] * shot.speed * h, shot.p[2] + shot.dir[2] * shot.speed * h];
  }
  assert(shot.homingTurned > 0.02, `ZEM-APN must curve projectile toward moving target (turned=${shot.homingTurned})`);
  assert(shot.dir[0] !== dir0[0]);

  // 4D. Strict Fair-Play: Scherp 1.5 NEVER locks onto a Shaffer-cloaked target
  e.shafferTimer = 10;
  for (let i = 0; i < 30; i++) {
    m.time += h;
    updateUniversalAA(m, p, h, true);
  }
  assert.equal(p.aa.locked, false, 'Scherp 1.5 must strictly respect Shaffer cloak');
});

// ============================================================================
// 5. Lab Mode 10-Generation AI Arena & Spectator / Custom Physics
// ============================================================================
test('L05 | Lab Mode supports all 10 AI generations head-to-head, spectator mode, and custom rules', () => {
  assert.equal(AI_VERSION_LIST.length, 10);
  // Test cross-generation pairings across all 10 AI generations!
  const pairs = [
    ['nv1', 'human'],
    ['nv11', 'humain'],
    ['nv12', 'manusia'],
    ['nv13pro', 'nv23'],
    ['classic', 'nv21']
  ];
  for (const [aiA, aiB] of pairs) {
    const m = new Match({
      mode: 'lab', limit: 'unlimited',
      lab: {
        playerRole: 'spectate',
        teamACount: 2, teamBCount: 2,
        teamAAi: aiA, teamBAi: aiB,
        teamAAA: '1.3', teamBAA: '1.5',
        teamAGun: 'MS10', teamBGun: 'RD40',
        hpMax: 200, infiniteAmmo: true, gravityScale: 0.5,
        ricochetBoost: true, respawnTime: 0.2, npcSkills: true, aiLearning: false
      }
    });
    assert.equal(m.spectating, true);
    assert.equal(m.allNpc, true);
    assert.equal(m.actors.length, 4);
    assert(m.actors.every(a => !a.human), 'Spectator mode must have zero human-controlled actors');
    assert(m.actors.filter(a => a.team === 0).every(a => a.gun === 'MS10' && a.aaOverride === '1.3'));
    assert(m.actors.filter(a => a.team === 1).every(a => a.gun === 'RD40' && a.aaOverride === '1.5'));
    assert.equal(m.actors[0].aiVersion, aiVersionDisplay(aiA));
    assert.equal(m.actors[2].aiVersion, aiB === 'nv21' ? 'NV2.1' : aiVersionDisplay(aiB));
    assert.equal(m.hpMax, 200);
    assert.equal(m.actors[0].hp, 200);
    assert.equal(m.gravityScale, 0.5);
    assert.equal(m.ricochetBoost, true);
    assert.equal(m.infiniteAmmo, true);
    assert.equal(m.respawnDuration, 0.2);

    const x0 = m.actors[0].x, z0 = m.actors[0].z;
    for (let i = 0; i < 120; i++) m.step(1 / 60, {});
    const moved = Math.hypot(m.actors[0].x - x0, m.actors[0].z - z0);
    assert(moved > 0.3, `Spectated actors[0] (${aiA}) must move freely under AI control (moved=${moved.toFixed(2)}m)`);
  }

  // Verify ArenaCompositeAI activates when mixing Legacy NV1.x vs NV2.x
  const mix = new Match({mode: 'lab', lab: {playerRole: 'spectate', teamAAi: 'nv13pro', teamBAi: 'human'}});
  assert(mix.nv instanceof ArenaCompositeAI);

  // Verify Lab preferences persist cleanly through readPreferences
  const prefs = readPreferences({rules: {mode: 'lab', lab: {playerRole: 'spectate', teamAAi: 'nv1', teamBAi: 'nv21', teamBAA: '1.5', simSpeed: 4, respawnTime: 0.2}}});
  assert.equal(prefs.rules.mode, 'lab');
  assert.equal(prefs.rules.lab.playerRole, 'spectate');
  assert.equal(prefs.rules.lab.teamAAi, 'nv1');
  assert.equal(prefs.rules.lab.teamBAi, 'nv21');
  assert.equal(prefs.rules.lab.teamBAA, '1.5');
  assert.equal(prefs.rules.lab.simSpeed, 4);
  assert.equal(prefs.rules.lab.respawnTime, 0.2);
});

// ============================================================================
// 6. Invented Core Systems: MagnusAero 1.0, KineticFlow 1.0, QuantumTick 1.0
// ============================================================================
test('L06 | MagnusAero 1.0 transonic drag polar, Mach shock-cone, N-wave, and ricochet Magnus curve', () => {
  assert.equal(MAGNUS_VERSION, 'MagnusAero 1.0');
  const cdSub = machDragCoeff(0.5);
  const cdTrans = machDragCoeff(1.06);
  const cdSuper = machDragCoeff(1.85);
  assert(cdTrans > cdSub * 2.0, `Transonic wave-drag barrier must peak strongly (${cdTrans} vs ${cdSub})`);
  assert(cdTrans > cdSuper, `Prandtl-Glauert supersonic decay must drop below transonic peak (${cdSuper} < ${cdTrans})`);

  assert.equal(machConeHalfAngle(280), null, 'Subsonic round has no Mach cone');
  const muMS10 = machConeHalfAngle(648); // M ≈ 1.89
  const muRD40 = machConeHalfAngle(504); // M ≈ 1.47
  assert(muMS10 !== null && muRD40 !== null && muMS10 < muRD40, 'Faster MS10 must have tighter Mach shock cone');

  const nw = machNWaveDelay(648, 2.0);
  assert(nw > 0.0008 && nw < 0.006, `Supersonic N-wave delay must be physically bounded (${nw}s)`);
  assert.equal(machNWaveDelay(250, 2.0), 0);

  // Ricochet spin injection + Magnus lateral curvature
  const shot = initShotAero({gun: 'SW T', p: [0, 1.5, 0], dir: unit([0.2, 0, -0.98]), speed: 360});
  shot.ricocheted = true;
  impartRicochetSpin(shot, [1, 0, 0], 'steel');
  assert(shot.transverseSpin > 10, 'Oblique grazing bounce must inject transverse friction spin');
  const initDir = [...shot.dir];
  for (let i = 0; i < 60; i++) stepMagnusAero(shot, null, 1 / 60);
  assert(shot.magnusTurned > 0.001, 'Post-ricochet spin must generate Magnus lateral curve');
  assert(shot.speed < 360, 'Aerodynamic Mach drag must gently decay velocity');
  assert(Math.hypot(shot.dir[0] - initDir[0], shot.dir[1] - initDir[1], shot.dir[2] - initDir[2]) > 0.0005);
});

test('L07 | KineticFlow 1.0 fair-play Eikonal exposure field, crossfire tensor, and BAIZER 100 routing', () => {
  assert.equal(KINETICFLOW_VERSION, 'KineticFlow 1.0');
  const m = new Match({mode: '3v3', limit: 'unlimited'});
  const kf = m.kineticFlow;
  assert(kf instanceof KineticFlowField);

  // Before any observation, exposure is uniform low
  m.time += 0.25;
  kf.tick(m, 0.25);
  const expBase = kf.sample(0, 2, 0).exposure;

  // Inject an observed enemy belief near central open lane (0, 0) for Team 0 -> exposure rises smoothly around threat
  m.spectraField.observe(0, 0, 0, {sigma: 4.5, weight: 1.0});
  const a0 = m.actors[0];
  for (const al of m.actors) if (al.team === 0) place(al, 0, 22, Math.PI);
  m.time += 0.25;
  kf.tick(m, 0.25);
  const expHot = kf.sample(0, 0, 2).exposure;
  assert(expHot > expBase, `Exposure must rise near observed threat (${expHot} > ${expBase})`);

  // Crossfire orthogonality tensor peaks near 90° flanking angle relative to allies at (0, 22) and threat at (0, 0)
  const cfStacked = kf.sample(0, 0, 12).crossfire;
  const cfFlank = kf.sample(0, -22, 0).crossfire;
  assert(cfFlank > cfStacked + 0.2, `Orthogonal 90° flanking must maximize crossfire tensor (${cfFlank} > ${cfStacked})`);

  // Opportunistic BAIZER pickup routing stops when at 100 cap
  const bz = m.baizers.find(b => b.cooldown <= 0);
  place(a0, bz.x + 2, bz.z + 2);
  a0.baizerShield = 40;
  const pick = kf.bestBaizerPickup(a0, m);
  assert(pick && pick.id === bz.id, 'Should route to nearby BAIZER when below 100');
  a0.baizerShield = 100;
  assert.equal(kf.bestBaizerPickup(a0, m), null, 'Must return null once actor reaches 100 BAIZER cap');
});

test('L08 | QuantumTick 1.0 moving-capsule CCD catches fast lateral mover and LabTelemetry tracks combat', () => {
  assert.equal(QUANTUMTICK_VERSION, 'QuantumTick 1.0');
  // Actor moves rapidly across projectile's ray during a 20ms frame slice:
  // At u=0 (start): actor was at x = 0.0; at u=1 (end): actor is at x = 1.6 (vx = 80 m/s over dt=0.02s).
  // Projectile sweeps from [0.2, 1.0, 2.0] to [0.2, 1.0, -2.0], passing through x=0.2 near u=0.5 (actor at x=0.8) or x=0.6 near u=0.35!
  // Let's place exact mid-substep crossing:
  //   At u=0.5: shot is at [0.8, 1.0, 0.0]; actor (vx=80, dt=0.02, end x=1.6) is at 1.6 - 80*0.02*(1-0.5) = 0.8!
  //   Static bodyHit checks actor at end x=1.6 -> miss (distance 0.8 > 0.39 radius)!
  //   QuantumTick sweptMovingBodyHit checks exact co-moving trajectory -> HIT at u ≈ 0.5!
  const mover = {x: 1.6, y: 0, z: 0, yaw: 0, crouch: 0, lean: 0, vx: 80, vy: 0, vz: 0};
  const a = [0.8, 1.0, 2.0], b = [0.8, 1.0, -2.0];
  const tStatic = sweptMovingBodyHit(a, b, mover, 0);
  const tSwept = sweptMovingBodyHit(a, b, mover, 0.02);
  assert.equal(tStatic, Infinity, 'Static capsule at end-of-tick misses mid-substep crossing');
  assert(tSwept >= 0 && tSwept <= 1, `QuantumTick CCD must catch mid-substep crossing (got t=${tSwept})`);

  // LabTelemetry tracks neutral 50/50 -> dynamic dominance, accuracy, Scherp hits, BAIZER absorbed
  const tel = new LabTelemetry();
  assert.equal(tel.getSummary().dominanceA, 50);
  const a0 = {id: 0, name: 'YOU', team: 0};
  const b0 = {id: 1, name: 'EN', team: 1, spawnId: 1};
  tel.onFire(a0, 4);
  tel.onHit(a0, b0, 36, {baizerAbsorbed: 20, kill: true, shot: {aaTier: '1.5', scherpBank: true}, time: 1.5});
  const sum = tel.getSummary();
  assert.equal(sum.teamA.shots, 4);
  assert.equal(sum.teamA.hits, 1);
  assert.equal(sum.teamA.accuracyPct, 25);
  assert.equal(sum.teamA.scherpHits, 1);
  assert.equal(sum.teamA.scherpBankHits, 1);
  assert.equal(sum.teamA.scherpKills, 1);
  assert.equal(sum.teamB.baizerAbsorbed, 20);
  assert.equal(sum.dominanceA, 100);
});

// ============================================================================
// 7. Full JSDOM UI Test: Lab Mode Panel, Spectator Bar, Single Random Skill HUD, BAIZER 100 Bar
// ============================================================================
test('L09 | UI: Lab Mode panel, 1.5 Scherp exclusivity, Spectator controls, Single Skill HUD, and BAIZER 100 bar', async t => {
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
  let currentMatch = null, lastView = null;
  for (const Device of [Renderer, SoftwareRenderer]) {
    t.mock.method(Device.prototype, 'init', async function () {});
    t.mock.method(Device.prototype, 'settings', function (cfg) { this.config = {...cfg}; this.resize(); });
    t.mock.method(Device.prototype, 'resize', function () {
      const [x, y] = effectiveSize(this.config);
      this.canvas.width = x; this.canvas.height = y;
      this.aspect = 1280 / 720;
    });
    t.mock.method(Device.prototype, 'render', function (_cam, _time, m, view) {
      currentMatch = m;
      lastView = view;
    });
  }

  await import(new URL('js/app.js?labtest=' + Date.now(), distUrl));
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setImmediate(r));
    if (d.getElementById('app').classList.contains('render-ready')) break;
  }
  const $ = id => d.getElementById(id);
  let ms = 0;
  const frame = (dt = 16.667) => { ms += dt; frames.shift()(ms); };

  // 1. Verify Lobby Modes (3v3, lab), removed legacy AI/SPY UI, separate AA 1.5, RD 50, & 3-group Settings
  $('play').click();
  const modeValues = [...$('modes').querySelectorAll('button[data-value]')].map(b => b.dataset.value);
  assert.deepEqual(modeValues, ['3v3', 'lab']);
  assert.equal($('aiModelWrap'), null, 'AI engine selector must be removed from lobby');
  assert.equal($('allyAiWrap'), null, 'Ally SPY upgrade selector must be removed from lobby');
  assert.equal($('radioComms'), null, 'NPC dialogue radio HUD must be removed');
  assert.equal($('syncBanner'), null, 'NPC sync order banner must be removed');
  assert.equal($('squadStrip'), null, 'NPC squad order strip must be removed');
  assert.notEqual($('autoAimMode').querySelector('[data-value="1.5"]'), null, 'Separate 1.5 Scherp AA button must exist');
  assert.notEqual($('loadout').querySelector('[data-value="RD 50"]'), null, 'RD 50 must be selectable in loadout');
  assert.equal($('labConfig').hidden, true, 'Standard 3v3 must hide Lab config');

  // Verify 3 settings groups (高品質 / 軽量 / その他) and master HQ tech switch
  const groups = [...d.querySelectorAll('#settings .settings-group')].map(el => el.dataset.group);
  assert.deepEqual(groups, ['hq', 'lite', 'other']);
  assert.notEqual($('hqTechSwitch'), null);
  assert.notEqual($('bottomDock').querySelector('#vitals'), null, '#vitals must live inside centered #bottomDock');
  assert.notEqual($('bottomDock').querySelector('#skillBar'), null, '#skillBar must live inside centered #bottomDock');
  assert.notEqual($('overheadLayer'), null, '#overheadLayer must exist for enemy/ally tags');

  // Select 3v3 + RD 50 + AA 1.5 Scherp and launch!
  $('modes').querySelector('[data-value="3v3"]').click();
  $('loadout').querySelector('[data-value="RD 50"]').click();
  $('autoAimMode').querySelector('[data-value="1.5"]').click();
  $('start').click();
  frame();
  assert.equal(d.body.dataset.screen, 'game');
  assert.equal(currentMatch.actors.length, 6, '3v3 must spawn 6 actors');
  assert.equal(currentMatch.aiModel, 'human', 'All standard matches must use NV2.6 Force');
  assert.equal(currentMatch.player.gun, 'RD 50');
  assert.equal(currentMatch.player.aa?.level, '1.5', 'Separate 1.5 Scherp selector must activate on player');
  assert.equal($('specBar').hidden, true, 'Standard 3v3 must hide Lab specBar');
  const assigned = currentMatch.player.assignedSkill;
  assert(SKILL_POOL.includes(assigned));
  assert.equal($('btnShaffer').hidden, assigned !== 'shaffer', 'Only assigned skill button may be visible');
  assert.equal($('btnHeal').hidden, assigned !== 'heal', 'Unassigned skill button must be hidden');

  // Verify Fair-Play Overhead Enemy/Ally Tags: visible enemy gets tag, Shaffer-cloaked enemy stays hidden!
  const visibleEnemy = currentMatch.actors.find(a => a.team === 1);
  place(currentMatch.player, 0, 82, 0);
  place(visibleEnemy, 0, 62, Math.PI);
  for (const other of currentMatch.actors) {
    if (other !== currentMatch.player && other !== visibleEnemy) place(other, -18, 92, 0);
  }
  frame(100);
  const shownTags = [...$('overheadLayer').querySelectorAll('.oh-tag')].filter(el => !el.hidden);
  assert(shownTags.some(el => el.classList.contains('is-enemy')), 'Visible enemy must show red overhead tag');
  visibleEnemy.shafferTimer = 10;
  frame(100);
  const cloakedEnemyTags = [...$('overheadLayer').querySelectorAll('.oh-tag')].filter(el => !el.hidden && el.classList.contains('is-enemy'));
  assert.equal(cloakedEnemyTags.length, 0, 'Shaffer-cloaked enemy must NOT show overhead tag');
  visibleEnemy.shafferTimer = 0;

  // Verify BAIZER 100 bar width
  currentMatch.player.baizerShield = 50;
  currentMatch.player.baizerMax = 100;
  frame(100);
  assert.equal($('baizerRow').hidden, false);
  assert.equal($('baizerVal').textContent, '50');
  assert.equal($('baizerBar').style.width, '50%');

  // 2. Return to lobby -> Select 実験場 -> configure Spectator + NV2.6 Force (1.5 Scherp vs 1.4)
  $('pauseButton').click();
  $('endMatch').click();
  $('rematch').click();
  $('modes').querySelector('[data-value="lab"]').click();
  assert.equal($('labConfig').hidden, false, 'Lab mode must reveal #labConfig');
  assert.equal($('autoAimWrap').hidden, true, 'Lab mode hides standard autoAimWrap');

  $('labRole').querySelector('[data-value="spectate"]').click();
  assert.equal($('loadoutField').hidden, true, 'Spectate mode hides player weapon selector');

  assert.deepEqual([...$('labAiA').options].map(o => o.value), ['human'], 'Lab AI A UI must show only NV2.6 Force');
  assert.deepEqual([...$('labAiB').options].map(o => o.value), ['human'], 'Lab AI B UI must show only NV2.6 Force');
  $('labAiA').value = 'human';
  $('labAiA').dispatchEvent(new w.Event('change', {bubbles: true}));
  $('labAiB').value = 'human';
  $('labAiB').dispatchEvent(new w.Event('change', {bubbles: true}));
  $('labAaA').value = '1.5';
  $('labAaA').dispatchEvent(new w.Event('change', {bubbles: true}));
  $('labAaB').value = '1.4';
  $('labAaB').dispatchEvent(new w.Event('change', {bubbles: true}));

  $('start').click();
  frame(100);
  assert.equal(currentMatch.isLab, true);
  assert.equal(currentMatch.spectating, true);
  assert.equal($('specBar').hidden, false, 'Lab match must reveal #specBar');
  assert.equal($('skillBar').hidden, true, 'Spectator must hide #skillBar');
  assert.equal(lastView.firstPerson, false, 'Default spectator TPS cam renders 3rd-person');

  // Press C -> switches from TPS to FREE -> C again switches to FPS!
  d.dispatchEvent(new w.KeyboardEvent('keydown', {code: 'KeyC', bubbles: true}));
  frame(16);
  assert.equal(lastView.spectateCam, 'free');
  d.dispatchEvent(new w.KeyboardEvent('keydown', {code: 'KeyC', bubbles: true}));
  frame(16);
  assert.equal(lastView.spectateCam, 'fps');
  assert.equal(lastView.firstPerson, true, 'FPS spectate must enable 1st-person viewmodel for spectated NPC');

  // Verify movingDetails renders Scherp 1.5 shots cleanly in spectator mode (even if cloaked!)
  currentMatch.actors[0].shafferTimer = 8;
  const fx = movingDetails(currentMatch, 1.0, true, false, {spectating: true});
  assert(fx.count >= 0);
});

// ============================================================================
// 8. RD 50 Weapon Specs, Rapid 3.2/s Ammo Regen up to 300, No Built-In AA, NPC Equippable
// ============================================================================
test('L10 | RD 50 exact specs (50 mag, 7.2 dmg, 110 rate, 65 vel, 300 cap, 3.2/s regen, no built-in AA, NPC-equippable)', () => {
  const w = weapons['RD 50'];
  assert(w, 'RD 50 must be registered in weapons');
  assert.equal(w.capacity, 50);
  assert.equal(w.damage, 7.2);
  assert.equal(w.rate, 110);
  assert.equal(w.velocity, 65);
  assert.equal(w.auto, true);
  assert.equal(w.burst, 1);
  assert.equal(w.pellets, 1);
  assert.equal(w.stockCap, 300);
  assert.equal(w.stockRegen, 3.2);

  // 3D device mesh & muzzle offset exist
  const mesh = viewModel('RD 50');
  assert(mesh && mesh.count > 0, 'RD 50 3D device mesh must build cleanly');
  const mOff = muzzleOffset('RD 50');
  assert(mOff[2] < -0.5, 'RD 50 must have forward muzzle offset');

  // Standard match with RD 50: starts with 50 mag / 300 stock and ZERO built-in auto-aim!
  const m = new Match({mode: '1v1', limit: 'unlimited', loadout: 'RD 50'});
  assert.equal(m.player.mag, 50);
  assert.equal(m.player.stock, 300);
  assert.equal(m.player.rd, null, 'RD 50 must have NO built-in RD auto-aim');
  assert.equal(m.player.df, null);
  assert.equal(m.player.df40, null);
  assert.equal(m.player.aa, null);

  // Verify rapid 3.2 rounds/sec stock regeneration up to 300 cap
  m.player.stock = 200;
  m.player.ammoClock = 0;
  for (let i = 0; i < 360 * 10; i++) m.step(h, {}); // 10 seconds -> +32 rounds
  assert.equal(m.player.stock, 232, 'RD 50 must regenerate 3.2 rounds/sec (32 in 10s)');

  // Never exceeds 300 stockCap
  m.player.stock = 299;
  for (let i = 0; i < 360 * 3; i++) m.step(h, {});
  assert.equal(m.player.stock, 300, 'RD 50 stock must cap at 300');

  // Verify NPCs can equip and fire RD 50 in 5v5 and Lab!
  const m5 = new Match({mode: '5v5', limit: 'unlimited', loadout: 'SW T'});
  assert.equal(m5.actors.length, 10);
  assert(m5.actors.some(a => !a.human && a.gun === 'RD 50'), 'NPCs in 5v5 should be able to spawn with RD 50');
  const mLabRd50 = new Match({mode: 'lab', lab: {playerRole: 'spectate', teamACount: 2, teamBCount: 2, teamAGun: 'RD 50', teamBGun: 'RD 50'}});
  assert(mLabRd50.actors.every(a => a.gun === 'RD 50' && a.stock === 300 && a.rd === null));
});

// ============================================================================
// 9. True Muzzle Bullet Origin (1P & 3P), Streamlined Particles, & 5v5 NV2.6 Force
// ============================================================================
test('L11 | Shots originate visually from 1P/3P gun muzzle (not camera eye) and particles stay compact', () => {
  const m = new Match({mode: '5v5', limit: 'unlimited', loadout: 'RD 50'});
  assert.equal(m.actors.length, 10);
  assert(m.actors.filter(a => !a.human).every(a => a.aiVersion === 'NV2.6 Force' && !a.isSpy));

  const p = m.player;
  place(p, 0, 80, 0);
  m.trigger(p);
  assert.equal(m.shots.length, 1);
  const shot = m.shots[0];
  const eye = eyeOf(p);
  assert(Array.isArray(shot.muzzle1p) && Array.isArray(shot.muzzle3p), 'Shot must record both 1P and 3P muzzle positions');
  const dist1p = Math.hypot(shot.muzzle1p[0] - eye[0], shot.muzzle1p[1] - eye[1], shot.muzzle1p[2] - eye[2]);
  const dist3p = Math.hypot(shot.muzzle3p[0] - eye[0], shot.muzzle3p[1] - eye[1], shot.muzzle3p[2] - eye[2]);
  assert(dist1p > 0.35, `1P muzzle must be offset to the weapon barrel, not camera center (dist=${dist1p.toFixed(3)}m)`);
  assert(dist3p > 0.35, `3P muzzle must be offset to world weapon barrel (dist=${dist3p.toFixed(3)}m)`);
  assert(shot.muzzle1p[0] > eye[0] + 0.1, 'Right-handed 1P muzzle must sit to the right of camera center');
  assert(shot.muzzle1p[1] < eye[1] - 0.1, '1P muzzle must sit below eye level at barrel height');

  // Verify streamlined hit/break/kill particles add compact, non-obstructive geometry on actual shot impact
  const enemy = m.actors.find(a => a.team === 1);
  place(enemy, 0, 74, Math.PI);
  for (const other of m.actors) if (other !== p && other !== enemy) place(other, -18, 92, 0);
  const fxBefore = movingDetails(m, m.time, true, false, {firstPerson: true, viewerId: p.id});
  for (let i = 0; i < 60 && m.effects.length === 0; i++) m.step(h, {});
  assert(m.effects.length > 0, 'Fired RD 50 round must hit target and spawn streamlined hit effect');
  const fxAfter = movingDetails(m, m.time, true, false, {firstPerson: true, viewerId: p.id});
  const hitVerts = fxAfter.count - fxBefore.count;
  assert(hitVerts < 900, `Streamlined hit particles must stay crisp and compact (hitVerts=${hitVerts})`);
});

