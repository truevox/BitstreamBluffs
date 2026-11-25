/** Browser proof: a preview with No Music is silent, not procedurally synthesized. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
const dist=process.argv[2];if(!dist)throw Error('Built candidate dist required');
const root=fileURLToPath(new URL('../../',import.meta.url));let browser,server;
try{
 server=await preview({root,base:'/BitstreamBluffs/',build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const url='http://127.0.0.1:'+server.httpServer.address().port+'/BitstreamBluffs/';
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'allow',viewport:{width:1000,height:540}});const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:30000});await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.registry.get('offlineMusicDownloads')&&window.__bbGame?.registry.get('audioSynth')?._stemMusic?.ready,null,{timeout:30000});
 await page.evaluate(async()=>{const g=window.__bbGame,a=g.registry.get('audioSynth'),c=g.registry.get('offlineMusicDownloads');a.stopMusic();await c.setMode('no-music');await c.apply();await a.unlock();a.stopMusic();});
 await ctx.setOffline(true);
 const observed=await page.evaluate(async()=>{const a=window.__bbGame.registry.get('audioSynth');a.startMusic('offline-missing-source');await new Promise(r=>setTimeout(r,750));return{timer:a._musicTimer===null,proceduralGain:a.nodes?.musicSrc?.gain?.value,mode:window.__bbGame.registry.get('offlineMusicDownloads').mode,ctx:a.ctx?.state,activeOriginalSources:a._stemMusic?.activeNodes?.size||0};});
 if(!observed.timer||observed.ctx!=='running'||(observed.proceduralGain??0)>.05||observed.mode!=='no-music'||errors.length)throw Error('Offline preview not fail-closed '+JSON.stringify({observed,errors}));
 console.log('PASS_OFFLINE_PREVIEW_SILENCE',JSON.stringify({observed,errors}));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
