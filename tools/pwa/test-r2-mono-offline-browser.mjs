/** Explicit developer smoke: actual local mono derivatives, never published. */
import {readFile,mkdtemp,rm,copyFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,preview} from 'vite';
import {chromium} from 'playwright';
import {planPublishedMusic} from './r2-release-plan.mjs';
import {planR2Tiers} from './r2-tier-plan.mjs';
import {generateOfflineWorker} from './build-offline-worker.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),source=process.env.BSB_PUBLICATION_ROOT;
if(!source)throw Error('Set BSB_PUBLICATION_ROOT to the verified release source');
const inv=JSON.parse(await readFile(resolve(source,'publication-330-inventory.json'))),catalog=await readFile(resolve(source,'publication-330-catalog.json'));
const tracks=JSON.parse(catalog).tracks,chosen=tracks.find(t=>t.title.includes('One More Run'))||tracks[0];
const selected=Object.fromEntries(tracks.map(t=>[t.id,t.id===chosen.id]));
const pack=inv.objects.find(x=>x.key===chosen.manifest);
const bytes=pack.origin==='released-git'?execFileSync('git',['show',inv.publicBaseCommit+':public/music/'+pack.key],{cwd:root}):await readFile(resolve(source,inv.source,pack.key));
const plan=planPublishedMusic(inv,catalog,{[chosen.id]:bytes},{selection:selected});
const pilot=process.env.BSB_MONO_PILOT;if(!pilot)throw Error('Set BSB_MONO_PILOT');
const manifests=Object.fromEntries(await Promise.all(['lite','full'].map(async q=>[q,JSON.parse(await readFile(resolve(pilot,q+'-manifest.json')))])));
const tiers=planR2Tiers(plan,manifests,'high');
const monoModule='data:text/javascript;base64,'+(await readFile(resolve(root,'tools/pwa/r2-mono-dev-cache.mjs'))).toString('base64');
const moduleUrl='data:text/javascript;base64,'+(await readFile(resolve(root,'tools/pwa/r2-cache.mjs'))).toString('base64');
const base='/BitstreamBluffs/',scratch=await mkdtemp(resolve(root,'.pwa-r2-test-'));let browser,server;
try{
 await build({root,base,build:{outDir:scratch,emptyOutDir:true}});await generateOfflineWorker(scratch,base,{monoDev:true});
 for(const g of tiers.groups)for(const e of g.entries){if(!e.objectKey)continue;const dest=resolve(scratch,e.objectKey);await mkdir(dirname(dest),{recursive:true});await copyFile(resolve(pilot,'derivatives',e.objectKey),dest);}
 server=await preview({root,base,build:{outDir:scratch},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1000,height:540}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
 await page.evaluate(async base=>{await navigator.serviceWorker.register(base+'sw.js',{scope:base,updateViaCache:'none'});await navigator.serviceWorker.ready;},base);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:30000});
 const metadata=plan.groups.map(g=>{const entries=g.entries.filter(e=>!e.url.endsWith('.ogg'));return {...g,entries,version:createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0,20)};}).filter(g=>g.entries.length);
 const downloaded=await page.evaluate(async({moduleUrl,monoModule,plan,metadata,tiers,base})=>{const m=await import(moduleUrl),t=await import(monoModule),opts={storage:caches,origin:location.origin,scope:base,subtle:crypto.subtle,consent:true,fetcher:fetch.bind(window),concurrency:6};const groups=[await m.catalogCacheGroup(plan.catalog,crypto.subtle),...metadata];for(const g of groups)await m.downloadR2Group(g,opts);const lite=await t.stageMonoTier(tiers.groups,'lite',opts);const full=await t.stageMonoTier(tiers.groups,'full',opts);await t.activateMonoTier('lite',tiers.groups,{...opts,stopped:true});return {lite,full};},{moduleUrl,monoModule,plan,metadata,tiers,base});
 console.log('MONO_CANDIDATE_DOWNLOAD',JSON.stringify(downloaded));
 await context.setOffline(true);await page.close();const cold=await context.newPage();cold.on('pageerror',e=>errors.push(e.message));await cold.goto(origin+base,{waitUntil:'domcontentloaded'});
 await cold.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?._stemMusic?.ready,null,{timeout:30000});
 const observed=await cold.evaluate(async({monoModule,tiers,base,selected,id})=>{
   const t=await import(monoModule),audio=window.__bbGame.registry.get('audioSynth'),p=audio._stemMusic,opts={storage:caches,origin:location.origin,scope:base,subtle:crypto.subtle};
   const entry=q=>tiers.groups.find(g=>g.quality===q).entries.find(e=>e.objectKey?.endsWith('-bass.ogg'));
   const verify=async q=>{const e=entry(q),r=await fetch(e.logicalUrl,{cache:'no-store'}),b=await r.arrayBuffer(),h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');if(!r.ok||h!==e.sha256)throw Error('Wrong routed '+q);return h;};
   const play=async q=>{const hash=await verify(q);audio.applySettings({...audio.settings,musicEnabledSongs:selected,dynamicOrchestra:false});if(!audio.jukeboxPlay())throw Error('Cannot play '+q);for(let i=0;i<300;i++){if(p.track?.id===id&&p.clockStart!==null&&p.cache.size>=7){const channels=[...new Set([...p.cache.values()].map(b=>b.numberOfChannels))];if(channels.length!==1||channels[0]!==1||p.transportSnapshot().state!=='playing'||audio._musicTimer)throw Error('Wrong mono engine state '+q);return {quality:q,hash,channels,buffers:p.cache.size,state:p.transportSnapshot().state};}await new Promise(r=>setTimeout(r,100));}throw Error('Playback timeout '+q);};
   const lite=await play('lite');let blocked=false;try{await t.activateMonoTier('full',tiers.groups,{...opts,stopped:false});}catch{blocked=true;}if(!blocked)throw Error('Unsafe promotion not blocked');
   const stop=()=>{audio.stopMusic();if(p.started||p.cache.size||p.activeNodes.size)throw Error('Transport not stopped');};stop();await t.activateMonoTier('full',tiers.groups,{...opts,stopped:true});const full=await play('full');stop();await t.activateMonoTier('lite',tiers.groups,{...opts,stopped:true});const saver=await play('lite');stop();await t.activateMonoTier(null,tiers.groups,opts);const off=(await fetch(entry('lite').logicalUrl,{cache:'no-store'})).status;return {catalog:p.catalog.length,lite,full,saver,blocked,off};
 },{monoModule,tiers,base,selected,id:chosen.id});
 if(observed.catalog!==33||observed.off!==503||errors.length)throw Error(JSON.stringify({observed,errors}));
 await cold.reload({waitUntil:'domcontentloaded'});await cold.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
 const coldOff=await cold.evaluate(async url=>(await fetch(url,{cache:'no-store'})).status,tiers.groups[0].entries.find(e=>e.objectKey).logicalUrl);if(coldOff!==503)throw Error('No Music not retained');
 console.log('PASS_R2_MONO_OFFLINE_PLAYBACK',JSON.stringify({observed,coldOff,errors}));
}finally{if(browser)await browser.close();if(server)await new Promise((res,rej)=>server.httpServer.close(e=>e?rej(e):res()));await rm(scratch,{recursive:true,force:true});}
