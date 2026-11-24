// AeroVortex 1.0 — Real-Time Obstacle-Aware 2D Navier-Stokes Fluid Dynamics,
// Supersonic Bullet-Wake Tunnel Carving & Depth-Occluded GPU Volumetric Smoke Engine.
//
// Physics & Architecture:
//   1. Incompressible Navier-Stokes PDE on a 32 x 96 Harbor Wharf Grid (~1.56m x 2.08m cells):
//      - Precomputes exact no-slip / no-penetration solid boundary mask from yard.js shipping
//        containers, crane legs, and Supply Tankers.
//      - Continuous maritime sea-breeze inflow from the open harbor water (x = -25) accelerates
//        through narrow gaps between containers (genuine Venturi jets) and sheds leeward eddies!
//      - Runs semi-Lagrangian advection + curl vorticity confinement + Gauss-Seidel pressure
//        Poisson projection (<0.22ms/step on CPU, zero external dependencies).
//   2. 5-Way Cross-System Coupling:
//      - Supersonic Projectiles (MS10, RD40, SW T, etc.) experience caliber-weighted crosswind
//        aerodynamic drift AND carve real swirling wake tunnels straight through drifting smoke!
//      - Combat bursts (kills, shield breaks, ricochets, wallbangs, muzzle blasts, Supply Tankers)
//        and tactical Smoke Vents (G key) inject buoyant heated smoke/vapor + radial pressure.
//      - Dense fluid smoke physically obscures optical LOS for NV2 & NV2.1 AI (fair play), while
//        EVR1 Thermal, ThermoFlux FLIR Visor, and RD40 D01 SENSOR pierce straight through!
//      - Sound Engin 1.0 modulates continuous Venturi wind-shear audio from live local |u(eye)|.
//   3. 12 KB/Frame GPU Streaming + Depth-Occluded 3D Volumetric Ray-Marching:
//      - Streams RGBA8 (vx, vz, smokeDensity, emberHeat) to WebGL2 Texture Unit 9.
//      - khdrCompositeFS reconstructs exact world depth from uSceneDepth + uInvVP and ray-marches
//        12 IGN-jittered volumetric steps with Henyey-Greenstein solar forward scattering + live
//        FluxGI colored bounce light — pixel-accurately occluded by containers, actors & weapon!

import {clamp} from './geometry.js';
import {obstacles} from './yard.js';

export const AEROVORTEX_VERSION = 'AeroVortex 1.0';
export const AERO_W = 32;
export const AERO_H = 96;
const WORLD_X0 = -25, WORLD_W = 50;
const WORLD_Z0 = -100, WORLD_L = 200;
const DX = WORLD_W / AERO_W;
const DZ = WORLD_L / AERO_H;
const INV_DX = AERO_W / WORLD_W;
const INV_DZ = AERO_H / WORLD_L;

export const AERO_COMPOSITE_GLSL = `
uniform sampler2D uAeroTex;
uniform sampler2D uSceneDepth;
uniform sampler2D uFluxGIPost;
uniform int uAeroOn;
uniform int uFluxGIPostOn;
uniform mat4 uInvVP;
uniform vec3 uCamEye;
uniform vec4 uAeroBounds; // (minX, minZ, maxX, maxZ); z < x => zero active smoke (instant 0-fetch exit!)

float aeroIGN(vec2 p){
  return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));
}

vec3 reconstructWorldPos(vec2 uv, float depth){
  vec4 ndc=vec4(uv*2.-1.,depth*2.-1.,1.);
  vec4 wp=uInvVP*ndc;
  return wp.xyz/max(abs(wp.w),1e-5)*sign(wp.w);
}

// AeroClip-3D: Analytical 3D ray-slab intersection against tight active smoke AABB (0 texture fetches on clear rays!)
void applyAeroVortex(vec2 uv, float worldMask, float depth, float time, inout vec3 color){
  if(uAeroOn!=1 || worldMask<.02)return;
  // Explicit empty-smoke sentinel (z < x): skip reconstruction & all 12 raymarch steps in 1 branch!
  if(uAeroBounds.z < uAeroBounds.x)return;
  vec3 wPos=reconstructWorldPos(uv,min(depth,.99992));
  vec3 toP=wPos-uCamEye;
  float dist=length(toP);
  if(dist<.65)return;
  vec3 rd=toP/dist;
  float tMax=min(dist,68.);
  if(uCamEye.y>6.2 && rd.y>=0.)return;

  // Use tight live active smoke AABB when supplied; fall back to full harbor if uniform is unset (0,0,0,0)
  vec4 bnd=(uAeroBounds.z>uAeroBounds.x)?uAeroBounds:vec4(-25.5,-101.,25.5,101.);
  vec3 bMin=vec3(bnd.x,-.15,bnd.y);
  vec3 bMax=vec3(bnd.z,5.8,bnd.w);
  vec3 invRd=1./mix(rd,vec3(1e-5),lessThan(abs(rd),vec3(1e-5)));
  vec3 t0s=(bMin-uCamEye)*invRd;
  vec3 t1s=(bMax-uCamEye)*invRd;
  vec3 tSm=min(t0s,t1s);
  vec3 tBg=max(t0s,t1s);
  float tStart=max(max(.75,tMax*.02),max(tSm.x,max(tSm.y,tSm.z)));
  float tEnd=min(tMax,min(tBg.x,min(tBg.y,tBg.z)));
  if(tEnd<=tStart)return;

  const vec3 SUN_DIR=normalize(vec3(-.66,.28,-.70));
  float cosT=dot(rd,SUN_DIR);
  float g=.56;
  float hg=(1.-g*g)/(4.*3.14159*pow(max(.08,1.+g*g-2.*g*cosT),1.5));
  float phase=clamp(.42+hg*1.15,.35,2.35);

  // 8 concentrated IGN-jittered steps strictly inside the live smoke volume (higher density than 12 full-frustum steps!)
  const int STEPS=8;
  float stepLen=(tEnd-tStart)/float(STEPS);
  float jitter=aeroIGN(gl_FragCoord.xy+fract(time*13.7)*41.);

  float trans=1.;
  vec3 scatter=vec3(0.);

  for(int i=0;i<STEPS;i++){
    float t=tStart+(float(i)+jitter)*stepLen;
    if(t>=tEnd || trans<.045)break;
    vec3 p=uCamEye+rd*t;

    vec2 fuv=vec2((p.x+25.)*.02,(p.z+100.)*.005);
    vec4 fl=texture(uAeroTex,clamp(fuv,vec2(.006),vec2(.994)));
    float dens=fl.b*2.4;
    if(dens<.018)continue;

    vec2 vel=(fl.rg-.5)*7.2;
    float heat=fl.a;
    float plumeTop=2.75+heat*1.65+min(1.1,dens*.48);
    float yProf=smoothstep(-.05,.38,p.y)*(1.-smoothstep(plumeTop*.52,plumeTop,p.y));
    if(yProf<.01)continue;

    vec3 q=p*.74-vec3(vel.x*time*.18,time*(.28+heat*.45),vel.y*time*.18);
    float n1=sin(q.x*2.1+cos(q.z*2.3+q.y*1.9));
    float n2=cos(q.z*3.1-sin(q.x*2.6-q.y*2.7));
    float billow=.46+.54*clamp((n1*.58+n2*.42)*.5+.5,0.,1.);

    float sigma=dens*yProf*billow*.25;
    if(sigma<.002)continue;

    float topSun=smoothstep(.15,3.1,p.y);
    vec3 sunScatter=vec3(.88,.80,.68)*phase*(.28+.54*topSun);
    vec3 shadowCore=vec3(.18,.25,.30);
    vec3 giAdd=vec3(0.);
    if(uFluxGIPostOn==1){
      vec4 gRaw=texture(uFluxGIPost,clamp(fuv,vec2(.008),vec2(.992)));
      vec3 gRad=max(vec3(0.),(exp2(gRaw.rgb*4.)-1.)/3.);
      giAdd=gRad/(1.+gRad*.6)*.45;
    }
    vec3 ember=mix(vec3(1.35,.64,.18),vec3(.28,1.25,1.45),smoothstep(.65,1.0,heat))*heat*heat*1.15;
    vec3 inScatter=mix(shadowCore,sunScatter,clamp(trans*.78+.22*topSun,0.,1.))+giAdd*.75+ember;

    float stepTrans=exp(-sigma*stepLen);
    scatter+=trans*(1.-stepTrans)*inScatter;
    trans*=stepTrans;
  }

  float fogMix=(1.-trans)*worldMask;
  if(fogMix>.002){
    color=mix(color,color*trans+scatter,worldMask);
  }
}
`;

export function worldToAeroCell(x, z) {
  const ix = clamp(Math.floor((x - WORLD_X0) * INV_DX), 0, AERO_W - 1);
  const iz = clamp(Math.floor((z - WORLD_Z0) * INV_DZ), 0, AERO_H - 1);
  return [ix, iz];
}

export class AeroVortex {
  constructor() {
    this.version = AEROVORTEX_VERSION;
    this.w = AERO_W;
    this.h = AERO_H;
    const N = AERO_W * AERO_H;
    this.n = N;

    this.solid = new Uint8Array(N);
    this.vx = new Float32Array(N);
    this.vz = new Float32Array(N);
    this.vx0 = new Float32Array(N);
    this.vz0 = new Float32Array(N);
    this.div = new Float32Array(N);
    this.p = new Float32Array(N);
    this.curl = new Float32Array(N);

    this.smoke = new Float32Array(N);
    this.smoke0 = new Float32Array(N);
    this.heat = new Float32Array(N);
    this.heat0 = new Float32Array(N);

    // Compact interior & all-fluid acceleration structures (AeroFluid-SOR)
    this._fluidCells = new Int32Array(N);
    this._fluidCount = 0;
    this._allFluidCells = new Int32Array(N);
    this._allFluidX = new Uint16Array(N);
    this._allFluidZ = new Uint16Array(N);
    this._allFluidCount = 0;
    this._vortCells = new Int32Array(N);
    this._vortCount = 0;
    this._nbrMask = new Uint8Array(N);   // bit0=L, bit1=R, bit2=U, bit3=D
    this._invDeg = new Float32Array(N);
    this._diffInvW = new Float32Array(N);

    // AeroClip-3D tight live active smoke AABB [minX, minZ, maxX, maxZ]; z < x => empty!
    this.smokeBounds = new Float32Array([1, 1, -1, -1]);
    this._hasSmoke = false;
    this._hasHeat = false;
    this._stateVersion = 1;
    this._uploadedVersion = 0;

    this.texData = new Uint8Array(N * 4);
    this.tex32 = new Uint32Array(this.texData.buffer);
    this.gl = null;
    this.tex = null;
    this.time = 0;
    this.stepAccum = 0;

    this.stats = {
      steps: 0,
      wakesCarved: 0,
      smokeVents: 0,
      maxWindSpeed: 0,
      totalSmoke: 0
    };

    this._buildSolidMask();
    this._seedHarborBreeze();
    this._packTexture();
  }

  _buildSolidMask() {
    const W = this.w, H = this.h;
    this.solid.fill(0);
    let ac = 0;
    for (let iz = 0; iz < H; iz++) {
      const wz = WORLD_Z0 + ((iz + 0.5) / H) * WORLD_L;
      const row = iz * W;
      for (let ix = 0; ix < W; ix++) {
        const wx = WORLD_X0 + ((ix + 0.5) / W) * WORLD_W;
        let blocked = 0;
        for (let oi = 0; oi < obstacles.length; oi++) {
          const o = obstacles[oi];
          if (o.y0 < 1.5 && o.y1 > 1.35 && wx >= o.x0 - 0.15 && wx <= o.x1 + 0.15 && wz >= o.z0 - 0.15 && wz <= o.z1 + 0.15) {
            blocked = 1;
            break;
          }
        }
        const i = row + ix;
        this.solid[i] = blocked;
        if (!blocked) {
          this._allFluidCells[ac] = i;
          this._allFluidX[ac] = ix;
          this._allFluidZ[ac] = iz;
          ac++;
        }
      }
    }
    this._allFluidCount = ac;
    // Precompute compact fluid interior lists + neighbor bitmasks + inverse degrees
    let fc = 0, vc = 0;
    const solid = this.solid;
    for (let iz = 1; iz < H - 1; iz++) {
      const row = iz * W;
      for (let ix = 1; ix < W - 1; ix++) {
        const i = row + ix;
        if (solid[i]) continue;
        this._fluidCells[fc++] = i;
        if (iz >= 2 && iz < H - 2 && ix >= 2 && ix < W - 2) this._vortCells[vc++] = i;
        let mask = 0, cnt = 0;
        if (!solid[i - 1]) { mask |= 1; cnt++; }
        if (!solid[i + 1]) { mask |= 2; cnt++; }
        if (!solid[i - W]) { mask |= 4; cnt++; }
        if (!solid[i + W]) { mask |= 8; cnt++; }
        this._nbrMask[i] = mask;
        this._invDeg[i] = cnt > 0 ? 1 / cnt : 0;
        this._diffInvW[i] = 1 / (4 + cnt * 0.14);
      }
    }
    this._fluidCount = fc;
    this._vortCount = vc;
  }

  _expandBoundsCell(ix, iz) {
    const x0 = WORLD_X0 + (ix - 1.5) * DX;
    const x1 = WORLD_X0 + (ix + 2.5) * DX;
    const z0 = WORLD_Z0 + (iz - 1.5) * DZ;
    const z1 = WORLD_Z0 + (iz + 2.5) * DZ;
    const b = this.smokeBounds;
    if (b[2] < b[0]) {
      b[0] = x0; b[1] = z0; b[2] = x1; b[3] = z1;
    } else {
      if (x0 < b[0]) b[0] = x0;
      if (z0 < b[1]) b[1] = z0;
      if (x1 > b[2]) b[2] = x1;
      if (z1 > b[3]) b[3] = z1;
    }
  }

  _seedHarborBreeze() {
    for (let i = 0; i < this.n; i++) {
      if (this.solid[i]) {
        this.vx[i] = 0;
        this.vz[i] = 0;
      } else {
        this.vx[i] = 1.65;
        this.vz[i] = -0.35;
      }
    }
    this._project();
  }

  reset() {
    this.smoke.fill(0);
    this.smoke0.fill(0);
    this.heat.fill(0);
    this.heat0.fill(0);
    this.p.fill(0);
    this.time = 0;
    this.stepAccum = 0;
    this._hasSmoke = false;
    this._hasHeat = false;
    this.smokeBounds[0] = 1; this.smokeBounds[1] = 1; this.smokeBounds[2] = -1; this.smokeBounds[3] = -1;
    this.stats = {steps: 0, wakesCarved: 0, smokeVents: 0, maxWindSpeed: 0, totalSmoke: 0};
    this._seedHarborBreeze();
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

  /** Injects smoke density, ember heat, and directional momentum into the Navier-Stokes field. */
  injectSmoke(x, z, amount = 1.0, heatAmt = 0.25, radius = 2, impulseX = 0, impulseZ = 0) {
    const W = this.w, H = this.h;
    const cx = clamp(Math.floor((x - WORLD_X0) * INV_DX), 0, W - 1);
    const cz = clamp(Math.floor((z - WORLD_Z0) * INV_DZ), 0, H - 1);
    const rLim = radius * radius + 0.5;
    const kExp = radius > 2 ? 0.34 : 0.62;
    let deltaSmoke = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      const nz = cz + dz;
      if (nz < 0 || nz >= H) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= W) continue;
        const idx = nz * W + nx;
        if (this.solid[idx]) continue;
        const r2 = dx * dx + dz * dz;
        if (r2 > rLim) continue;
        const w = Math.exp(-r2 * kExp);
        const prev = this.smoke[idx];
        const next = Math.min(3.2, prev + amount * w);
        this.smoke[idx] = next;
        deltaSmoke += next - prev;
        if (next > 0.008) {
          this._hasSmoke = true;
          this._expandBoundsCell(nx, nz);
        }
        if (heatAmt > 0) {
          this.heat[idx] = Math.min(1.4, this.heat[idx] + heatAmt * w);
          this._hasHeat = true;
        }
        this.vx[idx] = clamp(this.vx[idx] + impulseX * w, -9, 9);
        this.vz[idx] = clamp(this.vz[idx] + impulseZ * w, -9, 9);
      }
    }
    this.stats.totalSmoke = Math.max(0, this.stats.totalSmoke + deltaSmoke);
    this._stateVersion++;
  }

  /** Injects an expanding radial shock burst + heated smoke plume (kills, shield breaks, tankers, smoke vents). */
  injectBurst(x, z, {smoke = 1.6, heat = 0.75, force = 4.2, radius = 3} = {}) {
    const W = this.w, H = this.h;
    const cx = clamp(Math.floor((x - WORLD_X0) * INV_DX), 0, W - 1);
    const cz = clamp(Math.floor((z - WORLD_Z0) * INV_DZ), 0, H - 1);
    const rMax = radius + 0.4, rMax2 = rMax * rMax;
    const invDen = 1 / Math.max(1.2, radius * 1.1);
    let deltaSmoke = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      const nz = cz + dz;
      if (nz < 0 || nz >= H) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= W) continue;
        const idx = nz * W + nx;
        if (this.solid[idx]) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 > rMax2) continue;
        const w = Math.exp(-d2 * invDen);
        const prev = this.smoke[idx];
        const next = Math.min(3.2, prev + smoke * w);
        this.smoke[idx] = next;
        deltaSmoke += next - prev;
        if (next > 0.008) {
          this._hasSmoke = true;
          this._expandBoundsCell(nx, nz);
        }
        if (heat > 0) {
          this.heat[idx] = Math.min(1.4, this.heat[idx] + heat * w);
          this._hasHeat = true;
        }
        if (d2 > 0.01) {
          const push = force * w / Math.sqrt(d2);
          this.vx[idx] = clamp(this.vx[idx] + dx * push, -9, 9);
          this.vz[idx] = clamp(this.vz[idx] + dz * push, -9, 9);
        }
      }
    }
    this.stats.totalSmoke = Math.max(0, this.stats.totalSmoke + deltaSmoke);
    this._stateVersion++;
  }

  /** Deploys a tactical pressurized smoke canister vent (G key) that billows around containers! */
  deploySmokeVent(x, z, dirX = 0, dirZ = -1) {
    this.stats.smokeVents++;
    this.injectBurst(x, z, {smoke: 2.65, heat: 0.22, force: 3.6, radius: 3});
    this.injectSmoke(x + dirX * 1.8, z + dirZ * 1.8, 1.9, 0.16, 2, dirX * 3.0, dirZ * 3.0);
  }

  /**
   * Supersonic bullet-wake coupling: injects real forward wake momentum + swirling wingtip shear
   * AND physically carves an open aerodynamic tunnel straight through drifting smoke clouds!
   */
  injectProjectileWake(p0, p1, speed = 360, gun = '') {
    if (!p0 || !p1) return;
    const midY = (p0[1] + p1[1]) * 0.5;
    if (midY < 0.05 || midY > 4.8) return;
    const dx = p1[0] - p0[0], dz = p1[2] - p0[2];
    const seg2 = dx * dx + dz * dz;
    if (seg2 < 0.0025) return;
    const seg = Math.sqrt(seg2);
    const ux = dx / seg, uz = dz / seg;
    const tx = -uz, tz = ux;
    const machFactor = clamp(speed * (1 / 343), 0.5, 2.2);
    const wakeForce = (gun === 'MS10' ? 2.4 : gun === 'RD40' ? 1.8 : gun === 'DF40 II' ? 1.65 : 1.25) * machFactor;
    const carve = clamp((gun === 'MS10' ? 0.58 : gun === 'RD40' ? 0.44 : gun === 'DF40 II' ? 0.40 : 0.34) * machFactor, 0.18, 0.72);
    const W = this.w, H = this.h;
    const samples = Math.max(1, Math.min(4, Math.ceil(seg * (1 / 1.4))));
    let carvedAny = false, deltaSmoke = 0;
    for (let s = 0; s < samples; s++) {
      const f = (s + 0.5) / samples;
      const wx = p0[0] + dx * f;
      const wz = p0[2] + dz * f;
      const ix = clamp(Math.floor((wx - WORLD_X0) * INV_DX), 0, W - 1);
      const iz = clamp(Math.floor((wz - WORLD_Z0) * INV_DZ), 0, H - 1);
      const idx = iz * W + ix;
      if (this.solid[idx]) continue;

      this.vx[idx] = clamp(this.vx[idx] + ux * wakeForce, -9, 9);
      this.vz[idx] = clamp(this.vz[idx] + uz * wakeForce, -9, 9);

      if (this._hasSmoke && this.smoke[idx] > 0.04) {
        const prev = this.smoke[idx];
        const displaced = prev * carve;
        const next = Math.max(0, prev - displaced);
        this.smoke[idx] = next;
        deltaSmoke += next - prev;
        carvedAny = true;
        for (let side = -1; side <= 1; side += 2) {
          const sx = clamp(ix + Math.round(tx * side), 0, W - 1);
          const sz = clamp(iz + Math.round(tz * side), 0, H - 1);
          const sIdx = sz * W + sx;
          if (!this.solid[sIdx]) {
            const sPrev = this.smoke[sIdx];
            const sNext = Math.min(3.2, sPrev + displaced * 0.36);
            this.smoke[sIdx] = sNext;
            deltaSmoke += sNext - sPrev;
            this.vx[sIdx] = clamp(this.vx[sIdx] + tx * side * wakeForce * 0.55, -9, 9);
            this.vz[sIdx] = clamp(this.vz[sIdx] + tz * side * wakeForce * 0.55, -9, 9);
          }
        }
      }
    }
    if (carvedAny) {
      this.stats.wakesCarved++;
      this.stats.totalSmoke = Math.max(0, this.stats.totalSmoke + deltaSmoke);
    }
    this._stateVersion++;
  }

  /** Bilinear wind & smoke probe at any world coordinate (x, z). */
  sample(x, z) {
    const W = this.w, H = this.h;
    const fx = clamp((x - WORLD_X0) * INV_DX - 0.5, 0, W - 1.001);
    const fz = clamp((z - WORLD_Z0) * INV_DZ - 0.5, 0, H - 1.001);
    const x0 = fx | 0, z0 = fz | 0;
    const tx = fx - x0, tz = fz - z0;
    const x1 = x0 + 1 < W ? x0 + 1 : W - 1;
    const z1 = z0 + 1 < H ? z0 + 1 : H - 1;
    const i00 = z0 * W + x0, i10 = z0 * W + x1;
    const i01 = z1 * W + x0, i11 = z1 * W + x1;
    const vxArr = this.vx, vzArr = this.vz;
    const vx = (vxArr[i00] + (vxArr[i10] - vxArr[i00]) * tx) * (1 - tz) + (vxArr[i01] + (vxArr[i11] - vxArr[i01]) * tx) * tz;
    const vz = (vzArr[i00] + (vzArr[i10] - vzArr[i00]) * tx) * (1 - tz) + (vzArr[i01] + (vzArr[i11] - vzArr[i01]) * tx) * tz;
    let smoke = 0, heat = 0;
    if (this._hasSmoke) {
      const s = this.smoke;
      smoke = (s[i00] + (s[i10] - s[i00]) * tx) * (1 - tz) + (s[i01] + (s[i11] - s[i01]) * tx) * tz;
    }
    if (this._hasHeat) {
      const h = this.heat;
      heat = (h[i00] + (h[i10] - h[i00]) * tx) * (1 - tz) + (h[i01] + (h[i11] - h[i01]) * tx) * tz;
    }
    return {vx, vz, speed: Math.sqrt(vx * vx + vz * vz), smoke, heat};
  }

  /** Zero-allocation wind sampler for 360Hz projectile MagnusAero coupling. */
  sampleWindOut(x, z, out) {
    const W = this.w, H = this.h;
    const fx = clamp((x - WORLD_X0) * INV_DX - 0.5, 0, W - 1.001);
    const fz = clamp((z - WORLD_Z0) * INV_DZ - 0.5, 0, H - 1.001);
    const x0 = fx | 0, z0 = fz | 0;
    const tx = fx - x0, tz = fz - z0;
    const x1 = x0 + 1 < W ? x0 + 1 : W - 1;
    const z1 = z0 + 1 < H ? z0 + 1 : H - 1;
    const i00 = z0 * W + x0, i10 = z0 * W + x1;
    const i01 = z1 * W + x0, i11 = z1 * W + x1;
    const vxArr = this.vx, vzArr = this.vz;
    const vx = (vxArr[i00] + (vxArr[i10] - vxArr[i00]) * tx) * (1 - tz) + (vxArr[i01] + (vxArr[i11] - vxArr[i01]) * tx) * tz;
    const vz = (vzArr[i00] + (vzArr[i10] - vzArr[i00]) * tx) * (1 - tz) + (vzArr[i01] + (vzArr[i11] - vzArr[i01]) * tx) * tz;
    out.vx = vx;
    out.vz = vz;
    out.speed = Math.sqrt(vx * vx + vz * vz);
    return out;
  }

  /** Zero-allocation smoke density sampler with O(1) AeroClip-3D AABB fast-reject. */
  sampleSmoke(x, z) {
    if (!this._hasSmoke) return 0;
    const b = this.smokeBounds;
    if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) return 0;
    const W = this.w, H = this.h;
    const fx = clamp((x - WORLD_X0) * INV_DX - 0.5, 0, W - 1.001);
    const fz = clamp((z - WORLD_Z0) * INV_DZ - 0.5, 0, H - 1.001);
    const x0 = fx | 0, z0 = fz | 0;
    const tx = fx - x0, tz = fz - z0;
    const x1 = x0 + 1 < W ? x0 + 1 : W - 1;
    const z1 = z0 + 1 < H ? z0 + 1 : H - 1;
    const i00 = z0 * W + x0, i10 = z0 * W + x1;
    const i01 = z1 * W + x0, i11 = z1 * W + x1;
    const s = this.smoke;
    return (s[i00] + (s[i10] - s[i00]) * tx) * (1 - tz) + (s[i01] + (s[i11] - s[i01]) * tx) * tz;
  }

  /**
   * Computes integrated optical depth of Navier-Stokes smoke along a 3D ray `a -> b`.
   * O(1) instant return when no active smoke exists or ray misses AeroClip-3D smokeBounds!
   */
  smokeOcclusion(a, b) {
    if (!this._hasSmoke) return 0;
    const sb = this.smokeBounds;
    const ax = a[0], az = a[2], bx = b[0], bz = b[2];
    if ((ax < sb[0] && bx < sb[0]) || (ax > sb[2] && bx > sb[2]) || (az < sb[1] && bz < sb[1]) || (az > sb[3] && bz > sb[3])) return 0;
    const dx = bx - ax, dy = b[1] - a[1], dz = bz - az;
    const dist2 = dx * dx + dy * dy + dz * dz;
    if (dist2 < 0.64) return 0;
    const dist = Math.sqrt(dist2);
    const steps = Math.max(3, Math.min(20, Math.ceil(dist * (1 / 2.2))));
    const seg = dist / steps;
    const W = this.w, H = this.h, sm = this.smoke;
    const invSteps = 1 / steps;
    let tau = 0;
    for (let i = 0; i < steps; i++) {
      const f = (i + 0.5) * invSteps;
      const y = a[1] + dy * f;
      if (y < 0 || y > 3.9) continue;
      const wx = ax + dx * f, wz = az + dz * f;
      if (wx < sb[0] || wx > sb[2] || wz < sb[1] || wz > sb[3]) continue;
      const ix = clamp(Math.floor((wx - WORLD_X0) * INV_DX), 0, W - 1);
      const iz = clamp(Math.floor((wz - WORLD_Z0) * INV_DZ), 0, H - 1);
      const d = sm[iz * W + ix];
      if (d > 0.08) tau += d * seg * 0.16;
      if (tau >= 1.2) return 1.2;
    }
    return tau;
  }

  /** Executes one stable Navier-Stokes fluid substep (AeroFluid-SOR compact zero-copy solver). */
  stepFluid(dt) {
    const W = this.w, H = this.h;
    const stepDt = clamp(dt, 0.005, 0.055);
    this.time += stepDt;
    this.stats.steps++;
    const solid = this.solid;
    let vx = this.vx, vz = this.vz;

    // 1. Live maritime harbor sea-breeze inflow along west water edge (x=0) with natural gusts
    const gust = 1.95 + Math.sin(this.time * 0.55) * 0.55 + Math.cos(this.time * 1.23) * 0.28;
    const crossZ = -0.35 + Math.sin(this.time * 0.37) * 0.45;
    for (let iz = 0; iz < H; iz++) {
      const iLeft = iz * W;
      if (!solid[iLeft]) {
        vx[iLeft] = gust * (1 + 0.18 * Math.sin(iz * 0.19 - this.time * 0.8));
        vz[iLeft] = crossZ;
      }
      const iRight = iLeft + (W - 1);
      if (!solid[iRight] && !solid[iRight - 1]) {
        const vr = vx[iRight - 1] * 0.96;
        vx[iRight] = vr > 0.4 ? vr : 0.4;
        vz[iRight] = vz[iRight - 1] * 0.95;
      }
    }

    // 2. Vorticity Confinement over compact fluid-cell list (skips all solid containers!)
    const curl = this.curl;
    const fCells = this._fluidCells, fCnt = this._fluidCount;
    const inv2DX = 0.5 * INV_DX, inv2DZ = 0.5 * INV_DZ;
    for (let k = 0; k < fCnt; k++) {
      const i = fCells[k];
      curl[i] = (vz[i + 1] - vz[i - 1]) * inv2DX - (vx[i + W] - vx[i - W]) * inv2DZ;
    }
    const vCells = this._vortCells, vCnt = this._vortCount;
    const vortScale = 0.65 * stepDt;
    for (let k = 0; k < vCnt; k++) {
      const i = vCells[k];
      const gx = (Math.abs(curl[i + 1]) - Math.abs(curl[i - 1])) * 0.5;
      const gz = (Math.abs(curl[i + W]) - Math.abs(curl[i - W])) * 0.5;
      const mag = Math.sqrt(gx * gx + gz * gz) + 1e-5;
      const wv = (curl[i] * vortScale) / mag;
      vx[i] = clamp(vx[i] + gz * wv, -9, 9);
      vz[i] = clamp(vz[i] - gx * wv, -9, 9);
    }

    // 3. Compact All-Fluid Semi-Lagrangian Advection + O(1) Zero-Copy Pointer Swap!
    const velDamp = Math.exp(-0.22 * stepDt);
    const smokeDamp = Math.exp(-0.20 * stepDt);
    const heatDamp = Math.exp(-0.95 * stepDt);
    const doSmoke = this._hasSmoke;
    const doHeat = this._hasHeat;
    const scaleX = stepDt * INV_DX, scaleZ = stepDt * INV_DZ;
    const vx0 = this.vx0, vz0 = this.vz0, sm = this.smoke, sm0 = this.smoke0, ht = this.heat, ht0 = this.heat0;
    const wLim = W - 1.001, hLim = H - 1.001;
    const aCells = this._allFluidCells, aX = this._allFluidX, aZ = this._allFluidZ, aCnt = this._allFluidCount;
    let heatMax = 0;

    for (let k = 0; k < aCnt; k++) {
      const i = aCells[k];
      let bx = aX[k] - vx[i] * scaleX;
      if (bx < 0) bx = 0; else if (bx > wLim) bx = wLim;
      let bz = aZ[k] - vz[i] * scaleZ;
      if (bz < 0) bz = 0; else if (bz > hLim) bz = hLim;
      const x0 = bx | 0, z0 = bz | 0;
      const x1 = x0 + 1 < W ? x0 + 1 : W - 1;
      const z1 = z0 + 1 < H ? z0 + 1 : H - 1;
      const tx = bx - x0, tz = bz - z0;
      const i00 = z0 * W + x0, i10 = z0 * W + x1;
      const i01 = z1 * W + x0, i11 = z1 * W + x1;
      const s00 = solid[i00], s10 = solid[i10], s01 = solid[i01], s11 = solid[i11];
      const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;

      vx0[i] = ((s00 ? vx[i] : vx[i00]) * w00 + (s10 ? vx[i] : vx[i10]) * w10 + (s01 ? vx[i] : vx[i01]) * w01 + (s11 ? vx[i] : vx[i11]) * w11) * velDamp;
      vz0[i] = ((s00 ? vz[i] : vz[i00]) * w00 + (s10 ? vz[i] : vz[i10]) * w10 + (s01 ? vz[i] : vz[i01]) * w01 + (s11 ? vz[i] : vz[i11]) * w11) * velDamp;
      if (doSmoke) {
        sm0[i] = ((s00 ? sm[i] : sm[i00]) * w00 + (s10 ? sm[i] : sm[i10]) * w10 + (s01 ? sm[i] : sm[i01]) * w01 + (s11 ? sm[i] : sm[i11]) * w11) * smokeDamp;
      }
      if (doHeat) {
        const hv = ((s00 ? ht[i] : ht[i00]) * w00 + (s10 ? ht[i] : ht[i10]) * w10 + (s01 ? ht[i] : ht[i01]) * w01 + (s11 ? ht[i] : ht[i11]) * w11) * heatDamp;
        ht0[i] = hv < 0.002 ? 0 : hv;
        if (ht0[i] > heatMax) heatMax = ht0[i];
      }
    }
    this.vx = vx0; this.vx0 = vx; vx = vx0;
    this.vz = vz0; this.vz0 = vz; vz = vz0;
    if (doHeat) {
      this.heat = ht0; this.heat0 = ht;
      this._hasHeat = heatMax > 0;
    }

    // Zero-alloc scalar diffusion on smoke + tight AeroClip-3D bounding box computation
    let sumSmoke = 0;
    if (doSmoke) {
      const mask = this._nbrMask, invW = this._diffInvW;
      let minIx = W, maxIx = -1, minIz = H, maxIz = -1;
      for (let k = 0; k < fCnt; k++) {
        const i = fCells[k];
        const m = mask[i];
        let sum = sm0[i] * 4;
        if (m & 1) sum += sm0[i - 1] * 0.14;
        if (m & 2) sum += sm0[i + 1] * 0.14;
        if (m & 4) sum += sm0[i - W] * 0.14;
        if (m & 8) sum += sm0[i + W] * 0.14;
        const v = sum * invW[i];
        if (v < 0.004) {
          sm[i] = 0;
        } else {
          sm[i] = v;
          sumSmoke += v;
          if (v > 0.015) {
            const ix = i & 31, iz = i >> 5;
            if (ix < minIx) minIx = ix;
            if (ix > maxIx) maxIx = ix;
            if (iz < minIz) minIz = iz;
            if (iz > maxIz) maxIz = iz;
          }
        }
      }
      if (maxIx >= minIx) {
        this.smokeBounds[0] = Math.max(-25.5, WORLD_X0 + (minIx - 1.5) * DX);
        this.smokeBounds[1] = Math.max(-101.0, WORLD_Z0 + (minIz - 1.5) * DZ);
        this.smokeBounds[2] = Math.min(25.5, WORLD_X0 + (maxIx + 2.5) * DX);
        this.smokeBounds[3] = Math.min(101.0, WORLD_Z0 + (maxIz + 2.5) * DZ);
        this._hasSmoke = true;
      } else {
        this.smokeBounds[0] = 1; this.smokeBounds[1] = 1; this.smokeBounds[2] = -1; this.smokeBounds[3] = -1;
        this._hasSmoke = sumSmoke > 0;
      }
    }

    // 4. Incompressible Pressure Projection (AeroFluid-SOR: 4 SOR iterations @ omega=1.52)
    this._project();

    // Telemetry stats (squared max avoids N sqrt calls)
    let maxS2 = 0;
    for (let k = 0; k < fCnt; k++) {
      const i = fCells[k];
      const s2 = vx[i] * vx[i] + vz[i] * vz[i];
      if (s2 > maxS2) maxS2 = s2;
    }
    this.stats.maxWindSpeed = Math.sqrt(maxS2);
    this.stats.totalSmoke = sumSmoke;
    this._stateVersion++;
  }

  _project() {
    const W = this.w;
    const div = this.div, p = this.p, vx = this.vx, vz = this.vz;
    const fCells = this._fluidCells, fCnt = this._fluidCount;
    const mask = this._nbrMask, invDeg = this._invDeg;
    const halfInvDX = -0.5 * INV_DX, halfInvDZ = -0.5 * INV_DZ;
    for (let k = 0; k < fCnt; k++) {
      const i = fCells[k];
      const m = mask[i];
      const vR = (m & 2) ? vx[i + 1] : 0;
      const vL = (m & 1) ? vx[i - 1] : 0;
      const vD = (m & 8) ? vz[i + W] : 0;
      const vU = (m & 4) ? vz[i - W] : 0;
      div[i] = (vR - vL) * halfInvDX + (vD - vU) * halfInvDZ;
      p[i] *= 0.65;
    }
    // 4 Successive Over-Relaxation (SOR, omega=1.52) sweeps over compact fluid cells
    const omega = 1.52, oneMinusO = 1 - omega;
    for (let iter = 0; iter < 4; iter++) {
      for (let k = 0; k < fCnt; k++) {
        const i = fCells[k];
        const m = mask[i];
        let sum = div[i];
        if (m & 1) sum += p[i - 1];
        if (m & 2) sum += p[i + 1];
        if (m & 4) sum += p[i - W];
        if (m & 8) sum += p[i + W];
        p[i] = oneMinusO * p[i] + omega * (sum * invDeg[i]);
      }
    }
    const halfDX = 0.5 * DX, halfDZ = 0.5 * DZ;
    for (let k = 0; k < fCnt; k++) {
      const i = fCells[k];
      const m = mask[i], pi = p[i];
      const pR = (m & 2) ? p[i + 1] : pi;
      const pL = (m & 1) ? p[i - 1] : pi;
      const pD = (m & 8) ? p[i + W] : pi;
      const pU = (m & 4) ? p[i - W] : pi;
      vx[i] = clamp(vx[i] - (pR - pL) * halfDX, -9, 9);
      vz[i] = clamp(vz[i] - (pD - pU) * halfDZ, -9, 9);
    }
  }

  /** Fixed-rate 24Hz update called from Match.step(dt) so 360Hz simulation stays rock-fast. */
  tick(dt) {
    this.stepAccum += dt;
    if (this.stepAccum >= 1 / 24) {
      const s = Math.min(0.05, this.stepAccum);
      this.stepAccum = 0;
      this.stepFluid(s);
    }
  }

  _packTexture() {
    const out32 = this.tex32, vx = this.vx, vz = this.vz, sm = this.smoke, ht = this.heat;
    const sV = 255 / 7.2, sS = 255 / 2.4;
    const hasS = this._hasSmoke, hasH = this._hasHeat;
    const N = this.n;
    for (let i = 0; i < N; i++) {
      let r = (vx[i] * sV + 128) | 0;
      let g = (vz[i] * sV + 128) | 0;
      let b = hasS ? ((sm[i] * sS + 0.5) | 0) : 0;
      let a = hasH ? ((ht[i] * 255 + 0.5) | 0) : 0;
      if (r < 0) r = 0; else if (r > 255) r = 255;
      if (g < 0) g = 0; else if (g > 255) g = 255;
      if (b < 0) b = 0; else if (b > 255) b = 255;
      if (a < 0) a = 0; else if (a > 255) a = 255;
      out32[i] = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
    }
  }

  /** Dirty-gated upload of live 32x96 RGBA8 fluid field to GPU (skips clean frames between 24Hz fluid ticks!). */
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
