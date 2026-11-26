/** #119: storage/ownership only; no live Matter restore or scoreboard status. */
import {fakeIdb} from '../replay/fakeIdb.js';
import {f64Encode} from '../../src/systems/replay/canonicalJson.js';
import {savestateLayoutIdOf} from '../../src/systems/savestate/layout.js';
import {snapshotEnvelopeBytes} from '../../src/systems/savestate/envelope.js';
import {LocalSuspendSlot,SUSPEND_SLOT_DB,SUSPEND_SLOT_STORE,SUSPEND_SLOT_KEY} from '../../src/systems/savestate/localSuspendSlot.js';
const H=c=>'sha256:'+String(c).repeat(64);
const descriptor=Object.freeze({version:1,sections:{sim:{fields:['tick:uint32','velocity:f64']}}});
const layout=Object.freeze({descriptor,validateSections:s=>
 Object.keys(s).length===1&&s.sim&&Object.keys(s.sim).length===2&&
 Number.isSafeInteger(s.sim.tick)&&typeof s.sim.velocity==='string'});
const identity=()=>({gameVersion:'2.22.7',buildId:H('a'),physicsIdentity:{rulesetId:H('b'),simRevision:9},
 matterVersion:'0.20.0',savestateLayoutId:savestateLayoutIdOf(descriptor)});
const raw=(overrides={})=>({kind:'bb-savestate-cache',version:1,purpose:'suspend',build:identity(),
 runId:'synthetic-run-1',tick:120,payload:{sections:{sim:{tick:120,velocity:f64Encode(0)}}},...overrides});
const bytes=(overrides={})=>snapshotEnvelopeBytes(raw(overrides));
const uuid=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
let next=0;
const make=(idb,other={})=>new LocalSuspendSlot({idb,uuid:()=>uuid(++next),...other});

beforeEach(()=>{next=0;});

describe('inert local single-use suspend slot — cannot authorize a restore',()=>{
 test('requires exact build + registered layout; rejects fake/partial bytes before storage',async()=>{
  const idb=fakeIdb(),slot=make(idb);
  expect(await slot.put(bytes(),undefined,layout)).toMatchObject({ok:false,code:'missing-runtime-identity'});
  expect(await slot.put(bytes(),identity(),null)).toMatchObject({ok:false,code:'unsupported-layout'});
  expect(await slot.put(bytes({purpose:'practice'}),identity(),layout)).toEqual({ok:false,code:'not-suspend'});
  expect(await slot.put(new Uint8Array([3,4]),identity(),layout)).toMatchObject({ok:false});
  expect(await slot.claim(identity(),layout)).toEqual({ok:false,code:'empty'});
  expect(idb.names()).toContain(SUSPEND_SLOT_DB);
 });
 test('stashes only envelope-only admission, one slot; requires consume after caller-side restore',async()=>{
  const idb=fakeIdb(),slot=make(idb);
  const original=bytes();
  const saved=await slot.put(original,identity(),layout);
  expect(saved).toMatchObject({ok:true,saved:true,admission:'envelope-only',tick:120,runId:'synthetic-run-1'});
  expect(saved).not.toHaveProperty('trusted');expect(saved).not.toHaveProperty('restorable');
  original.fill(9); // post-validation mutation must NOT mutate the stored clone
  expect(await slot.put(bytes(),identity(),layout)).toMatchObject({ok:false,code:'slot-occupied'});
  const claimed=await slot.claim(identity(),layout);
  expect(claimed).toMatchObject({ok:true,admission:'envelope-only',claimed:true,runId:'synthetic-run-1'});
  expect(claimed).not.toHaveProperty('trusted');expect(claimed).not.toHaveProperty('restorable');
  expect(claimed.bytes).toEqual(bytes());
  claimed.bytes.fill(42);
  expect(await slot.claim(identity(),layout)).toEqual({ok:false,code:'slot-claimed'});
  expect(await slot.put(bytes(),identity(),layout,{replace:true})).toEqual({ok:false,code:'slot-claimed'});
  expect(await slot.clearReady()).toEqual({ok:false,code:'slot-claimed'});
  expect(await slot.consume(claimed.token)).toEqual({ok:true,consumed:true});
  expect(await slot.consume(claimed.token)).toEqual({ok:false,code:'empty'});
  expect(await slot.claim(identity(),layout)).toEqual({ok:false,code:'empty'});
 });
 test('independent tabs can never claim one ready slot twice',async()=>{
  const idb=fakeIdb(),tabA=make(idb),tabB=make(idb);
  expect((await tabA.put(bytes(),identity(),layout)).ok).toBe(true);
  const [a,b]=await Promise.all([tabA.claim(identity(),layout),tabB.claim(identity(),layout)]);
  expect([a,b].filter(x=>x.ok)).toHaveLength(1);
  expect([a,b].filter(x=>!x.ok)).toEqual([{ok:false,code:'slot-claimed'}]);
  const winner=a.ok?a:b,loser=a.ok?tabB:tabA,owner=a.ok?tabA:tabB;
  expect(await loser.consume(uuid(999))).toEqual({ok:false,code:'claim-mismatch'});
  expect(await loser.release(uuid(999))).toEqual({ok:false,code:'claim-mismatch'});
  expect(await owner.consume(winner.token)).toEqual({ok:true,consumed:true});
  expect(await tabB.claim(identity(),layout)).toEqual({ok:false,code:'empty'});
 });
 test('mismatched current build and tampered slot binding fail closed; original remains unclaimed',async()=>{
  const idb=fakeIdb(),slot=make(idb);
  expect((await slot.put(bytes(),identity(),layout)).ok).toBe(true);
  expect(await slot.claim({...identity(),buildId:H('c')},layout)).toMatchObject({ok:false,code:'build-mismatch'});
  const good=await slot.claim(identity(),layout);
  expect(good.ok).toBe(true);
  expect(await slot.release(good.token)).toEqual({ok:true,released:true});
  // Deliberate test-only corrupt IDB row to simulate storage mutation.
  const db=await new Promise((resolve,reject)=>{const r=idb.open(SUSPEND_SLOT_DB,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const tx=db.transaction(SUSPEND_SLOT_STORE,'readwrite'),store=tx.objectStore(SUSPEND_SLOT_STORE);
  const get=store.get(SUSPEND_SLOT_KEY);
  get.onsuccess=()=>{const row=get.result;row.tick=121;store.put(row);};
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
  expect(await slot.claim(identity(),layout)).toEqual({ok:false,code:'binding-mismatch'});
  expect(await slot.clearReady()).toEqual({ok:true,cleared:true});
 });
 test('failed restore releases only by claimant; no timed second-owner recovery or stale-token override',async()=>{
  const idb=fakeIdb(),a=make(idb),b=make(idb);
  await a.put(bytes(),identity(),layout);
  const claimed=await a.claim(identity(),layout);
  expect(await b.claim(identity(),layout)).toEqual({ok:false,code:'slot-claimed'});
  expect(await b.clearReady()).toEqual({ok:false,code:'slot-claimed'});
  expect(await a.release(claimed.token)).toEqual({ok:true,released:true});
  const nextClaim=await b.claim(identity(),layout);
  expect(nextClaim.ok).toBe(true);
  expect(await a.consume(claimed.token)).toEqual({ok:false,code:'claim-mismatch'});
  expect(await a.release(claimed.token)).toEqual({ok:false,code:'claim-mismatch'});
  expect(await b.consume(nextClaim.token)).toEqual({ok:true,consumed:true});
 });
 test('explicit discard and replace never steal a held token; private DB independent of ghost/replay',async()=>{
  const idb=fakeIdb(),slot=make(idb);
  expect(await slot.clearReady()).toEqual({ok:true,cleared:false});
  await slot.put(bytes(),identity(),layout);
  expect(await slot.put(bytes({runId:'synthetic-run-2'}),identity(),layout,{replace:true})).toMatchObject({ok:true,saved:true,runId:'synthetic-run-2'});
  expect(await slot.clearReady()).toEqual({ok:true,cleared:true});
  expect(await slot.clearReady()).toEqual({ok:true,cleared:false});
  expect(idb.names()).toEqual([SUSPEND_SLOT_DB]);
 });
 test('a corrupted local status cannot be silently overwritten by replace:true',async()=>{
  const idb=fakeIdb(),slot=make(idb);
  expect((await slot.put(bytes(),identity(),layout)).ok).toBe(true);
  const db=await new Promise((resolve,reject)=>{
   const req=idb.open(SUSPEND_SLOT_DB,1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  const tx=db.transaction(SUSPEND_SLOT_STORE,'readwrite'),store=tx.objectStore(SUSPEND_SLOT_STORE);
  const get=store.get(SUSPEND_SLOT_KEY);
  get.onsuccess=()=>{store.put({...get.result,status:'unknown-corrupted',claimedBy:uuid(42)});};
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
  expect(await slot.put(bytes({runId:'replacement'}),identity(),layout,{replace:true}))
   .toEqual({ok:false,code:'invalid-slot-state'});
  expect(await slot.claim(identity(),layout)).toEqual({ok:false,code:'slot-claimed'});
  expect(await slot.clearReady()).toEqual({ok:false,code:'slot-claimed'});
 });
 test('quota and storage errors never claim success; subsequent normal write is possible',async()=>{
  const idb=fakeIdb(),slot=make(idb);
  idb.hooks.failPut=Object.assign(Error('full'),{name:'QuotaExceededError'});
  expect(await slot.put(bytes(),identity(),layout)).toEqual({ok:false,code:'quota-exceeded'});
  expect(await slot.claim(identity(),layout)).toEqual({ok:false,code:'empty'});
  idb.hooks.failPut=null;
  expect((await slot.put(bytes(),identity(),layout)).ok).toBe(true);
  const claimed=await slot.claim(identity(),layout);
  idb.hooks.failDelete=Object.assign(Error('full'),{name:'QuotaExceededError'});
  expect(await slot.consume(claimed.token)).toEqual({ok:false,code:'quota-exceeded'});
  expect(await slot.claim(identity(),layout)).toEqual({ok:false,code:'slot-claimed'});
  idb.hooks.failDelete=null;
  expect(await slot.consume(claimed.token)).toEqual({ok:true,consumed:true});
 });
 test('without IndexedDB or a secure token, no suspend can be resumed',async()=>{
  expect(await new LocalSuspendSlot({idb:null}).put(bytes(),identity(),layout)).toEqual({ok:false,code:'storage-unavailable'});
  const idb=fakeIdb(),writer=make(idb);
  await writer.put(bytes(),identity(),layout);
  const noEntropy=make(idb,{uuid:()=>null});
  expect(await noEntropy.claim(identity(),layout)).toEqual({ok:false,code:'secure-token-unavailable'});
  expect((await writer.claim(identity(),layout)).ok).toBe(true);
 });
});
