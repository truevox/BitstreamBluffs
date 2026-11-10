/**
 * OWNER: input/audio/glitch engineer. NO Phaser imports (pure, Jest-testable). Never emits events.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Seed-deterministic schedule of glitch events. The schedule depends ONLY on (seed, run-time, distance-based
 * frequency ramp) - never on wall clock or Math.random - so identical seeds glitch identically.
 * Gap between events: uniform in GLITCH.earlyGapMs early on, blending to GLITCH.lateGapMs past
 * TERRAIN.difficultyRampStartM. Duration 50-200 ms (GLITCH.durationMs). RunScene owns the instance, calls
 * update() each frame and emits EVT.GLITCH_START / EVT.GLITCH_END from the result.
 */
import { Rng } from './Rng.js';

/**
 * @typedef {Object} GlitchEvent
 * @property {string} id
 * @property {'rgbSplit'|'scanlineWobble'|'stutter'|'dropout'|'static'} kind
 * @property {number} startMs    run-time ms when it starts.
 * @property {number} durationMs
 * @property {number} intensity  0..1
 */

export class GlitchDirector {
  /** @param {{seed:string}} options */
  constructor(options) {
    this.rng = new Rng(options.seed).fork('glitch');
  }

  /**
   * Advance the schedule.
   * @param {number} runTimeMs run time excluding pauses.
   * @param {number} distanceM furthest distance so far (drives the frequency ramp).
   * @returns {{started: GlitchEvent[], ended: GlitchEvent[], active: GlitchEvent|null}}
   *          started/ended = transitions since the previous call (usually empty).
   */
  update(runTimeMs, distanceM) {
    return { started: [], ended: [], active: null };
  }

  /** Restart schedule from t=0 with the same seed. @returns {void} */
  reset() {}
}
