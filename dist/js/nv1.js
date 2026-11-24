import {clamp, mix, angleDiff, random} from './geometry.js';
import {walkable, obstruction, moveActor} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';
const STEP = 2, W = 25, H = 100, dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const position = i => [-24 + (i % W) * STEP, -99 + Math.floor(i / W) * STEP];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const CELLS_NAV = W * H;
const INV_STEP = 1 / STEP;

export class WharfNavigation {
  constructor() {
    this.W = W;
    this.H = H;
    this.open = new Uint8Array(CELLS_NAV);
    this.posX = new Float32Array(CELLS_NAV);
    this.posZ = new Float32Array(CELLS_NAV);
    this.links = Array.from({length: CELLS_NAV}, () => []);
    for (let i = 0; i < CELLS_NAV; i++) {
      const px = -24 + (i % W) * STEP;
      const pz = -99 + ((i / W) | 0) * STEP;
      this.posX[i] = px;
      this.posZ[i] = pz;
      this.open[i] = walkable(px, pz, .60) ? 1 : 0;
    }
    const linkDstList = [];
    const linkCostList = [];
    this.linkOff = new Int32Array(CELLS_NAV + 1);
    for (let i = 0; i < CELLS_NAV; i++) {
      this.linkOff[i] = linkDstList.length;
      if (!this.open[i]) continue;
      const x = i % W, z = (i / W) | 0;
      const px = this.posX[i], pz = this.posZ[i];
      for (const [dx, dz] of dirs) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nx >= W || nz < 0 || nz >= H) continue;
        const j = nx + nz * W;
        if (!this.open[j] || (dx && dz && (!this.open[nx + z * W] || !this.open[x + nz * W]))) continue;
        if (!this.clearCoords(px, pz, this.posX[j], this.posZ[j])) continue;
        const cost = dx && dz ? Math.SQRT2 : 1;
        this.links[i].push([j, cost]);
        linkDstList.push(j);
        linkCostList.push(cost);
      }
    }
    this.linkOff[CELLS_NAV] = linkDstList.length;
    this.linkDst = new Int16Array(linkDstList);
    this.linkCost = new Float32Array(linkCostList);

    // ZeroAlloc-AStar reusable scratch buffers (O(visited) stamp reset, zero per-query allocations!)
    this._back = new Int16Array(CELLS_NAV);
    this._costs = new Float32Array(CELLS_NAV);
    this._costStamp = new Uint32Array(CELLS_NAV);
    this._visStamp = new Uint32Array(CELLS_NAV);
    this._stampGen = 0;
    this._heapId = new Int16Array(CELLS_NAV * 2);
    this._heapCost = new Float32Array(CELLS_NAV * 2);
    this._rawIdx = new Int16Array(CELLS_NAV);
  }
  clearCoords(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const n = len > .72 ? Math.ceil(len / .72) : 1;
    const invN = 1 / n;
    for (let j = 1; j <= n; j++) {
      const f = j * invN;
      if (!walkable(ax + dx * f, az + dz * f, .52)) return false;
    }
    return true;
  }
  clear(a, b) {
    return this.clearCoords(a[0], a[1], b[0], b[1]);
  }
  closest(p) {
    const px = p[0], pz = p[1];
    const cx = clamp(Math.round((px + 24) * INV_STEP), 0, W - 1);
    const cz = clamp(Math.round((pz + 99) * INV_STEP), 0, H - 1);
    const center = cz * W + cx;
    // Fast O(1) path when the nearest grid cell itself is open (true >85% of queries!)
    if (this.open[center]) {
      const d0 = Math.hypot(this.posX[center] - px, this.posZ[center] - pz);
      if (d0 <= 1.0) return center;
    }
    let best = -1, score2 = Infinity, score = Infinity;
    const open = this.open, posX = this.posX, posZ = this.posZ;
    for (let r = 0; r < 9; r++) {
      const z0 = cz - r > 0 ? cz - r : 0;
      const z1 = cz + r < H - 1 ? cz + r : H - 1;
      const x0 = cx - r > 0 ? cx - r : 0;
      const x1 = cx + r < W - 1 ? cx + r : W - 1;
      for (let z = z0; z <= z1; z++) {
        const dzR = z > cz ? z - cz : cz - z;
        const row = z * W;
        for (let x = x0; x <= x1; x++) {
          const dxR = x > cx ? x - cx : cx - x;
          if ((dxR > dzR ? dxR : dzR) !== r) continue;
          const i = row + x;
          if (open[i]) {
            const dx = posX[i] - px, dz = posZ[i] - pz;
            const d2 = dx * dx + dz * dz;
            if (d2 < score2) {
              score2 = d2;
              score = Math.sqrt(d2);
              best = i;
            }
          }
        }
      }
      if (best >= 0 && r * STEP > score + 1) break;
    }
    return best;
  }
  route(from, to, traffic) {
    const start = this.closest(from), goal = this.closest(to);
    if (start < 0 || goal < 0) return [];
    const posX = this.posX, posZ = this.posZ;
    const endX = posX[goal], endZ = posZ[goal];
    if (this.clearCoords(from[0], from[1], endX, endZ)) return [[endX, endZ]];

    let gen = ++this._stampGen;
    if (gen === 0) {
      this._costStamp.fill(0);
      this._visStamp.fill(0);
      gen = this._stampGen = 1;
    }
    const back = this._back, costs = this._costs;
    const costStamp = this._costStamp, visStamp = this._visStamp;
    const linkOff = this.linkOff, linkDst = this.linkDst, linkCost = this.linkCost;
    const heapId = this._heapId, heapCost = this._heapCost;
    const hasTraffic = !!(traffic && traffic.size > 0);

    costs[start] = 0;
    costStamp[start] = gen;
    back[start] = -1;
    let heapLen = 1;
    heapId[0] = start;
    heapCost[0] = 0;

    while (heapLen > 0) {
      const u = heapId[0];
      heapLen--;
      if (heapLen > 0) {
        const lastId = heapId[heapLen];
        const lastC = heapCost[heapLen];
        let i = 0;
        while (true) {
          let c = (i << 1) + 1;
          if (c >= heapLen) break;
          if (c + 1 < heapLen && heapCost[c + 1] < heapCost[c]) c++;
          if (heapCost[c] >= lastC) break;
          heapId[i] = heapId[c];
          heapCost[i] = heapCost[c];
          i = c;
        }
        heapId[i] = lastId;
        heapCost[i] = lastC;
      }
      if (visStamp[u] === gen) continue;
      visStamp[u] = gen;
      if (u === goal) break;

      const cu = costs[u];
      const eStart = linkOff[u], eEnd = linkOff[u + 1];
      for (let ei = eStart; ei < eEnd; ei++) {
        const v = linkDst[ei];
        if (visStamp[v] === gen) continue;
        const g = cu + linkCost[ei] + (hasTraffic ? (traffic.get(v) || 0) : 0);
        if (costStamp[v] === gen && g >= costs[v]) continue;
        costs[v] = g;
        costStamp[v] = gen;
        back[v] = u;
        const f = g + Math.hypot(posX[v] - endX, posZ[v] - endZ) * INV_STEP;
        let hi = heapLen++;
        while (hi > 0) {
          const p = (hi - 1) >> 1;
          if (heapCost[p] <= f) break;
          heapId[hi] = heapId[p];
          heapCost[hi] = heapCost[p];
          hi = p;
        }
        heapId[hi] = v;
        heapCost[hi] = f;
      }
    }

    if (goal !== start && (costStamp[goal] !== gen || back[goal] < 0)) return [];
    const rawIdx = this._rawIdx;
    let rawLen = 0;
    rawIdx[rawLen++] = goal;
    for (let i = goal; i !== start && back[i] >= 0; i = back[i]) rawIdx[rawLen++] = back[i];

    // String-pull smoothing directly over reversed rawIdx (zero intermediate [x,z] array churn!)
    const path = [];
    let anchorX = from[0], anchorZ = from[1];
    let k = rawLen - 1;
    while (k >= 0) {
      let next = k;
      let steps = 0;
      while (next > 0 && steps < 8) {
        const ni = rawIdx[next - 1];
        if (!this.clearCoords(anchorX, anchorZ, posX[ni], posZ[ni])) break;
        next--;
        steps++;
      }
      const chosen = rawIdx[next];
      anchorX = posX[chosen];
      anchorZ = posZ[chosen];
      path.push([anchorX, anchorZ]);
      k = next - 1;
    }
    return path;
  }
}
let nav;
const profiles = [{lane: -13, pace: 5.2, nerve: .52, aim: .85}, {lane: 10, pace: 4.85, nerve: .36, aim: .77}, {lane: 1.5, pace: 5.55, nerve: .66, aim: .8}];
export class NV1 {
  constructor(match) {
    this.match = match;
    this.nav = nav ?? (nav = new WharfNavigation());
    this.brains = new Map();
    this.radio = [[], []];
    this.traffic = [new Map(), new Map()];
    this.trafficTime = 0;
    this.events = []
  }
  attach(a) {
    const rng = random(8581 + a.id * 9877 + a.deaths * 139);
    const b = {
      rng,
      profile: profiles[(a.slot + a.team) % 3],
      state: '巡回',
      sightAt: 0,
      planAt: 0,
      path: [],
      targetId: -1,
      seen: null,
      seenAt: -100,
      heard: null,
      heardAt: -100,
      triggerAt: 0,
      reactionAt: 0,
      aimUntil: 0,
      strafe: rng() < .5 ? -1 : 1,
      stepAt: 0,
      lastProgress: [a.x, a.z],
      progressAt: 0,
      waypoint: 0,
      vx: 0,
      vz: 0,
      aimX: 0,
      aimY: 0
    };
    b.sightAt = this.match.time + rng() * .24;
    this.brains.set(a.id, b)
  }
  sound(a) {
    this.events.push({x: a.x, z: a.z, team: a.team, time: this.match.time})
  }
  perceive(a, b) {
    const match = this.match, t = match.time, eye = eyeOf(a);
    let choice = null, best = -Infinity;
    for (const e of match.actors) {
      if (!e.alive || e.team === a.team || (e.shafferTimer || 0) > 0)continue;
      const dx = e.x - a.x, dz = e.z - a.z, range = Math.hypot(dx, dz), yaw = Math.atan2(dx, -dz);
      if (range > 92 || (range > 7 && Math.abs(angleDiff(yaw, a.yaw)) > (b.targetId === e.id ? 1.68 : 1.22)))continue;
      if (obstruction(eye, targetPoint(e)) < 1)continue;
      const score = 1 / (range + 6) + (e.id === b.targetId ? .010 : 0);
      if (score > best) {
        best = score;
        choice = e
      }
    }
    if (choice) {
      if (b.targetId !== choice.id || t - b.seenAt > 1)b.reactionAt = t + .19 + b.rng() * .44;
      b.targetId = choice.id;
      b.seen = {x: choice.x, z: choice.z, y: targetPoint(choice)[1] - 1.23, vx: choice.vx, vz: choice.vz};
      b.seenAt = t;
      const inbox = this.radio[a.team];
      if (!inbox.length || t - inbox.at(-1).t > .75)inbox.push({x: choice.x, z: choice.z, t});
      if (inbox.length > 8)inbox.shift()
    }
    const audible = this.events.findLast(e => e.team !== a.team && e.time > b.heardAt && Math.hypot(e.x - a.x, e.z - a.z) < 42);
    if (audible) {
      b.heard = [audible.x + (b.rng() - .5) * 8, audible.z + (b.rng() - .5) * 8];
      b.heardAt = audible.time
    }
    b.sightAt = t + .13 + b.rng() * .12
  }
  pickGoal(a, b) {
    const t = this.match.time, pr = b.profile, now = [a.x, a.z], dir = a.team === 0 ? -1 : 1;
    let goal;
    const fresh = t - b.seenAt < .45, range = b.seen ? Math.hypot(b.seen.x - a.x, b.seen.z - a.z) : Infinity;
    if (fresh && (a.mag === 0 || a.reload > 0 || a.hp < 35) && range < 42) {
      b.state = '退避';
      let best = -Infinity;
      for (let i = 0; i < 12; i++) {
        const angle = b.rng() * Math.PI * 2, r = 4 + b.rng() * 6, p = [a.x + Math.sin(angle) * r, a.z + Math.cos(angle) * r];
        if (!walkable(...p, .55))continue;
        const blocked = obstruction([p[0], 1.35, p[1]], [b.seen.x, b.seen.y + 1.36, b.seen.z]) < 1;
        const v = (blocked ? 10 : 0) + Math.hypot(p[0] - b.seen.x, p[1] - b.seen.z) * .15 - dist(now, p) * .13;
        if (v > best) {
          best = v;
          goal = p
        }
      }
    }
    if (!goal && fresh) {
      b.state = range > 39 ? '接近' : '交戦';
      const dx = (b.seen.x - a.x) / (range || 1), dz = (b.seen.z - a.z) / (range || 1);
      if (t > b.stepAt) {
        b.strafe = b.rng() < .5 ? -1 : 1;
        b.stepAt = t + 1.2 + b.rng() * 2.6
      }
      const adv = range > 39 ? Math.min(16, range - 25) : range < 9 ? -3 : 0, side = b.strafe * (2.8 + b.rng() * 2.9);
      goal = [a.x + dx * adv - dz * side, a.z + dz * adv + dx * side]
    }
    if (!goal && b.seen && t - b.seenAt < 5.5 && range > 3.2) {
      b.state = '追跡';
      goal = [b.seen.x, b.seen.z]
    }
    if (!goal && b.heard && t - b.heardAt < 3.5 && dist(now, b.heard) > 3) {
      b.state = '音を確認';
      goal = b.heard
    }
    const msg = this.radio[a.team].at(-1);
    if (!goal && msg && t - msg.t < 4 && Math.hypot(msg.x - a.x, msg.z - a.z) > 8) {
      b.state = '合流';
      goal = [msg.x + pr.lane * .27, msg.z - dir * 3]
    }
    if (!goal) {
      b.state = '巡回';
      const route = [[pr.lane, dir * -43], [pr.lane * .65 + 2, dir * -14], [pr.lane, dir * 18], [pr.lane * .45, dir * 48], [-pr.lane * .6, dir * 76], [-18, dir * 87], [16, dir * 91], [-pr.lane, dir * 27], [pr.lane * .7, -dir * 16]];
      if (b.waypoint === 0 && (a.z - route[0][1]) * dir > 0)b.waypoint = 1;
      goal = route[b.waypoint % route.length];
      if (dist(now, goal) < 4.0) {
        b.waypoint = (b.waypoint + 1) % route.length;
        goal = route[b.waypoint]
      }
    }
    goal = [clamp(goal[0], -23, 23), clamp(goal[1], -96, 96)];
    b.path = this.nav.route(now, goal, this.traffic[a.team]);
    b.planAt = t + (fresh ? .65 : 1.7) + b.rng() * .55;
  }
  tick(dt) {
    const t = this.match.time;
    this.events = this.events.filter(e => t - e.time < 1.7);
    if (t >= this.trafficTime) {
      this.traffic = [new Map(), new Map()];
      for (const a of this.match.actors) {
        if (!a.alive)continue;
        const i = this.nav.closest([a.x, a.z]);
        if (i >= 0)this.traffic[a.team].set(i, .85)
      }
      this.trafficTime = t + .55
    }
    for (const a of this.match.actors) {
      if (!a.alive || a.human || (this.teamFilter != null && a.team !== this.teamFilter))continue;
      const b = this.brains.get(a.id);
      if (!b) continue;
      if (t >= b.sightAt)this.perceive(a, b);
      if (t >= b.planAt)this.pickGoal(a, b);
      while (b.path.length && Math.hypot(b.path[0][0] - a.x, b.path[0][1] - a.z) < .63)b.path.shift();
      const pt = b.path[0];
      let dx = pt ? pt[0] - a.x : 0, dz = pt ? pt[1] - a.z : 0, L = Math.hypot(dx, dz);
      if (L) {
        dx /= L;
        dz /= L
      }
      for (const mate of this.match.actors) {
        if (mate === a || !mate.alive)continue;
        const sx = a.x - mate.x, sz = a.z - mate.z, d = Math.hypot(sx, sz);
        if (d > .005 && d < 1.36) {
          const v = (1.36 - d) * 1.4;
          dx += sx / d * v;
          dz += sz / d * v
        }
      }
      const speed = b.profile.pace * (b.state === '交戦' ? .57 : 1) * (a.paceFactor || 1),
        len = Math.max(1, Math.hypot(dx, dz)),
        ease = 1 - Math.exp(-7.6 * dt);
      b.vx = mix(b.vx, dx / len * speed, ease);
      b.vz = mix(b.vz, dz / len * speed, ease);
      const ox = a.x, oz = a.z;
      moveActor(a, b.vx * dt, b.vz * dt);
      a.vx = (a.x - ox) / dt;
      a.vz = (a.z - oz) / dt;
      a.stride += Math.hypot(a.vx, a.vz) * dt;
      if (t > b.progressAt) {
        if (pt && dist(b.lastProgress, [a.x, a.z]) < .28) {
          b.planAt = 0;
          b.strafe *= -1;
          if (!b.seen || t - b.seenAt > 6)b.waypoint++
        }
        b.lastProgress = [a.x, a.z];
        b.progressAt = t + 1.3
      }
      const aa = a.aa;
      const aaTracking = !!(aa?.locked && aa.level !== 'off' && aa.level !== '1.1');
      const scherpFireReady = !!(aa?.locked && aa.level === '1.5' && (aa.solveMode === 'direct' || aa.solveMode === 'pen' || aa.solveMode === 'bank'));
      const fresh = b.seen && t - b.seenAt < .39;
      let desiredYaw = a.yaw, desiredPitch = 0, range = 0;
      if (fresh) {
        const s = b.seen;
        range = Math.hypot(s.x - a.x, s.z - a.z);
        if (t > b.aimUntil) {
          const spread = (.17 + range * .012 + (1 - b.profile.aim)) * (1 - .29 * (a.aimPose || 0));
          b.aimX = (b.rng() + b.rng() - 1) * spread;
          b.aimY = (b.rng() + b.rng() - 1) * spread * .66;
          b.aimUntil = t + .33 + b.rng() * .22
        }
        const lead = range / this.match.weapon(a).speed * .62, xx = s.x + s.vx * lead + b.aimX - a.x, zz = s.z + s.vz * lead - a.z;
        desiredYaw = Math.atan2(xx, -zz);
        desiredPitch = Math.atan2(s.y + 1.1 + b.aimY - eyeOf(a)[1], Math.hypot(xx, zz))
      } else if (b.heard && t - b.heardAt < .7) {
        desiredYaw = Math.atan2(b.heard[0] - a.x, a.z - b.heard[1])
      } else if (pt) {
        desiredYaw = Math.atan2(dx, -dz)
      } else {
        desiredYaw += Math.sin(t * .8 + a.id) * .38 * dt
      }
      if (!aaTracking) {
        const turn = dt * (fresh ? 4.5 : 3.2);
        a.yaw += clamp(angleDiff(desiredYaw, a.yaw), -turn, turn);
        a.pitch = mix(a.pitch, desiredPitch, 1 - Math.exp(-9 * dt));
      }
      if ((scherpFireReady && t > b.triggerAt) || (fresh && t > b.reactionAt && t > b.triggerAt && (aaTracking || (Math.abs(angleDiff(desiredYaw, a.yaw)) < .085 && Math.abs(desiredPitch - a.pitch) < .09)))) {
        this.match.trigger(a);
        const w = this.match.weapon(a);
        b.triggerAt = t + (scherpFireReady ? w.interval * 1.02 : w.interval * (1.10 + b.rng() * .62) + (b.rng() > .83 ? .24 : 0))
      }
      if (a.mag === 0 || (!fresh && !scherpFireReady && a.mag < this.match.weapon(a).capacity * .46 && b.rng() < dt * .7))this.match.reload(a)
    }
  }
}
