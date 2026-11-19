// Perspective-correct textured rasterization for devices on which WebGL is unavailable.
// Both renderers consume the same metric meshes, camera, actors and match simulation.
import {buildHarbor} from './harbor.js';
import {character, viewModel, movingDetails, muzzleFlashMesh} from './models.js';
import {weapons, npcWeapons} from './match.js';
import {sizes} from './renderer.js';
import {layers, unit, sub, cross, add, scale, dot, clamp} from './geometry.js';
import {imageFrom, labelNames, makeLabel} from './materials.js';
const STR = 13, SUN = unit([-.66, .28, -.70]);
const pack = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c
}
function tex(can) {
  const mip = [];
  let size = 256;
  while (size >= 1) {
    const c = canvas(size, size), ctx = c.getContext('2d', {willReadFrequently: true});
    ctx.drawImage(can, 0, 0, size, size);
    mip.push(new Uint32Array(ctx.getImageData(0, 0, size, size).data.buffer));
    size >>= 1
  }
  return mip
}
function chunk(mesh) {
  const data = new Float32Array(mesh.data), groups = new Map();
  for (let a = 0; a < data.length; a += 39) {
    const x = (data[a] + data[a + 13] + data[a + 26]) / 3,
      z = (data[a + 2] + data[a + 15] + data[a + 28]) / 3,
      k = Math.floor(x / 14) + Math.floor(z / 18) * 1000;
    let group = groups.get(k);
    if (!group) {
      group = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], indices: []};
      groups.set(k, group)
    }
    group.indices.push(a);
    for (let j = a; j < a + 39; j += 13)for (let i = 0; i < 3; i++) {
      group.min[i] = Math.min(group.min[i], data[j + i]);
      group.max[i] = Math.max(group.max[i], data[j + i])
    }
  }
  for (const g of groups.values()) {
    g.center = g.min.map((v, i) => (v + g.max[i]) * .5);
    g.radius = Math.hypot(...g.max.map((v, i) => v - g.center[i]));
    g.indices = new Int32Array(g.indices)
  }
  return {data, groups: [...groups.values()]}
}
function shadowImage(data) {
  const w = 420, h = 1024, can = canvas(w, h), ctx = can.getContext('2d', {willReadFrequently: true});
  ctx.fillStyle = 'white';
  const path = new Path2D();
  const sx = SUN[0] / SUN[1], sz = SUN[2] / SUN[1];
  for (let i = 0; i < data.length; i += 39) {
    if (Math.max(data[i + 1], data[i + 14], data[i + 27]) < .24 || data[i + 12] === 4)continue;
    let coords = [];
    for (const n of [i, i + 13, i + 26])coords.push([(data[n] - data[n + 1] * sx + 28) * w / 56, (data[n + 2] - data[n + 1] * sz + 102) * h / 204]);
    if (coords.every(v => v[0] < 0) || coords.every(v => v[0] > w) || coords.every(v => v[1] < 0) || coords.every(v => v[1] > h))continue;
    const [a, b, c] = coords, area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (area > 0) {
      path.moveTo(...a);
      path.lineTo(...b);
      path.lineTo(...c);
      path.closePath()
    }
  }
  ctx.fill(path);
  return {data: ctx.getImageData(0, 0, w, h).data, w, h}
}
function lut(mode) {
  const out = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) {
    const lin = (i / 255) ** 2.2;
    let v;
    if (mode === 'khdr') {
      v = Math.min(1, (lin * (2.68 * lin + .022)) / (lin * (2.68 * lin + .62) + .165));
    } else if (mode === 'hdr') {
      const c = lin * .87;
      v = Math.min(1, (c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14));
    } else {
      v = Math.min(1, lin * .95);
    }
    out[i] = Math.round(v ** (1 / 2.2) * 255)
  }
  return out
}
export class SoftwareRenderer {
  constructor(input) {
    this.native = false;
    this.floatHDR = false;
    this.input = input;
    this.canvas = input;
    this.ctx = input.getContext('2d', {alpha: false});
    if (!this.ctx) {
      this.canvas = canvas(1, 1);
      this.canvas.id = 'software-surface';
      input.after(this.canvas);
      this.ctx = this.canvas.getContext('2d', {alpha: false})
    }
    this.hdrDisplay = {active: false};
    this.bgStamp = '';
    this.tones = {sdr: lut('sdr'), hdr: lut('hdr'), khdr: lut('khdr')}
  }
  async init() {
    const [manifest, img, sky, waves] = await Promise.all([fetch('./assets/materials.json').then(r => r.json()), imageFrom('./assets/materials.webp'), imageFrom('./assets/marine-sky.webp'), imageFrom('./assets/waves.webp')]);
    const s = manifest.tile, c = canvas(s, s), ctx = c.getContext('2d', {willReadFrequently: true});
    this.mats = [];
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, s, s);
    this.mats.push(tex(c));
    manifest.layers.forEach((a, i) => {
      layers[a.name] = i + 1;
      ctx.drawImage(img, i % manifest.columns * s, Math.floor(i / manifest.columns) * s, s, s, 0, 0, s, s);
      this.mats.push(tex(c))
    });
    for (const a of labelNames) {
      layers['label' + a] = this.mats.length;
      makeLabel(a, ctx, s);
      this.mats.push(tex(c))
    }
    const sc = canvas(1024, 256), st = sc.getContext('2d', {willReadFrequently: true});
    st.drawImage(sky, 0, 0, 1024, 256);
    this.sky = new Uint32Array(st.getImageData(0, 0, 1024, 256).data.buffer);
    const wc = canvas(256, 256), wt = wc.getContext('2d', {willReadFrequently: true});
    wt.drawImage(waves, 0, 0, 256, 256);
    this.waves = new Uint32Array(wt.getImageData(0, 0, 256, 256).data.buffer);
    this.terrain = chunk(buildHarbor());
    this.shadow = shadowImage(this.terrain.data);
    this.actors = {};
    this.devices = {};
    for (const g of Object.keys(weapons)) {
      if (npcWeapons.includes(g))for (const team of [0, 1])this.actors[team + g] = chunk(character(team, g));
      this.devices[g] = chunk(viewModel(g))
    }
  }
  settings(config) {
    this.config = {...config};
    this.tone = config.khdr ? this.tones.khdr : config.hdr ? this.tones.hdr : this.tones.sdr;
    this.resize()
  }
  resize() {
    let [w, h] = sizes[this.config.resolution] || sizes.HD;
    if (innerHeight > innerWidth)[w, h] = [h, w];
    this.aspect = this.input.clientWidth / Math.max(1, this.input.clientHeight);
    if (w === this.w && h === this.h)return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.img = this.ctx.createImageData(w, h);
    this.pix = new Uint32Array(this.img.data.buffer);
    this.depth = new Float32Array(w * h);
    this.xcol = new Int32Array(w);
    this.rayX = new Float32Array(w);
    this.rayZ = new Float32Array(w);
    this.bgStamp = ''
  }
  background(time) {
    const w = this.w,
      h = this.h,
      half = w / 2,
      cam = this.cam,
      dx = cam.dir[0],
      dy = cam.dir[1],
      dz = cam.dir[2],
      yaw = Math.atan2(dx, -dz),
      pitch = Math.asin(clamp(dy, -1, 1)),
      focal = this.fy,
      rou = this.tone,
      sky = this.sky,
      px = this.pix,
      eye = cam.eye;
    const sunCol = Math.atan2(SUN[0], -SUN[2]), sunEl = Math.asin(SUN[1]);
    const sw = .009;
    const yawSun = Math.atan2(Math.sin(sunCol - yaw), Math.cos(sunCol - yaw));
    const sunX = half + this.fx * Math.tan(yawSun), sunY = h / 2 - this.fy * Math.tan(sunEl - pitch), rad = Math.max(2, sw * this.fy);
    const waveOff = time * 7 | 0, sample = this.waves;
    for (let x = 0; x < w; x++) {
      const a = yaw + Math.atan((x - half) / this.fx);
      this.xcol[x] = ((a / (2 * Math.PI) + .5) * 1024 | 0) & 1023;
      this.rayX[x] = Math.sin(a);
      this.rayZ[x] = -Math.cos(a)
    }
    for (let y = 0; y < h; y++) {
      const el = pitch + Math.atan((h * .5 - y) / focal), isSky = el >= 0, sy = clamp(Math.round(Math.abs(el) / 1.5708 * 255), 0, 255) * 1024;
      const row = y * w;
      const plane = Math.min(1100, (eye[1] + 1.68) / Math.max(.001, -Math.sin(el)));
      const fr = isSky ? 1 : clamp(.16 + .81 * Math.exp(-Math.abs(el) * 4.7), .14, .95), fInv = 1 - fr;
      const sySun = (y - sunY) / rad;
      for (let x = 0; x < w; x += 2) {
        let a = this.xcol[x], r, g, b;
        if (isSky) {
          const v = sky[sy + a];
          r = v & 255;
          g = v >> 8 & 255;
          b = v >> 16 & 255;
          if (Math.abs(yawSun) < 1.85 && Math.abs(sySun) < 1.25) {
            const dist = ((x - sunX) / rad) ** 2 + sySun * sySun;
            if (dist < 1.4) {
              const gain = 1 - Math.min(1, dist * .5);
              r += 155 * gain;
              g += 115 * gain;
              b += 58 * gain
            }
          }
        } else {
          const wx = eye[0] + plane * this.rayX[x], wz = eye[2] + plane * this.rayZ[x];
          const t = sample[(((wz * 5 + waveOff) | 0) & 255) * 256 + (((wx * 6 + waveOff * .6) | 0) & 255)], u = (t & 255) - 128, v = (t >> 8 & 255) - 128;
          const c = sky[clamp((sy / 1024 + u * .095) | 0, 0, 255) * 1024 + ((a + (v * .08 | 0)) & 1023)];
          r = (c & 255) * fr + 43 * fInv + u * .048;
          g = (c >> 8 & 255) * fr + 94 * fInv + u * .072;
          b = (c >> 16 & 255) * fr + 99 * fInv + u * .071;
          if (Math.abs(yawSun) < 1.65) {
            const k = Math.max(0, 1 - Math.abs(x - sunX - u * 1.2) / (35 + (-el) * 60));
            const s = k * k * Math.max(0, (v + u * .5 - 15)) * .7;
            r += s;
            g += s * .81;
            b += s * .47
          }
        }
        const col = pack(rou[clamp(r | 0, 0, 1023)], rou[clamp(g | 0, 0, 1023)], rou[clamp(b | 0, 0, 1023)]);
        px[row + x] = col;
        if (x + 1 < w)px[row + x + 1] = col
      }
    }
  }
  project(p) {
    return [this.w * .5 + p[0] / p[2] * this.fx, this.h * .5 - p[1] / p[2] * this.fy, 1 / p[2], p[3], p[4], p[5], p[6]]
  }
  triangle(a, b, c, mat, shade, ground, alpha) {
    const W = this.w, H = this.h, Z = this.depth, px = this.pix, mm = this.mats[mat], rou = this.tone;
    const den = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(den) < .18)return;
    const x0 = Math.max(0, Math.ceil(Math.min(a[0], b[0], c[0]) - .5)),
      x1 = Math.min(W - 1, Math.floor(Math.max(a[0], b[0], c[0]) - .5)),
      y0 = Math.max(0, Math.ceil(Math.min(a[1], b[1], c[1]) - .5)),
      y1 = Math.min(H - 1, Math.floor(Math.max(a[1], b[1], c[1]) - .5));
    if (x0 > x1 || y0 > y1)return;
    const dx1 = (c[1] - a[1]) / den,
      dy1 = (a[0] - c[0]) / den,
      dx2 = (a[1] - b[1]) / den,
      dy2 = (b[0] - a[0]) / den,
      dx0 = -dx1 - dx2,
      dy0 = -dy1 - dy2;
    const l1 = (x0 + .5 - a[0]) * dx1 + (y0 + .5 - a[1]) * dy1, l2 = (x0 + .5 - a[0]) * dx2 + (y0 + .5 - a[1]) * dy2, l0 = 1 - l1 - l2;
    const izA = a[2], izB = b[2], izC = c[2], dz = dx0 * izA + dx1 * izB + dx2 * izC, ez = dy0 * izA + dy1 * izB + dy2 * izC;
    let zRow = l0 * izA + l1 * izB + l2 * izC;
    const uA = a[3] * izA, uB = b[3] * izB, uC = c[3] * izC, vA = a[4] * izA, vB = b[4] * izB, vC = c[4] * izC;
    const du = dx0 * uA + dx1 * uB + dx2 * uC, eu = dy0 * uA + dy1 * uB + dy2 * uC, dv = dx0 * vA + dx1 * vB + dx2 * vC, ev = dy0 * vA + dy1 * vB + dy2 * vC;
    let uRow = l0 * uA + l1 * uB + l2 * uC, vRow = l0 * vA + l1 * vB + l2 * vC;
    const level = clamp(Math.floor(Math.log2(Math.max(.003, Math.abs(dx0 * a[3] + dx1 * b[3] + dx2 * c[3]), Math.abs(dy0 * a[4] + dy1 * b[4] + dy2 * c[4]), Math.abs(dx0 * a[4] + dx1 * b[4] + dx2 * c[4]), Math.abs(dy0 * a[3] + dy1 * b[3] + dy2 * c[3])) * 256)), 0, 8),
      size = 256 >> level,
      mask = size - 1,
      texture = mm[level];
    const [cr, cg, cb, fog] = shade,
      fr = fog * 191,
      fg = fog * 200,
      fb = fog * 197,
      shadow = this.shadow,
      sfMode = this.config.shadowMode || (this.config.shadows ? 'pro' : 'off'),
      doShadow = ground && sfMode !== 'off';
    const A = a[5] * izA,
      B = b[5] * izB,
      C = c[5] * izC,
      E = a[6] * izA,
      F = b[6] * izB,
      G = c[6] * izC,
      dX = dx0 * A + dx1 * B + dx2 * C,
      eX = dy0 * A + dy1 * B + dy2 * C,
      dZ = dx0 * E + dx1 * F + dx2 * G,
      eZ = dy0 * E + dy1 * F + dy2 * G;
    let wxRow = l0 * A + l1 * B + l2 * C, wzRow = l0 * E + l1 * F + l2 * G;
    for (let y = y0, ar = l0, br = l1, cc = l2; y <= y1; y++, ar += dy0, br += dy1, cc += dy2, zRow += ez, uRow += eu, vRow += ev, wxRow += eX, wzRow += eZ) {
      let lo = 0, hi = x1 - x0;
      const margin = -.00003;
      if (dx0 > 1e-10)lo = Math.max(lo, Math.ceil((margin - ar) / dx0)); else if (dx0 < -1e-10)hi = Math.min(hi, Math.floor((margin - ar) / dx0)); else if (ar < margin)continue;
      if (dx1 > 1e-10)lo = Math.max(lo, Math.ceil((margin - br) / dx1)); else if (dx1 < -1e-10)hi = Math.min(hi, Math.floor((margin - br) / dx1)); else if (br < margin)continue;
      if (dx2 > 1e-10)lo = Math.max(lo, Math.ceil((margin - cc) / dx2)); else if (dx2 < -1e-10)hi = Math.min(hi, Math.floor((margin - cc) / dx2)); else if (cc < margin)continue;
      const end = y * W + x0 + hi;
      let inv = zRow + dz * lo, U = uRow + du * lo, V = vRow + dv * lo, WX = wxRow + dX * lo, WZ = wzRow + dZ * lo;
      for (let ix = y * W + x0 + lo; ix <= end; ix++, inv += dz, U += du, V += dv, WX += dX, WZ += dZ) {
        if (inv < Z[ix])continue;
        const dep = 1 / inv, u = U * dep * size, v = V * dep * size, col = texture[((Math.floor(v) & mask) * size) + (Math.floor(u) & mask)];
        if (alpha && (col >>> 24) < 110)continue;
        let sh = 1;
        if (doShadow) {
          const xx = ((WX * dep + 28) * shadow.w / 56) | 0, zz = ((WZ * dep + 102) * shadow.h / 204) | 0;
          if (sfMode === 'pro' && xx >= 1 && zz >= 1 && xx < shadow.w - 1 && zz < shadow.h - 1) {
            const d0 = shadow.data[(zz * shadow.w + xx) * 4 + 3];
            const d1 = shadow.data[(zz * shadow.w + xx + 1) * 4 + 3];
            const d2 = shadow.data[((zz + 1) * shadow.w + xx) * 4 + 3];
            const d3 = shadow.data[((zz - 1) * shadow.w + xx - 1) * 4 + 3];
            sh = 1 - ((d0 + d1 + d2 + d3) * .25) * (.32 / 255);
          } else if (xx >= 0 && zz >= 0 && xx < shadow.w && zz < shadow.h) {
            sh = 1 - shadow.data[(zz * shadow.w + xx) * 4 + 3] * (.28 / 255);
          }
        }
        Z[ix] = inv;
        px[ix] = pack(rou[Math.min(1023, ((col & 255) * cr * sh + fr) | 0)], rou[Math.min(1023, ((col >> 8 & 255) * cg * sh + fg) | 0)], rou[Math.min(1023, ((col >> 16 & 255) * cb * sh + fb) | 0)])
      }
    }
  }
  mesh(item, transform = null, gait = null, view = false) {
    const cam = this.cam, w = this.w, h = this.h, da = item.data, rx = cam.right, up = cam.up, fw = cam.dir, eye = cam.eye, near = .09;
    let groups = item.groups;
    if (!transform) {
      groups = [];
      for (const g of item.groups) {
        const r = sub(g.center, eye), z = dot(r, fw), rad = g.radius;
        if (z + rad < near || Math.abs(dot(r, rx)) > Math.max(0, z) * this.tanX + rad * (1 + this.tanX) || Math.abs(dot(r, up)) > Math.max(0, z) * this.tanY + rad * (1 + this.tanY))continue;
        groups.push([g, z - rad])
      }
      groups.sort((a, b) => a[1] - b[1]);
      groups = groups.map(s => s[0])
    }
    for (const group of groups)for (const i of group.indices) {
      let coords = [],
        nx = da[i + 3] + da[i + 16] + da[i + 29],
        ny = da[i + 4] + da[i + 17] + da[i + 30],
        nz = da[i + 5] + da[i + 18] + da[i + 31],
        len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const mat = da[i + 8], rawKind = da[i + 12];
      const boneId = transform?.pose ? Math.floor((rawKind + .01) / 10) : 0;
      const kind = transform?.pose ? rawKind % 10 : rawKind;
      if (transform) {
        const tr = transform, n = [nx, ny, nz];
        nx = n[0] * tr.r[0] + n[1] * tr.u[0] + n[2] * tr.b[0];
        ny = n[0] * tr.r[1] + n[1] * tr.u[1] + n[2] * tr.b[1];
        nz = n[0] * tr.r[2] + n[1] * tr.u[2] + n[2] * tr.b[2];
      } else if (kind !== 4 && kind !== 5 && (eye[0] - da[i]) * nx + (eye[1] - da[i + 1]) * ny + (eye[2] - da[i + 2]) * nz < -.05)continue;
      for (let k = i; k < i + 39; k += 13) {
        let x = da[k], y = da[k + 1], z = da[k + 2];
        const oy = y, oz = z;
        const c = transform?.pose ? clamp(transform.pose.crouch || 0, 0, 1) : 0;
        if (gait && boneId >= 9 && boneId <= 14) {
          const s = boneId >= 12 ? 1 : -1;
          const leg = clamp((.90 - oy) / .45, 0, 1) * s, gs = gait * (1 - .52 * c);
          z += leg * gs * .26;
          y += Math.abs(leg) * Math.max(0, gs * s) * .09;
        }
        if (transform?.pose) {
          const p = transform.pose, upper = clamp((oy - .38) / 1.04, 0, 1);
          x += p.lean * upper;
          if (c > .001) {
            const s = (boneId >= 12 && boneId <= 14) || x >= 0 ? 1 : -1;
            const ankleZ = c * (s > 0 ? .18 : -.12);
            const kneeY = c * (s > 0 ? -.26 : -.14);
            const kneeZ = c * (s > 0 ? -.05 : -.25);
            const hipY = -.36 * c, hipZ = .08 * c;
            if (oy <= .16) {
              x += s * .036 * c;
              z += ankleZ
            } else if (oy <= .51) {
              const t = (oy - .16) / .35;
              x += s * .036 * c;
              y += kneeY * t;
              z += ankleZ + (kneeZ - ankleZ) * t
            } else if (oy <= .90) {
              const t = (oy - .51) / .39;
              x += s * .036 * c * (1 - t);
              y += kneeY + (hipY - kneeY) * t;
              z += kneeZ + (hipZ - kneeZ) * t
            } else {
              const ry = y - .90, rz = z - .01, ang = .14 * c, ca = Math.cos(ang), sa = Math.sin(ang);
              y = .90 + hipY + ry * ca + rz * sa;
              z = .01 + hipZ - ry * sa + rz * ca
            }
          }
          if (boneId === 15 || boneId === 6 || boneId === 8) {
            y += p.aimPose * .06;
            z += (p.recoil || 0) * .045;
          }
          if (p.hitRecoil > .01) {
            const flinch = Math.sin(p.hitRecoil * Math.PI) * p.hitRecoil * clamp((oy - .72) / .96, 0, 1);
            z += flinch * .20;
            y -= flinch * .06
          }
        }
        if (transform) {
          const t = transform, xx = x * t.r[0] + y * t.u[0] + z * t.b[0] + t.p[0], yy = x * t.r[1] + y * t.u[1] + z * t.b[1] + t.p[1];
          z = x * t.r[2] + y * t.u[2] + z * t.b[2] + t.p[2];
          x = xx;
          y = yy
        }
        const X = x - eye[0], Y = y - eye[1], Z = z - eye[2];
        coords.push([X * rx[0] + Y * rx[1] + Z * rx[2], X * up[0] + Y * up[1] + Z * up[2], X * fw[0] + Y * fw[1] + Z * fw[2], da[k + 6], da[k + 7], x, z])
      }
      if (coords.every(p => p[2] < near))continue;
      if (coords.every(p => p[0] > p[2] * this.tanX) || coords.every(p => p[0] < -p[2] * this.tanX) || coords.every(p => p[1] > p[2] * this.tanY) || coords.every(p => p[1] < -p[2] * this.tanY))continue;
      if (coords.some(p => p[2] < near)) {
        const clipped = [];
        for (let k = 0; k < 3; k++) {
          const a = coords[k], b = coords[(k + 1) % 3], inside = a[2] >= near;
          if (inside)clipped.push(a);
          if (inside !== (b[2] >= near)) {
            const t = (near - a[2]) / (b[2] - a[2]);
            clipped.push(a.map((v, j) => v + (b[j] - v) * t))
          }
        }
        coords = clipped
      }
      if (coords.length < 3)continue;
      const nl = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]),
        hemi = (ny + 1) * .5,
        depth = coords.reduce((s, p) => s + p[2], 0) / coords.length;
      const fog = view ? 0 : clamp(1 - Math.exp(-Math.pow(Math.max(0, depth) * .00265, 1.38)), 0, .94);
      let sr = (.25 + .41 * hemi + 1.63 * nl) ** .455, sg = (.27 + .52 * hemi + 1.30 * nl) ** .455, sb = (.25 + .62 * hemi + .88 * nl) ** .455;
      if (transform?.pose?.shieldFlash > .02) {
        const f = transform.pose.shieldFlash;
        sg += f * .75;
        sb += f * .95
      } else if (transform?.pose?.hitFlash > .02) {
        const f = transform.pose.hitFlash;
        sr += f * .85;
        sg += f * .45
      }
      if (kind === 3)sr = sg = sb = this.config?.graphics === 'extra' ? 1.65 : 1.39;
      if (kind === 5) {
        sr = (sr + 1.1) * .5;
        sg = (sg + 1.1) * .5;
        sb = (sb + 1.1) * .5
      }
      const shade = [sr * da[i + 9] * (1 - fog), sg * da[i + 10] * (1 - fog), sb * da[i + 11] * (1 - fog), fog],
        ps = coords.map(p => this.project(p));
      for (let k = 1; k < ps.length - 1; k++)this.triangle(ps[0], ps[k], ps[k + 1], mat, shade, kind === 2, kind === 4)
    }
  }
  render(cam, time, match, view = {}) {
    const extra = this.config?.graphics === 'extra';
    this.tanY = Math.tan(cam.fov * Math.PI / 360);
    this.tanX = this.tanY * this.aspect;
    this.fy = this.h * .5 / this.tanY;
    this.fx = this.w * .5 / this.tanX;
    const eye = cam.pos, dir = unit(sub(cam.target, eye)), right = unit(cross(dir, [0, 1, 0])), up = cross(right, dir);
    this.cam = {eye, dir, right, up};
    this.background(time);
    this.depth.fill(0);
    this.mesh(this.terrain);
    if (match) {
      for (const a of match.actors) {
        if (a.human || !a.alive)continue;
        const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
        this.mesh(this.actors[a.team + a.gun], {pose: a, p: [a.x, a.y, a.z], r: [cy, 0, sy], u: [0, 1, 0], b: [-sy, 0, cy]}, Math.sin(a.stride * 2.75) * Math.min(1, Math.hypot(a.vx, a.vz) / 4))
      }
    }
    this.mesh(chunk(movingDetails(match, time, extra)));
    if (match?.player.alive && view.firstPerson) {
      const a = match.player,
        m = view.motion || {},
        drop = a.reload ? Math.sin((1 - a.reload / weapons[a.gun].reload) * Math.PI) : 0;
      this.tanY = Math.tan(66 * Math.PI / 360);
      this.tanX = this.tanY * this.aspect;
      this.fy = this.h * .5 / this.tanY;
      this.fx = this.w * .5 / this.tanX;
      this.depth.fill(0);
      const p = add(eye, add(scale(right, .205 + (m.swayX || 0)), add(scale(up, -.205 - drop * .14 + (m.kickY || 0) + (m.swayY || 0)), scale(dir, .54 - (m.kickZ ?? (view.kick || 0) * .062)))));
      const tr = {p, r: right, u: up, b: scale(dir, -1)};
      this.mesh(this.devices[a.gun], tr, null, true);
      if (a.flash > .005) this.mesh(chunk(muzzleFlashMesh(a.gun, clamp(a.flash / .11, 0, 1), a.shotCount || 1, extra)), tr, null, true)
    }
    this.ctx.putImageData(this.img, 0, 0)
  }
}
