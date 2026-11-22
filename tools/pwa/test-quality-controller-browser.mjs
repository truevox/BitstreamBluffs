/** Browser integration: actual recording only, two qualities and OFF, on a fresh
 * ephemeral localhost worker. NEVER registers an app/service worker in prod. */
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname,extname,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {generateOfflineWorker} from './build-offline-worker.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const media=resolve(process.env.BSB_MEDIA_PUBLIC_ROOT||resolve(root,'public'));
const variants=resolve(process.env.BSB_VARIANT_ROOT||'/tmp/bsb-172-tiered-audio-20261121');
const dist=resolve(root,'dist');
const tier=JSON.parse(await readFile(join(variants,'tiered-plan.json'),'utf8'));
const catalog=JSON.parse(await readFile(join(media,'music/catalog.json'),'utf8'));
const chosen=catalog.tracks.find(x=>x.title.includes('One More Run'));
const required=tier.groups.filter(g=>g.priority==='required');
if(!chosen||required.length!==2||tier.downloads.length!==4)
  throw Error('Expected one real song with base+Debumont in both audio tiers');
await generateOfflineWorker(dist);
const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
  '.json':'application/json','.html':'text/html','.ogg':'audio/ogg',
  '.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  try{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname);
    if(path.includes('..')||path.includes('\\')||!path.startsWith('/'))throw Error('Bad path');
    const source=path.startsWith('/music-variants/')?variants:
      path.startsWith('/music/packs/')?media:
      path.startsWith('/tools/pwa/')?root:dist;
    const file=resolve(source,path.slice(1));
    if(!file.startsWith(source+sep))throw Error('Path traversal');
    const st=await stat(file);if(!st.isFile())throw Error('Not regular file');
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream',
      'Content-Length':st.size,'Cache-Control':'no-store'});
    createReadStream(file).pipe(res);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Missing');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',
    headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required',
      '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:960,height:540}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const titleReady=async()=>page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
  await page.goto(origin,{waitUntil:'domcontentloaded'});await titleReady();
  await page.evaluate(async()=>{
    await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
    await navigator.serviceWorker.ready;
  });
  await page.reload({waitUntil:'domcontentloaded'});await titleReady();
  if(!await page.evaluate(()=>!!navigator.serviceWorker.controller))throw Error('SW does not control game');
  console.log('START',JSON.stringify({id:chosen.id,requiredGroups:required.map(x=>x.originalId),
    liteMiB:(required.reduce((n,g)=>n+g.lite.totalBytes,0)/1048576).toFixed(3),
    fullMiB:(required.reduce((n,g)=>n+g.full.totalBytes,0)/1048576).toFixed(3)}));
  const source=required[0].lite.entries.find(e=>e.logicalUrl.endsWith('0000-drums.ogg'));
  const result=await page.evaluate(async({groups,source})=>{
    const {MusicDownloadController,postMusicPreference}=await import('/tools/pwa/music-download-controller.mjs');
    const sw=navigator.serviceWorker.controller;
    const statuses=[],progress=[];
    const manager=new MusicDownloadController({groups,storage:caches,origin:location.origin,
      subtle:crypto.subtle,fetcher:fetch.bind(window),concurrency:8,
      postPolicy:policy=>postMusicPreference(sw,policy),
      onStatus:s=>statuses.push({status:s.status,id:s.id,quality:s.quality}),
      onProgress:p=>progress.push(p)});
    window.__qualityManager=manager;
    window.__qualityStatuses=statuses;
    await manager.setMode('off');
    const disabled=await fetch(source.logicalUrl,{cache:'no-store'});
    if(disabled.status!==503)throw Error('No Music did not block logical source');
    await manager.setMode('high');
    await manager.whenIdle();
    if(manager.lastError)throw manager.lastError;
    const before=await fetch(source.logicalUrl,{cache:'no-store'});
    const fetched=await before.arrayBuffer();
    const hex=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))]
      .map(x=>x.toString(16).padStart(2,'0')).join('');
    const initialHash=await hex(fetched);
    if(initialHash!==source.sha256)throw Error('High mode auto-promoted without boundary');
    const modeBefore=manager.policy.songs[0].activeQuality;
    const groupsReady=await Promise.all(groups.map(async g=>{
      const {isRealSongDownloaded}=await import('/tools/pwa/music-cache-prototype.mjs');
      const o={storage:caches,origin:location.origin,subtle:crypto.subtle};
      return {lite:await isRealSongDownloaded(g.lite,o),full:await isRealSongDownloaded(g.full,o)};
    }));
    if(groupsReady.some(x=>!x.lite||!x.full))throw Error('Full download did not verify');
    return {disabled:disabled.status,modeBefore,initialHash,groupsReady,
      statuses:statuses.map(x=>[x.status,x.quality||'']),progressCount:progress.length};
  },{groups:required,source});
  console.log('REAL CONTROLLER ONLINE',JSON.stringify(result));
  if(result.modeBefore!=='lite'||result.groupsReady.some(g=>!g.lite||!g.full))
    throw Error('Controller failed completeness gate');
  await context.setOffline(true);
  const offline=await page.evaluate(async({source,chosen,groups,songIds})=>{
    const verify=async expected=>{
      const response=await fetch(source.logicalUrl,{cache:'no-store'});
      if(response.status!==200)return {status:response.status};
      const bytes=await response.arrayBuffer();
      const hex=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
        .map(x=>x.toString(16).padStart(2,'0')).join('');
      return {status:response.status,match:hex===expected,bytes:bytes.byteLength};
    };
    const current=await verify(source.sha256);
    const manager=window.__qualityManager;
    if(manager.mode!=='high')throw Error('Controller lost its in-memory high-quality policy');
    const audio=window.__bbGame.registry.get('audioSynth');
    if(!audio)throw Error('Actual game AudioSynth missing');
    // Only switch while the current music engine is fully STOPPED. The
    // production event/handoff into this boundary is still unimplemented.
    audio.applySettings({...audio.settings,musicQuality:'off'});
    if(audio._stemMusic.started)throw Error('Stopped transport still owns recorded sources');
    const selection=Object.fromEntries(songIds.map(id=>[id,id===chosen.id]));
    const playAndInspect=async quality=>{
      audio.applySettings({...audio.settings,musicQuality:quality,musicEnabledSongs:selection,dynamicOrchestra:false});
      if(!audio.jukeboxPlay())throw Error('The actual shared music engine did not start');
      const deadline=Date.now()+25000;
      while(Date.now()<deadline){
        const p=audio._stemMusic;
        if(p?.track?.id===chosen.id&&p?.clockStart!==null&&p?.cache?.size>=7){
          const playback={state:p.transportSnapshot().state,decoded:p.cache.size,
            channels:[...new Set([...p.cache.values()].map(x=>x.numberOfChannels))],
            proceduralTimer:!!audio._musicTimer};
          if(playback.state!=='playing'||playback.channels.some(x=>x!==1)||playback.proceduralTimer)
            throw Error('The game did not decode and play actual mono music');
          return playback;
        }
        await new Promise(ok=>setTimeout(ok,100));
      }
      throw Error('Actual stem player did not decode recorded music in time');
    };
    const flags={
      readyBeforePromotion:current,
      promoted:await manager.atVerifiedBoundary(chosen.id),
    };
    const full=groups=>groups[0].full.entries.find(x=>x.logicalUrl===source.logicalUrl).sha256;
    flags.full=await verify(full(groups));
    flags.fullPlayback=await playAndInspect('high');
    audio.applySettings({...audio.settings,musicQuality:'off'});
    if(audio._stemMusic.started)throw Error('Full music did not stop for quality change');
    await manager.setMode('saver');await manager.whenIdle();
    flags.saver=await verify(source.sha256);
    flags.saverPlayback=await playAndInspect('saver');
    audio.applySettings({...audio.settings,musicQuality:'off'});
    if(audio._stemMusic.started)throw Error('Saver music did not stop');
    await manager.setMode('off');await manager.whenIdle();
    flags.off=(await fetch(source.logicalUrl,{cache:'no-store'})).status;
    const {isRealSongDownloaded}=await import('/tools/pwa/music-cache-prototype.mjs');
    flags.retained=[];
    for(const g of groups){
      const o={storage:caches,origin:location.origin,subtle:crypto.subtle};
      flags.retained.push(await isRealSongDownloaded(g.lite,o),await isRealSongDownloaded(g.full,o));
    }
    return flags;
  },{source,chosen,groups:required,songIds:catalog.tracks.map(t=>t.id)});
  console.log('REAL CONTROLLER OFFLINE',JSON.stringify(offline));
  if(!offline.readyBeforePromotion.match||!offline.promoted||!offline.full.match||
    !offline.saver.match||offline.off!==503||!offline.retained.every(Boolean)||
    offline.fullPlayback?.state!=='playing'||offline.saverPlayback?.state!=='playing')
    throw Error('Real offline manager failed one of its quality modes');
  if(errors.length)throw Error('Unexpected browser page errors: '+errors.join('; '));
  await page.reload({waitUntil:'domcontentloaded'});await titleReady();
  const coldOff=await page.evaluate(async url=>(await fetch(url,{cache:'no-store'})).status,source.logicalUrl);
  if(coldOff!==503)throw Error('Cold offline reload forgot the No Music setting');
  console.log('OFFLINE RELOAD PRESERVES NO-MUSIC POLICY',coldOff);
  console.log('BROWSER QUALITY CONTROLLER PASS',JSON.stringify({online:result,offline,errors}));
  await context.close();
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
