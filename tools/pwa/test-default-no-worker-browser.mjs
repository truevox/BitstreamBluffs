/** Default build regression: never auto-enable experimental offline capabilities. */
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,preview} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../../',import.meta.url)),dist=await mkdtemp(resolve(root,'.pwa-default-'));
let browser,server;
try{
 await build({root,base:'/BitstreamBluffs/',build:{outDir:dist,emptyOutDir:true}});
 const files=await readdir(dist);
 if(files.includes('sw.js')||files.includes('offline-melody-index.bin'))throw Error('Default build unexpectedly ships experimental offline worker or index');
 server=await preview({root,base:'/BitstreamBluffs/',build:{outDir:dist},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/BitstreamBluffs/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
 const result=await page.evaluate(async()=>({controller:!!window.__bbGame.registry.get('offlineMusicDownloads'),registrations:(await navigator.serviceWorker.getRegistrations()).length}));
 if(result.controller||result.registrations||errors.length)throw Error('Default build opted into PWA: '+JSON.stringify({result,errors}));
 console.log('PASS_DEFAULT_NO_AUTO_PWA',JSON.stringify({result,errors}));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));await rm(dist,{recursive:true,force:true});}
