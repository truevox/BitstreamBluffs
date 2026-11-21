// compareRuns (spec 6.6 steps 1-5) against a deterministic synthetic simulator: first-divergent-tick localization and
// field-level diff, without any Phaser or game code.
import { FP_SUBSYSTEMS, compareRuns, fingerprintState } from '../../src/systems/replay/fingerprint.js';
import { referenceState, clone } from './fingerprintReference.js';

const ulpUp = (x) => { const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, x); dv.setBigUint64(0, dv.getBigUint64(0) + 1n); return dv.getFloat64(0); };

/**
 * Pure function of (tick, mutation): the "simulation". A mutation `{tick, apply}` changes the state from that tick on, the
 * way a real divergence would (it persists and keeps evolving).
 */
function stateAt(t, mutation) {
  const s = clone(referenceState());
  s.tick = t;
  s.clock = { tick: t, runTimeMs: t * (1000 / 120), crashed: false };
  s.sled.body.x = 100 + 7.5 * t;
  s.matter.timestamp = t * (1000 / 120);
  s.bsod.wallX = -7587.5 + 0.95833 * t;
  s.kodiak.bears[0].x = 2000 + 150 * t / 120;
  s.score.mgr.distanceM = t * 0.1;
  if (mutation && t >= mutation.tick) mutation.apply(s, t - mutation.tick);
  return s;
}

function trace(endTick, mutation, { full = true, counters = { resims: 0, dumps: 0 }, causalDigest = 'sha256:aa', resim = true, dump = true } = {}) {
  const checkpoints = [];
  for (let t = 120; t <= endTick; t += 120) {
    const f = fingerprintState(stateAt(t, mutation));
    checkpoints.push(full ? { tick: t, combined: f.combined, subsystems: f.subsystems } : { tick: t, combined: f.combined });
  }
  const run = { causalDigest, checkpoints };
  if (resim) {
    run.resimulate = ({ fromTick, toTick }) => {
      counters.resims++;
      const out = [];
      for (let t = fromTick + 1; t <= toTick; t++) out.push(fingerprintState(stateAt(t, mutation)));
      return Promise.resolve(out);
    };
  }
  if (dump) run.dumpAt = (t) => { counters.dumps++; return Promise.resolve(stateAt(t, mutation)); };
  return run;
}

const bsodWall = { tick: 337, apply: (s) => { s.bsod.wallX = ulpUp(s.bsod.wallX); } };
const kodiakOnly = { tick: 481, apply: (s) => { s.kodiak.bears[0].phaseMs += 1; s.kodiak.bears[0].phase = 'lunge'; } };

describe('compareRuns', () => {
  test('identical runs match; deterministic replays share every checkpoint hash', async () => {
    const a = trace(720, null);
    const b = trace(720, null);
    expect(a.checkpoints.map((c) => c.combined)).toEqual(b.checkpoints.map((c) => c.combined));
    const r = await compareRuns(a, b);
    expect(r.status).toBe('match');
    expect(r.resims).toBe(0);
    expect(r.matchingSubsystems).toEqual([...FP_SUBSYSTEMS]);
  });

  test('BSOD-only 1-ulp divergence: first divergent tick, checkpoint, subsystem and field are localized', async () => {
    const counters = { resims: 0, dumps: 0 };
    const r = await compareRuns(trace(720, null), trace(720, bsodWall, { counters }));
    expect(r).toMatchObject({
      status: 'diverged', firstDivergentTick: 337, firstDivergentCheckpoint: 360, subsystem: 'bsod', fieldPath: 'bsod.wallX',
      differingSubsystems: ['bsod'], resims: 2,
    });
    expect(r.matchingSubsystems).toEqual(FP_SUBSYSTEMS.filter((n) => n !== 'bsod'));
    expect(r.expected).not.toBe(r.actual);
    expect(r.expected).toMatch(/^f64:[0-9a-f]{16}$/);
    expect(r.differingPaths).toEqual(['bsod.wallX']);
    expect(counters.resims).toBe(1); // one re-sim per side, only the window (240, 360] is simulated for b
  });

  test('re-simulation window is exactly (previous matching checkpoint, divergent checkpoint]', async () => {
    const windows = [];
    const a = trace(720, null);
    const b = trace(720, bsodWall);
    const orig = b.resimulate;
    b.resimulate = (w) => { windows.push(w); return orig(w); };
    await compareRuns(a, b);
    expect(windows).toEqual([{ fromTick: 240, toTick: 360 }]);
  });

  test('a divergence at the very first checkpoint window starts from tick 0', async () => {
    const early = { tick: 5, apply: (s) => { s.score.mgr.distanceM += 1; } };
    const windows = [];
    const b = trace(240, early);
    const orig = b.resimulate;
    b.resimulate = (w) => { windows.push(w); return orig(w); };
    const r = await compareRuns(trace(240, null), b);
    expect(windows).toEqual([{ fromTick: 0, toTick: 120 }]);
    expect(r).toMatchObject({ firstDivergentTick: 5, subsystem: 'score', fieldPath: 'score.mgr.distanceM' });
  });

  test('Kodiak-only mutation (the motivating case) is attributed to kodiak, not to the sled', async () => {
    const r = await compareRuns(trace(720, null), trace(720, kodiakOnly));
    expect(r.status).toBe('diverged');
    expect(r.differingSubsystems).toEqual(['kodiak']);
    expect(r.firstDivergentTick).toBe(481);
    expect(r.firstDivergentCheckpoint).toBe(600);
    expect(r.fieldPath).toBe('kodiak.bears[0].phase'); // schema order: phase precedes phaseMs
    expect(r.differingPaths).toEqual(['kodiak.bears[0].phase', 'kodiak.bears[0].phaseMs']);
    expect([r.expected, r.actual]).toEqual(['tele', 'lunge']);
  });

  test('stored full detail names the subsystem even without re-simulation (inconclusive on the tick)', async () => {
    const r = await compareRuns(trace(720, null, { resim: false, dump: false }), trace(720, kodiakOnly, { resim: false, dump: false }));
    expect(r).toMatchObject({ status: 'inconclusive', note: 'no-resimulate', firstDivergentCheckpoint: 600, differingSubsystems: ['kodiak'] });
    const noDetail = await compareRuns(trace(720, null, { full: false, resim: false }), trace(720, kodiakOnly, { full: false, resim: false }));
    expect(noDetail.differingSubsystems).toEqual([]);
  });

  test('combined-only checkpoints are attributed by re-simulation', async () => {
    const r = await compareRuns(trace(720, null, { full: false }), trace(720, bsodWall, { full: false }));
    expect(r).toMatchObject({ status: 'diverged', subsystem: 'bsod', firstDivergentTick: 337, differingSubsystems: ['bsod'] });
  });

  test('a list-length difference is reported at its .length path', async () => {
    const grow = { tick: 200, apply: (s) => { s.kodiak.bears.push({ ...s.kodiak.bears[0], n: 1 }); } };
    const r = await compareRuns(trace(360, null), trace(360, grow));
    expect(r).toMatchObject({ firstDivergentTick: 200, subsystem: 'kodiak', fieldPath: 'kodiak.bears.length', expected: 1, actual: 2 });
  });

  test('refuses on differing causal digests unless ignoreCausal', async () => {
    const a = trace(360, null);
    const b = trace(360, null, { causalDigest: 'sha256:bb' });
    expect(await compareRuns(a, b)).toMatchObject({ status: 'inconclusive', note: 'causal-mismatch', resims: 0 });
    expect((await compareRuns(a, b, { ignoreCausal: true })).status).toBe('match');
  });

  test('different checkpoint counts and ticks are reported, not matched', async () => {
    expect(await compareRuns(trace(360, null), trace(480, null))).toMatchObject({ status: 'diverged', firstDivergentCheckpoint: 480, note: 'checkpoint-count-mismatch' });
    const a = trace(360, null);
    const b = trace(360, null);
    b.checkpoints[1] = { ...b.checkpoints[1], tick: 241 };
    expect(await compareRuns(a, b)).toMatchObject({ status: 'diverged', note: 'checkpoint-tick-mismatch' });
  });

  test('stored checkpoints that disagree while both re-simulations agree are inconclusive (nondeterminism or build skew)', async () => {
    const a = trace(360, null);
    const b = trace(360, null);
    b.checkpoints[1] = { ...b.checkpoints[1], combined: 'xxh32x2:0000000000000000' };
    expect(await compareRuns(a, b)).toMatchObject({ status: 'inconclusive', note: 'divergence-not-reproduced', firstDivergentCheckpoint: 240, resims: 2 });
  });

  test('a bad resimulation window is inconclusive, never a wrong answer', async () => {
    const a = trace(360, null);
    const b = trace(360, bsodWall);
    b.resimulate = async () => [];
    expect(await compareRuns(a, b)).toMatchObject({ status: 'inconclusive', note: 'bad-resimulation-window' });
  });

  test('is symmetric in what it finds; expected is a, actual is b', async () => {
    const r1 = await compareRuns(trace(720, null), trace(720, bsodWall));
    const r2 = await compareRuns(trace(720, bsodWall), trace(720, null));
    expect(r2.firstDivergentTick).toBe(r1.firstDivergentTick);
    expect(r2.expected).toBe(r1.actual);
    expect(r2.actual).toBe(r1.expected);
  });
});

