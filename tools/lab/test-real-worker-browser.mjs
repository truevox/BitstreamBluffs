#!/usr/bin/env node
/** #134: compiled (not Vite-dev) real Chromium module Worker acceptance.
 * Browser worker is a deterministic transport probe, not certified SimWorld.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {build} from 'vite';
import {chromium} from 'playwright';
const root=resolve(import.meta.dirname,'../..');
const output=await mkdtemp(join(tmpdir(),'bsb134-worker-'));
let server,browser;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
try{
 await build({configFile:resolve(root,'vite.config.js'),root,
  build:{outDir:output,emptyOutDir:true,rollupOptions:{input:{qa:resolve(root,'tools/lab/worker-qa.html')}}}});
 server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local.invalid').pathname;
  const relative=decodeURIComponent(path).replace(/^\//,'');
  const file=resolve(output,relative);
  if(!relative||relative.split('/').some(p=>p==='..'||p==='.')){res.writeHead(403).end();return;}
  if(!file.startsWith(output+sep)){res.writeHead(403).end();return;}
  try{if(!(await stat(file)).isFile())throw Error('missing');
   res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream',
    'Cache-Control':'no-store'}).end(await readFile(file));}
  catch{res.writeHead(404).end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
  headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'block'});
 const page=await ctx.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
 const origin=`http://127.0.0.1:${server.address().port}`;
 await page.goto(origin+'/tools/lab/worker-qa.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!window.__labWorkerQa,{timeout:15000});
 const report=await page.evaluate(async()=>{
  const run=window.__labWorkerQa.runBrowserWorkerBatch;
  const expected=[1430,1374,1255,1700,1482,1714,1525,1449,
   1500,1595,1344,1526,1383,1533,1172,1617];
  let launched=0,terminated=0;
  const OriginalWorker=window.Worker;
  window.Worker=class extends OriginalWorker{
   constructor(url,options){super(url,options);launched++;}
   terminate(){terminated++;return super.terminate();}
  };
  try{
   const successes=[];
   for(const concurrency of [1,2,4]){
    const start=performance.now();
    const r=await run({campaignSeed:'training-golden-v1',count:16,concurrency});
    if(!r.ok)throw Error('Real Worker batch rejected '+JSON.stringify(r));
    if(JSON.stringify(r.results.map(x=>x.score))!==JSON.stringify(expected))
     throw Error('Worker results violate golden seeded vector');
    if(r.results.some((x,i)=>x.index!==i||!Number.isSafeInteger(x.seed)))
     throw Error('Worker episode identity/index mismatch');
    successes.push({concurrency,elapsedMs:Math.round(performance.now()-start),
     scores:r.results.map(x=>x.score)});
   }
   // Abort after actual workers are instantiated. No partial trainable results.
   const controller=new AbortController();
   const pending=run({campaignSeed:'abort-worker',count:100,concurrency:4,signal:controller.signal});
   controller.abort();
   const abort=await pending;
   // A corrupted/forged reply cannot be accepted as a training result.
   const poisonCode='self.onmessage=e=>self.postMessage({kind:"lab-result",id:e.data.id,index:e.data.index,seed:0,score:90000})';
   const url=URL.createObjectURL(new Blob([poisonCode],{type:'text/javascript'}));
   const poison=await run({campaignSeed:'bad-worker',count:4,concurrency:2,
    workerFactory:()=>new OriginalWorker(url)});
   URL.revokeObjectURL(url);
   const unavailable=await run({campaignSeed:'unavailable',count:1,concurrency:1,
    workerFactory:()=>{throw Error('worker denied');}});
   // #453: admission governor now guards ACTUAL browser Worker startup, not
   // merely a separately unit-tested numerical policy.
   const governed=window.__labWorkerQa.runGovernedBrowserWorkerBatch;
   const signals={navigatorRef:{hardwareConcurrency:8,deviceMemory:16},documentRef:document};
   const request={campaignSeed:'training-golden-v1',count:16,
    authorizedSlots:1,requestedSlots:4,activeWorkers:0,rideActive:false,...signals};
   const before=launched;
   const limited=await governed(request);
   if(!limited.ok||limited.budget.admissionLimit!==1||
    limited.budget.startsAvailable!==1||launched!==before+1||
    JSON.stringify(limited.results.map(r=>r.score))!==JSON.stringify(expected))
    throw Error('Governor bypassed one authorized own-site Sim-Slot or violated golden vector');
   const limitedWorkers=launched-before;
   const beforeDenied=launched;
   const rideHeld=await governed({...request,rideActive:true});
   const hiddenHeld=await governed({...request,documentRef:{visibilityState:'hidden'}});
   const occupiedHeld=await governed({...request,activeWorkers:1});
   if([rideHeld,hiddenHeld,occupiedHeld].some(x=>x.ok||x.code!=='admission-held')||launched!==beforeDenied)
    throw Error('Governor admitted workers while riding/hidden/fully occupied');
   const launchedBeforeRide=launched;
   const waitForStart=async(beforeCount)=>{
    for(let i=0;i<80&&launched<=beforeCount;i++)
     await new Promise(done=>setTimeout(done,5));
    if(launched<=beforeCount)throw Error('Expected actual Worker startup before cancellation');
   };
   const rideStart=new AbortController();
   const pendingRide=governed({...request,count:10000,rideStartSignal:rideStart.signal});
   await waitForStart(launchedBeforeRide);
   rideStart.abort();
   const rideAbort=await pendingRide;
   if(rideAbort.ok||rideAbort.code!=='aborted')throw Error('Ride start did not stop active Worker batch');
   const listeners=new Set();
   const controlledDoc={visibilityState:'visible',
    addEventListener:(name,fn)=>{if(name==='visibilitychange')listeners.add(fn);},
    removeEventListener:(name,fn)=>{if(name==='visibilitychange')listeners.delete(fn);}};
   const beforeHide=launched;
   const pendingHidden=governed({...request,count:10000,documentRef:controlledDoc});
   await waitForStart(beforeHide);
   controlledDoc.visibilityState='hidden';
   for(const listener of [...listeners])listener(); // synthetic browser event
   const hiddenAbort=await pendingHidden;
   if(hiddenAbort.ok||hiddenAbort.code!=='aborted')
    throw Error('Visibility change did not stop active Worker batch');
   if(listeners.size!==0)throw Error('Governed worker leaked visibility listeners');
   // Concurrent requests share one per-tab reservation, not two claims to
   // the same slot. The first run is deliberately long and then cancelled.
   const overlapAbort=new AbortController();
   const overlap=governed({...request,count:10000,signal:overlapAbort.signal});
   await Promise.resolve();
   const deniedOverlap=await governed({...request,count:1});
   if(deniedOverlap.ok||deniedOverlap.code!=='admission-held')
    throw Error('Concurrent batch double-spent an authorized Sim-Slot');
   overlapAbort.abort();
   const cancelledOverlap=await overlap;
   if(cancelledOverlap.ok||cancelledOverlap.code!=='aborted')
    throw Error('Concurrent batch cancellation did not release reservation');
   // A reservation must be available again after cancellation.
   const afterCancel=await governed({...request,count:1});
   if(!afterCancel.ok||afterCancel.results.length!==1)
    throw Error('Cancelled reservation was not restored');
   return {successes,abort,poison,unavailable,governor:{
    limitedWorkers,limit:limited.budget.admissionLimit,
    rideHeld:rideHeld.code,hiddenHeld:hiddenHeld.code,occupiedHeld:occupiedHeld.code,
    rideAbort:rideAbort.code,hiddenAbort:hiddenAbort.code,overlapDenied:deniedOverlap.code,
    overlapAbort:cancelledOverlap.code,reusedAfterCancellation:afterCancel.ok},
    launched,terminated,workerType:'module'};
  }finally{window.Worker=OriginalWorker;}
 });
 assert.deepEqual(report.abort,{ok:false,code:'aborted'});
 assert.deepEqual(report.poison,{ok:false,code:'episode-failed'});
 assert.deepEqual(report.unavailable,{ok:false,code:'worker-unavailable'});
 assert.equal(report.launched,report.terminated,'worker cleanup leaked real workers');
 assert.ok(report.launched>=1+2+4+4+1);
 assert.deepEqual(errors,[],'browser errors');
 console.log('PASS_COMPILED_REAL_MODULE_WORKER_EPISODES',JSON.stringify({...report,errors}));
 await ctx.close();
}finally{
 await browser?.close();
 if(server)await new Promise(done=>server.close(done));
 await rm(output,{recursive:true,force:true});
}
