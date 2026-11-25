/** Real Chromium IndexedDB storage of the committed historical tape corpus.
 * Does not simulate quota exhaustion, authentication, or fresh SIM9 capture.
 * Needs a Vite server serving the SAME checkout; GAME_URL env selects origin.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {measureEvidenceCorpus} from './measure-evidence-corpus.mjs';
const expected=measureEvidenceCorpus();
const url=process.env.GAME_URL;
if(!url)throw Error('GAME_URL required for source-pinned browser test');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 const mutatingRequests=[];
 page.on('request',request=>{
  if(!['GET','HEAD','OPTIONS'].includes(request.method()))
   mutatingRequests.push({method:request.method(),url:request.url()});
 });
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 const report=await page.evaluate(async expectations=>{
  const [{EvidenceStore,EVIDENCE_DB_VERSION},{legacyManifestFromTape,evidenceBundle,bundleBytes,validateEvidenceBundle},{digestOfBytes}]=await Promise.all([
   import('/src/systems/replay/evidenceStore.js'),import('/src/systems/replay/manifest.js'),import('/src/systems/replay/canonicalSha256.js')]);
  if(EVIDENCE_DB_VERSION!==3)throw Error('served evidence store schema is not v3');
  const samples=await Promise.all(expectations.map(async({source,canonicalDigest,canonicalEnvelopeBytes})=>{
   const response=await fetch('/'+source);
   if(!response.ok)throw Error(`missing fixture ${source}: ${response.status}`);
   const tape=await response.json(),bytes=bundleBytes(evidenceBundle({manifest:legacyManifestFromTape(tape),tape}));
   if(!validateEvidenceBundle(bytes).ok)throw Error('invalid envelope '+source);
   const actual=digestOfBytes(bytes);
   if(actual!==canonicalDigest||bytes.length!==canonicalEnvelopeBytes)
    throw Error('fixture identity mismatch between Node and browser: '+source);
   return {source,bytes:Array.from(bytes),canonicalDigest};
  }));
  const before=await navigator.storage.estimate();
  const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  if(store.backend!=='idb')throw Error('real IndexedDB backend unavailable');
  const digests=[];
  for(let i=0;i<samples.length;i++){
   const digest=await store.put(Uint8Array.from(samples[i].bytes),{archiveOnly:true});
   digests.push(digest);
  }
  if(new Set(digests).size!==expectations.length)throw Error('fixture digest collision');
  for(let i=0;i<digests.length;i++)
   if(digests[i]!==samples[i].canonicalDigest)throw Error('persisted digest mismatch '+samples[i].source);
  const after=await navigator.storage.estimate();
  const reopening=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  let totalBytes=0;
  for(let i=0;i<samples.length;i++){
   const got=await reopening.get(digests[i]);
   if(!got||got.length!==samples[i].bytes.length||!got.every((b,k)=>b===samples[i].bytes[k]))
    throw Error('durable bytes mismatch '+samples[i].source);
   totalBytes+=got.length;
  }
  let pinFailureCode=null;
  try {await reopening.protect(digests[0],{runId:'historical-corpus-read-only',role:'pinned'});}
  catch(error){pinFailureCode=error.code;}
  if(pinFailureCode!=='run-id-mismatch')
   throw Error('unbound archive pin must refuse with run-id-mismatch, got '+pinFailureCode);
  const deleted=digests.slice(0,5);
  for(const digest of deleted)await reopening.remove(digest);
  const restarted=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  for(const digest of deleted){if(await restarted.get(digest))throw Error('deleted record resurrected '+digest);}
  for(const digest of digests.slice(5)){if(!(await restarted.get(digest)))throw Error('retained record missing '+digest);}
  return {backend:restarted.backend,schemaVersion:EVIDENCE_DB_VERSION,captured:digests.length,
   retained:digests.length-deleted.length,deleted:deleted.length,bytesBeforeDeletion:totalBytes,
   estimateBefore:before,estimateAfter:after,pinFailureCode};
 },expected.rows.map(r=>({source:r.source,canonicalDigest:r.canonicalDigest,
   canonicalEnvelopeBytes:r.canonicalEnvelopeBytes})));
 assert.equal(report.captured,expected.recordingCount);
 assert.equal(report.bytesBeforeDeletion,expected.canonicalEnvelope.sum);
 assert.equal(report.pinFailureCode,'run-id-mismatch');
 assert.deepEqual(mutatingRequests,[],`unexpected mutating browser request: ${JSON.stringify(mutatingRequests)}`);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({format:'bb-evidence-corpus-real-chromium',source:url,report,pageErrors:errors,
  observedMutatingRequests:mutatingRequests,
  caveats:['Historical legacy-derived fixture envelopes, not current live SIM9',
    'Storage estimate origin-wide and can include unrelated files; not proof of quota exhaustion',
    'No fake quota test: real storage pressure from 46 committed recordings only']},null,2));
 await context.close();
}finally{await browser.close();}
