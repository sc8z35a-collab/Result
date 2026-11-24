// ThermoFlux 1.0 — Real-Time Fourier Heat-Equation PDE Thermodynamics,
// Persistent Stefan-Boltzmann Thermal Footprints & Universal GPU Cyber-FLIR Visor.
//
// Physics & Architecture:
//   1. Fourier Heat Conduction + Newton Radiative Cooling PDE on a 32 x 96 Harbor Wharf Grid:
//      dT/dt = alpha * Laplacian(T) - lambda * (T - T_solar) + Q_dynamic
//      - Pre-bakes physical solar-baking equilibrium temperature from exact SUN raycasts against
//        all 41 containers & cranes: sunlit steel & dock bake warm (48 C), shaded canyons stay cool (14 C).
//   2. Persistent Combat & Movement Thermal Spoor:
//      - Running/sprinting actors stamp warm thermal boot-prints onto the dock asphalt (~10-14s fade),
//        allowing players and NV2.1 Spy Engine to thermally track enemies who fled around corners!
//      - Bullet impact craters, molten steel ricochets, wallbang exits, hot brass shell casings,
//        kills, shield breaks, and Supply Tanker engines deposit diffusing infrared heat blooms.
//   3. Universal GPU Blackbody FLIR Visor (T Key / Mobile FLIR Button) + Upgraded EVR1 Scope:
//      - Streams 32 x 96 RGBA8 thermal surface field (12 KB/frame) to Texture Unit 12.
//      - khdrCompositeFS reconstructs exact 3D world coordinates via uSceneDepth + uInvVP to paint
//        an authentic Ironbow Stefan-Boltzmann thermal image across the entire 3D harbor — revealing
//        glowing footprints, scorched craters, hot brass, and visible actors straight through dense
//        AeroVortex Navier-Stokes smoke (zero wallhack: containers still occlude depth!).

import {clamp, unit} from './geometry.js';
import {obstructionCoords} from './yard.js';

export const THERMOFLUX_VERSION = 'ThermoFlux 1.0';
export const THERMO_W = 32;
export const THERMO_H = 96;
const WORLD_X0 = -25, WORLD_W = 50;
const WORLD_Z0 = -100, WORLD_L = 200;
const INV_W = THERMO_W / WORLD_W;
const INV_L = THERMO_H / WORLD_L;
const SUN = unit([-.66, .28, -.70]);

export const THERMO_COMPOSITE_GLSL = `
uniform sampler2D uThermoTex;
uniform int uFlirOn;
uniform float uFlirBlend;
uniform vec4 uFlirActors[6]; // xyz = world center, w = thermal intensity (0 = dead/player)

// Authentic Ironbow Blackbody Stefan-Boltzmann FLIR Palette (cold indigo -> violet -> fiery orange -> white-hot)
vec3 ironbowPalette(float t){
  t=clamp(t,0.,1.);
  vec3 c0=vec3(.02,.04,.14); // 10 C deep cold shade
  vec3 c1=vec3(.13,.06,.34); // 20 C ambient asphalt
  vec3 c2=vec3(.48,.09,.44); // 32 C warm sunlit steel
  vec3 c3=vec3(.88,.30,.12); // 46 C fresh thermal footprint / warm engine
  vec3 c4=vec3(1.00,.78,.18);// 65 C hot bullet scorch / active actor torso
  vec3 c5=vec3(1.00,.99,.94);// 90+ C incandescent muzzle / blast core / head
  if(t<.22)return mix(c0,c1,t/.22);
  if(t<.45)return mix(c1,c2,(t-.22)/.23);
  if(t<.68)return mix(c2,c3,(t-.45)/.23);
  if(t<.86)return mix(c3,c4,(t-.68)/.18);
  return mix(c4,c5,(t-.86)/.14);
}

// Applies physical GPU Cyber-FLIR thermal imaging over reconstructed 3D world geometry (pierces smoke, respects solid cover!)
vec3 applyThermoFluxFLIR(vec2 uv, float worldMask, float actorMask, float depth, float time, vec3 hdrColor){
  if(uFlirBlend<=.005)return hdrColor;
  float lum=dot(max(hdrColor,vec3(0.)),vec3(.2126,.7152,.0722));
  if(worldMask<.2){
    float barrelHeat=clamp(uGunHeat*.68+.10,0.,1.);
    vec3 vmCol=ironbowPalette(clamp(.08+lum*.16+barrelHeat*.42,0.,.82));
    return mix(hdrColor,vmCol*.88,uFlirBlend);
  }
  if(depth>=.9994){
    vec3 skyIR=ironbowPalette(clamp(.02+lum*.07,0.,.16));
    return mix(hdrColor,skyIR*.85,uFlirBlend);
  }

  vec3 wPos=reconstructWorldPos(uv,depth);
  vec2 tuv=vec2((wPos.x+25.)*.02,(wPos.z+100.)*.005);
  bool inYard=all(greaterThanEqual(tuv,vec2(0.)))&&all(lessThanEqual(tuv,vec2(1.)));
  vec4 th=inYard?texture(uThermoTex,tuv):vec4(0.);
  float baseT=th.r;
  float spoor=th.g;
  float gradMag=th.b;

  float groundWeight=1.-smoothstep(.08,1.5,max(0.,wPos.y));
  float spoorT=clamp(spoor*(.34+.42*groundWeight)+gradMag*.14,0.,.54);
  float temp=clamp(baseT*.38+clamp(lum*.14,0.,.20)+spoorT,0.,.76);

  float actorGlow=0.;
  for(int i=0;i<6;i++){
    vec4 ac=uFlirActors[i];
    if(ac.w<=.01)continue;
    vec3 d=wPos-ac.xyz;
    float hDist=length(d.xz);
    float vDist=abs(d.y);
    if(hDist<.62 && vDist<1.12){
      float body=(1.-smoothstep(.15,.62,hDist))*(1.-smoothstep(.20,1.12,vDist))*actorMask;
      actorGlow=max(actorGlow,body*ac.w);
    }
  }
  temp=clamp(temp+actorGlow*.86,0.,1.05);

  float scan=.96+.04*sin(gl_FragCoord.y*3.14159+time*18.);
  vec3 ir=ironbowPalette(temp)*scan*.94;
  if(actorGlow>.18){
    ir+=vec3(1.0,.94,.72)*actorGlow*.45;
  }
  return mix(hdrColor,ir,uFlirBlend);
}
`;

export function worldToThermoCell(x, z) {
  const ix = clamp(Math.floor((x - WORLD_X0) * INV_W), 0, THERMO_W - 1);
  const iz = clamp(Math.floor((z - WORLD_Z0) * INV_L), 0, THERMO_H - 1);
  return [ix, iz];
}

export class ThermoFlux {
  constructor() {
    this.version = THERMOFLUX_VERSION;
    this.w = THERMO_W;
    this.h = THERMO_H;
    const N = THERMO_W * THERMO_H;
    this.n = N;

    this.baseTemp = new Float32Array(N);
    this.dynHeat = new Float32Array(N);
    this.dynBuf = new Float32Array(N);
    this.teamTag = new Int8Array(N).fill(-1);
    this.stampTime = new Float32Array(N).fill(-100);

    this.texData = new Uint8Array(N * 4);
    this.tex32 = new Uint32Array(this.texData.buffer);
    this._baseTex32 = new Uint32Array(N);
    this.gl = null;
    this.tex = null;
    this.stepAccum = 0;
    this._stateVersion = 1;
    this._uploadedVersion = 0;
    this._hasDynHeat = false;

    this.stats = {
      footprintsStamped: 0,
      thermalImpacts: 0,
      spyTrailsFollowed: 0,
      peakDynHeat: 0
    };

    this._bakeSolarBaseline();
    this._packTexture();
  }

  _bakeSolarBaseline() {
    const sx = SUN[0] * 38, sy = SUN[1] * 38, sz = SUN[2] * 38;
    const baseTex32 = this._baseTex32;
    for (let iz = 0; iz < this.h; iz++) {
      const wz = WORLD_Z0 + ((iz + 0.5) / this.h) * WORLD_L;
      const row = iz * this.w;
      for (let ix = 0; ix < this.w; ix++) {
        const wx = WORLD_X0 + ((ix + 0.5) / this.w) * WORLD_W;
        const sunlit = obstructionCoords(wx, 0.35, wz, wx + sx, 0.35 + sy, wz + sz) > 0.99;
        const seaCool = clamp((wx + 25) * (1 / 14), 0, 1) * 0.05;
        const bt = (sunlit ? 0.36 : 0.14) + seaCool;
        const i = row + ix;
        this.baseTemp[i] = bt;
        const r = clamp((bt * 255 + 0.5) | 0, 0, 255);
        baseTex32[i] = (r | 0xff000000) >>> 0;
      }
    }
  }

  reset() {
    this.dynHeat.fill(0);
    this.dynBuf.fill(0);
    this.teamTag.fill(-1);
    this.stampTime.fill(-100);
    this.stepAccum = 0;
    this._hasDynHeat = false;
    this.stats = {footprintsStamped: 0, thermalImpacts: 0, spyTrailsFollowed: 0, peakDynHeat: 0};
    this._stateVersion++;
    this._packTexture();
  }

  initGL(gl) {
    this.gl = gl;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.w, this.h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, this.texData);
    this._uploadedVersion = this._stateVersion;
  }

  /** Stamps a warm thermal boot-print on the dock surface as an actor walks or sprints! */
  stampFootprint(x, z, team, time, intensity = 0.42) {
    const ix = clamp(Math.floor((x - WORLD_X0) * INV_W), 0, this.w - 1);
    const iz = clamp(Math.floor((z - WORLD_Z0) * INV_L), 0, this.h - 1);
    const idx = iz * this.w + ix;
    this.dynHeat[idx] = Math.min(1.4, Math.max(this.dynHeat[idx], intensity) + intensity * 0.35);
    this.teamTag[idx] = team;
    this.stampTime[idx] = time;
    this.stats.footprintsStamped++;
    this._hasDynHeat = true;
    this._stateVersion++;
  }

  /** Deposits a diffusing combat thermal bloom (impact crater, ricochet streak, hot brass, blast). */
  depositHeat(x, z, amount = 0.65, radius = 1) {
    const W = this.w, H = this.h;
    const cx = clamp(Math.floor((x - WORLD_X0) * INV_W), 0, W - 1);
    const cz = clamp(Math.floor((z - WORLD_Z0) * INV_L), 0, H - 1);
    for (let dz = -radius; dz <= radius; dz++) {
      const nz = cz + dz;
      if (nz < 0 || nz >= H) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= W) continue;
        const w = Math.exp(-(dx * dx + dz * dz) * 0.85);
        const idx = nz * W + nx;
        this.dynHeat[idx] = Math.min(1.5, this.dynHeat[idx] + amount * w);
      }
    }
    this.stats.thermalImpacts++;
    this._hasDynHeat = true;
    this._stateVersion++;
  }

  /** Samples physical normalized surface temperature (0..1.5) & fresh spoor at (x, z). */
  sampleTemp(x, z) {
    const ix = clamp(Math.floor((x - WORLD_X0) * INV_W), 0, this.w - 1);
    const iz = clamp(Math.floor((z - WORLD_Z0) * INV_L), 0, this.h - 1);
    const idx = iz * this.w + ix;
    const base = this.baseTemp[idx];
    const dyn = this.dynHeat[idx];
    return {
      total: base + dyn,
      base,
      dyn,
      team: this.teamTag[idx],
      age: this.stampTime[idx]
    };
  }

  /**
   * Fair-play thermal spoor tracker for NV2.1 Spy Engine:
   * Inspects visible ground cells within `radius` around observer for the freshest warm enemy footprints!
   */
  findEnemySpoor(observerPos, enemyTeam, now, radius = 14) {
    if (!this._hasDynHeat) return null;
    const W = this.w, H = this.h;
    const cx = clamp(Math.floor((observerPos[0] - WORLD_X0) * INV_W), 0, W - 1);
    const cz = clamp(Math.floor((observerPos[2] - WORLD_Z0) * INV_L), 0, H - 1);
    const rx = Math.ceil(radius * INV_W);
    const rz = Math.ceil(radius * INV_L);
    const r2Max = radius * radius;
    const ox = observerPos[0], oy = observerPos[1], oz = observerPos[2];
    let best = null, bestScore = 0.14;
    for (let dz = -rz; dz <= rz; dz++) {
      const nz = cz + dz;
      if (nz < 0 || nz >= H) continue;
      const wz = WORLD_Z0 + ((nz + 0.5) / H) * WORLD_L;
      const ddz = wz - oz;
      for (let dx = -rx; dx <= rx; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= W) continue;
        const idx = nz * W + nx;
        if (this.teamTag[idx] !== enemyTeam) continue;
        const age = now - this.stampTime[idx];
        if (age < 0 || age > 11.5) continue;
        const h = this.dynHeat[idx];
        if (h < 0.14) continue;
        const wx = WORLD_X0 + ((nx + 0.5) / W) * WORLD_W;
        const ddx = wx - ox;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < 2.25 || d2 > r2Max) continue;
        if (obstructionCoords(ox, oy, oz, wx, 0.25, wz) < 0.96) continue;
        const score = h * Math.exp(-age * 0.18);
        if (score > bestScore) {
          bestScore = score;
          best = {x: wx, z: wz, heat: h, age};
        }
      }
    }
    if (best) this.stats.spyTrailsFollowed++;
    return best;
  }

  /** Runs one Fourier Heat Conduction + Newton Cooling PDE step (12Hz from Match.step). */
  stepHeat(dt, tankers = null) {
    const W = this.w, H = this.h;
    const stepDt = clamp(dt, 0.01, 0.12);
    if (tankers && tankers.length) {
      for (let ti = 0; ti < tankers.length; ti++) {
        const tk = tankers[ti];
        const ix = clamp(Math.floor((tk.x - WORLD_X0) * INV_W), 0, W - 1);
        const iz = clamp(Math.floor((tk.z - WORLD_Z0) * INV_L), 0, H - 1);
        const idx = iz * W + ix;
        const target = tk.cooldown <= 0 ? 0.42 : 0.65;
        if (this.dynHeat[idx] < target) this.dynHeat[idx] = target;
      }
      this._hasDynHeat = true;
    }
    if (!this._hasDynHeat) return;

    const alpha = clamp(0.42 * stepDt, 0, 0.18);
    const cool = Math.exp(-0.115 * stepDt);
    const src = this.dynHeat, dst = this.dynBuf, tag = this.teamTag;
    let peak = 0;
    for (let iz = 0; iz < H; iz++) {
      const row = iz * W;
      const uOff = iz > 0 ? -W : 0;
      const dOff = iz < H - 1 ? W : 0;
      for (let ix = 0; ix < W; ix++) {
        const i = row + ix;
        const c = src[i];
        const l = ix > 0 ? src[i - 1] : c;
        const r = ix < W - 1 ? src[i + 1] : c;
        const u = src[i + uOff];
        const d = src[i + dOff];
        const next = (c + alpha * (l + r + u + d - 4 * c)) * cool;
        if (next < 0.004) {
          dst[i] = 0;
          tag[i] = -1;
        } else {
          dst[i] = next;
          if (next > peak) peak = next;
          if (next < 0.03) tag[i] = -1;
        }
      }
    }
    const prev = this.dynHeat;
    this.dynHeat = dst;
    this.dynBuf = prev;
    this.stats.peakDynHeat = peak;
    this._hasDynHeat = peak > 0;
    this._stateVersion++;
  }

  tick(dt, tankers = null) {
    this.stepAccum += dt;
    if (this.stepAccum >= 1 / 12) {
      const s = Math.min(0.12, this.stepAccum);
      this.stepAccum = 0;
      this.stepHeat(s, tankers);
    }
  }

  _packTexture() {
    const out32 = this.tex32, base32 = this._baseTex32;
    if (!this._hasDynHeat) {
      out32.set(base32);
      return;
    }
    const W = this.w, H = this.h, base = this.baseTemp, dyn = this.dynHeat;
    for (let iz = 0; iz < H; iz++) {
      const row = iz * W;
      const uOff = iz > 0 ? -W : 0;
      const dOff = iz < H - 1 ? W : 0;
      for (let ix = 0; ix < W; ix++) {
        const i = row + ix;
        const d = dyn[i];
        const dR = ix < W - 1 ? dyn[i + 1] : d;
        const dL = ix > 0 ? dyn[i - 1] : d;
        const dD = dyn[i + dOff];
        const dU = dyn[i + uOff];
        if (d === 0 && dR === 0 && dL === 0 && dD === 0 && dU === 0) {
          out32[i] = base32[i];
          continue;
        }
        const gx = dR - dL, gz = dD - dU;
        const t = base[i] + d * 0.72;
        const grad = (gx === 0 && gz === 0) ? 0 : Math.sqrt(gx * gx + gz * gz) * 459;
        let r = (t * 255 + 0.5) | 0;
        let g = (d * 255 + 0.5) | 0;
        let b = (grad + 0.5) | 0;
        if (r < 0) r = 0; else if (r > 255) r = 255;
        if (g < 0) g = 0; else if (g > 255) g = 255;
        if (b < 0) b = 0; else if (b > 255) b = 255;
        out32[i] = (r | (g << 8) | (b << 16) | 0xff000000) >>> 0;
      }
    }
  }

  /** Dirty-gated upload of 32x96 RGBA8 thermal surface field to GPU (only uploads when 12Hz PDE or footprint updates!). */
  uploadToGPU() {
    if (this._uploadedVersion === this._stateVersion) return;
    this._packTexture();
    if (this.gl && this.tex) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.tex);
      this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.texData);
    }
    this._uploadedVersion = this._stateVersion;
  }
}
