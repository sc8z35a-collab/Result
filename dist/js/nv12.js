import {incomingPathClear} from './ballistics.js';
import {NV11} from './nv11.js';
import {clamp, mix, angleDiff} from './geometry.js';
import {walkable, obstacles, obstruction, rayBox, moveActor, floorAt} from './yard.js';
import {eyeOf, targetPoint, postureStep, vertical} from './posture.js';

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lowCover = obstacles.filter(o => o.y0 === 0 && o.y1 > .53 && o.y1 <= 1.05 && o.x1 - o.x0 + o.z1 - o.z0 > 3.4);
const tallCover = obstacles.filter(o => o.y0 <= .1 && o.y1 >= 1.15 && (o.x1 - o.x0 >= .9 || o.z1 - o.z0 >= .9));
const weaponRange = {
  'SW T': {min: 20, ideal: 36, max: 58},
  MS10: {min: 18, ideal: 33, max: 56},
  SRA: {min: 13, ideal: 24, max: 40},
  D1: {min: 8, ideal: 17, max: 30},
  'DF1 OUT': {min: 14, ideal: 26, max: 44}
};
const coverAnchors = [];
for (const o of tallCover) {
  const pad = .78;
  const cx = (o.x0 + o.x1) * .5, cz = (o.z0 + o.z1) * .5;
  const pts = [
    [o.x0 - pad, o.z0 - pad], [o.x1 + pad, o.z0 - pad],
    [o.x0 - pad, o.z1 + pad], [o.x1 + pad, o.z1 + pad],
    [cx, o.z0 - pad], [cx, o.z1 + pad],
    [o.x0 - pad, cz], [o.x1 + pad, cz]
  ];
  for (const [x, z] of pts) {
    if (walkable(x, z, .52)) coverAnchors.push({x, z, o});
  }
}

// NV1.2 — Tactical Cognitive AI Engine evolved from NV1.1.
// Replaces reckless frontal charges with survival-first cover skirmishing,
// incoming-fire evasion, planned flanking, weapon range discipline,
// tactical ambushes, squad focus fire, and supply tanker control.
export class NV12 extends NV11 {
  constructor(match) {
    super(match);
    this.intel = [new Map(), new Map()];
    this.metrics = {
      ...this.metrics,
      cover: 0,
      flank: 0,
      disengage: 0,
      ambush: 0,
      resupply: 0,
      evade: 0,
      focusFire: 0
    };
  }

  attach(a) {
    super.attach(a);
    const b = this.brains.get(a.id);
    Object.assign(b, {
      contacts: new Map(),
      recentDamage: 0,
      damageClock: 0,
      underFireAt: -10,
      threatDir: null,
      cover: null,
      peekPhase: 'hide',
      peekSwitchAt: 0,
      holdUntil: 0,
      flankSide: b.rng() < .5 ? -1 : 1,
      flankUntil: 0,
      crouchFeintUntil: 0,
      lastCombatAt: this.match.time,
      planGoal: null,
      ambushYaw: a.yaw,
      ambushUntil: -10,
      ambushCooldown: -10,
      tankerTargetId: -1,
      prevState: '巡回'
    });
  }

  onHit(v, owner, dir, power) {
    if (v.human) return;
    const b = this.brains.get(v.id);
    if (!b) return;
    const t = this.match.time;
    b.recentDamage = Math.min(100, b.recentDamage + power);
    b.damageClock = t;
    b.underFireAt = t;
    b.lastCombatAt = t;
    if (dir) b.threatDir = [-dir[0], -dir[2]];
    if (owner && owner.team !== v.team) {
      b.contacts.set(owner.id, {
        x: owner.x, y: owner.y, z: owner.z,
        vx: owner.vx || 0, vz: owner.vz || 0,
        t, spawnId: owner.spawnId, seen: false, gun: owner.gun, hp: owner.hp + owner.shield
      });
      this.intel[v.team].set(owner.id, {x: owner.x, z: owner.z, t, by: v.id});
    }
    const needRetreat = v.hp < 64 || b.recentDamage >= 16 || v.shield <= 1 || v.mag <= 1;
    if (needRetreat) {
      b.planAt = 0;
      b.peekPhase = 'hide';
      b.peekSwitchAt = t + .95 + b.rng() * .5;
      b.holdUntil = Math.max(b.holdUntil, t + 1.5);
    } else if (t > b.crouchFeintUntil) {
      b.crouchFeintUntil = t + .42 + b.rng() * .25;
    }
  }

  detectIncoming(a, b) {
    const t = this.match.time;
    if (t - b.underFireAt < .22) return;
    const center = targetPoint(a);
    for (const s of this.match.shots) {
      if (s.team === a.team || s.materialPass) continue;
      const rx = center[0] - s.p[0], ry = center[1] - s.p[1], rz = center[2] - s.p[2];
      const forwardDist = rx * s.dir[0] + ry * s.dir[1] + rz * s.dir[2];
      if (forwardDist <= 0 || forwardDist > 26) continue;
      const point = s.p.map((v, i) => v + s.dir[i] * forwardDist);
      if (Math.hypot(point[0] - center[0], point[2] - center[2]) < 2.2 &&
          Math.abs(point[1] - center[1]) <= 1.2 && incomingPathClear(s, forwardDist, point)) {
        b.underFireAt = t;
        b.threatDir = [-s.dir[0], -s.dir[2]];
        this.metrics.evade++;
        if (a.hp < 75 || b.state === '巡回' || b.state === '戦術前進') {
          b.planAt = Math.min(b.planAt, t + .05);
          b.crouchFeintUntil = t + .45;
        }
        break;
      }
    }
  }

  perceive(a, b) {
    const match = this.match, t = match.time, eye = eyeOf(a);
    const prevId = b.targetId, prevSeen = b.seen ? {...b.seen} : null, prevSeenAt = b.seenAt;
    const teamIntel = this.intel[a.team];
    let choice = null, bestScore = -Infinity, visibleEnemies = 0;

    for (const [eid, info] of teamIntel) {
      if (t - info.t > 5.5) {
        teamIntel.delete(eid);
        continue;
      }
      const existing = b.contacts.get(eid);
      if (!existing || info.t > existing.t + .25) {
        b.contacts.set(eid, {
          x: info.x, y: 0, z: info.z, vx: 0, vz: 0,
          t: info.t, seen: false, gun: 'SRA', hp: 100
        });
      }
    }

    for (const e of match.actors) {
      if (!e.alive || e.team === a.team) {
        if (e.team !== a.team && !e.alive) {
          b.contacts.delete(e.id);
          teamIntel.delete(e.id);
        }
        continue;
      }
      const dx = e.x - a.x, dz = e.z - a.z, range = Math.hypot(dx, dz), yaw = Math.atan2(dx, -dz);
      const fovLimit = b.targetId === e.id ? 1.85 : t - b.underFireAt < 1.2 ? 2.15 : 1.42;
      if (range > 96 || (range > 8.5 && Math.abs(angleDiff(yaw, a.yaw)) > fovLimit)) continue;
      if (obstruction(eye, targetPoint(e)) < 1) continue;

      visibleEnemies++;
      b.lastCombatAt = t;
      const contact = {
        x: e.x, y: targetPoint(e)[1] - 1.23, z: e.z,
        vx: e.vx, vz: e.vz, t, seen: true, gun: e.gun, hp: e.hp + e.shield
      };
      b.contacts.set(e.id, contact);
      teamIntel.set(e.id, {x: e.x, z: e.z, t, by: a.id});

      const enemyToUs = Math.atan2(a.x - e.x, -(a.z - e.z));
      const aimingAtUs = Math.max(0, Math.cos(angleDiff(e.yaw, enemyToUs)));
      const lowHpBonus = clamp((110 - (e.hp + e.shield)) / 110, 0, 1) * .044;
      const gunThreat = e.gun === 'MS10' || e.gun === 'DF1 OUT' ? .012 : .004;
      let squadFocus = 0;
      for (const mate of match.actors) {
        if (mate === a || mate.team !== a.team || !mate.alive || mate.human) continue;
        const mb = this.brains.get(mate.id);
        if (mb?.targetId === e.id && t - mb.seenAt < .8) {
          squadFocus = .018;
          break;
        }
      }
      const score = 1 / (range + 8) + lowHpBonus + aimingAtUs * .022 + gunThreat + squadFocus + (e.id === b.targetId ? .012 : 0);
      if (score > bestScore) {
        bestScore = score;
        choice = e;
        if (squadFocus > 0 && b.targetId !== e.id) this.metrics.focusFire++;
      }
    }

    b.visibleEnemies = visibleEnemies;
    if (choice) {
      const newlySpotted = prevId !== choice.id || t - prevSeenAt > .95;
      if (newlySpotted) b.reactionAt = t + .14 + b.rng() * .25;
      b.targetId = choice.id;
      b.seen = {x: choice.x, z: choice.z, y: targetPoint(choice)[1] - 1.23, vx: choice.vx, vz: choice.vz, hp: choice.hp + choice.shield, gun: choice.gun};
      b.seenAt = t;
      if (prevSeen && prevId === choice.id && t - prevSeenAt > .04 && t - prevSeenAt < .55) {
        b.observedVelocity = [
          clamp((b.seen.x - prevSeen.x) / (t - prevSeenAt), -7, 7),
          clamp((b.seen.z - prevSeen.z) / (t - prevSeenAt), -7, 7)
        ];
      } else {
        b.aimStart = t;
        b.observedVelocity = [choice.vx || 0, choice.vz || 0];
      }
      b.confidence = Math.min(1, b.confidence + .24);
      b.oldSight = {x: choice.x, z: choice.z};
      const inbox = this.radio[a.team];
      if (!inbox.length || t - inbox.at(-1).t > .65) inbox.push({x: choice.x, z: choice.z, t});
      if (inbox.length > 8) inbox.shift();
    } else {
      b.confidence *= .85;
    }

    for (const [eid, c] of b.contacts) {
      if (t - c.t > 7.5) b.contacts.delete(eid);
    }

    const audible = this.events.findLast(e => e.team !== a.team && e.time > b.heardAt && Math.hypot(e.x - a.x, e.z - a.z) < 52);
    if (audible) {
      b.heard = [audible.x + (b.rng() - .5) * 5, audible.z + (b.rng() - .5) * 5];
      b.heardAt = audible.time;
    }

    b.sightAt = t + .10 + b.rng() * .08;
  }

  tacticalWeights(a, b) {
    const t = this.match.time, mem = this.experience.get(a.id), weights = new Map(this.traffic[a.team]);
    if (mem) {
      for (const [i, r] of mem) {
        const v = r.value * Math.exp(-(t - r.t) / 56);
        if (Math.abs(v) < .05) {
          mem.delete(i);
          continue;
        }
        weights.set(i, Math.max(0, (weights.get(i) || 0) + v * 1.45));
      }
    }
    for (const c of b.contacts.values()) {
      if (t - c.t > 4.5) continue;
      const mid = this.nav.closest([(a.x + c.x) * .5, (a.z + c.z) * .5]);
      if (mid >= 0) {
        weights.set(mid, (weights.get(mid) || 0) + 3.4);
        for (const [nb] of this.nav.links[mid]) weights.set(nb, (weights.get(nb) || 0) + 1.9);
      }
      const nearEnemy = this.nav.closest([c.x, c.z]);
      if (nearEnemy >= 0) weights.set(nearEnemy, (weights.get(nearEnemy) || 0) + 4.5);
    }
    return weights;
  }

  activeThreats(a, b) {
    const t = this.match.time, list = [];
    for (const [id, c] of b.contacts) {
      if (t - c.t < 4.5) list.push({id, ...c});
    }
    return list;
  }

  findCover(a, b, threats, mode = 'retreat') {
    const wr = weaponRange[a.gun] || weaponRange.SRA;
    const primary = threats[0];
    if (!primary) return null;
    const mates = this.match.actors.filter(m => m !== a && m.team === a.team && m.alive);
    const mem = this.experience.get(a.id);
    const maxSearch = mode === 'retreat' ? 19 : 24;
    let best = null, bestScore = -Infinity;

    for (const anchor of coverAnchors) {
      const dSelf = Math.hypot(anchor.x - a.x, anchor.z - a.z);
      if (dSelf > maxSearch || (mode === 'retreat' && dSelf < 1.1)) continue;
      const dEnemy = Math.hypot(anchor.x - primary.x, anchor.z - primary.z);
      if (mode === 'retreat' && dEnemy < 7) continue;

      let hiddenCount = 0;
      for (const th of threats) {
        if (obstruction([anchor.x, 1.32, anchor.z], [th.x, (th.y || 0) + 1.35, th.z]) < 1) hiddenCount++;
      }
      if (hiddenCount === 0) continue;

      let peekPt = null;
      if (mode === 'skirmish') {
        const dx = primary.x - anchor.x, dz = primary.z - anchor.z, len = Math.hypot(dx, dz) || 1;
        const rx = -dz / len, rz = dx / len;
        for (const s of [-1, 1]) {
          const px = anchor.x + rx * s * 1.18, pz = anchor.z + rz * s * 1.18;
          if (!walkable(px, pz, .45)) continue;
          if (obstruction([px, 1.48, pz], [primary.x, (primary.y || 0) + 1.25, primary.z]) > 1) {
            peekPt = [px, pz];
            break;
          }
        }
        if (!peekPt) continue;
      }

      const cell = this.nav.closest([anchor.x, anchor.z]);
      const danger = cell >= 0 && mem?.has(cell) ? Math.max(0, mem.get(cell).value) : 0;
      let mateBonus = 0;
      for (const m of mates) {
        const dm = Math.hypot(anchor.x - m.x, anchor.z - m.z);
        if (dm < 18 && dm > 3.5) mateBonus = Math.max(mateBonus, (18 - dm) * .28);
      }

      let score = (hiddenCount / threats.length) * 32 - dSelf * .62 - danger * 3.4 + mateBonus;
      if (mode === 'retreat') {
        score += clamp(dEnemy, 0, 42) * .45;
      } else {
        const rangePenalty = Math.abs(dEnemy - wr.ideal) * .48 + (dEnemy < wr.min ? (wr.min - dEnemy) * 1.4 : 0);
        score -= rangePenalty;
      }

      if (score > bestScore) {
        bestScore = score;
        best = {coverPt: [anchor.x, anchor.z], peekPt, enemyId: primary.id, score};
      }
    }
    return best;
  }

  findSupplyTanker(a, b, threats) {
    const tankers = this.match.tankers;
    if (!tankers?.length) return null;
    const needAmmo = a.stock < 55;
    const needBoost = (a.ammoRate || 1) < 1.45;
    if (!needAmmo && !needBoost) return null;
    let best = null, bestScore = -Infinity;
    for (const tk of tankers) {
      if (tk.cooldown > 2.5) continue;
      const dSelf = Math.hypot(tk.x - a.x, tk.z - a.z);
      if (dSelf > (needAmmo ? 72 : 42)) continue;
      let enemyNear = false;
      for (const th of threats) {
        if (Math.hypot(tk.x - th.x, tk.z - th.z) < 15) {
          enemyNear = true;
          break;
        }
      }
      if (enemyNear && a.hp < 75) continue;
      const score = (needAmmo ? 40 : 18) - dSelf * .75 - tk.cooldown * 3 - (enemyNear ? 24 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = tk;
      }
    }
    return bestScore > -12 ? best : null;
  }

  pickGoal(a, b) {
    const t = this.match.time, now = [a.x, a.z], dir = a.team === 0 ? -1 : 1;
    const weights = this.tacticalWeights(a, b);
    const threats = this.activeThreats(a, b);
    const fresh = b.seen && t - b.seenAt < .55;
    const range = b.seen ? Math.hypot(b.seen.x - a.x, b.seen.z - a.z) : Infinity;
    const wr = weaponRange[a.gun] || weaponRange.SRA;
    const prevState = b.state;

    const alliesNear = this.match.actors.filter(m => m !== a && m.team === a.team && m.alive && Math.hypot(m.x - a.x, m.z - a.z) < 26).length;
    const enemiesNear = threats.filter(th => Math.hypot(th.x - a.x, th.z - a.z) < 42).length;
    const outnumbered = enemiesNear >= 2 && alliesNear === 0;
    const underHeavyFire = b.recentDamage >= 16 || (t - b.underFireAt < .75 && a.hp < 68);
    const lowHealth = a.hp < 56 || (a.hp < 72 && a.shield <= 1 && (outnumbered || underHeavyFire));
    const emptyWeapon = a.mag === 0 || a.reload > 0;
    const enemyWeak = b.seen && b.seen.hp <= 28 && !outnumbered;

    let goal = null;

    // 1. SURVIVAL FIRST: Tactical disengagement to verified hard cover.
    if (threats.length && ((lowHealth && !enemyWeak) || (emptyWeapon && range < 42) || (outnumbered && a.hp < 82) || underHeavyFire)) {
      const cov = this.findCover(a, b, threats, 'retreat');
      b.state = '戦術退避';
      if (cov) {
        b.cover = cov;
        b.peekPhase = 'hide';
        b.holdUntil = Math.max(b.holdUntil, t + (lowHealth ? 2.4 : 1.3));
        goal = cov.coverPt;
      } else {
        const th = threats[0];
        const ax = a.x - th.x, az = a.z - th.z, L = Math.hypot(ax, az) || 1;
        goal = [a.x + ax / L * 12 + b.flankSide * (-az / L) * 6, a.z + az / L * 12 + b.flankSide * (ax / L) * 6];
      }
      if (prevState !== '戦術退避') this.metrics.disengage++;
    }

    // 2. RECOVER & REGROUP IN COVER: Finish reloading & rebuild shield behind hard cover.
    if (!goal && b.cover && t < b.holdUntil && threats.length) {
      const dCov = dist2(now, b.cover.coverPt);
      const nearestThreat = Math.min(...threats.map(th => Math.hypot(th.x - a.x, th.z - a.z)));
      if (dCov < 3.2 && nearestThreat > 8.5 && (a.reload > 0 || a.shield < 8 || a.hp < 60)) {
        b.state = '態勢立て直し';
        goal = b.cover.coverPt;
        b.peekPhase = 'hide';
      }
    }

    // 3. OBJECTIVE PLAY: Secure a nearby supply tanker for +100 ammo & 1.5x refine rate.
    if (!goal && (!fresh || range > 34) && a.hp >= 58) {
      const tk = this.findSupplyTanker(a, b, threats);
      if (tk) {
        const approach = [
          [tk.x + 2.3, tk.z], [tk.x - 2.3, tk.z], [tk.x, tk.z + 3.6], [tk.x, tk.z - 3.6]
        ].find(p => walkable(p[0], p[1], .55));
        if (approach) {
          b.state = '補給確保';
          b.tankerTargetId = tk.id;
          goal = approach;
          if (prevState !== '補給確保') this.metrics.resupply++;
        }
      }
    }

    // 4. COVER SKIRMISH & JIGGLE PEEK: Fight from cover at optimal weapon range.
    if (!goal && fresh) {
      const needNewCover = !b.cover || !b.cover.peekPt || b.cover.enemyId !== b.targetId || dist2(now, b.cover.coverPt) > 15;
      if (needNewCover) {
        const cov = this.findCover(a, b, threats, 'skirmish');
        if (cov) {
          b.cover = cov;
          this.metrics.cover++;
        }
      }
      if (b.cover?.peekPt && range >= wr.min * .75) {
        if (t >= b.peekSwitchAt) {
          const canPeek = a.mag > 0 && a.reload <= 0 && a.hp > 48;
          b.peekPhase = b.peekPhase === 'peek' || !canPeek ? 'hide' : 'peek';
          b.peekSwitchAt = t + (b.peekPhase === 'peek' ? (.78 + b.rng() * .58) : (.52 + b.rng() * .50));
        }
        b.state = b.peekPhase === 'peek' ? 'ピーク射撃' : '遮蔽交戦';
        goal = b.peekPhase === 'peek' ? b.cover.peekPt : b.cover.coverPt;
      } else if (range < wr.min) {
        const dx = (b.seen.x - a.x) / (range || 1), dz = (b.seen.z - a.z) / (range || 1);
        b.state = '引き撃ち';
        goal = [a.x - dx * 8 - dz * b.flankSide * 5, a.z - dz * 8 + dx * b.flankSide * 5];
      } else {
        const dx = (b.seen.x - a.x) / (range || 1), dz = (b.seen.z - a.z) / (range || 1);
        const adv = range > wr.max ? Math.min(14, range - wr.ideal) : range > wr.ideal + 5 ? 6 : 0;
        if (t > b.stepAt) {
          b.strafe = b.rng() < .5 ? -1 : 1;
          b.stepAt = t + .95 + b.rng() * 1.4;
        }
        b.state = adv > 0 ? '遮蔽接近' : '遮蔽交戦';
        goal = [a.x + dx * adv - dz * b.strafe * 4.2, a.z + dz * adv + dx * b.strafe * 4.2];
      }
    }

    // 5. TACTICAL AMBUSH, PREDICTIVE INTERCEPT & PLANNED FLANKING
    if (!goal && threats.length) {
      const th = threats[0];
      const dTh = Math.hypot(th.x - a.x, th.z - a.z);
      const lost = t - th.t;
      const mateEngaging = this.match.actors.some(m => m !== a && m.team === a.team && m.alive && Math.hypot(m.x - th.x, m.z - th.z) < 34);

      if (lost > .45 && lost < 3.6 && dTh < 30 && !mateEngaging && t > b.ambushCooldown) {
        const cov = this.findCover(a, b, threats, 'skirmish') || this.findCover(a, b, threats, 'retreat');
        if (cov) {
          b.state = '警戒待ち伏せ';
          const predX = th.x + (b.observedVelocity?.[0] || 0) * Math.min(1.1, lost);
          const predZ = th.z + (b.observedVelocity?.[1] || 0) * Math.min(1.1, lost);
          b.ambushYaw = Math.atan2(predX - a.x, -(predZ - a.z));
          b.ambushUntil = t + 1.85 + b.rng() * 1.15;
          b.ambushCooldown = t + 5.8;
          goal = cov.peekPt || cov.coverPt;
          this.metrics.ambush++;
          if (b.confidence > .18) this.metrics.intuition++;
        }
      }

      if (!goal && b.oldSight && lost > .43 && lost < 2.3 && t - b.predictionAt > 1.0 && b.confidence > .20) {
        const dtPred = Math.min(1.1, lost);
        const pt = [
          clamp(b.oldSight.x + b.observedVelocity[0] * dtPred + b.flankSide * 3.5, -22, 22),
          clamp(b.oldSight.z + b.observedVelocity[1] * dtPred, -94, 94)
        ];
        if (walkable(...pt, .52)) {
          b.state = '予測先回り';
          b.predictionAt = t;
          goal = pt;
          this.metrics.intuition++;
        }
      }

      if (!goal) {
        if (t > b.flankUntil) {
          b.flankSide = th.x > 0 ? -1 : 1;
          if (b.rng() < .35) b.flankSide *= -1;
          b.flankUntil = t + 5.5 + b.rng() * 3.5;
        }
        const sideX = clamp(th.x + b.flankSide * (11 + b.rng() * 5), -21, 21);
        const sideZ = clamp(th.z - dir * (mateEngaging ? 6 : 15), -92, 92);
        b.state = '側面展開';
        goal = [sideX, sideZ];
        if (prevState !== '側面展開') this.metrics.flank++;
      }
    }

    // 6. CAUTIOUS SOUND INVESTIGATION
    if (!goal && b.heard && t - b.heardAt < 4.5 && dist2(now, b.heard) > 5) {
      const hx = b.heard[0], hz = b.heard[1];
      const dx = hx - a.x, dz = hz - a.z, L = Math.hypot(dx, dz) || 1;
      b.state = '警戒確認';
      goal = [hx - dx / L * Math.min(11, L * .45) + b.flankSide * 3.5, hz - dz / L * Math.min(11, L * .45)];
    }

    // 7. BOUNDING SQUAD ADVANCE & DEEP SECTOR SWEEP (covers entire 200m wharf so quiet matches stay active)
    if (!goal) {
      const lane = b.profile.lane;
      const route = [
        [lane, dir * -42],
        [lane * .75 + 2, dir * -12],
        [lane * .65, dir * 18],
        [-lane * .45, dir * 48],
        [-lane * .65, dir * 74],
        [14, dir * 86],
        [-15, dir * 85],
        [-lane * .75, dir * 32],
        [lane * .6, dir * -14]
      ];
      if (b.waypoint === 0 && (a.z - route[0][1]) * dir > 0) b.waypoint = 1;
      goal = route[b.waypoint % route.length];
      if (dist2(now, goal) < 4.8) {
        b.waypoint = (b.waypoint + 1) % route.length;
        goal = route[b.waypoint];
      }
      b.state = '戦術前進';
    }

    goal = [clamp(goal[0], -23, 23), clamp(goal[1], -96, 96)];
    b.planGoal = goal;
    b.path = this.nav.route(now, goal, weights);

    // Retain NV1.1 low-cover vault planning for agile traversal across wharf barriers.
    if (b.vault && t < b.vault.until) {
      b.path = [[b.vault.x, b.vault.z], ...b.path.slice(0, 1)];
    } else {
      b.vault = null;
    }
    if (!b.vault && b.path.length && a.onGround && t - b.jumpAt > 4.2 && b.state !== '態勢立て直し' && b.state !== '警戒待ち伏せ') {
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

    b.planAt = t + (fresh || underHeavyFire ? .48 : 1.2) + b.rng() * .36;
  }

  choosePose(a, b) {
    const base = super.choosePose(a, b);
    const t = this.match.time;
    const crouching = base.crouch
      || b.state === '態勢立て直し'
      || b.state === '警戒待ち伏せ'
      || (b.state === '遮蔽交戦' && b.peekPhase === 'hide')
      || t < b.crouchFeintUntil;
    const ads = base.ads || (b.state === '警戒待ち伏せ' && a.reload <= 0) || (b.state === 'ピーク射撃' && a.reload <= 0);
    return {crouch: crouching && !b.vault && a.onGround, lean: base.lean, ads};
  }

  tick(dt) {
    const t = this.match.time;
    this.events = this.events.filter(e => t - e.time < 2.2);
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

      if (t - b.damageClock > 1.65) b.recentDamage = Math.max(0, b.recentDamage - dt * 18);

      this.detectIncoming(a, b);
      if (t >= b.sightAt) this.perceive(a, b);
      if (t >= b.planAt) this.pickGoal(a, b);

      if (t >= b.motionAt) {
        b.pose = this.choosePose(a, b);
        b.motionAt = t + .085 + b.rng() * .045;
      }
      const p = b.pose || {crouch: false, lean: 0, ads: false};
      if (b.vault && a.onGround && t - b.jumpAt > 3 && Math.hypot(b.vault.x - a.x, b.vault.z - a.z) < 3.55) {
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
      a.paceFactor = b.vault ? 1.13 : b.state === '戦術退避' ? 1.16 : 1 - a.crouch * .36 - a.aimPose * .10;
      vertical(a, dt, floorAt);

      while (b.path.length && Math.hypot(b.path[0][0] - a.x, b.path[0][1] - a.z) < .65) b.path.shift();
      const pt = b.path[0];
      let dx = pt ? pt[0] - a.x : 0, dz = pt ? pt[1] - a.z : 0, L = Math.hypot(dx, dz);
      if (L) {
        dx /= L;
        dz /= L;
      }

      if (t - b.underFireAt < .5 && b.threatDir && b.state !== '態勢立て直し') {
        const px = -b.threatDir[1] * b.strafe, pz = b.threatDir[0] * b.strafe;
        dx += px * .55;
        dz += pz * .55;
      }

      for (const mate of this.match.actors) {
        if (mate === a || !mate.alive) continue;
        const sx = a.x - mate.x, sz = a.z - mate.z, d = Math.hypot(sx, sz);
        const minSep = mate.team === a.team ? 1.85 : 1.36;
        if (d > .005 && d < minSep) {
          const v = (minSep - d) * 1.45;
          dx += sx / d * v;
          dz += sz / d * v;
        }
      }

      const combatSlow = (b.state === 'ピーク射撃' || b.state === '遮蔽交戦') ? .72 : b.state === '態勢立て直し' ? .45 : 1;
      const speed = b.profile.pace * combatSlow * (a.paceFactor || 1);
      const len = Math.max(1, Math.hypot(dx, dz));
      const ease = 1 - Math.exp(-8.5 * dt);
      b.vx = mix(b.vx, dx / len * speed, ease);
      b.vz = mix(b.vz, dz / len * speed, ease);
      const ox = a.x, oz = a.z;
      moveActor(a, b.vx * dt, b.vz * dt);
      a.vx = (a.x - ox) / dt;
      a.vz = (a.z - oz) / dt;
      a.stride += Math.hypot(a.vx, a.vz) * dt;

      if (t > b.progressAt) {
        if (pt && dist2(b.lastProgress, [a.x, a.z]) < .28 && b.state !== '態勢立て直し' && b.state !== '警戒待ち伏せ') {
          b.planAt = 0;
          b.strafe *= -1;
          b.flankSide *= -1;
          if (!b.seen || t - b.seenAt > 6) b.waypoint++;
        }
        b.lastProgress = [a.x, a.z];
        b.progressAt = t + 1.15;
      }

      const fresh = b.seen && t - b.seenAt < .42;
      let desiredYaw = a.yaw, desiredPitch = 0, range = 0;
      if (fresh) {
        const s = b.seen;
        range = Math.hypot(s.x - a.x, s.z - a.z);
        if (t > b.aimUntil) {
          const spread = (.13 + range * .010 + (1 - b.profile.aim) * .85) * (1 - .33 * (a.aimPose || 0)) * (1 - .14 * (a.crouch || 0));
          b.aimX = (b.rng() + b.rng() - 1) * spread;
          b.aimY = (b.rng() + b.rng() - 1) * spread * .60;
          b.aimUntil = t + .28 + b.rng() * .20;
        }
        const lead = range / this.match.weapon(a).speed * .74;
        const xx = s.x + s.vx * lead + b.aimX - a.x;
        const zz = s.z + s.vz * lead - a.z;
        desiredYaw = Math.atan2(xx, -zz);
        desiredPitch = Math.atan2(s.y + 1.12 + b.aimY - eyeOf(a)[1], Math.hypot(xx, zz));
      } else if (b.state === '警戒待ち伏せ' && t < b.ambushUntil) {
        desiredYaw = b.ambushYaw + Math.sin(t * 1.4 + a.id) * .16;
      } else if (b.threatDir && t - b.underFireAt < 1.1) {
        desiredYaw = Math.atan2(b.threatDir[0], -b.threatDir[1]);
      } else if (b.lookUntil > t && t - b.seenAt > .42) {
        desiredYaw = b.lookYaw;
      } else if (b.heard && t - b.heardAt < 1.1) {
        desiredYaw = Math.atan2(b.heard[0] - a.x, a.z - b.heard[1]);
      } else if (pt) {
        desiredYaw = Math.atan2(dx, -dz);
      } else {
        desiredYaw += Math.sin(t * .9 + a.id) * .42 * dt;
      }

      const turnRate = dt * (fresh ? 5.6 : t - b.underFireAt < 1 ? 5.2 : 3.6);
      a.yaw += clamp(angleDiff(desiredYaw, a.yaw), -turnRate, turnRate);
      a.pitch = mix(a.pitch, desiredPitch, 1 - Math.exp(-10 * dt));

      const canShoot = fresh
        && t > b.reactionAt
        && t > b.triggerAt
        && Math.abs(angleDiff(desiredYaw, a.yaw)) < .078
        && Math.abs(desiredPitch - a.pitch) < .085
        && (b.state !== '態勢立て直し' || range < 14);
      if (canShoot) {
        const w = this.match.weapon(a);
        const enemy = this.match.actors[b.targetId];
        if (enemy?.alive && obstruction(eyeOf(a), targetPoint(enemy)) > 1) {
          this.match.trigger(a);
          const paceMult = a.gun === 'MS10' ? (1.02 + b.rng() * .32) : (1.05 + b.rng() * .52);
          b.triggerAt = t + w.interval * paceMult + (b.rng() > .86 ? .20 : 0);
        }
      }

      const cap = this.match.weapon(a).capacity;
      if (a.mag === 0 || (!fresh && a.mag < cap * .60 && (b.state === '態勢立て直し' || b.state === '遮蔽交戦' || b.rng() < dt * .9))) {
        this.match.reload(a);
      }
    }
  }
}
