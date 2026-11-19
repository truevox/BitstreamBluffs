import assert from 'node:assert/strict';
import {chromium} from 'playwright';

/** Control-owned integration gate for the Music Friday fatal-count-in commit.
 * Unlike the music-side synthetic RUN_START test, this exercises actual
 * Matter fatal collision -> GameOverScene -> retry() -> next RunScene.
 * The ORIGINAL six-stem OGG and true WebAudio clock continue independently.
 * A synthetic 0.5s musical pulse in the audio implementation is explicitly
 * UNVERIFIED research timing and must never enter the released beat catalog.
 * Do not run until the music-owned controller has been committed/integrated.
 */
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
  '--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const url=process.env.GAME_URL||'http://127.0.0.1:8245/';
const snap=()=>page.evaluate(()=>{
  const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a?._stemMusic;
  if(typeof a?.getFatalCountInStatus!=='function')
    throw Error('Music Friday fatal-count-in audio is NOT YET integrated; this gate is pending');
  const s=a.getFatalCountInStatus();
  const r=g.scene.getScene('RunScene');
  return {stage:s,trackId:d?.track?.id,started:d?.started,
    transportPaused:d?.transportPaused,clockStart:d?.clockStart,
    transportToken:d?._token,position:a.jukeboxSnapshot().position,
    originalStemVoices:d?.activeNodes?.size,
    drumCueSources:a._fatalCountIn?.sources?.length,
    runActive:r?.sys?.isActive(),runId:r?.runId,
    runClock:r?.runTimeMs,crashed:r?.crashed,
    gameOverActive:g.scene.getScene('GameOverScene')?.sys?.isActive(),
    events:window.__realFatalRetryEvents||[],
  };
});
try {
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  await page.keyboard.press('x');
  await page.waitForFunction(()=>{
    const a=window.__bbGame.registry.get('audioSynth');
    return a?._stemMusic?.ready&&a.ctx?.state==='running';
  },null,{timeout:30000});
  await page.evaluate(()=>{
    const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
    if(!d.started&&!d.transportPaused){
      const btn=g.scene.getScene('TitleScene').jukebox?.buttons?.[1]?.zone;
      if(!btn)throw Error('Missing title jukebox Play');
      btn.emit('pointerdown');
    }
  });
  await page.waitForFunction(()=>{
    const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;
    return d?.started&&d.pack&&d.activeNodes.size>=6&&d.ctx?.state==='running'&&!d._loading;
  },null,{timeout:45000});
  await page.evaluate(()=>{
    const g=window.__bbGame,a=g.registry.get('audioSynth');
    if(typeof a.getFatalCountInStatus!=='function')
      throw Error('Fatal music feature is not integrated yet');
    window.__realFatalRetryEvents=[];
    for(const [name,key] of [['start','bb:runStart'],['crash','bb:crash'],
      ['end','bb:runEnd'],['pause','bb:gamePause'],
      ['resume','bb:gameResume'],['gymReset','bb:gymAttemptReset']])
      g.events.on(key,p=>window.__realFatalRetryEvents.push({name,
        fatal:p?.fatal,runId:p?.runId||p?.record?.id||null}));
    g.scene.getScene('TitleScene').startRun('fatal-audio-real-retry');
  });
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
  const before=await snap();
  assert.equal(before.started,true);
  assert.ok(before.trackId);
  await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    g.loop.stop();
    r.bsod.wallX=r.sled.body.bounds.min.x+12;
    r.bsod.wallSpeedPxS=10000;
    g.headlessStep(8000,16.67);g.headlessStep(8017,16.67);
    if(!r.crashed||!r.bsodCaught)throw Error('Did not reach actual fatal BSOD collision');
  });
  const crashed=await snap();
  assert.equal(crashed.crashed,true);
  assert.equal(crashed.stage.active,true,'Fatal soundtrack recovery never began');
  assert.equal(crashed.stage.verified,false);
  assert.equal(crashed.stage.timingKind,'synthetic-unverified');
  assert.equal(crashed.stage.scheduledDrumAccents,4);
  assert.equal(crashed.drumCueSources,4);
  assert.equal(crashed.trackId,before.trackId);
  assert.equal(crashed.clockStart,before.clockStart);
  assert.equal(crashed.transportToken,before.transportToken);
  assert.equal(crashed.events.filter(e=>e.name==='crash'&&e.fatal===true).length,1);
  assert.equal(crashed.events.filter(e=>e.name==='end').length,1);

  // Advance only the game's 950ms death animation in simulated frames.
  // Real music time is not sped up; the count-in is still in progress.
  await page.evaluate(()=>{
    const g=window.__bbGame;
    for(let i=0;i<25;i++)g.headlessStep(9000+i*50,50);
  });
  const gameover=await snap();
  assert.equal(gameover.gameOverActive,true);
  assert.equal(gameover.stage.generation,crashed.stage.generation);
  assert.deepEqual(gameover.stage.beatOnsets,crashed.stage.beatOnsets);
  assert.equal(gameover.trackId,before.trackId);
  assert.equal(gameover.clockStart,before.clockStart);

  // ACTUAL GameOverScene.retry(), not an event-emitter simulation.
  // Headless Chromium has its RAF loop stopped, so explicitly flush the
  // queued Phaser scene changes with a handful of ordinary gameplay frames.
  await page.evaluate(()=>{
    const g=window.__bbGame;
    g.scene.getScene('GameOverScene').retry();
    for(let i=0;i<5;i++)g.headlessStep(12000+i*16.67,16.67);
  });
  const resumed=await snap();
  assert.equal(resumed.runActive,true,'Game Over retry was blocked');
  assert.equal(resumed.crashed,false);
  assert.notEqual(resumed.runId,before.runId);
  assert.equal(resumed.stage.generation,crashed.stage.generation,
    'Retry canceled/restarted the original count-in');
  assert.deepEqual(resumed.stage.beatOnsets,crashed.stage.beatOnsets);
  assert.equal(resumed.stage.bandAt,crashed.stage.bandAt);
  assert.equal(resumed.trackId,before.trackId);
  assert.equal(resumed.clockStart,before.clockStart);
  assert.equal(resumed.transportToken,before.transportToken);
  assert.equal(resumed.drumCueSources,4);
  assert.equal(resumed.events.filter(e=>e.name==='start').length,2);
  assert.equal(resumed.events.filter(e=>e.name==='crash'&&e.fatal===true).length,1);
  assert.equal(resumed.events.filter(e=>e.name==='end').length,1);
  assert.equal(resumed.events.filter(e=>e.name==='pause'||e.name==='resume').length,0);
  console.log('FATAL_COUNTIN_REAL_GAMEOVER_RETRY_KEEPS_EXACT_CUES_PASS',{
    oldRunId:before.runId,newRunId:resumed.runId,
    countInGeneration:resumed.stage.generation,trackId:resumed.trackId,
    sourceAccents:resumed.drumCueSources,
  });

  await page.waitForFunction(()=>{
    const a=window.__bbGame.registry.get('audioSynth');
    const s=a?.getFatalCountInStatus?.();
    return s?.stage==='full-band'&&s.active===false;
  },null,{timeout:6500});
  await page.waitForTimeout(80);
  const completed=await snap();
  assert.equal(completed.trackId,before.trackId);
  assert.equal(completed.clockStart,before.clockStart);
  assert.equal(completed.transportToken,before.transportToken);
  assert.equal(completed.started,true);
  assert.equal(completed.transportPaused,false);
  assert.ok(completed.position>before.position+2.5);
  assert.equal(completed.events.filter(e=>e.name==='crash'&&e.fatal===true).length,1);
  assert.deepEqual(errors,[]);
  console.log('FATAL_COUNTIN_BAND_REJOINS_IN_NEW_LIVE_RUN_WITHOUT_SEEK_PASS',{
    song:completed.trackId,elapsedOriginalMusicSeconds:
      Math.round(1000*(completed.position-before.position))/1000,
    sameClock:true,sameTransport:true,
  });
}finally{await browser.close();}
