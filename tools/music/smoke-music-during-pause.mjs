/** #389 production-browser smoke: real Pause keyboard + actual Sound Manager preference + persistence. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
  '--enable-webgl','--ignore-gpu-blocklist',
]});
const errors=[];
const page=await browser.newPage({viewport:{width:1280,height:800}});
page.on('pageerror',e=>errors.push(String(e)));
const base=process.env.GAME_URL||'http://127.0.0.1:8265/';
const ready=async()=>page.waitForFunction(
  ()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),
  null,{timeout:25000});
const pause=async(seed)=>{
  await page.evaluate(seed=>window.__bbGame.scene.getScene('TitleScene').startRun(seed,0,{}),seed);
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),
    null,{timeout:25000});
  await page.waitForTimeout(160);
  await page.keyboard.press('Escape',{delay:40});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('PauseScene')?.sys?.isActive(),
    null,{timeout:12000});
  await page.waitForTimeout(450);
};
const view=()=>page.evaluate(()=>{
  const g=window.__bbGame,p=g.scene.getScene('PauseScene'),r=g.scene.getScene('RunScene');
  const menu=p.view?.soundView?.menu;
  return {runPaused:r.sys.isPaused(),pauseScene:p.sys.isActive(),
    pauseMusic:g.registry.get('settings').musicDuringPause,
    sessionActive:!!g.registry.get('audioSynth')._vinylPauseSession,
    audioPaused:g.registry.get('audioSynth')._paused,
    settingsOption:menu?.items?.find(i=>i.label==='MUSIC DURING PAUSE')?.get(),
    persisted:JSON.parse(localStorage.getItem('bb.settings')||'{}').musicDuringPause};
});
const openSound=()=>page.evaluate(()=>{
  const p=window.__bbGame.scene.getScene('PauseScene');
  const settings=p.menu.items.find(i=>i.label==='SETTINGS');
  assertSetting(settings,'SETTINGS');settings.onSelect();
  const sound=p.view.menu.items.find(i=>i.label==='MANAGE SOUND');
  assertSetting(sound,'MANAGE SOUND');sound.onSelect();
  const menu=p.view.soundView.menu;
  const index=menu.items.findIndex(i=>i.label==='MUSIC DURING PAUSE');
  if(index<0)throw Error('MUSIC DURING PAUSE absent from Sound Manager');
  menu.setSelected(index,true);
  function assertSetting(value,name){if(!value)throw Error(name+' absent');}
  return menu.items[index].get();
});
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await ready();
  await page.keyboard.press('x'); // AudioContext user gesture; actual music assets optional in this smoke
  await pause('p1-389-default');
  const original=await view();
  assert.equal(original.pauseMusic,false,'fresh default must be OFF');
  assert.equal(original.runPaused,true);
  assert.equal(original.audioPaused,true);
  assert.equal(original.sessionActive,true);
  assert.equal(await openSound(),false);
  // Phaser's PauseScene intentionally suppresses menu input until its intro
  // finishes. On busy CI hosts 450ms wall time need not mean 340ms scene time.
  await page.waitForFunction(()=>!window.__bbGame.scene.getScene('PauseScene')._menuOpening,
    null,{timeout:10000});
  await page.keyboard.press('ArrowRight',{delay:50}); // Physical UI key, not direct settings injection
  const enabled=await view();
  assert.equal(enabled.settingsOption,true);
  assert.equal(enabled.pauseMusic,true);
  assert.equal(enabled.persisted,true);
  assert.equal(enabled.runPaused,true,'setting must not resume gameplay');
  console.log('PAUSE_SOUND_UI_ENABLE_PASS',enabled);

  await page.reload({waitUntil:'domcontentloaded'});
  await ready();
  await pause('p1-389-reload');
  const reloaded=await view();
  assert.equal(reloaded.pauseMusic,true,'reload must retain ON');
  assert.equal(reloaded.runPaused,true);
  assert.equal(reloaded.audioPaused,true);
  assert.equal(await openSound(),true);
  await page.waitForFunction(()=>!window.__bbGame.scene.getScene('PauseScene')._menuOpening,
    null,{timeout:10000});
  await page.keyboard.press('ArrowLeft',{delay:50});
  const disabled=await view();
  assert.equal(disabled.settingsOption,false);
  assert.equal(disabled.persisted,false);
  assert.equal(disabled.runPaused,true);
  console.log('PAUSE_SOUND_UI_RELOAD_AND_DISABLE_PASS',disabled);

  assert.deepEqual(errors,[]);
}finally{
  await page.close();
  await browser.close();
}
