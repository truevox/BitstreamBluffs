/*
 * End-to-end proof for the multi-level reward fix: drives the REAL ProgressionService with a real
 * RUN_END event, then boots the REAL GameOverScene and reads the text it actually rendered.
 * Nothing is stubbed between the run ending and the pixel text, so this is the closest check to
 * "what the player sees" that does not require a human to look at a screenshot.
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
    const { createServices } = await import('/src/services.js');
    const { EVT } = await import('/src/events.js');
    const game = window.__bbGame;
    const env = { game, t: 0, scene: null, hints: [],
      pad: { push: false, tilt: 0, tuck: false, brake: false, hop: false, reset: false, heli: 0, airBrake: false,
        parachute: false, pause: false, lastSource: 'keyboard',
        pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } } };

    // Fresh profile so the run starts at L1 and genuinely crosses L2 -> L3.
    try { localStorage.removeItem('bb.profile'); } catch (e) { /* ignore */ }
    for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { game.scene.stop(k); } catch (e) { /* ignore */ } }
    game.registry.set(con.REG.PROFILE, null);
    game.registry.set(con.REG.LAST_AWARDS, null);

    const services = createServices(game);
    if (services.init) await services.init();
    const svc = services.reg ? services.reg.get(con.REG.PROGRESSION) : game.registry.get(con.REG.PROGRESSION);
    const before = game.registry.get(con.REG.PROFILE);
    const beforeLevel = before ? before.level : 1;

    // A big run: enough XP to jump two levels from a fresh profile.
    const record = { id: 'e2e-multi', seed: 'seed-e2e', dailyRuleId: 'none', score: 60000,
      distanceM: 20000, trickPoints: 1200, tricks: { a: 10 }, bestCombo: 9, maxAirtimeMs: 4000,
      durationMs: 200000, cause: 'crash', ledgerHash: 'hash-e2e-multi', shards: 50, nearMisses: 10, bonusPoints: 500 };
    game.events.emit(EVT.RUN_END, { record });

    const awards = game.registry.get(con.REG.LAST_AWARDS);
    game.registry.set(con.REG.LAST_RECORD || 'lastRecord', record);
    game.registry.set(con.REG.SEED, 'seed-e2e');

    // Boot the real scene and read what it rendered.
    let bootErr = null;
    try { game.scene.start('GameOverScene'); } catch (e) { bootErr = 'start: ' + e.message; }
    for (let i = 0; i < 3; i++) S().frame(env, true);
    const s = game.scene.getScene('GameOverScene');
    const diag = { active: game.scene.isActive('GameOverScene'), bootErr,
      hasCreate: Boolean(s && s.sys && s.sys.settings), status: s && s.sys ? s.sys.settings.status : null,
      keys: s ? Object.keys(s).filter((k) => /Text|footer|resonance|rec|awards/i.test(k)) : null };
    // NeonText wraps a Phaser BitmapText in `.main`; the string and bounds live there.
    const text = (t) => (t && t.main && t.main.text !== undefined ? t.main.text : null);
    const bounds = (t) => (t && t.main ? t.main.getBounds() : null);

    // Second identical RUN_END must not double-credit.
    const afterFirst = game.registry.get(con.REG.PROFILE);
    game.events.emit(EVT.RUN_END, { record });
    const afterSecond = game.registry.get(con.REG.PROFILE);

    if (svc && svc.destroy) svc.destroy();
    return {
      beforeLevel,
      levelBefore: awards && awards.levelBefore,
      levelAfter: awards && awards.levelAfter,
      rewardsEarnedLevels: awards && awards.rewardsEarned ? awards.rewardsEarned.map((r) => r.level) : null,
      bankedCosmetics: afterFirst ? afterFirst.unlocked.cosmetics : null,
      rendered: {
        xp: text(s.xpText),
        level: text(s.levelText),
        rewards: text(s.rewardsText),
        footer: text(s.footer),
      },
      xpAfterFirst: afterFirst ? afterFirst.xp : null,
      xpAfterSecond: afterSecond ? afterSecond.xp : null,
      rewardLineStartX: bounds(s.rewardsText) ? bounds(s.rewardsText).x : null,
      levelTextEndX: bounds(s.levelText) ? bounds(s.levelText).x + bounds(s.levelText).width : null,
      footerBottom: bounds(s.footer) ? bounds(s.footer).y + bounds(s.footer).height : null,
      diag,
    };
  });

  console.log(JSON.stringify(out, null, 1));
  const r = out.rendered;
  const checks = {
    crossedTwoLevels: out.levelBefore === 1 && out.levelAfter === 3,
    publishedBothRewards: JSON.stringify(out.rewardsEarnedLevels) === '[2,3]',
    bankedTrailCyan: Array.isArray(out.bankedCosmetics) && out.bankedCosmetics.includes('trail-cyan'),
    renderedBothRewards: Boolean(r.rewards) && r.rewards.includes('TRAIL-CYAN') && r.rewards.includes('TRAIL'),
    showsNewLevel: r.level === 'SYNC LEVEL 3',
    showsXp: Boolean(r.xp) && /^\+\d/.test(r.xp),
    noOverlap: out.levelTextEndX !== null && out.rewardLineStartX !== null && out.rewardLineStartX >= out.levelTextEndX,
    footerInViewport: out.footerBottom !== null && out.footerBottom <= 270,
    idempotent: out.xpAfterFirst === out.xpAfterSecond,
  };
  console.log(JSON.stringify(checks, null, 1));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? 'PASS: multi-level rewards render end to end' : 'FAIL: ' + Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(', '));
  process.exitCode = ok ? 0 : 1;
} finally {
  if (browser) await browser.close();
  vite.kill('SIGKILL');
}
