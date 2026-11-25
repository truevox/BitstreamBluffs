/** Real built game A -> B worker upgrade with two live clients and offline reopen. */
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
const [oldRoot,newRoot,base='/BitstreamBluffs/']=process.argv.slice(2);
if(!oldRoot||!newRoot||!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))throw Error('Usage: test-real-preview-worker-update OLD_DIST NEW_DIST BASE');
let version='a',browser,server;const roots={a:resolve(oldRoot),b:resolve(newRoot)};
const html=await Promise.all(['a','b'].map(id=>readFile(resolve(roots[id],'index.html'),'utf8')));
const shellScript=html.map(h=>h.match(/src="[^" ]*\/assets\/main-[^" ]+\.js"/)?.[0]);
if(!shellScript[0]||!shellScript[1]||shellScript[0]===shellScript[1])throw Error('Different version bundles required');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.bin':'application/octet-stream','.woff2':'font/woff2'};
server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=url.pathname===base?base+'index.html':url.pathname;
 if(!path.startsWith(base)){res.writeHead(404).end('outside scope');return;}
 const rel=path.slice(base.length);if(!rel||rel.split('/').some(p=>!p||p==='.'||p==='..')){res.writeHead(404).end('unsafe path');return;}
 const root=roots[version],file=resolve(root,rel);if(!file.startsWith(root+sep)){res.writeHead(403).end('outside root');return;}
 try{const info=await stat(file);if(!info.isFile())throw Error('Not a file');const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(body);}catch{res.writeHead(404).end('missing');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'allow',viewport:{width:1000,height:540}}),errors=[];
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+base,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:30000});await p.evaluate(()=>navigator.serviceWorker.ready);
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&navigator.serviceWorker.controller,null,{timeout:30000});
 const q=await ctx.newPage();q.on('pageerror',e=>errors.push(e.message));await q.goto(origin+base,{waitUntil:'domcontentloaded'});await q.waitForFunction(()=>navigator.serviceWorker.controller&&window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:30000});
 await p.evaluate(()=>localStorage.setItem('bb-upgrade-proof','run-and-settings-keep'));
 const activeA=await p.evaluate(async()=>({worker:(await navigator.serviceWorker.getRegistration()).active.state,cacheNames:await caches.keys(),script:document.querySelector('script[type="module"]')?.src}));
 if(!activeA.script?.includes('main-')||!activeA.script.includes(shellScript[0].match(/main-[^" ]+\.js/)?.[0]))throw Error('First client is not running build A');
 version='b';
 const update=await p.evaluate(async()=>{
  const reg=await navigator.serviceWorker.getRegistration();await reg.update();
  for(let i=0;i<200;i++){if(reg.waiting?.state==='installed')return {waiting:reg.waiting.state,active:reg.active.state};await new Promise(r=>setTimeout(r,100));}
  throw Error('New worker failed to install and wait');
 });
 if(update.waiting!=='installed')throw Error('B did not wait');
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&navigator.serviceWorker.controller,null,{timeout:30000});
 const protectedA=await p.evaluate(async()=>({script:document.querySelector('script[type="module"]')?.src,save:localStorage.getItem('bb-upgrade-proof'),waiting:(await navigator.serviceWorker.getRegistration()).waiting?.state,cacheNames:await caches.keys()}));
 if(!protectedA.script?.includes(shellScript[0].match(/main-[^" ]+\.js/)?.[0])||protectedA.save!=='run-and-settings-keep'||protectedA.waiting!=='installed')throw Error('Old live client lost A or update activated too early');
 await p.close();const qStill=await q.evaluate(async()=>({waiting:(await navigator.serviceWorker.getRegistration()).waiting?.state,save:localStorage.getItem('bb-upgrade-proof')}));if(qStill.waiting!=='installed')throw Error('B activated before second tab closed');
 await q.close();
 await new Promise(r=>setTimeout(r,500));await ctx.setOffline(true);
 const cold=await ctx.newPage();cold.on('pageerror',e=>errors.push(e.message));await cold.goto(origin+base,{waitUntil:'domcontentloaded'});await cold.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&navigator.serviceWorker.controller,null,{timeout:30000});
 const activeB=await cold.evaluate(async()=>({script:document.querySelector('script[type="module"]')?.src,save:localStorage.getItem('bb-upgrade-proof'),cacheNames:await caches.keys(),worker:(await navigator.serviceWorker.getRegistration()).active.state,controller:!!window.__bbGame.registry.get('offlineMusicDownloads')}));
 if(!activeB.script?.includes(shellScript[1].match(/main-[^" ]+\.js/)?.[0])||activeB.save!=='run-and-settings-keep'||!activeB.controller||activeB.cacheNames.filter(s=>s.startsWith('bitstream-shell-v1-')).length<2||errors.length)throw Error('Cold offline upgrade did not preserve both shells and data '+JSON.stringify({activeA,update,protectedA,qStill,activeB,errors}));
 console.log('PASS_REAL_TWO_VERSION_UPGRADE',JSON.stringify({activeA,update,protectedA,qStill,activeB,errors}));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
