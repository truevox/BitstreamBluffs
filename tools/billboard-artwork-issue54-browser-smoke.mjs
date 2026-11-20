/** Issue #54: minified Chromium preview, real original OGG, real song changes.
 * Session A uses the shipped catalog. Session B routes the catalog to add new
 * youtubeId metadata (bundled, remote-only, missing) and an explicit opt-out,
 * proving artwork follows catalog data with no source edit. Every frame is
 * checked: a visible sign never shows art that belongs to another song.
 *   GAME_URL=http://127.0.0.1:8293/ SHOT_DIR=/tmp/shots node tools/billboard-artwork-issue54-browser-smoke.mjs
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const url=process.env.GAME_URL||'http://127.0.0.1:8293/';
const shotDir=process.env.SHOT_DIR||null;
const catalog=JSON.parse(await readFile(new URL('../public/music/catalog.json',import.meta.url)));
const jpg=await readFile(new URL('../public/music/thumbnails/FEsxYVStla4.jpg',import.meta.url));
const OMR='local-one-more-run-bitstream-bluffs';
const GENERIC='bb-art-generic';

async function session(name,{catalogJson,expected,routes={}}){
 const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 const errors=[],ytimg=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/music/catalog.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(catalogJson)}));
 await page.route('https://i.ytimg.com/**',r=>{
  const u=r.request().url();ytimg.push(u);
  const hit=routes[u];
  return hit?r.fulfill({status:200,contentType:'image/jpeg',headers:{'access-control-allow-origin':'*'},body:hit})
   :r.fulfill({status:404,headers:{'access-control-allow-origin':'*'},body:''});
 });
 for(const [path,body] of Object.entries(routes))if(!path.startsWith('http'))
  await page.route('**/'+path,r=>body?r.fulfill({status:200,contentType:'image/jpeg',body}):r.fulfill({status:404,body:''}));
 try{
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  assert.equal(await page.evaluate(()=>window.__bbGame.textures.exists('bb-art-generic')),true,'generic art did not preload');
  await page.keyboard.press('x');
  await page.waitForFunction(()=>{const a=window.__bbGame.registry.get('audioSynth');return a?._stemMusic?.ready&&a.ctx?.state==='running';},null,{timeout:30000});
  await page.evaluate(()=>{
   const g=window.__bbGame,d=g.registry.get('audioSynth')._stemMusic;
   if(!d.started&&!d.transportPaused){const btn=g.scene.getScene('TitleScene').jukebox?.buttons?.[1]?.zone;if(!btn)throw Error('no jukebox play');btn.emit('pointerdown');}
  });
  await page.waitForFunction(()=>{const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;return d?.started&&d.pack&&!d._loading;},null,{timeout:45000});
  await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('artwork-issue-54'));
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.sys?.isActive(),null,{timeout:25000});
  // Per-frame audit of the sign: art key + title vs the song it announces.
  await page.evaluate(()=>{
   window.__signFrames=[];
   window.__bbGame.events.on('postrender',()=>{
    const b=window.__bbGame.scene.getScene('RunScene')?.songBillboard;
    if(b?.active&&b.art?.visible)window.__signFrames.push({id:b.trackId,key:b.art.texture.key,title:b.titleFull});
   });
  });
  const seen=new Map();
  for(let i=0;i<8&&seen.size<catalogJson.tracks.length;i++){
   const id=await page.evaluate(()=>window.__bbGame.registry.get('audioSynth')._stemMusic.track.id);
   await page.waitForFunction(id=>{const b=window.__bbGame.scene.getScene('RunScene')?.songBillboard;
    return b?.trackId===id&&b.active&&!b.artPending&&b.art.visible;},id,{timeout:30000});
   const sign=await page.evaluate(()=>{const b=window.__bbGame.scene.getScene('RunScene').songBillboard;
    return {id:b.trackId,artKey:b.artKey,hasVideo:b.hasVideo,youtubeId:b.youtubeId,title:b.titleFull,x:b.screenX,y:b.screenY};});
   assert.equal(sign.artKey,expected[id],`${name}: ${id} showed ${sign.artKey}, expected ${expected[id]}`);
   seen.set(id,sign);
   if(shotDir){
    await page.waitForFunction(()=>{const b=window.__bbGame.scene.getScene('RunScene').songBillboard;return b.screenX<420&&b.screenX>120;},null,{timeout:30000}).catch(()=>{});
    await page.screenshot({path:`${shotDir}/${name}-${id}.png`});
   }
   await page.evaluate(()=>window.__bbGame.registry.get('audioSynth').jukeboxStep(1));
   await page.waitForFunction(old=>{const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;
    return d?.track?.id!==old&&d?.pack?.id===d?.track?.id&&d.started;},id,{timeout:45000});
  }
  assert.equal(seen.size,catalogJson.tracks.length,`${name}: did not reach every song`);
  const frames=await page.evaluate(()=>window.__signFrames);
  const titles=Object.fromEntries(catalogJson.tracks.map(t=>[t.id,t.title.toUpperCase()]));
  const bad=frames.filter(f=>f.key!==expected[f.id]||f.title!==titles[f.id]);
  assert.equal(bad.length,0,`${name}: stale/mismatched sign frames ${JSON.stringify(bad.slice(0,3))}`);
  assert.deepEqual(errors,[],`${name}: page errors`);
  return {seen:[...seen.values()],frames:frames.length,ytimg};
 }finally{await browser.close();}
}

// A: shipped catalog. Three YouTube thumbnails, One More Run generic, zero YouTube requests (all bundled).
const shipped=Object.fromEntries(catalog.tracks.map(t=>[t.id,t.youtubeId?`bb-youtube-${t.youtubeId}`:GENERIC]));
assert.equal(shipped[OMR],GENERIC);
const a=await session('shipped',{catalogJson:catalog,expected:shipped});
assert.deepEqual(a.ytimg,[],'shipped catalog must not call YouTube at runtime');
console.log('ISSUE54_SHIPPED_CATALOG_PASS',JSON.stringify(a));

// B: new metadata only, no code change.
const routed={...catalog,tracks:catalog.tracks.map(t=>({
 [OMR]:{...t,youtubeId:'TESTVIDEO01'},          // newly confirmed ID, thumbnail bundled
 WRBGQUqD54U:{...t,youtubeId:null},             // a song with no YouTube ID (explicit opt-out)
 'FYImnz5-hXs':{...t,youtubeId:'TESTVIDEO02'},  // not bundled: one remote fetch
 FEsxYVStla4:{...t,youtubeId:'TESTVIDEO03'},    // missing everywhere: generic, no crash
}[t.id]||t))};
const b=await session('routed',{catalogJson:routed,
 expected:{[OMR]:'bb-youtube-TESTVIDEO01',WRBGQUqD54U:GENERIC,'FYImnz5-hXs':'bb-youtube-TESTVIDEO02',FEsxYVStla4:GENERIC},
 routes:{'music/thumbnails/TESTVIDEO01.jpg':jpg,'music/thumbnails/TESTVIDEO02.jpg':null,'music/thumbnails/TESTVIDEO03.jpg':null,
  'https://i.ytimg.com/vi/TESTVIDEO02/mqdefault.jpg':jpg}});
assert.deepEqual([...b.ytimg].sort(),['https://i.ytimg.com/vi/TESTVIDEO02/mqdefault.jpg','https://i.ytimg.com/vi/TESTVIDEO03/mqdefault.jpg'],
 'each unbundled ID must be requested from YouTube exactly once');
console.log('ISSUE54_CATALOG_METADATA_PASS',JSON.stringify(b));
