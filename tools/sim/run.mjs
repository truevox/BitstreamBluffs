#!/usr/bin/env node
/**
 * Deterministic, faster-than-real-time measurement harness for the real game (Phaser + Matter in headless Chromium).
 *
 *   node tools/sim/run.mjs --seeds 24 --policy handsOff --maxM 3000 --maxSec 240 --out out.json
 *   npm run sim -- --seeds 24 --policy flip --releaseLateMs 200
 *   npm run sim -- --verify --seeds 3 --policy hop          # run each seed twice, assert identical traces
 *   node tools/sim/run.mjs --seeds 24 --policy terrain --maxM 4000   # generation only (hazard bands), no physics
 *
 * How it works: starts `vite` on a free port, opens a page per worker in headless Chromium (WebGL via swiftshader),
 * stops Phaser's own loop and calls game.headlessStep(t, 1000/60) in a tight loop inside page.evaluate. Fixed delta =>
 * RunScene's 8 ms sub-stepping is repeatable. Removed non-determinism: Math.random (seeded PRNG, re-seeded per run),
 * Date (pinned, +1 frame per step), the daily rule (scene.dailyMods = {} after create), localStorage (cleared per run),
 * audio (null), UIScene (stopped unless --keepUi). RunScene.inputRouter is replaced by a stub fed by the policy.
 * No game code is modified. Each run uses a freshly loaded page by default (--noReload reuses the page).
 *
 * Options
 *   --seeds N | a,b,c     N => sim-01..sim-NN (default 24); or an explicit comma list of seed strings
 *   --policy NAME         handsOff | flip | hop | stallProbe | terrain          (default handsOff)
 *   --maxM N              stop at N metres (default 3000)      --maxSec N   sim-time limit (default 240)
 *   --releaseLateMs N     flip: release N ms later than the ideal frame (default 0)
 *   --flipCleanDeg N      flip: landing tolerance of the ideal frame (default 28 = clean landing; 12 = perfect only, the earlier default)
 *   --flipTargetDeg N     flip: the ideal release is the first frame from which a release gives >= N deg of net rotation and a clean landing (default 340; 700 = double flip)
 *   --hopLeadMs N         hop: hop when the next ground crash hazard is N ms away (default 380)
 *   --seedPrefix P        with --seeds N: names become P-01..P-NN instead of sim-01.. (a second, independent seed set)
 *   --sub N               record the last N physics sub-steps before a crash into crash.sub (debug)
 *   --rule ID             run under that DailyPatch rule's real modifiers (default: none/neutralised)
 *   --workers N           parallel pages (default 4)           --out FILE   write JSON
 *   --verify              determinism check (traces every 60 frames compared exactly, twice per seed, fresh pages)
 *   --keepUi              leave UIScene running (slower)       --quiet      no per-run lines
 *
 * Policies (details in browser.js): flip's "ideal" release = the first frame from which a release (a forward model of Sled's own air rules) gives
 * >= 340 deg of net rotation and a landing within --flipCleanDeg (default 28, the 'good' band) of the slope; releaseLateMs delays it (negative = earlier). Attempts for which the model
 * never finds the ideal frame (a marginal flip) are marked flip.idealFound=false: those release at the last moment and are not a timing test.
 * hop hops so the apex is over the next ground crash hazard and vetoes hops near a lip that has an air hazard after it.
 * stallProbe brakes to a dead stop on gentle ground, releases, and records when sled._nudging fires and the time to >120 px/s;
 * --probeKind first|flat|down|upGentle|upSteep picks the kind of slope it stops on (--probeMinM N: not before N metres); see browser.js.
 * --releaseLateMs may be NEGATIVE for flip: release that many ms BEFORE the ideal frame.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);

// ------------------------------------------------------------------ args
function parseArgs(argv) {
  const a = { seeds: '24', policy: 'handsOff', maxM: 3000, maxSec: 240, workers: 4, releaseLateMs: 0 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const name = k.slice(2);
    if (['verify', 'keepUi', 'quiet', 'noReload', 'noHop'].includes(name)) { a[name] = true; continue; }
    a[name] = argv[++i];
  }
  for (const n of ['maxM', 'maxSec', 'workers', 'releaseLateMs', 'flipCleanDeg', 'flipTargetDeg', 'hopLeadMs', 'traceEvery', 'sub', 'probeMinM']) if (a[n] != null) a[n] = Number(a[n]);
  return a;
}
const args = parseArgs(process.argv.slice(2));
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('see the header comment of tools/sim/run.mjs');
  process.exit(0);
}
function expandSeeds(s) {
  if (/^\d+$/.test(s)) return Array.from({ length: Number(s) }, (_, i) => `sim-${String(i + 1).padStart(2, '0')}`);
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}
const seeds = expandSeeds(String(args.seeds));
if (args.seedPrefix) for (let i = 0; i < seeds.length; i++) seeds[i] = seeds[i].replace(/^sim-/, `${args.seedPrefix}-`);
const params = {};
for (const n of ['releaseLateMs', 'flipCleanDeg', 'flipTargetDeg', 'hopLeadMs', 'probeMinM']) if (args[n] != null) params[n] = args[n];
if (args.probeKind) params.probeKind = String(args.probeKind);
if (args.noHop) params.noHop = true;

// ------------------------------------------------------------------ vite + browser
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}

async function startVite(port) {
  const proc = spawn(path.join(root, 'node_modules/.bin/vite'), ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: root, env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch (e) { /* not yet */ }
    if (Date.now() - t0 > 30000) { proc.kill('SIGKILL'); throw new Error('vite did not start:\n' + out); }
    await new Promise((r) => setTimeout(r, 100));
  }
  return proc;
}

const { chromium } = require('playwright');
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'];

async function openPage(browser, url) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.addInitScript({ path: path.join(here, 'browser.js') });
  await page.goto(url);
  await page.waitForFunction(() => window.__bbGame && window.__bbGame.scene.isActive('TitleScene'), null, { timeout: 60000 });
  return page;
}

// ------------------------------------------------------------------ stats helpers
const q = (arr, p) => {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * p;
  const lo = Math.floor(i);
  return a[lo] + (a[Math.min(a.length - 1, lo + 1)] - a[lo]) * (i - lo);
};
const f1 = (v) => (v == null ? '-' : (Math.round(v * 10) / 10).toString());

function summarise(results) {
  const n = results.length;
  const reasons = {};
  for (const r of results) reasons[r.endReason] = (reasons[r.endReason] || 0) + 1;
  const dists = results.map((r) => r.distM);
  const crashes = results.filter((r) => r.crash);
  const causes = {};
  for (const r of crashes) causes[r.crash.cause] = (causes[r.crash.cause] || 0) + 1;
  return {
    runs: n, endReasons: reasons, crashCauses: causes,
    distM: { min: q(dists, 0), p25: q(dists, 0.25), median: q(dists, 0.5), p75: q(dists, 0.75), max: q(dists, 1), mean: dists.reduce((a, b) => a + b, 0) / (n || 1) },
    crashedBefore150: crashes.filter((r) => r.crash.distM < 150).length,
    openingGraceRuns: results.filter((r) => r.openingGraces > 0).length,
    openingGraces: results.reduce((a, r) => a + r.openingGraces, 0),
    maxSpeed: { median: q(results.map((r) => r.maxSpeed), 0.5), max: q(results.map((r) => r.maxSpeed), 1) },
    minZoom: { min: q(results.map((r) => r.minZoom), 0), median: q(results.map((r) => r.minZoom), 0.5) },
    simSec: { median: q(results.map((r) => r.simSec), 0.5) },
    wallMs: { median: q(results.map((r) => r.wallMs || 0), 0.5), max: q(results.map((r) => r.wallMs || 0), 1) },
  };
}

function printTable(results, summary) {
  const cols = ['seed', 'end', 'distM', 'simS', 'wallMs', 'crashAtM', 'slope', 'speed', 'grace', 'maxV', 'minZoom'];
  const rows = results.map((r) => [
    r.seed, r.endReason, f1(r.distM), f1(r.simSec), r.wallMs ?? '-', r.crash ? f1(r.crash.distM) : '-', r.crash ? f1(r.crash.slopeDeg) : '-',
    r.crash ? r.crash.speedPxS : '-', r.openingGraces ?? '-', r.maxSpeed ?? '-', r.minZoom ?? '-',
  ]);
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(w[i])).join('  ');
  console.log(line(cols)); console.log(w.map((x) => '-'.repeat(x)).join('  '));
  rows.forEach((r) => console.log(line(r)));
  console.log('');
  console.log(`runs ${summary.runs}  end ${JSON.stringify(summary.endReasons)}  causes ${JSON.stringify(summary.crashCauses)}`);
  const d = summary.distM;
  console.log(`dist m: min ${f1(d.min)} p25 ${f1(d.p25)} median ${f1(d.median)} p75 ${f1(d.p75)} max ${f1(d.max)} mean ${f1(d.mean)}`);
  console.log(`crash<150m: ${summary.crashedBefore150}  opening-grace runs: ${summary.openingGraceRuns} (${summary.openingGraces} fires)  maxSpeed median ${summary.maxSpeed.median} max ${summary.maxSpeed.max}  minZoom min ${summary.minZoom.min}`);
  console.log(`wall ms/run: median ${summary.wallMs.median} max ${summary.wallMs.max}`);
}

// ------------------------------------------------------------------ main
async function main() {
  const port = await freePort();
  const vite = await startVite(port);
  const url = `http://127.0.0.1:${port}/`;
  let browser = null;
  const cleanup = async () => {
    try { if (browser) await browser.close(); } catch (e) { /* ignore */ }
    try { vite.kill('SIGTERM'); } catch (e) { /* ignore */ }
  };
  process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
  try {
    browser = await chromium.launch({ args: LAUNCH_ARGS });
    const jobs = [];
    if (args.verify) {
      for (const s of seeds) for (const rep of [0, 1]) jobs.push({ seed: s, rep });
    } else for (const s of seeds) jobs.push({ seed: s });
    const results = new Array(jobs.length);
    let next = 0;
    const t0 = Date.now();
    const runJob = async (page, job) => {
      const opts = {
        seed: job.seed, policy: args.policy, maxM: args.maxM, maxSec: args.maxSec, params, keepUi: !!args.keepUi,
        traceEvery: args.traceEvery || (args.verify ? 60 : 0), sub: args.sub || 0,
        // Daily rule to measure under; 'none' (the default) neutralises modifiers for pacing runs.
        rule: args.rule ? String(args.rule) : 'none',
      };
      if (args.policy === 'terrain') return page.evaluate((o) => window.__sim.genTerrain(o), opts);
      return page.evaluate((o) => window.__sim.run(o), opts);
    };
    const worker = async () => {
      let page = await openPage(browser, url);
      for (;;) {
        const i = next++;
        if (i >= jobs.length) break;
        if (i > 0 && !args.noReload && page.__used) { await page.close(); page = await openPage(browser, url); }
        let r;
        try {
          r = await Promise.race([runJob(page, jobs[i]), new Promise((_, rej) => setTimeout(() => rej(new Error('job timeout')), 180000))]);
        } catch (e) {
          // a hung/crashed page: retry once on a fresh page
          console.error(`[retry] ${jobs[i].seed}: ${e.message}`);
          try { await page.close(); } catch (e2) { /* ignore */ }
          page = await openPage(browser, url);
          r = await runJob(page, jobs[i]);
        }
        page.__used = true;
        results[i] = r;
        if (!args.quiet) console.error(`[${i + 1}/${jobs.length}] ${r.seed} ${r.endReason} ${r.distM}m ${r.wallMs ?? ''}ms`);
      }
      await page.close();
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(args.workers, jobs.length)) }, worker));
    const wallS = (Date.now() - t0) / 1000;

    if (args.verify) {
      let allOk = true;
      for (const s of seeds) {
        const [a, b] = results.filter((r) => r.seed === s);
        const TE = args.traceEvery || 60; const ta = JSON.stringify(a.trace); const tb = JSON.stringify(b.trace);
        const strip = (r) => { const c = { ...r }; delete c.wallMs; return JSON.stringify(c); };
        const traceOk = ta === tb;
        const fullOk = strip(a) === strip(b);
        if (!traceOk || !fullOk) allOk = false;
        let firstDiff = '';
        if (!traceOk) {
          const n = Math.min(a.trace.length, b.trace.length);
          for (let k = 0; k < n; k++) if (JSON.stringify(a.trace[k]) !== JSON.stringify(b.trace[k])) { firstDiff = ` first diff at sample ${k} (frame ${k * TE}): ${JSON.stringify(a.trace[k])} vs ${JSON.stringify(b.trace[k])}`; break; }
          if (!firstDiff) firstDiff = ` length ${a.trace.length} vs ${b.trace.length}`;
        }
        console.log(`${traceOk && fullOk ? 'IDENTICAL' : 'DIFFERENT'} ${s} policy=${args.policy} samples=${a.trace.length} every=${TE} end=${a.endReason} dist=${a.distM}m wall=${a.wallMs}ms/${b.wallMs}ms traceOk=${traceOk} fullRecordOk=${fullOk}${firstDiff}`);
      }
      console.log(allOk ? 'DETERMINISM CHECK PASSED' : 'DETERMINISM CHECK FAILED');
      if (args.out) writeFileSync(args.out, JSON.stringify({ verify: allOk, args, results }, null, 1));
      await cleanup();
      process.exit(allOk ? 0 : 1);
    }

    const summary = args.policy === 'terrain' ? null : summarise(results);
    if (summary) printTable(results, summary);
    console.log(`total wall ${wallS.toFixed(1)}s for ${results.length} runs with ${args.workers} workers`);
    if (args.out) {
      writeFileSync(args.out, JSON.stringify({ args: { ...args, seeds: seeds.length }, params, summary, results }, null, 1));
      console.log('wrote', args.out);
    }
  } finally {
    await cleanup();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
