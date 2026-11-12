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

import { SCORING } from '../constants.js';

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
/**
 * A helicopter spin phase counts as unfinished only when the air phase made at least this much spin (a quarter turn)
 * or the spin key was still held at touchdown. Less than that with the key released is coast / a nudge, not a trick.
 */
export const MID_SPIN_MIN_DEG = 90;
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
 * @property {number} [impactVx]    OPTIONAL velocity (px/s) the sled had going INTO the touchdown. Physics engines resolve the contact
 * @property {number} [impactVy]    before the frame is observed, so vx/vy on the landing frame have lost their ground-normal part and
 *                                  would grade every landing as soft; when both are finite they are used for the impact speed.
 * @property {number} angleDeg      CONTINUOUS (unwrapped, may exceed +-360) sled rotation, clockwise positive.
 *                                  Must be unwrapped by the caller so flips can be counted (e.g. accumulate shortest delta).
 * @property {number} angularVelDegS deg/s, clockwise positive.
 * @property {boolean} grounded     sled has wheel/runner contact with terrain this frame.
 * @property {number} groundAngleDeg  slope of terrain under/near sled in degrees (clockwise positive = descending right);
 *                                  used for landing alignment. Use last known value while airborne.
 * @property {{heli:-1|0|1, airBrake:boolean, parachute:boolean}} input  heli: -1 = CCW (left arrow), +1 = CW (right arrow).
 * @property {number} [heliDeg]     OPTIONAL continuous (unwrapped) helicopter spin phase of the sled drawing, clockwise positive.
 *                                  The helicopter spin is a visual rotation about the sled's vertical axis (the physics body does
 *                                  not rotate), so when this is provided helicopter turns are counted from it, whatever the
 *                                  arrow-key state, and body rotation always counts as flips. When absent the legacy rule applies
 *                                  (body rotation while input.heli != 0 counts as helicopter).
 * @property {boolean|number} [midSpin] OPTIONAL helicopter state at touchdown, used to grade the landing (see isMidSpin).
 *                                  true = rider was mid-spin; a number = helicopter phase in degrees (any unwrapped value,
 *                                  e.g. heliDeg), mid-spin when further than SCORING.midSpinToleranceDeg (60) from a whole turn.
 *                                  A numeric phase is ignored (no penalty) when the spin key was released before touchdown and
 *                                  less than MID_SPIN_MIN_DEG of helicopter spin was made in this air phase (visual coast / a
 *                                  nudge). `true` is always honoured. Absent/false = no penalty (legacy behaviour).
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
 * @property {boolean} [midSpin]      additive: true when the grade was dropped one level for an incomplete helicopter.
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
 * Is the helicopter spin incomplete at touchdown? Pure helper.
 * @param {boolean|number|undefined|null} spin true/false, or a helicopter phase in degrees (unwrapped, any sign):
 *   incomplete when its distance to the nearest whole turn exceeds SCORING.midSpinToleranceDeg (60 deg).
 * @returns {boolean}
 */
export function isMidSpin(spin) {
  if (spin === true) return true;
  if (typeof spin !== 'number' || !Number.isFinite(spin)) return false;
  const r = Math.abs(spin) % 360;
  return Math.min(r, 360 - r) > SCORING.midSpinToleranceDeg;
}

/**
 * Classify a touchdown. Pure helper (exported for tests / UI).
 * @param {number} angleDiffDeg sled angle minus ground slope, wrapped.
 * @param {number} impactSpeedPxS
 * @param {boolean|number} [midSpin] additive: incomplete helicopter (see isMidSpin). Drops the grade one level
 *   (perfect->good, good->sloppy, sloppy stays sloppy); never turns a landing into a crash and never rescues one.
 * @returns {{quality:'perfect'|'good'|'sloppy'|'crash', hard:boolean}}
 */
export function classifyLanding(angleDiffDeg, impactSpeedPxS, midSpin) {
  const a = Math.abs(angleDiffDeg);
  const hard = impactSpeedPxS >= HARD_IMPACT_PX_S;
  let quality;
  if (impactSpeedPxS >= CRASH_IMPACT_PX_S || a > SLOPPY_ANGLE_DEG) quality = 'crash';
  else if (a <= PERFECT_ANGLE_DEG && impactSpeedPxS <= PERFECT_MAX_IMPACT_PX_S) quality = 'perfect';
  else if (a <= GOOD_ANGLE_DEG) quality = 'good';
  else quality = 'sloppy';
  if (isMidSpin(midSpin)) {
    if (quality === 'perfect') quality = 'good';
    else if (quality === 'good') quality = 'sloppy';
  }
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
    const heli = Number.isFinite(state.heliDeg) ? state.heliDeg : null;
    const tricks = [];

    if (state.crashed) {
      let landing = null;
      if (this._air && t - this._airStart >= this.minAirtimeMs) {
        landing = this._makeLanding(state, angle, t, true);
      }
      this.reset();
      this._prevAngle = angle;
      this._prevHeli = heli;
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
        this._heliMax = 0;
        this._heliHeld = false;
        if (!this._havePrev) this._prevAngle = angle;
      }
      const airtime = t - this._airStart;
      this._accumulate(angle, heli, input);
      this._heliMax = Math.max(this._heliMax, Math.abs(this._heliNet));
      this._heliHeld = !!input.heli;

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
      this._prevHeli = heli;
      this._havePrev = true;
      return { tricks, landing: null, airborne: true, airtimeMs: airtime, rotationDeg: this._tiltNet + this._heliNet };
    }

    // grounded
    let landing = null;
    let rot = 0;
    if (this._air) {
      const airtime = t - this._airStart;
      this._accumulate(angle, heli, input);
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
    this._prevHeli = heli;
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
    this._heliMax = 0;
    this._heliHeld = false;
    this._prevAngle = 0;
    this._prevHeli = null;
    this._havePrev = false;
  }

  /** Add this frame's rotation to the flip / helicopter buckets (see SledFrameState.heliDeg). */
  _accumulate(angle, heli, input) {
    const delta = angle - this._prevAngle;
    if (heli != null) {
      this._tiltNet += delta;
      let hd = this._prevHeli != null ? heli - this._prevHeli : 0;
      if (Math.abs(hd) > 720) hd = 0; // the drawing's phase was re-based
      this._heliNet += hd;
    } else if (input.heli) this._heliNet += delta;
    else this._tiltNet += delta;
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
    // a crash frame is not a touchdown (the sled may be mid-air, e.g. a hazard hit): use its live velocity
    const pre = !crashFrame && Number.isFinite(state.impactVx) && Number.isFinite(state.impactVy);
    const vx = (pre ? state.impactVx : state.vx) || 0;
    const vy = (pre ? state.impactVy : state.vy) || 0;
    const impact = Math.max(0, -vx * Math.sin(th) + vy * Math.cos(th));
    // residual visual coast / a key nudge is not an unfinished spin: needs a real spin attempt or the key still down
    // _heliMax is only updated in the airborne branch, so fold in the touchdown frame's own spin
    const spunDeg = Math.max(this._heliMax, Math.abs(this._heliNet));
    const coast = typeof state.midSpin === 'number' && !this._heliHeld && spunDeg < MID_SPIN_MIN_DEG;
    const midSpin = !coast && isMidSpin(state.midSpin);
    let { quality, hard } = classifyLanding(diff, impact, midSpin);
    // report the penalty only when it actually lowered a clean grade (a sloppy or crash grade has nothing to lose)
    const base = classifyLanding(diff, impact, false).quality;
    const penalised = midSpin && (base === 'perfect' || base === 'good') && quality !== base;
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
      midSpin: penalised && !crashFrame,
    };
  }
}

const NO_INPUT = Object.freeze({ heli: 0, airBrake: false, parachute: false });
