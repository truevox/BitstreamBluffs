/**
 * A run's tricks must be counted ONCE when achievements are evaluated during credit.
 *
 * `creditRun` folds `record.tricks` into `lifetime.tricks` and then evaluates achievements against that
 * SAME profile with that SAME record. `metricsFrom` adds `lifetime.tricks` to `run.tricks`, so the run is
 * counted twice and a threshold unlocks at half the real number. These tests go through `creditRun`
 * rather than calling the evaluator with hand-built metrics, because hand-built metrics is exactly what
 * hid the bug: `tests/src/achievements.test.js` asserts metricsFrom's own arithmetic, which was right for
 * its contract, while the caller was feeding it a profile that already contained the run.
 */

import { creditRun, unlockAchievementsFor } from '../../src/systems/ProfileStore.js';
import { defaultProfile, loadLevelTable } from '../../src/systems/Progression.js';

const table = loadLevelTable();

/** A record with `kinds` distinct tricks landing `per` times each. */
function trickRecord(kinds, per, extra = {}) {
  const tricks = {};
  for (let i = 0; i < kinds; i++) tricks[`trick${i}`] = per;
  return {
    id: `rec-${kinds}x${per}`,
    ledgerHash: `hash-${kinds}x${per}`,
    endedAt: 1_700_000_000_000,
    score: 500,
    distanceM: 250,
    durationMs: 30_000,
    shards: 0,
    ...extra,
    tricks,
  };
}

const has = (added, id) => (added || []).some((a) => a.id === id);

describe('creditRun does not double-count a run\'s tricks against achievements', () => {
  test('five lands in one run does NOT unlock tricks-10', () => {
    const res = creditRun(defaultProfile(), trickRecord(5, 1), table);
    const total = Object.values(res.profile.lifetime.tricks).reduce((a, b) => a + b, 0);

    expect(total).toBe(5);                     // lifetime total is correct
    expect(has(res.awards.achievements, 'tricks-10')).toBe(false);  // ...and must not grant a 10-land badge
  });

  test('five lands in one run DOES unlock trick-kinds-5, which it genuinely earned', () => {
    const res = creditRun(defaultProfile(), trickRecord(5, 1), table);
    expect(has(res.awards.achievements, 'trick-kinds-5')).toBe(true);
  });

  test('ten lands in one run unlocks tricks-10, on the tenth landing exactly', () => {
    const nine = creditRun(defaultProfile(), trickRecord(9, 1), table);
    expect(has(nine.awards.achievements, 'tricks-10')).toBe(false);

    const ten = creditRun(defaultProfile(), trickRecord(5, 2), table);
    expect(has(ten.awards.achievements, 'tricks-10')).toBe(true);
  });

  test('the lifetime total still accumulates across runs, and thresholds fire on the real total', () => {
    let profile = defaultProfile();
    // Six runs of 5 lands = 30 lands. tricks-10 must fire, and trick-kinds-5 must fire once only.
    for (let i = 0; i < 6; i++) {
      const res = creditRun(profile, { ...trickRecord(5, 1), id: `r${i}`, ledgerHash: `h${i}` }, table);
      profile = res.profile;
    }
    const total = Object.values(profile.lifetime.tricks).reduce((a, b) => a + b, 0);
    expect(total).toBe(30);
    expect(profile.achievements['tricks-10']).toBeTruthy();
    expect(profile.achievements['tricks-100']).toBeFalsy();
  });

  test('a replay is still not double-credited (the guard above the fold still works)', () => {
    const rec = trickRecord(5, 1);
    const first = creditRun(defaultProfile(), rec, table);
    const again = creditRun(first.profile, rec, table);
    expect(again).toBeNull();
  });

  test('evaluating a run separately from the profile still counts the run — the metrics contract is intact', () => {
    // This is the OTHER call path: unlockAchievementsFor(profile, run) where `profile` does NOT yet contain
    // the run (achievements-store.test.js relies on this). The fix must not break it.
    const fresh = defaultProfile();
    const res = unlockAchievementsFor(fresh, { ...trickRecord(4, 1), tricks: { a: 4, b: 4 } }, { at: 1 });
    // 8 lands from the run alone, on top of an empty lifetime -> tricks-10 must NOT fire.
    expect(has(res.added, 'tricks-10')).toBe(false);
  });
});
