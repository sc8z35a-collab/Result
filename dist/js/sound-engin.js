import {clamp} from './geometry.js';
import {obstruction, raycastMaterial, surfaceAt, craneSites} from './yard.js';
import {eyeOf} from './posture.js';

export const SOUND_ENGIN_VERSION = 'Sound Engin 1.0';
export const SPEED_OF_SOUND = 343.0; // m/s in maritime air (~20°C)
export const AUDIO_MODES = {hrtf: 'hrtf', stereo: 'stereo'};

const TAU = Math.PI * 2;
const safeFreq = (sr, f) => clamp(Number.isFinite(f) ? f : 1000, 22, Math.min(20000, (sr || 48000) * 0.45));
const safeGain = g => Math.max(0.0001, Number.isFinite(g) ? g : 0.0001);
const finite = (v, fb = 0) => (Number.isFinite(v) ? v : fb);

function makePrng(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Pure-JS Physical Acoustics & DSP Kernel (Deterministic & Unit-Testable)
// ============================================================================

/** Physical acoustic speed-of-sound propagation delay (t = d / 343 m/s). */
export function computePropagationDelay(dist, maxDelay = 0.55) {
  if (!Number.isFinite(dist) || dist <= 0) return 0;
  return Math.min(maxDelay, dist / SPEED_OF_SOUND);
}

/** ISO 9613-1 inspired maritime atmospheric high-frequency air absorption. */
export function computeAirAbsorption(dist, humidity = 0.72) {
  const d = Math.max(0, finite(dist, 0));
  const humFactor = clamp(1.0 + (0.65 - humidity) * 0.18, 0.88, 1.16);
  const cutoffHz = clamp(
    19400 * Math.exp(-0.0172 * d * humFactor) + 720 * Math.exp(-0.004 * d),
    650,
    19600
  );
  const airGain = 1 / (1 + d * 0.068 + d * d * 0.00028);
  return {dist: d, cutoffHz, airGain};
}

/**
 * True continuous ballistic Doppler & Mach-cone shockwave physics.
 * Computes approach/recede frequency ratios and sweep duration across CPA.
 */
export function computeDopplerShift(speed, dist, c = SPEED_OF_SOUND) {
  const v = Math.max(10, finite(speed, 280));
  const b = Math.max(0.25, finite(dist, 2.0));
  const mach = v / c;
  const isSupersonic = mach >= 1.0;
  const machAngleRad = isSupersonic ? Math.asin(clamp(1 / mach, 0.05, 1)) : Math.PI * 0.5;
  // Radial velocity fraction ~0.045s before & after closest point of approach
  const dtProbe = clamp(b / v * 1.4, 0.014, 0.075);
  const vr = (v * v * dtProbe) / Math.hypot(b, v * dtProbe);
  // Clamp effective subsonic approach velocity so continuous wake pitch remains musical & physical
  const vrEff = Math.min(vr, c * 0.62);
  const approachRatio = c / Math.max(c * 0.36, c - vrEff);
  const recedeRatio = c / (c + vr * 0.85);
  const sweepDur = clamp(0.065 + b * 0.018 + (isSupersonic ? 0 : 0.045), 0.075, 0.24);
  return {mach, isSupersonic, machAngleRad, approachRatio, recedeRatio, sweepDur};
}

/**
 * Real 3D acoustic raytracer against Harbor Range obstacles:
 * traces direct LOS + 4 edge-diffraction rays (left/right/over-top) for
 * realistic steel-container occlusion, diffraction leak, and frequency rolloff.
 */
export function computeAcousticPath(srcPos, dstPos) {
  const dx = dstPos[0] - srcPos[0];
  const dy = dstPos[1] - srcPos[1];
  const dz = dstPos[2] - srcPos[2];
  const dist = Math.hypot(dx, dy, dz);
  const delay = computePropagationDelay(dist);
  const air = computeAirAbsorption(dist);

  if (dist < 0.35) {
    return {
      dist,
      delay: 0,
      occluded: false,
      occlusion: 0,
      diffraction: 0,
      blockerMat: null,
      cutoffHz: air.cutoffHz,
      directGain: 1,
      reverbBoost: 0
    };
  }

  const directHit = raycastMaterial(srcPos, dstPos);
  const occluded = !!directHit && directHit.t < 0.992;
  if (!occluded) {
    return {
      dist,
      delay,
      occluded: false,
      occlusion: 0,
      diffraction: 0,
      blockerMat: null,
      cutoffHz: air.cutoffHz,
      directGain: air.airGain,
      reverbBoost: 0
    };
  }

  // Cast 4 edge-diffraction probes around midpoint (left, right, elevated over container, higher clear)
  const hLen = Math.hypot(dx, dz) || 1;
  const rx = -dz / hLen, rz = dx / hLen;
  const mid = [
    (srcPos[0] + dstPos[0]) * 0.5,
    (srcPos[1] + dstPos[1]) * 0.5,
    (srcPos[2] + dstPos[2]) * 0.5
  ];
  const probes = [
    [mid[0] + rx * 1.65, mid[1] + 0.15, mid[2] + rz * 1.65],
    [mid[0] - rx * 1.65, mid[1] + 0.15, mid[2] - rz * 1.65],
    [mid[0], mid[1] + 2.35, mid[2]],
    [mid[0], mid[1] + 4.85, mid[2]]
  ];
  let openEdges = 0;
  for (const wp of probes) {
    if (obstruction(srcPos, wp) > 0.99 && obstruction(wp, dstPos) > 0.99) openEdges++;
  }

  const mat = directHit.mat || 'steel';
  const matDensity = mat === 'concrete' ? 0.94 : mat === 'steel' ? 0.86 : 0.62;
  const diffraction = openEdges / probes.length;
  // Occlusion decreases smoothly when sound diffracts cleanly over or around a single container
  const occlusion = clamp(matDensity * (1 - diffraction * 0.54), 0.22, 0.95);
  const occCutoff = clamp(420 + (1 - occlusion) * 2600 + diffraction * 950, 380, air.cutoffHz);
  const cutoffHz = Math.min(air.cutoffHz, occCutoff);
  const occGain = 1 - occlusion * 0.64;

  return {
    dist,
    delay,
    occluded: true,
    occlusion,
    diffraction,
    blockerMat: mat,
    cutoffHz,
    directGain: air.airGain * occGain,
    reverbBoost: occlusion * 0.45
  };
}

/**
 * Geometric early-reflection raycaster against harbor steel containers, cranes & concrete walls.
 * Computes physically exact reflection path length -> echo delay (L - dDirect) / 343 m/s.
 */
export function traceEarlyReflections(srcPos, dstPos, maxRays = 6) {
  const dDirect = Math.hypot(dstPos[0] - srcPos[0], dstPos[1] - srcPos[1], dstPos[2] - srcPos[2]);
  const rays = Math.max(2, Math.min(8, maxRays));
  const maxDist = 42;
  const taps = [];
  const baseAngle = Math.atan2(dstPos[2] - srcPos[2], dstPos[0] - srcPos[0]) + 0.37;

  for (let i = 0; i < rays; i++) {
    const ang = baseAngle + (i / rays) * TAU;
    const elev = i % 2 === 0 ? 0.04 : 0.14;
    const end = [
      srcPos[0] + Math.cos(ang) * maxDist,
      Math.max(0.4, srcPos[1] + elev * maxDist),
      srcPos[2] + Math.sin(ang) * maxDist
    ];
    const hit = raycastMaterial(srcPos, end);
    if (!hit || hit.t > 0.98) continue;
    const p = hit.point;
    const d1 = Math.hypot(p[0] - srcPos[0], p[1] - srcPos[1], p[2] - srcPos[2]);
    if (d1 < 1.2) continue;
    const d2 = Math.hypot(dstPos[0] - p[0], dstPos[1] - p[1], dstPos[2] - p[2]);
    const totalPath = d1 + d2;
    const extraPath = Math.max(0, totalPath - dDirect);
    const delay = extraPath / SPEED_OF_SOUND;
    if (delay < 0.007 || delay > 0.34) continue;

    // Offset slightly along hit normal before checking reflection-to-listener visibility
    const n = hit.normal || [0, 1, 0];
    const hp = [p[0] + n[0] * 0.12, p[1] + n[1] * 0.12, p[2] + n[2] * 0.12];
    const secClear = obstruction(hp, dstPos) > 0.98;
    const mat = hit.mat || 'steel';
    const refl = mat === 'steel' ? 0.78 : mat === 'concrete' ? 0.62 : 0.38;
    const cutoffHz = mat === 'steel' ? 4600 : mat === 'concrete' ? 2400 : 1450;
    const air = computeAirAbsorption(totalPath);
    const gain = clamp(refl * air.airGain * (secClear ? 0.42 : 0.16), 0.008, 0.34);

    taps.push({
      delay,
      absDelay: totalPath / SPEED_OF_SOUND,
      gain,
      pos: hp,
      mat,
      cutoffHz: Math.min(cutoffHz, air.cutoffHz),
      clear: secClear
    });
  }
  taps.sort((a, b) => a.delay - b.delay);
  return taps;
}

/**
 * Estimates local acoustic enclosure (container canyon vs open pier) by casting
 * 8 horizontal + 2 elevated short probes from `pos`.
 */
export function estimateEnclosure(pos) {
  const probeDist = 16;
  let enclosedSum = 0;
  let steelHits = 0;
  let hitCount = 0;
  let distSum = 0;

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.19;
    const end = [pos[0] + Math.cos(a) * probeDist, pos[1] + 0.25, pos[2] + Math.sin(a) * probeDist];
    const hit = raycastMaterial(pos, end);
    if (hit && hit.t <= 1) {
      const d = hit.t * probeDist;
      enclosedSum += Math.pow(1 - hit.t, 1.35);
      distSum += d;
      hitCount++;
      if (hit.mat === 'steel') steelHits++;
    } else {
      distSum += probeDist;
    }
  }
  // Elevated container-stack overhang probes (stacked 2-high containers at +2.8m)
  for (const ang of [0, Math.PI]) {
    const end = [pos[0] + Math.cos(ang) * 9, pos[1] + 3.6, pos[2] + Math.sin(ang) * 9];
    const hit = raycastMaterial(pos, end);
    if (hit && hit.t <= 1) {
      enclosedSum += (1 - hit.t) * 0.55;
      hitCount++;
      if (hit.mat === 'steel') steelHits++;
    }
  }

  const enclosure = clamp(enclosedSum / 6.2, 0, 1);
  const steelRatio = hitCount ? steelHits / hitCount : 0;
  return {
    enclosure,
    steelRatio,
    openRatio: 1 - enclosure,
    avgDist: distSum / 8
  };
}

/** Asymmetric hyperbolic-tangent pressure saturation curve for WaveShaperNode. */
export function synthesizeWaveShaperCurve(drive = 2.4, samples = 2048) {
  const n = Math.max(64, samples | 0);
  const curve = new Float32Array(n);
  const k = Math.max(0.1, drive);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // Slight even-harmonic asymmetry mimics real acoustic shockwave compression
    const asym = x + 0.08 * x * x;
    curve[i] = clamp(Math.tanh(asym * k) / norm, -1, 1);
  }
  return curve;
}

/**
 * Generates physically modeled Friedlander muzzle shockwave or supersonic N-wave crack samples.
 * Friedlander equation: P(t) = P0 * (1 - t/t+) * exp(-b * t/t+)
 */
export function createGunImpulseSamples(sampleRate = 48000, kind = 'blast') {
  const rng = makePrng(kind === 'crack' ? 9187 : 4201);
  if (kind === 'crack') {
    const len = Math.max(256, Math.round(sampleRate * 0.045));
    const out = new Float32Array(len);
    const shockSamples = Math.max(6, Math.round(sampleRate * 0.00055));
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      let s = 0;
      if (i < shockSamples) {
        // Steep N-wave front + zero crossing + rarefaction
        const u = i / shockSamples;
        s = u < 0.25 ? (u / 0.25) : (1 - 2 * ((u - 0.25) / 0.75));
      } else {
        const tail = Math.exp(-(t - 0.00055) * 95);
        const w = (rng() * 2 - 1);
        lp = lp * 0.42 + w * 0.58;
        s = lp * tail * 0.65;
      }
      out[i] = clamp(s, -1, 1);
    }
    return out;
  }

  // Friedlander shockwave blast + propellant turbulence tail
  const len = Math.max(512, Math.round(sampleRate * 0.145));
  const out = new Float32Array(len);
  const tPlus = 0.0028;
  let lp1 = 0, lp2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const tau = t / tPlus;
    const friedlander = tau < 4.5 ? (1 - tau) * Math.exp(-1.45 * tau) : 0;
    const raw = rng() * 2 - 1;
    lp1 = lp1 * 0.62 + raw * 0.38;
    lp2 = lp2 * 0.88 + lp1 * 0.12;
    const gasBurst = Math.exp(-t * 28) * (lp1 * 0.65 + raw * 0.35);
    const subBody = Math.exp(-t * 19) * lp2 * 0.55;
    out[i] = clamp(friedlander * 0.85 + gasBurst * 0.62 + subBody * 0.45, -1, 1);
  }
  return out;
}

/**
 * Procedural Stereo Velvet-Noise Convolution Impulse Response Generator.
 * Synthesizes two distinct maritime acoustic chambers with physically realistic
 * frequency-dependent RT60 (high frequencies decay faster than low-mid warmth)
 * and binaural L/R decorrelation (IACC).
 *
 * style: 'open' (open harbor quay & distant pier reflections)
 *      | 'alley' (corrugated steel container canyon with metallic flutter echoes)
 */
export function generateHarborIR(sampleRate = 48000, duration = 2.0, style = 'open') {
  const sr = Math.max(8000, sampleRate | 0);
  const len = Math.max(1024, Math.round(sr * duration));
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  const isAlley = style === 'alley';
  const rng = makePrng(isAlley ? 7741 : 3191);

  // Target frequency-dependent RT60 (seconds): low decays substantially slower than high!
  const rt60Low = isAlley ? Math.min(duration * 0.92, 1.08) : Math.min(duration * 0.95, 1.92);
  const rt60High = isAlley ? Math.min(duration * 0.52, 0.58) : Math.min(duration * 0.34, 0.62);
  const decayLow = 6.9078 / rt60Low;   // ln(1000) / RT60
  const decayHigh = 6.9078 / rt60High;

  // 1. Geometric early reflection taps (harbor containers, quay walls, gantry cranes)
  const earlyTaps = isAlley
    ? [
        [0.014, 0.58, 0.42], [0.023, 0.36, 0.55], [0.036, 0.46, 0.28],
        [0.049, 0.25, 0.44], [0.064, 0.34, 0.22], [0.082, 0.19, 0.31],
        [0.105, 0.24, 0.18], [0.132, 0.14, 0.22]
      ]
    : [
        [0.028, 0.42, 0.24], [0.052, 0.22, 0.38], [0.089, 0.31, 0.18],
        [0.142, 0.16, 0.27], [0.215, 0.20, 0.14], [0.318, 0.12, 0.17]
      ];

  for (const [sec, gl, gr] of earlyTaps) {
    const idx = Math.round(sec * sr);
    if (idx < len) {
      const sign = rng() > 0.5 ? 1 : -1;
      left[idx] += gl * sign * 0.55;
      right[idx] += gr * (-sign) * 0.55;
    }
  }

  // 2. Velvet-Noise dense diffuse tail (1600–2200 pulses/sec: silky smooth, zero metallic ringing)
  const pulseDensity = isAlley ? 2100 : 1650;
  const gridSize = Math.max(4, Math.round(sr / pulseDensity));
  const preDelaySamples = Math.round((isAlley ? 0.008 : 0.022) * sr);
  const rawL = new Float32Array(len);
  const rawR = new Float32Array(len);

  for (let base = preDelaySamples; base < len; base += gridSize) {
    const pL = base + Math.floor(rng() * gridSize);
    const pR = base + Math.floor(rng() * gridSize);
    if (pL < len) rawL[pL] += rng() > 0.5 ? 1 : -1;
    if (pR < len) rawR[pR] += rng() > 0.5 ? 1 : -1;
  }

  // 3. Split-band frequency-dependent decay + corrugated steel modal shimmer for alley IR
  const lpAlpha = clamp(1 - Math.exp(-TAU * (isAlley ? 1550 : 1150) / sr), 0.01, 0.9);
  const dampAlpha = clamp(1 - Math.exp(-TAU * (isAlley ? 5200 : 3800) / sr), 0.02, 0.95);
  let lowL = 0, lowR = 0, hiL = 0, hiR = 0;
  // Subtle container-alley steel eigenmodes (420Hz & 895Hz)
  const w1 = TAU * 420 / sr, w2 = TAU * 895 / sr;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const envLow = Math.exp(-decayLow * t);
    const envHigh = Math.exp(-decayHigh * t);
    // Smooth fade-in over first 18ms of diffuse tail to preserve direct transient clarity
    const onset = i < preDelaySamples ? 0 : Math.min(1, (i - preDelaySamples) / (sr * 0.018));

    lowL += (rawL[i] - lowL) * lpAlpha;
    lowR += (rawR[i] - lowR) * lpAlpha;
    hiL += ((rawL[i] - lowL) - hiL) * dampAlpha;
    hiR += ((rawR[i] - lowR) - hiR) * dampAlpha;

    let sL = left[i] + onset * (lowL * envLow * 1.35 + hiL * envHigh * 0.82);
    let sR = right[i] + onset * (lowR * envLow * 1.35 + hiR * envHigh * 0.82);

    if (isAlley && t > 0.01 && t < 0.45) {
      const mEnv = Math.exp(-t * 11) * 0.028;
      const modal = Math.sin(w1 * i) * 0.65 + Math.sin(w2 * i + 0.7) * 0.35;
      sL += modal * mEnv;
      sR -= modal * mEnv * 0.85;
    }

    // Gentle end taper so convolution never clicks
    const fadeOut = i > len - 128 ? (len - i) / 128 : 1;
    left[i] = sL * fadeOut;
    right[i] = sR * fadeOut;
  }

  // Normalize RMS smoothly to a consistent calibrated level
  let energy = 0;
  for (let i = 0; i < len; i++) energy += left[i] * left[i] + right[i] * right[i];
  const rms = Math.sqrt(energy / (len * 2)) || 1;
  const targetRms = isAlley ? 0.092 : 0.078;
  const scale = Math.min(6.0, targetRms / rms);
  for (let i = 0; i < len; i++) {
    left[i] = clamp(left[i] * scale, -0.95, 0.95);
    right[i] = clamp(right[i] * scale, -0.95, 0.95);
  }

  return {left, right, sampleRate: sr, duration, rt60Low, rt60High};
}

// ============================================================================
// Sound Engin 1.0 — Real-Time 3D Physical-Modeling Web Audio Engine
// ============================================================================

export class SoundEngin {
  constructor() {
    this.version = SOUND_ENGIN_VERSION;
    this.volume = 0.55;
    this.on = false;
    this.mode = AUDIO_MODES.hrtf;
    this.ctx = null;

    // Live listener state (world space: +X right, +Y up, -Z forward)
    this.listenerPos = [0, 1.65, 78];
    this.listenerFwd = [0, 0, -1];
    this.listenerRight = [1, 0, 0];
    this.listenerUp = [0, 1, 0];

    // Live acoustic environment telemetry
    this.enclosure = 0.25;
    this.steelRatio = 0.5;
    this.duckLevel = 1.0;
    this.envProbeTimer = 0;
    this.ambientEventTimer = 3.5;
    this.heartbeatTimer = 0;

    // Voice & rate governors
    this.activeVoices = 0;
    this.lastWhizAt = 0;
    this.lastImpactAt = 0;
    this.lastCasingAt = 0;
    this.lastFootstepAt = new Map();
    this.actorState = new Map();

    // Runtime diagnostics counters
    this.stats = {
      shots: 0,
      whizzes: 0,
      impacts: 0,
      footsteps: 0,
      casings: 0,
      reflections: 0,
      occludedEvents: 0
    };
  }

  get maxVoices() {
    return this.mode === AUDIO_MODES.hrtf ? 40 : 24;
  }

  setMode(mode) {
    this.mode = mode === AUDIO_MODES.stereo ? AUDIO_MODES.stereo : AUDIO_MODES.hrtf;
    if (this.tankerPanner?.is3D && this.tankerPanner.node) {
      try {
        this.tankerPanner.node.panningModel = this.mode === AUDIO_MODES.hrtf ? 'HRTF' : 'equalpower';
      } catch {}
    }
    if (this.ctx && this.openRevReturn && this.alleyRevReturn) {
      this._applyEnclosureMix(this.ctx.currentTime);
    }
  }

  resetMatch() {
    this.actorState.clear();
    this.lastFootstepAt.clear();
    this.heartbeatTimer = 0;
    if (this.tankerGain && this.ctx) {
      this.tankerGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }
  }

  async enable(on) {
    this.on = !!on;
    if (!this.on) {
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06);
      }
      return;
    }
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
          this.on = false;
          return;
        }
        this.ctx = new AudioCtx({latencyHint: 'interactive'});
        this._buildGraph();
        this._buildProceduralBuffers();
        this._startAmbience();
      }
      if (this.ctx.state !== 'running') {
        await this.ctx.resume();
      }
      this.set(this.volume);
    } catch {
      this.on = false;
    }
  }

  set(v) {
    this.volume = clamp(finite(v, 0.55), 0, 1);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.on ? this.volume : 0, this.ctx.currentTime, 0.035);
    }
  }

  // --------------------------------------------------------------------------
  // Mastering Bus, Sub-Buses, Convolution Reverb & Analyser Graph
  // --------------------------------------------------------------------------
  _buildGraph() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;

    // Master output + live analyser (for zero-overhead diagnostics & E2E verification)
    this.master = ctx.createGain();
    this.master.gain.value = 0;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.5;
    this._analyserBuf = new Float32Array(this.analyser.fftSize);

    // Master EQ polish: warm low-end weight + crisp acoustic presence
    this.masterLowShelf = ctx.createBiquadFilter();
    this.masterLowShelf.type = 'lowshelf';
    this.masterLowShelf.frequency.value = safeFreq(sr, 78);
    this.masterLowShelf.gain.value = 1.6;

    this.masterPresence = ctx.createBiquadFilter();
    this.masterPresence.type = 'peaking';
    this.masterPresence.frequency.value = safeFreq(sr, 3100);
    this.masterPresence.Q.value = 0.9;
    this.masterPresence.gain.value = 1.1;

    // Broadcast/AAA Glue Compressor & Peak Limiter
    this.masterComp = ctx.createDynamicsCompressor();
    this.masterComp.threshold.value = -10.5;
    this.masterComp.knee.value = 12;
    this.masterComp.ratio.value = 4.2;
    this.masterComp.attack.value = 0.0025;
    this.masterComp.release.value = 0.14;

    this.safetyClipper = ctx.createWaveShaper();
    this.safetyClipper.curve = synthesizeWaveShaperCurve(1.35, 2048);
    this.safetyClipper.oversample = '2x';

    // Mix bus
    this.mixBus = ctx.createGain();
    this.mixBus.gain.value = 1.0;

    this.mixBus
      .connect(this.masterLowShelf)
      .connect(this.masterPresence)
      .connect(this.masterComp)
      .connect(this.safetyClipper)
      .connect(this.master);

    // UI / Hit-Confirm bus bypasses heavy weapon saturation for surgical clarity
    this.uiBus = ctx.createGain();
    this.uiBus.gain.value = 0.96;
    this.uiBus.connect(this.master);

    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // Sub-buses
    this.weaponsBus = ctx.createGain();
    this.weaponsBus.gain.value = 1.02;
    this.weaponShaper = ctx.createWaveShaper();
    this.weaponShaper.curve = synthesizeWaveShaperCurve(2.25, 2048);
    this.weaponShaper.oversample = '2x';
    this.weaponTrim = ctx.createGain();
    this.weaponTrim.gain.value = 0.92;
    this.weaponsBus.connect(this.weaponShaper).connect(this.weaponTrim).connect(this.mixBus);

    this.impactsBus = ctx.createGain();
    this.impactsBus.gain.value = 0.96;
    this.impactsBus.connect(this.mixBus);

    this.foleyBus = ctx.createGain();
    this.foleyBus.gain.value = 0.94;
    this.foleyBus.connect(this.mixBus);

    this.earlyReflBus = ctx.createGain();
    this.earlyReflBus.gain.value = 0.88;
    this.earlyReflBus.connect(this.mixBus);

    this.ambienceBus = ctx.createGain();
    this.ambienceBus.gain.value = 0.85;
    this.ambienceDuck = ctx.createGain();
    this.ambienceDuck.gain.value = 1.0;
    this.ambienceBus.connect(this.ambienceDuck).connect(this.mixBus);

    // Dual-Zone Convolution Reverb (Open Harbor Quay + Corrugated Steel Container Alley)
    this.openRevSend = ctx.createGain();
    this.openRevSend.gain.value = 0.52;
    this.openConvolver = ctx.createConvolver();
    this.openRevReturn = ctx.createGain();
    this.openRevReturn.gain.value = 0.36;
    this.openRevSend.connect(this.openConvolver).connect(this.openRevReturn).connect(this.mixBus);

    this.alleyRevSend = ctx.createGain();
    this.alleyRevSend.gain.value = 0.45;
    this.alleyConvolver = ctx.createConvolver();
    this.alleyRevReturn = ctx.createGain();
    this.alleyRevReturn.gain.value = 0.24;
    this.alleyRevSend.connect(this.alleyConvolver).connect(this.alleyRevReturn).connect(this.mixBus);
  }

  _buildProceduralBuffers() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const rng = makePrng(2026);

    // 1. Decorrelated stereo white noise (2.5s)
    const wLen = Math.round(sr * 2.5);
    this.whiteNoiseBuf = ctx.createBuffer(2, wLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = this.whiteNoiseBuf.getChannelData(ch);
      for (let i = 0; i < wLen; i++) d[i] = rng() * 2 - 1;
    }

    // 2. Paul Kellet stereo pink/maritime noise (4.0s)
    const pLen = Math.round(sr * 4.0);
    this.pinkNoiseBuf = ctx.createBuffer(2, pLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = this.pinkNoiseBuf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < pLen; i++) {
        const w = rng() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = clamp((b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.13, -1, 1);
        b6 = w * 0.115926;
      }
    }

    // 3. Friedlander blast & N-wave supersonic crack impulse buffers
    const blastData = createGunImpulseSamples(sr, 'blast');
    this.blastBuf = ctx.createBuffer(1, blastData.length, sr);
    this.blastBuf.copyToChannel(blastData, 0);

    const crackData = createGunImpulseSamples(sr, 'crack');
    this.crackBuf = ctx.createBuffer(1, crackData.length, sr);
    this.crackBuf.copyToChannel(crackData, 0);

    // 4. Concrete/gravel debris scatter impulse buffer (0.3s)
    const gLen = Math.round(sr * 0.3);
    this.gritBuf = ctx.createBuffer(1, gLen, sr);
    const gd = this.gritBuf.getChannelData(0);
    for (let k = 0; k < 28; k++) {
      const idx = Math.floor(Math.pow(rng(), 1.45) * (gLen - 40));
      const amp = (0.35 + rng() * 0.65) * Math.exp(-idx / (gLen * 0.48));
      for (let j = 0; j < 28 && idx + j < gLen; j++) {
        gd[idx + j] += (rng() * 2 - 1) * amp * Math.exp(-j * 0.22);
      }
    }

    // 5. Dual-Zone Velvet-Noise Harbor Convolution Impulse Responses
    const openIR = generateHarborIR(sr, 2.05, 'open');
    const openBuf = ctx.createBuffer(2, openIR.left.length, sr);
    openBuf.copyToChannel(openIR.left, 0);
    openBuf.copyToChannel(openIR.right, 1);
    this.openConvolver.buffer = openBuf;

    const alleyIR = generateHarborIR(sr, 1.15, 'alley');
    const alleyBuf = ctx.createBuffer(2, alleyIR.left.length, sr);
    alleyBuf.copyToChannel(alleyIR.left, 0);
    alleyBuf.copyToChannel(alleyIR.right, 1);
    this.alleyConvolver.buffer = alleyBuf;
  }

  // --------------------------------------------------------------------------
  // Living 3D Maritime Harbor Ambience (Directional Surf + Sheltered Wind + Tanker Hum)
  // --------------------------------------------------------------------------
  _startAmbience() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;

    // 1. Directional ocean surf lapping against west pier (x < -25)
    const seaSrc = ctx.createBufferSource();
    seaSrc.buffer = this.pinkNoiseBuf;
    seaSrc.loop = true;

    this.seaFilter = ctx.createBiquadFilter();
    this.seaFilter.type = 'lowpass';
    this.seaFilter.frequency.value = safeFreq(sr, 360);
    this.seaFilter.Q.value = 0.7;

    this.seaGain = ctx.createGain();
    this.seaGain.gain.value = 0.135;

    // Slow dual-swell modulation for organic ocean waves
    const swellLfo = ctx.createOscillator();
    swellLfo.type = 'sine';
    swellLfo.frequency.value = 0.15;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.042;
    swellLfo.connect(swellDepth).connect(this.seaGain.gain);

    const swellFreqDepth = ctx.createGain();
    swellFreqDepth.gain.value = 115;
    swellLfo.connect(swellFreqDepth).connect(this.seaFilter.frequency);

    this.seaPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (this.seaPan) {
      seaSrc.connect(this.seaFilter).connect(this.seaGain).connect(this.seaPan).connect(this.ambienceBus);
    } else {
      seaSrc.connect(this.seaFilter).connect(this.seaGain).connect(this.ambienceBus);
    }
    seaSrc.start();
    swellLfo.start();

    // 2. Marine breeze / harbor container canyon wind
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.pinkNoiseBuf;
    windSrc.loop = true;
    windSrc.playbackRate.value = 1.12;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = safeFreq(sr, 520);
    this.windFilter.Q.value = 1.4;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.055;

    const gustLfo = ctx.createOscillator();
    gustLfo.type = 'sine';
    gustLfo.frequency.value = 0.11;
    const gustFreq = ctx.createGain();
    gustFreq.gain.value = 175;
    gustLfo.connect(gustFreq).connect(this.windFilter.frequency);
    const gustAmp = ctx.createGain();
    gustAmp.gain.value = 0.018;
    gustLfo.connect(gustAmp).connect(this.windGain.gain);

    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.ambienceBus);
    windSrc.start(0, 1.3);
    gustLfo.start();

    // 3. Supply Tanker continuous 3D pressurized turbine hum (dynamically tracked in update())
    this.tankerOsc1 = ctx.createOscillator();
    this.tankerOsc1.type = 'triangle';
    this.tankerOsc1.frequency.value = 92;
    this.tankerOsc2 = ctx.createOscillator();
    this.tankerOsc2.type = 'sine';
    this.tankerOsc2.frequency.value = 184.5;
    this.tankerFilter = ctx.createBiquadFilter();
    this.tankerFilter.type = 'lowpass';
    this.tankerFilter.frequency.value = safeFreq(sr, 340);
    this.tankerGain = ctx.createGain();
    this.tankerGain.gain.value = 0;

    this.tankerPanner = this._createSpatialNode(this.listenerPos, 0, true);
    this.tankerOsc1.connect(this.tankerFilter);
    this.tankerOsc2.connect(this.tankerFilter);
    this.tankerFilter.connect(this.tankerGain).connect(this.tankerPanner.input);
    this.tankerPanner.output.connect(this.ambienceBus);
    this.tankerOsc1.start();
    this.tankerOsc2.start();
  }

  _applyEnclosureMix(now) {
    if (!this.openRevReturn || !this.alleyRevReturn) return;
    const isHrtf = this.mode === AUDIO_MODES.hrtf;
    const enc = this.enclosure;
    const openLvl = (isHrtf ? 0.36 : 0.24) * (1.05 - enc * 0.45);
    const alleyLvl = (isHrtf ? 0.42 : 0.26) * (0.28 + enc * 0.85) * (0.72 + this.steelRatio * 0.45);
    this.openRevReturn.gain.setTargetAtTime(openLvl, now, 0.14);
    this.alleyRevReturn.gain.setTargetAtTime(alleyLvl, now, 0.14);
    if (this.windFilter && this.windGain) {
      // Stepping inside container alleys shelters the ear from high-frequency sea wind
      const windCut = safeFreq(this.ctx.sampleRate, 640 - enc * 280);
      this.windFilter.frequency.setTargetAtTime(windCut, now, 0.22);
      this.windGain.gain.setTargetAtTime(0.062 * (1 - enc * 0.42), now, 0.22);
    }
  }

  _duckAmbience(energy, at) {
    if (!this.ambienceDuck || !this.ctx) return;
    const dip = clamp(1 - energy * 0.58, 0.34, 1);
    const t = Math.max(this.ctx.currentTime, at);
    this.duckLevel = dip;
    try {
      this.ambienceDuck.gain.cancelScheduledValues(t);
      this.ambienceDuck.gain.setTargetAtTime(dip, t, 0.012);
      this.ambienceDuck.gain.setTargetAtTime(1.0, t + 0.09, 0.24);
    } catch {}
  }

  // --------------------------------------------------------------------------
  // 3D HRTF / Stereo Spatializer & Voice Lifecycle Management
  // --------------------------------------------------------------------------
  _computeStereoPan(worldPos) {
    const dx = worldPos[0] - this.listenerPos[0];
    const dz = worldPos[2] - this.listenerPos[2];
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const rx = this.listenerRight[0], rz = this.listenerRight[2];
    return clamp((dx * rx + dz * rz) / (d + 0.45), -1, 1);
  }

  _createSpatialNode(worldPos = null, stereoPan = 0, persistent = false) {
    const ctx = this.ctx;
    if (worldPos && this.mode === AUDIO_MODES.hrtf && ctx.createPanner) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1;
      p.maxDistance = 10000;
      p.rolloffFactor = 0; // Sound Engin 1.0 computes physical distance/air/occlusion directly
      const x = finite(worldPos[0], this.listenerPos[0]);
      const y = finite(worldPos[1], this.listenerPos[1]);
      const z = finite(worldPos[2], this.listenerPos[2] - 1);
      if (p.positionX) {
        p.positionX.value = x;
        p.positionY.value = y;
        p.positionZ.value = z;
      } else if (p.setPosition) {
        p.setPosition(x, y, z);
      }
      return {input: p, output: p, node: p, is3D: true, persistent};
    }
    const panVal = worldPos ? this._computeStereoPan(worldPos) : clamp(finite(stereoPan, 0), -1, 1);
    if (ctx.createStereoPanner) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = panVal;
      return {input: sp, output: sp, node: sp, is3D: false, persistent};
    }
    const g = ctx.createGain();
    return {input: g, output: g, node: g, is3D: false, persistent};
  }

  _setPannerPos(sp, pos, at) {
    if (!sp || !pos) return;
    if (sp.is3D) {
      const x = finite(pos[0], 0), y = finite(pos[1], 1.5), z = finite(pos[2], 0);
      if (sp.node.positionX) {
        sp.node.positionX.setTargetAtTime(x, at, 0.04);
        sp.node.positionY.setTargetAtTime(y, at, 0.04);
        sp.node.positionZ.setTargetAtTime(z, at, 0.04);
      } else if (sp.node.setPosition) {
        sp.node.setPosition(x, y, z);
      }
    } else if (sp.node.pan) {
      sp.node.pan.setTargetAtTime(this._computeStereoPan(pos), at, 0.04);
    }
  }

  _trackVoice(sourceNode, cleanupNodes = []) {
    this.activeVoices++;
    sourceNode.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      for (const n of cleanupNodes) {
        try { n?.disconnect?.(); } catch {}
      }
    };
  }

  _playTone(opts) {
    if (!this.ctx || !this.on || !this.volume || this.activeVoices >= this.maxVoices) return;
    const ctx = this.ctx, sr = ctx.sampleRate;
    const start = Math.max(ctx.currentTime, opts.start ?? ctx.currentTime);
    const dur = Math.max(0.008, opts.dur || 0.08);
    const osc = ctx.createOscillator();
    osc.type = opts.type || 'sine';
    const f0 = safeFreq(sr, opts.f0 || 440);
    const f1 = safeFreq(sr, opts.f1 ?? f0);
    osc.frequency.setValueAtTime(f0, start);
    if (Math.abs(f1 - f0) > 0.5) {
      osc.frequency.exponentialRampToValueAtTime(f1, start + dur);
    }

    const g = ctx.createGain();
    const atk = Math.min(opts.attack ?? 0.004, dur * 0.35);
    const vol = safeGain(opts.gain ?? 0.1);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + Math.max(0.001, atk));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    const nodes = [osc, g];
    let tail = g;
    if (opts.lpf && opts.lpf < 18500) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(safeFreq(sr, opts.lpf), start);
      tail.connect(lp);
      tail = lp;
      nodes.push(lp);
    }

    const sp = this._createSpatialNode(opts.pos || null, opts.pan ?? 0);
    nodes.push(sp.node);
    if (!sp.is3D && sp.node.pan && opts.panEnd !== undefined && Math.abs(opts.panEnd - (opts.pan ?? 0)) > 0.02) {
      sp.node.pan.setValueAtTime(clamp(opts.pan ?? 0, -1, 1), start);
      sp.node.pan.linearRampToValueAtTime(clamp(opts.panEnd, -1, 1), start + dur);
    }
    osc.connect(g);
    tail.connect(sp.input);
    sp.output.connect(opts.bus || this.mixBus);

    if (opts.reverbSend && opts.reverbSend > 0.01) {
      const rs = ctx.createGain();
      rs.gain.value = clamp(opts.reverbSend, 0, 1);
      tail.connect(rs);
      rs.connect(this.openRevSend);
      rs.connect(this.alleyRevSend);
      nodes.push(rs);
    }

    this._trackVoice(osc, nodes);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  _playBuffer(opts) {
    if (!this.ctx || !this.on || !this.volume || !opts.buffer || this.activeVoices >= this.maxVoices) return;
    const ctx = this.ctx, sr = ctx.sampleRate;
    const start = Math.max(ctx.currentTime, opts.start ?? ctx.currentTime);
    const dur = Math.max(0.008, opts.dur || opts.buffer.duration);
    const src = ctx.createBufferSource();
    src.buffer = opts.buffer;
    src.loop = !!opts.loop;
    if (opts.rate) src.playbackRate.setValueAtTime(clamp(opts.rate, 0.25, 4.0), start);
    if (opts.rateEnd) src.playbackRate.exponentialRampToValueAtTime(clamp(opts.rateEnd, 0.25, 4.0), start + dur);

    const nodes = [src];
    let chain = src;

    if (opts.filterType) {
      const flt = ctx.createBiquadFilter();
      flt.type = opts.filterType;
      flt.Q.setValueAtTime(clamp(opts.q ?? 1.2, 0.2, 18), start);
      const f0 = safeFreq(sr, opts.f0 ?? 1800);
      const f1 = safeFreq(sr, opts.f1 ?? f0);
      flt.frequency.setValueAtTime(f0, start);
      if (Math.abs(f1 - f0) > 1) flt.frequency.exponentialRampToValueAtTime(f1, start + dur);
      chain.connect(flt);
      chain = flt;
      nodes.push(flt);
    }

    if (opts.lpf && opts.lpf < 18500) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(safeFreq(sr, opts.lpf), start);
      chain.connect(lp);
      chain = lp;
      nodes.push(lp);
    }

    const g = ctx.createGain();
    const vol = safeGain(opts.gain ?? 0.14);
    const atk = Math.min(opts.attack ?? 0.004, dur * 0.35);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + Math.max(0.001, atk));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    chain.connect(g);
    nodes.push(g);

    const sp = this._createSpatialNode(opts.pos || null, opts.pan ?? 0);
    nodes.push(sp.node);
    if (!sp.is3D && sp.node.pan && opts.panEnd !== undefined && Math.abs(opts.panEnd - (opts.pan ?? 0)) > 0.02) {
      sp.node.pan.setValueAtTime(clamp(opts.pan ?? 0, -1, 1), start);
      sp.node.pan.linearRampToValueAtTime(clamp(opts.panEnd, -1, 1), start + dur);
    }
    if (sp.is3D && opts.posEnd && sp.node.positionX) {
      sp.node.positionX.setValueAtTime(finite(opts.pos[0], 0), start);
      sp.node.positionY.setValueAtTime(finite(opts.pos[1], 1.5), start);
      sp.node.positionZ.setValueAtTime(finite(opts.pos[2], 0), start);
      sp.node.positionX.linearRampToValueAtTime(finite(opts.posEnd[0], 0), start + dur);
      sp.node.positionY.linearRampToValueAtTime(finite(opts.posEnd[1], 1.5), start + dur);
      sp.node.positionZ.linearRampToValueAtTime(finite(opts.posEnd[2], 0), start + dur);
    }

    g.connect(sp.input);
    sp.output.connect(opts.bus || this.mixBus);

    if (opts.reverbSend && opts.reverbSend > 0.01) {
      const rs = ctx.createGain();
      rs.gain.value = clamp(opts.reverbSend, 0, 1);
      g.connect(rs);
      rs.connect(this.openRevSend);
      rs.connect(this.alleyRevSend);
      nodes.push(rs);
    }

    this._trackVoice(src, nodes);
    const offset = opts.loop ? Math.random() * Math.max(0.1, opts.buffer.duration - 0.35) : 0;
    src.start(start, offset, dur + 0.025);
  }

  // --------------------------------------------------------------------------
  // Frame Update: 3D AudioListener Sync, Dynamic Enclosure, Footsteps, Reloads, Tankers
  // --------------------------------------------------------------------------
  update(dt, match, cam) {
    if (!this.ctx || !this.on) return;
    const now = this.ctx.currentTime;

    // 1. Sync 3D AudioListener with live camera pose (Right-Handed: +X right, +Y up, -Z forward)
    if (cam?.pos && cam?.target) {
      const px = finite(cam.pos[0], 0), py = finite(cam.pos[1], 1.65), pz = finite(cam.pos[2], 78);
      let fx = finite(cam.target[0], px) - px;
      let fy = finite(cam.target[1], py) - py;
      let fz = finite(cam.target[2], pz - 1) - pz;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      // Compute right = normalize(fwd x up)
      let rx = -fz, rz = fx;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl; rz /= rl;

      this.listenerPos = [px, py, pz];
      this.listenerFwd = [fx, fy, fz];
      this.listenerRight = [rx, 0, rz];
      this.listenerUp = [0, 1, 0];

      const L = this.ctx.listener;
      if (L) {
        if (L.positionX) {
          L.positionX.setTargetAtTime(px, now, 0.016);
          L.positionY.setTargetAtTime(py, now, 0.016);
          L.positionZ.setTargetAtTime(pz, now, 0.016);
          L.forwardX.setTargetAtTime(fx, now, 0.016);
          L.forwardY.setTargetAtTime(fy, now, 0.016);
          L.forwardZ.setTargetAtTime(fz, now, 0.016);
          L.upX.setTargetAtTime(0, now, 0.016);
          L.upY.setTargetAtTime(1, now, 0.016);
          L.upZ.setTargetAtTime(0, now, 0.016);
        } else if (L.setPosition && L.setOrientation) {
          L.setPosition(px, py, pz);
          L.setOrientation(fx, fy, fz, 0, 1, 0);
        }
      }

      // Directionally anchor the west ocean surf (x = -45) relative to head orientation!
      if (this.seaPan) {
        const seaPanVal = this._computeStereoPan([-45, 0, pz]);
        const shoreProx = clamp(1.15 - (px + 25) / 70, 0.55, 1.2);
        this.seaPan.pan.setTargetAtTime(clamp(seaPanVal * 0.72, -0.82, 0.82), now, 0.12);
        this.seaGain?.gain.setTargetAtTime(0.125 * shoreProx, now, 0.18);
      }
    }

    // 2. Periodically sample harbor container canyon enclosure (~6 Hz)
    this.envProbeTimer -= dt;
    if (this.envProbeTimer <= 0) {
      this.envProbeTimer = 0.16;
      const env = estimateEnclosure(this.listenerPos);
      this.enclosure += (env.enclosure - this.enclosure) * 0.45;
      this.steelRatio += (env.steelRatio - this.steelRatio) * 0.45;
      this._applyEnclosureMix(now);
    }

    // 3. Distant atmospheric maritime details (crane creak & spatial gulls)
    this.ambientEventTimer -= dt;
    if (this.ambientEventTimer <= 0 && this.activeVoices < this.maxVoices - 8) {
      this.ambientEventTimer = 6.5 + Math.random() * 7.5;
      this._playHarborDetail(now);
    }

    if (!match) {
      this.tankerGain?.gain.setTargetAtTime(0, now, 0.15);
      return;
    }

    // 4. Supply Tanker proximity 3D pressurized turbine hum
    if (match.tankers?.length && this.tankerGain) {
      let bestTk = null, bestD = 25;
      for (const tk of match.tankers) {
        const d = Math.hypot(tk.x - this.listenerPos[0], tk.z - this.listenerPos[2]);
        if (d < bestD) { bestD = d; bestTk = tk; }
      }
      if (bestTk && bestTk.cooldown <= 0.1) {
        const pos = [bestTk.x, 1.5, bestTk.z];
        const prox = Math.pow(clamp(1 - bestD / 25, 0, 1), 1.7);
        const occ = obstruction(pos, this.listenerPos) <= 1 ? 0.45 : 1.0;
        this._setPannerPos(this.tankerPanner, pos, now);
        this.tankerGain.gain.setTargetAtTime(0.055 * prox * occ, now, 0.12);
        this.tankerFilter?.frequency.setTargetAtTime(safeFreq(this.ctx.sampleRate, 260 + prox * 380 * occ), now, 0.12);
      } else {
        this.tankerGain.gain.setTargetAtTime(0, now, 0.2);
      }
    }

    // 5. Actor Foley Tracker: Footsteps (player + 3D NPCs), Jumps, Landings, Multi-stage Reloads
    const pl = match.player;
    for (const a of match.actors || []) {
      let st = this.actorState.get(a.id);
      if (!st) {
        st = {
          strideMark: a.stride || 0,
          stepParity: 0,
          wasOnGround: !!a.onGround,
          prevVy: a.vy || 0,
          reloadStage: 0,
          wasAlive: !!a.alive
        };
        this.actorState.set(a.id, st);
      }
      if (!a.alive) {
        st.wasAlive = false;
        st.reloadStage = 0;
        st.strideMark = a.stride || 0;
        continue;
      }
      if (!st.wasAlive) {
        st.wasAlive = true;
        st.strideMark = a.stride || 0;
        st.wasOnGround = !!a.onGround;
        st.reloadStage = 0;
      }

      const isPlayer = a === pl;
      const dist = isPlayer ? 0 : Math.hypot(a.x - this.listenerPos[0], a.y + 1.2 - this.listenerPos[1], a.z - this.listenerPos[2]);

      // Jump takeoff & velocity-scaled landing
      if (st.wasOnGround && !a.onGround && (a.vy || 0) > 2.4 && dist < 30) {
        this._playJump(a, isPlayer, now);
      } else if (!st.wasOnGround && a.onGround && dist < 34) {
        const force = clamp(Math.max(Math.abs(st.prevVy) / 7.2, a.landCompress || 0.25), 0.2, 1.0);
        this._playLanding(a, isPlayer, force, now);
      }
      st.wasOnGround = !!a.onGround;
      st.prevVy = a.vy || 0;

      // Stride-synced 2-phase footsteps (walk / sprint / crouch, concrete / steel roof / wood)
      if (a.onGround && dist < 36) {
        const speed = Math.hypot(a.vx || 0, a.vz || 0);
        const stepDist = a.sprintAmt > 0.35 ? 1.92 : a.crouch > 0.45 ? 1.15 : 1.52;
        if (speed > 0.45 && (a.stride - st.strideMark) >= stepDist) {
          st.strideMark = a.stride;
          st.stepParity ^= 1;
          this._playFootstep(a, isPlayer, st.stepParity, now);
        } else if (speed < 0.25) {
          st.strideMark = a.stride;
        }
      }

      // Multi-stage reload foley synced cleanly to actor.reloadFrac (0 -> 1)
      if (a.reload > 0 && dist < 24) {
        const f = a.reloadFrac || 0;
        if (f >= 0.05 && st.reloadStage < 1) {
          st.reloadStage = 1;
          this._playReloadStage(a, isPlayer, 1, now); // mag catch click
        } else if (f >= 0.22 && st.reloadStage < 2) {
          st.reloadStage = 2;
          this._playReloadStage(a, isPlayer, 2, now); // mag slide out
        } else if (f >= 0.50 && st.reloadStage < 3) {
          st.reloadStage = 3;
          this._playReloadStage(a, isPlayer, 3, now); // fresh mag pouch rustle
        } else if (f >= 0.74 && st.reloadStage < 4) {
          st.reloadStage = 4;
          this._playReloadStage(a, isPlayer, 4, now); // magwell firm lock slam
        }
      } else if (a.reload <= 0) {
        st.reloadStage = 0;
      }
    }

    // 6. Visceral low-HP heartbeat when player is critically wounded (HP <= 30)
    if (pl?.alive && pl.hp <= 30) {
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        const urgency = clamp(1 - pl.hp / 30, 0.2, 1);
        this.heartbeatTimer = 0.78 - urgency * 0.26;
        const amp = 0.055 + urgency * 0.055;
        this._playTone({f0: 66, f1: 42, dur: 0.095, gain: amp, type: 'sine', bus: this.uiBus, start: now});
        this._playTone({f0: 56, f1: 38, dur: 0.11, gain: amp * 0.72, type: 'sine', bus: this.uiBus, start: now + 0.16});
      }
    }
  }

  _playHarborDetail(now) {
    if (Math.random() < 0.55 && craneSites.length) {
      // Distant industrial harbor gantry crane structural creak
      const c = craneSites[Math.floor(Math.random() * craneSites.length)];
      const pos = [c.x, 7.5, c.z];
      const d = Math.hypot(pos[0] - this.listenerPos[0], pos[2] - this.listenerPos[2]);
      if (d < 95) {
        const g = 0.022 / (1 + d * 0.045);
        const f = 190 + Math.random() * 85;
        this._playTone({f0: f, f1: f * 0.76, dur: 0.52, gain: g, type: 'sawtooth', pos, lpf: 620, bus: this.ambienceBus, reverbSend: 0.45, start: now});
      }
    } else {
      // Distant maritime gull call out over the west harbor water
      const z = this.listenerPos[2] + (Math.random() - 0.5) * 70;
      const pos = [-38 - Math.random() * 18, 12 + Math.random() * 6, z];
      const f = 1480 + Math.random() * 340;
      this._playTone({f0: f * 0.85, f1: f * 1.18, dur: 0.16, gain: 0.011, type: 'sine', pos, lpf: 2600, bus: this.ambienceBus, reverbSend: 0.55, start: now});
      this._playTone({f0: f * 1.16, f1: f * 0.72, dur: 0.24, gain: 0.010, type: 'sine', pos, lpf: 2400, bus: this.ambienceBus, reverbSend: 0.55, start: now + 0.15});
    }
  }

  // --------------------------------------------------------------------------
  // Physical 6-Layer Weapon Synthesizer (Close Stereo Anatomy + 3D Distant Acoustics)
  // --------------------------------------------------------------------------
  playFire(e, player) {
    if (!this.ctx || !this.on || !this.volume) return;
    const now = this.ctx.currentTime;
    const a = e.actor;
    const isPlayer = a === player;
    const gun = e.gun || a?.gun || 'SW T';
    const srcPos = e.p || (a ? eyeOf(a) : this.listenerPos);
    const j = 0.94 + Math.random() * 0.12;
    const burstStep = (e.burstIndex || 0) % 3;

    this.stats.shots++;

    // Acoustic propagation path (speed-of-sound delay, direct occlusion, ISO air absorption)
    const path = isPlayer
      ? {dist: 0, delay: 0, occluded: false, occlusion: 0, cutoffHz: 19600, directGain: 1, reverbBoost: 0}
      : computeAcousticPath(srcPos, this.listenerPos);

    if (path.occluded) this.stats.occludedEvents++;
    const d = path.dist;
    if (!isPlayer && d > 175) return;

    const start = now + path.delay;
    const distNorm = clamp(d / 85, 0, 1);
    const vol = (isPlayer ? 1.0 : clamp(path.directGain * 1.18, 0.04, 0.94));
    const lpf = path.cutoffHz;
    const pos = isPlayer ? null : srcPos;
    const muzzlePan = isPlayer ? 0.07 : 0;
    const boltPan = isPlayer ? 0.22 : 0;
    const revSend = clamp((isPlayer ? 0.34 : 0.26 + distNorm * 0.48) + path.reverbBoost + this.enclosure * 0.28, 0.15, 0.92);

    // Sidechain duck ambience on close/medium gunfire for huge cinematic headroom
    if (vol > 0.22) this._duckAmbience(vol * (isPlayer ? 0.92 : 0.65), start);

    // LAYER 1: Friedlander shockwave pressure transient (physical blast impulse)
    const blastRate = gun === 'MS10' ? 1.48 * j : gun === 'DF1 OUT' ? (e.source === 'p1' ? 1.32 : 1.18) * j : gun === 'SRA' ? 1.12 * j : gun === 'D1' ? 0.94 * j : 0.88 * j;
    this._playBuffer({
      buffer: this.blastBuf,
      rate: blastRate,
      dur: 0.135,
      gain: (gun === 'SW T' ? 0.36 : gun === 'MS10' ? 0.33 : 0.28) * vol,
      lpf,
      pos,
      pan: muzzlePan,
      bus: this.weaponsBus,
      reverbSend: revSend,
      start
    });

    // LAYER 2: Weapon-specific acoustic signature (crack + chest sub-punch + harmonics)
    if (gun === 'MS10') {
      // Hyper-velocity Mach 1.89 electromagnetic rail carbine
      this._playBuffer({
        buffer: this.crackBuf,
        rate: 1.25 * j,
        dur: 0.048,
        gain: 0.36 * vol * (1 - distNorm * 0.45),
        filterType: 'bandpass',
        f0: 6200 * j,
        f1: 1500 * j,
        q: 1.2,
        lpf,
        pos,
        pan: muzzlePan,
        bus: this.weaponsBus,
        reverbSend: revSend * 0.7,
        start
      });
      // Lorentz rail discharge electromagnetic sweep
      this._playTone({f0: 2150 * j, f1: 310 * j, dur: 0.062, gain: 0.16 * vol, type: 'sawtooth', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, start});
      // Magnetic chest recoil thump
      this._playTone({f0: 148 * j, f1: 48, dur: 0.105, gain: 0.20 * vol, type: 'sine', lpf, pos, pan: 0, bus: this.weaponsBus, start});
      // High-voltage capacitor shimmer (crisp 1st-person mechanical feedback)
      if (isPlayer) {
        this._playTone({f0: 3650 * j, f1: 5150 * j, dur: 0.055, gain: 0.042, type: 'sine', pan: boltPan, bus: this.foleyBus, start: start + 0.022});
      }
    } else if (gun === 'DF1 OUT') {
      const p1 = e.source === 'p1';
      // Tri-pulse burst cadence pitch nuance (shots 1 -> 2 -> 3 feel tightly rhythmic)
      const cadence = 1 + burstStep * 0.035;
      this._playBuffer({
        buffer: this.whiteNoiseBuf,
        loop: true,
        dur: 0.088,
        gain: (p1 ? 0.24 : 0.19) * vol,
        filterType: 'bandpass',
        f0: (p1 ? 3900 : 2550) * j * cadence,
        f1: 540 * j,
        q: 2.1,
        lpf,
        pos,
        pan: muzzlePan,
        bus: this.weaponsBus,
        reverbSend: revSend * 0.65,
        start
      });
      this._playTone({f0: (p1 ? 1040 : 660) * j * cadence, f1: 148 * j, dur: 0.095, gain: 0.16 * vol, type: 'triangle', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, start});
      this._playTone({f0: (p1 ? 195 : 138) * j, f1: 48, dur: 0.115, gain: 0.15 * vol, type: 'sine', lpf, pos, pan: 0, bus: this.weaponsBus, start});
      if (p1) {
        // Overpressured P1 thermal harmonic shimmer
        this._playTone({f0: 1560 * j, f1: 2380 * j, dur: 0.068, gain: 0.085 * vol, type: 'sine', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, start: start + 0.004});
      }
    } else if (gun === 'D1') {
      // Heavy 2-round burst carbine: deep chest punch + double-sear mechanical bark
      this._playBuffer({
        buffer: this.whiteNoiseBuf,
        loop: true,
        dur: 0.102,
        gain: 0.24 * vol,
        filterType: 'bandpass',
        f0: 2100 * j,
        f1: 350 * j,
        q: 1.15,
        lpf,
        pos,
        pan: muzzlePan,
        bus: this.weaponsBus,
        reverbSend: revSend * 0.7,
        start
      });
      this._playTone({f0: 480 * j, f1: 88 * j, dur: 0.115, gain: 0.19 * vol, type: 'triangle', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, start});
      this._playTone({f0: 132 * j, f1: 44, dur: 0.13, gain: 0.19 * vol, type: 'sine', lpf, pos, pan: 0, bus: this.weaponsBus, start});
    } else if (gun === 'SRA') {
      // Agile tactical carbine: sharp gas-piston snap + tight buffer spring
      this._playBuffer({
        buffer: this.whiteNoiseBuf,
        loop: true,
        dur: 0.084,
        gain: 0.23 * vol,
        filterType: 'bandpass',
        f0: 2950 * j,
        f1: 520 * j,
        q: 1.35,
        lpf,
        pos,
        pan: muzzlePan,
        bus: this.weaponsBus,
        reverbSend: revSend * 0.65,
        start
      });
      this._playTone({f0: 420 * j, f1: 86 * j, dur: 0.095, gain: 0.17 * vol, type: 'triangle', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, start});
      this._playTone({f0: 122 * j, f1: 46, dur: 0.108, gain: 0.16 * vol, type: 'sine', lpf, pos, pan: 0, bus: this.weaponsBus, start});
    } else {
      // SW T: weighty Mach 1.05 precision battle rifle (supersonic crack + deep cannon body)
      this._playBuffer({
        buffer: this.crackBuf,
        rate: 0.98 * j,
        dur: 0.052,
        gain: 0.28 * vol * (1 - distNorm * 0.35),
        filterType: 'bandpass',
        f0: 3600 * j,
        f1: 780 * j,
        q: 1.1,
        lpf,
        pos,
        pan: muzzlePan,
        bus: this.weaponsBus,
        reverbSend: revSend * 0.75,
        start
      });
      this._playTone({f0: 340 * j, f1: 64 * j, dur: 0.14, gain: 0.22 * vol, type: 'triangle', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, start});
      this._playTone({f0: 118 * j, f1: 38, dur: 0.165, gain: 0.22 * vol, type: 'sine', lpf, pos, pan: 0, bus: this.weaponsBus, start});
    }

    // LAYER 3: Mechanical bolt carrier / action clack & buffer spring (close-range detail)
    if (isPlayer || d < 18) {
      const mGain = isPlayer ? 0.072 : 0.036 * (1 - d / 18);
      const boltDelay = gun === 'MS10' ? 0.014 : gun === 'DF1 OUT' ? 0.015 : 0.020;
      const boltF = gun === 'MS10' ? 2850 : gun === 'DF1 OUT' ? 2350 : 1650;
      this._playTone({f0: boltF * j, f1: boltF * 0.62 * j, dur: 0.028, gain: mGain, type: 'triangle', pos, pan: boltPan, bus: this.foleyBus, start: start + boltDelay});
      this._playBuffer({
        buffer: this.whiteNoiseBuf,
        loop: true,
        dur: 0.032,
        gain: mGain * 0.85,
        filterType: 'bandpass',
        f0: 3400 * j,
        f1: 1800 * j,
        q: 3.4,
        pos,
        pan: boltPan,
        bus: this.foleyBus,
        start: start + boltDelay + 0.008
      });
      if (isPlayer && gun === 'SRA') {
        // Subtle rifle buffer-spring resonance inside stock
        this._playTone({f0: 690 * j, f1: 640 * j, dur: 0.085, gain: 0.022, type: 'sine', pan: 0.08, bus: this.foleyBus, start: start + 0.024});
      }
    }

    // LAYER 4: Distance-dependent rolling outdoor harbor cannon tail (> 16m or loud shots)
    if (d > 14 || isPlayer) {
      const tailAmp = (isPlayer ? 0.11 : 0.20 * (0.35 + distNorm * 0.85)) * vol;
      this._playBuffer({
        buffer: this.pinkNoiseBuf,
        loop: true,
        dur: 0.24 + distNorm * 0.28,
        attack: 0.018,
        gain: tailAmp,
        filterType: 'lowpass',
        f0: Math.min(lpf, 1150 - distNorm * 480),
        f1: 185,
        q: 0.8,
        pos,
        pan: muzzlePan,
        bus: this.weaponsBus,
        reverbSend: revSend,
        start: start + 0.016
      });
    }

    // LAYER 5: Real 3D Geometric Early Reflections off Harbor Containers & Walls!
    if (vol > 0.14 && this.activeVoices < this.maxVoices - 6) {
      const rayCount = this.mode === AUDIO_MODES.hrtf ? (isPlayer ? 5 : 3) : 2;
      const taps = traceEarlyReflections(srcPos, this.listenerPos, rayCount);
      const maxTaps = isPlayer ? 3 : 2;
      for (let i = 0; i < Math.min(maxTaps, taps.length); i++) {
        const tap = taps[i];
        this.stats.reflections++;
        const tapVol = clamp(tap.gain * vol * (isPlayer ? 0.72 : 0.82), 0.008, 0.22);
        this._playBuffer({
          buffer: this.blastBuf,
          rate: blastRate * (tap.mat === 'steel' ? 1.08 : 0.92),
          dur: 0.125,
          attack: 0.006,
          gain: tapVol,
          filterType: tap.mat === 'steel' ? 'bandpass' : 'lowpass',
          f0: tap.cutoffHz,
          f1: tap.mat === 'steel' ? 880 : 380,
          q: tap.mat === 'steel' ? 1.5 : 0.75,
          pos: tap.pos,
          bus: this.earlyReflBus,
          start: start + tap.delay
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // True Mach-Cone N-Wave & Continuous Doppler Bullet Flybys
  // --------------------------------------------------------------------------
  playWhiz(e) {
    if (!this.ctx || !this.on || !this.volume) return;
    const now = this.ctx.currentTime;
    if (now - this.lastWhizAt < 0.028) return;
    this.lastWhizAt = now;
    this.stats.whizzes++;

    const d = Math.max(0.25, finite(e.dist, 2.0));
    const speed = finite(e.speed, 360);
    const gun = e.gun || 'SW T';
    const doppler = computeDopplerShift(speed, d);
    const closeness = clamp(1 - d / 6.0, 0.14, 1);
    const vol = (0.14 + closeness * closeness * 0.36) * (e.enemy ? 1.0 : 0.56);
    const j = 0.88 + Math.random() * 0.24;

    // 3D pass endpoints along bullet trajectory around closest point of approach
    const pt = e.point || this.listenerPos;
    const dir = e.dir || [0, 0, -1];
    const halfSpan = Math.min(8.5, speed * doppler.sweepDur * 0.45);
    const pStart = [pt[0] - dir[0] * halfSpan, pt[1] - dir[1] * halfSpan, pt[2] - dir[2] * halfSpan];
    const pEnd = [pt[0] + dir[0] * halfSpan, pt[1] + dir[1] * halfSpan, pt[2] + dir[2] * halfSpan];
    const pan0 = e.pan ?? this._computeStereoPan(pStart);
    const pan1 = e.panEnd ?? this._computeStereoPan(pEnd);

    // 1. Physical Supersonic Mach-Cone N-Wave Ballistic Crack (arrives BEFORE distant muzzle blast!)
    if (doppler.isSupersonic && d < 5.6) {
      const crackAmp = vol * (gun === 'MS10' ? 1.42 : 1.12) * clamp(1 - d / 5.9, 0.22, 1);
      this._playBuffer({
        buffer: this.crackBuf,
        rate: (gun === 'MS10' ? 1.32 : 1.02) * j,
        dur: 0.044,
        attack: 0.001,
        gain: crackAmp,
        filterType: 'highpass',
        f0: 950,
        pos: pt,
        pan: pan0,
        panEnd: pan1,
        bus: this.impactsBus,
        reverbSend: 0.22,
        start: now
      });
      this._playTone({
        f0: (gun === 'MS10' ? 3200 : 2100) * j,
        f1: 390 * j,
        dur: 0.036,
        attack: 0.001,
        gain: crackAmp * 0.42,
        type: 'sawtooth',
        pos: pt,
        pan: pan0,
        panEnd: pan1,
        bus: this.impactsBus,
        start: now
      });
    }

    // 2. Continuous Doppler-Shifted Wake / Vortex Sweep across 3D trajectory
    const dur = doppler.sweepDur;
    const fBase = gun === 'MS10' ? 2800 : gun === 'DF1 OUT' ? (e.source === 'p1' ? 1650 : 1220) : 1450;
    const fStart = fBase * doppler.approachRatio * j;
    const fEnd = fBase * doppler.recedeRatio * j;

    if (gun === 'MS10') {
      // Mach 1.89 hypersonic plasma-air whip tear
      this._playBuffer({
        buffer: this.whiteNoiseBuf,
        loop: true,
        dur,
        gain: vol * 1.15,
        filterType: 'bandpass',
        f0: fStart * 1.35,
        f1: fEnd * 0.8,
        q: 3.8,
        pos: pStart,
        posEnd: pEnd,
        pan: pan0,
        panEnd: pan1,
        bus: this.impactsBus,
        start: now + 0.005
      });
      this._playTone({
        f0: fStart * 0.9,
        f1: fEnd * 0.55,
        dur: dur * 0.9,
        gain: vol * 0.34,
        type: 'sawtooth',
        pos: pStart,
        pan: pan0,
        panEnd: pan1,
        bus: this.impactsBus,
        start: now + 0.004
      });
      return;
    }

    if (gun === 'DF1 OUT') {
      // Focused thermal/kinetic pulse hum pass
      this._playTone({f0: fStart, f1: fEnd * 0.55, dur, gain: vol * 0.42, type: 'sine', pos: pStart, pan: pan0, panEnd: pan1, bus: this.impactsBus, start: now});
      this._playTone({f0: fStart * 1.48, f1: fEnd * 0.72, dur: dur * 0.85, gain: vol * 0.22, type: 'triangle', pos: pStart, pan: pan0, panEnd: pan1, bus: this.impactsBus, start: now + 0.006});
      this._playBuffer({
        buffer: this.whiteNoiseBuf,
        loop: true,
        dur,
        gain: vol * 0.52,
        filterType: 'bandpass',
        f0: fStart * 1.5,
        f1: fEnd,
        q: 4.8,
        pos: pStart,
        posEnd: pEnd,
        pan: pan0,
        panEnd: pan1,
        bus: this.impactsBus,
        start: now
      });
      return;
    }

    // 4 organic aerodynamic flyby archetypes driven by true Doppler ratios
    const variant = Math.floor(Math.random() * 4);
    const q = variant === 0 ? 5.2 : variant === 1 ? 3.0 : variant === 2 ? 7.4 : 2.1;
    const fScale = variant === 0 ? 1.15 : variant === 1 ? 1.55 : variant === 2 ? 0.95 : 0.72;
    this._playBuffer({
      buffer: this.whiteNoiseBuf,
      loop: true,
      dur,
      gain: vol * 0.96,
      filterType: 'bandpass',
      f0: fStart * fScale,
      f1: fEnd * fScale * 0.78,
      q,
      pos: pStart,
      posEnd: pEnd,
      pan: pan0,
      panEnd: pan1,
      bus: this.impactsBus,
      start: now + (doppler.isSupersonic ? 0.012 : 0)
    });
    this._playTone({
      f0: fStart * fScale * 0.55,
      f1: fEnd * fScale * 0.42,
      dur: dur * 0.88,
      gain: vol * (variant === 2 ? 0.36 : 0.25),
      type: variant === 3 ? 'triangle' : 'sine',
      pos: pStart,
      pan: pan0,
      panEnd: pan1,
      bus: this.impactsBus,
      start: now + (doppler.isSupersonic ? 0.014 : 0.005)
    });
  }

  // --------------------------------------------------------------------------
  // Modal Resonator Surface Impacts & Curved Ricochets (Steel / Concrete / Wood)
  // --------------------------------------------------------------------------
  playImpact(e) {
    if (!this.ctx || !this.on || !this.volume || !e.point) return;
    const now = this.ctx.currentTime;
    if (now - this.lastImpactAt < 0.032) return;
    const p = e.point;
    const path = computeAcousticPath(p, this.listenerPos);
    if (path.dist > 58) return;
    this.lastImpactAt = now;
    this.stats.impacts++;

    const start = now + path.delay;
    const v = clamp(path.directGain * 1.15, 0.03, 0.95);
    const lpf = path.cutoffHz;
    const mat = e.mat || (e.metal ? 'steel' : 'concrete');
    const j = 0.86 + Math.random() * 0.28;
    const rev = clamp(0.24 + path.reverbBoost + this.enclosure * 0.25, 0.14, 0.72);

    if (mat === 'steel') {
      // Corrugated steel shipping container modal eigenmodes (inharmonic panel resonance!)
      const modes = [
        [325 * j, 0.16, 0.085, 'triangle'],
        [715 * j, 0.12, 0.068, 'sine'],
        [1340 * j, 0.095, 0.052, 'sine'],
        [2580 * j, 0.065, 0.038, 'triangle']
      ];
      for (const [freq, dur, g, type] of modes) {
        this._playTone({f0: freq, f1: freq * 0.94, dur, gain: g * v, type, lpf, pos: p, bus: this.impactsBus, reverbSend: rev * 0.5, start});
      }
      // Sharp metal-on-metal impact spark crack
      this._playBuffer({
        buffer: this.whiteNoiseBuf,
        loop: true,
        dur: 0.058,
        gain: 0.16 * v,
        filterType: 'bandpass',
        f0: 3800 * j,
        f1: 950 * j,
        q: 2.2,
        lpf,
        pos: p,
        bus: this.impactsBus,
        reverbSend: rev,
        start
      });
      // Realistic curved-pitch tumbling ricochet zing ("kiiiing!" / "pyuuun!")
      if (Math.random() < (e.gun === 'MS10' ? 0.48 : 0.30)) {
        const ricDur = 0.18 + Math.random() * 0.14;
        const f0 = (2300 + Math.random() * 1700) * j;
        const f1 = f0 * (Math.random() < 0.35 ? 1.38 : 0.44);
        const ricEnd = [p[0] + (Math.random() - 0.5) * 9, p[1] + 1.5 + Math.random() * 4, p[2] + (Math.random() - 0.5) * 9];
        this._playTone({f0, f1, dur: ricDur, gain: 0.092 * v, type: 'sine', lpf, pos: p, bus: this.impactsBus, reverbSend: rev, start: start + 0.010});
        this._playTone({f0: f0 * 1.46, f1: f1 * 1.31, dur: ricDur * 0.78, gain: 0.042 * v, type: 'triangle', lpf, pos: ricEnd, bus: this.impactsBus, start: start + 0.014});
      }
    } else if (mat === 'wood') {
      // Hollow wooden crate / cable spool thud + wood splinter crack
      this._playTone({f0: 158 * j, f1: 72 * j, dur: 0.095, gain: 0.14 * v, type: 'triangle', lpf, pos: p, bus: this.impactsBus, reverbSend: rev * 0.4, start});
      this._playTone({f0: 330 * j, f1: 210 * j, dur: 0.062, gain: 0.075 * v, type: 'sine', lpf, pos: p, bus: this.impactsBus, start});
      this._playBuffer({
        buffer: this.whiteNoiseBuf,
        loop: true,
        dur: 0.068,
        gain: 0.15 * v,
        filterType: 'bandpass',
        f0: 1850 * j,
        f1: 520 * j,
        q: 1.7,
        lpf,
        pos: p,
        bus: this.impactsBus,
        reverbSend: rev * 0.5,
        start
      });
    } else {
      // Concrete dock / barrier impact thud + delayed gravel/chip debris scatter!
      this._playTone({f0: 185 * j, f1: 62 * j, dur: 0.075, gain: 0.13 * v, type: 'sine', lpf, pos: p, bus: this.impactsBus, start});
      this._playBuffer({
        buffer: this.whiteNoiseBuf,
        loop: true,
        dur: 0.065,
        gain: 0.16 * v,
        filterType: 'lowpass',
        f0: Math.min(lpf, 1950 * j),
        f1: 310,
        q: 1.0,
        pos: p,
        bus: this.impactsBus,
        reverbSend: rev * 0.55,
        start
      });
      // Concrete chips & gravel skittering across dock after impact
      this._playBuffer({
        buffer: this.gritBuf,
        rate: 0.88 + Math.random() * 0.26,
        dur: 0.24,
        attack: 0.008,
        gain: 0.12 * v,
        filterType: 'highpass',
        f0: 1450,
        lpf,
        pos: p,
        bus: this.impactsBus,
        start: start + 0.022
      });
    }
  }

  // --------------------------------------------------------------------------
  // Physics-Driven Brass / Alloy Shell Casing Modal Bounces
  // --------------------------------------------------------------------------
  playCasing(e) {
    if (!this.ctx || !this.on || !this.volume || !e.point) return;
    const now = this.ctx.currentTime;
    if (now - this.lastCasingAt < 0.024) return;
    const d = Math.hypot(e.point[0] - this.listenerPos[0], e.point[2] - this.listenerPos[2]);
    if (d > 14) return;
    this.lastCasingAt = now;
    this.stats.casings++;

    const v = clamp(1 - d / 14, 0.12, 1) * (e.bounce ? 0.58 : 1.0) * clamp((e.speed || 2) / 3.5, 0.35, 1.15);
    const baseF = e.gun === 'MS10' ? 5150 : e.gun === 'DF1 OUT' ? 4650 : e.gun === 'SW T' ? 3750 : 4250;
    const j = 0.93 + Math.random() * 0.14;
    const start = now + computePropagationDelay(d);

    // Authentic brass hollow cylinder modal ratios: 1.0, 1.48, 2.04
    this._playTone({f0: baseF * j, f1: baseF * j * 0.985, dur: 0.048, attack: 0.001, gain: 0.028 * v, type: 'sine', pos: e.point, bus: this.foleyBus, start});
    this._playTone({f0: baseF * 1.48 * j, f1: baseF * 1.46 * j, dur: 0.032, attack: 0.001, gain: 0.017 * v, type: 'triangle', pos: e.point, bus: this.foleyBus, start});
    this._playTone({f0: baseF * 2.04 * j, f1: baseF * 2.0 * j, dur: 0.020, attack: 0.001, gain: 0.010 * v, type: 'sine', pos: e.point, bus: this.foleyBus, start});
  }

  // --------------------------------------------------------------------------
  // Tactical Footsteps, Jumps, Landings & Multi-Stage Reload Foley
  // --------------------------------------------------------------------------
  _playFootstep(actor, isPlayer, parity, now) {
    const last = this.lastFootstepAt.get(actor.id) || 0;
    if (now - last < 0.17) return;
    this.lastFootstepAt.set(actor.id, now);
    this.stats.footsteps++;

    const feetPos = [actor.x, actor.y + 0.08, actor.z];
    const path = isPlayer
      ? {dist: 0, delay: 0, occluded: false, cutoffHz: 18500, directGain: 1, reverbBoost: 0}
      : computeAcousticPath(feetPos, this.listenerPos);
    if (!isPlayer && path.dist > 34) return;

    const mat = surfaceAt(actor.x, actor.z, actor.y);
    const sprint = actor.sprintAmt || 0;
    const crouch = actor.crouch || 0;
    const stanceGain = (1 + sprint * 0.52) * (1 - crouch * 0.62);
    const vol = (isPlayer ? 0.42 : clamp(path.directGain * 1.05, 0.03, 0.72)) * stanceGain;
    const start = now + path.delay;
    const pos = isPlayer ? null : feetPos;
    const pan = isPlayer ? (parity ? 0.11 : -0.11) : 0;
    const lpf = path.cutoffHz;
    const j = 0.90 + Math.random() * 0.20;

    if (mat === 'steel') {
      // Hollow corrugated steel shipping-container roof boot thud + metallic panel ring!
      this._playTone({f0: 175 * j, f1: 72 * j, dur: 0.095, gain: 0.16 * vol, type: 'triangle', lpf, pos, pan, bus: this.foleyBus, reverbSend: 0.28, start});
      this._playTone({f0: 440 * j, f1: 380 * j, dur: 0.068, gain: 0.065 * vol, type: 'sine', lpf, pos, pan, bus: this.foleyBus, start});
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.045, gain: 0.09 * vol, filterType: 'bandpass', f0: 2100 * j, f1: 950 * j, q: 2.2, lpf, pos, pan, bus: this.foleyBus, start: start + 0.038});
    } else if (mat === 'wood') {
      // Wooden crate surface boot thump
      this._playTone({f0: 145 * j, f1: 68 * j, dur: 0.085, gain: 0.15 * vol, type: 'triangle', lpf, pos, pan, bus: this.foleyBus, start});
      this._playBuffer({buffer: this.pinkNoiseBuf, loop: true, dur: 0.048, gain: 0.09 * vol, filterType: 'bandpass', f0: 1100 * j, f1: 420 * j, q: 1.6, lpf, pos, pan, bus: this.foleyBus, start: start + 0.04});
    } else {
      // Concrete dock asphalt: 2-phase heel-strike + toe-off gravel scuff
      this._playTone({f0: 122 * j, f1: 52 * j, dur: 0.068, gain: 0.14 * vol, type: 'sine', lpf, pos, pan, bus: this.foleyBus, start});
      this._playBuffer({
        buffer: this.pinkNoiseBuf,
        loop: true,
        dur: 0.052,
        gain: 0.12 * vol,
        filterType: 'bandpass',
        f0: 1650 * j,
        f1: 620 * j,
        q: 1.3,
        lpf,
        pos,
        pan,
        bus: this.foleyBus,
        reverbSend: 0.14,
        start
      });
      // Toe-off grit scuff 45ms later
      this._playBuffer({
        buffer: this.whiteNoiseBuf,
        loop: true,
        dur: 0.042,
        gain: 0.062 * vol,
        filterType: 'bandpass',
        f0: 2450 * j,
        f1: 1150 * j,
        q: 2.0,
        lpf,
        pos,
        pan,
        bus: this.foleyBus,
        start: start + (sprint > 0.35 ? 0.036 : 0.052)
      });
    }

    // Subtle tactical nylon gear/rig rustle during brisk strides
    if (sprint > 0.25 && (isPlayer || path.dist < 14)) {
      this._playBuffer({
        buffer: this.pinkNoiseBuf,
        loop: true,
        dur: 0.075,
        attack: 0.015,
        gain: 0.042 * vol * sprint,
        filterType: 'bandpass',
        f0: 1850 * j,
        f1: 1200 * j,
        q: 1.8,
        lpf,
        pos,
        pan: -pan * 0.5,
        bus: this.foleyBus,
        start: start + 0.018
      });
    }
  }

  _playJump(actor, isPlayer, now) {
    const feetPos = [actor.x, actor.y + 0.1, actor.z];
    const path = isPlayer ? {delay: 0, cutoffHz: 18500, directGain: 1} : computeAcousticPath(feetPos, this.listenerPos);
    const vol = isPlayer ? 0.36 : clamp(path.directGain * 0.65, 0.02, 0.5);
    const start = now + path.delay;
    const pos = isPlayer ? null : feetPos;
    this._playBuffer({buffer: this.pinkNoiseBuf, loop: true, dur: 0.085, attack: 0.01, gain: 0.11 * vol, filterType: 'bandpass', f0: 950, f1: 1850, q: 1.4, lpf: path.cutoffHz, pos, bus: this.foleyBus, start});
    this._playTone({f0: 110, f1: 68, dur: 0.075, gain: 0.085 * vol, type: 'sine', lpf: path.cutoffHz, pos, bus: this.foleyBus, start});
  }

  _playLanding(actor, isPlayer, force, now) {
    const feetPos = [actor.x, actor.y + 0.08, actor.z];
    const path = isPlayer ? {delay: 0, cutoffHz: 18500, directGain: 1, reverbBoost: 0} : computeAcousticPath(feetPos, this.listenerPos);
    const mat = surfaceAt(actor.x, actor.z, actor.y);
    const vol = (isPlayer ? 0.58 : clamp(path.directGain * 0.95, 0.04, 0.72)) * force;
    const start = now + path.delay;
    const pos = isPlayer ? null : feetPos;
    const lpf = path.cutoffHz;

    this._playTone({f0: mat === 'steel' ? 162 : 108, f1: 38, dur: 0.145, gain: 0.24 * vol, type: 'sine', lpf, pos, bus: this.foleyBus, reverbSend: 0.22, start});
    if (mat === 'steel') {
      this._playTone({f0: 390, f1: 310, dur: 0.11, gain: 0.10 * vol, type: 'triangle', lpf, pos, bus: this.foleyBus, reverbSend: 0.32, start});
    }
    this._playBuffer({buffer: this.pinkNoiseBuf, loop: true, dur: 0.105, gain: 0.16 * vol, filterType: 'lowpass', f0: Math.min(lpf, 1650), f1: 320, pos, bus: this.foleyBus, start});
    // Heavy gear settle follow-through
    this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.075, attack: 0.012, gain: 0.055 * vol, filterType: 'bandpass', f0: 2100, f1: 1100, q: 1.9, lpf, pos, bus: this.foleyBus, start: start + 0.045});
  }

  _playReloadStage(actor, isPlayer, stage, now) {
    const p = isPlayer ? null : eyeOf(actor);
    const path = isPlayer ? {delay: 0, cutoffHz: 18500, directGain: 1} : computeAcousticPath(p, this.listenerPos);
    const vol = isPlayer ? 0.95 : clamp(path.directGain * 0.78, 0.03, 0.55);
    const start = now + path.delay;
    const pan = isPlayer ? 0.16 : 0;
    const lpf = path.cutoffHz;

    if (stage === 1) {
      // Stage 1: Metallic magazine release latch click
      this._playTone({f0: 1950, f1: 1120, dur: 0.028, attack: 0.001, gain: 0.075 * vol, type: 'triangle', lpf, pos: p, pan, bus: this.foleyBus, start});
      this._playTone({f0: 420, f1: 240, dur: 0.045, gain: 0.065 * vol, type: 'sine', lpf, pos: p, pan, bus: this.foleyBus, start: start + 0.01});
    } else if (stage === 2) {
      // Stage 2: Empty magazine friction slide out of magwell
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.11, attack: 0.015, gain: 0.065 * vol, filterType: 'bandpass', f0: 2600, f1: 1050, q: 3.4, lpf, pos: p, pan: pan + 0.06, bus: this.foleyBus, start});
      this._playTone({f0: 360, f1: 195, dur: 0.065, gain: 0.05 * vol, type: 'triangle', lpf, pos: p, pan, bus: this.foleyBus, start: start + 0.02});
    } else if (stage === 3) {
      // Stage 3: Fresh magazine pulled from tactical vest pouch (nylon rustle)
      this._playBuffer({buffer: this.pinkNoiseBuf, loop: true, dur: 0.125, attack: 0.022, gain: 0.072 * vol, filterType: 'bandpass', f0: 1750, f1: 2600, q: 1.6, lpf, pos: p, pan: isPlayer ? -0.14 : 0, bus: this.foleyBus, start});
    } else if (stage === 4) {
      // Stage 4: Magazine seated firmly into magwell (solid chunk + metallic catch!)
      this._playTone({f0: 240, f1: 115, dur: 0.065, attack: 0.002, gain: 0.11 * vol, type: 'triangle', lpf, pos: p, pan, bus: this.foleyBus, start});
      this._playTone({f0: 1480, f1: 2200, dur: 0.032, attack: 0.001, gain: 0.075 * vol, type: 'sine', lpf, pos: p, pan, bus: this.foleyBus, start: start + 0.026});
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.042, gain: 0.062 * vol, filterType: 'bandpass', f0: 3200, f1: 1400, q: 2.6, lpf, pos: p, pan, bus: this.foleyBus, start: start + 0.02});
    }
  }

  _playLoadedBoltRack(actor, isPlayer, now) {
    const p = isPlayer ? null : eyeOf(actor);
    const path = isPlayer ? {delay: 0, cutoffHz: 18500, directGain: 1} : computeAcousticPath(p, this.listenerPos);
    if (!isPlayer && path.dist > 26) return;
    const vol = isPlayer ? 1.0 : clamp(path.directGain * 0.72, 0.03, 0.5);
    const start = now + path.delay;
    const pan = isPlayer ? 0.15 : 0;
    const lpf = path.cutoffHz;
    const gun = actor?.gun || 'SW T';

    // Stage 5: Charging handle / bolt release dual rack-clack!
    const fRack = gun === 'MS10' ? 1850 : gun === 'DF1 OUT' ? 1480 : 960;
    this._playTone({f0: fRack * 0.65, f1: fRack * 1.15, dur: 0.055, attack: 0.002, gain: 0.095 * vol, type: 'triangle', lpf, pos: p, pan, bus: this.foleyBus, start});
    this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.052, gain: 0.08 * vol, filterType: 'bandpass', f0: 3800, f1: 1600, q: 2.8, lpf, pos: p, pan, bus: this.foleyBus, start: start + 0.01});
    this._playTone({f0: fRack * 1.2, f1: fRack * 0.78, dur: 0.068, attack: 0.002, gain: 0.115 * vol, type: 'triangle', lpf, pos: p, pan, bus: this.foleyBus, start: start + 0.062});
    if (gun === 'MS10' && isPlayer) {
      // Rail capacitor armed chime
      this._playTone({f0: 2200, f1: 3300, dur: 0.095, gain: 0.052, type: 'sine', pan: 0.12, bus: this.foleyBus, start: start + 0.07});
    }
  }

  // --------------------------------------------------------------------------
  // Event Dispatcher (Full Backward Compatibility with PortAudio)
  // --------------------------------------------------------------------------
  event(e, player) {
    if (!this.on || !this.ctx || !player) return;
    const now = this.ctx.currentTime;
    const a = e.actor;

    if (e.type === 'fire') {
      this.playFire(e, player);
      return;
    }
    if (e.type === 'whiz') {
      this.playWhiz(e);
      return;
    }
    if (e.type === 'impact') {
      this.playImpact(e);
      return;
    }
    if (e.type === 'casing') {
      this.playCasing(e);
      return;
    }
    if (e.type === 'reload' && a) {
      const st = this.actorState.get(a.id);
      if (st) st.reloadStage = 1;
      const isP = a === player;
      const d = isP ? 0 : Math.hypot(a.x - this.listenerPos[0], a.z - this.listenerPos[2]);
      if (isP || d < 24) this._playReloadStage(a, isP, 1, now);
      return;
    }
    if (e.type === 'loaded') {
      this._playLoadedBoltRack(a, a === player, now);
      return;
    }
    if (e.type === 'dry' && a === player) {
      // Crisp mechanical firing-pin click on empty chamber
      this._playTone({f0: 2150, f1: 780, dur: 0.022, attack: 0.001, gain: 0.072, type: 'triangle', pan: 0.12, bus: this.foleyBus, start: now});
      this._playTone({f0: 190, f1: 110, dur: 0.032, attack: 0.001, gain: 0.068, type: 'square', pan: 0.1, bus: this.foleyBus, start: now});
      return;
    }
    if (e.type === 'hit') {
      if (a === player) {
        this._playOutgoingHit(e, now);
      }
      if (e.victim === player) {
        this._playIncomingHit(e, player, now);
      }
      return;
    }
    if (e.type === 'tanker') {
      this._playTankerActivate(e, player, now);
      return;
    }
    if (e.type === 'point' && a === player) {
      this._playTone({f0: 587.3, f1: 880, dur: 0.11, gain: 0.11, type: 'triangle', bus: this.uiBus, start: now});
      this._playTone({f0: 880, f1: 1174.7, dur: 0.17, gain: 0.10, type: 'sine', bus: this.uiBus, start: now + 0.08});
      return;
    }
    if (e.type === 'spawn' && a === player) {
      // Crisp tactical radio deploy confirm
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.06, gain: 0.04, filterType: 'bandpass', f0: 2200, f1: 1500, q: 3.0, bus: this.uiBus, start: now});
      this._playTone({f0: 640, f1: 960, dur: 0.09, gain: 0.065, type: 'sine', bus: this.uiBus, start: now + 0.02});
      return;
    }
    if (e.type === 'end') {
      const won = e.winner === player.team;
      const chord = won ? [440, 554.4, 659.3, 880] : [392, 349.2, 293.7];
      chord.forEach((f, idx) => {
        this._playTone({f0: f, f1: f * (won ? 1.005 : 0.98), dur: 0.36, gain: 0.085, type: 'triangle', bus: this.uiBus, start: now + idx * 0.07});
      });
    }
  }

  _playOutgoingHit(e, now) {
    if (e.kill) {
      // Iconic tactical elimination confirmation: crisp transient + harmonic double chime + sub punch
      this._playTone({f0: 145, f1: 54, dur: 0.12, gain: 0.16, type: 'sine', bus: this.uiBus, start: now});
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.048, gain: 0.11, filterType: 'bandpass', f0: 4600, f1: 1800, q: 1.9, bus: this.uiBus, start: now});
      this._playTone({f0: 932, f1: 1397, dur: 0.085, gain: 0.145, type: 'triangle', bus: this.uiBus, start: now});
      this._playTone({f0: 1397, f1: 1864, dur: 0.16, gain: 0.13, type: 'sine', bus: this.uiBus, start: now + 0.055});
    } else if (e.shieldBreak) {
      // Dramatic 6-shard crystalline energy shield shatter cascade + sub discharge
      this._playTone({f0: 280, f1: 68, dur: 0.20, gain: 0.18, type: 'sawtooth', lpf: 900, bus: this.uiBus, start: now});
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.19, gain: 0.19, filterType: 'bandpass', f0: 6800, f1: 1450, q: 1.6, bus: this.uiBus, start: now});
      const shards = [2840, 3620, 4480, 5350, 2190, 3140];
      shards.forEach((f, i) => {
        this._playTone({
          f0: f,
          f1: f * 0.62,
          dur: 0.085 + i * 0.018,
          attack: 0.001,
          gain: 0.068 * (1 - i * 0.09),
          type: i % 2 ? 'sine' : 'triangle',
          pan: (i % 2 ? 1 : -1) * (0.12 + i * 0.08),
          bus: this.uiBus,
          start: now + i * 0.016
        });
      });
    } else if (e.shield) {
      // Crisp crystalline shield hit resonance
      this._playTone({f0: 1280, f1: 790, dur: 0.065, gain: 0.125, type: 'triangle', bus: this.uiBus, start: now});
      this._playTone({f0: 2560, f1: 1820, dur: 0.045, gain: 0.068, type: 'sine', bus: this.uiBus, start: now + 0.004});
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.036, gain: 0.062, filterType: 'highpass', f0: 3600, bus: this.uiBus, start: now});
    } else {
      // Solid tactile armor/body hit confirm
      this._playTone({f0: 820, f1: 520, dur: 0.052, gain: 0.125, type: 'triangle', bus: this.uiBus, start: now});
      this._playTone({f0: 190, f1: 88, dur: 0.055, gain: 0.095, type: 'sine', bus: this.uiBus, start: now});
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.030, gain: 0.058, filterType: 'bandpass', f0: 2600, f1: 950, q: 2.0, bus: this.uiBus, start: now});
    }
  }

  _playIncomingHit(e, player, now) {
    const srcPos = e.actor && e.actor !== player ? eyeOf(e.actor) : null;
    const pan = srcPos ? this._computeStereoPan(srcPos) : 0;
    this._duckAmbience(e.shieldBreak ? 0.85 : 0.45, now);

    if (e.shieldBreak) {
      // Visceral shield collapse + subtle high-tension acoustic ring
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.26, gain: 0.25, filterType: 'bandpass', f0: 4400, f1: 520, q: 1.4, pan, bus: this.uiBus, start: now});
      this._playTone({f0: 660, f1: 118, dur: 0.24, gain: 0.20, type: 'sawtooth', lpf: 1400, pan, bus: this.uiBus, start: now});
      this._playTone({f0: 3650, f1: 3480, dur: 0.48, attack: 0.02, gain: 0.026, type: 'sine', pan: 0, bus: this.uiBus, start: now + 0.04});
    } else {
      // Heavy directional ballistic vest impact thud
      this._playTone({f0: 215, f1: 68, dur: 0.14, gain: 0.19, type: 'sine', pan, bus: this.uiBus, start: now});
      this._playBuffer({buffer: this.pinkNoiseBuf, loop: true, dur: 0.095, gain: 0.16, filterType: 'lowpass', f0: 1550, f1: 280, pan, bus: this.uiBus, start: now});
    }
  }

  _playTankerActivate(e, player, now) {
    const isPlayer = e.actor === player;
    const tk = e.tanker;
    const pos = isPlayer ? null : (tk ? [tk.x, 1.6, tk.z] : null);
    const path = isPlayer || !pos ? {delay: 0, cutoffHz: 18500, directGain: 1} : computeAcousticPath(pos, this.listenerPos);
    const tv = isPlayer ? 1.0 : clamp(path.directGain * 0.72, 0.04, 0.55);
    const start = now + path.delay;

    // 1. Pressurized pneumatic release valve hiss
    this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.34, attack: 0.012, gain: 0.18 * tv, filterType: 'bandpass', f0: 4200, f1: 680, q: 1.5, lpf: path.cutoffHz, pos, bus: this.foleyBus, reverbSend: 0.32, start});
    // 2. Hydraulic latch chunk + rapid brass ammo hopper cascade
    this._playTone({f0: 185, f1: 76, dur: 0.11, gain: 0.16 * tv, type: 'triangle', lpf: path.cutoffHz, pos, bus: this.foleyBus, start});
    for (let i = 0; i < 4; i++) {
      const f = 3200 + i * 380;
      this._playTone({f0: f, f1: f * 0.92, dur: 0.036, gain: 0.038 * tv, type: 'sine', lpf: path.cutoffHz, pos, pan: isPlayer ? 0.18 - i * 0.08 : 0, bus: this.foleyBus, start: start + 0.05 + i * 0.038});
    }
    // 3. 1.5x ammo refinery harmonic activation triad
    this._playTone({f0: 360, f1: 540, dur: 0.10, gain: 0.115 * tv, type: 'triangle', lpf: path.cutoffHz, pos, bus: isPlayer ? this.uiBus : this.foleyBus, start: start + 0.04});
    this._playTone({f0: 540, f1: 810, dur: 0.12, gain: 0.125 * tv, type: 'sine', lpf: path.cutoffHz, pos, bus: isPlayer ? this.uiBus : this.foleyBus, start: start + 0.12});
    this._playTone({f0: 810, f1: 1215, dur: 0.22, gain: 0.125 * tv, type: 'sine', lpf: path.cutoffHz, pos, bus: isPlayer ? this.uiBus : this.foleyBus, start: start + 0.21});
  }

  // --------------------------------------------------------------------------
  // Live Telemetry & Real-Time Waveform Output Analysis
  // --------------------------------------------------------------------------
  getOutputMetrics() {
    if (!this.analyser || !this._analyserBuf) return {rms: 0, peak: 0, finite: true};
    this.analyser.getFloatTimeDomainData(this._analyserBuf);
    let sumSq = 0, peak = 0, ok = true;
    for (let i = 0; i < this._analyserBuf.length; i++) {
      const s = this._analyserBuf[i];
      if (!Number.isFinite(s)) { ok = false; continue; }
      const a = Math.abs(s);
      if (a > peak) peak = a;
      sumSq += s * s;
    }
    return {rms: Math.sqrt(sumSq / this._analyserBuf.length), peak, finite: ok};
  }

  getDiagnostics() {
    return {
      engine: this.version,
      mode: this.mode,
      on: this.on,
      volume: this.volume,
      state: this.ctx?.state || 'uninitialized',
      sampleRate: this.ctx?.sampleRate || 0,
      activeVoices: this.activeVoices,
      enclosure: Number(this.enclosure.toFixed(3)),
      steelRatio: Number(this.steelRatio.toFixed(3)),
      duckLevel: Number(this.duckLevel.toFixed(3)),
      stats: {...this.stats},
      output: this.getOutputMetrics()
    };
  }
}
