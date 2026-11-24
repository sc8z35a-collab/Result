// Sound Engin 2.0 — 300Hz-Class Ultra-High-Rate Physical Acoustic & Multi-Band Spatial DSP Engine.
//
// Major Architectural Leaps Beyond Sound Engin 1.0:
//   1. 300Hz-Class Sub-Frame Acoustic Control Kernel (3.33ms temporal resolution):
//      - Sub-stepped 300Hz listener/Doppler/barrel-heat/stapedius-reflex/breathing acoustic integrator.
//      - True 300Hz sampled hyperbolic Doppler pitch curves (`setValueCurveAtTime`) across CPA.
//      - Dedicated 300Hz Linkwitz-Riley-inspired Multiband Mastering Crossover:
//        SUB (<300Hz mono-tight chest impact + psychoacoustic missing-fundamental harmonics for phones)
//        + MID/AIR (300Hz-20kHz full 3D HRTF spatial field) + 4x oversampled soft-clip & true-peak limiter.
//   2. True 3-Band UTD Knife-Edge Fresnel Diffraction + Lloyd's Mirror Ground Interference:
//      - Independently solves acoustic transmission & edge diffraction for LOW (<300Hz), MID (300-2800Hz),
//        and HIGH (>2800Hz) bands so deep bass wraps naturally around steel containers while highs shadow.
//   3. Zero-Jitter Analytical Method-of-Images Early Reflections (FermatCore Steel Manifold Fusion):
//      - Solves exact 1st-order specular reflections off Harbor Range's 104 vertical corrugated steel faces
//        plus geometric fallback rays for concrete quay walls & gantry cranes.
//   4. 3-Zone Procedural Velvet-Noise + Eigenmode Convolution Reverb (`open` / `alley` / `overhead`):
//      - Continuously morphs among open quay, corrugated steel canyon, and crane/stacked-container canopy.
//   5. Woodworth-Schlosberg Binaural Near-Field ITD/ILD + Pinna Elevation Cue Modeling:
//      - Sub-millisecond interaural time delay (0..0.68ms), near-field contralateral head shadow, and
//        elevation pinna notch (6.5-10.5kHz) so container-roof footsteps sound unmistakably overhead.
//   6. 14 Physical Modal & Waveguide Synthesis Buffers + 65+ Distinct Tactical/Harbor Sound Archetypes:
//      - Friedlander shockwave, 300Hz sub-punch, Mach N-wave crack, Lorentz rail arc, Karplus-Strong bolt,
//        8-mode Kirchhoff-Love corrugated steel, anisotropic wood splinter, concrete spall, 5-mode brass
//        shell, Minnaert harbor water bubbles, 12-shard shield glass, Kevlar cloth, formant breath, foghorn.
//      - Priority-managed voice pool + Stapedius acoustic reflex + full Lightweight Mode zero-IR stereo mode.

import {clamp} from './geometry.js';
import {obstruction, raycastMaterial, surfaceAt, craneSites} from './yard.js';
import {eyeOf} from './posture.js';
import {STEEL_MANIFOLD, reflectPointAcrossFace} from './fermat.js';

export const SOUND_ENGIN_VERSION = 'Sound Engin 2.0';
export const SOUND_CONTROL_HZ = 300;
export const SUB_CROSSOVER_HZ = 300;
export const SPEED_OF_SOUND = 343.0; // m/s in maritime air (~20°C)
export const AUDIO_MODES = {
  ultra300: 'ultra300',
  hrtf: 'hrtf',
  stereo: 'stereo'
};

// Structured catalog of 65+ physical sound archetypes powered by Sound Engin 2.0
export const SOUND_CATALOG = Object.freeze({
  weapons: [
    'SW T Battle Rifle (9-Layer Supersonic)',
    'SRA Gas-Piston Carbine + Buffer Spring',
    'D1 Heavy 2-Round Double-Sear Burst',
    'MS10 Mach 1.89 Lorentz Railgun + Ozone Snap',
    'DF1 OUT Tri-Pulse Cadence + P1 Plasma Overpressure',
    'RD20 Smart-Collar Compact Carbine',
    'RD30 Staggered Dual-Barrel Twin Bark',
    'RD40 Mach 1.47 Twin-Linked Hydraulic Carbine',
    'Low-Ammo Last-5-Rounds Mag Spring Ping',
    'Barrel-Heat Thermal Expansion Tick & Sizzle',
    'Empty Chamber Firing-Pin Dry Click'
  ],
  ballistics: [
    '300Hz Hyperbolic Hypersonic MS10 Plasma Whip',
    '300Hz Hyperbolic Supersonic Mach N-Wave Crack',
    '300Hz Hyperbolic Twin-Linked Dual-Wake Flyby',
    '300Hz Hyperbolic DF1 Thermal Hum Pass',
    '300Hz Tumbling Post-Ricochet Flutter Buzz',
    '300Hz Subsonic Aerodynamic Whistle'
  ],
  impacts: [
    'Corrugated Steel 8-Mode Kirchhoff-Love Ring',
    'Oblique Steel Curved-Doppler Ricochet Zing',
    'High-Velocity Steel Edge Penetration Tear',
    'Concrete Dock Sub-Thump + Multi-Grain Spall',
    'Hollow Wood Crate Cavity + Anisotropic Splinter',
    'Wood Crate Wallbang Punch-Through',
    'Harbor Water Minnaert Cavitation Splash',
    'Brass Shell Casing on Concrete Bounce',
    'Brass Shell Casing on Steel Roof Clatter'
  ],
  foley: [
    'Footstep Concrete 3-Phase (Heel/Mid/Toe)',
    'Footstep Steel Roof Resonant Boot Thud',
    'Footstep Wood Crate Hollow Step',
    'Sprint Tactical Kevlar Gear Rustle',
    'Crouch Stealth Muffled Step',
    'Stance Crouch/Stand Knee & Rig Foley',
    'Corner Lean / Peek Sling Shift',
    'Jump Takeoff Scuff & Cloth Lift',
    'Velocity-Scaled Surface Landing + Gear Settle',
    'ADS Weapon Raise & Optic Click',
    '5-Stage Weapon-Specific Reload Choreography',
    'Sprint Exertion Formant Breath & Critical Heartbeat'
  ],
  combat: [
    'Armor / Body Impact Confirm + Sub-300Hz Punch',
    'Energy Shield Crystalline Shimmer Hit',
    '12-Shard Energy Shield Shatter Cascade',
    'Elimination Sub-Impact + Harmonic Triad',
    'Bank-Shot / Wallbang Bonus Harmonic Overtones',
    'Directional Incoming Vest Hit + Stapedius Reflex',
    'Incoming Shield Collapse + Tinnitus Recovery'
  ],
  systems: [
    'FermatCore 1.0 Optical Bank-Shot Lock Chime',
    'FermatCore 1.0 2-Bounce Double-Lock Chord',
    'ResonanceCore 1.0 4-Mode Steel Boom + Seismic Knock',
    'AeroVortex 1.0 Live CFD Venturi Wind Shear',
    'AeroVortex 1.0 Pressurized Nitrogen Smoke Canister',
    'ThermoFlux 1.0 FLIR Thermal Shutter & Sensor Hum',
    'ChronoTrace 1.0 4D Ballistic Scanner Sweep',
    'RD40 ARV1.2 Optical Lock Chord + D01 Phased Sonar',
    'DF1 OUT EVR1 Thermal Lens & P1 Overheat Steam Vent'
  ],
  tanker: [
    'Supply Tanker 3D Pressurized Turbine Hum',
    'Pneumatic Release Valve High-Pressure Hiss',
    'Brass Ammo Hopper Cascade Clatter',
    '1.5x Refinery Harmonic Activation Triad'
  ],
  ambience: [
    'Directional West Harbor Dual-Swell Surf',
    'Harbor Foam Crest Spray Shimmer',
    'Sheltered Container Canyon Venturi Wind',
    'Distant Gantry Crane Structural Steel Groan',
    'Distant Cargo Ship <300Hz Brass Foghorn',
    'Spatial Maritime Sea Gulls & Mooring Buoy Bell'
  ],
  vocal: [
    'NV2.6 Force Tactical Radio PTT + Klatt Formant Voice',
    'NV2.6 Force Sync Double-Swing 3-2-1 Tactile Radio Beat',
    'NV2.6 Force 3D Spatial Blind-Side Startle Gasp + Rig Jolt',
    'NV2.6 Force 3D Spatial Container-Diffracted Enemy Shout',
    'NV2.6 Force Somatic Deep-Breath Reset Exhale',
    'NV2.6 Force Bait-Trap Focus Breath & Safety Check Click'
  ]
});

export const SOUND_CATALOG_COUNT = Object.values(SOUND_CATALOG).reduce((n, list) => n + list.length, 0);

const TAU = Math.PI * 2;
const safeFreq = (sr, f) => clamp(Number.isFinite(f) ? f : 1000, 22, Math.min(20000, (sr || 48000) * 0.45));
const safeGain = g => Math.max(0.0001, Number.isFinite(g) ? g : 0.0001);
const finite = (v, fb = 0) => (Number.isFinite(v) ? v : fb);

function makePrng(seed = 20262) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Pure-JS Physical Acoustics & 300Hz-Class DSP Kernel (100% Unit-Testable)
// ============================================================================

/** Physical acoustic speed-of-sound propagation delay (t = d / 343 m/s). */
export function computePropagationDelay(dist, maxDelay = 0.60) {
  if (!Number.isFinite(dist) || dist <= 0) return 0;
  return Math.min(maxDelay, dist / SPEED_OF_SOUND);
}

/** ISO 9613-1 maritime atmospheric 3-band absorption & equivalent low-pass cutoff. */
export function computeAirAbsorption(dist, humidity = 0.72, tempC = 20) {
  const d = Math.max(0, finite(dist, 0));
  const humFactor = clamp(1.0 + (0.65 - humidity) * 0.18 + (20 - tempC) * 0.006, 0.86, 1.18);
  const cutoffHz = clamp(
    19600 * Math.exp(-0.0168 * d * humFactor) + 740 * Math.exp(-0.0038 * d),
    650,
    19800
  );
  const spread = 1 / (1 + d * 0.064 + d * d * 0.00024);
  const gainLow = clamp(spread * Math.exp(-0.0009 * d), 0.01, 1);
  const gainMid = clamp(spread * Math.exp(-0.0046 * d * humFactor), 0.005, 1);
  const gainHigh = clamp(spread * Math.exp(-0.0155 * d * humFactor), 0.002, 1);
  return {dist: d, cutoffHz, airGain: spread, gainLow, gainMid, gainHigh};
}

/** True continuous ballistic Doppler & Mach-cone shockwave physics. */
export function computeDopplerShift(speed, dist, c = SPEED_OF_SOUND) {
  const v = Math.max(10, finite(speed, 280));
  const b = Math.max(0.25, finite(dist, 2.0));
  const mach = v / c;
  const isSupersonic = mach >= 1.0;
  const machAngleRad = isSupersonic ? Math.asin(clamp(1 / mach, 0.05, 1)) : Math.PI * 0.5;
  const dtProbe = clamp((b / v) * 1.4, 0.014, 0.075);
  const vr = (v * v * dtProbe) / Math.hypot(b, v * dtProbe);
  const vrEff = Math.min(vr, c * 0.64);
  const approachRatio = c / Math.max(c * 0.34, c - vrEff);
  const recedeRatio = c / (c + vr * 0.88);
  const sweepDur = clamp(0.068 + b * 0.019 + (isSupersonic ? 0 : 0.048), 0.080, 0.26);
  return {mach, isSupersonic, machAngleRad, approachRatio, recedeRatio, sweepDur};
}

/**
 * 300Hz-Class Exact Hyperbolic Doppler Frequency Multiplier Curve across Closest Point of Approach.
 * Evaluates f(t)/f0 = c / (c + v_r(t)) at 300 points/sec (3.33ms resolution) for Web Audio
 * `setValueCurveAtTime` — eliminates coarse linear ramps on supersonic/subsonic bullet flybys!
 */
export function computeDopplerCurve300Hz(speed, dist, c = SPEED_OF_SOUND, steps = 0) {
  const dop = computeDopplerShift(speed, dist, c);
  const v = Math.max(10, finite(speed, 280));
  const b = Math.max(0.25, finite(dist, 2.0));
  const dur = dop.sweepDur;
  const n = steps > 4 ? (steps | 0) : clamp(Math.round(dur * SOUND_CONTROL_HZ), 24, 96);
  const curve = new Float32Array(n);
  const halfT = dur * 0.5;
  const maxApproachVr = c * 0.64;

  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 0.5;
    const t = (u - 0.5) * 2 * halfT; // -halfT (approaching) -> 0 (CPA) -> +halfT (receding)
    const x = v * t;
    // Radial velocity away from listener: negative when approaching, positive when receding
    const vr = (v * x) / Math.hypot(b, x);
    const vrClamped = vr < 0 ? Math.max(-maxApproachVr, vr) : vr * 0.90;
    curve[i] = clamp(c / Math.max(c * 0.34, c + vrClamped), 0.38, 2.85);
  }
  return {curve, duration: dur, sampleHz: SOUND_CONTROL_HZ, doppler: dop};
}

/**
 * Woodworth-Schlosberg Binaural Near-Field Model (Spherical Head a = 8.75cm):
 * Computes exact Interaural Time Difference (ITD 0..0.68ms), near-field boosted ILD,
 * contralateral ear head-shadow low-pass cutoff, and elevation pinna notch (6.5..10.5kHz).
 */
export function computeBinauralNearField(srcPos, listenerPos, listenerRight = [1, 0, 0], listenerFwd = [0, 0, -1]) {
  const dx = srcPos[0] - listenerPos[0];
  const dy = srcPos[1] - listenerPos[1];
  const dz = srcPos[2] - listenerPos[2];
  const dist = Math.max(0.15, Math.hypot(dx, dy, dz));
  const horiz = Math.max(0.05, Math.hypot(dx, dz));
  const invD = 1 / dist;

  const sideDot = clamp((dx * listenerRight[0] + dz * listenerRight[2]) * invD, -1, 1);
  const fwdDot = clamp((dx * listenerFwd[0] + dy * listenerFwd[1] + dz * listenerFwd[2]) * invD, -1, 1);
  const azim = Math.asin(sideDot); // -pi/2 (left) .. +pi/2 (right)
  const absAzim = Math.abs(azim);

  // Woodworth formula: ITD = (a / c) * (|theta| + sin(|theta|)), max ~0.66ms at 90 deg
  const headRadius = 0.0875;
  const itdSec = (headRadius / SPEED_OF_SOUND) * (absAzim + Math.sin(absAzim)) * (azim >= 0 ? 1 : -1);
  const itdMs = itdSec * 1000;

  // Near-field proximity boost (< 3.5m) dramatically sharpens ILD and contralateral head shadow!
  const nearFactor = clamp(1 - (dist - 0.35) / 3.4, 0, 1);
  const ildDb = Math.abs(sideDot) * (6.2 + nearFactor * 5.8);
  const shadowCutoffHz = clamp(19500 - Math.abs(sideDot) * (10800 + nearFactor * 4800), 1900, 19500);

  // Pinna elevation cue: overhead container-roof sources shift pinna notch upward (6.8 -> 10.6 kHz)
  const elevDeg = Math.atan2(dy, horiz) * (180 / Math.PI);
  const pinnaNotchHz = clamp(7600 + elevDeg * 42, 6200, 11200);
  // Subtle front-back warmth: sources directly behind lose a touch of 4-8kHz pinna brightness
  const frontPresenceDb = fwdDot >= 0 ? fwdDot * 1.4 : fwdDot * 2.4;

  return {
    dist,
    azimRad: azim,
    pan: sideDot,
    itdMs,
    ildDb,
    nearFactor,
    shadowCutoffHz,
    elevDeg,
    pinnaNotchHz,
    frontPresenceDb
  };
}

/**
 * NV2.6 Force Klatt Physical Vocal-Tract & Stress-Modulated Prosody Planner (100% Pure-JS Unit-Testable):
 * Generates realistic multi-syllable vowel-formant trajectories (F1, F2, F3), fundamental F0 glottal pitch
 * contours, aspiration breathiness, and timing cadence tailored to callsign vocal anatomy & live combat stress!
 */
export function computeVocalFormantPlan(kind, prosody = {}) {
  const f0Base = clamp(finite(prosody.f0Hz, 155), 88, 340);
  const scale = clamp(finite(prosody.tractScale, 1.0), 0.80, 1.32);
  const tempo = clamp(finite(prosody.tempo, 1.0), 0.72, 1.48);
  const stress = clamp(finite(prosody.stress, 0.25), 0, 1);
  const breath = clamp(finite(prosody.breathiness, 0.24), 0.08, 0.92);

  // Japanese-inspired vowel formant prototypes [F1, F2, F3] scaled by vocal-tract length
  const V = {
    a: [720 * scale, 1240 * scale, 2550 * scale],
    i: [310 * scale, 2260 * scale, 3020 * scale],
    u: [350 * scale, 1180 * scale, 2420 * scale],
    e: [510 * scale, 1920 * scale, 2680 * scale],
    o: [490 * scale,  960 * scale, 2480 * scale]
  };

  if (kind === 'STARTLE') {
    return {
      mode: 'gasp',
      syllables: [
        {dur: 0.13 / tempo, gap: 0.02, f0Start: f0Base * 1.18, f0End: f0Base * 1.56, f1: 780 * scale, f2: 1620 * scale, f3: 2740 * scale, asp: 0.92, gain: 0.95}
      ]
    };
  }
  if (kind === 'BREATH_RESET') {
    return {
      mode: 'exhale',
      syllables: [
        {dur: 0.36 / tempo, gap: 0.0, f0Start: f0Base * 0.86, f0End: f0Base * 0.72, f1: 480 * scale, f2: 1220 * scale, f3: 2380 * scale, asp: 0.96, gain: 0.78}
      ]
    };
  }

  // Distinct phonetic rhythm & pitch contour per tactical channel!
  const specs = {
    SWING_NOW:          [['i', 0.075, 1.05, 1.14], ['e', 0.075, 1.12, 1.24], ['o', 0.115, 1.24, 1.38]],
    PLAYER_ORDER_SWING: [['a', 0.070, 1.04, 1.12], ['e', 0.075, 1.12, 1.22], ['o', 0.110, 1.20, 1.34]],
    AMBUSH:             [['u', 0.068, 1.22, 1.36], ['a', 0.088, 1.34, 1.14], ['a', 0.078, 1.24, 1.06]],
    MAN_DOWN:           [['a', 0.092, 1.18, 0.92], ['e', 0.085, 1.06, 0.84], ['a', 0.105, 0.96, 0.76]],
    SHIELD_BREAK:       [['a', 0.082, 1.10, 1.26], ['o', 0.095, 1.22, 1.08]],
    BAIT_READY:         [['u', 0.095, 0.90, 0.86], ['o', 0.110, 0.88, 0.82]],
    BAIT_PARTNER:       [['o', 0.082, 0.96, 1.02], ['a', 0.095, 1.02, 0.94]],
    PLAYER_ORDER_TRAP:  [['o', 0.085, 0.94, 0.98], ['u', 0.105, 0.92, 0.86]],
    RELOAD_COVER:       [['i', 0.072, 1.08, 1.16], ['o', 0.082, 1.14, 1.02], ['a', 0.085, 1.04, 0.94]],
    TRADE_REQUEST:      [['e', 0.076, 1.12, 1.22], ['a', 0.092, 1.18, 1.02]],
    SUPPRESS_PIN:       [['o', 0.080, 1.04, 1.14], ['e', 0.092, 1.12, 0.98]],
    PLAYER_ORDER_COVER: [['o', 0.078, 1.02, 1.10], ['a', 0.092, 1.08, 0.96]],
    FLANK_CLEAR:        [['i', 0.082, 0.98, 1.04], ['a', 0.105, 1.02, 0.90]],
    CONTACT:            [['e', 0.075, 1.08, 1.20], ['i', 0.088, 1.16, 1.04]]
  };

  const seq = specs[kind] || specs.CONTACT;
  const whisper = kind === 'BAIT_READY' || kind === 'PLAYER_ORDER_TRAP';
  const syllables = seq.map(([vKey, baseDur, p0, p1]) => {
    const [f1, f2, f3] = V[vKey] || V.a;
    return {
      dur: clamp((baseDur / tempo) * (1 - stress * 0.12), 0.045, 0.16),
      gap: clamp(0.032 / tempo, 0.018, 0.055),
      f0Start: f0Base * p0,
      f0End: f0Base * p1,
      f1, f2, f3,
      asp: whisper ? clamp(breath + 0.44, 0.52, 0.92) : clamp(breath + stress * 0.16, 0.14, 0.78),
      gain: whisper ? 0.62 : (0.84 + stress * 0.16)
    };
  });
  return {mode: whisper ? 'whisper' : 'speech', syllables};
}

/**
 * True 3-Band UTD Knife-Edge Fresnel Diffraction + Material Transmission Loss + Lloyd's Mirror Ground Reflection.
 * Physically guarantees: low (<300Hz) wraps around steel containers far more strongly than high (>2800Hz)!
 */
export function computeMultiBandAcousticPath(srcPos, dstPos) {
  const dx = dstPos[0] - srcPos[0];
  const dy = dstPos[1] - srcPos[1];
  const dz = dstPos[2] - srcPos[2];
  const dist = Math.hypot(dx, dy, dz);
  const delay = computePropagationDelay(dist);
  const air = computeAirAbsorption(dist);

  // Lloyd's Mirror specular ground-bounce comb frequency on concrete wharf (y = 0)
  const hDist = Math.hypot(dx, dz);
  const y1 = Math.max(0.15, srcPos[1]);
  const y2 = Math.max(0.15, dstPos[1]);
  const groundPath = Math.hypot(hDist, y1 + y2);
  const groundDelta = Math.max(0.002, groundPath - dist);
  const lloydNotchHz = clamp(SPEED_OF_SOUND / (2 * groundDelta), 160, 14000);

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
      reverbBoost: 0,
      bandGains: {low: 1, mid: 1, high: 1},
      lloydNotchHz
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
      reverbBoost: 0,
      bandGains: {low: air.gainLow, mid: air.gainMid, high: air.gainHigh},
      lloydNotchHz
    };
  }

  // Cast 6 UTD edge-diffraction probes around obstacle (tight L/R, wide L/R, container roof, upper clearance)
  const hLen = hDist || 1;
  const rx = -dz / hLen, rz = dx / hLen;
  const hitP = directHit.point || [
    (srcPos[0] + dstPos[0]) * 0.5,
    (srcPos[1] + dstPos[1]) * 0.5,
    (srcPos[2] + dstPos[2]) * 0.5
  ];
  const probes = [
    {pt: [hitP[0] + rx * 1.45, hitP[1] + 0.12, hitP[2] + rz * 1.45], h: 1.45},
    {pt: [hitP[0] - rx * 1.45, hitP[1] + 0.12, hitP[2] - rz * 1.45], h: 1.45},
    {pt: [hitP[0] + rx * 3.10, hitP[1] + 0.15, hitP[2] + rz * 3.10], h: 3.10},
    {pt: [hitP[0] - rx * 3.10, hitP[1] + 0.15, hitP[2] - rz * 3.10], h: 3.10},
    {pt: [hitP[0], hitP[1] + 2.35, hitP[2]], h: 2.35},
    {pt: [hitP[0], hitP[1] + 4.85, hitP[2]], h: 4.85}
  ];

  let openEdges = 0;
  let minKnifeH = 5.5;
  for (const pr of probes) {
    if (obstruction(srcPos, pr.pt) > 0.99 && obstruction(pr.pt, dstPos) > 0.99) {
      openEdges++;
      if (pr.h < minKnifeH) minKnifeH = pr.h;
    }
  }

  const mat = directHit.mat || 'steel';
  const matDensity = mat === 'concrete' ? 0.94 : mat === 'steel' ? 0.86 : 0.60;
  const diffraction = openEdges / probes.length;

  // UTD Fresnel knife-edge diffraction factor at 150Hz (lambda=2.29m), 1200Hz (0.286m), 5600Hz (0.061m)
  const d1 = Math.max(0.5, directHit.t * dist);
  const d2 = Math.max(0.5, (1 - directHit.t) * dist);
  const dEff = (d1 * d2) / Math.max(1.0, d1 + d2);
  const fresnelGain = lambda => {
    const v = minKnifeH * Math.sqrt(2 / (lambda * Math.max(0.4, dEff)));
    return 1 / (1 + 1.85 * v + 1.45 * v * v);
  };

  // Mass-law transmission + Fresnel diffraction leak per frequency band
  const transLow = mat === 'wood' ? 0.56 : mat === 'steel' ? 0.42 : 0.30;
  const transMid = mat === 'wood' ? 0.34 : mat === 'steel' ? 0.18 : 0.12;
  const transHigh = mat === 'wood' ? 0.18 : mat === 'steel' ? 0.06 : 0.04;

  const edgeWeight = 0.25 + diffraction * 0.75;
  const lowLeak = clamp(transLow + fresnelGain(SPEED_OF_SOUND / 150) * edgeWeight * 0.82, 0.14, 0.94);
  const midLeak = clamp(transMid + fresnelGain(SPEED_OF_SOUND / 1200) * edgeWeight * 0.74, 0.06, 0.78);
  const highLeak = clamp(transHigh + fresnelGain(SPEED_OF_SOUND / 5600) * edgeWeight * 0.64, 0.02, 0.58);

  const occlusion = clamp(matDensity * (1 - diffraction * 0.52), 0.22, 0.95);
  const occCutoff = clamp(360 + (1 - occlusion) * 2450 + diffraction * 960, 340, air.cutoffHz);
  const cutoffHz = Math.min(air.cutoffHz, occCutoff);
  const occGain = 1 - occlusion * 0.62;

  return {
    dist,
    delay,
    occluded: true,
    occlusion,
    diffraction,
    blockerMat: mat,
    cutoffHz,
    directGain: air.airGain * occGain,
    reverbBoost: occlusion * 0.48,
    bandGains: {
      low: air.gainLow * lowLeak,
      mid: air.gainMid * midLeak,
      high: air.gainHigh * highLeak
    },
    lloydNotchHz
  };
}

/** Backward-compatible Sound Engin 1.0 alias backed by Sound Engin 2.0's 3-band UTD solver. */
export function computeAcousticPath(srcPos, dstPos) {
  return computeMultiBandAcousticPath(srcPos, dstPos);
}

/**
 * Exact Analytical 1st-Order Method-of-Images Acoustic Early Reflections off Harbor Range's
 * 104 pre-baked corrugated steel container walls (zero Monte Carlo ray jitter!).
 */
export function traceImageSourceReflections(srcPos, dstPos, maxTaps = 6) {
  const dDirect = Math.hypot(dstPos[0] - srcPos[0], dstPos[1] - srcPos[1], dstPos[2] - srcPos[2]);
  const faces = STEEL_MANIFOLD.faces;
  const taps = [];
  const maxDist = 38.0;

  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    // Quick bounding cull: both source and listener must lie on the front reflective side of face f
    const sDist = f.axis === 0 ? (srcPos[0] - f.coord) * f.nx : (srcPos[2] - f.coord) * f.nz;
    if (sDist <= 0.35 || sDist > maxDist) continue;
    const lDist = f.axis === 0 ? (dstPos[0] - f.coord) * f.nx : (dstPos[2] - f.coord) * f.nz;
    if (lDist <= 0.35 || lDist > maxDist) continue;

    // Quick center-distance cull
    const cdx = f.cx - srcPos[0], cdz = f.cz - srcPos[2];
    if (cdx * cdx + cdz * cdz > 1444) continue; // > 38m

    // Reflect listener across face plane -> straight line from srcPos to image hits exact Fermat specular point!
    const qImg = reflectPointAcrossFace(dstPos, f);
    const dx = qImg[0] - srcPos[0], dy = qImg[1] - srcPos[1], dz = qImg[2] - srcPos[2];
    const denom = f.axis === 0 ? dx : dz;
    if (Math.abs(denom) < 1e-5) continue;
    const t = (f.coord - (f.axis === 0 ? srcPos[0] : srcPos[2])) / denom;
    if (t <= 0.02 || t >= 0.98) continue;

    const px = srcPos[0] + dx * t;
    const py = srcPos[1] + dy * t;
    const pz = srcPos[2] + dz * t;
    const u = f.axis === 0 ? pz : px;
    if (u < f.uMin || u > f.uMax || py < f.yMin - 0.25 || py > f.yMax + 0.65) continue;

    const totalPath = Math.hypot(dx, dy, dz);
    const extraPath = totalPath - dDirect;
    const delay = extraPath / SPEED_OF_SOUND;
    if (delay < 0.006 || delay > 0.32) continue;

    const hp = [px + f.nx * 0.14, clamp(py, 0.35, 4.8), pz + f.nz * 0.14];
    if (obstruction(srcPos, hp) <= 0.98) continue;
    const secClear = obstruction(hp, dstPos) > 0.98;
    const air = computeAirAbsorption(totalPath);
    const gain = clamp(0.80 * air.airGain * (secClear ? 0.46 : 0.15), 0.008, 0.36);

    taps.push({
      delay,
      absDelay: totalPath / SPEED_OF_SOUND,
      gain,
      pos: hp,
      mat: 'steel',
      cutoffHz: Math.min(5200, air.cutoffHz),
      clear: secClear,
      analytical: true,
      faceId: f.id
    });
  }

  taps.sort((a, b) => a.delay - b.delay);
  return taps.slice(0, Math.max(1, maxTaps));
}

/**
 * Hybrid Analytical Method-of-Images + Geometric Early-Reflection Raycaster.
 * Guarantees crisp physical harbor slapback echoes with backward compatibility for EchoPulse 1.0!
 */
export function traceEarlyReflections(srcPos, dstPos, maxRays = 6) {
  const analytical = traceImageSourceReflections(srcPos, dstPos, Math.min(4, maxRays));
  const dDirect = Math.hypot(dstPos[0] - srcPos[0], dstPos[1] - srcPos[1], dstPos[2] - srcPos[2]);
  const rays = Math.max(2, Math.min(8, maxRays));
  const maxDist = 42;
  const taps = [...analytical];
  const baseAngle = Math.atan2(dstPos[2] - srcPos[2], dstPos[0] - srcPos[0]) + 0.37;

  for (let i = 0; i < rays && taps.length < maxRays + 2; i++) {
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
    const delay = Math.max(0, totalPath - dDirect) / SPEED_OF_SOUND;
    if (delay < 0.007 || delay > 0.34) continue;
    // Deduplicate near-identical arrival delays already captured analytically
    if (taps.some(tp => Math.abs(tp.delay - delay) < 0.0055)) continue;

    const n = hit.normal || [0, 1, 0];
    const hp = [p[0] + n[0] * 0.12, p[1] + n[1] * 0.12, p[2] + n[2] * 0.12];
    const secClear = obstruction(hp, dstPos) > 0.98;
    const mat = hit.mat || 'steel';
    const refl = mat === 'steel' ? 0.78 : mat === 'concrete' ? 0.62 : 0.38;
    const cutoffHz = mat === 'steel' ? 4800 : mat === 'concrete' ? 2500 : 1500;
    const air = computeAirAbsorption(totalPath);
    const gain = clamp(refl * air.airGain * (secClear ? 0.42 : 0.16), 0.008, 0.34);

    taps.push({
      delay,
      absDelay: totalPath / SPEED_OF_SOUND,
      gain,
      pos: hp,
      mat,
      cutoffHz: Math.min(cutoffHz, air.cutoffHz),
      clear: secClear,
      analytical: false
    });
  }
  taps.sort((a, b) => a.delay - b.delay);
  return taps.slice(0, maxRays);
}

/**
 * Estimates 3-Zone Acoustic Enclosure (open harbor quay vs corrugated steel canyon vs overhead crane/stack canopy).
 */
export function estimateEnclosure(pos) {
  const probeDist = 16;
  let enclosedSum = 0;
  let steelHits = 0;
  let hitCount = 0;
  let distSum = 0;
  let overheadSum = 0;

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
  // Overhead canopy / double-stacked container / gantry crane probes
  const overheadProbes = [
    [pos[0], pos[1] + 9.0, pos[2]],
    [pos[0] + 6.0, pos[1] + 4.4, pos[2]],
    [pos[0] - 6.0, pos[1] + 4.4, pos[2]],
    [pos[0], pos[1] + 4.4, pos[2] + 6.0]
  ];
  for (const end of overheadProbes) {
    const hit = raycastMaterial(pos, end);
    if (hit && hit.t <= 1) {
      const w = 1 - hit.t;
      enclosedSum += w * 0.45;
      overheadSum += w;
      hitCount++;
      if (hit.mat === 'steel') steelHits++;
    }
  }
  // Proximity to overhead gantry cranes also boosts overhead structural resonance
  for (const c of craneSites || []) {
    const dc = Math.hypot(pos[0] - c.x, pos[2] - c.z);
    if (dc < 14) overheadSum += (1 - dc / 14) * 0.55;
  }

  const enclosure = clamp(enclosedSum / 6.2, 0, 1);
  const overheadRatio = clamp(overheadSum / 2.2, 0, 1);
  const steelRatio = hitCount ? steelHits / hitCount : 0;
  return {
    enclosure,
    overheadRatio,
    steelRatio,
    openRatio: 1 - enclosure,
    avgDist: distSum / 8
  };
}

/** Asymmetric hyperbolic-tangent analog pressure saturation curve for WaveShaperNode (4x oversample ready). */
export function synthesizeWaveShaperCurve(drive = 2.4, samples = 2048) {
  const n = Math.max(64, samples | 0);
  const curve = new Float32Array(n);
  const k = Math.max(0.1, drive);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const asym = x + 0.065 * x * x - 0.015 * x * x * x;
    curve[i] = clamp(Math.tanh(asym * k) / norm, -1, 1);
  }
  return curve;
}

/**
 * Physical Modal, Waveguide & Acoustic Impulse Buffer Synthesizer (14 distinct physical families!).
 * Zero external samples — 100% deterministic float32 PCM synthesis at native AudioContext sample rate.
 */
export function synthesizeModalSamples(sampleRate = 48000, kind = 'blast') {
  const sr = Math.max(8000, sampleRate | 0);

  if (kind === 'crack') {
    const rng = makePrng(9187);
    const len = Math.max(256, Math.round(sr * 0.048));
    const out = new Float32Array(len);
    const shockSamples = Math.max(6, Math.round(sr * 0.00052));
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let s = 0;
      if (i < shockSamples) {
        const u = i / shockSamples;
        s = u < 0.22 ? (u / 0.22) : (1 - 2 * ((u - 0.22) / 0.78));
      } else {
        const tail = Math.exp(-(t - 0.00052) * 92);
        const w = rng() * 2 - 1;
        lp = lp * 0.40 + w * 0.60;
        s = lp * tail * 0.68;
      }
      out[i] = clamp(s, -1, 1);
    }
    return out;
  }

  if (kind === 'sub300') {
    // 300Hz-Class Chest-Impact Sub-Harmonic Transient + Missing-Fundamental Phone-Speaker Punch!
    const len = Math.max(512, Math.round(sr * 0.165));
    const out = new Float32Array(len);
    let ph1 = 0, ph2 = 0, ph3 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const f1 = 52 + 128 * Math.exp(-t * 32); // 180Hz -> 52Hz chest drop
      const f2 = Math.min(295, f1 * 2.0);      // <300Hz 2nd harmonic warmth (audible on phones!)
      const f3 = Math.min(298, f1 * 3.0);      // 3rd harmonic transient weight
      ph1 += TAU * f1 / sr;
      ph2 += TAU * f2 / sr;
      ph3 += TAU * f3 / sr;
      const atk = Math.min(1, t / 0.0022);
      const env1 = Math.exp(-t * 17.5);
      const env2 = Math.exp(-t * 28.0);
      const env3 = Math.exp(-t * 46.0);
      out[i] = clamp(atk * (Math.sin(ph1) * 0.78 * env1 + Math.sin(ph2) * 0.34 * env2 + Math.sin(ph3) * 0.16 * env3), -1, 1);
    }
    return out;
  }

  if (kind === 'rail') {
    // Mach 1.89 Lorentz Railgun Plasma-Arc + High-Voltage Inductive Discharge
    const rng = makePrng(5101);
    const len = Math.max(512, Math.round(sr * 0.12));
    const out = new Float32Array(len);
    let ph = 0, lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const f = 380 + 3600 * Math.exp(-t * 44);
      ph += TAU * f / sr;
      const w = rng() * 2 - 1;
      lp = lp * 0.55 + w * 0.45;
      const arc = Math.tanh(Math.sin(ph) * 2.4 + Math.sin(ph * 2.71) * 1.1) * Math.exp(-t * 26);
      const ozone = (w - lp) * Math.exp(-t * 54) * 0.72;
      out[i] = clamp(arc * 0.65 + ozone * 0.55, -1, 1);
    }
    return out;
  }

  if (kind === 'bolt') {
    // Karplus-Strong Metallic Waveguide Bolt-Carrier Action Clack
    const rng = makePrng(3119);
    const len = Math.max(256, Math.round(sr * 0.068));
    const out = new Float32Array(len);
    const delayLen = Math.max(12, Math.round(sr / 1850));
    const ring = new Float32Array(delayLen);
    for (let i = 0; i < delayLen; i++) ring[i] = (rng() * 2 - 1) * Math.exp(-i / delayLen);
    let ptr = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const next = (ptr + 1) % delayLen;
      const v = (ring[ptr] + ring[next]) * 0.475;
      ring[ptr] = v;
      ptr = next;
      // Second bolt-lock click 17ms later
      const secondClick = Math.abs(t - 0.017) < 0.0012 ? (rng() * 2 - 1) * 0.85 : 0;
      const body = Math.sin(TAU * 420 * t) * Math.exp(-t * 75) * 0.42;
      out[i] = clamp((v * 0.95 + secondClick + body) * Math.exp(-t * 28), -1, 1);
    }
    return out;
  }

  if (kind === 'steel') {
    // 8-Mode Inharmonic Kirchhoff-Love Corrugated Steel Container Impact Ring
    const rng = makePrng(6421);
    const len = Math.max(512, Math.round(sr * 0.28));
    const out = new Float32Array(len);
    const modes = [
      [182, 0.42, 9.5], [326, 0.34, 13.0], [548, 0.26, 17.5], [718, 0.24, 21.0],
      [1120, 0.18, 28.0], [1590, 0.14, 34.0], [2340, 0.11, 44.0], [3420, 0.08, 56.0]
    ];
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let s = (rng() * 2 - 1) * Math.exp(-t * 140) * 0.65;
      for (let m = 0; m < modes.length; m++) {
        const [f, amp, dcy] = modes[m];
        s += Math.sin(TAU * f * t * (1 - 0.015 * Math.min(1, t * 4))) * amp * Math.exp(-t * dcy);
      }
      out[i] = clamp(s * 0.58, -1, 1);
    }
    return out;
  }

  if (kind === 'wood') {
    // Anisotropic Spruce Crate Fiber Splinter + Hollow Cavity Resonance
    const rng = makePrng(7307);
    const len = Math.max(512, Math.round(sr * 0.15));
    const out = new Float32Array(len);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const w = rng() * 2 - 1;
      lp = lp * 0.72 + w * 0.28;
      const cavity = (Math.sin(TAU * 155 * t) * 0.55 + Math.sin(TAU * 318 * t) * 0.32) * Math.exp(-t * 28);
      // Discrete wooden fiber micro-snaps across first 55ms
      const crackle = (t < 0.055 && rng() < 0.035) ? (rng() * 2 - 1) * 0.95 : 0;
      const body = lp * Math.exp(-t * 48) * 0.68;
      out[i] = clamp(cavity + body + crackle * 0.52, -1, 1);
    }
    return out;
  }

  if (kind === 'concrete') {
    // Concrete Dock Impact Thud + Multi-Grain Spall & Gravel Skitter
    const rng = makePrng(2026);
    const len = Math.max(512, Math.round(sr * 0.32));
    const out = new Float32Array(len);
    for (let k = 0; k < 38; k++) {
      const idx = Math.floor(Math.pow(rng(), 1.48) * (len - 48));
      const amp = (0.32 + rng() * 0.68) * Math.exp(-idx / (len * 0.46));
      for (let j = 0; j < 32 && idx + j < len; j++) {
        out[idx + j] += (rng() * 2 - 1) * amp * Math.exp(-j * 0.20);
      }
    }
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const thud = Math.sin(TAU * (165 - 95 * Math.min(1, t * 14)) * t) * Math.exp(-t * 42) * 0.55;
      out[i] = clamp(out[i] * 0.78 + thud, -1, 1);
    }
    return out;
  }

  if (kind === 'brass') {
    // Exact 5-Mode Bessel Hollow Brass Shell Casing Bounce [1.0, 1.48, 2.04, 2.76, 3.55]
    const len = Math.max(256, Math.round(sr * 0.072));
    const out = new Float32Array(len);
    const ratios = [
      [1.00, 0.52, 46], [1.48, 0.34, 62], [2.04, 0.22, 82], [2.76, 0.14, 105], [3.55, 0.09, 130]
    ];
    const fBase = 4200;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let s = 0;
      for (const [r, a, d] of ratios) {
        if (fBase * r < sr * 0.44) s += Math.sin(TAU * fBase * r * t) * a * Math.exp(-t * d);
      }
      out[i] = clamp(s * Math.min(1, t / 0.0006), -1, 1);
    }
    return out;
  }

  if (kind === 'water') {
    // Minnaert Cavitation Bubble Resonance (f_minnaert ~ 3.26 / R) + Maritime Water Plume
    const rng = makePrng(8821);
    const len = Math.max(1024, Math.round(sr * 0.36));
    const out = new Float32Array(len);
    // Spawn 16 resonant rising-pitch air bubbles
    const bubbles = [];
    for (let b = 0; b < 16; b++) {
      bubbles.push({
        t0: 0.008 + rng() * 0.20,
        f0: 360 + rng() * 1450,
        amp: 0.18 + rng() * 0.26,
        decay: 32 + rng() * 38
      });
    }
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const w = rng() * 2 - 1;
      lp = lp * 0.76 + w * 0.24;
      let s = (w - lp * 0.5) * Math.exp(-t * 14) * 0.45 + Math.sin(TAU * 92 * t) * Math.exp(-t * 24) * 0.38;
      for (let b = 0; b < bubbles.length; b++) {
        const bb = bubbles[b];
        if (t >= bb.t0) {
          const dt = t - bb.t0;
          if (dt < 0.09) {
            // Rising bubble pitch chirp (classic Minnaert meniscus signature!)
            const f = bb.f0 * (1 + dt * 5.2);
            s += Math.sin(TAU * f * dt) * bb.amp * Math.exp(-dt * bb.decay);
          }
        }
      }
      out[i] = clamp(s * 0.65, -1, 1);
    }
    return out;
  }

  if (kind === 'glass') {
    // 12-Shard Crystalline Energy Shield Shatter Cascade
    const rng = makePrng(4493);
    const len = Math.max(1024, Math.round(sr * 0.32));
    const out = new Float32Array(len);
    const shards = [];
    for (let k = 0; k < 12; k++) {
      shards.push({
        t0: k * 0.011 + rng() * 0.008,
        f0: 2100 + rng() * 4400,
        amp: (0.28 + rng() * 0.22) * (1 - k * 0.045),
        dcy: 22 + rng() * 26
      });
    }
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let s = (rng() * 2 - 1) * Math.exp(-t * 36) * 0.35;
      for (let k = 0; k < shards.length; k++) {
        const sh = shards[k];
        if (t >= sh.t0) {
          const dt = t - sh.t0;
          if (dt < 0.14 && sh.f0 < sr * 0.44) {
            s += Math.sin(TAU * sh.f0 * (1 - dt * 1.4) * dt) * sh.amp * Math.exp(-dt * sh.dcy);
          }
        }
      }
      out[i] = clamp(s * 0.68, -1, 1);
    }
    return out;
  }

  if (kind === 'cloth') {
    // Tactical Nylon / Kevlar Vest Micro-Friction Foley
    const rng = makePrng(1777);
    const len = Math.max(512, Math.round(sr * 0.14));
    const out = new Float32Array(len);
    let b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const w = rng() * 2 - 1;
      b1 = b1 * 0.78 + w * 0.22;
      b2 = b2 * 0.92 + b1 * 0.08;
      const env = Math.sin(Math.min(1, t / 0.14) * Math.PI) * (0.7 + 0.3 * Math.sin(TAU * 22 * t));
      out[i] = clamp((b1 - b2) * env * 1.65, -1, 1);
    }
    return out;
  }

  if (kind === 'breath') {
    // Formant-Filtered Human Tactical Exhalation (F1=520Hz, F2=1450Hz, F3=2600Hz)
    const rng = makePrng(3347);
    const len = Math.max(1024, Math.round(sr * 0.34));
    const out = new Float32Array(len);
    let y1 = 0, y2 = 0, y3 = 0;
    const a1 = 1 - Math.exp(-TAU * 520 / sr);
    const a2 = 1 - Math.exp(-TAU * 1450 / sr);
    const a3 = 1 - Math.exp(-TAU * 2600 / sr);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const w = rng() * 2 - 1;
      y1 += (w - y1) * a1;
      y2 += (w - y2) * a2;
      y3 += (w - y3) * a3;
      const env = Math.pow(Math.sin(clamp(t / 0.34, 0, 1) * Math.PI), 1.35);
      out[i] = clamp((y1 * 0.45 + (y2 - y1) * 0.65 + (y3 - y2) * 0.35) * env * 1.15, -1, 1);
    }
    return out;
  }

  if (kind === 'foghorn') {
    // Deep <300Hz Maritime Cargo Ship Brass Foghorn (68Hz + 136Hz + 204Hz + 272Hz!)
    const len = Math.max(2048, Math.round(sr * 1.65));
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const atk = clamp(t / 0.24, 0, 1);
      const rel = clamp((1.65 - t) / 0.42, 0, 1);
      const env = atk * rel;
      const vib = 1 + Math.sin(TAU * 2.4 * t) * 0.004;
      const f = 68.0 * vib;
      const s = Math.sin(TAU * f * t) * 0.56
        + Math.sin(TAU * f * 2 * t + 0.2) * 0.30
        + Math.sin(TAU * f * 3 * t + 0.5) * 0.16
        + Math.sin(TAU * f * 4 * t + 0.9) * 0.08;
      out[i] = clamp(Math.tanh(s * 1.35) * env * 0.78, -1, 1);
    }
    return out;
  }

  // Default: 'blast' — Friedlander Muzzle Shockwave + Rarefaction + Propellant Turbulence
  const rng = makePrng(4201);
  const len = Math.max(512, Math.round(sr * 0.155));
  const out = new Float32Array(len);
  const tPlus = 0.0026;
  let lp1 = 0, lp2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const tau = t / tPlus;
    const friedlander = tau < 4.8 ? (1 - tau) * Math.exp(-1.42 * tau) : 0;
    const raw = rng() * 2 - 1;
    lp1 = lp1 * 0.60 + raw * 0.40;
    lp2 = lp2 * 0.87 + lp1 * 0.13;
    const gasBurst = Math.exp(-t * 26) * (lp1 * 0.65 + raw * 0.35);
    const subBody = Math.exp(-t * 17.5) * lp2 * 0.58;
    out[i] = clamp(friedlander * 0.88 + gasBurst * 0.62 + subBody * 0.48, -1, 1);
  }
  return out;
}

/** Backward-compatible Sound Engin 1.0 alias for blast & crack samples. */
export function createGunImpulseSamples(sampleRate = 48000, kind = 'blast') {
  return synthesizeModalSamples(sampleRate, kind);
}

/**
 * 3-Zone Procedural Stereo Velvet-Noise + Eigenmode Convolution Impulse Response Generator:
 *   - 'open': Open Harbor Quay & Distant Pier Reflections (wide 2.25s tail)
 *   - 'alley': Corrugated Steel Container Canyon (metallic flutter + 300Hz/420Hz/895Hz modes)
 *   - 'overhead': Under Gantry Crane / Double-Stacked Container Canopy (<300Hz structural boom + ceiling slap)
 */
export function generateHarborIR2(sampleRate = 48000, duration = 2.0, style = 'open') {
  const sr = Math.max(8000, sampleRate | 0);
  const len = Math.max(1024, Math.round(sr * duration));
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  const isAlley = style === 'alley';
  const isOverhead = style === 'overhead';
  const rng = makePrng(isOverhead ? 9511 : isAlley ? 7741 : 3191);

  const rt60Low = isOverhead
    ? Math.min(duration * 0.94, 1.38)
    : isAlley
      ? Math.min(duration * 0.92, 1.12)
      : Math.min(duration * 0.95, 2.08);
  const rt60High = isOverhead
    ? Math.min(duration * 0.44, 0.48)
    : isAlley
      ? Math.min(duration * 0.52, 0.58)
      : Math.min(duration * 0.34, 0.64);
  const decayLow = 6.9078 / rt60Low;
  const decayHigh = 6.9078 / rt60High;

  const earlyTaps = isOverhead
    ? [
        [0.009, 0.62, 0.54], [0.017, 0.48, 0.58], [0.029, 0.50, 0.36],
        [0.044, 0.32, 0.46], [0.062, 0.35, 0.28], [0.088, 0.22, 0.29]
      ]
    : isAlley
      ? [
          [0.013, 0.58, 0.42], [0.022, 0.36, 0.55], [0.035, 0.46, 0.28],
          [0.048, 0.25, 0.44], [0.063, 0.34, 0.22], [0.081, 0.19, 0.31],
          [0.104, 0.24, 0.18], [0.131, 0.14, 0.22]
        ]
      : [
          [0.026, 0.42, 0.24], [0.051, 0.22, 0.38], [0.088, 0.31, 0.18],
          [0.140, 0.16, 0.27], [0.212, 0.20, 0.14], [0.316, 0.12, 0.17]
        ];

  for (const [sec, gl, gr] of earlyTaps) {
    const idx = Math.round(sec * sr);
    if (idx < len) {
      const sign = rng() > 0.5 ? 1 : -1;
      left[idx] += gl * sign * 0.56;
      right[idx] += gr * (-sign) * 0.56;
    }
  }

  // Velvet-Noise dense diffuse tail (1750-2400 pulses/sec: studio-smooth, zero comb ringing)
  const pulseDensity = isOverhead ? 2350 : isAlley ? 2150 : 1750;
  const gridSize = Math.max(4, Math.round(sr / pulseDensity));
  const preDelaySamples = Math.round((isOverhead ? 0.005 : isAlley ? 0.008 : 0.022) * sr);
  const rawL = new Float32Array(len);
  const rawR = new Float32Array(len);

  for (let base = preDelaySamples; base < len; base += gridSize) {
    const pL = base + Math.floor(rng() * gridSize);
    const pR = base + Math.floor(rng() * gridSize);
    if (pL < len) rawL[pL] += rng() > 0.5 ? 1 : -1;
    if (pR < len) rawR[pR] += rng() > 0.5 ? 1 : -1;
  }

  const lpAlpha = clamp(1 - Math.exp(-TAU * (isOverhead ? 920 : isAlley ? 1580 : 1180) / sr), 0.01, 0.9);
  const dampAlpha = clamp(1 - Math.exp(-TAU * (isOverhead ? 3400 : isAlley ? 5400 : 3900) / sr), 0.02, 0.95);
  let lowL = 0, lowR = 0, hiL = 0, hiR = 0;

  // Eigenmodes: overhead emphasizes <300Hz structural boom (118Hz, 236Hz); alley emphasizes steel wall modes (300Hz, 420Hz, 895Hz)
  const w0 = TAU * (isOverhead ? 118 : 298) / sr;
  const w1 = TAU * (isOverhead ? 236 : 420) / sr;
  const w2 = TAU * 895 / sr;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const envLow = Math.exp(-decayLow * t);
    const envHigh = Math.exp(-decayHigh * t);
    const onset = i < preDelaySamples ? 0 : Math.min(1, (i - preDelaySamples) / (sr * 0.016));

    lowL += (rawL[i] - lowL) * lpAlpha;
    lowR += (rawR[i] - lowR) * lpAlpha;
    hiL += ((rawL[i] - lowL) - hiL) * dampAlpha;
    hiR += ((rawR[i] - lowR) - hiR) * dampAlpha;

    let sL = left[i] + onset * (lowL * envLow * (isOverhead ? 1.55 : 1.38) + hiL * envHigh * 0.82);
    let sR = right[i] + onset * (lowR * envLow * (isOverhead ? 1.55 : 1.38) + hiR * envHigh * 0.82);

    if ((isAlley || isOverhead) && t > 0.008 && t < 0.52) {
      const mEnv = Math.exp(-t * (isOverhead ? 8.5 : 11.2)) * (isOverhead ? 0.036 : 0.026);
      const modal = Math.sin(w0 * i) * 0.52 + Math.sin(w1 * i + 0.4) * 0.34 + Math.sin(w2 * i + 0.9) * 0.14;
      sL += modal * mEnv;
      sR -= modal * mEnv * 0.82;
    }

    const fadeOut = i > len - 128 ? (len - i) / 128 : 1;
    left[i] = sL * fadeOut;
    right[i] = sR * fadeOut;
  }

  let energy = 0;
  for (let i = 0; i < len; i++) energy += left[i] * left[i] + right[i] * right[i];
  const rms = Math.sqrt(energy / (len * 2)) || 1;
  const targetRms = isOverhead ? 0.098 : isAlley ? 0.092 : 0.078;
  const scale = Math.min(6.0, targetRms / rms);
  for (let i = 0; i < len; i++) {
    left[i] = clamp(left[i] * scale, -0.95, 0.95);
    right[i] = clamp(right[i] * scale, -0.95, 0.95);
  }
  return {left, right, sampleRate: sr, duration, style, rt60Low, rt60High};
}

export function generateHarborIR(sampleRate = 48000, duration = 2.0, style = 'open') {
  return generateHarborIR2(sampleRate, duration, style);
}

// ============================================================================
// Sound Engin 2.0 — 300Hz-Class Real-Time 3D Physical-Modeling Audio Engine
// ============================================================================

export class SoundEngin2 {
  constructor() {
    this.version = SOUND_ENGIN_VERSION;
    this.controlRateHz = SOUND_CONTROL_HZ;
    this.subCrossoverHz = SUB_CROSSOVER_HZ;
    this.volume = 0.55;
    this.on = false;
    this.mode = AUDIO_MODES.ultra300;
    this.ctx = null;

    // Live 3D listener pose & velocity (for 300Hz continuous acoustic updates)
    this.listenerPos = [0, 1.65, 78];
    this.listenerPrevPos = [0, 1.65, 78];
    this.listenerVel = [0, 0, 0];
    this.listenerFwd = [0, 0, -1];
    this.listenerRight = [1, 0, 0];
    this.listenerUp = [0, 1, 0];

    // Live 3-zone acoustic environment & physiological ear state
    this.enclosure = 0.25;
    this.overheadRatio = 0.0;
    this.steelRatio = 0.5;
    this.duckLevel = 1.0;
    this.stapediusDip = 0.0;  // 0..1 ear-drum acoustic reflex compression
    this.barrelHeat = 0.0;    // 0..1 player weapon barrel heat harmonic tracker
    this.exertion = 0.0;      // 0..1 sprint exertion tactical breath tracker
    this.breathTimer = 0.9;
    this.envProbeTimer = 0;
    this.ambientEventTimer = 3.2;
    this.heartbeatTimer = 0;
    this.controlAccum = 0;
    this.controlTicks = 0;

    // Priority voice governor & rate limiters
    this.activeVoices = 0;
    this.voices = new Set();
    this.enableGeneration = 0;
    this.lastWhizAt = -Infinity;
    this.lastImpactAt = -Infinity;
    this.lastCasingAt = -Infinity;
    this.lastRdLockAt = -Infinity;
    this.lastD01At = -Infinity;
    this.lastFermatLockAt = -Infinity;
    this.lastResonateAt = -Infinity;
    this.lastWaterAt = -Infinity;
    this.lastNpcRadioAt = -Infinity;
    this.lastNpcSpatialVoiceAt = -Infinity;
    this.lastFootstepAt = new Map();
    this.actorState = new Map();
    this._lastFermatLocked = false;

    this.stats = {
      shots: 0,
      whizzes: 0,
      impacts: 0,
      footsteps: 0,
      casings: 0,
      reflections: 0,
      analyticalReflections: 0,
      occludedEvents: 0,
      waterSplashes: 0,
      systemCues: 0,
      foleyCues: 0,
      vocalCues: 0,
      dopplerCurves300Hz: 0,
      controlTicks300Hz: 0
    };
  }

  get maxVoices() {
    return this.mode === AUDIO_MODES.ultra300 ? 56 : this.mode === AUDIO_MODES.hrtf ? 40 : 24;
  }

  get isSpatial3D() {
    return this.mode === AUDIO_MODES.ultra300 || this.mode === AUDIO_MODES.hrtf;
  }

  setMode(mode) {
    const next = Object.hasOwn(AUDIO_MODES, mode) ? mode : AUDIO_MODES.ultra300;
    if (this.mode === next) return;
    const was3D = this.isSpatial3D;
    this.mode = next;
    if (this.tankerPanner && this.ctx?.createPanner && was3D !== this.isSpatial3D) {
      const previous = this.tankerPanner;
      this.tankerGain.disconnect(previous.input);
      previous.output.disconnect();
      this.tankerPanner = this._createSpatialNode(this.tankerPos || this.listenerPos, 0, true);
      this.tankerGain.connect(this.tankerPanner.input);
      this.tankerPanner.output.connect(this.ambienceBus);
    }
    if (this.ctx && this.openRevReturn && this.alleyRevReturn) {
      this._applyEnclosureMix(this.ctx.currentTime);
    }
  }

  stopMatchSounds() {
    for (const voice of this.voices) {
      try { voice.stop(); } catch {}
      voice.onended?.();
    }
    if (this.tankerGain && this.ctx) this.tankerGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  resetMatch() {
    this.stopMatchSounds();
    this.actorState.clear();
    this.lastFootstepAt.clear();
    this.lastNpcRadioAt = -Infinity;
    this.lastNpcSpatialVoiceAt = -Infinity;
    this.heartbeatTimer = 0;
    this.stapediusDip = 0;
    this.barrelHeat = 0;
    this.exertion = 0;
    this._lastFermatLocked = false;
    this.listenerVel = [0, 0, 0];
    this.listenerPrevPos = null;
    this.breathTimer = 0.9;
    this.controlAccum = 0;
    this.envProbeTimer = 0;
  }

  async enable(on) {
    const generation = ++this.enableGeneration;
    this.on = !!on;
    if (!this.on) {
      this.stopMatchSounds();
      this.set(this.volume);
      return;
    }
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        const AudioCtx = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
        if (!AudioCtx) {
          this.on = false;
          return;
        }
        const ctx = new AudioCtx({latencyHint: 'interactive'});
        this.ctx = ctx;
        this.lastWhizAt = -Infinity;
        this.lastImpactAt = -Infinity;
        this.lastCasingAt = -Infinity;
        this.lastRdLockAt = -Infinity;
        this.lastD01At = -Infinity;
        this.lastFermatLockAt = -Infinity;
        this.lastResonateAt = -Infinity;
        this.lastWaterAt = -Infinity;
        this.lastNpcRadioAt = -Infinity;
        this.lastNpcSpatialVoiceAt = -Infinity;
        this.lastFootstepAt.clear();
        try {
          this._buildGraph();
          this._buildProceduralBuffers();
          this._startAmbience();
        } catch (error) {
          this.ctx = null;
          this.master = this.tankerGain = null;
          try { await ctx.close(); } catch {}
          throw error;
        }
      }
      if (this.ctx.state !== 'running') await this.ctx.resume();
      if (this.enableGeneration === generation) this.set(this.volume);
    } catch {
      if (this.enableGeneration === generation) {
        this.on = false;
        this.set(this.volume);
      }
    }
  }

  set(v) {
    this.volume = clamp(finite(v, 0.55), 0, 1);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.on ? this.volume : 0, this.ctx.currentTime, 0.03);
    }
  }

  // --------------------------------------------------------------------------
  // 300Hz Multiband Mastering Bus, 3-Zone Convolution Reverb & Stapedius Filter
  // --------------------------------------------------------------------------
  _buildGraph() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;

    this.master = ctx.createGain();
    this.master.gain.value = 0;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.45;
    this._analyserBuf = new Float32Array(this.analyser.fftSize);

    // Dynamic Stapedius Acoustic Reflex Lowpass (subtle transient ear protection!)
    this.reflexFilter = ctx.createBiquadFilter();
    this.reflexFilter.type = 'lowpass';
    this.reflexFilter.frequency.value = safeFreq(sr, 19600);
    this.reflexFilter.Q.value = 0.65;

    // 300Hz Multiband Mastering Crossover:
    //   SUB Band (< 300Hz): tight mono-safe chest punch + subtle harmonic warmth
    //   MID/AIR Band (> 300Hz): crystal spatial clarity + presence + air sheen
    this.mixBus = ctx.createGain();
    this.mixBus.gain.value = 1.0;

    this.subLPF = ctx.createBiquadFilter();
    this.subLPF.type = 'lowpass';
    this.subLPF.frequency.value = safeFreq(sr, SUB_CROSSOVER_HZ);
    this.subLPF.Q.value = 0.707;

    this.subComp = ctx.createDynamicsCompressor();
    this.subComp.threshold.value = -13.0;
    this.subComp.knee.value = 8;
    this.subComp.ratio.value = 5.0;
    this.subComp.attack.value = 0.004;
    this.subComp.release.value = 0.11;

    this.subExciter = ctx.createWaveShaper();
    this.subExciter.curve = synthesizeWaveShaperCurve(1.45, 2048);
    this.subExciter.oversample = '4x';

    this.subOut = ctx.createGain();
    this.subOut.gain.value = 1.08;

    this.hiHPF = ctx.createBiquadFilter();
    this.hiHPF.type = 'highpass';
    this.hiHPF.frequency.value = safeFreq(sr, SUB_CROSSOVER_HZ);
    this.hiHPF.Q.value = 0.707;

    this.masterPresence = ctx.createBiquadFilter();
    this.masterPresence.type = 'peaking';
    this.masterPresence.frequency.value = safeFreq(sr, 3250);
    this.masterPresence.Q.value = 0.85;
    this.masterPresence.gain.value = 1.3;

    this.masterAir = ctx.createBiquadFilter();
    this.masterAir.type = 'highshelf';
    this.masterAir.frequency.value = safeFreq(sr, 10800);
    this.masterAir.gain.value = 1.6;

    this.hiOut = ctx.createGain();
    this.hiOut.gain.value = 1.0;

    // Master Glue Compressor + 4x Oversampled True-Peak Safety Clipper
    this.masterComp = ctx.createDynamicsCompressor();
    this.masterComp.threshold.value = -9.5;
    this.masterComp.knee.value = 10;
    this.masterComp.ratio.value = 4.6;
    this.masterComp.attack.value = 0.002;
    this.masterComp.release.value = 0.12;

    this.safetyClipper = ctx.createWaveShaper();
    this.safetyClipper.curve = synthesizeWaveShaperCurve(1.28, 2048);
    this.safetyClipper.oversample = '4x';

    this.mixBus.connect(this.subLPF).connect(this.subComp).connect(this.subExciter).connect(this.subOut).connect(this.reflexFilter);
    this.mixBus.connect(this.hiHPF).connect(this.masterPresence).connect(this.masterAir).connect(this.hiOut).connect(this.reflexFilter);
    this.reflexFilter.connect(this.masterComp).connect(this.safetyClipper).connect(this.master);

    // Surgical UI / Hit-Confirm / Optical Lock bus bypasses weapon saturation
    this.uiBus = ctx.createGain();
    this.uiBus.gain.value = 0.96;
    this.uiBus.connect(this.master);

    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // Dedicated Sub-Buses
    this.weaponsBus = ctx.createGain();
    this.weaponsBus.gain.value = 1.04;
    this.weaponShaper = ctx.createWaveShaper();
    this.weaponShaper.curve = synthesizeWaveShaperCurve(2.35, 2048);
    this.weaponShaper.oversample = '4x';
    this.weaponTrim = ctx.createGain();
    this.weaponTrim.gain.value = 0.92;
    this.weaponsBus.connect(this.weaponShaper).connect(this.weaponTrim).connect(this.mixBus);

    this.impactsBus = ctx.createGain();
    this.impactsBus.gain.value = 0.98;
    this.impactsBus.connect(this.mixBus);

    this.foleyBus = ctx.createGain();
    this.foleyBus.gain.value = 0.96;
    this.foleyBus.connect(this.mixBus);

    this.earlyReflBus = ctx.createGain();
    this.earlyReflBus.gain.value = 0.90;
    this.earlyReflBus.connect(this.mixBus);

    this.ambienceBus = ctx.createGain();
    this.ambienceBus.gain.value = 0.86;
    this.ambienceDuck = ctx.createGain();
    this.ambienceDuck.gain.value = 1.0;
    this.ambienceBus.connect(this.ambienceDuck).connect(this.mixBus);

    // 3-Zone Velvet-Noise + Eigenmode Convolution Reverb (Open / Alley / Overhead Canopy)
    this.openRevSend = ctx.createGain();
    this.openRevSend.gain.value = 0.50;
    this.openConvolver = ctx.createConvolver();
    this.openRevReturn = ctx.createGain();
    this.openRevReturn.gain.value = 0.34;
    this.openRevSend.connect(this.openConvolver).connect(this.openRevReturn).connect(this.mixBus);

    this.alleyRevSend = ctx.createGain();
    this.alleyRevSend.gain.value = 0.46;
    this.alleyConvolver = ctx.createConvolver();
    this.alleyRevReturn = ctx.createGain();
    this.alleyRevReturn.gain.value = 0.24;
    this.alleyRevSend.connect(this.alleyConvolver).connect(this.alleyRevReturn).connect(this.mixBus);

    this.overRevSend = ctx.createGain();
    this.overRevSend.gain.value = 0.42;
    this.overConvolver = ctx.createConvolver();
    this.overRevReturn = ctx.createGain();
    this.overRevReturn.gain.value = 0.08;
    this.overRevSend.connect(this.overConvolver).connect(this.overRevReturn).connect(this.mixBus);
  }

  _buildProceduralBuffers() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const rng = makePrng(20262);

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

    // 3. All 14 Physical Modal & Waveguide Impulse Buffers
    const mkMono = kind => {
      const data = synthesizeModalSamples(sr, kind);
      const buf = ctx.createBuffer(1, data.length, sr);
      buf.copyToChannel(data, 0);
      return buf;
    };
    this.blastBuf = mkMono('blast');
    this.sub300Buf = mkMono('sub300');
    this.crackBuf = mkMono('crack');
    this.railBuf = mkMono('rail');
    this.boltBuf = mkMono('bolt');
    this.steelBuf = mkMono('steel');
    this.woodBuf = mkMono('wood');
    this.gritBuf = mkMono('concrete');
    this.brassBuf = mkMono('brass');
    this.waterBuf = mkMono('water');
    this.glassBuf = mkMono('glass');
    this.clothBuf = mkMono('cloth');
    this.breathBuf = mkMono('breath');
    this.foghornBuf = mkMono('foghorn');

    // 4. 3-Zone Velvet-Noise + Eigenmode Harbor Convolution IRs
    const loadIR = (conv, dur, style) => {
      const ir = generateHarborIR2(sr, dur, style);
      const b = ctx.createBuffer(2, ir.left.length, sr);
      b.copyToChannel(ir.left, 0);
      b.copyToChannel(ir.right, 1);
      conv.buffer = b;
    };
    loadIR(this.openConvolver, 2.2, 'open');
    loadIR(this.alleyConvolver, 1.2, 'alley');
    loadIR(this.overConvolver, 1.45, 'overhead');
  }

  // --------------------------------------------------------------------------
  // Living 3D Maritime Harbor Soundscape (6 Dynamic Ambient Layers)
  // --------------------------------------------------------------------------
  _startAmbience() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;

    // 1. Directional ocean surf + foam crest spray along west quay (x < -25)
    const seaSrc = ctx.createBufferSource();
    seaSrc.buffer = this.pinkNoiseBuf;
    seaSrc.loop = true;

    this.seaFilter = ctx.createBiquadFilter();
    this.seaFilter.type = 'lowpass';
    this.seaFilter.frequency.value = safeFreq(sr, 380);
    this.seaFilter.Q.value = 0.72;

    this.seaGain = ctx.createGain();
    this.seaGain.gain.value = 0.135;

    const swellLfo = ctx.createOscillator();
    swellLfo.type = 'sine';
    swellLfo.frequency.value = 0.145;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.044;
    swellLfo.connect(swellDepth).connect(this.seaGain.gain);
    const swellFreqDepth = ctx.createGain();
    swellFreqDepth.gain.value = 128;
    swellLfo.connect(swellFreqDepth).connect(this.seaFilter.frequency);

    this.seaPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (this.seaPan) {
      seaSrc.connect(this.seaFilter).connect(this.seaGain).connect(this.seaPan).connect(this.ambienceBus);
    } else {
      seaSrc.connect(this.seaFilter).connect(this.seaGain).connect(this.ambienceBus);
    }
    seaSrc.start();
    swellLfo.start();

    // 2. AeroVortex Venturi Harbor Wind (dynamically modulated by live Navier-Stokes CFD speed)
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.pinkNoiseBuf;
    windSrc.loop = true;
    windSrc.playbackRate.value = 1.14;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = safeFreq(sr, 520);
    this.windFilter.Q.value = 1.45;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.052;

    const gustLfo = ctx.createOscillator();
    gustLfo.type = 'sine';
    gustLfo.frequency.value = 0.11;
    const gustFreq = ctx.createGain();
    gustFreq.gain.value = 180;
    gustLfo.connect(gustFreq).connect(this.windFilter.frequency);
    const gustAmp = ctx.createGain();
    gustAmp.gain.value = 0.018;
    gustLfo.connect(gustAmp).connect(this.windGain.gain);

    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.ambienceBus);
    windSrc.start(0, 1.3);
    gustLfo.start();

    // 3. Supply Tanker 3D Pressurized Turbine Hum (<300Hz fundamental + overtone)
    this.tankerOsc1 = ctx.createOscillator();
    this.tankerOsc1.type = 'triangle';
    this.tankerOsc1.frequency.value = 88;
    this.tankerOsc2 = ctx.createOscillator();
    this.tankerOsc2.type = 'sine';
    this.tankerOsc2.frequency.value = 176.6;
    this.tankerFilter = ctx.createBiquadFilter();
    this.tankerFilter.type = 'lowpass';
    this.tankerFilter.frequency.value = safeFreq(sr, 330);
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
    if (this.mode === AUDIO_MODES.stereo) {
      // Lightweight stereo mode: zero heavy convolution return CPU waste!
      this.openRevReturn.gain.setTargetAtTime(0.06, now, 0.14);
      this.alleyRevReturn.gain.setTargetAtTime(0.05, now, 0.14);
      this.overRevReturn?.gain.setTargetAtTime(0.02, now, 0.14);
      return;
    }
    const ultra = this.mode === AUDIO_MODES.ultra300 ? 1.08 : 0.94;
    const enc = this.enclosure;
    const ov = this.overheadRatio;
    const openLvl = 0.36 * ultra * (1.06 - enc * 0.44 - ov * 0.22);
    const alleyLvl = 0.44 * ultra * (0.24 + enc * 0.86) * (0.72 + this.steelRatio * 0.44);
    const overLvl = 0.40 * ultra * (0.05 + ov * 0.92);
    this.openRevReturn.gain.setTargetAtTime(Math.max(0.04, openLvl), now, 0.12);
    this.alleyRevReturn.gain.setTargetAtTime(Math.max(0.04, alleyLvl), now, 0.12);
    this.overRevReturn?.gain.setTargetAtTime(Math.max(0.01, overLvl), now, 0.12);
  }

  _duckAmbience(energy, at) {
    if (!this.ambienceDuck || !this.ctx) return;
    const dip = clamp(1 - energy * 0.62, 0.30, 1);
    const t = Math.max(this.ctx.currentTime, at);
    this.duckLevel = dip;
    try {
      this.ambienceDuck.gain.cancelScheduledValues(t);
      this.ambienceDuck.gain.setTargetAtTime(dip, t, 0.010);
      this.ambienceDuck.gain.setTargetAtTime(1.0, t + 0.085, 0.22);
    } catch {}
  }

  _triggerStapediusReflex(intensity) {
    if (this.mode === AUDIO_MODES.stereo) return;
    this.stapediusDip = clamp(Math.max(this.stapediusDip, intensity), 0, 0.85);
  }

  // --------------------------------------------------------------------------
  // 3D HRTF / Binaural Spatializer & Priority Voice Management
  // --------------------------------------------------------------------------
  _computeStereoPan(worldPos) {
    const dx = worldPos[0] - this.listenerPos[0];
    const dz = worldPos[2] - this.listenerPos[2];
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const rx = this.listenerRight[0], rz = this.listenerRight[2];
    return clamp((dx * rx + dz * rz) / (d + 0.42), -1, 1);
  }

  _canSpawnVoice(priority = 2) {
    const cap = this.maxVoices;
    if (priority >= 4) return this.activeVoices < cap + 6; // Never drop player critical hits/shots
    if (priority >= 3) return this.activeVoices < cap;
    if (priority >= 2) return this.activeVoices < cap - 5;
    return this.activeVoices < cap - 10;
  }

  _createSpatialNode(worldPos = null, stereoPan = 0, persistent = false) {
    const ctx = this.ctx;
    if (worldPos && this.isSpatial3D && ctx.createPanner) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1;
      p.maxDistance = 10000;
      p.rolloffFactor = 0; // Sound Engin 2.0 computes exact 3-band UTD attenuation directly
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
        sp.node.positionX.setTargetAtTime(x, at, 0.032);
        sp.node.positionY.setTargetAtTime(y, at, 0.032);
        sp.node.positionZ.setTargetAtTime(z, at, 0.032);
      } else if (sp.node.setPosition) {
        sp.node.setPosition(x, y, z);
      }
    } else if (sp.node.pan) {
      sp.node.pan.setTargetAtTime(this._computeStereoPan(pos), at, 0.032);
    }
  }

  _trackVoice(sourceNode, cleanupNodes = []) {
    this.voices.add(sourceNode);
    this.activeVoices = this.voices.size;
    sourceNode.onended = () => {
      if (!this.voices.delete(sourceNode)) return;
      this.activeVoices = this.voices.size;
      sourceNode.onended = null;
      try { sourceNode.disconnect(); } catch {}
      for (const node of cleanupNodes) {
        try { node?.disconnect?.(); } catch {}
      }
    };
  }

  _connectReverb(node, amount, nodes) {
    if (!amount || amount <= 0.01 || this.mode === AUDIO_MODES.stereo) return;
    const rs = this.ctx.createGain();
    rs.gain.value = clamp(amount, 0, 1);
    node.connect(rs);
    rs.connect(this.openRevSend);
    rs.connect(this.alleyRevSend);
    if (this.mode === AUDIO_MODES.ultra300 && this.overRevSend) {
      rs.connect(this.overRevSend);
    }
    nodes.push(rs);
  }

  _playTone(opts) {
    if (!this.ctx || !this.on || !this.volume || !this._canSpawnVoice(opts.priority ?? 2)) return;
    const ctx = this.ctx, sr = ctx.sampleRate;
    const start = Math.max(ctx.currentTime, opts.start ?? ctx.currentTime);
    const dur = Math.max(0.008, opts.dur || 0.08);
    const osc = ctx.createOscillator();
    osc.type = opts.type || 'sine';

    if (opts.freqCurve && opts.freqCurve.length >= 2) {
      const safeCurve = new Float32Array(opts.freqCurve.length);
      for (let i = 0; i < safeCurve.length; i++) safeCurve[i] = safeFreq(sr, opts.freqCurve[i]);
      try {
        osc.frequency.setValueCurveAtTime(safeCurve, start, dur);
      } catch {
        osc.frequency.setValueAtTime(safeCurve[0], start);
      }
    } else {
      const f0 = safeFreq(sr, opts.f0 || 440);
      const f1 = safeFreq(sr, opts.f1 ?? f0);
      osc.frequency.setValueAtTime(f0, start);
      if (Math.abs(f1 - f0) > 0.5) {
        osc.frequency.exponentialRampToValueAtTime(f1, start + dur);
      }
    }

    const g = ctx.createGain();
    const atk = Math.min(opts.attack ?? 0.003, dur * 0.35);
    const vol = safeGain(opts.gain ?? 0.1);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + Math.max(0.001, atk));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    const nodes = [osc, g];
    let tail = g;
    if (opts.lpf && opts.lpf < 18800) {
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
    this._connectReverb(tail, opts.reverbSend, nodes);

    this._trackVoice(osc, nodes);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  _playBuffer(opts) {
    if (!this.ctx || !this.on || !this.volume || !opts.buffer || !this._canSpawnVoice(opts.priority ?? 2)) return;
    const ctx = this.ctx, sr = ctx.sampleRate;
    const start = Math.max(ctx.currentTime, opts.start ?? ctx.currentTime);
    const dur = Math.max(0.008, opts.dur || opts.buffer.duration);
    const src = ctx.createBufferSource();
    src.buffer = opts.buffer;
    src.loop = !!opts.loop;

    if (opts.rateCurve && opts.rateCurve.length >= 2) {
      const rc = new Float32Array(opts.rateCurve.length);
      for (let i = 0; i < rc.length; i++) rc[i] = clamp(opts.rateCurve[i], 0.25, 4.0);
      try {
        src.playbackRate.setValueCurveAtTime(rc, start, dur);
      } catch {
        src.playbackRate.setValueAtTime(rc[0], start);
      }
    } else {
      if (opts.rate) src.playbackRate.setValueAtTime(clamp(opts.rate, 0.25, 4.0), start);
      if (opts.rateEnd) src.playbackRate.exponentialRampToValueAtTime(clamp(opts.rateEnd, 0.25, 4.0), start + dur);
    }

    const nodes = [src];
    let chain = src;

    if (opts.filterType) {
      const flt = ctx.createBiquadFilter();
      flt.type = opts.filterType;
      flt.Q.setValueAtTime(clamp(opts.q ?? 1.2, 0.2, 18), start);
      if (opts.filterCurve && opts.filterCurve.length >= 2) {
        const fc = new Float32Array(opts.filterCurve.length);
        for (let i = 0; i < fc.length; i++) fc[i] = safeFreq(sr, opts.filterCurve[i]);
        try {
          flt.frequency.setValueCurveAtTime(fc, start, dur);
        } catch {
          flt.frequency.setValueAtTime(fc[0], start);
        }
      } else {
        const f0 = safeFreq(sr, opts.f0 ?? 1800);
        const f1 = safeFreq(sr, opts.f1 ?? f0);
        flt.frequency.setValueAtTime(f0, start);
        if (Math.abs(f1 - f0) > 1) flt.frequency.exponentialRampToValueAtTime(f1, start + dur);
      }
      chain.connect(flt);
      chain = flt;
      nodes.push(flt);
    }

    // 3-Band UTD Occlusion / Air-Absorption + Near-Field Binaural Head-Shadow Filter
    if (opts.lpf && opts.lpf < 18800) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(safeFreq(sr, opts.lpf), start);
      chain.connect(lp);
      chain = lp;
      nodes.push(lp);
    }

    // Pinna elevation notch for overhead sources (container-roof footsteps/shots in ultra300 mode!)
    if (this.mode === AUDIO_MODES.ultra300 && opts.elevDeg && Math.abs(opts.elevDeg) > 14 && opts.pinnaNotchHz) {
      const pinna = ctx.createBiquadFilter();
      pinna.type = 'peaking';
      pinna.frequency.setValueAtTime(safeFreq(sr, opts.pinnaNotchHz), start);
      pinna.Q.value = 2.6;
      pinna.gain.value = opts.elevDeg > 0 ? -4.2 : 2.2;
      chain.connect(pinna);
      chain = pinna;
      nodes.push(pinna);
    }

    const g = ctx.createGain();
    const vol = safeGain(opts.gain ?? 0.14);
    const atk = Math.min(opts.attack ?? 0.003, dur * 0.35);
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
    this._connectReverb(g, opts.reverbSend, nodes);

    this._trackVoice(src, nodes);
    const offset = opts.loop ? Math.random() * Math.max(0.1, opts.buffer.duration - 0.35) : 0;
    src.start(start, offset);
    src.stop(start + dur + .025);
  }

  // --------------------------------------------------------------------------
  // ClosedForm-300Hz: Exact O(1) Analytical Integrator (0 inner-loop iterations!)
  // --------------------------------------------------------------------------
  step300Hz(dt, match) {
    const step = 1 / SOUND_CONTROL_HZ;
    this.controlAccum = Math.min(this.controlAccum + Math.max(0, dt), 0.05);
    const nSteps = Math.floor((this.controlAccum + 1e-9) * SOUND_CONTROL_HZ);
    if (nSteps <= 0) return;
    const totalDt = nSteps * step;
    this.controlAccum = Math.max(0, this.controlAccum - totalDt);
    this.controlTicks += nSteps;
    this.stats.controlTicks300Hz += nSteps;

    // Exact closed-form stapedius ear-reflex recovery: exp(-5.4 * step)^n == exp(-5.4 * n * step)
    if (this.stapediusDip > 0.001) {
      this.stapediusDip *= Math.exp(-5.4 * totalDt);
      if (this.stapediusDip <= 0.001) this.stapediusDip = 0;
    } else {
      this.stapediusDip = 0;
    }

    // Exact closed-form barrel heat cooling
    if (this.barrelHeat > 0) this.barrelHeat = Math.max(0, this.barrelHeat - totalDt * 0.24);

    // Exact closed-form sprint exertion accumulation & recovery
    const pl = match?.player;
    if (pl?.alive) {
      const sprinting = (pl.sprintAmt || 0) > 0.45 && ((pl.vx || 0) * (pl.vx || 0) + (pl.vz || 0) * (pl.vz || 0)) > 17.64;
      this.exertion = clamp(this.exertion + (sprinting ? 0.22 : -0.18) * totalDt, 0, 1);
    } else if (this.exertion > 1e-4) {
      this.exertion *= Math.exp(-2.0 * totalDt);
    }
  }

  update(dt, match, cam) {
    if (!this.ctx || !this.on || !this.volume || (this.ctx.state && this.ctx.state !== 'running')) {
      this.listenerPrevPos = null;
      this.listenerVel = [0, 0, 0];
      return;
    }
    this.step300Hz(dt, match);
    const now = this.ctx.currentTime;
    const sr = this.ctx.sampleRate;

    // Apply live Stapedius Acoustic Reflex ear protection curve (skip redundant AudioParam writes!)
    if (this.reflexFilter) {
      const targetReflexHz = this.stapediusDip > 0.02
        ? clamp(19600 - this.stapediusDip * 14200, 4200, 19600)
        : 19600;
      if (Math.abs(targetReflexHz - (this._lastReflexHz || 0)) > 12) {
        this._lastReflexHz = targetReflexHz;
        this.reflexFilter.frequency.setTargetAtTime(safeFreq(sr, targetReflexHz), now, 0.025);
      }
    }

    // 1. Sync 3D AudioListener pose & velocity (dirty-gated AudioParam scheduling!)
    if (cam?.pos && cam?.target) {
      const px = finite(cam.pos[0], 0), py = finite(cam.pos[1], 1.65), pz = finite(cam.pos[2], 78);
      const prev = this.listenerPrevPos;
      if (dt > 0.001 && prev) {
        const inv = 1 / dt;
        this.listenerVel[0] = clamp((px - prev[0]) * inv, -18, 18);
        this.listenerVel[1] = clamp((py - prev[1]) * inv, -18, 18);
        this.listenerVel[2] = clamp((pz - prev[2]) * inv, -18, 18);
      } else {
        this.listenerVel[0] = 0; this.listenerVel[1] = 0; this.listenerVel[2] = 0;
      }
      if (!prev) this.listenerPrevPos = [px, py, pz];
      else { prev[0] = px; prev[1] = py; prev[2] = pz; }

      let fx = finite(cam.target[0], px) - px;
      let fy = finite(cam.target[1], py) - py;
      let fz = finite(cam.target[2], pz - 1) - pz;
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      let rx = -fz, rz = fx;
      const rl = Math.sqrt(rx * rx + rz * rz) || 1;
      rx /= rl; rz /= rl;

      const lPos = this.listenerPos || (this.listenerPos = [0, 0, 0]);
      const lFwd = this.listenerFwd || (this.listenerFwd = [0, 0, -1]);
      const lRgt = this.listenerRight || (this.listenerRight = [1, 0, 0]);
      const poseMoved = !this._listenerInit
        || Math.abs(px - lPos[0]) + Math.abs(py - lPos[1]) + Math.abs(pz - lPos[2]) > 2e-4
        || Math.abs(fx - lFwd[0]) + Math.abs(fy - lFwd[1]) + Math.abs(fz - lFwd[2]) > 2e-4;
      lPos[0] = px; lPos[1] = py; lPos[2] = pz;
      lFwd[0] = fx; lFwd[1] = fy; lFwd[2] = fz;
      lRgt[0] = rx; lRgt[1] = 0; lRgt[2] = rz;
      if (!this.listenerUp) this.listenerUp = [0, 1, 0];

      const L = this.ctx.listener;
      if (L && poseMoved) {
        this._listenerInit = true;
        const tc = this.mode === AUDIO_MODES.ultra300 ? 0.008 : 0.015;
        if (L.positionX) {
          L.positionX.setTargetAtTime(px, now, tc);
          L.positionY.setTargetAtTime(py, now, tc);
          L.positionZ.setTargetAtTime(pz, now, tc);
          L.forwardX.setTargetAtTime(fx, now, tc);
          L.forwardY.setTargetAtTime(fy, now, tc);
          L.forwardZ.setTargetAtTime(fz, now, tc);
          L.upX.setTargetAtTime(0, now, tc);
          L.upY.setTargetAtTime(1, now, tc);
          L.upZ.setTargetAtTime(0, now, tc);
        } else if (L.setPosition && L.setOrientation) {
          L.setPosition(px, py, pz);
          L.setOrientation(fx, fy, fz, 0, 1, 0);
        }
      }

      if (this.seaPan) {
        const seaPanVal = this._computeStereoPan([-45, 0, pz]);
        const shoreProx = clamp(1.18 - (px + 25) / 68, 0.52, 1.25);
        this.seaPan.pan.setTargetAtTime(clamp(seaPanVal * 0.74, -0.84, 0.84), now, 0.10);
        this.seaGain?.gain.setTargetAtTime(0.125 * shoreProx, now, 0.16);
      }
    }

    // 2. Sample 3-Zone Harbor Enclosure (~7 Hz)
    this.envProbeTimer -= dt;
    if (this.envProbeTimer <= 0) {
      this.envProbeTimer = 0.14;
      const env = estimateEnclosure(this.listenerPos);
      this.enclosure += (env.enclosure - this.enclosure) * 0.45;
      this.overheadRatio += (env.overheadRatio - this.overheadRatio) * 0.45;
      this.steelRatio += (env.steelRatio - this.steelRatio) * 0.45;
      this._applyEnclosureMix(now);
    }

    // 3. Rich Maritime Harbor Ambient Events (crane groan, foghorn, gulls, buoy bell)
    this.ambientEventTimer -= dt;
    if (this.ambientEventTimer <= 0 && this._canSpawnVoice(0)) {
      this.ambientEventTimer = 5.5 + Math.random() * 6.5;
      this._playHarborDetail(now);
    }

    if (!match) {
      this.tankerGain?.gain.setTargetAtTime(0, now, 0.15);
      return;
    }

    // 3b. AeroVortex 1.0 Live Navier-Stokes Wind-Shear Acoustics
    if (match.aeroVortex && this.windFilter && this.windGain) {
      const wSample = match.aeroVortex.sample(this.listenerPos[0], this.listenerPos[2]);
      const spd = clamp(wSample.speed || 0, 0, 6.5);
      this.windFilter.frequency.setTargetAtTime(safeFreq(sr, 340 + spd * 195), now, 0.12);
      this.windFilter.Q.setTargetAtTime(1.15 + clamp(spd * 0.34, 0, 2.4), now, 0.12);
      this.windGain.gain.setTargetAtTime(0.028 + spd * 0.017, now, 0.14);
    }

    // 3c. FermatCore 1.0 Optical Lock Acquisition Chime (plays once on sweet-spot alignment!)
    const fBank = match.fermat?.playerBank;
    const isFermatLocked = !!(fBank && fBank.aligned);
    if (isFermatLocked && !this._lastFermatLocked && now - this.lastFermatLockAt > 0.28) {
      this.lastFermatLockAt = now;
      this._playFermatLock(fBank.bounces === 2, now);
    }
    this._lastFermatLocked = isFermatLocked;

    // 4. Supply Tanker 3D Turbine Hum
    if (match.tankers?.length && this.tankerGain) {
      let bestTk = null, bestD = 26;
      for (const tk of match.tankers) {
        const d = Math.hypot(tk.x - this.listenerPos[0], tk.z - this.listenerPos[2]);
        if (d < bestD) { bestD = d; bestTk = tk; }
      }
      if (bestTk && bestTk.cooldown <= 0.1) {
        const dx = this.listenerPos[0] - bestTk.x, dz = this.listenerPos[2] - bestTk.z;
        const face = Math.min(bestTk.w / (2 * Math.abs(dx)), bestTk.d / (2 * Math.abs(dz)));
        const exterior = Math.min(1, face + .12 / Math.max(.12, bestD));
        const pos = [bestTk.x + dx * exterior, 1.5, bestTk.z + dz * exterior];
        this.tankerPos = pos;
        const prox = Math.pow(clamp(1 - bestD / 26, 0, 1), 1.65);
        const occ = obstruction(pos, this.listenerPos) <= 1 ? 0.45 : 1.0;
        this._setPannerPos(this.tankerPanner, pos, now);
        this.tankerGain.gain.setTargetAtTime(0.062 * prox * occ, now, 0.10);
        this.tankerFilter?.frequency.setTargetAtTime(safeFreq(sr, 250 + prox * 380 * occ), now, 0.10);
      } else {
        this.tankerGain.gain.setTargetAtTime(0, now, 0.18);
      }
    }

    // 5. Actor Foley Tracker: Footsteps, Jumps, Landings, Crouch/Lean/ADS, 5-Stage Reloads
    const pl = match.player;
    for (const a of match.actors || []) {
      let st = this.actorState.get(a.id);
      if (!st) {
        st = {
          strideMark: a.stride || 0,
          stepParity: 0,
          wasOnGround: !!a.onGround,
          prevVy: a.vy || 0,
          prevCrouch: (a.crouch || 0) > 0.45,
          prevAds: !!(a.df?.ads),
          prevLean: Math.sign(Math.abs(a.lean || 0) > 0.25 ? a.lean : 0),
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
        st.prevCrouch = (a.crouch || 0) > 0.45;
        st.prevAds = !!(a.df?.ads);
        st.prevLean = Math.abs(a.lean || 0) > 0.35 ? Math.sign(a.lean) : 0;
        st.reloadStage = 0;
      }

      const isPlayer = a === pl;
      const dist = isPlayer ? 0 : Math.hypot(a.x - this.listenerPos[0], a.y + 1.2 - this.listenerPos[1], a.z - this.listenerPos[2]);

      // Crouch & Stand tactical Kevlar gear transition foley
      const crouchNow = (a.crouch || 0) > 0.45;
      if (crouchNow !== st.prevCrouch && (isPlayer || dist < 12)) {
        this._playStanceFoley(a, isPlayer, crouchNow ? 'crouch' : 'stand', now);
      }
      st.prevCrouch = crouchNow;
      // ADS / Optic raise mechanical click
      const adsNow = !!(a.df?.ads);
      if (isPlayer && adsNow !== st.prevAds) {
        st.prevAds = adsNow;
        this._playAdsClick(adsNow, a.df?.scope === 'thermal', now);
      }
      // Corner lean sling shift
      const leanSign = Math.abs(a.lean || 0) > 0.35 ? Math.sign(a.lean) : 0;
      if (isPlayer && leanSign !== st.prevLean && leanSign !== 0) {
        this._playStanceFoley(a, true, 'lean', now);
      }
      st.prevLean = leanSign;

      // Jump & Landing
      if (st.wasOnGround && !a.onGround && (a.vy || 0) > 2.4 && dist < 32) {
        this._playJump(a, isPlayer, now);
      } else if (!st.wasOnGround && a.onGround && dist < 36) {
        const force = clamp(Math.max(Math.abs(st.prevVy) / 7.2, a.landCompress || 0.25), 0.2, 1.0);
        this._playLanding(a, isPlayer, force, now);
      }
      st.wasOnGround = !!a.onGround;
      st.prevVy = a.vy || 0;

      // Stride-synced 3-phase footsteps
      if (a.onGround && dist < 38) {
        const speed = Math.hypot(a.vx || 0, a.vz || 0);
        const stepDist = a.sprintAmt > 0.35 ? 1.92 : a.crouch > 0.45 ? 1.15 : 1.52;
        if (speed > 0.45 && (a.stride - st.strideMark) >= stepDist) {
          st.strideMark = a.stride;
          st.stepParity ^= 1;
          this._playFootstep(a, isPlayer, st.stepParity, now);
        } else if (speed < 0.25) {
          st.strideMark = a.stride;
        }
      } else st.strideMark = a.stride;

      // 5-Stage weapon-specific reload choreography
      if (a.reload > 0) {
        const f = a.reloadFrac || 0;
        const stage = f >= 0.74 ? 4 : f >= 0.50 ? 3 : f >= 0.22 ? 2 : f >= 0.05 ? 1 : 0;
        if (stage > st.reloadStage) {
          if (dist < 26) this._playReloadStage(a, isPlayer, stage, now);
          st.reloadStage = stage;
        }
      } else st.reloadStage = 0;
    }

    // 6. Human Sprint Exertion Breath & Critical Low-HP Heartbeat
    if (pl?.alive) {
      if (this.exertion > 0.58) {
        this.breathTimer -= dt;
        if (this.breathTimer <= 0) {
          this.breathTimer = 1.15 - this.exertion * 0.42;
          this._playBuffer({
            buffer: this.breathBuf,
            rate: 0.92 + Math.random() * 0.16,
            dur: 0.30,
            gain: 0.030 * (this.exertion - 0.45),
            bus: this.foleyBus,
            priority: 1,
            start: now
          });
        }
      }
      if (pl.hp <= 30) {
        this.heartbeatTimer -= dt;
        if (this.heartbeatTimer <= 0) {
          const urgency = clamp(1 - pl.hp / 30, 0.2, 1);
          this.heartbeatTimer = 0.76 - urgency * 0.26;
          const amp = 0.062 + urgency * 0.060;
          this._playTone({f0: 68, f1: 40, dur: 0.098, gain: amp, type: 'sine', bus: this.uiBus, priority: 3, start: now});
          this._playTone({f0: 56, f1: 36, dur: 0.115, gain: amp * 0.72, type: 'sine', bus: this.uiBus, priority: 3, start: now + 0.155});
        }
      }
    }
  }

  _playHarborDetail(now) {
    const r = Math.random();
    if (r < 0.34 && craneSites.length) {
      // Distant gantry crane structural steel groan
      const c = craneSites[Math.floor(Math.random() * craneSites.length)];
      const pos = [c.x, 7.8, c.z];
      const d = Math.hypot(pos[0] - this.listenerPos[0], pos[2] - this.listenerPos[2]);
      if (d < 98) {
        const g = 0.025 / (1 + d * 0.042);
        const f = 175 + Math.random() * 88;
        this._playTone({f0: f, f1: f * 0.74, dur: 0.58, gain: g, type: 'sawtooth', pos, lpf: 580, bus: this.ambienceBus, reverbSend: 0.48, priority: 0, start: now});
      }
    } else if (r < 0.54) {
      // Deep <300Hz Distant Cargo Ship Maritime Foghorn across the west bay!
      const pos = [-85, 8, this.listenerPos[2] + (Math.random() - 0.5) * 90];
      this._playBuffer({
        buffer: this.foghornBuf,
        rate: 0.86 + Math.random() * 0.24,
        dur: 1.62,
        attack: 0.08,
        gain: 0.042,
        lpf: 520,
        pos,
        bus: this.ambienceBus,
        reverbSend: 0.62,
        priority: 0,
        start: now
      });
    } else if (r < 0.76) {
      // Spatial maritime sea gull over west harbor water
      const z = this.listenerPos[2] + (Math.random() - 0.5) * 70;
      const pos = [-38 - Math.random() * 18, 12 + Math.random() * 6, z];
      const f = 1480 + Math.random() * 340;
      this._playTone({f0: f * 0.85, f1: f * 1.18, dur: 0.16, gain: 0.011, type: 'sine', pos, lpf: 2600, bus: this.ambienceBus, reverbSend: 0.52, priority: 0, start: now});
      this._playTone({f0: f * 1.16, f1: f * 0.72, dur: 0.24, gain: 0.010, type: 'sine', pos, lpf: 2400, bus: this.ambienceBus, reverbSend: 0.52, priority: 0, start: now + 0.15});
    } else {
      // Distant Harbor Mooring Buoy Bell metallic maritime chime
      const pos = [-52, 1.5, this.listenerPos[2] + (Math.random() - 0.5) * 65];
      this._playTone({f0: 528, f1: 524, dur: 0.85, attack: 0.005, gain: 0.014, type: 'sine', pos, lpf: 1600, bus: this.ambienceBus, reverbSend: 0.65, priority: 0, start: now});
      this._playTone({f0: 1056 * 1.18, f1: 1050 * 1.18, dur: 0.48, attack: 0.004, gain: 0.007, type: 'triangle', pos, lpf: 1600, bus: this.ambienceBus, reverbSend: 0.55, priority: 0, start: now});
    }
  }

  // --------------------------------------------------------------------------
  // 9-Layer 300Hz-Class Physical Weapon Synthesizer (8 Unique Weapon Architectures)
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

    // Anti-clipping & anti-dropout polyphony governor for overlapping rapid gunfire
    if (!this._recentFireTimes) this._recentFireTimes = [];
    if (!this._actorLastFire) this._actorLastFire = new Map();
    const recent = this._recentFireTimes;
    let rw = 0;
    for (let i = 0; i < recent.length; i++) {
      if (now - recent[i] < 0.14) recent[rw++] = recent[i];
    }
    recent.length = rw;
    const actorKey = a?.id ?? -1;
    if (!isPlayer && actorKey >= 0) {
      const prevAt = this._actorLastFire.get(actorKey) ?? -10;
      if (now - prevAt < 0.068) return;
      this._actorLastFire.set(actorKey, now);
    }

    this.stats.shots++;

    // 3-Band UTD Acoustic Path + Binaural Near-Field Elevation/Head-Shadow
    const path = isPlayer
      ? {dist: 0, delay: 0, occluded: false, occlusion: 0, cutoffHz: 19800, directGain: 1, reverbBoost: 0, bandGains: {low: 1, mid: 1, high: 1}}
      : computeMultiBandAcousticPath(srcPos, this.listenerPos);

    if (path.occluded) this.stats.occludedEvents++;
    const d = path.dist;
    if (!isPlayer && d > 185) return;
    // Cull distant/excess NPC shots under extreme overlap so WebAudio voices never saturate or drop out
    if (!isPlayer && ((recent.length >= 9 && (d > 28 || path.occluded)) || recent.length >= 15)) return;
    recent.push(now);
    const polyScale = recent.length > 2 ? 1 / Math.sqrt(1 + (recent.length - 2) * 0.48) : 1.0;

    const binaural = isPlayer ? null : computeBinauralNearField(srcPos, this.listenerPos, this.listenerRight, this.listenerFwd);
    const start = now + path.delay;
    const distNorm = clamp(d / 85, 0, 1);
    const vol = (isPlayer ? 1.0 : clamp(path.directGain * 1.20, 0.04, 0.95)) * polyScale;
    const lpf = binaural ? Math.min(path.cutoffHz, binaural.shadowCutoffHz) : path.cutoffHz;
    const lowBandVol = (isPlayer ? 1.0 : clamp((path.bandGains?.low ?? path.directGain) * 1.25, 0.06, 0.95)) * polyScale;
    const pos = isPlayer ? null : srcPos;
    const muzzlePan = isPlayer ? 0.07 : 0;
    const boltPan = isPlayer ? 0.22 : 0;
    const revSend = clamp(((isPlayer ? 0.34 : 0.26 + distNorm * 0.48) + path.reverbBoost + this.enclosure * 0.28) * polyScale, 0.08, 0.94);
    const prio = isPlayer ? 4 : d < 28 ? 3 : 2;
    const elevOpts = binaural ? {elevDeg: binaural.elevDeg, pinnaNotchHz: binaural.pinnaNotchHz} : {};

    if (vol > 0.20) this._duckAmbience(vol * (isPlayer ? 0.92 : 0.65), start);
    if (isPlayer) {
      this.barrelHeat = clamp(this.barrelHeat + (gun === 'RD40' || gun === 'DF1 OUT' || gun === 'DF40 II' ? 0.055 : 0.095), 0, 1);
      if (gun === 'SW T' || gun === 'MS10') this._triggerStapediusReflex(0.24);
    } else if (d < 4.5 && !path.occluded) {
      this._triggerStapediusReflex(0.32 * (1 - d / 4.5));
    }

    // LAYER 1: Friedlander Shockwave Pressure Transient
    const blastRate = gun === 'MS10' ? 1.48 * j
      : gun === 'DF40 II' ? (e.aa14 ? 1.42 : 1.28) * j
      : gun === 'RD40' ? 1.36 * j
      : gun === 'RD30' ? 1.15 * j
      : gun === 'RD20' ? 1.05 * j
      : gun === 'SR 1U' ? 1.24 * j
      : gun === 'STUN LAUNCHER' ? 0.62 * j
      : gun === 'DF1 OUT' ? (e.source === 'p1' ? 1.34 : 1.18) * j
      : gun === 'SRA' ? 1.12 * j
      : gun === 'D1' ? 0.94 * j
      : 0.86 * j;
    this._playBuffer({
      buffer: this.blastBuf,
      rate: blastRate,
      dur: 0.145,
      gain: (gun === 'SW T' ? 0.38 : gun === 'MS10' ? 0.34 : gun === 'DF40 II' ? 0.31 : gun === 'RD40' ? 0.32 : gun === 'RD30' ? 0.29 : 0.28) * vol,
      lpf,
      pos,
      pan: muzzlePan,
      bus: this.weaponsBus,
      reverbSend: revSend,
      priority: prio,
      ...elevOpts,
      start
    });

    // LAYER 2: 300Hz-Class Chest-Impact Sub-Harmonic Punch (diffracts around steel containers via lowBandVol!)
    const subRate = gun === 'SW T' ? 0.86 : gun === 'D1' ? 0.92 : gun === 'MS10' ? 1.14 : gun === 'DF40 II' ? 1.12 : gun === 'RD40' ? 1.08 : gun === 'STUN LAUNCHER' ? 0.68 : 1.0;
    this._playBuffer({
      buffer: this.sub300Buf,
      rate: subRate * j,
      dur: 0.155,
      gain: (gun === 'SW T' ? 0.30 : gun === 'MS10' ? 0.26 : gun === 'D1' ? 0.27 : 0.23) * lowBandVol,
      lpf: Math.min(340, lpf),
      pos,
      pan: 0,
      bus: this.weaponsBus,
      priority: prio,
      start
    });
    // Under heavy concurrent gunfire, stop after core punch layers for NPC shots to keep audio crisp & distortion-free
    if (!isPlayer && recent.length >= 6) return;

    // LAYER 3: Weapon-Specific Physical Acoustic Signature
    if (gun === 'MS10') {
      this._playBuffer({buffer: this.railBuf, rate: 1.06 * j, dur: 0.115, gain: 0.34 * vol, lpf, pos, pan: muzzlePan, bus: this.weaponsBus, reverbSend: revSend * 0.72, priority: prio, ...elevOpts, start});
      this._playBuffer({buffer: this.crackBuf, rate: 1.28 * j, dur: 0.048, gain: 0.34 * vol * (1 - distNorm * 0.42), filterType: 'bandpass', f0: 6400 * j, f1: 1550 * j, q: 1.2, lpf, pos, pan: muzzlePan, bus: this.weaponsBus, priority: prio, start});
      if (isPlayer) {
        this._playTone({f0: (3650 + this.barrelHeat * 420) * j, f1: 5280 * j, dur: 0.056, gain: 0.044, type: 'sine', pan: boltPan, bus: this.foleyBus, priority: 3, start: start + 0.020});
      }
    } else if (gun === 'DF40 II') {
      // Quad-barrel staggered harmonic cascade (4 simultaneous smart scatter rounds + ARV1.3 / AA1.4 overdrive shimmer)
      const pellets = Math.min(4, Math.max(1, e.pellets || 4));
      const offsets = pellets === 4 ? [0, 0.0036, 0.0072, 0.0108] : pellets === 3 ? [0, 0.0045, 0.009] : pellets === 2 ? [0, 0.006] : [0];
      const pans = pellets === 4 ? [-0.09, -0.02, 0.06, 0.16] : pellets === 3 ? [-0.07, 0.04, 0.15] : pellets === 2 ? [-0.04, 0.14] : [muzzlePan];
      for (let bi = 0; bi < offsets.length; bi++) {
        this._playBuffer({
          buffer: this.crackBuf,
          rate: (1.04 + bi * 0.05 + (e.aa14 ? 0.08 : 0)) * j,
          dur: 0.040,
          gain: (bi === 1 || bi === 2 ? 0.21 : 0.17) * vol * (1 - distNorm * 0.40),
          filterType: 'bandpass',
          f0: ((e.aa14 ? 5200 : 4150) + bi * 340) * j,
          f1: 960 * j,
          q: 1.45,
          lpf,
          pos,
          pan: isPlayer ? pans[bi] : muzzlePan,
          bus: this.weaponsBus,
          reverbSend: revSend * 0.66,
          priority: prio,
          ...elevOpts,
          start: start + offsets[bi]
        });
      }
      this._playBuffer({buffer: this.railBuf, rate: (e.aa14 ? 1.04 : 0.90) * j, dur: 0.068, gain: (e.aa14 ? 0.20 : 0.14) * vol, lpf, pos, pan: muzzlePan, bus: this.weaponsBus, priority: prio, start});
      this._playTone({f0: (e.aa14 ? 1240 : 880) * j, f1: 185 * j, dur: 0.074, gain: 0.15 * vol, type: 'triangle', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, priority: prio, start});
      if (isPlayer) {
        const fOver = e.aa14 ? 3680 : 2840;
        this._playTone({f0: (fOver + this.barrelHeat * 340) * j, f1: (fOver * 1.32) * j, dur: e.aa14 ? 0.042 : 0.030, gain: e.aa14 ? 0.048 : 0.034, type: e.aa14 ? 'sine' : 'triangle', pan: boltPan, bus: this.foleyBus, priority: 3, start: start + 0.011});
      }
    } else if (gun === 'RD40') {
      const twinOffset = (e.pellets || 2) >= 2 ? 0.0065 : 0;
      for (const dtB of twinOffset ? [0, twinOffset] : [0]) {
        const bPan = isPlayer ? (dtB ? 0.16 : -0.04) : muzzlePan;
        this._playBuffer({
          buffer: this.crackBuf,
          rate: (dtB ? 1.20 : 1.12) * j,
          dur: 0.045,
          gain: (dtB ? 0.22 : 0.28) * vol * (1 - distNorm * 0.40),
          filterType: 'bandpass',
          f0: (dtB ? 5100 : 4450) * j,
          f1: 1180 * j,
          q: 1.35,
          lpf,
          pos,
          pan: bPan,
          bus: this.weaponsBus,
          reverbSend: revSend * 0.68,
          priority: prio,
          ...elevOpts,
          start: start + dtB
        });
      }
      this._playBuffer({buffer: this.railBuf, rate: 0.86 * j, dur: 0.072, gain: 0.16 * vol, lpf, pos, pan: muzzlePan, bus: this.weaponsBus, priority: prio, start});
      if (isPlayer) {
        this._playTone({f0: (2780 + this.barrelHeat * 280) * j, f1: 3560 * j, dur: 0.034, gain: 0.036, type: 'triangle', pan: boltPan, bus: this.foleyBus, priority: 3, start: start + 0.013});
      }
    } else if (gun === 'RD30') {
      const twinOffset = (e.pellets || 2) >= 2 ? 0.0082 : 0;
      for (const dtB of twinOffset ? [0, twinOffset] : [0]) {
        const bPan = isPlayer ? (dtB ? 0.14 : -0.02) : muzzlePan;
        this._playBuffer({
          buffer: this.crackBuf,
          rate: (dtB ? 1.07 : 1.01) * j,
          dur: 0.044,
          gain: (dtB ? 0.19 : 0.25) * vol * (1 - distNorm * 0.40),
          filterType: 'bandpass',
          f0: (dtB ? 3900 : 3480) * j,
          f1: 920 * j,
          q: 1.25,
          lpf,
          pos,
          pan: bPan,
          bus: this.weaponsBus,
          reverbSend: revSend * 0.66,
          priority: prio,
          ...elevOpts,
          start: start + dtB
        });
      }
      this._playTone({f0: 850 * j, f1: 165 * j, dur: 0.072, gain: 0.15 * vol, type: 'triangle', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, priority: prio, start});
    } else if (gun === 'RD 50') {
      // RD 50: Deep punchy full-auto heavy carbine with resonant brass-drum thump
      this._playBuffer({buffer: this.crackBuf, rate: 0.92 * j, dur: 0.050, gain: 0.27 * vol * (1 - distNorm * 0.36), filterType: 'bandpass', f0: 2750 * j, f1: 580 * j, q: 1.20, lpf, pos, pan: muzzlePan, bus: this.weaponsBus, reverbSend: revSend * 0.68, priority: prio, ...elevOpts, start});
      this._playTone({f0: 540 * j, f1: 94 * j, dur: 0.102, gain: 0.22 * vol, type: 'triangle', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, priority: prio, start});
    } else if (gun === 'RD20') {
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.080, gain: 0.23 * vol, filterType: 'bandpass', f0: 3300 * j, f1: 690 * j, q: 1.65, lpf, pos, pan: muzzlePan, bus: this.weaponsBus, reverbSend: revSend * 0.62, priority: prio, ...elevOpts, start});
      this._playTone({f0: 730 * j, f1: 132 * j, dur: 0.082, gain: 0.17 * vol, type: 'triangle', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, priority: prio, start});
      if (isPlayer) {
        this._playTone({f0: 2260 * j, f1: 2920 * j, dur: 0.028, gain: 0.030, type: 'sine', pan: boltPan, bus: this.foleyBus, priority: 3, start: start + 0.011});
      }
    } else if (gun === 'DF1 OUT') {
      const p1 = e.source === 'p1';
      const cadence = 1 + burstStep * 0.038;
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.088, gain: (p1 ? 0.25 : 0.20) * vol, filterType: 'bandpass', f0: (p1 ? 4000 : 2620) * j * cadence, f1: 540 * j, q: 2.05, lpf, pos, pan: muzzlePan, bus: this.weaponsBus, reverbSend: revSend * 0.65, priority: prio, ...elevOpts, start});
      this._playTone({f0: (p1 ? 1060 : 670) * j * cadence, f1: 148 * j, dur: 0.095, gain: 0.16 * vol, type: 'triangle', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, priority: prio, start});
      if (p1) {
        this._playTone({f0: 1580 * j, f1: 2440 * j, dur: 0.068, gain: 0.092 * vol, type: 'sine', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, priority: prio, start: start + 0.004});
      }
    } else if (gun === 'D1') {
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.104, gain: 0.24 * vol, filterType: 'bandpass', f0: 2140 * j, f1: 350 * j, q: 1.15, lpf, pos, pan: muzzlePan, bus: this.weaponsBus, reverbSend: revSend * 0.70, priority: prio, ...elevOpts, start});
      this._playTone({f0: 490 * j, f1: 88 * j, dur: 0.116, gain: 0.19 * vol, type: 'triangle', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, priority: prio, start});
    } else if (gun === 'SRA') {
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.084, gain: 0.23 * vol, filterType: 'bandpass', f0: 2980 * j, f1: 520 * j, q: 1.35, lpf, pos, pan: muzzlePan, bus: this.weaponsBus, reverbSend: revSend * 0.65, priority: prio, ...elevOpts, start});
      this._playTone({f0: 430 * j, f1: 86 * j, dur: 0.095, gain: 0.17 * vol, type: 'triangle', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, priority: prio, start});
    } else {
      // SW T Supersonic Precision Battle Rifle
      this._playBuffer({buffer: this.crackBuf, rate: 0.96 * j, dur: 0.054, gain: 0.30 * vol * (1 - distNorm * 0.34), filterType: 'bandpass', f0: 3650 * j, f1: 780 * j, q: 1.1, lpf, pos, pan: muzzlePan, bus: this.weaponsBus, reverbSend: revSend * 0.75, priority: prio, ...elevOpts, start});
      this._playTone({f0: 345 * j, f1: 62 * j, dur: 0.145, gain: 0.23 * vol, type: 'triangle', lpf, pos, pan: muzzlePan, bus: this.weaponsBus, priority: prio, start});
    }

    // LAYER 4: Karplus-Strong Waveguide Bolt Carrier & Mechanical Action Clack (close range)
    if (isPlayer || d < 20) {
      const mGain = isPlayer ? 0.088 : 0.044 * (1 - d / 20);
      const boltDelay = gun === 'MS10' ? 0.013 : gun === 'DF40 II' ? 0.010 : gun === 'RD40' ? 0.012 : gun === 'RD 50' ? 0.015 : gun === 'RD30' ? 0.014 : 0.018;
      const boltRate = gun === 'MS10' ? 1.38 : gun === 'DF40 II' ? 1.32 : gun === 'RD40' ? 1.28 : gun === 'RD 50' ? 0.96 : gun === 'RD30' ? 1.12 : gun === 'SW T' ? 0.88 : 1.04;
      this._playBuffer({
        buffer: this.boltBuf,
        rate: boltRate * j * (1 + (isPlayer ? this.barrelHeat * 0.06 : 0)),
        dur: 0.062,
        gain: mGain,
        pos,
        pan: boltPan,
        bus: this.foleyBus,
        priority: isPlayer ? 3 : 1,
        start: start + boltDelay
      });
      if (isPlayer && gun === 'SRA') {
        this._playTone({f0: 695 * j, f1: 635 * j, dur: 0.085, gain: 0.024, type: 'sine', pan: 0.08, bus: this.foleyBus, priority: 2, start: start + 0.022});
      }
    }

    // LAYER 5: Tactical Low-Ammo Last-5-Rounds Metallic Magazine-Spring Warning Ping (Player Feedback!)
    if (isPlayer && a && a.mag <= 5 && e.source !== 'p1') {
      const urgency = (6 - a.mag) / 5; // 0.2 -> 1.0 on final round!
      const pingF = 2480 + urgency * 940;
      this._playTone({f0: pingF, f1: pingF * 0.94, dur: 0.065 + urgency * 0.055, attack: 0.001, gain: 0.032 + urgency * 0.042, type: 'triangle', pan: boltPan, bus: this.foleyBus, priority: 3, start: start + 0.026});
    }

    // LAYER 6: Barrel-Heat Thermal Sizzle (when player fires sustained full-auto > 65% heat)
    if (isPlayer && this.barrelHeat > 0.65) {
      this._playBuffer({
        buffer: this.whiteNoiseBuf,
        loop: true,
        dur: 0.055,
        attack: 0.008,
        gain: 0.024 * (this.barrelHeat - 0.55),
        filterType: 'highpass',
        f0: 5400,
        pan: muzzlePan,
        bus: this.foleyBus,
        priority: 1,
        start: start + 0.032
      });
    }

    // LAYER 7: Distance-Dependent Rolling Outdoor Harbor Cannon Tail
    if (d > 12 || isPlayer) {
      const tailAmp = (isPlayer ? 0.12 : 0.22 * (0.35 + distNorm * 0.85)) * vol;
      this._playBuffer({
        buffer: this.pinkNoiseBuf,
        loop: true,
        dur: 0.26 + distNorm * 0.32,
        attack: 0.016,
        gain: tailAmp,
        filterType: 'lowpass',
        f0: Math.min(lpf, 1180 - distNorm * 460),
        f1: 165,
        q: 0.8,
        pos,
        pan: muzzlePan,
        bus: this.weaponsBus,
        reverbSend: revSend,
        priority: prio - 1,
        start: start + 0.015
      });
    }

    // LAYER 8-9: Zero-Jitter Analytical Method-of-Images Early Reflections off Harbor Containers!
    if (vol > 0.13 && this._canSpawnVoice(1)) {
      const rayCount = this.mode === AUDIO_MODES.ultra300 ? (isPlayer ? 6 : 4) : this.mode === AUDIO_MODES.hrtf ? (isPlayer ? 4 : 3) : 2;
      const taps = traceEarlyReflections(srcPos, this.listenerPos, rayCount);
      const maxTaps = this.mode === AUDIO_MODES.ultra300 ? (isPlayer ? 4 : 3) : 2;
      for (let i = 0; i < Math.min(maxTaps, taps.length); i++) {
        const tap = taps[i];
        this.stats.reflections++;
        if (tap.analytical) this.stats.analyticalReflections++;
        const tapVol = clamp(tap.gain * vol * (isPlayer ? 0.76 : 0.84), 0.008, 0.24);
        this._playBuffer({
          buffer: this.blastBuf,
          rate: blastRate * (tap.mat === 'steel' ? 1.09 : 0.92),
          dur: 0.13,
          attack: 0.005,
          gain: tapVol,
          filterType: tap.mat === 'steel' ? 'bandpass' : 'lowpass',
          f0: tap.cutoffHz,
          f1: tap.mat === 'steel' ? 860 : 360,
          q: tap.mat === 'steel' ? 1.55 : 0.75,
          pos: tap.pos,
          bus: this.earlyReflBus,
          priority: 1,
          start: start + tap.delay
        });
      }
    }

    if (e.scherp && (isPlayer || d < 32)) {
      const sVol = (isPlayer ? 0.064 : clamp(vol * 0.08, 0.01, 0.055));
      this._playTone({f0: 4180 * j, f1: 6240 * j, dur: 0.036, attack: 0.001, gain: sVol, type: 'sine', pos: isPlayer ? null : srcPos, pan: isPlayer ? 0.02 : muzzlePan, bus: this.foleyBus, priority: 3, start: start + 0.004});
    }
  }

  // --------------------------------------------------------------------------
  // 300Hz-Curved True Hyperbolic Doppler & Mach-Cone Ballistic Flybys (6 Types)
  // --------------------------------------------------------------------------
  playWhiz(e) {
    if (!this.ctx || !this.on || !this.volume) return;
    const now = this.ctx.currentTime;
    if (now - this.lastWhizAt < 0.024) return;
    this.lastWhizAt = now;
    this.stats.whizzes++;

    const d = Math.max(0.25, finite(e.dist, 2.0));
    const speed = finite(e.speed, 360);
    const gun = e.gun || 'SW T';
    const dop300 = computeDopplerCurve300Hz(speed, d);
    const doppler = dop300.doppler;
    this.stats.dopplerCurves300Hz++;

    const closeness = clamp(1 - d / 6.2, 0.14, 1);
    const vol = (0.15 + closeness * closeness * 0.38) * (e.enemy ? 1.0 : 0.56);
    const j = 0.89 + Math.random() * 0.22;

    const pt = e.point || this.listenerPos;
    const dir = e.dir || [0, 0, -1];
    const dur = dop300.duration;
    const halfSpan = Math.min(9.0, speed * dur * 0.45);
    const pStart = [pt[0] - dir[0] * halfSpan, pt[1] - dir[1] * halfSpan, pt[2] - dir[2] * halfSpan];
    const pEnd = [pt[0] + dir[0] * halfSpan, pt[1] + dir[1] * halfSpan, pt[2] + dir[2] * halfSpan];
    const pan0 = e.pan ?? this._computeStereoPan(pStart);
    const pan1 = e.panEnd ?? this._computeStereoPan(pEnd);

    // 1. Supersonic Mach-Cone N-Wave Double-Shock Ballistic Crack (MagnusAero 1.0 Bow + Tail N-Wave)
    if (doppler.isSupersonic && d < 5.8) {
      const crackAmp = vol * (gun === 'MS10' ? 1.46 : gun === 'RD40' ? 1.24 : 1.14) * clamp(1 - d / 6.0, 0.22, 1);
      if (d < 2.2) this._triggerStapediusReflex(0.28 * (1 - d / 2.2));
      this._playBuffer({
        buffer: this.crackBuf,
        rate: (gun === 'MS10' ? 1.34 : 1.04) * j,
        dur: 0.046,
        attack: 0.001,
        gain: crackAmp,
        filterType: 'highpass',
        f0: 920,
        pos: pt,
        pan: pan0,
        panEnd: pan1,
        bus: this.impactsBus,
        reverbSend: 0.24,
        priority: 4,
        start: now
      });
      const nw = finite(e.nWaveDelay, 0);
      if (nw > 0.0005) {
        this._playBuffer({
          buffer: this.crackBuf,
          rate: (gun === 'MS10' ? 1.12 : 0.90) * j,
          dur: 0.036,
          attack: 0.001,
          gain: crackAmp * 0.56,
          filterType: 'highpass',
          f0: 1380,
          pos: pt,
          pan: pan1,
          bus: this.impactsBus,
          reverbSend: 0.16,
          priority: 3,
          start: now + nw
        });
      }
    }

    // 2. Build 300Hz-Sampled Hyperbolic Pitch Curve for Web Audio Filter & Oscillator!
    const fBase = gun === 'MS10' ? 2900 : gun === 'RD40' ? 2150 : gun === 'DF1 OUT' ? (e.source === 'p1' ? 1720 : 1260) : 1480;
    const n = dop300.curve.length;
    const filterCurve = new Float32Array(n);
    const toneCurve = new Float32Array(n);
    const tumble = !!e.ricocheted;
    for (let i = 0; i < n; i++) {
      const m = dop300.curve[i];
      // Tumbling post-ricochet bullets add rapid 48Hz aerodynamic flutter modulation!
      const flutter = tumble ? (1 + 0.16 * Math.sin(i * 0.95)) : 1;
      filterCurve[i] = fBase * m * j * (gun === 'MS10' ? 1.32 : 1.15) * flutter;
      toneCurve[i] = fBase * m * j * (gun === 'MS10' ? 0.85 : 0.56) * flutter;
    }

    this._playBuffer({
      buffer: this.whiteNoiseBuf,
      loop: true,
      dur,
      gain: vol * (gun === 'MS10' ? 1.18 : 0.98),
      filterType: 'bandpass',
      filterCurve,
      q: gun === 'MS10' ? 3.8 : tumble ? 6.2 : 4.2,
      pos: pStart,
      posEnd: pEnd,
      pan: pan0,
      panEnd: pan1,
      bus: this.impactsBus,
      priority: 3,
      start: now + (doppler.isSupersonic ? 0.006 : 0)
    });

    this._playTone({
      freqCurve: toneCurve,
      dur: dur * 0.92,
      gain: vol * (gun === 'DF1 OUT' ? 0.42 : tumble ? 0.40 : 0.30),
      type: gun === 'MS10' ? 'sawtooth' : gun === 'DF1 OUT' ? 'sine' : 'triangle',
      pos: pStart,
      pan: pan0,
      panEnd: pan1,
      bus: this.impactsBus,
      priority: 3,
      start: now + 0.004
    });
  }

  // --------------------------------------------------------------------------
  // 8-Mode Surface Impacts, Ricochets, Penetrations & Minnaert Water Splashes
  // --------------------------------------------------------------------------
  playImpact(e) {
    if (!this.ctx || !this.on || !this.volume || !e.point) return;
    const now = this.ctx.currentTime;
    if (now - this.lastImpactAt < 0.026) return;
    const p = e.point;
    const path = computeMultiBandAcousticPath(p, this.listenerPos);
    if (path.dist > 64) return;
    this.lastImpactAt = now;
    this.stats.impacts++;

    const start = now + path.delay;
    const v = clamp(path.directGain * 1.18, 0.03, 0.95);
    const lpf = path.cutoffHz;
    const mat = e.mat || (e.metal ? 'steel' : 'concrete');
    const j = 0.86 + Math.random() * 0.28;
    const rev = clamp(0.24 + path.reverbBoost + this.enclosure * 0.26, 0.14, 0.76);

    if (mat === 'water') {
      this._playWaterSplash(p, start, v, lpf, rev);
      return;
    }

    if (mat === 'steel') {
      // 8-Mode Kirchhoff-Love corrugated steel shipping container strike + spark shear
      this._playBuffer({buffer: this.steelBuf, rate: j, dur: 0.26, gain: 0.26 * v, lpf, pos: p, bus: this.impactsBus, reverbSend: rev * 0.72, priority: 2, start});
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.056, gain: 0.16 * v, filterType: 'bandpass', f0: 4100 * j, f1: 980 * j, q: 2.3, lpf, pos: p, bus: this.impactsBus, reverbSend: rev, priority: 2, start});
      if (Math.random() < (e.gun === 'MS10' ? 0.50 : 0.30)) {
        this._playRicochetCurve(p, start + 0.008, v * 0.78, lpf, rev, j, 'steel');
      }
    } else if (mat === 'wood') {
      // Anisotropic wood crate splinter + hollow cavity
      this._playBuffer({buffer: this.woodBuf, rate: j, dur: 0.145, gain: 0.28 * v, lpf, pos: p, bus: this.impactsBus, reverbSend: rev * 0.48, priority: 2, start});
    } else {
      // Concrete dock thud + multi-grain gravel & spall scatter
      this._playBuffer({buffer: this.gritBuf, rate: 0.88 + Math.random() * 0.26, dur: 0.28, gain: 0.26 * v, lpf, pos: p, bus: this.impactsBus, reverbSend: rev * 0.55, priority: 2, start});
    }
  }

  _playWaterSplash(p, start, v, lpf, rev) {
    const now = this.ctx?.currentTime ?? start;
    if (now - this.lastWaterAt < 0.04) return;
    this.lastWaterAt = now;
    this.stats.waterSplashes++;
    this._playBuffer({
      buffer: this.waterBuf,
      rate: 0.86 + Math.random() * 0.30,
      dur: 0.34,
      gain: 0.32 * v,
      lpf,
      pos: p,
      bus: this.impactsBus,
      reverbSend: rev * 0.65,
      priority: 2,
      start
    });
  }

  _playRicochetCurve(p, start, v, lpf, rev, j, mat) {
    const dur = 0.21 + Math.random() * 0.13;
    const f0 = (mat === 'steel' ? 2850 : 2150) * j;
    const up = Math.random() < 0.38;
    const n = 36;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const glide = up ? (1 + 0.44 * Math.pow(u, 0.7)) : Math.pow(0.40, u);
      const tumble = 1 + 0.055 * Math.sin(u * Math.PI * 10);
      curve[i] = f0 * glide * tumble;
    }
    this._playTone({freqCurve: curve, dur, attack: 0.002, gain: 0.138 * v, type: 'sine', lpf, pos: p, bus: this.impactsBus, reverbSend: rev, priority: 3, start});
    const curve2 = new Float32Array(n);
    for (let i = 0; i < n; i++) curve2[i] = curve[i] * 1.46;
    this._playTone({freqCurve: curve2, dur: dur * 0.80, attack: 0.002, gain: 0.062 * v, type: 'triangle', lpf, pos: p, bus: this.impactsBus, priority: 2, start: start + 0.006});
  }

  // --------------------------------------------------------------------------
  // Physics-Driven Surface-Aware Brass / Alloy Shell Casing Bounces
  // --------------------------------------------------------------------------
  playCasing(e) {
    if (!this.ctx || !this.on || !this.volume || !e.point) return;
    const now = this.ctx.currentTime;
    if (now - this.lastCasingAt < 0.022) return;
    const d = Math.hypot(...e.point.map((value, i) => value - this.listenerPos[i]));
    if (d > 15) return;
    this.lastCasingAt = now;
    this.stats.casings++;

    const v = clamp(1 - d / 15, 0.12, 1) * (e.bounce ? 0.56 : 1.0) * clamp((e.speed || 2) / 3.5, 0.35, 1.15);
    const mat = surfaceAt(e.point[0], e.point[2], e.point[1]);
    const gunRate = e.gun === 'MS10' ? 1.22 : e.gun === 'DF1 OUT' ? 1.12 : e.gun === 'SW T' ? 0.89 : 1.0;
    const matRate = mat === 'steel' ? 1.14 : mat === 'wood' ? 0.86 : 1.0;
    const j = 0.93 + Math.random() * 0.14;
    const start = now + computePropagationDelay(d);

    this._playBuffer({
      buffer: this.brassBuf,
      rate: gunRate * matRate * j,
      dur: 0.068,
      attack: 0.001,
      gain: (mat === 'steel' ? 0.072 : 0.052) * v,
      pos: e.point,
      bus: this.foleyBus,
      priority: 1,
      start
    });
  }

  // --------------------------------------------------------------------------
  // Tactical Foley: 3-Phase Footsteps, Stances, ADS, Jumps, Landings, 5-Stage Reload
  // --------------------------------------------------------------------------
  _playFootstep(actor, isPlayer, parity, now) {
    const last = this.lastFootstepAt.get(actor.id) ?? -Infinity;
    if (now - last < 0.165) return;
    this.lastFootstepAt.set(actor.id, now);
    this.stats.footsteps++;

    const feetPos = [actor.x, actor.y + 0.08, actor.z];
    const path = isPlayer
      ? {dist: 0, delay: 0, occluded: false, cutoffHz: 18800, directGain: 1, reverbBoost: 0}
      : computeMultiBandAcousticPath(feetPos, this.listenerPos);
    if (!isPlayer && path.dist > 36) return;

    const binaural = isPlayer ? null : computeBinauralNearField(feetPos, this.listenerPos, this.listenerRight, this.listenerFwd);
    const mat = surfaceAt(actor.x, actor.z, actor.y);
    const sprint = actor.sprintAmt || 0;
    const crouch = actor.crouch || 0;
    const stanceGain = (1 + sprint * 0.54) * (1 - crouch * 0.64);
    const vol = (isPlayer ? 0.42 : clamp(path.directGain * 1.08, 0.03, 0.74)) * stanceGain;
    const start = now + path.delay;
    const pos = isPlayer ? null : feetPos;
    const pan = isPlayer ? (parity ? 0.11 : -0.11) : 0;
    const lpf = binaural ? Math.min(path.cutoffHz, binaural.shadowCutoffHz) : path.cutoffHz;
    const elevOpts = binaural ? {elevDeg: binaural.elevDeg, pinnaNotchHz: binaural.pinnaNotchHz} : {};
    const j = 0.90 + Math.random() * 0.20;

    if (mat === 'steel') {
      // Resonant corrugated steel container roof boot strike + 8-mode shell ping
      this._playTone({f0: 176 * j, f1: 68 * j, dur: 0.098, gain: 0.165 * vol, type: 'triangle', lpf, pos, pan, bus: this.foleyBus, reverbSend: 0.30, priority: 2, start});
      this._playBuffer({buffer: this.steelBuf, rate: 0.76 * j, dur: 0.12, gain: 0.085 * vol, lpf, pos, pan, bus: this.foleyBus, priority: 2, ...elevOpts, start});
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.044, gain: 0.085 * vol, filterType: 'bandpass', f0: 2150 * j, f1: 960 * j, q: 2.2, lpf, pos, pan, bus: this.foleyBus, priority: 1, ...elevOpts, start: start + 0.036});
    } else if (mat === 'wood') {
      this._playBuffer({buffer: this.woodBuf, rate: 0.85 * j, dur: 0.095, gain: 0.16 * vol, lpf, pos, pan, bus: this.foleyBus, priority: 2, ...elevOpts, start});
    } else {
      // Concrete dock asphalt: 3-phase heel thump + midfoot grit + toe-off scuff
      this._playTone({f0: 122 * j, f1: 50 * j, dur: 0.068, gain: 0.145 * vol, type: 'sine', lpf, pos, pan, bus: this.foleyBus, priority: 2, start});
      this._playBuffer({buffer: this.pinkNoiseBuf, loop: true, dur: 0.052, gain: 0.12 * vol, filterType: 'bandpass', f0: 1680 * j, f1: 620 * j, q: 1.3, lpf, pos, pan, bus: this.foleyBus, reverbSend: 0.14, priority: 2, ...elevOpts, start});
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.040, gain: 0.062 * vol, filterType: 'bandpass', f0: 2500 * j, f1: 1180 * j, q: 2.0, lpf, pos, pan, bus: this.foleyBus, priority: 1, ...elevOpts, start: start + (sprint > 0.35 ? 0.035 : 0.050)});
    }

    if (sprint > 0.25 && (isPlayer || path.dist < 14)) {
      this._playBuffer({buffer: this.clothBuf, rate: 0.92 + Math.random() * 0.18, dur: 0.10, gain: 0.058 * vol * sprint, lpf, pos, pan: -pan * 0.5, bus: this.foleyBus, priority: 1, start: start + 0.014});
    }
  }

  _playStanceFoley(actor, isPlayer, kind, now) {
    this.stats.foleyCues++;
    const p = isPlayer ? null : eyeOf(actor);
    const path = isPlayer ? {delay: 0, cutoffHz: 18800, directGain: 1, dist: 0} : computeMultiBandAcousticPath(p, this.listenerPos);
    if (!isPlayer && path.dist > 14) return;
    const vol = isPlayer ? 0.075 : clamp(path.directGain * 0.048, 0.004, 0.036);
    this._playBuffer({
      buffer: this.clothBuf,
      rate: kind === 'crouch' ? 0.88 : kind === 'stand' ? 1.12 : 1.02,
      dur: 0.11,
      gain: vol,
      lpf: path.cutoffHz,
      pos: p,
      pan: isPlayer ? (kind === 'lean' ? 0.14 : -0.06) : 0,
      bus: this.foleyBus,
      priority: 1,
      start: now + path.delay
    });
  }

  _playAdsClick(entering, isThermal, now) {
    this.stats.foleyCues++;
    this._playBuffer({buffer: this.clothBuf, rate: entering ? 1.18 : 0.90, dur: 0.085, gain: 0.055, pan: 0.10, bus: this.foleyBus, priority: 2, start: now});
    this._playTone({f0: entering ? 1850 : 1220, f1: entering ? 2480 : 880, dur: 0.024, attack: 0.001, gain: 0.036, type: 'triangle', pan: 0.12, bus: this.foleyBus, priority: 2, start: now + 0.010});
    if (entering && isThermal) {
      this._playTone({f0: 420, f1: 680, dur: 0.075, attack: 0.006, gain: 0.032, type: 'sine', pan: 0, bus: this.uiBus, priority: 2, start: now + 0.024});
    }
  }

  _playJump(actor, isPlayer, now) {
    const feetPos = [actor.x, actor.y + 0.1, actor.z];
    const path = isPlayer ? {delay: 0, cutoffHz: 18800, directGain: 1} : computeMultiBandAcousticPath(feetPos, this.listenerPos);
    const vol = isPlayer ? 0.38 : clamp(path.directGain * 0.65, 0.02, 0.5);
    const start = now + path.delay;
    const pos = isPlayer ? null : feetPos;
    this._playBuffer({buffer: this.clothBuf, rate: 1.15, dur: 0.11, gain: 0.12 * vol, lpf: path.cutoffHz, pos, bus: this.foleyBus, priority: 2, start});
    this._playTone({f0: 112, f1: 66, dur: 0.075, gain: 0.09 * vol, type: 'sine', lpf: path.cutoffHz, pos, bus: this.foleyBus, priority: 2, start});
  }

  _playLanding(actor, isPlayer, force, now) {
    const feetPos = [actor.x, actor.y + 0.08, actor.z];
    const path = isPlayer ? {delay: 0, cutoffHz: 18800, directGain: 1, reverbBoost: 0} : computeMultiBandAcousticPath(feetPos, this.listenerPos);
    const mat = surfaceAt(actor.x, actor.z, actor.y);
    const vol = (isPlayer ? 0.60 : clamp(path.directGain * 0.95, 0.04, 0.72)) * force;
    const start = now + path.delay;
    const pos = isPlayer ? null : feetPos;
    const lpf = path.cutoffHz;

    this._playBuffer({buffer: this.sub300Buf, rate: mat === 'steel' ? 1.18 : 0.85, dur: 0.145, gain: 0.25 * vol, lpf, pos, bus: this.foleyBus, reverbSend: 0.24, priority: 2, start});
    if (mat === 'steel') {
      this._playBuffer({buffer: this.steelBuf, rate: 0.68, dur: 0.18, gain: 0.14 * vol, lpf, pos, bus: this.foleyBus, reverbSend: 0.34, priority: 2, start});
    }
    this._playBuffer({buffer: this.clothBuf, rate: 0.90, dur: 0.12, gain: 0.11 * vol, lpf, pos, bus: this.foleyBus, priority: 1, start: start + 0.032});
  }

  _playReloadStage(actor, isPlayer, stage, now) {
    const p = isPlayer ? null : eyeOf(actor);
    const path = isPlayer ? {delay: 0, cutoffHz: 18800, directGain: 1} : computeMultiBandAcousticPath(p, this.listenerPos);
    const vol = isPlayer ? 0.96 : clamp(path.directGain * 0.78, 0.03, 0.56);
    const start = now + path.delay;
    const pan = isPlayer ? 0.16 : 0;
    const lpf = path.cutoffHz;

    if (stage === 1) {
      this._playTone({f0: 1980, f1: 1120, dur: 0.028, attack: 0.001, gain: 0.078 * vol, type: 'triangle', lpf, pos: p, pan, bus: this.foleyBus, priority: 3, start});
      this._playTone({f0: 420, f1: 240, dur: 0.045, gain: 0.068 * vol, type: 'sine', lpf, pos: p, pan, bus: this.foleyBus, priority: 2, start: start + 0.01});
    } else if (stage === 2) {
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.11, attack: 0.015, gain: 0.066 * vol, filterType: 'bandpass', f0: 2650, f1: 1040, q: 3.4, lpf, pos: p, pan: pan + 0.06, bus: this.foleyBus, priority: 2, start});
      this._playTone({f0: 360, f1: 195, dur: 0.065, gain: 0.052 * vol, type: 'triangle', lpf, pos: p, pan, bus: this.foleyBus, priority: 2, start: start + 0.02});
    } else if (stage === 3) {
      this._playBuffer({buffer: this.clothBuf, rate: 1.08, dur: 0.135, gain: 0.11 * vol, lpf, pos: p, pan: isPlayer ? -0.14 : 0, bus: this.foleyBus, priority: 2, start});
    } else if (stage === 4) {
      this._playTone({f0: 240, f1: 110, dur: 0.066, attack: 0.002, gain: 0.118 * vol, type: 'triangle', lpf, pos: p, pan, bus: this.foleyBus, priority: 3, start});
      this._playBuffer({buffer: this.boltBuf, rate: 1.18, dur: 0.048, gain: 0.088 * vol, lpf, pos: p, pan, bus: this.foleyBus, priority: 3, start: start + 0.018});
    }
  }

  _playLoadedBoltRack(actor, isPlayer, now) {
    const p = isPlayer ? null : eyeOf(actor);
    const path = isPlayer ? {delay: 0, cutoffHz: 18800, directGain: 1} : computeMultiBandAcousticPath(p, this.listenerPos);
    if (!isPlayer && path.dist > 28) return;
    const vol = isPlayer ? 1.0 : clamp(path.directGain * 0.72, 0.03, 0.5);
    const start = now + path.delay;
    const pan = isPlayer ? 0.15 : 0;
    const lpf = path.cutoffHz;
    const gun = actor?.gun || 'SW T';
    const fRack = gun === 'MS10' ? 1860 : gun === 'DF40 II' ? 1780 : gun === 'RD40' ? 1700 : gun === 'RD30' ? 1420 : gun === 'RD20' ? 1320 : gun === 'DF1 OUT' ? 1480 : 960;
    this._playBuffer({buffer: this.boltBuf, rate: fRack / 1400, dur: 0.068, gain: 0.145 * vol, lpf, pos: p, pan, bus: this.foleyBus, priority: 3, start});
    this._playTone({f0: fRack * 1.18, f1: fRack * 0.76, dur: 0.068, attack: 0.002, gain: 0.105 * vol, type: 'triangle', lpf, pos: p, pan, bus: this.foleyBus, priority: 3, start: start + 0.056});
    if ((gun === 'MS10' || gun === 'RD40' || gun === 'DF40 II') && isPlayer) {
      this._playTone({f0: gun === 'DF40 II' ? 2080 : gun === 'RD40' ? 1980 : 2200, f1: gun === 'DF40 II' ? 3160 : gun === 'RD40' ? 2980 : 3340, dur: 0.095, gain: 0.050, type: 'sine', pan: 0.12, bus: this.foleyBus, priority: 3, start: start + 0.068});
    }
  }

  // --------------------------------------------------------------------------
  // System Acoustic Cues (FermatCore, RD40/D01, DF40 II AA1.4, FLIR, ChronoTrace, ResonanceCore)
  // --------------------------------------------------------------------------
  _playFermatLock(isDouble, now) {
    this.stats.systemCues++;
    this._playTone({f0: 1760, f1: 2349, dur: 0.048, attack: 0.001, gain: 0.046, type: 'sine', pan: 0.05, bus: this.uiBus, priority: 3, start: now});
    if (isDouble) {
      this._playTone({f0: 2349, f1: 3136, dur: 0.068, attack: 0.001, gain: 0.048, type: 'triangle', pan: -0.05, bus: this.uiBus, priority: 3, start: now + 0.032});
    }
  }

  _playFlirToggle(on, now) {
    this.stats.systemCues++;
    this._playBuffer({buffer: this.boltBuf, rate: on ? 1.65 : 1.15, dur: 0.035, gain: 0.062, pan: 0, bus: this.uiBus, priority: 3, start: now});
    this._playTone({f0: on ? 320 : 620, f1: on ? 880 : 240, dur: 0.095, attack: 0.004, gain: 0.052, type: 'sine', bus: this.uiBus, priority: 3, start: now + 0.012});
  }

  _playChronoToggle(on, now) {
    this.stats.systemCues++;
    this._playTone({f0: on ? 280 : 1240, f1: on ? 1480 : 240, dur: 0.18, attack: 0.008, gain: 0.065, type: 'triangle', bus: this.uiBus, priority: 3, start: now});
    this._playTone({f0: on ? 560 : 880, f1: on ? 1960 : 440, dur: 0.14, attack: 0.006, gain: 0.044, type: 'sine', bus: this.uiBus, priority: 3, start: now + 0.03});
  }

  _playRdLock(d01, now, aa14 = false) {
    if (now - this.lastRdLockAt < 0.12) return;
    this.lastRdLockAt = now;
    this.stats.systemCues++;
    const base = aa14 ? 1820 : d01 ? 1380 : 1560;
    this._playTone({f0: base, f1: base * 1.48, dur: 0.052, attack: 0.002, gain: aa14 ? 0.072 : 0.064, type: 'triangle', pan: 0.05, bus: this.uiBus, priority: 3, start: now});
    this._playTone({f0: base * 1.5, f1: base * (aa14 ? 2.15 : 2.0), dur: 0.072, attack: 0.002, gain: aa14 ? 0.062 : 0.054, type: 'sine', pan: -0.05, bus: this.uiBus, priority: 3, start: now + 0.024});
  }

  _playScherpLock(mode, now) {
    if (now - this.lastRdLockAt < 0.09) return;
    this.lastRdLockAt = now;
    this.stats.systemCues++;
    const base = mode === 'bank' ? 2380 : mode === 'pen' ? 1960 : 2140;
    this._playTone({f0: base, f1: base * 1.5, dur: 0.042, attack: 0.001, gain: 0.068, type: 'sine', pan: -0.04, bus: this.uiBus, priority: 4, start: now});
    this._playTone({f0: base * 1.5, f1: base * 2.25, dur: 0.058, attack: 0.001, gain: 0.054, type: 'triangle', pan: 0.04, bus: this.uiBus, priority: 4, start: now + 0.018});
  }

  _playAA14(state, now) {
    this.stats.systemCues++;
    if (state === 'on') {
      // Rising harmonic overdrive surge
      this._playTone({f0: 540, f1: 1480, dur: 0.14, attack: 0.005, gain: 0.078, type: 'triangle', pan: -0.06, bus: this.uiBus, priority: 4, start: now});
      this._playTone({f0: 880, f1: 2420, dur: 0.16, attack: 0.005, gain: 0.064, type: 'sine', pan: 0.06, bus: this.uiBus, priority: 4, start: now + 0.024});
    } else if (state === 'off') {
      this._playTone({f0: 1120, f1: 420, dur: 0.12, attack: 0.004, gain: 0.060, type: 'triangle', bus: this.uiBus, priority: 3, start: now});
    } else if (state === 'overheat') {
      // Pressurized thermal steam vent hiss + descending alarm tone
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.42, attack: 0.008, gain: 0.125, filterType: 'bandpass', f0: 4200, f1: 1150, q: 1.5, bus: this.uiBus, priority: 4, start: now});
      this._playTone({f0: 1440, f1: 310, dur: 0.28, attack: 0.003, gain: 0.088, type: 'sawtooth', bus: this.uiBus, priority: 4, start: now});
      this._playTone({f0: 760, f1: 260, dur: 0.22, attack: 0.003, gain: 0.072, type: 'triangle', bus: this.uiBus, priority: 4, start: now + 0.11});
    } else if (state === 'ready') {
      this._playTone({f0: 1180, f1: 1760, dur: 0.075, attack: 0.002, gain: 0.056, type: 'sine', pan: -0.05, bus: this.uiBus, priority: 3, start: now});
      this._playTone({f0: 1760, f1: 2349, dur: 0.095, attack: 0.002, gain: 0.058, type: 'sine', pan: 0.05, bus: this.uiBus, priority: 3, start: now + 0.045});
    } else if (state === 'blocked') {
      this._playTone({f0: 360, f1: 240, dur: 0.075, attack: 0.002, gain: 0.060, type: 'square', bus: this.uiBus, priority: 3, start: now});
    }
  }

  _playD01Ping(now) {
    if (now - this.lastD01At < 0.26) return;
    this.lastD01At = now;
    this.stats.systemCues++;
    this._playTone({f0: 920, f1: 1380, dur: 0.065, attack: 0.002, gain: 0.058, type: 'sine', pan: 0.06, bus: this.uiBus, priority: 3, start: now});
    this._playTone({f0: 2420, f1: 2380, dur: 0.115, attack: 0.003, gain: 0.048, type: 'sine', pan: -0.06, bus: this.uiBus, priority: 3, start: now + 0.018});
    this._playTone({f0: 2420, f1: 2340, dur: 0.090, attack: 0.003, gain: 0.024, type: 'sine', pan: 0.09, bus: this.uiBus, priority: 2, start: now + 0.088});
  }

  _playRicochet(e, now) {
    const p = e.point;
    const path = computeMultiBandAcousticPath(p, this.listenerPos);
    if (path.dist > 68) return;
    const start = now + path.delay;
    const v = clamp(path.directGain * 1.25, 0.05, 0.98);
    const lpf = path.cutoffHz;
    const j = 0.88 + Math.random() * 0.24;
    const rev = clamp(0.28 + path.reverbBoost + this.enclosure * 0.26, 0.16, 0.78);
    this._playRicochetCurve(p, start, v, lpf, rev, j, e.mat || 'steel');
    this._playBuffer({buffer: this.steelBuf, rate: 1.24 * j, dur: 0.11, gain: 0.15 * v, lpf, pos: p, bus: this.impactsBus, reverbSend: rev, priority: 3, start});
  }

  _playPenetrate(e, now) {
    const p = e.point;
    const path = computeMultiBandAcousticPath(p, this.listenerPos);
    if (path.dist > 58) return;
    const start = now + path.delay;
    const v = clamp(path.directGain * 1.18, 0.04, 0.92);
    const lpf = path.cutoffHz;
    const j = 0.9 + Math.random() * 0.2;
    if (e.mat === 'wood') {
      this._playBuffer({buffer: this.woodBuf, rate: 1.15 * j, dur: 0.14, gain: 0.28 * v, lpf, pos: p, bus: this.impactsBus, reverbSend: 0.36, priority: 2, start});
    } else {
      this._playBuffer({buffer: this.steelBuf, rate: 1.38 * j, dur: 0.14, gain: 0.22 * v, lpf, pos: p, bus: this.impactsBus, reverbSend: 0.42, priority: 2, start});
      this._playTone({f0: 1520 * j, f1: 420 * j, dur: 0.11, gain: 0.14 * v, type: 'sawtooth', lpf, pos: p, bus: this.impactsBus, priority: 2, start});
    }
  }

  _playContainerResonance(e, now, player) {
    const p = e.point;
    if (!p) return;
    const isKnock = !!e.knockedEnemy && e.actor === player;
    if (!isKnock && now - this.lastResonateAt < 0.042) return;
    this.lastResonateAt = now;

    const path = computeMultiBandAcousticPath(p, this.listenerPos);
    if (path.dist > 72 && !isKnock) return;
    const start = now + (isKnock ? 0 : path.delay);
    const scaleGain = e.roof ? 0.38 : 0.76;
    const v = clamp((path.bandGains?.low ?? path.directGain) * scaleGain * (0.65 + (e.energy || 0.5) * 0.45), 0.03, 0.82);
    const lpf = Math.min(path.cutoffHz, 5600);
    const freqs = e.freqs || [88, 172, 298];
    const rev = clamp(0.32 + path.reverbBoost + this.enclosure * 0.28, 0.2, 0.82);

    // 4-Mode <300Hz Kirchhoff-Love Structural Resonator
    this._playTone({f0: freqs[0], f1: freqs[0] * 0.96, dur: e.roof ? 0.28 : 0.52, attack: 0.004, gain: 0.16 * v, type: 'sine', lpf, pos: p, bus: this.impactsBus, reverbSend: rev, priority: 2, start});
    this._playTone({f0: freqs[1], f1: freqs[1] * 0.98, dur: e.roof ? 0.18 : 0.36, attack: 0.002, gain: 0.078 * v, type: 'triangle', lpf, pos: p, bus: this.impactsBus, reverbSend: rev * 0.8, priority: 2, start});
    this._playTone({f0: freqs[2], f1: freqs[2] * 0.97, dur: e.roof ? 0.10 : 0.22, attack: 0.001, gain: 0.042 * v, type: 'sine', lpf, pos: p, bus: this.impactsBus, priority: 1, start});

    if (isKnock) {
      this.stats.systemCues++;
      this._playTone({f0: freqs[0] * 1.5, f1: freqs[0] * 1.15, dur: 0.22, attack: 0.003, gain: 0.13, type: 'triangle', bus: this.uiBus, priority: 4, start: now + 0.008});
      this._playTone({f0: 1180, f1: 1760, dur: 0.12, attack: 0.002, gain: 0.092, type: 'sine', bus: this.uiBus, priority: 4, start: now + 0.014});
      this._playBuffer({buffer: this.steelBuf, rate: 1.32, dur: 0.095, gain: 0.075, bus: this.uiBus, priority: 3, start: now + 0.010});
    }
  }

  // --------------------------------------------------------------------------
  // Event Dispatcher (100% Backward Compatible + New Sound Engin 2.0 Events!)
  // --------------------------------------------------------------------------
  event(e, player) {
    if (!this.on || !this.ctx || !player) return;
    const now = this.ctx.currentTime;
    const a = e.actor;

    if (e.type === 'fire') {
      if (e.shafferCloaked && a && a.team !== player.team) return;
      this.playFire(e, player);
      return;
    }
    if (e.type === 'whiz') { this.playWhiz(e); return; }
    if (e.type === 'impact') { this.playImpact(e); return; }
    if (e.type === 'casing') { this.playCasing(e); return; }
    if (e.type === 'rdlock' && a === player) { this._playRdLock(!!e.d01, now, !!e.aa14); return; }
    if (e.type === 'scherplock' && a === player) { this._playScherpLock(e.mode, now); return; }
    if (e.type === 'd01' && a === player) { this._playD01Ping(now); return; }
    if (e.type === 'aa14' && a === player) { this._playAA14(e.state, now); return; }
    if (e.type === 'fermatLock') { this._playFermatLock(!!e.doubleBounce, now); return; }
    if (e.type === 'flir') { this._playFlirToggle(!!e.on, now); return; }
    if (e.type === 'chrono') { this._playChronoToggle(!!e.on, now); return; }
    if (e.type === 'ricochet' && e.point) { this._playRicochet(e, now); return; }
    if (e.type === 'penetrate' && e.point) { this._playPenetrate(e, now); return; }
    if (e.type === 'resonate' && e.point) { this._playContainerResonance(e, now, player); return; }
    if (e.type === 'smoke' && e.point) {
      const path = computeMultiBandAcousticPath(e.point, this.listenerPos);
      if (path.dist > 62) return;
      this.stats.systemCues++;
      const vol = clamp(path.directGain * 1.15, 0.03, 1.0);
      const start = now + path.delay;
      const lpf = path.cutoffHz;
      this._playBuffer({buffer: this.sub300Buf, rate: 1.15, dur: 0.11, gain: 0.16 * vol, lpf, pos: e.point, bus: this.foleyBus, priority: 3, start});
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.96, attack: 0.012, gain: 0.17 * vol, filterType: 'bandpass', f0: 3250, f1: 720, q: 1.4, lpf, pos: e.point, bus: this.foleyBus, reverbSend: clamp(0.25 + path.reverbBoost, 0.18, 0.72), priority: 2, start: start + 0.014});
      return;
    }
    if (e.type === 'reload' && a) {
      if ((a.shafferTimer || 0) > 0 && a.team !== player.team) return;
      const st = this.actorState.get(a.id);
      if (st) st.reloadStage = 1;
      const isP = a === player;
      const d = isP ? 0 : Math.hypot(a.x - this.listenerPos[0], a.z - this.listenerPos[2]);
      if (isP || d < 26) this._playReloadStage(a, isP, 1, now);
      return;
    }
    if (e.type === 'loaded') {
      if (a && (a.shafferTimer || 0) > 0 && a.team !== player.team) return;
      this._playLoadedBoltRack(a, a === player, now);
      return;
    }
    if (e.type === 'dry' && a === player) {
      this._playTone({f0: 2180, f1: 760, dur: 0.022, attack: 0.001, gain: 0.075, type: 'triangle', pan: 0.12, bus: this.foleyBus, priority: 3, start: now});
      this._playTone({f0: 192, f1: 108, dur: 0.032, attack: 0.001, gain: 0.070, type: 'square', pan: 0.10, bus: this.foleyBus, priority: 3, start: now});
      return;
    }
    if (e.type === 'hit') {
      if (a === player) this._playOutgoingHit(e, now);
      if (e.victim === player) this._playIncomingHit(e, player, now);
      return;
    }
    if (e.type === 'npcSignal') { this._playNpcSignal(e, player, now); return; }
    if (e.type === 'tanker') { this._playTankerActivate(e, player, now); return; }
    if (e.type === 'baizer' && a === player) {
      const hi = (e.amount || 20) >= 40;
      this._playTone({f0: hi ? 523.3 : 440, f1: hi ? 784 : 659.3, dur: 0.14, gain: 0.11, type: 'triangle', bus: this.uiBus, priority: 4, start: now});
      this._playTone({f0: hi ? 784 : 659.3, f1: hi ? 1174.7 : 987.8, dur: 0.22, gain: 0.095, type: 'sine', bus: this.uiBus, priority: 4, start: now + 0.06});
      if (hi) this._playTone({f0: 1174.7, f1: 1568, dur: 0.24, gain: 0.08, type: 'sine', bus: this.uiBus, priority: 4, start: now + 0.12});
      return;
    }
    if (e.type === 'skill_charge' && a === player) {
      [587.3, 880, 1174.7].forEach((f, idx) => {
        this._playTone({f0: f, f1: f * 1.03, dur: 0.14, gain: 0.095, type: 'triangle', bus: this.uiBus, priority: 4, start: now + idx * 0.055});
      });
      return;
    }
    if (e.type === 'skill' && a === player) {
      if (e.skill === 'shaffer') {
        this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.42, attack: 0.02, gain: 0.10, filterType: 'bandpass', f0: 2600, f1: 420, q: 2.2, bus: this.uiBus, priority: 4, start: now});
        this._playTone({f0: 740, f1: 240, dur: 0.34, gain: 0.10, type: 'sine', bus: this.uiBus, priority: 4, start: now});
        this._playTone({f0: 1480, f1: 980, dur: 0.24, gain: 0.06, type: 'triangle', bus: this.uiBus, priority: 4, start: now + 0.04});
      } else if (e.skill === 'heal') {
        [523.3, 659.3, 784, 1046.5].forEach((f, idx) => {
          this._playTone({f0: f, f1: f * 1.015, dur: 0.24, gain: 0.09, type: 'sine', bus: this.uiBus, priority: 4, start: now + idx * 0.05});
        });
      }
      return;
    }
    if (e.type === 'point' && a === player) {
      this._playTone({f0: 587.3, f1: 880, dur: 0.11, gain: 0.11, type: 'triangle', bus: this.uiBus, priority: 4, start: now});
      this._playTone({f0: 880, f1: 1174.7, dur: 0.17, gain: 0.10, type: 'sine', bus: this.uiBus, priority: 4, start: now + 0.08});
      return;
    }
    if (e.type === 'spawn' && a === player) {
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.06, gain: 0.04, filterType: 'bandpass', f0: 2200, f1: 1500, q: 3.0, bus: this.uiBus, priority: 3, start: now});
      this._playTone({f0: 640, f1: 960, dur: 0.09, gain: 0.065, type: 'sine', bus: this.uiBus, priority: 3, start: now + 0.02});
      return;
    }
    if (e.type === 'end' && e.winner != null) {
      const won = e.winner === player.team;
      const chord = won ? [440, 554.4, 659.3, 880] : [392, 349.2, 293.7];
      chord.forEach((f, idx) => {
        this._playTone({f0: f, f1: f * (won ? 1.005 : 0.98), dur: 0.38, gain: 0.088, type: 'triangle', bus: this.uiBus, priority: 4, start: now + idx * 0.07});
      });
    }
  }

  /**
   * NV2.6 Force Klatt Physical Vocal-Tract & Spatial Tactical Voice Synthesizer:
   *  - Ally radio callouts: PTT squelch open -> stress-modulated formant cadence -> PTT click
   *    (+ crisp 3-2-1 tactile countdown ticks for Synchronized Double-Swings!)
   *  - Enemy/Field vocalizations: 100% fair-play 3D spatialized with speed-of-sound delay,
   *    3-band UTD container diffraction, and harbor canyon reverb (Startle Gasp, Combat Shout,
   *    Deep-Breath Exhale, Bait-Trap bolt check!).
   */
  _playNpcSignal(e, player, now) {
    if (!this.ctx || !player) return;
    const isAlly = e.team === player.team;
    const kind = e.kind || 'CONTACT';
    const isRadio = !!(isAlly && e.isRadio);

    if (isRadio) {
      if (now - this.lastNpcRadioAt < 0.72) return;
      this.lastNpcRadioAt = now;
    } else {
      if (now - this.lastNpcSpatialVoiceAt < 0.58) return;
      this.lastNpcSpatialVoiceAt = now;
    }

    const plan = computeVocalFormantPlan(kind, e.prosody || {});
    const pos = e.pos || (e.actor ? eyeOf(e.actor) : null);

    if (isRadio) {
      this.stats.vocalCues++;
      const pan = pos ? clamp(this._computeStereoPan(pos) * 0.45, -0.55, 0.55) : 0;
      const urgent = kind === 'AMBUSH' || kind === 'MAN_DOWN' || kind === 'SWING_NOW' || kind === 'PLAYER_ORDER_SWING';

      // 1. Military Headset PTT Squelch Open
      this._playBuffer({
        buffer: this.whiteNoiseBuf, loop: true, dur: 0.026, attack: 0.002,
        gain: 0.036, filterType: 'bandpass', f0: 2150, f1: 1680, q: 2.4,
        pan, bus: this.uiBus, priority: 3, start: now
      });
      this._playTone({
        f0: urgent ? 1920 : 1620, f1: urgent ? 2280 : 1780, dur: 0.022, attack: 0.002,
        gain: 0.028, type: 'sine', pan, bus: this.uiBus, priority: 3, start: now + 0.004
      });

      // 2. Klatt Multi-Syllable Radio-Filtered Formant Prosody (320-3200Hz comms character!)
      let cursor = now + 0.034;
      for (const syl of plan.syllables) {
        const g = 0.056 * syl.gain;
        // Glottal F0 carrier through F1 chest resonance
        this._playTone({
          f0: syl.f0Start, f1: syl.f0End, dur: syl.dur, attack: 0.010,
          gain: g * (1 - syl.asp * 0.55), type: 'sawtooth',
          lpf: Math.min(2850, syl.f2 * 1.15), pan, bus: this.uiBus, priority: 3, start: cursor
        });
        // F1 & F2 vocal-tract formant aspiration noise sculpted cleanly for crisp human vocal timbre
        this._playBuffer({
          buffer: this.breathBuf, rate: clamp(syl.f1 / 520, 0.65, 1.85), dur: syl.dur, attack: 0.008,
          gain: g * (0.62 + syl.asp * 0.55), filterType: 'bandpass',
          f0: clamp(syl.f2, 750, 2950), f1: clamp(syl.f2 * 0.92, 680, 2800), q: 3.2,
          pan, bus: this.uiBus, priority: 3, start: cursor
        });
        cursor += syl.dur + syl.gap;
      }

      // 3. Subtle PTT Squelch Release Click
      this._playBuffer({
        buffer: this.whiteNoiseBuf, loop: true, dur: 0.018, attack: 0.001,
        gain: 0.024, filterType: 'bandpass', f0: 1950, f1: 1200, q: 2.2,
        pan, bus: this.uiBus, priority: 2, start: cursor + 0.010
      });

      // 4. Bait-Trap Subtle Bolt/Safety Check Cue
      if (kind === 'BAIT_READY' || kind === 'BAIT_PARTNER' || kind === 'PLAYER_ORDER_TRAP') {
        this._playTone({f0: 2640, f1: 1480, dur: 0.018, attack: 0.001, gain: 0.034, type: 'triangle', pan, bus: this.foleyBus, priority: 3, start: now + 0.04});
      }

      // 5. Synchronized Double-Swing 3-2-1 Tactile Radio Countdown!
      if ((kind === 'SWING_NOW' || kind === 'PLAYER_ORDER_SWING') && Number.isFinite(e.syncGoAt) && Number.isFinite(e.time)) {
        const rem = clamp(e.syncGoAt - e.time, 0.35, 1.10);
        const step = rem / 3;
        this._playTone({f0: 980, f1: 980, dur: 0.036, attack: 0.002, gain: 0.044, type: 'triangle', pan, bus: this.uiBus, priority: 4, start: now + 0.01});
        this._playTone({f0: 1175, f1: 1175, dur: 0.036, attack: 0.002, gain: 0.050, type: 'triangle', pan, bus: this.uiBus, priority: 4, start: now + step});
        this._playTone({f0: 1568, f1: 1760, dur: 0.072, attack: 0.002, gain: 0.068, type: 'sine', pan, bus: this.uiBus, priority: 4, start: now + step * 2});
      }
      return;
    }

    // 3D Spatialized Field Vocalization (Enemy shouts, Blind-Side Startle Gasps, Deep-Breath Sighs, Trap Clicks)
    if (!pos) return;
    const maxDist = kind === 'BREATH_RESET' ? 15 : kind === 'BAIT_READY' ? 18 : kind === 'STARTLE' ? 26 : 40;
    const path = computeMultiBandAcousticPath(pos, this.listenerPos);
    if (path.dist > maxDist) return;

    this.stats.vocalCues++;
    if (path.occluded) this.stats.occludedEvents++;
    const start = now + path.delay;
    const distScale = clamp(1 - path.dist / maxDist, 0.06, 1);
    const vol = clamp(path.directGain * (kind === 'BREATH_RESET' ? 0.55 : kind === 'STARTLE' ? 1.08 : 0.92) * (0.45 + distScale * 0.55), 0.025, 0.72);
    const lpf = Math.min(path.cutoffHz, kind === 'BREATH_RESET' ? 2800 : 4800);
    const rev = clamp(0.28 + path.reverbBoost + this.enclosure * 0.30, 0.18, 0.84);

    if (kind === 'STARTLE') {
      // Audible Blind-Side Startle Gasp + Kevlar Gear Jolt!
      const s0 = plan.syllables[0];
      this._playBuffer({
        buffer: this.breathBuf, rate: clamp(s0.f1 / 460, 1.0, 2.0), dur: s0.dur, attack: 0.005,
        gain: 0.16 * vol, filterType: 'bandpass', f0: 880, f1: 1960, q: 2.1,
        lpf, pos, bus: this.foleyBus, reverbSend: rev, priority: 3, start
      });
      this._playTone({
        f0: s0.f0Start, f1: s0.f0End, dur: s0.dur * 0.72, attack: 0.006,
        gain: 0.048 * vol, type: 'triangle', lpf, pos, bus: this.foleyBus, reverbSend: rev * 0.8, priority: 3, start: start + 0.012
      });
      // Quick armor/sling startle jolt rustle
      this._playBuffer({
        buffer: this.clothBuf, rate: 1.38, dur: 0.095, attack: 0.003,
        gain: 0.12 * vol, lpf, pos, bus: this.foleyBus, reverbSend: rev * 0.4, priority: 2, start: start + 0.006
      });
      return;
    }

    if (kind === 'BREATH_RESET') {
      // Restorative Somatic Exhale Sigh behind cover
      this._playBuffer({
        buffer: this.breathBuf, rate: 0.86, dur: 0.34, attack: 0.028,
        gain: 0.11 * vol, filterType: 'bandpass', f0: 1120, f1: 680, q: 1.6,
        lpf, pos, bus: this.foleyBus, reverbSend: rev * 0.5, priority: 1, start
      });
      return;
    }

    // Overheard Enemy Tactical Combat Shout (3D spatialized & container-diffracted!)
    let cursor = start;
    for (const syl of plan.syllables) {
      this._playTone({
        f0: syl.f0Start, f1: syl.f0End, dur: syl.dur, attack: 0.008,
        gain: 0.068 * syl.gain * vol, type: 'sawtooth',
        lpf: Math.min(lpf, syl.f2 * 1.1), pos, bus: this.foleyBus, reverbSend: rev, priority: 2, start: cursor
      });
      this._playBuffer({
        buffer: this.breathBuf, rate: clamp(syl.f1 / 520, 0.72, 1.75), dur: syl.dur, attack: 0.007,
        gain: 0.095 * syl.gain * vol, filterType: 'bandpass',
        f0: clamp(syl.f2, 700, 3100), f1: clamp(syl.f2 * 0.90, 620, 2900), q: 2.6,
        lpf, pos, bus: this.foleyBus, reverbSend: rev, priority: 2, start: cursor
      });
      cursor += syl.dur + syl.gap;
    }
    if (kind === 'BAIT_READY') {
      this._playTone({f0: 2520, f1: 1380, dur: 0.018, attack: 0.001, gain: 0.048 * vol, type: 'triangle', lpf, pos, bus: this.foleyBus, priority: 2, start: start + 0.05});
    }
  }

  _playOutgoingHit(e, now) {
    if (e.kill) {
      this._playBuffer({buffer: this.sub300Buf, rate: 0.95, dur: 0.14, gain: 0.22, bus: this.uiBus, priority: 4, start: now});
      this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.048, gain: 0.11, filterType: 'bandpass', f0: 4600, f1: 1800, q: 1.9, bus: this.uiBus, priority: 4, start: now});
      this._playTone({f0: 932, f1: 1397, dur: 0.085, gain: 0.145, type: 'triangle', bus: this.uiBus, priority: 4, start: now});
      this._playTone({f0: 1397, f1: 1864, dur: 0.165, gain: 0.135, type: 'sine', bus: this.uiBus, priority: 4, start: now + 0.052});
    } else if (e.baizerBreak || e.shieldBreak) {
      // 12-Shard Physical Glass/Energy Shield Shatter Cascade + Sub Discharge
      this._playBuffer({buffer: this.sub300Buf, rate: e.baizerBreak ? 0.78 : 0.88, dur: 0.16, gain: 0.20, bus: this.uiBus, priority: 4, start: now});
      this._playBuffer({buffer: this.glassBuf, rate: e.baizerBreak ? 1.18 : 1.04, dur: 0.31, gain: 0.28, bus: this.uiBus, priority: 4, start: now});
    } else if (e.baizer) {
      this._playTone({f0: 1480, f1: 920, dur: 0.068, gain: 0.125, type: 'triangle', bus: this.uiBus, priority: 4, start: now});
      this._playTone({f0: 2960, f1: 2040, dur: 0.050, gain: 0.072, type: 'sine', bus: this.uiBus, priority: 4, start: now + 0.004});
    } else if (e.shield) {
      this._playTone({f0: 1290, f1: 790, dur: 0.065, gain: 0.125, type: 'triangle', bus: this.uiBus, priority: 4, start: now});
      this._playTone({f0: 2580, f1: 1840, dur: 0.045, gain: 0.070, type: 'sine', bus: this.uiBus, priority: 4, start: now + 0.004});
    } else {
      this._playTone({f0: 820, f1: 520, dur: 0.052, gain: 0.128, type: 'triangle', bus: this.uiBus, priority: 4, start: now});
      this._playBuffer({buffer: this.sub300Buf, rate: 1.35, dur: 0.065, gain: 0.12, bus: this.uiBus, priority: 4, start: now});
    }
    // Bonus resonant shimmer for calculated bank-shot / wallbang hits!
    if (e.ricochet || e.ricocheted || e.wallbang || e.penetrated) {
      this._playTone({f0: (e.ricochet || e.ricocheted) ? 2093 : 1568, f1: (e.ricochet || e.ricocheted) ? 2637 : 2093, dur: 0.12, attack: 0.002, gain: 0.075, type: 'sine', bus: this.uiBus, priority: 4, start: now + 0.025});
    }
  }

  _playIncomingHit(e, player, now) {
    let srcPos = null;
    if (e.ricochet && e.dir) {
      srcPos = [
        this.listenerPos[0] - e.dir[0] * 10,
        this.listenerPos[1] - e.dir[1] * 10,
        this.listenerPos[2] - e.dir[2] * 10
      ];
    } else if (e.actor && e.actor !== player) {
      srcPos = eyeOf(e.actor);
    } else if (e.dir) {
      srcPos = [
        this.listenerPos[0] - e.dir[0] * 10,
        this.listenerPos[1] - e.dir[1] * 10,
        this.listenerPos[2] - e.dir[2] * 10
      ];
    }
    const pan = srcPos ? this._computeStereoPan(srcPos) : 0;
    this._duckAmbience(e.shieldBreak ? 0.88 : 0.48, now);

    if (e.shieldBreak) {
      this._triggerStapediusReflex(0.55);
      this._playBuffer({buffer: this.glassBuf, rate: 0.88, dur: 0.30, gain: 0.28, pan, bus: this.uiBus, priority: 4, start: now});
      this._playBuffer({buffer: this.sub300Buf, rate: 0.82, dur: 0.16, gain: 0.24, pan, bus: this.uiBus, priority: 4, start: now});
      this._playTone({f0: 3650, f1: 3480, dur: 0.48, attack: 0.02, gain: 0.024, type: 'sine', pan: 0, bus: this.uiBus, priority: 3, start: now + 0.04});
    } else {
      this._triggerStapediusReflex(0.22);
      this._playBuffer({buffer: this.sub300Buf, rate: 1.02, dur: 0.13, gain: 0.22, pan, bus: this.uiBus, priority: 4, start: now});
      this._playBuffer({buffer: this.pinkNoiseBuf, loop: true, dur: 0.095, gain: 0.16, filterType: 'lowpass', f0: 1550, f1: 280, pan, bus: this.uiBus, priority: 4, start: now});
    }
  }

  _playTankerActivate(e, player, now) {
    const isPlayer = e.actor === player;
    const tk = e.tanker;
    const pos = isPlayer ? null : (tk ? [tk.x, 1.6, tk.z] : null);
    const path = isPlayer || !pos ? {delay: 0, cutoffHz: 18800, directGain: 1} : computeMultiBandAcousticPath(pos, this.listenerPos);
    const tv = isPlayer ? 1.0 : clamp(path.directGain * 0.74, 0.04, 0.56);
    const start = now + path.delay;

    this._playBuffer({buffer: this.whiteNoiseBuf, loop: true, dur: 0.36, attack: 0.012, gain: 0.18 * tv, filterType: 'bandpass', f0: 4300, f1: 680, q: 1.5, lpf: path.cutoffHz, pos, bus: this.foleyBus, reverbSend: 0.34, priority: 3, start});
    this._playBuffer({buffer: this.sub300Buf, rate: 1.10, dur: 0.12, gain: 0.18 * tv, lpf: path.cutoffHz, pos, bus: this.foleyBus, priority: 3, start});
    for (let i = 0; i < 4; i++) {
      this._playBuffer({buffer: this.brassBuf, rate: 0.85 + i * 0.10, dur: 0.055, gain: 0.068 * tv, lpf: path.cutoffHz, pos, pan: isPlayer ? 0.18 - i * 0.08 : 0, bus: this.foleyBus, priority: 2, start: start + 0.05 + i * 0.036});
    }
    this._playTone({f0: 360, f1: 540, dur: 0.10, gain: 0.115 * tv, type: 'triangle', lpf: path.cutoffHz, pos, bus: isPlayer ? this.uiBus : this.foleyBus, priority: 3, start: start + 0.04});
    this._playTone({f0: 540, f1: 810, dur: 0.12, gain: 0.125 * tv, type: 'sine', lpf: path.cutoffHz, pos, bus: isPlayer ? this.uiBus : this.foleyBus, priority: 3, start: start + 0.12});
    this._playTone({f0: 810, f1: 1215, dur: 0.22, gain: 0.125 * tv, type: 'sine', lpf: path.cutoffHz, pos, bus: isPlayer ? this.uiBus : this.foleyBus, priority: 3, start: start + 0.21});
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
      controlRateHz: this.controlRateHz,
      subCrossoverHz: this.subCrossoverHz,
      catalogCount: SOUND_CATALOG_COUNT,
      mode: this.mode,
      on: this.on,
      volume: this.volume,
      state: this.ctx?.state || 'uninitialized',
      sampleRate: this.ctx?.sampleRate || 0,
      activeVoices: this.activeVoices,
      maxVoices: this.maxVoices,
      enclosure: Number(this.enclosure.toFixed(3)),
      overheadRatio: Number(this.overheadRatio.toFixed(3)),
      steelRatio: Number(this.steelRatio.toFixed(3)),
      stapediusDip: Number(this.stapediusDip.toFixed(3)),
      barrelHeat: Number(this.barrelHeat.toFixed(3)),
      duckLevel: Number(this.duckLevel.toFixed(3)),
      stats: {...this.stats},
      output: this.getOutputMetrics()
    };
  }
}

export {SoundEngin2 as SoundEngin};
