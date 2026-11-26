import {jest} from '@jest/globals';
import {canonicalBytes,parseCanonical,f64Encode} from '../../src/systems/replay/canonicalJson.js';
import {captureRecorderState,decodeRecorderState,restoreRecorderState} from '../../src/systems/savestate/recorderState.js';
import {GhostRecorder,TapePlayer} from '../../src/systems/ghost/GhostTape.js';
import {installPhaserStub,createRun,stepRun} from '../replay/headlessRun.js';

installPhaserStub(jest);
const {RunScene}=await import('../../src/scenes/RunScene.js');
const {REG}=await import('../../src/constants.js');
const {CURRENT_RULESET_ID}=await import('../../src/systems/replay/currentRulesetId.js');
const {SIM_REVISION}=await import('../../src/systems/replay/ruleset.js');
const {BUILD_ID_KEY}=await import('../../src/systems/replay/evidenceCapture.js');
const buildId='sha256:'+'a'.repeat(64); // test identity, not the runtime's claim
const setup={seed:'RPLAY118',level:1};
const pad=t=>({push:t<300,tilt:t>=420&&t<460?-1:0,variableHop:true,noAutoNudge:true,
 pressed:{hop:t===119||t===120||t===350||t===600}});
const ctx=(run,tick=run.simClock.tick)=>({runId:run.runId,tick,buildId,
 rulesetId:CURRENT_RULESET_ID,simRevision:SIM_REVISION});
function fresh(overrides={}){
 const run=createRun(RunScene,REG,{...setup,...overrides});
 // Stub harness has no async service loader; explicitly install the test
 // identity before creating a native tick-zero recorder from actual header.
 run.registry.set(BUILD_ID_KEY,buildId);
 run.ghostRecorder=new GhostRecorder(run._ghostHeader());
 return run;
}
let source,sourceContext,bytes;
beforeAll(()=>{
 source=fresh();stepRun(source,241,pad);
 expect(source.simClock.tick).toBe(241);
 expect(source.ghostRecorder.fingerprints).toHaveLength(2);
 sourceContext=ctx(source);
 bytes=captureRecorderState(source.ghostRecorder,sourceContext);
});
const mutate=fn=>{const data=parseCanonical(bytes);fn(data);return canonicalBytes(data);};
const final=rec=>rec.finish({runId:source.runId,score:0,distanceM:0,endedAt:12345});

test('native recorder round trips canonical bytes, no alias, no mutation of fresh target',()=>{
 const target=fresh(),before=captureRecorderState(target.ghostRecorder,ctx(target));
 const restored=restoreRecorderState(bytes,target.ghostRecorder,sourceContext);
 expect(restored).toBeInstanceOf(GhostRecorder);
 expect(restored).not.toBe(source.ghostRecorder);
 expect(restored).not.toBe(target.ghostRecorder);
 expect(captureRecorderState(restored,sourceContext)).toEqual(bytes);
 expect(captureRecorderState(target.ghostRecorder,ctx(target))).toEqual(before);
 restored.inputs[0][1]=0;
 restored.fingerprints[0].subsystems.clock='bad';
 expect(captureRecorderState(source.ghostRecorder,sourceContext)).toEqual(bytes);
});

test('actual real-Matter RunScene with reattached native recorder yields identical complete suffix and finished tape',()=>{
 const a=fresh(),b=fresh(),target=fresh();
 stepRun(a,241,pad);stepRun(b,241,pad);
 const ac=ctx(a),saved=captureRecorderState(a.ghostRecorder,ac);
 b.ghostRecorder=restoreRecorderState(saved,target.ghostRecorder,ac);
 b.startedAt=a.startedAt;b.runId=a.runId;
 stepRun(a,479,pad);stepRun(b,479,pad);
 expect(a.simClock.tick).toBe(720);expect(b.simClock.tick).toBe(720);
 expect(captureRecorderState(b.ghostRecorder,ctx(b))).toEqual(captureRecorderState(a.ghostRecorder,ctx(a)));
 expect(final(b.ghostRecorder)).toEqual(final(a.ghostRecorder));
 const tape=final(b.ghostRecorder),p=new TapePlayer(tape);
 expect(Array.from({length:720},(_,i)=>i+1).filter(t=>p.padAt(t).pressed.hop)).toEqual([119,120,350,600]);
 expect(b.ghostRecorder.fingerprints).toHaveLength(6);
});

test('signed zero trace/checkpoint coordinates and binary64 precision survive exactly',()=>{
 const data=mutate(s=>{s.recorder.trace[1]=f64Encode(-0);s.recorder.checkpoints[0][1]=f64Encode(-0);s.recorder.trace[(120/4-1)*3]=f64Encode(-0);
  s.recorder.trace[2]=f64Encode(0.12345678912345678);});
 const restored=restoreRecorderState(data,fresh().ghostRecorder,sourceContext);
 expect(Object.is(restored.trace[1],-0)).toBe(true);
 expect(Object.is(restored.checkpoints[0][1],-0)).toBe(true);
 expect(restored.trace[2]).toBe(0.12345678912345678);
 expect(captureRecorderState(restored,sourceContext)).toEqual(data);
});

test.each([
 ['missing field',s=>delete s.recorder.header.random],
 ['extra field',s=>s.recorder.unclassified=1],
 ['wrong build',s=>s.recorder.header.buildId='sha256:'+'b'.repeat(64)],
 ['wrong tick',s=>s.tick++],
 ['wrong run',s=>s.runId+='x'],
 ['unknown mode',s=>s.recorder.header.mode='takeover'],
 ['unknown control layout',s=>s.recorder.header.controlLayout='fake'],
 ['unknown upgrade',s=>s.recorder.header.upgradeRanks={invented:1}],
 ['wrong input cursor',s=>s.recorder._lastTick++],
 ['missing initial input',s=>s.recorder.inputs[0][0]++],
 ['post-boundary input',s=>s.recorder.inputs.push([999,0,0])],
 ['interior repeated edge removed',s=>{const r=s.recorder.inputs; const i=r.findIndex((v,k)=>k>0&&v[1]===r[k-1][1]&&(v[1]&(63<<12)));r[i+1][0]+=r[i][0];r.splice(i,1);}],
 ['illegal input bit',s=>s.recorder.inputs[0][1]=0xffffffff],
 ['trace gap',s=>s.recorder.trace.pop()],
 ['invalid float',s=>s.recorder.trace[0]=f64Encode(Infinity)],
 ['checkpoint gap',s=>s.recorder.checkpoints.pop()],
 ['checkpoint trace mismatch',s=>s.recorder.checkpoints[0][1]=f64Encode(999)],
 ['fractional checkpoint score',s=>s.recorder.checkpoints[0][7]=f64Encode(1.5)],
 ['fingerprint gap',s=>s.recorder.fingerprints.pop()],
 ['inconsistent combined digest',s=>s.recorder.fingerprints[0].subsystems.clock='xxh32x2:1234567890abcdef'],
 ['fingerprint capture failure',s=>s.recorder.fingerprintErrorCount=1],
])('rejects %s without touching fresh recorder',(_name,fn)=>{
 const target=fresh(),before=captureRecorderState(target.ghostRecorder,ctx(target));
 expect(()=>restoreRecorderState(mutate(fn),target.ghostRecorder,sourceContext)).toThrow();
 expect(captureRecorderState(target.ghostRecorder,ctx(target))).toEqual(before);
});

test('rejects foreign course, nonfresh instance, failed build identity, and guest/practice headers',()=>{
 const foreign=fresh({seed:'different'});
 expect(()=>restoreRecorderState(bytes,foreign.ghostRecorder,sourceContext)).toThrow(/fresh-header-mismatch/);
 const advanced=fresh();stepRun(advanced,1,pad);
 expect(()=>restoreRecorderState(bytes,advanced.ghostRecorder,sourceContext)).toThrow();
 expect(()=>decodeRecorderState(bytes,{...sourceContext,buildId:null})).toThrow(/context/);
 const old=fresh();old.ghostRecorder.header.buildId=null;
 expect(()=>captureRecorderState(old.ghostRecorder,ctx(old))).toThrow(/header.build/);
});

test('capture refuses hidden/unknown/accessor fields and holes without invoking getters',()=>{
 const r=fresh(),get=jest.fn(()=>{throw Error('getter executed');});
 Object.defineProperty(r.ghostRecorder.header,'seed',{get,enumerable:true,configurable:true});
 expect(()=>captureRecorderState(r.ghostRecorder,ctx(r))).toThrow(/fields/);
 expect(get).not.toHaveBeenCalled();
 expect(()=>restoreRecorderState(bytes,r.ghostRecorder,sourceContext)).toThrow(/fields/);
 expect(get).not.toHaveBeenCalled();
 const a=fresh();Object.defineProperty(a.ghostRecorder,'hidden',{value:1});
 expect(()=>captureRecorderState(a.ghostRecorder,ctx(a))).toThrow(/fields/);
 const b=fresh();stepRun(b,4,pad);delete b.ghostRecorder.trace[0];
 expect(()=>captureRecorderState(b.ghostRecorder,ctx(b))).toThrow(/array-fields/);
});

test('edge at capture boundary can continue but an uncovered tick after it refuses',()=>{
 const a=fresh();stepRun(a,120,pad);const c=ctx(a),data=captureRecorderState(a.ghostRecorder,c);
 const restored=restoreRecorderState(data,fresh().ghostRecorder,c);
 expect(restored._lastTick).toBe(120);
 const altered=parseCanonical(data);altered.tick++;altered.recorder.lastTick++;
 expect(()=>decodeRecorderState(canonicalBytes(altered),{...c,tick:121})).toThrow(/cursor.edge-gap/);
});

test('zero tick is empty, no phantom input, wrong snapshot bytes rejected',()=>{
 const a=fresh(),b=fresh(),ac=ctx(a),empty=captureRecorderState(a.ghostRecorder,ac);
 const rec=restoreRecorderState(empty,b.ghostRecorder,ac);
 expect(rec.inputs).toEqual([]);expect(rec._last).toBeNull();expect(rec.lastTick).toBe(0);
 expect(captureRecorderState(rec,ac)).toEqual(empty);
 expect(()=>decodeRecorderState(new Uint8Array([...bytes,32]),sourceContext)).toThrow();
});
