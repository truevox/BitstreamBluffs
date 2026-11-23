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
 *   --biomeMask M         W3: biome bitmask for the run (1 Debutmont, 2 Garbage Dump Glacier, 4 Pyramid Peak,
 *                         8 Underwater Mountain, 16 Crystal Cavern; combined by OR). Default 0 = base terrain.
 *   --pursuitSampleMs N   developer-only authoritative post-tick BSOD gap timeline every N ms (500–60000)
 *   --sub N               record the last N physics sub-steps before a crash into crash.sub (debug)
 *   --rule ID             run under that DailyPatch rule's real modifiers (default: none/neutralised)
 *   --workers N           parallel pages (default 4)           --out FILE   write JSON
 *   --verify              determinism check (traces every 60 frames compared exactly, twice per seed, fresh pages)
 *   --keepUi              leave UIScene running (slower)       --quiet      no per-run lines
 *   --noiseProfiles ideal,steady,distracted   isolated developer hop-noise panel (see docs/issue-126-human-noise-bots.md)
 *   --noiseSeed LABEL     salt for the independent reaction RNG (noise panels only)
 *   --fatigue             opt-in simulated-time ramp (see docs/issue-126-optional-fatigue.md)
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
import { DailyPatch } from '../../src/systems/DailyPatch.js';
import {
  DEFAULT_NOISE_SEED, FATIGUE_RAMP, MAX_NOISE_SEC, MAX_NOISE_SEEDS, NOISE_PROFILES,
  noiseOutcome, summarizeNoise, verifyNoiseEvidence,
} from './human-noise.js';

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
    if (['verify', 'keepUi', 'quiet', 'noReload', 'noHop', 'fatigue'].includes(name)) { a[name] = true; continue; }
    a[name] = argv[++i];
  }
  for (const n of ['maxM', 'maxSec', 'workers', 'releaseLateMs', 'flipCleanDeg', 'flipTargetDeg', 'hopLeadMs', 'traceEvery', 'sub', 'probeMinM', 'pursuitSampleMs']) if (a[n] != null) a[n] = Number(a[n]);
  return a;
}
const argv = process.argv.slice(2);
const args = parseArgs(argv);
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('see the header comment of tools/sim/run.mjs');
  process.exit(0);
}
function expandSeeds(s) {
  if (/^\d+$/.test(s)) return Array.from({ length: Number(s) }, (_, i) => `sim-${String(i + 1).padStart(2, '0')}`);
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}
let noiseProfiles = null;
if (argv.includes('--noiseProfiles')) {
  noiseProfiles = String(args.noiseProfiles ?? '').split(',').map((p) => p.trim());
  if (noiseProfiles.length < 2 || new Set(noiseProfiles).size !== noiseProfiles.length ||
      noiseProfiles.some((p) => !Object.hasOwn(NOISE_PROFILES, p))) {
    throw new TypeError('Select at least two distinct noise profiles: ideal,steady,distracted');
  }
  if (argv.includes('--policy') && args.policy !== 'hop') throw new TypeError('Noise profiles only support --policy hop');
  if (['--noReload', '--keepUi', '--workers', '--sub', '--traceEvery', '--noHop'].some((flag) => argv.includes(flag))) {
    throw new TypeError('Noise panels use serial fresh pages, no UI, and fixed diagnostic sampling');
  }
  args.policy = 'hop';
  if (!argv.includes('--seeds')) args.seeds = '3';
  if (!argv.includes('--maxM')) args.maxM = 500;
  if (!argv.includes('--maxSec')) args.maxSec = 25;
  if (typeof args.seeds !== 'string' || args.seeds.startsWith('--') || args.noiseSeed?.startsWith('--') ||
      (argv.includes('--noiseSeed') && args.noiseSeed === undefined)) {
    throw new TypeError('Provide explicit values for --seeds and --noiseSeed');
  }
  if (/^\d+$/.test(args.seeds) && (Number(args.seeds) < 1 || Number(args.seeds) > MAX_NOISE_SEEDS)) {
    throw new RangeError(`Noise panels need 1–${MAX_NOISE_SEEDS} course seeds`);
  }
  if (!Number.isFinite(args.maxM) || args.maxM <= 0 || args.maxM > 5000 ||
      !Number.isFinite(args.maxSec) || args.maxSec <= 0 || args.maxSec > MAX_NOISE_SEC) {
    throw new RangeError(`Noise panel limits: positive --maxM up to 5000, positive --maxSec up to ${MAX_NOISE_SEC}`);
  }
  if ((args.biomeMask != null && (!Number.isInteger(Number(args.biomeMask)) || Number(args.biomeMask) < 0 || Number(args.biomeMask) > 0xffffffff)) ||
      (args.hopLeadMs != null && (!Number.isFinite(args.hopLeadMs) || args.hopLeadMs <= 0 || args.hopLeadMs > 1000)) ||
      (args.rule && args.rule !== 'none' && !DailyPatch.RULES.some((rule) => rule.id === args.rule))) {
    throw new TypeError('Invalid noise panel mask, hop lead, or movement rule');
  }
  args.noiseSeed ??= DEFAULT_NOISE_SEED;
  if (!args.noiseSeed.trim() || args.noiseSeed.length > 64) throw new TypeError('Provide a nonempty noise seed label of up to 64 characters');
}
const fatigueFlag = argv.indexOf('--fatigue');
if (argv.some((value) => value.startsWith('--fatigue=')) || (fatigueFlag !== -1 &&
    (!noiseProfiles || args.fatigue !== true || argv.lastIndexOf('--fatigue') !== fatigueFlag ||
      (argv[fatigueFlag + 1] != null && !argv[fatigueFlag + 1].startsWith('--'))))) {
  throw new TypeError('Use the single --fatigue switch without a value and only with --noiseProfiles');
}
if (args.pursuitSampleMs != null && (!Number.isInteger(args.pursuitSampleMs) ||
    args.pursuitSampleMs < 500 || args.pursuitSampleMs > 60000)) {
  throw new RangeError('Developer-only --pursuitSampleMs must be an integer in [500,60000]');
}
const seeds = expandSeeds(String(args.seeds));
if (args.seedPrefix) for (let i = 0; i < seeds.length; i++) seeds[i] = seeds[i].replace(/^sim-/, `${args.seedPrefix}-`);
if (noiseProfiles && (!seeds.length || seeds.length > MAX_NOISE_SEEDS || new Set(seeds).size !== seeds.length || seeds.some((s) => s.length > 64))) {
  throw new RangeError(`Noise panels need 1–${MAX_NOISE_SEEDS} distinct course seeds of up to 64 characters`);
}
const params = {};
for (const n of ['releaseLateMs', 'flipCleanDeg', 'flipTargetDeg', 'hopLeadMs', 'probeMinM', 'biomeMask']) if (args[n] != null) params[n] = args[n];
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

async function openPage(browser, url, isolate = false) {
  const page = isolate ? await browser.newPage({ serviceWorkers: 'block' }) : await browser.newPage();
  try {
    page.__errors = [];
    page.on('pageerror', (e) => { page.__errors.push(e.message); console.error('[pageerror]', e.message); });
    if (isolate) {
      const origin = new URL(url).origin;
      const context = page.context();
      const routeError = (error) => {
        if (page.__closing && /disposed|has been closed|cancelled|canceled/i.test(String(error))) return;
        page.__errors.push(String(error));
      };
      await context.route('**/*', async (route) => {
        try {
          if (new URL(route.request().url()).origin !== origin) { await route.abort(); return; }
          // Never follow a redirect from an otherwise allowed loopback URL.
          const response = await route.fetch({ maxRedirects: 0 });
          if (page.__closing) return;
          if (response.status() >= 300 && response.status() < 400) await route.abort();
          else await route.fulfill({ response });
        } catch (error) {
          routeError(error);
          if (!page.__closing) await route.abort().catch(routeError);
        }
      });
      await context.routeWebSocket('**/*', async (socket) => {
        try { await socket.close(); } catch (error) { routeError(error); }
      });
    }
    await page.addInitScript({ path: path.join(here, 'browser.js') });
    await page.goto(url);
    await page.waitForFunction(() => window.__bbGame && window.__bbGame.scene.isActive('TitleScene'), null, { timeout: 60000 });
    return page;
  } catch (error) {
    page.__closing = true;
    await page.close();
    throw error;
  }
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

async function runNoisePanel(browser, url, runJob) {
  async function isolatedRun(job) {
    const page = await openPage(browser, url, true);
    let timer, result;
    try {
      result = await Promise.race([
        runJob(page, job), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Noise trial timed out')), 180000); }),
      ]);
    } finally {
      clearTimeout(timer);
      page.__closing = true;
      await page.close();
    }
    if (page.__errors.length) throw new Error(`Noise browser errors: ${page.__errors.join('; ')}`);
    return result;
  }

  const results = [];
  const summary = {};
  for (const profile of noiseProfiles) {
    const group = [];
    for (const seed of seeds) {
      const job = { seed, profile };
      const original = await isolatedRun(job);
      let verification = null;
      if (args.verify) {
        const repeated = await isolatedRun(job);
        const replayed = await isolatedRun({ ...job, playback: original.humanNoise.input.rows });
        verification = {
          seededRepeat: verifyNoiseEvidence(original, repeated),
          inputPlayback: verifyNoiseEvidence(original, replayed, { playback: true }),
        };
      }
      const { endReason, distM, simSec, frames, score, humanNoise, trace } = original;
      group.push({ seed, endReason, outcome: noiseOutcome(endReason), distM, simSec, frames, score, humanNoise, trace, verification });
      if (!args.quiet) console.log(`BOT ${profile} ${seed} ${endReason} ${distM}m ${verification ? JSON.stringify(verification) : ''}`);
    }
    summary[profile] = summarizeNoise(group);
    results.push(...group);
  }
  const verify = args.verify ? results.every((r) => r.verification.seededRepeat && r.verification.inputPlayback) : null;
  const settings = {
    noiseSeed: args.noiseSeed, seeds, policy: args.policy, passDistanceM: args.maxM, maxSec: args.maxSec,
    biomeMask: Number(args.biomeMask ?? 0) >>> 0, rule: args.rule || 'none', hopLeadMs: args.hopLeadMs ?? 380,
    profiles: Object.fromEntries(noiseProfiles.map((name) => [name, NOISE_PROFILES[name]])),
    ...(args.fatigue ? { fatigue: FATIGUE_RAMP } : {}),
  };
  const kind = args.fatigue ? 'local-tool-assisted-fatigue-bot-panel' : 'local-tool-assisted-bot-panel';
  const label = args.fatigue ? 'FATIGUE BOT PANEL' : 'HUMAN-NOISE BOT PANEL';
  console.log(`${label}, LOCAL QA ONLY: ${JSON.stringify({ settings, summary, verify })}`);
  if (args.out) writeFileSync(args.out, JSON.stringify({ kind, settings, summary, verify, results }, null, 1));
  if (verify === false) throw new Error('Noise input or result did not reproduce');
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
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, args: LAUNCH_ARGS });
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
        // W3: the biome mask must ride on the options, not only in `params` - the page reads o.biomeMask to
        // set REG.BIOME_MASK before RunScene builds its generator.
        biomeMask: args.biomeMask != null ? Number(args.biomeMask) >>> 0 : 0,
        traceEvery: args.traceEvery || (args.verify || job.profile ? 60 : 0), sub: args.sub || 0,
        pursuitSampleMs: args.pursuitSampleMs || 0,
        // Daily rule to measure under; 'none' (the default) neutralises modifiers for pacing runs.
        rule: args.rule ? String(args.rule) : 'none',
        ...(job.profile ? { noiseProfile: job.profile, noiseSeed: args.noiseSeed, noiseReplay: job.playback } : {}),
        ...(args.fatigue ? { noiseFatigue: true } : {}),
      };
      if (args.policy === 'terrain') return page.evaluate((o) => window.__sim.genTerrain(o), opts);
      return page.evaluate((o) => window.__sim.run(o), opts);
    };
    if (noiseProfiles) return await runNoisePanel(browser, url, runJob);
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
