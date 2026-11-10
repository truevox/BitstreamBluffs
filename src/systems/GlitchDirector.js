/**
 * OWNER: input/audio/glitch engineer. NO Phaser imports (pure, Jest-testable). Never emits events.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Seed-deterministic schedule of glitch events. The schedule depends ONLY on (seed, run-time, distance-based
 * frequency ramp) - never on wall clock or Math.random - so identical seeds glitch identically.
 * Gap between events: uniform in GLITCH.earlyGapMs early on, blending to GLITCH.lateGapMs as distance goes from
 * half of TERRAIN.difficultyRampStartM to the full value (so from 1000 m on the gaps are 3-6 s).
 * Duration 50-200 ms (GLITCH.durationMs). RunScene owns the instance, calls update() each frame and emits
 * EVT.GLITCH_START / EVT.GLITCH_END from the result (payload: id, kind, durationMs, intensity of the GlitchEvent).
 *
 * Determinism detail: every event consumes exactly five random numbers in a fixed order (gap, kind, duration,
 * intensity, pattern). Only the gap is later scaled by the distance blend, so with a fixed distance the schedule is
 * identical for a seed no matter how often update() is called.
 * The event id carries a seed-derived pattern tag (`g12-3fa9`) which GlitchPipeline uses for block layout.
 */
import { Rng } from './Rng.js';
import { GLITCH, TERRAIN } from '../constants.js';

/**
 * @typedef {Object} GlitchEvent
 * @property {string} id         e.g. 'g3-1a2b' (index + 4 hex digits of seed-derived pattern).
 * @property {'rgbSplit'|'scanlineWobble'|'stutter'|'dropout'|'static'} kind
 * @property {number} startMs    run-time ms when it starts.
 * @property {number} durationMs
 * @property {number} intensity  0..1
 */

/**
 * Blend factor 0 (early range) .. 1 (late range) for a distance.
 * @param {number} distanceM
 * @returns {number}
 */
export function glitchRamp(distanceM) {
  const r = TERRAIN.difficultyRampStartM;
  const t = (distanceM - r * 0.5) / (r * 0.5);
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/**
 * Gap range in ms for a distance.
 * @param {number} distanceM
 * @returns {[number, number]}
 */
export function glitchGapRange(distanceM) {
  const f = glitchRamp(distanceM);
  const e = GLITCH.earlyGapMs;
  const l = GLITCH.lateGapMs;
  return [e[0] + (l[0] - e[0]) * f, e[1] + (l[1] - e[1]) * f];
}

export class GlitchDirector {
  /** @param {{seed:string}} options */
  constructor(options) {
    this.seed = String(options && options.seed != null ? options.seed : '');
    this.reset();
  }

  /**
   * Draw the next event after `afterMs`.
   * @param {number} afterMs end time of the previous event (0 for the first).
   * @param {number} distanceM
   * @returns {GlitchEvent}
   * @private
   */
  _generate(afterMs, distanceM) {
    const rng = this.rng;
    const uGap = rng.next();
    const kind = GLITCH.kinds[Math.floor(rng.next() * GLITCH.kinds.length)];
    const uDur = rng.next();
    const uInt = rng.next();
    const pattern = Math.floor(rng.next() * 0xffff);
    const [lo, hi] = glitchGapRange(distanceM);
    const f = glitchRamp(distanceM);
    const d = GLITCH.durationMs;
    const n = this._count++;
    return {
      id: `g${n}-${pattern.toString(16).padStart(4, '0')}`,
      kind,
      startMs: Math.round(afterMs + lo + (hi - lo) * uGap),
      durationMs: Math.round(d[0] + (d[1] - d[0]) * uDur),
      intensity: Math.round((0.4 + 0.6 * uInt * (0.75 + 0.25 * f)) * 1000) / 1000,
    };
  }

  /**
   * Advance the schedule.
   * @param {number} runTimeMs run time excluding pauses.
   * @param {number} distanceM furthest distance so far (drives the frequency ramp).
   * @returns {{started: GlitchEvent[], ended: GlitchEvent[], active: GlitchEvent|null}}
   *          started/ended = transitions since the previous call (usually empty).
   */
  update(runTimeMs, distanceM) {
    const started = [];
    const ended = [];
    let guard = 0;
    while (guard++ < 64) {
      if (this.active && runTimeMs >= this.active.startMs + this.active.durationMs) {
        ended.push(this.active);
        this.active = null;
        continue;
      }
      if (!this.active && runTimeMs >= this.next.startMs) {
        const ev = this.next;
        this.active = ev;
        started.push(ev);
        this.next = this._generate(ev.startMs + ev.durationMs, distanceM);
        continue;
      }
      break;
    }
    return { started, ended, active: this.active };
  }

  /**
   * First `count` events of this seed's schedule at a fixed distance (does not touch live state). Test helper.
   * @param {number} count
   * @param {number} [distanceM=0]
   * @returns {GlitchEvent[]}
   */
  preview(count, distanceM = 0) {
    const d = new GlitchDirector({ seed: this.seed });
    const out = [d.next];
    while (out.length < count) {
      const last = out[out.length - 1];
      out.push(d._generate(last.startMs + last.durationMs, distanceM));
    }
    return out.slice(0, count);
  }

  /** Restart schedule from t=0 with the same seed. @returns {void} */
  reset() {
    this.rng = new Rng(this.seed).fork('glitch');
    this._count = 0;
    /** @type {GlitchEvent|null} */
    this.active = null;
    /** @type {GlitchEvent} */
    this.next = this._generate(0, 0);
  }
}
