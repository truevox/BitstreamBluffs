/** Test actual static preview PCM in Chromium and actual in-game Music Lab button.
 * No user saves are intentionally changed, browser context is disposable.
 * The feature's optional preview uses a separate page, not the WebAudio game mixer.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.GAME_URL||'http://127.0.0.1:8268/';
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
  '--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1280,height:800}});
const audioErrors=[];
const review=await context.newPage();
review.on('pageerror',e=>audioErrors.push(String(e)));
try{
  const address=new URL('music-review/piano-friendly/index.html',base).href;
  await review.goto(address,{waitUntil:'domcontentloaded'});
  await review.waitForFunction(()=>[...document.querySelectorAll('audio')].length===12&&
    [...document.querySelectorAll('audio')].every(a=>a.readyState>=1),null,{timeout:25000});
  const clips=await review.locator('audio').evaluateAll(all=>all.map(a=>({src:a.currentSrc.split('/').at(-1),duration:a.duration,paused:a.paused})));
  assert.equal(clips.length,12);
  assert.ok(clips.every(x=>x.paused && x.duration>23.95&&x.duration<24.2),JSON.stringify(clips));
  console.log('PASS_12_REAL_ORIGINAL_SOURCE_A_B_C_MP3_CHROMIUM_METADATA',clips.length);
  const players=review.locator('audio');
  await players.nth(0).evaluate(el=>el.play());
  await review.waitForTimeout(700);
  const one=await players.nth(0).evaluate(el=>({time:el.currentTime,paused:el.paused}));
  assert.ok(one.time>.3&&!one.paused,JSON.stringify(one));
  await players.nth(1).evaluate(el=>el.play());
  await review.waitForTimeout(220);
  const switched=await players.evaluateAll(xs=>({a:xs[0].paused,b:xs[1].currentTime,bplaying:!xs[1].paused,playing:xs.filter(x=>!x.paused).length}));
  assert.equal(switched.a,true);
  assert.ok(switched.b>=one.time-.25,JSON.stringify(switched));
  assert.ok(switched.bplaying && switched.playing===1,JSON.stringify(switched));
  console.log('PASS_SOURCE_TIME_ALIGNED_A_B_SWITCH_ONE_PLAYER_ONLY',JSON.stringify({one,switched}));
  await players.nth(5).evaluate(el=>el.play());
  await review.waitForTimeout(130);
  assert.equal(await players.evaluateAll(xs=>xs.filter(x=>!x.paused).length),1);
  console.log('PASS_CROSS_PASSAGE_EXCLUSIVE_PLAYBACK');
  await review.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  assert.equal(await players.evaluateAll(xs=>xs.filter(x=>!x.paused).length),0);
  console.log('PASS_LEAVE_TAB_STOPS_ALL_RESEARCH_AUDIO');
  for(const file of ['B_piano_friendly_160bpm.mid','C_selective_glides_160bpm.mid']){
    const response=await context.request.get(new URL('music-review/piano-friendly/'+file,base).href);
    assert.equal(response.status(),200);
    const b=await response.body();
    assert.equal(b.subarray(0,4).toString(),'MThd');
    console.log('PASS_EDITABLE_MIDI_DELIVERY',file,b.length);
  }
  assert.deepEqual(audioErrors,[]);

  // Real game UI: actual pointer to the button, with no previous preview playing.
  const game=await context.newPage();
  const uiErrors=[];
  game.on('pageerror',e=>uiErrors.push(String(e)));
  await game.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
  await game.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  await game.keyboard.press('x');
  await game.evaluate(()=>{
    const t=window.__bbGame.scene.getScene('TitleScene');
    t.menu.items.find(i=>i.label==='SETTINGS').onSelect();
    t.view.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
    t.view.soundView.menu.items.find(i=>i.label==='MUSIC LAB').onSelect();
  });
  await game.waitForFunction(()=>!!window.__bbGame?.scene?.getScene('TitleScene')?.view?.soundView?.labView,null,{timeout:12000});
  // Wait for the real Phaser modal's entry tween to finish before pointer QA.
  await game.waitForTimeout(850);
  const snapshot=await game.evaluate(()=>{
    const g=window.__bbGame,t=g.scene.getScene('TitleScene'),v=t.view.soundView.labView;
    return {visible:v.pianoButton.visible,alive:v.alive,
      settingMusic:g.registry.get('audioSynth')?._stemMusic?.track?.id,
      sourceBus:!!v.sourceBus};
  });
  assert.equal(snapshot.alive,true);
  const canvasPoint=await game.evaluate(()=>{
    const rect=window.__bbGame.canvas.getBoundingClientRect();
    return {x:rect.left+(6+340+24)/480*rect.width,
      y:rect.top+(7+235+7)/270*rect.height};
  });
  const another=context.waitForEvent('page',{timeout:4500}).catch(()=>null);
  await game.mouse.click(canvasPoint.x,canvasPoint.y);
  await game.waitForTimeout(250);
  const afterClick=await game.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
    return {marker:v.markerStatus,pianoButtonVisible:v.pianoButton?.visible,
      pianoButtonActive:v.pianoButton?.active,labStarted:v.lab?.started};
  });
  console.log('POPUP_DIAGNOSTICS',JSON.stringify({afterClick,pages:context.pages().map(p=>p.url()),uiErrors}));
  const popup=await another;
  assert.ok(popup,'Piano preview popup did not open');
  await popup.waitForLoadState('domcontentloaded');
  assert.ok(popup.url().includes('/music-review/piano-friendly/index.html'),popup.url());
  const after=await game.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
    return {marker:v.markerStatus,labStarted:v.lab?.started};
  });
  assert.ok(after.marker.includes('PIANO'));
  assert.notEqual(after.labStarted,true);
  console.log('PASS_IN_GAME_MUSIC_LAB_REAL_POINTER_PIANO_PREVIEW_OPENS_RESEARCH_IN_OWN_TAB',JSON.stringify({snapshot,after,popup:popup.url()}));
  assert.deepEqual(uiErrors,[]);
}finally{
  await browser.close();
}
