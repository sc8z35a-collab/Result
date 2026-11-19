import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Match,modes,weapons,npcWeapons} from '../dist/js/match.js';
import {ARV1_VERSION,ARV1_ASSIST_STRENGTH,ARV1_LAUNCH_GAIN,ARV1_LAUNCH_STEP,ARV1_LOCK_ACQUIRE,ARV1_LOCK_HOLD} from '../dist/js/df1.js';
import {RD40_AA_VERSION,RD40_ASSIST_STRENGTH,RD40_LOCK_ACQUIRE,RD40_LOCK_HOLD,RD40_D01_DURATION} from '../dist/js/rd40.js';
import {PilotWallet} from '../dist/js/wallet.js';
import {ThermalOptic} from '../dist/js/optic.js';
import {eyeOf,targetPoint} from '../dist/js/posture.js';
import {obstruction,surfaceAt,raycastMaterial} from '../dist/js/yard.js';
import {perspective,lookAt,multiply,invert4,STRIDE,random,forward as forwardVec,dot,unit,sub} from '../dist/js/geometry.js';
import {buildHarbor} from '../dist/js/harbor.js';
import {character,viewModel,movingDetails,muzzleFlashMesh} from '../dist/js/models.js';
import {effectiveSize} from '../dist/js/renderer.js';
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
function arrange(m,x,z1,z2){const a=m.player,b=m.actors[1];Object.assign(a,{x,y:0,z:z1,yaw:.025,pitch:Math.atan2(-.38,z1-z2)});Object.assign(b,{x,y:0,z:z2,vx:0,vy:0,vz:0});return [a,b]}
function burst(m) {const a=m.player;assert(m.trigger(a));while(a.burstLeft||a.cooldown>1e-7)forward(m,a,1)}
for(const [id,cap,damage,rate,velocity,burstSize,shotsPerTrigger] of [['SW T',10,9,100,100,1,1],['SRA',30,6,120,80,1,1],['D1',40,5,100,60,2,2],['MS10',24,9,130,180,1,1],['DF1 OUT',95,2.8,300,65,3,3],['RD40',130,3,170,140,1,2]]) {
 const w=weapons[id];assert.deepEqual([w.capacity,w.damage,w.rate,w.velocity,w.burst],[cap,damage,rate,velocity,burstSize]);const m=duel(id);burst(m);assert.equal(m.shots.length,shotsPerTrigger);assert.equal(m.player.mag,cap-shotsPerTrigger);
}
{
 const ms10=weapons.MS10;
 assert(ms10.auto===true,'MS10 must support automatic rapid-fire');
 assert(Object.entries(weapons).every(([k,w])=>k==='MS10'||ms10.speed>w.speed),'MS10 must have fastest bullet speed');
 assert(Math.abs(ms10.speed/weapons['SW T'].speed-1.8)<1e-6,'MS10 speed ratio 180 relative to SW T 100');
 assert(Math.abs((1/ms10.interval)/(1/weapons['SW T'].interval)-1.3)<1e-6,'MS10 fire rate ratio 130 relative to SW T 100');
 // DF1 OUT full-auto 3-round burst at 2x fire rate (rate=300, interval=0.08s) and 95-round magazine
 const df=weapons['DF1 OUT'];
 assert(df.auto===true&&df.burst===3&&df.capacity===95&&df.rate===300,'DF1 OUT must be 95-round full-auto 3-round burst at 2x rate');
 assert(Math.abs(df.interval-0.08)<1e-6,'DF1 OUT shot interval must be 0.08s (exact 2x rate)');
 const m=duel('DF1 OUT');
 const p=m.player;
 // Hold fire for 1.05s at 360Hz -> 2x fire rate chains >=12 shots from 95-round mag
 for(let i=0;i<380;i++){if(df.auto)m.trigger(p);m.time+=h;m.systems(p,h)}
 assert(m.shots.length>=12&&p.mag<=83,`Holding fire on DF1 OUT 2x must chain >=12 shots (got ${m.shots.length}, mag=${p.mag})`);
}
{
 // RD40: Player-only twin-linked full-auto (2 simultaneous shots, 3 dmg each, 130 mag, vel 140, rate 170)
 // + Auto-Aim 1.2 (1.92x, 1.4x lock acquire range, expanded lock hold tracking cone) + D01 SENSOR behind-wall tracking!
 const rd=weapons.RD40;
 assert(rd.playerOnly===true&&!npcWeapons.includes('RD40'),'RD40 must be strictly player-only');
 assert(rd.auto===true&&rd.pellets===2&&rd.damage===3&&rd.capacity===130&&rd.velocity===140&&rd.rate===170);
 assert(Math.abs(rd.speed/weapons['SW T'].speed-1.4)<1e-6,'RD40 bullet velocity must be 140 ratio (504 m/s)');
 assert(Math.abs((1/rd.interval)/(1/weapons['SW T'].interval)-1.7)<1e-6,'RD40 fire rate must be 170 ratio');
 assert.equal(RD40_AA_VERSION,'1.2');
 assert(Math.abs(RD40_ASSIST_STRENGTH-1.92)<1e-6,'Auto-Aim 1.2 strength must be 1.6 * 1.2 = 1.92');
 assert(Math.abs(RD40_LOCK_ACQUIRE/ARV1_LOCK_ACQUIRE-1.4)<1e-6,'RD40 lock acquire range must be exact 1.4x ARV1.1');
 assert(RD40_LOCK_HOLD>ARV1_LOCK_HOLD*1.7,'RD40 lock hold tracking cone must be significantly expanded');

 // 1. Simultaneous 2-round full-auto firing + 1-round final mag edge case
 const mAuto=duel('RD40'),pAuto=mAuto.player;
 assert(mAuto.trigger(pAuto));
 assert.equal(mAuto.shots.length,2,'Single RD40 trigger must emit 2 simultaneous bullets');
 assert.equal(pAuto.mag,128,'Single twin salvo must consume 2 rounds from 130-round mag');
 assert(mAuto.shots.every(s=>s.damage===3&&Math.abs(s.speed-504)<1e-6));
 for(let i=0;i<220;i++){mAuto.trigger(pAuto);mAuto.time+=h;mAuto.systems(pAuto,h)}
 assert(mAuto.shots.length>=10&&pAuto.mag<=120,'Holding full-auto on RD40 must chain simultaneous 2-round salvos at rate 170');
 pAuto.mag=1;pAuto.cooldown=0;const beforeLast=mAuto.shots.length;
 assert(mAuto.trigger(pAuto));
 assert.equal(mAuto.shots.length,beforeLast+1,'Final 1 round in RD40 mag must fire cleanly without going negative');
 assert.equal(pAuto.mag,0);

 // 2. 1.4x expanded lock cone: offset 0.125 rad is outside DF1 OUT (0.1035 rad) yet inside RD40 (0.1449 rad)!
 const mDfCone=duel('DF1 OUT'),[pDfC,tDfC]=arrange(mDfCone,2,85,73);
 pDfC.yaw=0.125;forward(mDfCone,pDfC,180);
 assert(!pDfC.df.locked,'DF1 OUT should NOT lock outside its 0.1035 rad cone');
 const mRdCone=duel('RD40'),[pRdC,tRdC]=arrange(mRdCone,2,85,73);
 pRdC.yaw=0.125;forward(mRdCone,pRdC,110);
 assert(pRdC.rd.locked&&pRdC.rd.focusId===tRdC.id,'RD40 1.4x expanded lock cone MUST lock cleanly at 0.125 rad');

 // 3. Expanded lock-tracking hold cone (0.19 rad > ARV1_LOCK_HOLD 0.1446 rad) + twin Auto-Aim 1.2 guided bullets
 pRdC.yaw=0.19;forward(mRdCone,pRdC,12);
 assert(pRdC.rd.locked,'RD40 expanded lock hold cone must NOT drop lock at 0.19 rad');
 assert(pRdC.yaw<0.188,'RD40 Auto-Aim 1.2 smooth tracking must pull aim smoothly toward locked target');
 mRdCone.shots.length=0;pRdC.cooldown=0;
 assert(mRdCone.trigger(pRdC));
 assert.equal(mRdCone.shots.length,2);
 assert(mRdCone.shots.every(s=>s.guided&&s.homingTargetId===tRdC.id),'Both twin RD40 bullets must be Auto-Aim 1.2 guided');

 // 4. D01 SENSOR: sustains lock & smoothly tracks aim even when target ducks behind a steel container, for finite RD40_D01_DURATION (4.0s)!
 const mD01=duel('RD40'),[pD,tD]=arrange(mD01,2,85,75);
 forward(mD01,pD,110);
 assert(pD.rd.locked&&!pD.rd.d01Active,'RD40 starts with direct LOS lock');
 // Teleport pair across a solid steel container (occluded LOS!)
 Object.assign(pD,{x:-7.8,y:0,z:13,yaw:0,pitch:0});
 Object.assign(tD,{x:-7.8,y:0,z:2,vx:0,vz:0});
 assert(obstruction(eyeOf(pD),targetPoint(tD))<=1,'Test geometry must be occluded by steel container');
 forward(mD01,pD,36); // 0.1s behind wall
 assert(pD.rd.locked&&pD.rd.occluded&&pD.rd.d01Active&&pD.rd.d01Timer>3.5&&pD.rd.d01Timer<RD40_D01_DURATION,'D01 SENSOR must activate and keep lock behind cover');
 // Shift enemy laterally behind the steel container and verify D01 SENSOR aim smoothly follows them!
 tD.x=-6.6;
 const yawBeforeTrack=pD.yaw;
 forward(mD01,pD,120); // 0.33s tracking behind wall
 assert(pD.rd.locked&&pD.rd.d01Active,'D01 SENSOR must maintain lock while enemy strafes behind wall');
 assert(pD.yaw>yawBeforeTrack+0.03,'D01 SENSOR must smoothly track aim toward moving enemy behind wall');
 // Advance past finite 4.0s D01 SENSOR window behind cover -> lock must expire cleanly!
 forward(mD01,pD,1500); // >4.1s additional behind wall
 assert(!pD.rd.locked&&!pD.rd.d01Active&&pD.rd.focusId===-1,'D01 SENSOR behind-wall tracking must expire after finite duration');

 // 5. RD40 viewmodel & twin-barrel muzzle flash geometry finite check
 const vmRd=viewModel('RD40'),mfRd=muzzleFlashMesh('RD40',1,1,true,false),mfRdLite=muzzleFlashMesh('RD40',1,1,false,true);
 assert(vmRd.count>400&&mfRd.count>mfRdLite.count&&mfRdLite.count>0);
 for(const mesh of [vmRd,mfRd,mfRdLite]) for(let i=0;i<mesh.data.length;i+=STRIDE) assert(Number.isFinite(mesh.data[i])&&Number.isFinite(mesh.data[i+1])&&Number.isFinite(mesh.data[i+2]));
 // 6. Ensure NPCs never equip RD40 in 3v3
 const m3=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:'RD40'});
 assert(m3.player.gun==='RD40'&&m3.actors.filter(a=>!a.human).every(a=>a.gun!=='RD40'&&a.gun!=='DF1 OUT'));
}
{
 // Supply tanker: +100 rounds immediately and 1.5x ammo refinement speed (0.6667s/round vs 1.0s/round, plus DF1 P1 1.5x), cooldown enforced, reset on respawn.
 const ev=[],m=duel('DF1 OUT','unlimited',2,ev),p=m.player,tk=m.tankers[0];
 assert(m.tankers.length>=3,'Map should place supply tankers');
 const stockBefore=p.stock;
 Object.assign(p,{x:tk.x,y:0,z:tk.z,ammoRate:1});
 m.updateTankers(h);
 assert.equal(p.stock,stockBefore+100,'Tanker adds +100 rounds');
 assert.equal(p.ammoRate,1.5,'Tanker boosts ammo refinement to 1.5x');
 assert(tk.cooldown>20,'Tanker enters recharge cooldown');
 assert(ev.some(e=>e.type==='tanker'&&e.actor===p),'Tanker emits event');
 // Verify 1.5x ammo refinement on 1s/round base: 1.0s / 1.5 = 2/3 s = 240 frames at 360Hz
 p.stock=90;p.ammoClock=0;
 forward(m,p,239);assert.equal(p.stock,90);
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
 // DF1 OUT ARV1.1 bullet-side auto-aim (1.6x * 1.1 = 1.76x, ZERO camera mutation, kinematic lead prediction, 360Hz homing & occlusion safety)
 assert.equal(ARV1_VERSION,'1.1');
 assert(Math.abs(ARV1_ASSIST_STRENGTH-1.76)<1e-6,'ARV1.1 strength must be 1.6 * 1.1 = 1.76');
 assert(Math.abs(ARV1_LAUNCH_GAIN-0.4928)<1e-6&&Math.abs(ARV1_LAUNCH_STEP-0.02288)<1e-6);
 const m=duel(),[p,t]=arrange(m,2,85,75);
 assert(obstruction(eyeOf(p),targetPoint(t))>1);
 forward(m,p,118);assert(!p.df.locked,'ARV1.1 focus should still be locking before 0.36s');
 forward(m,p,20);assert(p.df.locked,'ARV1.1 must acquire focus lock cleanly');
 const yaw0=p.yaw,pitch0=p.pitch;
 const rawDir=forwardVec(yaw0,pitch0);
 const toTarget=unit(sub(targetPoint(t),eyeOf(p)));
 assert(m.trigger(p));
 assert.equal(p.yaw,yaw0,'ARV1.1 bullet-side auto-aim must NOT mutate player camera yaw');
 assert.equal(p.pitch,pitch0,'ARV1.1 bullet-side auto-aim must NOT mutate player camera pitch');
 const s0=m.shots[0];
 assert(s0&&s0.guided&&s0.homingTargetId===t.id,'Locked DF1 OUT shot must be bullet-guided toward target');
 assert(dot(s0.dir,toTarget)>dot(rawDir,toTarget)+1e-4,'Bullet launch vector must deflect closer to target than raw camera aim');
 // Step bullet in flight: verify 360Hz geodesic homing curve + curved trail recording
 for(let i=0;i<14&&m.shots.includes(s0);i++){m.time+=h;m.projectile(s0,h)}
 assert(s0.homingTurned>0&&s0.trail.length>=2,'Guided DF1 OUT bullet must curve smoothly in flight and record curved trail');
 // Verify ARV1.1 kinematic velocity lead prediction shifts launch direction toward moving enemy trajectory
 const mLead=duel(),[pL,tL]=arrange(mLead,2,85,72);
 assert(obstruction(eyeOf(pL),targetPoint(tL))>1);
 forward(mLead,pL,145);assert(pL.df.locked);
 assert(mLead.trigger(pL));const staticDirX=mLead.shots[0].dir[0];
 const mLead2=duel(),[pL2,tL2]=arrange(mLead2,2,85,72);
 forward(mLead2,pL2,145);assert(pL2.df.locked);
 tL2.vx=5.5;
 assert(mLead2.trigger(pL2));const movingDirX=mLead2.shots[0].dir[0];
 assert(movingDirX>staticDirX+0.002,'ARV1.1 velocity lead prediction must bias guided shot ahead of strafing enemy');
 // Verify occlusion behind steel container cancels bullet guidance and drops focus lock
 arrange(m,-7.8,13,2);assert(obstruction(eyeOf(p),targetPoint(t))<=1);
 m.shots.length=0;p.cooldown=0;p.burstLeft=0;
 const before=p.yaw;assert(m.trigger(p));assert.equal(before,p.yaw);
 assert(!m.shots[0].guided,'Occluded DF1 OUT shot must NOT be guided');
 forward(m,p,180);assert(!p.df.locked);
}
{
 const m=duel(),p=m.player;p.df.pattern='spread';p.df.boost=true;burst(m);assert.equal(m.shots.length,4);assert.equal(p.mag,92);assert.equal(p.df.p1,19);assert(new Set(m.shots.map(s=>s.dir.join(','))).size>=3);
 burst(m);assert.equal(m.shots.length,9);assert.equal(p.df.p1,17);assert.equal(p.mag,89);burst(m);burst(m);assert(!p.df.boost&&p.df.cooling>0);const left=p.df.p1,main=p.mag;burst(m);assert.equal(p.df.p1,left);assert.equal(p.mag,main-3);forward(m,p,1830);assert.equal(p.df.cooling,0);
}
{
 // Separate regeneration timers: 1.0s/round ammo stock, 5.0s/shield, 8.0s/P1, and 95-round DF1 OUT reload
 const m=duel(),p=m.player;p.stock=97;p.shield=7;p.hp=44;p.df.p1=17;
 forward(m,p,359);assert.equal(p.stock,97);forward(m,p,1);assert.equal(p.stock,98);
 forward(m,p,1439);assert.equal(p.shield,7);forward(m,p,1);assert.equal(p.shield,8);
 forward(m,p,1079);assert.equal(p.df.p1,17);forward(m,p,1);assert.equal(p.df.p1,18);
 forward(m,p,9000);assert.deepEqual([p.stock,p.shield,p.df.p1,p.hp],[100,10,20,44]);
 p.mag=91;assert(m.reload(p));forward(m,p,666);assert.deepEqual([p.mag,p.stock],[95,96]);
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
 // Verify invert4 precision (VP * invVP = I) for Shadow Flame 1.0 Pro world-position depth reconstruction at widened 40.1° FOV
 const vp=multiply(perspective(40.1*Math.PI/180,16/9),lookAt([2.5,2.35,73.5],[0.5,1.55,42.0]));
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
 // High-detail & Lightweight Mode 16-joint humanoid geometry verification
 const stdHi=character(0,'SRA','standard','high');
 const stdLo=character(0,'SRA','standard','low');
 const stdLite=character(0,'SRA','standard','lite');
 const spyHi=character(0,'SRA','spy','high');
 const spyLo=character(0,'SRA','spy','low');
 const spyLite=character(0,'SRA','spy','lite');
 assert(stdHi.count>stdLo.count*1.25,`High-detail sculpted mesh (${stdHi.count} verts) must be richer than low-detail (${stdLo.count} verts)`);
 assert(spyHi.count>spyLo.count*1.25,'Spy high-detail sculpted mesh must be richer than low-detail');
 assert(stdLite.count<stdHi.count*0.25,`Lightweight character (${stdLite.count}) must reduce vertices >75% vs high (${stdHi.count})`);
 assert(spyLite.count<spyHi.count*0.25,`Lightweight spy (${spyLite.count}) must reduce vertices >75% vs high (${spyHi.count})`);
 for (const [label,mesh] of [['stdHi',stdHi],['stdLo',stdLo],['stdLite',stdLite],['spyHi',spyHi],['spyLo',spyLo],['spyLite',spyLite]]) {
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

 // Lightweight Mode harbor LOD, resolution scaling, and enhanced vs lite VFX mesh verification
 const hFull=buildHarbor('full'),hLite=buildHarbor('lite');
 assert(hLite.count<hFull.count*0.60,`Lightweight harbor (${hLite.count}) must significantly reduce geometry vs full (${hFull.count})`);
 for (let i=0;i<hLite.data.length;i+=STRIDE) {
  assert(Number.isFinite(hLite.data[i])&&Number.isFinite(hLite.data[i+1])&&Number.isFinite(hLite.data[i+2]),'Lite harbor vertices must be finite');
 }
 assert.deepEqual(effectiveSize({resolution:'HD',lightMode:false}),[1280,720]);
 assert.deepEqual(effectiveSize({resolution:'FHD',lightMode:false}),[1920,1080]);
 assert.deepEqual(effectiveSize({resolution:'2K',lightMode:false}),[2560,1440]);
 assert.deepEqual(effectiveSize({resolution:'HD',lightMode:true}),[854,480]);
 assert.deepEqual(effectiveSize({resolution:'FHD',lightMode:true}),[960,540]);
 assert.deepEqual(effectiveSize({resolution:'2K',lightMode:true}),[1280,720]);

 const mFx=duel('DF1 OUT');
 const [pFx,tFx]=arrange(mFx,2,85,75);
 forward(mFx,pFx,145);assert(mFx.trigger(pFx));
 for(let i=0;i<10;i++){mFx.time+=h;mFx.shots=mFx.shots.filter(s=>mFx.projectile(s,h))}
 mFx.effects.push(
  {kind:'shield',p:[2,1.3,75],dir:[0,0,-1],normal:[0,0,1],gun:'DF1 OUT',guided:true,life:0.18,max:0.24,seed:2},
  {kind:'break',p:[2,1.3,75],dir:[0,0,-1],normal:[0,0,1],gun:'MS10',life:0.26,max:0.36,seed:3},
  {kind:'hit',p:[2,1.2,75],dir:[0,0,-1],normal:[0,0,1],gun:'DF1 OUT',guided:true,life:0.18,max:0.26,seed:4},
  {kind:'kill',p:[2,1.2,75],dir:[0,0,-1],normal:[0,0,1],team:1,life:0.35,max:0.54,seed:5},
  {kind:'wall',p:[-8,1.4,60],dir:[-1,0,0],normal:[1,0,0],mat:'steel',metal:true,gun:'MS10',life:0.18,max:0.26,seed:6}
 );
 mFx.scorches.push({p:[-8,1.4,60],normal:[1,0,0],mat:'steel',gun:'MS10',life:1.5,max:1.8});
 const fxFull=movingDetails(mFx,1.2,true,false);
 const fxLite=movingDetails(mFx,1.2,false,true);
 const mfFull=muzzleFlashMesh('MS10',1,1,true,false);
 const mfLite=muzzleFlashMesh('MS10',1,1,false,true);
 assert(fxFull.count>fxLite.count*2.5,`Deluxe VFX (${fxFull.count}) must be dramatically richer than Lightweight VFX (${fxLite.count})`);
 assert(mfFull.count>mfLite.count,'Full muzzle flash must have more detail than lite muzzle flash');
 for (const mesh of [fxFull,fxLite,mfFull,mfLite]) {
  for (let i=0;i<mesh.data.length;i+=STRIDE) assert(Number.isFinite(mesh.data[i])&&Number.isFinite(mesh.data[i+1])&&Number.isFinite(mesh.data[i+2]),'VFX mesh vertices must be finite');
 }
 console.log('Sculpted 16-joint & Lightweight LOD OK:',{
  stdHiVerts:stdHi.count,stdLiteVerts:stdLite.count,
  harborFullVerts:hFull.count,harborLiteVerts:hLite.count,
  fxFullVerts:fxFull.count,fxLiteVerts:fxLite.count
 });
}
console.log('360Hz sim, weapon specs (DF1 OUT 95-mag 2x rate, MS10), 1s/round ammo regen, supply tankers, ARV1.1 1.76x bullet-side lead auto-aim, 40.1° FOV, deluxe bullet/impact VFX, Lightweight Mode LOD, 16-joint sculpted rig, KHDR, Shadow Flame 1.0 Flash/Pro, Sound Engin 1.0, Human-Realistic Aiming, NV2.1 Spy Engine, and all matches passed.');


