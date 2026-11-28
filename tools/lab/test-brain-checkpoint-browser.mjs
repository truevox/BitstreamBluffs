/** #451 actual ephemeral Chromium IndexedDB and quota/eviction acceptance.
 * No training, import admission, user profile, or public gameplay authority.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {chromium} from 'playwright';
const root=resolve(process.cwd());
const errors=[];let browser,server;
const payload=(gen=2)=>JSON.stringify({format:'bb-lab-checkpoint',version:1,
 simRevision:9,modelAbi:'test-draft-abi',generation:gen,
 brain:{weights:[0.3,-0.2]},optimizer:{step:gen,momentum:[0.5]},
 queue:[{episode:gen}],rng:{seed:'lab-1',state:[1,2,3]}});
try{
 server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://test.invalid').pathname;
  const file=resolve(root,'.'+path);
  if(!file.startsWith(root+sep)||!file.endsWith('.js')){res.writeHead(403).end();return;}
  try{res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(await readFile(file));}
  catch{res.writeHead(404).end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
  args:['--no-sandbox'],headless:true});
 const ctx=await browser.newContext();
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(origin+'/src/systems/brain/localBrainCheckpoints.js');
 // Browser actually runs the ES module against its own origin's native IDB.
 const original=await p.evaluate(async json=>{
  const {LocalBrainCheckpoints}=await import('/src/systems/brain/localBrainCheckpoints.js');
  const db=new LocalBrainCheckpoints({storage:{persisted:async()=>false,persist:async()=>false}});
  return {saved:await db.save(json),loaded:await db.read(),exported:await db.export()};
 },payload());
 assert(original.saved.ok&&original.saved.durability==='best-effort',JSON.stringify(original.saved));
 assert(original.loaded.ok&&original.loaded.generation===2);
 assert.deepEqual(new TextDecoder().decode(original.exported.bytes),payload());
 // Reload new page/context and verify actual browser durable transaction.
 await p.reload({waitUntil:'domcontentloaded'});
 const reloaded=await p.evaluate(async()=>{
  const {LocalBrainCheckpoints}=await import('/src/systems/brain/localBrainCheckpoints.js');
  const s=new LocalBrainCheckpoints();const r=await s.read();
  return {ok:r.ok,generation:r.generation,rng:r.ok?JSON.parse(new TextDecoder().decode(r.bytes)).rng:null};
 });
 assert(reloaded.ok&&reloaded.generation===2&&reloaded.rng.state[2]===3,'reload lost atomic checkpoint');
 const protections=await p.evaluate(async ([next,wrong])=>{
  const {LocalBrainCheckpoints}=await import('/src/systems/brain/localBrainCheckpoints.js');
  const s=new LocalBrainCheckpoints();
  const stale=await s.save(next),abi=await s.save(wrong);
  const imported=await s.importForReview(next);
  const held=await s.read(),q=await s.readQuarantine();
  return {stale,abi,imported,held:held.ok?held.generation:null,quarantine:q.ok?q.generation:null};
 },[payload(1),JSON.stringify({...JSON.parse(payload(4)),modelAbi:'different-model'})]);
 assert.equal(protections.stale.code,'stale-generation');
 assert.equal(protections.abi.code,'model-abi-mismatch');
 assert(protections.imported.ok&&protections.quarantine===1&&protections.held===2,
  'quarantine was admitted or existing learned weights overwritten');
 // Corrupt the quarantined record using a native IDB transaction: never
 // surface corrupt bytes as an admitted checkpoint. Active remains untouched.
 const corrupted=await p.evaluate(async()=>{
  const req=indexedDB.open('bb-lab-checkpoint-v1',1);
  await new Promise((ok,no)=>{req.onsuccess=ok;req.onerror=()=>no(req.error);});
  const db=req.result,tx=db.transaction('checkpoints','readwrite');
  const store=tx.objectStore('checkpoints'),get=store.get('quarantine');
  get.onsuccess=()=>{const row=get.result;row.bytes[0]^=0xff;store.put(row);};
  await new Promise((ok,no)=>{tx.oncomplete=ok;tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error);});
  db.close();
  const {LocalBrainCheckpoints}=await import('/src/systems/brain/localBrainCheckpoints.js');
  const check=new LocalBrainCheckpoints();
  return {corrupt:await check.readQuarantine(),active:await check.read()};
 });
 assert.equal(corrupted.corrupt.code,'integrity-mismatch');
 assert(corrupted.active.ok&&corrupted.active.generation===2,
  'quarantine corruption spread to active checkpoint');
 // Native Chromium disk-quota refusal. Keep an exportable memory snapshot.
 const cdp=await ctx.newCDPSession(p);
 const usage=await cdp.send('Storage.getUsageAndQuota',{origin});
 assert(Number.isFinite(usage.usage));
 await cdp.send('Storage.overrideQuotaForOrigin',{origin,quotaSize:1});
 const under=await cdp.send('Storage.getUsageAndQuota',{origin});
 assert(under.overrideActive===true,'quota override refused');
 const quota=await p.evaluate(async next=>{
  const {LocalBrainCheckpoints}=await import('/src/systems/brain/localBrainCheckpoints.js');
  const s=new LocalBrainCheckpoints({storage:{persist:async()=>false}});
  const r=await s.save(next),backup=await s.export({pending:true}),unchanged=await s.read();
  return {result:r,backup:backup.ok?JSON.parse(new TextDecoder().decode(backup.bytes)):null,
   unchanged:unchanged.ok?unchanged.generation:null};
 },JSON.stringify({...JSON.parse(payload(3)),brain:{weights:Array.from({length:60000},(_,i)=>i/100)}}));
 // Some Chromium revisions do not enforce the CDP quota override on an
 // already-open IDB origin. Never invent quota failure: accept either native
 // refusal with an intact original, or a genuinely successful best-effort
 // transaction, and REPORT which path this browser took.
 const quotaEnforced=quota.result.code==='quota-exceeded';
 if(quotaEnforced){
  assert(quota.result.durability==='memory-only'&&quota.backup.generation===3&&
   quota.unchanged===2,'native quota denial lost previous or pending state');
 }else{
  assert(quota.result.ok&&quota.result.durability!=='persistent-storage'&&
   quota.unchanged===3,'native quota was not enforced but save falsely claimed durability');
 }
 await cdp.send('Storage.overrideQuotaForOrigin',{origin});
 // Explicit browser-managed IndexedDB-only clearing, NOT actual OS pressure.
 await cdp.send('Storage.clearDataForOrigin',{origin,storageTypes:'indexeddb'});
 await p.reload({waitUntil:'domcontentloaded'});
 const vanished=await p.evaluate(async()=>{
  const {LocalBrainCheckpoints}=await import('/src/systems/brain/localBrainCheckpoints.js');
  return (await new LocalBrainCheckpoints().read());
 });
 assert.equal(vanished.code,'checkpoint-missing-after-save','loss was presented as never-saved');
 assert.deepEqual(errors,[]);
 console.log('PASS_LAB_CHECKPOINT_CHROMIUM',JSON.stringify({saved:{durability:original.saved.durability,
  bytes:original.saved.bytes},reloaded,protections,quarantinedCorruption:corrupted.corrupt.code,quota:{overrideActive:under.overrideActive,configuredBytes:under.quota,
  enforced:quotaEnforced,code:quota.result.code,pendingExport:quotaEnforced,
  previousGeneration:quota.unchanged},evicted:{code:vanished.code},
  caveat:'CDP quota override may not enforce writes on this Chromium; IDB clearing simulates partition loss, not real OS pressure.',errors}));
 await ctx.close();
}finally{
 await browser?.close();
 if(server)await new Promise(done=>server.close(done));
}
