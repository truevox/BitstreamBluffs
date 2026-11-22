import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { GhostRecorder, encodePad } from '../../src/systems/ghost/GhostTape.js';
import { PILOT, PILOT_KEYS, assertHandsOffCapture, driveHandsOff, localPilotUrl, makeHandsOffReport, pilotBuildPin, pilotWithinDeadline } from '../../tools/sim/hands-off-pilot.js';

const build = 'a'.repeat(40);
function scenario() {
  const startedAt = Date.parse(PILOT.calendarUtc);
  const recorder = new GhostRecorder({ seed: PILOT.seed, biomeMask: 0, mode: 'normal', dailyRuleId: PILOT.dailyRuleId,
    startedAt, controlLayout: PILOT.controlLayout, boosts: [], upgradeRanks: null, magnetsDrop: false, kodiaksOn: false,
    kodiakPackMode: 'same' });
  const body = { position: { x: 0, y: 0 }, angle: 0, velocity: { x: 1, y: 2 }, angularVelocity: 0 };
  const scene = { sled: { body }, score: { getTotal: () => 99 } };
  for (let tick = 1; tick <= 240; tick++) {
    recorder.input(tick, { variableHop: true, noAutoNudge: true });
    recorder.afterTick(tick, scene);
  }
  const tape = recorder.finish({ runId: 'private-fixture-run-id', endedAt: startedAt, distanceM: 514, score: 99 });
  const crash = { tick: 241, cause: 'hazard', hazardId: 'packetSpike', x: 10324, y: 200, distanceM: 514 };
  return { capture: { tape, crash }, replay: { tape: null, crash: { ...crash }, checked: 2, desynced: false, savedDuringPlayback: false } };
}

test('reports only the fixed public synthetic candidate and limited verification, not the captured tape', () => {
  const { capture, replay } = scenario();
  const report = makeHandsOffReport(capture, replay, build.toUpperCase());
  expect(report).toMatchObject({ kind: 'local-hands-off-pilot', build: { assertedGitCommit: build, independentlyVerified: false },
    challenge: { seed: 'sim-11', targetM: 500, biomeMask: 0, dailyRuleId: 'featherweight' },
    replay: { captureHz: 60, replayHz: 120, simTickHz: 120, neutralControls: true, checkpointsChecked: 2,
      completedTicksBeforeCrash: 240, exactNaturalCrashMatch: true, playbackSaved: false },
    observedFinish: capture.crash,
  });
  expect(JSON.stringify(report)).not.toMatch(/private-fixture|"inputs"|"trace"|"tape"|"runId"|"score"/);
  expect(makeHandsOffReport(capture, replay, build)).toEqual(report);
});

test.each([
  ['below target', ({ capture }) => { capture.crash.distanceM = 499.9; }],
  ['no natural crash observation', ({ capture }) => { capture.crash = null; }],
  ['past deadline', ({ capture }) => { capture.crash.tick = 4201; }],
  ['invalid termination coordinate', ({ capture }) => { capture.crash.y = NaN; }],
  ['wrong rule', ({ capture }) => { capture.tape.dailyRuleId = 'none'; }],
  ['wrong mode', ({ capture }) => { capture.tape.mode = 'daily'; }],
  ['incompatible RNG', ({ capture }) => { capture.tape.runRandomVersion = 0; }],
  ['wrong biome mask', ({ capture }) => { capture.tape.biomeMask = 16; }],
  ['wrong snapshot loadout', ({ capture }) => { capture.tape.kodiaksOn = true; }],
  ['active held control', ({ capture }) => { capture.tape.inputs[0].splice(1, 2, ...encodePad({ push: true })); }],
  ['active pressed control', ({ capture }) => { capture.tape.inputs[0].splice(1, 2, ...encodePad({ pressed: { hop: true } })); }],
  ['changed controls at a later tick', ({ capture }) => { capture.tape.inputs.push([2, 0, 0]); }],
  ['nonzero tilt', ({ capture }) => { capture.tape.inputs[0][2] = 1; }],
  ['unknown configuration', ({ capture }) => { capture.tape.inputs[0][1] = 0; }],
  ['absent checkpoint', ({ capture }) => { capture.tape.checkpoints.pop(); }],
  ['tick-only checkpoint', ({ capture }) => { capture.tape.checkpoints[0] = [120]; }],
  ['off-cadence checkpoint', ({ capture }) => { capture.tape.checkpoints[0][0] = 119; }],
  ['unmatched recorded completed length', ({ capture }) => { capture.tape.endTick--; }],
  ['replay desync', ({ replay }) => { replay.desynced = true; }],
  ['replay missed check', ({ replay }) => { replay.checked--; }],
  ['replay unexpected store', ({ replay }) => { replay.savedDuringPlayback = true; }],
  ['replay crash tick mismatch', ({ replay }) => { replay.crash.tick++; }],
  ['replay crash location mismatch', ({ replay }) => { replay.crash.y += .00001; }],
  ['replay crash cause mismatch', ({ replay }) => { replay.crash.cause = 'chasm'; }],
])('rejects a candidate without verified neutral replay: %s', (_, mutate) => {
  const input = scenario(); mutate(input);
  expect(() => makeHandsOffReport(input.capture, input.replay, build)).toThrow();
});

test('browser stepping is fixed, has no simulated key events and fails closed on a missing natural crash', async () => {
  const { capture } = scenario();
  const calls = [], keys = PILOT_KEYS, eventBus = new EventEmitter();
  const registry = new Map(), pilot = { ...PILOT, deadlineSeconds: 1 / 60 };
  const run = {
    sys: { isActive: () => true }, simClock: { tick: 0, droppedMs: 0 }, ghostRecorder: {}, tapePlayer: null,
    seed: PILOT.seed, biomeMask: 0, dailyOfficial: false, bsodGym: false, dailyRuleId: PILOT.dailyRuleId,
    startedAt: Date.parse(PILOT.calendarUtc), settings: { controlLayout: PILOT.controlLayout }, appliedBoosts: [],
    upgradeRun: { enabled: false, ranks: {} }, magnetsDrop: false, kodiaksOn: false, kodiakPackMode: 'same', startX: 44,
  };
  const game = { registry, events: eventBus, loop: { sleep() {} },
    scene: { getScene: () => run, stop() {}, start() {} },
    step(time, delta) { calls.push([time, delta]); if (delta) run.simClock.tick += 2; } };
  await expect(driveHandsOff({ pilot, keys, tape: null }, game)).rejects.toThrow(/No single natural crash/);
  expect(calls).toEqual([[0, 0], [1000 / 60, 1000 / 60]]);
  expect(eventBus.listenerCount(keys.crash)).toBe(0);
  expect(registry.has(keys.replay)).toBe(false);
  expect(assertHandsOffCapture(capture)).toBe(capture.tape);
});

test('the developer wall deadline allows a completed trial and fails a stalled trial', async () => {
  await expect(pilotWithinDeadline(Promise.resolve('complete'), 50)).resolves.toBe('complete');
  await expect(pilotWithinDeadline(new Promise(() => {}), 1)).rejects.toThrow('Pilot browser trial timed out');
});

test('CLI requires a build pin and loopback preview, and has no arbitrary search or output flags', () => {
  const command = (...args) => spawnSync(process.execPath, ['tools/sim/verify-hands-off.mjs', ...args], { encoding: 'utf8' });
  expect(pilotBuildPin(build.toUpperCase())).toBe(build);
  expect(localPilotUrl('http://[::1]:8293/').hostname).toBe('[::1]');
  for (const example of ['https://localhost/', 'http://localhost.evil/', 'http://person@127.0.0.1/']) {
    expect(() => localPilotUrl(example)).toThrow(/loopback/);
  }
  expect(command()).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('Git build commit') });
  expect(command('--build', build, '--url', 'https://invalid.example/')).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('loopback') });
  expect(command('--build', build, '--seed', 'other')).toMatchObject({ status: 1, stdout: '' });
  expect(command('--build', build, '--out', 'log')).toMatchObject({ status: 1, stdout: '' });
});
