/**
 * OWNER: UI engineer.
 * Arcade-style initials entry with an arbitrary slot count (design doc 6.2: 3 by default, configurable).
 *  - keyboard: type A-Z / 0-9 (fills the slot and advances), Backspace, arrows (left/right move, up/down cycle)
 *  - gamepad: d-pad / stick up/down cycles, left/right moves, A = advance then submit on the last slot, B = back
 *  - touch / mouse: tap a slot to select it, tap the triangles above/below it to cycle, tap SAVE
 * The widget owns no input listeners; the scene feeds it `handleAction()` (MenuInput) and `handleKey()` (raw keys).
 */
import Phaser from 'phaser';
import { NeonText, strokeRectPx } from './Neon.js';
import { Button } from './Button.js';
import { uiSfx } from './Sound.js';

export const INITIALS_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export class InitialsEntry extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{x:number,y:number,w:number,length?:number,initial?:string,color?:string,
   *          onSubmit:function(string):void, parent?:Phaser.GameObjects.Container}} o x,y = top-left, w = available width
   */
  constructor(scene, theme, o) {
    super(scene, o.x, o.y);
    this.theme = theme;
    this.slots = Math.max(1, o.length || 3);
    this.onSubmit = o.onSubmit;
    this.colorKey = o.color || 'lime';
    const init = String(o.initial || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    /** @type {string[]} */
    this.chars = [];
    for (let i = 0; i < this.slots; i++) this.chars.push(init[i] || 'A');
    this.cursor = 0;
    this.big = this.slots <= 6;
    this.slotW = Math.min(this.big ? 30 : 17, Math.floor((o.w - 4 * (this.slots - 1)) / this.slots));
    this.slotH = this.big ? 28 : 18;
    this.gap = 4;
    this.totalW = this.slots * this.slotW + (this.slots - 1) * this.gap;
    this.x0 = Math.round((o.w - this.totalW) / 2);
    this.g = new Phaser.GameObjects.Graphics(scene);
    this.add(this.g);
    this.slotY = 14;
    this.letters = [];
    for (let i = 0; i < this.slots; i++) {
      const sx = this.x0 + i * (this.slotW + this.gap);
      const t = new NeonText(scene, theme, sx + this.slotW / 2, this.slotY + this.slotH / 2, this.chars[i], {
        color: 'text', scale: this.big ? 3 : 2, anchor: 'center', vAnchor: 0.5, outline: 'glow',
      });
      this.add(t);
      this.letters.push(t);
      const mkZone = (zy, zh, fn) => {
        const z = new Phaser.GameObjects.Zone(scene, sx, zy, this.slotW, zh).setOrigin(0, 0);
        z.setInteractive({ useHandCursor: true });
        z.on('pointerdown', fn);
        this.add(z);
      };
      mkZone(0, 14, () => this._select(i) && this.cycle(1));
      mkZone(this.slotY, this.slotH, () => this._select(i));
      mkZone(this.slotY + this.slotH, 14, () => this._select(i) && this.cycle(-1));
    }
    this.arrowUp = new NeonText(scene, theme, 0, 0, '▲', { color: this.colorKey, anchor: 'center', vAnchor: 0.5, outline: 'none' });
    this.arrowDown = new NeonText(scene, theme, 0, 0, '▼', { color: this.colorKey, anchor: 'center', vAnchor: 0.5, outline: 'none' });
    this.add([this.arrowUp, this.arrowDown]);
    const btnW = 84;
    this.saveBtn = new Button(scene, theme, {
      x: Math.round((o.w - btnW) / 2), y: this.slotY + this.slotH + 18, w: btnW, h: 16, label: 'SAVE', color: this.colorKey,
      onClick: () => this.submit(),
    });
    this.add(this.saveBtn);
    this.contentH = this.slotY + this.slotH + 34;
    scene.add.existing(this);
    if (o.parent) o.parent.add(this);
    this._unbind = theme.bind(() => this.refresh());
  }

  _select(i) {
    if (this.cursor !== i) {
      this.cursor = i;
      uiSfx(this.scene, 'uiMove');
      this.refresh();
    }
    return true;
  }

  /** @returns {string} current initials */
  getValue() {
    return this.chars.join('');
  }

  /** @param {number} dir +1 next letter, -1 previous @returns {void} */
  cycle(dir) {
    const cs = INITIALS_CHARSET;
    const i = cs.indexOf(this.chars[this.cursor]);
    this.chars[this.cursor] = cs[(i + dir + cs.length) % cs.length];
    uiSfx(this.scene, 'uiMove', { pitch: 1 + 0.03 * i });
    this.refresh();
  }

  /** @returns {void} */
  submit() {
    uiSfx(this.scene, 'uiSelect');
    this.onSubmit(this.getValue());
  }

  /**
   * @param {string} action MenuInput action
   * @returns {boolean} consumed
   */
  handleAction(action) {
    switch (action) {
      case 'up': this.cycle(1); return true;
      case 'down': this.cycle(-1); return true;
      case 'left':
        if (this.cursor > 0) { this.cursor--; uiSfx(this.scene, 'uiMove'); this.refresh(); }
        return true;
      case 'right':
        if (this.cursor < this.slots - 1) { this.cursor++; uiSfx(this.scene, 'uiMove'); this.refresh(); }
        return true;
      case 'confirm':
        if (this.cursor < this.slots - 1) { this.cursor++; uiSfx(this.scene, 'uiSelect'); this.refresh(); } else this.submit();
        return true;
      case 'cancel':
        if (this.cursor > 0) { this.cursor--; uiSfx(this.scene, 'uiBack'); this.refresh(); return true; }
        return false;
      default: return false;
    }
  }

  /**
   * Raw keyboard text input.
   * @param {KeyboardEvent} e
   * @returns {boolean} consumed (letters, digits, Backspace)
   */
  handleKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
      this.chars[this.cursor] = e.key.toUpperCase();
      if (this.cursor < this.slots - 1) this.cursor++;
      uiSfx(this.scene, 'uiSelect', { pitch: 1.2 });
      this.refresh();
      return true;
    }
    if (e.key === 'Backspace') {
      if (this.cursor > 0) this.cursor--;
      this.chars[this.cursor] = 'A';
      uiSfx(this.scene, 'uiBack');
      this.refresh();
      return true;
    }
    return false;
  }

  /** Repaint. @returns {void} */
  refresh() {
    const pal = this.theme.pal;
    const g = this.g;
    g.clear();
    const c = pal[this.colorKey];
    for (let i = 0; i < this.slots; i++) {
      const sx = this.x0 + i * (this.slotW + this.gap);
      const sel = i === this.cursor;
      g.fillStyle(pal.bgAlt, 1);
      g.fillRect(sx, this.slotY, this.slotW, this.slotH);
      strokeRectPx(g, sx, this.slotY, this.slotW, this.slotH, c, sel ? 1 : 0.4);
      if (sel) {
        g.fillStyle(c, 0.18);
        g.fillRect(sx + 1, this.slotY + 1, this.slotW - 2, this.slotH - 2);
        g.fillStyle(c, 1);
        g.fillRect(sx + 3, this.slotY + this.slotH - 4, this.slotW - 6, 2);
      }
      this.letters[i].setText(this.chars[i]);
      this.letters[i].setColorKey(sel ? 'text' : this.colorKey);
    }
    const sx = this.x0 + this.cursor * (this.slotW + this.gap) + this.slotW / 2;
    this.arrowUp.setPosition(Math.round(sx), 8);
    this.arrowDown.setPosition(Math.round(sx), this.slotY + this.slotH + 8);
  }

  destroy(fromScene) {
    if (this._unbind) this._unbind();
    this._unbind = null;
    super.destroy(fromScene);
  }
}
