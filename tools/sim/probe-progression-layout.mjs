/*
 * Live probe for the W1 Game Over progression row.
 * Drives the REAL GameOverScene in an actual browser and reads back the rendered BitmapText
 * objects (text, width, x-extent, y-extent) so layout claims are measured, not assumed.
 * Usage: node tools/sim/shots.mjs progression <out> is not reused; this probe is standalone.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  await page.addInitScript({ path: path.join(here, 'browser.js') });
  await page.addInitScript({ path: path.join(here, 'shots-page.js') });
  await page.addInitScript({ path: path.join(here, 'shots-zoom.js') });
  await page.addInitScript({ path: path.join(here, 'shots-hud.js') });
  await page.addInitScript({ path: path.join(here, 'shots-progression.js') });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__bbGame && window.__bbGame.scene.isActive('TitleScene'), null, { timeout: 60000 });

  const report = await page.evaluate(async () => {
    const S = () => window.__shots;
    const M = await S().loadMods();
    const con = await import('/src/constants.js');
    const game = window.__bbGame;

    function frameEnv() {
      return {
        game, t: 0, scene: null, hints: [],
        pad: {
          push: false, tilt: 0, tuck: false, brake: false, hop: false, reset: false, heli: 0, airBrake: false,
          parachute: false, pause: false, lastSource: 'keyboard',
          pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false },
        },
      };
    }
    const env = frameEnv();
    const step = (n) => { for (let i = 0; i < n; i++) S().frame(env, true); };

    // Walk every level-up reward combination the shipped table can produce.
    // Read the table through the real content loader so this probes what the game ships.
    const { loadContent } = await import('/src/data/index.js');
    const { hasGlyph } = await import('/src/ui/PixelFont.js');
    const table = loadContent().progression;
    const results = [];

    for (const lvl of table.levels) {
      try { localStorage.removeItem('bb.profile'); } catch (e) { /* ignore */ }
      game.registry.set('profile', null);
      game.registry.set('lastAwards', null);
      game.registry.set('lastRecord', null);
      for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }

      // Build the awards object exactly as the service publishes it, then render the real scene.
      const { ProgressionService } = await import('/src/systems/ProgressionService.js');
      const svc = new ProgressionService(game, { levels: table });
      const rewards = table.levels.find((e) => e.level === lvl.level) || {};
      game.registry.set(con.REG.LAST_AWARDS, {
        xp: { total: 1500, parts: [] },
        levelBefore: lvl.level - 1,
        levelAfter: lvl.level,
        leveledTo: lvl.level,
        rewards,
        // The service publishes `rewardsEarned` for every level crossed; mirror that so this probes
        // the REAL code path in _rewardsLine, not the hand-built fallback.
        rewardsEarned: [rewards],
        title: rewards.title,
        credited: true,
        progress: { level: lvl.level, xp: 100, levelXp: 50, nextXp: 200, xpToNext: 100, ratio: 0.33 },
        record: { id: 'probe', seed: 'probe' },
        earnedCosmetics: rewards.cosmetic ? [rewards.cosmetic] : [],
        pendingBiomes: rewards.biome ? [rewards.biome] : [],
      });
      game.registry.set(con.REG.LAST_RECORD, {
        id: 'probe', seed: 'probe', dailyRuleId: 'none', score: 7400, distanceM: 1850, trickPoints: 620,
        tricks: { backflip: 3 }, bestCombo: 3, maxAirtimeMs: 2100, durationMs: 95000, cause: 'crash',
        ledgerHash: 'deadbeef', shards: 9, nearMisses: 6, bonusPoints: 120,
      });

      game.scene.start('GameOverScene');
      step(24);

      const s = game.scene.getScene('GameOverScene');
      const read = (o) => {
        if (!o || !o.main) return null;
        const b = o.getBounds ? o.getBounds() : null;
        return {
          text: o.main.text,
          missingGlyph: [...new Set([...String(o.main.text)].filter((ch) => ch !== ' ' && !hasGlyph(ch)))],
          x: Math.round(o.x), y: Math.round(o.y),
          fontWidth: o.main.width,
          bounds: b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null,
          visible: o.visible !== false,
        };
      };
      results.push({
        level: lvl.level,
        title: read(s.rewardsText),
        levelText: read(s.levelText),
        xpText: read(s.xpText),
        footer: s.footer ? { text: s.footer.main.text, y: Math.round(s.footer.y), bounds: s.footer.getBounds ? (() => { const b = s.footer.getBounds(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })() : null } : null,
        bar: s.resonance ? { y: Math.round(s.resonance.y), cmdCount: s.resonance.commandBuffer ? s.resonance.commandBuffer.length : null } : null,
      });
    }
    return results;
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'progression-probe.json'), JSON.stringify(report, null, 1));
  console.log('wrote', path.join(outDir, 'progression-probe.json'), report.length, 'levels');
  for (const r of report) {
    console.log(`L${r.level} rewardsText="${r.title && r.title.text}" bounds=${JSON.stringify(r.title && r.title.bounds)} levelText=${JSON.stringify(r.levelText && r.levelText.text)} bar=${JSON.stringify(r.bar)} footer=${JSON.stringify(r.footer && r.footer.bounds)}`);
  }
} finally {
  if (browser) await browser.close();
  vite.kill('SIGKILL');
}
