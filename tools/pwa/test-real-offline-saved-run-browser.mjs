/** Offline PWA acceptance: real local physics, pause/resume and original music. */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
const [dist,inventoryPath,base='/BitstreamBluffs/']=process.argv.slice(2);if(!dist||!inventoryPath)throw Error('Usage: test-real-offline-run-browser BUILT_DIST VERIFIED_INVENTORY BASE');
const inventory=JSON.parse(await readFile(inventoryPath)),objects=new Map(inventory.objects.map(e=>[e.key,e]));
const catalog=JSON.parse(await readFile(objects.get('catalog.json').path)),song=catalog.tracks.find(t=>t.title.includes('One More Run'))||catalog.tracks[0];
const selection=Object.fromEntries(catalog.tracks.map(t=>[t.id,t.id===song.id]));
const root=fileURLToPath(new URL('../../',import.meta.url));let browser,server;
try{
 server=await preview({root,base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'allow',viewport:{width:1000,height:540}}),errors=[],sameOriginFailures=[];
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>{try{const u=new URL(r.url());if(u.origin===origin)sameOriginFailures.push({url:u.pathname,error:r.failure()?.errorText});}catch{}});
 await page.addInitScript(selection=>{if(!localStorage.getItem('bb.settings'))localStorage.setItem('bb.settings',JSON.stringify({musicEnabledSongs:selection,offlineMusicQuality:'space-saver'}));},selection);
 await page.goto(origin+base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&!!window.__bbGame.registry.get('offlineMusicDownloads'),null,{timeout:30000});
 const installed=await page.evaluate(async()=>{const g=window.__bbGame,c=g.registry.get('offlineMusicDownloads'),a=g.registry.get('audioSynth');const result=await c.start({consent:true});if(!result.ready)throw Error('Cannot download real required recordings: '+JSON.stringify(result));a.stopMusic();await c.apply();if(c.quality!=='lite')throw Error('Lite not applied');return {quality:c.quality,groups:c.plan.groups.length,keys:(await caches.keys()).filter(k=>k.startsWith('bb-r2-recordings')).length};});
 await page.close();await ctx.setOffline(true);
 const cold=await ctx.newPage();cold.on('pageerror',e=>errors.push(e.message));cold.on('requestfailed',r=>{try{const u=new URL(r.url());if(u.origin===origin)sameOriginFailures.push({url:u.pathname,error:r.failure()?.errorText});}catch{}});
 await cold.goto(origin+base,{waitUntil:'domcontentloaded'});await cold.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&!!window.__bbGame.registry.get('offlineMusicDownloads')&&window.__bbGame.registry.get('audioSynth')?._stemMusic?.ready,null,{timeout:30000});
 await cold.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('sim-05@0'));
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
 await cold.waitForFunction(()=>window.__bbGame?.scene?.isActive('GameOverScene'),null,{timeout:75000});
 await cold.waitForFunction(async()=>{
  const g=window.__bbGame,record=g.registry.get('lastRecord');if(!record)return false;
  const store=g.registry.get('saveStore'),ghosts=g.registry.get('ghostLibrary');
  return store?.getRunPersistence(record.id)==='committed'&&ghosts?.course(record.seed,record.biomeMask||0)?.latest===record.id;
 },null,{timeout:20000});
 const finished=await cold.evaluate(async()=>{
  const g=window.__bbGame,record=g.registry.get('lastRecord'),store=g.registry.get('saveStore'),ghosts=g.registry.get('ghostLibrary');
  const tape=await ghosts.getTape(record.id),rows=await store.getRecentRuns(5);
  return {record:{id:record.id,seed:record.seed,score:record.score,distanceM:record.distanceM,cause:record.cause,ledgerHash:record.ledgerHash},
   persisted:store.getRunPersistence(record.id),recent:rows.map(r=>r.id),ghostBackend:ghosts.backend,
   ghostCourse:ghosts.course(record.seed,record.biomeMask||0)?.latest,
   ghostTape:{runId:tape?.runId,seed:tape?.seed,simRevision:tape?.simRevision,traceLength:tape?.trace?.length||0},
   ledgerValid:store.constructor.computeLedgerHash(record)===record.ledgerHash,
   scene:g.scene.isActive('GameOverScene')};
 });
 if(!finished.scene||finished.record.seed!=='sim-05'||finished.record.cause!=='crash'||!finished.record.ledgerHash||!finished.ledgerValid||finished.persisted!=='committed'||!finished.recent.includes(finished.record.id)||finished.ghostBackend!=='idb'||finished.ghostCourse!==finished.record.id||finished.ghostTape.runId!==finished.record.id||finished.ghostTape.traceLength<20)throw Error('Real fatal run not saved to IndexedDB with ghost '+JSON.stringify(finished));
 await cold.close();
 const reopened=await ctx.newPage();reopened.on('pageerror',e=>errors.push(e.message));reopened.on('requestfailed',r=>{try{const u=new URL(r.url());if(u.origin===origin)sameOriginFailures.push({url:u.pathname,error:r.failure()?.errorText});}catch{}});
 await reopened.goto(origin+base,{waitUntil:'domcontentloaded'});
 await reopened.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&!!window.__bbGame.registry.get('saveStore')&&!!window.__bbGame.registry.get('ghostLibrary'),null,{timeout:30000});
 const restored=await reopened.evaluate(async id=>{
  const g=window.__bbGame,store=g.registry.get('saveStore'),ghosts=g.registry.get('ghostLibrary');
  const record=(await store.getRecentRuns(10)).find(r=>r.id===id);
  const course=record&&ghosts.course(record.seed,record.biomeMask||0),tape=record&&await ghosts.getTape(id);
  return {runId:record?.id,persisted:store.getRunPersistence(id),score:record?.score,distanceM:record?.distanceM,
   ledgerValid:record&&store.constructor.computeLedgerHash(record)===record.ledgerHash,
   ghostBackend:ghosts.backend,ghostCourse:course?.latest,ghostRunId:tape?.runId,ghostTraceLength:tape?.trace?.length||0,
   audioCatalog:g.registry.get('audioSynth')?._stemMusic?.catalog?.length||0};
 },finished.record.id);
 if(restored.runId!==finished.record.id||restored.persisted!=='committed'||restored.ledgerValid!==true||restored.ghostBackend!=='idb'||restored.ghostCourse!==finished.record.id||restored.ghostRunId!==finished.record.id||restored.ghostTraceLength<20||errors.length||sameOriginFailures.length)throw Error('Actual offline run/ghost failed to survive reopen '+JSON.stringify({finished,restored,errors,sameOriginFailures}));
 console.log('PASS_PWA_REAL_OFFLINE_SCORED_GHOST_PERSISTENCE',JSON.stringify({installed,first,second,paused,resumed,finished,restored,errors,sameOriginFailures}));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
