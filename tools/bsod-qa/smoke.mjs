#!/usr/bin/env node
/** Real Chromium smoke against a running local-only QA server. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.BSOD_QA_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  for (const [preset, speed, accel] of [['moderate',250,3],['buffered',300,4],['soft',300,4]]) {
    const page = await browser.newPage();
    // Regression: recreate the user-reported race by putting the QA module
    // BEFORE the app script. The explicit ESM dependency must still boot it.
    await page.route('**/bsod-qa.html?bsodQa=*', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const appTag = '<script type="module" src="/src/main.js"></script>';
      const qaTag = '<script type="module" src="/tools/bsod-qa/client.js"></script>';
      if (body.includes(appTag) && body.includes(qaTag)) {
        await route.fulfill({ response, body: body.replace(appTag, '').replace(qaTag, `${qaTag}\n${appTag}`) });
      } else {
        await route.continue(); // Production preview uses bundled hashed module references.
      }
    });
    const errors=[];
    page.on('pageerror', (e)=>errors.push(String(e)));
    try {
      const res=await page.goto(`${base}/bsod-qa.html?bsodQa=${preset}&qaSeed=bsod-ab-01&utm_source=chatgpt.com`);
      assert.equal(res.status(),200);
      await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&document.getElementById('bsod-qa-toolbar'),null,{timeout:60000});
      await page.waitForFunction(()=>document.getElementById('bsod-qa-boot-status')?.textContent?.includes('Active scene: TitleScene'),null,{timeout:15000});
      await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('discard-this-seed'));
      await page.waitForFunction(()=>window.__bsodQaEvidence?.preset,null,{timeout:30000});
      const data=await page.evaluate(()=>({e:window.__bsodQaEvidence,seed:window.__bbGame.scene.getScene('RunScene').seed,storeIsWrapped:window.__bbGame.scene.getScene('RunScene').saveStore !== window.__bbGame.registry.get('saveStore'),title:document.getElementById('bsod-qa-toolbar').textContent}));
      assert.deepEqual(errors,[]);
      assert.equal(data.seed,'bsod-ab-01');
      assert.equal(data.e.preset,preset);
      assert.equal(Math.round(data.e.initialGapPx),4500);
      assert.equal(data.e.initialSpeedPxS,speed);
      assert.equal(Math.round(data.e.effectiveAccelerationPxS2*1000)/1000,accel);
      assert.equal(data.e.noSave,true);
      assert.equal(data.e.softFinish,preset==='soft');
      assert.equal(data.storeIsWrapped,true);
      assert(data.title.includes(preset==='soft'?'FAST APPROACH / SOFT FINISH':preset==='buffered'?'BUFFERED STRONG':'MODERATE'));
      assert.equal(await page.locator('#bsod-qa-boot-status').count(),1);
      console.log(`PASS ${preset}: same seed, authoritative 4500px gap, ${speed}px/s, ${accel}px/s², save isolation`);
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
console.log('PLAYABLE QA CHROMIUM SMOKE PASSED');
