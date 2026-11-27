/** #244: Real Chromium IndexedDB quota pressure using ONLY genuine current-SIM9
 * RunScene/Matter/GhostRecorder terminal evidence bundles, not manufactured tapes.
 * The pad is automated analog-stress input; it is NOT a human performance sample.
 * CDP override is temporary and scoped to an ephemeral test browser/origin.
 * Run with GAME_URL and BSB244_FRESH_CORPUS_OUT (32 native bundles) configured.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

const url=process.env.GAME_URL;
const file=process.env.BSB244_FRESH_CORPUS_OUT;
if(!url||!file)throw Error('GAME_URL and BSB244_FRESH_CORPUS_OUT required');
const {rows,rulesetId}=JSON.parse(fs.readFileSync(file,'utf8'));
assert.ok(rows.length>=24,'need at least 24 genuine source-captured native bundles');
assert.ok(rows.every(r=>r.nativeContactPairs>=0&&r.inputRows===r.ticks+1),
 'not the native high-density recorder corpus');
assert.ok(rows.reduce((n,r)=>n+r.bytes,0)>400000,'insufficient real bundle volume for quota test');
const origin=new URL(url).origin;
// Calibrate the REAL current-browser quota footprint with two genuine native
// bundles in a disposable context. Chromium can cache quota before an IDB
// connection opens, so apply the override only in a NEW browser context,
// before the evidence DB exists. A fixed 128 KiB limit was flaky across
// browser builds due to variable actual IndexedDB accounting/compression.
let quotaHeadroom=0,quotaSize=0,baselineUsage=0,firstDurableUsage=0;
let firstGrowth=0,secondGrowth=0;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
let context,cdp,overrideActive=false;
const pageErrors=[],mutating=[];
const watch=page=>{
 page.on('pageerror',e=>pageErrors.push(String(e)));
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))mutating.push(r.method());});
};
// Storage usage reporting can lag an IDB transaction's oncomplete on busy
// CI machines. Read actual browser CDP usage, never approximate raw row bytes.
const usageAfter=async(session,minimum)=>{
 for(let i=0;i<40;i++){
  const snapshot=await session.send('Storage.getUsageAndQuota',{origin});
  if(Number.isSafeInteger(snapshot.usage)&&snapshot.usage>minimum)return snapshot.usage;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Error('CDP did not account for real native IndexedDB write');
};
try{
 // Disposable browser profile: determine real IDB growth from two different
 // fully validated current-build native tapes (not synthetic padding).
 context=await browser.newContext();
 let page=await context.newPage();watch(page);
 cdp=await context.newCDPSession(page);
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive() &&
   window.__bbGame?.registry?.get('attemptHistory')?.ready,{timeout:30000});
 const beforeCalibration=await cdp.send('Storage.getUsageAndQuota',{origin});
 if(!Number.isSafeInteger(beforeCalibration.usage)||beforeCalibration.usage<0)
  throw Error('invalid calibration origin usage');
 const calibrated=[];
 for(const row of rows.slice(0,2)){
  await page.evaluate(async({row,rulesetId})=>{
   const [{EvidenceStore},{validateEvidenceBundle},{digestOfBytes},{loadCurrentRuleset}]=await Promise.all([
    import('/src/systems/replay/evidenceStore.js'),import('/src/systems/replay/manifest.js'),
    import('/src/systems/replay/canonicalSha256.js'),import('/src/systems/replay/runtimeRuleset.js')]);
   const current=await loadCurrentRuleset();
   if(current.rulesetId!==rulesetId)throw Error('calibration ruleset mismatch');
   const bytes=Uint8Array.from(atob(row.base64),c=>c.charCodeAt(0));
   let store=globalThis.__nativeQuotaCalibrationStore;
   if(!store){
    store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
    if(store.backend!=='idb')throw Error('calibration real IndexedDB unavailable');
    store.rulesetResolver=id=>id===current.rulesetId?current.doc:null;
    globalThis.__nativeQuotaCalibrationStore=store;
   }
   const verdict=validateEvidenceBundle(bytes,store.rulesetResolver);
   if(!verdict.ok||digestOfBytes(bytes)!==row.digest||
      verdict.bundleDigest!==row.digest||bytes.length!==row.bytes)
    throw Error('invalid native calibration tape '+row.seed);
   const digest=await store.put(bytes,{runId:row.runId});
   if(digest!==row.digest||!(await store.isBundleDurable(digest,{runId:row.runId})))
    throw Error('native calibration tape not durable '+row.seed);
  },{row,rulesetId});
  calibrated.push(await usageAfter(cdp,calibrated.at(-1)??beforeCalibration.usage));
 }
 firstDurableUsage=calibrated[0];
 firstGrowth=firstDurableUsage-beforeCalibration.usage;
 secondGrowth=calibrated[1]-calibrated[0];
 if(firstGrowth<=0||secondGrowth<=0)
  throw Error('Chrome did not account for distinct genuine native evidence writes');
 // Browser quota accounting may reserve more bytes than CDP's usage field
 // exposes at the instant the first IDB transaction commits. Allow four
 // measured additional-bundle deltas (minimum 32 KiB), enough for at least
 // one genuine durable tape, but still well below a 32-tape corpus.
 quotaHeadroom=firstGrowth+Math.max(32*1024,4*secondGrowth);
 await context.close();context=null;cdp=null;

 // NEW ephemeral origin: override BEFORE opening the evidence database. No
 // original capture, browser profile or user data is ever touched.
 context=await browser.newContext();
 page=await context.newPage();watch(page);
 cdp=await context.newCDPSession(page);
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive() &&
   window.__bbGame?.registry?.get('attemptHistory')?.ready,{timeout:30000});
 const baseline=await cdp.send('Storage.getUsageAndQuota',{origin});
 baselineUsage=baseline.usage;
 if(!Number.isSafeInteger(baselineUsage)||baselineUsage<0)
  throw Error('invalid baseline origin storage usage');
 quotaSize=baselineUsage+quotaHeadroom;
 console.log('NATIVE_REAL_QUOTA_CALIBRATION',JSON.stringify({firstGrowth,secondGrowth,
  calibrationFirstUsage:firstDurableUsage,baselineUsage,quotaHeadroom,quotaSize}));
 await cdp.send('Storage.overrideQuotaForOrigin',{origin,quotaSize});overrideActive=true;
 const underLimit=await page.evaluate(async({rows,rulesetId})=>{
  const [{EvidenceStore},{validateEvidenceBundle},{digestOfBytes},{loadCurrentRuleset}]=await Promise.all([
   import('/src/systems/replay/evidenceStore.js'),import('/src/systems/replay/manifest.js'),
   import('/src/systems/replay/canonicalSha256.js'),import('/src/systems/replay/runtimeRuleset.js')]);
  const current=await loadCurrentRuleset();
  if(current.rulesetId!==rulesetId)throw Error('different build/ruleset: refuse cross-build admission');
  const bytesOf=b64=>Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
  const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  if(store.backend!=='idb')throw Error('quota-phase real IndexedDB unavailable');
  store.rulesetResolver=id=>id===current.rulesetId?current.doc:null;
  const saved=[];let failed=null;
  for(const row of rows){
   const bytes=bytesOf(row.base64);
   const verdict=validateEvidenceBundle(bytes,store.rulesetResolver);
   if(!verdict.ok||digestOfBytes(bytes)!==row.digest||verdict.bundleDigest!==row.digest||bytes.length!==row.bytes)
    throw Error('invalid actual native evidence '+row.seed);
   try{
    const digest=await store.put(bytes,{runId:row.runId});
    if(digest!==row.digest||!(await store.isBundleDurable(digest,{runId:row.runId})))
     throw Error('unexpected non-durable success '+row.seed);
    saved.push({runId:row.runId,digest:row.digest,bytes:row.bytes,base64:row.base64});
   }catch(e){
    if(e.code!=='quota-exceeded')throw e;
    if(store.lastError?.code!=='quota-exceeded')throw Error('wrong store quota error');
    if(!store.pending.has(row.digest)||await store.isBundleDurable(row.digest,{runId:row.runId}))
     throw Error('quota-failed native tape incorrectly marked durable');
    const copy=await store.exportBundle(row.digest);
    if(!copy?.bytes||copy.bytes.length!==bytes.length||!copy.bytes.every((b,i)=>b===bytes[i]))
     throw Error('memory-only native quota tape unavailable for export');
    const other=await new EvidenceStore({idb:indexedDB,storage:null}).init();
    const inspected=await other.inspectBundle(row.digest,{runId:row.runId});
    if(inspected.durable||inspected.runBound)throw Error('failed native tape leaked durable run claim');
    failed={runId:row.runId,digest:row.digest,bytes:row.bytes,base64:row.base64,code:e.code,
      pending:true,notDurable:!inspected.durable,exportMatches:true};
    break;
   }
  }
  if(!failed||saved.length<1)throw Error('did not observe bounded REAL quota after genuine native write; saved='+
   saved.length+' of '+rows.length+', firstDurable='+(saved[0]?.bytes??'none'));
  globalThis.__nativeQuota244={store,saved,failed};
  return {count:rows.length,savedCount:saved.length,failedAt:saved.length,failed,
   storedBytes:saved.reduce((n,x)=>n+x.bytes,0),failedBytes:failed.bytes};
 },{rows,rulesetId});
 const usage=await cdp.send('Storage.getUsageAndQuota',{origin});
 assert.equal(usage.overrideActive,true);
 assert.equal(usage.quota,quotaSize);
 assert.equal(underLimit.failed.code,'quota-exceeded');
 assert.equal(underLimit.failed.notDurable,true);
 assert.ok(underLimit.savedCount<rows.length);
 await cdp.send('Storage.overrideQuotaForOrigin',{origin});overrideActive=false;
 const afterClear=await page.evaluate(async()=>{
  const {store,saved,failed}=globalThis.__nativeQuota244;
  const receipt=await store.retryPending({digest:failed.digest});
  const checked=await new store.constructor({idb:indexedDB,storage:null}).init();
  const accepted=await checked.isBundleDurable(failed.digest,{runId:failed.runId});
  const allOld=await Promise.all(saved.map(x=>checked.isBundleDurable(x.digest,{runId:x.runId})));
  const pending=store.pending.has(failed.digest);
  const queued=store.pendingMeta.has(failed.digest);
  store._db?.close();checked._db?.close();
  return {receipt,accepted,oldIntact:allOld.every(Boolean),pending,queued};
 });
 assert.deepEqual(afterClear.receipt,{attempted:1,recovered:1,remaining:0});
 assert.equal(afterClear.accepted,true);
 assert.equal(afterClear.oldIntact,true);
 assert.equal(afterClear.pending,false);
 assert.equal(afterClear.queued,false);
 await page.close();page=await context.newPage();watch(page);
 await page.goto(url,{waitUntil:'domcontentloaded'});
 const restarted=await page.evaluate(async()=>{
  const [{EvidenceStore},{digestOfBytes}]=await Promise.all([
   import('/src/systems/replay/evidenceStore.js'),import('/src/systems/replay/canonicalSha256.js')]);
  const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  // The originating page is gone. Only native IndexedDB records can survive.
  const rows=store.list();
  const persisted=[];
  for(const row of rows){
   const b=await store.get(row.digest);
   if(!b||digestOfBytes(b)!==row.digest||b.length!==row.size)
    throw Error('corrupt native stored bundle after page restart');
   persisted.push({digest:row.digest,runId:row.runId,size:row.size});
  }
  store._db?.close();
  return persisted;
 });
 const accepted=[...rows.slice(0,underLimit.savedCount),rows[underLimit.failedAt]];
 assert.equal(restarted.length,accepted.length);
 for(const row of accepted){
  const stored=restarted.find(x=>x.digest===row.digest);
  assert.ok(stored,'restarted native bundle missing '+row.seed);
  assert.equal(stored.runId,row.runId);
  assert.equal(stored.size,row.bytes);
 }
 assert.deepEqual(pageErrors,[]);
 assert.deepEqual(mutating,[]);
 console.log('NATIVE_REAL_QUOTA_PASS',JSON.stringify({source:'native-source-current-SIM9',
  automatedPadNotHuman:true,captured:rows.length,storedBeforeQuota:underLimit.savedCount,
  nativeBytesStoredBeforeQuota:underLimit.storedBytes,
  nativeFailedBytes:underLimit.failedBytes,baselineUsage,firstDurableUsage,
  firstGrowth,secondGrowth,quotaHeadroom,quotaSize,overrideActive:usage.overrideActive,
  quotaFailure:underLimit.failed.code,oldIntact:afterClear.oldIntact,
  explicitRetry:afterClear.receipt,restartedDurableRecords:restarted.length,
  errors:pageErrors,mutatingRequests:mutating,
  caveat:'Real Chromium CDP-overridden quota on automated genuine native recordings; not physical Chromebook quota or human controller input.'}));
}finally{
 if(overrideActive&&cdp)await cdp.send('Storage.overrideQuotaForOrigin',{origin}).catch(()=>{});
 await context?.close().catch(()=>{});await browser.close();
}
