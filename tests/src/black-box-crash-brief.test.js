import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EVT } from '../../src/events.js';
import { SimClock } from '../../src/systems/SimClock.js';
import { assertPrivateCrashBriefChecks, replayFrames, replayKeys } from '../../tools/sim/benchmark-replay.mjs';
import { checkFatalObservation, crashBriefReport } from '../../tools/sim/replay-crash-brief.js';

const tape = { endTick: 2, checkpoints: [[2]] };
const event = { tick: 3, cause: 'hazard', hazardId: 'glitchChasm', x: 12345.625, y: 67.25, speedPxS: 400 };
const observation = () => ({ tick: 3, checked: 1, crashed: true, droppedMs: 0, savedRecord: false, desync: null,
  states: [1, 2, 3].map((t) => [t, t * 2, t * 3, 0, 2, 1, 0, 12345, 42, t === 3]),
  fatalCount: 1, fatalEvent: { ...event }, pageInfo: { gameEntry: 'private-local-path' } });

function fakeGame({ fatalAt = 3, duplicate = false, runId = 'private-run-identity', throws = false } = {}) {
  const run = { runId: 'private-run-identity', simClock: new SimClock(), tapePlayer: { desync: null, checked: 1 },
    sled: { body: { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 } },
    score: { getTotal: () => 0 }, runRandom: { physicsScramble: { state: 42 } } };
  const events = new EventEmitter();
  const game = { events, registry: { get: () => null }, scene: { getScene: () => run },
    step() {
      const tick = ++run.simClock.tick;
      if (throws) throw new Error('unexpected');
      const payload = { ...event, runId };
      if (tick === 1) events.emit(EVT.CRASH, { ...payload, fatal: false, negated: true });
      if (tick === fatalAt) {
        run.crashed = true;
        events.emit(EVT.CRASH, { ...payload, fatal: true, negated: false });
        if (duplicate) events.emit(EVT.CRASH, { ...payload, fatal: true, negated: false });
      }
    } };
  return game;
}
const drive = (game, crashEvent = EVT.CRASH) => replayFrames({ tickLimit: 3, measure: false, keys: replayKeys, crashEvent }, game);

test('observes only the live fatal replay event, stops on its tick, and detaches the listener', () => {
  const game = fakeGame();
  const observed = drive(game);
  expect(observed).toMatchObject({ tick: 3, crashed: true, fatalCount: 1, fatalEvent: event });
  expect(observed.fatalEvent).not.toHaveProperty('runId');
  expect(game.events.listenerCount(EVT.CRASH)).toBe(0);
  const broken = fakeGame({ throws: true });
  expect(() => drive(broken)).toThrow('unexpected');
  expect(broken.events.listenerCount(EVT.CRASH)).toBe(0);
  const ordinary = fakeGame();
  expect(drive(ordinary, null)).not.toHaveProperty('fatalEvent');
  expect(ordinary.events.listenerCount(EVT.CRASH)).toBe(0);
});

test.each([{ fatalAt: 2 }, { fatalAt: 4 }, { duplicate: true }, { runId: 'unexpected-private-id' }])(
  'rejects an early, missing, duplicate or unassociated fatal event %j', (options) => {
    expect(() => checkFatalObservation(drive(fakeGame(options)), 3)).toThrow(/exactly one fatal crash/);
  });

test('two valid observations pass; independent exact private facts are required and never appear in diagnostics', () => {
  expect(() => assertPrivateCrashBriefChecks(observation(), tape, observation(), 2)).not.toThrow();
  for (const [mutate, expected] of [
    [(r) => { r.fatalEvent.cause = 'private-custom-category'; }, 'Replay emitted an unsupported fatal crash observation'],
    [(r) => { r.fatalEvent.speedPxS = 12345.625; }, 'Fatal observations differed between fresh replays'],
    [(r) => { r.fatalEvent.hazardId = 'private-custom-hazard'; }, 'Fatal observations differed between fresh replays'],
    [(r) => { r.fatalEvent.x = 12345; }, 'Fatal observations differed between fresh replays'],
    [(r) => { r.fatalEvent.y = NaN; }, 'Replay emitted an unsupported fatal crash observation'],
    [(r) => { r.checked = 0; }, 'Crash brief replay did not pass the checkpoint and isolation checks'],
    [(r) => { r.desync = { got: [12345.625] }; }, 'Crash brief replay did not pass the checkpoint and isolation checks'],
    [(r) => { r.savedRecord = true; }, 'Crash brief replay did not pass the checkpoint and isolation checks'],
    [(r) => { r.droppedMs = 42; }, 'Crash brief replay did not pass the checkpoint and isolation checks'],
    [(r) => { r.states.pop(); }, 'Crash brief replay did not pass the checkpoint and isolation checks'],
    [(r) => { r.states[0][2] = 12345.625; }, 'Crash brief observations differed between fresh replays'],
    [(r) => { r.pageInfo.gameEntry = 'other-private-local-path'; }, 'Crash brief observations differed between fresh replays'],
  ]) {
    const result = observation();
    mutate(result);
    expect(() => assertPrivateCrashBriefChecks(result, tape, observation(), 2)).toThrow(new Error(expected));
  }
});

test('report exports only fixed fields, known categories and an optional static fatal terrain hazard ID', () => {
  const report = crashBriefReport({ ...event, runId: 'private-run-identity', seed: 'private-seed', score: 9999 }, 2, 6);
  expect(report).toEqual({
    kind: 'local-replay-crash-brief', reportVersion: 1,
    scope: 'local unverified replay reproduction; not proof of the original crash',
    build: { sameBuildAsserted: true, independentlyVerified: false },
    replay: { freshRuns: 2, checkpointsCheckedPerRun: 6, matchedStateAndFatalEvent: true, savedRunsOrTapes: false },
    crash: { category: 'hazard', hazardId: 'glitchChasm' },
  });
  for (const hazardId of ['private-custom-id', 'ashCloud', 'shatterWall']) {
    expect(crashBriefReport({ ...event, hazardId }, 2, 6).crash).toEqual({ category: 'hazard' });
  }
  expect(crashBriefReport({ ...event, cause: 'terrain' }, 2, 6).crash).toEqual({ category: 'terrain' });
  expect(() => crashBriefReport({ ...event, cause: 'private-unsupported' }, 2, 6)).toThrow(new Error('Replay emitted an unsupported crash category'));
});

test('mode is explicit, strictly independent of airtime and emits nothing or leaks pass-through copy on failure', () => {
  const pin = 'a'.repeat(40), tool = 'tools/sim/benchmark-replay.mjs';
  const launch = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
  const crash = ['--crash-brief-build', pin];
  const tmp = mkdtempSync(join(tmpdir(), 'bb-replay-private-'));
  const local = join(tmp, 'private-tape.json');
  try {
    for (const [args, diagnostic] of [
      [[], 'explicit saved --tape'],
      [['--airtime-build', pin], 'not both'],
      [['--tape', local, '--ticks', '12345'], 'does not accept --ticks'],
      [['--tape', local, '--repeats', '1'], '2–5 fresh runs'],
      [['--tape', local, '--url', 'https://user-secret.invalid/'], 'HTTP loopback'],
      [['--tape', local], 'readable, bounded, complete compatible normal-run tape'],
      [['--private-user-payload'], 'failed before verification'],
    ]) {
      const result = launch(...crash, ...args);
      expect(result).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining(diagnostic) });
      expect(result.stderr).not.toMatch(/private-|user-secret|12345/);
      expect(result.stderr).not.toContain(pin);
    }
    writeFileSync(local, '{"seed":"private-user-payload"}');
    expect(launch(...crash, '--tape', local)).toMatchObject({ status: 1, stdout: '',
      stderr: 'Crash brief needs a readable, bounded, complete compatible normal-run tape\n' });
    expect(launch('--crash-brief-build', 'private-bad-build').stderr).toBe('Crash brief requires a full 40-hex Git build commit\n');
  } finally { rmSync(tmp, { force: true, recursive: true }); }
});
