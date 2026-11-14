/**
 * OWNER: UI engineer.
 * Per-scene palette binder. Every coloured UI element registers a callback with `bind()`; when the player swaps
 * the colour-blind palette (EVT.SETTINGS_CHANGED) all callbacks are re-run, so the swap is visible live.
 * The listener on game.events is removed on scene shutdown.
 *
 * Audit SHOP-5: the equipped UI theme (profile.equipped.theme) is laid over the palette here, so every
 * menu, panel and HUD painter that reads `pal`/`css`/`color()` is themed. Cosmetics.themedUiPalette owns
 * the rules: only UI accent keys move, `danger` never does, and a colourblind palette refuses the theme.
 * Call refresh() after the profile's theme changes (ShopView does).
 */
import { EVT } from '../events.js';
import { REG, PALETTE_KEYS } from '../constants.js';
import { getPaletteCss } from './Palette.js';
import { themedUiPalette } from '../systems/Cosmetics.js';

/**
 * The active UI palette, themed, as {css, pal}.
 * @param {Phaser.Game} game @returns {{css:Object<string,string>, pal:Object<string,number>}}
 */
export function themedPalette(game) {
  const base = getPaletteCss(game);
  const reg = game.registry;
  const settings = (reg && reg.get(REG.SETTINGS)) || {};
  const profile = (reg && reg.get(REG.PROFILE)) || null;
  const css = themedUiPalette(base, profile, { colorblind: settings.palette === 'colorblind' });
  /** @type {Object<string,number>} */
  const pal = {};
  for (const k of PALETTE_KEYS) pal[k] = parseInt(css[k].slice(1), 16);
  return { css, pal };
}

export class Theme {
  /** @param {Phaser.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.game = scene.game;
    const t = themedPalette(this.game);
    /** @type {Object<string,number>} */
    this.pal = t.pal;
    /** @type {Object<string,string>} */
    this.css = t.css;
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
    const t = themedPalette(this.game);
    this.pal = t.pal;
    this.css = t.css;
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
