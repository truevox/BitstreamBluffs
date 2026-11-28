/** #122 P0 long-haul cumulative exposure, NOT a 300-second uninterrupted
 * player survival or true browser Worker/Chromebook execution.
 * 36000 actual 120 Hz fixed-step ticks across deterministic restarted native
 * RunScene/Matter episodes, renderer on/off, every admitted biome mask.
 */
import {jest} from '@jest/globals';
import {installPhaserStub,createRun} from './headlessRun.js';
installPhaserStub(jest);
const {RunScene}=await import('../../src/scenes/RunScene.js');
const {REG}=await import('../../src/constants.js');
const {captureCausalState}=await import('../../src/systems/replay/fingerprintCapture.js');
const {fingerprintState,FP_SUBSYSTEMS}=await import('../../src/systems/replay/fingerprint.js');

const TARGET_TICKS=300*120;
const MASKS=[0,1,2,4,8,16,32,64,128,256,512,1024,0xffff];
const pad=(tick,policy)=>policy==='tricks'?{
 push:tick%600<450,tilt:tick%90<45?1:-1,heli:tick%80<40?1:0,
 airBrake:tick%120===40,variableHop:true,noAutoNudge:true,
 pressed:{hop:tick%135===1,airBrake:tick%120===40},
}:{push:tick%700<530,tilt:0,variableHop:true,noAutoNudge:true,
 pressed:{hop:tick%301===100}};
const fp=s=>fingerprintState(captureCausalState(s,{chunkMemo:false}));
const witness=s=>({tick:s.simClock.tick,crashed:s.crashed,score:s.score.getTotal(),
 distance:s.score.distanceM,seed:s.seed,
 tape:s.ghostRecorder?.fingerprints?.map(v=>({tick:v.tick,combined:v.combined})),
 errors:s.ghostRecorder?.fingerprintErrorCount});
const equal=(a,b,label)=>{
 const lhs=fp(a),rhs=fp(b);
 if(lhs.combined!==rhs.combined){
  const subsystems=FP_SUBSYSTEMS.filter(k=>lhs.subsystems[k]!==rhs.subsystems[k]);
  throw new Error(`render-on/off divergence ${label}: ${subsystems.join(',')}`);
 }
};

describe('#122 300 seconds cumulative real game-step render parity',()=>{
 jest.setTimeout(720000);
 test('36000 real fixed-step ticks across fresh deterministic native RunScene episodes',()=>{
  let actualTicks=0,episodes=0,crashes=0,checkpoints=0,maxEpisode=0;
  const observed=new Set();
  while(actualTicks<TARGET_TICKS){
   if(episodes>=1000)throw Error(`exhausted episodes at ${actualTicks} ticks`);
   const bit=MASKS[episodes%MASKS.length],seed=`BB-300S-AGGREGATE-${episodes}`;
   const policy=episodes%2?'tricks':'neutral';
   const shown=createRun(RunScene,REG,{seed,biomeMask:bit,level:12});
   const hidden=createRun(RunScene,REG,{seed,biomeMask:bit,level:12,stubRender:true});
   shown.inputRouter={poll:()=>pad(shown.simClock.tick+1,policy),setEnabled(){}};
   hidden.inputRouter={poll:()=>pad(hidden.simClock.tick+1,policy),setEnabled(){}};
   let ticks=0;
   // A cap deliberately cycles seeds/masks: this is cumulative engine exposure,
   // NOT a player magically surviving until the 300s marker.
   while(ticks<1200&&actualTicks<TARGET_TICKS&&!shown.crashed){
    if(ticks===1){shown.shieldCharges=2;hidden.shieldCharges=2;}
    if(ticks===240){shown.shieldCharges=0;hidden.shieldCharges=0;}
    if(ticks===300){shown.refreshPalette();hidden.refreshPalette();}
    const before=shown.simClock.tick;
    shown.update(0,shown.simClock.tickMs);
    hidden.update(0,hidden.simClock.tickMs);
    if(shown.simClock.tick!==hidden.simClock.tick||shown.crashed!==hidden.crashed)
     throw Error(`tick/crash divergence episode ${episodes}, iteration ${ticks}`);
    const advanced=shown.simClock.tick-before;
    if(advanced!==1)throw Error(`non-unit sim step ${advanced}, episode ${episodes}`);
    actualTicks++;ticks++;
    if(shown.simClock.tick%120===0){
     equal(shown,hidden,`episode ${episodes} tick ${shown.simClock.tick}`);
     checkpoints++;
    }
   }
   if(ticks===0)throw Error(`no simulation progress on episode ${episodes}`);
   equal(shown,hidden,`episode ${episodes} final`);
   expect(witness(hidden)).toEqual(witness(shown));
   if(shown.crashed)crashes++;
   maxEpisode=Math.max(maxEpisode,ticks);
   observed.add(bit);episodes++;
  }
  expect(actualTicks).toBe(TARGET_TICKS);
  expect(episodes).toBeGreaterThanOrEqual(MASKS.length);
  expect([...observed].sort((a,b)=>a-b)).toEqual([...MASKS].sort((a,b)=>a-b));
  expect(checkpoints).toBeGreaterThanOrEqual(100);
  console.log('PASS_300S_AGGREGATE_RENDER_PARITY',JSON.stringify({
   actualTicks,simulatedSeconds:actualTicks/120,episodes,crashes,
   checkpoints,biomeMasks:observed.size,maxEpisodeTicks:maxEpisode,
   caveat:'Aggregate episode exposure, NOT uninterrupted 300s run or real browser Worker physics.'}));
 });
});
