import {PilotEquipment} from './df-hud.js';
import {eyeOf} from './posture.js';
import {Renderer, sizes, qualityLevels} from './renderer.js';
import {titleCamera} from './harbor.js';
import {Match, modes, weapons} from './match.js';
import {forward, add, clamp} from './geometry.js';
import {PortAudio} from './audio.js';
const $ = s => document.getElementById(s),
  views = {title: 'titleView', lobby: 'lobby', settings: 'settings', game: 'hud', pause: 'pause', results: 'results'};
// Optically exact 2/3 view width relative to the original 73° / 42° FOV:
// 2 * atan((2/3) * tan(73°/2)) = 52.5°, 2 * atan((2/3) * tan(42°/2)) = 28.7°.
const BASE_FOV = 52.5, ADS_FOV = 28.7;
const defaults = {resolution: 'HD', graphics: 'high', rate: 120, hdr: true, shadows: true, sensitivity: 1, volume: 55, sound: false};
const graphicsHints = {
  standard: '軽量描画 · 基本影 · 標準反射',
  high: '高精細影 · 動的ライト · 標準後処理',
  extra: 'HDRブルーム · 16×ソフトシャドウ · 動的影 · 高精細水面反射 · FXAA'
};
const recoilProfiles = {
  'SW T': {z: .088, y: .018, pitch: .155, yaw: .028, roll: .075, camPitch: .015, camRoll: .006, shake: .28, spread: 11, heat: .22, fov: .55},
  SRA: {z: .064, y: .013, pitch: .112, yaw: .022, roll: .056, camPitch: .010, camRoll: .004, shake: .20, spread: 8.5, heat: .15, fov: .42},
  D1: {z: .056, y: .011, pitch: .094, yaw: .020, roll: .048, camPitch: .008, camRoll: .0035, shake: .17, spread: 7.5, heat: .13, fov: .36},
  MS10: {z: .074, y: .012, pitch: .098, yaw: .030, roll: .062, camPitch: .0095, camRoll: .0045, shake: .22, spread: 7.2, heat: .17, fov: .62},
  'DF1 OUT': {z: .080, y: .015, pitch: .124, yaw: .025, roll: .066, camPitch: .012, camRoll: .005, shake: .25, spread: 9.2, heat: .19, fov: .48}
};
let settings = {...defaults};
let rules = {mode: '3v3', limit: 'points', multiplier: 5, loadout: 'SW T'};
try {
  const c = JSON.parse(localStorage.getItem('result.harbor.v1') || '{}');
  if (c.settings)Object.assign(settings, c.settings);
  if (c.rules)Object.assign(rules, c.rules)
} catch {}
if (!sizes[settings.resolution])settings.resolution = 'HD';
if (!(settings.graphics in qualityLevels))settings.graphics = 'high';
if (![0, 120].includes(settings.rate))settings.rate = 120;
if (!modes[rules.mode])rules.mode = '3v3';
if (!weapons[rules.loadout])rules.loadout = 'SW T';
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
  lockPending = false,
  lookTouch = null,
  moveTouch = null,
  dragID = null,
  aimTouchLast = null,
  holdFireMouse = false,
  holdFireKey = false,
  holdFireTouch = false;
const keys = new Set(), audio = new PortAudio();
let feed = [];
const fixed = 1 / 120;

// Second-order spring-damper kinematic model for thorough weapon firing, recoil, sway, and landing motion.
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
const hitState = {age: 1, dur: .28, kind: 'hit', rot: 45, bannerAge: 1, bannerDur: 0};
const dmgArc = {alpha: 0, dir: [0, 0, -1]};

function resetMotion() {
  Object.assign(gunMotion, {
    z: 0, vz: 0, y: 0, vy: 0, pitch: 0, vpitch: 0, yaw: 0, vyaw: 0, roll: 0, vroll: 0,
    swayX: 0, swayY: 0, land: 0, vland: 0, blowback: 0, heat: 0, spread: 0,
    camPitch: 0, vcamPitch: 0, camRoll: 0, vcamRoll: 0, shake: 0, fovPunch: 0, wasOnGround: true
  });
  Object.assign(hitState, {age: 1, dur: .28, kind: 'hit', rot: 45, bannerAge: 1, bannerDur: 0});
  Object.assign(dmgArc, {alpha: 0, dir: [0, 0, -1]});
  $('hitmark').style.opacity = 0;
  $('hitBanner').style.opacity = 0;
  $('damageArc').style.opacity = 0;
  $('damageVeil').style.opacity = 0;
  $('reticle').style.setProperty('--spread', '0px')
}

function kickWeapon(gun) {
  const r = recoilProfiles[gun] || recoilProfiles['SW T'];
  gunMotion.shotSide = Math.random() < .35 ? gunMotion.shotSide : -gunMotion.shotSide;
  const side = gunMotion.shotSide * (.65 + Math.random() * .55);
  const j = .9 + Math.random() * .2;
  gunMotion.z = Math.min(.14, gunMotion.z + r.z * .42);
  gunMotion.vz += r.z * 11.5 * j;
  gunMotion.vy += r.y * 10.5 * j;
  gunMotion.vpitch += r.pitch * 12.0 * j;
  gunMotion.vyaw += r.yaw * 10.5 * side;
  gunMotion.vroll += r.roll * 12.5 * side;
  gunMotion.blowback = 1;
  gunMotion.heat = Math.min(1, gunMotion.heat + r.heat);
  gunMotion.spread = Math.min(20, gunMotion.spread + r.spread);
  gunMotion.vcamPitch += r.camPitch * 14.0 * j;
  gunMotion.vcamRoll += r.camRoll * 12.0 * side;
  gunMotion.shake = Math.min(1, gunMotion.shake + r.shake);
  gunMotion.fovPunch = Math.min(1.4, gunMotion.fovPunch + r.fov);
  gameKick = 1
}

function stepSpring(x, v, k, c, dt) {
  const a = -k * x - c * v;
  const nv = v + a * dt;
  return [x + nv * dt, nv]
}

function stepMotion(dt, a) {
  const sub = Math.min(dt, .033);
  [gunMotion.z, gunMotion.vz] = stepSpring(gunMotion.z, gunMotion.vz, 310, 27, sub);
  [gunMotion.y, gunMotion.vy] = stepSpring(gunMotion.y, gunMotion.vy, 250, 23, sub);
  [gunMotion.pitch, gunMotion.vpitch] = stepSpring(gunMotion.pitch, gunMotion.vpitch, 220, 21, sub);
  [gunMotion.yaw, gunMotion.vyaw] = stepSpring(gunMotion.yaw, gunMotion.vyaw, 200, 19, sub);
  [gunMotion.roll, gunMotion.vroll] = stepSpring(gunMotion.roll, gunMotion.vroll, 195, 19, sub);
  [gunMotion.land, gunMotion.vland] = stepSpring(gunMotion.land, gunMotion.vland, 145, 17, sub);
  [gunMotion.camPitch, gunMotion.vcamPitch] = stepSpring(gunMotion.camPitch, gunMotion.vcamPitch, 275, 29, sub);
  [gunMotion.camRoll, gunMotion.vcamRoll] = stepSpring(gunMotion.camRoll, gunMotion.vcamRoll, 240, 25, sub);

  gunMotion.z = clamp(gunMotion.z, -.02, .16);
  gunMotion.y = clamp(gunMotion.y, -.03, .05);
  gunMotion.pitch = clamp(gunMotion.pitch, -.08, .36);
  gunMotion.yaw = clamp(gunMotion.yaw, -.14, .14);
  gunMotion.roll = clamp(gunMotion.roll, -.22, .22);
  gunMotion.land = clamp(gunMotion.land, -.03, .085);
  gunMotion.camPitch = clamp(gunMotion.camPitch, -.02, .055);
  gunMotion.camRoll = clamp(gunMotion.camRoll, -.03, .03);

  const swayDecay = Math.exp(-11 * dt);
  gunMotion.swayX *= swayDecay;
  gunMotion.swayY *= swayDecay;
  gunMotion.blowback *= Math.exp(-22 * dt);
  gunMotion.heat = Math.max(0, gunMotion.heat - dt * .21);
  gunMotion.shake = Math.max(0, gunMotion.shake * Math.exp(-10 * dt) - dt * .35);
  gunMotion.fovPunch *= Math.exp(-15 * dt);

  if (a?.alive) {
    if (!gunMotion.wasOnGround && a.onGround) {
      gunMotion.vland += .42;
      gunMotion.shake = Math.min(1, gunMotion.shake + .12)
    }
    gunMotion.wasOnGround = a.onGround;
    const speed = Math.hypot(a.vx, a.vz);
    const moveSpread = (a.onGround ? Math.min(4.2, speed * .62) : 6.5) * (1 - a.crouch * .45);
    gunMotion.spread = moveSpread + (gunMotion.spread - moveSpread) * Math.exp(-12 * dt)
  } else {
    gunMotion.spread *= Math.exp(-12 * dt);
    gunMotion.wasOnGround = true
  }
  $('reticle').style.setProperty('--spread', clamp(gunMotion.spread, 0, 22).toFixed(2) + 'px')
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
    hitState.bannerDur = kind === 'kill' ? .88 : .70;
    gunMotion.shake = Math.min(1, gunMotion.shake + (kind === 'kill' ? .22 : .15))
  }
}

function triggerDamageUI(e, p) {
  hurt = Math.min(1, hurt + (e.shieldBreak ? .96 : .64));
  gunMotion.shake = Math.min(1, gunMotion.shake + (e.shieldBreak ? .58 : .34));
  gunMotion.vroll += (Math.random() < .5 ? -1 : 1) * .52;
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
  const rows = touch ? [['移動', '左スティック'], ['視点', '右側をスワイプ'], ['発射 / 再装填', '射撃(長押し連射) / R'], ['ジャンプ', '↑']] : [['移動 / ダッシュ', 'WASD / Shift'], ['視点', 'マウス / 矢印キー'], ['発射 / 再装填', '左クリック(長押し連射)・F / R'], ['ジャンプ / しゃがむ', 'Space / Ctrl'], ['一時停止', 'Esc / P']];
  if (match?.player.df)rows.push(...(touch ? [['DF1 OUT', '画面右の専用ボタン']] : [['中央集中 / 散弾', 'Q'], ['P1 ブースト', 'X'], ['照準 / レンズ切替', '右クリック・C / V'], ['EVR1 購入', 'B']]));
  $('controls').innerHTML = rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('')
}
function show(s) {
  screen = s;
  document.body.dataset.screen = s;
  for (const [k, id] of Object.entries(views))$(id).hidden = k !== s;
  keys.clear();
  simJump = false;
  holdFireMouse = holdFireKey = holdFireTouch = false;
  stickX = stickZ = 0;
  moveTouch = lookTouch = dragID = null;
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
  $('sound').setAttribute('aria-label', on ? 'サウンドをオフにする' : 'サウンドをオンにする')
}
function lobby() {
  group('modes', rules.mode, k => {
    rules.mode = k;
    save();
    lobby()
  });
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
  const modeLabel = w.auto ? 'フルオート連射' : w.burst > 1 ? w.burst + '発バースト' : '単発';
  const tags = [`弾倉 ${w.capacity} 発`, `威力 ${w.damage}`, modeLabel, `連射比 ${w.rate}`, `弾速比 ${w.velocity}`];
  if (rules.loadout === 'MS10')tags.push('全武器最速弾速');
  $('weaponStats').innerHTML = tags.map(s => `<span>${s}</span>`).join('');
  $('start').disabled = !ready || starting;
  equipment.lobby(rules.loadout)
}
function setGraphics(key, value) {
  settings[key] = value;
  save();
  renderer?.settings(settings);
  drawSettings()
}
function drawSettings() {
  group('resolution', settings.resolution, k => setGraphics('resolution', k));
  group('graphics', settings.graphics, k => setGraphics('graphics', k));
  group('rate', settings.rate, k => setGraphics('rate', Number(k)));
  const [w, h] = sizes[settings.resolution];
  $('resolutionHint').textContent = `${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')} px`;
  $('graphicsHint').textContent = !renderer?.native && settings.graphics === 'extra' ? '互換描画 · エフェクト・パーティクル強化' : graphicsHints[settings.graphics];
  $('hdrSwitch').setAttribute('aria-checked', String(settings.hdr));
  $('shadowSwitch').setAttribute('aria-checked', String(settings.shadows));
  $('hdrHint').textContent = settings.hdr ? (renderer?.hdrDisplay?.active ? 'HDRディスプレイ出力' : 'HDR照明 · SDR画面にはトーンマッピング') : '標準レンジ';
  $('sensitivity').value = settings.sensitivity;
  $('sensVal').value = settings.sensitivity.toFixed(1) + '×';
  $('volume').value = settings.volume;
  $('volumeVal').value = settings.volume + '%';
  $('settingStatus').textContent = '設定は自動保存されます'
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
  audio.set(settings.volume / 100);
  await audio.enable(settings.sound);
  save();
  soundButton()
};
$('hdrSwitch').onclick = () => setGraphics('hdr', !settings.hdr);
$('shadowSwitch').onclick = () => setGraphics('shadows', !settings.shadows);
$('sensitivity').oninput = e => {
  settings.sensitivity = Number(e.target.value);
  $('sensVal').value = settings.sensitivity.toFixed(1) + '×';
  save()
};
$('volume').oninput = e => {
  settings.volume = Number(e.target.value);
  settings.sound = settings.volume > 0;
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
  match = new Match(rules, event);
  equipment.prepare(match.player);
  show('game');
  pointer();
  if (settings.sound)audio.enable(true);
  audio.set(settings.volume / 100);
  $('startHint').hidden = false;
  $('startHint').textContent = touch ? '左で移動 · 右をスワイプ · 補給タンカー接近で +100発 / 精製1.5×' : 'WASD 移動　·　左クリック 発射　·　R 再装填　·　補給タンカーで +100発 / 精製1.5×';
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
  if (e.type === 'hit') {
    if (e.actor === p)triggerHitUI(e);
    if (e.victim === p)triggerDamageUI(e, p)
  }
  if (e.type === 'whiz' && e.dist < 2.6) {
    gunMotion.shake = Math.min(1, gunMotion.shake + (1 - e.dist / 2.6) * (e.gun === 'MS10' ? .20 : .12))
  }
  if (e.type === 'tanker' && e.actor === p) {
    $('combatNotice').textContent = '補給タンカー起動　·　弾丸 +100 / 精製能力 1.5×';
    noticeUntil = match.time + 2.8;
    gunMotion.shake = Math.min(1, gunMotion.shake + .18)
  }
  if (e.type === 'point') {
    feed.push({line: `${e.actor.name}　›　${e.victim.name}`, team: e.actor.team, until: match.time + 4.5});
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
  $('roster').innerHTML = '<div class="roster-row heading"><span>参加者</span><span>撃破</span><span>ダウン</span></div>' + match.actors.map(a => `<div class="roster-row"><span class="${a.team?'orange':'cyan'}">${a.name}${a.human?' · 自分':''}</span><span>${a.kills}</span><span>${a.deaths}</span></div>`).join('');
  equipment.result(match)
}
function turn(dx, dy) {
  if (screen !== 'game' || !match?.player.alive)return;
  const a = match.player, fovScale = a.df?.ads ? .58 : .82, k = .00215 * settings.sensitivity * fovScale;
  a.yaw += dx * k;
  a.pitch = clamp(a.pitch - dy * k, -1.31, 1.31);
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
  if (e.code === 'KeyF')holdFireKey = false
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
  holdFireMouse = holdFireKey = holdFireTouch = false;
  doPause()
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    holdFireMouse = holdFireKey = holdFireTouch = false;
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
    x = (e.clientX - (r.left + r.width / 2)) / (r.width * .4),
    z = (e.clientY - (r.top + r.height / 2)) / (r.height * .4),
    l = Math.max(1, Math.hypot(x, z));
  stickX = x / l;
  stickZ = -z / l;
  pad.firstElementChild.style.transform = `translate(${stickX*25}px,${-stickZ*25}px)`
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
    pad.firstElementChild.style.transform = ''
  }
};
$('touchFire').onpointerdown = e => {
  e.preventDefault();
  holdFireTouch = true;
  fire()
};
$('touchFire').onpointerup = $('touchFire').onpointercancel = $('touchFire').onpointerleave = () => {
  holdFireTouch = false
};
for (const [id, action] of [['touchReload', () => match?.reload(match.player)], ['touchJump', () => {
  simJump = true
}]])$(id).onpointerdown = e => {
  e.preventDefault();
  action()
};
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
  let cam;
  if (screen === 'game' && match) {
    accum += dt;
    while (accum + 1e-9 >= fixed && screen === 'game') {
      const fovScale = match.player.df?.ads ? .58 : .82;
      const yaw = (Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'))) * 1.75 * fixed * settings.sensitivity * fovScale,
        pitch = (Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'))) * 1.25 * fixed * settings.sensitivity * fovScale;
      if (match.player.alive) {
        match.player.yaw += yaw;
        match.player.pitch = clamp(match.player.pitch + pitch, -1.31, 1.31);
        if (yaw || pitch) {
          gunMotion.swayX = clamp(gunMotion.swayX - yaw * .18, -.042, .042);
          gunMotion.swayY = clamp(gunMotion.swayY - pitch * .15, -.032, .032)
        }
        if ((holdFireMouse || holdFireKey || holdFireTouch) && weapons[match.player.gun]?.auto) {
          match.trigger(match.player)
        }
      }
      match.step(fixed, {
        side: stickX + Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
        forward: stickZ + Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
        sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
        jump: simJump,
        crouch: keys.has('ControlLeft') || keys.has('ControlRight')
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
      hudAt = timeNow + .065
    }
  }
  if (match) {
    const a = match.player, bob = a.alive ? Math.sin(a.stride * 5.1) * .017 * Math.min(1, Math.hypot(a.vx, a.vz) / 4) : 0;
    const pos = eyeOf(a);
    pos[1] = a.alive ? pos[1] + bob - gunMotion.land * .35 : a.y + .8;
    const tremor = gunMotion.shake * .0045;
    const jitterYaw = tremor * Math.sin(timeNow * 73.1) + gunMotion.camRoll * .35;
    const jitterPitch = tremor * Math.cos(timeNow * 61.7) + gunMotion.camPitch;
    const f = forward(a.yaw + jitterYaw, clamp(a.pitch + jitterPitch, -1.34, 1.34));
    const baseFov = a.alive && a.df?.ads ? ADS_FOV : BASE_FOV;
    cam = {pos, target: add(pos, f), fov: baseFov - gunMotion.fovPunch * .65};
    $('cinema-veil').style.opacity = 0
  } else {
    tourTime += dt;
    cam = titleCamera(tourTime);
    $('cinema-veil').style.opacity = cam.fade
  }
  const cinematic = !match && !renderer.native && settings.shadows && settings.hdr;
  $('app').classList.toggle('cinematic', cinematic);
  if (cinematic)$('cinema-veil').style.opacity = 0; else renderer.render(cam, timeNow, match, {
    firstPerson: !!match?.player.alive && !match?.player.df?.ads,
    kick: gameKick,
    shake: gunMotion.shake,
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
  equipment.draw(renderer, match, cam, timeNow, screen === 'game');
  if (resetView) {
    resetView = false;
    $('loading').hidden = true
  }
  $('app').dataset.renderer = renderer.native ? 'webgl2' : 'software';
}
async function init() {
  controls();
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
