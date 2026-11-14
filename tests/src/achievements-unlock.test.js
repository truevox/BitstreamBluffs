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

function achShown(a, m) { return progressFor(a, m).value; }
