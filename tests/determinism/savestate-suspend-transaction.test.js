import {jest} from '@jest/globals';
import {fakeIdb} from '../replay/fakeIdb.js';
import {canonicalBytes} from '../../src/systems/replay/canonicalJson.js';
import {savestateLayoutIdOf} from '../../src/systems/savestate/layout.js';
import {snapshotEnvelopeBytes} from '../../src/systems/savestate/envelope.js';
import {LocalSuspendSlot} from '../../src/systems/savestate/localSuspendSlot.js';
import {resumeLocalSuspend} from '../../src/systems/savestate/suspendTransaction.js';
const descriptor={version:1,sections:{candidate:'test-only'}};
const layout={descriptor,validateSections:(s,e)=>Object.keys(s).length===1&&s.candidate.runId===e.runId&&s.candidate.tick===e.tick};
const identity={gameVersion:'2.25.18',buildId:'sha256:'+'a'.repeat(64),physicsIdentity:{rulesetId:'sha256:'+'b'.repeat(64),simRevision:2},matterVersion:'0.20.0',savestateLayoutId:savestateLayoutIdOf(descriptor)};
const candidate={runId:'test-run',tick:100,seed:'test-seed'};
const file=canonicalBytes(candidate);
const envelope=snapshotEnvelopeBytes({kind:'bb-savestate-cache',version:1,purpose:'suspend',build:identity,runId:candidate.runId,tick:candidate.tick,payload:{sections:{candidate}}});
let idb,slot,other,events;
const setup=async()=>{
 idb=fakeIdb();let n=0;
 const uuid=()=> '11111111-1111-4111-8111-'+String(++n).padStart(12,'0');
 slot=new LocalSuspendSlot({idb,uuid});other=new LocalSuspendSlot({idb,uuid});
 events=[];
 expect((await slot.put(envelope,identity,layout)).ok).toBe(true);
};
function stage(overrides={}){
 let alive=true,published=false;
 return {restore:jest.fn(async bytes=>{events.push('restore');expect(bytes).toEqual(file);}),
  capture:jest.fn(()=>{events.push('capture');return file;}),
  isQuarantined:jest.fn(()=>alive&&!published),
  discard:jest.fn(()=>{events.push('discard');alive=false;return true;}),
  publish:jest.fn(()=>{events.push('publish');published=true;return true;}),...overrides};
}
const run=(s,host=slot)=>resumeLocalSuspend({slot:host,identity,layout,createStage:()=>s});
beforeEach(setup);
test('consumes durably before synchronous publication; second tab cannot resume',async()=>{
 const s=stage(),consume=slot.consume.bind(slot);
 slot.consume=async token=>{const r=await consume(token);events.push('consume');return r;};
 expect(await run(s)).toMatchObject({ok:true,claimState:'consumed',runId:candidate.runId,tick:100});
 expect(events).toEqual(['restore','capture','consume','publish']);
 expect(await other.claim(identity,layout)).toMatchObject({ok:false,code:'empty'});
});
test('two overlapping resumes only stage one candidate',async()=>{
 const a=stage(),b=stage(),result=await Promise.all([run(a),run(b,other)]);
 expect(result.filter(r=>r.ok)).toHaveLength(1);
 expect(result.filter(r=>!r.ok)[0].code).toMatch(/slot-claimed|empty/);
 expect(a.restore.mock.calls.length+b.restore.mock.calls.length).toBe(1);
});
test.each([
 ['restore exception',{restore:()=>{throw Error('bad');}}],
 ['recapture difference',{capture:()=>new Uint8Array([1])}],
 ['quarantine loss',{isQuarantined:()=>false}],
])('discards and releases on %s',async(_n,override)=>{
 const s=stage(override);
 expect(await run(s)).toMatchObject({ok:false,code:'restore-refused',claimState:'released',discarded:true});
 expect(s.publish).not.toHaveBeenCalled();
 expect((await other.claim(identity,layout)).ok).toBe(true);
});
test('mutating input bytes cannot change expected recapture',async()=>{
 let changed;
 const s=stage({restore:b=>{b.fill(9);changed=b;},capture:()=>changed});
 expect(await run(s)).toMatchObject({ok:false,claimState:'released'});
 expect(s.publish).not.toHaveBeenCalled();
});
test('failed disposal retains claim; never publishes',async()=>{
 const s=stage({restore:()=>{throw Error('bad');},discard:()=>false});
 expect(await run(s)).toMatchObject({ok:false,claimState:'held',discarded:false});
 expect(await other.claim(identity,layout)).toMatchObject({ok:false,code:'slot-claimed'});
 expect(s.publish).not.toHaveBeenCalled();
});
test('factory exception holds claim; no disposal proof exists',async()=>{
 expect(await resumeLocalSuspend({slot,identity,layout,createStage:()=>{throw Error('partial host');}}))
 .toMatchObject({ok:false,claimState:'held',discarded:false});
 expect(await other.claim(identity,layout)).toMatchObject({ok:false,code:'slot-claimed'});
});
test('consume transaction abort keeps claim held and never publishes',async()=>{
 idb.hooks.failDelete=Object.assign(Error('full'),{name:'QuotaExceededError'});
 const s=stage();
 expect(await run(s)).toMatchObject({ok:false,code:'quota-exceeded',claimState:'held',discarded:true});
 expect(s.publish).not.toHaveBeenCalled();
 expect(await other.claim(identity,layout)).toMatchObject({ok:false,code:'slot-claimed'});
});
test('lost consume acknowledgement cannot reinsert or release spent save',async()=>{
 const consume=slot.consume.bind(slot);
 slot.consume=async token=>{await consume(token);throw Error('lost reply');};
 const s=stage();
 expect(await run(s)).toMatchObject({ok:false,code:'consume-uncertain',claimState:'unknown',discarded:true});
 expect(s.publish).not.toHaveBeenCalled();
 expect(await other.claim(identity,layout)).toMatchObject({ok:false,code:'empty'});
});
test('publish failure after consumption never reintroduces the slot',async()=>{
 const s=stage({publish:()=>{throw Error('host failure');}});
 expect(await run(s)).toMatchObject({ok:false,code:'publish-failed',claimState:'consumed',discarded:true});
 expect(await other.claim(identity,layout)).toMatchObject({ok:false,code:'empty'});
});
test('release failure after proven disposal is still held',async()=>{
 const s=stage({restore:()=>{throw Error('bad');}});
 slot.release=async()=>({ok:false,code:'storage-unavailable'});
 expect(await run(s)).toMatchObject({ok:false,claimState:'held',discarded:true});
 expect(await other.claim(identity,layout)).toMatchObject({ok:false,code:'slot-claimed'});
});
