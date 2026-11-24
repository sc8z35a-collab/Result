import {clamp, forward, dot, sub, add, scale, random, cross, unit} from './geometry.js';
import {teams, tankers, baizerPickups, walkable, moveActor, floorAt, obstruction, raycastMaterialOut, WATER_HEIGHT} from './yard.js';
import {eyeOf, torso, bodyCenter, targetPoint, postureStep, vertical} from './posture.js';
import {DF, initialDF, scheduleDF, bulletGuidanceDF, steerGuidedShot, spendP1, updateDF} from './df1.js';
import {RD, RD20, RD30, isRDWeapon, initialRD, updateRD, bulletGuidanceRD} from './rd40.js';
import {DF40II, initialDF40II, updateDF40II, bulletGuidanceDF40II, onFireDF40II, toggleAA14} from './df40ii.js';
import {solveBallisticImpact} from './ballistics.js';
import {EchoPulseField} from './echopulse.js';
import {SynapseProfiler} from './synapse.js';
import {AeroVortex} from './aerovortex.js';
import {ThermoFlux} from './thermoflux.js';
import {SpectraField} from './spectrafield.js';
import {ResonanceCore} from './resonance.js';
import {ChronoTrace} from './chronotrace.js';
import {FermatCore} from './fermat.js';
import {
  SCHERP_VERSION, AA_SPECS, isScherpAllowed, normalizeAALevel,
  initialUniversalAA, updateUniversalAA, bulletGuidanceUniversal, steerScherpShot
} from './scherp.js';
import {initShotAero, stepMagnusAero, impartRicochetSpin, machNWaveDelay} from './magnus.js';
import {KineticFlowField} from './kineticflow.js';
import {sweptMovingBodyHit, LabTelemetry} from './quantumtick.js';
import {createMatchAI, normalizeAiModelId, aiVersionDisplay} from './ai-arena.js';
import {muzzleOffset} from './models.js';

const baseSpeed = 360, baseInterval = .24;
export const BASE_SHIELD_MAX = 25;
export const BAIZER_MAX_STACK = 200;
export const AMMO_BOX_AMOUNT = 50;
export const AMMO_BOX_COUNT = 8;
export const AMMO_BOX_RESPAWN = 22;
export const REINFORCE_MAX_USES = 4;
export const REINFORCE_COUNT = 7;
export const REINFORCE_HP = 200;
export const REINFORCE_SHIELD = 0;
export const MAX_SKILL_CHARGES = 3;
export const KILLS_PER_SKILL_CHARGE = 5;
export const SHAFFER_DURATION = 12.0;
export const FLOW_DURATION = 6.0;
export const FLOW_WORLD_SCALE = 0.4;
export const STUN_LAUNCHER = 'STUN LAUNCHER';
export const STUN_LAUNCHER_AMMO = 15;
export const STUN_LAUNCHER_DAMAGE = 10;
export const STUN_LAUNCHER_SPLASH_DAMAGE = 5;
export const STUN_LAUNCHER_SPLASH_RADIUS = 2.0;
export const STUN_LAUNCHER_RATE = 60;
export const STUN_LAUNCHER_VELOCITY = 30;
export const ZOMBIE_SPAWN_POINT = [0, -84];
export const ZOMBIE_SPAWN_RATE = 4;
export const ZOMBIE_HP = 40;
export const ZOMBIE_SPEED = 5.35;
export const ZOMBIE_MELEE_DAMAGE = 18;
export const ZOMBIE_MELEE_RANGE = 1.65;
export const ZOMBIE_MELEE_COOLDOWN = 0.75;
export const ZOMBIE_MAX_ALIVE = 60;
export const GAS_PIPE_COUNT = 6;
export const GAS_PIPE_HP = 30;
export const GAS_PIPE_RADIUS = 5.0;
export const GAS_PIPE_DAMAGE = 25;
export const GAS_PIPE_RESPAWN = 30;
export const DF40II_SCATTER_PELLETS = 12;
export const DF40II_SCATTER_DAMAGE = 1.2;
export const JUDGMENT_DURATION = 18.0;
export const JUDGMENT_MECH_HP = 500;
export const JUDGMENT_MECH_SHIELD = 150;
export const JUDGMENT_DAMAGE_MULT = 3.0;
export const JUDGMENT_RATE_MULT = 0.65;
export const MECH_TYPES = {
  titan: {id: 'titan', code: 'TITAN-01', name: 'タイタン・重装審判機', hp: 620, shield: 200, damageMult: 2.8, rateMult: 0.72, speedMult: 0.88, primary: [0.86, 0.22, 0.16], glow: [1.0, 0.48, 0.18], armor: [0.22, 0.14, 0.14]},
  valkyrie: {id: 'valkyrie', code: 'VALKYRIE-02', name: 'ヴァルキリー・蒼穹強襲機', hp: 440, shield: 180, damageMult: 2.5, rateMult: 0.50, speedMult: 1.28, primary: [0.16, 0.58, 0.95], glow: [0.36, 0.94, 1.0], armor: [0.14, 0.22, 0.30]},
  cerberus: {id: 'cerberus', code: 'CERBERUS-03', name: 'ケルベロス・煉獄殲滅機', hp: 520, shield: 140, damageMult: 3.2, rateMult: 0.62, speedMult: 1.00, extraPellets: 2, primary: [0.95, 0.42, 0.12], glow: [1.0, 0.74, 0.20], armor: [0.18, 0.14, 0.12]},
  aegis: {id: 'aegis', code: 'AEGIS-04', name: 'イージス・鉄壁要塞機', hp: 580, shield: 320, damageMult: 2.4, rateMult: 0.70, speedMult: 0.84, primary: [0.18, 0.76, 0.52], glow: [0.38, 1.0, 0.78], armor: [0.18, 0.26, 0.24]},
  phantom: {id: 'phantom', code: 'PHANTOM-05', name: 'ファントム・幽鬼隠密機', hp: 400, shield: 160, damageMult: 3.8, rateMult: 0.58, speedMult: 1.22, primary: [0.58, 0.24, 0.92], glow: [0.84, 0.46, 1.0], armor: [0.16, 0.12, 0.24]},
  apocalypse: {id: 'apocalypse', code: 'APOCALYPSE-06', name: 'アポカリプス・終末裁定機', hp: 700, shield: 220, damageMult: 3.6, rateMult: 0.68, speedMult: 0.94, splash: true, primary: [0.94, 0.92, 0.88], glow: [1.0, 0.22, 0.28], armor: [0.28, 0.16, 0.18]}
};
export const MECH_TYPE_LIST = Object.keys(MECH_TYPES);
export const WEATHERS = {
  clear: {id: 'clear', label: '晴れ', visibilityDrop: 0.0, visibility: 1.0, fogScale: 1.0, stormDark: 0.0, disasterTint: 0.0, ballisticWarp: 0.0, windBase: 0.0, squadFracture: false},
  rain: {id: 'rain', label: '雨', visibilityDrop: 0.40, visibility: 0.60, fogScale: 3.1, stormDark: 0.36, disasterTint: 0.0, ballisticWarp: 0.0, windBase: 2.2, squadFracture: false},
  storm: {id: 'storm', label: '嵐', visibilityDrop: 0.60, visibility: 0.40, fogScale: 5.4, stormDark: 0.58, disasterTint: 0.12, ballisticWarp: 0.48, windBase: 6.5, squadFracture: false},
  disaster: {id: 'disaster', label: '超災害', visibilityDrop: 0.85, visibility: 0.15, fogScale: 9.8, stormDark: 0.78, disasterTint: 0.86, ballisticWarp: 1.75, windBase: 14.5, squadFracture: true}
};
export const WEATHER_LIST = Object.keys(WEATHERS);
export const DRONE_AMMO_COST = 100;
export const DRONE_HP = 50;
export const DRONE_SHIELD = 0;
export const DRONE_RANGE = 10.0;
export const DRONE_FIRE_RATE = 2;
export const DRONE_FIRE_INTERVAL = 1 / DRONE_FIRE_RATE;
export const DRONE_SHOT_VELOCITY = 60;
export const DRONE_SHOT_SPEED = baseSpeed * 0.6;
export const DRONE_SHOT_DAMAGE = 3;
export const DRONE_BARRELS = 2;
export const RAID_5M_TIME = 300;
export const RAID_5M_COUNT = 5;
export const RAID_5M_HP = 80;
export const RAID_5M_GUN = RD30;
export const RAID_10M_TIME = 600;
export const RAID_10M_COUNT = 40;
export const RAID_10M_HP = 50;
export const RAID_20M_TIME = 1200;
export const RAID_20M_COUNT = 30;
export const RAID_20M_HP = 50;
export const RAID_CONTAINER_DOOR = [9.8, -8.0];
export const RAID_CONTAINER_DOORS = [[9.8, -8.0], [-0.5, 8.0], [8.9, 18.0], [-12.9, -10.0], [-4.5, -32.0]];
export const HELI_HP = 450;
export const HELI_FIRE_INTERVAL = 0.22;
export const HELI_SHOT_DAMAGE = 6;
export const HELI_SHOT_SPEED = baseSpeed * 0.85;
export const NV27_ZONBI_VERSION = 'NV2.7 ZONBI';
export const H1_ZONBI_NAME = 'H1 ZONBI';
export const H1_ZONBI_HP = 400;
export const H1_ZONBI_LIVES = 2;
export const H1_ZONBI_GUN = DF40II;
export const H1_ZONBI_AA = '1.5';
export const H1_ZONBI_DRONES = 3;
export const ZOMBIE_CHALLENGE_HP = 50;
export const ZOMBIE_CHALLENGE_INITIAL = 50;
export const ZOMBIE_CHALLENGE_SPAWN_RATE = 3;
export const ZOMBIE_CHALLENGE_SPAWN_POINT = [0, 0];
export const ZOMBIE_CHALLENGE_HUNTERS = 2;
export const ZOMBIE_CHALLENGE_MAX_ALIVE = 95;
export const ZOMBIE_ROLES = {
  runner: {id: 'runner', name: 'ランナー', desc: '高速突撃', speedMult: 1.24, meleeDmg: 14, meleeRange: 1.80, meleeCd: 0.62, flankAngle: 0.0, tint: [0.32, 0.92, 0.48]},
  brute: {id: 'brute', name: 'ブルート', desc: '強襲暴行', speedMult: 0.94, meleeDmg: 24, meleeRange: 2.00, meleeCd: 0.88, flankAngle: 0.0, tint: [0.95, 0.34, 0.24]},
  stalker: {id: 'stalker', name: 'ストーカー', desc: '包囲奇襲', speedMult: 1.12, meleeDmg: 18, meleeRange: 1.90, meleeCd: 0.70, flankAngle: 1.15, tint: [0.74, 0.36, 0.96]},
  caller: {id: 'caller', name: 'コーラー', desc: '集団連携', speedMult: 1.05, meleeDmg: 16, meleeRange: 1.85, meleeCd: 0.74, flankAngle: -0.65, rallyRadius: 14, rallyBoost: 1.12, tint: [0.98, 0.82, 0.26]}
};
export const ZOMBIE_ROLE_LIST = Object.keys(ZOMBIE_ROLES);
export const PLAYER_SKILL_POOL = ['shaffer', 'heal', 'flow', 'stunlauncher'];
export const NPC_SKILL_POOL = ['shaffer', 'heal', 'stunlauncher', 'judgment'];
export const SKILL_POOL = PLAYER_SKILL_POOL;
export const weapons = {
  'SW T': {capacity: 10, damage: 9, rate: 100, velocity: 100, speed: baseSpeed, interval: baseInterval, burst: 1, reload: 1.4},
  SRA: {capacity: 30, damage: 6, rate: 120, velocity: 80, speed: baseSpeed * .8, interval: baseInterval / 1.2, burst: 1, reload: 1.65},
  D1: {capacity: 40, damage: 5, rate: 100, velocity: 60, speed: baseSpeed * .6, interval: baseInterval, burst: 2, reload: 1.85},
  MS10: {capacity: 24, damage: 9, rate: 130, velocity: 180, speed: baseSpeed * 1.8, interval: baseInterval / 1.3, burst: 1, reload: 1.55, auto: true},
  'SR 1U': {capacity: 40, damage: 7, rate: 230, velocity: 90, speed: baseSpeed * .9, interval: baseInterval / 2.3, burst: 1, pellets: 1, stockCap: 1000, stockRegen: 0.25, reload: 1.55, auto: true},
  [DF]: {capacity: 95, damage: 2.8, rate: 300, velocity: 65, speed: baseSpeed * .65, interval: baseInterval / 3, burst: 3, reload: 1.85, auto: true, playerOnly: true},
  [RD20]: {capacity: 20, damage: 6, rate: 110, velocity: 70, speed: baseSpeed * .7, interval: baseInterval / 1.1, burst: 1, pellets: 1, reload: 1.55, auto: true},
  [RD30]: {capacity: 80, damage: 3, rate: 100, velocity: 100, speed: baseSpeed * 1.0, interval: baseInterval, burst: 1, pellets: 2, reload: 1.75, auto: true},
  [RD]: {capacity: 130, damage: 3, rate: 170, velocity: 140, speed: baseSpeed * 1.4, interval: baseInterval / 1.7, burst: 1, pellets: 2, reload: 1.95, auto: true, playerOnly: true},
  'RD 50': {capacity: 50, damage: 7.2, rate: 110, velocity: 65, speed: baseSpeed * .65, interval: baseInterval / 1.1, burst: 1, pellets: 1, stockCap: 300, stockRegen: 3.2, reload: 1.70, auto: true},
  [DF40II]: {capacity: 600, damage: 4, rate: 260, velocity: 112, speed: baseSpeed * 1.12, interval: baseInterval / 2.6, burst: 1, pellets: 2, stockCap: 1200, stockRegen: 2, reload: 2.15, auto: true, playerOnly: true},
  [STUN_LAUNCHER]: {capacity: STUN_LAUNCHER_AMMO, damage: STUN_LAUNCHER_DAMAGE, rate: STUN_LAUNCHER_RATE, velocity: STUN_LAUNCHER_VELOCITY, speed: baseSpeed * .3, interval: baseInterval / .6, burst: 1, pellets: 1, reload: 99, auto: true, playerOnly: true, temporary: true, rocket: true, splashDamage: STUN_LAUNCHER_SPLASH_DAMAGE, splashRadius: STUN_LAUNCHER_SPLASH_RADIUS},
  'DRONE MG': {capacity: 999, damage: DRONE_SHOT_DAMAGE, rate: 48, velocity: DRONE_SHOT_VELOCITY, speed: DRONE_SHOT_SPEED, interval: DRONE_FIRE_INTERVAL, burst: 1, pellets: 1, reload: 0.1, auto: true, playerOnly: true, temporary: true, infinite: true},
  CLAW: {capacity: 0, damage: 18, rate: 100, velocity: 0, speed: 0, interval: 0.65, burst: 1, pellets: 1, reload: 0.1, auto: true, playerOnly: true, temporary: true, melee: true}
};
export const modes = {'1v1': [1, 1], '3v3': [3, 3], '5v5': [5, 5], '1v2': [1, 2], lab: [3, 3], zombie: [1, 0], br: [5, 5], zombieChallenge: [1, 2]};
export const DEFAULT_LAB_CONFIG = {
  playerRole: 'play',   // 'play' | 'spectate'
  teamACount: 3,        // 1..5
  teamBCount: 3,        // 1..5
  teamAAi: 'human',     // nv1..human (NV2.6 Force)
  teamBAi: 'human',
  playerAA: 'weapon',   // 'weapon' | 'off' | '1.1' | '1.2' | '1.3' | '1.4' | '1.5'
  teamAAA: 'off',       // 'off' | '1.1' | '1.2' | '1.3' | '1.4' | '1.5'
  teamBAA: 'off',
  teamAGun: 'mixed',    // 'mixed' | weapon key
  teamBGun: 'mixed',
  skillRule: 'random',  // 'random' | 'shaffer' | 'heal' | 'flow' | 'stunlauncher' | 'none'
  npcSkills: false,
  startBaizer: 0,       // 0 | 40 | 100
  hpMax: 100,           // 50 | 100 | 200
  infiniteAmmo: false,
  gravityScale: 1,      // 0.5 | 1 | 1.5
  ricochetBoost: false,
  respawnTime: 3,       // 0.2 | 1 | 3
  simSpeed: 1,          // 0.5 | 1 | 2 | 4
  aiLearning: true
};

export function normalizeLabConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_LAB_CONFIG;
  const pickNum = (v, list, fb) => {
    const n = Number(v);
    return list.includes(n) ? n : fb;
  };
  const pickGun = v => (typeof v === 'string' && (v === 'mixed' || (Object.hasOwn(weapons, v) && !weapons[v].temporary))) ? v : 'mixed';
  const pickSkill = v => (v === 'shaffer' || v === 'heal' || v === 'flow' || v === 'stunlauncher' || v === 'none' || v === 'random') ? v : 'random';
  return {
    playerRole: src.playerRole === 'spectate' ? 'spectate' : 'play',
    teamACount: clamp(Math.round(Number(src.teamACount) || d.teamACount), 1, 5),
    teamBCount: clamp(Math.round(Number(src.teamBCount) || d.teamBCount), 1, 5),
    teamAAi: normalizeAiModelId(src.teamAAi, d.teamAAi),
    teamBAi: normalizeAiModelId(src.teamBAi, d.teamBAi),
    playerAA: normalizeAALevel(src.playerAA ?? d.playerAA, true, true),
    teamAAA: normalizeAALevel(src.teamAAA ?? d.teamAAA, false, true),
    teamBAA: normalizeAALevel(src.teamBAA ?? d.teamBAA, false, true),
    teamAGun: pickGun(src.teamAGun),
    teamBGun: pickGun(src.teamBGun),
    skillRule: pickSkill(src.skillRule),
    npcSkills: !!src.npcSkills,
    startBaizer: clamp(Math.round(Number(src.startBaizer) || 0), 0, BAIZER_MAX_STACK),
    hpMax: pickNum(src.hpMax, [50, 100, 200], d.hpMax),
    infiniteAmmo: !!src.infiniteAmmo,
    gravityScale: pickNum(src.gravityScale, [0.5, 1, 1.5], d.gravityScale),
    ricochetBoost: !!src.ricochetBoost,
    respawnTime: pickNum(src.respawnTime, [0.2, 1, 3], d.respawnTime),
    simSpeed: pickNum(src.simSpeed, [0.5, 1, 2, 4], d.simSpeed),
    aiLearning: src.aiLearning !== false
  };
}

function drawRandomSkill(rngFn, isHuman = true) {
  const pool = isHuman ? PLAYER_SKILL_POOL : NPC_SKILL_POOL;
  const u = rngFn ? rngFn() : Math.random();
  return pool[Math.min(pool.length - 1, Math.floor(u * pool.length))];
}

const names = [['YOU', 'NAGI', 'KAI', 'HARU', 'MIKO'], ['RIN', 'SORA', 'AO', 'YUU', 'TORA']];
const npcLeadNames = ['REN', 'NAGI', 'KAI', 'HARU', 'MIKO'];
export const npcWeapons = ['SW T', 'SRA', 'D1', 'MS10', 'RD30', 'SR 1U', 'RD20', 'RD 50'];
const sphereHit = (a, d, c, r) => {
  const v = sub(a, c), A = dot(d, d), B = dot(v, d), C = dot(v, v) - r * r;
  if (C <= 0)return 0;
  const h = B * B - A * C;
  if (h < 0 || A < 1e-14)return Infinity;
  const u = (-B - Math.sqrt(h)) / A;
  return u >= 0 && u <= 1 ? u : Infinity
};
export function bodyHit(a, b, actor) {
  const d = sub(b, a);
  if (actor.isDrone) {
    return sphereHit(a, d, [actor.x, actor.y + .35, actor.z], .56);
  }
  const center = bodyCenter(actor),
    x = a[0] - center[0],
    z = a[2] - center[1],
    rr = actor.inMech ? .78 : .39,
    lo = actor.y + .36,
    hi = actor.y + (actor.inMech ? 3.1 : 1.46 * torso(actor)),
    A = d[0] ** 2 + d[2] ** 2,
    B = x * d[0] + z * d[2],
    C = x * x + z * z - rr * rr;
  let t = Infinity;
  if (A > 1e-12) {
    const h = B * B - A * C;
    if (h >= 0) {
      const u = (-B - Math.sqrt(h)) / A;
      if (u >= 0 && u <= 1 && a[1] + d[1] * u >= lo && a[1] + d[1] * u <= hi)t = u
    }
  }
  if (C <= 0 && a[1] >= lo && a[1] <= hi)t = 0;
  return Math.min(t, sphereHit(a, d, [center[0], lo, center[1]], rr), sphereHit(a, d, [center[0], hi, center[1]], rr))
}
function randomAmmoBoxPos(rngFn, existing) {
  const rand = rngFn || Math.random;
  for (let attempt = 0; attempt < 220; attempt++) {
    const x = -21 + rand() * 42;
    const z = -88 + rand() * 176;
    if (!walkable(x, z, 0.75, 0)) continue;
    if (floorAt(x, z, 0) > 0.08) continue;
    let clear = true;
    for (let i = 0; i < tankers.length; i++) {
      const dx = x - tankers[i].x, dz = z - tankers[i].z;
      if (dx * dx + dz * dz < 23.04) { clear = false; break; }
    }
    if (!clear) continue;
    for (let i = 0; i < baizerPickups.length; i++) {
      const dx = x - baizerPickups[i].x, dz = z - baizerPickups[i].z;
      if (dx * dx + dz * dz < 12.25) { clear = false; break; }
    }
    if (!clear) continue;
    for (let i = 0; i < existing.length; i++) {
      const dx = x - existing[i].x, dz = z - existing[i].z;
      if (dx * dx + dz * dz < 196) { clear = false; break; }
    }
    if (clear) return [Math.round(x * 100) / 100, Math.round(z * 100) / 100];
  }
  // Relaxed fallback if random tries were crowded
  for (let attempt = 0; attempt < 120; attempt++) {
    const x = -21 + rand() * 42;
    const z = -88 + rand() * 176;
    if (walkable(x, z, 0.65, 0) && floorAt(x, z, 0) <= 0.08) {
      return [Math.round(x * 100) / 100, Math.round(z * 100) / 100];
    }
  }
  return [0, 0];
}
function generateAmmoBoxes(rngFn, count = AMMO_BOX_COUNT) {
  const boxes = [];
  for (let i = 0; i < count; i++) {
    const [x, z] = randomAmmoBoxPos(rngFn, boxes);
    boxes.push({id: i, x, z, amount: AMMO_BOX_AMOUNT, cooldown: 0, maxCooldown: AMMO_BOX_RESPAWN, pulse: 0});
  }
  return boxes;
}
function generateGasPipes(rngFn, count = GAS_PIPE_COUNT, avoid = []) {
  const pipes = [];
  const rand = rngFn || Math.random;
  for (let i = 0; i < count; i++) {
    let px = 0, pz = 0, found = false;
    for (let t = 0; t < 160; t++) {
      const x = (rand() * 2 - 1) * 44;
      const z = (rand() * 2 - 1) * 66;
      if (!walkable(x, z, .75, 0) || floorAt(x, z, 0) !== 0) continue;
      let clear = true;
      for (const p of avoid) if (Math.hypot(x - p.x, z - p.z) < 7.5) { clear = false; break; }
      if (!clear) continue;
      for (const p of pipes) if (Math.hypot(x - p.x, z - p.z) < 12) { clear = false; break; }
      if (!clear) continue;
      px = x; pz = z; found = true; break;
    }
    if (!found) [px, pz] = randomAmmoBoxPos(rngFn, [...avoid, ...pipes]);
    pipes.push({id: i, x: px, z: pz, hp: GAS_PIPE_HP, maxHp: GAS_PIPE_HP, alive: true, cooldown: 0, maxCooldown: GAS_PIPE_RESPAWN, hitFlash: 0});
  }
  return pipes;
}
export class Match {
  constructor(config = {}, onEvent = () => {}) {
    const mode = Object.hasOwn(modes, config.mode) ? config.mode : '3v3';
    const loadout = Object.hasOwn(weapons, config.loadout) && !weapons[config.loadout].temporary ? config.loadout : 'SW T';
    this.isZombie = mode === 'zombie';
    this.isZombieChallenge = mode === 'zombieChallenge';
    this.isBR = mode === 'br';
    this.zombieKills = 0;
    this.zombieSpawned = 0;
    this.zombieSpawnClock = 0;
    this.zombieChallengeSurvival = 0;
    this.zombieChallengeRanking = null;
    this.zombieRole = Object.hasOwn(ZOMBIE_ROLES, config.zombieRole) ? config.zombieRole : ZOMBIE_ROLE_LIST[0];
    this.worldTimeScale = 1;
    this.weather = Object.hasOwn(WEATHERS, config.weather) ? config.weather : 'clear';
    this.weatherSpec = WEATHERS[this.weather];
    this.lightningFlash = 0;
    this.lightningCooldown = this.weather === 'disaster' ? 2.2 : this.weather === 'storm' ? 5.5 : 99;
    this.squadFractured = !!this.weatherSpec.squadFracture;
    this.h1ZonbiEnabled = !!config.h1Zonbi;
    this.h1ZonbiActor = null;
    this.raidState = {m5: false, m10: false, m20: false, heliSpawned: false};
    this.raidContainer = [...RAID_CONTAINER_DOOR];
    this.raidBreachFlash = 0;
    this.helicopter = null;
    this.droneSeq = 0;
    this.isLab = mode === 'lab' || !!config.isLab;
    this.lab = this.isLab ? normalizeLabConfig(config.lab || config) : null;
    this.spectating = !!(this.isLab && this.lab.playerRole === 'spectate');
    this.spectateActorId = 0;
    this.gravityScale = this.lab ? this.lab.gravityScale : 1;
    this.ricochetBoost = !!(this.lab && this.lab.ricochetBoost);
    this.respawnDuration = this.lab ? this.lab.respawnTime : 3;
    this.infiniteAmmo = !!(this.lab && this.lab.infiniteAmmo);
    this.hpMax = this.lab ? this.lab.hpMax : 100;
    this.startBaizer = this.lab ? this.lab.startBaizer : 0;
    this.skillRule = this.isZombieChallenge ? 'none' : (this.lab ? this.lab.skillRule : 'random');
    this.config = {...config, mode, loadout, weather: this.weather, h1Zonbi: this.h1ZonbiEnabled, zombieRole: this.zombieRole};
    this.autoAimMode = config.autoAimMode === '1.5'
      ? '1.5'
      : (config.autoAim === false || config.autoAimMode === 'off')
        ? 'off'
        : 'standard';
    this.autoAim = this.autoAimMode !== 'off';
    this.allowScherp = this.isLab || this.autoAimMode === '1.5';
    this.time = 0;
    this.tremorAt = 68;
    this.groundMotion = 0;
    this.scores = [0, 0];
    this.winner = null;
    this.ended = false;
    this.onEvent = onEvent;
    this.actors = [];
    this.shots = [];
    this.effects = [];
    this.casings = [];
    this.scorches = [];
    this.bloodDroplets = [];
    this.bloodMist = [];
    this.bloodDecals = [];
    this.tankers = tankers.map(t => ({...t, cooldown: 0, maxCooldown: 25, pulse: 0, lastTeam: -1}));
    this.baizers = baizerPickups.map(b => ({...b, cooldown: 0, maxCooldown: 24, pulse: 0}));
    if (Number.isFinite(config.ammoSeed)) {
      let aMix = Math.imul((config.ammoSeed | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
      aMix = Math.imul(aMix ^ (aMix >>> 13), 0xc2b2ae35) >>> 0;
      this.ammoRng = random(aMix ^ (aMix >>> 16));
    } else {
      this.ammoRng = null;
    }
    this.ammoBoxes = generateAmmoBoxes(this.ammoRng, AMMO_BOX_COUNT);
    this.gasPipes = generateGasPipes(this.ammoRng, GAS_PIPE_COUNT, this.ammoBoxes);
    this.reinforceUsesLeft = (!!config.allNpc || this.spectating || this.isZombieChallenge) ? 0 : REINFORCE_MAX_USES;
    this.reinforceWave = 0;
    this.rng = random(1939);
    if (Number.isFinite(config.skillSeed)) {
      let sMix = Math.imul((config.skillSeed | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
      sMix = Math.imul(sMix ^ (sMix >>> 13), 0xc2b2ae35) >>> 0;
      this.skillRng = random(sMix ^ (sMix >>> 16));
    } else {
      this.skillRng = null;
    }
    this.seq = 0;
    this.echoPulse = new EchoPulseField();
    this.synapse = new SynapseProfiler();
    this.aeroVortex = new AeroVortex();
    this.thermoFlux = new ThermoFlux();
    this.spectraField = new SpectraField();
    this.resonance = new ResonanceCore();
    this.chronoTrace = new ChronoTrace();
    this.fermat = new FermatCore();
    this.kineticFlow = new KineticFlowField();
    this.telemetry = new LabTelemetry();
    this.smokeCooldown = 0;
    this.techStats = {ricochets: 0, ricochetHits: 0, penetrations: 0, wallbangHits: 0};
    // QuantumStep-ZeroGC reusable scratch & dt-cached exponential constants
    this._prevStrides = new Float32Array(128);
    this._windScratch = {vx: 0, vz: 0, speed: 0};
    this._lastExpDt = -1;
    this._kSmooth16 = 0;
    this._kAir18 = 0;
    this._kLand95 = 1;
    this._kSprint12 = 0;
    const counts = this.lab ? [this.lab.teamACount, this.lab.teamBCount] : modes[mode];
    const multiplier = Number(config.multiplier ?? 5);
    this.goals = (this.isZombie || this.isBR || this.isZombieChallenge)
      ? [Infinity, Infinity]
      : counts.map(n => config.limit === 'unlimited' ? Infinity : n * clamp(Number.isFinite(multiplier) ? Math.round(multiplier) : 5, 1, 99));
    this.receiptId = globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
    this.aiModel = this.lab
      ? this.lab.teamAAi
      : normalizeAiModelId(config.aiModel, 'human');
    this.teamAiModels = Array.isArray(config.teamAiModels) && config.teamAiModels.length === 2
      ? [normalizeAiModelId(config.teamAiModels[0]), normalizeAiModelId(config.teamAiModels[1])]
      : this.lab
        ? [this.lab.teamAAi, this.lab.teamBAi]
        : null;
    this.nv = createMatchAI(this);
    const rawSpy = config.allyNv21 === true ? 1 : Number(config.allyNv21 || 0);
    this.allyNv21Slot = mode === '3v3' && (rawSpy === 1 || rawSpy === 2) ? rawSpy : 0;
    const allNpc = !!config.allNpc || this.spectating;
    this.allNpc = allNpc;
    const benchGuns = Array.isArray(config.benchGuns) ? config.benchGuns : null;
    for (let team = 0; team < 2; team++)for (let slot = 0; slot < counts[team]; slot++) {
      const human = !allNpc && team === 0 && slot === 0;
      const labTeamGun = this.lab ? (team === 0 ? this.lab.teamAGun : this.lab.teamBGun) : 'mixed';
      let gun = human
        ? loadout
        : labTeamGun !== 'mixed' && Object.hasOwn(weapons, labTeamGun) && !weapons[labTeamGun].temporary
          ? labTeamGun
          : benchGuns && Object.hasOwn(weapons, benchGuns[slot % benchGuns.length])
            ? benchGuns[slot % benchGuns.length]
            : npcWeapons[(slot + team + 1) % npcWeapons.length];
      if (this.isZombieChallenge) {
        gun = team === 0 ? 'CLAW' : RD30;
      }
      const teamModel = this.teamAiModels ? this.teamAiModels[team] : this.aiModel;
      const isSpy = !human && !this.isZombieChallenge && ((team === 0 && this.allyNv21Slot > 0 && slot === this.allyNv21Slot) || teamModel === 'nv21');
      const aiVersion = human
        ? 'HUMAN'
        : this.isZombieChallenge && team === 1
          ? 'NV2.6'
          : isSpy
            ? 'NV2.1'
            : aiVersionDisplay(teamModel);

      // Gate Auto-Aim overrides (Lab per-side AA, or explicit player 1.5 Scherp selection)
      let aaOverride = null;
      if (this.isLab) {
        if (human) {
          const pAA = this.lab.playerAA;
          aaOverride = pAA !== 'weapon' ? normalizeAALevel(pAA, false, true) : null;
        } else {
          const tAA = team === 0 ? this.lab.teamAAA : this.lab.teamBAA;
          aaOverride = tAA !== 'off' ? normalizeAALevel(tAA, false, true) : null;
        }
      } else if (human && this.autoAimMode === '1.5' && !this.isZombieChallenge) {
        aaOverride = '1.5';
      }

      // Randomly assign strictly ONE skill per actor (or honor explicit test/Lab override; FLOW is player-only!)
      let assignedSkill = null;
      if (this.skillRule === 'none') {
        assignedSkill = null;
      } else if (human && config.playerSkill && PLAYER_SKILL_POOL.includes(config.playerSkill)) {
        assignedSkill = config.playerSkill;
      } else if (this.skillRule === 'shaffer' || this.skillRule === 'heal' || this.skillRule === 'stunlauncher') {
        assignedSkill = this.skillRule;
      } else if (this.skillRule === 'flow') {
        assignedSkill = human ? 'flow' : drawRandomSkill(this.skillRng, false);
      } else {
        assignedSkill = drawRandomSkill(this.skillRng, human);
      }

      const actorName = this.isZombieChallenge && team === 1
        ? `HUNTER-${slot + 1}`
        : team === 0 && allNpc
          ? (npcLeadNames[slot] || `A${slot + 1}`)
          : (names[team][slot] || `${team ? 'B' : 'A'}${slot + 1}`);
      const isZChallengePlayer = this.isZombieChallenge && team === 0;
      const roleSpec = isZChallengePlayer ? ZOMBIE_ROLES[this.zombieRole] : null;
      const a = {
        id: this.actors.length,
        team,
        slot,
        human,
        name: actorName,
        gun,
        aiVersion,
        isSpy,
        isZombie: isZChallengePlayer,
        armedZombie: false,
        zombieRole: roleSpec ? roleSpec.id : null,
        spawnAt: 0,
        deathAt: null,
        aaOverride,
        assignedSkill,
        maxHp: isZChallengePlayer ? ZOMBIE_CHALLENGE_HP : this.hpMax,
        maxShield: isZChallengePlayer ? 0 : undefined,
        noRespawn: this.isBR || this.isZombieChallenge,
        fractured: this.squadFractured && !human && !this.isZombieChallenge,
        kills: 0,
        deaths: 0,
        earned: 0
      };
      this.actors.push(a);
      this.spawn(a, true)
    }
    this.player = this.actors[0];
    this.spyActor = this.actors.find(a => a.isSpy) || null;
    if (this.isZombieChallenge) {
      // Spawn remaining 49 allied NV2.7 ZONBI zombies across the stage so 50 zombies start on stage!
      this.spawnZombieChallengeInitialHorde();
    }
    if (this.h1ZonbiEnabled && !this.isZombieChallenge) {
      this.spawnH1Zonbi();
    }
    if (config.zombieHeli === true) {
      this.spawnZombieHelicopter();
    }
  }
  areHostile(a, b) {
    if (!a || !b || a === b) return false;
    // Escort drones stay strictly loyal to their owner and fellow drones of the same owner
    if (a.isDrone && b.id === a.ownerId) return false;
    if (b.isDrone && a.id === b.ownerId) return false;
    if (a.isDrone && b.isDrone && a.ownerId === b.ownerId) return false;
    // Container Raid Zombies & H1 ZONBI (hostileAll) attack both teams but never other zombies or zombie-owned drones
    if (a.hostileAll || b.hostileAll) {
      const aZ = a.isZombie || (a.isDrone && this.actors[a.ownerId]?.isZombie);
      const bZ = b.isZombie || (b.isDrone && this.actors[b.ownerId]?.isZombie);
      if (aZ && bZ) return false;
      return true;
    }
    // Super Disaster weather: fractured units lose squad cohesion and engage everyone!
    if (this.squadFractured && (a.fractured || b.fractured)) return true;
    return a.team !== b.team;
  }
  weapon(a) {
    return weapons[a.gun]
  }
  event(type, detail = {}) {
    this.onEvent({type, ...detail})
  }
  spawn(a, initial = false) {
    const list = teams[a.team];
    let p = a._spawnPos || list[a.slot % list.length];
    if (!initial && !a._spawnPos) {
      let best = -Infinity;
      for (const point of list) {
        if (!walkable(...point))continue;
        const nearby = this.actors.filter(b => b !== a && b.alive);
        const opponents = nearby.filter(b => this.areHostile(a, b));
        const enemies = opponents.map(b => Math.hypot(b.x - point[0], b.z - point[1]));
        const seen = opponents.filter(b => Math.hypot(b.x - point[0], b.z - point[1]) < 44 && obstruction([point[0], 1.55, point[1]], [b.x, b.y + 1.4, b.z]) > 1).length;
        const crowded = nearby.some(b => Math.hypot(b.x - point[0], b.z - point[1]) < 2 && b.y < 1.7);
        const s = Math.min(65, ...enemies) + this.rng() * 10 - seen * 24 - (crowded ? 100 : 0);
        if (s > best) {
          best = s;
          p = point
        }
      }
    }
    const w = this.weapon(a);
    const maxShield = a.maxShield !== undefined ? a.maxShield : BASE_SHIELD_MAX;
    const startBz = maxShield === 0 ? 0 : clamp(this.startBaizer || 0, 0, BAIZER_MAX_STACK);
    const allowSc = isScherpAllowed(this) || !!a.isH1Zonbi;
    const useOverride = this.isLab || (a.human && this.autoAimMode === '1.5') || !!a.isH1Zonbi;
    const aaLvl = useOverride && a.aaOverride && a.aaOverride !== 'off' ? normalizeAALevel(a.aaOverride, false, allowSc) : null;
    Object.assign(a, {
      x: p[0],
      y: a.isDrone ? (a.droneHoverY || 3.0) : 0,
      z: p[1],
      yaw: a.team ? Math.PI : 0,
      pitch: 0,
      hp: a.maxHp || this.hpMax || 100,
      shield: maxShield,
      shieldClock: 0,
      baizerShield: startBz,
      baizerMax: startBz > 0 ? BAIZER_MAX_STACK : 0,
      baizerFlash: 0,
      shafferTimer: 0,
      flowTimer: 0,
      stunLauncher: null,
      meleeCooldown: 0,
      skillKills: a.skillKills || 0,
      skillCharges: a.skillCharges || 0,
      mag: w.capacity,
      stock: w.stockCap || 100,
      ammoClock: 0,
      ammoRate: 1,
      tankerUses: a.tankerUses || 0,
      alive: true,
      respawn: 0,
      spawnId: (a.spawnId || 0) + 1,
      dryAt: -Infinity,
      cooldown: 0,
      smokeCooldown: 0,
      burstLeft: 0,
      nextBurst: 0,
      reload: 0,
      autoReloading: false,
      vx: 0,
      vz: 0,
      vy: 0,
      stride: 0,
      flash: 0,
      recoil: 0,
      recoilSide: 0,
      hitRecoil: 0,
      seismicRattle: 0,
      seismicKnockTeam: -1,
      hitFlash: 0,
      shieldFlash: 0,
      hitDir: null,
      shotCount: a.shotCount || 0,
      onGround: true,
      crouch: 0,
      lean: 0,
      aimPose: 0,
      fwdVel: 0,
      sideVel: 0,
      airBlend: 0,
      landCompress: 0,
      sprintAmt: 0,
      reloadFrac: 0,
      expr: null,
      queue: [],
      df: a.gun === DF ? {...initialDF(), pattern: a.df?.pattern || 'central', scope: a.df?.scope || 'plastic'} : null,
      rd: isRDWeapon(a.gun) ? initialRD(a.gun) : null,
      df40: a.gun === DF40II ? initialDF40II() : null,
      aa: aaLvl ? initialUniversalAA(aaLvl) : null
    });
    if (!a.human && !a.isZombie)this.nv.attach(a);
    if (!initial)this.event('spawn', {actor: a})
  }
  setActorAA(a, level) {
    if (!a || !this.isLab) return false;
    if (level === 'weapon' && a.human) {
      a.aaOverride = null;
      a.aa = null;
      return true;
    }
    const clean = normalizeAALevel(level, false, this.isLab);
    if (clean === '1.5' && !isScherpAllowed(this)) return false;
    a.aaOverride = clean;
    a.aa = clean !== 'off' ? initialUniversalAA(clean) : null;
    return true;
  }
  toggleAA14(a = this.player) {
    return toggleAA14(this, a);
  }
  useSkill(a = this.player, skill = a?.assignedSkill, opts = null) {
    if (!a?.alive || this.ended) return false;
    if (!a.assignedSkill || skill !== a.assignedSkill) return false;
    if ((a.skillCharges || 0) <= 0) return false;
    if (skill === 'shaffer') {
      if ((a.shafferTimer || 0) > 0) return false;
      a.skillCharges--;
      a.shafferTimer = SHAFFER_DURATION;
      this.telemetry.onSkill(a);
      this.nv.onShafferCloak?.(a);
      this.effects.push({
        kind: 'shaffer',
        p: [a.x, a.y + 1.0, a.z],
        dir: [0, 1, 0],
        actor: a.id,
        team: a.team,
        life: .85,
        max: .85,
        seed: ++this.seq
      });
      this.event('skill', {actor: a, skill: 'shaffer', duration: SHAFFER_DURATION, charges: a.skillCharges});
      return true;
    }
    if (skill === 'heal') {
      if (this.isZombieChallenge && a.isZombie) return false;
      const cap = a.maxHp || this.hpMax || 100;
      if (a.hp >= cap) return false;
      const healed = Math.round((cap - a.hp) * 10) / 10;
      a.skillCharges--;
      a.hp = cap;
      this.telemetry.onSkill(a);
      this.effects.push({
        kind: 'heal',
        p: [a.x, a.y + 1.0, a.z],
        dir: [0, 1, 0],
        actor: a.id,
        team: a.team,
        life: .95,
        max: .95,
        seed: ++this.seq
      });
      this.event('skill', {actor: a, skill: 'heal', healed, charges: a.skillCharges});
      return true;
    }
    if (skill === 'flow') {
      if (!a.human) return false;
      if ((a.flowTimer || 0) > 0) return false;
      a.skillCharges--;
      a.flowTimer = FLOW_DURATION;
      this.worldTimeScale = FLOW_WORLD_SCALE;
      this.telemetry.onSkill(a);
      this.effects.push({
        kind: 'flow',
        p: [a.x, a.y + 1.0, a.z],
        dir: [0, 1, 0],
        actor: a.id,
        team: a.team,
        life: .95,
        max: .95,
        seed: ++this.seq
      });
      this.event('skill', {actor: a, skill: 'flow', duration: FLOW_DURATION, worldScale: FLOW_WORLD_SCALE, charges: a.skillCharges});
      return true;
    }
    if (skill === 'stunlauncher') {
      if (a.stunLauncher) return false;
      a.skillCharges--;
      a.stunLauncher = {
        prevGun: a.gun,
        prevMag: a.mag,
        prevStock: a.stock,
        prevDf: a.df,
        prevRd: a.rd,
        prevDf40: a.df40,
        shotsLeft: STUN_LAUNCHER_AMMO,
        lockId: -1,
        lockSpawnId: 0
      };
      a.gun = STUN_LAUNCHER;
      a.mag = STUN_LAUNCHER_AMMO;
      a.stock = 0;
      a.reload = 0;
      a.autoReloading = false;
      a.burstLeft = 0;
      a.queue.length = 0;
      a.cooldown = 0;
      a.df = null;
      a.rd = null;
      a.df40 = null;
      this.telemetry.onSkill(a);
      this.effects.push({
        kind: 'launcher',
        p: [a.x, a.y + 1.0, a.z],
        dir: [0, 1, 0],
        actor: a.id,
        team: a.team,
        life: .85,
        max: .85,
        seed: ++this.seq
      });
      this.event('skill', {actor: a, skill: 'stunlauncher', ammo: STUN_LAUNCHER_AMMO, charges: a.skillCharges});
      return true;
    }
    if (skill === 'judgment') {
      if (a.human || a.inMech) return false;
      a.skillCharges--;
      const rand = this.skillRng || this.rng;
      const pickedKey = (opts?.mechType && MECH_TYPES[opts.mechType])
        ? opts.mechType
        : MECH_TYPE_LIST[Math.floor(rand() * MECH_TYPE_LIST.length) % MECH_TYPE_LIST.length];
      const spec = MECH_TYPES[pickedKey] || MECH_TYPES.titan;
      a.inMech = true;
      a.mechType = spec.id;
      a.mechSpec = spec;
      a.mechTimer = JUDGMENT_DURATION;
      a._preMechMaxHp = a.maxHp || this.hpMax || 100;
      a._preMechMaxShield = a.maxShield;
      a.maxHp = spec.hp;
      a.hp = spec.hp;
      a.maxShield = spec.shield;
      a.shield = spec.shield;
      this.telemetry.onSkill(a);
      this.effects.push({
        kind: 'judgment',
        p: [a.x, a.y + 1.2, a.z],
        dir: [0, 1, 0],
        actor: a.id,
        team: a.team,
        mechType: spec.id,
        life: 1.2,
        max: 1.2,
        seed: ++this.seq
      });
      this.event('skill', {actor: a, skill: 'judgment', mechType: spec.id, mechCode: spec.code, mechName: spec.name, duration: JUDGMENT_DURATION, hp: spec.hp, shield: spec.shield, charges: a.skillCharges});
      return true;
    }
    return false;
  }
  revertMech(a) {
    if (!a?.inMech) return false;
    a.inMech = false;
    a.mechType = null;
    a.mechSpec = null;
    a.mechTimer = 0;
    const baseHp = a._preMechMaxHp || this.hpMax || 100;
    a.maxHp = baseHp;
    a.hp = Math.min(a.hp, baseHp);
    if (a._preMechMaxShield !== undefined) a.maxShield = a._preMechMaxShield;
    else delete a.maxShield;
    const shCap = a.maxShield !== undefined ? a.maxShield : BASE_SHIELD_MAX;
    a.shield = Math.min(a.shield, shCap);
    this.event('mechEnd', {actor: a});
    return true;
  }
  toggleDF40Scatter(a = this.player) {
    if (!a?.alive || a.gun !== DF40II || !a.df40) return {ok: false};
    a.df40.scatterMode = !a.df40.scatterMode;
    this.event('df40Mode', {actor: a, scatterMode: a.df40.scatterMode});
    return {ok: true, scatterMode: a.df40.scatterMode};
  }
  revertStunLauncher(a) {
    const sl = a?.stunLauncher;
    if (!sl) return false;
    a.gun = sl.prevGun;
    a.mag = sl.prevMag;
    a.stock = sl.prevStock;
    a.df = sl.prevDf;
    a.rd = sl.prevRd;
    a.df40 = sl.prevDf40;
    a.stunLauncher = null;
    a.reload = 0;
    a.autoReloading = false;
    a.burstLeft = 0;
    a.queue.length = 0;
    this.event('launcherEnd', {actor: a, gun: a.gun});
    return true;
  }
  findLauncherTarget(a) {
    if (!a?.alive) return null;
    const eye = eyeOf(a);
    const fwd = forward(a.yaw, a.pitch);
    let best = null, bestCos = Math.cos(0.38); // ~22 deg lock-on cone
    const actors = this.actors;
    for (let i = 0; i < actors.length; i++) {
      const e = actors[i];
      if (!e.alive || !this.areHostile(a, e) || (e.shafferTimer || 0) > 0) continue;
      const tp = targetPoint(e);
      const dx = tp[0] - eye[0], dy = tp[1] - eye[1], dz = tp[2] - eye[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.5 || dist > 145) continue;
      const c = (dx * fwd[0] + dy * fwd[1] + dz * fwd[2]) / dist;
      if (c < bestCos) continue;
      if (obstruction(eye, tp) <= 1) continue;
      bestCos = c;
      best = e;
    }
    if (a.stunLauncher) {
      a.stunLauncher.lockId = best ? best.id : -1;
      a.stunLauncher.lockSpawnId = best ? best.spawnId : 0;
    }
    return best;
  }
  _pickReinforceSpots(anchor, count) {
    const spots = [];
    const teamList = teams[anchor.team] || teams[0];
    const isFree = (x, z) => {
      if (!walkable(x, z, 0.45, 0) || floorAt(x, z, 0) > 0.12) return false;
      for (let i = 0; i < spots.length; i++) {
        const dx = x - spots[i][0], dz = z - spots[i][1];
        if (dx * dx + dz * dz < 1.35 * 1.35) return false;
      }
      const pdx = x - anchor.x, pdz = z - anchor.z;
      if (pdx * pdx + pdz * pdz < 1.45 * 1.45) return false;
      return true;
    };
    const radii = [2.6, 4.2, 5.8, 7.6];
    for (let rIdx = 0; rIdx < radii.length && spots.length < count; rIdx++) {
      const r = radii[rIdx];
      const steps = 12 + rIdx * 4;
      for (let s = 0; s < steps && spots.length < count; s++) {
        const ang = anchor.yaw + (s / steps) * Math.PI * 2 + rIdx * 0.35;
        const cx = anchor.x + Math.sin(ang) * r;
        const cz = anchor.z - Math.cos(ang) * r;
        if (isFree(cx, cz)) spots.push([cx, cz]);
      }
    }
    for (let i = 0; i < teamList.length && spots.length < count; i++) {
      const pt = teamList[i];
      if (walkable(pt[0], pt[1], 0.45, 0)) spots.push([pt[0], pt[1]]);
    }
    while (spots.length < count) {
      const pt = teamList[spots.length % teamList.length];
      spots.push([pt[0], pt[1]]);
    }
    return spots;
  }
  callReinforcements(a = this.player) {
    if (!a?.human || !a.alive || this.ended || this.spectating) return null;
    if ((this.reinforceUsesLeft || 0) <= 0) return null;
    this.reinforceUsesLeft--;
    this.reinforceWave++;
    const wave = this.reinforceWave;
    const spots = this._pickReinforceSpots(a, REINFORCE_COUNT);
    const spawned = [];
    for (let i = 0; i < REINFORCE_COUNT; i++) {
      const unitNum = (wave - 1) * REINFORCE_COUNT + i + 1;
      const gun = npcWeapons[(unitNum + i) % npcWeapons.length];
      const npc = {
        id: this.actors.length,
        team: a.team,
        slot: this.actors.length,
        human: false,
        name: `NV-${unitNum}`,
        gun,
        aiVersion: 'NV2.6',
        isSpy: false,
        aaOverride: null,
        assignedSkill: null,
        maxHp: REINFORCE_HP,
        maxShield: REINFORCE_SHIELD,
        isReinforcement: true,
        noRespawn: true,
        vanished: false,
        forceNv26: true,
        _spawnPos: spots[i],
        kills: 0,
        deaths: 0,
        earned: 0
      };
      this.actors.push(npc);
      this.spawn(npc, true);
      npc.yaw = a.yaw;
      spawned.push(npc);
      this.effects.push({
        kind: 'reinforce',
        p: [npc.x, .85, npc.z],
        dir: [0, 1, 0],
        actor: npc.id,
        team: npc.team,
        life: .95,
        max: .95,
        seed: ++this.seq
      });
    }
    this.event('reinforce', {actor: a, units: spawned, count: spawned.length, usesLeft: this.reinforceUsesLeft, wave});
    return {ok: true, units: spawned, count: spawned.length, usesLeft: this.reinforceUsesLeft, wave};
  }
  buyDrone(buyer = this.player) {
    const canBuyActor = !!(buyer?.human || String(buyer?.aiVersion || '').includes('NVSS'));
    if (!buyer?.alive || !canBuyActor || this.ended || this.isZombieChallenge) return null;
    const totalAmmo = (buyer.stock || 0) + (buyer.mag || 0);
    if (!this.infiniteAmmo && totalAmmo < DRONE_AMMO_COST) return null;
    if (!this.infiniteAmmo) {
      let cost = DRONE_AMMO_COST;
      const fromStock = Math.min(buyer.stock || 0, cost);
      buyer.stock -= fromStock;
      cost -= fromStock;
      if (cost > 0) buyer.mag = Math.max(0, (buyer.mag || 0) - cost);
    }
    const drone = this.spawnEscortDrone(buyer);
    if (!drone) return null;
    this.event('droneBought', {actor: buyer, drone, cost: DRONE_AMMO_COST, activeDrones: this.actors.filter(u => u.alive && u.isDrone && u.ownerId === buyer.id).length});
    return {ok: true, drone, cost: DRONE_AMMO_COST};
  }
  spawnEscortDrone(owner, opts = {}) {
    if (!owner) return null;
    const idx = ++this.droneSeq;
    const orbitAngle = ((idx * 2.15) % (Math.PI * 2));
    const hoverY = 2.6 + (idx % 3) * 0.65;
    const sx = clamp(owner.x + Math.cos(orbitAngle) * 2.2, -23, 23);
    const sz = clamp(owner.z + Math.sin(orbitAngle) * 2.2, -96, 96);
    const drone = {
      id: this.actors.length,
      team: owner.team,
      slot: this.actors.length,
      human: false,
      name: opts.tag || `DRONE-${idx}`,
      gun: 'DRONE MG',
      aiVersion: 'NV2.6',
      isSpy: false,
      isDrone: true,
      isReinforcement: true,
      ownerId: owner.id,
      hostileAll: !!owner.hostileAll,
      aaOverride: null,
      assignedSkill: null,
      maxHp: DRONE_HP,
      maxShield: DRONE_SHIELD,
      noRespawn: true,
      vanished: false,
      forceNv26: true,
      droneHoverY: hoverY,
      droneOrbitAngle: orbitAngle,
      droneOrbitRadius: 3.4 + (idx % 3) * 1.1,
      droneBarrel: 0,
      droneFireCd: 0.15,
      droneTargetId: -1,
      _spawnPos: [sx, sz],
      kills: 0,
      deaths: 0,
      earned: 0
    };
    this.actors.push(drone);
    this.spawn(drone, true);
    drone.y = Math.max(floorAt(sx, sz, 0) + 2.2, hoverY);
    drone.onGround = false;
    this.nv.addActorBrain?.(drone, {forceNV26: true});
    this.effects.push({
      kind: 'reinforce',
      p: [drone.x, drone.y, drone.z],
      dir: [0, 1, 0],
      actor: drone.id,
      team: drone.team,
      life: .75,
      max: .75,
      seed: ++this.seq
    });
    return drone;
  }
  spawnH1Zonbi(pos = null) {
    if (this.h1ZonbiActor?.alive) return this.h1ZonbiActor;
    const sp = pos || [0, -76];
    const team = 1;
    const boss = {
      id: this.actors.length,
      team,
      slot: this.actors.length,
      human: false,
      name: H1_ZONBI_NAME,
      gun: H1_ZONBI_GUN,
      aiVersion: NV27_ZONBI_VERSION,
      isSpy: false,
      isZombie: true,
      armedZombie: true,
      isH1Zonbi: true,
      isBoss: true,
      hostileAll: !this.isZombie,
      aaOverride: H1_ZONBI_AA,
      assignedSkill: null,
      maxHp: H1_ZONBI_HP,
      maxShield: 0,
      lives: H1_ZONBI_LIVES,
      maxLives: H1_ZONBI_LIVES,
      noRespawn: false,
      vanished: false,
      forceNv26: true,
      nv27Zonbi: true,
      _spawnPos: [sp[0], sp[1]],
      kills: 0,
      deaths: 0,
      earned: 0
    };
    this.actors.push(boss);
    this.spawn(boss, true);
    this.nv.addActorBrain?.(boss, {forceNV26: true, nv27Zonbi: true});
    this.h1ZonbiActor = boss;
    for (let i = 0; i < H1_ZONBI_DRONES; i++) {
      this.spawnEscortDrone(boss, {tag: `H1-DRONE-${i + 1}`});
    }
    this.effects.push({
      kind: 'judgment',
      p: [boss.x, 1.4, boss.z],
      dir: [0, 1, 0],
      actor: boss.id,
      team: boss.team,
      life: 1.4,
      max: 1.4,
      seed: ++this.seq
    });
    this.event('h1ZonbiSpawn', {actor: boss, hp: H1_ZONBI_HP, lives: H1_ZONBI_LIVES, gun: H1_ZONBI_GUN, drones: H1_ZONBI_DRONES});
    return boss;
  }
  spawnZombieHelicopter() {
    if (this.helicopter?.alive) return this.helicopter;
    this.helicopter = {
      alive: true,
      hp: HELI_HP,
      maxHp: HELI_HP,
      x: 0,
      y: 19.5,
      z: -42,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      bank: 0,
      rotorAngle: 0,
      orbitAngle: -Math.PI * 0.5,
      fireCd: 0.6,
      burstLeft: 0,
      targetId: -1,
      hitFlash: 0,
      team: -1
    };
    this.raidState.heliSpawned = true;
    this.event('heliSpawn', {helicopter: this.helicopter, hp: HELI_HP});
    return this.helicopter;
  }
  damageHelicopter(power, owner, hitPoint = null) {
    const h = this.helicopter;
    if (!h || !h.alive || this.ended || !Number.isFinite(power) || power <= 0) return false;
    h.hp = Math.max(0, Math.round((h.hp - power) * 10) / 10);
    h.hitFlash = 1;
    const pt = hitPoint || [h.x, h.y, h.z];
    this.effects.push({
      kind: 'hit',
      p: [pt[0], pt[1], pt[2]],
      dir: [0, -1, 0],
      normal: [0, -1, 0],
      gun: owner?.gun || 'SW T',
      team: owner?.team ?? 0,
      target: true,
      life: .34,
      max: .34,
      seed: ++this.seq
    });
    if (h.hp > 0) {
      this.event('heliHit', {actor: owner, hp: h.hp, maxHp: h.maxHp});
      return false;
    }
    h.alive = false;
    this.effects.push({
      kind: 'heliBlast',
      p: [h.x, h.y, h.z],
      dir: [0, 1, 0],
      radius: 9.0,
      team: owner?.team ?? 0,
      actor: owner?.id ?? -1,
      life: 1.45,
      max: 1.45,
      seed: ++this.seq
    });
    this.resonance.exciteBlast([h.x, 4, h.z], 1.8);
    if (owner) {
      owner.kills = (owner.kills || 0) + 1;
      if (this.isZombie) {
        this.zombieKills += 5;
        this.scores[0] = this.zombieKills;
      }
      if (owner.human) owner.earned += 50;
    }
    this.event('heliDestroyed', {actor: owner, point: [h.x, h.y, h.z]});
    return true;
  }
  spawnContainerRaid(wave = '5m') {
    const spawned = [];
    const hostileAll = !this.isZombie;
    if (wave === '5m') {
      this.raidState.m5 = true;
      for (let i = 0; i < RAID_5M_COUNT; i++) {
        const door = RAID_CONTAINER_DOORS[i % RAID_CONTAINER_DOORS.length];
        const ang = i * 1.25;
        let sx = door[0], sz = door[1];
        for (let t = 0; t < 16; t++) {
          const cx = clamp(door[0] + Math.cos(ang + t * .6) * (0.6 + t * 0.2), -22, 22);
          const cz = clamp(door[1] + Math.sin(ang + t * .6) * (0.6 + t * 0.2), -92, 92);
          if (walkable(cx, cz, 0.45, 0) && floorAt(cx, cz, 0) <= 0.1) { sx = cx; sz = cz; break; }
        }
        const z = {
          id: this.actors.length,
          team: 1,
          slot: this.actors.length,
          human: false,
          name: `Z-RD30-${i + 1}`,
          gun: RAID_5M_GUN,
          aiVersion: 'NV2.6',
          isSpy: false,
          isZombie: true,
          armedZombie: true,
          hostileAll,
          aaOverride: null,
          assignedSkill: null,
          maxHp: RAID_5M_HP,
          maxShield: 0,
          noRespawn: true,
          vanished: false,
          forceNv26: true,
          _spawnPos: [sx, sz],
          kills: 0,
          deaths: 0,
          earned: 0
        };
        this.actors.push(z);
        this.spawn(z, true);
        this.nv.addActorBrain?.(z, {forceNV26: true});
        spawned.push(z);
      }
      this.spawnZombieHelicopter();
      this.event('zombieRaid', {wave: '5m', count: spawned.length, hp: RAID_5M_HP, gun: RAID_5M_GUN, container: this.raidContainer});
      return spawned;
    }
    const is10m = wave === '10m';
    if (is10m) this.raidState.m10 = true;
    else this.raidState.m20 = true;
    const count = is10m ? RAID_10M_COUNT : RAID_20M_COUNT;
    const hp = is10m ? RAID_10M_HP : RAID_20M_HP;
    const [cx0, cz0] = this.raidContainer;
    this.raidBreachFlash = 6.0;
    for (let i = 0; i < count; i++) {
      const ring = 0.6 + Math.floor(i / 8) * 0.72;
      const ang = (i % 8) * (Math.PI * 2 / 8) + Math.floor(i / 8) * 0.35;
      let sx = cx0, sz = cz0;
      const tx = clamp(cx0 + Math.cos(ang) * ring, -22, 22);
      const tz = clamp(cz0 + Math.sin(ang) * ring, -92, 92);
      if (walkable(tx, tz, 0.38, 0) && floorAt(tx, tz, 0) <= 0.12) { sx = tx; sz = tz; }
      const role = ZOMBIE_ROLE_LIST[i % ZOMBIE_ROLE_LIST.length];
      const z = {
        id: this.actors.length,
        team: 1,
        slot: this.actors.length,
        human: false,
        name: `Z-CR-${wave}-${i + 1}`,
        gun: 'CLAW',
        aiVersion: NV27_ZONBI_VERSION,
        isSpy: false,
        isZombie: true,
        armedZombie: false,
        zombieRole: role,
        hostileAll,
        aaOverride: null,
        assignedSkill: null,
        maxHp: hp,
        maxShield: 0,
        noRespawn: true,
        vanished: false,
        _spawnPos: [sx, sz],
        kills: 0,
        deaths: 0,
        earned: 0
      };
      this.actors.push(z);
      this.spawn(z, true);
      z.x = sx; z.z = sz;
      z.meleeCooldown = 0;
      spawned.push(z);
    }
    if (!this.helicopter?.alive) this.spawnZombieHelicopter();
    this.event('zombieRaid', {wave, count: spawned.length, hp, armed: false, container: this.raidContainer});
    return spawned;
  }
  spawnZombieChallengeInitialHorde() {
    // 50 zombies total on stage at start: player (1) + 49 allied NV2.7 ZONBI zombies distributed around stage center & flanks!
    const need = ZOMBIE_CHALLENGE_INITIAL - 1;
    const rand = this.rng;
    for (let i = 0; i < need; i++) {
      let sx = 0, sz = 0;
      for (let t = 0; t < 40; t++) {
        const x = (rand() * 2 - 1) * 20;
        const z = -25 + rand() * 88;
        if (walkable(x, z, 0.45, 0) && floorAt(x, z, 0) <= 0.1) { sx = x; sz = z; break; }
      }
      this.spawnZombieChallengeUnit([sx, sz], i);
    }
  }
  spawnZombieChallengeUnit(pos = null, seqIdx = -1) {
    this.zombieSpawned++;
    const num = seqIdx >= 0 ? seqIdx + 1 : this.zombieSpawned;
    const role = ZOMBIE_ROLE_LIST[num % ZOMBIE_ROLE_LIST.length];
    const [bx, bz] = pos || ZOMBIE_CHALLENGE_SPAWN_POINT;
    const ang = (num * 2.39996) % (Math.PI * 2);
    let sx = bx, sz = bz;
    if (!pos) {
      const tx = clamp(bx + Math.cos(ang) * 1.4, -22, 22);
      const tz = clamp(bz + Math.sin(ang) * 1.4, -92, 92);
      if (walkable(tx, tz, 0.4, 0) && floorAt(tx, tz, 0) <= 0.12) { sx = tx; sz = tz; }
    }
    const z = {
      id: this.actors.length,
      team: 0,
      slot: this.actors.length,
      human: false,
      name: `Z27-${ZOMBIE_ROLES[role].name.slice(0, 2)}-${num}`,
      gun: 'CLAW',
      aiVersion: NV27_ZONBI_VERSION,
      isSpy: false,
      isZombie: true,
      armedZombie: false,
      zombieRole: role,
      spawnAt: this.time,
      deathAt: null,
      aaOverride: null,
      assignedSkill: null,
      maxHp: ZOMBIE_CHALLENGE_HP,
      maxShield: 0,
      noRespawn: true,
      vanished: false,
      _spawnPos: [sx, sz],
      kills: 0,
      deaths: 0,
      earned: 0
    };
    this.actors.push(z);
    this.spawn(z, true);
    z.x = sx;
    z.z = sz;
    z.meleeCooldown = 0;
    return z;
  }
  computeZombieChallengeRanking() {
    const entries = [];
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (!a.isZombie || a.team !== 0) continue;
      const endT = a.alive ? this.time : (a.deathAt ?? this.time);
      const survived = Math.max(0, Math.round((endT - (a.spawnAt || 0)) * 100) / 100);
      entries.push({id: a.id, name: a.name, human: !!a.human, role: a.zombieRole || 'runner', aiVersion: a.aiVersion, survived, alive: !!a.alive});
    }
    entries.sort((x, y) => y.survived - x.survived || (y.alive ? 1 : 0) - (x.alive ? 1 : 0));
    const playerIdx = entries.findIndex(e => e.human);
    const ranking = {
      playerRank: playerIdx >= 0 ? playerIdx + 1 : entries.length,
      totalZombies: entries.length,
      playerSurvived: playerIdx >= 0 ? entries[playerIdx].survived : this.time,
      top: entries.slice(0, 10)
    };
    this.zombieChallengeRanking = ranking;
    return ranking;
  }
  zombieMeleeStrike(a) {
    if (!a?.alive || this.ended) return false;
    const role = ZOMBIE_ROLES[a.zombieRole] || ZOMBIE_ROLES.runner;
    const dmg = role.meleeDmg || ZOMBIE_MELEE_DAMAGE;
    const range = (role.meleeRange || ZOMBIE_MELEE_RANGE) + 0.55;
    a.cooldown = role.meleeCd || ZOMBIE_MELEE_COOLDOWN;
    a.recoil = 1;
    a.shotCount = (a.shotCount || 0) + 1;
    const fx = Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    let best = null, bestD = Infinity;
    for (let i = 0; i < this.actors.length; i++) {
      const e = this.actors[i];
      if (!e.alive || !this.areHostile(a, e)) continue;
      const dx = e.x - a.x, dy = e.y - a.y, dz = e.z - a.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > range) continue;
      const dotF = (dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz));
      if (d > 0.7 && dotF < 0.25) continue;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      const d = Math.max(0.01, Math.hypot(best.x - a.x, best.z - a.z));
      this.damage(best, a, dmg, [(best.x - a.x) / d, 0.1, (best.z - a.z) / d], {melee: true, point: [best.x, best.y + 1.1, best.z]});
    }
    this.event('melee', {actor: a, hit: !!best, target: best, damage: dmg});
    return true;
  }
  spawnBloodSplatter(v, hitPos, shotDir, hpLoss, isKill = false) {
    if (!v || v.isDrone || v.inMech || hpLoss <= 0) return;
    const px = hitPos ? hitPos[0] : v.x;
    const py = hitPos ? hitPos[1] : (v.y + 1.15);
    const pz = hitPos ? hitPos[2] : v.z;
    let dx = shotDir ? shotDir[0] : (this.rng() - .5);
    let dy = shotDir ? shotDir[1] : 0.1;
    let dz = shotDir ? shotDir[2] : (this.rng() - .5);
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    // Build tangent frame around bullet direction for cone arterial spray
    const tx = Math.abs(dy) > 0.9 ? 1 : -dz;
    const tz = Math.abs(dy) > 0.9 ? 0 : dx;
    const tl = Math.hypot(tx, tz) || 1;
    const ux = tx / tl, uz = tz / tl;
    const wx = -dy * uz, wy = dx * uz - dz * ux, wz = dy * ux;

    const dropCount = isKill ? 34 : clamp(Math.round(10 + hpLoss * 1.1), 12, 26);
    for (let i = 0; i < dropCount; i++) {
      const r1 = this.rng(), r2 = this.rng(), r3 = this.rng();
      const ang = r1 * Math.PI * 2;
      const isBack = i < dropCount * 0.22;
      const isHeavy = i >= dropCount * 0.72;
      const cone = isHeavy ? (0.45 + r2 * 0.65) : isBack ? (0.28 + r2 * 0.42) : (0.08 + r2 * 0.38);
      const ca = Math.cos(ang) * cone, sa = Math.sin(ang) * cone;
      const dirSign = isBack ? -0.65 : isHeavy ? 0.35 : 1.0;
      const spd = isHeavy ? (1.0 + r3 * 2.4) : isBack ? (1.8 + r3 * 3.4) : (3.6 + r3 * 7.8 + (isKill ? 2.4 : 0));
      const vx = (dx * dirSign + ux * ca + wx * sa) * spd;
      const vy = (dy * dirSign + wy * sa + (isHeavy ? -0.15 : 0.18 + r2 * 0.32)) * spd;
      const vz = (dz * dirSign + uz * ca + wz * sa) * spd;
      this.bloodDroplets.push({
        x: px + (this.rng() - .5) * .12,
        y: Math.max(0.15, py + (this.rng() - .5) * .16),
        z: pz + (this.rng() - .5) * .12,
        vx, vy, vz,
        r: isHeavy ? (0.026 + r3 * 0.022) : (0.011 + r3 * 0.016),
        tier: i % 3, // 0=bright oxygenated arterial, 1=deep crimson, 2=dark venous oxblood
        life: 0.75 + r2 * 0.85,
        maxLife: 1.6
      });
    }
    if (this.bloodDroplets.length > 260) this.bloodDroplets.splice(0, this.bloodDroplets.length - 260);

    // Fine aerosolized hemoglobin mist puffs at entry & exit wounds
    const mistCount = isKill ? 7 : 3;
    for (let m = 0; m < mistCount; m++) {
      const exitShift = (m % 2 === 0 ? 0.22 : -0.08);
      this.bloodMist.push({
        x: px + dx * exitShift + (this.rng() - .5) * .18,
        y: Math.max(0.2, py + (this.rng() - .5) * .18),
        z: pz + dz * exitShift + (this.rng() - .5) * .18,
        vx: dx * (0.9 + this.rng() * 1.4) + (this.rng() - .5) * .6,
        vy: 0.25 + this.rng() * 0.55,
        vz: dz * (0.9 + this.rng() * 1.4) + (this.rng() - .5) * .6,
        r: 0.14 + this.rng() * 0.16,
        grow: isKill ? 0.85 : 0.55,
        life: isKill ? 0.85 : 0.52,
        maxLife: isKill ? 0.85 : 0.52
      });
    }
    if (this.bloodMist.length > 70) this.bloodMist.splice(0, this.bloodMist.length - 70);

    // On kill: spawn an expanding coagulating arterial blood pool beneath fallen body!
    if (isKill) {
      const groundY = floorAt(v.x, v.z, v.y + 0.5);
      this.bloodDecals.push({
        x: v.x + dx * 0.25,
        y: groundY + 0.018,
        z: v.z + dz * 0.25,
        nx: 0, ny: 1, nz: 0,
        vx: dx, vz: dz,
        r: 0.22,
        targetR: 0.92 + this.rng() * 0.35,
        stretch: 1.25,
        pool: true,
        life: 28,
        maxLife: 28
      });
      if (this.bloodDecals.length > 180) this.bloodDecals.shift();
    }

    const pl = this.player;
    const distToPlayer = pl ? Math.hypot(px - pl.x, py - (pl.y + 1.4), pz - pl.z) : 99;
    this.event('bloodSplatter', {victim: v, point: [px, py, pz], dir: [dx, dy, dz], hpLoss, isKill, distToPlayer});
  }
  updateBlood(dt) {
    const droplets = this.bloodDroplets;
    const windBase = this.weatherSpec?.windBase || 0;
    const rOut = this._bloodRay || (this._bloodRay = {
      t: 0, tExit: 0, point: [0, 0, 0], normal: [0, 1, 0],
      exitPoint: null, exitNormal: null, _exitPt: [0, 0, 0], _exitNrm: [0, 1, 0],
      thickness: Infinity, mat: 'steel', box: null
    });
    let dw = 0;
    for (let i = 0; i < droplets.length; i++) {
      const d = droplets[i];
      d.life -= dt;
      if (d.life <= 0) continue;
      const drag = Math.max(0, 1 - 1.35 * dt);
      d.vx = d.vx * drag + windBase * 0.22 * dt;
      d.vy -= 9.8 * this.gravityScale * dt;
      d.vz = d.vz * drag + windBase * 0.14 * dt;
      const nx = d.x + d.vx * dt, ny = d.y + d.vy * dt, nz = d.z + d.vz * dt;
      const fl = floorAt(nx, nz, d.y + 0.25);
      let splatted = false;
      if (ny <= fl + 0.02) {
        splatted = true;
        const hSpd = Math.hypot(d.vx, d.vz);
        if (this.bloodDecals.length < 180 || this.rng() < 0.35) {
          this.bloodDecals.push({
            x: nx, y: fl + 0.016, z: nz,
            nx: 0, ny: 1, nz: 0,
            vx: d.vx / (hSpd || 1), vz: d.vz / (hSpd || 1),
            r: clamp(d.r * 5.2, 0.06, 0.24),
            targetR: clamp(d.r * 6.5, 0.08, 0.28),
            stretch: clamp(1 + hSpd * 0.22, 1.0, 2.8),
            pool: false,
            life: 22,
            maxLife: 22
          });
          if (this.bloodDecals.length > 180) this.bloodDecals.shift();
        }
      } else if (raycastMaterialOut(d.x, d.y, d.z, nx, ny, nz, rOut)) {
        splatted = true;
        const p = rOut.point, n = rOut.normal;
        this.bloodDecals.push({
          x: p[0] + n[0] * 0.015, y: p[1] + n[1] * 0.015, z: p[2] + n[2] * 0.015,
          nx: n[0], ny: n[1], nz: n[2],
          vx: 0, vz: 0,
          r: clamp(d.r * 5.6, 0.07, 0.26),
          targetR: clamp(d.r * 6.8, 0.09, 0.30),
          stretch: 1.4,
          pool: false,
          life: 24,
          maxLife: 24
        });
        if (this.bloodDecals.length > 180) this.bloodDecals.shift();
      }
      if (!splatted) {
        d.x = nx; d.y = ny; d.z = nz;
        droplets[dw++] = d;
      }
    }
    droplets.length = dw;

    const mist = this.bloodMist;
    let mw = 0;
    for (let i = 0; i < mist.length; i++) {
      const m = mist[i];
      m.life -= dt;
      if (m.life <= 0) continue;
      m.x += (m.vx + windBase * 0.12) * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      m.vx *= Math.max(0, 1 - 2.4 * dt);
      m.vy *= Math.max(0, 1 - 2.2 * dt);
      m.vz *= Math.max(0, 1 - 2.4 * dt);
      m.r += m.grow * dt;
      mist[mw++] = m;
    }
    mist.length = mw;

    const decals = this.bloodDecals;
    let cw = 0;
    for (let i = 0; i < decals.length; i++) {
      const dc = decals[i];
      dc.life -= dt;
      if (dc.life <= 0) continue;
      if (dc.r < dc.targetR) dc.r = Math.min(dc.targetR, dc.r + (dc.pool ? 0.24 : 0.45) * dt);
      decals[cw++] = dc;
    }
    decals.length = cw;
  }
  updateDrones(dt) {
    const actors = this.actors;
    for (let i = 0; i < actors.length; i++) {
      const d = actors[i];
      if (!d.isDrone || !d.alive) continue;
      if (d.droneFireCd > 0) d.droneFireCd = Math.max(0, d.droneFireCd - dt);
      const owner = actors[d.ownerId];
      // Orbit & guard owner freely in 3D airspace (NV2.6 tactical aerial weave!)
      d.droneOrbitAngle = (d.droneOrbitAngle || 0) + dt * 1.15;
      const anchorX = owner?.alive ? owner.x : d.x;
      const anchorY = owner?.alive ? owner.y : 0;
      const anchorZ = owner?.alive ? owner.z : d.z;
      const rad = d.droneOrbitRadius || 3.8;
      let goalX = clamp(anchorX + Math.cos(d.droneOrbitAngle) * rad, -23.5, 23.5);
      let goalZ = clamp(anchorZ + Math.sin(d.droneOrbitAngle) * rad, -96, 96);
      const groundBelow = floorAt(d.x, d.z, 10);
      const goalY = Math.max(groundBelow + 2.1, anchorY + (d.droneHoverY || 3.0) + Math.sin(this.time * 2.3 + d.id) * 0.45);

      // Find nearest hostile target within DRONE_RANGE (10m)
      let target = null, bestD2 = DRONE_RANGE * DRONE_RANGE;
      for (let j = 0; j < actors.length; j++) {
        const e = actors[j];
        if (!e.alive || !this.areHostile(d, e) || (e.shafferTimer || 0) > 0) continue;
        const tp = targetPoint(e);
        const dx = tp[0] - d.x, dy = tp[1] - (d.y + 0.35), dz = tp[2] - d.z;
        const dist2 = dx * dx + dy * dy + dz * dz;
        if (dist2 <= bestD2 && obstruction([d.x, d.y + 0.35, d.z], tp) > 1) {
          bestD2 = dist2;
          target = e;
        }
      }
      d.droneTargetId = target ? target.id : -1;

      // Steer smoothly in 3D airspace (weave slightly toward intercept line while maintaining owner guard tether)
      if (target && owner?.alive) {
        goalX = clamp(owner.x * 0.65 + target.x * 0.35 + Math.cos(d.droneOrbitAngle * 1.7) * 2.2, -23.5, 23.5);
        goalZ = clamp(owner.z * 0.65 + target.z * 0.35 + Math.sin(d.droneOrbitAngle * 1.7) * 2.2, -96, 96);
      }
      const dxG = goalX - d.x, dyG = goalY - d.y, dzG = goalZ - d.z;
      const distG = Math.hypot(dxG, dyG, dzG) || 1;
      const spd = Math.min(9.5, distG * 2.4);
      const k = 1 - Math.exp(-5.5 * dt);
      d.vx += ((dxG / distG) * spd - (d.vx || 0)) * k;
      d.vy += ((dyG / distG) * spd - (d.vy || 0)) * k;
      d.vz += ((dzG / distG) * spd - (d.vz || 0)) * k;
      d.x = clamp(d.x + d.vx * dt, -24, 24);
      d.y = clamp(d.y + d.vy * dt, Math.max(1.5, groundBelow + 1.4), 9.5);
      d.z = clamp(d.z + d.vz * dt, -97, 97);
      d.onGround = false;

      if (target) {
        const tp = targetPoint(target);
        const ex = tp[0] - d.x, ey = tp[1] - (d.y + 0.35), ez = tp[2] - d.z;
        const horiz = Math.hypot(ex, ez) || 1;
        d.yaw = Math.atan2(ex, -ez);
        d.pitch = clamp(Math.atan2(ey, horiz), -1.35, 1.35);
        if (d.droneFireCd <= 0) {
          d.droneFireCd = DRONE_FIRE_INTERVAL;
          d.droneBarrel = 1 - (d.droneBarrel || 0);
          const side = d.droneBarrel ? 1 : -1;
          const rx = Math.cos(d.yaw), rz = Math.sin(d.yaw);
          const muzzle = [d.x + rx * side * 0.26, d.y + 0.22, d.z + rz * side * 0.26];
          const dir = unit([tp[0] - muzzle[0], tp[1] - muzzle[1], tp[2] - muzzle[2]]);
          const shot = {
            id: ++this.seq,
            owner: d,
            team: d.team,
            gun: 'DRONE MG',
            source: 'drone',
            origin: [...muzzle],
            p: [...muzzle],
            old: [...muzzle],
            muzzle: [...muzzle],
            muzzle3p: [...muzzle],
            dir,
            guided: false,
            homingTargetId: -1,
            homingBudget: 0,
            homingTurned: 0,
            damage: DRONE_SHOT_DAMAGE,
            speed: DRONE_SHOT_SPEED,
            life: 0.9,
            age: 0,
            whizzed: false,
            trail: [[...muzzle]],
            trailClock: 0
          };
          initShotAero(shot);
          this.shots.push(shot);
          d.flash = 0.08;
          d.shotCount = (d.shotCount || 0) + 1;
          this.effects.push({kind: 'muzzle', p: muzzle, dir: [...dir], gun: 'DRONE MG', team: d.team, actor: d.id, life: .09, max: .09, seed: shot.id});
          this.event('fire', {actor: d, source: 'drone', gun: 'DRONE MG', p: muzzle, dir, speed: DRONE_SHOT_SPEED, pellets: 1});
        }
      } else if (Math.hypot(d.vx, d.vz) > 0.3) {
        d.yaw = Math.atan2(d.vx, -d.vz);
        d.pitch = 0;
      }
    }
  }
  updateHelicopter(dt) {
    const h = this.helicopter;
    if (!h || !h.alive || this.ended) return;
    if (h.hitFlash > 0) h.hitFlash = Math.max(0, h.hitFlash - dt * 4.5);
    h.rotorAngle = (h.rotorAngle + dt * 28) % (Math.PI * 2);
    h.orbitAngle += dt * 0.28;
    const prevX = h.x, prevZ = h.z;
    h.x = Math.cos(h.orbitAngle) * 20;
    h.z = Math.sin(h.orbitAngle) * 48;
    h.y = 18.8 + Math.sin(this.time * 0.75) * 2.1;
    h.vx = (h.x - prevX) / Math.max(1e-4, dt);
    h.vz = (h.z - prevZ) / Math.max(1e-4, dt);
    h.yaw = Math.atan2(h.vx, -h.vz);
    h.bank = 0.22;

    if (h.fireCd > 0) h.fireCd = Math.max(0, h.fireCd - dt);
    if (h.fireCd <= 0) {
      // Pick ANY alive non-zombie combatant (friend or foe indiscriminately!) in LOS
      let target = null, bestD2 = Infinity;
      const eye = [h.x, h.y - 1.3, h.z];
      for (let i = 0; i < this.actors.length; i++) {
        const a = this.actors[i];
        if (!a.alive || a.isZombie || (a.shafferTimer || 0) > 0) continue;
        const tp = targetPoint(a);
        const dx = tp[0] - eye[0], dy = tp[1] - eye[1], dz = tp[2] - eye[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2 && obstruction(eye, tp) > 1) {
          bestD2 = d2;
          target = a;
        }
      }
      if (target) {
        h.targetId = target.id;
        h.fireCd = HELI_FIRE_INTERVAL;
        const tp = targetPoint(target);
        const spread = 0.045;
        const dir = unit([
          tp[0] - eye[0] + (this.rng() - .5) * spread * Math.sqrt(bestD2),
          tp[1] - eye[1] + (this.rng() - .5) * spread * Math.sqrt(bestD2),
          tp[2] - eye[2] + (this.rng() - .5) * spread * Math.sqrt(bestD2)
        ]);
        const heliActor = {id: -99, team: -1, name: 'ZOMBIE HELI', gun: 'RD30', human: false, hostileAll: true, isZombie: true, isHeli: true};
        const shot = {
          id: ++this.seq,
          owner: heliActor,
          team: -1,
          hostileAll: true,
          fromHeli: true,
          gun: 'RD30',
          source: 'heli',
          origin: [...eye],
          p: [...eye],
          old: [...eye],
          muzzle: [...eye],
          muzzle3p: [...eye],
          dir,
          guided: false,
          homingTargetId: -1,
          homingBudget: 0,
          homingTurned: 0,
          damage: HELI_SHOT_DAMAGE,
          speed: HELI_SHOT_SPEED,
          life: 1.5,
          age: 0,
          whizzed: false,
          trail: [[...eye]],
          trailClock: 0
        };
        initShotAero(shot);
        this.shots.push(shot);
        this.effects.push({kind: 'muzzle', p: eye, dir: [...dir], gun: 'RD30', team: 1, actor: -99, life: .12, max: .12, seed: shot.id});
        this.event('heliFire', {point: eye, dir, target});
      } else {
        h.fireCd = 0.35;
      }
    }
  }
  updateWeather(dt) {
    if (this.lightningFlash > 0) this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.8);
    if (this.raidBreachFlash > 0) this.raidBreachFlash = Math.max(0, this.raidBreachFlash - dt);
    if (this.weather === 'storm' || this.weather === 'disaster') {
      this.lightningCooldown -= dt;
      if (this.lightningCooldown <= 0) {
        this.lightningFlash = this.weather === 'disaster' ? 1.0 : 0.72;
        this.lightningCooldown = this.weather === 'disaster' ? (1.8 + this.rng() * 3.2) : (4.5 + this.rng() * 6.5);
        this.event('lightning', {weather: this.weather, intensity: this.lightningFlash});
      }
      // Inject ambient gale gusts into AeroVortex
      const wb = this.weatherSpec.windBase;
      if (wb > 0 && this.rng() < dt * 2.5) {
        this.aeroVortex.injectSmoke((this.rng() - .5) * 32, (this.rng() - .5) * 120, 0.02, 0.04, 1, wb * 0.35, wb * 0.22);
      }
    }
  }
  updateTimedEvents() {
    if (this.ended || this.isZombieChallenge) return;
    if (!this.raidState.m5 && this.time >= RAID_5M_TIME) {
      this.spawnContainerRaid('5m');
    }
    if (!this.raidState.m10 && this.time >= RAID_10M_TIME) {
      this.spawnContainerRaid('10m');
    }
    if (!this.raidState.m20 && this.time >= RAID_20M_TIME) {
      this.spawnContainerRaid('20m');
    }
    // In Zombie Mode, also bring in the Zombie Helicopter at 60s so players face aerial threats quickly
    if (this.isZombie && !this.raidState.heliSpawned && this.time >= 60) {
      this.spawnZombieHelicopter();
    }
  }
  setAutoAimMode(mode) {
    const clean = mode === '1.5' ? '1.5' : mode === 'off' ? 'off' : 'standard';
    this.autoAimMode = clean;
    this.autoAim = clean !== 'off';
    this.allowScherp = this.isLab || clean === '1.5';
    const a = this.player;
    if (a && !this.isLab && a.human) {
      if (clean === '1.5') {
        a.aaOverride = '1.5';
        if (!a.aa || a.aa.level !== '1.5') a.aa = initialUniversalAA('1.5');
      } else {
        a.aaOverride = null;
        a.aa = null;
      }
    }
    if (!this.autoAim) this.setAutoAim(false);
    return this.autoAimMode;
  }
  setAutoAim(enabled) {
    this.autoAim = !!enabled;
    if (!this.autoAim) {
      this.autoAimMode = 'off';
      this.allowScherp = this.isLab;
    } else if (this.autoAimMode === 'off') {
      this.autoAimMode = 'standard';
    }
    const a = this.player;
    if (!this.autoAim && a) {
      if (a.aa) {
        a.aa.focusId = -1;
        a.aa.focus = 0;
        a.aa.locked = false;
        a.aa.occluded = false;
        a.aa.wallActive = false;
        a.aa.wallTimer = 0;
        a.aa.solveMode = 'none';
        a.aa.activeBank = null;
        a.aa.lastAimPoint = null;
        a.aa.targetDist = 0;
        a.aa.trackYaw = 0;
        a.aa.trackPitch = 0;
        a.aa.est?.reset();
      }
      if (a.df) {
        a.df.focusId = -1;
        a.df.focus = 0;
        a.df.locked = false;
      }
      if (a.rd) {
        a.rd.focusId = -1;
        a.rd.focus = 0;
        a.rd.locked = false;
        a.rd.occluded = false;
        a.rd.d01Active = false;
        a.rd.d01Timer = 0;
        a.rd.lastAimPoint = null;
        a.rd.targetDist = 0;
        a.rd.trackYaw = 0;
        a.rd.trackPitch = 0;
      }
      if (a.df40) {
        a.df40.focusId = -1;
        a.df40.focus = 0;
        a.df40.locked = false;
        a.df40.occluded = false;
        a.df40.d01Active = false;
        a.df40.d01Timer = 0;
        a.df40.lastAimPoint = null;
        a.df40.targetDist = 0;
        a.df40.trackYaw = 0;
        a.df40.trackPitch = 0;
        if (a.df40.aa14Active) {
          a.df40.aa14Active = false;
          a.df40.aa14LastOffAt = this.time;
          a.df40.aaVersion = '1.3';
        }
      }
    }
    return this.autoAim;
  }
  reload(a, auto = false) {
    if (!a.alive || this.ended || a.stunLauncher || this.weapon(a)?.melee || a.reload > 0 || a.burstLeft || a.mag >= this.weapon(a).capacity || a.stock <= 0)return false;
    a.reload = this.weapon(a).reload;
    a.autoReloading = !!auto;
    this.nv.onReload?.(a);
    this.event('reload', {actor: a, auto: !!auto});
    return true;
  }
  trigger(a) {
    if (this.ended || !a.alive || a.cooldown > 1e-7 || a.reload > 0 || a.burstLeft)return false;
    const w = this.weapon(a);
    if (w?.melee) return this.zombieMeleeStrike(a);
    if (a.mag <= 0) {
      if (this.time >= a.dryAt) {
        a.dryAt = this.time + .28;
        this.event('dry', {actor: a});
      }
      return false
    }
    a.queue = a.df ? scheduleDF(a) : Array(Math.min(w.burst, a.mag)).fill('main');
    this.fire(a, a.queue.shift());
    a.burstLeft = a.queue.length;
    a.nextBurst = w.interval;
    return true;
  }
  fire(a, source = 'main') {
    if (!a.alive || this.ended || a.reload > 0) return false;
    const w = this.weapon(a);
    if (w?.melee) return this.zombieMeleeStrike(a);
    const isRocket = !!w.rocket;
    const isScatter = a.gun === DF40II && !!a.df40?.scatterMode && source === 'main';
    const mechSpec = a.inMech ? (a.mechSpec || MECH_TYPES.titan) : null;
    const extraPellets = mechSpec?.extraPellets || 0;
    const basePellets = (isScatter ? DF40II_SCATTER_PELLETS : (w.pellets || 1)) + extraPellets;
    const salvo = (isScatter || w.pellets || extraPellets) && source === 'main' ? Math.min(basePellets, a.mag) : 1;
    const baseDmg = isScatter ? DF40II_SCATTER_DAMAGE : w.damage;
    const dmgMult = mechSpec ? mechSpec.damageMult : 1;
    const shotDmg = a.inMech ? Math.round(baseDmg * dmgMult * 10) / 10 : baseDmg;
    if (source === 'p1') {
      if (!a.df || !spendP1(a, this.time)) return false
    } else {
      if (!a.mag || salvo <= 0) return false;
      if (isRocket || !this.infiniteAmmo) a.mag -= salvo;
      if (a.stunLauncher) a.stunLauncher.shotsLeft = Math.max(0, (a.stunLauncher.shotsLeft || 0) - salvo);
    }
    a.cooldown = mechSpec ? w.interval * mechSpec.rateMult : w.interval;
    a.flash = a.gun === 'MS10' ? .115 : a.gun === DF40II ? .112 : a.gun === RD ? .108 : a.gun === 'RD 50' ? .102 : a.gun === RD30 ? .098 : isRocket ? .14 : .095;
    a.recoil = 1;
    a.recoilSide = (this.rng() - .5) * 2;
    a.shotCount = (a.shotCount || 0) + 1;
    if (a.rd) {
      a.rd.firePulse = 1;
      a.rd.barrelPhase = 1 - (a.rd.barrelPhase || 0);
    }
    const firedAA14 = !!(a.df40?.aa14Active && !a.df40?.aa14Overheated) || a.aa?.level === '1.4';
    const firedScherp = !!(a.aa?.level === '1.5' && isScherpAllowed(this));
    const cloaked = (a.shafferTimer || 0) > 0;
    const p = eyeOf(a);
    const camFwd = forward(a.yaw, a.pitch);
    const camRight = unit(cross(camFwd, [0, 1, 0]));
    const camUp = cross(camRight, camFwd);
    const [mOffX, mOffY, mOffZ] = muzzleOffset(a.gun);
    const barrelLen3p = a.gun === 'MS10' ? .96 : a.gun === DF40II ? .94 : a.gun === RD ? .90 : a.gun === 'RD 50' ? .84 : a.gun === RD30 ? .82 : a.gun === RD20 ? .72 : a.gun === 'SR 1U' ? .64 : a.gun === STUN_LAUNCHER ? .88 : a.gun === 'D1' ? .80 : a.gun === 'SW T' ? .66 : .78;
    const quadOffsets = [[-1, .65], [1, .65], [-.85, -.65], [.85, -.65]];
    const rocketTarget = isRocket ? this.findLauncherTarget(a) : null;
    let firstDir = null, firstMuzzle = null;
    for (let k = 0; k < salvo; k++) {
      let barrelSide = salvo === 4 ? quadOffsets[k][0] : salvo === 3 ? (k - 1) : salvo === 2 ? (k === 0 ? -1 : 1) : 0;
      let barrelVert = salvo === 4 ? quadOffsets[k][1] : salvo === 3 ? (k === 1 ? 1 : -0.45) : 0;
      if (isScatter) {
        const ring = k < 4 ? 0.9 : 2.1;
        const ang = (k < 4 ? (k / 4) : ((k - 4) / Math.max(1, salvo - 4))) * Math.PI * 2 + (k >= 4 ? 0.35 : 0);
        barrelSide = Math.cos(ang) * ring;
        barrelVert = Math.sin(ang) * ring;
      }
      const guidedInfo = isRocket
        ? (rocketTarget ? {
            dir: unit(sub(targetPoint(rocketTarget), p)),
            guided: true,
            targetId: rocketTarget.id,
            homingBudget: 2.4,
            homingRate: 5.5,
            homingCos: 0.4,
            aaTier: 'ROCKET',
            arvOrder: 1
          } : null)
        : a.aa
          ? bulletGuidanceUniversal(this, a, barrelSide, barrelVert)
          : a.aaOverride === 'off'
            ? null
            : a.df
              ? bulletGuidanceDF(this, a)
              : a.df40
                ? bulletGuidanceDF40II(this, a, barrelSide, barrelVert)
                : a.rd
                  ? bulletGuidanceRD(this, a, barrelSide)
                  : null;
      const dir = guidedInfo ? guidedInfo.dir : (isScatter ? forward(a.yaw + barrelSide * 0.016, clamp(a.pitch + barrelVert * 0.014, -1.31, 1.31)) : camFwd);
      const right = unit(cross(dir, [0, 1, 0]));
      const up = cross(right, dir);
      // Exact 1st-person barrel tip matching renderer.js viewmodel transform (bx=0.205, by=-0.205, bz=0.54 + muzzleOffset)
      const rx1p = (a.df?.ads ? 0 : (.205 - (a.crouch || 0) * .022)) + mOffX + clamp(barrelSide, -1, 1) * (a.gun === DF40II ? .036 : .032);
      const uy1p = (a.df?.ads ? -.075 : -.205) + mOffY + clamp(barrelVert, -1, 1) * .022;
      const fz1p = .54 - mOffZ;
      const muzzle1p = add(p, add(scale(camFwd, fz1p), add(scale(camRight, rx1p), scale(camUp, uy1p))));
      // Exact 3rd-person character barrel tip matching models.js chest-mounted weapon rig
      const muzzle3p = add(p, add(scale(dir, barrelLen3p), add(scale(right, .085 + clamp(barrelSide, -1, 1) * (a.gun === DF40II ? .036 : .034)), scale(up, -.23 + clamp(barrelVert, -1, 1) * .022))));
      const muzzle = a.human ? muzzle1p : muzzle3p;
      if (!firstDir) { firstDir = dir; firstMuzzle = muzzle; }
      const shot = {
        id: ++this.seq,
        owner: a,
        team: a.team,
        gun: a.gun,
        source,
        rocket: isRocket,
        splashDamage: isRocket ? (w.splashDamage || STUN_LAUNCHER_SPLASH_DAMAGE) : 0,
        splashRadius: isRocket ? (w.splashRadius || STUN_LAUNCHER_SPLASH_RADIUS) : 0,
        dir,
        p,
        old: p,
        origin: [...p],
        muzzle: [...muzzle],
        muzzle1p: [...muzzle1p],
        muzzle3p: [...muzzle3p],
        trail: [[...p]],
        trailClock: 0,
        guided: !!guidedInfo?.guided,
        thermalGuidance: !!(a.df?.ads && a.df.scope === 'thermal'),
        homingTargetId: guidedInfo?.targetId ?? -1,
        homingSpawnId: this.actors[guidedInfo?.targetId]?.spawnId,
        homingBudget: guidedInfo ? guidedInfo.homingBudget : 0,
        homingRate: guidedInfo ? guidedInfo.homingRate : 0,
        homingCos: guidedInfo?.homingCos || 0,
        homingTurned: 0,
        aaTier: guidedInfo?.aaTier || null,
        arvOrder: guidedInfo?.arvOrder || 1,
        homingAccel: guidedInfo?.accel || null,
        homingVelWeight: guidedInfo?.velWeight,
        homingAccelWeight: guidedInfo?.accelWeight,
        scherpApn: !!guidedInfo?.scherpApn,
        scherpBank: !!guidedInfo?.scherpBank,
        scherpPen: !!guidedInfo?.scherpPen,
        postRicochetHoming: !!guidedInfo?.postRicochetHoming,
        apnNavConst: guidedInfo?.apnNavConst || 0,
        ricochets: 0,
        penetrations: 0,
        ricocheted: false,
        penetrated: false,
        shafferCloaked: cloaked,
        fermatLocked: !!guidedInfo?.fermatBankLock || this.fermat.isShotFermatAligned(a, dir, this) || !!a._fermatAiShot,
        damage: shotDmg,
        speed: w.speed,
        life: isRocket ? 2.4 : 1.35,
        age: 0,
        whizzed: false
      };
      initShotAero(shot);
      this.chronoTrace.beginShot(shot, this.time);
      this.shots.push(shot);
      // Spawn muzzle flash & drifting smoke puff at exact 3rd-person barrel tip.
      this.effects.push({
        kind: 'muzzle',
        p: muzzle3p,
        dir: [...dir],
        gun: a.gun,
        team: a.team,
        source,
        aaTier: guidedInfo?.aaTier || null,
        shafferCloaked: cloaked,
        actor: a.id,
        human: a.human,
        life: (a.gun === 'MS10' || isRocket) ? .15 : .12,
        max: (a.gun === 'MS10' || isRocket) ? .15 : .12,
        seed: this.seq
      });
      // Eject spinning brass / thermal cartridge casing from right ejection port.
      if (!isRocket) {
        const port = add(p, add(scale(dir, .36), add(scale(right, (a.human ? .22 : .18) + barrelSide * .02), scale(up, a.human ? -.13 : -.18))));
        const spreadR = 1.6 + this.rng() * 1.3, spreadU = 1.1 + this.rng() * .95, spreadF = -.35 + (this.rng() - .5) * .6;
        this.casings.push({
          p: port,
          v: add(add(scale(right, spreadR), scale(up, spreadU)), scale(dir, spreadF)),
          rot: this.rng() * 6.28,
          spin: (this.rng() > .5 ? 1 : -1) * (14 + this.rng() * 16),
          gun: a.gun,
          team: a.team,
          shafferCloaked: cloaked,
          life: .95,
          bounced: false
        });
        if (this.casings.length > 42)this.casings.shift();
      }
    }
    this.telemetry.onFire(a, salvo);
    if (a.df40) onFireDF40II(this, a, salvo);
    if (!cloaked) {
      this.echoPulse.emit(this, {
        kind: 'fire',
        pos: firstMuzzle || p,
        actor: a,
        team: a.team,
        loudness: (a.gun === 'MS10' || isRocket) ? 1.25 : a.gun === DF40II ? 1.18 : a.gun === RD ? 1.12 : 1.0,
        gun: a.gun
      });
      if (firstMuzzle && firstDir) {
        this.aeroVortex.injectSmoke(firstMuzzle[0], firstMuzzle[2], 0.11, 0.18, 1, firstDir[0] * 1.3, firstDir[2] * 1.3);
        this.thermoFlux.depositHeat(a.x, a.z, 0.14, 0);
      }
      this.nv.onShotFired?.(a, source);
    }
    this.event('fire', {actor: a, source, gun: a.gun, p: firstMuzzle, dir: firstDir, speed: w.speed, pellets: salvo, burstIndex: a.shotCount, aa14: firedAA14, scherp: firedScherp, shafferCloaked: cloaked});
    if (a.stunLauncher && a.stunLauncher.shotsLeft <= 0) {
      this.revertStunLauncher(a);
    } else if (a.mag <= 0 && !a.queue.length && a.stock > 0 && a.reload <= 0) {
      this.reload(a, true);
    }
    return true;
  }
  deploySmokeVent(a = this.player) {
    if (!a?.alive || this.ended) return false;
    if (a.human ? this.smokeCooldown > 0.01 : (a.smokeCooldown || 0) > 0.01) return false;
    const fx = Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    const from = [a.x, a.y + .45, a.z];
    const to = [clamp(a.x + fx * 3.4, -24, 24), from[1], clamp(a.z + fz * 3.4, -98, 98)];
    const wall = obstruction(from, to);
    const [sx, , sz] = wall <= 1 ? add(from, scale(sub(to, from), Math.max(0, wall - .16))) : to;
    this.aeroVortex.deploySmokeVent(sx, sz, fx, fz);
    this.thermoFlux.depositHeat(sx, sz, 0.45, 2);
    if (a.human) this.smokeCooldown = 10.0;
    else a.smokeCooldown = 14.0;
    this.echoPulse.emit(this, {kind: 'smoke', pos: [sx, 1.2, sz], actor: a, team: a.team, loudness: 0.72});
    this.event('smoke', {actor: a, point: [sx, 1.0, sz]});
    return true;
  }
  issueSquadOrder(kind, a = this.player) {
    if (!a?.alive || this.ended) return null;
    return this.nv?.issuePlayerSquadOrder?.(kind, a) || null;
  }
  damage(v, owner, power, dir = null, meta = null) {
    if (this.ended || !v.alive || !owner || (!meta?.ignoreTeam && !owner.isHeli && !this.areHostile(owner, v)) || !Number.isFinite(power) || power <= 0) return null;
    const hadBaizer = (v.baizerShield || 0) > 0;
    const baizerAbsorbed = Math.min(v.baizerShield || 0, power);
    v.baizerShield = Math.max(0, Math.round(((v.baizerShield || 0) - baizerAbsorbed) * 10) / 10);
    if (v.baizerShield <= 0) v.baizerMax = 0;
    const baizerBreak = hadBaizer && v.baizerShield <= 0;
    const afterBaizer = Math.max(0, Math.round((power - baizerAbsorbed) * 10) / 10);
    const hadShield = v.shield > 0;
    const absorbed = Math.min(v.shield, afterBaizer);
    v.shield = Math.max(0, Math.round((v.shield - absorbed) * 10) / 10);
    const hpLoss = Math.max(0, Math.round((afterBaizer - absorbed) * 10) / 10);
    v.hp = Math.max(0, Math.round((v.hp - hpLoss) * 10) / 10);
    const shieldBreak = hadShield && v.shield <= 0;
    const anyShieldHit = baizerAbsorbed > 0 || absorbed > 0;
    const anyShieldBreak = baizerBreak || shieldBreak;
    const kill = v.hp <= 0;
    if (hpLoss > 0) this.spawnBloodSplatter(v, meta?.point, dir, hpLoss, kill);
    if (!owner.isHeli) this.telemetry.onHit(owner, v, power, {baizerAbsorbed, kill, shot: meta?.shot, time: meta?.time ?? this.time});
    if (meta?.shot) {
      const outcome = kill ? 'kill' : anyShieldBreak ? 'break' : anyShieldHit ? 'shield' : 'hit';
      this.chronoTrace.finishShot(meta.shot, meta.point, outcome, meta.time, v);
    } else if (kill && v.human) {
      this.chronoTrace.lastPlayerDeathTrace = null;
    }
    v.hitRecoil = Math.min(1, (v.hitRecoil || 0) + .58 + power * .038);
    v.hitFlash = 1;
    if (baizerAbsorbed > 0) v.baizerFlash = 1;
    if (absorbed > 0) v.shieldFlash = 1;
    if (dir) v.hitDir = [...dir];
    if (meta?.ricochet) this.techStats.ricochetHits++;
    if (meta?.wallbang) this.techStats.wallbangHits++;
    if (anyShieldBreak) {
      this.aeroVortex.injectBurst(v.x, v.z, {smoke: 0.95, heat: 1.12, force: 3.6, radius: 2});
      this.thermoFlux.depositHeat(v.x, v.z, 0.85, 2);
      this.resonance.exciteBlast([v.x, v.y + 1.0, v.z], 0.78);
    }
    if (!v.isDrone) this.nv.learn(v, false);
    this.nv.onHit?.(v, owner, dir, power, anyShieldBreak);
    this.event('hit', {
      victim: v,
      actor: owner,
      shield: anyShieldHit,
      shieldBreak,
      baizer: baizerAbsorbed > 0,
      baizerBreak,
      kill,
      hpLoss,
      damage: power,
      dir,
      ricochet: !!meta?.ricochet,
      wallbang: !!meta?.wallbang,
      scherp: meta?.shot?.aaTier === '1.5'
    });
    if (!kill) return {shield: absorbed > 0, shieldBreak, baizer: baizerAbsorbed > 0, baizerBreak, kill: false};
    this.aeroVortex.injectBurst(v.x, v.z, {smoke: 1.35, heat: 0.92, force: 4.8, radius: 3});
    this.thermoFlux.depositHeat(v.x, v.z, 1.15, 2);
    this.resonance.exciteBlast([v.x, v.y + 1.0, v.z], 1.15);
    v.alive = false;
    v.deathAt = this.time;
    if (v.isH1Zonbi) {
      v.lives = Math.max(0, (v.lives || 1) - 1);
      if (v.lives > 0) {
        v.noRespawn = false;
        v.vanished = false;
        v.respawn = this.respawnDuration;
        this.event('h1ZonbiRespawn', {actor: v, livesLeft: v.lives});
      } else {
        v.noRespawn = true;
        v.vanished = true;
        v.respawn = Infinity;
        this.event('h1ZonbiDefeated', {actor: v, killer: owner});
      }
    } else {
      v.respawn = v.noRespawn ? Infinity : this.respawnDuration;
      if (v.noRespawn) v.vanished = true;
    }
    if (v.isZombie && !v.isH1Zonbi && !this.isZombieChallenge) v.zombiePoolReady = true;
    v.reload = 0;
    v.autoReloading = false;
    v.burstLeft = 0;
    v.queue.length = 0;
    v.shafferTimer = 0;
    v.flowTimer = 0;
    if (v.stunLauncher) this.revertStunLauncher(v);
    if (v.inMech) this.revertMech(v);
    v.baizerShield = 0;
    v.baizerMax = 0;
    v.baizerFlash = 0;
    if (v.aa) {
      v.aa.locked = false;
      v.aa.wallActive = false;
      v.aa.occluded = false;
      v.aa.focus = 0;
      v.aa.focusId = -1;
      v.aa.wallTimer = 0;
      v.aa.solveMode = 'none';
      v.aa.activeBank = null;
      v.aa.est?.reset();
    }
    if (v.df) {
      v.df.ads = false;
      v.df.locked = false;
      v.df.focus = 0;
      v.df.focusId = -1;
      v.df.boost = false;
    }
    if (v.rd) {
      v.rd.locked = false;
      v.rd.d01Active = false;
      v.rd.occluded = false;
      v.rd.focus = 0;
      v.rd.focusId = -1;
      v.rd.d01Timer = 0;
    }
    if (v.df40) {
      v.df40.aa14Active = false;
      v.df40.locked = false;
      v.df40.d01Active = false;
      v.df40.occluded = false;
      v.df40.focus = 0;
      v.df40.focusId = -1;
      v.df40.d01Timer = 0;
    }
    v.deaths++;
    const nonScoreVictim = !!(v.isReinforcement || v.isDrone);
    const validTeamOwner = owner && !owner.isHeli && (owner.team === 0 || owner.team === 1);
    if (!nonScoreVictim && validTeamOwner) {
      owner.kills++;
      if (owner.assignedSkill && (owner.skillCharges || 0) < MAX_SKILL_CHARGES) {
        owner.skillKills = (owner.skillKills || 0) + 1;
        if (owner.skillKills >= KILLS_PER_SKILL_CHARGE) {
          owner.skillKills -= KILLS_PER_SKILL_CHARGE;
          owner.skillCharges = Math.min(MAX_SKILL_CHARGES, (owner.skillCharges || 0) + 1);
          this.event('skill_charge', {actor: owner, skill: owner.assignedSkill, charges: owner.skillCharges});
        }
      }
      if (owner.human) owner.earned += 10;
    }
    if (validTeamOwner && !owner.isDrone) this.nv.learn(owner, true);
    if (validTeamOwner) this.nv.onKill?.(owner, v);
    if (!nonScoreVictim && validTeamOwner && !v.hostileAll) {
      if (v.isZombie && this.isZombie) {
        this.zombieKills++;
        this.scores[0] = this.zombieKills;
      } else if (!this.isZombieChallenge) {
        this.scores[owner.team]++;
      }
      this.event('point', {actor: owner, victim: v, receipt: this.receiptId + '/' + owner.id + '/' + owner.kills});
    }
    if (this.isZombie && v.human) {
      this.end(1);
    } else if (this.isZombieChallenge) {
      let huntersAlive = 0;
      for (let i = 0; i < this.actors.length; i++) {
        const a = this.actors[i];
        if (a.alive && a.team === 1) huntersAlive++;
      }
      if (huntersAlive === 0) {
        this.zombieChallengeSurvival = this.time;
        this.computeZombieChallengeRanking();
        this.end(0);
      } else if (v.human) {
        this.zombieChallengeSurvival = this.time;
        this.computeZombieChallengeRanking();
        this.end(1);
      }
    } else if (this.isBR) {
      let alive0 = 0, alive1 = 0;
      for (let i = 0; i < this.actors.length; i++) {
        const a = this.actors[i];
        if (!a.alive || a.isDrone || a.hostileAll) continue;
        if (a.team === 0) alive0++;
        else alive1++;
      }
      if (alive0 === 0) this.end(1);
      else if (alive1 === 0) this.end(0);
      else if (v.human) {
        this.spectating = true;
        this.event('brSpectate', {actor: v});
      }
    } else if (!nonScoreVictim && validTeamOwner && !v.hostileAll && this.scores[owner.team] >= this.goals[owner.team]) {
      this.end(owner.team);
    }
    return {shield: absorbed > 0, shieldBreak, baizer: baizerAbsorbed > 0, baizerBreak, kill: true}
  }
  detonateRocket(s, impactPos, directVictim, impactTime) {
    const r = s.splashRadius || STUN_LAUNCHER_SPLASH_RADIUS;
    const dmg = s.splashDamage || STUN_LAUNCHER_SPLASH_DAMAGE;
    const r2 = r * r;
    const px = impactPos[0], py = impactPos[1], pz = impactPos[2];
    this.effects.push({
      kind: 'rocketBlast',
      p: [px, py, pz],
      dir: [0, 1, 0],
      radius: r,
      team: s.team,
      actor: s.owner.id,
      life: .52,
      max: .52,
      seed: ++this.seq
    });
    this.aeroVortex.injectBurst(px, pz, {smoke: 1.15, heat: 1.35, force: 5.2, radius: 2});
    this.thermoFlux.depositHeat(px, pz, 1.25, 2);
    this.resonance.exciteBlast([px, Math.max(0.2, py), pz], 1.1);
    const actors = this.actors;
    for (let i = 0; i < actors.length; i++) {
      const e = actors[i];
      if (!e.alive || e.team === s.team || e === directVictim) continue;
      const dx = e.x - px, dz = e.z - pz;
      const cy = clamp(py, e.y, e.y + 1.65);
      const dy = cy - py;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= r2) {
        const d = Math.sqrt(d2) || 1;
        this.damage(e, s.owner, dmg, [dx / d, dy / d, dz / d], {shot: s, point: [px, py, pz], time: impactTime, splash: true});
      }
    }
    this.event('rocketBlast', {actor: s.owner, point: [px, py, pz], radius: r, splashDamage: dmg});
  }
  damageGasPipe(pipe, power, owner) {
    if (!pipe || !pipe.alive || this.ended || !Number.isFinite(power) || power <= 0) return false;
    pipe.hp = Math.max(0, Math.round((pipe.hp - power) * 10) / 10);
    pipe.hitFlash = 1;
    if (pipe.hp > 0) return false;
    pipe.alive = false;
    pipe.cooldown = pipe.maxCooldown || GAS_PIPE_RESPAWN;
    const px = pipe.x, py = 1.0, pz = pipe.z;
    const r = GAS_PIPE_RADIUS, r2 = r * r;
    this.effects.push({
      kind: 'gasBlast',
      p: [px, py, pz],
      dir: [0, 1, 0],
      radius: r,
      team: owner?.team ?? 0,
      actor: owner?.id ?? -1,
      life: .85,
      max: .85,
      seed: ++this.seq
    });
    this.aeroVortex.injectBurst(px, pz, {smoke: 1.8, heat: 1.8, force: 7.5, radius: 3});
    this.thermoFlux.depositHeat(px, pz, 1.8, 3);
    this.resonance.exciteBlast([px, py, pz], 1.6);
    const actors = this.actors;
    const hitIds = [];
    for (let i = 0; i < actors.length; i++) {
      const e = actors[i];
      if (!e.alive) continue;
      const dx = e.x - px, dz = e.z - pz;
      const dy = (e.y + 0.9) - py;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= r2) {
        const d = Math.sqrt(d2) || 1;
        this.damage(e, owner || e, GAS_PIPE_DAMAGE, [dx / d, dy / d, dz / d], {ignoreTeam: true, gasPipe: true, point: [px, py, pz]});
        hitIds.push(e.id);
      }
    }
    this.event('gasPipeBlast', {actor: owner, pipe, point: [px, py, pz], radius: r, damage: GAS_PIPE_DAMAGE, hitIds});
    return true;
  }
  updateGasPipes(dt) {
    const pipes = this.gasPipes;
    if (!pipes || !pipes.length) return;
    for (let i = 0; i < pipes.length; i++) {
      const p = pipes[i];
      if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt * 4.5);
      if (!p.alive && p.cooldown > 0) {
        p.cooldown = p.cooldown <= dt + 1e-8 ? 0 : p.cooldown - dt;
        if (p.cooldown === 0) {
          const avoid = [...(this.ammoBoxes || []), ...pipes.filter(o => o !== p)];
          const [nx, nz] = randomAmmoBoxPos(this.ammoRng, avoid);
          p.x = nx;
          p.z = nz;
          p.hp = p.maxHp || GAS_PIPE_HP;
          p.alive = true;
        }
      }
    }
  }
  end(winner = null) {
    if (this.ended) return;
    this.winner = winner;
    this.ended = true;
    this.shots.length = 0;
    this.synapse?.save();
    this.nv.onMatchEnd?.();
    this.event('end', {winner});
  }

  updateTankers(dt) {
    const actors = this.actors;
    for (let ti = 0; ti < this.tankers.length; ti++) {
      const tk = this.tankers[ti];
      if (tk.cooldown > 0) tk.cooldown = tk.cooldown <= dt + 1e-8 ? 0 : tk.cooldown - dt;
      if (tk.pulse > 0) tk.pulse = Math.max(0, tk.pulse - dt * 1.4);
      if (tk.cooldown > 0) continue;
      let recipient = null, best2 = tk.radius * tk.radius;
      const tx = tk.x, tz = tk.z;
      for (let ai = 0; ai < actors.length; ai++) {
        const a = actors[ai];
        if (!a.alive || a.y > 1.2) continue;
        const dx = a.x - tx, dz = a.z - tz;
        const d2 = dx * dx + dz * dz;
        if (d2 <= best2 && (!recipient || d2 < best2)) {
          recipient = a;
          best2 = d2;
        }
      }
      if (recipient) {
        const a = recipient;
        a.stock += 100;
        a.ammoRate = 1.5;
        a.tankerUses = (a.tankerUses || 0) + 1;
        tk.cooldown = tk.maxCooldown;
        tk.pulse = 1;
        tk.lastTeam = a.team;
        this.effects.push({
          kind: 'tanker',
          p: [tk.x, 1.55, tk.z],
          dir: [0, 1, 0],
          actor: a.id,
          team: a.team,
          life: .95,
          max: .95,
          seed: ++this.seq
        });
        this.aeroVortex.injectBurst(tk.x, tk.z, {smoke: 1.95, heat: 0.72, force: 4.5, radius: 3});
        this.thermoFlux.depositHeat(tk.x, tk.z, 0.75, 2);
        this.resonance.exciteBlast([tk.x, 1.5, tk.z], 1.1);
        this.spectraField.observe(1 - a.team, tk.x, tk.z, {sigma: 5.5, weight: 0.78});
        this.echoPulse.emit(this, {kind: 'tanker', pos: [tk.x, 1.8, tk.z], actor: a, team: a.team, loudness: 1.4});
        if (a.human) this.synapse?.observeTankerCapture();
        this.event('tanker', {actor: a, tanker: tk});
        this.nv.onTanker?.(a, tk);
      }
    }
  }
  updateBaizers(dt) {
    const actors = this.actors;
    for (let bi = 0; bi < this.baizers.length; bi++) {
      const bz = this.baizers[bi];
      if (bz.cooldown > 0) bz.cooldown = bz.cooldown <= dt + 1e-8 ? 0 : bz.cooldown - dt;
      if (bz.pulse > 0) bz.pulse = Math.max(0, bz.pulse - dt * 1.5);
      if (bz.cooldown > 0) continue;
      let recipient = null, best2 = 1.95 * 1.95;
      const bx = bz.x, bzZ = bz.z;
      for (let ai = 0; ai < actors.length; ai++) {
        const a = actors[ai];
        if (!a.alive || a.y > 1.2 || a.maxShield === 0) continue;
        if ((a.baizerShield || 0) >= BAIZER_MAX_STACK) continue;
        const dx = a.x - bx, dz = a.z - bzZ;
        const d2 = dx * dx + dz * dz;
        if (d2 <= best2 && (!recipient || d2 < best2)) {
          recipient = a;
          best2 = d2;
        }
      }
      if (recipient) {
        const before = recipient.baizerShield || 0;
        const after = Math.min(BAIZER_MAX_STACK, Math.round((before + bz.amount) * 10) / 10);
        const gained = Math.round((after - before) * 10) / 10;
        recipient.baizerShield = after;
        recipient.baizerMax = BAIZER_MAX_STACK;
        recipient.baizerFlash = 1;
        bz.cooldown = bz.maxCooldown;
        bz.pulse = 1;
        this.effects.push({
          kind: 'baizerPickup',
          p: [bz.x, .85, bz.z],
          dir: [0, 1, 0],
          actor: recipient.id,
          team: recipient.team,
          amount: bz.amount,
          life: .85,
          max: .85,
          seed: ++this.seq
        });
        this.event('baizer', {actor: recipient, pickup: bz, kind: bz.kind, amount: bz.amount, gained, total: after});
      }
    }
  }
  updateAmmoBoxes(dt) {
    const boxes = this.ammoBoxes;
    if (!boxes || !boxes.length) return;
    const actors = this.actors;
    for (let bi = 0; bi < boxes.length; bi++) {
      const box = boxes[bi];
      if (box.cooldown > 0) {
        box.cooldown = box.cooldown <= dt + 1e-8 ? 0 : box.cooldown - dt;
        if (box.cooldown === 0) {
          const others = boxes.filter(o => o !== box);
          const [nx, nz] = randomAmmoBoxPos(this.ammoRng, others);
          box.x = nx;
          box.z = nz;
        }
      }
      if (box.pulse > 0) box.pulse = Math.max(0, box.pulse - dt * 1.5);
      if (box.cooldown > 0) continue;
      let recipient = null, best2 = 1.95 * 1.95;
      const bx = box.x, bz = box.z;
      for (let ai = 0; ai < actors.length; ai++) {
        const a = actors[ai];
        if (!a.alive || a.y > 1.2) continue;
        const w = this.weapon(a);
        const stockCap = w.stockCap || 100;
        if (a.stock >= stockCap && a.mag >= w.capacity) continue;
        const dx = a.x - bx, dz = a.z - bz;
        const d2 = dx * dx + dz * dz;
        if (d2 <= best2 && (!recipient || d2 < best2)) {
          recipient = a;
          best2 = d2;
        }
      }
      if (recipient) {
        const w = this.weapon(recipient);
        const stockCap = w.stockCap || 100;
        const room = Math.max(0, stockCap - recipient.stock);
        const toStock = Math.min(box.amount, room);
        recipient.stock += toStock;
        let gained = toStock;
        const rem = box.amount - toStock;
        if (rem > 0 && recipient.mag < w.capacity) {
          const toMag = Math.min(rem, w.capacity - recipient.mag);
          recipient.mag += toMag;
          gained += toMag;
        }
        box.cooldown = box.maxCooldown;
        box.pulse = 1;
        this.effects.push({
          kind: 'ammoPickup',
          p: [box.x, .65, box.z],
          dir: [0, 1, 0],
          actor: recipient.id,
          team: recipient.team,
          amount: box.amount,
          life: .85,
          max: .85,
          seed: ++this.seq
        });
        this.event('ammoBox', {actor: recipient, box, amount: box.amount, gained, stock: recipient.stock, mag: recipient.mag});
      }
    }
  }
  spawnZombie() {
    this.zombieSpawned++;
    const num = this.zombieSpawned;
    const [sx, sz] = ZOMBIE_SPAWN_POINT;
    let z = null;
    for (let i = 0; i < this.actors.length; i++) {
      const cand = this.actors[i];
      if (cand.isZombie && !cand.alive && cand.zombiePoolReady) {
        z = cand;
        break;
      }
    }
    if (!z) {
      z = {
        id: this.actors.length,
        team: 1,
        slot: this.actors.length,
        human: false,
        name: `Z-${num}`,
        gun: 'SW T',
        aiVersion: 'ZOMBIE',
        isSpy: false,
        isZombie: true,
        noRespawn: true,
        zombiePoolReady: false,
        aaOverride: null,
        assignedSkill: null,
        maxHp: ZOMBIE_HP,
        maxShield: 0,
        _spawnPos: [sx, sz],
        kills: 0,
        deaths: 0,
        earned: 0
      };
      this.actors.push(z);
    } else {
      z.name = `Z-${num}`;
      z.zombiePoolReady = false;
      z.vanished = false;
      z.maxHp = ZOMBIE_HP;
      z.maxShield = 0;
      z._spawnPos = [sx, sz];
    }
    this.spawn(z, true);
    z.x = sx;
    z.z = sz;
    z.yaw = Math.PI;
    z.meleeCooldown = 0;
    return z;
  }
  updateZombies(dt) {
    if (this.ended) return;
    const actors = this.actors;
    let aliveZombies = 0;
    const callers = [];
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (!a.isZombie || !a.alive) continue;
      if (!a.armedZombie) aliveZombies++;
      if (a.zombieRole === 'caller') callers.push(a);
    }
    if (this.isZombie) {
      this.zombieSpawnClock += dt * ZOMBIE_SPAWN_RATE;
      while (this.zombieSpawnClock + 1e-8 >= 1) {
        this.zombieSpawnClock -= 1;
        if (aliveZombies < ZOMBIE_MAX_ALIVE) {
          this.spawnZombie();
          aliveZombies++;
        }
      }
    } else if (this.isZombieChallenge) {
      this.zombieSpawnClock += dt * ZOMBIE_CHALLENGE_SPAWN_RATE;
      while (this.zombieSpawnClock + 1e-8 >= 1) {
        this.zombieSpawnClock -= 1;
        if (aliveZombies < ZOMBIE_CHALLENGE_MAX_ALIVE) {
          this.spawnZombieChallengeUnit(null);
          aliveZombies++;
        }
      }
    }
    const probeAngles = [0, 0.58, -0.58, 1.25, -1.25];
    for (let i = 0; i < actors.length; i++) {
      const z = actors[i];
      if (!z.isZombie || !z.alive || z.human || z.armedZombie) continue;
      if (z.meleeCooldown > 0) z.meleeCooldown = Math.max(0, z.meleeCooldown - dt);
      let target = null, bestD2 = Infinity;
      for (let j = 0; j < actors.length; j++) {
        const t = actors[j];
        if (!t.alive || t.isDrone || !this.areHostile(z, t)) continue;
        const dx = t.x - z.x, dz = t.z - z.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; target = t; }
      }
      if (!target) continue;
      const role = ZOMBIE_ROLES[z.zombieRole] || null;
      const dx = target.x - z.x, dz = target.z - z.z;
      const dist = Math.sqrt(bestD2) || 1e-4;
      let baseYaw = Math.atan2(dx, -dz);
      // NV2.7 ZONBI 4-role pack coordination: stalkers flank wide, callers coordinate surround arcs, pack encircles target!
      if (role && dist > 3.2 && dist < 34) {
        const sideSign = (z.id & 1) ? 1 : -1;
        if (role.flankAngle) baseYaw += role.flankAngle * sideSign * clamp((dist - 3.2) / 16, 0.15, 0.72);
        else if (dist < 10) baseYaw += ((z.id % 5) - 2) * 0.22;
      }
      let steerYaw = baseYaw;
      for (let p = 0; p < probeAngles.length; p++) {
        const cand = baseYaw + probeAngles[p];
        const px = z.x + Math.sin(cand) * 1.15;
        const pz = z.z - Math.cos(cand) * 1.15;
        if (walkable(px, pz, 0.38, z.y)) {
          steerYaw = cand;
          break;
        }
      }
      z.yaw = steerYaw;
      let speedMult = role ? role.speedMult : 1.0;
      if (callers.length > 0 && z.zombieRole !== 'caller') {
        for (let ci = 0; ci < callers.length; ci++) {
          const c = callers[ci];
          if (c.team === z.team && Math.hypot(c.x - z.x, c.z - z.z) <= (ZOMBIE_ROLES.caller.rallyRadius || 14)) {
            speedMult *= (ZOMBIE_ROLES.caller.rallyBoost || 1.12);
            break;
          }
        }
      }
      const zSpd = ZOMBIE_SPEED * speedMult;
      const vx = Math.sin(steerYaw) * zSpd;
      const vz = -Math.cos(steerYaw) * zSpd;
      const k = 1 - Math.exp(-10 * dt);
      z.vx += (vx - z.vx) * k;
      z.vz += (vz - z.vz) * k;
      const ox = z.x, oz = z.z;
      moveActor(z, z.vx * dt, z.vz * dt);
      z.stride += Math.hypot(z.x - ox, z.z - oz);
      vertical(z, dt, floorAt, this.gravityScale || 1);
      const mRange = role ? role.meleeRange : ZOMBIE_MELEE_RANGE;
      const mDmg = role ? role.meleeDmg : ZOMBIE_MELEE_DAMAGE;
      const mCd = role ? role.meleeCd : ZOMBIE_MELEE_COOLDOWN;
      if (dist <= mRange && Math.abs(target.y - z.y) <= 1.8 && z.meleeCooldown <= 0) {
        z.meleeCooldown = mCd;
        z.recoil = 0.8;
        this.damage(target, z, mDmg, [dx / dist, 0, dz / dist], {melee: true, point: [target.x, target.y + 1.0, target.z]});
      }
    }
  }
  updatePlayer(dt, input) {
    const a = this.player;
    if (!a?.alive || !a.human) return;
    const u = input || {};
    postureStep(a, dt, !!u.crouch && a.onGround, 0, !!a.df?.ads);
    const cx = Math.cos(a.yaw),
      sx = Math.sin(a.yaw),
      h = clamp(u.side || 0, -1, 1),
      f = clamp(u.forward || 0, -1, 1),
      n = Math.max(1, Math.hypot(h, f)),
      roleSpeed = (a.isZombie && a.zombieRole && ZOMBIE_ROLES[a.zombieRole]) ? ZOMBIE_ROLES[a.zombieRole].speedMult : 1,
      speed = (u.sprint ? 6.75 : 4.68) * roleSpeed * (1 - a.crouch * .46) * (a.df?.ads ? .68 : 1);
    const vx = (cx * h + sx * f) / n * speed, vz = (sx * h - cx * f) / n * speed, e = 1 - Math.exp(-(a.onGround ? 14 : 4.5) * dt);
    a.vx += (vx - a.vx) * e;
    a.vz += (vz - a.vz) * e;
    const x = a.x, z = a.z;
    moveActor(a, a.vx * dt, a.vz * dt);
    a.stride += Math.hypot(a.x - x, a.z - z);
    if (u.jump && a.onGround) {
      a.vy = 5.35;
      a.onGround = false;
    }
    vertical(a, dt, floorAt, this.gravityScale || 1);
  }
  _syncExpCache(dt) {
    if (this._lastExpDt !== dt) {
      this._lastExpDt = dt;
      this._kSmooth16 = 1 - Math.exp(-16 * dt);
      this._kAir18 = 1 - Math.exp(-18 * dt);
      this._kLand95 = Math.exp(-9.5 * dt);
      this._kSprint12 = 1 - Math.exp(-12 * dt);
    }
  }
  systems(a, dt) {
    if (!a.alive) {
      if (a.noRespawn) return;
      a.respawn -= dt;
      if (a.respawn <= 1e-7) {
        this.spawn(a);
        if (a.isH1Zonbi) {
          const aliveDrones = this.actors.filter(u => u.alive && u.isDrone && u.ownerId === a.id).length;
          for (let k = aliveDrones; k < H1_ZONBI_DRONES; k++) {
            this.spawnEscortDrone(a, {tag: `H1-DRONE-${k + 1}`});
          }
        }
      }
      return
    }
    if (a.flash > 0) a.flash = a.flash > dt ? a.flash - dt : 0;
    if (a.recoil > 0) a.recoil = Math.max(0, a.recoil - dt * 6.5);
    if (a.hitRecoil > 0) a.hitRecoil = Math.max(0, a.hitRecoil - dt * 4.2);
    if (a.seismicRattle > 0) a.seismicRattle = Math.max(0, a.seismicRattle - dt * 1.4);
    if (a.hitFlash > 0) a.hitFlash = Math.max(0, a.hitFlash - dt * 5.2);
    if (a.shieldFlash > 0) a.shieldFlash = Math.max(0, a.shieldFlash - dt * 4.2);
    if (a.baizerFlash > 0) a.baizerFlash = Math.max(0, a.baizerFlash - dt * 3.8);
    if ((a.shafferTimer || 0) > 0) {
      a.shafferTimer = a.shafferTimer <= dt + 1e-8 ? 0 : a.shafferTimer - dt;
    }
    if ((a.flowTimer || 0) > 0) {
      a.flowTimer = a.flowTimer <= dt + 1e-8 ? 0 : a.flowTimer - dt;
    }
    if (a.inMech && (a.mechTimer || 0) > 0) {
      a.mechTimer -= dt;
      if (a.mechTimer <= 1e-8) this.revertMech(a);
    }
    if (a.stunLauncher) this.findLauncherTarget(a);
    if (a.cooldown > 0) a.cooldown = a.cooldown > dt ? a.cooldown - dt : 0;
    if (a.smokeCooldown > 0) a.smokeCooldown = a.smokeCooldown > dt ? a.smokeCooldown - dt : 0;
    // 60Hz exact-dt coalesced body-frame visual rig smoothing (0 Math.sin/cos/sqrt on 5/6 substeps; exact gameplay parity!)
    a._visAccum = (a._visAccum || 0) + dt;
    if (a._visAccum >= (1 / 60 - 1e-6) || dt >= (1 / 60 - 1e-6)) {
      const vdt = a._visAccum;
      a._visAccum = 0;
      this._syncExpCache(vdt);
      const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
      const localFwd = a.vx * sy - a.vz * cy;
      const localSide = a.vx * cy + a.vz * sy;
      const hSpd = Math.sqrt(a.vx * a.vx + a.vz * a.vz);
      const kSmooth = this._kSmooth16;
      a.fwdVel = (a.fwdVel || 0) + (clamp(localFwd * (1 / 4.6), -1.2, 1.55) - (a.fwdVel || 0)) * kSmooth;
      a.sideVel = (a.sideVel || 0) + (clamp(localSide * (1 / 4.6), -1.2, 1.2) - (a.sideVel || 0)) * kSmooth;
      const airTarget = a.onGround ? 0 : 1;
      a.airBlend = (a.airBlend || 0) + (airTarget - (a.airBlend || 0)) * this._kAir18;
      if (a.landCompress > 0) a.landCompress = Math.max(0, a.landCompress * this._kLand95 - vdt * 0.35);
      const sprintTarget = a.onGround && a.crouch < 0.25 && hSpd > 4.65 && localFwd > 2.2 ? clamp((hSpd - 4.4) * (1 / 1.4), 0, 1) : 0;
      a.sprintAmt = (a.sprintAmt || 0) + (sprintTarget - (a.sprintAmt || 0)) * this._kSprint12;
    }
    const w = this.weapon(a);
    const wReload = w.reload;
    const maxShield = a.maxShield !== undefined ? a.maxShield : BASE_SHIELD_MAX;
    if (a.shield < maxShield) {
      a.shieldClock += dt;
      while (a.shieldClock + 1e-8 >= 5 && a.shield < maxShield) {
        a.shield = Math.min(maxShield, a.shield + 1);
        a.shieldClock = Math.max(0, a.shieldClock - 5);
      }
      if (a.shield >= maxShield) a.shieldClock = 0;
    } else a.shieldClock = 0;
    const stockCap = w.stockCap || 100;
    const stockRegen = w.stockRegen || 1;
    if (a.stunLauncher) {
      a.ammoClock = 0;
    } else if (this.infiniteAmmo) {
      a.stock = Math.max(a.stock, stockCap);
      a.mag = Math.max(a.mag, w.capacity);
      a.ammoClock = 0;
    } else if (a.stock < stockCap) {
      a.ammoClock += dt * stockRegen * (a.ammoRate || 1);
      while (a.ammoClock + 1e-8 >= 1 && a.stock < stockCap) {
        a.stock = Math.min(stockCap, a.stock + 1);
        a.ammoClock = Math.max(0, a.ammoClock - 1);
      }
      if (a.stock >= stockCap) a.ammoClock = 0;
    } else a.ammoClock = 0;
    if (a.aa) {
      updateUniversalAA(this, a, dt);
      if (a.df) {
        const d = a.df;
        if (d.p1 < 20) {
          d.p1Clock += dt * (a.ammoRate || 1);
          if (d.p1Clock + 1e-8 >= 8) { d.p1++; d.p1Clock = Math.max(0, d.p1Clock - 8); }
        } else d.p1Clock = 0;
        if (d.cooling > 0) { d.cooling = Math.max(0, d.cooling - dt); d.heat = d.cooling * 20; }
        else if (this.time - d.lastBoost > 1.15) d.heat = Math.max(0, d.heat - 11 * dt);
      }
    } else if (a.aaOverride !== 'off') {
      if (a.df)updateDF(this, a, dt);
      if (a.rd)updateRD(this, a, dt);
      if (a.df40)updateDF40II(this, a, dt);
    }
    if (a.burstLeft) {
      if (a.df && (!a.df.boost || a.df.cooling > 0 || !a.df.p1)) {
        a.queue = a.queue.filter(source => source !== 'p1');
        a.burstLeft = a.queue.length;
      }
      a.nextBurst -= dt;
      if (a.burstLeft && a.nextBurst <= 1e-7) {
        this.fire(a, a.queue.shift());
        a.burstLeft = a.queue.length;
        a.nextBurst += w.interval
      }
    }
    if (a.mag <= 0 && !a.burstLeft && a.reload <= 0 && a.stock > 0) {
      this.reload(a, true);
    }
    if (a.reload > 0) {
      a.reload -= dt;
      if (a.reload <= 1e-7) {
        const take = Math.min(w.capacity - a.mag, a.stock);
        a.stock -= take;
        a.mag += take;
        a.reload = 0;
        a.autoReloading = false;
        this.event('loaded', {actor: a})
      }
    }
    a.reloadFrac = a.reload > 0 ? clamp(1 - a.reload / wReload, 0, 1) : 0;
  }
  beginPenetration(s, ball, normal, mat, time) {
    const entry = ball.entryPos;
    s.materialPass = {ball, normal, mat, time, remaining: ball.thickness / ((s.speed + ball.speed) * .5)};
    s.guided = false;
    this.effects.push({
      kind: 'wall', p: [...entry], dir: [...s.dir], normal, gun: s.gun, source: s.source,
      team: s.team, metal: mat === 'steel', mat, life: .34, max: .34, actor: s.owner.id, target: false, seed: ++this.seq
    });
    this.scorches.push({
      p: add(entry, scale(normal, .014)), normal, mat, gun: s.gun, source: s.source,
      life: 1.85, max: 1.85, seed: this.seq
    });
    if (this.scorches.length > 26) this.scorches.shift();
    if (mat === 'steel') {
      const resHit = this.resonance.exciteStrike(entry, 0.9, s.owner, this);
      if (resHit) this.event('resonate', {...resHit, actor: s.owner, mat});
    }
  }

  advancePenetration(s, dt) {
    const pass = s.materialPass;
    const elapsed = Math.min(pass.remaining, s.life, dt);
    pass.remaining -= elapsed;
    s.life -= elapsed;
    s.age += elapsed;
    const time = Math.max(pass.time, this.time - dt + elapsed);
    if (pass.remaining > 0) {
      if (s.life > 0) return true;
      this.chronoTrace.finishShot(s, pass.ball.entryPos, 'wall', time);
      return false;
    }

    const {ball, normal, mat} = pass;
    s.materialPass = null;
    this.techStats.penetrations++;
    this.chronoTrace.recordPenetration(s, ball.entryPos, ball.exitPos, normal, ball.thickness, mat, pass.time, time, ball.exitNormal);
    s.old = [...ball.entryPos];
    s.p = ball.exitPos;
    s.dir = ball.dir;
    s.speed = ball.speed;
    s.damage = ball.damage;
    s.penetrations = (s.penetrations || 0) + 1;
    s.penetrated = true;
    if (s.scherpPen && s.homingTargetId >= 0 && isScherpAllowed(this)) {
      s.guided = true;
      s.scherpApn = true;
      s.scherpPen = false;
    } else {
      s.guided = false;
      s.scherpApn = false;
    }
    if (s.trail) {
      s.trail.push([...ball.entryPos], [...ball.exitPos]);
      while (s.trail.length > 10) s.trail.shift();
    }
    this.effects.push({
      kind: 'penetrate', p: [...ball.exitPos], dir: [...ball.dir], normal: ball.exitNormal, gun: s.gun, source: s.source,
      aaTier: s.aaTier || null, team: s.team, metal: mat === 'steel', mat, life: .44, max: .44, actor: s.owner.id, target: false, seed: ++this.seq
    });
    this.scorches.push({
      p: add(ball.exitPos, scale(ball.exitNormal, .014)), normal: ball.exitNormal, mat, gun: s.gun, source: s.source,
      life: 1.85, max: 1.85, seed: ++this.seq
    });
    if (this.scorches.length > 26) this.scorches.shift();
    this.aeroVortex.injectSmoke(ball.exitPos[0], ball.exitPos[2], 0.52, 0.55, 1, ball.dir[0] * 2.2, ball.dir[2] * 2.2);
    this.thermoFlux.depositHeat(ball.exitPos[0], ball.exitPos[2], 0.78, 1);
    this.echoPulse.emit(this, {kind: 'penetrate', pos: ball.exitPos, actor: s.owner, team: s.team, loudness: 0.76, gun: s.gun});
    this.event('penetrate', {point: ball.exitPos, entry: ball.entryPos, dir: ball.dir, mat, thickness: ball.thickness, gun: s.gun, actor: s.owner});
    if (s.life <= 0) {
      this.chronoTrace.finishShot(s, s.p, 'miss', time);
      return false;
    }
    const left = dt - elapsed;
    return left <= 1e-8 || this.projectile(s, left);
  }

  projectile(s, dt) {
    if (s.materialPass) return this.advancePenetration(s, dt);
    if (s.scherpApn) steerScherpShot(this, s, dt);
    else if (s.guided) steerGuidedShot(this, s, dt);
    const a = s.p;
    const ax = a[0], ay = a[1], az = a[2];
    const wind = (ay > 0.1 && ay < 5.5) ? this.aeroVortex.sampleWindOut(ax, az, this._windScratch) : null;
    stepMagnusAero(s, wind, dt);
    // Storm & Super Disaster weather ballistic warp (bends projectile direction mid-flight!)
    const bWarp = this.weatherSpec?.ballisticWarp || 0;
    if (bWarp > 0) {
      const ph = this.time * 2.1 + ax * 0.08 + az * 0.06 + (s.id || 0) * 0.7;
      const wx = Math.sin(ph) * bWarp * 0.42 * dt;
      const wy = Math.cos(ph * 1.37) * bWarp * 0.24 * dt;
      const wz = Math.cos(ph * 0.83) * bWarp * 0.36 * dt;
      const nx = s.dir[0] + wx, ny = s.dir[1] + wy, nz = s.dir[2] + wz;
      const invL = 1 / (Math.hypot(nx, ny, nz) || 1);
      s.dir[0] = nx * invL; s.dir[1] = ny * invL; s.dir[2] = nz * invL;
      s.weatherWarped = true;
      s.weatherDeflect = (s.weatherDeflect || 0) + Math.hypot(wx, wy, wz);
    }
    const travel = dt < s.life ? dt : s.life;
    const stepLen = s.speed * travel;
    const sd = s.dir;
    const bx = ax + sd[0] * stepLen, by = ay + sd[1] * stepLen, bz = az + sd[2] * stepLen;
    // Double-buffered next position avoids 2 array allocations per shot per 360Hz substep!
    let b = s._pNext;
    if (!b || b === a) b = (s._pNext = [0, 0, 0]);
    b[0] = bx; b[1] = by; b[2] = bz;
    const rOut = this._rayScratch || (this._rayScratch = {
      t: 0, tExit: 0, point: [0, 0, 0], normal: [0, 1, 0],
      exitPoint: null, exitNormal: null, _exitPt: [0, 0, 0], _exitNrm: [0, 1, 0],
      thickness: Infinity, mat: 'steel', box: null
    });
    const hasHit = raycastMaterialOut(ax, ay, az, bx, by, bz, rOut);
    const wet = (ay > WATER_HEIGHT && by <= WATER_HEIGHT) ? (ay - WATER_HEIGHT) / (ay - by) : null;
    let at = hasHit ? rOut.t : Infinity;
    if (wet !== null && wet < at) at = wet;
    let target = null;
    const actors = this.actors;
    // Conservative swept-segment AABB broadphase skips 90%+ of distant actors before sweptMovingBodyHit!
    const pad = travel * 12 + 1.35;
    const sx0 = (ax < bx ? ax : bx) - pad, sx1 = (ax > bx ? ax : bx) + pad;
    const sz0 = (az < bz ? az : bz) - pad, sz1 = (az > bz ? az : bz) + pad;
    for (let vi = 0; vi < actors.length; vi++) {
      const v = actors[vi];
      if (!v.alive) continue;
      if (s.fromHeli) {
        if (v.isZombie) continue;
      } else if (!this.areHostile(s.owner, v)) {
        continue;
      }
      if (v.x < sx0 || v.x > sx1 || v.z < sz0 || v.z > sz1) continue;
      const t = sweptMovingBodyHit(a, b, v, travel);
      if (t < at) {
        if ((v.vx * v.vx + v.vz * v.vz) > 2.25 && bodyHit(a, b, v) > 1) {
          this.telemetry.ccdCorrections++;
        }
        at = t;
        target = v;
      }
    }
    let hitHeli = false;
    const heli = this.helicopter;
    if (heli?.alive && !s.fromHeli) {
      const ht = sphereHit(a, [bx - ax, by - ay, bz - az], [heli.x, heli.y, heli.z], 3.4);
      if (ht < at) {
        at = ht;
        target = null;
        hitHeli = true;
      }
    }
    let hitPipe = null;
    const pipes = this.gasPipes;
    if (pipes) {
      const dx = bx - ax, dz = bz - az, A = dx * dx + dz * dz, rr = 0.45 * 0.45;
      for (let pi = 0; pi < pipes.length; pi++) {
        const gp = pipes[pi];
        if (!gp.alive) continue;
        if (gp.x < sx0 || gp.x > sx1 || gp.z < sz0 || gp.z > sz1) continue;
        const ox = ax - gp.x, oz = az - gp.z;
        const B = ox * dx + oz * dz, C = ox * ox + oz * oz - rr;
        let t = Infinity;
        if (C <= 0 && ay >= 0 && ay <= 2.2) t = 0;
        else if (A > 1e-12) {
          const h = B * B - A * C;
          if (h >= 0) {
            const u = (-B - Math.sqrt(h)) / A;
            const hy = ay + (by - ay) * u;
            if (u >= 0 && u <= 1 && hy >= 0 && hy <= 2.2) t = u;
          }
        }
        if (t < at) {
          at = t;
          target = null;
          hitHeli = false;
          hitPipe = gp;
        }
      }
    }
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const hitOcc = at <= 1;
    const px = hitOcc ? ax + abx * at : bx;
    const py = hitOcc ? ay + aby * at : by;
    const pz = hitOcc ? az + abz * at : bz;
    const point = hitOcc ? [px, py, pz] : b;
    const impactTime = Math.max(s.trace?.startTime ?? 0, this.time - dt + (hitOcc ? at : 1) * travel);
    if (ay > 0.05 && ay < 5.5 && ax > -26 && ax < 26 && az > -102 && az < 102 && (hitOcc || (s._wakeParity = !s._wakeParity))) {
      this.aeroVortex.injectProjectileWake(a, point, s.speed, s.gun);
    }

    const ab2 = abx * abx + aby * aby + abz * abz;
    // Detect close bullet flyby near the active listener (human player or spectated actor) for spatial whiz/N-wave audio.
    const pl = this.viewActor || this.player;
    if (ab2 > 1e-8 && pl && pl.alive && s.owner !== pl && !s.whizzed && target !== pl && !(s.shafferCloaked && !this.spectating && s.team !== pl.team)) {
      const plLean = pl.lean || 0;
      const ex = pl.x + Math.cos(pl.yaw) * plLean;
      const ey = pl.y + (pl.human ? 1.61 : 1.5) * (1 - (pl.crouch || 0) * .34);
      const ez = pl.z + Math.sin(pl.yaw) * plLean;
      const u = clamp(((ex - ax) * abx + (ey - ay) * aby + (ez - az) * abz) / ab2, 0, 1);
      const cx = ax + abx * u, cy = ay + aby * u, cz = az + abz * u;
      const ddx = cx - ex, ddy = cy - ey, ddz = cz - ez;
      const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
      if (d2 < 36.0 && (!hitOcc || u <= at)) {
        const d = Math.sqrt(d2);
        s.whizzed = true;
        const rx = Math.cos(pl.yaw), rz = Math.sin(pl.yaw);
        const p0x = ax - ex, p0z = az - ez, p1x = bx - ex, p1z = bz - ez;
        const pan = clamp((p0x * rx + p0z * rz) / (Math.sqrt(p0x * p0x + p0z * p0z) + .7), -1, 1);
        const panEnd = clamp((p1x * rx + p1z * rz) / (Math.sqrt(p1x * p1x + p1z * p1z) + .7), -1, 1);
        this.event('whiz', {
          shot: s,
          actor: s.owner,
          dist: d,
          speed: s.speed,
          mach: s.mach || (s.speed * (1 / 343)),
          nWaveDelay: machNWaveDelay(s.speed, d),
          gun: s.gun,
          source: s.source,
          pan,
          panEnd,
          point: [cx, cy, cz],
          dir: s.dir,
          origin: s.origin,
          p0: [ax, ay, az],
          p1: [bx, by, bz],
          enemy: s.team !== pl.team
        });
      }
    }
    // Notify NPCs of close enemy bullet flybys (<2.25m) for realistic suppression startle/flinch (zero-GC!)
    if (ab2 > 1e-8 && this.nv.onBulletWhiz && !s.shafferCloaked && (s.age || 0) < 0.45) {
      let mask = s.whizNpcMask || 0;
      const invAb2 = 1 / ab2;
      for (let vi = 0; vi < actors.length; vi++) {
        const v = actors[vi];
        if (!v.alive || v.human || v.isDrone || (!s.fromHeli && !this.areHostile(s.owner, v)) || v === target) continue;
        const bit = 1 << (v.id & 30);
        if (mask & bit) continue;
        // Coarse broadphase before eye projection
        if (Math.abs(v.x - ax) > 12 && Math.abs(v.x - bx) > 12) continue;
        if (Math.abs(v.z - az) > 12 && Math.abs(v.z - bz) > 12) continue;
        const vLean = v.lean || 0;
        const ex = v.x + Math.cos(v.yaw) * vLean;
        const ey = v.y + 1.5 * (1 - (v.crouch || 0) * .34);
        const ez = v.z + Math.sin(v.yaw) * vLean;
        const u = clamp(((ex - ax) * abx + (ey - ay) * aby + (ez - az) * abz) * invAb2, 0, 1);
        const cx = ax + abx * u - ex, cy = ay + aby * u - ey, cz = az + abz * u - ez;
        const d2 = cx * cx + cy * cy + cz * cz;
        if (d2 < 5.0625 && (!hitOcc || u <= at)) {
          mask |= bit;
          this.nv.onBulletWhiz(v, s, Math.sqrt(d2));
        }
      }
      s.whizNpcMask = mask;
    }

    s._pNext = a;
    s.old = a;
    s.p = point;
    const flight = travel * (hitOcc ? at : 1);
    s.life -= flight;
    s.age = (s.age || 0) + flight;
    if (s.speed >= 340 && s.age >= (s._nextMachAt || 0.008)) {
      s._nextMachAt = s.age + 0.045;
      this.resonance.exciteMach(point, s.speed);
    }
    if (!hitOcc) this.chronoTrace.sampleShot(s, impactTime);
    s.trailClock = (s.trailClock || 0) + dt;
    if (!hitOcc && s.trail && s.trailClock >= .0055) {
      s.trailClock = 0;
      s.trail.push([bx, by, bz]);
      if (s.trail.length > 8) s.trail.shift();
    }
    if (hitOcc) {
      const p = point;
      if (hitHeli) {
        this.damageHelicopter(s.damage, s.owner, p);
        if (s.rocket) this.detonateRocket(s, p, null, impactTime);
        this.chronoTrace.finishShot(s, p, 'hit', impactTime);
        return false;
      }
      if (hitPipe) {
        this.damageGasPipe(hitPipe, s.damage, s.owner);
        if (s.rocket) this.detonateRocket(s, p, null, impactTime);
        this.chronoTrace.finishShot(s, p, 'wall', impactTime);
        return false;
      }
      if (target) {
        const res = this.damage(target, s.owner, s.damage, s.dir, {ricochet: s.ricocheted, wallbang: s.penetrated, shot: s, point: p, time: impactTime});
        const kind = res?.kill ? 'kill' : res?.baizerBreak ? 'baizerBreak' : res?.shieldBreak ? 'break' : res?.baizer ? 'baizer' : res?.shield ? 'shield' : 'hit';
        const dur = kind === 'kill' ? .78 : (kind === 'break' || kind === 'baizerBreak') ? .58 : (kind === 'shield' || kind === 'baizer') ? .42 : .36;
        const bc = bodyCenter(target);
        const outN = unit([p[0] - bc[0] - s.dir[0] * .25, (p[1] - (target.y + .95)) * .35 - s.dir[1] * .25, p[2] - bc[1] - s.dir[2] * .25]);
        this.effects.push({
          kind,
          p,
          dir: [...s.dir],
          normal: outN,
          gun: s.gun,
          source: s.source,
          aaTier: s.aaTier || null,
          guided: !!s.guided,
          damage: s.damage,
          team: s.team,
          life: dur,
          max: dur,
          actor: s.owner.id,
          target: true,
          seed: ++this.seq
        });
        if (s.rocket || s.owner?.mechSpec?.splash) this.detonateRocket(s, p, target, impactTime);
      } else {
        const isWater = at === wet && (!hasHit || wet < rOut.t);
        const hitInfo = (!isWater && hasHit) ? {
          t: rOut.t, tExit: rOut.tExit,
          point: [rOut.point[0], rOut.point[1], rOut.point[2]],
          normal: [rOut.normal[0], rOut.normal[1], rOut.normal[2]],
          exitPoint: rOut.exitPoint ? [rOut.exitPoint[0], rOut.exitPoint[1], rOut.exitPoint[2]] : null,
          exitNormal: rOut.exitNormal ? [rOut.exitNormal[0], rOut.exitNormal[1], rOut.exitNormal[2]] : null,
          thickness: rOut.thickness, mat: rOut.mat, box: rOut.box
        } : null;
        const mat = isWater ? 'water' : hitInfo.mat;
        const normal = isWater ? [0, 1, 0] : hitInfo.normal;
        const metal = mat === 'steel';
        const ball = !s.rocket && !isWater && hitInfo
          ? solveBallisticImpact(s, hitInfo, this.rng, this.ricochetBoost ? {ricochetBoost: true} : null)
          : {action: 'stop'};

        if (ball.action === 'ricochet') {
          s.life -= travel - flight;
          this.techStats.ricochets++;
          this.chronoTrace.recordRicochet(s, hitInfo.point, normal, ball.grazingSin, impactTime);
          s.old = [...hitInfo.point];
          s.p = ball.pos;
          s.dir = ball.dir;
          s.speed = ball.speed;
          s.damage = ball.damage;
          impartRicochetSpin(s, normal, mat);
          if (s.postRicochetHoming && s.homingTargetId >= 0 && isScherpAllowed(this)) {
            s.guided = true;
            s.scherpApn = true;
            s.postRicochetHoming = false;
          } else {
            s.guided = false;
            s.scherpApn = false;
          }
          s.ricochets = (s.ricochets || 0) + 1;
          s.ricocheted = true;
          if (s.trail) {
            s.trail.push([...hitInfo.point], [...ball.pos]);
            while (s.trail.length > 10) s.trail.shift();
          }
          this.effects.push({
            kind: 'ricochet',
            p: [...hitInfo.point],
            dir: [...ball.dir],
            normal,
            gun: s.gun,
            source: s.source,
            aaTier: s.aaTier || null,
            team: s.team,
            metal,
            mat,
            life: .44,
            max: .44,
            actor: s.owner.id,
            target: false,
            seed: ++this.seq
          });
          this.scorches.push({
            p: [hitInfo.point[0] + normal[0] * .014, hitInfo.point[1] + normal[1] * .014, hitInfo.point[2] + normal[2] * .014],
            normal, mat, gun: s.gun, source: s.source, life: 1.85, max: 1.85, seed: this.seq
          });
          if (this.scorches.length > 26) this.scorches.shift();
          this.aeroVortex.injectSmoke(hitInfo.point[0], hitInfo.point[2], 0.42, 0.72, 1, ball.dir[0] * 2.5, ball.dir[2] * 2.5);
          this.thermoFlux.depositHeat(hitInfo.point[0], hitInfo.point[2], 0.92, 1);
          const resHit = this.resonance.exciteStrike(hitInfo.point, 1.05, s.owner, this);
          if (resHit) this.event('resonate', {...resHit, actor: s.owner, mat});
          this.echoPulse.emit(this, {kind: 'ricochet', pos: hitInfo.point, actor: s.owner, team: s.team, loudness: 0.92, gun: s.gun});
          this.event('ricochet', {point: hitInfo.point, dir: ball.dir, normal, gun: s.gun, mat, actor: s.owner, scherp: s.aaTier === '1.5'});
          return s.life > 0;
        }

        if (ball.action === 'penetrate') {
          this.beginPenetration(s, ball, normal, mat, impactTime);
          return this.advancePenetration(s, dt - flight);
        }

        if (s.rocket) this.detonateRocket(s, p, null, impactTime);
        this.chronoTrace.finishShot(s, p, isWater ? 'miss' : 'wall', impactTime);
        const dur = (s.gun === 'MS10' || s.source === 'p1') ? .48 : .40;
        this.effects.push({
          kind: 'wall',
          p,
          dir: [...s.dir],
          normal,
          gun: s.gun,
          source: s.source,
          aaTier: s.aaTier || null,
          guided: !!s.guided,
          team: s.team,
          metal,
          mat,
          life: dur,
          max: dur,
          actor: s.owner.id,
          target: false,
          seed: ++this.seq
        });
        if (!isWater) this.scorches.push({
          p: [p[0] + normal[0] * .014, p[1] + normal[1] * .014, p[2] + normal[2] * .014],
          normal,
          mat,
          gun: s.gun,
          source: s.source,
          life: 1.85,
          max: 1.85,
          seed: this.seq
        });
        if (this.scorches.length > 26)this.scorches.shift();
        this.aeroVortex.injectSmoke(p[0], p[2], 0.22, 0.25, 1, normal[0] * 1.2, normal[2] * 1.2);
        this.thermoFlux.depositHeat(p[0], p[2], 0.58, 1);
        if (mat === 'steel') {
          const resHit = this.resonance.exciteStrike(p, s.gun === 'MS10' ? 0.95 : 0.72, s.owner, this);
          if (resHit) this.event('resonate', {...resHit, actor: s.owner, mat});
        }
        this.event('impact', {point: p, dir: s.dir, normal, gun: s.gun, metal, mat, actor: s.owner})
      }
      return false
    }
    const alive = s.life > 0 && Math.abs(bx) < 120 && Math.abs(bz) < 200;
    if (!alive) this.chronoTrace.finishShot(s, [bx, by, bz], 'miss', impactTime);
    return alive
  }
  step(dt, input) {
    if (this.ended)return;
    const pl = this.player;
    const flowActive = !!(pl?.alive && pl.human && (pl.flowTimer || 0) > 0);
    const worldDt = flowActive ? dt * FLOW_WORLD_SCALE : dt;
    this.worldTimeScale = flowActive ? FLOW_WORLD_SCALE : 1;
    this.time += dt;
    this.updateWeather(dt);
    this.updateTimedEvents();
    if (this.smokeCooldown > 0) this.smokeCooldown = this.smokeCooldown > dt ? this.smokeCooldown - dt : 0;
    if (this.time > this.tremorAt + 1.2)this.tremorAt = this.time + 65 + this.rng() * 36;
    this.groundMotion = this.time >= this.tremorAt ? Math.sin((this.time - this.tremorAt) / 1.2 * Math.PI) : 0;
    const actors = this.actors, nActors = actors.length;
    if (this._prevStrides.length < nActors) this._prevStrides = new Float32Array(Math.max(nActors + 16, 128));
    const prevStrides = this._prevStrides;
    this._syncExpCache(dt);
    for (let i = 0; i < nActors; i++) {
      const a = actors[i];
      prevStrides[i] = a.stride || 0;
      const aDt = (flowActive && a === pl) ? dt : worldDt;
      this.systems(a, aDt);
    }
    this.updatePlayer(dt, input);
    const arrivedEchoes = this.echoPulse.step(this);
    for (let ri = 0; ri < arrivedEchoes.length; ri++) {
      const rep = arrivedEchoes[ri];
      const listener = actors[rep.listenerId];
      const src = rep.sourceActor;
      if (src && (src.shafferTimer || 0) > 0 && listener && listener.team !== src.team && rep.kind !== 'ricochet' && rep.kind !== 'penetrate') continue;
      this.nv.onEchoArrival?.(rep);
      const staleSource = src && (!src.alive || (rep.sourceSpawnId !== undefined && src.spawnId !== rep.sourceSpawnId));
      if (listener?.alive && !staleSource) {
        this.spectraField.observe(listener.team, rep.perceivedPos[0], rep.perceivedPos[2], {
          sigma: rep.occluded ? 7.2 : 4.5,
          weight: rep.isDecoy ? 0.35 : 0.62
        });
      }
    }
    const pWaves = this.echoPulse.playerWaves;
    if (pWaves.length) {
      for (let wi = 0; wi < pWaves.length; wi++) {
        const w = pWaves[wi];
        if (!w.specFed && pl?.alive && w.team !== pl.team && this.time >= w.arriveAt) {
          w.specFed = true;
          const srcActor = w.actorId >= 0 ? actors[w.actorId] : null;
          const staleSrc = w.actorId >= 0 && (!srcActor?.alive || srcActor.spawnId !== w.actorSpawnId);
          if (!staleSrc && !((srcActor?.shafferTimer || 0) > 0 && w.kind !== 'ricochet' && w.kind !== 'penetrate')) {
            this.spectraField.observe(0, w.pos[0], w.pos[2], {sigma: w.occluded ? 7.2 : 4.6, weight: 0.58});
            if (srcActor && srcActor.team === 1 && w.kind !== 'smoke') {
              this.fermat.recordIntel(0, srcActor, this.time, 'echo', [w.pos[0], Math.max(1.15, w.pos[1]), w.pos[2]]);
            }
          }
        }
      }
    }
    this.nv.tick(worldDt);
    this.updateDrones(worldDt);
    this.updateHelicopter(worldDt);
    if (this.isZombie || this.isZombieChallenge || this.raidState.m10 || this.raidState.m20) this.updateZombies(worldDt);
    this.updateBlood(worldDt);
    // Stamp warm ThermoFlux thermal footprints, EchoPulse steps & ResonanceCore hollow container roof drums!
    const inv115 = 1 / 1.15, inv22 = 1 / 2.2;
    const nActorsNow = actors.length;
    for (let i = 0; i < Math.min(nActors, nActorsNow); i++) {
      const a = actors[i];
      if (!a.alive || !a.onGround || (a.shafferTimer || 0) > 0) continue;
      const curStride = a.stride || 0;
      const prevStride = prevStrides[i];
      if (curStride === prevStride) continue;
      if (Math.floor(curStride * inv115) > Math.floor(prevStride * inv115)) {
        const intensity = (a.sprintAmt || 0) > 0.35 ? 0.56 : 0.38;
        this.thermoFlux.stampFootprint(a.x, a.z, a.team, this.time, intensity);
        if (a.y > 1.8) {
          const roof = this.resonance.exciteRoofStep(a, (a.sprintAmt || 0) > 0.35 ? 0.65 : 0.42);
          if (roof) this.event('resonate', {...roof, actor: a, mat: 'steel', roof: true});
        }
      }
      if ((a.sprintAmt || 0) > 0.35 || a.y > 0.5) {
        if (Math.floor(curStride * inv22) > Math.floor(prevStride * inv22)) {
          this.echoPulse.emit(this, {kind: 'step', pos: [a.x, a.y + 0.15, a.z], actor: a, team: a.team, loudness: a.y > 0.5 ? 0.85 : 0.55});
        }
      }
    }
    this.updateTankers(worldDt);
    this.updateBaizers(worldDt);
    this.updateAmmoBoxes(worldDt);
    this.updateGasPipes(worldDt);
    this.aeroVortex.tick(worldDt);
    this.thermoFlux.tick(worldDt, this.tankers);
    this.spectraField.tick(worldDt, this);
    this.kineticFlow.tick(this, worldDt);
    this.resonance.step(worldDt);
    this.chronoTrace.prune(this.time);
    const shots = this.shots;
    let write = 0;
    for (let si = 0; si < shots.length; si++) {
      const shot = shots[si];
      const sDt = (flowActive && shot.owner === pl) ? dt : worldDt;
      if (!this.ended && this.projectile(shot, sDt)) shots[write++] = shot;
    }
    shots.length = this.ended ? 0 : write;
    const casings = this.casings;
    let cw = 0;
    for (let ci = 0; ci < casings.length; ci++) {
      const c = casings[ci];
      c.life -= worldDt;
      if (c.life <= 0) continue;
      c.v[1] -= 13.5 * worldDt;
      c.p[0] += c.v[0] * worldDt;
      c.p[1] += c.v[1] * worldDt;
      c.p[2] += c.v[2] * worldDt;
      c.rot += c.spin * worldDt;
      const ground = floorAt(c.p[0], c.p[2], c.p[1] - c.v[1] * worldDt);
      if (c.p[1] <= ground + .03) {
        const impactVy = Math.abs(c.v[1]);
        c.p[1] = ground + .03;
        c.v[1] = impactVy * .38;
        c.v[0] *= .68;
        c.v[2] *= .68;
        c.spin *= .65;
        if (!c.bounced && !c.shafferCloaked) this.thermoFlux.depositHeat(c.p[0], c.p[2], 0.24, 0);
        if ((c.bounces || 0) < 2 && impactVy > .55 && !(c.shafferCloaked && c.team !== this.player?.team)) {
          this.event('casing', {point: [...c.p], gun: c.gun, speed: impactVy, bounce: c.bounces || 0});
          c.bounces = (c.bounces || 0) + 1
        }
        c.bounced = true
      }
      casings[cw++] = c;
    }
    casings.length = cw;
    // In-place compaction for effects & scorches (0 array allocations per 360Hz tick!)
    const effects = this.effects;
    let ew = 0;
    for (let ei = 0; ei < effects.length; ei++) {
      const e = effects[ei];
      e.life -= worldDt;
      if (e.life > 0) effects[ew++] = e;
    }
    effects.length = ew;
    if (ew > 130) effects.splice(0, ew - 130);
    const scorches = this.scorches;
    let sw = 0;
    for (let si = 0; si < scorches.length; si++) {
      const sc = scorches[si];
      sc.life -= worldDt;
      if (sc.life > 0) scorches[sw++] = sc;
    }
    scorches.length = sw;
  }
}
