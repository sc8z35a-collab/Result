import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Match,modes,weapons,npcWeapons} from '../dist/js/match.js';
import {ARV1_VERSION,ARV1_ASSIST_STRENGTH,ARV1_LAUNCH_GAIN,ARV1_LAUNCH_STEP,ARV1_LOCK_ACQUIRE,ARV1_LOCK_HOLD} from '../dist/js/df1.js';
import {RD40_AA_VERSION,RD40_ASSIST_STRENGTH,RD40_LOCK_ACQUIRE,RD40_LOCK_HOLD,RD40_D01_DURATION,RD30_MINI_STRENGTH,RD20_AA_STRENGTH,RD_SPECS} from '../dist/js/rd40.js';
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
import {FluxGI,FLUXGI_WORLD_GLSL} from '../dist/js/fluxgi.js';
import {SchlierenOptics,SCHLIEREN_COMPOSITE_GLSL} from '../dist/js/schlieren.js';
import {BALLISTICS_VERSION,WEAPON_PENETRATION,RICOCHET_SIN_STEEL,solveBallisticImpact} from '../dist/js/ballistics.js';
import {EchoPulseField,ECHOPULSE_VERSION} from '../dist/js/echopulse.js';
import {SynapseProfiler,SYNAPSE_VERSION,sectorOf} from '../dist/js/synapse.js';
import {AeroVortex,AEROVORTEX_VERSION,AERO_COMPOSITE_GLSL,worldToAeroCell} from '../dist/js/aerovortex.js';
import {ThermoFlux,THERMOFLUX_VERSION,THERMO_COMPOSITE_GLSL} from '../dist/js/thermoflux.js';
import {SpectraField,SPECTRAFIELD_VERSION,worldToSpecCell} from '../dist/js/spectrafield.js';
import {ResonanceCore,RESONANCE_VERSION,STEEL_WAVE_SPEED,RESONANCE_VS_GLSL,RESONANCE_FS_GLSL} from '../dist/js/resonance.js';
import {ChronoTrace,CHRONOTRACE_VERSION} from '../dist/js/chronotrace.js';
import {FermatCore,FERMAT_VERSION,STEEL_MANIFOLD,solveTwoBounce,traceForwardPreview} from '../dist/js/fermat.js';
const h=1/360;
function duel(loadout='DF1 OUT',limit='unlimited',multiplier=2,events=[]) {
  return new Match({mode:'1v1', limit, multiplier,loadout},event=>events.push(event));
}
function forward(m,actor,frames) {for(let i=0;i<frames;i++){m.time+=h;m.systems(actor,h)}}
function arrange(m,x,z1,z2){const a=m.player,b=m.actors[1];Object.assign(a,{x,y:0,z:z1,yaw:.025,pitch:Math.atan2(-.38,z1-z2)});Object.assign(b,{x,y:0,z:z2,vx:0,vy:0,vz:0});return [a,b]}
function burst(m) {const a=m.player;assert(m.trigger(a));while(a.burstLeft||a.cooldown>1e-7)forward(m,a,1)}
for(const [id,cap,damage,rate,velocity,burstSize,shotsPerTrigger] of [['SW T',10,9,100,100,1,1],['SRA',30,6,120,80,1,1],['D1',40,5,100,60,2,2],['MS10',24,9,130,180,1,1],['DF1 OUT',95,2.8,300,65,3,3],['RD20',20,6,110,70,1,1],['RD30',80,3,100,100,1,2],['RD40',130,3,170,140,1,2]]) {
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
 // + Auto-Aim 1.2 (1.92x, 1.4x lock acquire range, expanded lock hold tracking cone) + D01 SENSOR behind-wall tracking
 // + Live kinetic lock/fire/tracking motion telemetry & audio cues!
 const rd=weapons.RD40;
 assert(rd.playerOnly===true&&!npcWeapons.includes('RD40'),'RD40 must be strictly player-only');
 assert(rd.auto===true&&rd.pellets===2&&rd.damage===3&&rd.capacity===130&&rd.velocity===140&&rd.rate===170);
 assert(Math.abs(rd.speed/weapons['SW T'].speed-1.4)<1e-6,'RD40 bullet velocity must be 140 ratio (504 m/s)');
 assert(Math.abs((1/rd.interval)/(1/weapons['SW T'].interval)-1.7)<1e-6,'RD40 fire rate must be 170 ratio');
 assert.equal(RD40_AA_VERSION,'1.2');
 assert(Math.abs(RD40_ASSIST_STRENGTH-1.92)<1e-6,'Auto-Aim 1.2 strength must be 1.6 * 1.2 = 1.92');
 assert(Math.abs(RD40_LOCK_ACQUIRE/ARV1_LOCK_ACQUIRE-1.4)<1e-6,'RD40 lock acquire range must be exact 1.4x ARV1.1');
 assert(RD40_LOCK_HOLD>ARV1_LOCK_HOLD*1.7,'RD40 lock hold tracking cone must be significantly expanded');

 // 1. Simultaneous 2-round full-auto firing + alternating barrelPhase & firePulse + 1-round final mag edge case
 const mAuto=duel('RD40'),pAuto=mAuto.player;
 const phase0=pAuto.rd.barrelPhase;
 assert(mAuto.trigger(pAuto));
 assert.equal(mAuto.shots.length,2,'Single RD40 trigger must emit 2 simultaneous bullets');
 assert.equal(pAuto.mag,128,'Single twin salvo must consume 2 rounds from 130-round mag');
 assert(pAuto.rd.firePulse===1&&pAuto.rd.barrelPhase===1-phase0,'RD40 trigger must pulse firePulse and alternate barrelPhase');
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
 const rdEvents=[];
 const mRdCone=duel('RD40','unlimited',2,rdEvents),[pRdC,tRdC]=arrange(mRdCone,2,85,73);
 pRdC.yaw=0.125;forward(mRdCone,pRdC,110);
 assert(pRdC.rd.locked&&pRdC.rd.focusId===tRdC.id,'RD40 1.4x expanded lock cone MUST lock cleanly at 0.125 rad');
 assert(rdEvents.some(e=>e.type==='rdlock'),'RD40 lock acquire must emit rdlock motion/audio event');
 assert(pRdC.rd.lockBlend>0.4&&pRdC.rd.lockPulse>0.5,'RD40 lock acquire must drive lockBlend & lockPulse telemetry');

 // 3. Expanded lock-tracking hold cone (0.19 rad > ARV1_LOCK_HOLD 0.1446 rad) + 3D gimbal trackYaw + twin Auto-Aim 1.2 guided bullets
 pRdC.yaw=0.19;forward(mRdCone,pRdC,12);
 assert(pRdC.rd.locked,'RD40 expanded lock hold cone must NOT drop lock at 0.19 rad');
 assert(pRdC.yaw<0.188,'RD40 Auto-Aim 1.2 smooth tracking must pull aim smoothly toward locked target');
 assert(Math.abs(pRdC.rd.trackYaw)>0.02,'RD40 gimbal tracking telemetry trackYaw must actively follow off-axis target');
 mRdCone.shots.length=0;pRdC.cooldown=0;
 assert(mRdCone.trigger(pRdC));
 assert.equal(mRdCone.shots.length,2);
 assert(mRdCone.shots.every(s=>s.guided&&s.homingTargetId===tRdC.id),'Both twin RD40 bullets must be Auto-Aim 1.2 guided');

 // 4. D01 SENSOR: sustains lock & smoothly tracks aim behind steel container, emits d01 event, and expires cleanly after 4.0s!
 const d01Events=[];
 const mD01=duel('RD40','unlimited',2,d01Events),[pD,tD]=arrange(mD01,2,85,75);
 forward(mD01,pD,110);
 assert(pD.rd.locked&&!pD.rd.d01Active,'RD40 starts with direct LOS lock');
 // Teleport pair across a solid steel container (occluded LOS!)
 Object.assign(pD,{x:-7.8,y:0,z:13,yaw:0,pitch:0});
 Object.assign(tD,{x:-7.8,y:0,z:2,vx:0,vz:0});
 assert(obstruction(eyeOf(pD),targetPoint(tD))<=1,'Test geometry must be occluded by steel container');
 forward(mD01,pD,36); // 0.1s behind wall
 assert(pD.rd.locked&&pD.rd.occluded&&pD.rd.d01Active&&pD.rd.d01Timer>3.5&&pD.rd.d01Timer<RD40_D01_DURATION,'D01 SENSOR must activate and keep lock behind cover');
 assert(d01Events.some(e=>e.type==='d01')&&pD.rd.d01Blend>0.4,'D01 SENSOR activation must emit d01 event and raise d01Blend');
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
 // 6. Ensure NPCs never equip RD40 or DF1 OUT in 3v3, while RD30 IS open to NPCs (enemy AO uses RD30!)
 const m3=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:'RD40'});
 assert(m3.player.gun==='RD40'&&m3.actors.filter(a=>!a.human).every(a=>a.gun!=='RD40'&&a.gun!=='DF1 OUT'));
 assert(m3.actors.some(a=>!a.human&&a.gun==='RD30'),'RD30 must be open to NPCs and actively equipped in 3v3');
}
{
 // RD30: Open to NPCs & Player · 80 mag · 3 dmg · 2 simultaneous full-auto · vel 100 (360 m/s) · rate 100 · Auto-Aim 1.1 mini
 const w30=weapons.RD30;
 assert(!w30.playerOnly&&npcWeapons.includes('RD30'),'RD30 must be open to NPCs');
 assert(w30.capacity===80&&w30.damage===3&&w30.pellets===2&&w30.auto===true&&w30.velocity===100&&w30.rate===100);
 assert(Math.abs(w30.speed-360)<1e-6&&Math.abs(w30.interval-0.24)<1e-6);
 assert(RD30_MINI_STRENGTH>1.0&&RD30_MINI_STRENGTH<ARV1_ASSIST_STRENGTH,'ARV1.1 mini strength must be compact (< ARV1.1)');
 assert(RD_SPECS.RD30.lockAcquire<ARV1_LOCK_ACQUIRE,'ARV1.1 mini lock cone must be tighter than ARV1.1');

 const m30=duel('RD30'),[p30,t30]=arrange(m30,2,85,73);
 p30.yaw=0.05;
 const yawBefore=p30.yaw,pitchBefore=p30.pitch;
 forward(m30,p30,190);
 assert(p30.rd.locked&&p30.rd.focusId===t30.id,'RD30 ARV1.1 mini must lock cleanly inside compact cone');
 assert.equal(p30.yaw,yawBefore,'RD30 ARV1.1 mini must be bullet-side only (zero camera yaw pull)');
 assert.equal(p30.pitch,pitchBefore,'RD30 ARV1.1 mini must be bullet-side only (zero camera pitch pull)');
 m30.shots.length=0;p30.cooldown=0;
 assert(m30.trigger(p30));
 assert.equal(m30.shots.length,2,'RD30 must fire 2 simultaneous full-auto rounds');
 assert.equal(p30.mag,78);
 assert(m30.shots.every(s=>s.damage===3&&Math.abs(s.speed-360)<1e-6&&s.guided),'Both RD30 twin rounds must carry ARV1.1 mini guidance');
 for(const mesh of [viewModel('RD30'),character(1,'RD30','standard','high'),character(1,'RD30','standard','lite'),muzzleFlashMesh('RD30',1,1,true,false)]) {
  assert(mesh.count>100);
  for(let i=0;i<mesh.data.length;i+=STRIDE) assert(Number.isFinite(mesh.data[i])&&Number.isFinite(mesh.data[i+1])&&Number.isFinite(mesh.data[i+2]));
 }

 // RD20: 20 mag · 6 dmg · 1 simultaneous full-auto · vel 70 (252 m/s) · rate 110 · Auto-Aim 1.1 (1.76x bullet-side)
 const w20=weapons.RD20;
 assert(!w20.playerOnly&&npcWeapons.includes('RD20'),'RD20 must be selectable & valid');
 assert(w20.capacity===20&&w20.damage===6&&w20.pellets===1&&w20.auto===true&&w20.velocity===70&&w20.rate===110);
 assert(Math.abs(w20.speed-252)<1e-6&&Math.abs((1/w20.interval)/(1/weapons['SW T'].interval)-1.1)<1e-6);
 assert(Math.abs(RD20_AA_STRENGTH-ARV1_ASSIST_STRENGTH)<1e-6,'RD20 must carry full ARV1.1 (1.76x) strength');

 const m20=duel('RD20'),[p20,t20]=arrange(m20,2,85,73);
 p20.yaw=0.06;
 const y20=p20.yaw,pt20=p20.pitch;
 forward(m20,p20,160);
 assert(p20.rd.locked&&p20.rd.focusId===t20.id,'RD20 ARV1.1 must lock cleanly');
 assert.equal(p20.yaw,y20,'RD20 ARV1.1 must be bullet-side only (zero camera pull)');
 assert.equal(p20.pitch,pt20);
 m20.shots.length=0;p20.cooldown=0;
 assert(m20.trigger(p20));
 assert.equal(m20.shots.length,1,'RD20 must fire 1 simultaneous full-auto round');
 assert.equal(p20.mag,19);
 assert(m20.shots[0].damage===6&&Math.abs(m20.shots[0].speed-252)<1e-6&&m20.shots[0].guided,'RD20 round must carry ARV1.1 bullet-side guidance');
 // Hold full-auto fire on RD20 -> chains continuous single rounds
 for(let i=0;i<260;i++){m20.trigger(p20);m20.time+=h;m20.systems(p20,h)}
 assert(m20.shots.length>=4&&p20.mag<=16,'Holding full-auto on RD20 must chain rapid 1-round salvos at rate 110');
 for(const mesh of [viewModel('RD20'),character(1,'RD20','standard','high'),character(1,'RD20','standard','lite'),muzzleFlashMesh('RD20',1,1,true,false)]) {
  assert(mesh.count>100);
  for(let i=0;i<mesh.data.length;i+=STRIDE) assert(Number.isFinite(mesh.data[i])&&Number.isFinite(mesh.data[i+1])&&Number.isFinite(mesh.data[i+2]));
 }
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
{
 // ===== 1. FluxGI 1.0: 32x96 2-Bounce Radiosity + Live Dynamic Radiant Light-Field =====
 assert(FLUXGI_WORLD_GLSL.includes('fluxGISample')&&FLUXGI_WORLD_GLSL.includes('uFluxGI'),'FluxGI GLSL must declare uFluxGI & fluxGISample');
 const gi=new FluxGI();
 assert(gi.baked&&gi.texData.length===32*96*4,'FluxGI must pre-bake 32x96 RGBA8 light-field');
 for(let i=0;i<gi.staticFlux.length;i++) assert(Number.isFinite(gi.staticFlux[i])&&gi.staticFlux[i]>=0,'FluxGI static radiosity must be finite & non-negative');
 // Probe beside sunlit red NORTH container ([9,77,w=3,d=12.2]) vs teal TIDE container ([9,-23,w=12.2,d=2.65])
 const redProbe=gi.sampleFlux(6.8,77);
 const tealProbe=gi.sampleFlux(9,-20.5);
 const redRatio=redProbe.r/Math.max(1e-4,redProbe.b);
 const tealRatio=tealProbe.r/Math.max(1e-4,tealProbe.b);
 assert(redRatio>tealRatio*1.12,`FluxGI red container bounce (r/b=${redRatio.toFixed(2)}) must be warmer than teal container bounce (r/b=${tealRatio.toFixed(2)})`);
 const beforeDyn=gi.sampleFlux(0,10);
 gi.injectPoint(0,10,0.25,1.2,1.5,1.4,2);
 const peakDyn=gi.sampleFlux(0,10);
 assert(peakDyn.b>beforeDyn.b+0.5,'FluxGI injectPoint must inject dynamic colored radiance');
 gi.update(null,0.2,false);
 const decayedDyn=gi.sampleFlux(0,10);
 assert(decayedDyn.b<peakDyn.b&&decayedDyn.b>=beforeDyn.b,'FluxGI dynamic radiance must smoothly decay over time');
 console.log('FluxGI 1.0 OK:',{redRatio:+redRatio.toFixed(2),tealRatio:+tealRatio.toFixed(2),dynBoost:+(peakDyn.b-beforeDyn.b).toFixed(2)});
}
{
 // ===== 2. SchlierenOptics 1.0: Gladstone-Dale Refractive Shockwave Lensing & Dispersion =====
 assert(SCHLIEREN_COMPOSITE_GLSL.includes('schlierenEvaluate')&&SCHLIEREN_COMPOSITE_GLSL.includes('uShocks'),'SchlierenOptics GLSL must declare schlierenEvaluate & uShocks');
 const sch=new SchlierenOptics();
 const camPos=[0,1.6,20],camTarget=[0,1.5,0];
 const vp=multiply(perspective(40.1*Math.PI/180,16/9,0.1,200),lookAt(camPos,camTarget,[0,1,0]));
 sch.emit('kill',[0,1.5,10]);
 sch.emit('break',[2.5,1.4,8]);
 sch.step(null,0.04);
 const n=sch.project(vp,camPos,40.1,16/9);
 assert.equal(n,2,'SchlierenOptics must project both visible shockwaves');
 const primaryUV=[+sch.uShocks[0].toFixed(2),+sch.uShocks[1].toFixed(2)];
 assert(sch.uShocks[0]>0.3&&sch.uShocks[0]<0.7&&sch.uShocks[1]>0.3&&sch.uShocks[1]<0.7,'Primary kill shockwave UV must project near center');
 assert(sch.uShocks[2]>0.01&&sch.uShocks[3]>0.001,'Shockwave must have positive screen radius & refractive strength');
 // Behind-camera shockwave must be culled cleanly
 sch.reset();
 sch.emit('kill',[0,1.5,35]);
 sch.step(null,0.04);
 assert.equal(sch.project(vp,camPos,40.1,16/9),0,'Behind-camera shockwave must be culled');
 // Wave expires cleanly after duration
 sch.reset();
 sch.emit('ricochet',[0,1.5,12]);
 for(let i=0;i<15;i++) sch.step(null,0.08);
 assert.equal(sch.waves.length,0,'Shockwaves must expire cleanly after duration');
 console.log('SchlierenOptics 1.0 OK:',{projected:n,centerUV:primaryUV});
}
{
 // ===== 3. BallisticCore-X: Oblique Steel Grazing Ricochet Bank-Shot & Wooden Crate Wallbang =====
 assert.equal(BALLISTICS_VERSION,'BallisticCore-X 1.0');
 assert(WEAPON_PENETRATION.MS10.wood>=3.0&&RICOCHET_SIN_STEEL>0.35);
 // 3A. True Grazing Ricochet Bank-Shot around steel container ([9,77,w=3,d=12.2], west face x=7.5, z=70.9..83.1)
 {
  const ev=[];
  const m=duel('MS10','unlimited',2,ev);
  const p=m.player, e=m.actors[1];
  Object.assign(p,{x:5.5,y:0,z:82.0,vx:0,vy:0,vz:0,alive:true});
  Object.assign(e,{x:5.5,y:0,z:70.0,vx:0,vy:0,vz:0,alive:true,hp:100,shield:10});
  // Aim obliquely at steel face (7.5, 1.35, 76.0) -> grazing angle ~18.4 deg -> reflects straight into enemy at (5.5, 1.35, 70.0)!
  const eye=eyeOf(p);
  const dx=7.5-eye[0], dy=1.35-eye[1], dz=76.0-eye[2];
  p.yaw=Math.atan2(dx,-dz);
  p.pitch=Math.atan2(dy,Math.hypot(dx,dz));
  const startTotalHp=e.hp+e.shield;
  assert(m.trigger(p),'Player must fire MS10 grazing shot');
  // Step projectiles deterministically (no AI movement so enemy stays at exact bank-shot intersection)
  for(let i=0;i<80&&m.shots.length;i++){
   m.time+=h;
   let w=0;
   for(const s of m.shots) if(m.projectile(s,h)) m.shots[w++]=s;
   m.shots.length=w;
  }
  assert(m.techStats.ricochets>=1,`Grazing steel shot must trigger ricochet (got ${m.techStats.ricochets})`);
  assert(ev.some(x=>x.type==='ricochet'),'Ricochet event must be emitted for Sound Engin 1.0 & FluxGI/Schlieren');
  assert(m.techStats.ricochetHits>=1&&(e.hp+e.shield)<startTotalHp,`Reflected bank-shot must hit target around corner (hits=${m.techStats.ricochetHits}, hp=${e.hp}+${e.shield})`);
 }
 // 3B. True Slab-Thickness Wallbang Penetration through wooden crate (['crates', 2.6, 61, 2.6, 2.6, 1.5], z=60.25..61.75)
 {
  const ev=[];
  const m=duel('MS10','unlimited',2,ev);
  const p=m.player, e=m.actors[1];
  Object.assign(p,{x:2.6,y:0,z:64.2,vx:0,vy:0,vz:0,alive:true});
  Object.assign(e,{x:2.6,y:0,z:58.2,vx:0,vy:0,vz:0,alive:true,hp:100,shield:10});
  // Verify target IS physically occluded by the 1.5m wooden crate!
  assert(obstruction(eyeOf(p),targetPoint(e))<0.99,'Enemy must be fully behind wooden cargo crate');
  const eye=eyeOf(p), tp=targetPoint(e);
  p.yaw=Math.atan2(tp[0]-eye[0],-(tp[2]-eye[2]));
  p.pitch=Math.atan2(tp[1]-eye[1],Math.hypot(tp[0]-eye[0],tp[2]-eye[2]));
  const startTotalHp=e.hp+e.shield;
  assert(m.trigger(p),'Player must fire MS10 straight through wooden crate');
  for(let i=0;i<80&&m.shots.length;i++){
   m.time+=h;
   let w=0;
   for(const s of m.shots) if(m.projectile(s,h)) m.shots[w++]=s;
   m.shots.length=w;
  }
  assert(m.techStats.penetrations>=1,`MS10 shot through 1.5m wood crate must penetrate (got ${m.techStats.penetrations})`);
  assert(ev.some(x=>x.type==='penetrate'),'Penetrate event must be emitted');
  assert(m.techStats.wallbangHits>=1&&(e.hp+e.shield)<startTotalHp,`Wallbang round must emerge from crate and hit hidden enemy (hits=${m.techStats.wallbangHits}, hp=${e.hp}+${e.shield})`);
 }
 console.log('BallisticCore-X OK: oblique steel bank-shot kill/hit & 1.5m wood-crate wallbang verified.');
}
{
 // ===== 4. EchoPulse 1.0: 343 m/s Acoustic Propagation, Steel-Alley Echo Decoy vs NV2.1 Haas Filter & Compass =====
 assert.equal(ECHOPULSE_VERSION,'EchoPulse 1.0');
 const m=new Match({mode:'3v3',limit:'unlimited',multiplier:2,loadout:'SRA',allyNv21:1},()=>{});
 // 4A. Speed-of-sound delay (d = 45m -> ~131ms propagation, NOT 0ms teleport!)
 m.echoPulse.reset();
 const pl=m.player;
 const enemy=m.actors.find(a=>a.team===1);
 Object.assign(pl,{x:0,y:0,z:25,yaw:0,alive:true});
 Object.assign(enemy,{x:0,y:0,z:-20,alive:true});
 m.time=1.0;
 m.echoPulse.emit(m,{kind:'fire',pos:[enemy.x,1.5,enemy.z],actor:enemy,team:1,loudness:1.1,gun:'SRA'});
 m.time=1.02; // 20ms later: wave only traveled ~6.9m of 45m!
 assert.equal(m.echoPulse.getCompassArcs(pl,m.time).length,0,'45m gunshot must not arrive at player compass in 20ms');
 m.time=1.20; // 200ms later: wave physically arrived (>131ms)!
 const arcs=m.echoPulse.getCompassArcs(pl,m.time);
 assert(arcs.length>=1&&Math.abs(arcs[0].deg)<12&&arcs[0].alpha>0.05,`Arrived compass arc must point ahead (deg=${arcs[0]?.deg?.toFixed(1)}, alpha=${arcs[0]?.alpha?.toFixed(2)})`);
 // 4B. Steel-alley occluded early-reflection decoy on standard NV2 vs NV2.1 Spy Haas Precedence rejection
 // Find a clean occluded geometry with strong steel reflection: shooter behind [-7.5,46] container, listeners on other side with facing steel wall!
 m.echoPulse.reset();
 const stdNpc=m.actors.find(a=>a.team===0&&!a.human&&!a.isSpy);
 const spyNpc=m.actors.find(a=>a.team===0&&a.isSpy);
 assert(stdNpc&&spyNpc,'3v3 with allyNv21=1 must have both standard NV2 and NV2.1 Spy ally');
 // Position shooter at (-10.2, 1.4, 46) behind [-7.5, 46] steel container and both ally listeners near the alley corner at (-4.2, 0, 55):
 // direct line is blocked by steel (occlusion=0.86), while an opposing steel container wall reflects a clear bright echo around the corner!
 m.echoPulse.reset();
 Object.assign(enemy,{x:-10.2,y:0,z:46,alive:true});
 Object.assign(stdNpc,{x:-4.2,y:0,z:55,alive:true});
 Object.assign(spyNpc,{x:-4.2,y:0,z:55,alive:true});
 m.time=2.0;
 m.echoPulse.emit(m,{kind:'fire',pos:[-10.2,1.4,46],actor:enemy,team:1,loudness:1.15,gun:'MS10'});
 assert(m.echoPulse.stats.echoDecoys>=1&&m.echoPulse.stats.nv21RejectedDecoys>=1,`EchoPulse steel-alley reflection must decoy standard NV2 and be rejected by NV2.1 Haas precedence (stats=${JSON.stringify(m.echoPulse.stats)})`);
 m.time=2.4;
 const arrived=m.echoPulse.step(m);
 assert(arrived.length>=2&&arrived.some(r=>r.isDecoy)&&arrived.some(r=>!r.isDecoy),'Arrived queue must deliver decoyed report to NV2 and true report to NV2.1');
 console.log('EchoPulse 1.0 OK:',{delayArcDeg:+arcs[0].deg.toFixed(1),stats:m.echoPulse.stats});
}
{
 // ===== 5. NV-Synapse 1.0: 12-Dim Behavioral Twin, 12x12 Markov Predictor & Counter-Playbook Compiler =====
 assert.equal(SYNAPSE_VERSION,'NV-Synapse 1.0');
 const syn=new SynapseProfiler();
 // Feed fair-play enemy visual sightings of a West-flanking, right-peeking, tanker-hunting player
 const observerPos=[0,0,-25];
 const route=[[-16,55],[-16,25],[-16,-10],[-16,-45]];
 for(let rep=0;rep<4;rep++){
  for(let k=0;k<route.length;k++){
   const [px,pz]=route[k];
   syn.observe([px,0,pz],{time:rep*12+k*2.5,observerPos,vx:3.4,vz:-4.0,crouch:0,isVisual:true});
  }
 }
 syn.observeReload();
 syn.observeTankerCapture();
 syn.observeTankerCapture();
 assert(syn.fp.laneWest>0.55,`NV-Synapse must learn West lane habit (got ${syn.fp.laneWest.toFixed(2)})`);
 const fromZ=sectorOf(-16,55);
 const pred=syn.predictNextZone(fromZ);
 assert(pred.zone===sectorOf(-16,25)&&pred.confidence>0.25,`NV-Synapse 12x12 Markov chain must predict next West sector (pred=${pred.zone}, expected=${sectorOf(-16,25)}, conf=${pred.confidence.toFixed(2)})`);
 const dir=syn.getCounterDirective();
 assert(dir.favoredLaneX<0,'Counter directive must lock onto favored West lane X=-15');
 assert(dir.playbookBias.PINCER_DOUBLE_FLANK>0.3||dir.playbookBias.TANKER_DENIAL_BOX>0.4,'Counter directive must boost counter-playbook weights');
 const sum=syn.getSummary();
 assert(sum.archetypeJa&&sum.counterJa&&sum.lanesPct[0]>50&&sum.observations>=16,'NV-Synapse summary must output complete Japanese tactical readout');
 console.log('NV-Synapse 1.0 OK:',{archetype:sum.archetype,ja:sum.archetypeJa,counter:sum.counterJa,lanesPct:sum.lanesPct,confPct:sum.confidencePct});
}
{
 // ===== 6. AeroVortex 1.0: Obstacle-Aware 2D Navier-Stokes Fluid Dynamics + Bullet-Wake Tunnel Carving =====
 assert.equal(AEROVORTEX_VERSION,'AeroVortex 1.0');
 assert(AERO_COMPOSITE_GLSL.includes('applyAeroVortex')&&AERO_COMPOSITE_GLSL.includes('uAeroTex')&&AERO_COMPOSITE_GLSL.includes('uSceneDepth'),'AeroVortex GLSL must declare applyAeroVortex, uAeroTex & uSceneDepth');
 const av=new AeroVortex();
 const [cix,ciz]=worldToAeroCell(9,77); // Inside red NORTH container [9,77,w=3,d=12.2]
 assert.equal(av.solid[ciz*av.w+cix],1,'AeroVortex solid boundary mask must block cells inside shipping containers');
 assert.equal(av.vx[ciz*av.w+cix],0,'Velocity inside solid container must be strictly zero');
 for(let i=0;i<20;i++) av.stepFluid(1/24);
 for(let i=0;i<av.n;i++) assert(Number.isFinite(av.vx[i])&&Number.isFinite(av.vz[i])&&Number.isFinite(av.smoke[i]),'Navier-Stokes velocity & smoke fields must remain finite');
 assert(av.stats.maxWindSpeed>1.2,`Harbor sea-breeze Venturi flow must develop realistic wind speed (got ${av.stats.maxWindSpeed.toFixed(2)} m/s)`);
 // Deploy tactical Smoke Vent in open lane at (0, 10) -> physically blocks optical LOS!
 av.deploySmokeVent(0,10,0,-1);
 const occ=av.smokeOcclusion([0,1.5,18],[0,1.5,2]);
 assert(occ>0.78,`AeroVortex smoke vent must physically block optical AI LOS (tau=${occ.toFixed(2)})`);
 // Supersonic MS10 bullet tearing straight through the smoke cloud carves an aerodynamic tunnel!
 const beforeCenter=av.sample(0,10).smoke;
 av.injectProjectileWake([0,1.5,15],[0,1.5,5],648,'MS10');
 const afterCenter=av.sample(0,10).smoke;
 assert(afterCenter<beforeCenter*0.85&&av.stats.wakesCarved>=1,`Supersonic MS10 wake must carve smoke tunnel (before=${beforeCenter.toFixed(2)}, after=${afterCenter.toFixed(2)}, wakes=${av.stats.wakesCarved})`);
 console.log('AeroVortex 1.0 OK:',{maxWind:+av.stats.maxWindSpeed.toFixed(2),smokeTau:+occ.toFixed(2),tunnelDrop:+((1-afterCenter/beforeCenter)*100).toFixed(0)+'%'});
}
{
 // ===== 7. ThermoFlux 1.0: Fourier Heat-Equation PDE, Persistent Footprints & Fair-Play NV2.1 Thermal Spoor =====
 assert.equal(THERMOFLUX_VERSION,'ThermoFlux 1.0');
 assert(THERMO_COMPOSITE_GLSL.includes('applyThermoFluxFLIR')&&THERMO_COMPOSITE_GLSL.includes('ironbowPalette')&&THERMO_COMPOSITE_GLSL.includes('uThermoTex'),'ThermoFlux GLSL must declare applyThermoFluxFLIR, ironbowPalette & uThermoTex');
 const tf=new ThermoFlux();
 // Solar baking contrast: verify sunlit cells bake hotter than shadowed container alleys
 let minBase=1,maxBase=0;
 for(let i=0;i<tf.n;i++){minBase=Math.min(minBase,tf.baseTemp[i]);maxBase=Math.max(maxBase,tf.baseTemp[i]);}
 assert(maxBase>minBase+0.15,`ThermoFlux solar baking must differentiate sunlit steel/dock (${maxBase.toFixed(2)}) vs cold shade (${minBase.toFixed(2)})`);
 // Stamp fresh enemy thermal footprint in open alley at (0, 40) + hidden enemy footprint behind [-7.5, 46] container at (-10.2, 46)
 tf.stampFootprint(0,40,1,5.0,0.58);
 tf.stampFootprint(-10.2,46,1,5.0,0.65);
 const peakBefore=tf.sampleTemp(0,40).dyn;
 const neighborBefore=tf.sampleTemp(1.6,40).dyn;
 tf.stepHeat(0.10);
 const peakAfter=tf.sampleTemp(0,40).dyn;
 const neighborAfter=tf.sampleTemp(1.6,40).dyn;
 assert(peakAfter<peakBefore&&neighborAfter>neighborBefore,'Fourier heat PDE must diffuse warmth into adjacent cells and cool peak');
 // Fair-play NV2.1 thermal-spoor finder spots visible hot trail (0,40) from (0,46), and NEVER sees occluded trail (-10.2,46) through steel container from (-4.2,46)!
 const visibleSpoor=tf.findEnemySpoor([0,1.6,46],1,5.8,14);
 assert(visibleSpoor&&Math.hypot(visibleSpoor.x-0,visibleSpoor.z-40)<2.2,'NV2.1 must track visible warm enemy thermal footprint');
 const tfOcc=new ThermoFlux();
 tfOcc.stampFootprint(-10.2,46,1,5.0,0.65);
 const occludedSpoor=tfOcc.findEnemySpoor([-4.2,1.6,46],1,5.8,12);
 assert.equal(occludedSpoor,null,'Fair-play thermal spoor tracker must NOT detect footprints behind solid steel containers');
 console.log('ThermoFlux 1.0 OK:',{solarDelta:+(maxBase-minBase).toFixed(2),diffusedNeighbor:+neighborAfter.toFixed(3),spoorFound:true});
}
{
 // ===== 8. SpectraField 1.0: Obstacle-Constrained Bayesian Fokker-Planck PDE & Negative-Information Collapse =====
 assert.equal(SPECTRAFIELD_VERSION,'SpectraField 1.0');
 const sf=new SpectraField();
 // Verify normalized probability mass = 1.0 and strictly 0 inside solid shipping containers
 let mass=0;
 for(let i=0;i<sf.n;i++){
  if(!sf.passable[i]) assert.equal(sf.fields[0][i],0,'Probability mass must be strictly 0 inside solid containers');
  mass+=sf.fields[0][i];
 }
 assert(Math.abs(mass-1)<1e-4,`Fokker-Planck wavefunction must normalize to 1.0 (got ${mass})`);
 // Bayesian Negative-Information Collapse: observer at (0, 60) looking North (yaw=0) down open center lane
 const obs={x:0,y:0,z:60,yaw:0,pitch:0,alive:true,crouch:0,lean:0};
 const [tx,tz]=worldToSpecCell(0,45);
 const beforeCell=sf.fields[0][tz*sf.w+tx];
 sf.collapseSightCone(0,obs,null);
 const afterCell=sf.fields[0][tz*sf.w+tx];
 assert(afterCell<beforeCell*0.5&&sf.stats.collapses>0,`Looking down empty corridor must collapse Bayesian probability (before=${beforeCell.toFixed(5)}, after=${afterCell.toFixed(5)})`);
 // Dense AeroVortex smoke across z=52 stops visibility collapse behind the smoke!
 const sfSmoke=new SpectraField();
 const avBlock=new AeroVortex();
 avBlock.deploySmokeVent(0,52,0,-1);
 const beforeBehindSmoke=sfSmoke.fields[0][tz*sfSmoke.w+tx];
 sfSmoke.collapseSightCone(0,obs,avBlock);
 const afterBehindSmoke=sfSmoke.fields[0][tz*sfSmoke.w+tx];
 assert(afterBehindSmoke>=beforeBehindSmoke*0.85,'AeroVortex smoke must shield hidden alleys from Bayesian visibility collapse');
 // Multi-sensor Bayesian likelihood fusion shifts peak threat directly to sighted coordinate & boosts Shannon certainty
 const certBefore=sf.certainty[0];
 sf.observe(0,-15,-35,{sigma:3.0,weight:1.2});
 sf.observe(0,-15,-35,{sigma:3.0,weight:1.2});
 const pk=sf.getPeakThreat(0);
 assert(Math.hypot(pk.x-(-15),pk.z-(-35))<5.0&&pk.certainty>certBefore,`Bayesian likelihood fusion must focus peak threat onto (-15,-35) (got [${pk.x.toFixed(1)},${pk.z.toFixed(1)}], cert=${pk.certainty.toFixed(2)})`);
 console.log('SpectraField 1.0 OK:',{collapses:sf.stats.collapses,peak:[+pk.x.toFixed(1),+pk.z.toFixed(1)],certaintyPct:Math.round(pk.certainty*100)});
}
{
 // ===== 9. ResonanceCore 1.0: Kirchoff-Love Thin-Plate Modal Mechanics, Stack Coupling & 5,100 m/s Container Knock =====
 assert.equal(RESONANCE_VERSION,'ResonanceCore 1.0');
 assert.equal(STEEL_WAVE_SPEED,5100);
 assert(RESONANCE_VS_GLSL.includes('resonanceDisplace')&&RESONANCE_VS_GLSL.includes('uResPos'),'ResonanceCore VS GLSL must declare resonanceDisplace & uResPos');
 assert(RESONANCE_FS_GLSL.includes('resonanceShade')&&RESONANCE_FS_GLSL.includes('uResHit'),'ResonanceCore FS GLSL must declare resonanceShade & uResHit');
 const ev=[];
 const m=duel('MS10','unlimited',2,ev);
 const rc=m.resonance;
 assert.equal(rc.containers.length,40,'ResonanceCore must build modal oscillators for all 40 harbor shipping containers');
 // 9A. Physical eigenmode scaling: 40ft container ([-12,78], id=0) has deeper fundamental than 20ft container ([-5,71], id=2)
 const c40=rc.containers[0], c40Top=rc.containers[1], c20=rc.containers[2];
 assert(c40.freqs[0]<c20.freqs[0]-25,`40ft container f1 (${c40.freqs[0].toFixed(1)}Hz) must be deeper than 20ft (${c20.freqs[0].toFixed(1)}Hz)`);
 assert.equal(c40.coupledIdx,1,'Vertically stacked 40ft pair at [-12,78] must be mechanically coupled');
 // 9B. Direct steel strike transfers mechanical energy across corner castings to stacked upper partner AND executes 5,100 m/s Container Knock!
 const p=m.player, e=m.actors[1];
 // Place enemy hugging the EAST far face of stacked container [-12,78,w=2.65,d=12] (x1=-10.675 -> enemy at x=-9.85, z=78)
 Object.assign(p,{x:-15.5,y:0,z:78,yaw:Math.PI/2,pitch:0,alive:true,vx:0,vz:0});
 Object.assign(e,{x:-9.85,y:0,z:78,yaw:-Math.PI/2,pitch:0,alive:true,vx:0,vz:0,hitRecoil:0,seismicRattle:0});
 const baseF1=c40.freqs[0];
 const res=rc.exciteStrike([-13.32,1.3,78],1.0,p,m);
 assert(res&&res.containerId===0,'Strike on west face of [-12,78] container must resolve to container 0');
 assert(c40.energy>0.5&&c40Top.energy>0.15&&rc.stats.stackTransfers>=1,'Corner-casting coupling must excite vertically stacked upper container');
 assert(res.knockedEnemy===e&&rc.stats.seismicKnocks>=1,'5,100 m/s Container Knock must detect enemy hugging far steel wall');
 assert(res.waveDelayMs>0&&res.waveDelayMs<2.0,`Steel stress wave delay across 3.5m container must be <2ms (got ${res.waveDelayMs.toFixed(2)}ms)`);
 assert(res.freqs[0]<baseF1,'Human body mass hugging steel panel must slightly damp-shift fundamental pitch');
 assert(e.hitRecoil>0.3&&e.seismicRattle>0.5&&c40.knockPing===1.0,'Container Knock must rattle enemy stance and activate knockPing');
 // 9C. GPU uniform packing + symplectic harmonic decay stability
 const gpuCount=rc.packUniforms();
 assert(gpuCount>=2&&rc.uResPos[3]>0.5&&rc.uResHit[3]===1.0,'packUniforms must upload top active vibrating containers with knockPing=1');
 const peakE=c40.energy;
 for(let i=0;i<30;i++) rc.step(1/60);
 assert(Number.isFinite(c40.energy)&&c40.energy<peakE,'Symplectic damped harmonic integrator must remain finite and decay smoothly');
 console.log('ResonanceCore 1.0 OK:',{f1_40ft:+baseF1.toFixed(1),f1_20ft:+c20.freqs[0].toFixed(1),stackTransfers:rc.stats.stackTransfers,knockMs:+res.waveDelayMs.toFixed(2),gpuActive:gpuCount});
}
{
 // ===== 10. ChronoTrace 1.0: 360Hz 4D Ballistic Flight Recorder, Forensic Telemetry & 3D Hologram Geometry =====
 assert.equal(CHRONOTRACE_VERSION,'ChronoTrace 1.0');
 const m=duel('MS10','unlimited',2,[]);
 const p=m.player, e=m.actors[1];
 // Fire a real BallisticCore-X grazing steel ricochet kill off [9,77] into low-HP enemy at (5.5, 70.0)
 Object.assign(p,{x:5.5,y:0,z:82.0,vx:0,vy:0,vz:0,alive:true});
 Object.assign(e,{x:5.5,y:0,z:70.0,vx:0,vy:0,vz:0,alive:true,hp:4,shield:0});
 const eye=eyeOf(p);
 p.yaw=Math.atan2(7.5-eye[0],-(76.0-eye[2]));
 p.pitch=Math.atan2(1.35-eye[1],Math.hypot(7.5-eye[0],76.0-eye[2]));
 assert(m.trigger(p),'Player must fire ricochet shot');
 for(let i=0;i<90&&m.shots.length;i++){
  m.time+=h;
  let w=0;
  for(const s of m.shots) if(m.projectile(s,h)) m.shots[w++]=s;
  m.shots.length=w;
 }
 const ct=m.chronoTrace;
 assert(ct.traces.length>=1&&ct.stats.killsRecorded>=1&&ct.stats.ricochetTraces>=1,`ChronoTrace must commit grazing ricochet kill trace (traces=${ct.traces.length}, kills=${ct.stats.killsRecorded}, rics=${ct.stats.ricochetTraces})`);
 const tr=ct.lastPlayerKillTrace;
 assert(tr&&tr.pts.length>=3&&tr.ricochets.length>=1&&tr.distM>10&&tr.flightMs>=1,'Recorded 4D trace must capture muzzle->bounce->impact polyline, angle, distance & ms');
 const readout=ct.formatTelemetry(tr);
 assert(readout.includes('CHRONOTRACE 1.0')&&readout.includes('跳弾')&&readout.includes('飛行'),`Telemetry readout must include Japanese forensic fields (got "${readout}")`);
 // Verify zero-extra-draw-call 3D forensic geometry inside movingDetails()
 const baseFx=movingDetails(m,m.time,true,false);
 const chronoFx=movingDetails(m,m.time,true,false,{showChrono:true,deathTrace:tr});
 assert(chronoFx.count>baseFx.count+200,`ChronoTrace forensic geometry must emit 3D ribbon + ricochet protractor + impact crown (base=${baseFx.count}, chrono=${chronoFx.count})`);
 for(let i=0;i<chronoFx.data.length;i+=STRIDE){
  assert(Number.isFinite(chronoFx.data[i])&&Number.isFinite(chronoFx.data[i+1])&&Number.isFinite(chronoFx.data[i+2]),'ChronoTrace 3D hologram vertices must all be finite');
 }
 console.log('ChronoTrace 1.0 OK:',{traces:ct.traces.length,distM:+tr.distM.toFixed(1),flightMs:tr.flightMs,angleDeg:tr.ricochets[0].angleDeg,holoVerts:chronoFx.count-baseFx.count});
}
{
 // ===== 11. FermatCore 1.0: Closed-Form Method-of-Images 1 & 2-Bounce Bank-Shots, Zero-Wallhack Gate & Mobile CPU Budget =====
 assert.equal(FERMAT_VERSION,'FermatCore 1.0');
 assert(STEEL_MANIFOLD.faces.length>=90,'Steel mirror manifold must index all ground-tier corrugated container faces');
 // 11A. 1-Bounce Closed-Form Method of Images -> fire REAL 360Hz MS10 shot along solved Fermat axis and score real corner bank-shot hit!
 {
  const m=duel('MS10','unlimited',2,[]);
  const p=m.player, e=m.actors[1];
  // Shooter at (5.5, 82), enemy at (5.5, 70) beside red NORTH container [9,77] (west face x=7.5)
  Object.assign(p,{x:5.5,y:0,z:82.0,vx:0,vy:0,vz:0,alive:true});
  Object.assign(e,{x:5.5,y:0,z:70.0,vx:0,vy:0,vz:0,alive:true,hp:100,shield:10});
  const sol=m.fermat.solveBankShot(eyeOf(p),targetPoint(e),null,'MS10',weapons.MS10.speed,false);
  assert(sol&&sol.bounces===1&&sol.angleDeg>5&&sol.angleDeg<24,`FermatCore must solve 1-bounce bank shot off [9,77] (got ${JSON.stringify(sol)})`);
  p.yaw=Math.atan2(sol.aimDir[0],-sol.aimDir[2]);
  p.pitch=Math.atan2(sol.aimDir[1],Math.hypot(sol.aimDir[0],sol.aimDir[2]));
  m.fermat.playerBank=sol;
  assert(m.trigger(p),'Player must fire Fermat-solved 1-bounce shot');
  assert(m.shots[0].fermatLocked===true,'Shot fired along solved Fermat axis must engage precision fermatLocked stabilization');
  for(let i=0;i<90&&m.shots.length;i++){
   m.time+=h;
   let w=0;
   for(const s of m.shots) if(m.projectile(s,h)) m.shots[w++]=s;
   m.shots.length=w;
  }
  assert(m.techStats.ricochets>=1&&m.techStats.ricochetHits>=1&&(e.hp+e.shield)<110,`Fermat-solved 1-bounce shot must physically ricochet & hit target (rics=${m.techStats.ricochets}, hits=${m.techStats.ricochetHits})`);
 }
 // 11B. 2-Bounce Double Method of Images -> physically bounce TWICE across opposing steel container canyon walls and hit target!
 {
  const m=duel('MS10','unlimited',2,[]);
  const p=m.player, e=m.actors[1];
  // Real Harbor Range opposing steel container corridor between [-12,78] east face & [-5,71] west face (15° / 15° double bank!)
  let dblSol=null, srcP=[-10,1.5,83], dstP=[-10,1.3,63];
  for(let i=0;i<STEEL_MANIFOLD.faces.length&&!dblSol;i++){
   const f1=STEEL_MANIFOLD.faces[i];
   for(const j of STEEL_MANIFOLD.neighbors[i]){
    const s2=solveTwoBounce(srcP,dstP,f1,STEEL_MANIFOLD.faces[j],weapons.MS10.speed);
    if(s2){dblSol=s2;break;}
   }
  }
  assert(dblSol&&dblSol.bounces===2&&dblSol.bounce1&&dblSol.bounce2,'Harbor Range container canyons must admit closed-form 2-bounce Double Method-of-Images solutions');
  // Fire REAL 360Hz MS10 shot along 2-bounce Fermat aimDir and prove it physically executes >=2 steel ricochets and hits target!
  Object.assign(p,{x:srcP[0],y:0,z:srcP[2],vx:0,vy:0,vz:0,alive:true,crouch:0});
  Object.assign(e,{x:dstP[0],y:0,z:dstP[2],vx:0,vy:0,vz:0,alive:true,hp:100,shield:10,crouch:0});
  // Re-solve from exact eyeOf(p) to exact targetPoint(e) using the discovered opposing steel pair!
  const exact2=solveTwoBounce(eyeOf(p),targetPoint(e),STEEL_MANIFOLD.faces[dblSol.faceId1],STEEL_MANIFOLD.faces[dblSol.faceId2],weapons.MS10.speed);
  assert(exact2&&exact2.bounces===2,'Exact eye-to-torso 2-bounce Fermat path must be valid');
  p.yaw=Math.atan2(exact2.aimDir[0],-exact2.aimDir[2]);
  p.pitch=Math.atan2(exact2.aimDir[1],Math.hypot(exact2.aimDir[0],exact2.aimDir[2]));
  m.fermat.playerBank=exact2;
  assert(m.trigger(p),'Player must fire 2-bounce Fermat bank shot');
  for(let i=0;i<180&&m.shots.length;i++){
   m.time+=h;
   let w=0;
   for(const s of m.shots) if(m.projectile(s,h)) m.shots[w++]=s;
   m.shots.length=w;
  }
  assert(m.techStats.ricochets>=2&&m.techStats.ricochetHits>=1&&(e.hp+e.shield)<110,`Fermat-solved 2-bounce shot must physically bounce TWICE off steel containers and hit target (rics=${m.techStats.ricochets}, hits=${m.techStats.ricochetHits}, hp=${e.hp}+${e.shield})`);
 }
 // 11C. 100% Fair-Play Zero-Wallhack Gate + Live Crosshair Grazing Preview + Smartphone CPU Budget (< 0.25 ms!)
 {
  const m=duel('MS10','unlimited',2,[]);
  const p=m.player, e=m.actors[1];
  // Hide enemy cleanly behind [-7.5, 46] steel container (zero LOS, zero intel!)
  Object.assign(p,{x:-4.0,y:0,z:52.0,yaw:0,pitch:0,alive:true,vx:0,vz:0});
  Object.assign(e,{x:-10.2,y:0,z:46.0,yaw:Math.PI,pitch:0,alive:true,vx:0,vz:0,seismicRattle:0});
  assert(obstruction(eyeOf(p),targetPoint(e))<0.99,'Enemy must be occluded behind steel container');
  m.time=5.0;
  const blind=m.fermat.updatePlayerOracle(m,m.time,true);
  assert.equal(blind.bank,null,'FermatCore MUST NOT reveal bank-shots for unseen/unheard occluded enemies (zero wallhack!)');
  // Forward crosshair grazing preview on steel wall works legally at all times
  const grazeDir=unit([7.5-5.5, 0, 76.0-82.0]);
  const fwdPrev=traceForwardPreview([5.5,1.5,82.0],grazeDir,'MS10');
  assert(fwdPrev&&fwdPrev.kind==='ricochet'&&fwdPrev.angle1>5&&fwdPrev.angle1<=24,'Live forward crosshair preview must detect steel grazing ricochet');
  // Smartphone CPU micro-benchmark: 200 full Method-of-Images solves must average < 250 us!
  const tStart=performance.now();
  for(let k=0;k<200;k++) m.fermat.solveBankShot([5.5,1.5,82.0],[5.5,1.3,70.0],null,'MS10',648,true);
  const avgUs=((performance.now()-tStart)/200)*1000;
  assert(avgUs<250,`FermatCore mobile CPU budget exceeded (${avgUs.toFixed(1)} us > 250 us)`);
  console.log('FermatCore 1.0 OK:',{faces:STEEL_MANIFOLD.faces.length,oneBounceHit:true,twoBounceHit:true,zeroWallhack:true,avgSolveUs:+avgUs.toFixed(1)});
 }
}
console.log('360Hz sim, weapon specs (DF1 OUT 95-mag 2x rate, MS10, RD20/30/40), FluxGI 1.0, SchlierenOptics 1.0, BallisticCore-X, EchoPulse 1.0, NV-Synapse 1.0, AeroVortex 1.0, ThermoFlux 1.0, SpectraField 1.0, ResonanceCore 1.0, ChronoTrace 1.0, FermatCore 1.0, Lightweight Mode LOD, 16-joint sculpted rig, KHDR, Shadow Flame 1.0 Flash/Pro, Sound Engin 1.0, Human-Realistic Aiming, NV2.1 Spy Engine, and all matches passed.');


