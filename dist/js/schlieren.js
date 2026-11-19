// SchlierenOptics 1.0 — Real-Time GPU Gladstone-Dale Refractive Shockwave & Thermal Mirage Engine.
//
// Physics Foundation:
//   - Gladstone-Dale law: air refractive index perturbation dn = K * drho across acoustic/supersonic
//     pressure fronts (explosions, shield shatters, Mach 1.05-1.89 projectiles, steel ricochets, tankers).
//   - Projects up to 8 live 3D expanding spherical/conical shockwaves into exact screen-space UV rings
//     (uShocks[8], uShockMeta[8]) and refracts the live HDR framebuffer BEFORE tone mapping with
//     Cauchy spectral chromatic dispersion (subtle realistic prism edge on intense shockfronts!).
//   - Also synthesizes a rising convective Schlieren thermal heat-haze plume above overheated gun barrels
//     (masked strictly to worldMask so weapons & HUD remain razor-sharp, with ZERO camera shake).

import {clamp} from './geometry.js';

export const SCHLIEREN_VERSION = 'SchlierenOptics 1.0';
export const MAX_SHOCKS = 8;

export const SCHLIEREN_COMPOSITE_GLSL = `
uniform int uSchlierenOn;
uniform int uShockCount;
uniform float uGunHeat;
uniform float uAspect;
uniform vec4 uShocks[8];     // xy=screenUV, z=screenRadius, w=refractiveStrength
uniform vec4 uShockMeta[8];  // x=ringThickness, y=chromaticDispersion, z=rimHighlight, w=kind

// Computes Gladstone-Dale refractive UV displacement + spectral dispersion + compression rim glint
void schlierenEvaluate(vec2 uv, float worldMask, float time, out vec2 uvOff, out vec2 dispOff, out float rimGlint){
  uvOff=vec2(0.);
  dispOff=vec2(0.);
  rimGlint=0.;
  if(uSchlierenOn!=1 || worldMask<.05)return;

  // 1. Expanding 3D-Projected Refractive Shockwave Lenses (Kills, Shield Breaks, Tankers, Ricochets, Mach Cracks)
  for(int i=0;i<8;i++){
    if(i>=uShockCount)break;
    vec4 s=uShocks[i];
    if(s.w<=.0002)continue;
    vec4 meta=uShockMeta[i];
    vec2 d=uv-s.xy;
    vec2 da=vec2(d.x*uAspect,d.y);
    float r=length(da);
    float rad=max(s.z,.006);
    float band=(r-rad)/max(meta.x,.008);
    if(abs(band)>3.0)continue;
    // Physical N-wave compression-front + rarefaction-trough pressure derivative!
    float env=exp(-band*band);
    float wave=-band*env*s.w;
    vec2 dir=r>1e-4?(da/r):vec2(0.);
    vec2 duv=vec2(dir.x/uAspect,dir.y)*wave;
    uvOff+=duv;
    dispOff+=duv*meta.y;
    rimGlint+=env*env*meta.z*s.w*8.5;
  }

  // 2. Convective Barrel Thermal Schlieren Mirage (shimmers background world above hot muzzle)
  if(uGunHeat>.20){
    float heatMask=smoothstep(.20,1.0,uGunHeat);
    // Localized rising convective plume right above right-hand first-person muzzle area
    vec2 hp=uv-vec2(.64,.36);
    float plume=exp(-(hp.x*hp.x*22.+hp.y*hp.y*12.))*smoothstep(.12,.30,uv.y)*smoothstep(.76,.46,uv.y);
    if(plume>.02){
      float w1=sin(uv.y*92.-time*24.+uv.x*28.);
      float w2=cos(uv.y*145.-time*33.-uv.x*41.);
      vec2 shimmer=vec2(w1*.65+w2*.35,w2*.45)*plume*heatMask*.0038;
      uvOff+=shimmer;
    }
  }
  uvOff=clamp(uvOff,vec2(-.042),vec2(.042))*worldMask;
  dispOff=clamp(dispOff,vec2(-.015),vec2(.015))*worldMask;
  rimGlint=clamp(rimGlint,0.,.36)*worldMask;
}
`;

const SHOCK_PRESETS = {
  kill: {r0: 0.45, r1: 8.8, dur: 0.46, strength: 0.028, width: 0.038, disp: 0.34, rim: 0.72, kind: 1},
  break: {r0: 0.35, r1: 6.2, dur: 0.38, strength: 0.024, width: 0.034, disp: 0.44, rim: 0.80, kind: 2},
  tanker: {r0: 0.60, r1: 8.2, dur: 0.56, strength: 0.022, width: 0.042, disp: 0.32, rim: 0.64, kind: 3},
  ricochet: {r0: 0.16, r1: 2.8, dur: 0.22, strength: 0.015, width: 0.024, disp: 0.30, rim: 0.55, kind: 4},
  penetrate: {r0: 0.18, r1: 2.5, dur: 0.22, strength: 0.013, width: 0.024, disp: 0.26, rim: 0.45, kind: 4},
  mach: {r0: 0.25, r1: 3.4, dur: 0.18, strength: 0.014, width: 0.024, disp: 0.34, rim: 0.48, kind: 5}
};

export class SchlierenOptics {
  constructor() {
    this.version = SCHLIEREN_VERSION;
    this.waves = [];
    this.seenEffects = new Set();
    this.uShocks = new Float32Array(MAX_SHOCKS * 4);
    this.uShockMeta = new Float32Array(MAX_SHOCKS * 4);
    this.activeCount = 0;
  }

  reset() {
    this.waves.length = 0;
    this.seenEffects.clear();
    this.uShocks.fill(0);
    this.uShockMeta.fill(0);
    this.activeCount = 0;
  }

  /** Manually emits a 3D physical pressure shockwave at world coordinates p. */
  emit(kind, p) {
    const cfg = SHOCK_PRESETS[kind];
    if (!cfg || !p) return;
    this.waves.push({
      kind,
      p: [p[0], p[1], p[2]],
      age: 0,
      dur: cfg.dur,
      r0: cfg.r0,
      r1: cfg.r1,
      strength: cfg.strength,
      width: cfg.width,
      disp: cfg.disp,
      rim: cfg.rim,
      kindId: cfg.kind
    });
    if (this.waves.length > 16) this.waves.shift();
  }

  /** Advances 3D pressure waves and ingests new high-energy events from Match.effects. */
  step(match, dt) {
    const stepDt = clamp(dt || 0.016, 0, 0.1);
    for (let i = this.waves.length - 1; i >= 0; i--) {
      this.waves[i].age += stepDt;
      if (this.waves[i].age >= this.waves[i].dur) this.waves.splice(i, 1);
    }
    if (!match) return;
    if (match.effects) {
      for (const e of match.effects) {
        if (!e.seed || this.seenEffects.has(e.seed)) continue;
        if (e.kind === 'kill' || e.kind === 'break' || e.kind === 'tanker' || e.kind === 'ricochet' || e.kind === 'penetrate') {
          this.seenEffects.add(e.seed);
          this.emit(e.kind, e.p);
        } else if (e.kind === 'muzzle' && (e.gun === 'MS10' || e.gun === 'RD40') && !e.human) {
          this.seenEffects.add(e.seed);
          this.emit('mach', e.p);
        }
      }
      if (this.seenEffects.size > 256) {
        const activeSeeds = new Set(match.effects.map(e => e.seed));
        for (const s of this.seenEffects) if (!activeSeeds.has(s)) this.seenEffects.delete(s);
      }
    }
  }

  /** Projects live 3D shockwaves into screen-space refractive lenses via exact VP matrix. */
  project(vp, camPos, fovDeg = 40.1, aspect = 16 / 9) {
    this.uShocks.fill(0);
    this.uShockMeta.fill(0);
    this.activeCount = 0;
    if (!vp || !this.waves.length) return 0;

    const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
    const list = [];
    for (const w of this.waves) {
      const x = w.p[0], y = w.p[1], z = w.p[2];
      // Column-major mat4 * vec4(x, y, z, 1)
      const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
      const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (cw <= 0.15) continue;
      const sx = (cx / cw) * 0.5 + 0.5;
      const sy = (cy / cw) * 0.5 + 0.5;
      if (sx < -0.45 || sx > 1.45 || sy < -0.45 || sy > 1.45) continue;

      const t = clamp(w.age / w.dur, 0, 1);
      // Blast radius grows fast initially (Sedov-Taylor t^0.65 law!) and pressure fades cleanly
      const worldR = w.r0 + (w.r1 - w.r0) * Math.pow(t, 0.65);
      const dist = Math.max(0.8, Math.hypot(x - camPos[0], y - camPos[1], z - camPos[2]));
      const screenR = clamp((worldR / (dist * tanHalf)) * 0.5, 0.012, 0.85);
      const fade = Math.pow(1 - t, 1.35) * clamp(14 / (dist + 6), 0.25, 1.25);
      const str = w.strength * fade;
      if (str < 0.0006) continue;
      list.push({sx, sy, screenR, str, width: w.width * (0.75 + t * 0.65), disp: w.disp, rim: w.rim, kindId: w.kindId});
    }

    list.sort((a, b) => b.str - a.str);
    const count = Math.min(MAX_SHOCKS, list.length);
    for (let i = 0; i < count; i++) {
      const s = list[i];
      const o = i * 4;
      this.uShocks[o] = s.sx;
      this.uShocks[o + 1] = s.sy;
      this.uShocks[o + 2] = s.screenR;
      this.uShocks[o + 3] = s.str;
      this.uShockMeta[o] = s.width;
      this.uShockMeta[o + 1] = s.disp;
      this.uShockMeta[o + 2] = s.rim;
      this.uShockMeta[o + 3] = s.kindId;
    }
    this.activeCount = count;
    return count;
  }
}
