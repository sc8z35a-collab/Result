import {NV1} from './nv1.js';
import {walkable, obstacles, obstruction, rayBox, floorAt} from './yard.js';
import {clamp, angleDiff} from './geometry.js';
import {eyeOf, postureStep, vertical} from './posture.js';
const low = obstacles.filter(o => o.y0 === 0 && o.y1 > .53 && o.y1 <= 1.05 && o.x1 - o.x0 + o.z1 - o.z0 > 3.4);
// Observations are local to the current match and survive respawns. A cell's
// value decays over time. The planner receives only the observer's own memory.
export class NV11 extends NV1 {
  constructor(match) {
    super(match);
    this.experience = new Map();
    this.metrics = {crouch: 0, jump: 0, scope: 0, peek: 0, intuition: 0, learning: 0}
  }
  attach(a) {
    super.attach(a);
    const b = this.brains.get(a.id);
    if (!this.experience.has(a.id))this.experience.set(a.id, new Map());
    Object.assign(b, {
      motionAt: 0,
      cornerAt: 0,
      cornerSide: 0,
      cornerUntil: 0,
      lastHurt: -10,
      poseUntil: 0,
      jumpAt: -10,
      vault: null,
      aimStart: 0,
      confidence: 0,
      glance: 0,
      phase: '歩行',
      observedVelocity: [0, 0],
      oldSight: null,
      predictionAt: -10,
      lookUntil: 0,
      lookYaw: 0
    });
    a.paceFactor = 1
  }
  learn(a, positive) {
    if (a.human)return;
    const t = this.match.time, mem = this.experience.get(a.id);
    if (!mem)return;
    const center = this.nav.closest([a.x, a.z]);
    if (center < 0)return;
    const ids = [center, ...this.nav.links[center].map(p => p[0])];
    for (const i of ids) {
      const old = mem.get(i), v = old ? old.value * Math.exp(-(t - old.t) / 51) : 0;
      mem.set(i, {value: clamp(v + (positive ? -.21 : 1.4) * (i === center ? 1 : .6), -.4, 6), t})
    }
    this.metrics.learning++;
    const b = this.brains.get(a.id);
    if (!positive && b) {
      b.lastHurt = t;
      b.planAt = Math.min(b.planAt, t + .18);
      b.poseUntil = t + .85
    }
  }
  perceive(a, b) {
    const previous = b.seen ? {...b.seen} : null, old = b.seenAt, oldId = b.targetId;
    super.perceive(a, b);
    const t = this.match.time;
    if (b.seenAt === t) {
      if (previous && oldId === b.targetId && t - old > .04 && t - old < .5) {
        b.observedVelocity = [clamp((b.seen.x - previous.x) / (t - old), -6, 6), clamp((b.seen.z - previous.z) / (t - old), -6, 6)]
      } else {
        b.aimStart = t;
        b.observedVelocity = [0, 0]
      }
      b.confidence = Math.min(1, b.confidence + .18);
      b.oldSight = {x: b.seen.x, z: b.seen.z}
    } else b.confidence *= .83
  }
  pickGoal(a, b) {
    const t = this.match.time, mem = this.experience.get(a.id), old = this.traffic[a.team], weights = new Map(old);
    for (const [i, r] of mem) {
      const v = r.value * Math.exp(-(t - r.t) / 51);
      if (Math.abs(v) < .05) {
        mem.delete(i);
        continue
      }
      weights.set(i, Math.max(0, (weights.get(i) || 0) + v))
    }
    this.traffic[a.team] = weights;
    super.pickGoal(a, b);
    this.traffic[a.team] = old;
    const lost = t - b.seenAt;
    if (b.oldSight && lost > .43 && lost < 2.2 && t - b.predictionAt > .8 && b.confidence > .17) {
      const dt = Math.min(1.1, lost);
      const pt = [b.oldSight.x + b.observedVelocity[0] * dt, b.oldSight.z + b.observedVelocity[1] * dt];
      if (walkable(...pt, .51)) {
        b.path = this.nav.route([a.x, a.z], pt, weights);
        b.state = '見失った方向を確認';
        b.predictionAt = t;
        this.metrics.intuition++
      }
    }
    if (b.vault && t < b.vault.until)b.path = [[b.vault.x, b.vault.z], ...b.path.slice(0, 1)]; else b.vault = null;
    if (!b.vault && b.path.length && a.onGround && t - b.jumpAt > 4.2) {
      const goal = b.path.at(-1), dx = goal[0] - a.x, dz = goal[1] - a.z, len = Math.hypot(dx, dz);
      if (len > 3.3) {
        const dir = [dx / len, dz / len];
        for (const o of low) {
          const end = [a.x + dir[0] * 4.6, .46, a.z + dir[1] * 4.6], start = [a.x, .46, a.z];
          const enter = rayBox(start, end, o);
          if (enter < .19 || enter > .72 || !walkable(end[0], end[2], .52) || obstruction([a.x, 1.31, a.z], [end[0], 1.31, end[2]]) < 1)continue;
          b.vault = {x: end[0], z: end[2], until: t + 1.35};
          b.path.unshift([end[0], end[2]]);
          break
        }
      }
    }
  }
  choosePose(a, b) {
    const t = this.match.time, fresh = t - b.seenAt < .47, recent = b.seen && t - b.seenAt < 4.2, lost = t - b.seenAt;
    let side = 0, nearTall = false;
    const pos = [a.x, a.z];
    for (const o of obstacles) {
      if (o.y0 > .1 || o.y1 < 1.16)continue;
      const dx = a.x - clamp(a.x, o.x0, o.x1), dz = a.z - clamp(a.z, o.z0, o.z1), d = Math.hypot(dx, dz);
      if (d > .98)continue;
      nearTall = true;
      if (!recent || !b.seen)break;
      const target = [b.seen.x, b.seen.y + 1.11, b.seen.z];
      const e = eyeOf(a);
      const closeCorner = Math.min(Math.hypot(a.x - o.x0, a.z - o.z0), Math.hypot(a.x - o.x1, a.z - o.z0), Math.hypot(a.x - o.x0, a.z - o.z1), Math.hypot(a.x - o.x1, a.z - o.z1)) < 1.8;
      if (!closeCorner)continue;
      const right = [Math.cos(a.yaw), Math.sin(a.yaw)];
      for (const sign of [-1, 1]) {
        const x = pos[0] + right[0] * sign * .31, z = pos[1] + right[1] * sign * .31;
        if (!walkable(x, z, .105, a.y) || obstruction([x, e[1], z], target) < 1)continue;
        side = sign * .30;
        break
      }
      if (side)break
    }
    if (t > b.cornerAt) {
      b.cornerSide = side;
      b.cornerAt = t + .35;
      b.cornerUntil = t + (side ? .65 : 0)
    }
    const lean = t < b.cornerUntil ? b.cornerSide : 0;
    const crouch = !b.vault && a.onGround && (this.match.groundMotion > .40 || a.reload > 0 && (recent || nearTall) || b.poseUntil > t || ((fresh || t - b.lastHurt < 1.2) && nearTall) || (fresh && b.profile.nerve < .55 && Math.sin(t * .69 + a.id) > .06));
    const ads = fresh && a.reload <= 0 && !b.vault && t - b.aimStart > .27 && (!crouch || a.crouch > .30);
    if (!fresh && lost < 3.8 && b.oldSight && b.lookUntil < t && b.confidence > .24) {
      b.lookYaw = Math.atan2(b.oldSight.x - a.x, a.z - b.oldSight.z) + (b.rng() - .5) * .27;
      b.lookUntil = t + .45
    }
    return {crouch, lean, ads}
  }
  tick(dt) {
    const t = this.match.time;
    for (const a of this.match.actors) {
      if (a.human || !a.alive || (this.teamFilter != null && a.team !== this.teamFilter))continue;
      const b = this.brains.get(a.id);
      if (!b) continue;
      if (t >= b.motionAt) {
        b.pose = this.choosePose(a, b);
        b.motionAt = t + .095 + b.rng() * .05
      }
      const p = b.pose || {crouch: false, lean: 0, ads: false};
      if (b.vault && a.onGround && t - b.jumpAt > 3 && Math.hypot(b.vault.x - a.x, b.vault.z - a.z) < 3.55) {
        a.vy = 6.35;
        a.onGround = false;
        b.jumpAt = t;
        this.metrics.jump++
      }
      const newPhase = !a.onGround ? '跳躍' : Math.abs(p.lean) > .15 ? '覗き' : p.crouch ? 'しゃがみ' : p.ads ? '照準' : '歩行';
      if (newPhase !== b.phase) {
        if (newPhase === 'しゃがみ')this.metrics.crouch++;
        if (newPhase === '覗き')this.metrics.peek++;
        if (newPhase === '照準')this.metrics.scope++;
        b.phase = newPhase
      }
      postureStep(a, dt, p.crouch && a.onGround, p.lean, p.ads);
      a.paceFactor = b.vault ? 1.13 : 1 - a.crouch * .40 - a.aimPose * .12;
      vertical(a, dt, floorAt, this.match.gravityScale || 1)
    }
    super.tick(dt);
    for (const a of this.match.actors) {
      if (a.human || !a.alive || (this.teamFilter != null && a.team !== this.teamFilter))continue;
      const b = this.brains.get(a.id);
      if (!b) continue;
      if (b.lookUntil > t && t - b.seenAt > .46)a.yaw += clamp(angleDiff(b.lookYaw, a.yaw), -dt * .95, dt * .95)
    }
  }
}
