import {clamp, forward, dot, sub, add, scale, random, cross, unit} from './geometry.js';
import {teams, tankers, walkable, moveActor, floorAt, obstruction, raycastMaterial} from './yard.js';
import {NV2} from './nv2.js';
import {eyeOf, torso, bodyCenter, postureStep} from './posture.js';
import {DF, initialDF, assist, scheduleDF, directionDF, spendP1, updateDF} from './df1.js';
const baseSpeed = 360, baseInterval = .24;
export const weapons = {
  'SW T': {capacity: 10, damage: 9, rate: 100, velocity: 100, speed: baseSpeed, interval: baseInterval, burst: 1, reload: 1.4},
  SRA: {capacity: 30, damage: 6, rate: 120, velocity: 80, speed: baseSpeed * .8, interval: baseInterval / 1.2, burst: 1, reload: 1.65},
  D1: {capacity: 40, damage: 5, rate: 100, velocity: 60, speed: baseSpeed * .6, interval: baseInterval, burst: 2, reload: 1.85},
  MS10: {capacity: 24, damage: 9, rate: 130, velocity: 180, speed: baseSpeed * 1.8, interval: baseInterval / 1.3, burst: 1, reload: 1.55, auto: true},
  [DF]: {capacity: 50, damage: 2.8, rate: 150, velocity: 65, speed: baseSpeed * .65, interval: baseInterval / 1.5, burst: 3, reload: 1.85, auto: true, playerOnly: true}
};
export const modes = {'3v3': [3, 3], '1v2': [1, 2], '1v1': [1, 1]};
const names = [['YOU', 'NAGI', 'KAI'], ['RIN', 'SORA', 'AO']];
export const npcWeapons = ['SW T', 'SRA', 'D1', 'MS10'];
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
    this.casings = [];
    this.tankers = tankers.map(t => ({...t, cooldown: 0, maxCooldown: 25, pulse: 0, lastTeam: -1}));
    this.rng = random(1939);
    this.seq = 0;
    const counts = modes[config.mode] || modes['3v3'];
    this.goals = counts.map(n => config.limit === 'unlimited' ? Infinity : n * clamp(Math.round(config.multiplier) || 5, 1, 99));
    this.receiptId = globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
    this.nv = new NV2(this);
    const rawSpy = config.allyNv21 === true ? 1 : Number(config.allyNv21 || 0);
    this.allyNv21Slot = config.mode === '3v3' && (rawSpy === 1 || rawSpy === 2) ? rawSpy : 0;
    for (let team = 0; team < 2; team++)for (let slot = 0; slot < counts[team]; slot++) {
      const human = team === 0 && slot === 0;
      const gun = human ? config.loadout : npcWeapons[(slot + team + 1) % npcWeapons.length];
      const isSpy = !human && team === 0 && slot === this.allyNv21Slot;
      const aiVersion = human ? 'HUMAN' : isSpy ? 'NV2.1' : 'NV2';
      const a = {id: this.actors.length, team, slot, human, name: names[team][slot], gun, aiVersion, isSpy, kills: 0, deaths: 0, earned: 0};
      this.actors.push(a);
      this.spawn(a, true)
    }
    this.player = this.actors[0];
    this.spyActor = this.actors.find(a => a.isSpy) || null
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
      ammoRate: 1,
      tankerUses: a.tankerUses || 0,
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
      recoil: 0,
      recoilSide: 0,
      hitRecoil: 0,
      hitFlash: 0,
      shieldFlash: 0,
      hitDir: null,
      shotCount: a.shotCount || 0,
      onGround: true,
      crouch: 0,
      lean: 0,
      aimPose: 0,
      fwdVel: 0,
      sideVel: 0,
      airBlend: 0,
      landCompress: 0,
      sprintAmt: 0,
      reloadFrac: 0,
      queue: [],
      df: a.gun === DF ? {...initialDF(), pattern: a.df?.pattern || 'central', scope: a.df?.scope || 'plastic'} : null
    });
    if (!a.human)this.nv.attach(a);
    if (!initial)this.event('spawn', {actor: a})
  }
  reload(a) {
    if (!a.alive || this.ended || a.reload > 0 || a.burstLeft || a.mag >= this.weapon(a).capacity || a.stock <= 0)return false;
    a.reload = this.weapon(a).reload;
    this.nv.onReload?.(a);
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
    a.flash = a.gun === 'MS10' ? .115 : .095;
    a.recoil = 1;
    a.recoilSide = (this.rng() - .5) * 2;
    a.shotCount = (a.shotCount || 0) + 1;
    const dir = a.df ? directionDF(a) : forward(a.yaw, a.pitch), p = eyeOf(a);
    const right = unit(cross(dir, [0, 1, 0]));
    const up = cross(right, dir);
    const barrelLen = a.gun === 'MS10' ? .92 : a.gun === 'D1' ? .78 : a.gun === 'SW T' ? .60 : .74;
    const muzzle = add(p, add(scale(dir, barrelLen), add(scale(right, a.human ? .14 : .11), scale(up, a.human ? -.12 : -.18))));
    this.shots.push({
      id: ++this.seq,
      owner: a,
      team: a.team,
      gun: a.gun,
      source,
      dir,
      p,
      old: p,
      origin: [...muzzle],
      damage: w.damage,
      speed: w.speed,
      life: 1.35,
      age: 0,
      whizzed: false
    });
    // Spawn muzzle flash & drifting smoke puff in world space.
    this.effects.push({
      kind: 'muzzle',
      p: muzzle,
      dir: [...dir],
      gun: a.gun,
      team: a.team,
      source,
      actor: a.id,
      human: a.human,
      life: a.gun === 'MS10' ? .15 : .12,
      max: a.gun === 'MS10' ? .15 : .12,
      seed: this.seq
    });
    // Eject spinning brass / thermal cartridge casing from right ejection port.
    const port = add(p, add(scale(dir, .36), add(scale(right, a.human ? .22 : .18), scale(up, a.human ? -.13 : -.18))));
    const spreadR = 1.6 + this.rng() * 1.3, spreadU = 1.1 + this.rng() * .95, spreadF = -.35 + (this.rng() - .5) * .6;
    this.casings.push({
      p: port,
      v: add(add(scale(right, spreadR), scale(up, spreadU)), scale(dir, spreadF)),
      rot: this.rng() * 6.28,
      spin: (this.rng() > .5 ? 1 : -1) * (14 + this.rng() * 16),
      gun: a.gun,
      life: .95,
      bounced: false
    });
    if (this.casings.length > 42)this.casings.shift();
    this.nv.sound(a);
    this.nv.onShotFired?.(a, source);
    this.event('fire', {actor: a, source, gun: a.gun, p: muzzle, dir, speed: w.speed, burstIndex: a.shotCount})
  }
  damage(v, owner, power, dir = null) {
    if (this.ended || !v.alive || owner.team === v.team)return null;
    const hadShield = v.shield > 0;
    const absorbed = Math.min(v.shield, power);
    v.shield = Math.round((v.shield - absorbed) * 10) / 10;
    v.hp = Math.max(0, Math.round((v.hp - (power - absorbed)) * 10) / 10);
    const shieldBreak = hadShield && v.shield <= 0;
    const kill = v.hp <= 0;
    v.hitRecoil = Math.min(1, (v.hitRecoil || 0) + .58 + power * .038);
    v.hitFlash = 1;
    if (absorbed > 0)v.shieldFlash = 1;
    if (dir)v.hitDir = [...dir];
    this.nv.learn(v, false);
    this.nv.onHit?.(v, owner, dir, power);
    this.event('hit', {victim: v, actor: owner, shield: absorbed > 0, shieldBreak, kill, damage: power, dir});
    if (!kill)return {shield: absorbed > 0, shieldBreak, kill: false};
    v.alive = false;
    v.respawn = 3;
    v.reload = 0;
    v.burstLeft = 0;
    v.deaths++;
    owner.kills++;
    owner.earned += 10;
    this.nv.learn(owner, true);
    this.nv.onKill?.(owner, v);
    this.scores[owner.team]++;
    this.event('point', {actor: owner, victim: v, receipt: this.receiptId + '/' + owner.id + '/' + owner.kills});
    if (this.scores[owner.team] >= this.goals[owner.team]) {
      this.winner = owner.team;
      this.ended = true;
      this.event('end', {winner: owner.team})
    }
    return {shield: absorbed > 0, shieldBreak, kill: true}
  }
  updateTankers(dt) {
    for (const tk of this.tankers) {
      if (tk.cooldown > 0)tk.cooldown = Math.max(0, tk.cooldown - dt);
      if (tk.pulse > 0)tk.pulse = Math.max(0, tk.pulse - dt * 1.4);
      if (tk.cooldown > 0)continue;
      for (const a of this.actors) {
        if (!a.alive)continue;
        const d = Math.hypot(a.x - tk.x, a.z - tk.z);
        if (d <= tk.radius) {
          a.stock += 100;
          a.ammoRate = 1.5;
          a.tankerUses = (a.tankerUses || 0) + 1;
          tk.cooldown = tk.maxCooldown;
          tk.pulse = 1;
          tk.lastTeam = a.team;
          this.effects.push({
            kind: 'tanker',
            p: [tk.x, 1.55, tk.z],
            dir: [0, 1, 0],
            actor: a.id,
            team: a.team,
            life: .95,
            max: .95,
            seed: ++this.seq
          });
          this.event('tanker', {actor: a, tanker: tk});
          this.nv.onTanker?.(a, tk);
          break
        }
      }
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
    a.recoil = Math.max(0, (a.recoil || 0) - dt * 6.5);
    a.hitRecoil = Math.max(0, (a.hitRecoil || 0) - dt * 4.2);
    a.hitFlash = Math.max(0, (a.hitFlash || 0) - dt * 5.2);
    a.shieldFlash = Math.max(0, (a.shieldFlash || 0) - dt * 4.2);
    a.cooldown = Math.max(0, a.cooldown - dt);
    // Smooth body-frame velocity & posture signals for the 16-joint articulated humanoid rig
    const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
    const localFwd = a.vx * sy - a.vz * cy;
    const localSide = a.vx * cy + a.vz * sy;
    const hSpd = Math.hypot(a.vx, a.vz);
    const kSmooth = 1 - Math.exp(-16 * dt);
    a.fwdVel = (a.fwdVel || 0) + (clamp(localFwd / 4.6, -1.2, 1.55) - (a.fwdVel || 0)) * kSmooth;
    a.sideVel = (a.sideVel || 0) + (clamp(localSide / 4.6, -1.2, 1.2) - (a.sideVel || 0)) * kSmooth;
    const airTarget = a.onGround ? 0 : 1;
    a.airBlend = (a.airBlend || 0) + (airTarget - (a.airBlend || 0)) * (1 - Math.exp(-18 * dt));
    a.landCompress = Math.max(0, (a.landCompress || 0) * Math.exp(-9.5 * dt) - dt * 0.35);
    const sprintTarget = a.onGround && a.crouch < 0.25 && hSpd > 4.65 && localFwd > 2.2 ? clamp((hSpd - 4.4) / 1.4, 0, 1) : 0;
    a.sprintAmt = (a.sprintAmt || 0) + (sprintTarget - (a.sprintAmt || 0)) * (1 - Math.exp(-12 * dt));
    const wReload = this.weapon(a).reload;
    a.reloadFrac = a.reload > 0 ? clamp(1 - a.reload / wReload, 0, 1) : 0;
    if (a.shield < 10) {
      a.shieldClock += dt;
      if (a.shieldClock + 1e-8 >= 5) {
        a.shield = Math.min(10, a.shield + 1);
        a.shieldClock = Math.max(0, a.shieldClock - 5)
      }
    } else a.shieldClock = 0;
    if (a.stock < 100) {
      a.ammoClock += dt * (a.ammoRate || 1);
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
    // Detect close bullet flyby near the human player for diverse spatial whiz/crack audio.
    const pl = this.player;
    if (pl && pl.alive && s.owner !== pl && !s.whizzed && target !== pl) {
      const eye = eyeOf(pl);
      const ab = sub(b, a), ab2 = dot(ab, ab);
      if (ab2 > 1e-8) {
        const u = clamp(dot(sub(eye, a), ab) / ab2, 0, 1);
        const closest = add(a, scale(ab, u));
        const d = Math.hypot(closest[0] - eye[0], closest[1] - eye[1], closest[2] - eye[2]);
        if (d < 6.0 && (at > 1 || u <= at)) {
          s.whizzed = true;
          const rx = Math.cos(pl.yaw), rz = Math.sin(pl.yaw);
          const p0 = sub(a, eye), p1 = sub(b, eye);
          const pan = clamp((p0[0] * rx + p0[2] * rz) / (Math.hypot(p0[0], p0[2]) + .7), -1, 1);
          const panEnd = clamp((p1[0] * rx + p1[2] * rz) / (Math.hypot(p1[0], p1[2]) + .7), -1, 1);
          this.event('whiz', {
            shot: s,
            actor: s.owner,
            dist: d,
            speed: s.speed,
            gun: s.gun,
            source: s.source,
            pan,
            panEnd,
            point: closest,
            dir: s.dir,
            origin: s.origin,
            p0: a,
            p1: b,
            enemy: s.team !== pl.team
          })
        }
      }
    }
    // Notify NPCs of close enemy bullet flybys (<2.2m) for realistic suppression startle/flinch
    if (this.nv.onBulletWhiz && (s.age || 0) < 0.45) {
      const ab = sub(b, a), ab2 = dot(ab, ab);
      if (ab2 > 1e-8) {
        let mask = s.whizNpcMask || 0;
        for (const v of this.actors) {
          if (!v.alive || v.human || v.team === s.team || v === target) continue;
          const bit = 1 << v.id;
          if (mask & bit) continue;
          const eye = eyeOf(v);
          const u = clamp(dot(sub(eye, a), ab) / ab2, 0, 1);
          const cx = a[0] + ab[0] * u - eye[0], cy = a[1] + ab[1] * u - eye[1], cz = a[2] + ab[2] * u - eye[2];
          const d = Math.hypot(cx, cy, cz);
          if (d < 2.25 && (at > 1 || u <= at)) {
            mask |= bit;
            this.nv.onBulletWhiz(v, s, d);
          }
        }
        s.whizNpcMask = mask;
      }
    }
    s.old = a;
    s.p = b;
    s.life -= dt;
    s.age = (s.age || 0) + dt;
    if (at <= 1) {
      const p = add(a, scale(sub(b, a), at));
      if (target) {
        const res = this.damage(target, s.owner, s.damage, s.dir);
        const kind = res?.kill ? 'kill' : res?.shieldBreak ? 'break' : res?.shield ? 'shield' : 'hit';
        const dur = kind === 'kill' ? .62 : kind === 'break' ? .48 : kind === 'shield' ? .34 : .28;
        this.effects.push({
          kind,
          p,
          dir: [...s.dir],
          gun: s.gun,
          team: s.team,
          life: dur,
          max: dur,
          actor: s.owner.id,
          target: true,
          seed: ++this.seq
        })
      } else {
        const hitInfo = raycastMaterial(a, b);
        const mat = hitInfo?.mat || (p[1] >= .08 ? 'steel' : 'concrete');
        const metal = mat === 'steel';
        const dur = s.gun === 'MS10' ? .34 : .26;
        this.effects.push({
          kind: 'wall',
          p,
          dir: [...s.dir],
          gun: s.gun,
          team: s.team,
          metal,
          life: dur,
          max: dur,
          actor: s.owner.id,
          target: false,
          seed: ++this.seq
        });
        this.event('impact', {point: p, dir: s.dir, normal: hitInfo?.normal || [0, 1, 0], gun: s.gun, metal, mat, actor: s.owner})
      }
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
    this.updateTankers(dt);
    let write = 0;
    for (const shot of this.shots) {
      if (!this.ended && this.projectile(shot, dt))this.shots[write++] = shot
    }
    this.shots.length = write;
    let cw = 0;
    for (const c of this.casings) {
      c.life -= dt;
      if (c.life <= 0)continue;
      c.v[1] -= 13.5 * dt;
      c.p[0] += c.v[0] * dt;
      c.p[1] += c.v[1] * dt;
      c.p[2] += c.v[2] * dt;
      c.rot += c.spin * dt;
      if (c.p[1] <= .03) {
        const impactVy = Math.abs(c.v[1]);
        c.p[1] = .03;
        c.v[1] = impactVy * .38;
        c.v[0] *= .68;
        c.v[2] *= .68;
        c.spin *= .65;
        if ((c.bounces || 0) < 2 && impactVy > .55) {
          this.event('casing', {point: [...c.p], gun: c.gun, speed: impactVy, bounce: c.bounces || 0});
          c.bounces = (c.bounces || 0) + 1
        }
        c.bounced = true
      }
      this.casings[cw++] = c
    }
    this.casings.length = cw;
    for (const e of this.effects)e.life -= dt;
    this.effects = this.effects.filter(e => e.life > 0);
    if (this.effects.length > 130)this.effects = this.effects.slice(-130)
  }
}
