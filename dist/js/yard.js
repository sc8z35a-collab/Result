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
export const baizerPickups = [
  {id: 0, kind: 'BAIZER 200', amount: 20, x: -1.5, z: 68.0},
  {id: 1, kind: 'BAIZER 400', amount: 40, x: 4.2, z: 38.0},
  {id: 2, kind: 'BAIZER 200', amount: 20, x: -10.0, z: 20.0},
  {id: 3, kind: 'BAIZER 400', amount: 40, x: 1.5, z: -2.0},
  {id: 4, kind: 'BAIZER 200', amount: 20, x: 11.0, z: -35.0},
  {id: 5, kind: 'BAIZER 400', amount: 40, x: -4.5, z: -66.0}
];
export const teams = [[[1, 84], [-16, 85], [6, 70], [-18, 56], [19, 61], [-2, 89]], [[0, -84], [18, -85], [-17, -73], [18, -61], [-3, -77], [4, -91]]];
export const obstacles = [];
function obstacle(x, z, w, d, y0, y1, mat = 'steel') {
  obstacles.push({x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0, y1, mat});
}
for (const [x, z, w, d, y] of cargo) obstacle(x, z, w, d, y, y + 2.62, 'steel');
for (const [kind, x, z, w, h, d] of props) obstacle(x, z, w, d, 0, h, kind === 'barrier' ? 'concrete' : kind === 'lift' ? 'steel' : 'wood');
for (const t of tankers) obstacle(t.x, t.z, t.w, t.d, 0, t.h, 'steel');
for (const c of craneSites) for (const dx of [-4.4, 4.4]) for (const dz of [-8, 8]) obstacle(c.x + dx * c.scale, c.z + dz * c.scale, 1.6 * c.scale, 2.9 * c.scale, 0, 8 * c.scale, 'steel');
for (let z = -94; z <= 96; z += 19) obstacle(-23.7, z, .9, 1.2, 0, .86, 'concrete');

// ============================================================================
// FlatDDA-BVH: Zero-GC SoA TypedArray Spatial Grid + 2D Amanatides-Woo DDA
// Eliminates 100% of Map/Set/Array allocations in visibility, ballistics & nav!
// ============================================================================
const CELL = 8;
const INV_CELL = 1 / CELL;
const N_OBS = obstacles.length;
const obsX0 = new Float64Array(N_OBS);
const obsX1 = new Float64Array(N_OBS);
const obsY0 = new Float64Array(N_OBS);
const obsY1 = new Float64Array(N_OBS);
const obsZ0 = new Float64Array(N_OBS);
const obsZ1 = new Float64Array(N_OBS);
const obsMat = new Array(N_OBS);

let minGX = Infinity, maxGX = -Infinity, minGZ = Infinity, maxGZ = -Infinity;
for (let i = 0; i < N_OBS; i++) {
  const o = obstacles[i];
  obsX0[i] = o.x0; obsX1[i] = o.x1;
  obsY0[i] = o.y0; obsY1[i] = o.y1;
  obsZ0[i] = o.z0; obsZ1[i] = o.z1;
  obsMat[i] = o.mat || 'steel';
  const x0 = Math.floor(o.x0 * INV_CELL), x1 = Math.floor(o.x1 * INV_CELL);
  const z0 = Math.floor(o.z0 * INV_CELL), z1 = Math.floor(o.z1 * INV_CELL);
  if (x0 < minGX) minGX = x0;
  if (x1 > maxGX) maxGX = x1;
  if (z0 < minGZ) minGZ = z0;
  if (z1 > maxGZ) maxGZ = z1;
}
const GX0 = minGX, GZ0 = minGZ;
const GW = maxGX - minGX + 1;
const GH = maxGZ - minGZ + 1;
const G_WORLD_X0 = GX0 * CELL, G_WORLD_X1 = (GX0 + GW) * CELL;
const G_WORLD_Z0 = GZ0 * CELL, G_WORLD_Z1 = (GZ0 + GH) * CELL;

// Build contiguous CSR flat cell table (zero Map lookups, L1 cache resident!)
const tempBuckets = Array.from({length: GW * GH}, () => []);
for (let i = 0; i < N_OBS; i++) {
  const ix0 = Math.floor(obsX0[i] * INV_CELL) - GX0;
  const ix1 = Math.floor(obsX1[i] * INV_CELL) - GX0;
  const iz0 = Math.floor(obsZ0[i] * INV_CELL) - GZ0;
  const iz1 = Math.floor(obsZ1[i] * INV_CELL) - GZ0;
  for (let iz = iz0; iz <= iz1; iz++) {
    const row = iz * GW;
    for (let ix = ix0; ix <= ix1; ix++) {
      tempBuckets[row + ix].push(i);
    }
  }
}
const cellOff = new Int32Array(GW * GH);
const cellCnt = new Uint16Array(GW * GH);
const cellMaxY = new Float32Array(GW * GH);
let totalRefs = 0;
for (let c = 0; c < tempBuckets.length; c++) {
  cellOff[c] = totalRefs;
  cellCnt[c] = tempBuckets[c].length;
  totalRefs += tempBuckets[c].length;
}
const cellData = new Int16Array(totalRefs);
for (let c = 0; c < tempBuckets.length; c++) {
  const b = tempBuckets[c];
  const off = cellOff[c];
  let maxY = -1e9;
  for (let k = 0; k < b.length; k++) {
    const idx = b[k];
    cellData[off + k] = idx;
    if (obsY1[idx] > maxY) maxY = obsY1[idx];
  }
  cellMaxY[c] = maxY;
}

// Monotonic stamp deduplicator (ZERO Set allocation!)
const obsStamp = new Uint32Array(N_OBS);
let curStamp = 1;
function nextStamp() {
  if (++curStamp === 0xffffffff) {
    obsStamp.fill(0);
    curStamp = 1;
  }
  return curStamp;
}

export function walkable(x, z, r = .41, feet = 0) {
  if (Math.abs(x) > 25 - r || Math.abs(z) > 100 - r) return false;
  let ix0 = Math.floor((x - r) * INV_CELL) - GX0;
  let ix1 = Math.floor((x + r) * INV_CELL) - GX0;
  let iz0 = Math.floor((z - r) * INV_CELL) - GZ0;
  let iz1 = Math.floor((z + r) * INV_CELL) - GZ0;
  if (ix1 < 0 || ix0 >= GW || iz1 < 0 || iz0 >= GH) return true;
  if (ix0 < 0) ix0 = 0;
  if (ix1 >= GW) ix1 = GW - 1;
  if (iz0 < 0) iz0 = 0;
  if (iz1 >= GH) iz1 = GH - 1;
  const r2 = r * r, head = feet + 1.7;
  // Single-cell fast path (no stamp needed!)
  if (ix0 === ix1 && iz0 === iz1) {
    const c = iz0 * GW + ix0;
    const off = cellOff[c], end = off + cellCnt[c];
    for (let k = off; k < end; k++) {
      const i = cellData[k];
      if (feet >= obsY1[i] - .018 || head <= obsY0[i]) continue;
      const cx = x < obsX0[i] ? obsX0[i] : (x > obsX1[i] ? obsX1[i] : x);
      const cz = z < obsZ0[i] ? obsZ0[i] : (z > obsZ1[i] ? obsZ1[i] : z);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r2) return false;
    }
    return true;
  }
  const st = nextStamp();
  for (let iz = iz0; iz <= iz1; iz++) {
    const row = iz * GW;
    for (let ix = ix0; ix <= ix1; ix++) {
      const c = row + ix;
      const off = cellOff[c], end = off + cellCnt[c];
      for (let k = off; k < end; k++) {
        const i = cellData[k];
        if (obsStamp[i] === st) continue;
        obsStamp[i] = st;
        if (feet >= obsY1[i] - .018 || head <= obsY0[i]) continue;
        const cx = x < obsX0[i] ? obsX0[i] : (x > obsX1[i] ? obsX1[i] : x);
        const cz = z < obsZ0[i] ? obsZ0[i] : (z > obsZ1[i] ? obsZ1[i] : z);
        const dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz < r2) return false;
      }
    }
  }
  return true;
}

export function floorAt(x, z, oldY) {
  let ix0 = Math.floor((x - .29) * INV_CELL) - GX0;
  let ix1 = Math.floor((x + .29) * INV_CELL) - GX0;
  let iz0 = Math.floor((z - .29) * INV_CELL) - GZ0;
  let iz1 = Math.floor((z + .29) * INV_CELL) - GZ0;
  if (ix1 < 0 || ix0 >= GW || iz1 < 0 || iz0 >= GH) return 0;
  if (ix0 < 0) ix0 = 0;
  if (ix1 >= GW) ix1 = GW - 1;
  if (iz0 < 0) iz0 = 0;
  if (iz1 >= GH) iz1 = GH - 1;
  const maxY = oldY + .04;
  let h = 0;
  if (ix0 === ix1 && iz0 === iz1) {
    const c = iz0 * GW + ix0;
    const off = cellOff[c], end = off + cellCnt[c];
    for (let k = off; k < end; k++) {
      const i = cellData[k];
      const y1 = obsY1[i];
      if (y1 > maxY || y1 <= h) continue;
      const cx = x < obsX0[i] ? obsX0[i] : (x > obsX1[i] ? obsX1[i] : x);
      const cz = z < obsZ0[i] ? obsZ0[i] : (z > obsZ1[i] ? obsZ1[i] : z);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz <= .0576) h = y1;
    }
    return h;
  }
  const st = nextStamp();
  for (let iz = iz0; iz <= iz1; iz++) {
    const row = iz * GW;
    for (let ix = ix0; ix <= ix1; ix++) {
      const c = row + ix;
      const off = cellOff[c], end = off + cellCnt[c];
      for (let k = off; k < end; k++) {
        const i = cellData[k];
        if (obsStamp[i] === st) continue;
        obsStamp[i] = st;
        const y1 = obsY1[i];
        if (y1 > maxY || y1 <= h) continue;
        const cx = x < obsX0[i] ? obsX0[i] : (x > obsX1[i] ? obsX1[i] : x);
        const cz = z < obsZ0[i] ? obsZ0[i] : (z > obsZ1[i] ? obsZ1[i] : z);
        const dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz <= .0576) h = y1;
      }
    }
  }
  return h;
}

export function surfaceAt(x, z, y) {
  if (y <= .08) return 'concrete';
  let ix0 = Math.floor((x - .34) * INV_CELL) - GX0;
  let ix1 = Math.floor((x + .34) * INV_CELL) - GX0;
  let iz0 = Math.floor((z - .34) * INV_CELL) - GZ0;
  let iz1 = Math.floor((z + .34) * INV_CELL) - GZ0;
  if (ix1 < 0 || ix0 >= GW || iz1 < 0 || iz0 >= GH) return 'steel';
  if (ix0 < 0) ix0 = 0;
  if (ix1 >= GW) ix1 = GW - 1;
  if (iz0 < 0) iz0 = 0;
  if (iz1 >= GH) iz1 = GH - 1;
  let best = 'steel', bestDiff = Infinity;
  const st = nextStamp();
  for (let iz = iz0; iz <= iz1; iz++) {
    const row = iz * GW;
    for (let ix = ix0; ix <= ix1; ix++) {
      const c = row + ix;
      const off = cellOff[c], end = off + cellCnt[c];
      for (let k = off; k < end; k++) {
        const i = cellData[k];
        if (obsStamp[i] === st) continue;
        obsStamp[i] = st;
        if (x < obsX0[i] - .28 || x > obsX1[i] + .28 || z < obsZ0[i] - .28 || z > obsZ1[i] + .28) continue;
        const diff = Math.abs(obsY1[i] - y);
        if (diff < .28 && diff < bestDiff) {
          bestDiff = diff;
          best = obsMat[i];
        }
      }
    }
  }
  return best;
}

// Precomputed-reciprocal scalar AABB slab registers (0 divisions inside obstacle loops, 0 GC!)
let _sEnter = 0, _sExit = 0, _sEnterAxis = -1, _sEnterSign = 0, _sExitAxis = -1, _sExitSign = 0;
let _rAx = 0, _rAy = 0, _rAz = 0, _rDx = 0, _rDy = 0, _rDz = 0;
let _rInvDx = 0, _rInvDy = 0, _rInvDz = 0;
let _rHasX = false, _rHasY = false, _rHasZ = false;

function prepRay(ax, ay, az, dx, dy, dz) {
  _rAx = ax; _rAy = ay; _rAz = az;
  _rDx = dx; _rDy = dy; _rDz = dz;
  _rHasX = dx > 1e-8 || dx < -1e-8;
  _rHasY = dy > 1e-8 || dy < -1e-8;
  _rHasZ = dz > 1e-8 || dz < -1e-8;
  _rInvDx = _rHasX ? 1 / dx : 0;
  _rInvDy = _rHasY ? 1 / dy : 0;
  _rInvDz = _rHasZ ? 1 / dz : 0;
}

function slabFullBox(x0, x1, y0, y1, z0, z1) {
  let enter = -Infinity, exit = Infinity, ea = -1, xa = -1, es = 0, xs = 0;
  if (_rHasX) {
    let p, q, s;
    if (_rDx > 0) { p = (x0 - _rAx) * _rInvDx; q = (x1 - _rAx) * _rInvDx; s = 1; }
    else          { p = (x1 - _rAx) * _rInvDx; q = (x0 - _rAx) * _rInvDx; s = -1; }
    if (p > enter) { enter = p; ea = 0; es = -s; }
    if (q < exit)  { exit = q;  xa = 0; xs = s; }
    if (enter > exit) return false;
  } else if (_rAx < x0 || _rAx > x1) return false;

  if (_rHasY) {
    let p, q, s;
    if (_rDy > 0) { p = (y0 - _rAy) * _rInvDy; q = (y1 - _rAy) * _rInvDy; s = 1; }
    else          { p = (y1 - _rAy) * _rInvDy; q = (y0 - _rAy) * _rInvDy; s = -1; }
    if (p > enter) { enter = p; ea = 1; es = -s; }
    if (q < exit)  { exit = q;  xa = 1; xs = s; }
    if (enter > exit) return false;
  } else if (_rAy < y0 || _rAy > y1) return false;

  if (_rHasZ) {
    let p, q, s;
    if (_rDz > 0) { p = (z0 - _rAz) * _rInvDz; q = (z1 - _rAz) * _rInvDz; s = 1; }
    else          { p = (z1 - _rAz) * _rInvDz; q = (z0 - _rAz) * _rInvDz; s = -1; }
    if (p > enter) { enter = p; ea = 2; es = -s; }
    if (q < exit)  { exit = q;  xa = 2; xs = s; }
    if (enter > exit) return false;
  } else if (_rAz < z0 || _rAz > z1) return false;

  if (exit <= 0 || enter > 1) return false;
  _sEnter = enter > 0 ? enter : 0;
  _sExit = exit;
  _sEnterAxis = ea; _sEnterSign = es;
  _sExitAxis = xa;  _sExitSign = xs;
  return true;
}

function slabEnterBox(x0, x1, y0, y1, z0, z1, limit) {
  let enter = -Infinity, exit = Infinity;
  if (_rHasX) {
    const t1 = (x0 - _rAx) * _rInvDx, t2 = (x1 - _rAx) * _rInvDx;
    if (t1 < t2) { if (t1 > enter) enter = t1; if (t2 < exit) exit = t2; }
    else         { if (t2 > enter) enter = t2; if (t1 < exit) exit = t1; }
    if (enter > exit || enter >= limit) return Infinity;
  } else if (_rAx < x0 || _rAx > x1) return Infinity;

  if (_rHasY) {
    const t1 = (y0 - _rAy) * _rInvDy, t2 = (y1 - _rAy) * _rInvDy;
    if (t1 < t2) { if (t1 > enter) enter = t1; if (t2 < exit) exit = t2; }
    else         { if (t2 > enter) enter = t2; if (t1 < exit) exit = t1; }
    if (enter > exit || enter >= limit) return Infinity;
  } else if (_rAy < y0 || _rAy > y1) return Infinity;

  if (_rHasZ) {
    const t1 = (z0 - _rAz) * _rInvDz, t2 = (z1 - _rAz) * _rInvDz;
    if (t1 < t2) { if (t1 > enter) enter = t1; if (t2 < exit) exit = t2; }
    else         { if (t2 > enter) enter = t2; if (t1 < exit) exit = t1; }
    if (enter > exit) return Infinity;
  } else if (_rAz < z0 || _rAz > z1) return Infinity;

  if (exit <= 0 || enter > 1) return Infinity;
  return enter > 0 ? enter : 0;
}

export function rayBoxSpan(a, b, o) {
  prepRay(a[0], a[1], a[2], b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (!slabFullBox(o.x0, o.x1, o.y0, o.y1, o.z0, o.z1)) return null;
  return {enter: _sEnter, exit: _sExit < 1 ? _sExit : 1};
}

export function rayBox(a, b, o) {
  prepRay(a[0], a[1], a[2], b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return slabEnterBox(o.x0, o.x1, o.y0, o.y1, o.z0, o.z1, Infinity);
}

const faceNormalOut = (axis, sign, out) => {
  out[0] = 0; out[1] = 0; out[2] = 0;
  out[axis < 0 ? 1 : axis] = axis < 0 ? 1 : sign;
  return out;
};

const deck = {x0: -25, x1: 25, y0: -3.1, y1: 0, z0: -100, z1: 100, mat: 'concrete'};

export function waterCrossing(a, b) {
  if (a[1] <= WATER_HEIGHT || b[1] > WATER_HEIGHT) return null;
  return (a[1] - WATER_HEIGHT) / (a[1] - b[1]);
}

// Zero-allocation 2D Amanatides-Woo DDA grid raycast with precomputed reciprocals & cellMaxY early-reject!
export function raycastMaterialOut(ax, ay, az, bx, by, bz, out) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  prepRay(ax, ay, az, dx, dy, dz);

  let nearest = Infinity, hitIdx = -2; // -2 = none, -1 = deck, >=0 = obstacle idx
  let hExit = Infinity, hEA = -1, hES = 0, hXA = -1, hXS = 0;

  if (!(ay >= 0 && (by > 0 || ay === by))) {
    if (slabFullBox(-25, 25, -3.1, 0, -100, 100)) {
      nearest = _sEnter;
      hitIdx = -1;
      hExit = _sExit; hEA = _sEnterAxis; hES = _sEnterSign; hXA = _sExitAxis; hXS = _sExitSign;
    }
  }

  const rayMinY = ay < by ? ay : by;
  const ixA = Math.floor(ax * INV_CELL) - GX0, izA = Math.floor(az * INV_CELL) - GZ0;
  const ixB = Math.floor(bx * INV_CELL) - GX0, izB = Math.floor(bz * INV_CELL) - GZ0;
  if (ixA === ixB && izA === izB) {
    if (ixA >= 0 && ixA < GW && izA >= 0 && izA < GH) {
      const c = izA * GW + ixA;
      const cnt = cellCnt[c];
      if (cnt > 0 && rayMinY <= cellMaxY[c]) {
        const off = cellOff[c], end = off + cnt;
        for (let k = off; k < end; k++) {
          const i = cellData[k];
          if (slabFullBox(obsX0[i], obsX1[i], obsY0[i], obsY1[i], obsZ0[i], obsZ1[i]) && _sEnter < nearest) {
            nearest = _sEnter; hitIdx = i;
            hExit = _sExit; hEA = _sEnterAxis; hES = _sEnterSign; hXA = _sExitAxis; hXS = _sExitSign;
          }
        }
      }
    }
  } else {
    let tMin = 0, tMax = nearest < 1 ? nearest : 1;
    let miss = false;
    if (Math.abs(dx) < 1e-12) {
      if (ax < G_WORLD_X0 || ax >= G_WORLD_X1) miss = true;
    } else {
      const inv = _rInvDx;
      let t1 = (G_WORLD_X0 - ax) * inv, t2 = (G_WORLD_X1 - ax) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) miss = true;
    }
    if (!miss) {
      if (Math.abs(dz) < 1e-12) {
        if (az < G_WORLD_Z0 || az >= G_WORLD_Z1) miss = true;
      } else {
        const inv = _rInvDz;
        let t1 = (G_WORLD_Z0 - az) * inv, t2 = (G_WORLD_Z1 - az) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) miss = true;
      }
    }

    if (!miss) {
      const sx = ax + dx * tMin, sz = az + dz * tMin;
      let ix = Math.floor(sx * INV_CELL) - GX0;
      let iz = Math.floor(sz * INV_CELL) - GZ0;
      if (ix < 0) ix = 0; else if (ix >= GW) ix = GW - 1;
      if (iz < 0) iz = 0; else if (iz >= GH) iz = GH - 1;
      const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
      const tDeltaX = stepX ? Math.abs(CELL * _rInvDx) : Infinity;
      const tDeltaZ = stepZ ? Math.abs(CELL * _rInvDz) : Infinity;
      let tMaxX = stepX > 0 ? (((GX0 + ix + 1) * CELL) - ax) * _rInvDx : stepX < 0 ? (((GX0 + ix) * CELL) - ax) * _rInvDx : Infinity;
      let tMaxZ = stepZ > 0 ? (((GZ0 + iz + 1) * CELL) - az) * _rInvDz : stepZ < 0 ? (((GZ0 + iz) * CELL) - az) * _rInvDz : Infinity;
      const st = nextStamp();
      const maxIter = GW + GH + 2;
      for (let iter = 0; iter < maxIter; iter++) {
        const c = iz * GW + ix;
        const cnt = cellCnt[c];
        if (cnt > 0 && rayMinY <= cellMaxY[c]) {
          const off = cellOff[c], end = off + cnt;
          for (let k = off; k < end; k++) {
            const i = cellData[k];
            if (obsStamp[i] === st) continue;
            obsStamp[i] = st;
            if (slabFullBox(obsX0[i], obsX1[i], obsY0[i], obsY1[i], obsZ0[i], obsZ1[i]) && _sEnter < nearest) {
              nearest = _sEnter; hitIdx = i;
              hExit = _sExit; hEA = _sEnterAxis; hES = _sEnterSign; hXA = _sExitAxis; hXS = _sExitSign;
              if (nearest < tMax) tMax = nearest;
            }
          }
        }
        if (tMaxX < tMaxZ) {
          if (tMaxX > tMax) break;
          ix += stepX;
          if (ix < 0 || ix >= GW) break;
          tMaxX += tDeltaX;
        } else {
          if (tMaxZ > tMax) break;
          iz += stepZ;
          if (iz < 0 || iz >= GH) break;
          tMaxZ += tDeltaZ;
        }
      }
    }
  }

  if (hitIdx === -2) return false;
  const px = ax + dx * nearest, py = ay + dy * nearest, pz = az + dz * nearest;
  const hitObj = hitIdx === -1 ? deck : obstacles[hitIdx];
  const hasExit = hitIdx !== -1 && Number.isFinite(hExit);
  out.t = nearest;
  out.tExit = hExit;
  out.point[0] = px; out.point[1] = py; out.point[2] = pz;
  faceNormalOut(hEA, hES, out.normal);
  if (hasExit) {
    const ex = ax + dx * hExit, ey = ay + dy * hExit, ez = az + dz * hExit;
    out._exitPt[0] = ex; out._exitPt[1] = ey; out._exitPt[2] = ez;
    out.exitPoint = out._exitPt;
    out.exitNormal = faceNormalOut(hXA, hXS, out._exitNrm);
    const tx = ex - px, ty = ey - py, tz = ez - pz;
    out.thickness = Math.sqrt(tx * tx + ty * ty + tz * tz);
  } else {
    out.exitPoint = null;
    out.exitNormal = null;
    out.thickness = Infinity;
  }
  out.mat = hitObj.mat || 'steel';
  out.box = hitObj;
  return true;
}

const _rayOutTmp = {
  t: 0, tExit: 0, point: [0, 0, 0], normal: [0, 1, 0],
  exitPoint: null, exitNormal: null, _exitPt: [0, 0, 0], _exitNrm: [0, 1, 0],
  thickness: Infinity, mat: 'steel', box: null
};

export function raycastMaterial(a, b) {
  if (!raycastMaterialOut(a[0], a[1], a[2], b[0], b[1], b[2], _rayOutTmp)) return null;
  const o = _rayOutTmp;
  return {
    t: o.t, tExit: o.tExit,
    point: [o.point[0], o.point[1], o.point[2]],
    normal: [o.normal[0], o.normal[1], o.normal[2]],
    exitPoint: o.exitPoint ? [o.exitPoint[0], o.exitPoint[1], o.exitPoint[2]] : null,
    exitNormal: o.exitNormal ? [o.exitNormal[0], o.exitNormal[1], o.exitNormal[2]] : null,
    thickness: o.thickness, mat: o.mat, box: o.box
  };
}

// Zero-allocation scalar visibility raycast (2D DDA + precomputed reciprocals + cellMaxY early-reject!)
export function obstructionCoords(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  prepRay(ax, ay, az, dx, dy, dz);
  let nearest = Infinity;
  if (!(ay >= 0 && (by > 0 || ay === by))) {
    const dt = slabEnterBox(-25, 25, -3.1, 0, -100, 100, Infinity);
    if (dt < nearest) nearest = dt;
  }

  const rayMinY = ay < by ? ay : by;
  const ixA = Math.floor(ax * INV_CELL) - GX0, izA = Math.floor(az * INV_CELL) - GZ0;
  const ixB = Math.floor(bx * INV_CELL) - GX0, izB = Math.floor(bz * INV_CELL) - GZ0;
  if (ixA === ixB && izA === izB) {
    if (ixA >= 0 && ixA < GW && izA >= 0 && izA < GH) {
      const c = izA * GW + ixA;
      const cnt = cellCnt[c];
      if (cnt > 0 && rayMinY <= cellMaxY[c]) {
        const off = cellOff[c], end = off + cnt;
        for (let k = off; k < end; k++) {
          const i = cellData[k];
          const t = slabEnterBox(obsX0[i], obsX1[i], obsY0[i], obsY1[i], obsZ0[i], obsZ1[i], nearest);
          if (t < nearest) nearest = t;
        }
      }
    }
    return nearest;
  }

  let tMin = 0, tMax = nearest < 1 ? nearest : 1;
  if (Math.abs(dx) < 1e-12) {
    if (ax < G_WORLD_X0 || ax >= G_WORLD_X1) return nearest;
  } else {
    const inv = _rInvDx;
    let t1 = (G_WORLD_X0 - ax) * inv, t2 = (G_WORLD_X1 - ax) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return nearest;
  }
  if (Math.abs(dz) < 1e-12) {
    if (az < G_WORLD_Z0 || az >= G_WORLD_Z1) return nearest;
  } else {
    const inv = _rInvDz;
    let t1 = (G_WORLD_Z0 - az) * inv, t2 = (G_WORLD_Z1 - az) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return nearest;
  }

  const sx = ax + dx * tMin, sz = az + dz * tMin;
  let ix = Math.floor(sx * INV_CELL) - GX0;
  let iz = Math.floor(sz * INV_CELL) - GZ0;
  if (ix < 0) ix = 0; else if (ix >= GW) ix = GW - 1;
  if (iz < 0) iz = 0; else if (iz >= GH) iz = GH - 1;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX ? Math.abs(CELL * _rInvDx) : Infinity;
  const tDeltaZ = stepZ ? Math.abs(CELL * _rInvDz) : Infinity;
  let tMaxX = stepX > 0 ? (((GX0 + ix + 1) * CELL) - ax) * _rInvDx : stepX < 0 ? (((GX0 + ix) * CELL) - ax) * _rInvDx : Infinity;
  let tMaxZ = stepZ > 0 ? (((GZ0 + iz + 1) * CELL) - az) * _rInvDz : stepZ < 0 ? (((GZ0 + iz) * CELL) - az) * _rInvDz : Infinity;
  const st = nextStamp();
  const maxIter = GW + GH + 2;
  for (let iter = 0; iter < maxIter; iter++) {
    const c = iz * GW + ix;
    const cnt = cellCnt[c];
    if (cnt > 0 && rayMinY <= cellMaxY[c]) {
      const off = cellOff[c], end = off + cnt;
      for (let k = off; k < end; k++) {
        const i = cellData[k];
        if (obsStamp[i] === st) continue;
        obsStamp[i] = st;
        const t = slabEnterBox(obsX0[i], obsX1[i], obsY0[i], obsY1[i], obsZ0[i], obsZ1[i], nearest);
        if (t < nearest) {
          nearest = t;
          if (nearest < tMax) tMax = nearest;
        }
      }
    }
    if (tMaxX < tMaxZ) {
      if (tMaxX > tMax) break;
      ix += stepX;
      if (ix < 0 || ix >= GW) break;
      tMaxX += tDeltaX;
    } else {
      if (tMaxZ > tMax) break;
      iz += stepZ;
      if (iz < 0 || iz >= GH) break;
      tMaxZ += tDeltaZ;
    }
  }
  return nearest;
}

export function obstruction(a, b) {
  return obstructionCoords(a[0], a[1], a[2], b[0], b[1], b[2]);
}

export function clearOpticalPath(a, b, aero) {
  return obstructionCoords(a[0], a[1], a[2], b[0], b[1], b[2]) > 1 &&
    !(aero?.stats.totalSmoke > 1.8 && aero.smokeOcclusion(a, b) > .86);
}

function penetrationDepth(x, z, r, feet) {
  let depth = 0;
  if (Math.abs(x) > 25 - r) depth += Math.abs(x) - (25 - r);
  if (Math.abs(z) > 100 - r) depth += Math.abs(z) - (100 - r);
  let ix0 = Math.floor((x - r) * INV_CELL) - GX0;
  let ix1 = Math.floor((x + r) * INV_CELL) - GX0;
  let iz0 = Math.floor((z - r) * INV_CELL) - GZ0;
  let iz1 = Math.floor((z + r) * INV_CELL) - GZ0;
  if (ix1 < 0 || ix0 >= GW || iz1 < 0 || iz0 >= GH) return depth;
  if (ix0 < 0) ix0 = 0;
  if (ix1 >= GW) ix1 = GW - 1;
  if (iz0 < 0) iz0 = 0;
  if (iz1 >= GH) iz1 = GH - 1;
  const head = feet + 1.7;
  const st = nextStamp();
  for (let iz = iz0; iz <= iz1; iz++) {
    const row = iz * GW;
    for (let ix = ix0; ix <= ix1; ix++) {
      const c = row + ix;
      const off = cellOff[c], end = off + cellCnt[c];
      for (let k = off; k < end; k++) {
        const i = cellData[k];
        if (obsStamp[i] === st) continue;
        obsStamp[i] = st;
        if (feet >= obsY1[i] - .018 || head <= obsY0[i]) continue;
        const cx = x < obsX0[i] ? obsX0[i] : (x > obsX1[i] ? obsX1[i] : x);
        const cz = z < obsZ0[i] ? obsZ0[i] : (z > obsZ1[i] ? obsZ1[i] : z);
        const dx = x - cx, dz = z - cz;
        const dist = Math.hypot(dx, dz);
        if (dist < r) depth += r - dist;
      }
    }
  }
  return depth;
}

const _depenIds = new Int16Array(64);
function depenetrate(a, r = .4) {
  const feet = a.y, head = feet + 1.7;
  for (let pass = 0; pass < 3; pass++) {
    const curPen = penetrationDepth(a.x, a.z, r, feet);
    if (curPen <= 1e-6) return;
    let bestPen = curPen, bestX = a.x, bestZ = a.z;
    let ix0 = Math.floor((a.x - r) * INV_CELL) - GX0;
    let ix1 = Math.floor((a.x + r) * INV_CELL) - GX0;
    let iz0 = Math.floor((a.z - r) * INV_CELL) - GZ0;
    let iz1 = Math.floor((a.z + r) * INV_CELL) - GZ0;
    if (ix0 < 0) ix0 = 0; if (ix1 >= GW) ix1 = GW - 1;
    if (iz0 < 0) iz0 = 0; if (iz1 >= GH) iz1 = GH - 1;
    let nCand = 0;
    const st = nextStamp();
    for (let iz = iz0; iz <= iz1; iz++) {
      const row = iz * GW;
      for (let ix = ix0; ix <= ix1; ix++) {
        const c = row + ix;
        const off = cellOff[c], end = off + cellCnt[c];
        for (let k = off; k < end; k++) {
          const i = cellData[k];
          if (obsStamp[i] === st) continue;
          obsStamp[i] = st;
          if (nCand < 64) _depenIds[nCand++] = i;
        }
      }
    }
    for (let n = 0; n < nCand; n++) {
      const i = _depenIds[n];
      if (feet >= obsY1[i] - .018 || head <= obsY0[i]) continue;
      const cx = clamp(a.x, obsX0[i], obsX1[i]), cz = clamp(a.z, obsZ0[i], obsZ1[i]);
      const dx = a.x - cx, dz = a.z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist >= r) continue;
      let nx, nz;
      if (dist > 1e-6) {
        const push = (r - dist) + .003;
        nx = clamp(a.x + (dx / dist) * push, -24.58, 24.58);
        nz = clamp(a.z + (dz / dist) * push, -99.58, 99.58);
      } else {
        const dL = a.x - obsX0[i], dR = obsX1[i] - a.x, dF = a.z - obsZ0[i], dB = obsZ1[i] - a.z;
        const m = Math.min(dL, dR, dF, dB);
        nx = a.x; nz = a.z;
        if (m === dL) nx = obsX0[i] - r - .003;
        else if (m === dR) nx = obsX1[i] + r + .003;
        else if (m === dF) nz = obsZ0[i] - r - .003;
        else nz = obsZ1[i] + r + .003;
        nx = clamp(nx, -24.58, 24.58);
        nz = clamp(nz, -99.58, 99.58);
      }
      const p = penetrationDepth(nx, nz, r, feet);
      if (p < bestPen - 1e-6) {
        bestPen = p; bestX = nx; bestZ = nz;
      }
    }
    if (bestPen < curPen - 1e-6) {
      a.x = bestX; a.z = bestZ;
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
