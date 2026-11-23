/* Cross-engine replay conformance matrix (issue #120). DIAGNOSTIC, NON-AUTHORITATIVE: see docs/determinism/cross-engine-matrix.md.
 *
 *   npm run build && npx vite preview --port 8412 &
 *   CE_TAPE_DIR=/tmp/bsb-ce-sim6-NEW GAME_URL=http://localhost:8412/ xvfb-run -a node tools/conformance/cross-engine.mjs record  # new folder only
 *   GAME_URL=http://localhost:8412/ xvfb-run -a node tools/conformance/cross-engine.mjs matrix            # replay everywhere, write results
 *   ... cross-engine.mjs matrix --resume    # continue an interrupted matrix: finished sessions are read from the journal
 *   node tools/conformance/cross-engine.mjs scout [fixtureId]                                             # explore autopilot outcomes
 *
 * Env: CE_TAPE_DIR (required NEW absolute output for record; optional replay input for matrix/fresh/positions),
 *      ENGINES (comma list; default all), HZ (default 30,60,120,144), SESSIONS (fresh browser contexts per engine/cadence, default 2),
 *      FIXTURES (comma ids), OUT (results json), RASTER=1 (really rasterise WebGL frames; default skips only the GPU draw call).
 * Firefox has no usable headless WebGL here, so it runs headed: wrap the command in xvfb-run (Mesa llvmpipe).
 * Playwright WebKit is NOT iPhone Safari (different OS, GPU, JIT/libm); a pass here says nothing about real Safari/iOS.
 */
import { chromium, firefox, webkit } from 'playwright';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from './cross-engine-fixtures.mjs';
import { selectTapeDirectory, prepareRecordingDirectory } from './cross-engine-paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.GAME_URL || 'http://localhost:8412/';
const HZ = (process.env.HZ || '30,60,120,144').split(',').map(Number);
const SESSIONS = Number(process.env.SESSIONS || 2);
const RASTER = process.env.RASTER === '1';
const historicalTapeDir = path.join(here, 'fixtures', 'cross-engine');
const cmd = process.argv[2];
const TAPE_DIR = selectTapeDirectory({ mode: cmd, explicit: process.env.CE_TAPE_DIR, historical: historicalTapeDir });
const OUT = process.env.OUT || path.join(here, '..', '..', 'docs', 'determinism', 'results', 'cross-engine-results.json');
const fixtureFilter = process.env.FIXTURES ? process.env.FIXTURES.split(',') : null;
const fixtures = FIXTURES.filter((f) => !fixtureFilter || fixtureFilter.includes(f.id));
// The game derives the Daily rule for ordinary seeds from the wall-clock DATE (RunScene: getDailyInfo()), and the tape header does not pin it, so the same
// tape replays differently on a different calendar day (finding, see docs). The harness therefore pins the page clock to the day the fixtures were recorded.
const PIN_DATE = process.env.CE_DATE || '2026-11-21T12:00:00Z';
const RESUME = process.argv.includes('--resume') || process.env.RESUME === '1';
// Journal: every finished cell (engine x fixture x cadence x session x run) is appended as one JSON line the moment it completes.
// With --resume, sessions already fully journaled are skipped (a session is the unit of replay state: a half-finished session is re-run from
// run 1, because a run's result can depend on the runs before it in the same page). Math diagnoses are journaled too.
const JOURNAL = process.env.JOURNAL || path.join(here, '.cache', 'cross-engine.journal.jsonl');
async function jwrite(obj) { await appendFile(JOURNAL, JSON.stringify(obj) + '\n'); }
async function jload(fp) {
  const out = { rows: [], done: new Set(), envs: {}, diag: {}, stale: false };
  if (!RESUME || !existsSync(JOURNAL)) return out;
  const pending = new Map();
  const lines = (await readFile(JOURNAL, 'utf8')).split('\n');
  // The journal is only reusable for the SAME build, URL, page clock, harness code and fixture tapes; otherwise every cell is stale.
  const head = lines.find((l) => l.includes('"k":"fingerprint"'));
  const jf = head ? JSON.parse(head).fp : null;
  if (!jf || JSON.stringify(jf) !== JSON.stringify(fp)) { out.stale = true; return out; }
  for (const line of lines) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const sk = `${o.engine}|${o.hz}|${o.session}`;
    if (o.k === 'row') { const a = pending.get(sk) || []; a.push(o.row); pending.set(sk, a); }
    else if (o.k === 'sessionDone') { out.done.add(sk); out.rows.push(...(pending.get(sk) || [])); pending.delete(sk); }
    else if (o.k === 'env') out.envs[o.name] = o.env;
    else if (o.k === 'diag') out.diag[o.key] = o.value;
  }
  return out;
}
const REF = { engine: 'chromium-headless-shell', hz: 120 };

const SWIFT = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
const ENGINES = {
  'chromium-headless-shell': () => ({ type: chromium, opts: { headless: true, executablePath: findHeadlessShell(), args: SWIFT }, headlessLabel: 'headless (chrome-headless-shell, SwiftShader)' }),
  'chromium-full-headless': () => ({ type: chromium, opts: { headless: true, executablePath: findFullChrome(), args: [...SWIFT, '--headless=new'] }, headlessLabel: 'headless=new (full Chromium, SwiftShader)' }),
  'chromium-shell-defaultgl': () => ({ type: chromium, opts: { headless: true, executablePath: findHeadlessShell(), args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist'] }, headlessLabel: 'headless (chrome-headless-shell, default GL, no ANGLE flags)' }),
  firefox: () => ({ type: firefox, opts: { headless: false, env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' } }, needsDisplay: true, headlessLabel: 'HEADED under Xvfb (headless Firefox has no WebGL here; Mesa llvmpipe)' }),
  webkit: () => ({ type: webkit, opts: { headless: true }, headlessLabel: 'headless (Playwright WebKit, not Safari)' }),
};
function findBrowserExe(dirRe, rel) {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of existsSync(root) ? readdirSync(root).sort().reverse() : []) {
    const p = path.join(root, d, ...rel);
    if (dirRe.test(d) && existsSync(p)) return p;
  }
  return null;
}
function findHeadlessShell() { return findBrowserExe(/^chromium_headless_shell-\d/, ['chrome-headless-shell-linux64', 'chrome-headless-shell']); }
function findFullChrome() { return findBrowserExe(/^chromium-\d/, ['chrome-linux64', 'chrome']); }
const engineNames = (process.env.ENGINES || Object.keys(ENGINES).join(',')).split(',');

const pageJs = await readFile(path.join(here, 'cross-engine-page.js'), 'utf8');
const gitSha = (() => { try { return execSync('git rev-parse HEAD', { cwd: here }).toString().trim(); } catch { return null; } })();

async function launch(name) {
  const cfg = ENGINES[name]();
  if (cfg.opts.executablePath === null) throw new Error(`no executable found for ${name}`);
  if (cfg.needsDisplay && !process.env.DISPLAY) throw new Error('needs DISPLAY (run under xvfb-run)');
  const browser = await cfg.type.launch(cfg.opts);
  return { browser, cfg };
}
async function freshPage(browser, patch = null, date = PIN_DATE) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  await page.addInitScript(`(() => { const R = Date, base = R.parse(${JSON.stringify(date)}), t0 = R.now();
    const now = () => base + (R.now() - t0);
    function D(...a) { return a.length ? new R(...a) : new R(now()); }
    D.prototype = R.prototype; D.now = now; D.parse = R.parse; D.UTC = R.UTC; window.Date = D; })();`);
  if (patch) await page.addInitScript(`window.__cePatch = ${JSON.stringify(patch)};`);
  await page.addInitScript(pageJs);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive() && window.__ce, null, { timeout: 60000 });
  return { ctx, page, errors };
}
const play = (page, o) => page.evaluate((x) => window.__ce.play(x), { raster: RASTER, ...o });

const SUBNAMES = ['rng', 'timers', 'terrain', 'kodiaks', 'bsod', 'sled', 'world', 'score', 'telegraph', 'derived'];
// The recorded profile Sync Level. BsodPursuit and Kodiak gating read the LIVE profile level, which the tape header does not carry.
// Recording uses Sync Level 8 for the Kodiak fixture. Replays now use a profile at level 1 on purpose: since the Replay Contract v1.1 header fields
// (syncLevel, dailyRuleSource) the tape must govern, so a mismatching profile or clock must NOT change the replay (checked in `record`).
const recordLevelOf = (f) => (f.kodiaks ? 8 : 1);
const levelOf = () => 1;
const tapePath = (f) => path.join(TAPE_DIR, `${f.id}.tape.json`);
async function loadTape(f) { return JSON.parse(await readFile(tapePath(f), 'utf8')); }

// ---------------------------------------------------------------- comparison
function compareDigests(ref, got) {
  // Causal state = digest groups 0-7. Group 8 (telegraph, camera-derived) and 9 (heightAt/slopeAt probe reads) are reported separately and never count as divergence.
  const n = Math.min(ref.length, got.length);
  let first = null, tele = null, derived = null;
  for (let i = 0; i < n; i++) {
    const subs = [];
    for (let k = 0; k < 8; k++) if (ref[i][k] !== got[i][k]) subs.push(k);
    if (subs.length && first === null) first = { tick: i + 1, subs };
    if (ref[i][8] !== got[i][8] && tele === null) tele = i + 1;
    if (ref[i][9] !== got[i][9] && derived === null) derived = i + 1;
    if (first && tele && derived) break;
  }
  return { first, telegraphTick: tele, derivedTick: derived, lengthMismatch: ref.length !== got.length ? [ref.length, got.length] : null };
}
function ulpDiff(a, b) { const f = new Float64Array(2); const u = new BigInt64Array(f.buffer); f[0] = a; f[1] = b; const d = u[0] - u[1]; return Number(d < 0n ? -d : d); }
function rawDelta(refRaw, gotRaw, tick) {
  const a = refRaw[tick - 1], b = gotRaw[tick - 1];
  if (!a || !b) return null;
  const names = ['x', 'y', 'angle', 'vx', 'vy', 'w'];
  return names.map((n, i) => ({ n, ref: a[i], got: b[i], ulp: ulpDiff(a[i], b[i]) })).filter((d) => d.ulp > 0);
}
function roll(d) { let h = 0x811c9dc5; for (const r of d) for (const v of r) { h ^= v >>> 0; h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------- record
async function record() {
  await prepareRecordingDirectory(TAPE_DIR, historicalTapeDir);
  const { browser, cfg } = await launch('chromium-headless-shell');
  const meta = [];
  try {
    for (const f of fixtures) {
      const { ctx, page, errors } = await freshPage(browser);
      for (let i = 0; i < (f.preRuns || 0); i++) await play(page, { seed: `${f.seed}-PRE${i + 1}`, hz: 120, style: 'cruise', maxTicks: 700, rngSeed: i + 1 });
      const rec = await play(page, { seed: f.seed, hz: 120, style: f.style, params: f.params, maxTicks: f.maxTicks, kodiaks: !!f.kodiaks, rngSeed: f.rngSeed || 1 });
      await ctx.close();
      if (!rec.tape) throw new Error(`${f.id}: no tape produced`);
      // Re-verify in a FRESH browser context (new page, empty IndexedDB, run #1 of that session), live vs replay.
      const v = await freshPage(browser);
      const rep = await play(v.page, { seed: f.seed, hz: 120, tape: rec.tape, level: levelOf(f) });
      await v.ctx.close();
      const cmp = compareDigests(rec.digests, rep.digests);
      // Live runs stop at maxTicks; replay runs one tick past the tape end (a crash lands on endTick + 1), so lengths may differ by 1.
      const ok = !cmp.first && (!cmp.lengthMismatch || Math.abs(cmp.lengthMismatch[0] - cmp.lengthMismatch[1]) <= 1) && !rep.tapeCheck.desync;
      // Date independence: same tape, page clock moved to another day. Must be identical now that the header carries dailyRuleSource.
      let dateIndependence;
      { const w = await freshPage(browser, null, '2026-12-25T12:00:00Z');
        const alt = await play(w.page, { seed: f.seed, hz: 120, tape: rec.tape, level: 1 });
        await w.ctx.close();
        const c3 = compareDigests(rec.digests, alt.digests);
        dateIndependence = { altDate: '2026-12-25', ok: !c3.first && !alt.tapeCheck.desync, first: c3.first && { tick: c3.first.tick, subsystems: c3.first.subs.map((k) => SUBNAMES[k]) }, desync: alt.tapeCheck.desync && { tick: alt.tapeCheck.desync.tick }, outcome: { ticks: alt.outcome.ticks, distanceM: alt.outcome.distanceM, score: alt.outcome.score } }; }
      let levelSensitivity = null;
      if (recordLevelOf(f) !== 1) {
        // Same tape, same engine, same cadence, but a fresh profile at Sync Level 1: does the replay still match?
        const w = await freshPage(browser);
        const alt = await play(w.page, { seed: f.seed, hz: 120, tape: rec.tape, level: 1 });
        await w.ctx.close();
        const c2 = compareDigests(rec.digests, alt.digests);
        levelSensitivity = { recordedLevel: recordLevelOf(f), replayLevel: 1, first: c2.first && { tick: c2.first.tick, subsystems: c2.first.subs.map((k) => SUBNAMES[k]) }, desync: alt.tapeCheck.desync && { tick: alt.tapeCheck.desync.tick }, outcome: { ticks: alt.outcome.ticks, crashed: alt.outcome.crashed, cause: alt.outcome.cause, distanceM: alt.outcome.distanceM, score: alt.outcome.score } };
      }
      const entry = { id: f.id, preRuns: f.preRuns || 0, covers: f.covers, outcome: rec.outcome, tapeInputs: rec.tape.inputs.length, checkpoints: rec.tape.checkpoints.length,
        endTick: rec.tape.endTick, recordLevel: recordLevelOf(f), dateIndependence, liveVsFreshContextReplay: { ok, first: cmp.first && { tick: cmp.first.tick, subsystems: cmp.first.subs.map((k) => SUBNAMES[k]) }, lengths: [rec.digests.length, rep.digests.length], desync: rep.tapeCheck.desync && { tick: rep.tapeCheck.desync.tick }, checked: rep.tapeCheck.checked }, levelSensitivity, pageErrors: [...errors, ...v.errors] };
      meta.push(entry);
      await writeFile(tapePath(f), JSON.stringify(rec.tape), { flag: 'wx' });
      console.log(f.id, JSON.stringify({ ticks: rec.outcome.ticks, crashed: rec.outcome.crashed, cause: rec.outcome.cause, distanceM: rec.outcome.distanceM, score: rec.outcome.score, stats: rec.outcome.stats, liveVsReplayOk: ok }));
    }
  } finally { await browser.close(); }
  await writeFile(path.join(TAPE_DIR, 'record-meta.json'), JSON.stringify({ gitSha, recordedAt: new Date().toISOString(), fixtures: meta }, null, 1), { flag: 'wx' });
}

// ---------------------------------------------------------------- scout
async function scout() {
  const { browser } = await launch('chromium-headless-shell');
  try {
    for (const f of fixtures) {
      const { page } = await freshPage(browser);
      const t0 = Date.now();
      const r = await play(page, { seed: f.seed, hz: 120, style: f.style, params: f.params, maxTicks: f.maxTicks, kodiaks: !!f.kodiaks, rngSeed: f.rngSeed || 1 });
      console.log(f.id, JSON.stringify({ ms: Date.now() - t0, ...r.outcome }));
    }
  } finally { await browser.close(); }
}

// ---------------------------------------------------------------- matrix
async function mathDiagnose(refEngine, badEngine, f, tape, hz, divTick) {
  const caps = [...new Set([1, 2, divTick])];
  const run = async (name, rate) => {
    const { browser } = await launch(name);
    try { const { page } = await freshPage(browser); return await play(page, { seed: f.seed, hz: rate, tape, level: levelOf(f), mathTrace: true, captureTicks: caps }); } finally { await browser.close(); }
  };
  const a = await run(refEngine, REF.hz), b = await run(badEngine, hz);
  const FN = ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'pow', 'exp', 'log', 'sqrt', 'hypot', 'cbrt', 'sinh', 'cosh', 'tanh', 'expm1', 'log1p', 'log2', 'log10'];
  const n = Math.min(a.math.length, b.math.length);
  // (1) implementation-level differences: calls whose arguments matched but whose results differ, over the whole run, per function.
  const impl = {};
  let firstMathDiffTick = null;
  for (let i = 0; i < n; i++) FN.forEach((name, k) => {
    const ra = a.math[i].slice(k * 3, k * 3 + 3), rb = b.math[i].slice(k * 3, k * 3 + 3);
    if (ra[0] === rb[0] && ra[1] === rb[1] && ra[2] !== rb[2]) {
      impl[name] = impl[name] || { ticksWithDiff: 0, firstTick: i + 1 };
      impl[name].ticksWithDiff++;
      if (firstMathDiffTick === null) firstMathDiffTick = i + 1;
    }
  });
  // (2) at the captured ticks, the exact calls (args equal, results differ) with ULP distance.
  const examples = [];
  for (const T of caps) {
    const ca = a.mathCalls.filter((c) => c[0] === T), cb = b.mathCalls.filter((c) => c[0] === T);
    const by = (list) => { const mm = {}; for (const c of list) (mm[c[1]] = mm[c[1]] || []).push(c); return mm; };
    const ma = by(ca), mb = by(cb);
    for (const name of Object.keys(ma)) {
      const x = ma[name], y = mb[name] || [];
      let diffs = 0, ex = null;
      for (let j = 0; j < Math.min(x.length, y.length); j++) {
        if (JSON.stringify(x[j][2]) === JSON.stringify(y[j][2]) && x[j][3] !== y[j][3]) { diffs++; if (!ex) ex = { fn: name, args: x[j][2], refResult: x[j][3], gotResult: y[j][3], ulp: ulpDiff(x[j][3], y[j][3]) }; }
      }
      if (ex || x.length !== y.length) examples.push({ tick: T, fn: name, calls: [x.length, y.length], differingCalls: diffs, example: ex });
    }
  }
  const atDiv = examples.filter((e) => e.tick === divTick);
  const fresh = compareDigests(a.digests, b.digests); // both runs are run #1 of fresh contexts: free of session-position effects
  return { divergentTick: divTick, freshContextFirstDivergentTick: fresh.first ? fresh.first.tick : null, freshContextSubsystems: fresh.first ? fresh.first.subs.map((k) => SUBNAMES[k]) : null, implementationDiffs: impl, firstMathDiffTick, examples, suspectAtDivergentTick: atDiv.map((e) => e.fn),
    note: atDiv.length ? 'Math.* calls with identical arguments but different results occur on the first divergent tick.' : 'No Math.* call with identical arguments differed on the first divergent tick: cause may be a non-libm float effect (e.g. FMA/op ordering) or a differing Math call whose arguments already differed.' };
}

/** Counterfactual: make the differing Math ops engine-independent (pure-JS) in BOTH engines; does the divergence persist? */
async function counterfactual(refEngine, badEngine, f, tape, hz, fns) {
  const run = async (name, rate) => {
    const { browser } = await launch(name);
    try { const { page } = await freshPage(browser, fns); return await play(page, { seed: f.seed, hz: rate, tape, level: levelOf(f) }); } finally { await browser.close(); }
  };
  const a = await run(refEngine, REF.hz), b = await run(badEngine, hz);
  const cmp = compareDigests(a.digests, b.digests);
  const det = await (async () => { const { browser } = await launch(REF.engine); try { const { page } = await freshPage(browser); return await page.evaluate(() => window.__ce.detNames()); } finally { await browser.close(); } })();
  return { patchedFns: fns, unreplacedFns: fns.filter((x) => !det.includes(x)), scope: `${hz} Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at ${REF.hz} Hz`, note: 'patched A == patched B; the patched sim is NOT the recorded sim, so TapePlayer desyncs from the recording (tapeDesyncBad)', firstDivergentTick: cmp.first ? cmp.first.tick : null, subsystem: cmp.first ? cmp.first.subs.map((k) => SUBNAMES[k]) : null, tapeDesyncBad: b.tapeCheck.desync && { tick: b.tapeCheck.desync.tick },
    refOutcome: a.outcome && { ticks: a.outcome.ticks, crashed: a.outcome.crashed, cause: a.outcome.cause, distanceM: a.outcome.distanceM, score: a.outcome.score },
    badOutcome: { ticks: b.outcome.ticks, crashed: b.outcome.crashed, cause: b.outcome.cause, distanceM: b.outcome.distanceM, score: b.outcome.score } };
}

async function matrix() {
  const tapes = {};
  for (const f of fixtures) {
    if (!existsSync(tapePath(f))) throw new Error(`missing tape ${tapePath(f)}; run the record command first`);
    tapes[f.id] = await loadTape(f);
  }
  await mkdir(path.dirname(JOURNAL), { recursive: true });
  const sha = (x) => createHash('sha256').update(x).digest('hex').slice(0, 16);
  const indexHtml = await (await fetch(url)).text();
  const fp = { buildIndexSha: sha(indexHtml), url, ceDate: PIN_DATE, raster: RASTER, pageJs: sha(pageJs), fixturesFile: sha(await readFile(path.join(here, 'cross-engine-fixtures.mjs'), 'utf8')),
    tapes: Object.fromEntries(Object.entries(tapes).map(([k, t]) => [k, sha(JSON.stringify(t))])) };
  const J = await jload(fp);
  if (J.stale) console.log('RESUME: journal fingerprint differs (build/url/CE_DATE/harness/tapes changed); ignoring stale journal and starting fresh');
  if (!RESUME || J.stale || !existsSync(JOURNAL)) { await writeFile(JOURNAL, ''); await jwrite({ k: 'fingerprint', fp }); }
  else console.log(`RESUME: ${J.done.size} finished sessions, ${J.rows.length} rows, ${Object.keys(J.diag).length} diagnoses restored from ${JOURNAL}`);
  const envs = { ...J.envs };
  const rows = [...J.rows];
  const refs = {}; // fixture id -> { digests, raw, outcome }
  // Reference = each fixture replayed in its OWN fresh context (run #1 of a fresh session) on chromium-headless-shell at 120 Hz.
  // Every later run, at any session position, is compared against it, so state leaking between runs of one session shows up as a divergence.
  {
    const { browser } = await launch(REF.engine);
    for (const f of fixtures) {
      const { ctx, page } = await freshPage(browser);
      const r = await play(page, { seed: f.seed, hz: REF.hz, tape: tapes[f.id], level: levelOf(f) });
      refs[f.id] = { digests: r.digests, raw: r.raw, outcome: r.outcome };
      await ctx.close();
      console.log('REF', f.id, r.outcome.ticks, r.outcome.distanceM + 'm', r.tapeCheck.desync ? 'DESYNC ' + r.tapeCheck.desync.tick : 'no desync');
    }
    await browser.close();
  }
  const names = [REF.engine, ...engineNames.filter((n) => n !== REF.engine)];
  for (const name of names) {
    const hzList = name === REF.engine ? [REF.hz, ...HZ.filter((h) => h !== REF.hz)] : HZ;
    if (envs[name] && (envs[name].unavailable || hzList.every((hz) => Array.from({ length: SESSIONS }, (_, i) => J.done.has(`${name}|${hz}|${i + 1}`)).every(Boolean)))) { console.log(name, 'already complete (resume)'); continue; }
    let L;
    try { L = await launch(name); } catch (e) {
      envs[name] = { unavailable: true, reason: String(e.message).split('\n')[0] };
      await jwrite({ k: 'env', name, env: envs[name] });
      console.log(name, 'UNAVAILABLE', envs[name].reason);
      continue;
    }
    const { browser, cfg } = L;
    envs[name] = { engine: name, browserType: cfg.type.name(), version: browser.version(), headless: cfg.headlessLabel, os: `${os.type()} ${os.release()}`, arch: os.arch(), platform: process.platform, node: process.version, raster: RASTER };
    for (const hz of hzList) {
      for (let session = 1; session <= SESSIONS; session++) {
        if (J.done.has(`${name}|${hz}|${session}`)) { console.log(name, hz, `s${session}`, 'skipped (resume)'); continue; }
        let page, ctx, errors;
        try { ({ page, ctx, errors } = await freshPage(browser)); } catch (e) {
          rows.push({ engine: name, hz, session, error: 'session start failed: ' + String(e.message).split('\n')[0] });
          console.log(name, hz, session, 'SESSION FAILED', e.message.split('\n')[0]);
          continue;
        }
        if (!envs[name].page) { envs[name].page = await page.evaluate(() => window.__ce.env()); await jwrite({ k: 'env', name, env: envs[name] }); }
        // order: all fixtures, then the first fixture again (contamination check)
        const order = [...fixtures, { ...fixtures[0], again: true }];
        let runNo = 0;
        for (const f of order) {
          runNo++;
          const t0 = Date.now();
          let r;
          try { r = await play(page, { seed: f.seed, hz, tape: tapes[f.id], level: levelOf(f) }); } catch (e) {
            const er = { engine: name, hz, session, run: runNo, fixture: f.id, error: String(e.message).split('\n')[0] }; rows.push(er); await jwrite({ k: 'row', engine: name, hz, session, row: er });
            console.log(name, hz, session, runNo, f.id, 'ERROR', e.message.split('\n')[0]);
            break;
          }
          const ref = refs[f.id];
          const cmp = ref ? compareDigests(ref.digests, r.digests) : { first: null, telegraphTick: null, lengthMismatch: null };
          const row = {
            engine: name, hz, session, run: runNo, fixture: f.id + (f.again ? ' (repeat of run 1)' : ''),
            firstDivergentTick: cmp.first ? cmp.first.tick : null,
            subsystem: cmp.first ? cmp.first.subs.map((k) => SUBNAMES[k]) : null,
            telegraphFirstDiffTick: cmp.telegraphTick, derivedFirstDiffTick: cmp.derivedTick,
            outcomeMatchesRef: !!ref && JSON.stringify([r.outcome.ticks, r.outcome.crashed, r.outcome.cause, r.outcome.distanceM, r.outcome.score]) === JSON.stringify([ref.outcome.ticks, ref.outcome.crashed, ref.outcome.cause, ref.outcome.distanceM, ref.outcome.score]),
            lengthMismatch: cmp.lengthMismatch,
            tapeDesync: r.tapeCheck.desync ? { tick: r.tapeCheck.desync.tick } : null, checkpointsChecked: r.tapeCheck.checked,
            outcome: { ticks: r.outcome.ticks, crashed: r.outcome.crashed, cause: r.outcome.cause, distanceM: r.outcome.distanceM, score: r.outcome.score },
            digestRoll: roll(r.digests), frames: r.frames, wallMs: Date.now() - t0,
          };
          if (cmp.first && ref) row.sledDeltaAtFirstTick = rawDelta(ref.raw, r.raw, cmp.first.tick);
          rows.push(row);
          await jwrite({ k: 'row', engine: name, hz, session, row });
          console.log(name, hz, `s${session}`, `#${runNo}`, row.fixture, row.firstDivergentTick ?? 'ok', row.outcome.ticks, row.outcome.distanceM + 'm', `${row.wallMs}ms`);
        }
        if (errors.length) envs[name].pageErrors = [...(envs[name].pageErrors || []), ...errors];
        await ctx.close();
        await jwrite({ k: 'sessionDone', engine: name, hz, session });
      }
    }
    await browser.close();
  }
  // Math-op isolation for the first divergence per (engine, fixture).
  const diagnosed = { ...J.diag };
  for (const row of rows) {
    if (!row.firstDivergentTick || row.engine === REF.engine && false) continue;
    const key = `${row.engine}|${row.fixture.replace(/ \(.*/, '')}`;
    if (diagnosed[key]) continue;
    const f = FIXTURES.find((x) => row.fixture.startsWith(x.id));
    try {
      diagnosed[key] = { engine: row.engine, fixture: f.id, hz: row.hz, ...(await mathDiagnose(REF.engine, row.engine, f, tapes[f.id], row.hz, row.firstDivergentTick)) };
      const fns = Object.keys(diagnosed[key].implementationDiffs || {});
      if (fns.length && process.env.COUNTERFACTUAL !== '0') diagnosed[key].counterfactual = await counterfactual(REF.engine, row.engine, f, tapes[f.id], row.hz, fns);
    } catch (e) { diagnosed[key] = { error: String(e.message).split('\n')[0] }; }
    await jwrite({ k: 'diag', key, value: diagnosed[key] });
    console.log('MATH', key, JSON.stringify(diagnosed[key]).slice(0, 400));
  }
  const result = { issue: 120, diagnostic: true, authoritative: false, note: 'Diagnostic digests only; to be replaced by the #152 contract when published. Playwright WebKit != iPhone Safari.',
    gitSha, fingerprint: fp, generatedAt: new Date().toISOString(), reference: { ...REF, freshContextPerFixture: true }, cadencesHz: HZ, sessionsPerCell: SESSIONS, gameUrl: url,
    environments: envs, fixtures: fixtures.map((f) => ({ id: f.id, seed: f.seed, covers: f.covers, tapeEndTick: tapes[f.id].endTick, refOutcome: refs[f.id]?.outcome })), rows, mathDiagnosis: Object.values(diagnosed) };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(result));
  console.log('WROTE', OUT, rows.length, 'rows');
}

// ---------------------------------------------------------------- fresh-context rows (position-free)
/** Every engine x fixture as run #1 of its OWN fresh context (no earlier run in the page), at FRESH_HZ (default 120). These are the numbers the headline uses,
 *  free of the session-position leak. Journaled per cell; --resume skips finished cells (same fingerprint rules as the matrix). */
async function fresh() {
  const OUTF = process.env.OUT || path.join(here, '..', '..', 'docs', 'determinism', 'results', 'cross-engine-fresh.json');
  const J2 = process.env.JOURNAL || path.join(here, '.cache', 'cross-engine-fresh.journal.jsonl');
  const hzs = (process.env.FRESH_HZ || '120').split(',').map(Number);
  const tapes = {};
  for (const f of fixtures) tapes[f.id] = await loadTape(f);
  const sha = (x) => createHash('sha256').update(x).digest('hex').slice(0, 16);
  const fp = { buildIndexSha: sha(await (await fetch(url)).text()), url, ceDate: PIN_DATE, raster: RASTER, pageJs: sha(pageJs), tapes: Object.fromEntries(Object.entries(tapes).map(([k, t]) => [k, sha(JSON.stringify(t))])) };
  await mkdir(path.dirname(J2), { recursive: true });
  const done = new Map();
  let ok = false;
  if (RESUME && existsSync(J2)) {
    const lines = (await readFile(J2, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    ok = lines[0] && lines[0].k === 'fingerprint' && JSON.stringify(lines[0].fp) === JSON.stringify(fp);
    if (ok) for (const o of lines) if (o.k === 'row') done.set(`${o.row.engine}|${o.row.hz}|${o.row.fixture}`, o.row);
  }
  if (!ok) await writeFile(J2, JSON.stringify({ k: 'fingerprint', fp }) + '\n');
  const refs = {};
  { const { browser } = await launch(REF.engine);
    for (const f of fixtures) { const p = await freshPage(browser); refs[f.id] = await play(p.page, { seed: f.seed, hz: REF.hz, tape: tapes[f.id], level: 1 }); await p.ctx.close(); }
    await browser.close(); }
  const rows = [];
  for (const name of engineNames) {
    let L; try { L = await launch(name); } catch (e) { console.log(name, 'UNAVAILABLE'); continue; }
    for (const hz of hzs) for (const f of fixtures) {
      const key = `${name}|${hz}|${f.id}`;
      if (done.has(key)) { rows.push(done.get(key)); console.log(key, 'skipped (resume)'); continue; }
      const p = await freshPage(L.browser);
      const r = await play(p.page, { seed: f.seed, hz, tape: tapes[f.id], level: 1 });
      await p.ctx.close();
      const ref = refs[f.id], cmp = compareDigests(ref.digests, r.digests), o = r.outcome, ro = ref.outcome;
      const row = { engine: name, hz, fixture: f.id, firstCausalDivergentTick: cmp.first ? cmp.first.tick : null, subsystem: cmp.first ? cmp.first.subs.map((k) => SUBNAMES[k]) : null,
        derivedFirstDiffTick: cmp.derivedTick, telegraphFirstDiffTick: cmp.telegraphTick, sledDeltaAtFirstTick: cmp.first ? rawDelta(ref.raw, r.raw, cmp.first.tick) : null,
        tapeDesyncTick: r.tapeCheck.desync ? r.tapeCheck.desync.tick : null, checkpointsChecked: r.tapeCheck.checked,
        outcome: { ticks: o.ticks, crashed: o.crashed, cause: o.cause, distanceM: o.distanceM, score: o.score },
        outcomeEqualsReference: JSON.stringify([o.ticks, o.crashed, o.cause, o.distanceM, o.score]) === JSON.stringify([ro.ticks, ro.crashed, ro.cause, ro.distanceM, ro.score]) };
      rows.push(row);
      await appendFile(J2, JSON.stringify({ k: 'row', row }) + '\n');
      console.log(key, row.firstCausalDivergentTick ?? 'ok', 'derived', row.derivedFirstDiffTick ?? '-', 'cp', row.tapeDesyncTick ?? '-', row.outcomeEqualsReference ? '=ref' : 'OUTCOME DIFFERS');
    }
    await L.browser.close();
  }
  await writeFile(OUTF, JSON.stringify({ gitSha, fingerprint: fp, generatedAt: new Date().toISOString(), note: 'each row = run #1 of a fresh browser context, compared to chromium-headless-shell/120 Hz fresh reference; causal digest groups only decide firstCausalDivergentTick', rows }));
  console.log('WROTE', OUTF, rows.length);
}

// ---------------------------------------------------------------- position probe
/** Session-position leak probe: tapes replayed as run #2 of a session after another run, vs the same tape as run #1 of a fresh context.
 *  NOTE: the harness starts each run through Title.startRun after force-stopping scenes (bootRun); it does NOT go through the real GameOver/retry path. */
async function positions() {
  const OUTP = process.env.OUT || path.join(here, '..', '..', 'docs', 'determinism', 'results', 'position-probe.json');
  const tapes = {};
  for (const f of FIXTURES) tapes[f.id] = await loadTape(f);
  const by = Object.fromEntries(FIXTURES.map((f) => [f.id, f]));
  const hz = Number(process.env.POS_HZ || 120);
  const { browser } = await launch(REF.engine);
  const results = [];
  try {
    const ref = {};
    for (const f of fixtures) { const p = await freshPage(browser); const r = await play(p.page, { seed: f.seed, hz, tape: tapes[f.id], level: 1 }); ref[f.id] = r; await p.ctx.close(); }
    const cases = [...fixtures.map((f) => [f.id, f.id])];
    for (const prior of ['cruise-baseline', 'collision-heavy', 'airborne-tricks']) cases.push([prior, 'chunk-biome-boundaries']);
    for (const [a, b] of cases) {
      const p = await freshPage(browser);
      const ra = await play(p.page, { seed: by[a].seed, hz, tape: tapes[a], level: 1 });
      const rb = await play(p.page, { seed: by[b].seed, hz, tape: tapes[b], level: 1 });
      await p.ctx.close();
      if (!ref[b]) { const q = await freshPage(browser); ref[b] = await play(q.page, { seed: by[b].seed, hz, tape: tapes[b], level: 1 }); await q.ctx.close(); }
      const cmpA = compareDigests(ref[a]?.digests || ra.digests, ra.digests), cmp = compareDigests(ref[b].digests, rb.digests);
      const o = rb.outcome, ro = ref[b].outcome;
      const row = { sequence: [a, b], hz, run1CauseOrEnd: ra.outcome.crashed ? ra.outcome.cause : 'no crash (tick limit)', run2FirstCausalDivergentTick: cmp.first ? cmp.first.tick : null, run2Subsystems: cmp.first ? cmp.first.subs.map((k) => SUBNAMES[k]) : null,
        run2TapeDesync: rb.tapeCheck.desync ? rb.tapeCheck.desync.tick : null, run2OutcomeEqualsFresh: JSON.stringify([o.ticks, o.crashed, o.cause, o.distanceM, o.score]) === JSON.stringify([ro.ticks, ro.crashed, ro.cause, ro.distanceM, ro.score]),
        run2: { ticks: o.ticks, cause: o.cause, distanceM: o.distanceM, score: o.score }, fresh: { ticks: ro.ticks, cause: ro.cause, distanceM: ro.distanceM, score: ro.score }, run1Clean: !cmpA.first };
      results.push(row);
      console.log(a, '->', b, row.run2FirstCausalDivergentTick ?? 'clean', row.run1CauseOrEnd);
    }
  } finally { await browser.close(); }
  await mkdir(path.dirname(OUTP), { recursive: true });
  await writeFile(OUTP, JSON.stringify({ gitSha, generatedAt: new Date().toISOString(), engine: REF.engine, hz, path: 'Title.startRun after force-stopping scenes (NOT the GameOver/retry flow)', results }, null, 1));
  console.log('WROTE', OUTP);
}

if (cmd === 'record') await record();
else if (cmd === 'matrix') await matrix();
else if (cmd === 'scout') await scout();
else if (cmd === 'positions') await positions();
else if (cmd === 'fresh') await fresh();
else { console.log('usage: cross-engine.mjs record|matrix|positions|scout  (matrix --resume continues from the journal)'); process.exit(2); }
