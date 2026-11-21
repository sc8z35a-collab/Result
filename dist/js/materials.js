import {layers} from './geometry.js';
const loadTimeout = 8000;

export function imageFrom(url, timeout = loadTimeout) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    const finish = error => {
      clearTimeout(timer);
      im.onload = im.onerror = null;
      if (error) reject(error);
      else resolve(im);
    };
    const timer = setTimeout(() => finish(new Error('画像の読み込みがタイムアウトしました ' + url)), timeout);
    im.onload = () => finish();
    im.onerror = () => finish(new Error('画像を読み込めませんでした ' + url));
    im.src = url;
  });
}

async function fetchManifest() {
  const signal = new AbortController();
  const timer = setTimeout(() => signal.abort(), loadTimeout);
  try {
    const response = await fetch('./assets/materials.json', {signal: signal.signal});
    if (!response.ok) throw new Error('素材一覧を読み込めません');
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function loadAtlas() {
  try {
    const [manifest, sheet] = await Promise.all([fetchManifest(), imageFrom('./assets/materials.webp')]);
    const {tile, columns, layers: entries} = manifest;
    if (!Number.isInteger(tile) || tile < 1 || tile > 1024 || !Number.isInteger(columns) || columns < 1 ||
        !Array.isArray(entries) || entries.length > 128 ||
        entries.some(entry => typeof entry?.name !== 'string' || !/^[a-z][a-z0-9]*$/i.test(entry.name) ||
          entry.name === 'white' || Object.hasOwn(Object.prototype, entry.name)) ||
        new Set(entries.map(entry => entry.name)).size !== entries.length ||
        sheet.width < columns * tile || sheet.height < Math.ceil(entries.length / columns) * tile) {
      throw new Error('素材一覧と画像が一致しません');
    }
    return {manifest, sheet};
  } catch {
    return {manifest: {tile: 128, columns: 1, layers: []}, sheet: null};
  }
}

function fallbackScenery(sky) {
  const canvas = document.createElement('canvas');
  canvas.width = sky ? 64 : 4;
  canvas.height = sky ? 32 : 4;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, sky ? '#aac9d1' : '#7b8280');
  gradient.addColorStop(1, sky ? '#607f9a' : '#858281');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

export function loadScenery(sky) {
  const url = sky ? './assets/marine-sky.webp' : './assets/waves.webp';
  return imageFrom(url).catch(() => fallbackScenery(sky));
}

export function resetMaterialLayers() {
  for (const key of Object.keys(layers)) delete layers[key];
  layers.white = 0;
}

export const labelNames = ['HBR', 'NORTH', 'TIDE', 'serial', 'hazard', '04', '05', '07', 'berth', 'door', 'gate', 'yard', 'arrow', 'mark04', 'ship', 'portal', 'supply'];
export function makeLabel(name, ctx, s) {
  ctx.clearRect(0, 0, s, s);
  ctx.save();
  ctx.scale(s / 400, s / 400);
  const ink = '#f4efd9', black = '#183037';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  const label = (txt, x, y, size, font = 'bold', align = 'center') => {
    ctx.font = `${font} ${size}px Arial, sans-serif`;
    ctx.textAlign = align;
    ctx.fillText(txt, x, y)
  };
  if (['HBR', 'TIDE', 'NORTH'].includes(name)) {
    if (name === 'TIDE') {
      ctx.lineWidth = 11;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(35, 149 + k * 24);
        ctx.lineTo(74, 132 + k * 24);
        ctx.lineTo(117, 144 + k * 24);
        ctx.stroke()
      }
      label('TIDE', 250, 183, 95, 'italic bold')
    }
    if (name === 'HBR') {
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(28 + k * 22, 212);
        ctx.lineTo(60 + k * 22, 150);
        ctx.lineTo(77 + k * 22, 150);
        ctx.lineTo(46 + k * 22, 212);
        ctx.fill()
      }
      label('HBR', 250, 186, 103, 'bold')
    }
    if (name === 'NORTH') {
      ctx.beginPath();
      ctx.moveTo(18, 211);
      ctx.lineTo(57, 148);
      ctx.lineTo(90, 209);
      ctx.lineTo(56, 181);
      ctx.fill();
      label('NORTH', 245, 185, 76, 'bold')
    }
    label('M A R I N E   L O G I S T I C S', 203, 242, 15, 'bold');
  } else if (name === 'serial') {
    ctx.textAlign = 'left';
    for (const [i, t] of ['RSLU  041672  8', '45G1', 'MAX. GR.     32 500 KG', 'TARE           3 750 KG', 'NET            28 750 KG', 'CU. CAP.      76.4 CU.M.'].entries())label(t, 18, 44 + i * 47, i < 2 ? 31 : 19, 'bold', 'left');
    ctx.strokeRect(15, 323, 94, 40);
    label('IC  90', 27, 347, 20, 'bold', 'left')
  } else if (name === 'hazard') {
    ctx.fillStyle = '#dcb65b';
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = '#253032';
    for (let k = -5; k < 12; k++) {
      ctx.beginPath();
      ctx.moveTo(k * 88, 0);
      ctx.lineTo(k * 88 + 41, 0);
      ctx.lineTo(k * 88 - 144, 400);
      ctx.lineTo(k * 88 - 185, 400);
      ctx.fill()
    }
  } else if (['04', '05', '07'].includes(name)) {
    ctx.fillStyle = '#1e464d';
    ctx.fillRect(0, 0, 400, 400);
    ctx.strokeStyle = '#b9c7bb';
    ctx.lineWidth = 5;
    ctx.strokeRect(15, 15, 370, 370);
    ctx.fillStyle = ink;
    label('GANTRY', 200, 79, 40, 'bold');
    label(name, 200, 226, 204, 'bold');
    ctx.fillRect(64, 333, 272, 8)
  } else if (name === 'berth') {
    ctx.fillStyle = '#203a40';
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = '#d4ad55';
    ctx.fillRect(0, 0, 22, 400);
    ctx.fillStyle = ink;
    label('BERTH', 207, 118, 58);
    label('N° 04', 207, 239, 105)
  } else if (name === 'door') {
    ctx.fillStyle = '#243338';
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = ink;
    label('WAREHOUSE', 200, 112, 42);
    label('04', 200, 236, 150)
  } else if (name === 'gate') {
    ctx.fillStyle = '#273a3c';
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = ink;
    label('PORT', 200, 109, 64);
    label('AUTHORITY', 200, 207, 50);
    ctx.fillStyle = '#e0b659';
    ctx.fillRect(45, 300, 310, 12)
  } else if (name === 'yard') {
    label('SLOW', 200, 200, 98)
  } else if (name === 'mark04') {
    label('04', 200, 200, 255)
  } else if (name === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(200, 35);
    ctx.lineTo(310, 176);
    ctx.lineTo(232, 150);
    ctx.lineTo(232, 359);
    ctx.lineTo(168, 359);
    ctx.lineTo(168, 150);
    ctx.lineTo(90, 176);
    ctx.closePath();
    ctx.fill()
  } else if (name === 'ship') {
    label('MERIDIAN', 200, 180, 69);
    label('PORT  OF  REGISTRY', 200, 251, 22)
  } else if (name === 'portal') {
    ctx.fillStyle = '#e3c778';
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = black;
    label('PORT  AUTHORITY', 200, 115, 36);
    ctx.fillRect(36, 171, 328, 5);
    label('HARBOR  04', 200, 249, 49)
  } else if (name === 'supply') {
    ctx.fillStyle = '#18343a';
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = '#eab854';
    ctx.fillRect(0, 0, 400, 34);
    ctx.fillRect(0, 366, 400, 34);
    ctx.strokeStyle = '#7ce2d2';
    ctx.lineWidth = 6;
    ctx.strokeRect(18, 50, 364, 300);
    ctx.fillStyle = '#7ce2d2';
    label('AMMO TANKER', 200, 118, 42);
    ctx.fillStyle = ink;
    label('+100 RDS', 200, 208, 66);
    ctx.fillStyle = '#f2c96b';
    label('REFINE  1.5×', 200, 294, 42)
  }
  ctx.restore();
  return ctx.getImageData(0, 0, s, s)
}
export async function loadTextures(gl) {
  const [{manifest, sheet}, sky] = await Promise.all([loadAtlas(), loadScenery(true)]);
  resetMaterialLayers();
  const s = manifest.tile, n = 1 + manifest.layers.length + labelNames.length, can = document.createElement('canvas');
  can.width = can.height = s;
  const ctx = can.getContext('2d', {willReadFrequently: true});
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(s)) + 1, gl.RGBA8, s, s, n);
  const put = (i, img) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, s, s, 1, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, s, s);
  put(0, ctx.getImageData(0, 0, s, s));
  manifest.layers.forEach((e, i) => {
    layers[e.name] = i + 1;
    ctx.drawImage(sheet, i % manifest.columns * s, Math.floor(i / manifest.columns) * s, s, s, 0, 0, s, s);
    put(i + 1, ctx.getImageData(0, 0, s, s))
  });
  labelNames.forEach((name, i) => {
    const j = manifest.layers.length + 1 + i;
    layers['label' + name] = j;
    put(j, makeLabel(name, ctx, s))
  });
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const ani = gl.getExtension('EXT_texture_filter_anisotropic');
  if (ani)gl.texParameterf(gl.TEXTURE_2D_ARRAY, ani.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(ani.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  const skyTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, skyTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, sky);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    gl.deleteTexture(tex);
    gl.deleteTexture(skyTex);
    throw new Error('WebGL テクスチャを割り当てられませんでした (' + error + ')');
  }
  return {tex, sky: skyTex};
}
