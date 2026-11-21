import {NV12} from './nv12.js';
import {clamp, mix, angleDiff} from './geometry.js';
import {walkable, obstacles, obstruction, rayBox, moveActor, floorAt, tankers as mapTankers} from './yard.js';
import {eyeOf, targetPoint, postureStep, vertical} from './posture.js';

export const STEP = 2, W = 25, H = 100, CELLS = W * H;
export const cellX = i => -24 + (i % W) * STEP;
export const cellZ = i => -99 + ((i / W) | 0) * STEP;
export const cellOf = (x, z) => clamp(Math.round((z + 99) * .5), 0, H - 1) * W + clamp(Math.round((x + 24) * .5), 0, W - 1);
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const sigmoid = x => 1 / (1 + Math.exp(-clamp(x, -12, 12)));

export const lowCover = obstacles.filter(o => o.y0 === 0 && o.y1 > .53 && o.y1 <= 1.05 && o.x1 - o.x0 + o.z1 - o.z0 > 3.4);
const tallCover = obstacles.filter(o => o.y0 <= .1 && o.y1 >= 1.15 && (o.x1 - o.x0 >= .9 || o.z1 - o.z0 >= .9));
const DIRS8 = [[1, 0], [.707, .707], [0, 1], [-.707, .707], [-1, 0], [-.707, -.707], [0, -1], [.707, -.707]];

export const WEAPON_BAND = {
  'SW T': {min: 19, ideal: 35, max: 58, burstMax: 3, cap: 10},
  MS10: {min: 16, ideal: 31, max: 56, burstMax: 5, cap: 24},
  SRA: {min: 12, ideal: 23, max: 40, burstMax: 6, cap: 30},
  D1: {min: 7, ideal: 16, max: 29, burstMax: 4, cap: 40},
  'DF1 OUT': {min: 14, ideal: 26, max: 46, burstMax: 3, cap: 50},
  'DF40 II': {min: 12, ideal: 25, max: 48, burstMax: 6, cap: 260}
};

// Module-cached Prebaked Tactical Cover & Visibility Graph (computed once per harbor map, ~18 KB total).
let cachedGraph = null;
export function getTacticalGraph() {
  if (cachedGraph) return cachedGraph;
  const walkMask = new Uint8Array(CELLS);
  const walkableCells = [];
  for (let i = 0; i < CELLS; i++) {
    if (walkable(cellX(i), cellZ(i), .52)) {
      walkMask[i] = 1;
      walkableCells.push(i);
    }
  }
  const nodes = [];
  const raw = [];
  for (const o of tallCover) {
    const pad = .82;
    const cx = (o.x0 + o.x1) * .5, cz = (o.z0 + o.z1) * .5;
    const pts = [
      [o.x0 - pad, o.z0 - pad], [o.x1 + pad, o.z0 - pad],
      [o.x0 - pad, o.z1 + pad], [o.x1 + pad, o.z1 + pad],
      [cx, o.z0 - pad], [cx, o.z1 + pad],
      [o.x0 - pad, cz], [o.x1 + pad, cz]
    ];
    for (const [x, z] of pts) {
      if (!walkable(x, z, .52)) continue;
      raw.push([x, z]);
    }
  }
  // Deduplicate cover anchors with tactical spacing >= 3.1m for compact O(1) bitmatrix visibility.
  for (const [x, z] of raw) {
    let dup = false;
    for (const n of nodes) {
      if ((n.x - x) ** 2 + (n.z - z) ** 2 < 9.6) { dup = true; break; }
    }
    if (dup) continue;
    let coverMask = 0;
    const eye = [x, 1.38, z];
    for (let d = 0; d < 8; d++) {
      const [dx, dz] = DIRS8[d];
      if (obstruction(eye, [x + dx * 2.8, 1.38, z + dz * 2.8]) <= 1) coverMask |= (1 << d);
    }
    if (!coverMask) continue;
    const peeks = [];
    for (const [ox, oz] of [[1.85, 0], [-1.85, 0], [0, 1.85], [0, -1.85], [1.45, 1.45], [-1.45, 1.45], [1.45, -1.45], [-1.45, -1.45]]) {
      const px = x + ox, pz = z + oz;
      if (walkable(px, pz, .52) && obstruction(eye, [px, 1.38, pz]) > 1) {
        peeks.push([px, pz]);
        if (peeks.length >= 4) break;
      }
    }
    const tankerDists = mapTankers.map(tk => dist2(x, z, tk.x, tk.z));
    nodes.push({
      id: nodes.length,
      x, z,
      cell: cellOf(x, z),
      lane: x < -7 ? -1 : x > 7 ? 1 : 0,
      coverMask,
      peeks,
      tankerDists
    });
    if (nodes.length >= 160) break;
  }

  const N = nodes.length;
  const visStride = (N + 31) >>> 5;
  const visBits = new Uint32Array(N * visStride);
  for (let i = 0; i < N; i++) {
    const a = [nodes[i].x, 1.42, nodes[i].z];
    visBits[i * visStride + (i >>> 5)] |= (1 << (i & 31));
    for (let j = i + 1; j < N; j++) {
      const b = [nodes[j].x, 1.42, nodes[j].z];
      const d2 = (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2;
      if (d2 > 5400) continue; // >73m irrelevant for cover sightline bitmatrix
      if (obstruction(a, b) > 1) {
        visBits[i * visStride + (j >>> 5)] |= (1 << (j & 31));
        visBits[j * visStride + (i >>> 5)] |= (1 << (i & 31));
      }
    }
  }
  // Precompute nearest cover node per grid cell (2500 x Int16 = 5 KB) for O(1) spatial lookup!
  const cellToNode = new Int16Array(CELLS);
  for (let c = 0; c < CELLS; c++) {
    const cx = cellX(c), cz = cellZ(c);
    let best = -1, bestD2 = Infinity;
    for (let i = 0; i < N; i++) {
      const d2 = (nodes[i].x - cx) ** 2 + (nodes[i].z - cz) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    cellToNode[c] = best;
  }

  cachedGraph = {walkMask, walkableCells, nodes, N, visStride, visBits, cellToNode};
  return cachedGraph;
}

export function canSeeNode(g, i, j) {
  if (i < 0 || j < 0) return false;
  return ((g.visBits[i * g.visStride + (j >>> 5)] >>> (j & 31)) & 1) !== 0;
}

// Per-team cognitive & strategic state (zero-GC typed arrays for 120Hz POCO F7 headroom).
class TeamCognition {
  constructor(team, graph) {
    this.team = team;
    this.graph = graph;
    this.threat = new Float32Array(CELLS);
    this.deathHeat = new Float32Array(CELLS);
    this.allyCtrl = new Float32Array(CELLS);
    this.decayRow = 0;
    this.beliefs = new Map();
    this.profiles = new Map();
    this.lastCombatAt = 0;
    this.commanderAt = 0;
    this.playbook = 'STANDARD';
    this.primaryTargetId = -1;
    this.syncAttackAt = 0;
    this.roles = new Map();
    this.tankerTimers = mapTankers.map(() => 0);
  }

  ensureEnemy(id) {
    let bf = this.beliefs.get(id);
    if (!bf) {
      const prob = new Float32Array(CELLS);
      const scratch = new Float32Array(CELLS);
      const initZ = this.team === 0 ? -82 : 82;
      const c0 = cellOf(0, initZ);
      prob[c0] = 1;
      bf = {prob, scratch, peakX: 0, peakZ: initZ, peakCell: c0, conf: .18, lastSightAt: -20, vx: 0, vz: 0, diffRow: 0, deadUntil: -1};
      this.beliefs.set(id, bf);
    }
    let pr = this.profiles.get(id);
    if (!pr) {
      pr = {
        lanes: [1, 1, 1],
        aggression: .5,
        avgDist: 25,
        tankerGreed: .15,
        gun: 'SW T',
        shotsSinceReload: 0,
        lastShotAt: -10,
        reloadUntil: -10,
        exposedStart: -10
      };
      this.profiles.set(id, pr);
    }
    return {bf, pr};
  }

  stampField(field, x, z, radius, value, maxVal = 6) {
    const rCells = Math.ceil(radius / STEP);
    const cx = clamp(Math.round((x + 24) * .5), 0, W - 1);
    const cz = clamp(Math.round((z + 99) * .5), 0, H - 1);
    const r2 = radius * radius;
    const x0 = Math.max(0, cx - rCells), x1 = Math.min(W - 1, cx + rCells);
    const z0 = Math.max(0, cz - rCells), z1 = Math.min(H - 1, cz + rCells);
    for (let gz = z0; gz <= z1; gz++) {
      const dz = (gz - cz) * STEP;
      const row = gz * W;
      for (let gx = x0; gx <= x1; gx++) {
        const d2 = ((gx - cx) * STEP) ** 2 + dz * dz;
        if (d2 > r2) continue;
        const idx = row + gx;
        const w = 1 - Math.sqrt(d2) / radius;
        field[idx] = Math.min(maxVal, field[idx] + value * w);
      }
    }
  }

  collapseBelief(id, x, z, vx, vz, conf, t, sigma = 3.2) {
    const {bf, pr} = this.ensureEnemy(id);
    const rCells = Math.max(2, Math.ceil((sigma * 2.2) / STEP));
    const cx = clamp(Math.round((x + 24) * .5), 0, W - 1);
    const cz = clamp(Math.round((z + 99) * .5), 0, H - 1);
    const inv2s2 = .5 / (sigma * sigma);
    const prob = bf.prob;
    const keep = conf >= .9 ? .04 : .35;
    let sum = 0;
    for (let i = 0; i < CELLS; i++) {
      prob[i] *= keep;
      sum += prob[i];
    }
    const x0 = Math.max(0, cx - rCells), x1 = Math.min(W - 1, cx + rCells);
    const z0 = Math.max(0, cz - rCells), z1 = Math.min(H - 1, cz + rCells);
    const wm = this.graph.walkMask;
    for (let gz = z0; gz <= z1; gz++) {
      const dz = (gz - cz) * STEP, row = gz * W;
      for (let gx = x0; gx <= x1; gx++) {
        const idx = row + gx;
        if (!wm[idx]) continue;
        const d2 = ((gx - cx) * STEP) ** 2 + dz * dz;
        const add = Math.exp(-d2 * inv2s2) * (1 - keep + .4);
        prob[idx] += add;
        sum += add;
      }
    }
    if (sum > 1e-8) {
      const inv = 1 / sum;
      let bestI = cz * W + cx, bestP = -1;
      for (let i = 0; i < CELLS; i++) {
        const v = prob[i] * inv;
        prob[i] = v;
        if (v > bestP) { bestP = v; bestI = i; }
      }
      bf.peakCell = bestI;
      bf.peakX = cellX(bestI);
      bf.peakZ = cellZ(bestI);
    } else {
      bf.peakX = x;
      bf.peakZ = z;
      bf.peakCell = cellOf(x, z);
    }
    bf.conf = Math.max(bf.conf * .5, conf);
    bf.vx = vx;
    bf.vz = vz;
    if (conf >= .95) bf.lastSightAt = t;

    // Online lane bias learning
    const laneIdx = x < -7 ? 0 : x > 7 ? 2 : 1;
    pr.lanes[laneIdx] = pr.lanes[laneIdx] * .94 + .32;
    pr.lanes[(laneIdx + 1) % 3] *= .97;
    pr.lanes[(laneIdx + 2) % 3] *= .97;
  }

  // Negative observation: clear visible cells where enemy is NOT seen -> probability flows to unseen flank lanes!
  suppressVisible(origin, yaw, seenEnemyIds, t, obscured = () => false) {
    const wm = this.graph.walkMask;
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = Math.sin(yaw);
    const cleared = [];
    for (const angOff of [-.42, -.16, .16, .42]) {
      const ca = Math.cos(angOff), sa = Math.sin(angOff);
      const dx = fx * ca + rx * sa, dz = fz * ca + rz * sa;
      for (let dist = 6; dist <= 34; dist += 6) {
        const px = origin[0] + dx * dist, pz = origin[2] + dz * dist;
        if (Math.abs(px) > 24 || Math.abs(pz) > 98) break;
        const c = cellOf(px, pz);
        if (!wm[c]) break;
        const sample = [px, 1.38, pz];
        if (obstruction(origin, sample) <= 1 || obscured(sample)) break;
        cleared.push(c);
      }
    }
    if (!cleared.length) return;
    for (const [eid, bf] of this.beliefs) {
      if (seenEnemyIds.has(eid) || t - bf.lastSightAt < .45 || bf.deadUntil > t) continue;
      const prob = bf.prob;
      let removed = 0;
      for (let k = 0; k < cleared.length; k++) {
        const c = cleared[k];
        if (prob[c] > 1e-5) {
          removed += prob[c] * .88;
          prob[c] *= .12;
        }
      }
      if (removed > .005) {
        let sum = 0, bestI = bf.peakCell, bestP = -1;
        for (let i = 0; i < CELLS; i++) {
          const v = prob[i];
          sum += v;
          if (v > bestP) { bestP = v; bestI = i; }
        }
        if (sum > 1e-6) {
          const inv = 1 / sum;
          for (let i = 0; i < CELLS; i++) prob[i] *= inv;
          bf.peakCell = bestI;
          bf.peakX = cellX(bestI);
          bf.peakZ = cellZ(bestI);
        }
      }
    }
  }

  // Incremental time-sliced maintenance: decays influence maps & diffuses unseen beliefs without frame spikes.
  stepFields(t, dt) {
    // 1. Decay 25 rows of threat/allyCtrl/deathHeat per call (full map every 4 ticks -> ~0.01ms)
    const r0 = this.decayRow;
    const r1 = Math.min(H, r0 + 25);
    const threatMul = Math.exp(-dt * 4 * .24);
    const allyMul = Math.exp(-dt * 4 * .55);
    const deathMul = Math.exp(-dt * 4 * .018);
    for (let z = r0; z < r1; z++) {
      const row = z * W;
      for (let x = 0; x < W; x++) {
        const idx = row + x;
        this.threat[idx] *= threatMul;
        this.allyCtrl[idx] *= allyMul;
        this.deathHeat[idx] *= deathMul;
      }
    }
    this.decayRow = r1 >= H ? 0 : r1;

    // 2. Diffuse one enemy belief incrementally per step (20 rows per call)
    const wm = this.graph.walkMask;
    for (const bf of this.beliefs.values()) {
      if (t - bf.lastSightAt < .65 || bf.deadUntil > t) continue;
      bf.conf = Math.max(.08, bf.conf - dt * .055);
      const br0 = bf.diffRow, br1 = Math.min(H, br0 + 20);
      const prob = bf.prob, scr = bf.scratch;
      if (br0 === 0) scr.fill(0);
      const biasX = clamp(bf.vx * .12, -.35, .35), biasZ = clamp(bf.vz * .12, -.35, .35);
      for (let gz = br0; gz < br1; gz++) {
        const row = gz * W;
        for (let gx = 0; gx < W; gx++) {
          const i = row + gx;
          const p = prob[i];
          if (p < 1e-6) continue;
          scr[i] += p * .52;
          const spread = p * .12;
          if (gx > 0 && wm[i - 1]) scr[i - 1] += spread * (1 - biasX);
          else scr[i] += spread * (1 - biasX);
          if (gx < W - 1 && wm[i + 1]) scr[i + 1] += spread * (1 + biasX);
          else scr[i] += spread * (1 + biasX);
          if (gz > 0 && wm[i - W]) scr[i - W] += spread * (1 - biasZ);
          else scr[i] += spread * (1 - biasZ);
          if (gz < H - 1 && wm[i + W]) scr[i + W] += spread * (1 + biasZ);
          else scr[i] += spread * (1 + biasZ);
        }
      }
      bf.diffRow = br1 >= H ? 0 : br1;
      if (bf.diffRow === 0) {
        let sum = 0, bestI = bf.peakCell, bestP = -1;
        for (let i = 0; i < CELLS; i++) {
          const v = scr[i];
          sum += v;
          if (v > bestP) { bestP = v; bestI = i; }
        }
        if (sum > 1e-7) {
          const inv = 1 / sum;
          for (let i = 0; i < CELLS; i++) prob[i] = scr[i] * inv;
          bf.peakCell = bestI;
          bf.peakX = cellX(bestI);
          bf.peakZ = cellZ(bestI);
        }
      }
      break; // one enemy belief slice per tick to guarantee constant O(1) CPU budget
    }
  }

  dominantLane(enemyId) {
    const pr = this.profiles.get(enemyId);
    if (!pr) return 0;
    const tot = pr.lanes[0] + pr.lanes[1] + pr.lanes[2];
    if (tot < 3.8) return 0;
    if (pr.lanes[0] / tot > .46) return -1;
    if (pr.lanes[2] / tot > .46) return 1;
    if (pr.lanes[1] / tot > .48) return 0;
    return 0;
  }
}

// NV1.3 Pro — Ruthless On-Device 120Hz Tactical AI Engine.
// Architecture:
//   1. Prebaked Cover & O(1) Inter-Node Visibility Bitmatrix
//   2. Multi-Layer Zero-GC Influence Maps (Threat, Killbox DeathHeat, Friendly Control)
//   3. Fair-Play Bayesian Belief Grid with Negative Observation Deduction
//   4. Online Opponent Behavioral Profiler (Lane Bias, Aggression, MS10 Reload Counter, ARV1 Lock Breaker)
//   5. Squad Commander Playbook (Anchor / Flanker / Overwatch / Quartermaster, Sync Pincer, Bait-and-Trade)
//   6. HTN Plan Hysteresis x Continuous Utility AI + Suppressive Fire, Shoulder Bait & Ballistic Lead
export class NV13Pro extends NV12 {
  constructor(match) {
    super(match);
    this.graph = getTacticalGraph();
    this.teams = [new TeamCognition(0, this.graph), new TeamCognition(1, this.graph)];
    this.astarBudgetTick = -1;
    this.astarUsedThisTick = 0;
    this.tickSeq = 0;
    this.metrics = {
      ...this.metrics,
      crossfire: 0,
      suppress: 0,
      shoulderBait: 0,
      reloadHunt: 0,
      arvBreak: 0,
      beliefTrack: 0,
      baitTrade: 0,
      commanderOrders: 0
    };
  }

  attach(a) {
    super.attach(a);
    const b = this.brains.get(a.id);
    Object.assign(b, {
      role: 'ANCHOR',
      htnTask: 'ADVANCE',
      htnUntil: 0,
      target: null,
      lastPos: null,
      spread: clamp(1 - (b.profile?.aim ?? .82), .08, .28),
      strafeAt: 0,
      pose: {crouch: false, lean: 0, ads: false},
      exposedSince: -10,
      baitEndAt: -10,
      suppressUntil: -10,
      suppressPt: null,
      lastSeenTargetPos: null,
      lastSeenTargetAt: -10,
      burstCount: 0,
      burstPauseUntil: -10,
      peekEdgeSign: b.rng() < .5 ? -1 : 1,
      negObsAt: this.match.time + .2 + b.rng() * .25,
      flankNodeId: -1,
      coverNodeId: -1
    });
  }

  // Fair-play acoustic firearm triangulation + enemy MS10 / rifle shot counting for Reload Hunter!
  sound(actor) {
    super.sound(actor);
    const t = this.match.time;
    const opp = this.teams[1 - actor.team];
    const {pr} = opp.ensureEnemy(actor.id);
    pr.gun = actor.gun;
    if (t - pr.lastShotAt > 2.6) pr.shotsSinceReload = 0;
    pr.shotsSinceReload++;
    pr.lastShotAt = t;
    const cap = WEAPON_BAND[actor.gun]?.cap || 24;
    if (pr.shotsSinceReload >= cap) {
      pr.reloadUntil = t + 1.55;
      pr.shotsSinceReload = 0;
    }

    // Check if any enemy team member is within realistic acoustic earshot (<= 95m)
    let minD = Infinity;
    for (const a of this.match.actors) {
      if (!a.alive || a.team === actor.team) continue;
      const d = dist2(a.x, a.z, actor.x, actor.z);
      if (d < minD) minD = d;
    }
    if (minD <= 95) {
      const sigma = clamp(2.5 + minD * .09, 2.5, 9.5);
      opp.collapseBelief(actor.id, actor.x, actor.z, actor.vx || 0, actor.vz || 0, clamp(.88 - minD * .005, .42, .85), t, sigma);
      const gunThreat = actor.gun === 'MS10' ? 1.65 : actor.gun === 'DF1 OUT' ? 1.35 : 1.05;
      opp.stampField(opp.threat, actor.x, actor.z, 13, gunThreat, 5.5);
    }
  }

  onReload(actor) {
    const t = this.match.time;
    const opp = this.teams[1 - actor.team];
    let heard = false;
    for (const a of this.match.actors) {
      if (!a.alive || a.team === actor.team) continue;
      if (dist2(a.x, a.z, actor.x, actor.z) <= 26) { heard = true; break; }
    }
    if (heard) {
      const {pr} = opp.ensureEnemy(actor.id);
      pr.reloadUntil = t + (this.match.weapon(actor).reload || 1.6);
      pr.shotsSinceReload = 0;
    }
  }

  onTanker(actor, tk) {
    const t = this.match.time;
    for (const team of this.teams) {
      team.tankerTimers[tk.id] = t + tk.maxCooldown;
    }
    const opp = this.teams[1 - actor.team];
    const {pr} = opp.ensureEnemy(actor.id);
    pr.tankerGreed = Math.min(1, pr.tankerGreed + .32);
    // Tanker alarm & visual beacon pulse are global cues -> sharpen enemy Bayesian belief on tanker!
    opp.collapseBelief(actor.id, tk.x, tk.z, 0, 0, .92, t, 3.0);
    opp.stampField(opp.threat, tk.x, tk.z, 11, 1.3, 5.0);
  }

  onKill(owner, victim) {
    const t = this.match.time;
    const vTeam = this.teams[victim.team];
    vTeam.lastCombatAt = t;
    // Record killbox danger memory so squad stops feeding into the same death zone!
    vTeam.stampField(vTeam.deathHeat, victim.x, victim.z, 12, 2.4, 7.0);
    if (owner && owner.team !== victim.team) {
      vTeam.stampField(vTeam.threat, owner.x, owner.z, 14, 1.8, 6.0);
      vTeam.collapseBelief(owner.id, owner.x, owner.z, owner.vx || 0, owner.vz || 0, .86, t, 3.6);
    }
    const oTeam = this.teams[owner.team];
    oTeam.lastCombatAt = t;
    const {bf} = oTeam.ensureEnemy(victim.id);
    bf.deadUntil = t + 3.0;
    bf.conf = .05;
  }

  onHit(v, owner, dir, power) {
    super.onHit(v, owner, dir, power);
    const t = this.match.time;
    const team = this.teams[v.team];
    team.lastCombatAt = t;
    team.stampField(team.threat, v.x, v.z, 9, 1.2 + power * .08, 6.0);
    if (owner && owner.team !== v.team) {
      const {pr} = team.ensureEnemy(owner.id);
      pr.gun = owner.gun;
      const d = dist2(v.x, v.z, owner.x, owner.z);
      pr.avgDist = mix(pr.avgDist, d, .28);
      if (d < 18) pr.aggression = Math.min(1, pr.aggression + .12);
      else if (d > 34) pr.aggression = Math.max(0, pr.aggression - .08);
      team.collapseBelief(owner.id, owner.x, owner.z, owner.vx || 0, owner.vz || 0, .92, t, 3.0);
      team.stampField(team.threat, owner.x, owner.z, 12, owner.gun === 'MS10' ? 1.8 : 1.25, 6.0);
    }
    if (!v.human) {
      const b = this.brains.get(v.id);
      if (b && (v.hp < 68 || v.shield <= 0 || b.recentDamage >= 15)) {
        b.htnTask = 'SURVIVE_RESET';
        b.htnUntil = t + 1.5;
        b.planAt = 0;
        b.peekEdgeSign = -b.peekEdgeSign; // re-peek from the opposite corner next time!
      }
    }
  }

  // Team-level Squad Commander (runs at 2Hz per team): assigns roles, coordinates crossfire pincers & tanker control.
  runCommander(teamIdx) {
    const t = this.match.time;
    const cog = this.teams[teamIdx];
    const allies = [];
    const enemies = [];
    for (const a of this.match.actors) {
      if (!a.alive) continue;
      if (a.team === teamIdx) allies.push(a);
      else enemies.push(a);
    }
    const npcs = allies.filter(a => !a.human);
    if (!npcs.length) return;
    cog.roles.clear();

    // Pick highest-confidence / most dangerous primary enemy target using fair-play team beliefs!
    let primary = null, primaryScore = -Infinity, primaryPos = null;
    for (const e of enemies) {
      const {bf, pr} = cog.ensureEnemy(e.id);
      if (bf.deadUntil > t) continue;
      let minAllyD = Infinity;
      for (const a of allies) {
        const d = dist2(a.x, a.z, bf.peakX, bf.peakZ);
        if (d < minAllyD) minAllyD = d;
      }
      const sc = bf.conf * 55 + (e.gun === 'MS10' ? 14 : e.gun === 'DF1 OUT' ? 12 : 0)
        + (pr.reloadUntil > t ? 18 : 0) - minAllyD * .45;
      if (sc > primaryScore) {
        primaryScore = sc;
        primary = e;
        primaryPos = [bf.peakX, bf.peakZ, bf.conf];
      }
    }
    cog.primaryTargetId = primary ? primary.id : -1;

    // Anti-stalemate escalation check
    const quiet = t - cog.lastCombatAt;
    cog.playbook = quiet > 10 ? 'COORDINATED_SWEEP' : 'STANDARD';

    const assigned = new Set();

    // 1. QUARTERMASTER: pre-position for ready or soon-ready (<= 6s) supply tankers!
    let bestTk = null, bestQm = null, bestTkScore = 18;
    for (const tk of this.match.tankers || []) {
      const cd = Math.max(0, tk.cooldown);
      if (cd > 6.5) continue;
      for (const a of npcs) {
        if (a.hp < 50) continue;
        const d = dist2(a.x, a.z, tk.x, tk.z);
        const needAmmo = a.stock < 50 ? 34 : (a.ammoRate || 1) < 1.2 ? 22 : 6;
        const denyBonus = primary && (cog.profiles.get(primary.id)?.tankerGreed || 0) > .35 ? 14 : 0;
        const sc = needAmmo + denyBonus - d * .75 - cd * 2.2 - cog.threat[cellOf(tk.x, tk.z)] * 5;
        if (sc > bestTkScore) {
          bestTkScore = sc;
          bestTk = tk;
          bestQm = a;
        }
      }
    }
    if (bestQm && bestTk) {
      cog.roles.set(bestQm.id, {role: 'QUARTERMASTER', tankerId: bestTk.id});
      assigned.add(bestQm.id);
      cog.playbook = 'TANKER_CONTEST';
    }

    // 2. BAIT-AND-TRADE OVERWATCH: if an ally is hurt (< 58 HP) & retreating, assign healthy ally to cover them!
    const hurtAlly = allies.find(a => a.hp < 58 && a.alive);
    if (hurtAlly) {
      let bestGuard = null, bestGD = 38;
      for (const a of npcs) {
        if (assigned.has(a.id) || a.id === hurtAlly.id || a.hp < 65) continue;
        const d = dist2(a.x, a.z, hurtAlly.x, hurtAlly.z);
        if (d < bestGD) { bestGD = d; bestGuard = a; }
      }
      if (bestGuard) {
        cog.roles.set(bestGuard.id, {role: 'OVERWATCH', assistId: hurtAlly.id});
        assigned.add(bestGuard.id);
      }
    }

    // 3. ANCHOR + FLANKER (Synchronized Crossfire Pincer!)
    const remaining = npcs.filter(a => !assigned.has(a.id));
    if (remaining.length && primary && primaryPos) {
      // Anchor = healthiest close/mid-range fighter closest to enemy peak
      remaining.sort((u, v) => {
        const su = u.hp + u.shield * 1.4 - dist2(u.x, u.z, primaryPos[0], primaryPos[1]) * .45 + (u.gun === 'D1' || u.gun === 'SRA' ? 10 : 0);
        const sv = v.hp + v.shield * 1.4 - dist2(v.x, v.z, primaryPos[0], primaryPos[1]) * .45 + (v.gun === 'D1' || v.gun === 'SRA' ? 10 : 0);
        return sv - su;
      });
      const anchor = remaining.shift();
      cog.roles.set(anchor.id, {role: 'ANCHOR', targetId: primary.id});
      assigned.add(anchor.id);

      // Assign Flanker with O(1) Prebaked Crossfire Node selection (with hysteresis so flanker completes the pincer!).
      if (remaining.length) {
        const flanker = remaining.shift();
        const fb = this.brains.get(flanker.id);
        let crossNode = -1;
        if (fb && fb.flankNodeId >= 0 && fb.flankNodeId < this.graph.N) {
          const oldN = this.graph.nodes[fb.flankNodeId];
          const dtOld = dist2(oldN.x, oldN.z, primaryPos[0], primaryPos[1]);
          const anchorAng = Math.atan2(anchor.x - primaryPos[0], anchor.z - primaryPos[1]);
          const oldAng = Math.atan2(oldN.x - primaryPos[0], oldN.z - primaryPos[1]);
          const oldSep = Math.abs(angleDiff(oldAng, anchorAng));
          if (dtOld >= 7 && dtOld <= 48 && oldSep >= .55 && oldSep <= 2.55) crossNode = fb.flankNodeId;
        }
        if (crossNode < 0) crossNode = this.findCrossfireNode(flanker, anchor, primaryPos[0], primaryPos[1], cog);
        if (fb) fb.flankNodeId = crossNode;
        cog.roles.set(flanker.id, {role: 'FLANKER', targetId: primary.id, flankNodeId: crossNode, anchorId: anchor.id});
        assigned.add(flanker.id);
        cog.playbook = 'PINCER_ASSAULT';
        if (t > cog.syncAttackAt + .6) cog.syncAttackAt = t + 1.05;
        this.metrics.commanderOrders++;
      }
    }

    for (const a of remaining) {
      cog.roles.set(a.id, {role: 'OVERWATCH', targetId: primary ? primary.id : -1});
    }
  }

  // O(1) Prebaked Bitmatrix Crossfire Node Search: picks cover node 60°-130° off Anchor's bearing with clear LOS!
  findCrossfireNode(flanker, anchor, tx, tz, cog) {
    const g = this.graph;
    const tNode = g.cellToNode[cellOf(tx, tz)];
    const anchorAng = Math.atan2(anchor.x - tx, anchor.z - tz);
    const band = WEAPON_BAND[flanker.gun] || WEAPON_BAND['SW T'];
    let bestId = -1, bestScore = -Infinity;
    for (let i = 0; i < g.N; i++) {
      const n = g.nodes[i];
      const dt = dist2(n.x, n.z, tx, tz);
      if (dt < Math.max(8, band.min * .7) || dt > band.max * .95) continue;
      // Check crossfire angular separation from Anchor
      const ang = Math.atan2(n.x - tx, n.z - tz);
      const sep = Math.abs(angleDiff(ang, anchorAng));
      if (sep < .75 || sep > 2.45) continue; // ~43°..140° crossfire arc!
      const dSelf = dist2(n.x, n.z, flanker.x, flanker.z);
      if (dSelf > 48) continue;
      // Prefer nodes whose peek point or self can see enemy's area via O(1) prebaked bitmatrix
      const hasSight = tNode >= 0 && canSeeNode(g, i, tNode);
      const sepBonus = 1 - Math.abs(sep - 1.57) / 1.1; // peak at 90°!
      const sc = sepBonus * 26 + (hasSight ? 16 : 0) + (n.peeks.length ? 8 : 0)
        - Math.abs(dt - band.ideal) * .45 - dSelf * .55
        - cog.threat[n.cell] * 4.5 - cog.deathHeat[n.cell] * 4.0;
      if (sc > bestScore) { bestScore = sc; bestId = i; }
    }
    return bestId;
  }

  // Upgrade perception: integrates Bayesian Belief updates, Opponent Profiling, and Negative Observation!
  perceive(a, b, obscured = () => false, recognize = () => true) {
    const t = this.match.time;
    const cog = this.teams[a.team];
    const eye = eyeOf(a);
    const seenIds = new Set();

    // Stamp friendly control map
    cog.stampField(cog.allyCtrl, a.x, a.z, 10, .85, 3.0);

    for (const e of this.match.actors) {
      if (!e.alive || e.team === a.team) continue;
      const tp = targetPoint(e);
      const dx = e.x - a.x, dz = e.z - a.z, d = Math.hypot(dx, dz);
      const aimYaw = Math.atan2(dx, -dz);
      const fovDiff = Math.abs(angleDiff(a.yaw, aimYaw));
      const inView = b.spy ? d < 16 || (d < 86 && fovDiff < 1.72) : d < 12 || (d < 82 && fovDiff < 1.48);
      if (inView && obstruction(eye, tp) > 1 && !obscured(tp) && recognize(e)) {
        seenIds.add(e.id);
        b.contacts.set(e.id, {
          x: e.x, y: e.y, z: e.z, vx: e.vx || 0, vz: e.vz || 0,
          t, spawnId: e.spawnId, seen: true, gun: e.gun, hp: e.hp + e.shield
        });
        this.intel[a.team].set(e.id, {x: e.x, z: e.z, t, by: a.id});
        cog.collapseBelief(e.id, e.x, e.z, e.vx || 0, e.vz || 0, 1.0, t, 2.2);
        cog.lastCombatAt = Math.max(cog.lastCombatAt, t - 2);
        const gunThreat = e.gun === 'MS10' ? 1.55 : e.gun === 'DF1 OUT' ? 1.25 : 1.0;
        cog.stampField(cog.threat, e.x, e.z, 10, gunThreat * .6, 5.5);

        // Update online behavioral profile
        const {pr} = cog.ensureEnemy(e.id);
        pr.gun = e.gun;
        pr.avgDist = mix(pr.avgDist, d, .12);
        const closing = ((a.x - e.x) * (e.vx || 0) + (a.z - e.z) * (e.vz || 0)) / Math.max(1, d);
        if (closing > 1.8) pr.aggression = Math.min(1, pr.aggression + .05);
        else if (closing < -1.2) pr.aggression = Math.max(0, pr.aggression - .04);
        if (e.reload > .1) pr.reloadUntil = Math.max(pr.reloadUntil, t + e.reload);
      } else {
        const old = b.contacts.get(e.id);
        if (old) old.seen = false;
      }
    }

    // Periodic Negative Observation sweep -> shifts Bayesian mass to unseen flanks!
    if (t >= b.negObsAt) {
      cog.suppressVisible(eye, a.yaw, seenIds, t, obscured);
      b.negObsAt = t + .28 + b.rng() * .16;
    }

    // Expire dead/stale contacts
    for (const [id, c] of b.contacts) {
      const e = this.match.actors[id];
      if (!e?.alive || e.spawnId !== c.spawnId || t - c.t > 12) b.contacts.delete(id);
    }

    // Pick best target combining live contacts, squad intel, reload vulnerability, and threat priority!
    let best = null, bestScore = -Infinity, bestSeen = false;
    for (const e of this.match.actors) {
      if (!e.alive || e.team === a.team) continue;
      const c = b.contacts.get(e.id);
      const {bf, pr} = cog.ensureEnemy(e.id);
      const seen = !!(c?.seen);
      const known = seen || (c && t - c.t < 7.5) || (bf.conf > .34 && bf.deadUntil <= t);
      if (!known) continue;
      const tx = seen ? e.x : c ? c.x : bf.peakX;
      const tz = seen ? e.z : c ? c.z : bf.peakZ;
      const d = dist2(a.x, a.z, tx, tz);
      const band = WEAPON_BAND[a.gun] || WEAPON_BAND['SW T'];
      let sc = (seen ? 62 : bf.conf * 34) - Math.abs(d - band.ideal) * .42;
      if (c && c.hp < 45) sc += 26;
      if (e.id === cog.primaryTargetId) sc += 16; // Squad focus fire
      if (pr.reloadUntil > t) sc += 22; // Punish reloading enemy!
      if (c?.gun === 'MS10' || pr.gun === 'MS10') sc += 14;
      if (c?.gun === 'DF1 OUT' || pr.gun === 'DF1 OUT') sc += 12;
      if (seen) {
        const eFwdX = Math.sin(e.yaw), eFwdZ = -Math.cos(e.yaw);
        const toMe = ((a.x - e.x) * eFwdX + (a.z - e.z) * eFwdZ) / Math.max(1, d);
        if (toMe > .82) sc += 20; // Enemy aiming directly at us
      }
      if (sc > bestScore) { bestScore = sc; best = e; bestSeen = seen; }
    }

    b.target = best;
    b.targetId = best ? best.id : -1;
    b.seen = bestSeen && best ? {x: best.x, y: best.y, z: best.z, vx: best.vx || 0, vz: best.vz || 0} : null;
    if (best) {
      const c = b.contacts.get(best.id);
      const {bf} = cog.ensureEnemy(best.id);
      if (bestSeen) {
        b.lastPos = [best.x, best.z];
        b.lastSeenTargetPos = [best.x, best.y + 1.15, best.z];
        b.lastSeenTargetAt = t;
        b.seenAt = t;
        if (b.exposedSince < 0) b.exposedSince = t;
        if (best.id === cog.primaryTargetId) this.metrics.focusFire++;
      } else {
        b.exposedSince = -10;
        b.lastPos = c ? [c.x, c.z] : [bf.peakX, bf.peakZ];
        if (!c && bf.conf > .35) this.metrics.beliefTrack++;
      }
    } else {
      b.exposedSince = -10;
    }

    b.sightAt = t + (bestSeen ? .065 : .14) + b.rng() * .045;
  }

  // Influence-map weighted A* cost table (avoids live threat lanes AND killbox deathHeat!).
  tacticalWeights(a, b) {
    const weights = super.tacticalWeights(a, b);
    const cog = this.teams[a.team];
    const extraDanger = b.role === 'FLANKER' || b.htnTask === 'SURVIVE_RESET' ? 1.85 : 1.15;
    const ms10Alert = b.target?.gun === 'MS10' ? 1.45 : 1.0;
    // Only inject significant cells into weights map to keep A* ultra-fast
    const minZ = clamp(Math.floor((Math.min(a.z, b.planGoal?.[1] ?? a.z) - 24 + 99) * .5), 0, H - 1);
    const maxZ = clamp(Math.ceil((Math.max(a.z, b.planGoal?.[1] ?? a.z) + 24 + 99) * .5), 0, H - 1);
    for (let gz = minZ; gz <= maxZ; gz++) {
      const row = gz * W;
      for (let gx = 0; gx < W; gx++) {
        const i = row + gx;
        const pen = (cog.threat[i] * ms10Alert + cog.deathHeat[i] * .9) * extraDanger;
        if (pen > .35) weights.set(i, (weights.get(i) || 0) + pen * 1.4);
      }
    }
    return weights;
  }

  // Fast O(1)-filtered prebaked cover search with exact LOS verification for retreat OR peek-skirmish.
  findProCover(a, b, threats, mode = 'retreat') {
    const g = this.graph;
    const cog = this.teams[a.team];
    const band = WEAPON_BAND[a.gun] || WEAPON_BAND['SW T'];
    const maxSearchD = mode === 'retreat' ? 30 : 34;
    const primary = threats[0];
    const pNode = primary ? g.cellToNode[cellOf(primary.x, primary.z)] : -1;

    let best = null, bestScore = -Infinity;
    for (let i = 0; i < g.N; i++) {
      const n = g.nodes[i];
      const dSelf = dist2(a.x, a.z, n.x, n.z);
      if (dSelf > maxSearchD) continue;
      // Fast O(1) bitmatrix pre-filter before expensive exact raycasts!
      if (mode === 'retreat' && pNode >= 0 && canSeeNode(g, i, pNode)) continue;

      let hiddenFromAll = true;
      let minThreatD = Infinity;
      for (const th of threats) {
        const td = dist2(n.x, n.z, th.x, th.z);
        if (td < minThreatD) minThreatD = td;
        if (obstruction([n.x, 1.38, n.z], [th.x, 1.42, th.z]) > 1) {
          hiddenFromAll = false;
          break;
        }
      }
      if (!hiddenFromAll) continue;

      let sc = 30 - dSelf * .85 - cog.threat[n.cell] * 5.2 - cog.deathHeat[n.cell] * 5.0 + cog.allyCtrl[n.cell] * 2.2;
      let bestPeek = null;
      if (mode === 'retreat') {
        sc += clamp(minThreatD, 0, 34) * .85;
        if (minThreatD < 9) sc -= 28;
        // Prefer retreating toward friendly Overwatcher (Bait-and-Trade!)
        for (const ally of this.match.actors) {
          if (!ally.alive || ally.team !== a.team || ally.id === a.id) continue;
          const ad = dist2(n.x, n.z, ally.x, ally.z);
          if (ad > 4 && ad < 22) sc += 9;
        }
      } else if (primary) {
        // Pick a pre-verified peek offset (preferring alternating edge sign so human players can't pre-fire us!)
        for (const [px, pz] of n.peeks) {
          if (obstruction([px, 1.42, pz], [primary.x, 1.42, primary.z]) > 1) {
            bestPeek = [px, pz];
            const sideMatch = ((px - n.x) * b.peekEdgeSign) >= 0;
            if (sideMatch) break;
          }
        }
        if (!bestPeek) continue;
        sc += 28 - Math.abs(minThreatD - band.ideal) * 1.05;
        if (minThreatD < band.min * .78) sc -= 18;
        if (minThreatD > band.max) sc -= (minThreatD - band.max) * 1.4;
      }

      if (sc > bestScore) {
        bestScore = sc;
        best = {nodeId: i, x: n.x, z: n.z, peek: bestPeek || [n.x, n.z]};
      }
    }
    return best;
  }

  // Hybrid HTN + Continuous Utility Decision Engine!
  pickGoal(a, b) {
    const t = this.match.time;
    const cog = this.teams[a.team];
    const now = [a.x, a.z];
    const order = cog.roles.get(a.id) || {role: 'ANCHOR'};
    b.role = order.role;

    const threats = this.activeThreats(a, b);
    const primary = threats[0] || null;
    const target = b.target;
    const targetPr = target ? cog.profiles.get(target.id) : null;
    const targetBf = target ? cog.beliefs.get(target.id) : null;
    const effHp = a.hp + a.shield * 1.55;
    const underFire = t - b.underFireAt < 1.3;
    const band = WEAPON_BAND[a.gun] || WEAPON_BAND['SW T'];
    const targetDist = primary ? dist2(a.x, a.z, primary.x, primary.z) : 99;

    // 1. Continuous Utility Scoring for each HTN Task
    const multiThreat = threats.length >= 2 ? 1 : 0;
    const ms10Threat = primary?.gun === 'MS10' ? 1 : 0;
    const uSurvive = sigmoid((68 - effHp) / 14) * (1 + .35 * multiThreat + .30 * ms10Threat)
      + (b.recentDamage >= 17 ? .42 : 0)
      + ((a.reload > .15 || a.mag === 0) && (b.seen || underFire) ? .55 : 0)
      + (a.shield <= 0 && a.hp < 82 && underFire ? .35 : 0);

    const enemyReloading = !!(targetPr && targetPr.reloadUntil > t + .25 && targetDist < 38);
    const uReloadHunt = enemyReloading && effHp > 62 && a.mag >= 4 && a.reload <= 0 ? .84 : 0;

    let tankerObj = null;
    if (order.role === 'QUARTERMASTER' && order.tankerId >= 0) {
      tankerObj = this.match.tankers?.[order.tankerId] || null;
    } else if (a.stock < 42 || ((a.ammoRate || 1) < 1.2 && !b.seen)) {
      tankerObj = this.findSupplyTanker(a, b, threats);
    }
    const uTanker = tankerObj && effHp > 52
      ? (order.role === 'QUARTERMASTER' ? .76 : a.stock < 35 ? .82 : .56) - cog.threat[cellOf(tankerObj.x, tankerObj.z)] * .08
      : 0;

    const uFlank = order.role === 'FLANKER' && order.flankNodeId >= 0 && effHp > 58 && a.mag >= 4
      ? .74 : 0;

    const uBaitTrade = order.role === 'OVERWATCH' && order.assistId >= 0 && effHp > 60
      ? .66 : 0;

    const uSkirmish = primary && effHp > 46 ? .68 : 0;

    // Pick highest utility task with hysteresis (except critical survive interrupt!)
    let chosen = 'SWEEP';
    if (uSurvive >= .72) {
      chosen = 'SURVIVE_RESET';
    } else if (t < b.htnUntil && b.htnTask && b.htnTask !== 'SWEEP' && uSurvive < .58) {
      chosen = b.htnTask;
    } else {
      const cands = [
        ['RELOAD_HUNTER', uReloadHunt],
        ['TANKER_CONTROL', uTanker],
        ['SYNC_FLANK', uFlank],
        ['BAIT_TRADE', uBaitTrade],
        ['TACTICAL_SKIRMISH', uSkirmish]
      ];
      let bestU = .44;
      for (const [name, u] of cands) {
        if (u > bestU) { bestU = u; chosen = name; }
      }
    }

    let goal = null;
    if (chosen === 'SURVIVE_RESET') {
      const cov = threats.length ? this.findProCover(a, b, threats, 'retreat') : null;
      if (cov) {
        b.cover = {x: cov.x, z: cov.z, peek: cov.peek};
        b.coverNodeId = cov.nodeId;
        goal = [cov.x, cov.z];
        const atCov = dist2(a.x, a.z, cov.x, cov.z) < 1.45;
        b.state = atCov ? '態勢立て直し' : '戦術退避';
        b.peekPhase = 'hide';
        b.peekSwitchAt = t + (a.reload > 0 ? a.reload + .25 : 1.05);
        if (b.prevState !== '戦術退避' && b.prevState !== '態勢立て直し') this.metrics.disengage++;
        b.prevState = b.state;
        if (a.mag < this.match.weapon(a).capacity * .65 && a.stock > 0 && a.reload <= 0) this.match.reload(a);
      } else if (primary) {
        const ang = Math.atan2(a.x - primary.x, a.z - primary.z);
        goal = [a.x + Math.sin(ang) * 12, a.z + Math.cos(ang) * 12];
        b.state = '戦術退避';
      }
      b.htnTask = 'SURVIVE_RESET';
      b.htnUntil = t + 1.25;
    } else if (chosen === 'RELOAD_HUNTER' && primary) {
      // Enemy is reloading (e.g. MS10 empty mag) -> decisive aggression to secure elimination!
      const ang = Math.atan2(primary.x - a.x, primary.z - a.z);
      const step = Math.min(10, Math.max(4, targetDist - band.min));
      goal = [a.x + Math.sin(ang) * step, a.z + Math.cos(ang) * step];
      b.state = 'リロード狩り';
      b.peekPhase = 'peek';
      if (b.prevState !== 'リロード狩り') this.metrics.reloadHunt++;
      b.prevState = b.state;
      b.htnTask = 'RELOAD_HUNTER';
      b.htnUntil = t + 1.1;
    } else if (chosen === 'TANKER_CONTROL' && tankerObj) {
      const dTk = dist2(a.x, a.z, tankerObj.x, tankerObj.z);
      if (tankerObj.cooldown <= 1.2 || dTk > 9) {
        goal = [tankerObj.x, tankerObj.z];
        b.state = '補給確保';
      } else {
        // Wait in nearest cover until tanker finishes recharging, then claim immediately!
        const cov = threats.length ? this.findProCover(a, b, threats, 'retreat') : null;
        goal = cov ? [cov.x, cov.z] : [tankerObj.x + 3.8, tankerObj.z];
        b.state = '補給確保';
      }
      if (b.prevState !== '補給確保') this.metrics.resupply++;
      b.prevState = b.state;
      b.htnTask = 'TANKER_CONTROL';
      b.htnUntil = t + 1.4;
    } else if (chosen === 'SYNC_FLANK' && order.flankNodeId >= 0) {
      const fn = this.graph.nodes[order.flankNodeId];
      const dNode = dist2(a.x, a.z, fn.x, fn.z);
      if (dNode > 3.6) {
        goal = [fn.x, fn.z];
        b.state = '連携側面展開';
      } else {
        // Arrived at crossfire node! Sync peek with Anchor pressure!
        const peekPt = fn.peeks[0] || [fn.x, fn.z];
        const readyToPeek = t >= cog.syncAttackAt || b.seen;
        goal = readyToPeek ? peekPt : [fn.x, fn.z];
        b.state = 'クロスファイア';
        b.peekPhase = readyToPeek ? 'peek' : 'hide';
        if (b.prevState !== 'クロスファイア') this.metrics.crossfire++;
      }
      if (b.prevState !== '連携側面展開' && b.prevState !== 'クロスファイア') this.metrics.flank++;
      b.prevState = b.state;
      b.htnTask = 'SYNC_FLANK';
      b.htnUntil = t + 1.4;
    } else if (chosen === 'BAIT_TRADE' && order.assistId >= 0) {
      const ally = this.match.actors[order.assistId];
      if (ally?.alive) {
        const coverList = primary ? [primary] : [];
        const cov = coverList.length ? this.findProCover(a, b, coverList, 'skirmish') : null;
        goal = cov ? [cov.x, cov.z] : [ally.x + (a.x >= ally.x ? 5 : -5), ally.z + (a.team === 0 ? 6 : -6)];
        b.state = 'カバー援護';
        if (b.prevState !== 'カバー援護') this.metrics.baitTrade++;
        b.prevState = b.state;
        b.htnTask = 'BAIT_TRADE';
        b.htnUntil = t + 1.3;
      }
    } else if (chosen === 'TACTICAL_SKIRMISH' && primary) {
      const cov = this.findProCover(a, b, threats, 'skirmish');
      const covDistToTarget = cov ? dist2(cov.x, cov.z, primary.x, primary.z) : Infinity;
      const tooFarForWeapon = targetDist > band.max * 1.08 && covDistToTarget > band.max * 1.08;
      if (tooFarForWeapon) {
        // Bounding tactical advance from cover-to-cover toward effective weapon range!
        let fwdCov = null, bestFwd = -Infinity;
        for (let i = 0; i < this.graph.N; i++) {
          const n = this.graph.nodes[i];
          const dSelf = dist2(a.x, a.z, n.x, n.z);
          if (dSelf < 4 || dSelf > 32) continue;
          const dT = dist2(n.x, n.z, primary.x, primary.z);
          if (dT >= targetDist - 4) continue;
          const sc = (targetDist - dT) * 1.4 - dSelf * .35 - cog.threat[n.cell] * 4 - cog.deathHeat[n.cell] * 4 + (n.peeks.length ? 4 : 0);
          if (sc > bestFwd) { bestFwd = sc; fwdCov = n; }
        }
        if (fwdCov) {
          goal = [fwdCov.x, fwdCov.z];
          b.coverNodeId = fwdCov.id;
          b.state = '前進展開';
          if (b.prevState !== '前進展開' && b.prevState !== '遮蔽移動') this.metrics.cover++;
        } else {
          const ang = Math.atan2(primary.x - a.x, primary.z - a.z);
          const perp = ang + b.flankSide * Math.PI * .34;
          const step = Math.min(20, Math.max(10, targetDist - band.ideal));
          goal = [a.x + Math.sin(ang) * step * .82 + Math.sin(perp) * 5.5, a.z + Math.cos(ang) * step * .82 + Math.cos(perp) * 5.5];
          b.state = '前進展開';
        }
        b.peekPhase = 'peek';
        b.prevState = b.state;
        b.htnTask = 'TACTICAL_SKIRMISH';
        b.htnUntil = t + .85;
      } else if (cov) {
        b.cover = {x: cov.x, z: cov.z, peek: cov.peek};
        b.coverNodeId = cov.nodeId;
        const dCov = dist2(a.x, a.z, cov.x, cov.z);
        const vsDF1 = primary.gun === 'DF1 OUT';
        const vsMS10 = primary.gun === 'MS10';
        if (dCov > 3.2) {
          goal = [cov.x, cov.z];
          b.state = '遮蔽移動';
          if (b.prevState !== '遮蔽移動' && b.prevState !== '遮蔽交戦') this.metrics.cover++;
        } else {
          // Anti-predictable jiggle peek + ARV1 lock break (<0.34s) + Shoulder Bait!
          if (t >= b.peekSwitchAt) {
            if (b.peekPhase === 'peek') {
              b.peekPhase = 'hide';
              b.peekSwitchAt = t + (vsDF1 ? .42 : vsMS10 ? .64 : .52) + b.rng() * .34;
              b.peekEdgeSign = -b.peekEdgeSign;
            } else {
              // 28% chance: rapid Shoulder Bait to draw enemy shots before real peek!
              if (b.rng() < .28 && !vsDF1) {
                b.peekPhase = 'bait';
                b.peekSwitchAt = t + .18;
                this.metrics.shoulderBait++;
              } else {
                b.peekPhase = 'peek';
                const peekDur = vsDF1 ? .31 : vsMS10 ? .66 : .78 + b.rng() * .42;
                b.peekSwitchAt = t + peekDur;
              }
            }
          }
          // Force immediate duck if exposed >= 0.33s against DF1 OUT (breaks 0.42s ARV1 lock!)
          if (vsDF1 && b.exposedSince > 0 && t - b.exposedSince >= .33 && b.peekPhase === 'peek') {
            b.peekPhase = 'hide';
            b.peekSwitchAt = t + .44;
            this.metrics.arvBreak++;
          }
          if (b.peekPhase === 'peek') {
            goal = cov.peek;
            b.state = 'ピーク射撃';
          } else if (b.peekPhase === 'bait') {
            goal = [mix(cov.x, cov.peek[0], .55), mix(cov.z, cov.peek[1], .55)];
            b.state = 'ショルダーベイト';
          } else {
            goal = [cov.x, cov.z];
            b.state = '遮蔽交戦';
          }
        }
        b.prevState = b.state;
        b.htnTask = 'TACTICAL_SKIRMISH';
        b.htnUntil = t + .95;
      } else {
        // Fallback open skirmish spacing
        const ang = Math.atan2(primary.x - a.x, primary.z - a.z);
        const perp = ang + b.flankSide * Math.PI * .5;
        const rad = targetDist < band.min ? -7 : targetDist > band.max ? 12 : 0;
        goal = [a.x + Math.sin(ang) * rad + Math.sin(perp) * 6, a.z + Math.cos(ang) * rad + Math.cos(perp) * 6];
        b.state = '機動交戦';
        b.peekPhase = 'peek';
        b.prevState = b.state;
      }
    }

    // 7. COUNTER_AMBUSH / BAYESIAN BELIEF SWEEP (never stalls, hunts unseen flanks via belief peak!)
    if (!goal) {
      // Find highest-confidence Bayesian belief across all alive enemies
      let bestBf = null, bestBfId = -1, bestConf = .22;
      for (const e of this.match.actors) {
        if (!e.alive || e.team === a.team) continue;
        const bf = cog.beliefs.get(e.id);
        if (bf && bf.deadUntil <= t && bf.conf > bestConf) {
          bestConf = bf.conf;
          bestBf = bf;
          bestBfId = e.id;
        }
      }
      if (bestBf && cog.playbook !== 'COORDINATED_SWEEP') {
        const dPeak = dist2(a.x, a.z, bestBf.peakX, bestBf.peakZ);
        const domLane = cog.dominantLane(bestBfId);
        // If enemy is aggressive & within 26m, set a short counter-ambush pre-aiming their approach!
        const pr = cog.profiles.get(bestBfId);
        if (dPeak < 28 && dPeak > 10 && pr && pr.aggression > .56 && t > b.ambushCooldown) {
          const cov = this.findProCover(a, b, [{x: bestBf.peakX, z: bestBf.peakZ, gun: pr.gun}], 'retreat');
          if (cov) {
            goal = [cov.x, cov.z];
            b.ambushYaw = Math.atan2(bestBf.peakX - cov.x, -(bestBf.peakZ - cov.z));
            b.ambushUntil = t + 2.2;
            b.ambushCooldown = t + 7.5;
            b.state = '予測待ち伏せ';
            if (b.prevState !== '予測待ち伏せ') this.metrics.ambush++;
            b.prevState = b.state;
          }
        }
        if (!goal) {
          // Advance tactically toward Bayesian belief peak (biased toward opponent's dominant lane)
          const gx = mix(bestBf.peakX, domLane * 14, domLane !== 0 ? .22 : 0);
          goal = [gx, bestBf.peakZ];
          b.state = 'ベイズ追跡';
          b.prevState = b.state;
          this.metrics.beliefTrack++;
        }
      } else {
        // Coordinated full-wharf sector sweep (covers enemy spawn corridors so matches never stalemate!)
        const dir = a.team === 0 ? -1 : 1;
        const lane = (a.id % 3 - 1) * 14;
        const route = [
          [lane, dir * 16],
          [lane * .7, dir * 56],
          [lane * .4, dir * 85],
          [14, dir * 86],
          [-14, dir * 86],
          [-lane * .8, dir * 32],
          [lane * .5, -dir * 12]
        ];
        if (b.waypoint === 0 && (a.z - route[0][1]) * dir > 0) b.waypoint = 1;
        goal = route[b.waypoint % route.length];
        if (dist2(a.x, a.z, goal[0], goal[1]) < 4.8) {
          b.waypoint = (b.waypoint + 1) % route.length;
          goal = route[b.waypoint];
        }
        b.state = '戦術掃討';
        b.prevState = b.state;
      }
      b.htnTask = 'SWEEP';
      b.htnUntil = t + .9;
    }

    goal = [clamp(goal[0], -23, 23), clamp(goal[1], -96, 96)];
    b.planGoal = goal;

    // Time-sliced A* pathfinding budget (max 1 full A* per 120Hz tick when non-urgent -> silky 120 FPS!)
    const urgent = chosen === 'SURVIVE_RESET' || b.path.length === 0;
    if (urgent || this.astarUsedThisTick < 1) {
      const weights = this.tacticalWeights(a, b);
      b.path = this.nav.route(now, goal, weights);
      this.astarUsedThisTick++;
    }

    // Low-cover parkour vaulting for agile flanking
    if (b.vault && t < b.vault.until) {
      b.path = [[b.vault.x, b.vault.z], ...b.path.slice(0, 1)];
    } else {
      b.vault = null;
    }
    if (!b.vault && b.path.length && a.onGround && t - b.jumpAt > 4.2 && b.state !== '態勢立て直し' && b.state !== '予測待ち伏せ') {
      const endGoal = b.path.at(-1), dx = endGoal[0] - a.x, dz = endGoal[1] - a.z, len = Math.hypot(dx, dz);
      if (len > 3.3) {
        const dVec = [dx / len, dz / len];
        for (const o of lowCover) {
          const end = [a.x + dVec[0] * 4.6, .46, a.z + dVec[1] * 4.6], start = [a.x, .46, a.z];
          const enter = rayBox(start, end, o);
          if (enter < .19 || enter > .72 || !walkable(end[0], end[2], .52) || obstruction([a.x, 1.31, a.z], [end[0], 1.31, end[2]]) < 1) continue;
          b.vault = {x: end[0], z: end[2], until: t + 1.35};
          b.path.unshift([end[0], end[2]]);
          break;
        }
      }
    }

    b.planAt = t + (chosen === 'SURVIVE_RESET' || b.seen ? .42 : .95) + b.rng() * .32;
  }

  choosePose(a, b) {
    const base = super.choosePose(a, b);
    const t = this.match.time;
    const crouching = base.crouch
      || b.state === '態勢立て直し'
      || b.state === '予測待ち伏せ'
      || b.state === 'カバー援護'
      || (b.state === '遮蔽交戦' && b.peekPhase === 'hide')
      || t < b.crouchFeintUntil;
    const ads = base.ads
      || ((b.state === '予測待ち伏せ' || b.state === 'ピーク射撃' || b.state === 'クロスファイア') && a.reload <= 0);
    return {crouch: crouching && !b.vault && a.onGround, lean: base.lean, ads};
  }

  tick(dt) {
    const t = this.match.time;
    this.tickSeq++;
    this.astarUsedThisTick = 0;
    this.events = this.events.filter(e => t - e.time < 2.2);

    // 1. Time-sliced Influence Map & Bayesian Belief Grid maintenance (alternating team each tick)
    this.teams[this.tickSeq & 1].stepFields(t, dt * 2);

    // 2. Squad Commander strategic update (2Hz staggered per team)
    for (let ti = 0; ti < 2; ti++) {
      if (t >= this.teams[ti].commanderAt) {
        this.runCommander(ti);
        this.teams[ti].commanderAt = t + .48 + ti * .07;
      }
    }

    if (t >= this.trafficTime) {
      this.traffic = [new Map(), new Map()];
      for (const a of this.match.actors) {
        if (!a.alive) continue;
        const i = this.nav.closest([a.x, a.z]);
        if (i >= 0) this.traffic[a.team].set(i, .95);
      }
      this.trafficTime = t + .45;
    }

    for (const a of this.match.actors) {
      if (!a.alive || a.human) continue;
      const b = this.brains.get(a.id);

      if (t - b.damageClock > 1.55) b.recentDamage = Math.max(0, b.recentDamage - dt * 19);

      this.detectIncoming(a, b);
      if (t >= b.sightAt) this.perceive(a, b);
      if (t >= b.planAt) this.pickGoal(a, b);

      if (t >= b.motionAt) {
        b.pose = this.choosePose(a, b);
        b.motionAt = t + .085 + b.rng() * .045;
      }
      const p = b.pose || {crouch: false, lean: 0, ads: false};
      if (b.vault && a.onGround && t - b.jumpAt > 3 && dist2(b.vault.x, b.vault.z, a.x, a.z) < 3.55) {
        a.vy = 6.35;
        a.onGround = false;
        b.jumpAt = t;
        this.metrics.jump++;
      }
      const newPhase = !a.onGround ? '跳躍' : Math.abs(p.lean) > .15 ? '覗き' : p.crouch ? 'しゃがみ' : p.ads ? '照準' : '歩行';
      if (newPhase !== b.phase) {
        if (newPhase === 'しゃがみ') this.metrics.crouch++;
        if (newPhase === '覗き') this.metrics.peek++;
        if (newPhase === '照準') this.metrics.scope++;
        b.phase = newPhase;
      }
      postureStep(a, dt, p.crouch && a.onGround, p.lean, p.ads);
      const sprinting = b.state === '戦術退避' || b.state === '連携側面展開' || b.state === 'リロード狩り' || b.state === '補給確保' || b.state === '前進展開';
      a.paceFactor = b.vault ? 1.14 : sprinting ? 1.18 : 1 - a.crouch * .35 - a.aimPose * .09;
      vertical(a, dt, floorAt);

      while (b.path.length && dist2(b.path[0][0], b.path[0][1], a.x, a.z) < .65) b.path.shift();
      const pt = b.path[0];
      let dx = pt ? pt[0] - a.x : 0, dz = pt ? pt[1] - a.z : 0, L = Math.hypot(dx, dz);
      if (L) { dx /= L; dz /= L; }

      // Tactical strafing & incoming-fire perpendicular dodge
      if (b.seen && b.target && b.state !== '戦術退避' && b.state !== '態勢立て直し' && b.state !== '予測待ち伏せ') {
        if (t >= b.strafeAt) {
          b.strafe = b.rng() < .5 ? -1 : 1;
          b.strafeAt = t + .42 + b.rng() * .52;
        }
        const toX = b.target.x - a.x, toZ = b.target.z - a.z, td = Math.hypot(toX, toZ) || 1;
        const sx = -toZ / td * b.strafe, sz = toX / td * b.strafe;
        const w = L ? .42 : .86;
        dx = dx * (1 - w) + sx * w;
        dz = dz * (1 - w) + sz * w;
      } else if (t - b.underFireAt < .5 && b.threatDir) {
        const px = -b.threatDir[1] * b.flankSide, pz = b.threatDir[0] * b.flankSide;
        dx = dx * .52 + px * .48;
        dz = dz * .52 + pz * .48;
      }

      // Personal space separation so squadmates maintain clean crossfire lines and never clump
      for (const mate of this.match.actors) {
        if (mate === a || !mate.alive) continue;
        const sx = a.x - mate.x, sz = a.z - mate.z, d = Math.hypot(sx, sz);
        const minSep = mate.team === a.team ? 2.1 : 1.35;
        if (d > .005 && d < minSep) {
          const v = (minSep - d) * 1.4;
          dx += sx / d * v;
          dz += sz / d * v;
        }
      }

      const norm = Math.hypot(dx, dz);
      if (norm > .01) { dx /= norm; dz /= norm; }
      const speed = (b.state === '態勢立て直し' || b.state === '予測待ち伏せ' ? (L > .5 ? 2.6 : 0) : 4.58) * a.paceFactor;
      const e = 1 - Math.exp(-11.5 * dt);
      a.vx += (dx * speed - a.vx) * e;
      a.vz += (dz * speed - a.vz) * e;
      const ox = a.x, oz = a.z;
      moveActor(a, a.vx * dt, a.vz * dt);
      a.stride += Math.hypot(a.x - ox, a.z - oz);

      // Ballistic Lead Aiming + Pre-Aiming + Suppressive Fire!
      let wantYaw = norm > .05 ? Math.atan2(dx, -dz) : a.yaw;
      let wantPitch = 0;
      const eye = eyeOf(a);
      const wpn = this.match.weapon(a);
      const band = WEAPON_BAND[a.gun] || WEAPON_BAND['SW T'];
      let aimTargetPos = null;
      let suppressMode = false;

      if (b.seen && b.target) {
        const tp = targetPoint(b.target);
        const dist = Math.hypot(tp[0] - eye[0], tp[1] - eye[1], tp[2] - eye[2]);
        // True ballistic travel-time velocity lead (especially crisp for MS10 & SW T!)
        const leadT = clamp(dist / Math.max(80, wpn.speed), 0, .42);
        aimTargetPos = [
          tp[0] + (b.target.vx || 0) * leadT,
          tp[1] + (b.target.vy || 0) * leadT * .35,
          tp[2] + (b.target.vz || 0) * leadT
        ];
        const rx = aimTargetPos[0] - eye[0], ry = aimTargetPos[1] - eye[1], rz = aimTargetPos[2] - eye[2];
        wantYaw = Math.atan2(rx, -rz);
        wantPitch = clamp(Math.atan2(ry, Math.hypot(rx, rz)), -.75, .75);
      } else if (b.lastSeenTargetPos && t - b.lastSeenTargetAt > .12 && t - b.lastSeenTargetAt < .72
        && b.role === 'ANCHOR' && a.mag >= wpn.capacity * .4 && a.reload <= 0
        && b.state !== '戦術退避' && b.state !== '態勢立て直し') {
        // Suppressive fire on cover edge where enemy just ducked (pins enemy while Flanker moves!)
        aimTargetPos = b.lastSeenTargetPos;
        const rx = aimTargetPos[0] - eye[0], ry = aimTargetPos[1] - eye[1], rz = aimTargetPos[2] - eye[2];
        wantYaw = Math.atan2(rx, -rz);
        wantPitch = clamp(Math.atan2(ry, Math.hypot(rx, rz)), -.75, .75);
        suppressMode = true;
      } else if (b.state === '予測待ち伏せ' && t < b.ambushUntil) {
        wantYaw = b.ambushYaw;
      } else if (b.lastPos) {
        // Pre-aim toward highest Bayesian belief / last contact corridor while moving!
        wantYaw = Math.atan2(b.lastPos[0] - a.x, -(b.lastPos[1] - a.z));
      }

      const turnRate = (b.seen ? 9.6 : 6.4) * (1 - a.aimPose * .10);
      a.yaw += clamp(angleDiff(wantYaw, a.yaw), -turnRate * dt, turnRate * dt);
      a.pitch += clamp(wantPitch - a.pitch, -6.5 * dt, 6.5 * dt);

      // Tactical Reload Discipline (reload behind cover whenever safe and magazine < 45%)
      if (a.reload <= 0 && a.stock > 0 && (a.mag === 0 || (!b.seen && a.mag < wpn.capacity * .45 && b.state !== 'リロード狩り'))) {
        this.match.reload(a);
      }

      // Trigger Discipline + Range-Controlled Bursting + Suppressive Fire!
      const canShootSeen = b.seen && b.target && b.peekPhase !== 'bait';
      if ((canShootSeen || suppressMode) && a.mag > 0 && a.reload <= 0 && a.cooldown <= 0 && !a.burstLeft && t >= b.burstPauseUntil) {
        const d = aimTargetPos ? Math.hypot(aimTargetPos[0] - eye[0], aimTargetPos[2] - eye[2]) : 25;
        const align = Math.abs(angleDiff(wantYaw, a.yaw));
        const tol = (suppressMode ? .14 : .085 + (d < 14 ? .06 : 0)) * (1 + b.spread * .45);
        const maxEngageD = Math.max(70, band.max * 1.4);
        if (align < tol && d < maxEngageD) {
          // Human-like subtle aim jitter (tighter when crouching/ADS or with MS10/SW T)
          const jitter = (.010 + b.spread * .018) * (1 - a.crouch * .32 - a.aimPose * .22) * (a.gun === 'MS10' ? .82 : 1);
          const saveY = a.yaw, saveP = a.pitch;
          a.yaw += (b.rng() - .5) * jitter;
          a.pitch = clamp(a.pitch + (b.rng() - .5) * jitter * .65, -1.2, 1.2);
          if (this.match.trigger(a)) {
            b.burstCount++;
            if (suppressMode) {
              this.metrics.suppress++;
              b.burstPauseUntil = t + .32;
            } else if (a.gun === 'MS10' && d > 26 && b.burstCount >= 4) {
              // Controlled 4-round precision bursts at long range with MS10
              b.burstCount = 0;
              b.burstPauseUntil = t + .18;
            } else if (b.burstCount >= band.burstMax && d > 18) {
              b.burstCount = 0;
              b.burstPauseUntil = t + .14;
            }
          }
          a.yaw = saveY;
          a.pitch = saveP;
        }
      } else if (!canShootSeen && !suppressMode) {
        b.burstCount = 0;
      }
    }
  }
}
