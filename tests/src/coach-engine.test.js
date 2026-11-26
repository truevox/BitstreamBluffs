/** #66: EngineSimulator against the REAL RunScene (headless harness): crash data, fingerprints, divergence, slicing, refusal. */
import { jest } from '@jest/globals';
const H = await import('./takeoverHarness.js');
const { createEngineSimulator, CoachCancelled, DIVERGE_PX } = await import('../../src/systems/coach/EngineSimulator.js');
const { enumerateCandidates, applyCandidate } = await import('../../src/systems/coach/Perturb.js');
const { traceOf } = await import('../../src/systems/replay/Takeover.js');

jest.spyOn(Date, 'now').mockReturnValue(1_767_000_000_000);

const scripted = (t) => H.livePad({
  push: t < 400, variableHop: true, noAutoNudge: true,
  hop: t >= 300 && t <= 303, tuck: t > 500 && t < 540, tilt: t > 420 && t < 460 ? -1 : 0,
  pressed: { hop: t === 300 || t === 700 },
});
const REC = H.recordRun({ seed: 'A', padFor: scripted, fpEvery: 1 });
const TAPE = REC.tape;
const CRASH = TAPE.endTick + 1;
const BRANCH = CRASH - 360;
const ORIGINAL_CAUSE = REC.scene.registry.get(H.REG.LAST_CRASH).cause;

function makeHost({ onAcquire } = {}) {
  const host = { acquired: 0, frames: 0, released: 0,
    async acquire(tape) { host.acquired++; if (onAcquire) onAcquire(tape); return H.coachSceneFor(tape); },
    async frame() { host.frames++; },
    release() { host.released++; } };
  return host;
}
const OPTS = { untilTick: CRASH + 240, branchTick: BRANCH, crashTick: CRASH, referenceTape: TAPE };

describe('EngineSimulator on the real engine', () => {
  test('the original tape crashes at the recorded tick with the recorded cause; fingerprints equal the recording', async () => {
    const host = makeHost();
    const sim = createEngineSimulator({ host });
    const r = await sim(TAPE, OPTS);
    expect(r).toMatchObject({ survived: false, crashTick: CRASH, cause: ORIGINAL_CAUSE });
    expect(Object.keys(r.fingerprintAt).map(Number)).toEqual([BRANCH, CRASH]);
    expect(r.fingerprintAt[BRANCH]).toBe(REC.fps.get(BRANCH));
    expect(r.fingerprintAt[CRASH]).toBe(REC.fps.get(CRASH));
    expect(r.divergenceAt).toBeNull(); // the reference IS this tape: nothing diverges
    expect(host.released).toBe(1);
  });

  test('a run that reaches untilTick without a crash survived, and its final fingerprint is the recording at that tick', async () => {
    const sim = createEngineSimulator({ host: makeHost() });
    const r = await sim(TAPE, { ...OPTS, untilTick: BRANCH + 100, crashTick: CRASH });
    expect(r).toMatchObject({ survived: true, crashTick: null, cause: null, ticks: BRANCH + 100 });
    expect(r.fingerprintAt[BRANCH + 100]).toBe(REC.fps.get(BRANCH + 100));
  });

  test('a candidate diverges from the reference after the branch, and a fresh simulate of it repeats exactly', async () => {
    const list = enumerateCandidates(TAPE, { branchTick: BRANCH, crashTick: CRASH, budget: 80 });
    const shift = list.find((c) => c.kind === 'hop-shift') || list[0];
    const cand = applyCandidate(TAPE, shift);
    const sim = createEngineSimulator({ host: makeHost() });
    const a = await sim(cand, OPTS);
    const b = await sim(applyCandidate(TAPE, shift), OPTS);
    expect(a.fingerprintAt).toEqual(b.fingerprintAt);
    expect(a.survived).toBe(b.survived);
    expect(a.divergenceAt).toBe(b.divergenceAt);
    if (a.divergenceAt !== null) { expect(a.divergenceAt).toBeGreaterThanOrEqual(BRANCH); expect(a.divergenceAt % 4).toBe(0); }
    expect(a.fingerprintAt[CRASH] === REC.fps.get(CRASH) && !a.survived && a.crashTick === CRASH).toBe(false); // the edit changed the run
  });

  test('time slicing gives the page frames and the same answer as an unsliced run', async () => {
    const host = makeHost();
    let t = 0;
    const slicedSim = createEngineSimulator({ host, sliceMs: 5, sliceMaxTicks: 700 });
    const whole = await createEngineSimulator({ host: makeHost() })(TAPE, OPTS);
    const sliced = await slicedSim(TAPE, OPTS);
    expect(host.frames).toBeGreaterThan(3);
    expect(sliced.fingerprintAt).toEqual(whole.fingerprintAt);
    expect(sliced.crashTick).toBe(whole.crashTick);
    expect(t).toBe(0);
  });

  test('the pose trace is sampled every 4 ticks from the branch and matches the original trace where nothing diverged', async () => {
    const r = await createEngineSimulator({ host: makeHost() })(TAPE, OPTS);
    const { fromTick, every, xy } = r.poseTrace;
    expect(every).toBe(4);
    expect(fromTick % 4).toBe(0);
    expect(xy.length / 2).toBe(Math.floor(r.ticks / 4) - fromTick / 4 + 1);
    const ref = traceOf(TAPE);
    const i = (fromTick / 4 - 1) * 3;
    expect(Math.hypot(Math.fround(xy[0]) - ref[i], Math.fround(xy[1]) - ref[i + 1])).toBeLessThan(DIVERGE_PX);
  });

  test('cancellation rejects with CoachCancelled and never leaves a scene unreleased', async () => {
    const host = makeHost();
    let calls = 0;
    const sim = createEngineSimulator({ host, sliceMs: 1, sliceMaxTicks: 200, isCancelled: () => ++calls > 4 });
    await expect(sim(TAPE, OPTS)).rejects.toBeInstanceOf(CoachCancelled);
    expect(host.released).toBe(host.acquired);
    const already = createEngineSimulator({ host: makeHost(), isCancelled: () => true });
    await expect(already(TAPE, OPTS)).rejects.toBeInstanceOf(CoachCancelled);
  });

  test('NEGATIVE CONTROLS: a refused tape and a prefix that does not match the tape both reject (never a "survived")', async () => {
    const sim = createEngineSimulator({ host: makeHost() });
    await expect(sim({ ...TAPE, rulesetId: 'other' }, OPTS)).rejects.toThrow(/refused this tape \(ruleset-mismatch\)/);
    const bad = { ...TAPE, checkpoints: TAPE.checkpoints.map((c, i) => (i === 1 ? [c[0], c[1] + 1, ...c.slice(2)] : c)) };
    await expect(sim(bad, OPTS)).rejects.toThrow(/desync at tick 240 \(checkpoint\)/);
    await expect(sim(TAPE, { untilTick: 0 })).rejects.toThrow(TypeError);
  });

  test('requires a host', () => {
    expect(() => createEngineSimulator({})).toThrow(/host/);
  });
});
