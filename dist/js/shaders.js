import {SHADOW_FLAME_WORLD_GLSL} from './shadowflame.js';
import {KHDR_TONE_GLSL} from './khdr.js';
import {RIG_PALETTE_GLSL} from './rig.js';
import {FLUXGI_WORLD_GLSL} from './fluxgi.js';
import {RESONANCE_VS_GLSL, RESONANCE_FS_GLSL} from './resonance.js';

export const shared = `
precision highp float;
precision highp int;
precision highp sampler2DArray;
const vec3 SUN=normalize(vec3(-.66,.28,-.70));
const vec2 SUN_XZ=normalize(vec2(-.66,-.70));
const float PI=3.14159265359;
const float INV_2PI=0.15915494309;
const float INV_HALF_PI=0.63661977237;
uniform int uOutput;
uniform int uKHDR;
uniform vec3 uEye;
uniform sampler2D uSky;
uniform vec4 uWeather;
${KHDR_TONE_GLSL}
vec3 sky(vec3 d){
  float a=atan(d.x,-d.z);
  float y=clamp(d.y,0.,1.);
  // Exact minimax asin(y)/(PI/2) (<0.0005 rad error, eliminates slow transcendental asin!)
  float ay=1.-sqrt(max(0.,1.-y))*(1.-y*.1355+y*y*.0255);
  vec3 raw=texture(uSky,vec2(a*INV_2PI+.5,ay)).rgb;
  vec3 col=raw*raw*(.80+.20*raw);
  float mu=max(0.,dot(d,SUN));
  vec3 sunAdd=vec3(0.);
  float sunVis=clamp(1.-uWeather.y*1.15,0.,1.);
  if(mu>.70 && sunVis>.01){
    float m2=mu*mu,m4=m2*m2,m8=m4*m4;
    float halo=.095*(m8*m8*m8);
    if(mu>.96){
      float disc=smoothstep(.99988,.999973,mu);
      float sunGain=uKHDR==1?13.5:10.;
      float m16=m8*m8,m32=m16*m16,m64=m32*m32,m128=m64*m64,m256=m128*m128;
      halo+=disc*sunGain+.64*(m256*m128*m32*m4);
    }
    sunAdd=vec3(1.,.77,.42)*halo*sunVis;
  }
  vec3 outCol=col*.99+sunAdd;
  if(uWeather.y>.001 || uWeather.z>.001){
    vec3 overcast=mix(vec3(.24,.29,.34),vec3(.24,.07,.06),uWeather.z);
    outCol=mix(outCol*(1.-uWeather.y*.65),overcast,clamp(uWeather.y*.78+uWeather.z*.45,0.,.92));
    outCol+=vec3(.78,.86,1.)*uWeather.w*.55;
  }
  return outCol;
}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
vec3 displayColor(vec3 c){
  c=max(c,vec3(0.));
  if(uOutput==5)return c;
  if(uOutput==4)return kEncodeLogK(c);
  if(uOutput==3)return c/(1.+c);
  if(uOutput==2){
    if(uKHDR==1)return kFilmicExtended(c);
    vec3 extended=aces(c*.83)+max(c-vec3(1.),0.)*.46;
    return clamp(log2(1.+extended)/3.,0.,1.);
  }
  if(uOutput==1){
    if(uKHDR==1)return kFilmicSDR(c);
    return kFastGamma(aces(c*.87));
  }
  return kFastGamma(c*.95);
}
float fog(float d){
  float wScale=max(1.,uWeather.x);
  float x=max(0.,d*.00265*wScale);
  float s2=sqrt(sqrt(x));
  return 1.-exp(-x*s2*sqrt(s2));
}
`;

export const worldVS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in float aLayer;
layout(location=4) in vec3 aColor;
layout(location=5) in float aKind;
uniform mat4 uVP,uModel;
uniform int uMode;
uniform vec2 uRecoil;
uniform vec4 uAnim;
uniform vec4 uAnim2;
out vec3 wPos,wNormal,wColor,lPos;
out vec2 uv;
flat out float layer;
flat out float kind;
${RIG_PALETTE_GLSL}
${RESONANCE_VS_GLSL}
void main(){
  vec3 p=aPos,n=aNormal;
  lPos=p;
  float cleanKind=aKind;
  if(uMode==1){
    int boneId=int(floor(aKind*.1+.001));
    cleanKind=mod(aKind,10.);
    rigApplyPalette(p,n,boneId);
  } else if(uMode==2){
    // First-person weapon blowback + RD40 kinetic lock-on / twin-barrel hydraulic servo / D01 SENSOR pod motion
    float rdLock=uAnim.x;
    float rdD01=uAnim.y;
    float rdLockPulse=uAnim.z;
    float rdPhase=uAnim.w;
    if(uRecoil.x>.001){
      float slide=smoothstep(.038,.075,p.y)*(1.-smoothstep(-.16,.12,p.z))*smoothstep(-.78,-.35,p.z);
      p.z+=uRecoil.x*.036*slide;
      float tip=(1.-smoothstep(-.80,-.35,p.z));
      p.x+=uRecoil.y*uRecoil.x*.003*tip;
      p.y+=uRecoil.x*.004*tip;
      // Alternating hydraulic servo recoil restricted cleanly to multi-barrel weapons (RD30/RD40/DF40 II)
      float barrelZone=uAnim2.x*(1.-smoothstep(-.36,-.26,p.z))*(1.-smoothstep(.058,.068,abs(p.x)))*smoothstep(.016,.026,abs(p.x));
      float sideBias=p.x<0.?(1.0-rdPhase*.36):(0.64+rdPhase*.36);
      p.z+=uRecoil.x*.042*barrelZone*sideBias;
    }
    if(rdLock>.001 || rdD01>.001 || rdLockPulse>.001){
      float pod=smoothstep(.092,.116,p.y)*smoothstep(-.26,-.02,p.z);
      float deploy=rdLock*.011+rdD01*.011+rdLockPulse*.015;
      p.y+=deploy*pod;
      p.z-=deploy*.92*pod;
      if(rdD01>.01){
        p.x+=sin(uAnim2.y*12.0)*0.0055*rdD01*pod;
      }
      float rail=smoothstep(.042,.054,abs(p.x))*smoothstep(-.72,-.04,p.z);
      p.x+=sign(p.x)*rdLockPulse*.0065*rail;
    }
  }
  vec4 world=uModel*vec4(p,1.);
  wPos=world.xyz;
  wNormal=mat3(uModel)*n;
  resonanceDisplace(wPos,wNormal,cleanKind,uMode);
  wColor=aColor;
  uv=aUV;
  layer=aLayer;
  kind=cleanKind;
  gl_Position=uVP*vec4(wPos,1.);
}`;

function buildWorldFS(allowDiscard) {
  return `#version 300 es
${shared}
${SHADOW_FLAME_WORLD_GLSL}
${FLUXGI_WORLD_GLSL}
${RESONANCE_FS_GLSL}
in vec3 wPos,wNormal,wColor,lPos;
in vec2 uv;
flat in float layer;
flat in float kind;
uniform sampler2DArray uMats;
uniform int uMode;
uniform int uQuality;
uniform int uActiveActors;
uniform int uLightCount;
uniform vec4 uActors[6]; // xyz=pos, w=0 if dead else 1.0 + crouch
uniform vec2 uHitFX;
uniform float uGunHeat;
uniform float uTime;
uniform vec4 uLights[6];
uniform vec3 uLightCol[6];
out vec4 frag;

// Hash-without-sine (eliminates 4x sin() per noise call with higher visual isotropy!)
float hash(vec2 p){
  vec3 p3=fract(vec3(p.xyx)*.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}

vec3 applyWorldFog(vec3 c,vec3 V,float d){
  vec3 wCol=mix(vec3(.58,.68,.70),vec3(.28,.33,.37),clamp(uWeather.y,0.,1.));
  wCol=mix(wCol,vec3(.30,.10,.09),clamp(uWeather.z,0.,1.));
  wCol+=vec3(.55,.65,.78)*uWeather.w*.35;
  if(uQuality<0){
    float lf=clamp((d-18./max(1.,uWeather.x))/(360./max(1.,uWeather.x)),0.,.94);
    return mix(c,wCol,lf);
  }
  float sdot=max(dot(-V,SUN),0.);
  float s2=sdot*sdot;
  float sunScatter=(uQuality>=2||uKHDR==1)?(s2*sdot):(s2*s2);
  float sunVis=clamp(1.-uWeather.y*1.2,0.,1.);
  vec3 fcol=mix(wCol,vec3(.95,.77,.52),sunScatter*sunVis);
  float fg=fog(d);
  c=mix(c,fcol,fg);
  if((uQuality>=2 || uKHDR==1) && sunVis>.05)c+=vec3(1.,.78,.46)*sunScatter*fg*sunVis*(uKHDR==1?.28:.24);
  return c;
}

void main(){
  vec4 texel=texture(uMats,vec3(uv,layer));
  ${allowDiscard ? 'if(texel.a<.43)discard;' : ''}
  vec3 toEye=uEye-wPos;
  float d2Eye=dot(toEye,toEye);
  float invD=inversesqrt(max(d2Eye,1e-8));
  float d=d2Eye*invD;
  vec3 V=toEye*invD;
  // Low-error sRGB^2.14 polynomial (<0.004 max error vs pow(x,2.14), eliminates 3x exp2/log2 per pixel!)
  vec3 raw=max(vec3(.014),texel.rgb*wColor);
  vec3 base=raw*raw*(.86+.14*raw);
  float detail=dot(texel.rgb,vec3(.27,.52,.21));

  // Early-Exit 1: Emissive surfaces (tracers, shields, glow strips, muzzle flash) skip 100% of shadows/GI/lights/puddles!
  if(kind>2.5&&kind<3.5){
    float boost=(uQuality>=2?3.15:uQuality==1?2.45:uQuality==0?2.05:1.75)*(uKHDR==1?1.26:1.);
    vec3 ce=base*(boost+.38*detail);
    if(uMode==2 && (uHitFX.x>.01 || uHitFX.y>.01)){
      float wave=.5+.5*sin(uTime*16.-lPos.z*26.);
      ce*=1.+uHitFX.x*(.38+.30*wave);
      if(uHitFX.y>.01){
        float scan=smoothstep(.62,.98,.5+.5*sin(uTime*11.+lPos.z*18.));
        ce=mix(ce,vec3(.38,2.15,1.85)*(1.+.35*scan),uHitFX.y*(.42+.32*scan));
      }
    }
    if(uMode!=2)ce=applyWorldFog(ce,V,d);
    frag=vec4(displayColor(ce),uMode==2?0.:uMode==1?.8:1.);
    return;
  }

  vec3 N=normalize(wNormal);

  // Early-Exit 2: Distant horizon mountains (600-1400m away, outside shadow cascades, GI, and dynamic lights!)
  if(kind>4.5){
    float nlH=max(dot(N,SUN),0.);
    vec3 ambH=mix(vec3(.24,.27,.26),vec3(.65,.79,.88),N.y*.5+.5);
    vec3 sunColH=uKHDR==1?vec3(2.05,1.56,.96):vec3(1.66,1.32,.88);
    vec3 ch=mix(base*(ambH+nlH*sunColH),base*1.2,.6);
    if(uMode!=2)ch=applyWorldFog(ch,V,d);
    frag=vec4(displayColor(ch),1.);
    return;
  }

  float metal=float(kind>.5&&kind<1.5);
  float ground=float(kind>1.5&&kind<2.5);
  int sfMode=int(uSfParams.x+.5);

  // High & Extra: procedural micro-bump normal perturbation on world terrain surfaces (screen-LOD gated)
  if(uQuality>=1 && uMode==0 && kind<2.5 && d>1.2 && d<62.){
    vec3 dp1=dFdx(wPos),dp2=dFdy(wPos);
    float dh1=dFdx(detail),dh2=dFdy(detail);
    vec3 c2=cross(dp2,N);
    float det=abs(dot(dp1,c2));
    if(det>1e-5){
      vec3 surfGrad=c2*dh1+cross(N,dp1)*dh2;
      float bumpScale=(uQuality>=2?.14:.08)*smoothstep(1.2,3.5,d)*(1.-smoothstep(32.,62.,d));
      N=normalize(N-clamp(surfGrad/det,vec3(-.85),vec3(.85))*bumpScale);
    }
  }

  // ResonanceCore 1.0: Chladni standing-wave analytical normal ripple + 5,100 m/s steel stress-wave shimmer
  vec3 resEmit=vec3(0.);
  if(uMode==0 && metal>.5 && uResCount>0){
    resEmit=resonanceShade(wPos,N,metal,uTime);
  }

  // Shadow Flame 1.0 (Off / Flash / Pro) evaluation
  vec2 sf=sfEvaluate(wPos,N,uMode);
  float vis=sf.x;
  float penSoft=sf.y;

  // SF-ContactMicro: crouch-aware analytical ground-contact shadow under every live actor (squared-dist broadphase!)
  if(ground>.5 && sfMode>=1 && uActiveActors>0){
    float contact=1.;
    float strength=sfMode>=2?.44:.48;
    for(int i=0;i<6;i++){
      if(i>=uActiveActors)break;
      vec4 a=uActors[i];
      if(a.w<.5)continue;
      vec2 rel=wPos.xz-a.xz;
      float r2=dot(rel,rel);
      if(r2>10.5)continue;
      float crouchF=clamp(a.w-1.,0.,1.);
      float maxLen=mix(2.65,1.65,crouchF);
      float along=clamp(dot(rel,-SUN_XZ),0.,maxLen);
      vec2 perp=rel+SUN_XZ*along;
      float radius=length(perp);
      float core=1.-smoothstep(.12,.48+along*.08,radius);
      float tail=1.-smoothstep(maxLen*.68,maxLen,along);
      float footAO=1.-smoothstep(.10,.46,sqrt(r2));
      contact=min(contact,mix(1.,strength,max(core*tail,footAO*.85)));
    }
    vis*=contact;
  }

  float nl=dot(N,SUN);
  float hemi=N.y*.5+.5;
  vec3 ambient=mix(vec3(.24,.27,.26),vec3(.65,.79,.88),hemi);
  float edge=0.;
  if(uMode!=2&&wPos.y>=0.&&kind<1.5){
    float edgeStr=sfMode>=2?.42:sfMode==1?.36:uQuality>=2?.36:.28;
    edge=(1.-smoothstep(.0,.72,wPos.y))*(1.-max(0.,N.y))*edgeStr;
  }

  // SF-ChromaticUmbra: physical Rayleigh sky-cool umbra + warm golden penumbra scatter
  float umbraDepth=sfMode>=2?mix(.62,1.,vis):sfMode==1?mix(.72,1.,vis):1.;
  vec3 umbraTint=sfMode>=1?mix(vec3(.76,.89,1.12),vec3(1.),vis):vec3(1.);
  vec3 sunCol=uKHDR==1?vec3(2.05,1.56,.96):vec3(1.66,1.32,.88);
  sunCol*=clamp(1.-uWeather.y*.82,0.12,1.);
  ambient*=mix(vec3(1.),mix(vec3(.68,.76,.84),vec3(.88,.48,.44),uWeather.z),clamp(uWeather.y,0.,1.));
  ambient+=vec3(.72,.82,1.)*uWeather.w*.55;
  float posNL=max(nl,0.);
  vec3 direct=posNL*vis*sunCol;
  if(sfMode>=1 && posNL>0.){
    float penBand=4.*vis*(1.-vis);
    direct+=vec3(1.12,.76,.40)*penBand*posNL*(.10+.09*penSoft);
  }
  // Shadow Flame 1.0 Pro warm asphalt bounce + FluxGI 1.0 Real-Time 2-Bounce Colored Radiosity & Dynamic Light-Field!
  vec3 bounceGI=vec3(0.);
  if(sfMode>=2 && uMode!=2 && kind<1.5){
    float sideMask=1.-abs(N.y);
    float lowMask=1.-smoothstep(0.,3.6,max(0.,wPos.y));
    bounceGI=vec3(.24,.20,.15)*(1.-vis)*sideMask*lowMask*.32;
  }
  float giSkyAO=1.;
  if(uFluxGIOn==1 && uMode!=2 && kind<2.5 && abs(wPos.x)<27. && abs(wPos.z)<104.){
    vec4 gi=fluxGISample(wPos,N);
    vec3 giRad=gi.rgb/(1.+gi.rgb*.42);
    float sideFill=mix(1.0,.62,max(0.,N.y));
    float heightFade=1.-smoothstep(2.5,7.8,max(0.,wPos.y));
    float shadowLift=.22+.78*(1.-vis);
    bounceGI+=giRad*sideFill*heightFade*shadowLift*(uKHDR==1?.52:.42);
    giSkyAO=mix(.84,1.04,gi.a);
  }

  vec3 light=ambient*giSkyAO*umbraDepth*umbraTint*(1.-edge)+direct+bounceGI;
  vec3 c=base*light;

  if(uQuality>=0 && vis>.002 && posNL>0.){
    vec3 H=normalize(V+SUN);
    float ndh=max(dot(N,H),0.);
    if(ndh>.74){
      float specPow=mix(26.,uQuality>=2?84.:62.,metal);
      float spec=pow(ndh,specPow);
      float specGain=uKHDR==1?1.18:1.;
      c+=vec3(1.,.88,.66)*spec*vis*(.045+(uQuality>=2?.28:.20)*metal)*(.4+.6*detail)*specGain;
    }
  }

  // High & Extra (and KHDR): sky environment fresnel reflection on metals (fast x^4 Schlick + Fresnel gate!)
  if((uQuality>=1 || uKHDR==1) && metal>.5){
    float ft=1.-max(dot(N,V),0.);
    float f2=ft*ft;
    float fres=f2*f2;
    if(fres>.003){
      vec3 R=reflect(-V,N);
      R.y=max(.02,R.y);
      float envMul=uQuality>=2?.36:uKHDR==1?.24:.17;
      c+=sky(R)*fres*envMul*(.45+.55*detail)*mix(.62,1.,vis);
    }
  }

  // Dynamic point lights + Shadow Flame DynamicFlame occlusion & warm wrap (bounded by uLightCount!)
  if(kind<2.5 && uQuality>=0 && uLightCount>0){
    int maxL=min(uLightCount,(uQuality>=2 || sfMode>=2)?6:uQuality==1?4:2);
    float khdrL=uKHDR==1?1.15:1.;
    float lSpecPow=mix(18.,54.,metal);
    float lSpecGain=.12+.38*metal;
    for(int i=0;i<6;i++){
      if(i>=maxL)break;
      vec4 lp=uLights[i];
      if(lp.w<=.001)continue;
      vec3 toL=lp.xyz-wPos;
      float ld2=dot(toL,toL);
      float att=lp.w/(1.+ld2*.14);
      if(att<.004)continue;
      vec3 L=toL*inversesqrt(max(ld2,1e-5));
      float flameOcc=1.;
      if(sfMode>=2 && ground>.5 && uActiveActors>0 && ld2<225.){
        vec2 toP=wPos.xz-lp.xz;
        for(int j=0;j<6;j++){
          if(j>=uActiveActors)break;
          vec4 a=uActors[j];
          if(a.w<.5)continue;
          vec2 toA=a.xz-lp.xz;
          float a2=dot(toA,toA);
          if(a2>144. || a2<.01)continue;
          float proj=dot(toP,toA)/a2;
          if(proj>1.02 && proj<3.5){
            vec2 perp=toP-toA*proj;
            float r=length(perp);
            flameOcc=min(flameOcc,mix(1.,.48,(1.-smoothstep(.16,max(.161,.55*proj),r))*(1.-smoothstep(2.0,3.5,proj))));
          }
        }
      }
      float diff=sfMode>=2?(max(dot(N,L),0.)*.80+.20):(max(dot(N,L),0.)*.85+.15);
      vec3 LH=normalize(V+L);
      float ndhl=max(dot(N,LH),0.);
      float lspec=ndhl>.68?pow(ndhl,lSpecPow)*lSpecGain:0.;
      c+=(base*diff+lspec)*uLightCol[i]*att*flameOcc*khdrL;
    }
  }
  c+=resEmit;

  if(ground>.5 && uQuality>=0){
    float n1=noise(wPos.xz*vec2(.34,.23));
    float n2=d<70.?noise(wPos.xz*.92):.5;
    float wet=smoothstep(.46,.77,n1*.62+n2*.38);
    if(wet>.004){
      float vt=1.-max(V.y,0.);
      float v2=vt*vt;
      float fres=v2*v2;
      vec3 wetReflect=(uQuality>=2||uKHDR==1)?sky(reflect(-V,normalize(vec3(0.,1.,0.)+N*.12)))*(uKHDR==1?.58:.52):vec3(.30,.38,.39)*.62;
      c=mix(c,c*.70+wetReflect*fres*mix(.58,1.,vis),wet*(uQuality>=2?.82:.69));
    }
    c*=.97+.06*noise(wPos.xz*.08);
  }

  // 3D character hit flash & procedural hexagonal energy shield discharge rim effect
  if(uMode==1 && (uHitFX.x>.01 || uHitFX.y>.01)){
    if(uQuality<0){
      c+=vec3(.30,1.45,1.75)*uHitFX.y*.85+vec3(1.50,.85,.35)*uHitFX.x*.85;
    } else {
      float rt=1.-max(dot(N,V),0.);
      float rim=rt*rt;
      if(uHitFX.y>.01){
        vec2 hp=vec2(atan(lPos.x,lPos.z)*3.8, lPos.y*12.5-uTime*6.5);
        vec2 r=vec2(1.,1.73205);
        vec2 h=r*.5;
        vec2 a=mod(hp,r)-h;
        vec2 b=mod(hp-h,r)-h;
        vec2 gv=dot(a,a)<dot(b,b)?a:b;
        float hexD=max(abs(gv.x),dot(abs(gv),vec2(.5,.8660254)));
        float hexLine=smoothstep(.41,.48,hexD);
        float pulse=.65+.35*sin(wPos.y*34.-uTime*32.);
        c+=vec3(.30,1.85,2.15)*uHitFX.y*(.32+1.48*rim+hexLine*1.35)*pulse;
      }
      if(uHitFX.x>.01){
        float shock=.62+.38*sin(wPos.y*28.+uTime*26.);
        c+=vec3(1.85,1.02,.38)*uHitFX.x*(.34+1.35*rim)*shock;
      }
    }
  }

  // First-person weapon muzzle barrel heat glow on rapid fire
  if(uMode==2 && uGunHeat>.01){
    float barrelMask=(1.-smoothstep(-.75,-.25,lPos.z));
    c+=vec3(1.1,.68,.35)*uGunHeat*barrelMask*.42;
  }

  if(uMode!=2)c=applyWorldFog(c,V,d);
  // Offscreen alpha distinguishes world, actor surfaces, and the first-person viewmodel.
  frag=vec4(displayColor(c),uMode==2?0.:uMode==1?.8:1.);
}`;
}

export const worldFS = buildWorldFS(true);
export const worldOpaqueFS = buildWorldFS(false);

export const skyVS = `#version 300 es
precision highp float;
precision highp int;
out vec2 ndc;
void main(){
  vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2)*2.-1.;
  ndc=p;
  gl_Position=vec4(p,1.,1.);
}`;

export const skyFS = `#version 300 es
${shared}
in vec2 ndc;
out vec4 frag;
uniform vec3 uForward,uRight,uUp;
uniform vec2 uFov;
uniform float uTime;
uniform int uQuality;
uniform sampler2D uWaves,uMirror;
uniform mat4 uMirrorVP;
uniform bool uHasMirror;
void main(){
  vec3 ray=normalize(uForward+ndc.x*uFov.x*uRight+ndc.y*uFov.y*uUp);
  vec3 c;
  if(ray.y>-.0008){
    c=sky(ray);
    if(uQuality>=2 || uKHDR==1){
      float mu=max(0.,dot(ray,SUN));
      if(mu>.5){
        float m2=mu*mu,m4=m2*m2,m8=m4*m4;
        float glow=.12*(m4*m8);
        if(mu>.85){
          float m16=m8*m8,m32=m16*m16,m64=m32*m32;
          glow+=.38*(m64*m16*m8*m2);
        }
        c+=vec3(1.,.72,.38)*glow*(uKHDR==1?1.22:1.);
      }
    }
  } else if(uQuality<0){
    // Ultra-lightweight 1-tap marine sea shader (zero mirror projection, zero multi-octave wave fetch)
    float dist=(-1.68-uEye.y)/ray.y;
    vec3 p=uEye+ray*dist;
    vec2 a=texture(uWaves,p.xz*vec2(.042,.055)+vec2(uTime*.014,uTime*.009)).rg*2.-1.;
    float ft=1.-max(0.,-ray.y);
    float fr=.16+.72*(ft*ft*ft);
    vec3 sea=mix(vec3(.032,.11,.115),vec3(.075,.19,.195),.5+.5*a.y);
    c=mix(sea,vec3(.42,.54,.58),fr);
    c=mix(c,vec3(.58,.66,.66),clamp((dist-120.)/1100.,0.,.90));
  } else {
    float dist=(-1.68-uEye.y)/ray.y;
    vec3 p=uEye+ray*dist;
    float t=uTime*.095;
    vec2 uv=p.xz;
    vec2 a=texture(uWaves,uv*vec2(.038,.053)+vec2(t*.17,t*.095)).rg*2.-1.;
    vec2 b=texture(uWaves,uv.yx*vec2(.12,.079)+vec2(-t*.11,t*.22)).gr*2.-1.;
    float farFade=1./(1.+dist*.0026);
    vec2 slopes=(a*.105+b*.058);
    vec2 cc=vec2(0.);
    // Distance-LOD high-frequency wave octaves (sub-pixel past 260m -> zero visual loss, 40-50% fewer sea fetches!)
    if(dist<260.){
      cc=texture(uWaves,uv*vec2(.25,.31)+vec2(t*.24,-t*.19)).rg*2.-1.;
      slopes+=cc*.032;
      if(uQuality>=2 && dist<140.){
        vec2 dd=texture(uWaves,uv*vec2(.52,.47)+vec2(-t*.34,t*.29)).rg*2.-1.;
        slopes+=dd*.018;
      }
    }
    slopes*=farFade;
    vec3 N=normalize(vec3(slopes.x,1.,slopes.y));
    vec3 R=reflect(ray,N);
    R.y=max(.009,R.y);
    float ft=1.-max(.0,dot(N,-ray));
    float f2=ft*ft;
    float fr=.10+.88*(f2*f2*sqrt(sqrt(ft)));
    vec3 reflected=sky(R);
    if(uHasMirror&&dist<420.){
      vec4 q=uMirrorVP*vec4(p,1.);
      vec2 coord=q.xy/q.w*.5+.5+slopes*.045;
      if(q.w>0.&&all(greaterThan(coord,vec2(.002)))&&all(lessThan(coord,vec2(.998)))){
        vec4 ref=texture(uMirror,coord);
        vec3 r=ref.rgb/max(vec3(.02),1.-ref.rgb);
        reflected=mix(reflected,r,ref.a*.92);
      }
    }
    vec3 sea=mix(vec3(.025,.093,.097),vec3(.068,.181,.182),.5+.5*a.y);
    c=mix(sea,reflected,fr);
    if((uQuality>=2 || uKHDR==1) && dist<260.){
      float crest=smoothstep(.62,.95,a.y*.55+b.x*.45+cc.y*.35)*farFade;
      c=mix(c,vec3(.78,.86,.86),crest*.18);
    }
    vec3 H=normalize(SUN-ray);
    float ndh=max(dot(N,H),0.);
    if(ndh>.85){
      float shine=pow(ndh,mix(220.,uQuality>=2?1150.:950.,farFade));
      c+=vec3(2.2,1.55,.82)*shine*farFade*(uKHDR==1?1.45:uQuality>=2?1.25:1.);
    }
    c=mix(c,vec3(.57,.65,.64),smoothstep(135.,1400.,dist)*.91);
  }
  frag=vec4(displayColor(c),1.);
}`;

export const postVS = `#version 300 es
precision highp float;
out vec2 vUV;
void main(){
  vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);
  vUV=p;
  gl_Position=vec4(p*2.-1.,0.,1.);
}`;
