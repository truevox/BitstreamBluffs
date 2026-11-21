/* Cross-engine replay conformance matrix (issue #120). DIAGNOSTIC, NON-AUTHORITATIVE: see docs/determinism/cross-engine-matrix.md.
 *
 *   npm run build && npx vite preview --port 8412 &
 *   GAME_URL=http://localhost:8412/ xvfb-run -a node tools/conformance/cross-engine.mjs record            # (re)record fixture tapes (Chromium)
 *   GAME_URL=http://localhost:8412/ xvfb-run -a node tools/conformance/cross-engine.mjs matrix            # replay everywhere, write results
 *   node tools/conformance/cross-engine.mjs scout [fixtureId]                                             # explore autopilot outcomes
 *
 * Env: ENGINES (comma list; default all), HZ (default 30,60,120,144), SESSIONS (fresh browser contexts per engine/cadence, default 2),
 *      FIXTURES (comma ids), OUT (results json), RASTER=1 (really rasterise WebGL frames; default skips only the GPU draw call).
 * Firefox has no usable headless WebGL here, so it runs headed: wrap the command in xvfb-run (Mesa llvmpipe).
 * Playwright WebKit is NOT iPhone Safari (different OS, GPU, JIT/libm); a pass here says nothing about real Safari/iOS.
 */
import { chromium, firefox, webkit } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from './cross-engine-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.GAME_URL || 'http://localhost:8412/';
const HZ = (process.env.HZ || '30,60,120,144').split(',').map(Number);
const SESSIONS = Number(process.env.SESSIONS || 2);
const RASTER = process.env.RASTER === '1';
const TAPE_DIR = path.join(here, 'fixtures', 'cross-engine');
const OUT = process.env.OUT || path.join(here, '..', '..', 'docs', 'determinism', 'results', 'cross-engine-results.json');
const fixtureFilter = process.env.FIXTURES ? process.env.FIXTURES.split(',') : null;
const fixtures = FIXTURES.filter((f) => !fixtureFilter || fixtureFilter.includes(f.id));
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
async function freshPage(browser, patch = null) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  if (patch) await page.addInitScript(`window.__cePatch = ${JSON.stringify(patch)};`);
  await page.addInitScript(pageJs);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive() && window.__ce, null, { timeout: 60000 });
  return { ctx, page, errors };
}
const play = (page, o) => page.evaluate((x) => window.__ce.play(x), { raster: RASTER, ...o });

const SUBNAMES = ['rng', 'timers', 'terrain', 'kodiaks', 'bsod', 'sled', 'world', 'score', 'telegraph'];
// The recorded profile Sync Level. BsodPursuit and Kodiak gating read the LIVE profile level, which the tape header does not carry.
const levelOf = (f) => (f.kodiaks ? 8 : 1);
const tapePath = (f) => path.join(TAPE_DIR, `${f.id}.tape.json`);
async function loadTape(f) { return JSON.parse(await readFile(tapePath(f), 'utf8')); }

// ---------------------------------------------------------------- comparison
function compareDigests(ref, got) {
  const n = Math.min(ref.length, got.length);
  let first = null, tele = null;
  for (let i = 0; i < n; i++) {
    const subs = [];
    for (let k = 0; k < 8; k++) if (ref[i][k] !== got[i][k]) subs.push(k);
    if (subs.length && first === null) first = { tick: i + 1, subs };
    if (ref[i][8] !== got[i][8] && tele === null) tele = i + 1;
    if (first && tele) break;
  }
  return { first, telegraphTick: tele, lengthMismatch: ref.length !== got.length ? [ref.length, got.length] : null };
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
  await mkdir(TAPE_DIR, { recursive: true });
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
      let levelSensitivity = null;
      if (levelOf(f) !== 1) {
        // Same tape, same engine, same cadence, but a fresh profile at Sync Level 1: does the replay still match?
        const w = await freshPage(browser);
        const alt = await play(w.page, { seed: f.seed, hz: 120, tape: rec.tape, level: 1 });
        await w.ctx.close();
        const c2 = compareDigests(rec.digests, alt.digests);
        levelSensitivity = { recordedLevel: levelOf(f), replayLevel: 1, first: c2.first && { tick: c2.first.tick, subsystems: c2.first.subs.map((k) => SUBNAMES[k]) }, desync: alt.tapeCheck.desync && { tick: alt.tapeCheck.desync.tick }, outcome: { ticks: alt.outcome.ticks, crashed: alt.outcome.crashed, cause: alt.outcome.cause, distanceM: alt.outcome.distanceM, score: alt.outcome.score } };
      }
      const entry = { id: f.id, preRuns: f.preRuns || 0, covers: f.covers, outcome: rec.outcome, tapeInputs: rec.tape.inputs.length, checkpoints: rec.tape.checkpoints.length,
        endTick: rec.tape.endTick, level: levelOf(f), liveVsFreshContextReplay: { ok, first: cmp.first && { tick: cmp.first.tick, subsystems: cmp.first.subs.map((k) => SUBNAMES[k]) }, lengths: [rec.digests.length, rep.digests.length], desync: rep.tapeCheck.desync && { tick: rep.tapeCheck.desync.tick }, checked: rep.tapeCheck.checked }, levelSensitivity, pageErrors: [...errors, ...v.errors] };
      meta.push(entry);
      await writeFile(tapePath(f), JSON.stringify(rec.tape));
      console.log(f.id, JSON.stringify({ ticks: rec.outcome.ticks, crashed: rec.outcome.crashed, cause: rec.outcome.cause, distanceM: rec.outcome.distanceM, score: rec.outcome.score, stats: rec.outcome.stats, liveVsReplayOk: ok }));
    }
  } finally { await browser.close(); }
  await writeFile(path.join(TAPE_DIR, 'record-meta.json'), JSON.stringify({ gitSha, recordedAt: new Date().toISOString(), fixtures: meta }, null, 1));
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
  return { divergentTick: divTick, implementationDiffs: impl, firstMathDiffTick, examples, suspectAtDivergentTick: atDiv.map((e) => e.fn),
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
  return { patchedFns: fns, firstDivergentTick: cmp.first ? cmp.first.tick : null, subsystem: cmp.first ? cmp.first.subs.map((k) => SUBNAMES[k]) : null, tapeDesyncBad: b.tapeCheck.desync && { tick: b.tapeCheck.desync.tick },
    refOutcome: a.outcome && { ticks: a.outcome.ticks, crashed: a.outcome.crashed, cause: a.outcome.cause, distanceM: a.outcome.distanceM, score: a.outcome.score },
    badOutcome: { ticks: b.outcome.ticks, crashed: b.outcome.crashed, cause: b.outcome.cause, distanceM: b.outcome.distanceM, score: b.outcome.score } };
}

async function matrix() {
  const tapes = {};
  for (const f of fixtures) {
    if (!existsSync(tapePath(f))) throw new Error(`missing tape ${tapePath(f)}; run the record command first`);
    tapes[f.id] = await loadTape(f);
  }
  const envs = {};
  const rows = [];
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
    let L;
    try { L = await launch(name); } catch (e) {
      envs[name] = { unavailable: true, reason: String(e.message).split('\n')[0] };
      console.log(name, 'UNAVAILABLE', envs[name].reason);
      continue;
    }
    const { browser, cfg } = L;
    envs[name] = { engine: name, browserType: cfg.type.name(), version: browser.version(), headless: cfg.headlessLabel, os: `${os.type()} ${os.release()}`, arch: os.arch(), platform: process.platform, node: process.version, raster: RASTER };
    for (const hz of (name === REF.engine ? [REF.hz, ...HZ.filter((h) => h !== REF.hz)] : HZ)) {
      for (let session = 1; session <= SESSIONS; session++) {
        let page, ctx, errors;
        try { ({ page, ctx, errors } = await freshPage(browser)); } catch (e) {
          rows.push({ engine: name, hz, session, error: 'session start failed: ' + String(e.message).split('\n')[0] });
          console.log(name, hz, session, 'SESSION FAILED', e.message.split('\n')[0]);
          continue;
        }
        if (!envs[name].page) envs[name].page = await page.evaluate(() => window.__ce.env());
        // order: all fixtures, then the first fixture again (contamination check)
        const order = [...fixtures, { ...fixtures[0], again: true }];
        let runNo = 0;
        for (const f of order) {
          runNo++;
          const t0 = Date.now();
          let r;
          try { r = await play(page, { seed: f.seed, hz, tape: tapes[f.id], level: levelOf(f) }); } catch (e) {
            rows.push({ engine: name, hz, session, run: runNo, fixture: f.id, error: String(e.message).split('\n')[0] });
            console.log(name, hz, session, runNo, f.id, 'ERROR', e.message.split('\n')[0]);
            break;
          }
          const ref = refs[f.id];
          const cmp = ref ? compareDigests(ref.digests, r.digests) : { first: null, telegraphTick: null, lengthMismatch: null };
          const row = {
            engine: name, hz, session, run: runNo, fixture: f.id + (f.again ? ' (repeat of run 1)' : ''),
            firstDivergentTick: cmp.first ? cmp.first.tick : null,
            subsystem: cmp.first ? cmp.first.subs.map((k) => ['rng', 'timers', 'terrain', 'kodiaks', 'bsod', 'sled', 'world', 'score', 'telegraph'][k]) : null,
            telegraphFirstDiffTick: cmp.telegraphTick,
            lengthMismatch: cmp.lengthMismatch,
            tapeDesync: r.tapeCheck.desync ? { tick: r.tapeCheck.desync.tick } : null, checkpointsChecked: r.tapeCheck.checked,
            outcome: { ticks: r.outcome.ticks, crashed: r.outcome.crashed, cause: r.outcome.cause, distanceM: r.outcome.distanceM, score: r.outcome.score },
            digestRoll: roll(r.digests), frames: r.frames, wallMs: Date.now() - t0,
          };
          if (cmp.first && ref) row.sledDeltaAtFirstTick = rawDelta(ref.raw, r.raw, cmp.first.tick);
          rows.push(row);
          console.log(name, hz, `s${session}`, `#${runNo}`, row.fixture, row.firstDivergentTick ?? 'ok', row.outcome.ticks, row.outcome.distanceM + 'm', `${row.wallMs}ms`);
        }
        if (errors.length) envs[name].pageErrors = [...(envs[name].pageErrors || []), ...errors];
        await ctx.close();
      }
    }
    await browser.close();
  }
  // Math-op isolation for the first divergence per (engine, fixture).
  const diagnosed = {};
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
    console.log('MATH', key, JSON.stringify(diagnosed[key]).slice(0, 400));
  }
  const result = { issue: 120, diagnostic: true, authoritative: false, note: 'Diagnostic digests only; to be replaced by the #152 contract when published. Playwright WebKit != iPhone Safari.',
    gitSha, generatedAt: new Date().toISOString(), reference: { ...REF, freshContextPerFixture: true }, cadencesHz: HZ, sessionsPerCell: SESSIONS, gameUrl: url,
    environments: envs, fixtures: fixtures.map((f) => ({ id: f.id, seed: f.seed, covers: f.covers, tapeEndTick: tapes[f.id].endTick, refOutcome: refs[f.id]?.outcome })), rows, mathDiagnosis: Object.values(diagnosed) };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(result));
  console.log('WROTE', OUT, rows.length, 'rows');
}

const cmd = process.argv[2];
if (cmd === 'record') await record();
else if (cmd === 'matrix') await matrix();
else if (cmd === 'scout') await scout();
else { console.log('usage: cross-engine.mjs record|matrix|scout'); process.exit(2); }
