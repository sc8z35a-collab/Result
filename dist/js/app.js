import {PilotEquipment} from './df-hud.js';
import {eyeOf} from './posture.js';
import {Renderer, effectiveSize} from './renderer.js';
import {titleCamera} from './harbor.js';
import {Match, modes, weapons, BASE_SHIELD_MAX, BAIZER_MAX_STACK, MAX_SKILL_CHARGES, KILLS_PER_SKILL_CHARGE, normalizeLabConfig} from './match.js';
import {obstruction} from './yard.js';
import {forward, add, clamp} from './geometry.js';
import {SoundEngin, SOUND_ENGIN_VERSION} from './audio.js';
import {readPreferences, scoreMultiplier} from './preferences.js';
import {aiVersionDisplay} from './ai-arena.js';
const $ = s => document.getElementById(s),
  views = {title: 'titleView', lobby: 'lobby', settings: 'settings', game: 'hud', pause: 'pause', results: 'results'};
// Optically exact +2/3 wider view width relative to 24.7° / 13.0° FOV:
// 2 * atan((5/3) * tan(24.7°/2)) = 40.1°, 2 * atan((5/3) * tan(13.0°/2)) = 21.5°.
const BASE_FOV = 40.1, ADS_FOV = 21.5;
const graphicsHints = {
  standard: '標準描画',
  high: '高精細 · 動的ライト',
  extra: '最高画質 · ブルーム · FXAA'
};
const shadowHints = {
  off: '影なし',
  flash: '軽量リアル影',
  pro: '物理PCSS · SSCS'
};
const audioHints = {
  ultra300: '300Hz立体音響',
  hrtf: '3D HRTF',
  stereo: '軽量ステレオ'
};
// Crisp minimal mechanical weapon pulse with ZERO camera shake or FOV punch.
const recoilProfiles = {
  'SW T': {z: .028, y: .005, pitch: .042, yaw: .008, roll: .020, camPitch: 0, camRoll: 0, shake: 0, spread: 3.4, heat: .18, fov: 0},
  SRA: {z: .022, y: .004, pitch: .032, yaw: .006, roll: .015, camPitch: 0, camRoll: 0, shake: 0, spread: 2.8, heat: .13, fov: 0},
  D1: {z: .020, y: .0035, pitch: .028, yaw: .0055, roll: .013, camPitch: 0, camRoll: 0, shake: 0, spread: 2.5, heat: .11, fov: 0},
  MS10: {z: .025, y: .004, pitch: .030, yaw: .007, roll: .016, camPitch: 0, camRoll: 0, shake: 0, spread: 2.4, heat: .15, fov: 0},
  'DF1 OUT': {z: .022, y: .0035, pitch: .028, yaw: .005, roll: .014, camPitch: 0, camRoll: 0, shake: 0, spread: 2.2, heat: .15, fov: 0},
  RD20: {z: .021, y: .0035, pitch: .028, yaw: .0055, roll: .014, camPitch: 0, camRoll: 0, shake: 0, spread: 2.3, heat: .12, fov: 0},
  RD30: {z: .023, y: .0038, pitch: .029, yaw: .0055, roll: .015, camPitch: 0, camRoll: 0, shake: 0, spread: 2.4, heat: .13, fov: 0},
  RD40: {z: .023, y: .0035, pitch: .026, yaw: .005, roll: .013, camPitch: 0, camRoll: 0, shake: 0, spread: 2.1, heat: .12, fov: 0},
  'RD 50': {z: .022, y: .0036, pitch: .027, yaw: .0052, roll: .014, camPitch: 0, camRoll: 0, shake: 0, spread: 2.3, heat: .11, fov: 0},
  'DF40 II': {z: .021, y: .0032, pitch: .024, yaw: .0045, roll: .012, camPitch: 0, camRoll: 0, shake: 0, spread: 2.0, heat: .10, fov: 0}
};
// Ultra-small precision micro-recoil with rapid smooth recovery (laser-controllable).
const aimRecoil = {
  'SW T': {pitch: .0036, yaw: .0008, recoverRate: 15.0, recoverRatio: .92, climb: .012},
  SRA: {pitch: .0024, yaw: .0007, recoverRate: 16.0, recoverRatio: .92, climb: .010},
  D1: {pitch: .0018, yaw: .0006, recoverRate: 16.5, recoverRatio: .94, climb: .008},
  MS10: {pitch: .0026, yaw: .0009, recoverRate: 15.5, recoverRatio: .92, climb: .010},
  'DF1 OUT': {pitch: .0016, yaw: .0005, recoverRate: 17.5, recoverRatio: .95, climb: .006},
  RD20: {pitch: .0017, yaw: .0005, recoverRate: 17.0, recoverRatio: .94, climb: .006},
  RD30: {pitch: .0018, yaw: .00055, recoverRate: 16.5, recoverRatio: .94, climb: .007},
  RD40: {pitch: .0015, yaw: .00045, recoverRate: 18.0, recoverRatio: .95, climb: .005},
  'RD 50': {pitch: .0017, yaw: .0005, recoverRate: 17.5, recoverRatio: .94, climb: .006},
  'DF40 II': {pitch: .0013, yaw: .0004, recoverRate: 19.0, recoverRatio: .96, climb: .004}
};
let saved;
try {
  saved = JSON.parse(localStorage.getItem('result.harbor.v1'));
} catch {}
const {settings, rules} = readPreferences(saved);
const save = () => {
  try {
    localStorage.setItem('result.harbor.v1', JSON.stringify({settings, rules}))
  } catch {}
};
let screen = 'title',
  previous = 'title',
  renderer = null,
  match = null,
  ready = false,
  gameKick = 0,
  hurt = 0,
  healPulse = 0,
  noticeUntil = 0,
  timeNow = 0,
  tourTime = 0,
  resetView = true,
  hudAt = 0,
  spectraAt = 0,
  flirActive = false,
  chronoActive = false,
  nextFrame = 0,
  currentRate = null,
  lastTime = null,
  accum = 0,
  simJump = false,
  stickX = 0,
  stickZ = 0,
  stickSprint = false,
  touchCrouch = false,
  gpMoveX = 0,
  gpMoveZ = 0,
  gpSprint = false,
  gpCrouch = false,
  holdFirePad = false,
  lockPending = false,
  gamepadIndex = null,
  padFireArmed = false,
  lookTouch = null,
  moveTouch = null,
  fireTouch = null,
  fireTouchLast = null,
  dragID = null,
  mousePointer = null,
  aimTouchLast = null,
  holdFireMouse = false,
  holdFireKey = false,
  holdFireTouch = false,
  spectateCam = 'tps',
  spectateIdx = 0,
  liveSimSpeed = 1;
const freeCam = {x: 0, y: 12, z: 0, yaw: 0, pitch: -0.42};
const tpsOrbit = {yaw: 0.45, pitch: -0.32, dist: 5.0};
const gpPrev = new Uint8Array(18);
const keys = new Set(), audio = new SoundEngin();
let feed = [];
const fixed = 1 / 360;
const maxStepBudget = 1 / 8;

function getViewActor() {
  if (!match) return null;
  if (!match.spectating) return match.player;
  const n = match.actors.length;
  if (!n) return null;
  spectateIdx = ((spectateIdx % n) + n) % n;
  return match.actors[spectateIdx];
}
function setSpectateCam(mode) {
  spectateCam = mode === 'fps' || mode === 'free' ? mode : 'tps';
  if (spectateCam === 'free' && match) {
    const a = getViewActor() || match.player;
    if (a) {
      freeCam.x = a.x - Math.sin(a.yaw) * 4.5;
      freeCam.y = Math.max(2.6, a.y + 4.8);
      freeCam.z = a.z + Math.cos(a.yaw) * 4.5;
      freeCam.yaw = a.yaw;
      freeCam.pitch = -0.36;
    }
  }
  hud();
}
function cycleSpectateActor(delta) {
  if (!match?.actors?.length) return;
  const n = match.actors.length;
  spectateIdx = ((spectateIdx + delta) % n + n) % n;
  hud();
}

// Second-order spring-damper kinematic model for crisp weapon blowback, sway & RD40 lock/track choreography (zero camera shake).
const gunMotion = {
  z: 0, vz: 0,
  y: 0, vy: 0,
  pitch: 0, vpitch: 0,
  yaw: 0, vyaw: 0,
  roll: 0, vroll: 0,
  swayX: 0, swayY: 0,
  land: 0, vland: 0,
  blowback: 0,
  heat: 0,
  spread: 0,
  camPitch: 0, vcamPitch: 0,
  camRoll: 0, vcamRoll: 0,
  shake: 0,
  fovPunch: 0,
  wasOnGround: true,
  shotSide: 1,
  rdSnap: 0, vrdSnap: 0,
  rdX: 0, rdY: 0, rdZ: 0,
  rdPitch: 0, rdYaw: 0, rdRoll: 0,
  rdLock: 0, rdD01: 0, rdLockPulse: 0, rdBarrelPhase: 0
};
// Ultra-small aim recoil tracker (supports crouch damping, manual pull-down cancel, & rapid recovery).
const recoilState = {pitch: 0, yaw: 0, holdUntil: 0, shotsInBurst: 0, lastShotAt: -10};
const hitState = {age: 1, dur: .28, kind: 'hit', rot: 45, bannerAge: 1, bannerDur: 0};
const dmgArc = {alpha: 0, dir: [0, 0, -1]};

function setTouchCrouch(on) {
  touchCrouch = !!on;
  const btn = $('touchCrouch');
  if (btn) {
    btn.setAttribute('aria-pressed', String(touchCrouch));
    btn.classList.toggle('is-active', touchCrouch)
  }
}

function resetMotion() {
  Object.assign(gunMotion, {
    z: 0, vz: 0, y: 0, vy: 0, pitch: 0, vpitch: 0, yaw: 0, vyaw: 0, roll: 0, vroll: 0,
    swayX: 0, swayY: 0, land: 0, vland: 0, blowback: 0, heat: 0, spread: 0,
    camPitch: 0, vcamPitch: 0, camRoll: 0, vcamRoll: 0, shake: 0, fovPunch: 0, wasOnGround: true,
    rdSnap: 0, vrdSnap: 0, rdX: 0, rdY: 0, rdZ: 0, rdPitch: 0, rdYaw: 0, rdRoll: 0,
    rdLock: 0, rdD01: 0, rdLockPulse: 0, rdBarrelPhase: 0, shotSide: 1
  });
  Object.assign(recoilState, {pitch: 0, yaw: 0, holdUntil: 0, shotsInBurst: 0, lastShotAt: -10});
  Object.assign(hitState, {age: 1, dur: .28, kind: 'hit', rot: 45, bannerAge: 1, bannerDur: 0});
  Object.assign(dmgArc, {alpha: 0, dir: [0, 0, -1]});
  setTouchCrouch(false);
  gpCrouch = false;
  $('hitmark').style.opacity = 0;
  $('hitBanner').style.opacity = 0;
  $('damageArc').style.opacity = 0;
  $('damageVeil').style.opacity = 0;
  $('reticle').style.setProperty('--spread', '0px')
}

function kickWeapon(gun) {
  const r = recoilProfiles[gun] || recoilProfiles['SW T'];
  const ar = aimRecoil[gun] || aimRecoil['SW T'];
  const a = match?.player;
  if ((gun === 'RD40' || gun === 'RD30') && a?.rd) {
    // Alternating twin-barrel harmonic roll polarity synced with shader barrel blowback!
    gunMotion.shotSide = a.rd.barrelPhase ? 1 : -1;
  } else if (gun === 'DF40 II' && a?.df40) {
    // Cyclic quad-barrel harmonic roll cadence (4 simultaneous barrels)
    const quadRoll = [-1, 1, -.72, .72];
    gunMotion.shotSide = quadRoll[(a.df40.barrelPhase || 0) % 4];
  } else {
    gunMotion.shotSide = Math.random() < .35 ? gunMotion.shotSide : -gunMotion.shotSide;
  }
  const side = gunMotion.shotSide * (.7 + Math.random() * .4);
  const j = .92 + Math.random() * .16;
  gunMotion.z = Math.min(.045, gunMotion.z + r.z * .35);
  gunMotion.vz += r.z * 9.0 * j;
  gunMotion.vy += r.y * 8.0 * j;
  gunMotion.vpitch += r.pitch * 9.5 * j;
  gunMotion.vyaw += r.yaw * 8.0 * side;
  gunMotion.vroll += r.roll * ((gun === 'RD40' || gun === 'DF40 II') ? 14.5 : 9.5) * side;
  if (gun === 'RD40' || gun === 'DF40 II') {
    // Stabilized hydraulic recoil cadence kick with zero camera shake
    gunMotion.vz += gun === 'DF40 II' ? .038 : .045;
  }
  gunMotion.blowback = 1;
  gunMotion.heat = Math.min(1, gunMotion.heat + r.heat);
  gunMotion.spread = Math.min(9, gunMotion.spread + r.spread);
  // Zero camera shake / zero camera pitch-roll kick / zero FOV punch!
  gunMotion.camPitch = gunMotion.vcamPitch = 0;
  gunMotion.camRoll = gunMotion.vcamRoll = 0;
  gunMotion.shake = 0;
  gunMotion.fovPunch = 0;
  gameKick = .35;

  // Apply ultra-small, tightly controllable micro-recoil to player aim.
  if (a?.alive) {
    if (timeNow - recoilState.lastShotAt < .35) recoilState.shotsInBurst = Math.min(8, recoilState.shotsInBurst + 1);
    else recoilState.shotsInBurst = 0;
    recoilState.lastShotAt = timeNow;
    const crouchMul = 1 - (a.crouch || 0) * .35;
    const adsMul = a.df?.ads ? .65 : 1;
    const heatMul = 1 + recoilState.shotsInBurst * ar.climb;
    const dp = ar.pitch * crouchMul * adsMul * heatMul * j;
    const dy = ar.yaw * crouchMul * adsMul * side;
    a.pitch = clamp(a.pitch + dp, -1.31, 1.31);
    a.yaw += dy;
    recoilState.pitch = Math.min(.045, recoilState.pitch + dp * ar.recoverRatio);
    recoilState.yaw = clamp(recoilState.yaw + dy * .85, -.018, .018);
    recoilState.holdUntil = timeNow + .055;
  }
}

function stepSpring(x, v, k, c, dt) {
  const a = -k * x - c * v;
  const nv = v + a * dt;
  return [x + nv * dt, nv]
}

function stepMotion(dt, a) {
  const sub = Math.min(dt, .033);
  [gunMotion.z, gunMotion.vz] = stepSpring(gunMotion.z, gunMotion.vz, 380, 34, sub);
  [gunMotion.y, gunMotion.vy] = stepSpring(gunMotion.y, gunMotion.vy, 320, 30, sub);
  [gunMotion.pitch, gunMotion.vpitch] = stepSpring(gunMotion.pitch, gunMotion.vpitch, 300, 29, sub);
  [gunMotion.yaw, gunMotion.vyaw] = stepSpring(gunMotion.yaw, gunMotion.vyaw, 280, 27, sub);
  [gunMotion.roll, gunMotion.vroll] = stepSpring(gunMotion.roll, gunMotion.vroll, 270, 27, sub);
  [gunMotion.land, gunMotion.vland] = stepSpring(gunMotion.land, gunMotion.vland, 190, 22, sub);
  [gunMotion.rdSnap, gunMotion.vrdSnap] = stepSpring(gunMotion.rdSnap, gunMotion.vrdSnap, 310, 24, sub);

  gunMotion.z = clamp(gunMotion.z, -.01, .055);
  gunMotion.y = clamp(gunMotion.y, -.015, .02);
  gunMotion.pitch = clamp(gunMotion.pitch, -.03, .10);
  gunMotion.yaw = clamp(gunMotion.yaw, -.04, .04);
  gunMotion.roll = clamp(gunMotion.roll, -.07, .07);
  gunMotion.land = clamp(gunMotion.land, -.015, .04);
  gunMotion.rdSnap = clamp(gunMotion.rdSnap, -.08, .18);
  gunMotion.camPitch = gunMotion.vcamPitch = 0;
  gunMotion.camRoll = gunMotion.vcamRoll = 0;
  gunMotion.shake = 0;
  gunMotion.fovPunch = 0;

  const swayDecay = Math.exp(-13 * dt);
  gunMotion.swayX *= swayDecay;
  gunMotion.swayY *= swayDecay;
  gunMotion.blowback *= Math.exp(-26 * dt);
  gunMotion.heat = Math.max(0, gunMotion.heat - dt * .24);

  if (a?.alive) {
    // Rapid smooth auto-recovery of ultra-small aim recoil (never fights manual pull-down!).
    if (timeNow > recoilState.holdUntil) {
      const rate = aimRecoil[a.gun]?.recoverRate || 16.0;
      const f = 1 - Math.exp(-rate * dt);
      if (recoilState.pitch > 1e-5) {
        const dp = recoilState.pitch * f;
        a.pitch = clamp(a.pitch - dp, -1.31, 1.31);
        recoilState.pitch -= dp;
      } else recoilState.pitch = 0;
      if (Math.abs(recoilState.yaw) > 1e-5) {
        const dy = recoilState.yaw * f;
        a.yaw -= dy;
        recoilState.yaw -= dy;
      } else recoilState.yaw = 0;
    }
    if (!gunMotion.wasOnGround && a.onGround) {
      gunMotion.vland += .22;
    }
    gunMotion.wasOnGround = a.onGround;
    const speed = Math.hypot(a.vx, a.vz);
    const moveSpread = (a.onGround ? Math.min(2.6, speed * .36) : 4.2) * (1 - a.crouch * .45);
    gunMotion.spread = moveSpread + (gunMotion.spread - moveSpread) * Math.exp(-14 * dt);

    // RD-Series & DF40 II 3D first-person kinetic choreography (ARV1.2/1.3 lock-cant + gimbal tracking + AA1.4 Overdrive stance)
    const rd = a.rd;
    const df40 = a.df40;
    if (df40 && a.gun === 'DF40 II') {
      const lock = df40.lockBlend || 0;
      const d01 = df40.d01Blend || 0;
      const aa14 = df40.aa14Blend || 0;
      const pulse = Math.max(df40.lockPulse || 0, (df40.aa14Pulse || 0) * .9);
      const fp = df40.firePulse || 0;
      const snap = gunMotion.rdSnap;
      const tYaw = df40.trackYaw || 0;
      const tPitch = df40.trackPitch || 0;
      const bSign = (df40.barrelPhase || 0) === 1 ? 0 : (df40.barrelPhase === 0 ? -1 : 1);
      gunMotion.rdX = -lock * .018 - aa14 * .012 + tYaw * .058 - snap * .008;
      gunMotion.rdY = lock * .011 + aa14 * .010 + d01 * .009 + tPitch * .044 + snap * .006;
      gunMotion.rdZ = -snap * .022 - pulse * .015 + lock * .010 + aa14 * .008;
      gunMotion.rdYaw = tYaw * .50;
      gunMotion.rdPitch = tPitch * .46 + snap * .032 + Math.cos(timeNow * 4.8) * .008 * Math.max(d01, aa14 * .5);
      gunMotion.rdRoll = -lock * .085 - aa14 * .065 + d01 * .030 + tYaw * .36 + Math.sin(timeNow * 5.8) * .014 * Math.max(d01, aa14 * .6) - snap * .060 + bSign * fp * .018;
      gunMotion.rdLock = Math.max(lock, aa14 * .78);
      gunMotion.rdD01 = Math.max(d01, aa14 * .62);
      gunMotion.rdLockPulse = pulse;
      gunMotion.rdBarrelPhase = (df40.barrelPhase || 0) / 2;
      // Visually couple Auto-Aim 1.4 thermal heat onto the weapon chassis glow!
      gunMotion.heat = Math.max(gunMotion.heat, (df40.aa14Heat || 0) / 100);
    } else if (rd && a.gun === 'RD40') {
      const lock = rd.lockBlend || 0;
      const d01 = rd.d01Blend || 0;
      const pulse = rd.lockPulse || 0;
      const fp = rd.firePulse || 0;
      const snap = gunMotion.rdSnap;
      const tYaw = rd.trackYaw || 0;
      const tPitch = rd.trackPitch || 0;
      const bSign = rd.barrelPhase ? 1 : -1;
      gunMotion.rdX = -lock * .018 + tYaw * .055 - snap * .008;
      gunMotion.rdY = lock * .012 + d01 * .009 + tPitch * .042 + snap * .006;
      gunMotion.rdZ = -snap * .024 - pulse * .014 + lock * .012;
      gunMotion.rdYaw = tYaw * .48;
      gunMotion.rdPitch = tPitch * .44 + snap * .035 + Math.cos(timeNow * 4.4) * .008 * d01;
      gunMotion.rdRoll = -lock * .095 + d01 * .032 + tYaw * .34 + Math.sin(timeNow * 5.2) * .015 * d01 - snap * .065 + bSign * fp * .022;
      gunMotion.rdLock = lock;
      gunMotion.rdD01 = d01;
      gunMotion.rdLockPulse = pulse;
      gunMotion.rdBarrelPhase = rd.barrelPhase || 0;
    } else if (rd && a.gun === 'RD30') {
      const bSign = rd.barrelPhase ? 1 : -1;
      gunMotion.rdX = gunMotion.rdY = gunMotion.rdZ = gunMotion.rdPitch = gunMotion.rdYaw = 0;
      gunMotion.rdRoll = -(rd.lockBlend || 0) * .024 + bSign * (rd.firePulse || 0) * .014;
      gunMotion.rdLock = (rd.lockBlend || 0) * .55;
      gunMotion.rdD01 = 0;
      gunMotion.rdLockPulse = (rd.lockPulse || 0) * .4;
      gunMotion.rdBarrelPhase = rd.barrelPhase || 0;
    } else if (rd && a.gun === 'RD20') {
      gunMotion.rdX = gunMotion.rdY = gunMotion.rdZ = gunMotion.rdPitch = gunMotion.rdYaw = 0;
      gunMotion.rdRoll = -(rd.lockBlend || 0) * .028;
      gunMotion.rdLock = (rd.lockBlend || 0) * .55;
      gunMotion.rdD01 = 0;
      gunMotion.rdLockPulse = (rd.lockPulse || 0) * .4;
      gunMotion.rdBarrelPhase = 0;
    } else {
      gunMotion.rdX = gunMotion.rdY = gunMotion.rdZ = gunMotion.rdPitch = gunMotion.rdYaw = gunMotion.rdRoll = 0;
      gunMotion.rdLock = gunMotion.rdD01 = gunMotion.rdLockPulse = gunMotion.rdBarrelPhase = 0;
    }
  } else {
    recoilState.pitch = recoilState.yaw = recoilState.shotsInBurst = 0;
    gunMotion.spread *= Math.exp(-14 * dt);
    gunMotion.wasOnGround = true;
    gunMotion.rdX = gunMotion.rdY = gunMotion.rdZ = gunMotion.rdPitch = gunMotion.rdYaw = gunMotion.rdRoll = 0;
    gunMotion.rdLock = gunMotion.rdD01 = gunMotion.rdLockPulse = gunMotion.rdBarrelPhase = 0;
  }
  $('reticle').style.setProperty('--spread', clamp(gunMotion.spread, 0, 12).toFixed(2) + 'px')
}

function triggerHitUI(e) {
  const kind = e.kill ? 'kill' : e.baizerBreak ? 'baizer-break' : e.shieldBreak ? 'break' : e.baizer ? 'baizer' : e.shield ? 'shield' : 'hit';
  hitState.kind = kind;
  hitState.age = 0;
  hitState.dur = kind === 'kill' ? .56 : (kind === 'break' || kind === 'baizer-break') ? .44 : (kind === 'shield' || kind === 'baizer') ? .32 : .25;
  hitState.rot = kind === 'kill' ? 54 : 45 + (Math.random() - .5) * 9;
  const hm = $('hitmark');
  hm.className = 'is-' + kind;
  const bn = $('hitBanner');
  if (e.ricochet) {
    bn.textContent = e.kill ? 'RICOCHET KILL' : 'RICOCHET HIT';
    bn.className = 'is-ricochet';
    hitState.bannerAge = 0;
    hitState.bannerDur = e.kill ? .96 : .68;
  } else if (e.wallbang) {
    bn.textContent = e.kill ? 'WALLBANG KILL' : 'WALLBANG HIT';
    bn.className = 'is-wallbang';
    hitState.bannerAge = 0;
    hitState.bannerDur = e.kill ? .96 : .68;
  } else if (kind === 'kill' || kind === 'break' || kind === 'baizer-break') {
    bn.textContent = kind === 'kill' ? 'ELIMINATED' : kind === 'baizer-break' ? 'BAIZER BREAK' : 'SHIELD BREAK';
    bn.className = 'is-' + kind;
    hitState.bannerAge = 0;
    hitState.bannerDur = kind === 'kill' ? .88 : .70;
  }
}

function triggerDamageUI(e, p) {
  hurt = Math.min(1, hurt + (e.shieldBreak || e.baizerBreak ? .96 : .64));
  let dx = 0, dz = -1;
  if (!e.ricochet && e.actor && e.actor !== p) {
    dx = e.actor.x - p.x;
    dz = e.actor.z - p.z
  } else if (e.dir) {
    dx = -e.dir[0];
    dz = -e.dir[2]
  }
  const len = Math.hypot(dx, dz) || 1;
  dmgArc.dir = [dx / len, 0, dz / len];
  dmgArc.alpha = 1
}

function updateCombatUI(dt, p) {
  const hm = $('hitmark');
  if (hitState.age < hitState.dur) {
    hitState.age += dt;
    const t = clamp(hitState.age / hitState.dur, 0, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    const peak = hitState.kind === 'kill' ? 1.56 : hitState.kind === 'break' ? 1.42 : 1.26;
    const scale = peak - (peak - .94) * ease;
    const gap = hitState.kind === 'kill' ? 11 - ease * 5.5 : 10 - ease * 5.2;
    const rot = hitState.rot + (45 - hitState.rot) * ease;
    const ringMax = hitState.kind === 'kill' ? 70 : hitState.kind === 'break' ? 56 : 38;
    const ringSize = 10 + ringMax * ease;
    const alpha = t < .16 ? t / .16 : Math.pow(1 - (t - .16) / .84, 1.45);
    const ringOp = Math.max(0, 1 - t * 1.45) * (hitState.kind === 'hit' ? .62 : .95);
    hm.style.opacity = alpha.toFixed(3);
    hm.style.setProperty('--hscale', scale.toFixed(3));
    hm.style.setProperty('--hgap', gap.toFixed(2) + 'px');
    hm.style.setProperty('--hrot', rot.toFixed(1) + 'deg');
    hm.style.setProperty('--hring', ringSize.toFixed(1) + 'px');
    hm.style.setProperty('--hring-op', ringOp.toFixed(3))
  } else {
    hm.style.opacity = 0
  }

  const bn = $('hitBanner');
  if (hitState.bannerDur > 0 && hitState.bannerAge < hitState.bannerDur) {
    hitState.bannerAge += dt;
    const t = clamp(hitState.bannerAge / hitState.bannerDur, 0, 1);
    const alpha = t < .12 ? t / .12 : t > .65 ? 1 - (t - .65) / .35 : 1;
    const rise = -4 * t;
    const sc = t < .15 ? 1.18 - .18 * (t / .15) : 1;
    bn.style.opacity = clamp(alpha, 0, 1).toFixed(3);
    bn.style.transform = `translate(-50%, ${rise.toFixed(1)}px) scale(${sc.toFixed(3)})`
  } else {
    bn.style.opacity = 0
  }

  const arc = $('damageArc');
  if (dmgArc.alpha > .005 && p) {
    dmgArc.alpha = Math.max(0, dmgArc.alpha - dt * 1.35);
    const fx = Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = Math.sin(p.yaw);
    const fwdDot = dmgArc.dir[0] * fx + dmgArc.dir[2] * fz;
    const rightDot = dmgArc.dir[0] * rx + dmgArc.dir[2] * rz;
    const deg = Math.atan2(rightDot, fwdDot) * 180 / Math.PI;
    arc.style.setProperty('--dmg-ang', deg.toFixed(1) + 'deg');
    arc.style.opacity = (dmgArc.alpha * .92).toFixed(3)
  } else {
    arc.style.opacity = 0
  }
}

const equipment = new PilotEquipment(() => match, msg => {
  if (match) {
    $('combatNotice').textContent = msg;
    noticeUntil = match.time + 1.6;
  }
  const status = {lobby: 'lobbyNotice', pause: 'pauseNotice', results: 'resultNotice'}[screen];
  if (status) $(status).textContent = msg;
});
function group(id, value, change) {
  const node = $(id);
  for (const b of node.querySelectorAll('button[data-value]')) {
    b.setAttribute('aria-pressed', String(b.dataset.value === String(value)));
    b.onclick = () => {
      if (b.getAttribute('aria-pressed') !== 'true') change(b.dataset.value);
    };
  }
}
const coarsePointer = matchMedia('(pointer: coarse)');
let touch = coarsePointer.matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle('touch', touch);
const setInputType = isTouch => {
  if (touch === isTouch) return;
  touch = isTouch;
  document.body.classList.toggle('touch', touch);
};
document.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') setInputType(true);
  if (e.pointerType === 'mouse') setInputType(false);
}, true);
coarsePointer.addEventListener?.('change', e => setInputType(e.matches));
function controls() {
  const rows = touch ? [['移動 / ダッシュ', '左スティック（前傾ダッシュ）'], ['視点', '右スワイプ / 射撃ドラッグ'], ['発射 / 装填', '射撃ボタン / R'], ['技（5撃破毎・最大3）', '下部 技ボタン'], ['ジャンプ / しゃがみ', '↑ / しゃがみ'], ['AA / 全画面', '右上 AA / 全画面'], ['FLIR / 煙幕 / 解析', '左下ボタン']] : [['移動 / ダッシュ', 'WASD / Shift'], ['視点', 'マウス / 矢印キー'], ['発射 / 装填', '左クリック・F / R'], ['技（5撃破毎・最大3）', '4 / Z'], ['ジャンプ / しゃがみ', 'Space / Ctrl'], ['AA / 全画面', 'O (OFF/標準/1.5) · U'], ['FLIR / 煙幕 / 解析', 'T / G / L / K / M'], ['一時停止', 'Esc / P']];
  if (match?.player.df)rows.push(...(touch ? [['DF1 OUT', '右側専用ボタン']] : [['範囲 / P1', 'Q / X'], ['照準 / レンズ', '右クリック・C / V'], ['EVR1 購入', 'B']]));
  if (match?.player.df40)rows.push(...(touch ? [['DF40 II · AA1.4', '右側 AA1.4 ボタン']] : [['AA 1.4 起動/解除', 'X / E']]));
  $('controls').innerHTML = rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('')
}
function show(s) {
  if (s === 'game' && (!ready || !match || match.ended)) return;
  screen = s;
  document.body.dataset.screen = s;
  for (const [k, id] of Object.entries(views))$(id).hidden = k !== s;
  keys.clear();
  simJump = false;
  holdFireMouse = holdFireKey = holdFireTouch = holdFirePad = false;
  padFireArmed = false;
  stickX = stickZ = gpMoveX = gpMoveZ = 0;
  stickSprint = gpSprint = false;
  setTouchCrouch(false);
  gpCrouch = false;
  moveTouch = lookTouch = fireTouch = fireTouchLast = dragID = mousePointer = aimTouchLast = null;
  $('touchFire')?.classList.remove('is-active');
  $('pad').classList.remove('is-sprint');
  $('pad').firstElementChild.style.transform = '';
  accum = 0;
  lastTime = null;
  if (s !== 'game' && document.pointerLockElement === $('scene')) document.exitPointerLock?.();
  const status = {lobby: 'lobbyNotice', pause: 'pauseNotice', results: 'resultNotice'}[s];
  if (status) $(status).textContent = '';
  if (s === 'lobby') {
    flirActive = false;
    chronoActive = false;
    if (match?.ended) {
      audio.resetMatch();
      match = null;
      tourTime = 0
    }
    lobby();
    syncFullscreenUI();
    syncAutoAimUI();
  }
  if (s === 'settings')drawSettings();
  if (s === 'title') {
    flirActive = false;
    chronoActive = false;
    match = null;
    audio.resetMatch();
    tourTime = 0;
    resetView = true;
    soundButton();
    syncFullscreenUI();
  }
  if (s === 'pause') {
    audio.stopMatchSounds();
    controls();
    equipment.pause(match?.player);
    syncFullscreenUI();
    syncAutoAimUI();
  }
  if (s === 'results')resultUI();
  const focus = {title: 'play', lobby: 'lobbyBack', settings: 'settingsClose', pause: 'resume', results: 'rematch'}[s];
  if (focus)$(focus).focus({preventScroll: true}); else document.activeElement?.blur?.()
}
function audioSafely(action) {
  try {
    action();
  } catch (error) {
    audio.on = false;
    audio.listenerPrevPos = null;
    audio.listenerVel = [0, 0, 0];
    try { audio.set(settings.volume / 100); } catch {}
    console.warn('サウンドの処理を停止しました', error);
    soundButton();
  }
}

function soundButton() {
  const on = settings.sound && audio.on && settings.volume > 0;
  $('sound').querySelector('use').setAttribute('href', on ? '#i-audio' : '#i-muted');
  $('sound').querySelector('span').textContent = on ? 'SOUND ON' : 'SOUND OFF';
  $('sound').setAttribute('aria-label', on ? 'サウンドをオフにする' : 'サウンドをオンにする');
  $('app').dataset.audioState = audio.ctx?.state || (audio.on ? 'ready' : 'off')
}
function lobby() {
  rules.lab = normalizeLabConfig(rules.lab);
  rules.aiModel = 'human';
  rules.allyNv21 = 0;
  const lab = rules.lab;
  const isLab = rules.mode === 'lab';
  group('modes', rules.mode, k => {
    rules.mode = k;
    save();
    lobby()
  });
  if ($('autoAimWrap')) $('autoAimWrap').hidden = isLab;
  if ($('autoAimMode')) {
    group('autoAimMode', settings.autoAimMode || (settings.autoAim === false ? 'off' : 'standard'), k => {
      setAutoAimMode(k, false);
    });
  }
  const labWrap = $('labConfig');
  if (labWrap) {
    labWrap.hidden = !isLab;
    if (isLab) {
      const setLab = (patch) => {
        rules.lab = normalizeLabConfig({...rules.lab, ...patch});
        save();
        lobby();
      };
      group('labRole', lab.playerRole, k => setLab({playerRole: k}));
      group('labCountA', lab.teamACount, k => setLab({teamACount: Number(k)}));
      group('labCountB', lab.teamBCount, k => setLab({teamBCount: Number(k)}));
      group('labSkillRule', lab.skillRule, k => setLab({skillRule: k}));
      group('labBaizer', lab.startBaizer, k => setLab({startBaizer: Number(k)}));
      group('labHp', lab.hpMax, k => setLab({hpMax: Number(k)}));
      group('labInfAmmo', lab.infiniteAmmo ? '1' : '0', k => setLab({infiniteAmmo: k === '1'}));
      group('labGravity', lab.gravityScale, k => setLab({gravityScale: Number(k)}));
      group('labRicochet', lab.ricochetBoost ? '1' : '0', k => setLab({ricochetBoost: k === '1'}));
      group('labRespawn', lab.respawnTime, k => setLab({respawnTime: Number(k)}));
      group('labSpeed', lab.simSpeed, k => setLab({simSpeed: Number(k)}));
      group('labLearning', lab.aiLearning ? '1' : '0', k => setLab({aiLearning: k === '1'}));
      const bindSel = (id, key) => {
        const el = $(id);
        if (!el) return;
        el.value = String(lab[key]);
        el.onchange = () => setLab({[key]: el.value});
      };
      bindSel('labAiA', 'teamAAi');
      bindSel('labAiB', 'teamBAi');
      bindSel('labAaP', 'playerAA');
      bindSel('labAaA', 'teamAAA');
      bindSel('labAaB', 'teamBAA');
      bindSel('labGunA', 'teamAGun');
      bindSel('labGunB', 'teamBGun');
      const npcSk = $('labNpcSkills');
      if (npcSk) {
        npcSk.setAttribute('aria-pressed', String(!!lab.npcSkills));
        npcSk.classList.toggle('is-on', !!lab.npcSkills);
        npcSk.textContent = lab.npcSkills ? 'NPC技 ON' : 'NPC技 OFF';
        npcSk.onclick = () => setLab({npcSkills: !lab.npcSkills});
      }
      const isSpec = lab.playerRole === 'spectate';
      if ($('labAaP')) $('labAaP').hidden = isSpec;
      if ($('labAaPLabel')) $('labAaPLabel').hidden = isSpec;
    }
  }
  if ($('loadoutField')) $('loadoutField').hidden = isLab && lab.playerRole === 'spectate';
  $('lobbyAiLabel').textContent = isLab
    ? `${aiVersionDisplay(lab.teamAAi)} vs ${aiVersionDisplay(lab.teamBAi)}`
    : 'NV2.6 Force';
  group('limit', rules.limit, k => {
    rules.limit = k;
    save();
    lobby()
  });
  group('loadout', rules.loadout, k => {
    rules.loadout = k;
    save();
    lobby()
  });
  if (document.activeElement !== $('mult')) $('mult').value = rules.multiplier;
  $('multWrap').hidden = rules.limit === 'unlimited';
  const [a, b] = isLab ? [lab.teamACount, lab.teamBCount] : (modes[rules.mode] || modes['3v3']), v = rules.multiplier;
  $('targets').textContent = rules.limit === 'unlimited' ? '無制限' : `味方 ${a*v} / 敵 ${b*v} 点先取`;
  const w = weapons[rules.loadout];
  const modeLabel = rules.loadout === 'DF40 II' ? '4発同時' : w.auto && w.pellets > 1 ? `${w.pellets}発同時` : w.auto && w.burst > 1 ? `${w.burst}発連射` : w.auto ? 'フルオート' : w.burst > 1 ? w.burst + '点' : '単発';
  const dmgLabel = w.pellets > 1 ? `威力 ${w.damage}×${w.pellets}` : `威力 ${w.damage}`;
  const tags = [`弾倉 ${w.capacity}`, dmgLabel, modeLabel, `連射 ${w.rate}`, `弾速 ${w.velocity}`];
  if (w.stockCap) tags.push(`上限 ${w.stockCap}`);
  if (w.stockRegen) tags.push(`回復 ${w.stockRegen}/s`);
  if (rules.loadout === 'RD20')tags.push('AA 1.1');
  if (rules.loadout === 'RD30')tags.push('AA 1.1 mini');
  if (rules.loadout === 'RD40')tags.push('AA 1.2 · D01');
  if (rules.loadout === 'RD 50')tags.push('AA なし');
  if (rules.loadout === 'DF40 II')tags.push('AA 1.3 / 1.4');
  $('weaponStats').innerHTML = tags.map(s => `<span>${s}</span>`).join('');
  $('start').disabled = !ready;
  equipment.lobby(rules.loadout)
}
const effectiveAudioMode = () => settings.lightMode ? 'stereo' : settings.audioMode;
function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || null;
}
function fullscreenSupported() {
  const el = document.documentElement;
  return !!(
    document.fullscreenEnabled || document.webkitFullscreenEnabled ||
    typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
  );
}
function syncFullscreenUI() {
  const on = !!fullscreenElement();
  const supported = fullscreenSupported();
  document.body.classList.toggle('is-fullscreen', on);
  const appEl = $('app');
  if (appEl) appEl.dataset.fullscreen = String(on);
  const iconHref = on ? '#i-exit-fullscreen' : '#i-fullscreen';
  const titleBtn = $('fullscreenTitle');
  if (titleBtn) {
    titleBtn.setAttribute('aria-pressed', String(on));
    titleBtn.setAttribute('aria-label', on ? '全画面を解除' : '全画面表示');
    titleBtn.classList.toggle('is-on', on);
    titleBtn.querySelector('use')?.setAttribute('href', iconHref);
    const sp = titleBtn.querySelector('span');
    if (sp) sp.textContent = on ? '解除' : '全画面';
  }
  for (const id of ['lobbyFullscreen', 'hudFullscreen']) {
    const btn = $(id);
    if (!btn) continue;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? '全画面を解除' : '全画面表示');
    btn.classList.toggle('is-on', on);
    btn.querySelector('use')?.setAttribute('href', iconHref);
  }
  const pauseFs = $('pauseFullscreen');
  if (pauseFs) {
    pauseFs.setAttribute('aria-pressed', String(on));
    pauseFs.classList.toggle('is-on', on);
    pauseFs.querySelector('use')?.setAttribute('href', iconHref);
    const sp = pauseFs.querySelector('span');
    if (sp) sp.textContent = on ? '全画面解除' : '全画面';
  }
  const setFs = $('fullscreenSettings');
  if (setFs) {
    setFs.setAttribute('aria-pressed', String(on));
    setFs.classList.toggle('is-on', on);
    setFs.querySelector('use')?.setAttribute('href', iconHref);
    const sp = setFs.querySelector('span');
    if (sp) sp.textContent = on ? '全画面を解除' : '全画面にする';
  }
  const fsHint = $('fullscreenHint');
  if (fsHint) {
    fsHint.textContent = !supported
      ? 'このブラウザは全画面API非対応です（ホーム画面に追加で全画面表示可能）'
      : on
        ? '現在全画面表示中 · Esc / U キーまたはボタンで解除'
        : 'ボタンまたは試合中 U キーで画面いっぱいに全画面表示';
  }
}
async function toggleFullscreen() {
  const notify = msg => {
    if (screen === 'game' && match) {
      $('combatNotice').textContent = msg;
      noticeUntil = match.time + 2.0;
    }
    const status = {lobby: 'lobbyNotice', pause: 'pauseNotice', results: 'resultNotice', settings: 'settingStatus'}[screen];
    if (status && $(status)) $(status).textContent = msg;
  };
  if (!fullscreenSupported()) {
    notify('このブラウザは全画面API非対応です（ホーム画面に追加で全画面表示可能）');
    syncFullscreenUI();
    return false;
  }
  try {
    if (fullscreenElement()) {
      const p = document.exitFullscreen?.() || document.webkitExitFullscreen?.();
      if (p?.then) await p;
    } else {
      const el = document.documentElement;
      if (typeof el.requestFullscreen === 'function') {
        try {
          await el.requestFullscreen({navigationUI: 'hide'});
        } catch {
          await el.requestFullscreen();
        }
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        el.webkitRequestFullscreen();
      }
    }
  } catch {
    notify('全画面表示に切り替えできませんでした');
  }
  syncFullscreenUI();
  if (ready && renderer) {
    try { renderer.resize(); } catch {}
    requestAnimationFrame(() => {
      if (ready && renderer) try { renderer.resize(); } catch {}
    });
  }
  return !!fullscreenElement();
}
function currentAutoAimMode() {
  if (settings.autoAimMode === '1.5' || settings.autoAimMode === 'off' || settings.autoAimMode === 'standard') {
    return settings.autoAimMode;
  }
  return settings.autoAim === false ? 'off' : 'standard';
}
function syncAutoAimUI() {
  const mode = currentAutoAimMode();
  const on = mode !== 'off';
  const isScherp = mode === '1.5';
  const appEl = $('app');
  if (appEl) {
    appEl.dataset.autoAim = String(on);
    appEl.dataset.autoAimMode = mode;
  }
  const sw = $('autoAimSwitch');
  if (sw) sw.setAttribute('aria-checked', String(on));
  const hint = $('autoAimHint');
  if (hint) {
    hint.textContent = isScherp
      ? '1.5 Scherp · 全武器対応'
      : on ? '標準 · 武器内蔵AA' : 'OFF · 手動エイム';
  }
  for (const segId of ['autoAimMode', 'settingsAutoAimMode']) {
    const seg = $(segId);
    if (!seg) continue;
    for (const b of seg.querySelectorAll('button[data-value]')) {
      b.setAttribute('aria-pressed', String(b.dataset.value === mode));
    }
  }
  for (const id of ['hudAutoAim', 'lobbyAutoAim']) {
    const btn = $(id);
    if (!btn) continue;
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-on', on && !isScherp);
    btn.classList.toggle('is-scherp', isScherp);
    btn.classList.toggle('is-off', !on);
    btn.textContent = isScherp ? 'AA 1.5' : on ? 'AA ON' : 'AA OFF';
  }
  const pauseBtn = $('pauseAutoAim');
  if (pauseBtn) {
    pauseBtn.setAttribute('aria-pressed', String(on));
    pauseBtn.classList.toggle('is-on', on && !isScherp);
    pauseBtn.classList.toggle('is-scherp', isScherp);
    pauseBtn.classList.toggle('is-off', !on);
    pauseBtn.textContent = isScherp ? 'AA 1.5 Scherp' : on ? 'オートエイム 標準' : 'オートエイム OFF';
  }
}
function setAutoAimMode(mode, announce = false) {
  const clean = mode === '1.5' ? '1.5' : mode === 'off' ? 'off' : 'standard';
  settings.autoAimMode = clean;
  settings.autoAim = clean !== 'off';
  save();
  if (match) {
    if (typeof match.setAutoAimMode === 'function') match.setAutoAimMode(clean);
    else match.setAutoAim?.(settings.autoAim);
  }
  syncAutoAimUI();
  if (announce && match) {
    $('combatNotice').textContent = clean === '1.5'
      ? 'AA 1.5 Scherp'
      : clean === 'standard' ? 'AA 標準' : 'AA OFF';
    noticeUntil = match.time + 1.4;
  }
  if (screen === 'game') hud();
  if (screen === 'settings') drawSettings();
}
function cycleAutoAimMode(announce = false) {
  const cur = currentAutoAimMode();
  const next = cur === 'off' ? 'standard' : cur === 'standard' ? '1.5' : 'off';
  setAutoAimMode(next, announce);
}
function setAutoAim(on, announce = false) {
  setAutoAimMode(on ? 'standard' : 'off', announce);
}
function isHqTechEnabled() {
  if (settings.lightMode) return false;
  return !!(
    settings.hdr || settings.khdr || settings.shadowMode !== 'off' ||
    settings.fluxGI || settings.schlieren || settings.aeroVortex ||
    settings.thermoFlux || settings.resonance || settings.chronoTrace ||
    settings.fermatCore || settings.spectraField || settings.echoPulse
  );
}
function setHqTechAll(enabled) {
  const on = !!enabled;
  if (on) {
    settings.lightMode = false;
    settings.graphics = 'extra';
    settings.hdr = true;
    settings.khdr = true;
    settings.shadowMode = 'pro';
    settings.shadows = true;
    settings.fluxGI = true;
    settings.schlieren = true;
    settings.aeroVortex = true;
    settings.thermoFlux = true;
    settings.resonance = true;
    settings.chronoTrace = true;
    settings.fermatCore = true;
    settings.spectraField = true;
    settings.echoPulse = true;
    settings.audioMode = 'ultra300';
  } else {
    settings.graphics = 'standard';
    settings.hdr = false;
    settings.khdr = false;
    settings.shadowMode = 'off';
    settings.shadows = false;
    settings.fluxGI = false;
    settings.schlieren = false;
    settings.aeroVortex = false;
    settings.thermoFlux = false;
    settings.resonance = false;
    settings.chronoTrace = false;
    settings.fermatCore = false;
    settings.spectraField = false;
    settings.echoPulse = false;
    flirActive = false;
    chronoActive = false;
  }
  applyLightModeChrome();
  save();
  if (renderer && ready) {
    try { renderer.settings(settings); } catch (error) {
      if (renderer.native) recoverRenderer(error);
      else { ready = false; rendererError(error); }
    }
  }
  drawSettings();
}
function applyLightModeChrome() {
  const lite = !!settings.lightMode;
  document.body.classList.toggle('light-mode', lite);
  const chip = $('liteChip');
  if (chip) chip.hidden = !lite;
  const appEl = $('app');
  if (appEl) {
    appEl.dataset.lightMode = String(lite);
    appEl.dataset.audioMode = effectiveAudioMode();
  }
  audio.setMode(effectiveAudioMode());
}
function setGraphics(key, value) {
  settings[key] = value;
  if (key === 'khdr' && value) settings.hdr = true;
  if (key === 'hdr' && !value) settings.khdr = false;
  if (key === 'shadowMode') settings.shadows = value !== 'off';
  if (settings.lightMode || !settings.thermoFlux) flirActive = false;
  applyLightModeChrome();
  save();
  if (renderer && ready) {
    try { renderer.settings(settings); } catch (error) {
      if (renderer.native) recoverRenderer(error);
      else { ready = false; rendererError(error); }
    }
  }
  drawSettings()
}
function drawSettings() {
  const lite = !!settings.lightMode;
  const hqOn = isHqTechEnabled();
  syncFullscreenUI();
  syncAutoAimUI();
  group('resolution', settings.resolution, k => setGraphics('resolution', k));
  group('graphics', settings.graphics, k => setGraphics('graphics', k));
  group('rate', settings.rate, k => setGraphics('rate', Number(k)));
  group('shadowMode', settings.shadowMode, k => setGraphics('shadowMode', k));
  group('audioMode', settings.audioMode, k => {
    settings.audioMode = k;
    applyLightModeChrome();
    save();
    drawSettings()
  });
  if ($('settingsAutoAimMode')) {
    group('settingsAutoAimMode', currentAutoAimMode(), k => setAutoAimMode(k, false));
  }
  if ($('hqTechSwitch')) $('hqTechSwitch').setAttribute('aria-checked', String(hqOn));
  if ($('hqTechHint')) {
    $('hqTechHint').textContent = lite
      ? '軽量モード適用中'
      : hqOn ? '全技術 ON' : '全技術 OFF';
  }
  $('lightModeSwitch').setAttribute('aria-checked', String(lite));
  $('lightModeHint').textContent = lite ? 'ON · 低負荷描画' : 'OFF';
  const [w, h] = ready && renderer ? [renderer.canvas.width, renderer.canvas.height] : effectiveSize(settings);
  $('resolutionHint').textContent = `${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')} px`;
  $('graphicsHint').textContent = lite ? '軽量モード中' : graphicsHints[settings.graphics];
  $('hdrSwitch').setAttribute('aria-checked', String(settings.hdr));
  $('khdrSwitch').setAttribute('aria-checked', String(settings.khdr));
  $('hdrHint').textContent = lite ? '軽量モード中' : settings.hdr ? 'HDR' : 'SDR';
  $('khdrHint').textContent = lite ? '軽量モード中' : settings.khdr ? 'ON' : 'OFF';
  $('shadowHint').textContent = lite ? '軽量モード中' : shadowHints[settings.shadowMode];
  $('fluxSwitch').setAttribute('aria-checked', String(settings.fluxGI));
  $('fluxHint').textContent = lite ? '軽量モード中' : settings.fluxGI ? 'ON' : 'OFF';
  $('schlierenSwitch').setAttribute('aria-checked', String(settings.schlieren));
  $('schlierenHint').textContent = lite ? '軽量モード中' : settings.schlieren ? 'ON' : 'OFF';
  $('aeroSwitch').setAttribute('aria-checked', String(settings.aeroVortex));
  $('aeroHint').textContent = lite ? '軽量モード中' : settings.aeroVortex ? 'ON' : 'OFF';
  $('thermoSwitch').setAttribute('aria-checked', String(settings.thermoFlux));
  $('thermoHint').textContent = lite ? '軽量モード中' : settings.thermoFlux ? 'ON' : 'OFF';
  $('resonanceSwitch').setAttribute('aria-checked', String(settings.resonance));
  $('resonanceHint').textContent = lite ? '軽量モード中' : settings.resonance ? 'ON' : 'OFF';
  $('chronoSwitch').setAttribute('aria-checked', String(settings.chronoTrace));
  $('chronoHint').textContent = settings.chronoTrace ? 'ON' : 'OFF';
  $('fermatSwitch').setAttribute('aria-checked', String(settings.fermatCore));
  $('fermatHint').textContent = settings.fermatCore ? 'ON' : 'OFF';
  $('spectraSwitch').setAttribute('aria-checked', String(settings.spectraField));
  $('spectraHint').textContent = settings.spectraField ? 'ON' : 'OFF';
  $('echoSwitch').setAttribute('aria-checked', String(settings.echoPulse));
  $('echoHint').textContent = settings.echoPulse ? 'ON' : 'OFF';
  $('audioHint').textContent = lite ? '軽量ステレオ' : audioHints[settings.audioMode];
  $('sensitivity').value = settings.sensitivity;
  $('sensVal').value = settings.sensitivity.toFixed(1) + '×';
  $('volume').value = settings.volume;
  $('volumeVal').value = settings.volume + '%';
  $('settingStatus').textContent = lite ? '軽量モード' : '自動保存'
}
$('play').onclick = () => {
  if (settings.sound)audio.enable(true).then(soundButton);
  show('lobby')
};
$('lobbyBack').onclick = () => show('title');
$('settingsOpen').onclick = () => {
  previous = 'title';
  show('settings')
};
$('settingsClose').onclick = $('settingsDone').onclick = () => show(previous);
$('pauseSettings').onclick = () => {
  previous = 'pause';
  show('settings')
};
for (const id of ['fullscreenTitle', 'lobbyFullscreen', 'fullscreenSettings', 'hudFullscreen', 'pauseFullscreen']) {
  const el = $(id);
  if (el) el.onclick = () => { el.blur?.(); toggleFullscreen(); };
}
if ($('autoAimSwitch')) {
  $('autoAimSwitch').onclick = () => setAutoAim(!(settings.autoAim !== false), screen === 'game');
}
for (const id of ['lobbyAutoAim', 'hudAutoAim', 'pauseAutoAim']) {
  const el = $(id);
  if (el) el.onclick = () => { el.blur?.(); cycleAutoAimMode(screen === 'game'); };
}
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(ev, () => {
    syncFullscreenUI();
    if (ready && renderer) {
      try { renderer.resize(); } catch {}
    }
  });
}
$('sound').onclick = async() => {
  settings.sound = !(settings.sound && audio.on && settings.volume);
  if (settings.sound && !settings.volume)settings.volume = 55;
  audio.setMode(effectiveAudioMode());
  audio.set(settings.volume / 100);
  await audio.enable(settings.sound);
  save();
  soundButton()
};
if ($('hqTechSwitch')) $('hqTechSwitch').onclick = () => setHqTechAll(!isHqTechEnabled());
$('lightModeSwitch').onclick = () => setGraphics('lightMode', !settings.lightMode);
$('hdrSwitch').onclick = () => setGraphics('hdr', !settings.hdr);
$('khdrSwitch').onclick = () => setGraphics('khdr', !settings.khdr);
$('fluxSwitch').onclick = () => setGraphics('fluxGI', !settings.fluxGI);
$('schlierenSwitch').onclick = () => setGraphics('schlieren', !settings.schlieren);
$('aeroSwitch').onclick = () => setGraphics('aeroVortex', !settings.aeroVortex);
$('thermoSwitch').onclick = () => {
  setGraphics('thermoFlux', !settings.thermoFlux);
  if (!settings.thermoFlux) flirActive = false;
};
$('resonanceSwitch').onclick = () => setGraphics('resonance', !settings.resonance);
$('chronoSwitch').onclick = () => {
  setGraphics('chronoTrace', !settings.chronoTrace);
  if (!settings.chronoTrace) chronoActive = false;
};
$('fermatSwitch').onclick = () => {
  settings.fermatCore = !settings.fermatCore;
  save();
  drawSettings();
};
$('spectraSwitch').onclick = () => {
  settings.spectraField = !settings.spectraField;
  save();
  drawSettings();
};
$('echoSwitch').onclick = () => {
  settings.echoPulse = !settings.echoPulse;
  save();
  drawSettings();
};
$('sensitivity').oninput = e => {
  settings.sensitivity = Number(e.target.value);
  $('sensVal').value = settings.sensitivity.toFixed(1) + '×';
  save()
};
$('volume').oninput = e => {
  settings.volume = Number(e.target.value);
  audio.setMode(effectiveAudioMode());
  audio.set(settings.volume / 100);
  if (settings.sound && settings.volume > 0) audio.enable(true).then(soundButton);
  else soundButton();
  $('volumeVal').value = settings.volume + '%';
  save()
};
$('mult').oninput = e => {
  const n = Number(e.target.value);
  if (!Number.isInteger(n) || n < 1 || n > 99)return;
  rules.multiplier = n;
  save();
  lobby()
};
$('mult').onchange = e => {
  rules.multiplier = scoreMultiplier(e.target.value);
  e.target.value = rules.multiplier;
  save();
  lobby()
};
function pointer() {
  if (document.pointerLockElement || lockPending || screen !== 'game' || !scene.requestPointerLock) return;
  try {
    lockPending = true;
    const p = scene.requestPointerLock();
    if (p?.catch)p.catch (() => {}).finally(() => {
      lockPending = false;
    }); else setTimeout(() => {
      lockPending = false
    }, 300)
  } catch {
    lockPending = false;
  }
}
function toggleFlir() {
  if (screen !== 'game' || !match?.player.alive) return;
  if (!renderer?.native) {
    $('combatNotice').textContent = '現在の互換描画では FLIR を使用できません';
    noticeUntil = match.time + 2;
    return;
  }
  if (settings.lightMode || !settings.thermoFlux) {
    $('combatNotice').textContent = '軽量モード／ThermoFlux オフ時は FLIR を使用できません';
    noticeUntil = match.time + 2.0;
    return;
  }
  flirActive = !flirActive;
  audioSafely(() => audio.event({type: 'flir', on: flirActive}, match.player));
  $('combatNotice').textContent = flirActive ? 'ThermoFlux FLIR 熱視界 ON · 貫煙熱痕探知' : 'FLIR 熱視界 OFF';
  noticeUntil = match.time + 1.4;
  hud();
}
function triggerSmokeVent() {
  if (screen !== 'game' || !match?.player.alive) return;
  if (!match.deploySmokeVent(match.player)) {
    const cd = Math.ceil(match.smokeCooldown || 0);
    $('combatNotice').textContent = `流体煙幕リチャージ中（残り ${cd}s）`;
    noticeUntil = match.time + 1.1;
  }
}
function toggleChrono() {
  if (screen !== 'game' || !match) return;
  if (!settings.chronoTrace) {
    $('combatNotice').textContent = 'ChronoTrace 1.0 がオフになっています（設定から有効化）';
    noticeUntil = match.time + 1.8;
    return;
  }
  chronoActive = !chronoActive;
  audioSafely(() => audio.event({type: 'chrono', on: chronoActive}, match.player));
  $('combatNotice').textContent = chronoActive ? 'ChronoTrace 1.0 · 4D空間弾道スキャナー ON（過去22秒の弾道を3D投影）' : '4D空間弾道スキャナー OFF';
  noticeUntil = match.time + 1.6;
  hud();
}
function startMatch() {
  if (!ready || screen !== 'lobby') return;
  feed = [];
  gameKick = hurt = 0;
  noticeUntil = 0;
  flirActive = false;
  chronoActive = false;
  spectraAt = 0;
  spectateCam = 'tps';
  spectateIdx = 0;
  rules.lab = normalizeLabConfig(rules.lab);
  rules.aiModel = 'human';
  rules.allyNv21 = 0;
  liveSimSpeed = rules.mode === 'lab' ? (rules.lab.simSpeed || 1) : 1;
  resetMotion();
  audio.resetMatch();
  const aaMode = currentAutoAimMode();
  match = new Match({
    ...rules,
    aiModel: 'human',
    allyNv21: 0,
    lab: rules.mode === 'lab' ? rules.lab : undefined,
    autoAimMode: aaMode,
    autoAim: aaMode !== 'off'
  }, event);
  match.viewActor = match.spectating ? getViewActor() : match.player;
  equipment.prepare(match.player);
  syncAutoAimUI();
  syncFullscreenUI();
  show('game');
  if (!touch && !match.spectating) pointer();
  audio.setMode(effectiveAudioMode());
  if (settings.sound)audio.enable(true);
  audio.set(settings.volume / 100);
  $('startHint').hidden = false;
  $('startHint').textContent = match.spectating
    ? 'Q/E 切替 · C FPS/TPS/FREE · 1-0 選択'
    : touch ? '左傾ダッシュ · 右上 AA / 全画面' : 'WASD 移動 · 4/Z 技 · O AA · U 全画面';
  const assigned = !match.spectating && match.player?.assignedSkill;
  $('combatNotice').textContent = assigned
    ? `技: ${assigned === 'shaffer' ? 'シャッファー' : 'リチャージヒール'}`
    : '';
  noticeUntil = assigned ? match.time + 2.2 : 0;
  $('feed').replaceChildren();
  delete $('feed').dataset.stamp;
  if ($('specActors')) { $('specActors').replaceChildren(); delete $('specActors').dataset.stamp; }
  hud();
}
function doPause() {
  if (screen === 'game' && match && !match.ended)show('pause')
}
$('start').onclick = startMatch;
$('pauseButton').onclick = doPause;
$('resume').onclick = () => {
  show('game');
  if (!touch && !match?.spectating) pointer();
};
$('endMatch').onclick = () => {
  if (screen === 'pause' && match) {
    match.end();
  }
};
$('rematch').onclick = () => show('lobby');
$('resultTitle').onclick = () => show('title');
function event(e) {
  // All NPC-to-NPC communication & tactical orders remain strictly internal
  if (e.type === 'npcSignal') return;
  const viewA = getViewActor() || match?.player;
  const p = match?.spectating ? (spectateCam === 'fps' ? viewA : null) : match?.player;
  if (!viewA) return;
  audioSafely(() => audio.event(e, viewA));
  if (e.type === 'fire' && p && e.actor === p) kickWeapon(e.gun || p.gun);
  if (e.type === 'scherplock' && p && e.actor === p) {
    gunMotion.vrdSnap += 1.9;
    gunMotion.vroll -= .55;
    gunMotion.vz += .12;
  }
  if (e.type === 'rdlock' && p && e.actor === p) {
    // Crisp tactical cant lock-snap kick on RD40 target acquisition (zero camera shake)
    gunMotion.vrdSnap += 2.1;
    gunMotion.vroll -= .72;
    gunMotion.vz += .16;
  }
  if (e.type === 'd01' && p && e.actor === p) {
    // Smooth optical-radar sensor pod deploy rise impulse
    gunMotion.vrdSnap += 1.35;
    gunMotion.vy += .12;
  }
  if (e.type === 'aa14' && p && e.actor === p) {
    if (e.state === 'on') {
      gunMotion.vrdSnap += 2.3;
      gunMotion.vroll -= .82;
      gunMotion.vz += .14;
    } else if (e.state === 'overheat') {
      gunMotion.vrdSnap -= 1.4;
      gunMotion.vz += .22;
      $('combatNotice').textContent = `AA1.4 過熱 ${(e.cooldown || 6).toFixed(1)}s`;
      noticeUntil = match.time + 2.2;
    } else if (e.state === 'ready') {
      $('combatNotice').textContent = 'AA1.4 準備完了';
      noticeUntil = match.time + 1.5;
    }
  }
  if (e.type === 'smoke' && p && e.actor === p) {
    $('combatNotice').textContent = settings.aeroVortex && !settings.lightMode && renderer.native
      ? '煙幕展開'
      : '煙幕展開（非表示）';
    noticeUntil = match.time + 1.8;
  }
  if (e.type === 'resonate' && p && e.actor === p && e.knockedEnemy) {
    const bn = $('hitBanner');
    bn.textContent = 'SEISMIC KNOCK';
    bn.className = 'is-knock';
    hitState.bannerAge = 0;
    hitState.bannerDur = .86;
    const ms = Number.isFinite(e.waveDelayMs) ? e.waveDelayMs.toFixed(1) : '1.2';
    $('combatNotice').textContent = `KNOCK ${ms}ms · ${e.knockedEnemy.name}`;
    noticeUntil = match.time + 2.0;
  }
  if (e.type === 'spawn' && !match.spectating && e.actor === match.player) {
    resetMotion();
    gameKick = hurt = 0;
    holdFireMouse = holdFireKey = holdFireTouch = holdFirePad = false;
    fireTouch = fireTouchLast = mousePointer = null;
    $('touchFire')?.classList.remove('is-active');
    padFireArmed = false;
    flirActive = false;
    simJump = false;
  }
  if (e.type === 'hit' && p) {
    if (e.actor === p) triggerHitUI(e);
    if (e.victim === p) triggerDamageUI(e, p);
  }
  if (e.type === 'tanker' && p && e.actor === p) {
    $('combatNotice').textContent = '補給 +100 · 1.5×';
    noticeUntil = match.time + 2.2;
  }
  if (e.type === 'baizer' && p && e.actor === p) {
    const gained = e.gained ?? e.amount;
    const tot = e.total ?? p.baizerShield;
    $('combatNotice').textContent = `BAIZER +${gained} (${tot}/${BAIZER_MAX_STACK})`;
    noticeUntil = match.time + 2.2;
  }
  if (e.type === 'skill_charge' && p && e.actor === p) {
    const skName = p.assignedSkill === 'shaffer' ? 'シャッファー' : p.assignedSkill === 'heal' ? 'リチャージヒール' : '';
    if (skName) {
      $('combatNotice').textContent = `技チャージ (${e.charges}/${MAX_SKILL_CHARGES}) · ${skName}`;
      noticeUntil = match.time + 2.4;
    }
  }
  if (e.type === 'skill' && p && e.actor === p) {
    if (e.skill === 'shaffer') {
      $('combatNotice').textContent = `シャッファー ${(e.duration || 12).toFixed(0)}s`;
      noticeUntil = match.time + 2.2;
    } else if (e.skill === 'heal') {
      healPulse = 1;
      $('combatNotice').textContent = 'リチャージヒール';
      noticeUntil = match.time + 1.8;
    }
  }
  if (e.type === 'reload' && p && e.actor === p && e.auto) {
    $('combatNotice').textContent = '自動装填';
    noticeUntil = match.time + 1.0;
  }
  if (e.type === 'point') {
    const aTag = e.actor.isSpy ? `${e.actor.name}<span class="tag-nv21">2.1</span>` : e.actor.name;
    const vTag = e.victim.isSpy ? `${e.victim.name}<span class="tag-nv21">2.1</span>` : e.victim.name;
    feed.push({line: `${aTag}　›　${vTag}`, team: e.actor.team, until: match.time + 4.5});
    equipment.award(e)
  }
  if (e.type === 'dry' && p && e.actor === p) {
    $('combatNotice').textContent = p.stock ? 'R 再装填' : '弾丸生成中';
    noticeUntil = match.time + .8;
  }
  if (e.type === 'end') show('results');
}
function triggerSkill(skill) {
  if (screen !== 'game' || !match || match.spectating || !match.player?.alive) return false;
  const a = match.player;
  const chosen = skill || a.assignedSkill;
  if (!chosen || chosen !== a.assignedSkill) return false;
  if ((a.skillCharges || 0) <= 0) {
    $('combatNotice').textContent = `チャージ ${a.skillKills || 0}/${KILLS_PER_SKILL_CHARGE}`;
    noticeUntil = match.time + 1.2;
    return false;
  }
  if (chosen === 'shaffer' && (a.shafferTimer || 0) > 0) {
    $('combatNotice').textContent = `発動中 ${a.shafferTimer.toFixed(1)}s`;
    noticeUntil = match.time + 1.0;
    return false;
  }
  const maxHp = a.maxHp || 100;
  if (chosen === 'heal' && a.hp >= maxHp) {
    $('combatNotice').textContent = 'HP満タン';
    noticeUntil = match.time + 1.0;
    return false;
  }
  const ok = match.useSkill(a, chosen);
  if (ok) hud();
  return ok;
}
function hud() {
  if (!match) return;
  const spec = !!match.spectating;
  const a = getViewActor() || match.player;
  match.viewActor = (spec && spectateCam === 'free') ? null : a;
  document.body.classList.toggle('is-spectating', spec);

  $('scoreA').textContent = match.scores[0];
  $('scoreB').textContent = match.scores[1];
  $('hudRule').textContent = Number.isFinite(match.goals[0]) ? (match.goals[0] === match.goals[1] ? `${match.goals[0]} 点先取` : `${match.goals[0]} / ${match.goals[1]} 点先取`) : '無制限';

  // Lab / Spectator Control Bar
  const specBar = $('specBar');
  if (specBar) {
    specBar.hidden = !match.isLab;
    if (match.isLab) {
      if ($('specCamBtns')) {
        $('specCamBtns').hidden = !spec;
        if (spec) group('specCamBtns', spectateCam, k => setSpectateCam(k));
      }
      if ($('labLiveSpeed')) {
        group('labLiveSpeed', String(liveSimSpeed), k => {
          liveSimSpeed = Number(k) || 1;
          hud();
        });
      }
      const actorStrip = $('specActors');
      if (actorStrip) {
        actorStrip.hidden = !spec;
        if (spec) {
          const stamp = match.actors.map((x, idx) => `${idx}:${x.alive ? Math.ceil(x.hp) : 'X'}:${idx === spectateIdx ? 1 : 0}:${x.aaOverride || ''}`).join('|');
          if (actorStrip.dataset.stamp !== stamp) {
            actorStrip.dataset.stamp = stamp;
            actorStrip.innerHTML = match.actors.map((x, idx) => {
              const aaTag = x.aaOverride && x.aaOverride !== 'off' ? `<em>${x.aaOverride}</em>` : '';
              return `<button type="button" data-idx="${idx}" class="spec-chip ${x.team ? 'orange' : 'cyan'}${idx === spectateIdx ? ' is-sel' : ''}${x.alive ? '' : ' is-dead'}">${x.name}${aaTag}</button>`;
            }).join('');
            for (const btn of actorStrip.querySelectorAll('button[data-idx]')) {
              btn.onclick = () => {
                spectateIdx = Number(btn.dataset.idx);
                hud();
              };
            }
          }
        }
      }
      const liveStats = $('labLiveStats');
      if (liveStats && match.telemetry) {
        const sum = match.telemetry.getSummary();
        const sc = sum.teamA.scherpHits + sum.teamB.scherpHits;
        liveStats.textContent = `A ${sum.teamA.accuracyPct}% · B ${sum.teamB.accuracyPct}%${sc ? ` · 1.5×${sc}` : ''}`;
      }
    }
  }

  const hideCombatHud = spec && spectateCam === 'free';
  if ($('bottomDock')) $('bottomDock').hidden = hideCombatHud;
  if ($('vitals')) $('vitals').hidden = hideCombatHud;
  if ($('weaponHud')) $('weaponHud').hidden = hideCombatHud;
  if ($('tacStrip')) $('tacStrip').hidden = spec;
  if ($('touchUI')) $('touchUI').hidden = spec;

  const maxHp = a.maxHp || 100;
  $('hpVal').textContent = Math.ceil(a.hp);
  $('shieldVal').textContent = Math.ceil(a.shield);
  $('hpBar').style.width = clamp((a.hp / maxHp) * 100, 0, 100) + '%';
  $('shieldBar').style.width = clamp((a.shield / BASE_SHIELD_MAX) * 100, 0, 100) + '%';
  const bzVal = Math.max(0, a.baizerShield || 0);
  const bzRow = $('baizerRow');
  if (bzRow) {
    bzRow.hidden = bzVal <= 0;
    if (bzVal > 0) {
      $('baizerVal').textContent = Math.ceil(bzVal);
      $('baizerBar').style.width = clamp((bzVal / BAIZER_MAX_STACK) * 100, 0, 100) + '%';
    }
  }
  const shActive = a.alive && (a.shafferTimer || 0) > 0;
  const shVeil = $('shafferVeil');
  if (shVeil) {
    shVeil.hidden = !(shActive && (!spec || spectateCam === 'fps'));
    if (!shVeil.hidden) $('shafferBadge').textContent = `シャッファー ${a.shafferTimer.toFixed(1)}s`;
  }
  const assigned = a.assignedSkill || null;
  const skillBar = $('skillBar');
  if (skillBar) {
    skillBar.hidden = spec || !assigned;
  }
  const charges = a.skillCharges || 0;
  const kills = a.skillKills || 0;
  const pips = $('skillPips');
  if (pips) {
    const kids = pips.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('is-full', i < charges);
  }
  if ($('skillProg')) $('skillProg').textContent = charges >= MAX_SKILL_CHARGES ? `MAX ${charges}/${MAX_SKILL_CHARGES}` : `${kills}/${KILLS_PER_SKILL_CHARGE}`;
  const btnSh = $('btnShaffer');
  if (btnSh) {
    btnSh.hidden = assigned !== 'shaffer';
    btnSh.classList.toggle('is-ready', charges > 0 && !shActive && a.alive);
    btnSh.classList.toggle('is-active', shActive);
    btnSh.disabled = !a.alive || (!shActive && charges <= 0);
    if ($('shafferLabel')) $('shafferLabel').textContent = shActive ? `シャッファー ${a.shafferTimer.toFixed(1)}s` : 'シャッファー';
  }
  const btnHl = $('btnHeal');
  if (btnHl) {
    btnHl.hidden = assigned !== 'heal';
    btnHl.classList.toggle('is-ready', charges > 0 && a.hp < maxHp && a.alive);
    btnHl.disabled = !a.alive || charges <= 0 || a.hp >= maxHp;
  }
  $('gunName').textContent = spec ? `${a.name} · ${a.gun}` : a.gun;
  $('magVal').textContent = a.mag;
  $('stockVal').textContent = match.infiniteAmmo ? '∞' : a.stock;
  const relWrap = $('reloadBarWrap');
  if (relWrap) {
    relWrap.hidden = !(a.reload > 0);
    if (a.reload > 0) $('reloadBar').style.width = clamp((a.reloadFrac || 0) * 100, 0, 100) + '%';
  }
  $('reloadLabel').textContent = a.reload > 0 ? `${a.autoReloading ? '自動装填' : '再装填'} ${a.reload.toFixed(1)} s` : a.mag > 0 ? '予備弾' : a.stock ? '自動装填待機' : '予備弾を生成中';
  $('ammoBoost').hidden = !((a.ammoRate || 1) > 1.01);
  let nearestTk = null, nearestDist = 18;
  for (const tk of match.tankers || []) {
    const d = Math.hypot(tk.x - a.x, tk.z - a.z);
    if (d < nearestDist) {
      nearestDist = d;
      nearestTk = tk
    }
  }
  $('tankerHint').textContent = spec || !a.alive || !nearestTk ? '' : nearestTk.cooldown <= 0 ? `補給 ${Math.round(nearestDist)}m` : `補給 ${Math.ceil(nearestTk.cooldown)}s`;
  let nearestBz = null, nearestBzDist = 18;
  for (const bz of match.baizers || []) {
    if (bz.cooldown > 0) continue;
    const d = Math.hypot(bz.x - a.x, bz.z - a.z);
    if (d < nearestBzDist) {
      nearestBzDist = d;
      nearestBz = bz;
    }
  }
  if ($('baizerHint')) {
    $('baizerHint').textContent = spec || !a.alive || !nearestBz ? '' : `${nearestBz.kind} ${Math.round(nearestBzDist)}m`;
  }
  $('respawn').hidden = spec || a.alive;
  $('reticle').hidden = !a.alive || !!a.df?.ads;
  if (spec && spectateCam !== 'fps') $('reticle').hidden = true;
  $('reticle').classList.toggle('is-ms10', a.gun === 'MS10');
  $('reticle').classList.toggle('is-rd20', a.gun === 'RD20');
  $('reticle').classList.toggle('is-rd30', a.gun === 'RD30');
  $('reticle').classList.toggle('is-rd40', a.gun === 'RD40');
  $('reticle').classList.toggle('is-rd50', a.gun === 'RD 50');
  $('reticle').classList.toggle('is-df40ii', a.gun === 'DF40 II');
  $('spawnCounter').textContent = Math.max(0, a.respawn).toFixed(1) + ' s';
  // Update AeroVortex wind meter, ThermoFlux FLIR status & SpectraField / KineticFlow hologram!
  const flirOn = !spec && flirActive && renderer.native && !settings.lightMode && settings.thermoFlux && a.alive;
  $('flirFrame').hidden = !flirOn;
  $('tacFlir')?.classList.toggle('is-on', flirOn);
  $('touchFlir')?.classList.toggle('is-active', flirOn);
  const chronoOn = chronoActive && settings.chronoTrace;
  $('tacChrono')?.classList.toggle('is-on', chronoOn);
  $('touchChrono')?.classList.toggle('is-active', chronoOn);
  const appEl = $('app');
  if (appEl) {
    appEl.dataset.flirActive = String(flirOn);
    appEl.dataset.chronoActive = String(chronoOn);
  }
  const cBan = $('chronoBanner');
  if (cBan && match.chronoTrace) {
    const deathTr = !spec && !a.alive && settings.chronoTrace ? match.chronoTrace.lastPlayerDeathTrace : null;
    if (deathTr) {
      cBan.hidden = false;
      cBan.className = 'is-death';
      cBan.textContent = `撃破弾道 · ${match.chronoTrace.formatTelemetry(deathTr)}`;
    } else if (chronoOn && (spec || a.alive)) {
      cBan.hidden = false;
      cBan.className = '';
      cBan.textContent = match.chronoTrace.formatTelemetry() || 'CHRONOTRACE 1.0';
    } else {
      cBan.hidden = true;
    }
  }
  const smCd = Math.ceil(match.smokeCooldown || 0);
  const tacSm = $('tacSmoke');
  if (tacSm) {
    tacSm.textContent = smCd > 0 ? `G · 煙幕 ${smCd}s` : 'G · 煙幕';
    tacSm.classList.toggle('is-ready', smCd <= 0);
  }
  const tSm = $('touchSmoke');
  if (tSm) {
    tSm.textContent = smCd > 0 ? `${smCd}s` : '煙幕';
    tSm.classList.toggle('is-cd', smCd > 0);
  }
  if (match.aeroVortex && $('windVal')) {
    const w = match.aeroVortex.sample(a.x, a.z);
    $('windVal').textContent = `風 ${w.speed.toFixed(1)}m/s`;
  }
  const specBox = $('spectraBox');
  if (specBox && match.spectraField) {
    const showSpec = !!settings.spectraField && (spec || a.alive);
    specBox.hidden = !showSpec;
    if (showSpec && timeNow >= spectraAt) {
      spectraAt = timeNow + (settings.lightMode ? .25 : .12);
      const cv = $('spectraCanvas');
      match.spectraField.renderHologram(cv, match);
      if (match.isLab && match.kineticFlow && cv) {
        const ctx = cv.getContext('2d');
        if (ctx) match.kineticFlow.renderFlowOverlay(ctx, cv.width, cv.height, a.team || 0);
      }
      $('spectraCert').textContent = Math.round((match.spectraField.certainty[a.team || 0] || 0) * 100) + '%';
    }
  }
  if (match.time > 9) $('startHint').hidden = true;
  if (noticeUntil <= match.time) $('combatNotice').textContent = '';
  feed = feed.filter(x => x.until > match.time).slice(-3);
  const stamp = feed.map(x => x.team + ':' + x.line).join('/');
  if ($('feed').dataset.stamp !== stamp) {
    $('feed').dataset.stamp = stamp;
    $('feed').innerHTML = feed.map(x => `<div class="feed-line ${x.team?'orange':'cyan'}">${x.line}</div>`).join('')
  }
}
function resultUI() {
  if (!match) return;
  $('outcome').textContent = match.winner === null ? '試合終了' : match.winner === 0 ? '味方勝利' : '敵勝利';
  $('finalA').textContent = match.scores[0];
  $('finalB').textContent = match.scores[1];
  $('roster').innerHTML = '<div class="roster-row heading"><span>参加者</span><span>撃破</span><span>ダウン</span></div>' + match.actors.map(a => {
    const aaChip = a.aaOverride && a.aaOverride !== 'off'
      ? `<span class="${a.aaOverride === '1.5' ? 'tag-scherp' : 'tag-nv21'}">${a.aaOverride === '1.5' ? '1.5 Scherp' : 'AA ' + a.aaOverride}</span>`
      : '';
    const tag = a.human
      ? ` · 自分${aaChip}`
      : a.isSpy
        ? `<span class="tag-nv21">${a.aiVersion || 'NV2.1 SPY'}</span>${aaChip}`
        : a.aiVersion
          ? `<span class="tag-human">${a.aiVersion}</span>${aaChip}`
          : aaChip;
    return `<div class="roster-row"><span class="${a.team?'orange':'cyan'}">${a.name}${tag}</span><span>${a.kills}</span><span>${a.deaths}</span></div>`;
  }).join('');
  equipment.result(match);
  const synEl = $('synapseReport');
  if (synEl && match.synapse) {
    const s = match.synapse.getSummary();
    const qt = match.telemetry?.getSummary();
    const ts = match.techStats || {ricochets: 0, ricochetHits: 0, penetrations: 0, wallbangHits: 0};
    const [lw, lc, le] = s.lanesPct;
    synEl.hidden = false;
    const qtHtml = qt
      ? `<div class="syn-chips lab-qt">` +
        `<span>A 命中 <b>${qt.teamA.accuracyPct}%</b> · <b>${qt.teamA.damage}</b> DMG${qt.teamA.avgTtkMs ? ` · ${qt.teamA.avgTtkMs}ms` : ''}</span>` +
        `<span>B 命中 <b>${qt.teamB.accuracyPct}%</b> · <b>${qt.teamB.damage}</b> DMG${qt.teamB.avgTtkMs ? ` · ${qt.teamB.avgTtkMs}ms` : ''}</span>` +
        `<span>支配率 <b>${qt.dominanceA}:${qt.dominanceB}</b></span>` +
        ((qt.teamA.scherpHits + qt.teamB.scherpHits) > 0 ? `<span class="chip-scherp">1.5 Scherp <b>${qt.teamA.scherpHits + qt.teamB.scherpHits}</b> HIT${(qt.teamA.scherpBankHits + qt.teamB.scherpBankHits) > 0 ? ` / BANK ${qt.teamA.scherpBankHits + qt.teamB.scherpBankHits}` : ''}</span>` : '') +
        ((qt.teamA.baizerAbsorbed + qt.teamB.baizerAbsorbed) > 0 ? `<span>BAIZER吸収 <b>${qt.teamA.baizerAbsorbed + qt.teamB.baizerAbsorbed}</b></span>` : '') +
        (qt.ccdCorrections > 0 ? `<span>CCD補正 <b>${qt.ccdCorrections}</b></span>` : '') +
        `<span>跳弾 <b>${ts.ricochets}</b>${ts.ricochetHits ? `(${ts.ricochetHits})` : ''}</span>` +
        `<span>貫通 <b>${ts.penetrations}</b>${ts.wallbangHits ? `(${ts.wallbangHits})` : ''}</span>` +
        `</div>`
      : '';
    synEl.innerHTML =
      (match.isLab ? '' :
        `<div class="syn-head"><span class="syn-badge">SYNAPSE</span><span class="syn-meta">${s.archetypeJa}</span></div>` +
        `<div class="syn-lanes"><div class="syn-lane-labels"><span>西 ${lw}%</span><span>中央 ${lc}%</span><span>東 ${le}%</span></div><div class="syn-lane-bar"><i class="syn-w" style="width:${lw}%"></i><i class="syn-c" style="width:${lc}%"></i><i class="syn-e" style="width:${le}%"></i></div></div>`
      ) + qtHtml;
  } else if (synEl) {
    synEl.hidden = true;
  }
}
function turn(dx, dy) {
  if (screen !== 'game' || !match) return;
  if (match.spectating) {
    if (spectateCam === 'tps') {
      tpsOrbit.yaw += dx * .0038 * settings.sensitivity;
      tpsOrbit.pitch = clamp(tpsOrbit.pitch - dy * .0030 * settings.sensitivity, -1.2, 0.35);
    } else if (spectateCam === 'free') {
      freeCam.yaw += dx * .0030 * settings.sensitivity;
      freeCam.pitch = clamp(freeCam.pitch - dy * .0030 * settings.sensitivity, -1.45, 1.45);
    }
    return;
  }
  if (!match.player.alive) return;
  const a = match.player, fovScale = a.df?.ads ? .43 : .63, k = .00215 * settings.sensitivity * fovScale;
  const dYaw = dx * k, dPitch = -dy * k;
  a.yaw += dYaw;
  a.pitch = clamp(a.pitch + dPitch, -1.31, 1.31);
  // Manual recoil compensation cancels stored auto-recovery so crosshair never yanks below target.
  if (dPitch < 0 && recoilState.pitch > 0) recoilState.pitch = Math.max(0, recoilState.pitch + dPitch);
  if (dYaw * recoilState.yaw < 0) {
    recoilState.yaw = Math.abs(dYaw) >= Math.abs(recoilState.yaw) ? 0 : recoilState.yaw + dYaw;
  }
  gunMotion.swayX = clamp(gunMotion.swayX - dx * .00024, -.042, .042);
  gunMotion.swayY = clamp(gunMotion.swayY + dy * .00020, -.032, .032)
}
function fire() {
  if (screen === 'game' && match && !match.spectating) match.trigger(match.player);
}
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.isComposing || e.altKey || e.metaKey) return;
  if (e.code === 'Escape') {
    if (e.repeat) return;
    if (screen === 'game') doPause();
    else if (screen === 'settings') show(previous);
    else if (screen === 'lobby') show('title');
    else if (screen === 'pause') $('resume').click();
    return;
  }
  if (screen !== 'game' || !match || document.hidden || e.target?.closest?.('input, textarea, select, [contenteditable=true]')) return;
  if (e.code === 'Space' && e.target?.closest?.('button')) return;
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyR', 'KeyT', 'KeyG', 'KeyL', 'KeyK', 'KeyM', 'KeyO', 'KeyU', 'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'KeyZ', 'KeyH'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyP') { doPause(); return; }
  if (e.code === 'KeyU') { toggleFullscreen(); return; }
  if (e.code === 'KeyL') { toggleChrono(); return; }
  if (e.code === 'KeyM') {
    settings.spectraField = !settings.spectraField;
    save();
    hud();
    return;
  }
  if (match.spectating) {
    if (e.code === 'KeyC') {
      const order = ['fps', 'tps', 'free'];
      setSpectateCam(order[(order.indexOf(spectateCam) + 1) % order.length]);
    } else if (e.code === 'KeyQ') {
      cycleSpectateActor(-1);
    } else if (e.code === 'KeyE' || e.code === 'Tab') {
      cycleSpectateActor(1);
    } else if (/^Digit[0-9]$/.test(e.code)) {
      const d = Number(e.code.slice(5));
      const idx = d === 0 ? 9 : d - 1;
      if (idx < match.actors.length) {
        spectateIdx = idx;
        hud();
      }
    }
    return;
  }
  if (e.code === 'KeyF' && match.player.alive) holdFireKey = true;
  if (e.code === 'KeyR') match.reload(match.player);
  if (e.code === 'KeyF') fire();
  if (e.code === 'KeyT') toggleFlir();
  if (e.code === 'KeyG') triggerSmokeVent();
  if (e.code === 'KeyO') cycleAutoAimMode(true);
  if (e.code === 'Digit4' || e.code === 'KeyZ' || e.code === 'Digit5' || e.code === 'KeyH') triggerSkill(match.player?.assignedSkill);
  if (e.code === 'KeyK') {
    settings.fermatCore = !settings.fermatCore;
    save();
    $('combatNotice').textContent = settings.fermatCore ? 'FermatCore ON' : 'FermatCore OFF';
    noticeUntil = match.time + 1.4;
  }
  if (e.code === 'Space' && match.player.alive) simJump = true;
  const extra = {KeyQ: 'pattern', KeyX: 'boost', KeyE: 'aa14', KeyC: 'ads', KeyV: 'scope', KeyB: 'buy'}[e.code];
  if (extra) equipment.action(extra);
});
document.addEventListener('keyup', e => {
  keys.delete(e.code);
  if (e.code === 'KeyF')holdFireKey = false;
});
let wasLocked = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === $('scene');
  if (wasLocked && !locked && screen === 'game') doPause();
  if (locked && screen !== 'game') document.exitPointerLock?.();
  wasLocked = locked && screen === 'game';
  lockPending = false;
});
document.addEventListener('pointerlockerror', () => {
  lockPending = false;
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === $('scene'))turn(e.movementX, e.movementY)
});
window.addEventListener('mouseup', e => {
  if (e.button === 0) { holdFireMouse = false; mousePointer = null; }
});
window.addEventListener('blur', () => {
  holdFireMouse = holdFireKey = holdFireTouch = holdFirePad = false;
  fireTouch = fireTouchLast = null;
  $('touchFire')?.classList.remove('is-active');
  doPause()
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    holdFireMouse = holdFireKey = holdFireTouch = holdFirePad = false;
    fireTouch = fireTouchLast = null;
    $('touchFire')?.classList.remove('is-active');
    doPause()
  }
  lastTime = null;
  nextFrame = 0
});
const scene = $('scene');
function capturePointer(element, id) {
  try { element.setPointerCapture(id); } catch {}
}
scene.oncontextmenu = e => e.preventDefault();
scene.addEventListener('pointerdown', e => {
  if (screen !== 'game' || document.hidden) return;
  if (match?.spectating) {
    if (e.pointerType === 'touch') {
      if (lookTouch !== null) return;
      lookTouch = e.pointerId;
      aimTouchLast = [e.clientX, e.clientY];
      capturePointer(scene, e.pointerId);
    } else if (e.button === 0) {
      dragID = e.pointerId;
      aimTouchLast = [e.clientX, e.clientY];
      capturePointer(scene, e.pointerId);
    } else if (e.button === 2) {
      cycleSpectateActor(1);
    }
    return;
  }
  if (e.pointerType !== 'touch' && e.button === 2) {
    equipment.action('ads');
    return
  }
  if (e.pointerType === 'touch') {
    if (lookTouch !== null)return;
    lookTouch = e.pointerId;
    aimTouchLast = [e.clientX, e.clientY];
    capturePointer(scene, e.pointerId)
  } else if (e.button === 0 && mousePointer === null) {
    mousePointer = e.pointerId;
    holdFireMouse = true;
    fire();
    if (!document.pointerLockElement) {
      dragID = e.pointerId;
      aimTouchLast = [e.clientX, e.clientY];
      capturePointer(scene, e.pointerId);
      pointer()
    }
  }
});
scene.addEventListener('pointermove', e => {
  if (document.pointerLockElement || screen !== 'game' || (lookTouch !== e.pointerId && dragID !== e.pointerId) || !aimTouchLast)return;
  turn((e.clientX - aimTouchLast[0]) * (e.pointerType === 'touch' ? 1.7 : 1), (e.clientY - aimTouchLast[1]) * (e.pointerType === 'touch' ? 1.7 : 1));
  aimTouchLast = [e.clientX, e.clientY]
});
function releaseLook(e) {
  if (lookTouch === e.pointerId)lookTouch = null;
  if (dragID === e.pointerId) dragID = null;
  if (mousePointer === e.pointerId && (e.type !== 'pointerup' || e.button === 0)) {
    mousePointer = null;
    holdFireMouse = false;
  }
}
scene.addEventListener('pointerup', releaseLook);
scene.addEventListener('pointercancel', releaseLook);
scene.addEventListener('lostpointercapture', e => {
  // Pointer lock can itself release mouse capture while the button is held.
  if (e.pointerType === 'touch' || document.pointerLockElement !== scene) releaseLook(e);
});
const pad = $('pad');
function stick(e) {
  const r = pad.getBoundingClientRect(),
    x = (e.clientX - (r.left + r.width / 2)) / (r.width * .38),
    z = (e.clientY - (r.top + r.height / 2)) / (r.height * .38),
    mag = Math.hypot(x, z),
    l = Math.max(1, mag);
  stickX = x / l;
  stickZ = -z / l;
  // Strong forward tilt on virtual joystick automatically engages dash (sprint)!
  stickSprint = mag >= .84 && stickZ >= .48;
  if (stickSprint && touchCrouch) setTouchCrouch(false);
  pad.classList.toggle('is-sprint', stickSprint);
  const travel = Math.min(82, r.width * .29);
  pad.firstElementChild.style.transform = `translate(${stickX * travel}px,${-stickZ * travel}px)`
}
pad.onpointerdown = e => {
  if (screen !== 'game' || moveTouch !== null || e.button !== 0) return;
  moveTouch = e.pointerId;
  capturePointer(pad, e.pointerId);
  stick(e)
};
pad.onpointermove = e => {
  if (moveTouch === e.pointerId)stick(e)
};
pad.onpointerup = pad.onpointercancel = pad.onlostpointercapture = e => {
  if (moveTouch === e.pointerId) {
    moveTouch = null;
    stickX = stickZ = 0;
    stickSprint = false;
    pad.classList.remove('is-sprint');
    pad.firstElementChild.style.transform = ''
  }
};
// Aim-while-firing: holding the fire button and dragging rotates camera seamlessly without stopping fire.
const touchFire = $('touchFire');
touchFire.onpointerdown = e => {
  if (screen !== 'game' || fireTouch !== null || e.button !== 0) return;
  e.preventDefault();
  holdFireTouch = true;
  fireTouch = e.pointerId;
  fireTouchLast = [e.clientX, e.clientY];
  capturePointer(touchFire, e.pointerId);
  touchFire.classList.add('is-active');
  fire()
};
touchFire.onpointermove = e => {
  if (fireTouch !== e.pointerId || !fireTouchLast || screen !== 'game')return;
  const mul = e.pointerType === 'touch' ? 1.7 : 1;
  turn((e.clientX - fireTouchLast[0]) * mul, (e.clientY - fireTouchLast[1]) * mul);
  fireTouchLast = [e.clientX, e.clientY]
};
function releaseFireTouch(e) {
  if (fireTouch !== null && e?.pointerId !== undefined && fireTouch !== e.pointerId)return;
  fireTouch = null;
  fireTouchLast = null;
  holdFireTouch = false;
  touchFire.classList.remove('is-active')
}
touchFire.onpointerup = touchFire.onpointercancel = touchFire.onlostpointercapture = releaseFireTouch;
touchFire.onclick = e => { if (e.detail === 0) fire(); };
for (const type of ['pointerup', 'pointercancel']) {
  window.addEventListener(type, e => {
    releaseLook(e);
    pad.onpointerup(e);
    releaseFireTouch(e);
  });
}
for (const [id, action] of [
  ['touchReload', () => match?.reload(match.player)],
  ['touchJump', () => { if (match?.player.alive) simJump = true; }],
  ['touchCrouch', () => { setTouchCrouch(!touchCrouch); }],
  ['touchFlir', () => toggleFlir()],
  ['touchSmoke', () => triggerSmokeVent()],
  ['touchChrono', () => toggleChrono()],
  ['btnShaffer', () => triggerSkill('shaffer')],
  ['btnHeal', () => triggerSkill('heal')]
]) {
  const el = $(id);
  if (el) el.onclick = () => { el.blur?.(); if (screen === 'game') action(); };
}

// Hardware Gamepad API support (Xbox / PlayStation / Mobile Controllers): strong left-stick forward tilt auto-dashes!
function pollGamepad(dt) {
  let gp;
  try {
    gp = Array.from(navigator.getGamepads?.() || []).find(pad => pad?.connected);
  } catch {
    // An iframe can deny the Gamepad API through Permissions Policy.
  }
  if (!gp || gp.index !== gamepadIndex) {
    gpMoveX = gpMoveZ = 0;
    gpCrouch = gpSprint = holdFirePad = false;
    gpPrev.fill(0);
    padFireArmed = false;
    gamepadIndex = gp?.index ?? null;
  }
  if (!gp) return;
  const btn = i => {
    const b = gp.buttons[i];
    return !!(b && (b.pressed || b.value > .35));
  };
  const edge = i => {
    const now = btn(i), fired = now && !gpPrev[i];
    gpPrev[i] = now ? 1 : 0;
    return fired;
  };
  if (edge(9)) {
    if (screen === 'game') doPause();
    else if (screen === 'pause') $('resume').click();
    return;
  }
  if (screen !== 'game' || !match) {
    gpMoveX = gpMoveZ = 0;
    gpSprint = holdFirePad = false;
    for (let i = 0; i < 16; i++) gpPrev[i] = btn(i) ? 1 : 0;
    return;
  }
  // Left stick: movement + strong forward tilt auto-dash
  const lx = gp.axes[0] || 0, ly = gp.axes[1] || 0, lm = Math.hypot(lx, ly);
  if (lm > .15) {
    const s = Math.min(1, (lm - .15) / .85) / lm;
    gpMoveX = lx * s;
    gpMoveZ = -ly * s;
  } else {
    gpMoveX = gpMoveZ = 0;
  }
  const l3 = btn(10);
  gpSprint = (lm >= .84 && gpMoveZ >= .48) || l3;
  if (gpSprint && gpCrouch) gpCrouch = false;

  // Right stick: smooth camera aiming with radial deadzone & precision response curve
  const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0, rm = Math.hypot(rx, ry);
  if (rm > .14) {
    const scaled = Math.pow(Math.min(1, (rm - .14) / .86), 1.65) / rm;
    turn(rx * scaled * 920 * dt, ry * scaled * 700 * dt);
  }

  // Triggers & face buttons
  const r2 = btn(7);
  if (!r2) padFireArmed = true;
  holdFirePad = r2 && padFireArmed && match.player.alive;
  if (holdFirePad && !gpPrev[7]) fire();
  gpPrev[7] = r2 ? 1 : 0;
  if (edge(6)) equipment.action('ads');
  if (edge(0) && match.player.alive) simJump = true;
  if (edge(1)) gpCrouch = !gpCrouch;
  if (edge(2)) match.reload(match.player);
  if (edge(3)) equipment.action('pattern');
  if (edge(4)) equipment.action('boost');
  if (edge(5)) equipment.action('scope');
  if (edge(14) || edge(15)) triggerSkill(match.player?.assignedSkill);
}

function frame(ms) {
  requestAnimationFrame(frame);
  if (document.hidden || !ready)return;
  const limit = settings.rate ? 1000 / settings.rate : 0;
  if (currentRate !== settings.rate) {
    currentRate = settings.rate;
    nextFrame = 0;
  }
  if (limit) {
    const scheduled = ms + .5;
    if (scheduled < nextFrame) return;
    nextFrame = nextFrame ? nextFrame + (Math.floor((scheduled - nextFrame) / limit) + 1) * limit : ms + limit;
  }
  const dt = lastTime === null ? 0 : Math.min(.25, (ms - lastTime) / 1000);
  lastTime = ms;
  timeNow += dt;
  pollGamepad(dt);
  let cam;
  const viewA = match ? (getViewActor() || match.player) : null;
  if (screen === 'game' && match) {
    const speedMul = match.isLab ? liveSimSpeed : 1;
    const budget = maxStepBudget * Math.max(1, speedMul);
    accum = Math.min(accum + dt * speedMul, Math.max(.25, budget));
    const steps = Math.floor((Math.min(accum, budget) + 1e-9) / fixed);
    for (let i = 0; i < steps && screen === 'game'; i++) {
      if (match.spectating) {
        match.step(fixed, {});
      } else {
        const fovScale = match.player.df?.ads ? .43 : .63;
        const yaw = (Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'))) * 1.75 * fixed * settings.sensitivity * fovScale,
          pitch = (Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'))) * 1.25 * fixed * settings.sensitivity * fovScale;
        if (match.player.alive) {
          match.player.yaw += yaw;
          match.player.pitch = clamp(match.player.pitch + pitch, -1.31, 1.31);
          if (pitch < 0 && recoilState.pitch > 0) recoilState.pitch = Math.max(0, recoilState.pitch + pitch);
          if (yaw || pitch) {
            gunMotion.swayX = clamp(gunMotion.swayX - yaw * .18, -.042, .042);
            gunMotion.swayY = clamp(gunMotion.swayY - pitch * .15, -.032, .032)
          }
          if ((holdFireMouse || holdFireKey || holdFireTouch || holdFirePad) && weapons[match.player.gun]?.auto) {
            match.trigger(match.player)
          }
        }
        const sprintNow = keys.has('ShiftLeft') || keys.has('ShiftRight') || stickSprint || gpSprint;
        const crouchNow = !sprintNow && (keys.has('ControlLeft') || keys.has('ControlRight') || touchCrouch || gpCrouch);
        match.step(fixed, {
          side: clamp(stickX + gpMoveX + Number(keys.has('KeyD')) - Number(keys.has('KeyA')), -1, 1),
          forward: clamp(stickZ + gpMoveZ + Number(keys.has('KeyW')) - Number(keys.has('KeyS')), -1, 1),
          sprint: sprintNow,
          jump: simJump,
          crouch: crouchNow
        });
        simJump = false;
      }
      if (screen === 'game') accum = Math.max(0, accum - fixed);
    }
    if (match.spectating && spectateCam === 'free' && dt > 0) {
      const f = forward(freeCam.yaw, freeCam.pitch);
      const rx = Math.cos(freeCam.yaw), rz = Math.sin(freeCam.yaw);
      const fwdIn = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
      const sideIn = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
      const upIn = Number(keys.has('Space')) - Number(keys.has('ControlLeft') || keys.has('ControlRight'));
      const spd = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 34 : 16;
      freeCam.x = clamp(freeCam.x + (f[0] * fwdIn + rx * sideIn) * spd * dt, -48, 48);
      freeCam.y = clamp(freeCam.y + (f[1] * fwdIn + upIn) * spd * dt, 1.4, 42);
      freeCam.z = clamp(freeCam.z + (f[2] * fwdIn + rz * sideIn) * spd * dt, -118, 118);
      const yawKey = (Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'))) * 1.6 * dt;
      const pitchKey = (Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'))) * 1.2 * dt;
      freeCam.yaw += yawKey;
      freeCam.pitch = clamp(freeCam.pitch + pitchKey, -1.45, 1.45);
    }
    gameKick *= Math.exp(-13 * dt);
    hurt = Math.max(0, hurt - dt * 1.9);
    healPulse = Math.max(0, healPulse - dt * 1.65);
    stepMotion(dt, match.spectating ? (spectateCam === 'fps' ? viewA : null) : match.player);
    updateCombatUI(dt, match.spectating ? (spectateCam === 'fps' ? viewA : null) : match.player);
    $('damageVeil').style.opacity = (hurt * .62).toFixed(3);
    if ($('healFlash')) $('healFlash').style.opacity = healPulse;
    if (timeNow >= hudAt) {
      hud();
      hudAt = timeNow + (settings.lightMode ? .10 : .065)
    }
  }
  const activeActor = match ? (match.spectating ? (getViewActor() || match.player) : match.player) : null;
  if (match && activeActor) {
    if (match.spectating && spectateCam === 'free') {
      const pos = [freeCam.x, freeCam.y, freeCam.z];
      const f = forward(freeCam.yaw, freeCam.pitch);
      cam = {pos, target: add(pos, f), fov: BASE_FOV + 10};
    } else if (match.spectating && spectateCam === 'tps') {
      const anchor = [activeActor.x, activeActor.y + 1.45, activeActor.z];
      const yaw = activeActor.yaw + tpsOrbit.yaw;
      const pitch = tpsOrbit.pitch;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const back = [-Math.sin(yaw) * cp, -sp, Math.cos(yaw) * cp];
      const want = [anchor[0] + back[0] * tpsOrbit.dist, Math.max(0.8, anchor[1] + back[1] * tpsOrbit.dist), anchor[2] + back[2] * tpsOrbit.dist];
      const wallT = obstruction(anchor, want);
      const distFrac = wallT <= 1 ? Math.max(0.22, wallT - 0.12) : 1;
      const pos = [anchor[0] + (want[0] - anchor[0]) * distFrac, anchor[1] + (want[1] - anchor[1]) * distFrac, anchor[2] + (want[2] - anchor[2]) * distFrac];
      cam = {pos, target: anchor, fov: BASE_FOV + 6};
    } else {
      const a = activeActor;
      const pos = a.alive ? eyeOf(a) : [a.x, a.y + .8, a.z];
      const f = forward(a.yaw, clamp(a.pitch, -1.34, 1.34));
      const baseFov = a.alive && a.df?.ads ? ADS_FOV : BASE_FOV;
      cam = {pos, target: add(pos, f), fov: baseFov};
    }
    $('cinema-veil').style.opacity = 0;
  } else {
    tourTime += dt;
    cam = titleCamera(tourTime);
    $('cinema-veil').style.opacity = cam.fade
  }
  audioSafely(() => audio.update(dt, screen === 'game' ? match : null, cam));
  const cinematic = !match && !renderer.native && !settings.lightMode && settings.shadows && settings.hdr;
  $('app').classList.toggle('cinematic', cinematic);
  const fpNow = !!(match && activeActor?.alive && (match.spectating ? spectateCam === 'fps' : !activeActor.df?.ads));
  if (cinematic) $('cinema-veil').style.opacity = 0;
  else try { renderer.render(cam, timeNow, match, {
    firstPerson: fpNow,
    spectateActor: match?.spectating ? activeActor : null,
    spectateCam: match?.spectating ? spectateCam : 'fps',
    flir: !!(renderer.native && !match?.spectating && flirActive && !settings.lightMode && settings.thermoFlux && match?.player.alive),
    chrono: !!(chronoActive && settings.chronoTrace),
    paused: !!match && screen !== 'game',
    kick: gameKick,
    shake: 0,
    hurt: hurt * .65,
    motion: {
      kickZ: gunMotion.z,
      kickY: gunMotion.y,
      pitchKick: gunMotion.pitch,
      yawKick: gunMotion.yaw,
      rollKick: gunMotion.roll,
      swayX: gunMotion.swayX,
      swayY: gunMotion.swayY,
      landDrop: gunMotion.land,
      blowback: gunMotion.blowback,
      heat: gunMotion.heat,
      rdX: gunMotion.rdX,
      rdY: gunMotion.rdY,
      rdZ: gunMotion.rdZ,
      rdPitch: gunMotion.rdPitch,
      rdYaw: gunMotion.rdYaw,
      rdRoll: gunMotion.rdRoll,
      rdLock: gunMotion.rdLock,
      rdD01: gunMotion.rdD01,
      rdLockPulse: gunMotion.rdLockPulse,
      rdBarrelPhase: gunMotion.rdBarrelPhase
    }
  }); } catch (error) {
    if (renderer.native) recoverRenderer(error);
    else { ready = false; rendererError(error); }
    return;
  }
  equipment.draw(
    renderer,
    match,
    cam,
    timeNow,
    screen === 'game' && (!match?.spectating || spectateCam === 'fps'),
    !!settings.echoPulse,
    !!settings.fermatCore,
    activeActor,
    screen === 'game'
  );
  if (resetView) {
    resetView = false;
    $('loading').hidden = true
  }
  const appEl = $('app');
  appEl.dataset.renderer = renderer.native ? 'webgl2' : 'software';
  appEl.dataset.lightMode = String(!!settings.lightMode);
  appEl.dataset.fluxGi = String(!!(renderer.native && settings.fluxGI && !settings.lightMode));
  appEl.dataset.schlieren = String(!!(renderer.native && settings.schlieren && !settings.lightMode));
  appEl.dataset.aeroVortex = String(!!(renderer.native && settings.aeroVortex && !settings.lightMode));
  appEl.dataset.thermoFlux = String(!!(renderer.native && settings.thermoFlux && !settings.lightMode));
  appEl.dataset.resonance = String(!!(renderer.native && settings.resonance && !settings.lightMode));
  appEl.dataset.chronoTrace = String(!!settings.chronoTrace);
  appEl.dataset.chronoActive = String(!!(chronoActive && settings.chronoTrace));
  appEl.dataset.fermatCore = String(!!settings.fermatCore);
  appEl.dataset.spectraField = String(!!settings.spectraField);
  appEl.dataset.flirActive = String(!!(renderer.native && flirActive && !settings.lightMode && settings.thermoFlux && match?.player.alive));
  appEl.dataset.echoPulse = String(!!settings.echoPulse);
  appEl.dataset.autoAim = String(settings.autoAim !== false);
  appEl.dataset.autoAimMode = currentAutoAimMode();
  appEl.dataset.fullscreen = String(!!fullscreenElement());
  appEl.dataset.aiModel = match?.aiModel || rules.aiModel;
  appEl.dataset.audioEngine = SOUND_ENGIN_VERSION;
  appEl.dataset.audioControlHz = String(audio.controlRateHz || 300);
  appEl.dataset.audioMode = effectiveAudioMode();
  appEl.dataset.audioState = audio.ctx?.state || (audio.on ? 'ready' : 'off');
}
function rendererError(error) {
  console.error(error);
  $('loading').hidden = false;
  $('loading').querySelector('i').hidden = true;
  $('loading').querySelector('span').textContent = '3D描画を開始できません。ページを再読み込みしてください。';
}

let recovering = false;
async function recoverRenderer(error) {
  if (recovering) return;
  recovering = true;
  ready = false;
  doPause();
  flirActive = false;
  if (screen === 'lobby') lobby();
  $('resume').disabled = true;
  $('hdr').hidden = true;
  const prior = renderer;
  prior?.hdrDisplay?.dispose?.();
  if (prior?.native && !prior.gl.isContextLost()) prior.gl.getExtension('WEBGL_lose_context')?.loseContext();
  try {
    console.info('互換描画を使用します', error.message || error);
    const {SoftwareRenderer} = await import('./software.js');
    const fallback = new SoftwareRenderer(scene);
    await fallback.init();
    fallback.settings(settings);
    renderer = fallback;
    ready = true;
    lastTime = null;
    $('app').classList.add('render-ready');
    if (screen === 'lobby') lobby();
    if (screen === 'settings') drawSettings();
    $('resume').disabled = false;
  } catch (fallbackError) {
    rendererError(fallbackError);
  } finally {
    recovering = false;
  }
}

async function init() {
  controls();
  applyLightModeChrome();
  syncFullscreenUI();
  syncAutoAimUI();
  soundButton();
  audio.set(settings.volume / 100);
  $('start').disabled = true;
  try {
    renderer = new Renderer(scene, $('hdr'));
    await renderer.init();
    renderer.settings(settings);
    ready = true;
    $('app').classList.add('render-ready');
    if (screen === 'lobby') lobby();
    if (screen === 'settings') drawSettings();
  } catch (error) {
    await recoverRenderer(error);
  }
  scene.addEventListener('webglcontextlost', () => {
    if (ready && renderer.native) recoverRenderer(new Error('WebGL コンテキストが失われました'));
  });
  window.addEventListener('resize', () => {
    if (!ready) return;
    try {
      renderer.resize();
      if (screen === 'settings') drawSettings();
    } catch (error) {
      if (renderer.native) recoverRenderer(error);
      else { ready = false; rendererError(error); }
    }
  });
  if (ready) requestAnimationFrame(frame);
}
init();
