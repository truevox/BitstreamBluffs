import { chromium } from 'playwright';
import assert from 'node:assert/strict';

/** Gameplay integration check. Fake timing snapshots are ONLY in the ephemeral
 * test browser, and do not certify any released recording's musical beat grid.
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
  await page.evaluate(()=>{
    const g=window.__bbGame,store=g.registry.get('progression').store;
    g.registry.set('profile',store.save({...store.profile,bank:600,
      bsodGym:{discovered:true,owned:true}}));
    g.scene.getScene('TitleScene').startRun('gym-music-integration-fail-closed',0,{gym:true});
  });
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
  const result=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),a=g.registry.get('audioSynth');
    if(!a?.getBeatTiming||!a?.isBeatTimingCurrent)throw Error('Music Friday public API unavailable');
    g.loop.stop();
    const events=[];
    g.events.on('bb:gymReadyGo',e=>events.push(e));
    const originalGet=a.getBeatTiming,originalCheck=a.isBeatTimingCurrent;
    const originalCtx=a.ctx;
    let stepId=0;
    const step=ms=>g.headlessStep(100000+(++stepId)*ms,ms);
    const snap=()=>({ready:r.gymReadyMs,extra:r.gymBeatWaitMs,
      wall:r.bsod.wallX,clock:r.runTimeMs,x:r.sled.x,events:events.length});
    const frozen=(a,b)=>a.wall===b.wall&&a.clock===b.clock&&a.x===b.x;
    let realFallback,unverified,valid,changed,throwing,oversized,reset;
    try {
      realFallback=a.getBeatTiming({maxWaitMs:300});
      for(let i=0;i<22&&r.gymReadyMs>0;i++)step(50);
      unverified={realTrusted:realFallback.trusted,after:snap(),payload:events.at(-1)};
      if(r.gymReadyMs!==0||events.length!==1||r.gymBeatWaitMs!==0)
        throw Error('Released songs failed immediate READY/GO fallback');
      // HeadlessStep advances simulated frame time without advancing the real
      // WebAudio clock. Pin a TEST-ONLY audio clock for deterministic countdown
      // scenarios; the separate real-OGG smoke verifies actual clock release.
      a.ctx={currentTime:20,state:'running'};
      function run(name,mode){
        let queries=0,checks=0;
        const now=Number.isFinite(a.ctx?.currentTime)?a.ctx.currentTime:20;
        const timing={trusted:true,release:'on-beat',waitMs:200,
          audioContextTime:now,dueAudioTime:now+.2,
          trackId:'TEST_ONLY_SYNTHETIC_BEAT',transportRevision:'test:1',
          confidence:.97,gridVersion:'TEST_ONLY'};
        a.getBeatTiming=opts=>{
          queries++;
          if(opts.maxWaitMs!==300)throw Error('No 300ms music cap');
          if(mode==='throw')throw Error('simulated music failure');
          if(mode==='oversize')return {...timing,waitMs:1200,dueAudioTime:now+1.2};
          return timing;
        };
        a.isBeatTimingCurrent=()=>{checks++;return mode!=='stale';};
        r.resetBsodGym();
        const origin=snap(),goBefore=events.length;
        for(let i=0;i<19;i++)step(50);
        const before=snap();
        step(50);
        const boundary=snap();
        const shouldWait=mode==='valid'||mode==='stale'||mode==='cancel';
        if(shouldWait){
          if(boundary.extra!==200||boundary.events!==goBefore)
            throw Error(name+' did not honor trusted optional hold');
          step(100);
          const middle=snap();
          if(middle.extra!==100||!frozen(origin,middle)||middle.events!==goBefore)
            throw Error(name+' failed frozen optional beat wait');
          if(mode==='cancel'){
            r.resetBsodGym();
            const canceled=snap();
            return {name,queries,checks,before,boundary,middle,canceled,
              pending:r.gymBeatSnapshot!==null,goBefore,after:events.length};
          }
          step(100);
        }
        const after=snap(),last=events.at(-1);
        step(16.67);
        const running=snap();
        return {name,queries,checks,origin,before,boundary,after,running,
          goBefore,payload:last,wasFrozen:frozen(origin,after)};
      }
      valid=run('trusted-200ms','valid');
      changed=run('stale-200ms','stale');
      throwing=run('throwing-api','throw');
      oversized=run('malformed-1200ms','oversize');
      reset=run('cancel-on-retry','cancel');
    } finally {
      a.getBeatTiming=originalGet;
      a.isBeatTimingCurrent=originalCheck;
      a.ctx=originalCtx;
    }
    return {unverified,valid,changed,throwing,oversized,reset,errors:[],goPayloads:events};
  });
  assert.equal(result.unverified.realTrusted,false);
  assert.equal(result.unverified.payload.onBeat,false);
  for(const v of [result.valid,result.changed]){
    assert.equal(v.queries,1);
    assert.equal(v.checks,1);
    assert.equal(v.after.events,v.goBefore+1);
    assert.equal(v.after.extra,0);
    assert.equal(v.wasFrozen,true);
    assert.ok(v.running.clock>v.after.clock);
    assert.ok(v.running.wall>v.after.wall);
  }
  assert.equal(result.valid.payload.onBeat,true);
  assert.equal(result.changed.payload.onBeat,false);
  for(const v of [result.throwing,result.oversized]){
    assert.equal(v.queries,1);
    assert.equal(v.checks,0);
    assert.equal(v.boundary.extra,0);
    assert.equal(v.after.events,v.goBefore+1);
    assert.equal(v.wasFrozen,true);
    assert.equal(v.payload.onBeat,false);
  }
  assert.equal(result.reset.queries,1);
  assert.equal(result.reset.checks,0);
  assert.equal(result.reset.pending,false);
  assert.equal(result.reset.canceled.extra,0);
  assert.ok(result.reset.canceled.ready>950);
  assert.equal(result.reset.after,result.reset.goBefore);
  assert.deepEqual(errors,[]);
  console.log('GYM_MUSIC_INTEGRATION_FAIL_CLOSED_AND_VERIFIED_PATH_PASS',{
    realReleaseCatalog:'unverified',trustedDelayMs:200,
    staleFallback:true,throwFallback:true,oversizeFallback:true,
    canceledOnRetry:true,totalGoEvents:result.goPayloads.length,
  });
} finally {await browser.close();}
