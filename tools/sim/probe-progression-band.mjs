/*
 * Vertical-band probe for the W1 Game Over screen: measures where the buttons actually end, where the
 * footer ink starts, and how much room is left for the progression row. Live browser, real scene.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const outDir = path.resolve(process.argv[2] || '.');

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
    const env = {
      game, t: 0, scene: null, hints: [],
      pad: { push: false, tilt: 0, tuck: false, brake: false, hop: false, reset: false, heli: 0, airBrake: false,
        parachute: false, pause: false, lastSource: 'keyboard',
        pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } },
    };
    const step = (n) => { for (let i = 0; i < n; i++) S().frame(env, true); };

    const { loadContent } = await import('/src/data/index.js');
    const table = loadContent().progression;
    const lvl = table.levels[1];
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    try { localStorage.removeItem('bb.profile'); } catch (e) { /* ignore */ }
    game.registry.set('lastAwards', {
      xp: { total: 463, parts: [] }, levelBefore: 1, levelAfter: 2, leveledTo: 2,
      rewards: lvl, title: lvl.title, credited: true,
      progress: { level: 2, xp: 463, levelXp: 150, nextXp: 1200, xpToNext: 737, ratio: 0.29 },
      record: { id: 'p', seed: 'p' }, earnedCosmetics: [], pendingBiomes: [],
    });
    game.registry.set('lastRecord', { id: 'p', seed: 'p', dailyRuleId: 'none', score: 7400, distanceM: 1850,
      trickPoints: 620, tricks: {}, bestCombo: 3, maxAirtimeMs: 2100, durationMs: 95000, cause: 'crash',
      ledgerHash: 'deadbeef', shards: 9, nearMisses: 6, bonusPoints: 120 });
    game.scene.start('GameOverScene');
    step(30);
    const s = game.scene.getScene('GameOverScene');
    const b = (o) => { if (!o || !o.getBounds) return null; const r = o.getBounds(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.y + r.height) }; };
    return {
      screen: { w: con.GAME_WIDTH, h: con.GAME_HEIGHT },
      buttons: (s.buttons || []).map((x) => ({ y: x.y, h: x.h || (x.bounds ? x.bounds.height : null), bounds: b(x) })),
      buttonBottomMax: Math.max(...(s.buttons || []).map((x) => { const r = b(x); return r ? r.bottom : 0; })),
      xpText: b(s.xpText),
      levelText: b(s.levelText),
      rewardsText: b(s.rewardsText),
      footer: b(s.footer),
      footerY: s.footer ? s.footer.y : null,
    };
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'vertical-band.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
} finally {
  if (browser) await browser.close();
  vite.kill('SIGKILL');
}
