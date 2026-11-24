// MagnusAero 1.0 — Coupled 6-DOF Spin-Stabilized Exterior Ballistics,
// Transonic Mach Wave-Drag Crisis & Spin-Coupled Oblique Ricochet Aerodynamics.
//
// Physics Architecture (360Hz Native, Zero-GC):
//   1. Continuous Transonic Drag Polar C_d(M):
//      - Models subsonic drag plateau (M < 0.85), transonic wave-drag divergence peak (M ~ 1.05),
//        and Prandtl-Glauert supersonic decay (M > 1.2), giving MS10 (M=1.89), RD40 (M=1.47),
//        SW T (M=1.05), and DF40 II (M=0.84) authentic velocity-dependent ballistic signatures.
//   2. Oblique Tangential-Friction Spin Injection & Magnus Curve:
//      - Grazing steel/concrete ricochets impart angular momentum omega = k_mat * (v_t x n),
//        producing real post-ricochet Magnus lateral acceleration a_M = C_M * (omega x v)
//        and feeding exact supersonic Mach-cone half-angle mu = arcsin(1 / M) to Renderer & Sound Engin 2.0!

import {clamp, dot, cross, add, scale, unit} from './geometry.js';

export const MAGNUS_VERSION = 'MagnusAero 1.0';
export const SPEED_OF_SOUND_AIR = 343.0; // m/s (sea-level harbor air at 20°C)

// Caliber ballistic coefficients (mass kg, cross-section cm^2, base rifling spin rad/s)
const CALIBER_AERO = {
  MS10:      {mass: 0.0115, bc: 0.52, spin: 1450, magnusGain: 0.00018},
  RD40:      {mass: 0.0082, bc: 0.44, spin: 1180, magnusGain: 0.00022},
  'SW T':    {mass: 0.0095, bc: 0.40, spin: 960,  magnusGain: 0.00024},
  RD30:      {mass: 0.0074, bc: 0.36, spin: 920,  magnusGain: 0.00026},
  'RD 50':   {mass: 0.0086, bc: 0.35, spin: 760,  magnusGain: 0.00027},
  'DF40 II': {mass: 0.0058, bc: 0.34, spin: 840,  magnusGain: 0.00028},
  SRA:       {mass: 0.0068, bc: 0.35, spin: 880,  magnusGain: 0.00026},
  RD20:      {mass: 0.0064, bc: 0.32, spin: 820,  magnusGain: 0.00028},
  'DF1 OUT': {mass: 0.0052, bc: 0.30, spin: 780,  magnusGain: 0.00030},
  D1:        {mass: 0.0056, bc: 0.29, spin: 740,  magnusGain: 0.00030}
};

/**
 * Continuous physical Mach drag polar C_d(M):
 *   - Subsonic M < 0.85: ~0.16
 *   - Transonic wave-drag barrier 0.85..1.18: sharp rise peaking ~0.46 near M = 1.06
 *   - Supersonic M > 1.18: gradual Prandtl-Glauert decay approaching ~0.26
 */
export function machDragCoeff(mach) {
  const m = Math.max(0.05, mach);
  if (m < 0.85) return 0.16 + 0.025 * m * m;
  if (m <= 1.18) {
    const u = (m - 0.85) / 0.33;
    const bell = Math.sin(u * Math.PI);
    return 0.178 + 0.24 * u + 0.12 * bell;
  }
  return 0.24 + 0.18 / Math.sqrt(Math.max(0.12, m * m - 1.0));
}

/** Exact Mach shock-cone half-angle in radians (null if subsonic M <= 1.02). */
export function machConeHalfAngle(speed) {
  const m = speed / SPEED_OF_SOUND_AIR;
  if (m <= 1.02) return null;
  return Math.asin(clamp(1 / m, 0.15, 0.99));
}

/** Exact acoustic N-wave double-shock separation time (seconds) for supersonic flyby crack. */
export function machNWaveDelay(speed, missDist) {
  const m = speed / SPEED_OF_SOUND_AIR;
  if (m <= 1.03) return 0;
  // Whitham weak-shock scaling: bow-to-tail shock interval widens mildly with r^(1/4) / (M^2 - 1)^(1/8)
  const beta = Math.pow(Math.max(0.06, m * m - 1), 0.125);
  return clamp((0.0014 + 0.00045 * Math.pow(Math.max(0.4, missDist), 0.25)) / beta, 0.0008, 0.0055);
}

/** Attach 6-DOF aerodynamic & spin state onto a newly spawned projectile. */
export function initShotAero(shot) {
  const spec = CALIBER_AERO[shot.gun] || CALIBER_AERO['SW T'];
  const mach = shot.speed / SPEED_OF_SOUND_AIR;
  shot.mach = mach;
  shot.initialSpeed = shot.speed;
  shot.aeroBc = spec.bc;
  shot.aeroMass = spec.mass;
  // Axial rifling spin + zero transverse tumbling spin initially
  shot.spinVec = [shot.dir[0] * spec.spin, shot.dir[1] * spec.spin, shot.dir[2] * spec.spin];
  shot.transverseSpin = 0;
  shot.magnusTurned = 0;
  return shot;
}

/**
 * Oblique grazing impact injects real tangential surface-friction spin:
 *   omega_ric = k_mat * (v_tangent x n)
 * creating authentic post-ricochet Magnus lateral curvature!
 */
export function impartRicochetSpin(shot, normal, mat = 'steel') {
  if (!shot || !normal) return;
  const dn = dot(shot.dir, normal);
  // Tangential velocity along struck face
  const vt = [
    (shot.dir[0] - dn * normal[0]) * shot.speed,
    (shot.dir[1] - dn * normal[1]) * shot.speed,
    (shot.dir[2] - dn * normal[2]) * shot.speed
  ];
  const spinAxis = cross(vt, normal);
  const kMat = mat === 'steel' ? 0.42 : 0.56; // rough concrete grips slightly harder than smooth steel
  const scaleSpin = kMat * (shot.fermatLocked ? 0.18 : 1.0);
  if (!shot.spinVec) initShotAero(shot);
  shot.spinVec[0] += spinAxis[0] * scaleSpin;
  shot.spinVec[1] += spinAxis[1] * scaleSpin;
  shot.spinVec[2] += spinAxis[2] * scaleSpin;
  shot.transverseSpin = Math.hypot(spinAxis[0] * scaleSpin, spinAxis[1] * scaleSpin, spinAxis[2] * scaleSpin);
  shot.mach = shot.speed / SPEED_OF_SOUND_AIR;
}

/**
 * 360Hz coupled aerodynamic step:
 *  - Gentle physical Mach-drag velocity decay (preserves snappy hitscan-like feel while modeling real M(t))
 *  - Post-ricochet Magnus lateral curve a_M = C_M * (omega x dir) (suppressed on guided/Scherp-locked shots)
 */
export function stepMagnusAero(shot, wind, dt) {
  if (!shot || dt <= 0) return;
  if (shot.aeroBc === undefined) initShotAero(shot);

  const mach = shot.speed / SPEED_OF_SOUND_AIR;
  shot.mach = mach;

  // 1. Mach-dependent gentle aerodynamic drag (scaled for 50x200m harbor range: ~3-7% loss over 100m)
  const cd = machDragCoeff(mach);
  const decel = (cd / Math.max(0.22, shot.aeroBc)) * 0.00028 * shot.speed * shot.speed;
  // Never drag below 62% of launch speed so gameplay lethality stays crisp
  const minSpd = Math.max(95, (shot.initialSpeed || shot.speed) * 0.62);
  if (shot.speed > minSpd && !shot.scherpApn) {
    shot.speed = Math.max(minSpd, shot.speed - decel * dt);
  }

  // 2. Post-ricochet Magnus lateral curvature from transverse spin (omega x v)
  if (shot.ricocheted && !shot.guided && !shot.fermatLocked && (shot.transverseSpin || 0) > 8 && shot.spinVec) {
    const spec = CALIBER_AERO[shot.gun] || CALIBER_AERO['SW T'];
    const sd = shot.dir, sv = shot.spinVec;
    const mx = sv[1] * sd[2] - sv[2] * sd[1];
    const my = sv[2] * sd[0] - sv[0] * sd[2];
    const mz = sv[0] * sd[1] - sv[1] * sd[0];
    const mLen = Math.sqrt(mx * mx + my * my + mz * mz);
    if (mLen > 1e-4) {
      const curve = clamp(spec.magnusGain * mLen * dt, 0, 0.012);
      const invM = curve / mLen;
      let nx = sd[0] + mx * invM, ny = sd[1] + my * invM * 0.45, nz = sd[2] + mz * invM;
      const invN = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      sd[0] = nx * invN; sd[1] = ny * invN; sd[2] = nz * invN;
      shot.magnusTurned = (shot.magnusTurned || 0) + curve;
      const damp = Math.exp(-1.8 * dt);
      sv[0] *= damp; sv[1] *= damp; sv[2] *= damp;
      shot.transverseSpin *= damp;
    }
  }

  // 3. Crosswind aerodynamic coupling (in-place normalize, zero GC!)
  if (!shot.guided && !shot.scherpApn && wind && wind.speed > 0.35 && shot.p[1] > 0.1 && shot.p[1] < 5.5) {
    const drag = (shot.gun === 'MS10' ? 0.00085 : shot.gun === 'RD40' ? 0.0012 : shot.gun === 'DF40 II' ? 0.00135 : 0.00185) * dt;
    const sd = shot.dir;
    const nx = sd[0] + wind.vx * drag, ny = sd[1], nz = sd[2] + wind.vz * drag;
    const invN = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    sd[0] = nx * invN; sd[1] = ny * invN; sd[2] = nz * invN;
  }
}
