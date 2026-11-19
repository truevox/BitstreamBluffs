/**
 * OWNER: UI engineer.
 * HOW TO PLAY: the controls reference that used to be the Title's CONTROLS panel, now a modal view reachable
 * from the Title (H key, pad X/Y or SELECT, the tappable HOW TO PLAY chip) and from Settings.
 *
 * Three sections, each drawn the way the player meets that device: KEYBOARD as keycaps (following the
 * player's CONTROL LAYOUT setting), GAMEPAD as face buttons / shoulder pills / stick and d-pad glyphs, TOUCH as
 * a phone silhouette with the two thumb clusters plus a legend. All geometry comes from HowToPlayLayout.js
 * (pure, overlap-tested); this file only paints it.
 *
 * Usage (the View contract): `new HowToPlayView(scene, theme, { onClose })`, then feed it MenuInput actions
 * through handleAction(); cancel or confirm closes it; destroy() removes everything.
 *
 * Why the subclass is built lazily: Views.js (SettingsView) imports this module, and this module extends
 * Views.js's View. A top-level `class HowToPlayView extends View` would run while Views.js is still mid-
 * evaluation whenever Views.js is imported first, and throw (View is in its temporal dead zone). Creating
 * the subclass on first construction makes the cycle harmless in either import order. `new HowToPlayView()`
 * still returns a real View subclass instance, and `instanceof HowToPlayView` still works (Symbol.hasInstance).
 */
import Phaser from 'phaser';
import { REG } from '../constants.js';
import { View } from './Views.js';
import { NeonText, strokeRectPx } from './Neon.js';
import { measureText } from './PixelFont.js';
import { mixColor } from './MenuArt.js';
import { isReducedMotion, onTick } from './Motion.js';
import { HOW_TO_PLAY, howToPlayLayout } from './HowToPlayLayout.js';

const CAP_H = 11;

/** Keycap: dark face, sheen, open-corner border in the section colour and a heavier lip. */
function paintKeycap(g, pal, b, colorKey, lit = 0) {
  const c = pal[colorKey];
  g.fillStyle(mixColor(pal.bgAlt, c, 0.12 + lit * 0.3), 1);
  g.fillRect(b.x, b.y, b.w, CAP_H - 1);
  g.fillStyle(pal.text, 0.1 + lit * 0.15);
  g.fillRect(b.x + 1, b.y + 1, b.w - 2, 3);
  g.fillStyle(c, 0.6 + lit * 0.4);
  g.fillRect(b.x + 1, b.y, b.w - 2, 1);
  g.fillRect(b.x, b.y + 1, 1, CAP_H - 3);
  g.fillRect(b.x + b.w - 1, b.y + 1, 1, CAP_H - 3);
  g.fillStyle(c, 1);
  g.fillRect(b.x + 1, b.y + CAP_H - 2, b.w - 2, 1);
  g.fillStyle(pal.bg, 0.9);
  g.fillRect(b.x + 1, b.y + CAP_H - 1, b.w - 2, 1);
}

/** Pixel disc of diameter `d` at top-left (x, y): one fillRect per row. */
function disc(g, x, y, d, color, alpha) {
  const r = d / 2;
  g.fillStyle(color, alpha);
  for (let row = 0; row < d; row++) {
    const dy = row + 0.5 - r;
    const hw = Math.sqrt(Math.max(0, r * r - dy * dy));
    const w = Math.max(1, Math.round(hw * 2));
    g.fillRect(x + Math.round(r - w / 2), y + row, w, 1);
  }
}

/** Gamepad glyph: round face button, shoulder/system pill, analog stick or d-pad cross. */
function paintPadGlyph(g, pal, b, glyph) {
  const c = pal[glyph.color];
  if (glyph.shape === 'face') {
    disc(g, b.x, b.y, CAP_H, c, 1);
    disc(g, b.x + 1, b.y + 1, CAP_H - 2, mixColor(pal.bg, c, 0.3), 1);
    g.fillStyle(pal.text, 0.25);
    g.fillRect(b.x + 3, b.y + 2, 4, 1);
  } else if (glyph.shape === 'stick') {
    disc(g, b.x, b.y, CAP_H, c, 0.55);
    disc(g, b.x + 2, b.y + 2, CAP_H - 4, mixColor(pal.bg, c, 0.35), 1);
  } else if (glyph.shape === 'dpad') {
    const m = Math.floor(CAP_H / 2) - 1;
    g.fillStyle(c, 0.9);
    g.fillRect(b.x + m, b.y, 3, CAP_H);
    g.fillRect(b.x, b.y + m, CAP_H, 3);
    g.fillStyle(pal.bg, 0.9);
    g.fillRect(b.x + m + 1, b.y + m + 1, 1, 1);
  } else {
    // pill: rounded ends (corners cut), tinted face, bright rim
    g.fillStyle(mixColor(pal.bgAlt, c, 0.25), 1);
    g.fillRect(b.x + 1, b.y, b.w - 2, CAP_H);
    g.fillRect(b.x, b.y + 1, b.w, CAP_H - 2);
    g.fillStyle(c, 0.9);
    g.fillRect(b.x + 2, b.y, b.w - 4, 1);
    g.fillRect(b.x + 2, b.y + CAP_H - 1, b.w - 4, 1);
    g.fillRect(b.x, b.y + 2, 1, CAP_H - 4);
    g.fillRect(b.x + b.w - 1, b.y + 2, 1, CAP_H - 4);
    g.fillRect(b.x + 1, b.y + 1, 1, 1);
    g.fillRect(b.x + b.w - 2, b.y + 1, 1, 1);
    g.fillRect(b.x + 1, b.y + CAP_H - 2, 1, 1);
    g.fillRect(b.x + b.w - 2, b.y + CAP_H - 2, 1, 1);
  }
}

/** Section header: label + a fading rule to the section's right edge. */
function paintHeaderRule(g, pal, b, text, colorKey) {
  const c = pal[colorKey];
  const x0 = b.x + measureText(text) + 6;
  const x1 = b.x + b.w;
  const steps = 8;
  const sw = Math.ceil((x1 - x0) / steps);
  for (let i = 0; i < steps; i++) {
    g.fillStyle(c, 0.6 * (1 - i / (steps * 1.2)));
    g.fillRect(x0 + i * sw, b.y + 4, Math.max(0, Math.min(sw, x1 - (x0 + i * sw))), 1);
  }
  g.fillStyle(c, 1);
  g.fillRect(x0, b.y + 3, 2, 3);
}

let Impl = null;

function buildImpl() {
  return class HowToPlayViewImpl extends View {
    /**
     * @param {Phaser.Scene} scene
     * @param {import('./Theme.js').Theme} theme
     * @param {{onClose:function():void}} o
     */
    constructor(scene, theme, o) {
      super(scene, theme, { w: HOW_TO_PLAY.w, h: HOW_TO_PLAY.h, y: HOW_TO_PLAY.y, title: 'HOW TO PLAY', color: 'cyan', onClose: o.onClose });
      let layout = 'tricksRight';
      try { layout = (scene.registry.get(REG.SETTINGS) || {}).controlLayout || layout; } catch (e) { /* default */ }
      const L = (this.layout = howToPlayLayout(layout));
      const add = (x, y, text, opts) => this.panel.add(new NeonText(scene, theme, x, y, text, { outline: 'none', ...opts }));
      this.g = new Phaser.GameObjects.Graphics(scene);
      this.panel.add(this.g);
      // the "pressed" key cycles through the keycaps, one at a time, like an attract-mode demo
      this.lit = -1;

      add(L.layoutChip.x, L.layoutChip.y, L.layoutChip.text, { color: 'amber', alpha: 0.85 });
      add(L.keyboard.header.x, L.keyboard.header.y, 'KEYBOARD', { color: 'amber' });
      add(L.gamepad.header.x, L.gamepad.header.y, 'GAMEPAD', { color: 'cyan' });
      add(L.touch.header.x, L.touch.header.y, 'TOUCH', { color: 'lime' });
      for (const row of L.keyboard.rows) {
        for (const c of row.caps) add(c.x + Math.floor((c.w - measureText(c.glyph.text)) / 2), c.y + 1, c.glyph.text, { color: 'text' });
        for (const j of row.joins) add(j.x, j.y, j.text, { color: 'amber', alpha: 0.8 });
        add(row.label.x, row.label.y, row.label.text, { color: 'text', alpha: 0.9 });
      }
      for (const row of L.gamepad.rows) {
        for (const c of row.caps) {
          if (!c.glyph.text) continue;
          const tx = c.x + Math.floor((c.w - measureText(c.glyph.text)) / 2) + (c.glyph.shape === 'face' ? 0 : 0);
          add(tx, c.y + (c.glyph.shape === 'pill' ? 2 : 2), c.glyph.text, { color: c.glyph.shape === 'stick' ? c.glyph.color : 'text' });
        }
        add(row.label.x, row.label.y, row.label.text, { color: 'text', alpha: 0.9 });
      }
      for (const gr of L.touch.groups) {
        add(gr.title.x, gr.title.y, gr.title.text, { color: gr.color });
        add(gr.items.x, gr.items.y, gr.items.text, { color: 'text', alpha: 0.85 });
      }
      add(L.tip.x, L.tip.y, L.tip.text, { color: 'magenta', alpha: 0.95 });
      add(L.backHint.x, L.backHint.y, L.backHint.text, { color: 'text', alpha: 0.5 });

      this._unbind = theme.bind((pal) => this._paint(pal));
      this._stopTick = onTick(scene, (time) => {
        if (!this.alive || !this.g || !this.g.scene) return;
        const n = L.keyboard.rows.length;
        const lit = isReducedMotion(scene) ? -1 : Math.floor(time / 650) % (n + 3);
        if (lit !== this.lit) {
          this.lit = lit;
          this._paint(theme.pal);
        }
      });
    }

    _paint(pal) {
      const g = this.g;
      if (!g || !g.scene) return;
      const L = this.layout;
      g.clear();
      paintHeaderRule(g, pal, L.keyboard.header, 'KEYBOARD', 'amber');
      paintHeaderRule(g, pal, L.gamepad.header, 'GAMEPAD', 'cyan');
      paintHeaderRule(g, pal, L.touch.header, 'TOUCH', 'lime');
      // a faint divider between the keyboard and gamepad columns
      g.fillStyle(pal.cyan, 0.18);
      g.fillRect(L.gamepad.header.x - 6, L.gamepad.header.y + 2, 1, L.touch.header.y - L.gamepad.header.y - 8);
      L.keyboard.rows.forEach((row, i) => {
        for (const c of row.caps) paintKeycap(g, pal, c, 'amber', i === this.lit ? 1 : 0);
      });
      for (const row of L.gamepad.rows) for (const c of row.caps) paintPadGlyph(g, pal, c, c.glyph);
      this._paintPhone(g, pal, L.touch.phone);
    }

    /** A landscape phone with the overlay's two thumb clusters and the top bar, in the overlay's colours. */
    _paintPhone(g, pal, b) {
      g.fillStyle(pal.bg, 1);
      g.fillRect(b.x, b.y, b.w, b.h);
      strokeRectPx(g, b.x, b.y, b.w, b.h, pal.text, 0.7);
      strokeRectPx(g, b.x + 2, b.y + 2, b.w - 4, b.h - 4, pal.text, 0.15);
      // a hint of the run on screen: a slope line
      g.fillStyle(pal.cyan, 0.35);
      for (let x = 0; x < b.w - 20; x++) g.fillRect(b.x + 10 + x, b.y + 14 + Math.round(x * 0.22), 1, 1);
      // top: reset + pause
      g.fillStyle(pal.amber, 0.85);
      g.fillRect(b.x + 6, b.y + 5, 6, 3);
      g.fillRect(b.x + 14, b.y + 5, 6, 3);
      // left thumb: 2x2 (brake, tuck / tilt back, tilt fwd big)
      const cell = (x, y, w, h, key, a = 0.9) => {
        g.fillStyle(mixColor(pal.bg, pal[key], 0.35), 1);
        g.fillRect(x, y, w, h);
        strokeRectPx(g, x, y, w, h, pal[key], a);
      };
      cell(b.x + 5, b.y + b.h - 22, 8, 7, 'amber');
      cell(b.x + 15, b.y + b.h - 22, 8, 7, 'lime');
      cell(b.x + 5, b.y + b.h - 13, 8, 9, 'cyan');
      cell(b.x + 15, b.y + b.h - 13, 8, 9, 'cyan');
      // right thumb: 3x2 (spin ccw, air brake, spin cw / push, hop big, chute)
      const rx = b.x + b.w - 33;
      cell(rx, b.y + b.h - 22, 8, 7, 'lime');
      cell(rx + 10, b.y + b.h - 22, 8, 7, 'amber');
      cell(rx + 20, b.y + b.h - 22, 8, 7, 'lime');
      cell(rx, b.y + b.h - 13, 8, 9, 'cyan');
      cell(rx + 10, b.y + b.h - 13, 8, 9, 'magenta');
      cell(rx + 20, b.y + b.h - 13, 8, 9, 'amber');
    }

    handleAction(action) {
      if (action === 'cancel' || action === 'confirm') this.close();
      return true;
    }

    destroy() {
      if (this._stopTick) this._stopTick();
      this._stopTick = null;
      if (this._unbind) this._unbind();
      this._unbind = null;
      this.g = null;
      super.destroy();
    }
  };
}

/**
 * HOW TO PLAY modal view. See the file header for why this is a factory-backed class.
 */
export class HowToPlayView {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{onClose:function():void}} o
   */
  constructor(scene, theme, o) {
    if (!Impl) Impl = buildImpl();
    // eslint-disable-next-line no-constructor-return
    return new Impl(scene, theme, o);
  }

  static [Symbol.hasInstance](obj) {
    return !!Impl && obj instanceof Impl;
  }
}
