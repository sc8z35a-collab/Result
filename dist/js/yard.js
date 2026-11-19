import {clamp} from './geometry.js';
export const FIELD = {width: 50, length: 200};
// x and z are metres from the centre of the playable wharf. Above-ground cargo
// is listed separately so the visible stacks and the occupied volumes agree.
export const cargo = [
  [-12, 78, 2.65, 12, 0, 'blue', 'TIDE'],
  [-12, 78, 2.65, 12, 2.62, 'red', 'NORTH'],
  [-5, 71, 6.1, 2.55, 0, 'ivory', 'HBR'],
  [9, 77, 3, 12.2, 0, 'red', 'NORTH'],
  [12.1, 77, 3, 12.2, 0, 'green', 'TIDE'],
  [12.1, 77, 3, 12.2, 2.62, 'ivory', 'HBR'],
  [15.25, 77, 3, 12.2, 0, 'red', 'NORTH'],
  [15.25, 77, 3, 12.2, 2.62, 'blue', 'HBR'],
  [18.4, 77, 3, 12.2, 0, 'blue', 'TIDE'],
  [18.4, 77, 3, 12.2, 2.62, 'red', 'NORTH'],
  [-12, 54, 6.1, 2.6, 0, 'teal', 'TIDE'],
  [-7.5, 46, 2.6, 12.2, 0, 'ivory', 'HBR'],
  [-7.5, 46, 2.6, 12.2, 2.62, 'red', 'NORTH'],
  [8.3, 48, 12.2, 2.65, 0, 'blue', 'HBR'],
  [8.3, 48, 12.2, 2.65, 2.62, 'teal', 'TIDE'],
  [16.5, 42, 2.65, 6.1, 0, 'ochre', 'NORTH'],
  [-17, 26, 2.65, 6.1, 0, 'blue', 'TIDE'],
  [1.7, 30, 6.1, 2.65, 0, 'red', 'NORTH'],
  [1.7, 30, 6.1, 2.65, 2.62, 'ivory', 'HBR'],
  [11.4, 18, 2.65, 12.2, 0, 'ivory', 'HBR'],
  [14.2, 18, 2.65, 12.2, 0, 'red', 'NORTH'],
  [14.2, 18, 2.65, 12.2, 2.62, 'red', 'NORTH'],
  [-7.8, 8, 12.2, 2.65, 0, 'teal', 'TIDE'],
  [-7.8, 8, 12.2, 2.65, 2.62, 'blue', 'HBR'],
  [-15.4, -10, 2.65, 12.2, 0, 'ochre', 'NORTH'],
  [5.5, -8, 6.1, 2.65, 0, 'red', 'NORTH'],
  [9, -23, 12.2, 2.65, 0, 'teal', 'TIDE'],
  [9, -23, 12.2, 2.65, 2.62, 'ivory', 'HBR'],
  [-7, -32, 2.65, 12.2, 0, 'blue', 'HBR'],
  [-1, -42, 6.1, 2.65, 0, 'red', 'NORTH'],
  [-1, -42, 6.1, 2.65, 2.62, 'ochre', 'NORTH'],
  [14, -47, 2.65, 12.2, 0, 'blue', 'HBR'],
  [17, -47, 2.65, 12.2, 0, 'red', 'NORTH'],
  [17, -47, 2.65, 12.2, 2.62, 'teal', 'TIDE'],
  [-11.5, -61, 12.2, 2.65, 0, 'ivory', 'HBR'],
  [-11.5, -61, 12.2, 2.65, 2.62, 'red', 'NORTH'],
  [5.3, -65, 2.65, 6.1, 0, 'ochre', 'NORTH'],
  [12, -78, 12.2, 2.65, 0, 'teal', 'TIDE'],
  [12, -78, 12.2, 2.65, 2.62, 'blue', 'HBR'],
  [-10, -83, 2.65, 12.2, 0, 'red', 'NORTH']
];
export const props = [
  ['crates', -16, 68, 2.8, 2.2, 2.8],
  ['crates', 2.6, 61, 2.6, 2.6, 1.5],
  ['barrier', -3, 56, 5, .86, .8],
  ['spool', -15, 40, 2.2, 1.9, 2.2],
  ['crates', 0, 23, 2.6, 2.3, 2.0],
  ['barrier', -2, 16, 3.8, .92, .8],
  ['lift', 18, 2, 2.2, 2.7, 3.7],
  ['spool', -17, -1, 2.3, 2.0, 2.3],
  ['barrier', -4, -16, .85, .93, 4],
  ['crates', 13, -10, 2.6, 2.1, 2.5],
  ['crates', -11, -26, 2.2, 2.4, 2],
  ['barrier', 1, -31, 4, .9, .8],
  ['spool', -16, -45, 2.2, 2, 2.2],
  ['crates', 6, -54, 2.6, 2.5, 2.4],
  ['barrier', -2, -70, 4, .9, .8],
  ['crates', -16, -77, 2.4, 2.4, 2.4],
  ['barrier', 8, 90, 4.5, .8, .8],
  ['spool', 17, 60, 2.4, 1.95, 2.4]
];
export const craneSites = [{x: -18, z: 37, scale: 1, number: '04'}, {x: -18, z: -66, scale: .95, number: '05'}];
export const teams = [[[1, 84], [-16, 85], [6, 70], [-18, 56], [19, 61], [-2, 89]], [[0, -84], [18, -85], [-17, -73], [18, -61], [-3, -77], [4, -91]]];
export const obstacles = [];
function obstacle(x, z, w, d, y0, y1) {
  obstacles.push({x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0, y1})
}
for (const [x, z, w, d, y] of cargo)obstacle(x, z, w, d, y, y + 2.62);
for (const [, x, z, w, h, d] of props)obstacle(x, z, w, d, 0, h);
for (const c of craneSites)for (const dx of [-4.4, 4.4])for (const dz of [-8, 8])obstacle(c.x + dx * c.scale, c.z + dz * c.scale, 1.6 * c.scale, 2.9 * c.scale, 0, 8 * c.scale);
for (let z = -94; z <= 96; z += 19)obstacle(-23.7, z, .9, 1.2, 0, .86);
// A uniform index keeps visibility, swept shots and navigation queries local.
const CELL = 8, grid = new Map();
const cellKey = (x, z) => (x + 50) * 512 + z + 128;
for (const [i, o] of obstacles.entries())for (let ix = Math.floor(o.x0 / CELL); ix <= Math.floor(o.x1 / CELL); ix++)for (let iz = Math.floor(o.z0 / CELL); iz <= Math.floor(o.z1 / CELL); iz++) {
  const k = cellKey(ix, iz);
  if (!grid.has(k))grid.set(k, []);
  grid.get(k).push(i)
}
function nearby(x0, z0, x1, z1) {
  const hits = new Set();
  for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++)for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
    const ids = grid.get(cellKey(ix, iz));
    if (ids)for (const i of ids)hits.add(i)
  }
  return hits
}
export function walkable(x, z, r = .41, feet = 0) {
  if (Math.abs(x) > 25 - r || Math.abs(z) > 100 - r)return false;
  for (const i of nearby(x - r, z - r, x + r, z + r)) {
    const o = obstacles[i];
    if (feet >= o.y1 - .018 || feet + 1.7 <= o.y0)continue;
    const dx = x - clamp(x, o.x0, o.x1), dz = z - clamp(z, o.z0, o.z1);
    if (dx * dx + dz * dz < r * r)return false
  }
  return true
}
export function floorAt(x, z, oldY) {
  let h = 0;
  for (const i of nearby(x - .29, z - .29, x + .29, z + .29)) {
    const o = obstacles[i];
    if (o.y1 > oldY + .04 || x < o.x0 - .24 || x > o.x1 + .24 || z < o.z0 - .24 || z > o.z1 + .24)continue;
    h = Math.max(h, o.y1)
  }
  return h
}
export function rayBox(a, b, o) {
  let enter = 0, exit = 1;
  for (const [k, lo, hi] of [[0, o.x0, o.x1], [1, o.y0, o.y1], [2, o.z0, o.z1]]) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-8) {
      if (a[k] < lo || a[k] > hi)return Infinity;
      continue
    }
    let p = (lo - a[k]) / d, q = (hi - a[k]) / d;
    if (p > q)[p, q] = [q, p];
    enter = Math.max(enter, p);
    exit = Math.min(exit, q);
    if (enter > exit)return Infinity
  }
  return enter
}
export function obstruction(a, b) {
  let nearest = Infinity;
  for (const i of nearby(Math.min(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[2], b[2])))nearest = Math.min(nearest, rayBox(a, b, obstacles[i]));
  if (b[1] < 0 && a[1] >= 0)nearest = Math.min(nearest, a[1] / (a[1] - b[1]));
  return nearest
}
export function moveActor(a, dx, dz) {
  const tx = clamp(a.x + dx, -24.58, 24.58), tz = clamp(a.z + dz, -99.58, 99.58);
  if (walkable(tx, a.z, .4, a.y))a.x = tx;
  if (walkable(a.x, tz, .4, a.y))a.z = tz
}
