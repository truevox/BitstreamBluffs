/**
 * OWNER: UI engineer.
 * Small pointer/touch button: bordered box + label (+ optional hotkey hint). Keyboard/gamepad users reach the same
 * actions through scene-level hotkeys; Button handles mouse and touch.
 */
import Phaser from 'phaser';
import { NeonText, strokeRectPx } from './Neon.js';
import { uiSfx } from './Sound.js';

export class Button extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{x:number,y:number,w:number,h?:number,label:string,hint?:string,color?:string,onClick:function():void,parent?:Phaser.GameObjects.Container}} o
   * x,y = top-left.
   */
  constructor(scene, theme, o) {
    super(scene, o.x, o.y);
    this.theme = theme;
    this.w = o.w;
    this.h = o.h || 16;
    this.colorKey = o.color || 'cyan';
    this.hover = false;
    this.disabled = false;
    this.g = new Phaser.GameObjects.Graphics(scene);
    this.add(this.g);
    this.label = new NeonText(scene, theme, this.w / 2, this.h / 2 + (o.hint ? -3 : 0), o.label, {
      color: this.colorKey, anchor: 'center', vAnchor: 0.5,
    });
    this.add(this.label);
    this.hintText = null;
    if (o.hint) {
      this.hintText = new NeonText(scene, theme, this.w / 2, this.h - 6, o.hint, {
        color: 'text', anchor: 'center', vAnchor: 0.5, outline: 'none',
      });
      this.hintText.setAlpha(0.6);
      this.add(this.hintText);
    }
    this.zone = new Phaser.GameObjects.Zone(scene, 0, 0, this.w, this.h).setOrigin(0, 0);
    this.zone.setInteractive({ useHandCursor: true });
    this.add(this.zone);
    this.zone.on('pointerover', () => this.setHover(true));
    this.zone.on('pointerout', () => this.setHover(false));
    this.zone.on('pointerdown', () => {
      if (this.disabled) return;
      uiSfx(scene, 'uiSelect');
      o.onClick();
    });
    scene.add.existing(this);
    if (o.parent) o.parent.add(this);
    this._unbind = theme.bind(() => this._paint());
  }

  setHover(v) {
    this.hover = v;
    this._paint();
  }

  /** @param {string} str @returns {this} */
  setLabel(str) {
    this.label.setText(str);
    return this;
  }

  /** @param {boolean} d @returns {this} */
  setDisabled(d) {
    this.disabled = d;
    this.setAlpha(d ? 0.4 : 1);
    return this;
  }

  _paint() {
    const pal = this.theme.pal;
    const c = pal[this.colorKey];
    const g = this.g;
    g.clear();
    g.fillStyle(this.hover ? c : pal.bgAlt, this.hover ? 0.25 : 0.95);
    g.fillRect(0, 0, this.w, this.h);
    strokeRectPx(g, 0, 0, this.w, this.h, c, this.hover ? 1 : 0.7);
    this.label.setColorKey(this.colorKey);
  }

  destroy(fromScene) {
    if (this._unbind) this._unbind();
    this._unbind = null;
    super.destroy(fromScene);
  }
}
