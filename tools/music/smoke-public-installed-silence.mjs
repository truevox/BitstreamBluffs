#!/usr/bin/env node
/** #306 integration gate: a public FOUR-song game with 29 hidden private
 * defaults enabled must be truly silent when all FOUR installed choices
 * are disabled. Runs against the real compiled Phaser game in Chromium;
 * no private media, Netlify, or fabricated 33-song catalog required.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const url = process.env.GAME_URL || 'http://127.0.0.1:8222/';
const browser = await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist',
]});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror',e=>errors.push(String(e)));
  const response = await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  assert.equal(response.status(),200);
  await page.waitForFunction(()=>{
    const g=window.__bbGame;
    return g?.registry?.get('audioSynth')?._stemMusic?.ready===true &&
      g.scene.getScene('TitleScene')?.sys?.isActive();
  },null,{timeout:30000});
  const result = await page.evaluate(()=>{
    const audio=window.__bbGame.registry.get('audioSynth');
    const installed=audio._stemMusic.catalog.map(track=>track.id);
    // Deliberately make the hidden 29 explicitly true, which the old
    // full-roster AudioSynth music gate incorrectly treated as audible.
    const selection={...audio.settings.musicEnabledSongs};
    for(const id of Object.keys(selection))selection[id]=true;
    for(const id of installed)selection[id]=false;
    const privateEnabled=Object.entries(selection).filter(([id,on])=>!installed.includes(id)&&on).length;
    audio.stopMusic();
    audio.applySettings({...audio.settings,musicEnabledSongs:selection});
    const enabledBefore=audio._hasEnabledSongs();
    audio.startMusic('public-four-all-off-regression');
    const snapshot={
      installed:installed.length, privateEnabled,
      selectedInstalled:installed.filter(id=>audio.settings.musicEnabledSongs[id]===true).length,
      allVisibleOff:!enabledBefore,
      musicWanted:audio._musicWanted,
      timerIsNull:audio._musicTimer===null,
      stemStarted:audio._stemMusic.started,
      musicSourceGain:audio.nodes?.musicSrc?.gain?.value??null,
    };
    const reenabled={...selection,[installed[0]]:true};
    audio.applySettings({...audio.settings,musicEnabledSongs:reenabled});
    snapshot.reenableRecognized=audio._hasEnabledSongs();
    audio.stopMusic();
    return snapshot;
  });
  assert.equal(result.installed,4,'this gate requires the PUBLIC four-song source catalog');
  assert.equal(result.privateEnabled,29);
  assert.equal(result.selectedInstalled,0);
  assert.equal(result.allVisibleOff,true);
  assert.equal(result.timerIsNull,true,'procedural fallback must not schedule');
  assert.equal(result.stemStarted,false,'stems must remain off');
  assert.equal(result.reenableRecognized,true);
  assert.deepEqual(errors,[]);
  console.log('PUBLIC_INSTALLED_SILENCE_PASS',JSON.stringify(result));
} finally {
  await browser.close();
}
