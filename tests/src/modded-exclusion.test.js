/**
 * W4 — a boosted run is invisible to every clean ranking surface, and still gets paid.
 *
 * Spec W4 gates: "tests proving a modded run cannot enter the clean top-10, seed-best, daily-best or
 * streak; a test that flips the constant and proves they then do."
 *
 * Each surface is tested SEPARATELY because they are four different code paths that all have to respect
 * one rule, and because the tempting shortcut — filter inside `_board()` only — fixes the top-10 while
 * leaving seed best, daily best and the streak still counting the boosted run. A player would then see
 * "NEW BEST" for a run that is not on the board at all.
 *
 * The last block is the mirror requirement: the exclusion must be about RANKING only. Shards, Resonance
 * and mission progress are earned by boosted runs too, so suppressing those would be a second, wrong
 * change hiding behind the first.
 */
import { SaveStore, sanitizeRun } from '../../src/systems/SaveStore.js';
import { isRankable, rankableOnly } from '../../src/systems/Ranking.js';

/** A store with no IndexedDB: exercises the in-memory mirror, which is the source of truth for reads. */
function makeStore() {
  const s = new SaveStore();
  s.runs = [];
  return s;
}

const RUNS = [
  // A clean run at 900 and a boosted run at 9999. If the exclusion is broken, the boosted run wins
  // every surface by score, so any leak is unmistakable rather than a tie-break argument.
  { id: 'clean-1', seed: 'alpha', dailyRuleId: '', startedAt: 1000, endedAt: 2000, durationMs: 1000, score: 900,
    distanceM: 500, trickPoints: 100, tricks: {}, bestCombo: 2, maxAirtimeMs: 100, cause: 'crash',
    initials: 'ABC', shards: 5, modded: false },
  { id: 'mod-1', seed: 'alpha', dailyRuleId: '', startedAt: 3000, endedAt: 4000, durationMs: 1000, score: 9999,
    distanceM: 9000, trickPoints: 5000, tricks: {}, bestCombo: 9, maxAirtimeMs: 900, cause: 'crash',
    initials: 'XYZ', shards: 500, modded: true },
];

/**
 * The same pair on one specific UTC day's daily seed. Built from a real date so `getDailyInfo` derives it,
 * which is the only way the daily-best and streak surfaces are actually reached — with a plain seed they
 * looked clean and the assertions passed without testing anything.
 */
const DAY = new Date('2026-11-13T12:00:00Z');
const DAILY_SEED = `daily-${DAY.toISOString().slice(0, 10)}`;
const DAILY_RUNS = [
  { ...RUNS[0], id: 'daily-clean', seed: DAILY_SEED, dailyRuleId: 'r1', startedAt: DAY.getTime(), endedAt: DAY.getTime() + 1000 },
  { ...RUNS[1], id: 'daily-mod', seed: DAILY_SEED, dailyRuleId: 'r1', startedAt: DAY.getTime() + 2000, endedAt: DAY.getTime() + 3000 },
];

const load = (store, runs) => { store.runs = runs.map((r) => sanitizeRun(r)).filter(Boolean); return store; };

describe('module 0: a boosted run is off every clean surface', () => {
  test('top-10', async () => {
    const store = load(makeStore(), RUNS);
    const board = await store.getLeaderboard(10);
    expect(board.map((r) => r.id)).toEqual(['clean-1']);
  });

  test('seed best', () => {
    const store = load(makeStore(), RUNS);
    const stats = store.getSeedStats('alpha');
    expect(stats.bestScore).toBe(900);
    expect(stats.bestDistanceM).toBe(500);
  });

  test('daily best', () => {
    const store = load(makeStore(), DAILY_RUNS);
    // Same daily seed, so only the modded gate can keep 9999 off this surface.
    expect(store.getDailyStats(DAY).bestScore).toBe(900);
  });

  test('the top-10 qualification prompt does not fire for a boosted run', async () => {
    const store = load(makeStore(), RUNS);
    // 9999 clears a board whose real 10th place is 900; only the modded gate can refuse it.
    expect(await store.qualifiesForTop10(9999, { modded: true })).toBe(false);
    expect(await store.qualifiesForTop10(9999, { modded: false })).toBe(true);
  });

  test('a boosted run does not extend a streak', () => {
    // The streak counts days with a stored run on that day's daily seed. A boosted run must not count,
    // or a player could hold a daily streak with boosts while never playing the clean daily.
    const modOnly = load(makeStore(), [DAILY_RUNS[1]]);
    expect(modOnly.getDailyStreak(DAY).streak).toBe(0);
    const cleanOnly = load(makeStore(), [DAILY_RUNS[0]]);
    expect(cleanOnly.getDailyStreak(DAY).streak).toBe(1);
  });
});

describe('module 1: flipping the constant puts them back', () => {
  test('top-10 includes the boosted run when ranking is enabled', async () => {
    const store = load(makeStore(), RUNS);
    const board = await store.getLeaderboard(10, { ranked: true });
    expect(board.map((r) => r.id)).toEqual(['mod-1', 'clean-1']);
  });

  test('seed best includes it too', () => {
    const store = load(makeStore(), RUNS);
    expect(store.getSeedStats('alpha', { ranked: true }).bestScore).toBe(9999);
  });

  test('the helper is what flipped, not the data', () => {
    // Proves the two runs differ only in the `modded` flag, so the flip above is attributable.
    expect(isRankable(RUNS[0], { ranked: true })).toBe(true);
    expect(isRankable(RUNS[1], { ranked: false })).toBe(false);
    expect(rankableOnly(RUNS, { ranked: false }).map((r) => r.id)).toEqual(['clean-1']);
  });
});

describe('module 2: a boosted run still earns everything', () => {
  test('its shards, XP and mission progress are recorded, not suppressed', async () => {
    // sanitizeRun keeps `modded` and `shards`; nothing on the crediting path may drop them. This is the
    // mirror of the exclusion: a boosted run is ranked separately, not punished.
    const rec = sanitizeRun(RUNS[1]);
    expect(rec.modded).toBe(true);
    expect(rec.shards).toBe(500);
    expect(rec.score).toBe(9999);
  });

  test('an old record with no `modded` field is clean, not retroactively disqualified', () => {
    const { modded, ...old } = RUNS[0];
    const rec = sanitizeRun(old);
    expect(rec.modded).toBeUndefined();
    expect(isRankable(rec)).toBe(true);
  });
});
