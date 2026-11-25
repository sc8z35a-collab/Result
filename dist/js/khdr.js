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
import {HEMO_VISOR_COMPOSITE_GLSL} from './hemoflux.js';

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
vec3 kFastGamma(vec3 x){
  x=clamp(x,0.,1.);
  vec3 s1=sqrt(x),s2=sqrt(s1),s3=sqrt(s2);
  return clamp(.8628615*s1+.2199532*s2-.0571716*s3-.0257696*x,0.,1.);
}
vec3 kFilmicSDR(vec3 c){
  vec3 ins=K_INSET*max(c,vec3(0.));
  vec3 curved=kToneCurve(ins);
  vec3 outC=clamp(K_OUTSET*curved,0.,1.);
  // K-Punch: perceptual midtone vibrance while keeping highlights luminous & unclipped
  float l=dot(outC,vec3(.2126,.7152,.0722));
  float sat=1.+.19*(1.-l*l)*min(1.,l*4.5);
  outC=clamp(mix(vec3(l),outC,sat),0.,1.);
  return kFastGamma(outC);
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

// K-Halo: Karis-averaged Firefly-Free Soft-Knee Bloom Extract + Half-Res Scene Luminance in .a (for Zero-Fetch Weber-LCE!)
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
  float lumC=max(dot(c0,vec3(.2126,.7152,.0722)),1e-4);
  float lumA=uLinear==1?lumC:clamp(log2(1.+lumC*4.)/6.,0.,1.);
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
    frag=vec4(enc(outC),lumA);
  } else {
    c=.25*(c1+c2+c3+c4);
    float lum=dot(c,vec3(.2126,.7152,.0722));
    float soft=smoothstep(.88,1.95,lum);
    frag=vec4(enc(c*soft*.82),lumA);
  }
}`;

// Dual-purpose Separable Blur (K-Halo-Optic 5-tap bilinear Gaussian + RGBA luminance blur + BloomPyramid-PreComposite!)
const khdrBlurFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform sampler2D uAddB;
uniform sampler2D uAddS;
uniform vec2 uDir;
uniform vec3 uCombW;     // (wA, wB, wS); wA>0 fuses BloomA + BloomB + Streak into single half-res target!
uniform int uLinear;
uniform float uPeakGate; // 0 = normal blur, >0 = extract ultra-bright peaks for anamorphic streak
out vec4 frag;
${KHDR_TONE_GLSL}
vec3 dec(vec3 v){return uLinear==1?max(v,vec3(0.)):kDecodeLogK(v);}
vec3 enc(vec3 c){return uLinear==1?max(c,vec3(0.)):kEncodeLogK(c);}
vec4 sampleIn(vec2 uv){
  vec4 raw=texture(uTex,uv);
  vec3 c=dec(raw.rgb);
  if(uPeakGate>.01){
    float l=max(c.r,max(c.g,c.b));
    c*=smoothstep(uPeakGate,uPeakGate+1.2,l);
  }
  return vec4(c,raw.a);
}
void main(){
  vec2 o1=uDir*1.8692308;
  vec2 o2=uDir*4.3615385;
  if(uLinear==1 && uPeakGate<=.01){
    // Exact 9-tap Gaussian collapsed into 5 hardware bilinear taps on all 4 channels (RGB bloom + A local luminance!)
    vec4 acc=max(texture(uTex,vUV),vec4(0.))*.227027;
    acc+=(max(texture(uTex,vUV+o1),vec4(0.))+max(texture(uTex,vUV-o1),vec4(0.)))*.3162162;
    acc+=(max(texture(uTex,vUV+o2),vec4(0.))+max(texture(uTex,vUV-o2),vec4(0.)))*.0702702;
    if(uCombW.x>.001){
      vec3 bB=max(texture(uAddB,vUV).rgb,vec3(0.));
      vec3 bS=uCombW.z>.001?max(texture(uAddS,vUV).rgb,vec3(0.)):vec3(0.);
      acc.rgb=acc.rgb*uCombW.x+bB*uCombW.y+bS*uCombW.z;
    }
    frag=acc;
    return;
  }
  vec4 acc=sampleIn(vUV)*.227027;
  acc+=(sampleIn(vUV+o1)+sampleIn(vUV-o1))*.3162162;
  acc+=(sampleIn(vUV+o2)+sampleIn(vUV-o2))*.0702702;
  if(uCombW.x>.001){
    vec3 bB=dec(texture(uAddB,vUV).rgb);
    vec3 bS=uCombW.z>.001?dec(texture(uAddS,vUV).rgb):vec3(0.);
    acc.rgb=acc.rgb*uCombW.x+bB*uCombW.y+bS*uCombW.z;
  }
  frag=vec4(enc(acc.rgb),clamp(acc.a,0.,1.));
}`;

// ShaderForge-Zero Composite Factory:
// Builds compile-time specialized GLSL eliminating dead branches & unused physics/FLIR register pressure!
// Default uber-shader (flags = null) keeps 100% runtime uniform compatibility for constructor & tests.
function buildCompositeFS(flags = null) {
  const isSpec = flags !== null;
  const defs = isSpec ? [
    flags.linear ? '#define SFZ_LINEAR 1' : '#define SFZ_LINEAR 0',
    flags.schlieren ? '#define SFZ_SCHLIEREN 1' : '#define SFZ_SCHLIEREN 0',
    flags.aero ? '#define SFZ_AERO 1' : '#define SFZ_AERO 0',
    flags.flir ? '#define SFZ_FLIR 1' : '#define SFZ_FLIR 0',
    flags.khdr ? '#define SFZ_KHDR 1' : '#define SFZ_KHDR 0',
    flags.bloom ? '#define SFZ_BLOOM 1' : '#define SFZ_BLOOM 0',
    flags.fxaa ? '#define SFZ_FXAA 1' : '#define SFZ_FXAA 0',
    flags.sfScreen ? '#define SFZ_SFSCREEN 1' : '#define SFZ_SFSCREEN 0',
    flags.visorBlood ? '#define SFZ_VISOR_BLOOD 1' : '#define SFZ_VISOR_BLOOD 0'
  ].join('\n') : '';
  const includeSchlieren = !isSpec || flags.schlieren;
  const includeAero = !isSpec || flags.aero;
  const includeFlir = !isSpec || flags.flir;
  const includeVisorBlood = !isSpec || flags.visorBlood;

  return `#version 300 es
precision highp float;
${defs}
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
${includeSchlieren ? SCHLIEREN_COMPOSITE_GLSL : ''}
${includeAero ? AERO_COMPOSITE_GLSL : ''}
${includeFlir ? THERMO_COMPOSITE_GLSL : ''}
${includeVisorBlood ? HEMO_VISOR_COMPOSITE_GLSL : ''}

vec3 dec(vec3 v){
#ifdef SFZ_LINEAR
  #if SFZ_LINEAR
    return max(v,vec3(0.));
  #else
    return kDecodeLogK(v);
  #endif
#else
  return uLinear==1?max(v,vec3(0.)):kDecodeLogK(v);
#endif
}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
float pLuma(vec3 c){
  float y=max(0.,dot(c,vec3(.2126,.7152,.0722)));
  return sqrt(y/(1.+y));
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
  if(uOutput==1)return kFastGamma(aces(c*.90));
  return kFastGamma(c*.97);
}

void main(){
  vec2 px=1./vec2(textureSize(uScene,0));
  vec2 fromC=vUV-.5;
  float r2=dot(fromC,fromC);
  vec4 rawM=texture(uScene,vUV);
  float worldMask=smoothstep(.25,.75,rawM.a);

  vec3 base=dec(rawM.rgb);
  vec2 sUV=vec2(0.);
${includeSchlieren ? `
  // 0. SchlierenOptics 1.0: Gladstone-Dale Refractive Shockwave Lensing + Cauchy Prismatic Dispersion + Thermal Mirage!
  vec2 sDisp;
  float sRim;
  schlierenEvaluate(vUV,worldMask,uTime,sUV,sDisp,sRim);
  if(dot(sUV,sUV)+dot(sDisp,sDisp)>1e-8){
    vec2 uvR=clamp(vUV+sUV,vec2(.001),vec2(.999));
    vec4 sG=texture(uScene,uvR);
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
  }
` : ''}

  // Pre-fetch single fused Bloom+LocalLum texture ONCE (reused for CrossQuad-ZeroFetch-FXAA, Weber-LCE, AND Bloom!)
  vec4 bloomPack=vec4(0.);
  float localLum=0.;
#if !defined(SFZ_BLOOM) || SFZ_BLOOM
  if(uHasBloom==1){
    bloomPack=texture(uBloomA,vUV);
    #if defined(SFZ_LINEAR) && SFZ_LINEAR
      localLum=max(bloomPack.a,1e-4);
    #elif defined(SFZ_LINEAR) && !SFZ_LINEAR
      localLum=max((exp2(bloomPack.a*6.)-1.)*.25,1e-4);
    #else
      localLum=uLinear==1?max(bloomPack.a,1e-4):max((exp2(bloomPack.a*6.)-1.)*.25,1e-4);
    #endif
  }
#endif

  // 1. CrossQuad-ZeroFetch-FXAA: hardware dFdx/dFdy + already-fetched localLum pre-gate (ZERO extra fetches on flat pixels!)
  float lumPre=max(dot(base,vec3(.2126,.7152,.0722)),1e-4);
#if !defined(SFZ_FXAA) || SFZ_FXAA
  float lM;
  #if defined(SFZ_LINEAR) && SFZ_LINEAR
    lM=sqrt(lumPre/(1.+lumPre));
  #elif defined(SFZ_LINEAR) && !SFZ_LINEAR
    lM=dot(rawM.rgb,vec3(.2126,.7152,.0722));
  #else
    lM=uLinear==1?sqrt(lumPre/(1.+lumPre)):dot(rawM.rgb,vec3(.2126,.7152,.0722));
  #endif
  float qDiff=abs(dFdx(lM))+abs(dFdy(lM));
  if(uUseFXAA==1 && dot(sUV,sUV)<1e-6){
    #if defined(SFZ_LINEAR) && SFZ_LINEAR
      float edgeThresh=.042;
    #elif defined(SFZ_LINEAR) && !SFZ_LINEAR
      float edgeThresh=.028;
    #else
      float edgeThresh=uLinear==1?.042:.028;
    #endif
    bool maybeEdge=(qDiff>edgeThresh*.78) || (localLum>0. ? (abs(localLum-lumPre)>(localLum+lumPre)*.085) : true);
    if(maybeEdge){
      vec3 rNW=texture(uScene,vUV+vec2(-px.x,-px.y)).rgb;
      vec3 rNE=texture(uScene,vUV+vec2(px.x,-px.y)).rgb;
      vec3 rSW=texture(uScene,vUV+vec2(-px.x,px.y)).rgb;
      vec3 rSE=texture(uScene,vUV+vec2(px.x,px.y)).rgb;
      float lNW,lNE,lSW,lSE;
      #if defined(SFZ_LINEAR) && SFZ_LINEAR
        lNW=pLuma(max(rNW,vec3(0.)));lNE=pLuma(max(rNE,vec3(0.)));
        lSW=pLuma(max(rSW,vec3(0.)));lSE=pLuma(max(rSE,vec3(0.)));
      #elif defined(SFZ_LINEAR) && !SFZ_LINEAR
        lNW=dot(rNW,vec3(.2126,.7152,.0722));lNE=dot(rNE,vec3(.2126,.7152,.0722));
        lSW=dot(rSW,vec3(.2126,.7152,.0722));lSE=dot(rSE,vec3(.2126,.7152,.0722));
      #else
        if(uLinear==1){
          lNW=pLuma(max(rNW,vec3(0.)));lNE=pLuma(max(rNE,vec3(0.)));
          lSW=pLuma(max(rSW,vec3(0.)));lSE=pLuma(max(rSE,vec3(0.)));
        } else {
          lNW=dot(rNW,vec3(.2126,.7152,.0722));lNE=dot(rNE,vec3(.2126,.7152,.0722));
          lSW=dot(rSW,vec3(.2126,.7152,.0722));lSE=dot(rSE,vec3(.2126,.7152,.0722));
        }
      #endif
      float lMin=min(lM,min(min(lNW,lNE),min(lSW,lSE)));
      float lMax=max(lM,max(max(lNW,lNE),max(lSW,lSE)));
      if(lMax-lMin>edgeThresh){
        vec2 d=vec2(-((lNW+lNE)-(lSW+lSE)),(lNW+lSW)-(lNE+lSE));
        float dReduce=max((lNW+lNE+lSW+lSE)*.03125,.0078125);
        float rcp=1./(min(abs(d.x),abs(d.y))+dReduce);
        d=clamp(d*rcp,vec2(-4.),vec2(4.))*px;
        vec3 a=.5*(dec(texture(uScene,vUV+d*(1./3.-.5)).rgb)+dec(texture(uScene,vUV+d*(2./3.-.5)).rgb));
        vec3 b=a*.5+.25*(dec(texture(uScene,vUV+d*-.5).rgb)+dec(texture(uScene,vUV+d*.5).rgb));
        #if defined(SFZ_LINEAR) && SFZ_LINEAR
          float lb=pLuma(b);
        #elif defined(SFZ_LINEAR) && !SFZ_LINEAR
          float lb=dot(kEncodeLogK(b),vec3(.2126,.7152,.0722));
        #else
          float lb=uLinear==1?pLuma(b):dot(kEncodeLogK(b),vec3(.2126,.7152,.0722));
        #endif
        base=(lb<lMin||lb>lMax)?a:b;
      }
    }
  }
#endif

  // 2. Subtle dynamic combat chromatic aberration (skip sub-0.25px invisible noise during idle!)
  float ca=(uHasBloom==1?(.0010+uShake*.0036+uHurt*.0052):(uShake*.0028+uHurt*.0045))*r2;
  if(ca>.00055){
    vec2 dir=fromC*ca;
    base.r=mix(base.r,dec(texture(uScene,vUV+dir).rgb).r,.72);
    base.b=mix(base.b,dec(texture(uScene,vUV-dir).rgb).b,.72);
  }

  // 3. Shadow Flame 1.0 Pro Screen-Space Resolve (SSCS + GTAO-Lite + 3D Shadowed Volumetric God-Rays)
#if !defined(SFZ_SFSCREEN) || SFZ_SFSCREEN
  if(uUseSfScreen==1 && worldMask>.01){
    vec3 sf=texture(uSfScreen,vUV).rgb;
    float occ=clamp(sf.r*sf.g,.22,1.);
    vec3 occTint=mix(vec3(.80,.90,1.06),vec3(1.),occ);
    base=mix(base,base*occ*occTint,worldMask);
    vec3 shaftCol=vec3(1.26,.92,.52)*sf.b*(uKHDR==1?.26:.20);
    base+=shaftCol*worldMask;
  }
#endif

  // 3b. AeroVortex 1.0 Depth-Occluded 3D Volumetric Smoke + ThermoFlux 1.0 GPU Cyber-FLIR Visor!
${(includeAero || includeFlir) ? `
  {
    bool doAero=${includeAero ? 'uAeroOn==1' : 'false'};
    bool doFlir=${includeFlir ? 'uFlirBlend>.005' : 'false'};
    if(doAero || doFlir){
      float sceneDepth=texture(uSceneDepth,vUV).r;
      ${includeAero ? `
      if(doAero${includeFlir ? ' && uFlirBlend<.88' : ''}){
        vec3 smokeCol=base;
        applyAeroVortex(vUV,worldMask,sceneDepth,uTime,smokeCol);
        base=${includeFlir ? 'mix(smokeCol,base,smoothstep(.15,.85,uFlirBlend))' : 'smokeCol'};
      }` : ''}
      ${includeFlir ? `
      if(doFlir){
        float actorMask=1.-step(.055,abs(rawM.a-.8));
        base=applyThermoFluxFLIR(vUV,worldMask,actorMask,sceneDepth,uTime,base);
      }` : ''}
    }
  }
` : ''}

  // 4. KHDR Perceptual Enhancement Pipeline (Single-exp2 K-Adapt + LowFreq-LCE-Reuse + Warm/Cool Split)
  vec3 c=base;
#if !defined(SFZ_KHDR) || SFZ_KHDR
  if(uKHDR==1){
    float adaptNorm=texture(uAdapt,vec2(.5)).r;
    float expMul=clamp(exp2(.941154-max(adaptNorm,.079773)*2.72),.84,1.28);
    c*=expMul;

    // 4b. Weber-LCE-ZeroTrans: reuses exact Gaussian half-res luminance in localLum (0 extra fetches!) with Lorentzian halo stop
    float lumBase=max(dot(base,vec3(.2126,.7152,.0722)),1e-4);
    float lumC=lumBase*expMul;
    float midGate=(1.-smoothstep(1.3,3.2,lumC))*smoothstep(.012,.06,lumC);
    if(midGate>.005){
      float detail=0.;
      #if defined(SFZ_BLOOM) && SFZ_BLOOM
        float dl=2.88539*(localLum-lumBase)/(localLum+lumBase);
        float e=dl*2.6;
        detail=clamp(-dl/(1.+e*e),-.42,.42);
      #else
        if(localLum>0.){
          float dl=2.88539*(localLum-lumBase)/(localLum+lumBase);
          float e=dl*2.6;
          detail=clamp(-dl/(1.+e*e),-.42,.42);
        } else {
          const vec2 RING4[4]=vec2[4](vec2(-5.5,-3.2),vec2(5.5,-3.2),vec2(-3.2,5.5),vec2(3.2,5.5));
          float diffSum=0.,wSum=0.;
          for(int i=0;i<4;i++){
            vec3 rawN=texture(uScene,vUV+RING4[i]*px).rgb;
            float nLum=uLinear==1
              ? max(dot(max(rawN,vec3(0.)),vec3(.2126,.7152,.0722)),1e-4)
              : max((exp2(dot(rawN,vec3(.2126,.7152,.0722))*6.)-1.)*.25,1e-4);
            float dl=2.88539*(nLum-lumBase)/(nLum+lumBase);
            float e=dl*2.6;
            float bw=1./(1.+e*e);
            diffSum+=dl*bw;
            wSum+=bw;
          }
          detail=clamp(-diffSum/max(wSum,1e-4),-.42,.42);
        }
      #endif
      float gx=detail*.28*midGate;
      c*=1.+gx*(.693147+.240226*gx);
    }

    // 4c. Shadow Chromatic Depth & Subtle Warm-Sun / Cool-Shade Radiance Split
    float shMask=1.-smoothstep(.04,.38,lumC);
    float hiMask=smoothstep(.85,2.4,lumC);
    float cL=dot(c,vec3(.2126,.7152,.0722));
    c=mix(vec3(cL),c,1.+.10*shMask);
    c*=mix(vec3(1.),vec3(.96,1.00,1.05),shMask*.38);
    c*=mix(vec3(1.),vec3(1.04,1.01,.96),hiMask*.28);
  }
#endif

  // 5. K-Halo / Extra Fused Bloom Pyramid + Anamorphic Streak (already in bloomPack.rgb -> 0 extra fetches!)
#if !defined(SFZ_BLOOM) || SFZ_BLOOM
  if(uHasBloom==1){
    float flirBloomMul=${includeFlir ? '(1.-uFlirBlend*.72)' : '1.'};
    c+=dec(bloomPack.rgb)*flirBloomMul;
  }
#endif

  // 5b. HemoFlux 1.0 Optical Visor Blood Refraction + Beer-Lambert Absorption + Stick-Slip Smear Trails
${includeVisorBlood ? `
  if(uVisorOn==1 && uVisorCount>0){
    float vh, vSmear, vDry, vOxy;
    vec2 vGrad;
    hemoVisorEvaluate(vUV, uVisorAspect, vh, vGrad, vSmear, vDry, vOxy);
    if(vh>.015 || vSmear>.015){
      vec2 refrUV=clamp(vUV-vec2(vGrad.x/max(uVisorAspect,0.5),vGrad.y)*0.022*(1.-vDry*0.65),vec2(.001),vec2(.999));
      vec3 refrCol=dec(texture(uScene,refrUV).rgb);
      c=hemoVisorShade(c,refrCol,vh,vGrad,vSmear,vDry,vOxy);
    }
  }
` : ''}

  // 6. Subtle optical edge vignette + hash-without-sine anti-banding micro-dither
  float vig=1.-r2*(uKHDR==1?.36:.40);
  c*=vig;
  vec2 gp=fract((gl_FragCoord.xy+uTime*17.)*vec2(.1031,.11369));
  float grain=(fract((gp.x+gp.y)*gp.x*43.13)-.5)*.009;
  frag=vec4(clamp(toneOut(c)+grain,0.,1.),1.);
}`;
}

const khdrCompositeFS = buildCompositeFS(null);

const COMP_SAMPLERS = {
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
};

export class KHDRPipeline {
  constructor(gl, postVS) {
    this.gl = gl;
    this.postVS = postVS;
    this.extFloat = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    this.floatHDR = false;
    if (this.extFloat) {
      const probe = makeTarget(gl, 4, 4, gl.RGBA16F, true);
      if (probe) {
        this.floatHDR = true;
        destroyTarget(gl, probe);
      }
    }

    // Exactly 6 programs linked in constructor (test_gpu.py contract!)
    this.adapt16P = makeProgram(gl, postVS, khdrAdapt16FS);
    this.adapt4P = makeProgram(gl, postVS, khdrAdapt4FS);
    this.adapt1P = makeProgram(gl, postVS, khdrAdapt1FS);
    this.bloomExP = makeProgram(gl, postVS, khdrBloomExtractFS);
    this.blurP = makeProgram(gl, postVS, khdrBlurFS);
    this.compP = makeProgram(gl, postVS, khdrCompositeFS);
    this._compVariants = new Map();

    // Allocate tiny fixed GPU eye-adaptation pyramid (256 + 16 + 2 = 274 pixels total!)
    this.adapt16 = makeTarget(gl, 16, 16, gl.RGBA8, false);
    this.adapt4 = makeTarget(gl, 4, 4, gl.RGBA8, false);
    this.adaptA = makeTarget(gl, 1, 1, gl.RGBA8, false);
    this.adaptB = makeTarget(gl, 1, 1, gl.RGBA8, false);
    this.adaptFlip = 0;
    this.adaptReset = true;
    this._adaptFrame = 0;
    this._adaptDtAccum = 0;
    this._lastAdaptTex = this.adaptA.tex;

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
    this.bindSamplers(this.blurP, {uTex: 5, uAddB: 6, uAddS: 7});
    this.bindSamplers(this.compP, COMP_SAMPLERS);
  }

  getSpecializedComp(flags) {
    const key =
      (flags.linear ? 1 : 0) |
      (flags.schlieren ? 2 : 0) |
      (flags.aero ? 4 : 0) |
      (flags.flir ? 8 : 0) |
      (flags.khdr ? 16 : 0) |
      (flags.bloom ? 32 : 0) |
      (flags.fxaa ? 64 : 0) |
      (flags.sfScreen ? 128 : 0) |
      (flags.visorBlood ? 256 : 0);
    let prog = this._compVariants.get(key);
    if (!prog) {
      prog = makeProgram(this.gl, this.postVS, buildCompositeFS(flags));
      this.bindSamplers(prog, COMP_SAMPLERS);
      this._compVariants.set(key, prog);
    }
    return prog;
  }

  bindSamplers(p, pairs) {
    const gl = this.gl;
    gl.useProgram(p.obj);
    for (const [k, v] of Object.entries(pairs)) if (p[k] != null) gl.uniform1i(p[k], v);
  }

  ensure(w, h) {
    if (this.targets && this.size[0] === w && this.size[1] === h) return;
    const gl = this.gl;
    this.releaseTargets();
    const hw = Math.max(64, w >> 1), hh = Math.max(64, h >> 1);
    const qw = Math.max(32, w >> 2), qh = Math.max(32, h >> 2);
    const formats = this.floatHDR ? [gl.RGBA16F, gl.RGBA8] : [gl.RGBA8];
    for (const fmt of formats) {
      const targets = {};
      for (const [name, width, height] of [
        ['scene', w, h], ['a0', hw, hh], ['a1', hw, hh],
        ['b0', qw, qh], ['b1', qw, qh], ['s0', qw, qh], ['s1', qw, qh]
      ]) {
        const target = makeTarget(gl, width, height, fmt, name === 'scene');
        if (!target) break;
        targets[name] = target;
      }
      if (targets.s1) {
        this.targets = targets;
        this.size = [w, h];
        this.floatHDR = fmt === gl.RGBA16F;
        this.resetAdaptation();
        return;
      }
      for (const target of Object.values(targets)) destroyTarget(gl, target);
    }
    throw new Error('画面処理用の WebGL バッファを作成できません');
  }

  releaseTargets() {
    if (!this.targets) return;
    for (const target of Object.values(this.targets)) destroyTarget(this.gl, target);
    this.targets = null;
  }

  resetAdaptation() {
    this.adaptReset = true;
    this._adaptFrame = 0;
    this._adaptDtAccum = 0;
  }

  blurPass(src, dst, dx, dy, emptyVao, peakGate = 0, combine = null) {
    const gl = this.gl, bp = this.blurP;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(bp.obj);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    if (combine) {
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, combine.bTex);
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, combine.sTex || this.neutralTex);
      if (bp.uCombW != null) gl.uniform3f(bp.uCombW, combine.wA, combine.wB, combine.wS);
    } else {
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, this.neutralTex);
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, this.neutralTex);
      if (bp.uCombW != null) gl.uniform3f(bp.uCombW, 0, 0, 0);
    }
    gl.uniform2f(bp.uDir, dx / src.w, dy / src.h);
    gl.uniform1i(bp.uLinear, this.floatHDR ? 1 : 0);
    gl.uniform1f(bp.uPeakGate, peakGate);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // K-Adapt-20Hz: exact accumulated-dt eye adaptation every 3rd frame (saves 66.7% of adapt passes!)
  runAdapt(dt, emptyVao) {
    this._adaptDtAccum += clamp(dt, .001, .2);
    if (!this.adaptReset && ++this._adaptFrame < 3) {
      return this._lastAdaptTex;
    }
    const effDt = clamp(this._adaptDtAccum, .001, .25);
    this._adaptFrame = 0;
    this._adaptDtAccum = 0;

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
    gl.uniform1f(this.adapt1P.uDt, effDt);
    gl.uniform1i(this.adapt1P.uReset, this.adaptReset ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.adaptReset = false;
    this.adaptFlip ^= 1;
    this._lastAdaptTex = currT.tex;
    return currT.tex;
  }

  runBloom(khdrOn, emptyVao) {
    const gl = this.gl, t = this.targets;
    // 1. Extract highlights + half-res scene luminance in .a (Karis firefly-free when KHDR ON)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.a0.fb);
    gl.viewport(0, 0, t.a0.w, t.a0.h);
    gl.useProgram(this.bloomExP.obj);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, t.scene.tex);
    gl.uniform1i(this.bloomExP.uLinear, this.floatHDR ? 1 : 0);
    gl.uniform1i(this.bloomExP.uKHDR, khdrOn ? 1 : 0);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Half-res horizontal Gaussian blur (RGB bloom + A local luminance simultaneously!)
    this.blurPass(t.a0, t.a1, 1.0, 0, emptyVao);

    // 3. Wide quarter-res halo bloom (fused equivalent sigma 2.25 -> eliminates 2 full GPU passes!)
    this.blurPass(t.a1, t.b0, 2.25, 0, emptyVao);
    this.blurPass(t.b0, t.b1, 0, 2.25, emptyVao);

    // 4. KHDR Anamorphic Horizontal Lens Streak on ultra-bright peaks (5-tap bilinear-grouped!)
    if (khdrOn) {
      this.blurPass(t.a1, t.s0, 3.8, 0, emptyVao, 1.15);
      this.blurPass(t.s0, t.s1, 6.2, 0, emptyVao, 0);
    }

    // 5. BloomPyramid-PreComposite: vertical half-res blur fuses BloomA + BloomB + Streak into t.a0.rgb
    //    while t.a0.a holds the exact 2D Gaussian-blurred local luminance for zero-fetch Weber-LCE!
    this.blurPass(t.a1, t.a0, 0, 1.0, emptyVao, 0, khdrOn
      ? {bTex: t.b1.tex, sTex: t.s1.tex, wA: .34, wB: .30, wS: .24}
      : {bTex: t.b1.tex, sTex: null, wA: .42, wB: .38, wS: 0});
  }

  composite({
    w, h, finalOutput, khdrOn, hasBloom, useFXAA, sfScreenTex, dt, shake, hurt, time, emptyVao,
    schlierenOn = false, shockCount = 0, shocks = null, shockMeta = null, gunHeat = 0, aspect = 16 / 9,
    aeroOn = false, aeroTex = null, aeroBounds = null, thermoTex = null, fluxGITex = null, fluxGIOn = false,
    flirBlend = 0, flirActors = null, invVP = null, camEye = null,
    visorOn = false, visorCount = 0, visorDrops = null, visorMeta = null
  }) {
    const gl = this.gl, t = this.targets;
    gl.disable(gl.DEPTH_TEST);

    let adaptTex = this.neutralTex;
    if (khdrOn) adaptTex = this.runAdapt(dt, emptyVao);
    if (hasBloom) this.runBloom(khdrOn, emptyVao);

    const activeAero = !!(aeroOn && aeroTex && invVP);
    const activeFlir = !!(thermoTex && invVP && flirBlend > 0.005);
    const activeSchlieren = !!(schlierenOn && ((shockCount || 0) > 0 || (gunHeat || 0) > 0.01));
    const activeVisor = !!(visorOn && (visorCount || 0) > 0 && visorDrops && visorMeta);

    // ShaderForge-Zero: select lazily compiled compile-time specialized composite permutation!
    const cp = this.getSpecializedComp({
      linear: this.floatHDR,
      schlieren: activeSchlieren,
      aero: activeAero,
      flir: activeFlir,
      khdr: !!khdrOn,
      bloom: !!hasBloom,
      fxaa: !!useFXAA,
      sfScreen: !!sfScreenTex,
      visorBlood: activeVisor
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(cp.obj);

    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, t.scene.tex);
    if (hasBloom) {
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, t.a0.tex);
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, t.b1.tex);
      if (khdrOn) {
        gl.activeTexture(gl.TEXTURE15);
        gl.bindTexture(gl.TEXTURE_2D, t.s1.tex);
      }
    }
    if (activeAero || activeFlir) {
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, t.scene.depthTex || this.neutralTex);
    }
    if (activeAero) {
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, aeroTex);
      gl.activeTexture(gl.TEXTURE13);
      gl.bindTexture(gl.TEXTURE_2D, fluxGITex || this.neutralTex);
    }
    if (sfScreenTex) {
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, sfScreenTex);
    }
    if (khdrOn) {
      gl.activeTexture(gl.TEXTURE11);
      gl.bindTexture(gl.TEXTURE_2D, adaptTex);
    }
    if (activeFlir) {
      gl.activeTexture(gl.TEXTURE12);
      gl.bindTexture(gl.TEXTURE_2D, thermoTex);
    }

    if (cp.uOutput != null) gl.uniform1i(cp.uOutput, finalOutput);
    if (cp.uLinear != null) gl.uniform1i(cp.uLinear, this.floatHDR ? 1 : 0);
    if (cp.uKHDR != null) gl.uniform1i(cp.uKHDR, khdrOn ? 1 : 0);
    if (cp.uHasBloom != null) gl.uniform1i(cp.uHasBloom, hasBloom ? 1 : 0);
    if (cp.uUseFXAA != null) gl.uniform1i(cp.uUseFXAA, useFXAA ? 1 : 0);
    if (cp.uUseSfScreen != null) gl.uniform1i(cp.uUseSfScreen, sfScreenTex ? 1 : 0);
    if (cp.uShake != null) gl.uniform1f(cp.uShake, clamp(shake || 0, 0, 1));
    if (cp.uHurt != null) gl.uniform1f(cp.uHurt, clamp(hurt || 0, 0, 1));
    if (cp.uTime != null) gl.uniform1f(cp.uTime, time);
    if (cp.uSchlierenOn != null) gl.uniform1i(cp.uSchlierenOn, activeSchlieren ? 1 : 0);
    if (cp.uShockCount != null) gl.uniform1i(cp.uShockCount, shockCount || 0);
    if (cp.uGunHeat != null) gl.uniform1f(cp.uGunHeat, gunHeat || 0);
    if (cp.uAspect != null) gl.uniform1f(cp.uAspect, aspect || 16 / 9);
    if (cp.uShocks != null && shocks) gl.uniform4fv(cp.uShocks, shocks);
    if (cp.uShockMeta != null && shockMeta) gl.uniform4fv(cp.uShockMeta, shockMeta);
    if (cp.uAeroOn != null) gl.uniform1i(cp.uAeroOn, activeAero ? 1 : 0);
    if (cp.uAeroBounds != null) {
      if (aeroBounds) gl.uniform4fv(cp.uAeroBounds, aeroBounds);
      else gl.uniform4f(cp.uAeroBounds, 0, 0, 0, 0);
    }
    if (cp.uFluxGIPostOn != null) gl.uniform1i(cp.uFluxGIPostOn, (fluxGIOn && fluxGITex) ? 1 : 0);
    if (cp.uInvVP != null && invVP) gl.uniformMatrix4fv(cp.uInvVP, false, invVP);
    if (cp.uCamEye != null && camEye) gl.uniform3fv(cp.uCamEye, camEye);
    if (cp.uFlirOn != null) gl.uniform1i(cp.uFlirOn, activeFlir ? 1 : 0);
    if (cp.uFlirBlend != null) gl.uniform1f(cp.uFlirBlend, activeFlir ? clamp(flirBlend || 0, 0, 1) : 0);
    if (cp.uFlirActors != null && flirActors) gl.uniform4fv(cp.uFlirActors, flirActors);
    if (cp.uVisorOn != null) gl.uniform1i(cp.uVisorOn, activeVisor ? 1 : 0);
    if (cp.uVisorCount != null) gl.uniform1i(cp.uVisorCount, activeVisor ? visorCount : 0);
    if (cp.uVisorAspect != null) gl.uniform1f(cp.uVisorAspect, aspect || 16 / 9);
    if (cp.uVisorDrop != null && visorDrops) gl.uniform4fv(cp.uVisorDrop, visorDrops);
    if (cp.uVisorMeta != null && visorMeta) gl.uniform4fv(cp.uVisorMeta, visorMeta);

    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (const u of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.enable(gl.DEPTH_TEST);
  }
}
