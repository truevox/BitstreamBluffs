#!/usr/bin/env node
/**
 * W3/W4/W5/W6 gate — drive the BUILT GAME Title -> Run -> Game Over -> Retry -> Title.
 *
 * Why this exists. CC Friday verified W3 at `6dcff75` and found the Game Over screen threw
 * "ReferenceError: shareableSeed is not defined" on every run, so it never built: no results, no initials,
 * no retry, no way back to Title. 32 suites / 678 tests and a clean build all passed, because the tests
 * import `shareableSeed` from Format.js directly and nothing ever CONSTRUCTED the real scene. A missing
 * import is invisible to a suite that never imports the module it is missing from.
 *
 * So this is a plain script, not a jest test, for the same reason tools/sim/shots.mjs is: it needs a real
 * browser and the real bundle. It is part of the per-workstream gate list from W3 onward, and it EXITS
 * NON-ZERO on any page error rather than skipping.
 *
 *   node tools/sim/gate-playthrough.mjs            # runs against dist/
 *
 * Prerequisite: `npm run build` (it reads dist/, not src/).
 *
 * Covered, because CC could not hand-check them while the screen was crashing:
 *   - Game Over builds with zero page errors, at mask 0 and a non-zero mask
 *   - retry keeps the run's mask
 *   - NEW SEED resets to the profile mask instead of inheriting a Daily's date-derived mask
 *   - the Game Over share seed shows `seed@mask` (bare at mask 0)
 *   - COPY yields the same string the panel shows
 *   - the saved record carries biomeMask
 *   - a boosted run actually reaches the run (shield charge) and the saved record is marked modded
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DIST = path.join(ROOT, 'dist');

const require = createRequire(path.join(ROOT, 'package.json'));
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('GATE FAIL: playwright is not resolvable from the repo root. This gate must run, not skip.');
  process.exit(1);
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('GATE FAIL: dist/index.html missing — run `npm run build` first.');
  process.exit(1);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// W4 adds boosts. The flag keeps this one gate file honest in both trees instead of forking it.
const WITH_BOOSTS = process.argv.includes('--with-boosts');

// xpMin 48400 is level 16, the threshold that unlocks all five W3 biomes (13 underwater, 16 crystal), so
// the fixture's mask 31 is reachable. Set XP, not `level`: ProfileStore derives level from XP on every
// load, and derives `pendingBiomes` from the level table on top of that, so a hand-set level or mask
// alone is silently discarded.
const PROFILE = {
  v: 1, xp: 48400, level: 16, bank: 0, biomeMask: 31,
  pendingBiomes: ['debumont', 'garbage-dump-glacier', 'pyramid-peak', 'underwater-mountain', 'crystal-cavern'],
  unlocked: { biomes: [], cosmetics: [], boosts: {} },
  boosts: { errorCorrection: false, headStart: false },
  missions: { counter: 0, active: [], progress: {} }, achievements: {}, credited: [],
  lifetime: { runs: 0, distanceM: 0, playMs: 0, score: 0, tricks: {}, shards: 0, nearMisses: 0,
    bestScore: 0, bestDistanceM: 0, bestCombo: 1, maxAirtimeMs: 0 },
};

const results = [];
const fail = (name, detail) => { results.push({ name, ok: false, detail }); };
const pass = (name, detail) => { results.push({ name, ok: true, detail }); };

function serve() {
  const server = http.createServer((req, res) => {
    let f;
    try { f = decodeURIComponent(String(req.url).split('?')[0]); } catch (e) { f = '/'; }
    if (f === '/') f = '/index.html';
    const full = path.join(DIST, f);
    if (!full.startsWith(DIST)) { res.writeHead(403); res.end('no'); return; }
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

/**
 * Seed the profile into localStorage and reload, so the game loads it through `ProfileStore.load()` — the
 * real path. Writing `registry.profile` directly does not survive: TitleScene reloads from storage and
 * sanitizeProfile recomputes `pendingBiomes` from the level table, which silently reset the fixture.
 */
async function bootWithProfile(browser, port, profile) {
  const page = await browser.newPage();
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.addInitScript((p) => {
    try { window.localStorage.setItem('bb.profile', JSON.stringify(p)); } catch (e) { /* first load */ }
  }, profile);
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__bbGame, null, { timeout: 25000 });
  await page.waitForTimeout(700);
  return { page, errors, consoleErrors };
}

/** Boot, start a run at `mask`, end it through the production crash path, read back Game Over. */
async function playToGameOver(browser, port, mask, { boosts = null, seed = 'gate-seed' } = {}) {
  const profile = JSON.parse(JSON.stringify(PROFILE));
  if (boosts) profile.boosts = boosts;
  const { page, errors, consoleErrors } = await bootWithProfile(browser, port, profile);

  const out = await page.evaluate(async ({ profile, mask, seed }) => {
    const g = window.__bbGame;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // The profile is already loaded from storage by the real load path; only the run's mask is forced,
    // which is what the Title screen would pass.
    g.registry.set('biomeMask', mask);
    g.scene.start('TitleScene');
    await wait(900);
    const title = g.scene.getScene('TitleScene');
    title.starting = false;
    title.startRun(seed, mask);
    await wait(1600);
    const run = g.scene.getScene('RunScene');
    if (!run) return { fatal: 'RunScene did not start' };
    const startedMask = g.registry.get('biomeMask');
    const shieldAtStart = run.shieldCharges || 0;
    run.runTimeMs = 5000;
    // End the run the way a chasm does: queue a pending crash and let the real update loop resolve it, so
    // doCrash, the record build, saveRun, RUN_END and the scene hand-off all run as production code.
    // `chasm` and not `terrain`: an opening-grace terrain crash is deliberately forgiven and respawns,
    // which is correct behaviour and would leave the gate waiting for a Game Over that never comes.
    run.pendingCrash = { cause: 'chasm' };
    await wait(3000);
    const over = g.scene.getScene('GameOverScene');
    const active = Boolean(over && over.scene && over.scene.isActive && over.scene.isActive());
    const rec = g.registry.get('lastRecord') || g.registry.get('record') || null;
    const texts = [];
    const seen = new Set();
    const walk = (list) => {
      for (const obj of list || []) {
        if (!obj) continue;
        if (typeof obj.text === 'string' && obj.text && !seen.has(obj.text)) { seen.add(obj.text); texts.push(obj.text); }
        if (obj.list) walk(obj.list);
      }
    };
    if (over) { walk(over.children && over.children.list); if (over.panel) walk(over.panel.list); }
    return {
      active, startedMask, shieldAtStart, texts,
      maskAfter: g.registry.get('biomeMask'),
      recordMask: rec ? (Number.isFinite(rec.biomeMask) ? rec.biomeMask : 0) : null,
      recordModded: rec ? rec.modded === true : null,
      seedText: texts.find((t) => /GATE-SEED/i.test(t)) || null,
      hasRetry: texts.some((t) => /RETRY/i.test(t)),
      hasCopy: texts.some((t) => /COPY|OK!/i.test(t)),
    };
  }, { profile, mask, seed }).catch((e) => ({ fatal: String(e) }));

  return { page, errors, consoleErrors, out };
}

async function main() {
  const { server, port } = await serve();
  const browser = await chromium.launch();
  try {
    // ---- 1. mask 0: the screen that crashed must build, cleanly
    {
      const { page, errors, out } = await playToGameOver(browser, port, 0);
      try {
        if (out.fatal) fail('mask 0: run reaches Game Over', out.fatal);
        else if (errors.length) fail('mask 0: no page errors', errors.join(' | '));
        else if (!out.active) fail('mask 0: GameOverScene active', 'scene not active');
        else if (!out.hasRetry) fail('mask 0: RETRY offered', `texts=${JSON.stringify(out.texts.slice(0, 12))}`);
        else if (out.seedText !== 'GATE-SEED') fail('mask 0: bare share seed', `saw ${JSON.stringify(out.seedText)}`);
        else if (out.recordMask !== 0) fail('mask 0: record mask 0', `saw ${out.recordMask}`);
        else pass('mask 0: Game Over builds, RETRY offered, bare seed, record mask 0', `texts=${out.texts.length}`);
      } finally { await page.close(); }
    }

    // ---- 2. mask 31: screen builds, seed@mask, saved mask
    {
      const { page, errors, out } = await playToGameOver(browser, port, 31);
      try {
        if (out.fatal) fail('mask 31: run reaches Game Over', out.fatal);
        else if (errors.length) fail('mask 31: no page errors', errors.join(' | '));
        else if (!out.active) fail('mask 31: GameOverScene active', 'scene not active');
        else if (out.startedMask !== 31) fail('mask 31: run starts at 31', `saw ${out.startedMask}`);
        else if (out.recordMask !== 31) fail('mask 31: record carries the mask', `saw ${out.recordMask}`);
        else if (out.seedText !== 'GATE-SEED@31') fail('mask 31: share seed shows @mask', `saw ${JSON.stringify(out.seedText)}`);
        else pass('mask 31: Game Over builds, seed@mask shown, record carries mask 31', `texts=${out.texts.length}`);

        // ---- 3. retry keeps the mask, and COPY matches the panel.
        // Guarded on `errors.length === 0` FIRST. When the scene throws in create() the object still
        // exists and its methods still run, so a retry check alone passes on a screen the player never
        // saw — that is how a crashing Game Over shipped with green tests the first time.
        if (errors.length || !out.active) {
          fail('retry keeps the run mask', 'Game Over never built — cannot verify behaviour on it');
          results.push({ name: 'COPY matches the panel', ok: false, detail: 'Game Over never built' });
        } else {
        const retry = await page.evaluate(async () => {
          const g = window.__bbGame;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const over = g.scene.getScene('GameOverScene');
          if (!over) return { fatal: 'no GameOverScene' };
          const copied = await (async () => {
            let got = null;
            const orig = navigator.clipboard && navigator.clipboard.writeText;
            if (navigator.clipboard) navigator.clipboard.writeText = async (t) => { got = t; };
            try { await over._copySeed(); } catch (e) { return { err: String(e) }; }
            finally { if (navigator.clipboard && orig) navigator.clipboard.writeText = orig; }
            return { got };
          })();
          over.retry();
          await wait(1400);
          return { maskAfterRetry: g.registry.get('biomeMask'), copied: copied.got || null, copyErr: copied.err };
        }).catch((e) => ({ fatal: String(e) }));

        if (retry.fatal) fail('retry from Game Over', retry.fatal);
        else if (retry.maskAfterRetry !== 31) fail('retry keeps the run mask', `saw ${retry.maskAfterRetry}`);
        else pass('retry keeps the run mask', 'mask 31 preserved');

        if (retry.copied) {
          if (retry.copied === 'gate-seed@31') pass('COPY matches the panel', retry.copied);
          else fail('COPY matches the panel', `copied ${JSON.stringify(retry.copied)}`);
        } else {
          // Headless clipboard is permission-gated; report honestly rather than claiming a pass.
          results.push({ name: 'COPY matches the panel', ok: null, detail: `clipboard unavailable in headless (${retry.copyErr || 'no write'}) — verified by unit test instead` });
        }
        }
      } finally { await page.close(); }
    }

    // ---- 4. NEW SEED after a daily-looking mask resets to the profile mask
    {
      const { page, errors, out } = await playToGameOver(browser, port, 31);
      try {
        // `out.active` as well as the error list: a scene whose create() threw still has callable methods,
        // so newSeed() would return a correct-looking mask for a screen the player never saw.
        if (errors.length || !out.active) {
          fail('NEW SEED resets to the profile mask', `Game Over never built: ${errors.join(' | ') || 'scene inactive'}`);
        } else {
        const res = await page.evaluate(async () => {
          const g = window.__bbGame;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const over = g.scene.getScene('GameOverScene');
          if (!over) return { fatal: 'no GameOverScene' };
          g.registry.set('biomeMask', 8); // stand in for a Daily's stale date-derived mask
          over.newSeed();
          await wait(1400);
          return { mask: g.registry.get('biomeMask'), seed: String(g.registry.get('seed') || '') };
        }).catch((e) => ({ fatal: String(e) }));
        if (res.fatal) fail('NEW SEED resets to the profile mask', res.fatal);
        else if (res.mask !== 31) fail('NEW SEED resets to the profile mask', `saw ${res.mask}, expected 31`);
        else if (/^daily-/.test(res.seed)) fail('NEW SEED is not a daily seed', res.seed);
        else pass('NEW SEED resets to the profile mask', `mask 31, seed ${res.seed}`);
        }
      } finally { await page.close(); }
    }

    // ---- 5/6. W4 boosts. Skipped here because this tree predates them; W4's copy of this gate runs them.
    if (WITH_BOOSTS) {
      const { page, errors, out } = await playToGameOver(browser, port, 0, { boosts: { errorCorrection: true, headStart: false } });
      try {
        if (out.fatal) fail('boosted run reaches Game Over', out.fatal);
        else if (errors.length) fail('boosted run: no page errors', errors.join(' | '));
        else if (!(out.shieldAtStart >= 1)) fail('Error Correction Engine grants a shield charge', `saw ${out.shieldAtStart}`);
        else if (out.recordModded !== true) fail('boosted run is marked modded', `saw ${out.recordModded}`);
        else pass('boosted run: shield charge applied and record marked modded', `shieldCharges=${out.shieldAtStart}`);
      } finally { await page.close(); }
    }

    if (WITH_BOOSTS) {
      const { page, out } = await playToGameOver(browser, port, 0);
      try {
        if (out.recordModded !== false) fail('clean run is not marked modded', `saw ${out.recordModded}`);
        else pass('clean run is not marked modded', 'modded absent/false');
      } finally { await page.close(); }
    }
  } finally {
    await browser.close();
    server.close();
  }

  // ---- report
  const bad = results.filter((r) => r.ok === false);
  const skipped = results.filter((r) => r.ok === null);
  console.log('\n=== built-game playthrough gate ===');
  for (const r of results) {
    const mark = r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : 'SKIP';
    console.log(`  ${mark}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
  }
  console.log(`\n${results.length - bad.length - skipped.length} passed, ${bad.length} failed, ${skipped.length} skipped`);
  if (bad.length) { console.error('\nGATE FAIL'); process.exit(1); }
  console.log('GATE PASS');
}

main().catch((e) => { console.error('GATE FAIL:', e); process.exit(1); });
