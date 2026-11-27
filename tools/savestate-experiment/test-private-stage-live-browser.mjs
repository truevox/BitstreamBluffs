/**
 * #119: real unpaused Phaser browser loop tests opt-in private staging.
 * No candidate bytes or UI; normal unrelated RunScene starts must be unchanged.
 */
import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';

let vite,browser;
const errors=[];
try{
 vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true,watch:null,hmr:false}});
 await vite.listen();
 const url='http://127.0.0.1:'+vite.httpServer.address().port+'/';
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
  args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 async function boot(){
  const page=await browser.newPage({viewport:{width:960,height:540}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:60000});
  return page;
 }
 const page=await boot();
 console.log("STAGE_LIVE_BOOT_TITLE",await page.evaluate(()=>({status:window.__bbGame.scene.getScene("TitleScene").sys.settings.status,loop:window.__bbGame.loop.running,visible:document.visibilityState})));
 const staged=await page.evaluate(async()=>{
  const [{armPrivateRunSceneStage},{EVT}]=await Promise.all([
   import('/src/systems/savestate/privateStageOwnership.js'),import('/src/events.js')]);
  const g=window.__bbGame;
  let events=0;g.events.on(EVT.RUN_START,()=>events++);
  const arm=armPrivateRunSceneStage(g);
  g.scene.start('RunScene');
  const run=await Promise.race([arm.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error(
   'stage-ready-timeout:'+JSON.stringify({title:g.scene.isActive('TitleScene'),
    runActive:g.scene.isActive('RunScene'),runStatus:g.scene.getScene('RunScene').sys.settings.status,
    loopRunning:g.loop.running}))),7000))]);
  const state=()=>({title:g.scene.isActive('TitleScene'),paused:g.scene.isPaused('RunScene'),
   visible:run.sys.settings.visible,tick:run.simClock.tick,events,
   hud:g.scene.isActive('UIScene'),inputEnabled:run.inputRouter?.enabled});
  window.__privateStageTest={g,run,state,events:()=>events,EVT};
  return state();
 });
 assert(staged.title&&staged.paused&&!staged.visible&&staged.tick===0&&staged.events===0&&!staged.hud,
  JSON.stringify(staged));
 await page.waitForTimeout(220); // Phaser's real frame scheduler still runs.
 const noPremature=await page.evaluate(()=>window.__privateStageTest.state());
 assert(noPremature.title&&noPremature.paused&&!noPremature.visible&&noPremature.tick===0&&
  noPremature.events===0&&!noPremature.hud,JSON.stringify(noPremature));
 const commit=await page.evaluate(()=>{
  const {g,run,EVT,state}=window.__privateStageTest;
  g.scene.stop('TitleScene');run.sys.setVisible(true);
  run.scene.launch('UIScene');run.sys.resume();
  run.inputRouter?.setEnabled?.(true);
  g.events.emit(EVT.RUN_START,{runId:run.runId,seed:run.seed,startedAt:run.startedAt,
   dailyOfficial:false,dailyMode:false,gym:false,practice:false,resumed:true});
  return state();
 });
 assert(commit.events===1&&!commit.title&&!commit.paused&&commit.visible,JSON.stringify(commit));
 await page.waitForFunction(()=>window.__privateStageTest.state().tick>0,null,{timeout:10000});
 const running=await page.evaluate(()=>window.__privateStageTest.state());
 assert(running.events===1&&running.tick>0&&running.visible&&!running.paused,JSON.stringify(running));
 await page.close();
 const normalPage=await boot();
 console.log("STAGE_LIVE_NORMAL_BOOT");
 const normal=await normalPage.evaluate(async()=>{
  const {EVT}=await import('/src/events.js');
  const g=window.__bbGame;
  let events=0;g.events.on(EVT.RUN_START,()=>events++);
  const promise=new Promise((resolve,reject)=>{
   g.scene.getScene('RunScene').sys.events.once('create',resolve);
   setTimeout(()=>reject(Error('normal-scene-create-timeout:'+g.scene.getScene('RunScene').sys.settings.status)),7000);
  });
  g.scene.stop('TitleScene');
  g.scene.start('RunScene');
  await promise;
  return {events,title:g.scene.isActive('TitleScene'),run:g.scene.isActive('RunScene')};
 });
 assert(normal.events===1&&normal.run&&!normal.title,JSON.stringify(normal));
 await normalPage.close();
 assert.deepEqual(errors,[]);
 console.log('PASS_PRIVATE_STAGING_LIVE_FRAME_LOOP',JSON.stringify({
  titleRetained:true,runPausedAndHiddenAcrossFrames:true,zeroPrematureTicks:true,
  zeroPrematureStartEvents:true,oneCommitEvent:true,normalStartUnaffected:true}));
}finally{await browser?.close();await vite?.close();}
