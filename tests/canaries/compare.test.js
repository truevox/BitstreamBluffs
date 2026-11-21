/**
 * Issue #117 feel-diff comparator unit tests (TEST INFRASTRUCTURE ONLY).
 *
 * Pure, no browser and no network. They require the real comparator the differ uses
 * (tools/canaries/lib/compare.cjs) rather than a copy, so a change to the comparison rules is exercised
 * here. Synthetic records are small hand-written fixtures; the shape matches what
 * tools/canaries/run-canaries.mjs writes.
 */
'use strict';

const compare = require('../../tools/canaries/lib/compare.cjs');

const { STATUS } = compare;

/** Build a minimal but realistic record. checkpoint x/y/angle/vx/vy/score advance deterministically. */
function makeRecord(overrides = {}) {
  const {
    id = 'fixture',
    crashTick = null,
    cause = null,
    hazardId = null,
    score = 100,
    distance = 40,
    endTick = 120,
    ticks = 120,
    airborneTicks = 30,
    inputChanges = 3,
    simVersion = { simTickHz: 120, runRandomVersion: 1, ghostTapeFormat: 'bb-ghost-tape', ghostTapeVersion: 1, ghostPhysicsVersion: 1 },
    checkpoints = [
      [0, 0, 0, 0, 10, 0, 0],
      [1000, 100, 10, 0.1, 10, 1, 40],
      [2000, 210, 22, 0.2, 10, 2, 100],
    ],
  } = overrides;

  const crashed = crashTick != null;
  return {
    id,
    seed: 'FIXTURE',
    biomeMask: 0,
    hz: 60,
    simVersion,
    checkpoints,
    result: { crashed, crashTick, cause, hazardId, score, distance, endTick },
    stats: {
      timeToFirstInputMs: 8.333,
      inputChanges,
      airborneTicks,
      ticks,
      totalSimMs: (ticks * 1000) / 120,
      scoreMean: 46.666666666666664,
      scoreMin: 0,
      scoreMax: score,
    },
  };
}

function expectedFor(id, allowed, extra = {}) {
  return {
    id,
    allowed: allowed.map(([field, maxAbs]) => ({ field, maxAbs })),
    reason: 'unit-test declaration with a concrete mechanism',
    reviewer: 'unit-test reviewer',
    reviewedAt: '2026-11-21T00:00:00.000Z',
    ...extra,
  };
}

describe('identical runs', () => {
  test('a run compared with itself is PASS with no divergence', () => {
    const rec = makeRecord();
    const verdict = compare.classifyRun({ baseline: rec, current: rec });
    expect(verdict.status).toBe(STATUS.PASS);
    expect(verdict.firstDivergence).toBeNull();
    expect(verdict.divergences).toHaveLength(0);
    expect(verdict.outcome.changed).toHaveLength(0);
    expect(verdict.simVersion.changed).toBe(false);
  });

  test('semantically equal records serialised twice still PASS', () => {
    const a = makeRecord({ id: 'dup' });
    const b = JSON.parse(JSON.stringify(a));
    const verdict = compare.classifyRun({ baseline: a, current: b });
    expect(verdict.status).toBe(STATUS.PASS);
  });
});

describe('earliest divergence location', () => {
  test('a single-field off-by-one is caught with the right tick and field', () => {
    const baseline = makeRecord();
    const current = makeRecord();
    current.checkpoints[1][1] += 1; // x at tickMs 1000 -> sim tick 120 at 120 Hz

    const verdict = compare.classifyRun({ baseline, current });
    expect(verdict.status).toBe(STATUS.DIVERGED);
    expect(verdict.firstDivergence).toMatchObject({
      tickMs: 1000,
      field: 'x',
      baseline: 100,
      current: 101,
      delta: 1,
      absDelta: 1,
    });
  });

  test('the EARLIEST of several divergences is reported, not the largest', () => {
    const baseline = makeRecord();
    const current = makeRecord();
    current.checkpoints[2][2] += 50; // y at 2000 ms (late, big)
    current.checkpoints[0][5] -= 0.5; // vy at 0 ms (early, small)

    const verdict = compare.classifyRun({ baseline, current });
    expect(verdict.firstDivergence.field).toBe('vy');
    expect(verdict.firstDivergence.tickMs).toBe(0);
    expect(verdict.divergences.length).toBe(2);
  });

  test('a shorter run reports checkpointCount and still DIVERGES', () => {
    const baseline = makeRecord();
    const current = makeRecord();
    current.checkpoints = current.checkpoints.slice(0, 2);

    const verdict = compare.classifyRun({ baseline, current });
    expect(verdict.status).toBe(STATUS.DIVERGED);
    expect(verdict.divergences.some((d) => d.field === 'checkpointCount')).toBe(true);
  });
});

describe('expected-difference declarations', () => {
  test('a matching declared difference becomes EXPECTED_DIFF', () => {
    const baseline = makeRecord({ id: 'declared' });
    const current = makeRecord({ id: 'declared' });
    current.checkpoints[1][1] += 1; // x +1

    const verdict = compare.classifyRun({
      baseline,
      current,
      expected: expectedFor('declared', [['x', 2]]),
    });
    expect(verdict.status).toBe(STATUS.EXPECTED_DIFF);
    expect(verdict.firstDivergence.field).toBe('x');
  });

  test('an out-of-tolerance difference is DIVERGED even with a declaration', () => {
    const baseline = makeRecord({ id: 'tight' });
    const current = makeRecord({ id: 'tight' });
    current.checkpoints[1][1] += 5; // x +5, declared maxAbs 2

    const verdict = compare.classifyRun({
      baseline,
      current,
      expected: expectedFor('tight', [['x', 2]]),
    });
    expect(verdict.status).toBe(STATUS.DIVERGED);
  });

  test('a declaration for one field does not cover a different field', () => {
    const baseline = makeRecord({ id: 'narrow' });
    const current = makeRecord({ id: 'narrow' });
    current.checkpoints[1][1] += 1; // x +1 (covered)
    current.checkpoints[1][3] += 0.5; // angle +0.5 (not covered)

    const verdict = compare.classifyRun({
      baseline,
      current,
      expected: expectedFor('narrow', [['x', 2]]),
    });
    expect(verdict.status).toBe(STATUS.DIVERGED);
  });

  test('a wildcard-ish / malformed declaration is rejected, never widened', () => {
    const baseline = makeRecord({ id: 'bad' });
    const current = makeRecord({ id: 'bad' });
    current.checkpoints[1][1] += 1;

    expect(() => compare.validateExpected({ id: 'bad', allowed: [{ field: 'x', maxAbs: '*' }], reason: 'r', reviewer: 'v', reviewedAt: '2026-11-21' }, 'bad'))
      .toThrow(/maxAbs/);
    expect(() => compare.validateExpected({ id: 'bad', allowed: [{ field: 'x', maxAbs: 1 }], reviewer: 'v', reviewedAt: '2026-11-21' }, 'bad'))
      .toThrow(/reason/);
    expect(() => compare.validateExpected({ id: 'other', allowed: [{ field: 'x', maxAbs: 1 }], reason: 'r', reviewer: 'v', reviewedAt: '2026-11-21' }, 'bad'))
      .toThrow(/does not match/);
  });
});

describe('missing baseline', () => {
  test('no baseline is MISSING_BASELINE, not PASS or DIVERGED', () => {
    const current = makeRecord({ id: 'lonely' });
    const verdict = compare.classifyRun({ baseline: null, current });
    expect(verdict.status).toBe(STATUS.MISSING_BASELINE);
    expect(verdict.firstDivergence).toBeNull();
  });
});

describe('outcome deltas', () => {
  test('a crash-tick and cause delta is reported', () => {
    const baseline = makeRecord({ id: 'crash-a', crashTick: 500, cause: 'hazard', endTick: 500 });
    const current = makeRecord({ id: 'crash-a', crashTick: 512, cause: 'bsod', endTick: 512 });

    const verdict = compare.classifyRun({ baseline, current });
    expect(verdict.outcome.changed).toEqual(expect.arrayContaining(['crashTick', 'cause', 'endTick']));
    expect(verdict.outcome.deltas.crashTick).toBe(12);
    expect(verdict.outcome.deltas.cause).toEqual({ baseline: 'hazard', current: 'bsod' });
    expect(verdict.status).toBe(STATUS.DIVERGED);
  });

  test('a crash appearing where there was none is flagged', () => {
    const baseline = makeRecord({ id: 'crash-b', crashTick: null, cause: null });
    const current = makeRecord({ id: 'crash-b', crashTick: 640, cause: 'bsod', endTick: 640 });

    const verdict = compare.classifyRun({ baseline, current });
    expect(verdict.outcome.changed).toEqual(expect.arrayContaining(['crashed', 'crashTick', 'cause']));
    expect(verdict.status).toBe(STATUS.DIVERGED);
  });
});

describe('handling-stat aggregates', () => {
  test('aggregateStats computes crash rate and means over the real record shapes', () => {
    const a = makeRecord({ id: 'a', score: 100, distance: 40, ticks: 120, inputChanges: 2, airborneTicks: 10 });
    const b = makeRecord({ id: 'b', score: 300, distance: 60, ticks: 240, inputChanges: 6, airborneTicks: 50, crashTick: 200, cause: 'hazard', endTick: 200 });

    const agg = compare.aggregateStats([a, b]);
    expect(agg.canaries).toBe(2);
    expect(agg.crashes).toBe(1);
    expect(agg.crashRate).toBe(0.5);
    expect(agg.meanScore).toBe(200);
    expect(agg.minScore).toBe(100);
    expect(agg.maxScore).toBe(300);
    expect(agg.meanDistance).toBe(50);
    expect(agg.meanTicks).toBe(180);
    expect(agg.meanInputChanges).toBe(4);
    expect(agg.meanAirborneTicks).toBe(30);
  });

  test('classifyRun reports the per-field handling-stat deltas', () => {
    const baseline = makeRecord({ airborneTicks: 30, inputChanges: 3 });
    const current = makeRecord({ airborneTicks: 42, inputChanges: 5 });

    const verdict = compare.classifyRun({ baseline, current });
    expect(verdict.stats.airborneTicksDelta).toBe(12);
    expect(verdict.stats.inputChangesDelta).toBe(2);
  });
});

describe('sim-version stamping', () => {
  test('sameSimVersion is true for an identical stamp', () => {
    const a = makeRecord().simVersion;
    expect(compare.sameSimVersion(a, { ...a })).toBe(true);
  });

  test('a physics/format bump is flagged as its own condition', () => {
    const baseline = makeRecord();
    const bumped = makeRecord();
    bumped.simVersion = { ...baseline.simVersion, ghostPhysicsVersion: 2 };

    const verdict = compare.classifyRun({ baseline, current: bumped });
    expect(verdict.simVersion.changed).toBe(true);
    expect(verdict.simVersion.baseline.ghostPhysicsVersion).toBe(1);
    expect(verdict.simVersion.current.ghostPhysicsVersion).toBe(2);
    expect(compare.sameSimVersion(baseline.simVersion, bumped.simVersion)).toBe(false);
  });
});
