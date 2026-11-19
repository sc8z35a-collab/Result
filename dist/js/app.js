import {PilotEquipment} from './df-hud.js';
import {eyeOf} from './posture.js';
import {Renderer, sizes} from './renderer.js';
import {titleCamera} from './harbor.js';
import {Match, modes, weapons} from './match.js';
import {forward, add, clamp} from './geometry.js';
import {PortAudio} from './audio.js';
const $ = s => document.getElementById(s),
  views = {title: 'titleView', lobby: 'lobby', settings: 'settings', game: 'hud', pause: 'pause', results: 'results'};
const defaults = {resolution: 'HD', rate: 120, hdr: true, shadows: true, sensitivity: 1, volume: 55, sound: false};
let settings = {...defaults};
let rules = {mode: '3v3', limit: 'points', multiplier: 5, loadout: 'SW T'};
try {
  const c = JSON.parse(localStorage.getItem('result.harbor.v1') || '{}');
  if (c.settings)Object.assign(settings, c.settings);
  if (c.rules)Object.assign(rules, c.rules)
} catch {}
if (!sizes[settings.resolution])settings.resolution = 'HD';
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
  hitFlash = 0,
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
  aimTouchLast = null;
const keys = new Set(), audio = new PortAudio();
let feed = [];
const fixed = 1 / 120;
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
  const rows = touch ? [['移動', '左スティック'], ['視点', '右側をスワイプ'], ['発射 / 再装填', '射撃 / R'], ['ジャンプ', '↑']] : [['移動 / ダッシュ', 'WASD / Shift'], ['視点', 'マウス / 矢印キー'], ['発射 / 再装填', '左クリック・F / R'], ['ジャンプ / しゃがむ', 'Space / Ctrl'], ['一時停止', 'Esc / P']];
  if (match?.player.df)rows.push(...(touch ? [['DF1 OUT', '画面右の専用ボタン']] : [['中央集中 / 散弾', 'Q'], ['P1 ブースト', 'X'], ['照準 / レンズ切替', '右クリック・C / V'], ['EVR1 購入', 'B']]));
  $('controls').innerHTML = rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('')
}
function show(s) {
  screen = s;
  document.body.dataset.screen = s;
  for (const [k, id] of Object.entries(views))$(id).hidden = k !== s;
  keys.clear();
  simJump = false;
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
  $('weaponStats').innerHTML = [`弾倉 ${w.capacity} 発`, `威力 ${w.damage}`, w.burst > 1 ? w.burst + '発バースト' : '単発', `連射比 ${w.rate}`, `弾速比 ${w.velocity}`].map(s => `<span>${s}</span>`).join('');
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
  group('rate', settings.rate, k => setGraphics('rate', Number(k)));
  const [w, h] = sizes[settings.resolution];
  $('resolutionHint').textContent = `${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')} px`;
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
  gameKick = hitFlash = hurt = 0;
  noticeUntil = 0;
  match = new Match(rules, event);
  equipment.prepare(match.player);
  show('game');
  pointer();
  if (settings.sound)audio.enable(true);
  audio.set(settings.volume / 100);
  $('startHint').hidden = false;
  $('startHint').textContent = touch ? '左で移動 · 右をスワイプして視点操作' : 'WASD 移動　·　左クリック 発射　·　R 再装填　·　Esc メニュー';
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
  if (e.type === 'fire' && e.actor === p)gameKick = 1;
  if (e.type === 'hit') {
    if (e.actor === p)hitFlash = 1;
    if (e.victim === p)hurt = 1
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
  $('respawn').hidden = a.alive;
  $('reticle').hidden = !a.alive;
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
  const a = match.player, k = .00215 * settings.sensitivity;
  a.yaw += dx * k;
  a.pitch = clamp(a.pitch - dy * k, -1.31, 1.31)
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
  if (e.repeat)return;
  if (e.code === 'KeyR')match.reload(match.player);
  if (e.code === 'KeyF')fire();
  if (e.code === 'Space')simJump = true;
  if (e.code === 'KeyP')doPause();
  const extra = {KeyQ: 'pattern', KeyX: 'boost', KeyC: 'ads', KeyV: 'scope', KeyB: 'buy'}[e.code];
  if (extra)equipment.action(extra)
});
document.addEventListener('keyup', e => keys.delete(e.code));
let wasLocked = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === $('scene');
  if (wasLocked && !locked && screen === 'game')doPause();
  wasLocked = locked;
  lockPending = false
});
document.addEventListener('pointerlockerror', () => {
  lockPending = false
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === $('scene'))turn(e.movementX, e.movementY)
});
window.addEventListener('blur', doPause);
document.addEventListener('visibilitychange', () => {
  if (document.hidden)doPause();
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
  if (dragID === e.pointerId)dragID = null
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
for (const [id, action] of [['touchFire', fire], ['touchReload', () => match?.reload(match.player)], ['touchJump', () => {
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
      const yaw = (Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'))) * 1.75 * fixed * settings.sensitivity,
        pitch = (Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'))) * 1.25 * fixed * settings.sensitivity;
      if (match.player.alive) {
        match.player.yaw += yaw;
        match.player.pitch = clamp(match.player.pitch + pitch, -1.31, 1.31)
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
    hitFlash = Math.max(0, hitFlash - dt * 5.2);
    hurt = Math.max(0, hurt - dt * 2);
    $('hitmark').style.opacity = hitFlash;
    $('damageVeil').style.opacity = hurt;
    if (timeNow >= hudAt) {
      hud();
      hudAt = timeNow + .065
    }
  }
  if (match) {
    const a = match.player, bob = a.alive ? Math.sin(a.stride * 5.1) * .017 * Math.min(1, Math.hypot(a.vx, a.vz) / 4) : 0;
    const pos = eyeOf(a);
    pos[1] = a.alive ? pos[1] + bob : a.y + .8;
    const f = forward(a.yaw, a.pitch);
    cam = {pos, target: add(pos, f), fov: a.alive && a.df?.ads ? 42 : 73};
    $('cinema-veil').style.opacity = 0
  } else {
    tourTime += dt;
    cam = titleCamera(tourTime);
    $('cinema-veil').style.opacity = cam.fade
  }
  const cinematic = !match && !renderer.native && settings.shadows && settings.hdr;
  $('app').classList.toggle('cinematic', cinematic);
  if (cinematic)$('cinema-veil').style.opacity = 0; else renderer.render(cam, timeNow, match, {firstPerson: !!match?.player.alive && !match?.player.df?.ads, kick: gameKick});
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
