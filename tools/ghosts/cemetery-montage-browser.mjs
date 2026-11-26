/** Issue #68: Cemetery Montage / attempt history end to end in real Chromium (Phaser + Matter + real IndexedDB).
 *
 *   GAME_URL=http://localhost:8293/ [SHOT_DIR=/tmp/shots] [CPU_THROTTLE=4] node tools/ghosts/cemetery-montage-browser.mjs
 *
 *  1. DEFAULT 5: seven real runs on one course keep exactly the five newest (FIFO), in a separate database; the
 *     five-role ghost library still holds its own Best/Latest.
 *  2. RESTART: a reload (same profile) restores the same history.
 *  3. SETTINGS: lowering the limit to 2 trims at once; 0 stores nothing new; raising does not restore.
 *  4. COURSE: a run on another course never appears in this course's montage.
 *  5. MONTAGE: M at Game Over opens the overlay with the stored attempts + this run; it plays, then rests on the
 *     overview. Nothing interactive, no page errors, no network writes.
 *  6. REDUCED MOTION: OS prefers-reduced-motion with the setting on AUTO opens a still overview that never plays.
 *  7. CORRUPT: a damaged pose row is skipped, the montage still opens.
 *  9. TWO TABS: two same-origin tabs race record() at keep 5 and keep 1; ordinals stay distinct and increasing, only
 *     the newest committed survives keep=1, a stale tab's trim/record/clear plans from disk, GhostLibrary untouched.
 * 10. OPT-OUT ACROSS TABS: Tab A sets keep 0, Tab B (still showing 5) finishes a real run: nothing stored, B adopts 0,
 *     empty after reload; 0 -> 5 re-enables, 5 -> 2 trims; GhostLibrary untouched.
 * 11. UNRELATED SAVE: Tab A sets keep 0 in Settings; Tab B, not yet notified, saves PALETTE in Settings: the saved
 *     limit stays 0 and Tab B's next real run stores nothing.
 *  8. PERF: synthetic QA traces (ids `synthetic-qa-*`, derived from this device's real trace) at 0/5/10/20/40 kept
 *     attempts, swarm style, at real requestAnimationFrame pacing (optionally CPU-throttled): frame p50/p95, the
 *     montage's own update cost per frame, history write time and bytes.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.GAME_URL || 'http://localhost:8293/';
const shotDir = process.env.SHOT_DIR || null;
const throttle = Number(process.env.CPU_THROTTLE || 1);
const outJson = process.env.OUT_JSON || null;
const SEED = 'CEMETERY68';
const exe = process.env.CHROMIUM_PATH || (process.env.CI ? undefined : '/opt/pw-browsers/chromium');

const profile = await mkdtemp(join(tmpdir(), 'bb-cemetery-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: true, viewport: { width: 960, height: 540 }, ...(exe ? { executablePath: exe } : {}),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const report = { throttle, steps: {} };
const writes = [];
ctx.on('request', (r) => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(`${r.method()} ${r.url()}`); });

async function open(tier) {
  const page = await ctx.newPage();
  // Force a device tier for the benchmark (the budget reads navigator.hardwareConcurrency / deviceMemory).
  if (tier) await page.addInitScript((low) => { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => (low ? 4 : 8) }); Object.defineProperty(navigator, 'deviceMemory', { get: () => (low ? 4 : 8) }); }, tier === 'low');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive() && window.__bbGame.registry.get('attemptHistory')?.ready, null, { timeout: 60000 });
  if (throttle > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  return { page, errors };
}

/** One real run on `seed` that crashes after `ms` of riding; resolves on the Game Over screen. */
async function run(page, seed, ms) {
  await page.evaluate(async (seed) => {
    const g = window.__bbGame;
    const go = g.scene.getScene('GameOverScene');
    if (go?.sys?.isActive()) {
      if (go.ghostView) go._closeGhosts();
      if (go.rec?.seed === seed) { go.retry(); return; }
      go.toTitle();
      await new Promise((res) => { const w = () => (g.scene.getScene('TitleScene')?.sys?.isActive() ? res() : requestAnimationFrame(w)); w(); });
    }
    g.scene.getScene('TitleScene').startRun(seed);
  }, seed);
  await page.waitForFunction(() => { const r = window.__bbGame.scene.getScene('RunScene'); return r?.sys.isActive() && r.sled && !r.crashed; }, null, { timeout: 30000 });
  await page.waitForTimeout(ms);
  await page.evaluate(() => { window.__bbGame.scene.getScene('RunScene').pendingCrash = { cause: 'chasm' }; });
  await page.waitForFunction(() => window.__bbGame.scene.getScene('GameOverScene')?.sys?.isActive(), null, { timeout: 30000 });
  await page.waitForTimeout(400); // IndexedDB write after RUN_END
  return page.evaluate(() => window.__bbGame.registry.get('lastGhostTape')?.runId);
}

const hist = (page, seed = SEED) => page.evaluate((seed) => window.__bbGame.registry.get('attemptHistory').list(seed, window.__bbGame.scene.getScene('RunScene')?.biomeMask || 0).map((m) => m.id), seed);
const setSetting = (page, key, value) => page.evaluate(({ key, value }) => {
  const g = window.__bbGame, st = g.registry.get('settings');
  st[key] = value; g.registry.get('saveStore').saveSettings(st);
  g.events.emit('bb:settingsChanged', { key, value, settings: st });
}, { key, value });

try {
  const errors = [];
  if (process.env.PERF_ONLY !== '1') {
  const { page, errors: e1 } = await open();
  errors.push(...e1);
  assert.equal(await page.evaluate(() => window.__bbGame.registry.get('attemptHistory').kind), 'idb');
  assert.equal(await page.evaluate(() => window.__bbGame.registry.get('settings').attemptHistoryKeep), 5);

  // 1. default 5, FIFO
  const runIds = [];
  for (let i = 0; i < 7; i++) runIds.push(await run(page, SEED, 900 + i * 150));
  assert.deepEqual(await hist(page), runIds.slice(2), 'default keeps the five newest');
  const course = await page.evaluate((s) => window.__bbGame.registry.get('ghostLibrary').course(s, window.__bbGame.scene.getScene('RunScene').biomeMask || 0), SEED);
  assert.equal(course.latest, runIds[6], 'ghost library Latest unchanged by history');
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort());
  assert.ok(dbs.includes('bitstream-attempt-history') && dbs.includes('bitstream-ghosts'), JSON.stringify(dbs));
  report.steps.default5 = { kept: (await hist(page)).length, ran: runIds.length, dbs };
  console.log('CEMETERY_DEFAULT5_PASS', JSON.stringify(report.steps.default5));

  // 5. montage at Game Over (normal motion)
  await page.keyboard.press('m');
  await page.waitForFunction(() => window.__bbGame.scene.getScene('GameOverScene').ghostView?.montage, null, { timeout: 10000 });
  const m0 = await page.evaluate(() => { const v = window.__bbGame.scene.getScene('GameOverScene').ghostView;
    return { riders: v.montage.plan.riders.map((r) => r.id), hero: v.montage.plan.riders.at(-1).hero, playing: v.montage.playing, mode: v.montage.mode, reduced: v.reduced }; });
  assert.deepEqual(m0.riders.slice(0, -1).filter((id) => runIds.includes(id)).length, 4 + 0, `montage riders ${JSON.stringify(m0)}`);
  assert.equal(m0.riders.at(-1), runIds[6]);
  assert.equal(m0.playing, true);
  assert.equal(m0.reduced, false);
  if (shotDir) { await page.waitForTimeout(700); await page.screenshot({ path: `${shotDir}/cemetery-follow.png` }); }
  await page.waitForFunction(() => { const m = window.__bbGame.scene.getScene('GameOverScene').ghostView?.montage; return m && m.finished; }, null, { timeout: 60000 });
  const interactive = await page.evaluate(() => {
    const v = window.__bbGame.scene.getScene('GameOverScene').ghostView;
    const objs = [v.montage.g, v.montage._staticLayer, ...v.montage.labels.values()];
    return objs.filter((o) => o && o.input).length;
  });
  assert.equal(interactive, 0, 'montage objects must be noninteractive');
  if (shotDir) await page.screenshot({ path: `${shotDir}/cemetery-overview.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__bbGame.scene.getScene('GameOverScene').ghostView, null, { timeout: 5000 });
  console.log('CEMETERY_MONTAGE_PASS', JSON.stringify(m0));

  // 4. other course
  const otherId = await run(page, 'CEMETERY68-OTHER', 900);
  await page.keyboard.press('m');
  await page.waitForFunction(() => { const v = window.__bbGame.scene.getScene('GameOverScene').ghostView; return v && v.data; }, null, { timeout: 10000 });
  const other = await page.evaluate(() => { const v = window.__bbGame.scene.getScene('GameOverScene').ghostView; return { attempts: v.data.attempts.map((a) => a.meta.id), montage: !!v.montage }; });
  assert.deepEqual(other.attempts, [], 'another course shows none of this course');
  assert.equal(other.montage, false);
  await page.keyboard.press('Escape');
  assert.deepEqual(await hist(page, 'CEMETERY68-OTHER'), [otherId]);
  console.log('CEMETERY_COURSE_PASS', JSON.stringify(other));

  // 2. restart
  await page.close();
  const p2 = await open();
  assert.deepEqual(await hist(p2.page), runIds.slice(2), 'history survives a reload');
  console.log('CEMETERY_RESTART_PASS');

  // 3. settings: lower to 2, 0, raise
  await setSetting(p2.page, 'attemptHistoryKeep', 2);
  await p2.page.waitForTimeout(200);
  assert.deepEqual(await hist(p2.page), runIds.slice(5));
  await setSetting(p2.page, 'attemptHistoryKeep', 0);
  await p2.page.waitForTimeout(200);
  assert.deepEqual(await hist(p2.page), []);
  await run(p2.page, SEED, 900);
  assert.deepEqual(await hist(p2.page), [], '0 keeps nothing new');
  await setSetting(p2.page, 'attemptHistoryKeep', 5);
  assert.deepEqual(await hist(p2.page), [], 'raising cannot restore');
  const lib = await p2.page.evaluate((s) => window.__bbGame.registry.get('ghostLibrary').course(s, window.__bbGame.scene.getScene('RunScene').biomeMask || 0), SEED);
  assert.ok(lib.best && lib.latest, 'ghost library roles survive history trimming');
  console.log('CEMETERY_SETTINGS_PASS');

  // 7. corrupt row
  const ids = [await run(p2.page, SEED, 900), await run(p2.page, SEED, 1100)];
  await p2.page.evaluate(async (id) => {
    const db = await new Promise((r) => { const q = indexedDB.open('bitstream-attempt-history'); q.onsuccess = () => r(q.result); });
    await new Promise((r) => { const tx = db.transaction('poses', 'readwrite'); tx.objectStore('poses').put({ id, data: new Float32Array([NaN, 1, 2, 3, 4, 5]).buffer }); tx.oncomplete = r; });
  }, ids[0]);
  await run(p2.page, SEED, 1300);
  await p2.page.keyboard.press('m');
  await p2.page.waitForFunction(() => { const v = window.__bbGame.scene.getScene('GameOverScene').ghostView; return v && v.data; }, null, { timeout: 10000 });
  const corrupt = await p2.page.evaluate(() => { const v = window.__bbGame.scene.getScene('GameOverScene').ghostView; return { ids: v.data.attempts.map((a) => a.meta.id), skipped: v.data.skipped, montage: !!v.montage }; });
  assert.ok(!corrupt.ids.includes(ids[0]) && corrupt.ids.includes(ids[1]) && corrupt.skipped === 1 && corrupt.montage, JSON.stringify(corrupt));
  await p2.page.keyboard.press('Escape');
  console.log('CEMETERY_CORRUPT_PASS', JSON.stringify(corrupt));

  // 9. TWO TABS on the same origin racing the same store (PR #378 review P1): every change is planned inside one
  //    IndexedDB readwrite transaction from what is on disk, so ordinals stay distinct and increasing, a keep=1 race
  //    leaves exactly the newest committed attempt, and a stale tab cannot undo newer changes or touch GhostLibrary.
  {
    const tapeJson = await p2.page.evaluate(() => window.__bbGame.registry.get('lastGhostTape'));
    const tab2 = await open();
    const TABS = 'CEMETERY68-TABS';
    const both = [p2.page, tab2.page];
    const libBefore = await p2.page.evaluate(() => JSON.stringify([...window.__bbGame.registry.get('ghostLibrary').courses]));
    // Both tabs start from the same (empty for this course) cache, then fire at the same instant.
    const race = (keep, tag) => {
      const at = Date.now() + 400;
      return Promise.all(both.map((pg, i) => pg.evaluate(async ({ tape, i, at, keep, tag, seed }) => {
        const h = window.__bbGame.registry.get('attemptHistory');
        while (Date.now() < at) await new Promise((r) => setTimeout(r, 1));
        return h.record({ ...tape, seed, biomeMask: 0, runId: `${tag}-tab${i}`, endedAt: at }, keep);
      }, { tape: tapeJson, i, at, keep, tag, seed: TABS })));
    };
    const disk = () => p2.page.evaluate(async (seed) => {
      const db = await new Promise((r) => { const q = indexedDB.open('bitstream-attempt-history'); q.onsuccess = () => r(q.result); });
      const rows = await new Promise((r) => { const q = db.transaction('meta').objectStore('meta').getAll(); q.onsuccess = () => r(q.result); });
      db.close();
      return rows.filter((m) => m.key.startsWith(seed + '|')).sort((a, b) => a.seq - b.seq).map((m) => ({ id: m.id, seq: m.seq }));
    }, TABS);
    const r1 = await race(5, 'race5');
    const d1 = await disk();
    assert.deepEqual(r1.map((r) => r.ok), [true, true], JSON.stringify(r1));
    assert.equal(new Set(d1.map((m) => m.seq)).size, 2, `distinct ordinals ${JSON.stringify(d1)}`);
    assert.ok(d1[1].seq > d1[0].seq);
    const r2 = await race(1, 'race1');
    const d2 = await disk();
    const newest = r2[0].seq > r2[1].seq ? 'race1-tab0' : 'race1-tab1';
    assert.deepEqual(d2.map((m) => m.id), [newest], `keep=1 race leaves only the newest: ${JSON.stringify({ r2, d2 })}`);
    // Tab 2's cache predates tab 1's newest write; its trim and a record at keep 5 must plan from disk.
    await tab2.page.evaluate(() => window.__bbGame.registry.get('attemptHistory').trim(5));
    assert.deepEqual((await disk()).map((m) => m.id), [newest], 'stale trim changed nothing');
    const seqAfter = await tab2.page.evaluate(async ({ tape, seed }) => (await window.__bbGame.registry.get('attemptHistory')
      .record({ ...tape, seed, biomeMask: 0, runId: 'late-tab1', endedAt: 1 }, 5)).seq, { tape: tapeJson, seed: TABS });
    const d3 = await disk();
    assert.deepEqual(d3.map((m) => m.id), [newest, 'late-tab1']);
    assert.ok(seqAfter > d2[0].seq, 'ordinal continues from disk, not the stale cache');
    await tab2.page.evaluate((seed) => window.__bbGame.registry.get('attemptHistory').clear(seed, 0), TABS);
    assert.deepEqual(await disk(), []);
    const libAfter = await p2.page.evaluate(() => JSON.stringify([...window.__bbGame.registry.get('ghostLibrary').courses]));
    assert.equal(libAfter, libBefore, 'GhostLibrary untouched by racing tabs');
    assert.deepEqual(tab2.errors, []);
    report.steps.twoTabs = { race5: d1, race1: d2, late: d3 };
    console.log('CEMETERY_TWO_TABS_PASS', JSON.stringify(report.steps.twoTabs));
    await tab2.page.close();
  }

  // 10. OPT-OUT ACROSS TABS (PR #378 review P1, second): Tab A saves PAST ATTEMPTS TO KEEP = 0 through the real
  //     settings path; Tab B, still showing 5, finishes a real run: nothing is stored, Tab B adopts 0 (an unrelated save
  //     there cannot restore 5), and after a reload the history is still empty. Then 5 -> 2 trims in the other tab and
  //     0 -> 5 re-enables recording. GhostLibrary untouched, no network writes.
  {
    const OPT = 'CEMETERY68-OPTOUT';
    const tabA = p2.page;
    await setSetting(tabA, 'attemptHistoryKeep', 5);
    const { page: tabB, errors: tabBErrors } = await open();
    const rows = () => tabA.evaluate(async (seed) => {
      const db = await new Promise((r) => { const q = indexedDB.open('bitstream-attempt-history'); q.onsuccess = () => r(q.result); });
      const all = await new Promise((r) => { const q = db.transaction('meta').objectStore('meta').getAll(); q.onsuccess = () => r(q.result); });
      db.close();
      return all.filter((m) => m.key.startsWith(seed + '|')).sort((a, b) => a.seq - b.seq).map((m) => m.id);
    }, OPT);
    const keepIn = (pg) => pg.evaluate(() => ({ live: window.__bbGame.registry.get('settings').attemptHistoryKeep,
      persisted: JSON.parse(localStorage.getItem('bb.settings')).attemptHistoryKeep }));
    const libBefore = await tabA.evaluate(() => JSON.stringify([...window.__bbGame.registry.get('ghostLibrary').courses]));
    assert.deepEqual([await keepIn(tabA), await keepIn(tabB)].map((k) => k.live), [5, 5]);
    await setSetting(tabA, 'attemptHistoryKeep', 0);
    const bRun = await run(tabB, OPT, 1400);
    await tabB.waitForTimeout(300);
    assert.deepEqual(await rows(), [], `Tab B stored a run after Tab A chose 0: ${bRun}`);
    assert.deepEqual(await keepIn(tabB), { live: 0, persisted: 0 }, 'Tab B adopted 0');
    await setSetting(tabB, 'palette', 'colorblind'); // unrelated save in Tab B must not write 5 back
    assert.equal((await keepIn(tabA)).persisted, 0, 'unrelated save restored the old keep value');
    await setSetting(tabB, 'palette', 'default');
    await tabB.reload({ waitUntil: 'domcontentloaded' });
    await tabB.waitForFunction(() => window.__bbGame?.registry?.get('attemptHistory')?.ready, null, { timeout: 60000 });
    assert.deepEqual(await rows(), [], 'still empty after reload');
    assert.equal(await tabB.evaluate((seed) => [...window.__bbGame.registry.get('attemptHistory').metas.values()].filter((m) => m.key.startsWith(seed + '|')).length, OPT), 0, 'history view empty after reload');
    // 0 -> 5 in Tab A re-enables recording for Tab B; then 5 -> 2 in Tab A trims what Tab B stored.
    await setSetting(tabA, 'attemptHistoryKeep', 5);
    await tabB.waitForTimeout(200);
    const kept = [];
    for (let i = 0; i < 4; i++) kept.push(await run(tabB, OPT, 900 + i * 100));
    assert.deepEqual(await rows(), kept, 're-enabled after 0 -> 5');
    await setSetting(tabA, 'attemptHistoryKeep', 2);
    await tabB.waitForTimeout(300);
    assert.deepEqual(await rows(), kept.slice(2), '5 -> 2 trimmed the oldest');
    assert.equal((await keepIn(tabB)).live, 2, 'Tab B followed 2 via the storage event');
    const libAfter = await tabA.evaluate(() => JSON.stringify([...window.__bbGame.registry.get('ghostLibrary').courses].filter(([k]) => !k.startsWith('CEMETERY68-OPTOUT|'))));
    assert.equal(libAfter, JSON.stringify(JSON.parse(libBefore).filter(([k]) => !k.startsWith('CEMETERY68-OPTOUT|'))), 'other ghost-library courses untouched');
    await setSetting(tabA, 'attemptHistoryKeep', 5);
    assert.deepEqual(tabBErrors, []);
    report.steps.optOut = { afterZero: [], reenabled: kept, afterTrim2: kept.slice(2) };
    console.log('CEMETERY_OPTOUT_TWO_TABS_PASS', JSON.stringify(report.steps.optOut));
    await tabB.close();
  }

  // 11. UNRELATED SAVE IN A NOT-YET-NOTIFIED TAB (PR #382 review, Morgan): Tab A chooses PAST ATTEMPTS TO KEEP = 0 through
  //     the real Settings screen; Tab B, whose storage event is held back (it has not heard yet), changes its PALETTE
  //     through the real Settings screen. The saved limit must stay 0, and Tab B's next real run must store nothing.
  {
    const ORD = 'CEMETERY68-ORDER';
    await setSetting(p2.page, 'attemptHistoryKeep', 5);
    const A = await open();
    const B = await open();
    // Hold back Tab B's storage events: a capture listener registered first stops them reaching the game's listener.
    await B.page.evaluate(() => {
      window.__holdStorage = true;
      window.addEventListener('storage', (e) => { if (window.__holdStorage) e.stopImmediatePropagation(); }, true);
    });
    const viaSettings = (pg, label, value, sub) => pg.evaluate(({ label, value, sub }) => {
      const ts = window.__bbGame.scene.getScene('TitleScene');
      if (!ts.view) ts.menu.items.find((i) => i.label === 'SETTINGS').onSelect();
      let menu = ts.view.menu;
      if (sub) { if (!ts.view.historyView) menu.items.find((i) => i.label === sub).onSelect(); menu = ts.view.historyView.menu; }
      menu.items.find((i) => i.label === label).set(value);
      return JSON.parse(localStorage.getItem('bb.settings')).attemptHistoryKeep;
    }, { label, value, sub });
    const rowsFor = (pg) => pg.evaluate(async (seed) => {
      const db = await new Promise((r) => { const q = indexedDB.open('bitstream-attempt-history'); q.onsuccess = () => r(q.result); });
      const all = await new Promise((r) => { const q = db.transaction('meta').objectStore('meta').getAll(); q.onsuccess = () => r(q.result); });
      db.close();
      return all.filter((m) => m.key.startsWith(seed + '|')).map((m) => m.id);
    }, ORD);
    assert.equal(await B.page.evaluate(() => window.__bbGame.registry.get('settings').attemptHistoryKeep), 5);
    assert.equal(await viaSettings(A.page, 'PAST ATTEMPTS TO KEEP', 0, 'PAST ATTEMPTS'), 0);
    await B.page.waitForTimeout(300);
    assert.equal(await B.page.evaluate(() => window.__bbGame.registry.get('settings').attemptHistoryKeep), 5, 'B must not have heard yet');
    const afterPalette = await viaSettings(B.page, 'PALETTE', 'colorblind');
    assert.equal(afterPalette, 0, `an unrelated PALETTE save in Tab B restored the limit to ${afterPalette}`);
    await B.page.evaluate(() => { const ts = window.__bbGame.scene.getScene('TitleScene'); ts._closeView?.(); });
    const bRun = await run(B.page, ORD, 1400);
    await B.page.waitForTimeout(300);
    assert.deepEqual(await rowsFor(B.page), [], `Tab B stored ${bRun} after an unrelated save`);
    await viaSettings(A.page, 'PALETTE', 'default');
    await setSetting(A.page, 'attemptHistoryKeep', 5);
    assert.deepEqual([...A.errors, ...B.errors], []);
    report.steps.unrelatedSave = { persistedAfterPalette: afterPalette, rows: [] };
    console.log('CEMETERY_UNRELATED_SAVE_PASS', JSON.stringify(report.steps.unrelatedSave));
    await A.page.close();
    await B.page.close();
  }

  // 6. reduced motion via the OS preference under AUTO
  await setSetting(p2.page, 'reduceMotion', 'auto');
  await p2.page.close();
  const rmPage = await ctx.newPage();
  await rmPage.emulateMedia({ reducedMotion: 'reduce' });
  const rmErrors = [];
  rmPage.on('pageerror', (e) => rmErrors.push(String(e)));
  await rmPage.goto(url, { waitUntil: 'domcontentloaded' });
  await rmPage.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive() && window.__bbGame.registry.get('attemptHistory')?.ready, null, { timeout: 60000 });
  await run(rmPage, SEED, 900);
  await rmPage.keyboard.press('m');
  await rmPage.waitForFunction(() => window.__bbGame.scene.getScene('GameOverScene').ghostView?.montage, null, { timeout: 10000 });
  await rmPage.waitForTimeout(800);
  const rm1 = await rmPage.evaluate(() => { const m = window.__bbGame.scene.getScene('GameOverScene').ghostView.montage; return { reduced: m.reduced, playing: m.playing, mode: m.mode, atEnd: m.tick === m.plan.playEndTick }; });
  await rmPage.keyboard.press('Enter');
  await rmPage.keyboard.press('ArrowUp');
  await rmPage.waitForTimeout(300);
  const rm2 = await rmPage.evaluate(() => { const m = window.__bbGame.scene.getScene('GameOverScene').ghostView.montage; return { playing: m.playing, mode: m.mode }; });
  assert.deepEqual(rm1, { reduced: true, playing: false, mode: 'overview', atEnd: true });
  assert.deepEqual(rm2, { playing: false, mode: 'overview' });
  if (shotDir) await rmPage.screenshot({ path: `${shotDir}/cemetery-reduced.png` });
  await rmPage.keyboard.press('Escape');
  assert.deepEqual(rmErrors, []);
  console.log('CEMETERY_REDUCED_MOTION_PASS', JSON.stringify(rm1));
  await rmPage.close();

  }

  // 8. performance sweep
  const perf = [];
  for (const tier of ['low', 'standard']) {
  const pp = await open(tier);
  await setSetting(pp.page, 'cemeteryMontage', 'swarm');
  await setSetting(pp.page, 'attemptHistoryKeep', 40);
  await setSetting(pp.page, 'reduceMotion', 'off');
  await pp.page.evaluate(() => window.__bbGame.registry.get('attemptHistory').clear());
  console.log('perf tier', tier);
  const heroId = await run(pp.page, SEED, 2500);
  console.log('perf hero', heroId);
  const frameStats = () => pp.page.evaluate(async () => {
    const frames = [];
    let last = performance.now();
    await new Promise((res) => { const f = (t) => { frames.push(t - last); last = t; if (frames.length < 240) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
    return { p50: q(frames.slice(10), 0.5), p95: q(frames.slice(10), 0.95) };
  });
  const base = await frameStats();
  perf.push({ tier, attempts: 'baseline (Game Over, no montage)', frameP50: base.p50, frameP95: base.p95 });
  for (const n of [5, 10, 20, 40]) {
    const w = await pp.page.evaluate(async ({ n }) => {
      const g = window.__bbGame, h = g.registry.get('attemptHistory'), hero = g.registry.get('lastGhostTape');
      await h.clear();
      const b64 = (f) => { const u = new Uint8Array(f.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
      const src = (() => { const s = atob(hero.trace); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); })();
      // Synthetic QA attempts of realistic length (20-80 s at 30 Hz): this device's real trace, tiled end to end so the
      // path continues downhill, cut at a different point per attempt and nudged so riders separate.
      const ns = src.length / 3, dx = src[(ns - 1) * 3] - src[0], dy = src[(ns - 1) * 3 + 1] - src[1];
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        const samples = Math.round(30 * (20 + ((i * 37) % 61)));
        const f = new Float32Array(samples * 3);
        for (let k = 0; k < samples; k++) {
          const tile = Math.floor(k / ns), j = k % ns;
          f[k * 3] = src[j * 3] + tile * dx - i * 3; f[k * 3 + 1] = src[j * 3 + 1] + tile * dy - (i % 7) * 2; f[k * 3 + 2] = src[j * 3 + 2];
        }
        await h.record({ ...hero, runId: `synthetic-qa-${i}`, endedAt: i + 1, trace: b64(f), inputs: [], checkpoints: [] }, 40);
      }
      return { writeMs: performance.now() - t0, stats: h.stats() };
    }, { n });
    const t0 = Date.now();
    await pp.page.keyboard.press('m');
    await pp.page.waitForFunction(() => window.__bbGame.scene.getScene('GameOverScene').ghostView?.montage, null, { timeout: 90000, polling: 'raf' });
    const openMs = Date.now() - t0;
    const m = await pp.page.evaluate(async () => {
      const v = window.__bbGame.scene.getScene('GameOverScene').ghostView, mo = v.montage;
      const real = mo.update.bind(mo);
      const cost = [];
      mo.update = (dt) => { const t = performance.now(); const r = real(dt); cost.push(performance.now() - t); return r; };
      mo.tick = Math.min(mo.plan.playEndTick * 0.15, 600); mo.playing = true; mo.finished = false; mo.setMode('follow');
      const frames = [];
      let last = performance.now();
      await new Promise((res) => { const f = (t) => { frames.push(t - last); last = t; if (frames.length < 360) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
      const mean = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3);
      return { riders: mo.plan.riders.length, drawnMax: mo.gov.max, budgetEnd: mo.gov.riders, degraded: mo.gov.degraded,
        frameP50: q(frames.slice(10), 0.5), frameP95: q(frames.slice(10), 0.95), updateMeanMs: mean(cost), updateP95: q(cost, 0.95) };
    });
    await pp.page.keyboard.press('Escape');
    await pp.page.waitForFunction(() => !window.__bbGame.scene.getScene('GameOverScene').ghostView, null, { timeout: 5000 });
    console.log('perf step', tier, n, openMs);
    perf.push({ tier, attempts: n, storedKB: +(w.stats.bytes / 1024).toFixed(1), writeMsTotal: +w.writeMs.toFixed(1), openMs, ...m });
  }
  assert.deepEqual(pp.errors, []);
  await pp.page.close();
  }
  report.perf = perf;
  console.table(perf);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, [], `no network writes: ${writes.join(', ')}`);
  console.log('CEMETERY_PERF', JSON.stringify(perf));
  if (outJson) await writeFile(outJson, JSON.stringify(report, null, 2));
  console.log('CEMETERY_BROWSER_PASS');
} finally {
  await ctx.close();
  await rm(profile, { recursive: true, force: true });
}
