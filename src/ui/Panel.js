/**
 * OWNER: UI engineer.
 * Neon-bordered panel with optional title tab. Repaints on palette change.
 *
 * Look (synthwave cabinet): a dark glass fill with a faint top sheen, a double neon border whose outer
 * strokes fall off in alpha to fake a soft glow (pixel-exact rects, no blur shader, so it stays crisp under
 * pixelArt and costs nothing), an angled title tab, and corner brackets that breathe outwards by a pixel.
 *
 * Geometry contract (layout code and tests rely on it): the container's (x, y) is the panel's top-left, the
 * body is exactly frameWidth x h, the title text sits at (8, 4) and content starts below y 16. The glow strokes paint
 * up to 2 px OUTSIDE the box; nothing else does.
 */
import Phaser from 'phaser';
import { NeonText, strokeRectPx, cornerTicks, glowRectPx } from './Neon.js';
import { measureText } from './PixelFont.js';
import { isReducedMotion, onTick } from './Motion.js';

/** Height of the title tab (the old title bar's height, so title-relative content does not move). */
const TAB_H = 15;
/** Horizontal run of the tab's slanted right edge. */
const TAB_SLANT = 10;

export class Panel extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{x:number, y:number, w:number, h:number, color?:string, title?:string, fillAlpha?:number, parent?:Phaser.GameObjects.Container}} o
   */
  constructor(scene, theme, o) {
    super(scene, o.x, o.y);
    this.theme = theme;
    // #241: Phaser Container.setPosition(x,y,z,w) sets the transform's `w`
    // coordinate to 0 whenever the open animation moves this Panel. Do NOT
    // store our layout width in that inherited `w` property: doing so erased
    // the width (432 -> 0) after every modal transition and could collapse
    // palette repaints, frame borders and geometry audits.
    this.frameWidth = o.w;
    this.h = o.h;
    this.colorKey = o.color || 'cyan';
    this.fillAlpha = o.fillAlpha === undefined ? 0.92 : o.fillAlpha;
    this.g = new Phaser.GameObjects.Graphics(scene);
    this.add(this.g);
    // Corner brackets live on their own Graphics so the per-frame breathing never repaints the frame.
    this.fx = new Phaser.GameObjects.Graphics(scene);
    this.add(this.fx);
    this.titleText = null;
    this.hasTitle = !!o.title;
    if (o.title) {
      this.titleText = new NeonText(scene, theme, 8, 4, o.title, { color: this.colorKey, outline: 'glow' });
      this.add(this.titleText);
    }
    this._breath = -1; // last painted bracket state, so idle frames skip the repaint
    scene.add.existing(this);
    if (o.parent) o.parent.add(this);
    this._unbind = theme.bind((pal) => this._paint(pal));
    // Phase offset by position so a screen full of panels does not pulse in lockstep.
    this._phase = ((o.x * 7 + o.y * 13) % 1000) / 1000;
    this._stopTick = onTick(scene, (time) => this._tick(time));
  }

  _paint(pal) {
    const g = this.g;
    const { frameWidth: w, h } = this;
    g.clear();
    const c = pal[this.colorKey];
    const fa = this.fillAlpha;
    // glass: dark body, then a sheen that fades down the top third (bgAlt bands at falling alpha)
    g.fillStyle(pal.bg, fa);
    g.fillRect(0, 0, w, h);
    const sheenH = Math.max(4, Math.round(h * 0.34));
    const bands = 4;
    for (let i = 0; i < bands; i++) {
      g.fillStyle(pal.bgAlt, fa * 0.75 * (1 - i / bands));
      g.fillRect(1, 1 + Math.round((i * sheenH) / bands), w - 2, Math.ceil(sheenH / bands));
    }
    // the glass edge catching light: one faint line under the top border
    g.fillStyle(pal.text, 0.06);
    g.fillRect(2, 2, w - 4, 1);
    // soft outer glow (outside the box), main neon border, inner hairline
    glowRectPx(g, 0, 0, w, h, c);
    strokeRectPx(g, 0, 0, w, h, c, 0.85);
    strokeRectPx(g, 2, 2, w - 4, h - 4, c, 0.16);
    if (this.hasTitle) this._paintTab(g, pal, c);
    if (this.titleText) this.titleText.setColorKey(this.colorKey);
    this._breath = -1;
    this._paintBrackets(0);
  }

  /** Angled title tab: slanted right edge, filled faintly, with a rule across the panel under it. */
  _paintTab(g, pal, c) {
    const tw = Math.min(this.frameWidth - TAB_SLANT - 4, (this.titleText ? measureText(this.titleText.main.text) : 0) + 16);
    for (let r = 0; r < TAB_H - 1; r++) {
      // per-row runs give a crisp pixel stair on the slant (a filled triangle would anti-alias)
      const rw = tw + Math.round(TAB_SLANT * (1 - r / (TAB_H - 2)));
      g.fillStyle(c, 0.2);
      g.fillRect(1, 1 + r, rw, 1);
      g.fillStyle(c, 0.9);
      g.fillRect(rw, 1 + r, 1, 1);
    }
    // the rule the old title bar drew, now bright under the tab and dimmer beyond it
    g.fillStyle(c, 0.9);
    g.fillRect(1, TAB_H, tw + 1, 1);
    g.fillStyle(c, 0.4);
    g.fillRect(tw + 2, TAB_H, this.frameWidth - tw - 3, 1);
    // three data ticks after the slant: a cabinet-label detail
    for (let i = 0; i < 3; i++) {
      g.fillStyle(c, 0.55 - i * 0.15);
      g.fillRect(tw + TAB_SLANT + 6 + i * 4, 6, 2, 3);
    }
  }

  /**
   * Corner brackets, `out` px outside the frame (0 or 1: the breathing), with a bright pixel at each corner.
   * @param {number} out
   */
  _paintBrackets(out) {
    const pal = this.theme.pal;
    const c = pal[this.colorKey];
    const f = this.fx;
    f.clear();
    const o = 1 + out;
    cornerTicks(f, -o, -o, this.frameWidth + o * 2, this.h + o * 2, c, 8, 0.95);
    f.fillStyle(pal.text, 0.9);
    for (const [x, y] of [[-o, -o], [this.frameWidth - 1 + o, -o], [-o, this.h - 1 + o], [this.frameWidth - 1 + o, this.h - 1 + o]]) f.fillRect(x, y, 1, 1);
  }

  _tick(time) {
    if (!this.scene || !this.visible) return;
    // Reduced motion: brackets hold still (state 0); otherwise a 2.4 s breath, out for the top ~40%.
    const out = isReducedMotion(this.scene) ? 0 : (Math.sin((time / 2400 + this._phase) * Math.PI * 2) > 0.2 ? 1 : 0);
    if (out === this._breath) return;
    this._breath = out;
    this._paintBrackets(out);
  }

  /** @param {string} key @returns {this} */
  setColorKey(key) {
    this.colorKey = key;
    this._paint(this.theme.pal);
    return this;
  }

  /** @param {string} str @returns {this} */
  setTitle(str) {
    if (this.titleText) {
      this.titleText.setText(str);
      this._paint(this.theme.pal); // the tab is sized to the title
    }
    return this;
  }

  destroy(fromScene) {
    if (this._stopTick) this._stopTick();
    this._stopTick = null;
    if (this._unbind) this._unbind();
    this._unbind = null;
    super.destroy(fromScene);
  }
}
