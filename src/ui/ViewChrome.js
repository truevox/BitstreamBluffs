/**
 * OWNER: UI engineer.
 * Shared chrome for the modal sub-views (Views.js and friends): keycap hint rows, section dividers, glowing
 * progress bars, focus rings, state chips and the staggered row reveal. Everything paints from palette keys
 * (so the colour-blind palette and equipped UI themes apply) and nothing here changes a view's geometry:
 * helpers draw INTO space a view already owns, or on their own Graphics layered under/over the content.
 *
 * Paint helpers are plain functions over a Graphics so a view can fold them into one repaint; the two
 * widgets (Keycaps, SectionHeader) are Containers that bind to the theme themselves.
 */
import Phaser from 'phaser';
import { NeonText, strokeRectPx, glowRectPx } from './Neon.js';
import { measureText } from './PixelFont.js';
import { isReducedMotion, tweenProgress, Ease } from './Motion.js';

// ------------------------------------------------------------------ pixel patterns

/** 5x6 padlock. */
export const LOCK_GLYPH = Object.freeze(['.XXX.', 'X...X', 'X...X', 'XXXXX', 'XXXXX', 'XXXXX']);
/** 5x5 shard (the currency's diamond). */
export const SHARD_GLYPH = Object.freeze(['..X..', '.XXX.', 'XXXXX', '.XXX.', '..X..']);
/** 5x4 tick. */
export const CHECK_GLYPH = Object.freeze(['....X', 'X..X.', '.XX..', '..X..']);

/**
 * Paint a small bitmap given as rows of 'X' / '.', one fillRect per run.
 * @param {Phaser.GameObjects.Graphics} g @param {number} x @param {number} y
 * @param {readonly string[]} rows @param {number} color @param {number} [alpha=1]
 */
export function paintPattern(g, x, y, rows, color, alpha = 1) {
  g.fillStyle(color, alpha);
  rows.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (row[c] !== 'X') { c += 1; continue; }
      let e = c;
      while (e < row.length && row[e] === 'X') e += 1;
      g.fillRect(x + c, y + r, e - c, 1);
      c = e;
    }
  });
}

// ------------------------------------------------------------------ podium

/**
 * Palette key for a leaderboard rank (0-based): gold ~ amber, silver ~ text, bronze ~ magenta. Shape carries
 * the rank too (the numbered chip), so the colour-blind palette never has to tell them apart by hue alone.
 * @param {number} i @returns {'amber'|'text'|'magenta'|null} null below the podium
 */
export function podiumKey(i) {
  return i === 0 ? 'amber' : i === 1 ? 'text' : i === 2 ? 'magenta' : null;
}

// ------------------------------------------------------------------ rules, bars, rings, chips

/**
 * A horizontal rule that fades out to the right, with a bright pip at its start: the section divider.
 * @param {Phaser.GameObjects.Graphics} g @param {number} x0 @param {number} x1 @param {number} y
 * @param {number} color @param {number} [alpha=0.7]
 */
export function paintRule(g, x0, x1, y, color, alpha = 0.7) {
  const w = x1 - x0;
  if (w <= 2) return;
  const steps = 8;
  const sw = Math.ceil(w / steps);
  for (let i = 0; i < steps; i++) {
    g.fillStyle(color, alpha * (1 - i / (steps * 1.25)) * 0.8);
    g.fillRect(x0 + i * sw, y, Math.min(sw, x1 - (x0 + i * sw)), 1);
  }
  g.fillStyle(color, 1);
  g.fillRect(x0, y - 1, 2, 3);
}

/**
 * A glowing progress bar: dark well, outer glow, a segmented fill with a bright top half and a hot leading
 * edge, and a crisp border. `ratio` is 0..1.
 * @param {Phaser.GameObjects.Graphics} g @param {Object<string,number>} pal
 * @param {{x:number,y:number,w:number,h:number}} r @param {number} ratio @param {string} colorKey
 * @param {{segments?:number, glow?:number}} [o]
 */
export function paintGlowBar(g, pal, r, ratio, colorKey, o = {}) {
  const c = pal[colorKey];
  const { x, y, w, h } = r;
  const k = Math.min(1, Math.max(0, Number(ratio) || 0));
  glowRectPx(g, x, y, w, h, c, o.glow === undefined ? 0.8 : o.glow);
  g.fillStyle(pal.bg, 1);
  g.fillRect(x, y, w, h);
  const iw = w - 2;
  const fw = Math.round(iw * k);
  if (fw > 0) {
    g.fillStyle(c, 0.6);
    g.fillRect(x + 1, y + 1, fw, h - 2);
    g.fillStyle(c, 1);
    g.fillRect(x + 1, y + 1, fw, Math.max(1, Math.ceil((h - 2) / 2)));
    if (fw > 2) {
      g.fillStyle(pal.text, 0.9);
      g.fillRect(x + fw, y + 1, 1, h - 2);
    }
  }
  const segs = o.segments === undefined ? 10 : o.segments;
  if (segs > 1) {
    g.fillStyle(pal.bg, 0.55);
    for (let i = 1; i < segs; i++) g.fillRect(x + 1 + Math.round((iw * i) / segs), y + 1, 1, h - 2);
  }
  strokeRectPx(g, x, y, w, h, c, 0.9);
}

/**
 * Focus ring for a button/row. The FIRST stroke is the same strokeRect the views always drew (tests and
 * layouts read it); the glow halo and bright corners are extra.
 * @param {Phaser.GameObjects.Graphics} g @param {Object<string,number>} pal
 * @param {{x:number,y:number,w:number,h:number}} r @param {string} colorKey
 */
export function paintFocusRing(g, pal, r, colorKey) {
  const c = pal[colorKey];
  g.lineStyle(1, c, 1);
  g.strokeRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3);
  strokeRectPx(g, r.x - 4, r.y - 4, r.w + 8, r.h + 8, c, 0.14);
  strokeRectPx(g, r.x - 3, r.y - 3, r.w + 6, r.h + 6, c, 0.3);
  g.fillStyle(pal.text, 0.95);
  for (const [cx, cy] of [[r.x - 2, r.y - 2], [r.x + r.w + 1, r.y - 2], [r.x - 2, r.y + r.h + 1], [r.x + r.w + 1, r.y + r.h + 1]]) g.fillRect(cx, cy, 1, 1);
}

/**
 * A state chip behind a right-aligned state word: 'solid' (filled: equipped / active), 'outline' (owned),
 * 'bright' (can be bought now: outline + faint fill) or 'dim' (locked). `glyph` ('lock' | 'shard') draws a
 * small icon at its left; the chip box grows to the left to make room, and the returned box says where it
 * landed.
 * @param {Phaser.GameObjects.Graphics} g @param {Object<string,number>} pal
 * @param {{right:number, y:number, textW:number, h?:number, colorKey:string, mode:'solid'|'outline'|'bright'|'dim', glyph?:'lock'|'shard'}} o
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function paintStateChip(g, pal, o) {
  const h = o.h || 9;
  const lockW = o.glyph ? 8 : 0;
  const w = o.textW + 6 + lockW;
  const x = o.right - w;
  const c = pal[o.colorKey];
  const a = o.mode === 'solid' ? 0.9 : o.mode === 'bright' ? 0.9 : o.mode === 'outline' ? 0.55 : 0.3;
  if (o.mode === 'solid') {
    g.fillStyle(c, 0.28);
    g.fillRect(x, o.y, w, h);
  } else if (o.mode === 'bright') {
    g.fillStyle(c, 0.12);
    g.fillRect(x, o.y, w, h);
  }
  // pixel-rounded border: the four corners are left open
  g.fillStyle(c, a);
  g.fillRect(x + 1, o.y, w - 2, 1);
  g.fillRect(x + 1, o.y + h - 1, w - 2, 1);
  g.fillRect(x, o.y + 1, 1, h - 2);
  g.fillRect(x + w - 1, o.y + 1, 1, h - 2);
  if (o.glyph === 'lock') paintPattern(g, x + 3, o.y + 1, LOCK_GLYPH, pal.text, 0.55);
  else if (o.glyph === 'shard') paintPattern(g, x + 3, o.y + 2, SHARD_GLYPH, c, 1);
  return { x, y: o.y, w, h };
}

// ------------------------------------------------------------------ widgets

const CAP_H = 11;

/**
 * A row of keycap hints: `[ENTER] CONFIRM   [← →] [N] SWITCH BOARD`. Each item is {keys:[...]|key, label}.
 * `x` is the left edge, or the right edge with align:'right'. Paint only (no hit zones).
 * `summary` is the plain-text reading of the row (tests, screen readers); `totalW` its pixel width.
 */
export class Keycaps extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme
   * @param {{x:number,y:number,items:Array<{keys?:string[], key?:string, label?:string}>,
   *          align?:'left'|'right', color?:string, parent?:Phaser.GameObjects.Container}} o
   */
  constructor(scene, theme, o) {
    super(scene, 0, o.y);
    this.theme = theme;
    this.colorKey = o.color || 'cyan';
    this.caps = []; // {x,w}
    this.summary = '';
    const GAP_KEY = 2;
    const GAP_LABEL = 4;
    const GAP_ITEM = 9;
    let cx = 0;
    const labels = [];
    const keys = [];
    const items = (o.items || []).filter(Boolean);
    items.forEach((it, n) => {
      const ks = it.keys || (it.key ? [it.key] : []);
      ks.forEach((k, ki) => {
        const w = Math.max(11, measureText(k) + 9);
        this.caps.push({ x: cx, w });
        keys.push({ x: cx + Math.floor((w - measureText(k)) / 2), text: k });
        cx += w + (ki < ks.length - 1 ? GAP_KEY : 0);
      });
      if (it.label) {
        cx += GAP_LABEL;
        labels.push({ x: cx, text: it.label });
        cx += measureText(it.label);
      }
      if (n < items.length - 1) cx += GAP_ITEM;
      this.summary += (n ? '  ' : '') + ks.join(' / ') + (it.label ? ' ' + it.label : '');
    });
    this.totalW = cx;
    this.setX(Math.round(o.align === 'right' ? o.x - cx : o.x));
    this.g = new Phaser.GameObjects.Graphics(scene);
    this.add(this.g);
    for (const k of keys) this.add(new NeonText(scene, theme, k.x, 2, k.text, { color: 'text', outline: 'none' }));
    for (const l of labels) this.add(new NeonText(scene, theme, l.x, 2, l.text, { color: 'text', outline: 'none', alpha: 0.65 }));
    scene.add.existing(this);
    if (o.parent) o.parent.add(this);
    this._unbind = theme.bind((pal) => this._paint(pal));
  }

  _paint(pal) {
    const g = this.g;
    if (!g) return;
    g.clear();
    const c = pal[this.colorKey];
    for (const cap of this.caps) {
      const { x, w } = cap;
      g.fillStyle(pal.bgAlt, 1);
      g.fillRect(x, 0, w, CAP_H - 1);
      g.fillStyle(pal.text, 0.1);
      g.fillRect(x + 1, 1, w - 2, 3);
      // border with open corners, and a heavier bottom edge: the key's lip
      g.fillStyle(c, 0.6);
      g.fillRect(x + 1, 0, w - 2, 1);
      g.fillRect(x, 1, 1, CAP_H - 3);
      g.fillRect(x + w - 1, 1, 1, CAP_H - 3);
      g.fillStyle(c, 1);
      g.fillRect(x + 1, CAP_H - 2, w - 2, 1);
      g.fillStyle(pal.bg, 0.9);
      g.fillRect(x + 1, CAP_H - 1, w - 2, 1);
    }
  }

  destroy(fromScene) {
    if (this._unbind) this._unbind();
    this._unbind = null;
    this.g = null;
    super.destroy(fromScene);
  }
}

/**
 * Section header: label, then a fading rule to `w` (or to `ruleTo`, when something sits at the right).
 */
export class SectionHeader extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme
   * @param {{x:number,y:number,w:number,text:string,color?:string,ruleTo?:number, parent?:Phaser.GameObjects.Container}} o
   */
  constructor(scene, theme, o) {
    super(scene, o.x, o.y);
    this.theme = theme;
    this.colorKey = o.color || 'amber';
    this.w = o.w;
    this.ruleFrom = measureText(o.text) + 6;
    this.ruleTo = o.ruleTo === undefined ? o.w : o.ruleTo;
    this.g = new Phaser.GameObjects.Graphics(scene);
    this.add(this.g);
    this.label = new NeonText(scene, theme, 0, 0, o.text, { color: this.colorKey, outline: 'none' });
    this.add(this.label);
    scene.add.existing(this);
    if (o.parent) o.parent.add(this);
    this._unbind = theme.bind((pal) => {
      if (!this.g) return;
      this.g.clear();
      paintRule(this.g, this.ruleFrom, this.ruleTo, 4, pal[this.colorKey], 0.7);
    });
  }

  destroy(fromScene) {
    if (this._unbind) this._unbind();
    this._unbind = null;
    this.g = null;
    super.destroy(fromScene);
  }
}

// ------------------------------------------------------------------ staggered reveal

const hasTweens = (scene) => !!(scene && scene.tweens && typeof scene.tweens.addCounter === 'function');
const live = (o) => !!(o && o.scene);

/** Where a reveal starts (ms): after the panel's CRT zip has opened. */
export const REVEAL_START = 150;
/** Gap between consecutive rows (ms). */
export const REVEAL_STEP = 24;

/**
 * Fade groups of objects in one after another (alpha 0 -> its current value). Skipped under reduce motion
 * and on scenes with no tween manager, so the end state is always what a test or a reduced-motion player sees.
 * Only use it on objects nothing else re-alphas while the reveal runs.
 * @param {Phaser.Scene} scene @param {Array<Array<Phaser.GameObjects.GameObject>>} groups
 * @param {{start?:number, step?:number, duration?:number}} [o]
 * @returns {void}
 */
export function staggerAlpha(scene, groups, o = {}) {
  if (!hasTweens(scene) || isReducedMotion(scene)) return;
  const start = o.start === undefined ? REVEAL_START : o.start;
  const step = o.step === undefined ? REVEAL_STEP : o.step;
  groups.forEach((objs, i) => {
    const list = (objs || []).filter(live);
    if (!list.length) return;
    const base = list.map((ob) => ob.alpha);
    list.forEach((ob) => ob.setAlpha(0));
    tweenProgress(scene, {
      duration: o.duration || 150,
      delay: start + i * step,
      ease: Ease.outQuad,
      onUpdate: (p) => list.forEach((ob, k) => { if (live(ob)) ob.setAlpha(base[k] * p); }),
    });
  });
}

/**
 * Reveal a MenuList's rows with a short slide-in, top to bottom. Uses visibility and x (never alpha, which
 * MenuList.refresh owns), and restores both exactly at the end of each row's tween.
 * @param {Phaser.Scene} scene @param {{rows?:Array<Object>}} menu
 * @param {{start?:number, step?:number, slide?:number}} [o]
 * @returns {void}
 */
export function staggerMenuRows(scene, menu, o = {}) {
  if (!menu || !menu.rows || !hasTweens(scene) || isReducedMotion(scene)) return;
  const start = o.start === undefined ? REVEAL_START : o.start;
  const step = o.step === undefined ? REVEAL_STEP : o.step;
  const slide = o.slide === undefined ? 8 : o.slide;
  menu.rows.forEach((row, i) => {
    const parts = [row.label, row.value, row.sub, row.badge].filter(live);
    if (!parts.length) return;
    const bx = parts.map((p) => p.x);
    parts.forEach((p) => { p.setVisible(false); p.setX(p.x - slide); });
    let shown = false;
    tweenProgress(scene, {
      duration: 150,
      delay: start + Math.min(i, 14) * step,
      ease: Ease.outCubic,
      onUpdate: (p) => {
        parts.forEach((part, k) => {
          if (!live(part)) return;
          if (!shown) part.setVisible(true);
          part.setX(bx[k] - slide * (1 - p));
        });
        shown = true;
      },
    });
  });
}
