#!/usr/bin/env node
/* No publication. Verifies installed source/melody media and 33-song UI in an isolated browser. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://100.115.120.66:8213/';
const expected=Number(process.env.EXPECTED_PACKS||5);
const targetId=process.env.TARGET_SONG||'ehy7VzQezYA';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle',
 '--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1280,height:800}});
const page=await context.newPage();const errors=[],bad=[],fetched=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{
 if(r.status()>=400)bad.push([r.status(),r.url()]);
 if(r.url().endsWith('.ogg'))fetched.push(r.url());
});
try{
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(count=>{
  const g=window.__bbGame;return g?.registry?.get('audioSynth')?._stemMusic?.catalog?.length===count&&
   g.scene.getScene('TitleScene').sys.isActive();
 },expected,{timeout:40000});
 const settingsUI=await page.evaluate(()=>{
  const g=window.__bbGame;const t=g.scene.getScene('TitleScene');
  const selection=g.registry.get('audioSynth').settings.musicEnabledSongs;
  t.menu.items.find(i=>i.label==='SETTINGS').onSelect();
  const settings=t.view;settings.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
  const sound=settings.soundView;
  const selector=sound.menu.items.find(i=>i.label==='SELECT TRACKS (33)');
  if(!selector)throw Error('33-song selector missing');
  selector.onSelect();const library=sound.libraryView;
  const pages=[];
  for(let i=0;i<5;i++){
   pages.push(library.menu.items.filter(item=>item.kind==='choice').length);
   if(i<4)library._changePage(1);
  }
  const lastSongItem=library.menu.items.filter(i=>i.kind==='choice').at(-1);
  const finalSong=lastSongItem.label;
  const activePrior=lastSongItem.get();lastSongItem.set(!activePrior);
  const changed=lastSongItem.get();lastSongItem.set(activePrior);
  library.destroy();sound.libraryView=null;
  return {settingsKeys:Object.keys(selection).length,pages,
   finalSong,changed,restored:lastSongItem.get(),installed:g.registry.get('audioSynth')._stemMusic.catalog.length};
 });
 assert.equal(settingsUI.settingsKeys,33);
 assert.deepEqual(settingsUI.pages,[8,8,8,8,1]);
 assert.equal(settingsUI.restored,true);
 console.log('SONG_LIBRARY_PAGED_UI_PASS',JSON.stringify(settingsUI));
 // Fresh page discards the research-only UI changes, keeps same isolated browser.
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(count=>window.__bbGame?.registry?.get('audioSynth')?._stemMusic?.catalog.length===count,expected,{timeout:40000});
 await page.keyboard.press('x');
 await page.evaluate((targetId)=>{
  const g=window.__bbGame;const settings=g.registry.get('settings');
  settings.musicEnabledSongs=Object.fromEntries(Object.keys(settings.musicEnabledSongs).map(id=>[
   id,id===targetId]));
  g.events.emit('bb:settingsChanged',{key:'musicEnabledSongs',value:settings.musicEnabledSongs,settings});
  g.scene.getScene('TitleScene').startRun('33-library-original-stem-smoke');
 },targetId);
 await page.waitForFunction(targetId=>{
  const d=window.__bbGame?.registry?.get('audioSynth')?._stemMusic;
  return d?.pack?.id===targetId&&d.activeNodes.size>0;
 },targetId,{timeout:40000});
 const audio=await page.evaluate(()=>{
  const g=window.__bbGame;const d=g.registry.get('audioSynth')._stemMusic;
  return {id:d.pack.id,voices:d.pack.sourceNames.filter(s=>s.startsWith('voice:')).length,
   stems:d.pack.sourceNames.length,sourceFrames:d.pack.frameCount,
   duration:d.pack.duration,activeNodes:d.activeNodes.size};
 });
 assert.equal(audio.id,targetId);
 assert.equal(audio.voices,12);
 assert.equal(audio.stems,18);
 assert.ok(audio.duration>150);
 assert.ok(audio.activeNodes>0);
 console.log('PRIVATE_NEW_SONG_REAL_OPUS_PLAYBACK_PASS',JSON.stringify(audio));
 assert.deepEqual(errors,[]);
 const legacyFallbacks=bad.filter(([code,url])=>code===404&&
   /\/music\/packs\/[^/]+\/adaptive\/debutmont\//.test(url));
 const unexpected=bad.filter(x=>!legacyFallbacks.includes(x));
 assert.deepEqual(unexpected,[],'Unexpected HTTP errors (exclude known and tested old Debumont fallback)');
 assert.ok(fetched.length>=6,'Expected actual original stem + melody OGG network requests');
 console.log('PRIVATE_SONG_LIBRARY_SMOKE_PASS',JSON.stringify({fetched:fetched.length,pageErrors:errors.length,badResources:unexpected.length,legacyCanonicalPathMisses:legacyFallbacks.length}));
} finally {await browser.close();}
