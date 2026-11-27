/** #424 regression: a genuine production-minified Vite bundle must be able
 * to save a real stock paused RunScene and reload/restore the unique tick.
 * Dev-only test sources never exercise constructor.name mangling.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {resolve,sep,extname} from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {chromium} from 'playwright';
const root=resolve(process.argv[2]||'dist');
assert((await stat(resolve(root,'index.html'))).isFile(),'built game required');
let browser,server;const errors=[],writes=[];
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
server=createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://local.test').pathname,rel=pathname==='/'?'index.html':pathname.slice(1),file=resolve(root,rel);
 res.setHeader('Cache-Control','no-store');
 if(!rel||rel.split('/').some(x=>x==='..'||x==='.'||!x)||!file.startsWith(root+sep)){res.writeHead(403).end();return;}
 try{
  if(!(await stat(file)).isFile())throw Error('not file');
  res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');
  res.writeHead(200).end(await readFile(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',
  args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({viewport:{width:960,height:540}});
 const page=await ctx.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(r.method()+':'+r.url());});
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:60000});
 const version=await page.evaluate(()=>window.__bbGame?.registry?.get('gameVersion')||document.querySelector('script[type="module"][src*="/main-"]')?.src);
 await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('production-suspend-identity'));
 await page.waitForFunction(()=>window.__bbGame?.scene.isActive('RunScene')&&
  window.__bbGame.scene.getScene('RunScene').simClock?.tick>=180,null,{timeout:80000});
 await page.evaluate(()=>window.__bbGame.scene.getScene('RunScene').pauseRun());
 await page.waitForFunction(()=>window.__bbGame.scene.isActive('PauseScene'),null,{timeout:15000});
 const state=await page.evaluate(async()=>{
  const g=window.__bbGame,p=g.scene.getScene('PauseScene'),r=g.scene.getScene('RunScene');
  const before={runId:r.runId,tick:r.simClock.tick,canSuspend:p.canSuspend};
  await p.suspend();
  return {before,status:p.suspendStatus?.main?.text,leaving:p.leaving};
 });
 assert(state.before.canSuspend,'stock run is not eligible');
 await page.waitForFunction(()=>window.__bbGame.scene.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene')._suspendStatus==='ready',null,{timeout:18000})
 .catch(()=>{throw Error('PRODUCTION_SUSPEND_REFUSED '+JSON.stringify(state));});
 const saved=await page.evaluate(()=>{
  const t=window.__bbGame.scene.getScene('TitleScene');
  return {ready:t._suspendReady,label:t.suspendButton?.label?.main?.text};
 });
 assert(saved.ready&&saved.label==='R RESUME SAVE','production local slot missing');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene')._suspendReady===true,null,{timeout:60000});
 // A real source-event receipt must show publication at the SAME source
 // tick before the browser starts subsequent simulation frames.
 await page.evaluate(()=>{
  const g=window.__bbGame;
  window.__compiledRestoreEvents=[];
  g.events.on('bb:runStart',event=>{
   if(event?.resumed){
    const r=g.scene.getScene('RunScene');
    window.__compiledRestoreEvents.push({runId:event.runId,tick:r.simClock.tick,resumed:true});
   }
  });
 });
 // Keep a second genuine compiled Title tab with a READY hint that will
 // become stale when the first tab consumes the one-use slot.
 const rival=await ctx.newPage();
 rival.on('pageerror',e=>errors.push(e.message));
 rival.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(r.method()+':'+r.url());});
 await rival.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await rival.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene')._suspendReady===true,null,{timeout:60000});
 // UI physical click, never source import / simulated controller.
 const point=await page.evaluate(()=>{
  const g=window.__bbGame,b=g.scene.getScene('TitleScene').suspendButton,
   r=g.canvas.getBoundingClientRect();
  return {x:r.x+(b.x+b.w*.5)*r.width/g.scale.gameSize.width,
   y:r.y+(b.y+b.h*.5)*r.height/g.scale.gameSize.height};
 });
 await page.mouse.click(point.x,point.y);
 await page.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene')&&
  !window.__bbGame.scene.isActive('TitleScene'),null,{timeout:25000});
 const resumed=await page.evaluate(async()=>{
  const g=window.__bbGame;
  const raw=await new Promise((yes,no)=>{
   const req=indexedDB.open('bb-single-use-suspend-v1',1);
   req.onsuccess=()=>{
    const db=req.result;
    const tx=db.transaction('slots','readonly'),read=tx.objectStore('slots').get('local-suspend');
    read.onsuccess=()=>{db.close();yes(read.result||null);};
    read.onerror=()=>{db.close();no(read.error);};
   };
   req.onerror=()=>no(req.error);
  });
  return {tick:g.scene.getScene('RunScene').simClock.tick,
   runId:g.scene.getScene('RunScene').runId,runActive:g.scene.isActive('RunScene'),
   events:window.__compiledRestoreEvents,remainingLocalSlot:raw?.status??'empty'};
 });
 assert(resumed.runId===state.before.runId&&resumed.tick>=state.before.tick&&
  resumed.events.length===1&&resumed.events[0].tick===state.before.tick&&
  resumed.events[0].runId===state.before.runId&&resumed.remainingLocalSlot==='empty',
  'production restore failed exact one-use source tick '+JSON.stringify({state,resumed}));
 // A stale real player click must NOT create a duplicate resumed RunScene.
 // Physical pointer input is used in both tabs, not programmatic Resume.
 await rival.bringToFront();
 const rivalPoint=await rival.evaluate(()=>{
  const g=window.__bbGame,b=g.scene.getScene('TitleScene').suspendButton,
   r=g.canvas.getBoundingClientRect();
  return {x:r.x+(b.x+b.w*.5)*r.width/g.scale.gameSize.width,
   y:r.y+(b.y+b.h*.5)*r.height/g.scale.gameSize.height};
 });
 const staleBefore=await rival.evaluate(()=>window.__bbGame.scene.getScene('TitleScene')._suspendReady);
 assert(staleBefore,'second tab was not genuinely stale');
 await rival.mouse.click(rivalPoint.x,rivalPoint.y);
 await rival.waitForFunction(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene');
  return t.starting===false&&t._suspendStatus==='empty';
 },null,{timeout:20000});
 const staleAfter=await rival.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene');
  return {title:g.scene.isActive('TitleScene'),run:g.scene.isActive('RunScene'),
   status:t._suspendStatus,ready:t._suspendReady,visible:t.suspendButton.visible};
 });
 assert.deepEqual(staleAfter,{title:true,run:false,status:'empty',ready:false,visible:false},
  'stale tab resurrected consumed one-use save '+JSON.stringify(staleAfter));
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('PASS_PRODUCTION_MINIFIED_NATIVE_SUSPEND_RESUME',JSON.stringify({
  version,before:state.before,saved,resumed,noNewRunId:true,
  sameOriginalTick:true,exactTickAtResumedRunStart:resumed.events[0].tick,
  staleAfter,secondTabRefused:true,errors,writes,caveat:'Compiled actual Vite bundle; no external upload or physical Chromebook.'}));
 await ctx.close();
}finally{
 await browser?.close();await new Promise(ok=>server.close(ok));
}
