/** Local-only #244 QA: fresh CURRENT-build live RunScene envelopes from Jest,
 * then real Chromium IDB byte admission/reopen/role protection/delete/fail-closed.
 * Generated test data is never uploaded; non-natural cutoffs are marked in input.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const file=process.env.BSB244_FRESH_CORPUS_OUT;
const url=process.env.GAME_URL;
if(!file||!url)throw Error('BSB244_FRESH_CORPUS_OUT + GAME_URL required');
const {rows,rulesetId}=JSON.parse(fs.readFileSync(file,'utf8'));
assert.equal(rows.length,12);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[],mutating=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))mutating.push(r.method());});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 const report=await page.evaluate(async({rows,rulesetId})=>{
  const [{EvidenceStore},{validateEvidenceBundle},{digestOfBytes},{loadCurrentRuleset}]=await Promise.all([
   import('/src/systems/replay/evidenceStore.js'),import('/src/systems/replay/manifest.js'),
   import('/src/systems/replay/canonicalSha256.js'),import('/src/systems/replay/runtimeRuleset.js')]);
  const servedRuleset=await loadCurrentRuleset();
  if(servedRuleset.rulesetId!==rulesetId)throw Error('browser served a different current ruleset');
  const bytesOf=base64=>Uint8Array.from(atob(base64),x=>x.charCodeAt(0));
  const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  if(store.backend!=='idb')throw Error('IDB unavailable');
  store.rulesetResolver=id=>id===servedRuleset.rulesetId?servedRuleset.doc:null;
  const synthetic=rows[6];const test=store;
  // We cannot simulate true site-quota exhaustion; this is an explicit
  // fault injection to assert fail-closed memory-only + explicit retry.
  const original=test._writeDurable;
  const bytes=bytesOf(synthetic.base64);
  const syntheticDigest=synthetic.digest;
  test._writeDurable=async(_record,_bytes,receipt)=>{
   if(receipt)receipt.classification='new';
   throw Object.assign(new Error('simulated quota'),{name:'QuotaExceededError'});
  };
  let quotaCode='';
  try{await test.put(bytes,{runId:synthetic.runId});}catch(e){quotaCode=e.code;}
  test._writeDurable=original;
  const wasPending=test.pending.has(syntheticDigest);
  const notDurable=!(await test.isBundleDurable(syntheticDigest,{runId:synthetic.runId}));
  const exportBytes=await test.exportBundle(syntheticDigest);
  const retry=await test.retryPending({digest:syntheticDigest});
  const nowDurable=await test.isBundleDurable(syntheticDigest,{runId:synthetic.runId});

  const last=[];
  for(const row of rows){
   const bytes=bytesOf(row.base64);
   const checked=validateEvidenceBundle(bytes,store.rulesetResolver);
   if(!checked.ok||checked.bundleDigest!==row.digest||digestOfBytes(bytes)!==row.digest)
    throw Error('fresh bundle admission mismatch '+row.seed);
   const result=await store.put(bytes,{runId:row.runId});
   if(result!==row.digest||!(await store.isBundleDurable(result,{runId:row.runId})))
    throw Error('not durable '+row.seed);
   last.push(result);
  }
  const protectedRefs=[];
  for(let i=0;i<2;i++)protectedRefs.push(await store.protect(last[i],{runId:rows[i].runId,role:'pinned'}));
  // Close the original connection: this must prove a genuinely fresh open,
  // not merely a second live handle reading the same running database.
  const firstDb=store._db;firstDb.close();
  const resumed=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  if(resumed._db===firstDb)throw Error('IDB was not reopened from a closed handle');
  for(let i=0;i<rows.length;i++){
   const saved=await resumed.get(last[i]),source=bytesOf(rows[i].base64);
   if(!saved||saved.length!==source.length||!saved.every((b,k)=>b===source[k]))
    throw Error('reopened bytes differ '+rows[i].seed);
  }
  let blockedCode='';
  try{await resumed.remove(last[0]);}catch(e){blockedCode=e.code;}
  if(blockedCode!=='protected-evidence')throw Error('protected delete permitted '+blockedCode);
  for(let i=2;i<6;i++)await resumed.remove(last[i]);
  const secondDb=resumed._db;secondDb.close();
  const reopened=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  if(reopened._db===secondDb)throw Error('second reopen used prior closed handle');
  for(let i=0;i<rows.length;i++){
   const saved=await reopened.get(last[i]);
   if((i>=2&&i<6)===Boolean(saved))throw Error('retention mismatch '+rows[i].seed);
  }
  if(quotaCode!=='quota-exceeded'||!wasPending||!notDurable||exportBytes.bytes.length!==bytes.length||
     retry.remaining!==0||!nowDurable)throw Error('quota fault did not fail closed/recover '+JSON.stringify({quotaCode,wasPending,notDurable,retry,nowDurable}));
  return {freshCurrentCaptureCount:rows.length,totalCanonicalBytes:rows.reduce((n,r)=>n+r.bytes,0),
   rulesetId,protectedCount:protectedRefs.length,blockedCode,removed:4,
   retainedBeforeFault:rows.length-4,quotaSimulation:{quotaCode,wasPending,notDurable,recovered:nowDurable},
   observedEndTicks:rows.map(r=>r.ticks),upgraded:rows.filter(r=>r.upgraded).length,
   bsodForced:rows.filter(r=>!r.naturalCrash&&r.terminalCause==='bsod').length,naturalCrashes:rows.filter(r=>r.naturalCrash).length,forcedBsodTerminals:rows.filter(r=>!r.naturalCrash).length};
 },{rows,rulesetId});
 assert.equal(report.freshCurrentCaptureCount,12);
 assert.equal(errors.length,0);
 assert.equal(mutating.length,0);
 console.log('FRESH_CURRENT_BROWSER_PASS',JSON.stringify({report,errors,mutating,
  caveat:'Runs use automated inputs in native RunScene; natural and QA-induced terminal counts are in report. Injected quota is NOT measured physical-device storage exhaustion or human-play evidence.'}));
 await context.close();
}finally{await browser.close();}
