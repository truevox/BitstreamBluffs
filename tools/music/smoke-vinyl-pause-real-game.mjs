/** Real Chromium, real OGG stems / actual shared pause events and jukebox.
 * All interactions occur in private loopback test profile and never modify game.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://127.0.0.1:8238/';
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
  '--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],failedRequests=[];
page.on('pageerror',error=>errors.push(String(error)));
page.on('response',response=>{
  if(response.status()>=400)failedRequests.push(`${response.status()}: ${response.url()}`);
});
const audioState=()=>page.evaluate(()=>{
  const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
  return {trackId:d.track?.id,packId:d.pack?.id,started:d.started,
    transportPaused:d.transportPaused,position:a.jukeboxSnapshot().position,
    savedOffset:d._resumeOffset,clockStart:d.clockStart,
    trackIndex:d.trackIndex,activeNodes:d.activeNodes.size,
    musicWanted:a._musicWanted,gamePaused:a._paused,
    autoPause:!!a._vinylPauseSession,manualOverride:a._vinylPauseSession?.manualOverride,
    pendingResume:!!a._vinylResume,
    ctx:a.ctx?.state,scratchLog:window.__vinylLog?.slice(),
    jukeboxMode:a._jukeboxMode};
});
const waitPlaying=()=>page.waitForFunction(()=>{
  const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
  return d.started&&d.pack&&d.activeNodes.size>=6&&
    !d._loading&&d.ctx?.state==='running';
},null,{timeout:45000});
try{
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),
    null,{timeout:30000});
  await page.keyboard.press('x');
  await page.waitForFunction(()=>{
    const a=window.__bbGame.registry.get('audioSynth');
    return a?._stemMusic?.ready && a.ctx?.state==='running';
  },null,{timeout:30000});
  // The newer continuous-music game auto-starts on the first gesture.
  // Blindly clicking the title jukebox's toggle would PAUSE that song!
  const needsPlayClick=await page.evaluate(()=>{
    const a=window.__bbGame.registry.get('audioSynth');
    return !a._musicWanted || a._stemMusic.transportPaused;
  });
  if(needsPlayClick){
    await page.waitForFunction(()=>{
      const j=window.__bbGame.scene.getScene('TitleScene').jukebox;
      return j?.buttons?.[1]&&!j.buttons[1].disabled;
    },null,{timeout:30000});
    await page.evaluate(()=>{
      const j=window.__bbGame.scene.getScene('TitleScene').jukebox;
      j.buttons[1].zone.emit('pointerdown');
    });
  }
  await waitPlaying();
  // Explicitly select original One More Run for a reliable real OGG test.
  const first=await audioState();
  if(first.trackId!=='local-one-more-run-bitstream-bluffs'){
    await page.evaluate(()=>{
      const j=window.__bbGame.scene.getScene('TitleScene').jukebox;
      j.buttons[2].zone.emit('pointerdown');
    });
    await page.waitForFunction(()=>{
      const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
      return d.track?.id==='local-one-more-run-bitstream-bluffs'&&
        d.pack?.id===d.track?.id&&d.activeNodes.size>=6&&!d._loading;
    },null,{timeout:45000});
  }
  await page.evaluate(()=>{
    const a=window.__bbGame.registry.get('audioSynth');
    window.__vinylLog=[];
    const original=a._vinylScratch.play.bind(a._vinylScratch);
    a._vinylScratch.play=(...args)=>{
      window.__vinylLog.push({direction:args[0],audioTime:a.ctx.currentTime});
      return original(...args);
    };
  });
  await page.waitForTimeout(500);
  const before=await audioState();
  assert.equal(before.trackId,'local-one-more-run-bitstream-bluffs');
  assert.ok(before.activeNodes>=6);
  assert.equal(before.ctx,'running');
  console.log('LIVE_ORIGINAL_ONE_MORE_RUN_PLAYING',JSON.stringify(before));

  // Use EXACT existing GAME_PAUSE contract, not guessed controls/physics events.
  await page.evaluate(()=>window.__bbGame.events.emit('bb:gamePause',{runTimeMs:12000,reason:'manual',runId:'browser-1',pauseToken:'browser-1:1'}));
  const frozen=await audioState();
  assert.equal(frozen.started,false);
  assert.equal(frozen.transportPaused,true);
  assert.equal(frozen.musicWanted,false);
  assert.equal(frozen.gamePaused,true);
  assert.equal(frozen.scratchLog.at(-1)?.direction,'pause');
  assert.ok(frozen.savedOffset>0);
  await page.waitForTimeout(340);
  const still=await audioState();
  assert.ok(Math.abs(still.position-frozen.position)<.005,
    'Music clock drifted during PauseScene hold');
  assert.equal(still.activeNodes,0);
  console.log('REAL_GAME_PAUSE_SAVED_EXACT_SONG_POSITION_PASS',JSON.stringify({
    before:before.position,paused:frozen.position,still:still.position,
    scratch:frozen.scratchLog,trackId:frozen.trackId}));

  await page.evaluate(()=>window.__bbGame.events.emit('bb:gameResume',{runTimeMs:12000,reason:'manual',runId:'browser-1',pauseToken:'browser-1:1'}));
  const immediate=await audioState();
  assert.equal(immediate.gamePaused,false);
  assert.equal(immediate.pendingResume,true);
  assert.equal(immediate.started,false);
  assert.equal(immediate.scratchLog.at(-1)?.direction,'resume');
  await page.waitForTimeout(85);
  assert.equal((await audioState()).started,false,
    'Premature music playback during rising scratch');
  await waitPlaying();
  const restored=await audioState();
  assert.equal(restored.trackId,before.trackId);
  assert.equal(restored.transportPaused,false);
  assert.equal(restored.scratchLog.length,2);
  // The scheduler's exact-frame gate should also be reflected in the HUD:
  // no visible 100–120ms backward jump while the first source is preparing.
  assert.ok(restored.position>=frozen.position-.005&&
    restored.position<frozen.position+3,
    'Resumed position appeared to rewind: '+JSON.stringify({frozen,restored}));
  assert.ok(restored.activeNodes>=6&&restored.activeNodes<=16,
    'Unexpected duplicate playback sources');
  console.log('REAL_GAME_RESUME_AFTER_RISING_SCRATCH_SAME_OFFSET_PASS',
    JSON.stringify({paused:frozen.position,resumed:restored.position,
      trackId:restored.trackId,nodes:restored.activeNodes,
      scratchEvents:restored.scratchLog}));

  // Rapid pause, resume and re-pause should cancel any stale resume timer.
  await page.evaluate(()=>window.__bbGame.events.emit('bb:gamePause',{reason:'manual',runId:'browser-1',pauseToken:'browser-1:2'}));
  await page.evaluate(()=>window.__bbGame.events.emit('bb:gameResume',{reason:'manual',runId:'browser-1',pauseToken:'browser-1:2'}));
  await page.waitForTimeout(45);
  await page.evaluate(()=>window.__bbGame.events.emit('bb:gamePause',{reason:'manual',runId:'browser-1',pauseToken:'browser-1:2'}));
  const interrupted=await audioState();
  assert.equal(interrupted.started,false);
  assert.equal(interrupted.pendingResume,false);
  assert.equal(interrupted.transportPaused,true);
  const interruptedPos=interrupted.position;
  await page.waitForTimeout(370);
  assert.ok(Math.abs((await audioState()).position-interruptedPos)<.005);
  await page.evaluate(()=>window.__bbGame.events.emit('bb:gameResume',{reason:'manual',runId:'browser-1',pauseToken:'browser-1:2'}));
  await waitPlaying();
  console.log('REAL_RAPID_PAUSE_RESUME_REPAUSE_CANCELS_STALE_TRANSPORT_PASS');

  // Pause in the actual music-active scene and deliberately select a new
  // song using the SAME JukeboxHUD pointer behavior as a real user.
  await page.evaluate(()=>{
    const g=window.__bbGame;
    g.events.emit('bb:gamePause',{runTimeMs:14000,reason:'manual',runId:'browser-1',pauseToken:'browser-1:3'});
    g.scene.start('PauseScene',{runTimeMs:14000});
  });
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('PauseScene')?.sys?.isActive(),
    null,{timeout:12000});
  const pauseMenu=await audioState();
  assert.equal(pauseMenu.transportPaused,true);
  await page.evaluate(()=>{
    const j=window.__bbGame.scene.getScene('PauseScene').jukebox;
    if(!j?.buttons?.[2])throw Error('Pause menu missing next control');
    j.buttons[2].zone.emit('pointerdown');
  });
  const afterSkip=await audioState();
  assert.notEqual(afterSkip.trackIndex,pauseMenu.trackIndex);
  assert.equal(afterSkip.transportPaused,true);
  assert.equal(afterSkip.musicWanted,false);
  assert.equal(afterSkip.manualOverride,true);
  const afterSkipScratchCount=afterSkip.scratchLog.length;
  // User chooses Play in PauseScene; this choice must win on GAME_RESUME.
  await page.evaluate(()=>{
    const j=window.__bbGame.scene.getScene('PauseScene').jukebox;
    j.buttons[1].zone.emit('pointerdown');
  });
  await waitPlaying();
  const menuPlayed=await audioState();
  assert.equal(menuPlayed.trackIndex,afterSkip.trackIndex);
  assert.equal(menuPlayed.musicWanted,true);
  assert.equal(menuPlayed.manualOverride,true);
  assert.equal(menuPlayed.scratchLog.length,afterSkipScratchCount);
  await page.evaluate(()=>window.__bbGame.events.emit('bb:gameResume',{runTimeMs:14000,reason:'manual',runId:'browser-1',pauseToken:'browser-1:3'}));
  await page.waitForTimeout(400);
  const postMenu=await audioState();
  assert.equal(postMenu.trackId,menuPlayed.trackId);
  assert.equal(postMenu.started,true);
  assert.equal(postMenu.scratchLog.length,afterSkipScratchCount,
    'Game resume incorrectly scratched over explicit jukebox action');
  console.log('REAL_PAUSE_MENU_JUKEBOX_SKIP_AND_PLAY_OVERRIDES_AUTO_RESTORE_PASS',
    JSON.stringify({pausedOriginal:pauseMenu.trackId,chosen:postMenu.trackId,
      scratchCount:postMenu.scratchLog.length,position:postMenu.position}));

  const count=postMenu.scratchLog.length;
  await page.evaluate(()=>window.__bbGame.events.emit('bb:crash',{negated:false}));
  assert.equal((await audioState()).scratchLog.length,count);
  console.log('REAL_CRASH_DOES_NOT_TRIGGER_VINYL_PASS');
  assert.deepEqual(errors,[],`Browser errors: ${errors}`);
  assert.deepEqual(failedRequests,[],`HTTP asset failures: ${failedRequests}`);
  console.log('VINYL_REAL_GAME_OGG_TRANSPORT_BROWSER_PASS');
} finally {await browser.close()}
