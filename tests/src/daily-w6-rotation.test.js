/**
 * Decision 5 (Marvin, 2026-11-16): the W6 biomes join the Daily biome rotation from 2026-11-17 (UTC).
 * Every date before the cutover keeps exactly the mask it always had, so past Daily records, practice
 * replays of past dates and the official-run checks stay valid.
 */
import { DailyPatch } from '../../src/systems/DailyPatch.js';

const day = (y, m, d, h = 12) => new Date(Date.UTC(y, m - 1, d, h));
const OLD = [0, 0, 0, 0, 1, 2, 4, 8, 16];
const DAY_MS = 86400000;

describe('Daily rotation cutover (decision 5)', () => {
  test('every date before 2026-11-17 keeps its v1 mask (one full year back)', () => {
    for (let i = 1; i <= 366; i++) {
      const t = Date.UTC(2026, 10, 17) - i * DAY_MS + 12 * 3600000;
      const n = Math.floor(t / DAY_MS);
      expect({ i, m: DailyPatch.biomeMaskForDate(new Date(t)) }).toEqual({ i, m: OLD[n % 9] });
    }
  });

  test('pins the last pre-cutover days and the cutover day itself', () => {
    expect(DailyPatch.biomeMaskForDate(day(2026, 11, 13))).toBe(8);
    expect(DailyPatch.biomeMaskForDate(day(2026, 11, 14))).toBe(16);
    expect(DailyPatch.biomeMaskForDate(day(2026, 11, 16, 23))).toBe(0);
    expect(DailyPatch.CUTOVER_DATE_KEY).toBe('2026-11-17');
    expect(DailyPatch.biomeMaskForDate(day(2026, 11, 17, 0))).toBe(32); // Space Mountain premieres at 00:00 UTC
  });

  test('from the cutover, a 15-day cycle features all 11 biomes once and keeps 4 clear days', () => {
    const masks = [];
    for (let i = 0; i < 15; i++) masks.push(DailyPatch.biomeMaskForDate(day(2026, 11, 17 + i)));
    expect(masks.filter((m) => m === 0).length).toBe(4);
    expect(masks.filter((m) => m !== 0).sort((a, b) => a - b)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]);
    for (const m of masks) expect(m === 0 || (m & (m - 1)) === 0).toBe(true); // one biome per day, never a mix
    for (let i = 0; i < 15; i++) {
      expect(DailyPatch.biomeMaskForDate(day(2026, 11, 17 + i + 15))).toBe(masks[i]); // cycles, no drift
    }
  });

  test('the six W6 biomes premiere first, each followed by a clear day until the last pair', () => {
    const first = [];
    for (let i = 0; i < 10; i++) first.push(DailyPatch.biomeMaskForDate(day(2026, 11, 17 + i)));
    expect(first).toEqual([32, 0, 64, 0, 128, 0, 256, 0, 512, 1024]);
  });

  test('infoForDateKey uses the same rotation on both sides of the cutover', () => {
    expect(DailyPatch.infoForDateKey('2026-11-14').biomeMask).toBe(16);
    expect(DailyPatch.infoForDateKey('2026-11-17').biomeMask).toBe(32);
    expect(DailyPatch.infoForDateKey('2026-11-19').biomeMask).toBe(64);
  });
});
