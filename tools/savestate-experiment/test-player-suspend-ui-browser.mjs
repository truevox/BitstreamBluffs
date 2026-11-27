/** #424 real stock RunScene -> PauseScene Suspend -> Title Resume -> RunScene.
 * This test MUST execute the game's own player actions; no harness direct
 * LocalSuspendSlot put/claim/restore bypass is permitted. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
let vite,browser;
const errors=[];
const pass=(name,data={})=>console.log('PASS_PLAYER_SUSPEND_UI',JSON.stringify({name,...data}));
try{
 vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true,watch:null,hmr:false}});
 await vite.listen();const url='http://127.0.0.1:'+vite.httpServer.address().port+'/';
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:960,height:540}}),page=await ctx.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
 await page.clock.setFixedTime(new Date(Date.UTC(2026,0,5,12)));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
   typeof window.__bbGame.registry.get('currentBuildId')==='string',null,{timeout:60000});
 const started=await page.evaluate(async()=>{
  const [{captureCausalState},{fingerprintState}]=await Promise.all([
   import('/src/systems/replay/fingerprintCapture.js'),import('/src/systems/replay/fingerprint.js')]);
  const g=window.__bbGame;g.loop.sleep();
  g.scene.getScene('TitleScene').startRun('sim-05@0');
  g.scene.stop('TitleScene');g.scene.start('RunScene');g.headlessStep(0,0);
  const r=g.scene.getScene('RunScene');
  if(!r.sys.isActive()||r.simClock.tick!==0)throw Error('stock initial run not active');
  r.inputRouter.poll=()=>({push:false,tilt:0,heli:0,tuck:false,hop:false,pressed:{}});
  let t=0;while(r.simClock.tick<481&&!r.crashed){t+=1000/120;g.headlessStep(t,1000/120);}
  if(r.simClock.tick!==481||r.unrankedPractice||r.upgradeRun.enabled||r.magnetsDrop||r.kodiaksOn||r.biomeMask!==0)
   throw Error('stock eligibility failed '+JSON.stringify({tick:r.simClock.tick,mode:r.unrankedPractice,upgraded:r.upgradeRun.enabled,magnet:r.magnetsDrop,kodiaks:r.kodiaksOn,biome:r.biomeMask}));
  const fingerprint=fingerprintState(captureCausalState(r));
  const source={tick:r.simClock.tick,runId:r.runId,recorderTick:r.ghostRecorder.lastTick,fp:fingerprint.combined};
  window.__testClock=t;
  r.pauseRun();g.headlessStep(t,0);
  return {...source,paused:g.scene.isPaused('RunScene'),pauseActive:g.scene.isActive('PauseScene'),pending:r._manualPausePending};
 });
 assert.equal(started.paused,true);assert.equal(started.pauseActive,true);assert.equal(started.pending,true);
 pass('stock 481-tick live run paused via real RunScene',started);
 const saved=await page.evaluate(async()=>{
  const g=window.__bbGame,p=g.scene.getScene('PauseScene');
  if(!p.menu.items.some(x=>x.label==='SUSPEND RUN'))throw Error('missing Pause menu action');
  await p.suspend();
  if(!p.suspendConfirm||p.leaving)throw Error('double confirmation missing');
  await p.suspend();
  // Phaser queues stop/start scene switches until its next scene-manager step.
  for(let n=0;n<5;n++)g.headlessStep(window.__testClock,0);
  return {titleActive:g.scene.isActive('TitleScene'),runActive:g.scene.isActive('RunScene'),pauseActive:g.scene.isActive('PauseScene'),notice:p.ledgerFooter?.main?.text,leaving:p.leaving,confirm:p.suspendConfirm,paused:g.scene.isPaused('RunScene')};
 });
 console.log('SUSPEND_ACTION_RESULT',JSON.stringify(saved));
 assert.equal(saved.titleActive,true,JSON.stringify(saved));assert.equal(saved.runActive,false);
 pass('Pause Suspend double-confirm writes slot then quits without run completion',saved);
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene').resumeState?.status==='ready',null,{timeout:15000});
 const menu=await page.evaluate(()=>{
  const t=window.__bbGame.scene.getScene('TitleScene');
  return {button:t.resumeButton.label.text||t.resumeButton.label._text,disabled:t.resumeButton.disabled,
   status:t.resumeState.status,runId:t.resumeState.runId,tick:t.resumeState.tick};
 });
 assert.equal(menu.disabled,false);assert.equal(menu.status,'ready');assert.equal(menu.tick,481);
 pass('Title R RESUME enabled only after pure slot readiness check',menu);
 await page.evaluate(async()=>{
  const t=window.__bbGame.scene.getScene('TitleScene');
  await t._resumeSavedRun();
  window.__bbGame.headlessStep(window.__testClock,0);
 });
 // For a sleeping game loop, step the scene manager at zero delta. The
 // continuation may await dynamic identity imports and IDB transactions.
 let result;
 for(let n=0;n<170;n++){
  result=await page.evaluate(()=>{
   const g=window.__bbGame,r=g.scene.getScene('RunScene');
   g.headlessStep(window.__testClock,0);
   const t=g.scene.getScene('TitleScene');
   return {run:g.scene.isActive('RunScene'),title:g.scene.isActive('TitleScene'),
    tick:r.simClock?.tick,runId:r.runId,visible:r.sys?.isVisible?.(),
    notice:g.registry.get('bb.localSuspendNotice')||t.resumeNote?.text||null,
    ui:g.scene.isActive('UIScene')};
  });
  if(result.run&&result.visible&&result.ui&&result.tick===481)break;
  if(result.title&&n>5&&result.notice)break;
  await page.waitForTimeout(40);
 }
 assert.equal(result.run,true,JSON.stringify(result));
 assert.equal(result.tick,481,JSON.stringify(result));assert.equal(result.visible,true);
 const final=await page.evaluate(async()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');
  const [{captureCausalState},{fingerprintState},
   {LocalSuspendSlot},{loadCurrentBuildDescriptor},{candidateSuspendLayout}]=await Promise.all([
    import('/src/systems/replay/fingerprintCapture.js'),import('/src/systems/replay/fingerprint.js'),
    import('/src/systems/savestate/localSuspendSlot.js'),
    import('/src/systems/savestate/runtimeIdentity.js'),
    import('/src/systems/savestate/candidateSuspendEnvelope.js')]);
  const slot=new LocalSuspendSlot(),id=await loadCurrentBuildDescriptor();
  const peek=await slot.peek(id,candidateSuspendLayout),claim=await slot.claim(id,candidateSuspendLayout);
  return {tick:r.simClock.tick,runId:r.runId,recorderTick:r.ghostRecorder.lastTick,
   fp:fingerprintState(captureCausalState(r)).combined,
   pausePending:r._manualPausePending,slotPeek:peek,secondClaim:claim,uiActive:g.scene.isActive('UIScene')};
 });
 assert.equal(final.tick,started.tick);assert.equal(final.runId,started.runId);
 assert.equal(final.fp,started.fp);assert.equal(final.recorderTick,started.recorderTick);
 assert.equal(final.pausePending,false);assert.deepEqual(final.slotPeek,{ok:true,status:'empty'});
 assert.deepEqual(final.secondClaim,{ok:false,code:'empty'});assert.equal(final.uiActive,true);
 assert.deepEqual(errors,[],'no JS/browser console errors');
 pass('native zero-tick resumed state exact, one-use slot consumed after success',{
  tick:final.tick,runId:final.runId,recorderTick:final.recorderTick,
  fpEqual:true,oneUse:true,ui:final.uiActive,pageErrors:errors.length});
 await ctx.close();
}finally{await browser?.close();await vite?.close();}
