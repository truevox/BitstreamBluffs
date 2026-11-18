import { chromium } from 'playwright';
import assert from 'node:assert/strict';

/** Real original OGG + WebAudio + Gym integration, with a disposable TEST-ONLY
 * synthetic pulse grid. Proves transport/physics wiring, NOT musical validity.
 * The production beat-grid catalog is never changed.
 */
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
  '--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];
page.on('pageerror',e=>errors.push(String(e)));
try {
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:8241/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  await page.keyboard.press('x');
  await page.waitForFunction(()=>window.__bbGame.registry.get('audioSynth')?._stemMusic?.ready,
    null,{timeout:25000});
  await page.evaluate(()=>{
    const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
    if(!d.started){
      const btn=g.scene.getScene('TitleScene').jukebox?.buttons?.[1];
      if(!btn?.zone)throw Error('Real music cannot be started');
      btn.zone.emit('pointerdown');
    }
  });
  await page.waitForFunction(()=>{
    const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
    return d.started&&d.pack&&d.track?.id===d.pack.id&&d.ctx.state==='running'&&
      d.activeNodes.size>=6&&!d._loading;
  },null,{timeout:45000});
  await page.evaluate(()=>{
    const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
    const rate=d.pack.sampleRate,frames=d.pack.frameCount;
    const beatFrames=[];
    for(let t=.12;t<d.pack.duration-.12;t+=.25)beatFrames.push(Math.round(t*rate));
    // TEST-ONLY: this is an artificial quarter-note grid, not verified audio.
    a._beatGrids={[d.track.id]:{
      format:'bitstream-beat-grid-v1',trackId:d.track.id,
      sourceSampleRate:rate,sourceFrameCount:frames,
      sourceSha256:'a'.repeat(64),version:'TEST_ONLY_FAKE_GRID_DO_NOT_SHIP',
      status:'verified',confidence:.99,
      review:{humanSpotCheck:'passed',independentCheck:'passed'},
      sections:[{startFrame:0,endFrame:frames,status:'verified',confidence:.98,
        pulseFrames:beatFrames}],
    }};
    const store=g.registry.get('progression').store;
    g.registry.set('profile',store.save({...store.profile,bank:600,
      bsodGym:{discovered:true,owned:true}}));
    const originalGet=a.getBeatTiming.bind(a),originalCheck=a.isBeatTimingCurrent.bind(a);
    const proof={startMs:performance.now(),suggestions:[],checks:[],go:[],
      trackId:d.track.id,realAudio:true};
    window.__gymRealAudioProof=proof;
    a.getBeatTiming=opts=>{
      const timing=originalGet(opts),r=g.scene.getScene('RunScene');
      proof.suggestions.push({atMs:performance.now(),timing,
        runClock:r?.runTimeMs,wall:r?.bsod?.wallX});
      return timing;
    };
    a.isBeatTimingCurrent=timing=>{
      const valid=originalCheck(timing);
      proof.checks.push({atMs:performance.now(),valid,now:a.ctx.currentTime,
        due:timing.dueAudioTime});
      return valid;
    };
    g.events.on('bb:gymReadyGo',payload=>{
      const r=g.scene.getScene('RunScene');
      proof.go.push({atMs:performance.now(),onBeat:payload.onBeat,
        runClock:r.runTimeMs,wall:r.bsod.wallX,
        remaining:r.gymReadyMs,extra:r.gymBeatWaitMs});
    });
    g.scene.getScene('TitleScene').startRun('gym-original-ogg-test-only-pulse',0,{gym:true});
  });
  await page.waitForFunction(()=>window.__gymRealAudioProof?.go?.length>=1,
    null,{timeout:12000});
  const proof=await page.evaluate(()=>window.__gymRealAudioProof);
  assert.equal(proof.realAudio,true);
  assert.equal(proof.suggestions.length,1);
  assert.equal(proof.checks.length,1);
  assert.equal(proof.go.length,1);
  const suggested=proof.suggestions[0],go=proof.go[0],check=proof.checks[0];
  assert.equal(suggested.timing.trusted,true);
  assert.equal(suggested.timing.trackId,proof.trackId);
  assert.equal(suggested.timing.gridVersion,'TEST_ONLY_FAKE_GRID_DO_NOT_SHIP');
  assert.ok(suggested.timing.waitMs>0&&suggested.timing.waitMs<=300);
  assert.ok(go.atMs-proof.startMs>=850&&go.atMs-proof.startMs<1600);
  assert.ok(Math.abs(go.atMs-suggested.atMs-suggested.timing.waitMs)<100);
  assert.equal(go.remaining,0);
  assert.equal(go.extra,0);
  assert.equal(go.runClock,suggested.runClock);
  assert.equal(go.wall,suggested.wall);
  assert.equal(go.onBeat,check.valid);
  assert.deepEqual(errors,[]);
  console.log('REAL_OGG_PUBLIC_BEAT_API_TO_FROZEN_GYM_RELEASE_PASS',{
    trackId:proof.trackId,verifiedGrid:'TEST_ONLY_FAKE_GRID_DO_NOT_SHIP',
    recommendedWaitMs:Math.round(suggested.timing.waitMs),
    actualHoldMs:Math.round(go.atMs-suggested.atMs),
    totalReadyMs:Math.round(go.atMs-proof.startMs),
    withinMusicWindow:check.valid,onBeat:go.onBeat,
  });
} finally {await browser.close();}
