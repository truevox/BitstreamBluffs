import { jest } from '@jest/globals';
import { ProfileStore, sanitizeProfile } from '../../src/systems/ProfileStore.js';
import { BSOD_GYM_PRICE, gymVisible, gymOwned, GYM_CHASE } from '../../src/systems/BsodGym.js';
import { BsodBluffTracker } from '../../src/systems/BsodBluffTracker.js';
import { BsodPursuit } from '../../src/systems/BsodPursuit.js';
import { upgradeShopLayout } from '../../src/ui/ShopLayout.js';
import { EVT } from '../../src/events.js';
import { REG } from '../../src/constants.js';

const FakePhaser={
 Scene:class{}, Physics:{Matter:{Matter:{Bodies:{rectangle:()=>({}),circle:()=>({})},Body:{}}}},
 Renderer:{WebGL:{Pipelines:{PostFXPipeline:class{}}}},
 GameObjects:{Container:class{},Graphics:class{},BitmapText:class{},Zone:class{},Image:class{},Rectangle:class{},Text:class{}},
 BlendModes:{ADD:1},Scenes:{Events:{UPDATE:'update',SHUTDOWN:'shutdown',DESTROY:'destroy'}},
 Math:{Between:a=>a,Clamp:(v,a,b)=>Math.min(b,Math.max(a,v))},
};
jest.unstable_mockModule('phaser',()=>({default:FakePhaser}));
jest.unstable_mockModule('../../src/shaders/GlitchPipeline.js',()=>({GlitchPipeline:{install(){}}}));
const { RunScene }=await import('../../src/scenes/RunScene.js');

function store(){
 const records=new Map();
 const disk={getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v)};
 const s=new ProfileStore({storage:disk});s.load();
 return {s,disk};
}
function bluffScene(profileStore){
 const scene=Object.create(RunScene.prototype),emitted=[],registrations=[];
 scene.sled={x:800,y:230,grounded:false,parachuteMs:280,airBrakeActive:false,
   canopyFuelFullMs:880,parachuteFuelMs:110};
 scene.bsodState={active:true,gapPx:1000,relativeAirX:400,atmosphereDensity:1};
 scene.bsodBluffs=new BsodBluffTracker();
 scene.game={events:{emit:(k,v)=>emitted.push([k,v])}};
 scene.bonus=jest.fn();scene.nearMissCount=0;scene.crashed=false;
 scene.bsodCaught=false;scene.runTimeMs=0;
 scene.registry={get:k=>k===REG.PROGRESSION?{store:profileStore}:null,
   set:(k,v)=>registrations.push([k,v])};
 scene.upgradeRun={enabled:false,ranks:{}};
 return {scene,emitted,registrations};
}
function scoreBluff(r){
 r.updateBsodBluff();
 r.bsodState.gapPx=225;r.runTimeMs=120;r.updateBsodBluff();
 r.bsodState.gapPx=455;r.runTimeMs=850;r.sled.x+=320;r.updateBsodBluff();
}
describe('Secret BSOD Gym discovery, shop and practice state',()=>{
 test('Gym is absent by default, never accidentally revealed by purchasing a canopy rank',()=>{
  const {s}=store();
  expect(s.profile.bsodGym).toEqual({discovered:false,owned:false});
  expect(gymVisible(s.profile)).toBe(false);
  expect(upgradeShopLayout({profile:s.profile}).rows.some(r=>r.kind==='gym')).toBe(false);
  expect(s.buyBsodGym().ok).toBe(false);
  expect(s.discoverBsodGym().discovered).toBe(true);
  expect(s.discoverBsodGym().discovered).toBe(false);
  expect(gymOwned(s.profile)).toBe(false);
  const row=upgradeShopLayout({profile:s.profile}).rows.find(r=>r.kind==='gym');
  expect(row).toMatchObject({label:'BSOD GYM',disabled:true});
  expect(row.state).toContain('LOCKED');
 });
 test('exactly one real midair scored escape reveals a Gym and emits a first-only discovery flag',()=>{
  const {s}=store(),{scene,emitted,registrations}=bluffScene(s);
  scene.updateBsodBluff(); // a far, safe glide cannot reveal the shop.
  expect(s.profile.bsodGym.discovered).toBe(false);
  scoreBluff(scene);
  expect(s.profile.bsodGym).toEqual({discovered:true,owned:false});
  expect(emitted.filter(([k])=>k===EVT.NEAR_MISS)).toHaveLength(1);
  expect(emitted.find(([k])=>k===EVT.NEAR_MISS)[1].gymDiscovered).toBe(true);
  expect(registrations.some(([k])=>k===REG.PROFILE)).toBe(true);
  scene.bsodState.gapPx=1000;scene.runTimeMs=1000;scene.updateBsodBluff();
  scene.bsodState.gapPx=225;scene.runTimeMs=1200;scene.updateBsodBluff();
  scene.bsodState.gapPx=455;scene.runTimeMs=2100;scene.sled.x+=400;scene.updateBsodBluff();
  expect(emitted.filter(([k])=>k===EVT.NEAR_MISS)).toHaveLength(2);
  expect(emitted.filter(([k])=>k===EVT.NEAR_MISS)[1][1].gymDiscovered).toBeUndefined();
 });
 test('Gym charges exactly once, persists ownership, and never writes on denied purchase',()=>{
  const {s,disk}=store();
  s.save({...s.profile,bank:BSOD_GYM_PRICE+33});
  const before=s.profile.bank;
  expect(s.buyBsodGym().ok).toBe(false);
  expect(s.profile.bank).toBe(before);
  s.discoverBsodGym();
  const tx=s.buyBsodGym();
  expect(tx.ok).toBe(true);
  expect(s.profile.bank).toBe(before-BSOD_GYM_PRICE);
  expect(s.profile.bsodGym).toEqual({discovered:true,owned:true});
  expect(s.buyBsodGym().ok).toBe(false);
  expect(s.profile.bank).toBe(33);
  expect(new ProfileStore({storage:disk}).load().bsodGym).toEqual({discovered:true,owned:true});
  expect(upgradeShopLayout({profile:s.profile}).rows.find(r=>r.kind==='gym').state).toBe('ENTER');
  expect(sanitizeProfile({...s.profile,bsodGym:{owned:true}}).bsodGym).toEqual({discovered:true,owned:true});
 });
 test('failed storage commit cannot debit bank or grant Gym',()=>{
  let snapshot=null,denied=false;
  const disk={getItem:()=>snapshot,setItem:(k,v)=>{if(denied)throw Error('storage full');snapshot=v}};
  const s=new ProfileStore({storage:disk});s.load();
  s.save({...s.profile,bsodGym:{discovered:true,owned:false},bank:BSOD_GYM_PRICE+5});
  denied=true;
  expect(s.buyBsodGym().ok).toBe(false);
  expect(s.profile.bank).toBe(BSOD_GYM_PRICE+5);
  expect(s.profile.bsodGym.owned).toBe(false);
 });
 test('Gym retry zeroes local score, tricks and shards without touching persistence',()=>{
   const scene=Object.create(RunScene.prototype);
   const emitted=[],score={
     reset:jest.fn(), getTotal:()=>0,getDistancePoints:()=>0,trickPoints:0,
   };
   const sled={
     x:2000,y:100,vx:220,body:{bounds:{min:{x:1980}}},
     canopyFuelFullMs:1500,parachuteFuelMs:0,
     setPose:jest.fn(function(x,y){this.x=x;this.y=y}),
   };
   scene.bsodGym=true;scene.startX=100;scene.sled=sled;
   scene.terrain={heightAt:()=>900};
   scene.bsod=new BsodPursuit({sledLeftEdgeX:1800});
   scene.bsodBluffs=new BsodBluffTracker();
   scene.bsodAtmosphere=()=>1;
   scene.score=score;
   scene.tricks={reset:jest.fn()};
   scene.game={events:{emit:(e,p)=>emitted.push([e,p])}};
   scene._resetBiomeEffects();
   scene.updateBlindOverlay=jest.fn();
   scene.safeSamples=[];scene._contactQueue=[];
   scene.trail={reset:jest.fn()};
   scene.nearMissCount=5;scene.shardCount=3;scene.shardTotal=60;
   scene.shardChain=2;scene.trickCounts={frontflip:2};scene.bestCombo=2.5;
   scene.maxAirtimeMs=1800;scene.lastTotal=300;
   scene._airTricks=4;scene._landings=2;
   scene.shardChainAt=120;scene.safeSamples=[{x:1700,t:4}];
   scene.gymAttemptStartX=123;
   scene.resetBsodGym();
   expect(score.reset).toHaveBeenCalledTimes(1);
   expect(scene.tricks.reset).toHaveBeenCalledTimes(1);
   expect(scene.nearMissCount).toBe(0);
   expect(scene.shardCount).toBe(0);
   expect(scene.shardTotal).toBe(0);
   expect(scene.trickCounts).toEqual({});
   expect(scene.bestCombo).toBe(1);
   expect(scene.lastTotal).toBe(0);
   expect(scene._airTricks).toBe(0);
   expect(scene._landings).toBe(0);
   expect(scene.shardChainAt).toBe(-1e9);
   expect(scene.safeSamples).toHaveLength(0);
   expect(scene.gymAttemptStartX).toBe(sled.x);
   expect(emitted.find(([evt])=>evt===EVT.GYM_ATTEMPT_RESET)?.[1]).toEqual({attempt:1});
   expect(emitted.map(([evt])=>evt)).toContain(EVT.SCORE_CHANGED);
   expect(emitted.map(([evt])=>evt)).toContain(EVT.BSOD_STATE_CHANGED);
 });
 test('temporary effects expire across Gym attempts without leaking biome or hazard state',()=>{
   const scene=Object.create(RunScene.prototype),events=[];
   scene.game={events:{emit:(name,payload)=>events.push([name,payload])}};
   scene.sled={scrambled:true};
   scene.updateBlindOverlay=jest.fn();
   scene._resetBiomeEffects();
   scene.boostMs=600;scene.boostId='packetBurst';scene.boostFactor=2;
   scene.slowmoMs=250;scene.slowMs=300;
   scene.scrambleMs=400;scene.glideMs=500;scene.glideId='slickWaxSpray';
   scene.stabilizeMs=100;scene.stabilizeId='gravityStabilizer';
   scene.blindMs=600;
   scene.wards.wards.push({id:'mapleWax'});
   scene.clearTemporaryEffects('gym-retry');
   for (const k of ['boostMs','slowmoMs','slowMs','scrambleMs','glideMs','stabilizeMs','blindMs'])
     expect(scene[k]).toBe(0);
   expect(scene.boostFactor).toBe(1);
   expect(scene.sled.scrambled).toBe(false);
   expect(scene.wards.wards).toHaveLength(0);
   expect(scene.updateBlindOverlay).toHaveBeenCalled();
   const ended=events.filter(([e])=>e===EVT.POWERUP_EXPIRED).map(([,p])=>p.id);
   expect(ended).toEqual(expect.arrayContaining(['packetBurst','clockPulse','mapleWax','slickWaxSpray','gravityStabilizer']));
   const effectEnd=events.filter(([e])=>e===EVT.EFFECT_END).map(([,p])=>p.effect);
   expect(effectEnd).toEqual(expect.arrayContaining(['slow','scramble','blind']));
   // Same cleanup is used by manual recovery: there is no longer a divergent timer path.
   expect(RunScene.prototype.manualReset.toString()).toContain("this.clearTemporaryEffects('respawn')");
 });
 test('BSOD observer exceptions cannot block frame continuation and are logged only once',()=>{
   const r=Object.create(RunScene.prototype),seen=[];
   const warn=jest.spyOn(console,'warn').mockImplementation(()=>{});
   r.game={events:{emit:()=>{throw Error('broken optional observer')}}};
   r.bsodState={active:true,gapPx:5};
   try {
     expect(()=>r.publishBsodState(r.bsodState)).not.toThrow();
     expect(()=>r.publishBsodState(r.bsodState)).not.toThrow();
     expect(r.bsodState.gapPx).toBe(5);
     expect(warn).toHaveBeenCalledTimes(1);
   } finally {warn.mockRestore();}
 });
 test('Gym death respawns a calm chase without writing records or changing profile',()=>{
  const scene=Object.create(RunScene.prototype);
  const calls=[],sled={
    x:3000,y:100,body:{bounds:{min:{x:2980}}},
    canopyFuelFullMs:GYM_CHASE.parachuteFuelMs,parachuteFuelMs:0,
    setPose:jest.fn(function(x,y){this.x=x;this.y=y}),
    vx:270,
  };
  scene.bsodGym=true;scene.startX=100;scene.sled=sled;
  scene.terrain={heightAt:x=>800};
  scene.bsod=new BsodPursuit({sledLeftEdgeX:2800});
  scene.bsodBluffs=new BsodBluffTracker();
  scene.bsodCaught=true;scene.pendingCrash={cause:'bsod'};
  scene.saveStore={saveRun:jest.fn()};
  scene.registry={set:jest.fn()};
  scene.game={events:{emit:(k,v)=>calls.push([k,v])}};
  scene._resetBiomeEffects();
  scene.updateBlindOverlay=jest.fn();
  scene.safeSamples=[];scene._contactQueue=[];
  scene.trail={reset:jest.fn()};
  scene.bsodAtmosphere=()=>1;
  scene.doCrash({cause:'bsod'}, {x:3000,y:100,vx:200,vy:0},200);
  expect(scene.crashed).toBe(false);
  expect(scene.pendingCrash).toBeNull();
  expect(scene.bsodCaught).toBe(false);
  expect(sled.setPose).toHaveBeenCalled();
  expect(sled.parachuteFuelMs).toBe(GYM_CHASE.parachuteFuelMs);
  expect(scene.gymRetries).toBe(1);
  expect(scene.bsod.wallSpeedPxS).toBe(GYM_CHASE.initialSpeedPxS);
  expect(scene.saveStore.saveRun).not.toHaveBeenCalled();
  expect(scene.registry.set).not.toHaveBeenCalled();
  expect(calls.map(([k])=>k)).toEqual([EVT.GYM_ATTEMPT_RESET, EVT.BSOD_STATE_CHANGED]);
 });
});
