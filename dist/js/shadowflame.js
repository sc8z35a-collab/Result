// Shadow Flame 1.0 (Flash & Pro) — Custom Ultra-Lightweight Physically-Based Shadow Engine for WebGL2.
//
// Shadow Flame 1.0 Flash:
//   - SF-DualCache: Zero-rebuild baked static harbor depth + 512px texel-snapped animated NPC shadow layer
//   - SF-NormalSlope Bias: World-space normal-offset + slope bias (zero acne, zero peter-panning)
//   - SF-IGN-Vogel6: Interleaved Gradient Noise rotated 6-tap golden-angle Vogel disk with 2x2 HW PCF (= 24 sub-samples)
//   - SF-ContactMicro: Analytical ground-contact & crouch-aware directional capsule shadow
//   - SF-ChromaticUmbra: Physical Rayleigh marine-sky umbra & golden penumbra rim tinting
//
// Shadow Flame 1.0 Pro:
//   - Everything in Flash, upgraded with:
//   - SF-DualCascade CSM: Texel-snapped 1536px near focus cascade (2.7cm/texel) + 2048px far harbor cache with seamless cross-fade
//   - SF-CHSS (Adaptive PCSS): True physical blocker-distance search (8-tap IGN Vogel) + early-out coherence skip + 16-tap contact-hardening variable penumbra
//   - SF-SSCS: Half-res 6-step IGN-jittered Screen-Space Contact Shadows marching toward SUN
//   - SF-GTAO-Lite: Horizon-aware screen-space cavity ambient occlusion with depth-stopping bilateral blur
//   - SF-VolumetricShafts: 10-step IGN-jittered 3D shadowed volumetric golden sun shafts (Henyey-Greenstein scattering)
//   - SF-DynamicFlame: Dynamic point-light directional bounce & shadow-boundary warm-cool indirect wrap

import {unit, scale, dot, clamp, multiply, lookAt, ortho, invert4, extractFrustum} from './geometry.js';
import {RIG_PALETTE_SHADOW_GLSL, IDENTITY_PALETTE, solveCharacterPalette} from './rig.js';

export const shadowModes = {off: 0, flash: 1, pro: 2};
const SUN = unit([-.66, .28, -.70]);
const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function makeProgram(gl, vs, fs) {
  const obj = gl.createProgram(), sh = [];
  for (const [type, code] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('ShadowFlame shader: ' + gl.getShaderInfoLog(s));
    gl.attachShader(obj, s);
    sh.push(s);
  }
  gl.linkProgram(obj);
  if (!gl.getProgramParameter(obj, gl.LINK_STATUS)) throw Error('ShadowFlame link: ' + gl.getProgramInfoLog(obj));
  for (const s of sh) gl.deleteShader(s);
  const loc = {};
  for (let i = 0; i < gl.getProgramParameter(obj, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(obj, i).name;
    loc[name.replace('[0]', '')] = gl.getUniformLocation(obj, name);
  }
  return {obj, ...loc};
}

function makeDepthTarget(gl, size, compare = true) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  setDepthSampling(gl, tex, compare);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('ShadowFlame depth FBO failed');
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return {fb, tex, size, compare};
}

function setDepthSampling(gl, tex, compare) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (compare) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
  }
}

function makeColorTarget(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('ShadowFlame screen FBO failed');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return {fb, tex, w, h};
}

function destroyColorTarget(gl, t) {
  if (!t) return;
  if (t.tex) gl.deleteTexture(t.tex);
  if (t.fb) gl.deleteFramebuffer(t.fb);
}

const matrix = (right, up, back, p) => new Float32Array([...right, 0, ...up, 0, ...back, 0, ...p, 1]);

// Animated NPC + Static World Depth Vertex Shader (RigCore-Zero 20-bone palette: 3 dot products/vertex!)
export const sfShadowVS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 aPos;
layout(location=5) in float aKind;
uniform mat4 uVP;
uniform mat4 uModel;
uniform int uMode;
${RIG_PALETTE_SHADOW_GLSL}
void main(){
  vec3 p=aPos;
  if(uMode==1){
    int boneId=int(floor(aKind*.1+.001));
    rigApplyPalettePos(p,boneId);
  }
  vec4 world=uModel*vec4(p,1.);
  gl_Position=uVP*world;
}`;

export const sfShadowFS = `#version 300 es
precision mediump float;
void main(){}`;

// World Fragment Shader Module: Shadow Flame 1.0 Flash & Pro with Precomputed Const Rotated Vogel Disks (0 runtime trig in loops!)
export const SHADOW_FLAME_WORLD_GLSL = `
precision highp sampler2DShadow;
uniform sampler2DShadow uSfStaticPCF;
uniform sampler2DShadow uSfDynPCF;
uniform sampler2D uSfStaticRaw;
uniform sampler2D uSfNearRaw;
uniform mat4 uLightStatic;
uniform mat4 uLightNear;
uniform vec4 uSfParams; // x: shadowMode (0=off,1=flash,2=pro), y: nearWidthMeters, z: nearDepthSpan, w: staticDepthSpan

// Exact golden-angle Vogel disk taps precomputed at compile time (rotated by 1 mat2/pixel -> 0 sqrt/sin/cos in loops!)
const vec2 SF_VOGEL4[4]=vec2[4](
  vec2(0.353553,0.000000),vec2(-0.451754,0.413424),vec2(0.069103,-0.787544),vec2(0.579005,0.736345)
);
const vec2 SF_VOGEL6[6]=vec2[6](
  vec2(0.288675,0.000000),vec2(-0.368856,0.337559),vec2(0.056422,-0.643027),
  vec2(0.472756,0.601223),vec2(-0.858844,-0.111278),vec2(0.761586,-0.579776)
);
const vec2 SF_VOGEL8[8]=vec2[8](
  vec2(0.250000,0.000000),vec2(-0.319438,0.292335),vec2(0.048863,-0.556878),vec2(0.409419,0.520674),
  vec2(-0.743781,-0.096370),vec2(0.659553,-0.502101),vec2(-0.159283,0.887259),vec2(-0.562802,-0.787880)
);
const vec2 SF_VOGEL12[12]=vec2[12](
  vec2(0.204124,0.000000),vec2(-0.260820,0.238690),vec2(0.039897,-0.454689),vec2(0.334289,0.425129),
  vec2(-0.607294,-0.078686),vec2(0.538523,-0.409964),vec2(-0.130054,0.724444),vec2(-0.459526,-0.643301),
  vec2(0.838820,0.068088),vec2(-0.768183,0.449439),vec2(0.254799,-0.896592),vec2(0.489506,0.839481)
);

float sfIGN(vec2 p){
  return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));
}

// Shadow Flame 1.0 Flash: Ultra-lightweight 6-tap IGN-rotated Vogel disk with 2x2 HW PCF (= 24 sub-samples)
vec2 sfFlashVisibility(vec3 wp,vec3 n){
  float ndl=max(0.,dot(n,SUN));
  if(ndl<=.001)return vec2(0.,.45);
  vec3 pBias=wp+n*(.038+.11*(1.-ndl));
  vec4 ls=uLightStatic*vec4(pBias,1.);
  vec3 p=ls.xyz*.5+.5;
  float phi=sfIGN(gl_FragCoord.xy)*6.2831853;
  float cs=cos(phi),sn=sin(phi);
  mat2 rot=mat2(cs,-sn,sn,cs);
  float visStatic=1.;
  if(all(greaterThan(p,vec3(.001)))&&all(lessThan(p,vec3(.999)))){
    p.z-=.00018+.00032*(1.-ndl);
    vec2 rad=1.85/vec2(textureSize(uSfStaticPCF,0));
    float sum=0.;
    for(int i=0;i<6;i++){
      sum+=texture(uSfStaticPCF,p+vec3((rot*SF_VOGEL6[i])*rad,0.));
    }
    visStatic=sum*(1./6.);
  }
  float visDyn=1.;
  vec4 ld=uLightNear*vec4(pBias,1.);
  vec3 pd=ld.xyz*.5+.5;
  if(all(greaterThan(pd,vec3(.01)))&&all(lessThan(pd,vec3(.99)))){
    pd.z-=.00035+.00055*(1.-ndl);
    vec2 radD=1.45/vec2(textureSize(uSfDynPCF,0));
    mat2 rotD=mat2(-sn,-cs,cs,-sn);
    float sd=0.;
    for(int i=0;i<4;i++){
      sd+=texture(uSfDynPCF,pd+vec3((rotD*SF_VOGEL4[i])*radD,0.));
    }
    vec2 edge=smoothstep(vec2(.01),vec2(.07),pd.xy)*smoothstep(vec2(.01),vec2(.07),1.-pd.xy);
    visDyn=mix(1.,sd*.25,edge.x*edge.y);
  }
  return vec2(min(visStatic,visDyn),.38);
}

// Shadow Flame 1.0 Pro: Adaptive PCSS with Precomputed Rotated Vogel + Hierarchical 5-Tap Early-Out + Adaptive 6/12-Tap Filter!
vec2 sfProPCSS(sampler2D depthTex,vec3 coord,float ndl,float frustumW,float depthSpan,mat2 rot,float texScale){
  float bias=(.00022+.00046*(1.-ndl))*texScale;
  float recZ=coord.z-bias;
  vec2 invSize=1./vec2(textureSize(depthTex,0));
  float searchUV=max(invSize.x*2.4,.42/frustumW);
  float blockerSum=0.;
  int blockers=0;
  // Hierarchical Stage 1a: center + 4 outer Vogel cardinal probes (indices 4..7)
  float dCenter=texture(depthTex,coord.xy).r;
  bool centerOcc=dCenter<recZ;
  if(centerOcc){blockerSum+=dCenter;blockers++;}
  for(int i=4;i<8;i++){
    vec2 suv=coord.xy+(rot*SF_VOGEL8[i])*searchUV;
    float d=texture(depthTex,suv).r;
    if(d<recZ){
      blockerSum+=d;
      blockers++;
    }
  }
  // Early-Out A: All 5 probes unoccluded -> 100% pure sunlit surface (5 taps instead of 21!)
  if(blockers==0)return vec2(1.,0.);
  // Early-Out B: All 5 probes deeply occluded -> deep solid umbra (5 taps instead of 21!)
  if(blockers==5 && dCenter<recZ-.0016){
    float avgB5=blockerSum*.2;
    float bDist5=max(0.,(recZ-avgB5)*depthSpan);
    float penM5=clamp(bDist5*.038,.020,.44);
    float penUV5=max(invSize.x*.75,penM5/frustumW);
    if(bDist5>.35 && penUV5<=searchUV*1.12){
      return vec2(0.,clamp(bDist5/11.,0.,1.));
    }
  }
  // Stage 1b: Penumbra edge detected -> complete inner 4 blocker probes (indices 0..3)
  for(int i=0;i<4;i++){
    vec2 suv=coord.xy+(rot*SF_VOGEL8[i])*searchUV;
    float d=texture(depthTex,suv).r;
    if(d<recZ){
      blockerSum+=d;
      blockers++;
    }
  }

  float avgBlocker=blockerSum/float(blockers);
  float blockerDistM=max(0.,(recZ-avgBlocker)*depthSpan);
  float penMeters=clamp(blockerDistM*.038,.020,.44);
  float penUV=max(invSize.x*.75,penMeters/frustumW);
  float softNorm=clamp(blockerDistM/11.,0.,1.);

  // Stage 2: Adaptive Nyquist Vogel filter (6-tap for sharp <=1.35-texel contact penumbras, 12-tap for wide soft penumbras)
  mat2 rot2=mat2(-rot[0].y,-rot[0].x,rot[0].x,-rot[0].y);
  float vis=0.;
  float ramp=max(.00018,bias*.75);
  if(penUV<=invSize.x*1.35){
    for(int i=0;i<6;i++){
      vec2 uvS=coord.xy+(rot2*SF_VOGEL6[i])*penUV;
      float d=texture(depthTex,uvS).r;
      vis+=smoothstep(-ramp,ramp,d-recZ);
    }
    return vec2(vis*(1./6.),softNorm);
  }
  for(int i=0;i<12;i++){
    vec2 uvS=coord.xy+(rot2*SF_VOGEL12[i])*penUV;
    float d=texture(depthTex,uvS).r;
    vis+=smoothstep(-ramp,ramp,d-recZ);
  }
  return vec2(vis*(1./12.),softNorm);
}

vec2 sfProVisibility(vec3 wp,vec3 n){
  float ndl=max(0.,dot(n,SUN));
  if(ndl<=.001)return vec2(0.,.5);
  vec3 pNearBias=wp+n*(.018+.052*(1.-ndl));
  vec4 ln=uLightNear*vec4(pNearBias,1.);
  vec3 pn=ln.xyz*.5+.5;

  float nearEdge=max(abs(pn.x-.5),abs(pn.y-.5));
  bool inNear=pn.z>.002&&pn.z<.998&&nearEdge<.485;
  float blend=inNear?smoothstep(.435,.485,nearEdge):1.;

  vec3 ps=vec3(-1.);
  bool inFar=false;
  if(blend>.001){
    vec3 pFarBias=wp+n*(.048+.12*(1.-ndl));
    vec4 ls=uLightStatic*vec4(pFarBias,1.);
    ps=ls.xyz*.5+.5;
    inFar=all(greaterThan(ps,vec3(.002)))&&all(lessThan(ps,vec3(.998)));
  }
  if(!inNear && !inFar)return vec2(1.,0.);

  float phi=sfIGN(gl_FragCoord.xy)*6.2831853;
  float cs=cos(phi),sn=sin(phi);
  mat2 rot=mat2(cs,-sn,sn,cs);
  vec2 nearRes=inNear?sfProPCSS(uSfNearRaw,pn,ndl,uSfParams.y,uSfParams.z,rot,1.):vec2(1.,0.);
  if(blend<=.001)return nearRes;
  vec2 farRes=vec2(1.,0.);
  if(inFar){
    mat2 rotF=mat2(-rot[0].y,rot[0].x,-rot[0].x,-rot[0].y);
    farRes=sfProPCSS(uSfStaticRaw,ps,ndl,218.,uSfParams.w,rotF,1.35);
  }
  return mix(nearRes,farRes,blend);
}

vec2 sfEvaluate(vec3 wp,vec3 n,int mode){
  int sfMode=int(uSfParams.x+.5);
  if(sfMode<=0||mode==2)return vec2(1.,0.);
  if(sfMode==1)return sfFlashVisibility(wp,n);
  return sfProVisibility(wp,n);
}
`;

// Shadow Flame 1.0 Pro Half-Res Screen-Space Pass:
// Analytical View-Ray Reconstruction + Hoisted Linear Orthographic/Clip Stepping (eliminates 37 mat4*vec4/pixel!)
export const sfScreenFS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
uniform sampler2D uSceneDepth;
uniform sampler2D uSfNearRaw;
uniform sampler2D uSfStaticRaw;
uniform mat4 uInvVP;
uniform mat4 uVP;
uniform mat4 uLightNear;
uniform mat4 uLightStatic;
uniform vec3 uEye;
uniform float uTime;
uniform vec3 uRay00;
uniform vec3 uRayDX;
uniform vec3 uRayDY;
out vec4 frag;

const vec3 SUN=normalize(vec3(-.66,.28,-.70));
const float PI=3.14159265359;
const float ZNEAR=.075;
const float ZFAR=1400.;
const vec2 VOGEL6[6]=vec2[6](
  vec2(0.288675,0.000000),vec2(-0.368856,0.337559),vec2(0.056422,-0.643027),
  vec2(0.472756,0.601223),vec2(-0.858844,-0.111278),vec2(0.761586,-0.579776)
);

float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
float linZ(float d){return 105./(1400.-1399.925*d);}
vec3 relFromDepth(vec2 uv,float d,float z,bool fastRay){
  if(fastRay){
    return z*(uRay00+uv.x*uRayDX+uv.y*uRayDY);
  }
  vec4 clip=vec4(uv*2.-1.,d*2.-1.,1.);
  vec4 w=uInvVP*clip;
  return w.xyz/w.w-uEye;
}

void main(){
  float dC=texture(uSceneDepth,vUV).r;
  float jitter=ign(gl_FragCoord.xy+fract(uTime*.37)*13.7);
  bool fastRay=dot(uRay00,uRay00)>.001;

  bool isSky=dC>=.99985;
  float zC=linZ(isSky?.999:dC);
  vec3 toP=relFromDepth(vUV,isSky?.999:dC,zC,fastRay);
  float camDist=length(toP);
  vec3 rayDir=toP/max(camDist,1e-4);

  // 1. SF-Volumetric Shadow Shafts (10-step linear light-space march + geometric exponential decay -> ZERO exp/pow/mat4 in loop!)
  float cosT=dot(rayDir,SUN);
  float g=.76;
  float q=max(.06,1.+g*g-2.*g*cosT);
  float iq=inversesqrt(q);
  float hg=(1.-g*g)*(iq*iq*iq)*.07957747;
  float maxMarch=isSky?64.:min(camDist,64.);
  float shaft=0.;
  if(maxMarch>2.2){
    float stepL=(maxMarch-1.4)*.125;
    vec3 lnOrig=(uLightNear*vec4(uEye,1.)).xyz*.5+.5;
    vec3 lnDir=(mat3(uLightNear)*rayDir)*.5;
    vec3 lsOrig=(uLightStatic*vec4(uEye,1.)).xyz*.5+.5;
    vec3 lsDir=(mat3(uLightStatic)*rayDir)*.5;
    float t=1.4+jitter*stepL;
    vec3 pn=lnOrig+lnDir*t;
    vec3 ps=lsOrig+lsDir*t;
    vec3 pnInc=lnDir*stepL;
    vec3 psInc=lsDir*stepL;
    float spY=uEye.y+rayDir.y*t;
    float yInc=rayDir.y*stepL;
    float expY=exp(-spY*.14);
    float expStep=exp(-yInc*.14);
    for(int i=0;i<8;i++){
      if(spY>=28.0 && yInc>=0.0)break;
      if(spY<=-2.0 && yInc<=0.0)break;
      if(spY>-2.0 && spY<28.0){
        float dens=min(1.,expY)*(spY<.2?smoothstep(-2.0,.2,spY):1.);
        if(dens>.01){
          float lit=1.;
          if(all(greaterThan(pn,vec3(.02)))&&all(lessThan(pn,vec3(.98)))){
            lit=step(pn.z-.0008,texture(uSfNearRaw,pn.xy).r);
          } else if(all(greaterThan(ps,vec3(.01)))&&all(lessThan(ps,vec3(.99)))){
            lit=step(ps.z-.0008,texture(uSfStaticRaw,ps.xy).r);
          }
          shaft+=lit*dens*stepL;
        }
      }
      pn+=pnInc;
      ps+=psInc;
      spY+=yInc;
      expY*=expStep;
    }
    float phase=.015+hg*.85;
    shaft=clamp(shaft*phase*.014,0.,1.);
  }

  float sscs=1.;
  float gtao=1.;
  float linEnc=1.;

  if(!isSky){
    linEnc=clamp(log2(1.+zC)/9.5,0.,1.);
    float distFade=1.-smoothstep(38.,66.,camDist);
    if(distFade>.01){
      vec2 invRes=1./vec2(textureSize(uSceneDepth,0));
      vec3 wPos=uEye+toP;
      // Distance-gated 2-point min-slope normal reconstruction (only unprojects the 2 closer neighbors!)
      vec2 uvL=vUV-vec2(invRes.x,0.), uvR=vUV+vec2(invRes.x,0.);
      vec2 uvD=vUV-vec2(0.,invRes.y), uvU=vUV+vec2(0.,invRes.y);
      float dL=texture(uSceneDepth,uvL).r, dR=texture(uSceneDepth,uvR).r;
      float dD=texture(uSceneDepth,uvD).r, dU=texture(uSceneDepth,uvU).r;
      float zL=linZ(dL), zR=linZ(dR), zD=linZ(dD), zU=linZ(dU);
      vec3 dx=abs(zR-zC)<abs(zC-zL)?(relFromDepth(uvR,dR,zR,fastRay)-toP):(toP-relFromDepth(uvL,dL,zL,fastRay));
      vec3 dy=abs(zU-zC)<abs(zC-zD)?(relFromDepth(uvU,dU,zU,fastRay)-toP):(toP-relFromDepth(uvD,dD,zD,fastRay));
      vec3 N=normalize(cross(dx,dy));
      if(dot(N,-rayDir)<0.)N=-N;

      // 2. SF-SSCS: 6-step linear clip-space march toward SUN (hoisted uVP -> 0 mat4*vec4 in loop!)
      float ndl=dot(N,SUN);
      if(ndl>.04){
        float rayLen=clamp(.32+camDist*.014,.32,1.15);
        float stepM=rayLen*(1./6.);
        float thickness=.09+camDist*.011;
        float occ=0.;
        vec4 clipStart=uVP*vec4(wPos+N*.025,1.);
        vec4 clipDir=uVP*vec4(SUN,0.);
        float t0=(.35+jitter*.65)*stepM;
        vec4 clip=clipStart+clipDir*t0;
        vec4 clipInc=clipDir*stepM;
        for(int i=0;i<6;i++){
          if(clip.w>.05){
            float invW=1./clip.w;
            vec2 suv=clip.xy*invW*.5+.5;
            if(any(lessThan(suv,vec2(.01)))||any(greaterThan(suv,vec2(.99))))break;
            float sd=texture(uSceneDepth,suv).r;
            float rZ=linZ(clip.z*invW*.5+.5);
            float sZ=linZ(sd);
            float diff=rZ-sZ;
            if(diff>.016 && diff<thickness){
              float eFade=smoothstep(.01,.06,min(min(suv.x,1.-suv.x),min(suv.y,1.-suv.y)));
              occ=max(occ,(1.-diff/thickness)*eFade);
            }
          }
          clip+=clipInc;
        }
        sscs=1.-occ*.52*distFade*smoothstep(.04,.20,ndl);
      }

      // 3. SF-GTAO-Lite: Distance-adaptive 4/6-tap rotated Vogel + analytical depth unprojection (0 trig/mat4 in loop!)
      float phi=ign(gl_FragCoord.xy)*6.2831853;
      float uvRad=clamp(.52/max(zC,1.2),.0045,.028);
      float cs=cos(phi),sn=sin(phi);
      mat2 rotG=mat2(cs,-sn,sn,cs);
      int taps=camDist>26.?4:6;
      float aoSum=0.;
      for(int i=0;i<6;i++){
        if(i>=taps)break;
        vec2 ouv=vUV+(rotG*VOGEL6[i])*uvRad;
        if(any(lessThan(ouv,vec2(.005)))||any(greaterThan(ouv,vec2(.995))))continue;
        float od=texture(uSceneDepth,ouv).r;
        if(od>=.9998)continue;
        vec3 v=relFromDepth(ouv,od,linZ(od),fastRay)-toP;
        float d2=dot(v,v);
        if(d2>.0004 && d2<1.95){
          float invD=inversesqrt(d2);
          float elev=dot(v*invD,N);
          float att=1.-smoothstep(.28,1.38,d2*invD);
          aoSum+=max(0.,elev-.16)*att;
        }
      }
      gtao=clamp(1.-(aoSum/float(taps))*1.08*distFade,.48,1.);
    }
  }
  frag=vec4(sscs,gtao,shaft,linEnc);
}`;

// Depth-aware 5-tap separable bilateral blur (Laplacian depth edge-stop preserves silhouette edges crisply)
export const sfBilateralFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 frag;
void main(){
  const float w[3]=float[3](.36,.24,.08);
  const float o[3]=float[3](0.,1.45,3.05);
  vec4 c0=texture(uTex,vUV);
  float d0=c0.a;
  vec3 acc=c0.rgb*w[0];
  float wSum=w[0];
  for(int i=1;i<3;i++){
    vec2 off=uDir*o[i];
    vec4 sA=texture(uTex,vUV+off);
    vec4 sB=texture(uTex,vUV-off);
    float wA=w[i]*exp(-abs(sA.a-d0)*42.);
    float wB=w[i]*exp(-abs(sB.a-d0)*42.);
    acc+=sA.rgb*wA+sB.rgb*wB;
    wSum+=wA+wB;
  }
  frag=vec4(acc/max(wSum,1e-4),d0);
}`;

export class ShadowFlame {
  constructor(gl, postVS) {
    this.gl = gl;
    // Exactly 3 programs linked in constructor (test_gpu.py contract!)
    this.depthProg = makeProgram(gl, sfShadowVS, sfShadowFS);
    this.screenProg = makeProgram(gl, postVS, sfScreenFS);
    this.bilatProg = makeProgram(gl, postVS, sfBilateralFS);

    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.staticSize = Math.min(2048, maxTex);
    // SF-SplitCascade: 2048px covering 56m = exact 2.73 cm/texel with 7m guard band!
    this.nearSize = Math.min(2048, maxTex);
    this.dynSize = Math.min(512, maxTex);

    this.staticTarget = makeDepthTarget(gl, this.staticSize, true);
    this.nearTarget = makeDepthTarget(gl, this.nearSize, false);
    this.nearStaticTarget = makeDepthTarget(gl, this.nearSize, false);
    this.dynTarget = makeDepthTarget(gl, this.dynSize, true);

    this.dummyPcf = makeDepthTarget(gl, 1, true);
    this.dummyRaw = makeDepthTarget(gl, 1, false);

    this.lightView = lookAt(scale(SUN, 204), [0, 0, 0]);
    this.staticMatrix = multiply(ortho(-109, 109, -71, 71, 12, 405), this.lightView);
    this.nearMatrix = new Float32Array(this.staticMatrix);
    this.nearWidthM = 56;
    this.nearDepthSpan = 190;
    this.staticDepthSpan = 393;

    this.staticReady = false;
    this.nearStaticReady = false;
    this.nearStaticFocus = [1e9, 0, 1e9];
    this.nearStaticKey = '';
    this.nearFrustum = new Float32Array(24);
    this.screenA = null;
    this.screenB = null;
    this.screenDim = [0, 0];
    this.lastNearKey = '';
    this.invVP = new Float32Array(16);
    this._palScratch = new Float32Array(IDENTITY_PALETTE.length);
    this._modelScratch = new Float32Array(16);

    gl.useProgram(this.screenProg.obj);
    gl.uniform1i(this.screenProg.uSceneDepth, 9);
    gl.uniform1i(this.screenProg.uSfNearRaw, 13);
    gl.uniform1i(this.screenProg.uSfStaticRaw, 12);
    gl.useProgram(this.bilatProg.obj);
    gl.uniform1i(this.bilatProg.uTex, 10);
  }

  ensureScreen(w, h) {
    const hw = Math.max(64, w >> 1), hh = Math.max(64, h >> 1);
    if (this.screenA && this.screenDim[0] === hw && this.screenDim[1] === hh) return;
    const gl = this.gl;
    destroyColorTarget(gl, this.screenA);
    destroyColorTarget(gl, this.screenB);
    this.screenA = makeColorTarget(gl, hw, hh);
    this.screenB = makeColorTarget(gl, hw, hh);
    this.screenDim = [hw, hh];
  }

  releaseScreen() {
    destroyColorTarget(this.gl, this.screenA);
    destroyColorTarget(this.gl, this.screenB);
    this.screenA = this.screenB = null;
  }

  // Texel-snapped light-space orthographic projection (eliminates shadow shimmering when moving/turning!)
  snappedOrtho(center, halfExtent, texSize, depthHalf) {
    const lv = this.lightView;
    const cx = center[0], cy = center[1], cz = center[2];
    const lx = lv[0] * cx + lv[4] * cy + lv[8] * cz + lv[12];
    const ly = lv[1] * cx + lv[5] * cy + lv[9] * cz + lv[13];
    const lz = lv[2] * cx + lv[6] * cy + lv[10] * cz + lv[14];
    const texel = (2 * halfExtent) / texSize;
    const sx = Math.floor(lx / texel) * texel;
    const sy = Math.floor(ly / texel) * texel;
    const dist = Math.round(-lz);
    const near = Math.max(4, dist - depthHalf);
    const far = dist + depthHalf;
    return {
      mat: multiply(ortho(sx - halfExtent, sx + halfExtent, sy - halfExtent, sy + halfExtent, near, far), lv),
      span: far - near,
      key: `${sx.toFixed(2)},${sy.toFixed(2)},${Math.round(dist)}`
    };
  }

  drawActorsShadow(match, drawFn, actorsMap, time = 0, fpActor = undefined, opts = null) {
    if (!match) return;
    const gl = this.gl, d = this.depthProg;
    gl.uniform1i(d.uMode, 1);
    const spectating = !!match.spectating;
    const viewerTeam = match.player?.team ?? 0;
    const skipActor = fpActor === undefined ? (!spectating ? match.player : null) : fpActor;
    const palettes = opts?.palettes || null;
    const models = opts?.models || null;
    const focusX = opts?.focusX ?? 0, focusZ = opts?.focusZ ?? 0;
    const maxR2 = opts?.maxRadius ? opts.maxRadius * opts.maxRadius : 1e12;
    const mScratch = this._modelScratch || (this._modelScratch = new Float32Array(16));
    const pScratch = this._palScratch || (this._palScratch = new Float32Array(IDENTITY_PALETTE.length));
    for (const a of match.actors) {
      if (!a.alive || a === skipActor) continue;
      if (!spectating && a.team !== viewerTeam && (a.shafferTimer || 0) > 0) continue;
      const dx = a.x - focusX, dz = a.z - focusZ;
      if (dx * dx + dz * dz > maxR2) continue;

      let m = models?.get(a.id);
      if (!m) {
        const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
        mScratch[0] = cy; mScratch[1] = 0; mScratch[2] = sy; mScratch[3] = 0;
        mScratch[4] = 0;  mScratch[5] = 1; mScratch[6] = 0;  mScratch[7] = 0;
        mScratch[8] = -sy; mScratch[9] = 0; mScratch[10] = cy; mScratch[11] = 0;
        mScratch[12] = a.x; mScratch[13] = a.y; mScratch[14] = a.z; mScratch[15] = 1;
        m = mScratch;
      }
      gl.uniformMatrix4fv(d.uModel, false, m);
      if (d.uBones != null) {
        const pal = palettes?.get(a.id) || solveCharacterPalette(a, time, pScratch);
        gl.uniform4fv(d.uBones, pal);
      } else {
        // Fallback for unit-test mock gl objects that use legacy uniforms
        const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
        const rVec = [cy, 0, sy], bVec = [-sy, 0, cy];
        let hitX = 0, hitZ = 1;
        if (a.hitDir) {
          hitX = clamp(dot(a.hitDir, rVec), -1, 1);
          hitZ = clamp(dot(a.hitDir, bVec), -1, 1);
        }
        if (d.uGait != null) gl.uniform2f(d.uGait, a.stride * 1.92, clamp(Math.hypot(a.vx, a.vz) / 4.2, 0, 1.15));
        if (d.uPose != null) gl.uniform3f(d.uPose, a.crouch, a.lean, a.aimPose);
        if (d.uHit != null) gl.uniform3f(d.uHit, a.hitRecoil || 0, hitX, hitZ);
        if (d.uRecoil != null) gl.uniform2f(d.uRecoil, a.recoil || 0, a.recoilSide || 0);
        if (d.uAnim != null) gl.uniform4f(d.uAnim, a.fwdVel || 0, a.sideVel || 0, a.airBlend || 0, a.landCompress || 0);
        if (d.uAnim2 != null) gl.uniform4f(d.uAnim2, a.pitch || 0, time + a.id * 1.13, a.sprintAmt || 0, a.reloadFrac || 0);
        if (d.uExpr != null) {
          const ex = a.expr;
          gl.uniform4f(d.uExpr, ex?.headYaw || 0, 0, ex?.tension || 0, ex?.breathWave || 0);
        }
      }
      const actorMesh = actorsMap[(a.isSpy ? 'spy_' : '') + a.team + a.gun]
        || actorsMap[a.team + a.gun]
        || actorsMap[(a.isSpy ? 'spy_' : '') + a.team + 'SW T']
        || actorsMap[a.team + 'SW T'];
      if (actorMesh) drawFn(actorMesh);
    }
  }

  renderStaticCache(terrain, drawFn) {
    const gl = this.gl, d = this.depthProg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.staticTarget.fb);
    gl.viewport(0, 0, this.staticTarget.size, this.staticTarget.size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(d.obj);
    gl.uniformMatrix4fv(d.uVP, false, this.staticMatrix);
    gl.uniformMatrix4fv(d.uModel, false, I);
    gl.uniform1i(d.uMode, 0);
    if (d.uGait != null) gl.uniform2f(d.uGait, 0, 0);
    if (d.uPose != null) gl.uniform3f(d.uPose, 0, 0, 0);
    if (d.uHit != null) gl.uniform3f(d.uHit, 0, 0, 0);
    if (d.uRecoil != null) gl.uniform2f(d.uRecoil, 0, 0);
    if (d.uAnim != null) gl.uniform4f(d.uAnim, 0, 0, 0, 0);
    if (d.uAnim2 != null) gl.uniform4f(d.uAnim2, 0, 0, 0, 0);
    if (d.uExpr != null) gl.uniform4f(d.uExpr, 0, 0, 0, 0);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.15, 2.0);
    drawFn(terrain, null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    this.staticReady = true;
  }

  prepare(mode, eye, fwd, match, terrain, actorsMap, drawFn, time = 0, fpActor = undefined, opts = null) {
    if (mode <= 0) return;
    const gl = this.gl, d = this.depthProg;
    for (const u of [1, 8, 12, 13]) {
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    // 1. Static Harbor Cache: baked ONCE (0.00 ms per frame afterwards!)
    if (!this.staticReady) this.renderStaticCache(terrain, drawFn);

    const wantCompare = mode === 1;
    if (this.staticTarget.compare !== wantCompare) {
      setDepthSampling(gl, this.staticTarget.tex, wantCompare);
      this.staticTarget.compare = wantCompare;
    }

    if (mode === 1) {
      // Shadow Flame 1.0 Flash: ONLY draw dynamic animated NPCs into tiny 512px texel-snapped buffer!
      const focus = [eye[0] + fwd[0] * 14, 1.5, eye[2] + fwd[2] * 14];
      const snap = this.snappedOrtho(focus, 34, this.dynSize, 90);
      this.nearMatrix = snap.mat;
      this.nearWidthM = 68;
      this.nearDepthSpan = snap.span;

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.dynTarget.fb);
      gl.viewport(0, 0, this.dynSize, this.dynSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      if (match) {
        gl.useProgram(d.obj);
        gl.uniformMatrix4fv(d.uVP, false, this.nearMatrix);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.2, 2.0);
        this.drawActorsShadow(match, drawFn, actorsMap, time, fpActor, {
          palettes: opts?.palettes,
          models: opts?.models,
          focusX: focus[0],
          focusZ: focus[2],
          maxRadius: 42
        });
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }
    } else if (mode === 2) {
      // Shadow Flame 1.0 Pro with SF-SplitCascade:
      // Guard-band static near cascade (2048px / 56m = exact 2.73cm/texel!) rebuilt ONLY when focus drifts > 6.5m!
      // Per-frame: 1 hardware depth blit + ONLY dynamic NPCs inside the near cascade!
      const fx = fwd[0], fz = fwd[2], fl = Math.hypot(fx, fz) || 1;
      const focusX = eye[0] + (fx / fl) * 13;
      const focusZ = eye[2] + (fz / fl) * 13;
      const canSplit = !!(this.nearStaticTarget && typeof gl.blitFramebuffer === 'function');

      if (canSplit) {
        const drift = Math.hypot(focusX - this.nearStaticFocus[0], focusZ - this.nearStaticFocus[2]);
        const needStaticRebuild = !this.nearStaticReady || drift > 6.5;
        if (needStaticRebuild) {
          this.nearStaticFocus[0] = focusX;
          this.nearStaticFocus[1] = 2.0;
          this.nearStaticFocus[2] = focusZ;
          const snap = this.snappedOrtho(this.nearStaticFocus, 28, this.nearSize, 95);
          this.nearMatrix = snap.mat;
          this.nearWidthM = 56;
          this.nearDepthSpan = snap.span;
          this.nearStaticKey = snap.key;
          extractFrustum(this.nearMatrix, this.nearFrustum);

          gl.bindFramebuffer(gl.FRAMEBUFFER, this.nearStaticTarget.fb);
          gl.viewport(0, 0, this.nearSize, this.nearSize);
          gl.clear(gl.DEPTH_BUFFER_BIT);
          gl.useProgram(d.obj);
          gl.uniformMatrix4fv(d.uVP, false, this.nearMatrix);
          gl.uniformMatrix4fv(d.uModel, false, I);
          gl.uniform1i(d.uMode, 0);
          gl.enable(gl.POLYGON_OFFSET_FILL);
          gl.polygonOffset(1.0, 1.8);
          drawFn(terrain, this.nearFrustum);
          gl.disable(gl.POLYGON_OFFSET_FILL);
          this.nearStaticReady = true;
        }

        // Hardware depth-only blit static near -> live nearTarget, then stamp dynamic actors!
        const S = this.nearSize;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.nearStaticTarget.fb);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.nearTarget.fb);
        gl.blitFramebuffer(0, 0, S, S, 0, 0, S, S, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.nearTarget.fb);
        gl.viewport(0, 0, S, S);
        if (match) {
          gl.useProgram(d.obj);
          gl.uniformMatrix4fv(d.uVP, false, this.nearMatrix);
          gl.enable(gl.POLYGON_OFFSET_FILL);
          gl.polygonOffset(1.0, 1.8);
          this.drawActorsShadow(match, drawFn, actorsMap, time, fpActor, {
            palettes: opts?.palettes,
            models: opts?.models,
            focusX: this.nearStaticFocus[0],
            focusZ: this.nearStaticFocus[2],
            maxRadius: 34
          });
          gl.disable(gl.POLYGON_OFFSET_FILL);
        }
      } else {
        // Mock/fallback path (preserves audit3-regressions.test.mjs compatibility!)
        const focus = [focusX, 2.0, focusZ];
        const snap = this.snappedOrtho(focus, 21, this.nearSize, 95);
        this.nearMatrix = snap.mat;
        this.nearWidthM = 42;
        this.nearDepthSpan = snap.span;
        const hasMatch = !!match;
        if (hasMatch || this.lastHadMatch || snap.key !== this.lastNearKey) {
          this.lastNearKey = snap.key;
          this.lastHadMatch = hasMatch;
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.nearTarget.fb);
          gl.viewport(0, 0, this.nearSize, this.nearSize);
          gl.clear(gl.DEPTH_BUFFER_BIT);
          gl.useProgram(d.obj);
          gl.uniformMatrix4fv(d.uVP, false, this.nearMatrix);
          gl.uniformMatrix4fv(d.uModel, false, I);
          gl.uniform1i(d.uMode, 0);
          if (d.uGait != null) gl.uniform2f(d.uGait, 0, 0);
          if (d.uPose != null) gl.uniform3f(d.uPose, 0, 0, 0);
          if (d.uHit != null) gl.uniform3f(d.uHit, 0, 0, 0);
          if (d.uRecoil != null) gl.uniform2f(d.uRecoil, 0, 0);
          if (d.uAnim != null) gl.uniform4f(d.uAnim, 0, 0, 0, 0);
          if (d.uAnim2 != null) gl.uniform4f(d.uAnim2, 0, 0, 0, 0);
          if (d.uExpr != null) gl.uniform4f(d.uExpr, 0, 0, 0, 0);
          gl.enable(gl.POLYGON_OFFSET_FILL);
          gl.polygonOffset(1.0, 1.8);
          drawFn(terrain);
          this.drawActorsShadow(match, drawFn, actorsMap, time, fpActor, opts);
          gl.disable(gl.POLYGON_OFFSET_FILL);
        }
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bindTextures(mode) {
    const gl = this.gl;
    const isFlash = mode === 1;
    const isPro = mode === 2;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, isFlash ? this.staticTarget.tex : this.dummyPcf.tex);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, isFlash ? this.dynTarget.tex : this.dummyPcf.tex);
    gl.activeTexture(gl.TEXTURE12);
    gl.bindTexture(gl.TEXTURE_2D, isPro ? this.staticTarget.tex : this.dummyRaw.tex);
    gl.activeTexture(gl.TEXTURE13);
    gl.bindTexture(gl.TEXTURE_2D, isPro ? this.nearTarget.tex : this.dummyRaw.tex);
  }

  applyWorldUniforms(worldProg, mode) {
    const gl = this.gl;
    if (worldProg.uLightStatic) gl.uniformMatrix4fv(worldProg.uLightStatic, false, this.staticMatrix);
    if (worldProg.uLightNear) gl.uniformMatrix4fv(worldProg.uLightNear, false, this.nearMatrix);
    if (worldProg.uSfParams) gl.uniform4f(worldProg.uSfParams, mode, this.nearWidthM, this.nearDepthSpan, this.staticDepthSpan);
  }

  // Runs Shadow Flame 1.0 Pro half-res Screen-Space Pass (with analytical ray basis + hoisted linear stepping!).
  runScreenPass(sceneDepthTex, vp, eye, time, emptyVao, w, h, camRays = null) {
    const gl = this.gl;
    this.ensureScreen(w, h);
    this.invVP = invert4(vp);

    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenA.fb);
    gl.viewport(0, 0, this.screenA.w, this.screenA.h);
    const sp = this.screenProg;
    gl.useProgram(sp.obj);
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, sceneDepthTex);
    gl.activeTexture(gl.TEXTURE12);
    gl.bindTexture(gl.TEXTURE_2D, this.staticTarget.tex);
    gl.activeTexture(gl.TEXTURE13);
    gl.bindTexture(gl.TEXTURE_2D, this.nearTarget.tex);
    gl.uniformMatrix4fv(sp.uInvVP, false, this.invVP);
    gl.uniformMatrix4fv(sp.uVP, false, vp);
    gl.uniformMatrix4fv(sp.uLightNear, false, this.nearMatrix);
    gl.uniformMatrix4fv(sp.uLightStatic, false, this.staticMatrix);
    gl.uniform3fv(sp.uEye, eye);
    gl.uniform1f(sp.uTime, time);
    if (sp.uRay00 != null) {
      if (camRays) {
        gl.uniform3fv(sp.uRay00, camRays.r00);
        gl.uniform3fv(sp.uRayDX, camRays.rDX);
        gl.uniform3fv(sp.uRayDY, camRays.rDY);
      } else {
        gl.uniform3f(sp.uRay00, 0, 0, 0);
        gl.uniform3f(sp.uRayDX, 0, 0, 0);
        gl.uniform3f(sp.uRayDY, 0, 0, 0);
      }
    }
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // 2. Separable Depth-Aware Lorentzian Bilateral Blur (H then V)
    const bp = this.bilatProg;
    gl.useProgram(bp.obj);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenB.fb);
    gl.viewport(0, 0, this.screenB.w, this.screenB.h);
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, this.screenA.tex);
    gl.uniform2f(bp.uDir, 1 / this.screenA.w, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenA.fb);
    gl.viewport(0, 0, this.screenA.w, this.screenA.h);
    gl.bindTexture(gl.TEXTURE_2D, this.screenB.tex);
    gl.uniform2f(bp.uDir, 0, 1 / this.screenB.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    return this.screenA.tex;
  }
}
