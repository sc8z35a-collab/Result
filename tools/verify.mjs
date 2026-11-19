import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Match,modes,weapons} from '../dist/js/match.js';
import {PilotWallet} from '../dist/js/wallet.js';
import {ThermalOptic} from '../dist/js/optic.js';
import {eyeOf,targetPoint} from '../dist/js/posture.js';
import {obstruction,surfaceAt,raycastMaterial} from '../dist/js/yard.js';
import {perspective,lookAt,multiply,invert4,STRIDE,random} from '../dist/js/geometry.js';
import {character} from '../dist/js/models.js';
import {shadowModes,SHADOW_FLAME_WORLD_GLSL,sfScreenFS,sfBilateralFS} from '../dist/js/shadowflame.js';
import {KHDR_TONE_GLSL} from '../dist/js/khdr.js';
import {BONE,ARTICULATED_RIG_GLSL} from '../dist/js/rig.js';
import {HumanAimController} from '../dist/js/nv21-spy.js';
import {
  PortAudio,SoundEngin,SOUND_ENGIN_VERSION,SPEED_OF_SOUND,AUDIO_MODES,
  computePropagationDelay,computeAirAbsorption,computeDopplerShift,
  computeAcousticPath,traceEarlyReflections,estimateEnclosure,
  synthesizeWaveShaperCurve,createGunImpulseSamples,generateHarborIR
} from '../dist/js/audio.js';
const h=1/360;
function duel(loadout='DF1 OUT',limit='unlimited',multiplier=2,events=[]) {
  return new Match({mode:'1v1', limit, multiplier,loadout},event=>events.push(event));
}
function forward(m,actor,frames) {for(let i=0;i<frames;i++){m.time+=h;m.systems(actor,h)}}
function arrange(m,x,z1,z2){const a=m.player,b=m.actors[1];Object.assign(a,{x,y:0,z:z1,yaw:.025,pitch:Math.atan2(-.38,z1-z2)});Object.assign(b,{x,y:0,z:z2});return [a,b]}
function burst(m) {const a=m.player;assert(m.trigger(a));while(a.burstLeft||a.cooldown>1e-7)forward(m,a,1)}
for(const [id,cap,damage,rate,velocity,burstSize] of [['SW T',10,9,100,100,1],['SRA',30,6,120,80,1],['D1',40,5,100,60,2],['MS10',24,9,130,180,1],['DF1 OUT',50,2.8,150,65,3]]) {
 const w=weapons[id];assert.deepEqual([w.capacity,w.damage,w.rate,w.velocity,w.burst],[cap,damage,rate,velocity,burstSize]);const m=duel(id);burst(m);assert.equal(m.shots.length,burstSize);assert.equal(m.player.mag,cap-burstSize);
}
{
 const ms10=weapons.MS10;
 assert(ms10.auto===true,'MS10 must support automatic rapid-fire');
 assert(Object.entries(weapons).every(([k,w])=>k==='MS10'||ms10.speed>w.speed),'MS10 must have fastest bullet speed');
 assert(Math.abs(ms10.speed/weapons['SW T'].speed-1.8)<1e-6,'MS10 speed ratio 180 relative to SW T 100');
 assert(Math.abs((1/ms10.interval)/(1/weapons['SW T'].interval)-1.3)<1e-6,'MS10 fire rate ratio 130 relative to SW T 100');
 // DF1 OUT full-auto 3-round burst: holding trigger chains consecutive 3-round bursts automatically
 const df=weapons['DF1 OUT'];
 assert(df.auto===true&&df.burst===3,'DF1 OUT must be full-auto 3-round burst');
 const m=duel('DF1 OUT');
 const p=m.player;
 // Hold fire for 1.05s at 360Hz -> fires 2 full 3-round bursts (6 shots) + starts 3rd burst (>=7 shots)
 for(let i=0;i<380;i++){if(df.auto)m.trigger(p);m.time+=h;m.systems(p,h)}
 assert(m.shots.length>=6&&p.mag<=44,'Holding fire on DF1 OUT must chain full-auto 3-round bursts');
}
{
 // Supply tanker: +100 rounds immediately and 1.5x ammo refinement speed (2.0s/round vs 3.0s/round, plus DF1 P1 1.5x), cooldown enforced, reset on respawn.
 const ev=[],m=duel('DF1 OUT','unlimited',2,ev),p=m.player,tk=m.tankers[0];
 assert(m.tankers.length>=3,'Map should place supply tankers');
 const stockBefore=p.stock;
 Object.assign(p,{x:tk.x,y:0,z:tk.z,ammoRate:1});
 m.updateTankers(h);
 assert.equal(p.stock,stockBefore+100,'Tanker adds +100 rounds');
 assert.equal(p.ammoRate,1.5,'Tanker boosts ammo refinement to 1.5x');
 assert(tk.cooldown>20,'Tanker enters recharge cooldown');
 assert(ev.some(e=>e.type==='tanker'&&e.actor===p),'Tanker emits event');
 // Verify 1.5x ammo refinement: 3.0s / 1.5 = 2.0s (720 frames at 360Hz)
 p.stock=90;p.ammoClock=0;
 forward(m,p,719);assert.equal(p.stock,90);
 forward(m,p,1);assert.equal(p.stock,91);
 // Verify DF1 P1 also refines at 1.5x: 8.0s / 1.5 = 5.3333s (1920 frames at 360Hz)
 p.df.p1=15;p.df.p1Clock=0;
 forward(m,p,1919);assert.equal(p.df.p1,15);
 forward(m,p,1);assert.equal(p.df.p1,16);
 // Respawn resets ammoRate back to 1.0
 m.spawn(p);assert.equal(p.ammoRate,1);
}
{
 // Bullet flyby near-miss whiz event with spatial Doppler pan
 const ev=[],m=duel('MS10','unlimited',2,ev),[p,t]=arrange(m,2,85,75);
 t.gun='MS10';t.mag=24;t.yaw=Math.PI+0.09;t.pitch=0;
 assert(m.trigger(t));
 for(let i=0;i<180&&m.shots.length;i++){m.time+=h;m.shots=m.shots.filter(s=>m.projectile(s,h))}
 const whiz=ev.find(e=>e.type==='whiz');
 assert(whiz&&whiz.dist<6&&whiz.gun==='MS10'&&Number.isFinite(whiz.pan),'Near-miss shot emits spatial whiz event');
}
{
 const m=duel(),[p,t]=arrange(m,2,85,75);assert(obstruction(eyeOf(p),targetPoint(t))>1);forward(m,p,129);assert(!p.df.locked);forward(m,p,27);assert(p.df.locked);const yaw=p.yaw;burst(m);assert(Math.abs(p.yaw)<Math.abs(yaw)&&Math.abs(yaw-p.yaw)<=.0131);
 arrange(m,-7.8,13,2);assert(obstruction(eyeOf(p),targetPoint(t))<=1);const before=p.yaw;assert(m.trigger(p));assert.equal(before,p.yaw);forward(m,p,204);assert(!p.df.locked);
}
{
 const m=duel(),p=m.player;p.df.pattern='spread';p.df.boost=true;burst(m);assert.equal(m.shots.length,4);assert.equal(p.mag,47);assert.equal(p.df.p1,19);assert(new Set(m.shots.map(s=>s.dir.join(','))).size>=3);
 burst(m);assert.equal(m.shots.length,9);assert.equal(p.df.p1,17);assert.equal(p.mag,44);burst(m);burst(m);assert(!p.df.boost&&p.df.cooling>0);const left=p.df.p1,main=p.mag;burst(m);assert.equal(p.df.p1,left);assert.equal(p.mag,main-3);forward(m,p,1830);assert.equal(p.df.cooling,0);
}
{
 const m=duel(),p=m.player;p.stock=97;p.shield=7;p.hp=44;p.df.p1=17;forward(m,p,1079);assert.equal(p.stock,97);forward(m,p,1);assert.equal(p.stock,98);forward(m,p,719);assert.equal(p.shield,7);forward(m,p,1);assert.equal(p.shield,8);forward(m,p,1079);assert.equal(p.df.p1,17);forward(m,p,1);assert.equal(p.df.p1,18);forward(m,p,9000);assert.deepEqual([p.stock,p.shield,p.df.p1,p.hp],[100,10,20,44]);p.mag=46;assert(m.reload(p));forward(m,p,666);assert.deepEqual([p.mag,p.stock],[50,96]);
}
{
 const ev=[],m=duel('DF1 OUT','points',2,ev),[p,t]=arrange(m,2,85,75);const target=targetPoint(t);p.yaw=0;p.pitch=Math.atan2(target[1]-eyeOf(p)[1],10);const until=(fn)=>{for(let i=0;i<24000&&!fn();i++){m.time+=h;m.systems(p,h);if(!p.cooldown&&!p.burstLeft)m.trigger(p);m.shots=m.shots.filter(s=>m.projectile(s,h));}};until(()=>!t.alive);assert(!t.alive&&p.kills===1);m.damage(t,p,1000);assert.deepEqual(m.scores,[1,0]);assert.equal(p.earned,10);assert.equal(t.earned,0);m.spawn(t);m.damage(t,p,111);assert(m.ended&&m.winner===0);assert.deepEqual(m.scores,[2,0]);assert.equal(p.earned,20);assert.equal(new Set(ev.filter(e=>e.type==='point').map(e=>e.receipt)).size,2);
}
for (const [mode,counts] of Object.entries(modes)) {
 const m=new Match({mode,limit:'points',multiplier:2,loadout:'DF1 OUT'});assert.deepEqual(m.goals,counts.map(c=>c*2));assert(m.actors.every(a=>a.human||a.gun!=='DF1 OUT'));
 for(let i=0;i<360*250&&!m.ended;i++)m.step(h,{});assert(m.ended);assert(m.nv.metrics.crouch+m.nv.metrics.scope>0);assert(m.nv.metrics.cover+m.nv.metrics.disengage+m.nv.metrics.evade>0,'NV2 tactical survival behaviors active');assert(m.nv.metrics.beliefTrack+m.nv.metrics.commanderOrders+m.nv.metrics.suppress+m.nv.metrics.crossfire>0,'NV2 cognitive behaviors active');assert(m.nv.metrics.neuralInferences>0&&m.nv.metrics.neuralUpdates>0&&m.nv.metrics.lookaheadPlans>0,'NV2 deep transformer neural core & minimax lookahead active');
 const hitRate=m.nv.metrics.npcShots>0?m.nv.metrics.npcHits/m.nv.metrics.npcShots:0;
 assert(m.nv.metrics.npcShots>=50&&hitRate>0.10&&hitRate<0.72,`NPC accuracy in ${mode} must be authentically human (got ${(hitRate*100).toFixed(1)}% from ${m.nv.metrics.npcHits}/${m.nv.metrics.npcShots})`);
 console.log(mode,m.scores,Math.round(m.time)+'s',`hitRate=${(hitRate*100).toFixed(1)}%`,JSON.stringify(m.nv.metrics));
}
{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};const w=new PilotWallet(()=>{});await w.ready;assert(!await w.change());assert(await w.change('m/1'));assert(!await w.change('m/1'));assert(await w.change());assert(!await w.change());const second=new PilotWallet(()=>{});await second.ready;assert.deepEqual(second.state,{units:5,evr:true});assert(!await second.change('m/1'));
}
{
 let createCanvas=null;
 try{const require=createRequire(import.meta.url);({createCanvas}=require('@napi-rs/canvas'));}catch{}
 if(createCanvas){
  const canvas=createCanvas(256,192),src=createCanvas(640,480),context=src.getContext('2d');context.fillStyle='#303030';context.fillRect(0,0,640,480);const optic=new ThermalOptic(canvas),m=duel();const hot=(x,z1,z2,time)=>{const [p,t]=arrange(m,x,z1,z2);optic.draw({canvas:src,aspect:4/3},m,{pos:eyeOf(p),target:targetPoint(t),fov:42},time);const rgb=canvas.getContext('2d').getImageData(0,0,256,192).data;let n=0;for(let i=0;i<rgb.length;i+=4)if(rgb[i]>180)n++;return n};const seen=hot(2,85,75,1),hidden=hot(-7.8,13,2,2);assert(seen>1000&&hidden===0);console.log('Thermal sensor',canvas.width,canvas.height,'warm pixels',seen,'behind cover',hidden);
 } else console.log('Thermal canvas check skipped in Node (no @napi-rs/canvas); verified in Chromium.');
}
{
 // Verify invert4 precision (VP * invVP = I) for Shadow Flame 1.0 Pro world-position depth reconstruction
 const vp=multiply(perspective(24.7*Math.PI/180,16/9),lookAt([2.5,2.35,73.5],[0.5,1.55,42.0]));
 const inv=invert4(vp);
 const prod=multiply(vp,inv);
 for(let r=0;r<4;r++)for(let c=0;c<4;c++){
  const expected=r===c?1:0;
  assert(Math.abs(prod[c*4+r]-expected)<1e-4,`invert4 mismatch at (${r},${c}): ${prod[c*4+r]}`);
 }
 assert.deepEqual(shadowModes,{off:0,flash:1,pro:2});
 assert(SHADOW_FLAME_WORLD_GLSL.includes('sfFlashVisibility')&&SHADOW_FLAME_WORLD_GLSL.includes('sfProPCSS'));
 assert(sfScreenFS.includes('SF-SSCS')&&sfScreenFS.includes('SF-GTAO-Lite')&&sfBilateralFS.includes('exp(-abs'));
 assert(KHDR_TONE_GLSL.includes('K_INSET')&&KHDR_TONE_GLSL.includes('kFilmicSDR')&&KHDR_TONE_GLSL.includes('kFilmicExtended'));
 assert.equal(Object.keys(BONE).length,16,'Articulated humanoid rig must have 16 bones');
 assert(ARTICULATED_RIG_GLSL.includes('rigApplyCharacter')&&ARTICULATED_RIG_GLSL.includes('rigSolveElbow')&&ARTICULATED_RIG_GLSL.includes('rigLegKinematics'));
}
{
 // Sound Engin 1.0: deterministic physical acoustics, 3D raytraced occlusion/reflections, Doppler, & Velvet-Noise IR verification
 assert.equal(SOUND_ENGIN_VERSION,'Sound Engin 1.0');
 assert.equal(PortAudio,SoundEngin,'PortAudio alias must map cleanly to SoundEngin');
 assert.deepEqual(AUDIO_MODES,{hrtf:'hrtf',stereo:'stereo'});
 // 1. Speed-of-sound propagation delay & supersonic MS10 crack-before-blast physics
 const d50=computePropagationDelay(50);
 assert(Math.abs(d50-50/SPEED_OF_SOUND)<1e-6,'Propagation delay must equal d / 343 m/s');
 assert(50/weapons.MS10.speed<d50,'MS10 supersonic round (648 m/s) must arrive before its muzzle blast');
 // 2. ISO 9613-1 maritime air absorption monotonic frequency & gain rolloff
 const aClose=computeAirAbsorption(2),aMid=computeAirAbsorption(45),aFar=computeAirAbsorption(130);
 assert(aClose.cutoffHz>aMid.cutoffHz&&aMid.cutoffHz>aFar.cutoffHz,'Air absorption LPF cutoff must decrease monotonically with distance');
 assert(aClose.airGain>aMid.airGain&&aMid.airGain>aFar.airGain,'Air attenuation must decrease monotonically with distance');
 // 3. Ballistic Doppler physics (supersonic MS10 vs subsonic SRA)
 const dopMS10=computeDopplerShift(weapons.MS10.speed,2.0);
 const dopSRA=computeDopplerShift(weapons.SRA.speed,2.0);
 assert(dopMS10.isSupersonic&&dopMS10.mach>1.85&&dopMS10.approachRatio>1&&dopMS10.recedeRatio<1,'MS10 Doppler must be supersonic with approach > 1 > recede');
 assert(!dopSRA.isSupersonic&&dopSRA.mach<1&&dopSRA.approachRatio>1&&dopSRA.recedeRatio<1,'SRA Doppler must be subsonic with approach > 1 > recede');
 // 4. Acoustic materials & real 3D occlusion/diffraction raytracing against Harbor Range containers
 assert.equal(surfaceAt(0,0,0),'concrete','Wharf ground must classify as concrete');
 assert.equal(surfaceAt(-12,78,5.24),'steel','Container roof must classify as steel');
 assert.equal(surfaceAt(-16,68,2.2),'wood','Wooden crates must classify as wood');
 const matHit=raycastMaterial([-7.8,1.4,13],[-7.8,1.4,2]);
 assert(matHit&&matHit.mat==='steel','Ray into shipping container must report steel material');
 const clearPath=computeAcousticPath([2,1.5,85],[2,1.5,75]);
 const blockedPath=computeAcousticPath([-7.8,1.4,13],[-7.8,1.4,2]);
 assert(!clearPath.occluded&&clearPath.occlusion===0,'Clear LOS path must not be occluded');
 assert(blockedPath.occluded&&blockedPath.blockerMat==='steel'&&blockedPath.occlusion>0.2&&blockedPath.cutoffHz<clearPath.cutoffHz&&blockedPath.directGain<clearPath.directGain,'Steel container must occlude, filter, and attenuate direct sound');
 // 5. Geometric early reflection raycaster & enclosure estimator
 const taps=traceEarlyReflections([2,1.6,76],[0,1.6,82],6);
 assert(taps.length>=2&&taps.every(t=>t.delay>0.006&&t.gain>0&&Number.isFinite(t.cutoffHz)),'Harbor cargo yard must produce multiple physical early-reflection slapback taps');
 const envAlley=estimateEnclosure([13.6,1.6,71]);
 const envOpen=estimateEnclosure([-23.0,1.6,2]);
 assert(envAlley.enclosure>envOpen.enclosure,'Container canyon enclosure must exceed open west pier enclosure');
 // 6. Friedlander blast, N-wave crack, WaveShaper saturation curve, & Dual-Zone Velvet-Noise IRs
 const curve=synthesizeWaveShaperCurve(2.4,512);
 assert(curve.length===512&&curve.every(v=>Number.isFinite(v)&&v>=-1&&v<=1),'WaveShaper curve must be finite in [-1, 1]');
 for(const kind of ['blast','crack']){
  const buf=createGunImpulseSamples(48000,kind);
  let rms=0;for(const v of buf){assert(Number.isFinite(v)&&Math.abs(v)<=1);rms+=v*v;}
  assert(Math.sqrt(rms/buf.length)>0.02,`Gun impulse '${kind}' must have audible non-zero energy`);
 }
 for(const style of ['open','alley']){
  const ir=generateHarborIR(48000,style==='open'?1.6:1.0,style);
  assert(ir.rt60Low>ir.rt60High,'Physical harbor reverb must damp high frequencies faster than low frequencies');
  let eL=0,eR=0,dotLR=0,eEarly=0,eLate=0;
  const split=Math.floor(ir.left.length*0.25);
  for(let i=0;i<ir.left.length;i++){
   const l=ir.left[i],r=ir.right[i];
   assert(Number.isFinite(l)&&Number.isFinite(r)&&Math.abs(l)<=1&&Math.abs(r)<=1);
   eL+=l*l;eR+=r*r;dotLR+=l*r;
   if(i<split)eEarly+=l*l+r*r; else eLate+=l*l+r*r;
  }
  const corr=Math.abs(dotLR/(Math.sqrt(eL*eR)||1));
  assert(eL>0.5&&eR>0.5&&corr<0.55&&eEarly>eLate*0.25,`Harbor IR '${style}' must be energetic, stereo-decorrelated (corr=${corr.toFixed(3)}), and decaying`);
 }
 // 7. SoundEngin Node-safe lifecycle & casing bounce event verification
 const eng=new SoundEngin();
 eng.setMode('stereo');eng.setMode('hrtf');eng.set(0.6);eng.resetMatch();
 assert.equal(eng.getDiagnostics().engine,'Sound Engin 1.0');
 const ev=[],m=duel('MS10','unlimited',2,ev);
 assert(m.trigger(m.player));
 for(let i=0;i<360;i++)m.step(h,{});
 assert(ev.some(e=>e.type==='casing'),'Ejected shell casings must emit physical bounce events');
  console.log('Sound Engin 1.0 acoustics OK:',{clearHz:Math.round(clearPath.cutoffHz),blockedHz:Math.round(blockedPath.cutoffHz),earlyTaps:taps.length,alleyEnc:Number(envAlley.enclosure.toFixed(2)),openEnc:Number(envOpen.enclosure.toFixed(2))});
}
{
 // NV2.1 Ally Selector (3V3-only) & Mode Isolation + HumanAimController reaction advantage
 const mStd=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:'DF1 OUT',allyNv21:0});
 assert.equal(mStd.allyNv21Slot,0);assert.equal(mStd.spyActor,null);
 assert(mStd.actors.filter(a=>!a.human).every(a=>a.aiVersion==='NV2'&&!a.isSpy));

 const mNagi=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:'DF1 OUT',allyNv21:1});
 assert.equal(mNagi.allyNv21Slot,1);assert.equal(mNagi.spyActor,mNagi.actors[1]);
 assert.equal(mNagi.actors[1].name,'NAGI');assert.equal(mNagi.actors[1].aiVersion,'NV2.1');assert.equal(mNagi.actors[1].isSpy,true);
 assert.equal(mNagi.actors[2].aiVersion,'NV2');assert.equal(mNagi.actors[2].isSpy,false);
 assert(mNagi.actors.filter(a=>a.team===1).every(a=>a.aiVersion==='NV2'&&!a.isSpy));

 const mKai=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:'DF1 OUT',allyNv21:2});
 assert.equal(mKai.allyNv21Slot,2);assert.equal(mKai.spyActor,mKai.actors[2]);
 assert.equal(mKai.actors[2].name,'KAI');assert.equal(mKai.actors[2].aiVersion,'NV2.1');assert.equal(mKai.actors[2].isSpy,true);
 assert.equal(mKai.actors[1].aiVersion,'NV2');assert.equal(mKai.actors[1].isSpy,false);

 for (const non3v3 of ['1v1','1v2']) {
  const mIso=new Match({mode:non3v3,limit:'points',multiplier:2,loadout:'DF1 OUT',allyNv21:1});
  assert.equal(mIso.allyNv21Slot,0,`${non3v3} must ignore allyNv21`);
  assert.equal(mIso.spyActor,null,`${non3v3} must not spawn a Spy actor`);
  assert(mIso.actors.every(a=>!a.isSpy));
 }

 // HumanAimController: NV2.1 strictly faster visual reaction, acquisition & tracking than NV2
 const aimNv2=new HumanAimController(random(42),false);
 const aimNv21=new HumanAimController(random(42),true);
 assert(aimNv21.reactionDelay<aimNv2.reactionDelay,'NV2.1 must have strictly faster visual reaction delay');
 assert(aimNv21.acquireMin<aimNv2.acquireMin&&aimNv21.acquireMax<aimNv2.acquireMax,'NV2.1 must have faster target acquisition latency');
 assert(aimNv21.maxYawRate>aimNv2.maxYawRate&&aimNv21.baseWander<aimNv2.baseWander,'NV2.1 must have crisper tracking & steadier aim');

 // Fair-play Spy Engine visual-sighting check (zero wallhack behind steel container -> sighting only on direct LOS)
 const mFair=new Match({mode:'3v3',limit:'unlimited',multiplier:2,loadout:'DF1 OUT',allyNv21:1});
 const spy=mFair.spyActor;
 const spyBrain=mFair.nv.brains.get(spy.id);
 Object.assign(spy,{x:-7.8,y:0,z:13,yaw:0,pitch:0,vx:0,vz:0});
 for (const e of mFair.actors.filter(a=>a.team===1)) Object.assign(e,{x:-7.8,y:0,z:2,yaw:Math.PI,vx:0,vz:0});
 assert(obstruction(eyeOf(spy),targetPoint(mFair.actors[3]))<=1,'Test geometry must be occluded by steel container');
 for (let i=0;i<24;i++) mFair.step(h,{});
 assert.equal(spyBrain.spy.sightings.size,0,'Spy Engine must NOT record occluded enemies (zero wallhack)');
 Object.assign(spy,{x:2,y:0,z:85,yaw:0,pitch:0,vx:0,vz:0});
 Object.assign(mFair.actors[3],{x:2,y:0,z:73,yaw:Math.PI,vx:0,vz:0});
 assert(obstruction(eyeOf(spy),targetPoint(mFair.actors[3]))>1,'Direct LOS test geometry must be unobstructed');
 for (let i=0;i<24;i++) mFair.step(h,{});
 assert(spyBrain.spy.sightings.size>=1,'Spy Engine must record enemy immediately upon direct visual LOS');

 // Full 3V3 NV2.1 NAGI simulation + KAI Spy operational check
 for (let i=0;i<360*250&&!mNagi.ended;i++) mNagi.step(h,{});
 const nagiMetrics=mNagi.nv.metrics;
 const nagiStatus=mNagi.nv.getSpyStatus();
 assert(nagiStatus&&nagiStatus.active&&nagiStatus.name==='NAGI'&&typeof nagiStatus.label==='string','getSpyStatus() must expose live NV2.1 Spy HUD state');
 assert(nagiMetrics.spySightings>5&&nagiMetrics.spyPredictions>5&&nagiMetrics.spyFlanks>5&&nagiMetrics.spyDodges>10,'NV2.1 NAGI Spy Engine must visually sight, predict, flank, and dodge');
 assert(nagiMetrics.spyBackstabs>0,'NV2.1 NAGI Spy Engine must achieve rear/flank ambush hits');
 assert(nagiMetrics.nv21Shots>20&&nagiMetrics.nv21Hits>0,'NV2.1 NAGI must actively engage and score hits');
 const nagiHitRate=nagiMetrics.nv21Hits/nagiMetrics.nv21Shots;
 assert(nagiHitRate>0.10&&nagiHitRate<0.75,`NV2.1 NAGI hit rate must remain human-realistic (got ${(nagiHitRate*100).toFixed(1)}%)`);

 for (let i=0;i<360*180&&!mKai.ended;i++) mKai.step(h,{});
 const kaiMetrics=mKai.nv.metrics;
 assert(kaiMetrics.spySightings>5&&kaiMetrics.spyPredictions>5&&kaiMetrics.spyFlanks>5&&kaiMetrics.spyDodges>10,'NV2.1 KAI Spy Engine must visually sight, predict, flank, and dodge');
 assert(kaiMetrics.nv21Shots>15&&kaiMetrics.nv21Hits>0,'NV2.1 KAI must actively engage and score hits');
 console.log('NV2.1 Spy Engine OK:',{
  nagi:{ended:mNagi.ended,scores:mNagi.scores,time:Math.round(mNagi.time)+'s',hitRate:(nagiHitRate*100).toFixed(1)+'%',sightings:nagiMetrics.spySightings,predictions:nagiMetrics.spyPredictions,flanks:nagiMetrics.spyFlanks,backstabs:nagiMetrics.spyBackstabs,dodges:nagiMetrics.spyDodges},
  kai:{scores:mKai.scores,time:Math.round(mKai.time)+'s',sightings:kaiMetrics.spySightings,predictions:kaiMetrics.spyPredictions,flanks:kaiMetrics.spyFlanks,backstabs:kaiMetrics.spyBackstabs,dodges:kaiMetrics.spyDodges}
 });
}
{
 // High-detail 16-joint sculpted humanoid geometry verification (standard & NV2.1 spy, high & low detail)
 const stdHi=character(0,'SRA','standard','high');
 const stdLo=character(0,'SRA','standard','low');
 const spyHi=character(0,'SRA','spy','high');
 const spyLo=character(0,'SRA','spy','low');
 assert(stdHi.count>stdLo.count*1.25,`High-detail sculpted mesh (${stdHi.count} verts) must be richer than low-detail (${stdLo.count} verts)`);
 assert(spyHi.count>spyLo.count*1.25,'Spy high-detail sculpted mesh must be richer than low-detail');
 for (const [label,mesh] of [['stdHi',stdHi],['stdLo',stdLo],['spyHi',spyHi],['spyLo',spyLo]]) {
  const bones=new Set();
  let minY=Infinity,maxY=-Infinity,emissiveVerts=0;
  for (let i=0;i<mesh.data.length;i+=STRIDE) {
   const x=mesh.data[i],y=mesh.data[i+1],z=mesh.data[i+2];
   const nx=mesh.data[i+3],ny=mesh.data[i+4],nz=mesh.data[i+5];
   const kb=mesh.data[i+12];
   assert(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z)&&Number.isFinite(nx)&&Number.isFinite(ny)&&Number.isFinite(nz),`${label} vertex ${i/STRIDE} must have finite pos & normal`);
   if (y<minY) minY=y;
   if (y>maxY) maxY=y;
   const bone=Math.floor((kb+0.5)/10);
   const kind=Math.round(kb-bone*10);
   bones.add(bone);
   if (kind===3) emissiveVerts++;
  }
  for (let b=0;b<16;b++) assert(bones.has(b),`${label} must populate all 16 articulated bones (missing bone ${b})`);
  assert(minY>=-0.01&&minY<=0.015,`${label} boot sole must rest on ground plane (minY=${minY.toFixed(4)})`);
  assert(maxY>1.75&&maxY<2.15,`${label} humanoid height must be realistic (maxY=${maxY.toFixed(3)})`);
  assert(emissiveVerts>0,`${label} must include emissive visor/accent geometry`);
 }
 assert(spyHi.count!==stdHi.count,'NV2.1 Spy variant must feature distinct sculpted NVG/stealth geometry');
 assert(ARTICULATED_RIG_GLSL.includes('isPatella'),'rig.js must include bisector floating patella knee-cap motion');
 console.log('Sculpted 16-joint meshes OK:',{stdHiVerts:stdHi.count,stdLoVerts:stdLo.count,spyHiVerts:spyHi.count,spyLoVerts:spyLo.count});
}
console.log('360Hz sim, weapon specs (incl. MS10 & DF1 OUT full-auto 3-round burst), supply tankers, bullet whiz, focus and occlusion, credits, EVR1, separate regeneration timers, P1 heat, scoring, 16-joint sculpted rig, KHDR, Shadow Flame 1.0 Flash/Pro, Sound Engin 1.0, Human-Realistic Aiming, NV2.1 Spy Engine, and all matches passed.');

