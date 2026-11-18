import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE=process.env.GAME_URL||'http://100.115.120.66:8215/';
const options=[
 {wall:600,rank:0,height:1050,brakeFrames:10,reSailGap:290},
 {wall:600,rank:11,height:1050,brakeFrames:10,reSailGap:290},
 {wall:600,rank:12,height:1050,brakeFrames:10,reSailGap:290},
 {wall:600,rank:20,height:1050,brakeFrames:10,reSailGap:290},
 {wall:600,rank:30,height:1050,brakeFrames:10,reSailGap:290},
 {wall:600,rank:100,height:1250,brakeFrames:10,reSailGap:290},
 {wall:900,rank:100,height:1250,brakeFrames:10,reSailGap:290},
];
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const results=[];
try{
 for(const config of options){
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(BASE,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:20000});
   await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('void-chain-pilot'));
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:20000});
   const res=await page.evaluate((opt)=>{
     const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled;
     g.loop.stop();
     const {wall,rank,height,brakeFrames,reSailGap=290}=opt;
     const b=(cap,k)=>cap*rank/(rank+k);
     const fx={...r.upgradeFx,speedMul:1+b(.30,12),hopMul:1+b(.22,12),
       canopyFuelMul:1+b(.70,14),airbrakeLiftMul:1+b(.55,12),
       bsodAccelerationMul:1-b(.25,18)};
     r.upgradeFx=fx;
     r.upgradeRun={enabled:rank>0,ranks:rank>0?{canopy:rank}:{}};
     s.canopyFuelFullMs=880*fx.canopyFuelMul;
     const x=s.x+140;
     s.setPose(x,r.terrain.heightAt(x)-height,0,wall-30,-360*fx.hopMul);
     r.bsod.wallX=s.body.bounds.min.x-230;r.bsod.wallSpeedPxS=wall;
     r.bsod.accelerationPxS2=1.15*fx.bsodAccelerationMul;
     r.bsodBluffs.reset();r.bsodCaught=false;r.pendingCrash=null;
     r.hitStopMs=0;r.slowmoMs=0;r.blinkMs=0;
     const pad={parachute:false,airBrake:false,hop:false,brake:false,tilt:0,heli:0,
       pressed:{hop:false,pause:false,reset:false}};
     r.inputRouter={poll:()=>pad,setEnabled(){}};
     const awards=[],trace=[];
     const ui=g.scene.getScene('UIScene');
     const uiStrips=[];
     if(ui&&typeof ui._strip==='function'){
       const before=ui._strip.bind(ui);
       ui._strip=(text,...args)=>{uiStrips.push(String(text));return before(text,...args)};
     }
     let frame=0;
     g.events.on('bb:bsodBluff',e=>awards.push({...e,frame}));
     let lastAwardFrame=-1,phase='lure',phaseChanges=[];
     const phaseChange=(p)=>{if(phase!==p){phase=p;phaseChanges.push({frame,phase:p,gap:r.bsodState?.gapPx||230})}};
     let airborneMs=0,minGap=230;
     for(frame=0;frame<360&&!r.crashed;frame++){
       const oldGap=r.bsodState?.gapPx||230;
       if(phase==='lure'){
         pad.airBrake=frame<brakeFrames;pad.parachute=frame>=brakeFrames;
         if(frame>=brakeFrames)phaseChange('sail');
       }else if(phase==='sail'){
         pad.airBrake=false;pad.parachute=true;
       }else if(phase==='re-lure'){
         pad.airBrake=true;pad.parachute=false;
         if(oldGap<=reSailGap)phaseChange('re-sail');
       }else if(phase==='re-sail'){
         pad.airBrake=false;pad.parachute=true;
       }
       g.headlessStep(10000+frame*1000/60,1000/60);
       const gap=r.bsodState?.gapPx;
       if(Number.isFinite(gap)) minGap=Math.min(minGap,gap);
       if(!s.grounded)airborneMs+=1000/60;
       if(frame%20===0)trace.push({
         f:frame,mode:phase,gap:Math.round(gap||0),vx:Math.round(s.vx),vy:Math.round(s.vy),
         fuel:Math.round(s.parachuteFuelMs),heightAboveTerrain:Math.round(r.terrain.heightAt(s.x)-s.y),
         grounded:s.grounded,awards:awards.length,
       });
       if(awards.length>0&&lastAwardFrame<0){
         lastAwardFrame=frame;
         // This scenario never injects fuel. RunScene's high-tier milestone
         // must earn its own refill via a genuine scored event.
         phaseChange('re-lure')
       }
       if(awards.length>=2)break;
       if(s.grounded&&frame>4)break;
     }
     return {wall,rank,height,brakeFrames,reSailGap,awards,crashed:r.crashed,grounded:s.grounded,
       steps:frame,airborneMs:Math.round(airborneMs),minGap:Math.round(minGap),
       finalGap:Math.round(r.bsodState?.gapPx||0),fuelRemaining:Math.round(s.parachuteFuelMs),
       phaseChanges,trace,uiStrips};
   },config);
   results.push({...res,errors});
   console.log(JSON.stringify({wall:res.wall,rank:res.rank,height:res.height,brakeFrames:res.brakeFrames,reSailGap:res.reSailGap,
     awards:res.awards.map(a=>({chain:a.chain,points:a.points,frame:a.frame,recovered:Math.round(a.canopyRecoveredMs||0)})),
     crashed:res.crashed,grounded:res.grounded,steps:res.steps,airborneMs:res.airborneMs,
     minGap:res.minGap,finalGap:res.finalGap,fuelRemaining:res.fuelRemaining,errors}));
  }catch(e){console.error('PILOT_FAILED',config,e.stack);results.push({config,error:String(e)});}
  finally{await page.close();}
 }
}finally{await browser.close()}
console.log("CHAIN_PILOT_DIAGNOSTIC",JSON.stringify(results.find(r=>r.wall===600&&r.rank===30&&r.reSailGap===290),null,2));
const successes=results.filter(r=>r.awards?.length>=2);
console.log('CHAIN_PILOT_RESULTS',JSON.stringify({scenarios:results.length,
  firstBluffs:results.filter(r=>r.awards?.length>=1).length,twoBluffs:successes.length,
  scenarios:[...results.map(r=>({wall:r.wall,rank:r.rank,height:r.height,awards:r.awards?.length,
    failed:r.error||r.errors?.length>0,crashed:r.crashed,grounded:r.grounded}))]},null,2));
// This is a deterministic, staged true-Matter integration regression:
// after setting initial conditions, no gameplay forces or fuel are injected.
const find=(wall,rank)=>results.find(r=>r.wall===wall&&r.rank===rank);
for(const r of results){
 assert.equal(r.errors?.length||0,0);
 assert.equal(r.error,undefined);
 assert.ok((r.awards?.length||0)<=2);
}
for(const rank of [0,11,12])assert.equal(find(600,rank).awards.length,1);
assert.equal(find(600,0).awards[0].canopyRecoveredMs,undefined);
assert.equal(find(600,11).awards[0].canopyRecoveredMs,undefined);
assert.ok(find(600,12).awards[0].canopyRecoveredMs>0);
for(const rank of [30,100]){
 const r=find(600,rank);
 assert.equal(r.awards.length,2);
 assert.deepEqual(r.awards.map(a=>a.chain),[1,2]);
 assert.deepEqual(r.awards.map(a=>a.points),[190,225]);
 assert.equal(r.grounded,false);
 assert.equal(r.crashed,false);
 assert.ok(r.awards[0].canopyRecoveredMs>r.awards[1].canopyRecoveredMs);
 assert.ok(!r.uiStrips.some(m=>m.startsWith('CANOPY +'))); // secret has no repeat fuel popup
}
assert.equal(find(900,100).awards.length,0);
assert.equal(find(900,100).crashed,true);
assert.ok(!find(600,0).uiStrips.some(m=>m.startsWith('CANOPY +')));
console.log('TRUE_MATTER_SURFING_THE_VOID_CHAIN_PASS');
