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
 * loop. Chosen by Marvin (2026-11-20); play-test pending: see docs/issue-59-fixed-tick.md.
 */

import { deriveHeld } from './PadDerive.js';

export const SIM_TICK_HZ = 120;
/**
 * Recorder-side input capture policy (Replay Contract v1 `info.inputCapture.edgeAssignment`, #152):
 * live input is assigned to ticks by event timestamp window (issue #115). Informational; replays ignore it.
 */
export const INPUT_EDGE_ASSIGNMENT = 'timestamp-window';
export const SIM_TICK_MS = 1000 / SIM_TICK_HZ;
/** Same ceiling as the old 50 ms frame clamp: never more than this many ticks per frame. */
export const SIM_MAX_TICKS_PER_FRAME = Math.ceil(50 / SIM_TICK_MS - 1e-9);
// Float slack so 3 x 33.333.. ms frames are exactly 12 ticks, never 11 then 13.
const EPS = 1e-6;
const EDGE_NAMES = ['hop', 'reset', 'pause', 'airBrake', 'parachute', 'confirm'];
const EDGE_SET = new Set(EDGE_NAMES);

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
    /** Timeline carried over 0-tick frames (issue #115). */
    this._timeline = null;
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
   * Pads for this frame's ticks. Called right after advance(), with this frame's polled pad.
   *
   * Without `opts.timeline` (tape replay tools, probes, legacy callers): held controls come from the
   * latest poll on every tick; one-shot `pressed` edges reach exactly one tick, the first one; if the
   * frame runs no tick they wait for the next frame that does.
   *
   * With `opts.timeline` and `opts.frameTime` (issue #115, live play): every timestamped input change
   * is given to the tick whose real-time window contains it. This frame's ticks cover the windows
   * ending at `frameTime - accMs - (ticks-1-i) * tickMs`. A change is clamped into THIS frame's ticks:
   * older than the first window (stall, dropped backlog, untimed gamepad/touch/blur) -> first tick, as
   * before; newer than the last window (the sub-tick remainder) -> last tick, so nothing is ever shown
   * a frame later than before and no tick that already ran is rewritten. Changes keep arrival order.
   * A button that went down inside a tick's window is held on that tick even if it was released
   * before the window closed (a tap is at least one tick). Edges are rebuilt from the rises.
   * A 0-tick frame carries its timeline forward intact (held taps included).
   *
   * @param {object} pad normalized pad polled this frame (its `pressed` edges already consumed from the router)
   * @param {number} ticks result of advance()
   * @param {{frameTime?:number, timeline?:{base:Object<string,boolean>,events:{t:number|null,name:string,down:boolean}[],analog:number}|null,
   *   normalize?:(raw:object)=>object}} [opts] frameTime = rAF time of this frame on the event.timeStamp clock;
   *   timeline = InputRouter.poll().timeline; normalize = raw VirtualPadState -> tick pad (RunScene.normalizePad)
   * @returns {object[]} one pad per tick
   */
  padsFor(pad, ticks, opts) {
    const timeline = opts && opts.timeline;
    if (timeline && Array.isArray(timeline.events)) return this._timedPads(pad, ticks, opts);
    const pressed = { ...(pad.pressed || {}) };
    if (this._timeline) {
      // rises carried by a timed-path 0-tick frame (router just disabled): keep their edges
      const h = { ...this._timeline.base };
      for (const e of this._timeline.events) { if (e.down && !h[e.name] && EDGE_SET.has(e.name)) pressed[e.name] = true; h[e.name] = !!e.down; }
      this._timeline = null;
    }
    if (this._edges) for (const k of EDGE_NAMES) pressed[k] = !!(pressed[k] || this._edges[k]);
    if (ticks <= 0) { this._edges = pressed; return []; }
    this._edges = null;
    const quiet = {};
    for (const k of Object.keys(pressed)) quiet[k] = false;
    const out = [];
    for (let i = 0; i < ticks; i++) out.push(i === 0 ? { ...pad, pressed } : { ...pad, pressed: quiet });
    return out;
  }

  /** @private issue #115 scheduler; see padsFor. */
  _timedPads(pad, ticks, opts) {
    const tl = opts.timeline;
    const carried = this._timeline;
    let merged = tl;
    if (carried) {
      // A poll consumed between the two (e.g. a pause frame) must not leave stale holds: bridge any
      // difference between the carried end state and this poll's base with untimed changes.
      const end = { ...carried.base };
      for (const e of carried.events) end[e.name] = !!e.down;
      const bridge = [];
      for (const n of Object.keys(tl.base || {})) if (!!end[n] !== !!tl.base[n]) bridge.push({ t: null, name: n, down: !!tl.base[n] });
      merged = { base: carried.base, events: carried.events.concat(bridge, tl.events), analog: tl.analog };
    }
    if (this._edges) {
      // edges carried by a legacy-path 0-tick frame (router just re-enabled): keep them as untimed rises
      const lift = [];
      for (const k of EDGE_NAMES) if (this._edges[k] && !merged.base[k]) lift.push({ t: null, name: k, down: true }, { t: null, name: k, down: false });
      if (lift.length) merged = { ...merged, events: lift.concat(merged.events) };
    }
    this._edges = null;
    if (ticks <= 0) { this._timeline = merged; return []; }
    this._timeline = null;
    const normalize = typeof opts.normalize === 'function' ? opts.normalize : (raw) => raw;
    const T = Number(opts.frameTime);
    const timed = Number.isFinite(T);
    const lastEnd = T - this.accMs;
    const tickOf = (t) => {
      if (!timed || t == null) return 0;
      // smallest i with t <= end_i, end_i = lastEnd - (ticks - 1 - i) * tickMs
      const i = Math.ceil((t - lastEnd) / this.tickMs - EPS) + ticks - 1;
      return i < 0 ? 0 : i >= ticks ? ticks - 1 : i;
    };
    const held = { ...merged.base };
    const analog = Number.isFinite(merged.analog) ? merged.analog : 0;
    // Schedule every change. Order is kept PER BUTTON (the journal records aggregate changes per name):
    // a change never lands before an earlier change of the same button, but an untimed gamepad/touch
    // change is never pushed behind a key event on another button (it keeps the frame's first tick).
    const buckets = Array.from({ length: ticks }, () => []);
    const floor = {};
    for (const ev of merged.events) {
      const at = Math.max(floor[ev.name] || 0, tickOf(ev.t));
      floor[ev.name] = at;
      buckets[at].push(ev);
    }
    const out = [];
    for (let i = 0; i < ticks; i++) {
      const rose = [];
      const pressed = { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false };
      for (const ev of buckets[i]) {
        if (ev.down && !held[ev.name]) {
          rose.push(ev.name);
          if (EDGE_SET.has(ev.name)) pressed[ev.name] = true;
        }
        held[ev.name] = !!ev.down;
      }
      let view = held;
      if (rose.length) { view = { ...held }; for (const n of rose) view[n] = true; }
      const raw = { ...deriveHeld(view, analog), pressed, lastSource: pad.lastSource };
      out.push(normalize(raw));
    }
    return out;
  }
}
