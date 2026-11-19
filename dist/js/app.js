import {PilotEquipment} from './df-hud.js';
import {eyeOf} from './posture.js';
import {Renderer, sizes, effectiveSize, qualityLevels, shadowModes} from './renderer.js';
import {titleCamera} from './harbor.js';
import {Match, modes, weapons} from './match.js';
import {forward, add, clamp} from './geometry.js';
import {SoundEngin, AUDIO_MODES, SOUND_ENGIN_VERSION} from './audio.js';
const $ = s => document.getElementById(s),
  views = {title: 'titleView', lobby: 'lobby', settings: 'settings', game: 'hud', pause: 'pause', results: 'results'};
// Optically exact +2/3 wider view width relative to 24.7° / 13.0° FOV:
// 2 * atan((5/3) * tan(24.7°/2)) = 40.1°, 2 * atan((5/3) * tan(13.0°/2)) = 21.5°.
const BASE_FOV = 40.1, ADS_FOV = 21.5;
const defaults = {lightMode: false, resolution: 'HD', graphics: 'high', rate: 360, rateV2: true, hdr: true, khdr: true, shadowMode: 'pro', shadows: true, audioMode: 'hrtf', sensitivity: 1, volume: 55, sound: false};
const graphicsHints = {
  standard: '軽量描画 · 基本ライト · 標準反射',
  high: '高精細質感 · 動的ライト · 標準水面反射',
  extra: 'フルブルーム · 高精細水面反射 · 強化パーティクル · FXAA'
};
const shadowHints = {
  off: '影なし · 最軽量',
  flash: '超軽量リアル影 · 静的キャッシュ＋動的NPC影 · IGN-Vogel6 · 彩色アンブラ',
  pro: '最高峰影 · 近距離2.7cmカスケード · 物理PCSS · SSCS接地影 · 光芒シャドウ'
};
const audioHints = {
  hrtf: '3D HRTF立体音響 · 実測遮蔽/反響 · 音速伝播 · コンボリューション残響 · 物理銃声',
  stereo: '軽量ステレオ3D · 音速伝播 · 距離吸収 · 物理銃声 · 低負荷'
};
// Crisp minimal mechanical weapon pulse with ZERO camera shake or FOV punch.
const recoilProfiles = {
  'SW T': {z: .028, y: .005, pitch: .042, yaw: .008, roll: .020, camPitch: 0, camRoll: 0, shake: 0, spread: 3.4, heat: .18, fov: 0},
  SRA: {z: .022, y: .004, pitch: .032, yaw: .006, roll: .015, camPitch: 0, camRoll: 0, shake: 0, spread: 2.8, heat: .13, fov: 0},
  D1: {z: .020, y: .0035, pitch: .028, yaw: .0055, roll: .013, camPitch: 0, camRoll: 0, shake: 0, spread: 2.5, heat: .11, fov: 0},
  MS10: {z: .025, y: .004, pitch: .030, yaw: .007, roll: .016, camPitch: 0, camRoll: 0, shake: 0, spread: 2.4, heat: .15, fov: 0},
  'DF1 OUT': {z: .022, y: .0035, pitch: .028, yaw: .005, roll: .014, camPitch: 0, camRoll: 0, shake: 0, spread: 2.2, heat: .15, fov: 0}
};
// Ultra-small precision micro-recoil with rapid smooth recovery (laser-controllable).
const aimRecoil = {
  'SW T': {pitch: .0036, yaw: .0008, recoverRate: 15.0, recoverRatio: .92, climb: .012},
  SRA: {pitch: .0024, yaw: .0007, recoverRate: 16.0, recoverRatio: .92, climb: .010},
  D1: {pitch: .0018, yaw: .0006, recoverRate: 16.5, recoverRatio: .94, climb: .008},
  MS10: {pitch: .0026, yaw: .0009, recoverRate: 15.5, recoverRatio: .92, climb: .010},
  'DF1 OUT': {pitch: .0016, yaw: .0005, recoverRate: 17.5, recoverRatio: .95, climb: .006}
};
let settings = {...defaults};
let rules = {mode: '3v3', limit: 'points', multiplier: 5, loadout: 'SW T', allyNv21: 0};
try {
  const c = JSON.parse(localStorage.getItem('result.harbor.v1') || '{}');
  if (c.settings) {
    Object.assign(settings, c.settings);
    if (!('shadowMode' in c.settings) && 'shadows' in c.settings) settings.shadowMode = c.settings.shadows ? 'pro' : 'off';
    if (!('khdr' in c.settings)) settings.khdr = !!settings.hdr;
    if (!c.settings.rateV2 && settings.rate === 120) settings.rate = 360;
    settings.rateV2 = true;
  }
  if (c.rules)Object.assign(rules, c.rules)
} catch {}
if (!sizes[settings.resolution])settings.resolution = 'HD';
if (!(settings.graphics in qualityLevels))settings.graphics = 'high';
if (!(settings.shadowMode in shadowModes))settings.shadowMode = 'pro';
if (!(settings.audioMode in AUDIO_MODES))settings.audioMode = 'hrtf';
settings.lightMode = !!settings.lightMode;
settings.shadows = settings.shadowMode !== 'off';
settings.khdr = !!settings.khdr;
if (settings.khdr) settings.hdr = true;
if (![0, 60, 120, 360].includes(settings.rate))settings.rate = 360;
if (!modes[rules.mode])rules.mode = '3v3';
if (!weapons[rules.loadout])rules.loadout = 'SW T';
rules.allyNv21 = [0, 1, 2].includes(Number(rules.allyNv21)) ? Number(rules.allyNv21) : 0;
rules.multiplier = clamp(Math.round(rules.multiplier) || 5, 1, 99);
settings.sensitivity = clamp(Number(settings.sensitivity) || 1, .4, 2);
settings.volume = clamp(Number(settings.volume) || 0, 0, 100);
const save = () => {
  try {
    localStorage.setItem('result.harbor.v1', JSON.stringify({settings, rules}))
  } catch {}
};
let screen = 'title',
  previous = 'title',
  renderer = null,
  match = null,
  starting = false,
  ready = false,
  gameKick = 0,
  hurt = 0,
  noticeUntil = 0,
  timeNow = 0,
  tourTime = 0,
  resetView = true,
  hudAt = 0,
  nextFrame = 0,
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
  lookTouch = null,
  moveTouch = null,
  fireTouch = null,
  fireTouchLast = null,
  dragID = null,
  aimTouchLast = null,
  holdFireMouse = false,
  holdFireKey = false,
  holdFireTouch = false;
const gpPrev = new Uint8Array(18);
const keys = new Set(), audio = new SoundEngin();
let feed = [];
const fixed = 1 / 360;

// Second-order spring-damper kinematic model for crisp weapon blowback & sway (zero camera shake).
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
  shotSide: 1
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
    camPitch: 0, vcamPitch: 0, camRoll: 0, vcamRoll: 0, shake: 0, fovPunch: 0, wasOnGround: true
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
  gunMotion.shotSide = Math.random() < .35 ? gunMotion.shotSide : -gunMotion.shotSide;
  const side = gunMotion.shotSide * (.7 + Math.random() * .4);
  const j = .92 + Math.random() * .16;
  gunMotion.z = Math.min(.045, gunMotion.z + r.z * .35);
  gunMotion.vz += r.z * 9.0 * j;
  gunMotion.vy += r.y * 8.0 * j;
  gunMotion.vpitch += r.pitch * 9.5 * j;
  gunMotion.vyaw += r.yaw * 8.0 * side;
  gunMotion.vroll += r.roll * 9.5 * side;
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
  const a = match?.player;
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

  gunMotion.z = clamp(gunMotion.z, -.01, .055);
  gunMotion.y = clamp(gunMotion.y, -.015, .02);
  gunMotion.pitch = clamp(gunMotion.pitch, -.03, .10);
  gunMotion.yaw = clamp(gunMotion.yaw, -.04, .04);
  gunMotion.roll = clamp(gunMotion.roll, -.07, .07);
  gunMotion.land = clamp(gunMotion.land, -.015, .04);
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
    gunMotion.spread = moveSpread + (gunMotion.spread - moveSpread) * Math.exp(-14 * dt)
  } else {
    recoilState.pitch = recoilState.yaw = recoilState.shotsInBurst = 0;
    gunMotion.spread *= Math.exp(-14 * dt);
    gunMotion.wasOnGround = true
  }
  $('reticle').style.setProperty('--spread', clamp(gunMotion.spread, 0, 12).toFixed(2) + 'px')
}

function triggerHitUI(e) {
  const kind = e.kill ? 'kill' : e.shieldBreak ? 'break' : e.shield ? 'shield' : 'hit';
  hitState.kind = kind;
  hitState.age = 0;
  hitState.dur = kind === 'kill' ? .56 : kind === 'break' ? .44 : kind === 'shield' ? .32 : .25;
  hitState.rot = kind === 'kill' ? 54 : 45 + (Math.random() - .5) * 9;
  const hm = $('hitmark');
  hm.className = 'is-' + kind;
  if (kind === 'kill' || kind === 'break') {
    const bn = $('hitBanner');
    bn.textContent = kind === 'kill' ? 'ELIMINATED' : 'SHIELD BREAK';
    bn.className = 'is-' + kind;
    hitState.bannerAge = 0;
    hitState.bannerDur = kind === 'kill' ? .88 : .70
  }
}

function triggerDamageUI(e, p) {
  hurt = Math.min(1, hurt + (e.shieldBreak ? .96 : .64));
  let dx = 0, dz = -1;
  if (e.actor && e.actor !== p) {
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
    noticeUntil = match.time + 1.6
  }
});
function group(id, value, change) {
  const node = $(id);
  for (const b of node.querySelectorAll('button[data-value]')) {
    b.setAttribute('aria-pressed', String(b.dataset.value === String(value)));
    b.onclick = () => change(b.dataset.value)
  }
}
const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle('touch', touch);
function controls() {
  const rows = touch ? [['移動 / ダッシュ', '左スティック（強く前傾でダッシュ）'], ['視点', '右側スワイプ / 射撃長押しドラッグ / 右スティック'], ['発射 / 再装填', '射撃(長押し連射＋視点移動)・R2 / R・X'], ['ジャンプ / しゃがみ', '↑・A / しゃがみ・B']] : [['移動 / ダッシュ', 'WASD / Shift · 左スティック強前傾'], ['視点', 'マウス / 矢印キー / 右スティック'], ['発射 / 再装填', '左クリック(長押し連射＋視点移動)・F・R2 / R'], ['ジャンプ / しゃがむ', 'Space・A / Ctrl・B'], ['一時停止', 'Esc / P / Start']];
  if (match?.player.df)rows.push(...(touch ? [['DF1 OUT', '画面右の専用ボタン / L2・Y・LB・RB']] : [['中央集中 / 散弾', 'Q / Y'], ['P1 ブースト', 'X / LB'], ['照準 / レンズ切替', '右クリック・C・L2 / V・RB'], ['EVR1 購入', 'B']]));
  $('controls').innerHTML = rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('')
}
function show(s) {
  screen = s;
  document.body.dataset.screen = s;
  for (const [k, id] of Object.entries(views))$(id).hidden = k !== s;
  keys.clear();
  simJump = false;
  holdFireMouse = holdFireKey = holdFireTouch = holdFirePad = false;
  stickX = stickZ = gpMoveX = gpMoveZ = 0;
  stickSprint = gpSprint = false;
  setTouchCrouch(false);
  gpCrouch = false;
  moveTouch = lookTouch = fireTouch = fireTouchLast = dragID = null;
  $('touchFire')?.classList.remove('is-active');
  $('pad').classList.remove('is-sprint');
  $('pad').firstElementChild.style.transform = '';
  accum = 0;
  if (s !== 'game' && document.pointerLockElement)document.exitPointerLock();
  if (s === 'lobby') {
    if (match?.ended) {
      match = null;
      tourTime = 0
    }
    lobby()
  }
  if (s === 'settings')drawSettings();
  if (s === 'title') {
    match = null;
    audio.resetMatch();
    tourTime = 0;
    resetView = true;
    soundButton()
  }
  if (s === 'pause') {
    controls();
    equipment.pause(match?.player)
  }
  if (s === 'results')resultUI();
  const focus = {title: 'play', lobby: 'lobbyBack', settings: 'settingsClose', pause: 'resume', results: 'rematch'}[s];
  if (focus)$(focus).focus({preventScroll: true}); else document.activeElement?.blur?.()
}
function soundButton() {
  const on = settings.sound && audio.on && settings.volume > 0;
  $('sound').querySelector('use').setAttribute('href', on ? '#i-audio' : '#i-muted');
  $('sound').querySelector('span').textContent = on ? 'SOUND ON' : 'SOUND OFF';
  $('sound').setAttribute('aria-label', on ? 'サウンドをオフにする' : 'サウンドをオンにする');
  $('app').dataset.audioState = audio.ctx?.state || (audio.on ? 'ready' : 'off')
}
function lobby() {
  group('modes', rules.mode, k => {
    rules.mode = k;
    save();
    lobby()
  });
  const is3v3 = rules.mode === '3v3';
  $('allyAiWrap').hidden = !is3v3;
  group('allyNv21', rules.allyNv21, k => {
    rules.allyNv21 = Number(k);
    save();
    lobby()
  });
  $('allyNv21Hint').textContent = rules.allyNv21 === 1
    ? 'NAGI（D1）を NV2.1 に強化 · 高速反応 / 多弾同時回避 / 目視予測スパイ裏どり'
    : rules.allyNv21 === 2
      ? 'KAI（MS10）を NV2.1 に強化 · 高速反応 / 多弾同時回避 / 目視予測スパイ裏どり'
      : '味方NPC2体は標準NV2（人間的な照準・戦術連携）で出撃します';
  $('lobbyAiLabel').textContent = is3v3 && rules.allyNv21 > 0
    ? `NV2 + NV2.1 SPY (${rules.allyNv21 === 1 ? 'NAGI' : 'KAI'})`
    : 'NV2 Deep Tactical';
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
  $('mult').value = rules.multiplier;
  $('multWrap').hidden = rules.limit === 'unlimited';
  const [a, b] = modes[rules.mode], v = rules.multiplier;
  $('targets').textContent = rules.limit === 'unlimited' ? '時間・得点ともに無制限' : `味方 ${a*v} 点先取　/　敵 ${b*v} 点先取　·　時間無制限`;
  const w = weapons[rules.loadout];
  const modeLabel = w.auto && w.burst > 1 ? `フルオート ${w.burst}発連射` : w.auto ? 'フルオート連射' : w.burst > 1 ? w.burst + '発バースト' : '単発';
  const tags = [`弾倉 ${w.capacity} 発`, `威力 ${w.damage}`, modeLabel, `連射比 ${w.rate}`, `弾速比 ${w.velocity}`];
  if (rules.loadout === 'MS10')tags.push('全武器最速弾速');
  $('weaponStats').innerHTML = tags.map(s => `<span>${s}</span>`).join('');
  $('start').disabled = !ready || starting;
  equipment.lobby(rules.loadout)
}
const effectiveAudioMode = () => settings.lightMode ? 'stereo' : settings.audioMode;
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
  applyLightModeChrome();
  save();
  renderer?.settings(settings);
  drawSettings()
}
function drawSettings() {
  const lite = !!settings.lightMode;
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
  $('lightModeSwitch').setAttribute('aria-checked', String(lite));
  $('lightModeHint').textContent = lite
    ? 'オン · 低ポリ地形/NPC · 影/反射/KHDR/Bloom省略 · 低解像度 · 軽量ステレオ音響'
    : 'オフ · 通常/高精細描画（詳細度・影・KHDR・立体音響をそのまま適用）';
  const [w, h] = effectiveSize(settings);
  $('resolutionHint').textContent = lite
    ? `${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')} px（軽量スケール）`
    : `${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')} px`;
  $('graphicsHint').textContent = lite
    ? '軽量モードで超軽量シェーダー・低ポリLODを適用中（解除で復帰）'
    : !renderer?.native && settings.graphics === 'extra' ? '互換描画 · エフェクト・パーティクル強化' : graphicsHints[settings.graphics];
  $('hdrSwitch').setAttribute('aria-checked', String(settings.hdr));
  $('khdrSwitch').setAttribute('aria-checked', String(settings.khdr));
  $('hdrHint').textContent = lite
    ? '軽量モードで標準SDRへ自動切替（解除で復帰）'
    : settings.hdr ? (renderer?.hdrDisplay?.active ? 'HDRディスプレイ出力' : '標準HDR (ACES トーンマッピング)') : '標準レンジ (SDR)';
  const bitTag = renderer?.floatHDR ? '16bit FP16' : '14-Stop Log-K';
  $('khdrHint').textContent = lite
    ? '軽量モードでオフスクリーンKHDR/Bloomを省略中（解除で復帰）'
    : settings.khdr
      ? (renderer?.hdrDisplay?.active ? `KHDR 16×広域HDR出力 · ${bitTag} · K-Filmic · K-Adapt · K-LCE` : `${bitTag} · K-Filmic色相保全 · K-Adapt自動露出 · K-LCE · K-Halo`)
      : 'オフ · 標準HDR/SDR描画';
  $('shadowHint').textContent = lite
    ? '軽量モードで影描画を自動省略中（解除で復帰）'
    : !renderer?.native && settings.shadowMode !== 'off' ? '互換ソフト影描画' : shadowHints[settings.shadowMode];
  $('audioHint').textContent = lite
    ? '軽量モードで軽量ステレオ3Dへ自動切替（解除で復帰）'
    : audioHints[settings.audioMode];
  $('sensitivity').value = settings.sensitivity;
  $('sensVal').value = settings.sensitivity.toFixed(1) + '×';
  $('volume').value = settings.volume;
  $('volumeVal').value = settings.volume + '%';
  $('settingStatus').textContent = lite ? '軽量モード有効 · 設定は自動保存されます' : '設定は自動保存されます'
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
$('sound').onclick = async() => {
  settings.sound = !(settings.sound && audio.on && settings.volume);
  if (settings.sound && !settings.volume)settings.volume = 55;
  audio.setMode(effectiveAudioMode());
  audio.set(settings.volume / 100);
  await audio.enable(settings.sound);
  save();
  soundButton()
};
$('lightModeSwitch').onclick = () => setGraphics('lightMode', !settings.lightMode);
$('hdrSwitch').onclick = () => setGraphics('hdr', !settings.hdr);
$('khdrSwitch').onclick = () => setGraphics('khdr', !settings.khdr);
$('sensitivity').oninput = e => {
  settings.sensitivity = Number(e.target.value);
  $('sensVal').value = settings.sensitivity.toFixed(1) + '×';
  save()
};
$('volume').oninput = e => {
  settings.volume = Number(e.target.value);
  settings.sound = settings.volume > 0;
  audio.setMode(effectiveAudioMode());
  audio.set(settings.volume / 100);
  audio.enable(settings.sound);
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
  rules.multiplier = clamp(Math.round(Number(e.target.value)) || 5, 1, 99);
  save();
  lobby()
};
function pointer() {
  if (touch || document.pointerLockElement || lockPending || screen !== 'game')return;
  try {
    lockPending = true;
    const p = $('scene').requestPointerLock?.();
    if (p?.catch)p.catch (() => {}).finally(() => {
      lockPending = false
    }); else setTimeout(() => {
      lockPending = false
    }, 300)
  } catch {
    lockPending = false
  }
}
function startMatch() {
  if (!ready || starting)return;
  starting = true;
  feed = [];
  gameKick = hurt = 0;
  noticeUntil = 0;
  resetMotion();
  audio.resetMatch();
  match = new Match(rules, event);
  equipment.prepare(match.player);
  show('game');
  pointer();
  audio.setMode(effectiveAudioMode());
  if (settings.sound)audio.enable(true);
  audio.set(settings.volume / 100);
  $('startHint').hidden = false;
  $('startHint').textContent = touch ? '左強傾ダッシュ · 射撃ドラッグ視点 · タンカー+100発' : 'WASD 移動 / Shift・コントローラー強前傾 ダッシュ · 補給タンカーで +100発 / 精製1.5×';
  $('combatNotice').textContent = '';
  $('feed').replaceChildren();
  starting = false;
  hud();
}
function doPause() {
  if (screen === 'game' && match && !match.ended)show('pause')
}
$('start').onclick = startMatch;
$('pauseButton').onclick = doPause;
$('resume').onclick = () => {
  show('game');
  pointer()
};
$('endMatch').onclick = () => {
  if (match) {
    match.ended = true;
    show('results')
  }
};
$('rematch').onclick = () => show('lobby');
$('resultTitle').onclick = () => show('title');
function event(e) {
  const p = match?.player;
  if (!p)return;
  audio.event(e, p);
  if (e.type === 'fire' && e.actor === p)kickWeapon(e.gun || p.gun);
  if (e.type === 'spawn' && e.actor === p) {
    recoilState.pitch = recoilState.yaw = recoilState.shotsInBurst = 0;
    setTouchCrouch(false);
    gpCrouch = false;
  }
  if (e.type === 'hit') {
    if (e.actor === p)triggerHitUI(e);
    if (e.victim === p)triggerDamageUI(e, p)
  }
  if (e.type === 'tanker' && e.actor === p) {
    $('combatNotice').textContent = '補給タンカー起動　·　弾丸 +100 / 精製能力 1.5×';
    noticeUntil = match.time + 2.8
  }
  if (e.type === 'point') {
    const aTag = e.actor.isSpy ? `${e.actor.name}<span class="tag-nv21">2.1</span>` : e.actor.name;
    const vTag = e.victim.isSpy ? `${e.victim.name}<span class="tag-nv21">2.1</span>` : e.victim.name;
    feed.push({line: `${aTag}　›　${vTag}`, team: e.actor.team, until: match.time + 4.5});
    equipment.award(e)
  }
  if (e.type === 'dry' && e.actor === p) {
    $('combatNotice').textContent = p.stock ? 'R で再装填' : '弾丸を生成中';
    noticeUntil = match.time + .8
  }
  if (e.type === 'end')show('results')
}
function hud() {
  if (!match)return;
  const a = match.player;
  $('scoreA').textContent = match.scores[0];
  $('scoreB').textContent = match.scores[1];
  $('hudRule').textContent = Number.isFinite(match.goals[0]) ? (match.goals[0] === match.goals[1] ? `${match.goals[0]} 点先取` : `${match.goals[0]} / ${match.goals[1]} 点先取`) : '無制限';
  $('hpVal').textContent = a.hp;
  $('shieldVal').textContent = a.shield;
  $('hpBar').style.width = a.hp + '%';
  $('shieldBar').style.width = a.shield * 10 + '%';
  $('gunName').textContent = a.gun;
  $('magVal').textContent = a.mag;
  $('stockVal').textContent = a.stock;
  $('reloadLabel').textContent = a.reload > 0 ? `再装填 ${a.reload.toFixed(1)} s` : a.mag === 0 ? 'R · 再装填' : '予備弾';
  $('ammoBoost').hidden = !((a.ammoRate || 1) > 1.01);
  let nearestTk = null, nearestDist = 18;
  for (const tk of match.tankers || []) {
    const d = Math.hypot(tk.x - a.x, tk.z - a.z);
    if (d < nearestDist) {
      nearestDist = d;
      nearestTk = tk
    }
  }
  $('tankerHint').textContent = !a.alive || !nearestTk ? '' : nearestTk.cooldown <= 0 ? `補給タンカー ${Math.round(nearestDist)}m · +100発 / 精製1.5×` : `補給タンカー再充填 ${Math.ceil(nearestTk.cooldown)}s`;
  $('respawn').hidden = a.alive;
  $('reticle').hidden = !a.alive;
  $('reticle').classList.toggle('is-ms10', a.gun === 'MS10');
  $('spawnCounter').textContent = Math.max(0, a.respawn).toFixed(1) + ' s';
  if (match.time > 9)$('startHint').hidden = true;
  if (noticeUntil < match.time)$('combatNotice').textContent = '';
  feed = feed.filter(x => x.until > match.time).slice(-3);
  const stamp = feed.map(x => x.line).join('/');
  if ($('feed').dataset.stamp !== stamp) {
    $('feed').dataset.stamp = stamp;
    $('feed').innerHTML = feed.map(x => `<div class="feed-line ${x.team?'orange':'cyan'}">${x.line}</div>`).join('')
  }
}
function resultUI() {
  if (!match)return;
  $('outcome').textContent = match.winner === null ? '試合終了' : match.winner === 0 ? '味方チームの勝利' : '敵チームの勝利';
  $('finalA').textContent = match.scores[0];
  $('finalB').textContent = match.scores[1];
  $('roster').innerHTML = '<div class="roster-row heading"><span>参加者</span><span>撃破</span><span>ダウン</span></div>' + match.actors.map(a => `<div class="roster-row"><span class="${a.team?'orange':'cyan'}">${a.name}${a.human?' · 自分':a.isSpy?'<span class="tag-nv21">NV2.1 SPY</span>':''}</span><span>${a.kills}</span><span>${a.deaths}</span></div>`).join('');
  equipment.result(match)
}
function turn(dx, dy) {
  if (screen !== 'game' || !match?.player.alive)return;
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
  if (screen === 'game' && match)match.trigger(match.player)
}
document.addEventListener('keydown', e => {
  if (e.code === 'Escape') {
    if (screen === 'game')doPause(); else if (screen === 'settings')show(previous); else if (screen === 'lobby')show('title'); else if (screen === 'pause') {
      show('game');
      pointer()
    }
    return
  }
  if (screen !== 'game')return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyR'].includes(e.code))e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyF')holdFireKey = true;
  if (e.repeat)return;
  if (e.code === 'KeyR')match.reload(match.player);
  if (e.code === 'KeyF')fire();
  if (e.code === 'Space')simJump = true;
  if (e.code === 'KeyP')doPause();
  const extra = {KeyQ: 'pattern', KeyX: 'boost', KeyC: 'ads', KeyV: 'scope', KeyB: 'buy'}[e.code];
  if (extra)equipment.action(extra)
});
document.addEventListener('keyup', e => {
  keys.delete(e.code);
  if (e.code === 'KeyF')holdFireKey = false;
});
let wasLocked = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === $('scene');
  if (wasLocked && !locked && screen === 'game')doPause();
  wasLocked = locked;
  lockPending = false;
});
document.addEventListener('pointerlockerror', () => {
  lockPending = false;
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === $('scene'))turn(e.movementX, e.movementY)
});
window.addEventListener('mouseup', e => {
  if (e.button === 0)holdFireMouse = false
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
scene.oncontextmenu = e => e.preventDefault();
scene.addEventListener('pointerdown', e => {
  if (screen !== 'game')return;
  if (e.pointerType !== 'touch' && e.button === 2) {
    equipment.action('ads');
    return
  }
  if (e.pointerType === 'touch') {
    if (lookTouch !== null)return;
    lookTouch = e.pointerId;
    aimTouchLast = [e.clientX, e.clientY];
    scene.setPointerCapture(e.pointerId)
  } else if (e.button === 0) {
    holdFireMouse = true;
    fire();
    if (!document.pointerLockElement) {
      dragID = e.pointerId;
      aimTouchLast = [e.clientX, e.clientY];
      try {
        scene.setPointerCapture(e.pointerId)
      } catch {}
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
  if (dragID === e.pointerId)dragID = null;
  if (e.pointerType !== 'touch' && e.button === 0)holdFireMouse = false
}
scene.addEventListener('pointerup', releaseLook);
scene.addEventListener('pointercancel', releaseLook);
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
  const travel = Math.min(36, r.width * .28);
  pad.firstElementChild.style.transform = `translate(${stickX * travel}px,${-stickZ * travel}px)`
}
pad.onpointerdown = e => {
  if (moveTouch !== null)return;
  moveTouch = e.pointerId;
  pad.setPointerCapture(e.pointerId);
  stick(e)
};
pad.onpointermove = e => {
  if (moveTouch === e.pointerId)stick(e)
};
pad.onpointerup = pad.onpointercancel = e => {
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
  e.preventDefault();
  holdFireTouch = true;
  if (fireTouch === null) {
    fireTouch = e.pointerId;
    fireTouchLast = [e.clientX, e.clientY];
    try {
      touchFire.setPointerCapture(e.pointerId)
    } catch {}
  }
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
for (const [id, action] of [['touchReload', () => match?.reload(match.player)], ['touchJump', () => {
  simJump = true
}], ['touchCrouch', () => {
  setTouchCrouch(!touchCrouch);
}]])$(id).onpointerdown = e => {
  e.preventDefault();
  action()
};

// Hardware Gamepad API support (Xbox / PlayStation / Mobile Controllers): strong left-stick forward tilt auto-dashes!
function pollGamepad(dt) {
  const pads = navigator.getGamepads?.();
  if (!pads) {
    gpMoveX = gpMoveZ = 0;
    gpSprint = holdFirePad = false;
    return
  }
  let gp = null;
  for (let i = 0; i < pads.length; i++) {
    if (pads[i]?.connected) { gp = pads[i]; break; }
  }
  if (!gp) {
    gpMoveX = gpMoveZ = 0;
    gpSprint = holdFirePad = false;
    return
  }
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
    else if (screen === 'pause') { show('game'); pointer(); }
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
  if (r2 && !gpPrev[7]) fire();
  gpPrev[7] = r2 ? 1 : 0;
  holdFirePad = r2;
  if (edge(6)) equipment.action('ads');
  if (edge(0)) simJump = true;
  if (edge(1)) gpCrouch = !gpCrouch;
  if (edge(2)) match.reload(match.player);
  if (edge(3)) equipment.action('pattern');
  if (edge(4)) equipment.action('boost');
  if (edge(5)) equipment.action('scope');
}

function frame(ms) {
  requestAnimationFrame(frame);
  if (document.hidden || !ready)return;
  const limit = settings.rate ? 1000 / settings.rate : 0;
  if (limit) {
    if (ms + .17 < nextFrame)return;
    nextFrame = nextFrame ? nextFrame + Math.max(1, Math.floor((ms - nextFrame) / limit) + 1) * limit : ms + limit;
    if (nextFrame < ms + .1)nextFrame += limit
  } else nextFrame = 0;
  const dt = lastTime === null ? 0 : Math.min(.25, (ms - lastTime) / 1000);
  lastTime = ms;
  timeNow += dt;
  pollGamepad(dt);
  let cam;
  if (screen === 'game' && match) {
    accum = Math.min(accum + dt, 1 / 15);
    while (accum + 1e-9 >= fixed && screen === 'game') {
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
      accum -= fixed
    }
    gameKick *= Math.exp(-13 * dt);
    hurt = Math.max(0, hurt - dt * 1.9);
    stepMotion(dt, match.player);
    updateCombatUI(dt, match.player);
    $('damageVeil').style.opacity = hurt;
    if (timeNow >= hudAt) {
      hud();
      hudAt = timeNow + (settings.lightMode ? .10 : .065)
    }
  }
  if (match) {
    const a = match.player;
    const pos = a.alive ? eyeOf(a) : [a.x, a.y + .8, a.z];
    const f = forward(a.yaw, clamp(a.pitch, -1.34, 1.34));
    const baseFov = a.alive && a.df?.ads ? ADS_FOV : BASE_FOV;
    cam = {pos, target: add(pos, f), fov: baseFov};
    $('cinema-veil').style.opacity = 0
  } else {
    tourTime += dt;
    cam = titleCamera(tourTime);
    $('cinema-veil').style.opacity = cam.fade
  }
  audio.update(dt, match, cam);
  const cinematic = !match && !renderer.native && !settings.lightMode && settings.shadows && settings.hdr;
  $('app').classList.toggle('cinematic', cinematic);
  if (cinematic)$('cinema-veil').style.opacity = 0; else renderer.render(cam, timeNow, match, {
    firstPerson: !!match?.player.alive && !match?.player.df?.ads,
    kick: gameKick,
    shake: 0,
    hurt,
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
      heat: gunMotion.heat
    }
  });
  equipment.draw(renderer, match, cam, timeNow, screen === 'game', !!settings.lightMode);
  if (resetView) {
    resetView = false;
    $('loading').hidden = true
  }
  const appEl = $('app');
  appEl.dataset.renderer = renderer.native ? 'webgl2' : 'software';
  appEl.dataset.lightMode = String(!!settings.lightMode);
  appEl.dataset.audioEngine = SOUND_ENGIN_VERSION;
  appEl.dataset.audioMode = effectiveAudioMode();
  appEl.dataset.audioState = audio.ctx?.state || (audio.on ? 'ready' : 'off');
}
async function init() {
  controls();
  applyLightModeChrome();
  soundButton();
  audio.set(settings.volume / 100);
  $('start').disabled = true;
  try {
    try {
      renderer = new Renderer(scene, $('hdr'));
      await renderer.init()
    } catch (error) {
      console.info('互換描画を使用します', error.message);
      const {SoftwareRenderer} = await import('./software.js');
      renderer = new SoftwareRenderer(scene);
      await renderer.init()
    }
    renderer.settings(settings);
    $('app').classList.add('render-ready');
    ready = true;
    if (screen === 'lobby')lobby();
    window.addEventListener('resize', () => renderer.resize());
    requestAnimationFrame(frame)
  } catch (e) {
    console.error(e);
    $('loading').querySelector('i').hidden = true;
    $('loading').querySelector('span').textContent = '3D描画を開始できません。ブラウザのグラフィック アクセラレーションを確認してください。'
  }
}
init();
