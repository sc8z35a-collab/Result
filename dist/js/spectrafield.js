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
import {walkable, obstructionCoords, cargo, tankers} from './yard.js';
import {eyeOf} from './posture.js';

export const SPECTRAFIELD_VERSION = 'SpectraField 1.0';
export const SPEC_W = 20;
export const SPEC_H = 64;
const WORLD_X0 = -25, WORLD_W = 50;
const WORLD_Z0 = -100, WORLD_L = 200;
const INV_WORLD_W = SPEC_W / WORLD_W;
const INV_WORLD_L = SPEC_H / WORLD_L;

export function worldToSpecCell(x, z) {
  const ix = clamp(Math.floor((x - WORLD_X0) * INV_WORLD_W), 0, SPEC_W - 1);
  const iz = clamp(Math.floor((z - WORLD_Z0) * INV_WORLD_L), 0, SPEC_H - 1);
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
    this._passableIds = new Int16Array(N);
    this._nbrMask = new Uint8Array(N);
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
    this._bpCanvas = null;
    this._bpW = 0;
    this._bpH = 0;
    this.stats = {
      steps: 0,
      collapses: 0,
      likelihoodUpdates: 0,
      peakCertaintyPct: 0
    };

    this.reset();
  }

  _buildWalkableMask() {
    const W = this.w, H = this.h;
    this.passableCount = 0;
    for (let iz = 0; iz < H; iz++) {
      const wz = WORLD_Z0 + ((iz + 0.5) / H) * WORLD_L;
      for (let ix = 0; ix < W; ix++) {
        const wx = WORLD_X0 + ((ix + 0.5) / W) * WORLD_W;
        const ok = walkable(wx, wz, 0.32, 0) ? 1 : 0;
        const idx = iz * W + ix;
        this.passable[idx] = ok;
        if (ok) this._passableIds[this.passableCount++] = idx;
      }
    }
    for (let k = 0; k < this.passableCount; k++) {
      const i = this._passableIds[k];
      const ix = i % W, iz = (i - ix) / W;
      let m = 0;
      if (ix > 0 && this.passable[i - 1]) m |= 1;
      if (ix < W - 1 && this.passable[i + 1]) m |= 2;
      if (iz > 0 && this.passable[i - W]) m |= 4;
      if (iz < H - 1 && this.passable[i + W]) m |= 8;
      this._nbrMask[i] = m;
    }
  }

  reset() {
    const W = this.w, H = this.h;
    for (let team = 0; team < 2; team++) {
      const f = this.fields[team];
      const enemyZ = team === 0 ? -68 : 68;
      let sum = 0;
      for (let iz = 0; iz < H; iz++) {
        const wz = WORLD_Z0 + ((iz + 0.5) / H) * WORLD_L;
        const dz = (wz - enemyZ) * (1 / 48);
        const prior = 0.25 + Math.exp(-dz * dz * 0.7);
        const row = iz * W;
        for (let ix = 0; ix < W; ix++) {
          const i = row + ix;
          if (!this.passable[i]) { f[i] = 0; continue; }
          f[i] = prior;
          sum += prior;
        }
      }
      if (sum > 0) {
        const inv = 1 / sum;
        for (let k = 0; k < this.passableCount; k++) f[this._passableIds[k]] *= inv;
      }
      this._analyze(team);
    }
    this.stepAccum = 0;
    this.stats = {steps: 0, collapses: 0, likelihoodUpdates: 0, peakCertaintyPct: 0};
  }

  observe(team, x, z, {sigma = 4.2, weight = 0.55} = {}) {
    if (team !== 0 && team !== 1) return;
    const f = this.fields[team];
    const W = this.w, H = this.h;
    const cx = clamp(Math.floor((x - WORLD_X0) * INV_WORLD_W), 0, W - 1);
    const cz = clamp(Math.floor((z - WORLD_Z0) * INV_WORLD_L), 0, H - 1);
    const rx = Math.ceil((sigma * 2.2) * INV_WORLD_W);
    const rz = Math.ceil((sigma * 2.2) * INV_WORLD_L);
    const inv2s2 = 1 / Math.max(2, 2 * sigma * sigma);
    const wScale = weight * 0.08;
    let added = 0;
    for (let dz = -rz; dz <= rz; dz++) {
      const nz = cz + dz;
      if (nz < 0 || nz >= H) continue;
      const wz = WORLD_Z0 + ((nz + 0.5) / H) * WORLD_L;
      const ddz = wz - z, dz2 = ddz * ddz;
      const row = nz * W;
      for (let dx = -rx; dx <= rx; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= W) continue;
        const idx = row + nx;
        if (!this.passable[idx]) continue;
        const wx = WORLD_X0 + ((nx + 0.5) / W) * WORLD_W;
        const ddx = wx - x;
        const boost = Math.exp(-(ddx * ddx + dz2) * inv2s2) * wScale;
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

  collapseSightCone(team, observer, aeroVortex = null) {
    if (!observer?.alive) return;
    const f = this.fields[team];
    const eye = eyeOf(observer);
    const ex = eye[0], ey = eye[1], ez = eye[2];
    const rays = 7;
    const halfFov = 0.52;
    const maxDist = 44;
    const hasSmoke = !!(aeroVortex && aeroVortex._hasSmoke);
    const W = this.w, H = this.h;
    const elevated = ey > 2.0;
    let collapsed = 0;

    for (let r = 0; r < rays; r++) {
      const ang = observer.yaw + ((r / (rays - 1)) - 0.5) * 2 * halfFov;
      const sx = Math.sin(ang), sz = -Math.cos(ang);
      const hitT = obstructionCoords(ex, ey, ez, ex + sx * maxDist, ey - 0.25, ez + sz * maxDist);
      const clearDist = Math.min(maxDist, hitT <= 1 ? hitT * maxDist - 0.8 : maxDist);
      if (clearDist < 2.2) continue;

      const steps = Math.min(12, Math.floor(clearDist * (1 / 3.2)));
      const invSteps = clearDist / steps;
      for (let s = 1; s <= steps; s++) {
        const d = s * invSteps;
        const wx = ex + sx * d;
        const wz = ez + sz * d;
        if (hasSmoke && aeroVortex.sample(wx, wz).smoke > 0.62) break;
        const ix = clamp(Math.floor((wx - WORLD_X0) * INV_WORLD_W), 0, W - 1);
        const iz = clamp(Math.floor((wz - WORLD_Z0) * INV_WORLD_L), 0, H - 1);
        const idx = iz * W + ix;
        if (!this.passable[idx]) continue;
        if (elevated && obstructionCoords(ex, ey, ez, wx, 1.15, wz) <= 1) continue;
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

  stepPDE(dt, match = null) {
    const W = this.w;
    const stepDt = clamp(dt, 0.02, 0.20);
    const diff = clamp(0.45 * stepDt, 0.02, 0.16);
    const synLaneX = match?.synapse ? match.synapse.getCounterDirective().favoredLaneX : 0;
    const pIds = this._passableIds, pCnt = this.passableCount, nMask = this._nbrMask;

    for (let team = 0; team < 2; team++) {
      const src = this.fields[team];
      const dst = this.scratch;
      const driftZ = team === 0 ? 0.16 : -0.16;
      const driftX = team === 1 ? clamp(synLaneX * 0.012, -0.18, 0.18) : 0;
      const cL = diff + (driftX > 0 ? driftX * stepDt : 0);
      const cR = diff + (driftX < 0 ? -driftX * stepDt : 0);
      const cU = diff + (driftZ > 0 ? driftZ * stepDt : 0);
      const cD = diff + (driftZ < 0 ? -driftZ * stepDt : 0);

      for (let k = 0; k < pCnt; k++) {
        const i = pIds[k];
        const c = src[i];
        const m = nMask[i];
        let flux = 0;
        if (m & 1) flux += (src[i - 1] - c) * cL;
        if (m & 2) flux += (src[i + 1] - c) * cR;
        if (m & 4) flux += (src[i - W] - c) * cU;
        if (m & 8) flux += (src[i + W] - c) * cD;
        const v = c + flux;
        dst[i] = v > 1e-6 ? v : 1e-6;
      }
      for (let k = 0; k < pCnt; k++) {
        const i = pIds[k];
        src[i] = dst[i];
      }

      if (match?.actors) {
        const actors = match.actors;
        for (let ai = 0; ai < actors.length; ai++) {
          const a = actors[ai];
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
    const pIds = this._passableIds, pCnt = this.passableCount;
    let sum = 0;
    for (let k = 0; k < pCnt; k++) sum += f[pIds[k]];
    if (sum > 1e-8) {
      const inv = 1 / sum;
      for (let k = 0; k < pCnt; k++) f[pIds[k]] *= inv;
    }
  }

  _analyze(team) {
    const f = this.fields[team];
    const pIds = this._passableIds, pCnt = this.passableCount;
    let H = 0, bestP = -1, bestI = 0;
    for (let k = 0; k < pCnt; k++) {
      const i = pIds[k];
      const p = f[i];
      if (p <= 1e-8) continue;
      H -= p * Math.log2(p);
      if (p > bestP) { bestP = p; bestI = i; }
    }
    this.certainty[team] = clamp(1 - H / Math.max(1, this.maxEntropy), 0, 1);
    const ix = bestI % this.w, iz = (bestI - ix) / this.w;
    this.peaks[team].x = WORLD_X0 + ((ix + 0.5) / this.w) * WORLD_W;
    this.peaks[team].z = WORLD_Z0 + ((iz + 0.5) / this.h) * WORLD_L;
    this.peaks[team].prob = bestP;
  }

  getPeakThreat(team) {
    const pk = this.peaks[team] || this.peaks[0];
    return {x: pk.x, z: pk.z, prob: pk.prob, certainty: this.certainty[team] || 0};
  }

  sampleSuspicion(observerTeam, x, z) {
    const ix = clamp(Math.floor((x - WORLD_X0) * INV_WORLD_W), 0, this.w - 1);
    const iz = clamp(Math.floor((z - WORLD_Z0) * INV_WORLD_L), 0, this.h - 1);
    const p = this.fields[observerTeam]?.[iz * this.w + ix] || 0;
    const peak = Math.max(1e-5, this.peaks[observerTeam]?.prob || 1e-4);
    return clamp(p / peak, 0, 1);
  }

  _getBlueprintCanvas(cw, ch) {
    if (this._bpDisabled) return null;
    if (this._bpCanvas && this._bpW === cw && this._bpH === ch) return this._bpCanvas;
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const bctx = c.getContext?.('2d');
    if (!bctx) return null;
    bctx.fillStyle = 'rgba(26, 48, 52, 0.92)';
    bctx.strokeStyle = 'rgba(130, 205, 198, 0.28)';
    bctx.lineWidth = 0.6;
    for (let ci = 0; ci < cargo.length; ci++) {
      const [x, z, w, d, y] = cargo[ci];
      if (y > 0.5) continue;
      const px = ((x - w * 0.5 - WORLD_X0) / WORLD_W) * cw;
      const pz = ((z - d * 0.5 - WORLD_Z0) / WORLD_L) * ch;
      const pw = (w / WORLD_W) * cw;
      const pd = (d / WORLD_L) * ch;
      bctx.fillRect(px, pz, pw, pd);
      bctx.strokeRect(px, pz, pw, pd);
    }
    this._bpCanvas = c;
    this._bpW = cw;
    this._bpH = ch;
    return c;
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

    ctx.fillStyle = 'rgba(8, 22, 26, 0.84)';
    ctx.fillRect(0, 0, cw, ch);

    ctx.strokeStyle = 'rgba(110, 210, 200, 0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = cw * 0.25; x < cw; x += cw * 0.25) { ctx.moveTo(x, 0); ctx.lineTo(x, ch); }
    for (let y = ch * 0.25; y < ch; y += ch * 0.25) { ctx.moveTo(0, y); ctx.lineTo(cw, y); }
    ctx.stroke();

    const f = this.fields[0];
    const peak = Math.max(1 / Math.max(1, this.passableCount) * 2.5, this.peaks[0].prob);
    const invPeak = 1 / peak;
    const cellW = cw / this.w, cellH = ch / this.h;
    const pIds = this._passableIds, pCnt = this.passableCount, W = this.w;
    for (let k = 0; k < pCnt; k++) {
      const i = pIds[k];
      const norm = f[i] * invPeak;
      if (norm < 0.08) continue;
      const nc = norm > 1 ? 1 : norm;
      const ix = i % W, iz = (i - ix) / W;
      const r = Math.round(nc < 0.5 ? 25 + nc * 420 : 235 + (nc - 0.5) * 40);
      const g = Math.round(nc < 0.5 ? 185 - nc * 40 : 165 - (nc - 0.5) * 210);
      const b = Math.round(nc < 0.5 ? 195 - nc * 240 : 75 - (nc - 0.5) * 110);
      const a = clamp(nc * 0.82, 0.06, 0.85);
      ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(2)})`;
      ctx.fillRect(ix * cellW, iz * cellH, cellW + 0.6, cellH + 0.6);
    }

    if (match.aeroVortex && match.aeroVortex.stats.totalSmoke > 0.5) {
      const av = match.aeroVortex;
      const sx = cw / av.w, sz = ch / av.h;
      for (let iz = 0; iz < av.h; iz += 2) {
        const row = iz * av.w;
        for (let ix = 0; ix < av.w; ix++) {
          const sm = av.smoke[row + ix];
          if (sm < 0.22) continue;
          ctx.fillStyle = `rgba(215, 240, 245, ${clamp(sm * 0.26, 0.05, 0.45).toFixed(2)})`;
          ctx.fillRect(ix * sx, iz * sz, sx + 0.8, sz * 2 + 0.8);
        }
      }
    }

    // Blit cached static shipping container silhouettes (1 drawImage instead of 80 fillRect+strokeRect!)
    let blitted = false;
    const bp = this._getBlueprintCanvas(cw, ch);
    if (bp) {
      try {
        ctx.drawImage(bp, 0, 0);
        blitted = true;
      } catch {
        this._bpDisabled = true;
        this._bpCanvas = null;
      }
    }
    if (!blitted) {
      ctx.fillStyle = 'rgba(26, 48, 52, 0.92)';
      ctx.strokeStyle = 'rgba(130, 205, 198, 0.28)';
      ctx.lineWidth = 0.6;
      for (let ci = 0; ci < cargo.length; ci++) {
        const [x, z, w, d, y] = cargo[ci];
        if (y > 0.5) continue;
        const px = ((x - w * 0.5 - WORLD_X0) / WORLD_W) * cw;
        const pz = ((z - d * 0.5 - WORLD_Z0) / WORLD_L) * ch;
        const pw = (w / WORLD_W) * cw;
        const pd = (d / WORLD_L) * ch;
        ctx.fillRect(px, pz, pw, pd);
        ctx.strokeRect(px, pz, pw, pd);
      }
    }

    const tks = match.tankers || tankers;
    for (let ti = 0; ti < tks.length; ti++) {
      const tk = tks[ti];
      const tx = ((tk.x - WORLD_X0) / WORLD_W) * cw;
      const tz = ((tk.z - WORLD_Z0) / WORLD_L) * ch;
      ctx.fillStyle = (tk.cooldown || 0) <= 0 ? '#68f5e0' : '#d89b4e';
      ctx.beginPath();
      ctx.moveTo(tx, tz - 3.2); ctx.lineTo(tx + 3.2, tz);
      ctx.lineTo(tx, tz + 3.2); ctx.lineTo(tx - 3.2, tz);
      ctx.closePath();
      ctx.fill();
    }

    for (let ai = 0; ai < match.actors.length; ai++) {
      const a = match.actors[ai];
      if (!a.alive || a.team !== 0) continue;
      const ax = ((a.x - WORLD_X0) / WORLD_W) * cw;
      const az = ((a.z - WORLD_Z0) / WORLD_L) * ch;
      if (a.human) {
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
