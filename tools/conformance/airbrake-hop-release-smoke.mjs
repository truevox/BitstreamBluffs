#!/usr/bin/env node
/** #247: real compiled Phaser/Matter/Sled AirBrake-hopup regression.
 * Run after `npm run build` and preview server. No production game changes.
 * BASE_URL=http://127.0.0.1:4200 node tools/conformance/airbrake-hop-release-smoke.mjs
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const url=process.env.BASE_URL||'http://127.0.0.1:4200/';
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
]});
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const response=await page.goto(url);
  assert.equal(response.status(),200);
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:60000});
  await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('airbrake-hop-regression'));
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('RunScene')&&
    window.__bbGame.scene.getScene('RunScene').currentPhys,null,{timeout:30000});
  const measurements=await page.evaluate(()=>{
    const scene=window.__bbGame.scene.getScene('RunScene');
    const sled=scene.sled;
    const B=scene.matter.body;
    const baseMatterStep=1000/60;
    const toMatter=x=>x*baseMatterStep/1000;
    const toWorld=x=>x*1000/baseMatterStep;
    const prepare=(vx,vy,msSinceContact=200)=>{
      B.setVelocity(sled.body,{x:toMatter(vx),y:toMatter(vy)});
      sled.msSinceContact=msSinceContact;
      sled._groundRunMs=0;
      sled._sinceLaunchMs=200;
      sled.dropAheadDeg=90;
      sled._playerHopActive=true;
      sled._playerHopElapsedMs=170;
      sled.airBrakeKickUsed=false;
      sled.airBrakeLiftProtected=false;
      sled._protectedHopExtraVyPxS=0;
      sled.airBrakeKickPulse=0;
      sled.hopBufferMs=0;
      sled.boostMs=0;
    };
    const input={hop:false,variableHop:true,airBrake:true,noAutoNudge:true,pressed:{airBrake:true}};
    const actual=(label)=>{
      const v=B.getVelocity(sled.body);
      return {label,vx:toWorld(v.x),vy:toWorld(v.y),
        latch:sled.airBrakeKickUsed,hopActive:sled._playerHopActive,
        protectedHopExtra:sled._protectedHopExtraVyPxS||0};
    };
    prepare(530,150);
    sled.applyControls(input,scene.currentPhys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const first=actual('airbrake + variable-hop release');
    sled.applyControls({...input,airBrake:false,pressed:{}},scene.currentPhys,8,
      {atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const next=actual('following release frame');
    prepare(530,150,60); // inside 90ms coyote window, but already airborne
    const hopAndBrake={...input,hop:true,pressed:{hop:true,airBrake:true}};
    sled.applyControls(hopAndBrake,scene.currentPhys,8,
      {atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const coyoteFirst=actual('coyote Hop + AirBrake same physics substep');
    for(let i=0;i<25;i++){
      sled.msSinceContact+=8;
      sled.applyControls({...hopAndBrake,hop:false,airBrake:false,pressed:{}},scene.currentPhys,8,
        {atmosphereDensity:1,relativeAirX:0,proximity01:0});
    }
    const coyoteLater=actual('coyote Hop released after minimum hold time');

    // Separate-tick review finding: AirBrake fires on the first airborne
    // substep and Hop is pressed one later, still inside the 90ms coyote
    // window. Its late hop may not re-arm the hold-release cutoff.
    prepare(530,150,60);
    sled.applyControls(input,scene.currentPhys,8,
      {atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const separateBrake=actual('one-shot brake before separate coyote Hop tick');
    sled.msSinceContact=68;
    sled.applyControls({...input,airBrake:false,hop:true,pressed:{hop:true}},
      scene.currentPhys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const separateHop=actual('coyote Hop one tick AFTER AirBrake');
    for(let i=0;i<25;i++){
      sled.msSinceContact+=8;
      sled.applyControls({...input,airBrake:false,hop:false,pressed:{}},
        scene.currentPhys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});
    }
    const separateRelease=actual('separate Hop released after 25 later frames');

    prepare(100,0,60);
    sled.applyControls(input,scene.currentPhys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const lowBrake=actual('low-speed paid AirBrake -60');
    sled.msSinceContact=68;
    sled.applyControls({...input,airBrake:false,hop:true,pressed:{hop:true}},scene.currentPhys,8,
      {atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const lowHop=actual('low-speed later coyote Hop adds ~300');
    for(let i=0;i<25;i++){
      sled.msSinceContact+=8;
      sled.applyControls({...input,airBrake:false,hop:false,pressed:{}},scene.currentPhys,8,
        {atmosphereDensity:1,relativeAirX:0,proximity01:0});
    }
    const lowRelease=actual('shortened low-speed Hop preserves paid AirBrake');

    // Review case: Hop FIRST, then paid AirBrake. Releasing Hop must strip
    // only its original -360px/s ascent, leaving the extra AirBrake impulse.
    prepare(530,0,60);
    sled._playerHopActive=false;
    sled.applyControls({...input,hop:true,airBrake:false,pressed:{hop:true}},
      scene.currentPhys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const hopBefore=actual('first coyote Hop');
    sled.msSinceContact=68;
    sled.applyControls({...input,hop:true,airBrake:true,pressed:{airBrake:true}},
      scene.currentPhys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const hopThenBrake=actual('AirBrake paid after earlier Hop');
    sled._playerHopElapsedMs=180;
    sled.applyControls({...input,hop:false,airBrake:false,pressed:{}},
      scene.currentPhys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const hopThenBrakeReleased=actual('release earlier Hop but keep paid AirBrake');

    // Holding a spent AirBrake button cannot suppress normal crest smoothing.
    prepare(400,-50,80);
    sled.airBrakeKickUsed=true;
    sled._sinceLaunchMs=500; sled._groundRunMs=200; sled.dropAheadDeg=0; sled.groundAngleDeg=0;
    sled._playerHopActive=false;
    sled.applyControls({...input,hop:false,airBrake:true,pressed:{}},
      scene.currentPhys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const spentBrakeCrest=actual('spent AirBrake held during crest smoothing');

    // A very quick key tap released before the next held-input sample is
    // still a genuine edge-only press. Reusing the same VirtualPad object
    // for the next physics substep may never pay the kick a second time.
    prepare(530,150);
    const edgeOnly={...input,airBrake:false,pressed:{airBrake:true}};
    sled.applyControls(edgeOnly,scene.currentPhys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const edgeTap=actual('edge-only short AirBrake press, held state false');
    const firstPulse=!!sled.airBrakeKickPulse;
    sled.airBrakeKickPulse=0;
    sled.applyControls(edgeOnly,scene.currentPhys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const edgeRepeat=actual('same pad substep must not repeat quick tap');
    const repeatPulse=!!sled.airBrakeKickPulse;

    prepare(530,-150);
    sled.applyControls(input,scene.currentPhys,8,{atmosphereDensity:0,relativeAirX:0,proximity01:0});
    const vacuum=actual('vacuum: no paid vertical impulse');

    // Actual bundled TrickTracker on the actual Sled frame: a one-tick paid
    // AirBrake tap MUST credit one trick immediately; holding the spent key
    // must not credit another one or bootstrap a new trick.
    prepare(530,150);
    sled.applyControls(input,scene.currentPhys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const paidEvent=!!sled.airBrakeKickPulse;
    const tracker=new scene.tricks.constructor();
    const frame=sled.getFrameState(scene.runTimeMs+8,8);
    frame.input.airBrakeKicked=paidEvent;
    const paidTricks=tracker.update(frame).tricks.map(x=>x.type);
    const landedTracker=new scene.tricks.constructor();
    const landedFrame={...frame,grounded:true,input:{...frame.input,airBrakeKicked:true},crashed:false};
    const landedTricks=landedTracker.update(landedFrame).tricks.map(x=>x.type);
    const secondTouchdown=landedTracker.update({...landedFrame,timeMs:landedFrame.timeMs+8}).tricks.map(x=>x.type);
    const heldTricks=[];
    for(let i=1;i<=40;i++){
      const nextFrame={...frame,timeMs:frame.timeMs+i*8,
        input:{...frame.input,airBrake:true,airBrakeKicked:false}};
      heldTricks.push(...tracker.update(nextFrame).tricks.map(x=>x.type));
    }
    return {first,next,coyoteFirst,coyoteLater,separateBrake,separateHop,separateRelease,
      lowBrake,lowHop,lowRelease,hopBefore,hopThenBrake,hopThenBrakeReleased,
      spentBrakeCrest,vacuum,edgeTap,edgeRepeat,firstPulse,repeatPulse,
      paidEvent,paidTricks,landedTricks,secondTouchdown,heldTricks};
  });
  assert.deepEqual(errors,[],'compiled browser has no fatal page errors');
  const {first,next,coyoteFirst,coyoteLater,separateBrake,separateHop,separateRelease,vacuum}=measurements;
  assert.equal(first.latch,true);
  assert.equal(first.hopActive,false);
  assert(first.vx>150&&first.vx<300,'60% brake must cost real horizontal speed');
  assert(first.vy < -100,'AirBrake must deliver a real vertical launch');
  assert(next.vy < -100,'later hop release must not cancel paid AirBrake lift');
  assert(Math.abs(next.vx-first.vx)<2,'no second held-AirBrake speed cut');
  assert.equal(coyoteFirst.latch,true);
  assert.equal(coyoteFirst.hopActive,true,'Hop-added lift must remain separately releasable');
  assert(coyoteFirst.protectedHopExtra>=0); // no extra if upgraded Hop target is below paid brake ascent
  assert(coyoteFirst.vx>150&&coyoteFirst.vx<300);
  assert(coyoteFirst.vy < -100,'simultaneous coyote Hop + brake preserves paid lift');
  assert(coyoteLater.vy < -100,'later Hop release must not cancel the original paid lift');
  assert.equal(coyoteLater.protectedHopExtra,0);
  assert.equal(coyoteLater.hopActive,false);
  assert(coyoteLater.vx > coyoteFirst.vx*0.75,'no second 60% speed penalty over 25 naturally dragged steps');
  assert(separateBrake.vy < -100);
  assert.equal(separateHop.hopActive,true,'later coyote Hop must retain its OWN variable-release cutoff');
  assert(separateHop.protectedHopExtra>=0); // low-speed case below proves positive extra and proper cutoff
  assert(separateRelease.vy < -100,'later hop release cannot erase earlier AirBrake lift');
  assert.equal(separateRelease.protectedHopExtra,0);
  assert.equal(separateRelease.hopActive,false);
  assert(separateRelease.vx > separateBrake.vx*0.75,'no second 60% brake during later coyote Hop');
  assert(measurements.lowBrake.vy< -20 && measurements.lowBrake.vy> -100,'low speed AirBrake buys about -60');
  assert(measurements.lowHop.vy < measurements.lowBrake.vy-100,'later coyote Hop adds significant extra lift');
  assert(measurements.lowRelease.vy < -20 && measurements.lowRelease.vy> -100,
    'Hop release removes Hop-added velocity but preserves original AirBrake ascent');
  assert.equal(measurements.lowRelease.protectedHopExtra,0);
  assert.deepEqual(measurements.landedTricks,['airBrake'],'paid kick on touchdown counts immediately');
  assert.deepEqual(measurements.secondTouchdown,['airBrake'],'second genuine paid touchdown pulse must credit despite no sampled airborne frame');
  console.log('HOP_BEFORE_BRAKE_PROBE',JSON.stringify({before:measurements.hopBefore,braked:measurements.hopThenBrake,released:measurements.hopThenBrakeReleased,crest:measurements.spentBrakeCrest}));
  assert(measurements.hopBefore.vy < -100,'Hop must launch before AirBrake');
  assert(measurements.hopThenBrake.vy < measurements.hopBefore.vy,'AirBrake buys a distinct added kick after Hop');
  const paidExtra=measurements.hopThenBrake.vy-measurements.hopBefore.vy;
  assert(Math.abs(measurements.hopThenBrakeReleased.vy-paidExtra)<5,
    'releasing Hop must cut original Hop ascent but retain just the incremental AirBrake lift');
  assert.equal(measurements.hopThenBrakeReleased.protectedHopExtra,0);
  assert(Math.abs(measurements.spentBrakeCrest.vy)<1,'held spent AirBrake may not bypass crest snap');

  assert.equal(measurements.firstPulse,true,'edge-only tap must expose a physically paid kick');
  assert.equal(measurements.repeatPulse,false,'same-pad second substep cannot replay edge-only kick');
  assert(measurements.edgeTap.vx>150&&measurements.edgeTap.vx<300);
  assert(measurements.edgeTap.vy< -100);
  assert(Math.abs(measurements.edgeRepeat.vx-measurements.edgeTap.vx)<2,'edge-only brake cannot repeat');
    assert.equal(measurements.paidEvent,true,'Sled must expose real paid kick');
  assert.deepEqual(measurements.paidTricks,['airBrake'],'one-shot tap must earn regular trick immediately');
  assert.deepEqual(measurements.heldTricks,[],'holding a spent AirBrake cannot earn another trick');
  assert.equal(vacuum.hopActive,false,'without paid lift, variable-hop cutoff still applies');
  assert(Math.abs(vacuum.vy)<1,'vacuum cannot gain an AirBrake upward impulse');
  console.log(JSON.stringify(measurements,null,2));
  console.log('PASS compiled Chromium: paid AirBrake ascent survives normal and coyote-hop release; vacuum stays lift-free');
}finally {await browser.close();}
