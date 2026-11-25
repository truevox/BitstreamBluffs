/** Explicit developer smoke: actual R2 melody release derivatives, no production registration. */
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,preview} from 'vite';
import {chromium} from 'playwright';
import {planMelodyRelease} from './melody-release-plan.mjs';
import {generateOfflineWorker} from './build-offline-worker.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),source=process.env.BSB_MELODY_INVENTORY;
if(!source)throw Error('Set BSB_MELODY_INVENTORY to the verified candidate inventory');
const inv=JSON.parse(await readFile(source)),index=new Map(inv.objects.map(e=>[e.key,e]));
const read=k=>readFile(index.get(k).path),catalog=JSON.parse(await read('catalog.json'));
const chosen=catalog.tracks.find(t=>t.title.includes('One More Run'))||catalog.tracks[0];
const selected=Object.fromEntries(catalog.tracks.map(t=>[t.id,t.id===chosen.id]));
const tiers=await planMelodyRelease(inv,read,{selection:selected},'high');
const moduleUrl='data:text/javascript;base64,'+(await readFile(resolve(root,'tools/pwa/r2-cache.mjs'))).toString('base64');
const monoModule='data:text/javascript;base64,'+Buffer.from((await readFile(resolve(root,'tools/pwa/melody-tier-cache.mjs'),'utf8')).replace("'./r2-cache.mjs'",JSON.stringify(moduleUrl))).toString('base64');
const base='/BitstreamBluffs/',scratch=await mkdtemp(resolve(root,'.pwa-r2-test-'));let browser,server;
try{
 await build({root,base,build:{outDir:scratch,emptyOutDir:true}});await generateOfflineWorker(scratch,base,{melodyDev:true});
 server=await preview({root,base,build:{outDir:scratch},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1000,height:540}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
 await page.evaluate(async base=>{await navigator.serviceWorker.register(base+'sw.js',{scope:base,updateViaCache:'none'});await navigator.serviceWorker.ready;},base);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:30000});
 const downloaded=await page.evaluate(async({monoModule,tiers,base})=>{const t=await import(monoModule),opts={storage:caches,origin:location.origin,scope:base,subtle:crypto.subtle,consent:true,fetcher:fetch.bind(window),concurrency:6};const lite=await t.stagePublishedMelody(tiers,'lite',opts);const full=await t.stagePublishedMelody(tiers,'full',opts);await t.activatePublishedMelody(tiers,'lite',{...opts,stopped:true});return {lite,full};},{monoModule,tiers,base});
 console.log('MONO_CANDIDATE_DOWNLOAD',JSON.stringify(downloaded));
 await context.setOffline(true);await page.close();const cold=await context.newPage();cold.on('pageerror',e=>errors.push(e.message));await cold.goto(origin+base,{waitUntil:'domcontentloaded'});
 await cold.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?._stemMusic?.ready,null,{timeout:30000});
 const observed=await cold.evaluate(async({monoModule,tiers,base,selected,id})=>{
   const t=await import(monoModule),audio=window.__bbGame.registry.get('audioSynth'),p=audio._stemMusic,opts={storage:caches,origin:location.origin,scope:base,subtle:crypto.subtle};
   const entry=q=>tiers.groups.find(g=>g.quality===q).entries.find(e=>e.logicalUrl.endsWith('-bass.ogg'));
   const verify=async q=>{const e=entry(q),r=await fetch(e.logicalUrl,{cache:'no-store'}),b=await r.arrayBuffer(),h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');if(!r.ok||h!==e.sha256)throw Error('Wrong routed '+q);return h;};
   const play=async q=>{const hash=await verify(q);audio.applySettings({...audio.settings,musicEnabledSongs:selected,dynamicOrchestra:false});if(!audio.jukeboxPlay())throw Error('Cannot play '+q);for(let i=0;i<300;i++){if(p.track?.id===id&&p.clockStart!==null&&p.cache.size>=7){const channels=[...new Set([...p.cache.values()].map(b=>b.numberOfChannels))];if(channels.length!==1||channels[0]!==1||p.transportSnapshot().state!=='playing'||audio._musicTimer)throw Error('Wrong mono engine state '+q);return {quality:q,hash,channels,buffers:p.cache.size,state:p.transportSnapshot().state};}await new Promise(r=>setTimeout(r,100));}throw Error('Playback timeout '+q);};
   const lite=await play('lite');let blocked=false;try{await t.activatePublishedMelody(tiers,'full',{...opts,stopped:false});}catch{blocked=true;}if(!blocked)throw Error('Unsafe promotion not blocked');
   const stop=()=>{audio.stopMusic();if(p.started||p.cache.size||p.activeNodes.size)throw Error('Transport not stopped');};stop();await t.activatePublishedMelody(tiers,'full',{...opts,stopped:true});const full=await play('full');stop();await t.activatePublishedMelody(tiers,'lite',{...opts,stopped:true});const saver=await play('lite');stop();await t.activatePublishedMelody(tiers,null,{...opts,stopped:true});const off=(await fetch(entry('lite').logicalUrl,{cache:'no-store'})).status;return {catalog:p.catalog.length,lite,full,saver,blocked,off};
 },{monoModule,tiers,base,selected,id:chosen.id});
 if(observed.catalog!==33||observed.off!==503||errors.length)throw Error(JSON.stringify({observed,errors}));
 await cold.reload({waitUntil:'domcontentloaded'});await cold.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
 const coldOff=await cold.evaluate(async url=>(await fetch(url,{cache:'no-store'})).status,tiers.groups[0].entries.find(e=>e.frames).logicalUrl);if(coldOff!==503)throw Error('No Music not retained');
 console.log('PASS_R2_MONO_OFFLINE_PLAYBACK',JSON.stringify({observed,coldOff,errors}));
}finally{if(browser)await browser.close();if(server)await new Promise((res,rej)=>server.httpServer.close(e=>e?rej(e):res()));await rm(scratch,{recursive:true,force:true});}
