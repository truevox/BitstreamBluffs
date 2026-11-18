import {chromium} from 'playwright';
import assert from 'node:assert/strict';

/** Actual Escape key input through InputRouter and PauseScene MenuInput.
 * Music Friday separately owns transport and scratch acoustics.
 */
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist',
]});
const base=process.env.GAME_URL||'http://127.0.0.1:8241/';
const errors=[];
try {
 for(const gym of [false,true]){
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on('pageerror',e=>errors.push(String(e)));
  try{
   await page.goto(base,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:25000});
   await page.evaluate(gym=>{
    const g=window.__bbGame,store=g.registry.get('progression').store;
    if(gym)g.registry.set('profile',store.save({...store.profile,bank:800,
      bsodGym:{discovered:true,owned:true}}));
    window.__manualKeyboard=[];
    for(const [kind,ev] of [['pause','bb:gamePause'],['resume','bb:gameResume'],
      ['abort','bb:runAbort'],['go','bb:gymReadyGo']])
      g.events.on(ev,p=>window.__manualKeyboard.push({kind,p}));
    g.scene.getScene('TitleScene').startRun('vinyl-real-keyboard-'+(gym?'gym':'normal'),0,{gym});
   },gym);
   await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.sys?.isActive(),null,{timeout:25000});
   await page.waitForTimeout(130);
   const initial=await page.evaluate(()=>{
    const r=window.__bbGame.scene.getScene('RunScene');
    return {runId:r.runId,runTimeMs:r.runTimeMs,ready:r.gymReadyMs};
   });
   await page.keyboard.press('Escape',{delay:55});
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('PauseScene')?.sys?.isActive(),null,{timeout:12000});
   const first=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),p=g.scene.getScene('PauseScene');
    return {paused:r.sys.isPaused(),token:p.manualPauseToken,remaining:r.gymReadyMs,
      clock:r.runTimeMs,events:window.__manualKeyboard};
   });
   assert.equal(first.paused,true);
   await page.waitForTimeout(230);
   const held=await page.evaluate(()=>{
    const r=window.__bbGame.scene.getScene('RunScene');
    return {remaining:r.gymReadyMs,clock:r.runTimeMs,paused:r.sys.isPaused()};
   });
   assert.equal(held.paused,true);
   assert.equal(held.remaining,first.remaining,'Actual Phaser Pause must freeze READY');
   assert.equal(held.clock,first.clock,'Actual Phaser Pause must freeze run time');
   assert.equal(first.events.filter(e=>e.kind==='pause').length,1);
   assert.ok(first.token.startsWith(initial.runId+':'));
   await page.waitForTimeout(360); // actual menu grace period
   await page.keyboard.press('Escape',{delay:45});
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive() &&
     !window.__bbGame?.scene?.getScene('PauseScene')?.sys?.isActive(),null,{timeout:12000});
   const resumed=await page.evaluate(()=>({
    events:window.__manualKeyboard,
    runTimeMs:window.__bbGame.scene.getScene('RunScene').runTimeMs,
    ready:window.__bbGame.scene.getScene('RunScene').gymReadyMs,
   }));
   assert.equal(resumed.events.filter(e=>e.kind==='pause').length,1);
   assert.equal(resumed.events.filter(e=>e.kind==='resume').length,1);
   const resume=resumed.events.find(e=>e.kind==='resume').p;
   const pause=resumed.events.find(e=>e.kind==='pause').p;
   assert.equal(resume.reason,'manual');
   assert.equal(resume.runId,pause.runId);
   assert.equal(resume.pauseToken,pause.pauseToken);
   assert.equal(resume.gym,gym);
   if(gym){
    assert.ok(initial.ready>0,'Initial Gym READY already elapsed');
    assert.ok(first.remaining>0&&first.remaining<=initial.ready&&
      initial.ready-first.remaining<170,
      'Live frames may elapse between initial snapshot and Escape');
    assert.ok(resumed.ready>0&&resumed.ready<=first.remaining&&
      first.remaining-resumed.ready<170,
      'Resume may consume live frames, but must not restart or skip mandatory READY');
    assert.equal(resumed.events.filter(e=>e.kind==='go').length,0,
      'Paused READY should not GO before its own countdown finishes');
   }
   await page.waitForTimeout(360);
   const after=await page.evaluate(()=>window.__manualKeyboard);
   assert.equal(after.filter(e=>e.kind==='pause').length,1,
     'Escape resume must not trigger immediate re-pause');
   assert.deepEqual(errors,[]);
   console.log(gym?'TURNTABLE_REAL_ESCAPE_GYM_READY_FREEZE_AND_RESUME_PASS':
     'TURNTABLE_REAL_ESCAPE_NORMAL_PAUSE_RESUME_PASS',{
       token:first.token,pauses:1,resumes:1,runId:initial.runId,
       minReadyHeld:gym?first.remaining:null,
     });
  }finally{await page.close();}
 }
}finally{await browser.close();}
