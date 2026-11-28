#!/usr/bin/env node
/** Build a QA-only RunScene/Matter image using a Phaser presentation shell
 * alias, then run the SAME code in main thread and a real Chromium Worker.
 * Production Phaser and game bundle are not changed by this build.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {build} from 'vite';
import {chromium} from 'playwright';
import {PHYSICS_QA_CASES} from './qa-real-physics-policy.mjs';
const root=resolve(import.meta.dirname,'../..'),dist=await mkdtemp(join(tmpdir(),'bsb122-realphysics-'));
let server,browser;
try{
 await build({configFile:false,root,publicDir:false,
  resolve:{alias:[{find:/^phaser$/,replacement:resolve(root,'tools/lab/qa-real-physics-fake-phaser.mjs')}]},
  build:{outDir:dist,emptyOutDir:true,rollupOptions:{input:{qa:resolve(root,'tools/lab/qa-real-physics.html')}}}});
 server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://local.invalid').pathname),rel=pathname.slice(1);
  if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=resolve(dist,rel);
  if(!rel||!file.startsWith(dist+sep)){res.writeHead(403).end();return;}
  try{if(!(await stat(file)).isFile())throw Error('missing');
   res.writeHead(200,{'Content-Type':extname(file)==='.js'?'text/javascript':'text/html',
    'Cache-Control':'no-store'}).end(await readFile(file));}
  catch{res.writeHead(404).end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
  headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[];
 page.on('pageerror',error=>errors.push(error.stack||error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/tools/lab/qa-real-physics.html`,
  {waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!window.__realPhysicsQa&&!!window.__physicsThroughputQa,{timeout:15000});
 const cases=PHYSICS_QA_CASES;
 const golden=JSON.parse(await readFile(resolve(root,'tools/lab/qa-real-physics-golden.json'),'utf8'));
 const reports=await page.evaluate(async cases=>{
  const results=[];
  const send=(spec,id)=>{
   const worker=window.__realPhysicsQa.spawn();
   return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('worker timed out')),30000);
    worker.onmessage=e=>{clearTimeout(timeout);resolve(e.data);};
    worker.onerror=e=>{clearTimeout(timeout);reject(Error('worker error: '+e.message));};
    worker.postMessage({kind:'run-physics-qa',id,spec});
   }).finally(()=>worker.terminate());
  };
  for(const spec of cases){
   const main=window.__realPhysicsQa.runPhysicsEpisode(spec);
   const got=await send(spec,7);
   results.push({spec,main,worker:got});
  }
  // Every new Worker recreates independent physics state; no hidden runId,
  // current date or previous episode may contaminate a fixed seed.
  const repeated=await send(cases[0],8);
  if(repeated.kind!=='physics-qa-result'||
   JSON.stringify(repeated.result)!==JSON.stringify(results[0].main))
   throw Error('Repeated Worker run drifted from fixed-seed real physics');
  const refused=await send({...cases[0],ticks:36001},9);
  if(refused.kind!=='physics-qa-error'||refused.id!==9||
   !refused.error.includes('Invalid real physics QA episode'))
   throw Error('Invalid oversized physics request not rejected');
  return results;
 },cases);
 for(const r of reports){
  assert.equal(r.worker.kind,'physics-qa-result',r.worker.error);
  assert.deepEqual(r.worker.result,r.main,'worker/main physics evidence mismatch');
  assert.ok(r.main.checkpoints.length>=2);
  assert.deepEqual({seed:r.main.seed,tick:r.main.tick,crashed:r.main.crashed,
   score:r.main.score,checkpoints:r.main.checkpoints.map(x=>[x.tick,x.combined])},
   golden.find(g=>g.seed===r.spec.seed),'compiled Chromium deviated from pinned golden');
 }
 // Real-world throughput diagnostics, NOT a device entitlement grant or
 // physical low-end Chromebook QA. Each lane starts an actual Worker running
 // the exact same previously golden-validated RunScene/Matter physics.
 const measured=await page.evaluate(async({cases,expected})=>{
  const qa=window.__realPhysicsQa;
  return window.__physicsThroughputQa({
   spawn:qa.spawn,cases,expected,workerCountLevels:[1,2,4]});
 },{cases,expected:reports.map(x=>x.main)});
 assert.deepEqual(measured.results.map(x=>x.lanes),[1,2,4]);
 assert.equal(measured.baseWebAuthorizedSimSlots,1);
 for(const metric of measured.results){
  assert.equal(metric.jobs,cases.length*4);
  assert.equal(metric.workersStarted,metric.lanes);
  assert.equal(metric.workerTerminationRequests,metric.lanes);
  assert.equal(metric.peakActiveTasks,metric.lanes);
  assert.equal(metric.actualTicks,4*reports.reduce((s,r)=>s+r.main.tick,0));
  assert(metric.throughputTicksPerWallSec>0&&metric.elapsedMs>0);
  assert.equal(metric.memoryMiB,null);
  assert.equal(metric.thermalC,null);
 }
 assert.deepEqual(errors,[],'browser errors');
 console.log('PASS_REAL_RUNSCENE_WORKER_THROUGHPUT_QA',JSON.stringify({
  browserHints:await page.evaluate(()=>({hardwareConcurrency:navigator.hardwareConcurrency??null,
   deviceMemoryGiB:navigator.deviceMemory??null,visibility:document.visibilityState})),
  ...measured}));
 console.log('PASS_REAL_RUNSCENE_MATTER_MAIN_VS_WORKER',JSON.stringify(reports.map(r=>({
  seed:r.spec.seed,tick:r.main.tick,crashed:r.main.crashed,score:r.main.score,
  checkpoints:r.main.checkpoints.map(x=>[x.tick,x.combined])}))));
}finally{await browser?.close();if(server)await new Promise(done=>server.close(done));
 await rm(dist,{recursive:true,force:true});}
