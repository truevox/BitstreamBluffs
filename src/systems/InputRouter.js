/**
 * OWNER: input/audio/glitch engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Unifies keyboard (window listeners, so it works in every scene), gamepad (navigator.getGamepads polled every
 * game step and on poll()) and touch (DOM overlay + optional device tilt) into one VirtualPad. Instantiated ONCE by
 * createServices(game) and stored at REG.INPUT. Other code never touches the keyboard directly; it polls
 * `inputRouter.poll()` (RunScene, every frame) and/or listens for EVT.INPUT_ACTION (menus).
 * Game keys (Space, arrows) get preventDefault so the page never scrolls; keys typed into text fields are ignored.
 *
 * INPUT_ACTION emitted per press (pressed:true) and release (pressed:false), source keyboard|gamepad|touch:
 *   W/ArrowUp 'up' (+ArrowUp 'airBrake'), S/ArrowDown 'down' (+ArrowDown 'parachute'), A/ArrowLeft 'left',
 *   D/ArrowRight 'right', Space 'hop'+'confirm', Enter 'confirm', Shift 'reset', Esc 'pause' (menus: treat as back),
 *   Backspace 'cancel'; gamepad A 'hop'+'confirm', B 'cancel', X 'airBrake', Y 'parachute', Back 'reset',
 *   Start 'pause', d-pad / left stick 'up|down|left|right'; and 'anyKey' on every first press of any key / button /
 *   touch-tap (used for audio unlock and title screens). Direction actions auto-repeat with the OS key repeat.
 * Pure DOM (no Phaser import) so it can be exercised under jsdom.
 */
import { VirtualPad, emptyPadState } from './VirtualPad.js';
import { EVT } from '../events.js';
import { getPaletteCss } from '../ui/Palette.js';

/** Keyboard bindings by KeyboardEvent.code: pad button name and INPUT_ACTION names. */
const KEYMAP = {
  KeyW: { pad: 'push', actions: ['up'] },
  KeyA: { pad: 'tiltBack', actions: ['left'] },
  KeyD: { pad: 'tiltForward', actions: ['right'] },
  KeyS: { pad: 'brake', actions: ['down'] },
  Space: { pad: 'hop', actions: ['hop', 'confirm'], confirm: true },
  ShiftLeft: { pad: 'reset', actions: ['reset'] },
  ShiftRight: { pad: 'reset', actions: ['reset'] },
  ArrowLeft: { pad: 'heliLeft', actions: ['left'] },
  ArrowRight: { pad: 'heliRight', actions: ['right'] },
  ArrowUp: { pad: 'airBrake', actions: ['up', 'airBrake'] },
  ArrowDown: { pad: 'parachute', actions: ['down', 'parachute'] },
  Escape: { pad: 'pause', actions: ['pause'] },
  Enter: { pad: 'confirm', actions: ['confirm'] },
  NumpadEnter: { pad: 'confirm', actions: ['confirm'] },
  Backspace: { pad: null, actions: ['cancel'] },
};
const PREVENT = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const REPEATABLE = new Set(['up', 'down', 'left', 'right']);

const STICK_MENU = 0.6;
const btn = (g, i) => !!(g.buttons[i] && (g.buttons[i].pressed || g.buttons[i].value > 0.5));
const trig = (g, i, t) => !!(g.buttons[i] && g.buttons[i].value > t);
const ax = (g, i) => (g.axes && g.axes[i]) || 0;

/** Gamepad bindings (W3C standard mapping, also what Steam Deck reports). */
const GP_BINDINGS = [
  { id: 'A', test: (g) => btn(g, 0), pad: 'hop', actions: ['hop', 'confirm'], confirm: true },
  { id: 'B', test: (g) => btn(g, 1), pad: 'brake', actions: ['cancel'] },
  { id: 'X', test: (g) => btn(g, 2), pad: 'airBrake', actions: ['airBrake'] },
  { id: 'Y', test: (g) => btn(g, 3), pad: 'parachute', actions: ['parachute'] },
  { id: 'LB', test: (g) => btn(g, 4), pad: 'heliLeft', actions: [] },
  { id: 'RB', test: (g) => btn(g, 5), pad: 'heliRight', actions: [] },
  { id: 'LT', test: (g) => trig(g, 6, 0.4), pad: 'tuck', actions: [] },
  { id: 'RT', test: (g) => trig(g, 7, 0.25), pad: 'push', actions: [] },
  { id: 'Back', test: (g) => btn(g, 8), pad: 'reset', actions: ['reset'] },
  { id: 'Start', test: (g) => btn(g, 9), pad: 'pause', actions: ['pause'] },
  { id: 'DUp', test: (g) => btn(g, 12), pad: null, actions: ['up'] },
  { id: 'DDown', test: (g) => btn(g, 13), pad: null, actions: ['down'] },
  { id: 'DLeft', test: (g) => btn(g, 14), pad: 'tiltBack', actions: ['left'] },
  { id: 'DRight', test: (g) => btn(g, 15), pad: 'tiltForward', actions: ['right'] },
  { id: 'LSUp', test: (g) => ax(g, 1) < -STICK_MENU, pad: null, actions: ['up'] },
  { id: 'LSDown', test: (g) => ax(g, 1) > STICK_MENU, pad: null, actions: ['down'] },
  { id: 'LSLeft', test: (g) => ax(g, 0) < -STICK_MENU, pad: null, actions: ['left'] },
  { id: 'LSRight', test: (g) => ax(g, 0) > STICK_MENU, pad: null, actions: ['right'] },
  { id: 'RSLeft', test: (g) => ax(g, 2) < -0.5, pad: 'heliLeft', actions: [] },
  { id: 'RSRight', test: (g) => ax(g, 2) > 0.5, pad: 'heliRight', actions: [] },
];

const isEditable = (t) =>
  !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true);

export class InputRouter {
  /**
   * @param {Phaser.Game} game
   */
  constructor(game) {
    this.game = game;
    this.pad = new VirtualPad();
    this.enabled = true;
    /** @type {import('./SaveStore.js').Settings|null} */
    this.settings = null;
    this.runActive = false;
    /** @type {Set<string>} KeyboardEvent.code currently held. */
    this.keysDown = new Set();
    /** @type {Object<string,boolean>} previous gamepad binding states. */
    this.gpPrev = {};
    this.gpConnected = false;
    this._listeners = [];
    this._gameListeners = [];
    this._orientation = null;
    this._destroyed = false;
    this._tickBound = () => this._pollGamepads();
    this._bind();
  }

  // ----------------------------------------------------------------------------------------------------------- setup

  _bind() {
    const hasWindow = typeof window !== 'undefined';
    if (hasWindow) {
      this._on(window, 'keydown', (e) => this._onKeyDown(e), { capture: true });
      this._on(window, 'keyup', (e) => this._onKeyUp(e), { capture: true });
      this._on(window, 'blur', () => this._releaseKeyboard());
      this._on(window, 'pointerdown', (e) => this._onPointerDown(e), { capture: true });
      this._on(window, 'gamepadconnected', () => { this.gpConnected = true; });
      this._on(window, 'gamepaddisconnected', () => this._onGamepadGone());
      if (typeof document !== 'undefined') {
        this._on(document, 'visibilitychange', () => { if (document.hidden) this._releaseKeyboard(); });
      }
    }
    const ev = this.game && this.game.events;
    if (ev) {
      this._onGame('prestep', this._tickBound);
      this._onGame(EVT.RUN_START, () => { this.runActive = true; this.pad.setOverlayContext(true); });
      this._onGame(EVT.RUN_END, () => { this.runActive = false; this.pad.setOverlayContext(false); });
      this._onGame(EVT.RUN_ABORT, () => { this.runActive = false; this.pad.setOverlayContext(false); });
      this._onGame(EVT.GAME_PAUSE, () => this.pad.setOverlayContext(false));
      this._onGame(EVT.GAME_RESUME, () => this.pad.setOverlayContext(this.runActive));
      this._onGame(EVT.SETTINGS_CHANGED, (p) => { if (p && p.settings) this.applySettings(p.settings); });
    }
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  _onGame(name, fn) {
    this.game.events.on(name, fn);
    this._gameListeners.push([name, fn]);
  }

  _emit(action, pressed, source) {
    const ev = this.game && this.game.events;
    if (ev) ev.emit(EVT.INPUT_ACTION, { action, pressed, source });
  }

  // ---------------------------------------------------------------------------------------------------------- keyboard

  _onKeyDown(e) {
    if (this._destroyed) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // keep browser shortcuts working
    if (isEditable(e.target)) return;
    const code = e.code;
    const b = KEYMAP[code];
    if (PREVENT.has(code)) e.preventDefault();
    if (!b) {
      if (!e.repeat && code) this._emit('anyKey', true, 'keyboard');
      return;
    }
    if (e.repeat) {
      for (const a of b.actions) if (REPEATABLE.has(a)) this._emit(a, true, 'keyboard');
      return;
    }
    this.keysDown.add(code);
    if (b.pad) this.pad.setButton(b.pad, true, 'keyboard');
    if (b.confirm) this.pad.setButton('confirm', true, 'keyboard');
    for (const a of b.actions) this._emit(a, true, 'keyboard');
    this._emit('anyKey', true, 'keyboard');
  }

  _onKeyUp(e) {
    if (this._destroyed) return;
    const code = e.code;
    const b = KEYMAP[code];
    if (PREVENT.has(code) && !isEditable(e.target)) e.preventDefault();
    if (!b || !this.keysDown.has(code)) return;
    this.keysDown.delete(code);
    if (b.pad) {
      // another physical key may still hold the same pad button (e.g. both Shift keys)
      const still = Object.keys(KEYMAP).some((k) => this.keysDown.has(k) && KEYMAP[k].pad === b.pad);
      if (!still) this.pad.setButton(b.pad, false, 'keyboard');
    }
    if (b.confirm) this.pad.setButton('confirm', false, 'keyboard');
    for (const a of b.actions) this._emit(a, false, 'keyboard');
  }

  _releaseKeyboard() {
    for (const code of [...this.keysDown]) {
      const b = KEYMAP[code];
      if (b) for (const a of b.actions) this._emit(a, false, 'keyboard');
    }
    this.keysDown.clear();
    this.pad.releaseSource('keyboard');
  }

  // ----------------------------------------------------------------------------------------------------------- touch

  _onPointerDown(e) {
    if (this._destroyed || e.pointerType !== 'touch') return;
    this.pad.state.lastSource = 'touch';
    this._emit('anyKey', true, 'touch');
    this._requestOrientation();
  }

  _requestOrientation() {
    if (!this.settings || !this.settings.touchRotate90 || this._orientationAsked) return;
    this._orientationAsked = true;
    try {
      const DOE = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null;
      if (DOE && typeof DOE.requestPermission === 'function') {
        // iOS 13+: must be called from a user gesture; never throws into the game.
        DOE.requestPermission().then((r) => { if (r === 'granted') this._listenOrientation(); }).catch(() => {});
      }
    } catch (err) { /* ignore */ }
  }

  _listenOrientation() {
    if (this._orientation || typeof window === 'undefined' || this._destroyed) return;
    this._orientation = (e) => {
      if (e.beta == null || e.gamma == null) return;
      let angle = 0;
      try {
        angle = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
      } catch (err) { /* ignore */ }
      angle = ((angle % 360) + 360) % 360;
      // Roll about the axis normal to the screen, clockwise positive as the player sees it (device held like a wheel).
      const roll = angle === 90 ? e.beta : angle === 270 ? -e.beta : angle === 180 ? -e.gamma : e.gamma;
      this.pad.setTilt(Math.max(-1, Math.min(1, roll / 30)), 'device');
    };
    window.addEventListener('deviceorientation', this._orientation);
  }

  _unlistenOrientation() {
    if (this._orientation && typeof window !== 'undefined') window.removeEventListener('deviceorientation', this._orientation);
    this._orientation = null;
    this.pad.setTilt(0, 'device');
  }

  // --------------------------------------------------------------------------------------------------------- gamepad

  _getGamepad() {
    try {
      const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
      if (!list) return null;
      let first = null;
      for (const g of list) {
        if (!g || !g.connected) continue;
        if (g.mapping === 'standard') return g;
        if (!first) first = g;
      }
      return first;
    } catch (err) {
      return null;
    }
  }

  _onGamepadGone() {
    this.gpConnected = false;
    this.gpPrev = {};
    this.pad.releaseSource('gamepad');
  }

  _pollGamepads() {
    if (this._destroyed) return;
    const g = this._getGamepad();
    if (!g) {
      if (this.gpActive) {
        this.gpActive = false;
        this._onGamepadGone();
      }
      return;
    }
    this.gpActive = true;
    for (const b of GP_BINDINGS) {
      const down = !!b.test(g);
      if (down === !!this.gpPrev[b.id]) continue;
      this.gpPrev[b.id] = down;
      if (b.pad) this.pad.setButton(b.pad, down, 'gamepad');
      if (b.confirm) this.pad.setButton('confirm', down, 'gamepad');
      for (const a of b.actions) this._emit(a, down, 'gamepad');
      if (down) this._emit('anyKey', true, 'gamepad');
    }
    this.pad.setTilt(ax(g, 0), 'gamepad');
  }

  // ------------------------------------------------------------------------------------------------------ public API

  /**
   * Read the current normalized control state. Call at most once per frame per consumer scene
   * (it consumes the one-shot `pressed` edges and polls gamepads).
   * @returns {import('./VirtualPad.js').VirtualPadState}
   */
  poll() {
    this._pollGamepads();
    const s = this.pad.poll();
    if (!this.enabled) {
      const n = emptyPadState();
      n.lastSource = s.lastSource;
      return n;
    }
    return s;
  }

  /**
   * Enable/disable gameplay input (e.g. while paused or typing initials). When disabled poll() returns a neutral
   * state but EVT.INPUT_ACTION menu events still fire.
   * @param {boolean} enabled
   * @returns {void}
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Apply settings (touch overlay mode / 90-degree rotate). Safe to call repeatedly.
   * @param {import('./SaveStore.js').Settings} settings
   * @returns {void}
   */
  applySettings(settings) {
    if (this._destroyed || !settings) return;
    this.settings = settings;
    try {
      const canvas = this.game && this.game.canvas;
      const parent = (canvas && canvas.parentElement) || (typeof document !== 'undefined' ? document.body : null);
      if (parent) {
        this.pad.mountTouchOverlay(parent, settings);
        if (this.pad.overlay) {
          try { this.pad.overlay.setColors(getPaletteCss(this.game)); } catch (err) { /* palette not ready */ }
          this.pad.overlay.setContextVisible(this.runActive);
        }
      }
    } catch (err) { /* DOM unavailable */ }
    if (settings.touchRotate90) {
      this._orientationAsked = false;
      const DOE = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null;
      if (DOE && typeof DOE.requestPermission === 'function') {
        // wait for a touch gesture (see _onPointerDown)
      } else if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) this._listenOrientation();
    } else this._unlistenOrientation();
  }

  /** Remove all listeners / overlay. @returns {void} */
  destroy() {
    this._destroyed = true;
    for (const [t, type, fn, opts] of this._listeners) t.removeEventListener(type, fn, opts);
    this._listeners = [];
    for (const [name, fn] of this._gameListeners) this.game.events.off(name, fn);
    this._gameListeners = [];
    this._unlistenOrientation();
    this.keysDown.clear();
    this.pad.destroy();
  }
}
