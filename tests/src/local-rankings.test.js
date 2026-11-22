import { calculateLocalRankings, MAX_LOCAL_RANKING_RECORDS } from '../../src/systems/local-rankings.js';
import { DailyPatch } from '../../src/systems/DailyPatch.js';
import { DRAFT_BUDGET, DRAFT_RULES_VERSION } from '../../src/systems/DailyDraft.js';
import { SaveStore, verifyLedgerHash } from '../../src/systems/SaveStore.js';

const clean = { board: 'clean', seed: 'ALPHA', biomeMask: 0, dailyRuleId: 'featherweight' };

function record(id, changes = {}) {
  const run = {
    version: 1, hashV: 2, id, seed: clean.seed, dailyRuleId: clean.dailyRuleId,
    startedAt: 1_000, endedAt: 11_000, durationMs: 10_000, score: 100,
    distanceM: 100, tricks: { frontflip: 1, backflip: 0 }, trickPoints: 40,
    bestCombo: 1, maxAirtimeMs: 200, cause: 'crash', dailyOfficial: false, initials: 'AAA',
    ...changes,
  };
  run.ledgerHash = SaveStore.computeLedgerHash(run);
  return run;
}

const ids = (result) => result.rows.map(({ id }) => id);

test('computes existing and derived metrics, tied midranks, and strict Pareto dominance', () => {
  const better = { distanceM: 200, score: 300, tricks: { frontflip: 2, backflip: 1 }, maxAirtimeMs: 500 };
  const rows = [
    record('D', { distanceM: 120, score: 400, durationMs: 6000 }),
    record('C', better), record('A'), record('B', better),
  ];
  const result = calculateLocalRankings(rows, clean);
  expect(result).toEqual(calculateLocalRankings([...rows].reverse(), clean));
  expect(ids(result)).toEqual(['A', 'B', 'C', 'D']);
  expect(result.historySize).toBe(4);
  expect(result.sampleSize).toBe(4);
  expect(result.metrics.averageProgressMps).toEqual({ unit: 'm/s', sampleSize: 4 });
  expect(result.rows[0].values).toEqual({
    distanceM: 100, score: 100, averageProgressMps: 10, trickVariety: 1,
    efficiencyPointsPerM: 1, maxAirtimeMs: 200, survivalMs: 10000,
  });
  expect(result.rows.map((row) => row.percentiles.score)).toEqual([12.5, 50, 50, 87.5]);
  expect(result.rows.map((row) => row.percentiles.distanceM)).toEqual([12.5, 75, 75, 37.5]);
  expect(result.rows.map((row) => row.pareto)).toEqual(['dominated', 'nondominated', 'nondominated', 'nondominated']);
  expect(result.frontierSampleSize).toBe(4);
  expect(result.frontierIds).toEqual(['B', 'C', 'D']);
});

test('discloses missing denominators, overflow and small samples rather than guessing', () => {
  const empty = calculateLocalRankings([], clean);
  expect(empty.rows).toEqual([]);
  expect(empty.metrics.score.sampleSize).toBe(0);

  const solo = calculateLocalRankings([record('solo')], clean);
  expect(solo.metrics.score.sampleSize).toBe(1);
  expect(Object.values(solo.rows[0].percentiles)).toEqual(Array(7).fill(null));
  expect(solo.frontierIds).toEqual(['solo']);

  const result = calculateLocalRankings([
    record('no-time', { durationMs: 0, distanceM: 0 }),
    record('ok'),
    record('overflow', { durationMs: 1e-320, distanceM: 0.1, score: Number.MAX_VALUE }),
  ], clean);
  expect(result.rows[0].values).toMatchObject({
    distanceM: 0, survivalMs: null, averageProgressMps: null, efficiencyPointsPerM: null,
  });
  expect(result.rows[2].values).toMatchObject({ averageProgressMps: null, efficiencyPointsPerM: null });
  expect(result.metrics.distanceM.sampleSize).toBe(3);
  expect(result.metrics.efficiencyPointsPerM.sampleSize).toBe(1);
  expect(result.rows[1].percentiles.efficiencyPointsPerM).toBeNull();
  expect(result.rows.map((r) => r.pareto)).toEqual([null, 'nondominated', null]);
});

test('equal distance-to-duration ratios tie in both percentile and frontier comparisons', () => {
  const result = calculateLocalRankings([
    record('short', { distanceM: 7, durationMs: 925, score: 70 }),
    record('long', { distanceM: 63, durationMs: 8325, score: 630 }),
  ], clean);
  expect(result.rows[0].values.averageProgressMps).toBe(result.rows[1].values.averageProgressMps);
  expect(result.rows.map((row) => row.percentiles.averageProgressMps)).toEqual([50, 50]);
  expect(result.rows.map((row) => row.pareto)).toEqual(['nondominated', 'dominated']);

  const distanceM = 900_000_000_000_003, durationMs = 696;
  const scaled = calculateLocalRankings([
    record('one', { distanceM, durationMs }),
    record('three', { distanceM: 3 * distanceM, durationMs: 3 * durationMs }),
  ], clean);
  expect(scaled.rows.map((row) => row.percentiles.averageProgressMps)).toEqual([50, 50]);
});

test('matches seed, mask, rule and exact canonical paid loadout, and keeps Daily lanes separate', () => {
  const dailyInfo = DailyPatch.infoForDateKey('2026-11-21');
  const daily = { seed: dailyInfo.seed, dailyRuleId: dailyInfo.rule.id, biomeMask: dailyInfo.biomeMask };
  const purchased = { hashV: 3, modded: true, boosts: ['headStart', 'errorCorrection'], upgradeRanks: { bsodGrace: 1 } };
  const draft = {
    ...daily, hashV: 4, dailyOfficial: true, dailyMode: 'draft', modded: true,
    draftRulesVersion: DRAFT_RULES_VERSION, draftBudget: DRAFT_BUDGET, upgradeRanks: { bsodGrace: 1 },
  };
  const history = [
    record('base'),
    record('other-mask', { biomeMask: 1 }),
    record('other-seed', { seed: 'BETA' }),
    record('other-rule', { dailyRuleId: 'heavyPackets' }),
    record('v2-boost', { modded: true, boosts: ['headStart'] }),
    record('purchased', purchased),
    record('other-boost', { ...purchased, boosts: ['errorCorrection'] }),
    record('other-upgrade', { ...purchased, upgradeRanks: { bsodGrace: 2 } }),
    record('pretend-v2-upgrade', { ...purchased, hashV: 2 }),
    record('practice', daily),
    record('classic', { ...daily, dailyOfficial: true }),
    record('wrong-official-rule', { ...daily, dailyRuleId: 'fake', dailyOfficial: true }),
    record('unrankable-official', { ...daily, hashV: 3, dailyOfficial: true, ...purchased }),
    record('draft', draft),
    record('zero-rank-draft', { ...draft, upgradeRanks: {} }),
    record('expired-draft', { ...draft, draftRulesVersion: DRAFT_RULES_VERSION - 1 }),
  ];
  expect(ids(calculateLocalRankings(history, clean))).toEqual(['base']);
  expect(ids(calculateLocalRankings(history, {
    ...clean, board: 'modded', boosts: ['errorCorrection', 'headStart', 'errorCorrection'], upgradeRanks: { bsodGrace: 1 },
  }))).toEqual(['purchased']);
  expect(ids(calculateLocalRankings(history, { ...clean, board: 'modded', boosts: ['headStart'] }))).toEqual(['v2-boost']);
  expect(ids(calculateLocalRankings(history, { ...daily, board: 'clean' }))).toEqual(['practice']);
  expect(ids(calculateLocalRankings(history, { ...daily, board: 'daily-classic' }))).toEqual(['classic']);
  expect(ids(calculateLocalRankings(history, {
    ...daily, board: 'daily-draft', upgradeRanks: { bsodGrace: 1 },
  }))).toEqual(['draft']);
  expect(ids(calculateLocalRankings(history, { ...daily, board: 'daily-draft' }))).toEqual(['zero-rank-draft']);
  expect(calculateLocalRankings(history, {
    ...daily, dailyRuleId: 'fake', board: 'clean',
  }).rows).toEqual([]);
  expect(calculateLocalRankings(history, { ...daily, board: 'modded', ...purchased }).rows).toEqual([]);
});

test('does not put hash-consistent but contradictory loadouts into a cohort', () => {
  const dailyInfo = DailyPatch.infoForDateKey('2026-11-21');
  const daily = { seed: dailyInfo.seed, dailyRuleId: dailyInfo.rule.id, biomeMask: dailyInfo.biomeMask };
  const boosts = ['headStart'];
  const upgradeRanks = { bsodGrace: 1 };
  const history = [
    record('boosts-without-mod-flag', { boosts }),
    record('ranks-without-mod-flag', { hashV: 3, upgradeRanks }),
    record('missing-applied-loadout', { modded: true }),
    record('unknown-boost', { modded: true, boosts: ['futureBoost'] }),
    record('classic-with-boost', { ...daily, dailyOfficial: true, boosts }),
  ];
  expect(history.every(verifyLedgerHash)).toBe(true);
  expect(calculateLocalRankings(history, { ...clean, boosts }).rows).toEqual([]);
  expect(calculateLocalRankings(history, { ...clean, upgradeRanks }).rows).toEqual([]);
  expect(calculateLocalRankings(history, { ...clean, board: 'modded' }).rows).toEqual([]);
  expect(calculateLocalRankings(history, { ...clean, board: 'modded', boosts }).rows).toEqual([]);
  expect(calculateLocalRankings(history, { ...daily, board: 'daily-classic', boosts }).rows).toEqual([]);
});

test('excludes unsupported, tampered, malformed, quit and ambiguous IDs and collapses duplicate analyses', () => {
  const legacy = record('legacy', { hashV: undefined });
  const unknown = record('unknown', { hashV: 99 });
  // Current verification deliberately falls back to v1 for both. This narrower cohort does not.
  expect([legacy, unknown].map(verifyLedgerHash)).toEqual([true, true]);
  const good = record('good');
  const history = [
    null, 123, [], legacy, unknown, good, { ...good, initials: 'ABC' },
    record('collision'), record('collision', { seed: 'OTHER' }),
    { ...record('tampered'), score: 1000 },
    record('negative', { distanceM: -1 }), record('bad-tricks', { tricks: { x: NaN } }),
    record('bad-mask', { biomeMask: -1 }), record('missing', { maxAirtimeMs: undefined }),
    record('quit', { cause: 'quit' }), record('no-initials', { initials: '' }),
    record('imported', { imported: true }),
  ];
  expect(ids(calculateLocalRankings(history, clean))).toEqual(['good']);
  expect(calculateLocalRankings(history, clean)).toEqual(calculateLocalRankings([...history].reverse(), clean));
  expect(ids(calculateLocalRankings(history, { ...clean, seed: 'OTHER' }))).toEqual([]);
});

test('normalizes signed zeros so duplicate order does not change values', () => {
  const positive = record('zero', { distanceM: 0, score: 0, maxAirtimeMs: 0 });
  const signed = record('zero', { distanceM: -0, score: -0, maxAirtimeMs: -0 });
  expect(calculateLocalRankings([positive, signed], clean)).toEqual(calculateLocalRankings([signed, positive], clean));
});

test('consumes the public SaveStore recent-history API without reading or mutating standings', async () => {
  const source = new SaveStore();
  await source.saveRun(record('imported'));
  const store = new SaveStore();
  await store.saveRun(record('local'));
  await store.saveRun(record('uninitialed', { initials: '' }));
  expect(await store.importSharecode(await source.exportSharecode())).toEqual({ imported: 1, skipped: 0 });
  const history = await store.getRecentRuns(10);
  const storesBefore = await store.getRecentRuns(10);
  const standingsBefore = await store.getLeaderboard();
  for (const run of history) {
    Object.freeze(run.tricks);
    Object.freeze(run);
  }
  Object.freeze(history);
  expect(ids(calculateLocalRankings(history, clean))).toEqual(['local']);
  expect(await store.getRecentRuns(10)).toEqual(storesBefore);
  expect(await store.getLeaderboard()).toEqual(standingsBefore);
});

test('requires a bounded input and an explicit valid selection', () => {
  expect(() => calculateLocalRankings(null, clean)).toThrow(TypeError);
  expect(() => calculateLocalRankings(Array(MAX_LOCAL_RANKING_RECORDS + 1), clean)).toThrow(RangeError);
  expect(() => calculateLocalRankings([], { ...clean, biomeMask: undefined })).toThrow(TypeError);
  expect(() => calculateLocalRankings([], { ...clean, board: 'world' })).toThrow(TypeError);
  expect(() => calculateLocalRankings([], { ...clean, boosts: ['futureBoost'] })).toThrow(TypeError);
  expect(() => calculateLocalRankings([], { ...clean, upgradeRanks: { future: 2 } })).toThrow(TypeError);
});
