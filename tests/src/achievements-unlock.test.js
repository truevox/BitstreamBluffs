/**
 * Achievement evaluation fixes from the post-sprint audit (ACH-1, ACH-2, ACH-5, and the daily/streak half of
 * ACH-3). Driven through the real creditRun so the credited-run path is what is tested.
 */
import fs from 'fs';

import { sanitizeProfile, creditRun } from '../../src/systems/ProfileStore.js';
import { ACHIEVEMENTS, metricsFrom, progressFor } from '../../src/systems/Achievements.js';
import { SCORING } from '../../src/constants.js';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const LEVELS = read('src/data/progression/levels.json');

const rec = (o = {}) => ({
  version: 1, id: 'run-1', seed: 's', dailyRuleId: 'none', startedAt: 0, endedAt: 1000, durationMs: 60000,
  score: 0, distanceM: 0, trickPoints: 0, tricks: {}, bestCombo: 1, maxAirtimeMs: 0, cause: 'crash',
  ledgerHash: 'h1', shards: 0, nearMisses: 0, ...o,
});

const v1 = (o = {}) => sanitizeProfile({ v: 1, ...o }, LEVELS);

describe('ACH-1: tricksLanded counts the credited run once', () => {
  test('one run with 5 backflips does not unlock "Land 10 tricks"', () => {
    const res = creditRun(v1(), rec({ tricks: { backflip: 5 } }), LEVELS);
    expect(res.profile.lifetime.tricks.backflip).toBe(5);
    expect(res.profile.achievements['tricks-10']).toBeUndefined();
  });

  test('two runs of 5 tricks do unlock it, on the second run', () => {
    const first = creditRun(v1(), rec({ tricks: { backflip: 5 } }), LEVELS).profile;
    const second = creditRun(first, rec({ id: 'run-2', ledgerHash: 'h2', endedAt: 2000, tricks: { frontflip: 5 } }), LEVELS);
    expect(second.awards.achievements.map((a) => a.id)).toContain('tricks-10');
    expect(second.profile.achievements['tricks-10']).toBe(2000);
  });
});

describe('ACH-5: combo progress starts from nothing', () => {
  test('a fresh profile with 0 runs shows no progress toward the combo achievements', () => {
    const m = metricsFrom(v1(), null, {});
    const shown = ACHIEVEMENTS.filter((a) => a.metric === 'bestCombo').map((a) => achShown(a, m));
    expect(shown.every((v) => v === 0)).toBe(true);
  });

  test('a recorded multiplier still reads through', () => {
    const p = v1({ lifetime: { bestCombo: 1.5 } });
    expect(metricsFrom(p, null, {}).bestCombo).toBe(1.5);
    expect(metricsFrom(v1(), { bestCombo: 1.25 }, {}).bestCombo).toBe(1.25);
  });
});

function achShown(a, m) { return progressFor(a, m).value; }

describe('ACH-3 (daily and streak half): creditRun feeds the evaluator dailyRuns and streak', () => {
  test('a run on a daily seed unlocks Daily Habit', () => {
    const res = creditRun(v1(), rec({ seed: 'daily-2026-11-13' }), LEVELS);
    expect(res.awards.achievements.map((a) => a.id)).toContain('daily-1');
    expect(res.profile.lifetime.dailyRuns).toBe(1);
  });

  test('an ordinary seed does not count as a daily run', () => {
    for (const seed of ['s', 'daily-2026-13-40', 'xdaily-2026-11-13', 'daily-2026-11-13@3']) {
      const res = creditRun(v1(), rec({ seed }), LEVELS);
      expect({ seed, daily: res.profile.achievements['daily-1'] }).toEqual({ seed, daily: undefined });
      expect(res.profile.lifetime.dailyRuns).toBe(0);
    }
  });

  test('a caller-supplied streak unlocks the streak achievements and is kept as the best streak', () => {
    const three = creditRun(v1(), rec({ seed: 'daily-2026-11-13' }), LEVELS, { streak: 3 });
    expect(three.awards.achievements.map((a) => a.id)).toEqual(expect.arrayContaining(['daily-1', 'streak-3']));
    expect(three.profile.achievements['streak-7']).toBeUndefined();
    expect(three.profile.lifetime.bestStreak).toBe(3);
    const seven = creditRun(three.profile, rec({ id: 'r2', ledgerHash: 'h2', seed: 'daily-2026-11-17' }), LEVELS, { streak: 7 });
    expect(seven.awards.achievements.map((a) => a.id)).toEqual(['streak-7']);
    // A broken streak later never lowers the best.
    const later = creditRun(seven.profile, rec({ id: 'r3', ledgerHash: 'h3', seed: 'daily-2026-11-30' }), LEVELS, { streak: 1 });
    expect(later.profile.lifetime.bestStreak).toBe(7);
  });

  test('the caller cannot feed biomesDiscovered through the same door', () => {
    const p = v1({ xp: 1e9 });
    const res = creditRun(p, rec(), LEVELS, { streak: 0, biomeCount: 11 });
    expect(['biomes-2', 'biomes-5', 'biomes-11'].filter((id) => res.profile.achievements[id] !== undefined)).toEqual([]);
  });

  test('the grid reads the stored counts, so an unlocked daily row is not shown at 0', () => {
    const res = creditRun(v1(), rec({ seed: 'daily-2026-11-13' }), LEVELS, { streak: 3 });
    const m = metricsFrom(res.profile, null, {});
    expect({ dailyRuns: m.dailyRuns, bestStreak: m.bestStreak }).toEqual({ dailyRuns: 1, bestStreak: 3 });
  });
});

describe('ACH-2: every combo achievement is reachable by the combo multiplier', () => {
  const maxMult = SCORING.comboStart + SCORING.comboStep * SCORING.comboStepTypes.length;
  const combos = () => ACHIEVEMENTS.filter((a) => a.metric === 'bestCombo');

  test('every bestCombo target is at or below the top multiplier', () => {
    expect(maxMult).toBe(2);
    expect(combos().filter((a) => a.target > maxMult).map((a) => a.id)).toEqual([]);
  });

  test('every target is a multiplier the game can produce (x1 plus whole combo steps)', () => {
    for (const a of combos()) {
      const steps = (a.target - SCORING.comboStart) / SCORING.comboStep;
      expect({ id: a.id, whole: Number.isInteger(steps) && steps >= 1 }).toEqual({ id: a.id, whole: true });
    }
  });

  test('the four combo achievements have four distinct targets, and 5/10/20 climb', () => {
    const t = Object.fromEntries(combos().map((a) => [a.id, a.target]));
    expect(new Set(Object.values(t)).size).toBe(4);
    expect(t['combo-5']).toBeLessThan(t['combo-10']);
    expect(t['combo-10']).toBeLessThan(t['combo-20']);
  });

  test('ids and names are unchanged and each description states its own target', () => {
    const want = { 'combo-2': 'Doubled Up', 'combo-5': 'Chain Reaction', 'combo-10': 'Unbroken', 'combo-20': 'Wireless Legend' };
    for (const a of combos()) {
      expect({ id: a.id, name: a.name, states: a.desc.includes(`x${a.target}`) || a.desc.includes(`${a.target}x`) })
        .toEqual({ id: a.id, name: want[a.id], states: true });
    }
  });

  test('achievements.json carries the same combo entries as the built-in catalogue', () => {
    const json = read('src/data/achievements/achievements.json');
    const list = Array.isArray(json) ? json : json.achievements;
    const pick = (a) => ({ id: a.id, name: a.name, desc: a.desc, target: a.target });
    expect(list.filter((a) => a.metric === 'bestCombo').map(pick)).toEqual(combos().map(pick));
  });
});
