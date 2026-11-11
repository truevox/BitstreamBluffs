/**
 * OWNER: UI engineer.
 * Per-scene palette binder. Every coloured UI element registers a callback with `bind()`; when the player swaps
 * the colour-blind palette (EVT.SETTINGS_CHANGED) all callbacks are re-run, so the swap is visible live.
 * The listener on game.events is removed on scene shutdown.
 */
import { EVT } from '../events.js';
import { getPalette, getPaletteCss } from './Palette.js';

export class Theme {
  /** @param {Phaser.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.game = scene.game;
    /** @type {Object<string,number>} */
    this.pal = getPalette(this.game);
    /** @type {Object<string,string>} */
    this.css = getPaletteCss(this.game);
    /** @type {Set<function(Object<string,number>):void>} */
    this.subs = new Set();
    this._onChange = (p) => {
      if (!p || p.key === 'palette') this.refresh();
    };
    this.game.events.on(EVT.SETTINGS_CHANGED, this._onChange);
    this._destroy = () => this.destroy();
    scene.events.once('shutdown', this._destroy);
    scene.events.once('destroy', this._destroy);
  }

  /**
   * @param {string} key palette key, e.g. 'cyan'
   * @returns {number}
   */
  color(key) {
    return this.pal[key] !== undefined ? this.pal[key] : 0xffffff;
  }

  /**
   * Register a palette-dependent painter; it runs immediately and after each palette change.
   * @param {function(Object<string,number>, Theme):void} fn
   * @returns {function():void} unbind
   */
  bind(fn) {
    this.subs.add(fn);
    fn(this.pal, this);
    return () => this.subs.delete(fn);
  }

  /** Re-read the palette and repaint everything bound. @returns {void} */
  refresh() {
    this.pal = getPalette(this.game);
    this.css = getPaletteCss(this.game);
    for (const fn of [...this.subs]) {
      try {
        fn(this.pal, this);
      } catch (e) {
        this.subs.delete(fn); // painter belongs to a destroyed object
      }
    }
  }

  /** @returns {void} */
  destroy() {
    if (!this.game) return;
    this.game.events.off(EVT.SETTINGS_CHANGED, this._onChange);
    this.scene.events.off('shutdown', this._destroy);
    this.scene.events.off('destroy', this._destroy);
    this.subs.clear();
    this.game = null;
  }
}
