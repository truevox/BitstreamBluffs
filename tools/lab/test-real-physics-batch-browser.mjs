#!/usr/bin/env node
/** Self-contained compiled real browser QA: scheduler+budget+Matter workers. */
import assert from 'node:assert/strict';
import {build} from 'vite';
import {chromium} from 'playwright';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {createServer} from 'node:http';
const root=resolve(import.meta.dirname,'../..'),dist=await mkdtemp(join(tmpdir(),'bsb134-physics-batch-'));
let browser,server;
try{
 await build({configFile:false,root,publicDir:false,
  resolve:{alias:[{find:/^phaser$/,replacement:resolve(root,'tools/lab/qa-real-physics-fake-phaser.mjs')}]},
  build:{outDir:dist,emptyOutDir:true,rollupOptions:{input:{qa:resolve(root,'tools/lab/qa-real-physics.html')}}}});
 server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://local.invalid').pathname);
  if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=resolve(dist,pathname.slice(1));
  if(!file.startsWith(dist+sep)){res.writeHead(403).end();return;}
  try{if(!(await stat(file)).isFile())throw Error('not found');
   res.writeHead(200,{'Content-Type':extname(file)==='.js'?'text/javascript':'text/html'}).end(await readFile(file));}
  catch{res.writeHead(404).end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/tools/lab/qa-real-physics.html`);
 const report=await page.evaluate(async()=>{
  const {runPhysicsEpisode,runRealPhysicsQaBatch}=window.__realPhysicsQa;
  const settings={campaignSeed:'real-physics-batch-golden',count:4,requestedSlots:2,
   authorizedSlots:2,activeWorkers:0,rideActive:false,visibility:'visible',
   hardwareConcurrency:8,deviceMemoryGiB:16};
  const parallel=await runRealPhysicsQaBatch(settings);
  const sequential=await runRealPhysicsQaBatch({...settings,authorizedSlots:1});
  const blocked=await runRealPhysicsQaBatch({...settings,rideActive:true});
  const hidden=await runRealPhysicsQaBatch({...settings,visibility:'hidden'});
  let spawned=0,terminated=0;
  const OriginalWorker=window.Worker;
  const cancellation=new AbortController();
  const slowWorkerFactory=()=>{
   spawned++;
   return {onmessage:null,onerror:null,onmessageerror:null,
    postMessage(){},terminate(){terminated++;}};
  };
  const pending=runRealPhysicsQaBatch({...settings,count:40,signal:cancellation.signal,
   workerFactory:slowWorkerFactory});
  await Promise.resolve();cancellation.abort();
  const aborted=await pending;
  const failing=await runRealPhysicsQaBatch({...settings,count:5,
   workerFactory:()=>{throw Error('worker denied');}});
  const baseline=parallel.ok?parallel.results.map(row=>runPhysicsEpisode({
   seed:row.seed,biomeMask:3,policy:'tricks',ticks:360})):[];
  return {parallel,sequential,blocked,hidden,baseline,aborted,failing,spawned,terminated};
 });
 assert.equal(report.parallel.ok,true);
 assert.equal(report.sequential.ok,true);
 assert.equal(report.parallel.results.length,4);
 assert.deepEqual(report.parallel.results,report.sequential.results);
 assert.deepEqual(report.parallel.results,report.baseline);
 assert.equal(report.sequential.budget.admissionLimit,1);
 assert.equal(report.parallel.budget.admissionLimit,2);
 assert.equal(report.blocked.code,'admission-held');
 assert.equal(report.hidden.code,'admission-held');
 assert.equal(report.aborted.code,'aborted');
 assert.equal(report.aborted.results,undefined);
 assert.equal(report.failing.code,'episode-failed');
 assert.equal(report.failing.results,undefined);
 assert.equal(report.spawned,report.terminated);
 assert.deepEqual(errors,[]);
 console.log('PASS_REAL_MATTER_GOVERNED_EPISODE_BATCH',JSON.stringify({
  ticks:report.parallel.results.map(x=>x.tick),
  fingerprints:report.parallel.results.map(x=>x.checkpoints.map(c=>c.combined)),
  sequentialLimit:report.sequential.budget.admissionLimit,
  parallelLimit:report.parallel.budget.admissionLimit}));
}finally{await browser?.close();if(server)await new Promise(done=>server.close(done));await rm(dist,{recursive:true,force:true});}
