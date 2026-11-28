/** Cross-engine fixed witness from real RunScene + Matter in browser/main
 * thread and Web Worker. Crucially, this separate Jest harness uses the
 * pre-existing headlessRun.js to detect QA-shell drift in the browser build.
 */
import {jest} from '@jest/globals';
import fs from 'node:fs';
const {installPhaserStub,createRun}=await import('./headlessRun.js');
installPhaserStub(jest);
const {RunScene}=await import('../../src/scenes/RunScene.js');
const {REG}=await import('../../src/constants.js');
const {captureCausalState}=await import('../../src/systems/replay/fingerprintCapture.js');
const {fingerprintState}=await import('../../src/systems/replay/fingerprint.js');
const {PHYSICS_QA_CASES,physicsQaPad}=await import('../../tools/lab/qa-real-physics-policy.mjs');
const golden=JSON.parse(fs.readFileSync('tools/lab/qa-real-physics-golden.json','utf8'));
const evidence=({seed,biomeMask,policy,ticks})=>{
 const scene=createRun(RunScene,REG,{seed,biomeMask,stubRender:true});
 scene.inputRouter={poll:()=>physicsQaPad(policy,scene.simClock.tick+1),setEnabled(){}};
 const checkpoints=[];
 for(let i=0;i<ticks;i++){
  if(scene.crashed)break;
  const prior=scene.simClock.tick;
  scene.update(0,scene.simClock.tickMs);
  if(scene.simClock.tick>prior&&scene.simClock.tick%120===0)
   checkpoints.push([scene.simClock.tick,
    fingerprintState(captureCausalState(scene,{chunkMemo:false})).combined]);
 }
 return {seed,tick:scene.simClock.tick,crashed:!!scene.crashed,
  score:scene.score.getTotal(),checkpoints};
};
test.each(PHYSICS_QA_CASES)('real Node RunScene/Matter agrees with fixed Chromium worker witness: $seed',spec=>{
 const nodeWitness=evidence(spec);
 expect(nodeWitness).toEqual(golden.find(row=>row.seed===spec.seed));
});
