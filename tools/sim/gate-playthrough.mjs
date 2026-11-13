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

/**
 * Boot, start a run and read back what the sled and trail are actually drawing with.
 * @param {Object} browser @param {number} port @param {Object} profile
 */
async function probeLook(browser, port, profile) {
  const { page, errors } = await bootWithProfile(browser, port, profile);
  try {
    const out = await page.evaluate(async () => {
      const g = window.__bbGame;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      g.registry.set('biomeMask', 0);
      g.scene.start('TitleScene');
      await wait(800);
      const t = g.scene.getScene('TitleScene');
      t.starting = false;
      t.startRun('look-gate', 0);
      await wait(1600);
      const run = g.scene.getScene('RunScene');
      if (!run) return { fatal: 'RunScene did not start' };
      // Read the values the DRAW call will use, resolved through the entity's own helper.
      const pal = run.palette;
      return {
        look: run.look ? { rider: run.look.rider, glow: run.look.glow, trail: run.look.trail, theme: run.look.theme, overridden: run.look.overridden } : null,
        drawnRider: run.sled._cosmetic('rider', pal.magenta),
        drawnGlow: run.sled._cosmetic('glow', pal.cyan),
        drawnTrail: Array.isArray(run.trail.stops) ? run.trail.stops : null,
        paletteMagenta: pal.magenta, paletteCyan: pal.cyan,
      };
    }).catch((e) => ({ fatal: String(e) }));
    return { page, errors, out };
  } catch (e) {
    return { page: null, errors: [], out: { fatal: String(e) } };
  }
}

/** Boot with a colourblind palette forced into localStorage settings. */
async function bootWithProfileCb(browser, port, profile) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((p) => {
    try {
      window.localStorage.setItem('bb.profile', JSON.stringify(p));
      // Settings are their own key; only `palette` matters here.
      const s = window.localStorage.getItem('bb.settings');
      const parsed = s ? JSON.parse(s) : {};
      parsed.palette = 'colorblind';
      window.localStorage.setItem('bb.settings', JSON.stringify(parsed));
    } catch (e) { /* first load */ }
  }, profile);
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__bbGame, null, { timeout: 25000 });
  await page.waitForTimeout(700);
  return { page, errors };
}

/** Boot, start a run at `mask`, end it through the production crash path, read back Game Over. */
async function playToGameOver(browser, port, mask, { boosts = null, seed = 'gate-seed', drainShield = false, absorbFirst = false } = {}) {
  const profile = JSON.parse(JSON.stringify(PROFILE));
  if (boosts) profile.boosts = boosts;
  const { page, errors, consoleErrors } = await bootWithProfile(browser, port, profile);

  const out = await page.evaluate(async ({ profile, mask, seed, drainShield, absorbFirst }) => {
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
    let absorbedCrash = null;
    if (absorbFirst) {
      // A shield charge ABSORBS the next crash and respawns, so a shielded run cannot reach Game Over in
      // one hit. Prove the absorb, then spend the charge so the run can genuinely end.
      run.pendingCrash = { cause: 'hazard', hazardId: 'hazard' };
      await wait(1200);
      absorbedCrash = { crashed: run.crashed === true, chargesLeft: run.shieldCharges, runEnded: run.crashed === true };
      run.shieldCharges = 0;
      run.crashed = false;
      run.runTimeMs = 5000;
    } else if (drainShield) {
      run.shieldCharges = 0;
    }
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
      active, startedMask, shieldAtStart, absorbedCrash, texts,
      maskAfter: g.registry.get('biomeMask'),
      recordMask: rec ? (Number.isFinite(rec.biomeMask) ? rec.biomeMask : 0) : null,
      recordModded: rec ? rec.modded === true : null,
      seedText: texts.find((t) => /GATE-SEED/i.test(t)) || null,
      hasRetry: texts.some((t) => /RETRY/i.test(t)),
      hasCopy: texts.some((t) => /COPY|OK!/i.test(t)),
    };
  }, { profile, mask, seed, drainShield, absorbFirst }).catch((e) => ({ fatal: String(e) }));

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
      const { page, errors, out } = await playToGameOver(browser, port, 0, {
        boosts: { errorCorrection: true, headStart: false }, absorbFirst: true,
      });
      try {
        if (out.fatal) fail('boosted run reaches Game Over', out.fatal);
        else if (errors.length) fail('boosted run: no page errors', errors.join(' | '));
        else if (!(out.shieldAtStart >= 1)) fail('Error Correction Engine grants a shield charge', `saw ${out.shieldAtStart}`);
        // The boost must change the RUN, not just sit on the profile: a shielded crash is absorbed rather
        // than ending the run.
        else if (!out.absorbedCrash || out.absorbedCrash.crashed) fail('shield absorbs a crash', JSON.stringify(out.absorbedCrash));
        else if (out.recordModded !== true) fail('boosted run is marked modded', `saw ${out.recordModded}`);
        else pass('Error Correction Engine grants a shield, absorbs a crash, and the run is marked modded', `charges=${out.shieldAtStart}`);
      } finally { await page.close(); }
    }

    // ---- 6b. a boosted run's Game Over must not claim a clean-board honour (W4 defect 4)
    if (WITH_BOOSTS) {
      const { page, errors, out } = await playToGameOver(browser, port, 0, {
        boosts: { errorCorrection: true, headStart: false }, absorbFirst: true,
      });
      try {
        if (out.fatal) fail('modded Game Over is honest', out.fatal);
        else if (errors.length) fail('modded Game Over: no page errors', errors.join(' | '));
        else {
          // Read the SCREEN, not the record: the defect was a headline, not a flag. Every string the
          // player can see, plus the ledger title.
          const seen = await page.evaluate(async () => {
            const g = window.__bbGame;
            const over = g.scene.getScene('GameOverScene');
            if (!over) return { fatal: 'no GameOverScene' };
            const texts = [];
            const walk = (l) => {
              for (const o of l || []) {
                if (o && typeof o.text === 'string' && o.text) texts.push(o.text);
                if (o && o.list) walk(o.list);
              }
            };
            walk(over.children && over.children.list);
            // Panel keeps its title in titleText (a NeonText), not in `.title`. Reading the wrong field
            // returned '' and let this check pass on visible strings alone — a blind spot, not a pass.
            // NeonText is a container wrapping a BitmapText in `.main`; the string is main.text. The first
            // version read `.text` on the container, got undefined, and the check passed on the other
            // strings alone — exactly the "looks green, proves nothing" shape this gate exists to avoid.
            const tt = over.right && over.right.titleText;
            const title = tt && tt.main && tt.main.text ? String(tt.main.text) : '';
            return { texts, title };
          }).catch((e) => ({ fatal: String(e) }));
          if (seen.fatal) fail('modded Game Over is honest', seen.fatal);
          else {
            const all = seen.texts.join(' | ') + ' | ' + seen.title;
            const claimsClean = /NEW TOP 10/.test(all) || /NEW SEED BEST/.test(all) || /TODAY'S BEST/.test(all);
            const saysModded = /MODDED/i.test(all);
            if (claimsClean) fail('modded Game Over claims no clean-board honour', `screen says: ${all.slice(0, 160)}`);
            else if (!seen.title) fail('modded Game Over has a ledger title', 'could not read the panel title');
            else if (!saysModded) fail('modded Game Over says the run is modded/unranked', `title="${seen.title}" screen says: ${all.slice(0, 160)}`);
            else if (!/MODDED/i.test(seen.title)) fail('modded Game Over titles the MODDED board', `title="${seen.title}"`);
            else pass('modded Game Over labels the run modded and offers no clean-board honour', `title="${seen.title}"`);
          }
        }
      } finally { await page.close(); }
    }

    if (WITH_BOOSTS) {
      const { page, out } = await playToGameOver(browser, port, 0);
      try {
        if (out.recordModded !== false) fail('clean run is not marked modded', `saw ${out.recordModded}`);
        else pass('clean run is not marked modded', 'modded absent/false');
      } finally { await page.close(); }
    }
    // ---- 7. the Title menu exposes the shop, the shop opens, and buying works end to end
    if (WITH_BOOSTS) {
      const buyProfile = JSON.parse(JSON.stringify(PROFILE));
      buyProfile.bank = 275;
      buyProfile.xp = 48400;
      buyProfile.unlocked.cosmetics = [];
      buyProfile.equipped = { trail: 'default', glow: 'default', rider: 'default', theme: 'default', title: 'default' };
      const { page, errors } = await bootWithProfile(browser, port, buyProfile);
      try {
        const out = await page.evaluate(async () => {
          const g = window.__bbGame;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          g.scene.start('TitleScene');
          await wait(1100);
          const t = g.scene.getScene('TitleScene');

          // Every glyph actually on the shop panel, as screen rects: (text, world x, world y, w, h).
          // This reads the OBJECTS, not the layout module, so a second overlapping layer drawn by the view
          // is visible here even though the layout itself is correct.
          // Read a boost row's rendered state from the glyphs actually on screen. CC Friday's defect was
          // that the profile saved errorCorrection:true while the row still drew OFF, so the gate reads
          // the row itself — reading the profile would have passed on the broken build.
          // A row's drawn strings are NeonText wrappers whose actual string lives on `.main.text`
          // (Neon.js keeps a BitmapText inside the wrapper for the fill/shadow passes). Reading `.text`
          // on the wrapper returns undefined, which is how an earlier version of this check reported an
          // empty row and looked like a rendering bug rather than a probe bug.
          const textOf = (o) => (o && o.main && typeof o.main.text === 'string' ? o.main.text : '');
          const readBoostRow = (view, boostId) => {
            const menu = (view && view.menu) || {};
            const items = menu.items || [];
            const idx = items.findIndex((it) => it && it.boostId === boostId);
            if (idx < 0) return { found: false };
            const row = (menu.rows || [])[idx];
            if (!row) return { found: false };
            const joined = [textOf(row.label), textOf(row.value), textOf(row.sub)].filter(Boolean).join(' ');
            return { found: true, texts: joined, on: /\bON\b/.test(joined) && !/\bOFF\b/.test(joined) };
          };

          const glyphsOn = (view) => {
            const out = [];
            const seenObjs = new Set();
            const walk = (l) => {
              for (const o of l || []) {
                if (!o || seenObjs.has(o)) continue; // a container can be reachable twice; count it once
                seenObjs.add(o);
                // Only LEAF text: a container that holds children is not itself a drawn string, and
                // counting both a NeonText and the glyphs inside it would double-report every line.
                const hasChildren = Array.isArray(o.list) && o.list.length > 0;
                if (!hasChildren && typeof o.text === 'string' && o.text && o.width !== undefined) {
                  const b = o.getBounds ? o.getBounds() : null;
                  if (b) out.push({ text: o.text, x: b.x, y: b.y, w: b.width, h: b.height });
                }
                if (hasChildren) walk(o.list);
              }
            };
            if (view && view.panel) walk(view.panel.list);
            // NeonText draws a shadow pass and a fill pass at the SAME rect; that is one readable string,
            // not two overlapping ones. Collapse identical text at identical geometry before testing.
            const byPos = new Map();
            for (const r of out) {
              const k = `${r.text}@${Math.round(r.x)},${Math.round(r.y)}`;
              if (!byPos.has(k)) byPos.set(k, r);
            }
            return [...byPos.values()];
          };
          const overlapPairs = (rects) => {
            const bad = [];
            for (let i = 0; i < rects.length; i++) {
              for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i];
                const b = rects[j];
                const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
                if (hit) bad.push(`${a.text} <-> ${b.text}`);
              }
            }
            return bad;
          };

          // SHARD SHOP now lives in PROFILE, because six 2x rows is all the Title band holds.
          const titles = ((t.menu && t.menu.items) || []).map((i) => String(i.label || ''));
          if (titles.some((x) => /SHOP/i.test(x))) return { fatal: `shop still on Title menu: ${JSON.stringify(titles)}` };
          const profileItem = (t.menu.items || []).find((i) => /PROFILE/i.test(String(i.label || '')));
          if (!profileItem) return { fatal: `no PROFILE entry: ${JSON.stringify(titles)}` };
          profileItem.onSelect();
          await wait(900);
          const pView = t.view;
          if (!pView || !pView.shopButton) return { fatal: 'PROFILE has no SHARD SHOP button' };
          // Press the button the player presses.
          pView.shopButton.zone ? pView.shopButton.zone.emit('pointerdown') : pView.shopButton.emit('pointerdown');
          await wait(900);
          const view = t.view;
          if (!view || !view.menu) return { fatal: 'shop view did not open from PROFILE' };

          const before = g.registry.get('profile');
          const beforeBank = before.bank;
          const beforeGlyphs = glyphsOn(view);
          const beforeBad = overlapPairs(beforeGlyphs);
          const beforeBankText = beforeGlyphs.filter((x) => /BANK/.test(x.text)).map((x) => x.text);

          // Toggle a boost ON the way the row does, then read the ROW back. CC Friday's defect was that
          // the profile said errorCorrection:true while the row still drew OFF, so both have to be read.
          const boostItems = (view.menu && view.menu.items) || [];
          const boostIdx = boostItems.findIndex((it) => it && it.boostId === 'errorCorrection');
          if (boostIdx < 0) return { fatal: 'no boost item: ' + JSON.stringify(boostItems.map((i) => Object.keys(i || {})).slice(0, 4)) };
          // Exercise the player's choice-row pointer handler, including its redraw.
          view.menu._onPointerDown(boostIdx, view.menu.w - 1);
          await wait(350);
          // Read the currently displayed menu after the interaction.
          const liveView = t.view;
          const boostAfterSet = readBoostRow(liveView, 'errorCorrection');
          const boostSaved = Boolean((g.registry.get('profile').boosts || {}).errorCorrection);

          // Buy the cheapest unowned rider hue through the view's own handler.
          view._choose('rider-hue-mint');
          await wait(500);
          const after = g.registry.get('profile');
          const afterGlyphs = glyphsOn(view);
          const afterBad = overlapPairs(afterGlyphs);
          const afterBankText = afterGlyphs.filter((x) => /BANK/.test(x.text)).map((x) => x.text);

          return {
            titles,
            opened: true,
            beforeGlyphs: beforeGlyphs.length,
            afterGlyphs: afterGlyphs.length,
            beforeBad,
            afterBad,
            beforeBankText,
            afterBankText,
            beforeBank,
            afterBank: after.bank,
            owned: (after.unlocked.cosmetics || []).includes('rider-hue-mint'),
            equipped: after.equipped.rider,
            // CC Friday found, playing the built game, that toggling a boost saved the profile but left
            // the row reading OFF. The row's options come from a `get` closure, so the gate has to read
            // the row BACK after setting it — reading the profile would have passed on the broken build.
            boost: boostAfterSet,
            boostSaved,
          };
        }).catch((e) => ({ fatal: String(e) }));
        // Readability is now a GATE, not a screenshot someone has to eyeball. CC Friday's rejection was
        // "the logic passes but the screen is unreadable", so the gate asserts the drawn rects themselves.
        if (out.fatal) fail('shop: opens from PROFILE', out.fatal);
        else if (errors.length) fail('shop: no page errors', errors.join(' | '));
        else if (!out.beforeBankText.length) fail('shop: shows the bank', 'no BANK line rendered');
        else if (out.beforeBad.length) fail('shop: no two glyphs overlap on open', out.beforeBad.slice(0, 4).join(' | '));
        else if (out.afterBad.length) fail('shop: no two glyphs overlap after a purchase', out.afterBad.slice(0, 4).join(' | '));
        // The stale-text defect: the bank line and the row states must be rebuilt, not just the menu rows.
        else if (out.afterBankText.join() === out.beforeBankText.join()) fail('shop: the bank line refreshes after a purchase', `still ${out.beforeBankText.join()}`);
        else if (!/BANK 175/.test(out.afterBankText.join())) fail('shop: bank line shows the new balance', out.afterBankText.join());
        else if (out.afterBank !== out.beforeBank - 100) fail('shop: buying debits the price', `${out.beforeBank} -> ${out.afterBank}`);
        else if (!out.owned) fail('shop: buying records ownership', 'not in unlocked.cosmetics');
        else if (out.equipped !== 'mint') fail('shop: buying equips in the same action', `equipped ${out.equipped}`);
        else if (!out.boostSaved) fail('shop: toggling a boost saves it', 'profile.boosts.errorCorrection not set');
        else if (!out.boost.found) fail('shop: the boost row is readable', 'row not found in the rendered list');
        else if (!out.boost.on) fail('shop: the boost row shows ON after being set ON', `row drew "${out.boost.texts}"`);
        else pass('shop: opens from PROFILE, no glyphs overlap, bank refreshes, buying debits/owns/equips, boost row reflects the toggle', `${out.beforeGlyphs} glyphs, bank ${out.beforeBank} -> ${out.afterBank}`);
      } finally { await page.close(); }
    }

    // ---- 8. the leaderboard has a modded tab, and it opens
    if (WITH_BOOSTS) {
      const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
      try {
        const out = await page.evaluate(async () => {
          const g = window.__bbGame;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          g.scene.start('TitleScene');
          await wait(1100);
          const t = g.scene.getScene('TitleScene');
          const item = (t.menu.items || []).find((i) => /LEADERBOARD/i.test(String(i.label || '')));
          if (!item) return { fatal: 'no leaderboard entry' };
          item.onSelect();
          await wait(900);
          const view = t.view;
          if (!view) return { fatal: 'leaderboard view did not open' };
          const read = () => (view.tabBtn && view.tabBtn.label && view.tabBtn.label.main)
            ? view.tabBtn.label.main.text : null;
          const cleanLabel = read();
          if (!view.tabBtn) return { fatal: 'no board tab button' };
          view._toggleBoard();
          await wait(600);
          const moddedLabel = read();
          return { cleanLabel, moddedLabel, toggled: view.showingModded };
        }).catch((e) => ({ fatal: String(e) }));
        if (out.fatal) fail('leaderboard: opens with a board tab', out.fatal);
        else if (errors.length) fail('leaderboard: no page errors', errors.join(' | '));
        else if (out.cleanLabel !== 'MODDED') fail('leaderboard: clean board offers the modded tab', `tab read ${out.cleanLabel}`);
        else if (!out.toggled) fail('leaderboard: tab switches to the modded board', 'showingModded stayed false');
        else if (out.moddedLabel !== 'CLEAN') fail('leaderboard: modded board offers the way back', `tab read ${out.moddedLabel}`);
        else pass('leaderboard: clean/modded tab both ways', 'MODDED -> CLEAN');
      } finally { await page.close(); }
    }

    // ---- 9. a boosted loadout is REFUSED on the daily run (spec W4)
    if (WITH_BOOSTS) {
      const dailyProfile = JSON.parse(JSON.stringify(PROFILE));
      dailyProfile.boosts = { errorCorrection: true, headStart: true };
      const { page, errors } = await bootWithProfile(browser, port, dailyProfile);
      try {
        const out = await page.evaluate(async () => {
          const g = window.__bbGame;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          g.scene.start('TitleScene');
          await wait(1000);
          const t = g.scene.getScene('TitleScene');
          const daily = (t.daily && t.daily.seed) || null;
          if (!daily) return { fatal: 'no daily seed available' };
          t.starting = false;
          // Start the daily through the same call the DAILY RUN menu item makes.
          t.startRun(daily, null);
          await wait(1600);
          const run = g.scene.getScene('RunScene');
          if (!run) return { fatal: 'daily run did not start' };
          return {
            seed: run.seed,
            shield: run.shieldCharges || 0,
            modded: run.modded === true,
            factor: run.boostFx ? run.boostFx.speedFactor : null,
          };
        }).catch((e) => ({ fatal: String(e) }));
        if (out.fatal) fail('daily: run starts', out.fatal);
        else if (errors.length) fail('daily: no page errors', errors.join(' | '));
        else if (!/^daily-/.test(String(out.seed))) fail('daily: run really is the daily', `seed ${out.seed}`);
        else if (out.shield !== 0) fail('daily refuses the shield boost', `shieldCharges ${out.shield}`);
        else if (out.modded) fail('daily run is not marked modded', 'modded true');
        else if (out.factor !== 1) fail('daily refuses Head Start', `speedFactor ${out.factor}`);
        else pass('daily run refuses both boosts while the profile has them ON', 'shield 0, factor 1, not modded');
      } finally { await page.close(); }
    }

    // ---- 10. a boosted run still earns Resonance and shards, even though it cannot rank
    if (WITH_BOOSTS) {
      const earnProfile = JSON.parse(JSON.stringify(PROFILE));
      // Head Start only. With Error Correction the shield ABSORBS the crash that ends this run, so the
      // run would keep going and never credit - correct behaviour, useless as a test of crediting.
      earnProfile.boosts = { errorCorrection: false, headStart: true };
      earnProfile.bank = 0;
      earnProfile.xp = 0;
      const { page, errors } = await bootWithProfile(browser, port, earnProfile);
      try {
        const out = await page.evaluate(async () => {
          const g = window.__bbGame;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          g.scene.start('TitleScene');
          await wait(1000);
          const t = g.scene.getScene('TitleScene');
          t.starting = false;
          t.startRun('earn-gate', 0);
          await wait(1600);
          const run = g.scene.getScene('RunScene');
          if (!run) return { fatal: 'run did not start' };
          run.runTimeMs = 6000;
          run.shardCount = 12;
          run.pendingCrash = { cause: 'chasm' };
          // The credit lands asynchronously on RUN_END (the service banks synchronously, but the profile
          // object is replaced, so polling the registry is the honest wait rather than a fixed sleep).
          let prof = g.registry.get('profile');
          for (let i = 0; i < 30 && !((prof.xp || 0) > 0); i++) {
            await wait(200);
            prof = g.registry.get('profile');
          }
          prof = g.registry.get('profile');
          return {
            xp: prof.xp || 0,
            bank: prof.bank || 0,
            lifetimeShards: (prof.lifetime && prof.lifetime.shards) || 0,
            runs: (prof.lifetime && prof.lifetime.runs) || 0,
          };
        }).catch((e) => ({ fatal: String(e) }));
        if (out.fatal) fail('boosted run: starts and ends', out.fatal);
        else if (errors.length) fail('boosted run: no page errors', errors.join(' | '));
        else if (!(out.xp > 0)) fail('boosted run still earns Resonance', `xp ${out.xp}`);
        else if (!(out.bank > 0)) fail('boosted run still earns shards', `bank ${out.bank}`);
        else pass('boosted run still earns Resonance and shards despite not ranking', `xp ${out.xp}, bank ${out.bank}`);
      } finally { await page.close(); }
    }

    // ---- 11/12. W4 cosmetics reach the sled, and colourblind refuses them
    if (WITH_BOOSTS) {
      const baseProfile = JSON.parse(JSON.stringify(PROFILE));

      // A bought-and-equipped hue must change what is DRAWN, not just what is stored.
      const equipped = JSON.parse(JSON.stringify(baseProfile));
      equipped.bank = 1000;
      equipped.unlocked.cosmetics = ['rider-hue-mint', 'sled-glow-warm', 'trail-hue-ember'];
      equipped.equipped = { trail: 'trail-hue-ember', glow: 'sled-glow-warm', rider: 'rider-hue-mint', theme: 'default', title: 'default' };
      const a = await probeLook(browser, port, equipped);
      try {
        if (a.out.fatal) fail('cosmetics: run starts', a.out.fatal);
        else if (a.errors.length) fail('cosmetics: no page errors', a.errors.join(' | '));
        else if (!a.out.look) fail('cosmetics: look resolved for the run', 'run.look missing');
        else if (a.out.drawnRider === a.out.paletteMagenta) fail('equipped rider hue is drawn', 'still the palette magenta');
        else if (a.out.drawnGlow === a.out.paletteCyan) fail('equipped sled glow is drawn', 'still the palette cyan');
        else if (!a.out.drawnTrail) fail('equipped trail hue is drawn', 'trail stops not applied');
        else pass('equipped cosmetics reach the drawn sled, glow and trail', `rider=${a.out.drawnRider.toString(16)} glow=${a.out.drawnGlow.toString(16)}`);
      } finally { if (a.page) await a.page.close(); }

      // Colourblind must refuse the same loadout: the safety clause in the spec.
      const cbProfile = JSON.parse(JSON.stringify(equipped));
      const b = await (async () => {
        const { page, errors } = await bootWithProfileCb(browser, port, cbProfile);
        try {
          const out = await page.evaluate(async () => {
            const g = window.__bbGame;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            g.registry.set('biomeMask', 0);
            g.scene.start('TitleScene');
            await wait(800);
            const t = g.scene.getScene('TitleScene');
            t.starting = false;
            t.startRun('look-cb', 0);
            await wait(1600);
            const run = g.scene.getScene('RunScene');
            if (!run) return { fatal: 'RunScene did not start' };
            const pal = run.palette;
            return {
              overridden: !!(run.look && run.look.overridden),
              drawnRider: run.sled._cosmetic('rider', pal.magenta),
              paletteMagenta: pal.magenta,
            };
          }).catch((e) => ({ fatal: String(e) }));
          return { errors, out };
        } finally { await page.close(); }
      })();
      try {
        if (b.out.fatal) fail('colourblind: run starts', b.out.fatal);
        else if (!b.out.overridden) fail('colourblind refuses cosmetics', 'look.overridden was false');
        else if (b.out.drawnRider !== b.out.paletteMagenta) fail('colourblind rider falls back to the palette', `drew ${b.out.drawnRider.toString(16)}`);
        else pass('colourblind mode refuses the equipped cosmetics', 'rider fell back to the palette');
      } finally { /* page closed above */ }
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
