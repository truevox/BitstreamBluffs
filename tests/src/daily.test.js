import { DailyPatch } from '../../src/systems/DailyPatch.js';

const MOD_KEYS = ['tuckSpeedMul', 'tuckSteerMul', 'gravityMul', 'frictionMul', 'airControlMul', 'pushForceMul'];

describe('DailyPatch rules data', () => {
  test('several rules with unique ids, names, descriptions and sane multiplier-only modifiers', () => {
    expect(DailyPatch.RULES.length).toBeGreaterThanOrEqual(5);
    const ids = DailyPatch.RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of DailyPatch.RULES) {
      expect(r.name).toBeTruthy();
      expect(r.description).toBeTruthy();
      const keys = Object.keys(r.modifiers);
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) {
        expect(MOD_KEYS).toContain(k);
        expect(r.modifiers[k]).toBeGreaterThanOrEqual(0.4);
        expect(r.modifiers[k]).toBeLessThanOrEqual(2);
      }
    }
  });

  test('the doc example rule exists: tuck +50% speed, steering -50%', () => {
    const r = DailyPatch.getRuleById('tuckBoost');
    expect(r.modifiers).toEqual({ tuckSpeedMul: 1.5, tuckSteerMul: 0.5 });
  });

  test('getRuleById for unknown id is null', () => {
    expect(DailyPatch.getRuleById('nope')).toBeNull();
    expect(DailyPatch.getRuleById(undefined)).toBeNull();
  });
});

describe('DailyPatch.getDailyInfo', () => {
  test('stable within a UTC day, including the last millisecond', () => {
    const a = DailyPatch.getDailyInfo(new Date('2025-03-10T00:00:00.000Z'));
    const b = DailyPatch.getDailyInfo(new Date('2025-03-10T12:34:56.000Z'));
    const c = DailyPatch.getDailyInfo(new Date('2025-03-10T23:59:59.999Z'));
    expect(a.rule.id).toBe(b.rule.id);
    expect(b.rule.id).toBe(c.rule.id);
    expect(a.dateKey).toBe('2025-03-10');
    expect(c.dateKey).toBe('2025-03-10');
    expect(a.seed).toBe('daily-2025-03-10');
  });

  test('changes exactly at 00:00 UTC (consecutive days differ)', () => {
    const before = DailyPatch.getDailyInfo(new Date('2025-03-10T23:59:59.999Z'));
    const after = DailyPatch.getDailyInfo(new Date('2025-03-11T00:00:00.000Z'));
    expect(after.dateKey).toBe('2025-03-11');
    expect(after.rule.id).not.toBe(before.rule.id);
  });

  test('uses UTC, not local time: a timestamp late in the evening in UTC-8 is the next UTC day', () => {
    const d = new Date('2025-06-01T03:30:00.000Z'); // 2025-05-31 evening in California
    expect(DailyPatch.getDailyInfo(d).dateKey).toBe('2025-06-01');
  });

  test('deterministic: same date from different Date objects, and cycles through all rules', () => {
    const seen = new Set();
    for (let day = 0; day < DailyPatch.RULES.length; day++) {
      const d = new Date(Date.UTC(2025, 0, 1 + day, 5));
      const info = DailyPatch.getDailyInfo(d);
      expect(DailyPatch.getDailyInfo(new Date(d.getTime())).rule.id).toBe(info.rule.id);
      seen.add(info.rule.id);
    }
    expect(seen.size).toBe(DailyPatch.RULES.length);
    // periodic with period RULES.length
    const n = DailyPatch.RULES.length;
    expect(DailyPatch.getDailyInfo(new Date(Date.UTC(2025, 0, 1))).rule.id)
      .toBe(DailyPatch.getDailyInfo(new Date(Date.UTC(2025, 0, 1 + n))).rule.id);
  });

  test('index is days-since-epoch modulo length (documented contract)', () => {
    const d = new Date(Date.UTC(2030, 4, 17, 9));
    const days = Math.floor(d.getTime() / 86400000);
    expect(DailyPatch.getDailyInfo(d).rule).toBe(DailyPatch.RULES[days % DailyPatch.RULES.length]);
  });

  test('works before the epoch and with invalid dates (falls back to now, no throw)', () => {
    const old = DailyPatch.getDailyInfo(new Date('1965-02-03T10:00:00Z'));
    expect(DailyPatch.RULES).toContain(old.rule);
    expect(old.dateKey).toBe('1965-02-03');
    expect(() => DailyPatch.getDailyInfo(new Date('garbage'))).not.toThrow();
    expect(DailyPatch.getDailyInfo(new Date('garbage')).dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('default argument is now', () => {
    expect(DailyPatch.getDailyInfo().dateKey).toBe(new Date().toISOString().slice(0, 10));
  });

  test('msUntilNextRule counts down to the next midnight UTC', () => {
    expect(DailyPatch.msUntilNextRule(new Date('2025-03-10T00:00:00.000Z'))).toBe(86400000);
    expect(DailyPatch.msUntilNextRule(new Date('2025-03-10T23:59:59.000Z'))).toBe(1000);
  });
});
