import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
  '--enable-webgl','--ignore-gpu-blocklist',
]});
const origin=process.env.GAME_URL||'http://100.115.120.66:8223/';
const context=await browser.newContext({viewport:{width:1280,height:800}});
const errors=[];
async function openGym() {
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  await page.evaluate(()=>{
    const g=window.__bbGame,svc=g.registry.get('progression');
    const prof=svc.store.save({...svc.store.profile,bank:500,bsodGym:{discovered:true,owned:true}});
    g.registry.set('profile',prof);
    g.scene.getScene('TitleScene').startRun('gym-playtest-hardening',0,{gym:true});
  });
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
  return page;
}
try {
  const page=await openGym();
  const reset=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    const events=[];
    g.events.on('bb:missionCompleted',p=>events.push(p.id));
    const lifetimeBefore=JSON.stringify(g.registry.get('profile').lifetime);
    const bankBefore=g.registry.get('profile').bank;
    const recordBefore=g.registry.get('lastRecord');
    // Deliberately over-satisfy typical active mission thresholds.
    for(let i=0;i<40;i++){
      g.events.emit('bb:shardCollected',{count:i+1});
      g.events.emit('bb:nearMiss',{hazardType:'bsod',points:150});
    }
    g.events.emit('bb:distanceChanged',{meters:9999999});
    g.events.emit('bb:scoreChanged',{total:99999999});
    g.events.emit('bb:trick',{type:'frontflip',count:100});
    const unsolicitedMissions=events.slice();
    g.loop.stop();
    for(let i=0;i<20;i++)g.headlessStep(100+i*50,50);
    if(r.gymReadyMs!==0)throw Error('First READY did not release');
    r.score.addBonus(1245,'nearMiss');r.emitScore();
    r.nearMissCount=4;r.shardCount=5;r.shardTotal=200;r.shardChain=3;
    r.trickCounts={frontflip:5};r.bestCombo=3.5;
    const before=r.score.getTotal();
    r.bsod.wallX=r.sled.body.bounds.min.x+12;
    r.bsod.wallSpeedPxS=10000;
    g.headlessStep(6000,16.67);g.headlessStep(6017,16.67);
    return {
      gym:r.bsodGym, retries:r.gymRetries||0,scoreBefore:before,scoreAfter:r.score.getTotal(),bonusAfter:r.score.bonusPoints,
      nearMisses:r.nearMissCount,shards:r.shardCount,
      trickKeys:Object.keys(r.trickCounts),bestCombo:r.bestCombo,
      missionToasts:events,unsolicitedMissions,crashed:r.crashed,
      recordUnchanged:g.registry.get('lastRecord')===recordBefore,
      bankUnchanged:g.registry.get('profile').bank===bankBefore,
      lifetimeUnchanged:JSON.stringify(g.registry.get('profile').lifetime)===lifetimeBefore,
      wallGap:r.bsodState.gapPx,
    };
  });
  assert.equal(reset.gym,true);
  assert.ok(reset.retries>=1);
  assert.ok(reset.scoreBefore>0);
  assert.ok(reset.scoreAfter>=0 && reset.scoreAfter<100); // new attempt may earn small fresh distance
  assert.equal(reset.bonusAfter,0);
  assert.equal(reset.nearMisses,0);
  assert.equal(reset.shards,0);
  assert.deepEqual(reset.trickKeys,[]);
  assert.equal(reset.bestCombo,1);
  assert.deepEqual(reset.missionToasts,[]);
  assert.equal(reset.crashed,false);
  assert.equal(reset.recordUnchanged,true);
  assert.equal(reset.bankUnchanged,true);
  assert.equal(reset.lifetimeUnchanged,true);
  assert.ok(reset.wallGap>0);
  console.log('GYM_NO_MISSION_REWARD_AND_FRESH_ATTEMPT_PASS',reset);
  await page.close();

  const pausePage=await openGym();
  await pausePage.evaluate(()=>window.__bbGame.scene.getScene('RunScene').pauseRun());
  await pausePage.waitForFunction(()=>window.__bbGame?.scene?.getScene('PauseScene')?.sys?.isActive(),null,{timeout:20000});
  const pause=await pausePage.evaluate(()=>{
    const g=window.__bbGame,p=g.scene.getScene('PauseScene');
    return { gym:p.gymPractice,labels:p.menu.items.map(i=>i.label) };
  });
  assert.equal(pause.gym,true);
  assert.ok(pause.labels.includes('RESTART'));
  assert.ok(pause.labels.includes('QUIT TO TITLE'));
  for (const forbidden of ['LEADERBOARD','EXPORT CODE','IMPORT CODE'])
    assert.ok(!pause.labels.includes(forbidden));
  console.log('GYM_PAUSE_NON_RANKED_UI_PASS',pause);
  await pausePage.evaluate(()=>window.__bbGame.scene.getScene('PauseScene').restart());
  await pausePage.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive()
    && window.__bbGame.scene.getScene('RunScene').bsodGym===true,
    null,{timeout:20000});
  const restarted=await pausePage.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    return {gym:r.bsodGym,practiceFlag:g.registry.get('bsodGymMode'),
      score:r.score.getTotal(),lastRecord:g.registry.get('lastRecord')};
  });
  assert.equal(restarted.gym,true);
  assert.equal(restarted.practiceFlag,true);
  assert.equal(restarted.score,0);
  assert.equal(restarted.lastRecord,undefined);
  console.log('GYM_PAUSE_RESTART_STAYS_NON_RANKED_PASS',restarted);
  await pausePage.evaluate(()=>window.__bbGame.scene.getScene('RunScene').pauseRun());
  await pausePage.waitForFunction(()=>window.__bbGame?.scene?.getScene('PauseScene')?.sys?.isActive(),
    null,{timeout:20000});
  await pausePage.evaluate(()=>window.__bbGame.scene.getScene('PauseScene').quit());
  await pausePage.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:20000});
  const flag=await pausePage.evaluate(()=>window.__bbGame.registry.get('bsodGymMode'));
  assert.equal(flag,false);
  await pausePage.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('normal-after-gym'));
  await pausePage.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:20000});
  const normal=await pausePage.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    return {gym:r.bsodGym,practiceFlag:g.registry.get('bsodGymMode'),daily:r.dailyOfficial};
  });
  assert.equal(normal.gym,false);
  assert.equal(normal.practiceFlag,false);
  await pausePage.evaluate(()=>window.__bbGame.scene.getScene('RunScene').pauseRun());
  await pausePage.waitForFunction(()=>window.__bbGame?.scene?.getScene('PauseScene')?.sys?.isActive(),
    null,{timeout:20000});
  const normalMenu=await pausePage.evaluate(()=>window.__bbGame.scene.getScene('PauseScene')
    .menu.items.map(i=>i.label));
  for(const required of ['LEADERBOARD','EXPORT CODE','IMPORT CODE'])assert.ok(normalMenu.includes(required));
  console.log('NORMAL_PAUSE_MENU_PRESERVED_PASS',normalMenu);
  assert.deepEqual(errors,[]);
  console.log('GYM_QUIT_CLEARS_FLAG_NORMAL_GAME_UNAFFECTED_PASS',normal);
  await pausePage.close();
} finally {await browser.close();}
