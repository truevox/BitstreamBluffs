#!/usr/bin/env node
/** Exercise actual RunScene.doCrash -> RUN_END -> GameOver in built Chromium. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { EVT } from '../../src/events.js';
import { REG } from '../../src/constants.js';

const base = process.env.BSOD_QA_URL || 'http://127.0.0.1:4183';
const browser = await chromium.launch({
  headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  for (const preset of ['moderate', 'buffered', 'soft']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      const res = await page.goto(`${base}/bsod-qa.html?bsodQa=${preset}&qaSeed=bsod-ab-01`);
      assert.equal(res.status(), 200);
      await page.waitForFunction(() => window.__bbGame?.scene?.isActive('TitleScene') &&
        document.getElementById('bsod-qa-toolbar'), null, { timeout: 60000 });
      await page.evaluate(() => window.__bbGame.scene.getScene('TitleScene').startRun('discard-seed'));
      await page.waitForFunction(() => window.__bsodQaEvidence?.preset, null, { timeout: 30000 });
      const prior = await page.evaluate(async ({ EVT, REG }) => {
        const g = window.__bbGame;
        const progression = g.registry.get(REG.PROGRESSION);
        const profile = progression.profile;
        const saveStore = g.registry.get(REG.SAVE_STORE);
        const input = g.registry.get(REG.INPUT);
        const audio = g.registry.get(REG.AUDIO);
        const listeners = g.events.listeners(EVT.RUN_END);
        g.events.once(EVT.RUN_END, () => { window.__qaSawRunEnd = true; });
        return {
          listenerCount: listeners.length, creditListenerPresent: listeners.includes(progression._onRunEnd),
          inputActive: input.runActive, audioMode: audio._musicMode,
          xp: profile.xp, shards: profile.shards, lifetimeRuns: profile.lifetime.runs,
          savedRuns: (await saveStore.getRecentRuns(100)).length,
        };
      }, { EVT, REG });
      assert(prior.listenerCount >= 3, 'non-credit RUN_END listeners must survive');
      assert.equal(prior.creditListenerPresent, false);
      assert.equal(prior.inputActive, true);
      // Force a valid death THROUGH the real RunScene lifecycle (not a fake event).
      await page.evaluate(() => {
        const scene = window.__bbGame.scene.getScene('RunScene');
        const sled = scene.sled;
        scene.doCrash({ cause: 'hazard', hazardId: 'packetSpike' },
          { x: sled.x, y: sled.y, vx: sled.vx, vy: sled.vy }, sled.speed);
      });
      await page.waitForFunction(() => window.__qaSawRunEnd === true &&
        window.__bbGame?.scene?.isActive('GameOverScene'), null, { timeout: 30000 });
      const after = await page.evaluate(async ({ EVT, REG }) => {
        const g = window.__bbGame;
        const progression = g.registry.get(REG.PROGRESSION);
        const profile = progression.profile;
        const input = g.registry.get(REG.INPUT);
        const audio = g.registry.get(REG.AUDIO);
        return {
          runEndFired: window.__qaSawRunEnd,
          inputActive: input.runActive, audioMode: audio._musicMode,
          xp: profile.xp, shards: profile.shards, lifetimeRuns: profile.lifetime.runs,
          awards: g.registry.get(REG.LAST_AWARDS),
          ghostTape: g.registry.get(REG.LAST_GHOST_TAPE),
          inMemoryRecord: Boolean(g.registry.get(REG.LAST_RECORD)),
          savedRuns: (await g.registry.get(REG.SAVE_STORE).getRecentRuns(100)).length,
          stillHasOtherListeners: g.events.listeners(EVT.RUN_END).length >= 2,
        };
      }, { EVT, REG });
      assert.deepEqual(errors, [], `browser exceptions in ${preset}`);
      assert.equal(after.runEndFired, true);
      assert.equal(after.inputActive, false);
      assert.equal(after.audioMode, 'menu');
      assert.equal(after.xp, prior.xp);
      assert.equal(after.shards, prior.shards);
      assert.equal(after.lifetimeRuns, prior.lifetimeRuns);
      assert.equal(after.savedRuns, prior.savedRuns);
      assert.equal(after.awards, null);
      assert.equal(after.ghostTape ?? null, null);
      assert.equal(after.inMemoryRecord, true);
      assert.equal(after.stillHasOtherListeners, true);
      console.log(`PASS ${preset}: real crash -> Game Over; RUN_END input/audio reset; no XP/shards/saved run/ghost`);
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
console.log('QA POST-CRASH REGRESSION PASS');
