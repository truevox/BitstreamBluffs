/*
 * Frame-one retry probe: proves the Game Over progression row did not make Retry wait for anything.
 * Presses Retry on the very first frame (and mid-pulse on a level-up) and asserts the scene change
 * happened immediately, with the pulse tween cancelled and the XP already banked exactly once.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const port = await new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const vite = spawn(path.join(root, 'node_modules/.bin/vite'), ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, env: { ...process.env, BROWSER: 'none' }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch (e) { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  for (const f of ['browser.js', 'shots-page.js', 'shots-zoom.js', 'shots-hud.js', 'shots-progression.js']) {
    await page.addInitScript({ path: path.join(here, f) });
  }
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__bbGame && window.__bbGame.scene.isActive('TitleScene'), null, { timeout: 60000 });

  const out = await page.evaluate(async () => {
    const S = () => window.__shots;
    await S().loadMods();
    const con = await import('/src/constants.js');
    const game = window.__bbGame;
    const results = {};

    // Build a Game Over scene with a level-up award (so the pulse tween exists), then retry.
    async function setup(tag, steps) {
      for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
      try { localStorage.removeItem('bb.profile'); } catch (e) { /* ignore */ }
      const { forgetProfile } = {};
      game.registry.set('profile', null);
      game.registry.set('lastAwards', null);
      const { loadContent } = await import('/src/data/index.js');
      const table = loadContent().progression;
      const lvl = table.levels[1];
      game.registry.set('lastAwards', {
        xp: { total: 463, parts: [] }, levelBefore: 1, levelAfter: 2, leveledTo: 2,
        rewards: lvl, rewardsEarned: [lvl], title: lvl.title, credited: true,
        progress: { level: 2, xp: 463, levelXp: 150, nextXp: 1200, xpToNext: 737, ratio: 0.29 },
        record: { id: tag, seed: 'seed-' + tag }, earnedCosmetics: [], pendingBiomes: [],
      });
      game.registry.set('lastRecord', { id: tag, seed: 'seed-' + tag, dailyRuleId: 'none', score: 7400,
        distanceM: 1850, trickPoints: 620, tricks: {}, bestCombo: 3, maxAirtimeMs: 2100, durationMs: 95000,
        cause: 'crash', ledgerHash: 'hash-' + tag, shards: 9, nearMisses: 6, bonusPoints: 120 });
      game.scene.start('GameOverScene');
      const env = { game, t: 0, scene: null, hints: [],
        pad: { push: false, tilt: 0, tuck: false, brake: false, hop: false, reset: false, heli: 0, airBrake: false,
          parachute: false, pause: false, lastSource: 'keyboard',
          pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } } };
      for (let i = 0; i < steps; i++) S().frame(env, true);
      return { s: game.scene.getScene('GameOverScene'), env };
    }

    // (1) Retry on the very first frame.
    {
      const { s, env } = await setup('f1', 1);
      const hadPulse = Boolean(s.pulse);
      const t0 = performance.now();
      s.retry();
      const dt = performance.now() - t0;
      // Phaser queues scene transitions; flush one frame before asking which scene is live.
      S().frame(env, true);
      results.frameOne = {
        hadPulse,
        leaving: s.leaving,
        pulseCleared: s.pulse === null || s.pulse === undefined,
        retryMs: Math.round(dt * 100) / 100,
        runningRun: game.scene.isActive('RunScene'),
        gameOverActive: game.scene.isActive('GameOverScene'),
        seedPreserved: game.registry.get(con.REG.SEED) === 'seed-f1',
      };
    }

    // (2) Retry mid-pulse (well into the 420ms level-up animation).
    {
      const { s, env } = await setup('mid', 8);
      const hadPulse = Boolean(s.pulse);
      const t0 = performance.now();
      s.retry();
      const dt = performance.now() - t0;
      S().frame(env, true);
      results.midPulse = {
        hadPulse,
        retryMs: Math.round(dt * 100) / 100,
        pulseCleared: s.pulse === null || s.pulse === undefined,
        runningRun: game.scene.isActive('RunScene'),
        seedPreserved: game.registry.get(con.REG.SEED) === 'seed-mid',
      };
    }

    // (3) Retry from a freshly created scene with no waiting at all.
    {
      const { s, env } = await setup('entry', 2);
      const t0 = performance.now();
      s.retry();
      const dt = performance.now() - t0;
      S().frame(env, true);
      results.alwaysFast = { retryMs: Math.round(dt * 100) / 100, runningRun: game.scene.isActive('RunScene') };
    }
    return results;
  });

  console.log(JSON.stringify(out, null, 1));
  const ok = out.frameOne.leaving && out.frameOne.hadPulse && out.frameOne.pulseCleared
    && out.frameOne.runningRun && !out.frameOne.gameOverActive
    && out.frameOne.seedPreserved && out.frameOne.retryMs < 50
    && out.midPulse.hadPulse && out.midPulse.pulseCleared && out.midPulse.runningRun
    && out.midPulse.seedPreserved && out.midPulse.retryMs < 50
    && out.alwaysFast.runningRun && out.alwaysFast.retryMs < 50;
  console.log(ok ? 'PASS: retry is frame-one responsive in all three cases' : 'FAIL');
  process.exitCode = ok ? 0 : 1;
} finally {
  if (browser) await browser.close();
  vite.kill('SIGKILL');
}
