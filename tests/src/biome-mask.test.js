/**
 * W3 — the biome mask in saved data (D6: seed-best and daily-best compare only within the same mask).
 *
 * The rules that matter here are about old data, not new data: a record written before this campaign
 * has no `biomeMask`, must still load, must keep its ledger hash, and must count as mask 0. Anything
 * that reinterprets an existing run would silently rewrite somebody's leaderboard.
 */
import { SaveStore, sanitizeRun, parseSeedMask } from '../../src/systems/SaveStore.js';
import { DailyPatch } from '../../src/systems/DailyPatch.js';
import { toggleBiome, biomeToggleRows } from '../../src/systems/ProfileStore.js';
import { STORAGE } from '../../src/constants.js';
import { readDir } from './_helpers.js';
const BIOME_DEFS = readDir('biomes');

// Fixed id: the ledger hash covers id, so a fixture whose id varies with its fields would make the
// "mask does not enter the hash" assertion below pass or fail for the wrong reason.
const run = (over = {}) => ({
  version: 1, id: 'r-fixed', seed: 'alpha',
  dailyRuleId: '', startedAt: 1, endedAt: 2, durationMs: 1000, score: 100, distanceM: 10,
  trickPoints: 0, tricks: {}, bestCombo: 1, maxAirtimeMs: 0, cause: 'crash', ledgerHash: 'abcd1234',
  ...over,
});

describe('biomeMask in run records', () => {
  test('a record from before this campaign has no mask and is unchanged by sanitising', () => {
    const old = run();
    expect('biomeMask' in old).toBe(false);
    const out = sanitizeRun(old);
    // Absent, not zero: writing 0 into every historical run would rewrite stored data for no reason.
    expect('biomeMask' in out).toBe(false);
    expect(out.ledgerHash).toBe('abcd1234');
    expect(out.version).toBe(STORAGE.saveVersion);
  });

  test('a mask survives sanitising and is coerced to a non-negative integer', () => {
    expect(sanitizeRun(run({ biomeMask: 21 })).biomeMask).toBe(21);
    expect(sanitizeRun(run({ biomeMask: 0 })).biomeMask).toBe(0);
    expect(sanitizeRun(run({ biomeMask: 5.9 })).biomeMask).toBe(5);
    for (const bad of [-1, NaN, Infinity, '7', null]) {
      expect({ bad, has: 'biomeMask' in sanitizeRun(run({ biomeMask: bad })) })
        .toMatchObject({ bad, has: false });
    }
  });

  test('the mask does NOT enter the ledger hash and saveVersion is not bumped', () => {
    // Both are hard constraints of the campaign: existing saved runs must stay valid, and a version
    // bump would force a migration on every device.
    expect(STORAGE.saveVersion).toBe(1);
    const a = run();
    const b = run({ biomeMask: 16 });
    expect(SaveStore.computeLedgerHash(b)).toBe(SaveStore.computeLedgerHash(a));
  });
});

describe('mask-scoped seed and daily stats', () => {
  const store = (runs) => {
    const s = new SaveStore({ storage: null }); // memory fallback: no localStorage in Jest
    s.runs = runs;
    return s;
  };

  test('seed stats separate masks, and old records count as mask 0', () => {
    const s = store([
      run({ id: 'old', seed: 'alpha', score: 500, distanceM: 50 }), // pre-W3: no field
      run({ id: 'm0', seed: 'alpha', score: 100, distanceM: 10, biomeMask: 0 }),
      run({ id: 'm1', seed: 'alpha', score: 900, distanceM: 90, biomeMask: 1 }),
    ]);
    expect(s.getSeedStats('alpha', { biomeMask: 0 })).toMatchObject({ attempts: 2, bestScore: 500 });
    expect(s.getSeedStats('alpha', { biomeMask: 1 })).toMatchObject({ attempts: 1, bestScore: 900 });
    expect(s.getSeedStats('alpha', { biomeMask: 2 })).toBeNull();
  });

  test('omitting the mask keeps the pre-W3 behaviour of comparing every run', () => {
    // The leaderboard and the legacy tests call this without a mask; that must not silently start
    // ignoring runs.
    const s = store([
      run({ id: 'old', seed: 'alpha', score: 500, distanceM: 50 }),
      run({ id: 'm1', seed: 'alpha', score: 900, distanceM: 90, biomeMask: 1 }),
    ]);
    expect(s.getSeedStats('alpha')).toMatchObject({ attempts: 2, bestScore: 900, bestDistanceM: 90 });
  });

  test('daily stats are scoped by the daily seed, which already fixes the mask', () => {
    // D6 asks for daily-best to compare only within one mask. For a daily run that needs no stored-mask
    // filter: the mask is derived from the DATE, so every run on `daily-YYYY-MM-DD` was played at that
    // day's mask by definition. The seed is the scope. Filtering on the stored field as well would hide
    // pre-W3 daily runs (no field => mask 0) on any day whose derived mask is non-zero.
    let when = null;
    for (let i = 0; i < 30 && !when; i++) {
      const d = new Date(Date.UTC(2026, 10, 13 + i, 12));
      if (DailyPatch.biomeMaskForDate(d) !== 0) when = d;
    }
    expect(when).not.toBeNull();
    const dateKey = when.toISOString().slice(0, 10);
    const s = store([
      // A record written before this campaign existed: no biomeMask field at all.
      run({ id: 'd-old', seed: `daily-${dateKey}`, score: 900, distanceM: 90 }),
      run({ id: 'd-new', seed: `daily-${dateKey}`, score: 300, distanceM: 30, biomeMask: 3 }),
      run({ id: 'd-other', seed: 'daily-1999-01-01', score: 9999 }),
    ]);
    expect(s.getDailyStats(when)).toMatchObject({ attempts: 2, bestScore: 900, dateKey });
  });
});

describe('daily mask derivation (D6)', () => {
  test('is a pure function of the date: same day, same mask, every caller', () => {
    const d = new Date('2026-11-13T00:00:01Z');
    expect(DailyPatch.biomeMaskForDate(d)).toBe(DailyPatch.biomeMaskForDate(new Date(d.getTime())));
    // Accepts epoch ms as well as a Date.
    expect(DailyPatch.biomeMaskForDate(d.getTime())).toBe(DailyPatch.biomeMaskForDate(d));
  });

  test('is independent of unlocks — a locked biome can appear as a preview', () => {
    // Nothing about the player is an input. This is the whole of D6's "same for every player".
    const masks = new Set();
    for (let i = 0; i < 9; i++) masks.add(DailyPatch.biomeMaskForDate(new Date(Date.UTC(2026, 10, 13 + i))));
    expect([...masks].sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 8, 16]);
  });

  test('mostly mask 0, and cycles rather than drifting', () => {
    const masks = [];
    for (let i = 0; i < 9; i++) masks.push(DailyPatch.biomeMaskForDate(new Date(Date.UTC(2026, 10, 13 + i))));
    expect(masks.filter((m) => m === 0).length).toBe(4);
    // 9-day cycle: the mask repeats exactly 9 days later, so there is no drift.
    for (let i = 0; i < 9; i++) {
      const a = DailyPatch.biomeMaskForDate(new Date(Date.UTC(2026, 10, 13 + i)));
      const b = DailyPatch.biomeMaskForDate(new Date(Date.UTC(2026, 10, 22 + i)));
      expect({ i, b }).toMatchObject({ i, b: a });
    }
  });

  test('an invalid input falls back instead of throwing', () => {
    expect(Number.isFinite(DailyPatch.biomeMaskForDate(new Date('nope')))).toBe(true);
    expect(Number.isFinite(DailyPatch.biomeMaskForDate(undefined))).toBe(true);
  });
});

describe('seed@mask entry (W3)', () => {
  const DEFS = [{ bit: 1 }, { bit: 2 }, { bit: 4 }, { bit: 8 }, { bit: 16 }];

  test('a bare seed is mask 0 and is used verbatim', () => {
    // Every seed string that existed before W3 must keep meaning exactly what it meant.
    for (const seed of ['alpha', 'bitstream-bluffs', '2026-11-13', 'with space', 'UPPER']) {
      expect(parseSeedMask(seed, DEFS)).toEqual({ seed, biomeMask: 0, hadSuffix: false });
    }
  });

  test('a numeric suffix selects a mask', () => {
    expect(parseSeedMask('alpha@1', DEFS)).toEqual({ seed: 'alpha', biomeMask: 1, hadSuffix: true });
    expect(parseSeedMask('alpha@21', DEFS)).toEqual({ seed: 'alpha', biomeMask: 21, hadSuffix: true });
    expect(parseSeedMask('  alpha@16  ', DEFS)).toEqual({ seed: 'alpha', biomeMask: 16, hadSuffix: true });
  });

  test('unknown bits are dropped, because a mask bit with no biome is unplayable terrain', () => {
    // 999 has bits outside the five batch-1 biomes (bits 0-4); only 1|2|4 survive.
    expect(parseSeedMask('alpha@999', DEFS)).toEqual({ seed: 'alpha', biomeMask: 7, hadSuffix: true });
  });

  test('anything that is not a clean suffix is treated as a seed, not rejected', () => {
    // A seed is arbitrary player text; silently refusing it would lose the run they asked for.
    for (const raw of ['alpha@', '@5', 'a@b', 'alpha@x', 'alpha @ 5', '']) {
      expect({ raw, out: parseSeedMask(raw, DEFS).biomeMask }).toMatchObject({ raw, out: 0 });
    }
  });

  test('empty input does not throw', () => {
    expect(parseSeedMask(undefined, DEFS)).toEqual({ seed: '', biomeMask: 0, hadSuffix: false });
    expect(parseSeedMask(null, DEFS)).toEqual({ seed: '', biomeMask: 0, hadSuffix: false });
    expect(parseSeedMask(42, DEFS)).toEqual({ seed: '', biomeMask: 0, hadSuffix: false });
  });
});

describe('profile biome toggles (W3)', () => {
  const DEFS = [
    { id: 'debumont', bit: 1, name: 'Debumont', unlockLevel: 4 },
    { id: 'pyramid-peak', bit: 4, name: 'Pyramid Peak', unlockLevel: 10 },
  ];
  const prof = (over = {}) => ({
    v: 1, xp: 0, level: 1, bank: 0, biomeMask: 0,
    pendingBiomes: ['debumont'],
    unlocked: { biomes: [], cosmetics: [], boosts: {} },
    ...over,
  });

  test('toggles an unlocked biome on and off', () => {
    const a = toggleBiome(prof(), 'debumont', DEFS);
    expect(a.biomeMask).toBe(1);
    expect(toggleBiome(a, 'debumont', DEFS).biomeMask).toBe(0);
  });

  test('refuses a biome the player has not unlocked', () => {
    // A toggle that honoured a locked bit would hand a level-1 profile terrain it never earned.
    const p = prof();
    expect(toggleBiome(p, 'pyramid-peak', DEFS)).toBe(p);
    expect(toggleBiome(p, 'pyramid-peak', DEFS).biomeMask).toBe(0);
  });

  test('is pure and never mutates the profile it was given', () => {
    const p = prof();
    const before = JSON.stringify(p);
    toggleBiome(p, 'debumont', DEFS);
    expect(JSON.stringify(p)).toBe(before);
  });

  test('an unknown id is a no-op, not a throw', () => {
    const p = prof();
    for (const bad of ['nope', '', null, undefined, 42]) {
      expect(toggleBiome(p, bad, DEFS)).toBe(p);
    }
  });

  test('toggling one biome leaves the others alone', () => {
    // Start with ONLY Debumont enabled (mask 1).
    const p = prof({ biomeMask: 1, pendingBiomes: ['debumont', 'pyramid-peak'],
      unlocked: { biomes: [], cosmetics: [], boosts: {} } });
    // Enabling Pyramid Peak adds bit 4 and leaves Debumont's bit alone.
    expect(toggleBiome(p, 'pyramid-peak', DEFS).biomeMask).toBe(5);
    // Disabling the only enabled biome clears the mask; it must NOT resurrect some other biome's bit.
    expect(toggleBiome(p, 'debumont', DEFS).biomeMask).toBe(0);
  });

  test('rows list every biome in unlock order with its state', () => {
    const rows = biomeToggleRows(
      prof({ biomeMask: 1, pendingBiomes: ['debumont', 'pyramid-peak'],
      unlocked: { biomes: [], cosmetics: [], boosts: {} } }),
      DEFS.slice().reverse(), // input order must not leak into display order
    );
    expect(rows.map((r) => r.id)).toEqual(['debumont', 'pyramid-peak']);
    expect(rows[0]).toMatchObject({ unlocked: true, enabled: true });
    expect(rows[1]).toMatchObject({ unlocked: true, enabled: false });
  });

  test('a locked biome never shows as enabled, even if its bit is set', () => {
    // Defence in depth: a corrupt profile could carry a bit for a biome it has not unlocked. The view
    // must not render that as "on".
    const rows = biomeToggleRows(prof({ biomeMask: 4, pendingBiomes: [], unlocked: { biomes: [], cosmetics: [], boosts: {} } }), DEFS);
    expect(rows.find((r) => r.id === 'pyramid-peak')).toMatchObject({ unlocked: false, enabled: false });
  });
});

describe('D6 at the Game Over call site', () => {
  // The rule is already tested on SaveStore. What can silently break is the CALLER: GameOverScene must
  // pass the scope, or a mask-31 run is judged against mask-0 runs and reports a SEED BEST it never
  // set. This pins the scene's side of the contract rather than re-testing the store.
  const store = (runs) => {
    const s = new SaveStore({ storage: null });
    s.runs = runs;
    return s;
  };

  test('a mask-31 run sees no best from a mask-0 run on the same seed', () => {
    const s = store([
      run({ id: 'm0', seed: 'letterkenny', score: 5000, biomeMask: 0 }),
    ]);
    // What the scene asks for when the run being shown is mask 31:
    expect(s.getSeedStats('letterkenny', { biomeMask: 31 })).toBeNull();
    // And what it used to ask for (no scope), which would wrongly report 5000 as the bar to beat:
    expect(s.getSeedStats('letterkenny').bestScore).toBe(5000);
  });

  test('a pre-W3 run with no field is mask 0, so it still supplies a best for mask-0 play', () => {
    const s = store([run({ id: 'old', seed: 'letterkenny', score: 4200 })]);
    expect(s.getSeedStats('letterkenny', { biomeMask: 0 }).bestScore).toBe(4200);
    expect(s.getSeedStats('letterkenny', { biomeMask: 1 })).toBeNull();
  });

  test('the shareable seed carries the mask suffix only when the mask is not 0', () => {
    // Same rule GameOverScene applies to the SHARE SEED line: mask 0 stays suffix-free so every
    // existing seed string is unchanged; a non-zero mask round-trips through the entry parser.
    const shown = (rec) => (Number(rec.biomeMask) || 0 ? `${rec.seed}@${Number(rec.biomeMask)}` : String(rec.seed));
    expect(shown({ seed: 'letterkenny' })).toBe('letterkenny');
    expect(shown({ seed: 'letterkenny', biomeMask: 0 })).toBe('letterkenny');
    const withMask = shown({ seed: 'letterkenny', biomeMask: 31 });
    expect(withMask).toBe('letterkenny@31');
    // And it parses back to the same seed + mask, which is what makes it shareable.
    expect(parseSeedMask(withMask, BIOME_DEFS)).toEqual({ seed: 'letterkenny', biomeMask: 31, hadSuffix: true });
  });
});
