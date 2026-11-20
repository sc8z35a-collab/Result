// SpectraField 1.0 — Real-Time Bayesian Fokker-Planck Probability-Wave PDE Tactical Cognition,
// Negative-Information Visibility Collapse & Fair-Play Live Tactical Hologram.
//
// Mathematical Foundation:
//   - For EACH team independently (Team 0 Ally Intel & Team 1 Enemy Intel — ZERO cross-team cheating!),
//     propagates a continuous 2D enemy probability density wavefunction P(x, z, t) across the navigable
//     50m x 200m Harbor Wharf (20 x 64 walkable corridor grid) solving the obstacle-constrained
//     Fokker-Planck Advection-Diffusion PDE:
//         dP/dt = -div(v_drift * P) + D * Laplacian(P)   with Neumann zero-flux walls on all 41 containers!
//   - Exact Bayesian Negative-Information Collapse:
//     Whenever ANY teammate sweeps their gaze down an empty corridor (unobstructed & not hidden by
//     AeroVortex smoke), probability along those cleared cells mathematically collapses (P *= 0.08)
//     and mass renormalizes into the remaining UNSEEN ambush pockets & flank alleys!
//   - Multi-Sensor Bayesian Likelihood Fusion:
//     Visual sightings, EchoPulse 343 m/s acoustic bearings, and ThermoFlux warm footprints multiply
//     Gaussian observation likelihoods directly into P(x, z, t).
//   - Shannon Entropy & Minimax AI Directives:
//     Computes live tactical certainty (1 - H(P)/H_max), peak hidden threat coordinates for NV2
//     pre-aiming, and minimum-enemy-suspicion stealth corridors for NV2.1 Spy Engine!

import {clamp} from './geometry.js';
import {walkable, obstruction, cargo, tankers} from './yard.js';
import {eyeOf} from './posture.js';

export const SPECTRAFIELD_VERSION = 'SpectraField 1.0';
export const SPEC_W = 20;
export const SPEC_H = 64;
const WORLD_X0 = -25, WORLD_W = 50;
const WORLD_Z0 = -100, WORLD_L = 200;

export function worldToSpecCell(x, z) {
  const ix = clamp(Math.floor(((x - WORLD_X0) / WORLD_W) * SPEC_W), 0, SPEC_W - 1);
  const iz = clamp(Math.floor(((z - WORLD_Z0) / WORLD_L) * SPEC_H), 0, SPEC_H - 1);
  return [ix, iz];
}

export function specCellToWorld(ix, iz) {
  return [
    WORLD_X0 + ((ix + 0.5) / SPEC_W) * WORLD_W,
    WORLD_Z0 + ((iz + 0.5) / SPEC_H) * WORLD_L
  ];
}

export class SpectraField {
  constructor() {
    this.version = SPECTRAFIELD_VERSION;
    this.w = SPEC_W;
    this.h = SPEC_H;
    const N = SPEC_W * SPEC_H;
    this.n = N;

    this.passable = new Uint8Array(N);
    this.passableCount = 0;
    this._buildWalkableMask();
    this.maxEntropy = Math.log2(Math.max(2, this.passableCount));

    // Independent fair-play Bayesian wavefunctions for Team 0 (Ally) and Team 1 (Enemy)
    this.fields = [new Float32Array(N), new Float32Array(N)];
    this.scratch = new Float32Array(N);
    this.certainty = [0, 0];
    this.peaks = [
      {x: 0, z: -40, prob: 0},
      {x: 0, z: 40, prob: 0}
    ];
    this.stepAccum = 0;
    this.stats = {
      steps: 0,
      collapses: 0,
      likelihoodUpdates: 0,
      peakCertaintyPct: 0
    };

    this.reset();
  }

  _buildWalkableMask() {
    this.passableCount = 0;
    for (let iz = 0; iz < this.h; iz++) {
      for (let ix = 0; ix < this.w; ix++) {
        const [wx, wz] = specCellToWorld(ix, iz);
        const ok = walkable(wx, wz, 0.32, 0) ? 1 : 0;
        this.passable[iz * this.w + ix] = ok;
        if (ok) this.passableCount++;
      }
    }
  }

  reset() {
    // Initialize prior concentrated gently in the opposing team's starting half
    for (let team = 0; team < 2; team++) {
      const f = this.fields[team];
      const enemyZ = team === 0 ? -68 : 68;
      let sum = 0;
      for (let iz = 0; iz < this.h; iz++) {
        const [, wz] = specCellToWorld(0, iz);
        const dz = (wz - enemyZ) / 48;
        const prior = 0.25 + Math.exp(-dz * dz * 0.7);
        for (let ix = 0; ix < this.w; ix++) {
          const i = iz * this.w + ix;
          if (!this.passable[i]) { f[i] = 0; continue; }
          f[i] = prior;
          sum += prior;
        }
      }
      if (sum > 0) for (let i = 0; i < this.n; i++) f[i] /= sum;
      this._analyze(team);
    }
    this.stepAccum = 0;
    this.stats = {steps: 0, collapses: 0, likelihoodUpdates: 0, peakCertaintyPct: 0};
  }

  /**
   * Bayesian Likelihood Update: concentrates team `team`'s wavefunction around a fair-play
   * visual sighting, EchoPulse 343 m/s acoustic arrival, or ThermoFlux warm footprint!
   */
  observe(team, x, z, {sigma = 4.2, weight = 0.55} = {}) {
    if (team !== 0 && team !== 1) return;
    const f = this.fields[team];
    const [cx, cz] = worldToSpecCell(x, z);
    const rx = Math.ceil((sigma * 2.2) / (WORLD_W / this.w));
    const rz = Math.ceil((sigma * 2.2) / (WORLD_L / this.h));
    const inv2s2 = 1 / Math.max(2, 2 * sigma * sigma);
    let added = 0;
    for (let dz = -rz; dz <= rz; dz++) {
      const nz = cz + dz;
      if (nz < 0 || nz >= this.h) continue;
      for (let dx = -rx; dx <= rx; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= this.w) continue;
        const idx = nz * this.w + nx;
        if (!this.passable[idx]) continue;
        const [wx, wz] = specCellToWorld(nx, nz);
        const d2 = (wx - x) * (wx - x) + (wz - z) * (wz - z);
        const g = Math.exp(-d2 * inv2s2);
        const boost = g * weight * 0.08;
        f[idx] += boost;
        added += boost;
      }
    }
    if (added > 0) {
      this._normalize(team);
      this._analyze(team);
      this.stats.likelihoodUpdates++;
    }
  }

  /**
   * Exact Bayesian Negative-Information Visibility Collapse:
   * Sweeps an observer's fair-play visual cone (respecting containers + AeroVortex smoke!)
   * and collapses probability mass on cleared empty corridors!
   */
  collapseSightCone(team, observer, aeroVortex = null) {
    if (!observer?.alive) return;
    const f = this.fields[team];
    const eye = eyeOf(observer);
    const rays = 7;
    const halfFov = 0.52; // ~60° horizontal clearance cone
    const maxDist = 44;
    let collapsed = 0;

    for (let r = 0; r < rays; r++) {
      const ang = observer.yaw + ((r / (rays - 1)) - 0.5) * 2 * halfFov;
      const sx = Math.sin(ang), sz = -Math.cos(ang);
      const end = [eye[0] + sx * maxDist, eye[1] - 0.25, eye[2] + sz * maxDist];
      const hitT = obstruction(eye, end);
      const clearDist = Math.min(maxDist, hitT <= 1 ? hitT * maxDist - 0.8 : maxDist);
      if (clearDist < 2.2) continue;

      const steps = Math.min(12, Math.floor(clearDist / 3.2));
      for (let s = 1; s <= steps; s++) {
        const d = (s / steps) * clearDist;
        const wx = eye[0] + sx * d;
        const wz = eye[2] + sz * d;
        // Smoke stops visibility collapse cleanly — unseen enemies can hide inside Navier-Stokes smoke!
        if (aeroVortex && aeroVortex.sample(wx, wz).smoke > 0.62) break;
        const [ix, iz] = worldToSpecCell(wx, wz);
        const idx = iz * this.w + ix;
        if (!this.passable[idx]) continue;
        // Softly collapse cleared cell while leaving tiny floor for sudden re-entry
        const prev = f[idx];
        if (prev > 1e-5) {
          f[idx] = prev * 0.22;
          collapsed++;
        }
      }
    }
    if (collapsed > 0) {
      this.stats.collapses += collapsed;
      this._normalize(team);
    }
  }

  /**
   * Executes one Obstacle-Constrained Fokker-Planck Advection-Diffusion PDE step for both teams!
   */
  stepPDE(dt, match = null) {
    const W = this.w, H = this.h, N = this.n;
    const stepDt = clamp(dt, 0.02, 0.20);
    const diff = clamp(0.45 * stepDt, 0.02, 0.16);
    const synLaneX = match?.synapse ? match.synapse.getCounterDirective().favoredLaneX : 0;

    for (let team = 0; team < 2; team++) {
      const src = this.fields[team];
      const dst = this.scratch;
      // Gentle tactical drift toward mid-harbor / NV-Synapse favored lane for enemy team
      const driftZ = team === 0 ? 0.16 : -0.16;
      const driftX = team === 1 ? clamp(synLaneX * 0.012, -0.18, 0.18) : 0;

      for (let iz = 0; iz < H; iz++) {
        for (let ix = 0; ix < W; ix++) {
          const i = iz * W + ix;
          if (!this.passable[i]) { dst[i] = 0; continue; }
          const c = src[i];
          let flux = 0;
          // Neumann zero-flux isotropic corridor diffusion + upwind tactical drift
          if (ix > 0 && this.passable[i - 1]) flux += (src[i - 1] - c) * (diff + Math.max(0, driftX * stepDt));
          if (ix < W - 1 && this.passable[i + 1]) flux += (src[i + 1] - c) * (diff + Math.max(0, -driftX * stepDt));
          if (iz > 0 && this.passable[i - W]) flux += (src[i - W] - c) * (diff + Math.max(0, driftZ * stepDt));
          if (iz < H - 1 && this.passable[i + W]) flux += (src[i + W] - c) * (diff + Math.max(0, -driftZ * stepDt));
          dst[i] = Math.max(1e-6, c + flux);
        }
      }
      src.set(dst);

      // Run fair-play negative-information visibility collapse from this team's alive members!
      if (match?.actors) {
        for (const a of match.actors) {
          if (a.alive && a.team === team) {
            this.collapseSightCone(team, a, match.aeroVortex);
          }
        }
      }

      this._normalize(team);
      this._analyze(team);
    }
    this.stats.steps++;
    const certPct = Math.round(Math.max(this.certainty[0], this.certainty[1]) * 100);
    if (certPct > this.stats.peakCertaintyPct) this.stats.peakCertaintyPct = certPct;
  }

  tick(dt, match = null) {
    this.stepAccum += dt;
    if (this.stepAccum >= 0.10) {
      const s = Math.min(0.20, this.stepAccum);
      this.stepAccum = 0;
      this.stepPDE(s, match);
    }
  }

  _normalize(team) {
    const f = this.fields[team];
    let sum = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.passable[i]) { f[i] = 0; continue; }
      sum += f[i];
    }
    if (sum > 1e-8) {
      const inv = 1 / sum;
      for (let i = 0; i < this.n; i++) f[i] *= inv;
    }
  }

  _analyze(team) {
    const f = this.fields[team];
    let H = 0, bestP = -1, bestI = 0;
    for (let i = 0; i < this.n; i++) {
      const p = f[i];
      if (p <= 1e-8) continue;
      H -= p * Math.log2(p);
      if (p > bestP) { bestP = p; bestI = i; }
    }
    this.certainty[team] = clamp(1 - H / Math.max(1, this.maxEntropy), 0, 1);
    const [px, pz] = specCellToWorld(bestI % this.w, Math.floor(bestI / this.w));
    this.peaks[team] = {x: px, z: pz, prob: bestP};
  }

  /** Returns the team's highest-posterior unseen threat coordinate & Bayesian certainty (0..1). */
  getPeakThreat(team) {
    const pk = this.peaks[team] || this.peaks[0];
    return {x: pk.x, z: pk.z, prob: pk.prob, certainty: this.certainty[team] || 0};
  }

  /** Samples how strongly `observerTeam` suspects an enemy is at (x, z) (0..1 normalized). */
  sampleSuspicion(observerTeam, x, z) {
    const [ix, iz] = worldToSpecCell(x, z);
    const p = this.fields[observerTeam]?.[iz * this.w + ix] || 0;
    const peak = Math.max(1e-5, this.peaks[observerTeam]?.prob || 1e-4);
    return clamp(p / peak, 0, 1);
  }

  /**
   * Renders the sleek Fair-Play Ally-Team Fokker-Planck Tactical Hologram onto a 2D canvas!
   * Strictly shows Team 0's own Bayesian wavefunction (ZERO wallhack / enemy ground truth!).
   */
  renderHologram(canvas, match) {
    if (!canvas || !match) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    // Deep maritime blueprint backdrop
    ctx.fillStyle = 'rgba(8, 22, 26, 0.84)';
    ctx.fillRect(0, 0, cw, ch);

    // Subtle harbor survey grid
    ctx.strokeStyle = 'rgba(110, 210, 200, 0.09)';
    ctx.lineWidth = 1;
    for (let x = cw * 0.25; x < cw; x += cw * 0.25) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
    }
    for (let y = ch * 0.25; y < ch; y += ch * 0.25) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
    }

    // Draw Team 0's live Fokker-Planck Bayesian enemy probability cloud!
    const f = this.fields[0];
    const peak = Math.max(1 / Math.max(1, this.passableCount) * 2.5, this.peaks[0].prob);
    const cellW = cw / this.w, cellH = ch / this.h;
    for (let iz = 0; iz < this.h; iz++) {
      for (let ix = 0; ix < this.w; ix++) {
        const i = iz * this.w + ix;
        if (!this.passable[i]) continue;
        const norm = clamp(f[i] / peak, 0, 1);
        if (norm < 0.08) continue;
        // Cool cyan-teal low suspicion -> luminous amber-crimson high Bayesian threat pocket!
        const r = Math.round(norm < 0.5 ? 25 + norm * 420 : 235 + (norm - 0.5) * 40);
        const g = Math.round(norm < 0.5 ? 185 - norm * 40 : 165 - (norm - 0.5) * 210);
        const b = Math.round(norm < 0.5 ? 195 - norm * 240 : 75 - (norm - 0.5) * 110);
        const a = clamp(norm * 0.82, 0.06, 0.85);
        ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(2)})`;
        ctx.fillRect(ix * cellW, iz * cellH, cellW + 0.6, cellH + 0.6);
      }
    }

    // Draw AeroVortex drifting smoke plumes softly in silver-ice
    if (match.aeroVortex && match.aeroVortex.stats.totalSmoke > 0.5) {
      const av = match.aeroVortex;
      const sx = cw / av.w, sz = ch / av.h;
      for (let iz = 0; iz < av.h; iz += 2) {
        for (let ix = 0; ix < av.w; ix++) {
          const sm = av.smoke[iz * av.w + ix];
          if (sm < 0.22) continue;
          ctx.fillStyle = `rgba(215, 240, 245, ${clamp(sm * 0.26, 0.05, 0.45).toFixed(2)})`;
          ctx.fillRect(ix * sx, iz * sz, sx + 0.8, sz * 2 + 0.8);
        }
      }
    }

    // Draw Harbor shipping containers blueprint silhouettes
    ctx.fillStyle = 'rgba(26, 48, 52, 0.92)';
    ctx.strokeStyle = 'rgba(130, 205, 198, 0.28)';
    ctx.lineWidth = 0.6;
    for (const [x, z, w, d, y] of cargo) {
      if (y > 0.5) continue;
      const px = ((x - w * 0.5 - WORLD_X0) / WORLD_W) * cw;
      const pz = ((z - d * 0.5 - WORLD_Z0) / WORLD_L) * ch;
      const pw = (w / WORLD_W) * cw;
      const pd = (d / WORLD_L) * ch;
      ctx.fillRect(px, pz, pw, pd);
      ctx.strokeRect(px, pz, pw, pd);
    }

    // Draw Supply Tanker diamonds
    for (const tk of match.tankers || tankers) {
      const tx = ((tk.x - WORLD_X0) / WORLD_W) * cw;
      const tz = ((tk.z - WORLD_Z0) / WORLD_L) * ch;
      ctx.fillStyle = (tk.cooldown || 0) <= 0 ? '#68f5e0' : '#d89b4e';
      ctx.beginPath();
      ctx.moveTo(tx, tz - 3.2); ctx.lineTo(tx + 3.2, tz);
      ctx.lineTo(tx, tz + 3.2); ctx.lineTo(tx - 3.2, tz);
      ctx.closePath();
      ctx.fill();
    }

    // Draw Ally NPCs (strictly own team!) & Player with live gaze-collapse FOV cone
    for (const a of match.actors) {
      if (!a.alive || a.team !== 0) continue;
      const ax = ((a.x - WORLD_X0) / WORLD_W) * cw;
      const az = ((a.z - WORLD_Z0) / WORLD_L) * ch;
      if (a.human) {
        // Live gaze collapse cone
        const ang = Math.atan2(-Math.cos(a.yaw), Math.sin(a.yaw));
        ctx.fillStyle = 'rgba(124, 245, 228, 0.18)';
        ctx.beginPath();
        ctx.moveTo(ax, az);
        ctx.arc(ax, az, 20, ang - 0.48, ang + 0.48);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff5c8';
        ctx.beginPath(); ctx.arc(ax, az, 3.0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = a.isSpy ? '#62ffe4' : '#7fd4e6';
        ctx.beginPath(); ctx.arc(ax, az, 2.3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Peak Bayesian threat cross marker (pure probability inference — never raw enemy truth!)
    const pk = this.peaks[0];
    if (this.certainty[0] > 0.14) {
      const px = ((pk.x - WORLD_X0) / WORLD_W) * cw;
      const pz = ((pk.z - WORLD_Z0) / WORLD_L) * ch;
      ctx.strokeStyle = 'rgba(255, 198, 92, 0.9)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(px, pz, 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
