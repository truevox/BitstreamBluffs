/** #119 production import boundary: never globally install or grant rank. */
import {createRunSceneRestoreKit} from '../../src/systems/savestate/RunSceneRestoreKit.js';
test('runtime snapshot kit is opt-in and rejects missing Phaser Matter without global mutation',()=>{
  const before=Object.prototype.hasOwnProperty.call(globalThis,'__ssGameKit');
  expect(createRunSceneRestoreKit).toBeInstanceOf(Function);
  expect(()=>createRunSceneRestoreKit(undefined)).toThrow('missing Phaser Matter');
  expect(()=>createRunSceneRestoreKit({Physics:{Matter:{}}})).toThrow('missing Phaser Matter');
  expect(Object.prototype.hasOwnProperty.call(globalThis,'__ssGameKit')).toBe(before);
});


test('operational restore exposes only full snapshot/restore and fails closed on guest, gym and non-fresh targets',()=>{
  const Matter={version:'0.20.0',Body:{},Engine:{},Common:{},Composite:{},Collision:{},Resolver:{},Sleeping:{},Pairs:{},Pair:{},Detector:{}};
  const kit=createRunSceneRestoreKit({Physics:{Matter:{Matter}}});
  expect(Object.keys(kit).sort()).toEqual(['capture','digests','restore']);
  expect(Object.isFrozen(kit)).toBe(true);
  for(const run of [{unrankedPractice:true},{guestPractice:true},{bsodGym:true},{crashed:true},{takeover:{}}]){
    expect(()=>kit.capture(run)).toThrow('only complete normal live runs');
    expect(()=>kit.restore(run,{})).toThrow('only intact complete snapshot');
  }
  const fakeFresh={simClock:{tick:1},ghostRecorder:{lastTick:0,inputs:[]},unrankedPractice:false,
    bsodGym:false,guestPractice:false,coachSim:null,takeover:null,crashed:false,tapePlayer:null,_replayTape:null};
  expect(()=>kit.restore(fakeFresh,{})).toThrow('only intact complete snapshot');
  expect(Object.prototype.hasOwnProperty.call(globalThis,'__ssGameKit')).toBe(false);
});
