/** Browser acceptance: native two-song offline handoff with crossfade enabled. */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
const [dist,inventoryPath,base='/BitstreamBluffs/']=process.argv.slice(2);
if(!dist||!inventoryPath)throw Error('Usage: test-real-offline-song-handoff-browser DIST VERIFIED_INVENTORY BASE');
const inv=JSON.parse(await readFile(inventoryPath)),byKey=new Map(inv.objects.map(e=>[e.key,e]));
const catalog=JSON.parse(await readFile(byKey.get('catalog.json').path));
const openingIndex=catalog.tracks.findIndex(t=>t.id==='local-one-more-run-bitstream-bluffs');
if(openingIndex<0||openingIndex>=catalog.tracks.length-1)throw Error('No normal opening + next track');
const one=catalog.tracks[openingIndex],two=catalog.tracks[openingIndex+1];
const selected=Object.fromEntries(catalog.tracks.map(t=>[t.id,t.id===one.id||t.id===two.id]));
const root=fileURLToPath(new URL('../../',import.meta.url));let browser,server;
try{
 server=await preview({root,base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'allow',viewport:{width:1000,height:540}}),errors=[],misses=[];
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('requestfailed',r=>{try{if(new URL(r.url()).origin===origin)misses.push(r.url());}catch{}});
 await p.addInitScript(sel=>{if(!localStorage.getItem('bb.settings'))localStorage.setItem('bb.settings',JSON.stringify({musicEnabledSongs:sel,offlineMusicQuality:'space-saver',musicCrossfade:true}));},selected);
 await p.goto(origin+base,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload({waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__bbGame?.registry?.get('offlineMusicDownloads')&&window.__bbGame?.registry?.get('audioSynth')?._stemMusic?.ready,null,{timeout:30000});
 const receipt=await p.evaluate(async()=>{const g=window.__bbGame,c=g.registry.get('offlineMusicDownloads'),a=g.registry.get('audioSynth');const state=await c.start({consent:true});if(!state.ready)throw Error('Both-song download not ready: '+JSON.stringify(state));a.stopMusic();await c.apply();return {groups:c.plan.groups.length,mode:c.mode,quality:c.quality,caches:(await caches.keys()).filter(k=>k.startsWith('bb-r2-recordings')).length};});
 if(receipt.caches<4)throw Error('Both songs were not cached');await p.close();await ctx.setOffline(true);
 const cold=await ctx.newPage();cold.on('pageerror',e=>errors.push(e.message));cold.on('requestfailed',r=>{try{if(new URL(r.url()).origin===origin)misses.push(r.url());}catch{}});
 await cold.goto(origin+base,{waitUntil:'domcontentloaded'});
 await cold.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&!!window.__bbGame.registry.get('offlineMusicDownloads')&&window.__bbGame.registry.get('audioSynth')?._stemMusic?.ready,null,{timeout:30000});
 await cold.evaluate(()=>{const a=window.__bbGame.registry.get('audioSynth');a.applySettings({...a.settings,musicCrossfade:true});a.stopMusic();if(!a.jukeboxPlay())throw Error('Cannot play first song');});
 await cold.waitForFunction(id=>{const d=window.__bbGame?.registry?.get('audioSynth')?._stemMusic;return d?.track?.id===id&&d.pack&&d.clockStart!==null&&d.cache.size>=7;},one.id,{timeout:30000});
 const before=await cold.evaluate(()=>{const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;const duration=d.pack.duration;const offset=Math.max(0,duration-7);if(!d.seekTo(offset))throw Error('Native seek failed');return {id:d.track.id,duration,offset,clock:d.clockStart,crossfade:d.crossfadeEnabled,playing:d.transportSnapshot().state,procedural:!!a._musicTimer};});
 await cold.waitForFunction(id=>{const d=window.__bbGame?.registry.get('audioSynth')?._stemMusic;return d?.track?.id===id&&d.clockStart!==null&&d.pack&&d.cache.size>=7;},two.id,{timeout:22000});
 const after=await cold.evaluate(()=>{const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;return {id:d.track.id,lastPlayed:d._lastPlayed?.id,clock:d.clockStart,active:d.activeNodes.size,buffers:d.cache.size,channels:[...new Set([...d.cache.values()].map(b=>b.numberOfChannels))],playing:d.transportSnapshot().state,crossfade:d.crossfadeEnabled,procedural:!!a._musicTimer};});
 if(!before.crossfade||before.playing!=='playing'||after.id!==two.id||after.lastPlayed!==one.id||after.playing!=='playing'||!after.active||after.channels.join(',')!=='1'||after.procedural||misses.length||errors.length)throw Error('Offline native handoff failed: '+JSON.stringify({receipt,before,after,misses,errors}));
 console.log('PASS_REAL_OFFLINE_TWO_SONG_HANDOFF',JSON.stringify({selected:[one.id,two.id],receipt,before,after,misses,errors}));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
