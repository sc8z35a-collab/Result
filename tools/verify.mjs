import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Match,modes,weapons} from '../dist/js/match.js';
import {PilotWallet} from '../dist/js/wallet.js';
import {ThermalOptic} from '../dist/js/optic.js';
import {eyeOf,targetPoint} from '../dist/js/posture.js';
import {obstruction} from '../dist/js/yard.js';
const h=1/120;
function duel(loadout='DF1 OUT',limit='unlimited',multiplier=2,events=[]) {
  return new Match({mode:'1v1', limit, multiplier,loadout},event=>events.push(event));
}
function forward(m,actor,frames) {for(let i=0;i<frames;i++){m.time+=h;m.systems(actor,h)}}
function arrange(m,x,z1,z2){const a=m.player,b=m.actors[1];Object.assign(a,{x,y:0,z:z1,yaw:.025,pitch:Math.atan2(-.38,z1-z2)});Object.assign(b,{x,y:0,z:z2});return [a,b]}
function burst(m) {const a=m.player;assert(m.trigger(a));while(a.burstLeft||a.cooldown>1e-7)forward(m,a,1)}
for(const [id,cap,damage,rate,velocity,burstSize] of [['SW T',10,9,100,100,1],['SRA',30,6,120,80,1],['D1',40,5,100,60,2],['DF1 OUT',50,2.8,150,65,3]]) {
 const w=weapons[id];assert.deepEqual([w.capacity,w.damage,w.rate,w.velocity,w.burst],[cap,damage,rate,velocity,burstSize]);const m=duel(id);burst(m);assert.equal(m.shots.length,burstSize);assert.equal(m.player.mag,cap-burstSize);
}
{
 const m=duel(),[p,t]=arrange(m,2,85,75);assert(obstruction(eyeOf(p),targetPoint(t))>1);forward(m,p,43);assert(!p.df.locked);forward(m,p,9);assert(p.df.locked);const yaw=p.yaw;burst(m);assert(Math.abs(p.yaw)<Math.abs(yaw)&&Math.abs(yaw-p.yaw)<=.0131);
 arrange(m,-7.8,13,2);assert(obstruction(eyeOf(p),targetPoint(t))<=1);const before=p.yaw;assert(m.trigger(p));assert.equal(before,p.yaw);forward(m,p,68);assert(!p.df.locked);
}
{
 const m=duel(),p=m.player;p.df.pattern='spread';p.df.boost=true;burst(m);assert.equal(m.shots.length,4);assert.equal(p.mag,47);assert.equal(p.df.p1,19);assert(new Set(m.shots.map(s=>s.dir.join(','))).size>=3);
 burst(m);assert.equal(m.shots.length,9);assert.equal(p.df.p1,17);assert.equal(p.mag,44);burst(m);burst(m);assert(!p.df.boost&&p.df.cooling>0);const left=p.df.p1,main=p.mag;burst(m);assert.equal(p.df.p1,left);assert.equal(p.mag,main-3);forward(m,p,610);assert.equal(p.df.cooling,0);
}
{
 const m=duel(),p=m.player;p.stock=97;p.shield=7;p.hp=44;p.df.p1=17;forward(m,p,359);assert.equal(p.stock,97);forward(m,p,1);assert.equal(p.stock,98);forward(m,p,239);assert.equal(p.shield,7);forward(m,p,1);assert.equal(p.shield,8);forward(m,p,359);assert.equal(p.df.p1,17);forward(m,p,1);assert.equal(p.df.p1,18);forward(m,p,3000);assert.deepEqual([p.stock,p.shield,p.df.p1,p.hp],[100,10,20,44]);p.mag=46;assert(m.reload(p));forward(m,p,222);assert.deepEqual([p.mag,p.stock],[50,96]);
}
{
 const ev=[],m=duel('DF1 OUT','points',2,ev),[p,t]=arrange(m,2,85,75);const target=targetPoint(t);p.yaw=0;p.pitch=Math.atan2(target[1]-eyeOf(p)[1],10);const until=(fn)=>{for(let i=0;i<8000&&!fn();i++){m.time+=h;m.systems(p,h);if(!p.cooldown&&!p.burstLeft)m.trigger(p);m.shots=m.shots.filter(s=>m.projectile(s,h));}};until(()=>!t.alive);assert(!t.alive&&p.kills===1);m.damage(t,p,1000);assert.deepEqual(m.scores,[1,0]);assert.equal(p.earned,10);assert.equal(t.earned,0);m.spawn(t);m.damage(t,p,111);assert(m.ended&&m.winner===0);assert.deepEqual(m.scores,[2,0]);assert.equal(p.earned,20);assert.equal(new Set(ev.filter(e=>e.type==='point').map(e=>e.receipt)).size,2);
}
for (const [mode,counts] of Object.entries(modes)) {
 const m=new Match({mode,limit:'points',multiplier:2,loadout:'DF1 OUT'});assert.deepEqual(m.goals,counts.map(c=>c*2));assert(m.actors.every(a=>a.human||a.gun!=='DF1 OUT'));
 for(let i=0;i<120*250&&!m.ended;i++)m.step(h,{});assert(m.ended);assert(m.nv.metrics.crouch+m.nv.metrics.scope>0);console.log(mode,m.scores,Math.round(m.time)+'s',JSON.stringify(m.nv.metrics));
}
{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};const w=new PilotWallet(()=>{});await w.ready;assert(!await w.change());assert(await w.change('m/1'));assert(!await w.change('m/1'));assert(await w.change());assert(!await w.change());const second=new PilotWallet(()=>{});await second.ready;assert.deepEqual(second.state,{units:5,evr:true});assert(!await second.change('m/1'));
}
{
 const require=createRequire(import.meta.url),{createCanvas}=require('@napi-rs/canvas');const canvas=createCanvas(256,192),src=createCanvas(640,480),context=src.getContext('2d');context.fillStyle='#303030';context.fillRect(0,0,640,480);const optic=new ThermalOptic(canvas),m=duel();const hot=(x,z1,z2,time)=>{const [p,t]=arrange(m,x,z1,z2);optic.draw({canvas:src,aspect:4/3},m,{pos:eyeOf(p),target:targetPoint(t),fov:42},time);const rgb=canvas.getContext('2d').getImageData(0,0,256,192).data;let n=0;for(let i=0;i<rgb.length;i+=4)if(rgb[i]>180)n++;return n};const seen=hot(2,85,75,1),hidden=hot(-7.8,13,2,2);assert(seen>1000&&hidden===0);console.log('Thermal sensor',canvas.width,canvas.height,'warm pixels',seen,'behind cover',hidden);
}
console.log('Weapon specs, focus and occlusion, credits, EVR1, separate regeneration timers, P1 heat, scoring and all three NV1.1 matches passed.');
