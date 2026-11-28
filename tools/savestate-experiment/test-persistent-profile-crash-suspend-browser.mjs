/**
 * #424: actual Chromium *process* crash, not just a tab close or navigation.
 * Production-minified, installed PWA, unique temporary on-disk user profile.
 * Save a genuinely paused stock run; crash the browser process; restart a
 * completely new Chromium process using the exact profile, OFFLINE; physically
 * resume once with original recorder identity/tick, then prove slot consumed.
 *
 * An abrupt process crash is a reproducible proxy for a browser termination.
 * It does NOT prove device power-loss fsync or real OS disk-pressure eviction.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,extname} from 'node:path';
import {chromium} from 'playwright';

const root=resolve(process.argv[2]||'dist');
assert((await stat(resolve(root,'index.html'))).isFile(),'compiled game missing');
assert((await stat(resolve(root,'sw.js'))).isFile(),'offline PWA worker missing');
const profile=await mkdtemp(join(tmpdir(),'bsb424-unclean-chromium-'));
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json',
 '.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json',
 '.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2',
 '.bin':'application/octet-stream'};
const errors=[],outbound=[];
let server,context;
const watch=p=>p.on('pageerror',e=>errors.push(e.message));
const runPoint=(page,kind)=>page.evaluate(kind=>{
 const g=window.__bbGame;
 let obj;
 if(kind==='suspend'){
  const p=g.scene.getScene('PauseScene'),i=p.menu.items.findIndex(i=>i.label==='SUSPEND RUN');
  if(i<0||!p.canSuspend)throw Error('stock Pause cannot Suspend');
  obj=p.menu.rows[i].zone;
  const xy=obj.getWorldTransformMatrix().transformPoint(obj.width/2,obj.height/2);
  const r=g.canvas.getBoundingClientRect();
  return {x:r.x+xy.x*r.width/g.scale.gameSize.width,
   y:r.y+xy.y*r.height/g.scale.gameSize.height};
 }
 obj=g.scene.getScene('TitleScene').suspendButton;
 if(!obj?.visible||obj?.disabled||obj.label?.main?.text!=='R RESUME SAVE')
  throw Error('original READY not available on Title');
 const xy=obj.getWorldTransformMatrix().transformPoint(obj.w/2,obj.h/2),r=g.canvas.getBoundingClientRect();
 return {x:r.x+xy.x*r.width/g.scale.gameSize.width,
  y:r.y+xy.y*r.height/g.scale.gameSize.height};
},kind);
const slot=page=>page.evaluate(async()=>new Promise((yes,no)=>{
 const req=indexedDB.open('bb-single-use-suspend-v1',1);
 req.onerror=()=>no(req.error);
 req.onsuccess=()=>{
  const db=req.result,tx=db.transaction('slots','readonly'),q=tx.objectStore('slots').get('local-suspend');
  q.onerror=()=>{db.close();no(q.error);};
  q.onsuccess=async()=>{
   try{
    const row=q.result;
    if(!row){yes(null);return;}
    const bytes=Uint8Array.from(row.bytes),hash=await crypto.subtle.digest('SHA-256',bytes);
    yes({status:row.status,runId:row.runId,tick:row.tick,length:bytes.length,
     digest:Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')});
   }catch(error){no(error);}finally{db.close();}
  };
 };
}));
const options={headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
 viewport:{width:960,height:540},serviceWorkers:'allow',
 args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']};
const launch=()=>chromium.launchPersistentContext(profile,options);
try{
 server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname,
   rel=pathname==='/'?'index.html':pathname.slice(1),file=resolve(root,rel);
  if(!rel||rel.split('/').some(x=>!x||x==='.'||x==='..')||!file.startsWith(root+sep)){
   res.writeHead(403).end();return;
  }
  try{
   if(!(await stat(file)).isFile())throw Error('missing');
   res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream',
    'Cache-Control':'no-store'}).end(await readFile(file));
  }catch{res.writeHead(404).end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+server.address().port;
 // Record only external HTTP(S) requests, not local blob: media URLs.
 const watchRequests=ctx=>ctx.on('request',req=>{
  if(!req.url().startsWith(origin+'/')&&/^https?:/.test(req.url()))
   outbound.push(req.method()+':'+req.url());
 });
 context=await launch();watchRequests(context);
 const p=context.pages()[0]||await context.newPage();watch(p);
 await p.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:60000});
 await p.evaluate(()=>navigator.serviceWorker.ready);
 await p.reload({waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  navigator.serviceWorker.controller,null,{timeout:35000});
 const installed=await p.evaluate(async()=>({controller:!!navigator.serviceWorker.controller,
  cacheKeys:(await caches.keys()).filter(k=>k.startsWith('bitstream-shell-v1-'))}));
 assert(installed.controller&&installed.cacheKeys.length,'not a real installed PWA');
 await p.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('real-browser-process-crash'));
 await p.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene')&&
  window.__bbGame.scene.getScene('RunScene').simClock?.tick>=180,null,{timeout:80000});
 await p.evaluate(()=>window.__bbGame.scene.getScene('RunScene').pauseRun());
 await p.waitForFunction(()=>window.__bbGame.scene.isActive('PauseScene')&&
  window.__bbGame.scene.getScene('PauseScene').canSuspend===true,null,{timeout:20000});
 await p.waitForTimeout(650);
 const original=await p.evaluate(()=>{
  const r=window.__bbGame.scene.getScene('RunScene');
  return {runId:r.runId,tick:r.simClock.tick,paused:r.scene.isPaused('RunScene')};
 });
 assert(original.paused);
 const pt=await runPoint(p,'suspend');await p.mouse.click(pt.x,pt.y);
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene')._suspendReady===true,null,{timeout:30000});
 const before=await slot(p);
 assert(before?.status==='ready'&&before.runId===original.runId&&
  before.tick===original.tick&&before.length>60000&&before.digest.length===64,
  'real IDB READY not durable before process crash '+JSON.stringify({original,before}));

 // Crash the *browser* process; deliberately do not close the page/context.
 const closed=new Promise(done=>context.once('close',done));
 const cdp=await context.newCDPSession(p);
 const crashed=cdp.send('Browser.crash').then(()=>false,e=>true);
 await Promise.race([closed,new Promise((_,no)=>setTimeout(()=>no(Error('Chromium process did not crash')),20000))]);
 const transportDropped=await crashed;
 assert(transportDropped,'Browser.crash unexpectedly returned normally');
 context=null;

 // Same disk profile, different browser process. Network is offline BEFORE
 // navigation. The installed worker must provide the shell from disk.
 context=await launch();watchRequests(context);
 await context.setOffline(true);
 const cold=context.pages()[0]||await context.newPage();watch(cold);
 await cold.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:35000});
 await cold.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  navigator.serviceWorker.controller&&
  window.__bbGame.scene.getScene('TitleScene')._suspendReady===true,null,{timeout:35000});
 const after=await slot(cold),offline=await cold.evaluate(async()=>({
  controller:!!navigator.serviceWorker.controller,
  cacheKeys:(await caches.keys()).filter(k=>k.startsWith('bitstream-shell-v1-')),
  ready:window.__bbGame.scene.getScene('TitleScene')._suspendReady,
 }));
 assert.deepEqual(after,before,'crash/restart changed the original persisted save');
 assert(offline.controller&&offline.ready&&installed.cacheKeys.every(k=>offline.cacheKeys.includes(k)),
  'offline PWA did not recover from on-disk shell after crash');
 await cold.evaluate(()=>{
  window.__crashResumeEvents=[];
  const g=window.__bbGame;
  g.events.on('bb:runStart',event=>{
   if(event?.resumed)window.__crashResumeEvents.push({runId:event.runId,
    tick:g.scene.getScene('RunScene').simClock.tick});
  });
 });
 const rp=await runPoint(cold,'resume');await cold.mouse.click(rp.x,rp.y);
 await cold.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene')&&
  !window.__bbGame.scene.isActive('TitleScene'),null,{timeout:30000});
 const resumed=await cold.evaluate(()=>({
  runId:window.__bbGame.scene.getScene('RunScene').runId,
  events:window.__crashResumeEvents,
 }));
 assert(resumed.runId===original.runId&&resumed.events.length===1&&
  resumed.events[0].runId===original.runId&&resumed.events[0].tick===original.tick,
  'offline resumed run differs after browser process crash '+JSON.stringify(resumed));
 assert.equal(await slot(cold),null,'crash-surviving slot not consumed exactly once');
 assert.deepEqual(errors,[],'browser JS errors');
 assert(outbound.every(v=>v.startsWith('GET:')||v.startsWith('HEAD:')),
  'test generated mutating external traffic');
 console.log('PASS_UNCLEAN_BROWSER_PROCESS_CRASH_OFFLINE_ONE_USE_SUSPEND',JSON.stringify({
  original,before,after,installed,offline,resumed,slotConsumed:true,
  actualBrowserCrash:true,transportDropped,realPersistentProfile:true,
  distinctBrowserProcess:true,networkOfflineBeforeRestartNavigation:true,
  errors,externalRequestCount:outbound.length,externalRequestMethods:[...new Set(outbound.map(v=>v.split(':')[0]))],caveat:'Real abrupt Chromium process crash; not a device power failure, physical Chromebook or OS disk-pressure eviction.',
 }));
}finally{
 try{await context?.close();}catch{}
 try{await new Promise(done=>server?.close(done)||done());}catch{}
 await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:150});
}
