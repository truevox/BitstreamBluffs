/**
 * Issue #130 (narrow slice) — aggregation tests.
 *
 * These pin the honesty rules the report depends on, and each one is written as the mistake it prevents:
 *
 *  - a censored run must never be counted as a crash OR as a survival (it is its own class);
 *  - a rate must never be printed as a bare point estimate without its interval and small-N flag;
 *  - pairing must be on the same seed, and a seed missing from either arm must be NAMED, not dropped;
 *  - a "boundary" must be an offset that was actually run, never interpolated;
 *  - the aggregate must carry an explicit no-extrapolation statement.
 */
import {
  OUTCOMES, PAIR_TOLERANCE, SMALL_N, aggregate, binOffsets, classifyOutcome, pairedAgainstControl,
  sensitiveBoundary, wilson,
} from '../../tools/sensitivity/lib/aggregate.mjs';

const row = (over = {}) => ({
  seed: 'sim-01', offset: 0, outcome: 'crash', crashCause: 'hazard', distanceM: 500, score: 1000,
  endReason: 'crash:hazard', desync: null, ...over,
});

describe('classifyOutcome', () => {
  test('a crash is a crash, whatever the cause', () => {
    expect(classifyOutcome({ endReason: 'crash:hazard', desync: null })).toBe('crash');
    expect(classifyOutcome({ endReason: 'crash:badLanding', desync: null })).toBe('crash');
  });

  test('reaching the distance cap is CENSORED, not a survival and not a crash', () => {
    expect(classifyOutcome({ endReason: 'maxM', desync: null })).toBe('censored');
    expect(classifyOutcome({ endReason: 'timeout', desync: null })).toBe('censored');
    expect(classifyOutcome({ endReason: 'replay-window', desync: null })).toBe('censored');
    expect(classifyOutcome({ endReason: 'replay-window', desync: { tick: 100 } })).toBe('censored');
    expect(classifyOutcome({ endReason: 'replay-window', desync: { tick: 100 } }, { integrityRequired: true })).toBe('excluded');
  });

  test('a stalled run is its own class', () => {
    expect(classifyOutcome({ endReason: 'stalled', desync: null })).toBe('stalled');
  });

  test('checkpoint divergence on a PERTURBED arm is a measurement, not an exclusion', () => {
    // The checkpoints belong to the unperturbed control run, so a shifted control MUST diverge from them.
    // Divergence is the evidence that the perturbation reached the simulation. Excluding these rows would
    // throw away exactly the runs that show sensitivity and report a falsely quiet result.
    expect(classifyOutcome({ endReason: 'crash:hazard', desync: { tick: 1680 } })).toBe('crash');
    expect(classifyOutcome({ endReason: 'maxM', desync: { tick: 40 } })).toBe('censored');
  });

  test('checkpoint divergence on the CONTROL arm is an integrity failure and is excluded', () => {
    // The control is the unshifted replay of the capture, so its own checkpoints must match. If they do not,
    // the harness is not reproducing the real run and nothing measured on it can be trusted.
    expect(classifyOutcome({ endReason: 'crash:hazard', desync: { tick: 12 } }, { integrityRequired: true })).toBe('excluded');
    expect(classifyOutcome({ endReason: 'crash:hazard', desync: null }, { integrityRequired: true })).toBe('crash');
  });

  test('every class returned is one of the declared outcomes', () => {
    for (const endReason of ['crash:x', 'maxM', 'timeout', 'replay-window', 'stalled', 'unknown']) {
      expect(OUTCOMES).toContain(classifyOutcome({ endReason, desync: null }));
    }
  });
});

describe('wilson', () => {
  test('a point estimate of 1.0 still carries a lower bound well below 1', () => {
    const [lo, hi] = wilson(12, 12);
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeGreaterThan(0.7);
    expect(lo).toBeLessThan(1);
  });

  test('zero successes still carries an upper bound above zero', () => {
    const [lo, hi] = wilson(0, 12);
    // The Wilson lower bound for zero successes is a floating-point epsilon, not an exact 0.
    expect(lo).toBeCloseTo(0, 12);
    expect(hi).toBeGreaterThan(0);
    expect(hi).toBeLessThan(1);
  });

  test('a larger sample narrows the interval', () => {
    const narrow = wilson(6, 120);
    const wide = wilson(1, 12);
    expect(narrow[1] - narrow[0]).toBeLessThan(wide[1] - wide[0]);
  });

  test('no observations means no interval, not a made-up one', () => {
    expect(wilson(0, 0)).toBeNull();
  });

  test('impossible counts are refused', () => {
    expect(() => wilson(5, 2)).toThrow();
    expect(() => wilson(-1, 2)).toThrow();
  });
});

describe('binOffsets', () => {
  test('censored rows stay in the denominator so the crash rate cannot be inflated', () => {
    const rows = [
      row({ seed: 'a', outcome: 'crash' }),
      row({ seed: 'b', outcome: 'censored', endReason: 'maxM' }),
    ];
    const [bin] = binOffsets(rows);
    expect(bin.observations).toBe(2);
    expect(bin.crashed).toBe(1);
    expect(bin.crashRate).toBe(0.5);
    expect(bin.censored).toBe(1);
  });

  test('excluded rows are reported beside the sample, never inside it', () => {
    const rows = [row({ seed: 'a', outcome: 'crash' }), row({ seed: 'b', outcome: 'excluded' })];
    const [bin] = binOffsets(rows);
    expect(bin.observations).toBe(1);
    expect(bin.excluded).toBe(1);
    expect(bin.crashRate).toBe(1);
  });

  test('a bin below the threshold is flagged small-sample and still reports an interval', () => {
    const rows = Array.from({ length: SMALL_N - 1 }, (_, i) => row({ seed: `s${i}`, outcome: 'crash' }));
    const [bin] = binOffsets(rows);
    expect(bin.smallSample).toBe(true);
    expect(bin.crashRateCi95).not.toBeNull();
  });

  test('bins are ordered by offset so a report reads left to right', () => {
    const rows = [row({ offset: 2 }), row({ offset: -2 }), row({ offset: 0 })];
    expect(binOffsets(rows).map((b) => b.offset)).toEqual([-2, 0, 2]);
  });
});

describe('pairedAgainstControl', () => {
  test('compares on the same seed and reports an unchanged pair as unchanged', () => {
    const rows = [row({ seed: 'a', offset: 0 }), row({ seed: 'a', offset: 1 })];
    const [cmp] = pairedAgainstControl(rows);
    expect(cmp.paired).toBe(1);
    expect(cmp.changed).toBe(0);
  });

  test('a different crash cause on the same seed is a change', () => {
    const rows = [row({ seed: 'a', offset: 0 }), row({ seed: 'a', offset: 1, crashCause: 'badLanding' })];
    expect(pairedAgainstControl(rows)[0].changed).toBe(1);
  });

  test('a different outcome class on the same seed is a change', () => {
    const rows = [row({ seed: 'a', offset: 0 }), row({ seed: 'a', offset: 1, outcome: 'censored', endReason: 'maxM' })];
    expect(pairedAgainstControl(rows)[0].changed).toBe(1);
  });

  test('a materially different distance is a change; one inside tolerance is not', () => {
    const near = [row({ seed: 'a', offset: 0 }), row({ seed: 'a', offset: 1, distanceM: 500 + PAIR_TOLERANCE.distanceM })];
    expect(pairedAgainstControl(near)[0].changed).toBe(0);
    const far = [row({ seed: 'a', offset: 0 }), row({ seed: 'a', offset: 1, distanceM: 501 })];
    expect(pairedAgainstControl(far)[0].changed).toBe(1);
  });

  test('a seed present in only one arm is NAMED, not silently dropped', () => {
    const rows = [row({ seed: 'a', offset: 0 }), row({ seed: 'b', offset: 0 }), row({ seed: 'a', offset: 1 })];
    const [cmp] = pairedAgainstControl(rows);
    expect(cmp.paired).toBe(1);
    expect(cmp.missingArm).toEqual(['b']);
    expect(cmp.missingControl).toEqual([]);
  });

  test('an arm with no control pairs nothing and says so instead of scoring zero', () => {
    const rows = [row({ seed: 'a', offset: 1 })];
    const [cmp] = pairedAgainstControl(rows);
    expect(cmp.paired).toBe(0);
    expect(cmp.changedRate).toBeNull();
    expect(cmp.missingControl).toEqual(['a']);
  });

  test('excluded rows do not enter a pair', () => {
    const rows = [row({ seed: 'a', offset: 0 }), row({ seed: 'a', offset: 1, outcome: 'excluded' })];
    const [cmp] = pairedAgainstControl(rows);
    expect(cmp.paired).toBe(0);
  });

  test('a small paired sample is flagged', () => {
    const rows = [row({ seed: 'a', offset: 0 }), row({ seed: 'a', offset: 1, crashCause: 'x' })];
    expect(pairedAgainstControl(rows)[0].smallSample).toBe(true);
  });
});

describe('sensitiveBoundary', () => {
  test('names the smallest offset at which every paired seed changed', () => {
    const rows = [
      row({ seed: 'a', offset: 0 }), row({ seed: 'b', offset: 0 }),
      row({ seed: 'a', offset: 1 }), row({ seed: 'b', offset: 1 }),
      row({ seed: 'a', offset: 2, crashCause: 'x' }), row({ seed: 'b', offset: 2, crashCause: 'x' }),
    ];
    const boundary = sensitiveBoundary(pairedAgainstControl(rows));
    expect(boundary.allSeedsChangedAtOffset).toBe(2);
    expect(boundary.anySeedChangedAtOffset).toBe(2);
  });

  test('with no change anywhere it reports null, not a guessed boundary', () => {
    const rows = [row({ seed: 'a', offset: 0 }), row({ seed: 'a', offset: 1 })];
    const boundary = sensitiveBoundary(pairedAgainstControl(rows));
    expect(boundary.allSeedsChangedAtOffset).toBeNull();
    expect(boundary.anySeedChangedAtOffset).toBeNull();
  });

  test('it always carries the not-a-game-boundary caveat', () => {
    expect(sensitiveBoundary([]).note).toMatch(/Not a boundary of the game/);
  });
});

describe('aggregate', () => {
  const rows = [
    row({ seed: 'a', offset: 0 }), row({ seed: 'b', offset: 0 }),
    row({ seed: 'a', offset: 1, crashCause: 'x' }), row({ seed: 'b', offset: 1 }),
    row({ seed: 'a', offset: 2, outcome: 'censored', endReason: 'maxM' }), row({ seed: 'b', offset: 2, crashCause: 'x' }),
  ];

  test('reports seeds, offsets and counts that match the rows it was given', () => {
    const agg = aggregate(rows);
    expect(agg.seeds).toEqual(['a', 'b']);
    expect(agg.offsets).toEqual([0, 1, 2]);
    expect(agg.observations).toBe(6);
    expect(agg.measured).toBe(6);
  });

  test('censoring is its own reported count with the window-ended caveat', () => {
    const agg = aggregate(rows);
    expect(agg.censoring.censored).toBe(1);
    expect(agg.censoring.note).toMatch(/did not survive/);
  });

  test('carries an explicit no-extrapolation statement naming what it does not claim', () => {
    const agg = aggregate(rows);
    expect(agg.noExtrapolation).toMatch(/No claim is made about other offsets/);
    expect(agg.noExtrapolation).toMatch(/unbounded survival/);
  });

  test('a custom threshold changes the small-sample flag', () => {
    const agg = aggregate(rows, { smallN: 1 });
    expect(agg.bins.every((b) => b.smallSample === false)).toBe(true);
    expect(agg.smallSampleThreshold).toBe(1);
  });

  test('the boundary is carried through from the paired comparison', () => {
    const agg = aggregate(rows);
    expect(agg.boundary).toHaveProperty('allSeedsChangedAtOffset');
    expect(agg.boundary.note).toMatch(/exact observation/i);
  });
});
