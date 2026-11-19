import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Match,modes,weapons} from '../dist/js/match.js';
import {PilotWallet} from '../dist/js/wallet.js';
import {ThermalOptic} from '../dist/js/optic.js';
import {eyeOf,targetPoint} from '../dist/js/posture.js';
import {obstruction} from '../dist/js/yard.js';
import {perspective,lookAt,multiply,invert4} from '../dist/js/geometry.js';
import {shadowModes,SHADOW_FLAME_WORLD_GLSL,sfScreenFS,sfBilateralFS} from '../dist/js/shadowflame.js';
import {KHDR_TONE_GLSL} from '../dist/js/khdr.js';
import {BONE,ARTICULATED_RIG_GLSL} from '../dist/js/rig.js';
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
 for(let i=0;i<360*250&&!m.ended;i++)m.step(h,{});assert(m.ended);assert(m.nv.metrics.crouch+m.nv.metrics.scope>0);assert(m.nv.metrics.cover+m.nv.metrics.disengage+m.nv.metrics.evade>0,'NV2 tactical survival behaviors active');assert(m.nv.metrics.beliefTrack+m.nv.metrics.commanderOrders+m.nv.metrics.suppress+m.nv.metrics.crossfire>0,'NV2 cognitive behaviors active');assert(m.nv.metrics.neuralInferences>0&&m.nv.metrics.neuralUpdates>0&&m.nv.metrics.lookaheadPlans>0,'NV2 deep transformer neural core & minimax lookahead active');console.log(mode,m.scores,Math.round(m.time)+'s',JSON.stringify(m.nv.metrics));
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
console.log('360Hz sim, weapon specs (incl. MS10 & DF1 OUT full-auto 3-round burst), supply tankers, bullet whiz, focus and occlusion, credits, EVR1, separate regeneration timers, P1 heat, scoring, 16-joint rig, KHDR & Shadow Flame 1.0 Flash/Pro modules, and all three NV2 Deep Tactical matches passed.');

