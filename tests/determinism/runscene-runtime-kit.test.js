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

test('truncated or inconsistent causal sections refuse before touching fresh world',()=>{
  const Matter={version:'0.20.0',Body:{},Engine:{},Common:{},Composite:{}};
  const kit=createRunSceneRestoreKit({Physics:{Matter:{Matter}}});
  const target={simClock:{tick:0},ghostRecorder:{lastTick:0,inputs:[]}};
  const original=JSON.stringify(target);
  const names=['simClock','runRandom','terrain','sled','score'];
  const game=Object.fromEntries(names.map(x=>[x,{}]));
  const base={kind:'bb-runscene-diagnostic-snapshot',diagnosticOnly:true,
    audit:[],recorder:{},config:{},classes:{SIM:names,unclassified:[]},
    game,ghost:Array(8).fill(0),matter:{},camera:{},
    telegraph:{},meshOrder:[],pool:[]};
  const broken=[
    {...base,game:{...game,unreviewedState:{}}},
    {...base,game:{simClock:{},runRandom:{},sled:{},score:{}}},
    {...base,classes:{SIM:[...names,'unknown'],unclassified:[]}},
    {...base,classes:{SIM:names,unclassified:['unreviewedState']}},
    {...base,telegraph:null},
    {...base,pool:[{id:'legacy-body'}]},
    {...base,pool:null},
    {...base,meshOrder:null},
    {...base,ghost:[0]},
  ];
  for(const snap of broken){
    expect(()=>kit.restore(target,snap)).toThrow('only intact complete snapshot');
    expect(JSON.stringify(target)).toBe(original);
  }
});
