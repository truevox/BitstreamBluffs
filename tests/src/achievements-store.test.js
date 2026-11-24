/**
 * W5 achievements — the store integration, which is where a correct evaluator still ships broken.
 *
 * The pure evaluator is tested next door. What this file pins is the SEAM: that creditRun stamps
 * achievements into the same save it credits XP into, that the timestamp comes from the record rather than
 * the clock, that rewards land with the stamp, and that a save round-trip does not lose or duplicate them.
 */
import { creditRun, unlockAchievementsFor, sanitizeProfile, grantAchievementReward } from '../../src/systems/ProfileStore.js';
import { defaultProfile } from '../../src/systems/Progression.js';

const NOW = 1_700_000_000_000;

/** A finished run record carrying just enough for crediting and achievement thresholds. */
const run = (o = {}) => ({
  version: 1,
  id: 'r1',
  seed: 's',
  startedAt: NOW - 60_000,
  endedAt: NOW,
  durationMs: 60_000,
  distanceM: 100,
  score: 1000,
  maxCombo: 2,
  maxAirtimeMs: 100,
  tricks: {},
  shards: 0,
  ledgerHash: 'abc12345',
  ...o,
});

const fresh = (o = {}) => ({ ...defaultProfile(), ...o });

describe('creditRun stamps achievements', () => {
  test('a first run unlocks the first-run achievement, stamped with the record end time', () => {
    const { profile, awards } = creditRun(fresh(), run());
    expect(awards.achievements.map((a) => a.id)).toContain('first-descent');
    // The timestamp is the RECORD's end, not Date.now(): a replayed save must produce the same unlock time.
    expect(profile.achievements['first-descent']).toBe(NOW);
  });

  test('the same run credited twice does not restamp or double-grant', () => {
    const first = creditRun(fresh(), run());
    // creditRun refuses a re-credited ledger hash outright, which is the first line of defence against a
    // double grant. The evaluator's own idempotency is covered directly below and in the pure suite.
    expect(creditRun(first.profile, run())).toBeNull();
    const after = sanitizeProfile(first.profile);
    expect(after.achievements).toEqual(first.profile.achievements);
  });

  test('a run that crosses a distance threshold unlocks it on that run', () => {
    const { profile, awards } = creditRun(fresh(), run({ distanceM: 1200 }));
    expect(awards.achievements.map((a) => a.id)).toContain('dist-1k');
    expect(profile.achievements['dist-1k']).toBe(NOW);
  });

  test('a run just under a threshold does not unlock it', () => {
    const { awards } = creditRun(fresh(), run({ distanceM: 999 }));
    expect(awards.achievements.map((a) => a.id)).not.toContain('dist-1k');
  });

  test('a reward is granted in the same save as its unlock', () => {
    // biomes-2 grants a cosmetic. Reaching it must hand over the item atomically, or the player sees the
    // achievement but never gets what it promised.
    const p = fresh({ lifetime: { ...defaultProfile().lifetime, runs: 1 } });
    const { profile, added } = unlockAchievementsFor(p, null, { at: NOW, biomeCount: 2 });
    expect(added.map((a) => a.id)).toContain('biomes-2');
    expect(profile.unlocked.cosmetics).toContain('trail-hue-aurora');
  });

  test('a title reward lands in unlocked.titles', () => {
    const p = fresh();
    const { profile, added } = unlockAchievementsFor(p, null, { at: NOW, biomeCount: 5 });
    expect(added.map((a) => a.id)).toContain('biomes-5');
    expect(profile.unlocked.titles).toContain('CARTOGRAPHER');
  });

  test('a reward is not granted twice', () => {
    const p = fresh();
    const once = unlockAchievementsFor(p, null, { at: NOW, biomeCount: 5 });
    const twice = unlockAchievementsFor(once.profile, null, { at: NOW, biomeCount: 5 });
    expect(twice.added).toEqual([]);
    expect(twice.profile.unlocked.titles.filter((t) => t === 'CARTOGRAPHER')).toHaveLength(1);
  });
});

describe('unlockAchievementsFor is pure', () => {
  test('does not mutate the profile it is given', () => {
    const p = fresh();
    const snapshot = JSON.stringify(p);
    unlockAchievementsFor(p, run({ distanceM: 9000 }), { at: NOW, biomeCount: 11 });
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  test('a missing timestamp unlocks nothing rather than storing NaN', () => {
    const p = fresh();
    const { profile, added } = unlockAchievementsFor(p, run({ distanceM: 9000 }), { biomeCount: 11 });
    expect(added).toEqual([]);
    expect(profile.achievements).toEqual({});
  });

  test('junk input does not throw', () => {
    for (const p of [null, undefined, {}, 5]) {
      expect(() => unlockAchievementsFor(p, null, { at: NOW })).not.toThrow();
    }
  });
});

describe('sanitizeProfile keeps achievements trustworthy', () => {
  test('drops non-finite timestamps and junk keys', () => {
    const raw = { v: 1, achievements: { ok: NOW, bad: 'soon', worse: NaN, alsoBad: null } };
    const p = sanitizeProfile(raw);
    expect(p.achievements).toEqual({ ok: NOW });
  });

  test('an array is not a valid achievements map', () => {
    const p = sanitizeProfile({ v: 1, achievements: ['a', 'b'] });
    expect(p.achievements).toEqual({});
  });

  test('a missing block becomes an empty map', () => {
    expect(sanitizeProfile({ v: 1 }).achievements).toEqual({});
  });

  test('unlocks survive a save/load round trip', () => {
    const { profile } = creditRun(fresh(), run({ distanceM: 1200 }));
    const reloaded = sanitizeProfile(JSON.parse(JSON.stringify(profile)));
    expect(reloaded.achievements).toEqual(profile.achievements);
  });
});

describe('grantAchievementReward', () => {
  test('ignores an achievement with no reward', () => {
    const p = fresh();
    const before = JSON.stringify(p);
    grantAchievementReward(p, { id: 'x' });
    expect(JSON.stringify(p)).toBe(before);
  });

  test('ignores an unknown reward kind instead of throwing', () => {
    const p = fresh();
    expect(() => grantAchievementReward(p, { id: 'x', reward: { mystery: 'thing' } })).not.toThrow();
  });

  test('creates the unlocked block when the profile has none', () => {
    const p = { v: 1 };
    grantAchievementReward(p, { id: 'x', reward: { cosmetic: 'rider-hue-mint' } });
    expect(p.unlocked.cosmetics).toEqual(['rider-hue-mint']);
  });
});
