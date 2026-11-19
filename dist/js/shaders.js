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
vec3 displayColor(vec3 c){c=max(c,vec3(0.));if(uOutput==3)return c/(1.+c);if(uOutput==2){vec3 extended=aces(c*.83)+max(c-vec3(1.),0.)*.46;return clamp(log2(1.+extended)/3.,0.,1.);}if(uOutput==1)return pow(aces(c*.87),vec3(1./2.2));return pow(clamp(c*.95,0.,1.),vec3(1./2.2));}
float fog(float d){return 1.-exp(-pow(d*.00265,1.38));}
`;
export const worldVS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 aPos;layout(location=1) in vec3 aNormal;layout(location=2) in vec2 aUV;layout(location=3) in float aLayer;layout(location=4) in vec3 aColor;layout(location=5) in float aKind;
uniform mat4 uVP,uModel,uLight;uniform int uMode;uniform vec2 uGait;uniform vec3 uPose;
out vec3 wPos,wNormal,wColor;out vec2 uv;out vec4 lightPos;flat out float layer;flat out float kind;
void main(){vec3 p=aPos,n=aNormal;if(uMode==1){float leg=(1.-smoothstep(.45,.91,p.y))*sign(p.x),g=sin(uGait.x)*uGait.y;p.z+=leg*g*.23;p.y+=abs(leg)*max(0.,g*sign(p.x))*.066;p.z+=smoothstep(.22,.33,abs(p.x))*g*.027;p.y+=abs(cos(uGait.x))*.022*uGait.y;float upper=smoothstep(.38,1.42,p.y);p.x+=uPose.y*upper;p.z-=uPose.x*.095*smoothstep(.0,.48,p.y)*(1.-smoothstep(.52,1.12,p.y));p.y*=1.-.34*uPose.x;p.y+=uPose.z*.14*smoothstep(.16,.40,-p.z);p.z-=uPose.z*.045*upper;}vec4 world=uModel*vec4(p,1.);wPos=world.xyz;wNormal=mat3(uModel)*n;wColor=aColor;uv=aUV;layer=aLayer;kind=aKind;lightPos=uLight*world;gl_Position=uVP*world;}`;
export const worldFS = `#version 300 es
${shared}
precision highp sampler2DShadow;
in vec3 wPos,wNormal,wColor;in vec2 uv;in vec4 lightPos;flat in float layer;flat in float kind;
uniform sampler2DArray uMats;uniform sampler2DShadow uShadow;uniform bool uShadows;uniform int uMode;uniform vec4 uActors[6];out vec4 frag;
float visibility(vec3 n){if(!uShadows||uMode==2)return 1.;vec3 p=lightPos.xyz/lightPos.w*.5+.5;if(any(lessThan(p,vec3(0.)))||any(greaterThan(p,vec3(1.))))return 1.;p.z-=.00022+.00038*(1.-max(0.,dot(n,SUN)));vec2 t=1.1/vec2(textureSize(uShadow,0));return .25*(texture(uShadow,p+vec3(t*vec2(-.9,-.4),0))+texture(uShadow,p+vec3(t*vec2(.4,-.9),0))+texture(uShadow,p+vec3(t*vec2(.9,.4),0))+texture(uShadow,p+vec3(t*vec2(-.4,.9),0)));}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
void main(){vec4 texel=texture(uMats,vec3(uv,layer));if(texel.a<.43)discard;vec3 N=normalize(wNormal),V=normalize(uEye-wPos),base=pow(max(vec3(.014),texel.rgb*wColor),vec3(2.14));float d=distance(uEye,wPos);float detail=dot(texel.rgb,vec3(.27,.52,.21));float metal=float(kind>.5&&kind<1.5);float ground=float(kind>1.5&&kind<2.5);float vis=visibility(N);float contact=1.;if(ground>.5&&uShadows){for(int i=0;i<6;i++){vec4 a=uActors[i];if(a.w<.5)continue;vec2 rel=wPos.xz-a.xz;float along=clamp(dot(rel,-normalize(SUN.xz)),0.,2.75);float radius=length(rel+normalize(SUN.xz)*along);contact=min(contact,mix(1.,.53,(1.-smoothstep(.14,.54,radius))*(1.-smoothstep(2.0,2.83,along))));}vis*=contact;}
 float nl=dot(N,SUN);float hemi=N.y*.5+.5;vec3 ambient=mix(vec3(.25,.27,.25),vec3(.66,.79,.87),hemi);float edge=0.;if(uMode!=2&&wPos.y>=0.&&kind<1.5)edge=(1.-smoothstep(.0,.7,wPos.y))*(1.-max(0.,N.y))*.28;
 vec3 light=ambient*(1.-edge)+max(nl,0.)*vis*vec3(1.63,1.30,.88);vec3 c=base*light;
 vec3 H=normalize(V+SUN);float spec=pow(max(dot(N,H),0.),mix(26.,59.,metal));c+=vec3(1.,.88,.66)*spec*vis*(.045+.20*metal)*(.4+.6*detail);
 if(ground>.5){float wet=smoothstep(.46,.77,noise(wPos.xz*vec2(.34,.23))*.62+noise(wPos.xz*.92)*.38);float fres=pow(1.-max(V.y,0.),4.);c=mix(c,c*.72+vec3(.30,.38,.39)*fres*.62,wet*.69);c*=.97+.06*noise(wPos.xz*.08);}
 if(kind>2.5&&kind<3.5)c=base*(1.8+.25*detail);if(kind>4.5)c=mix(c,base*1.2,.6);if(uMode!=2){vec3 fcol=mix(vec3(.58,.68,.70),vec3(.83,.72,.54),pow(max(dot(-V,SUN),0.),4.));c=mix(c,fcol,fog(d));}frag=vec4(displayColor(c),1.);}`;
export const skyVS = `#version 300 es
precision highp float;
precision highp int;out vec2 ndc;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2)*2.-1.;ndc=p;gl_Position=vec4(p,1.,1.);}`;
export const skyFS = `#version 300 es
${shared}
in vec2 ndc;out vec4 frag;uniform vec3 uForward,uRight,uUp;uniform vec2 uFov;uniform float uTime;uniform sampler2D uWaves,uMirror;uniform mat4 uMirrorVP;uniform bool uHasMirror;
void main(){vec3 ray=normalize(uForward+ndc.x*uFov.x*uRight+ndc.y*uFov.y*uUp);vec3 c;if(ray.y>-.0008){c=sky(ray);}else{float dist=(-1.68-uEye.y)/ray.y;vec3 p=uEye+ray*dist;float t=uTime*.095;vec2 uv=p.xz;vec2 a=texture(uWaves,uv*vec2(.038,.053)+vec2(t*.17,t*.095)).rg*2.-1.;vec2 b=texture(uWaves,uv.yx*vec2(.12,.079)+vec2(-t*.11,t*.22)).gr*2.-1.;vec2 cc=texture(uWaves,uv*vec2(.25,.31)+vec2(t*.24,-t*.19)).rg*2.-1.;float farFade=1./(1.+dist*.0026);vec2 slopes=(a*.105+b*.058+cc*.032)*farFade;vec3 N=normalize(vec3(slopes.x,1.,slopes.y));vec3 R=reflect(ray,N);R.y=max(.009,R.y);float fr=.10+.88*pow(1.-max(.0,dot(N,-ray)),4.3);vec3 reflected=sky(R);if(uHasMirror&&dist<420.){vec4 q=uMirrorVP*vec4(p,1.);vec2 coord=q.xy/q.w*.5+.5+slopes*.045; if(q.w>0.&&all(greaterThan(coord,vec2(.002)))&&all(lessThan(coord,vec2(.998)))){vec4 ref=texture(uMirror,coord);vec3 r=ref.rgb/max(vec3(.02),1.-ref.rgb);reflected=mix(reflected,r,ref.a*.92);}}vec3 sea=mix(vec3(.025,.093,.097),vec3(.068,.181,.182),.5+.5*a.y);c=mix(sea,reflected,fr);vec3 H=normalize(SUN-ray);float shine=pow(max(dot(N,H),0.),mix(220.,950.,farFade));c+=vec3(2.0,1.45,.77)*shine*farFade;c=mix(c,vec3(.57,.65,.64),smoothstep(135.,1400.,dist)*.91);}frag=vec4(displayColor(c),1.);}`;
export const shadowVS = `#version 300 es
layout(location=0) in vec3 aPos;uniform mat4 uVP;void main(){gl_Position=uVP*vec4(aPos,1.);}`;
export const shadowFS = `#version 300 es
precision mediump float;void main(){}`;
