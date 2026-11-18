import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({headless:true,args:[
 '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
 '--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try {
  await page.goto(process.env.GAME_URL||'http://100.115.120.66:8225/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  await page.evaluate(()=>{
    const g=window.__bbGame,store=g.registry.get('progression').store;
    const prof=store.save({...store.profile,bank:500,
      bsodGym:{discovered:true,owned:true}});
    g.registry.set('profile',prof);
    g.scene.getScene('TitleScene').startRun('astra-gym-failure-isolation',0,{gym:true});
  });
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive()
    && window.__bbGame?.scene?.getScene('UIScene')?.sys?.isActive(),
    null,{timeout:30000});

  const result=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),u=g.scene.getScene('UIScene');
    g.loop.stop();
    const original={
      bank:g.registry.get('profile').bank,
      lifetime:JSON.stringify(g.registry.get('profile').lifetime),
      record:g.registry.get('lastRecord'),
      tutorialDone:localStorage.getItem('bb.tutorialDone'),
      tuckShows:localStorage.getItem('bb.tuckShows'),
    };
    // Exercise the tutorial path while in Gym without consuming future normal-run hints.
    r.tutDoneId('flip');
    r.applyHintEvents([{id:'tuck',show:true}]);
    const tutorialSame=localStorage.getItem('bb.tutorialDone')===original.tutorialDone
      && localStorage.getItem('bb.tuckShows')===original.tuckShows;

    // Project genuinely visible state into the HUD prior to collision.
    g.events.emit('bb:shardCollected',{count:7,chain:3,points:30,total:90});
    g.events.emit('bb:comboChanged',{multiplier:2.5,
      tricks:[{type:'frontflip'}],pendingPoints:200,reason:'trick'});
    g.events.emit('bb:hazardHit',{effect:'slow',durationMs:8000,hazardId:'groomerCat'});
    g.events.emit('bb:powerupCollected',{id:'packetBurst',durationMs:8000});
    const before={shards:u.shards,chain:u.chain,multiplier:u.multiplier,
      combo:u.comboInfo.main.text,shardVisible:u.shardText.visible,
      hazardTags:u.effects.size,powerups:u.powerups.size};
    // Prepare the full interrupted-attempt state including powered & biome effects.
    r.score.addBonus(1245,'nearMiss');r.emitScore();
    r.nearMissCount=6;r.shardCount=7;r.shardTotal=90;r.shardChain=3;
    r.shardChainAt=r.runTimeMs;r.trickCounts={frontflip:6};r._airTricks=6;
    r._landings=3;r.bestCombo=2.5;r.safeSamples.push({t:0,x:r.sled.x-20});
    r.slowMs=6000;r.scrambleMs=5000;r.sled.scrambled=true;
    r.boostMs=6000;r.boostId='packetBurst';r.boostFactor=2;
    r.slowmoMs=6000;r.glideMs=6000;r.glideId='slickWaxSpray';
    r.stabilizeMs=6000;r.stabilizeId='gravityStabilizer';
    r.blindMs=6000;
    r.wards.wards.push({id:'mapleWax'});

    const badObserver=()=>{throw Error('injected third-party BSOD listener crash');};
    g.events.on('bb:bsodStateChanged',badObserver);
    const au=g.registry.get('audio');
    const stem=au?._stemMusic;
    const originalMixer=stem?.setBsodDanger;
    if(stem) stem.setBsodDanger=()=>{throw Error('injected music-DSP crash');};
    const seen=[];g.events.on('bb:gymAttemptReset',p=>seen.push(p.attempt));
    try {
      r.bsod.wallX=r.sled.body.bounds.min.x+12;r.bsod.wallSpeedPxS=10000;
      g.headlessStep(6000,16.67);g.headlessStep(6017,16.67);
    } finally {
      g.events.off('bb:bsodStateChanged',badObserver);
      if(stem)stem.setBsodDanger=originalMixer;
    }
    const after={
      score:r.score.getTotal(),bonus:r.score.bonusPoints,
      shards:u.shards,chain:u.chain,visible:u.shardText.visible,
      chainVisible:u.chainText.visible,combo:u.comboInfo.main.text,
      multiplier:u.multiplier,pending:u.pending,
      hazardTags:u.effects.size,powerups:u.powerups.size,
      shardTotal:r.shardTotal,airTricks:r._airTricks,landings:r._landings,
      slowMs:r.slowMs,scrambleMs:r.scrambleMs,boostMs:r.boostMs,
      slowmoMs:r.slowmoMs,glideMs:r.glideMs,
      stabilizeMs:r.stabilizeMs,blindMs:r.blindMs,wards:r.wards.wards.length,
      safeSamples:r.safeSamples.length,
      distance:r.score.distanceM,attemptX:r.gymAttemptStartX,
      gymRetries:r.gymRetries,brokenObserverLogged:r._bsodObserverErrorLogged===true,
      recordUnchanged:g.registry.get('lastRecord')===original.record,
      bankUnchanged:g.registry.get('profile').bank===original.bank,
      lifetimeUnchanged:JSON.stringify(g.registry.get('profile').lifetime)===original.lifetime,
    };
    // Check the second actual wall contact, not just the first reset path.
    r.bsod.wallX=r.sled.body.bounds.min.x+12;r.bsod.wallSpeedPxS=10000;
    g.headlessStep(6033,16.67);g.headlessStep(6050,16.67);
    return {before,after,resetEvents:seen,secondRetries:r.gymRetries,
      tutorialSame,crashed:r.crashed};
  });
  console.log(JSON.stringify(result,null,2));
  assert.equal(result.tutorialSame,true);
  assert.ok(result.before.shards>0 && result.before.hazardTags>0);
  assert.ok(result.before.powerups>0);
  assert.ok(result.after.gymRetries>=1);
  assert.ok(result.secondRetries>=2);
  assert.ok(result.after.score<100);
  assert.equal(result.after.bonus,0);
  assert.equal(result.after.shards,0);
  assert.equal(result.after.chain,0);
  assert.equal(result.after.visible,false);
  assert.equal(result.after.chainVisible,false);
  assert.equal(result.after.combo,'');
  assert.equal(result.after.multiplier,1);
  assert.equal(result.after.pending,0);
  assert.equal(result.after.hazardTags,0);
  assert.equal(result.after.powerups,0);
  for(const k of ['shardTotal','airTricks','landings','slowMs','scrambleMs',
    'boostMs','slowmoMs','glideMs','stabilizeMs','blindMs','wards'])
    assert.equal(result.after[k],0,k);
  assert.ok(result.after.distance<1);
  assert.equal(result.after.brokenObserverLogged,true);
  assert.equal(result.after.recordUnchanged,true);
  assert.equal(result.after.bankUnchanged,true);
  assert.equal(result.after.lifetimeUnchanged,true);
  assert.equal(result.crashed,false);
  assert.equal(result.resetEvents.length,2);
  assert.deepEqual(errors,[]);
  console.log('ASTRA_GYM_MULTIPLE_RETRIES_HUD_EFFECTS_TUTORIAL_AUDIO_FAULT_PASS');

  // A standard (non-Gym) crash must still finish if an audio subscriber throws,
  // especially when the deletion wall emits another inactive/reset event.
  const ordinary=await browser.newPage({viewport:{width:1280,height:800}});
  ordinary.on('pageerror',e=>errors.push(String(e)));
  try {
    await ordinary.goto(process.env.GAME_URL||'http://100.115.120.66:8225/',{waitUntil:'domcontentloaded'});
    await ordinary.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),
      null,{timeout:30000});
    await ordinary.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('astra-audio-fault-non-gym'));
    await ordinary.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),
      null,{timeout:30000});
    const normal=await ordinary.evaluate(()=>{
      const g=window.__bbGame,r=g.scene.getScene('RunScene');
      const caught=[],badObserver=()=>{throw Error('third-party listener failed')};
      g.events.on('bb:crash',e=>caught.push(e.cause));
      g.events.on('bb:bsodStateChanged',badObserver);
      g.loop.stop();
      const audio=g.registry.get('audio'),stem=audio?._stemMusic;
      const original=stem?.setBsodDanger;
      if(stem)stem.setBsodDanger=()=>{throw Error('broken DSP')};
      try {
        r.bsod.wallX=r.sled.body.bounds.min.x+12;r.bsod.wallSpeedPxS=10000;
        g.headlessStep(8000,16.67);g.headlessStep(8017,16.67);
      } finally {
        g.events.off('bb:bsodStateChanged',badObserver);
        if(stem)stem.setBsodDanger=original;
      }
      return {crashed:r.crashed,bsodCaught:r.bsodCaught,active:r.bsod.active,
        causes:caught,exceptionContained:r._bsodObserverErrorLogged===true,gym:r.bsodGym};
    });
    assert.equal(normal.gym,false);
    assert.equal(normal.crashed,true);
    assert.equal(normal.bsodCaught,true);
    assert.equal(normal.active,false);
    assert.equal(normal.exceptionContained,true);
    assert.ok(normal.causes.includes('bsod'));
    assert.deepEqual(errors,[]);
    console.log('ASTRA_NORMAL_RUN_AUDIO_FAULT_STILL_RESOLVES_REAL_BSOD_DEATH_PASS',normal);
  } finally {await ordinary.close();}
} finally {await browser.close();}
