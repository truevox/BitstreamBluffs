import { chromium } from 'playwright';
import assert from 'node:assert/strict';

/** The audio implementer owns scratch/mix. This script proves that actual
 * Phaser gameplay emits exactly one well-identified fatal crash and RUN_END,
 * shielded hits are not fatal, immediate retry uses a NEW run identity, and
 * BSOD Gym catches never masquerade as a musical death.
 */
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
 '--enable-webgl','--ignore-gpu-blocklist',
]});
const url=process.env.GAME_URL||'http://127.0.0.1:8244/';
const errors=[];
async function openRun(gym){
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 await page.evaluate(gym=>{
  const g=window.__bbGame,store=g.registry.get('progression').store;
  if(gym)g.registry.set('profile',store.save({...store.profile,bank:800,
   bsodGym:{discovered:true,owned:true}}));
  window.__fatalMusicContractEvents=[];
  for(const [name,id] of [['start','bb:runStart'],['crash','bb:crash'],
   ['end','bb:runEnd'],['reset','bb:gymAttemptReset'],
   ['pause','bb:gamePause'],['resume','bb:gameResume'],['abort','bb:runAbort']])
   g.events.on(id,p=>window.__fatalMusicContractEvents.push({name,p}));
  g.scene.getScene('TitleScene').startRun('fatal-countin-gameplay-'+(gym?'gym':'live'),0,{gym});
 },gym);
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
 return page;
}
try {
 const page=await openRun(false);
 try {
  const proof=await page.evaluate(()=>{
   const g=window.__bbGame,r=g.scene.getScene('RunScene');
   g.loop.stop();
   // Shielded impact must not trigger the death sequence, even though it
   // emits the familiar CRASH event and plays the usual SFX.
   r.shieldCharges=1;r.shieldSources=['hashedBackup'];
   r.sled.invulnerableMs=0;
   r.pendingCrash={cause:'hazard',hazardId:'contract-test-shielded'};
   r.resolveCrash({x:r.sled.x,y:r.sled.y,vx:300,vy:0});
   const afterShield=window.__fatalMusicContractEvents.slice();
   // Genuine physical BSOD fatal collision; bypasses all shields by design.
   r.bsod.wallX=r.sled.body.bounds.min.x+12;
   r.bsod.wallSpeedPxS=10000;
   g.headlessStep(6000,16.67);g.headlessStep(6017,16.67);
   const afterFatal=window.__fatalMusicContractEvents.slice();
   const state={runId:r.runId,crashed:r.crashed,bsodCaught:r.bsodCaught,
    gym:r.bsodGym,crashTimerMs:r.crashTimerMs,sceneActive:r.sys.isActive()};
   return {afterShield,afterFatal,state};
  });
  const shield=proof.afterShield.filter(e=>e.name==='crash');
  assert.equal(shield.length,1,'One shielded impact expected');
  assert.equal(shield[0].p.negated,true);
  assert.equal(shield[0].p.fatal,false);
  assert.equal(shield[0].p.runId,proof.state.runId);
  assert.equal(proof.afterShield.filter(e=>e.name==='end').length,0);
  const crashes=proof.afterFatal.filter(e=>e.name==='crash');
  const ends=proof.afterFatal.filter(e=>e.name==='end');
  assert.equal(crashes.length,2);
  assert.equal(ends.length,1);
  assert.equal(crashes[1].p.negated,false);
  assert.equal(crashes[1].p.fatal,true);
  assert.equal(crashes[1].p.runId,proof.state.runId);
  assert.equal(ends[0].p.record.id,proof.state.runId);
  assert.equal(proof.state.crashed,true);
  assert.equal(proof.state.bsodCaught,true);
  assert.equal(proof.state.gym,false);
  assert.equal(proof.afterFatal.filter(e=>e.name==='reset').length,0);
  assert.ok(proof.afterFatal.findIndex(e=>e.name==='end')>
    proof.afterFatal.findIndex(e=>e.name==='crash'&&e.p?.fatal===true));
  // Trigger normal 950ms crash-to-GameOver without waiting for a soundtrack.
  await page.evaluate(()=>{
   const g=window.__bbGame;
   for(let i=0;i<25;i++)g.headlessStep(8000+i*50,50);
  });
  const transition=await page.evaluate(()=>{
   const g=window.__bbGame,r=g.scene.getScene('RunScene');
   return {crashTimerMs:r.crashTimerMs,leaving:r._leaving,runActive:r.sys.isActive(),
    gameOverActive:g.scene.getScene('GameOverScene').sys.isActive(),
    time:r.runTimeMs,sceneKeys:g.scene.scenes.filter(x=>x.sys.isActive()).map(x=>x.sys.settings.key)};
  });
  console.log('CRASH_TO_GAMEOVER_PROBE',transition);
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('GameOverScene')?.sys?.isActive(),null,{timeout:12000});
  const atGameOver=await page.evaluate(()=>({events:window.__fatalMusicContractEvents,
   recordId:window.__bbGame.registry.get('lastRecord')?.id,
   scene:window.__bbGame.scene.getScene('GameOverScene').sys.isActive()}));
  assert.equal(atGameOver.scene,true);
  assert.equal(atGameOver.events.filter(e=>e.name==='crash'&&e.p.fatal).length,1);
  assert.equal(atGameOver.events.filter(e=>e.name==='end').length,1);
  // Immediate retry: no audio-controlled gating, no synthetic second crash.
  await page.evaluate(()=>{
   const g=window.__bbGame;
   g.scene.getScene('GameOverScene').retry();
   // Test intentionally stopped the RAF loop: drive the queued Phaser
   // GameOver -> RunScene transition with one or more explicit frames.
   for(let i=0;i<5;i++)g.headlessStep(14000+i*16.67,16.67);
  });
  await page.waitForFunction(()=>{
   const g=window.__bbGame,r=g.scene?.getScene('RunScene');
   return r?.sys?.isActive() && r.runId!==window.__fatalMusicContractEvents[0].p.runId;
  },null,{timeout:20000});
  const retry=await page.evaluate(()=>{
   const g=window.__bbGame,r=g.scene.getScene('RunScene');
   return {runId:r.runId,crashed:r.crashed,gym:r.bsodGym,
     events:window.__fatalMusicContractEvents};
  });
  const starts=retry.events.filter(e=>e.name==='start');
  assert.equal(starts.length,2);
  assert.notEqual(starts[0].p.runId,starts[1].p.runId);
  assert.equal(starts[1].p.runId,retry.runId);
  assert.equal(retry.crashed,false);
  assert.equal(retry.gym,false);
  assert.equal(retry.events.filter(e=>e.name==='crash'&&e.p.fatal).length,1);
  assert.equal(retry.events.filter(e=>e.name==='end').length,1);
  assert.equal(retry.events.filter(e=>['pause','resume','abort'].includes(e.name)).length,0);
  console.log('FATAL_CRASH_SHIELD_AND_IMMEDIATE_RETRY_EVENT_CONTRACT_PASS',{
   fatalId:proof.state.runId,nextRunId:retry.runId,starts:starts.length,
   fatalCrashes:1,shielded:1,endEvents:1,manualEvents:0,
  });
 } finally {await page.close();}
 const gym=await openRun(true);
 try {
  const result=await gym.evaluate(()=>{
   const g=window.__bbGame,r=g.scene.getScene('RunScene');
   g.loop.stop();
   for(let i=0;i<20;i++)g.headlessStep(100+i*50,50);
   if(r.gymReadyMs!==0)throw Error('Gym READY did not expire');
   r.bsod.wallX=r.sled.body.bounds.min.x+12;
   r.bsod.wallSpeedPxS=10000;
   g.headlessStep(7000,16.67);g.headlessStep(7017,16.67);
   return {gym:r.bsodGym,retries:r.gymRetries,crashed:r.crashed,
    events:window.__fatalMusicContractEvents};
  });
  assert.equal(result.gym,true);
  assert.ok(result.retries>=1);
  assert.equal(result.crashed,false);
  assert.equal(result.events.filter(e=>e.name==='reset').length,1);
  assert.equal(result.events.filter(e=>e.name==='crash').length,0);
  assert.equal(result.events.filter(e=>e.name==='end').length,0);
  assert.equal(result.events.filter(e=>e.name==='start').length,1);
  console.log('GYM_COLLISION_NEVER_STARTS_FATAL_MUSIC_COUNTIN_PASS',{
   resets:result.retries,crashes:0,runEnds:0,
  });
 } finally {await gym.close();}
 assert.deepEqual(errors,[]);
} finally {await browser.close();}
