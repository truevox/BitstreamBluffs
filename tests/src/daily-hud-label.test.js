/**
 * Decision 2, HUD half: the in-run rule line must tell the official Daily from a typed daily-* practice run.
 * The decisions agent shipped DailyPatch.dailyRunLabel for Game Over; the HUD (UIScene._buildSeedInfo) still
 * keyed on "seed === today's daily seed", so a typed daily-<today> practice run read DAILY RUN.
 */
import fs from 'fs';
import { DailyPatch } from '../../src/systems/DailyPatch.js';

describe('DailyPatch.hudRuleLabel', () => {
  test('official Daily reads DAILY RUN', () => {
    expect(DailyPatch.hudRuleLabel('daily-2026-11-15', true)).toBe('DAILY RUN');
  });
  test('typed daily seed (not official) reads DAILY PRACTICE <date>', () => {
    expect(DailyPatch.hudRuleLabel('daily-2026-11-15', false)).toBe('DAILY PRACTICE 2026-11-15');
    expect(DailyPatch.hudRuleLabel('daily-2026-11-01', undefined)).toBe('DAILY PRACTICE 2026-11-01');
  });
  test('any other seed reads DAILY RULE, even if a stray official flag is set', () => {
    expect(DailyPatch.hudRuleLabel('alpha', false)).toBe('DAILY RULE');
    expect(DailyPatch.hudRuleLabel('alpha', true)).toBe('DAILY RULE');
    expect(DailyPatch.hudRuleLabel(null, false)).toBe('DAILY RULE');
  });
});

describe('UIScene uses the label', () => {
  const src = fs.readFileSync('src/scenes/UIScene.js', 'utf8');
  const body = src.slice(src.indexOf('_buildSeedInfo(seed'), src.indexOf('// ---------------------------------------------------------------- painters'));
  test('_buildSeedInfo builds the rule line from DailyPatch.hudRuleLabel, not a seed comparison', () => {
    expect(body).toMatch(/DailyPatch\.hudRuleLabel\(/);
    expect(body).not.toMatch(/'DAILY RUN  '/);
  });
  test('the official flag comes from RUN_START, with the registry flag as the pre-RUN_START fallback', () => {
    expect(src).toMatch(/p\.dailyOfficial/);
    expect(body).toMatch(/REG\.DAILY_OFFICIAL/);
  });
});

describe('DailyPatch.ruleIdForSeed (the HUD fallback before RUN_START arrives)', () => {
  test('a daily-YYYY-MM-DD seed plays THAT date\'s rule, same as RunScene', () => {
    const k = '2026-11-10';
    expect(DailyPatch.ruleIdForSeed(`daily-${k}`)).toBe(DailyPatch.infoForDateKey(k).rule.id);
  });
  test('any other seed plays today\'s rule', () => {
    const now = new Date(Date.parse('2026-11-15T12:00:00Z'));
    expect(DailyPatch.ruleIdForSeed('alpha', now)).toBe(DailyPatch.getDailyInfo(now).rule.id);
  });
  test('UIScene falls back to ruleIdForSeed, not to today\'s rule', () => {
    const src = fs.readFileSync('src/scenes/UIScene.js', 'utf8');
    expect(src).toMatch(/DailyPatch\.ruleIdForSeed\(seed\)/);
  });
});
