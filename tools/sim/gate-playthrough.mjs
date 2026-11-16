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
 *   - decisions 1/2/4/6: a typed daily seed is practice, the DAILY RUN item is official, ledger v2
 *     rejects tampering, and Head Start is >= +15 % distance at 10 s on the same seed
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
// How many results each mode must record. Raise these when you add a check; a lower count means a
// block silently did not run.
const EXPECTED_WITH_BOOSTS = 77; // B4 Sky Jellyfish bounce: +2 (the bouncySpring rebound is felt on the real sled - same pose, three arms: plain ground, spring zone, spring + Rails - and it does not pogo); B4: +5 (meteor crash + killer named, meteor air-telegraphed + dodged hands-off, gust impulse on the real sled and never the killer, each stabilizer saves a real landing; Rails damp the bouncySpring); Readable Chaos 3: +4 (real crash named / slowed / on Game Over, late hop verdict, absorbed hit is no crash, DIED HERE on retry); B3 tuning: +2 (each rolling hazard never catches a moving sled and overtakes a stopped one slowly, in view); Micro glow-up: +6 (bees on Micro, none on mask 0, drone locked in the shop, granted + toast, equip, drawn next run); Readable Chaos: +3 (ground telegraph off-screen, camera at 1200 px/s, B3 predicted arrival / gate verdict); B3: +6 (each moving hazard moves and crashes, each glide on the real sled, Treads vs the conveyor); B2: +4 (blind per Sight hazard, Goggles ward, Heat Shield); B1: +8 (hazard and power-up per Wards biome); decisions 1/2/4/6: +4; T2: +1 (the real sled rides the Micro dew swell); decision 3: +2
const EXPECTED_WITHOUT_BOOSTS = 65; // B4 Sky Jellyfish bounce: +2; B4: +5; Readable Chaos 3: +4; B3 tuning: +2; Micro glow-up: +6; Readable Chaos: +3; B3: +6; B2: +4; B1: +8; decisions 1/2/6: +3 (Head Start needs --with-boosts); T2: +1; decision 3: +2

// xpMin 48400 is level 16, the threshold that unlocks all five W3 biomes (13 underwater, 16 crystal), so
// the fixture's mask 31 is reachable. Set XP, not `level`: ProfileStore derives level from XP on every
// load, and derives `pendingBiomes` from the level table on top of that, so a hand-set level or mask
// alone is silently discarded.
const PROFILE = {
  v: 1, xp: 48400, level: 16, bank: 0, biomeMask: 31,
  pendingBiomes: ['debumont', 'garbage-dump-glacier', 'pyramid-peak', 'underwater-mountain', 'crystal-cavern'],
  // Level 16 has crossed both boost unlock levels (Head Start 8, Error Correction 15). A real profile
  // gets these from grantLevelRewards when the level is crossed; a fixture that sets XP directly must
  // carry them, or the boost checks would be testing a locked boost (which correctly does nothing).
  unlocked: { biomes: [], cosmetics: [], boosts: { headStart: 8, errorCorrection: 15 } },
  boosts: { errorCorrection: false, headStart: false },
  missions: { counter: 0, active: [], progress: {} }, achievements: {}, credited: [],
  lifetime: { runs: 0, distanceM: 0, playMs: 0, score: 0, tricks: {}, shards: 0, nearMisses: 0,
    bestScore: 0, bestDistanceM: 0, bestCombo: 1, maxAirtimeMs: 0 },
};

// B1: the shipped biome defs, read from src/data so gate expectations follow the JSON (dist is built from it)
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const defsIn = (dir) => Object.fromEntries(fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.json')).map((f) => { const d = readJson(path.join(dir, f)); return [d.id, d]; }));
const HAZ_DEFS = defsIn('src/data/hazards');
const PU_DEFS = defsIn('src/data/powerups');

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
    // Wait for the Game Over scene to actually become ACTIVE rather than sleeping a fixed 3s. The fixed
    // sleep is flaky under load (a jest run or a second gate beside it): the run has not yet handed off,
    // the probe reads an inactive scene, and the gate reports "scene not active" — a harness timing bug
    // that looks exactly like a broken Game Over screen. This is the same fix W6 carries; the shop branch
    // is cut from main at W5, which predates it. Poll the real condition, then let the panels build.
    const deadline = Date.now() + 15000;
    let active = false;
    while (Date.now() < deadline) {
      const s = g.scene.getScene('GameOverScene');
      active = Boolean(s && s.scene && s.scene.isActive && s.scene.isActive());
      if (active) break;
      await wait(100);
    }
    if (active) await wait(350);
    const over = g.scene.getScene('GameOverScene');
    if (!active) {
      // Say what the scene actually is, not just that it is not active -- a real recurrence should diagnose
      // itself instead of needing a reproduction.
      const s = g.scene.getScene('GameOverScene');
      return { active, sceneMissing: !s, sceneKey: s ? s.scene.key : null, sceneState: s && s.scene ? {
        isActive: typeof s.scene.isActive === 'function' ? s.scene.isActive() : null,
        isSleeping: typeof s.scene.isSleeping === 'function' ? s.scene.isSleeping() : null,
        isPaused: typeof s.scene.isPaused === 'function' ? s.scene.isPaused() : null,
      } : null, scenes: g.scene.getScenes(true).map((x) => x.scene.key), out: { texts: [] } };
    }
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


/**
 * Decisions 1/2: start a run on today's daily seed either through the REAL DAILY RUN menu item
 * (`viaMenu`) or as a typed seed (TitleScene.startRun, what ENTER SEED's submit calls), end it through the
 * production crash path, and read back the saved record, the Daily surfaces before/after, and Game Over.
 */
async function dailyOutcome(browser, port, { viaMenu }) {
  const profile = JSON.parse(JSON.stringify(PROFILE));
  const { page, errors } = await bootWithProfile(browser, port, profile);
  try {
    const out = await page.evaluate(async ({ viaMenu }) => {
      const g = window.__bbGame;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      g.scene.start('TitleScene');
      await wait(900);
      const t = g.scene.getScene('TitleScene');
      t.starting = false;
      const store = g.registry.get('saveStore');
      const seed = t.daily && t.daily.seed;
      if (!seed) return { fatal: 'no daily seed' };
      const statsBefore = store.getDailyStats(Date.now());
      const streakBefore = store.getDailyStreak(Date.now());
      if (viaMenu) {
        const item = t.menu && t.menu.items.find((i) => i.label === 'DAILY RUN');
        if (!item) return { fatal: 'no DAILY RUN menu item' };
        item.onSelect();
      } else {
        t.startRun(seed);
      }
      await wait(1600);
      const run = g.scene.getScene('RunScene');
      if (!run || !run.sled) return { fatal: 'run did not start' };
      const official = run.dailyOfficial === true;
      run.runTimeMs = 5000;
      run.pendingCrash = { cause: 'chasm' };
      const deadline = Date.now() + 15000;
      let active = false;
      while (Date.now() < deadline) {
        const s = g.scene.getScene('GameOverScene');
        active = Boolean(s && s.scene && s.scene.isActive && s.scene.isActive());
        if (active) break;
        await wait(100);
      }
      if (!active) return { fatal: 'Game Over never became active' };
      await wait(350);
      const rec = g.registry.get('lastRecord');
      const over = g.scene.getScene('GameOverScene');
      const texts = [];
      const walk = (list) => { for (const o of list || []) { if (!o) continue; if (typeof o.text === 'string' && o.text) texts.push(o.text); if (o.list) walk(o.list); } };
      walk(over.children && over.children.list);
      const statsAfter = store.getDailyStats(Date.now());
      const streakAfter = store.getDailyStreak(Date.now());
      // Ledger v2 tamper (decision 6): export the saved run, import it into a fresh in-memory store, then
      // re-import tampered copies. Exercises the shipped SaveStore class, not a re-implementation.
      let ledger = null;
      if (viaMenu && rec) {
        const S = store.constructor;
        await store.setInitials(rec.id, 'GAT');
        const code = await store.exportSharecode();
        const payload = JSON.parse(atob(code.slice(4)));
        const mine = payload.runs.find((r) => r.id === rec.id);
        const ok = await new S().importSharecode(JSON.stringify({ runs: [mine] }));
        const tampered = [
          { ...mine, score: mine.score + 1000 },
          { ...mine, dailyOfficial: false },
          { ...mine, biomeMask: ((mine.biomeMask || 0) + 1) },
          { ...mine, ledgerHash: '' },
        ];
        const bad = await new S().importSharecode(JSON.stringify({ runs: tampered }));
        const stripped = { ...mine }; delete stripped.hashV;
        const down = await new S().importSharecode(JSON.stringify({ runs: [stripped] }));
        ledger = { hashV: mine.hashV, ok, bad, down };
      }
      return {
        official, seed: run.seed,
        rec: rec ? { dailyOfficial: rec.dailyOfficial, hashV: rec.hashV, seed: rec.seed } : null,
        statsBefore: statsBefore ? statsBefore.attempts : 0, statsAfter: statsAfter ? statsAfter.attempts : 0,
        playedTodayBefore: streakBefore.playedToday, playedTodayAfter: streakAfter.playedToday,
        streakBefore: streakBefore.streak, streakAfter: streakAfter.streak,
        practiceLabel: texts.find((x) => /DAILY PRACTICE/.test(x)) || null,
        officialLabel: texts.find((x) => /^DAILY RUN/.test(x)) || null,
        todaysLine: texts.find((x) => /TODAY'S/.test(x)) || null,
        ledger,
      };
    }, { viaMenu }).catch((e) => ({ fatal: String(e) }));
    return { errors, out };
  } finally { await page.close(); }
}

/**
 * Decision 4: same-seed distance at 10 s of run time, clean vs Head Start, on the REAL sled. The game loop
 * is stopped and the run is advanced with headlessStep at a fixed 1/60 s (as tools/sim/browser.js does),
 * so the comparison does not depend on frame timing. Hands off: no input in either run.
 */
async function distanceAt10s(browser, port, headStart, seed) {
  const profile = JSON.parse(JSON.stringify(PROFILE));
  profile.boosts = { errorCorrection: false, headStart };
  const { page, errors } = await bootWithProfile(browser, port, profile);
  try {
    const out = await page.evaluate(({ seed }) => {
      const g = window.__bbGame;
      const DT = 1000 / 60;
      g.loop.stop();
      for (const k of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) { try { g.scene.stop(k); } catch (e) { /* not running */ } }
      g.registry.set('seed', seed);
      g.registry.set('biomeMask', 0);
      g.registry.set('dailyOfficial', false);
      let scene = null;
      g.events.once('bb:runStart', () => { scene = g.scene.getScene('RunScene'); });
      g.scene.start('RunScene');
      let t = 0;
      for (let i = 0; i < 6 && !scene; i++) { g.headlessStep(t, DT); t += DT; }
      if (!scene) return { fatal: 'RunScene did not start' };
      let m10 = null;
      let crashedAt = null;
      for (let i = 0; i < 2000 && m10 === null; i++) {
        g.headlessStep(t, DT); t += DT;
        if (!scene.sled || scene.crashed || scene.pendingCrash) { crashedAt = Math.round(scene.runTimeMs); break; }
        if (scene.runTimeMs >= 10000) m10 = (scene.sled.x - scene.startX) / 20;
      }
      return { m10, crashedAt, modded: scene.modded === true, opening: scene.opening };
    }, { seed }).catch((e) => ({ fatal: String(e) }));
    return { errors, out };
  } finally { await page.close(); }
}

async function main() {
  const { server, port } = await serve();
  const browser = await chromium.launch();
  try {
    // ---- W4.1 shop autoprompt: pops when rich, silent when broke, and retry still wins
    //
    // Real game, real economy: the run is credited by production code, which is the only way to prove the
    // before/after bank arithmetic and the popup decision agree with the bank the shop then shows.
    {
      const SHOP_RICH = { ...JSON.parse(JSON.stringify(PROFILE)), bank: 400 };
      const probeShop = async (profile, { pressRetry = false, shards = 95 } = {}) => {
        const { page, errors } = await bootWithProfile(browser, port, profile);
        try {
          return await page.evaluate(async ({ pressRetry, shards }) => {
            const g = window.__bbGame;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            g.registry.set('biomeMask', 0);
            g.scene.start('TitleScene');
            await wait(900);
            const title = g.scene.getScene('TitleScene');
            title.starting = false;
            title.startRun('shop-seed', 0);
            await wait(1600);
            const run = g.scene.getScene('RunScene');
            if (!run) return { fatal: 'RunScene did not start' };
            // Give the run shards so the credit moves the bank by a known amount. `shards` in the record is
            // `shardCount` (a count, 1 shard each), so that is what a real run would have incremented per
            // pickup; setting it here is the same value the collect loop would have produced.
            run.runTimeMs = 5000;
            run.shardCount = shards;
            run.pendingCrash = { cause: 'chasm' };
            // Wait for Game Over to build, then for the autoprompt delay to elapse.
            for (let i = 0; i < 60 && !(g.scene.getScene('GameOverScene') && g.scene.getScene('GameOverScene').scene.isActive()); i += 1) await wait(250);
            const over = g.scene.getScene('GameOverScene');
            if (!over) return { fatal: 'GameOverScene never became active' };
            const bankAtOver = (g.registry.get('profile') || {}).bank;
            const flag = (g.registry.get('lastAwards') || {}).shopAutoprompt;
            const texts = () => {
              const out = [];
              const seen = new Set();
              const walk = (list) => {
                for (const obj of list || []) {
                  if (!obj) continue;
                  if (typeof obj.text === 'string' && obj.text && !seen.has(obj.text)) { seen.add(obj.text); out.push(obj.text); }
                  if (obj.list) walk(obj.list);
                }
              };
              walk(over.children && over.children.list);
              if (over.shopView && over.shopView.panel) walk(over.shopView.panel.list);
              return out;
            };
            const hintBefore = texts().some((t) => /SHOP:\s*B/i.test(t));
            if (pressRetry) {
              // Press retry BEFORE the popup would fire: the run must restart and no shop may appear.
              over.retry();
              await wait(1800);
              return {
                bankAtOver, flag, hintBefore,
                shopOpenAfterRetry: Boolean(g.scene.getScene('RunScene')) && !g.scene.getScene('GameOverScene'),
                sceneIsRun: Boolean(g.scene.getScene('RunScene') && g.scene.getScene('RunScene').scene.isActive()),
              };
            }
            await wait(1800); // > SHOP_PROMPT_MS
            const openAfterDelay = Boolean(over.shopOpen);
            const hasShopTitle = texts().some((t) => /SHARD SHOP/i.test(t));
            // Retry while the shop is open must close it and start a run. Decision 7: confirm buys in an armed shop, so retry is its own action (Space / pad RB).
            over._onAction('retry');
            await wait(900);
            const retried = Boolean(g.scene.getScene('RunScene') && g.scene.getScene('RunScene').scene.isActive());
            return { bankAtOver, flag, hintBefore, openAfterDelay, hasShopTitle, retried };
          }, { pressRetry, shards }).catch((e) => ({ fatal: String(e) }));
        } finally { await page.close(); }
      };

      // Rich: crosses nothing new? bank 400 already covers every level-1 price, so the amendment says NO popup
      // even though the hint must show. This is the case that separates "affordable" from "newly affordable".
      const rich = await probeShop(SHOP_RICH);
      if (rich.fatal) fail('shop autoprompt: rich profile reaches Game Over', rich.fatal);
      else if (!rich.hintBefore) fail('shop hint shows for a stockpile player', `texts had no SHOP: B (bank ${rich.bankAtOver})`);
      else if (rich.openAfterDelay) fail('stockpile player is not interrupted', `flag=${rich.flag}`);
      else if (!rich.retried) fail('retry works from a stockpile Game Over', 'RunScene did not start');
      else pass('stockpile: hint shown, no unrequested popup, retry works', `bank=${rich.bankAtOver}`);

      // Broke: nothing affordable at all -> no hint, no popup.
      const poor = { ...JSON.parse(JSON.stringify(PROFILE)), bank: 0 };
      // A run that PAYS shards cannot leave the player broke, so the broke case must also earn nothing.
      const broke = await probeShop(poor, { shards: 0 });
      if (broke.fatal) fail('shop autoprompt: broke profile reaches Game Over', broke.fatal);
      else if (broke.hintBefore) fail('broke player sees no shop hint', `bank ${broke.bankAtOver}`);
      else if (broke.openAfterDelay) fail('broke player gets no popup', `flag=${broke.flag}`);
      else pass('broke: no hint, no popup', `bank=${broke.bankAtOver}`);

      // Crossing a price: bank 0, a run that pays 95, and the 90-shard item was not affordable before, so the
      // popup MUST fire — and retry from inside it must work.
      const crosser = await probeShop(poor, { shards: 95 });
      if (crosser.fatal) fail('shop autoprompt: crossing run reaches Game Over', crosser.fatal);
      else if (!(crosser.bankAtOver >= 95)) fail('the crossing run is credited', `bank ${crosser.bankAtOver}, expected at least the 95 shards the run collected`);
      else if (!crosser.flag) fail('crossing a price sets the autoprompt flag', `bank=${crosser.bankAtOver}`);
      else if (!crosser.openAfterDelay) fail('crossing a price opens the shop', 'shopOpen false after the delay');
      else if (!crosser.hasShopTitle) fail('the opened panel is the Shard Shop', 'no SHARD SHOP title on screen');
      else if (!crosser.retried) fail('retry from inside the opened shop', 'RunScene did not start');
      else pass('crossing a price pops the shop once, and retry from it starts the run', `bank=${crosser.bankAtOver}`);

      const early = await probeShop(SHOP_RICH, { pressRetry: true });
      if (early.fatal) fail('shop autoprompt: early-retry probe', early.fatal);
      else if (!early.sceneIsRun) fail('retry before the popup fires restarts at once', 'RunScene not active');
      else pass('retry before the popup fires restarts at once', 'no popup');
    }

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

    // ---- 6b. a boosted run's Game Over must not claim a clean-board honour, and every glyph must be legible (W4 defect 4)
    if (WITH_BOOSTS) {
      const { page, errors, out } = await playToGameOver(browser, port, 0, {
        boosts: { errorCorrection: true, headStart: false }, absorbFirst: true,
      });
      try {
        if (out.fatal) fail('modded Game Over is honest', out.fatal);
        else if (errors.length) fail('modded Game Over: no page errors', errors.join(' | '));
        else {
          // Read the SCREEN, not the record: the defect was a headline, not a flag. Every string and
          // every drawn glyph rect, plus the qualifying initials-entry -> saved-board flow.
          const seen = await page.evaluate(async () => {
            const g = window.__bbGame;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const inspectScene = (over) => {
              const glyphs = [];
              const seenObjs = new Set();
              // ghostA/ghostB are decorative chromatic-aberration shadows of the big CRASHED header.
              const skip = new Set([over.ghostA, over.ghostB].filter(Boolean));
              const walk = (l, hidden = false) => {
                for (const o of l || []) {
                  if (!o || seenObjs.has(o) || skip.has(o)) continue;
                  seenObjs.add(o);
                  const vis = !hidden && o.visible !== false && (o.alpha === undefined || o.alpha > 0);
                  const kids = Array.isArray(o.list) ? o.list : [];
                  if (!kids.length && vis && typeof o.text === 'string' && o.text && o.width !== undefined) {
                    const b = o.getBounds ? o.getBounds() : null;
                    if (b) {
                      glyphs.push({
                        text: o.text, x: b.x, y: b.y, w: b.width, h: b.height, inkH: b.height * (8 / 9),
                      });
                    }
                  }
                  if (kids.length) walk(kids, !vis);
                }
              };
              walk(over.children && over.children.list);
              const byPos = new Map();
              for (const r of glyphs) {
                const k = `${r.text}@${Math.round(r.x)},${Math.round(r.y)}`;
                if (!byPos.has(k)) byPos.set(k, r);
              }
              const rects = [...byPos.values()];
              const bad = [];
              for (let i = 0; i < rects.length; i++) {
                for (let j = i + 1; j < rects.length; j++) {
                  const a = rects[i]; const b = rects[j];
                  if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.inkH && b.y < a.y + a.inkH) {
                    bad.push(`${a.text} <-> ${b.text}`);
                  }
                }
              }
              const clipped = rects.filter((r) => r.inkH < 7.9 || r.x < 0 || r.y < 0 || r.x + r.w > 480 || r.y + r.inkH > 270);
              const tt = over.right && over.right.titleText;
              const title = tt && tt.main && tt.main.text ? String(tt.main.text) : '';
              return {
                texts: rects.map((r) => r.text),
                title,
                count: rects.length,
                bad,
                clipped: clipped.map((r) => `${r.text}(${r.x.toFixed(1)},${r.y.toFixed(1)},${r.w.toFixed(1)}x${r.inkH.toFixed(1)})`),
                minInkH: rects.length ? Math.min(...rects.map((r) => r.inkH)) : 0,
                // Diagnostics for a title read that comes back empty: is the scene active, does the panel
                // exist, does the panel have a title object, and what does the raw string look like?
                diag: {
                  active: Boolean(over.scene && over.scene.isActive && over.scene.isActive()),
                  hasRight: Boolean(over.right),
                  hasTitleText: Boolean(tt),
                  hasMain: Boolean(tt && tt.main),
                  rawTitle: tt && tt.main ? JSON.stringify(tt.main.text) : 'no-main',
                  titleVisible: tt ? tt.visible !== false : null,
                  rightTitle: over.right && over.right.titleText && over.right.titleText.main
                    ? JSON.stringify(over.right.titleText.main.text) : 'n/a',
                  hasEntry: Boolean(over.entry),
                  recId: over.rec ? over.rec.id : null,
                  moddedFlag: over.modded,
                },
              };
            };

            const over1 = g.scene.getScene('GameOverScene');
            if (!over1) return { fatal: 'no GameOverScene' };
            const boardOnly = inspectScene(over1);

            // Also exercise a qualifying modded run (score >= 200) -> NEW MODDED TOP 10! -> saveEntry('MRV') -> MODDED // YOU ARE ON THE BOARD.
            const store = g.registry.get('saveStore');
            const qualRec = {
              id: 'gate-mod-qual', seed: 'gate-seed', biomeMask: 0, score: 1500, distanceM: 320,
              trickPoints: 400, tricks: { backflip: 2 }, bestCombo: 2, bestFlow: 1.5,
              maxAirtimeMs: 900, durationMs: 12000, ledgerHash: 'ABCD1234', dailyRuleId: 'none',
              cause: 'crash', shards: 9, nearMisses: 1, bonusPoints: 100, modded: true,
              startedAt: Date.now() - 12000, endedAt: Date.now(),
            };
            await store.saveRun(qualRec);
            g.registry.set('lastRecord', qualRec);
            g.scene.start('GameOverScene');
            await wait(900);
            const over2 = g.scene.getScene('GameOverScene');
            if (!over2) return { fatal: 'no qualifying GameOverScene' };
            const entryState = inspectScene(over2);
            const hadEntry = Boolean(over2.entry);
            if (over2.entry) {
              await over2.saveEntry('MRV');
              await wait(500);
            }
            const afterSave = inspectScene(over2);
            return { boardOnly, entryState, hadEntry, afterSave };
          }).catch((e) => ({ fatal: String(e) }));
          if (seen.fatal) fail('modded Game Over is honest', seen.fatal);
          else {
            const checkState = (label, st) => {
              const all = st.texts.join(' | ') + ' | ' + st.title;
              const claimsClean = /\bNEW TOP 10\b/.test(all) || /NEW SEED BEST/.test(all) || /TODAY'S BEST/.test(all);
              if (claimsClean) return `claims clean-board honour: ${all.slice(0, 160)}`;
              if (!st.title) return `missing ledger title ${JSON.stringify(st.diag)}`;
              if (!/MODDED/i.test(st.title)) return `title missing MODDED: "${st.title}"`;
              if (!/MODDED/i.test(all)) return `screen missing MODDED: ${all.slice(0, 160)}`;
              if (st.count < 25) return `too few glyphs (${st.count})`;
              if (st.minInkH < 7.9) return `clipped glyph height minInkH=${st.minInkH}`;
              if (st.clipped.length) return `out-of-bounds/clipped: ${st.clipped.slice(0, 3).join(' | ')}`;
              if (st.bad.length) return `overlapping glyphs: ${st.bad.slice(0, 4).join(' | ')}`;
              return null;
            };
            const err1 = checkState('boardOnly', seen.boardOnly);
            const err2 = !seen.hadEntry ? 'qualifying modded run did not open initials entry' : checkState('entryState', seen.entryState);
            const err3 = checkState('afterSave', seen.afterSave);
            if (err1) fail('modded Game Over (board) is honest and non-overlapping', err1);
            else if (err2) fail('modded Game Over (initials entry) is honest and non-overlapping', err2);
            else if (err3) fail('modded Game Over (after saveEntry) stays MODDED and non-overlapping', err3);
            else pass('modded Game Over labels the run modded, keeps MODDED across saveEntry, and has zero glyph overlaps', `board="${seen.boardOnly.title}", saved="${seen.afterSave.title}", glyphs=${seen.entryState.count}`);
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

    // ---- W5: an achievement unlock is announced on the Game Over screen AND persisted.
    {
      const { page, errors, out } = await playToGameOver(browser, port, 0);
      try {
        if (out.fatal) fail('W5: run reaches Game Over', out.fatal);
        else if (errors.length) fail('W5: no page errors', errors.join(' | '));
        else if (!out.active) fail('W5: GameOverScene active', 'scene not active');
        else {
          const ach = await page.evaluate(async () => {
            const g = window.__bbGame;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const prof = JSON.parse(JSON.stringify(g.registry.get('profile')));
            return {
              stored: Object.keys(prof.achievements || {}).length,
              keys: Object.keys(prof.achievements || {}),
            };
          });
          const over = await page.evaluate(() => {
            const g = window.__bbGame;
            const s = g.scene.getScene('GameOverScene');
            const out = [];
            const seen = new Set();
            const walk = (list) => { for (const o of list || []) { if (!o) continue; if (typeof o.text === 'string' && o.text && !seen.has(o.text)) { seen.add(o.text); out.push(o.text); } if (o.list) walk(o.list); } };
            if (s) walk(s.children && s.children.list);
            return out;
          });
          // The toast is transient text laid OVER a screen the player is reading (header, RUN REPORT,
          // LEDGER, buttons). Reading its strings proves it exists; only its RECT proves it is not
          // covering the text underneath. This is the W4 lesson applied to W5's new screen element.
          const toast = await page.evaluate(() => {
            const g = window.__bbGame;
            const s = g.scene.getScene('GameOverScene');
            if (!s) return { fatal: 'no GameOverScene' };
            if (!s.toast || !s.toast.length) return { fatal: 'no achievement toast drawn' };
            const rectOf = (o) => {
              const b = o.getBounds ? o.getBounds() : null;
              return b ? { text: (o.main && o.main.text) || '', x: b.x, y: b.y, w: b.width, h: b.height, inkH: b.height * (8 / 9) } : null;
            };
            const toastRects = s.toast.map(rectOf).filter(Boolean);
            // Everything ELSE that is drawn, so the toast can be tested against the real screen.
            const others = [];
            const skip = new Set(s.toast);
            const seenObjs = new Set();
            const walk = (list, hidden = false) => {
              for (const o of list || []) {
                if (!o || seenObjs.has(o) || skip.has(o)) continue;
                seenObjs.add(o);
                const vis = !hidden && o.visible !== false && (o.alpha === undefined || o.alpha > 0);
                if (vis && o.main && typeof o.main.text === 'string' && o.main.text) {
                  const r = rectOf(o);
                  // Chromatic-aberration ghosts are deliberate duplicates of the CRASHED header.
                  if (r && o !== s.ghostA && o !== s.ghostB) others.push(r);
                  continue;
                }
                const kids = Array.isArray(o.list) ? o.list : [];
                if (kids.length) walk(kids, !vis);
              }
            };
            walk(s.children && s.children.list);
            const hits = [];
            for (const t of toastRects) {
              for (const o of others) {
                if (t.x < o.x + o.w && o.x < t.x + t.w && t.y < o.y + o.inkH && o.y < t.y + t.inkH) {
                  hits.push(`${t.text} <-> ${o.text}`);
                }
              }
            }
            const outOfBounds = toastRects.filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > 480 || r.y + r.inkH > 270);
            // And the toast must not overlap ITSELF line-on-line.
            const selfHit = [];
            for (let i = 0; i < toastRects.length; i++) {
              for (let j = i + 1; j < toastRects.length; j++) {
                const a = toastRects[i]; const b = toastRects[j];
                if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.inkH && b.y < a.y + a.inkH) selfHit.push(`${a.text} <-> ${b.text}`);
              }
            }
            return {
              lines: toastRects.map((r) => r.text),
              hits: hits.slice(0, 6),
              selfHit,
              outOfBounds: outOfBounds.map((r) => `${r.text}@${r.x.toFixed(0)},${r.y.toFixed(0)}`),
              minInkH: toastRects.length ? Math.min(...toastRects.map((r) => r.inkH)) : 0,
              othersCount: others.length,
            };
          });
          // A run always credits at least one run, so FIRST DESCENT must unlock and be announced.
          if (!ach.stored) fail('W5: achievement persisted', `stored=${ach.stored}`);
          else if (!over.some((t) => /UNLOCKED|MORE/i.test(t))) fail('W5: unlock announced on Game Over', `texts=${JSON.stringify(over.filter((t) => /UNLOCK/i.test(t)))}`);
          else if (toast.fatal) fail('W5 toast: drawn and measurable', toast.fatal);
          else if (toast.othersCount < 20) fail('W5 toast: the probe read the whole screen', `only ${toast.othersCount} other glyphs`);
          else if (toast.minInkH < 7.9) fail('W5 toast: full ink height', `minInkH=${toast.minInkH}`);
          else if (toast.outOfBounds.length) fail('W5 toast: inside the 480x270 screen', toast.outOfBounds.join(' | '));
          else if (toast.selfHit.length) fail('W5 toast: its own lines do not overlap', toast.selfHit.join(' | '));
          else if (toast.hits.length) fail('W5 toast: covers no text the player is reading', toast.hits.join(' | '));
          else pass('W5: achievement unlocked, persisted, announced, and the toast covers nothing', `stored=${ach.stored} lines=${JSON.stringify(toast.lines)}`);
        }
      } finally { await page.close(); }
    }

    // ---- W5: the achievements grid opens from the profile and pages without error.
    {
      const { page, errors, out } = await playToGameOver(browser, port, 0);
      try {
        if (errors.length) fail('W5 grid: no page errors', errors.join(' | '));
        else {
          const grid = await page.evaluate(async () => {
            const g = window.__bbGame;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            g.scene.start('TitleScene');
            await wait(900);
            const title = g.scene.getScene('TitleScene');
            if (!title || !title.menu) return { fatal: 'TitleScene has no menu' };
            // Drive the REAL menu: move to the PROFILE row and confirm, exactly as a keypress would.
            const idx = title.menu.items.findIndex((i) => String(i.label).toUpperCase() === 'PROFILE');
            if (idx < 0) return { fatal: 'no PROFILE row in the Title menu' };
            title.menu.setSelected(idx);
            title.menu.activate(idx);
            await wait(400);
            const prof = title.view;
            if (!prof) return { fatal: 'confirming PROFILE opened no view' };
            const profKind = prof.constructor ? prof.constructor.name : 'none';
            if (!prof.achButton) return { fatal: `ProfileView has no achievements button (${profKind})` };
            // Reach ACHIEVEMENTS the way a keyboard/pad player does: move focus with the routed 'down'
            // action until it sits on the ACHIEVEMENTS target, then confirm. This used to emit the
            // button's pointerdown, which passed while the button was unreachable by keys (audit U2).
            let hops = 0;
            while ((prof._focusTargets()[prof.focusIdx] || {}).kind !== 'ach' && hops < 30) { prof.handleAction('down'); hops += 1; }
            if ((prof._focusTargets()[prof.focusIdx] || {}).kind !== 'ach') return { fatal: 'ACHIEVEMENTS is not reachable by keys' };
            prof.handleAction('confirm');
            await wait(450);
            const v = title.view;
            if (!v) return { fatal: 'achievements button opened no view' };
            const read = () => {
              const out = []; const seen = new Set();
              const walk = (list) => { for (const o of list || []) { if (!o) continue; if (typeof o.text === 'string' && o.text && !seen.has(o.text)) { seen.add(o.text); out.push(o.text); } if (o.list) walk(o.list); } };
              if (v && v.panel) walk(v.panel.list);
              return out;
            };
            // Geometry, not strings: CC Friday asked for overlap checks on every new W5 screen. Read the
            // drawn glyph rects for EVERY page (a later page can overflow even when page 1 fits), plus the
            // BACK button and the panel frame, all in screen space.
            const marks = () => {
              const out = []; const seenObjs = new Set();
              const walk = (list, hidden = false) => {
                for (const o of list || []) {
                  if (!o || seenObjs.has(o)) continue;
                  seenObjs.add(o);
                  const vis = !hidden && o.visible !== false && (o.alpha === undefined || o.alpha > 0);
                  // A NeonText draws glow+main with different metrics; read the wrapper once.
                  if (vis && o.main && typeof o.main.text === 'string' && o.main.text) {
                    const b = o.getBounds ? o.getBounds() : null;
                    if (b) out.push({ text: o.main.text, x: b.x, y: b.y, w: b.width, h: b.height, inkH: b.height * (8 / 9) });
                    continue;
                  }
                  const kids = Array.isArray(o.list) ? o.list : [];
                  if (kids.length) walk(kids, !vis);
                }
              };
              if (v && v.panel) walk(v.panel.list);
              const byPos = new Map();
              for (const r of out) {
                const k = `${r.text}@${Math.round(r.x)},${Math.round(r.y)}`;
                if (!byPos.has(k)) byPos.set(k, r);
              }
              return [...byPos.values()];
            };
            const audit = () => {
              const rects = marks();
              const bad = [];
              for (let i = 0; i < rects.length; i++) {
                for (let j = i + 1; j < rects.length; j++) {
                  const a = rects[i]; const b = rects[j];
                  if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.inkH && b.y < a.y + a.inkH) bad.push(`${a.text} <-> ${b.text}`);
                }
              }
              const panel = v && v.panel ? { x: v.panel.x, y: v.panel.y, w: v.panel.w, h: v.panel.h } : null;
              const outside = panel
                ? rects.filter((r) => r.x < panel.x || r.y < panel.y || r.x + r.w > panel.x + panel.w || r.y + r.inkH > panel.y + panel.h)
                : [];
              return {
                count: rects.length,
                bad,
                outside: outside.map((r) => `${r.text}@${r.x.toFixed(0)},${r.y.toFixed(0)}`),
                minInkH: rects.length ? Math.min(...rects.map((r) => r.inkH)) : 0,
              };
            };
            const page1 = read();
            const pages = v.pages;
            const kind = v.constructor ? v.constructor.name : 'none';
            const audits = [audit()];
            // Walk every page, so a latent overflow on page 3 cannot hide behind a tidy page 1.
            for (let i = 1; i < (pages || 1); i++) {
              v._turn(1);
              await wait(220);
              audits.push(audit());
            }
            // Return to page 1 so the caller's later assertions read a stable state.
            for (let i = 1; i < (pages || 1); i++) v._turn(-1);
            await wait(200);
            const page1Again = read();
            v._turn(1);
            await wait(300);
            const page2 = read();
            return {
              kind, pages, audits,
              page1HasHeader: page1.some((t) => /SKILL|DISTANCE|DAILY/i.test(t)),
              hasAchRows: page1.some((t) => /FIRST DESCENT|DOUBLED UP|KILOMETRE CLUB|REGULAR/i.test(t)),
              page1Text: page1.slice(0, 6),
              diff: page1Again.join('|') !== page2.join('|'),
              page2Num: v.page,
              hasPageLabel: page1.some((t) => /PAGE \d+\/\d+/.test(t)),
              // Backing out must return to PROFILE, not all the way to the Title screen.
              backReturnsToProfile: (() => {
                const before = v.constructor ? v.constructor.name : '';
                return { before, hasClose: typeof v.close === 'function' };
              })(),
            };
          });
          if (grid.fatal) fail('W5 grid: opens from profile', grid.fatal);
          // Asserted on BEHAVIOUR, not on the class name: the production bundle minifies, so
          // `constructor.name` is `rc`, not `AchievementsView`. A name check was asserting on a string
          // the build is free to rewrite.
          else if (!grid.hasAchRows) fail('W5 grid: shows achievement names', JSON.stringify(grid.page1Text));
          else if (!grid.page1HasHeader) fail('W5 grid: shows group headers', JSON.stringify(grid.page1Text));
          else if (!grid.hasPageLabel) fail('W5 grid: shows a page indicator', JSON.stringify(grid.page1Text));
          else if (grid.pages > 1 && !grid.diff) fail('W5 grid: paging changes the rows', `pages=${grid.pages} page2=${grid.page2Num}`);
          else if (grid.audits.some((a) => a.count < 8)) fail('W5 grid: the probe actually measured the screen', `glyph counts ${JSON.stringify(grid.audits.map((a) => a.count))}`);
          else if (grid.audits.some((a) => a.minInkH < 7.9)) fail('W5 grid: every glyph keeps a full ink height', `min ${Math.min(...grid.audits.map((a) => a.minInkH))}`);
          else if (grid.audits.some((a) => a.bad.length)) {
            const a = grid.audits.find((x) => x.bad.length);
            fail('W5 grid: no two glyphs overlap on any page', a.bad.slice(0, 4).join(' | '));
          } else if (grid.audits.some((a) => a.outside.length)) {
            const a = grid.audits.find((x) => x.outside.length);
            fail('W5 grid: every glyph sits inside the panel on every page', a.outside.slice(0, 4).join(' | '));
          } else pass('W5 grid: opens from PROFILE, headers and page label render, paging works, no overlap on any page', `pages=${grid.pages}, glyphs=${JSON.stringify(grid.audits.map((a) => a.count))}`);
        }
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

    // ---- 6c. TITLE MENU: no two rows may overlap, and the panel must clear the DAILY PATCH strip.
    //
    // CC Friday's defect 3 was SETTINGS overflowing the panel into the Daily box. The unit test covers
    // the layout ARITHMETIC; this reads the drawn rects on the shipped bundle, which is the thing she
    // actually saw. The first version of this check walked for `o.main` and found ZERO glyphs, then
    // passed — a probe that measured nothing is worse than no probe, so it now asserts a glyph count
    // and reads leaf BitmapTexts the same way the shop step does.
    {
      const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
      try {
        const out = await page.evaluate(async () => {
          const g = window.__bbGame;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          g.scene.start('TitleScene');
          await wait(1100);
          const t = g.scene.getScene('TitleScene');
          if (!t || !t.menu) return { fatal: 'no Title menu' };
          const glyphs = [];
          const seen = new Set();
          // The 4x BITSTREAM/BLUFFS wordmark is letter-by-letter art: its two lines are kerned 32px of
          // ink into a 32px advance, so their boxes touch, and every letter waves +-2px on the sine. That
          // is the logo moving, not a layout overflow, so the logo letters are excluded by identity.
          const skip = new Set(((t.logo || []).map((L) => L.t)).filter(Boolean));
          // Read NeonText CONTAINERS once each: each one draws the same string twice (glow outline +
          // main), and the two have slightly different font metrics, so walking to leaves reported every
          // label as overlapping itself. `continue` after a container also keeps the pair out of the pool.
          const walk = (l, hidden = false) => {
            for (const o of l || []) {
              if (!o || seen.has(o) || skip.has(o)) continue;
              seen.add(o);
              const vis = !hidden && o.visible !== false && (o.alpha === undefined || o.alpha > 0);
              if (vis && o.main && typeof o.main.text === 'string' && o.main.text) {
                const b = o.getBounds ? o.getBounds() : null;
                if (b) glyphs.push({ text: o.main.text, x: b.x, y: b.y, w: b.width, h: b.height, inkH: b.height * (8 / 9) });
                continue;
              }
              const kids = Array.isArray(o.list) ? o.list : [];
              if (kids.length) walk(kids, !vis);
            }
          };
          walk(t.children && t.children.list);
          const byPos = new Map();
          for (const r of glyphs) {
            const k = `${r.text}@${Math.round(r.x)},${Math.round(r.y)}`;
            if (!byPos.has(k)) byPos.set(k, r);
          }
          const rects = [...byPos.values()];
          const bad = [];
          for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
              const a = rects[i]; const b = rects[j];
              if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.inkH && b.y < a.y + a.inkH) {
                bad.push(`${a.text} <-> ${b.text}`);
              }
            }
          }
          // Menu rows by identity (their drawn label is scaled 2x, so measure their own bounds).
          const rows = (t.menu.rows || []).map((r, i) => {
            const b = r.label && r.label.getBounds ? r.label.getBounds() : null;
            return { i, label: r.label && r.label.main ? r.label.main.text : '', b };
          }).filter((r) => r.b);
          const panel = t.menuPanel;
          const panelBottom = panel ? panel.y + panel.h : null;
          const daily = t.dailyPanel ? { y: t.dailyPanel.y } : null;
          const lastRow = rows[rows.length - 1] || null;
          return {
            count: rects.length,
            menuRows: rows.length,
            labels: rows.map((r) => r.label),
            bad,
            panelBottom,
            dailyTop: daily ? daily.y : null,
            lastRowBottom: lastRow ? lastRow.b.y + lastRow.b.height * (8 / 9) : null,
            minInkH: rects.length ? Math.min(...rects.map((r) => r.inkH)) : 0,
          };
        }).catch((e) => ({ fatal: String(e) }));

        if (out.fatal) fail('title: menu renders', out.fatal);
        else if (errors.length) fail('title: no page errors', errors.join(' | '));
        else if (out.count < 30) fail('title: the probe actually measured the screen', `only ${out.count} glyphs read`);
        else if (out.menuRows !== 6) fail('title: the menu has six rows', `${out.menuRows}: ${JSON.stringify(out.labels)}`);
        else if (out.bad.length) fail('title: no two glyphs overlap', out.bad.slice(0, 4).join(' | '));
        else if (out.minInkH < 7.9) fail('title: every glyph keeps a full ink height', `minInkH=${out.minInkH}`);
        else if (out.dailyTop !== null && out.lastRowBottom !== null && out.lastRowBottom > out.dailyTop) {
          fail('title: the last menu row clears the DAILY PATCH strip', `row bottom ${out.lastRowBottom.toFixed(1)} > strip top ${out.dailyTop}`);
        } else if (out.dailyTop !== null && out.panelBottom !== null && out.panelBottom > out.dailyTop) {
          fail('title: the menu panel clears the DAILY PATCH strip', `panel bottom ${out.panelBottom} > strip top ${out.dailyTop}`);
        } else pass('title: six rows, no overlapping glyphs, and the menu clears the DAILY PATCH strip', `${out.count} glyphs, last row bottom ${out.lastRowBottom && out.lastRowBottom.toFixed(1)} vs strip ${out.dailyTop}`);
      } finally { await page.close(); }
    }

    // ---- 7b. SHARD SHOP is reachable with KEYS ONLY (CC Friday's blocker).
    //
    // ProfileView used to forward every action to the signature menu, which wraps inside its own rows,
    // so keyboard and gamepad players could never reach the shop — and since the shop moved off Title,
    // that button was the only way in. This step sends real key events and never clicks anything.
    if (WITH_BOOSTS) {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
      try {
        // Open PROFILE the way a player does: from the Title menu.
        const opened = await page.evaluate(async () => {
          const g = window.__bbGame;
          const t = g.scene.getScene('TitleScene');
          const item = (t.menu.items || []).find((i) => /PROFILE/i.test(String(i.label || '')));
          if (!item) return { fatal: 'no PROFILE entry on the Title menu' };
          item.onSelect();
          await new Promise((r) => setTimeout(r, 700));
          const v = t.view;
          if (!v) return { fatal: 'PROFILE view did not open' };
          return { ok: true, rows: v.sigMenu ? v.sigMenu.items.length : 0, hasShop: Boolean(v.shopButton) };
        });
        if (opened.fatal) { fail('keys: PROFILE opens from Title', opened.fatal); }
        else if (!opened.hasShop) { fail('keys: PROFILE has a SHARD SHOP button', 'no shopButton'); }
        else {
          // Walk DOWN past the last toggle row onto the SHARD SHOP button, then press Enter.
          // Down-presses are spaced past MenuInput's 100ms repeat so each one registers as one step.
          // Press real ArrowDown keys until focus reaches the SHARD SHOP button (ACHIEVEMENTS now sits
          // between the toggle rows and SHOP, so a fixed count would rot every time the order changes).
          const focusKind = () => page.evaluate(() => {
            const v = window.__bbGame.scene.getScene('TitleScene').view;
            return v ? (v._focusTargets()[v.focusIdx] || {}).kind : null;
          });
          for (let i = 0; i < opened.rows + 6 && (await focusKind()) !== 'buy'; i += 1) { await page.keyboard.press('ArrowDown'); await sleep(140); }
          const focused = await page.evaluate(() => {
            const t = window.__bbGame.scene.getScene('TitleScene');
            const v = t.view;
            return { focus: v && v.focusIdx, kind: (v && v._focusTargets()[v.focusIdx] || {}).kind };
          });
          await page.keyboard.press('Enter');
          await sleep(800);
          const after = await page.evaluate(() => {
            const t = window.__bbGame.scene.getScene('TitleScene');
            const v = t.view;
            const title = v && v.panel && v.panel.titleText && v.panel.titleText.main.text;
            return { title: String(title || ''), isShop: Boolean(v && v.menu && v.menu.items && v.menu.items.some((i) => /BOOST|COSMETIC/i.test(String(i.label || '')))) };
          });
          if (focused.kind !== 'buy') fail('keys: DOWN reaches the SHARD SHOP button', `focus was on ${focused.kind} at index ${focused.focus}`);
          else if (!after.isShop) fail('keys: ENTER opens the shop', `still on "${after.title}"`);
          else pass('keys: PROFILE -> SHARD SHOP opens with arrow keys and Enter only', `title="${after.title}"`);

          // BACK must stay reachable by keys too: Escape closes the shop, then down-to-BACK and Enter.
          await page.keyboard.press('Escape');
          await sleep(600);
          const backOk = await page.evaluate(async () => {
            const t = window.__bbGame.scene.getScene('TitleScene');
            // Escape should have returned us to PROFILE (the shop's onClose).
            const v = t.view;
            if (!v) return { inProfile: false };
            const n = v.sigMenu ? v.sigMenu.items.length : 0;
            for (let i = 0; i < n + 6 && (v._focusTargets()[v.focusIdx] || {}).kind !== 'back'; i += 1) v.handleAction('down');
            const kind = (v._focusTargets()[v.focusIdx] || {}).kind;
            return { inProfile: true, kind };
          });
          if (!backOk.inProfile) fail('keys: Escape returns to PROFILE', 'no view open');
          else if (backOk.kind !== 'back') fail('keys: DOWN reaches BACK', `focus was on ${backOk.kind}`);
          else {
            await page.keyboard.press('Enter');
            await sleep(600);
            const gone = await page.evaluate(() => {
              const t = window.__bbGame.scene.getScene('TitleScene');
              return !t.view;
            });
            if (!gone) fail('keys: ENTER on BACK closes PROFILE', 'view still open');
            else pass('keys: BACK stays reachable by keys and closes the view', 'ArrowDown -> Enter');
          }
        }
        if (errors.length) fail('keys: no page errors', errors.join(' | '));
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
          if (!view.tabBtn) return { fatal: 'no board tab button' };
          return { ok: true };
        }).catch((e) => ({ fatal: String(e) }));
        // Switch boards with REAL keys (audit U3: this used to call view._toggleBoard(), which passed
        // while no key could switch the board). Right shows MODDED, Left shows CLEAN.
        const readTab = () => page.evaluate(() => {
          const view = window.__bbGame.scene.getScene('TitleScene').view;
          const lbl = view && view.tabBtn && view.tabBtn.label && view.tabBtn.label.main ? view.tabBtn.label.main.text : null;
          return { label: lbl, modded: Boolean(view && view.showingModded) };
        });
        if (!out.fatal) {
          const before = await readTab();
          await page.keyboard.press('ArrowRight'); await new Promise((r) => setTimeout(r, 700));
          const right = await readTab();
          await page.keyboard.press('ArrowLeft'); await new Promise((r) => setTimeout(r, 700));
          const left = await readTab();
          out.cleanLabel = before.label; out.moddedLabel = right.label; out.toggled = right.modded; out.back = !left.modded;
        }
        if (out.fatal) fail('leaderboard: opens with a board tab', out.fatal);
        else if (errors.length) fail('leaderboard: no page errors', errors.join(' | '));
        else if (out.cleanLabel !== 'MODDED') fail('leaderboard: clean board offers the modded tab', `tab read ${out.cleanLabel}`);
        else if (!out.toggled) fail('leaderboard: tab switches to the modded board', 'showingModded stayed false');
        else if (out.moddedLabel !== 'CLEAN') fail('leaderboard: modded board offers the way back', `tab read ${out.moddedLabel}`);
        else if (!out.back) fail('leaderboard: ArrowLeft returns to the clean board', 'still modded');
        else pass('leaderboard: clean/modded tab both ways by keyboard', 'ArrowRight -> MODDED, ArrowLeft -> CLEAN');
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
          // Press the real DAILY RUN menu item. It passes the date-derived mask as an override;
          // `startRun(daily, null)` (what this gate used to call) fell back to the PROFILE mask,
          // so it exercised a different path from the one players press (audit F7, 2026-11-14).
          const item = t.menu && t.menu.items.find((i) => i.label === 'DAILY RUN');
          if (!item) return { fatal: 'no DAILY RUN menu item' };
          item.onSelect();
          await wait(1600);
          const run = g.scene.getScene('RunScene');
          if (!run) return { fatal: 'daily run did not start' };
          return {
            seed: run.seed,
            mask: run.biomeMask,
            regMask: g.registry.get('biomeMask'),
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
        // The fixture profile's mask is 31; the date cycle never produces 31, so 31 here means the
        // run took the profile mask instead of the Daily's shared one.
        else if (out.mask === PROFILE.biomeMask || out.mask !== out.regMask) fail('daily uses the date mask, not the profile mask', `run mask ${out.mask}, registry ${out.regMask}`);
        else pass('daily run (real DAILY RUN item) refuses both boosts and uses the date mask', `shield 0, factor 1, not modded, mask ${out.mask}`);
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

    // ---- W6: a conveyor belt moves the real sled with no input. This is the check the pure-unit test
    // cannot make: it proves Sled.applyControls is wired to the belt, not merely that PhysicsTuner can
    // report a drive. Without the wiring, the sled's x-velocity is identical with and without the belt.
    {
      const c = await (async () => {
        const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
        try {
          const out = await page.evaluate(async () => {
            const g = window.__bbGame;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            g.registry.set('biomeMask', 0);
            g.scene.start('TitleScene');
            // Poll for RunScene and a LIVE sled instead of sleeping a fixed 1600ms. A fixed sleep here is the
            // same bug class as the Game Over 3000ms sleep: under load the run has not started, or the sled
            // has already crashed, and applyControls early-returns on a destroyed body -- which reads as
            // "the belt does nothing" (dvx exactly 0) when in fact nothing was ever stepped.
            const t0 = Date.now();
            let run = null;
            let started = false;
            while (Date.now() - t0 < 15000) {
              const tt = g.scene.getScene('TitleScene');
              // Start EXACTLY ONCE. Calling startRun on every tick restarts the run each time, which tears
              // down the sled we are waiting for -- the probe then waits forever for a live sled it keeps
              // destroying. This is why the previous version needed `if (!run)` and still raced.
              if (!started && tt && !tt.starting) { started = true; tt.startRun('belt-probe', 0); }
              const rr = g.scene.getScene('RunScene');
              if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) { run = rr; break; }
              await wait(100);
            }
            if (!run) return { fatal: 'RunScene never produced a live sled (scene active + sled inWorld)' };
            await wait(200);
            if (run.sled.destroyed || !run.sled.inWorld) {
              return { fatal: `sled died between liveness check and probe (destroyed=${run.sled.destroyed} inWorld=${run.sled.inWorld})` };
            }

            // Put a conveyor under the sled, exactly as the generator would.
            const belt = run.content.terrainMods.conveyorBelt;
            const x = run.sled.x;
            const chunk = run.terrain._chunkAt(x);
            const zones = chunk.zones;
            const existing = zones.length;
            zones.push({ modId: 'conveyorBelt', x0: x - 400, x1: x + 400 });

            // Force a grounded, stable state and step physics with NO input at all.
            const phys = run.tuner.getEffective({ zones: [belt] });
            const before = run.sled.body.velocity.x;

            // Drive several real physics steps with an empty pad so nothing but the belt can act.
            const emptyPad = { push: false, brake: false, tuck: false, left: false, right: false, hop: false, heli: 0, pressed: {}, airBrake: false };
            run.sled.grounded = true;
            run.sled.groundAngleDeg = 0;
            for (let i = 0; i < 12; i++) run.sled.applyControls(emptyPad, phys, 16);
            const after = run.sled.body.velocity.x;

            const noBeltPhys = run.tuner.getEffective({ zones: [] });
            run.sled.grounded = true;
            run.sled.groundAngleDeg = 0;
            const before2 = run.sled.body.velocity.x;
            for (let i = 0; i < 12; i++) run.sled.applyControls(emptyPad, noBeltPhys, 16);
            const after2 = run.sled.body.velocity.x;

            zones.length = existing; // leave the terrain as we found it
            return {
              beltDrive: phys.beltDrivePxS2,
              withBelt: after - before,
              withoutBelt: after2 - before2,
              // Liveness at the moment of measurement: dvx exactly 0 with these false means the sled was
              // never stepped, which is a harness problem, not "the belt does nothing".
              destroyed: run.sled.destroyed,
              inWorld: run.sled.inWorld,
              grounded: run.sled.grounded,
              beltDirection: phys.beltDirection,
            };
          }).catch((e) => ({ fatal: String(e) }));
          return { errors, out };
        } finally { await page.close(); }
      })();
      if (c.out.fatal) fail('W6: conveyor belt moves the sled', c.out.fatal);
      else if (c.errors.length) fail('W6: conveyor belt — no page errors', c.errors.join(' | '));
      else if (c.out.destroyed || !c.out.inWorld) {
        fail('W6: conveyor belt — the sled under test was not live', `destroyed=${c.out.destroyed} inWorld=${c.out.inWorld} (harness, not belt)`);
      }
      else if (!(c.out.beltDrive > 0)) fail('W6: conveyor belt carries a drive', `beltDrivePxS2=${c.out.beltDrive}`);
      else if (!(c.out.withBelt > 0)) fail('W6: conveyor belt moves the sled with no input', `dvx=${c.out.withBelt} destroyed=${c.out.destroyed} inWorld=${c.out.inWorld} grounded=${c.out.grounded}`);
      else if (Math.abs(c.out.withoutBelt) >= Math.abs(c.out.withBelt)) {
        fail('W6: the movement comes from the belt, not from drift', `with=${c.out.withBelt} without=${c.out.withoutBelt}`);
      } else pass('W6: a conveyor belt drives the real sled with no player input', `dvx=${c.out.withBelt.toFixed(2)} vs no-belt ${c.out.withoutBelt.toFixed(2)}`);
    }

    // ---- W6: a geyser vent LAUNCHES the real sled. Same shape as the conveyor check, and for the same
    // reason: geyser-vent.json carried `launch` from the start while nothing read it, so a schema unit test
    // could pass forever with the mechanic absent. This drives Sled.applyControls with the vent's real
    // physics and requires an upward velocity kick plus a cooldown that stops an immediate re-fire.
    {
      const c = await (async () => {
        const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
        try {
          const out = await page.evaluate(async () => {
            const g = window.__bbGame;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            g.registry.set('biomeMask', 0);
            g.scene.start('TitleScene');
            const t0 = Date.now();
            let run = null;
            let started = false;
            while (Date.now() - t0 < 15000) {
              const tt = g.scene.getScene('TitleScene');
              if (!started && tt && !tt.starting) { started = true; tt.startRun('geyser-probe', 0); }
              const rr = g.scene.getScene('RunScene');
              if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) { run = rr; break; }
              await wait(100);
            }
            if (!run) return { fatal: 'RunScene never produced a live sled' };
            await wait(200);
            if (run.sled.destroyed || !run.sled.inWorld) return { fatal: 'sled died before the probe' };

            // The vent as the generator would place it: a zone whose MOD DEF carries the launch data.
            const vent = run.content.terrainMods.geyserVent;
            const x = run.sled.x;
            const chunk = run.terrain._chunkAt(x);
            const zones = chunk.zones;
            const existing = zones.length;
            zones.push({ modId: 'geyserVent', x0: x - 400, x1: x + 400 });

            const phys = run.tuner.getEffective({ zones: [vent] });
            const emptyPad = { push: false, brake: false, tuck: false, left: false, right: false, hop: false, heli: 0, pressed: {}, airBrake: false };

            run.sled.grounded = true;
            run.sled.groundAngleDeg = 0;
            run.sled.geyserCooldownMs = 0;
            const vyBefore = run.sled.body.velocity.y;
            run.sled.applyControls(emptyPad, phys, 16);
            const vyAfter = run.sled.body.velocity.y;

            // Immediately again, with the cooldown now set: must NOT fire a second time.
            run.sled.grounded = true;
            const vyBefore2 = run.sled.body.velocity.y;
            run.sled.applyControls(emptyPad, phys, 16);
            const vyAfter2 = run.sled.body.velocity.y;

            zones.length = existing;
            // Matter carries velocity in engine units per step; convert to px/s the way Sled does so the
            // number in the gate output is the same quantity the vent's data is expressed in.
            const PX = (v) => (v * 1000) / 16.666666666666668;
            return {
              hasLaunchData: Boolean(phys.geyserLaunch && phys.geyserLaunch.velocityPxS > 0),
              launchVelocity: phys.geyserLaunch ? phys.geyserLaunch.velocityPxS : null,
              dvy: PX(vyAfter) - PX(vyBefore),
              dvySecond: PX(vyAfter2) - PX(vyBefore2),
              cooldownAfter: run.sled.geyserCooldownMs,
            };
          }).catch((e) => ({ fatal: String(e) }));
          return { errors, out };
        } finally { await page.close(); }
      })();
      if (c.out.fatal) fail('W6: geyser vent launches the sled', c.out.fatal);
      else if (c.errors.length) fail('W6: geyser vent — no page errors', c.errors.join(' | '));
      else if (!c.out.hasLaunchData) fail('W6: the vent\'s launch data reaches the tuner', JSON.stringify(c.out));
      else if (!(c.out.dvy < -100)) fail('W6: a geyser throws the sled upward with real force', `dvy=${c.out.dvy} px/s (need a real upward kick, not a rounding error)`);
      else if (!(c.out.dvySecond > -1)) fail('W6: the vent does not re-fire while on cooldown', `second dvy=${c.out.dvySecond}`);
      else pass('W6: a geyser vent launches the real sled, once per cooldown', `dvy=${c.out.dvy.toFixed(1)} of ${c.out.launchVelocity} px/s, then ${c.out.dvySecond.toFixed(1)}`);
    }

    // ---- T2 (audit): the REAL sled rides the Micro Mountain dew swell. Before T2 the swell was added only by
    // heightAt; the collider (chunk points) was raw, so the sled tracked the raw ground (sd ~0 px) and NOT the
    // swelled heightAt (sd ~18 px). Now the swell is in the points. A `seed@512` run, Phaser's loop stopped and the
    // game stepped with headlessStep (as tools/sim/browser.js does), empty pad; the sled is placed 360 px before
    // the first dew-swell zone whose untapered middle holds a crest and a trough, and rides it.
    {
      const c = await (async () => {
        const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
        try {
          const out = await page.evaluate(async () => {
            const g = window.__bbGame;
            const DT = 1000 / 60;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            g.scene.start('TitleScene');
            const t0 = Date.now();
            let run = null;
            let started = false;
            while (Date.now() - t0 < 15000) {
              const tt = g.scene.getScene('TitleScene');
              if (!started && tt && !tt.starting) { started = true; tt.startRun('t2-probe', 512); }
              const rr = g.scene.getScene('RunScene');
              if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) { run = rr; break; }
              await wait(100);
            }
            if (!run) return { fatal: 'RunScene never produced a live sled (scene active + sled inWorld)' };
            if (run.biomeMask !== 512) return { fatal: `run mask is ${run.biomeMask}, not 512` };
            g.loop.stop();
            const pad = {
              push: false, tilt: 0, tuck: false, brake: false, hop: false, reset: false, heli: 0, airBrake: false,
              parachute: false, pause: false, lastSource: 'keyboard',
              pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false },
            };
            run.inputRouter = { poll() { return pad; }, setEnabled() {} };
            let clock = 100000;
            const step = () => { clock += DT; g.headlessStep(clock, DT); };
            for (let i = 0; i < 5; i++) step();
            const T = run.terrain;
            const sw = run.content.terrainMods.dewSwell && run.content.terrainMods.dewSwell.terrainSwell;
            if (!sw) return { fatal: 'dewSwell has no terrainSwell in the shipped content' };
            let z = null;
            for (let i = 1; i < 260 && !z; i++) {
              const ch = T.getChunk(i);
              for (const q of ch.zones) {
                if (q.modId !== 'dewSwell') continue;
                const taper = Math.min(sw.taperPx || 0, (q.x1 - q.x0) / 2);
                if (taper <= sw.periodPx / 4 + 1e-9 && q.x1 - q.x0 >= (3 * sw.periodPx) / 4 + taper) { z = { x0: q.x0, x1: q.x1, taper }; break; }
              }
            }
            if (!z) return { fatal: 'no dew-swell zone with a crest and a trough in 260 chunks' };
            const s = run.sled;
            const sx = z.x0 - 360;
            const ang = run.slopeAt(sx);
            s.setPose(sx, T.heightAt(sx) - 18, ang, Math.cos((ang * Math.PI) / 180) * 500, Math.sin((ang * Math.PI) / 180) * 500);
            const offs = []; // sled.y - heightAt, grounded frames in the untapered middle
            const raws = []; // sled.y - raw (un-swelled) ground, same frames
            let lo = Infinity;
            let hi = -Infinity;
            let frames = 0;
            let crashed = false;
            while (s.x < z.x1 + 40 && frames < 1800) {
              s.invulnerableMs = 600000;
              step();
              frames++;
              if (s.destroyed || !s.inWorld) { crashed = true; break; }
              const x = s.x;
              if (x < z.x0 + z.taper || x > z.x1 - z.taper) continue;
              const h = T.heightAt(x);
              const swell = T._swellAt(x);
              lo = Math.min(lo, swell);
              hi = Math.max(hi, swell);
              if (s.grounded) { offs.push(s.y - h); raws.push(s.y - (h - swell)); }
            }
            const sd = (a) => { const m = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - m) * (q - m), 0) / a.length); };
            return {
              x0: z.x0, x1: z.x1, amp: sw.amplitudePx, reached: s.x >= z.x1, crashed, frames, n: offs.length,
              sd: offs.length ? sd(offs) : NaN, sdRaw: raws.length ? sd(raws) : NaN, p2p: hi - lo,
            };
          }).catch((e) => ({ fatal: String(e) }));
          return { errors, out };
        } finally { await page.close(); }
      })();
      const name = 'T2: the real sled rides the Micro dew swell (collider = heightAt)';
      const o = c.out;
      if (o.fatal) fail(name, o.fatal);
      else if (c.errors.length) fail(`${name} — no page errors`, c.errors.join(' | '));
      else if (o.crashed || !o.reached) fail(name, `sled did not ride the zone through (crashed=${o.crashed} reached=${o.reached} frames=${o.frames})`);
      else if (o.n < 20) fail(name, `only ${o.n} grounded frames in the zone middle (need 20)`);
      else if (!(o.p2p > 0.9 * 2 * o.amp)) fail(name, `swell peak-to-peak ${o.p2p.toFixed(1)} px, want ~${2 * o.amp}`);
      else if (!(o.sd < 3)) fail(name, `sd(sled.y - heightAt) ${o.sd.toFixed(2)} px over ${o.n} grounded frames (want < 3); vs raw ground ${o.sdRaw.toFixed(2)}`);
      else if (!(o.sdRaw > 3 * o.sd)) fail(name, `the sled follows the raw ground as well as the swelled one (sd ${o.sd.toFixed(2)} vs raw ${o.sdRaw.toFixed(2)})`);
      else pass(name, `t2-probe@512 zone ${(o.x0 / 20).toFixed(0)}-${(o.x1 / 20).toFixed(0)} m: sd(sled.y - heightAt) ${o.sd.toFixed(2)} px vs raw ground ${o.sdRaw.toFixed(2)} px over ${o.n} grounded frames; swell ${o.p2p.toFixed(1)} px peak-to-peak`);
    }

    // ---- Readable Chaos phase 1 (fable-10x): the ground-hazard telegraph announces a real hazard before it is on screen
    //
    // A real mask-0 run, hands off. The first ground crash hazard the run's own terrain produces must be stamped by
    // RunScene.updateGroundTelegraph while it is still OFF screen and at least 1.2 s of travel away, the telegraph
    // entity must have drawn something that frame, and the warn sound must have been requested once.
    //
    // FIXED STEPS, not requestAnimationFrame. The old version waited on rAF with a 40 s WALL-CLOCK deadline: under load
    // (a busy machine) the browser's rAF ticks slower than real time, the sled covered less ground in those 40 s and
    // the check failed for a reason that had nothing to do with the telegraph. The run is now driven 16 ms at a time by
    // hand (the scene is paused, so the game loop never advances it), with a BOUNDED frame count and a yield for the
    // event loop every few frames: the game time the check measures is the same on a loaded box and on an idle one.
    {
      const name = 'readable chaos: a ground crash hazard is telegraphed off-screen, >= 1.2 s out, with a sound';
      const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
      try {
        const o = await page.evaluate(async () => {
          const g = window.__bbGame;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          g.registry.set('biomeMask', 0);
          g.scene.start('TitleScene');
          await wait(900);
          const title = g.scene.getScene('TitleScene');
          title.starting = false;
          title.startRun('gate-seed', 0);
          // wait for the real run to be live (polled, bounded: never a fixed sleep that a slow box can miss)
          let run = null;
          const t0 = Date.now();
          while (Date.now() - t0 < 15000) {
            const rr = g.scene.getScene('RunScene');
            if (rr && rr.sled && rr.sled.inWorld && !rr.crashed) { run = rr; break; }
            await wait(100);
          }
          if (!run) return { fatal: 'RunScene did not start' };
          if (!run.groundTelegraph || !run.teleTracker) return { fatal: 'RunScene has no ground telegraph' };
          const sfx = [];
          const audio = g.registry.get('audioSynth');
          const orig = audio && audio.playSfx ? audio.playSfx.bind(audio) : null;
          if (audio) audio.playSfx = (n, opts) => { sfx.push(n); if (orig) orig(n, opts); };
          // the scene is paused: we advance it by hand, 16 ms a step, so the run's game time does not depend on the host
          run.scene.pause();
          let clock = run.runTimeMs;
          const step = () => { clock += 16; run.update(clock, 16); };
          const MAX_FRAMES = 3600; // 60 s of game time; the first ground crash hazard is far inside that
          let hit = null;
          let drawn = 0;
          let frames = 0;
          for (let f = 0; f < MAX_FRAMES && !hit; f++) {
            step();
            frames = f + 1;
            if (!run.sled || run.crashed) break;
            for (const list of run.hazards.values()) for (const h of list) {
              if (hit || h.teleAtMs == null || h.def.placement === 'air' || (h.def.onHit && h.def.onHit.effect !== 'crash')) continue;
              const dx = h.cx - run.sled.x;
              const buf = run.groundTelegraph.gfx && run.groundTelegraph.gfx.commandBuffer;
              drawn = buf ? buf.length : 0;
              hit = {
                id: h.def.id, dx, speed: run.sled.speed, m: Math.round((run.sled.x - run.startX) / 10),
                offScreen: h.cx - h.w / 2 > run._view.right,
                mark: (run._teleMarks || []).find((mk) => mk.ref === h) || null,
              };
            }
            if ((f + 1) % 45 === 0) await wait(0); // yield for the event loop; never a wall-clock deadline
          }
          if (!hit) return { fatal: run.crashed ? 'the run crashed before any hazard was telegraphed' : `no ground crash hazard was telegraphed in ${MAX_FRAMES} fixed steps (${frames} run)` };
          if (!drawn) { // the mark is drawn in the same frame it is planned; one more step if the buffer was empty
            step();
            const buf = run.groundTelegraph.gfx && run.groundTelegraph.gfx.commandBuffer;
            drawn = buf ? buf.length : 0;
          }
          return {
            ...hit, frames, mark: hit.mark ? { color: hit.mark.color, kind: hit.mark.kind, onScreen: hit.mark.onScreen } : null,
            leadS: hit.dx / Math.max(hit.speed, 60), drawn, warnSounds: sfx.filter((n) => n === 'groundWarn').length,
          };
        }).catch((e) => ({ fatal: String(e) }));
        if (o.fatal) fail(name, o.fatal);
        else if (errors.length) fail(name, `page errors: ${errors.join(' | ')}`);
        else if (!o.offScreen) fail(name, `${o.id} was already on screen when first telegraphed (dx ${Math.round(o.dx)})`);
        else if (!(o.leadS >= 1.2)) fail(name, `${o.id} telegraphed only ${o.leadS.toFixed(2)} s out (dx ${Math.round(o.dx)} at ${Math.round(o.speed)} px/s)`);
        else if (!o.mark || o.mark.kind !== 'hop' || o.mark.color !== 'danger' || o.mark.onScreen) fail(name, `wrong mark for a crash hazard: ${JSON.stringify(o.mark)}`);
        else if (!(o.drawn > 0)) fail(name, 'the telegraph entity drew nothing while a mark was up');
        else if (o.warnSounds < 1) fail(name, 'groundWarn was never requested');
        else pass(name, `${o.id} at ${o.m} m: announced ${Math.round(o.dx)} px / ${o.leadS.toFixed(2)} s out, off screen, ${o.drawn} draw commands, groundWarn x${o.warnSounds} (frame ${o.frames} of the fixed-step run)`);
      } finally {
        await page.close();
      }
    }

    // ---- Readable Chaos phase 2 (fable-10x): at 1200 px/s the camera is farther out than the old 0.6 clamp allowed
    //
    // The shipped RunScene.updateCamera, driven for 12 s with a stand-in sled moving at 1200 px/s over the run's real
    // terrain (the loop is asleep, so nothing else moves). Zoom must settle between the new floor and 0.53, the
    // screen-space layers must be counter-scaled by exactly 1 / zoom, and the rider must stay on screen.
    {
      const name = 'readable chaos: at 1200 px/s the camera settles near zoom 0.515, layers (B2 blind overlay too) counter-scaled, rider on screen';
      const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
      try {
        const o = await page.evaluate(async () => {
          const g = window.__bbGame;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          g.registry.set('biomeMask', 0);
          g.scene.start('TitleScene');
          await wait(900);
          const title = g.scene.getScene('TitleScene');
          title.starting = false;
          title.startRun('gate-seed', 0);
          await wait(1400);
          const run = g.scene.getScene('RunScene');
          if (!run || !run.sled) return { fatal: 'RunScene did not start' };
          g.loop.sleep();
          const real = run.sled;
          const V = 1200;
          const fake = { x: real.x + 300, y: 0, vx: V, vy: 0, speed: V };
          fake.y = run.terrain.heightAt(fake.x) - 14;
          run.sled = fake;
          run._camX = fake.x - 182;
          run._camY = fake.y - 90;
          let prevY = fake.y;
          let minSx = Infinity;
          let maxSx = -Infinity;
          for (let i = 0; i < 750; i++) {
            fake.x += V * 0.016;
            run.streamTerrain(fake.x);
            const y = run.terrain.heightAt(fake.x) - 14;
            fake.vy = (y - prevY) / 0.016;
            prevY = y;
            fake.y = y;
            run.updateCamera(16);
            if (i >= 450) {
              const cam = run.cameras.main;
              const sx = (fake.x - (cam.scrollX + 240 - 240 / cam.zoom)) * cam.zoom;
              minSx = Math.min(minSx, sx);
              maxSx = Math.max(maxSx, sx);
            }
          }
          const cam = run.cameras.main;
          const out = {
            zoom: cam.zoom, ahead: Math.round(cam.scrollX + 240 + 240 / cam.zoom - fake.x), minSx: Math.round(minSx), maxSx: Math.round(maxSx),
            bgScale: run.bg && run.bg.gfx ? run.bg.gfx.scaleX : null, flashScale: run.flashRect ? run.flashRect.scaleX : null,
            blindScale: run.blindRect ? run.blindRect.scaleX : null,
          };
          run.sled = real;
          return out;
        }).catch((e) => ({ fatal: String(e) }));
        const near = (a, b, eps) => Math.abs(a - b) <= eps;
        if (o.fatal) fail(name, o.fatal);
        else if (errors.length) fail(name, `page errors: ${errors.join(' | ')}`);
        else if (!(o.zoom >= 0.45 && o.zoom <= 0.53)) fail(name, `zoom ${o.zoom} at 1200 px/s (want 0.45 .. 0.53; v2.6.0 gave 0.62)`);
        else if (!near(o.bgScale, 1 / o.zoom, 1e-6) || !near(o.flashScale, 1 / o.zoom, 1e-6) || !near(o.blindScale, 1 / o.zoom, 1e-6)) fail(name, `layers not counter-scaled: bg ${o.bgScale}, flash ${o.flashScale}, blind ${o.blindScale}, want ${1 / o.zoom}`);
        else if (!(o.minSx >= 35 && o.maxSx <= 160)) fail(name, `rider screen x ${o.minSx} .. ${o.maxSx} (want 36 .. 160 of 480)`);
        else if (!(o.ahead >= 700)) fail(name, `only ${o.ahead} px visible ahead of the rider (v2.6.0: 563)`);
        else pass(name, `zoom ${o.zoom}, ${o.ahead} px (${(o.ahead / 1200).toFixed(2)} s) ahead, rider at screen x ${o.minSx} .. ${o.maxSx}, layers x${o.bgScale.toFixed(3)}`);
      } finally {
        await page.close();
      }
    }

    // ---- Readable Chaos (B3): a moving hazard is telegraphed with its PREDICTED arrival, and a Gear Gate with its verdict
    //
    // Real seed@bit runs, paused and stepped through the shipped run.update (-> updateFun -> updateGroundTelegraph). A
    // Rolling Boulder: once its roll has started, the mark's arrival must match the closing-speed solution on the
    // entity's own predictX (within 4 px at the meeting point; the mark is planned one frame of roll earlier, 2.2 px) and must differ from the static dx / vx (direction is not
    // assumed: either sign passes). A Gear Gate: the mark's verdict must agree with isPassable at the predicted arrival
    // whenever that arrival is clear of a change, and an 'open' mark must never be lime.
    {
      const name = 'readable chaos: a B3 Rolling Boulder is telegraphed with its predicted arrival, a Gear Gate with its open/closed verdict';
      const { ROLL_ACTIVATE_PX: ACT } = await import(path.join(ROOT, 'src/systems/HazardMotion.js'));
      const { GROUND_WARN } = await import(path.join(ROOT, 'src/systems/HazardTelegraph.js'));
      const probe = async (seedMask, hazardId) => {
        const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
        try {
          const out = await page.evaluate(async ({ seedMask, hazardId, ACT, margin }) => {
            const g = window.__bbGame;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            g.scene.start('TitleScene');
            const t0 = Date.now();
            let run = null;
            let started = false;
            while (Date.now() - t0 < 15000) {
              const tt = g.scene.getScene('TitleScene');
              if (!started && tt && !tt.starting) { started = true; tt.startRun(seedMask); }
              const rr = g.scene.getScene('RunScene');
              if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) { run = rr; break; }
              await wait(100);
            }
            if (!run) return { fatal: 'RunScene never produced a live sled' };
            await wait(300);
            run.scene.pause();
            let clock = run.runTimeMs;
            const keepAlive = () => { run.sled.invulnerableMs = 1e9; run.pendingCrash = null; };
            const step = () => { keepAlive(); clock += 16; run.update(clock, 16); };
            let f = null;
            for (let i = 0; i < 200 && !f; i++) {
              const ch = run.terrain.getChunk(i);
              const sp = ch.hazards.find((s) => s.defId === hazardId);
              if (sp) f = { ch, sp };
            }
            if (!f) return { fatal: `no ${hazardId} in the first 200 chunks of ${seedMask}` };
            if (!run.mesh.chunks.has(f.ch.index)) run.takeChunk(f.ch);
            const h = (run.hazards.get(f.ch.index) || []).find((e) => e.def.id === hazardId && e.spawn.x === f.sp.x);
            if (!h) return { fatal: 'hazard entity not built' };
            const v = 520;
            const res = { m: Math.round(h.x0 / 20), samples: [], gate: [], teleAt: null };
            // a gate is approached 4 times, each start 0.35 s of travel farther back, so the predicted arrivals sweep its
            // whole 1.4 s cycle (one approach at constant speed sees a nearly constant arrival and so one verdict)
            const passes = h.motion && h.motion.kind === 'gate' ? 4 : 1;
            for (let pass = 0; pass < passes; pass++) {
            const x = h.x0 - ACT - 520 - pass * 0.35 * v;
            run.streamTerrain(x);
            const ang = run.slopeAt(x);
            run.sled.setPose(x, run.terrain.heightAt(x) - 18, ang, Math.cos((ang * Math.PI) / 180) * v, Math.sin((ang * Math.PI) / 180) * v);
            if (run.snapCamera) run.snapCamera();
            for (let i = 0; i < 320; i++) {
              step();
              if (h.destroyed || run.sled.x > h.cx) break;
              if (h.teleAtMs != null && res.teleAt === null) res.teleAt = { dx: Math.round(h.cx - run.sled.x), onScreen: h.cx - h.w / 2 < run._view.right };
              const mk = (run._teleMarks || []).find((q) => q.ref === h);
              if (!mk) continue;
              const now = run.runTimeMs;
              const vx = Math.max(run.sled.vx, 60);
              // a roll that started this very frame was planned as resting (the telegraph runs before Hazard.update steps it)
              if (h.motion && h.motion.kind === 'roll' && h.roll.activeAtMs !== null && h.roll.activeAtMs < now && Number.isFinite(mk.etaS) && mk.arrivalMs != null) {
                const predCx = h.cx + h.predictX(mk.arrivalMs) - h.predictX(now);
                const sledAt = run.sled.x + vx * mk.etaS;
                res.samples.push({ err: Math.abs(predCx - sledAt), staticS: (h.cx - run.sled.x) / vx, etaS: mk.etaS, arrivalOk: Math.abs(mk.arrivalMs - (now + mk.etaS * 1000)) < 1e-6 });
              }
              if (h.motion && h.motion.kind === 'gate' && mk.arrivalMs != null && Number.isFinite(mk.arrivalMs)) {
                const nc = h.gateNextChangeMs(mk.arrivalMs - margin);
                const clearOfChange = nc > 2 * margin || !h.isPassable(mk.arrivalMs - margin);
                res.gate.push({ verdict: mk.gate, state: mk.state, color: mk.color, passable: h.isPassable(mk.arrivalMs), clearOfChange, wide: nc > 2 * margin });
              }
            }
            }
            return res;
          }, { seedMask, hazardId, ACT, margin: GROUND_WARN.gateMarginMs });
          return { out, errors };
        } catch (e) {
          return { out: { fatal: String(e) }, errors };
        } finally { await page.close(); }
      };
      const r = await probe('b3pyramid54@4', 'rollingBoulder');
      const gq = await probe('b3steam63@256', 'gearGate');
      const ro = r.out;
      const go = gq.out;
      const s = ro.samples || [];
      const maxErr = s.length ? Math.max(...s.map((q) => q.err)) : NaN;
      const maxDiff = s.length ? Math.max(...s.map((q) => Math.abs(q.etaS - q.staticS))) : NaN;
      const gs = go.gate || [];
      // when the verdict is 'open', the gate must be open across the margin at arrival; when 'closed', it must not be open
      // across the margin
      const gateBad = gs.filter((q) => (q.verdict === 'open' && !(q.passable && q.wide)) || (q.verdict === 'closed' && q.passable && q.wide) || (q.state === 'open' && q.color === 'lime'));
      const verdicts = new Set(gs.map((q) => q.verdict));
      if (ro.fatal || go.fatal) fail(name, ro.fatal || go.fatal);
      else if (r.errors.length || gq.errors.length) fail(name, `page errors: ${[...r.errors, ...gq.errors].join(' | ')}`);
      else if (!ro.teleAt) fail(name, 'the Rolling Boulder was never announced');
      else if (s.length < 5) fail(name, `only ${s.length} frames with a started roll and a mark`);
      else if (!s.every((q) => q.arrivalOk)) fail(name, 'mark.arrivalMs is not now + etaS');
      else if (!(maxErr <= 4)) fail(name, `predicted meeting point off by ${maxErr.toFixed(1)} px (want <= 4)`);
      else if (!(maxDiff >= 0.03)) fail(name, `the moving boulder is timed like a static one (max |eta - dx/vx| ${maxDiff.toFixed(3)} s)`);
      else if (gs.length < 20) fail(name, `only ${gs.length} Gear Gate frames with a mark`);
      else if (gateBad.length) fail(name, `${gateBad.length} gate frames disagree with isPassable at arrival: ${JSON.stringify(gateBad[0])}`);
      else if (!verdicts.has('open') || !verdicts.has('closed')) fail(name, `gate verdict never changed (${[...verdicts].join(',')})`);
      else pass(name, `boulder at ${ro.m} m announced ${ro.teleAt.dx} px out (on screen ${ro.teleAt.onScreen}); ${s.length} rolling frames, meeting point within ${maxErr.toFixed(2)} px, up to ${maxDiff.toFixed(2)} s from static dx/vx; gate at ${go.m} m: ${gs.length} frames, verdicts ${[...verdicts].join('/')}, all agree with isPassable at arrival`);
    }

    // ---- Readable Chaos phase 3: death legibility on the built game
    //
    // Real seed@mask runs, paused and stepped through the shipped run.update (the crash goes through onHazard ->
    // resolveCrash -> doCrash -> reportCrash, the beat through updateCrashed -> renderFrame / updateCamera). A shared
    // page helper finds a real ground crash hazard of the run's own terrain and poses the real sled in front of it.
    {
      const RC3 = async (seedMask, body, arg) => {
        const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
        try {
          const ok = await page.evaluate(async ({ seedMask }) => {
            const g = window.__bbGame;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            g.scene.start('TitleScene');
            const t0 = Date.now();
            let started = false;
            while (Date.now() - t0 < 15000) {
              const tt = g.scene.getScene('TitleScene');
              if (!started && tt && !tt.starting) { started = true; tt.startRun(seedMask); }
              const rr = g.scene.getScene('RunScene');
              if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) {
                await wait(300);
                rr.scene.pause();
                const H = {
                  g, run: rr, clock: rr.runTimeMs, wait,
                  step(n = 1) { for (let i = 0; i < n; i++) { this.clock += 16; this.run.update(this.clock, 16); } },
                  /** The k-th hazard of id `id` in the first 200 chunks, as a live entity. */
                  hazard(id, k = 0) {
                    const run = this.run;
                    let n = 0;
                    for (let i = 0; i < 200; i++) {
                      const ch = run.terrain.getChunk(i);
                      for (const sp of ch.hazards) {
                        if (sp.defId !== id || n++ < k) continue;
                        if (!run.mesh.chunks.has(ch.index)) run.takeChunk(ch);
                        return (run.hazards.get(ch.index) || []).find((e) => e.def.id === id && e.spawn.x === sp.x) || null;
                      }
                    }
                    return null;
                  },
                  pose(x, v) {
                    const run = this.run;
                    run.streamTerrain(x);
                    const ang = run.slopeAt(x);
                    run.sled.setPose(x, run.terrain.heightAt(x) - 18, ang, Math.cos((ang * Math.PI) / 180) * v, Math.sin((ang * Math.PI) / 180) * v);
                    if (run.snapCamera) run.snapCamera();
                  },
                  noInput() { this.run.inputRouter = { poll: () => null }; },
                };
                H.noInput();
                window.__rc3 = H;
                return true;
              }
              await wait(100);
            }
            return false;
          }, { seedMask });
          if (!ok) return { out: { fatal: 'RunScene never produced a live sled' }, errors, page };
          const out = await page.evaluate(body, arg || {}).catch((e) => ({ fatal: String(e) }));
          return { out, errors };
        } finally { await page.close(); }
      };

      // A: a real hazard crash: the banner names it, the beat runs (0.25x FX for 400 ms, zoom-in), REG.LAST_CRASH carries
      // the line, the record has none of it and still verifies, and Game Over shows the line within the crash time.
      {
        const name = 'readable chaos 3: a real Packet Spike crash is named on the banner, slowed 400 ms at 0.25x with a zoom-in, and named on Game Over';
        const { out: o, errors } = await RC3('gate-seed@0', async () => {
          const H = window.__rc3;
          const { run, g } = H;
          const ui = g.scene.getScene('UIScene');
          g.registry.set('lastCrash', null);
          let h = null;
          for (let k = 0; k < 6 && !run.crashed; k++) {
            h = H.hazard('packetSpike', k);
            if (!h) break;
            H.pose(h.cx - 260, 420);
            for (let i = 0; i < 90 && !run.crashed && run.sled.x < h.cx + 40; i++) { run.sled.invulnerableMs = 0; run.shieldCharges = 0; H.step(); }
          }
          if (!run.crashed) return { fatal: 'no Packet Spike crashed the real sled' };
          const lc = g.registry.get('lastCrash');
          const record = g.registry.get('lastRecord');
          const banner = ui && ui.banner && ui.banner.main ? ui.banner.main.text : null;
          const fxDts = [];
          const fxUpdate = run.fx.update.bind(run.fx);
          run.fx.update = (d, hf) => { fxDts.push(d); return fxUpdate(d, hf); };
          const zooms = [run.cameras.main.zoom];
          let frames = 0;
          while (!run._leaving && frames < 120) { H.step(); frames++; if (!run._leaving) zooms.push(run.cameras.main.zoom); }
          const t0 = Date.now();
          while (!g.scene.isActive('GameOverScene') && Date.now() - t0 < 4000) await H.wait(50);
          await H.wait(200);
          const go = g.scene.getScene('GameOverScene');
          return {
            lc, banner, frames, fxRatios: fxDts.map((d) => Math.round((d / 16) * 100) / 100), zoom0: zooms[0], zoomMax: Math.max(...zooms),
            recordKeys: record ? Object.keys(record) : null, recordId: record && record.id, recordCause: record && record.cause,
            goActive: g.scene.isActive('GameOverScene'), goLine: go && go.crashLine && go.crashLine.main ? go.crashLine.main.text : null,
            goLineY: go && go.crashLine ? go.crashLine.y : null, titleBottom: go && go.title ? go.title.y + 8 * (go.title.scale || go.title.scaleY || 4) : null,
          };
        });
        const slow = (o.fxRatios || []).filter((r) => r === 0.25).length;
        if (o.fatal) fail(name, o.fatal);
        else if (errors.length) fail(name, `page errors: ${errors.join(' | ')}`);
        else if (!o.lc || !/^PACKET SPIKE AT \d+ M - (NO HOP|HOP WAS .+)$/.test(o.lc.line)) fail(name, `REG.LAST_CRASH line ${JSON.stringify(o.lc && o.lc.line)}`);
        else if (o.lc.runId !== o.recordId) fail(name, `report runId ${o.lc.runId} is not the record id ${o.recordId}`);
        else if (o.recordKeys.some((k) => /line|verdict|killer|lastCrash/i.test(k)) || o.recordCause !== 'crash') fail(name, `the record carries crash-report fields: ${o.recordKeys.join(',')}`);
        else if (o.banner !== 'PACKET SPIKE') fail(name, `banner ${JSON.stringify(o.banner)} (want PACKET SPIKE)`);
        else if (!(slow >= 23 && slow <= 27)) fail(name, `${slow} frames at 0.25x (want 25 = 400 ms): ${o.fxRatios.slice(0, 40).join(' ')}`);
        else if (!(o.zoomMax >= o.zoom0 * 1.12)) fail(name, `no zoom-in: ${o.zoom0} -> max ${o.zoomMax}`);
        else if (!(o.frames * 16 <= 1200)) fail(name, `crash to Game Over took ${o.frames * 16} ms of frames (limit 1200)`);
        else if (!o.goActive || o.goLine !== o.lc.line) fail(name, `Game Over line ${JSON.stringify(o.goLine)} (want ${o.lc.line})`);
        else if (!(o.goLineY >= o.titleBottom && o.goLineY + 8 <= 54)) fail(name, `Game Over line at y ${o.goLineY} overlaps the title (bottom ${o.titleBottom}) or the panels (54)`);
        else pass(name, `banner PACKET SPIKE; ${slow} frames at 0.25x; zoom ${o.zoom0} -> ${o.zoomMax}; Game Over after ${o.frames * 16} ms: "${o.goLine}"`);
      }

      // B: a real hop pressed too late (after the ideal window, before the box) is reported LATE by the telegraph's window.
      {
        const name = 'readable chaos 3: a real late hop before a Packet Spike is reported "HOP WAS x S LATE" against the telegraph window';
        const { out: o, errors } = await RC3('gate-seed@0', async () => {
          const H = window.__rc3;
          const { run, g } = H;
          g.registry.set('lastCrash', null);
          let hopT = null;
          let h = null;
          for (let k = 0; k < 8 && !run.crashed; k++) {
            h = H.hazard('packetSpike', k);
            if (!h) break;
            H.pose(h.cx - 300, 420);
            hopT = null;
            for (let i = 0; i < 100 && !run.crashed && run.sled.x < h.cx + 40; i++) {
              run.sled.invulnerableMs = 0;
              run.shieldCharges = 0;
              const eta = (h.cx - run.sled.x) / Math.max(run.sled.vx, 60) * 1000;
              // the sled's nose meets the box ~55 ms out at this speed; the window closes 130 ms out: hop 60-110 ms out
              if (hopT === null && run.sled.grounded && eta <= 110 && eta > 60) {
                run.inputRouter = { poll: () => ({ hop: true, pressed: { hop: true } }) };
                H.step();
                H.noInput();
                if (run._lastHopMs != null) hopT = run._lastHopMs;
              } else H.step();
            }
            if (!run.crashed) continue;
          }
          if (!run.crashed) return { fatal: 'no late-hopped Packet Spike crashed the real sled' };
          const lc = g.registry.get('lastCrash');
          return { lc, hopT, arr: run.teleTracker.lastArrivalMs(h), lastHop: run._lastHopMs };
        });
        const m = o.lc && /HOP WAS (\d+\.\d\d) S LATE$/.exec(o.lc.line || '');
        const want = o.arr != null && o.hopT != null ? (o.hopT - (o.arr - 380 + 250)) / 1000 : NaN;
        if (o.fatal) fail(name, o.fatal);
        else if (errors.length) fail(name, `page errors: ${errors.join(' | ')}`);
        else if (o.hopT == null) fail(name, `the injected hop never executed (lastHop ${o.lastHop})`);
        else if (!m) fail(name, `line ${JSON.stringify(o.lc && o.lc.line)} does not say LATE`);
        else if (!(Math.abs(Number(m[1]) - want) <= 0.011)) fail(name, `late by ${m[1]} s, the telegraph window says ${want.toFixed(3)} s`);
        else pass(name, `"${o.lc.line}" (hop at ${Math.round(o.hopT)} ms, planned arrival ${Math.round(o.arr)} ms)`);
      }

      // C: a hazard hit a Hashed Backup charge absorbs is not a crash: no report, no killer banner, the run goes on.
      {
        const name = 'readable chaos 3: a Packet Spike hit absorbed by a shield charge is not a crash (no report, no killer banner, run goes on)';
        const { out: o, errors } = await RC3('gate-seed@0', async () => {
          const H = window.__rc3;
          const { run, g } = H;
          const ui = g.scene.getScene('UIScene');
          g.registry.set('lastCrash', null);
          const crashes = [];
          const onCrash = (p) => crashes.push(p);
          g.events.on('bb:crash', onCrash);
          let h = null;
          for (let k = 0; k < 6 && !crashes.length; k++) {
            h = H.hazard('packetSpike', k);
            if (!h) break;
            H.pose(h.cx - 260, 420);
            run.shieldCharges = 1;
            for (let i = 0; i < 90 && !crashes.length && run.sled.x < h.cx + 40; i++) { run.sled.invulnerableMs = 0; H.step(); }
          }
          g.events.off('bb:crash', onCrash);
          H.step(5);
          return {
            crashes: crashes.map((p) => ({ negated: p.negated, hazardId: p.hazardId })), crashed: run.crashed, lc: g.registry.get('lastCrash'),
            banner: ui && ui.banner && ui.banner.main ? ui.banner.main.text : null, shield: run.shieldCharges,
          };
        });
        if (o.fatal) fail(name, o.fatal);
        else if (errors.length) fail(name, `page errors: ${errors.join(' | ')}`);
        else if (!o.crashes.length || !o.crashes[0].negated) fail(name, `no negated crash: ${JSON.stringify(o.crashes)}`);
        else if (o.crashed) fail(name, 'the run ended');
        else if (o.lc) fail(name, `REG.LAST_CRASH was written: ${JSON.stringify(o.lc)}`);
        else if (o.banner === 'PACKET SPIKE') fail(name, 'the killer banner showed for an absorbed hit');
        else pass(name, `negated ${o.crashes[0].hazardId}, run alive, no report, banner "${o.banner}"`);
      }

      // D: a same-seed retry plants DIED HERE at the death x; another seed does not.
      {
        const name = 'readable chaos 3: a same-seed retry shows DIED HERE at the death x; another seed shows none';
        const { out: o, errors } = await RC3('gate-seed@0', async () => {
          const H = window.__rc3;
          const { g } = H;
          const lc = { runId: 'old', seed: 'gate-seed', biomeMask: 0, x: H.run.startX + 640 * 20, distM: 640, line: 'X' };
          const start = async (seedMask) => {
            g.registry.set('lastCrash', lc);
            const prevId = g.scene.getScene('RunScene') ? g.scene.getScene('RunScene').runId : null;
            const old = g.scene.getScene('RunScene');
            if (old && old.scene.isActive()) old.scene.stop();
            g.scene.start('TitleScene');
            const t0 = Date.now();
            let started = false;
            while (Date.now() - t0 < 15000) {
              const tt = g.scene.getScene('TitleScene');
              if (!started && tt && tt.scene.isActive() && !tt.starting) { started = true; tt.startRun(seedMask); }
              const rr = g.scene.getScene('RunScene');
              if (started && rr && rr.runId !== prevId && rr.scene.isActive() && rr.sled && rr.sled.inWorld) return rr;
              await H.wait(100);
            }
            return null;
          };
          const same = await start('gate-seed@0');
          if (!same) return { fatal: 'retry did not start' };
          const dm = same.deathMarker;
          const sameOut = dm ? { x: dm.x, label: dm.label && dm.label.text } : null;
          // the marker is drawn once the sled is near: pose close and render a frame
          if (dm) { same.scene.pause(); same.sled.setPose(lc.x - 600, same.terrain.heightAt(lc.x - 600) - 18, 0, 300, 0); same.streamTerrain(lc.x); same.renderFrame(16); }
          const drawn = dm && dm.gfx ? dm.gfx.commandBuffer.length : 0;
          const other = await start('gate-seed-2@0');
          return { lcX: lc.x, same: sameOut, drawn, other: other ? !!other.deathMarker : 'no run' };
        });
        if (o.fatal) fail(name, o.fatal);
        else if (errors.length) fail(name, `page errors: ${errors.join(' | ')}`);
        else if (!o.same || o.same.x !== o.lcX || o.same.label !== 'DIED HERE 640m') fail(name, `same-seed marker ${JSON.stringify(o.same)} (want x ${o.lcX}, DIED HERE 640m)`);
        else if (!(o.drawn > 0)) fail(name, 'the marker drew nothing near the sled');
        else if (o.other !== false) fail(name, `another seed: marker ${o.other}`);
        else pass(name, `retry: ${o.same.label} at x ${o.same.x} (${o.drawn} draw commands); gate-seed-2: none`);
      }
    }

    // ---- B0 (biome full treatment): every new effect acts on the REAL run. Fixture defs are injected into the registry
    // content at runtime (B0 ships no biome content), then the pickup / hit goes through the shipped RunScene.onPowerUp /
    // onHazard dispatch, and the effect is read back from what the live frame loop produced (run.update -> physicsContext
    // -> PhysicsTuner -> run.currentPhys), from the real sled body, or from the real overlay. Deleting a dispatch branch in
    // RunScene fails the matching line below (negative controls in the B0 report). The scene is paused so Phaser's own loop
    // cannot interleave; frames are driven with run.update(t, 16).
    {
      const c = await (async () => {
        const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
        try {
          const out = await page.evaluate(async () => {
            const g = window.__bbGame;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            g.registry.set('biomeMask', 0);
            g.scene.start('TitleScene');
            const t0 = Date.now();
            let run = null;
            let started = false;
            while (Date.now() - t0 < 15000) {
              const tt = g.scene.getScene('TitleScene');
              if (!started && tt && !tt.starting) { started = true; tt.startRun('b0-effects-probe', 0); }
              const rr = g.scene.getScene('RunScene');
              if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) { run = rr; break; }
              await wait(100);
            }
            if (!run) return { fatal: 'RunScene never produced a live sled' };
            await wait(300);
            if (run.sled.destroyed || !run.sled.inWorld || run.crashed) return { fatal: 'sled died before the probe' };
            run.scene.pause();
            const res = {};
            const content = run.content;
            const PX = (v) => (v * 1000) / (1000 / 60);
            const vel = () => ({ x: PX(run.sled.body.velocity.x), y: PX(run.sled.body.velocity.y) });
            let clock = run.runTimeMs;
            const step = (n) => { for (let i = 0; i < n; i++) { clock += 16; run.update(clock, 16); } };
            const keepAlive = () => { run.sled.invulnerableMs = 1e9; run.pendingCrash = null; };
            // Fixtures: B1-B4 ship the real defs. Injected into the SAME content object the scenes read.
            const FX = {
              ward: { id: 'gateFxWard', biome: 'garbage-dump-glacier', shapeKey: 'gateFx', radius: 10, colorKey: 'cyan',
                effect: { kind: 'ward', durationMs: 4000, mods: ['stickyPatch'], hazards: [], effects: [] }, spawn: { baseChance: 0.5 } },
              glide: { id: 'gateFxGlide', biome: 'pyramid-peak', shapeKey: 'gateFx', radius: 10, colorKey: 'lime',
                effect: { kind: 'glide', frictionMul: 0.7, durationMs: 4000 }, spawn: { baseChance: 0.5 } },
              stabilize: { id: 'gateFxStab', biome: 'space-mountain', shapeKey: 'gateFx', radius: 10, colorKey: 'amber',
                effect: { kind: 'stabilize', landingToleranceDeg: 12, durationMs: 5000 }, spawn: { baseChance: 0.5 } },
              gust: { id: 'gateFxGust', biome: 'sky-jellyfish-mountain', shapeKey: 'gateFx', size: { w: 30, h: 30 }, placement: 'air',
                colorKey: 'cyan', onHit: { effect: 'gust', impulsePxS: [400, -300] }, weight: 1, minDistanceM: 0, spawn: { baseChance: 0.5 } },
              blind: { id: 'gateFxBlind', biome: 'crystal-cavern', shapeKey: 'gateFx', size: { w: 30, h: 30 }, placement: 'ground',
                colorKey: 'amber', onHit: { effect: 'blind', durationMs: 1200, visibility: 0.1 }, weight: 1, minDistanceM: 0, spawn: { baseChance: 0.5 } },
            };
            for (const k of ['ward', 'glide', 'stabilize']) content.powerups[FX[k].id] = FX[k];
            for (const k of ['gust', 'blind']) content.hazards[FX[k].id] = FX[k];
            const pickup = (def) => ({ def, spawn: { x: run.sled.x, y: run.sled.y }, color: 0xffffff, key: null, destroy() {} });
            const hit = (def) => ({ def, cx: run.sled.x, cy: run.sled.y, color: 0xffffff, gfx: null, hit: false });
            const zonesAt = (x) => run.terrain._chunkAt(x).zones;

            // ward vs stickyPatch: the effective groundResist the frame loop produces is the un-sticky value while it lasts
            try {
              keepAlive();
              run._resetBiomeEffects();
              step(2);
              const base = run.currentPhys.groundResist;
              const x = run.sled.x;
              const touched = [...new Set([zonesAt(x), zonesAt(x + 400)])]; // one zone per chunk: never the same list twice
              const lens = touched.map((z) => z.length);
              for (const z of touched) z.push({ modId: 'stickyPatch', x0: x - 3000, x1: x + 3000 });
              step(2);
              const sticky = run.currentPhys.groundResist;
              run.onPowerUp(pickup(FX.ward));
              step(2);
              const warded = run.currentPhys.groundResist;
              run.tickEffects(4100);
              step(1);
              const after = run.currentPhys.groundResist;
              touched.forEach((z, i) => { z.length = lens[i]; });
              res.ward = { base, sticky, warded, after };
            } catch (e) { res.ward = { fatal: String(e) }; }

            // glide: lower ground friction in the frame loop, and the real sled body keeps more speed on the ground
            try {
              keepAlive();
              run._resetBiomeEffects();
              step(2);
              const base = run.currentPhys.groundResist;
              const basePhys = run.currentPhys;
              run.onPowerUp(pickup(FX.glide));
              step(2);
              const glided = run.currentPhys.groundResist;
              const glidePhys = run.currentPhys;
              const emptyPad = { push: false, brake: false, tuck: false, tilt: 0, hop: false, heli: 0, pressed: {}, airBrake: false, parachute: false };
              const keep = (phys) => {
                const v0 = vel();
                for (let i = 0; i < 10; i++) { run.sled.msSinceContact = 0; run.sled.applyControls(emptyPad, phys, 16); }
                const v1 = vel();
                return Math.hypot(v1.x, v1.y) / Math.max(1, Math.hypot(v0.x, v0.y));
              };
              const keepGlide = keep(glidePhys);
              const keepBase = keep(basePhys);
              res.glide = { base, glided, keepGlide, keepBase };
            } catch (e) { res.glide = { fatal: String(e) }; }

            // gust: the real sled body's velocity changes by the bounded impulse
            try {
              run._resetBiomeEffects();
              run.sled.invulnerableMs = 0;
              run.pendingCrash = null;
              const v0 = vel();
              run.onHazard(hit(FX.gust));
              const v1 = vel();
              res.gust = { dvx: v1.x - v0.x, dvy: v1.y - v0.y, crashed: !!run.pendingCrash };
              keepAlive();
            } catch (e) { res.gust = { fatal: String(e) }; }

            // blind: the overlay comes up within the visibility floor, the run keeps going, and it clears afterwards
            try {
              run._resetBiomeEffects();
              run.sled.invulnerableMs = 0;
              run.pendingCrash = null;
              run.onHazard(hit(FX.blind));
              const crashedByHit = !!run.pendingCrash;
              keepAlive();
              step(12);
              // what reaches the screen: a Rectangle draws fillAlpha x alpha, so the object alpha alone can lie
              const opacity = () => (run.blindRect && run.blindRect.visible ? run.blindRect.fillAlpha * run.blindRect.alpha : null);
              const mid = opacity();
              const visible = run.blindRect ? run.blindRect.visible : null;
              step(80);
              const end = opacity();
              res.blind = { crashedByHit, mid, end, visible, crashed: run.crashed, inWorld: run.sled.inWorld };
            } catch (e) { res.blind = { fatal: String(e) }; }

            // stabilize: a landing just past the forgiveness angle crashes without it and is a wobble with it
            try {
              run._resetBiomeEffects();
              keepAlive();
              const fs = { x: run.sled.x, y: run.sled.y, vx: run.sled.vx, vy: run.sled.vy };
              const land = () => ({ quality: 'crash', angleDeg: 86, impactSpeedPxS: 400, airtimeMs: 600, hard: false });
              run.pendingCrash = null;
              run.handleTricksAndLanding({ tricks: [], landing: land() }, fs);
              const without = run.pendingCrash ? run.pendingCrash.cause : null;
              run.pendingCrash = null;
              run.onPowerUp(pickup(FX.stabilize));
              run.handleTricksAndLanding({ tricks: [], landing: land() }, fs);
              const withStab = run.pendingCrash ? run.pendingCrash.cause : null;
              run.pendingCrash = null;
              res.stabilize = { without, withStab };
            } catch (e) { res.stabilize = { fatal: String(e) }; }

            run._resetBiomeEffects();
            return res;
          }).catch((e) => ({ fatal: String(e) }));
          return { errors, out };
        } finally { await page.close(); }
      })();
      const o = c.out;
      const near = (a, b, eps) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;
      const name = {
        ward: 'B0: a ward vs stickyPatch makes the real effective groundResist un-sticky while it lasts',
        glide: 'B0: a glide lowers ground friction on the real sled',
        gust: 'B0: a gust changes the real sled velocity by the bounded impulse',
        blind: 'B0: blind dims the screen (>= 35 % visibility) without crashing',
        stabilize: 'B0: stabilize widens landing tolerance in the real landing path',
      };
      if (o.fatal || c.errors.length) {
        for (const k of Object.keys(name)) fail(name[k], o.fatal || `page errors: ${c.errors.join(' | ')}`);
      } else {
        const w = o.ward;
        if (w.fatal) fail(name.ward, w.fatal);
        else if (!(w.sticky > w.base * 1.2)) fail(name.ward, `the injected stickyPatch did not reach the frame (base ${w.base}, sticky ${w.sticky})`);
        else if (!near(w.warded, w.base, 1e-9)) fail(name.ward, `warded groundResist ${w.warded} != un-sticky ${w.base} (sticky ${w.sticky})`);
        else if (!near(w.after, w.sticky, 1e-9)) fail(name.ward, `sticky did not come back after the ward expired (${w.after} vs ${w.sticky})`);
        else pass(name.ward, `groundResist sticky ${w.sticky.toFixed(4)} -> warded ${w.warded.toFixed(4)} (= base ${w.base.toFixed(4)}) -> expired ${w.after.toFixed(4)}`);

        const gl = o.glide;
        if (gl.fatal) fail(name.glide, gl.fatal);
        else if (!near(gl.glided, gl.base * 0.7, 1e-9)) fail(name.glide, `groundResist ${gl.glided} != 0.7 x ${gl.base}`);
        else if (!(gl.keepGlide > gl.keepBase)) fail(name.glide, `sled kept ${gl.keepGlide} of its speed gliding vs ${gl.keepBase} without`);
        else pass(name.glide, `groundResist ${gl.base.toFixed(4)} -> ${gl.glided.toFixed(4)}; sled keeps ${(gl.keepGlide * 100).toFixed(2)} % vs ${(gl.keepBase * 100).toFixed(2)} % over 10 grounded steps`);

        const gu = o.gust;
        const mag = gu.fatal ? NaN : Math.hypot(gu.dvx, gu.dvy);
        if (gu.fatal) fail(name.gust, gu.fatal);
        else if (gu.crashed) fail(name.gust, 'a gust hit queued a crash');
        else if (!near(mag, 180, 0.5) || !(gu.dvx > 0) || !(gu.dvy < 0)) fail(name.gust, `dv=(${gu.dvx}, ${gu.dvy}) |dv|=${mag} (want 180 px/s along (400,-300))`);
        else pass(name.gust, `dv=(${gu.dvx.toFixed(1)}, ${gu.dvy.toFixed(1)}) px/s, |dv| ${mag.toFixed(2)} of a requested 500`);

        const b = o.blind;
        if (b.fatal) fail(name.blind, b.fatal);
        else if (b.crashedByHit || b.crashed || !b.inWorld) fail(name.blind, `blind crashed the run (hit ${b.crashedByHit}, crashed ${b.crashed}, inWorld ${b.inWorld})`);
        else if (!(b.mid > 0.3) || !(b.mid <= 0.65 + 1e-9)) fail(name.blind, `overlay opacity (fillAlpha x alpha) mid-effect ${b.mid} (want (0.3, 0.65])`);
        else if (b.end !== 0) fail(name.blind, `overlay did not clear: alpha ${b.end}`);
        else pass(name.blind, `overlay opacity ${b.mid.toFixed(3)} mid-effect (visibility floor 0.35 -> max 0.65), 0 after; no crash`);

        const st = o.stabilize;
        if (st.fatal) fail(name.stabilize, st.fatal);
        else if (st.without !== 'badLanding') fail(name.stabilize, `control: an 86 deg landing should crash without stabilize, got ${st.without}`);
        else if (st.withStab !== null) fail(name.stabilize, `with stabilize the 86 deg landing still crashed (${st.withStab})`);
        else pass(name.stabilize, 'an 86 deg landing: crash without, wobble with a +12 deg stabilize');
      }
    }

    // ---- B1 (biome full treatment, "Wards"): per biome, a real seed@<bit> run of the built game. The biome hazard and
    // power-up are looked up in THAT run's terrain (run.terrain.getChunk), built by the shipped RunScene.takeChunk into real
    // Hazard / PowerUp entities from the shipped JSON, and driven through the shipped onHazard / onPowerUp dispatch. The
    // effect is read from the real sled body and from the live frame loop (run.update -> physicsContext -> PhysicsTuner ->
    // run.currentPhys). Removing a hazard's or power-up's effect path fails its line below (negative controls in the B1
    // report). Seeds and distances double as the lead's hand-play list.
    {
      const B1 = [
        { biome: 'debumont', name: 'Debumont', seed: 'b1debumont35', mask: 1, hazard: 'groomerCat', powerup: 'mapleWax' },
        { biome: 'garbage-dump-glacier', name: 'Garbage Dump Glacier', seed: 'b1garbage13', mask: 2, hazard: 'seagullDive', powerup: 'slickWaxSpray' },
        { biome: 'underwater-mountain', name: 'Underwater Mountain', seed: 'b1underwater15', mask: 8, hazard: 'seaweedTangle', powerup: 'aquaLungBubble' },
        { biome: 'candy-cane-canyon', name: 'Candy Cane Canyon', seed: 'b1candy11', mask: 64, hazard: 'chocolateRiver', powerup: 'sweetToothCoating' },
      ];
      for (const B of B1) {
        const hzName = `B1 ${B.name}: ${B.hazard} spawns on ${B.seed}@${B.mask} and acts on the real sled`;
        const puName = `B1 ${B.name}: ${B.powerup} spawns on ${B.seed}@${B.mask} and its effect acts on the real run`;
        const c = await (async () => {
          const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
          try {
            const out = await page.evaluate(async (B) => {
              const g = window.__bbGame;
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              g.scene.start('TitleScene');
              const t0 = Date.now();
              let run = null;
              let started = false;
              while (Date.now() - t0 < 15000) {
                const tt = g.scene.getScene('TitleScene');
                if (!started && tt && !tt.starting) { started = true; tt.startRun(`${B.seed}@${B.mask}`); }
                const rr = g.scene.getScene('RunScene');
                if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) { run = rr; break; }
                await wait(100);
              }
              if (!run) return { fatal: 'RunScene never produced a live sled' };
              await wait(300);
              if (run.sled.destroyed || !run.sled.inWorld || run.crashed) return { fatal: 'sled died before the probe' };
              run.scene.pause();
              const res = { seed: run.seed, mask: run.biomeMask };
              const PX = (v) => (v * 1000) / (1000 / 60);
              const speed = () => Math.hypot(PX(run.sled.body.velocity.x), PX(run.sled.body.velocity.y));
              let clock = run.runTimeMs;
              const step = (n) => { for (let i = 0; i < n; i++) { clock += 16; run.update(clock, 16); } };
              const keepAlive = () => { run.sled.invulnerableMs = 1e9; run.pendingCrash = null; };
              const live = () => { run.sled.invulnerableMs = 0; run.pendingCrash = null; };
              const hits = [];
              const onHit = (p) => hits.push(p);
              g.events.on('bb:hazardHit', onHit);
              const ui = g.scene.getScene('UIScene');
              // find the first chunk of THIS run carrying a def, build its real entity through RunScene.takeChunk
              const find = (id, list) => {
                for (let i = 0; i < 200; i++) {
                  const ch = run.terrain.getChunk(i);
                  const sp = ch[list].find((s) => s.defId === id);
                  if (sp) return { ch, sp };
                }
                return null;
              };
              const taken = [];
              const entity = (f, map) => {
                if (!run.mesh.chunks.has(f.ch.index)) { run.takeChunk(f.ch); taken.push(f.ch.index); }
                return (run[map].get(f.ch.index) || []).find((e) => e.def.id === f.sp.defId && e.spawn.x === f.sp.x) || null;
              };
              const zonesAt = (x) => run.terrain._chunkAt(x).zones;
              const withZone = (modId, fn) => {
                const x = run.sled.x;
                const touched = [...new Set([zonesAt(x), zonesAt(x + 400)])];
                const lens = touched.map((z) => z.length);
                for (const z of touched) z.push({ modId, x0: x - 3000, x1: x + 3000 });
                try { return fn(); } finally { touched.forEach((z, i) => { z.length = lens[i]; }); }
              };
              try {
                keepAlive();
                run._resetBiomeEffects();
                step(2);
                // ---- hazard
                const fh = find(B.hazard, 'hazards');
                const h = fh && entity(fh, 'hazards');
                if (!h) res.hz = { fatal: `no ${B.hazard} in the first 200 chunks of ${B.seed}@${B.mask}` };
                else {
                  const def = h.def;
                  res.hz = { m: Math.round(fh.sp.x / 20), chunkBiome: fh.ch.biome, drawKind: h.drawKind, shapeKey: def.shapeKey, isDanger: h.color === run.palette.danger, effect: def.onHit.effect };
                  live();
                  hits.length = 0;
                  const s0 = speed();
                  const mul0 = run.currentPhys.speedMul;
                  run.onHazard(h);
                  res.hz.ratio = speed() / Math.max(1e-6, s0);
                  res.hz.crash = run.pendingCrash ? run.pendingCrash.hazardId : null;
                  res.hz.hitEvents = hits.map((p) => p.hazardId);
                  res.hz.slowMs = run.slowMs;
                  keepAlive();
                  step(2);
                  res.hz.mulRatio = run.currentPhys.speedMul / mul0;
                  run.tickEffects(3000);
                  run.slowMs = 0;
                  step(1);
                }
                // ---- power-up
                run._resetBiomeEffects();
                keepAlive();
                step(2);
                const fp = find(B.powerup, 'powerups');
                const p = fp && entity(fp, 'powerups');
                if (!p) res.pu = { fatal: `no ${B.powerup} in the first 200 chunks of ${B.seed}@${B.mask}` };
                else {
                  res.pu = { m: Math.round(fp.sp.x / 20), chunkBiome: fp.ch.biome, drawKind: p.drawKind, shapeKey: p.def.shapeKey };
                  const s0 = speed();
                  const ph0 = run.currentPhys;
                  if (B.powerup === 'mapleWax') {
                    run.onPowerUp(p);
                    res.pu.ratio = speed() / Math.max(1e-6, s0);
                    step(2);
                    res.pu.mulRatio = run.currentPhys.speedMul / ph0.speedMul;
                    res.pu.chip = !!(ui && ui.powerups && ui.powerups.has('mapleWax'));
                    run.tickEffects(2100);
                    step(1);
                    res.pu.mulAfter = run.currentPhys.speedMul / ph0.speedMul;
                  } else if (B.powerup === 'slickWaxSpray' || B.powerup === 'aquaLungBubble') {
                    const mod = B.powerup === 'slickWaxSpray' ? 'stickyPatch' : 'slowMotion';
                    const key = mod === 'stickyPatch' ? 'groundResist' : 'gravityPxS2';
                    withZone(mod, () => {
                      step(2);
                      const zoned = run.currentPhys;
                      const zs = speed();
                      run.onPowerUp(p);
                      res.pu.ratio = speed() / Math.max(1e-6, zs);
                      step(2);
                      const warded = run.currentPhys;
                      res.pu.chip = !!(ui && ui.powerups && ui.powerups.has(B.powerup));
                      run.tickEffects(4100);
                      step(1);
                      const after = run.currentPhys;
                      res.pu.key = key;
                      res.pu.base = ph0[key];
                      res.pu.zoned = zoned[key];
                      res.pu.warded = warded[key];
                      res.pu.after = after[key];
                      res.pu.mulRatio = warded.speedMul / zoned.speedMul;
                      res.pu.mulAfter = after.speedMul / zoned.speedMul;
                    });
                  } else if (B.powerup === 'sweetToothCoating') {
                    // the real Chocolate River of this run, hit while the coating runs: nothing happens
                    const river = res.hz && !res.hz.fatal ? entity(find('chocolateRiver', 'hazards'), 'hazards') : null;
                    if (!river) res.pu.fatal = 'no Chocolate River to test the coating against';
                    else {
                      run.onPowerUp(p);
                      res.pu.chip = !!(ui && ui.powerups && ui.powerups.has(B.powerup));
                      live();
                      river.hit = false;
                      hits.length = 0;
                      const rs0 = speed();
                      run.onHazard(river);
                      res.pu.wardedRatio = speed() / Math.max(1e-6, rs0);
                      res.pu.wardedHits = hits.length;
                      res.pu.wardedSlowMs = run.slowMs;
                      keepAlive();
                      step(2);
                      res.pu.mulRatio = run.currentPhys.speedMul / ph0.speedMul;
                      run.tickEffects(5100);
                      step(1);
                      live();
                      river.hit = false;
                      hits.length = 0;
                      const rs1 = speed();
                      run.onHazard(river);
                      res.pu.afterRatio = speed() / Math.max(1e-6, rs1);
                      res.pu.afterHits = hits.length;
                      keepAlive();
                    }
                  }
                }
              } catch (e) { res.fatal = String(e && e.stack || e); }
              g.events.off('bb:hazardHit', onHit);
              for (const idx of taken) run.dropChunk(idx);
              run._resetBiomeEffects();
              return res;
            }, B).catch((e) => ({ fatal: String(e) }));
            return { errors, out };
          } finally { await page.close(); }
        })();
        const o = c.out;
        const near = (a, b, eps) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;
        if (o.fatal || c.errors.length) {
          fail(hzName, o.fatal || `page errors: ${c.errors.join(' | ')}`);
          fail(puName, o.fatal || `page errors: ${c.errors.join(' | ')}`);
          continue;
        }
        const run = `run ${o.seed}@${o.mask}`;
        const hz = o.hz;
        const hd = HAZ_DEFS[B.hazard];
        if (o.seed !== B.seed || o.mask !== B.mask) fail(hzName, `the run is ${run}, not ${B.seed}@${B.mask}`);
        else if (hz.fatal) fail(hzName, hz.fatal);
        else if (hz.chunkBiome !== B.biome) fail(hzName, `spawned in a ${hz.chunkBiome} chunk`);
        else if (hz.drawKind !== hz.shapeKey) fail(hzName, `entity draws '${hz.drawKind}', not its own '${hz.shapeKey}'`);
        else if (hd.onHit.effect === 'crash') {
          if (hz.crash !== B.hazard) fail(hzName, `a hit queued no ${B.hazard} crash (pendingCrash ${hz.crash})`);
          else if (!hz.isDanger) fail(hzName, 'a biome crash hazard is not drawn in danger');
          else pass(hzName, `${run}: at ${hz.m} m; real hit queued crash '${hz.crash}', drawn '${hz.drawKind}' in danger`);
        } else if (!near(hz.ratio, hd.onHit.speedFactor, 0.01)) fail(hzName, `sled speed x${hz.ratio} on hit, want x${hd.onHit.speedFactor}`);
        else if (!near(hz.mulRatio, hd.onHit.speedFactor, 1e-6)) fail(hzName, `frame speedMul x${hz.mulRatio}, want x${hd.onHit.speedFactor}`);
        else if (hz.slowMs !== hd.onHit.durationMs || hz.hitEvents.join() !== B.hazard) fail(hzName, `slowMs ${hz.slowMs} (want ${hd.onHit.durationMs}), HAZARD_HIT ${hz.hitEvents}`);
        else pass(hzName, `${run}: at ${hz.m} m; real sled speed x${hz.ratio.toFixed(3)}, frame speedMul x${hz.mulRatio.toFixed(3)} for ${hz.slowMs} ms, drawn '${hz.drawKind}'`);

        const pu = o.pu;
        const pd = PU_DEFS[B.powerup];
        if (pu.fatal) fail(puName, pu.fatal);
        else if (pu.chunkBiome !== B.biome) fail(puName, `spawned in a ${pu.chunkBiome} chunk`);
        else if (pu.drawKind !== pu.shapeKey) fail(puName, `entity draws '${pu.drawKind}', not its own '${pu.shapeKey}'`);
        else if (!pu.chip) fail(puName, 'no HUD chip for the pickup');
        else if (B.powerup === 'mapleWax') {
          if (!near(pu.ratio, pd.effect.speedFactor, 0.01) || !near(pu.mulRatio, pd.effect.speedFactor, 1e-6)) fail(puName, `speed x${pu.ratio}, speedMul x${pu.mulRatio}, want x${pd.effect.speedFactor}`);
          else if (!near(pu.mulAfter, 1, 1e-6)) fail(puName, `boost did not end (speedMul x${pu.mulAfter})`);
          else pass(puName, `${run}: at ${pu.m} m; real sled speed x${pu.ratio.toFixed(3)}, speedMul x${pu.mulRatio.toFixed(3)} for 2 s, then x1`);
        } else if (B.powerup === 'slickWaxSpray' || B.powerup === 'aquaLungBubble') {
          const sf = pd.effect.speedFactor || 1;
          if (near(pu.zoned, pu.base, 1e-9)) fail(puName, `the injected zone did not reach the frame (${pu.key} ${pu.base} -> ${pu.zoned})`);
          else if (!near(pu.warded, pu.base, 1e-9)) fail(puName, `warded ${pu.key} ${pu.warded} != unzoned ${pu.base} (zoned ${pu.zoned})`);
          else if (!near(pu.after, pu.zoned, 1e-9)) fail(puName, `the zone did not come back after the ward (${pu.after} vs ${pu.zoned})`);
          else if (!near(pu.mulRatio, sf, 1e-6) || !near(pu.ratio, sf, 0.01) || !near(pu.mulAfter, 1, 1e-6)) fail(puName, `speed part: sled x${pu.ratio}, speedMul x${pu.mulRatio} then x${pu.mulAfter} (want x${sf} then x1)`);
          else pass(puName, `${run}: at ${pu.m} m; ${pu.key} zoned ${pu.zoned.toFixed(4)} -> warded ${pu.warded.toFixed(4)} (= unzoned) -> expired ${pu.after.toFixed(4)}${sf > 1 ? `; speed x${pu.ratio.toFixed(3)}, speedMul x${pu.mulRatio.toFixed(3)} while warded` : ''}`);
        } else if (B.powerup === 'sweetToothCoating') {
          if (pu.wardedHits !== 0 || !near(pu.wardedRatio, 1, 1e-6) || pu.wardedSlowMs !== 0 || !near(pu.mulRatio, 1, 1e-6)) fail(puName, `river hit while coated: ${pu.wardedHits} HAZARD_HIT, speed x${pu.wardedRatio}, slowMs ${pu.wardedSlowMs}, speedMul x${pu.mulRatio}`);
          else if (pu.afterHits !== 1 || !near(pu.afterRatio, HAZ_DEFS.chocolateRiver.onHit.speedFactor, 0.01)) fail(puName, `control: after the coating the river should slow x0.5 (got x${pu.afterRatio}, ${pu.afterHits} hits)`);
          else pass(puName, `${run}: at ${pu.m} m; the run's real Chocolate River while coated: 0 HAZARD_HIT, speed x1, speedMul x1; after 5 s: x${pu.afterRatio.toFixed(3)}`);
        }
      }
    }

    // ---- Decisions 1/2: a typed daily seed is PRACTICE (not the Daily best, not the streak); the DAILY RUN
    // item is OFFICIAL. Practice runs first: the browser context shares IndexedDB across pages, so an
    // official run saved earlier would otherwise already sit on today's surfaces.
    {
      const { errors, out } = await dailyOutcome(browser, port, { viaMenu: false });
      const name = 'daily: a typed daily seed is practice (not TODAY\'S BEST, not the streak, labelled DAILY PRACTICE)';
      if (out.fatal) fail(name, out.fatal);
      else if (errors.length) fail(name, `page errors: ${errors.join(' | ')}`);
      else if (out.official) fail(name, 'RunScene marked the typed seed official');
      else if (!out.rec || out.rec.dailyOfficial !== false || out.rec.hashV !== 2) fail(name, `record ${JSON.stringify(out.rec)}`);
      else if (out.statsAfter !== out.statsBefore) fail(name, `getDailyStats attempts ${out.statsBefore} -> ${out.statsAfter}`);
      else if (out.playedTodayAfter !== out.playedTodayBefore || out.streakAfter !== out.streakBefore) fail(name, `streak ${out.streakBefore} -> ${out.streakAfter}`);
      else if (!out.practiceLabel) fail(name, 'Game Over shows no DAILY PRACTICE label');
      else if (out.todaysLine) fail(name, `Game Over shows ${out.todaysLine}`);
      else pass(name, `${out.seed}: dailyOfficial false, Daily attempts ${out.statsAfter}, streak ${out.streakAfter}, "${out.practiceLabel}"`);
    }
    {
      const { errors, out } = await dailyOutcome(browser, port, { viaMenu: true });
      const name = 'daily: the DAILY RUN item is official (counts toward TODAY\'S BEST and the streak)';
      if (out.fatal) fail(name, out.fatal);
      else if (errors.length) fail(name, `page errors: ${errors.join(' | ')}`);
      else if (!out.official) fail(name, 'RunScene did not mark the DAILY RUN item official');
      else if (!out.rec || out.rec.dailyOfficial !== true || out.rec.hashV !== 2) fail(name, `record ${JSON.stringify(out.rec)}`);
      else if (out.statsAfter !== out.statsBefore + 1) fail(name, `getDailyStats attempts ${out.statsBefore} -> ${out.statsAfter}`);
      else if (!out.playedTodayAfter || out.streakAfter < 1) fail(name, `streak ${out.streakAfter}, playedToday ${out.playedTodayAfter}`);
      else if (!out.officialLabel || !out.todaysLine) fail(name, `Game Over label ${out.officialLabel}, line ${out.todaysLine}`);
      else pass(name, `${out.seed}: dailyOfficial true, Daily attempts ${out.statsBefore} -> ${out.statsAfter}, streak ${out.streakAfter}, "${out.todaysLine}"`);

      // Decision 6: the saved v2 record survives export/import, and every tampered copy is rejected.
      const lname = 'ledger v2: a saved run round-trips; tampered score/dailyOfficial/biomeMask, an empty hash and a stripped hashV are rejected';
      const L = out.ledger;
      if (out.fatal || !L) fail(lname, out.fatal || 'no ledger result');
      else if (L.hashV !== 2) fail(lname, `exported hashV ${L.hashV}`);
      else if (L.ok.imported !== 1) fail(lname, `clean import ${JSON.stringify(L.ok)}`);
      else if (L.bad.imported !== 0 || L.bad.skipped !== 4) fail(lname, `tampered import ${JSON.stringify(L.bad)}`);
      else if (L.down.imported !== 0) fail(lname, `hashV-stripped import ${JSON.stringify(L.down)}`);
      else pass(lname, `clean ${JSON.stringify(L.ok)}, tampered ${JSON.stringify(L.bad)}, downgraded ${JSON.stringify(L.down)}`);
    }

    // ---- Decision 4: Head Start is a real opening advantage on the real sled (>= +15 % at 10 s, same seed).
    if (WITH_BOOSTS) {
      const seed = 'hs-1';
      const a = await distanceAt10s(browser, port, false, seed);
      const b = await distanceAt10s(browser, port, true, seed);
      const name = 'Head Start: same seed, >= +15 % distance at 10 s versus clean, and MODDED';
      if (a.out.fatal || b.out.fatal) fail(name, a.out.fatal || b.out.fatal);
      else if (a.errors.length || b.errors.length) fail(name, `page errors: ${[...a.errors, ...b.errors].join(' | ')}`);
      else if (a.out.m10 === null || b.out.m10 === null) fail(name, `no 10 s reading (clean crash ${a.out.crashedAt}, HS crash ${b.out.crashedAt})`);
      else if (a.out.modded || !b.out.modded) fail(name, `modded clean=${a.out.modded} headStart=${b.out.modded}`);
      else {
        const gain = b.out.m10 / a.out.m10 - 1;
        if (gain < 0.15) fail(name, `clean ${a.out.m10.toFixed(1)} m, Head Start ${b.out.m10.toFixed(1)} m: +${(gain * 100).toFixed(1)} %`);
        else pass(name, `${seed}: clean ${a.out.m10.toFixed(1)} m, Head Start ${b.out.m10.toFixed(1)} m at 10 s: +${(gain * 100).toFixed(1)} %`);
      }
    }

    // ---- Decision 3: a real seed@1 run that rides into a Debumont sector (sector 2, from 1000 m; d3gate0 is
    // chosen so sector 2 is Debumont and sector 3 is base terrain) records Debumont ENCOUNTERED through the real
    // RUN_END -> ProgressionService path. The fixture has already encountered Pyramid Peak, so this second
    // biome unlocks Explorer (biomes-2) and its reward trail-hue-aurora; then the real Profile view and
    // Achievements grid show SEEN and 2/2. Lead hand-play: seed d3gate0@1 (Debumont on), ride past 1000 m.
    {
      const name = {
        enc: 'decision 3: a d3gate0@1 run that enters a Debumont sector records it encountered, and Profile labels it DEBUMONT SEEN',
        ach: 'decision 3: the second encountered biome unlocks Explorer (biomes-2) with trail-hue-aurora, and the grid shows 2/2',
      };
      const profile = { ...JSON.parse(JSON.stringify(PROFILE)), biomeMask: 1, biomeProgress: { encountered: ['pyramid-peak'], completed: [] } };
      const { page, errors } = await bootWithProfile(browser, port, profile);
      let out;
      try {
        out = await page.evaluate(async () => {
          const g = window.__bbGame;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          g.scene.start('TitleScene');
          await wait(900);
          const t = g.scene.getScene('TitleScene');
          t.starting = false;
          t.startRun('d3gate0@1');
          let run = null;
          const t0 = Date.now();
          while (Date.now() - t0 < 15000) {
            const rr = g.scene.getScene('RunScene');
            if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) { run = rr; break; }
            await wait(100);
          }
          if (!run) return { fatal: 'RunScene never produced a live sled' };
          const before = (g.registry.get('profile') || {}).biomeProgress;
          const entered = [];
          const onEnter = (p) => { if (p && p.id) entered.push(p.id); };
          g.events.on('bb:biomeEnter', onEnter);
          let visits = null;
          const onEnd = (p) => { visits = p && p.biomeVisits; };
          g.events.on('bb:runEnd', onEnd);
          // Put the real sled 60 m into sector 2 and let the live loop ride it (BIOME_ENTER, furthest distance).
          const s = run.sled;
          const sx = 1060 * 20;
          run.streamTerrain(sx);
          const ang = run.slopeAt(sx);
          s.setPose(sx, run.terrain.heightAt(sx) - 18, ang, Math.cos((ang * Math.PI) / 180) * 400, Math.sin((ang * Math.PI) / 180) * 400);
          const t1 = Date.now();
          while (Date.now() - t1 < 1500 && !entered.includes('debumont')) { s.invulnerableMs = 600000; await wait(50); }
          s.invulnerableMs = 0;
          run.pendingCrash = { cause: 'chasm' };
          let over = false;
          const t2 = Date.now();
          while (Date.now() - t2 < 15000) {
            const go = g.scene.getScene('GameOverScene');
            if (go && go.scene.isActive()) { over = true; break; }
            await wait(100);
          }
          g.events.off('bb:biomeEnter', onEnter);
          g.events.off('bb:runEnd', onEnd);
          if (!over) return { fatal: 'Game Over never became active' };
          const prof = g.registry.get('profile') || {};
          const rec = g.registry.get('lastRecord') || {};
          // The real Profile view and grid, reached from the real Title menu.
          g.scene.start('TitleScene');
          await wait(900);
          const title = g.scene.getScene('TitleScene');
          const idx = title.menu.items.findIndex((i) => String(i.label).toUpperCase() === 'PROFILE');
          title.menu.setSelected(idx);
          title.menu.activate(idx);
          await wait(400);
          const pv = title.view;
          const labels = pv && pv.sigMenu ? pv.sigMenu.items.map((i) => i.label) : [];
          const walk = (list, acc) => { for (const o of list || []) { if (!o) continue; if (typeof o.text === 'string' && o.text) acc.push(o.text); if (o.list) walk(o.list, acc); } return acc; };
          const profTexts = pv && pv.panel ? walk(pv.panel.list, []) : [];
          pv._openAchievements();
          await wait(300);
          const grid = title.view;
          const gridTexts = [];
          for (let i = 0; i < 10 && grid; i++) { walk(grid.panel.list, gridTexts); if (!grid._turn(1)) break; }
          return {
            before, after: prof.biomeProgress, entered, visits, distanceM: rec.distanceM, mask: rec.biomeMask,
            recKeys: Object.keys(rec), ach: prof.achievements || {}, cosmetics: (prof.unlocked || {}).cosmetics || [],
            labels, profTexts, gridTexts,
          };
        }).catch((e) => ({ fatal: String(e) }));
      } finally { await page.close(); }
      if (out.fatal || errors.length) {
        fail(name.enc, out.fatal || `page errors: ${errors.join(' | ')}`);
        fail(name.ach, out.fatal || `page errors: ${errors.join(' | ')}`);
      } else {
        const enc = (out.after && out.after.encountered) || [];
        if (out.mask !== 1 || !(out.distanceM >= 1000)) fail(name.enc, `record mask ${out.mask}, distance ${out.distanceM} m (want mask 1, >= 1000 m)`);
        else if (!out.entered.includes('debumont')) fail(name.enc, `the live run never announced Debumont (BIOME_ENTER ${out.entered})`);
        else if (!out.visits || !out.visits.encountered.includes('debumont')) fail(name.enc, `RUN_END.biomeVisits ${JSON.stringify(out.visits)}`);
        else if (out.recKeys.includes('biomeVisits')) fail(name.enc, 'biomeVisits leaked into the RunRecord');
        else if (!enc.includes('debumont') || !enc.includes('pyramid-peak')) fail(name.enc, `profile biomeProgress ${JSON.stringify(out.before)} -> ${JSON.stringify(out.after)}`);
        else if (!out.labels.includes('DEBUMONT SEEN')) fail(name.enc, `Profile toggle labels ${JSON.stringify(out.labels)}`);
        else if (!out.profTexts.includes('BIOMES SEEN 2/11 DONE 0/11')) fail(name.enc, `Profile summary missing (${out.profTexts.filter((x) => /BIOMES/.test(x))})`);
        else pass(name.enc, `${out.distanceM} m at mask 1: BIOME_ENTER debumont, biomeVisits ${JSON.stringify(out.visits)}, profile ${JSON.stringify(out.before)} -> ${JSON.stringify(out.after)}, label DEBUMONT SEEN`);
        if (!Number.isFinite(out.ach['biomes-2'])) fail(name.ach, `biomes-2 not unlocked (achievements ${Object.keys(out.ach)})`);
        else if (!out.cosmetics.includes('trail-hue-aurora')) fail(name.ach, `trail-hue-aurora not granted (${out.cosmetics})`);
        else if (Number.isFinite(out.ach['biomes-5'])) fail(name.ach, 'biomes-5 unlocked with only 2 biomes');
        else if (!out.gridTexts.includes('2/2') || !out.gridTexts.includes('2/5') || !out.gridTexts.includes('2/11')) fail(name.ach, `grid biome progress missing (has 2/2 ${out.gridTexts.includes('2/2')}, 2/5 ${out.gridTexts.includes('2/5')}, 2/11 ${out.gridTexts.includes('2/11')})`);
        else pass(name.ach, 'biomes-2 stamped, trail-hue-aurora owned, biomes-5 still locked; grid 2/2, 2/5, 2/11');
      }
    }

    // ---- B2 (biome full treatment, "Sight"): per biome, a real seed@<bit> run of the built game, like B1. The blind
    // hazard's real entity goes through the shipped onHazard and the live frame loop (run.update -> tickEffects ->
    // updateBlindOverlay): the overlay's on-screen opacity (fillAlpha x alpha) is sampled every frame, so the check sees
    // when it comes up, how dark it gets and when it clears. The Goggles are checked against the run's real Shatter Wall and
    // a real base Garbage Data Vent (scramble); the Heat Shield against a real crash hazard resolved by the frame loop.
    {
      const B2 = [
        { biome: 'crystal-cavern', name: 'Crystal Cavern', seed: 'b2crystal13', mask: 16, hazard: 'shatterWall', powerup: 'crystalClearGoggles' },
        { biome: 'vertigo-vents', name: 'Vertigo Vents', seed: 'b2vertigo56', mask: 1024, hazard: 'ashCloud', powerup: 'heatShield' },
      ];
      for (const B of B2) {
        const hzName = `B2 ${B.name}: ${B.hazard} spawns on ${B.seed}@${B.mask} and blinds the real run (overlay up, timed, no crash)`;
        const puName = B.powerup === 'crystalClearGoggles'
          ? `B2 ${B.name}: ${B.powerup} spawns on ${B.seed}@${B.mask} and wards both blind and scramble on the real run`
          : `B2 ${B.name}: ${B.powerup} spawns on ${B.seed}@${B.mask} and its shield negates a real crash (own chip)`;
        const c = await (async () => {
          const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
          try {
            const out = await page.evaluate(async (B) => {
              const g = window.__bbGame;
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              g.scene.start('TitleScene');
              const t0 = Date.now();
              let run = null;
              let started = false;
              while (Date.now() - t0 < 15000) {
                const tt = g.scene.getScene('TitleScene');
                if (!started && tt && !tt.starting) { started = true; tt.startRun(`${B.seed}@${B.mask}`); }
                const rr = g.scene.getScene('RunScene');
                if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) { run = rr; break; }
                await wait(100);
              }
              if (!run) return { fatal: 'RunScene never produced a live sled' };
              await wait(300);
              if (run.sled.destroyed || !run.sled.inWorld || run.crashed) return { fatal: 'sled died before the probe' };
              run.scene.pause();
              const res = { seed: run.seed, mask: run.biomeMask };
              let clock = run.runTimeMs;
              const step = (n) => { for (let i = 0; i < n; i++) { clock += 16; run.update(clock, 16); } };
              const keepAlive = () => { run.sled.invulnerableMs = 1e9; run.pendingCrash = null; };
              const live = () => { run.sled.invulnerableMs = 0; run.pendingCrash = null; };
              const opacity = () => (run.blindRect && run.blindRect.visible ? run.blindRect.fillAlpha * run.blindRect.alpha : null);
              const hits = [];
              const crashes = [];
              const expired = [];
              const onHit = (p) => hits.push(p);
              const onCrash = (p) => crashes.push(p);
              const onExp = (p) => expired.push(p);
              g.events.on('bb:hazardHit', onHit);
              g.events.on('bb:crash', onCrash);
              g.events.on('bb:powerupExpired', onExp);
              const ui = g.scene.getScene('UIScene');
              const find = (id, list, from = 0) => {
                for (let i = from; i < 200; i++) {
                  const ch = run.terrain.getChunk(i);
                  const sp = ch[list].find((s) => s.defId === id);
                  if (sp) return { ch, sp };
                }
                return null;
              };
              const taken = [];
              const entity = (f, map) => {
                if (!f) return null;
                if (!run.mesh.chunks.has(f.ch.index)) { run.takeChunk(f.ch); taken.push(f.ch.index); }
                return (run[map].get(f.ch.index) || []).find((e) => e.def.id === f.sp.defId && e.spawn.x === f.sp.x) || null;
              };
              /** Hit `h` live, then run frames; returns the per-frame overlay opacity trace (ms -> opacity). */
              const blindTrace = (h, frames) => {
                live();
                h.hit = false;
                run.onHazard(h);
                const crashedByHit = !!run.pendingCrash;
                // the HUD warning right after the hit (EFFECT_END removes it when the blind ends)
                const label = ui && ui.effects && ui.effects.get('blind') ? (ui.effects.get('blind').label || 'BLINDED') : null;
                keepAlive();
                const trace = [];
                for (let i = 1; i <= frames; i++) { step(1); trace.push([i * 16, opacity()]); }
                return { crashedByHit, trace, label };
              };
              try {
                keepAlive();
                run._resetBiomeEffects();
                step(2);
                // ---- hazard: the blind
                const fh = find(B.hazard, 'hazards');
                const h = entity(fh, 'hazards');
                if (!h) res.hz = { fatal: `no ${B.hazard} in the first 200 chunks of ${B.seed}@${B.mask}` };
                else {
                  res.hz = { m: Math.round(fh.sp.x / 20), chunkBiome: fh.ch.biome, drawKind: h.drawKind, shapeKey: h.def.shapeKey, notDanger: h.color !== run.palette.danger };
                  hits.length = 0;
                  const before = opacity();
                  const { crashedByHit, trace, label } = blindTrace(h, 100);
                  const up = trace.find(([, o]) => o > 0);
                  const peak = Math.max(...trace.map(([, o]) => o || 0));
                  const clear = trace.find(([t, o]) => t > 200 && o === 0);
                  res.hz = { ...res.hz, before, crashedByHit, crashed: run.crashed, inWorld: run.sled.inWorld, hitEvents: hits.map((p) => `${p.hazardId}:${p.effect}:${p.durationMs}`),
                    label, upMs: up ? up[0] : null, peak, at600: trace[37][1], clearMs: clear ? clear[0] : null, end: trace[trace.length - 1][1] };
                }
                // ---- power-up
                run._resetBiomeEffects();
                keepAlive();
                step(2);
                const fp = find(B.powerup, 'powerups');
                const p = entity(fp, 'powerups');
                if (!p) res.pu = { fatal: `no ${B.powerup} in the first 200 chunks of ${B.seed}@${B.mask}` };
                else if (B.powerup === 'crystalClearGoggles') {
                  res.pu = { m: Math.round(fp.sp.x / 20), chunkBiome: fp.ch.biome, drawKind: p.drawKind, shapeKey: p.def.shapeKey };
                  const vent = entity(find('garbageDataVent', 'hazards'), 'hazards');
                  if (!h || !vent) res.pu.fatal = `need the run's real ${B.hazard} and a Garbage Data Vent (got ${!!h}, ${!!vent})`;
                  else {
                    // (a) a blind and a scramble already acting stop when the Goggles are taken
                    live(); h.hit = false; run.onHazard(h); live(); vent.hit = false; run.onHazard(vent); keepAlive();
                    step(10);
                    res.pu.preOpacity = opacity();
                    res.pu.preScrambled = run.sled.scrambled;
                    res.pu.preTilt = run.currentPhys.tiltSign;
                    run.onPowerUp(p);
                    res.pu.chip = !!(ui && ui.powerups && ui.powerups.has(B.powerup));
                    step(2);
                    res.pu.cutOpacity = opacity();
                    res.pu.cutScrambled = run.sled.scrambled;
                    res.pu.cutTilt = run.currentPhys.tiltSign;
                    // (b) new hits while the Goggles run do nothing
                    run.blindMs = 0; run.scrambleMs = 0;
                    hits.length = 0;
                    const t1 = blindTrace(h, 20);
                    live(); vent.hit = false; run.onHazard(vent); keepAlive();
                    step(4);
                    res.pu.wardHits = hits.length;
                    res.pu.wardPeak = Math.max(...t1.trace.map(([, o]) => o || 0));
                    res.pu.wardScrambled = run.sled.scrambled;
                    res.pu.wardTilt = run.currentPhys.tiltSign;
                    res.pu.wardMs = run.wards.wards.length ? Math.round(run.wards.wards[0].msLeft) : 0;
                    // (c) after 6 s the Goggles expire and blind acts again (control)
                    run.tickEffects(6100);
                    step(1);
                    res.pu.expired = expired.filter((e) => e.id === B.powerup).map((e) => e.reason);
                    hits.length = 0;
                    const t2 = blindTrace(h, 37);
                    res.pu.afterHits = hits.length;
                    res.pu.afterOpacity = t2.trace[t2.trace.length - 1][1];
                    run.tickEffects(3000);
                    step(1);
                  }
                } else {
                  res.pu = { m: Math.round(fp.sp.x / 20), chunkBiome: fp.ch.biome, drawKind: p.drawKind, shapeKey: p.def.shapeKey };
                  const fs0 = find('packetSpike', 'hazards');
                  const spike = entity(fs0, 'hazards');
                  if (!spike) res.pu.fatal = 'no Packet Spike to crash into';
                  else {
                    const q0 = run.shieldCharges;
                    run.onPowerUp(p);
                    const chip = ui && ui.powerups ? ui.powerups.get('heatShield') : null;
                    res.pu.chip = !!chip;
                    res.pu.chipCharges = chip ? chip.charges : null;
                    res.pu.charges = run.shieldCharges - q0;
                    res.pu.sledShield = run.sled.shield;
                    crashes.length = 0;
                    expired.length = 0;
                    live();
                    spike.hit = false;
                    run.onHazard(spike);
                    res.pu.queued = run.pendingCrash ? run.pendingCrash.hazardId : null;
                    step(1); // the frame loop resolves the queued crash (RunScene.resolveCrash)
                    keepAlive();
                    res.pu.crashed = run.crashed;
                    res.pu.inWorld = run.sled.inWorld;
                    res.pu.crashEvents = crashes.map((e) => `${e.hazardId}:${e.negated ? 'negated' : 'real'}`);
                    res.pu.expired = expired.map((e) => `${e.id}:${e.reason}`);
                    res.pu.chipAfter = !!(ui && ui.powerups && ui.powerups.has('heatShield'));
                    res.pu.chargesAfter = run.shieldCharges - q0;
                  }
                }
              } catch (e) { res.fatal = String(e && e.stack || e); }
              g.events.off('bb:hazardHit', onHit);
              g.events.off('bb:crash', onCrash);
              g.events.off('bb:powerupExpired', onExp);
              for (const idx of taken) run.dropChunk(idx);
              run._resetBiomeEffects();
              return res;
            }, B).catch((e) => ({ fatal: String(e) }));
            return { errors, out };
          } finally { await page.close(); }
        })();
        const o = c.out;
        if (o.fatal || c.errors.length) {
          fail(hzName, o.fatal || `page errors: ${c.errors.join(' | ')}`);
          fail(puName, o.fatal || `page errors: ${c.errors.join(' | ')}`);
          continue;
        }
        const run = `run ${o.seed}@${o.mask}`;
        const hz = o.hz;
        const hd = HAZ_DEFS[B.hazard];
        const want = 1 - hd.onHit.visibility;
        const dur = hd.onHit.durationMs;
        if (o.seed !== B.seed || o.mask !== B.mask) fail(hzName, `the run is ${run}, not ${B.seed}@${B.mask}`);
        else if (hz.fatal) fail(hzName, hz.fatal);
        else if (hz.chunkBiome !== B.biome) fail(hzName, `spawned in a ${hz.chunkBiome} chunk`);
        else if (hz.drawKind !== hz.shapeKey || !hz.notDanger) fail(hzName, `entity draws '${hz.drawKind}' (own '${hz.shapeKey}'), notDanger ${hz.notDanger}`);
        else if (hz.crashedByHit || hz.crashed || !hz.inWorld) fail(hzName, `blind crashed the run (hit ${hz.crashedByHit}, crashed ${hz.crashed}, inWorld ${hz.inWorld})`);
        else if (hz.hitEvents.join() !== `${B.hazard}:blind:${dur}`) fail(hzName, `HAZARD_HIT ${hz.hitEvents}`);
        else if (hz.before !== 0) fail(hzName, `overlay was already up (${hz.before})`);
        else if (!(hz.upMs <= 32)) fail(hzName, `overlay not up within 2 frames (first at ${hz.upMs} ms)`);
        else if (!(Math.abs(hz.at600 - want) <= 1e-6) || hz.peak > 0.65 + 1e-9) fail(hzName, `opacity at 600 ms ${hz.at600} (want ${want}), peak ${hz.peak} (max 0.65)`);
        else if (!(hz.clearMs >= dur && hz.clearMs <= dur + 32) || hz.end !== 0) fail(hzName, `overlay cleared at ${hz.clearMs} ms (want ${dur}-${dur + 32}), end ${hz.end}`);
        else if (hz.label !== { shatterWall: 'SHATTER WALL', ashCloud: 'ASH CLOUD' }[B.hazard]) fail(hzName, `HUD warning label ${hz.label}`);
        else pass(hzName, `${run}: at ${hz.m} m; overlay up at ${hz.upMs} ms, opacity ${hz.at600.toFixed(3)} at 600 ms (visibility ${hd.onHit.visibility}), clear at ${hz.clearMs} ms; no crash; HUD "${hz.label}"`);

        const pu = o.pu;
        if (pu.fatal) fail(puName, pu.fatal);
        else if (pu.chunkBiome !== B.biome) fail(puName, `spawned in a ${pu.chunkBiome} chunk`);
        else if (pu.drawKind !== pu.shapeKey) fail(puName, `entity draws '${pu.drawKind}', not its own '${pu.shapeKey}'`);
        else if (!pu.chip) fail(puName, 'no HUD chip for the pickup');
        else if (B.powerup === 'crystalClearGoggles') {
          if (!(pu.preOpacity > 0.3) || pu.preScrambled !== true || pu.preTilt !== -1) fail(puName, `control: blind ${pu.preOpacity} / scramble ${pu.preScrambled} tilt ${pu.preTilt} did not act before the Goggles`);
          else if (pu.cutOpacity !== 0 || pu.cutScrambled !== false || pu.cutTilt !== 1) fail(puName, `active effects not stopped: opacity ${pu.cutOpacity}, scrambled ${pu.cutScrambled}, tilt ${pu.cutTilt}`);
          else if (pu.wardHits !== 0 || pu.wardPeak !== 0 || pu.wardScrambled !== false || pu.wardTilt !== 1) fail(puName, `hits while warded: ${pu.wardHits} HAZARD_HIT, overlay peak ${pu.wardPeak}, scrambled ${pu.wardScrambled}, tilt ${pu.wardTilt}`);
          else if (pu.expired.join() !== 'timeout' || pu.afterHits !== 1 || !(pu.afterOpacity > 0.3)) fail(puName, `after 6 s: expired ${pu.expired}, ${pu.afterHits} hits, opacity ${pu.afterOpacity}`);
          else pass(puName, `${run}: at ${pu.m} m; active blind ${pu.preOpacity.toFixed(2)} + scramble cut to 0 / tilt 1; warded hits: 0 HAZARD_HIT, overlay 0, not scrambled (${pu.wardMs} ms left); after 6 s blind acts again (${pu.afterOpacity.toFixed(2)})`);
        } else if (pu.charges !== 1 || !pu.sledShield || pu.chipCharges !== 1) fail(puName, `pickup gave ${pu.charges} charges, sled.shield ${pu.sledShield}, chip x${pu.chipCharges}`);
        else if (pu.queued !== 'packetSpike') fail(puName, `the spike queued no crash (${pu.queued})`);
        else if (pu.crashed || !pu.inWorld || pu.crashEvents.join() !== 'packetSpike:negated') fail(puName, `crash not negated: crashed ${pu.crashed}, CRASH ${pu.crashEvents}`);
        else if (pu.expired.join() !== 'heatShield:consumed' || pu.chipAfter || pu.chargesAfter !== 0) fail(puName, `expired ${pu.expired}, chip left ${pu.chipAfter}, charges ${pu.chargesAfter}`);
        else pass(puName, `${run}: at ${pu.m} m; +1 charge (chip x1), the run's real Packet Spike: CRASH negated, heatShield chip expired (consumed), 0 charges left`);
      }
    }

    // ---- B3 (biome full treatment, "Motion"): per biome, a real seed@<bit> run of the built game. The moving hazard's real
    // entity is driven by the live frame loop (run.update -> renderFrame -> Hazard.update -> HazardMotion) with the real
    // sled riding toward it: a roll must wait, start while on screen, roll toward the sled at its speed along the ground
    // (heightAt), and crash the sled on real contact; a gate must open and close on its seeded cycle, be passed while
    // open and crash while closed. Each glide is measured on the real sled: same seed, same pose, same frames, with and
    // without it. The Clockwork Treads are measured against a real Steampunk conveyor zone of the run.
    {
      const B3 = [
        { biome: 'pyramid-peak', name: 'Pyramid Peak', seed: 'b3pyramid54', mask: 4, hazard: 'rollingBoulder', powerup: 'sandrunnerSkis' },
        { biome: 'steampunk-slopes', name: 'Steampunk Slopes', seed: 'b3steam63', mask: 256, hazard: 'gearGate', powerup: 'clockworkTreads' },
        { biome: 'micro-mountain', name: 'Micro Mountain', seed: 'b3micro26', mask: 512, hazard: 'dewDrop', powerup: 'royalJellyWax' },
      ];
      const { ROLL_ACTIVATE_PX, gateTiming, rollParams, rollOffsetAt } = await import(path.join(ROOT, 'src/systems/HazardMotion.js'));
      const { glideDrag, glideFrictionMul } = await import(path.join(ROOT, 'src/systems/BiomeEffects.js'));
      // B3 tuning (Marvin 2026-11-15, "make it felt"): after 2 s on the same seed and pose a glide must be this much faster
      // and further than the same ride without it. A friction-only glide measured +17 px/s / +15 px (Royal Jelly Wax); the shipped one +31.8 / +28.1 (5 of 5 runs identical).
      const GLIDE_FELT_PX_S = 25;
      const GLIDE_FELT_PX = 25;
      for (const B of B3) {
        const hd = HAZ_DEFS[B.hazard];
        const hzName = hd.motion.kind === 'roll'
          ? `B3 ${B.name}: ${B.hazard} spawns on ${B.seed}@${B.mask}, starts on screen, rolls downhill away from the real sled along the ground (under its cap), and the sled catches it and crashes on contact`
          : `B3 ${B.name}: ${B.hazard} spawns on ${B.seed}@${B.mask}, opens and closes on its seeded cycle, is passed open and crashes closed`;
        const puName = B.powerup === 'clockworkTreads'
          ? `B3 ${B.name}: ${B.powerup} spawns on ${B.seed}@${B.mask} and wards off the run's real conveyor push on the real sled`
          : `B3 ${B.name}: ${B.powerup} spawns on ${B.seed}@${B.mask} and its glide is felt on the real sled (>= 25 px/s faster and >= 25 px further after 2 s, same seed and pose)`;
        const c = await (async () => {
          const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
          try {
            const out = await page.evaluate(async ({ B, ACT, motion, gt }) => {
              const g = window.__bbGame;
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              g.scene.start('TitleScene');
              const t0 = Date.now();
              let run = null;
              let started = false;
              while (Date.now() - t0 < 15000) {
                const tt = g.scene.getScene('TitleScene');
                if (!started && tt && !tt.starting) { started = true; tt.startRun(`${B.seed}@${B.mask}`); }
                const rr = g.scene.getScene('RunScene');
                if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) { run = rr; break; }
                await wait(100);
              }
              if (!run) return { fatal: 'RunScene never produced a live sled' };
              await wait(300);
              if (run.sled.destroyed || !run.sled.inWorld || run.crashed) return { fatal: 'sled died before the probe' };
              run.scene.pause();
              const res = { seed: run.seed, mask: run.biomeMask };
              let clock = run.runTimeMs;
              const step = (n) => { for (let i = 0; i < n; i++) { clock += 16; run.update(clock, 16); } };
              const keepAlive = () => { run.sled.invulnerableMs = 1e9; run.pendingCrash = null; };
              const live = () => { run.sled.invulnerableMs = 0; run.pendingCrash = null; };
              const hits = [];
              const onHit = (p) => hits.push({ ...p, t: run.runTimeMs });
              g.events.on('bb:hazardHit', onHit);
              const ui = g.scene.getScene('UIScene');
              const find = (id, list) => {
                for (let i = 0; i < 200; i++) {
                  const ch = run.terrain.getChunk(i);
                  const sp = ch[list].find((s) => s.defId === id);
                  if (sp) return { ch, sp };
                }
                return null;
              };
              const taken = [];
              const entity = (f, map) => {
                if (!f) return null;
                if (!run.mesh.chunks.has(f.ch.index)) { run.takeChunk(f.ch); taken.push(f.ch.index); }
                return (run[map].get(f.ch.index) || []).find((e) => e.def.id === f.sp.defId && e.spawn.x === f.sp.x) || null;
              };
              /** Put the real sled on the ground at x, moving along the slope at v px/s. */
              const poseAt = (x, v) => {
                run.streamTerrain(x);
                const ang = run.slopeAt(x);
                run.sled.setPose(x, run.terrain.heightAt(x) - 18, ang, Math.cos((ang * Math.PI) / 180) * v, Math.sin((ang * Math.PI) / 180) * v);
                if (run.snapCamera) run.snapCamera(); // the camera follows a teleported sled at once, as it does a respawn
              };
              try {
                keepAlive();
                run._resetBiomeEffects();
                step(2);
                // ---- power-up first (the hazard check ends in a real crash)
                keepAlive();
                run._resetBiomeEffects();
                const fp = find(B.powerup, 'powerups');
                const p = entity(fp, 'powerups');
                if (!p) res.pu = { fatal: `no ${B.powerup} in the first 200 chunks of ${B.seed}@${B.mask}` };
                else if (B.powerup === 'clockworkTreads') {
                  res.pu = { m: Math.round(fp.sp.x / 20), chunkBiome: fp.ch.biome, drawKind: p.drawKind };
                  let zc = null;
                  let zone = null;
                  for (let i = 0; i < 200 && !zone; i++) {
                    const ch = run.terrain.getChunk(i);
                    const z = ch.biome === B.biome && ch.zones.find((q) => q.modId === 'conveyorBelt' && q.x1 - q.x0 >= 300);
                    if (z) { zc = ch; zone = z; }
                  }
                  if (!zone) res.pu.fatal = 'no conveyor zone in a Steampunk chunk';
                  else {
                    if (!run.mesh.chunks.has(zc.index)) { run.takeChunk(zc); taken.push(zc.index); }
                    const ride = (treads) => {
                      run._resetBiomeEffects();
                      keepAlive();
                      poseAt(zone.x0 + 30, 260);
                      if (treads) run.onPowerUp(p);
                      step(1);
                      const drive = run.currentPhys.beltDrivePxS2;
                      const v0 = run.sled.vx;
                      for (let i = 0; i < 20; i++) { keepAlive(); step(1); }
                      return { drive, dv: run.sled.vx - v0, chip: !!(ui && ui.powerups && ui.powerups.has(B.powerup)) };
                    };
                    res.pu.belt = ride(false);
                    res.pu.ward = ride(true);
                    res.pu.zoneM = Math.round(zone.x0 / 20);
                  }
                } else {
                  res.pu = { m: Math.round(fp.sp.x / 20), chunkBiome: fp.ch.biome, drawKind: p.drawKind };
                  const sx = fp.sp.x - 900;
                  // B3 tuning: 2 s rides with nothing else acting on the sled (no other pickup or hazard; the base ride
                  // cannot collect this glide on the way), so the difference is the glide alone
                  const onPU = run.onPowerUp;
                  const onHz = run.onHazard;
                  // both arms start from the same state: same run time, no hit-stop, slow-mo or landing boost left over
                  // (on v2.10.0 the base arm depended on the run time at the pause: hit-stop / boost from the boot)
                  const T0 = Math.ceil((clock + 60000) / 1000) * 1000;
                  const ride = (glide) => {
                    run._resetBiomeEffects();
                    keepAlive();
                    run.runTimeMs = T0;
                    clock = T0;
                    run.hitStopMs = 0;
                    run.slowmoMs = 0;
                    run.boostMs = 0;
                    run.sled.boostMs = 0;
                    poseAt(sx, 420);
                    p.collected = false;
                    if (glide) run.onPowerUp(p);
                    p.collected = true;
                    run.onPowerUp = () => {};
                    run.onHazard = () => {};
                    const x0 = run.sled.x;
                    step(1);
                    const ph = run.currentPhys;
                    const r = { resist: ph.groundResist, speedMul: ph.speedMul, quadDrag: ph.quadDrag, chip: !!(ui && ui.powerups && ui.powerups.has(B.powerup)) };
                    let grounded = 0;
                    for (let i = 2; i <= 125; i++) {
                      keepAlive(); step(1); if (run.sled.grounded) grounded++;
                      if (i === 62) r.at1 = { v: run.sled.speed, dx: run.sled.x - x0 };
                    }
                    run.onPowerUp = onPU;
                    run.onHazard = onHz;
                    return { ...r, speed: run.sled.speed, dx: run.sled.x - x0, x: run.sled.x, grounded };
                  };
                  res.pu.base = ride(false);
                  res.pu.glide = ride(true);
                }
                run._resetBiomeEffects();
                keepAlive();
                step(2);
                // ---- hazard
                const fh = find(B.hazard, 'hazards');
                const h = entity(fh, 'hazards');
                if (!h) res.hz = { fatal: `no ${B.hazard} in the first 200 chunks of ${B.seed}@${B.mask}` };
                else if (motion.kind === 'roll') {
                  res.hz = { m: Math.round(fh.sp.x / 20), chunkBiome: fh.ch.biome, drawKind: h.drawKind, danger: h.color === run.palette.danger };
                  const x0 = h.x0;
                  const cx0 = h.cx;
                  // B3 tuning: only this hazard can hit (the downhill placement can put a base hazard on the approach)
                  const onHzAll = run.onHazard;
                  run.onHazard = (q) => { if (q === h) onHzAll.call(run, q); };
                  poseAt(x0 - ACT - 260, 320);
                  let actT = null;
                  let actSledGap = null;
                  let actOnScreen = null;
                  let movedEarly = 0;
                  let groundErr = 0;
                  let at500 = null;
                  let liveFrom = null;
                  let maxV = 0;
                  let minV = Infinity;
                  let lastX = h.gfx.x;
                  hits.length = 0;
                  for (let i = 0; i < 400; i++) {
                    if (liveFrom === null) keepAlive();
                    step(1);
                    if (h.destroyed) break;
                    const fv = (h.gfx.x - lastX) / 0.016;
                    lastX = h.gfx.x;
                    if (h.roll.activeAtMs !== null && h.rolling) { maxV = Math.max(maxV, fv); minV = Math.min(minV, fv); }
                    groundErr = Math.max(groundErr, Math.abs(h.gfx.y - run.terrain.heightAt(h.gfx.x)));
                    if (h.roll.activeAtMs === null) { if (h.cx !== cx0) movedEarly++; continue; }
                    if (actT === null) {
                      actT = h.roll.activeAtMs;
                      actSledGap = x0 - run.sled.x;
                      const v = run._view;
                      actOnScreen = h.cx > v.left && h.cx < v.right;
                    }
                    if (at500 === null && run.runTimeMs - actT >= 300) at500 = { dt: run.runTimeMs - actT, dx: h.gfx.x - x0 };
                    // live once it has been seen rolling for 0.3 s (the sled is still well short of it)
                    if (liveFrom === null && run.runTimeMs - actT >= 300) { live(); liveFrom = run.runTimeMs; res.hz.gapAtLive = Math.round(h.cx - run.sled.x); }
                    if (hits.length || run.crashed || run.pendingCrash) break;
                    if (run.sled.x > h.cx + 120) break;
                  }
                  run.onHazard = onHzAll;
                  res.hz = { ...res.hz, movedEarly, actT, actSledGap, actOnScreen, at500, groundErr, maxV, minV, hitEvents: hits.map((p) => `${p.hazardId}:${p.effect}`),
                    queued: run.pendingCrash ? run.pendingCrash.hazardId : null, crashed: run.crashed, sledX: Math.round(run.sled.x), hcx: Math.round(h.cx), speed: Math.round(run.sled.speed) };
                } else {
                  res.hz = { m: Math.round(fh.sp.x / 20), chunkBiome: fh.ch.biome, drawKind: h.drawKind, danger: h.color === run.palette.danger, phase: h.phase };
                  // the cycle: 3 s of frames, the sled held still on the ground 800 px before the gate (it cannot crash or
                  // reach anything while the cycle and the forced hits are sampled)
                  const hold = () => { keepAlive(); poseAt(h.x0 - 800, 0); };
                  let flips = 0;
                  let closedRun = 0;
                  let worstClosed = 0;
                  let mismatch = 0;
                  let last = null;
                  let openFrames = 0;
                  for (let i = 0; i < 190; i++) {
                    hold();
                    step(1);
                    if (h.open !== h.isPassable(run.runTimeMs)) mismatch++;
                    if (last !== null && h.open !== last) flips++;
                    last = h.open;
                    if (h.open) { openFrames++; closedRun = 0; } else { closedRun += 16; worstClosed = Math.max(worstClosed, closedRun); }
                  }
                  res.hz = { ...res.hz, flips, worstClosed, mismatch, openShare: openFrames / 190 };
                  // forced: onHazard while open (passed, stays armed), then while closed (crash queued)
                  let k = 0;
                  while (!h.open && k++ < 200) { hold(); step(1); }
                  live(); h.hit = false; hits.length = 0;
                  run.onHazard(h);
                  res.hz.openHit = { hits: hits.length, armed: !h.hit, queued: run.pendingCrash ? run.pendingCrash.hazardId : null };
                  k = 0;
                  while (h.open && k++ < 200) { hold(); step(1); }
                  live(); h.hit = false; hits.length = 0;
                  run.onHazard(h);
                  res.hz.closedHit = { hits: hits.map((p) => `${p.hazardId}:${p.effect}`), queued: run.pendingCrash ? run.pendingCrash.hazardId : null,
                    open: h.open, passable: h.isPassable(run.runTimeMs), crashed: run.crashed, inv: run.sled.invulnerableMs, t: run.runTimeMs, k };
                  keepAlive();
                  h.hit = false;
                  // a real ride through the gate: whatever the state at contact, the outcome must match it
                  poseAt(h.x0 - 280, 340);
                  live();
                  hits.length = 0;
                  let passed = false;
                  for (let i = 0; i < 200; i++) {
                    step(1);
                    if (hits.length || run.crashed || run.pendingCrash) break;
                    if (run.sled.x > h.cx + 60) { passed = true; break; }
                  }
                  const hit = hits[0];
                  res.hz.ride = { passed, hit: hit ? `${hit.hazardId}:${hit.effect}` : null, openAtHit: hit ? h.isPassable(hit.t) : null, crashed: run.crashed || !!run.pendingCrash, cross: Math.round(run.sled.x - h.cx) };
                }
              } catch (e) { res.fatal = String(e && e.stack || e); }
              g.events.off('bb:hazardHit', onHit);
              for (const idx of taken) run.dropChunk(idx);
              run._resetBiomeEffects();
              return res;
            }, { B, ACT: ROLL_ACTIVATE_PX, motion: hd.motion, gt: gateTiming(hd.motion) }).catch((e) => ({ fatal: String(e) }));
            return { errors, out };
          } finally { await page.close(); }
        })();
        const o = c.out;
        if (o.fatal || c.errors.length) {
          fail(hzName, o.fatal || `page errors: ${c.errors.join(' | ')}`);
          fail(puName, o.fatal || `page errors: ${c.errors.join(' | ')}`);
          continue;
        }
        const run = `run ${o.seed}@${o.mask}`;
        const hz = o.hz;
        if (o.seed !== B.seed || o.mask !== B.mask) fail(hzName, `the run is ${run}, not ${B.seed}@${B.mask}`);
        else if (hz.fatal) fail(hzName, hz.fatal);
        else if (hz.chunkBiome !== B.biome) fail(hzName, `spawned in a ${hz.chunkBiome} chunk`);
        else if (hz.drawKind !== hd.shapeKey || !hz.danger) fail(hzName, `entity draws '${hz.drawKind}', danger ${hz.danger}`);
        else if (hd.motion.kind === 'roll') {
          // B3 tuning: downhill (+x), from rest, at a slope-following speed between the flat-ground floor and the cap
          const cap = rollParams(hd.motion).speedPxS;
          const dt500 = hz.at500 ? hz.at500.dt : 300;
          const lo500 = rollOffsetAt(hd.motion, dt500, () => 0, 0);
          const hi500 = rollOffsetAt(hd.motion, dt500, () => 90, 0);
          if (hz.movedEarly) fail(hzName, `moved ${hz.movedEarly} frames before the sled reached the activation line`);
          else if (hz.actT === null) fail(hzName, 'never started rolling');
          else if (!hz.actOnScreen || hz.actSledGap > ROLL_ACTIVATE_PX + 1 || hz.actSledGap < ROLL_ACTIVATE_PX - 20) fail(hzName, `started with the sled ${hz.actSledGap} px away (want ~${ROLL_ACTIVATE_PX}), on screen ${hz.actOnScreen}`);
          else if (!hz.at500 || !(hz.at500.dx >= lo500 - 0.5 && hz.at500.dx <= hi500 + 0.5)) fail(hzName, `rolled ${hz.at500 && hz.at500.dx} px in ${dt500} ms (want downhill, +${lo500.toFixed(1)}..+${hi500.toFixed(1)} px)`);
          else if (!(hz.maxV <= cap + 0.5) || !(hz.minV >= -0.5)) fail(hzName, `speed ${hz.minV.toFixed(1)}..${hz.maxV.toFixed(1)} px/s while rolling (want 0..${cap}, never back toward the sled)`);
          else if (!(hz.groundErr < 0.01)) fail(hzName, `left the ground: |y - heightAt| up to ${hz.groundErr}`);
          else if (hz.hitEvents.join() !== `${B.hazard}:crash` || !(hz.queued === B.hazard || hz.crashed)) fail(hzName, `no real crash on contact: HAZARD_HIT ${hz.hitEvents}, queued ${hz.queued}, sled x ${hz.sledX} vs hazard ${hz.hcx}, speed ${hz.speed}`);
          else pass(hzName, `${run}: at ${hz.m} m; still until the sled was ${hz.actSledGap} px away (on screen), then +${hz.at500.dx.toFixed(1)} px downhill in ${hz.at500.dt} ms (${lo500.toFixed(1)}..${hi500.toFixed(1)}), top ${hz.maxV.toFixed(1)} px/s (cap ${cap}) on the ground (max |y - heightAt| ${hz.groundErr.toExponential(1)}); live at ${hz.gapAtLive} px, the real sled hit it: ${hz.hitEvents}, run crashed ${hz.crashed}`);
        } else {
          const gt = gateTiming(hd.motion);
          const r = hz.ride;
          const rideOk = r && ((r.passed && !r.hit && !r.crashed) || (r.hit === `${B.hazard}:crash` && r.openAtHit === false));
          if (hz.mismatch) fail(hzName, `open flag disagreed with isPassable on ${hz.mismatch} frames`);
          else if (hz.flips < 3 || hz.worstClosed > gt.closedMs + 16 || Math.abs(hz.openShare - gt.openMs / gt.periodMs) > 0.1) fail(hzName, `cycle: ${hz.flips} flips, worst closed ${hz.worstClosed} ms (max ${gt.closedMs}), open share ${hz.openShare.toFixed(2)}`);
          else if (hz.openHit.hits || !hz.openHit.armed || hz.openHit.queued) fail(hzName, `open gate was hit: ${JSON.stringify(hz.openHit)}`);
          else if (hz.closedHit.hits.join() !== `${B.hazard}:crash` || hz.closedHit.queued !== B.hazard) fail(hzName, `closed gate did not crash: ${JSON.stringify(hz.closedHit)}`);
          else if (!rideOk) fail(hzName, `real ride outcome does not match the gate state: ${JSON.stringify(r)}`);
          else pass(hzName, `${run}: at ${hz.m} m, phase ${hz.phase}; ${hz.flips} flips in 3 s, worst closed ${hz.worstClosed} ms, open share ${hz.openShare.toFixed(2)}; open: passed and still armed; closed: crash queued; real ride: ${r.passed ? 'passed while open' : `crashed while closed (${r.hit})`}`);
        }

        const pu = o.pu;
        if (pu.fatal) fail(puName, pu.fatal);
        else if (pu.chunkBiome !== B.biome) fail(puName, `spawned in a ${pu.chunkBiome} chunk`);
        else if (pu.drawKind !== PU_DEFS[B.powerup].shapeKey) fail(puName, `entity draws '${pu.drawKind}'`);
        else if (B.powerup === 'clockworkTreads') {
          const { belt, ward } = pu;
          if (!(belt.drive > 0)) fail(puName, `control: no conveyor drive on the zone (${belt.drive})`);
          else if (ward.drive !== 0 || !ward.chip) fail(puName, `with the Treads: drive ${ward.drive}, chip ${ward.chip}`);
          else if (!(Math.abs(belt.dv - ward.dv) > 5)) fail(puName, `the sled's speed change did not differ: belt ${belt.dv.toFixed(1)} vs warded ${ward.dv.toFixed(1)} px/s over 20 frames`);
          else pass(puName, `${run}: conveyor zone at ${pu.zoneM} m: drive ${belt.drive} -> ${ward.drive} px/s^2; the real sled's vx change over 20 frames ${belt.dv.toFixed(1)} -> ${ward.dv.toFixed(1)} px/s`);
        } else {
          const { base, glide } = pu;
          const e = PU_DEFS[B.powerup].effect;
          const d = glideDrag(1, glideFrictionMul(e.frictionMul));
          const dv = glide.speed - base.speed;
          const ddx = glide.dx - base.dx;
          // the felt-size line comes first, so a glide that is not felt fails on it whatever its parameters say
          if (base.grounded < 60 || glide.grounded < 60) fail(puName, `the sled was not on the ground (grounded frames ${base.grounded} / ${glide.grounded} of 124)`);
          else if (!(dv >= GLIDE_FELT_PX_S && ddx >= GLIDE_FELT_PX)) fail(puName, `not felt: after 2 s the glide is ${dv.toFixed(1)} px/s faster (want >= ${GLIDE_FELT_PX_S}) and ${ddx.toFixed(1)} px further (want >= ${GLIDE_FELT_PX}); speed ${base.speed.toFixed(1)} -> ${glide.speed.toFixed(1)}`);
          else if (!(Math.abs(glide.resist - base.resist * d.frictionMul) < 1e-9)) fail(puName, `groundResist ${base.resist} -> ${glide.resist} (want x${d.frictionMul})`);
          else if (!(Math.abs(glide.speedMul - base.speedMul * d.speedMul) < 1e-9) || !(Math.abs(glide.quadDrag - base.quadDrag * d.quadMul) < 1e-12)) fail(puName, `speedMul ${base.speedMul} -> ${glide.speedMul} (want x${d.speedMul}), quadDrag ${base.quadDrag} -> ${glide.quadDrag} (want x${d.quadMul})`);
          else if (!glide.chip) fail(puName, 'no HUD chip');
          else pass(puName, `${run}: frictionMul ${e.frictionMul} for ${e.durationMs} ms: groundResist x${d.frictionMul}, speedMul x${d.speedMul.toFixed(3)}, quadDrag x${d.quadMul.toFixed(3)}; same pose, nothing else acting: +1 s ${base.at1.v.toFixed(0)} -> ${glide.at1.v.toFixed(0)} px/s (+${(glide.at1.v - base.at1.v).toFixed(1)}), +2 s ${base.speed.toFixed(0)} -> ${glide.speed.toFixed(0)} px/s (+${dv.toFixed(1)}), ${ddx.toFixed(1)} px further`);
        }
      }
    }


    // ---- B3 tuning (Marvin 2026-11-15): a rolling hazard rolls downhill, away from the sled. One that catches the sled up
    // from behind never reaches a sled moving at a normal speed, and overtakes a stopped sled slowly and in view. Real
    // seed@<bit> runs of the built game; the hazard entity is driven by the live frame loop. Only this hazard can hit.
    {
      const { ROLL_ACTIVATE_PX, rollParams } = await import(path.join(ROOT, 'src/systems/HazardMotion.js'));
      const ROLLERS = [
        { name: 'Pyramid Peak', seed: 'b3pyramid54', mask: 4, hazard: 'rollingBoulder' },
        { name: 'Micro Mountain', seed: 'b3micro26', mask: 512, hazard: 'dewDrop' },
      ];
      for (const R of ROLLERS) {
        const hd = HAZ_DEFS[R.hazard];
        const rp = rollParams(hd.motion);
        const name = `B3 tuning ${R.name}: ${R.hazard} on ${R.seed}@${R.mask} never catches a sled moving at 200 px/s, and overtakes a stopped sled slowly (<= ${rp.speedPxS} px/s) and in view`;
        const c = await (async () => {
          const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
          try {
            const out = await page.evaluate(async ({ R, ACT }) => {
              const g = window.__bbGame;
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              g.scene.start('TitleScene');
              const t0 = Date.now();
              let run = null;
              let started = false;
              while (Date.now() - t0 < 15000) {
                const tt = g.scene.getScene('TitleScene');
                if (!started && tt && !tt.starting) { started = true; tt.startRun(`${R.seed}@${R.mask}`); }
                const rr = g.scene.getScene('RunScene');
                if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) { run = rr; break; }
                await wait(100);
              }
              if (!run) return { fatal: 'RunScene never produced a live sled' };
              await wait(300);
              if (run.sled.destroyed || !run.sled.inWorld || run.crashed) return { fatal: 'sled died before the probe' };
              run.scene.pause();
              const res = { seed: run.seed, mask: run.biomeMask };
              let clock = run.runTimeMs;
              const step = () => { clock += 16; run.update(clock, 16); };
              const keepAlive = () => { run.sled.invulnerableMs = 1e9; run.pendingCrash = null; };
              const live = () => { run.sled.invulnerableMs = 0; };
              const hits = [];
              const onHit = (p) => hits.push({ ...p, t: run.runTimeMs });
              g.events.on('bb:hazardHit', onHit);
              const taken = [];
              const poseAt = (x, v) => {
                run.streamTerrain(x);
                const ang = run.slopeAt(x);
                run.sled.setPose(x, run.terrain.heightAt(x) - 18, ang, Math.cos((ang * Math.PI) / 180) * v, Math.sin((ang * Math.PI) / 180) * v);
                if (run.snapCamera) run.snapCamera();
              };
              const onPU = run.onPowerUp;
              const onHz = run.onHazard;
              try {
                let f = null;
                for (let i = 0; i < 200 && !f; i++) {
                  const ch = run.terrain.getChunk(i);
                  const sp = ch.hazards.find((q) => q.defId === R.hazard);
                  if (sp) f = { ch, sp };
                }
                if (!f) return { ...res, fatal: `no ${R.hazard} in the first 200 chunks` };
                if (!run.mesh.chunks.has(f.ch.index)) { run.takeChunk(f.ch); taken.push(f.ch.index); }
                const h = (run.hazards.get(f.ch.index) || []).find((e) => e.def.id === R.hazard && e.spawn.x === f.sp.x);
                if (!h) return { ...res, fatal: 'no hazard entity' };
                res.m = Math.round(h.x0 / 20);
                run.onPowerUp = () => {};
                run.onHazard = (q) => { if (q === h) onHz.call(run, q); };
                const restart = () => {
                  h.roll = { activeAtMs: null, offsetPx: 0, vPxS: 0, simMs: 0, simDist: 0, simV: 0 };
                  h.hit = false;
                  h.stepMotion(run.runTimeMs, -Infinity);
                  keepAlive();
                  // the sled reaches the activation line (sled.x syncs from the body after a frame): the roll starts there
                  for (let k = 0; k < 3 && h.roll.activeAtMs === null; k++) { poseAt(h.x0 - ACT + 2, 0); step(); }
                };
                // (1) a sled moving at 200 px/s, 60 px ahead of the hazard when it starts
                restart();
                const startedA = h.roll.activeAtMs !== null;
                poseAt(h.x0 + 60, 200);
                live();
                hits.length = 0;
                let behind = true;
                let gapMin = Infinity;
                for (let i = 0; i < 150; i++) {
                  run.pendingCrash = null;
                  step();
                  if (h.cx >= run.sled.x) behind = false;
                  gapMin = Math.min(gapMin, run.sled.x - h.cx);
                  if (hits.length) break;
                }
                res.moving = { started: startedA, hits: hits.map((p) => p.hazardId), behind, gapMin: Math.round(gapMin), sledV: Math.round(run.sled.speed) };
                // (2) a stopped sled 80 px ahead of the start, held still: the hazard must reach it slowly and in view
                restart();
                const startedB = h.roll.activeAtMs !== null;
                const xs = h.x0 + 80;
                keepAlive();
                for (let i = 0; i < 30; i++) { poseAt(xs, 0); step(); } // camera settles on the stopped sled
                h.roll = { activeAtMs: null, offsetPx: 0, vPxS: 0, simMs: 0, simDist: 0, simV: 0 };
                h.stepMotion(run.runTimeMs, xs); // it starts now (the sled is past its activation line)
                const tStart = run.runTimeMs;
                live();
                hits.length = 0;
                let offScreen = 0;
                let maxV = 0;
                let lastX = h.cx;
                let behindPx = null;
                let hitT = null;
                for (let i = 0; i < 600; i++) {
                  poseAt(xs, 0);
                  run.pendingCrash = null;
                  step();
                  const v = run._view;
                  if (behindPx === null) behindPx = Math.round(xs - v.left);
                  if (!(h.cx > v.left && h.cx < v.right)) offScreen++;
                  maxV = Math.max(maxV, (h.cx - lastX) / 0.016);
                  lastX = h.cx;
                  if (hits.length) { hitT = run.runTimeMs - tStart; break; }
                }
                res.stopped = { started: startedB, hits: hits.map((p) => `${p.hazardId}:${p.effect}`), hitMs: hitT, offScreen, maxV: +maxV.toFixed(1), behindPx, startGap: Math.round(xs - h.x0) };
              } catch (e) { res.fatal = String(e && e.stack || e); }
              run.onPowerUp = onPU;
              run.onHazard = onHz;
              g.events.off('bb:hazardHit', onHit);
              for (const idx of taken) run.dropChunk(idx);
              return res;
            }, { R, ACT: ROLL_ACTIVATE_PX }).catch((e) => ({ fatal: String(e) }));
            return { errors, out };
          } finally { await page.close(); }
        })();
        const o = c.out;
        if (o.fatal || c.errors.length) { fail(name, o.fatal || `page errors: ${c.errors.join(' | ')}`); continue; }
        const run = `run ${o.seed}@${o.mask}`;
        const { moving, stopped } = o;
        if (o.seed !== R.seed || o.mask !== R.mask) fail(name, `the run is ${run}`);
        else if (!moving.started || !stopped.started) fail(name, `the roll did not start at the activation line (${moving.started} / ${stopped.started})`);
        else if (moving.hits.length || !moving.behind) fail(name, `a sled moving at 200 px/s was caught: hits ${moving.hits}, stayed ahead ${moving.behind}, closest ${moving.gapMin} px`);
        else if (stopped.hits.join() !== `${R.hazard}:crash`) fail(name, `the stopped sled was never reached: hits ${stopped.hits}`);
        else if (!(stopped.maxV <= rp.speedPxS + 0.5)) fail(name, `overtook at up to ${stopped.maxV} px/s (cap ${rp.speedPxS})`);
        else if (stopped.offScreen) fail(name, `the hazard was off screen for ${stopped.offScreen} frames of its approach`);
        else pass(name, `${run}: at ${o.m} m; moving sled (200 px/s): never caught, closest ${moving.gapMin} px ahead; stopped sled ${stopped.startGap} px ahead of the start: reached after ${stopped.hitMs} ms at <= ${stopped.maxV} px/s, on screen the whole approach (${stopped.behindPx} px of ground on screen behind the sled), ${stopped.hits}`);
      }
    }
    // ---- Micro Mountain glow-up. (1) HUGE bees: a real beegate0@512 run (sector 2, 1000-1500 m, is Micro Mountain,
    // sector 3 is base terrain) rides the live loop into Micro; the backdrop draws bees (Background.beeCount, sampled
    // over 3 s since a bee drifts on and off screen), and the backdrop Graphics is below the terrain, hazard,
    // pickup and sled depths. A mask-0 run draws none. (2) The Neon Sled Drone: the real Shard Shop lists it locked
    // (COMPLETE MICRO MOUNTAIN, disabled, selecting it changes nothing); the same seed ridden through the whole Micro
    // sector and crashed in sector 3 completes it, the credit grants rider-drone and Game Over toasts it; the shop
    // then reads EQUIP, equipping writes equipped.rider = drone; and the next run's real Sled draws the drone.
    // Lead hand-play: seed beegate0@512, ride past 1500 m, crash; Profile -> SHARD SHOP -> RIDER page.
    {
      const name = {
        bees: 'Micro glow: a beegate0@512 run in its Micro sector draws HUGE bees in the backdrop, behind the terrain, hazards, pickups and sled',
        noBees: 'Micro glow: a mask-0 run draws no bees',
        locked: 'Micro glow: the Shard Shop rider page lists NEON SLED DRONE locked as COMPLETE MICRO MOUNTAIN, and selecting it does nothing',
        grant: 'Micro glow: a beegate0@512 run that completes the Micro sector grants rider-drone, and Game Over toasts UNLOCKED NEON SLED DRONE',
        equip: 'Micro glow: the shop then shows NEON SLED DRONE as EQUIP, and equipping it writes equipped.rider = drone',
        draws: 'Micro glow: the next run\'s real Sled draws the drone (riderShape drone, rotors and blinking lights)',
      };
      const startRunAt = `async (g, seed, mask) => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        // a live run must be stopped first, or the wait below would find ITS sled and return the old run
        for (const k of ['RunScene', 'UIScene', 'GameOverScene']) { try { g.scene.stop(k); } catch (e) { /* not running */ } }
        await wait(200);
        if (Number.isFinite(mask)) g.registry.set('biomeMask', mask);
        g.scene.start('TitleScene');
        await wait(900);
        const t = g.scene.getScene('TitleScene');
        t.starting = false;
        if (Number.isFinite(mask)) t.startRun(seed, mask); else t.startRun(seed);
        const t0 = Date.now();
        while (Date.now() - t0 < 15000) {
          const rr = g.scene.getScene('RunScene');
          if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) return rr;
          await wait(100);
        }
        return null;
      }`;
      // (1) bees, then a mask-0 control
      {
        const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
        let out;
        try {
          out = await page.evaluate(async (src) => {
            const g = window.__bbGame;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const startAt = eval(src); // eslint-disable-line no-eval
            const sample = async (run, ms) => {
              let most = 0; let frames = 0; let motif = null;
              const t0 = Date.now();
              while (Date.now() - t0 < ms) {
                run.sled.invulnerableMs = 600000;
                most = Math.max(most, run.bg.beeCount || 0);
                motif = run.bg.motif;
                frames += 1;
                await wait(50);
              }
              return { most, frames, motif };
            };
            let run = await startAt(g, 'beegate0@512');
            if (!run) return { fatal: 'RunScene never produced a live sled (micro)' };
            const s = run.sled;
            const sx = 1060 * 20;
            run.streamTerrain(sx);
            const ang = run.slopeAt(sx);
            s.setPose(sx, run.terrain.heightAt(sx) - 18, ang, Math.cos((ang * Math.PI) / 180) * 300, Math.sin((ang * Math.PI) / 180) * 300);
            const micro = await sample(run, 3000);
            const depths = {
              bg: run.bg.gfx.depth,
              terrain: Math.min(...run.children.list.filter((o) => o !== run.bg.gfx && o.type === 'Graphics' && o.depth >= 0).map((o) => o.depth)),
              sled: run.sled.gfx.depth,
              hazards: [...run.hazards.values()].flat().map((h) => h.gfx && h.gfx.depth).filter((d) => Number.isFinite(d)),
              powerups: [...run.powerups.values()].flat().map((p) => p.gfx && p.gfx.depth).filter((d) => Number.isFinite(d)),
            };
            run = await startAt(g, 'beegate0', 0);
            if (!run) return { fatal: 'RunScene never produced a live sled (mask 0)' };
            const baseMask = run.biomeMask;
            run.streamTerrain(1060 * 20);
            run.sled.setPose(1060 * 20, run.terrain.heightAt(1060 * 20) - 18, run.slopeAt(1060 * 20), 300, 0);
            const base = await sample(run, 2000);
            run.sled.invulnerableMs = 0;
            return { micro, depths, base: { ...base, mask: baseMask } };
          }, startRunAt).catch((e) => ({ fatal: String(e) }));
        } finally { await page.close(); }
        if (out.fatal || errors.length) {
          fail(name.bees, out.fatal || `page errors: ${errors.join(' | ')}`);
          fail(name.noBees, out.fatal || `page errors: ${errors.join(' | ')}`);
        } else {
          const d = out.depths;
          const front = [d.terrain, d.sled, ...d.hazards, ...d.powerups];
          if (out.micro.motif !== 'dew-drops') fail(name.bees, `backdrop motif ${out.micro.motif} (want dew-drops)`);
          else if (!(out.micro.most >= 1 && out.micro.most <= 2)) fail(name.bees, `beeCount peaked at ${out.micro.most} over ${out.micro.frames} samples (want 1..2)`);
          else if (!front.every((x) => d.bg < x)) fail(name.bees, `backdrop depth ${d.bg} is not below ${JSON.stringify(d)}`);
          else pass(name.bees, `motif dew-drops, up to ${out.micro.most} bee(s) over ${out.micro.frames} samples; backdrop depth ${d.bg} < terrain ${d.terrain}, sled ${d.sled}, hazards ${[...new Set(d.hazards)]}, pickups ${[...new Set(d.powerups)]}`);
          if (out.base.mask !== 0) fail(name.noBees, `the control run is at mask ${out.base.mask}, not 0`);
          else if (out.base.most !== 0) fail(name.noBees, `mask-0 run drew ${out.base.most} bee(s) (motif ${out.base.motif})`);
          else pass(name.noBees, `run mask 0 at 1060 m: beeCount 0 over ${out.base.frames} samples, motif ${out.base.motif}`);
        }
      }
      // (2) the skin, end to end
      {
        // Every achievement already stamped, so the drone is this run's only unlock and the toast names it (the
        // mixed-with-achievements order is pinned in tests/src/micro-drone-skin.test.js).
        const allAch = Object.fromEntries(readJson('src/data/achievements/achievements.json').achievements.map((a) => [a.id, 1]));
        const profile = { ...JSON.parse(JSON.stringify(PROFILE)), biomeMask: 0, achievements: allAch };
        const { page, errors } = await bootWithProfile(browser, port, profile);
        let out;
        try {
          out = await page.evaluate(async (src) => {
            const g = window.__bbGame;
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const startAt = eval(src); // eslint-disable-line no-eval
            const openRiderShop = async () => {
              g.scene.start('TitleScene');
              await wait(900);
              const title = g.scene.getScene('TitleScene');
              const idx = title.menu.items.findIndex((i) => String(i.label).toUpperCase() === 'PROFILE');
              title.menu.setSelected(idx);
              title.menu.activate(idx);
              await wait(400);
              title.view._openShop();
              await wait(300);
              const shop = title.view;
              for (let i = 0; i < 4 && shop.page !== 2; i++) shop._turnPage(1);
              return { title, shop };
            };
            const droneRow = (shop) => {
              const idx = shop.menu.items.findIndex((i) => i.id === 'rider-drone');
              const it = shop.menu.items[idx];
              return { idx, label: it && it.label, sub: it && it.sub, disabled: it && it.disabled };
            };
            const prof = () => g.registry.get('profile') || {};
            // locked
            let { shop } = await openRiderShop();
            const lockedRow = droneRow(shop);
            shop.menu.setSelected(lockedRow.idx, true);
            shop.menu.activate(lockedRow.idx);
            await wait(100);
            const afterLockedTry = { rider: (prof().equipped || {}).rider, owned: ((prof().unlocked || {}).cosmetics || []).includes('rider-drone') };
            shop.close();
            // complete the Micro sector (sector 2) and crash in sector 3
            const run = await startAt(g, 'beegate0@512');
            if (!run) return { fatal: 'RunScene never produced a live sled' };
            const entered = [];
            const onEnter = (p) => { if (p && p.id) entered.push(p.id); };
            g.events.on('bb:biomeEnter', onEnter);
            let visits = null;
            const onEnd = (p) => { visits = p && p.biomeVisits; };
            g.events.on('bb:runEnd', onEnd);
            const s = run.sled;
            const ride = async (m, untilMs, stop) => {
              const x = m * 20;
              run.streamTerrain(x);
              const ang = run.slopeAt(x);
              s.setPose(x, run.terrain.heightAt(x) - 18, ang, Math.cos((ang * Math.PI) / 180) * 400, Math.sin((ang * Math.PI) / 180) * 400);
              const t0 = Date.now();
              while (Date.now() - t0 < untilMs && !(stop && stop())) { s.invulnerableMs = 600000; await wait(50); }
            };
            await ride(1060, 1500, () => entered.includes('micro-mountain'));
            await ride(1520, 600);
            s.invulnerableMs = 0;
            run.pendingCrash = { cause: 'chasm' };
            let over = null;
            const t2 = Date.now();
            while (Date.now() - t2 < 15000) {
              const go = g.scene.getScene('GameOverScene');
              if (go && go.scene.isActive()) { over = go; break; }
              await wait(100);
            }
            g.events.off('bb:biomeEnter', onEnter);
            g.events.off('bb:runEnd', onEnd);
            if (!over) return { fatal: 'Game Over never became active' };
            await wait(400);
            const toast = (over.toast || []).map((t) => (t && t.main ? t.main.text : null)).filter(Boolean);
            const awardIds = ((g.registry.get('lastAwards') || {}).achievements || []).map((a) => a.id);
            const rec = g.registry.get('lastRecord') || {};
            const granted = { cosmetics: (prof().unlocked || {}).cosmetics || [], completed: (prof().biomeProgress || {}).completed || [] };
            // owned in the shop, equip it
            ({ shop } = await openRiderShop());
            const ownedRow = droneRow(shop);
            shop.menu.setSelected(ownedRow.idx, true);
            shop.menu.activate(ownedRow.idx);
            await wait(150);
            const equippedRow = droneRow(shop);
            const equipped = (prof().equipped || {}).rider;
            shop.close();
            // the next run draws it
            const next = await startAt(g, 'beegate0', 0);
            if (!next) return { fatal: 'the next run never produced a live sled' };
            await wait(600);
            const lights0 = next.sled.drone ? next.sled.drone.lights.map((l) => l.on) : null;
            await wait(300);
            const lights1 = next.sled.drone ? next.sled.drone.lights.map((l) => l.on) : null;
            return {
              lockedRow, afterLockedTry, entered, visits, distanceM: rec.distanceM, toast, awardIds, granted, ownedRow, equippedRow, equipped,
              draw: {
                look: next.look ? next.look.riderShape : null,
                shape: next.sled.lastRiderShape,
                rotors: next.sled.drone ? next.sled.drone.rotors.length : 0,
                lights0, lights1,
              },
            };
          }, startRunAt).catch((e) => ({ fatal: String(e) }));
        } finally { await page.close(); }
        if (out.fatal || errors.length) {
          for (const k of ['locked', 'grant', 'equip', 'draws']) fail(name[k], out.fatal || `page errors: ${errors.join(' | ')}`);
        } else {
          const L = out.lockedRow;
          if (L.label !== 'NEON SLED DRONE' || L.sub !== 'COMPLETE MICRO MOUNTAIN' || L.disabled !== true) fail(name.locked, `row ${JSON.stringify(L)}`);
          else if (out.afterLockedTry.rider !== 'default' || out.afterLockedTry.owned) fail(name.locked, `selecting the locked row changed the profile ${JSON.stringify(out.afterLockedTry)}`);
          else pass(name.locked, `row ${L.label} / ${L.sub}, disabled; profile unchanged after selecting it`);
          if (!out.entered.includes('micro-mountain')) fail(name.grant, `the run never announced Micro Mountain (BIOME_ENTER ${out.entered})`);
          else if (!out.visits || !out.visits.completed.includes('micro-mountain')) fail(name.grant, `RUN_END.biomeVisits ${JSON.stringify(out.visits)} (${out.distanceM} m)`);
          else if (!out.granted.cosmetics.includes('rider-drone')) fail(name.grant, `rider-drone not granted (${out.granted.cosmetics}; completed ${out.granted.completed})`);
          else if (out.awardIds.join() !== 'rider-drone') fail(name.grant, `awards toast list ${JSON.stringify(out.awardIds)} (want ["rider-drone"])`);
          else if (!out.toast.includes('UNLOCKED NEON SLED DRONE')) fail(name.grant, `toast ${JSON.stringify(out.toast)}`);
          else pass(name.grant, `${out.distanceM} m, biomeVisits ${JSON.stringify(out.visits)}, unlocked.cosmetics has rider-drone, toast ${JSON.stringify(out.toast)}`);
          if (out.ownedRow.sub !== 'EQUIP' || out.ownedRow.disabled) fail(name.equip, `owned row ${JSON.stringify(out.ownedRow)}`);
          else if (out.equipped !== 'drone' || out.equippedRow.sub !== 'EQUIPPED') fail(name.equip, `equipped.rider ${out.equipped}, row ${JSON.stringify(out.equippedRow)}`);
          else pass(name.equip, `row EQUIP -> EQUIPPED, equipped.rider = ${out.equipped}`);
          const D = out.draw;
          if (D.look !== 'drone' || D.shape !== 'drone') fail(name.draws, `look.riderShape ${D.look}, sled.lastRiderShape ${D.shape}`);
          else if (D.rotors !== 2 || !D.lights0 || D.lights0[0] === D.lights0[1]) fail(name.draws, `drone draw state ${JSON.stringify(D)}`);
          else pass(name.draws, `look.riderShape drone, sled.lastRiderShape drone, 2 rotors, lights ${JSON.stringify(D.lights0)} -> ${JSON.stringify(D.lights1)}`);
        }
      }
    }

    // ---- B4 (biome full treatment, "Air"): per biome, a real seed@<bit> run of the built game, appended last. The air
    // hazards' real entities go through the shipped onHazard / AirTelegraph / frame loop; both stabilizers are checked on a
    // REAL landing: the same seed, pose, input and frames twice, once with nothing and once with the pickup taken, and the
    // frame loop lands the sled (TrickTracker -> RunScene.handleTricksAndLanding -> BiomeEffects.resolveLanding). The
    // queued crash is read where the frame loop hands it to resolveCrash (swapped for a recorder during the probe, so the
    // run goes on). Rails are also measured on the Sky Jellyfish bouncySpring zone (body restitution and rebound).
    {
      const B4 = [
        { biome: 'space-mountain', name: 'Space Mountain', seed: 'b4space15', mask: 32, hazard: 'meteor', powerup: 'gravityStabilizer' },
        { biome: 'sky-jellyfish-mountain', name: 'Sky Jellyfish Mountain', seed: 'b4jelly54', mask: 128, hazard: 'gustFront', powerup: 'stabilizerRails' },
      ];
      const { TUNING: GT } = await import(path.join(ROOT, 'src/systems/PhysicsTuner.js'));
      const { GUST_MAX_PX_S } = await import(path.join(ROOT, 'src/systems/BiomeEffects.js'));
      const { expectedSpeedPxS } = await import(path.join(ROOT, 'src/systems/TerrainGenerator.js'));
      // the expected speed every 10 m (the page interpolates it at the meteor's distance)
      const EXP = Array.from({ length: 1001 }, (_, i) => expectedSpeedPxS(i * 10));
      const SPRING = defsIn('src/data/terrainMods').bouncySpring.physics.bounceMul;
      for (const B of B4) {
        const names = B.hazard === 'meteor'
          ? {
            hz: `B4 ${B.name}: meteor spawns on ${B.seed}@${B.mask} in a jump arc, drawn in danger, and a real hit crashes the run (the banner names the Meteor)`,
            tele: `B4 ${B.name}: the meteor is air-telegraphed (STAY LOW over its lip) before the lip, and a hands-off ride at the expected speed passes under it`,
            pu: `B4 ${B.name}: gravityStabilizer spawns on ${B.seed}@${B.mask} and saves a real landing that crashes without it (same seed, pose, frames)`,
          }
          : {
            hz: `B4 ${B.name}: gustFront spawns on ${B.seed}@${B.mask} and changes the real sled's velocity by its bounded impulse (no crash, own HUD line, never named as the killer)`,
            pu: `B4 ${B.name}: stabilizerRails spawns on ${B.seed}@${B.mask}, saves a real landing that crashes without it, and damps the bouncySpring restitution`,
          };
        const c = await (async () => {
          const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
          try {
            const out = await page.evaluate(async ({ B, warnPx, EXP }) => {
              const g = window.__bbGame;
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              g.scene.start('TitleScene');
              const t0 = Date.now();
              let run = null;
              let started = false;
              while (Date.now() - t0 < 15000) {
                const tt = g.scene.getScene('TitleScene');
                if (!started && tt && !tt.starting) { started = true; tt.startRun(`${B.seed}@${B.mask}`); }
                const rr = g.scene.getScene('RunScene');
                if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) { run = rr; break; }
                await wait(100);
              }
              if (!run) return { fatal: 'RunScene never produced a live sled' };
              await wait(300);
              if (run.sled.destroyed || !run.sled.inWorld || run.crashed) return { fatal: 'sled died before the probe' };
              run.scene.pause();
              const res = { seed: run.seed, mask: run.biomeMask };
              const T = run.terrain;
              const PX = (v) => (v * 1000) / (1000 / 60);
              const vel = () => ({ x: PX(run.sled.body.velocity.x), y: PX(run.sled.body.velocity.y) });
              let clock = run.runTimeMs;
              const step = (n) => { for (let i = 0; i < n; i++) { clock += 16; run.update(clock, 16); } };
              const keepAlive = () => { run.sled.invulnerableMs = 1e9; run.pendingCrash = null; };
              const live = () => { run.sled.invulnerableMs = 0; run.pendingCrash = null; };
              // the frame loop's crash hand-off, recorded instead of ending the run
              const resolveCrash = run.resolveCrash;
              let queued = null;
              run.resolveCrash = function () { if (!queued) queued = this.pendingCrash; this.pendingCrash = null; };
              // scripted input (the sim harness does the same): tilt held for `hold` frames, hop on one frame
              const router = run.inputRouter;
              let fr = 0;
              let hold = -1;
              let tiltDir = 1;
              run.inputRouter = { poll: () => ({ tilt: fr < hold ? tiltDir : 0, pressed: {} }) };
              const hits = [];
              const lands = [];
              const onHit = (p) => hits.push(p);
              const onLand = (p) => lands.push(p);
              g.events.on('bb:hazardHit', onHit);
              g.events.on('bb:landing', onLand);
              const ui = g.scene.getScene('UIScene');
              const find = (id, list) => {
                for (let i = 0; i < 200; i++) {
                  const ch = T.getChunk(i);
                  const sp = ch[list].find((s) => s.defId === id);
                  if (sp) return { ch, sp };
                }
                return null;
              };
              const taken = [];
              const entity = (f, map) => {
                if (!f) return null;
                if (!run.mesh.chunks.has(f.ch.index)) { run.takeChunk(f.ch); taken.push(f.ch.index); }
                return (run[map].get(f.ch.index) || []).find((e) => e.def.id === f.sp.defId && e.spawn.x === f.sp.x) || null;
              };
              /** Same start state for every arm: same run time, no timers or biome effects left over. */
              const fresh = () => {
                const T0 = Math.ceil((clock + 60000) / 1000) * 1000;
                run._resetBiomeEffects();
                run.runTimeMs = T0; clock = T0; run.hitStopMs = 0; run.slowmoMs = 0; run.boostMs = 0; run.sled.boostMs = 0;
              };
              const slope = (x) => Math.atan2(T.heightAt(x + 10) - T.heightAt(x - 10), 20) * 180 / Math.PI;
              /**
               * One real landing: settle on the ground (no air or trick state carries over), then the same pose (h px above
               * x, along the slope, 380 / 150 px/s) and input (tilt held `k` frames); optional pickup taken right before.
               */
              const landX = run.sled.x + 500;
              const landing = (h, td, k, p) => {
                keepAlive(); hold = -1;
                run.sled.setPose(landX - 300, T.heightAt(landX - 300) - 18, slope(landX), 300, 0);
                step(40);
                fresh();
                if (p) { p.collected = false; run.onPowerUp(p); }
                live(); queued = null; lands.length = 0; hold = k; tiltDir = td; fr = 0;
                run.sled.setPose(landX, T.heightAt(landX) - h, slope(landX), 380, 150);
                let f = 0;
                for (; f < 120 && !queued && !lands.length; f++) { step(1); fr++; }
                keepAlive(); hold = -1;
                const l = lands[0];
                return { crash: queued ? queued.cause : null, q: l ? l.quality : null, ang: l ? Math.round(l.angleDeg) : null, imp: l ? Math.round(l.impactSpeedPxS) : null, frames: f };
              };
              /** Find a pose the real sled lands at 79-90 deg (a crash without a stabilizer), then land it again with p. */
              const stabilizeProbe = (p) => {
                for (const td of [1, -1]) {
                  for (let h = 92; h <= 116; h += 4) {
                    for (const k of [21, 22, 23]) {
                      const a = landing(h, td, k, null);
                      if (a.crash === 'badLanding' && a.q === 'crash' && Math.abs(a.ang) > 78 && Math.abs(a.ang) <= 90) {
                        const again = landing(h, td, k, null);
                        const b = landing(h, td, k, p);
                        return { pose: { h, td, k, x: Math.round(landX) }, without: a, again, withP: b, tolDeg: run.stabilizeDeg };
                      }
                    }
                  }
                }
                return { fatal: 'no 79-90 deg crash landing found near the start of the run' };
              };
              try {
                keepAlive();
                run._resetBiomeEffects();
                step(2);
                // the landing probe runs first, near the start of the run: the meteor ride below moves the live window
                // far ahead, and the colliders behind it are gone
                const fp = find(B.powerup, 'powerups');
                const p = entity(fp, 'powerups');
                const land = p ? stabilizeProbe(p) : null;
                run._resetBiomeEffects();
                keepAlive();
                const fh = find(B.hazard, 'hazards');
                const h = entity(fh, 'hazards');
                if (!h) res.hz = { fatal: `no ${B.hazard} in the first 200 chunks of ${B.seed}@${B.mask}` };
                else {
                  res.hz = { m: Math.round(fh.sp.x / 20), chunkBiome: fh.ch.biome, chunkDef: fh.ch.defId, drawKind: h.drawKind, shapeKey: h.def.shapeKey, isDanger: h.color === run.palette.danger, placement: h.def.placement };
                  if (B.hazard === 'meteor') {
                    // ---- the hit itself
                    live(); hits.length = 0; h.hit = false;
                    run.onHazard(h);
                    res.hz.crash = run.pendingCrash ? run.pendingCrash.hazardId : null;
                    res.hz.hitEvents = hits.map((p) => `${p.hazardId}:${p.effect}`);
                    keepAlive();
                    // ---- telegraph + hands-off ride at the expected speed through the jump
                    const lip = h.lip;
                    res.tele = { lip: lip ? { x: Math.round(lip.x), y: Math.round(lip.y) } : null };
                    if (lip) {
                      keepAlive(); hold = -1;
                      run.sled.setPose(lip.x - 900, T.heightAt(lip.x - 900) - 18, slope(lip.x - 900), 200, 0);
                      step(6);
                      fresh();
                      h.hit = false; h.warned = false; h.alert = false; h.nearMissed = false;
                      const dm = Math.min(9999, fh.sp.x / 20) / 10;
                      const v = EXP[Math.floor(dm)] + (EXP[Math.floor(dm) + 1] - EXP[Math.floor(dm)]) * (dm - Math.floor(dm));
                      const sx = lip.x - 260;
                      const a = slope(sx);
                      run.sled.setPose(sx, T.heightAt(sx) - 18, a, Math.cos(a * Math.PI / 180) * v, Math.sin(a * Math.PI / 180) * v);
                      live(); queued = null; hits.length = 0;
                      let alertAt = null; let lipAt = null; let labelSeen = null; let markInk = 0; let underMin = Infinity;
                      for (let f = 0; f < 240; f++) {
                        step(1);
                        const sl = run.sled;
                        if (h.alert && alertAt == null) alertAt = f;
                        if (run.airTelegraph && run.airTelegraph.label && run.airTelegraph.label.visible && labelSeen == null && sl.x < lip.x) {
                          labelSeen = { f, text: run.airTelegraph.label.text, x: Math.round(run.airTelegraph.label.x) };
                          markInk = run.airTelegraph.gfx && run.airTelegraph.gfx.commandBuffer ? run.airTelegraph.gfx.commandBuffer.length : -1;
                        }
                        if (lipAt == null && sl.x >= lip.x) lipAt = f;
                        if (Math.abs(sl.x - h.cx) < h.w / 2) underMin = Math.min(underMin, (sl.y - 22) - (h.cy + h.h / 2));
                        if (queued || sl.x > h.cx + 200) break;
                      }
                      keepAlive();
                      res.tele = { ...res.tele, v: Math.round(v), alertAt, lipAt, labelSeen, markInk, warnPx, hitEvents: hits.map((p) => p.hazardId), queued: queued ? (queued.hazardId || queued.cause) : null, underPx: Math.round(underMin), passedX: run.sled.x > h.cx };
                    }
                  } else {
                    // ---- gust: the run's real Gust Front, hit live; the body velocity before and after
                    live(); hits.length = 0; h.hit = false;
                    const v0 = vel();
                    const c0 = { vx: run.sled.vx, vy: run.sled.vy };
                    run.onHazard(h);
                    const v1 = vel();
                    res.hz.dv = { x: v1.x - v0.x, y: v1.y - v0.y };
                    res.hz.cache = { x: run.sled.vx - c0.vx, y: run.sled.vy - c0.vy };
                    res.hz.crashed = !!run.pendingCrash;
                    res.hz.hitEvents = hits.map((p) => `${p.hazardId}:${p.effect}:${p.durationMs}`);
                    res.hz.label = ui && ui.effects && ui.effects.get('gust') ? (ui.effects.get('gust').label || 'GUST') : null;
                    keepAlive();
                    step(2);
                    res.hz.inWorld = run.sled.inWorld;
                  }
                }
                // ---- power-up: the shared stabilize kind on a real landing
                run._resetBiomeEffects();
                keepAlive();
                if (!p) res.pu = { fatal: `no ${B.powerup} in the first 200 chunks of ${B.seed}@${B.mask}` };
                else {
                  res.pu = { m: Math.round(fp.sp.x / 20), chunkBiome: fp.ch.biome, drawKind: p.drawKind, shapeKey: p.def.shapeKey };
                  res.pu.land = land;
                  res.pu.chip = !!(ui && ui.powerups && ui.powerups.has(B.powerup));
                  run._resetBiomeEffects();
                  if (B.powerup === 'stabilizerRails') {
                    // ---- the bouncySpring zone of this run: restitution of the real body at touchdown, and the rebound
                    let zone = null;
                    for (let i = 0; i < 200 && !zone; i++) { const ch = T.getChunk(i); const z = ch.zones.find((q) => q.modId === 'bouncySpring'); if (z) zone = z; }
                    if (!zone) res.pu.bounce = { fatal: 'no bouncySpring zone in the first 200 chunks' };
                    else {
                      const zx = Math.round((zone.x0 + zone.x1) / 2);
                      keepAlive();
                      run.sled.setPose(zone.x0, T.heightAt(zone.x0) - 18, slope(zone.x0), 100, 0);
                      step(10);
                      const drop = (rails) => {
                        fresh(); keepAlive(); hold = -1;
                        if (rails) { p.collected = false; run.onPowerUp(p); }
                        run.sled.setPose(zx, T.heightAt(zx) - 200, slope(zx), 200, 700);
                        let rest = null; let first = -1; let up = 0; let air = 0;
                        for (let f = 0; f < 90; f++) {
                          step(1);
                          const sl = run.sled;
                          if (first < 0 && sl.grounded) { first = f; rest = sl.body.restitution; }
                          if (first >= 0) {
                            const n = Math.atan2(T.heightAt(sl.x + 10) - T.heightAt(sl.x - 10), 20);
                            const vv = vel();
                            up = Math.max(up, -(vv.y * Math.cos(n) - vv.x * Math.sin(n)));
                            if (!sl.grounded) air++;
                          }
                        }
                        const out = { rest, up: Math.round(up), air, bounceMul: run.currentPhys.bounceMul };
                        run._resetBiomeEffects();
                        return out;
                      };
                      const bare = drop(false);
                      const railed = drop(true);
                      const after = drop(false);
                      res.pu.bounce = { bare, railed, after };
                    }
                  }
                }
                // ---- last (it ends the run): a REAL crash through the shipped resolveCrash, and the killer the banner and
                // REG.LAST_CRASH name (Readable Chaos phase 3). Space: the meteor itself. Sky Jellyfish: a gust first, then
                // the base Packet Spike it pushes the sled into: the spike is the killer, never the gust.
                if (h) {
                  run.resolveCrash = resolveCrash;
                  run.inputRouter = router;
                  g.registry.set('lastCrash', null);
                  run._resetBiomeEffects();
                  live(); run.shieldCharges = 0; run.sled.shield = false;
                  h.hit = false;
                  run.onHazard(h);
                  let killer = null;
                  if (B.hazard === 'gustFront') {
                    res.killer = { gustQueued: !!run.pendingCrash };
                    killer = entity(find('packetSpike', 'hazards'), 'hazards');
                    if (killer) { killer.hit = false; run.onHazard(killer); }
                  }
                  step(1);
                  const lc = g.registry.get('lastCrash');
                  res.killer = { ...(res.killer || {}), crashed: run.crashed, banner: ui && ui.banner && ui.banner.main ? ui.banner.main.text : null,
                    lcName: lc ? lc.name : null, lcHazard: lc ? lc.hazardId : null, other: killer ? killer.def.id : null };
                }
              } catch (e) { res.fatal = String(e && e.stack || e); }
              g.events.off('bb:hazardHit', onHit);
              g.events.off('bb:landing', onLand);
              run.resolveCrash = resolveCrash;
              run.inputRouter = router;
              for (const idx of taken) run.dropChunk(idx);
              run._resetBiomeEffects();
              return res;
            }, { B, warnPx: GT.airWarnAheadPx, EXP }).catch((e) => ({ fatal: String(e) }));
            return { errors, out };
          } finally { await page.close(); }
        })();
        const o = c.out;
        const all = Object.values(names);
        if (o.fatal || c.errors.length) {
          for (const n of all) fail(n, o.fatal || `page errors: ${c.errors.join(' | ')}`);
          continue;
        }
        const run = `run ${o.seed}@${o.mask}`;
        const hz = o.hz;
        if (o.seed !== B.seed || o.mask !== B.mask) { for (const n of all) fail(n, `the run is ${run}, not ${B.seed}@${B.mask}`); continue; }
        if (hz.fatal) fail(names.hz, hz.fatal);
        else if (hz.chunkBiome !== B.biome) fail(names.hz, `spawned in a ${hz.chunkBiome} chunk`);
        else if (hz.drawKind !== hz.shapeKey || hz.placement !== 'air') fail(names.hz, `entity draws '${hz.drawKind}' (own '${hz.shapeKey}'), placement ${hz.placement}`);
        else if (B.hazard === 'meteor') {
          if (!hz.isDanger) fail(names.hz, 'the meteor is not drawn in danger');
          else if (hz.crash !== 'meteor' || hz.hitEvents.join() !== 'meteor:crash') fail(names.hz, `a hit queued ${hz.crash}, HAZARD_HIT ${hz.hitEvents}`);
          else if (!o.killer || !o.killer.crashed || o.killer.banner !== String(HAZ_DEFS.meteor.name || 'meteor').toUpperCase() || o.killer.lcName !== String(HAZ_DEFS.meteor.name || 'meteor').toUpperCase() || o.killer.lcHazard !== 'meteor') fail(names.hz, `real meteor crash: ${JSON.stringify(o.killer)} (want the banner and REG.LAST_CRASH to name ${String(HAZ_DEFS.meteor.name || 'meteor').toUpperCase()})`);
          else pass(names.hz, `${run}: at ${hz.m} m in a ${hz.chunkDef}; drawn '${hz.drawKind}' in danger; real hit queued crash 'meteor'; the real crash banner and REG.LAST_CRASH name "${o.killer.banner}"`);
          const t = o.tele;
          if (!t || !t.lip) fail(names.tele, 'the meteor entity has no launch lip (AirTelegraph cannot mark it)');
          else if (t.alertAt == null || t.lipAt == null || t.alertAt >= t.lipAt) fail(names.tele, `alert at frame ${t.alertAt}, lip at frame ${t.lipAt} (the warning must come first)`);
          else if (!t.labelSeen || t.labelSeen.text !== 'STAY LOW' || Math.abs(t.labelSeen.x - t.lip.x) > 1 || !(t.markInk > 0)) fail(names.tele, `STAY LOW mark ${JSON.stringify(t.labelSeen)}, telegraph ink ${t.markInk}`);
          else if (t.queued || t.hitEvents.length || !t.passedX || !(t.underPx > 0)) fail(names.tele, `hands-off ride at ${t.v} px/s: crash ${t.queued}, hits ${t.hitEvents}, passed ${t.passedX}, ${t.underPx} px under the box`);
          else pass(names.tele, `${run}: STAY LOW over the lip at x ${t.lip.x}, ${(t.lipAt - t.alertAt) * 16} ms before the lip at ${t.v} px/s (warn ${t.warnPx} px ahead); hands-off ride passes ${t.underPx} px under the box, no hit`);
        } else {
          const [ix, iy] = HAZ_DEFS.gustFront.onHit.impulsePxS;
          const mag = Math.hypot(hz.dv.x, hz.dv.y);
          if (hz.isDanger) fail(names.hz, 'a gust (no crash) is drawn in danger');
          else if (!(Math.abs(hz.dv.x - ix) < 0.5 && Math.abs(hz.dv.y - iy) < 0.5) || mag > GUST_MAX_PX_S + 1e-6 || mag < 100) fail(names.hz, `body velocity changed by (${hz.dv.x.toFixed(2)}, ${hz.dv.y.toFixed(2)}) px/s, want (${ix}, ${iy}), |dv| ${mag.toFixed(1)} (felt: 100 .. ${GUST_MAX_PX_S})`);
          else if (Math.abs(hz.cache.x - ix) > 1e-6 || Math.abs(hz.cache.y - iy) > 1e-6) fail(names.hz, `the sled's px/s cache moved (${hz.cache.x}, ${hz.cache.y})`);
          else if (hz.crashed || !hz.inWorld) fail(names.hz, `the gust crashed the run (queued ${hz.crashed}, inWorld ${hz.inWorld})`);
          else if (hz.hitEvents.join() !== 'gustFront:gust:0') fail(names.hz, `HAZARD_HIT ${hz.hitEvents}`);
          else if (hz.label !== 'GUST FRONT') fail(names.hz, `HUD warning label ${hz.label}`);
          else if (!o.killer || o.killer.gustQueued || o.killer.other !== 'packetSpike' || !o.killer.crashed || o.killer.banner !== 'PACKET SPIKE' || o.killer.lcHazard !== 'packetSpike' || /GUST/.test(`${o.killer.banner} ${o.killer.lcName}`)) fail(names.hz, `gust then Packet Spike: ${JSON.stringify(o.killer)} (the spike must be the killer, never the gust)`);
          else pass(names.hz, `${run}: at ${hz.m} m in a ${hz.chunkDef}; body velocity +(${hz.dv.x.toFixed(1)}, ${hz.dv.y.toFixed(1)}) px/s = |${mag.toFixed(1)}| <= ${GUST_MAX_PX_S}; no crash; HUD "${hz.label}"; gust then a real Packet Spike: the banner and REG.LAST_CRASH name "${o.killer.banner}", never the gust`);
        }
        const pu = o.pu;
        const L = pu && pu.land;
        if (pu.fatal) fail(names.pu, pu.fatal);
        else if (pu.chunkBiome !== B.biome) fail(names.pu, `spawned in a ${pu.chunkBiome} chunk`);
        else if (pu.drawKind !== pu.shapeKey) fail(names.pu, `entity draws '${pu.drawKind}', not its own '${pu.shapeKey}'`);
        else if (!L || L.fatal) fail(names.pu, (L && L.fatal) || 'no landing probe');
        else if (JSON.stringify(L.again) !== JSON.stringify(L.without)) fail(names.pu, `the pose is not repeatable: ${JSON.stringify(L.without)} then ${JSON.stringify(L.again)}`);
        else if (L.withP.crash !== null || L.withP.q !== 'sloppy' || L.withP.ang !== L.without.ang) fail(names.pu, `with the pickup the ${L.without.ang} deg landing gave crash ${L.withP.crash}, ${L.withP.q} at ${L.withP.ang} deg`);
        else if (L.tolDeg !== PU_DEFS[B.powerup].effect.landingToleranceDeg) fail(names.pu, `stabilize tolerance ${L.tolDeg}`);
        else if (B.powerup === 'gravityStabilizer') pass(names.pu, `${run}: at ${pu.m} m; pose h ${L.pose.h} tilt ${L.pose.td} x ${L.pose.k} frames: ${L.without.ang} deg at ${L.without.imp} px/s crashes (badLanding, twice) without, a sloppy wobble with +${L.tolDeg} deg`);
        else {
          const bo = pu.bounce;
          if (!bo || bo.fatal) fail(names.pu, (bo && bo.fatal) || 'no bounce probe');
          else if (!(Math.abs(bo.bare.rest - 0.02 * SPRING * SPRING) < 1e-6) || !(Math.abs(bo.railed.rest - 0.02 * (SPRING * PU_DEFS.stabilizerRails.effect.bounceMul) ** 2) < 1e-6) || bo.after.rest !== bo.bare.rest || !(bo.railed.rest < bo.bare.rest * 0.5)) fail(names.pu, `touchdown restitution bare ${bo.bare.rest}, railed ${bo.railed.rest}, after ${bo.after.rest}`);
          else pass(names.pu, `${run}: at ${pu.m} m; ${L.without.ang} deg landing: crash without, sloppy with +${L.tolDeg} deg; bouncySpring touchdown restitution ${bo.bare.rest.toFixed(4)} -> ${bo.railed.rest.toFixed(4)} with Rails (rebound ${bo.bare.up} -> ${bo.railed.up} px/s, airborne frames ${bo.bare.air} -> ${bo.railed.air})`);
        }
      }
    }

    // ---- B4 Sky Jellyfish: the bouncySpring rebound is FELT on the real sled, and the Stabilizer Rails damp the SAME landing.
    //
    // Three arms of ONE run (same seed, same x, same pose, same frame budget): the plain control (the same x and the
    // same colliders, with NO zone mods - only getZoneDefs returns nothing, and it is restored right after), the
    // bouncySpring zone, and the same zone with the run's REAL stabilizerRails pickup taken. The pose is the same in
    // every arm - 200 px above the ground, 200 px/s along, 700 px/s down, aligned with the local slope.
    // Nothing is suppressed: invulnerableMs stays 0, so a crash is a real crash and is reported.
    // The measurement starts at the first bb:landing EVENT (a launch resets `grounded`, so "the first grounded frame"
    // would measure the wrong thing): from there the real Matter body gives the upward speed along the slope normal
    // (the rebound), the airborne frames, the height of the bounce and the number of bounces (a pogo).
    // The B4 block above measures the ZONE's restitution; this block measures what the player feels, which is the
    // landing rebound (BiomeEffects.springRebound) and not the body's restitution.
    {
      const nameFelt = 'B4 Sky Jellyfish Mountain: the bouncySpring rebound is felt on the real sled (same x and pose, three arms: no zone mods, spring zone, spring + Rails)';
      const namePogo = 'B4 Sky Jellyfish Mountain: the spring rebound does not pogo (the chain of touchdowns stops)';
      // the bar from the brief: a bounce you can feel is at least 50 px/s up and at least 5 airborne frames
      const FELT_UP_PX_S = 50;
      const FELT_AIR_FRAMES = 5;
      const RAILS_CUT = 0.5; // the Rails must damp the same landing to at most half of it
      const { page, errors } = await bootWithProfile(browser, port, JSON.parse(JSON.stringify(PROFILE)));
      try {
        const o = await page.evaluate(async ({ seed, mask, frames }) => {
          const g = window.__bbGame;
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          g.scene.start('TitleScene');
          const t0 = Date.now();
          let run = null;
          let started = false;
          while (Date.now() - t0 < 15000) {
            const tt = g.scene.getScene('TitleScene');
            if (!started && tt && !tt.starting) { started = true; tt.startRun(`${seed}@${mask}`); }
            const rr = g.scene.getScene('RunScene');
            if (rr && rr.scene.isActive() && rr.sled && !rr.sled.destroyed && rr.sled.inWorld) { run = rr; break; }
            await wait(100);
          }
          if (!run) return { fatal: 'RunScene never produced a live sled' };
          await wait(300);
          if (run.sled.destroyed || !run.sled.inWorld || run.crashed) return { fatal: 'sled died before the probe' };
          run.scene.pause();
          const T = run.terrain;
          const PX = (v) => (v * 1000) / (1000 / 60);
          const vel = () => ({ x: PX(run.sled.body.velocity.x), y: PX(run.sled.body.velocity.y) });
          let clock = run.runTimeMs;
          const step = (n) => { for (let i = 0; i < n; i++) { clock += 16; run.update(clock, 16); } };
          const slope = (x) => Math.atan2(T.heightAt(x + 10) - T.heightAt(x - 10), 20) * 180 / Math.PI;
          // the frame loop's crash hand-off, recorded instead of ending the run (the crash itself is NOT suppressed)
          const resolveCrash = run.resolveCrash;
          const crashes = [];
          run.resolveCrash = function () { crashes.push(this.pendingCrash && this.pendingCrash.cause); this.pendingCrash = null; };
          const lands = [];
          const onLand = (p) => lands.push({ q: p.quality, imp: Math.round(p.impactSpeedPxS), ang: Math.round(p.angleDeg) });
          g.events.on('bb:landing', onLand);
          try {
            // the run's own bouncySpring zone and its own Stabilizer Rails
            let zone = null;
            for (let i = 0; i < 200 && !zone; i++) { const ch = T.getChunk(i); const z = ch.zones.find((q) => q.modId === 'bouncySpring'); if (z) zone = { ...z, chunk: i }; }
            if (!zone) return { fatal: 'no bouncySpring zone in the first 200 chunks' };
            let rails = null;
            for (let i = 0; i < 200 && !rails; i++) { const ch = T.getChunk(i); const s = ch.powerups.find((q) => q.defId === 'stabilizerRails'); if (s) rails = { ch, sp: s }; }
            // the colliders of the zone have to exist before the sled is dropped into it
            for (let k = Math.max(0, zone.chunk - 3); k <= zone.chunk + 4; k++) if (!run.mesh.chunks.has(k)) run.takeChunk(T.getChunk(k));
            if (rails && !run.mesh.chunks.has(rails.ch.index)) run.takeChunk(rails.ch);
            const pu = rails ? (run.powerups.get(rails.ch.index) || []).find((e) => e.def.id === 'stabilizerRails') : null;
            if (!pu) return { fatal: 'no stabilizerRails pickup in the first 200 chunks' };
            const zx = Math.round((zone.x0 + zone.x1) / 2);
            const H = 200; const VX = 200; const VY = 700;
            /**
             * One arm: the same pose, the same frames, from a clean state.
             * mode 'plain' = the plain control (the same x and colliders, no zone mods), 'zone' = the zone,
             * 'rails' = the zone with the run's real Stabilizer Rails pickup.
             */
            const trial = (arm, mode) => {
              const T0 = Math.ceil((clock + 60000) / 1000) * 1000;
              run._resetBiomeEffects();
              run.runTimeMs = T0; clock = T0; run.hitStopMs = 0; run.slowmoMs = 0; run.boostMs = 0; run.sled.boostMs = 0;
              run.sled.invulnerableMs = 0; run.pendingCrash = null; run.crashed = false;
              crashes.length = 0; lands.length = 0;
              const zoneDefs = run.getZoneDefs;
              if (mode === 'plain') run.getZoneDefs = () => [];
              try {
                if (mode === 'rails') { pu.collected = false; run.onPowerUp(pu); }
                run.sled.setPose(zx, T.heightAt(zx) - H, slope(zx), VX, VY);
                let landedAt = -1; let up = 0; let air = 0; let lift = 0; let base = 0; let bounces = 0; let wasAir = false;
                let share = null; let zoneIds = null; const peaks = [];
                for (let f = 0; f < frames; f++) {
                  const nl = lands.length;
                  step(1);
                  const sl = run.sled;
                  if (landedAt < 0 && lands.length > nl) {
                    landedAt = f;
                    base = T.heightAt(sl.x) - sl.y;
                    zoneIds = run.getZoneDefs(sl.x).map((d) => d.id).join(',');
                    share = run.currentPhys ? +run.currentPhys.landingRebound.toFixed(4) : null;
                  }
                  if (landedAt >= 0) {
                    const n = Math.atan2(T.heightAt(sl.x + 10) - T.heightAt(sl.x - 10), 20);
                    const vv = vel();
                    const u = -(vv.y * Math.cos(n) - vv.x * Math.sin(n)); // upward along the slope normal
                    if (u > up) up = u;
                    if (!sl.grounded) { air++; if (!wasAir) { bounces++; peaks.push(Math.round(u)); } wasAir = true; } else wasAir = false;
                    const l = T.heightAt(sl.x) - sl.y - base;
                    if (l > lift) lift = l;
                  }
                  if (crashes.length) break;
                }
                const out = {
                  arm, mode, x: zx, up: Math.round(up), air, liftPx: Math.round(lift), bounces, peaks,
                  crash: crashes.slice(), lands: lands.slice(), zoneIds, share, settled: !!run.sled.grounded,
                };
                return out;
              } finally { run.getZoneDefs = zoneDefs; run._resetBiomeEffects(); }
            };
            const plain = trial('no zone mods (plain control)', 'plain');
            const zoneArm = trial('spring zone', 'zone');
            const railed = trial('spring zone + Rails', 'rails');
            const again = trial('spring zone', 'zone'); // the same arm again: the pose must be repeatable
            return { seed: run.seed, mask: run.biomeMask, zone: { x0: zone.x0, x1: zone.x1, chunk: zone.chunk }, plain, zoneArm, railed, again };
          } catch (e) { return { fatal: String(e && e.stack || e) }; }
          finally { g.events.off('bb:landing', onLand); run.resolveCrash = resolveCrash; }
        }, { seed: 'b4jelly54', mask: 128, frames: 120 }).catch((e) => ({ fatal: String(e) }));
        if (o.fatal) { fail(nameFelt, o.fatal); fail(namePogo, o.fatal); }
        else if (errors.length) { fail(nameFelt, `page errors: ${errors.join(' | ')}`); fail(namePogo, `page errors: ${errors.join(' | ')}`); }
        else {
          const z = o.zoneArm; const p = o.plain; const r = o.railed; const again = o.again;
          const arm = (a) => `up ${a.up} px/s, ${a.air} airborne frames, ${a.liftPx} px high, ${a.bounces} bounce(s), crash ${JSON.stringify(a.crash)}, landing ${JSON.stringify(a.lands[0] || null)}`;
          const same = JSON.stringify({ up: z.up, air: z.air, liftPx: z.liftPx, bounces: z.bounces }) === JSON.stringify({ up: again.up, air: again.air, liftPx: again.liftPx, bounces: again.bounces });
          if (o.seed !== 'b4jelly54' || o.mask !== 128) fail(nameFelt, `the run is ${o.seed}@${o.mask}, not b4jelly54@128`);
          else if (!same) fail(nameFelt, `the zone arm is not repeatable: ${arm(z)} then ${arm(again)}`);
          else if (p.x !== z.x || r.x !== z.x) fail(nameFelt, `the arms are not comparable: x ${p.x}, ${z.x}, ${r.x}`);
          else if (z.zoneIds !== 'bouncySpring' || p.zoneIds !== '') fail(nameFelt, `the arms are not comparable: the zone arm landed in "${z.zoneIds}", the plain control in "${p.zoneIds}"`);
          else if (!p.lands.length || !z.lands.length || !r.lands.length) fail(nameFelt, `an arm never landed: plain ${arm(p)}, zone ${arm(z)}, railed ${arm(r)}`);
          else if (p.lands[0].imp !== z.lands[0].imp) fail(nameFelt, `the plain control and the zone arm did not land the same: impact ${p.lands[0].imp} vs ${z.lands[0].imp} px/s`);
          else if (z.up < FELT_UP_PX_S || z.air < FELT_AIR_FRAMES) fail(nameFelt, `the spring zone is not felt: ${arm(z)} (want >= ${FELT_UP_PX_S} px/s up and >= ${FELT_AIR_FRAMES} airborne frames)`);
          else if (p.up >= FELT_UP_PX_S || p.up >= z.up * RAILS_CUT) fail(nameFelt, `the plain control bounces too: ${arm(p)} against the zone's ${arm(z)}`);
          else if (r.up > z.up * RAILS_CUT || r.air >= z.air) fail(nameFelt, `the Stabilizer Rails do not damp the same landing: ${arm(r)} against the zone's ${arm(z)}`);
          else if (p.crash.length || z.crash.length || r.crash.length) fail(nameFelt, `an arm crashed: plain ${JSON.stringify(p.crash)}, zone ${JSON.stringify(z.crash)}, railed ${JSON.stringify(r.crash)}`);
          else pass(nameFelt, `run ${o.seed}@${o.mask}: the same pose (x ${z.x}, 200 px up, 200 px/s along, 700 px/s down) and the same frames in three arms, nothing suppressed - no zone mods: ${arm(p)}; spring zone: ${arm(z)}; spring + Rails: ${arm(r)} (rebound share ${z.share} -> ${r.share})`);
          if (z.bounces > 3 || !z.settled) fail(namePogo, `the spring zone pogos: ${z.bounces} bounces, settled ${z.settled}`);
          else if (r.bounces > 0 && !r.settled) fail(namePogo, `the railed arm pogos: ${r.bounces} bounces, settled ${r.settled}`);
          else pass(namePogo, `run ${o.seed}@${o.mask}: the spring zone bounced ${z.bounces} time(s) and settled (peaks ${JSON.stringify(z.peaks)}); the railed arm bounced ${r.bounces} time(s) and settled`);
        }
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
  // A block that is skipped by a flag pushes nothing, so "0 skipped" used to hide 11 absent W4
  // checks (audit F5, 2026-11-14). Count what ran against what this mode must run.
  const expected = WITH_BOOSTS ? EXPECTED_WITH_BOOSTS : EXPECTED_WITHOUT_BOOSTS;
  if (results.length < expected) {
    console.error(`\nGATE FAIL: ${results.length} checks recorded, expected at least ${expected}${WITH_BOOSTS ? '' : ' (run with --with-boosts for the full gate)'}`);
    process.exit(1);
  }
  if (!WITH_BOOSTS) console.log('NOTE: --with-boosts not given; the 11 W4 boost/shop checks did not run.');
  if (bad.length) { console.error('\nGATE FAIL'); process.exit(1); }
  console.log('GATE PASS');
}

main().catch((e) => { console.error('GATE FAIL:', e); process.exit(1); });
