'use strict';
/**
 * The one invariant the `stall` canary actually claims.
 *
 * A display frame that stalls must not buy the simulation free time. `RunScene.update()` clamps the frame
 * delta to 50 ms (src/scenes/RunScene.js:1167) BEFORE `SimClock.advance()` sees it, so a 2500 ms stalled
 * frame may advance at most one clamp's worth of simulation — nowhere near the 2500 ms the frame claims.
 *
 * This is asserted per stall, immediately around the stalled frame, so the claim does not depend on the run
 * reaching some final tick: a run could fast-forward, skip work, or drop frames and still land on the same
 * endTick. Only the before/after tick around the stall proves what happened.
 *
 * Kept pure (no browser, no I/O) so the rule is unit-testable and cannot drift from the recorder.
 */

/** Wall-clock delta the game clamps a frame to. Mirrors RunScene.update()'s `clamp(delta, 0, 50)`. */
const FRAME_DELTA_CLAMP_MS = 50;

/**
 * @param {object} p
 * @param {number} p.tickBefore    sim tick immediately before the stalled frame was stepped
 * @param {number} p.tickAfter     sim tick immediately after
 * @param {number} p.tickMs        sim tick length in ms (e.g. 1000/120)
 * @param {number} p.frameMs       the frame delta the recorder asked for (e.g. 2500)
 * @param {number} [p.clampMs]     the game's frame clamp (defaults to FRAME_DELTA_CLAMP_MS)
 * @returns {{ok: boolean, reason: string|null, ticksAdvanced: number, simAdvancedMs: number, clampMs: number}}
 */
function checkStallAdvance({ tickBefore, tickAfter, tickMs, frameMs, clampMs = FRAME_DELTA_CLAMP_MS }) {
  const ticksAdvanced = tickAfter - tickBefore;
  const simAdvancedMs = ticksAdvanced * tickMs;
  // Allow one extra tick for the fixed-clock accumulator having carried a partial tick into the frame.
  const budgetMs = Math.min(frameMs, clampMs) + tickMs;

  const fail = (reason) => ({ ok: false, reason, ticksAdvanced, simAdvancedMs, clampMs });

  if (![tickBefore, tickAfter, tickMs, frameMs, clampMs].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return fail('non-finite input');
  }
  if (!(tickMs > 0)) return fail(`tickMs must be positive, got ${tickMs}`);
  if (!(frameMs > 0)) return fail(`frameMs must be positive, got ${frameMs}`);
  if (ticksAdvanced < 0) return fail(`simulation ran backwards (${tickBefore} -> ${tickAfter})`);
  if (ticksAdvanced === 0) return fail('a clamped frame advanced 0 ticks: the clamp is not being exercised as expected');
  if (simAdvancedMs > budgetMs) {
    return fail(
      `stalled frame advanced ${simAdvancedMs}ms of sim time, exceeding the ${budgetMs}ms budget ` +
        `(${ticksAdvanced} ticks @ ${tickMs}ms) — the frame delta reached the simulation unclamped`,
    );
  }
  // The claim only means something if the frame really was much larger than what got through.
  if (frameMs <= clampMs) {
    return fail(`frame of ${frameMs}ms is not larger than the ${clampMs}ms clamp, so nothing is clamped`);
  }
  return { ok: true, reason: null, ticksAdvanced, simAdvancedMs, clampMs };
}

module.exports = { FRAME_DELTA_CLAMP_MS, checkStallAdvance };
