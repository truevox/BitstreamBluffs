/** Chromium-origin PWA manifest/CDP installability audit. No installation or publish. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
import {assertInstallability} from './installability-assert.mjs';
const dir=process.argv[2],base=process.argv[3]||'/BitstreamBluffs/';if(!dir||!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))throw Error('Usage: test-installability-browser DIST [BASE]');
const root=fileURLToPath(new URL('../../',import.meta.url));let server,browser;
try{
 server=await preview({root,base,build:{outDir:resolve(dir)},preview:{host:'127.0.0.1',port:0,strictPort:true}});const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({serviceWorkers:'allow',viewport:{width:1366,height:768}}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:30000});
 const client=await ctx.newCDPSession(page);const manifest=await client.send('Page.getAppManifest');const installability=await client.send('Page.getInstallabilityErrors');assertInstallability(manifest,installability,{allowIncognito:true});
 const meta=await page.evaluate(()=>{const link=document.querySelector('link[rel="manifest"]');return{manifestUrl:link?.href,controlled:!!navigator.serviceWorker.controller,scope:new URL(navigator.serviceWorker.controller.scriptURL).pathname}});
 const parsed=JSON.parse(manifest.data||'{}');const actualStart=new URL(parsed.start_url,meta.manifestUrl).href,actualScope=new URL(parsed.scope,meta.manifestUrl).href;
 const receipt={meta,actualStart,actualScope,manifestErrors:manifest.errors,installabilityErrors:installability?.installabilityErrors??installability,icons:parsed.icons?.length,errors};
 if(actualStart!==origin+base||actualScope!==origin+base||manifest.errors?.length||errors.length)throw Error('Manifest scope/installability mismatch '+JSON.stringify(receipt));
 console.log('PASS_CHROMIUM_MANIFEST',JSON.stringify(receipt));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
