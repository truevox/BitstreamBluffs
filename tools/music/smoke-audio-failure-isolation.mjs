#!/usr/bin/env node
/** Real compiled Phaser/Matter #306 regression: broken audio presentation
 * callbacks must not interrupt the game loop or modify authoritative physics.
 * No special media, Netlify preview, or mocked Phaser game is required.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://127.0.0.1:8222/';
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist',
]});
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const response=await page.goto(url,{waitUntil:'domcontentloaded'});
  assert.equal(response.status(),200);
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('audio-failure-isolation-306'));
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
  const state=await page.evaluate(async()=>{
    const game=window.__bbGame,run=game.scene.getScene('RunScene');
    const audio=game.registry.get('audioSynth');
    const original={setMicroBees:audio.setMicroBees,setArcadeTransition:audio.setArcadeTransition,
      onLanding:audio._stemMusic.onLanding,playSfx:audio.playSfx};
    const counts={bees:0,arcade:0,landings:0,sfx:0,afterLanding:0};
    audio.setMicroBees=()=>{counts.bees++;throw Error('test bee audio graph failure');};
    audio.setArcadeTransition=()=>{counts.arcade++;throw Error('test arcade audio graph failure');};
    try{
      const priorTick=run.simClock.tick;
      // Genuine RunScene.renderFrame invokes the AudioSynth bee call even
      // outside Micro (empty positioning); ensure callback really fired.
      run.renderFrame(16,{});
      // Temporarily force the authentic Arcade branch in a real RunScene
      // updateFun call. The test restores terrain lookup after invocation.
      const terrain=run.terrain,oldBiome=terrain.biomeAtX;
      terrain.biomeAtX=()=>null;
      let arcadeError=null;
      try {run.updateFun(16,{},0);}catch(e){arcadeError=String(e);}
      finally {terrain.biomeAtX=oldBiome;}
      // A LANDING event fires synchronously before authoritative bounce and
      // combo consumers. A throwing *music* effect may not suppress a later
      // listener, ordinary landing SFX, or any subsequent Phaser fixed tick.
      audio._musicMode='run';
      audio._stemMusic.onLanding=()=>{
        counts.landings++;throw Error('test landing musical physics failure');
      };
      audio.playSfx=()=>{counts.sfx++;};
      game.events.once('bb:landing',()=>{counts.afterLanding++;});
      game.events.emit('bb:landing',{quality:'perfect',impactSpeedPxS:700,hard:true});
      // Let real Phaser's RAF continue, rather than masking stalled games
      // with a direct method call.
      await new Promise(resolve=>setTimeout(resolve,350));
      return {counts,priorTick,nextTick:run.simClock.tick,
        arcadeError,crashed:run.crashed};
    }finally{
      audio.setMicroBees=original.setMicroBees;
      audio.setArcadeTransition=original.setArcadeTransition;
      audio._stemMusic.onLanding=original.onLanding;
      audio.playSfx=original.playSfx;
    }
  });
  assert(state.counts.bees>0,'the throwing bee callback was not exercised');
  assert(state.counts.arcade>0,'the throwing Arcade callback was not exercised');
  assert.equal(state.counts.landings,1,'the throwing landing callback was not exercised');
  assert(state.counts.sfx>0,'ordinary landing SFX was suppressed by the broken musical effect');
  assert.equal(state.counts.afterLanding,1,'a gameplay event subscriber after AudioSynth was skipped');
  assert.equal(state.arcadeError,null,'Arcade audio error interrupted the gameplay update');
  assert(state.nextTick>state.priorTick,'real Phaser fixed simulation stopped');
  assert.deepEqual(errors,[],'audio callback error escaped into Chromium page');
  console.log('AUDIO_FAILURE_ISOLATION_PASS',JSON.stringify(state));
}finally{await browser.close();}
