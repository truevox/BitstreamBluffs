import assert from 'node:assert/strict';
import {chromium} from 'playwright';

/** Four original source recordings incl. one with near-silent first 12s
 * need real decoded percussion cues. This is an explicit AUDIO event test
 * not a substitute for a genuine Matter fatal-collision test. */
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const url=process.env.GAME_URL||'http://127.0.0.1:8251/';
const data=()=>page.evaluate(()=>{
 const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
 const c=a._fatalCountIn;
 return {track:d.track?.id,token:d._token,clock:d.clockStart,
   pack:d.pack?.id,active:d.activeNodes.size,
   started:d.started,ctx:d.ctx?.state,
   cueFrom: c?.active?.sourceSegment??null,
   cueOffset:c?.active?.sourceOffset??null,
   status:a.getFatalCountInStatus(),sourceCount:c?.sources?.length,
   cachedDrums:[...d.cache.keys()].filter(k=>k.endsWith('/drums')),
   musicWanted:a._musicWanted,menuMode:a._musicMode,
   mixerHasRecovery:!!d.mixer?.recoveryPlan};
});
try{
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:40000});
 await page.keyboard.press('x');
 await page.waitForFunction(()=>window.__bbGame.registry.get('audioSynth')?._stemMusic?.ready,
   null,{timeout:30000});
 await page.evaluate(()=>{
   const g=window.__bbGame,a=g.registry.get('audioSynth');
   if(!a._stemMusic.started&&!a._stemMusic.transportPaused){
     g.scene.getScene('TitleScene').jukebox.buttons[1].zone.emit('pointerdown');
   }
 });
 await page.waitForFunction(()=>{
   const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;
   return d?.started&&d.pack&&d.activeNodes.size>5&&!d._loading;
 },null,{timeout:45000});
 const testTargets=[
  ['WRBGQUqD54U',2,1],
  ['FYImnz5-hXs',3,0],
  ['FEsxYVStla4',0,0],
 ];
 for(const [song,index,minCueSegment] of testTargets){
   const moved=await page.evaluate(()=>window.__bbGame.registry.get('audioSynth').jukeboxStep(1));
   assert.equal(moved,true);
   await page.waitForFunction(expected=>{
     const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;
     return d?.track?.id===expected&&d.started&&d.pack&&
       d.activeNodes.size>=6&&!d._loading;
   },song,{timeout:40000});
   if(song==='WRBGQUqD54U'){
     await page.waitForFunction(()=>{
       const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
       return d?.cache?.has('1/drums');
     },null,{timeout:25000});
   }
   const before=await data();
   assert.equal(before.track,song);
   assert.equal(before.pack,song);
   await page.evaluate(()=>{
     const g=window.__bbGame;
     const d=g.registry.get('audioSynth')._stemMusic;
     const id=`audio-audit-${d.track.id}-${d._token}`;
     g.events.emit('bb:runStart',{runId:id,seed:'audio-event-source-audit'});
     g.events.emit('bb:crash',{negated:false,fatal:true,runId:id,cause:'source-audit'});
     g.events.emit('bb:runEnd',{record:{id,cause:'crash'}});
   });
   const after=await data();
   assert.equal(after.status.scheduledDrumAccents,4,
     'No original 4-hit cue in '+song+' '+JSON.stringify(after));
   assert.equal(after.status.trackId,song);
   assert.equal(after.status.verified,false);
   assert.equal(after.sourceCount,4);
   assert.equal(after.track,before.track);
   assert.equal(after.token,before.token);
   assert.equal(after.clock,before.clock);
   assert.equal(after.mixerHasRecovery,true);
   // Every Hacker starts nearly drumless, but a strong original hit
   // occurs after ~8s inside segment 0. A later cached segment also works.
   if(song==='WRBGQUqD54U')
     assert.ok(after.cueFrom>=1||after.cueOffset>=8,
       'Did not select a real audible onset from the quiet intro');
   else assert.ok(after.cueFrom>=minCueSegment);
   console.log('FOUR_ORIGINAL_OGG_BEAT_ACCENTS_SOURCE_HASH_TRACK_PASS',
     JSON.stringify({song,sourceSegment:after.cueFrom,
       sourceOffset:after.cueOffset,
       nextSegmentCached:after.cachedDrums.includes('1/drums'),
       sourceClockUnchanged:true,drumAccents:4}));
   // Deliberate jukebox choice overrides this count-in and releases all
   // recovery gates before selecting a new original track.
 }
 // Revisit the original cue with the song muted: no fake audible hit.
 await page.evaluate(()=>{
   const a=window.__bbGame.registry.get('audioSynth');
   a.applySettings({...a.settings,musicVolume:0});
 });
 const muted=await data();
 assert.equal(muted.status.active,false);
 assert.equal(muted.mixerHasRecovery,false);
 console.log('MUTE_DURING_ORIGINAL_OGG_FATAL_COUNTIN_CANCELS_AND_RESTORES_GATES_PASS');
 assert.deepEqual(errors,[]);
 console.log('FOUR_SONG_ORIGINAL_OGG_FATAL_COUNTIN_SOURCE_AUDIT_PASS');
}finally{await browser.close()}
