/** #119 actual source UI: save real manual PauseScene -> Title, reload page,
 * resume in fresh browser scene via production controller, consume one slot.
 */
import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
let vite,browser;const errors=[];
const physical=process.argv.includes('--physical-click');
const lateFailure=process.argv.includes('--late-failure');
const corruptClear=process.argv.includes('--corrupt-clear');
const hostileObserver=process.argv.includes('--hostile-observer');
const earlyClick=process.argv.includes('--early-click');
try{
 vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true,watch:null,hmr:false}});
 await vite.listen();
 const url='http://127.0.0.1:'+vite.httpServer.address().port+'/';
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
  args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:960,height:540}});
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:60000});
 const seeded=await page.evaluate(()=>{
  const g=window.__bbGame;
  g.scene.getScene('TitleScene').startRun('one-use-human-save');
  return {current:g.scene.getScene('TitleScene').sys.settings.status};
 });
 console.log('PASS_UI_TITLE_START',JSON.stringify(seeded));
 await page.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene')&&
  window.__bbGame.scene.getScene('RunScene').simClock?.tick>=180,null,{timeout:80000});
 const paused=await page.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');
  const tick=r.simClock.tick;
  r.pauseRun();
  return {tick,runId:r.runId};
 });
 await page.waitForFunction(()=>window.__bbGame.scene.isActive('PauseScene'),null,{timeout:15000});
 if(earlyClick){
  const transient=await page.evaluate(()=>{
   const g=window.__bbGame,p=g.scene.getScene('PauseScene'),rect=g.canvas.getBoundingClientRect();
   const zone=p.menu.rows[p.menu.items.findIndex(x=>x.label==='SUSPEND RUN')].zone,
    pos=p.menu.getWorldTransformMatrix().transformPoint(zone.x+zone.width*.15,zone.y+zone.height*.5);
   return {x:rect.x+pos.x*rect.width/g.scale.gameSize.width,y:rect.y+pos.y*rect.height/g.scale.gameSize.height,
    opening:p._menuOpening};
  });
  assert(transient.opening,'early-click regression did not sample animated panel');
  await page.mouse.click(transient.x,transient.y);
  const safe=await page.evaluate(()=>{
   const g=window.__bbGame,p=g.scene.getScene('PauseScene');
   return {pause:g.scene.isActive('PauseScene'),runPaused:g.scene.isPaused('RunScene'),
    leaving:p.leaving||false,saving:p.suspendStatus?.main?.text};
  });
  assert(safe.pause&&safe.runPaused&&!safe.leaving,JSON.stringify(safe));
  console.log('PASS_EARLY_CLICK_CANNOT_QUIT_MOVING_PAUSE_MENU',JSON.stringify(safe));
 }
 // User can't click a moving destructive menu; wait for its own interactable
 // state, not an arbitrary test sleep or a stale transforming hit target.
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('PauseScene')._menuOpening===false,null,{timeout:10000});
 const menu=await page.evaluate(()=>{
  const g=window.__bbGame,p=g.scene.getScene('PauseScene');
  return {hasSuspend:!!p.canSuspend,labels:p.menu.items.map(x=>x.label),
   paused:g.scene.isPaused('RunScene'),pending:g.scene.getScene('RunScene')._manualPausePending};
 });
 console.log('PAUSED_MENU',JSON.stringify(menu));
 assert(menu.hasSuspend&&menu.labels.includes('SUSPEND RUN')&&menu.paused&&menu.pending,JSON.stringify(menu));
 if(physical){
  const point=await page.evaluate(()=>{
   const g=window.__bbGame,p=g.scene.getScene('PauseScene'),idx=p.menu.items.findIndex(i=>i.label==='SUSPEND RUN');
   const zone=p.menu.rows[idx].zone;
   const world=p.menu.getWorldTransformMatrix().transformPoint(zone.x+zone.width*.16,
    zone.y+zone.height*.5);
   const rect=g.canvas.getBoundingClientRect();
   return {world,canvas:{x:rect.x,y:rect.y,w:rect.width,h:rect.height},
    scaled:{x:rect.x+world.x*rect.width/g.scale.gameSize.width,
     y:rect.y+world.y*rect.height/g.scale.gameSize.height},
    selected:p.menu.selected,idx};
  });
  console.log('SUSPEND_CLICK',JSON.stringify(point));
  await page.mouse.move(point.scaled.x,point.scaled.y);
  await page.waitForTimeout(120);
  console.log('SUSPEND_CLICK_HITTEST',JSON.stringify(await page.evaluate(()=>{
   const g=window.__bbGame,p=g.scene.getScene('PauseScene'),pointer=g.input.activePointer,z=p.menu.rows[6].zone;
   const hits=p.input.hitTestPointer(pointer);
   return {pointer:{x:pointer.x,y:pointer.y,worldX:pointer.worldX,worldY:pointer.worldY},
    pauseInput:p.input.enabled,gameInput:g.input.enabled,zoneEnabled:z.input?.enabled,
    hits:hits.map(x=>({name:x.name,type:x.type,x:x.x,y:x.y})).slice(0,9),
    scenes:g.scene.scenes.map(x=>({key:x.sys.settings.key,status:x.sys.settings.status,input:x.input.enabled})).filter(x=>x.status===5)};
  })));
  await page.mouse.click(point.scaled.x,point.scaled.y);
  console.log('SUSPEND_CLICK_AFTER',JSON.stringify(await page.evaluate(()=>{
   const g=window.__bbGame,p=g.scene.getScene('PauseScene');
   return {active:g.scene.isActive('PauseScene'),selected:p.menu?.selected,leaving:p.leaving,
    status:p.suspendStatus?.main?.text};
  })));
 }else await page.evaluate(()=>window.__bbGame.scene.getScene('PauseScene').suspend());
 await page.waitForFunction(()=>window.__bbGame.scene.isActive('TitleScene')&&
  !window.__bbGame.scene.isActive('RunScene')&&
  window.__bbGame.scene.getScene('TitleScene')._suspendReady===true,null,{timeout:15000});
 const saved=await page.evaluate(async()=>{
  const {peekManualSuspend}=await import('/src/systems/savestate/manualSuspendController.js');
  const p=await peekManualSuspend();
  const t=window.__bbGame.scene.getScene('TitleScene');
  return {slot:p,title:t._suspendReady,chip:t.suspendButton?.visible,label:t.suspendButton?.label?.main?.text};
 });
 console.log('SAVED',JSON.stringify(saved));
 assert(saved.slot.status==='ready'&&saved.slot.tick===paused.tick&&saved.chip);
 if(corruptClear){
  await page.evaluate(async()=>{
   const {SUSPEND_SLOT_DB,SUSPEND_SLOT_STORE,SUSPEND_SLOT_KEY}=await import('/src/systems/savestate/localSuspendSlot.js');
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(SUSPEND_SLOT_DB,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const tx=db.transaction(SUSPEND_SLOT_STORE,'readwrite'),store=tx.objectStore(SUSPEND_SLOT_STORE);
   const row=await new Promise((resolve,reject)=>{const r=store.get(SUSPEND_SLOT_KEY);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   row.tick++;
   store.put(row);
   await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
   db.close();
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&window.__bbGame.scene.getScene('TitleScene')._suspendStatus==='corrupt',null,{timeout:60000});
  const button=await page.evaluate(()=>{
   const g=window.__bbGame,t=g.scene.getScene('TitleScene'),b=t.suspendButton,r=g.canvas.getBoundingClientRect();
   return {x:r.x+(b.x+b.w*.5)*r.width/g.scale.gameSize.width,y:r.y+(b.y+b.h*.5)*r.height/g.scale.gameSize.height,
    label:b.label.main.text,visible:b.visible,disabled:b.disabled};
  });
  assert(button.visible&&!button.disabled&&button.label==='CLEAR BAD SAVE',JSON.stringify(button));
  await page.mouse.click(button.x,button.y);
  const confirm=await page.evaluate(()=>({
   confirm:window.__bbGame.scene.getScene('TitleScene')._suspendConfirm,
   label:window.__bbGame.scene.getScene('TitleScene').suspendButton.label.main.text
  }));
  assert(confirm.confirm&&confirm.label==='CONFIRM ERASE',JSON.stringify(confirm));
  await page.mouse.click(button.x,button.y);
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene')._suspendStatus==='empty',null,{timeout:15000});
  const peek=await page.evaluate(async()=>{const {peekManualSuspend}=await import('/src/systems/savestate/manualSuspendController.js');return peekManualSuspend();});
  assert.equal(peek.status,'empty');
  assert.deepEqual(errors,[]);
  console.log('PASS_PLAYER_CONFIRMED_TWO_CLICK_CORRUPT_CLEAR',JSON.stringify({previousTick:paused.tick,corruptStatusConfirmed:true,twoPhysicalClicks:true,noAutoErase:true,emptyAfter:true}));
 }else{
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene')._suspendReady===true,null,{timeout:60000});
 if(lateFailure){
  const rejected=await page.evaluate(async()=>{
   const g=window.__bbGame,t=g.scene.getScene('TitleScene');
   const {resumeManualRun,peekManualSuspend}=await import('/src/systems/savestate/manualSuspendController.js');
   const before={seed:t.registry.get('seed'),mask:t.registry.get('biomeMask')};
   const failed=await resumeManualRun(t,null,{createCodec:()=>({
    prepare:()=>({world:true}),
    restore:(run)=>{run.simClock.tick=999;throw Error('synthetic late failure after mutation');}
   })});
   const slot=await peekManualSuspend();
   const after={seed:t.registry.get('seed'),mask:t.registry.get('biomeMask')};
   return {failed,slot,title:g.scene.isActive('TitleScene'),run:g.scene.isActive('RunScene'),before,after};
  });
  console.log('INJECTED_LATE_FAILURE',JSON.stringify(rejected));
  assert(rejected.failed.code==='native-restore-refused'&&rejected.slot.status==='ready'&&
   rejected.title&&!rejected.run&&JSON.stringify(rejected.before)===JSON.stringify(rejected.after),JSON.stringify(rejected));
 }
 const pre=await page.evaluate(()=>({title:window.__bbGame.scene.isActive('TitleScene'),
  saveChip:window.__bbGame.scene.getScene('TitleScene').suspendButton.visible}));
 assert(pre.title&&pre.saveChip);
 const resumed=physical?await(async()=>{
  await page.evaluate(async(hostileObserver)=>{
   const g=window.__bbGame,{EVT}=await import('/src/events.js');
   window.__resumeBrowserEvents={starts:0,resumed:0,commitTick:null};
   g.events.on(EVT.RUN_START,e=>{
    window.__resumeBrowserEvents.starts++;
    if(e.resumed===true){
     window.__resumeBrowserEvents.resumed++;
     window.__resumeBrowserEvents.commitTick=g.scene.getScene('RunScene').simClock.tick;
    }
   });
   if(hostileObserver)g.events.on(EVT.RUN_START,e=>{
    if(e.resumed===true)throw Error('injected malicious observer after consume');
   });
  },hostileObserver);
  const point=await page.evaluate(()=>{
   const t=window.__bbGame.scene.getScene('TitleScene'),b=t.suspendButton;
   const rect=window.__bbGame.canvas.getBoundingClientRect(),g=window.__bbGame;
   return {x:rect.x+(b.x+b.w*.5)*rect.width/g.scale.gameSize.width,
    y:rect.y+(b.y+b.h*.5)*rect.height/g.scale.gameSize.height};
  });
  console.log('RESUME_CLICK',JSON.stringify(point));
  await page.mouse.click(point.x,point.y);
  await page.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene')&&
   !window.__bbGame.scene.isActive('TitleScene')&&window.__resumeBrowserEvents?.resumed===1,null,{timeout:20000});
  return page.evaluate(async()=>{
   const g=window.__bbGame,run=g.scene.getScene('RunScene');
   const {peekManualSuspend}=await import('/src/systems/savestate/manualSuspendController.js');
   const after=await peekManualSuspend(),events=window.__resumeBrowserEvents;
   return {outcome:{ok:true,tick:events.commitTick},liveTick:run.simClock.tick,
    after,starts:events.starts,resumedStarts:events.resumed,
    title:g.scene.isActive('TitleScene'),run:g.scene.isActive('RunScene')};
  });
 })():await page.evaluate(async()=>{
  const game=window.__bbGame;
  const t=game.scene.getScene('TitleScene');
  const {peekManualSuspend}=await import('/src/systems/savestate/manualSuspendController.js');
  let starts=0,prestarts=0;
  const {EVT}=await import('/src/events.js');
  game.events.on(EVT.RUN_START,p=>{starts++;if(p.resumed===true)prestarts++;});
  const outcome=await t._resumeSavedRun(true);
  const after=await peekManualSuspend();
  const run=game.scene.getScene('RunScene');
  return {outcome:outcome||{ok:false,hint:t.hint?.main?.text},
   liveTick:run.simClock.tick,after,starts,resumedStarts:prestarts,
   title:game.scene.isActive('TitleScene'),run:game.scene.isActive('RunScene')};
 });
 console.log('RESUMED',JSON.stringify(resumed));
 assert(resumed.outcome.ok&&resumed.after.status==='empty'&&resumed.resumedStarts===1&&
  !resumed.title&&resumed.run&&resumed.outcome.tick===paused.tick,JSON.stringify(resumed));
 await page.waitForTimeout(150);
 const advanced=await page.evaluate(()=>window.__bbGame.scene.getScene('RunScene').simClock.tick);
 assert(advanced>paused.tick,JSON.stringify({advanced,paused:paused.tick}));
 assert.deepEqual(errors,[]);
 console.log('PASS_PLAYER_UI_SUSPEND_REOPEN_RESUME',JSON.stringify({
  oldTick:paused.tick,newTick:resumed.outcome.tick,oneUseConsumed:true,reloaded:true,
  noDuplicateRunStart:true,unrankedAuthority:'local-only',lateFailureRolledBack:lateFailure,observerRefused:hostileObserver}));
 }
}finally{await browser?.close();await vite?.close();}
