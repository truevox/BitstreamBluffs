import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const url=process.env.GAME_URL || 'http://127.0.0.1:8211/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const pageErrors=[];
page.on('pageerror',e=>pageErrors.push(String(e)));
try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  const defaultSettings=await page.evaluate(()=>{
    const g=window.__bbGame,t=g.scene.getScene('TitleScene');
    t.menu.items.find(x=>x.label==='SETTINGS').onSelect();
    const v=t.view, s=g.registry.get('settings');
    return { windEnabled:s.windEnabled, windVolume:s.windVolume, controlLayout:s.controlLayout,
      choices:v.menu.items.map(x=>x.label), panelH:v.h };
  });
  assert.equal(defaultSettings.windEnabled,true);
  assert.equal(defaultSettings.controlLayout,'tricksRight');
  assert.ok(defaultSettings.choices.includes('CONTROLS'));
  assert.ok(defaultSettings.choices.includes('WIND'));
  assert.ok(defaultSettings.choices.includes('MANAGE SOUND'));
  assert.ok(defaultSettings.panelH<=200);
  console.log('COMBINED_SETTINGS_PASS',defaultSettings);
  await page.evaluate(()=>{
    const t=window.__bbGame.scene.getScene('TitleScene');
    t._closeView();t.startRun('combined-bsod-audio-smoke');
  });
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:20000});
  await page.waitForTimeout(350);
  const live=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),a=g.registry.get('audioSynth');
    const windBefore=a._windRelativePxS;
    a.setSpeed(900);
    return {bsodActive:r.bsodState.active,windActive:a._windActive,
      atmosphere:a._windAtmosphere,gameRelative:r.bsodState.relativeAirX,
      audioRelative:a._windRelativePxS,
      speedCallLeftWindUnchanged:a._windRelativePxS===windBefore};
  });
  assert.equal(live.bsodActive,true);
  assert.equal(live.windActive,true);
  assert.ok(live.atmosphere>0);
  assert.ok(Math.abs(live.audioRelative-live.gameRelative)<5);
  assert.equal(live.speedCallLeftWindUnchanged,true);
  console.log('GAME_TO_AUDIO_AUTHORITY_PASS',live);

  const winds=await page.evaluate(()=>{
    const g=window.__bbGame, a=g.registry.get('audioSynth');
    const payload={...g.scene.getScene('RunScene').bsodState};
    g.events.emit('bb:bsodStateChanged',{...payload,relativeAirX:-777});
    const negative=a._windRelativePxS;
    g.events.emit('bb:bsodStateChanged',{...payload,relativeAirX:0});
    const zero=a._windRelativePxS;
    g.events.emit('bb:bsodStateChanged',{...payload,atmosphereDensity:0,relativeAirX:777});
    const vacuum=a._windRelativePxS;
    g.events.emit('bb:bsodStateChanged',payload);
    return {negative,zero,vacuum,restored:a._windRelativePxS};
  });
  assert.equal(winds.negative,-777);
  assert.equal(winds.zero,0);
  assert.equal(winds.vacuum,0);
  console.log('SIGNED_VACUUM_WIND_PASS',winds);
  await page.evaluate(()=>{
    const r=window.__bbGame.scene.getScene('RunScene');
    r.bsod.wallX=r.sled.body.bounds.min.x-2;
    r.bsod.wallSpeedPxS=10000;
  });
  await page.waitForTimeout(420);
  const ended=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),a=g.registry.get('audioSynth');
    return {crashed:r.crashed,crash:g.registry.get('lastCrash')?.cause,windActive:a._windActive,wind:a._windRelativePxS};
  });
  assert.equal(ended.crashed,true);
  assert.equal(ended.crash,'bsod');
  assert.equal(ended.windActive,false);
  assert.equal(ended.wind,0);
  assert.deepEqual(pageErrors,[]);
  console.log('BSOD_CRASH_AUDIO_RESET_PASS',ended);
  console.log('COMBINED_BSOD_AUDIO_BROWSER_PASS');
} finally { await browser.close(); }
