/** #244: actual Chromium IndexedDB QuotaExceededError and recovery.
 * CDP quota override applies ONLY to a fresh, ephemeral browser context/origin.
 * No fake IndexedDB and no upload. Source is a Vite dev server of THIS checkout.
 * Run: GAME_URL=http://127.0.0.1:PORT/ node tools/replay/test-real-evidence-quota-browser.mjs
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import fs from 'node:fs';
import {legacyManifestFromTape,evidenceBundle,bundleBytes,validateEvidenceBundle} from '../../src/systems/replay/manifest.js';
import {digestOfBytes} from '../../src/systems/replay/canonicalSha256.js';
import {makeQuotaStressTape,QUOTA_STRESS_ROWS} from './quotaStressTape.mjs';
import {measureEvidenceCorpus} from './measure-evidence-corpus.mjs';

const url=process.env.GAME_URL;
if(!url)throw Error('GAME_URL required; use an unused local Vite port');
const origin=new URL(url).origin;
const corpus=measureEvidenceCorpus();
const ordered=[...corpus.rows].sort((a,b)=>a.canonicalEnvelopeBytes-b.canonicalEnvelopeBytes);
const expected=[ordered[0],ordered.at(-1)];
const syntheticTape=makeQuotaStressTape(JSON.parse(fs.readFileSync(expected[1].source,'utf8')));
const syntheticBytes=bundleBytes(evidenceBundle({manifest:legacyManifestFromTape(syntheticTape),tape:syntheticTape}));
assert.equal(validateEvidenceBundle(syntheticBytes).ok,true);
const stressExpected={canonicalDigest:digestOfBytes(syntheticBytes),canonicalEnvelopeBytes:syntheticBytes.length};
assert.ok(syntheticBytes.length>1000000,'stress fixture must be substantially larger than ordinary recorded envelopes');
assert.notEqual(expected[0].canonicalDigest,stressExpected.canonicalDigest);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
const pageErrors=[],mutations=[];
let page,context,cdp,quotaOverridden=false;
try{
 context=await browser.newContext();page=await context.newPage();
 page.on('pageerror',e=>pageErrors.push(String(e)));
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))mutations.push({method:r.method(),url:r.url()});});
 // Quota overrides on an ALREADY OPEN IDB connection can be advisory in Chromium.
 // Apply the limit BEFORE the test origin creates its evidence database.
 cdp=await context.newCDPSession(page);
 const temporaryQuota=300000;
 await cdp.send('Storage.overrideQuotaForOrigin',{origin,quotaSize:temporaryQuota});quotaOverridden=true;
 await page.goto(url,{waitUntil:'domcontentloaded'});
 const first=await page.evaluate(async({items,stressExpected})=>{
  const [{EvidenceStore,EVIDENCE_DB_VERSION},{legacyManifestFromTape,evidenceBundle,bundleBytes,validateEvidenceBundle},{digestOfBytes}]=await Promise.all([
   import('/src/systems/replay/evidenceStore.js'),import('/src/systems/replay/manifest.js'),import('/src/systems/replay/canonicalSha256.js')]);
  const {makeQuotaStressTape}=await import('/tools/replay/quotaStressTape.mjs');
  if(EVIDENCE_DB_VERSION!==3)throw Error('wrong v3 source');
  const samples=[];
  let stressBaseTape=null;
  for(const item of items){
   const expectedUrl=new URL('/'+item.source,location.origin).href;
   const response=await fetch(expectedUrl,{redirect:'error',cache:'no-store'});
   if(!response.ok||response.url!==expectedUrl||response.redirected)throw Error('wrong fixture source '+item.source);
   const raw=await response.arrayBuffer();
   const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('');
   if(sha!==item.sourceTapeSha256)throw Error('wrong raw fixture bytes '+item.source);
   const tape=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
   if(item.source===items[1].source)stressBaseTape=tape;
   const bytes=bundleBytes(evidenceBundle({manifest:legacyManifestFromTape(tape),tape}));
   if(!validateEvidenceBundle(bytes).ok||digestOfBytes(bytes)!==item.canonicalDigest||bytes.length!==item.canonicalEnvelopeBytes)
    throw Error('wrong canonical envelope '+item.source);
   samples.push({digest:item.canonicalDigest,bytes:Array.from(bytes)});
  }
  const stress=makeQuotaStressTape(stressBaseTape);
  const stressBytes=bundleBytes(evidenceBundle({manifest:legacyManifestFromTape(stress),tape:stress}));
  const stressDigest=digestOfBytes(stressBytes);
  if(!validateEvidenceBundle(stressBytes).ok||stressDigest!==stressExpected.canonicalDigest||
      stressBytes.length!==stressExpected.canonicalEnvelopeBytes)
    throw Error('synthetic stress envelope differs across Node and browser');
  samples[1]={digest:stressDigest,bytes:Array.from(stressBytes)};
  const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  if(store.backend!=='idb')throw Error('real IndexedDB unavailable');
  await store.put(Uint8Array.from(samples[0].bytes),{archiveOnly:true});
  globalThis.__quotaQA={store,samples};
  return {schema:EVIDENCE_DB_VERSION,firstDigest:samples[0].digest,firstBytes:samples[0].bytes.length,secondDigest:samples[1].digest,secondBytes:samples[1].bytes.length};
 },{items:expected,stressExpected});
 const active=await cdp.send('Storage.getUsageAndQuota',{origin});
 const usage=active;
 assert.equal(active.overrideActive,true);
 assert.equal(active.quota,temporaryQuota);
 const blocked=await page.evaluate(async()=>{
  const {store,samples}=globalThis.__quotaQA,large=samples[1];
  let failure=null;
  try{await store.put(Uint8Array.from(large.bytes),{archiveOnly:true});}
  catch(e){failure={code:e.code,name:e.name,message:e.message};}
  const inspect=await new (store.constructor)({idb:indexedDB,storage:null}).init();
  const big=await inspect.inspectBundle(large.digest);
  const small=await inspect.inspectBundle(samples[0].digest);
  const sessionCopy=await store.exportBundle(large.digest);
  return {failure,reportedErrorCode:store.lastError?.code,pending:store.pending.has(large.digest),unsafe:store._unsafePending.has(large.digest),
   big,small,exportMatches:Boolean(sessionCopy?.bytes&&sessionCopy.bytes.length===large.bytes.length&&
    sessionCopy.bytes.every((b,i)=>b===large.bytes[i]))};
 });
 assert.equal(blocked.failure?.code,'quota-exceeded',JSON.stringify(blocked));
 assert.equal(blocked.reportedErrorCode,'quota-exceeded');
 assert.equal(blocked.pending,true);
 assert.equal(blocked.unsafe,false,'known-new quota failure is eligible for explicit retry');
 assert.deepEqual(blocked.big,{readable:false,durable:false,runBound:false});
 assert.deepEqual(blocked.small,{readable:true,durable:true,runBound:false});
 assert.equal(blocked.exportMatches,true);
 await cdp.send('Storage.overrideQuotaForOrigin',{origin});quotaOverridden=false;
 const recovered=await page.evaluate(async()=>{
  const {store,samples}=globalThis.__quotaQA,large=samples[1];
  const receipt=await store.retryPending({digest:large.digest});
  const after=await new(store.constructor)({idb:indexedDB,storage:null}).init();
  return {receipt,large:await after.inspectBundle(large.digest),small:await after.inspectBundle(samples[0].digest)};
 });
 assert.deepEqual(recovered.large,{readable:true,durable:true,runBound:false});
 assert.deepEqual(recovered.small,{readable:true,durable:true,runBound:false});
 await page.close();page=await context.newPage();
 page.on('pageerror',e=>pageErrors.push(String(e)));
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))mutations.push({method:r.method(),url:r.url()});});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 const restart=await page.evaluate(async items=>{
  const {EvidenceStore}=await import('/src/systems/replay/evidenceStore.js');
  const {digestOfBytes}=await import('/src/systems/replay/canonicalSha256.js');
  const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  const result=[];
  for(const item of items){
   const r=await store.get(item.canonicalDigest);
   result.push({digest:item.canonicalDigest,valid:!!r&&r.length===item.canonicalEnvelopeBytes&&digestOfBytes(r)===item.canonicalDigest});
  }
  return result;
 },[expected[0],stressExpected]);
 assert.ok(restart.every(x=>x.valid));
 assert.deepEqual(mutations,[]);
 assert.deepEqual(pageErrors,[]);
 console.log(JSON.stringify({format:'bb-244-real-browser-quota-v1',url,stressFixture:{synthetic:true,inputRows:QUOTA_STRESS_ROWS,bytes:stressExpected.canonicalEnvelopeBytes},first,realChromiumQuota:{usageBefore:usage.usage,forcedLimit:temporaryQuota,activeOverride:active.overrideActive},
  blocked,recovered,restart,mutatingRequests:mutations,pageErrors,
  caveats:['CDP quota override is real Chromium IndexedDB quota pressure in ephemeral test context, not physical Chromebook capacity',
   'First saved envelope is historical; quota-failed envelope is SYNTHETIC with 120000 deterministic input rows, not played, scored, or captured',
   'Explicit quota reset before page restart; no user profile or network upload touched']},null,2));
}finally{
 if(quotaOverridden&&cdp)await cdp.send('Storage.overrideQuotaForOrigin',{origin}).catch(()=>{});
 await context?.close().catch(()=>{});await browser.close();
}
