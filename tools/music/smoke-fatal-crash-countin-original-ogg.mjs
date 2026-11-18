import assert from 'node:assert/strict';
import {chromium} from 'playwright';

/** Real original OGG+Matter fatal-BSOD crash and deliberately unverified
 * synthetic clock, no duplicate song transport or physics delays. */
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
  '--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const url=process.env.GAME_URL||'http://127.0.0.1:8251/';
const snapshot=()=>page.evaluate(()=>{
  const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a?._stemMusic;
  const rec=a?._fatalCountIn;
  return {stage:a?.getFatalCountInStatus(),mode:a?._musicMode,
    musicWanted:a?._musicWanted,gamePaused:a?._paused,
    ctx:a?.ctx?.state,ctxTime:a?.ctx?.currentTime,
    trackId:d?.track?.id,started:d?.started,transportPaused:d?.transportPaused,
    token:d?._token,clockStart:d?.clockStart,
    currentPosition:a?.jukeboxSnapshot().position,
    activeSources:d?.activeNodes?.size,
    drumCueIndex:rec?.active?.sourceSegment,
    accentStarts:rec?.sources?.length,
    allGates:d?.mixer?.sources ?
      [...d.mixer.sources.values()].map(s=>s.recovery.gain.value):[],
    mixerRecovery:!!d?.mixer?.recoveryPlan,
    events:window.__fatalCountinBrowserEvents||[]};
});
try{
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),
    null,{timeout:30000});
  await page.keyboard.press('x');
  await page.waitForFunction(()=>{
    const a=window.__bbGame.registry.get('audioSynth');
    return a?._stemMusic?.ready&&a.ctx?.state==='running';
  },null,{timeout:30000});
  await page.evaluate(()=>{
    const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
    if(!d.started&&!d.transportPaused){
      g.scene.getScene('TitleScene').jukebox?.buttons?.[1]?.zone?.emit('pointerdown');
    }
  });
  await page.waitForFunction(()=>{
    const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;
    return d?.started&&d.pack&&d.activeNodes.size>=6&&
      d.ctx?.state==='running'&&!d._loading;
  },null,{timeout:50000});
  await page.evaluate(()=>{
    const g=window.__bbGame;
    window.__fatalCountinBrowserEvents=[];
    for(const [kind,id] of [['pause','bb:gamePause'],['resume','bb:gameResume'],
      ['crash','bb:crash'],['end','bb:runEnd'],['start','bb:runStart']])
      g.events.on(id,p=>window.__fatalCountinBrowserEvents.push({kind,
        negated:p?.negated??null}));
    g.scene.getScene('TitleScene').startRun('fatal-countin-real-original-music');
  });
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),
    null,{timeout:30000});
  const initial=await snapshot();
  assert.equal(initial.started,true);
  assert.ok(initial.trackId);
  console.log('ORIGINAL_SIX_STEM_REAL_GAME_INITIAL',JSON.stringify(initial));

  // Exactly the same genuine fatal BSOD wall collision as Control Friday's
  // independently validated real-game continuity smoke, not a fake CRASH.
  await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    g.loop.stop();
    r.bsod.wallX=r.sled.body.bounds.min.x+12;
    r.bsod.wallSpeedPxS=10000;
    g.headlessStep(8000,16.67);g.headlessStep(8017,16.67);
    if(!r.crashed||!r.bsodCaught)throw Error('Genuine fatal BSOD collision was not reached');
  });
  const crashed=await snapshot();
  assert.equal(crashed.stage.active,true);
  assert.equal(crashed.stage.trackId,initial.trackId);
  assert.equal(crashed.stage.verified,false);
  assert.ok(crashed.stage.runId?.length>3);
  assert.equal(crashed.stage.timingKind,'synthetic-unverified');
  assert.equal(crashed.stage.scheduledDrumAccents,4);
  assert.equal(crashed.accentStarts,4);
  assert.ok(crashed.mixerRecovery);
  assert.equal(crashed.trackId,initial.trackId);
  assert.equal(crashed.token,initial.token);
  assert.equal(crashed.clockStart,initial.clockStart);
  assert.ok(crashed.events.some(e=>e.kind==='crash'&&e.negated===false));
  assert.ok(crashed.events.some(e=>e.kind==='end'));
  assert.ok(!crashed.events.some(e=>e.kind==='pause'||e.kind==='resume'));
  assert.ok(crashed.allGates.every(n=>n<=1));
  console.log('GENUINE_FATAL_BSOD_STILL_RUNNING_ONE_SIX_STEM_CLOCK_FOUR_DRUM_SOURCES_PASS',
    JSON.stringify(crashed));
  await page.waitForFunction(()=>{
    const s=window.__bbGame.registry.get('audioSynth')?.getFatalCountInStatus();
    return s?.stage==='silent-beats';
  },null,{timeout:1200});
  const silence=await snapshot();
  assert.equal(silence.stage.stage,'silent-beats');
  assert.ok(silence.allGates.every(n=>n<.10));
  console.log('SCRATCH_THEN_REAL_WEBAUDIO_SOURCE_GATE_SILENCE_PASS',
    JSON.stringify({stage:silence.stage.stage,gateMax:Math.max(...silence.allGates)}));

  // An immediate retry is authoritative; audio never asks for delay and
  // does not restart scratch or count-in when RUN_START is emitted.
  await page.evaluate(()=>window.__bbGame.events.emit('bb:runStart',
    {seed:'immediate-retry-music-must-not-reset'}));
  const retry=await snapshot();
  assert.equal(retry.stage.generation,crashed.stage.generation);
  assert.deepEqual(retry.stage.beatOnsets,crashed.stage.beatOnsets);
  assert.equal(retry.trackId,crashed.trackId);
  assert.equal(retry.clockStart,crashed.clockStart);
  assert.equal(retry.token,crashed.token);
  assert.equal(retry.accentStarts,4);
  console.log('IMMEDIATE_RETRY_RETAINS_OLD_COUNTIN_AND_ORIGINAL_SONG_ANCHOR_PASS');

  await page.waitForFunction(()=>{
    const s=window.__bbGame.registry.get('audioSynth')?.getFatalCountInStatus();
    return s?.stage==='four-drum-count-in';
  },null,{timeout:3000});
  const drums=await snapshot();
  assert.equal(drums.stage.scheduledDrumAccents,4);
  assert.equal(drums.stage.stage,'four-drum-count-in');
  assert.ok(drums.allGates.every(n=>n<.10));
  assert.equal(drums.accentStarts,4);
  console.log('FOUR_EXISTING_OGG_DRUM_EXCERPTS_WITH_ALL_BAND_STEMS_MUTED_PASS',
    JSON.stringify({stage:drums.stage.stage,clipSegment:drums.stage.sourceSegment,
      clipOffset:drums.stage.sourceOffset,slots:drums.stage.beatOnsets}));

  await page.waitForFunction(()=>{
    const s=window.__bbGame.registry.get('audioSynth')?.getFatalCountInStatus();
    return s?.stage==='full-band'&&!s.active;
  },null,{timeout:4000});
  await page.waitForTimeout(70);
  const full=await snapshot();
  assert.equal(full.stage.stage,'full-band');
  assert.ok(full.allGates.every(n=>n>.94),
    'Normal source gains were not restored '+JSON.stringify(full.allGates));
  assert.equal(full.started,true);
  assert.equal(full.trackId,initial.trackId);
  assert.equal(full.clockStart,initial.clockStart);
  assert.equal(full.token,initial.token);
  assert.ok(full.currentPosition>crashed.currentPosition+2.4);
  console.log('ORIGINAL_FULL_BAND_REJOINS_WITHOUT_SEEK_OR_SECOND_PLAYER_PASS',
    JSON.stringify({secondsAdvanced:full.currentPosition-crashed.currentPosition,
      allGatesMin:Math.min(...full.allGates),song:full.trackId}));
  assert.deepEqual(errors,[]);
  console.log('FATAL_VINYL_COUNTIN_GENUINE_SIX_STEM_CHROMIUM_PASS');
}finally{await browser.close()}
