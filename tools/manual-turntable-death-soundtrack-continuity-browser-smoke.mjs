import {chromium} from 'playwright';
import assert from 'node:assert/strict';

/** Preserve preexisting game contract: natural death/Game Over is NOT a turntable
 * pause or music-stop request. Real six-stem OGG playback must continue.
 * The vinyl scratch itself is Music Friday-owned and not asserted here.
 */
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
 '--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try {
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:8241/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 await page.keyboard.press('x');
 await page.waitForFunction(()=>window.__bbGame.registry.get('audioSynth')?._stemMusic?.ready,null,{timeout:30000});
 await page.evaluate(()=>{
  const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
  if(!d.started){
   const play=g.scene.getScene('TitleScene').jukebox?.buttons?.[1]?.zone;
   if(!play)throw Error('Missing title jukebox Play');
   play.emit('pointerdown');
  }
 });
 await page.waitForFunction(()=>{
  const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;
  return d?.started&&d.pack&&d.activeNodes.size>=6&&d.ctx?.state==='running'&&!d._loading;
 },null,{timeout:45000});
 await page.evaluate(()=>{
  const g=window.__bbGame;
  window.__turntableDeathEvents=[];
  for(const [kind,id] of [['pause','bb:gamePause'],['resume','bb:gameResume'],
   ['crash','bb:crash'],['end','bb:runEnd']])
   g.events.on(id,()=>window.__turntableDeathEvents.push(kind));
  g.scene.getScene('TitleScene').startRun('turntable-death-soundtrack-continuity');
 });
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
 const result=await page.evaluate(()=>{
  const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic,
    r=g.scene.getScene('RunScene');
  g.loop.stop();
  const before={started:d.started,paused:d.transportPaused,position:a.jukeboxSnapshot().position,
    trackId:d.track?.id,clockStart:d.clockStart,token:d._token};
  r.bsod.wallX=r.sled.body.bounds.min.x+12;
  r.bsod.wallSpeedPxS=10000;
  g.headlessStep(8000,16.67);g.headlessStep(8017,16.67);
  const after={started:d.started,paused:d.transportPaused,position:a.jukeboxSnapshot().position,
    trackId:d.track?.id,clockStart:d.clockStart,token:d._token,
    crashed:r.crashed,bsodCaught:r.bsodCaught,events:window.__turntableDeathEvents};
  return {before,after};
 });
 assert.equal(result.before.started,true);
 assert.equal(result.before.paused,false);
 assert.equal(result.after.crashed,true);
 assert.equal(result.after.bsodCaught,true);
 assert.ok(result.after.events.includes('crash'));
 assert.ok(result.after.events.includes('end'));
 assert.equal(result.after.events.filter(e=>e==='pause'||e==='resume').length,0);
 assert.equal(result.after.started,true);
 assert.equal(result.after.paused,false);
 assert.equal(result.after.trackId,result.before.trackId);
 assert.equal(result.after.clockStart,result.before.clockStart);
 assert.equal(result.after.token,result.before.token);
 await page.waitForTimeout(450);
 const later=await page.evaluate(()=>{
  const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
  return {started:d.started,paused:d.transportPaused,
    position:a.jukeboxSnapshot().position,trackId:d.track?.id};
 });
 assert.equal(later.started,true);
 assert.equal(later.paused,false);
 assert.equal(later.trackId,result.before.trackId);
 assert.ok(later.position>result.after.position+.15,
   'Music stopped advancing after death '+JSON.stringify({after:result.after,later}));
 assert.deepEqual(errors,[]);
 console.log('REAL_OGG_FATAL_DEATH_KEEPS_SONG_CLOCK_WITHOUT_VINYL_EVENTS_PASS',{
  trackId:later.trackId,
  positions:[result.before.position,result.after.position,later.position].map(n=>Math.round(n*1000)),
  stableClockAnchor:true,manualPauseEvents:0,
 });
}finally{await browser.close();}
