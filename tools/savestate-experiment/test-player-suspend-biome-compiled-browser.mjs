/** #424: end-to-end production-minified Pages PWA, offline cold-reopen.
 * Real stock RunScene + physical Suspend and Resume pointers; no test
 * restore imports, no source-world handoff or simulated IDB claim.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';

const root=resolve(process.argv[2]||'dist');
const denyArg=process.argv.find(x=>x.startsWith('--deny='));
const deny=denyArg?.split('=')[1]||'';
assert(!deny||['upgrade','magnet','kodiak'].includes(deny),'unsupported denial scenario');
const maskArg=process.argv.find(x=>x.startsWith('--mask='));
const mask=maskArg?Number(maskArg.split('=')[1]):3;
assert(Number.isSafeInteger(mask)&&mask>0&&mask<=0xffffffff,'positive uint32 biome mask needed');
assert((await stat(resolve(root,'sw.js'))).isFile(),'compiled PWA worker required');
assert((await stat(resolve(root,'index.html'))).isFile(),'compiled game required');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
 '.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2',
 '.webmanifest':'application/manifest+json','.bin':'application/octet-stream'};
const errors=[],outbound=[],actions=[];
let browser,server;
const slotRead=async page=>page.evaluate(async()=>{
 const req=indexedDB.open('bb-single-use-suspend-v1',1);
 return new Promise((resolve,reject)=>{
  req.onsuccess=()=>{
   const db=req.result,tx=db.transaction('slots','readonly'),get=tx.objectStore('slots').get('local-suspend');
   get.onsuccess=()=>{resolve(get.result?{status:get.result.status,runId:get.result.runId,
    tick:get.result.tick,bytes:get.result.bytes?.length}:null);db.close();};
   get.onerror=()=>{reject(get.error);db.close();};
  };
  req.onerror=()=>reject(req.error);
 });
});
const center=async(page,get)=>page.evaluate(get);
const clickGame=async(page,point)=>{
 assert(point?.x>=0&&point?.y>=0,'bad pointer target');
 await page.mouse.click(point.x,point.y);
};
try{
 server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local.invalid').pathname;
  const rel=path==='/'?'index.html':path.slice(1);
  if(!rel||rel.split('/').some(x=>!x||x==='.'||x==='..')){res.writeHead(403).end();return;}
  const target=resolve(root,rel);
  if(!target.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{
   if(!(await stat(target)).isFile())throw Error('not file');
   res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream',
    'Cache-Control':'no-store'}).end(await readFile(target));
  }catch{res.writeHead(404).end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
  headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:960,height:540}});
 await context.route('**/*',route=>{
  const url=route.request().url();
  if(url.startsWith(origin+'/'))return route.continue();
  outbound.push(route.request().method()+':'+url);
  return route.abort();
 });
 const watch=p=>p.on('pageerror',error=>errors.push(String(error.message)));
 const p=await context.newPage();watch(p);
 await p.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:60000});
 await p.evaluate(()=>navigator.serviceWorker.ready);
 await p.reload({waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  navigator.serviceWorker.controller,null,{timeout:30000});
 const installed=await p.evaluate(async()=>({
  controller:!!navigator.serviceWorker.controller,registration:!!(await navigator.serviceWorker.getRegistration()),
  shells:(await caches.keys()).filter(k=>k.startsWith('bitstream-shell-v1-')),
 }));
 assert(installed.controller&&installed.registration&&installed.shells.length>=1,'not installed offline PWA');
 await p.evaluate(({mask,deny})=>{
  const g=window.__bbGame,reg=g.registry,prof={...(reg.get('profile')||{})};
  if(deny==='upgrade')Object.assign(prof,{upgradesEnabled:true,upgrades:{speed:1}});
  if(deny==='magnet')Object.assign(prof,{level:5});
  if(deny==='kodiak')Object.assign(prof,{level:999});
  if(deny)reg.set('profile',prof);
  g.scene.getScene('TitleScene').startRun('compiled-biome-mask',mask);
 },{mask,deny});
 await p.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene')&&
  window.__bbGame.scene.getScene('RunScene').simClock?.tick>=180,null,{timeout:80000});
 await p.evaluate(()=>window.__bbGame.scene.getScene('RunScene').pauseRun());
 await p.waitForFunction(()=>window.__bbGame.scene.isActive('PauseScene'),null,{timeout:20000});
 if(deny){
  const evidence=await p.evaluate(()=>{
   const g=window.__bbGame,r=g.scene.getScene('RunScene'),pause=g.scene.getScene('PauseScene');
   return {runId:r.runId,tick:r.simClock.tick,mask:r.biomeMask,
    upgrade:r.upgradeRun.enabled,magnet:r.magnetsDrop,kodiak:r.kodiaksOn,
    paused:g.scene.isPaused('RunScene'),canSuspend:pause.canSuspend,
    suspendRows:pause.menu.items.filter(x=>x.label==='SUSPEND RUN').length,
    resumeRows:pause.menu.items.filter(x=>x.label==='RESUME').length};
  });
  assert(evidence[deny=== 'upgrade'?'upgrade':deny]===true,'nonstock scenario failed '+JSON.stringify(evidence));
  assert(evidence.paused&&!evidence.canSuspend&&evidence.suspendRows===0&&evidence.resumeRows===1,
   'unsafe nonstock suspend affordance '+JSON.stringify(evidence));
  assert.equal(await slotRead(p),null,'unsupported run created a READY save');
  assert.deepEqual(errors,[]);
  console.log('PASS_COMPILED_PWA_SUSPEND_DENIAL',JSON.stringify({deny,evidence,noPhantomSlot:true,errors,outbound}));
  await context.close();
 } else {

 // Scene transition has a 260ms CRT animation. Wait for its hit zone to
 // settle before computing the pointer position from the actual native matrix.
 await p.waitForTimeout(650);
 const before=await p.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene'),pause=g.scene.getScene('PauseScene');
  const i=pause.menu.items.findIndex(row=>row.label==='SUSPEND RUN');
  if(i<0)throw Error('no player Suspend item');
  const zone=pause.menu.rows[i].zone,m=zone.getWorldTransformMatrix();
  const point=m.transformPoint(zone.width/2,zone.height/2);
  const rect=g.canvas.getBoundingClientRect();
  return {runId:r.runId,tick:r.simClock.tick,biomeMask:r.biomeMask,buttonIndex:i,
   point:{x:rect.x+point.x*rect.width/g.scale.gameSize.width,
    y:rect.y+point.y*rect.height/g.scale.gameSize.height}};
 });
 await clickGame(p,before.point);actions.push('physical-suspend');
 await p.waitForFunction(()=>window.__bbGame.scene.isActive('TitleScene')&&
  !window.__bbGame.scene.isActive('RunScene')&&
  window.__bbGame.scene.getScene('TitleScene')._suspendReady===true,null,{timeout:30000});
 assert.equal(before.biomeMask,mask,'source biome mask not applied');
 const saved=await slotRead(p);
 assert(saved?.status==='ready'&&saved.runId===before.runId&&saved.tick===before.tick
  &&saved.bytes>60000,'durable native suspend slot missing');
 await p.close();actions.push('source-page-closed');
 await context.setOffline(true);
 const cold=await context.newPage();watch(cold);
 await cold.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:30000});
 await cold.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  navigator.serviceWorker.controller&&window.__bbGame.scene.getScene('TitleScene')._suspendReady,
 null,{timeout:30000});
 actions.push('cold-offline-title');
 await cold.evaluate(()=>{
  window.__offlineResumeEvents=[];
  window.__bbGame.events.on('bb:runStart',payload=>{
   if(payload?.resumed){
    const r=window.__bbGame.scene.getScene('RunScene');
    window.__offlineResumeEvents.push({runId:payload.runId,tick:r.simClock.tick});
   }
  });
 });
 const resumePoint=await cold.evaluate(()=>{
  const g=window.__bbGame,b=g.scene.getScene('TitleScene').suspendButton,
   m=b.getWorldTransformMatrix(),pt=m.transformPoint(b.w/2,b.h/2),
   rect=g.canvas.getBoundingClientRect();
  if(b.label.main.text!=='R RESUME SAVE'||!b.visible||b.disabled)
   throw Error('offline Resume unavailable');
  return {x:rect.x+pt.x*rect.width/g.scale.gameSize.width,
   y:rect.y+pt.y*rect.height/g.scale.gameSize.height};
 });
 await clickGame(cold,resumePoint);actions.push('physical-offline-resume');
 await cold.waitForFunction(()=>window.__bbGame?.scene.isActive('RunScene')&&
  !window.__bbGame.scene.isActive('TitleScene'),null,{timeout:30000});
 const resumed=await cold.evaluate(()=>({
  runId:window.__bbGame.scene.getScene('RunScene').runId,
  biomeMask:window.__bbGame.scene.getScene('RunScene').biomeMask,
  tick:window.__bbGame.scene.getScene('RunScene').simClock.tick,
  events:window.__offlineResumeEvents,
  controller:!!navigator.serviceWorker.controller,
 }));
 const finalSlot=await slotRead(cold);
 assert(resumed.runId===before.runId&&resumed.tick>=before.tick&&
  resumed.events.length===1&&resumed.events[0].runId===before.runId&&
  resumed.events[0].tick===before.tick&&resumed.biomeMask===before.biomeMask&&resumed.controller&&finalSlot===null,
  'offline one-use native resume wrong '+JSON.stringify({before,resumed,finalSlot}));
 const q=await context.newPage();watch(q);
 await q.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await q.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene')._suspendStatus==='empty',null,{timeout:30000});
 assert.equal(await slotRead(q),null,'competing tab observed spent save');
 actions.push('offline-reopen-empty');
 assert.deepEqual(errors,[]);
 assert(!outbound.some(x=>!x.startsWith('GET:')&&!x.startsWith('HEAD:')),'outbound mutating request attempted');
 console.log('PASS_COMPILED_PWA_OFFLINE_BIOME_MASK_RESUME',JSON.stringify({
  installed,before:{runId:before.runId,tick:before.tick,biomeMask:before.biomeMask},saved,
  offlineColdOpen:true,resumed,slotEmpty:true,actions,errors,outbound,
 }));
 await context.close();
 }
}finally{
 await browser?.close();
 if(server)await new Promise(done=>server.close(done));
}
