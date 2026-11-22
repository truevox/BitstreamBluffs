/**
 * Marvin decision 3: the profile keeps ENCOUNTERED and COMPLETED biome sets beside the existing unlock,
 * additively inside `bb.profile` v1 (no PROFILE_VERSION or STORAGE.saveVersion bump), and the biome
 * achievements (biomes-2/5/11, ACH-3) count encountered biomes.
 */
import fs from 'fs';
import { sanitizeProfile, creditRun, ProfileStore, PROFILE_KEY } from '../../src/systems/ProfileStore.js';
import { defaultProfile, PROFILE_VERSION } from '../../src/systems/Progression.js';
import { metricsFrom } from '../../src/systems/Achievements.js';
import { STORAGE } from '../../src/constants.js';

const LEVELS = JSON.parse(fs.readFileSync('src/data/progression/levels.json', 'utf8'));
const v1 = (o = {}) => sanitizeProfile({ v: 1, ...o }, LEVELS);
let n = 0;
const rec = (o = {}) => {
  n += 1;
  return {
    version: 1, id: `run-${n}`, seed: 's', dailyRuleId: 'none', startedAt: 0, endedAt: 5000 + n, durationMs: 60000,
    score: 0, distanceM: 1200, trickPoints: 0, tricks: {}, bestCombo: 1, maxAirtimeMs: 0, cause: 'crash',
    ledgerHash: `h-${n}`, shards: 0, nearMisses: 0, ...o,
  };
};

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

describe('profile shape: biomeProgress is additive', () => {
  test('a fresh default carries empty encountered/completed sets, and versions do not move', () => {
    expect(defaultProfile().biomeProgress).toEqual({ encountered: [], completed: [] });
    expect(PROFILE_VERSION).toBe(1);
    expect(STORAGE.saveVersion).toBe(1);
  });

  test('an old v1 profile without the field loads with empty sets', () => {
    expect(v1({ xp: 10 }).biomeProgress).toEqual({ encountered: [], completed: [] });
  });

  test('the sanitizer keeps known ids only and forces completed into encountered', () => {
    const p = v1({ biomeProgress: { encountered: ['debutmont', 'atlantis', 'debutmont'], completed: ['pyramid-peak', 'x'] } });
    expect(p.biomeProgress).toEqual({ encountered: ['debutmont', 'pyramid-peak'], completed: ['pyramid-peak'] });
  });

  test('persistence: a save and a reload through ProfileStore keep both sets', () => {
    const storage = memStorage();
    const a = new ProfileStore({ storage, levels: LEVELS });
    a.load();
    a.save({ ...a.profile, biomeProgress: { encountered: ['debutmont', 'crystal-cavern'], completed: ['debutmont'] } });
    const b = new ProfileStore({ storage, levels: LEVELS });
    b.load();
    expect(b.profile.biomeProgress).toEqual({ encountered: ['debutmont', 'crystal-cavern'], completed: ['debutmont'] });
    expect(JSON.parse(storage.getItem(PROFILE_KEY)).v).toBe(1);
  });

  test('a fresh default and a saved-then-reloaded fresh profile are identical', () => {
    const storage = memStorage();
    const s = new ProfileStore({ storage, levels: LEVELS });
    s.load();
    expect(JSON.parse(storage.getItem(PROFILE_KEY))).toEqual(sanitizeProfile(defaultProfile(), LEVELS));
  });
});

describe('creditRun records the run\'s biome visits', () => {
  test('visits handed in extra.biomeVisits merge into the profile', () => {
    const res = creditRun(v1(), rec(), LEVELS, { biomeVisits: { encountered: ['debutmont', 'pyramid-peak'], completed: ['debutmont'] } });
    expect(res.profile.biomeProgress).toEqual({ encountered: ['debutmont', 'pyramid-peak'], completed: ['debutmont'] });
  });

  test('the input profile is not mutated', () => {
    const p = v1({ biomeProgress: { encountered: ['debutmont'], completed: [] } });
    creditRun(p, rec(), LEVELS, { biomeVisits: { encountered: ['pyramid-peak'], completed: ['pyramid-peak'] } });
    expect(p.biomeProgress).toEqual({ encountered: ['debutmont'], completed: [] });
  });

  test('a replayed (already credited) run changes nothing', () => {
    const r = rec();
    const first = creditRun(v1(), r, LEVELS, { biomeVisits: { encountered: ['debutmont'], completed: [] } }).profile;
    expect(creditRun(first, r, LEVELS, { biomeVisits: { encountered: ['vertigo-vents'], completed: [] } })).toBeNull();
  });

  test('no visits: the sets stay as they were', () => {
    const res = creditRun(v1({ biomeProgress: { encountered: ['debutmont'], completed: [] } }), rec(), LEVELS);
    expect(res.profile.biomeProgress).toEqual({ encountered: ['debutmont'], completed: [] });
  });
});

describe('achievement feed: biomesDiscovered = encountered count (ACH-3)', () => {
  test('metricsFrom reads the profile\'s encountered set', () => {
    const p = v1({ biomeProgress: { encountered: ['debutmont', 'pyramid-peak', 'crystal-cavern'], completed: [] } });
    expect(metricsFrom(p, null).biomesDiscovered).toBe(3);
  });

  test('a second encountered biome unlocks Explorer and grants trail-hue-aurora in the same credit', () => {
    const p = v1({ biomeProgress: { encountered: ['debutmont'], completed: [] } });
    const res = creditRun(p, rec(), LEVELS, { biomeVisits: { encountered: ['pyramid-peak'], completed: [] } });
    expect(res.awards.achievements.map((a) => a.id)).toContain('biomes-2');
    expect(res.profile.unlocked.cosmetics).toContain('trail-hue-aurora');
  });

  test('crossing 2 and 5 in one run grants both together, in canonical order, with CARTOGRAPHER', () => {
    const res = creditRun(v1(), rec(), LEVELS, {
      biomeVisits: { encountered: ['debutmont', 'garbage-dump-glacier', 'pyramid-peak', 'underwater-mountain', 'crystal-cavern'], completed: [] },
    });
    const ids = res.awards.achievements.map((a) => a.id).filter((id) => id.startsWith('biomes-'));
    expect(ids).toEqual(['biomes-2', 'biomes-5']);
    expect(res.profile.unlocked.titles).toContain('CARTOGRAPHER');
    expect(res.profile.achievements['biomes-2']).toBe(res.profile.achievements['biomes-5']);
  });

  test('all eleven grant Every Mountain and OMNISCIENT', () => {
    const all = ['debutmont', 'garbage-dump-glacier', 'pyramid-peak', 'underwater-mountain', 'crystal-cavern', 'space-mountain',
      'candy-cane-canyon', 'sky-jellyfish-mountain', 'steampunk-slopes', 'micro-mountain', 'vertigo-vents'];
    const res = creditRun(v1(), rec(), LEVELS, { biomeVisits: { encountered: all, completed: [] } });
    expect(res.profile.achievements['biomes-11']).toBeDefined();
    expect(res.profile.unlocked.titles).toContain('OMNISCIENT');
  });

  test('unlocked-but-never-entered biomes do not count (control: a level 30 pilot with no visits)', () => {
    const xp = LEVELS.levels[LEVELS.levels.length - 1].xpMin;
    const res = creditRun(v1({ xp }), rec(), LEVELS);
    expect(res.profile.pendingBiomes.length).toBe(11);
    expect(res.profile.achievements['biomes-2']).toBeUndefined();
  });
});
