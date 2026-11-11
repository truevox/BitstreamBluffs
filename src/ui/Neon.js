/**
 * OWNER: UI engineer.
 * Neon text + small drawing helpers. All colours are palette keys resolved through Theme.
 */
import Phaser from 'phaser';
import { FONT_KEY, FONT_OUTLINE_KEY, FONT_LINE_H, measureText } from './PixelFont.js';

/**
 * Crisp bitmap text with an outline (dark, for legibility over gameplay) or a coloured glow.
 * Origin is controlled by `anchor` ('left'|'center'|'right') and `vAnchor` (0 top, 0.5 middle, 1 bottom).
 */
export class NeonText extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {number} x
   * @param {number} y
   * @param {string} text
   * @param {{color?:string, scale?:number, anchor?:'left'|'center'|'right', vAnchor?:number,
   *          outline?:'dark'|'glow'|'none', align?:'left'|'center'|'right', alpha?:number, parent?:Phaser.GameObjects.Container}} [opts]
   */
  constructor(scene, theme, x, y, text, opts = {}) {
    super(scene, Math.round(x), Math.round(y));
    this.theme = theme;
    this.colorKey = opts.color || 'text';
    this.outlineMode = opts.outline || 'dark';
    const anchor = opts.anchor || 'left';
    const ox = anchor === 'center' ? 0.5 : anchor === 'right' ? 1 : 0;
    const oy = opts.vAnchor === undefined ? 0 : opts.vAnchor;
    this.outlineText = null;
    if (this.outlineMode !== 'none') {
      this.outlineText = new Phaser.GameObjects.BitmapText(scene, 0, 0, FONT_OUTLINE_KEY, text);
      this.outlineText.setOrigin(ox, oy);
      this.add(this.outlineText);
    }
    this.main = new Phaser.GameObjects.BitmapText(scene, 0, 0, FONT_KEY, text);
    this.main.setOrigin(ox, oy);
    this.add(this.main);
    const align = opts.align || anchor;
    for (const t of [this.main, this.outlineText]) {
      if (!t) continue;
      if (align === 'center') t.setCenterAlign();
      else if (align === 'right') t.setRightAlign();
      else t.setLeftAlign();
    }
    this.setScale(opts.scale || 1);
    if (opts.alpha !== undefined) this.setAlpha(opts.alpha);
    scene.add.existing(this);
    if (opts.parent) opts.parent.add(this);
    this._unbind = theme.bind(() => this._paint());
  }

  _paint() {
    const c = this.theme.color(this.colorKey);
    this.main.setTint(c);
    if (this.outlineText) {
      if (this.outlineMode === 'glow') {
        this.outlineText.setTint(c);
        this.outlineText.setAlpha(0.22);
      } else {
        this.outlineText.setTint(0x000000);
        this.outlineText.setAlpha(0.9);
      }
    }
  }

  /** @param {string} str @returns {this} */
  setText(str) {
    str = String(str);
    if (this.main.text === str) return this;
    this.main.setText(str);
    if (this.outlineText) this.outlineText.setText(str);
    return this;
  }

  /** @param {string} key palette key @returns {this} */
  setColorKey(key) {
    if (this.colorKey !== key) {
      this.colorKey = key;
      this._paint();
    }
    return this;
  }

  /** Text width in screen px (includes container scale). @returns {number} */
  get textWidth() {
    return measureText(this.main.text.split('\n')[0]) * this.scaleX;
  }

  /** @returns {void} */
  destroy(fromScene) {
    if (this._unbind) this._unbind();
    this._unbind = null;
    super.destroy(fromScene);
  }
}

/**
 * Add a NeonText in one call.
 * @param {Phaser.Scene} scene
 * @param {import('./Theme.js').Theme} theme
 * @param {number} x
 * @param {number} y
 * @param {string} text
 * @param {ConstructorParameters<typeof NeonText>[5]} [opts]
 * @returns {NeonText}
 */
export function neonText(scene, theme, x, y, text, opts) {
  return new NeonText(scene, theme, x, y, text, opts);
}

/**
 * Draw a 1px-bordered rectangle using filled rects (pixel exact).
 * @param {Phaser.GameObjects.Graphics} g
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} color
 * @param {number} [alpha=1]
 */
export function strokeRectPx(g, x, y, w, h, color, alpha = 1) {
  g.fillStyle(color, alpha);
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x, y + 1, 1, h - 2);
  g.fillRect(x + w - 1, y + 1, 1, h - 2);
}

/**
 * Draw neon corner brackets (Tron-style) around a rectangle.
 * @param {Phaser.GameObjects.Graphics} g
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} color @param {number} [len=6] @param {number} [alpha=1]
 */
export function cornerTicks(g, x, y, w, h, color, len = 6, alpha = 1) {
  g.fillStyle(color, alpha);
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w - 1, y, -1, 1], [x, y + h - 1, 1, -1], [x + w - 1, y + h - 1, -1, -1]]) {
    g.fillRect(sx > 0 ? cx : cx - len + 1, cy, len, 1);
    g.fillRect(cx, sy > 0 ? cy : cy - len + 1, 1, len);
  }
}

export { FONT_LINE_H, measureText };
