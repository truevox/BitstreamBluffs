/** Browser viewport acceptance, not actual-device performance certification. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
const dist=process.argv[2];if(!dist)throw Error('Built preview dist required');
const root=fileURLToPath(new URL('../../',import.meta.url)),base='/BitstreamBluffs/';let browser,server;
try{
 server=await preview({root,base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const url='http://127.0.0.1:'+server.httpServer.address().port+base;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const devices=[{label:'desktop',viewport:{width:1366,height:768},deviceScaleFactor:1},{label:'chromebook',viewport:{width:1024,height:600},deviceScaleFactor:1.25},{label:'phone-landscape',viewport:{width:844,height:390},deviceScaleFactor:2,hasTouch:true,isMobile:true}];
 const receipts=[];
 for(const device of devices){const {label,...cfg}=device,ctx=await browser.newContext({...cfg,serviceWorkers:'allow'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));try{
  await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.registry?.get('offlineMusicDownloads')&&navigator.serviceWorker.controller,null,{timeout:30000});
  const before=await page.evaluate(async()=>{const rect=document.querySelector('canvas')?.getBoundingClientRect();const m=await fetch('manifest.webmanifest');return {scope:(await navigator.serviceWorker.getRegistration())?.scope,controller:!!window.__bbGame.registry.get('offlineMusicDownloads'),title:window.__bbGame.scene.isActive('TitleScene'),manifest:m.ok&&((await m.json()).display==='standalone'),canvas:rect?{width:rect.width,height:rect.height,left:rect.left,top:rect.top}:null,innerWidth,innerHeight};});
  await ctx.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&!!window.__bbGame?.registry?.get('offlineMusicDownloads'),null,{timeout:30000});
  const after=await page.evaluate(()=>({title:window.__bbGame.scene.isActive('TitleScene'),controlled:!!navigator.serviceWorker.controller,catalog:window.__bbGame.registry.get('audioSynth')?._stemMusic?.catalog?.length||0}));
  if(!before.controller||!before.title||!before.manifest||!before.canvas||before.canvas.width<=0||before.canvas.height<=0||!after.title||!after.controlled||errors.length)throw Error('Viewport regression '+JSON.stringify({before,after,errors}));
  receipts.push({label,before,after,errors});
 }finally{await ctx.close();}}
 console.log('PASS_PREVIEW_VIEWPORTS',JSON.stringify(receipts));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
