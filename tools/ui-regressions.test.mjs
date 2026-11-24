import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { createCanvas, Image, Path2D } from '@napi-rs/canvas';

const dist = process.env.RESULT_QA_SOURCE
  ? pathToFileURL(resolve(process.env.RESULT_QA_SOURCE, 'dist') + '/')
  : new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
const load = module => import(new URL('js/' + module + '.js', dist));
const {Match} = await load('match');
const {Renderer, effectiveSize} = await load('renderer');
const {SoftwareRenderer} = await load('software');
const {KHDRPipeline} = await load('khdr');
const {PilotEquipment} = await load('df-hud');
const {HDRDisplay} = await load('hdr');
const {SoundEngin2} = await load('audio');
const {PilotWallet} = await load('wallet');
const {imageFrom, loadTextures, labelNames} = await load('materials');
const {layers} = await load('geometry');
let appId = 0;

const settle = async (condition = () => true) => {
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (condition()) return;
  }
  assert(condition(), 'application did not settle');
};

function install(t, globals) {
  for (const [key, value] of Object.entries(globals)) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {value, writable: true, configurable: true});
    t.after(() => before ? Object.defineProperty(globalThis, key, before) : delete globalThis[key]);
  }
}

async function app(t, {prefs = {}, native = true, touches = 0, getGamepads = () => [], storage = {}, width = 1024, height = 720} = {}) {
  const dom = new JSDOM(html, {url: 'https://result.test/dist/', pretendToBeVisual: true});
  const w = dom.window, d = w.document, frames = [];
  const media = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  Object.defineProperties(w.navigator, {maxTouchPoints: {value: touches}, getGamepads: {value: getGamepads}});
  install(t, {document:d, window:w, navigator:w.navigator, localStorage:w.localStorage, indexedDB:undefined,
    BroadcastChannel:undefined, matchMedia:media, innerWidth:width, innerHeight:height,
    requestAnimationFrame: fn => frames.push(fn)});
  t.after(() => w.close());
  localStorage.setItem('result.harbor.v1', JSON.stringify(prefs));
  for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, JSON.stringify(value));
  const canvases = new WeakMap();
  const gl = {
    MAX_TEXTURE_SIZE: 'texture', MAX_RENDERBUFFER_SIZE: 'framebuffer', MAX_VIEWPORT_DIMS: 'viewport',
    getParameter: param => param === 'viewport' ? [4096, 4096] : 4096,
    isContextLost: () => false, getExtension: () => null
  };
  t.mock.method(w.HTMLCanvasElement.prototype, 'getContext', function (kind) {
    if (kind === 'webgl2') return native ? gl : null;
    if (kind !== '2d') return null;
    if (!canvases.has(this)) canvases.set(this, createCanvas(this.width || 1, this.height || 1));
    const context = canvases.get(this).getContext('2d');
    if (!context.drawImage.resolveCanvas) {
      const drawImage = context.drawImage.bind(context);
      context.drawImage = (source, ...args) => drawImage(canvases.get(source) || source, ...args);
      context.drawImage.resolveCanvas = true;
    }
    return context;
  });
  let currentMatch = null, lastRendered = null, rendered = 0;
  for (const Device of [Renderer, SoftwareRenderer]) {
    t.mock.method(Device.prototype, 'init', async function () {});
    t.mock.method(Device.prototype, 'settings', function (config) {
      this.config = {...config};
      this.resize();
    });
    t.mock.method(Device.prototype, 'resize', function () {
      const size = effectiveSize(this.config);
      const [x, y] = height > width ? [...size].reverse() : size;
      this.canvas.width = x; this.canvas.height = y;
      this.aspect = width / height;
    });
    t.mock.method(Device.prototype, 'render', function (_cam, _time, match, view) {
      currentMatch = match;
      lastRendered = {native: this.native, view};
      rendered++;
    });
  }
  const $ = id => d.getElementById(id);
  const click = id => $(id).click();
  const select = (id, value) => $(id).querySelector(`[data-value="${value}"]`).click();
  const key = (code, options = {}) => d.dispatchEvent(new w.KeyboardEvent('keydown', {code, bubbles:true, ...options}));
  const pointer = (id, type, pointerId, pointerType, button = 0, x = 0, y = 0) => {
    const event = new w.MouseEvent(type, {button, clientX:x, clientY:y, bubbles:true});
    Object.defineProperties(event, {pointerId:{value:pointerId}, pointerType:{value:pointerType}});
    $(id).dispatchEvent(event);
  };
  let ms = 0;
  const frame = (increment = 16.667) => {
    ms += increment;
    assert(frames.length, 'no frame callback queued');
    frames.shift()(ms);
  };
  await import(new URL('js/app.js?qa=' + ++appId, dist));
  await settle(() => $('app').classList.contains('render-ready'));
  return {
    d, w, $, click, select, key, pointer, frame,
    start: () => { click('play'); click('start'); frame(); assert.equal(d.body.dataset.screen, 'game'); },
    match: () => currentMatch, lastRendered: () => lastRendered, rendered: () => rendered
  };
}

test('01 | Gamepad permission denial does not stop the frame or the match', async t => {
  const ui = await app(t, {getGamepads: () => { throw new DOMException('blocked', 'SecurityError'); }});
  ui.start();
  ui.frame();
  assert(ui.match().time > 0);
});

test('02 | Losing WebGL pauses and restores the same match on the software renderer', async t => {
  const ui = await app(t);
  ui.start();
  ui.match().player.mag = 3;
  ui.$('scene').dispatchEvent(new ui.w.Event('webglcontextlost', {cancelable:true}));
  assert.equal(ui.d.body.dataset.screen, 'pause');
  await settle(() => !ui.$('resume').disabled);
  ui.click('resume');
  ui.frame();
  assert.equal(ui.lastRendered().native, false);
  assert.equal(ui.match().player.mag, 3);
});

test('03 | A device that cannot allocate full-size FP16 targets falls back atomically to RGBA8', () => {
  let bound, fb, next = 0, deleted = 0;
  const constants = new Map();
  const newId = () => ({id: ++next});
  const methods = {
    getExtension: () => ({}), createTexture: newId, createFramebuffer: newId,
    createRenderbuffer: newId, createProgram: newId, createShader: newId,
    getShaderParameter: () => true,
    getProgramParameter: (_program, param) => param === 'ACTIVE_UNIFORMS' ? 0 : true,
    bindTexture: (_, texture) => { bound = texture; },
    texStorage2D: (_target, _levels, format, width) => { Object.assign(bound, {width, format}); },
    bindFramebuffer: (_, buffer) => { fb = buffer; },
    framebufferTexture2D: (_f, _a, _t, texture) => { if (_a === 'COLOR_ATTACHMENT0') fb.texture = texture; },
    checkFramebufferStatus: () => fb.texture?.format === 'RGBA16F' && fb.texture.width > 4
      ? 'FRAMEBUFFER_INCOMPLETE' : 'FRAMEBUFFER_COMPLETE',
    deleteTexture: () => deleted++
  };
  const gl = new Proxy(methods, {
    get(target, key) {
      if (key in target) return target[key];
      if (/^[A-Z_0-9]+$/.test(key)) {
        if (!constants.has(key)) constants.set(key, key);
        return constants.get(key);
      }
      return () => {};
    }
  });
  const pipe = new KHDRPipeline(gl, '');
  assert.equal(pipe.floatHDR, true);
  pipe.ensure(1280, 720);
  assert.equal(pipe.floatHDR, false);
  assert.equal(pipe.targets.scene.format, 'RGBA8');
  assert(Object.values(pipe.targets).every(Boolean) && deleted > 0);
});

test('04 | Invalid saved choices still allow the title and lobby to load', async t => {
  const ui = await app(t, {prefs:{settings:{resolution:'constructor', graphics:'toString', lightMode:true},
    rules:{mode:'constructor', loadout:'toString'}}});
  ui.start();
  assert.equal(ui.match().actors.length, 6);
  assert.equal(ui.match().player.gun, 'SW T');
});

test('10 | Invalid saved point-limit mode selects the real default', async t => {
  const ui = await app(t, {prefs:{rules:{limit:'unset'}}});
  ui.click('play');
  assert.equal(ui.$('limit').querySelector('[data-value="points"]').getAttribute('aria-pressed'), 'true');
});

test('11 | A failed kill-credit save is visible in results and can be retried', async t => {
  const ui = await app(t, {prefs:{rules:{mode:'3v3'}}});
  const storage = ui.w.Storage.prototype, set = storage.setItem;
  let blocked = true;
  t.mock.method(storage, 'setItem', function (key, value) {
    if (blocked && key.includes('result-pilot-fallback')) throw new DOMException('quota', 'QuotaExceededError');
    return set.call(this, key, value);
  });
  ui.start();
  const m = ui.match();
  const enemy = m.actors.find(a => a.team !== m.player.team);
  m.damage(enemy, m.player, 200);
  ui.click('pauseButton'); ui.click('endMatch');
  await settle();
  assert.match(ui.$('creditResult').textContent, /保存待ち 0\.10/);
  assert.equal(ui.$('retryCredits').hidden, false);
  blocked = false;
  ui.click('retryCredits');
  await settle(() => ui.$('retryCredits').hidden);
  assert.match(ui.$('creditResult').textContent, /所持 0\.10 CR/);
});

test('12 | A saved EVR1 is equipped even if wallet loading finishes after a match starts', async () => {
  const m = new Match({mode:'1v1', loadout:'DF1 OUT'});
  let loaded;
  const wallet = {state:{evr:false}, ready:new Promise(resolve => { loaded = resolve; })};
  const equipment = Object.assign(Object.create(PilotEquipment.prototype), {wallet,getMatch:() => m});
  equipment.prepare(m.player);
  wallet.state.evr = true;
  loaded();
  await wallet.ready;
  assert.equal(m.player.df.scope, 'thermal');
});

test('35 | Ending a match from the pause menu removes airborne shots', async t => {
  const ui = await app(t);
  ui.start();
  const m = ui.match();
  m.trigger(m.player);
  assert.equal(m.shots.length, 1);
  ui.click('pauseButton');
  ui.click('endMatch');
  assert.equal(ui.d.body.dataset.screen, 'results');
  assert.equal(m.shots.length, 0);
});

test('62 | Holding Escape does not toggle pause repeatedly', async t => {
  const ui = await app(t);
  ui.start();
  ui.key('Escape');
  assert.equal(ui.d.body.dataset.screen, 'pause');
  ui.key('Escape', {repeat:true});
  assert.equal(ui.d.body.dataset.screen, 'pause');
});

test('63 | Small refresh jitter does not halve a 60 FPS cap', async t => {
  const ui = await app(t, {prefs:{settings:{rate:60}}});
  ui.start();
  const before = ui.rendered();
  for (let i = 0; i < 15; i++) ui.frame(1000 / 60 + (i % 2 ? .3 : -.3));
  assert(ui.rendered() - before >= 14);
});

test('64 | Simulation keeps pace at a sustained 10 FPS', async t => {
  const ui = await app(t);
  ui.start();
  for (let i = 0; i < 4; i++) ui.frame(100);
  assert(ui.match().time > .39);
});

test('65 | Canceling a mouse pointer releases automatic fire', async t => {
  const ui = await app(t, {prefs:{rules:{loadout:'RD40'}}});
  ui.start();
  ui.pointer('scene', 'pointerdown', 1, 'mouse');
  const mag = ui.match().player.mag;
  ui.pointer('scene', 'pointercancel', 1, 'mouse', -1);
  for (let i = 0; i < 4; i++) ui.frame(100);
  assert.equal(ui.match().player.mag, mag);
});

test('66 | Lost joystick capture returns movement to neutral', async t => {
  const ui = await app(t, {touches:1});
  ui.start();
  ui.$('pad').getBoundingClientRect = () => ({left:0,top:0,width:100,height:100});
  ui.pointer('pad', 'pointerdown', 1, 'touch', 0, 50, 15);
  assert(ui.$('pad').classList.contains('is-sprint'));
  ui.pointer('pad', 'lostpointercapture', 1, 'touch', -1);
  assert(!ui.$('pad').classList.contains('is-sprint'));
  assert.equal(ui.$('pad').firstElementChild.style.transform, '');
});

test('67 | A second finger on a held firing control cannot fire a new single shot', async t => {
  const ui = await app(t, {touches:2, prefs:{rules:{loadout:'SRA'}}});
  ui.start();
  ui.pointer('touchFire', 'pointerdown', 1, 'touch');
  for (let i = 0; i < 4; i++) ui.frame(100);
  const mag = ui.match().player.mag;
  ui.pointer('touchFire', 'pointerdown', 2, 'touch');
  assert.equal(ui.match().player.mag, mag);
});

test('68 | A hybrid device can switch from touchscreen to mouse controls', async t => {
  const ui = await app(t, {touches:5});
  ui.start();
  assert(ui.d.body.classList.contains('touch'));
  ui.pointer('scene', 'pointerdown', 1, 'mouse');
  assert(!ui.d.body.classList.contains('touch'));
  ui.pointer('scene', 'pointerdown', 2, 'touch');
  assert(ui.d.body.classList.contains('touch'));
});

test('69 | Moving the volume slider preserves explicit mute', async t => {
  const ui = await app(t, {prefs:{settings:{sound:false,volume:55}}});
  ui.click('settingsOpen');
  ui.$('volume').value = 30;
  ui.$('volume').dispatchEvent(new ui.w.Event('input', {bubbles:true}));
  const saved = JSON.parse(localStorage.getItem('result.harbor.v1')).settings;
  assert.equal(saved.volume, 30);
  assert.equal(saved.sound, false);
});

test('70 | Software rendering reports unsupported FLIR without showing an active overlay', async t => {
  const ui = await app(t, {native:false});
  ui.start();
  ui.key('KeyT');
  assert.equal(ui.$('flirFrame').hidden, true);
  assert.match(ui.$('combatNotice').textContent, /互換描画/);
  ui.frame();
  assert.equal(ui.lastRendered().view.flir, false);
});

test('71 | A held controller trigger must be released after pausing', async t => {
  const buttons = Array.from({length:18}, () => ({pressed:false,value:0}));
  const pad = {index:0, connected:true, axes:[0,0,0,0], buttons};
  const ui = await app(t, {prefs:{rules:{loadout:'RD40'}}, getGamepads:() => [pad]});
  ui.start();
  buttons[7].pressed = true;
  ui.frame(35);
  const mag = ui.match().player.mag;
  ui.click('pauseButton'); ui.click('resume');
  for (let i = 0; i < 4; i++) ui.frame(100);
  assert.equal(ui.match().player.mag, mag);
  buttons[7].pressed = false; ui.frame();
  buttons[7].pressed = true; ui.frame();
  assert(ui.match().player.mag < mag);
});

test('72 | Changing the FPS cap does not inherit the old frame deadline', async t => {
  const ui = await app(t, {prefs:{settings:{rate:60}}});
  ui.frame();
  ui.click('settingsOpen');
  const before = ui.rendered();
  ui.select('rate', '360');
  ui.frame(4);
  assert.equal(ui.rendered(), before + 1);
});

test('73 | Failing to purchase EVR1 in the lobby shows a visible message', async t => {
  const ui = await app(t, {prefs:{rules:{loadout:'DF1 OUT'}},
    storage:{'result-pilot-fallback':{units:10,evr:false,receipts:['earned']}}});
  ui.click('play');
  await settle(() => !ui.$('buyLobby').disabled);
  const set = ui.w.Storage.prototype.setItem;
  t.mock.method(ui.w.Storage.prototype, 'setItem', function (key, value) {
    if (key.includes('result-pilot-fallback')) throw new DOMException('quota', 'QuotaExceededError');
    return set.call(this, key, value);
  });
  ui.click('buyLobby');
  await settle();
  assert.match(ui.$('lobbyNotice').textContent, /購入を保存できません/);
  assert.equal(ui.$('buyLobby').disabled, false);
});

test('74 | Reopening the EVR1 optic immediately samples the current scene', async t => {
  const ui = await app(t, {prefs:{rules:{loadout:'DF1 OUT'}},
    storage:{'result-pilot-fallback':{units:5,evr:true,receipts:['earned']}}});
  await settle();
  ui.start();
  const scene = ui.$('scene'), context = scene.getContext('2d');
  context.fillStyle = '#151515'; context.fillRect(0, 0, scene.width, scene.height);
  ui.key('KeyC'); ui.frame(10);
  const thermal = ui.$('thermal').getContext('2d');
  const first = thermal.getImageData(5, 5, 1, 1).data[0];
  ui.key('KeyC'); ui.frame(10);
  context.fillStyle = '#d0d0d0'; context.fillRect(0, 0, scene.width, scene.height);
  ui.key('KeyC'); ui.frame(10);
  const now = thermal.getImageData(5, 5, 1, 1).data[0];
  assert(now > first + 40);
});

test('75 | An empty reserve indicates regeneration instead of suggesting an impossible reload', async t => {
  const ui = await app(t);
  ui.start();
  ui.match().player.mag = ui.match().player.stock = 0;
  ui.frame(120);
  assert.match(ui.$('reloadLabel').textContent, /生成/);
});

test('76 | Keyboard-generated clicks activate mobile tactical buttons', async t => {
  const ui = await app(t, {prefs:{rules:{loadout:'DF1 OUT'}}, touches:1});
  ui.start();
  ui.click('mobilePattern');
  assert.equal(ui.match().player.df.pattern, 'spread');
  ui.click('touchSmoke');
  assert(ui.match().smokeCooldown > 0);
});

test('77 | Disconnecting the controller clears toggled crouch', async t => {
  const buttons = Array.from({length:18}, () => ({pressed:false,value:0}));
  const pad = {index:0, connected:true, axes:[0,0,0,0], buttons};
  const ui = await app(t, {getGamepads: () => [pad]});
  ui.start();
  buttons[1].pressed = true;
  ui.frame(100);
  const crouch = ui.match().player.crouch;
  assert(crouch > .1);
  pad.connected = false;
  ui.frame(100);
  assert(ui.match().player.crouch < crouch);
});

test('78 | Entering a zero point multiplier snaps to the lower bound instead of five', async t => {
  const ui = await app(t);
  ui.click('play');
  const mult = ui.$('mult');
  mult.value = 0;
  mult.dispatchEvent(new ui.w.Event('change', {bubbles:true}));
  assert.equal(mult.value, '1');
});

test('79 | Modifier shortcuts cannot fire an in-game weapon', async t => {
  const ui = await app(t);
  ui.start();
  const mag = ui.match().player.mag;
  ui.key('KeyF', {metaKey:true});
  assert.equal(ui.match().player.mag, mag);
});

test('80 | Leaving an HDR display switches back to the regular canvas', async t => {
  let savedHandler = () => {};
  const media = {matches:true, addEventListener:(_, fn) => { savedHandler = fn; }, removeEventListener() {}};
  install(t, {matchMedia:() => media, navigator:{gpu:{}}});
  const canvas = {hidden:true};
  const display = new HDRDisplay(canvas);
  t.mock.method(display, 'init', async () => { display.available = true; });
  await display.choose(true);
  assert.equal(canvas.hidden, false);
  media.matches = false;
  await savedHandler();
  assert.equal(canvas.hidden, true);
});

function renderAssets(t, {missing = [], stalled = [], fetchManifest = async url => new Response(await readFile(new URL(url, dist)))} = {}) {
  class AssetImage extends Image {
    set src(url) {
      if (stalled.includes(url)) return;
      if (missing.includes(url)) queueMicrotask(() => this.onerror?.());
      else super.src = readFileSync(new URL(url, dist));
    }
  }
  install(t, {
    Image: AssetImage, Path2D, document: {createElement: () => createCanvas(1, 1)},
    fetch: fetchManifest
  });
}

test('C01 | Stalled image and manifest requests exit the boot wait', async t => {
  let aborted = false;
  renderAssets(t, {stalled: ['stalled.webp'], fetchManifest: (_url, {signal} = {}) => new Promise((_, reject) => {
    signal?.addEventListener('abort', () => { aborted = true; reject(signal.reason); });
  })});
  const imageResult = await Promise.race([
    imageFrom('stalled.webp', 15).then(() => 'loaded', () => 'failed'),
    delay(200, 'waiting')
  ]);
  assert.equal(imageResult, 'failed');

  const timer = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => timer(fn, ms === 8000 ? 25 : ms, ...args));
  const renderer = new SoftwareRenderer(createCanvas(32, 32));
  const manifestResult = await Promise.race([renderer.init().then(() => 'ready'), delay(3000, 'waiting')]);
  assert.equal(manifestResult, 'ready');
  assert(aborted);
});

test('C02 | The software renderer starts when both scenery images fail', async t => {
  renderAssets(t, {missing: ['./assets/marine-sky.webp', './assets/waves.webp']});
  const renderer = new SoftwareRenderer(createCanvas(32, 32));
  await renderer.init();
  assert(renderer.sky.some(pixel => (pixel >>> 24) === 255));
  assert(renderer.waves.some(pixel => (pixel >>> 24) === 255));
  assert(renderer.mats.length > 1 + labelNames.length, 'the original terrain atlas remains usable');
  assert(renderer.terrain.data.length > 0);
});

test('C03 | A missing or damaged atlas leaves color meshes and labels available', async t => {
  let manifest = {tile: 400, columns: 8, layers: null};
  renderAssets(t, {fetchManifest: async () => manifest ? Response.json(manifest) : new Response('', {status:404})});
  for (let scenario = 0; scenario < 2; scenario++) {
    const renderer = new SoftwareRenderer(createCanvas(32, 32));
    await renderer.init();
    assert.equal(renderer.mats.length, 1 + labelNames.length);
    assert(renderer.terrain.data.length > 0 && renderer.devices['SW T'].data.length > 0);
    assert(layers.labelHBR > 0);
    assert.equal(layers.asphalt, undefined);
    manifest = null;
  }
});

test('C04 | WebGL reports a texture allocation error as an initialization failure', async t => {
  renderAssets(t);
  const deleted = [];
  let num = 0, error = 0;
  const gl = new Proxy({
    NO_ERROR: 0, createTexture: () => ++num, getExtension: () => null,
    texStorage3D: () => { error = 1285; },
    getError: () => error, deleteTexture: texture => deleted.push(texture)
  }, {get: (target, key) => target[key] ?? (() => {})});
  await assert.rejects(loadTextures(gl), /1285/);
  assert.deepEqual(deleted, [1, 2]);
});

test('C05 | A WebGPU validation error reveals the working standard canvas', async t => {
  const device = new EventTarget();
  Object.assign(device, {
    createShaderModule: () => ({}), createRenderPipelineAsync: async () => ({}),
    lost: new Promise(() => {}), destroy() {}
  });
  install(t, {matchMedia: () => ({matches: true}), navigator: {gpu: {
    requestAdapter: async () => ({requestDevice: async () => device})
  }}});
  const canvas = {hidden: true, getContext: () => ({configure() {}, unconfigure() {}})};
  const display = new HDRDisplay(canvas);
  t.after(() => display.dispose());
  await display.choose(true);
  assert.equal(canvas.hidden, false);
  device.dispatchEvent(new Event('uncapturederror'));
  assert.equal(canvas.hidden, true);
  assert.equal(display.active, false);
});

test('C06 | An audio failure on impact cannot interrupt a winning kill or its credit', async t => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(SoundEngin2.prototype, 'enable', async function (on) { this.on = on; });
  t.mock.method(SoundEngin2.prototype, 'event', function (event) {
    if (this.on && event.type === 'hit') throw new Error('audio device lost during hit');
  });
  const ui = await app(t, {prefs: {settings: {sound: true}, rules: {mode:'lab', multiplier:1, lab: {teamACount: 1, teamBCount: 1}}}});
  ui.start();
  const m = ui.match();
  const enemy = m.actors.find(a => a.team !== m.player.team);
  assert(m.damage(enemy, m.player, 200).kill);
  assert.equal(enemy.alive, false);
  assert.deepEqual(m.scores, [1, 0]);
  assert.equal(m.winner, 0);
  assert.equal(ui.d.body.dataset.screen, 'results');
  await settle(() => ui.$('creditResult').textContent.includes('所持 0.10 CR'));
});

test('C07 | An audio listener error leaves frame rendering and simulation running', async t => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(SoundEngin2.prototype, 'enable', async function (on) { this.on = on; });
  let failures = 0;
  t.mock.method(SoundEngin2.prototype, 'update', function (_dt, match) {
    if (this.on && match) { failures++; throw new Error('audio listener update failed'); }
  });
  const ui = await app(t, {prefs: {settings: {sound: true}}});
  ui.start();
  const rendered = ui.rendered(), time = ui.match().time;
  ui.frame(34);
  assert.equal(failures, 1);
  assert(ui.rendered() > rendered);
  assert(ui.match().time > time);
});

test('C08 | A kill survives closing the page before the first asynchronous write', async t => {
  const stalled = t.mock.method(PilotWallet.prototype, 'change', () => new Promise(() => {}));
  const ui = await app(t, {prefs: {rules: {mode:'3v3'}}});
  ui.start();
  const m = ui.match();
  const enemy = m.actors.find(a => a.team !== m.player.team);
  m.damage(enemy, m.player, 200);
  stalled.mock.restore();
  const reopened = new PilotEquipment(() => null, () => {});
  await settle(() => ui.$('lobbyCredit').textContent === '0.10 CR');
  assert(!await reopened.wallet.change(m.receiptId + '/0/1'));
  assert.equal(ui.$('lobbyCredit').textContent, '0.10 CR');
});
