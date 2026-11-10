/**
 * OWNER: input/audio/glitch engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * VirtualPad = the single normalized input state. Keyboard, gamepad and touch overlay all write into it
 * (via InputRouter); everything else only READS it through InputRouter.poll().
 */

/**
 * Normalized control state (design doc 4.1; where 4.1 and 12 disagree 4.1 wins: S = brake, A+D together = tuck).
 * Sign convention: tilt < 0 = tilt back = counter-clockwise (A), tilt > 0 = tilt forward = clockwise (D).
 * @typedef {Object} VirtualPadState
 * @property {boolean} push        W / right trigger / touch PUSH. Held.
 * @property {number}  tilt        -1..1 analog (keyboard: A=-1, D=+1, both = 0). Gamepad left stick X.
 * @property {boolean} tuck        A and D held together / gamepad tuck button / touch TUCK. Held.
 * @property {boolean} brake       S. Held.
 * @property {boolean} hop         Space. Held (use `pressed.hop` for the edge).
 * @property {boolean} reset       Shift. Held (use `pressed.reset`).
 * @property {-1|0|1}  heli        Left arrow = -1 (CCW), right arrow = +1 (CW), both/none = 0.
 * @property {boolean} airBrake    Up arrow. Held.
 * @property {boolean} parachute   Down arrow. Held (use `pressed.parachute` to trigger the 0.8 s stall).
 * @property {boolean} pause       Esc / Start. Held.
 * @property {{hop:boolean,reset:boolean,pause:boolean,airBrake:boolean,parachute:boolean,confirm:boolean}} pressed
 *           Edge flags: true for exactly ONE poll() after a press, then cleared (consumed by poll()).
 * @property {'keyboard'|'gamepad'|'touch'} lastSource  device that produced the most recent input.
 */

/** @returns {VirtualPadState} all-neutral state. */
export function emptyPadState() {
  return {
    push: false, tilt: 0, tuck: false, brake: false, hop: false, reset: false, heli: 0,
    airBrake: false, parachute: false, pause: false,
    pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false },
    lastSource: 'keyboard',
  };
}

export class VirtualPad {
  constructor() {
    /** @type {VirtualPadState} */
    this.state = emptyPadState();
  }

  /**
   * Set a digital button. Names are the boolean fields of VirtualPadState plus 'tiltBack'/'tiltForward'/
   * 'heliLeft'/'heliRight' raw keys (the pad derives tilt/tuck/heli from them).
   * @param {string} name
   * @param {boolean} down
   * @param {'keyboard'|'gamepad'|'touch'} source
   * @returns {void}
   */
  setButton(name, down, source) {}

  /**
   * Set analog tilt (gamepad stick). Overrides keyboard tilt while |value| > deadzone 0.15.
   * @param {number} value -1..1
   * @returns {void}
   */
  setTilt(value) {}

  /**
   * Snapshot current state and CLEAR the one-shot `pressed` edges.
   * @returns {VirtualPadState} a copy (safe to keep).
   */
  poll() {
    return { ...this.state, pressed: { ...this.state.pressed } };
  }

  /**
   * Create/show the DOM touch overlay (buttons mirroring WASD/arrows) inside `parent`. No-op on non-touch
   * devices when settings.touchOverlay === 'auto'.
   * @param {HTMLElement} parent usually game.canvas.parentElement.
   * @param {Pick<import('./SaveStore.js').Settings,'touchOverlay'|'touchRotate90'>} options
   * @returns {void}
   */
  mountTouchOverlay(parent, options) {}

  /** Remove overlay and listeners. @returns {void} */
  destroy() {}
}
