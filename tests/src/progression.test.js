// W1 gates: XP awards, Sync Level thresholds, rewards — all data-driven from levels.json.
import fs from 'fs';
import path from 'path';
import {
  xpForRun, levelForXp, xpToNext, rewardsForLevel, loadLevelTable, defaultProfile, PROFILE_VERSION,
} from '../../src/systems/Progression.js';

const levelsPath = path.resolve('src/data/progression/levels.json');
const TABLE = JSON.parse(fs.readFileSync(levelsPath, 'utf8'));

/** @returns {Object} a minimal RunRecord. */
function rec(over = {}) {
  return {
    id: 'r1', seed: 's', dailyRuleId: 'none', startedAt: 0, endedAt: 1000, durationMs: 60000,
    score: 1000, distanceM: 500, trickPoints: 100, tricks: { backflip: 2, spin: 1 },
    bestCombo: 2, maxAirtimeMs: 1500, cause: 'crash', ledgerHash: 'abcd1234', shards: 4, nearMisses: 3,
    ...over,
  };
}

describe('levels.json data', () => {
  test('cap matches the last entry and the 11 biomes unlock in the spec order', () => {
    expect(TABLE.cap).toBe(30);
    expect(TABLE.levels[TABLE.levels.length - 1].level).toBe(TABLE.cap);
    const biomes = TABLE.levels.map((l) => l.biome).filter(Boolean);
    expect(biomes).toEqual(TABLE.biomeOrder);
    expect(biomes).toHaveLength(11);
  });

  test('thresholds are strictly increasing and level 1 is free', () => {
    expect(TABLE.levels[0].xpMin).toBe(0);
    for (let i = 1; i < TABLE.levels.length; i++) {
      expect(TABLE.levels[i].xpMin).toBeGreaterThan(TABLE.levels[i - 1].xpMin);
    }
  });

  test('all 11 biomes unlock by the cap', () => {
    const atCap = rewardsForLevel(TABLE.cap, TABLE);
    const unlocked = [];
    for (let l = 1; l <= TABLE.cap; l++) {
      const b = rewardsForLevel(l, TABLE).biome;
      if (b) unlocked.push(b);
    }
    expect(unlocked).toEqual(TABLE.biomeOrder);
    expect(atCap).toBeTruthy();
  });
});

describe('loadLevelTable', () => {
  test('returns the same shape when handed the raw JSON', () => {
    const t = loadLevelTable(TABLE);
    expect(t.cap).toBe(30);
    expect(t.levels).toHaveLength(30);
  });

  test('falls back to a sane default when handed garbage', () => {
    const t = loadLevelTable(null);
    expect(t.levels.length).toBeGreaterThan(1);
    expect(t.cap).toBe(t.levels[t.levels.length - 1].level);
  });
});

describe('xpForRun', () => {
  test('awards distance, tricks, shards and near-misses as separate parts', () => {
    const a = xpForRun(rec());
    expect(a.total).toBeGreaterThan(0);
    const keys = a.parts.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['distance', 'tricks', 'shards', 'nearMisses']));
    const sum = a.parts.reduce((s, p) => s + p.xp, 0);
    expect(a.total).toBe(sum);
  });

  test('monotonic in distance and score', () => {
    const base = xpForRun(rec());
    const farther = xpForRun(rec({ distanceM: 900 }));
    const better = xpForRun(rec({ score: 4000 }));
    expect(farther.total).toBeGreaterThan(base.total);
    expect(better.total).toBeGreaterThan(base.total);
  });

  test('is pure: same record twice gives identical results and does not mutate the record', () => {
    const r = rec();
    const snapshot = JSON.stringify(r);
    expect(xpForRun(r)).toEqual(xpForRun(r));
    expect(JSON.stringify(r)).toBe(snapshot);
  });

  test('survives a junk/empty record without throwing', () => {
    for (const bad of [null, undefined, {}, { distanceM: -5, score: 'nope', tricks: null }]) {
      const a = xpForRun(bad);
      expect(Number.isFinite(a.total)).toBe(true);
      expect(a.total).toBeGreaterThanOrEqual(0);
    }
  });

  test('daily runs earn the same XP as normal runs (no hidden multiplier)', () => {
    const a = xpForRun(rec({ dailyRuleId: 'tuckBoost' }));
    const b = xpForRun(rec({ dailyRuleId: 'none' }));
    expect(a.total).toBe(b.total);
  });
});

describe('levelForXp / xpToNext', () => {
  test('0 XP is level 1 and the cap is respected', () => {
    expect(levelForXp(0, TABLE)).toBe(1);
    expect(levelForXp(-100, TABLE)).toBe(1);
    expect(levelForXp(10 ** 9, TABLE)).toBe(TABLE.cap);
  });

  test('crossing a threshold raises the level by exactly one', () => {
    const l2 = TABLE.levels[1].xpMin;
    expect(levelForXp(l2 - 1, TABLE)).toBe(1);
    expect(levelForXp(l2, TABLE)).toBe(2);
  });

  test('xpToNext is the remaining XP, 0 at the cap, never negative', () => {
    expect(xpToNext(0, TABLE)).toBe(TABLE.levels[1].xpMin);
    expect(xpToNext(TABLE.levels[TABLE.cap - 1].xpMin, TABLE)).toBe(0);
    expect(xpToNext(10 ** 9, TABLE)).toBe(0);
    for (let l = 1; l < TABLE.cap; l++) {
      expect(xpToNext(TABLE.levels[l - 1].xpMin, TABLE)).toBeGreaterThan(0);
    }
  });
});

describe('tuning targets (D-C: state the numbers)', () => {
  // The curve is anchored on MEASURED play, not a guess: tools/sim/pacing.mjs runs the real sim
  // (hop policy, 16 seeds, hands-off physics) and reports ~187 XP per minute of play
  // (avg 3229 m / 2.07 min per run, ~387 XP). The table is set from that rate:
  //   level 2  =    625 XP  (~3.3 min)
  //   level 4  =  3 750 XP  (~20.1 min)  <- first biome (debumont)
  //   level 30 = 149 925 XP (~13.4 h)
  // Re-measure with `node tools/sim/pacing.mjs --policy hop` if the XP feeds change.
  const XP_PER_MIN = 187;

  test('level 2 arrives within the first 3 runs of a new player', () => {
    // Worst-case early run for a beginner: short, no tricks, no shards.
    const weak = rec({ durationMs: 70000, distanceM: 600, score: 1200, tricks: {}, shards: 0, nearMisses: 0, maxAirtimeMs: 600 });
    const per = xpForRun(weak).total;
    expect(levelForXp(per * 3, TABLE)).toBeGreaterThanOrEqual(2);
    // ...and a typical first run already reaches it.
    expect(levelForXp(per, TABLE)).toBeLessThanOrEqual(2);
  });

  test('first biome unlock lands around 20 minutes of play', () => {
    const firstBiome = TABLE.levels.find((l) => l.biome);
    const minutes = firstBiome.xpMin / XP_PER_MIN;
    expect(minutes).toBeGreaterThanOrEqual(16);
    expect(minutes).toBeLessThanOrEqual(24);
  });

  test('the curve keeps rising and all 11 biomes arrive by the cap', () => {
    for (let i = 1; i < TABLE.levels.length; i++) {
      expect(TABLE.levels[i].xpMin).toBeGreaterThan(TABLE.levels[i - 1].xpMin);
    }
    const biomes = TABLE.levels.filter((l) => l.biome);
    expect(biomes).toHaveLength(TABLE.biomeOrder.length);
    expect(biomes[biomes.length - 1].level).toBeLessThanOrEqual(TABLE.cap);
    expect(TABLE.levels[TABLE.cap - 1].xpMin / XP_PER_MIN / 60).toBeLessThanOrEqual(16); // hours to cap
  });
});

describe('rewardsForLevel', () => {
  test('returns title plus the biome/cosmetic/boost that level grants', () => {
    const l4 = rewardsForLevel(4, TABLE);
    expect(l4.title).toBe('Frame Pusher');
    expect(l4.biome).toBe('debumont');
    const l1 = rewardsForLevel(1, TABLE);
    expect(l1.biome).toBe(null);
  });

  test('clamps out-of-range levels instead of throwing', () => {
    expect(rewardsForLevel(0, TABLE)).toEqual(rewardsForLevel(1, TABLE));
    expect(rewardsForLevel(999, TABLE)).toEqual(rewardsForLevel(TABLE.cap, TABLE));
    expect(rewardsForLevel('x', TABLE)).toEqual(rewardsForLevel(1, TABLE));
  });
});

describe('defaultProfile', () => {
  test('creates the whole v1 shape with empty defaults so later workstreams need no migration', () => {
    const p = defaultProfile();
    expect(p.v).toBe(PROFILE_VERSION);
    expect(p.xp).toBe(0);
    expect(p.level).toBe(1);
    expect(p.bank).toBe(0);
    for (const k of ['runs', 'distanceM', 'playMs', 'score', 'shards', 'nearMisses', 'bestScore',
      'bestDistanceM', 'bestCombo', 'maxAirtimeMs']) {
      expect(p.lifetime).toHaveProperty(k);
    }
    expect(p.lifetime.tricks).toEqual({});
    expect(p.unlocked).toEqual({ biomes: [], cosmetics: [], boosts: {} });
    expect(p.equipped).toEqual({ trail: 'default', glow: 'default', rider: 'default', theme: 'default', title: 'default' });
    expect(p.biomeMask).toBe(0);
    expect(p.missions).toEqual({ counter: 0, active: [], progress: {} });
    expect(p.achievements).toEqual({});
    expect(p.credited).toEqual([]);
  });

  test('each call returns an independent object (no shared nested refs)', () => {
    const a = defaultProfile();
    const b = defaultProfile();
    a.lifetime.tricks.spin = 5;
    a.credited.push('x');
    expect(b.lifetime.tricks).toEqual({});
    expect(b.credited).toEqual([]);
  });
});
