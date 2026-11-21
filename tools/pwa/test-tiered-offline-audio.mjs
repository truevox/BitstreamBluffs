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
  const menuChoice=await page.evaluate(()=>{
    const scene=window.__bbGame.scene.getScene('TitleScene');
    scene.menu.items.find(i=>i.label==='SETTINGS').onSelect();
    const settings=scene.view;
    settings.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
    const item=settings.soundView.menu.items.find(i=>i.label==='MUSIC QUALITY');
    if(!item)throw Error('Player Music Quality setting not visible');
    const options=item.options.map(x=>x.value);
    item.set('saver');const saver=item.get();
    item.set('off');const off=item.get();
    item.set('high');const high=item.get();
    scene._closeView();
    return {options,saver,off,high};
  });
  console.log('REAL SETTINGS QUALITY CHOICES',JSON.stringify(menuChoice));
  if(menuChoice.options.join(',')!=='high,saver,off'||
    menuChoice.saver!=='saver'||menuChoice.off!=='off'||menuChoice.high!=='high')
    throw Error('The actual Sound settings choice did not persist three modes');
  await page.evaluate(async()=>{
    await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
    await navigator.serviceWorker.ready;
  });
  await page.reload({waitUntil:'domcontentloaded'});await titleReady();
  if(!await page.evaluate(()=>!!navigator.serviceWorker.controller))throw Error('SW does not control game');
  console.log('START',JSON.stringify({id:chosen.id,requiredGroups:required.map(x=>x.originalId),
    liteMiB:(required.reduce((n,g)=>n+g.lite.totalBytes,0)/1048576).toFixed(3),
    fullMiB:(required.reduce((n,g)=>n+g.full.totalBytes,0)/1048576).toFixed(3)}));
  const preference=(mode,quality='lite')=>({mode,songs:[{
    id:chosen.id,activeQuality:quality,required:required.map(x=>x.originalId)}]});
  async function setMode(mode,quality='lite'){
    const policy=preference(mode,quality);
    await page.evaluate(policy=>new Promise((resolve,reject)=>{
      const channel=new MessageChannel();
      channel.port1.onmessage=event=>event.data?.ok?resolve(true):
        reject(new Error(event.data?.error||'Music preference change rejected'));
      navigator.serviceWorker.controller.postMessage({type:'bb-set-music-preference',policy},[channel.port2]);
    }),policy);
    await page.waitForFunction(async p=>{
      const c=await caches.open('bb-music-preference-v1');
      const r=await c.match('/.bitstream/music-preference');
      if(!r)return false;
      const x=await r.json();return x.mode===p.mode&&x.songs[0].activeQuality===p.songs[0].activeQuality;
    },policy,{timeout:10000});
  }
  async function originalStemCheck(quality){
    const source=required.find(g=>g.originalId.includes(':base'))[quality].entries.find(e=>e.logicalUrl.endsWith('0000-drums.ogg'));
    return await page.evaluate(async e=>{
      const r=await fetch(e.logicalUrl,{cache:'no-store'});
      if(r.status!==200)return {status:r.status};
      const bytes=await r.arrayBuffer();
      const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
        .map(x=>x.toString(16).padStart(2,'0')).join('');
      const ctx=new AudioContext(),decoded=await ctx.decodeAudioData(bytes.slice(0));await ctx.close();
      return {status:r.status,hashCorrect:sha===e.sha256,channels:decoded.numberOfChannels,
        duration:decoded.duration,bytes:bytes.byteLength};
    },source);
  }
  await setMode('off');
  const disabled=await page.evaluate(async url=>(await fetch(url,{cache:'no-store'})).status,required[0].lite.entries.find(e=>e.logicalUrl.endsWith('.ogg')).logicalUrl);
  if(disabled!==503)throw Error('OFF mode fetched recorded media unexpectedly: '+disabled);
  console.log('OFF GATE',disabled);
  await setMode('high','lite');
  for(const g of required){
    const download=await page.evaluate(async group=>{
      const {downloadRealSong,isRealSongDownloaded}=await import('/tools/pwa/music-cache-prototype.mjs');
      const c={storage:caches,origin:location.origin,subtle:crypto.subtle,fetcher:fetch.bind(window),concurrency:8};
      const r=await downloadRealSong(group,c);
      navigator.serviceWorker.controller.postMessage({type:'bb-music-cache-updated'});
      return {r,complete:await isRealSongDownloaded(group,c)};
    },g.lite);
    if(!download.complete)throw Error('Lite group failed to become ready');
    console.log('LITE DOWNLOADED',JSON.stringify({group:g.originalId,result:download.r}));
  }
  await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await titleReady();
  const lite=await originalStemCheck('lite');
  console.log('OFFLINE LITE STEM',JSON.stringify(lite));
  if(!lite.hashCorrect||lite.channels!==1||lite.status!==200)throw Error('Lite stem not routed');
  const selection=Object.fromEntries(catalog.tracks.map(x=>[x.id,x.id===chosen.id]));
  const player=await page.evaluate(async selection=>{
    const audio=window.__bbGame.registry.get('audioSynth');
    audio.applySettings({...audio.settings,musicEnabledSongs:selection,dynamicOrchestra:false});
    audio.jukeboxPlay();
    return {started:audio._stemMusic.started};
  },selection);
  await page.waitForFunction(id=>{
    const audio=window.__bbGame.registry.get('audioSynth');const p=audio?._stemMusic;
    return p?.track?.id===id&&p?.clockStart!==null&&p?.cache?.size>=7;
  },chosen.id,{timeout:30000});
  const playing=await page.evaluate(()=>{
    const audio=window.__bbGame.registry.get('audioSynth'),p=audio._stemMusic;
    return {state:p.transportSnapshot().state,decoded:p.cache.size,
      channels:[...new Set([...p.cache.values()].map(x=>x.numberOfChannels))],synthTimer:!!audio._musicTimer};
  });
  console.log('ACTUAL MUSIC ENGINE LITE',JSON.stringify({player,playing}));
  if(playing.state!=='playing'||playing.decoded<7||playing.synthTimer||playing.channels.some(x=>x!==1))
    throw Error('Game failed to play original mono Lite stems offline');
  await setMode('off');
  const muted=await page.evaluate(()=>{
    const audio=window.__bbGame.registry.get('audioSynth');
    const selected=JSON.stringify(audio.settings.musicEnabledSongs);
    const sfxBus=audio.nodes.sfxBus;
    audio.applySettings({...audio.settings,musicQuality:'off'});
    return {started:audio._stemMusic.started,proceduralTimer:!!audio._musicTimer,
      tracksIntact:selected===JSON.stringify(audio.settings.musicEnabledSongs),
      sfxBusUnchanged:sfxBus===audio.nodes.sfxBus,mode:audio.settings.musicQuality};
  });
  if(muted.started||muted.proceduralTimer||!muted.tracksIntact||!muted.sfxBusUnchanged||muted.mode!=='off')
    throw Error('No Music did not silence engine without erasing song selection');
  console.log('LIVE NO MUSIC PRESERVES SONGS/SFX',JSON.stringify(muted));
  await setMode('high','lite');
  await page.evaluate(()=>{
    const audio=window.__bbGame.registry.get('audioSynth');
    audio.applySettings({...audio.settings,musicQuality:'high'});
    audio.jukeboxPlay();
  });
  await context.setOffline(false);
  for(const g of required){
    const download=await page.evaluate(async group=>{
      const {downloadRealSong,isRealSongDownloaded}=await import('/tools/pwa/music-cache-prototype.mjs');
      const c={storage:caches,origin:location.origin,subtle:crypto.subtle,fetcher:fetch.bind(window),concurrency:8};
      const r=await downloadRealSong(group,c);
      navigator.serviceWorker.controller.postMessage({type:'bb-music-cache-updated'});
      return {r,complete:await isRealSongDownloaded(group,c)};
    },g.full);
    if(!download.complete)throw Error('Full group failed to become ready');
    console.log('FULL DOWNLOADED',JSON.stringify({group:g.originalId,result:download.r}));
  }
  // Force a real interrupted Full group: loss of ANY one instrument
  // invalidates the group's promotion, even when another instrument is intact.
  const fullBase=required.find(g=>g.originalId.endsWith(':base')).full;
  const damaged=fullBase.entries.find(e=>e.logicalUrl.endsWith('0000-other.ogg'));
  await page.evaluate(async({fullBase,damaged})=>{
    const name='bb-real-music-v1-'+fullBase.id+'-'+fullBase.version;
    const c=await caches.open(name);
    if(!await c.delete(new URL(damaged.url,location.origin).href))
      throw Error('Failed to simulate incomplete Full stem');
    navigator.serviceWorker.controller.postMessage({type:'bb-music-cache-updated'});
  },{fullBase,damaged});
  await context.setOffline(true);
  await setMode('high','full');
  const fallback=await originalStemCheck('lite');
  if(!fallback.hashCorrect)throw Error('An incomplete Full pack was served instead of intact Lite');
  console.log('INCOMPLETE FULL FALLBACK TO LITE',JSON.stringify(fallback));
  await setMode('high','lite');
  await context.setOffline(false);
  const repaired=await page.evaluate(async group=>{
    const {downloadRealSong}=await import('/tools/pwa/music-cache-prototype.mjs');
    return await downloadRealSong(group,{storage:caches,origin:location.origin,subtle:crypto.subtle,
      fetcher:fetch.bind(window),concurrency:8});
  },fullBase);
  if(repaired.reused!==fullBase.entries.length-1)throw Error('Partial Full repair unnecessarily re-downloaded working stems');
  console.log('FULL REPAIRED ONE MISSING STEM',JSON.stringify(repaired));
  await context.setOffline(true);
  const before=await originalStemCheck('lite');
  if(!before.hashCorrect)throw Error('Upgraded mid-segment before explicit promotion');
  console.log('PENDING FULL (STILL LITE)',JSON.stringify(before));
  // A production caller must send this event only at a verified safe musical
  // boundary; here the developer driver explicitly authorizes the test.
  await setMode('high','full');
  const high=await originalStemCheck('full');
  if(!high.hashCorrect||high.channels!==1)throw Error('Explicit Full promotion failed');
  console.log('FULL AFTER EXPLICIT BOUNDARY',JSON.stringify(high));
  await setMode('saver','lite');
  const saver=await originalStemCheck('lite');
  if(!saver.hashCorrect)throw Error('Space saver failed to select Lite');
  console.log('SPACE-SAVER SELECTS LITE',JSON.stringify(saver));
  await setMode('off','lite');
  const disabledAgain=await page.evaluate(async url=>(await fetch(url,{cache:'no-store'})).status,required[0].lite.entries.find(e=>e.logicalUrl.endsWith('.ogg')).logicalUrl);
  if(disabledAgain!==503)throw Error('Music OFF must not retrieve audio');
  // User preferences don't delete either quality, even in OFF.
  const retained=await page.evaluate(async(groups)=>{
    const {isRealSongDownloaded}=await import('/tools/pwa/music-cache-prototype.mjs');
    const c={storage:caches,origin:location.origin,subtle:crypto.subtle};
    const a=[];for(const g of groups){a.push(await isRealSongDownloaded(g.lite,c));a.push(await isRealSongDownloaded(g.full,c));}
    return a;
  },required);
  if(!retained.every(Boolean)||errors.length)throw Error('Preferences destroyed audio cache or browser failed');
  console.log('FINAL PASS',JSON.stringify({lite,playing,high,saver,disabledAgain,retained,errors},null,2));
  await context.close();
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
