/** Real Phaser/Matter recorder continuity on a stock run. The prefix is
 * reproduced by the real engine in B; this is NOT a full-world restore.
 * Source Vite server gives the game and adapter the same native class.
 */
import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
let vite,browser;
const errors=[];
try{
 vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true}});
 await vite.listen();
 const url='http://127.0.0.1:'+vite.httpServer.address().port+'/';
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 async function boot(ms){
  const context=await browser.newContext({viewport:{width:960,height:540}});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date(ms));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
   typeof window.__bbGame.registry.get('currentBuildId')==='string',null,{timeout:60000});
  await page.evaluate(async()=>{
   const api=await import('/src/systems/savestate/recorderState.js');
   const {captureCausalState}=await import('/src/systems/replay/fingerprintCapture.js');
   const {fingerprintState}=await import('/src/systems/replay/fingerprint.js');
   const g=window.__bbGame,r=g.scene.getScene('RunScene');
   g.loop.sleep();g.scene.getScene('TitleScene').startRun('sim-05@0');
   g.scene.stop('TitleScene');g.scene.start('RunScene');g.headlessStep(0,0);
   if(!r.sys.isActive()||r.simClock.tick!==0||!r.ghostRecorder||r.tapePlayer||r.unrankedPractice||
      r.appliedBoosts.length||r.upgradeRun.enabled||r.magnetsDrop||r.kodiaksOn)
    throw Error('not genuine stock tick-zero recording');
   r.inputRouter.poll=()=>({push:false,tilt:0,heli:0,tuck:false,hop:false,pressed:{}});
   const ctx=()=>({runId:r.runId,tick:r.simClock.tick,buildId:g.registry.get('currentBuildId'),
    rulesetId:r.ghostRecorder.header.rulesetId,simRevision:r.ghostRecorder.header.simRevision});
   window.__nativeProof={g,r,api,ctx,t:0,fp:()=>fingerprintState(captureCausalState(r)).combined,
    stepTo(n){while(r.simClock.tick<n&&!r.crashed){this.t+=1000/120;g.headlessStep(this.t,1000/120);}return r.simClock.tick;}};
  });
  return page;
 }
 const time=Date.UTC(2026,0,5,12),a=await boot(time),b=await boot(time+1000);
 const cap=await a.evaluate(()=>{
  const p=window.__nativeProof; if(p.stepTo(481)!==481||p.r.crashed)throw Error('unexpected source terminal');
  const ctx=p.ctx(),data=p.api.captureRecorderState(p.r.ghostRecorder,ctx);
  return {ctx,bytes:Array.from(data),fp:p.fp(),startedAt:p.r.startedAt};
 });
 const prepared=await b.evaluate(cap=>{
  const p=window.__nativeProof,fresh=p.r.ghostRecorder,originalRun=p.r.runId;
  const restored=p.api.restoreRecorderState(new Uint8Array(cap.bytes),fresh,cap.ctx);
  if(fresh.lastTick!==0||restored===fresh||originalRun===cap.ctx.runId)throw Error('fresh target not detached');
  if(p.stepTo(481)!==481||p.r.crashed||p.fp()!==cap.fp)throw Error('fresh replay failed at prefix');
  p.r.ghostRecorder=restored;p.r.startedAt=cap.startedAt;p.r.runId=cap.ctx.runId;
  const bytes=p.api.captureRecorderState(p.r.ghostRecorder,p.ctx());
  return {sameBytes:bytes.length===cap.bytes.length&&bytes.every((x,i)=>x===cap.bytes[i]),tick:p.r.simClock.tick};
 },cap);
 assert.deepEqual(prepared,{sameBytes:true,tick:481});
 // Preserve original run identity and end wall-clock metadata. Both runs
 // now execute their own actual normal fatal result, not a synthetic finish.
 await b.clock.setFixedTime(new Date(time));
 const terminal=page=>page.evaluate(()=>{
  const p=window.__nativeProof,rec=p.r.ghostRecorder;
  p.stepTo(2500);
  if(!p.r.crashed)throw Error('stock fixture did not reach native fatal tick');
  const record=p.g.registry.get('lastRecord'),tape=p.g.registry.get('lastGhostTape');
  if(!record||!tape||record.id!==p.r.runId||tape.runId!==p.r.runId)throw Error('native terminal result missing');
  return {tick:p.r.simClock.tick,record,tape,fp:p.fp(),fingerprints:rec.fingerprints,
   fingerprintErrors:rec.fingerprintErrorCount};
 });
 const left=await terminal(a),right=await terminal(b);
 assert.deepEqual(right,left);
 assert.equal(left.fingerprintErrors,0);
 assert.ok(left.fingerprints.length>=4);
 assert.deepEqual(errors,[]);
 console.log('PASS_NATIVE_RECORDER_BROWSER',JSON.stringify({captureTick:481,terminalTick:left.tick,
  tapeEndTick:left.tape.endTick,checkpoints:left.fingerprints.length,score:left.record.score,
  exactNativeTape:true,exactNativeRecord:true,exactTerminalFingerprint:true,bytes:cap.bytes.length,errors}));
}finally{await browser?.close();await vite?.close();}
