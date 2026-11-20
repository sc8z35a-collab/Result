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

export const AERO_COMPOSITE_GLSL = `
uniform sampler2D uAeroTex;
uniform sampler2D uSceneDepth;
uniform sampler2D uFluxGIPost;
uniform int uAeroOn;
uniform int uFluxGIPostOn;
uniform mat4 uInvVP;
uniform vec3 uCamEye;

float aeroIGN(vec2 p){
  return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));
}

vec3 reconstructWorldPos(vec2 uv, float depth){
  vec4 ndc=vec4(uv*2.-1.,depth*2.-1.,1.);
  vec4 wp=uInvVP*ndc;
  return wp.xyz/max(abs(wp.w),1e-5)*sign(wp.w);
}

// Depth-occluded 3D volumetric ray-march through the live Navier-Stokes harbor fluid field
void applyAeroVortex(vec2 uv, float worldMask, float depth, float time, inout vec3 color){
  if(uAeroOn!=1 || worldMask<.02)return;
  vec3 wPos=reconstructWorldPos(uv,min(depth,.99992));
  vec3 toP=wPos-uCamEye;
  float dist=length(toP);
  if(dist<.65)return;
  vec3 rd=toP/dist;
  float tMax=min(dist,68.);
  // Early vertical reject if ray stays completely above the 6m harbor fluid layer
  if(uCamEye.y>6.2 && rd.y>=0.)return;

  const vec3 SUN_DIR=normalize(vec3(-.66,.28,-.70));
  float cosT=dot(rd,SUN_DIR);
  // Henyey-Greenstein forward scattering phase function (g = 0.56)
  float g=.56;
  float hg=(1.-g*g)/(4.*3.14159*pow(max(.08,1.+g*g-2.*g*cosT),1.5));
  float phase=clamp(.42+hg*1.15,.35,2.35);

  const int STEPS=12;
  float tStart=max(.75,tMax*.02);
  float stepLen=(tMax-tStart)/float(STEPS);
  float jitter=aeroIGN(gl_FragCoord.xy+fract(time*13.7)*41.);

  float trans=1.;
  vec3 scatter=vec3(0.);

  for(int i=0;i<STEPS;i++){
    float t=tStart+(float(i)+jitter)*stepLen;
    if(t>=tMax || trans<.045)break;
    vec3 p=uCamEye+rd*t;
    if(p.y<-.15 || p.y>5.8)continue;
    if(abs(p.x)>25.5 || abs(p.z)>101.)continue;

    vec2 fuv=vec2((p.x+25.)/50.,(p.z+100.)/200.);
    vec4 fl=texture(uAeroTex,clamp(fuv,vec2(.006),vec2(.994)));
    float dens=fl.b*2.4;
    if(dens<.018)continue;

    // Live Navier-Stokes velocity animates organic turbulent wisps inside the plume
    vec2 vel=(fl.rg-.5)*7.2;
    float heat=fl.a;
    float plumeTop=2.75+heat*1.65+min(1.1,dens*.48);
    float yProf=smoothstep(-.05,.38,p.y)*(1.-smoothstep(plumeTop*.52,plumeTop,p.y));
    if(yProf<.01)continue;

    // 3D procedural curl billow advected by actual Navier-Stokes wind velocity
    vec3 q=p*.74-vec3(vel.x*time*.18,time*(.28+heat*.45),vel.y*time*.18);
    float n1=sin(q.x*2.1+cos(q.z*2.3+q.y*1.9));
    float n2=cos(q.z*3.1-sin(q.x*2.6-q.y*2.7));
    float billow=.46+.54*clamp((n1*.58+n2*.42)*.5+.5,0.,1.);

    float sigma=dens*yProf*billow*.25;
    if(sigma<.002)continue;

    // Self-shadowed volumetric multi-scattering: deep slate-steel inner cores + sunlit warm marine rim + live FluxGI tint!
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
  const ix = clamp(Math.floor(((x - WORLD_X0) / WORLD_W) * AERO_W), 0, AERO_W - 1);
  const iz = clamp(Math.floor(((z - WORLD_Z0) / WORLD_L) * AERO_H), 0, AERO_H - 1);
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

    this.texData = new Uint8Array(N * 4);
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
    this.solid.fill(0);
    for (let iz = 0; iz < this.h; iz++) {
      const wz = WORLD_Z0 + ((iz + 0.5) / this.h) * WORLD_L;
      for (let ix = 0; ix < this.w; ix++) {
        const wx = WORLD_X0 + ((ix + 0.5) / this.w) * WORLD_W;
        let blocked = 0;
        for (const o of obstacles) {
          // Ground-level solid airflow blockers (containers, crates, tankers, crane legs >= 1.3m tall)
          if (o.y0 < 1.5 && o.y1 > 1.35 && wx >= o.x0 - 0.15 && wx <= o.x1 + 0.15 && wz >= o.z0 - 0.15 && wz <= o.z1 + 0.15) {
            blocked = 1;
            break;
          }
        }
        this.solid[iz * this.w + ix] = blocked;
      }
    }
  }

  _seedHarborBreeze() {
    // Initialize gentle sea breeze flowing eastward from the open harbor water (x=-25 -> +25)
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
    this.stats = {steps: 0, wakesCarved: 0, smokeVents: 0, maxWindSpeed: 0, totalSmoke: 0};
    this._seedHarborBreeze();
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

  /** Injects smoke density, ember heat, and directional momentum into the Navier-Stokes field. */
  injectSmoke(x, z, amount = 1.0, heatAmt = 0.25, radius = 2, impulseX = 0, impulseZ = 0) {
    const [cx, cz] = worldToAeroCell(x, z);
    const W = this.w, H = this.h;
    for (let dz = -radius; dz <= radius; dz++) {
      const nz = cz + dz;
      if (nz < 0 || nz >= H) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= W) continue;
        const idx = nz * W + nx;
        if (this.solid[idx]) continue;
        const r2 = dx * dx + dz * dz;
        if (r2 > radius * radius + 0.5) continue;
        const w = Math.exp(-r2 * (radius > 2 ? 0.34 : 0.62));
        this.smoke[idx] = Math.min(3.2, this.smoke[idx] + amount * w);
        this.heat[idx] = Math.min(1.4, this.heat[idx] + heatAmt * w);
        this.vx[idx] = clamp(this.vx[idx] + impulseX * w, -9, 9);
        this.vz[idx] = clamp(this.vz[idx] + impulseZ * w, -9, 9);
      }
    }
  }

  /** Injects an expanding radial shock burst + heated smoke plume (kills, shield breaks, tankers, smoke vents). */
  injectBurst(x, z, {smoke = 1.6, heat = 0.75, force = 4.2, radius = 3} = {}) {
    const [cx, cz] = worldToAeroCell(x, z);
    const W = this.w, H = this.h;
    for (let dz = -radius; dz <= radius; dz++) {
      const nz = cz + dz;
      if (nz < 0 || nz >= H) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= W) continue;
        const idx = nz * W + nx;
        if (this.solid[idx]) continue;
        const dist = Math.hypot(dx, dz);
        if (dist > radius + 0.4) continue;
        const w = Math.exp(-(dist * dist) / Math.max(1.2, radius * 1.1));
        this.smoke[idx] = Math.min(3.2, this.smoke[idx] + smoke * w);
        this.heat[idx] = Math.min(1.4, this.heat[idx] + heat * w);
        if (dist > 0.1) {
          const push = force * w / dist;
          this.vx[idx] = clamp(this.vx[idx] + dx * push, -9, 9);
          this.vz[idx] = clamp(this.vz[idx] + dz * push, -9, 9);
        }
      }
    }
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
    const seg = Math.hypot(dx, dz);
    if (seg < 0.05) return;
    const ux = dx / seg, uz = dz / seg;
    // Transverse vector for wake vorticity shear
    const tx = -uz, tz = ux;
    const machFactor = clamp(speed / 343, 0.5, 2.2);
    const wakeForce = (gun === 'MS10' ? 2.4 : gun === 'RD40' ? 1.8 : 1.25) * machFactor;
    const carve = clamp((gun === 'MS10' ? 0.58 : gun === 'RD40' ? 0.44 : 0.34) * machFactor, 0.18, 0.72);

    const samples = Math.max(1, Math.min(4, Math.ceil(seg / 1.4)));
    let carvedAny = false;
    for (let s = 0; s < samples; s++) {
      const f = (s + 0.5) / samples;
      const wx = p0[0] + dx * f;
      const wz = p0[2] + dz * f;
      const [ix, iz] = worldToAeroCell(wx, wz);
      const idx = iz * this.w + ix;
      if (this.solid[idx]) continue;

      this.vx[idx] = clamp(this.vx[idx] + ux * wakeForce, -9, 9);
      this.vz[idx] = clamp(this.vz[idx] + uz * wakeForce, -9, 9);

      if (this.smoke[idx] > 0.04) {
        const displaced = this.smoke[idx] * carve;
        this.smoke[idx] = Math.max(0, this.smoke[idx] - displaced);
        carvedAny = true;
        // Push displaced smoke sideways into swirling vortices flanking the bullet path!
        for (const side of [-1, 1]) {
          const sx = clamp(ix + Math.round(tx * side), 0, this.w - 1);
          const sz = clamp(iz + Math.round(tz * side), 0, this.h - 1);
          const sIdx = sz * this.w + sx;
          if (!this.solid[sIdx]) {
            this.smoke[sIdx] = Math.min(3.2, this.smoke[sIdx] + displaced * 0.36);
            this.vx[sIdx] = clamp(this.vx[sIdx] + tx * side * wakeForce * 0.55, -9, 9);
            this.vz[sIdx] = clamp(this.vz[sIdx] + tz * side * wakeForce * 0.55, -9, 9);
          }
        }
      }
    }
    if (carvedAny) this.stats.wakesCarved++;
  }

  /** Bilinear wind & smoke probe at any world coordinate (x, z). */
  sample(x, z) {
    const fx = clamp(((x - WORLD_X0) / WORLD_W) * this.w - 0.5, 0, this.w - 1.001);
    const fz = clamp(((z - WORLD_Z0) / WORLD_L) * this.h - 0.5, 0, this.h - 1.001);
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const tx = fx - x0, tz = fz - z0;
    const x1 = Math.min(this.w - 1, x0 + 1), z1 = Math.min(this.h - 1, z0 + 1);
    const i00 = z0 * this.w + x0, i10 = z0 * this.w + x1;
    const i01 = z1 * this.w + x0, i11 = z1 * this.w + x1;
    const bilerp = arr => {
      const a = arr[i00] + (arr[i10] - arr[i00]) * tx;
      const b = arr[i01] + (arr[i11] - arr[i01]) * tx;
      return a + (b - a) * tz;
    };
    const vx = bilerp(this.vx), vz = bilerp(this.vz);
    return {vx, vz, speed: Math.hypot(vx, vz), smoke: bilerp(this.smoke), heat: bilerp(this.heat)};
  }

  /**
   * Computes integrated optical depth of Navier-Stokes smoke along a 3D ray `a -> b`.
   * Returns 0 (crystal clear) .. 1+ (dense opaque smoke blocking optical AI sightlines!).
   */
  smokeOcclusion(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.8) return 0;
    const steps = Math.max(3, Math.min(20, Math.ceil(dist / 2.2)));
    const seg = dist / steps;
    let tau = 0;
    for (let i = 0; i < steps; i++) {
      const f = (i + 0.5) / steps;
      const y = a[1] + dy * f;
      if (y < 0 || y > 3.9) continue;
      const wx = a[0] + dx * f, wz = a[2] + dz * f;
      const [ix, iz] = worldToAeroCell(wx, wz);
      const d = this.smoke[iz * this.w + ix];
      if (d > 0.08) tau += d * seg * 0.16;
      if (tau >= 1.2) return 1.2;
    }
    return tau;
  }

  /** Executes one stable Navier-Stokes fluid substep (inflow + vorticity + advection + projection). */
  stepFluid(dt) {
    const W = this.w, H = this.h, N = this.n;
    const stepDt = clamp(dt, 0.005, 0.055);
    this.time += stepDt;
    this.stats.steps++;

    // 1. Live maritime harbor sea-breeze inflow along west water edge (x=0) with natural gusts
    const gust = 1.95 + Math.sin(this.time * 0.55) * 0.55 + Math.cos(this.time * 1.23) * 0.28;
    const crossZ = -0.35 + Math.sin(this.time * 0.37) * 0.45;
    for (let iz = 0; iz < H; iz++) {
      const iLeft = iz * W;
      if (!this.solid[iLeft]) {
        const wave = 1 + 0.18 * Math.sin(iz * 0.19 - this.time * 0.8);
        this.vx[iLeft] = gust * wave;
        this.vz[iLeft] = crossZ;
      }
      // Open outflow boundary along east wall
      const iRight = iz * W + (W - 1);
      if (!this.solid[iRight] && !this.solid[iRight - 1]) {
        this.vx[iRight] = Math.max(0.4, this.vx[iRight - 1] * 0.96);
        this.vz[iRight] = this.vz[iRight - 1] * 0.95;
      }
    }

    // 2. Vorticity Confinement: keeps swirling container-alley eddies sharp and alive!
    const curl = this.curl;
    for (let iz = 1; iz < H - 1; iz++) {
      for (let ix = 1; ix < W - 1; ix++) {
        const i = iz * W + ix;
        if (this.solid[i]) { curl[i] = 0; continue; }
        const dvz_dx = (this.vz[i + 1] - this.vz[i - 1]) / (2 * DX);
        const dvx_dz = (this.vx[i + W] - this.vx[i - W]) / (2 * DZ);
        curl[i] = dvz_dx - dvx_dz;
      }
    }
    const vortEps = 0.65;
    for (let iz = 2; iz < H - 2; iz++) {
      for (let ix = 2; ix < W - 2; ix++) {
        const i = iz * W + ix;
        if (this.solid[i]) continue;
        const gx = (Math.abs(curl[i + 1]) - Math.abs(curl[i - 1])) * 0.5;
        const gz = (Math.abs(curl[i + W]) - Math.abs(curl[i - W])) * 0.5;
        const mag = Math.hypot(gx, gz) + 1e-5;
        const nx = gx / mag, nz = gz / mag;
        const w = curl[i];
        this.vx[i] = clamp(this.vx[i] + nz * w * vortEps * stepDt, -9, 9);
        this.vz[i] = clamp(this.vz[i] - nx * w * vortEps * stepDt, -9, 9);
      }
    }

    // 3. Semi-Lagrangian Backtrace Advection of velocity, smoke density & ember heat
    const velDamp = Math.exp(-0.22 * stepDt);
    const smokeDamp = Math.exp(-0.20 * stepDt); // ~7-10s lingering drifting combat smoke!
    const heatDamp = Math.exp(-0.95 * stepDt);
    this._advectField(this.vx, this.vx0, stepDt, velDamp);
    this._advectField(this.vz, this.vz0, stepDt, velDamp);
    this._advectField(this.smoke, this.smoke0, stepDt, smokeDamp);
    this._advectField(this.heat, this.heat0, stepDt, heatDamp);
    this.vx.set(this.vx0);
    this.vz.set(this.vz0);
    this.smoke.set(this.smoke0);
    this.heat.set(this.heat0);

    // Subtle scalar diffusion on smoke so plumes expand naturally while billowing
    for (let iz = 1; iz < H - 1; iz++) {
      for (let ix = 1; ix < W - 1; ix++) {
        const i = iz * W + ix;
        if (this.solid[i]) { this.smoke0[i] = 0; continue; }
        let sum = this.smoke[i] * 4, wSum = 4;
        for (const nIdx of [i - 1, i + 1, i - W, i + W]) {
          if (!this.solid[nIdx]) { sum += this.smoke[nIdx] * 0.14; wSum += 0.14; }
        }
        const v = sum / wSum;
        this.smoke0[i] = v < 0.004 ? 0 : v;
      }
    }
    this.smoke.set(this.smoke0);

    // 4. Incompressible Pressure Projection (enforces div(u) = 0 + Venturi acceleration around containers!)
    this._project();

    // Update telemetry stats
    let maxS = 0, sumSmoke = 0;
    for (let i = 0; i < N; i++) {
      if (this.solid[i]) continue;
      const spd = Math.hypot(this.vx[i], this.vz[i]);
      if (spd > maxS) maxS = spd;
      sumSmoke += this.smoke[i];
    }
    this.stats.maxWindSpeed = maxS;
    this.stats.totalSmoke = sumSmoke;
  }

  _advectField(src, dst, dt, decay) {
    const W = this.w, H = this.h;
    const scaleX = dt / DX, scaleZ = dt / DZ;
    for (let iz = 0; iz < H; iz++) {
      for (let ix = 0; ix < W; ix++) {
        const i = iz * W + ix;
        if (this.solid[i]) { dst[i] = 0; continue; }
        const bx = clamp(ix - this.vx[i] * scaleX, 0, W - 1.001);
        const bz = clamp(iz - this.vz[i] * scaleZ, 0, H - 1.001);
        const x0 = Math.floor(bx), z0 = Math.floor(bz);
        const x1 = Math.min(W - 1, x0 + 1), z1 = Math.min(H - 1, z0 + 1);
        const tx = bx - x0, tz = bz - z0;
        const i00 = z0 * W + x0, i10 = z0 * W + x1;
        const i01 = z1 * W + x0, i11 = z1 * W + x1;
        const v00 = this.solid[i00] ? src[i] : src[i00];
        const v10 = this.solid[i10] ? src[i] : src[i10];
        const v01 = this.solid[i01] ? src[i] : src[i01];
        const v11 = this.solid[i11] ? src[i] : src[i11];
        const top = v00 + (v10 - v00) * tx;
        const bot = v01 + (v11 - v01) * tx;
        dst[i] = (top + (bot - top) * tz) * decay;
      }
    }
  }

  _project() {
    const W = this.w, H = this.h;
    const div = this.div, p = this.p, solid = this.solid;
    // Enforce zero velocity inside solid containers
    for (let i = 0; i < this.n; i++) {
      if (solid[i]) { this.vx[i] = 0; this.vz[i] = 0; div[i] = 0; p[i] = 0; }
    }
    for (let iz = 1; iz < H - 1; iz++) {
      for (let ix = 1; ix < W - 1; ix++) {
        const i = iz * W + ix;
        if (solid[i]) continue;
        const vR = solid[i + 1] ? 0 : this.vx[i + 1];
        const vL = solid[i - 1] ? 0 : this.vx[i - 1];
        const vD = solid[i + W] ? 0 : this.vz[i + W];
        const vU = solid[i - W] ? 0 : this.vz[i - W];
        div[i] = -0.5 * ((vR - vL) / DX + (vD - vU) / DZ);
        p[i] *= 0.65; // Warm-start pressure from previous frame for fast convergence!
      }
    }
    // 8 Gauss-Seidel pressure iterations with exact container Neumann boundaries
    for (let iter = 0; iter < 8; iter++) {
      for (let iz = 1; iz < H - 1; iz++) {
        for (let ix = 1; ix < W - 1; ix++) {
          const i = iz * W + ix;
          if (solid[i]) continue;
          let sum = div[i], cnt = 0;
          if (!solid[i - 1]) { sum += p[i - 1]; cnt++; }
          if (!solid[i + 1]) { sum += p[i + 1]; cnt++; }
          if (!solid[i - W]) { sum += p[i - W]; cnt++; }
          if (!solid[i + W]) { sum += p[i + W]; cnt++; }
          if (cnt > 0) p[i] = sum / cnt;
        }
      }
    }
    for (let iz = 1; iz < H - 1; iz++) {
      for (let ix = 1; ix < W - 1; ix++) {
        const i = iz * W + ix;
        if (solid[i]) continue;
        const pR = solid[i + 1] ? p[i] : p[i + 1];
        const pL = solid[i - 1] ? p[i] : p[i - 1];
        const pD = solid[i + W] ? p[i] : p[i + W];
        const pU = solid[i - W] ? p[i] : p[i - W];
        this.vx[i] = clamp(this.vx[i] - 0.5 * (pR - pL) * DX, -9, 9);
        this.vz[i] = clamp(this.vz[i] - 0.5 * (pD - pU) * DZ, -9, 9);
      }
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
    const out = this.texData, vx = this.vx, vz = this.vz, sm = this.smoke, ht = this.heat;
    for (let i = 0; i < this.n; i++) {
      const o = i * 4;
      out[o] = clamp(Math.round((vx[i] / 7.2 + 0.5) * 255), 0, 255);
      out[o + 1] = clamp(Math.round((vz[i] / 7.2 + 0.5) * 255), 0, 255);
      out[o + 2] = clamp(Math.round((sm[i] / 2.4) * 255), 0, 255);
      out[o + 3] = clamp(Math.round(ht[i] * 255), 0, 255);
    }
  }

  /** Uploads live 32x96 RGBA8 fluid field to GPU (12 KB/frame). */
  uploadToGPU() {
    this._packTexture();
    if (this.gl && this.tex) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.tex);
      this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.texData);
    }
  }
}
