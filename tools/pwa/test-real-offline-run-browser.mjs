/** Offline PWA acceptance: real local physics, pause/resume and original music. */
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
import {isBenignOptionalIconAbort} from './offline-request-failure-policy.mjs';
const [dist,inventoryPath,base='/BitstreamBluffs/']=process.argv.slice(2);if(!dist||!inventoryPath)throw Error('Usage: test-real-offline-run-browser BUILT_DIST VERIFIED_INVENTORY BASE');
let catalog;
if(inventoryPath.endsWith('.bin')){
 const index=JSON.parse(gunzipSync(await readFile(inventoryPath)));
 if(index.format!=='bb-melody-runtime-index-v1'||!index.release.startsWith('https://bsb-audio.bearcave.win/releases/'))throw Error('Wrong compressed catalog index');
 const r=await fetch(index.release+'catalog.json',{redirect:'error'});
 if(!r.ok)throw Error('Published release catalog unavailable');
 const raw=Buffer.from(await r.arrayBuffer());
 if(raw.length!==index.catalog[0]||createHash('sha256').update(raw).digest('hex')!==index.catalog[1])throw Error('Published catalog violates release integrity');
 catalog=JSON.parse(raw);
}else{
 const inventory=JSON.parse(await readFile(inventoryPath)),objects=new Map(inventory.objects.map(e=>[e.key,e]));
 catalog=JSON.parse(await readFile(objects.get('catalog.json').path));
}
const song=catalog.tracks.find(t=>t.title.includes('One More Run'))||catalog.tracks[0];
const selection=Object.fromEntries(catalog.tracks.map(t=>[t.id,t.id===song.id]));
const root=fileURLToPath(new URL('../../',import.meta.url));let browser,server;
try{
 server=await preview({root,base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'allow',viewport:{width:1000,height:540}}),errors=[],sameOriginFailures=[],benignIconAborts=[];
 const optionalIconPath=new URL('icons/apple-touch-icon.png',origin+base).pathname;
 const recordFailure=r=>{try{
  const u=new URL(r.url());if(u.origin!==origin)return;
  const error=r.failure()?.errorText;
  if(isBenignOptionalIconAbort(u.pathname,error,optionalIconPath)){
   benignIconAborts.push({url:u.pathname,error});return;
  }
  sameOriginFailures.push({url:u.pathname,error});
 }catch{/* A non-URL request cannot be classified as a same-origin resource. */}};
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',recordFailure);
 await page.addInitScript(selection=>{if(!localStorage.getItem('bb.settings'))localStorage.setItem('bb.settings',JSON.stringify({musicEnabledSongs:selection,offlineMusicQuality:'space-saver'}));},selection);
 await page.goto(origin+base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&!!window.__bbGame.registry.get('offlineMusicDownloads'),null,{timeout:30000});
 const installed=await page.evaluate(async()=>{const g=window.__bbGame,c=g.registry.get('offlineMusicDownloads'),a=g.registry.get('audioSynth');const result=await c.start({consent:true});if(!result.ready)throw Error('Cannot download real required recordings: '+JSON.stringify(result));a.stopMusic();await c.apply();if(c.quality!=='lite')throw Error('Lite not applied');return {quality:c.quality,groups:c.plan.groups.length,keys:(await caches.keys()).filter(k=>k.startsWith('bb-r2-recordings')).length};});
 await page.close();await ctx.setOffline(true);
 const cold=await ctx.newPage();cold.on('pageerror',e=>errors.push(e.message));cold.on('requestfailed',recordFailure);
 await cold.goto(origin+base,{waitUntil:'domcontentloaded'});await cold.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&!!window.__bbGame.registry.get('offlineMusicDownloads')&&window.__bbGame.registry.get('audioSynth')?._stemMusic?.ready,null,{timeout:30000});
 await cold.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('pwa-physical-offline-local-run'));
 await cold.waitForFunction(()=>window.__bbGame?.scene?.isActive('RunScene')&&!!window.__bbGame.scene.getScene('RunScene').sled?.body,null,{timeout:30000});
 const first=await cold.evaluate(()=>{const g=window.__bbGame,r=g.scene.getScene('RunScene');return {time:r.runTimeMs,x:r.sled.x,y:r.sled.y,physics:!!r.matter?.world?.engine,audioReady:g.registry.get('audioSynth')._stemMusic?.ready};});
 await cold.waitForTimeout(1500);
 const second=await cold.evaluate(()=>{const g=window.__bbGame,r=g.scene.getScene('RunScene'),a=g.registry.get('audioSynth'),d=a._stemMusic;return {active:g.scene.isActive('RunScene'),crashed:r.crashed,time:r.runTimeMs,x:r.sled?.x,y:r.sled?.y,distance:r.score?.distanceM,physics:!!r.matter?.world?.engine,audio:{catalog:d.catalog.length,track:d.track?.id,buffers:d.cache.size,channels:[...new Set([...d.cache.values()].map(b=>b.numberOfChannels))],state:d.transportSnapshot().state,procedural:!!a._musicTimer,ctx:a.ctx?.state}};});
 if(!second.active||second.time<=first.time||!Number.isFinite(second.x)||Math.abs(second.x-first.x)<1||!second.physics||second.audio.catalog!==33||second.audio.procedural||errors.length||sameOriginFailures.length)throw Error('Offline local run not advancing '+JSON.stringify({first,second,errors,sameOriginFailures}));
 await cold.evaluate(()=>window.__bbGame.scene.getScene('RunScene').pauseRun());
 await cold.waitForFunction(()=>window.__bbGame?.scene?.isActive('PauseScene'),null,{timeout:12000});
 const paused=await cold.evaluate(()=>{const g=window.__bbGame,r=g.scene.getScene('RunScene');return {runPaused:r.sys.isPaused(),pauseActive:g.scene.isActive('PauseScene'),time:r.runTimeMs};});
 if(!paused.runPaused||!paused.pauseActive)throw Error('Offline gameplay pause failed '+JSON.stringify(paused));
 await cold.evaluate(()=>window.__bbGame.scene.getScene('PauseScene').resume());await cold.waitForFunction(()=>window.__bbGame?.scene?.isActive('RunScene')&&!window.__bbGame.scene.isActive('PauseScene'),null,{timeout:12000});
 await cold.waitForTimeout(400);
 const resumed=await cold.evaluate(()=>{const r=window.__bbGame.scene.getScene('RunScene');return {time:r.runTimeMs,x:r.sled?.x,active:r.scene.isActive()};});
 if(!resumed.active||resumed.time<=paused.time||errors.length||sameOriginFailures.length)throw Error('Offline resume failed '+JSON.stringify({resumed,paused,errors,sameOriginFailures}));
 console.log('PASS_PWA_REAL_OFFLINE_GAMEPLAY',JSON.stringify({installed,first,second,paused,resumed,errors,sameOriginFailures,benignIconAborts}));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
