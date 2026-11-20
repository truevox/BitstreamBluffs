/** Issue #51: minified Chromium preview, real original OGG + YouTube artwork.
 * Browser context is disposable; no persistent user profile changes.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
 '--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const url=process.env.GAME_URL||'http://127.0.0.1:8292/';
const state=()=>page.evaluate(()=>{
 const g=window.__bbGame,run=g.scene.getScene('RunScene'),ui=g.scene.getScene('UIScene'),a=g.registry.get('audioSynth');
 const b=run?.songBillboard,cam=run?.cameras?.main;
 return {run:run?.sys?.isActive(),song:a?._stemMusic?.track?.id,
  sign:b?{active:b.active,trackId:b.trackId,hasVideo:b.hasVideo,elapsed:b.elapsedMs,
    texture:b.art?.texture?.key,draws:b.g?.visible,
    screenX:b.screenX,screenY:b.screenY}:null,
  map:ui?.minimap?{corner:ui.minimap.lastCorner,visible:ui.minimap.g.visible}:null,
  meter:a?.getSyntheticMeterTiming?.()||null,
  pulse:run?.worldDance?.meterPulse||0,
  strength:run?.worldDance?.strength||0,
  settings:g.registry.get('settings')};
});
try{
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 const artwork=await page.evaluate(()=>{
  const t=window.__bbGame.textures;
  return ['FEsxYVStla4','WRBGQUqD54U','FYImnz5-hXs'].map(id=>[id,t.exists('bb-youtube-'+id)]);
 });
 assert.ok(artwork.every(x=>x[1]),'The genuine YouTube thumbnail PNG/JPG assets did not preload');
 await page.keyboard.press('x');
 await page.waitForFunction(()=>{
  const a=window.__bbGame.registry.get('audioSynth');
  return a?._stemMusic?.ready&&a.ctx?.state==='running';
 },null,{timeout:30000});
 await page.evaluate(()=>{
  const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
  if(!d.started&&!d.transportPaused){
   const btn=g.scene.getScene('TitleScene').jukebox?.buttons?.[1]?.zone;
   if(!btn)throw Error('Missing jukebox play button');
   btn.emit('pointerdown');
  }
 });
 await page.waitForFunction(()=>{
  const a=window.__bbGame.registry.get('audioSynth');
  return a?._stemMusic?.started&&a._stemMusic?.activeNodes?.size>=6&&
    a._stemMusic.pack&&!a._stemMusic._loading;
 },null,{timeout:45000});
 await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('world-issue-51'));
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.sys?.isActive(),null,{timeout:25000});
 await page.waitForTimeout(160);
 const first=await state();
 assert.equal(first.run,true);
 assert.equal(first.sign.active,true,'First song did not get in-world billboard');
 assert.equal(first.sign.trackId,first.song);
 assert.ok(first.map?.corner,'Minimap did not render from real terrain');
 assert.equal(first.meter?.timingKind,'synthetic-unverified');
 console.log('WORLD_ISSUE51_BOOT_AND_BILLBOARD_PASS',JSON.stringify({artwork,first}));
 // Headless SwiftShader runs at a fraction of realtime. A sign should move
 // after the ACTUAL game elapsed clock crosses the initial camera settling
 // distance, not after an arbitrary wall-clock sleep.
 await page.waitForFunction(firstX=>{
  const b=window.__bbGame.scene.getScene('RunScene')?.songBillboard;
  return b?.active && b.elapsedMs>1400 && b.screenX<firstX-25;
 },first.sign.screenX,{timeout:35000});
 const second=await state();
 console.log('SCROLL_DIAGNOSTICS',JSON.stringify({first:first.sign,second:second.sign,run:second.run,song:second.song}));
 assert.ok(second.sign.elapsed>first.sign.elapsed);
 assert.ok(second.sign.screenX<first.sign.screenX-25,'Roadside sign did not scroll by');
 console.log('WORLD_ISSUE51_SIGN_SCROLL_PASS',JSON.stringify({firstX:first.sign.screenX,secondX:second.sign.screenX,corner:second.map.corner}));
 // Actual jukebox skip during gameplay; the sign and thumbnail must change.
 const current=second.song;
 await page.evaluate(()=>window.__bbGame.registry.get('audioSynth').jukeboxStep(1));
 await page.waitForFunction(old=>{
  const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a?._stemMusic;
  return d?.track?.id!==old && d?.pack?.id===d?.track?.id &&
    d.started && d.activeNodes?.size>=6 &&
    g.scene.getScene('RunScene')?.songBillboard?.trackId===d.track.id;
 },current,{timeout:45000});
 await page.waitForTimeout(150);
 const changed=await state();
 assert.equal(changed.sign.trackId,changed.song);
 assert.notEqual(changed.sign.trackId,current);
 assert.equal(changed.sign.active,true);
 if(changed.song!=='local-one-more-run-bitstream-bluffs'){
  assert.equal(changed.sign.hasVideo,true);
  assert.equal(changed.sign.texture,'bb-youtube-'+changed.song);
 }
 console.log('WORLD_ISSUE51_REAL_SONG_CHANGE_THUMBNAIL_PASS',JSON.stringify({old:current,new:changed.song,sign:changed.sign}));
 await page.evaluate(()=>window.__bbGame.registry.get('audioSynth').settings.musicVolume=0);
 await page.waitForTimeout(125);
 const muted=await state();
 assert.equal(muted.meter,null);
 assert.equal(muted.strength,0);
 assert.deepEqual(errors,[]);
 console.log('WORLD_ISSUE51_SILENCE_HALTS_DANCE_PASS');
}finally{await browser.close()}
