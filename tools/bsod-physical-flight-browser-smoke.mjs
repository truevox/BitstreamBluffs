import { chromium } from 'playwright';
import assert from 'node:assert/strict';

/** Staged *real-Matter* integration check, not a claim of natural player reachability.
 * Only the INITIAL position, velocity and BSOD gap are set. The rest runs normal
 * Sled.applyControls, BSOD collision, terrain, scoring and browser game physics.
 */
const url=process.env.GAME_URL || 'http://100.115.120.66:8213/';
const browser=await chromium.launch({
  headless:true,
  args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist'],
});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];
page.on('pageerror', e=>errors.push(String(e)));
try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  await page.evaluate(()=>{
    window.__bbGame.scene.getScene('TitleScene').startRun('physical-bsod-balance-probe');
  });
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:25000});
  const result=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled;
    g.loop.stop();
    const x=s.x+120, y=r.terrain.heightAt(x)-260;
    s.setPose(x,y,0,270,-360);
    r.bsod.wallX=s.body.bounds.min.x-230;
    r.bsod.wallSpeedPxS=300;
    r.bsod.accelerationPxS2=1.15;
    r.bsodBluffs.reset();
    r.bsodCaught=false;
    r.pendingCrash=null;
    r.hitStopMs=0; r.slowmoMs=0; r.blinkMs=0;
    const pad={parachute:false,hop:false,brake:false,airBrake:false,tilt:0,heli:0,
      pressed:{hop:false,pause:false,reset:false}};
    r.inputRouter={poll:()=>pad,setEnabled(){}};
    const events=[],trace=[];
    g.events.on('bb:bsodBluff',p=>events.push({...p}));
    const initial={x:s.x,y:s.y,ground:r.terrain.heightAt(x),vx:s.vx,vy:s.vy,gap:r.bsod.wallX-s.body.bounds.min.x};
    const startScore=r.score.getTotal(),startMiss=r.nearMissCount||0;
    for(let i=0;i<180 && !r.crashed;i++){
      pad.parachute=i>=6; // last-second deployment: first observe the wall closing
      g.headlessStep(i*1000/60,1000/60);
      if(i%10===0) trace.push({frame:i,x:Math.round(s.x),y:Math.round(s.y),
        vx:Math.round(s.vx),vy:Math.round(s.vy),gap:Math.round(r.bsodState?.gapPx||0),
        grounded:s.grounded,canopy:s.parachuteMs>0,points:r.score.getTotal()-startScore});
      if(events.length>0)break;
    }
    return {initial,trace,awards:events,finalGap:r.bsodState.gapPx,
      crashed:r.crashed,scoreGain:r.score.getTotal()-startScore,
      missed:(r.nearMissCount||0)-startMiss,
      finalVX:s.vx,finalY:s.y,
    };
  });
  assert.deepEqual(errors,[]);
  console.log('PHYSICAL_BSOD_BLUFF_TRACE',JSON.stringify(result,null,2));
  assert.equal(result.initial.gap,-230); // initial sign is wall-sled; compare reversed
  assert.equal(result.crashed,false);
  assert.equal(result.awards.length,1);
  assert.equal(result.awards[0].chain,1);
  assert.equal(result.awards[0].hazardType,'bsod');
  assert.ok(result.awards[0].closestGapPx<=280);
  assert.ok(result.finalGap>=450);
  assert.equal(result.missed,1);
  console.log('REAL_MATTER_BSOD_ESCAPE_PASS');
  // Real airbrake physics must spend horizontal momentum and produce an actual
  // upward velocity. If held at a standstill, it must not create any lift.
  const lift=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled;
    const x=s.x,y=-3000;
    r.bsod.wallX=s.body.bounds.min.x-7600;
    r.bsod.wallSpeedPxS=115;
    const pad={parachute:false,airBrake:true,hop:false,brake:false,tilt:0,
      pressed:{hop:false,pause:false,reset:false}};
    r.inputRouter={poll:()=>pad,setEnabled(){}};
    s.setPose(x,y,0,900,0);
    const speed0=s.vx;
    for(let i=0;i<8;i++)g.headlessStep(3000+i*1000/60,1000/60);
    const speedPaid={speed0,speed:s.vx,vertical:s.vy};
    s.setPose(x,y,0,0,0);
    for(let i=0;i<8;i++)g.headlessStep(4000+i*1000/60,1000/60);
    return {speedPaid,stationary:{speed:s.vx,vertical:s.vy},crashed:r.crashed};
  });
  console.log('PHYSICAL_AIRBRAKE_TRANSFERS_SPEED_TO_LIFT',lift);
  assert.equal(lift.crashed,false);
  assert.ok(lift.speedPaid.speed<lift.speedPaid.speed0);
  assert.ok(lift.speedPaid.vertical<0);
  assert.ok(lift.stationary.vertical>=0);
  assert.deepEqual(errors,[]);
  console.log('REAL_MATTER_AIRBRAKE_LIFT_PASS');
  // Advanced timing probe: brake briefly to lure a faster wall closer,
  // then unfurl the sail. This starts at a controlled high lip (the normal
  // generator isn't instructed to provide the lip), but all subsequent
  // velocity, wall motion and scoring are normal game physics.
  const fast=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled;
    const x=s.x+150;
    s.setPose(x,r.terrain.heightAt(x)-300,0,570,-360);
    r.bsod.wallX=s.body.bounds.min.x-230;
    r.bsod.wallSpeedPxS=600;
    r.bsod.accelerationPxS2=1.15;
    r.bsodBluffs.reset();
    r.bsodCaught=false;r.pendingCrash=null;r.hitStopMs=0;r.slowmoMs=0;r.blinkMs=0;
    const pad={parachute:false,airBrake:true,hop:false,brake:false,tilt:0,
      pressed:{hop:false,pause:false,reset:false}};
    r.inputRouter={poll:()=>pad,setEnabled(){}};
    const recorded=[];
    g.events.on('bb:bsodBluff',e=>recorded.push({...e}));
    const frames=[];
    for(let i=0;i<190 && !r.crashed;i++){
      pad.airBrake=i<10;pad.parachute=i>=10;
      g.headlessStep(5000+i*1000/60,1000/60);
      if(i%15===0)frames.push({f:i,gap:Math.round(r.bsodState?.gapPx||0),
        vx:Math.round(s.vx),vy:Math.round(s.vy),ground:s.grounded,
        fuel:Math.round(s.parachuteFuelMs),score:recorded.length});
      if(recorded.length) break;
    }
    return {records:recorded,frames,crashed:r.crashed,
      lastGap:r.bsodState?.gapPx,ground:s.grounded};
  });
  console.log('FAST_WALL_TIMING_PROBE',JSON.stringify(fast,null,2));
  assert.equal(fast.crashed,false);
  assert.equal(fast.records.length,1);
  assert.equal(fast.records[0].points,190);
  assert.equal(fast.records[0].surfing,false);
  assert.ok(fast.records[0].closestGapPx<=280);
  assert.ok(fast.lastGap>=450);
  assert.equal(fast.ground,false);
  console.log('REAL_MATTER_600PX_WALL_BLUFF_PASS');
  // Experimental physics-only tier-30 envelope. This forcibly configures
  // the *starting* loadout for a staged flight; it does not pretend to be
  // a legitimately earned or ranked run. Actual scene/collision forces run.
  const upgraded=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled;
    const rank=30;
    const b=(cap,k)=>cap*rank/(rank+k);
    r.upgradeFx={...r.upgradeFx,
      speedMul:1+b(.30,12),hopMul:1+b(.22,12),
      canopyFuelMul:1+b(.70,14),airbrakeLiftMul:1+b(.55,12),
      bsodAccelerationMul:1-b(.25,18)};
    s.canopyFuelFullMs=880*r.upgradeFx.canopyFuelMul;
    const x=s.x+120;
    s.setPose(x,r.terrain.heightAt(x)-300,0,570,-360*r.upgradeFx.hopMul);
    r.bsod.wallX=s.body.bounds.min.x-230;
    r.bsod.wallSpeedPxS=600;
    r.bsod.accelerationPxS2=1.15*r.upgradeFx.bsodAccelerationMul;
    r.bsodBluffs.reset();
    r.bsodCaught=false;r.pendingCrash=null;r.hitStopMs=0;r.slowmoMs=0;r.blinkMs=0;
    const pad={parachute:false,airBrake:true,hop:false,brake:false,tilt:0,
      pressed:{hop:false,pause:false,reset:false}};
    r.inputRouter={poll:()=>pad,setEnabled(){}};
    const events=[],frames=[];
    g.events.on('bb:bsodBluff',e=>events.push({...e}));
    for(let i=0;i<220 && !r.crashed;i++){
      pad.airBrake=i<10;pad.parachute=i>=10;
      g.headlessStep(9000+i*1000/60,1000/60);
      if(i%20===0)frames.push({f:i,gap:Math.round(r.bsodState?.gapPx||0),
        vx:Math.round(s.vx),vy:Math.round(s.vy),ground:s.grounded,
        fuel:Math.round(s.parachuteFuelMs),awards:events.length});
      if(events.length)break;
    }
    return {events,frames,crashed:r.crashed,gap:r.bsodState?.gapPx,ground:s.grounded};
  });
  console.log('UPGRADED_WALL_TIMING_PROBE',JSON.stringify(upgraded,null,2));
  assert.equal(upgraded.crashed,false);
  assert.equal(upgraded.events.length,1);
  assert.equal(upgraded.events[0].points,190);
  assert.ok(upgraded.events[0].closestGapPx<=280);
  assert.ok(upgraded.gap>=450);
  assert.equal(upgraded.ground,false);
  assert.deepEqual(errors,[]);
  console.log('REAL_MATTER_UPGRADED_WALL_BLUFF_PASS');



} finally { await browser.close(); }
