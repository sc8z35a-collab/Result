// KHDR (Kinetic High Dynamic Range) — Custom Perceptual & Wide-Gamut HDR Rendering Pipeline for WebGL2.
//
// Core Proprietary Techniques:
//   1. Dual-Precision HDR Surface: True 16-bit Half-Float Linear FBO (RGBA16F) with automatic 14-Stop Log-K fallback
//   2. K-Adapt: Pure-GPU Foveal-Weighted 16x16 -> 4x4 -> 1x1 Temporal Eye Adaptation (zero CPU readPixels stall)
//   3. K-Filmic: Spectral Inset/Outset Color Matrix + Strict-Asymptote Dual-Knee 16x HDR Curve (zero ACES hue skew)
//   4. K-LCE: 8-Tap Bilateral Edge-Aware Local Micro-Contrast Enhancement & Shadow Chromatic Recovery (halo-free)
//   5. K-Halo: Karis Firefly-Free Dual-Stage Bloom + Horizontal Anamorphic Peak Glare Streak
//   6. K-Extended: 16x Linear Nit Headroom WebGPU Bridge for true HDR10+/OLED displays

import {clamp} from './geometry.js';
import {SCHLIEREN_COMPOSITE_GLSL} from './schlieren.js';
import {AERO_COMPOSITE_GLSL} from './aerovortex.js';
import {THERMO_COMPOSITE_GLSL} from './thermoflux.js';

function makeProgram(gl, vs, fs) {
  const obj = gl.createProgram(), sh = [];
  for (const [type, code] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('KHDR shader: ' + gl.getShaderInfoLog(s));
    gl.attachShader(obj, s);
    sh.push(s);
  }
  gl.linkProgram(obj);
  if (!gl.getProgramParameter(obj, gl.LINK_STATUS)) throw Error('KHDR link: ' + gl.getProgramInfoLog(obj));
  for (const s of sh) gl.deleteShader(s);
  const loc = {};
  for (let i = 0; i < gl.getProgramParameter(obj, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(obj, i).name;
    loc[name.replace('[0]', '')] = gl.getUniformLocation(obj, name);
  }
  return {obj, ...loc};
}

function makeTarget(gl, w, h, internalFormat, withDepthTex = false) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, w, h);
  for (const [k, v] of [
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]
  ]) gl.texParameteri(gl.TEXTURE_2D, k, v);

  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  let depthTex = null, vmFb = null, vmDepthRb = null;
  if (withDepthTex) {
    depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
  }

  let ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  if (ok && withDepthTex) {
    // Dedicated viewmodel FBO sharing the same HDR color target with its own depth buffer so
    // depthTex stays 100% pure world+actor depth for AeroVortex ray-marching & ThermoFlux FLIR!
    vmDepthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, vmDepthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    vmFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, vmFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, vmDepthRb);
    ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteTexture(tex);
    if (depthTex) gl.deleteTexture(depthTex);
    if (vmDepthRb) gl.deleteRenderbuffer(vmDepthRb);
    if (vmFb) gl.deleteFramebuffer(vmFb);
    gl.deleteFramebuffer(fb);
    return null;
  }
  return {fb, tex, depthTex, vmFb, vmDepthRb, w, h, format: internalFormat};
}

function destroyTarget(gl, t) {
  if (!t) return;
  if (t.tex) gl.deleteTexture(t.tex);
  if (t.depthTex) gl.deleteTexture(t.depthTex);
  if (t.vmDepthRb) gl.deleteRenderbuffer(t.vmDepthRb);
  if (t.vmFb) gl.deleteFramebuffer(t.vmFb);
  if (t.fb) gl.deleteFramebuffer(t.fb);
}

// Shared GLSL block: K-Filmic spectral inset/outset tone mapper + 14-Stop Log-K encode/decode
export const KHDR_TONE_GLSL = `
// Column-major spectral inset/outset matrices (row sums = 1.000000 for exact white-point neutrality)
const mat3 K_INSET=mat3(
   .856627, .095121, .024148,
   .137319, .761242, .119038,
   .006054, .143637, .856814
);
const mat3 K_OUTSET=mat3(
  1.213019,-.161221,-.014577,
  -.241465,1.414641,-.203667,
   .028446,-.253420,1.218244
);

vec3 kEncodeLogK(vec3 c){
  return clamp(log2(1.+max(c,vec3(0.))*4.)/6.,0.,1.);
}
vec3 kDecodeLogK(vec3 v){
  return max(vec3(0.),(exp2(v*6.)-1.)*.25);
}
vec3 kToneCurve(vec3 x){
  x=max(x,vec3(0.));
  return clamp((x*(2.68*x+.022))/(x*(2.68*x+.62)+.165),0.,1.);
}
vec3 kFilmicSDR(vec3 c){
  vec3 ins=K_INSET*max(c,vec3(0.));
  vec3 curved=kToneCurve(ins);
  vec3 outC=clamp(K_OUTSET*curved,0.,1.);
  // K-Punch: perceptual midtone vibrance while keeping highlights luminous & unclipped
  float l=dot(outC,vec3(.2126,.7152,.0722));
  float sat=1.+.19*(1.-l*l)*min(1.,l*4.5);
  outC=clamp(mix(vec3(l),outC,sat),0.,1.);
  return pow(outC,vec3(1./2.2));
}
vec3 kFilmicExtended(vec3 c){
  // Preserve 15x linear highlight headroom for native WebGPU HDR10+/OLED output
  vec3 base=clamp(K_OUTSET*kToneCurve(K_INSET*max(c,vec3(0.))),0.,1.);
  vec3 peak=max(c-vec3(1.05),vec3(0.))*.72;
  vec3 ext=base+peak;
  return clamp(log2(1.+ext)/4.,0.,1.);
}
`;

// K-Adapt Stage 1: Foveal-weighted 16x16 log-luminance metering
const khdrAdapt16FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform int uLinear;
out vec4 frag;
${KHDR_TONE_GLSL}
vec3 dec(vec3 v){return uLinear==1?max(v,vec3(0.)):kDecodeLogK(v);}
void main(){
  vec2 cell=vec2(1./16.);
  vec2 base=floor(vUV*16.)*cell;
  float sumL=0.,sumW=0.;
  for(int y=0;y<2;y++){
    for(int x=0;x<2;x++){
      vec2 suv=base+vec2(float(x)+.5,float(y)+.5)*(cell*.5);
      vec3 c=dec(texture(uScene,suv).rgb);
      float lum=dot(c,vec3(.2126,.7152,.0722));
      float logL=clamp(log2(max(lum,.025)),-5.,3.5);
      vec2 fc=suv-.5;
      float w=.42+.58*exp(-3.8*dot(fc,fc));
      sumL+=logL*w;
      sumW+=w;
    }
  }
  float avg=(sumL/max(sumW,1e-4)+5.)/8.5;
  frag=vec4(clamp(avg,0.,1.),clamp(sumW*.25,0.,1.),0.,1.);
}`;

// K-Adapt Stage 2: 16x16 -> 4x4 weighted reduction
const khdrAdapt4FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 frag;
void main(){
  vec2 base=floor(vUV*4.)*.25;
  float sL=0.,sW=0.;
  for(int y=0;y<4;y++){
    for(int x=0;x<4;x++){
      vec2 uv=base+(vec2(float(x),float(y))+.5)/16.;
      vec2 d=texture(uTex,uv).rg;
      sL+=d.r*d.g;
      sW+=d.g;
    }
  }
  frag=vec4(sL/max(sW,1e-4),clamp(sW/16.,0.,1.),0.,1.);
}`;

// K-Adapt Stage 3: 4x4 -> 1x1 temporal cone/rod eye adaptation (zero CPU stall!)
const khdrAdapt1FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform sampler2D uPrev;
uniform float uDt;
uniform int uReset;
out vec4 frag;
void main(){
  float sL=0.,sW=0.;
  for(int y=0;y<4;y++){
    for(int x=0;x<4;x++){
      vec2 uv=(vec2(float(x),float(y))+.5)/4.;
      vec2 d=texture(uTex,uv).rg;
      sL+=d.r*d.g;
      sW+=d.g;
    }
  }
  float target=clamp(sL/max(sW,1e-4),0.,1.);
  if(uReset==1){
    frag=vec4(target,1.,0.,1.);
    return;
  }
  float prev=texture(uPrev,vec2(.5)).r;
  float rate=target>prev?2.5:1.65;
  float a=1.-exp(-rate*clamp(uDt,.001,.2));
  frag=vec4(mix(prev,target,a),1.,0.,1.);
}`;

// K-Halo: Karis-averaged Firefly-Free Soft-Knee Bloom Extract
const khdrBloomExtractFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform int uLinear;
uniform int uKHDR;
out vec4 frag;
${KHDR_TONE_GLSL}
vec3 dec(vec3 v){return uLinear==1?max(v,vec3(0.)):kDecodeLogK(v);}
vec3 enc(vec3 c){return uLinear==1?max(c,vec3(0.)):kEncodeLogK(c);}
float karisW(vec3 c){return 1./(1.+max(c.r,max(c.g,c.b)));}
void main(){
  vec2 t=1./vec2(textureSize(uScene,0));
  vec3 c0=dec(texture(uScene,vUV).rgb);
  vec3 c1=dec(texture(uScene,vUV+vec2(-t.x,-t.y)).rgb);
  vec3 c2=dec(texture(uScene,vUV+vec2(t.x,-t.y)).rgb);
  vec3 c3=dec(texture(uScene,vUV+vec2(-t.x,t.y)).rgb);
  vec3 c4=dec(texture(uScene,vUV+vec2(t.x,t.y)).rgb);
  vec3 c;
  if(uKHDR==1){
    // Karis average suppresses 1-pixel specular fireflies during movement
    float w0=karisW(c0)*.4,w1=karisW(c1)*.15,w2=karisW(c2)*.15,w3=karisW(c3)*.15,w4=karisW(c4)*.15;
    c=(c0*w0+c1*w1+c2*w2+c3*w3+c4*w4)/max(w0+w1+w2+w3+w4,1e-4);
    float peak=max(c.r,max(c.g,c.b));
    float knee=.52,thresh=.84;
    float soft=clamp(peak-thresh+knee,0.,2.*knee);
    soft=(soft*soft)/(4.*knee+1e-4);
    float contrib=max(soft,peak-thresh)/max(peak,1e-4);
    vec3 outC=c*contrib*.86;
    frag=vec4(enc(outC),1.);
  } else {
    c=.25*(c1+c2+c3+c4);
    float lum=dot(c,vec3(.2126,.7152,.0722));
    float soft=smoothstep(.88,1.95,lum);
    frag=vec4(enc(c*soft*.82),1.);
  }
}`;

// Dual-purpose Separable Blur (Gaussian Bloom + Horizontal Anamorphic Peak Glare Streak)
const khdrBlurFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;
uniform int uLinear;
uniform float uPeakGate; // 0 = normal blur, >0 = extract ultra-bright peaks for anamorphic streak
out vec4 frag;
${KHDR_TONE_GLSL}
vec3 dec(vec3 v){return uLinear==1?max(v,vec3(0.)):kDecodeLogK(v);}
vec3 enc(vec3 c){return uLinear==1?max(c,vec3(0.)):kEncodeLogK(c);}
vec3 sampleIn(vec2 uv){
  vec3 c=dec(texture(uTex,uv).rgb);
  if(uPeakGate>.01){
    float l=max(c.r,max(c.g,c.b));
    c*=smoothstep(uPeakGate,uPeakGate+1.2,l);
  }
  return c;
}
void main(){
  const float w[5]=float[5](.227027,.1945946,.1216216,.054054,.016216);
  vec3 acc=sampleIn(vUV)*w[0];
  for(int i=1;i<5;i++){
    vec2 off=uDir*float(i)*1.35;
    acc+=sampleIn(vUV+off)*w[i];
    acc+=sampleIn(vUV-off)*w[i];
  }
  frag=vec4(enc(acc),1.);
}`;

// Master Unified Composite Shader:
// Shadow Flame 1.0 Pro Resolve (SSCS + GTAO-Lite + Volumetric Shafts) +
// KHDR (K-Adapt + K-LCE Bilateral Micro-Contrast + K-Halo Bloom & Anamorphic Streak + K-Filmic Spectral Tone Mapper) +
// Perceptual-Luma FXAA + Dynamic Combat Chromatic Aberration + Vignette + Anti-Banding Dither!
const khdrCompositeFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloomA;
uniform sampler2D uBloomB;
uniform sampler2D uStreak;
uniform sampler2D uSfScreen;
uniform sampler2D uAdapt;
uniform int uOutput;      // 0=SDR, 1=HDR(SDR tonemapped), 2=HDR Native WebGPU Extended
uniform int uLinear;      // 1=RGBA16F linear scene, 0=RGBA8 14-stop Log-K
uniform int uKHDR;        // 1=KHDR enhanced pipeline, 0=classic HDR/SDR
uniform int uHasBloom;    // 1=add bloom pyramid
uniform int uUseFXAA;     // 1=apply perceptual-luma FXAA
uniform int uUseSfScreen; // 1=apply Shadow Flame 1.0 Pro SSCS + GTAO + Volumetric Shafts
uniform float uShake;
uniform float uHurt;
uniform float uTime;
out vec4 frag;

${KHDR_TONE_GLSL}
${SCHLIEREN_COMPOSITE_GLSL}
${AERO_COMPOSITE_GLSL}
${THERMO_COMPOSITE_GLSL}

vec3 dec(vec3 v){return uLinear==1?max(v,vec3(0.)):kDecodeLogK(v);}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
float pLuma(vec3 c){
  vec3 m=c/(1.+c);
  return sqrt(max(0.,dot(m,vec3(.2126,.7152,.0722))));
}

vec3 toneOut(vec3 c){
  c=max(c,vec3(0.));
  if(uKHDR==1){
    if(uOutput==2)return kFilmicExtended(c);
    return kFilmicSDR(c);
  }
  if(uOutput==2){
    vec3 extended=aces(c*.85)+max(c-vec3(1.),0.)*.52;
    return clamp(log2(1.+extended)/3.,0.,1.);
  }
  if(uOutput==1)return pow(aces(c*.90),vec3(1./2.2));
  return pow(clamp(c*.97,0.,1.),vec3(1./2.2));
}

void main(){
  vec2 px=1./vec2(textureSize(uScene,0));
  vec2 fromC=vUV-.5;
  float r2=dot(fromC,fromC);
  vec4 rawM=texture(uScene,vUV);
  float worldMask=smoothstep(.25,.75,rawM.a);

  // 0. SchlierenOptics 1.0: Gladstone-Dale Refractive Shockwave Lensing + Cauchy Prismatic Dispersion + Thermal Mirage!
  vec2 sUV,sDisp;
  float sRim;
  schlierenEvaluate(vUV,worldMask,uTime,sUV,sDisp,sRim);
  vec2 uvR=clamp(vUV+sUV,vec2(.001),vec2(.999));
  vec3 base;
  if(dot(sUV,sUV)+dot(sDisp,sDisp)>1e-8){
    vec4 sG=texture(uScene,uvR);
    // Guard against bleeding foreground first-person weapon pixels into refracted background world
    float refrMask=smoothstep(.25,.75,sG.a)*worldMask;
    vec2 uvEff=mix(vUV,uvR,refrMask);
    vec2 dispEff=sDisp*refrMask;
    vec3 gCol=dec(texture(uScene,uvEff).rgb);
    if(dot(dispEff,dispEff)>1e-9){
      float rCol=dec(texture(uScene,clamp(uvEff+dispEff,vec2(.001),vec2(.999))).rgb).r;
      float bCol=dec(texture(uScene,clamp(uvEff-dispEff,vec2(.001),vec2(.999))).rgb).b;
      base=vec3(rCol,gCol.g,bCol);
    } else {
      base=gCol;
    }
    base+=vec3(.92,.98,1.14)*sRim*refrMask;
  } else {
    base=dec(rawM.rgb);
  }

  // 1. Perceptual-Luma FXAA (operates cleanly in both FP16 linear HDR & Log-K!)
  if(uUseFXAA==1 && dot(sUV,sUV)<1e-6){
    vec3 cNW=dec(texture(uScene,vUV+vec2(-px.x,-px.y)).rgb);
    vec3 cNE=dec(texture(uScene,vUV+vec2(px.x,-px.y)).rgb);
    vec3 cSW=dec(texture(uScene,vUV+vec2(-px.x,px.y)).rgb);
    vec3 cSE=dec(texture(uScene,vUV+vec2(px.x,px.y)).rgb);
    float lNW=pLuma(cNW),lNE=pLuma(cNE),lSW=pLuma(cSW),lSE=pLuma(cSE),lM=pLuma(base);
    float lMin=min(lM,min(min(lNW,lNE),min(lSW,lSE)));
    float lMax=max(lM,max(max(lNW,lNE),max(lSW,lSE)));
    if(lMax-lMin>.042){
      vec2 d=vec2(-((lNW+lNE)-(lSW+lSE)),(lNW+lSW)-(lNE+lSE));
      float dReduce=max((lNW+lNE+lSW+lSE)*.03125,.0078125);
      float rcp=1./(min(abs(d.x),abs(d.y))+dReduce);
      d=clamp(d*rcp,vec2(-4.),vec2(4.))*px;
      vec3 a=.5*(dec(texture(uScene,vUV+d*(1./3.-.5)).rgb)+dec(texture(uScene,vUV+d*(2./3.-.5)).rgb));
      vec3 b=a*.5+.25*(dec(texture(uScene,vUV+d*-.5).rgb)+dec(texture(uScene,vUV+d*.5).rgb));
      float lb=pLuma(b);
      base=(lb<lMin||lb>lMax)?a:b;
    }
  }

  // 2. Subtle dynamic combat chromatic aberration (Extra / KHDR)
  float ca=(uHasBloom==1?(.0010+uShake*.0036+uHurt*.0052):(uShake*.0028+uHurt*.0045))*r2;
  if(ca>.00018){
    vec2 dir=fromC*ca;
    base.r=mix(base.r,dec(texture(uScene,vUV+dir).rgb).r,.72);
    base.b=mix(base.b,dec(texture(uScene,vUV-dir).rgb).b,.72);
  }

  // 3. Shadow Flame 1.0 Pro Screen-Space Resolve (SSCS + GTAO-Lite + 3D Shadowed Volumetric God-Rays)
  // Masked strictly to world + actors + sky (worldMask) so close-up viewmodel weapons stay spotless!
  if(uUseSfScreen==1 && worldMask>.01){
    vec3 sf=texture(uSfScreen,vUV).rgb;
    float occ=clamp(sf.r*sf.g,.22,1.);
    // Physical cool Rayleigh tint in deep contact/cavity shadows instead of flat neutral grey
    vec3 occTint=mix(vec3(.80,.90,1.06),vec3(1.),occ);
    base=mix(base,base*occ*occTint,worldMask);
    // Sculpted Volumetric Golden Marine Sun Shafts cutting through container alleys (zero milky washout!)
    vec3 shaftCol=vec3(1.26,.92,.52)*sf.b*(uKHDR==1?.26:.20);
    base+=shaftCol*worldMask;
  }

  // 3b. AeroVortex 1.0 Depth-Occluded 3D Volumetric Navier-Stokes Smoke + ThermoFlux 1.0 GPU Cyber-FLIR Visor!
  if(uAeroOn==1 || uFlirBlend>.005){
    float sceneDepth=texture(uSceneDepth,vUV).r;
    if(uAeroOn==1 && uFlirBlend<.88){
      vec3 smokeCol=base;
      applyAeroVortex(vUV,worldMask,sceneDepth,uTime,smokeCol);
      base=mix(smokeCol,base,smoothstep(.15,.85,uFlirBlend));
    }
    if(uFlirBlend>.005){
      base=applyThermoFluxFLIR(vUV,worldMask,sceneDepth,uTime,base);
    }
  }

  // 4. KHDR Perceptual Enhancement Pipeline (K-Adapt + K-LCE + K-Halo + Warm/Cool Split)
  vec3 c=base;
  if(uKHDR==1){
    // 4a. K-Adapt GPU Eye-Adaptation Exposure (calibrated to linear outdoor middle-grey key 0.24)
    float adaptNorm=texture(uAdapt,vec2(.5)).r;
    float avgLum=exp2(adaptNorm*8.5-5.);
    float expMul=clamp(pow(.24/max(avgLum,.05),.32),.84,1.28);
    c*=expMul;

    // 4b. K-LCE: 8-Tap Bilateral Edge-Aware Local Micro-Contrast (crisp texture clarity with ZERO halo!)
    float lumC=max(dot(c,vec3(.2126,.7152,.0722)),1e-4);
    float logC=log2(lumC);
    const vec2 RING[8]=vec2[8](
      vec2(-4.2,-4.2),vec2(4.2,-4.2),vec2(-4.2,4.2),vec2(4.2,4.2),
      vec2(-10.5,0.),vec2(10.5,0.),vec2(0.,-10.5),vec2(0.,10.5)
    );
    float locSum=0.,wSum=0.;
    for(int i=0;i<8;i++){
      vec3 nc=dec(texture(uScene,vUV+RING[i]*px).rgb)*expMul;
      float nl=log2(max(dot(nc,vec3(.2126,.7152,.0722)),1e-4));
      float bw=exp(-abs(nl-logC)*2.8)*(i<4?1.:.65);
      locSum+=nl*bw;
      wSum+=bw;
    }
    float localLog=locSum/max(wSum,1e-4);
    float detail=clamp(logC-localLog,-.42,.42);
    float midGate=(1.-smoothstep(1.3,3.2,lumC))*smoothstep(.012,.06,lumC);
    c*=exp2(detail*.28*midGate);

    // 4c. Shadow Chromatic Depth & Subtle Warm-Sun / Cool-Shade Radiance Split
    float shMask=1.-smoothstep(.04,.38,lumC);
    float hiMask=smoothstep(.85,2.4,lumC);
    float cL=dot(c,vec3(.2126,.7152,.0722));
    c=mix(vec3(cL),c,1.+.10*shMask);
    c*=mix(vec3(1.),vec3(.96,1.00,1.05),shMask*.38);
    c*=mix(vec3(1.),vec3(1.04,1.01,.96),hiMask*.28);
  }

  // 5. K-Halo / Extra Dual Bloom + KHDR Horizontal Anamorphic Glare Streak (attenuated in FLIR mode for razor-sharp IR contrast)
  if(uHasBloom==1){
    float flirBloomMul=1.-uFlirBlend*.72;
    vec3 bA=dec(texture(uBloomA,vUV).rgb);
    vec3 bB=dec(texture(uBloomB,vUV).rgb);
    if(uKHDR==1){
      vec3 streak=dec(texture(uStreak,vUV).rgb);
      c+=(bA*.34+bB*.30+streak*.24)*flirBloomMul;
    } else {
      c+=(bA*.42+bB*.38)*flirBloomMul;
    }
  }

  // 6. Subtle optical edge vignette + anti-banding micro-dither
  float vig=1.-r2*(uKHDR==1?.36:.40);
  c*=vig;
  float grain=(fract(sin(dot(gl_FragCoord.xy+uTime*17.,vec2(12.9898,78.233)))*43758.5453)-.5)*.009;
  frag=vec4(clamp(toneOut(c)+grain,0.,1.),1.);
}`;

export class KHDRPipeline {
  constructor(gl, postVS) {
    this.gl = gl;
    // Detect true 16-bit floating-point HDR framebuffer support (supported on Adreno 825 / modern WebGL2 GPUs!)
    this.extFloat = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    this.floatHDR = false;
    if (this.extFloat) {
      const probe = makeTarget(gl, 4, 4, gl.RGBA16F, true);
      if (probe) {
        this.floatHDR = true;
        destroyTarget(gl, probe);
      }
    }
    this.sceneFormat = this.floatHDR ? gl.RGBA16F : gl.RGBA8;

    this.adapt16P = makeProgram(gl, postVS, khdrAdapt16FS);
    this.adapt4P = makeProgram(gl, postVS, khdrAdapt4FS);
    this.adapt1P = makeProgram(gl, postVS, khdrAdapt1FS);
    this.bloomExP = makeProgram(gl, postVS, khdrBloomExtractFS);
    this.blurP = makeProgram(gl, postVS, khdrBlurFS);
    this.compP = makeProgram(gl, postVS, khdrCompositeFS);

    // Allocate tiny fixed GPU eye-adaptation pyramid (256 + 16 + 2 = 274 pixels total!)
    this.adapt16 = makeTarget(gl, 16, 16, gl.RGBA8, false);
    this.adapt4 = makeTarget(gl, 4, 4, gl.RGBA8, false);
    this.adaptA = makeTarget(gl, 1, 1, gl.RGBA8, false);
    this.adaptB = makeTarget(gl, 1, 1, gl.RGBA8, false);
    this.adaptFlip = 0;
    this.adaptReset = true;

    // 1x1 neutral fallback texture (1,1,0,1) for inactive screen-space / bloom samplers
    this.neutralTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.neutralTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    this.targets = null;
    this.size = [0, 0];

    this.bindSamplers(this.adapt16P, {uScene: 5});
    this.bindSamplers(this.adapt4P, {uTex: 11});
    this.bindSamplers(this.adapt1P, {uTex: 11, uPrev: 14});
    this.bindSamplers(this.bloomExP, {uScene: 5});
    this.bindSamplers(this.blurP, {uTex: 5});
    this.bindSamplers(this.compP, {
      uScene: 5,
      uBloomA: 6,
      uBloomB: 7,
      uSceneDepth: 8,
      uAeroTex: 9,
      uSfScreen: 10,
      uAdapt: 11,
      uThermoTex: 12,
      uFluxGIPost: 13,
      uStreak: 15
    });
  }

  bindSamplers(p, pairs) {
    const gl = this.gl;
    gl.useProgram(p.obj);
    for (const [k, v] of Object.entries(pairs)) if (p[k] != null) gl.uniform1i(p[k], v);
  }

  ensure(w, h) {
    if (this.targets && this.size[0] === w && this.size[1] === h) return;
    const gl = this.gl;
    if (this.targets) for (const t of Object.values(this.targets)) destroyTarget(gl, t);
    const hw = Math.max(64, w >> 1), hh = Math.max(64, h >> 1);
    const qw = Math.max(32, w >> 2), qh = Math.max(32, h >> 2);
    const fmt = this.sceneFormat;
    this.targets = {
      scene: makeTarget(gl, w, h, fmt, true),
      a0: makeTarget(gl, hw, hh, fmt, false),
      a1: makeTarget(gl, hw, hh, fmt, false),
      b0: makeTarget(gl, qw, qh, fmt, false),
      b1: makeTarget(gl, qw, qh, fmt, false),
      s0: makeTarget(gl, qw, qh, fmt, false),
      s1: makeTarget(gl, qw, qh, fmt, false)
    };
    this.size = [w, h];
  }

  resetAdaptation() {
    this.adaptReset = true;
  }

  blurPass(src, dst, dx, dy, emptyVao, peakGate = 0) {
    const gl = this.gl, bp = this.blurP;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(bp.obj);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(bp.uDir, dx / src.w, dy / src.h);
    gl.uniform1i(bp.uLinear, this.floatHDR ? 1 : 0);
    gl.uniform1f(bp.uPeakGate, peakGate);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  runAdapt(dt, emptyVao) {
    const gl = this.gl, t = this.targets;
    const prevT = this.adaptFlip ? this.adaptB : this.adaptA;
    const currT = this.adaptFlip ? this.adaptA : this.adaptB;

    // 1. Scene -> 16x16 foveal log-luminance
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.adapt16.fb);
    gl.viewport(0, 0, 16, 16);
    gl.useProgram(this.adapt16P.obj);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, t.scene.tex);
    gl.uniform1i(this.adapt16P.uLinear, this.floatHDR ? 1 : 0);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. 16x16 -> 4x4
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.adapt4.fb);
    gl.viewport(0, 0, 4, 4);
    gl.useProgram(this.adapt4P.obj);
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, this.adapt16.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. 4x4 -> 1x1 temporal cone/rod adaptation
    gl.bindFramebuffer(gl.FRAMEBUFFER, currT.fb);
    gl.viewport(0, 0, 1, 1);
    gl.useProgram(this.adapt1P.obj);
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, this.adapt4.tex);
    gl.activeTexture(gl.TEXTURE14);
    gl.bindTexture(gl.TEXTURE_2D, prevT.tex);
    gl.uniform1f(this.adapt1P.uDt, clamp(dt, .001, .2));
    gl.uniform1i(this.adapt1P.uReset, this.adaptReset ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.adaptReset = false;
    this.adaptFlip ^= 1;
    return currT.tex;
  }

  runBloom(khdrOn, emptyVao) {
    const gl = this.gl, t = this.targets;
    // 1. Extract highlights (Karis firefly-free when KHDR ON)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.a0.fb);
    gl.viewport(0, 0, t.a0.w, t.a0.h);
    gl.useProgram(this.bloomExP.obj);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, t.scene.tex);
    gl.uniform1i(this.bloomExP.uLinear, this.floatHDR ? 1 : 0);
    gl.uniform1i(this.bloomExP.uKHDR, khdrOn ? 1 : 0);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Tight half-res Gaussian bloom
    this.blurPass(t.a0, t.a1, 1.0, 0, emptyVao);
    this.blurPass(t.a1, t.a0, 0, 1.0, emptyVao);

    // 3. Wide quarter-res halo bloom
    this.blurPass(t.a0, t.b0, 1.4, 0, emptyVao);
    this.blurPass(t.b0, t.b1, 0, 1.4, emptyVao);
    this.blurPass(t.b1, t.b0, 2.0, 0, emptyVao);
    this.blurPass(t.b0, t.b1, 0, 2.0, emptyVao);

    // 4. KHDR Anamorphic Horizontal Lens Streak on ultra-bright peaks (sun, MS10 rails, muzzle blasts)
    if (khdrOn) {
      this.blurPass(t.a0, t.s0, 3.8, 0, emptyVao, 1.15);
      this.blurPass(t.s0, t.s1, 6.2, 0, emptyVao, 0);
    }
  }

  composite({
    w, h, finalOutput, khdrOn, hasBloom, useFXAA, sfScreenTex, dt, shake, hurt, time, emptyVao,
    schlierenOn = false, shockCount = 0, shocks = null, shockMeta = null, gunHeat = 0, aspect = 16 / 9,
    aeroOn = false, aeroTex = null, thermoTex = null, fluxGITex = null, fluxGIOn = false,
    flirBlend = 0, flirActors = null, invVP = null, camEye = null
  }) {
    const gl = this.gl, t = this.targets;
    gl.disable(gl.DEPTH_TEST);

    let adaptTex = this.neutralTex;
    if (khdrOn) adaptTex = this.runAdapt(dt, emptyVao);
    if (hasBloom) this.runBloom(khdrOn, emptyVao);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.compP.obj);

    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, t.scene.tex);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, hasBloom ? t.a0.tex : this.neutralTex);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, hasBloom ? t.b1.tex : this.neutralTex);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, t.scene.depthTex || this.neutralTex);
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, aeroTex || this.neutralTex);
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, sfScreenTex || this.neutralTex);
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, adaptTex);
    gl.activeTexture(gl.TEXTURE12);
    gl.bindTexture(gl.TEXTURE_2D, thermoTex || this.neutralTex);
    gl.activeTexture(gl.TEXTURE13);
    gl.bindTexture(gl.TEXTURE_2D, fluxGITex || this.neutralTex);
    gl.activeTexture(gl.TEXTURE15);
    gl.bindTexture(gl.TEXTURE_2D, (hasBloom && khdrOn) ? t.s1.tex : this.neutralTex);

    gl.uniform1i(this.compP.uOutput, finalOutput);
    gl.uniform1i(this.compP.uLinear, this.floatHDR ? 1 : 0);
    gl.uniform1i(this.compP.uKHDR, khdrOn ? 1 : 0);
    gl.uniform1i(this.compP.uHasBloom, hasBloom ? 1 : 0);
    gl.uniform1i(this.compP.uUseFXAA, useFXAA ? 1 : 0);
    gl.uniform1i(this.compP.uUseSfScreen, sfScreenTex ? 1 : 0);
    gl.uniform1f(this.compP.uShake, clamp(shake || 0, 0, 1));
    gl.uniform1f(this.compP.uHurt, clamp(hurt || 0, 0, 1));
    gl.uniform1f(this.compP.uTime, time);
    if (this.compP.uSchlierenOn != null) gl.uniform1i(this.compP.uSchlierenOn, schlierenOn ? 1 : 0);
    if (this.compP.uShockCount != null) gl.uniform1i(this.compP.uShockCount, shockCount || 0);
    if (this.compP.uGunHeat != null) gl.uniform1f(this.compP.uGunHeat, gunHeat || 0);
    if (this.compP.uAspect != null) gl.uniform1f(this.compP.uAspect, aspect || 16 / 9);
    if (this.compP.uShocks != null && shocks) gl.uniform4fv(this.compP.uShocks, shocks);
    if (this.compP.uShockMeta != null && shockMeta) gl.uniform4fv(this.compP.uShockMeta, shockMeta);
    if (this.compP.uAeroOn != null) gl.uniform1i(this.compP.uAeroOn, (aeroOn && aeroTex && invVP) ? 1 : 0);
    if (this.compP.uFluxGIPostOn != null) gl.uniform1i(this.compP.uFluxGIPostOn, (fluxGIOn && fluxGITex) ? 1 : 0);
    if (this.compP.uInvVP != null && invVP) gl.uniformMatrix4fv(this.compP.uInvVP, false, invVP);
    if (this.compP.uCamEye != null && camEye) gl.uniform3fv(this.compP.uCamEye, camEye);
    if (this.compP.uFlirOn != null) gl.uniform1i(this.compP.uFlirOn, flirBlend > 0.005 ? 1 : 0);
    if (this.compP.uFlirBlend != null) gl.uniform1f(this.compP.uFlirBlend, (thermoTex && invVP) ? clamp(flirBlend || 0, 0, 1) : 0);
    if (this.compP.uFlirActors != null && flirActors) gl.uniform4fv(this.compP.uFlirActors, flirActors);

    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (const u of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.enable(gl.DEPTH_TEST);
  }
}
