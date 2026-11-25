/** Real built game A -> B worker upgrade with two live clients and offline reopen. */
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
const [oldRoot,newRoot,base='/BitstreamBluffs/',inventoryPath]=process.argv.slice(2);
if(!inventoryPath)throw Error('Verified melody inventory path required');
const inventory=JSON.parse(await readFile(inventoryPath)),objects=new Map(inventory.objects.map(e=>[e.key,e]));
const catalog=JSON.parse(await readFile(objects.get('catalog.json').path)),chosen=catalog.tracks.find(t=>t.title.includes('One More Run'))||catalog.tracks[0];
const selected=Object.fromEntries(catalog.tracks.map(t=>[t.id,t.id===chosen.id]));
if(!oldRoot||!newRoot||!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))throw Error('Usage: test-real-preview-audio-update OLD_DIST NEW_DIST BASE VERIFIED_INVENTORY');
let version='a',browser,server;const roots={a:resolve(oldRoot),b:resolve(newRoot)};
const html=await Promise.all(['a','b'].map(id=>readFile(resolve(roots[id],'index.html'),'utf8')));
const shellScript=html.map(h=>h.match(/src="[^" ]*\/assets\/main-[^" ]+\.js"/)?.[0]);
if(!shellScript[0]||!shellScript[1]||shellScript[0]===shellScript[1])throw Error('Different version bundles required');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.bin':'application/octet-stream','.woff2':'font/woff2'};
server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=url.pathname===base?base+'index.html':url.pathname;
 if(!path.startsWith(base)){res.writeHead(404).end('outside scope');return;}
 const rel=path.slice(base.length);if(!rel||rel.split('/').some(p=>!p||p==='.'||p==='..')){res.writeHead(404).end('unsafe path');return;}
 const root=roots[version],file=resolve(root,rel);if(!file.startsWith(root+sep)){res.writeHead(403).end('outside root');return;}
 try{const info=await stat(file);if(!info.isFile())throw Error('Not a file');const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(body);}catch{res.writeHead(404).end('missing');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'allow',viewport:{width:1000,height:540}}),errors=[];
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(selection=>{if(!localStorage.getItem('bb.settings'))localStorage.setItem('bb.settings',JSON.stringify({musicEnabledSongs:selection,offlineMusicQuality:'space-saver'}));},selected);await p.goto(origin+base,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:30000});await p.evaluate(()=>navigator.serviceWorker.ready);
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&navigator.serviceWorker.controller,null,{timeout:30000});
 const audioA=await p.evaluate(async id=>{
  const g=window.__bbGame,c=g.registry.get('offlineMusicDownloads'),a=g.registry.get('audioSynth');if(!c)throw Error('No A installed download controller');
  const done=await c.start({consent:true});if(!done.ready)throw Error('A music download not ready '+JSON.stringify(done));
  a.stopMusic();await c.apply();if(c.quality!=='lite')throw Error('A failed to activate Lite');
  const group=c.plan.groups.find(g=>g.quality==='lite'&&g.priority==='required'&&g.entries.some(e=>e.frames));const entry=group.entries.find(e=>e.frames);
  const response=await fetch(entry.logicalUrl,{cache:'no-store'}),buffer=await response.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(!response.ok||hash!==entry.sha256)throw Error('A did not serve verified Lite recording');
  return {entry,track:id,quality:c.quality,cacheNames:(await caches.keys()).filter(n=>n.startsWith('bb-r2-recordings')).length};
 },chosen.id);
 if(audioA.cacheNames<2)throw Error('No real music caches installed in A');
 await p.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('sim-05@0'));
 await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('GameOverScene'),null,{timeout:75000});
 await p.waitForFunction(()=>{
  const g=window.__bbGame,r=g.registry.get('lastRecord');return !!r&&g.registry.get('saveStore')?.getRunPersistence(r.id)==='committed'&&g.registry.get('ghostLibrary')?.course(r.seed,r.biomeMask||0)?.latest===r.id;
 },null,{timeout:22000});
 const savedA=await p.evaluate(async()=>{
  const g=window.__bbGame,r=g.registry.get('lastRecord'),store=g.registry.get('saveStore'),lib=g.registry.get('ghostLibrary'),t=await lib.getTape(r.id);
  return {runId:r.id,seed:r.seed,score:r.score,distanceM:r.distanceM,ledgerHash:r.ledgerHash,
   valid:store.constructor.computeLedgerHash(r)===r.ledgerHash,persisted:store.getRunPersistence(r.id),
   ghostBackend:lib.backend,ghostLatest:lib.course(r.seed,r.biomeMask||0)?.latest,
   simRevision:t.simRevision,ghostTraceLength:t.trace.length};
 });
 if(!savedA.valid||savedA.persisted!=='committed'||savedA.ghostBackend!=='idb'||savedA.ghostLatest!==savedA.runId||savedA.distanceM!==166||savedA.score!==166||savedA.simRevision!==9||savedA.ghostTraceLength<100)throw Error('A did not save authentic run and ghost '+JSON.stringify(savedA));

 const q=await ctx.newPage();q.on('pageerror',e=>errors.push(e.message));await q.goto(origin+base,{waitUntil:'domcontentloaded'});await q.waitForFunction(()=>navigator.serviceWorker.controller&&window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:30000});
 await p.evaluate(()=>localStorage.setItem('bb-upgrade-proof','run-and-settings-keep'));
 const activeA=await p.evaluate(async()=>({worker:(await navigator.serviceWorker.getRegistration()).active.state,cacheNames:await caches.keys(),script:document.querySelector('script[type="module"]')?.src}));
 if(!activeA.script?.includes('main-')||!activeA.script.includes(shellScript[0].match(/main-[^" ]+\.js/)?.[0]))throw Error('First client is not running build A');
 version='b';
 const update=await p.evaluate(async()=>{
  const reg=await navigator.serviceWorker.getRegistration();await reg.update();
  for(let i=0;i<200;i++){if(reg.waiting?.state==='installed')return {waiting:reg.waiting.state,active:reg.active.state};await new Promise(r=>setTimeout(r,100));}
  throw Error('New worker failed to install and wait');
 });
 if(update.waiting!=='installed')throw Error('B did not wait');
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&navigator.serviceWorker.controller,null,{timeout:30000});
 const protectedA=await p.evaluate(async()=>({script:document.querySelector('script[type="module"]')?.src,save:localStorage.getItem('bb-upgrade-proof'),waiting:(await navigator.serviceWorker.getRegistration()).waiting?.state,cacheNames:await caches.keys()}));
 if(!protectedA.script?.includes(shellScript[0].match(/main-[^" ]+\.js/)?.[0])||protectedA.save!=='run-and-settings-keep'||protectedA.waiting!=='installed')throw Error('Old live client lost A or update activated too early');
 await p.close();const qStill=await q.evaluate(async()=>({waiting:(await navigator.serviceWorker.getRegistration()).waiting?.state,save:localStorage.getItem('bb-upgrade-proof')}));if(qStill.waiting!=='installed')throw Error('B activated before second tab closed');
 await q.close();
 await new Promise(r=>setTimeout(r,500));await ctx.setOffline(true);
 const cold=await ctx.newPage();cold.on('pageerror',e=>errors.push(e.message));await cold.goto(origin+base,{waitUntil:'domcontentloaded'});await cold.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&navigator.serviceWorker.controller,null,{timeout:30000});
 await cold.waitForFunction(()=>window.__bbGame?.registry?.get('offlineMusicDownloads')&&window.__bbGame?.registry?.get('audioSynth')?._stemMusic?.ready,null,{timeout:30000});
 await cold.evaluate(()=>{const a=window.__bbGame.registry.get('audioSynth');a.jukeboxPlay();});
 await cold.waitForFunction(id=>{const p=window.__bbGame?.registry.get('audioSynth')?._stemMusic;return p?.track?.id===id&&p?.cache?.size>=7&&p.clockStart!==null;},chosen.id,{timeout:30000});
 const persistedB=await cold.evaluate(async id=>{
  const g=window.__bbGame,s=g.registry.get('saveStore'),lib=g.registry.get('ghostLibrary');
  const r=(await s.getRecentRuns(10)).find(x=>x.id===id),t=await lib.getTape(id);
  return {runId:r?.id,score:r?.score,distanceM:r?.distanceM,ledgerHash:r?.ledgerHash,
   valid:r? s.constructor.computeLedgerHash(r)===r.ledgerHash:false,
   persisted:s.getRunPersistence(id),ghostBackend:lib.backend,
   ghostLatest:r? lib.course(r.seed,r.biomeMask||0)?.latest:null,
   ghostRunId:t?.runId,simRevision:t?.simRevision,ghostTraceLength:t?.trace?.length||0};
 },savedA.runId);
 if(persistedB.runId!==savedA.runId||persistedB.score!==166||persistedB.distanceM!==166||persistedB.ledgerHash!==savedA.ledgerHash||!persistedB.valid||persistedB.persisted!=='committed'||persistedB.ghostBackend!=='idb'||persistedB.ghostLatest!==savedA.runId||persistedB.ghostRunId!==savedA.runId||persistedB.simRevision!==9||persistedB.ghostTraceLength!==savedA.ghostTraceLength)throw Error('Run/ghost lost on PWA version update '+JSON.stringify({savedA,persistedB}));
 const activeB=await cold.evaluate(async oldEntry=>{
  const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic,c=window.__bbGame.registry.get('offlineMusicDownloads');
  const response=await fetch(oldEntry.logicalUrl,{cache:'no-store'}),buffer=await response.arrayBuffer();
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
  return {
   audio:{catalog:d.catalog.length,quality:c.quality,track:d.track?.id,buffers:d.cache.size,
    channels:[...new Set([...d.cache.values()].map(x=>x.numberOfChannels))],
    playing:d.transportSnapshot().state,procedural:!!a._musicTimer,status:response.status,sha256},
   script:document.querySelector('script[type="module"]')?.src,
   save:localStorage.getItem('bb-upgrade-proof'),cacheNames:await caches.keys(),
   worker:(await navigator.serviceWorker.getRegistration()).active.state,
   controller:!!window.__bbGame.registry.get('offlineMusicDownloads'),
  };
 },audioA.entry);
 if(!activeB.script?.includes(shellScript[1].match(/main-[^" ]+\.js/)?.[0])||activeB.save!=='run-and-settings-keep'||!activeB.controller||activeB.cacheNames.filter(s=>s.startsWith('bitstream-shell-v1-')).length<2||activeB.audio.catalog!==33||activeB.audio.quality!=='lite'||activeB.audio.track!==chosen.id||activeB.audio.buffers<7||activeB.audio.channels.join(',')!=='1'||activeB.audio.playing!=='playing'||activeB.audio.procedural||activeB.audio.status!==200||activeB.audio.sha256!==audioA.entry.sha256||errors.length)throw Error('Cold offline upgrade did not preserve both shells and data '+JSON.stringify({audioA,activeA,update,protectedA,qStill,activeB,errors}));
 await cold.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('sim-05@0'));
 await cold.waitForFunction(id=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');return g.scene.isActive('RunScene')&&r?.ghostRiders?.some(x=>x.runId===id&&x.visible);
 },savedA.runId,{timeout:30000});
 const replayB=await cold.evaluate(()=>{
  const r=window.__bbGame.scene.getScene('RunScene');return {tick:r.simClock.tick,ghosts:r.ghostRiders.map(x=>({runId:x.runId,roles:x.roles,visible:x.visible,frames:x.trace.length,rendered:!!x.gfx&&!!x.label}))};
 });
 if(!replayB.ghosts.some(x=>x.runId===savedA.runId&&x.visible&&x.rendered&&x.frames>0)||errors.length)throw Error('B ghost did not visibly replay '+JSON.stringify({savedA,replayB,errors}));
 console.log('PASS_REAL_AUDIO_RUN_GHOST_PRESERVING_UPGRADE',JSON.stringify({savedA,persistedB,replayB,audioA:{track:audioA.track,quality:audioA.quality,cacheNames:audioA.cacheNames,sha256:audioA.entry.sha256},activeA,update,protectedA,qStill,activeB,errors}));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
