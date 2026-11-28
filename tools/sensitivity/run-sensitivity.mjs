#!/usr/bin/env node
/**
 * Issue #130 (narrow slice) — developer-only butterfly-sensitivity preflight.
 *
 * WHAT IT MEASURES
 * One axis, input timing. For each stock seed it captures ONE run from the shipped game (Phaser + Matter in
 * headless Chromium, driven exactly as `tools/sim/run.mjs` drives it), then replays that run's own ghost tape
 * with one named control shifted by a whole number of fixed simulation ticks (±1, ±2 by default). The outcome
 * of each replay is recorded and paired against the unshifted control on the same seed.
 *
 * WHY IT REPLAYS A TAPE INSTEAD OF RE-RUNNING THE POLICY
 * The tape is the shipped, authoritative record of what the run actually fed the simulation. Perturbing it and
 * feeding it back through the game's own `TapePlayer` means the *only* difference between arms is the shifted
 * ticks — no policy re-derivation, no second simulator, no copied physics. `tests/sensitivity/perturb.test.js`
 * pins the reconstruction against `TapePlayer.padAt` tick by tick.
 *
 * WHY CAPTURE MUST RUN UNDER THE TAPE'S OWN RULE
 * `RunScene` resolves the daily rule from the *replay tape* when replaying (`resolveReplaySetup`), but
 * `tools/sim/run.mjs` neutralises `scene.dailyMods` for a capture. A capture taken that way records the rule
 * id while simulating without it, so its own tape desyncs at the first checkpoint. This tool therefore captures
 * with the rule the tape will record (`--rule`, default `featherweight` = 2026-01-05, the harness's pinned day)
 * and REFUSES to run if the capture tape does not replay to its own checkpoints. That refusal is the guard that
 * this measurement is of the real game and not of a mismatched one.
 *
 * WHAT IT DOES NOT DO
 * No physics, scoring, ranked or ruleset change; no writes outside `--out`; no claim about offsets, seeds or
 * gameplay beyond what it measured. A run that reaches the cap is censored, not a survival.
 *
 *   node tools/sensitivity/run-sensitivity.mjs --seeds sim-01,...,sim-12 --field hopPress --offsets -2,-1,0,1,2
 *
 * Options
 *   --seeds LIST|N        explicit comma list, or N => sim-01..sim-NN      (default 12)
 *   --field NAME          one control from lib/perturb.mjs FIELDS          (default hopPress)
 *   --offsets LIST        fixed-tick offsets to measure, must include 0     (default -2,-1,0,1,2)
 *   --rule ID|none        daily rule for BOTH capture and replay           (default featherweight)
 *   --maxM N --maxSec N   CAPTURE limits (not replay limits)                (default 3000 / 90)
 *                         replay hard cap = captured tape horizon + 1200 fixed ticks (10s at 120Hz)
 *   --workers N           parallel pages                                    (default 2)
 *   --out FILE            machine record (raw rows + aggregate)
 *   --quiet               no per-run lines
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DailyPatch } from '../../src/systems/DailyPatch.js';
import { SIM_TICK_HZ } from '../../src/systems/SimClock.js';
import { FIELDS } from './lib/perturb.mjs';
import { aggregate, classifyOutcome } from './lib/aggregate.mjs';
import { assertCaptureTape } from './lib/capture.mjs';
import { readVerifiedSourceIdentity } from './lib/source-identity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);

/** The harness's pinned calendar day; `--rule` must agree with what a tape recorded on it resolves to. */
export const PINNED_UTC = '2026-01-05T12:00:00.000Z';
export const MAX_SEEDS = 64;
export const SEED_CHARS = /^[A-Za-z0-9._:-]+$/;

// ------------------------------------------------------------------ args
const BOOLEAN = new Set(['quiet', 'help', 'h']);
const KNOWN = new Set(['seeds', 'field', 'offsets', 'rule', 'maxM', 'maxSec', 'workers', 'out', 'quiet', 'help', 'h']);

export function parseArgs(argv) {
  const a = { seeds: '12', field: 'hopPress', offsets: '-2,-1,0,1,2', rule: 'featherweight', maxM: 3000, maxSec: 90, workers: 2 };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument "${token}"`);
    const eq = token.indexOf('=');
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    if (!KNOWN.has(name)) throw new Error(`unknown option --${name} (known: ${[...KNOWN].join(', ')})`);
    if (BOOLEAN.has(name)) {
      if (eq !== -1) throw new Error(`--${name} takes no value`);
      a[name] = true;
      continue;
    }
    const value = eq === -1 ? argv[++i] : token.slice(eq + 1);
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    a[name] = value;
  }
  for (const n of ['maxM', 'maxSec', 'workers']) if (typeof a[n] === 'string') a[n] = Number(a[n]);
  return a;
}

/** Resolve `--seeds` once, before anything runs. Duplicates and blanks are usage errors, not filters. */
export function planSeeds(raw) {
  const text = String(raw).trim();
  if (text === '') throw new Error('--seeds needs a count or a comma list');
  let seeds;
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (n < 1 || n > MAX_SEEDS) throw new RangeError(`--seeds count must be in [1, ${MAX_SEEDS}]`);
    seeds = Array.from({ length: n }, (_, i) => `sim-${String(i + 1).padStart(2, '0')}`);
  } else {
    seeds = text.split(',').map((s) => s.trim());
    if (seeds.some((s) => s === '')) throw new Error('--seeds has an empty entry');
    if (seeds.some((s) => !SEED_CHARS.test(s))) throw new Error('--seeds entries allow only A-Za-z0-9._:-');
    if (seeds.some((s) => s.length > 64)) throw new Error('--seeds entries are at most 64 characters');
  }
  if (seeds.length > MAX_SEEDS) throw new RangeError(`at most ${MAX_SEEDS} seeds`);
  if (new Set(seeds).size !== seeds.length) throw new Error('--seeds has a duplicate');
  return seeds;
}

/** Resolve `--offsets`: integers, at least one, always containing the 0 control. */
export function planOffsets(raw) {
  const parts = String(raw).split(',').map((s) => s.trim());
  if (parts.some((s) => s === '')) throw new Error('--offsets has an empty entry');
  const offsets = parts.map((s) => {
    if (!/^-?\d+$/.test(s)) throw new Error(`--offsets entry "${s}" is not an integer`);
    return Number(s);
  });
  if (new Set(offsets).size !== offsets.length) throw new Error('--offsets has a duplicate');
  if (!offsets.includes(0)) throw new Error('--offsets must include 0: the unshifted arm is the control every other offset is paired against');
  if (offsets.length < 2) throw new Error('--offsets needs at least one non-zero offset to have anything to compare');
  return offsets.sort((a, b) => a - b);
}

export function validate(args, { rules = DailyPatch.RULES } = {}) {
  if (args.help || args.h) return { help: true };
  if (!Object.hasOwn(FIELDS, args.field)) throw new Error(`--field "${args.field}" is not a perturbable control (known: ${Object.keys(FIELDS).join(', ')})`);
  const seeds = planSeeds(args.seeds);
  const offsets = planOffsets(args.offsets);
  if (args.rule !== 'none' && !rules.some((r) => r.id === args.rule)) {
    throw new Error(`--rule "${args.rule}" is not a movement rule (known: none, ${rules.map((r) => r.id).join(', ')})`);
  }
  if (!Number.isFinite(args.maxM) || args.maxM <= 0 || args.maxM > 5000) throw new RangeError('--maxM must be positive and at most 5000');
  if (!Number.isFinite(args.maxSec) || args.maxSec <= 0 || args.maxSec > 180) throw new RangeError('--maxSec must be positive and at most 180');
  if (!Number.isInteger(args.workers) || args.workers < 1 || args.workers > 8) throw new RangeError('--workers must be an integer in [1, 8]');
  return { help: false, seeds, offsets, rule: args.rule };
}

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
    cwd: root, env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch (e) { /* not yet */ }
    if (Date.now() - t0 > 30000) { proc.kill('SIGKILL'); throw new Error(`vite did not start:\n${out}`); }
    await new Promise((r) => setTimeout(r, 100));
  }
  return proc;
}

const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'];

async function openPage(browser, url) {
  const page = await browser.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => { page.__errors.push(e.message); });
  await page.addInitScript({ path: path.join(root, 'tools/sim/browser.js') });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__bbGame && window.__bbGame.scene.isActive('TitleScene'), null, { timeout: 60000 });
  // The page-side half of the tool is the SAME module the tests import, loaded by vite over the dev server:
  // one implementation, so the perturbation measured here cannot drift from the one under test.
  await page.evaluate(async () => {
    const mod = await import('/tools/sensitivity/lib/perturb.mjs');
    window.__sens = { perturb: mod.perturbTape, FIELDS: mod.FIELDS };
  });
  return page;
}

// ------------------------------------------------------------------ page-side work
/**
 * In-page: replay one tape through the SHIPPED TapePlayer path and report the outcome.
 * Read-only: it never writes a record, tape, award or evidence row, and it stops on the run's own crash.
 */
export async function replayTapeInPage({ tape, maxTicks, dt }) {
  const game = window.__bbGame;
  const reg = game.registry;
  game.loop.stop();
  for (const key of ['RunScene', 'UIScene', 'PauseScene', 'GameOverScene', 'TitleScene']) {
    try { game.scene.stop(key); } catch (e) { /* a scene that never started */ }
  }
  reg.set('ghostReplay', tape);
  game.scene.start('RunScene');
  const run = game.scene.getScene('RunScene');
  let guard = 0;
  while (!(run.sys.isActive() && run.simClock) && guard++ < 8) game.headlessStep(0, 1000 / 60);
  if (!run.tapePlayer) throw new Error('the replay path did not create a TapePlayer');
  let cause = null;
  const onCrash = (e) => { if (e.fatal === true && e.negated === false) cause = e.cause; };
  game.events.on('bb:crash', onCrash);
  let tick = 0;
  try {
    while (!run.crashed && tick < maxTicks) {
      tick += 1;
      game.headlessStep(tick * dt, dt);
      if (run.simClock.tick !== tick) throw new Error(`fixed-tick stepping drifted at tick ${tick} (clock ${run.simClock.tick})`);
      if (run.simClock.droppedMs !== 0) throw new Error(`dropped simulation time at tick ${tick}`);
    }
  } finally {
    game.events.off('bb:crash', onCrash);
  }
  const capHit = !run.crashed;
  return {
    crashed: !!run.crashed,
    crashCause: cause,
    endTick: run.simClock.tick,
    // The replay loop is bounded by maxTicks, NOT by the capture's
    // --maxM/--maxSec options. Do not falsely attest to reaching a distance cap.
    endReason: run.crashed ? `crash:${cause || 'unknown'}` : 'replay-window',
    capHit,
    replayMaxTicks: maxTicks,
    desync: run.tapePlayer.desync,
    checkpointsChecked: run.tapePlayer.checked,
    distanceM: Math.round(((run.sled.x - run.startX) / 20) * 1000) / 1000,
    score: run.score.getTotal(),
    maxAirtimeMs: Math.round(run.maxAirtimeMs * 1000) / 1000,
    dailyRuleId: run.dailyRuleId,
    seed: run.seed,
  };
}

// ------------------------------------------------------------------ main
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = validate(args);
  if (plan.help) { console.log('see the header comment of tools/sensitivity/run-sensitivity.mjs'); return 0; }
  const { seeds, offsets, rule } = plan;
  // Validate the full source tripwire and derive provenance BEFORE any browser runs.
  // Optional SENSITIVITY_* values are assertions, NEVER replacement identities.
  const sourceIdentity = readVerifiedSourceIdentity({ root });

  const port = await freePort();
  const vite = await startVite(port);
  const url = `http://127.0.0.1:${port}/`;
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, args: LAUNCH_ARGS });
  const dt = 1000 / SIM_TICK_HZ;
  const rows = [];
  const captures = [];
  const failures = [];
  const queue = [...seeds]; // the plan stays intact for the record; the workers drain a copy
  try {
    const worker = async () => {
      const page = await openPage(browser, url);
      for (;;) {
        const seed = queue.shift();
        if (seed === undefined) break;
        try {
          // 0. Clear the registry slot first: a capture that never finalises a tape must not leave the previous
          //    seed's tape behind for this one to measure. The guard below is the hard check; this removes the
          //    stale value so the failure is a named refusal instead of a silently wrong measurement.
          await page.evaluate(() => { window.__bbGame.registry.remove('lastGhostTape'); });
          // 1. Capture one run from the shipped game, under the rule the tape will record.
          const capture = await page.evaluate((o) => window.__sim.run(o), {
            seed, policy: 'flip', maxM: args.maxM, maxSec: args.maxSec, params: {}, rule,
          });
          // 2. Identity guard: the registry must hand back THIS seed's tape, under THIS rule. A capture that hit
          //    its own cap never finalises a tape, which is how sim-06 once measured sim-04's course.
          const tape = assertCaptureTape(
            await page.evaluate(() => window.__bbGame.registry.get('lastGhostTape') || null),
            { seed, rule },
          );
          // 3. The guard: the captured tape must reproduce its own run, or nothing measured on it is the real game.
          const control = await page.evaluate(replayTapeInPage, { tape, maxTicks: tape.endTick + 1200, dt });
          if (control.desync) throw new Error(`the capture's own tape desynced at tick ${control.desync.tick}`);
          captures.push({
            seed, endReason: capture.endReason, distM: capture.distM, score: capture.score,
            maxAirtimeMs: Math.round(capture.maxAirtimeMs), endTick: tape.endTick,
            inputRows: tape.inputs.length, checkpoints: tape.checkpoints.length,
          });
          // 3. Measure every offset, starting with the 0 control that must equal the replay above.
          for (const offset of offsets) {
            const perturbed = await page.evaluate(
              ({ tape: t, field, offset: o }) => window.__sens.perturb(t, { field, offset: o }),
              { tape, field: args.field, offset },
            );
            const base = {
              seed, field: args.field, offset, captureEndTick: tape.endTick,
              captureEndReason: capture.endReason, captureDistM: capture.distM, captureScore: capture.score,
            };
            if (!perturbed.ok) {
              rows.push({ ...base, outcome: 'excluded', exclusion: perturbed.reason, spans: perturbed.spans.length });
              if (!args.quiet) console.error(`[${seed} ${args.field} ${offset >= 0 ? '+' : ''}${offset}] EXCLUDED ${perturbed.reason}`);
              continue;
            }
            const r = await page.evaluate(replayTapeInPage, { tape: perturbed.tape, maxTicks: perturbed.horizon + 1200, dt });
            // A perturbed arm is graded WITHOUT the integrity requirement: its checkpoints came from the
            // unperturbed trajectory, so divergence here is the signal, not a failure (see classifyOutcome).
            const outcome = classifyOutcome({ endReason: r.endReason, desync: r.desync });
            rows.push({
              ...base,
              spans: perturbed.spans.length,
              spansShifted: perturbed.shiftedSpans,
              tapeChanged: perturbed.changed,
              outcome,
              exclusion: outcome === 'excluded' ? 'unclassified-end-reason' : undefined,
              // Divergence from the control's checkpoints, recorded as evidence with the tick it happened on.
              divergedAtTick: r.desync ? r.desync.tick : null,
              crashCause: r.crashCause,
              endReason: r.endReason,
              replayMaxTicks: r.replayMaxTicks,
              endTick: r.endTick,
              distanceM: r.distanceM,
              score: r.score,
              maxAirtimeMs: r.maxAirtimeMs,
              checkpointsChecked: r.checkpointsChecked,
              dailyRuleId: r.dailyRuleId,
            });
            if (!args.quiet) {
              console.error(`[${seed} ${args.field} ${offset >= 0 ? '+' : ''}${offset}] ${r.endReason} ${r.distanceM}m score ${r.score}${r.desync ? ` diverged@${r.desync.tick}` : ''}`);
            }
          }
        } catch (error) {
          failures.push({ seed, error: String(error && error.message ? error.message : error) });
          if (!args.quiet) console.error(`[${seed}] FAILED ${error.message}`);
        }
      }
      await page.close();
    };
    await Promise.all(Array.from({ length: Math.min(args.workers, seeds.length) }, worker));

    const agg = aggregate(rows);
    const record = {
      kind: 'bsb-issue-130-input-timing-sensitivity-preflight',
      formatVersion: 1,
      developerOnly: true,
      scope: 'One axis: fixed-tick input timing of one named control on one policy, replayed through the shipped TapePlayer. Developer preflight, not a balance, fairness or production-gameplay finding.',
      build: {
        ...sourceIdentity,
        dailyRuleId: rule === 'none' ? 'none' : rule,
        simTickHz: SIM_TICK_HZ,
        pinnedUtc: PINNED_UTC,
        policy: 'flip',
      },
      args: { seeds: seeds.length, seedList: seeds, field: args.field, offsets, maxM: args.maxM, maxSec: args.maxSec, workers: args.workers },
      captures,
      failures,
      rows,
      aggregate: agg,
    };
    // A checkout changing mid-measurement invalidates the evidence even if
    // the per-seed physics replay was deterministic at each point in time.
    const endSource = readVerifiedSourceIdentity({ root });
    if (JSON.stringify(endSource) !== JSON.stringify(sourceIdentity)) {
      throw new Error('source identity/worktree state changed during measurement; refusing mixed-source report');
    }
    const text = JSON.stringify(record, null, 1);
    if (args.out) {
      mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
      writeFileSync(args.out, text);
    }
    report(record);
    if (failures.length) { console.error(`\n${failures.length} seed(s) failed; see the record's failures[].`); return 2; }
    return 0;
  } finally {
    await browser.close();
    vite.kill('SIGTERM');
  }
}

function report(record) {
  const { aggregate: agg, captures } = record;
  console.log(`\nSEEDS ${agg.seeds.length} (${agg.seeds.join(', ')})  FIELD ${record.args.field}  RULE ${record.build.dailyRuleId}`);
  console.log(`observations ${agg.observations}  measured ${agg.measured}  excluded ${agg.excluded}  censored ${agg.censoring.censored}  stalled ${agg.censoring.stalled}`);
  console.log('\noffset  obs  excl  crash  censored  crashRate  95% CI          small-N');
  console.log('------  ---  ----  -----  --------  ---------  --------------  -------');
  for (const b of agg.bins) {
    const ci = b.crashRateCi95 ? `[${b.crashRateCi95[0].toFixed(2)}, ${b.crashRateCi95[1].toFixed(2)}]` : '-';
    console.log(
      `${String(b.offset).padStart(6)}  ${String(b.observations).padStart(3)}  ${String(b.excluded).padStart(4)}  ` +
      `${String(b.crashed).padStart(5)}  ${String(b.censored).padStart(8)}  ${String(b.crashRate ?? '-').padStart(9)}  ` +
      `${ci.padEnd(14)}  ${b.smallSample ? 'WARN' : ''}`,
    );
  }
  console.log('\noffset  paired  changed  changedRate  95% CI          small-N');
  console.log('------  ------  -------  -----------  --------------  -------');
  for (const c of agg.comparisons) {
    const ci = c.changedRateCi95 ? `[${c.changedRateCi95[0].toFixed(2)}, ${c.changedRateCi95[1].toFixed(2)}]` : '-';
    console.log(
      `${String(c.offset).padStart(6)}  ${String(c.paired).padStart(6)}  ${String(c.changed).padStart(7)}  ` +
      `${String(c.changedRate ?? '-').padStart(11)}  ${ci.padEnd(14)}  ${c.smallSample ? 'WARN' : ''}`,
    );
  }
  const b = agg.boundary;
  console.log(`\nboundary: every paired seed changed at offset ${b.allSeedsChangedAtOffset ?? 'none observed'}; ` +
    `any seed changed at offset ${b.anySeedChangedAtOffset ?? 'none observed'}`);
  console.log(b.note);
  console.log(`\n${agg.noExtrapolation}`);
  if (agg.bins.some((x) => x.smallSample)) console.log(`\nWARNING: some bins have fewer than ${agg.smallSampleThreshold} observations. Their rates are not stable estimates.`);
  if (agg.censoring.censored) console.log(`NOTE: ${agg.censoring.censored} run(s) reached the measurement cap and are CENSORED, not survivors.`);
  console.log(`\ncaptures: ${captures.map((c) => `${c.seed}=${c.endReason}@${c.endTick}`).join(' ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code), (error) => { console.error(error && error.message ? error.message : error); process.exit(1); });
}

export { main, report };
