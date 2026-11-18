import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const url=process.env.GAME_URL||'http://100.115.120.66:8229/';
const scenarios=[
 {name:'clean',enabled:false,ranks:{}},
 {name:'owned-but-off',enabled:false,ranks:{canopy:12,bsodGrace:15,hop:8}},
 {name:'moderate-on',enabled:true,ranks:{canopy:12,bsodGrace:15,hop:8,flip:6}},
 {name:'max-on',enabled:true,ranks:{canopy:80,bsodGrace:80,hop:80,flip:60}},
];
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
 '--enable-webgl','--ignore-gpu-blocklist',
]});
try {
 for(const cfg of scenarios){
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  try {
   await page.goto(url,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
   await page.evaluate(({enabled,ranks,name})=>{
    const g=window.__bbGame,store=g.registry.get('progression').store;
    g.registry.set('profile',store.save({...store.profile,bank:700,
      upgradesEnabled:enabled,upgrades:{...store.profile.upgrades,...ranks},
      bsodGym:{discovered:true,owned:true}}));
    g.scene.getScene('TitleScene').startRun('gym-physics-parity-'+name,0);
   },cfg);
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
   const normal=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    return {fuel:r.sled.canopyFuelFullMs,accel:r.bsod.accelerationPxS2,
      config:r.bsod.config,fx:r.upgradeFx,enabled:r.upgradeRun.enabled,level:r.registry.get('profile').level,
      canopyRank:r.upgradeRun.ranks.canopy,boosts:r.appliedBoosts};
   });
   await page.evaluate(()=>window.__bbGame.scene.getScene('RunScene').scene.start('TitleScene'));
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
   await page.evaluate(({name})=>window.__bbGame.scene.getScene('TitleScene')
    .startRun('gym-physics-parity-'+name,0,{gym:true}),cfg);
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
   const gym=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled,
      u=g.scene.getScene('UIScene');
    g.loop.stop();
    const start={fuel:s.canopyFuelFullMs,accel:r.bsod.accelerationPxS2,
      config:r.bsod.config,fx:r.upgradeFx,enabled:r.upgradeRun.enabled,
      canopyRank:r.upgradeRun.ranks.canopy,boosts:r.appliedBoosts,
      gap:r.bsodState.gapPx,wallSpeed:r.bsod.wallSpeedPxS,ready:r.gymReadyMs,
      beginX:r.gymStartX};
    const b=g.registry.get('profile').bank;
    const record=g.registry.get('lastRecord');
    const life=JSON.stringify(g.registry.get('profile').lifetime);
    // First Gym entry also holds READY for 1000ms, with no physics.
    for(let i=0;i<20;i++)g.headlessStep(100+i*50,50);
    if(r.gymReadyMs!==0)throw Error('Initial READY did not release');
    r.bsod.wallX=s.body.bounds.min.x+12;r.bsod.wallSpeedPxS=10000;
    g.headlessStep(5000,16.67);g.headlessStep(5016,16.67);
    const caught={attempt:r.gymRetries,ready:r.gymReadyMs,
      readyVisible:u.gymReadyText.visible,
      fuel:s.canopyFuelFullMs,accel:r.bsod.accelerationPxS2,
      gap:r.bsodState.gapPx,wallSpeed:r.bsod.wallSpeedPxS,
      bank:g.registry.get('profile').bank,
      recordSame:g.registry.get('lastRecord')===record,
      lifetimeSame:JSON.stringify(g.registry.get('profile').lifetime)===life,
      clock:r.runTimeMs,wallX:r.bsod.wallX,playerX:s.x};
    for(let i=0;i<19;i++)g.headlessStep(5100+i*50,50);
    const paused={clock:r.runTimeMs,wallX:r.bsod.wallX,
      playerX:s.x,remaining:r.gymReadyMs,visible:u.gymReadyText.visible};
    g.headlessStep(6100,50);
    const go={remaining:r.gymReadyMs,visible:u.gymReadyText.visible,wallX:r.bsod.wallX};
    g.headlessStep(6150,16.67);
    const resumed={wallX:r.bsod.wallX,clock:r.runTimeMs};
    return {start,caught,paused,go,resumed};
   });
   assert.equal(gym.start.fuel,normal.fuel);
   assert.equal(gym.start.accel,normal.accel);
   assert.deepEqual(gym.start.config,normal.config);
   assert.deepEqual(gym.start.fx,normal.fx);
   assert.deepEqual(gym.start.boosts,normal.boosts);
   assert.equal(gym.start.enabled,normal.enabled);
   assert.equal(gym.start.canopyRank,normal.canopyRank);
   assert.ok(Math.abs(gym.start.wallSpeed-240)<1);
   assert.ok(Math.abs(gym.start.gap-460)<35); // UI waits a render frame before freezing simulation
   assert.ok(gym.start.ready>900 && gym.start.ready<=1000); // first entry is also frozen READY
   assert.equal(gym.caught.attempt,1);
   assert.ok(gym.caught.ready>950 && gym.caught.ready<=1000);
   assert.equal(gym.caught.readyVisible,true);
   assert.equal(gym.caught.fuel,normal.fuel);
   assert.equal(gym.caught.accel,normal.accel);
   assert.equal(gym.caught.recordSame,true);
   assert.equal(gym.caught.lifetimeSame,true);
   assert.equal(gym.caught.bank,700);
   assert.equal(gym.paused.clock,gym.caught.clock);
   assert.equal(gym.paused.wallX,gym.caught.wallX);
   assert.equal(gym.paused.playerX,gym.caught.playerX);
   assert.ok(gym.paused.remaining>0 && gym.paused.remaining<=50);
   assert.equal(gym.paused.visible,true);
   assert.equal(gym.go.remaining,0);
   assert.equal(gym.go.visible,false);
   assert.equal(gym.go.wallX,gym.caught.wallX);
   assert.ok(gym.resumed.wallX>gym.go.wallX);
   assert.ok(gym.resumed.clock>gym.caught.clock);
   assert.deepEqual(errors,[]);
   console.log('GYM_LIVE_PHYSICS_AND_FROZEN_READY_MATCH_PASS',JSON.stringify({
     scenario:cfg.name,fullFuelMs:normal.fuel,acceleration:normal.accel,
     retryMs:1000,gap:gym.start.gap,wallSpeed:gym.start.wallSpeed,
   }));
  } finally {await page.close();}
 }
} finally {await browser.close();}
console.log('ALL_FOUR_REAL_LOADOUT_GYM_PARITY_AND_QUICK_RETRY_SCENARIOS_PASS');
