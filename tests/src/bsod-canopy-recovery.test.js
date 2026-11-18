import { jest } from '@jest/globals';
import { canopyBluffRecoveryMs, CANOPY_BLUFF_RECOVERY_RANK } from '../../src/systems/PermanentUpgrades.js';
import { BsodBluffTracker } from '../../src/systems/BsodBluffTracker.js';
import { EVT } from '../../src/events.js';

const FakePhaser={
 Scene:class{},
 Physics:{ Matter:{Matter:{Bodies:{rectangle:()=>({}),circle:()=>({})},Body:{}}}},
 Renderer:{WebGL:{Pipelines:{PostFXPipeline:class{}}}},
 GameObjects:{Container:class{},Graphics:class{},BitmapText:class{},Zone:class{},Image:class{},Rectangle:class{},Text:class{}},
 BlendModes:{ADD:1},Scenes:{Events:{UPDATE:'update',SHUTDOWN:'shutdown',DESTROY:'destroy'}},
 Math:{Between:a=>a,Clamp:(v,a,b)=>Math.min(b,Math.max(a,v))},
};
jest.unstable_mockModule('phaser',()=>({default:FakePhaser}));
jest.unstable_mockModule('../../src/shaders/GlitchPipeline.js',()=>({GlitchPipeline:{install(){}}}));
const { RunScene }=await import('../../src/scenes/RunScene.js');

function makeScene({enabled=true,rank=30,initialFuel=100,fullMs=1300}={}){
 const scene=Object.create(RunScene.prototype),emitted=[],bonuses=[];
 scene.sled={x:800,y:200,grounded:false,parachuteMs:140,airBrakeActive:false,
   canopyFuelFullMs:fullMs,parachuteFuelMs:initialFuel};
 scene.bsodState={active:true,gapPx:1000,relativeAirX:420,atmosphereDensity:1};
 scene.bsodBluffs=new BsodBluffTracker();
 scene.game={events:{emit:(k,p)=>emitted.push({k,p})}};
 scene.bonus=(points,kind)=>bonuses.push({points,kind});
 scene.nearMissCount=0;
 scene.crashed=false;scene.bsodCaught=false;scene.runTimeMs=0;
 scene.upgradeRun={enabled,ranks:{canopy:rank}};
 return {scene,emitted,bonuses};
}

function earn(scene){
 scene.updateBsodBluff();
 scene.bsodState.gapPx=225;scene.runTimeMs=120;
 scene.updateBsodBluff();
 scene.bsodState.gapPx=455;scene.sled.x+=320;scene.runTimeMs=900;
 scene.updateBsodBluff();
}

describe('earned canopy recharge during Surfing the Void',()=>{
 test('below high tier remains one reservoir per jump, even after a real bluff',()=>{
  expect(CANOPY_BLUFF_RECOVERY_RANK).toBe(12);
  for(const rank of [0,1,11]){
    expect(canopyBluffRecoveryMs(rank,1,1300)).toBe(0);
    const {scene,emitted}=makeScene({rank});
    earn(scene);
    expect(scene.sled.parachuteFuelMs).toBe(100);
    expect(emitted.find(e=>e.k===EVT.BSOD_BLUFF)?.p.canopyRecoveredMs).toBeUndefined();
  }
 });
 test('rank 12 milestone starts with a modest earned refill, not an off-by-one dead rank',()=>{
   const {scene,emitted}=makeScene({rank:12});
   expect(canopyBluffRecoveryMs(12,1,1300)).toBeGreaterThan(0);
   earn(scene);
   expect(scene.sled.parachuteFuelMs).toBeGreaterThan(100);
   expect(emitted.find(e=>e.k===EVT.BSOD_BLUFF)?.p.canopyRecoveredMs).toBeGreaterThan(0);
 });
 test('rank 30 earns a meaningful but capped refill only after a successful escape',()=>{
  const {scene,emitted,bonuses}=makeScene();
  scene.updateBsodBluff();
  scene.bsodState.gapPx=225;scene.runTimeMs=120;
  scene.updateBsodBluff();
  expect(scene.sled.parachuteFuelMs).toBe(100);
  scene.bsodState.gapPx=455;scene.sled.x+=320;scene.runTimeMs=900;
  scene.updateBsodBluff();
  const events=emitted.filter(e=>e.k===EVT.BSOD_BLUFF);
  expect(events).toHaveLength(1);
  expect(events[0].p).toMatchObject({hazardType:'bsod',chain:1,surfing:false,points:150});
  expect(events[0].p.canopyRecoveredMs).toBeCloseTo(canopyBluffRecoveryMs(30,1,1300),5);
  expect(scene.sled.parachuteFuelMs).toBeGreaterThan(900);
  expect(scene.sled.parachuteFuelMs).toBeLessThan(1300);
  expect(bonuses).toEqual([{points:150,kind:'nearMiss'}]);
  scene.updateBsodBluff();
  expect(emitted.filter(e=>e.k===EVT.BSOD_BLUFF)).toHaveLength(1);
 });
 test('when purchased but mode OFF, or official daily, no refill can occur',()=>{
  for(const {enabled,rank} of [{enabled:false,rank:100},{enabled:true,rank:11}]){
    const {scene,emitted}=makeScene({enabled,rank});
    earn(scene);
    expect(scene.sled.parachuteFuelMs).toBe(100);
    expect(emitted.find(e=>e.k===EVT.BSOD_BLUFF)?.p.canopyRecoveredMs).toBeUndefined();
  }
 });
 test('successful recharge caps at the tank maximum and never creates a free new tank',()=>{
  const {scene,emitted}=makeScene({rank:100,initialFuel:1200});
  earn(scene);
  expect(scene.sled.parachuteFuelMs).toBe(1300);
  expect(emitted.find(e=>e.k===EVT.BSOD_BLUFF)?.p.canopyRecoveredMs).toBe(100);
 });
 test('recovery cannot be earned from a BSOD collision, proximity, or landing',()=>{
  for(const reason of ['collision','grounded','proximity']){
    const {scene,emitted}=makeScene();
    scene.updateBsodBluff();
    scene.bsodState.gapPx=225;scene.runTimeMs=120;
    scene.updateBsodBluff();
    if(reason==='collision')scene.bsodState.gapPx=0;
    else if(reason==='grounded'){scene.sled.grounded=true;scene.bsodState.gapPx=455}
    else scene.bsodState.gapPx=310;
    scene.updateBsodBluff();
    expect(scene.sled.parachuteFuelMs).toBe(100);
    expect(emitted.filter(e=>e.k===EVT.BSOD_BLUFF)).toHaveLength(0);
  }
 });
 test('subsequent legitimate bluffs restore progressively less, with no hard chain cap',()=>{
  const f1=canopyBluffRecoveryMs(30,1,1300);
  const f2=canopyBluffRecoveryMs(30,2,1300);
  const f10=canopyBluffRecoveryMs(30,10,1300);
  expect(f1).toBeGreaterThan(f2);
  expect(f2).toBeGreaterThan(f10);
  expect(f10).toBeGreaterThan(0);
  expect(canopyBluffRecoveryMs(1000000,1,1300)).toBeLessThan(1300*.74);
  for(const args of [[30,0,1300],[30,-1,1300],[30,1,-3],[30,1,Infinity],[NaN,1,1300]])
    expect(canopyBluffRecoveryMs(...args)).toBe(0);
 });
});
