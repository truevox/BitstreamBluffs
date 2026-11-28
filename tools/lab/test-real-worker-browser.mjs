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
   return {successes,abort,poison,unavailable,launched,terminated,workerType:'module'};
  }finally{window.Worker=OriginalWorker;}
 });
 assert.deepEqual(report.abort,{ok:false,code:'aborted'});
 assert.deepEqual(report.poison,{ok:false,code:'episode-failed'});
 assert.deepEqual(report.unavailable,{ok:false,code:'worker-unavailable'});
 assert.equal(report.launched,report.terminated,'worker cleanup leaked real workers');
 assert.equal(report.launched,1+2+4+4);
 assert.deepEqual(errors,[],'browser errors');
 console.log('PASS_COMPILED_REAL_MODULE_WORKER_EPISODES',JSON.stringify({...report,errors}));
 await ctx.close();
}finally{
 await browser?.close();
 if(server)await new Promise(done=>server.close(done));
 await rm(output,{recursive:true,force:true});
}
