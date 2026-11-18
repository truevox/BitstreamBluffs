import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Only TEST-ONLY fake timing; no release beat catalog edits or audio playback changes.
// Exercising actual Phaser PauseScene and RunScene lifecycle from a real browser.
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
 '--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try {
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:8241/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 await page.evaluate(()=>{
  const g=window.__bbGame,store=g.registry.get('progression').store;
  g.registry.set('profile',store.save({...store.profile,bank:500,
    bsodGym:{discovered:true,owned:true}}));
  g.scene.getScene('TitleScene').startRun('gym-beat-pause-resume-qa',0,{gym:true});
 });
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
 const outcome=await page.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene'),a=g.registry.get('audioSynth');
  g.loop.stop();
  const started=JSON.stringify(g.registry.get('profile'));
  const go=[];g.events.on('bb:gymReadyGo',p=>go.push(p));
  const originalGet=a.getBeatTiming,originalCheck=a.isBeatTimingCurrent;
  let queries=0,checks=0,stepClock=12000;
  const step=ms=>{stepClock+=ms;g.headlessStep(stepClock,ms);};
  a.getBeatTiming=opts=>{
    queries++;
    const t=Number.isFinite(a.ctx?.currentTime)?a.ctx.currentTime:100;
    return {trusted:true,release:'on-beat',waitMs:280,
      audioContextTime:t,dueAudioTime:t+.28,
      transportRevision:'TEST_ONLY:1',trackId:'TEST_ONLY',confidence:.99,
      gridVersion:'TEST_ONLY_FAKE_NOT_SHIPPED'};
  };
  a.isBeatTimingCurrent=()=>{checks++;return false;};
  try {
    for(let i=0;i<22&&r.gymReadyMs>0;i++)step(50);
    if(r.gymReadyMs!==0||r.gymBeatWaitMs!==280||queries!==1||go.length!==0)
      throw Error('Failed to reach pending trusted wait');
    const before={ready:r.gymReadyMs,extra:r.gymBeatWaitMs,
      wall:r.bsod.wallX,clock:r.runTimeMs,x:r.sled.x};
    r.pauseRun();step(16.67);
    const paused=g.scene.getScene('PauseScene');
    if(!paused.sys.isActive()||r.sys.isActive())
      throw Error('Pause scene not active');
    const hold={ready:r.gymReadyMs,extra:r.gymBeatWaitMs,
      wall:r.bsod.wallX,clock:r.runTimeMs,x:r.sled.x};
    paused.resume();
    const resumed={ready:r.gymReadyMs,extra:r.gymBeatWaitMs,
      wall:r.bsod.wallX,clock:r.runTimeMs,x:r.sled.x,queries,checks,go:go.length};
    step(16.67);
    const after={ready:r.gymReadyMs,extra:r.gymBeatWaitMs,
      wall:r.bsod.wallX,clock:r.runTimeMs,x:r.sled.x,queries,checks,go:go.length};
    return {before,hold,resumed,after,go,profileUnchanged:
      JSON.stringify(g.registry.get('profile'))===started};
  } finally {a.getBeatTiming=originalGet;a.isBeatTimingCurrent=originalCheck;}
 });
 assert.equal(outcome.before.extra,280);
 assert.deepEqual(outcome.hold,outcome.before);
 assert.equal(outcome.resumed.extra,0);
 assert.equal(outcome.resumed.ready,0);
 assert.equal(outcome.resumed.go,1);
 assert.equal(outcome.resumed.queries,1);
 assert.equal(outcome.resumed.checks,0); // paused advice must never be reported as beat-valid
 assert.equal(outcome.go[0].onBeat,false);
 assert.equal(outcome.profileUnchanged,true);
 assert.equal(outcome.after.go,1);
 assert.ok(outcome.after.clock>outcome.before.clock);
 assert.deepEqual(errors,[]);
 console.log('GYM_PENDING_BEAT_PAUSE_RESUME_INVALIDATES_ONCE_AND_GOES_PASS',outcome);
 const lifecycle=await page.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene'),a=g.registry.get('audioSynth');
  let clock=30000,go=0,queries=0;
  const step=ms=>{clock+=ms;g.headlessStep(clock,ms);};
  g.events.on('bb:gymReadyGo',()=>go++);
  r.resetBsodGym();
  step(200); // Minimum READY still running, no beat looked up yet.
  const beforePause={remaining:r.gymReadyMs,wall:r.bsod.wallX,clock:r.runTimeMs,go};
  r.pauseRun();step(16.67);
  const pause=g.scene.getScene('PauseScene');
  const held={remaining:r.gymReadyMs,wall:r.bsod.wallX,clock:r.runTimeMs,go};
  pause.resume();
  const resumed={remaining:r.gymReadyMs,wall:r.bsod.wallX,clock:r.runTimeMs,go};
  step(800);
  const afterReady={remaining:r.gymReadyMs,wall:r.bsod.wallX,clock:r.runTimeMs,go};
  // Now stage one more fresh optional hold, and quit via the actual PauseScene.
  const originalGet=a.getBeatTiming,originalCheck=a.isBeatTimingCurrent;
  try {
    a.getBeatTiming=()=>{
      queries++;
      const t=Number.isFinite(a.ctx?.currentTime)?a.ctx.currentTime:40;
      return {trusted:true,release:'on-beat',waitMs:260,
        audioContextTime:t,dueAudioTime:t+.26,
        transportRevision:'TEST_ONLY:2',trackId:'TEST_ONLY',confidence:.99,
        gridVersion:'TEST_ONLY_FAKE_NOT_SHIPPED'};
    };
    a.isBeatTimingCurrent=()=>true;
    r.resetBsodGym();
    for(let i=0;i<20;i++)step(50);
    const pending={extra:r.gymBeatWaitMs,hasSnapshot:!!r.gymBeatSnapshot,go,queries};
    r.pauseRun();step(16.67);
    g.scene.getScene('PauseScene').quit();
    step(16.67); // flush queued RunScene shutdown and TitleScene return
    const quit={extra:r.gymBeatWaitMs,hasSnapshot:!!r.gymBeatSnapshot,go,
      practiceFlag:g.registry.get('bsodGymMode'),
      titleActive:g.scene.getScene('TitleScene').sys.isActive()};
    return {beforePause,held,resumed,afterReady,pending,quit};
  } finally {a.getBeatTiming=originalGet;a.isBeatTimingCurrent=originalCheck;}
 });
 assert.deepEqual(lifecycle.held,lifecycle.beforePause);
 assert.deepEqual(lifecycle.resumed,lifecycle.beforePause);
 assert.ok(lifecycle.beforePause.remaining>0);
 assert.equal(lifecycle.afterReady.remaining,0);
 assert.equal(lifecycle.afterReady.wall,lifecycle.beforePause.wall);
 assert.equal(lifecycle.afterReady.clock,lifecycle.beforePause.clock);
 assert.equal(lifecycle.afterReady.go,lifecycle.beforePause.go+1);
 assert.equal(lifecycle.pending.extra,260);
 assert.equal(lifecycle.pending.hasSnapshot,true);
 assert.equal(lifecycle.pending.queries,1);
 assert.equal(lifecycle.quit.extra,0);
 assert.equal(lifecycle.quit.hasSnapshot,false);
 assert.equal(lifecycle.quit.go,lifecycle.pending.go);
 assert.equal(lifecycle.quit.practiceFlag,false);
 assert.equal(lifecycle.quit.titleActive,true);
 assert.deepEqual(errors,[]);
 console.log('GYM_MINIMUM_READY_PAUSE_PRESERVES_AND_QUIT_CLEARS_BEAT_PASS',lifecycle);
}finally{await browser.close();}
