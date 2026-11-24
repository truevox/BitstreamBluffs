/** Browser check of actual in-game score+original OGG PCM and isolated mixer.
 * All navigation is through a private local build and no saved settings
 * or source audio files are ever changed.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://127.0.0.1:8249/';
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
  '--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],httpErrors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)httpErrors.push(`${r.status()}: ${r.url()}`)});
const world=async(x,y)=>page.evaluate(({x,y})=>{
  const rect=window.__bbGame.canvas.getBoundingClientRect();
  return {x:rect.left+x/480*rect.width,y:rect.top+y/270*rect.height};
},{x,y});
const lab=()=>page.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene');
  const v=t.view?.soundView?.labView;
  const a=g.registry.get('audioSynth');
  const orig=a?._stemMusic;
  return {song:v?.lab?.track?.id,score:v?.score?.songId,
    scoreHash:v?.score?.scoreHash,live:v?.lab?.started,
    active:v?.lab?.activeNodes.size,mixer:!!v?.mixerView,
    solo:v?.solo,levels:v?.mixLevels,notes:!!v?.inspector,
    originalTrack:orig?.track?.id,
    originalBusGain:orig?.bus?.gain?.value,
    originalUserLevels:orig?._stemUserLevels ?
      Object.fromEntries(orig._stemUserLevels) : null,
    sourceBusMuted:!!v?.sourceBus,
    perSource:v?.lab?.mixer?.sources ?
      Object.fromEntries([...v.lab.mixer.sources].map(([k,s])=>
        [k,s.input.gain.value])):null,
    originalPosition:orig?.transportSnapshot()?.position,
    inspectorCoverage:v?.inspector?.waveformCoverage,
    inspectorWaveRole:v?.inspector?.waveformSource,
    inspectorNotes:v?.inspector?._hitBoxes.length,
    inspectorRole:v?.inspector?.role,
    inspectTime:v?.inspector?.windowStart};
});
try{
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),
    null,{timeout:30000});
  await page.keyboard.press('x');
  await page.evaluate(()=>{
    const t=window.__bbGame.scene.getScene('TitleScene');
    t.menu.items.find(i=>i.label==='SETTINGS').onSelect();
    t.view.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
    t.view.soundView.menu.items.find(i=>i.label==='MUSIC LAB').onSelect();
  });
  await page.waitForFunction(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view?.soundView?.labView;
    return v?.score?.songId==='FEsxYVStla4'&&v.lab.pack&&
      v.lab.activeNodes.size>=6;
  },null,{timeout:50000});
  const initial=await lab();
  assert.equal(initial.song,'FEsxYVStla4');
  assert.equal(initial.score,'FEsxYVStla4');
  assert.equal(initial.solo,'ALL');
  assert.equal(initial.levels.bass,1);
  console.log('ACTUAL_OGG_STEM_AND_PROVISIONAL_SCORE_LAB_READY',JSON.stringify(initial));

  // Mixer through actual mouse pointer rather than calling its callback.
  const mixerPos=await world(6+155+34,7+235+7);
  await page.mouse.click(mixerPos.x,mixerPos.y);
  await page.waitForFunction(()=>
    !!window.__bbGame.scene.getScene('TitleScene').view?.soundView?.labView?.mixerView,
  null,{timeout:8000});
  const opened=await lab();
  assert.equal(opened.mixer,true);
  console.log('REAL_POINTER_SIX_ROLE_SANDBOX_MIXER_OPENS_PASS');

  // Second row, BASS: .35 duck, 1.35 boost, solo, and mute.
  const bassY=7+54+1*25+9;
  const duck=await world(6+197+26,bassY);
  await page.mouse.click(duck.x,duck.y);
  await page.waitForTimeout(200);
  const ducked=await lab();
  assert.equal(ducked.levels.bass,.35);
  assert.ok(ducked.perSource.bass<.6);
  assert.equal(ducked.levels.drums,1);
  console.log('REAL_MIXER_BASS_DUCK_WITH_SEPARATE_DRUM_LEVEL_PASS',
    JSON.stringify({bass:ducked.perSource.bass,drums:ducked.perSource.drums}));

  const boost=await world(6+320+30,bassY);
  await page.mouse.click(boost.x,boost.y);
  await page.waitForTimeout(210);
  const boosted=await lab();
  assert.equal(boosted.levels.bass,1.35);
  assert.ok(boosted.perSource.bass>1.2);
  assert.equal(boosted.originalUserLevels?.bass,initial.originalUserLevels?.bass);
  console.log('REAL_MIXER_1_35_BOOST_SANDBOX_ONLY_PASS',
    JSON.stringify({bass:boosted.perSource.bass}));

  const solo=await world(6+87+23,bassY);
  await page.mouse.click(solo.x,solo.y);
  await page.waitForTimeout(180);
  const isolated=await lab();
  assert.equal(isolated.solo,'BASS');
  assert.ok(isolated.perSource.drums<.1);
  assert.ok(isolated.perSource.bass>1.2);
  assert.equal(isolated.levels.drums,1);
  console.log('REAL_MIXER_SOLO_PRESERVES_ALL_CUSTOM_LEVELS_PASS');

  // Keyboard/gamepad action contract: left on selected BASS goes normal.
  await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
    v.mixerView.handleAction('left');
  });
  let keyboard=await lab();
  assert.equal(keyboard.levels.bass,1);
  await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
    v.mixerView.handleAction('confirm'); // turns solo off
  });
  keyboard=await lab();
  assert.equal(keyboard.solo,'ALL');
  assert.equal(keyboard.levels.bass,1);
  console.log('GAMEPAD_MIXER_LEVEL_AND_SOLO_CONTROL_PASS');

  // Mute bass, then reset all: no persist after closing the Lab.
  const mute=await world(6+139+26,bassY);
  await page.mouse.click(mute.x,mute.y);
  assert.equal((await lab()).levels.bass,0);
  const reset=await world(6+12+60,7+235+7);
  await page.mouse.click(reset.x,reset.y);
  const resetLevels=await lab();
  assert.equal(resetLevels.levels.bass,1);
  assert.equal(resetLevels.solo,'ALL');
  console.log('REAL_MIXER_MUTE_AND_RESET_ALL_PASS');

  const mixerBack=await world(6+390+34,7+233+8);
  await page.mouse.click(mixerBack.x,mixerBack.y);
  assert.equal((await lab()).mixer,false);
  const notesPos=await world(6+80+35,7+235+7);
  await page.mouse.click(notesPos.x,notesPos.y);
  await page.waitForFunction(()=>{
    const i=window.__bbGame.scene.getScene('TitleScene').view?.soundView?.labView?.inspector;
    return !!i;
  },null,{timeout:8000});
  await page.evaluate(()=>{
    const i=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector;
    i.setRole('bass');
  });
  await page.waitForFunction(()=>{
    const i=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector;
    return i.waveformSource==='bass'&&i.waveformCoverage>.35;
  },null,{timeout:10000});
  const inspect=await lab();
  assert.equal(inspect.inspectorWaveRole,'bass');
  assert.ok(inspect.inspectorCoverage>.35);
  assert.ok(inspect.inspectorNotes>=0);
  assert.equal(inspect.scoreHash,initial.scoreHash);
  console.log('REAL_CACHED_OGG_PCM_WAVEFORM_UNDER_SOURCE_FRAME_PIANO_ROLL_PASS',
    JSON.stringify({role:inspect.inspectorWaveRole,
      coverage:inspect.inspectorCoverage,notes:inspect.inspectorNotes,
      song:inspect.score}));

  // No player profile/selection changed in either sandbox overlay.
  await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
    v._closeInspector();v.destroy();
  });
  const after=await lab();
  assert.equal(after.notes,false);
  assert.equal(after.mixer,false);
  assert.deepEqual(after.originalUserLevels,initial.originalUserLevels);
  console.log('CLOSING_LAB_LEAVES_ORIGINAL_STEM_USER_LEVELS_UNCHANGED_PASS');
  assert.deepEqual(errors,[],`JS exceptions: ${errors.join('; ')}`);
  assert.deepEqual(httpErrors,[],`Asset failures: ${httpErrors.join('; ')}`);
  console.log('MUSIC_LAB_WAVEFORM_SIX_STEM_MIXER_REAL_BROWSER_PASS');
}finally{await browser.close()}
