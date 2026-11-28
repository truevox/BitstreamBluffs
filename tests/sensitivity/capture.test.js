/**
 * Issue #130 (narrow slice) — capture identity tests.
 *
 * These exist because of a real failure observed in the first full 12-seed run: seed `sim-06` captured
 * 2024 m / score 4656, but the tool measured `sim-04`'s tape (1033.5 m / score 1799) and reported two seeds
 * with byte-identical replay rows. The registry keeps the last finalised tape, and a capture that ends by
 * `timeout` never finalises one, so the previous seed's tape was measured by mistake.
 *
 * A tool that silently measures the wrong course is worse than one that fails, so every one of these tests is
 * written as the substitution it forbids.
 */
import { CaptureTapeError, assertCaptureTape } from '../../tools/sensitivity/lib/capture.mjs';

const tape = (over = {}) => ({ seed: 'sim-04', dailyRuleId: 'featherweight', inputs: [[1, 0, 0]], endTick: 10, ...over });

describe('assertCaptureTape', () => {
  test('accepts the tape the current seed just produced', () => {
    const t = tape({ seed: 'sim-06' });
    expect(assertCaptureTape(t, { seed: 'sim-06', rule: 'featherweight' })).toBe(t);
  });

  test('REFUSES a tape left behind by a previous seed', () => {
    // This is the exact observed bug: sim-06 measured sim-04's tape.
    expect(() => assertCaptureTape(tape({ seed: 'sim-04' }), { seed: 'sim-06', rule: 'featherweight' }))
      .toThrow(/returned a tape for seed "sim-04", not "sim-06"/);
  });

  test('the stale-tape refusal is machine-readable and names both seeds', () => {
    try {
      assertCaptureTape(tape({ seed: 'sim-04' }), { seed: 'sim-06', rule: 'featherweight' });
      throw new Error('expected a refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(CaptureTapeError);
      expect(e.detail).toEqual({ reason: 'seed-mismatch', seed: 'sim-06', tapeSeed: 'sim-04' });
    }
  });

  test('REFUSES when no tape was registered at all', () => {
    for (const empty of [null, undefined]) {
      expect(() => assertCaptureTape(empty, { seed: 'sim-06', rule: 'featherweight' }))
        .toThrow(/produced no ghost tape for seed "sim-06"/);
    }
  });

  test('REFUSES a tape recorded under a different rule', () => {
    expect(() => assertCaptureTape(tape({ seed: 'sim-06', dailyRuleId: 'heavy' }), { seed: 'sim-06', rule: 'featherweight' }))
      .toThrow(/recorded rule "heavy", not "featherweight"/);
  });

  test('accepts a rule of none when none was requested', () => {
    const t = tape({ seed: 'sim-06', dailyRuleId: 'none' });
    expect(assertCaptureTape(t, { seed: 'sim-06', rule: 'none' })).toBe(t);
  });
});
