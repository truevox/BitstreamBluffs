import {chromium} from 'playwright';
import assert from 'node:assert/strict';

/** Real Phaser pause-scene lifecycle, event contract only. Music Friday owns
 * turntable DSP and transport: no unverified audio claims are made here.
 */
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
  '--enable-webgl','--ignore-gpu-blocklist',
]});
const origin=process.env.GAME_URL||'http://127.0.0.1:8241/';
const errors=[];
async function startRun(gym,seed){
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 await page.evaluate(({gym,seed})=>{
  const g=window.__bbGame,store=g.registry.get('progression').store;
  if(gym)g.registry.set('profile',store.save({...store.profile,bank:500,
    bsodGym:{discovered:true,owned:true}}));
  window.__manualEvents=[];
  for(const [name,key] of [['pause','bb:gamePause'],['resume','bb:gameResume'],
   ['abort','bb:runAbort'],['crash','bb:crash']])
   g.events.on(key,data=>window.__manualEvents.push({name,data}));
  g.scene.getScene('TitleScene').startRun(seed,0,{gym});
 },{gym,seed});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
 return page;
}
async function pauseRun(page,double=false){
 await page.evaluate(double=>{
  const r=window.__bbGame.scene.getScene('RunScene');
  r.pauseRun();if(double)r.pauseRun();
 },double);
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('PauseScene')?.sys?.isActive(),null,{timeout:15000});
 return page.evaluate(()=>{
  const g=window.__bbGame,p=g.scene.getScene('PauseScene'),r=g.scene.getScene('RunScene');
  return {pauseToken:p.manualPauseToken,runId:p.runIdFromData,gym:p.gymPractice,
    scenePaused:r.sys.isPaused(),events:window.__manualEvents};
 });
}
try{
 for(const gym of [false,true]){
  const page=await startRun(gym,'manual-turntable-'+(gym?'gym':'normal'));
  try{
   const first=await pauseRun(page,true);
   const initial=first.events.filter(e=>e.name==='pause');
   assert.equal(initial.length,1,'duplicate manual pause must not double-emit');
   assert.equal(first.scenePaused,true);
   assert.equal(first.gym,gym);
   assert.equal(first.runId,initial[0].data.runId);
   assert.equal(first.pauseToken,initial[0].data.pauseToken);
   await page.evaluate(()=>window.__bbGame.scene.getScene('PauseScene').resume());
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive()&&
     !window.__bbGame.scene.getScene('PauseScene').sys.isActive(),null,{timeout:15000});
   const afterResume=await page.evaluate(()=>window.__manualEvents);
   const resumes=afterResume.filter(e=>e.name==='resume');
   assert.equal(resumes.length,1);
   assert.equal(resumes[0].data.reason,'manual');
   assert.equal(resumes[0].data.runId,first.runId);
   assert.equal(resumes[0].data.pauseToken,first.pauseToken);
   assert.equal(resumes[0].data.gym,gym);
   const second=await pauseRun(page);
   const secondPauses=second.events.filter(e=>e.name==='pause');
   assert.equal(secondPauses.length,2);
   assert.notEqual(second.pauseToken,first.pauseToken);
   assert.equal(second.pauseToken,secondPauses[1].data.pauseToken);
   await page.evaluate(()=>window.__bbGame.scene.getScene('PauseScene').quit());
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:15000});
   const afterQuit=await page.evaluate(()=>({events:window.__manualEvents,
    practiceFlag:window.__bbGame.registry.get('bsodGymMode')}));
   assert.equal(afterQuit.events.filter(e=>e.name==='resume').length,1,
    'Quit must not accidentally generate resumed scratch');
   const [quitAbort]=afterQuit.events.filter(e=>e.name==='abort');
   assert.equal(quitAbort.data.reason,'quit');
   assert.equal(quitAbort.data.pauseToken,second.pauseToken);
   assert.equal(afterQuit.events.filter(e=>e.name==='abort').length,1);
   assert.equal(afterQuit.events.filter(e=>e.name==='crash').length,0);
   assert.equal(afterQuit.practiceFlag,false);
   for(const p of afterQuit.events.filter(e=>e.name==='pause')){
    assert.equal(p.data.reason,'manual');
    assert.equal(p.data.runId,first.runId);
    assert.equal(p.data.gym,gym);
    assert.ok(p.data.pauseToken.startsWith(first.runId+':'));
   }
   console.log(gym?'TURNTABLE_GYM_MATCHED_PAUSE_RESUME_QUIT_PASS':
    'TURNTABLE_NORMAL_MATCHED_PAUSE_RESUME_QUIT_PASS',{
      pauses:secondPauses.map(p=>p.data.pauseToken),resumes:1,aborts:1,gym,
    });
  }finally{await page.close();}
 }
 const restartPage=await startRun(true,'manual-turntable-restart-contract');
 try{
  const first=await pauseRun(restartPage);
  await restartPage.evaluate(()=>window.__bbGame.scene.getScene('PauseScene').restart());
  await restartPage.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive()&&
    !window.__bbGame.scene.getScene('PauseScene').sys.isActive(),null,{timeout:15000});
  const events=await restartPage.evaluate(()=>window.__manualEvents);
  assert.equal(events.filter(e=>e.name==='resume').length,0);
  const aborts=events.filter(e=>e.name==='abort');
  assert.equal(aborts.length,1);
  assert.equal(aborts[0].data.reason,'restart');
  assert.equal(aborts[0].data.pauseToken,first.pauseToken);
  assert.equal(aborts[0].data.runId,first.runId);
  console.log('TURNTABLE_RESTART_DISCARDS_PAUSE_NO_FAKE_RESUME_PASS',{
    abortReason:'restart',pauseToken:first.pauseToken,manualResumes:0,
  });
 }finally{await restartPage.close();}
 const page=await startRun(false,'manual-turntable-death-contract');
 try{
  const d=await page.evaluate(()=>{
   const g=window.__bbGame,r=g.scene.getScene('RunScene');
   g.loop.stop();
   r.bsod.wallX=r.sled.body.bounds.min.x+12;
   r.bsod.wallSpeedPxS=10000;
   g.headlessStep(8000,16.67);g.headlessStep(8017,16.67);
   return {crashed:r.crashed,bsodCaught:r.bsodCaught,gym:r.bsodGym,
     events:window.__manualEvents};
  });
  assert.equal(d.gym,false);
  assert.equal(d.crashed,true);
  assert.equal(d.bsodCaught,true);
  assert.ok(d.events.some(e=>e.name==='crash'));
  assert.equal(d.events.filter(e=>e.name==='pause').length,0);
  assert.equal(d.events.filter(e=>e.name==='resume').length,0);
  console.log('TURNTABLE_REAL_DEATH_NEVER_EMITS_MANUAL_PAUSE_PASS',{
    crashes:d.events.filter(e=>e.name==='crash').length,manualPauses:0,
  });
 }finally{await page.close();}
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
