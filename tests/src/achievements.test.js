/**
 * W5 achievements — the gate the spec names explicitly:
 *   "each achievement has a test with a fixture that triggers it and one that just misses."
 *
 * So this file is deliberately mechanical: it walks the whole catalogue and, for every entry, asserts
 * BOTH that a fixture at the threshold unlocks it and that a fixture one unit short does not. A
 * hand-written test per achievement would drift from the data the first time someone edits a target;
 * driving off the catalogue means adding an achievement automatically adds its two cases.
 */
import {
  ACHIEVEMENTS, METRICS, achievementFor, metricsFrom, qualified, newlyUnlocked,
  stampNew, progressFor, groupedAchievements,
} from '../../src/systems/Achievements.js';

/** A profile whose lifetime block is all zeroes. */
const EMPTY_PROFILE = {
  v: 1, xp: 0, level: 1, bank: 0,
  lifetime: {
    runs: 0, distanceM: 0, playMs: 0, score: 0, tricks: {}, shards: 0, nearMisses: 0,
    bestScore: 0, bestDistanceM: 0, bestCombo: 1, maxAirtimeMs: 0,
  },
  achievements: {},
};

/** Build metrics that satisfy `def` exactly, by putting its target in the metric it reads. */
function metricsAt(def, value) {
  const m = {};
  for (const k of METRICS) m[k] = 0;
  m.level = 1;
  m.bestCombo = 1;
  m[def.metric] = value;
  return m;
}

describe('the catalogue', () => {
  test('ships about 25 achievements', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(35);
  });

  test('ids are unique and non-empty', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  test('every metric is one the evaluator can compute', () => {
    // A typo'd metric is the failure mode that looks fine forever: the achievement simply never unlocks.
    const bad = ACHIEVEMENTS.filter((a) => !METRICS.includes(a.metric)).map((a) => `${a.id}:${a.metric}`);
    expect(bad).toEqual([]);
  });

  test('every target is a positive finite number', () => {
    for (const a of ACHIEVEMENTS) {
      expect({ id: a.id, ok: Number.isFinite(a.target) && a.target > 0 }).toEqual({ id: a.id, ok: true });
    }
  });

  test('every achievement has a name, a description and a group', () => {
    for (const a of ACHIEVEMENTS) {
      expect(typeof a.name).toBe('string');
      expect(a.name.length).toBeGreaterThan(0);
      expect(typeof a.desc).toBe('string');
      expect(typeof a.group).toBe('string');
    }
  });

  test('covers all five families the spec names', () => {
    const groups = new Set(ACHIEVEMENTS.map((a) => a.group));
    for (const g of ['skill', 'distance', 'daily', 'collection', 'biomes']) expect(groups.has(g)).toBe(true);
  });

  test('rewards name a real cosmetic or a non-empty title', () => {
    for (const a of ACHIEVEMENTS.filter((x) => x.reward)) {
      const r = a.reward;
      const ok = (typeof r.cosmetic === 'string' && r.cosmetic.length > 0)
        || (typeof r.title === 'string' && r.title.length > 0);
      expect({ id: a.id, ok }).toEqual({ id: a.id, ok: true });
    }
  });
});

describe('every achievement triggers at its target and just misses below it', () => {
  // Driven off the catalogue, so a new achievement cannot ship without both cases.
  for (const def of ACHIEVEMENTS) {
    test(`${def.id} (${def.metric} >= ${def.target})`, () => {
      const hit = qualified(metricsAt(def, def.target));
      expect(hit.map((a) => a.id)).toContain(def.id);

      // One unit short must NOT unlock. For a threshold of 1 there is no smaller positive value, so the
      // miss case is 0 (which is also the honest "has not done it at all" state).
      const miss = def.target > 1 ? def.target - 1 : 0;
      const missed = qualified(metricsAt(def, miss));
      expect(missed.map((a) => a.id)).not.toContain(def.id);
    });
  }
});

describe('metricsFrom', () => {
  test('an empty profile and no run yields zeros, not NaN', () => {
    const m = metricsFrom(null, null);
    for (const k of METRICS) expect(Number.isFinite(m[k])).toBe(true);
    expect(m.runs).toBe(0);
    expect(m.level).toBe(1);
  });

  test('a finished run folds its own values in when the profile has not been credited yet', () => {
    // Order of operations matters: the evaluator may run before the credit lands, so the run's own
    // distance/score have to count or the achievement arrives one run late.
    const m = metricsFrom(EMPTY_PROFILE, { distanceM: 1200, score: 11000, bestCombo: 3, maxAirtimeMs: 2100 });
    expect(m.bestDistanceM).toBe(1200);
    expect(m.bestScore).toBe(11000);
    expect(m.bestCombo).toBe(3);
    expect(m.maxAirtimeMs).toBe(2100);
  });

  test('a credited run is not double-counted into the bests', () => {
    const p = { ...EMPTY_PROFILE, lifetime: { ...EMPTY_PROFILE.lifetime, bestDistanceM: 1200, bestScore: 11000 } };
    const m = metricsFrom(p, { distanceM: 1200, score: 11000 });
    expect(m.bestDistanceM).toBe(1200);
    expect(m.bestScore).toBe(11000);
  });

  test('trick kinds counts distinct names across lifetime and the run', () => {
    const p = { ...EMPTY_PROFILE, lifetime: { ...EMPTY_PROFILE.lifetime, tricks: { ollie: 3, spin: 0 } } };
    const m = metricsFrom(p, { tricks: { spin: 2, grab: 1 } });
    // `spin: 0` in the lifetime is not a landed trick and must not count as a kind.
    expect(m.trickKinds).toBe(3);
    expect(m.tricksLanded).toBe(6);
  });

  test('caller-owned facts are respected', () => {
    const m = metricsFrom(EMPTY_PROFILE, null, { biomeCount: 5, streak: 7, dailyRuns: 4 });
    expect(m.biomesDiscovered).toBe(5);
    expect(m.bestStreak).toBe(7);
    expect(m.dailyRuns).toBe(4);
  });

  test('a junk profile does not throw', () => {
    for (const p of [undefined, null, 42, 'x', {}, { lifetime: 5 }]) {
      expect(() => metricsFrom(p, null)).not.toThrow();
    }
  });
});

describe('unlocks once', () => {
  test('newlyUnlocked excludes what the profile has, in either storage shape', () => {
    const metrics = metricsAt({ metric: 'runs', target: 10 }, 10);
    expect(newlyUnlocked(metrics, {}).map((a) => a.id)).toContain('ten-runs');
    expect(newlyUnlocked(metrics, { 'ten-runs': 1000 }).map((a) => a.id)).not.toContain('ten-runs');
    expect(newlyUnlocked(metrics, [{ id: 'ten-runs', at: 1000 }]).map((a) => a.id)).not.toContain('ten-runs');
    expect(newlyUnlocked(metrics, ['ten-runs']).map((a) => a.id)).not.toContain('ten-runs');
  });

  test('stampNew records the caller timestamp and refuses to restamp', () => {
    const first = stampNew({}, [{ id: 'ten-runs' }, { id: 'first-descent' }], 5000);
    expect(first.store).toEqual({ 'ten-runs': 5000, 'first-descent': 5000 });
    expect(first.added).toHaveLength(2);

    const again = stampNew(first.store, [{ id: 'ten-runs' }], 9999);
    expect(again.store['ten-runs']).toBe(5000); // history is not rewritten
    expect(again.added).toHaveLength(0);
  });

  test('a non-finite timestamp stores nothing rather than NaN', () => {
    for (const at of [undefined, null, NaN, Infinity, 'now']) {
      const r = stampNew({}, [{ id: 'ten-runs' }], at);
      expect(r.store).toEqual({});
      expect(r.added).toEqual([]);
    }
  });

  test('evaluating the same state twice is idempotent', () => {
    const metrics = metricsAt({ metric: 'combo', target: 10 }, 10);
    metrics.bestCombo = 10;
    const once = stampNew({}, newlyUnlocked(metrics, {}), 1000);
    const twice = stampNew(once.store, newlyUnlocked(metrics, once.store), 2000);
    expect(twice.added).toEqual([]);
    expect(twice.store).toEqual(once.store);
  });
});

describe('progressFor', () => {
  test('reports a clamped ratio and a done flag', () => {
    const def = achievementFor('dist-5k');
    expect(progressFor(def, { bestDistanceM: 0 })).toMatchObject({ value: 0, target: 5000, ratio: 0, done: false });
    expect(progressFor(def, { bestDistanceM: 2500 })).toMatchObject({ value: 2500, ratio: 0.5, done: false });
    expect(progressFor(def, { bestDistanceM: 5000 })).toMatchObject({ done: true, ratio: 1 });
    expect(progressFor(def, { bestDistanceM: 90000 })).toMatchObject({ value: 5000, ratio: 1, done: true });
  });

  test('a missing metric reads as zero progress rather than NaN', () => {
    const p = progressFor(achievementFor('dist-5k'), {});
    expect(Number.isFinite(p.ratio)).toBe(true);
  });
});

describe('groupedAchievements', () => {
  test('every achievement appears exactly once', () => {
    const groups = groupedAchievements();
    const flat = groups.flatMap((g) => g.items.map((i) => i.id));
    expect(flat.length).toBe(ACHIEVEMENTS.length);
    expect(new Set(flat).size).toBe(ACHIEVEMENTS.length);
  });
});
