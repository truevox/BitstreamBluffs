/** #56: one stored ghost run ID always identifies the same recording bytes. */
import {GhostLibrary} from '../../src/systems/ghost/GhostLibrary.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const tape=(id='immutable-id',options={})=>({
 runId:id,seed:'the-hill',biomeMask:7,mode:'normal',simRevision:9,
 distanceM:100,endedAt:1000,trace:'ORIGINAL_POSITIONS',inputs:[[1,3,0],[5,0,0]],
 checkpoints:[[120,10,20,0,0,0,0,0]],startPose:[10,20,0,0,0,0],
 random:{version:1,physicsScramble:1},...options,
});

test('reject same-course ID collision without touching pinned Favorite, Latest or Best',async()=>{
 const lib=new GhostLibrary(),original=tape();
 expect(await lib.saveRun(original)).not.toBeNull();
 expect(await lib.setFavorite(original.seed,original.biomeMask,0,original.runId)).not.toBeNull();
 const before=clone(lib.course(original.seed,original.biomeMask));
 for(const change of [{trace:'FORGED_POSITIONS'},{score:999999},{distanceM:777,endedAt:5000},
  {inputs:[[1,999,0]]},{checkpoints:[]},{random:{version:1,physicsScramble:8}}]){
  expect(await lib.saveRun({...tape(),...change})).toBeNull();
  expect(lib.course(original.seed,original.biomeMask)).toEqual(before);
  expect(await lib.getTape(original.runId)).toEqual(original);
 }
});

test('JSON serialization cannot turn distinct tape identities into accepted retries',async()=>{
 const lib=new GhostLibrary(),original=tape();await lib.saveRun(original);
 for(const changed of [
  {...tape(),optionalField:undefined},
  {...tape(),distanceM:100,extras:()=>{}},
  {...tape(),distanceM:100,metadata:{present:undefined}},
 ])expect(await lib.saveRun(changed)).toBeNull();
 const zero=new GhostLibrary();await zero.saveRun(tape('zero',{distanceM:0}));
 expect(await zero.saveRun(tape('zero',{distanceM:-0}))).toBeNull();
 const special=new GhostLibrary();await special.saveRun(tape('special',{score:null}));
 expect(await special.saveRun(tape('special',{score:NaN}))).toBeNull();
});

test('identical retry is a true no-op after newer Latest; does not repromote stale tape',async()=>{
 const lib=new GhostLibrary(),original=tape(),latest=tape('newer',{distanceM:9,endedAt:2000});
 await lib.saveRun(original);await lib.setFavorite(original.seed,original.biomeMask,1,original.runId);
 await lib.saveRun(latest);
 const course=clone(lib.course(original.seed,original.biomeMask));
 expect(course).toMatchObject({best:original.runId,latest:latest.runId,favorites:[null,original.runId,null]});
 const received=await lib.saveRun(clone(original));
 expect(received).toEqual(course);
 expect(lib.course(original.seed,original.biomeMask)).toEqual(course);
 expect(await lib.getTape(original.runId)).toEqual(original);
});

test('memory backend is not aliased to source or returned recordings',async()=>{
 const lib=new GhostLibrary(),source=tape();await lib.saveRun(source);
 source.trace='MUTATED_CALLER';source.inputs[0][1]=999;
 const saved=await lib.getTape('immutable-id');
 expect(saved.trace).toBe('ORIGINAL_POSITIONS');expect(saved.inputs[0][1]).toBe(3);
 saved.trace='MUTATED_READER';saved.inputs[0][1]=123;
 expect(await lib.getTape('immutable-id')).toMatchObject({trace:'ORIGINAL_POSITIONS',inputs:[[1,3,0],[5,0,0]]});
});

test('simultaneous conflicting same-ID memory writes allow one original only',async()=>{
 const lib=new GhostLibrary(),a=tape('race'),b=tape('race',{trace:'OTHER_TRACE',distanceM:1000});
 const [x,y]=await Promise.all([lib.saveRun(a),lib.saveRun(b)]);
 expect([x,y].filter(Boolean)).toHaveLength(1);
 const kept=await lib.getTape('race');
 expect(kept.trace).toBe(x?'ORIGINAL_POSITIONS':'OTHER_TRACE');
 expect(lib.course('the-hill',7).latest).toBe('race');
});

test('foreign-course same-ID attempt remains refused',async()=>{
 const lib=new GhostLibrary(),original=tape();await lib.saveRun(original);
 expect(await lib.saveRun({...tape(),seed:'other-hill'})).toBeNull();
 expect(lib.course('other-hill',7)).toBeNull();
 expect(await lib.getTape(original.runId)).toEqual(original);
});
