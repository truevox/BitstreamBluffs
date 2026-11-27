/** #424 real compiled Pages PWA: native IDB quota exhaustion and browser
 * origin-IDB eviction, without fabricated/corrupted savestate wire.
 * Ephemeral Chromium contexts only; never user profile or telemetry.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';

const root=resolve(process.argv[2]||'dist');
assert((await stat(resolve(root,'sw.js'))).isFile(),'real compiled offline PWA required');
const errors=[],outbound=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
 '.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2',
 '.webmanifest':'application/manifest+json','.bin':'application/octet-stream'};
let server,browser;
const slot=async p=>p.evaluate(async()=>{
 const request=indexedDB.open('bb-single-use-suspend-v1',1);
 return new Promise((done,fail)=>{
  request.onsuccess=()=>{
   const db=request.result,tx=db.transaction('slots','readonly'),get=tx.objectStore('slots').get('local-suspend');
   get.onsuccess=()=>{const r=get.result;db.close();done(r?{status:r.status,runId:r.runId,tick:r.tick,bytes:r.bytes?.length}:null);};
   get.onerror=()=>{db.close();fail(get.error);};
  };
  request.onerror=()=>fail(request.error);
 });
});
const watch=p=>p.on('pageerror',err=>errors.push(err.message));
const pointer=p=>p.evaluate(()=>{
 const g=window.__bbGame,pause=g.scene.getScene('PauseScene'),i=pause.menu.items.findIndex(row=>row.label==='SUSPEND RUN');
 if(i<0||!pause.canSuspend)throw Error('real Pause suspend menu unavailable');
 const z=pause.menu.rows[i].zone,xy=z.getWorldTransformMatrix().transformPoint(z.width/2,z.height/2);
 const rect=g.canvas.getBoundingClientRect();
 return {x:rect.x+xy.x*rect.width/g.scale.gameSize.width,
  y:rect.y+xy.y*rect.height/g.scale.gameSize.height};
});
async function install(ctx,origin){
 const p=await ctx.newPage();watch(p);
 await p.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:60000});
 await p.evaluate(()=>navigator.serviceWorker.ready);
 await p.reload({waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&navigator.serviceWorker.controller,null,{timeout:30000});
 const state=await p.evaluate(async()=>({
  controller:!!navigator.serviceWorker.controller,
  shells:(await caches.keys()).filter(k=>k.startsWith('bitstream-shell-v1-')).length,
 }));
 assert(state.controller&&state.shells>=1,'not installed service-worker shell');
 return p;
}
async function prepare(p,seed){
 await p.evaluate(s=>window.__bbGame.scene.getScene('TitleScene').startRun(s),seed);
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('RunScene')&&
  window.__bbGame.scene.getScene('RunScene').simClock?.tick>=180,null,{timeout:80000});
 await p.evaluate(()=>window.__bbGame.scene.getScene('RunScene').pauseRun());
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('PauseScene')&&
  window.__bbGame.scene.getScene('PauseScene').canSuspend===true,null,{timeout:18000});
 await p.waitForTimeout(550);
 return p.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');
  return {runId:r.runId,tick:r.simClock.tick};
 });
}
try{
 server=createServer(async(req,res)=>{
  const rel=new URL(req.url,'http://local.invalid').pathname.slice(1)||'index.html',file=resolve(root,rel);
  if(!rel||rel.split('/').some(v=>!v||v==='.'||v==='..')||!file.startsWith(root+sep)){
   res.writeHead(403).end();return;
  }
  try{
   if(!(await stat(file)).isFile())throw Error('missing');
   res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(await readFile(file));
  }catch{res.writeHead(404).end();}
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
  headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const newContext=async()=>{
  const ctx=await browser.newContext({serviceWorkers:'allow',viewport:{width:960,height:540}});
  await ctx.route('**/*',route=>{
   if(route.request().url().startsWith(origin+'/'))return route.continue();
   outbound.push(route.request().method()+':'+route.request().url());
   return route.abort();
  });
  return ctx;
 };
 // A: a GENUINE browser quota failure during a compiled stock Suspend.
 const quotaContext=await newContext(),qp=await install(quotaContext,origin);
 const cdp=await quotaContext.newCDPSession(qp);
 const before=await cdp.send('Storage.getUsageAndQuota',{origin});
 assert(Number.isSafeInteger(before.usage)&&before.usage>0,'CDP quota usage not available');
 const quotaSize=before.usage+32768;
 await cdp.send('Storage.overrideQuotaForOrigin',{origin,quotaSize});
 const under=await cdp.send('Storage.getUsageAndQuota',{origin});
 assert(under.overrideActive===true&&under.quota===quotaSize,'real CDP quota override not active');
 const source=await prepare(qp,'compiled-real-quota');
 const hit=await pointer(qp);
 await qp.mouse.click(hit.x,hit.y);
 await qp.waitForFunction(()=>{
  const g=window.__bbGame,p=g.scene.getScene('PauseScene');
  return g.scene.isActive('PauseScene')&&
   p.suspendStatus?.main?.text?.startsWith('SUSPEND FAILED');
 },null,{timeout:25000});
 const refused=await qp.evaluate(()=>{
  const g=window.__bbGame,p=g.scene.getScene('PauseScene'),r=g.scene.getScene('RunScene');
  return {status:p.suspendStatus?.main?.text,leaving:p.leaving,
   paused:g.scene.isPaused('RunScene'),runId:r.runId,tick:r.simClock.tick};
 });
 assert.equal(await slot(qp),null,'failed quota write had phantom READY save');
 assert(refused.status.includes('QUOTA')&&!refused.leaving&&refused.paused&&
  refused.runId===source.runId&&refused.tick===source.tick,
  'quota failure did not preserve original paused source '+JSON.stringify({before,under,refused}));
 // Explicit retry AFTER removing quota, never silently resume a failed save.
 await cdp.send('Storage.overrideQuotaForOrigin',{origin});
 await qp.mouse.click(hit.x,hit.y);
 await qp.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene')._suspendReady===true,null,{timeout:30000});
 const retry=await slot(qp);
 assert(retry?.status==='ready'&&retry.runId===source.runId&&retry.tick===source.tick,
  'failed quota retry not durable after removal');
 await quotaContext.close();

 // B: Chrome itself evicts ONLY the IndexedDB partition. Offline cached
 // shell must remain usable, UI must never claim a vanished save is resumable.
 const evictContext=await newContext(),ep=await install(evictContext,origin);
 const erun=await prepare(ep,'compiled-idb-eviction');
 const epoint=await pointer(ep);
 await ep.mouse.click(epoint.x,epoint.y);
 await ep.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene')._suspendReady===true,null,{timeout:30000});
 const saved=await slot(ep);
 assert(saved?.status==='ready'&&saved.tick===erun.tick,'eviction setup genuine save missing');
 const ec=await evictContext.newCDPSession(ep);
 const cachesBefore=await ep.evaluate(()=>caches.keys());
 await ec.send('Storage.clearDataForOrigin',{origin,storageTypes:'indexeddb'});
 await ep.close();
 await evictContext.setOffline(true);
 const cold=await evictContext.newPage();watch(cold);
 await cold.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await cold.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene')._suspendStatus==='empty'&&
  navigator.serviceWorker.controller,null,{timeout:30000});
 const after=await cold.evaluate(async()=>{
  const t=window.__bbGame.scene.getScene('TitleScene');
  return {status:t._suspendStatus,ready:t._suspendReady,
   visible:t.suspendButton?.visible,controller:!!navigator.serviceWorker.controller,
   caches:await caches.keys()};
 });
 assert(after.ready===false&&after.visible===false&&after.controller&&
  cachesBefore.every(name=>after.caches.includes(name))&&await slot(cold)===null,
  'eviction created phantom Resume or erased shell '+JSON.stringify(after));
 await cold.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('after-idb-eviction'));
 await cold.waitForFunction(()=>window.__bbGame?.scene.isActive('RunScene')&&
  window.__bbGame.scene.getScene('RunScene').simClock?.tick>=3,null,{timeout:15000});
 assert.deepEqual(errors,[]);
 assert(!outbound.some(x=>!x.startsWith('GET:')&&!x.startsWith('HEAD:')),
  'artificial QA attempted outbound mutation');
 console.log('PASS_REAL_COMPILED_PWA_QUOTA_AND_IDB_EVICTION',JSON.stringify({
  quota:{baselineUsage:before.usage,quotaSize,original:source,refused,retry},
  eviction:{before:erun,saved,after},
  separateEphemeralChromiumContexts:true,offlineAfterEviction:true,
  noPhantomSave:true,sourcePlayabilityPreserved:true,errors,outbound,
  caveat:'Chrome-managed IDB clear simulates complete browser storage partition eviction; real OS disk-pressure eviction not forced.',
 }));
 await evictContext.close();
}finally{
 await browser?.close();
 if(server)await new Promise(done=>server.close(done));
}
