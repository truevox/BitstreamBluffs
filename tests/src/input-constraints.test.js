import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GhostRecorder } from '../../src/systems/ghost/GhostTape.js';
import { runRandomState, runRandomStreams } from '../../src/systems/RunRandom.js';
import { MAX_AIRTIME_FILE_BYTES } from '../../tools/sim/replay-airtime.js';
import { evaluateInputConstraints, hopEdgeBudget } from '../../tools/sim/input-constraints.js';

function codecFixture(changes = []) {
  const seed = 'private-synthetic-fixture', startedAt = Date.UTC(2026, 0, 5, 12);
  const body = { position: { x: 2, y: 3 }, angle: 0, velocity: { x: 2, y: 1 }, angularVelocity: 0 };
  const recorder = new GhostRecorder({
    seed, biomeMask: 0, mode: 'normal', startedAt, dailyRuleId: 'featherweight', controlLayout: 'tricksRight',
    boosts: [], upgradeRanks: null, magnetsDrop: false, kodiaksOn: false, kodiakPackMode: 'same', kodiakVersion: 2,
    startPose: [2, 3, 0, 2, 1, 0], random: runRandomState(runRandomStreams(seed)),
  });
  const scene = { sled: { body }, score: { getTotal: () => 1 } };
  for (let tick = 1; tick <= 245; tick++) recorder.afterTick(tick, scene);
  for (const [tick, pad] of [[1, {}], ...changes]) recorder.input(tick, { variableHop: true, noAutoNudge: true, ...pad });
  return recorder.finish({ runId: `${startedAt}-${seed}`, distanceM: 12, score: 12, endedAt: startedAt + 2050 });
}
const results = (x) => x.candidates.map(({ met }) => met);

test('neutral layout configuration is not an action and produces three versioned candidate manifests', () => {
  const tape = codecFixture();
  expect(tape.inputs).toEqual([[1, 6, 0]]);
  const audit = evaluateInputConstraints(tape);
  expect(audit).toEqual({ observed: {
    hop: { heldTicks: 0, pressEdges: 0, requestedTicks: 0 }, parachute: { heldTicks: 0, pressEdges: 0, requestedTicks: 0 },
  }, candidates: [
    { id: 'no-hop-request', version: 1, input: 'hop', metric: 'requestedTicks', max: 0, met: true },
    { id: 'no-parachute-request', version: 1, input: 'parachute', metric: 'requestedTicks', max: 0, met: true },
    { id: 'hop-edge-budget', version: 1, input: 'hop', metric: 'pressEdges', max: 2, met: true },
  ] });
  expect(JSON.stringify(audit)).not.toContain(tape.seed);
});

test('a sparse hold persists, one-shot is counted once, and terminal-only requests are audited', () => {
  const tape = codecFixture([[10, { hop: true, pressed: { hop: true } }], [20, { hop: true, tilt: .5 }], [28, {}],
    [245, { pressed: { hop: true } }], [246, { pressed: { parachute: true } }]]);
  const audit = evaluateInputConstraints(tape);
  expect(audit.observed).toEqual({ hop: { heldTicks: 18, pressEdges: 2, requestedTicks: 19 },
    parachute: { heldTicks: 0, pressEdges: 1, requestedTicks: 1 } });
  expect(results(audit)).toEqual([false, false, true]);
  expect(results(evaluateInputConstraints(tape, 1))).toEqual([false, false, false]);
});

test('held-only controls are requests but not presses, including a held action through the fatal tick', () => {
  const tape = codecFixture([[243, { hop: true, parachute: true }]]);
  const audit = evaluateInputConstraints(tape, 0);
  expect(audit.observed.hop).toEqual({ heldTicks: 4, pressEdges: 0, requestedTicks: 4 });
  expect(audit.observed.parachute).toEqual(audit.observed.hop);
  expect(results(audit)).toEqual([false, false, true]);
});

test('three explicit edges exceed two, even across adjacent changed rows without a held bit', () => {
  const tape = codecFixture([[4, { tilt: .5, pressed: { hop: true } }], [5, { tilt: -.5, pressed: { hop: true } }],
    [246, { pressed: { hop: true } }]]);
  const audit = evaluateInputConstraints(tape, 2);
  expect(audit.observed.hop).toEqual({ heldTicks: 0, pressEdges: 3, requestedTicks: 3 });
  expect(results(audit)).toEqual([false, true, false]);
  expect(results(evaluateInputConstraints(tape, 3))).toEqual([false, true, true]);
});

test('input after the reproduced fatal boundary is outside the supported tape subset', () => {
  expect(() => evaluateInputConstraints(codecFixture([[247, { pressed: { hop: true } }]]))).toThrow(/invalid saved input/i);
});

test('budget is an explicit bounded base-ten integer only', () => {
  expect(['0', '1', '120', undefined].map(hopEdgeBudget)).toEqual([0, 1, 120, 2]);
  for (const invalid of ['-0', ' 2', '02', '2e0', '2.0', '0x02', '121', '', null]) {
    expect(() => hopEdgeBudget(invalid)).toThrow(/0 to 120/);
  }
});

test('CLI rejects unverified or malformed requests without receipt or private arguments', () => {
  const tool = 'tools/sim/verify-input-constraints.mjs', pin = 'a'.repeat(40);
  const launch = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
  const scratch = mkdtempSync(join(tmpdir(), 'bb-constraint-private-'));
  const path = join(scratch, 'private.json');
  try {
    const base = ['--build', pin, '--tape', path];
    for (const [args, expected] of [
      [[], 'explicit saved --tape'],
      [['--build', 'user-private-build', '--tape', path], 'full 40-hex'],
      [[...base, '--url', 'https://private.example/'], 'HTTP loopback'],
      [[...base, '--max-hop-edges=private-invalid'], '0 to 120'],
      [[...base, '--user-private-arg'], 'accepted options'],
      [base, 'bounded, complete compatible normal-run tape'],
    ]) {
      const result = launch(...args);
      expect(result).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining(expected) });
      expect(result.stderr).not.toMatch(/private|aaaaaa/);
    }
    writeFileSync(path, JSON.stringify({ ...codecFixture(), checkpoints: [[120]] }));
    expect(launch(...base)).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('compatible normal-run tape') });
    writeFileSync(path, Buffer.alloc(MAX_AIRTIME_FILE_BYTES + 1));
    expect(launch(...base)).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('bounded') });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
