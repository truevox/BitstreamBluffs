/**
 * OWNER: UI engineer.
 * Small pointer/touch button: bordered box + label (+ optional hotkey hint). Keyboard/gamepad users reach the same
 * actions through scene-level hotkeys; Button handles mouse and touch.
 *
 * Look: dark glass face with a neon border; hover lights a soft outer glow (falling-alpha strokes outside the
 * box, like Panel) and a brighter face; a press flashes the face bright and fades it out (flash(), also
 * callable by a host that triggers the button from a hotkey so keyboard users see the same feedback).
 * The hit zone is exactly the w x h box; the glow is paint only.
 */
import Phaser from 'phaser';
import { NeonText, strokeRectPx, glowRectPx } from './Neon.js';
import { uiSfx } from './Sound.js';
import { tweenProgress, Ease, isReducedMotion, REDUCED_MS } from './Motion.js';

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
    this.flashT = 0; // 1 = press flash at full strength, decays to 0
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
      this.flash();
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

  /** Bright press flash that fades out (shorter under reduce motion; it is feedback, not motion). */
  flash() {
    if (this._flashTween && typeof this._flashTween.remove === 'function') this._flashTween.remove();
    this.flashT = 1;
    this._paint();
    this._flashTween = tweenProgress(this.scene, {
      duration: isReducedMotion(this.scene) ? REDUCED_MS : 240,
      ease: Ease.outQuad,
      onUpdate: (p) => {
        if (!this.scene) return;
        this.flashT = 1 - p;
        this._paint();
      },
      onComplete: () => { this._flashTween = null; },
    });
    return this;
  }

  _paint() {
    const pal = this.theme.pal;
    if (!pal || !this.g) return;
    const c = pal[this.colorKey];
    const g = this.g;
    const { w, h } = this;
    g.clear();
    if (this.hover && !this.disabled) {
      // soft glow outside the box
      glowRectPx(g, 0, 0, w, h, c, 1.5);
    }
    g.fillStyle(pal.bgAlt, 0.95);
    g.fillRect(0, 0, w, h);
    // face: a hint of the accent at rest, more on hover; a top-half sheen gives it a glass bevel
    g.fillStyle(c, this.hover ? 0.24 : 0.07);
    g.fillRect(1, 1, w - 2, h - 2);
    g.fillStyle(pal.text, this.hover ? 0.1 : 0.04);
    g.fillRect(1, 1, w - 2, Math.floor((h - 2) / 2));
    if (this.flashT > 0) {
      g.fillStyle(c, 0.75 * this.flashT);
      g.fillRect(1, 1, w - 2, h - 2);
    }
    strokeRectPx(g, 0, 0, w, h, c, this.hover ? 1 : 0.7);
    // bright bottom edge on hover: the "lit" key
    if (this.hover) {
      g.fillStyle(c, 1);
      g.fillRect(1, h - 2, w - 2, 1);
    }
    this.label.setColorKey(this.flashT > 0.5 ? 'text' : this.colorKey);
  }

  destroy(fromScene) {
    if (this._flashTween && typeof this._flashTween.remove === 'function') this._flashTween.remove();
    this._flashTween = null;
    if (this._unbind) this._unbind();
    this._unbind = null;
    super.destroy(fromScene);
  }
}
