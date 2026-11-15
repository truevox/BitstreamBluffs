/**
 * Marvin decisions 1 and 2 (2026-11-14).
 *  1. "Scope Daily bests by gameplay mask; keep official rankings separate."
 *  2. "Manually entered daily-* seeds are practice/custom/legacy runs, never official Daily credit or streaks."
 *
 * Only a run started from the DAILY RUN menu item is official (`dailyOfficial: true`, written by RunScene
 * on a v2 record). A typed `daily-YYYY-MM-DD` seed is practice. Legacy records (no hashV) count as official
 * only when their mask and rule are the ones that date really had.
 */
import fs from 'fs';
import { SaveStore } from '../../src/systems/SaveStore.js';
import { DailyPatch } from '../../src/systems/DailyPatch.js';
import { isOfficialDaily, countsForDailyBest, countsForStreak } from '../../src/systems/Ranking.js';
import { creditRun } from '../../src/systems/ProfileStore.js';
import { defaultProfile } from '../../src/systems/Progression.js';

const LEVELS = JSON.parse(fs.readFileSync('src/data/progression/levels.json', 'utf8'));

/** First date from `start` whose derived daily mask is (or is not) zero. */
function dateWithMask(nonZero, start = Date.UTC(2026, 10, 1, 12)) {
  for (let i = 0; i < 40; i++) {
    const d = new Date(start + i * 86400000);
    if ((DailyPatch.biomeMaskForDate(d) !== 0) === nonZero) return d;
  }
  throw new Error('no such date');
}
const keyOf = (d) => d.toISOString().slice(0, 10);

let seq = 0;
function rec(over = {}) {
  seq++;
  const r = {
    version: 1, id: `r-${seq}`, seed: 'plain', dailyRuleId: 'none', startedAt: 1000 * seq, endedAt: 1000 * seq + 1,
    durationMs: 1, score: 100, distanceM: 10, trickPoints: 0, tricks: {}, bestCombo: 1, maxAirtimeMs: 0,
    cause: 'crash', ledgerHash: '', ...over,
  };
  if (r.biomeMask === undefined) delete r.biomeMask;
  r.ledgerHash = SaveStore.computeLedgerHash(r);
  return r;
}
/** A v2 record exactly as RunScene writes it for `dateKey`. */
function v2Daily(dateKey, official, over = {}) {
  const info = DailyPatch.infoForDateKey(dateKey);
  return rec({
    seed: info.seed, dailyRuleId: info.rule.id, hashV: 2, dailyOfficial: official,
    ...(info.biomeMask ? { biomeMask: info.biomeMask } : {}), ...over,
  });
}
/** A pre-decision record (no hashV) for `dateKey`, by default on that date's real mask and rule. */
function legacyDaily(dateKey, over = {}) {
  const info = DailyPatch.infoForDateKey(dateKey);
  return rec({ seed: info.seed, dailyRuleId: info.rule.id, ...(info.biomeMask ? { biomeMask: info.biomeMask } : {}), ...over });
}
async function storeOf(records) {
  const s = new SaveStore();
  await s.init();
  for (const r of records) await s.saveRun(r);
  return s;
}

describe('DailyPatch.infoForDateKey and dailyRunLabel', () => {
  test('a date key resolves to that date\'s seed, rule and mask', () => {
    const d = dateWithMask(true);
    const k = keyOf(d);
    const info = DailyPatch.infoForDateKey(k);
    expect(info.seed).toBe(`daily-${k}`);
    expect(info.rule.id).toBe(DailyPatch.getDailyInfo(d).rule.id);
    expect(info.biomeMask).toBe(DailyPatch.biomeMaskForDate(d));
    expect(DailyPatch.infoForDateKey('2026-02-30')).toBeNull();
    expect(DailyPatch.infoForDateKey('nope')).toBeNull();
  });

  test('past dates resolve to THEIR rule, not today\'s', () => {
    const ids = new Set();
    for (let i = 0; i < 8; i++) ids.add(DailyPatch.infoForDateKey(keyOf(new Date(Date.UTC(2026, 0, 1 + i)))).rule.id);
    expect(ids.size).toBe(DailyPatch.RULES.length);
  });

  test('labels: official is DAILY RUN, a typed daily seed is DAILY PRACTICE <date>, others are empty', () => {
    expect(DailyPatch.dailyRunLabel('daily-2026-11-10', true)).toBe('DAILY RUN');
    expect(DailyPatch.dailyRunLabel('daily-2026-11-10', false)).toBe('DAILY PRACTICE 2026-11-10');
    expect(DailyPatch.dailyRunLabel('alpha', false)).toBe('');
    expect(DailyPatch.dailyRunLabel('alpha', true)).toBe('');
  });
});

describe('Ranking.isOfficialDaily', () => {
  const k = keyOf(dateWithMask(true));
  const k0 = keyOf(dateWithMask(false));

  test('v2: official only with dailyOfficial true', () => {
    expect(isOfficialDaily(v2Daily(k, true))).toBe(true);
    expect(isOfficialDaily(v2Daily(k, false))).toBe(false);
    expect(isOfficialDaily(v2Daily(k0, true))).toBe(true);
  });

  test('THE trap: a typed daily-<date> practice run on the date\'s own mask and rule is NOT official', () => {
    // It looks exactly like a legacy official run (same seed, mask and rule). hashV 2 is what tells them apart.
    const practice = v2Daily(k, false);
    const legacyLook = { ...practice };
    delete legacyLook.hashV;
    delete legacyLook.dailyOfficial;
    expect(isOfficialDaily(legacyLook)).toBe(true);
    expect(isOfficialDaily(practice)).toBe(false);
  });

  test('v2 official still needs the date\'s mask and rule (explicit filter)', () => {
    expect(isOfficialDaily(v2Daily(k, true, { biomeMask: 31 }))).toBe(false);
    const wrongRule = DailyPatch.RULES.find((r) => r.id !== DailyPatch.infoForDateKey(k).rule.id).id;
    expect(isOfficialDaily(v2Daily(k, true, { dailyRuleId: wrongRule }))).toBe(false);
  });

  test('legacy: official only on the date\'s mask and the date\'s rule', () => {
    expect(isOfficialDaily(legacyDaily(k))).toBe(true);
    expect(isOfficialDaily(legacyDaily(k, { biomeMask: 31 }))).toBe(false);
    // a legacy record with no mask field on a non-zero-mask day was not played at the date's mask
    const noMask = legacyDaily(k);
    delete noMask.biomeMask;
    expect(isOfficialDaily(noMask)).toBe(false);
    expect(isOfficialDaily(legacyDaily(k0))).toBe(true);
    const wrongRule = DailyPatch.RULES.find((r) => r.id !== DailyPatch.infoForDateKey(k0).rule.id).id;
    expect(isOfficialDaily(legacyDaily(k0, { dailyRuleId: wrongRule }))).toBe(false);
  });

  test('non-daily seeds and junk are never official', () => {
    expect(isOfficialDaily(rec({ seed: 'alpha', hashV: 2, dailyOfficial: true }))).toBe(false);
    expect(isOfficialDaily(rec({ seed: 'daily-garbage', hashV: 2, dailyOfficial: true }))).toBe(false);
    for (const j of [null, undefined, 5, 'x', {}]) expect(isOfficialDaily(j)).toBe(false);
  });

  test('countsForDailyBest drops modded runs; countsForStreak also drops imported runs', () => {
    expect(countsForDailyBest(v2Daily(k, true))).toBe(true);
    expect(countsForDailyBest(v2Daily(k, true, { modded: true }))).toBe(false);
    expect(countsForStreak(v2Daily(k, true))).toBe(true);
    expect(countsForStreak({ ...v2Daily(k, true), imported: true })).toBe(false);
    expect(countsForStreak(v2Daily(k, false))).toBe(false);
  });
});

describe('SaveStore daily surfaces count only official runs', () => {
  const d = dateWithMask(true);
  const k = keyOf(d);

  test('getDailyStats: official runs on the date\'s mask only; practice compares as a plain seed', async () => {
    const s = await storeOf([
      v2Daily(k, true, { id: 'off', score: 300, distanceM: 30 }),
      v2Daily(k, false, { id: 'prac', score: 9000, distanceM: 900 }),
      v2Daily(k, false, { id: 'prac-other-mask', score: 8000, biomeMask: 31 }),
      legacyDaily(k, { id: 'legacy-ok', score: 200, distanceM: 50 }),
      legacyDaily(k, { id: 'legacy-typed', score: 7000, biomeMask: 31 }),
    ]);
    expect(s.getDailyStats(d)).toEqual({ seed: `daily-${k}`, dateKey: k, attempts: 2, bestScore: 300, bestDistanceM: 50 });
    expect(s.getDailyStats(d, { excludeRunId: 'off' })).toMatchObject({ attempts: 1, bestScore: 200 });
    // the practice run is an ordinary seed: it still has a seed best, within its own mask
    expect(s.getSeedStats(`daily-${k}`, { biomeMask: 31 })).toMatchObject({ bestScore: 8000 });
  });

  test('getDailyStats: null when only practice runs exist', async () => {
    const s = await storeOf([v2Daily(k, false, { score: 9000 })]);
    expect(s.getDailyStats(d)).toBeNull();
  });

  test('streak: practice and imported runs never extend it; official local runs do', async () => {
    const NOW = Date.parse(`${k}T15:00:00Z`);
    const day = (n) => keyOf(new Date(NOW - n * 86400000));
    const s = await storeOf([
      v2Daily(day(0), true),
      v2Daily(day(1), false), // typed practice yesterday: does not bridge
      v2Daily(day(2), true),
    ]);
    expect(s.getDailyStreak(NOW).streak).toBe(1);
    // back-fill attempt by typing yesterday's seed changes nothing
    expect(s.getDailyStreak(NOW).lastPlayedKey).toBe(day(0));

    const imp = await storeOf([v2Daily(day(0), true)]);
    const friend = v2Daily(day(1), true, { initials: 'FRN' });
    await imp.importSharecode(JSON.stringify({ runs: [friend] }));
    expect(imp.runs.find((r) => r.id === friend.id).imported).toBe(true);
    expect(imp.getDailyStreak(NOW).streak).toBe(1);

    const both = await storeOf([v2Daily(day(0), true), v2Daily(day(1), true)]);
    expect(both.getDailyStreak(NOW).streak).toBe(2);
  });

  test('streak: a typed future daily seed cannot pre-bank tomorrow', async () => {
    const NOW = Date.parse(`${k}T15:00:00Z`);
    const tomorrow = keyOf(new Date(NOW + 86400000));
    const s = await storeOf([v2Daily(tomorrow, false), v2Daily(k, true)]);
    expect(s.getDailyStreak(NOW)).toMatchObject({ streak: 1, lastPlayedKey: k });
  });
});

describe('creditRun counts only official, local Daily runs toward dailyRuns', () => {
  const k = keyOf(dateWithMask(false));
  const credit = (r) => creditRun(defaultProfile(), r, LEVELS).profile.lifetime.dailyRuns;

  test('official counts; practice, imported and plain seeds do not', () => {
    expect(credit(v2Daily(k, true))).toBe(1);
    expect(credit(v2Daily(k, false))).toBe(0);
    expect(credit({ ...v2Daily(k, true), imported: true })).toBe(0);
    expect(credit(rec({ seed: 'alpha' }))).toBe(0);
    expect(credit(legacyDaily(k))).toBe(1);
  });

  test('a practice run does not unlock Daily Habit', () => {
    const res = creditRun(defaultProfile(), v2Daily(k, false), LEVELS);
    expect(res.awards.achievements.map((a) => a.id)).not.toContain('daily-1');
    const off = creditRun(defaultProfile(), v2Daily(k, true), LEVELS);
    expect(off.awards.achievements.map((a) => a.id)).toContain('daily-1');
  });
});
