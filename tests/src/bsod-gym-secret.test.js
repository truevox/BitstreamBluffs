import { jest } from '@jest/globals';
import { ProfileStore, sanitizeProfile } from '../../src/systems/ProfileStore.js';
import { BSOD_GYM_PRICE, gymVisible, gymOwned, gymAdvanced,
  GYM_MASTERY_CHAIN, GYM_READY_MS, GYM_DEFAULT_SETUP, GYM_SETUP_OPTIONS,
  gymSetupForProfile, sanitizeGymSetup, placeGymWall } from '../../src/systems/BsodGym.js';
import { BsodBluffTracker } from '../../src/systems/BsodBluffTracker.js';
import { upgradeLoadoutForRun, canopyBluffRecoveryMs } from '../../src/systems/PermanentUpgrades.js';
import { BsodPursuit, BSOD_DEFAULTS } from '../../src/systems/BsodPursuit.js';
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
 test('Gym price is the Marvin-approved 200-shard trial price; no implicit unlock',()=>{
   expect(BSOD_GYM_PRICE).toBe(200);
 });
 test('Gym allows only realistic launch inputs; BSOD is forward-only and keeps live acceleration',()=>{
   const lvl=12,fx=upgradeLoadoutForRun({upgradesEnabled:true,
     upgrades:{canopy:12,bsodGrace:15}}).effects;
   const config={...BSOD_DEFAULTS,
     accelerationPxS2:BSOD_DEFAULTS.accelerationPxS2*fx.bsodAccelerationMul};
   const live=new BsodPursuit({sledLeftEdgeX:1000,level:lvl,config});
   const gym=new BsodPursuit({sledLeftEdgeX:1000,level:lvl,config});
   const setup=sanitizeGymSetup({gapPx:220,wallSpeedPxS:1500,
     launchSpeedPxS:1000,launchRisePxS:-900,launchHeightPx:1100});
   placeGymWall(gym,1000,setup);
   expect(gym.accelerationPxS2).toBe(live.accelerationPxS2);
   expect(gym.config.compressionPxS).toBe(live.config.compressionPxS);
   expect(gym.wallSpeedPxS).toBe(1500);
   expect(gym.wallX).toBe(780);
   for(let i=0;i<1000;i++){
     const was=gym.wallX;
     gym.advance(8);
     expect(gym.wallX).toBeGreaterThan(was);
     expect(gym.wallSpeedPxS).toBeGreaterThanOrEqual(1500);
   }
   const bad=sanitizeGymSetup({gapPx:0,wallSpeedPxS:-500,
     launchHeightPx:999999,launchSpeedPxS:-100,launchRisePxS:900});
   expect(bad).toEqual(GYM_DEFAULT_SETUP);
   expect(gymSetupForProfile({bsodGym:{owned:true,advanced:false,setup}})).toEqual(GYM_DEFAULT_SETUP);
   expect(GYM_SETUP_OPTIONS.wallSpeedPxS.every(n=>n>0)).toBe(true);
 });
 test('Gym shares EXACT normal canopy recovery rank gate, no special practice refills',()=>{
   expect(canopyBluffRecoveryMs(0,1,880)).toBe(0);
   expect(canopyBluffRecoveryMs(11,1,1400)).toBe(0);
   expect(canopyBluffRecoveryMs(12,1,1400)).toBeGreaterThan(0);
   expect(canopyBluffRecoveryMs(12,2,1400)).toBeLessThan(canopyBluffRecoveryMs(12,1,1400));
   // Both Gym and live RunScene use the ONE normal-world function.
   const src=RunScene.prototype.updateBsodBluff.toString();
   expect(src).toContain('canopyBluffRecoveryMs(rank, event.chain, full)');
   expect(src).not.toContain('gymRechargeMs(');
 });
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
 test('Five consecutive scored Bluffs IN GYM reveal nested setup; normal-world five never do',()=>{
   expect(GYM_MASTERY_CHAIN).toBe(5);
   const run=(inside,withLanding=false)=>{
     const {s,disk}=store();
     s.save({...s.profile,bank:500});
     s.discoverBsodGym();s.buyBsodGym();
     const {scene,emitted}=bluffScene(s);
     scene.bsodGym=inside;scene.sled.parachuteMs=250;
     for(let i=0;i<5;i++){
       if(withLanding && i===2){
         scene.sled.grounded=true;scene.bsodState.gapPx=700;
         scene.updateBsodBluff();scene.sled.grounded=false;
       }
       const t=1000+i*1300;
       scene.bsodState.gapPx=1000;scene.runTimeMs=t;scene.updateBsodBluff();
       scene.bsodState.gapPx=225;scene.runTimeMs=t+150;scene.updateBsodBluff();
       scene.bsodState.gapPx=455;scene.runTimeMs=t+850;scene.sled.x+=330;
       scene.updateBsodBluff();
     }
     return {s,disk,scene,emitted};
   };
   const live=run(false);
   expect(live.s.profile.bsodGym.advanced).toBeUndefined();
   expect(live.emitted.some(([e])=>e===EVT.GYM_SETUP_UNLOCKED)).toBe(false);
   const landed=run(true,true);
   expect(landed.s.profile.bsodGym.advanced).toBeUndefined();
   const gym=run(true);
   expect(gym.s.profile.bsodGym.advanced).toBe(true);
   expect(gym.s.profile.bsodGym.setup).toEqual(GYM_DEFAULT_SETUP);
   expect(gym.emitted.filter(([e])=>e===EVT.GYM_SETUP_UNLOCKED)).toHaveLength(1);
   expect(gym.emitted.filter(([e])=>e===EVT.BSOD_BLUFF)).toHaveLength(5);
   expect(new ProfileStore({storage:gym.disk}).load().bsodGym.advanced).toBe(true);
   expect(upgradeShopLayout({profile:gym.s.profile}).rows.find(r=>r.id==='bsodGymSetup'))
     .toMatchObject({kind:'gymSetupLink',label:'GYM SETUP'});
 });
 test('Advanced setup is persisted atomically only after in-Gym mastery and stays bounded',()=>{
   const {s,disk}=store();s.save({...s.profile,bank:550});
   s.discoverBsodGym();s.buyBsodGym();
   expect(s.setGymSetup({wallSpeedPxS:1500}).ok).toBe(false);
   expect(upgradeShopLayout({profile:s.profile}).rows.some(r=>r.id==='bsodGymSetup')).toBe(false);
   expect(s.unlockGymSetup().unlocked).toBe(true);
   expect(s.unlockGymSetup().unlocked).toBe(false);
   const beforeBank=s.profile.bank;
   const tx=s.setGymSetup({gapPx:220,wallSpeedPxS:1500,
     launchHeightPx:700,launchSpeedPxS:1000,launchRisePxS:-900});
   expect(tx.ok).toBe(true);
   expect(s.profile.bank).toBe(beforeBank);
   expect(gymSetupForProfile(s.profile).wallSpeedPxS).toBe(1500);
   expect(gymSetupForProfile(new ProfileStore({storage:disk}).load()).gapPx).toBe(220);
   const bad=s.setGymSetup({wallSpeedPxS:-3000,gapPx:-100,
     launchSpeedPxS:Infinity});
   expect(bad.ok).toBe(true);
   expect(gymSetupForProfile(s.profile)).toEqual(GYM_DEFAULT_SETUP);
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
   expect(emitted.find(([evt])=>evt===EVT.GYM_ATTEMPT_RESET)?.[1]).toEqual({attempt:1,readyMs:GYM_READY_MS});
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
    canopyFuelFullMs:880,parachuteFuelMs:0,
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
  expect(sled.parachuteFuelMs).toBe(880);
  expect(scene.gymReadyMs).toBe(GYM_READY_MS);
  expect(scene.gymRetries).toBe(1);
  expect(scene.bsod.wallSpeedPxS).toBe(GYM_DEFAULT_SETUP.wallSpeedPxS);
  expect(scene.bsod.accelerationPxS2).toBeCloseTo(1.15);
  expect(scene.saveStore.saveRun).not.toHaveBeenCalled();
  expect(scene.registry.set).not.toHaveBeenCalled();
  expect(calls.map(([k])=>k)).toEqual([EVT.GYM_ATTEMPT_RESET, EVT.BSOD_STATE_CHANGED]);
 });
});
