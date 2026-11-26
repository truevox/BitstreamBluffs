import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { runCoach } from '../../src/systems/coach/CrashCoach.js';
import { butterflyBars, butterflyData } from '../../src/systems/coach/Butterfly.js';
import { enumerateCandidates } from '../../src/systems/coach/Perturb.js';
import { BANNED, fakeSimulator, standardTape } from './coachFixtures.js';

const tape = standardTape();
const lastCrash = { cause: 'hazard', hazardId: 'packetSpike', name: 'PACKET SPIKE', verdict: 'HOP WAS 0.21 S LATE', distM: 301 };
const base = { tape, crashTick: 1000, lastCrash, budget: 5000 };
const total = enumerateCandidates(tape, { branchTick: 640, crashTick: 1000, maxShift: 12, budget: Infinity }).length;
const run = (sim, extra = {}) => runCoach({ ...base, simulate: sim.simulate, ...extra });

describe('runCoach', () => {
  it('finds exactly the survivors a fake simulator allows, validated, in candidate order', async () => {
    const sim = fakeSimulator({ winLo: 842, winHi: 846 });
    const out = await run(sim);
    expect(out.survivors.map((s) => s.id)).toEqual(['hop-shift:850:-4', 'hop-shift:850:-5', 'hop-shift:850:-6', 'hop-shift:850:-7', 'hop-shift:850:-8']);
    expect(out.survivors.every((s) => s.validated === true)).toBe(true);
    expect(out.searched).toBe(total);
    expect(out.unstable).toBe(0);
    expect(out.budgetExhausted).toBe(false);
    expect(out.summary).toBe(`Searched ${total} nearby input variations; 5 survived.`);
    expect(out.cause.cause).toBe('hazard');
    expect(out.cause.claims.length).toBeGreaterThan(2);
    // every simulate call asks for crashTick + the 2 s margin
    expect(sim.calls.every((c) => c.untilTick === 1240)).toBe(true);
  });
  it('is deterministic: same inputs, identical result', async () => {
    const a = await run(fakeSimulator({ winLo: 842, winHi: 846 }));
    const b = await run(fakeSimulator({ winLo: 842, winHi: 846 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('says honestly when nothing survived, with the exact wording', async () => {
    const out = await run(fakeSimulator({ winLo: 9000, winHi: 9001 }));
    expect(out.survivors).toEqual([]);
    expect(out.summary).toBe(`Searched ${total} nearby input variations; none survived. This search is not exhaustive.`);
    expect(out.sensitivity.summary).toMatch(/No shift of up to 12 ticks/);
  });
  it('NEGATIVE CONTROL: a survivor that crashes on re-validation is never reported and counts as unstable', async () => {
    const sim = fakeSimulator({ winLo: 842, winHi: 846, flaky: 'outcome' });
    const out = await run(sim);
    expect(out.survivors).toEqual([]);
    expect(out.unstable).toBe(5);
    expect(out.sensitivity.points.filter((p) => p.outcome === 'unstable')).toHaveLength(5);
    expect(out.summary).toContain('none survived');
    expect(out.summary).toContain('5 were dropped');
  });
  it('NEGATIVE CONTROL: same outcome but a different final fingerprint is also dropped', async () => {
    const out = await run(fakeSimulator({ winLo: 842, winHi: 846, flaky: 'fingerprint' }));
    expect(out.survivors).toEqual([]);
    expect(out.unstable).toBe(5);
  });
  it('re-validates survivors with a FRESH tape object and simulate call', async () => {
    const sim = fakeSimulator({ winLo: 842, winHi: 846 });
    await run(sim);
    const second = sim.calls.filter((c) => c.n === 2);
    expect(second).toHaveLength(5);
    const first = sim.calls.filter((c) => c.n === 1);
    expect(first).toHaveLength(total);
    for (const c of second) {
      const twin = first.find((f) => JSON.stringify(f.tape.inputs) === JSON.stringify(c.tape.inputs));
      expect(twin.tape).not.toBe(c.tape);
    }
  });
  it('a survivor with no fingerprints cannot be validated and is dropped', async () => {
    const simulate = async (t, { untilTick }) => ({ survived: true, crashTick: null, cause: null, fingerprintAt: {}, divergenceAt: null });
    const out = await runCoach({ ...base, simulate, budget: 3 });
    expect(out.survivors).toEqual([]);
    expect(out.unstable).toBe(3);
  });
  it('a result that says survived but also reports a crash inside the margin is not a survivor', async () => {
    const simulate = async (t, { untilTick }) => ({ survived: true, crashTick: 1100, cause: 'hazard', fingerprintAt: { [untilTick]: 'x' } });
    const out = await runCoach({ ...base, simulate, budget: 3 });
    expect(out.survivors).toEqual([]);
    expect(out.unstable).toBe(0);
  });
  it('respects the count budget and says the search was cut', async () => {
    const sim = fakeSimulator({ winLo: 9000, winHi: 9001 });
    const out = await run(sim, { budget: 10 });
    expect(out.searched).toBe(10);
    expect(sim.calls).toHaveLength(10);
    expect(out.budgetExhausted).toBe(true);
    expect(out.summary).toContain('Search stopped at its budget.');
    const exact = await run(fakeSimulator({ winLo: 9000, winHi: 9001 }), { budget: total });
    expect(exact.budgetExhausted).toBe(false);
  });
  it('respects the time budget through the injected clock (no real clock is read)', async () => {
    let t = 0;
    const now = () => { t += 10; return t; }; // 10, 20, 30, ...
    const sim = fakeSimulator({ winLo: 9000, winHi: 9001 });
    const out = await run(sim, { timeBudgetMs: 35, now });
    // t0 = 10; checks read 20, 30, 40 -> third check (30 ms elapsed) passes, fourth (40 ms) stops: 3 candidates
    expect(out.searched).toBe(3);
    expect(out.budgetExhausted).toBe(true);
  });
  it('a simulate that throws is counted as an error and never as a survivor', async () => {
    const boom = async () => { throw new Error('boom'); };
    const out = await runCoach({ ...base, simulate: boom, budget: 4 });
    expect(out.survivors).toEqual([]);
    expect(out.errors).toBe(4);
    expect(out.summary).toContain('4 could not be simulated');
  });
  it('an unsupported tape searches nothing, says why, and never calls simulate', async () => {
    const sim = fakeSimulator({ winLo: 842, winHi: 846 });
    const out = await run(sim, { tape: { ...tape, edgeRows: undefined } });
    expect(out.searched).toBe(0);
    expect(sim.calls).toHaveLength(0);
    expect(out.unsupported).toMatch(/edge rows/);
    expect(out.summary).toMatch(/^Searched 0 nearby input variations; none survived\. This search is not exhaustive\./);
  });
  it('honours branchBackTicks and the survival margin', async () => {
    const sim = fakeSimulator({ winLo: 842, winHi: 846 });
    const out = await run(sim, { branchBackTicks: 200, marginTicks: 60 });
    expect(out.branchTick).toBe(800);
    expect(out.untilTick).toBe(1060);
    expect(sim.calls.every((c) => c.untilTick === 1060)).toBe(true);
  });
  it('requires an injected simulate', async () => {
    await expect(runCoach({ tape, crashTick: 1000, lastCrash })).rejects.toThrow(/simulate/);
  });
  it('never mutates the tape or the crash report', async () => {
    const snap = JSON.stringify([tape, lastCrash]);
    await run(fakeSimulator({ winLo: 842, winHi: 846 }));
    expect(JSON.stringify([tape, lastCrash])).toBe(snap);
  });
  it('no banned wording in any output (survivors, none, flaky, budget cut) nor in the coach sources', async () => {
    const outs = [
      await run(fakeSimulator({ winLo: 842, winHi: 846 })),
      await run(fakeSimulator({ winLo: 9000, winHi: 9001 })),
      await run(fakeSimulator({ winLo: 842, winHi: 846, flaky: 'outcome' })),
      await run(fakeSimulator({ winLo: 9000, winHi: 9001 }), { budget: 5 }),
    ];
    for (const o of outs) expect(JSON.stringify({ ...o, survivors: o.survivors.map((s) => ({ ...s, tape: undefined })) })).not.toMatch(BANNED);
    for (const f of ['CrashCoach', 'CrashCause', 'Perturb', 'Butterfly']) {
      expect(readFileSync(new URL(`../../src/systems/coach/${f}.js`, import.meta.url), 'utf8')).not.toMatch(BANNED);
    }
  });
});

describe('runCoach: wiring options for the real engine', () => {
  it('passes the branch, crash and reference tape to simulate', async () => {
    const seen = [];
    const simulate = async (t, o) => { seen.push(o); return { survived: false, crashTick: 1000, fingerprintAt: {} }; };
    await runCoach({ ...base, simulate, budget: 2 });
    expect(seen[0]).toEqual({ untilTick: 1240, branchTick: 640, crashTick: 1000, referenceTape: tape });
  });
  it('reports progress after every candidate, with a running tally', async () => {
    const sim = fakeSimulator({ winLo: 842, winHi: 846 });
    const ticks = [];
    await run(sim, { budget: 30, onProgress: (p) => ticks.push(p) });
    expect(ticks).toHaveLength(30);
    expect(ticks[0]).toMatchObject({ searched: 1, planned: 30, survivors: 0, unstable: 0 });
    expect(ticks.at(-1).searched).toBe(30);
    expect(ticks.at(-1).survivors).toBeGreaterThan(0);
    expect(typeof ticks[0].label).toBe('string');
  });
  it('shouldStop ends the search at the next candidate and says so', async () => {
    const sim = fakeSimulator({ winLo: 9000, winHi: 9001 });
    let n = 0;
    const out = await run(sim, { shouldStop: () => n++ >= 3 });
    expect(out.searched).toBe(3);
    expect(out.cancelled).toBe(true);
    expect(out.summary).toContain('Search was cancelled.');
  });
  it('a CoachCancelled thrown by simulate cancels instead of counting an error', async () => {
    let n = 0;
    const simulate = async () => { if (++n > 2) { const e = new Error('x'); e.name = 'CoachCancelled'; throw e; } return { survived: false, crashTick: 1000, fingerprintAt: {} }; };
    const out = await runCoach({ ...base, simulate });
    expect(out.cancelled).toBe(true);
    expect(out.errors).toBe(0);
    expect(out.searched).toBe(2);
  });
  it('states how long the search took when it has a clock', async () => {
    let t = 0;
    const now = () => { t += 1000; return t; };
    const none = await run(fakeSimulator({ winLo: 9000, winHi: 9001 }), { budget: 3, now });
    expect(none.elapsedMs).toBeGreaterThan(0);
    expect(none.summary).toMatch(/^Searched 3 nearby input variations in \d+(\.\d)? s; none survived\. This search is not exhaustive\./);
    const some = await run(fakeSimulator({ winLo: 842, winHi: 846 }), { now: () => 0 });
    expect(some.summary).toMatch(/^Searched \d+ nearby input variations; 5 survived\.$/);
    expect(some.elapsedMs).toBe(0);
  });
  it('keeps the survivor pose trace from its validating run', async () => {
    const base0 = fakeSimulator({ winLo: 842, winHi: 846 });
    const simulate = async (t, o) => ({ ...(await base0.simulate(t, o)), poseTrace: { fromTick: 640, every: 4, xy: [1, 2] } });
    const out = await runCoach({ ...base, simulate });
    expect(out.survivors[0].poseTrace).toEqual({ fromTick: 640, every: 4, xy: [1, 2] });
  });
});

describe('butterflyData', () => {
  const r = (kind, offsetTicks, outcome, label = 'hop 2 ticks earlier', divergenceAt = null) => ({ id: `${kind}:${offsetTicks}`, kind, label, offsetTicks, outcome, divergenceAt });
  it('names the smallest shift that changed the outcome', () => {
    const d = butterflyData([r('hop-shift', -6, 'survived', 'hop 6 ticks earlier'), r('hop-shift', -2, 'survived'), r('hop-shift', 3, 'crashed')]);
    expect(d.summary).toBe('Very sensitive: shifting your hop by 2 ticks changed the outcome');
    expect(d.changedAtTicks).toBe(2);
  });
  it('tiers by size, and ignores unstable and error candidates', () => {
    expect(butterflyData([r('hop-shift', 5, 'survived', 'hop 5 ticks later')]).summary).toBe('Sensitive: shifting your hop by 5 ticks changed the outcome');
    expect(butterflyData([r('hop-shift', 10, 'survived', 'hop 10 ticks later')]).summary).toMatch(/^Somewhat sensitive/);
    expect(butterflyData([r('hop-shift', 1, 'unstable', 'hop 1 tick later'), r('hop-shift', 2, 'error')]).summary).toMatch(/^No shift of up to 2 ticks/);
    expect(butterflyData([r('edge-shift', -1, 'survived', 'tuck press 1 tick earlier')]).summary).toBe('Very sensitive: shifting your tuck press by 1 tick changed the outcome');
  });
  it('falls back honestly for non-shift survivors and empty input', () => {
    expect(butterflyData([r('hop-drop', null, 'survived', 'no hop 150 ticks before the crash')]).summary).toMatch(/^Sensitive: trying "no hop/);
    expect(butterflyData([r('hop-drop', null, 'crashed', 'x')]).summary).toBe('No searched variation changed the outcome');
    expect(butterflyData([]).summary).toBe('No variations were searched');
    expect(butterflyData(null).points).toEqual([]);
  });
  it('points carry {offsetTicks, kind, outcome, divergence} with divergence in ticks after the branch', () => {
    const d = butterflyData([r('hop-shift', -2, 'survived', 'hop 2 ticks earlier', 850)], { branchTick: 640 });
    expect(d.points[0]).toMatchObject({ offsetTicks: -2, kind: 'hop-shift', outcome: 'survived', divergence: 210 });
    expect(butterflyData([r('hop-shift', -2, 'crashed')]).points[0].divergence).toBeNull();
  });
  it('butterflyBars orders by offset and maps outcome to colour and height', () => {
    const bars = butterflyBars(butterflyData([r('hop-shift', 3, 'crashed'), r('hop-shift', -3, 'survived'), r('hop-shift', 0, 'unstable'), r('hop-drop', null, 'crashed')]), { maxHeight: 40 });
    expect(bars.map((b) => b.x)).toEqual([-3, 0, 3, null]);
    expect(bars[0]).toMatchObject({ outcome: 'survived', height: 40 });
    expect(bars[0].color).not.toBe(bars[2].color);
    expect(bars[2].height).toBeLessThan(bars[1].height);
    expect(bars[1].height).toBeLessThan(bars[0].height);
  });
});
