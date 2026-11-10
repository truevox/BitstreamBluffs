/**
 * OWNER: core-logic engineer. NO Phaser imports. Never emits events.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Detects flips / helicopter spins / air-brake / parachute from per-frame sled state.
 * RunScene calls update() once per rendered frame (after physics) with a SledFrameState.
 *
 * Model: an "air phase" starts on the first frame with grounded=false and ends on the first grounded frame.
 * Rotation deltas (from the unwrapped angleDeg) are accumulated into two buckets per frame: tilt (A/D driven) and
 * heli (arrow-key driven, input.heli != 0). A bucket whose net rotation reaches a full turn (minus
 * FLIP_TOLERANCE_DEG) yields one TrickEvent per completed rotation with the CUMULATIVE count so far.
 * Air phases shorter than minAirtimeMs are bumps: no landing is reported.
 */

/** Rotation counts as a full turn at 360 - tolerance degrees. */
export const FLIP_TOLERANCE_DEG = 20;
/** Air brake / parachute must be held this long in the air to register as a trick. */
export const AIR_BRAKE_MIN_MS = 250;
export const PARACHUTE_MIN_MS = 300;
/** Landing alignment thresholds (|sled angle - ground slope| in degrees). */
export const PERFECT_ANGLE_DEG = 12;
export const GOOD_ANGLE_DEG = 28;
export const SLOPPY_ANGLE_DEG = 55;
/** Impact speed (px/s into the ground). Above HARD = shake worthy; above CRASH = crash regardless of angle. */
export const HARD_IMPACT_PX_S = 520;
export const PERFECT_MAX_IMPACT_PX_S = 900;
export const CRASH_IMPACT_PX_S = 1500;
/** Default minimum airtime for an air phase to count as a jump. */
export const DEFAULT_MIN_AIRTIME_MS = 120;

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
 * @property {number} count         completed rotations so far this air phase (flips/helis; cumulative, 2 = double) or 1.
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
 * @property {number} [rotationDeg]   net rotation over the whole air phase (additive field).
 */

/**
 * @typedef {Object} TrickUpdate
 * @property {TrickEvent[]} tricks   tricks completed THIS frame (usually empty).
 * @property {LandingResult|null} landing  non-null on the frame the sled touches down after being airborne >= minAirtime.
 * @property {boolean} airborne
 * @property {number} airtimeMs      current airtime (0 when grounded)
 * @property {number} rotationDeg    net rotation accumulated this airtime (signed; the final value on the landing frame).
 */

/**
 * Wrap an angle to [-180, 180].
 * @param {number} a degrees
 * @returns {number}
 */
export function wrapAngle(a) {
  let r = (a + 180) % 360;
  if (r < 0) r += 360;
  return r - 180;
}

/**
 * Classify a touchdown. Pure helper (exported for tests / UI).
 * @param {number} angleDiffDeg sled angle minus ground slope, wrapped.
 * @param {number} impactSpeedPxS
 * @returns {{quality:'perfect'|'good'|'sloppy'|'crash', hard:boolean}}
 */
export function classifyLanding(angleDiffDeg, impactSpeedPxS) {
  const a = Math.abs(angleDiffDeg);
  const hard = impactSpeedPxS >= HARD_IMPACT_PX_S;
  let quality;
  if (impactSpeedPxS >= CRASH_IMPACT_PX_S || a > SLOPPY_ANGLE_DEG) quality = 'crash';
  else if (a <= PERFECT_ANGLE_DEG && impactSpeedPxS <= PERFECT_MAX_IMPACT_PX_S) quality = 'perfect';
  else if (a <= GOOD_ANGLE_DEG) quality = 'good';
  else quality = 'sloppy';
  return { quality, hard };
}

export class TrickTracker {
  /** @param {{minAirtimeMs?:number}} [options] airtime below this is a bump, not a jump (default 120). */
  constructor(options = {}) {
    this.options = options;
    this.minAirtimeMs = options.minAirtimeMs != null ? options.minAirtimeMs : DEFAULT_MIN_AIRTIME_MS;
    this._noTricks = [];
    this.reset();
  }

  /**
   * @param {SledFrameState} state
   * @returns {TrickUpdate}
   */
  update(state) {
    const grounded = !!state.grounded;
    const t = state.timeMs || 0;
    const dt = state.dtMs > 0 ? state.dtMs : 0;
    const angle = Number.isFinite(state.angleDeg) ? state.angleDeg : this._prevAngle || 0;
    const input = state.input || NO_INPUT;
    const tricks = [];

    if (state.crashed) {
      let landing = null;
      if (this._air && t - this._airStart >= this.minAirtimeMs) {
        landing = this._makeLanding(state, angle, t, true);
      }
      this.reset();
      this._prevAngle = angle;
      this._havePrev = true;
      return { tricks, landing, airborne: false, airtimeMs: 0, rotationDeg: 0 };
    }

    if (!grounded) {
      if (!this._air) {
        this._air = true;
        this._airStart = t - dt;
        this._tiltNet = 0;
        this._heliNet = 0;
        this._tiltDone = 0;
        this._heliDone = 0;
        this._brakeMs = 0;
        this._chuteMs = 0;
        this._brakeDone = false;
        this._chuteDone = false;
        if (!this._havePrev) this._prevAngle = angle;
      }
      const airtime = t - this._airStart;
      const delta = angle - this._prevAngle;
      if (input.heli) this._heliNet += delta;
      else this._tiltNet += delta;

      this._emitRotations(tricks, this._tiltNet, '_tiltDone', 'backflip', 'frontflip', airtime);
      this._emitRotations(tricks, this._heliNet, '_heliDone', 'helicopterCCW', 'helicopterCW', airtime);

      if (input.airBrake) this._brakeMs += dt;
      if (input.parachute) this._chuteMs += dt;
      if (!this._brakeDone && this._brakeMs >= AIR_BRAKE_MIN_MS) {
        this._brakeDone = true;
        tricks.push({ type: 'airBrake', count: 1, rotationDeg: 0, airtimeMs: airtime });
      }
      if (!this._chuteDone && this._chuteMs >= PARACHUTE_MIN_MS) {
        this._chuteDone = true;
        tricks.push({ type: 'parachute', count: 1, rotationDeg: 0, airtimeMs: airtime });
      }
      this._prevAngle = angle;
      this._havePrev = true;
      return { tricks, landing: null, airborne: true, airtimeMs: airtime, rotationDeg: this._tiltNet + this._heliNet };
    }

    // grounded
    let landing = null;
    let rot = 0;
    if (this._air) {
      const airtime = t - this._airStart;
      const delta = angle - this._prevAngle;
      if (input.heli) this._heliNet += delta;
      else this._tiltNet += delta;
      rot = this._tiltNet + this._heliNet;
      if (airtime >= this.minAirtimeMs) {
        // a rotation completed on the touchdown frame still counts
        this._emitRotations(tricks, this._tiltNet, '_tiltDone', 'backflip', 'frontflip', airtime);
        this._emitRotations(tricks, this._heliNet, '_heliDone', 'helicopterCCW', 'helicopterCW', airtime);
        landing = this._makeLanding(state, angle, t, false);
        landing.rotationDeg = rot;
      } else {
        tricks.length = 0;
      }
      this._air = false;
    }
    this._prevAngle = angle;
    this._havePrev = true;
    return { tricks, landing, airborne: false, airtimeMs: 0, rotationDeg: rot };
  }

  /** Forget in-progress air state (after respawn / reset). @returns {void} */
  reset() {
    this._air = false;
    this._airStart = 0;
    this._tiltNet = 0;
    this._heliNet = 0;
    this._tiltDone = 0;
    this._heliDone = 0;
    this._brakeMs = 0;
    this._chuteMs = 0;
    this._brakeDone = false;
    this._chuteDone = false;
    this._prevAngle = 0;
    this._havePrev = false;
  }

  _emitRotations(out, net, doneKey, ccwType, cwType, airtime) {
    const turns = Math.floor((Math.abs(net) + FLIP_TOLERANCE_DEG) / 360);
    let done = this[doneKey];
    // direction flip resets nothing: count is of the current net, so re-spinning the other way re-earns nothing
    // until net exceeds what was already credited.
    while (done < turns) {
      done++;
      out.push({ type: net < 0 ? ccwType : cwType, count: done, rotationDeg: Math.abs(net), airtimeMs: airtime });
    }
    this[doneKey] = done;
  }

  _makeLanding(state, angle, t, crashFrame) {
    const ground = Number.isFinite(state.groundAngleDeg) ? state.groundAngleDeg : 0;
    const diff = wrapAngle(angle - ground);
    const th = (ground * Math.PI) / 180;
    const vx = state.vx || 0;
    const vy = state.vy || 0;
    const impact = Math.max(0, -vx * Math.sin(th) + vy * Math.cos(th));
    let { quality, hard } = classifyLanding(diff, impact);
    if (crashFrame) {
      quality = 'crash';
      hard = true;
    }
    return {
      quality,
      angleDeg: diff,
      impactSpeedPxS: impact,
      airtimeMs: t - this._airStart,
      hard,
      rotationDeg: this._tiltNet + this._heliNet,
    };
  }
}

const NO_INPUT = Object.freeze({ heli: 0, airBrake: false, parachute: false });
