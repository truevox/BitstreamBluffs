import {TextEncoder,TextDecoder} from 'node:util';
import {webcrypto} from 'node:crypto';
globalThis.TextEncoder=TextEncoder;globalThis.TextDecoder=TextDecoder;
import {inspectLabCheckpoint,LocalBrainCheckpoints,requestLabCheckpointDownload,
 LAB_CHECKPOINT_ABI} from '../../src/systems/brain/localBrainCheckpoints.js';
const snapshot=(overrides={})=>({format:'bb-lab-checkpoint',version:LAB_CHECKPOINT_ABI,
 simRevision:9,modelAbi:'draft-test-1',generation:2,
 brain:{weights:[[1,2],[3,4]]},optimizer:{step:2,momentum:[0.1,0.2]},
 queue:[{seed:3,next:4}],rng:{seed:'abc',state:[1,2,3]},...overrides});
const wire=overrides=>JSON.stringify(snapshot(overrides));
const parsed=bytes=>JSON.parse(new TextDecoder().decode(bytes));

test('complete state is lossless and stored only as unprivileged model-ABI-pending bytes',()=>{
 const original=wire(),r=inspectLabCheckpoint(original);
 expect(r.ok).toBe(true);expect(r.admission).toBe('storage-only');
 expect(parsed(r.bytes)).toEqual(snapshot());
 expect(r.simRevision).toBe(9);expect(r.modelAbi).toBe('draft-test-1');
 expect(parsed(r.bytes).optimizer.momentum).toEqual([0.1,0.2]);
});

test.each([
 ['no optimizer',{optimizer:undefined}],
 ['no queue',{queue:undefined}],
 ['no RNG',{rng:undefined}],
 ['no model',{brain:undefined}],
 ['fake ABI',{modelAbi:'../x'}],
 ['negative revision',{simRevision:-1}],
 ['negative generation',{generation:-1}],
 ['unknown authority flag',{verified:true}],
 ['future format',{version:LAB_CHECKPOINT_ABI+1}],
 ['fake model array',{brain:[1,2]}],
])('%s refuses incomplete/untrusted checkpoint envelope',(_,overrides)=>{
 expect(inspectLabCheckpoint(wire(overrides))).toEqual({ok:false,code:'checkpoint-layout'});
});

test('preflight rejects hostile, huge, cyclic, and poisoned imports',()=>{
 expect(inspectLabCheckpoint('{"__proto__":{"admin":true}}')).toEqual({ok:false,code:'unsafe-key'});
 expect(inspectLabCheckpoint('x'.repeat(2097153))).toEqual({ok:false,code:'file-too-large'});
 const cyclic={};cyclic.self=cyclic;
 expect(inspectLabCheckpoint(cyclic)).toEqual({ok:false,code:'invalid-input'});
 expect(inspectLabCheckpoint('{"format":"bb-lab-checkpoint","version":1,')).toEqual({ok:false,code:'invalid-json'});
});

test('browser refusal to persist reports best-effort with visible warning, never durable',async()=>{
 let persistCalls=0;
 const store=new LocalBrainCheckpoints({storage:{persisted:async()=>false,
  persist:async()=>{persistCalls++;return false;}},cryptoRef:webcrypto});
 store._write=async()=>({ok:true});
 const one=await store.save(wire());const two=await store.save(wire({generation:3}));
 for(const r of [one,two]){
  expect(r.ok).toBe(true);expect(r.durability).toBe('best-effort');
  expect(r.warning).toMatch(/EXPORT A BACKUP/);expect(r.persistence).toBe('refused');
 }
 expect(persistCalls).toBe(1);
});

test('success with persisted grant differentiates durable from best effort',async()=>{
 let persistedCalls=0,persistCalls=0;
 const store=new LocalBrainCheckpoints({storage:{persisted:async()=>{persistedCalls++;return true;},
  persist:async()=>{persistCalls++;return true;}},cryptoRef:webcrypto});
 store._write=async()=>({ok:true});
 const r=await store.save(wire());
 expect(r).toMatchObject({ok:true,durability:'persistent-storage',warning:null,persistence:'granted'});
 expect(persistedCalls).toBe(1);expect(persistCalls).toBe(0);
});

test.each(['QuotaExceededError','SecurityError'])('%s failed transaction leaves exportable exact pending and NO saved success',async name=>{
 const store=new LocalBrainCheckpoints({storage:{persist:async()=>false},cryptoRef:webcrypto});
 store._write=async()=>({ok:false,code:name==='QuotaExceededError'?'quota-exceeded':'storage-unavailable'});
 const result=await store.save(wire());
 expect(result.ok).toBe(false);expect(result.durability).toBe('memory-only');
 expect(result.warning).toMatch(/NOT SAVED/);expect(result.canExport).toBe(true);
 const exported=await store.export({pending:true});
 expect(exported.ok).toBe(true);expect(parsed(exported.bytes)).toEqual(snapshot());
 exported.bytes.fill(0);
 expect(parsed((await store.export({pending:true})).bytes)).toEqual(snapshot());
});

test('entire absent browser storage fails DURABLE save but never loses pending export',async()=>{
 const s=new LocalBrainCheckpoints({idb:null,storage:null,cryptoRef:webcrypto});
 const r=await s.save(wire());expect(r).toMatchObject({ok:false,code:'storage-unavailable',durability:'memory-only',canExport:true});
 expect(parsed((await s.export({pending:true})).bytes).rng.state).toEqual([1,2,3]);
 expect(await s.read()).toEqual({ok:false,code:'storage-unavailable'});
});

test('file import stays in quarantine instead of overwriting runnable active checkpoints',async()=>{
 const rows=new Map();
 const store=new LocalBrainCheckpoints({storage:{persist:async()=>true},cryptoRef:webcrypto});
 store._write=async row=>{rows.set(row.id,row);return {ok:true};};
 store._read=async id=>rows.get(id)?{ok:true,admission:id==='quarantine'?'quarantine-only':'storage-only',
  bytes:Uint8Array.from(rows.get(id).bytes)}:{ok:false,code:'empty'};
 await store.save(wire());
 const imported=await store.importForReview(new TextEncoder().encode(wire({generation:100,simRevision:10})));
 expect(imported).toMatchObject({ok:true,admission:'quarantine-only'});
 expect(parsed((await store.read()).bytes).generation).toBe(2);
 expect(parsed((await store.readQuarantine()).bytes).generation).toBe(100);
 expect(store.pending).toBeNull();
});

test('download is an explicit local gesture, not a claim that the OS saved it',()=>{
 const links=[],events=[];
 const doc={body:{appendChild(){events.push('attach');}},createElement(){
  const a={style:{},click(){events.push('click');},remove(){events.push('remove');}};
  links.push(a);return a;}};
 const urlRef={createObjectURL(){return 'blob:local';},revokeObjectURL(x){events.push(x);}};
 let cleanup;const r=requestLabCheckpointDownload(wire(),{documentRef:doc,urlRef,
  BlobCtor:class{constructor(parts){this.parts=parts;}},
  deferRevoke:cb=>{cleanup=cb;},now:()=>new Date('2026-11-27T19:00:00Z')});
 expect(r).toEqual({ok:true,requested:true,admission:'backup-file-only'});
 expect(links[0].download).toBe('bitstream-bluffs-brain-2026-11-27T19-00-00-000Z.bbbrain');
 expect(events).toEqual(['attach','click','remove']);cleanup();
 expect(events.at(-1)).toBe('blob:local');
});


test('advisory marker warns after IDB loss but never masquerades as a backup',async()=>{
 const marker=new Map();const markerStore={getItem:k=>marker.get(k)||null,
  setItem:(k,v)=>marker.set(k,v)};
 const store=new LocalBrainCheckpoints({storage:{persist:async()=>false},
  cryptoRef:webcrypto,markerStore});
 store._write=async()=>({ok:true});
 store._read=async()=>({ok:false,code:'empty'});
 expect(await store.read()).toEqual({ok:false,code:'empty'});
 const result=await store.save(wire());expect(result.ok).toBe(true);
 const missing=await store.read();
 expect(missing.code).toBe('checkpoint-missing-after-save');
 expect(missing.warning).toMatch(/RESTORE AN EXPORTED BACKUP/);
 expect(await store.export()).toMatchObject({ok:false,code:'checkpoint-missing-after-save'});
});




test('concurrent save is refused without cross-wiring checksum, weights or pending export',async()=>{
 let release;const pending=new Promise(done=>{release=done;});
 const writes=[];
 const store=new LocalBrainCheckpoints({storage:{persist:async()=>true},cryptoRef:webcrypto});
 store._write=async row=>{writes.push(row);await pending;return {ok:true};};
 const first=store.save(wire({generation:2}));
 await new Promise(done=>setTimeout(done,0));
 const second=await store.save(wire({generation:100}));
 expect(second).toEqual({ok:false,code:'save-in-progress'});
 release();const committed=await first;
 expect(committed.ok).toBe(true);expect(writes).toHaveLength(1);
 expect(parsed(writes[0].bytes).generation).toBe(2);
 expect(await store.export({pending:true})).toEqual({ok:false,code:'no-pending-export'});
});
