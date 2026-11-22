/**
 * OWNER: input/audio/glitch engineer. Pure logic: no DOM, no Phaser (issue #115).
 *
 * Derivation of the held fields of a VirtualPadState from raw button holds. Shared by VirtualPad (live
 * state) and SimClock.padsFor (per-tick pads rebuilt from a timestamped input timeline), so SimClock does
 * not depend on VirtualPad / TouchOverlay.
 */

/**
 * Held fields of a VirtualPadState derived from raw button holds (issue #115: shared by the live pad and by
 * SimClock when it rebuilds a per-tick pad from a timeline).
 * @param {Object<string,boolean>} h raw held name -> down
 * @param {number} analog dead-zoned analog tilt (0 = none)
 * @returns {object}
 */
export function deriveHeld(h, analog = 0) {
  const back = !!h.tiltBack;
  const fwd = !!h.tiltForward;
  const digital = back && fwd ? 0 : fwd ? 1 : back ? -1 : 0;
  return {
    push: !!h.push, brake: !!h.brake, hop: !!h.hop, reset: !!h.reset, airBrake: !!h.airBrake,
    parachute: !!h.parachute, divebomb: !!h.divebomb, corkscrew: !!h.corkscrew, pause: !!h.pause,
    tuck: !!h.tuck || (back && fwd),
    tilt: analog !== 0 ? analog : digital,
    heli: /** @type {-1|0|1} */ ((h.heliRight ? 1 : 0) - (h.heliLeft ? 1 : 0)),
  };
}

/**
 * A DOM event's timeStamp if it is on the performance.now() clock (the clock of Phaser's rAF time), else
 * null. Legacy epoch timestamps, synthetic events and jsdom's Date.now() stamps are rejected, and an
 * untimed change keeps the pre-#115 schedule (first tick of the polling frame).
 * @param {number} t event.timeStamp
 * @param {number} now current performance.now()
 * @returns {number|null}
 */
export function eventTimeOnClock(t, now) {
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(now)) return null;
  return t <= now + 1000 && t >= now - 60000 ? t : null;
}

/** performance.now() where available (browsers, jsdom), else Date.now(). @returns {number} */
export const perfNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
