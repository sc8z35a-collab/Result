import {SHADOW_FLAME_WORLD_GLSL} from './shadowflame.js';
import {KHDR_TONE_GLSL} from './khdr.js';
import {ARTICULATED_RIG_GLSL} from './rig.js';

export const shared = `
precision highp float;
precision highp int;
precision highp sampler2DArray;
const vec3 SUN=normalize(vec3(-.66,.28,-.70));
const float PI=3.14159265359;
uniform int uOutput;
uniform int uKHDR;
uniform vec3 uEye;
uniform sampler2D uSky;
${KHDR_TONE_GLSL}
vec3 sky(vec3 d){float a=atan(d.x,-d.z);vec2 uv=vec2(a/(2.*PI)+.5,asin(clamp(d.y,0.,1.))/(PI*.5));vec3 col=pow(texture(uSky,uv).rgb,vec3(2.2));float mu=max(0.,dot(d,SUN));float disc=smoothstep(.99988,.999973,mu);float sunGain=uKHDR==1?13.5:10.;return col*.99+vec3(1.,.77,.42)*(disc*sunGain+.64*pow(mu,420.)+.095*pow(mu,24.));}
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
    return pow(aces(c*.87),vec3(1./2.2));
  }
  return pow(clamp(c*.95,0.,1.),vec3(1./2.2));
}
float fog(float d){return 1.-exp(-pow(d*.00265,1.38));}
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
uniform vec2 uGait;
uniform vec3 uPose;
uniform vec3 uHit;
uniform vec2 uRecoil;
uniform vec4 uAnim;
uniform vec4 uAnim2;
out vec3 wPos,wNormal,wColor,lPos;
out vec2 uv;
flat out float layer;
flat out float kind;
${ARTICULATED_RIG_GLSL}
void main(){
  vec3 p=aPos,n=aNormal;
  lPos=p;
  float cleanKind=aKind;
  if(uMode==1){
    int boneId=int(floor(aKind*.1+.001));
    cleanKind=mod(aKind,10.);
    rigApplyCharacter(p,n,boneId,uGait,uPose,uHit,uRecoil,uAnim,uAnim2);
  } else if(uMode==2 && uRecoil.x>.001){
    // First-person weapon blowback: upper slide/rails kick back & subtle barrel pulse on shot
    float slide=smoothstep(.038,.075,p.y)*smoothstep(.12,-.16,p.z)*smoothstep(-.78,-.35,p.z);
    p.z+=uRecoil.x*.036*slide;
    float tip=smoothstep(-.35,-.80,p.z);
    p.x+=uRecoil.y*uRecoil.x*.003*tip;
    p.y+=uRecoil.x*.004*tip;
  }
  vec4 world=uModel*vec4(p,1.);
  wPos=world.xyz;
  wNormal=mat3(uModel)*n;
  wColor=aColor;
  uv=aUV;
  layer=aLayer;
  kind=cleanKind;
  gl_Position=uVP*world;
}`;

export const worldFS = `#version 300 es
${shared}
${SHADOW_FLAME_WORLD_GLSL}
in vec3 wPos,wNormal,wColor,lPos;
in vec2 uv;
flat in float layer;
flat in float kind;
uniform sampler2DArray uMats;
uniform int uMode;
uniform int uQuality;
uniform vec4 uActors[6]; // xyz=pos, w=0 if dead else 1.0 + crouch
uniform vec2 uHitFX;
uniform float uGunHeat;
uniform float uTime;
uniform vec4 uLights[6];
uniform vec3 uLightCol[6];
out vec4 frag;

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}

void main(){
  vec4 texel=texture(uMats,vec3(uv,layer));
  if(texel.a<.43)discard;
  vec3 N=normalize(wNormal);
  vec3 V=normalize(uEye-wPos);
  vec3 base=pow(max(vec3(.014),texel.rgb*wColor),vec3(2.14));
  float d=distance(uEye,wPos);
  float detail=dot(texel.rgb,vec3(.27,.52,.21));
  float metal=float(kind>.5&&kind<1.5);
  float ground=float(kind>1.5&&kind<2.5);
  int sfMode=int(uSfParams.x+.5);

  // High & Extra: procedural micro-bump normal perturbation on world surfaces
  if(uQuality>=1 && uMode!=2 && kind<2.5 && d>1.2 && d<95.){
    vec3 dp1=dFdx(wPos),dp2=dFdy(wPos);
    float dh1=dFdx(detail),dh2=dFdy(detail);
    vec3 surfGrad=cross(dp2,N)*dh1+cross(N,dp1)*dh2;
    float det=abs(dot(dp1,cross(dp2,N)));
    if(det>1e-5){
      float bumpScale=(uQuality>=2?.14:.08)*smoothstep(1.2,3.5,d)*(1.-smoothstep(40.,95.,d));
      N=normalize(N-clamp(surfGrad/det,vec3(-.85),vec3(.85))*bumpScale);
    }
  }

  // Shadow Flame 1.0 (Off / Flash / Pro) evaluation
  vec2 sf=sfEvaluate(wPos,N,uMode);
  float vis=sf.x;
  float penSoft=sf.y;

  // SF-ContactMicro: crouch-aware analytical ground-contact shadow under every live actor
  float contact=1.;
  if(ground>.5&&sfMode>=1){
    vec2 sunXZ=normalize(SUN.xz);
    for(int i=0;i<6;i++){
      vec4 a=uActors[i];
      if(a.w<.5)continue;
      float crouchF=clamp(a.w-1.,0.,1.);
      float maxLen=mix(2.65,1.65,crouchF);
      vec2 rel=wPos.xz-a.xz;
      float along=clamp(dot(rel,-sunXZ),0.,maxLen);
      float radius=length(rel+sunXZ*along);
      float core=1.-smoothstep(.12,.48+along*.08,radius);
      float tail=1.-smoothstep(maxLen*.68,maxLen,along);
      float footAO=1.-smoothstep(.10,.46,length(rel));
      float strength=sfMode>=2?.44:.48;
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
  vec3 direct=max(nl,0.)*vis*sunCol;
  if(sfMode>=1){
    float penBand=4.*vis*(1.-vis);
    direct+=vec3(1.12,.76,.40)*penBand*max(nl,0.)*(.10+.09*penSoft);
  }
  // Shadow Flame 1.0 Pro: 1-bounce warm sunlit asphalt indirect bounce into shadowed container walls
  vec3 bounceGI=vec3(0.);
  if(sfMode>=2 && uMode!=2 && kind<1.5){
    float sideMask=1.-abs(N.y);
    float lowMask=1.-smoothstep(0.,3.6,max(0.,wPos.y));
    bounceGI=vec3(.24,.20,.15)*(1.-vis)*sideMask*lowMask*.38;
  }

  vec3 light=ambient*umbraDepth*umbraTint*(1.-edge)+direct+bounceGI;
  vec3 c=base*light;

  if(uQuality>=0){
    vec3 H=normalize(V+SUN);
    float specPow=mix(26.,uQuality>=2?84.:62.,metal);
    float spec=pow(max(dot(N,H),0.),specPow);
    float specGain=uKHDR==1?1.18:1.;
    c+=vec3(1.,.88,.66)*spec*vis*(.045+(uQuality>=2?.28:.20)*metal)*(.4+.6*detail)*specGain;
  }

  // High & Extra (and KHDR): sky environment fresnel reflection on metals
  if((uQuality>=1 || uKHDR==1) && kind<2.5){
    float fres=pow(1.-max(dot(N,V),0.),4.2);
    vec3 R=reflect(-V,N);
    R.y=max(.02,R.y);
    if(metal>.5){
      float envMul=uQuality>=2?.36:uKHDR==1?.24:.17;
      c+=sky(R)*fres*envMul*(.45+.55*detail)*mix(.62,1.,vis);
    }
  }

  // Dynamic point lights + Shadow Flame DynamicFlame occlusion & warm wrap (skipped in Lightweight Mode)
  if(kind<2.5 && uQuality>=0){
    int maxL=(uQuality>=2 || sfMode>=2)?6:uQuality==1?4:2;
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
      if(sfMode>=2 && ground>.5){
        // Dynamic flame micro-shadow cast away from glowing explosions / supply tankers by nearby actors
        for(int j=0;j<6;j++){
          vec4 a=uActors[j];
          if(a.w<.5)continue;
          vec2 toA=a.xz-lp.xz;
          vec2 toP=wPos.xz-lp.xz;
          float proj=dot(toP,toA)/max(dot(toA,toA),.01);
          if(proj>1.02 && proj<3.5){
            vec2 perp=toP-toA*proj;
            float r=length(perp);
            flameOcc=min(flameOcc,mix(1.,.48,(1.-smoothstep(.16,.55*proj,r))*(1.-smoothstep(2.0,3.5,proj))));
          }
        }
      }
      float diff=sfMode>=2?(max(dot(N,L),0.)*.80+.20):(max(dot(N,L),0.)*.85+.15);
      vec3 LH=normalize(V+L);
      float lspec=pow(max(dot(N,LH),0.),mix(18.,54.,metal))*(.12+.38*metal);
      c+=(base*diff+lspec)*uLightCol[i]*att*flameOcc*(uKHDR==1?1.15:1.);
    }
  }

  if(ground>.5 && uQuality>=0){
    float wet=smoothstep(.46,.77,noise(wPos.xz*vec2(.34,.23))*.62+noise(wPos.xz*.92)*.38);
    float fres=pow(1.-max(V.y,0.),4.);
    vec3 wetReflect=(uQuality>=2||uKHDR==1)?sky(reflect(-V,normalize(vec3(0.,1.,0.)+N*.12)))*(uKHDR==1?.58:.52):vec3(.30,.38,.39)*.62;
    c=mix(c,c*.70+wetReflect*fres*mix(.58,1.,vis),wet*(uQuality>=2?.82:.69));
    c*=.97+.06*noise(wPos.xz*.08);
  }

  // 3D character hit flash & procedural hexagonal energy shield discharge rim effect
  if(uMode==1 && (uHitFX.x>.01 || uHitFX.y>.01)){
    if(uQuality<0){
      c+=vec3(.30,1.45,1.75)*uHitFX.y*.85+vec3(1.50,.85,.35)*uHitFX.x*.85;
    } else {
      float rim=pow(1.-max(dot(N,V),0.),2.0);
      if(uHitFX.y>.01){
        // Animated hexagonal plasma energy grid rippling over armored silhouette on shield hit
        vec2 hp=vec2(atan(lPos.x,lPos.z)*3.8, lPos.y*12.5-uTime*6.5);
        vec2 r=vec2(1.,1.73205);
        vec2 h=r*.5;
        vec2 a=mod(hp,r)-h;
        vec2 b=mod(hp-h,r)-h;
        vec2 gv=dot(a,a)<dot(b,b)?a:b;
        float hexD=max(abs(gv.x),dot(abs(gv),normalize(r)));
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
    float barrelMask=smoothstep(-.25,-.75,lPos.z);
    c+=vec3(1.1,.68,.35)*uGunHeat*barrelMask*.42;
  }

  if(kind>2.5&&kind<3.5){
    float boost=(uQuality>=2?3.15:uQuality==1?2.45:uQuality==0?2.05:1.75)*(uKHDR==1?1.26:1.);
    c=base*(boost+.38*detail);
  }
  if(kind>4.5)c=mix(c,base*1.2,.6);

  if(uMode!=2){
    if(uQuality<0){
      float fg=clamp((d-18.)/360.,0.,.86);
      c=mix(c,vec3(.62,.71,.72),fg);
    } else {
      float sunScatter=pow(max(dot(-V,SUN),0.),(uQuality>=2||uKHDR==1)?3.0:4.0);
      vec3 fcol=mix(vec3(.58,.68,.70),vec3(.95,.77,.52),sunScatter);
      float fg=fog(d);
      c=mix(c,fcol,fg);
      if(uQuality>=2 || uKHDR==1)c+=vec3(1.,.78,.46)*sunScatter*fg*(uKHDR==1?.28:.24);
    }
  }
  // Alpha channel carries world mask (1.0=world/actor, 0.0=first-person viewmodel) for Shadow Flame Pro screen-space pass!
  frag=vec4(displayColor(c),uMode==2?0.:1.);
}`;

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
      c+=vec3(1.,.72,.38)*(.12*pow(mu,12.)+.38*pow(mu,90.))*(uKHDR==1?1.22:1.);
    }
  } else if(uQuality<0){
    // Ultra-lightweight 1-tap marine sea shader (zero mirror projection, zero multi-octave wave fetch)
    float dist=(-1.68-uEye.y)/ray.y;
    vec3 p=uEye+ray*dist;
    vec2 a=texture(uWaves,p.xz*vec2(.042,.055)+vec2(uTime*.014,uTime*.009)).rg*2.-1.;
    float farFade=1./(1.+dist*.003);
    vec3 N=normalize(vec3(a.x*.09*farFade,1.,a.y*.09*farFade));
    float fr=.16+.72*pow(1.-max(0.,-ray.y),3.);
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
    vec2 cc=texture(uWaves,uv*vec2(.25,.31)+vec2(t*.24,-t*.19)).rg*2.-1.;
    float farFade=1./(1.+dist*.0026);
    vec2 slopes=(a*.105+b*.058+cc*.032)*farFade;
    if(uQuality>=2){
      vec2 dd=texture(uWaves,uv*vec2(.52,.47)+vec2(-t*.34,t*.29)).rg*2.-1.;
      slopes+=dd*.018*farFade;
    }
    vec3 N=normalize(vec3(slopes.x,1.,slopes.y));
    vec3 R=reflect(ray,N);
    R.y=max(.009,R.y);
    float fr=.10+.88*pow(1.-max(.0,dot(N,-ray)),4.3);
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
    if(uQuality>=2 || uKHDR==1){
      float crest=smoothstep(.62,.95,a.y*.55+b.x*.45+cc.y*.35)*farFade;
      c=mix(c,vec3(.78,.86,.86),crest*.18);
    }
    vec3 H=normalize(SUN-ray);
    float shine=pow(max(dot(N,H),0.),mix(220.,uQuality>=2?1150.:950.,farFade));
    c+=vec3(2.2,1.55,.82)*shine*farFade*(uKHDR==1?1.45:uQuality>=2?1.25:1.);
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
