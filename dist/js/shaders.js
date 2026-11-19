export const shared = `
precision highp float;
precision highp int;
precision highp sampler2DArray;
const vec3 SUN=normalize(vec3(-.66,.28,-.70));
const float PI=3.14159265359;
uniform int uOutput;
uniform vec3 uEye;
uniform sampler2D uSky;
vec3 sky(vec3 d){float a=atan(d.x,-d.z);vec2 uv=vec2(a/(2.*PI)+.5,asin(clamp(d.y,0.,1.))/(PI*.5));vec3 col=pow(texture(uSky,uv).rgb,vec3(2.2));float mu=max(0.,dot(d,SUN));float disc=smoothstep(.99988,.999973,mu);return col*.99+vec3(1.,.77,.42)*(disc*10.+.60*pow(mu,450.)+.088*pow(mu,26.));}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
vec3 displayColor(vec3 c){c=max(c,vec3(0.));if(uOutput==4)return clamp(log2(1.+c)/3.6,0.,1.);if(uOutput==3)return c/(1.+c);if(uOutput==2){vec3 extended=aces(c*.83)+max(c-vec3(1.),0.)*.46;return clamp(log2(1.+extended)/3.,0.,1.);}if(uOutput==1)return pow(aces(c*.87),vec3(1./2.2));return pow(clamp(c*.95,0.,1.),vec3(1./2.2));}
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
uniform mat4 uVP,uModel,uLight;
uniform int uMode;
uniform vec2 uGait;
uniform vec3 uPose;
uniform vec3 uHit;
uniform vec2 uRecoil;
out vec3 wPos,wNormal,wColor,lPos;
out vec2 uv;
out vec4 lightPos;
flat out float layer;
flat out float kind;
void main(){
  vec3 p=aPos,n=aNormal;
  lPos=p;
  if(uMode==1){
    float c=clamp(uPose.x,0.,1.);
    float oy=lPos.y,oz=lPos.z;
    float leg=(1.-smoothstep(.45,.91,oy))*sign(p.x),g=sin(uGait.x)*uGait.y*mix(1.,.48,c);
    p.z+=leg*g*.23;
    p.y+=abs(leg)*max(0.,g*sign(p.x))*.066;
    p.z+=smoothstep(.22,.33,abs(p.x))*g*.027;
    p.y+=abs(cos(uGait.x))*.022*uGait.y*mix(1.,.45,c);
    float upper=smoothstep(.38,1.42,oy);
    p.x+=uPose.y*upper;
    // Anatomical tactical combat crouch: keep head/torso/arms/weapon at 100% true scale while bending knees & folding legs.
    if(c>.001){
      float s=p.x>=0.?1.:-1.;
      float ankleZ=c*(s>0.?.16:-.11);
      float kneeY=c*(s>0.?-.27:-.15);
      float kneeZ=c*(s>0.?-.05:-.24);
      float hipY=-.44*c;
      float hipZ=.11*c;
      if(oy<=.19){
        p.x+=s*.042*c;
        p.z+=ankleZ;
      } else if(oy<=.55){
        float t=(oy-.19)/.36;
        p.x+=s*.042*c;
        p.y+=mix(0.,kneeY,t);
        p.z+=mix(ankleZ,kneeZ,t);
      } else if(oy<=.91){
        float t=(oy-.55)/.36;
        p.x+=s*.042*c*(1.-t);
        p.y+=mix(kneeY,hipY,t);
        p.z+=mix(kneeZ,hipZ,t);
      } else {
        vec2 rel=vec2(p.y-.91,p.z-.015);
        float ang=.13*c;
        float ca=cos(ang),sa=sin(ang);
        p.y=.91+hipY+rel.x*ca+rel.y*sa;
        p.z=.015+hipZ-rel.x*sa+rel.y*ca;
        vec2 nrot=vec2(n.y*ca+n.z*sa,-n.y*sa+n.z*ca);
        n.y=nrot.x;
        n.z=nrot.y;
      }
    }
    p.y+=uPose.z*.14*smoothstep(.16,.40,-oz);
    p.z-=uPose.z*.045*upper;
    // 3D NPC firing recoil on upper body & weapon arms
    float armMask=smoothstep(.95,1.45,oy)*smoothstep(-.05,-.32,oz);
    p.z+=uRecoil.x*.065*armMask;
    p.y+=uRecoil.x*.032*armMask;
    // 3D hit stagger reaction: flinch backward & twist along incoming shot direction
    float h=uHit.x;
    if(h>.001){
      float flinch=sin(h*3.14159)*h;
      float headMask=smoothstep(.72,1.68,oy);
      p.x+=uHit.y*flinch*.19*headMask;
      p.z+=uHit.z*flinch*.22*headMask;
      p.y-=flinch*.065*headMask;
      float twist=uHit.y*flinch*.32*upper;
      float ct=cos(twist),st=sin(twist);
      vec2 xz=mat2(ct,-st,st,ct)*p.xz;
      p.xz=xz;
      vec2 nxz=mat2(ct,-st,st,ct)*n.xz;
      n.xz=nxz;
    }
  } else if(uMode==2 && uRecoil.x>.001){
    // First-person weapon blowback: upper slide/rails kick back & barrel vibrates on shot
    float slide=smoothstep(.038,.075,p.y)*smoothstep(.12,-.16,p.z)*smoothstep(-.78,-.35,p.z);
    p.z+=uRecoil.x*.048*slide;
    float tip=smoothstep(-.35,-.80,p.z);
    p.x+=uRecoil.y*uRecoil.x*.006*tip;
    p.y+=uRecoil.x*.009*tip;
  }
  vec4 world=uModel*vec4(p,1.);
  wPos=world.xyz;
  wNormal=mat3(uModel)*n;
  wColor=aColor;
  uv=aUV;
  layer=aLayer;
  kind=aKind;
  lightPos=uLight*world;
  gl_Position=uVP*world;
}`;

export const worldFS = `#version 300 es
${shared}
precision highp sampler2DShadow;
in vec3 wPos,wNormal,wColor,lPos;
in vec2 uv;
in vec4 lightPos;
flat in float layer;
flat in float kind;
uniform sampler2DArray uMats;
uniform sampler2DShadow uShadow;
uniform bool uShadows;
uniform int uMode;
uniform int uQuality;
uniform vec4 uActors[6];
uniform vec2 uHitFX;
uniform float uGunHeat;
uniform float uTime;
uniform vec4 uLights[6];
uniform vec3 uLightCol[6];
out vec4 frag;

const vec2 POISSON16[16]=vec2[16](
  vec2(-.9420,-.3990),vec2(.9455,-.7689),vec2(-.0941,-.9293),vec2(.3449,.2938),
  vec2(-.9158,.4577),vec2(-.8154,-.8791),vec2(-.3827,.2767),vec2(.9748,.7564),
  vec2(.4432,-.9751),vec2(.5374,-.4737),vec2(-.2649,-.4189),vec2(.7919,.1909),
  vec2(-.2418,.9970),vec2(-.8140,.9143),vec2(.1998,.7864),vec2(.1438,-.1410)
);

float visibility(vec3 n){
  if(!uShadows||uMode==2)return 1.;
  vec3 p=lightPos.xyz/lightPos.w*.5+.5;
  if(any(lessThan(p,vec3(0.)))||any(greaterThan(p,vec3(1.))))return 1.;
  p.z-=.00022+.00038*(1.-max(0.,dot(n,SUN)));
  vec2 texel=1./vec2(textureSize(uShadow,0));
  if(uQuality>=2){
    float sum=0.;
    vec2 rad=texel*1.85;
    for(int i=0;i<16;i++)sum+=texture(uShadow,p+vec3(POISSON16[i]*rad,0.));
    return sum/16.;
  }
  if(uQuality==1){
    float sum=0.;
    vec2 rad=texel*1.35;
    for(int i=0;i<8;i++)sum+=texture(uShadow,p+vec3(POISSON16[i*2]*rad,0.));
    return sum/8.;
  }
  vec2 t=1.1*texel;
  return .25*(texture(uShadow,p+vec3(t*vec2(-.9,-.4),0))+texture(uShadow,p+vec3(t*vec2(.4,-.9),0))+texture(uShadow,p+vec3(t*vec2(.9,.4),0))+texture(uShadow,p+vec3(t*vec2(-.4,.9),0)));
}
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

  // High & Extra: procedural micro-bump normal perturbation on world surfaces (smooth machined finish on close-up viewmodel)
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

  float vis=visibility(N);
  float contact=1.;
  if(ground>.5&&uShadows){
    for(int i=0;i<6;i++){
      vec4 a=uActors[i];
      if(a.w<.5)continue;
      vec2 rel=wPos.xz-a.xz;
      float along=clamp(dot(rel,-normalize(SUN.xz)),0.,2.75);
      float radius=length(rel+normalize(SUN.xz)*along);
      contact=min(contact,mix(1.,uQuality>=2?.46:.53,(1.-smoothstep(.14,.54,radius))*(1.-smoothstep(2.0,2.83,along))));
    }
    vis*=contact;
  }

  float nl=dot(N,SUN);
  float hemi=N.y*.5+.5;
  vec3 ambient=mix(vec3(.25,.27,.25),vec3(.66,.79,.87),hemi);
  float edge=0.;
  if(uMode!=2&&wPos.y>=0.&&kind<1.5)edge=(1.-smoothstep(.0,.7,wPos.y))*(1.-max(0.,N.y))*(uQuality>=2?.36:.28);
  vec3 light=ambient*(1.-edge)+max(nl,0.)*vis*vec3(1.63,1.30,.88);
  vec3 c=base*light;

  vec3 H=normalize(V+SUN);
  float spec=pow(max(dot(N,H),0.),mix(26.,uQuality>=2?78.:59.,metal));
  c+=vec3(1.,.88,.66)*spec*vis*(.045+(uQuality>=2?.28:.20)*metal)*(.4+.6*detail);

  // High & Extra: sky environment fresnel reflection on metals and wet asphalt
  if(uQuality>=1 && kind<2.5){
    float fres=pow(1.-max(dot(N,V),0.),4.2);
    vec3 R=reflect(-V,N);
    R.y=max(.02,R.y);
    if(metal>.5){
      c+=sky(R)*fres*(uQuality>=2?.34:.17)*(.45+.55*detail);
    }
  }

  // Dynamic point lights (muzzle flashes, flying shots, explosions, supply tankers)
  if(kind<2.5){
    int maxL=uQuality>=2?6:uQuality==1?4:2;
    for(int i=0;i<6;i++){
      if(i>=maxL)break;
      vec4 lp=uLights[i];
      if(lp.w<=.001)continue;
      vec3 toL=lp.xyz-wPos;
      float ld2=dot(toL,toL);
      float att=lp.w/(1.+ld2*.14);
      if(att<.004)continue;
      vec3 L=toL*inversesqrt(max(ld2,1e-5));
      float diff=max(dot(N,L),0.)*.85+.15;
      vec3 LH=normalize(V+L);
      float lspec=pow(max(dot(N,LH),0.),mix(18.,54.,metal))*(.12+.38*metal);
      c+=(base*diff+lspec)*uLightCol[i]*att;
    }
  }

  if(ground>.5){
    float wet=smoothstep(.46,.77,noise(wPos.xz*vec2(.34,.23))*.62+noise(wPos.xz*.92)*.38);
    float fres=pow(1.-max(V.y,0.),4.);
    vec3 wetReflect=uQuality>=2?sky(reflect(-V,normalize(vec3(0.,1.,0.)+N*.12)))*.52:vec3(.30,.38,.39)*.62;
    c=mix(c,c*.70+wetReflect*fres,wet*(uQuality>=2?.82:.69));
    c*=.97+.06*noise(wPos.xz*.08);
  }

  // 3D character hit flash & energy shield discharge rim effect
  if(uMode==1 && (uHitFX.x>.01 || uHitFX.y>.01)){
    float rim=pow(1.-max(dot(N,V),0.),2.2);
    float scan=.6+.4*sin(wPos.y*42.-uTime*36.);
    if(uHitFX.y>.01)c+=vec3(.32,1.65,1.85)*uHitFX.y*(.35+1.35*rim)*scan;
    if(uHitFX.x>.01)c+=vec3(1.55,.95,.42)*uHitFX.x*(.28+1.15*rim);
  }

  // First-person weapon muzzle barrel heat glow on rapid fire
  if(uMode==2 && uGunHeat>.01){
    float barrelMask=smoothstep(-.25,-.75,lPos.z);
    c+=vec3(1.1,.68,.35)*uGunHeat*barrelMask*.42;
  }

  if(kind>2.5&&kind<3.5){
    float boost=uQuality>=2?2.85:uQuality==1?2.15:1.8;
    c=base*(boost+.35*detail);
  }
  if(kind>4.5)c=mix(c,base*1.2,.6);

  if(uMode!=2){
    float sunScatter=pow(max(dot(-V,SUN),0.),uQuality>=2?3.2:4.0);
    vec3 fcol=mix(vec3(.58,.68,.70),vec3(.92,.76,.54),sunScatter);
    float fg=fog(d);
    c=mix(c,fcol,fg);
    if(uQuality>=2)c+=vec3(1.,.78,.46)*sunScatter*fg*.24;
  }
  frag=vec4(displayColor(c),1.);
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
    if(uQuality>=2){
      float mu=max(0.,dot(ray,SUN));
      c+=vec3(1.,.72,.38)*(.12*pow(mu,12.)+.35*pow(mu,90.));
    }
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
    if(uQuality>=2){
      float crest=smoothstep(.62,.95,a.y*.55+b.x*.45+cc.y*.35)*farFade;
      c=mix(c,vec3(.78,.86,.86),crest*.18);
    }
    vec3 H=normalize(SUN-ray);
    float shine=pow(max(dot(N,H),0.),mix(220.,uQuality>=2?1150.:950.,farFade));
    c+=vec3(2.2,1.55,.82)*shine*farFade*(uQuality>=2?1.25:1.);
    c=mix(c,vec3(.57,.65,.64),smoothstep(135.,1400.,dist)*.91);
  }
  frag=vec4(displayColor(c),1.);
}`;

export const shadowVS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
uniform mat4 uModel;
void main(){gl_Position=uVP*uModel*vec4(aPos,1.);}`;

export const shadowFS = `#version 300 es
precision mediump float;
void main(){}`;

// Extra Graphics Post-Processing Shaders (HDR Bloom + FXAA + Chromatic Aberration + Cinematic Grade)
export const postVS = `#version 300 es
precision highp float;
out vec2 vUV;
void main(){
  vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);
  vUV=p;
  gl_Position=vec4(p*2.-1.,0.,1.);
}`;

export const bloomExtractFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
out vec4 frag;
vec3 dec(vec3 v){return exp2(v*3.6)-1.;}
void main(){
  vec2 t=1./vec2(textureSize(uScene,0));
  vec3 c=.25*(dec(texture(uScene,vUV+vec2(-t.x,-t.y)).rgb)+dec(texture(uScene,vUV+vec2(t.x,-t.y)).rgb)+dec(texture(uScene,vUV+vec2(-t.x,t.y)).rgb)+dec(texture(uScene,vUV+vec2(t.x,t.y)).rgb));
  float lum=dot(c,vec3(.2126,.7152,.0722));
  float soft=smoothstep(.88,1.95,lum);
  vec3 outC=c*soft*.82;
  frag=vec4(clamp(log2(1.+max(outC,0.))/3.6,0.,1.),1.);
}`;

export const blurFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 frag;
vec3 dec(vec3 v){return exp2(v*3.6)-1.;}
void main(){
  const float w[5]=float[5](.227027,.1945946,.1216216,.054054,.016216);
  vec3 acc=dec(texture(uTex,vUV).rgb)*w[0];
  for(int i=1;i<5;i++){
    vec2 off=uDir*float(i)*1.35;
    acc+=dec(texture(uTex,vUV+off).rgb)*w[i];
    acc+=dec(texture(uTex,vUV-off).rgb)*w[i];
  }
  frag=vec4(clamp(log2(1.+max(acc,0.))/3.6,0.,1.),1.);
}`;

export const compositeFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene,uBloomA,uBloomB;
uniform int uOutput;
uniform float uShake;
uniform float uHurt;
uniform float uTime;
out vec4 frag;
vec3 dec(vec3 v){return exp2(v*3.6)-1.;}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
vec3 toneOut(vec3 c){
  c=max(c,vec3(0.));
  if(uOutput==2){vec3 extended=aces(c*.85)+max(c-vec3(1.),0.)*.52;return clamp(log2(1.+extended)/3.,0.,1.);}
  if(uOutput==1)return pow(aces(c*.90),vec3(1./2.2));
  return pow(clamp(c*.97,0.,1.),vec3(1./2.2));
}
float luma(vec3 c){return dot(c,vec3(.299,.587,.114));}
void main(){
  vec2 px=1./vec2(textureSize(uScene,0));
  vec2 fromC=vUV-.5;
  float r2=dot(fromC,fromC);
  // Subtle cinematic lens chromatic aberration amplified dynamically on shot/hit
  float ca=(.0012+uShake*.0038+uHurt*.0055)*r2;
  vec2 dir=fromC*ca;
  vec3 cM=dec(texture(uScene,vUV).rgb);
  // Lightweight FXAA-style edge smoothing in log space
  vec3 nW=texture(uScene,vUV+vec2(-px.x,-px.y)).rgb;
  vec3 nE=texture(uScene,vUV+vec2(px.x,-px.y)).rgb;
  vec3 sW=texture(uScene,vUV+vec2(-px.x,px.y)).rgb;
  vec3 sE=texture(uScene,vUV+vec2(px.x,px.y)).rgb;
  float lNW=luma(nW),lNE=luma(nE),lSW=luma(sW),lSE=luma(sE),lM=luma(texture(uScene,vUV).rgb);
  float lMin=min(lM,min(min(lNW,lNE),min(lSW,lSE)));
  float lMax=max(lM,max(max(lNW,lNE),max(lSW,lSE)));
  vec3 base=cM;
  if(lMax-lMin>.042){
    vec2 d=vec2(-((lNW+lNE)-(lSW+lSE)),(lNW+lSW)-(lNE+lSE));
    float dReduce=max((lNW+lNE+lSW+lSE)*.03125,.0078125);
    float rcp=1./(min(abs(d.x),abs(d.y))+dReduce);
    d=clamp(d*rcp,vec2(-4.),vec2(4.))*px;
    vec3 a=.5*(dec(texture(uScene,vUV+d*(1./3.-.5)).rgb)+dec(texture(uScene,vUV+d*(2./3.-.5)).rgb));
    vec3 b=a*.5+.25*(dec(texture(uScene,vUV+d*-.5).rgb)+dec(texture(uScene,vUV+d*.5).rgb));
    float lb=luma(clamp(log2(1.+b)/3.6,0.,1.));
    base=(lb<lMin||lb>lMax)?a:b;
  }
  if(ca>.00018){
    base.r=mix(base.r,dec(texture(uScene,vUV+dir).rgb).r,.75);
    base.b=mix(base.b,dec(texture(uScene,vUV-dir).rgb).b,.75);
  }
  vec3 bloom=dec(texture(uBloomA,vUV).rgb)*.42+dec(texture(uBloomB,vUV).rgb)*.38;
  vec3 c=base+bloom;
  // Crisp cinematic contrast & subtle edge vignette
  float vig=1.-r2*.42;
  c*=vig;
  // Micro film grain to prevent sky/fog banding
  float grain=(fract(sin(dot(gl_FragCoord.xy+uTime*17.,vec2(12.9898,78.233)))*43758.5453)-.5)*.012;
  frag=vec4(clamp(toneOut(c)+grain,0.,1.),1.);
}`;
