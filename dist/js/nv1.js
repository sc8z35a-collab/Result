import {clamp, mix, angleDiff, random} from './geometry.js';
import {walkable, obstruction, moveActor} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';
const STEP = 2, W = 25, H = 100, dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const position = i => [-24 + (i % W) * STEP, -99 + Math.floor(i / W) * STEP];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
class Frontier {
  constructor() {
    this.a = []
  }
  add(id, cost) {
    const a = this.a;
    let i = a.length;
    a.push([id, cost]);
    while (i) {
      const p = (i - 1) >> 1;
      if (a[p][1] <= cost)break;
      a[i] = a[p];
      i = p
    }
    a[i] = [id, cost]
  }
  pop() {
    const a = this.a, result = a[0][0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && a[c + 1][1] < a[c][1])c++;
        if (a[c][1] >= last[1])break;
        a[i] = a[c];
        i = c
      }
      a[i] = last
    }
    return result
  }
}
export class WharfNavigation {
  constructor() {
    this.open = new Uint8Array(W * H);
    this.links = Array.from({length: W * H}, () => []);
    for (let i = 0; i < W * H; i++)this.open[i] = walkable(...position(i), .60) ? 1 : 0;
    for (let i = 0; i < W * H; i++) {
      if (!this.open[i])continue;
      const x = i % W, z = Math.floor(i / W), p = position(i);
      for (const [dx, dz] of dirs) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nx >= W || nz < 0 || nz >= H)continue;
        const j = nx + nz * W;
        if (!this.open[j] || (dx && dz && (!this.open[nx + z * W] || !this.open[x + nz * W])))continue;
        if (!this.clear(p, position(j)))continue;
        this.links[i].push([j, Math.hypot(dx, dz)])
      }
    }
  }
  clear(a, b) {
    const n = Math.max(1, Math.ceil(dist(a, b) / .72));
    for (let j = 1; j <= n; j++)if (!walkable(mix(a[0], b[0], j / n), mix(a[1], b[1], j / n), .52))return false;
    return true
  }
  closest(p) {
    const cx = clamp(Math.round((p[0] + 24) / STEP), 0, W - 1), cz = clamp(Math.round((p[1] + 99) / STEP), 0, H - 1);
    let best = -1, score = Infinity;
    for (let r = 0; r < 9; r++) {
      for (let z = Math.max(0, cz - r); z <= Math.min(H - 1, cz + r); z++)for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r)continue;
        const i = z * W + x;
        if (this.open[i]) {
          const d = dist(position(i), p);
          if (d < score) {
            score = d;
            best = i
          }
        }
      }
      if (best >= 0 && r * STEP > score + 1)break
    }
    return best
  }
  route(from, to, traffic) {
    const start = this.closest(from), goal = this.closest(to);
    if (start < 0 || goal < 0)return [];
    const end = position(goal);
    if (this.clear(from, end))return [end];
    const back = new Int16Array(W * H);
    back.fill(-1);
    const costs = new Float32Array(W * H);
    costs.fill(Infinity);
    const visited = new Uint8Array(W * H);
    const q = new Frontier();
    costs[start] = 0;
    q.add(start, 0);
    while (q.a.length) {
      const u = q.pop();
      if (visited[u])continue;
      visited[u] = 1;
      if (u === goal)break;
      for (const [v, edge] of this.links[u]) {
        if (visited[v])continue;
        const g = costs[u] + edge + (traffic?.get(v) ?? 0);
        if (g >= costs[v])continue;
        costs[v] = g;
        back[v] = u;
        q.add(v, g + dist(position(v), end) / STEP)
      }
    }
    if (goal !== start && back[goal] < 0)return [];
    const raw = [end];
    for (let i = goal; i !== start && back[i] >= 0; i = back[i])raw.push(position(back[i]));
    raw.reverse();
    const path = [];
    let anchor = from, index = 0;
    while (index < raw.length) {
      let next = index;
      while (next + 1 < raw.length && next - index < 8 && this.clear(anchor, raw[next + 1]))next++;
      anchor = raw[next];
      path.push(anchor);
      index = next + 1
    }
    return path
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
      if (!e.alive || e.team === a.team)continue;
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
      if (!a.alive || a.human)continue;
      const b = this.brains.get(a.id);
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
      const turn = dt * (fresh ? 4.5 : 3.2);
      a.yaw += clamp(angleDiff(desiredYaw, a.yaw), -turn, turn);
      a.pitch = mix(a.pitch, desiredPitch, 1 - Math.exp(-9 * dt));
      if (fresh && t > b.reactionAt && t > b.triggerAt && Math.abs(angleDiff(desiredYaw, a.yaw)) < .085 && Math.abs(desiredPitch - a.pitch) < .09) {
        this.match.trigger(a);
        b.triggerAt = t + this.match.weapon(a).interval * (1.10 + b.rng() * .62) + (b.rng() > .83 ? .24 : 0)
      }
      if (a.mag === 0 || (!fresh && a.mag < this.match.weapon(a).capacity * .46 && b.rng() < dt * .7))this.match.reload(a)
    }
  }
}
