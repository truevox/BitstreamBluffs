/** #424: real mobile Chromium RAF/CRT/input flow, NOT manual headless physics.
 * Pause actual stock run; touch the actual SUSPEND row twice; close original
 * page; reopen and touch RESUME. The published run remains local/unverified.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
let vite,browser;
const errors=[],emit=(name,data={})=>console.log('PASS_LIVE_PLAYER_SUSPEND_TOUCH',JSON.stringify({name,...data}));
const newPage=async(ctx,url)=>{
 const p=await ctx.newPage();
 p.on('pageerror',e=>errors.push(e.message));
 await p.goto(url,{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
  typeof window.__bbGame.registry.get('currentBuildId')==='string',null,{timeout:60000});
 return p;
};
const target=async(page,targetFn)=>page.evaluate(targetFn);
try{
 vite=await createServer({server:{host:'127.0.0.1',port:5181,strictPort:true,watch:null,hmr:false}});
 await vite.listen();const url='http://127.0.0.1:'+vite.httpServer.address().port+'/';
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 let page=await newPage(ctx,url);
 await page.evaluate(()=>{
  const g=window.__bbGame;
  g.scene.getScene('TitleScene').startRun('sim-05@0');
  g.scene.stop('TitleScene');g.scene.start('RunScene');
 });
 await page.waitForFunction(()=>{
  const g=window.__bbGame;
  return g.scene.isActive('RunScene')&&g.scene.getScene('RunScene').simClock?.tick>=400;
 },null,{timeout:30000});
 await page.keyboard.press('Escape');
 try{
  await page.waitForFunction(()=>{
   const g=window.__bbGame,p=g.scene.getScene('PauseScene');
   return g.scene.isActive('PauseScene')&&g.scene.isPaused('RunScene')&&p.panel?.alpha===1;
  },null,{timeout:8000});
 }catch(e){
  console.log('LIVE_PAUSE_DIAGNOSTIC',JSON.stringify(await page.evaluate(()=>{
   const g=window.__bbGame,p=g.scene.getScene('PauseScene'),r=g.scene.getScene('RunScene');
   return {scenes:g.scene.getScenes(true).map(x=>x.sys.settings.key),runTick:r.simClock?.tick,
    crashed:r.crashed,pauseActive:g.scene.isActive('PauseScene'),runPaused:g.scene.isPaused('RunScene'),
    panelAlpha:p.panel?.alpha,panelScale:p.panel?.scaleY,tweens:p.tweens?.tweens?.length,
    tweenPaused:p.tweens.paused,tweenTime:p.tweens.time,tweenPrev:p.tweens.prevTime,
    tweenStart:p.tweens.startTime,tweenElapsed:p.tweens.tweens?.map(t=>({state:t.state,elapsed:t.elapsed,paused:t.paused,timeScale:t.timeScale})),
    pauseSceneStatus:p.sys.settings.status,timePaused:p.time.paused,sceneElapsed:p.time.now,
    gameActualFps:g.loop.actualFps,gameDelta:g.loop.delta,
    inputRouter:r.inputRouter?.constructor?.name,gameLoop:g.loop.running};
  })));
  throw e;
 }
 const source=await page.evaluate(async()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');
  const [{captureCausalState},{fingerprintState}]=await Promise.all([
   import('/src/systems/replay/fingerprintCapture.js'),import('/src/systems/replay/fingerprint.js')]);
  return {tick:r.simClock.tick,runId:r.runId,fp:fingerprintState(captureCausalState(r)).combined,
   recorderTick:r.ghostRecorder?.lastTick,eligible:r.biomeMask===0&&!r.unrankedPractice&&!r.upgradeRun?.enabled,
   panelAlpha:g.scene.getScene('PauseScene').panel.alpha};
 });
 assert(source.eligible&&source.tick>=400&&source.tick<977&&source.recorderTick===source.tick,JSON.stringify(source));
 emit('real game RAF, Escape Pause, visible CRT panel, eligible stock run',source);
 const suspendHit=await target(page,()=>{
  const g=window.__bbGame,p=g.scene.getScene('PauseScene');
  const i=p.menu.items.findIndex(x=>x.label==='SUSPEND RUN');
  if(i<0)throw Error('Suspend menu item absent');
  const z=p.menu.rows[i].zone,pt=z.getWorldTransformMatrix().transformPoint(p.menu.colW/2,p.menu.rowH/2);
  const r=document.querySelector('canvas').getBoundingClientRect();
  return {x:r.x+pt.x*r.width/480,y:r.y+pt.y*r.height/270};
 });
 assert(suspendHit.x>0&&suspendHit.x<390&&suspendHit.y>0&&suspendHit.y<844);
 await page.touchscreen.tap(suspendHit.x,suspendHit.y);
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('PauseScene').suspendConfirm===true,null,{timeout:6000});
 assert.equal(await page.evaluate(()=>window.__bbGame.scene.getScene('PauseScene').leaving),false);
 emit('first genuine touch ONLY requests confirmation',suspendHit);
 await page.touchscreen.tap(suspendHit.x,suspendHit.y);
 await page.waitForFunction(()=>{
  const g=window.__bbGame;
  return g.scene.isActive('TitleScene')&&g.scene.getScene('TitleScene').resumeState?.status==='ready';
 },null,{timeout:16000});
 const title=await page.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene');
  return {saved:t.resumeState.status,tick:t.resumeState.tick,runId:t.resumeState.runId,
   runClosed:!g.scene.isActive('RunScene')&&!g.scene.isPaused('RunScene')};
 });
 assert(title.runClosed&&title.saved==='ready'&&title.tick===source.tick&&title.runId===source.runId);
 emit('second genuine touch saves original paused run and quits without score completion',title);
 await page.close();
 page=await newPage(ctx,url);
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').resumeState?.status==='ready',null,{timeout:12000});
 const resumeHit=await target(page,async()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene'),b=t.resumeButton;
  if(b.disabled)throw Error('Resume chip remained disabled despite compatible slot');
  const pt=b.getWorldTransformMatrix().transformPoint(b.w/2,b.h/2);
  const r=document.querySelector('canvas').getBoundingClientRect();
  const {EVT}=await import('/src/events.js');
  g.events.once(EVT.RUN_START,()=>{window.__testResumeCommitted=true;g.loop.sleep();}); // exact event-gated freeze
  return {x:r.x+pt.x*r.width/480,y:r.y+pt.y*r.height/270};
 });
 console.log('LIVE_RESUME_TOUCH_COORD',JSON.stringify(resumeHit));
 await page.touchscreen.tap(resumeHit.x,resumeHit.y);
 try{
  await page.waitForFunction(()=>{
   const g=window.__bbGame,r=g.scene.getScene('RunScene');
   return g.scene.isActive('RunScene')&&r.sys.isVisible()&&
    r.simClock.tick>0&&window.__testResumeCommitted===true;
  },null,{timeout:5000});
  await page.evaluate(()=>window.__bbGame.headlessStep(0,0));
  await page.waitForFunction(()=>window.__bbGame.scene.isActive('UIScene'),null,{timeout:3000});
 }catch(e){
  console.log('LIVE_RESUME_TOUCH_DIAGNOSTIC',JSON.stringify(await page.evaluate(()=>{
   const g=window.__bbGame,t=g.scene.getScene('TitleScene'),r=g.scene.getScene('RunScene');
   const z=t.resumeButton?.zone,p=t.input?.activePointer;
   return {scenes:g.scene.getScenes(true).map(x=>x.sys.settings.key),titleActive:g.scene.isActive('TitleScene'),
    titleStarting:t.starting,attract:t.attract,resumeState:t.resumeState,
    resumeDisabled:t.resumeButton?.disabled,resumeAlpha:t.resumeButton?.alpha,
    touchPointer:{x:p?.x,y:p?.y},resumeZoneBounds:z?.getBounds?.(),
    resumeHitList:t.input?.hitTestPointer?.(p)?.map(x=>x.type),
    runActive:g.scene.isActive('RunScene'),runTick:r.simClock?.tick,
    committed:window.__testResumeCommitted,notice:g.registry.get('bb.localSuspendNotice'),
    loopRunning:g.loop.running};
  })));
  throw e;
 }
 const outcome=await page.evaluate(async()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');
  const [{captureCausalState},{fingerprintState},{LocalSuspendSlot},
   {loadCurrentBuildDescriptor},{candidateSuspendLayout}]=await Promise.all([
   import('/src/systems/replay/fingerprintCapture.js'),import('/src/systems/replay/fingerprint.js'),
   import('/src/systems/savestate/localSuspendSlot.js'),
   import('/src/systems/savestate/runtimeIdentity.js'),
   import('/src/systems/savestate/candidateSuspendEnvelope.js')]);
  const slot=new LocalSuspendSlot(),identity=await loadCurrentBuildDescriptor();
  return {tick:r.simClock.tick,runId:r.runId,recorderTick:r.ghostRecorder?.lastTick,
   fp:fingerprintState(captureCausalState(r)).combined,peek:await slot.peek(identity,candidateSuspendLayout),
   second:await slot.claim(identity,candidateSuspendLayout),ui:g.scene.isActive('UIScene')};
 });
 assert.equal(outcome.tick,source.tick);assert.equal(outcome.runId,source.runId);
 assert.equal(outcome.fp,source.fp);assert.equal(outcome.recorderTick,source.recorderTick);
 assert.deepEqual(outcome.peek,{ok:true,status:'empty'});assert.deepEqual(outcome.second,{ok:false,code:'empty'});
 assert.deepEqual(errors,[]);
 emit('actual mobile touch Resume after real page close: zero-tick exact fingerprint, one-use consumed',{
  ...outcome,errors:errors.length,resumeHit});
 await ctx.close();
}finally{await browser?.close();await vite?.close();}
