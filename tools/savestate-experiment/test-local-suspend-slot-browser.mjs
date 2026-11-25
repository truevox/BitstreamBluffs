/** #119: real Chromium overlapping-tab IndexedDB single-use storage gate.
 * Synthetic toy schema and envelope ONLY. Never a real Matter restore, real
 * player tape, score/trust receipt, public entitlement or production UI.
 * GAME_URL=http://127.0.0.1:18410/ node tools/savestate-experiment/test-local-suspend-slot-browser.mjs
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL;
if(!url)throw Error('GAME_URL required');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
const errors=[],writes=[];
try{
 const ctx=await browser.newContext({viewport:{width:960,height:540}});
 const A=await ctx.newPage(),B=await ctx.newPage();
 for(const p of [A,B]){
  p.on('pageerror',e=>errors.push(e.message));
  p.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(r.method()+':'+r.url());});
  await p.goto(url,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
  await p.evaluate(async()=>{
   const [{LocalSuspendSlot},{snapshotEnvelopeBytes},{savestateLayoutIdOf},{f64Encode}]=await Promise.all([
    import('/src/systems/savestate/localSuspendSlot.js'),
    import('/src/systems/savestate/envelope.js'),
    import('/src/systems/savestate/layout.js'),
    import('/src/systems/replay/canonicalJson.js')]);
   const H=c=>'sha256:'+c.repeat(64);
   const descriptor={version:1,sections:{sim:{fields:['tick:uint32','velocity:f64']}}};
   const layout={descriptor,validateSections:s=>Object.keys(s).length===1&&
    Number.isSafeInteger(s.sim?.tick)&&typeof s.sim?.velocity==='string'};
   const identity={gameVersion:'2.22.9',buildId:H('a'),
    physicsIdentity:{rulesetId:H('b'),simRevision:9},matterVersion:'0.20.0',
    savestateLayoutId:savestateLayoutIdOf(descriptor)};
   const bytes=snapshotEnvelopeBytes({kind:'bb-savestate-cache',version:1,purpose:'suspend',
    build:identity,runId:'test-chromium-local-only',tick:240,
    payload:{sections:{sim:{tick:240,velocity:f64Encode(0)}}}});
   window.__slotQa={slot:new LocalSuspendSlot(),layout,identity,bytes};
  });
 }
 const saved=await A.evaluate(async()=>{
  const q=window.__slotQa;
  const wrong=await q.slot.put(q.bytes,{...q.identity,buildId:'sha256:'+'c'.repeat(64)},q.layout);
  const correct=await q.slot.put(q.bytes,q.identity,q.layout);
  return {wrong,correct};
 });
 assert(saved.wrong.code==='build-mismatch'&&saved.correct.ok&&saved.correct.admission==='envelope-only',JSON.stringify(saved));
 const afterReload=await A.reload({waitUntil:'domcontentloaded'});
 assert(afterReload);
 // Reload intentionally destroys the old JS handle; reconstruct trusted
 // local runtime identity/validator from a second still-alive tab for this
 // synthetic test. No actual player state was restored.
 await A.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
 await A.evaluate(async()=>{
  const [{LocalSuspendSlot},{savestateLayoutIdOf}]=await Promise.all([
   import('/src/systems/savestate/localSuspendSlot.js'),import('/src/systems/savestate/layout.js')]);
  const descriptor={version:1,sections:{sim:{fields:['tick:uint32','velocity:f64']}}};
  window.__slotQa={slot:new LocalSuspendSlot(),layout:{descriptor,validateSections:s=>
   Object.keys(s).length===1&&Number.isSafeInteger(s.sim?.tick)&&typeof s.sim?.velocity==='string'},
   identity:{gameVersion:'2.22.9',buildId:'sha256:'+'a'.repeat(64),
    physicsIdentity:{rulesetId:'sha256:'+'b'.repeat(64),simRevision:9},
    matterVersion:'0.20.0',savestateLayoutId:savestateLayoutIdOf(descriptor)}};
 });
 const wrongIdentity=await B.evaluate(async()=>{
  const q=window.__slotQa;
  return q.slot.claim({...q.identity,buildId:'sha256:'+'f'.repeat(64)},q.layout);
 });
 assert(wrongIdentity.code==='build-mismatch',JSON.stringify(wrongIdentity));
 const results=await Promise.all([A,B].map(p=>p.evaluate(async()=>{
  const q=window.__slotQa,r=await q.slot.claim(q.identity,q.layout);
  window.__claimedToken=r.token||null;
  return {ok:r.ok,code:r.code,admission:r.admission,token:r.token,runId:r.runId,tick:r.tick};
 })));
 assert(results.filter(x=>x.ok).length===1,JSON.stringify(results));
 const winner=results[0].ok?A:B,loser=results[0].ok?B:A;
 const blocked=await loser.evaluate(async()=>{
  const s=window.__slotQa.slot;
  return {claim:await s.claim(window.__slotQa.identity,window.__slotQa.layout),
   clear:await s.clearReady(),wrongConsume:await s.consume('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')};
 });
 assert(blocked.claim.code==='slot-claimed'&&blocked.clear.code==='slot-claimed'&&
  blocked.wrongConsume.code==='claim-mismatch',JSON.stringify(blocked));
 const released=await winner.evaluate(async()=>window.__slotQa.slot.release(window.__claimedToken));
 assert(released.ok&&released.released);
 const second=await loser.evaluate(async()=>{
  const q=window.__slotQa,r=await q.slot.claim(q.identity,q.layout);
  window.__claimedToken=r.token||null;
  return {ok:r.ok,admission:r.admission,tick:r.tick,runId:r.runId};
 });
 assert(second.ok&&second.admission==='envelope-only'&&second.tick===240,JSON.stringify(second));
 const stale=await winner.evaluate(async()=>window.__slotQa.slot.consume(window.__claimedToken));
 assert(stale.code==='claim-mismatch',JSON.stringify(stale));
 const consumed=await loser.evaluate(async()=>window.__slotQa.slot.consume(window.__claimedToken));
 assert(consumed.ok&&consumed.consumed);
 const empty=await A.evaluate(async()=>window.__slotQa.slot.claim(window.__slotQa.identity,window.__slotQa.layout));
 assert(empty.code==='empty',JSON.stringify(empty));
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('PASS_SINGLE_USE_SLOT_REAL_CHROMIUM',JSON.stringify({
  saved,wrongIdentity,claims:results.map(({token,...rest})=>rest),
  blocked,released,second,stale,consumed,empty,
  afterPageReload:true,errors,writes,
  admission:'envelope-only',realMatterRestore:false,scoreAuth:false,
 }));
 await ctx.close();
}finally{await browser.close();}
