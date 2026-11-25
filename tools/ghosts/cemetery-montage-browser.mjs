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
  const heroId = await run(pp.page, SEED, 2500);
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
