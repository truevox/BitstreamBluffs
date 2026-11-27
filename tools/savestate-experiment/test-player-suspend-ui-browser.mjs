/** #424 real stock RunScene -> PauseScene Suspend -> Title Resume -> RunScene.
 * This test MUST execute the game's own player actions; no harness direct
 * LocalSuspendSlot put/claim/restore bypass is permitted. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
let vite,browser;
const tick=process.argv.includes('--tick936')?936:481;
const reopen=process.argv.includes('--reopen');
const uiEvents=process.argv.includes('--ui-events');
const touch=process.argv.includes('--touch');
const errors=[];
const pass=(name,data={})=>console.log('PASS_PLAYER_SUSPEND_UI',JSON.stringify({name,...data}));
try{
 vite=await createServer({server:{host:'127.0.0.1',port:5179,strictPort:true,watch:null,hmr:false}});
 await vite.listen();const url='http://127.0.0.1:'+vite.httpServer.address().port+'/';
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext(touch?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:960,height:540}});let page=await ctx.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
 await page.clock.setFixedTime(new Date(Date.UTC(2026,0,5,12)));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
   typeof window.__bbGame.registry.get('currentBuildId')==='string',null,{timeout:60000});
 const started=await page.evaluate(async(targetTick)=>{
  const [{captureCausalState},{fingerprintState}]=await Promise.all([
   import('/src/systems/replay/fingerprintCapture.js'),import('/src/systems/replay/fingerprint.js')]);
  const g=window.__bbGame;g.loop.sleep();
  g.scene.getScene('TitleScene').startRun('sim-05@0');
  g.scene.stop('TitleScene');g.scene.start('RunScene');g.headlessStep(0,0);
  const r=g.scene.getScene('RunScene');
  if(!r.sys.isActive()||r.simClock.tick!==0)throw Error('stock initial run not active');
  r.inputRouter.poll=()=>({push:false,tilt:0,heli:0,tuck:false,hop:false,pressed:{}});
  let t=0;while(r.simClock.tick<targetTick&&!r.crashed){t+=1000/120;g.headlessStep(t,1000/120);}
  if(r.simClock.tick!==targetTick||r.unrankedPractice||r.upgradeRun.enabled||r.magnetsDrop||r.kodiaksOn||r.biomeMask!==0)
   throw Error('stock eligibility failed '+JSON.stringify({tick:r.simClock.tick,mode:r.unrankedPractice,upgraded:r.upgradeRun.enabled,magnet:r.magnetsDrop,kodiaks:r.kodiaksOn,biome:r.biomeMask}));
  const fingerprint=fingerprintState(captureCausalState(r));
  const source={tick:r.simClock.tick,runId:r.runId,recorderTick:r.ghostRecorder.lastTick,fp:fingerprint.combined};
  window.__testClock=t;
  r.pauseRun();g.headlessStep(t,0);
  return {...source,paused:g.scene.isPaused('RunScene'),pauseActive:g.scene.isActive('PauseScene'),pending:r._manualPausePending};
 },tick);
 assert.equal(started.paused,true);assert.equal(started.pauseActive,true);assert.equal(started.pending,true);
 pass('stock real RunScene paused via real menu',{...started,case:tick,reopen});
 let saved;
 if(touch){
  // Touch input is delivered by Phaser's live input plugin; the RunScene is
  // paused, so waking the presentation loop cannot advance any sim tick.
  const entered=await page.evaluate(()=>{
   const g=window.__bbGame,p=g.scene.getScene('PauseScene');
   // Advance only presentation/scene-manager time while RunScene is paused;
   // this permits the CRT transition to reach its visible, hittable state.
   let frameTime=window.__testClock;
   for(let n=0;n<70;n++){frameTime+=1000/60;g.headlessStep(frameTime,1000/60);p.tweens.tick();}
   window.__testClock=frameTime;
   return {alpha:p.menu.parentContainer.alpha,paused:g.scene.isPaused('RunScene'),tick:g.scene.getScene('RunScene').simClock.tick};
  });
  console.log('TOUCH_PAUSE_ENTER',JSON.stringify(entered));
  assert.equal(entered.paused,true);assert.equal(entered.tick,tick);
  await page.evaluate(()=>window.__bbGame.loop.wake());
  const coord=await page.evaluate(()=>{
   const g=window.__bbGame,p=g.scene.getScene('PauseScene');
   const i=p.menu.items.findIndex(x=>x.label==='SUSPEND RUN');
   if(i<0)throw Error('Suspend item absent from actual Pause menu');
   const z=p.menu.rows[i].zone;
   const pt=z.getWorldTransformMatrix().transformPoint(p.menu.colW/2,p.menu.rowH/2);
   const r=document.querySelector('canvas').getBoundingClientRect();
   return {x:r.x+pt.x*r.width/480,y:r.y+pt.y*r.height/270};
  });
  assert(coord.x>0&&coord.x<390&&coord.y>0&&coord.y<844,JSON.stringify(coord));
  console.log('TOUCH_PAUSE_COORD',JSON.stringify(coord));
  await page.touchscreen.tap(coord.x,coord.y);
  console.log('TOUCH_PAUSE_POST',JSON.stringify(await page.evaluate(()=>{
   const g=window.__bbGame,p=g.scene.getScene('PauseScene');
   return {selected:p.menu.selected,confirm:p.suspendConfirm,menuX:p.menu.x,menuY:p.menu.y,
    sceneActive:g.scene.isActive('PauseScene'),sceneOrder:g.scene.getScenes(true).map(x=>x.sys.settings.key),
    inputEnabled:p.input.enabled,touches:p.input.activePointer?.id,
    pointerX:p.input.activePointer?.x,pointerY:p.input.activePointer?.y,
    hit:p.input.hitTestPointer(p.input.activePointer).map(x=>({name:x.name,type:x.type,x:x.x,y:x.y})),
    zoneEnabled:p.menu.rows[1]?.zone?.input?.enabled,zoneVisible:p.menu.rows[1]?.zone?.visible,
    zoneActive:p.menu.rows[1]?.zone?.active,
    registeredCount:p.input._list?.length,pendingInsertion:p.input._pendingInsertion?.length,
    gameInputEnabled:g.input.enabled,gameLoopRunning:g.loop.running,
    pauseCamera:{x:p.cameras.main.x,y:p.cameras.main.y,width:p.cameras.main.width,height:p.cameras.main.height,
      zoom:p.cameras.main.zoom,scrollX:p.cameras.main.scrollX,scrollY:p.cameras.main.scrollY},
    rowZoneBounds:p.menu.rows[1]?.zone?.getBounds?.(),
    zoneHitArea:p.menu.rows[1]?.zone?.input?.hitArea,
    zoneRegistered:p.input._list?.includes(p.menu.rows[1]?.zone),
    menuVisible:p.menu.visible,menuAlpha:p.menu.alpha,menuScale:p.menu.scaleX,
    panelVisible:p.menu.parentContainer?.visible,panelAlpha:p.menu.parentContainer?.alpha,
    panelScale:p.menu.parentContainer?.scaleX,
    panelX:p.menu.parentContainer?.x,panelY:p.menu.parentContainer?.y};
  })));
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('PauseScene').suspendConfirm===true,null,{timeout:2000});
  pass('mobile tap selects real Pause SUSPEND item, first tap does NOT write',coord);
  await page.touchscreen.tap(coord.x,coord.y);
  await page.waitForFunction(()=>window.__bbGame.scene.isActive('TitleScene'),null,{timeout:15000});
  saved=await page.evaluate(()=>{const g=window.__bbGame,p=g.scene.getScene('PauseScene');return {
   titleActive:g.scene.isActive('TitleScene'),runActive:g.scene.isActive('RunScene'),
   pauseActive:g.scene.isActive('PauseScene'),notice:p.ledgerFooter?.main?.text||null,
   leaving:p.leaving,confirm:p.suspendConfirm,paused:g.scene.isPaused('RunScene')};});
 }else{
  saved=await page.evaluate(async(uiEvents)=>{
  const g=window.__bbGame,p=g.scene.getScene('PauseScene');
  if(!p.menu.items.some(x=>x.label==='SUSPEND RUN'))throw Error('missing Pause menu action');
  const item=p.menu.items.findIndex(x=>x.label==='SUSPEND RUN');
  if(uiEvents)p.menu.activate(item);else await p.suspend();
  if(!p.suspendConfirm||p.leaving)throw Error('double confirmation missing');
  if(uiEvents)p.menu.activate(item);else await p.suspend();
  // UI selection returns immediately while IndexedDB writes asynchronously;
  // pump only scene-manager zero-delta transitions, never a sim tick.
  for(let n=0;n<90;n++){
   await new Promise(resolve=>setTimeout(resolve,20));
   g.headlessStep(window.__testClock,0);
   if(g.scene.isActive('TitleScene'))break;
  }
  return {titleActive:g.scene.isActive('TitleScene'),runActive:g.scene.isActive('RunScene'),pauseActive:g.scene.isActive('PauseScene'),notice:p.ledgerFooter?.main?.text,leaving:p.leaving,confirm:p.suspendConfirm,paused:g.scene.isPaused('RunScene')};
  },uiEvents);
 }
 console.log('SUSPEND_ACTION_RESULT',JSON.stringify(saved));
 if(reopen){
  await page.close();
  page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
  await page.clock.setFixedTime(new Date(Date.UTC(2026,0,5,12)));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
   typeof window.__bbGame.registry.get('currentBuildId')==='string',null,{timeout:60000});
  await page.evaluate(touchMode=>{if(!touchMode)window.__bbGame.loop.sleep();window.__testClock=0;},touch);
  pass('closed original browser page; new Title boot, same IndexedDB partition',{case:tick});
 }
 assert.equal(saved.titleActive,true,JSON.stringify(saved));assert.equal(saved.runActive,false);
 pass('Pause Suspend double-confirm writes slot then quits without run completion',saved);
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene').resumeState?.status==='ready',null,{timeout:15000});
 const menu=await page.evaluate(()=>{
  const t=window.__bbGame.scene.getScene('TitleScene');
  return {button:t.resumeButton.label.text||t.resumeButton.label._text,disabled:t.resumeButton.disabled,
   status:t.resumeState.status,runId:t.resumeState.runId,tick:t.resumeState.tick};
 });
 assert.equal(menu.disabled,false);assert.equal(menu.status,'ready');assert.equal(menu.tick,tick);
 pass('Title R RESUME enabled only after pure slot readiness check',menu);
 if(touch){
  const coord=await page.evaluate(async()=>{
   const g=window.__bbGame,t=g.scene.getScene('TitleScene'),b=t.resumeButton;
   const point=b.getWorldTransformMatrix().transformPoint(b.w/2,b.h/2);
   const rect=document.querySelector('canvas').getBoundingClientRect();
   const {EVT}=await import('/src/events.js');
   // Freeze at the precise committed run-start event before one new physics
   // tick can occur; this remains a real touchscreen tap on Phaser hit zone.
   g.events.once(EVT.RUN_START,()=>g.loop.sleep());
   g.loop.wake();
   return {x:rect.x+point.x*rect.width/480,y:rect.y+point.y*rect.height/270};
  });
  assert(coord.x>=0&&coord.x<=390&&coord.y>=0&&coord.y<=844);
  await page.touchscreen.tap(coord.x,coord.y);
  pass('real mobile touchscreen tap dispatched to Title Resume chip',coord);
 }else if(uiEvents){
  await page.keyboard.press('r');
  pass('real keyboard R dispatched to Title Resume control');
 }else{
  await page.evaluate(async()=>{
   const t=window.__bbGame.scene.getScene('TitleScene');
   await t._resumeSavedRun();
   window.__bbGame.headlessStep(window.__testClock,0);
  });
 }
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
  if(result.run&&result.visible&&result.ui&&result.tick===tick)break;
  if(result.title&&n>5&&result.notice)break;
  await page.waitForTimeout(40);
 }
 assert.equal(result.run,true,JSON.stringify(result));
 assert.equal(result.tick,tick,JSON.stringify(result));assert.equal(result.visible,true);
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
 if(process.argv.includes('--suffix')){
  // A separately booted, never-suspended stock run is the control. Compare
  // EVERY exact remaining tick and the native terminal tape/run record.
  const reference=await ctx.browser().newContext({viewport:{width:960,height:540}});
  const referencePage=await reference.newPage();
  referencePage.on('pageerror',e=>errors.push('reference: '+e.message));
  await referencePage.clock.setFixedTime(new Date(Date.UTC(2026,0,5,12)));
  await referencePage.goto(url,{waitUntil:'domcontentloaded'});
  await referencePage.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
   typeof window.__bbGame.registry.get('currentBuildId')==='string',null,{timeout:60000});
  const terminal=async(p,startTick,referenceStart)=>p.evaluate(async({startTick,referenceStart})=>{
   const [{captureCausalState},{fingerprintState}]=await Promise.all([
    import('/src/systems/replay/fingerprintCapture.js'),import('/src/systems/replay/fingerprint.js')]);
   const g=window.__bbGame;
   g.loop.sleep();
   if(referenceStart){
    g.scene.getScene('TitleScene').startRun('sim-05@0');
    g.scene.stop('TitleScene');g.scene.start('RunScene');g.headlessStep(0,0);
   }
   const r=g.scene.getScene('RunScene');
   r.inputRouter.poll=()=>({push:false,tilt:0,heli:0,tuck:false,hop:false,pressed:{}});
   const recorder=r.ghostRecorder;
   let t=0;
   const seen=[];
   while(!r.crashed&&r.simClock.tick<2500){
    t+=1000/120;g.headlessStep(t,1000/120);
    if(r.simClock.tick>startTick)seen.push([r.simClock.tick,fingerprintState(captureCausalState(r)).combined]);
   }
   const record=g.registry.get('lastRecord'),tape=g.registry.get('lastGhostTape');
   if(!r.crashed||record?.id!==r.runId||tape?.runId!==r.runId)throw Error('missing exact terminal');
   return {seen,tick:r.simClock.tick,runId:r.runId,record,tape,
    fingerprints:recorder.fingerprints,fingerprintErrors:recorder.fingerprintErrorCount};
  },{startTick,referenceStart});
  try{
   const expected=await terminal(referencePage,tick,true);
   const actual=await terminal(page,tick,false);
   assert.deepEqual(actual,expected,'full post-Suspend native terminal state, tape, scores and fingerprints');
   pass('resumed run matches separate uninterrupted reference terminal',{
    sourceTick:tick,terminalTick:actual.tick,suffixTicks:actual.seen.length,
    score:actual.record.score,tapeEndTick:actual.tape.endTick,fingerprintErrors:actual.fingerprintErrors});
  }finally{await reference.close();}
 }
 assert.deepEqual(errors,[],'no JS/browser console errors');
 pass('native zero-tick resumed state exact, one-use slot consumed after success',{
  tick:final.tick,runId:final.runId,recorderTick:final.recorderTick,
  fpEqual:true,oneUse:true,ui:final.uiActive,pageErrors:errors.length,reopen});
 await ctx.close();
}finally{await browser?.close();await vite?.close();}
