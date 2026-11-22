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
import {obstruction} from './yard.js';

export const THERMOFLUX_VERSION = 'ThermoFlux 1.0';
export const THERMO_W = 32;
export const THERMO_H = 96;
const WORLD_X0 = -25, WORLD_W = 50;
const WORLD_Z0 = -100, WORLD_L = 200;
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
  // Keep first-person weapon cleanly styled as cool dark-indigo metallic silhouette + warm glowing barrel
  if(worldMask<.2){
    float barrelHeat=clamp(uGunHeat*.68+.10,0.,1.);
    vec3 vmCol=ironbowPalette(clamp(.08+lum*.16+barrelHeat*.42,0.,.82));
    return mix(hdrColor,vmCol*.88,uFlirBlend);
  }
  // Sky / distant harbor horizon stays frigid dark-indigo
  if(depth>=.9994){
    vec3 skyIR=ironbowPalette(clamp(.02+lum*.07,0.,.16));
    return mix(hdrColor,skyIR*.85,uFlirBlend);
  }

  vec3 wPos=reconstructWorldPos(uv,depth);
  vec2 tuv=vec2((wPos.x+25.)/50.,(wPos.z+100.)/200.);
  bool inYard=all(greaterThanEqual(tuv,vec2(0.)))&&all(lessThanEqual(tuv,vec2(1.)));
  vec4 th=inYard?texture(uThermoTex,tuv):vec4(0.);
  float baseT=th.r;       // Solar-baked + diffused surface temperature
  float spoor=th.g;       // Dynamic footprints, hot craters, ricochet streaks, hot brass!
  float gradMag=th.b;     // Thermal gradient contour edge

  // Ground/low surface receives fiery orange-amber footprint spoor (capped below white-hot so actors blaze brightest!)
  float groundWeight=1.-smoothstep(.08,1.5,max(0.,wPos.y));
  float spoorT=clamp(spoor*(.34+.42*groundWeight)+gradMag*.14,0.,.54);
  float temp=clamp(baseT*.38+clamp(lum*.14,0.,.20)+spoorT,0.,.76);

  // Highlight visible live actor bodies (37 C human bio-signature + warm gun heat) strictly on depth-visible pixels!
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

  // Subtle authentic micro-bolometer horizontal scanline + crisp military-grade FLIR contrast
  float scan=.96+.04*sin(gl_FragCoord.y*3.14159+time*18.);
  vec3 ir=ironbowPalette(temp)*scan*.94;
  if(actorGlow>.18){
    ir+=vec3(1.0,.94,.72)*actorGlow*.45;
  }
  return mix(hdrColor,ir,uFlirBlend);
}
`;

export function worldToThermoCell(x, z) {
  const ix = clamp(Math.floor(((x - WORLD_X0) / WORLD_W) * THERMO_W), 0, THERMO_W - 1);
  const iz = clamp(Math.floor(((z - WORLD_Z0) / WORLD_L) * THERMO_H), 0, THERMO_H - 1);
  return [ix, iz];
}

export class ThermoFlux {
  constructor() {
    this.version = THERMOFLUX_VERSION;
    this.w = THERMO_W;
    this.h = THERMO_H;
    const N = THERMO_W * THERMO_H;
    this.n = N;

    this.baseTemp = new Float32Array(N);  // Static sunlit vs shaded equilibrium (0.14..0.52)
    this.dynHeat = new Float32Array(N);   // Dynamic footprints, craters, brass, blast heat (0..1.5)
    this.dynBuf = new Float32Array(N);
    this.teamTag = new Int8Array(N).fill(-1); // Team ID of freshest thermal footprint at cell (-1 = none/neutral)
    this.stampTime = new Float32Array(N).fill(-100); // Match time when cell was last heated by an actor

    this.texData = new Uint8Array(N * 4);
    this.gl = null;
    this.tex = null;
    this.stepAccum = 0;

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
    for (let iz = 0; iz < this.h; iz++) {
      const wz = WORLD_Z0 + ((iz + 0.5) / this.h) * WORLD_L;
      for (let ix = 0; ix < this.w; ix++) {
        const wx = WORLD_X0 + ((ix + 0.5) / this.w) * WORLD_W;
        const sunEnd = [wx + SUN[0] * 38, 0.35 + SUN[1] * 38, wz + SUN[2] * 38];
        const sunlit = obstruction([wx, 0.35, wz], sunEnd) > 0.99;
        // Marine air cools the western water edge slightly; sunlit asphalt & steel bake warmly
        const seaCool = clamp((wx + 25) / 14, 0, 1) * 0.05;
        this.baseTemp[iz * this.w + ix] = (sunlit ? 0.36 : 0.14) + seaCool;
      }
    }
  }

  reset() {
    this.dynHeat.fill(0);
    this.dynBuf.fill(0);
    this.teamTag.fill(-1);
    this.stampTime.fill(-100);
    this.stepAccum = 0;
    this.stats = {footprintsStamped: 0, thermalImpacts: 0, spyTrailsFollowed: 0, peakDynHeat: 0};
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
  }

  /** Stamps a warm thermal boot-print on the dock surface as an actor walks or sprints! */
  stampFootprint(x, z, team, time, intensity = 0.42) {
    const [ix, iz] = worldToThermoCell(x, z);
    const idx = iz * this.w + ix;
    this.dynHeat[idx] = Math.min(1.4, Math.max(this.dynHeat[idx], intensity) + intensity * 0.35);
    this.teamTag[idx] = team;
    this.stampTime[idx] = time;
    this.stats.footprintsStamped++;
  }

  /** Deposits a diffusing combat thermal bloom (impact crater, ricochet streak, hot brass, blast). */
  depositHeat(x, z, amount = 0.65, radius = 1) {
    const [cx, cz] = worldToThermoCell(x, z);
    const W = this.w, H = this.h;
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
  }

  /** Samples physical normalized surface temperature (0..1.5) & fresh spoor at (x, z). */
  sampleTemp(x, z) {
    const [ix, iz] = worldToThermoCell(x, z);
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
    const [cx, cz] = worldToThermoCell(observerPos[0], observerPos[2]);
    const rx = Math.ceil(radius / (WORLD_W / this.w));
    const rz = Math.ceil(radius / (WORLD_L / this.h));
    let best = null, bestScore = 0.14;
    for (let dz = -rz; dz <= rz; dz++) {
      const nz = cz + dz;
      if (nz < 0 || nz >= this.h) continue;
      for (let dx = -rx; dx <= rx; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= this.w) continue;
        const idx = nz * this.w + nx;
        if (this.teamTag[idx] !== enemyTeam) continue;
        const age = now - this.stampTime[idx];
        if (age < 0 || age > 11.5) continue;
        const h = this.dynHeat[idx];
        if (h < 0.14) continue;
        const wx = WORLD_X0 + ((nx + 0.5) / this.w) * WORLD_W;
        const wz = WORLD_Z0 + ((nz + 0.5) / this.h) * WORLD_L;
        const d = Math.hypot(wx - observerPos[0], wz - observerPos[2]);
        if (d < 1.5 || d > radius) continue;
        // Strict fair play: observer must actually see the floor cell!
        if (obstruction(observerPos, [wx, 0.25, wz]) < 0.96) continue;
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
    // Warm steady engine heat signature under the 3 Supply Tankers
    if (tankers) {
      for (const tk of tankers) {
        const [ix, iz] = worldToThermoCell(tk.x, tk.z);
        const idx = iz * W + ix;
        this.dynHeat[idx] = Math.max(this.dynHeat[idx], tk.cooldown <= 0 ? 0.42 : 0.65);
      }
    }
    const alpha = clamp(0.42 * stepDt, 0, 0.18); // Fourier thermal diffusivity
    const cool = Math.exp(-0.115 * stepDt);      // Newton radiative cooling (~12s footprint fade)
    const src = this.dynHeat, dst = this.dynBuf;
    let peak = 0;
    for (let iz = 0; iz < H; iz++) {
      for (let ix = 0; ix < W; ix++) {
        const i = iz * W + ix;
        const c = src[i];
        const l = ix > 0 ? src[i - 1] : c;
        const r = ix < W - 1 ? src[i + 1] : c;
        const u = iz > 0 ? src[i - W] : c;
        const d = iz < H - 1 ? src[i + W] : c;
        const lap = (l + r + u + d - 4 * c);
        const next = (c + alpha * lap) * cool;
        dst[i] = next < 0.004 ? 0 : next;
        if (dst[i] > peak) peak = dst[i];
        if (dst[i] < 0.03) this.teamTag[i] = -1;
      }
    }
    this.dynHeat.set(dst);
    this.stats.peakDynHeat = peak;
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
    const W = this.w, H = this.h, out = this.texData, base = this.baseTemp, dyn = this.dynHeat;
    for (let iz = 0; iz < H; iz++) {
      for (let ix = 0; ix < W; ix++) {
        const i = iz * W + ix;
        const o = i * 4;
        const t = base[i] + dyn[i] * 0.72;
        const gx = (ix < W - 1 ? dyn[i + 1] : dyn[i]) - (ix > 0 ? dyn[i - 1] : dyn[i]);
        const gz = (iz < H - 1 ? dyn[i + W] : dyn[i]) - (iz > 0 ? dyn[i - W] : dyn[i]);
        const grad = Math.hypot(gx, gz) * 1.8;
        out[o] = clamp(Math.round(t * 255), 0, 255);
        out[o + 1] = clamp(Math.round(dyn[i] * 255), 0, 255);
        out[o + 2] = clamp(Math.round(grad * 255), 0, 255);
        out[o + 3] = 255;
      }
    }
  }

  uploadToGPU() {
    this._packTexture();
    if (this.gl && this.tex) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.tex);
      this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.texData);
    }
  }
}
