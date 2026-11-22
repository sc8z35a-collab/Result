import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Match,modes,weapons,npcWeapons} from '../dist/js/match.js';
import {ARV1_VERSION,ARV1_ASSIST_STRENGTH,ARV1_LAUNCH_GAIN,ARV1_LAUNCH_STEP,ARV1_LOCK_ACQUIRE,ARV1_LOCK_HOLD} from '../dist/js/df1.js';
import {RD40_AA_VERSION,RD40_ASSIST_STRENGTH,RD40_LOCK_ACQUIRE,RD40_LOCK_HOLD,RD40_D01_DURATION,RD30_MINI_STRENGTH,RD20_AA_STRENGTH,RD_SPECS} from '../dist/js/rd40.js';
import {
  DF40II,ARV13_VERSION,AA13_VERSION,AA14_VERSION,
  AA13_ASSIST_STRENGTH,AA13_LOCK_ACQUIRE,AA13_LOCK_HOLD,AA13_FOCUS_TIME,AA13_WALL_DURATION,
  AA14_ASSIST_STRENGTH,AA14_LOCK_ACQUIRE,AA14_LOCK_HOLD,AA14_FOCUS_TIME,AA14_HOMING_BUDGET,AA13_HOMING_BUDGET,
  AA14_OVERHEAT_COOLDOWN,AA14_COOL_DELAY
} from '../dist/js/df40ii.js';
import {PilotWallet} from '../dist/js/wallet.js';
import {readPreferences} from '../dist/js/preferences.js';
import {ThermalOptic} from '../dist/js/optic.js';
import {eyeOf,targetPoint} from '../dist/js/posture.js';
import {obstruction,surfaceAt,raycastMaterial,walkable} from '../dist/js/yard.js';
import {perspective,lookAt,multiply,invert4,STRIDE,random,forward as forwardVec,dot,unit,sub} from '../dist/js/geometry.js';
import {buildHarbor} from '../dist/js/harbor.js';
import {character,viewModel,movingDetails,muzzleFlashMesh} from '../dist/js/models.js';
import {effectiveSize} from '../dist/js/renderer.js';
import {shadowModes,SHADOW_FLAME_WORLD_GLSL,sfScreenFS,sfBilateralFS} from '../dist/js/shadowflame.js';
import {KHDR_TONE_GLSL} from '../dist/js/khdr.js';
import {BONE,ARTICULATED_RIG_GLSL} from '../dist/js/rig.js';
import {HumanAimController} from '../dist/js/nv21-spy.js';
import {WEAPON_BAND} from '../dist/js/nv13pro.js';
import {
  NV23_HUMAN_VERSION,CALLSIGN_PROFILES,PEEK_STYLES,COMMS_CHANNELS,
  HumanPsycheV23,HumanPerceptionV23,HumanOFC_AimV23,HumanGazeV23,HumanTacticsV23,HumanSquadCommsV23
} from '../dist/js/nv23-human.js';
import {
  NV24_MANUSIA_VERSION,CALLSIGN_PROFILES_V24,COMMS_CHANNELS_V24,
  ManusiaSomaPsycheV24,ManusiaTheoryOfMindV24,ManusiaPerceptionV24,
  ManusiaNeuromotorAimV24,ManusiaGazeV24,ManusiaTacticsV24,ManusiaSocialSquadV24
} from '../dist/js/nv24-manusia.js';
import {
  NV25_HUMAIN_VERSION,CALLSIGN_PROFILES_V25,COMMS_CHANNELS_V25,
  HumainActiveInferenceV25,HumainDecisionDDM_V25,HumainAffectivePsycheV25,
  HumainMetaMindV25,HumainMultisensoryV25,HumainSensorimotorV25,
  HumainFixationGazeV25,HumainEmbodiedTacticsV25,HumainSocialMindV25
} from '../dist/js/nv25-humain.js';
import {
  NV26_FORCE_VERSION,FORCE_GESTURES,VOICE_PROFILES_V26,CALLSIGN_PROFILES_V26,COMMS_CHANNELS_V26,
  ForceBodyLanguageV26,ForcePsycheV26,ForceCounterBrainV26,ForceTempoCoordV26,
  ForceSensorimotorV26,ForceTacticsV26,ForceSocialVoiceV26
} from '../dist/js/nv26-force.js';
import {
  NV2_HUMAN_VERSION,HUMAN_ARCHETYPES,HumanMind,HumanVisionModel,HumanMotorAim,HumanGazeDirector,HumanCommsRelay
} from '../dist/js/nv2-human.js';
import {
  PortAudio,SoundEngin,SoundEngin2,SOUND_ENGIN_VERSION,SOUND_CONTROL_HZ,SUB_CROSSOVER_HZ,
  SPEED_OF_SOUND,AUDIO_MODES,SOUND_CATALOG_COUNT,
  computePropagationDelay,computeAirAbsorption,computeDopplerShift,computeDopplerCurve300Hz,
  computeBinauralNearField,computeMultiBandAcousticPath,computeAcousticPath,
  traceImageSourceReflections,traceEarlyReflections,estimateEnclosure,
  synthesizeWaveShaperCurve,synthesizeModalSamples,computeVocalFormantPlan,createGunImpulseSamples,generateHarborIR2,generateHarborIR
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
for(const [id,cap,damage,rate,velocity,burstSize,shotsPerTrigger] of [['SW T',10,9,100,100,1,1],['SRA',30,6,120,80,1,1],['D1',40,5,100,60,2,2],['MS10',24,9,130,180,1,1],['DF1 OUT',95,2.8,300,65,3,3],['RD20',20,6,110,70,1,1],['RD30',80,3,100,100,1,2],['RD40',130,3,170,140,1,2],['DF40 II',260,2,225,80,1,3]]) {
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
 // DF40 II: Player-only tri-barrel full-auto (260 mag, 3 simultaneous, 2 dmg, rate 225, vel 80 = 288 m/s)
 // + ARV1.3 & Auto-Aim 1.3 (evolved beyond Auto-Aim 1.2) + temporary Auto-Aim 1.4 Overdrive with overheat & cooldown purge!
 const w40=weapons[DF40II];
 assert(w40.playerOnly===true&&!npcWeapons.includes(DF40II),'DF40 II must be strictly player-only');
 assert(w40.capacity===260&&w40.damage===2&&w40.pellets===3&&w40.burst===1&&w40.auto===true&&w40.rate===225&&w40.velocity===80);
 assert(Math.abs(w40.speed-288)<1e-6&&Math.abs(w40.speed/weapons['SW T'].speed-0.8)<1e-6,'DF40 II velocity must be 80 ratio (288 m/s)');
 assert(Math.abs((1/w40.interval)/(1/weapons['SW T'].interval)-2.25)<1e-6,'DF40 II fire rate must be 225 ratio');
 assert.equal(ARV13_VERSION,'1.3');
 assert.equal(AA13_VERSION,'1.3');
 assert.equal(AA14_VERSION,'1.4');
 assert(AA13_ASSIST_STRENGTH>RD40_ASSIST_STRENGTH&&Math.abs(AA13_ASSIST_STRENGTH-2.08)<1e-6,'Auto-Aim 1.3 must strictly evolve beyond Auto-Aim 1.2');
 assert(AA13_LOCK_ACQUIRE>RD40_LOCK_ACQUIRE&&AA13_LOCK_HOLD>RD40_LOCK_HOLD&&AA13_FOCUS_TIME<0.26,'ARV1.3/AA1.3 cones & lock speed must surpass RD40 AA1.2');
 assert(AA14_ASSIST_STRENGTH>AA13_ASSIST_STRENGTH&&AA14_LOCK_ACQUIRE>AA13_LOCK_ACQUIRE&&AA14_LOCK_HOLD>AA13_LOCK_HOLD&&AA14_FOCUS_TIME<AA13_FOCUS_TIME&&AA14_HOMING_BUDGET>AA13_HOMING_BUDGET,'Auto-Aim 1.4 must strictly strengthen Auto-Aim 1.3');

 // 1. Full-auto 3-round simultaneous firing + remainder mag (260 % 3 = 2, and 1-round final shot)
 const mFire=duel(DF40II),pF=mFire.player;
 assert(mFire.trigger(pF));
 assert.equal(mFire.shots.length,3,'Single DF40 II trigger must emit 3 simultaneous rounds');
 assert.equal(pF.mag,257,'Single tri-barrel salvo must consume 3 rounds from 260-round mag');
 assert(mFire.shots.every(s=>s.damage===2&&Math.abs(s.speed-288)<1e-6&&s.arvOrder===2&&s.aaTier==='1.3'));
 for(let i=0;i<360;i++){mFire.trigger(pF);mFire.time+=h;mFire.systems(pF,h)}
 assert(mFire.shots.length>=27&&pF.mag<=233,`Holding full-auto DF40 II at rate 225 for 1s must chain >=27 rounds (got ${mFire.shots.length})`);
 pF.mag=2;pF.cooldown=0;const before2=mFire.shots.length;
 assert(mFire.trigger(pF));assert.equal(mFire.shots.length,before2+2);assert.equal(pF.mag,0);
 pF.mag=1;pF.cooldown=0;const before1=mFire.shots.length;
 assert(mFire.trigger(pF));assert.equal(mFire.shots.length,before1+1);assert.equal(pF.mag,0);

 // 2. Auto-Aim 1.3 wider acquire cone than RD40 Auto-Aim 1.2 (0.155 rad: RD40 misses, DF40 II locks!)
 const mRdMiss=duel('RD40'),[pRdM]=arrange(mRdMiss,2,85,73);
 pRdM.yaw=0.155;forward(mRdMiss,pRdM,140);
 assert(!pRdM.rd.locked,'RD40 Auto-Aim 1.2 should NOT acquire outside 0.1449 rad cone');
 const ev13=[],m13=duel(DF40II,'unlimited',2,ev13),[p13,t13]=arrange(m13,2,85,73);
 p13.yaw=0.155;forward(m13,p13,90);
 assert(p13.df40.locked&&p13.df40.focusId===t13.id,'DF40 II Auto-Aim 1.3 MUST lock cleanly at 0.155 rad (evolved beyond AA1.2)');
 assert(ev13.some(e=>e.type==='rdlock'&&e.gun===DF40II));
 // Expanded hold cone (0.27 rad > RD40 0.253 rad) + smooth magnetic tracking + 3 simultaneous ARV1.3 guided shots
 p13.yaw=0.27;forward(m13,p13,12);
 assert(p13.df40.locked&&p13.yaw<0.266,'Auto-Aim 1.3 must sustain lock at 0.27 rad and smoothly pull aim toward target');
 m13.shots.length=0;p13.cooldown=0;
 assert(m13.trigger(p13));
 assert.equal(m13.shots.length,3);
 assert(m13.shots.every(s=>s.guided&&s.homingTargetId===t13.id&&s.aaTier==='1.3'&&s.arvOrder===2),'All 3 DF40 II rounds must carry ARV1.3/AA1.3 guidance');
 const s13=m13.shots[0];
 for(let i=0;i<14&&m13.shots.includes(s13);i++){m13.time+=h;m13.projectile(s13,h)}
 assert(s13.homingTurned>0,'ARV1.3 guided bullet must curve smoothly in flight at 360Hz');

 // 3. ARV1.3 2nd-order velocity + acceleration lead prediction: accelerating target shifts aim ahead of constant-velocity target
 const mAcc1=duel(DF40II),[pA1,tA1]=arrange(mAcc1,0,85,40);
 tA1.vx=3.0;forward(mAcc1,pA1,90);assert(pA1.df40.locked);
 assert(mAcc1.trigger(pA1));const constVelDirX=mAcc1.shots[1].dir[0];
 const mAcc2=duel(DF40II),[pA2,tA2]=arrange(mAcc2,0,85,40);
 tA2.vx=1.0;forward(mAcc2,pA2,50);
 for(let i=0;i<50;i++){tA2.vx+=14*h;mAcc2.time+=h;mAcc2.systems(pA2,h)}
 tA2.vx=3.0; // Same instantaneous vx=3.0, but positive smoothed acceleration ax>0!
 assert(pA2.df40.locked&&pA2.df40.targetAccel[0]>5.0,'ARV1.3 must estimate positive lateral target acceleration');
 pA2.yaw=pA1.yaw;pA2.pitch=pA1.pitch;
 assert(mAcc2.trigger(pA2));const accelDirX=mAcc2.shots[1].dir[0];
 assert(accelDirX>constVelDirX+0.0005,`ARV1.3 2nd-order lead must bias further ahead for accelerating target (${accelDirX.toFixed(4)} vs ${constVelDirX.toFixed(4)})`);

 // 4. Auto-Aim 1.4 Overdrive: locks at 0.205 rad (outside AA1.3 0.1707 rad), snap-locks in <=0.08s, pinpoint zero-fan convergence,
 //    early manual deactivation cools without lockout, AND sustained use hits 100% OVERHEAT with 6.0s lockout -> ready recovery!
 const ev14=[],m14=duel(DF40II,'unlimited',2,ev14),[p14,t14]=arrange(m14,2,85,73);
 p14.yaw=0.205;forward(m14,p14,90);
 assert(!p14.df40.locked,'Auto-Aim 1.3 must NOT lock outside its 0.1707 rad cone');
 const onRes=m14.toggleAA14(p14);
 assert(onRes.ok&&p14.df40.aa14Active&&p14.df40.aaVersion==='1.4','toggleAA14 must engage Auto-Aim 1.4 Overdrive');
 assert(ev14.some(e=>e.type==='aa14'&&e.state==='on'));
 forward(m14,p14,32); // ~0.089s -> AA1.4 snap-locks in 0.06s even at 0.205 rad!
 assert(p14.df40.locked&&p14.df40.focusId===t14.id,'Auto-Aim 1.4 MUST rapidly snap-lock at 0.205 rad');
 assert(p14.df40.aa14Heat>0&&p14.df40.aa14Heat<30,'Running AA1.4 must accumulate thermal heat');
 // Fire in AA1.4 -> pinpoint zero-fan convergence across all 3 simultaneous shots!
 m14.shots.length=0;p14.cooldown=0;
 assert(m14.trigger(p14));
 assert.equal(m14.shots.length,3);
 assert(m14.shots.every(s=>s.guided&&s.aaTier==='1.4'),'All 3 AA1.4 shots must be tagged tier 1.4');
 assert(Math.hypot(m14.shots[0].dir[0]-m14.shots[2].dir[0],m14.shots[0].dir[1]-m14.shots[2].dir[1],m14.shots[0].dir[2]-m14.shots[2].dir[2])<1e-6,'AA1.4 tri-barrel shots must converge with zero fan dispersion');
 // Early manual toggle OFF -> cools cleanly back to 0 without overheat lockout!
 const heatPeak=p14.df40.aa14Heat;
 const offRes=m14.toggleAA14(p14);
 assert(offRes.ok&&!p14.df40.aa14Active&&!p14.df40.aa14Overheated,'Manual deactivation before 100% must not trigger overheat');
 forward(m14,p14,Math.ceil((AA14_COOL_DELAY+1.5)*360));
 assert(p14.df40.aa14Heat<heatPeak*0.5,'Heat must cool down smoothly after manual deactivation');
 // Re-activate AA1.4 and push until 100% OVERHEAT!
 assert(m14.toggleAA14(p14).ok&&p14.df40.aa14Active);
 for(let i=0;i<360*8&&!p14.df40.aa14Overheated;i++){
  if(p14.cooldown<=0)m14.trigger(p14);
  m14.time+=h;m14.systems(p14,h);
 }
 assert(p14.df40.aa14Overheated&&!p14.df40.aa14Active&&p14.df40.aaVersion==='1.3'&&p14.df40.aa14Cooldown>5.5,'Sustained AA1.4 must overheat, shut off AA1.4, revert to AA1.3, and start 6.0s thermal cooldown');
 assert(ev14.some(e=>e.type==='aa14'&&e.state==='overheat'),'Overheat must emit aa14 overheat event');
 const blocked=m14.toggleAA14(p14);
 assert(!blocked.ok&&blocked.reason==='overheated','Cannot re-enable AA1.4 while overheated');
 // Gun still fires normally in AA1.3 while AA1.4 is overheated!
 m14.shots.length=0;p14.cooldown=0;p14.mag=30;
 assert(m14.trigger(p14)&&m14.shots.length===3&&m14.shots.every(s=>s.aaTier==='1.3'),'DF40 II must continue firing in AA1.3 while AA1.4 cools from overheat');
 // Complete the 6.0s overheat purge -> emits ready and allows re-enabling AA1.4!
 forward(m14,p14,Math.ceil((AA14_OVERHEAT_COOLDOWN+0.1)*360));
 assert(!p14.df40.aa14Overheated&&p14.df40.aa14Heat===0&&p14.df40.aa14Cooldown===0,'Thermal purge must finish cleanly after 6.0s');
 assert(ev14.some(e=>e.type==='aa14'&&e.state==='ready'),'Finishing overheat purge must emit aa14 ready event');
 assert(m14.toggleAA14(p14).ok&&p14.df40.aa14Active,'AA1.4 must be re-usable once overheat cooldown finishes');

 // 5. Behind-wall ARV1.3 sensor tracking & finite expiry + 3v3 player-only check + 3D mesh integrity
 const mWall=duel(DF40II),[pW,tW]=arrange(mWall,2,85,75);
 forward(mWall,pW,90);assert(pW.df40.locked&&!pW.df40.d01Active);
 Object.assign(pW,{x:-7.8,y:0,z:13,yaw:0,pitch:0});Object.assign(tW,{x:-7.8,y:0,z:2,vx:0,vz:0});
 forward(mWall,pW,36);
 assert(pW.df40.locked&&pW.df40.d01Active&&pW.df40.d01Timer>4.0&&pW.df40.d01Timer<AA13_WALL_DURATION,'DF40 II ARV1.3 must sustain behind-cover tracking');
 forward(mWall,pW,1700);
 assert(!pW.df40.locked&&!pW.df40.d01Active,'DF40 II behind-cover tracking must expire cleanly after finite duration');
 const m3DF=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:DF40II});
 assert(m3DF.player.gun===DF40II&&m3DF.actors.filter(a=>!a.human).every(a=>a.gun!==DF40II&&a.gun!=='RD40'&&a.gun!=='DF1 OUT'),'NPCs must NEVER equip DF40 II');
 const vm40=viewModel(DF40II),mf40=muzzleFlashMesh(DF40II,1,1,true,false),mf40Lite=muzzleFlashMesh(DF40II,1,1,false,true);
 const fx40=movingDetails(m14,1.2,true,false);
 assert(vm40.count>500&&mf40.count>mf40Lite.count&&mf40Lite.count>0&&fx40.count>0);
 for(const mesh of [vm40,mf40,mf40Lite,fx40]) for(let i=0;i<mesh.data.length;i+=STRIDE) assert(Number.isFinite(mesh.data[i])&&Number.isFinite(mesh.data[i+1])&&Number.isFinite(mesh.data[i+2]));
 console.log('DF40 II (ARV1.3 / AA1.3 / AA1.4 Overheat) OK:',{mag:w40.capacity,pellets:w40.pellets,damage:w40.damage,rate:w40.rate,velocity:w40.velocity,aa13Strength:AA13_ASSIST_STRENGTH,aa14Strength:AA14_ASSIST_STRENGTH,vmVerts:vm40.count});
}
{
 // Auto-Aim ON/OFF toggle: preference persistence + complete disable across DF1 OUT / RD-series / DF40 II + live toggle mid-match
 assert.equal(readPreferences({}).settings.autoAim,true,'autoAim should default to true');
 assert.equal(readPreferences({settings:{autoAim:false}}).settings.autoAim,false,'autoAim=false must persist cleanly');
 for(const gun of ['DF1 OUT','RD20','RD30','RD40',DF40II]){
  const mOff=new Match({mode:'1v1',limit:'unlimited',loadout:gun,autoAim:false});
  const [p,t]=arrange(mOff,2,85,72);
  p.yaw+=0.05;
  const yawBefore=p.yaw,pitchBefore=p.pitch;
  forward(mOff,p,200);
  const st=p.df||p.rd||p.df40;
  assert.equal(st.locked,false,`${gun} must NOT lock when autoAim is OFF`);
  assert.equal(st.focusId,-1,`${gun} must NOT track focusId when autoAim is OFF`);
  assert.equal(p.yaw,yawBefore,`${gun} must NOT pull player yaw when autoAim is OFF`);
  assert.equal(p.pitch,pitchBefore,`${gun} must NOT pull player pitch when autoAim is OFF`);
  if(p.df40){
   const res=mOff.toggleAA14(p);
   assert.equal(res.ok,false,'AA1.4 must be blocked when autoAim is OFF');
   assert.equal(res.reason,'autoaim_off');
  }
  assert(mOff.trigger(p)&&mOff.shots.length>0,`${gun} must still fire normally when autoAim is OFF`);
  assert(mOff.shots.every(s=>!s.guided&&s.homingBudget===0),`${gun} rounds must be unguided when autoAim is OFF`);
  // Live toggle ON -> locks & guides; live toggle OFF -> clears lock & cuts in-flight homing!
  mOff.setAutoAim(true);
  mOff.shots.length=0;p.cooldown=0;p.burstLeft=0;p.queue.length=0;
  forward(mOff,p,200);
  assert.equal(st.locked,true,`${gun} must re-enable lock when autoAim is toggled back ON`);
  assert(mOff.trigger(p)&&mOff.shots.some(s=>s.guided),`${gun} must fire guided rounds after toggling autoAim ON`);
  mOff.setAutoAim(false);
  assert.equal(st.locked,false,`${gun} must immediately drop lock on setAutoAim(false)`);
  for(const s of mOff.shots) s.homingTurned=0;
  mOff.step(h,{forward:0,side:0,jump:false,crouch:false,sprint:false});
  assert(mOff.shots.every(s=>s.homingTurned===0),`${gun} must halt in-flight player homing on setAutoAim(false)`);
 }
 console.log('Auto-Aim ON/OFF toggle OK: DF1 OUT, RD20, RD30, RD40, DF40 II verified.');
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
 const storage=new Map();globalThis.localStorage={get length(){return storage.size},key:i=>[...storage.keys()][i]??null,getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};const w=new PilotWallet(()=>{});await w.ready;assert(!await w.change());assert(await w.change('m/1'));assert(!await w.change('m/1'));assert(await w.change());assert(!await w.change());const second=new PilotWallet(()=>{});await second.ready;assert.deepEqual(second.state,{units:5,evr:true});assert(!await second.change('m/1'));
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
 // Sound Engin 2.0: 300Hz-class physical multi-band acoustics, 3-band UTD diffraction, 300Hz hyperbolic Doppler,
 // Woodworth binaural near-field ITD/ILD + pinna elevation, analytical Fermat image reflections, 14 modal buffers, & 3-zone IRs
 assert.equal(SOUND_ENGIN_VERSION,'Sound Engin 2.0');
 assert.equal(SOUND_CONTROL_HZ,300,'Sound Engin 2.0 must operate at 300Hz control rate');
 assert.equal(SUB_CROSSOVER_HZ,300,'Sound Engin 2.0 must use 300Hz sub-bass crossover');
 assert.equal(PortAudio,SoundEngin2,'PortAudio alias must map cleanly to SoundEngin2');
 assert.equal(SoundEngin,SoundEngin2,'SoundEngin alias must map cleanly to SoundEngin2');
 assert.deepEqual(AUDIO_MODES,{ultra300:'ultra300',hrtf:'hrtf',stereo:'stereo'});
 assert(SOUND_CATALOG_COUNT>=60,`Sound Engin 2.0 must provide 60+ distinct sound archetypes (got ${SOUND_CATALOG_COUNT})`);
 // 1. Speed-of-sound propagation delay & supersonic MS10 crack-before-blast physics
 const d50=computePropagationDelay(50);
 assert(Math.abs(d50-50/SPEED_OF_SOUND)<1e-6,'Propagation delay must equal d / 343 m/s');
 assert(50/weapons.MS10.speed<d50,'MS10 supersonic round (648 m/s) must arrive before its muzzle blast');
 // 2. ISO 9613-1 maritime 3-band air absorption monotonic rolloff
 const aClose=computeAirAbsorption(2),aMid=computeAirAbsorption(45),aFar=computeAirAbsorption(130);
 assert(aClose.cutoffHz>aMid.cutoffHz&&aMid.cutoffHz>aFar.cutoffHz,'Air absorption LPF cutoff must decrease monotonically with distance');
 assert(aClose.airGain>aMid.airGain&&aMid.airGain>aFar.airGain,'Air attenuation must decrease monotonically with distance');
 assert(aFar.gainLow>aFar.gainMid&&aFar.gainMid>aFar.gainHigh,'Atmospheric absorption must attenuate high frequencies faster than <300Hz low frequencies');
 // 3. 300Hz-Sampled Hyperbolic Doppler Curve & Mach-cone physics
 const dopMS10=computeDopplerShift(weapons.MS10.speed,2.0);
 const dopSRA=computeDopplerShift(weapons.SRA.speed,2.0);
 assert(dopMS10.isSupersonic&&dopMS10.mach>1.85&&dopMS10.approachRatio>1&&dopMS10.recedeRatio<1,'MS10 Doppler must be supersonic with approach > 1 > recede');
 assert(!dopSRA.isSupersonic&&dopSRA.mach<1&&dopSRA.approachRatio>1&&dopSRA.recedeRatio<1,'SRA Doppler must be subsonic with approach > 1 > recede');
 const curve300=computeDopplerCurve300Hz(weapons.MS10.speed,2.0);
 assert.equal(curve300.sampleHz,300);
 assert(curve300.curve.length>=24&&curve300.curve[0]>1.15&&curve300.curve[curve300.curve.length-1]<0.85,'300Hz hyperbolic Doppler curve must transition smoothly across CPA');
 for(let i=1;i<curve300.curve.length;i++) assert(curve300.curve[i]<=curve300.curve[i-1]+1e-6,'300Hz Doppler curve must be monotonically non-increasing across CPA');
 // 4. Woodworth-Schlosberg Binaural Near-Field ITD/ILD + Pinna Elevation cues
 const binNear=computeBinauralNearField([1.1,1.65,78],[0,1.65,78],[1,0,0],[0,0,-1]);
 const binFar=computeBinauralNearField([14.0,1.65,78],[0,1.65,78],[1,0,0],[0,0,-1]);
 const binRoof=computeBinauralNearField([2.0,6.2,76],[0,1.65,78],[1,0,0],[0,0,-1]);
 assert(binNear.itdMs>0.45&&binNear.itdMs<0.75,'Side source ITD must match physical spherical head delay (~0.66ms)');
 assert(binNear.ildDb>binFar.ildDb&&binNear.shadowCutoffHz<binFar.shadowCutoffHz,'Near-field source must exhibit stronger ILD & head-shadowing than far source');
 assert(binRoof.elevDeg>35&&binRoof.pinnaNotchHz>binFar.pinnaNotchHz,'Overhead container-roof source must shift pinna notch higher than eye-level source');
 // 5. True 3-Band UTD Knife-Edge Diffraction + Lloyd's Mirror Ground Reflection
 assert.equal(surfaceAt(0,0,0),'concrete','Wharf ground must classify as concrete');
 assert.equal(surfaceAt(-12,78,5.24),'steel','Container roof must classify as steel');
 assert.equal(surfaceAt(-16,68,2.2),'wood','Wooden crates must classify as wood');
 const matHit=raycastMaterial([-7.8,1.4,13],[-7.8,1.4,2]);
 assert(matHit&&matHit.mat==='steel','Ray into shipping container must report steel material');
 const clearPath=computeMultiBandAcousticPath([2,1.5,85],[2,1.5,75]);
 const blockedPath=computeMultiBandAcousticPath([-7.8,1.4,13],[-7.8,1.4,2]);
 assert(!clearPath.occluded&&clearPath.occlusion===0&&Number.isFinite(clearPath.lloydNotchHz),'Clear LOS path must not be occluded and must compute Lloyd mirror notch');
 assert(blockedPath.occluded&&blockedPath.blockerMat==='steel'&&blockedPath.occlusion>0.2&&blockedPath.cutoffHz<clearPath.cutoffHz&&blockedPath.directGain<clearPath.directGain,'Steel container must occlude, filter, and attenuate direct sound');
 assert(blockedPath.bandGains.low>blockedPath.bandGains.mid&&blockedPath.bandGains.mid>blockedPath.bandGains.high,'UTD Fresnel diffraction must preserve <300Hz low-band wrap better than high-band shadow');
 // 6. Analytical Fermat Method-of-Images Early Reflections & 3-Zone Enclosure Estimator
 const imgTaps=traceImageSourceReflections([2,1.6,76],[0,1.6,82],6);
 const taps=traceEarlyReflections([2,1.6,76],[0,1.6,82],6);
 assert(imgTaps.length>=1&&imgTaps.every(t=>t.analytical&&t.mat==='steel'&&t.delay>0.005),'Method-of-Images must find exact analytical steel-wall reflections');
 assert(taps.length>=2&&taps.every(t=>t.delay>0.005&&t.gain>0&&Number.isFinite(t.cutoffHz)),'Harbor cargo yard must produce multiple physical early-reflection slapback taps');
 const envAlley=estimateEnclosure([13.6,1.6,71]);
 const envOpen=estimateEnclosure([-23.0,1.6,2]);
 assert(envAlley.enclosure>envOpen.enclosure,'Container canyon enclosure must exceed open west pier enclosure');
 // 7. All 14 Physical Modal Synthesis Buffers, WaveShaper, & 3-Zone Velvet-Noise + Eigenmode IRs
 const curve=synthesizeWaveShaperCurve(2.4,512);
 assert(curve.length===512&&curve.every(v=>Number.isFinite(v)&&v>=-1&&v<=1),'WaveShaper curve must be finite in [-1, 1]');
 const modalKinds=['blast','sub300','crack','rail','bolt','steel','wood','concrete','brass','water','glass','cloth','breath','foghorn'];
 for(const kind of modalKinds){
  const buf=synthesizeModalSamples(48000,kind);
  let rms=0;for(const v of buf){assert(Number.isFinite(v)&&Math.abs(v)<=1);rms+=v*v;}
  assert(Math.sqrt(rms/buf.length)>0.015,`Modal buffer '${kind}' must have audible non-zero energy`);
 }
 for(const style of ['open','alley','overhead']){
  const ir=generateHarborIR2(48000,style==='open'?1.6:1.1,style);
  assert(ir.rt60Low>ir.rt60High,`Harbor IR '${style}' must damp highs faster than lows`);
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
 // 8. SoundEngin2 300Hz sub-frame control ticks, casing bounce & harbor water splash event verification
 const eng=new SoundEngin2();
 eng.setMode('stereo');eng.setMode('hrtf');eng.setMode('ultra300');eng.set(0.6);eng.resetMatch();
 eng.step300Hz(1/60,null);
 assert.equal(eng.stats.controlTicks300Hz,5,'1/60s frame must advance exactly 5 Sound Engin 2.0 300Hz control ticks');
 assert.equal(eng.getDiagnostics().engine,'Sound Engin 2.0');
 assert.equal(eng.getDiagnostics().controlRateHz,300);
 const ev=[],m=duel('MS10','unlimited',2,ev);
 assert(m.trigger(m.player));
 for(let i=0;i<360;i++)m.step(h,{});
 assert(ev.some(e=>e.type==='casing'),'Ejected shell casings must emit physical bounce events');
 // Fire into west harbor water to verify Minnaert water splash event
 const evW=[],mW=duel('MS10','unlimited',2,evW);
 Object.assign(mW.player,{x:-23.5,y:0,z:0,yaw:-Math.PI*0.5,pitch:-0.25});
 assert(mW.trigger(mW.player));
 for(let i=0;i<180;i++)mW.step(h,{});
 assert(evW.some(e=>e.type==='impact'&&e.mat==='water'),'Shot into west harbor bay must emit water splash impact event');
 // Klatt Physical Vocal-Tract Formant Plan check (NV2.6 Force Vocal DSP)
 const vGasp=computeVocalFormantPlan('STARTLE',{f0Hz:168,tractScale:1.06,stress:0.82,tempo:1.25});
 const vRadio=computeVocalFormantPlan('SWING_NOW',{f0Hz:185,tractScale:1.12,stress:0.45,tempo:1.10});
 assert(vGasp.mode==='gasp'&&vRadio.mode==='speech'&&vRadio.syllables.length>=2,'Sound Engin 2.0 Klatt Vocal DSP must synthesize startle gasps and multi-syllable radio speech');
 console.log('Sound Engin 2.0 (300Hz-Class) OK:',{
  controlHz:SOUND_CONTROL_HZ,catalog:SOUND_CATALOG_COUNT,modalBuffers:modalKinds.length,
  clearHz:Math.round(clearPath.cutoffHz),blockedHz:Math.round(blockedPath.cutoffHz),
  utdBands:{low:+blockedPath.bandGains.low.toFixed(3),mid:+blockedPath.bandGains.mid.toFixed(3),high:+blockedPath.bandGains.high.toFixed(3)},
  dopplerPts:curve300.curve.length,imgTaps:imgTaps.length,waterSplash:true,klattVocal:true
 });
}
{
 // NV2.6 Force (Default Flagship AI) + NV2.5 humain + NV 2.4 Manusia + NV2.3 HUMAN + NV2 Classic + NV2.1 Spy Unified Fusion,
 // S-Tier Embodied Kinetic/Vocal/Squad-Force Suite, Zero-Wallhack Proof, Fair Benchmark & 360Hz CPU Budget
 assert.equal(NV26_FORCE_VERSION,'NV2.6 Force');
 assert.equal(NV25_HUMAIN_VERSION,'NV2.5 humain');
 assert.equal(NV24_MANUSIA_VERSION,'NV 2.4 Manusia');
 assert.equal(NV23_HUMAN_VERSION,'NV2.3 HUMAN');
 assert.equal(NV2_HUMAN_VERSION,NV23_HUMAN_VERSION,'nv2-human.js backward-compat shim must preserve NV2.3 HUMAN version');
 assert(HumanMind===HumanPsycheV23&&HumanVisionModel===HumanPerceptionV23&&HumanMotorAim===HumanOFC_AimV23&&HumanGazeDirector===HumanGazeV23&&HumanCommsRelay===HumanSquadCommsV23,'nv2-human.js must preserve legacy NV2.3 re-exports');

 // Bottleneck Fix #2: WEAPON_BAND must formally register RD20 / RD30 / RD40 & DF1 OUT
 for (const wId of ['SW T','SRA','D1','MS10','DF1 OUT','RD20','RD30','RD40']) {
  assert(WEAPON_BAND[wId]&&WEAPON_BAND[wId].ideal>0,`WEAPON_BAND must register ${wId}`);
 }

 const mHuman=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:'DF1 OUT',allyNv21:0});
 assert.equal(mHuman.aiModel,'human');
 assert.equal(mHuman.nv.version,NV26_FORCE_VERSION);
 assert.equal(mHuman.allyNv21Slot,0);assert.equal(mHuman.spyActor,null);
 assert(mHuman.actors.filter(a=>!a.human).every(a=>a.aiVersion===NV26_FORCE_VERSION&&!a.isSpy&&typeof a.humanPersona==='string'&&a.humanPersona.length>0),'Default NPCs must run NV2.6 Force with distinct personas');
 const archetypes=new Set(mHuman.actors.filter(a=>!a.human).map(a=>a.humanArchetype));
 assert(archetypes.size>=3,`3v3 NV2.6 Force match must showcase >=3 distinct human archetypes (got ${[...archetypes]})`);

 // Classic NV2, NV2.3 HUMAN, NV 2.4 Manusia & NV2.5 humain fallbacks preserved for 5-generation comparison
 const mClassic=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:'DF1 OUT',allyNv21:0,aiModel:'classic'});
 assert.equal(mClassic.nv.version,'NV2');
 assert(mClassic.actors.filter(a=>!a.human).every(a=>a.aiVersion==='NV2'&&!a.isSpy));
 const mManusia=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:'DF1 OUT',allyNv21:0,aiModel:'manusia'});
 assert.equal(mManusia.nv.version,NV24_MANUSIA_VERSION);
 const mHumain=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:'DF1 OUT',allyNv21:0,aiModel:'humain'});
 assert.equal(mHumain.nv.version,NV25_HUMAIN_VERSION);

 // Bottleneck Fix #1: NV2.1 Spy Ally Selector (3V3-only) ALSO fuses full NV2.6 Force embodied cognitive/kinetic/vocal cores!
 const mNagi=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:'DF1 OUT',allyNv21:1});
 assert.equal(mNagi.allyNv21Slot,1);assert.equal(mNagi.spyActor,mNagi.actors[1]);
 assert.equal(mNagi.actors[1].name,'NAGI');assert.equal(mNagi.actors[1].aiVersion,'NV2.1');assert.equal(mNagi.actors[1].isSpy,true);
 assert.equal(mNagi.actors[2].aiVersion,NV26_FORCE_VERSION);assert.equal(mNagi.actors[2].isSpy,false);
 assert(mNagi.actors.filter(a=>a.team===1).every(a=>a.aiVersion===NV26_FORCE_VERSION&&!a.isSpy));
 const nagiB=mNagi.nv.brains.get(mNagi.actors[1].id);
 assert(nagiB.spy&&nagiB.body instanceof ForceBodyLanguageV26&&nagiB.inference instanceof HumainActiveInferenceV25&&nagiB.ddm instanceof HumainDecisionDDM_V25&&nagiB.mind instanceof ForcePsycheV26&&nagiB.tom instanceof ForceCounterBrainV26&&nagiB.vision instanceof HumainMultisensoryV25&&nagiB.gaze instanceof HumainFixationGazeV25&&nagiB.humanAim instanceof ForceSensorimotorV26&&nagiB.tactics instanceof ForceTacticsV26,'3v3 Spy ally NAGI must integrate all NV2.6 Force cores alongside SpyEngine');

 const mKai=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:'DF1 OUT',allyNv21:2});
 assert.equal(mKai.allyNv21Slot,2);assert.equal(mKai.spyActor,mKai.actors[2]);
 assert.equal(mKai.actors[2].name,'KAI');assert.equal(mKai.actors[2].aiVersion,'NV2.1');assert.equal(mKai.actors[2].isSpy,true);
 assert.equal(mKai.actors[1].aiVersion,NV26_FORCE_VERSION);assert.equal(mKai.actors[1].isSpy,false);
 const kaiB=mKai.nv.brains.get(mKai.actors[2].id);
 assert(kaiB.spy&&kaiB.body instanceof ForceBodyLanguageV26&&kaiB.inference instanceof HumainActiveInferenceV25&&kaiB.ddm instanceof HumainDecisionDDM_V25&&kaiB.mind instanceof ForcePsycheV26&&kaiB.tom instanceof ForceCounterBrainV26&&kaiB.vision instanceof HumainMultisensoryV25&&kaiB.gaze instanceof HumainFixationGazeV25&&kaiB.humanAim instanceof ForceSensorimotorV26&&kaiB.tactics instanceof ForceTacticsV26,'3v3 Spy ally KAI must integrate all NV2.6 Force cores alongside SpyEngine');

 for (const non3v3 of ['1v1','1v2']) {
  const mIso=new Match({mode:non3v3,limit:'points',multiplier:2,loadout:'DF1 OUT',allyNv21:1});
  assert.equal(mIso.allyNv21Slot,0,`${non3v3} must ignore allyNv21`);
  assert.equal(mIso.spyActor,null,`${non3v3} must not spawn a Spy actor`);
  assert(mIso.actors.every(a=>!a.isSpy));
 }

 // NV2.5 humain 8-Core Embodied Cognitive-Neuroscience Unit Verification:
 // Core 1 & 2 (HumainActiveInferenceV25 + HumainDecisionDDM_V25): Free-Energy Entropy, Surprise & Mid-Motion Change-of-Mind
 {
  const inf=new HumainActiveInferenceV25(random(701),CALLSIGN_PROFILES_V25.NAGI);
  inf.reset(0,0);
  const sBlind=inf.observeEvidence(-14,52,0.9,2.0);
  const sFront=inf.observeEvidence(-14,-45,0.9,2.1);
  assert(sBlind>sFront,'Active Inference must assign higher Free-Energy surprise to blind rear flank than expected front');
  const ddm=new HumainDecisionDDM_V25(random(702),CALLSIGN_PROFILES_V25.KAI);
  const actD={hp:100,shield:10,mag:20,reload:0};
  const bD={visibleEnemies:[{id:3}],seen:true,targetId:3,underFireAt:-10,recentDamage:0,state:'一斉突入',peekPhase:'peek'};
  const mD={challengeBalance:0.6,hotHand:0.4,matchPointIntensity:0,isSuppressed:()=>false};
  const tD={getEnemyShieldWindow:()=>2.0,predictEnemyReloadSoon:()=>({imminent:true}),getEnemyPreAimRisk:()=>0.1};
  for (let i=0;i<90;i++) ddm.step(actD,bD,1/60,i/60,mD,tD,null);
  assert.equal(ddm.decision,'COMMIT');
  actD.hp=42;actD.shield=0;bD.visibleEnemies=[{id:3},{id:4}];bD.underFireAt=1.6;bD.recentDamage=32;
  const cm={humainChangeOfMinds:0,humainHesitations:0};
  for (let i=0;i<120;i++) ddm.step(actD,bD,1/60,1.6+i/60,mD,tD,cm);
  assert(cm.humainChangeOfMinds>=1,'Ratcliff DDM must trigger mid-motion Change-of-Mind abort under sudden 1v2 pressure');
 }
 // Core 3 (HumainAffectivePsycheV25): 16-dim personas, Blascovich Challenge/Threat, BPM, Stamina, Breath-Hold, Adrenaline Dump, Nemesis Respect
 {
  for (const cs of ['NAGI','KAI','RIN','SORA','AO']) {
   assert(CALLSIGN_PROFILES_V25[cs]&&typeof CALLSIGN_PROFILES_V25[cs].ja==='string'&&CALLSIGN_PROFILES_V25[cs].epistemicCuriosity>0,`Callsign ${cs} must have unique 16-dim humain persona`);
  }
  assert.notEqual(CALLSIGN_PROFILES_V25.NAGI.aggression,CALLSIGN_PROFILES_V25.KAI.aggression,'NAGI and KAI must have distinct personalities');
  const dummyA={id:1,team:0,name:'NAGI',gun:'SRA',x:0,y:0,z:20,yaw:0,hp:100,shield:10,vx:5.4,vz:0,crouch:0,onGround:true};
  const dummyBack={id:4,team:1,x:0,y:0,z:32};
  const mind=new HumainAffectivePsycheV25(dummyA,random(77),false);
  mind.arousal=0.56;mind.stress=0.12;mind.confidence=0.35;
  const flowGood=mind.getFlowFactor();
  assert(flowGood>1.0&&mind.isInFlow(),'Optimal arousal + confidence must produce Flow State (>1.0)');
  const stRes=mind.onDamaged(dummyA,dummyBack,18,5.0,{humanStartles:0});
  assert(stRes.startled&&mind.isStartled(5.05)&&stRes.freezeDur>=0.12,'Rear ambush must trigger authentic human Startle Reflex freeze');
  mind.stress=0.90;
  assert(mind.getFlowFactor()<flowGood,'High stress must degrade Yerkes-Dodson performance factor');
  const mBefore=mind.morale;
  mind.onTeamEvent('ally_kill',6.0,true);
  assert(mind.morale>mBefore,'Team morale contagion must rise on nearby ally kill');
  for (let i=0;i<60;i++) mind.step(dummyA,0.05,7.0+i*0.05,false,{aliveAllies:1,aliveEnemies:3,killsToWin:1});
  assert(mind.isClutching()&&mind.clutchLevel>0.55,'1v3 disadvantage must trigger 1vX Clutch Awakening');
  assert(mind.heartRate>100&&mind.stamina<0.80&&mind.matchPointIntensity>0.7,'Somatic heart rate, stamina drain & match-point focus must evolve organically');
  mind.stress=0.68;
  mind.onKill(10.5,dummyBack,{manusiaAdrenalineDumps:0});
  assert(mind.postFightShake>0.40&&mind.hotHand>0.3,'High-stress/clutch kill must trigger Post-Clutch Adrenaline Dump & Hot-Hand momentum');
  mind.onDeath(dummyA,dummyBack,12.0);
  mind.onDeath(dummyA,dummyBack,24.0);
  assert.equal(mind.nemesisId,4,'Repeated killer must become episodic Nemesis');
  assert(mind.getNemesisRespect(4)>=0.8,'Repeated deaths to same killer must build Nemesis Tactical Respect');
  mind.reset();
  assert.equal(mind.nemesisId,4,'Nemesis episodic memory must survive respawn reset()');
  assert(mind.traumaAngles.length>=1,'Trauma danger angles must survive respawn reset()');
 }
 // Core 4 (HumainMetaMindV25): Self-Exposure Pre-Aim Risk, Trigger Discipline, Fair-Play Mental Ammo Counter, 5s Shield Clock, Anti-Pattern & Bait Trap
 {
  const tom=new HumainMetaMindV25(random(77),CALLSIGN_PROFILES_V25.NAGI,true);
  const me={id:1,x:0,y:0,z:20,yaw:0,hp:95};
  tom.recordSelfExposed(0,20,4,10.0);
  assert(tom.getEnemyPreAimRisk(me,10.5)>0.65,'Self-exposure at corner must elevate enemy pre-aim risk');
  me.x=10;
  assert(tom.getEnemyPreAimRisk(me,11.0)<0.05,'Silent rotation away must collapse enemy pre-aim risk');
  const unaware={id:4,x:10,y:0,z:2,yaw:0};
  assert.equal(tom.evaluateTriggerDiscipline(me,unaware,{dist:18,quietEyeShot:false,alignPerceived:0.04},14.0,{stress:0.1},{manusiaTriggerDisciplines:0}),true,'Flanker behind unaware enemy must engage brief Trigger Discipline hold');
  for (let i=0;i<8;i++) tom.onObservedEnemyShot(4,'SW T',15+i*0.3);
  assert(tom.predictEnemyReloadSoon(4,17.6,{manusiaAmmoReads:0}).imminent,'Fair-play mental ammo counter must predict imminent SW T reload');
  tom.onEnemyShieldBroken(4,18.0);
  assert(tom.getEnemyShieldWindow(4,20.0)>2.5&&tom.getEnemyShieldWindow(4,23.5)===0,'5.0s enemy shield-recovery mental clock must track vulnerability window');
  assert.equal(tom.recordOwnPeek(PEEK_STYLES.WIDE,19.0,null),false);
  assert.equal(tom.recordOwnPeek(PEEK_STYLES.WIDE,20.0,null),true,'Repeating peek style must trigger Mix-Up pattern-break detection');
 }
 // Core 5 (HumainMultisensoryV25): 3-Zone Retinal Vision, Cross-Modal Binding, Static Camo Delay, Saccadic Suppression, +38% Priming, Hick-Hyman, Cowan K=4
 {
  const vis=new HumainMultisensoryV25(random(99),false);
  const obs={id:1,x:0,y:0,z:20,yaw:0};
  const fovealE={id:2,x:0,y:0,z:6,vx:0,vz:0,crouch:0,flash:0};
  const periphStill={id:3,x:14,y:0,z:12,vx:0,vz:0,crouch:1,flash:0};
  const periphFlash={id:4,x:14,y:0,z:12,vx:0,vz:0,crouch:0,flash:0.08};
  const rFov=vis.evaluateSighting(obs,fovealE,0.08,1.0,null,-1,null);
  const rStill=vis.evaluateSighting(obs,periphStill,0.08,1.0,null,-1,null);
  const rFlash=vis.evaluateSighting(obs,periphFlash,0.08,1.0,null,-1,null);
  assert(rFov.recognized&&rFov.zone==='foveal','Close dead-center foveal target must recognize immediately');
  assert(!rStill.recognized&&rStill.zone==='peripheral','Crouched stationary peripheral enemy must NOT instant-snap on 1 frame');
  assert(rFlash.progress>rStill.progress*2.0,'Muzzle flash in peripheral vision must dramatically accelerate visual salience');
  const visCalm=new HumainMultisensoryV25(random(101),false);
  const visWhip=new HumainMultisensoryV25(random(101),false);
  const paraE={id:6,x:5.5,y:0,z:8,vx:0,vz:0,crouch:0,flash:0};
  const rCalm=visCalm.evaluateSighting(obs,paraE,0.04,1.0,null,-1,null,{yawRate:0.4,visibleCount:1});
  const rWhip=visWhip.evaluateSighting(obs,paraE,0.04,1.0,null,-1,null,{yawRate:7.5,visibleCount:1});
  assert(rWhip.saccadicSuppressed&&rWhip.progress<rCalm.progress,'High yaw-rate head whip must trigger saccadic suppression');
  const visPrime=new HumainMultisensoryV25(random(102),false);
  visPrime.primeAttention(Math.atan2(paraE.x-obs.x,-(paraE.z-obs.z)),0,paraE.x,paraE.z,2.0,'callout',1.0);
  const rPrime=visPrime.evaluateSighting(obs,paraE,0.04,1.05,null,-1,null,{yawRate:0.2,visibleCount:1});
  assert(rPrime.primed&&rPrime.progress>rCalm.progress*1.30,'Attention priming must accelerate recognition by ~38%');
  const visHick=new HumainMultisensoryV25(random(103),false);
  const rHick3=visHick.evaluateSighting(obs,paraE,0.04,1.0,null,-1,null,{yawRate:0.2,visibleCount:3});
  assert(rHick3.progress<rCalm.progress,'Hick-Hyman multi-enemy load (N=3) must slow per-target reaction slightly');
  for (let id=10;id<16;id++) vis.upsertWorkingMemory(id,{x:id,y:1.2,z:0,confidence:0.4+(id-10)*0.1,source:'visual'},2.0+id*0.1);
  assert.equal(vis.workingMemory.size,4,'Cowan working memory must enforce strict K=4 capacity');
  const tr=vis.onBulletWhiz(obs,{dir:[0,0,1]},0.9,5.0,null,{humanWhizTraces:0});
  assert(tr&&Math.abs(tr.yaw)<0.35,'Bullet whiz traveling +Z must back-trace to shooter bearing ~0 (-Z)');
  const roofCue=vis.onEchoArrival(obs,{kind:'step',perceivedPos:[0,4.2,10],occluded:false,isDecoy:false},6.0,null,null);
  assert(roofCue.elevated&&roofCue.pitch>0.14,'Rooftop acoustic cue must produce positive upward gaze pitch');
  vis.onSeismicKnockVictim(obs,{id:5},[1,1,19],7.0,{humanKnockRepositions:0});
  assert(vis.needsKnockReposition(7.2)&&vis.knockedContainerId===5,'Steel knock must trigger container reposition directive');
 }
 // Core 6 (HumainSensorimotorV25): Fitts+Min-Jerk flick, 2-Stroke Mouse-Lift 180-deg Whip, Meyer Submove, Smooth Pursuit
 {
  const motor=new HumainSensorimotorV25(random(55),false,HUMAN_ARCHETYPES.DUELIST);
  assert(motor.triggerBallisticFlick(0,0,0.28,0,1.0,0,false,null));
  const durSmall=motor.flickDur;
  motor.motorPhase='PURSUIT';
  assert(motor.triggerBallisticFlick(0,0,1.15,0,2.0,0,false,null));
  const durLarge=motor.flickDur;
  assert(durLarge>durSmall,'Fitts Law ballistic flick duration must grow logarithmically with angle amplitude');
  motor.motorPhase='PURSUIT';
  const ml={humainMouseLifts:0,humanFlicks:0,humanOvershoots:0};
  assert(motor.triggerBallisticFlick(0,0,2.85,0,4.0,0.1,false,ml)&&motor.liftPending&&ml.humainMouseLifts===1,'Large >112 deg rear whip must trigger 2-stroke mouse-lift reset');
  const ofca=new HumainSensorimotorV25(random(71),false,CALLSIGN_PROFILES_V25.RIN);
  const act={id:1,x:0,y:0,z:20,yaw:0,pitch:0,vx:0,vz:0,crouch:0,aimPose:1,onGround:true,gun:'SRA',rd:null,df:null};
  const tgt={id:2,x:-3,y:0,z:0,yaw:0,vx:4.2,vy:0,vz:0,crouch:0,lean:0,onGround:true};
  let tSim=1.0,steadyErr=0,revErr=0;
  for (let i=0;i<150;i++){tgt.x+=tgt.vx*(1/120);tSim+=1/120;const r=ofca.step(act,1/120,tSim,{seenTarget:tgt,wpn:weapons.SRA,fallbackYaw:0,fallbackPitch:0});if(i>90)steadyErr+=r.alignTrue;}
  steadyErr/=60;
  tgt.vx=-4.2;
  for (let i=0;i<20;i++){tgt.x+=tgt.vx*(1/120);tSim+=1/120;const r=ofca.step(act,1/120,tSim,{seenTarget:tgt,wpn:weapons.SRA,fallbackYaw:0,fallbackPitch:0});if(i>=4&&i<16)revErr+=r.alignTrue;}
  revErr/=12;
  assert(steadyErr<0.12&&revErr>steadyErr,'Smooth pursuit must track steady velocity crisply yet authentically lag/swim on sudden A-D reversal');
 }
 // Core 7 & 8 (HumainEmbodiedTacticsV25 + HumainSocialMindV25): 5 Peek Styles, Silent Walk, Anatomical Lean & 10-Channel Delayed Comms
 {
  const tac=new HumainEmbodiedTacticsV25(random(88),CALLSIGN_PROFILES_V25.NAGI,false);
  const seenStyles=new Set();
  const a={id:1,x:0,y:0,z:20,hp:85,shield:5,crouch:0,aimPose:0};
  const e={id:4,gun:'SRA',hp:80,shield:5,reload:0};
  for (let i=0;i<120;i++) seenStyles.add(tac.selectPeekStyle(a,{},e,10+i,null,null));
  assert.equal(seenStyles.size,Object.keys(PEEK_STYLES).length,`All 5 tactical peek styles must be reachable (got ${[...seenStyles]})`);
  const pace=tac.computeMovementPace(a,{state:'潜入裏どり中',seen:null,lastPos:[0,5],dodgeUntil:-1,underFireAt:-10},10,null,true);
  assert(pace.silentWalk&&pace.paceFactor<=0.86,'Tactical silent walk must hold paceFactor<=0.86 (sprintAmt<=0.30 -> zero EchoPulse footsteps)');
  const leanA={id:9,x:7.1,y:0,z:83.6,yaw:0,crouch:0,onGround:true};
  const anLean=tac.computeAnatomicalLean(leanA,{cover:{x:7.1,z:83.6},state:'ピーク射撃'},0.25,10.0,null);
  assert(anLean<0,`Anatomical cover-edge lean must lean strictly OUT away from solid steel (got ${anLean})`);

  const comms=new HumainSocialMindV25(random(123));
  const chs=Object.values(COMMS_CHANNELS_V25);
  assert.equal(chs.length,10);
  for (let i=0;i<chs.length;i++) comms.emitCallout(0,1,3,5+i,10,chs[i],10.0,null);
  assert.equal(comms.drainReady(0,10.18).length,0,'Human voice callouts must NOT teleport instantaneously in <180ms');
  assert.equal(comms.drainReady(0,11.0).length,10,'All 10 NV2.5 humain squad comms channels must deliver after human speech delay');
 }
 // NV2.6 Force Embodied Kinetic, Vocal & Squad-Force Unit Verification:
 {
  assert.equal(Object.keys(COMMS_CHANNELS_V26).length,15,'NV2.6 Force must expose 15 tactical voice/radio channels');
  for (const cs of ['NAGI','KAI','RIN','SORA','AO']) {
   assert(VOICE_PROFILES_V26[cs]&&VOICE_PROFILES_V26[cs].f0Hz>100&&VOICE_PROFILES_V26[cs].tractScale>0.8,`Callsign ${cs} must define physical Klatt vocal profile`);
  }
  const body=new ForceBodyLanguageV26(random(2610));
  const bAct={id:1,team:0,name:'NAGI',x:0,y:0,z:20,yaw:0,pitch:0,vx:0,vz:0,flash:0,recoil:0,reload:0,alive:true};
  const bStub={state:'同期待機',seen:false,target:null,tom:null};
  const bMet={forceGestures:0,forceStartleVisuals:0};
  body.triggerGesture(FORCE_GESTURES.WAVE_SWING,0.8,1.0,2,bMet);
  for (let i=0;i<24;i++) body.step(bAct,bStub,1/60,1.0+i/60,{heartRate:96,stress:0.25},{eyeYaw:0.52},null);
  assert(bAct.expr&&bAct.expr.headYaw>0.25&&bAct.expr.gesture===FORCE_GESTURES.WAVE_SWING&&bAct.expr.gestureBlend>0.55,'ForceBodyLanguageV26 must decouple cervical head-yaw and raise IK WAVE_SWING hand signal');
  bAct.flash=0.09;
  for (let i=0;i<18;i++) body.step(bAct,bStub,1/60,1.45+i/60,{heartRate:110,stress:0.4},{eyeYaw:0},null);
  assert(bAct.expr.gestureBlend<0.25,'Firing rifle must smoothly drop tactical hand-signal back onto handguard');

  const fp=new ForcePsycheV26(bAct,random(2611),false);
  const calmP=fp.getVocalProsody(1.0);
  fp.onDamaged(bAct,{id:4,team:1,x:0,y:0,z:32},26,2.0,{humanStartles:0});
  const panicP=fp.getVocalProsody(2.05);
  assert(panicP.f0Hz>calmP.f0Hz+10&&panicP.tempo>calmP.tempo&&fp.consumePendingAudioEvent()?.kind==='startle','Stress/blind ambush must raise vocal pitch/tempo and queue somatic startle gasp');

  const tempo=new ForceTempoCoordV26(random(2612));
  const ord=tempo.issuePlayerOrder('SWING',{id:0,team:0,x:0,z:20},[0,-4],5.0);
  assert(ord&&ord.kind==='SWING'&&tempo.getActiveSync(0,5.2)?.goAt===ord.goAt,'Interactive player SWING order must schedule synchronized shared-clock countdown');
  assert(tempo.scoreCrossfireAngle(14,4,[0,0],[-8,20])>tempo.scoreCrossfireAngle(-7,18,[0,0],[-8,20])+8,'Orthogonal crossfire geometry must strongly beat same-lane stacking');

  const fComms=new ForceSocialVoiceV26(random(2613));
  assert(fComms.buildSignalPayload(bAct,'SWING_NOW',6.0,{refX:0,refZ:-4,syncGoAt:6.72,prosody:calmP,playerTeam:0})?.isRadio===true,'Ally voice signal must build tactical radio payload');
 }

 // HumanAimController: NV2.1 strictly faster visual reaction, acquisition & tracking than NV2
 const aimNv2=new HumanAimController(random(42),false);
 const aimNv21=new HumanAimController(random(42),true);
 assert(aimNv21.reactionDelay<aimNv2.reactionDelay,'NV2.1 must have strictly faster visual reaction delay');
 assert(aimNv21.acquireMin<aimNv2.acquireMin&&aimNv21.acquireMax<aimNv2.acquireMax,'NV2.1 must have faster target acquisition latency');
 assert(aimNv21.maxYawRate>aimNv2.maxYawRate&&aimNv21.baseWander<aimNv2.baseWander,'NV2.1 must have crisper tracking & steadier aim');

 // Bottleneck Fix #4: Walkable 6-Direction + Cover-Priority Dodge avoids wall-slamming
 {
  const mD=new Match({mode:'1v1',limit:'unlimited',multiplier:2,loadout:'SRA'});
  const npc=mD.actors[1];
  const bD=mD.nv.brains.get(npc.id);
  Object.assign(npc,{x:6.7,y:0,z:77.0,vx:0,vz:0,yaw:0,alive:true,onGround:true});
  bD.dodgeCooldownAt=0;bD.dodgeUntil=-1;
  mD.shots.push({team:0,p:[6.4,1.02,90.0],dir:[0,0,-1],speed:100});
  mD.nv.dodgeIncomingShots(npc,bD);
  assert(mD.time<bD.dodgeUntil,'Walkable 6-dir dodge must trigger against incoming projectile');
  assert(walkable(npc.x+bD.dodgeVec[0]*0.72,npc.z+bD.dodgeVec[1]*0.72,0.42,npc.y),'Chosen dodge vector MUST be walkable (zero wall-slamming!)');
 }

 // 100% Fair-Play Zero-Wallhack Proof (BOTH NV2.6 Force & NV2.1 Spy + 3D Diegetic Cues behind steel container!)
 const mFair=new Match({mode:'3v3',limit:'unlimited',multiplier:2,loadout:'DF1 OUT',allyNv21:1});
 const spy=mFair.spyActor;
 const stdAlly=mFair.actors[2];
 const spyBrain=mFair.nv.brains.get(spy.id);
 const stdBrain=mFair.nv.brains.get(stdAlly.id);
 Object.assign(mFair.player,{x:-7.8,y:0,z:14.2,yaw:0,pitch:0,vx:0,vz:0});
 Object.assign(spy,{x:-7.8,y:0,z:13,yaw:0,pitch:0,vx:0,vz:0});
 Object.assign(stdAlly,{x:-7.8,y:0,z:13.6,yaw:0,pitch:0,vx:0,vz:0});
 for (const e of mFair.actors.filter(a=>a.team===1)) Object.assign(e,{x:-7.8,y:0,z:2,yaw:Math.PI,vx:0,vz:0});
 assert(obstruction(eyeOf(spy),targetPoint(mFair.actors[3]))<=1,'Test geometry must be occluded by steel container');
 for (let i=0;i<24;i++) mFair.step(h,{});
 assert.equal(spyBrain.spy.sightings.size,0,'Spy Engine must NOT record occluded enemies (zero wallhack)');
 assert.equal(spyBrain.vision.workingMemory.size,0,'NV2.6 Force Spy workingMemory must NOT record occluded enemies (zero wallhack)');
 assert.equal(stdBrain.vision.workingMemory.size,0,'NV2.6 Force standard workingMemory must NOT record occluded enemies (zero wallhack)');
 assert.equal(stdBrain.tom.enemyAmmo.size,0,'NV2.6 Force ToM ammo tracker must NOT see occluded enemies (zero wallhack)');
 // Prove 3D diegetic enemy startle arc NEVER renders behind steel container!
 mFair.actors[3].expr={...(mFair.actors[3].expr||{}),startleArc:1.0,speaking:1.0,syncRally:1.0,baitReady:1.0};
 const mdBlocked=movingDetails(mFair).count;
 mFair.actors[3].expr.startleArc=0;
 assert.equal(mdBlocked,movingDetails(mFair).count,'3D diegetic enemy startle arc MUST be strictly LOS-gated behind steel containers (zero wallhack!)');

 Object.assign(spy,{x:2,y:0,z:85,yaw:0,pitch:0,vx:0,vz:0});
 Object.assign(mFair.actors[3],{x:2,y:0,z:73,yaw:Math.PI,vx:0,vz:0});
 assert(obstruction(eyeOf(spy),targetPoint(mFair.actors[3]))>1,'Direct LOS test geometry must be unobstructed');
 for (let i=0;i<36;i++) mFair.step(h,{});
 assert(spyBrain.spy.sightings.size>=1&&spyBrain.vision.workingMemory.size>=1,'NV2.6 Force + Spy must record enemy upon direct unobstructed visual LOS');

 // Full 3V3 NV2.6 Force + NV2.1 NAGI simulation + KAI Spy operational check
 for (let i=0;i<360*250&&!mNagi.ended;i++) mNagi.step(h,{});
 const nagiMetrics=mNagi.nv.metrics;
 const nagiStatus=mNagi.nv.getSpyStatus();
 assert(nagiStatus&&nagiStatus.active&&nagiStatus.name==='NAGI'&&typeof nagiStatus.label==='string','getSpyStatus() must expose live NV2.1 Spy HUD state');
 assert(nagiMetrics.spySightings>5&&nagiMetrics.spyPredictions>5&&nagiMetrics.spyFlanks>5&&nagiMetrics.spyDodges>10,'NV2.1 NAGI Spy Engine must visually sight, predict, flank, and dodge');
 assert(nagiMetrics.spyBackstabs>0,'NV2.1 NAGI Spy Engine must achieve rear/flank ambush hits');
 assert(nagiMetrics.nv21Shots>20&&nagiMetrics.nv21Hits>0,'NV2.1 NAGI must actively engage and score hits');
 assert(nagiMetrics.humanFlicks>10&&nagiMetrics.humanCornerScans>30&&nagiMetrics.humanCornerEdges>10&&nagiMetrics.humanCheckSix>5&&nagiMetrics.humanCallouts>5,'NV2.6 Force cognitive/motor/gaze/comms behaviors must actively run in live combat');
 assert(nagiMetrics.humanRepeekAborts>0&&nagiMetrics.shoulderBait>0,`Bottleneck Fix #3: repeekAborts (${nagiMetrics.humanRepeekAborts}) & shoulderBait (${nagiMetrics.shoulderBait}) must fire in live 3v3 combat`);
 assert(nagiMetrics.humanQuietEyeShots>20&&nagiMetrics.humanSilentSteps>0&&nagiMetrics.humanTradeSwings>0,'NV2.6 Force Quiet Eye, Silent Walk & Delayed Trade Swings must activate in live combat');
 assert(nagiMetrics.manusiaBreathHolds>0&&nagiMetrics.manusiaAnatomicalLeans>0&&nagiMetrics.manusiaCurvedTurns>0,'Inherited NV 2.4 Somatic Breath-Hold, Anatomical Cover Lean & Curved Corner-Rounding must activate');
 assert(nagiMetrics.humainEpistemicScans>0&&nagiMetrics.humainAsymStrafes>0&&nagiMetrics.humainCrossModalLocks>0&&nagiMetrics.humainPostKillChecks>0&&nagiMetrics.humainBuddyGlances>0,'Inherited NV2.5 humain Active Inference, Asymmetric Strafes, Cross-Modal Binding, Post-Kill Checks & Buddy Glances must activate in live combat');
 assert(nagiMetrics.forceVocalSignals>5&&nagiMetrics.forceGestures>5&&nagiMetrics.forceStartleVisuals>0,`NV2.6 Force visible/audible vocal signals (${nagiMetrics.forceVocalSignals}), IK gestures (${nagiMetrics.forceGestures}) & visible startles (${nagiMetrics.forceStartleVisuals}) must activate in live combat`);
 const nagiHitRate=nagiMetrics.nv21Hits/nagiMetrics.nv21Shots;
 assert(nagiHitRate>0.10&&nagiHitRate<0.75,`NV2.1 NAGI hit rate must remain human-realistic (got ${(nagiHitRate*100).toFixed(1)}%)`);

 for (let i=0;i<360*180&&!mKai.ended;i++) mKai.step(h,{});
 const kaiMetrics=mKai.nv.metrics;
 assert(kaiMetrics.spySightings>5&&kaiMetrics.spyPredictions>5&&kaiMetrics.spyFlanks>5&&kaiMetrics.spyDodges>10,'NV2.1 KAI Spy Engine must visually sight, predict, flank, and dodge');
 assert(kaiMetrics.nv21Shots>15&&kaiMetrics.nv21Hits>0,'NV2.1 KAI must actively engage and score hits');

 // Fair Side-Swapped NV2.6 Force vs NV2 Classic 3v3 Benchmark + 360Hz CPU Budget Verification (100% pure symmetric allNpc!)
 let benchHumanWins=0,benchClassicWins=0,benchHumanKills=0,benchClassicKills=0,benchTicks=0,benchMs=0;
 const benchGuns=['MS10','RD30','D1'];
 for (let g=0;g<4;g++) {
  const humanTeam=g%2;
  const teamAiModels=humanTeam===0?['human','classic']:['classic','human'];
  const mb=new Match({mode:'3v3',limit:'points',multiplier:2,loadout:'SRA',allyNv21:0,allNpc:true,teamAiModels,benchGuns});
  const t0=performance.now();
  let ticks=0;
  for (let i=0;i<360*180&&!mb.ended;i++){mb.step(h,{});ticks++;}
  benchMs+=performance.now()-t0;
  benchTicks+=ticks;
  const hk=mb.scores[humanTeam],ck=mb.scores[1-humanTeam];
  benchHumanKills+=hk;benchClassicKills+=ck;
  if (hk>ck) benchHumanWins++; else if (ck>hk) benchClassicWins++;
 }
 const avgMsPerTick=benchMs/Math.max(1,benchTicks);
 const budget360Pct=(avgMsPerTick/(1000/360))*100;
 assert(benchHumanWins>=benchClassicWins&&benchHumanKills>benchClassicKills,`NV2.6 Force must outperform NV2 Classic in fair equal-weapon 3v3 (wins ${benchHumanWins}-${benchClassicWins}, kills ${benchHumanKills}-${benchClassicKills})`);
 assert(avgMsPerTick<1.0,`360Hz CPU budget exceeded: ${avgMsPerTick.toFixed(4)} ms/tick (${budget360Pct.toFixed(1)}% of 2.778ms budget)`);

 console.log('NV2.6 Force + NV2.1 Spy OK:',{
  force:{
   vocalSignals:nagiMetrics.forceVocalSignals,gestures:nagiMetrics.forceGestures,
   startleVisuals:nagiMetrics.forceStartleVisuals,crossfireSwings:nagiMetrics.forceCrossfireSwings,
   baitPartners:nagiMetrics.forceBaitPartners,reversalLocks:nagiMetrics.forceReversalLocks,
   postKillSlides:nagiMetrics.forcePostKillSlides,suppressPins:nagiMetrics.forceSuppressPins
  },
  humain:{
   epistemicScans:nagiMetrics.humainEpistemicScans,changeOfMinds:nagiMetrics.humainChangeOfMinds,
   hesitations:nagiMetrics.humainHesitations,mouseLifts:nagiMetrics.humainMouseLifts,
   recoilOverpulls:nagiMetrics.humainRecoilOverpulls,crosshairIntercepts:nagiMetrics.humainCrosshairIntercepts,
   crossModalLocks:nagiMetrics.humainCrossModalLocks,camoDelays:nagiMetrics.humainCamoDelays,
   patternBreaks:nagiMetrics.humainPatternBreaks,baitTraps:nagiMetrics.humainBaitTraps,
   postKillChecks:nagiMetrics.humainPostKillChecks,syncSwings:nagiMetrics.humainSyncSwings,
   asymStrafes:nagiMetrics.humainAsymStrafes,breathResets:nagiMetrics.humainBreathResets,
   buddyGlances:nagiMetrics.humainBuddyGlances
  },
  manusia:{
   flicks:nagiMetrics.humanFlicks,submoves:nagiMetrics.manusiaSubmovements,breathHolds:nagiMetrics.manusiaBreathHolds,
   adrenalineDumps:nagiMetrics.manusiaAdrenalineDumps,triggerDisc:nagiMetrics.manusiaTriggerDisciplines,
   ammoReads:nagiMetrics.manusiaAmmoReads,acousticFeints:nagiMetrics.manusiaAcousticFeints,
   smokeDeploys:nagiMetrics.manusiaSmokeDeploys,anatomicalLeans:nagiMetrics.manusiaAnatomicalLeans,
   cornerPrefires:nagiMetrics.manusiaCornerPrefires,curvedTurns:nagiMetrics.manusiaCurvedTurns,
   quietEyeShots:nagiMetrics.humanQuietEyeShots,cornerEdges:nagiMetrics.humanCornerEdges,
   buddyCoverGaze:nagiMetrics.humanBuddyCoverGaze,callouts:nagiMetrics.humanCallouts,
   tradeSwings:nagiMetrics.humanTradeSwings,reloadCovers:nagiMetrics.humanReloadCovers,
   repeekAborts:nagiMetrics.humanRepeekAborts,shoulderBait:nagiMetrics.shoulderBait,
   silentSteps:nagiMetrics.humanSilentSteps,angleIsolations:nagiMetrics.humanAngleIsolations
  },
  nagi:{ended:mNagi.ended,scores:mNagi.scores,time:Math.round(mNagi.time)+'s',hitRate:(nagiHitRate*100).toFixed(1)+'%',sightings:nagiMetrics.spySightings,predictions:nagiMetrics.spyPredictions,flanks:nagiMetrics.spyFlanks,backstabs:nagiMetrics.spyBackstabs,dodges:nagiMetrics.spyDodges},
  kai:{scores:mKai.scores,time:Math.round(mKai.time)+'s',sightings:kaiMetrics.spySightings,predictions:kaiMetrics.spyPredictions,flanks:kaiMetrics.spyFlanks,backstabs:kaiMetrics.spyBackstabs,dodges:kaiMetrics.spyDodges},
  vsClassic:{wins:`${benchHumanWins}-${benchClassicWins}`,kills:`${benchHumanKills}-${benchClassicKills}`,kd:+(benchHumanKills/Math.max(1,benchClassicKills)).toFixed(2),avgMsPerTick:+avgMsPerTick.toFixed(4),budget360HzPct:+budget360Pct.toFixed(2)}
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
console.log('360Hz sim, weapon specs (DF1 OUT 95-mag 2x rate, MS10, RD20/30/40, DF40 II ARV1.3/AA1.3/AA1.4), FluxGI 1.0, SchlierenOptics 1.0, BallisticCore-X, EchoPulse 1.0, NV-Synapse 1.0, AeroVortex 1.0, ThermoFlux 1.0, SpectraField 1.0, ResonanceCore 1.0, ChronoTrace 1.0, FermatCore 1.0, Lightweight Mode LOD, 16-joint sculpted rig (uExpr IK gestures & cervical head-look), KHDR, Shadow Flame 1.0 Flash/Pro, Sound Engin 2.0 (300Hz-Class + Klatt Vocal DSP), NV2.6 Force Embodied Squad-Force AI (NV2.5 humain / NV 2.4 Manusia / NV2.3 HUMAN compat), NV2.1 Spy Engine, and all matches passed.');


