/** #30: Real Chromium run with the owner-chosen AirBrake=ground brake key. */
import {preview} from 'vite';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const [dist,base='/']=process.argv.slice(2);if(!dist)throw Error('Usage: test-ground-brake-browser DIST BASE');
const root=fileURLToPath(new URL('../',import.meta.url));let server,browser;
try{
 server=await preview({root,base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const url='http://127.0.0.1:'+server.httpServer.address().port+base;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const reports=[];
 for(const [layout,key] of [['tricksRight','a'],['tricksLeft','ArrowLeft'],['classic','ArrowUp']]){
  const ctx=await browser.newContext({viewport:{width:1000,height:540}}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(layout=>{const s=JSON.parse(localStorage.getItem('bb.settings')||'{}');localStorage.setItem('bb.settings',JSON.stringify({...s,controlLayout:layout,musicEnabled:false}));},layout);
  try{
   await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
   const legend=await p.evaluate(()=>{const g=window.__bbGame,t=g.scene.getScene('TitleScene');t._openHelp(true);const v=t.view;const labels=v.layout.keyboard.rows.map(x=>x.label.text);const pad=v.layout.gamepad.rows.map(x=>x.label.text);t._closeView();return{labels,pad};});
   if(!legend.labels.includes('AIR/GND BRAKE')||!legend.pad.includes('AIR/GND BRAKE'))throw Error('Help lacks ground brake '+JSON.stringify(legend));
   await p.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('bsod-brake-verification@0'));
   await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('RunScene')&&window.__bbGame.scene.getScene('RunScene').sled?.body,null,{timeout:30000});
   // Wait for a natural grounded descent, without modifying physics or wall.
   await p.waitForFunction(()=>{const g=window.__bbGame,r=g.scene.getScene('RunScene');return r.sled?.grounded&&r.sled?.vx>130&&!r.crashed;},null,{timeout:17000});
   const before=await p.evaluate(()=>{const g=window.__bbGame,r=g.scene.getScene('RunScene');return{tick:r.simClock.tick,vx:r.sled.vx,x:r.sled.x,grounded:r.sled.grounded,layout:g.registry.get('settings')?.controlLayout};});
   await p.keyboard.down(key);
   const held=await p.evaluate(()=>{const g=window.__bbGame,r=g.scene.getScene('RunScene'),p=g.registry.get('inputRouter').poll();return{pad:p,grounded:r.sled.grounded,tick:r.simClock.tick};});
   if(!held.pad.airBrake||held.pad.brake||!held.grounded)throw Error('AirBrake not routed as expected '+JSON.stringify({layout,key,held}));
   await p.waitForTimeout(1800);
   const after=await p.evaluate(()=>{const g=window.__bbGame,r=g.scene.getScene('RunScene');return{tick:r.simClock.tick,vx:r.sled.vx,x:r.sled.x,grounded:r.sled.grounded,crashed:r.crashed,catch:r.bsodCaught||false};});
   await p.keyboard.up(key);
   const released=await p.evaluate(()=>{const g=window.__bbGame,r=g.scene.getScene('RunScene'),pad=g.registry.get('inputRouter').poll();return {tick:r.simClock.tick,airBrake:pad.airBrake,brake:pad.brake,crashed:r.crashed};});
   if(released.airBrake||released.brake||after.tick<=before.tick||errors.length)throw Error('Release/advance regression '+JSON.stringify({layout,before,held,after,released,errors}));
   // Controlled encounter: confirm holding the new brake does not suppress
   // the actual BSOD collision/death path. The wall is deliberately moved in
   // the diagnostic browser (not a naturally occurring 57-second pursuit).
   await p.keyboard.down(key);
   await p.evaluate(()=>{const r=window.__bbGame.scene.getScene('RunScene');r.bsod.wallX=r.sled.body.bounds.min.x-2;r.bsod.wallSpeedPxS=10000;});
   await p.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.crashed,null,{timeout:8000});
   const caught=await p.evaluate(()=>{const g=window.__bbGame,r=g.scene.getScene('RunScene');return{crashed:r.crashed,cause:g.registry.get('lastCrash')?.cause,bsodCaught:r.bsodCaught};});
   await p.keyboard.up(key);
   if(!caught.crashed||caught.cause!=='bsod'||errors.length)throw Error('Controlled BSOD collision suppressed by ground brake '+JSON.stringify({layout,caught,errors}));
   reports.push({layout,key,before,held:{airBrake:held.pad.airBrake,brake:held.pad.brake},after,released,caught,errors});
  }finally{await ctx.close();}
 }
 console.log('PASS_REAL_GROUND_BRAKE_INPUT_AND_HELP',JSON.stringify(reports));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
