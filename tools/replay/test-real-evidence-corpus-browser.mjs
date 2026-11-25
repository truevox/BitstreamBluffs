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
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 const report=await page.evaluate(async sources=>{
  const [{EvidenceStore},{legacyManifestFromTape,evidenceBundle,bundleBytes,validateEvidenceBundle}]=await Promise.all([
   import('/src/systems/replay/evidenceStore.js'),import('/src/systems/replay/manifest.js')]);
  const samples=await Promise.all(sources.map(async source=>{
   const response=await fetch('/'+source);
   if(!response.ok)throw Error(`missing fixture ${source}: ${response.status}`);
   const tape=await response.json(),bytes=bundleBytes(evidenceBundle({manifest:legacyManifestFromTape(tape),tape}));
   if(!validateEvidenceBundle(bytes).ok)throw Error('invalid envelope '+source);
   return {source,bytes:Array.from(bytes)};
  }));
  const before=await navigator.storage.estimate();
  const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  if(store.backend!=='idb')throw Error('real IndexedDB backend unavailable');
  const digests=[];
  for(let i=0;i<samples.length;i++){
   const digest=await store.put(Uint8Array.from(samples[i].bytes),{archiveOnly:true});
   digests.push(digest);
  }
  if(new Set(digests).size!==sources.length)throw Error('fixture digest collision');
  const after=await navigator.storage.estimate();
  const reopening=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  let totalBytes=0;
  for(let i=0;i<samples.length;i++){
   const got=await reopening.get(digests[i]);
   if(!got||got.length!==samples[i].bytes.length||!got.every((b,k)=>b===samples[i].bytes[k]))
    throw Error('durable bytes mismatch '+samples[i].source);
   totalBytes+=got.length;
  }
  const protectedRef=await reopening.protect(digests[0],{runId:'historical-corpus-read-only',role:'pinned'}).then(x=>x,()=>null);
  if(protectedRef)throw Error('unbound imported tape unexpectedly allowed a run-bound protection');
  const deleted=digests.slice(0,5);
  for(const digest of deleted)await reopening.remove(digest);
  const restarted=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  for(const digest of deleted){if(await restarted.get(digest))throw Error('deleted record resurrected '+digest);}
  for(const digest of digests.slice(5)){if(!(await restarted.get(digest)))throw Error('retained record missing '+digest);}
  return {backend:restarted.backend,captured:digests.length,retained:digests.length-deleted.length,
   deleted:deleted.length,bytesBeforeDeletion:totalBytes,estimateBefore:before,estimateAfter:after,
   noPublicRankOrUpload:true,unboundArchiveStaysUnprotected:true};
 },expected.rows.map(r=>r.source));
 assert.equal(report.captured,expected.recordingCount);
 assert.equal(report.bytesBeforeDeletion,expected.canonicalEnvelope.sum);
 assert.equal(report.noPublicRankOrUpload,true);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({format:'bb-evidence-corpus-real-chromium',source:url,report,pageErrors:errors,
  caveats:['Historical legacy-derived fixture envelopes, not current live SIM9',
    'Storage estimate origin-wide and can include unrelated files; not proof of quota exhaustion',
    'No fake quota test: real storage pressure from 46 committed recordings only']},null,2));
 await context.close();
}finally{await browser.close();}
