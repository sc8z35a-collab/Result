export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mix = (a, b, t) => a + (b - a) * t;
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const scale = (a, s) => a.map(v => v * s);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = a => {
  const n = Math.hypot(...a) || 1;
  return a.map(v => v / n)
};
export const blend = (a, b, t) => a.map((v, i) => mix(v, b[i], t));
export const forward = (yaw, pitch = 0) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
export const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296
  }
}
export function multiply(a, b) {
  const c = new Float32Array(16);
  for (let j = 0; j < 4; j++)for (let i = 0; i < 4; i++)c[j * 4 + i] = a[i] * b[j * 4] + a[i + 4] * b[j * 4 + 1] + a[i + 8] * b[j * 4 + 2] + a[i + 12] * b[j * 4 + 3];
  return c
}
export function perspective(fov, aspect, near = .075, far = 1400) {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0])
}
export function ortho(l, r, b, t, n, f) {
  return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1])
}
export function lookAt(eye, target, up = [0, 1, 0]) {
  const z = unit(sub(eye, target)), x = unit(cross(up, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1])
}
export function invert4(m) {
  const o = new Float32Array(16);
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-12) return o;
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
  return o
}
export const layers = {white: 0};
const palettes = new Map();
export function color(hex) {
  if (Array.isArray(hex))return hex;
  if (!palettes.has(hex)) {
    const c = parseInt((hex || '#ffffff').slice(1), 16);
    palettes.set(hex, [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255])
  }
  return palettes.get(hex)
}
export const STRIDE = 13;
export class Mesh {
  constructor() {
    this.data = [];
    this.transform = null;
    this.boneOffset = 0
  }
  get count() {
    return this.data.length / STRIDE
  }
  vertex(p, n, uv, mat, c, kind) {
    let [x, y, z] = p, [a, b, d] = n;
    const t = this.transform;
    if (t) {
      const {origin: o, right: r, up: u, back: k} = t;
      x = o[0] + p[0] * r[0] + p[1] * u[0] + p[2] * k[0];
      y = o[1] + p[0] * r[1] + p[1] * u[1] + p[2] * k[1];
      z = o[2] + p[0] * r[2] + p[1] * u[2] + p[2] * k[2];
      a = n[0] * r[0] + n[1] * u[0] + n[2] * k[0];
      b = n[0] * r[1] + n[1] * u[1] + n[2] * k[1];
      d = n[0] * r[2] + n[1] * u[2] + n[2] * k[2]
    }
    this.data.push(x, y, z, a, b, d, uv[0], uv[1], layers[mat] ?? 0, c[0], c[1], c[2], kind + this.boneOffset)
  }
  tri(a, b, c, mat = 'white', tint = '#ffffff', kind = 0, normal = null, uvs = [[0, 1], [1, 1], [.5, 0]]) {
    const n = normal || unit(cross(sub(b, a), sub(c, a))), co = color(tint);
    this.vertex(a, n, uvs[0], mat, co, kind);
    this.vertex(b, n, uvs[1], mat, co, kind);
    this.vertex(c, n, uvs[2], mat, co, kind)
  }
  quad(a, b, c, d, mat = 'white', tint = '#ffffff', u = 1, v = 1, kind = 0, normal = null) {
    const n = normal || unit(cross(sub(b, a), sub(c, a))), co = color(tint), uv = [[0, v], [u, v], [u, 0], [0, 0]];
    for (const i of [0, 1, 2, 0, 2, 3])this.vertex([a, b, c, d][i], n, uv[i], mat, co, kind)
  }
  box(x, y, z, w, h, d, mat = 'white', tint = '#ffffff', repeat = 0, kind = 0) {
    const a = x - w / 2, b = x + w / 2, c = y - h / 2, e = y + h / 2, f = z - d / 2, g = z + d / 2;
    const U = repeat ? w / repeat : 1, V = repeat ? h / repeat : 1, D = repeat ? d / repeat : 1;
    this.quad([a, c, g], [b, c, g], [b, e, g], [a, e, g], mat, tint, U, V, kind, [0, 0, 1]);
    this.quad([b, c, f], [a, c, f], [a, e, f], [b, e, f], mat, tint, U, V, kind, [0, 0, -1]);
    this.quad([b, c, g], [b, c, f], [b, e, f], [b, e, g], mat, tint, D, V, kind, [1, 0, 0]);
    this.quad([a, c, f], [a, c, g], [a, e, g], [a, e, f], mat, tint, D, V, kind, [-1, 0, 0]);
    this.quad([a, e, g], [b, e, g], [b, e, f], [a, e, f], mat, tint, U, D, kind, [0, 1, 0]);
    this.quad([a, c, f], [b, c, f], [b, c, g], [a, c, g], mat, tint, U, D, kind, [0, -1, 0])
  }
  plane(x, y, z, w, d, mat, tint = '#ffffff', u = 1, v = 1, kind = 0) {
    this.quad([x - w / 2, y, z + d / 2], [x + w / 2, y, z + d / 2], [x + w / 2, y, z - d / 2], [x - w / 2, y, z - d / 2], mat, tint, u, v, kind, [0, 1, 0])
  }
  beam(a, b, w, depth = w, mat = 'white', tint = '#ffffff', kind = 1) {
    const axis = unit(sub(b, a)),
      side = scale(unit(cross(axis, Math.abs(axis[1]) > .92 ? [0, 0, 1] : [0, 1, 0])), w / 2),
      n = scale(unit(cross(side, axis)), depth / 2);
    const ring = p => [add(add(p, side), n), add(sub(p, side), n), sub(sub(p, side), n), add(sub(p, n), side)];
    const ra = ring(a), rb = ring(b);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(ra[j], ra[i], rb[i], rb[j], mat, tint, 1, 2, kind, unit(sub(blend(ra[i], ra[j], .5), a)))
    }
    this.quad(...rb, mat, tint, 1, 1, kind, axis)
  }
  tube(a, b, ra, rb = ra, mat = 'white', tint = '#ffffff', sides = 10, kind = 1) {
    const axis = unit(sub(b, a)),
      v = unit(cross(axis, Math.abs(axis[1]) > .92 ? [0, 0, 1] : [0, 1, 0])),
      w = unit(cross(axis, v)),
      co = color(tint);
    let prev = v;
    for (let i = 1; i <= sides; i++) {
      const t = i / sides * 2 * Math.PI,
        n = add(scale(v, Math.cos(t)), scale(w, Math.sin(t))),
        ps = [add(a, scale(prev, ra)), add(a, scale(n, ra)), add(b, scale(n, rb)), add(b, scale(prev, rb))];
      const ns = [prev, n, n, prev];
      for (const j of [0, 1, 2, 0, 2, 3])this.vertex(ps[j], ns[j], [[i / sides, 1], [(i + 1) / sides, 1], [(i + 1) / sides, 0], [i / sides, 0]][j], mat, co, kind);
      this.tri(b, ps[3], ps[2], mat, tint, kind, axis);
      this.tri(a, ps[1], ps[0], mat, tint, kind, scale(axis, -1));
      prev = n
    }
  }
  ellipsoid(x, y, z, rx, ry, rz, mat, tint, kind = 0, sides = 12, bands = 6) {
    const co = color(tint),
      point = (i, j) => {
      const a = i / sides * Math.PI * 2, b = j / bands * Math.PI - Math.PI / 2;
      const n = [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)];
      return [[x + n[0] * rx, y + n[1] * ry, z + n[2] * rz], unit([n[0] / rx, n[1] / ry, n[2] / rz]), [i / sides, j / bands]]
    };
    for (let i = 0; i < sides; i++)for (let j = 0; j < bands; j++) {
      const v = [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)];
      for (const k of [0, 2, 1, 0, 3, 2])this.vertex(...v[k], mat, co, kind)
    }
  }
}
