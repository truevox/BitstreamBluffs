/**
 * OWNER: core-logic engineer. NO Phaser imports.
 *
 * Fixed simulation tick (issue #59). Display frames feed real elapsed time into an
 * accumulator; the game advances only in whole ticks of SIM_TICK_MS, so the same input
 * tape produces the same run at 30, 60 or 120 Hz.
 *
 * Candidate tick: 120 Hz (8.333 ms). It divides 30/60/120 Hz frames exactly (4/2/1 ticks,
 * no judder without interpolation), and with the 8 ms Matter cap every tick is two 4.17 ms
 * physics steps: exactly the steps a 120 Hz display already runs on the variable-delta
 * loop. Not an owner-approved constant: see docs/issue-59-fixed-tick.md.
 */

export const SIM_TICK_HZ = 120;
export const SIM_TICK_MS = 1000 / SIM_TICK_HZ;
/** Same ceiling as the old 50 ms frame clamp: never more than this many ticks per frame. */
export const SIM_MAX_TICKS_PER_FRAME = Math.ceil(50 / SIM_TICK_MS - 1e-9);
// Float slack so 3 x 33.333.. ms frames are exactly 12 ticks, never 11 then 13.
const EPS = 1e-6;
const EDGE_NAMES = ['hop', 'reset', 'pause', 'airBrake', 'parachute', 'confirm'];

export class SimClock {
  /** @param {number} [tickMs] @param {number} [maxTicks] */
  constructor(tickMs = SIM_TICK_MS, maxTicks = SIM_MAX_TICKS_PER_FRAME) {
    this.tickMs = tickMs;
    this.maxTicks = maxTicks;
    /** Real ms owed to the simulation, always < tickMs between frames. */
    this.accMs = 0;
    /** Integer count of ticks simulated this run: the replay time axis. */
    this.tick = 0;
    /** Real ms discarded because a frame needed more than maxTicks (slow device). */
    this.droppedMs = 0;
    this._edges = null;
  }

  /**
   * Ticks to run for a display frame of `frameMs` real ms. Backlog beyond the cap is
   * dropped, not replayed later: a stalled tab never fast-forwards the run.
   * @param {number} frameMs
   * @returns {number}
   */
  advance(frameMs) {
    this.accMs += Number.isFinite(frameMs) && frameMs > 0 ? frameMs : 0;
    let n = Math.floor((this.accMs + EPS) / this.tickMs);
    if (n > this.maxTicks) {
      this.droppedMs += (n - this.maxTicks) * this.tickMs;
      n = this.maxTicks;
    }
    this.accMs = Math.max(0, this.accMs - n * this.tickMs);
    if (this.accMs + EPS >= this.tickMs) { this.droppedMs += this.accMs; this.accMs = 0; }
    return n;
  }

  /**
   * Pads for this frame's ticks. Held controls come from the latest poll on every tick.
   * One-shot `pressed` edges reach exactly one tick: the first one. If the frame runs no
   * tick (display faster than the tick), they wait for the next frame that does.
   * @param {object} pad normalized pad polled this frame (its `pressed` edges already consumed from the router)
   * @param {number} ticks result of advance()
   * @returns {object[]} one pad per tick
   */
  padsFor(pad, ticks) {
    const pressed = { ...(pad.pressed || {}) };
    if (this._edges) for (const k of EDGE_NAMES) pressed[k] = !!(pressed[k] || this._edges[k]);
    if (ticks <= 0) { this._edges = pressed; return []; }
    this._edges = null;
    const quiet = {};
    for (const k of Object.keys(pressed)) quiet[k] = false;
    const out = [];
    for (let i = 0; i < ticks; i++) out.push(i === 0 ? { ...pad, pressed } : { ...pad, pressed: quiet });
    return out;
  }
}
