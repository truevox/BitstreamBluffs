import {chromium} from 'playwright';
import assert from 'node:assert/strict';
// Browser integration: first launch and collision retry must hold ~one
// elapsed second even when the physics delta is clamped to 50ms.
const url=process.env.GAME_URL||'http://127.0.0.1:8231/';
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
 '--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 await page.evaluate(()=>{
  const g=window.__bbGame,store=g.registry.get('progression').store;
  g.registry.set('profile',store.save({...store.profile,bank:400,
    bsodGym:{discovered:true,owned:true}}));
  g.scene.getScene('TitleScene').startRun('gym-ready-slow-frame-check',0,{gym:true});
 });
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
 const data=await page.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled;
  g.loop.stop();
  const go=[];g.events.on('bb:gymReadyGo',()=>go.push({
    clock:r.runTimeMs,wallX:r.bsod.wallX,retries:r.gymRetries||0,
  }));
  const start={remaining:r.gymReadyMs,wallX:r.bsod.wallX,
    clock:r.runTimeMs,playerX:s.x};
  if(start.remaining<=800||start.remaining>1000)
    throw Error('Unexpected initial READY hold '+start.remaining);
  const before=[];
  for(let i=0;i<4;i++){
    g.headlessStep(1000+i*200,200);
    before.push({remaining:r.gymReadyMs,wallX:r.bsod.wallX,clock:r.runTimeMs});
  }
  g.headlessStep(1800,200);
  const released={remaining:r.gymReadyMs,wallX:r.bsod.wallX,
    clock:r.runTimeMs,goCount:go.length};
  g.headlessStep(2000,16.67);
  const running={wallX:r.bsod.wallX,clock:r.runTimeMs};
  // Genuine collision follows normal physics and starts a fresh READY.
  r.bsod.wallX=s.body.bounds.min.x+12;
  r.bsod.wallSpeedPxS=10000;
  g.headlessStep(2200,16.67);g.headlessStep(2217,16.67);
  const caught={remaining:r.gymReadyMs,wallX:r.bsod.wallX,
    clock:r.runTimeMs,retries:r.gymRetries||0};
  const retryFrames=[];
  for(let i=0;i<4;i++){
    g.headlessStep(2400+i*200,200);
    retryFrames.push({remaining:r.gymReadyMs,wallX:r.bsod.wallX,clock:r.runTimeMs});
  }
  g.headlessStep(3200,200);
  const retryGo={remaining:r.gymReadyMs,wallX:r.bsod.wallX,
    clock:r.runTimeMs,goCount:go.length};
  g.headlessStep(3400,16.67);
  const resumed={clock:r.runTimeMs,wallX:r.bsod.wallX};
  return {start,before,released,running,caught,retryFrames,retryGo,resumed,go};
 });
 assert.ok(data.before.every(p=>p.remaining>0));
 assert.ok(data.before.every(p=>p.wallX===data.start.wallX&&p.clock===data.start.clock));
 assert.equal(data.released.remaining,0);
 assert.equal(data.released.wallX,data.start.wallX);
 assert.equal(data.released.clock,data.start.clock);
 assert.equal(data.released.goCount,1);
 assert.ok(data.running.clock>data.released.clock);
 assert.ok(data.running.wallX>data.released.wallX);
 assert.equal(data.caught.retries,1);
 assert.ok(data.caught.remaining>950);
 assert.ok(data.retryFrames.every(p=>p.remaining>0));
 assert.ok(data.retryFrames.every(p=>p.wallX===data.caught.wallX&&p.clock===data.caught.clock));
 assert.equal(data.retryGo.remaining,0);
 assert.equal(data.retryGo.wallX,data.caught.wallX);
 assert.equal(data.retryGo.clock,data.caught.clock);
 assert.equal(data.retryGo.goCount,2);
 assert.ok(data.resumed.clock>data.retryGo.clock);
 assert.ok(data.resumed.wallX>data.retryGo.wallX);
 assert.deepEqual(errors,[]);
 console.log('GYM_INITIAL_AND_RETRY_READY_5FPS_WALLCLOCK_PASS',data);
}finally{await browser.close();}
