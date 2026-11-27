import {suspendPausedSource} from '../../src/systems/savestate/suspendSource.js';
const run=()=>({simClock:{tick:481},_manualPausePending:true,scene:{isPaused:k=>k==='RunScene'}});
test('unpaused source refuses without touching slot or retiring',async()=>{
 const r=run();r._manualPausePending=false;const slot={put:()=>{throw Error('called');}};
 const result=await suspendPausedSource({run:r,slot,retire:()=>{throw Error('retired');}});
 expect(result).toMatchObject({ok:false,code:'not-paused'});
});
test('incomplete native run fails before storage write and leaves pause intact',async()=>{
 const r=run(),calls=[];
 const out=await suspendPausedSource({run:r,Phaser:{},identity:{},slot:{put:()=>calls.push('write')},
  retire:()=>calls.push('retire')});
 expect(out).toMatchObject({ok:false,code:'capture-refused'});
 expect(calls).toEqual([]);expect(r._manualPausePending).toBe(true);
});
import {commitPausedSource} from '../../src/systems/savestate/suspendSource.js';
test('durable commit retires source exactly once and only after storage returns success',async()=>{
 const r=run(),events=[],slot={put:async()=>{events.push('put');return {ok:true,saved:true,runId:'saved',tick:481,bytes:500};}};
 const out=await commitPausedSource({run:r,initial:481,envelope:new Uint8Array([1]),identity:{},slot,
 retire:()=>{events.push('retire');return true;}});
 expect(out).toMatchObject({ok:true,retired:true,runId:'saved'});
 expect(events).toEqual(['put','retire']);
});
test.each(['quota-exceeded','slot-occupied','slot-claimed'])('storage refusal %s keeps playable pause untouched',async code=>{
 const r=run(),events=[];
 const result=await commitPausedSource({run:r,initial:481,envelope:1,identity:{},slot:{put:()=>({ok:false,code})},
 retire:()=>events.push('retire')});
 expect(result).toEqual({ok:false,code});expect(events).toEqual([]);
 expect(r._manualPausePending).toBe(true);
});
test('retirement error never deletes the now-durable saved slot or claims success',async()=>{
 const r=run();let writes=0;
 const result=await commitPausedSource({run:r,initial:481,envelope:1,identity:{},slot:{put:()=>{writes++;return {ok:true,saved:true,runId:'run',tick:481};}},
 retire:()=>{throw Error('scene manager failed');}});
 expect(writes).toBe(1);
 expect(result).toMatchObject({ok:false,code:'source-retirement-uncertain',saved:true,locked:true});
});
test('storage exceptions never retire the original',async()=>{
 const r=run();let retired=false;
 const result=await commitPausedSource({run:r,initial:481,envelope:1,identity:{},slot:{put:()=>{throw Error('idb unavailable');}},
 retire:()=>{retired=true;return true;}});
 expect(result).toEqual({ok:false,code:'write-outcome-unknown',locked:true});expect(retired).toBe(false);
});

test('storage unavailable after attempted write cannot be assumed to mean no commit',async()=>{
 const r=run(),result=await commitPausedSource({run:r,initial:481,envelope:1,identity:{},
  slot:{put:()=>({ok:false,code:'storage-unavailable'})},retire:()=>{throw Error('retired');}});
 expect(result).toEqual({ok:false,code:'write-outcome-unknown',locked:true,cause:'storage-unavailable'});
 expect(r._manualPausePending).toBe(true);
});
