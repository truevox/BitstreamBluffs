/** #424: real mobile Chromium RAF/CRT/input flow, NOT manual headless physics.
 * Pause actual stock run; touch the actual SUSPEND row twice; close original
 * page; reopen and touch RESUME. The published run remains local/unverified.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer,preview} from 'vite';
let vite,browser;
const errors=[],emit=(name,data={})=>console.log('PASS_LIVE_PLAYER_SUSPEND_TOUCH',JSON.stringify({name,...data}));
const production=process.argv.includes('--production');
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
 vite=production?await preview({preview:{host:'127.0.0.1',port:5182,strictPort:true}})
   :await createServer({server:{host:'127.0.0.1',port:5181,strictPort:true,watch:null,hmr:false}});
 if(!production)await vite.listen();
 const url='http://127.0.0.1:'+vite.httpServer.address().port+'/';
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
 const source=await page.evaluate(async(production)=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');
  let fp;
  if(production)fp=JSON.stringify([r.sled.x,r.sled.y,r.sled.vx,r.sled.vy,r.score?.score||0,r.shieldCharges]);
  else{
   const [{captureCausalState},{fingerprintState}]=await Promise.all([
    import('/src/systems/replay/fingerprintCapture.js'),import('/src/systems/replay/fingerprint.js')]);
   fp=fingerprintState(captureCausalState(r)).combined;
  }
  return {tick:r.simClock.tick,runId:r.runId,fp,recorderTick:r.ghostRecorder?.lastTick,
   eligible:r.biomeMask===0&&!r.unrankedPractice&&!r.upgradeRun?.enabled,
   panelAlpha:g.scene.getScene('PauseScene').panel.alpha};
 },production);
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
 try{
  await page.waitForFunction(()=>{
   const g=window.__bbGame;
   return g.scene.isActive('TitleScene')&&g.scene.getScene('TitleScene').resumeState?.status==='ready';
  },null,{timeout:9000});
 }catch(e){
  console.log('PRODUCTION_SUSPEND_DIAGNOSTIC',JSON.stringify(await page.evaluate(()=>{
   const g=window.__bbGame,p=g.scene.getScene('PauseScene'),t=g.scene.getScene('TitleScene');
   return {scenes:g.scene.getScenes(true).map(x=>x.sys.settings.key),
    titleActive:g.scene.isActive('TitleScene'),pauseActive:g.scene.isActive('PauseScene'),
    runPaused:g.scene.isPaused('RunScene'),saveConfirm:p.suspendConfirm,leaving:p.leaving,
    footer:p.ledgerFooter?.main?.text,titleState:t.resumeState,build:g.registry.get('currentBuildId')};
  })));
  throw e;
 }
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
  // A compiled Vite bundle does not serve /src/events.js; this game event
  // name is stable in src/events.js and must agree across dev and production.
  g.events.once('bb:runStart',()=>{window.__testResumeCommitted=true;g.loop.sleep();}); // exact event-gated freeze
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
 const outcome=await page.evaluate(async(production)=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');
  let fp,peek,second;
  if(production){
   fp=JSON.stringify([r.sled.x,r.sled.y,r.sled.vx,r.sled.vy,r.score?.score||0,r.shieldCharges]);
   // Production JS is bundled, not source-importable. Inspect the actual
   // one-use slot through a separate READONLY IDB transaction: no test writes.
   const db=await new Promise((resolve,reject)=>{
    const req=indexedDB.open('bb-single-use-suspend-v1',1);
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
   });
   const tx=db.transaction('slots','readonly');
   const row=await new Promise((resolve,reject)=>{
    const req=tx.objectStore('slots').get('local-suspend');
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
   });
   db.close();peek=row?{ok:true,status:row.status}:{ok:true,status:'empty'};
   second=row?null:{ok:false,code:'empty'};
  }else{
   const [{captureCausalState},{fingerprintState},{LocalSuspendSlot},
    {loadCurrentBuildDescriptor},{candidateSuspendLayout}]=await Promise.all([
    import('/src/systems/replay/fingerprintCapture.js'),import('/src/systems/replay/fingerprint.js'),
    import('/src/systems/savestate/localSuspendSlot.js'),
    import('/src/systems/savestate/runtimeIdentity.js'),
    import('/src/systems/savestate/candidateSuspendEnvelope.js')]);
   fp=fingerprintState(captureCausalState(r)).combined;
   const slot=new LocalSuspendSlot(),identity=await loadCurrentBuildDescriptor();
   peek=await slot.peek(identity,candidateSuspendLayout);
   second=await slot.claim(identity,candidateSuspendLayout);
  }
  return {tick:r.simClock.tick,runId:r.runId,recorderTick:r.ghostRecorder?.lastTick,
   fp,peek,second,ui:g.scene.isActive('UIScene')};
 },production);
 assert.equal(outcome.tick,source.tick);assert.equal(outcome.runId,source.runId);
 assert.equal(outcome.fp,source.fp);assert.equal(outcome.recorderTick,source.recorderTick);
 assert.deepEqual(outcome.peek,{ok:true,status:'empty'});assert.deepEqual(outcome.second,{ok:false,code:'empty'});
 assert.deepEqual(errors,[]);
 emit('actual mobile touch Resume after real page close: zero-tick exact fingerprint, one-use consumed',{
  ...outcome,errors:errors.length,resumeHit,compiled:production});
 // Version upgrades and corrupt READY data must not strand the player. A
 // separate literal READY row with malformed bytes is test-injected into the
 // same local slot (not a scored run); the Title must require TWO actual taps
 // before explicit deletion, then refuse any D key on a CLAIMED slot.
 await page.close();
 page=await newPage(ctx,url);
 const setRow=async(status)=>page.evaluate(async(status)=>{
  const db=await new Promise((resolve,reject)=>{
   const req=indexedDB.open('bb-single-use-suspend-v1',1);
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  const tx=db.transaction('slots','readwrite');
  tx.objectStore('slots').put({id:'local-suspend',status,bytes:new Uint8Array([0xff,0x00])});
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  db.close();
 },status);
 const storedRow=async()=>page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{
   const req=indexedDB.open('bb-single-use-suspend-v1',1);
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  const tx=db.transaction('slots','readonly');
  const row=await new Promise((resolve,reject)=>{
   const req=tx.objectStore('slots').get('local-suspend');
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });db.close();return row?.status||'empty';
 });
 await setRow('ready');await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene').resumeState?.status==='corrupt',null,{timeout:15000});
 const discardHit=await page.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene'),b=t.resumeButton;
  if(b.disabled||b.label?.main?.text!=='D DISCARD')throw Error('corrupt READY slot did not expose explicit D DISCARD');
  const pt=b.getWorldTransformMatrix().transformPoint(b.w/2,b.h/2);
  const r=document.querySelector('canvas').getBoundingClientRect();
  return {x:r.x+pt.x*r.width/480,y:r.y+pt.y*r.height/270};
 });
 await page.touchscreen.tap(discardHit.x,discardHit.y);
 assert.equal(await storedRow(),'ready','first discard tap must not delete');
 assert.equal(await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').discardConfirm),true);
 await page.touchscreen.tap(discardHit.x,discardHit.y);
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').resumeState?.status==='empty',null,{timeout:10000});
 assert.equal(await storedRow(),'empty');
 emit('corrupt/incompatible local slot requires two real touch taps to discard; never automatic',{discardHit});
 await setRow('claimed');await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene').resumeState?.status==='claimed',null,{timeout:15000});
 assert.equal(await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').resumeButton.disabled),true);
 await page.keyboard.press('d');
 assert.equal(await storedRow(),'claimed','claimed slot must be retained, even after explicit D');
 assert.deepEqual(errors,[]);
 emit('claimed slot remains locked and cannot be discarded by keyboard or touch',{claimedRetained:true});
 await ctx.close();
}finally{
 await browser?.close();
 if(production&&vite?.httpServer)await new Promise(resolve=>vite.httpServer.close(resolve));
 else await vite?.close();
}
