/**
 * OWNER: UI engineer.
 * Normalises every input device into a small menu vocabulary:
 *   'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel' | 'alt'
 * Sources: EVT.INPUT_ACTION (InputRouter: keyboard / gamepad / touch), Phaser keyboard (redundant, so menus work
 * with the stub router too) and a direct navigator.getGamepads() poll. The same action arriving from two sources
 * within DEDUPE_MS is delivered once. All listeners are removed on scene shutdown.
 *
 * Raw text entry: set `rawKeyHandler` (returns true when it consumed the event). While set, keyboard-sourced
 * INPUT_ACTIONs are ignored (typing "A" must not also move a cursor) and keyboard input arrives only as raw events.
 */
import Phaser from 'phaser';
import { REG } from '../constants.js';
import { EVT } from '../events.js';

const DEDUPE_MS = 60;
const REPEAT_FIRST_MS = 340;
const REPEAT_MS = 100;

const KEY_MAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  Enter: 'confirm', ' ': 'confirm', Escape: 'cancel', n: 'alt', N: 'alt',
};
const DIRS = new Set(['up', 'down', 'left', 'right']);
const ROUTER_MAP = {
  up: 'up', down: 'down', left: 'left', right: 'right', confirm: 'confirm', hop: 'confirm',
  cancel: 'cancel', pause: 'cancel',
};

export class MenuInput {
  /**
   * @param {Phaser.Scene} scene
   * @param {function(string, string):void} handler called with (action, source)
   * @param {{graceMs?:number}} [opts] ignore all input for graceMs after creation
   */
  constructor(scene, handler, opts = {}) {
    this.scene = scene;
    this.game = scene.game;
    this.handler = handler;
    this.enabled = true;
    /** @type {null|function(KeyboardEvent):boolean} */
    this.rawKeyHandler = null;
    this.born = performance.now();
    this.graceMs = opts.graceMs || 0;
    this.last = {};
    this.padPrev = this._readPad();
    this.padHold = {};

    this._onAction = (p) => {
      if (!p || !p.pressed) return;
      if (this.rawKeyHandler && p.source === 'keyboard') return;
      const a = ROUTER_MAP[p.action];
      if (a) this._fire(a, p.source || 'keyboard');
    };
    this.game.events.on(EVT.INPUT_ACTION, this._onAction);

    this._onKey = (ev) => {
      const e = ev.originalEvent || ev;
      this._unlock();
      if (this.rawKeyHandler && this.rawKeyHandler(e)) return;
      if (this.rawKeyHandler) return;
      const a = KEY_MAP[e.key];
      if (!a) return;
      if (e.repeat && !DIRS.has(a)) return;
      this._fire(a, 'keyboard', true);
    };
    // Phaser's keyboard plugin is used for plain menu keys only. In raw text-entry mode (initials) native window events
    // are used instead: InputRouter preventDefaults Space / arrows and Phaser drops default-prevented events (Space
    // would never reach the entry), and Phaser's per-frame key queue was seen re-delivering keys out of order when
    // several arrive in one frame (fast typing 'zqx' gave 'ZZX').
    // Events already consumed natively are remembered so that Phaser's (later, per-frame) copy of the same key press
    // cannot act again once raw mode has ended, e.g. the Enter that saved the initials must not also retry.
    this._native = new WeakSet();
    this._onPhaserKey = (ev) => {
      const e = ev.originalEvent || ev;
      if (this.rawKeyHandler || (e && this._native.has(e))) return;
      this._onKey(ev);
    };
    if (scene.input.keyboard) scene.input.keyboard.on('keydown', this._onPhaserKey);
    this._onWinKey = (e) => {
      if (!this.rawKeyHandler || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true)) return;
      this._native.add(e);
      this._onKey(e);
    };
    if (typeof window !== 'undefined') window.addEventListener('keydown', this._onWinKey);

    this._onPointer = () => this._unlock();
    scene.input.on('pointerdown', this._onPointer);

    this._onUpdate = (time, delta) => this._pollPad(delta);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this._onUpdate);

    this._cleanup = () => this.destroy();
    scene.events.once('shutdown', this._cleanup);
    scene.events.once('destroy', this._cleanup);
  }

  _unlock() {
    try {
      const audio = this.game.registry.get(REG.AUDIO);
      if (audio) audio.unlock();
    } catch (e) {
      /* ignore */
    }
  }

  _fire(action, source, allowRepeat = false) {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.born < this.graceMs) return;
    if (!allowRepeat || !DIRS.has(action)) {
      if (this.last[action] !== undefined && now - this.last[action] < DEDUPE_MS) return;
    } else if (this.last[action] !== undefined && now - this.last[action] < 12) {
      return;
    }
    this.last[action] = now;
    this.handler(action, source);
  }

  _readPad() {
    const out = { btn: [], ax: 0, ay: 0 };
    try {
      const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
      for (const p of pads) {
        if (!p || !p.connected) continue;
        p.buttons.forEach((b, i) => {
          if (b.pressed) out.btn[i] = true;
        });
        if (Math.abs(p.axes[0] || 0) > Math.abs(out.ax)) out.ax = p.axes[0];
        if (Math.abs(p.axes[1] || 0) > Math.abs(out.ay)) out.ay = p.axes[1];
      }
    } catch (e) {
      /* no gamepad API */
    }
    return out;
  }

  _pollPad(delta) {
    const cur = this._readPad();
    const prev = this.padPrev;
    const edge = (i) => cur.btn[i] && !prev.btn[i];
    if (edge(0)) this._fire('confirm', 'gamepad');
    if (edge(1) || edge(9)) this._fire('cancel', 'gamepad');
    if (edge(2) || edge(3)) this._fire('alt', 'gamepad');
    const dirs = {
      up: cur.btn[12] || cur.ay < -0.6,
      down: cur.btn[13] || cur.ay > 0.6,
      left: cur.btn[14] || cur.ax < -0.6,
      right: cur.btn[15] || cur.ax > 0.6,
    };
    for (const d of Object.keys(dirs)) {
      if (dirs[d]) {
        const h = this.padHold[d];
        if (h === undefined) {
          this.padHold[d] = REPEAT_FIRST_MS;
          this._fire(d, 'gamepad', true);
        } else {
          this.padHold[d] = h - delta;
          if (this.padHold[d] <= 0) {
            this.padHold[d] = REPEAT_MS;
            this._fire(d, 'gamepad', true);
          }
        }
      } else {
        delete this.padHold[d];
      }
    }
    this.padPrev = cur;
  }

  /** @returns {void} */
  destroy() {
    if (!this.game) return;
    this.game.events.off(EVT.INPUT_ACTION, this._onAction);
    const s = this.scene;
    if (s.input && s.input.keyboard) s.input.keyboard.off('keydown', this._onPhaserKey);
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this._onWinKey);
    if (s.input) s.input.off('pointerdown', this._onPointer);
    s.events.off(Phaser.Scenes.Events.UPDATE, this._onUpdate);
    s.events.off('shutdown', this._cleanup);
    s.events.off('destroy', this._cleanup);
    this.rawKeyHandler = null;
    this.handler = () => {};
    this.game = null;
  }
}
