/** Playback-start marker admission stays fast while corrupt media is never audible. */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
const [dist,source]=process.argv.slice(2);if(!dist||!source)throw Error('Usage: test-fast-admission-failclosed-browser DIST VERIFIED_INVENTORY');
const root=fileURLToPath(new URL('../../',import.meta.url)),base='/BitstreamBluffs/';
const inv=JSON.parse(await readFile(source)),byKey=new Map(inv.objects.map(e=>[e.key,e]));
const catalog=JSON.parse(await readFile(byKey.get('catalog.json').path)),chosen=catalog.tracks[0],selected=Object.fromEntries(catalog.tracks.map(t=>[t.id,t.id===chosen.id]));
let server,browser;
try{
 server=await preview({root,base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'allow'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(selection=>{if(!localStorage.getItem('bb.settings'))localStorage.setItem('bb.settings',JSON.stringify({musicEnabledSongs:selection,offlineMusicQuality:'space-saver'}));},selected);
 await page.goto(origin+base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.registry.get('offlineMusicDownloads')&&navigator.serviceWorker.controller,null,{timeout:30000});
 const observed=await page.evaluate(async scope=>{
  const g=window.__bbGame,c=g.registry.get('offlineMusicDownloads'),a=g.registry.get('audioSynth');
  const done=await c.start({consent:true});if(!done.ready)throw Error('Lite recording download failed '+done.status);
  a.stopMusic();const group=c.plan.groups.find(g=>g.quality==='lite'&&g.priority==='required'&&g.entries.some(e=>e.frames));
  const entry=group?.entries.find(e=>e.frames);if(!entry)throw Error('No real cached stem');
  const name='bb-r2-recordings-v1-'+encodeURIComponent(scope)+'-'+group.id+'-'+group.version,cache=await caches.open(name),marker=''+new URL(scope+'.bitstream/r2-complete/'+encodeURIComponent(group.id)+'/'+group.version,location.origin);
  if(!await cache.match(marker))throw Error('No verified recording marker');
  const before=performance.now();await c.apply();const admissionMs=performance.now()-before;
  if(c.quality!=='lite')throw Error('Lite not activated');
  const damaged=new Uint8Array(entry.bytes);damaged.fill(0);await cache.put(entry.url,new Response(damaged,{headers:{'Content-Type':'audio/ogg'}}));
  const fast=await c._queue('lite').quickReady();if(!fast)throw Error('Marker/key-only admission failed unexpectedly');
  const unavailable=await fetch(entry.logicalUrl,{cache:'no-store'});
  if(unavailable.status!==503)throw Error('CORRUPTED AUDIO WAS SERVED: '+unavailable.status);
  const deep=await c._queue('lite').refresh();if(deep.ready||deep.missingBytes<entry.bytes)throw Error('Full repair failed to find corruption');
  return {admissionMs,bytesCorrupted:entry.bytes,fastMarker:true,servedStatus:unavailable.status,deepReady:deep.ready,deepMissingBytes:deep.missingBytes,procedural:!!a._musicTimer};
 },base);
 if(observed.procedural||errors.length)throw Error('Synthetic fallback or browser error '+JSON.stringify({observed,errors}));
 console.log('PASS_FAST_ADMISSION_FAIL_CLOSED',JSON.stringify({observed,errors}));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
