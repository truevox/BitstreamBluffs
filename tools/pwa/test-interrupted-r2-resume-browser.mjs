/** Real R2 interrupted consented Lite transfer, repair/resume and offline play. */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
const [dist,inventoryPath,base='/BitstreamBluffs/']=process.argv.slice(2);if(!dist||!inventoryPath)throw Error('Usage: test-interrupted-r2-resume-browser DIST VERIFIED_INVENTORY BASE');
const inv=JSON.parse(await readFile(inventoryPath)),objects=new Map(inv.objects.map(e=>[e.key,e]));
const catalog=JSON.parse(await readFile(objects.get('catalog.json').path)),song=catalog.tracks.find(t=>t.title.includes('One More Run'))||catalog.tracks[0];
const selected=Object.fromEntries(catalog.tracks.map(t=>[t.id,t.id===song.id]));
const root=fileURLToPath(new URL('../../',import.meta.url));let server,browser;
try{
 server=await preview({root,base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'allow'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(selection=>{if(!localStorage.getItem('bb.settings'))localStorage.setItem('bb.settings',JSON.stringify({musicEnabledSongs:selection,offlineMusicQuality:'space-saver'}));},selected);
 await page.goto(origin+base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.registry?.get('offlineMusicDownloads'),null,{timeout:30000});
 const receipt=await page.evaluate(async()=>{
  const g=window.__bbGame,c=g.registry.get('offlineMusicDownloads'),a=g.registry.get('audioSynth');
  const totalEntries=c.plan.groups.filter(x=>x.quality==='lite'&&x.priority==='required').reduce((n,g)=>n+g.entries.length,0);
  let attempts=0,cancelled=false;const real=fetch.bind(window);
  const queue=c._queue('lite');queue.opts.fetcher=async(...args)=>{const result=await real(...args);attempts++;if(attempts===22){cancelled=true;c.cancel();}return result;};
  const partial=await c.start({consent:true});
  if(!cancelled||partial.status!=='cancelled'||partial.ready)throw Error('Interrupted transfer not properly cancelled '+JSON.stringify({attempts,cancelled,partial}));
  const persisted=(await caches.keys()).filter(n=>n.startsWith('bb-r2-recordings'));
  const partiallyCached=await Promise.all(persisted.map(async name=>({name,count:(await (await caches.open(name)).keys()).length})));
  if(!partiallyCached.some(x=>x.count>0))throw Error('Cancellation did not preserve a partial download');
  const beforeResume=attempts;
  const resumed=await c.start({consent:true});if(!resumed.ready||resumed.status!=='ready')throw Error('Interrupted download cannot resume '+JSON.stringify(resumed));
  const resumeRequests=attempts-beforeResume;
  // Since some recordings were already stage-verified, resume needs fewer
  // GETs than a fresh transfer of the exact same required files.
  if(resumeRequests>=totalEntries+1)throw Error('Resume fetched all recordings again '+JSON.stringify({resumeRequests,totalEntries}));
  a.stopMusic();await c.apply();if(c.quality!=='lite')throw Error('Lite tier unavailable after repair');
  return {totalEntries,attemptsBeforeCancel:beforeResume,resumeRequests,partialStatus:partial.status,partiallyCached,finalStatus:resumed.status,quality:c.quality};
 });
 await page.close();await ctx.setOffline(true);const cold=await ctx.newPage();cold.on('pageerror',e=>errors.push(e.message));await cold.goto(origin+base,{waitUntil:'domcontentloaded'});await cold.waitForFunction(()=>window.__bbGame?.registry?.get('offlineMusicDownloads')&&window.__bbGame?.registry?.get('audioSynth')?._stemMusic?.ready,null,{timeout:30000});
 await cold.evaluate(()=>{const a=window.__bbGame.registry.get('audioSynth');a.jukeboxPlay();});
 await cold.waitForFunction(id=>{const p=window.__bbGame?.registry.get('audioSynth')?._stemMusic;return p?.track?.id===id&&p.cache.size>=7&&p.clockStart!==null;},song.id,{timeout:30000});
 const playback=await cold.evaluate(()=>{const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;return{catalog:d.catalog.length,buffers:d.cache.size,channels:[...new Set([...d.cache.values()].map(x=>x.numberOfChannels))],playing:d.transportSnapshot().state,procedural:!!a._musicTimer};});
 if(playback.catalog!==33||playback.channels.join(',')!=='1'||playback.playing!=='playing'||playback.procedural||errors.length)throw Error('Resumed download not playable completely offline '+JSON.stringify({receipt,playback,errors}));
 console.log('PASS_REAL_R2_INTERRUPTED_RESUME_OFFLINE',JSON.stringify({receipt,playback,errors}));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
