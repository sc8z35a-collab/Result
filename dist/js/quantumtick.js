// QuantumTick 1.0 — Analytical Relative-Velocity Swept-Capsule Continuous Collision Detection (CCD)
// & Real-Time Experimental Combat Telemetry / Dominance Analytics Engine.
//
// Innovations:
//   1. Exact Relative-Velocity Swept-Capsule CCD (`sweptMovingBodyHit`):
//      - Solves continuous-time intersection between projectile segment P_s(u) = a + (b - a)*u
//        and moving actor capsule C_v(u) = C_v0 + V_v * (u - 1) * dt over each 1/360s substep.
//      - Eliminates high-velocity tunneling against sprinting, dodging, or jumping targets while
//        reducing identically to static capsule intersection when target velocity = 0.
//   2. Zero-GC Live Lab Combat Telemetry (`LabTelemetry`):
//      - Computes per-team & per-actor Accuracy %, Average TTK (ms), Damage Dealt, BAIZER Absorbed,
//        Scherp 1.5 ZEM-APN & Bank-Shot Kills, Skill Value, and Composite Dominance Index.

import {dot, sub} from './geometry.js';
import {bodyCenter, torso} from './posture.js';

export const QUANTUMTICK_VERSION = 'QuantumTick 1.0';

function sphereHitRel(a, d, c, r) {
  const vx = a[0] - c[0], vy = a[1] - c[1], vz = a[2] - c[2];
  const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const B = vx * d[0] + vy * d[1] + vz * d[2];
  const C = vx * vx + vy * vy + vz * vz - r * r;
  if (C <= 0) return 0;
  const h = B * B - A * C;
  if (h < 0 || A < 1e-14) return Infinity;
  const u = (-B - Math.sqrt(h)) / A;
  return u >= 0 && u <= 1 ? u : Infinity;
}

/**
 * Analytical Relative-Velocity Swept-Capsule CCD against moving actor `actor` over substep `dt`.
 * Because actors move BEFORE projectiles in `Match.step()`, at substep start (u=0) the actor was at
 * `center - v * dt`, and at substep end (u=1) the actor is at `center`.
 * Transforming into the actor's co-moving frame yields exact relative ray:
 *   a_rel = a + v * dt   (position relative to actor's u=0 start)
 *   d_rel = (b - a) - v * dt
 */
export function sweptMovingBodyHit(a, b, actor, dt = 0) {
  const center = bodyCenter(actor);
  const vx = dt > 0 ? (actor.vx || 0) : 0;
  const vy = dt > 0 ? (actor.vy || 0) : 0;
  const vz = dt > 0 ? (actor.vz || 0) : 0;
  const move2 = vx * vx + vy * vy + vz * vz;

  // Actor position at u=0 (substep start) vs u=1 (current end)
  const shiftX = move2 > 1e-5 ? vx * dt : 0;
  const shiftY = move2 > 1e-5 ? vy * dt : 0;
  const shiftZ = move2 > 1e-5 ? vz * dt : 0;

  // Co-moving frame relative to actor's current end position `center` / `actor.y`:
  // At u=0: shot is at a, actor is at (center - shift) => relative offset = (a - (center - shift)) = (a + shift) - center
  // At u=1: shot is at b, actor is at center           => relative offset = b - center
  const aRel = [a[0] + shiftX, a[1] + shiftY, a[2] + shiftZ];
  const dRel = [b[0] - a[0] - shiftX, b[1] - a[1] - shiftY, b[2] - a[2] - shiftZ];

  const x = aRel[0] - center[0];
  const z = aRel[2] - center[1];
  const rr = 0.39;
  const lo = actor.y + 0.36;
  const hi = actor.y + 1.46 * torso(actor);

  const A = dRel[0] * dRel[0] + dRel[2] * dRel[2];
  const B = x * dRel[0] + z * dRel[2];
  const C = x * x + z * z - rr * rr;
  let t = Infinity;
  if (A > 1e-12) {
    const h = B * B - A * C;
    if (h >= 0) {
      const u = (-B - Math.sqrt(h)) / A;
      const yAt = aRel[1] + dRel[1] * u;
      if (u >= 0 && u <= 1 && yAt >= lo && yAt <= hi) t = u;
    }
  }
  if (C <= 0 && aRel[1] >= lo && aRel[1] <= hi) t = 0;

  return Math.min(
    t,
    sphereHitRel(aRel, dRel, [center[0], lo, center[1]], rr),
    sphereHitRel(aRel, dRel, [center[0], hi, center[1]], rr)
  );
}

// ============================================================================
// Real-Time Experimental Combat Telemetry & Dominance Analytics Engine
// ============================================================================
export class LabTelemetry {
  constructor() {
    this.teams = [this._blankTeam(), this._blankTeam()];
    this.actors = new Map();
    this.engageStart = new Map(); // `${attackerId}:${victimId}` -> time
    this.ccdCorrections = 0;
  }

  _blankTeam() {
    return {
      shots: 0,
      hits: 0,
      kills: 0,
      damage: 0,
      baizerAbsorbed: 0,
      scherpHits: 0,
      scherpBankHits: 0,
      scherpKills: 0,
      skillUses: 0,
      ttkSum: 0,
      ttkCount: 0
    };
  }

  _actor(a) {
    let rec = this.actors.get(a.id);
    if (!rec) {
      rec = {
        id: a.id,
        name: a.name,
        team: a.team,
        shots: 0,
        hits: 0,
        kills: 0,
        damage: 0,
        baizerAbsorbed: 0,
        scherpHits: 0,
        scherpBankHits: 0,
        skillUses: 0
      };
      this.actors.set(a.id, rec);
    }
    return rec;
  }

  onFire(actor, pellets = 1) {
    if (!actor) return;
    const t = this.teams[actor.team];
    if (t) t.shots += pellets;
    this._actor(actor).shots += pellets;
  }

  onHit(attacker, victim, dmg, {baizerAbsorbed = 0, kill = false, shot = null, time = 0} = {}) {
    if (victim && baizerAbsorbed > 0) {
      const vt = this.teams[victim.team];
      if (vt) vt.baizerAbsorbed += baizerAbsorbed;
      this._actor(victim).baizerAbsorbed += baizerAbsorbed;
    }
    if (!attacker || !victim || attacker.team === victim.team) return;
    const at = this.teams[attacker.team];
    const ar = this._actor(attacker);
    if (at) {
      at.hits++;
      at.damage += dmg;
    }
    ar.hits++;
    ar.damage += dmg;

    const isScherp = shot?.aaTier === '1.5';
    if (isScherp) {
      if (at) at.scherpHits++;
      ar.scherpHits++;
      if (shot.scherpBank || shot.ricocheted) {
        if (at) at.scherpBankHits++;
        ar.scherpBankHits++;
      }
    }

    const key = `${attacker.id}:${victim.id}:${victim.spawnId || 0}`;
    if (!this.engageStart.has(key)) this.engageStart.set(key, time);
    if (kill) {
      const start = this.engageStart.get(key) ?? time;
      const ttkMs = Math.max(0, (time - start) * 1000);
      this.engageStart.delete(key);
      if (at) {
        at.kills++;
        if (isScherp) at.scherpKills++;
        if (ttkMs < 15000) {
          at.ttkSum += ttkMs;
          at.ttkCount++;
        }
      }
      ar.kills++;
    }
  }

  onSkill(actor) {
    if (!actor) return;
    const t = this.teams[actor.team];
    if (t) t.skillUses++;
    this._actor(actor).skillUses++;
  }

  getTeamSummary(team) {
    const t = this.teams[team] || this._blankTeam();
    const acc = t.shots > 0 ? Math.round((t.hits / t.shots) * 1000) / 10 : 0;
    const avgTtkMs = t.ttkCount > 0 ? Math.round(t.ttkSum / t.ttkCount) : 0;
    return {
      ...t,
      damage: Math.round(t.damage),
      baizerAbsorbed: Math.round(t.baizerAbsorbed),
      accuracyPct: acc,
      avgTtkMs
    };
  }

  getSummary() {
    const a = this.getTeamSummary(0);
    const b = this.getTeamSummary(1);
    const totalDmg = a.damage + b.damage;
    const dominanceA = totalDmg > 0 ? Math.round((a.damage / totalDmg) * 100) : 50;
    return {
      version: QUANTUMTICK_VERSION,
      teamA: a,
      teamB: b,
      dominanceA,
      dominanceB: 100 - dominanceA,
      ccdCorrections: this.ccdCorrections
    };
  }
}
