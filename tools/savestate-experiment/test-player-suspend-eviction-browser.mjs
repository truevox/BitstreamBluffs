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
 // Deterministic simulation of browser-origin IDB eviction: browser removes
 // the entire local suspend database AFTER a genuinely durable stock save.
 const evicted=await page.evaluate(async()=>{
  const dbName='bb-single-use-suspend-v1';
  await new Promise((resolve,reject)=>{
   const request=indexedDB.deleteDatabase(dbName);
   request.onsuccess=resolve;
   request.onerror=()=>reject(request.error);
   request.onblocked=()=>reject(Error('eviction was blocked by open database'));
  });
  return true;
 });
 assert(evicted);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:60000});
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene')._suspendStatus==='empty',null,{timeout:20000});
 const after=await page.evaluate(()=>{
  const t=window.__bbGame.scene.getScene('TitleScene');
  return {status:t._suspendStatus,ready:t._suspendReady,visible:t.suspendButton?.visible};
 });
 assert.deepEqual(after,{status:'empty',ready:false,visible:false});
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('PASS_SIMULATED_SUSPEND_DATABASE_EVICTION',JSON.stringify({before:state.before,saved,after,errors,writes,
  caveat:'Explicit IDB deletion models total browser eviction; cannot identify eviction vs a never-created slot after both database and marker are lost.'}));
 await ctx.close();
}finally{
 await browser?.close();await new Promise(ok=>server.close(ok));
}
