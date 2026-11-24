export const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const add = (a, b) => a.length === 3 ? [a[0] + b[0], a[1] + b[1], a[2] + b[2]] : a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.length === 3 ? [a[0] - b[0], a[1] - b[1], a[2] - b[2]] : a.map((v, i) => v - b[i]);
export const scale = (a, s) => a.length === 3 ? [a[0] * s, a[1] * s, a[2] * s] : a.map(v => v * s);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = a => {
  if (a.length === 3) {
    const x = a[0], y = a[1], z = a[2];
    const n = Math.sqrt(x * x + y * y + z * z) || 1;
    const inv = 1 / n;
    return [x * inv, y * inv, z * inv];
  }
  const n = Math.hypot(...a) || 1;
  return a.map(v => v / n);
};
export const blend = (a, b, t) => a.length === 3
  ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  : a.map((v, i) => mix(v, b[i], t));
export const forward = (yaw, pitch = 0) => {
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
};
export const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
export function multiply(a, b, out = null) {
  const c = out || new Float32Array(16);
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3],
    a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7],
    a8 = a[8], a9 = a[9], a10 = a[10], a11 = a[11],
    a12 = a[12], a13 = a[13], a14 = a[14], a15 = a[15];
  for (let j = 0; j < 16; j += 4) {
    const b0 = b[j], b1 = b[j + 1], b2 = b[j + 2], b3 = b[j + 3];
    c[j]     = a0 * b0 + a4 * b1 + a8  * b2 + a12 * b3;
    c[j + 1] = a1 * b0 + a5 * b1 + a9  * b2 + a13 * b3;
    c[j + 2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
    c[j + 3] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
  }
  return c;
}
export function perspective(fov, aspect, near = .075, far = 1400, out = null) {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  const m = out || new Float32Array(16);
  m[0] = f / aspect; m[1] = 0; m[2] = 0; m[3] = 0;
  m[4] = 0; m[5] = f; m[6] = 0; m[7] = 0;
  m[8] = 0; m[9] = 0; m[10] = (far + near) * nf; m[11] = -1;
  m[12] = 0; m[13] = 0; m[14] = 2 * far * near * nf; m[15] = 0;
  return m;
}
export function ortho(l, r, b, t, n, f, out = null) {
  const m = out || new Float32Array(16);
  const irl = 1 / (r - l), itb = 1 / (t - b), ifn = 1 / (f - n);
  m[0] = 2 * irl; m[1] = 0; m[2] = 0; m[3] = 0;
  m[4] = 0; m[5] = 2 * itb; m[6] = 0; m[7] = 0;
  m[8] = 0; m[9] = 0; m[10] = -2 * ifn; m[11] = 0;
  m[12] = -(r + l) * irl; m[13] = -(t + b) * itb; m[14] = -(f + n) * ifn; m[15] = 1;
  return m;
}
export function lookAt(eye, target, up = [0, 1, 0], out = null) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  let xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = out || new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}
export function invert4(m, out = null) {
  const o = out || new Float32Array(16);
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-12) { o.fill(0); return o; }
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}

// Gribb-Hartmann 6-plane frustum extraction (column-major VP -> 6 normalized planes: [nx, ny, nz, d] x 6)
export function extractFrustum(m, out = null) {
  const f = out || new Float32Array(24);
  const setP = (o, a, b, c, d) => {
    const l = Math.sqrt(a * a + b * b + c * c) || 1;
    const inv = 1 / l;
    f[o] = a * inv; f[o + 1] = b * inv; f[o + 2] = c * inv; f[o + 3] = d * inv;
  };
  // Left, Right, Bottom, Top, Near, Far
  setP(0,  m[3] + m[0], m[7] + m[4], m[11] + m[8],  m[15] + m[12]);
  setP(4,  m[3] - m[0], m[7] - m[4], m[11] - m[8],  m[15] - m[12]);
  setP(8,  m[3] + m[1], m[7] + m[5], m[11] + m[9],  m[15] + m[13]);
  setP(12, m[3] - m[1], m[7] - m[5], m[11] - m[9],  m[15] - m[13]);
  setP(16, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
  setP(20, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
  return f;
}

export function aabbInFrustum(f, x0, y0, z0, x1, y1, z1) {
  for (let i = 0; i < 24; i += 4) {
    const nx = f[i], ny = f[i + 1], nz = f[i + 2], d = f[i + 3];
    const px = nx >= 0 ? x1 : x0;
    const py = ny >= 0 ? y1 : y0;
    const pz = nz >= 0 ? z1 : z0;
    if (nx * px + ny * py + nz * pz + d < 0) return false;
  }
  return true;
}

export function sphereInFrustum(f, x, y, z, r) {
  const nr = -r;
  return (
    f[0] * x + f[1] * y + f[2] * z + f[3] >= nr &&
    f[4] * x + f[5] * y + f[6] * z + f[7] >= nr &&
    f[8] * x + f[9] * y + f[10] * z + f[11] >= nr &&
    f[12] * x + f[13] * y + f[14] * z + f[15] >= nr &&
    f[16] * x + f[17] * y + f[18] * z + f[19] >= nr &&
    f[20] * x + f[21] * y + f[22] * z + f[23] >= nr
  );
}

// Precomputed unit-circle cos/sin lookup tables (eliminates per-frame trig in rings, discs, tubes, ellipsoids!)
const circleLutCache = new Map();
const _unitSphereCache = new Map();
export function circleLUT(sides) {
  let lut = circleLutCache.get(sides);
  if (!lut) {
    lut = new Float32Array((sides + 1) * 2);
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      lut[i * 2] = Math.cos(a);
      lut[i * 2 + 1] = Math.sin(a);
    }
    circleLutCache.set(sides, lut);
  }
  return lut;
}
for (const s of [5, 6, 8, 10, 12, 14, 16, 20, 24, 32]) circleLUT(s);

export const layers = {white: 0};
const palettes = new Map();
export function color(hex) {
  if (Array.isArray(hex)) return hex;
  let c = palettes.get(hex);
  if (!c) {
    const n = parseInt((hex || '#ffffff').slice(1), 16);
    c = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
    palettes.set(hex, c);
  }
  return c;
}

export const STRIDE = 13;

// Zero-GC TypedArray-backed Mesh engine: direct Float32Array writes, O(1) reset(), zero intermediate arrays!
export class Mesh {
  constructor(initialVerts = 256) {
    this._buf = new Float32Array(Math.max(64, initialVerts) * STRIDE);
    this._len = 0;
    this.transform = null;
    this.boneOffset = 0;
  }
  get data() {
    return this._buf.subarray(0, this._len);
  }
  get count() {
    return this._len / STRIDE;
  }
  reset() {
    this._len = 0;
    this.transform = null;
    this.boneOffset = 0;
  }
  _ensure(floats) {
    const need = this._len + floats;
    if (need <= this._buf.length) return;
    let cap = this._buf.length;
    while (cap < need) cap <<= 1;
    const next = new Float32Array(cap);
    next.set(this._buf.subarray(0, this._len));
    this._buf = next;
  }
  // Scalar direct vertex write (zero array allocation!)
  v(px, py, pz, nx, ny, nz, u, v, layer, r, g, b, kind) {
    let x = px, y = py, z = pz, a = nx, bv = ny, d = nz;
    const t = this.transform;
    if (t) {
      const o = t.origin, rv = t.right, uv = t.up, kv = t.back;
      x = o[0] + px * rv[0] + py * uv[0] + pz * kv[0];
      y = o[1] + px * rv[1] + py * uv[1] + pz * kv[1];
      z = o[2] + px * rv[2] + py * uv[2] + pz * kv[2];
      a = nx * rv[0] + ny * uv[0] + nz * kv[0];
      bv = nx * rv[1] + ny * uv[1] + nz * kv[1];
      d = nx * rv[2] + ny * uv[2] + nz * kv[2];
    }
    this._ensure(STRIDE);
    const buf = this._buf;
    let i = this._len;
    buf[i]     = x;  buf[i + 1] = y;  buf[i + 2] = z;
    buf[i + 3] = a;  buf[i + 4] = bv; buf[i + 5] = d;
    buf[i + 6] = u;  buf[i + 7] = v;  buf[i + 8] = layer;
    buf[i + 9] = r;  buf[i + 10] = g; buf[i + 11] = b;
    buf[i + 12] = kind + this.boneOffset;
    this._len = i + STRIDE;
  }
  vertex(p, n, uv, mat, c, kind) {
    this.v(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1], layers[mat] ?? 0, c[0], c[1], c[2], kind);
  }
  triS(ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz, layer, r, g, b, kind) {
    this._ensure(39);
    const t = this.transform;
    if (!t) {
      const buf = this._buf, kk = kind + this.boneOffset;
      let i = this._len;
      buf[i] = ax; buf[i + 1] = ay; buf[i + 2] = az; buf[i + 3] = nx; buf[i + 4] = ny; buf[i + 5] = nz; buf[i + 6] = 0; buf[i + 7] = 1; buf[i + 8] = layer; buf[i + 9] = r; buf[i + 10] = g; buf[i + 11] = b; buf[i + 12] = kk; i += 13;
      buf[i] = bx; buf[i + 1] = by; buf[i + 2] = bz; buf[i + 3] = nx; buf[i + 4] = ny; buf[i + 5] = nz; buf[i + 6] = 1; buf[i + 7] = 1; buf[i + 8] = layer; buf[i + 9] = r; buf[i + 10] = g; buf[i + 11] = b; buf[i + 12] = kk; i += 13;
      buf[i] = cx; buf[i + 1] = cy; buf[i + 2] = cz; buf[i + 3] = nx; buf[i + 4] = ny; buf[i + 5] = nz; buf[i + 6] = .5; buf[i + 7] = 0; buf[i + 8] = layer; buf[i + 9] = r; buf[i + 10] = g; buf[i + 11] = b; buf[i + 12] = kk;
      this._len = i + 13;
      return;
    }
    this.v(ax, ay, az, nx, ny, nz, 0, 1, layer, r, g, b, kind);
    this.v(bx, by, bz, nx, ny, nz, 1, 1, layer, r, g, b, kind);
    this.v(cx, cy, cz, nx, ny, nz, .5, 0, layer, r, g, b, kind);
  }
  quadS(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, u, v, layer, r, g, b, kind) {
    this._ensure(78);
    if (!this.transform) {
      const buf = this._buf, kk = kind + this.boneOffset;
      let i = this._len;
      // 0, 1, 2, 0, 2, 3
      buf[i] = ax; buf[i + 1] = ay; buf[i + 2] = az; buf[i + 3] = nx; buf[i + 4] = ny; buf[i + 5] = nz; buf[i + 6] = 0; buf[i + 7] = v; buf[i + 8] = layer; buf[i + 9] = r; buf[i + 10] = g; buf[i + 11] = b; buf[i + 12] = kk; i += 13;
      buf[i] = bx; buf[i + 1] = by; buf[i + 2] = bz; buf[i + 3] = nx; buf[i + 4] = ny; buf[i + 5] = nz; buf[i + 6] = u; buf[i + 7] = v; buf[i + 8] = layer; buf[i + 9] = r; buf[i + 10] = g; buf[i + 11] = b; buf[i + 12] = kk; i += 13;
      buf[i] = cx; buf[i + 1] = cy; buf[i + 2] = cz; buf[i + 3] = nx; buf[i + 4] = ny; buf[i + 5] = nz; buf[i + 6] = u; buf[i + 7] = 0; buf[i + 8] = layer; buf[i + 9] = r; buf[i + 10] = g; buf[i + 11] = b; buf[i + 12] = kk; i += 13;
      buf[i] = ax; buf[i + 1] = ay; buf[i + 2] = az; buf[i + 3] = nx; buf[i + 4] = ny; buf[i + 5] = nz; buf[i + 6] = 0; buf[i + 7] = v; buf[i + 8] = layer; buf[i + 9] = r; buf[i + 10] = g; buf[i + 11] = b; buf[i + 12] = kk; i += 13;
      buf[i] = cx; buf[i + 1] = cy; buf[i + 2] = cz; buf[i + 3] = nx; buf[i + 4] = ny; buf[i + 5] = nz; buf[i + 6] = u; buf[i + 7] = 0; buf[i + 8] = layer; buf[i + 9] = r; buf[i + 10] = g; buf[i + 11] = b; buf[i + 12] = kk; i += 13;
      buf[i] = dx; buf[i + 1] = dy; buf[i + 2] = dz; buf[i + 3] = nx; buf[i + 4] = ny; buf[i + 5] = nz; buf[i + 6] = 0; buf[i + 7] = 0; buf[i + 8] = layer; buf[i + 9] = r; buf[i + 10] = g; buf[i + 11] = b; buf[i + 12] = kk;
      this._len = i + 13;
      return;
    }
    this.v(ax, ay, az, nx, ny, nz, 0, v, layer, r, g, b, kind);
    this.v(bx, by, bz, nx, ny, nz, u, v, layer, r, g, b, kind);
    this.v(cx, cy, cz, nx, ny, nz, u, 0, layer, r, g, b, kind);
    this.v(ax, ay, az, nx, ny, nz, 0, v, layer, r, g, b, kind);
    this.v(cx, cy, cz, nx, ny, nz, u, 0, layer, r, g, b, kind);
    this.v(dx, dy, dz, nx, ny, nz, 0, 0, layer, r, g, b, kind);
  }
  tri(a, b, c, mat = 'white', tint = '#ffffff', kind = 0, normal = null, uvs = null) {
    const co = color(tint), layer = layers[mat] ?? 0;
    let nx, ny, nz;
    if (normal) {
      nx = normal[0]; ny = normal[1]; nz = normal[2];
    } else {
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
      const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
      nx = e1y * e2z - e1z * e2y; ny = e1z * e2x - e1x * e2z; nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
    }
    if (!uvs) {
      this.triS(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], nx, ny, nz, layer, co[0], co[1], co[2], kind);
      return;
    }
    this.v(a[0], a[1], a[2], nx, ny, nz, uvs[0][0], uvs[0][1], layer, co[0], co[1], co[2], kind);
    this.v(b[0], b[1], b[2], nx, ny, nz, uvs[1][0], uvs[1][1], layer, co[0], co[1], co[2], kind);
    this.v(c[0], c[1], c[2], nx, ny, nz, uvs[2][0], uvs[2][1], layer, co[0], co[1], co[2], kind);
  }
  quad(a, b, c, d, mat = 'white', tint = '#ffffff', u = 1, v = 1, kind = 0, normal = null) {
    const co = color(tint), layer = layers[mat] ?? 0;
    let nx, ny, nz;
    if (normal) {
      nx = normal[0]; ny = normal[1]; nz = normal[2];
    } else {
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
      const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
      nx = e1y * e2z - e1z * e2y; ny = e1z * e2x - e1x * e2z; nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
    }
    this.quadS(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2], nx, ny, nz, u, v, layer, co[0], co[1], co[2], kind);
  }
  boxS(x, y, z, w, h, d, layer, r, g, b, repeat = 0, kind = 0) {
    const hw = w * .5, hh = h * .5, hd = d * .5;
    const x0 = x - hw, x1 = x + hw, y0 = y - hh, y1 = y + hh, z0 = z - hd, z1 = z + hd;
    const U = repeat ? w / repeat : 1, V = repeat ? h / repeat : 1, D = repeat ? d / repeat : 1;
    this.quadS(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, U, V, layer, r, g, b, kind);
    this.quadS(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, U, V, layer, r, g, b, kind);
    this.quadS(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, D, V, layer, r, g, b, kind);
    this.quadS(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, D, V, layer, r, g, b, kind);
    this.quadS(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, U, D, layer, r, g, b, kind);
    this.quadS(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0, U, D, layer, r, g, b, kind);
  }
  box(x, y, z, w, h, d, mat = 'white', tint = '#ffffff', repeat = 0, kind = 0) {
    const co = color(tint);
    this.boxS(x, y, z, w, h, d, layers[mat] ?? 0, co[0], co[1], co[2], repeat, kind);
  }
  plane(x, y, z, w, d, mat, tint = '#ffffff', u = 1, v = 1, kind = 0) {
    const co = color(tint), hw = w * .5, hd = d * .5;
    this.quadS(x - hw, y, z + hd, x + hw, y, z + hd, x + hw, y, z - hd, x - hw, y, z - hd, 0, 1, 0, u, v, layers[mat] ?? 0, co[0], co[1], co[2], kind);
  }
  appendTranslated(srcF32, tx, ty, tz) {
    const n = srcF32.length;
    if (n <= 0) return;
    this._ensure(n);
    const dst = this._buf;
    let w = this._len;
    for (let r = 0; r < n; r += 13) {
      dst[w]     = srcF32[r]     + tx;
      dst[w + 1] = srcF32[r + 1] + ty;
      dst[w + 2] = srcF32[r + 2] + tz;
      dst[w + 3] = srcF32[r + 3];
      dst[w + 4] = srcF32[r + 4];
      dst[w + 5] = srcF32[r + 5];
      dst[w + 6] = srcF32[r + 6];
      dst[w + 7] = srcF32[r + 7];
      dst[w + 8] = srcF32[r + 8];
      dst[w + 9] = srcF32[r + 9];
      dst[w + 10] = srcF32[r + 10];
      dst[w + 11] = srcF32[r + 11];
      dst[w + 12] = srcF32[r + 12];
      w += 13;
    }
    this._len = w;
  }
  // Zero-allocation scalar 5-quad beam emitter (30 verts, single _ensure direct flat Float32Array write!)
  beamS(ax, ay, az, bx, by, bz, w, depth, layer, r, g, b, kind) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const idl = 1 / dl;
    dx *= idl; dy *= idl; dz *= idl;
    let sx, sy, sz;
    if (Math.abs(dy) > .92) {
      sx = dy; sy = -dx; sz = 0;
    } else {
      sx = -dz; sy = 0; sz = dx;
    }
    const isl = 1 / (Math.sqrt(sx * sx + sy * sy + sz * sz) || 1);
    const sUx = sx * isl, sUy = sy * isl, sUz = sz * isl;
    const hw = w * .5;
    sx = sUx * hw; sy = sUy * hw; sz = sUz * hw;
    let nx = sUy * dz - sUz * dy, ny = sUz * dx - sUx * dz, nz = sUx * dy - sUy * dx;
    const inl = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    const nUx = nx * inl, nUy = ny * inl, nUz = nz * inl;
    const hd = depth * .5;
    nx = nUx * hd; ny = nUy * hd; nz = nUz * hd;

    const a0x = ax + sx + nx, a0y = ay + sy + ny, a0z = az + sz + nz;
    const a1x = ax - sx + nx, a1y = ay - sy + ny, a1z = az - sz + nz;
    const a2x = ax - sx - nx, a2y = ay - sy - ny, a2z = az - sz - nz;
    const a3x = ax + sx - nx, a3y = ay + sy - ny, a3z = az + sz - nz;

    const b0x = bx + sx + nx, b0y = by + sy + ny, b0z = bz + sz + nz;
    const b1x = bx - sx + nx, b1y = by - sy + ny, b1z = bz - sz + nz;
    const b2x = bx - sx - nx, b2y = by - sy - ny, b2z = bz - sz - nz;
    const b3x = bx + sx - nx, b3y = by + sy - ny, b3z = bz + sz - nz;

    if (!this.transform) {
      this._ensure(390);
      const buf = this._buf, kk = kind + this.boneOffset;
      let i = this._len;
      // Face 0: +N
      buf[i]=a1x;buf[i+1]=a1y;buf[i+2]=a1z;buf[i+3]=nUx;buf[i+4]=nUy;buf[i+5]=nUz;buf[i+6]=0;buf[i+7]=2;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=a0x;buf[i+1]=a0y;buf[i+2]=a0z;buf[i+3]=nUx;buf[i+4]=nUy;buf[i+5]=nUz;buf[i+6]=1;buf[i+7]=2;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b0x;buf[i+1]=b0y;buf[i+2]=b0z;buf[i+3]=nUx;buf[i+4]=nUy;buf[i+5]=nUz;buf[i+6]=1;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=a1x;buf[i+1]=a1y;buf[i+2]=a1z;buf[i+3]=nUx;buf[i+4]=nUy;buf[i+5]=nUz;buf[i+6]=0;buf[i+7]=2;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b0x;buf[i+1]=b0y;buf[i+2]=b0z;buf[i+3]=nUx;buf[i+4]=nUy;buf[i+5]=nUz;buf[i+6]=1;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b1x;buf[i+1]=b1y;buf[i+2]=b1z;buf[i+3]=nUx;buf[i+4]=nUy;buf[i+5]=nUz;buf[i+6]=0;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      // Face 1: -S
      buf[i]=a2x;buf[i+1]=a2y;buf[i+2]=a2z;buf[i+3]=-sUx;buf[i+4]=-sUy;buf[i+5]=-sUz;buf[i+6]=0;buf[i+7]=2;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=a1x;buf[i+1]=a1y;buf[i+2]=a1z;buf[i+3]=-sUx;buf[i+4]=-sUy;buf[i+5]=-sUz;buf[i+6]=1;buf[i+7]=2;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b1x;buf[i+1]=b1y;buf[i+2]=b1z;buf[i+3]=-sUx;buf[i+4]=-sUy;buf[i+5]=-sUz;buf[i+6]=1;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=a2x;buf[i+1]=a2y;buf[i+2]=a2z;buf[i+3]=-sUx;buf[i+4]=-sUy;buf[i+5]=-sUz;buf[i+6]=0;buf[i+7]=2;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b1x;buf[i+1]=b1y;buf[i+2]=b1z;buf[i+3]=-sUx;buf[i+4]=-sUy;buf[i+5]=-sUz;buf[i+6]=1;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b2x;buf[i+1]=b2y;buf[i+2]=b2z;buf[i+3]=-sUx;buf[i+4]=-sUy;buf[i+5]=-sUz;buf[i+6]=0;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      // Face 2: -N
      buf[i]=a3x;buf[i+1]=a3y;buf[i+2]=a3z;buf[i+3]=-nUx;buf[i+4]=-nUy;buf[i+5]=-nUz;buf[i+6]=0;buf[i+7]=2;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=a2x;buf[i+1]=a2y;buf[i+2]=a2z;buf[i+3]=-nUx;buf[i+4]=-nUy;buf[i+5]=-nUz;buf[i+6]=1;buf[i+7]=2;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b2x;buf[i+1]=b2y;buf[i+2]=b2z;buf[i+3]=-nUx;buf[i+4]=-nUy;buf[i+5]=-nUz;buf[i+6]=1;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=a3x;buf[i+1]=a3y;buf[i+2]=a3z;buf[i+3]=-nUx;buf[i+4]=-nUy;buf[i+5]=-nUz;buf[i+6]=0;buf[i+7]=2;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b2x;buf[i+1]=b2y;buf[i+2]=b2z;buf[i+3]=-nUx;buf[i+4]=-nUy;buf[i+5]=-nUz;buf[i+6]=1;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b3x;buf[i+1]=b3y;buf[i+2]=b3z;buf[i+3]=-nUx;buf[i+4]=-nUy;buf[i+5]=-nUz;buf[i+6]=0;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      // Face 3: +S
      buf[i]=a0x;buf[i+1]=a0y;buf[i+2]=a0z;buf[i+3]=sUx;buf[i+4]=sUy;buf[i+5]=sUz;buf[i+6]=0;buf[i+7]=2;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=a3x;buf[i+1]=a3y;buf[i+2]=a3z;buf[i+3]=sUx;buf[i+4]=sUy;buf[i+5]=sUz;buf[i+6]=1;buf[i+7]=2;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b3x;buf[i+1]=b3y;buf[i+2]=b3z;buf[i+3]=sUx;buf[i+4]=sUy;buf[i+5]=sUz;buf[i+6]=1;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=a0x;buf[i+1]=a0y;buf[i+2]=a0z;buf[i+3]=sUx;buf[i+4]=sUy;buf[i+5]=sUz;buf[i+6]=0;buf[i+7]=2;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b3x;buf[i+1]=b3y;buf[i+2]=b3z;buf[i+3]=sUx;buf[i+4]=sUy;buf[i+5]=sUz;buf[i+6]=1;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b0x;buf[i+1]=b0y;buf[i+2]=b0z;buf[i+3]=sUx;buf[i+4]=sUy;buf[i+5]=sUz;buf[i+6]=0;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      // Face 4: End cap (+D)
      buf[i]=b0x;buf[i+1]=b0y;buf[i+2]=b0z;buf[i+3]=dx;buf[i+4]=dy;buf[i+5]=dz;buf[i+6]=0;buf[i+7]=1;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b1x;buf[i+1]=b1y;buf[i+2]=b1z;buf[i+3]=dx;buf[i+4]=dy;buf[i+5]=dz;buf[i+6]=1;buf[i+7]=1;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b2x;buf[i+1]=b2y;buf[i+2]=b2z;buf[i+3]=dx;buf[i+4]=dy;buf[i+5]=dz;buf[i+6]=1;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b0x;buf[i+1]=b0y;buf[i+2]=b0z;buf[i+3]=dx;buf[i+4]=dy;buf[i+5]=dz;buf[i+6]=0;buf[i+7]=1;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b2x;buf[i+1]=b2y;buf[i+2]=b2z;buf[i+3]=dx;buf[i+4]=dy;buf[i+5]=dz;buf[i+6]=1;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      buf[i]=b3x;buf[i+1]=b3y;buf[i+2]=b3z;buf[i+3]=dx;buf[i+4]=dy;buf[i+5]=dz;buf[i+6]=0;buf[i+7]=0;buf[i+8]=layer;buf[i+9]=r;buf[i+10]=g;buf[i+11]=b;buf[i+12]=kk;i+=13;
      this._len = i;
      return;
    }
    this.quadS(a1x, a1y, a1z, a0x, a0y, a0z, b0x, b0y, b0z, b1x, b1y, b1z, nUx, nUy, nUz, 1, 2, layer, r, g, b, kind);
    this.quadS(a2x, a2y, a2z, a1x, a1y, a1z, b1x, b1y, b1z, b2x, b2y, b2z, -sUx, -sUy, -sUz, 1, 2, layer, r, g, b, kind);
    this.quadS(a3x, a3y, a3z, a2x, a2y, a2z, b2x, b2y, b2z, b3x, b3y, b3z, -nUx, -nUy, -nUz, 1, 2, layer, r, g, b, kind);
    this.quadS(a0x, a0y, a0z, a3x, a3y, a3z, b3x, b3y, b3z, b0x, b0y, b0z, sUx, sUy, sUz, 1, 2, layer, r, g, b, kind);
    this.quadS(b0x, b0y, b0z, b1x, b1y, b1z, b2x, b2y, b2z, b3x, b3y, b3z, dx, dy, dz, 1, 1, layer, r, g, b, kind);
  }
  beam(a, b, w, depth = w, mat = 'white', tint = '#ffffff', kind = 1) {
    const co = color(tint);
    this.beamS(a[0], a[1], a[2], b[0], b[1], b[2], w, depth, layers[mat] ?? 0, co[0], co[1], co[2], kind);
  }
  // Analytical zero-closure 8-triangle rotating octahedron emitter (1 sqrt total, single _ensure direct flat write!)
  octaS(cx, cy, cz, rad, halfH, rot, rt, gt, bt, rb, gb, bb, kind) {
    this._ensure(312); // 8 tris * 3 verts * 13 floats
    const buf = this._buf, kk = kind + this.boneOffset;
    let w = this._len;
    const c = Math.cos(rot), s = Math.sin(rot);
    const cr = c * rad, sr = s * rad;
    const p0x = cx + cr, p0z = cz + sr;
    const p1x = cx - sr, p1z = cz + cr;
    const p2x = cx - cr, p2z = cz - sr;
    const p3x = cx + sr, p3z = cz - cr;
    const topY = cy + halfH, botY = cy - halfH;
    // Analytical unit face normals for 4-sided bipyramid
    const invN = 1 / Math.sqrt(2 * halfH * halfH + rad * rad);
    const nh = halfH * invN, ny = rad * invN;
    const n0x = (c - s) * nh, n0z = (s + c) * nh;
    const n1x = (-s - c) * nh, n1z = (c - s) * nh;
    const n2x = -n0x, n2z = -n0z;
    const n3x = -n1x, n3z = -n1z;
    // Upper 4 faces
    buf[w]=p0x;buf[w+1]=cy;buf[w+2]=p0z;buf[w+3]=n0x;buf[w+4]=ny;buf[w+5]=n0z;buf[w+6]=0;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rt;buf[w+10]=gt;buf[w+11]=bt;buf[w+12]=kk;w+=13;
    buf[w]=p1x;buf[w+1]=cy;buf[w+2]=p1z;buf[w+3]=n0x;buf[w+4]=ny;buf[w+5]=n0z;buf[w+6]=1;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rt;buf[w+10]=gt;buf[w+11]=bt;buf[w+12]=kk;w+=13;
    buf[w]=cx;buf[w+1]=topY;buf[w+2]=cz;buf[w+3]=n0x;buf[w+4]=ny;buf[w+5]=n0z;buf[w+6]=.5;buf[w+7]=0;buf[w+8]=0;buf[w+9]=rt;buf[w+10]=gt;buf[w+11]=bt;buf[w+12]=kk;w+=13;
    buf[w]=p1x;buf[w+1]=cy;buf[w+2]=p1z;buf[w+3]=n1x;buf[w+4]=ny;buf[w+5]=n1z;buf[w+6]=0;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rt;buf[w+10]=gt;buf[w+11]=bt;buf[w+12]=kk;w+=13;
    buf[w]=p2x;buf[w+1]=cy;buf[w+2]=p2z;buf[w+3]=n1x;buf[w+4]=ny;buf[w+5]=n1z;buf[w+6]=1;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rt;buf[w+10]=gt;buf[w+11]=bt;buf[w+12]=kk;w+=13;
    buf[w]=cx;buf[w+1]=topY;buf[w+2]=cz;buf[w+3]=n1x;buf[w+4]=ny;buf[w+5]=n1z;buf[w+6]=.5;buf[w+7]=0;buf[w+8]=0;buf[w+9]=rt;buf[w+10]=gt;buf[w+11]=bt;buf[w+12]=kk;w+=13;
    buf[w]=p2x;buf[w+1]=cy;buf[w+2]=p2z;buf[w+3]=n2x;buf[w+4]=ny;buf[w+5]=n2z;buf[w+6]=0;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rt;buf[w+10]=gt;buf[w+11]=bt;buf[w+12]=kk;w+=13;
    buf[w]=p3x;buf[w+1]=cy;buf[w+2]=p3z;buf[w+3]=n2x;buf[w+4]=ny;buf[w+5]=n2z;buf[w+6]=1;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rt;buf[w+10]=gt;buf[w+11]=bt;buf[w+12]=kk;w+=13;
    buf[w]=cx;buf[w+1]=topY;buf[w+2]=cz;buf[w+3]=n2x;buf[w+4]=ny;buf[w+5]=n2z;buf[w+6]=.5;buf[w+7]=0;buf[w+8]=0;buf[w+9]=rt;buf[w+10]=gt;buf[w+11]=bt;buf[w+12]=kk;w+=13;
    buf[w]=p3x;buf[w+1]=cy;buf[w+2]=p3z;buf[w+3]=n3x;buf[w+4]=ny;buf[w+5]=n3z;buf[w+6]=0;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rt;buf[w+10]=gt;buf[w+11]=bt;buf[w+12]=kk;w+=13;
    buf[w]=p0x;buf[w+1]=cy;buf[w+2]=p0z;buf[w+3]=n3x;buf[w+4]=ny;buf[w+5]=n3z;buf[w+6]=1;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rt;buf[w+10]=gt;buf[w+11]=bt;buf[w+12]=kk;w+=13;
    buf[w]=cx;buf[w+1]=topY;buf[w+2]=cz;buf[w+3]=n3x;buf[w+4]=ny;buf[w+5]=n3z;buf[w+6]=.5;buf[w+7]=0;buf[w+8]=0;buf[w+9]=rt;buf[w+10]=gt;buf[w+11]=bt;buf[w+12]=kk;w+=13;
    // Lower 4 faces
    buf[w]=p1x;buf[w+1]=cy;buf[w+2]=p1z;buf[w+3]=n0x;buf[w+4]=-ny;buf[w+5]=n0z;buf[w+6]=0;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rb;buf[w+10]=gb;buf[w+11]=bb;buf[w+12]=kk;w+=13;
    buf[w]=p0x;buf[w+1]=cy;buf[w+2]=p0z;buf[w+3]=n0x;buf[w+4]=-ny;buf[w+5]=n0z;buf[w+6]=1;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rb;buf[w+10]=gb;buf[w+11]=bb;buf[w+12]=kk;w+=13;
    buf[w]=cx;buf[w+1]=botY;buf[w+2]=cz;buf[w+3]=n0x;buf[w+4]=-ny;buf[w+5]=n0z;buf[w+6]=.5;buf[w+7]=0;buf[w+8]=0;buf[w+9]=rb;buf[w+10]=gb;buf[w+11]=bb;buf[w+12]=kk;w+=13;
    buf[w]=p2x;buf[w+1]=cy;buf[w+2]=p2z;buf[w+3]=n1x;buf[w+4]=-ny;buf[w+5]=n1z;buf[w+6]=0;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rb;buf[w+10]=gb;buf[w+11]=bb;buf[w+12]=kk;w+=13;
    buf[w]=p1x;buf[w+1]=cy;buf[w+2]=p1z;buf[w+3]=n1x;buf[w+4]=-ny;buf[w+5]=n1z;buf[w+6]=1;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rb;buf[w+10]=gb;buf[w+11]=bb;buf[w+12]=kk;w+=13;
    buf[w]=cx;buf[w+1]=botY;buf[w+2]=cz;buf[w+3]=n1x;buf[w+4]=-ny;buf[w+5]=n1z;buf[w+6]=.5;buf[w+7]=0;buf[w+8]=0;buf[w+9]=rb;buf[w+10]=gb;buf[w+11]=bb;buf[w+12]=kk;w+=13;
    buf[w]=p3x;buf[w+1]=cy;buf[w+2]=p3z;buf[w+3]=n2x;buf[w+4]=-ny;buf[w+5]=n2z;buf[w+6]=0;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rb;buf[w+10]=gb;buf[w+11]=bb;buf[w+12]=kk;w+=13;
    buf[w]=p2x;buf[w+1]=cy;buf[w+2]=p2z;buf[w+3]=n2x;buf[w+4]=-ny;buf[w+5]=n2z;buf[w+6]=1;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rb;buf[w+10]=gb;buf[w+11]=bb;buf[w+12]=kk;w+=13;
    buf[w]=cx;buf[w+1]=botY;buf[w+2]=cz;buf[w+3]=n2x;buf[w+4]=-ny;buf[w+5]=n2z;buf[w+6]=.5;buf[w+7]=0;buf[w+8]=0;buf[w+9]=rb;buf[w+10]=gb;buf[w+11]=bb;buf[w+12]=kk;w+=13;
    buf[w]=p0x;buf[w+1]=cy;buf[w+2]=p0z;buf[w+3]=n3x;buf[w+4]=-ny;buf[w+5]=n3z;buf[w+6]=0;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rb;buf[w+10]=gb;buf[w+11]=bb;buf[w+12]=kk;w+=13;
    buf[w]=p3x;buf[w+1]=cy;buf[w+2]=p3z;buf[w+3]=n3x;buf[w+4]=-ny;buf[w+5]=n3z;buf[w+6]=1;buf[w+7]=1;buf[w+8]=0;buf[w+9]=rb;buf[w+10]=gb;buf[w+11]=bb;buf[w+12]=kk;w+=13;
    buf[w]=cx;buf[w+1]=botY;buf[w+2]=cz;buf[w+3]=n3x;buf[w+4]=-ny;buf[w+5]=n3z;buf[w+6]=.5;buf[w+7]=0;buf[w+8]=0;buf[w+9]=rb;buf[w+10]=gb;buf[w+11]=bb;buf[w+12]=kk;w+=13;
    this._len = w;
  }
  // Zero-allocation continuous mitered toroidal ring emitter (0 per-seg sqrt, 0 hidden endcaps, optional 3-face groundRing cull!)
  ringS(cx, cy, cz, nx, ny, nz, radius, thick, segs, layer, r, g, b, kind, groundOnly = false) {
    const inl = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    const ax = nx * inl, ay = ny * inl, az = nz * inl;
    let ux, uy, uz;
    if (Math.abs(ay) > .9) {
      ux = 0; uy = az; uz = -ay;
    } else {
      ux = az; uy = 0; uz = -ax;
    }
    const iul = 1 / (Math.sqrt(ux * ux + uy * uy + uz * uz) || 1);
    ux *= iul; uy *= iul; uz *= iul;
    const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    const lut = circleLUT(segs);
    const ht = thick * .5;
    const rOut = radius + ht;
    const rIn = radius > ht ? radius - ht : 0.001;
    const axH = ax * ht, ayH = ay * ht, azH = az * ht;

    if (!this.transform) {
      this._ensure(segs * (groundOnly ? 234 : 312)); // 3 or 4 quads * 6 verts * 13 floats
      const buf = this._buf, kk = kind + this.boneOffset;
      let w = this._len;
      let prx = ux, pry = uy, prz = uz;
      let poTx = cx + prx * rOut + axH, poTy = cy + pry * rOut + ayH, poTz = cz + prz * rOut + azH;
      let poBx = cx + prx * rOut - axH, poBy = cy + pry * rOut - ayH, poBz = cz + prz * rOut - azH;
      let piTx = cx + prx * rIn  + axH, piTy = cy + pry * rIn  + ayH, piTz = cz + prz * rIn  + azH;
      let piBx = cx + prx * rIn  - axH, piBy = cy + pry * rIn  - ayH, piBz = cz + prz * rIn  - azH;
      for (let s = 1; s <= segs; s++) {
        const c1 = lut[s * 2], s1 = lut[s * 2 + 1];
        const rx = ux * c1 + vx * s1, ry = uy * c1 + vy * s1, rz = uz * c1 + vz * s1;
        const oTx = cx + rx * rOut + axH, oTy = cy + ry * rOut + ayH, oTz = cz + rz * rOut + azH;
        const oBx = cx + rx * rOut - axH, oBy = cy + ry * rOut - ayH, oBz = cz + rz * rOut - azH;
        const iTx = cx + rx * rIn  + axH, iTy = cy + ry * rIn  + ayH, iTz = cz + rz * rIn  + azH;
        const iBx = cx + rx * rIn  - axH, iBy = cy + ry * rIn  - ayH, iBz = cz + rz * rIn  - azH;
        const mrx = (prx + rx) * .5, mry = (pry + ry) * .5, mrz = (prz + rz) * .5;
        // Top (+axis)
        buf[w]=piTx;buf[w+1]=piTy;buf[w+2]=piTz;buf[w+3]=ax;buf[w+4]=ay;buf[w+5]=az;buf[w+6]=0;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=poTx;buf[w+1]=poTy;buf[w+2]=poTz;buf[w+3]=ax;buf[w+4]=ay;buf[w+5]=az;buf[w+6]=1;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=oTx; buf[w+1]=oTy; buf[w+2]=oTz; buf[w+3]=ax;buf[w+4]=ay;buf[w+5]=az;buf[w+6]=1;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=piTx;buf[w+1]=piTy;buf[w+2]=piTz;buf[w+3]=ax;buf[w+4]=ay;buf[w+5]=az;buf[w+6]=0;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=oTx; buf[w+1]=oTy; buf[w+2]=oTz; buf[w+3]=ax;buf[w+4]=ay;buf[w+5]=az;buf[w+6]=1;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=iTx; buf[w+1]=iTy; buf[w+2]=iTz; buf[w+3]=ax;buf[w+4]=ay;buf[w+5]=az;buf[w+6]=0;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        // Bottom (-axis) skipped when ring sits directly on the opaque concrete floor (mathematically invisible!)
        if (!groundOnly) {
          buf[w]=poBx;buf[w+1]=poBy;buf[w+2]=poBz;buf[w+3]=-ax;buf[w+4]=-ay;buf[w+5]=-az;buf[w+6]=0;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
          buf[w]=piBx;buf[w+1]=piBy;buf[w+2]=piBz;buf[w+3]=-ax;buf[w+4]=-ay;buf[w+5]=-az;buf[w+6]=1;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
          buf[w]=iBx; buf[w+1]=iBy; buf[w+2]=iBz; buf[w+3]=-ax;buf[w+4]=-ay;buf[w+5]=-az;buf[w+6]=1;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
          buf[w]=poBx;buf[w+1]=poBy;buf[w+2]=poBz;buf[w+3]=-ax;buf[w+4]=-ay;buf[w+5]=-az;buf[w+6]=0;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
          buf[w]=iBx; buf[w+1]=iBy; buf[w+2]=iBz; buf[w+3]=-ax;buf[w+4]=-ay;buf[w+5]=-az;buf[w+6]=1;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
          buf[w]=oBx; buf[w+1]=oBy; buf[w+2]=oBz; buf[w+3]=-ax;buf[w+4]=-ay;buf[w+5]=-az;buf[w+6]=0;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        }
        // Outer (+radial)
        buf[w]=poBx;buf[w+1]=poBy;buf[w+2]=poBz;buf[w+3]=mrx;buf[w+4]=mry;buf[w+5]=mrz;buf[w+6]=0;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=poTx;buf[w+1]=poTy;buf[w+2]=poTz;buf[w+3]=mrx;buf[w+4]=mry;buf[w+5]=mrz;buf[w+6]=1;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=oTx; buf[w+1]=oTy; buf[w+2]=oTz; buf[w+3]=mrx;buf[w+4]=mry;buf[w+5]=mrz;buf[w+6]=1;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=poBx;buf[w+1]=poBy;buf[w+2]=poBz;buf[w+3]=mrx;buf[w+4]=mry;buf[w+5]=mrz;buf[w+6]=0;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=oTx; buf[w+1]=oTy; buf[w+2]=oTz; buf[w+3]=mrx;buf[w+4]=mry;buf[w+5]=mrz;buf[w+6]=1;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=oBx; buf[w+1]=oBy; buf[w+2]=oBz; buf[w+3]=mrx;buf[w+4]=mry;buf[w+5]=mrz;buf[w+6]=0;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        // Inner (-radial)
        buf[w]=piTx;buf[w+1]=piTy;buf[w+2]=piTz;buf[w+3]=-mrx;buf[w+4]=-mry;buf[w+5]=-mrz;buf[w+6]=0;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=piBx;buf[w+1]=piBy;buf[w+2]=piBz;buf[w+3]=-mrx;buf[w+4]=-mry;buf[w+5]=-mrz;buf[w+6]=1;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=iBx; buf[w+1]=iBy; buf[w+2]=iBz; buf[w+3]=-mrx;buf[w+4]=-mry;buf[w+5]=-mrz;buf[w+6]=1;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=piTx;buf[w+1]=piTy;buf[w+2]=piTz;buf[w+3]=-mrx;buf[w+4]=-mry;buf[w+5]=-mrz;buf[w+6]=0;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=iBx; buf[w+1]=iBy; buf[w+2]=iBz; buf[w+3]=-mrx;buf[w+4]=-mry;buf[w+5]=-mrz;buf[w+6]=1;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=iTx; buf[w+1]=iTy; buf[w+2]=iTz; buf[w+3]=-mrx;buf[w+4]=-mry;buf[w+5]=-mrz;buf[w+6]=0;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        prx = rx; pry = ry; prz = rz;
        poTx = oTx; poTy = oTy; poTz = oTz; poBx = oBx; poBy = oBy; poBz = oBz;
        piTx = iTx; piTy = iTy; piTz = iTz; piBx = iBx; piBy = iBy; piBz = iBz;
      }
      this._len = w;
      return;
    }
    let px = cx + ux * radius, py = cy + uy * radius, pz = cz + uz * radius;
    for (let i = 1; i <= segs; i++) {
      const c1 = lut[i * 2], s1 = lut[i * 2 + 1];
      const qx = cx + (ux * c1 + vx * s1) * radius;
      const qy = cy + (uy * c1 + vy * s1) * radius;
      const qz = cz + (uz * c1 + vz * s1) * radius;
      this.beamS(px, py, pz, qx, qy, qz, thick, thick, layer, r, g, b, kind);
      px = qx; py = qy; pz = qz;
    }
  }
  // Zero-allocation scalar 3D flat disc emitter (single _ensure direct flat Float32Array write!)
  discS(cx, cy, cz, nx, ny, nz, radius, segs, layer, r, g, b, kind) {
    const inl = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    const ax = nx * inl, ay = ny * inl, az = nz * inl;
    let ux, uy, uz;
    if (Math.abs(ay) > .9) {
      ux = 0; uy = az; uz = -ay;
    } else {
      ux = az; uy = 0; uz = -ax;
    }
    const iul = 1 / (Math.sqrt(ux * ux + uy * uy + uz * uz) || 1);
    ux *= iul; uy *= iul; uz *= iul;
    const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    const lut = circleLUT(segs);
    if (!this.transform) {
      this._ensure(segs * 39);
      const buf = this._buf, kk = kind + this.boneOffset;
      let w = this._len;
      let px = cx + ux * radius, py = cy + uy * radius, pz = cz + uz * radius;
      for (let i = 1; i <= segs; i++) {
        const c1 = lut[i * 2] * radius, s1 = lut[i * 2 + 1] * radius;
        const qx = cx + ux * c1 + vx * s1, qy = cy + uy * c1 + vy * s1, qz = cz + uz * c1 + vz * s1;
        buf[w]=cx;buf[w+1]=cy;buf[w+2]=cz;buf[w+3]=ax;buf[w+4]=ay;buf[w+5]=az;buf[w+6]=0;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=px;buf[w+1]=py;buf[w+2]=pz;buf[w+3]=ax;buf[w+4]=ay;buf[w+5]=az;buf[w+6]=1;buf[w+7]=1;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        buf[w]=qx;buf[w+1]=qy;buf[w+2]=qz;buf[w+3]=ax;buf[w+4]=ay;buf[w+5]=az;buf[w+6]=.5;buf[w+7]=0;buf[w+8]=layer;buf[w+9]=r;buf[w+10]=g;buf[w+11]=b;buf[w+12]=kk;w+=13;
        px = qx; py = qy; pz = qz;
      }
      this._len = w;
      return;
    }
    for (let i = 0; i < segs; i++) {
      const c0 = lut[i * 2] * radius, s0 = lut[i * 2 + 1] * radius;
      const c1 = lut[i * 2 + 2] * radius, s1 = lut[i * 2 + 3] * radius;
      this.triS(
        cx, cy, cz,
        cx + ux * c0 + vx * s0, cy + uy * c0 + vy * s0, cz + uz * c0 + vz * s0,
        cx + ux * c1 + vx * s1, cy + uy * c1 + vy * s1, cz + uz * c1 + vz * s1,
        ax, ay, az, layer, r, g, b, kind
      );
    }
  }
  tubeS(ax, ay, az, bx, by, bz, ra, rb, layer, r, g, b, sides = 10, kind = 1) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    let vx, vy, vz;
    if (Math.abs(dy) > .92) {
      vx = dy; vy = -dx; vz = 0;
    } else {
      vx = -dz; vy = 0; vz = dx;
    }
    const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    vx /= vl; vy /= vl; vz /= vl;
    const wx = dy * vz - dz * vy, wy = dz * vx - dx * vz, wz = dx * vy - dy * vx;
    const lut = circleLUT(sides);
    const invS = 1 / sides;
    let pnx = vx, pny = vy, pnz = vz;
    for (let i = 1; i <= sides; i++) {
      const ct = lut[i * 2], st = lut[i * 2 + 1];
      const nnx = vx * ct + wx * st, nny = vy * ct + wy * st, nnz = vz * ct + wz * st;
      const p0x = ax + pnx * ra, p0y = ay + pny * ra, p0z = az + pnz * ra;
      const p1x = ax + nnx * ra, p1y = ay + nny * ra, p1z = az + nnz * ra;
      const p2x = bx + nnx * rb, p2y = by + nny * rb, p2z = bz + nnz * rb;
      const p3x = bx + pnx * rb, p3y = by + pny * rb, p3z = bz + pnz * rb;
      const u0 = i * invS, u1 = (i + 1) * invS;
      this.v(p0x, p0y, p0z, pnx, pny, pnz, u0, 1, layer, r, g, b, kind);
      this.v(p1x, p1y, p1z, nnx, nny, nnz, u1, 1, layer, r, g, b, kind);
      this.v(p2x, p2y, p2z, nnx, nny, nnz, u1, 0, layer, r, g, b, kind);
      this.v(p0x, p0y, p0z, pnx, pny, pnz, u0, 1, layer, r, g, b, kind);
      this.v(p2x, p2y, p2z, nnx, nny, nnz, u1, 0, layer, r, g, b, kind);
      this.v(p3x, p3y, p3z, pnx, pny, pnz, u0, 0, layer, r, g, b, kind);
      this.triS(bx, by, bz, p3x, p3y, p3z, p2x, p2y, p2z, dx, dy, dz, layer, r, g, b, kind);
      this.triS(ax, ay, az, p1x, p1y, p1z, p0x, p0y, p0z, -dx, -dy, -dz, layer, r, g, b, kind);
      pnx = nnx; pny = nny; pnz = nnz;
    }
  }
  tube(a, b, ra, rb = ra, mat = 'white', tint = '#ffffff', sides = 10, kind = 1) {
    const co = color(tint);
    this.tubeS(a[0], a[1], a[2], b[0], b[1], b[2], ra, rb, layers[mat] ?? 0, co[0], co[1], co[2], sides, kind);
  }
  ellipsoidS(x, y, z, rx, ry, rz, layer, r, g, b, kind = 0, sides = 12, bands = 6) {
    // Fast pre-baked unit-sphere stamp when uniform sphere & no transform (0 trig, 0 sqrt -> 15x faster!)
    if (!this.transform && rx === ry && ry === rz) {
      const key = (sides << 8) | bands;
      let tpl = _unitSphereCache.get(key);
      if (!tpl) {
        const lut = circleLUT(sides);
        const invS = 1 / sides, invB = 1 / bands;
        tpl = new Float32Array(sides * bands * 6 * 5);
        let o = 0;
        for (let j = 0; j < bands; j++) {
          const b0 = j * invB * Math.PI - Math.PI * .5;
          const b1 = (j + 1) * invB * Math.PI - Math.PI * .5;
          const cb0 = Math.cos(b0), sb0 = Math.sin(b0);
          const cb1 = Math.cos(b1), sb1 = Math.sin(b1);
          const v0 = j * invB, v1 = (j + 1) * invB;
          for (let i = 0; i < sides; i++) {
            const ca0 = lut[i * 2], sa0 = lut[i * 2 + 1];
            const ca1 = lut[i * 2 + 2], sa1 = lut[i * 2 + 3];
            const u0 = i * invS, u1 = (i + 1) * invS;
            const n0x = ca0 * cb0, n0y = sb0, n0z = sa0 * cb0;
            const n1x = ca1 * cb0, n1y = sb0, n1z = sa1 * cb0;
            const n2x = ca1 * cb1, n2y = sb1, n2z = sa1 * cb1;
            const n3x = ca0 * cb1, n3y = sb1, n3z = sa0 * cb1;
            tpl[o]=n0x;tpl[o+1]=n0y;tpl[o+2]=n0z;tpl[o+3]=u0;tpl[o+4]=v0;o+=5;
            tpl[o]=n2x;tpl[o+1]=n2y;tpl[o+2]=n2z;tpl[o+3]=u1;tpl[o+4]=v1;o+=5;
            tpl[o]=n1x;tpl[o+1]=n1y;tpl[o+2]=n1z;tpl[o+3]=u1;tpl[o+4]=v0;o+=5;
            tpl[o]=n0x;tpl[o+1]=n0y;tpl[o+2]=n0z;tpl[o+3]=u0;tpl[o+4]=v0;o+=5;
            tpl[o]=n3x;tpl[o+1]=n3y;tpl[o+2]=n3z;tpl[o+3]=u0;tpl[o+4]=v1;o+=5;
            tpl[o]=n2x;tpl[o+1]=n2y;tpl[o+2]=n2z;tpl[o+3]=u1;tpl[o+4]=v1;o+=5;
          }
        }
        _unitSphereCache.set(key, tpl);
      }
      const nVerts = tpl.length / 5;
      this._ensure(nVerts * 13);
      const buf = this._buf, kk = kind + this.boneOffset;
      let w = this._len;
      for (let o = 0; o < tpl.length; o += 5) {
        const nx = tpl[o], ny = tpl[o + 1], nz = tpl[o + 2];
        buf[w]     = x + nx * rx; buf[w + 1] = y + ny * rx; buf[w + 2] = z + nz * rx;
        buf[w + 3] = nx;          buf[w + 4] = ny;          buf[w + 5] = nz;
        buf[w + 6] = tpl[o + 3];  buf[w + 7] = tpl[o + 4];  buf[w + 8] = layer;
        buf[w + 9] = r;           buf[w + 10] = g;          buf[w + 11] = b;
        buf[w + 12] = kk;
        w += 13;
      }
      this._len = w;
      return;
    }
    const lut = circleLUT(sides);
    const invS = 1 / sides, invB = 1 / bands;
    const irx = 1 / (rx || 1e-6), iry = 1 / (ry || 1e-6), irz = 1 / (rz || 1e-6);
    for (let j = 0; j < bands; j++) {
      const b0 = j * invB * Math.PI - Math.PI * .5;
      const b1 = (j + 1) * invB * Math.PI - Math.PI * .5;
      const cb0 = Math.cos(b0), sb0 = Math.sin(b0);
      const cb1 = Math.cos(b1), sb1 = Math.sin(b1);
      const v0 = j * invB, v1 = (j + 1) * invB;
      for (let i = 0; i < sides; i++) {
        const ca0 = lut[i * 2], sa0 = lut[i * 2 + 1];
        const ca1 = lut[i * 2 + 2], sa1 = lut[i * 2 + 3];
        const u0 = i * invS, u1 = (i + 1) * invS;

        const n0x = ca0 * cb0, n0y = sb0, n0z = sa0 * cb0;
        const n1x = ca1 * cb0, n1y = sb0, n1z = sa1 * cb0;
        const n2x = ca1 * cb1, n2y = sb1, n2z = sa1 * cb1;
        const n3x = ca0 * cb1, n3y = sb1, n3z = sa0 * cb1;

        const g0x = n0x * irx, g0y = n0y * iry, g0z = n0z * irz, l0 = 1 / (Math.sqrt(g0x * g0x + g0y * g0y + g0z * g0z) || 1);
        const g1x = n1x * irx, g1y = n1y * iry, g1z = n1z * irz, l1 = 1 / (Math.sqrt(g1x * g1x + g1y * g1y + g1z * g1z) || 1);
        const g2x = n2x * irx, g2y = n2y * iry, g2z = n2z * irz, l2 = 1 / (Math.sqrt(g2x * g2x + g2y * g2y + g2z * g2z) || 1);
        const g3x = n3x * irx, g3y = n3y * iry, g3z = n3z * irz, l3 = 1 / (Math.sqrt(g3x * g3x + g3y * g3y + g3z * g3z) || 1);

        const p0x = x + n0x * rx, p0y = y + n0y * ry, p0z = z + n0z * rz;
        const p1x = x + n1x * rx, p1y = y + n1y * ry, p1z = z + n1z * rz;
        const p2x = x + n2x * rx, p2y = y + n2y * ry, p2z = z + n2z * rz;
        const p3x = x + n3x * rx, p3y = y + n3y * ry, p3z = z + n3z * rz;

        // [0, 2, 1, 0, 3, 2]
        this.v(p0x, p0y, p0z, g0x * l0, g0y * l0, g0z * l0, u0, v0, layer, r, g, b, kind);
        this.v(p2x, p2y, p2z, g2x * l2, g2y * l2, g2z * l2, u1, v1, layer, r, g, b, kind);
        this.v(p1x, p1y, p1z, g1x * l1, g1y * l1, g1z * l1, u1, v0, layer, r, g, b, kind);
        this.v(p0x, p0y, p0z, g0x * l0, g0y * l0, g0z * l0, u0, v0, layer, r, g, b, kind);
        this.v(p3x, p3y, p3z, g3x * l3, g3y * l3, g3z * l3, u0, v1, layer, r, g, b, kind);
        this.v(p2x, p2y, p2z, g2x * l2, g2y * l2, g2z * l2, u1, v1, layer, r, g, b, kind);
      }
    }
  }
  ellipsoid(x, y, z, rx, ry, rz, mat, tint, kind = 0, sides = 12, bands = 6) {
    const co = color(tint);
    this.ellipsoidS(x, y, z, rx, ry, rz, layers[mat] ?? 0, co[0], co[1], co[2], kind, sides, bands);
  }
  // True 26-facet chamfered tactical armor plate (6 flat faces + 12 beveled edges + 8 corner facets).
  bevelBox(x, y, z, w, h, d, bevel = .012, mat = 'steel', tint = '#ffffff', kind = 1) {
    const bv = Math.min(bevel, w * .34, h * .34, d * .34);
    if (bv < 1e-4) {
      this.box(x, y, z, w, h, d, mat, tint, 0, kind);
      return;
    }
    const co = color(tint), layer = layers[mat] ?? 0, cr = co[0], cg = co[1], cb = co[2];
    const hx = w * .5, hy = h * .5, hz = d * .5;
    const ix = hx - bv, iy = hy - bv, iz = hz - bv;
    const S2 = Math.SQRT1_2, S3 = 1 / Math.sqrt(3);
    const Q = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz) =>
      this.quadS(x + ax, y + ay, z + az, x + bx, y + by, z + bz, x + cx, y + cy, z + cz, x + dx, y + dy, z + dz, nx, ny, nz, 1, 1, layer, cr, cg, cb, kind);
    // 6 main flat faces
    Q(-ix, -iy, hz, ix, -iy, hz, ix, iy, hz, -ix, iy, hz, 0, 0, 1);
    Q(ix, -iy, -hz, -ix, -iy, -hz, -ix, iy, -hz, ix, iy, -hz, 0, 0, -1);
    Q(hx, -iy, iz, hx, -iy, -iz, hx, iy, -iz, hx, iy, iz, 1, 0, 0);
    Q(-hx, -iy, -iz, -hx, -iy, iz, -hx, iy, iz, -hx, iy, -iz, -1, 0, 0);
    Q(-ix, hy, iz, ix, hy, iz, ix, hy, -iz, -ix, hy, -iz, 0, 1, 0);
    Q(-ix, -hy, -iz, ix, -hy, -iz, ix, -hy, iz, -ix, -hy, iz, 0, -1, 0);
    // 4 vertical chamfers (X-Z)
    Q(ix, -iy, hz, hx, -iy, iz, hx, iy, iz, ix, iy, hz, S2, 0, S2);
    Q(-hx, -iy, iz, -ix, -iy, hz, -ix, iy, hz, -hx, iy, iz, -S2, 0, S2);
    Q(hx, -iy, -iz, ix, -iy, -hz, ix, iy, -hz, hx, iy, -iz, S2, 0, -S2);
    Q(-ix, -iy, -hz, -hx, -iy, -iz, -hx, iy, -iz, -ix, iy, -hz, -S2, 0, -S2);
    // 4 upper horizontal chamfers (+Y)
    Q(-ix, iy, hz, ix, iy, hz, ix, hy, iz, -ix, hy, iz, 0, S2, S2);
    Q(ix, iy, -hz, -ix, iy, -hz, -ix, hy, -iz, ix, hy, -iz, 0, S2, -S2);
    Q(hx, iy, iz, hx, iy, -iz, ix, hy, -iz, ix, hy, iz, S2, S2, 0);
    Q(-hx, iy, -iz, -hx, iy, iz, -ix, hy, iz, -ix, hy, -iz, -S2, S2, 0);
    // 4 lower horizontal chamfers (-Y)
    Q(-ix, -hy, iz, ix, -hy, iz, ix, -iy, hz, -ix, -iy, hz, 0, -S2, S2);
    Q(ix, -hy, -iz, -ix, -hy, -iz, -ix, -iy, -hz, ix, -iy, -hz, 0, -S2, -S2);
    Q(ix, -hy, iz, ix, -hy, -iz, hx, -iy, -iz, hx, -iy, iz, S2, -S2, 0);
    Q(-ix, -hy, -iz, -ix, -hy, iz, -hx, -iy, iz, -hx, -iy, -iz, -S2, -S2, 0);
    // 8 corner triangular facets
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const ax = x + sx * hx, ay = y + sy * iy, az = z + sz * iz;
      const bx = x + sx * ix, by = y + sy * hy, bz = z + sz * iz;
      const cx = x + sx * ix, cy = y + sy * iy, cz = z + sz * hz;
      if (sx * sy * sz > 0) this.triS(ax, ay, az, bx, by, bz, cx, cy, cz, sx * S3, sy * S3, sz * S3, layer, cr, cg, cb, kind);
      else this.triS(ax, ay, az, cx, cy, cz, bx, by, bz, sx * S3, sy * S3, sz * S3, layer, cr, cg, cb, kind);
    }
  }
  // Multi-ring anatomical/armored loft along segment a->b.
  // rings: array of [t, rx, rz, offX?, offZ?], where X=side axis, Z=front-back axis.
  sculptLimb(a, b, rings, mat = 'canvas', tint = '#ffffff', sides = 12, kind = 0, refFwd = null) {
    const diff = sub(b, a), len = Math.hypot(diff[0], diff[1], diff[2]) || 1;
    const axis = scale(diff, 1 / len);
    const hint = refFwd || (Math.abs(axis[2]) > .92 ? [1, 0, 0] : [0, 0, -1]);
    const u = unit(cross(axis, hint));
    const v = unit(cross(u, axis));
    const co = color(tint), layer = layers[mat] ?? 0, cr = co[0], cg = co[1], cb = co[2];
    const lut = circleLUT(sides);
    const pts = [], nrms = [];
    for (let r = 0; r < rings.length; r++) {
      const [t, rx, rz, ox = 0, oz = 0] = rings[r];
      const bx = a[0] + diff[0] * t + u[0] * ox + v[0] * oz;
      const by = a[1] + diff[1] * t + u[1] * ox + v[1] * oz;
      const bz = a[2] + diff[2] * t + u[2] * ox + v[2] * oz;
      const pPrev = r > 0 ? rings[r - 1] : rings[r];
      const pNext = r < rings.length - 1 ? rings[r + 1] : rings[r];
      const dt = Math.max(.02, (pNext[0] - pPrev[0]) * len);
      const drx = (pNext[1] - pPrev[1]) / dt;
      const drz = (pNext[2] - pPrev[2]) / dt;
      const ringP = [], ringN = [];
      const irx = 1 / Math.max(.005, rx), irz = 1 / Math.max(.005, rz);
      for (let i = 0; i <= sides; i++) {
        const ca = lut[i * 2], sa = lut[i * 2 + 1];
        ringP.push([bx + u[0] * ca * rx + v[0] * sa * rz, by + u[1] * ca * rx + v[1] * sa * rz, bz + u[2] * ca * rx + v[2] * sa * rz]);
        const slope = -(drx * ca * ca + drz * sa * sa) * 1.4;
        let nx = u[0] * ca * irx + v[0] * sa * irz + axis[0] * slope;
        let ny = u[1] * ca * irx + v[1] * sa * irz + axis[1] * slope;
        let nz = u[2] * ca * irx + v[2] * sa * irz + axis[2] * slope;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        ringN.push([nx / nl, ny / nl, nz / nl]);
      }
      pts.push(ringP);
      nrms.push(ringN);
    }
    const invS = 1 / sides, invR = 1 / (rings.length - 1);
    for (let r = 0; r < rings.length - 1; r++) {
      const v0 = r * invR, v1 = (r + 1) * invR;
      for (let i = 0; i < sides; i++) {
        const u0 = i * invS, u1 = (i + 1) * invS;
        const p0 = pts[r][i], p1 = pts[r][i + 1], p2 = pts[r + 1][i + 1], p3 = pts[r + 1][i];
        const n0 = nrms[r][i], n1 = nrms[r][i + 1], n2 = nrms[r + 1][i + 1], n3 = nrms[r + 1][i];
        this.v(p0[0], p0[1], p0[2], n0[0], n0[1], n0[2], u0, v0, layer, cr, cg, cb, kind);
        this.v(p1[0], p1[1], p1[2], n1[0], n1[1], n1[2], u1, v0, layer, cr, cg, cb, kind);
        this.v(p2[0], p2[1], p2[2], n2[0], n2[1], n2[2], u1, v1, layer, cr, cg, cb, kind);
        this.v(p0[0], p0[1], p0[2], n0[0], n0[1], n0[2], u0, v0, layer, cr, cg, cb, kind);
        this.v(p2[0], p2[1], p2[2], n2[0], n2[1], n2[2], u1, v1, layer, cr, cg, cb, kind);
        this.v(p3[0], p3[1], p3[2], n3[0], n3[1], n3[2], u0, v1, layer, cr, cg, cb, kind);
      }
    }
    // End caps
    const c0 = add(a, add(scale(u, rings[0][3] || 0), scale(v, rings[0][4] || 0)));
    const last = rings[rings.length - 1];
    const c1 = add(b, add(scale(u, last[3] || 0), scale(v, last[4] || 0)));
    const lastR = rings.length - 1;
    for (let i = 0; i < sides; i++) {
      this.triS(c0[0], c0[1], c0[2], pts[0][i + 1][0], pts[0][i + 1][1], pts[0][i + 1][2], pts[0][i][0], pts[0][i][1], pts[0][i][2], -axis[0], -axis[1], -axis[2], layer, cr, cg, cb, kind);
      this.triS(c1[0], c1[1], c1[2], pts[lastR][i][0], pts[lastR][i][1], pts[lastR][i][2], pts[lastR][i + 1][0], pts[lastR][i + 1][1], pts[lastR][i + 1][2], axis[0], axis[1], axis[2], layer, cr, cg, cb, kind);
    }
  }
  // Corrugated accordion ballistic flex-gasket sleeve for articulated joints (knees, elbows, shoulders, waist, neck, ankles).
  ribbedJoint(a, b, rMin, rMax, ribs = 4, mat = 'rubber', tint = '#353e41', sides = 10, kind = 0) {
    const rings = [];
    const steps = ribs * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = i % 2 === 1 ? rMax : rMin;
      rings.push([t, r, r]);
    }
    this.sculptLimb(a, b, rings, mat, tint, sides, kind);
  }
  // Precision mechanical joint drum + concentric brushed-steel pivot pin caps along axis.
  hingeRotor(center, axis, radius, width, mat = 'blackMetal', tint = '#525f64', pinTint = '#b4c4c8', sides = 10, kind = 1) {
    const ax = unit(axis);
    const half = width * .5;
    const pA = add(center, scale(ax, -half));
    const pB = add(center, scale(ax, half));
    this.sculptLimb(pA, pB, [
      [0, radius * .84, radius * .84],
      [.16, radius, radius],
      [.84, radius, radius],
      [1, radius * .84, radius * .84]
    ], mat, tint, sides, kind);
    const pinA = add(center, scale(ax, -(half + .009)));
    const pinB = add(center, scale(ax, half + .009));
    this.tube(pinA, pinB, radius * .44, radius * .44, 'steel', pinTint, Math.max(8, sides - 2), 1);
  }
  // Curved wrap-around armor shell (pauldrons, knee cradles, forearm bracers, shin greaves, collars).
  curvedPlate(center, axis, fwdDir, radius, height, arcRad, thick = .014, mat = 'steel', tint = '#8d9b97', segs = 8, kind = 1) {
    const ax = unit(axis);
    const rawF = sub(fwdDir, scale(ax, dot(fwdDir, ax)));
    const fwd = unit(Math.hypot(rawF[0], rawF[1], rawF[2]) > 1e-4 ? rawF : cross(ax, [1, 0, 0]));
    const right = unit(cross(fwd, ax));
    const hh = height * .5;
    const rOut = radius + thick * .5, rIn = Math.max(.005, radius - thick * .5);
    const co = color(tint), layer = layers[mat] ?? 0, cr = co[0], cg = co[1], cb = co[2];
    const topC = add(center, scale(ax, hh)), botC = add(center, scale(ax, -hh));
    const ringAt = (r, a) => add(scale(fwd, Math.cos(a) * r), scale(right, Math.sin(a) * r));
    const normAt = a => unit(add(scale(fwd, Math.cos(a)), scale(right, Math.sin(a))));
    for (let i = 0; i < segs; i++) {
      const a0 = -arcRad * .5 + (i / segs) * arcRad;
      const a1 = -arcRad * .5 + ((i + 1) / segs) * arcRad;
      const n0 = normAt(a0), n1 = normAt(a1);
      const ob0 = add(botC, ringAt(rOut, a0)), ob1 = add(botC, ringAt(rOut, a1));
      const ot0 = add(topC, ringAt(rOut, a0)), ot1 = add(topC, ringAt(rOut, a1));
      const ib0 = add(botC, ringAt(rIn, a0)), ib1 = add(botC, ringAt(rIn, a1));
      const it0 = add(topC, ringAt(rIn, a0)), it1 = add(topC, ringAt(rIn, a1));
      const u0 = i / segs, u1 = (i + 1) / segs;
      this.v(ob0[0], ob0[1], ob0[2], n0[0], n0[1], n0[2], u0, 1, layer, cr, cg, cb, kind);
      this.v(ob1[0], ob1[1], ob1[2], n1[0], n1[1], n1[2], u1, 1, layer, cr, cg, cb, kind);
      this.v(ot1[0], ot1[1], ot1[2], n1[0], n1[1], n1[2], u1, 0, layer, cr, cg, cb, kind);
      this.v(ob0[0], ob0[1], ob0[2], n0[0], n0[1], n0[2], u0, 1, layer, cr, cg, cb, kind);
      this.v(ot1[0], ot1[1], ot1[2], n1[0], n1[1], n1[2], u1, 0, layer, cr, cg, cb, kind);
      this.v(ot0[0], ot0[1], ot0[2], n0[0], n0[1], n0[2], u0, 0, layer, cr, cg, cb, kind);
      this.v(ib1[0], ib1[1], ib1[2], -n1[0], -n1[1], -n1[2], u1, 1, layer, cr, cg, cb, kind);
      this.v(ib0[0], ib0[1], ib0[2], -n0[0], -n0[1], -n0[2], u0, 1, layer, cr, cg, cb, kind);
      this.v(it0[0], it0[1], it0[2], -n0[0], -n0[1], -n0[2], u0, 0, layer, cr, cg, cb, kind);
      this.v(ib1[0], ib1[1], ib1[2], -n1[0], -n1[1], -n1[2], u1, 1, layer, cr, cg, cb, kind);
      this.v(it0[0], it0[1], it0[2], -n0[0], -n0[1], -n0[2], u0, 0, layer, cr, cg, cb, kind);
      this.v(it1[0], it1[1], it1[2], -n1[0], -n1[1], -n1[2], u1, 0, layer, cr, cg, cb, kind);
      this.quad(ot0, ot1, it1, it0, mat, tint, 1, 1, kind, ax);
      this.quad(ib0, ib1, ob1, ob0, mat, tint, 1, 1, kind, scale(ax, -1));
      if (i === 0) this.quad(ib0, ob0, ot0, it0, mat, tint, 1, 1, kind, scale(right, -1));
      if (i === segs - 1) this.quad(ob1, ib1, it1, ot1, mat, tint, 1, 1, kind, right);
    }
  }
}
