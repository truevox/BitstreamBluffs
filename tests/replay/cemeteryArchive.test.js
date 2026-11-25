/** #68: entirely separate, private pose-only montage; never a replay proof. */
import {fakeIdb} from './fakeIdb.js';
import {cemeteryEntry,cemeteryFrame,CemeteryArchive,cemeteryEntryBytes,CEMETERY_PER_COURSE,CEMETERY_DB} from '../../src/systems/ghost/CemeteryArchive.js';
import {TRACE_EVERY} from '../../src/systems/ghost/GhostTape.js';
import {defaultSettings,sanitizeSettings} from '../../src/systems/SaveStore.js';
import {CEMETERY_DEFAULT_ATTEMPTS,CEMETERY_MAX_ATTEMPTS,CEMETERY_RENDER_LIMIT,CEMETERY_KEEP_CHOICES,CEMETERY_TOTAL_BYTE_BUDGET,cemeteryKeepCount} from '../../src/systems/ghost/CemeteryPolicy.js';

const tape=(i,seed='S1',mask=7)=>({
 runId:`r-${i}`,seed,biomeMask:mask,mode:'normal',distanceM:i*3,
 endTick:12,trace:Buffer.from(new Float32Array([0,100,0,8,96,0.1,16,92,0.2]).buffer).toString('base64'),
 // An intentionally fake recorder sample is used ONLY in this unit test;
 // production archive insists on actual finished GhostRecorder pose bytes.
});

describe('opt-in local pose-only cemetery archive',()=>{
 test('owner-approved five is default, integer stepper includes 0 OFF and capped 24',()=>{
  expect(CEMETERY_DEFAULT_ATTEMPTS).toBe(5);
  expect(CEMETERY_MAX_ATTEMPTS).toBe(24);
  expect(CEMETERY_RENDER_LIMIT).toBeLessThan(CEMETERY_MAX_ATTEMPTS);
  expect(CEMETERY_TOTAL_BYTE_BUDGET).toBe(8*1024*1024);
  expect(defaultSettings().cemeteryKeep).toBe(5);
  expect(sanitizeSettings({}).cemeteryKeep).toBe(5);
  for(const value of [null,'5',true,-1,25,2.1])expect(sanitizeSettings({cemeteryKeep:value}).cemeteryKeep).toBe(5);
  expect(sanitizeSettings({cemeteryKeep:0}).cemeteryKeep).toBe(0);
  expect(sanitizeSettings({cemeteryKeep:24}).cemeteryKeep).toBe(24);
  expect(CEMETERY_KEEP_CHOICES).toHaveLength(25);
  expect(CEMETERY_KEEP_CHOICES[0].label).toContain('ERASE');
  expect(CEMETERY_KEEP_CHOICES[24].label).toContain('MAX');
  expect(cemeteryKeepCount(5)).toBe(5);
 });
 test('strictly rejects missing/corrupt/unnatural traces, never accepts proof input metadata',()=>{
  expect(cemeteryEntry(tape(1),11)).toMatchObject({course:'S1|00000007',runId:'r-1',recordedAt:11});
  for(const bad of [{trace:''},{trace:'!bad!'},{runId:''},{endTick:0},{mode:'gym'},
    {trace:Buffer.from(new Float32Array([NaN,1,0,2,3,4]).buffer).toString('base64')},
    {distanceM:Infinity}])expect(cemeteryEntry({...tape(1),...bad})).toBeNull();
  const entry=cemeteryEntry(tape(2),11);
  expect(entry).not.toHaveProperty('inputs');
  expect(entry).not.toHaveProperty('checkpoints');
  expect(entry).not.toHaveProperty('score');
  expect(entry).not.toHaveProperty('random');
 });
 test('max 24 latest per EXACT seed/mask, untouched five-ghost roles',async()=>{
  const idb=fakeIdb(),archive=new CemeteryArchive({idb,perCourse:24});
  for(let i=0;i<35;i++){
   const outcome=await archive.add(tape(i));
   expect(outcome.ok).toBe(true);
  }
  expect(idb.names()).toContain(CEMETERY_DB);
  const kept=await archive.list('S1',7);
  expect(kept).toHaveLength(CEMETERY_PER_COURSE);
  expect(kept.every(e=>e.key.startsWith('S1|00000007/')&&!e.inputs&&!e.checkpoints)).toBe(true);
  expect(kept.map(e=>e.runId)).not.toContain('r-0');
  expect((await archive.add(tape(1,'S1',8))).ok).toBe(true);
  expect(await archive.list('S1',8)).toHaveLength(1);
  expect(await archive.list('S2',7)).toEqual([]);
  expect(kept.map(e=>e.runId).sort()).not.toContain('r-1');
  expect(idb.names()).not.toContain('bitstream-ghosts');
  expect(await archive.clearCourse('S1',7)).toEqual({ok:true,removed:24});
  expect(await archive.list('S1',7)).toEqual([]);
  expect(await archive.list('S1',8)).toHaveLength(1); // only selected course cleared

 });
 test('fast timestamp ties cannot evict the newly saved record',async()=>{
  const idb=fakeIdb(),archive=new CemeteryArchive({idb});
  const old=Date.now;Date.now=()=>123456;
  try{
   for(let i=0;i<27;i++)expect((await archive.add(tape(i))).ok).toBe(true);
   expect((await archive.list('S1',7)).some(row=>row.runId==='r-26')).toBe(true);
  }finally{Date.now=old;}
 });
 test('default five FIFO eviction, dynamic limits, zero purges only pose-history data, raise cannot resurrect',async()=>{
  const idb=fakeIdb(),standard=new CemeteryArchive({idb});
  for(let i=0;i<9;i++)expect((await standard.add(tape(i))).ok).toBe(true);
  const five=await standard.list('S1',7);
  expect(five).toHaveLength(5);
  expect(new Set(five.map(r=>r.runId))).toEqual(new Set(['r-4','r-5','r-6','r-7','r-8']));
  expect(await new CemeteryArchive({idb,perCourse:3}).trim()).toEqual({ok:true,removed:2,retained:3});
  expect((await standard.list('S1',7)).map(r=>r.runId).sort()).toEqual(['r-6','r-7','r-8']);
  expect((await new CemeteryArchive({idb,perCourse:24}).list('S1',7))).toHaveLength(3); // no resurrection
  const off=new CemeteryArchive({idb,perCourse:0});
  expect(await off.add(tape(20))).toEqual({ok:false,code:'disabled'});
  expect(await off.trim()).toEqual({ok:true,removed:3,retained:0});
  expect(await standard.list('S1',7)).toEqual([]);
  expect(idb.names()).not.toContain('bitstream-ghosts');
 });
 test('budget evicts oldest traces, oversize refuses without pruning, and quota failure is recoverable',async()=>{
  const idb=fakeIdb(),sample=cemeteryEntry(tape(1)),one=cemeteryEntryBytes(sample);
  const archive=new CemeteryArchive({idb,perCourse:24,byteBudget:one*2+10});
  for(let i=0;i<5;i++)expect((await archive.add(tape(i))).ok).toBe(true);
  const rows=await archive.list('S1',7);
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map(r=>r.runId))).toEqual(new Set(['r-3','r-4']));
  const tiny=new CemeteryArchive({idb,byteBudget:one-1});
  expect(await tiny.add(tape(99))).toEqual({ok:false,code:'trace-exceeds-budget'});
  expect(await archive.list('S1',7)).toHaveLength(2); // no eviction on refusal
  const quota={open(){throw Object.assign(new Error('disk full'),{name:'QuotaExceededError'});}};
  expect(await new CemeteryArchive({idb:quota}).add(tape(1))).toEqual({ok:false,code:'quota-exceeded'});
  expect((await new CemeteryArchive({idb}).add(tape(100))).ok).toBe(true);
 });
 test('no IndexedDB => explicit non-durable failure, and list reports no saved traces',async()=>{
  const archive=new CemeteryArchive({idb:null});
  expect(await archive.add(tape(1))).toMatchObject({ok:false,code:'storage-unavailable'});
  expect(await archive.list('S1',7)).toEqual([]);
 });
 test('finite snapshots keep dead riders at their genuine final sample',()=>{
  const e=cemeteryEntry(tape(1),11);
  const live=cemeteryFrame([e],TRACE_EVERY);
  expect(live).toHaveLength(1);
  expect(live[0]).toMatchObject({atTick:4,died:false});
  const dead=cemeteryFrame([e],1000);
  expect(dead).toHaveLength(1);
  expect(dead[0]).toMatchObject({atTick:12,died:true});
  expect(dead[0].pose.x).toBe(16);
  expect(cemeteryFrame([],100)).toEqual([]);
  expect(cemeteryFrame([e],-1)).toEqual([]);
 });
});
