import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPrivateAirtimeChecks, assertReplay, replayFrames, replayKeys } from '../../tools/sim/benchmark-replay.mjs';
import {
  MAX_AIRTIME_FILE_BYTES, MAX_AIRTIME_TICKS, airtimeBuildPin, assertAirtimeMatch, summarizeAirtime, validateAirtimeTape,
} from '../../tools/sim/replay-airtime.js';
import { GhostRecorder } from '../../src/systems/ghost/GhostTape.js';
import { runRandomState, runRandomStreams } from '../../src/systems/RunRandom.js';
import { SimClock } from '../../src/systems/SimClock.js';

function savedTape() {
  const seed = 'private-local-fixture', startedAt = Date.UTC(2026, 0, 5, 12);
  const body = { position: { x: 2, y: 3 }, angle: 0, velocity: { x: 2, y: 1 }, angularVelocity: 0 };
  const recorder = new GhostRecorder({
    seed, biomeMask: 16, mode: 'normal', startedAt, dailyRuleId: 'featherweight', controlLayout: 'tricksLeft',
    boosts: [], upgradeRanks: null, magnetsDrop: false, kodiaksOn: false, kodiakPackMode: 'same', kodiakVersion: 2,
    startPose: [2, 3, 0, 2, 1, 0], random: runRandomState(runRandomStreams(seed)),
  });
  const scene = { sled: { body }, score: { getTotal: () => 1 } };
  for (let tick = 1; tick <= 245; tick++) {
    recorder.input(tick, { push: tick < 150 });
    recorder.afterTick(tick, scene);
  }
  recorder.input(246, { hop: true }); // recorder observes an input on the fatal tick, not a completed observation
  return recorder.finish({ runId: `${startedAt}-${seed}`, distanceM: 12, score: 12, endedAt: startedAt + 2050 });
}

test('accepts a complete recorded normal protocol and an unplayed fatal-tick row', () => {
  const tape = savedTape();
  expect(tape.inputs.reduce((last, [delta]) => last + delta, 0)).toBe(tape.endTick + 1);
  expect(tape.checkpoints.map(([tick]) => tick)).toEqual([120, 240]);
  expect(validateAirtimeTape(tape)).toBe(tape);
});

test.each([
  ['wrong mode', (t) => { t.mode = 'daily'; }],
  ['legacy format', (t) => { t.version = 0; }],
  ['unknown physics', (t) => { t.physicsVersion++; }],
  ['unknown run RNG', (t) => { t.runRandomVersion++; }],
  ['missing date', (t) => { delete t.startedAt; }],
  ['missing day rule', (t) => { delete t.dailyRuleId; }],
  ['unknown day rule', (t) => { t.dailyRuleId = 'mystery'; }],
  ['missing pose', (t) => { delete t.startPose; }],
  ['invalid pose', (t) => { t.startPose[0] = Infinity; }],
  ['missing RNG state', (t) => { delete t.random.visualCamera; }],
  ['missing explicit option', (t) => { delete t.kodiaksOn; }],
  ['wrong pack version', (t) => { t.kodiakVersion = 0; }],
  ['unknown control layout', (t) => { t.controlLayout = 'mystery'; }],
  ['unknown boost', (t) => { t.boosts = ['mystery']; }],
  ['invalid applied rank', (t) => { t.upgradeRanks = { speed: 0 }; }],
  ['missing checkpoint', (t) => { t.checkpoints.pop(); }],
  ['no real checkpoints', (t) => { t.checkpoints = []; t.endTick = 100; }],
  ['off-cadence checkpoint', (t) => { t.checkpoints[1][0]--; }],
  ['duplicate checkpoint', (t) => { t.checkpoints[1] = t.checkpoints[0]; }],
  ['wrong checkpoint shape', (t) => { t.checkpoints[0].push(0); }],
  ['tick-only checkpoint', (t) => { t.checkpoints[0] = [120]; }],
  ['nonfinite checkpoint', (t) => { t.checkpoints[0][2] = NaN; }],
  ['out-of-bounds duration', (t) => { t.endTick = MAX_AIRTIME_TICKS + 1; }],
  ['input more than one tick past last completion', (t) => { t.inputs.at(-1)[0]++; }],
  ['invalid input codec bits', (t) => { t.inputs[0][1] = 0xc0000; }],
  ['invalid input tilt', (t) => { t.inputs[0][2] = 128; }],
  ['first input after first tick', (t) => { t.inputs[0][0]++; }],
  ['truncated trace', (t) => { t.trace = t.trace.slice(16); }],
  ['invalid trace symbols', (t) => { t.trace = '_' + t.trace.slice(1); }],
])('refuses incomplete or unsupported replay evidence: %s', (_, mutate) => {
  const tape = savedTape();
  mutate(tape);
  expect(() => validateAirtimeTape(tape)).toThrow();
});

test('counts completed intervals, both open boundaries and an uninterrupted all-air episode', () => {
  const sample = [false, false, true, false, true, false, false, false];
  expect(summarizeAirtime(sample)).toEqual({ observedTicks: 8, airborneTicks: 6, cumulativeAirborneMs: 50,
    episodes: { observed: 3, boundedByGround: 1, startsAirborne: true, endsAirborne: true, longestTicks: 3 } });
  expect(summarizeAirtime([false, false]).episodes).toEqual({ observed: 1, boundedByGround: 0,
    startsAirborne: true, endsAirborne: true, longestTicks: 2 });
  expect(summarizeAirtime([true]).airborneTicks).toBe(0);
  expect(summarizeAirtime([true]).episodes.observed).toBe(0);
  expect(() => summarizeAirtime([false, 0])).toThrow(/observation/);
});

test('matches the full per-tick signal, not just aggregate episode and airtime totals', () => {
  expect(() => assertAirtimeMatch([true, false, true, true], [true, true, false, true], 4)).toThrow(/tick 2/);
  expect(() => assertAirtimeMatch([true], [true], 2)).toThrow(/every completed tick/);
});

test('private diagnostic reports the failure class without assertion values', () => {
  const tape = { endTick: 2, checkpoints: [[2]] };
  const baseline = { tick: 2, checked: 1, crashed: false, droppedMs: 0, savedRecord: false, desync: null,
    states: [[1, 0], [2, 0]], grounded: [true, false], pageInfo: { gameEntry: 'private-local-path' } };
  for (const [result, expected] of [
    [{ ...baseline, desync: { tick: 2, got: [12345.625], want: [67.25] } }, 'Existing tape checkpoint desynced'],
    [{ ...baseline, states: [[1, 12345.625], [2, 0]] }, 'Replay divergence in trial 2 at tick 1'],
    [{ ...baseline, pageInfo: { gameEntry: 'other-local-path' } }, 'Browser or game entry changed during airtime checks'],
  ]) {
    expect(() => assertPrivateAirtimeChecks(result, tape, baseline, 2)).toThrow(new Error(expected));
  }
});

function observedGame() {
  let reads = 0;
  const run = {
    sled: { body: { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 },
      get grounded() { reads++; return run.simClock.tick % 2 === 1; } },
    simClock: new SimClock(), score: { getTotal: () => 0 }, runRandom: { physicsScramble: { state: 42 } },
    tapePlayer: { desync: null, checked: 0 },
  };
  return { reads: () => reads, game: { registry: { get: () => null }, scene: { getScene: () => run },
    step() { run.simClock.tick++; run.crashed = run.simClock.tick === 4; } } };
}

test('grounded is read once per completed tick, never on the fatal tick or the ordinary benchmark', () => {
  const strict = observedGame(), ordinary = observedGame();
  const read = (fixture, observeGrounded) => replayFrames({ tickLimit: 8, measure: false, keys: replayKeys, observeGrounded }, fixture.game);
  const result = read(strict, true);
  expect(result.grounded).toEqual([true, false, true]);
  expect(strict.reads()).toBe(3);
  expect(read(ordinary, false)).not.toHaveProperty('grounded');
  expect(ordinary.reads()).toBe(0);
  expect(() => assertReplay(result, { checkpoints: [] }, 8, true)).toThrow(/without crashing/);
});

test('only explicit opt-in with one bounded local file accepts analytics, with no raw path on intake failure', () => {
  const pin = 'a'.repeat(40);
  expect(airtimeBuildPin(pin.toUpperCase())).toBe(pin);
  const base = ['tools/sim/benchmark-replay.mjs', '--airtime-build', pin];
  const launch = (...args) => spawnSync(process.execPath, [...base, ...args], { encoding: 'utf8' });
  const tmp = mkdtempSync(join(tmpdir(), 'bb-replay-airtime-'));
  const tape = join(tmp, 'private.json');
  try {
    expect(launch()).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('explicit saved') });
    expect(launch('--tape', tape, '--ticks', '245')).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('does not accept --ticks') });
    expect(launch('--tape', tape, '--repeats', '1')).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('2–5 fresh runs') });
    expect(launch('--tape', tape).stderr).not.toContain(tmp);
    writeFileSync(tape, Buffer.alloc(MAX_AIRTIME_FILE_BYTES + 1));
    expect(launch('--tape', tape)).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('exceeds 2 MiB') });
    writeFileSync(tape, Buffer.from([255]));
    expect(launch('--tape', tape)).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('UTF-8 JSON') });
  } finally { rmSync(tmp, { force: true, recursive: true }); }
});
