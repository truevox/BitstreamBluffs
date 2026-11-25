/** Explicit developer smoke: actual in-game tier menu and R2 melody release derivatives, no production registration. */
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
const moduleData=async(name,replacements={})=>{let text=await readFile(resolve(root,'tools/pwa',name),'utf8');for(const [p,u] of Object.entries(replacements))text=text.replace(JSON.stringify(p),JSON.stringify(u)).replace("'"+p+"'",JSON.stringify(u));return 'data:text/javascript;base64,'+Buffer.from(text).toString('base64');};
const queueUrl=await moduleData('r2-download-controls.mjs',{'./r2-cache.mjs':moduleUrl});
const selectionUrl=await moduleData('r2-tier-selection.mjs');
const controlsUrl=await moduleData('melody-download-controls.mjs',{'./r2-download-controls.mjs':queueUrl,'./melody-tier-cache.mjs':monoModule,'./r2-tier-selection.mjs':selectionUrl});
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
 const downloaded=await page.evaluate(async({controlsUrl,tiers,base,selected})=>{
 const {MelodyDownloadControls}=await import(controlsUrl),game=window.__bbGame,title=game.scene.getScene('TitleScene'),audio=game.registry.get('audioSynth');let calls=0;
 const opts={storage:caches,origin:location.origin,scope:base,worker:navigator.serviceWorker.controller,subtle:crypto.subtle,fetcher:(...args)=>{calls++;return fetch(...args);}};
 const c=new MelodyDownloadControls({plan:tiers,options:opts,estimate:()=>navigator.storage.estimate(),isStopped:()=>!audio._stemMusic.started&&!audio._stemMusic.cache.size&&!audio._stemMusic.activeNodes.size});
 const activate=(menu,label)=>{const i=menu.items.findIndex(x=>x.label===label);if(i<0)throw Error('Missing menu item '+label);menu.setSelected(i,true);menu.handleAction('confirm');};
 const wait=async check=>{for(let i=0;i<900;i++){if(check())return;await new Promise(r=>setTimeout(r,100));}throw Error('Menu timeout '+JSON.stringify(c.state));};
 game.registry.set('offlineMusicDownloads',c);activate(title.menu,'SETTINGS');activate(title.view.menu,'MANAGE SOUND');const sound=title.view.soundView;activate(sound.menu,'OFFLINE MUSIC');const view=sound.offlineView;
 await wait(()=>!view.pending&&c.state.status==='download-required');
 activate(view.menu,'MUSIC QUALITY');await wait(()=>!view.pending&&c.mode==='space-saver');activate(view.menu,'MUSIC QUALITY');await wait(()=>!view.pending&&c.mode==='no-music');if(calls!==0||c.state.missingBytes!==0)throw Error('No Music selected transfers');activate(view.menu,'MUSIC QUALITY');await wait(()=>!view.pending&&c.mode==='high');
 activate(view.menu,'CONFIRM DOWNLOAD');if(calls||c.running)throw Error('Disabled confirm transferred');activate(view.menu,'DOWNLOAD / REPAIR');if(calls||c.running||!view.armed)throw Error('Arming transferred');activate(view.menu,'CONFIRM DOWNLOAD');await wait(()=>!view.pending&&c.state.ready);const firstCalls=calls;
 audio.stopMusic();activate(view.menu,'APPLY QUALITY (MUSIC STOPPED)');await wait(()=>!view.pending&&c.quality==='lite');const lite=c.quality;activate(view.menu,'APPLY QUALITY (MUSIC STOPPED)');await wait(()=>!view.pending&&c.quality==='full');const full=c.quality;
 activate(view.menu,'MUSIC QUALITY');await wait(()=>!view.pending&&c.mode==='space-saver');activate(view.menu,'APPLY QUALITY (MUSIC STOPPED)');await wait(()=>!view.pending&&c.quality==='lite');if(calls!==firstCalls)throw Error('Tier switches redownloaded');
 view.handleAction('cancel');if(sound.offlineView!==null)throw Error('Menu close failed');return {lite,full,firstCalls,noAdditionalTransfers:true,ready:c.state.ready};
 },{controlsUrl,tiers,base,selected});
 console.log('TIER_MENU_PASS',JSON.stringify(downloaded));
 await context.setOffline(true);await page.close();const cold=await context.newPage();cold.on('pageerror',e=>errors.push(e.message));await cold.goto(origin+base,{waitUntil:'domcontentloaded'});
 await cold.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?._stemMusic?.ready,null,{timeout:30000});
 // A second controlled tab starts with the same Lite default. It must never
 // inherit another tab's in-flight quality changes, even after worker restart.
 const sibling=await context.newPage();await sibling.goto(origin+base,{waitUntil:'domcontentloaded'});await sibling.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const bass=tiers.groups.find(g=>g.quality==='lite').entries.find(e=>e.logicalUrl.endsWith('-bass.ogg'));
 const hashOn=page=>page.evaluate(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)return 'HTTP '+r.status;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await r.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');},bass.logicalUrl);
 if(await hashOn(sibling)!==bass.sha256)throw Error('Sibling initial Lite binding failed');
 const observed=await cold.evaluate(async({monoModule,tiers,base,selected,id})=>{
   const t=await import(monoModule),audio=window.__bbGame.registry.get('audioSynth'),p=audio._stemMusic,opts={storage:caches,origin:location.origin,scope:base,worker:navigator.serviceWorker.controller,subtle:crypto.subtle};
   const entry=q=>tiers.groups.find(g=>g.quality===q).entries.find(e=>e.logicalUrl.endsWith('-bass.ogg'));
   const verify=async q=>{const e=entry(q),r=await fetch(e.logicalUrl,{cache:'no-store'}),b=await r.arrayBuffer(),h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');if(!r.ok||h!==e.sha256)throw Error('Wrong routed '+q);return h;};
   const play=async q=>{const hash=await verify(q);audio.applySettings({...audio.settings,musicEnabledSongs:selected,dynamicOrchestra:false});if(!audio.jukeboxPlay())throw Error('Cannot play '+q);for(let i=0;i<300;i++){if(p.track?.id===id&&p.clockStart!==null&&p.cache.size>=7){const channels=[...new Set([...p.cache.values()].map(b=>b.numberOfChannels))];if(channels.length!==1||channels[0]!==1||p.transportSnapshot().state!=='playing'||audio._musicTimer)throw Error('Wrong mono engine state '+q);return {quality:q,hash,channels,buffers:p.cache.size,state:p.transportSnapshot().state};}await new Promise(r=>setTimeout(r,100));}throw Error('Playback timeout '+q);};
   const lite=await play('lite');let blocked=false;try{await t.activatePublishedMelody(tiers,'full',{...opts,stopped:false});}catch{blocked=true;}if(!blocked)throw Error('Unsafe promotion not blocked');
   const stop=()=>{audio.stopMusic();if(p.started||p.cache.size||p.activeNodes.size)throw Error('Transport not stopped');};stop();await t.activatePublishedMelody(tiers,'full',{...opts,stopped:true});const full=await play('full');stop();await t.activatePublishedMelody(tiers,'lite',{...opts,stopped:true});const saver=await play('lite');stop();await t.activatePublishedMelody(tiers,null,{...opts,stopped:true});const off=(await fetch(entry('lite').logicalUrl,{cache:'no-store'})).status;return {catalog:p.catalog.length,lite,full,saver,blocked,off};
 },{monoModule,tiers,base,selected,id:chosen.id});
 const siblingAfter=await hashOn(sibling);if(siblingAfter!==bass.sha256)throw Error('Other tab lost pinned Lite tier: '+siblingAfter);
 await sibling.close();
 if(observed.catalog!==33||observed.off!==503||errors.length)throw Error(JSON.stringify({observed,errors}));
 await cold.reload({waitUntil:'domcontentloaded'});await cold.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
 const coldOff=await cold.evaluate(async url=>(await fetch(url,{cache:'no-store'})).status,tiers.groups[0].entries.find(e=>e.frames).logicalUrl);if(coldOff!==503)throw Error('No Music not retained');
 console.log('PASS_R2_MONO_OFFLINE_PLAYBACK',JSON.stringify({observed,coldOff,siblingAfter,errors}));
}finally{if(browser)await browser.close();if(server)await new Promise((res,rej)=>server.httpServer.close(e=>e?rej(e):res()));await rm(scratch,{recursive:true,force:true});}
