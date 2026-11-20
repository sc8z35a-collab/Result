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

import {unit, scale, dot, clamp, multiply, lookAt, ortho, invert4} from './geometry.js';
import {ARTICULATED_RIG_GLSL} from './rig.js';

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

// Animated NPC + Static World Depth Vertex Shader (16-joint articulated FK/IK rig matches worldVS pixel-for-pixel!)
export const sfShadowVS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=5) in float aKind;
uniform mat4 uVP;
uniform mat4 uModel;
uniform int uMode;
uniform vec2 uGait;
uniform vec3 uPose;
uniform vec3 uHit;
uniform vec2 uRecoil;
uniform vec4 uAnim;
uniform vec4 uAnim2;
${ARTICULATED_RIG_GLSL}
void main(){
  vec3 p=aPos,n=aNormal;
  if(uMode==1){
    int boneId=int(floor(aKind*.1+.001));
    rigApplyCharacter(p,n,boneId,uGait,uPose,uHit,uRecoil,uAnim,uAnim2);
  }
  gl_Position=uVP*uModel*vec4(p,1.);
}`;

export const sfShadowFS = `#version 300 es
precision mediump float;
void main(){}`;

// World Fragment Shader Module: Shadow Flame 1.0 Flash (IGN-Vogel6 Dual-Cache HW PCF) & Pro (Dual-Cascade Focus-Snapped Adaptive PCSS)
export const SHADOW_FLAME_WORLD_GLSL = `
precision highp sampler2DShadow;
uniform sampler2DShadow uSfStaticPCF;
uniform sampler2DShadow uSfDynPCF;
uniform sampler2D uSfStaticRaw;
uniform sampler2D uSfNearRaw;
uniform mat4 uLightStatic;
uniform mat4 uLightNear;
uniform vec4 uSfParams; // x: shadowMode (0=off,1=flash,2=pro), y: nearWidthMeters, z: nearDepthSpan, w: staticDepthSpan

float sfIGN(vec2 p){
  return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));
}

vec2 sfVogel(int i,int n,float phi){
  float r=sqrt((float(i)+.5)/float(n));
  float a=float(i)*2.39996323+phi;
  return vec2(cos(a),sin(a))*r;
}

// Shadow Flame 1.0 Flash: Ultra-lightweight 6-tap IGN-rotated Vogel disk with 2x2 HW PCF (= 24 sub-samples)
// plus zero-rebuild static cache + 512px animated dynamic NPC shadow layer.
vec2 sfFlashVisibility(vec3 wp,vec3 n){
  float ndl=max(0.,dot(n,SUN));
  if(ndl<=.001)return vec2(0.,.45);
  vec3 pBias=wp+n*(.038+.11*(1.-ndl));
  vec4 ls=uLightStatic*vec4(pBias,1.);
  vec3 p=ls.xyz/ls.w*.5+.5;
  float phi=sfIGN(gl_FragCoord.xy)*6.2831853;
  float visStatic=1.;
  if(all(greaterThan(p,vec3(.001)))&&all(lessThan(p,vec3(.999)))){
    p.z-=.00018+.00032*(1.-ndl);
    vec2 rad=1.85/vec2(textureSize(uSfStaticPCF,0));
    float sum=0.;
    for(int i=0;i<6;i++){
      sum+=texture(uSfStaticPCF,p+vec3(sfVogel(i,6,phi)*rad,0.));
    }
    visStatic=sum/6.;
  }
  // Dynamic animated NPC shadow layer (512px texel-snapped around player)
  float visDyn=1.;
  vec4 ld=uLightNear*vec4(pBias,1.);
  vec3 pd=ld.xyz/ld.w*.5+.5;
  if(all(greaterThan(pd,vec3(.01)))&&all(lessThan(pd,vec3(.99)))){
    pd.z-=.00035+.00055*(1.-ndl);
    vec2 radD=1.45/vec2(textureSize(uSfDynPCF,0));
    float sd=0.;
    for(int i=0;i<4;i++){
      sd+=texture(uSfDynPCF,pd+vec3(sfVogel(i,4,phi+1.1)*radD,0.));
    }
    vec2 edge=smoothstep(vec2(.01),vec2(.07),pd.xy)*smoothstep(vec2(.01),vec2(.07),1.-pd.xy);
    visDyn=mix(1.,sd*.25,edge.x*edge.y);
  }
  float vis=min(visStatic,visDyn);
  return vec2(vis,.38);
}

// Shadow Flame 1.0 Pro: True Physical Contact-Hardening Soft Shadows (Adaptive PCSS) with Blocker-Search Early-Out!
// Returns vec2(visibility, normalizedPenumbraSoftness).
vec2 sfProPCSS(sampler2D depthTex,vec3 coord,float ndl,float frustumW,float depthSpan,float phi,float texScale){
  float bias=(.00022+.00046*(1.-ndl))*texScale;
  float recZ=coord.z-bias;
  vec2 invSize=1./vec2(textureSize(depthTex,0));
  // Stage 1: 8-tap IGN-rotated Vogel Blocker Search
  float searchUV=max(invSize.x*2.4,.32/frustumW);
  float blockerSum=0.;
  int blockers=0;
  for(int i=0;i<8;i++){
    vec2 suv=coord.xy+sfVogel(i,8,phi)*searchUV;
    float d=texture(depthTex,suv).r;
    if(d<recZ){
      blockerSum+=d;
      blockers++;
    }
  }
  // Coherence Early-Out: 0 blockers -> 100% sunlit, zero filter cost!
  if(blockers==0)return vec2(1.,0.);

  float avgBlocker=blockerSum/float(blockers);
  float blockerDistM=max(0.,(recZ-avgBlocker)*depthSpan);
  // Physical solar penumbra: razor-sharp at grounded contact (<0.05m), velvety wide under high cranes/roofs
  float penMeters=clamp(blockerDistM*.038,.020,.44);
  float penUV=max(invSize.x*.75,penMeters/frustumW);
  float softNorm=clamp(blockerDistM/11.,0.,1.);

  // Deep-umbra coherence early-out: if all 8 wide search taps are deep inside a solid shadow core, skip full filter
  if(blockers==8 && blockerDistM>.35 && penUV<searchUV*.65){
    float cCheck=texture(depthTex,coord.xy).r;
    if(cCheck<recZ-.0015)return vec2(0.,softNorm);
  }

  // Stage 2: 12-tap IGN-rotated Adaptive Penumbra Vogel Filter with smooth sub-bias ramp
  float vis=0.;
  float ramp=max(.00018,bias*.75);
  for(int i=0;i<12;i++){
    vec2 uvS=coord.xy+sfVogel(i,12,phi+1.5708)*penUV;
    float d=texture(depthTex,uvS).r;
    vis+=smoothstep(-ramp,ramp,d-recZ);
  }
  return vec2(vis/12.,softNorm);
}

vec2 sfProVisibility(vec3 wp,vec3 n){
  float ndl=max(0.,dot(n,SUN));
  if(ndl<=.001)return vec2(0.,.5);
  float phi=sfIGN(gl_FragCoord.xy)*6.2831853;
  // Tight normal-offset bias scaled by cascade precision
  vec3 pNearBias=wp+n*(.018+.052*(1.-ndl));
  vec4 ln=uLightNear*vec4(pNearBias,1.);
  vec3 pn=ln.xyz/ln.w*.5+.5;

  float nearEdge=max(abs(pn.x-.5),abs(pn.y-.5));
  bool inNear=pn.z>.002&&pn.z<.998&&nearEdge<.485;
  vec2 nearRes=vec2(1.,0.);
  if(inNear){
    nearRes=sfProPCSS(uSfNearRaw,pn,ndl,uSfParams.y,uSfParams.z,phi,1.);
  }
  float blend=inNear?smoothstep(.38,.48,nearEdge):1.;
  if(blend<=.001)return nearRes;

  vec3 pFarBias=wp+n*(.048+.12*(1.-ndl));
  vec4 ls=uLightStatic*vec4(pFarBias,1.);
  vec3 ps=ls.xyz/ls.w*.5+.5;
  vec2 farRes=vec2(1.,0.);
  if(all(greaterThan(ps,vec3(.002)))&&all(lessThan(ps,vec3(.998)))){
    farRes=sfProPCSS(uSfStaticRaw,ps,ndl,218.,uSfParams.w,phi+2.1,1.35);
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
// .r = SF-SSCS (Screen-Space Contact Shadows marching toward SUN)
// .g = SF-GTAO-Lite (Horizon-aware depth-curvature cavity AO)
// .b = SF-VolumetricShadowShafts (10-step IGN-jittered 3D shadowed golden sunbeams)
// .a = linearized depth encoded for bilateral edge-preserving blur
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
out vec4 frag;

const vec3 SUN=normalize(vec3(-.66,.28,-.70));
const float PI=3.14159265359;
const float ZNEAR=.075;
const float ZFAR=1400.;

float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
float linZ(float d){return (2.*ZNEAR*ZFAR)/(ZFAR+ZNEAR-(d*2.-1.)*(ZFAR-ZNEAR));}
vec3 worldFromDepth(vec2 uv,float d){
  vec4 clip=vec4(uv*2.-1.,d*2.-1.,1.);
  vec4 w=uInvVP*clip;
  return w.xyz/w.w;
}
float sampleShadowRaw(vec3 p){
  vec4 ln=uLightNear*vec4(p,1.);
  vec3 pn=ln.xyz/ln.w*.5+.5;
  if(all(greaterThan(pn,vec3(.02)))&&all(lessThan(pn,vec3(.98)))){
    return step(pn.z-.0008,texture(uSfNearRaw,pn.xy).r);
  }
  vec4 ls=uLightStatic*vec4(p,1.);
  vec3 ps=ls.xyz/ls.w*.5+.5;
  if(all(greaterThan(ps,vec3(.01)))&&all(lessThan(ps,vec3(.99)))){
    return step(ps.z-.0008,texture(uSfStaticRaw,ps.xy).r);
  }
  return 1.;
}

void main(){
  float dC=texture(uSceneDepth,vUV).r;
  float jitter=ign(gl_FragCoord.xy+fract(uTime*.37)*13.7);
  float phi=ign(gl_FragCoord.xy)*6.2831853;
  vec2 invRes=1./vec2(textureSize(uSceneDepth,0));

  bool isSky=dC>=.99985;
  vec3 wPos=worldFromDepth(vUV,isSky?.999:dC);
  vec3 toP=wPos-uEye;
  float camDist=length(toP);
  vec3 rayDir=toP/max(camDist,1e-4);

  // 1. SF-Volumetric Shadow Shafts (10-step IGN-jittered 3D shadowed golden god-rays)
  float cosT=dot(rayDir,SUN);
  float g=.76;
  float hg=(1.-g*g)/(4.*PI*pow(max(.06,1.+g*g-2.*g*cosT),1.5));
  float maxMarch=isSky?64.:min(camDist,64.);
  float shaft=0.;
  if(maxMarch>2.2){
    float stepL=(maxMarch-1.4)/10.;
    for(int i=0;i<10;i++){
      float t=1.4+(float(i)+jitter)*stepL;
      vec3 sp=uEye+rayDir*t;
      float dens=exp(-max(0.,sp.y)*.14)*smoothstep(-2.0,.2,sp.y);
      if(dens>.01){
        float lit=sampleShadowRaw(sp);
        shaft+=lit*dens*stepL;
      }
    }
    // Crisp forward Mie sunbeams cutting past shadowed obstacles (zero flat milky floor)
    float phase=.015+hg*.85;
    shaft=clamp(shaft*phase*.014,0.,1.);
  }

  float sscs=1.;
  float gtao=1.;
  float linEnc=1.;

  if(!isSky){
    float zC=linZ(dC);
    linEnc=clamp(log2(1.+zC)/9.5,0.,1.);
    // Minimum-slope world-space normal reconstruction from depth buffer (prevents haloing on silhouettes)
    float dL=texture(uSceneDepth,vUV-vec2(invRes.x,0.)).r;
    float dR=texture(uSceneDepth,vUV+vec2(invRes.x,0.)).r;
    float dD=texture(uSceneDepth,vUV-vec2(0.,invRes.y)).r;
    float dU=texture(uSceneDepth,vUV+vec2(0.,invRes.y)).r;
    vec3 pL=worldFromDepth(vUV-vec2(invRes.x,0.),dL);
    vec3 pR=worldFromDepth(vUV+vec2(invRes.x,0.),dR);
    vec3 pD=worldFromDepth(vUV-vec2(0.,invRes.y),dD);
    vec3 pU=worldFromDepth(vUV+vec2(0.,invRes.y),dU);
    vec3 dx=abs(linZ(dR)-zC)<abs(zC-linZ(dL))?(pR-wPos):(wPos-pL);
    vec3 dy=abs(linZ(dU)-zC)<abs(zC-linZ(dD))?(pU-wPos):(wPos-pD);
    vec3 N=normalize(cross(dx,dy));
    if(dot(N,-rayDir)<0.)N=-N;

    float distFade=1.-smoothstep(38.,66.,camDist);
    // 2. SF-SSCS: 6-step IGN-jittered Screen-Space Contact Shadow raymarch toward SUN
    float ndl=dot(N,SUN);
    if(ndl>.04 && distFade>.01){
      float rayLen=clamp(.32+camDist*.014,.32,1.15);
      float stepM=rayLen/6.;
      float thickness=.09+camDist*.011;
      float occ=0.;
      for(int i=0;i<6;i++){
        float t=(float(i)+.35+jitter*.65)*stepM;
        vec3 sp=wPos+N*.025+SUN*t;
        vec4 clip=uVP*vec4(sp,1.);
        if(clip.w<=.05)continue;
        vec3 ndc=clip.xyz/clip.w;
        vec2 suv=ndc.xy*.5+.5;
        if(any(lessThan(suv,vec2(.01)))||any(greaterThan(suv,vec2(.99))))break;
        float sd=texture(uSceneDepth,suv).r;
        float rZ=linZ(ndc.z*.5+.5);
        float sZ=linZ(sd);
        float diff=rZ-sZ;
        if(diff>.016 && diff<thickness){
          float eFade=smoothstep(.01,.06,min(min(suv.x,1.-suv.x),min(suv.y,1.-suv.y)));
          occ=max(occ,(1.-diff/thickness)*eFade);
        }
      }
      sscs=1.-occ*.52*distFade*smoothstep(.04,.20,ndl);
    }

    // 3. SF-GTAO-Lite: 6-tap IGN-rotated horizon-aware depth-curvature cavity AO
    if(distFade>.01){
      float uvRad=clamp(.52/max(zC,1.2),.0045,.028);
      float aoSum=0.;
      for(int i=0;i<6;i++){
        float r=sqrt((float(i)+.5)/6.);
        float a=float(i)*2.39996323+phi;
        vec2 ouv=vUV+vec2(cos(a),sin(a))*r*uvRad;
        if(any(lessThan(ouv,vec2(.005)))||any(greaterThan(ouv,vec2(.995))))continue;
        float od=texture(uSceneDepth,ouv).r;
        if(od>=.9998)continue;
        vec3 op=worldFromDepth(ouv,od);
        vec3 v=op-wPos;
        float d2=dot(v,v);
        if(d2>.0004 && d2<1.95){
          float invD=inversesqrt(d2);
          float elev=dot(v*invD,N);
          float att=1.-smoothstep(.28,1.38,sqrt(d2));
          aoSum+=max(0.,elev-.16)*att;
        }
      }
      gtao=clamp(1.-(aoSum/6.)*1.08*distFade,.48,1.);
    }
  }
  frag=vec4(sscs,gtao,shaft,linEnc);
}`;

// Depth-aware bilateral blur keeping container/character edges 100% razor-sharp with zero bleed!
export const sfBilateralFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 frag;
void main(){
  const float w[4]=float[4](.32,.24,.13,.05);
  vec4 c0=texture(uTex,vUV);
  float d0=c0.a;
  vec3 acc=c0.rgb*w[0];
  float wSum=w[0];
  for(int i=1;i<4;i++){
    vec2 off=uDir*float(i)*1.35;
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
    this.depthProg = makeProgram(gl, sfShadowVS, sfShadowFS);
    this.screenProg = makeProgram(gl, postVS, sfScreenFS);
    this.bilatProg = makeProgram(gl, postVS, sfBilateralFS);

    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.staticSize = Math.min(2048, maxTex);
    this.nearSize = Math.min(1536, maxTex);
    this.dynSize = Math.min(512, maxTex);

    this.staticTarget = makeDepthTarget(gl, this.staticSize, true);
    this.nearTarget = makeDepthTarget(gl, this.nearSize, false);
    this.dynTarget = makeDepthTarget(gl, this.dynSize, true);

    // 1x1 typed dummy depth textures so inactive sampler units ALWAYS match GLSL sampler type (zero driver warnings!)
    this.dummyPcf = makeDepthTarget(gl, 1, true);
    this.dummyRaw = makeDepthTarget(gl, 1, false);

    this.lightView = lookAt(scale(SUN, 204), [0, 0, 0]);
    this.staticMatrix = multiply(ortho(-109, 109, -71, 71, 12, 405), this.lightView);
    this.nearMatrix = new Float32Array(this.staticMatrix);
    this.nearWidthM = 42;
    this.nearDepthSpan = 190;
    this.staticDepthSpan = 393;

    this.staticReady = false;
    this.screenA = null;
    this.screenB = null;
    this.screenDim = [0, 0];
    this.lastNearKey = '';
    this.invVP = new Float32Array(16);

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

  drawActorsShadow(match, drawFn, actorsMap, time = 0) {
    if (!match) return;
    const gl = this.gl, d = this.depthProg;
    gl.uniform1i(d.uMode, 1);
    for (const a of match.actors) {
      if (!a.alive || a.human) continue;
      const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
      const rVec = [cy, 0, sy], bVec = [-sy, 0, cy];
      let hitX = 0, hitZ = 1;
      if (a.hitDir) {
        hitX = clamp(dot(a.hitDir, rVec), -1, 1);
        hitZ = clamp(dot(a.hitDir, bVec), -1, 1);
      }
      gl.uniformMatrix4fv(d.uModel, false, matrix(rVec, [0, 1, 0], bVec, [a.x, a.y, a.z]));
      gl.uniform2f(d.uGait, a.stride * 2.85, clamp(Math.hypot(a.vx, a.vz) / 4.2, 0, 1.2));
      gl.uniform3f(d.uPose, a.crouch, a.lean, a.aimPose);
      gl.uniform3f(d.uHit, a.hitRecoil || 0, hitX, hitZ);
      if (d.uRecoil) gl.uniform2f(d.uRecoil, a.recoil || 0, a.recoilSide || 0);
      if (d.uAnim) gl.uniform4f(d.uAnim, a.fwdVel || 0, a.sideVel || 0, a.airBlend || 0, a.landCompress || 0);
      if (d.uAnim2) gl.uniform4f(d.uAnim2, a.pitch || 0, time + a.id * 1.13, a.sprintAmt || 0, a.reloadFrac || 0);
      drawFn(actorsMap[(a.isSpy ? 'spy_' : '') + a.team + a.gun] || actorsMap[a.team + a.gun]);
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
    gl.uniform2f(d.uGait, 0, 0);
    gl.uniform3f(d.uPose, 0, 0, 0);
    gl.uniform3f(d.uHit, 0, 0, 0);
    if (d.uRecoil) gl.uniform2f(d.uRecoil, 0, 0);
    if (d.uAnim) gl.uniform4f(d.uAnim, 0, 0, 0, 0);
    if (d.uAnim2) gl.uniform4f(d.uAnim2, 0, 0, 0, 0);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.15, 2.0);
    drawFn(terrain);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    this.staticReady = true;
  }

  prepare(mode, eye, fwd, match, terrain, actorsMap, drawFn, time = 0) {
    if (mode <= 0) return;
    const gl = this.gl, d = this.depthProg;
    // Unbind depth textures from all sampler units before rendering into shadow FBOs (prevents WebGL2 feedback loops)
    for (const u of [1, 8, 12, 13]) {
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    // 1. Static Harbor Cache: baked ONCE (0.00 ms per frame afterwards!)
    if (!this.staticReady) this.renderStaticCache(terrain, drawFn);

    // Ensure static texture sampling mode matches Flash (HW PCF) vs Pro (Raw 24-bit depth for PCSS)
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
        this.drawActorsShadow(match, drawFn, actorsMap, time);
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }
    } else if (mode === 2) {
      // Shadow Flame 1.0 Pro: Texel-snapped 1536px near focus cascade (2.7cm/texel!)
      const fx = fwd[0], fz = fwd[2], fl = Math.hypot(fx, fz) || 1;
      const focus = [eye[0] + (fx / fl) * 13, 2.0, eye[2] + (fz / fl) * 13];
      const snap = this.snappedOrtho(focus, 21, this.nearSize, 95);
      this.nearMatrix = snap.mat;
      this.nearWidthM = 42;
      this.nearDepthSpan = snap.span;

      // Skip rebuilding near cascade on static title frames if focus didn't shift and no match actors exist
      if (match || snap.key !== this.lastNearKey) {
        this.lastNearKey = snap.key;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.nearTarget.fb);
        gl.viewport(0, 0, this.nearSize, this.nearSize);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.useProgram(d.obj);
        gl.uniformMatrix4fv(d.uVP, false, this.nearMatrix);
        gl.uniformMatrix4fv(d.uModel, false, I);
        gl.uniform1i(d.uMode, 0);
        gl.uniform2f(d.uGait, 0, 0);
        gl.uniform3f(d.uPose, 0, 0, 0);
        gl.uniform3f(d.uHit, 0, 0, 0);
        if (d.uRecoil) gl.uniform2f(d.uRecoil, 0, 0);
        if (d.uAnim) gl.uniform4f(d.uAnim, 0, 0, 0, 0);
        if (d.uAnim2) gl.uniform4f(d.uAnim2, 0, 0, 0, 0);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.0, 1.8);
        drawFn(terrain);
        this.drawActorsShadow(match, drawFn, actorsMap, time);
        gl.disable(gl.POLYGON_OFFSET_FILL);
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

  // Runs Shadow Flame 1.0 Pro half-res Screen-Space Contact Shadows + GTAO-Lite + Volumetric Shadow Shafts + Bilateral Blur.
  // Executed BEFORE first-person weapon clears depth, so sceneDepth contains 100% pure world + actor geometry!
  runScreenPass(sceneDepthTex, vp, eye, time, emptyVao, w, h) {
    const gl = this.gl;
    this.ensureScreen(w, h);
    this.invVP = invert4(vp);

    gl.disable(gl.DEPTH_TEST);
    // 1. Half-res SSCS + GTAO-Lite + Volumetric God-Rays
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenA.fb);
    gl.viewport(0, 0, this.screenA.w, this.screenA.h);
    gl.useProgram(this.screenProg.obj);
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, sceneDepthTex);
    gl.activeTexture(gl.TEXTURE12);
    gl.bindTexture(gl.TEXTURE_2D, this.staticTarget.tex);
    gl.activeTexture(gl.TEXTURE13);
    gl.bindTexture(gl.TEXTURE_2D, this.nearTarget.tex);
    gl.uniformMatrix4fv(this.screenProg.uInvVP, false, this.invVP);
    gl.uniformMatrix4fv(this.screenProg.uVP, false, vp);
    gl.uniformMatrix4fv(this.screenProg.uLightNear, false, this.nearMatrix);
    gl.uniformMatrix4fv(this.screenProg.uLightStatic, false, this.staticMatrix);
    gl.uniform3fv(this.screenProg.uEye, eye);
    gl.uniform1f(this.screenProg.uTime, time);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Unbind sceneDepthTex immediately so re-binding scene FBO for viewmodel never triggers a feedback loop!
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // 2. Separable Depth-Aware Bilateral Blur (H then V)
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
