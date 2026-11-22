import {clamp} from './geometry.js';
export const FIELD = {width: 50, length: 200};
export const WATER_HEIGHT = -1.68;
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
export const tankers = [
  {id: 0, label: 'SOUTH TANKER', x: 10.0, z: 62.0, w: 2.4, h: 2.85, d: 5.6, radius: 4.6, facing: -1},
  {id: 1, label: 'CENTRAL TANKER', x: -6.5, z: -5.0, w: 2.4, h: 2.85, d: 5.6, radius: 4.6, facing: 1},
  {id: 2, label: 'NORTH TANKER', x: 12.0, z: -58.0, w: 2.4, h: 2.85, d: 5.6, radius: 4.6, facing: 1}
];
export const teams = [[[1, 84], [-16, 85], [6, 70], [-18, 56], [19, 61], [-2, 89]], [[0, -84], [18, -85], [-17, -73], [18, -61], [-3, -77], [4, -91]]];
export const obstacles = [];
function obstacle(x, z, w, d, y0, y1, mat = 'steel') {
  obstacles.push({x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0, y1, mat})
}
for (const [x, z, w, d, y] of cargo)obstacle(x, z, w, d, y, y + 2.62, 'steel');
for (const [kind, x, z, w, h, d] of props)obstacle(x, z, w, d, 0, h, kind === 'barrier' ? 'concrete' : kind === 'lift' ? 'steel' : 'wood');
for (const t of tankers)obstacle(t.x, t.z, t.w, t.d, 0, t.h, 'steel');
for (const c of craneSites)for (const dx of [-4.4, 4.4])for (const dz of [-8, 8])obstacle(c.x + dx * c.scale, c.z + dz * c.scale, 1.6 * c.scale, 2.9 * c.scale, 0, 8 * c.scale, 'steel');
for (let z = -94; z <= 96; z += 19)obstacle(-23.7, z, .9, 1.2, 0, .86, 'concrete');
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
    if (feet >= o.y1 - .018 || feet + 1.7 <= o.y0) continue;
    const dx = x - clamp(x, o.x0, o.x1), dz = z - clamp(z, o.z0, o.z1);
    if (dx * dx + dz * dz < r * r)return false
  }
  return true
}
export function floorAt(x, z, oldY) {
  let h = 0;
  for (const i of nearby(x - .29, z - .29, x + .29, z + .29)) {
    const o = obstacles[i];
    if (o.y1 > oldY + .04) continue;
    const dx = x - clamp(x, o.x0, o.x1), dz = z - clamp(z, o.z0, o.z1);
    if (dx * dx + dz * dz <= .24 ** 2) h = Math.max(h, o.y1);
  }
  return h
}
export function surfaceAt(x, z, y) {
  if (y <= .08)return 'concrete';
  let best = 'steel', bestDiff = Infinity;
  for (const i of nearby(x - .34, z - .34, x + .34, z + .34)) {
    const o = obstacles[i];
    if (x < o.x0 - .28 || x > o.x1 + .28 || z < o.z0 - .28 || z > o.z1 + .28)continue;
    const diff = Math.abs(o.y1 - y);
    if (diff < .28 && diff < bestDiff) {
      bestDiff = diff;
      best = o.mat || 'steel'
    }
  }
  return best
}
// Parallel rays on a face may graze it. A segment starting on a face
// and moving outward, however, travels entirely through free space.
function boxSpan(a, b, o) {
  let enter = -Infinity, exit = Infinity, enterAxis = -1, exitAxis = -1;
  let enterSign = 0, exitSign = 0;
  for (const [k, lo, hi] of [[0, o.x0, o.x1], [1, o.y0, o.y1], [2, o.z0, o.z1]]) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-8) {
      if (a[k] < lo || a[k] > hi) return null;
      continue;
    }
    const sign = d > 0 ? 1 : -1;
    const p = ((sign > 0 ? lo : hi) - a[k]) / d;
    const q = ((sign > 0 ? hi : lo) - a[k]) / d;
    if (p > enter) {
      enter = p;
      enterAxis = k;
      enterSign = -sign;
    }
    if (q < exit) {
      exit = q;
      exitAxis = k;
      exitSign = sign;
    }
    if (enter > exit) return null;
  }
  if (exit <= 0 || enter > 1) return null;
  return {enter: Math.max(0, enter), exit, enterAxis, enterSign, exitAxis, exitSign};
}

export function rayBoxSpan(a, b, o) {
  const span = boxSpan(a, b, o);
  return span ? {enter: span.enter, exit: Math.min(1, span.exit)} : null;
}

export function rayBox(a, b, o) {
  return boxSpan(a, b, o)?.enter ?? Infinity;
}

const at = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const faceNormal = (axis, sign) => {
  const n = [0, 0, 0];
  n[axis < 0 ? 1 : axis] = axis < 0 ? 1 : sign;
  return n;
};

const deck = {x0: -25, x1: 25, y0: -3.1, y1: 0, z0: -100, z1: 100, mat: 'concrete'};
function deckSpan(a, b) {
  if (a[1] >= 0 && (b[1] > 0 || a[1] === b[1])) return null;
  return boxSpan(a, b, deck);
}

export function waterCrossing(a, b) {
  if (a[1] <= WATER_HEIGHT || b[1] > WATER_HEIGHT) return null;
  return (a[1] - WATER_HEIGHT) / (a[1] - b[1]);
}
export function raycastMaterial(a, b) {
  let hitSpan = deckSpan(a, b), nearest = hitSpan?.enter ?? Infinity, hitObj = hitSpan ? deck : null;
  for (const i of nearby(Math.min(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[2], b[2]))) {
    const o = obstacles[i], span = boxSpan(a, b, o);
    if (span && span.enter < nearest) {
      nearest = span.enter;
      hitObj = o;
      hitSpan = span;
    }
  }
  if (!Number.isFinite(nearest)) return null;
  const point = at(a, b, nearest);
  const {enterAxis, enterSign, exitAxis, exitSign, exit: tExit} = hitSpan;
  const exitPoint = hitObj !== deck && Number.isFinite(tExit) ? at(a, b, tExit) : null;
  const thickness = exitPoint ? Math.hypot(...exitPoint.map((x, i) => x - point[i])) : Infinity;
  return {
    t: nearest, tExit, point, normal: faceNormal(enterAxis, enterSign),
    exitPoint, exitNormal: exitPoint && faceNormal(exitAxis, exitSign),
    thickness, mat: hitObj.mat || 'steel', box: hitObj
  };
}

export function obstruction(a, b) {
  let nearest = deckSpan(a, b)?.enter ?? Infinity;
  for (const i of nearby(Math.min(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[2], b[2]))) nearest = Math.min(nearest, rayBox(a, b, obstacles[i]));
  return nearest;
}

export function clearOpticalPath(a, b, aero) {
  return obstruction(a, b) > 1 &&
    !(aero?.stats.totalSmoke > 1.8 && aero.smokeOcclusion(a, b) > .86);
}

function penetrationDepth(x, z, r, feet) {
  let depth = 0;
  if (Math.abs(x) > 25 - r) depth += Math.abs(x) - (25 - r);
  if (Math.abs(z) > 100 - r) depth += Math.abs(z) - (100 - r);
  for (const i of nearby(x - r, z - r, x + r, z + r)) {
    const o = obstacles[i];
    if (feet >= o.y1 - .018 || feet + 1.7 <= o.y0) continue;
    const dx = x - clamp(x, o.x0, o.x1), dz = z - clamp(z, o.z0, o.z1);
    const dist = Math.hypot(dx, dz);
    if (dist < r) depth += r - dist;
  }
  return depth;
}

function depenetrate(a, r = .4) {
  const feet = a.y;
  for (let pass = 0; pass < 3; pass++) {
    const curPen = penetrationDepth(a.x, a.z, r, feet);
    if (curPen <= 1e-6) return;
    let bestPen = curPen, bestX = a.x, bestZ = a.z;
    for (const i of nearby(a.x - r, a.z - r, a.x + r, a.z + r)) {
      const o = obstacles[i];
      if (feet >= o.y1 - .018 || feet + 1.7 <= o.y0) continue;
      const cx = clamp(a.x, o.x0, o.x1), cz = clamp(a.z, o.z0, o.z1);
      let dx = a.x - cx, dz = a.z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist >= r) continue;
      let nx, nz;
      if (dist > 1e-6) {
        const push = (r - dist) + .003;
        nx = clamp(a.x + (dx / dist) * push, -24.58, 24.58);
        nz = clamp(a.z + (dz / dist) * push, -99.58, 99.58);
      } else {
        const dL = a.x - o.x0, dR = o.x1 - a.x, dF = a.z - o.z0, dB = o.z1 - a.z;
        const m = Math.min(dL, dR, dF, dB);
        nx = a.x;
        nz = a.z;
        if (m === dL) nx = o.x0 - r - .003;
        else if (m === dR) nx = o.x1 + r + .003;
        else if (m === dF) nz = o.z0 - r - .003;
        else nz = o.z1 + r + .003;
        nx = clamp(nx, -24.58, 24.58);
        nz = clamp(nz, -99.58, 99.58);
      }
      const p = penetrationDepth(nx, nz, r, feet);
      if (p < bestPen - 1e-6) {
        bestPen = p;
        bestX = nx;
        bestZ = nz;
      }
    }
    if (bestPen < curPen - 1e-6) {
      a.x = bestX;
      a.z = bestZ;
    } else break;
  }
}

export function moveActor(a, dx, dz) {
  if (!walkable(a.x, a.z, .4, a.y)) depenetrate(a, .4);
  const tx = clamp(a.x + dx, -24.58, 24.58), tz = clamp(a.z + dz, -99.58, 99.58);
  const penX = walkable(tx, a.z, .4, a.y) ? 0 : penetrationDepth(tx, a.z, .4, a.y);
  const curPenX = penX > 0 ? penetrationDepth(a.x, a.z, .4, a.y) : 0;
  if (penX === 0 || (curPenX > 0 && penX < curPenX - 1e-6)) {
    if (a.x === tx && dx) a.vx = 0;
    a.x = tx;
  } else a.vx = 0;
  const penZ = walkable(a.x, tz, .4, a.y) ? 0 : penetrationDepth(a.x, tz, .4, a.y);
  const curPenZ = penZ > 0 ? penetrationDepth(a.x, a.z, .4, a.y) : 0;
  if (penZ === 0 || (curPenZ > 0 && penZ < curPenZ - 1e-6)) {
    if (a.z === tz && dz) a.vz = 0;
    a.z = tz;
  } else a.vz = 0;
}
