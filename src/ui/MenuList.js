/**
 * OWNER: UI engineer.
 * Vertical menu list usable with keyboard, gamepad (via MenuInput actions), mouse and touch.
 * Item kinds:
 *   action : { label, onSelect }
 *   choice : { label, options:[{value,label}], get(), set(v) }   left/right cycles, click cycles forward
 *   slider : { label, get() -> 0..1, set(v), step? }              left/right adjusts, click/drag on the bar sets
 *   static : { label }                                            drawn but never focusable or clickable
 * Optional per item: sub (dim secondary text), color (palette key), disabled.
 */
import Phaser from 'phaser';
import { NeonText } from './Neon.js';
import { uiSfx } from './Sound.js';

const SLIDER_W = 70;

export class MenuList extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{x:number,y:number,w:number,rowH?:number,items:object[],color?:string,align?:'left'|'center',scale?:number,
   *          parent?:Phaser.GameObjects.Container, onBack?:function():void,
   *          columns?:number, rowsPerColumn?:number}} o
   *
   * `columns` > 1 lays the SAME list out column-major: item i fills column floor(i / rowsPerColumn),
   * row i % rowsPerColumn. Column-major rather than row-major so up/down keep walking down a column and
   * only wrap into the next one at the bottom; row-major would make `down` jump sideways. Default 1
   * leaves every existing menu pixel-identical.
   */
  constructor(scene, theme, o) {
    super(scene, o.x, o.y);
    this.theme = theme;
    this.w = o.w;
    this.rowH = o.rowH || 16;
    this.items = o.items;
    this.colorKey = o.color || 'cyan';
    this.align = o.align || 'left';
    this.scale1 = o.scale || 1;
    // W6: the biome toggle list outgrew one column (11 signatures), so the list can split. Geometry is
    // computed once here and every row reads it, so a row can never disagree with its own hit zone.
    this.columns = Math.max(1, Math.floor(o.columns || 1));
    this.rowsPerColumn = Math.max(1, Math.floor(o.rowsPerColumn || this.items.length || 1));
    this.colW = this.w / this.columns;
    this.selected = this.items.findIndex((i) => !i.disabled);
    if (this.selected < 0) this.selected = 0;
    this.dragging = -1;
    this.g = new Phaser.GameObjects.Graphics(scene);
    this.add(this.g);
    this.rows = this.items.map((item, i) => this._buildRow(scene, item, i));
    scene.add.existing(this);
    if (o.parent) o.parent.add(this);
    this._unbind = theme.bind(() => this.refresh());
  }

  /** Column-major cell for item i: which column, and which row inside it. */
  _cell(i) {
    return { col: Math.floor(i / this.rowsPerColumn), rowInCol: i % this.rowsPerColumn };
  }

  _buildRow(scene, item, i) {
    const { col, rowInCol } = this._cell(i);
    const x0 = col * this.colW;
    const y = rowInCol * this.rowH;
    const cy = y + this.rowH / 2;
    const center = this.align === 'center';
    const label = new NeonText(scene, this.theme, x0 + (center ? this.colW / 2 : 14), cy, item.label, {
      color: item.color || 'text', scale: this.scale1, anchor: center ? 'center' : 'left', vAnchor: 0.5,
    });
    this.add(label);
    const row = { label, value: null, sub: null, zone: null };
    if (item.kind === 'choice' || item.kind === 'slider') {
      row.value = new NeonText(scene, this.theme, x0 + this.colW - 8, cy, '', { color: this.colorKey, anchor: 'right', vAnchor: 0.5 });
      this.add(row.value);
    }
    if (item.sub) {
      row.sub = new NeonText(scene, this.theme, x0 + this.colW - 8, cy, item.sub, {
        color: 'text', anchor: 'right', vAnchor: 0.5, outline: 'none',
      });
      row.sub.setAlpha(0.6);
      this.add(row.sub);
    }
    // W6's column geometry AND W5's static rows: the zone is sized to the COLUMN, and a static row gets no
    // zone at all. Both matter — a full-width zone under a two-column list would let a click in the left
    // column select a row in the right one.
    const zone = new Phaser.GameObjects.Zone(scene, x0, y, this.colW, this.rowH).setOrigin(0, 0);
    // 'static' rows are headings and summary lines: they are drawn by the same list so they share its
    // geometry, but they must never take focus or swallow a click meant for the row beneath.
    if (item.kind === 'static') {
      row.zone = null;
      return row;
    }
    zone.setInteractive({ useHandCursor: !item.disabled });
    this.add(zone);
    zone.on('pointerover', () => {
      if (!item.disabled) this.setSelected(i, true);
    });
    zone.on('pointerdown', (p, lx) => this._onPointerDown(i, lx));
    zone.on('pointermove', (p, lx) => {
      if (this.dragging === i && p.isDown) this._setSliderFromX(i, lx);
    });
    zone.on('pointerup', () => { this.dragging = -1; });
    zone.on('pointerupoutside', () => { this.dragging = -1; });
    row.zone = zone;
    return row;
  }

  _sliderRange() {
    return { x0: this.w - 8 - SLIDER_W - 26, x1: this.w - 8 - 26 };
  }

  _onPointerDown(i, lx) {
    const item = this.items[i];
    if (item.disabled) return;
    this.setSelected(i, true);
    if (item.kind === 'slider') {
      this.dragging = i;
      this._setSliderFromX(i, lx);
    } else if (item.kind === 'choice') {
      this._adjust(i, lx < this.w * 0.6 && lx < this.w - 90 ? -1 : 1);
    } else {
      this.activate(i);
    }
  }

  _setSliderFromX(i, lx) {
    const { x0, x1 } = this._sliderRange();
    const v = Math.min(1, Math.max(0, (lx - x0) / (x1 - x0)));
    const item = this.items[i];
    const step = item.step || 0.1;
    const snapped = Math.round(v / step) * step;
    if (Math.abs(snapped - item.get()) > 1e-6) {
      item.set(Math.min(1, Math.max(0, snapped)));
      uiSfx(this.scene, 'uiMove');
      this.refresh();
    }
  }

  /** @param {number} i @param {boolean} [silent] @returns {void} */
  setSelected(i, silent) {
    if (i === this.selected) return;
    this.selected = i;
    if (!silent) uiSfx(this.scene, 'uiMove');
    else uiSfx(this.scene, 'uiMove', { volume: 0.5 });
    this.refresh();
  }

  _move(dir) {
    const n = this.items.length;
    let i = this.selected;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (!this.items[i].disabled) break;
    }
    this.setSelected(i);
  }

  _adjust(i, dir) {
    const item = this.items[i];
    if (item.kind === 'choice') {
      const cur = item.options.findIndex((o) => o.value === item.get());
      const next = item.options[(cur + dir + item.options.length) % item.options.length];
      item.set(next.value);
      uiSfx(this.scene, 'uiSelect');
    } else if (item.kind === 'slider') {
      const step = item.step || 0.1;
      const v = Math.min(1, Math.max(0, Math.round((item.get() + dir * step) / step) * step));
      item.set(v);
      uiSfx(this.scene, 'uiMove', { pitch: 0.8 + v * 0.6 });
    }
    this.refresh();
  }

  /** @param {number} [i] @returns {void} */
  activate(i = this.selected) {
    const item = this.items[i];
    if (!item || item.disabled) return;
    if (item.kind === 'choice') this._adjust(i, 1);
    else if (item.kind === 'slider') this._adjust(i, 1);
    else if (item.onSelect) {
      uiSfx(this.scene, 'uiSelect');
      item.onSelect();
    }
  }

  /**
   * @param {string} action MenuInput action
   * @returns {boolean} true if consumed
   */
  handleAction(action) {
    switch (action) {
      case 'up': this._move(-1); return true;
      case 'down': this._move(1); return true;
      case 'left':
      case 'right': {
        const k = this.items[this.selected].kind;
        if (k !== 'choice' && k !== 'slider') return false;
        this._adjust(this.selected, action === 'left' ? -1 : 1);
        return true;
      }
      case 'confirm': this.activate(); return true;
      default: return false;
    }
  }

  /** Repaint highlight + values. @returns {void} */
  refresh() {
    const pal = this.theme.pal;
    const g = this.g;
    g.clear();
    this.items.forEach((item, i) => {
      const row = this.rows[i];
      const sel = i === this.selected && !item.disabled;
      const c = pal[item.color || this.colorKey];
      const y = i * this.rowH;
      if (sel) {
        g.fillStyle(c, 0.16);
        g.fillRect(0, y, this.w, this.rowH - 1);
        g.fillStyle(c, 1);
        g.fillRect(0, y, 2, this.rowH - 1);
      }
      row.label.setColorKey(item.disabled ? 'text' : sel ? (item.color || 'text') : 'text');
      row.label.setAlpha(item.disabled ? 0.35 : sel ? 1 : 0.85);
      if (item.kind === 'choice') {
        const opt = item.options.find((o) => o.value === item.get()) || item.options[0];
        row.value.setText(sel ? `← ${opt.label} →` : opt.label);
        row.value.setColorKey(item.color || this.colorKey);
      } else if (item.kind === 'slider') {
        const v = item.get();
        const { x0, x1 } = this._sliderRange();
        const cy = y + this.rowH / 2;
        g.fillStyle(pal.bgAlt, 1);
        g.fillRect(x0, cy - 2, x1 - x0, 5);
        g.fillStyle(c, sel ? 0.5 : 0.3);
        g.fillRect(x0, cy - 2, x1 - x0, 1);
        g.fillRect(x0, cy + 2, x1 - x0, 1);
        g.fillStyle(c, 1);
        g.fillRect(x0, cy - 1, Math.round((x1 - x0) * v), 3);
        g.fillStyle(pal.text, 1);
        g.fillRect(x0 + Math.round((x1 - x0) * v) - 1, cy - 4, 2, 9);
        row.value.setText(`${Math.round(v * 100)}%`);
        row.value.setColorKey(item.color || this.colorKey);
      }
      if (row.sub) row.sub.setColorKey('text');
    });
  }

  destroy(fromScene) {
    if (this._unbind) this._unbind();
    this._unbind = null;
    super.destroy(fromScene);
  }
}
