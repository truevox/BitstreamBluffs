/**
 * Issue #132: measure a real, local fixed-tick replay without changing its inputs.
 * Run with --help for options. There are no imports from this tool into the game.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { REG, SCENES } from '../../src/constants.js';
import { EVT } from '../../src/events.js';
import { RUN_RANDOM_VERSION } from '../../src/systems/RunRandom.js';
import { SIM_TICK_HZ } from '../../src/systems/SimClock.js';
import { tapeCompatible } from '../../src/systems/ghost/GhostLibrary.js';
import { GhostRecorder } from '../../src/systems/ghost/GhostTape.js';
import {
  MAX_AIRTIME_FILE_BYTES, airtimeBuildPin, assertAirtimeMatch, summarizeAirtime, validateAirtimeTape,
} from './replay-airtime.js';
import { CrashBriefError, checkFatalObservation, crashBriefBuildPin, crashBriefReport } from './replay-crash-brief.js';

const fixedTime = Date.UTC(2026, 0, 5, 12);
const viewport = { width: 960, height: 540 };
const defaultTicks = 9 * SIM_TICK_HZ;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const replayKeys = {
  title: SCENES.TITLE, run: SCENES.RUN, tape: REG.GHOST_REPLAY,
  record: REG.LAST_RECORD, latestTape: REG.LAST_GHOST_TAPE,
};

export function defaultTape() {
  // The opening nine seconds of GHOST56's scripted smoke workload. Synthesize
  // only the inputs with the production encoder; no invented replay checkpoints.
  const recorder = new GhostRecorder({
    seed: 'GHOST56', biomeMask: 0, mode: 'normal', startedAt: fixedTime,
    boosts: [], upgradeRanks: null, magnetsDrop: false, kodiaksOn: false, kodiakPackMode: 'same',
  });
  for (let tick = 1; tick <= defaultTicks; tick++) {
    const ms = (tick - 1) * 1000 / SIM_TICK_HZ;
    const hop = ms === 2600 || ms === 5900;
    recorder.input(tick, {
      push: ms < 1800 || (ms >= 4200 && ms < 5200),
      tuck: ms >= 7000 && ms < 8200,
      variableHop: true, noAutoNudge: true, hop, pressed: { hop },
    });
  }
  return { ...recorder.header, inputs: recorder.inputs, checkpoints: [], trace: '', endTick: defaultTicks };
}

export function localUrl(value) {
  const url = new URL(value);
  assert.ok(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    !url.username && !url.password, 'Use an HTTP loopback URL for a local game build');
  return url;
}

export function summarize(samples) {
  assert.ok(samples.length && samples.every((sample) => Number.isFinite(sample) && sample >= 0),
    'Timing samples must be finite and non-negative');
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p) => sorted[Math.ceil(p * sorted.length) - 1];
  return { count: sorted.length, totalMs: samples.reduce((a, b) => a + b, 0), p95Ms: rank(.95), p99Ms: rank(.99) };
}

// Serialized into the page by Playwright, so the function only uses its arguments
// and browser globals. The optional game and clock parameters are test seams.
export function replayFrames({ tickLimit, measure, keys, observeGrounded = false, crashEvent }, game = globalThis.__bbGame, now = () => performance.now()) {
  const run = game.scene.getScene(keys.run);
  const dt = run.simClock.tickMs;
  const originalTick = run.simTick;
  const hadOwnTick = Object.hasOwn(run, 'simTick');
  const tickTimes = [], frameTimes = [], overheadTimes = [], states = [], grounded = [];
  let fatalCount = 0, fatalEvent;
  const observeFatal = (event) => {
    if (event?.fatal !== true) return;
    fatalCount++;
    if (fatalCount === 1 && event.runId === run.runId && event.negated === false) {
      // Private comparison only, without the event's run identity.
      fatalEvent = { tick: run.simClock.tick, cause: event.cause, hazardId: event.hazardId,
        x: event.x, y: event.y, speedPxS: event.speedPxS };
    }
  };
  if (crashEvent) game.events.on(crashEvent, observeFatal);
  if (measure) {
    run.simTick = function (...args) {
      const start = now();
      try { return originalTick.apply(this, args); }
      finally { tickTimes.push(now() - start); }
    };
  }
  try {
    let frame = 0;
    while (run.simClock.tick < tickLimit && !run.crashed) {
      const previousTick = run.simClock.tick;
      const start = measure ? now() : 0;
      // One tick per frame, with an exact synthetic frame clock. Elapsed
      // measurement time never enters this schedule, the pad, or the tick.
      game.step(++frame * dt, dt);
      if (measure) {
        const elapsed = now() - start;
        frameTimes.push(elapsed);
        // Both intervals use the same monotonic clock; guard rounding noise.
        overheadTimes.push(Math.max(0, elapsed - tickTimes.at(-1)));
      }
      if (run.simClock.tick !== previousTick + 1) {
        throw new Error(`Expected one fixed tick per frame after tick ${previousTick}`);
      }
      if (observeGrounded && !run.crashed) {
        const savedContact = run.sled.grounded;
        if (typeof savedContact !== 'boolean') throw new Error('Grounded state is unavailable');
        grounded.push(savedContact);
      }
      const b = run.sled.body;
      states.push([
        run.simClock.tick, b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y,
        b.angularVelocity, run.score.getTotal(), run.runRandom.physicsScramble.state, !!run.crashed,
      ]);
    }
    return {
      states, tick: run.simClock.tick, crashed: !!run.crashed, droppedMs: run.simClock.droppedMs,
      dailyRuleId: run.dailyRuleId, checked: run.tapePlayer.checked, desync: run.tapePlayer.desync,
      savedRecord: Boolean(game.registry.get(keys.record) || game.registry.get(keys.latestTape)),
      tickTimes, frameTimes, overheadTimes, ...(observeGrounded ? { grounded } : {}),
      ...(crashEvent ? { fatalCount, fatalEvent } : {}),
    };
  } finally {
    if (crashEvent) game.events.off(crashEvent, observeFatal);
    if (measure && hadOwnTick) run.simTick = originalTick;
    else if (measure) delete run.simTick;
  }
}

async function browserReplay(browser, url, tape, tickLimit, measure, airtime = false, crashBrief = false) {
  const strict = airtime || crashBrief;
  const setupStart = performance.now();
  // An empty, throwaway context cannot see a player's profile, reports or ghosts.
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' }).catch((error) => {
    if (crashBrief) throw new CrashBriefError('Could not open a local Chromium context for crash brief');
    if (!airtime) throw error;
    throw new Error('Could not open a local Chromium context for airtime');
  });
  const errors = [];
  let closing = false;
  let output;
  const routeError = (error) => {
    // Playwright may cancel outstanding asset loads during context teardown.
    // Errors before teardown, or unrelated errors during it, still fail the trial.
    if (closing && /disposed|has been closed|cancelled|canceled/i.test(String(error))) return;
    errors.push(String(error));
  };
  try {
    await context.route('**/*', async (route) => {
      try {
        const request = route.request();
        if (new URL(request.url()).origin !== url.origin || (crashBrief && !['GET', 'HEAD'].includes(request.method()))) {
          await route.abort();
          return;
        }
        // An intercepted redirect could otherwise request outside the allowed origin.
        const response = await route.fetch({ maxRedirects: 0 });
        if (closing) return;
        if (response.status() >= 300 && response.status() < 400) await route.abort();
        else await route.fulfill({ response });
      } catch (error) {
        routeError(error);
        if (!closing) await route.abort().catch(routeError);
      }
    });
    await context.routeWebSocket('**/*', async (socket) => {
      try { await socket.close(); }
      catch (error) { routeError(error); }
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.clock.setFixedTime(new Date(tape.startedAt ?? fixedTime));
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((title) => window.__bbGame?.scene.getScene(title)?.sys.isActive(), replayKeys.title);
    await page.evaluate(({ keys, tape, strict, settingsKey }) => {
      const game = window.__bbGame;
      const run = game.scene.getScene(keys.run);
      // Stop the rAF clock before starting the replay. Drive scene creation
      // with a zero-delta frame; the normal fixed clock owes no tick yet.
      game.loop.sleep();
      if (strict) {
        // Restore the declared layout only in this disposable context. Do not
        // call the settings writer or read from a player's environment.
        const defaults = game.registry.get(settingsKey);
        if (!defaults) throw new Error('Airtime replay settings are unavailable');
        game.registry.set(settingsKey, { ...defaults, controlLayout: tape.controlLayout });
      }
      game.registry.set(keys.tape, tape);
      game.scene.stop(keys.title);
      game.scene.start(keys.run);
      game.step(0, 0);
      if (!run.sys.isActive() || !run.tapePlayer || run.simClock.tick !== 0) {
        throw new Error('Replay did not initialize at tick zero');
      }
      if (strict) {
        const b = run.sled.body;
        const start = [b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y, b.angularVelocity];
        const ranks = run.upgradeRun?.ranks ?? {};
        const wantedRanks = tape.upgradeRanks ?? {};
        const actualBoosts = run.appliedBoosts, wantedBoosts = [...tape.boosts].sort();
        if (!start.every((value, i) => value === tape.startPose[i]) || Object.keys(tape.random).some((name) =>
          name === 'version' ? tape.random.version !== run.runRandom.version :
            !Number.isSafeInteger(run.runRandom[name]?.state) || tape.random[name] !== (run.runRandom[name].state >>> 0))) {
          throw new Error('Airtime replay did not reconstruct the recorded initial pose and RNG');
        }
        if (run.seed !== tape.seed || run.biomeMask !== tape.biomeMask || run.startedAt !== tape.startedAt ||
            run.dailyRuleId !== tape.dailyRuleId || run.dailyOfficial || run.bsodGym || run.ghostRecorder ||
            run.magnetsDrop !== tape.magnetsDrop || run.kodiaksOn !== tape.kodiaksOn || run.kodiakPackMode !== tape.kodiakPackMode ||
            run.settings?.controlLayout !== tape.controlLayout ||
            actualBoosts?.length !== wantedBoosts.length || !wantedBoosts.every((id, i) => actualBoosts[i] === id) ||
            Object.keys(ranks).length !== Object.keys(wantedRanks).length ||
            !Object.entries(wantedRanks).every(([id, rank]) => ranks[id] === rank)) {
          throw new Error('Airtime replay did not reconstruct the recorded normal-run options');
        }
      }
    }, { keys: replayKeys, tape, strict, settingsKey: REG.SETTINGS });
    const setupMs = performance.now() - setupStart;
    const result = await page.evaluate(replayFrames, { tickLimit, measure, keys: replayKeys, observeGrounded: airtime,
      ...(crashBrief ? { crashEvent: EVT.CRASH } : {}) });
    if (strict) {
      const noStoredRuns = await page.evaluate(async ({ saveStore, ghosts }) => {
        const registry = window.__bbGame.registry;
        const store = registry.get(saveStore), library = registry.get(ghosts);
        return (await store?.getRecentRuns(1))?.length === 0 &&
          library?.courses?.size === 0 && library?.tapes?.size === 0;
      }, { saveStore: REG.SAVE_STORE, ghosts: REG.GHOSTS });
      if (!noStoredRuns && crashBrief) throw new CrashBriefError('Crash brief playback must not store runs or ghost tapes');
      assert.ok(noStoredRuns, 'Airtime playback must not store runs or ghost tapes');
    }
    const pageInfo = await page.evaluate(() => {
      const game = window.__bbGame;
      const gl = game.renderer.gl;
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        gameEntry: document.querySelector('script[type=module][src]')?.getAttribute('src') ?? null,
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? null,
      };
    });
    output = { ...result, setupMs, pageInfo };
  } catch (error) {
    if (crashBrief) {
      if (error instanceof CrashBriefError) throw error;
      throw new CrashBriefError('Crash brief browser replay failed before checks could complete');
    }
    if (!airtime) throw error;
    // Do not surface Playwright call locations, the supplied local paths or
    // interpolated page text from an untrusted failed replay.
    const known = [
      'Replay did not initialize at tick zero', 'Airtime replay settings are unavailable',
      'Airtime replay did not reconstruct the recorded initial pose and RNG',
      'Airtime replay did not reconstruct the recorded normal-run options',
      'Expected one fixed tick per frame', 'Grounded state is unavailable',
      'Airtime playback must not store runs or ghost tapes',
    ].find((message) => String(error.message).includes(message));
    throw new Error(known ?? 'Airtime browser replay failed before checks could complete');
  } finally {
    closing = true;
    await context.close().catch((error) => {
      if (crashBrief) throw new CrashBriefError('Crash brief browser context did not close cleanly');
      if (!airtime) throw error;
      throw new Error('Airtime browser context did not close cleanly');
    });
  }
  if (crashBrief) {
    if (errors.length) throw new CrashBriefError('Crash brief browser or route errors');
  } else if (airtime) assert.ok(errors.length === 0, 'Airtime browser or route errors');
  else assert.deepEqual(errors, [], 'Browser or route errors');
  return output;
}

export function assertReplay(result, tape, tickLimit, savedTape) {
  assert.equal(result.desync, null, 'Existing tape checkpoint desynced');
  assert.ok(!result.savedRecord, 'Developer replay must not save records or tapes');
  assert.equal(result.droppedMs, 0, 'Synthetic frame schedule dropped simulation time');
  if (tape.dailyRuleId) assert.equal(result.dailyRuleId, tape.dailyRuleId, 'Recorded rule differs');
  // GhostRecorder.endTick is the last completed tick before the recorded
  // crash. Crashing at or before that tick is not the same saved workload.
  if (savedTape) assert.ok(!result.crashed && result.tick === tickLimit,
    `Saved replay did not reach tick ${tickLimit} without crashing (stopped at ${result.tick})`);
  const lastCheckpointTick = result.tick - Number(result.crashed);
  assert.equal(result.checked, tape.checkpoints.filter(([tick]) => tick <= lastCheckpointTick).length,
    'Some available tape checkpoints were not checked');
  assert.ok(result.tick === tickLimit || result.crashed, 'Replay stopped unexpectedly');
  assert.ok(result.states.length > 0, 'Replay did not step');
}

function assertSameReplay(actual, expected, trial) {
  assert.equal(actual.dailyRuleId, expected.dailyRuleId, `Different rules in trial ${trial}`);
  assert.equal(actual.states.length, expected.states.length, `Different number of ticks in trial ${trial}`);
  for (let i = 0; i < expected.states.length; i++) {
    assert.deepEqual(actual.states[i], expected.states[i], `Replay divergence in trial ${trial} at tick ${i + 1}`);
  }
}

async function readAirtimeTape(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
    .catch(() => { throw new Error('Could not open the local airtime tape'); });
  try {
    const stat = await file.stat();
    assert.ok(stat.isFile(), 'Use one regular local airtime tape file');
    assert.ok(stat.size <= MAX_AIRTIME_FILE_BYTES, 'Airtime tape exceeds 2 MiB');
    const buffer = Buffer.alloc(MAX_AIRTIME_FILE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    assert.ok(size <= MAX_AIRTIME_FILE_BYTES, 'Airtime tape exceeds 2 MiB');
    let tape;
    try { tape = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))); }
    catch { throw new Error('Airtime needs a UTF-8 JSON tape'); }
    return validateAirtimeTape(tape);
  } finally { await file.close(); }
}

export function assertPrivateAirtimeChecks(result, tape, reference, trial) {
  try {
    assertReplay(result, tape, tape.endTick, true);
    assert.equal(result.grounded.length, tape.endTick, 'Expected one grounded observation per completed tick');
    if (reference) {
      assertSameReplay(result, reference, trial);
      assertAirtimeMatch(result.grounded, reference.grounded, tape.endTick);
      assert.deepEqual(result.pageInfo, reference.pageInfo, 'Browser or game entry changed during airtime checks');
    }
  } catch (error) {
    // All assertions above set an explicit first-line diagnosis. Node appends
    // actual/expected data, which can contain private replay state or paths.
    if (error instanceof assert.AssertionError) throw new Error(error.message.split('\n', 1)[0]);
    throw new Error('Airtime replay observations are invalid');
  }
}

async function runAirtime(browser, url, tape, repeats, build) {
  const reference = await browserReplay(browser, url, tape, tape.endTick, false, true);
  assertPrivateAirtimeChecks(reference, tape);
  for (let i = 1; i < repeats; i++) {
    const next = await browserReplay(browser, url, tape, tape.endTick, false, true);
    assertPrivateAirtimeChecks(next, tape, reference, i + 1);
  }
  return {
    kind: 'local-replay-airtime', reportVersion: 1,
    scope: 'asserted same-build saved tape; local unverified analytics, not a leaderboard result',
    build: { assertedGitCommit: build, independentlyVerified: false },
    versions: { tape: tape.version, physics: tape.physicsVersion, simTickHz: tape.simTickHz,
      runRandom: tape.runRandomVersion, kodiak: tape.kodiakVersion },
    replay: { freshRuns: repeats, checkpointsCheckedPerRun: reference.checked, matchedGroundedAndStateEveryTick: true,
      savedRunsOrTapes: false },
    airtime: summarizeAirtime(reference.grounded),
  };
}

export function assertPrivateCrashBriefChecks(result, tape, reference, trial) {
  const fatalTick = tape.endTick + 1;
  checkFatalObservation(result, fatalTick, reference);
  try {
    // A fatal tick has no completed checkpoint. The strict tape reader has
    // already required every checkpoint through the last completed tick.
    assertReplay(result, tape, fatalTick, false);
    assert.ok(result.states.length === fatalTick && Array.from(result.states).every((state, i) =>
      Array.isArray(state) && state.length === 10 && state[0] === i + 1 &&
      state.slice(1, 9).every(Number.isFinite) && state[9] === (i + 1 === fatalTick)));
  } catch {
    throw new CrashBriefError('Crash brief replay did not pass the checkpoint and isolation checks');
  }
  if (reference) {
    try {
      assertSameReplay(result, reference, trial);
      assert.deepEqual(result.pageInfo, reference.pageInfo);
    } catch {
      throw new CrashBriefError('Crash brief observations differed between fresh replays');
    }
  }
}

async function runCrashBrief(browser, url, tape, repeats) {
  let reference;
  for (let trial = 1; trial <= repeats; trial++) {
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new CrashBriefError('Crash brief trial exceeded its 60-second wall limit')), 60000);
      });
      const result = await Promise.race([browserReplay(browser, url, tape, tape.endTick + 1, false, false, true), timeout]);
      assertPrivateCrashBriefChecks(result, tape, reference, trial);
      reference ??= result;
    } finally { clearTimeout(timer); }
  }
  return crashBriefReport(reference.fatalEvent, repeats, reference.checked);
}

async function main() {
  const { values: options } = parseArgs({
    options: {
      url: { type: 'string', default: 'http://127.0.0.1:8293/' },
      tape: { type: 'string' }, ticks: { type: 'string' },
      repeats: { type: 'string', default: '3' },
      'airtime-build': { type: 'string' }, 'crash-brief-build': { type: 'string' },
      'native-gpu': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (options.help) {
    console.log('Usage: node tools/sim/benchmark-replay.mjs [--url URL] [--tape saved-tape.json] [--ticks N] [--repeats N] [--native-gpu]');
    console.log('Airtime: add --airtime-build FULL_GIT_COMMIT and --tape FILE, omit --ticks, set --repeats 2–5');
    console.log('Crash brief: add --crash-brief-build FULL_GIT_COMMIT and --tape FILE, omit --airtime-build and --ticks, set --repeats 2–5');
    return;
  }
  const crashBrief = options['crash-brief-build'] !== undefined;
  if (crashBrief && options['airtime-build'] !== undefined) {
    throw new CrashBriefError('Choose either crash brief or airtime, not both');
  }
  let url;
  try { url = localUrl(options.url); }
  catch (error) {
    if (crashBrief) throw new CrashBriefError('Crash brief needs an HTTP loopback game URL');
    throw error;
  }
  const airtime = options['airtime-build'] === undefined ? null : airtimeBuildPin(options['airtime-build']);
  const repeats = Number(options.repeats);
  if (crashBrief) {
    crashBriefBuildPin(options['crash-brief-build']);
    if (!options.tape || options.ticks !== undefined) {
      throw new CrashBriefError('Crash brief needs an explicit saved --tape and does not accept --ticks');
    }
    if (!Number.isSafeInteger(repeats) || repeats < 2 || repeats > 5) {
      throw new CrashBriefError('Crash brief needs 2–5 fresh runs');
    }
  }
  if (airtime) {
    assert.ok(options.tape && options.ticks === undefined, 'Airtime needs an explicit saved --tape and does not accept --ticks');
    assert.ok(Number.isSafeInteger(repeats) && repeats >= 2 && repeats <= 5, 'Airtime needs 2–5 fresh runs');
  }
  const tape = crashBrief ? await readAirtimeTape(options.tape).catch(() => {
    throw new CrashBriefError('Crash brief needs a readable, bounded, complete compatible normal-run tape');
  }) : airtime ? await readAirtimeTape(options.tape) : options.tape ? JSON.parse(await readFile(options.tape, 'utf8')) : defaultTape();
  assert.ok(tapeCompatible(tape) && tape.runRandomVersion === RUN_RANDOM_VERSION &&
    tape.mode === 'normal' && typeof tape.seed === 'string' && tape.seed.length &&
    Array.isArray(tape.inputs) && Array.isArray(tape.checkpoints) &&
    Number.isSafeInteger(tape.endTick) && tape.endTick > 0 &&
    (tape.startedAt == null || Number.isFinite(new Date(tape.startedAt).getTime())),
  'Use a compatible normal-run ghost tape with inputs, checkpoints and a recorded end tick');
  const ticks = Number(options.ticks ?? tape.endTick);
  assert.ok(Number.isSafeInteger(ticks) && ticks > 0 && ticks <= tape.endTick, 'Ticks must be within the tape duration');
  assert.ok(Number.isSafeInteger(repeats) && repeats >= 1 && repeats <= 20, 'Repeats must be 1–20');

  const { chromium } = await import('playwright');
  const args = ['--enable-webgl', '--ignore-gpu-blocklist'];
  if (!options['native-gpu']) args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const executablePath = process.env.CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch({ headless: true, executablePath, args }).catch((error) => {
    if (crashBrief) throw new CrashBriefError('Could not launch local Chromium for crash brief');
    if (!airtime) throw error;
    throw new Error('Could not launch local Chromium for airtime');
  });
  if (crashBrief) {
    let report;
    try { report = await runCrashBrief(browser, url, tape, repeats); }
    finally {
      await browser.close().catch(() => { throw new CrashBriefError('Crash brief browser did not close cleanly'); });
    }
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  try {
    if (airtime) {
      console.log(JSON.stringify(await runAirtime(browser, url, tape, repeats, airtime), null, 2));
      return;
    }
    const reference = await browserReplay(browser, url, tape, ticks, false);
    assertReplay(reference, tape, ticks, Boolean(options.tape));
    const trials = [];
    for (let i = 0; i < repeats; i++) {
      const trial = await browserReplay(browser, url, tape, ticks, true);
      assertReplay(trial, tape, ticks, Boolean(options.tape));
      assertSameReplay(trial, reference, i + 1);
      assert.deepEqual(trial.pageInfo, reference.pageInfo, 'Browser or game entry changed during the benchmark');
      assert.equal(trial.tickTimes.length, trial.tick, 'Expected one timing sample per tick');
      const simTick = summarize(trial.tickTimes), frame = summarize(trial.frameTimes);
      trials.push({
        setupMs: trial.setupMs, simTick, frame, frameOutsideSimTick: summarize(trial.overheadTimes),
        simTicksPerSecond: simTick.totalMs > 0 ? 1000 * trial.tick / simTick.totalMs : null,
        frameTicksPerSecond: frame.totalMs > 0 ? 1000 * trial.tick / frame.totalMs : null,
      });
    }
    const cpu = cpus();
    const [tick, x, y, angle, vx, vy, angularVelocity, score, physicsScrambleState] = reference.states.at(-1);
    console.log(JSON.stringify({
      reportVersion: 1,
      workload: {
        source: options.tape ? 'saved tape' : 'scripted GHOST56 opening',
        tapeSha256: hash(tape), seed: tape.seed, biomeMask: tape.biomeMask,
        boosts: tape.boosts, upgradeRanks: tape.upgradeRanks, magnetsDrop: tape.magnetsDrop,
        kodiaksOn: tape.kodiaksOn, kodiakPackMode: tape.kodiakPackMode,
        tickLimit: ticks, simTickHz: SIM_TICK_HZ, syntheticFrameHz: SIM_TICK_HZ,
        fixedTime: new Date(tape.startedAt ?? fixedTime).toISOString(), dailyRuleId: reference.dailyRuleId,
      },
      environment: {
        node: process.version, os: platform(), kernel: release(), arch: arch(),
        cpu: cpu[0]?.model ?? null, logicalCpus: cpu.length, memoryBytes: totalmem(),
        browser: chromium.name(), browserVersion: browser.version(), executablePath: executablePath ?? null,
        viewport, browserArgs: args, url: url.href, ...reference.pageInfo,
      },
      replay: {
        instrumentedMatchesReference: true, ticks: reference.tick, crashed: reference.crashed,
        checkpointsChecked: reference.checked,
        finalState: { tick, x, y, angle, vx, vy, angularVelocity, score, physicsScrambleState },
        observationSha256: hash(reference.states), uninstrumentedSetupMs: reference.setupMs,
      },
      trials,
    }, null, 2));
  } finally {
    await browser.close().catch((error) => {
      if (!airtime) throw error;
      throw new Error('Airtime browser did not close cleanly');
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const crashBrief = process.argv.slice(2).some((arg) => arg === '--crash-brief-build' || arg.startsWith('--crash-brief-build='));
  main().catch((error) => {
    // Parsing, file IO, browser paths and assertion details can all contain
    // user strings. Only a tool-authored diagnostic may leave this mode.
    console.error(crashBrief && !(error instanceof CrashBriefError) ? 'Crash brief failed before verification' : error.message);
    process.exitCode = 1;
  });
}
