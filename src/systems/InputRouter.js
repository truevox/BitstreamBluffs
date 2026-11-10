/**
 * OWNER: input/audio/glitch engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Unifies keyboard (window listeners, so it works in every scene), gamepad (navigator.getGamepads polled per
 * frame) and touch into one VirtualPad. Instantiated ONCE by createServices(game) and stored at REG.INPUT.
 * Other code never touches the keyboard directly; it polls `inputRouter.poll()` (RunScene, every frame) and/or
 * listens for EVT.INPUT_ACTION (menus: confirm/cancel/up/down/left/right/anyKey/pause).
 * Phaser keyboard capture: must preventDefault for Space/arrows so the page does not scroll.
 */
import { VirtualPad } from './VirtualPad.js';

export class InputRouter {
  /**
   * @param {Phaser.Game} game
   */
  constructor(game) {
    this.game = game;
    this.pad = new VirtualPad();
    this.enabled = true;
  }

  /**
   * Read the current normalized control state. Call at most once per frame per consumer scene
   * (it consumes the one-shot `pressed` edges and polls gamepads).
   * @returns {import('./VirtualPad.js').VirtualPadState}
   */
  poll() {
    return this.pad.poll();
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
   * Apply settings (touch overlay mode / 90-degree rotate).
   * @param {import('./SaveStore.js').Settings} settings
   * @returns {void}
   */
  applySettings(settings) {}

  /** Remove all listeners / overlay. @returns {void} */
  destroy() {
    this.pad.destroy();
  }
}
