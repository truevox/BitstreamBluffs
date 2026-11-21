/**
 * Issue #117 `stall` canary invariant unit tests (TEST INFRASTRUCTURE ONLY).
 *
 * The claim under test: a long display frame cannot buy the simulation free time, because RunScene clamps
 * the frame delta to 50 ms before SimClock sees it. The invariant is measured per stalled frame, so a run
 * that fast-forwards or drops frames cannot satisfy it by landing on the same final tick.
 *
 * These tests pin the rule and, just as importantly, pin that the rule FAILS when it should — a checker that
 * never says no is worse than none.
 */
// ESM package: see the note in compare.test.js — `require` must be built explicitly.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkStallAdvance, FRAME_DELTA_CLAMP_MS } = require('../../tools/canaries/lib/stall.cjs');

const TICK_MS = 1000 / 120;

describe('stall frame invariant', () => {
  test('a 2500ms frame against the 50ms clamp advances at most one clamp of sim time', () => {
    // 50ms of clamp at 8.333ms/tick = 6 ticks, +1 for a carried partial tick.
    const r = checkStallAdvance({ tickBefore: 100, tickAfter: 106, tickMs: TICK_MS, frameMs: 2500 });
    expect(r.ok).toBe(true);
    expect(r.ticksAdvanced).toBe(6);
    expect(r.simAdvancedMs).toBeCloseTo(50, 6);
  });

  test('a frame that reaches the simulation unclamped is rejected', () => {
    // 2500ms at 8.333ms/tick would be ~300 ticks; that is the failure this canary exists to catch.
    const r = checkStallAdvance({ tickBefore: 100, tickAfter: 400, tickMs: TICK_MS, frameMs: 2500 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exceeding the .* budget/);
    expect(r.ticksAdvanced).toBe(300);
  });

  test('a frame that buys just over the budget is rejected, not rounded away', () => {
    // 50ms clamp + 8.333ms tick = 58.333ms budget; 7 ticks = 58.3333ms sits inside it, 8 ticks = 66.67ms does not.
    expect(checkStallAdvance({ tickBefore: 0, tickAfter: 7, tickMs: TICK_MS, frameMs: 2500 }).ok).toBe(true);
    const over = checkStallAdvance({ tickBefore: 0, tickAfter: 8, tickMs: TICK_MS, frameMs: 2500 });
    expect(over.ok).toBe(false);
  });

  test('zero advancement fails: the clamp is not being exercised as claimed', () => {
    const r = checkStallAdvance({ tickBefore: 100, tickAfter: 100, tickMs: TICK_MS, frameMs: 2500 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/advanced 0 ticks/);
  });

  test('a backwards sim clock fails', () => {
    const r = checkStallAdvance({ tickBefore: 100, tickAfter: 90, tickMs: TICK_MS, frameMs: 2500 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ran backwards/);
  });

  test('a frame no larger than the clamp proves nothing and fails', () => {
    const r = checkStallAdvance({ tickBefore: 0, tickAfter: 3, tickMs: TICK_MS, frameMs: 50 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/nothing is clamped/);
  });

  test('non-finite or nonsensical inputs fail closed', () => {
    for (const bad of [
      { tickBefore: NaN, tickAfter: 1, tickMs: TICK_MS, frameMs: 2500 },
      { tickBefore: 0, tickAfter: Infinity, tickMs: TICK_MS, frameMs: 2500 },
      { tickBefore: 0, tickAfter: 1, tickMs: 0, frameMs: 2500 },
      { tickBefore: 0, tickAfter: 1, tickMs: TICK_MS, frameMs: 0 },
      { tickBefore: 0, tickAfter: 1, tickMs: TICK_MS, frameMs: 2500, clampMs: NaN },
    ]) {
      expect(checkStallAdvance(bad).ok).toBe(false);
    }
  });

  test('the clamp constant matches RunScene.update()', () => {
    // Pinned deliberately: if the game changes its clamp, this test should fail and force a re-think.
    expect(FRAME_DELTA_CLAMP_MS).toBe(50);
  });
});
