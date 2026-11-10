/**
 * OWNER: input/audio/glitch engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * VirtualPad = the single normalized input state. Keyboard, gamepad and touch overlay all write into it
 * (via InputRouter); everything else only READS it through InputRouter.poll().
 * Pure DOM/logic: no Phaser import (Jest-testable under jsdom).
 */
import { TouchOverlay } from './TouchOverlay.js';

/** Analog dead-zone (stick / device tilt). */
export const ANALOG_DEADZONE = 0.15;

const EDGE_NAMES = ['hop', 'reset', 'pause', 'airBrake', 'parachute', 'confirm'];
const HELD_NAMES = [
  'push', 'tuck', 'brake', 'hop', 'reset', 'airBrake', 'parachute', 'pause', 'confirm',
  'tiltBack', 'tiltForward', 'heliLeft', 'heliRight',
];


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
    /** name -> set of sources currently holding it (so keyboard release never cancels a touch hold). */
    this.held = {};
    for (const n of HELD_NAMES) this.held[n] = new Set();
    /** analog source -> raw value. @type {Object<string,number>} */
    this.analog = {};
    /** @type {TouchOverlay|null} */
    this.overlay = null;
  }

  /**
   * Set a digital button. Names are the boolean fields of VirtualPadState plus 'tiltBack'/'tiltForward'/
   * 'heliLeft'/'heliRight' raw keys (the pad derives tilt/tuck/heli from them) and 'confirm' (edge only).
   * Unknown names are ignored. Each source is tracked separately.
   * @param {string} name
   * @param {boolean} down
   * @param {'keyboard'|'gamepad'|'touch'} source
   * @returns {void}
   */
  setButton(name, down, source) {
    const set = this.held[name];
    if (!set) return;
    const src = source || 'keyboard';
    const was = set.size > 0;
    if (down) set.add(src);
    else set.delete(src);
    const now = set.size > 0;
    if (down) this.state.lastSource = src;
    if (now && !was && EDGE_NAMES.includes(name)) this.state.pressed[name] = true;
    this._recompute();
  }

  /**
   * Set analog tilt (gamepad stick, device tilt). Overrides digital tilt while |value| > deadzone 0.15.
   * Several analog sources may coexist; the one with the largest magnitude wins.
   * @param {number} value -1..1
   * @param {string} [source='gamepad'] analog source key ('gamepad' | 'device').
   * @returns {void}
   */
  setTilt(value, source = 'gamepad') {
    const v = Math.max(-1, Math.min(1, Number(value) || 0));
    if (this.analog[source] === v) return;
    this.analog[source] = v;
    if (Math.abs(v) > ANALOG_DEADZONE) this.state.lastSource = source === 'device' ? 'touch' : 'gamepad';
    this._recompute();
  }

  /** @private */
  _recompute() {
    const s = this.state;
    const h = (n) => this.held[n].size > 0;
    s.push = h('push');
    s.brake = h('brake');
    s.hop = h('hop');
    s.reset = h('reset');
    s.airBrake = h('airBrake');
    s.parachute = h('parachute');
    s.pause = h('pause');
    const back = h('tiltBack');
    const fwd = h('tiltForward');
    s.tuck = h('tuck') || (back && fwd);
    const digital = back && fwd ? 0 : fwd ? 1 : back ? -1 : 0;
    let analog = 0;
    for (const k of Object.keys(this.analog)) {
      const v = this.analog[k];
      if (Math.abs(v) > ANALOG_DEADZONE && Math.abs(v) > Math.abs(analog)) {
        // rescale so the output starts at 0 just outside the dead-zone
        analog = Math.sign(v) * Math.min(1, (Math.abs(v) - ANALOG_DEADZONE) / (1 - ANALOG_DEADZONE));
      }
    }
    s.tilt = analog !== 0 ? analog : digital;
    s.heli = /** @type {-1|0|1} */ ((h('heliRight') ? 1 : 0) - (h('heliLeft') ? 1 : 0));
  }

  /**
   * Release everything held by one source (window blur, gamepad disconnect, overlay hidden).
   * @param {'keyboard'|'gamepad'|'touch'} source
   * @returns {void}
   */
  releaseSource(source) {
    for (const n of HELD_NAMES) this.held[n].delete(source);
    if (source === 'gamepad') delete this.analog.gamepad;
    if (source === 'touch') delete this.analog.device;
    this._recompute();
  }

  /**
   * Snapshot current state and CLEAR the one-shot `pressed` edges.
   * @returns {VirtualPadState} a copy (safe to keep).
   */
  poll() {
    const out = { ...this.state, pressed: { ...this.state.pressed } };
    for (const n of EDGE_NAMES) this.state.pressed[n] = false;
    return out;
  }

  /**
   * Create/show the DOM touch overlay (buttons mirroring WASD/arrows) inside `parent`. No-op on non-touch
   * devices when settings.touchOverlay === 'auto'. Safe to call again (e.g. after settings change).
   * The overlay is only visible while setOverlayContext(true) was called (InputRouter does it on RUN_START).
   * @param {HTMLElement} parent usually game.canvas.parentElement.
   * @param {Pick<import('./SaveStore.js').Settings,'touchOverlay'|'touchRotate90'>} options
   * @returns {void}
   */
  mountTouchOverlay(parent, options) {
    if (typeof document === 'undefined') return;
    if (!this.overlay) this.overlay = new TouchOverlay(this);
    this.overlay.mount(parent, (options && options.touchOverlay) || 'auto');
  }

  /** @param {boolean} visible show/hide the overlay for the current context. @returns {void} */
  setOverlayContext(visible) {
    if (this.overlay) this.overlay.setContextVisible(visible);
  }

  /** Remove overlay and listeners. @returns {void} */
  destroy() {
    if (this.overlay) this.overlay.destroy();
    this.overlay = null;
    for (const n of HELD_NAMES) this.held[n].clear();
    this.analog = {};
    this.state = emptyPadState();
  }
}
