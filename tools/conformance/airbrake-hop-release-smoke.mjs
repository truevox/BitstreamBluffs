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
    const prepare=(vx,vy)=>{
      B.setVelocity(sled.body,{x:toMatter(vx),y:toMatter(vy)});
      sled.msSinceContact=200;
      sled._groundRunMs=0;
      sled._sinceLaunchMs=200;
      sled.dropAheadDeg=90;
      sled._playerHopActive=true;
      sled._playerHopElapsedMs=170;
      sled.airBrakeKickUsed=false;
      sled.hopBufferMs=0;
      sled.boostMs=0;
    };
    const input={hop:false,variableHop:true,airBrake:true,noAutoNudge:true,pressed:{airBrake:true}};
    const actual=(label)=>{
      const v=B.getVelocity(sled.body);
      return {label,vx:toWorld(v.x),vy:toWorld(v.y),
        latch:sled.airBrakeKickUsed,hopActive:sled._playerHopActive};
    };
    prepare(530,150);
    sled.applyControls(input,scene.currentPhys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const first=actual('airbrake + variable-hop release');
    sled.applyControls({...input,airBrake:false,pressed:{}},scene.currentPhys,8,
      {atmosphereDensity:1,relativeAirX:0,proximity01:0});
    const next=actual('following release frame');
    prepare(530,-150);
    sled.applyControls(input,scene.currentPhys,8,{atmosphereDensity:0,relativeAirX:0,proximity01:0});
    const vacuum=actual('vacuum: no paid vertical impulse');
    return {first,next,vacuum};
  });
  assert.deepEqual(errors,[],'compiled browser has no fatal page errors');
  const {first,next,vacuum}=measurements;
  assert.equal(first.latch,true);
  assert.equal(first.hopActive,false);
  assert(first.vx>150&&first.vx<300,'60% brake must cost real horizontal speed');
  assert(first.vy < -100,'AirBrake must deliver a real vertical launch');
  assert(next.vy < -100,'later hop release must not cancel paid AirBrake lift');
  assert(Math.abs(next.vx-first.vx)<2,'no second held-AirBrake speed cut');
  assert.equal(vacuum.hopActive,false,'without paid lift, variable-hop cutoff still applies');
  assert(Math.abs(vacuum.vy)<1,'vacuum cannot gain an AirBrake upward impulse');
  console.log(JSON.stringify(measurements,null,2));
  console.log('PASS compiled Chromium: paid AirBrake ascent survives hop-release; vacuum stays lift-free');
}finally {await browser.close();}
