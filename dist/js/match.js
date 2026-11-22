import {clamp, forward, dot, sub, add, scale, random, cross, unit} from './geometry.js';
import {teams, tankers, walkable, moveActor, floorAt, obstruction, raycastMaterial, waterCrossing} from './yard.js';
import {NV2} from './nv2.js';
import {eyeOf, torso, bodyCenter, postureStep, vertical} from './posture.js';
import {DF, initialDF, scheduleDF, bulletGuidanceDF, steerGuidedShot, spendP1, updateDF} from './df1.js';
import {RD, RD20, RD30, isRDWeapon, initialRD, updateRD, bulletGuidanceRD} from './rd40.js';
import {DF40II, initialDF40II, updateDF40II, bulletGuidanceDF40II, onFireDF40II, toggleAA14} from './df40ii.js';
import {solveBallisticImpact} from './ballistics.js';
import {EchoPulseField} from './echopulse.js';
import {SynapseProfiler} from './synapse.js';
import {AeroVortex} from './aerovortex.js';
import {ThermoFlux} from './thermoflux.js';
import {SpectraField} from './spectrafield.js';
import {ResonanceCore} from './resonance.js';
import {ChronoTrace} from './chronotrace.js';
import {FermatCore} from './fermat.js';
const baseSpeed = 360, baseInterval = .24;
export const weapons = {
  'SW T': {capacity: 10, damage: 9, rate: 100, velocity: 100, speed: baseSpeed, interval: baseInterval, burst: 1, reload: 1.4},
  SRA: {capacity: 30, damage: 6, rate: 120, velocity: 80, speed: baseSpeed * .8, interval: baseInterval / 1.2, burst: 1, reload: 1.65},
  D1: {capacity: 40, damage: 5, rate: 100, velocity: 60, speed: baseSpeed * .6, interval: baseInterval, burst: 2, reload: 1.85},
  MS10: {capacity: 24, damage: 9, rate: 130, velocity: 180, speed: baseSpeed * 1.8, interval: baseInterval / 1.3, burst: 1, reload: 1.55, auto: true},
  [DF]: {capacity: 95, damage: 2.8, rate: 300, velocity: 65, speed: baseSpeed * .65, interval: baseInterval / 3, burst: 3, reload: 1.85, auto: true, playerOnly: true},
  [RD20]: {capacity: 20, damage: 6, rate: 110, velocity: 70, speed: baseSpeed * .7, interval: baseInterval / 1.1, burst: 1, pellets: 1, reload: 1.55, auto: true},
  [RD30]: {capacity: 80, damage: 3, rate: 100, velocity: 100, speed: baseSpeed * 1.0, interval: baseInterval, burst: 1, pellets: 2, reload: 1.75, auto: true},
  [RD]: {capacity: 130, damage: 3, rate: 170, velocity: 140, speed: baseSpeed * 1.4, interval: baseInterval / 1.7, burst: 1, pellets: 2, reload: 1.95, auto: true, playerOnly: true},
  [DF40II]: {capacity: 260, damage: 2, rate: 225, velocity: 80, speed: baseSpeed * .8, interval: baseInterval / 2.25, burst: 1, pellets: 3, reload: 2.15, auto: true, playerOnly: true}
};
export const modes = {'3v3': [3, 3], '1v2': [1, 2], '1v1': [1, 1]};
const names = [['YOU', 'NAGI', 'KAI'], ['RIN', 'SORA', 'AO']];
export const npcWeapons = ['SW T', 'SRA', 'D1', 'MS10', 'RD30', 'RD20'];
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
  constructor(config = {}, onEvent = () => {}) {
    const mode = Object.hasOwn(modes, config.mode) ? config.mode : '3v3';
    const loadout = Object.hasOwn(weapons, config.loadout) ? config.loadout : 'SW T';
    this.config = {...config, mode, loadout};
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
    this.scorches = [];
    this.tankers = tankers.map(t => ({...t, cooldown: 0, maxCooldown: 25, pulse: 0, lastTeam: -1}));
    this.rng = random(1939);
    this.seq = 0;
    this.echoPulse = new EchoPulseField();
    this.synapse = new SynapseProfiler();
    this.aeroVortex = new AeroVortex();
    this.thermoFlux = new ThermoFlux();
    this.spectraField = new SpectraField();
    this.resonance = new ResonanceCore();
    this.chronoTrace = new ChronoTrace();
    this.fermat = new FermatCore();
    this.smokeCooldown = 0;
    this.techStats = {ricochets: 0, ricochetHits: 0, penetrations: 0, wallbangHits: 0};
    const counts = modes[mode], multiplier = Number(config.multiplier ?? 5);
    this.goals = counts.map(n => config.limit === 'unlimited' ? Infinity : n * clamp(Number.isFinite(multiplier) ? Math.round(multiplier) : 5, 1, 99));
    this.receiptId = globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
    this.aiModel = config.aiModel === 'classic'
      ? 'classic'
      : config.aiModel === 'nv23'
        ? 'nv23'
        : (config.aiModel === 'manusia' || config.aiModel === 'nv24')
          ? 'manusia'
          : 'human';
    this.teamAiModels = Array.isArray(config.teamAiModels) && config.teamAiModels.length === 2 ? [...config.teamAiModels] : null;
    this.nv = new NV2(this);
    const rawSpy = config.allyNv21 === true ? 1 : Number(config.allyNv21 || 0);
    this.allyNv21Slot = mode === '3v3' && (rawSpy === 1 || rawSpy === 2) ? rawSpy : 0;
    const allNpc = !!config.allNpc;
    const benchGuns = Array.isArray(config.benchGuns) ? config.benchGuns : null;
    for (let team = 0; team < 2; team++)for (let slot = 0; slot < counts[team]; slot++) {
      const human = !allNpc && team === 0 && slot === 0;
      const gun = human
        ? loadout
        : benchGuns && Object.hasOwn(weapons, benchGuns[slot % benchGuns.length])
          ? benchGuns[slot % benchGuns.length]
          : npcWeapons[(slot + team + 1) % npcWeapons.length];
      const isSpy = !human && team === 0 && this.allyNv21Slot > 0 && slot === this.allyNv21Slot;
      const teamModel = this.teamAiModels ? this.teamAiModels[team] : this.aiModel;
      const aiVersion = human
        ? 'HUMAN'
        : isSpy
          ? 'NV2.1'
          : teamModel === 'classic'
            ? 'NV2'
            : teamModel === 'nv23'
              ? 'NV2.3 HUMAN'
              : (teamModel === 'manusia' || teamModel === 'nv24')
                ? 'NV 2.4 Manusia'
                : 'NV2.5 humain';
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
        const crowded = nearby.some(b => Math.hypot(b.x - point[0], b.z - point[1]) < 2 && b.y < 1.7);
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
      spawnId: (a.spawnId || 0) + 1,
      dryAt: -Infinity,
      cooldown: 0,
      smokeCooldown: 0,
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
      seismicRattle: 0,
      seismicKnockTeam: -1,
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
      df: a.gun === DF ? {...initialDF(), pattern: a.df?.pattern || 'central', scope: a.df?.scope || 'plastic'} : null,
      rd: isRDWeapon(a.gun) ? initialRD(a.gun) : null,
      df40: a.gun === DF40II ? initialDF40II() : null
    });
    if (!a.human)this.nv.attach(a);
    if (!initial)this.event('spawn', {actor: a})
  }
  toggleAA14(a = this.player) {
    return toggleAA14(this, a);
  }
  reload(a) {
    if (!a.alive || this.ended || a.reload > 0 || a.burstLeft || a.mag >= this.weapon(a).capacity || a.stock <= 0)return false;
    a.reload = this.weapon(a).reload;
    this.nv.onReload?.(a);
    this.event('reload', {actor: a});
    return true;
  }
  trigger(a) {
    if (this.ended || !a.alive || a.cooldown > 1e-7 || a.reload > 0 || a.burstLeft)return false;
    if (a.mag <= 0) {
      if (this.time >= a.dryAt) {
        a.dryAt = this.time + .28;
        this.event('dry', {actor: a});
      }
      return false
    }
    const w = this.weapon(a);
    a.queue = a.df ? scheduleDF(a) : Array(Math.min(w.burst, a.mag)).fill('main');
    this.fire(a, a.queue.shift());
    a.burstLeft = a.queue.length;
    a.nextBurst = w.interval;
    return true;
  }
  fire(a, source = 'main') {
    if (!a.alive || this.ended || a.reload > 0) return false;
    const w = this.weapon(a);
    const salvo = w.pellets && source === 'main' ? Math.min(w.pellets, a.mag) : 1;
    if (source === 'p1') {
      if (!a.df || !spendP1(a, this.time)) return false
    } else {
      if (!a.mag || salvo <= 0) return false;
      a.mag -= salvo
    }
    a.cooldown = w.interval;
    a.flash = a.gun === 'MS10' ? .115 : a.gun === DF40II ? .112 : a.gun === RD ? .108 : a.gun === RD30 ? .098 : .095;
    a.recoil = 1;
    a.recoilSide = (this.rng() - .5) * 2;
    a.shotCount = (a.shotCount || 0) + 1;
    if (a.rd) {
      a.rd.firePulse = 1;
      a.rd.barrelPhase = 1 - (a.rd.barrelPhase || 0);
    }
    const firedAA14 = !!(a.df40?.aa14Active && !a.df40?.aa14Overheated);
    const p = eyeOf(a);
    const barrelLen = a.gun === 'MS10' ? .92 : a.gun === DF40II ? .90 : a.gun === RD ? .88 : a.gun === RD30 ? .80 : a.gun === RD20 ? .68 : a.gun === 'D1' ? .78 : a.gun === 'SW T' ? .60 : .74;
    let firstDir = null, firstMuzzle = null;
    for (let k = 0; k < salvo; k++) {
      const barrelSide = salvo === 3 ? (k - 1) : salvo === 2 ? (k === 0 ? -1 : 1) : 0;
      const barrelVert = salvo === 3 ? (k === 1 ? 1 : -0.45) : 0;
      const guidedInfo = a.df ? bulletGuidanceDF(this, a) : a.df40 ? bulletGuidanceDF40II(this, a, barrelSide, barrelVert) : a.rd ? bulletGuidanceRD(this, a, barrelSide) : null;
      const dir = guidedInfo ? guidedInfo.dir : forward(a.yaw, a.pitch);
      const right = unit(cross(dir, [0, 1, 0]));
      const up = cross(right, dir);
      const sideOff = (a.human ? .14 : .11) + barrelSide * (a.gun === DF40II ? .042 : .048);
      const upOff = (a.human ? -.12 : -.18) + barrelVert * .026;
      const muzzle = add(p, add(scale(dir, barrelLen), add(scale(right, sideOff), scale(up, upOff))));
      if (!firstDir) { firstDir = dir; firstMuzzle = muzzle; }
      const shot = {
        id: ++this.seq,
        owner: a,
        team: a.team,
        gun: a.gun,
        source,
        dir,
        p,
        old: p,
        origin: [...p],
        trail: [[...p]],
        trailClock: 0,
        guided: !!guidedInfo?.guided,
        thermalGuidance: !!(a.df?.ads && a.df.scope === 'thermal'),
        homingTargetId: guidedInfo?.targetId ?? -1,
        homingSpawnId: this.actors[guidedInfo?.targetId]?.spawnId,
        homingBudget: guidedInfo ? guidedInfo.homingBudget : 0,
        homingRate: guidedInfo ? guidedInfo.homingRate : 0,
        homingCos: guidedInfo?.homingCos || 0,
        homingTurned: 0,
        aaTier: guidedInfo?.aaTier || null,
        arvOrder: guidedInfo?.arvOrder || 1,
        homingAccel: guidedInfo?.accel || null,
        homingVelWeight: guidedInfo?.velWeight,
        homingAccelWeight: guidedInfo?.accelWeight,
        ricochets: 0,
        penetrations: 0,
        ricocheted: false,
        penetrated: false,
        fermatLocked: this.fermat.isShotFermatAligned(a, dir, this) || !!a._fermatAiShot,
        damage: w.damage,
        speed: w.speed,
        life: 1.35,
        age: 0,
        whizzed: false
      };
      this.chronoTrace.beginShot(shot, this.time);
      this.shots.push(shot);
      // Spawn muzzle flash & drifting smoke puff in world space.
      this.effects.push({
        kind: 'muzzle',
        p: muzzle,
        dir: [...dir],
        gun: a.gun,
        team: a.team,
        source,
        aaTier: guidedInfo?.aaTier || null,
        actor: a.id,
        human: a.human,
        life: a.gun === 'MS10' ? .15 : .12,
        max: a.gun === 'MS10' ? .15 : .12,
        seed: this.seq
      });
      // Eject spinning brass / thermal cartridge casing from right ejection port.
      const port = add(p, add(scale(dir, .36), add(scale(right, (a.human ? .22 : .18) + barrelSide * .02), scale(up, a.human ? -.13 : -.18))));
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
    }
    if (a.df40) onFireDF40II(this, a, salvo);
    this.echoPulse.emit(this, {
      kind: 'fire',
      pos: firstMuzzle || p,
      actor: a,
      team: a.team,
      loudness: a.gun === 'MS10' ? 1.25 : a.gun === DF40II ? 1.18 : a.gun === RD ? 1.12 : 1.0,
      gun: a.gun
    });
    if (firstMuzzle && firstDir) {
      this.aeroVortex.injectSmoke(firstMuzzle[0], firstMuzzle[2], 0.11, 0.18, 1, firstDir[0] * 1.3, firstDir[2] * 1.3);
      this.thermoFlux.depositHeat(a.x, a.z, 0.14, 0);
    }
    this.nv.onShotFired?.(a, source);
    this.event('fire', {actor: a, source, gun: a.gun, p: firstMuzzle, dir: firstDir, speed: w.speed, pellets: salvo, burstIndex: a.shotCount, aa14: firedAA14});
    return true;
  }
  deploySmokeVent(a = this.player) {
    if (!a?.alive || this.ended) return false;
    if (a.human ? this.smokeCooldown > 0.01 : (a.smokeCooldown || 0) > 0.01) return false;
    const fx = Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    const from = [a.x, a.y + .45, a.z];
    const to = [clamp(a.x + fx * 3.4, -24, 24), from[1], clamp(a.z + fz * 3.4, -98, 98)];
    const wall = obstruction(from, to);
    const [sx, , sz] = wall <= 1 ? add(from, scale(sub(to, from), Math.max(0, wall - .16))) : to;
    this.aeroVortex.deploySmokeVent(sx, sz, fx, fz);
    this.thermoFlux.depositHeat(sx, sz, 0.45, 2);
    if (a.human) this.smokeCooldown = 10.0;
    else a.smokeCooldown = 14.0;
    this.echoPulse.emit(this, {kind: 'smoke', pos: [sx, 1.2, sz], actor: a, team: a.team, loudness: 0.72});
    this.event('smoke', {actor: a, point: [sx, 1.0, sz]});
    return true;
  }
  damage(v, owner, power, dir = null, meta = null) {
    if (this.ended || !v.alive || !owner || owner.team === v.team || !Number.isFinite(power) || power <= 0) return null;
    const hadShield = v.shield > 0;
    const absorbed = Math.min(v.shield, power);
    v.shield = Math.round((v.shield - absorbed) * 10) / 10;
    v.hp = Math.max(0, Math.round((v.hp - (power - absorbed)) * 10) / 10);
    const shieldBreak = hadShield && v.shield <= 0;
    const kill = v.hp <= 0;
    if (meta?.shot) {
      const outcome = kill ? 'kill' : shieldBreak ? 'break' : absorbed > 0 ? 'shield' : 'hit';
      this.chronoTrace.finishShot(meta.shot, meta.point, outcome, meta.time, v);
    } else if (kill && v.human) {
      this.chronoTrace.lastPlayerDeathTrace = null;
    }
    v.hitRecoil = Math.min(1, (v.hitRecoil || 0) + .58 + power * .038);
    v.hitFlash = 1;
    if (absorbed > 0)v.shieldFlash = 1;
    if (dir)v.hitDir = [...dir];
    if (meta?.ricochet) this.techStats.ricochetHits++;
    if (meta?.wallbang) this.techStats.wallbangHits++;
    if (shieldBreak) {
      this.aeroVortex.injectBurst(v.x, v.z, {smoke: 0.95, heat: 1.12, force: 3.6, radius: 2});
      this.thermoFlux.depositHeat(v.x, v.z, 0.85, 2);
      this.resonance.exciteBlast([v.x, v.y + 1.0, v.z], 0.78);
    }
    this.nv.learn(v, false);
    this.nv.onHit?.(v, owner, dir, power, shieldBreak);
    this.event('hit', {victim: v, actor: owner, shield: absorbed > 0, shieldBreak, kill, damage: power, dir, ricochet: !!meta?.ricochet, wallbang: !!meta?.wallbang});
    if (!kill)return {shield: absorbed > 0, shieldBreak, kill: false};
    this.aeroVortex.injectBurst(v.x, v.z, {smoke: 1.35, heat: 0.92, force: 4.8, radius: 3});
    this.thermoFlux.depositHeat(v.x, v.z, 1.15, 2);
    this.resonance.exciteBlast([v.x, v.y + 1.0, v.z], 1.15);
    v.alive = false;
    v.respawn = 3;
    v.reload = 0;
    v.burstLeft = 0;
    v.queue.length = 0;
    if (v.df) {
      v.df.ads = false;
      v.df.locked = false;
      v.df.focus = 0;
      v.df.focusId = -1;
      v.df.boost = false;
    }
    if (v.rd) {
      v.rd.locked = false;
      v.rd.d01Active = false;
      v.rd.occluded = false;
      v.rd.focus = 0;
      v.rd.focusId = -1;
      v.rd.d01Timer = 0;
    }
    if (v.df40) {
      v.df40.aa14Active = false;
      v.df40.locked = false;
      v.df40.d01Active = false;
      v.df40.occluded = false;
      v.df40.focus = 0;
      v.df40.focusId = -1;
      v.df40.d01Timer = 0;
    }
    v.deaths++;
    owner.kills++;
    if (owner.human) owner.earned += 10;
    this.nv.learn(owner, true);
    this.nv.onKill?.(owner, v);
    this.scores[owner.team]++;
    this.event('point', {actor: owner, victim: v, receipt: this.receiptId + '/' + owner.id + '/' + owner.kills});
    if (this.scores[owner.team] >= this.goals[owner.team]) this.end(owner.team);
    return {shield: absorbed > 0, shieldBreak, kill: true}
  }
  end(winner = null) {
    if (this.ended) return;
    this.winner = winner;
    this.ended = true;
    this.shots.length = 0;
    this.synapse?.save();
    this.nv.onMatchEnd?.();
    this.event('end', {winner});
  }

  updateTankers(dt) {
    for (const tk of this.tankers) {
      if (tk.cooldown > 0) tk.cooldown = tk.cooldown <= dt + 1e-8 ? 0 : tk.cooldown - dt;
      if (tk.pulse > 0) tk.pulse = Math.max(0, tk.pulse - dt * 1.4);
      if (tk.cooldown > 0) continue;
      let recipient = null, best = tk.radius;
      for (const a of this.actors) {
        if (!a.alive || a.y > 1.2) continue;
        const distance = Math.hypot(a.x - tk.x, a.z - tk.z);
        if (distance <= best && (!recipient || distance < best)) {
          recipient = a;
          best = distance;
        }
      }
      if (recipient) {
        const a = recipient;
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
        this.aeroVortex.injectBurst(tk.x, tk.z, {smoke: 1.95, heat: 0.72, force: 4.5, radius: 3});
        this.thermoFlux.depositHeat(tk.x, tk.z, 0.75, 2);
        this.resonance.exciteBlast([tk.x, 1.5, tk.z], 1.1);
        this.spectraField.observe(1 - a.team, tk.x, tk.z, {sigma: 5.5, weight: 0.78});
        this.echoPulse.emit(this, {kind: 'tanker', pos: [tk.x, 1.8, tk.z], actor: a, team: a.team, loudness: 1.4});
        if (a.human) this.synapse?.observeTankerCapture();
        this.event('tanker', {actor: a, tanker: tk});
        this.nv.onTanker?.(a, tk);
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
    vertical(a, dt, floorAt);
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
    a.seismicRattle = Math.max(0, (a.seismicRattle || 0) - dt * 1.4);
    a.hitFlash = Math.max(0, (a.hitFlash || 0) - dt * 5.2);
    a.shieldFlash = Math.max(0, (a.shieldFlash || 0) - dt * 4.2);
    a.cooldown = Math.max(0, a.cooldown - dt);
    if (a.smokeCooldown > 0) a.smokeCooldown = Math.max(0, a.smokeCooldown - dt);
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
      if (a.ammoClock + 1e-8 >= 1) {
        a.stock = Math.min(100, a.stock + 1);
        a.ammoClock = Math.max(0, a.ammoClock - 1)
      }
    } else a.ammoClock = 0;
    if (a.df)updateDF(this, a, dt);
    if (a.rd)updateRD(this, a, dt);
    if (a.df40)updateDF40II(this, a, dt);
    if (a.burstLeft) {
      if (a.df && (!a.df.boost || a.df.cooling > 0 || !a.df.p1)) {
        a.queue = a.queue.filter(source => source !== 'p1');
        a.burstLeft = a.queue.length;
      }
      a.nextBurst -= dt;
      if (a.burstLeft && a.nextBurst <= 1e-7) {
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
  beginPenetration(s, ball, normal, mat, time) {
    const entry = ball.entryPos;
    s.materialPass = {ball, normal, mat, time, remaining: ball.thickness / ((s.speed + ball.speed) * .5)};
    s.guided = false;
    this.effects.push({
      kind: 'wall', p: [...entry], dir: [...s.dir], normal, gun: s.gun, source: s.source,
      team: s.team, metal: mat === 'steel', mat, life: .34, max: .34, actor: s.owner.id, target: false, seed: ++this.seq
    });
    this.scorches.push({
      p: add(entry, scale(normal, .014)), normal, mat, gun: s.gun, source: s.source,
      life: 1.85, max: 1.85, seed: this.seq
    });
    if (this.scorches.length > 26) this.scorches.shift();
    if (mat === 'steel') {
      const resHit = this.resonance.exciteStrike(entry, 0.9, s.owner, this);
      if (resHit) this.event('resonate', {...resHit, actor: s.owner, mat});
    }
  }

  advancePenetration(s, dt) {
    const pass = s.materialPass;
    const elapsed = Math.min(pass.remaining, s.life, dt);
    pass.remaining -= elapsed;
    s.life -= elapsed;
    s.age += elapsed;
    const time = Math.max(pass.time, this.time - dt + elapsed);
    if (pass.remaining > 0) {
      if (s.life > 0) return true;
      this.chronoTrace.finishShot(s, pass.ball.entryPos, 'wall', time);
      return false;
    }

    const {ball, normal, mat} = pass;
    s.materialPass = null;
    this.techStats.penetrations++;
    this.chronoTrace.recordPenetration(s, ball.entryPos, ball.exitPos, normal, ball.thickness, mat, pass.time, time, ball.exitNormal);
    s.old = [...ball.entryPos];
    s.p = ball.exitPos;
    s.dir = ball.dir;
    s.speed = ball.speed;
    s.damage = ball.damage;
    s.penetrations = (s.penetrations || 0) + 1;
    s.penetrated = true;
    if (s.trail) {
      s.trail.push([...ball.entryPos], [...ball.exitPos]);
      while (s.trail.length > 10) s.trail.shift();
    }
    this.effects.push({
      kind: 'penetrate', p: [...ball.exitPos], dir: [...ball.dir], normal: ball.exitNormal, gun: s.gun, source: s.source,
      team: s.team, metal: mat === 'steel', mat, life: .44, max: .44, actor: s.owner.id, target: false, seed: ++this.seq
    });
    this.scorches.push({
      p: add(ball.exitPos, scale(ball.exitNormal, .014)), normal: ball.exitNormal, mat, gun: s.gun, source: s.source,
      life: 1.85, max: 1.85, seed: ++this.seq
    });
    if (this.scorches.length > 26) this.scorches.shift();
    this.aeroVortex.injectSmoke(ball.exitPos[0], ball.exitPos[2], 0.52, 0.55, 1, ball.dir[0] * 2.2, ball.dir[2] * 2.2);
    this.thermoFlux.depositHeat(ball.exitPos[0], ball.exitPos[2], 0.78, 1);
    this.echoPulse.emit(this, {kind: 'penetrate', pos: ball.exitPos, actor: s.owner, team: s.team, loudness: 0.76, gun: s.gun});
    this.event('penetrate', {point: ball.exitPos, entry: ball.entryPos, dir: ball.dir, mat, thickness: ball.thickness, gun: s.gun, actor: s.owner});
    if (s.life <= 0) {
      this.chronoTrace.finishShot(s, s.p, 'miss', time);
      return false;
    }
    const left = dt - elapsed;
    return left <= 1e-8 || this.projectile(s, left);
  }

  projectile(s, dt) {
    if (s.materialPass) return this.advancePenetration(s, dt);
    if (s.guided)steerGuidedShot(this, s, dt);
    const a = s.p;
    // AeroVortex 1.0 physical harbor crosswind coupling (subtle caliber-scaled aerodynamic drift)
    if (!s.guided && s.p[1] > 0.1 && s.p[1] < 5.5) {
      const wind = this.aeroVortex.sample(a[0], a[2]);
      if (wind.speed > 0.35) {
        const drag = s.gun === 'MS10' ? 0.0009 : s.gun === 'RD40' ? 0.0013 : s.gun === DF40II ? 0.0014 : 0.0019;
        s.dir = unit([s.dir[0] + wind.vx * drag * dt, s.dir[1], s.dir[2] + wind.vz * drag * dt]);
      }
    }
    const travel = Math.min(dt, s.life);
    const b = add(a, scale(s.dir, s.speed * travel));
    const hitInfo = raycastMaterial(a, b);
    const wet = waterCrossing(a, b);
    let at = Math.min(hitInfo?.t ?? Infinity, wet ?? Infinity), target = null;
    for (const v of this.actors) {
      if (!v.alive || v.team === s.team)continue;
      const t = bodyHit(a, b, v);
      if (t < at) {
        at = t;
        target = v
      }
    }
    const point = at <= 1 ? add(a, scale(sub(b, a), at)) : b;
    const impactTime = Math.max(s.trace?.startTime ?? 0, this.time - dt + Math.min(1, at) * travel);
    this.aeroVortex.injectProjectileWake(a, point, s.speed, s.gun);
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
    s.p = point;
    const flight = travel * Math.min(1, at);
    s.life -= flight;
    s.age = (s.age || 0) + flight;
    // Supersonic Mach shockwave aero-acoustic coupling to nearby hollow steel shipping containers
    if (s.speed >= 340 && s.age >= (s._nextMachAt || 0.008)) {
      s._nextMachAt = s.age + 0.045;
      this.resonance.exciteMach(point, s.speed);
    }
    if (at > 1) this.chronoTrace.sampleShot(s, impactTime);
    s.trailClock = (s.trailClock || 0) + dt;
    if (at > 1 && s.trail && s.trailClock >= .0055) {
      s.trailClock = 0;
      s.trail.push([b[0], b[1], b[2]]);
      if (s.trail.length > 8)s.trail.shift()
    }
    if (at <= 1) {
      const p = point;
      if (target) {
        const res = this.damage(target, s.owner, s.damage, s.dir, {ricochet: s.ricocheted, wallbang: s.penetrated, shot: s, point: p, time: impactTime});
        const kind = res?.kill ? 'kill' : res?.shieldBreak ? 'break' : res?.shield ? 'shield' : 'hit';
        const dur = kind === 'kill' ? .78 : kind === 'break' ? .58 : kind === 'shield' ? .42 : .36;
        const bc = bodyCenter(target);
        const outN = unit([p[0] - bc[0] - s.dir[0] * .25, (p[1] - (target.y + .95)) * .35 - s.dir[1] * .25, p[2] - bc[1] - s.dir[2] * .25]);
        this.effects.push({
          kind,
          p,
          dir: [...s.dir],
          normal: outN,
          gun: s.gun,
          source: s.source,
          guided: !!s.guided,
          damage: s.damage,
          team: s.team,
          life: dur,
          max: dur,
          actor: s.owner.id,
          target: true,
          seed: ++this.seq
        })
      } else {
        const isWater = at === wet && (!hitInfo || wet < hitInfo.t);
        const mat = isWater ? 'water' : hitInfo.mat;
        const normal = isWater ? [0, 1, 0] : hitInfo.normal;
        const metal = mat === 'steel';
        const ball = !isWater && hitInfo ? solveBallisticImpact(s, hitInfo, this.rng) : {action: 'stop'};

        if (ball.action === 'ricochet') {
          s.life -= travel - flight;
          this.techStats.ricochets++;
          this.chronoTrace.recordRicochet(s, hitInfo.point, normal, ball.grazingSin, impactTime);
          s.old = [...hitInfo.point];
          s.p = ball.pos;
          s.dir = ball.dir;
          s.speed = ball.speed;
          s.damage = ball.damage;
          s.guided = false;
          s.ricochets = (s.ricochets || 0) + 1;
          s.ricocheted = true;
          if (s.trail) {
            s.trail.push([...hitInfo.point], [...ball.pos]);
            while (s.trail.length > 10) s.trail.shift();
          }
          this.effects.push({
            kind: 'ricochet',
            p: [...hitInfo.point],
            dir: [...ball.dir],
            normal,
            gun: s.gun,
            source: s.source,
            team: s.team,
            metal,
            mat,
            life: .44,
            max: .44,
            actor: s.owner.id,
            target: false,
            seed: ++this.seq
          });
          this.scorches.push({
            p: [hitInfo.point[0] + normal[0] * .014, hitInfo.point[1] + normal[1] * .014, hitInfo.point[2] + normal[2] * .014],
            normal, mat, gun: s.gun, source: s.source, life: 1.85, max: 1.85, seed: this.seq
          });
          if (this.scorches.length > 26) this.scorches.shift();
          this.aeroVortex.injectSmoke(hitInfo.point[0], hitInfo.point[2], 0.42, 0.72, 1, ball.dir[0] * 2.5, ball.dir[2] * 2.5);
          this.thermoFlux.depositHeat(hitInfo.point[0], hitInfo.point[2], 0.92, 1);
          const resHit = this.resonance.exciteStrike(hitInfo.point, 1.05, s.owner, this);
          if (resHit) this.event('resonate', {...resHit, actor: s.owner, mat});
          this.echoPulse.emit(this, {kind: 'ricochet', pos: hitInfo.point, actor: s.owner, team: s.team, loudness: 0.92, gun: s.gun});
          this.event('ricochet', {point: hitInfo.point, dir: ball.dir, normal, gun: s.gun, mat, actor: s.owner});
          return s.life > 0;
        }

        if (ball.action === 'penetrate') {
          this.beginPenetration(s, ball, normal, mat, impactTime);
          return this.advancePenetration(s, dt - flight);
        }

        this.chronoTrace.finishShot(s, p, isWater ? 'miss' : 'wall', impactTime);
        const dur = (s.gun === 'MS10' || s.source === 'p1') ? .48 : .40;
        this.effects.push({
          kind: 'wall',
          p,
          dir: [...s.dir],
          normal,
          gun: s.gun,
          source: s.source,
          guided: !!s.guided,
          team: s.team,
          metal,
          mat,
          life: dur,
          max: dur,
          actor: s.owner.id,
          target: false,
          seed: ++this.seq
        });
        if (!isWater) this.scorches.push({
          p: [p[0] + normal[0] * .014, p[1] + normal[1] * .014, p[2] + normal[2] * .014],
          normal,
          mat,
          gun: s.gun,
          source: s.source,
          life: 1.85,
          max: 1.85,
          seed: this.seq
        });
        if (this.scorches.length > 26)this.scorches.shift();
        this.aeroVortex.injectSmoke(p[0], p[2], 0.22, 0.25, 1, normal[0] * 1.2, normal[2] * 1.2);
        this.thermoFlux.depositHeat(p[0], p[2], 0.58, 1);
        if (mat === 'steel') {
          const resHit = this.resonance.exciteStrike(p, s.gun === 'MS10' ? 0.95 : 0.72, s.owner, this);
          if (resHit) this.event('resonate', {...resHit, actor: s.owner, mat});
        }
        this.event('impact', {point: p, dir: s.dir, normal, gun: s.gun, metal, mat, actor: s.owner})
      }
      return false
    }
    const alive = s.life > 0 && Math.abs(b[0]) < 120 && Math.abs(b[2]) < 200;
    if (!alive) this.chronoTrace.finishShot(s, b, 'miss', impactTime);
    return alive
  }
  step(dt, input) {
    if (this.ended)return;
    this.time += dt;
    this.smokeCooldown = Math.max(0, this.smokeCooldown - dt);
    if (this.time > this.tremorAt + 1.2)this.tremorAt = this.time + 65 + this.rng() * 36;
    this.groundMotion = this.time >= this.tremorAt ? Math.sin((this.time - this.tremorAt) / 1.2 * Math.PI) : 0;
    const prevStrides = this.actors.map(a => a.stride || 0);
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      this.systems(a, dt);
    }
    this.updatePlayer(dt, input);
    const arrivedEchoes = this.echoPulse.step(this);
    for (const rep of arrivedEchoes) {
      this.nv.onEchoArrival?.(rep);
      const listener = this.actors[rep.listenerId];
      const src = rep.sourceActor;
      const staleSource = src && (!src.alive || (rep.sourceSpawnId !== undefined && src.spawnId !== rep.sourceSpawnId));
      if (listener?.alive && !staleSource) {
        this.spectraField.observe(listener.team, rep.perceivedPos[0], rep.perceivedPos[2], {
          sigma: rep.occluded ? 7.2 : 4.5,
          weight: rep.isDecoy ? 0.35 : 0.62
        });
      }
    }
    // Feed newly arrived player acoustic waves into Team 0's fair-play Bayesian wavefunction & FermatCore!
    if (this.echoPulse.playerWaves.length) {
      for (const w of this.echoPulse.playerWaves) {
        if (!w.specFed && this.player.alive && w.team !== this.player.team && this.time >= w.arriveAt) {
          w.specFed = true;
          const srcActor = w.actorId >= 0 ? this.actors[w.actorId] : null;
          const staleSrc = w.actorId >= 0 && (!srcActor?.alive || srcActor.spawnId !== w.actorSpawnId);
          if (!staleSrc) {
            this.spectraField.observe(0, w.pos[0], w.pos[2], {sigma: w.occluded ? 7.2 : 4.6, weight: 0.58});
            if (srcActor && srcActor.team === 1 && w.kind !== 'smoke') {
              this.fermat.recordIntel(0, srcActor, this.time, 'echo', [w.pos[0], Math.max(1.15, w.pos[1]), w.pos[2]]);
            }
          }
        }
      }
    }
    this.nv.tick(dt);
    // Stamp warm ThermoFlux thermal footprints, EchoPulse steps & ResonanceCore hollow container roof drums!
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      const prevStride = prevStrides[i];
      if (!a.alive || !a.onGround) continue;
      if (Math.floor((a.stride || 0) / 1.15) > Math.floor(prevStride / 1.15)) {
        const intensity = (a.sprintAmt || 0) > 0.35 ? 0.56 : 0.38;
        this.thermoFlux.stampFootprint(a.x, a.z, a.team, this.time, intensity);
        if (a.y > 1.8) {
          const roof = this.resonance.exciteRoofStep(a, (a.sprintAmt || 0) > 0.35 ? 0.65 : 0.42);
          if (roof) this.event('resonate', {...roof, actor: a, mat: 'steel', roof: true});
        }
      }
      if ((a.sprintAmt || 0) > 0.35 || a.y > 0.5) {
        if (Math.floor((a.stride || 0) / 2.2) > Math.floor(prevStride / 2.2)) {
          this.echoPulse.emit(this, {kind: 'step', pos: [a.x, a.y + 0.15, a.z], actor: a, team: a.team, loudness: a.y > 0.5 ? 0.85 : 0.55});
        }
      }
    }
    this.updateTankers(dt);
    this.aeroVortex.tick(dt);
    this.thermoFlux.tick(dt, this.tankers);
    this.spectraField.tick(dt, this);
    this.resonance.step(dt);
    this.chronoTrace.prune(this.time);
    let write = 0;
    for (const shot of this.shots) {
      if (!this.ended && this.projectile(shot, dt))this.shots[write++] = shot
    }
    this.shots.length = this.ended ? 0 : write;
    let cw = 0;
    for (const c of this.casings) {
      c.life -= dt;
      if (c.life <= 0)continue;
      c.v[1] -= 13.5 * dt;
      c.p[0] += c.v[0] * dt;
      c.p[1] += c.v[1] * dt;
      c.p[2] += c.v[2] * dt;
      c.rot += c.spin * dt;
      const ground = floorAt(c.p[0], c.p[2], c.p[1] - c.v[1] * dt);
      if (c.p[1] <= ground + .03) {
        const impactVy = Math.abs(c.v[1]);
        c.p[1] = ground + .03;
        c.v[1] = impactVy * .38;
        c.v[0] *= .68;
        c.v[2] *= .68;
        c.spin *= .65;
        if (!c.bounced) this.thermoFlux.depositHeat(c.p[0], c.p[2], 0.24, 0);
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
    if (this.effects.length > 130)this.effects = this.effects.slice(-130);
    for (const sc of this.scorches)sc.life -= dt;
    this.scorches = this.scorches.filter(sc => sc.life > 0)
  }
}
