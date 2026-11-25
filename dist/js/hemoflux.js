// HemoFlux 1.0 — Proprietary Forensic Hemodynamics, Non-Newtonian Fluid Breakup
// & Physically-Based Optical Blood Splatter Engine for WebGL2.
//
// Core Architecture:
//   1. Biomechanical Wound & Impact Taxonomy:
//      - Classifies anatomical hit zone (head / neck_arterial / thorax / limb), weapon trauma mode
//        (high_velocity / scatter / melee cast-off / blast), and physiology (human oxygenated arterial
//        vs hypoxic viscous zombie/H1 ZONBI venous blood).
//      - Generates physically distinct entry back-spatter, conical exit blow-through, coherent liquid
//        arterial ribbons (ligaments), pulsatile systolic arterial bleeders (with fleeing drop trails),
//        and expanding Huppert viscous gravity blood pools (R(t) ~ 1 - exp(-k*sqrt(t))).
//   2. Non-Newtonian Aerodynamic Breakup & Forensic BPA Surface Interaction:
//      - Size-dependent Stokes + quadratic aerodynamic drag naturally produces forensic size-sorting fans.
//      - Weber-number bag/stripping breakup (We = rho_a * v^2 * d / sigma) splits large fast droplets
//        into micro-satellites mid-flight; live weather wind & rain dilute/bend trajectories.
//      - Exact impact-angle ellipticity (sin(theta) = W/L), tangent-projected splat orientation,
//        secondary surface-skim ricochet spatter, and material-aware porosity (steel / concrete / wood / asphalt).
//      - Casson-viscosity vertical wall gravity rivulets (drips/runs) creeping down containers/walls
//        with bulging teardrop leading beads, arresting as they coagulate, and dripping onto floors.
//   3. Dedicated WebGL2 Physically-Based Optical Blood Renderer (HemoFluxGL):
//      - Pass A (decalProg): Procedural resolution-independent Forensic BPA teardrops, Weber-driven
//        scalloped crown spines, detached satellite micro-droplets, domain-warped viscous Huppert pools,
//        and wall gravity rivulets — shaded with Beer-Lambert spectral hemoglobin absorption, outside-in
//        coagulation/MetHb oxidation, analytical raised meniscus normals, GGX solar specular & Fresnel sky reflection.
//      - Pass B (mistProg): Soft volumetric rotating fBM hemoglobin aerosol clouds with Henyey-Greenstein
//        solar forward scattering (translucent backlit ruby mist — zero opaque spheres).
//      - Pass C (dropProg): Camera-aligned glossy 3D teardrop capsules & tapered coherent arterial ribbons
//        with Plateau-Rayleigh pinch modulation, Fresnel glints & Beer-Lambert translucency.
//      - Pass D (HEMO_VISOR_COMPOSITE_GLSL + visorProg): True refractive optical camera/visor blood droplets
//        with Casson stick-slip gravity smear trails, directional quadrant impact, and reticle protection.

import {clamp, sphereInFrustum} from './geometry.js';
import {floorAt, raycastMaterialOut} from './yard.js';
import {torso} from './posture.js';

export const HEMOFLUX_VERSION = 'HemoFlux 1.0';
export const MAX_VISOR_DROPS = 16;

const RHO_AIR = 1.225;
const SIGMA_BLOOD = 0.056; // N/m surface tension of whole blood at 37 C

export const SURFACE_PROPS = {
  steel:    {porosity: 0.07, gloss: 0.96, dripChance: 0.78, dripSpeed: 0.30, dryMul: 0.74, spreadMul: 1.08},
  wood:     {porosity: 0.48, gloss: 0.62, dripChance: 0.36, dripSpeed: 0.16, dryMul: 1.24, spreadMul: 0.94},
  concrete: {porosity: 0.74, gloss: 0.45, dripChance: 0.24, dripSpeed: 0.11, dryMul: 1.48, spreadMul: 0.88},
  asphalt:  {porosity: 0.66, gloss: 0.54, dripChance: 0.18, dripSpeed: 0.09, dryMul: 1.30, spreadMul: 0.96}
};

function surfaceProp(mat) {
  return SURFACE_PROPS[mat] || SURFACE_PROPS.concrete;
}

// ============================================================================
// Shared GLSL Optical Hemoglobin & Visor Refraction Blocks
// ============================================================================

export const HEMO_VISOR_COMPOSITE_GLSL = `
uniform int uVisorOn;
uniform int uVisorCount;
uniform float uVisorAspect;
uniform vec4 uVisorDrop[16]; // xy = current uv, z = radius, w = startV (gravity smear top)
uniform vec4 uVisorMeta[16]; // x = seed, y = fadeAlpha (0..1), z = dryness (0..1), w = oxygen (0..1)

float hvHash(vec2 p){
  vec3 p3=fract(vec3(p.xyx)*.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}

// Evaluates refractive height, analytical dome gradient, smear thickness, dryness & oxygenation
// across all live physical visor blood drops (Casson stick-slip teardrops + satellite spray + trails).
void hemoVisorEvaluate(vec2 uv, float aspect, out float hOut, out vec2 gradOut, out float smearOut, out float dryOut, out float oxyOut){
  hOut=0.;
  gradOut=vec2(0.);
  smearOut=0.;
  dryOut=0.;
  oxyOut=0.85;
  if(uVisorOn!=1 || uVisorCount<=0)return;
  float wSum=0.;
  for(int i=0;i<16;i++){
    if(i>=uVisorCount)break;
    vec4 d=uVisorDrop[i];
    vec4 m=uVisorMeta[i];
    float fade=m.y;
    if(fade<=.004 || d.z<=.001)continue;
    float rad=d.z;
    // Fast broadphase bounding box (including vertical smear trail above droplet)
    float topV=max(d.y,d.w)+rad*2.2;
    float botV=min(d.y,d.w)-rad*2.2;
    if(uv.y>topV || uv.y<botV)continue;
    float dx=(uv.x-d.x)*aspect;
    if(abs(dx)>rad*2.8)continue;
    float dy=uv.y-d.y;

    float seed=m.x;
    float ang=atan(dy,dx);
    // Physical glass surface-tension contour: plump, smoothly rounded asymmetric teardrop (no clover spikes!)
    float lobe=1.+.09*sin(ang*2.+seed*4.1)+.065*cos(ang*3.-seed*7.3)+.03*sin(ang*5.+seed*11.7);
    // Gravity teardrop sag: fuller rounded bottom meniscus, tapered upper tail when sliding!
    float slideLen=max(0.,d.w-d.y);
    float sag=clamp(slideLen*2.6,0.,.65);
    float yScale=dy>0.?(1.+sag*0.85):(1.+sag*0.22);
    float xPinch=dy>0.?mix(1.,0.76,clamp(dy/(rad*1.5),0.,1.)*clamp(slideLen*4.,0.,1.)):1.;
    float dist=length(vec2(dx/xPinch,dy/yScale))/(rad*lobe);

    float localH=0.;
    vec2 localG=vec2(0.);
    if(dist<1.0){
      float q=1.-dist*dist;
      localH=pow(q,0.62)*fade;
      // Analytical curved liquid-bead meniscus gradient for real glass-lens refraction + highlight
      vec2 radial=vec2(dx/xPinch,dy/yScale)/max(rad*lobe,1e-4);
      localG=-radial*(1.24*pow(max(q,0.02),-0.28))*fade;
    }

    // 4 deterministic tiny round surface-tension satellite micro-beads around impact splash
    for(int s=0;s<4;s++){
      float sf=float(s);
      float sa=seed*4.7+sf*1.63+sin(seed+sf)*0.55;
      float sr=rad*(1.22+0.55*hvHash(vec2(seed,sf+1.3)));
      vec2 sp=vec2(cos(sa),sin(sa))*sr;
      float sRad=rad*(0.13+0.13*hvHash(vec2(sf+2.1,seed)));
      vec2 sd=vec2(dx,dy+slideLen*0.42)-sp;
      float sl=length(sd)/max(sRad,1e-4);
      if(sl<1.0){
        float sq=1.-sl*sl;
        float sh=pow(sq,0.65)*fade*0.78;
        if(sh>localH){
          localH=sh;
          localG=-sd/max(sRad,1e-4)*0.88*fade;
        }
      }
    }

    // Thin translucent Casson-viscosity capillary smear trail behind sliding droplet
    float localSmear=0.;
    if(slideLen>0.005 && uv.y>=d.y-rad*0.2 && uv.y<=d.w+rad*0.45){
      float tTrail=clamp((uv.y-d.y)/max(slideLen,1e-4),0.,1.);
      float wobble=sin(uv.y*34.+seed*7.1)*rad*0.14*(1.-exp(-tTrail*5.));
      // Smoothly tapers from droplet crown into thin glossy capillary film!
      float trailW=rad*mix(0.46,0.16,pow(tTrail,0.65));
      float td=abs(dx-wobble)/max(trailW,1e-4);
      if(td<1.0){
        float edge=1.-td*td;
        float topFade=smoothstep(1.06,0.82,tTrail);
        localSmear=edge*edge*topFade*mix(0.56,0.18,tTrail)*fade;
        localG+=vec2(-(dx-wobble)/max(trailW,1e-4)*0.22,0.)*localSmear;
      }
    }

    float contrib=max(localH,localSmear*0.65);
    if(contrib>0.001){
      hOut=max(hOut,localH);
      smearOut=max(smearOut,localSmear);
      gradOut+=localG;
      dryOut+=m.z*contrib;
      oxyOut+=m.w*contrib;
      wSum+=contrib;
    }
  }
  if(wSum>1e-4){
    dryOut/=wSum;
    oxyOut/=wSum;
  }
}

vec3 hemoVisorShade(vec3 sceneCol, vec3 refractedCol, float h, vec2 grad, float smear, float dry, float oxy){
  float field=max(h,smear);
  float cov=smoothstep(0.018,0.12,field);
  if(cov<=.002)return sceneCol;
  // Thin smear trails stay semi-transparent ruby film; thick beads absorb deeply like real blood drops!
  float thick=clamp(h*1.12+smear*0.32,0.,1.20);
  vec3 mu=mix(vec3(2.2,13.0,12.8),vec3(1.02,10.2,11.2),clamp(oxy,0.,1.));
  vec3 trans=exp(-mu*(0.24+thick*1.85));
  vec3 driedTint=vec3(0.075,0.012,0.010);
  vec3 body=refractedCol*mix(trans,trans*0.42+driedTint*0.32,dry);
  // Subtle ruby-crimson internal scatter through wet translucent liquid dome
  float meniscus=smoothstep(0.04,0.34,h)*(1.-smoothstep(0.34,0.86,h));
  vec3 rubyScatter=mix(vec3(0.11,0.006,0.007),vec3(0.26,0.013,0.011),oxy);
  body+=rubyScatter*meniscus*(1.-dry*0.65)*0.55;
  // Crisp glass-drop specular pinpoint + subtle sky Fresnel glint (no muddy white blobs)
  vec3 N=normalize(vec3(grad.x*0.46,grad.y*0.46,1.0));
  vec3 L=normalize(vec3(-0.46,0.72,0.52));
  vec3 H=normalize(L+vec3(0.,0.,1.));
  float specTight=pow(max(dot(N,H),0.),mix(140.,22.,dry))*(1.-dry*0.82);
  float specBroad=pow(max(dot(N,H),0.),24.)*(1.-dry*0.75)*0.12;
  float rimF=pow(1.-max(N.z,0.),3.2)*(1.-dry*0.65);
  float beadMask=smoothstep(0.08,0.28,h);
  body+=vec3(1.08,0.96,0.92)*(specTight*0.85+specBroad)*beadMask;
  body+=vec3(0.68,0.54,0.54)*rimF*0.26*beadMask;
  // Subtle dark contact-angle total internal reflection rim at outer drop perimeter
  float tirEdge=smoothstep(0.02,0.11,h)*(1.-smoothstep(0.11,0.22,h));
  body*=1.-tirEdge*0.32;
  // Smear trails blend softer than solid hanging droplets
  float alpha=mix(clamp(smear*1.35,0.,0.72),cov,smoothstep(0.03,0.14,h));
  return mix(sceneCol,body,clamp(alpha,0.,0.96));
}
`;

// ============================================================================
// HemoFlux 1.0 Simulation Engine (CPU Physics & Forensic Hemodynamics)
// ============================================================================

export class HemoFluxEngine {
  constructor(rng = null) {
    this.version = HEMOFLUX_VERSION;
    this.rng = rng || Math.random;
    this.droplets = [];
    this.mists = [];
    this.decals = [];
    this.rivulets = [];
    this.ribbons = [];
    this.bleeders = [];
    this.visorDrops = [];

    // Packed GPU uniform buffers for visor lens refraction (zero per-frame GC!)
    this.uVisorDrop = new Float32Array(MAX_VISOR_DROPS * 4);
    this.uVisorMeta = new Float32Array(MAX_VISOR_DROPS * 4);
    this.visorActiveCount = 0;

    this._ray = {
      t: 0, tExit: 0, point: [0, 0, 0], normal: [0, 1, 0],
      exitPoint: null, exitNormal: null, _exitPt: [0, 0, 0], _exitNrm: [0, 1, 0],
      thickness: Infinity, mat: 'steel', box: null
    };

    this._stepAccum = 0;
    this.stats = {
      impacts: 0,
      headshots: 0,
      arterialBreaches: 0,
      weberBreakups: 0,
      wallRivulets: 0,
      killPools: 0,
      secondarySkims: 0,
      visorSplashes: 0
    };
  }

  reset() {
    this.droplets.length = 0;
    this.mists.length = 0;
    this.decals.length = 0;
    this.rivulets.length = 0;
    this.ribbons.length = 0;
    this.bleeders.length = 0;
    this.visorDrops.length = 0;
    this.uVisorDrop.fill(0);
    this.uVisorMeta.fill(0);
    this.visorActiveCount = 0;
    this._stepAccum = 0;
  }

  clearVisor() {
    this.visorDrops.length = 0;
    this.uVisorDrop.fill(0);
    this.uVisorMeta.fill(0);
    this.visorActiveCount = 0;
  }

  _rand() {
    return this.rng();
  }

  /** Classifies anatomical zone, weapon trauma mode, and physiology from impact context. */
  classifyWound(v, hitPos, hpLoss, isKill, meta) {
    const tScale = Math.max(0.65, torso(v) || 1.0);
    const py = hitPos ? hitPos[1] : (v.y + 1.15 * tScale);
    const relY = (py - v.y) / tScale;
    let zone = 'thorax';
    if (relY >= 1.38) zone = 'head';
    else if (relY >= 1.18) zone = 'neck';
    else if (relY < 0.72) zone = 'limb';

    let mode = 'high_velocity';
    if (meta?.melee) mode = 'melee';
    else if (meta?.splash || meta?.gasPipe) mode = 'blast';
    else if (meta?.shot?.gun === 'DF40 II' && (meta?.shot?.pellets || 1) > 1) mode = 'scatter';

    const isZombie = !!(v.isZombie || v.isH1Zonbi);
    const baseOxygen = isZombie ? 0.22 : (zone === 'neck' || zone === 'head' ? 0.96 : 0.84);
    const viscosity = isZombie ? 1.48 : 1.0;
    const gun = meta?.shot?.gun || '';
    const highCaliber = gun === 'MS10' || gun === 'RD40' || gun === 'RD 50' || !!meta?.wallbang || hpLoss >= 38;
    return {zone, mode, isZombie, baseOxygen, viscosity, highCaliber, relY};
  }

  _pushDecal(d) {
    const decals = this.decals;
    if (decals.length >= 280) {
      // Prefer evicting oldest non-pool minor stain before removing major kill pools
      let evict = 0;
      for (let i = 0; i < Math.min(48, decals.length); i++) {
        if (!decals[i].pool) { evict = i; break; }
      }
      decals.splice(evict, 1);
    }
    decals.push(d);
  }

  _spawnRivulet(x, y, z, nx, ny, nz, r, oxygen, mat, rainFactor = 0) {
    if (this.rivulets.length >= 96) this.rivulets.shift();
    const sp = surfaceProp(mat);
    const floorY = floorAt(x + nx * 0.08, z + nz * 0.08, y);
    const availDrop = Math.max(0.08, y - floorY - 0.02);
    const maxLen = Math.min(availDrop, clamp(r * (8.5 + this._rand() * 14.0) * (1.25 - sp.porosity * 0.55), 0.14, 1.35));
    if (maxLen < 0.10) return;
    this.stats.wallRivulets++;
    this.rivulets.push({
      x, y, z, nx, ny, nz,
      len: Math.min(0.03, maxLen * 0.25),
      maxLen,
      width: clamp(r * (0.42 + this._rand() * 0.26), 0.014, 0.048),
      speed: sp.dripSpeed * (0.65 + this._rand() * 0.85) * (1 + rainFactor * 0.45),
      oxygen,
      porosity: sp.porosity,
      dryMul: sp.dryMul,
      seed: this._rand() * 997.0,
      age: 0,
      life: 26 + this._rand() * 10,
      maxLife: 34,
      floorY,
      drippedBottom: false
    });
  }

  _spawnRibbon(px, py, pz, dx, dy, dz, ux, uz, wx, wy, wz, speed, thickness, oxygen, viscosity) {
    if (this.ribbons.length >= 48) this.ribbons.shift();
    const N = 7;
    const nodes = new Float32Array(N * 6);
    const ang = this._rand() * Math.PI * 2;
    const spread = 0.06 + this._rand() * 0.24;
    const ca = Math.cos(ang) * spread, sa = Math.sin(ang) * spread;
    const whipX = (this._rand() - 0.5) * 1.4;
    const whipY = (this._rand() - 0.35) * 1.1;
    const whipZ = (this._rand() - 0.5) * 1.4;
    for (let k = 0; k < N; k++) {
      const f = k / (N - 1); // 0 = fast leading head, 1 = trailing tail near wound
      const vMul = 1.0 - f * 0.62;
      const o = k * 6;
      nodes[o]     = px + dx * (1 - f) * 0.06;
      nodes[o + 1] = Math.max(0.12, py + dy * (1 - f) * 0.06);
      nodes[o + 2] = pz + dz * (1 - f) * 0.06;
      nodes[o + 3] = (dx + ux * ca + wx * sa) * speed * vMul + whipX * f * 0.45;
      nodes[o + 4] = (dy + wy * sa + 0.12 + (1 - f) * 0.14) * speed * vMul + whipY * f * 0.35;
      nodes[o + 5] = (dz + uz * ca + wz * sa) * speed * vMul + whipZ * f * 0.45;
    }
    const maxLife = (0.24 + this._rand() * 0.20) * clamp(viscosity, 0.85, 1.4);
    this.ribbons.push({
      nodes,
      count: N,
      thickness,
      oxygen,
      seed: this._rand() * 317.0,
      age: 0,
      life: maxLife,
      maxLife,
      shedTip: false
    });
  }

  /** Primary entry point called by Match.spawnBloodSplatter on flesh/HP trauma. */
  onImpact(v, hitPos, shotDir, hpLoss, isKill = false, meta = null, match = null) {
    if (!v || v.isDrone || v.inMech || hpLoss <= 0) return null;
    this.stats.impacts++;

    const px = hitPos ? hitPos[0] : v.x;
    const py = hitPos ? hitPos[1] : (v.y + 1.15);
    const pz = hitPos ? hitPos[2] : v.z;

    let dx = shotDir ? shotDir[0] : (this._rand() - 0.5);
    let dy = shotDir ? shotDir[1] : 0.08;
    let dz = shotDir ? shotDir[2] : (this._rand() - 0.5);
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;

    // Orthonormal tangent basis (u, w) around incoming trajectory d
    const tx = Math.abs(dy) > 0.9 ? 1 : -dz;
    const tz = Math.abs(dy) > 0.9 ? 0 : dx;
    const tl = Math.hypot(tx, tz) || 1;
    const ux = tx / tl, uz = tz / tl;
    const wx = -dy * uz, wy = dx * uz - dz * ux, wz = dy * ux;

    const wound = this.classifyWound(v, [px, py, pz], hpLoss, isKill, meta);
    if (wound.zone === 'head') this.stats.headshots++;
    if (wound.zone === 'neck' || (isKill && wound.zone === 'thorax')) this.stats.arterialBreaches++;

    const severity = clamp(hpLoss / 35, 0.35, 2.2) * (isKill ? 1.55 : 1.0) * (wound.zone === 'head' ? 1.35 : 1.0);
    const baseDrops = isKill ? 44 : clamp(Math.round(14 + hpLoss * 0.95), 16, 34);
    const dropCount = clamp(Math.round(baseDrops * (wound.zone === 'head' ? 1.25 : wound.mode === 'scatter' ? 1.18 : 1.0)), 16, 56);

    // 1. Multi-regime Forensic Droplet Ejecta (Entry Back-Spatter, High-Velocity Exit Cone, Cast-Off, Heavy Clots)
    for (let i = 0; i < dropCount; i++) {
      const r1 = this._rand(), r2 = this._rand(), r3 = this._rand();
      const ang = r1 * Math.PI * 2;
      let vx, vy, vz, rad, ox;

      if (wound.mode === 'melee') {
        // Forensic cast-off linear arc sweeping perpendicular to strike
        const sweep = (i / dropCount - 0.5) * 1.9;
        const spd = 2.4 + r3 * 5.6 + (isKill ? 1.8 : 0);
        vx = (dx * 0.55 + ux * sweep + wx * (r2 - 0.5) * 0.25) * spd;
        vy = (0.18 + (r2 - 0.35) * 0.55) * spd;
        vz = (dz * 0.55 + uz * sweep + wz * (r2 - 0.5) * 0.25) * spd;
        rad = 0.009 + r3 * 0.017;
        ox = clamp(wound.baseOxygen - r2 * 0.18, 0.12, 1.0);
      } else if (wound.mode === 'blast') {
        // Omnidirectional blast atomization + heavy fragments
        const elev = (r2 - 0.25) * 1.45;
        const cEl = Math.cos(elev);
        const spd = 2.6 + r3 * 9.2;
        vx = Math.cos(ang) * cEl * spd;
        vy = (Math.sin(elev) + 0.32) * spd;
        vz = Math.sin(ang) * cEl * spd;
        rad = i > dropCount * 0.65 ? (0.018 + r3 * 0.016) : (0.006 + r3 * 0.012);
        ox = clamp(wound.baseOxygen - r1 * 0.25, 0.12, 1.0);
      } else {
        // Ballistic gunshot: distinct Entry Back-Spatter (20%), Fast Exit Cone (52%), Heavy Gravity Clots (28%)
        const isBack = i < dropCount * 0.20;
        const isHeavy = i >= dropCount * 0.72;
        const cone = isHeavy
          ? (0.38 + r2 * 0.68)
          : isBack
            ? (0.26 + r2 * 0.44)
            : (wound.mode === 'scatter' ? (0.18 + r2 * 0.48) : (0.06 + r2 * (wound.highCaliber ? 0.26 : 0.36)));
        const ca = Math.cos(ang) * cone, sa = Math.sin(ang) * cone;
        const dirSign = isBack ? -0.68 : isHeavy ? 0.42 : 1.0;
        const exitBoost = (wound.highCaliber ? 2.8 : 0) + (isKill ? 2.6 : 0) + (wound.zone === 'head' ? 2.2 : 0);
        const spd = isHeavy
          ? (1.1 + r3 * 2.8)
          : isBack
            ? (2.0 + r3 * 3.8)
            : (4.8 + r3 * 8.6 + exitBoost);
        vx = (dx * dirSign + ux * ca + wx * sa) * spd;
        vy = (dy * dirSign + wy * sa + (isHeavy ? -0.10 : 0.12 + r2 * 0.28)) * spd;
        vz = (dz * dirSign + uz * ca + wz * sa) * spd;
        rad = isHeavy
          ? (0.017 + r3 * 0.015)
          : isBack
            ? (0.007 + r3 * 0.010)
            : (0.006 + r3 * 0.014);
        ox = clamp(wound.baseOxygen + (isHeavy ? -0.22 : isBack ? 0.06 : -r2 * 0.14), 0.12, 1.0);
      }

      const exitOffset = wound.mode === 'high_velocity' && i >= dropCount * 0.20 && i < dropCount * 0.72 ? 0.18 : 0;
      this.droplets.push({
        x: px + dx * exitOffset + (this._rand() - 0.5) * 0.10,
        y: Math.max(0.14, py + (this._rand() - 0.5) * 0.14),
        z: pz + dz * exitOffset + (this._rand() - 0.5) * 0.10,
        vx, vy, vz,
        r: rad,
        oxygen: ox,
        viscosity: wound.viscosity,
        tier: ox > 0.78 ? 0 : ox > 0.45 ? 1 : 2,
        bounces: 0,
        splitDone: false,
        life: 0.9 + r2 * 1.15,
        maxLife: 2.05
      });
    }
    if (this.droplets.length > 340) this.droplets.splice(0, this.droplets.length - 340);

    // 2. Coherent Liquid Arterial Ribbons (stretching glossy blood tendrils tearing out of exit wound!)
    const ribbonCount = isKill ? (wound.zone === 'head' ? 5 : 4) : (hpLoss >= 18 ? 2 : 1);
    for (let r = 0; r < ribbonCount; r++) {
      const rSpd = (4.2 + this._rand() * 5.8 + (wound.highCaliber ? 2.2 : 0)) * (r === 0 ? 1.15 : 0.85);
      const rThick = (0.014 + this._rand() * 0.014) * clamp(severity, 0.7, 1.45);
      this._spawnRibbon(
        px + dx * 0.14, py, pz + dz * 0.14,
        dx, dy, dz, ux, uz, wx, wy, wz,
        rSpd, rThick, wound.baseOxygen, wound.viscosity
      );
    }

    // 3. Volumetric Hemoglobin Aerosol Mist Plume (entry + exit cloud, backlit soft fBM)
    const mistCount = isKill ? (wound.zone === 'head' ? 11 : 8) : (wound.zone === 'head' ? 6 : 4);
    for (let m = 0; m < mistCount; m++) {
      const isExit = m % 3 !== 0;
      const shift = isExit ? (0.18 + this._rand() * 0.24) : (-0.08 - this._rand() * 0.12);
      const mSpd = isExit ? (1.6 + this._rand() * 2.8) : (-0.4 - this._rand() * 0.9);
      const maxL = (isKill ? 1.15 : 0.72) + this._rand() * 0.45;
      this.mists.push({
        x: px + dx * shift + (this._rand() - 0.5) * 0.18,
        y: Math.max(0.18, py + (this._rand() - 0.5) * 0.18),
        z: pz + dz * shift + (this._rand() - 0.5) * 0.18,
        vx: dx * mSpd + (this._rand() - 0.5) * 0.85,
        vy: 0.12 + this._rand() * 0.52,
        vz: dz * mSpd + (this._rand() - 0.5) * 0.85,
        r: (0.14 + this._rand() * 0.16) * (wound.zone === 'head' ? 1.25 : 1.0),
        grow: (isKill ? 0.95 : 0.62) * (0.8 + this._rand() * 0.45),
        rot: this._rand() * Math.PI * 2,
        rotSpd: (this._rand() - 0.5) * 1.1,
        oxygen: clamp(wound.baseOxygen + 0.08, 0.18, 1.0),
        density: clamp((isKill ? 0.46 : 0.34) * (0.75 + this._rand() * 0.45), 0.18, 0.58),
        seed: this._rand() * 913.0,
        age: 0,
        life: maxL,
        maxLife: maxL
      });
    }
    if (this.mists.length > 96) this.mists.splice(0, this.mists.length - 96);

    // 4. Instant High-Velocity Wall Blow-Through Spatter (if a container/wall is directly behind the victim within 3.2m!)
    if (wound.mode !== 'melee') {
      const rOut = this._ray;
      const probeDist = wound.highCaliber ? 3.8 : 2.6;
      if (raycastMaterialOut(px, py, pz, px + dx * probeDist, py + dy * probeDist, pz + dz * probeDist, rOut)) {
        const hitDist = Math.hypot(rOut.point[0] - px, rOut.point[1] - py, rOut.point[2] - pz);
        if (hitDist > 0.18 && hitDist < probeDist) {
          const sp = surfaceProp(rOut.mat);
          const nx = rOut.normal[0], ny = rOut.normal[1], nz = rOut.normal[2];
          // Tangent projection of exit vector onto struck wall
          const dDotN = dx * nx + dy * ny + dz * nz;
          let ttx = dx - nx * dDotN, tty = dy - ny * dDotN, ttz = dz - nz * dDotN;
          const ttl = Math.hypot(ttx, tty, ttz);
          if (ttl > 0.04) { ttx /= ttl; tty /= ttl; ttz /= ttl; }
          else { ttx = Math.abs(ny) > 0.9 ? 1 : -nz; tty = 0; ttz = Math.abs(ny) > 0.9 ? 0 : nx; }
          const sinTheta = clamp(Math.abs(dDotN), 0.25, 1.0);
          const prox = clamp(1.0 - hitDist / probeDist, 0.2, 1.0);
          const wallR = clamp((0.16 + severity * 0.14) * prox * sp.spreadMul, 0.10, 0.48);
          const wx0 = rOut.point[0] + nx * 0.012;
          const wy0 = rOut.point[1] + ny * 0.012;
          const wz0 = rOut.point[2] + nz * 0.012;
          this._pushDecal({
            x: wx0, y: wy0, z: wz0,
            nx, ny, nz,
            tx: ttx, ty: tty, tz: ttz,
            vx: ttx, vz: ttz,
            r: wallR * 0.45,
            r0: wallR * 0.45,
            targetR: wallR,
            stretch: clamp(1.0 / sinTheta, 1.1, 2.8),
            weber: clamp(0.65 + prox * 0.35, 0.3, 1.0),
            oxygen: wound.baseOxygen,
            porosity: sp.porosity,
            dryMul: sp.dryMul,
            seed: this._rand() * 1000,
            pool: false,
            kind: 0,
            age: 0,
            life: 32,
            maxLife: 32
          });
          // Vertical container/wall blow-through immediately triggers 1-2 heavy gravity drip rivulets!
          if (Math.abs(ny) < 0.35) {
            const rCount = isKill ? 2 : 1;
            for (let ri = 0; ri < rCount; ri++) {
              const off = (ri === 0 ? 0 : (this._rand() - 0.5) * wallR * 0.9);
              const sideX = ny * ttz - nz * tty, sideZ = nx * tty - ny * ttx;
              this._spawnRivulet(
                wx0 + sideX * off, wy0 - wallR * 0.15, wz0 + sideZ * off,
                nx, ny, nz, wallR * 0.18, wound.baseOxygen, rOut.mat,
                match?.weatherSpec?.rain ? 1 : 0
              );
            }
          }
        }
      }
    }

    // 5. Pulsatile Arterial Bleeder (fleeing blood drop trail for wounded actors + post-mortem spurt on kill)
    if (isKill || hpLoss >= 20 || wound.zone === 'neck' || wound.zone === 'head') {
      if (this.bleeders.length >= 16) this.bleeders.shift();
      this.bleeders.push({
        actor: v,
        offX: clamp(px - v.x, -0.35, 0.35),
        offY: clamp(py - v.y, 0.35, 1.65),
        offZ: clamp(pz - v.z, -0.35, 0.35),
        dx, dy, dz,
        oxygen: wound.baseOxygen,
        viscosity: wound.viscosity,
        heartHz: isKill ? 2.1 : (1.85 + this._rand() * 0.65), // 110..150 BPM systolic pulse
        phase: 0,
        dripAccum: 0,
        spurtAccum: 0,
        isKill,
        life: isKill ? 1.35 : 4.2,
        maxLife: isKill ? 1.35 : 4.2
      });
    }

    // 6. Lethal Kill: Expanding Multi-Lobe Huppert Viscous Gravity Blood Pool beneath fallen body!
    if (isKill) {
      const groundY = floorAt(v.x, v.z, v.y + 0.5);
      const onRoof = groundY > 0.35;
      const mat = onRoof ? 'steel' : 'asphalt';
      const sp = surfaceProp(mat);
      const targetR = (0.88 + this._rand() * 0.42 + (wound.zone === 'head' ? 0.18 : 0)) * sp.spreadMul;
      const hLen = Math.hypot(dx, dz) || 1;
      this.stats.killPools++;
      this._pushDecal({
        x: v.x + (dx / hLen) * 0.22,
        y: groundY + 0.014,
        z: v.z + (dz / hLen) * 0.22,
        nx: 0, ny: 1, nz: 0,
        tx: dx / hLen, ty: 0, tz: dz / hLen,
        vx: dx / hLen, vz: dz / hLen,
        r: 0.16,
        r0: 0.16,
        targetR,
        stretch: 1.15 + this._rand() * 0.28,
        weber: 0.35,
        oxygen: clamp(wound.baseOxygen - 0.12, 0.15, 0.92),
        porosity: sp.porosity,
        dryMul: sp.dryMul * 0.62, // Deep pools stay wet & glossy much longer!
        seed: this._rand() * 1000,
        pool: true,
        kind: 1,
        age: 0,
        life: 38,
        maxLife: 38
      });
    }

    const pl = match?.player;
    const distToPlayer = pl ? Math.hypot(px - pl.x, py - (pl.y + 1.4), pz - pl.z) : 99;
    return {
      victim: v,
      point: [px, py, pz],
      dir: [dx, dy, dz],
      hpLoss,
      isKill,
      distToPlayer,
      zone: wound.zone,
      mode: wound.mode,
      oxygen: wound.baseOxygen
    };
  }

  /** Spawns directional refractive visor droplets when blood hits near or on the camera/player. */
  onVisorSplatter(e, isSelf = false, camPos = null, camRight = null, camUp = null, camFwd = null) {
    if (!e) return;
    const dist = typeof e.distToPlayer === 'number' ? e.distToPlayer : 4.0;
    const prox = isSelf ? 1.0 : clamp(1.0 - dist / 9.0, 0.15, 1.0);
    const count = isSelf
      ? (e.isKill ? 7 : clamp(Math.round(2 + (e.hpLoss || 15) * 0.08), 3, 6))
      : (e.isKill ? Math.round(2 + prox * 4) : Math.round(1 + prox * 2));

    // Directional bias in screen space: determine which side of the visor faces the wound/attacker
    let biasU = 0, biasV = 0;
    if (camPos && camRight && camUp && e.point) {
      let rx = e.point[0] - camPos[0], ry = e.point[1] - camPos[1], rz = e.point[2] - camPos[2];
      if (isSelf && e.dir) {
        // Incoming shot direction -> blood enters from shooter side!
        rx = -e.dir[0]; ry = -e.dir[1]; rz = -e.dir[2];
      }
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;
      biasU = clamp(rx * camRight[0] + ry * camRight[1] + rz * camRight[2], -0.85, 0.85);
      biasV = clamp(rx * camUp[0] + ry * camUp[1] + rz * camUp[2], -0.65, 0.65);
    }

    const oxy = typeof e.oxygen === 'number' ? e.oxygen : 0.86;
    this.stats.visorSplashes += count;

    for (let i = 0; i < count; i++) {
      // Cluster toward periphery & directional quadrant while preserving a clean central reticle window!
      let u, v;
      for (let attempt = 0; attempt < 6; attempt++) {
        const ang = this._rand() * Math.PI * 2;
        const ring = (isSelf ? 0.24 : 0.28) + this._rand() * 0.25;
        u = clamp(0.5 + Math.cos(ang) * ring + biasU * 0.22 + (this._rand() - 0.5) * 0.14, 0.05, 0.95);
        v = clamp(0.5 + Math.sin(ang) * ring + biasV * 0.18 + (this._rand() - 0.5) * 0.14, 0.08, 0.94);
        const cd = Math.hypot((u - 0.5) * 1.45, v - 0.5);
        if (cd > 0.20) break;
      }
      const rad = (isSelf ? 0.022 : 0.015) + this._rand() * (e.isKill ? 0.036 : 0.024) * prox;
      const maxLife = 4.6 + this._rand() * 2.8;
      if (this.visorDrops.length >= MAX_VISOR_DROPS) this.visorDrops.shift();
      this.visorDrops.push({
        u,
        v,
        startV: v,
        r: rad,
        vy: rad > 0.022 ? (0.018 + this._rand() * 0.042) : (0.002 + this._rand() * 0.008),
        slipPhase: this._rand() * Math.PI * 2,
        oxygen: clamp(oxy + (this._rand() - 0.5) * 0.16, 0.15, 1.0),
        seed: this._rand() * 991.0,
        age: 0,
        life: maxLife,
        maxLife
      });
    }
  }

  /** Steps all 3D blood phases (droplets, ribbons, mist, decals, rivulets, bleeders). */
  update(rawDt, match = null) {
    if (!rawDt || rawDt <= 0) return;
    const hasActive =
      this.droplets.length > 0 ||
      this.mists.length > 0 ||
      this.decals.length > 0 ||
      this.rivulets.length > 0 ||
      this.ribbons.length > 0 ||
      this.bleeders.length > 0;
    if (!hasActive) {
      this._stepAccum = 0;
      return;
    }
    // 120Hz physics cadence accumulator: slashes 360Hz CPU cost by 3x while staying 2x smoother than 60 FPS!
    let dt = rawDt;
    if (rawDt < 0.0075) {
      this._stepAccum += rawDt;
      if (this._stepAccum < (1 / 120)) return;
      dt = this._stepAccum;
      this._stepAccum = 0;
    } else if (this._stepAccum > 0) {
      dt += this._stepAccum;
      this._stepAccum = 0;
    }
    const gravity = 9.8 * (match?.gravityScale ?? 1.0);
    const windBase = match?.weatherSpec?.windBase || 0;
    const rainFactor = match?.weather === 'disaster' ? 1.0 : match?.weather === 'storm' ? 0.65 : match?.weather === 'rain' ? 0.35 : 0;
    const windX = windBase * 0.28;
    const windZ = windBase * 0.16;

    // 1. Live Pulsatile Arterial Bleeders (systolic spurts + fleeing drip trail)
    const bleeders = this.bleeders;
    let bw = 0;
    for (let i = 0; i < bleeders.length; i++) {
      const b = bleeders[i];
      b.life -= dt;
      const a = b.actor;
      if (b.life <= 0 || !a || (!b.isKill && !a.alive)) continue;
      b.phase += dt * Math.PI * 2 * b.heartHz;
      const sinP = Math.sin(b.phase);
      const systolic = sinP > 0 ? (sinP * sinP * sinP * sinP) : 0;
      const decay = clamp(b.life / b.maxLife, 0, 1);

      const wx = a.x + b.offX;
      const wy = Math.max(0.18, a.y + (b.isKill ? 0.22 : b.offY));
      const wz = a.z + b.offZ;

      // Pressurized systolic arterial micro-spurt
      b.spurtAccum += dt * (0.8 + systolic * 10.5) * decay;
      if (b.spurtAccum >= 1.0 && this.droplets.length < 320) {
        b.spurtAccum -= 1.0;
        const spd = (b.isKill ? 1.6 : 2.4) * (0.55 + systolic * 0.95) * decay;
        this.droplets.push({
          x: wx, y: wy, z: wz,
          vx: b.dx * spd + (a.vx || 0) * 0.45 + (this._rand() - 0.5) * 0.85,
          vy: (0.45 + systolic * 1.15) * spd,
          vz: b.dz * spd + (a.vz || 0) * 0.45 + (this._rand() - 0.5) * 0.85,
          r: 0.008 + this._rand() * 0.010,
          oxygen: clamp(b.oxygen + 0.06, 0.18, 1.0),
          viscosity: b.viscosity,
          tier: 0,
          bounces: 0,
          splitDone: true,
          life: 1.1,
          maxLife: 1.1
        });
      }

      // Gravitational fleeing blood drop trail on ground beneath wounded moving actor
      if (!b.isKill) {
        const moveSpd = Math.hypot(a.vx || 0, a.vz || 0);
        b.dripAccum += dt * (1.8 + moveSpd * 0.55);
        if (b.dripAccum >= 1.0 && this.droplets.length < 330) {
          b.dripAccum -= 1.0;
          this.droplets.push({
            x: a.x + (this._rand() - 0.5) * 0.22,
            y: Math.max(0.25, a.y + 0.55),
            z: a.z + (this._rand() - 0.5) * 0.22,
            vx: (a.vx || 0) * 0.30 + (this._rand() - 0.5) * 0.25,
            vy: -0.6 - this._rand() * 0.5,
            vz: (a.vz || 0) * 0.30 + (this._rand() - 0.5) * 0.25,
            r: 0.012 + this._rand() * 0.008,
            oxygen: b.oxygen,
            viscosity: b.viscosity,
            tier: 1,
            bounces: 1,
            splitDone: true,
            life: 0.9,
            maxLife: 0.9
          });
        }
      }
      bleeders[bw++] = b;
    }
    bleeders.length = bw;

    // 2. Coherent Liquid Arterial Ribbons (Verlet/ballistic stretching fluid spline chains!)
    const ribbons = this.ribbons;
    let rw = 0;
    for (let i = 0; i < ribbons.length; i++) {
      const rb = ribbons[i];
      rb.age += dt;
      rb.life -= dt;
      if (rb.life <= 0) continue;
      const nodes = rb.nodes;
      const nCount = rb.count;
      const drag = 1 / (1 + 1.35 * dt);
      for (let k = 0; k < nCount; k++) {
        const o = k * 6;
        nodes[o + 3] = nodes[o + 3] * drag + windX * dt;
        nodes[o + 4] -= gravity * dt;
        nodes[o + 5] = nodes[o + 5] * drag + windZ * dt;
        nodes[o]     += nodes[o + 3] * dt;
        nodes[o + 1] += nodes[o + 4] * dt;
        nodes[o + 2] += nodes[o + 5] * dt;
        if (nodes[o + 1] < 0.35) {
          const fl = floorAt(nodes[o], nodes[o + 2], nodes[o + 1] + 0.2);
          if (nodes[o + 1] < fl + 0.018) {
            nodes[o + 1] = fl + 0.018;
            nodes[o + 3] *= 0.25;
            nodes[o + 4] = 0;
            nodes[o + 5] *= 0.25;
          }
        }
      }
      // Plateau-Rayleigh breakup: shed a leading droplet near mid-life!
      if (!rb.shedTip && rb.age > rb.maxLife * 0.45 && this.droplets.length < 330) {
        rb.shedTip = true;
        this.droplets.push({
          x: nodes[0], y: nodes[1], z: nodes[2],
          vx: nodes[3] * 1.05, vy: nodes[4], vz: nodes[5] * 1.05,
          r: clamp(rb.thickness * 0.95, 0.008, 0.022),
          oxygen: rb.oxygen,
          viscosity: 1.0,
          tier: 0,
          bounces: 0,
          splitDone: true,
          life: 1.1,
          maxLife: 1.1
        });
      }
      ribbons[rw++] = rb;
    }
    ribbons.length = rw;

    // 3. Ballistic Droplets (Physical blood-droplet inertia + Weber aerodynamic breakup + Forensic BPA impacts)
    const droplets = this.droplets;
    const rOut = this._ray;
    let dw = 0;
    for (let i = 0; i < droplets.length; i++) {
      const d = droplets[i];
      d.life -= dt;
      if (d.life <= 0) continue;

      const spd = Math.hypot(d.vx, d.vy, d.vz);
      // Physical whole-blood droplet drag: tiny droplets slow into fine spray while medium/heavy clots carry oblique ballistic arcs!
      const dragCoeff = clamp(0.0055 / (d.r + 0.004) + 0.0032 * spd / (d.r + 0.016), 0.22, 2.05);
      const drag = 1 / (1 + dragCoeff * dt);
      d.vx = d.vx * drag + windX * dt;
      d.vy = d.vy * drag - gravity * dt;
      d.vz = d.vz * drag + windZ * dt;

      // Weber-number aerodynamic bag/stripping breakup in mid-air!
      if (!d.splitDone && d.r > 0.0145 && spd > 6.0 && droplets.length < 325) {
        const weber = (RHO_AIR * spd * spd * (d.r * 2.0)) / SIGMA_BLOOD;
        if (weber > 16.0) {
          d.splitDone = true;
          d.r *= 0.82;
          this.stats.weberBreakups++;
          droplets.push({
            x: d.x + (this._rand() - 0.5) * 0.04,
            y: d.y + (this._rand() - 0.5) * 0.04,
            z: d.z + (this._rand() - 0.5) * 0.04,
            vx: d.vx * (0.76 + this._rand() * 0.16) + (this._rand() - 0.5) * 1.1,
            vy: d.vy * (0.78 + this._rand() * 0.18) + (this._rand() - 0.5) * 0.8,
            vz: d.vz * (0.76 + this._rand() * 0.16) + (this._rand() - 0.5) * 1.1,
            r: d.r * 0.54,
            oxygen: d.oxygen,
            viscosity: d.viscosity,
            tier: d.tier,
            bounces: d.bounces,
            splitDone: true,
            life: d.life * 0.85,
            maxLife: d.maxLife
          });
        }
      }

      const nx = d.x + d.vx * dt;
      const ny = d.y + d.vy * dt;
      const nz = d.z + d.vz * dt;
      const fl = ny < 0.25 ? floorAt(nx, nz, d.y + 0.25) : 0;
      let splatted = false;

      if (ny <= fl + 0.016) {
        splatted = true;
        const hSpd = Math.hypot(d.vx, d.vz);
        const totalSpd = Math.hypot(hSpd, d.vy) || 1;
        const sinTheta = clamp(Math.abs(d.vy) / totalSpd, 0.24, 1.0);
        const onRoof = fl > 0.35;
        const mat = onRoof ? 'steel' : 'asphalt';
        const sp = surfaceProp(mat);
        const weberNorm = clamp(((RHO_AIR * totalSpd * totalSpd * (d.r * 2.0)) / SIGMA_BLOOD) / 45.0, 0.05, 1.0);
        const baseR = clamp(d.r * (4.8 + weberNorm * 2.8) * sp.spreadMul, 0.045, 0.26);
        const tDirX = hSpd > 0.05 ? (d.vx / hSpd) : Math.cos(i * 1.7);
        const tDirZ = hSpd > 0.05 ? (d.vz / hSpd) : Math.sin(i * 1.7);

        if (this.decals.length < 280 || this._rand() < 0.45) {
          this._pushDecal({
            x: nx, y: fl + 0.014, z: nz,
            nx: 0, ny: 1, nz: 0,
            tx: tDirX, ty: 0, tz: tDirZ,
            vx: tDirX, vz: tDirZ,
            r: baseR * 0.48,
            r0: baseR * 0.48,
            targetR: baseR * (1.0 + rainFactor * 0.22),
            stretch: clamp(1.0 / sinTheta, 1.0, 3.6),
            weber: weberNorm,
            oxygen: d.oxygen,
            porosity: sp.porosity,
            dryMul: sp.dryMul,
            seed: this._rand() * 1000,
            pool: false,
            kind: sinTheta < 0.42 ? 2 : 0,
            age: 0,
            life: 24 + this._rand() * 8,
            maxLife: 32
          });
        }

        // Secondary forward skim satellite droplet on high-speed shallow floor impact
        if (d.bounces === 0 && sinTheta < 0.56 && totalSpd > 4.2 && droplets.length < 325) {
          this.stats.secondarySkims++;
          droplets.push({
            x: nx, y: fl + 0.03, z: nz,
            vx: d.vx * 0.44 + (this._rand() - 0.5) * 0.7,
            vy: 0.45 + this._rand() * 0.65,
            vz: d.vz * 0.44 + (this._rand() - 0.5) * 0.7,
            r: d.r * 0.46,
            oxygen: d.oxygen,
            viscosity: d.viscosity,
            tier: d.tier,
            bounces: 1,
            splitDone: true,
            life: 0.55,
            maxLife: 0.55
          });
        }
      } else if (raycastMaterialOut(d.x, d.y, d.z, nx, ny, nz, rOut)) {
        splatted = true;
        const p = rOut.point, n = rOut.normal;
        const sp = surfaceProp(rOut.mat);
        const totalSpd = Math.hypot(d.vx, d.vy, d.vz) || 1;
        const vDotN = d.vx * n[0] + d.vy * n[1] + d.vz * n[2];
        const sinTheta = clamp(Math.abs(vDotN) / totalSpd, 0.25, 1.0);
        // Project velocity onto struck wall plane for true 3D directional splat alignment!
        let ttx = d.vx - n[0] * vDotN;
        let tty = d.vy - n[1] * vDotN;
        let ttz = d.vz - n[2] * vDotN;
        const ttl = Math.hypot(ttx, tty, ttz);
        if (ttl > 0.05) { ttx /= ttl; tty /= ttl; ttz /= ttl; }
        else { ttx = 0; tty = -1; ttz = 0; }

        const weberNorm = clamp(((RHO_AIR * totalSpd * totalSpd * (d.r * 2.0)) / SIGMA_BLOOD) / 42.0, 0.08, 1.0);
        const baseR = clamp(d.r * (5.2 + weberNorm * 3.0) * sp.spreadMul, 0.055, 0.28);
        const wx = p[0] + n[0] * 0.013;
        const wy = p[1] + n[1] * 0.013;
        const wz = p[2] + n[2] * 0.013;

        this._pushDecal({
          x: wx, y: wy, z: wz,
          nx: n[0], ny: n[1], nz: n[2],
          tx: ttx, ty: tty, tz: ttz,
          vx: ttx, vz: ttz,
          r: baseR * 0.45,
          r0: baseR * 0.45,
          targetR: baseR * (1.0 + rainFactor * 0.16),
          stretch: clamp(1.0 / sinTheta, 1.0, 3.4),
          weber: weberNorm,
          oxygen: d.oxygen,
          porosity: sp.porosity,
          dryMul: sp.dryMul,
          seed: this._rand() * 1000,
          pool: false,
          kind: 0,
          age: 0,
          life: 28 + this._rand() * 8,
          maxLife: 36
        });

        // Vertical / steep surface: Casson yield-stress gravity rivulet!
        if (Math.abs(n[1]) < 0.35 && d.r >= 0.012 && this._rand() < sp.dripChance) {
          this._spawnRivulet(wx, wy, wz, n[0], n[1], n[2], d.r * 2.2, d.oxygen, rOut.mat, rainFactor);
        }

        // Oblique wall skim satellite
        if (d.bounces === 0 && sinTheta < 0.58 && totalSpd > 4.6 && droplets.length < 325) {
          this.stats.secondarySkims++;
          droplets.push({
            x: wx + n[0] * 0.02, y: wy + n[1] * 0.02, z: wz + n[2] * 0.02,
            vx: ttx * totalSpd * 0.38 + n[0] * 0.55 + (this._rand() - 0.5) * 0.5,
            vy: tty * totalSpd * 0.38 + n[1] * 0.55 + 0.15,
            vz: ttz * totalSpd * 0.38 + n[2] * 0.55 + (this._rand() - 0.5) * 0.5,
            r: d.r * 0.44,
            oxygen: d.oxygen,
            viscosity: d.viscosity,
            tier: d.tier,
            bounces: 1,
            splitDone: true,
            life: 0.48,
            maxLife: 0.48
          });
        }
      }

      if (!splatted) {
        d.x = nx; d.y = ny; d.z = nz;
        droplets[dw++] = d;
      }
    }
    droplets.length = dw;

    // 4. Volumetric Hemoglobin Aerosol Mist (rapid Stokes braking + turbulent swirl + gentle settling)
    const mists = this.mists;
    let mw = 0;
    const mistDrag = Math.exp(-3.8 * dt);
    for (let i = 0; i < mists.length; i++) {
      const m = mists[i];
      m.age += dt;
      m.life -= dt;
      if (m.life <= 0) continue;
      m.vx = m.vx * mistDrag + windX * 0.45 * dt;
      m.vy = m.vy * mistDrag - 0.24 * dt;
      m.vz = m.vz * mistDrag + windZ * 0.45 * dt;
      m.x += m.vx * dt;
      m.y = Math.max(0.12, m.y + m.vy * dt);
      m.z += m.vz * dt;
      m.rot += m.rotSpd * dt;
      m.r += m.grow * dt * Math.exp(-m.age * 1.9);
      mists[mw++] = m;
    }
    mists.length = mw;

    // 5. Forensic BPA Decals & Huppert Viscous Gravity Pools
    const decals = this.decals;
    let cw = 0;
    const washRate = 1.0 + rainFactor * 0.48;
    for (let i = 0; i < decals.length; i++) {
      const dc = decals[i];
      dc.age += dt;
      dc.life -= dt * washRate;
      if (dc.life <= 0) continue;
      if (dc.pool) {
        // Huppert viscous gravity-current spreading law: rapid initial spread -> asymptotic creep
        const spreadT = 1.0 - Math.exp(-1.75 * Math.sqrt(dc.age));
        dc.r = dc.r0 + (dc.targetR - dc.r0) * spreadT;
      } else if (dc.r < dc.targetR) {
        // Fast viscoelastic impact relaxation (~80 ms)
        dc.r = Math.min(dc.targetR, dc.r + (dc.targetR - dc.r0) * dt * 14.0);
      }
      decals[cw++] = dc;
    }
    decals.length = cw;

    // 6. Vertical Wall Gravity Rivulets (Casson yield-stress viscous creep & coagulation arrest!)
    const rivs = this.rivulets;
    let rvw = 0;
    for (let i = 0; i < rivs.length; i++) {
      const rv = rivs[i];
      rv.age += dt;
      rv.life -= dt * washRate;
      if (rv.life <= 0) continue;
      if (rv.len < rv.maxLen) {
        const coag = clamp(rv.age / (12.0 / rv.dryMul), 0, 1);
        const creepV = rv.speed * (1 - coag) * (1 - coag);
        rv.len = Math.min(rv.maxLen, rv.len + creepV * dt);
        if (!rv.drippedBottom && rv.len >= rv.maxLen - 0.01 && (rv.y - rv.len) <= rv.floorY + 0.08) {
          rv.drippedBottom = true;
          // Gravity drip reaches bottom edge of container -> deposits small glossy drip pool on ground!
          this._pushDecal({
            x: rv.x + rv.nx * 0.05,
            y: rv.floorY + 0.015,
            z: rv.z + rv.nz * 0.05,
            nx: 0, ny: 1, nz: 0,
            tx: rv.nx, ty: 0, tz: rv.nz,
            vx: rv.nx, vz: rv.nz,
            r: 0.03,
            r0: 0.03,
            targetR: clamp(rv.width * 3.8, 0.06, 0.16),
            stretch: 1.08,
            weber: 0.12,
            oxygen: rv.oxygen,
            porosity: 0.66,
            dryMul: 1.25,
            seed: rv.seed + 37.0,
            pool: false,
            kind: 1,
            age: 0,
            life: 24,
            maxLife: 24
          });
        }
      }
      rivs[rvw++] = rv;
    }
    rivs.length = rvw;
  }

  /** Steps camera/visor blood drops with Casson stick-slip gravity sliding & packs GPU uniforms. */
  stepVisor(dt, rainFactor = 0) {
    const drops = this.visorDrops;
    const stepDt = clamp(dt || 0, 0, 0.1);
    let w = 0;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      d.age += stepDt;
      d.life -= stepDt * (1.0 + rainFactor * 0.35);
      if (d.life <= 0) continue;
      // Casson stick-slip downward trickle: wet drops creep down visor glass, stopping as they dry!
      const dry = clamp(d.age / (d.maxLife * 0.85), 0, 1);
      const stickSlip = 0.38 + 0.62 * Math.pow(0.5 + 0.5 * Math.sin(d.age * 4.2 + d.slipPhase), 2.0);
      const slideV = d.vy * (1 - dry) * (1 - dry) * stickSlip * (1 + rainFactor * 0.6);
      d.v = Math.max(-0.12, d.v - slideV * stepDt);
      drops[w++] = d;
    }
    drops.length = w;

    const count = Math.min(MAX_VISOR_DROPS, drops.length);
    this.visorActiveCount = count;
    const uD = this.uVisorDrop, uM = this.uVisorMeta;
    for (let i = 0; i < count; i++) {
      const d = drops[i];
      const o = i * 4;
      const lifeFrac = clamp(d.life / d.maxLife, 0, 1);
      const fadeIn = clamp(d.age / 0.045, 0, 1);
      const fadeOut = clamp(lifeFrac / 0.28, 0, 1);
      const dryness = clamp(d.age / (d.maxLife * 0.82), 0, 1);
      uD[o]     = d.u;
      uD[o + 1] = d.v;
      uD[o + 2] = d.r * (0.62 + 0.38 * fadeIn);
      uD[o + 3] = d.startV;
      uM[o]     = d.seed;
      uM[o + 1] = fadeIn * fadeOut;
      uM[o + 2] = dryness;
      uM[o + 3] = d.oxygen;
    }
    return count;
  }
}

// ============================================================================
// HemoFlux 1.0 Dedicated WebGL2 Physically-Based Optical Blood Renderer
// ============================================================================

const DECAL_STRIDE = 19; // pos(3) + nrm(3) + local(2) + meta0(4) + meta1(4) + tang(3)
const MIST_STRIDE  = 11; // pos(3) + local(2) + meta0(4: rot, oxy, density, seed) + meta1(2: fade, age)
const DROP_STRIDE  = 14; // pos(3) + local(2) + axis(3) + meta0(4: oxy, kind, thickness, seed) + meta1(2: fade, stretch)

function buildDecalVS() {
  return `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aLocal;
layout(location=3) in vec4 aMeta0; // x=kind, y=stretch, z=weber, w=seed
layout(location=4) in vec4 aMeta1; // x=oxygen, y=dryness, z=porosity, w=fade
layout(location=5) in vec3 aTang;
uniform mat4 uVP;
out vec3 vWPos, vNormal, vTang;
out vec2 vLocal;
out vec4 vMeta0, vMeta1;
void main(){
  vWPos=aPos;
  vNormal=aNormal;
  vTang=aTang;
  vLocal=aLocal;
  vMeta0=aMeta0;
  vMeta1=aMeta1;
  gl_Position=uVP*vec4(aPos,1.);
}`;
}

function buildDecalFS(sharedGLSL) {
  return `#version 300 es
${sharedGLSL}
in vec3 vWPos, vNormal, vTang;
in vec2 vLocal;
in vec4 vMeta0, vMeta1;
uniform int uQuality;
uniform int uLightCount;
uniform vec4 uLights[6];
uniform vec3 uLightCol[6];
out vec4 frag;

float bHash(vec2 p){
  vec3 p3=fract(vec3(p.xyx)*.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
float bNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(bHash(i),bHash(i+vec2(1.,0.)),f.x),mix(bHash(i+vec2(0.,1.)),bHash(i+vec2(1.,1.)),f.x),f.y);
}
float bFbm(vec2 p){
  float s=bNoise(p)*.56;
  p=p*2.07+vec2(13.1,7.7);
  s+=bNoise(p)*.29;
  p=p*2.03+vec2(5.4,19.3);
  s+=bNoise(p)*.15;
  return s;
}
float bGGX(float ndh, float rough){
  float a=max(rough*rough,0.004);
  float a2=a*a;
  float d=ndh*ndh*(a2-1.)+1.;
  return a2/max(PI*d*d,1e-4);
}
vec3 bFog(vec3 c, vec3 V, float d){
  vec3 wCol=mix(vec3(.58,.68,.70),vec3(.28,.33,.37),clamp(uWeather.y,0.,1.));
  wCol=mix(wCol,vec3(.30,.10,.09),clamp(uWeather.z,0.,1.));
  wCol+=vec3(.55,.65,.78)*uWeather.w*.35;
  if(uQuality<0){
    float lf=clamp((d-18./max(1.,uWeather.x))/(360./max(1.,uWeather.x)),0.,.94);
    return mix(c,wCol,lf);
  }
  float sdot=max(dot(-V,SUN),0.);
  float sunVis=clamp(1.-uWeather.y*1.2,0.,1.);
  vec3 fcol=mix(wCol,vec3(.95,.77,.52),(sdot*sdot*sdot)*sunVis);
  return mix(c,fcol,fog(d));
}

void main(){
  float kind=vMeta0.x;
  float stretch=vMeta0.y;
  float weber=vMeta0.z;
  float seed=vMeta0.w;
  float oxygen=vMeta1.x;
  float baseDry=vMeta1.y;
  float porosity=vMeta1.z;
  float alphaFade=vMeta1.w;

  vec2 p=vLocal;
  float h=0.;
  float mask=0.;
  vec2 gradUV=vec2(0.); // Smooth analytical surface-tension meniscus slope (zero 2x2 dFdx blockiness!)
  float grain=bNoise(p*9.5+vec2(seed*.37,seed*.71));

  if(kind<0.5 || (kind>1.5 && kind<2.5)){
    // Forensic BPA Impact Spatter (kind=0) & Cast-Off Streak (kind=2)
    vec2 q=vec2(p.x-0.14*(1.-1./max(stretch,1.)),p.y);
    float tailTaper=mix(1.0,clamp(1.25-q.x*0.62,0.42,1.35),clamp((stretch-1.)*0.55,0.,1.));
    vec2 qs=vec2(q.x/max(0.72,min(1.0,0.62+0.12*stretch)),q.y/(0.58*tailTaper));
    float r=length(qs);
    float ang=atan(qs.y,qs.x);

    // Scalloped forensic crown spines radiating outward (stronger forward & at high Weber energy!)
    float fwdBias=smoothstep(-0.35,0.85,cos(ang));
    float freqA=floor(6.+mod(seed,7.));
    float sp1=pow(0.5+0.5*sin(ang*freqA+seed*3.7),3.2);
    float sp2=pow(0.5+0.5*cos(ang*(freqA*1.7+2.)+seed*7.1),4.0);
    float spineLen=(sp1*0.26+sp2*0.22)*(0.35+0.65*weber)*(0.45+0.85*fwdBias);
    float edgeNoise=(bNoise(vec2(ang*2.2+seed,r*3.5))-0.5)*(0.14+0.18*porosity);
    float radLimit=0.62+spineLen+edgeNoise;
    float sdf=radLimit-r;
    float edgeSoft=0.04+0.08*porosity;
    mask=smoothstep(-edgeSoft,edgeSoft,sdf);
    float normR=clamp(r/max(radLimit,0.2),0.,1.);
    h=pow(clamp(1.-normR*normR,0.,1.),0.62);
    // Smooth analytical dome slope peaking near the rounded wet meniscus edge
    vec2 rDir=r>1e-4?(qs/r):vec2(0.);
    gradUV=-rDir*(normR*smoothstep(0.05,0.92,normR))*0.62;

    // Detached forensic satellite micro-droplets scattered ahead of the impact tail
    if(weber>0.16 && mask<0.95){
      for(int s=0;s<5;s++){
        float sf=float(s);
        float h1=bHash(vec2(seed+sf*17.3,1.7));
        float h2=bHash(vec2(seed+sf*31.1,4.3));
        float sa=(h1-0.5)*2.4;
        float sr=0.64+h2*0.30;
        vec2 sc=vec2(cos(sa)*sr+0.06,sin(sa)*sr*0.82);
        vec2 sd=p-sc;
        vec2 sDir=normalize(sc+vec2(1e-4));
        float sAlong=dot(sd,sDir);
        float sPerp=dot(sd,vec2(-sDir.y,sDir.x));
        float sRad=0.028+0.044*bHash(vec2(sf+3.3,seed))*(0.5+0.5*weber);
        float sDist=length(vec2(sAlong/(sRad*(1.4+weber*0.9)),sPerp/sRad));
        float sm=smoothstep(1.12,0.72,sDist);
        if(sm>mask){
          mask=sm;
          h=max(h,clamp((1.-sDist)*0.72,0.,1.));
          gradUV=-sd/max(sRad,0.02)*0.55;
        }
      }
    }
  } else if(kind<1.5){
    // Expanding Multi-Lobe Huppert Viscous Gravity Blood Pool (Rayleigh-Taylor fingering!)
    vec2 warp=vec2(
      bFbm(p*2.15+vec2(seed*.13,seed*.29))-0.5,
      bFbm(p*2.15+vec2(seed*.41+7.3,seed*.17-3.1))-0.5
    );
    vec2 pw=p+warp*0.34;
    float r=length(pw);
    float ang=atan(pw.y,pw.x);
    float lobes=0.74+0.13*sin(ang*3.+seed*2.1)+0.09*cos(ang*5.-seed*4.7)+0.05*sin(ang*7.+seed*8.3);
    float sdf=lobes-r+(grain-0.5)*0.035*porosity;
    float edgeSoft=0.024+0.045*porosity;
    mask=smoothstep(-edgeSoft,edgeSoft,sdf);
    float inner=clamp(sdf/0.62,0.,1.);
    // Smooth flat-topped viscous puddle with gentle curved capillary meniscus rim!
    h=smoothstep(0.0,0.45,inner)*0.82+smoothstep(0.0,1.0,inner)*0.18;
    vec2 rDir=r>1e-4?(pw/r):vec2(0.);
    // Meniscus curves smoothly ONLY near the perimeter + ultra-gentle surface-tension swell inside!
    float meniscusSlope=smoothstep(0.42,0.02,inner)*0.55;
    vec2 gentleSwell=vec2(
      cos(pw.x*4.2+seed)-sin(pw.y*3.7-seed*.5),
      sin(pw.y*4.5-seed)+cos(pw.x*3.3+seed*.7)
    )*0.055;
    gradUV=-rDir*meniscusSlope+gentleSwell;
  } else {
    // Vertical Wall Gravity Drip Rivulet (kind=3): x in [-1,1] top->bottom, y in [-1,1] sideways
    float t=p.x*0.5+0.5; // 0 = top source splat, 1 = bottom hanging teardrop tip
    float wobble=sin(t*7.2+seed*2.3)*0.15+sin(t*13.5-seed*4.1)*0.06;
    float topBulge=exp(-pow((t-0.06)/0.14,2.))*0.52;
    float neckW=mix(0.30,0.18,smoothstep(0.08,0.72,t));
    float tipBulge=exp(-pow((t-0.88)/0.12,2.))*0.64;
    float halfW=neckW+topBulge+tipBulge;
    float yRel=(p.y-wobble)/max(halfW,0.05);
    float dy=abs(yRel);
    float endCap=smoothstep(0.0,0.06,t)*smoothstep(1.0,0.92,t);
    vec2 tipQ=vec2((t-0.87)/0.12,(p.y-wobble)/0.68);
    float tipRound=length(tipQ);
    float bodySdf=min(1.-dy,endCap*1.4);
    float tipSdf=1.-tipRound;
    // Smooth union (polynomial smin/smax) prevents C0 seam between neck and hanging teardrop bead!
    float kS=0.18;
    float hMix=clamp(0.5+0.5*(tipSdf-bodySdf)/kS,0.,1.);
    float sdf=mix(bodySdf,tipSdf,hMix)+kS*hMix*(1.-hMix);
    mask=smoothstep(-0.06,0.14,sdf);
    float bodyH=pow(clamp(1.-dy*dy,0.,1.),0.65)*mix(0.48,0.30,t);
    float beadH=pow(clamp(1.-tipRound*tipRound,0.,1.),0.55)*0.96;
    float bW=smoothstep(0.72,0.88,t)*smoothstep(1.05,0.60,tipRound);
    h=clamp(mix(bodyH,max(bodyH,beadH),bW),0.,1.);
    // Smooth analytical cylindrical neck + bulbous hanging bead gradient!
    vec2 neckGrad=vec2(0.,-yRel*0.62);
    vec2 beadGrad=-tipQ*0.78;
    gradUV=mix(neckGrad,beadGrad,bW);
  }

  float alpha=mask*alphaFade;
  if(alpha<0.015)discard;

  // Outside-in physical coagulation & drying: thin margins dry first, thick pooled core stays glossy wet!
  float localDry=clamp(baseDry*(1.36-0.66*h)*(0.66+0.58*porosity),0.,1.);
  float wet=1.-localDry;

  // Beer-Lambert spectral hemoglobin absorption + deep arterial oxblood richness + MetHb oxidation
  vec3 mu=mix(vec3(2.15,14.8,14.2),vec3(1.08,12.2,13.0),clamp(oxygen,0.,1.));
  vec3 freshAlb=exp(-mu*(0.36+h*1.95))*vec3(0.95,0.72,0.70);
  freshAlb=max(freshAlb,mix(vec3(0.032,0.002,0.002),vec3(0.068,0.003,0.003),oxygen));
  float thinRim=smoothstep(0.46,0.04,h);
  freshAlb+=vec3(0.20,0.010,0.009)*thinRim*(0.52+0.48*oxygen);
  vec3 driedAlb=mix(vec3(0.045,0.008,0.007),vec3(0.105,0.020,0.013),thinRim);
  vec3 albedo=mix(freshAlb,driedAlb,localDry);
  albedo*=0.92+0.14*grain;

  // Exact smooth tangent-space meniscus dome normal (pixel-perfect, zero 2x2 quad artifacts!)
  vec3 surfN=normalize(vNormal);
  vec3 T=normalize(vTang-surfN*dot(vTang,surfN));
  vec3 B=cross(surfN,T);
  float bumpStr=mix(0.06,0.52,wet)*(1.-porosity*0.32);
  vec3 N=normalize(surfN-T*(gradUV.x*bumpStr)-B*(gradUV.y*bumpStr));

  vec3 toEye=uEye-vWPos;
  float d2=dot(toEye,toEye);
  float invD=inversesqrt(max(d2,1e-6));
  float dist=d2*invD;
  vec3 V=toEye*invD;

  // Harbor sun + sky hemisphere + weather lighting (consistent with worldFS!)
  float nl=max(dot(N,SUN),0.);
  vec3 sunCol=(uKHDR==1?vec3(2.05,1.56,.96):vec3(1.66,1.32,.88))*clamp(1.-uWeather.y*.82,0.12,1.);
  vec3 ambient=mix(vec3(.24,.27,.26),vec3(.65,.79,.88),N.y*.5+.5);
  ambient*=mix(vec3(1.),mix(vec3(.68,.76,.84),vec3(.88,.48,.44),uWeather.z),clamp(uWeather.y,0.,1.));
  ambient+=vec3(.72,.82,1.)*uWeather.w*.55;

  vec3 col=albedo*(ambient+sunCol*nl);

  // Wet Clearcoat PBR: Dual-lobe GGX Solar + Sky-Zenith Specular + Schlick Fresnel Sky Reflection (IOR n=1.38)
  float rough=mix(0.075+porosity*0.09,0.74,localDry);
  float fresBase=mix(0.008,0.038,wet);
  float ndv=max(dot(N,V),0.001);
  float ft=1.-ndv;
  float fres=fresBase+(1.-fresBase)*(ft*ft*ft*ft*ft);

  if(nl>0.001){
    vec3 H=normalize(V+SUN);
    float ndh=max(dot(N,H),0.);
    float specD=bGGX(ndh,rough);
    float specVis=0.25/max(ndv*nl+0.15,0.15);
    col+=sunCol*(specD*specVis*fres*nl)*(0.75+wet*1.55);
  }

  // Crisp glossy wet sky-dome sheen + mirror reflection (works identically on floors AND shaded vertical container walls!)
  if(wet>0.04){
    vec3 R=reflect(-V,N);
    R.y=max(0.04,R.y);
    vec3 env=sky(R);
    float envGain=mix(0.24,1.05,wet)*(1.-porosity*0.34);
    vec3 skyKey=normalize(vec3(-0.22,0.72,0.18)+surfN*0.58);
    vec3 skyH=normalize(V+skyKey);
    float skySpec=pow(max(dot(N,skyH),0.),mix(78.,16.,localDry))*wet*(1.-porosity*0.36);
    col+=env*fres*envGain+vec3(0.95,0.96,1.0)*skySpec*0.52;
  }

  // Dynamic point lights glinting across glossy wet blood
  if(uQuality>=0 && uLightCount>0){
    int maxL=min(uLightCount,uQuality>=2?6:3);
    for(int i=0;i<6;i++){
      if(i>=maxL)break;
      vec4 lp=uLights[i];
      if(lp.w<=.001)continue;
      vec3 toL=lp.xyz-vWPos;
      float ld2=dot(toL,toL);
      float att=lp.w/(1.+ld2*.14);
      if(att<.004)continue;
      vec3 L=toL*inversesqrt(max(ld2,1e-5));
      float lnl=max(dot(N,L),0.);
      vec3 LH=normalize(V+L);
      float lSpec=bGGX(max(dot(N,LH),0.),rough)*fres*0.42*wet;
      col+=(albedo*lnl+vec3(lSpec))*uLightCol[i]*att;
    }
  }

  col=bFog(col,V,dist);
  // Thin translucent edge alpha modulation so wet edges blend naturally into concrete/steel
  float finalAlpha=clamp(alpha*mix(0.84,0.985,clamp(h*1.4+localDry*0.3,0.,1.)),0.,0.985);
  frag=vec4(displayColor(col),finalAlpha);
}`;
}

function buildMistVS() {
  return `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aLocal;
layout(location=2) in vec4 aMeta0; // x=rot, y=oxygen, z=density, w=seed
layout(location=3) in vec2 aMeta1; // x=fade, y=age
uniform mat4 uVP;
out vec3 vWPos;
out vec2 vLocal;
out vec4 vMeta0;
out vec2 vMeta1;
void main(){
  vWPos=aPos;
  vLocal=aLocal;
  vMeta0=aMeta0;
  vMeta1=aMeta1;
  gl_Position=uVP*vec4(aPos,1.);
}`;
}

function buildMistFS(sharedGLSL) {
  return `#version 300 es
${sharedGLSL}
in vec3 vWPos;
in vec2 vLocal;
in vec4 vMeta0;
in vec2 vMeta1;
out vec4 frag;

float mHash(vec2 p){
  vec3 p3=fract(vec3(p.xyx)*.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
float mNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(mHash(i),mHash(i+vec2(1.,0.)),f.x),mix(mHash(i+vec2(0.,1.)),mHash(i+vec2(1.,1.)),f.x),f.y);
}
float mFbm(vec2 p){
  float s=mNoise(p)*.55;
  p=p*2.05+vec2(7.3,11.1);
  s+=mNoise(p)*.30;
  p=p*2.03+vec2(15.7,3.9);
  s+=mNoise(p)*.15;
  return s;
}

void main(){
  float r2=dot(vLocal,vLocal);
  if(r2>=1.0)discard;
  float rot=vMeta0.x;
  float oxy=vMeta0.y;
  float dens=vMeta0.z;
  float seed=vMeta0.w;
  float fade=vMeta1.x;
  float age=vMeta1.y;

  float c=cos(rot),s=sin(rot);
  vec2 rp=mat2(c,-s,s,c)*vLocal;
  float radial=pow(1.-r2,1.65);
  float cloud=mFbm(rp*2.35+vec2(seed*.17+age*.35,seed*.31-age*.22));
  float wisps=mNoise(rp*5.2-vec2(age*.7,seed*.5));
  float alpha=radial*smoothstep(0.18,0.82,cloud*0.78+wisps*0.28)*dens*fade;
  if(alpha<0.008)discard;

  vec3 toEye=uEye-vWPos;
  float d=length(toEye);
  vec3 V=toEye/max(d,1e-4);

  // Henyey-Greenstein solar forward scattering (backlit translucent crimson aerosol mist!)
  float cosT=dot(-V,SUN);
  float g=0.58;
  float hg=(1.-g*g)/(4.*PI*pow(max(1.+g*g-2.*g*cosT,0.08),1.5));
  float sunVis=clamp(1.-uWeather.y*.85,0.12,1.);

  vec3 baseMist=mix(vec3(0.10,0.010,0.012),vec3(0.24,0.020,0.018),oxy);
  vec3 backlitCol=mix(vec3(0.32,0.025,0.022),vec3(0.68,0.055,0.042),oxy);
  vec3 sunCol=(uKHDR==1?vec3(1.8,1.35,.85):vec3(1.45,1.15,.78))*sunVis;
  vec3 amb=mix(vec3(0.36,0.40,0.44),vec3(0.58,0.68,0.74),0.5+0.5*vLocal.y);
  amb*=mix(vec3(1.),vec3(0.65,0.70,0.78),clamp(uWeather.y,0.,1.));

  vec3 col=baseMist*amb+backlitCol*sunCol*(0.28+clamp(hg*1.45,0.,2.2))*(0.45+0.55*cloud);
  // Subtle harbor distance fog
  vec3 fogCol=mix(vec3(.58,.68,.70),vec3(.28,.33,.37),clamp(uWeather.y,0.,1.));
  col=mix(col,fogCol,fog(d));
  frag=vec4(displayColor(col),clamp(alpha,0.,0.68));
}`;
}

function buildDropVS() {
  return `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aLocal;
layout(location=2) in vec3 aAxis;
layout(location=3) in vec4 aMeta0; // x=oxygen, y=kind (0=droplet, 1=ribbon), z=thickness, w=seed
layout(location=4) in vec2 aMeta1; // x=fade, y=stretch
uniform mat4 uVP;
out vec3 vWPos, vAxis;
out vec2 vLocal;
out vec4 vMeta0;
out vec2 vMeta1;
void main(){
  vWPos=aPos;
  vAxis=aAxis;
  vLocal=aLocal;
  vMeta0=aMeta0;
  vMeta1=aMeta1;
  gl_Position=uVP*vec4(aPos,1.);
}`;
}

function buildDropFS(sharedGLSL) {
  return `#version 300 es
${sharedGLSL}
in vec3 vWPos, vAxis;
in vec2 vLocal;
in vec4 vMeta0;
in vec2 vMeta1;
out vec4 frag;

void main(){
  float oxy=vMeta0.x;
  float kind=vMeta0.y;
  float seed=vMeta0.w;
  float fade=vMeta1.x;

  float cov=0.;
  float thick=0.;
  vec2 n2d=vec2(0.);

  if(kind<0.5){
    // Velocity-stretched 3D teardrop capsule (head at +x, tapered trailing tail at -x!)
    float taper=mix(0.45,1.08,smoothstep(-1.0,0.55,vLocal.x));
    vec2 q=vec2(vLocal.x,vLocal.y/max(taper,0.25));
    float d2=dot(q,q);
    if(d2>=1.0)discard;
    float zSphere=sqrt(max(0.,1.-d2));
    cov=smoothstep(1.0,0.68,sqrt(d2))*fade;
    thick=zSphere;
    n2d=q;
  } else {
    // Coherent Liquid Arterial Ribbon (vLocal.x in [0,1] head->tail, vLocal.y in [-1,1] cross-section)
    float t=vLocal.x;
    // Smooth Plateau-Rayleigh capillary pinch beads along stretching liquid ligament!
    float pinch=0.72+0.28*sin(t*14.5+seed*4.7);
    float env=smoothstep(0.0,0.06,t)*smoothstep(1.0,0.08,t)*pinch;
    float yNorm=vLocal.y/max(env,0.14);
    float ay=abs(yNorm);
    if(ay>=1.0)discard;
    float zCyl=sqrt(max(0.,1.-ay*ay));
    float endFade=smoothstep(0.0,0.04,t)*smoothstep(1.0,0.84,t);
    cov=smoothstep(1.0,0.52,ay)*endFade*fade;
    thick=zCyl*mix(1.0,0.55,t);
    n2d=vec2((t-0.5)*0.22,yNorm);
  }

  if(cov<0.02)discard;

  vec3 toEye=uEye-vWPos;
  float dist=length(toEye);
  vec3 V=toEye/max(dist,1e-4);
  vec3 ax=normalize(vAxis+vec3(1e-5,0.,0.));
  vec3 side=normalize(cross(V,ax)+vec3(0.,1e-5,0.));
  vec3 N=normalize(ax*n2d.x*0.72+side*n2d.y*0.86+V*max(0.24,thick));

  // Beer-Lambert liquid hemoglobin core + translucent backlit crimson rim
  vec3 mu=mix(vec3(2.1,13.8,13.5),vec3(1.02,11.4,12.2),oxy);
  vec3 alb=max(exp(-mu*(0.30+thick*1.85))*vec3(0.95,0.74,0.72),vec3(0.055,0.003,0.003));
  float rimT=1.-thick;
  alb+=vec3(0.28,0.014,0.012)*rimT*rimT*(0.55+0.45*oxy);

  float nl=max(dot(N,SUN),0.);
  float sunVis=clamp(1.-uWeather.y*.82,0.12,1.);
  vec3 sunCol=(uKHDR==1?vec3(2.05,1.56,.96):vec3(1.66,1.32,.88))*sunVis;
  vec3 amb=mix(vec3(.28,.32,.34),vec3(.65,.79,.88),N.y*.5+.5);
  vec3 col=alb*(amb+sunCol*(0.28+0.72*nl));

  // Razor-sharp glossy specular glint + sky zenith sparkle + Fresnel reflection on airborne liquid!
  vec3 H=normalize(V+SUN);
  vec3 skyH=normalize(V+normalize(vec3(-0.30,0.82,0.48)));
  float spec=pow(max(dot(N,H),0.),96.)*sunVis;
  float skySpec=pow(max(dot(N,skyH),0.),64.)*0.42;
  float fres=0.036+0.964*pow(1.-max(dot(N,V),0.),5.);
  vec3 R=reflect(-V,N);
  R.y=max(0.04,R.y);
  col+=sunCol*spec*1.25+vec3(0.92,0.95,1.0)*skySpec+sky(R)*fres*0.78;

  vec3 fogCol=mix(vec3(.58,.68,.70),vec3(.28,.33,.37),clamp(uWeather.y,0.,1.));
  col=mix(col,fogCol,fog(dist));
  frag=vec4(displayColor(col),clamp(cov*mix(0.76,0.96,thick),0.,0.96));
}`;
}

function buildDirectVisorFS(sharedGLSL) {
  return `#version 300 es
${sharedGLSL}
in vec2 vUV;
out vec4 frag;
${HEMO_VISOR_COMPOSITE_GLSL}
void main(){
  float h, smear, dry, oxy;
  vec2 grad;
  hemoVisorEvaluate(vUV, uVisorAspect, h, grad, smear, dry, oxy);
  float cov=smoothstep(0.02,0.14,max(h,smear));
  if(cov<=.002)discard;
  float thick=clamp(h*1.15+smear*0.42,0.,1.25);
  vec3 mu=mix(vec3(2.3,13.5,13.2),vec3(1.08,10.8,11.6),clamp(oxy,0.,1.));
  vec3 base=exp(-mu*(0.30+thick*1.85))*vec3(0.85,0.68,0.66);
  float meniscus=smoothstep(0.04,0.28,h)*(1.-smoothstep(0.28,0.78,h));
  base+=vec3(0.28,0.015,0.014)*meniscus*(1.-dry*0.65);
  vec3 dried=vec3(0.075,0.013,0.011);
  vec3 col=mix(base,dried,dry);
  vec3 N=normalize(vec3(grad.x*0.58,grad.y*0.58,1.0));
  vec3 L=normalize(vec3(-0.48,0.68,0.55));
  vec3 H=normalize(L+vec3(0.,0.,1.));
  float spec=pow(max(dot(N,H),0.),mix(72.,16.,dry))*(1.-dry*0.78);
  col+=vec3(1.0,0.90,0.84)*spec*0.62*smoothstep(0.06,0.22,h);
  float a=clamp(cov*mix(0.55,0.92,clamp(h*1.2,0.,1.)),0.,0.92);
  frag=vec4(displayColor(col),a);
}`;
}

function linkProgram(gl, vs, fs, label) {
  const obj = gl.createProgram(), sh = [];
  for (const [type, code] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw Error(`HemoFlux ${label} shader: ` + gl.getShaderInfoLog(s));
    }
    gl.attachShader(obj, s);
    sh.push(s);
  }
  gl.linkProgram(obj);
  if (!gl.getProgramParameter(obj, gl.LINK_STATUS)) {
    throw Error(`HemoFlux ${label} link: ` + gl.getProgramInfoLog(obj));
  }
  for (const s of sh) gl.deleteShader(s);
  const loc = {};
  for (let i = 0; i < gl.getProgramParameter(obj, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(obj, i).name;
    loc[name.replace('[0]', '')] = gl.getUniformLocation(obj, name);
  }
  return {obj, ...loc};
}

function makeStreamVAO(gl, layout, initialFloats) {
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, initialFloats * 4, gl.DYNAMIC_DRAW);
  let stride = 0;
  for (let i = 0; i < layout.length; i++) stride += layout[i];
  let off = 0;
  for (let i = 0; i < layout.length; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, layout[i], gl.FLOAT, false, stride * 4, off * 4);
    off += layout[i];
  }
  gl.bindVertexArray(null);
  return {vao, buf, stride, capFloats: initialFloats, data: new Float32Array(initialFloats), len: 0};
}

function ensureStream(s, addFloats) {
  const need = s.len + addFloats;
  if (need <= s.data.length) return;
  let cap = s.data.length || 4096;
  while (cap < need) cap <<= 1;
  const next = new Float32Array(cap);
  next.set(s.data.subarray(0, s.len));
  s.data = next;
}

function uploadAndDraw(gl, s) {
  if (s.len <= 0) return;
  const count = (s.len / s.stride) | 0;
  if (count <= 0) return;
  gl.bindVertexArray(s.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, s.buf);
  if (s.len > s.capFloats) {
    let cap = s.capFloats || 4096;
    while (cap < s.len) cap <<= 1;
    s.capFloats = cap;
    gl.bufferData(gl.ARRAY_BUFFER, cap * 4, gl.DYNAMIC_DRAW);
  }
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data.subarray(0, s.len));
  gl.drawArrays(gl.TRIANGLES, 0, count);
}

export function getHemoFluxShaderSources(sharedGLSL, postVS) {
  return {
    decal: [buildDecalVS(), buildDecalFS(sharedGLSL)],
    mist:  [buildMistVS(), buildMistFS(sharedGLSL)],
    drop:  [buildDropVS(), buildDropFS(sharedGLSL)],
    visor: [postVS, buildDirectVisorFS(sharedGLSL)]
  };
}

export class HemoFluxGL {
  constructor(gl, sharedGLSL, postVS) {
    this.gl = gl;
    const src = getHemoFluxShaderSources(sharedGLSL, postVS);
    this.decalP = linkProgram(gl, src.decal[0], src.decal[1], 'decal');
    this.mistP  = linkProgram(gl, src.mist[0],  src.mist[1],  'mist');
    this.dropP  = linkProgram(gl, src.drop[0],  src.drop[1],  'drop');
    this.visorP = linkProgram(gl, src.visor[0], src.visor[1], 'visor');

    for (const p of [this.decalP, this.mistP, this.dropP, this.visorP]) {
      gl.useProgram(p.obj);
      if (p.uSky != null) gl.uniform1i(p.uSky, 2);
    }

    // Zero-GC reusable CPU->GPU dynamic vertex streams
    this.decalStream = makeStreamVAO(gl, [3, 3, 2, 4, 4, 3], 6 * 384 * DECAL_STRIDE);
    this.mistStream  = makeStreamVAO(gl, [3, 2, 4, 2],       6 * 96  * MIST_STRIDE);
    this.dropStream  = makeStreamVAO(gl, [3, 2, 3, 4, 2],    6 * 640 * DROP_STRIDE);
  }

  _pushDecalQuad(x, y, z, nx, ny, nz, tx, ty, tz, bx, by, bz, halfU, halfV, kind, stretch, weber, seed, oxy, dry, por, fade) {
    const s = this.decalStream;
    ensureStream(s, 6 * DECAL_STRIDE);
    const d = s.data;
    let w = s.len;

    const c0x = x - tx * halfU - bx * halfV, c0y = y - ty * halfU - by * halfV, c0z = z - tz * halfU - bz * halfV;
    const c1x = x + tx * halfU - bx * halfV, c1y = y + ty * halfU - by * halfV, c1z = z + tz * halfU - bz * halfV;
    const c2x = x + tx * halfU + bx * halfV, c2y = y + ty * halfU + by * halfV, c2z = z + tz * halfU + bz * halfV;
    const c3x = x - tx * halfU + bx * halfV, c3y = y - ty * halfU + by * halfV, c3z = z - tz * halfU + bz * halfV;

    const writeV = (px, py, pz, lu, lv) => {
      d[w] = px; d[w + 1] = py; d[w + 2] = pz;
      d[w + 3] = nx; d[w + 4] = ny; d[w + 5] = nz;
      d[w + 6] = lu; d[w + 7] = lv;
      d[w + 8] = kind; d[w + 9] = stretch; d[w + 10] = weber; d[w + 11] = seed;
      d[w + 12] = oxy; d[w + 13] = dry; d[w + 14] = por; d[w + 15] = fade;
      d[w + 16] = tx; d[w + 17] = ty; d[w + 18] = tz;
      w += DECAL_STRIDE;
    };
    writeV(c0x, c0y, c0z, -1, -1);
    writeV(c1x, c1y, c1z,  1, -1);
    writeV(c2x, c2y, c2z,  1,  1);
    writeV(c0x, c0y, c0z, -1, -1);
    writeV(c2x, c2y, c2z,  1,  1);
    writeV(c3x, c3y, c3z, -1,  1);
    s.len = w;
  }

  _pushMistQuad(x, y, z, r, rx, ry, rz, ux, uy, uz, rot, oxy, density, seed, fade, age) {
    const s = this.mistStream;
    ensureStream(s, 6 * MIST_STRIDE);
    const d = s.data;
    let w = s.len;

    const c0x = x - rx * r - ux * r, c0y = y - ry * r - uy * r, c0z = z - rz * r - uz * r;
    const c1x = x + rx * r - ux * r, c1y = y + ry * r - uy * r, c1z = z + rz * r - uz * r;
    const c2x = x + rx * r + ux * r, c2y = y + ry * r + uy * r, c2z = z + rz * r + uz * r;
    const c3x = x - rx * r + ux * r, c3y = y - ry * r + uy * r, c3z = z - rz * r + uz * r;

    const writeV = (px, py, pz, lu, lv) => {
      d[w] = px; d[w + 1] = py; d[w + 2] = pz;
      d[w + 3] = lu; d[w + 4] = lv;
      d[w + 5] = rot; d[w + 6] = oxy; d[w + 7] = density; d[w + 8] = seed;
      d[w + 9] = fade; d[w + 10] = age;
      w += MIST_STRIDE;
    };
    writeV(c0x, c0y, c0z, -1, -1);
    writeV(c1x, c1y, c1z,  1, -1);
    writeV(c2x, c2y, c2z,  1,  1);
    writeV(c0x, c0y, c0z, -1, -1);
    writeV(c2x, c2y, c2z,  1,  1);
    writeV(c3x, c3y, c3z, -1,  1);
    s.len = w;
  }

  _pushDropQuad(c0x, c0y, c0z, c1x, c1y, c1z, c2x, c2y, c2z, c3x, c3y, c3z, u0, u1, ax, ay, az, oxy, kind, thick, seed, fade, stretch) {
    const s = this.dropStream;
    ensureStream(s, 6 * DROP_STRIDE);
    const d = s.data;
    let w = s.len;
    const writeV = (px, py, pz, lu, lv) => {
      d[w] = px; d[w + 1] = py; d[w + 2] = pz;
      d[w + 3] = lu; d[w + 4] = lv;
      d[w + 5] = ax; d[w + 6] = ay; d[w + 7] = az;
      d[w + 8] = oxy; d[w + 9] = kind; d[w + 10] = thick; d[w + 11] = seed;
      d[w + 12] = fade; d[w + 13] = stretch;
      w += DROP_STRIDE;
    };
    writeV(c0x, c0y, c0z, u0, -1);
    writeV(c1x, c1y, c1z, u1, -1);
    writeV(c2x, c2y, c2z, u1,  1);
    writeV(c0x, c0y, c0z, u0, -1);
    writeV(c2x, c2y, c2z, u1,  1);
    writeV(c3x, c3y, c3z, u0,  1);
    s.len = w;
  }

  /** Renders all 3D HemoFlux passes (decals, pools, wall rivulets, mist, ribbons, droplets). */
  renderWorld(hemo, {vp, eye, right, up, frustum, output, khdrOn, quality, weatherVec, lightPos, lightCol, lightCount, lite = false}) {
    if (!hemo) return;
    const hasAny =
      hemo.decals.length > 0 ||
      hemo.rivulets.length > 0 ||
      hemo.mists.length > 0 ||
      hemo.droplets.length > 0 ||
      hemo.ribbons.length > 0;
    if (!hasAny) return;

    const gl = this.gl;
    const ex = eye[0], ey = eye[1], ez = eye[2];
    const rx = right[0], ry = right[1], rz = right[2];
    const ux = up[0], uy = up[1], uz = up[2];

    this.decalStream.len = 0;
    this.mistStream.len = 0;
    this.dropStream.len = 0;

    // 1. Pack Forensic BPA Surface Decals & Expanding Huppert Pools
    const decals = hemo.decals;
    const dStep = lite ? 2 : 1;
    for (let i = 0; i < decals.length; i += dStep) {
      const dc = decals[i];
      const dx = dc.x - ex, dz = dc.z - ez;
      if (dx * dx + dz * dz > 3025) continue; // 55m LOD cutoff
      const maxR = dc.r * (dc.pool ? 1.45 : Math.max(1.35, dc.stretch * 0.92));
      if (frustum && !sphereInFrustum(frustum, dc.x, dc.y, dc.z, maxR)) continue;

      const nx = dc.nx, ny = dc.ny, nz = dc.nz;
      // Ensure tangent is strictly orthogonal to surface normal
      let tx = dc.tx, ty = dc.ty, tz = dc.tz;
      const dotNT = tx * nx + ty * ny + tz * nz;
      tx -= nx * dotNT; ty -= ny * dotNT; tz -= nz * dotNT;
      let tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-4) {
        tx = Math.abs(ny) > 0.9 ? 1 : -nz;
        ty = 0;
        tz = Math.abs(ny) > 0.9 ? 0 : nx;
        tl = Math.hypot(tx, ty, tz) || 1;
      }
      tx /= tl; ty /= tl; tz /= tl;
      // Bitangent b = cross(n, t)
      const bx = ny * tz - nz * ty;
      const by = nz * tx - nx * tz;
      const bz = nx * ty - ny * tx;

      const fade = clamp(dc.life / 3.5, 0, 1);
      const dry = clamp((dc.age / 20.0) * (dc.dryMul || 1.0), 0, 1);
      const halfU = dc.r * (dc.pool ? 1.38 : clamp(0.95 + dc.stretch * 0.42, 1.25, 2.55));
      const halfV = dc.r * (dc.pool ? 1.38 : 1.25);
      this._pushDecalQuad(
        dc.x, dc.y, dc.z, nx, ny, nz, tx, ty, tz, bx, by, bz,
        halfU, halfV, dc.kind, dc.stretch, dc.weber, dc.seed, dc.oxygen, dry, dc.porosity, fade
      );
    }

    // 2. Pack Vertical Wall Gravity Rivulets (Drips/Runs!)
    const rivs = hemo.rivulets;
    if (!lite) {
      for (let i = 0; i < rivs.length; i++) {
        const rv = rivs[i];
        const dx = rv.x - ex, dz = rv.z - ez;
        if (dx * dx + dz * dz > 2025) continue;
        const midY = rv.y - rv.len * 0.5;
        if (frustum && !sphereInFrustum(frustum, rv.x, midY, rv.z, rv.len * 0.65 + 0.15)) continue;
        const nx = rv.nx, ny = rv.ny, nz = rv.nz;
        // Tangent points straight downward along wall (-Y projected onto wall plane)
        let tx = ny * nx, ty = -(1 - ny * ny), tz = ny * nz;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        const bx = ny * tz - nz * ty;
        const by = nz * tx - nx * tz;
        const bz = nx * ty - ny * tx;
        const fade = clamp(rv.life / 3.2, 0, 1);
        const dry = clamp((rv.age / 16.0) * (rv.dryMul || 1.0), 0, 1);
        this._pushDecalQuad(
          rv.x + tx * rv.len * 0.5, rv.y + ty * rv.len * 0.5, rv.z + tz * rv.len * 0.5,
          nx, ny, nz, tx, ty, tz, bx, by, bz,
          rv.len * 0.54, rv.width * 1.45,
          3.0, 1.0, 0.2, rv.seed, rv.oxygen, dry, rv.porosity, fade
        );
      }
    }

    // 3. Pack Volumetric Backlit Hemoglobin Aerosol Mist
    const mists = hemo.mists;
    if (!lite) {
      for (let i = 0; i < mists.length; i++) {
        const bm = mists[i];
        if (frustum && !sphereInFrustum(frustum, bm.x, bm.y, bm.z, bm.r * 1.4)) continue;
        const lifeFrac = clamp(bm.life / (bm.maxLife || 0.8), 0, 1);
        const fadeIn = clamp(bm.age / 0.06, 0, 1);
        this._pushMistQuad(
          bm.x, bm.y, bm.z, bm.r, rx, ry, rz, ux, uy, uz,
          bm.rot, bm.oxygen, bm.density, bm.seed, fadeIn * lifeFrac * lifeFrac, bm.age
        );
      }
    }

    // 4. Pack Coherent Liquid Arterial Ribbons (continuous miter-joined spline strips, zero segment cracks!)
    const ribbons = hemo.ribbons;
    if (!lite && ribbons.length > 0) {
      const sideBuf = this._ribSides || (this._ribSides = new Float32Array(12 * 3));
      const tangBuf = this._ribTangs || (this._ribTangs = new Float32Array(12 * 3));
      for (let i = 0; i < ribbons.length; i++) {
        const rb = ribbons[i];
        const nodes = rb.nodes;
        const nCount = rb.count;
        if (frustum && !sphereInFrustum(frustum, nodes[0], nodes[1], nodes[2], 2.2)) continue;
        const fade = clamp(rb.life / (rb.maxLife || 0.3), 0, 1);
        for (let k = 0; k < nCount; k++) {
          const pPrev = Math.max(0, k - 1) * 6;
          const pNext = Math.min(nCount - 1, k + 1) * 6;
          const o = k * 6;
          let ax = nodes[pNext] - nodes[pPrev];
          let ay = nodes[pNext + 1] - nodes[pPrev + 1];
          let az = nodes[pNext + 2] - nodes[pPrev + 2];
          const al = Math.hypot(ax, ay, az) || 1;
          ax /= al; ay /= al; az /= al;
          const vx = ex - nodes[o], vy = ey - nodes[o + 1], vz = ez - nodes[o + 2];
          let sx = vy * az - vz * ay, sy = vz * ax - vx * az, sz = vx * ay - vy * ax;
          const sl = Math.hypot(sx, sy, sz) || 1;
          const k3 = k * 3;
          tangBuf[k3] = ax; tangBuf[k3 + 1] = ay; tangBuf[k3 + 2] = az;
          sideBuf[k3] = sx / sl; sideBuf[k3 + 1] = sy / sl; sideBuf[k3 + 2] = sz / sl;
        }
        for (let k = 0; k < nCount - 1; k++) {
          const o0 = k * 6, o1 = (k + 1) * 6;
          const k0 = k * 3, k1 = (k + 1) * 3;
          const x0 = nodes[o0], y0 = nodes[o0 + 1], z0 = nodes[o0 + 2];
          const x1 = nodes[o1], y1 = nodes[o1 + 1], z1 = nodes[o1 + 2];
          const s0x = sideBuf[k0], s0y = sideBuf[k0 + 1], s0z = sideBuf[k0 + 2];
          const s1x = sideBuf[k1], s1y = sideBuf[k1 + 1], s1z = sideBuf[k1 + 2];
          const t0 = k / (nCount - 1), t1 = (k + 1) / (nCount - 1);
          const w0 = rb.thickness * (1.28 - t0 * 0.62) * (0.45 + 0.55 * fade);
          const w1 = rb.thickness * (1.28 - t1 * 0.62) * (0.45 + 0.55 * fade);
          this._pushDropQuad(
            x0 - s0x * w0, y0 - s0y * w0, z0 - s0z * w0,
            x1 - s1x * w1, y1 - s1y * w1, z1 - s1z * w1,
            x1 + s1x * w1, y1 + s1y * w1, z1 + s1z * w1,
            x0 + s0x * w0, y0 + s0y * w0, z0 + s0z * w0,
            t0, t1,
            (tangBuf[k0] + tangBuf[k1]) * 0.5,
            (tangBuf[k0 + 1] + tangBuf[k1 + 1]) * 0.5,
            (tangBuf[k0 + 2] + tangBuf[k1 + 2]) * 0.5,
            rb.oxygen, 1.0, rb.thickness, rb.seed, fade, 1.0
          );
        }
      }
    }

    // 5. Pack Velocity-Stretched 3D Teardrop Capsules (airborne droplets)
    const drops = hemo.droplets;
    const drStep = lite ? 2 : 1;
    for (let i = 0; i < drops.length; i += drStep) {
      const dr = drops[i];
      if (frustum && !sphereInFrustum(frustum, dr.x, dr.y, dr.z, 0.35)) continue;
      const spd = Math.hypot(dr.vx, dr.vy, dr.vz);
      const ax = spd > 0.05 ? dr.vx / spd : 0;
      const ay = spd > 0.05 ? dr.vy / spd : -1;
      const az = spd > 0.05 ? dr.vz / spd : 0;
      const vx = ex - dr.x, vy = ey - dr.y, vz = ez - dr.z;
      let sx = vy * az - vz * ay, sy = vz * ax - vx * az, sz = vx * ay - vy * ax;
      const sl = Math.hypot(sx, sy, sz);
      if (sl > 1e-4) { sx /= sl; sy /= sl; sz /= sl; }
      else { sx = rx; sy = ry; sz = rz; }

      const halfW = clamp(dr.r * 1.45, 0.009, 0.042);
      const halfL = clamp(halfW + spd * 0.017, halfW * 1.25, 0.24);
      const fade = clamp(dr.life / 0.25, 0, 1);
      // Center slightly forward so leading head is at +1, tail stretches back to -1
      const c0x = dr.x - ax * halfL - sx * halfW, c0y = dr.y - ay * halfL - sy * halfW, c0z = dr.z - az * halfL - sz * halfW;
      const c1x = dr.x + ax * halfL * 0.45 - sx * halfW, c1y = dr.y + ay * halfL * 0.45 - sy * halfW, c1z = dr.z + az * halfL * 0.45 - sz * halfW;
      const c2x = dr.x + ax * halfL * 0.45 + sx * halfW, c2y = dr.y + ay * halfL * 0.45 + sy * halfW, c2z = dr.z + az * halfL * 0.45 + sz * halfW;
      const c3x = dr.x - ax * halfL + sx * halfW, c3y = dr.y - ay * halfL + sy * halfW, c3z = dr.z - az * halfL + sz * halfW;
      this._pushDropQuad(
        c0x, c0y, c0z, c1x, c1y, c1z, c2x, c2y, c2z, c3x, c3y, c3z,
        -1.0, 1.0, ax, ay, az, dr.oxygen, 0.0, dr.r, (i * 19.7) % 100, fade, halfL / halfW
      );
    }

    // Bind WebGL2 blend state (depth test ON, depth write OFF, smooth alpha blending, zero z-fighting!)
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    const setShared = (p) => {
      gl.useProgram(p.obj);
      gl.uniformMatrix4fv(p.uVP, false, vp);
      gl.uniform3fv(p.uEye, eye);
      gl.uniform1i(p.uOutput, output);
      gl.uniform1i(p.uKHDR, khdrOn ? 1 : 0);
      if (p.uWeather != null && weatherVec) gl.uniform4fv(p.uWeather, weatherVec);
    };

    // Pass A: Forensic Decals, Pools & Wall Rivulets
    if (this.decalStream.len > 0) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-2.0, -2.0);
      setShared(this.decalP);
      if (this.decalP.uQuality != null) gl.uniform1i(this.decalP.uQuality, quality);
      if (this.decalP.uLightCount != null) gl.uniform1i(this.decalP.uLightCount, lightCount || 0);
      if (this.decalP.uLights != null && lightPos) gl.uniform4fv(this.decalP.uLights, lightPos);
      if (this.decalP.uLightCol != null && lightCol) gl.uniform3fv(this.decalP.uLightCol, lightCol);
      uploadAndDraw(gl, this.decalStream);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    // Pass B: Volumetric Backlit Hemoglobin Mist
    if (this.mistStream.len > 0) {
      setShared(this.mistP);
      uploadAndDraw(gl, this.mistStream);
    }

    // Pass C: Glossy 3D Droplets & Coherent Arterial Ribbons
    if (this.dropStream.len > 0) {
      setShared(this.dropP);
      uploadAndDraw(gl, this.dropStream);
    }

    // Restore WebGL2 state cleanly
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** Fallback direct visor blood pass when KHDR offscreen composite is not active. */
  renderVisorDirect(hemo, {aspect, output, khdrOn, weatherVec, emptyVao}) {
    if (!hemo || hemo.visorActiveCount <= 0) return;
    const gl = this.gl;
    const p = this.visorP;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.useProgram(p.obj);
    gl.uniform1i(p.uOutput, output);
    gl.uniform1i(p.uKHDR, khdrOn ? 1 : 0);
    if (p.uWeather != null && weatherVec) gl.uniform4fv(p.uWeather, weatherVec);
    if (p.uVisorAspect != null) gl.uniform1f(p.uVisorAspect, aspect || 16 / 9);
    if (p.uVisorOn != null) gl.uniform1i(p.uVisorOn, 1);
    if (p.uVisorCount != null) gl.uniform1i(p.uVisorCount, hemo.visorActiveCount);
    if (p.uVisorDrop != null) gl.uniform4fv(p.uVisorDrop, hemo.uVisorDrop);
    if (p.uVisorMeta != null) gl.uniform4fv(p.uVisorMeta, hemo.uVisorMeta);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
  }
}
