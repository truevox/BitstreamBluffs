/** #30: matched seeded, real Matter simulation with/without owner AirBrake ground key. */
import {preview} from 'vite';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const [dist,base='/']=process.argv.slice(2),root=fileURLToPath(new URL('../',import.meta.url));
if(!dist)throw Error('Expected built Vite directory');let server,browser;
try{
 server=await preview({root,base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const url='http://127.0.0.1:'+server.httpServer.address().port+base;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const runs=[];
 for(const [layout,key] of [['tricksRight','a'],['tricksLeft','ArrowLeft'],['classic','ArrowUp']]){
  for(const brake of [false,true]){
   const ctx=await browser.newContext({viewport:{width:1000,height:540}}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
   try{
    await p.addInitScript(layout=>{let s=JSON.parse(localStorage.getItem('bb.settings')||'{}');localStorage.setItem('bb.settings',JSON.stringify({...s,controlLayout:layout}));},layout);
    await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});await p.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('bsod-brake-verification@0'));
    await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('RunScene')&&window.__bbGame.scene.getScene('RunScene').sled?.body,null,{timeout:30000});
    await p.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene').simClock.tick>=45,null,{timeout:12000});
    const before=await p.evaluate(()=>{const r=window.__bbGame.scene.getScene('RunScene');return {tick:r.simClock.tick,vx:r.sled.vx,x:r.sled.x,ground:r.sled.grounded};});
    if(brake)await p.keyboard.down(key);
    await p.waitForFunction(()=>{const r=window.__bbGame.scene.getScene('RunScene');return r.simClock.tick>=250||r.crashed;},null,{timeout:20000});
    const after=await p.evaluate(()=>{const r=window.__bbGame.scene.getScene('RunScene');return {tick:r.simClock.tick,vx:r.sled.vx,x:r.sled.x,ground:r.sled.grounded,crashed:r.crashed,cause:r.pendingCrash?.cause};});
    if(brake)await p.keyboard.up(key);
    if(errors.length||after.tick<200||after.crashed)throw Error('Matched run not comparable '+JSON.stringify({layout,brake,before,after,errors}));
    runs.push({layout,brake,before,after,errors});
   }finally{await ctx.close();}
  }
 }
 const compares=[];
 for(const layout of ['tricksRight','tricksLeft','classic']){
  const normal=runs.find(r=>r.layout===layout&&!r.brake),braked=runs.find(r=>r.layout===layout&&r.brake);
  const res={layout,unbraked:normal.after,braked:braked.after,deltaX:normal.after.x-braked.after.x,deltaVx:normal.after.vx-braked.after.vx};
  if(res.deltaX<=1||res.deltaVx<=0)throw Error('Ground brake failed to slow actual seeded trajectory '+JSON.stringify(res));
  compares.push(res);
 }
 console.log('PASS_MATCHED_REAL_GROUND_BRAKE_DECEL',JSON.stringify(compares));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
