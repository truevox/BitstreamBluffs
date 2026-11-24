import { BUILD, PANEL, inspectCapture, parsePanelOptions, reportTrial } from '../../tools/sim/hands-off-panel.js';
import { GHOST_TAPE_FORMAT, GHOST_TAPE_VERSION, GHOST_PHYSICS_VERSION } from '../../src/systems/ghost/GhostTape.js';
import { RUN_RANDOM_VERSION } from '../../src/systems/RunRandom.js';
import { combineFingerprints } from '../../src/systems/replay/canonicalBinary.js';
import { FP_SUBSYSTEMS } from '../../src/systems/replay/fingerprintSchemas.js';

const seed = 'sim-18';
const hash = 'xxh32x2:aaaaaaaaaaaaaaaa';
function frames(ticks) {
  return Array.from({ length: Math.floor(ticks / PANEL.checkpointEvery) }, (_, i) => {
    const tick = PANEL.checkpointEvery * (i + 1);
    const subsystems = Object.fromEntries(FP_SUBSYSTEMS.map((key) => [key, hash]));
    return { tick, subsystems, combined: combineFingerprints(tick, subsystems, FP_SUBSYSTEMS) };
  });
}
function capture() {
  const ticks = 2595, fingerprints = frames(ticks - 1);
  return {
    seed, ticks, reachedTick: 2556, peakM: 509.2694463617302, fingerprintErrors: 0, fingerprints, inputs: [[1, 6, 0]],
    fatal: { tick: ticks, cause: 'hazard', hazardId: 'glitchChasm', x: 10234, y: 1950, speedPxS: 502, distanceM: 509.4995086662851 },
    tape: {
      format: GHOST_TAPE_FORMAT, physicsVersion: GHOST_PHYSICS_VERSION, version: GHOST_TAPE_VERSION, edgeRows: 'every-tick',
      runRandomVersion: RUN_RANDOM_VERSION, simTickHz: PANEL.tickHz, mode: 'normal', seed, biomeMask: PANEL.biomeMask,
      dailyRuleId: PANEL.dailyRuleId, startedAt: Date.parse(PANEL.calendarUtc), controlLayout: PANEL.controlLayout,
      boosts: [], upgradeRanks: null, magnetsDrop: false, kodiaksOn: false, kodiakPackMode: 'same', runId: 'private-id', score: 123456,
      trace: 'raw-trace-test-marker', inputs: [[1, 6, 0]], endTick: ticks - 1,
      checkpoints: fingerprints.map(({ tick }) => [tick, 1, 2, 3, 4, 5, 6, 7]),
    },
  };
}
function playback(original) {
  const { seed, ticks, reachedTick, peakM, fatal, fingerprintErrors } = original;
  return { seed, ticks, reachedTick, peakM, fatal: { ...fatal }, fingerprintErrors, fingerprints: frames(ticks - 1),
    checked: original.tape.checkpoints.length, desync: null, playbackSaved: false };
}

test('uses a bounded fixed stock panel and refuses other flags or nonloopback paths', () => {
  expect(new Set(PANEL.seeds).size).toBe(12);
  expect([PANEL.biomeMask, PANEL.tickHz, PANEL.limitTicks, PANEL.targetM]).toEqual([0, 120, 4200, 500]);
  expect(BUILD.modules[BUILD.entry]).toMatch(/^[a-f0-9]{64}$/);
  expect(parsePanelOptions([]).url.href).toBe('http://127.0.0.1:8293/');
  expect(parsePanelOptions(['--help'])).toEqual({ help: true });
  for (const args of [['--build', 'x'], ['--url'], ['--seeds', seed], ['--url', 'http://127.0.0.1:8399/private'],
    ['--url', 'http://localhost:8399/'], ['--url', 'https://127.0.0.1:8399/'],
    ['--url', 'http://127.0.0.1:65536/'], ['--url', 'http://127.0.0.1:8399/?secret=x']]) {
    expect(() => parsePanelOptions(args)).toThrow(/fixed panel|preview root/);
  }
});

test('replay verifies all native channels and reports a closed summary only', () => {
  const c = capture(), r = playback(c);
  const summary = reportTrial(seed, c, r);
  expect(summary).toEqual({ seed, status: 'verified-candidate', reached500mAtCompletedTick: 2556, peakCompletedMeters: 509.269,
    terminal: { tick: 2595, cause: 'hazard', hazardId: 'glitchChasm', distanceM: 509.5 },
    verification: { nativeExactCheckpoints: 21, fingerprintSubsystems: 13, nativeCadenceTicks: 120,
      sameNaturalTerminalAndThreshold: true, playbackSaved: false } });
  expect(JSON.stringify(summary)).not.toMatch(/xxh32x2|raw-trace|private-id|123456|10234|inputs|speedPxS/);
  expect(() => reportTrial(seed, c)).toThrow(/Playback missing/);
});

test('finished short excludes the fatal tick, even if the actual crash position was past 500m', () => {
  const c = capture();
  c.peakM = 499.99;
  c.reachedTick = null;
  expect(reportTrial(seed, c)).toMatchObject({ status: 'finished-short', verification: null, terminal: { distanceM: 509.5 } });
  c.peakM = 500;
  c.reachedTick = c.ticks;
  expect(() => inspectCapture(seed, c)).toThrow(/distance or tick interval/);
});

test('a capped trial is explicitly unverified no matter the distance', () => {
  const c = { ...capture(), ticks: 4200, peakM: 863.939, tape: null, fatal: null, fingerprints: frames(4200) };
  expect(reportTrial(seed, c)).toMatchObject({ status: 'capped-unverified', reached500mAtCompletedTick: 2556,
    terminal: { capTick: 4200 }, verification: null });
  expect(() => inspectCapture(seed, { ...c, ticks: 4199, fingerprints: frames(4199) })).toThrow(/Capped trial/);
  expect(() => reportTrial(seed, c, playback(capture()))).toThrow(/Unqualified trial/);
});

test.each([
  ['foreign seed', (c) => { c.tape.seed = 'sim-16'; }, /Native tape/],
  ['nonneutral row', (c) => { c.tape.inputs[0][1] = 7; }, /neutral controls/],
  ['missing first native row', (c) => { c.tape.checkpoints.shift(); }, /Incomplete native exact/],
  ['truncated exact row', (c) => { c.tape.checkpoints[0] = [120]; }, /Incomplete native exact/],
  ['wrong taped terminal', (c) => { c.tape.endTick++; }, /Native tape/],
  ['recorded error', (c) => { c.fingerprintErrors++; }, /Native fingerprint capture/],
  ['missing fingerprint channel', (c) => { delete c.fingerprints[1].subsystems.score; }, /Invalid native fingerprint/],
  ['incorrect combined hash', (c) => { c.fingerprints[2].combined = hash; }, /Invalid native fingerprint/],
])('fails closed for %s', (_, mutate, diagnostic) => {
  const c = capture();
  mutate(c);
  expect(() => inspectCapture(seed, c)).toThrow(diagnostic);
});

test.each([
  ['playback saves', (r) => { r.playbackSaved = true; }, /wrote data/],
  ['zero desync count is not null', (r) => { r.desync = 0; }, /desynced/],
  ['one fewer exact checkpoint', (r) => { r.checked--; }, /Playback missing/],
  ['one missing fingerprint row', (r) => { r.fingerprints.pop(); }, /Incomplete native fingerprint/],
  ['different valid subsystem', (r) => {
    const row = r.fingerprints[3];
    row.subsystems.terrain = 'xxh32x2:bbbbbbbbbbbbbbbb';
    row.combined = combineFingerprints(row.tick, row.subsystems, FP_SUBSYSTEMS);
  }, /Playback native fingerprints differ/],
  ['position changes at the same terminal tick', (r) => { r.fatal.x++; }, /terminal or completed-tick distance differs/],
  ['threshold timing changes', (r) => { r.reachedTick--; }, /terminal or completed-tick distance differs/],
])('rejects a candidate when %s', (_, mutate, diagnostic) => {
  const c = capture(), r = playback(c);
  mutate(r);
  expect(() => reportTrial(seed, c, r)).toThrow(diagnostic);
});
