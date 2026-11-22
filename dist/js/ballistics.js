// BallisticCore-X — 360Hz Multi-Medium Oblique Ricochet & Slab-Thickness Wall-Penetration Physics.
//
// Capabilities:
//   1. Oblique Fresnel-Critical Grazing Ricochet:
//      - Projectiles striking corrugated steel shipping containers (<= 24 deg grazing) or concrete
//        dock surfaces (<= 16 deg grazing) physically reflect with momentum-conserving velocity & damage
//        retention, deterministic surface-roughness angular jitter, molten spark spray, curved-pitch
//        ricochet audio, and live V-shaped 3D tracer trails — capable of real corner bank-shot kills!
//   2. True Slab-Thickness Material Penetration (Wallbang):
//      - Uses exact yard.js rayBoxSpan entry-to-exit slab thickness through struck wooden cargo crates
//        and thin steel container edges.
//      - High-velocity weapons (MS10 648 m/s, RD40 504 m/s, SW T / RD30 360 m/s, etc.) punch straight
//        through wooden crates with physically scaled kinetic energy attenuation, spawning BOTH an entry
//        scorch AND a far-side exit splinter/ember plume — creating direct tactical synergy with RD40's
//        D01 SENSOR behind-cover tracking!

import {clamp, dot, add, scale, unit} from './geometry.js';
import {obstruction} from './yard.js';

export const BALLISTICS_VERSION = 'BallisticCore-X 1.0';

// Per-weapon material penetration depth capacity (in meters of wood / thin steel edge)
export const WEAPON_PENETRATION = {
  MS10: {wood: 3.6, steel: 0.44, concrete: 0.22, maxPen: 2, maxRic: 2},
  'SW T': {wood: 3.0, steel: 0.32, concrete: 0.16, maxPen: 1, maxRic: 2},
  RD40: {wood: 2.9, steel: 0.30, concrete: 0.14, maxPen: 2, maxRic: 2},
  'DF40 II': {wood: 2.3, steel: 0.20, concrete: 0.09, maxPen: 1, maxRic: 2},
  RD30: {wood: 2.4, steel: 0.22, concrete: 0.10, maxPen: 1, maxRic: 2},
  SRA: {wood: 2.2, steel: 0.18, concrete: 0.08, maxPen: 1, maxRic: 1},
  RD20: {wood: 1.9, steel: 0.14, concrete: 0.06, maxPen: 1, maxRic: 1},
  D1: {wood: 1.7, steel: 0.12, concrete: 0.05, maxPen: 1, maxRic: 1},
  'DF1 OUT': {wood: 1.6, steel: 0.12, concrete: 0.05, maxPen: 1, maxRic: 1}
};

// Critical grazing incidence sine thresholds: sin(24°) ≈ 0.407 (steel), sin(16°) ≈ 0.276 (concrete)
export const RICOCHET_SIN_STEEL = 0.41;
export const RICOCHET_SIN_CONCRETE = 0.28;

export function incomingPathClear(shot, distance, point) {
  return !shot.materialPass && distance > 0 && distance <= shot.speed * (shot.life ?? Infinity) &&
    obstruction(shot.p, point) > 1;
}

/**
 * Evaluates a physical surface strike for BallisticCore-X:
 * Returns:
 *   - {action: 'ricochet', pos, dir, speed, damage, normal, mat, grazingSin}
 *   - {action: 'penetrate', entryPos, exitPos, exitNormal, dir, speed, damage, mat, thickness, retain}
 *   - {action: 'stop'}
 */
export function solveBallisticImpact(shot, hit, rng = null) {
  if (!shot || !hit || !hit.normal) return {action: 'stop'};
  const spec = WEAPON_PENETRATION[shot.gun] || WEAPON_PENETRATION.SRA;
  const mat = hit.mat || 'steel';
  const dir = shot.dir;
  const n = hit.normal;
  const dn = dot(dir, n);
  // Only evaluate front-facing strikes
  if (dn >= -1e-4) return {action: 'stop'};

  const sinGrazing = Math.abs(dn); // 0 = parallel graze, 1 = perpendicular hit
  const ricCount = shot.ricochets || 0;
  const penCount = shot.penetrations || 0;

  // 1. Check Oblique Grazing Ricochet on steel containers or concrete docks
  const critSin = mat === 'steel' ? RICOCHET_SIN_STEEL : mat === 'concrete' ? RICOCHET_SIN_CONCRETE : 0;
  if (critSin > 0 && sinGrazing <= critSin && ricCount < spec.maxRic && shot.speed >= 140 && shot.damage >= 1.2) {
    // True vector reflection r = d - 2*(d·n)*n + deterministic subtle surface-corrugation scatter
    const rx = dir[0] - 2 * dn * n[0];
    const ry = dir[1] - 2 * dn * n[1];
    const rz = dir[2] - 2 * dn * n[2];
    const jitter = (mat === 'steel' ? 0.032 : 0.048) * (shot.fermatLocked ? 0.20 : 1.0);
    const j1 = rng ? (rng() - 0.5) * 2 * jitter : 0;
    const j2 = rng ? (rng() - 0.5) * 2 * jitter * 0.55 : 0;
    const j3 = rng ? (rng() - 0.5) * 2 * jitter : 0;
    let rDir = unit([rx + j1, ry + j2, rz + j3]);
    // Guarantee reflected ray moves cleanly away from struck face
    if (dot(rDir, n) < 0.06) rDir = unit(add(rDir, scale(n, 0.14)));

    const speedRetain = mat === 'steel' ? 0.80 : 0.72;
    const dmgRetain = mat === 'steel' ? 0.74 : 0.65;
    const bouncePos = add(hit.point, scale(n, 0.045));
    return {
      action: 'ricochet',
      pos: bouncePos,
      impactPos: hit.point,
      dir: rDir,
      speed: shot.speed * speedRetain,
      damage: Math.max(1.0, Math.round(shot.damage * dmgRetain * 10) / 10),
      normal: n,
      mat,
      grazingSin: sinGrazing
    };
  }

  // 2. Check Exact Slab-Thickness Material Penetration (Wood crates & thin steel/concrete edges)
  const penBudget = spec[mat] || 0;
  const thick = Number.isFinite(hit.thickness) ? hit.thickness : Infinity;
  if (penBudget > 0 && thick > 0.02 && thick <= penBudget && hit.exitPoint && penCount < spec.maxPen && shot.speed >= 150 && shot.damage >= 1.5) {
    const lossFrac = clamp(thick / penBudget, 0.08, 0.85);
    const retain = clamp(1.0 - lossFrac * 0.56, 0.38, 0.90);
    const speedRetain = clamp(1.0 - lossFrac * 0.36, 0.52, 0.92);
    // Subtle ballistic yaw tumble after punching through solid cover
    const tumble = mat === 'wood' ? 0.014 : 0.024;
    const j1 = rng ? (rng() - 0.5) * 2 * tumble : 0;
    const j2 = rng ? (rng() - 0.5) * 2 * tumble * 0.6 : 0;
    const j3 = rng ? (rng() - 0.5) * 2 * tumble : 0;
    const exitDir = unit([dir[0] + j1, dir[1] + j2, dir[2] + j3]);
    const exitPos = add(hit.exitPoint, scale(exitDir, 0.06));
    if (exitPos[1] <= 0.01 && Math.abs(exitPos[0]) <= 25 && Math.abs(exitPos[2]) <= 100) {
      return {action: 'stop'};
    }
    return {
      action: 'penetrate',
      entryPos: hit.point,
      exitPos,
      exitNormal: hit.exitNormal || dir,
      dir: exitDir,
      speed: shot.speed * speedRetain,
      damage: Math.max(1.2, Math.round(shot.damage * retain * 10) / 10),
      mat,
      thickness: thick,
      retain
    };
  }

  return {action: 'stop'};
}
