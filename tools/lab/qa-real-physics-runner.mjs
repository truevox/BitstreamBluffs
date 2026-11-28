/** Actual production RunScene + Phaser Matter, shared between main thread and
 * browser Worker for QA only. No alternative physics, no game save/write/award.
 */
import Phaser from 'phaser';
import {RunScene} from '../../src/scenes/RunScene.js';
import {REG} from '../../src/constants.js';
import {loadContent} from '../../src/data/index.js';
import {captureCausalState} from '../../src/systems/replay/fingerprintCapture.js';
import {fingerprintState} from '../../src/systems/replay/fingerprint.js';
import {physicsQaPad} from './qa-real-physics-policy.mjs';

const Matter=Phaser.Physics.Matter.Matter;
function inert(){
 const fn=function(){return proxy;};
 const proxy=new Proxy(fn,{
  get(_t,prop){if(prop==='then')return undefined;
   if(prop===Symbol.toPrimitive)return()=>0;
   if(prop==='length')return 0;return proxy;},
  set(){return true;},apply(){return proxy;},construct(){return proxy;},
 });
 return proxy;
}
class Emitter{
 constructor(){this._h={};}
 on(k,fn){(this._h[k] ||= []).push(fn);return this;}
 once(k,fn){return this.on(k,fn);}
 off(k,fn){this._h[k]=(this._h[k]||[]).filter(f=>f!==fn);return this;}
 emit(k,...args){for(const fn of (this._h[k]||[]).slice())fn(...args);return true;}
}
class World extends Emitter{
 constructor(){super();this.Matter=Matter;this.engine=Matter.Engine.create();
  this.localWorld=this.engine.world;this.autoUpdate=false;
  Matter.Events.on(this.engine,'collisionStart',e=>this.emit('collisionstart',e));
  Matter.Events.on(this.engine,'collisionActive',e=>this.emit('collisionactive',e));}
 add(b){Matter.Composite.add(this.localWorld,b);return b;}
 remove(b){Matter.Composite.remove(this.localWorld,b,true);return b;}
 step(delta){Matter.Engine.update(this.engine,delta);}
}
const PALETTE=new Proxy({}, {get:(_t,k)=>typeof k==='string'?0x123456:undefined});
export function runPhysicsEpisode({seed,biomeMask=0,level=1,policy='neutral',ticks=360,
 stubRender=true}={}){
 if(typeof seed!=='string'||seed.length>200||!seed||
  !Number.isInteger(biomeMask)||biomeMask<0||biomeMask>2047||
  !Number.isInteger(level)||level<1||level>50||
  !['neutral','tricks'].includes(policy)||!Number.isInteger(ticks)||ticks<1||ticks>36000)
  throw new TypeError('Invalid real physics QA episode');
 const registryMap=new Map([
  [REG.CONTENT,loadContent()],[REG.SEED,seed],[REG.PROFILE,{level}],
  [REG.SETTINGS,{}],...(biomeMask?[[REG.BIOME_MASK,biomeMask]]:[]),
 ]);
 const registry={get:k=>registryMap.get(k),set:(k,v)=>{registryMap.set(k,v);return registry;},
  remove:k=>registryMap.delete(k)};
 const scene=new RunScene(),events=new Emitter();
 Object.assign(scene,{
  registry,add:new Proxy({}, {get:()=>()=>inert()}),
  matter:{world:new World()},cameras:{main:inert()},
  scene:{stop(){},launch(){},get:()=>null,start(){},pause(){},resume(){},isActive:()=>true},
  events,game:{registry,events:new Emitter(),canvas:inert(),config:{},renderer:inert()},
  input:inert(),sound:inert(),tweens:inert(),time:inert(),textures:inert(),
  scale:inert(),sys:{isActive:()=>true,settings:{}},make:inert(),load:inert(),
  anims:inert(),plugins:inert(),
 });
 if(stubRender){scene.renderFrame=()=>{};scene.refreshPalette=()=>{};
  scene.updateCamera=()=>{};scene.snapCamera=()=>{};}
 Object.defineProperty(scene,'_palette_stub',{value:PALETTE});
 scene.create();
 scene.inputRouter={poll:()=>physicsQaPad(policy,scene.simClock.tick+1),setEnabled(){}};
 const checkpoints=[];
 for(let i=0;i<ticks;i++){
  if(scene.crashed)break;
  const before=scene.simClock.tick;
  scene.update(0,scene.simClock.tickMs);
  if(scene.simClock.tick>before&&scene.simClock.tick%120===0){
   const fp=fingerprintState(captureCausalState(scene,{chunkMemo:false}));
   checkpoints.push({tick:scene.simClock.tick,combined:fp.combined,subsystems:fp.subsystems});
  }
 }
 const report={seed,biomeMask,policy,tick:scene.simClock.tick,
  crashed:!!scene.crashed,score:scene.score.getTotal(),distance:scene.score.distanceM,
  checkpoints,recorderFingerprints:scene.ghostRecorder?.fingerprints?.map(
   f=>({tick:f.tick,combined:f.combined})),
  recorderFailures:scene.ghostRecorder?.fingerprintErrorCount??0};
 return report;
}
