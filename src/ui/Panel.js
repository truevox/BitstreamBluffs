/**
 * OWNER: UI engineer.
 * Neon-bordered panel with optional title bar. Repaints on palette change.
 */
import Phaser from 'phaser';
import { NeonText, strokeRectPx, cornerTicks } from './Neon.js';

export class Panel extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{x:number, y:number, w:number, h:number, color?:string, title?:string, fillAlpha?:number, parent?:Phaser.GameObjects.Container}} o
   */
  constructor(scene, theme, o) {
    super(scene, o.x, o.y);
    this.theme = theme;
    this.w = o.w;
    this.h = o.h;
    this.colorKey = o.color || 'cyan';
    this.fillAlpha = o.fillAlpha === undefined ? 0.92 : o.fillAlpha;
    this.g = new Phaser.GameObjects.Graphics(scene);
    this.add(this.g);
    this.titleText = null;
    this.hasTitle = !!o.title;
    if (o.title) {
      this.titleText = new NeonText(scene, theme, 8, 4, o.title, { color: this.colorKey, outline: 'glow' });
      this.add(this.titleText);
    }
    scene.add.existing(this);
    if (o.parent) o.parent.add(this);
    this._unbind = theme.bind((pal) => this._paint(pal));
  }

  _paint(pal) {
    const g = this.g;
    g.clear();
    const c = pal[this.colorKey];
    g.fillStyle(pal.bg, this.fillAlpha);
    g.fillRect(0, 0, this.w, this.h);
    g.fillStyle(pal.bgAlt, this.fillAlpha);
    g.fillRect(1, 1, this.w - 2, this.hasTitle ? 14 : this.h - 2);
    if (!this.hasTitle) {
      g.fillStyle(pal.bg, this.fillAlpha);
      g.fillRect(1, 1, this.w - 2, this.h - 2);
    }
    strokeRectPx(g, 0, 0, this.w, this.h, c, 0.55);
    cornerTicks(g, 0, 0, this.w, this.h, c, 7, 1);
    if (this.hasTitle) {
      g.fillStyle(c, 0.5);
      g.fillRect(1, 15, this.w - 2, 1);
    }
    if (this.titleText) this.titleText.setColorKey(this.colorKey);
  }

  /** @param {string} key @returns {this} */
  setColorKey(key) {
    this.colorKey = key;
    this._paint(this.theme.pal);
    return this;
  }

  /** @param {string} str @returns {this} */
  setTitle(str) {
    if (this.titleText) this.titleText.setText(str);
    return this;
  }

  destroy(fromScene) {
    if (this._unbind) this._unbind();
    this._unbind = null;
    super.destroy(fromScene);
  }
}
