// NV Gamer — Result GamePort Adapter (Bridges zero-dependency NVGamerCore into Result's 360Hz Match)
// Demonstrates how ANY game plugs into NVGamerCore: translate visible world -> universal GameFrame,
// then apply VirtualHumanInput back to the character controller!

import {NV2} from './nv2.js';
import {NVGamerCore, NVGAMER_VERSION} from './nvgamer-core.js';
import {clamp} from './geometry.js';
import {clearOpticalPath, obstruction} from './yard.js';
import {eyeOf, targetPoint} from './posture.js';

export {NVGAMER_VERSION};

function describeResultSkill(skillId, hpFrac, underFire, visEnemies, heliAlive) {
  const id = String(skillId || '').toLowerCase();
  const hpNeed = clamp(1 - hpFrac, 0, 1);
  if (id.includes('heal')) return [0.05, 0.96 * hpNeed, 0.1, 0, 0.2, hpNeed > 0.38 ? 1 : 0.05, 0, 0];
  if (id.includes('shaffer')) return [0.35, 0.72 * underFire, 0.90, 0, 0.1, underFire * 0.7 + 0.25, 0, 0];
  if (id.includes('judgment')) return [0.98, 0.90, 0.35, 0.65, 0.2, 0.60 + visEnemies * 0.2, 0.70, 0];
  if (id.includes('launcher')) return [0.92, 0.15, 0.10, 0.95, 0.1, 0.50 + visEnemies * 0.2, heliAlive ? 0.85 : 0.2, 0];
  if (id.includes('flow')) return [0.75, 0.65, 0.90, 0.2, 0.1, 0.55 + underFire * 0.4, 0.4, 0];
  // Brand-new future unknown skill: high novelty so NV Gamer discovers & masters it live!
  return [0.65, 0.55 * hpNeed + 0.2, 0.5, 0.35, 0.3, 0.55 + underFire * 0.3, 0.3, 0.95];
}

export class NVGamerEngine extends NV2 {
  constructor(match) {
    super(match);
    this.version = NVGAMER_VERSION;
    this.isNVGamer = true;
    this.gamerCores = new Map();
    this.metrics = {
      ...this.metrics,
      nvgInferences: 0,
      nvgCurvedFlicks: 0,
      nvgMouseLifts: 0,
      nvgCreativePlays: 0,
      nvgAdaptations: 0,
      nvgGasPipeTraps: 0,
      nvgDroneBuys: 0,
      nvgFutureCaps: 0,
      nvgWeatherComps: 0,
      nvgHumanRealismScore: 0
    };
  }

  attach(actor) {
    super.attach(actor);
    if (!actor || actor.human) return;
    if (!this.gamerCores.has(actor.id)) {
      this.gamerCores.set(actor.id, {
        core: new NVGamerCore({seed: (actor.id + 1) * 104729 + 7777, policyHz: 20}),
        pendingReward: 0,
        lastDmgAt: -99,
        gasPipeTarget: null,
        opponentHabits: new Map(),
        postKillUntil: 0,
        postKillDir: 1
      });
    }
    actor.aiVersion = NVGAMER_VERSION;
  }

  onHit(v, owner, dir, power, shieldBreak) {
    super.onHit(v, owner, dir, power, shieldBreak);
    if (v && this.gamerCores.has(v.id)) {
      const g = this.gamerCores.get(v.id);
      g.lastDmgAt = this.match.time;
      g.pendingReward -= clamp((power || 10) / 50, 0.05, 1.0);
    }
    if (owner && this.gamerCores.has(owner.id) && owner !== v) {
      const g = this.gamerCores.get(owner.id);
      g.pendingReward += 0.32 + (shieldBreak ? 0.28 : 0);
    }
  }

  onKill(killer, victim) {
    super.onKill(killer, victim);
    if (killer && this.gamerCores.has(killer.id)) {
      const g = this.gamerCores.get(killer.id);
      g.pendingReward += 1.4;
      g.postKillUntil = this.match.time + 0.48;
      g.postKillDir = g.core.rng() < 0.5 ? -1 : 1;
    }
    if (victim && this.gamerCores.has(victim.id)) {
      const g = this.gamerCores.get(victim.id);
      g.pendingReward -= 1.1;
    }
  }

  _buildGameFrame(a, g, dt) {
    const m = this.match;
    const w = m.weapon(a);
    const ws = m.weatherSpec || {visibility: 1, ballisticWarp: 0, windBase: 0};
    const eye = eyeOf(a);
    const maxHp = a.maxHp || 100;
    const hpFrac = clamp((a.hp || 0) / maxHp, 0, 1);
    const underFire = (m.time - g.lastDmgAt) < 1.8 ? 1 : 0;
    const maxVis = 68 * (ws.visibility ?? 1);

    const entities = [];
    let visEnemies = 0;
    let nearestEnemy = null, nearestDist = Infinity;
    let allyNear = 0;

    // 1. Fair-play optically visible combatants (zero wallhack!)
    for (let i = 0; i < m.actors.length && entities.length < 20; i++) {
      const e = m.actors[i];
      if (!e || !e.alive || e === a) continue;
      const hostile = m.areHostile(a, e);
      if (hostile && (e.shafferTimer || 0) > 0) continue;
      const rx = e.x - a.x, ry = (e.y || 0) - (a.y || 0), rz = e.z - a.z;
      const d = Math.hypot(rx, ry, rz);
      if (hostile) {
        if (d > maxVis) continue;
        const tp = targetPoint(e);
        if (!clearOpticalPath(eye, tp, m.aeroVortex)) continue;
        visEnemies++;
        if (d < nearestDist) { nearestDist = d; nearestEnemy = e; }
      } else if (d < 18) {
        allyNear++;
      }
      entities.push({
        id: `actor:${e.id}`,
        dx: rx, dy: ry, dz: rz, dist: d,
        vx: e.vx || 0, vz: e.vz || 0,
        vital: clamp((e.hp || 0) / Math.max(1, e.maxHp || 100), 0, 1),
        shield: clamp(((e.shield || 0) + (e.baizerShield || 0)) / 225, 0, 1),
        hostility: hostile ? 1 : -1,
        airborne: e.isDrone ? 1 : 0,
        threat: e.inMech ? 1.8 : e.isH1Zonbi ? 1.6 : e.isDrone ? 0.6 : 0.9
      });
    }

    // 2. Incoming hostile projectiles as universal hazard tokens (bullet-dodging!)
    let hazardNear = 0;
    for (let i = 0; i < m.shots.length && entities.length < 24; i++) {
      const s = m.shots[i];
      if (!s || s.owner === a) continue;
      if (s.owner && !s.fromHeli && !m.areHostile(a, s.owner)) continue;
      const rx = s.p[0] - a.x, ry = s.p[1] - (a.y + 1.1), rz = s.p[2] - a.z;
      const d = Math.hypot(rx, ry, rz);
      if (d < 10) {
        hazardNear = Math.max(hazardNear, clamp((10 - d) / 10, 0, 1));
        entities.push({
          id: `shot:${s.id}`,
          dx: rx, dy: ry, dz: rz, dist: d,
          vx: s.dir[0] * s.speed, vz: s.dir[2] * s.speed,
          hazard: 1, hostility: 0.2, threat: 1.1
        });
      }
    }

    // 3. Zombie Helicopter aerial threat token
    const heliAlive = !!m.helicopter?.alive;
    if (heliAlive && entities.length < 26) {
      const h = m.helicopter;
      entities.push({
        id: 'heli',
        dx: h.x - a.x, dy: h.y - (a.y || 0), dz: h.z - a.z,
        vx: h.vx || 0, vz: h.vz || 0,
        vital: h.hp / Math.max(1, h.maxHp || 450),
        hostility: 1, airborne: 1, threat: 1.7
      });
    }

    // 4. Destructible Gas Pipes near visible enemies (tactical trap detection!)
    g.gasPipeTarget = null;
    if (m.gasPipes?.length && nearestEnemy && entities.length < 27) {
      for (let i = 0; i < m.gasPipes.length; i++) {
        const gp = m.gasPipes[i];
        if (!gp.alive) continue;
        const dToE = Math.hypot(gp.x - nearestEnemy.x, gp.z - nearestEnemy.z);
        const dToS = Math.hypot(gp.x - a.x, gp.z - a.z);
        if (dToE <= 4.8 && dToS > 5.4 && dToS < 44) {
          if (obstruction(eye, [gp.x, (gp.y || 0) + 0.9, gp.z]) > 1) {
            entities.push({
              id: `gasPipe:${gp.id}`,
              dx: gp.x - a.x, dy: 0.9, dz: gp.z - a.z, dist: dToS,
              vital: gp.hp / 30, hostility: 0.6, destructible: 1, threat: 1.5
            });
            if (!g.gasPipeTarget) g.gasPipeTarget = gp;
            break;
          }
        }
      }
    }

    // 5. Future unknown world entities (zero-shot tokenization!)
    if (Array.isArray(m.customEntities)) {
      for (let i = 0; i < m.customEntities.length && entities.length < 28; i++) {
        const ce = m.customEntities[i];
        if (!ce || ce.alive === false) continue;
        entities.push({
          id: `custom:${i}`,
          dx: (ce.x || 0) - a.x, dy: (ce.y || 0) - (a.y || 0), dz: (ce.z || 0) - a.z,
          vx: ce.vx || 0, vz: ce.vz || 0,
          hostility: ce.hostile ? 1 : ce.friendly ? -1 : 0,
          destructible: ce.destructible ? 1 : 0,
          pickup: ce.pickup ? 1 : 0,
          goalValue: ce.goal ? 1 : 0,
          threat: ce.threat || 0.5,
          novelty: 1
        });
      }
    }

    // 6. Universal Actions List (Skills + Drone Buy + DF40 II Scatter + Future dynamicCapabilities!)
    const actions = [];
    if ((a.skillCharges || 0) > 0 && a.assignedSkill && !a.isDrone && !a.isZombie) {
      const sk = a.assignedSkill;
      const valid = (sk !== 'heal' || hpFrac < 0.62)
        && (sk !== 'shaffer' || (!(a.shafferTimer > 0) && (underFire || visEnemies >= 1)))
        && (sk !== 'judgment' || (!a.inMech && (visEnemies >= 1 || heliAlive || underFire)));
      if (valid) {
        actions.push({
          id: `skill:${sk}`,
          ready: true,
          minInterval: 1.2,
          descriptor: describeResultSkill(sk, hpFrac, underFire, visEnemies, heliAlive)
        });
      }
    }
    if (!m.isZombieChallenge && !a.isDrone && !a.isZombie && !a.inMech && m.buyDrone) {
      let ownDrones = 0;
      for (let i = 0; i < m.actors.length; i++) {
        const u = m.actors[i];
        if (u.alive && u.isDrone && u.ownerId === a.id) ownDrones++;
      }
      const totalAmmo = (a.stock || 0) + (a.mag || 0);
      if ((m.infiniteAmmo || totalAmmo >= 180) && ownDrones < 2) {
        actions.push({
          id: 'cap:buyDrone',
          ready: true,
          minInterval: 1.5,
          descriptor: [0.72, 0.74, 0.55, 0.25, 0.88, 0.62, 0.40, 0.25]
        });
      }
    }
    if (a.df40 && m.toggleDF40Scatter && nearestEnemy) {
      const wantScatter = nearestDist < 13.5;
      if (wantScatter !== !!a.df40.scatterMode) {
        actions.push({
          id: 'cap:toggleScatter',
          ready: true,
          minInterval: 0.8,
          descriptor: [0.85, 0.2, 0.2, 0.8, 0.2, 0.8, 0, 0.3]
        });
      }
    }
    if (Array.isArray(m.dynamicCapabilities)) {
      for (let i = 0; i < m.dynamicCapabilities.length; i++) {
        const cap = m.dynamicCapabilities[i];
        if (!cap || typeof cap.execute !== 'function') continue;
        if (typeof cap.canUse === 'function' && !cap.canUse(a, m)) continue;
        actions.push({
          id: `future:${i}`,
          ready: true,
          minInterval: 0.6,
          descriptor: Array.isArray(cap.descriptor) ? cap.descriptor : [0.6, 0.5, 0.4, 0.35, 0.35, 0.6, 0.25, 1.0],
          _cap: cap
        });
      }
    }

    // 7. Compute high-precision aimTarget (with habit elevation & storm/disaster ballistic warp lead!)
    let aimTarget = null;
    if (g.gasPipeTarget && g.gasPipeTarget.alive) {
      const gp = g.gasPipeTarget;
      const dx = gp.x - eye[0], dy = ((gp.y || 0) + 0.9) - eye[1], dz = gp.z - eye[2];
      aimTarget = {
        id: `gasPipe:${gp.id}`,
        yaw: Math.atan2(dx, -dz),
        pitch: clamp(Math.atan2(dy, Math.hypot(dx, dz) || 1), -1.25, 1.25),
        kind: 'gasPipe'
      };
    } else if (nearestEnemy) {
      let hab = g.opponentHabits.get(nearestEnemy.id);
      if (!hab) { hab = {crouch: 0.15, jump: 0.08, n: 0}; g.opponentHabits.set(nearestEnemy.id, hab); }
      hab.n++;
      hab.crouch = hab.crouch * 0.84 + ((nearestEnemy.crouch || 0) > 0.35 ? 0.16 : 0);
      hab.jump = hab.jump * 0.84 + ((nearestEnemy.y || 0) > 0.35 ? 0.16 : 0);
      const tp = targetPoint(nearestEnemy);
      let aimY = tp[1];
      if (hab.n >= 4) {
        if (hab.crouch > 0.45) aimY -= 0.24;
        else if (hab.jump > 0.35) aimY += 0.16;
      }
      const spd = Math.max(30, w?.speed || 280);
      const tof = clamp(nearestDist / spd, 0, 0.55);
      let tx = tp[0] + (nearestEnemy.vx || 0) * tof;
      let ty = aimY + (nearestEnemy.vy || 0) * tof * 0.5;
      let tz = tp[2] + (nearestEnemy.vz || 0) * tof;
      if ((ws.ballisticWarp || 0) > 0.1) {
        tx -= (ws.windBase || 0) * 0.012 * tof * nearestDist;
        this.metrics.nvgWeatherComps++;
      }
      const dx = tx - eye[0], dy = ty - eye[1], dz = tz - eye[2];
      aimTarget = {
        id: `actor:${nearestEnemy.id}`,
        yaw: Math.atan2(dx, -dz),
        pitch: clamp(Math.atan2(dy, Math.hypot(dx, dz) || 1), -1.30, 1.30),
        kind: 'enemy'
      };
    } else if (m.time < g.postKillUntil) {
      aimTarget = {
        id: 'postKillScan',
        yaw: a.yaw + g.postKillDir * 1.1 * dt,
        pitch: -0.02,
        kind: 'scan'
      };
    }

    const rew = g.pendingReward;
    g.pendingReward = 0;

    return {
      frame: {
        time: m.time,
        dt,
        self: {
          vital: hpFrac,
          shield: clamp((a.shield || 0) / Math.max(25, a.maxShield || 25), 0, 1),
          energy: clamp((a.baizerShield || 0) / 200, 0, 1),
          resource: clamp((a.stock || 0) / Math.max(100, w?.stockCap || 300), 0, 1),
          ammoFrac: clamp((a.mag || 0) / Math.max(1, w?.capacity || 30), 0, 1),
          busy: a.reload > 0,
          posture: clamp(a.crouch || 0, 0, 1),
          speed: clamp(Math.hypot(a.vx || 0, a.vz || 0) / 7.5, 0, 2),
          vx: (a.vx || 0) / 7.5,
          vz: (a.vz || 0) / 7.5,
          danger: Math.max(underFire, hazardNear),
          visibility: ws.visibility ?? 1,
          physicsAnomaly: clamp((ws.ballisticWarp || 0) / 1.5 + (m.squadFractured ? 0.6 : 0), 0, 2),
          allyNearby: clamp(allyNear / 3, 0, 1),
          enemyCount: clamp(visEnemies / 3, 0, 2),
          hazardNear,
          specialReady: (a.skillCharges || 0) > 0 ? 1 : 0,
          yaw: a.yaw,
          pitch: a.pitch
        },
        entities,
        actions,
        aimTarget,
        reward: rew
      },
      actions,
      aimTarget
    };
  }

  tick(dt) {
    super.tick(dt);
    const m = this.match;
    if (!m || m.ended) return;

    let totInf = 0, totFlick = 0, totLift = 0, totCreat = 0, totAdapt = 0, bestReal = 0;

    for (let i = 0; i < m.actors.length; i++) {
      const a = m.actors[i];
      if (!a || a.human || !a.alive || a.isDrone) continue;
      if (a.isZombie && !a.armedZombie && !a.isH1Zonbi) continue;
      if (this.teamFilter !== undefined && this.teamFilter !== null && a.team !== this.teamFilter) continue;

      let g = this.gamerCores.get(a.id);
      if (!g) {
        this.attach(a);
        g = this.gamerCores.get(a.id);
      }
      if (!g) continue;

      const {frame, actions, aimTarget} = this._buildGameFrame(a, g, dt);
      const out = g.core.step(frame);

      // Apply curved biomechanical Virtual Human Mouse Look when actively tracking/scanning
      if (aimTarget) {
        a.yaw = out.yaw;
        a.pitch = out.pitch;
        if (out.onTarget && a.cooldown <= 1e-6 && a.reload <= 0 && !a.burstLeft) {
          if (aimTarget.kind === 'gasPipe') {
            if (m.trigger(a)) this.metrics.nvgGasPipeTraps++;
          } else if (aimTarget.kind === 'enemy') {
            m.trigger(a);
          }
        }
      }

      // Execute chosen universal action / skill / drone / future capability
      if (out.pressedAction) {
        const actId = out.pressedAction;
        if (actId.startsWith('skill:')) {
          m.useSkill(a, actId.slice(6));
        } else if (actId === 'cap:buyDrone') {
          if (m.buyDrone?.(a)?.ok) this.metrics.nvgDroneBuys++;
        } else if (actId === 'cap:toggleScatter') {
          m.toggleDF40Scatter?.(a);
        } else if (actId.startsWith('future:')) {
          const found = actions.find(x => x.id === actId);
          if (found?._cap?.execute(a, m)) this.metrics.nvgFutureCaps++;
        }
      }

      totInf += g.core.inferences;
      totFlick += out.humanTelemetry.curvedFlicks;
      totLift += out.humanTelemetry.mouseLifts;
      totCreat += out.humanTelemetry.creativePlays;
      totAdapt += out.humanTelemetry.adaptationEvents;
      if (out.humanTelemetry.realismScore > bestReal) bestReal = out.humanTelemetry.realismScore;
    }

    this.metrics.nvgInferences = totInf;
    this.metrics.nvgCurvedFlicks = totFlick;
    this.metrics.nvgMouseLifts = totLift;
    this.metrics.nvgCreativePlays = totCreat;
    this.metrics.nvgAdaptations = totAdapt;
    this.metrics.nvgHumanRealismScore = Math.max(this.metrics.nvgHumanRealismScore, bestReal);
  }
}
