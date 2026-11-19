import {clamp, forward, dot, sub, add, scale, random} from './geometry.js';
import {teams, walkable, moveActor, floorAt, obstruction} from './yard.js';
import {NV11} from './nv11.js';
import {eyeOf, torso, bodyCenter, postureStep} from './posture.js';
import {DF, initialDF, assist, scheduleDF, directionDF, spendP1, updateDF} from './df1.js';
const baseSpeed = 360, baseInterval = .24;
export const weapons = {
  'SW T': {capacity: 10, damage: 9, rate: 100, velocity: 100, speed: baseSpeed, interval: baseInterval, burst: 1, reload: 1.4},
  SRA: {capacity: 30, damage: 6, rate: 120, velocity: 80, speed: baseSpeed * .8, interval: baseInterval / 1.2, burst: 1, reload: 1.65},
  D1: {capacity: 40, damage: 5, rate: 100, velocity: 60, speed: baseSpeed * .6, interval: baseInterval, burst: 2, reload: 1.85},
  [DF]: {capacity: 50, damage: 2.8, rate: 150, velocity: 65, speed: baseSpeed * .65, interval: baseInterval / 1.5, burst: 3, reload: 1.85, playerOnly: true}
};
export const modes = {'3v3': [3, 3], '1v2': [1, 2], '1v1': [1, 1]};
const names = [['YOU', 'NAGI', 'KAI'], ['RIN', 'SORA', 'AO']];
export const npcWeapons = ['SW T', 'SRA', 'D1'];
const sphereHit = (a, d, c, r) => {
  const v = sub(a, c), A = dot(d, d), B = dot(v, d), C = dot(v, v) - r * r;
  if (C <= 0)return 0;
  const h = B * B - A * C;
  if (h < 0 || A < 1e-14)return Infinity;
  const u = (-B - Math.sqrt(h)) / A;
  return u >= 0 && u <= 1 ? u : Infinity
};
export function bodyHit(a, b, actor) {
  const center = bodyCenter(actor),
    d = sub(b, a),
    x = a[0] - center[0],
    z = a[2] - center[1],
    rr = .39,
    lo = actor.y + .36,
    hi = actor.y + 1.46 * torso(actor),
    A = d[0] ** 2 + d[2] ** 2,
    B = x * d[0] + z * d[2],
    C = x * x + z * z - rr * rr;
  let t = Infinity;
  if (A > 1e-12) {
    const h = B * B - A * C;
    if (h >= 0) {
      const u = (-B - Math.sqrt(h)) / A;
      if (u >= 0 && u <= 1 && a[1] + d[1] * u >= lo && a[1] + d[1] * u <= hi)t = u
    }
  }
  if (C <= 0 && a[1] >= lo && a[1] <= hi)t = 0;
  return Math.min(t, sphereHit(a, d, [center[0], lo, center[1]], rr), sphereHit(a, d, [center[0], hi, center[1]], rr))
}
export class Match {
  constructor(config, onEvent = () => {}) {
    this.config = {...config};
    this.time = 0;
    this.tremorAt = 68;
    this.groundMotion = 0;
    this.scores = [0, 0];
    this.winner = null;
    this.ended = false;
    this.onEvent = onEvent;
    this.actors = [];
    this.shots = [];
    this.effects = [];
    this.rng = random(1939);
    this.seq = 0;
    const counts = modes[config.mode] || modes['3v3'];
    this.goals = counts.map(n => config.limit === 'unlimited' ? Infinity : n * clamp(Math.round(config.multiplier) || 5, 1, 99));
    this.receiptId = globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
    this.nv = new NV11(this);
    for (let team = 0; team < 2; team++)for (let slot = 0; slot < counts[team]; slot++) {
      const human = team === 0 && slot === 0;
      const gun = human ? config.loadout : npcWeapons[(slot + team + 1) % 3];
      const a = {id: this.actors.length, team, slot, human, name: names[team][slot], gun, kills: 0, deaths: 0, earned: 0};
      this.actors.push(a);
      this.spawn(a, true)
    }
    this.player = this.actors[0]
  }
  weapon(a) {
    return weapons[a.gun]
  }
  event(type, detail = {}) {
    this.onEvent({type, ...detail})
  }
  spawn(a, initial = false) {
    const list = teams[a.team];
    let p = list[a.slot];
    if (!initial) {
      let best = -Infinity;
      for (const point of list) {
        if (!walkable(...point))continue;
        const nearby = this.actors.filter(b => b !== a && b.alive);
        const opponents = nearby.filter(b => a.team !== b.team);
        const enemies = opponents.map(b => Math.hypot(b.x - point[0], b.z - point[1]));
        const seen = opponents.filter(b => Math.hypot(b.x - point[0], b.z - point[1]) < 44 && obstruction([point[0], 1.55, point[1]], [b.x, b.y + 1.4, b.z]) > 1).length;
        const crowded = nearby.some(b => Math.hypot(b.x - point[0], b.z - point[1]) < 2);
        const s = Math.min(65, ...enemies) + this.rng() * 10 - seen * 24 - (crowded ? 100 : 0);
        if (s > best) {
          best = s;
          p = point
        }
      }
    }
    Object.assign(a, {
      x: p[0],
      y: 0,
      z: p[1],
      yaw: a.team ? Math.PI : 0,
      pitch: 0,
      hp: 100,
      shield: 10,
      shieldClock: 0,
      mag: this.weapon(a).capacity,
      stock: 100,
      ammoClock: 0,
      alive: true,
      respawn: 0,
      cooldown: 0,
      burstLeft: 0,
      nextBurst: 0,
      reload: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      stride: 0,
      flash: 0,
      onGround: true,
      crouch: 0,
      lean: 0,
      aimPose: 0,
      queue: [],
      df: a.gun === DF ? {...initialDF(), pattern: a.df?.pattern || 'central', scope: a.df?.scope || 'plastic'} : null
    });
    if (!a.human)this.nv.attach(a);
    if (!initial)this.event('spawn', {actor: a})
  }
  reload(a) {
    if (!a.alive || this.ended || a.reload > 0 || a.burstLeft || a.mag >= this.weapon(a).capacity || a.stock <= 0)return false;
    a.reload = this.weapon(a).reload;
    this.event('reload', {actor: a});
    return true
  }
  trigger(a) {
    if (this.ended || !a.alive || a.cooldown > 1e-7 || a.reload > 0 || a.burstLeft)return false;
    if (a.mag <= 0) {
      this.event('dry', {actor: a});
      return false
    }
    const w = this.weapon(a);
    a.queue = a.df ? scheduleDF(a) : Array(Math.min(w.burst, a.mag)).fill('main');
    if (a.df)assist(this, a);
    this.fire(a, a.queue.shift());
    a.burstLeft = a.queue.length;
    a.nextBurst = w.interval;
    return true
  }
  fire(a, source = 'main') {
    const w = this.weapon(a);
    if (source === 'p1') {
      if (!spendP1(a, this.time))return
    } else {
      if (!a.mag)return;
      a.mag--
    }
    a.cooldown = w.interval;
    a.flash = .09;
    const dir = a.df ? directionDF(a) : forward(a.yaw, a.pitch), p = eyeOf(a);
    this.shots.push({id: ++this.seq, owner: a, team: a.team, dir, p, old: p, damage: w.damage, speed: w.speed, life: 1.25});
    this.nv.sound(a);
    this.event('fire', {actor: a, source})
  }
  damage(v, owner, power) {
    if (this.ended || !v.alive || owner.team === v.team)return;
    const absorbed = Math.min(v.shield, power);
    v.shield = Math.round((v.shield - absorbed) * 10) / 10;
    v.hp = Math.max(0, Math.round((v.hp - (power - absorbed)) * 10) / 10);
    this.nv.learn(v, false);
    this.event('hit', {victim: v, actor: owner, shield: absorbed > 0});
    if (v.hp > 0)return;
    v.alive = false;
    v.respawn = 3;
    v.reload = 0;
    v.burstLeft = 0;
    v.deaths++;
    owner.kills++;
    owner.earned += 10;
    this.nv.learn(owner, true);
    this.scores[owner.team]++;
    this.event('point', {actor: owner, victim: v, receipt: this.receiptId + '/' + owner.id + '/' + owner.kills});
    if (this.scores[owner.team] >= this.goals[owner.team]) {
      this.winner = owner.team;
      this.ended = true;
      this.event('end', {winner: owner.team})
    }
  }
  updatePlayer(dt, input) {
    const a = this.player;
    if (!a.alive)return;
    const u = input || {};
    postureStep(a, dt, !!u.crouch && a.onGround, 0, !!a.df?.ads);
    const cx = Math.cos(a.yaw),
      sx = Math.sin(a.yaw),
      h = clamp(u.side || 0, -1, 1),
      f = clamp(u.forward || 0, -1, 1),
      n = Math.max(1, Math.hypot(h, f)),
      speed = (u.sprint ? 6.75 : 4.68) * (1 - a.crouch * .46) * (a.df?.ads ? .68 : 1);
    const vx = (cx * h + sx * f) / n * speed, vz = (sx * h - cx * f) / n * speed, e = 1 - Math.exp(-(a.onGround ? 14 : 4.5) * dt);
    a.vx += (vx - a.vx) * e;
    a.vz += (vz - a.vz) * e;
    const x = a.x, z = a.z;
    moveActor(a, a.vx * dt, a.vz * dt);
    a.stride += Math.hypot(a.x - x, a.z - z);
    if (u.jump && a.onGround) {
      a.vy = 5.35;
      a.onGround = false
    }
    const ground = floorAt(a.x, a.z, a.y);
    a.vy -= 14 * dt;
    a.y += a.vy * dt;
    if (a.y <= ground) {
      a.y = ground;
      a.vy = 0;
      a.onGround = true
    } else a.onGround = false
  }
  systems(a, dt) {
    if (!a.alive) {
      a.respawn -= dt;
      if (a.respawn <= 1e-7)this.spawn(a);
      return
    }
    a.flash = Math.max(0, a.flash - dt);
    a.cooldown = Math.max(0, a.cooldown - dt);
    if (a.shield < 10) {
      a.shieldClock += dt;
      if (a.shieldClock + 1e-8 >= 5) {
        a.shield = Math.min(10, a.shield + 1);
        a.shieldClock = Math.max(0, a.shieldClock - 5)
      }
    } else a.shieldClock = 0;
    if (a.stock < 100) {
      a.ammoClock += dt;
      if (a.ammoClock + 1e-8 >= 3) {
        a.stock = Math.min(100, a.stock + 1);
        a.ammoClock = Math.max(0, a.ammoClock - 3)
      }
    } else a.ammoClock = 0;
    if (a.df)updateDF(this, a, dt);
    if (a.burstLeft) {
      a.nextBurst -= dt;
      if (a.nextBurst <= 1e-7) {
        this.fire(a, a.queue.shift());
        a.burstLeft = a.queue.length;
        a.nextBurst += this.weapon(a).interval
      }
    }
    if (a.reload > 0) {
      a.reload -= dt;
      if (a.reload <= 1e-7) {
        const take = Math.min(this.weapon(a).capacity - a.mag, a.stock);
        a.stock -= take;
        a.mag += take;
        a.reload = 0;
        this.event('loaded', {actor: a})
      }
    }
  }
  projectile(s, dt) {
    const a = s.p, b = add(a, scale(s.dir, s.speed * dt));
    let at = obstruction(a, b), target = null;
    for (const v of this.actors) {
      if (!v.alive || v.team === s.team)continue;
      const t = bodyHit(a, b, v);
      if (t < at) {
        at = t;
        target = v
      }
    }
    s.old = a;
    s.p = b;
    s.life -= dt;
    if (at <= 1) {
      const p = add(a, scale(sub(b, a), at));
      if (target)this.damage(target, s.owner, s.damage);
      this.effects.push({p, life: .14, max: .14, actor: s.owner.id, target: !!target});
      return false
    }
    return s.life > 0 && Math.abs(b[0]) < 120 && Math.abs(b[2]) < 200
  }
  step(dt, input) {
    if (this.ended)return;
    this.time += dt;
    if (this.time > this.tremorAt + 1.2)this.tremorAt = this.time + 65 + this.rng() * 36;
    this.groundMotion = this.time >= this.tremorAt ? Math.sin((this.time - this.tremorAt) / 1.2 * Math.PI) : 0;
    for (const a of this.actors)this.systems(a, dt);
    this.updatePlayer(dt, input);
    this.nv.tick(dt);
    let write = 0;
    for (const shot of this.shots) {
      if (!this.ended && this.projectile(shot, dt))this.shots[write++] = shot
    }
    this.shots.length = write;
    for (const e of this.effects)e.life -= dt;
    this.effects = this.effects.filter(e => e.life > 0)
  }
}
