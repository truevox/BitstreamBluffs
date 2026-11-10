/**
 * OWNER: core-logic engineer. NO Phaser imports. Never emits events.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Detects flips / helicopter spins / air-brake / parachute from per-frame sled state.
 * RunScene calls update() once per rendered frame (after physics) with a SledFrameState.
 */

/**
 * Per-frame state RunScene builds from the Matter body + input. UNITS: px, px/s, degrees, ms.
 * @typedef {Object} SledFrameState
 * @property {number} timeMs        run time (excludes pause), monotonically increasing.
 * @property {number} dtMs          ms since previous update (>0).
 * @property {number} x             world px.
 * @property {number} y             world px.
 * @property {number} vx            px/s.
 * @property {number} vy            px/s (down positive).
 * @property {number} angleDeg      CONTINUOUS (unwrapped, may exceed +-360) sled rotation, clockwise positive.
 *                                  Must be unwrapped by the caller so flips can be counted (e.g. accumulate shortest delta).
 * @property {number} angularVelDegS deg/s, clockwise positive.
 * @property {boolean} grounded     sled has wheel/runner contact with terrain this frame.
 * @property {number} groundAngleDeg  slope of terrain under/near sled in degrees (clockwise positive = descending right);
 *                                  used for landing alignment. Use last known value while airborne.
 * @property {{heli:-1|0|1, airBrake:boolean, parachute:boolean}} input  heli: -1 = CCW (left arrow), +1 = CW (right arrow).
 * @property {boolean} crashed      true on the frame a crash is detected (tracker discards airborne tricks).
 */

/**
 * @typedef {Object} TrickEvent
 * @property {'backflip'|'frontflip'|'helicopterCCW'|'helicopterCW'|'airBrake'|'parachute'} type
 *   backflip = counter-clockwise body rotation (A / tilt back), frontflip = clockwise; helicopter* only when
 *   rotation was driven by the arrow keys (input.heli != 0), so rotation source separates the two families.
 * @property {number} count         completed rotations (flips/helis) or 1.
 * @property {number} rotationDeg   total rotation covered (abs).
 * @property {number} airtimeMs     airtime at the moment of completion.
 */

/**
 * @typedef {Object} LandingResult
 * @property {'perfect'|'good'|'sloppy'|'crash'} quality
 * @property {number} angleDeg        sled angle minus groundAngleDeg, wrapped to [-180,180].
 * @property {number} impactSpeedPxS  speed component into the ground at touchdown.
 * @property {number} airtimeMs
 * @property {boolean} hard           hard impact (screen shake worthy).
 */

/**
 * @typedef {Object} TrickUpdate
 * @property {TrickEvent[]} tricks   tricks completed THIS frame (usually empty).
 * @property {LandingResult|null} landing  non-null on the frame the sled touches down after being airborne >= minAirtime.
 * @property {boolean} airborne
 * @property {number} airtimeMs      current airtime (0 when grounded).
 * @property {number} rotationDeg    net rotation accumulated this airtime (signed).
 */

export class TrickTracker {
  /** @param {{minAirtimeMs?:number}} [options] airtime below this is a bump, not a jump (default 120). */
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * @param {SledFrameState} state
   * @returns {TrickUpdate}
   */
  update(state) {
    return { tricks: [], landing: null, airborne: !state.grounded, airtimeMs: 0, rotationDeg: 0 };
  }

  /** Forget in-progress air state (after respawn / reset). @returns {void} */
  reset() {}
}
