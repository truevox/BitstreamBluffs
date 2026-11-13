/**
 * W4 — modded runs get their own leaderboard tab, decided in Ranking.js and nowhere else.
 *
 * Spec W4: "While the constant is false, modded runs are excluded from the clean top-10, getSeedStats,
 * getDailyStats and the NEW BEST marker; they get their own leaderboard tab". The tab is the part that is
 * easy to skip: excluding a boosted run everywhere it could rank is complete-looking, and it means a
 * player who paid for a boost and scored their best run has nowhere to see it.
 */
import { isModdedOnly, isRankable, rankableOnly } from '../../src/systems/Ranking.js';
import { SaveStore } from '../../src/systems/SaveStore.js';

const rec = (o) => ({
  version: 1, id: o.id || 'r1', score: 1000, distanceM: 500, initials: 'AAA',
  endedAt: 1000, seed: 's', tricks: {}, ...o,
});

describe('isModdedOnly', () => {
  test('a boosted run belongs on the modded board', () => {
    expect(isModdedOnly(rec({ modded: true }))).toBe(true);
  });

  test('a clean run does not', () => {
    expect(isModdedOnly(rec({}))).toBe(false);
    expect(isModdedOnly(rec({ modded: false }))).toBe(false);
  });

  test('a pre-W4 record with no modded field does not', () => {
    // Absent means clean: W4 must not retroactively move every historical run onto the modded tab.
    const old = rec({});
    delete old.modded;
    expect(isModdedOnly(old)).toBe(false);
  });

  test('junk is not modded', () => {
    for (const v of [null, undefined, 42, 'x', []]) expect(isModdedOnly(v)).toBe(false);
  });

  test('when the constant is on, a modded run ranks clean and does not also need the tab', () => {
    // Flipping the constant must move the run onto the clean board, not duplicate it onto both.
    const r = rec({ modded: true });
    expect(isRankable(r, { ranked: true })).toBe(true);
    expect(isModdedOnly(r, { ranked: true })).toBe(false);
  });
});

describe('the two boards are exactly complementary', () => {
  test('every record lands on exactly one of clean / modded', () => {
    const rows = [
      rec({ id: 'clean-1' }),
      rec({ id: 'clean-old' }),
      rec({ id: 'mod-1', modded: true }),
      rec({ id: 'mod-2', modded: true, score: 2000 }),
    ];
    const clean = rankableOnly(rows);
    const modded = rows.filter((r) => isModdedOnly(r));
    expect(clean.length + modded.length).toBe(rows.length);
    // No record appears in both: that would double-count a run on two boards.
    const cleanIds = new Set(clean.map((r) => r.id));
    expect(modded.some((r) => cleanIds.has(r.id))).toBe(false);
  });

  test('flipping the constant moves the modded runs onto the clean board', () => {
    const rows = [rec({ id: 'c' }), rec({ id: 'm', modded: true })];
    expect(rankableOnly(rows).map((r) => r.id)).toEqual(['c']);
    expect(rankableOnly(rows, { ranked: true }).map((r) => r.id)).toEqual(['c', 'm']);
    expect(rows.filter((r) => isModdedOnly(r, { ranked: true }))).toEqual([]);
  });
});

/** A store with no IndexedDB: the in-memory mirror is what reads are served from. */
function makeStore(runs) {
  const s = new SaveStore();
  s.runs = runs;
  return s;
}

describe('qualifiesForModdedTop10 — the board a boosted run can actually enter', () => {
  test('a boosted score qualifies on the MODDED board, and never on the clean one', async () => {
    // The defect this closes: Game Over asked qualifiesForTop10 for a boosted run, which either offered
    // clean-board initials for a run the clean board will never hold, or (with fudged opts) made every
    // clean run on the board unrankable. A boosted run has its own board, so it gets its own question.
    const store = makeStore([]);
    expect(await store.qualifiesForModdedTop10(500)).toBe(true);
    // qualifiesForTop10's `opts` is the candidate record itself, so the boosted candidate is passed as the
    // record: that is what makes the helper (not the caller) decide it cannot rank.
    expect(await store.qualifiesForTop10(500, { modded: true })).toBe(false);
    // A clean candidate still qualifies: the boost exclusion must not have broken the normal path.
    expect(await store.qualifiesForTop10(500, { modded: false })).toBe(true);
  });

  test('a full modded board only admits a score that beats its last entry', async () => {
    const runs = [];
    for (let i = 0; i < 10; i++) {
      runs.push(rec({ id: `mod-${i}`, score: 1000 + i * 100, endedAt: i + 1, modded: true }));
    }
    const store = makeStore(runs);
    expect(await store.qualifiesForModdedTop10(500)).toBe(false);
    expect(await store.qualifiesForModdedTop10(5000)).toBe(true);
  });

  test('ten CLEAN runs do not fill the modded board', async () => {
    // If they did, a boosted player would be denied their own top 10 by runs that are not on it.
    const runs = [];
    for (let i = 0; i < 10; i++) runs.push(rec({ id: `clean-${i}`, score: 9000, endedAt: i + 1 }));
    const store = makeStore(runs);
    expect(await store.qualifiesForModdedTop10(10)).toBe(true);
  });
});
