/** Developer-only real built-shell cold-offline smoke. No worker is registered on a public origin. */
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,preview} from 'vite';
import {chromium} from 'playwright';
import {generateOfflineWorker} from './build-offline-worker.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const scratch=await mkdtemp(resolve(root,'.pwa-shell-test-'));
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 for(const base of ['/','/BitstreamBluffs/']){
  const outDir=resolve(scratch,base==='/'?'root':'subpath');
  await build({root,base,build:{outDir,emptyOutDir:true}});
  const inventory=await generateOfflineWorker(outDir,base);
  const server=await preview({root,base,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:true}});
  const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1000,height:540}});
  try{
   const origin='http://127.0.0.1:'+server.httpServer.address().port;
   await context.route('https://bsb-audio.bearcave.win/**',route=>route.abort());
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+base,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
   await page.evaluate(async base=>{
    await navigator.serviceWorker.register(base+'sw.js',{scope:base,updateViaCache:'none'});
    await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('worker install timeout')),30000))]);
   },base);
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:30000});
   await context.setOffline(true);
   await page.close();
   const cold=await context.newPage();cold.on('pageerror',e=>errors.push(e.message));
   await cold.goto(origin+base,{waitUntil:'domcontentloaded'});
   await cold.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
   const observed=await cold.evaluate(async base=>({controlled:!!navigator.serviceWorker.controller,scope:(await navigator.serviceWorker.ready).scope,cacheNames:await caches.keys(),manifest:(await fetch(base+'manifest.webmanifest')).ok}),base);
   if(!observed.controlled||observed.scope!==origin+base||!observed.manifest||errors.length)throw Error(JSON.stringify({base,observed,errors}));
   console.log('PASS_OFFLINE_SHELL',JSON.stringify({base,bytes:inventory.totalBytes,entries:inventory.entries.length,observed,errors}));
  }finally{await context.close();await new Promise((res,rej)=>server.httpServer.close(e=>e?rej(e):res()));}
 }
}finally{if(browser)await browser.close();await rm(scratch,{recursive:true,force:true});}
