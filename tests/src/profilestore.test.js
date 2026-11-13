// W1 gates: profile persistence (own key, own version, memory fallback), idempotent crediting,
// backfill from stored runs, and corrupt/future-version tolerance.
import fs from 'fs';
import { defaultProfile, PROFILE_VERSION, rewardsForLevel, levelForXp, xpForRun } from '../../src/systems/Progression.js';
import { ProfileStore, PROFILE_KEY, sanitizeProfile, creditRun, backfillFromRuns } from '../../src/systems/ProfileStore.js';

const levels = () => JSON.parse(fs.readFileSync('src/data/progression/levels.json', 'utf8'));

/** Storage double: real localStorage lives in jsdom, this just lets us break it on purpose. */
function throwingStorage() {
  return {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
}

function rec(over = {}) {
  return {
    id: 'r1', seed: 's', dailyRuleId: 'none', startedAt: 0, endedAt: 1000, durationMs: 60000,
    score: 1000, distanceM: 500, trickPoints: 100, tricks: { backflip: 2 }, bestCombo: 2,
    maxAirtimeMs: 1500, cause: 'crash', ledgerHash: 'h1', shards: 4, nearMisses: 3, ...over,
  };
}

beforeEach(() => localStorage.clear());

describe('own storage key and version', () => {
  test('uses bb.profile, not the settings key', () => {
    expect(PROFILE_KEY).toBe('bb.profile');
    const s = new ProfileStore({ levels: levels() });
    const p = s.load();
    expect(p.v).toBe(PROFILE_VERSION);
    expect(localStorage.getItem('bb.profile')).toContain('"v":1');
    expect(localStorage.getItem('bb.settings')).toBeNull();
  });

  test('round-trips a saved profile without touching STORAGE.saveVersion', () => {
    const T = levels();
    const s = new ProfileStore({ levels: T });
    s.load();
    s.save({ ...s.profile, xp: 500 });
    const s2 = new ProfileStore({ levels: T });
    const p = s2.load();
    expect(p.xp).toBe(500);
    // level is derived from xp against the shipped table, not from a number the caller supplied
    expect(p.level).toBe(levelForXp(500, T));
    expect(p.v).toBe(PROFILE_VERSION);
  });
});

describe('load tolerance', () => {
  test('corrupt JSON loads as a clean default without throwing', () => {
    localStorage.setItem(PROFILE_KEY, '{not json');
    const s = new ProfileStore({ levels: levels() });
    expect(() => s.load()).not.toThrow();
    const p = s.profile;
    expect(p.xp).toBe(0);
    expect(p.level).toBe(1);
  });

  test('a future version loads as a clean default without throwing', () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ v: 99, xp: 123456, level: 30, futureThing: true }));
    const s = new ProfileStore({ levels: levels() });
    const p = s.load();
    expect(p.v).toBe(PROFILE_VERSION);
    expect(p.xp).toBe(0);
    expect(p.futureThing).toBeUndefined();
  });

  test('only an exact numeric v:1 is trusted; every other version is a clean default', () => {
    // Regression: a missing/stringified/array `v` used to be coerced to 1, so another version's
    // bank/xp/credited leaked into v1 state. Only the literal number 1 may be trusted.
    const junk = [
      { xp: 1234, bank: 77 }, // no version at all
      { v: null, xp: 1234 },
      { v: '1', xp: 1234 },
      { v: true, xp: 1234 },
      { v: [1], xp: 1234 },
      { v: { n: 1 }, xp: 1234 },
      { v: 0, xp: 1234 },
      { v: 2, xp: 1234 },
      { v: 1.5, xp: 1234 },
    ];
    for (const body of junk) {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(body));
      const p = new ProfileStore({ levels: levels() }).load();
      expect([body.v, p.v, p.xp, p.bank]).toEqual([body.v, PROFILE_VERSION, 0, 0]);
    }
    // ...and the exact number 1 is still trusted.
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ v: 1, xp: 1234 }));
    expect(new ProfileStore({ levels: levels() }).load().xp).toBe(1234);
  });

  test('an array body loads as a clean default', () => {
    localStorage.setItem(PROFILE_KEY, '[1,2,3]');
    const p = new ProfileStore({ levels: levels() }).load();
    expect(p.xp).toBe(0);
    expect(p.level).toBe(1);
    expect(p.credited).toEqual([]);
  });

  test('missing/blank value loads as a clean default', () => {
    for (const v of [null, '', 'null', '{}']) {
      if (v === null) localStorage.removeItem(PROFILE_KEY); else localStorage.setItem(PROFILE_KEY, v);
      const p = new ProfileStore({ levels: levels() }).load();
      expect(p.level).toBe(1);
      expect(p.credited).toEqual([]);
    }
  });

  test('does not throw when storage itself throws (private mode)', () => {
    const s = new ProfileStore({ levels: levels(), storage: throwingStorage() });
    expect(() => s.load()).not.toThrow();
    expect(() => s.save(s.profile)).not.toThrow();
    expect(s.profile.level).toBe(1);
  });
});

describe('sanitizeProfile', () => {
  test('repairs junk fields and keeps the shape complete', () => {
    const p = sanitizeProfile({
      v: 1, xp: 'lots', level: 999, bank: -5,
      lifetime: { runs: -1, tricks: { spin: 'x', flip: 3 }, shards: 2 },
      unlocked: { biomes: ['a', 5, 'a'], cosmetics: 'nope', boosts: { b: 1 } },
      credited: ['h1', 'h1', 7, 'h2'],
      missions: null, achievements: null,
    }, levels());
    expect(Number.isFinite(p.xp)).toBe(true);
    expect(p.xp).toBe(0);
    expect(p.bank).toBe(0);
    expect(p.lifetime.runs).toBe(0);
    expect(p.lifetime.tricks).toEqual({ flip: 3 });
    expect(p.unlocked.biomes).toEqual(['a']);
    expect(p.unlocked.cosmetics).toEqual([]);
    expect(p.unlocked.boosts).toEqual({ b: 1 });
    expect(p.credited).toEqual(['h1', 'h2']);
    expect(p.missions).toEqual({ counter: 0, active: [], progress: {} });
    expect(p.achievements).toEqual({});
  });

  test('recomputes level from xp so a stale level field cannot lie', () => {
    const T = levels();
    const xp = T.levels[3].xpMin; // exactly the 4th level's threshold
    const p = sanitizeProfile({ v: 1, xp, level: 1 }, T);
    expect(p.level).toBe(4);
    // and the stale field is genuinely ignored in the other direction too
    expect(sanitizeProfile({ v: 1, xp: 0, level: 9 }, T).level).toBe(1);
  });

  test('caps the credited ring so a long-lived profile cannot grow forever', () => {
    const many = Array.from({ length: 900 }, (_, i) => `h${i}`);
    const p = sanitizeProfile({ v: 1, credited: many }, levels());
    expect(p.credited.length).toBeLessThanOrEqual(500);
    expect(p.credited[p.credited.length - 1]).toBe('h899');
  });

  test('a fresh profile and a reloaded profile have the identical shape', () => {
    // Regression: derived fields were only attached on the trusted path, so the very first profile
    // (a plain default) lacked them while every later load had them. Anything reading `pendingBiomes`
    // saw `undefined` on a brand-new install. Every path must return the same shape.
    const fresh = new ProfileStore({ levels: levels() }).load();
    const reloaded = new ProfileStore({ levels: levels() }).load();
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(fresh));
    expect(Object.keys(reloaded).sort()).toEqual(Object.keys(fresh).sort());
    expect(fresh.pendingBiomes).toEqual([]);
    expect(sanitizeProfile(defaultProfile(), levels())).toEqual(fresh);
  });

  test('sanitizeProfile is idempotent (a round trip never changes the profile)', () => {
    const once = sanitizeProfile({ v: 1, xp: 700, credited: ['a', 'b'], achievements: { x: 1 } }, levels());
    expect(sanitizeProfile(once, levels())).toEqual(once);
  });
});

describe('creditRun idempotency', () => {
  test('crediting the same record twice changes nothing and awards XP once', () => {
    const s = new ProfileStore({ levels: levels() });
    s.load();
    const r = rec();
    const a1 = s.credit(r);
    const snap = JSON.stringify(s.profile);
    const a2 = s.credit(r);
    expect(a2).toBeNull();
    expect(JSON.stringify(s.profile)).toBe(snap);
    expect(a1.xp.total).toBeGreaterThan(0);
    expect(s.profile.xp).toBe(a1.xp.total);
    expect(s.profile.lifetime.runs).toBe(1);
  });

  test('a different run is credited normally and accumulates lifetime totals', () => {
    const s = new ProfileStore({ levels: levels() });
    s.load();
    s.credit(rec({ id: 'a', ledgerHash: 'h1', distanceM: 100 }));
    s.credit(rec({ id: 'b', ledgerHash: 'h2', distanceM: 300, score: 5000 }));
    expect(s.profile.lifetime.runs).toBe(2);
    expect(s.profile.lifetime.distanceM).toBe(400);
    expect(s.profile.lifetime.bestScore).toBe(5000);
    expect(s.profile.lifetime.bestDistanceM).toBe(300);
  });

  test('a record with no ledgerHash falls back to its id (still credited once)', () => {
    const s = new ProfileStore({ levels: levels() });
    s.load();
    const r = rec({ ledgerHash: '', id: 'only-id' });
    expect(s.credit(r)).toBeTruthy();
    expect(s.credit(rec({ ledgerHash: '', id: 'only-id' }))).toBeNull();
  });

  test('reports a level-up with the rewards it granted', () => {
    const s = new ProfileStore({ levels: levels() });
    s.load();
    const awards = s.credit(rec({ distanceM: 8000, score: 20000, tricks: { a: 20 }, shards: 40 }));
    expect(awards.leveledTo).toBeGreaterThan(1);
    expect(awards.rewards.title).toBeTruthy();
    expect(s.profile.level).toBe(awards.leveledTo);
  });
});

describe('backfillFromRuns', () => {
  test('fills lifetime totals and XP once from existing stored runs', () => {
    const s = new ProfileStore({ levels: levels() });
    s.load();
    const runs = [rec({ id: 'a', ledgerHash: 'h1', distanceM: 200, score: 400 }), rec({ id: 'b', ledgerHash: 'h2', distanceM: 300, score: 600 })];
    const before = s.profile.xp;
    expect(before).toBe(0);
    s.backfill(runs);
    expect(s.profile.lifetime.runs).toBe(2);
    expect(s.profile.lifetime.distanceM).toBe(500);
    expect(s.profile.lifetime.score).toBe(1000);
    expect(s.profile.xp).toBeGreaterThan(0);
    expect(s.profile.credited).toEqual(['h1', 'h2']);
    const xpAfter = s.profile.xp;
    // Backfill is once only: a second call with the same runs adds nothing.
    s.backfill(runs);
    expect(s.profile.xp).toBe(xpAfter);
    expect(s.profile.lifetime.runs).toBe(2);
  });

  test('does nothing for a profile that already has runs', () => {
    const s = new ProfileStore({ levels: levels() });
    s.load();
    s.credit(rec({ id: 'x', ledgerHash: 'hx' }));
    const snap = JSON.stringify(s.profile);
    s.backfill([rec({ id: 'a', ledgerHash: 'h1' })]);
    expect(JSON.stringify(s.profile)).toBe(snap);
  });

  test('backfill is pure-helper friendly and ignores junk entries', () => {
    const out = backfillFromRuns(defaultProfile(), [rec({ ledgerHash: 'h1' }), null, {}, rec({ id: 'z', ledgerHash: '' })], levels());
    expect(out.lifetime.runs).toBe(2);
    expect(out.xp).toBeGreaterThan(0);
  });

  test('produces the expected totals for a known fixture', () => {
    const runs = [
      rec({ id: 'a', ledgerHash: 'f1', distanceM: 100, score: 100, tricks: { t: 1 }, shards: 0, nearMisses: 0, maxAirtimeMs: 0 }),
      rec({ id: 'b', ledgerHash: 'f2', distanceM: 200, score: 200, tricks: { t: 2 }, shards: 2, nearMisses: 1, maxAirtimeMs: 2500 }),
    ];
    const s = new ProfileStore({ levels: levels() });
    s.load();
    s.backfill(runs);
    // distance 10 + 20, score 2 + 4, tricks 12 + 24, shards 0 + 10, near 0 + 2, airtime 0 + 1
    expect(s.profile.xp).toBe(85);
    expect(s.profile.lifetime.tricks).toEqual({ t: 3 });
    expect(s.profile.lifetime.shards).toBe(2);
    expect(s.profile.lifetime.maxAirtimeMs).toBe(2500);
  });
});

describe('biome rewards in W1 are listed but locked', () => {
  test('unlocked.biomes stays empty until W3/W6 ship the biomes', () => {
    const T = levels();
    const s = new ProfileStore({ levels: T });
    s.load();
    // Enough XP to reach the first biome's level, whatever the current curve is.
    const firstBiome = T.levels.find((l) => l.biome);
    const need = firstBiome.xpMin;
    let total = 0;
    for (let i = 0; i < 40 && total < need; i++) {
      const r = rec({ id: `b${i}`, ledgerHash: `hb${i}`, distanceM: 9000, score: 24000, tricks: { a: 20 }, shards: 40 });
      total += xpForRun(r).total;
      s.credit(r);
    }
    expect(s.profile.level).toBeGreaterThanOrEqual(firstBiome.level);
    // The biome is LISTED (so the UI can show "coming online") but NOT unlocked yet.
    expect(s.profile.unlocked.biomes).toEqual([]);
    expect(s.profile.pendingBiomes).toContain(firstBiome.biome);
  });
});
