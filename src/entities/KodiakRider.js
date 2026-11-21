/** Hostile Kodiak drawing (issue #47). Visual only: the bear's state lives in RunScene.kodiak and
 * is advanced by systems/Kodiaks.js in the fixed tick. Each bear reads by SHAPE as well as colour:
 * the grizzly's shoulder hump, the polar bear's long neck and low body, the black bear's round
 * build, tall ears and tan muzzle. A telegraph ring precedes every attack (red = real, amber =
 * Kernel-Panic feint), and an off-screen bear shows as a chevron at the screen edge.
 */
import { FONT_KEY } from '../ui/PixelFont.js';

export const KODIAK_DEPTH = 19;

export class KodiakRider {
  /** @param {Phaser.Scene} scene @param {Object<string,number>} palette */
  constructor(scene, palette) {
    this.scene = scene;
    this.palette = palette;
    this.gfx = scene.add.graphics().setDepth(KODIAK_DEPTH);
    this.labels = [];
  }

  /** The i-th name tag (a small pool: one per pack member). */
  _label(i) {
    while (this.labels.length <= i) {
      this.labels.push(this.scene.add.bitmapText(0, 0, FONT_KEY, '', 8).setOrigin(0.5, 1).setDepth(KODIAK_DEPTH).setVisible(false));
    }
    return this.labels[i];
  }

  /**
   * @param {object[]} bears RunScene.kodiaks (the live pack)
   * @param {{left:number,right:number,top:number,bottom:number}|null} view camera world view
   * @param {number} zoom camera zoom
   * @param {number} timeMs run time
   * @param {boolean} reducedMotion
   */
  update(bears, view, zoom, timeMs, reducedMotion) {
    this.gfx.clear();
    for (const l of this.labels) l.setVisible(false);
    if (!view) return;
    // Off-screen chevrons stack per side so a pack shows as a pack.
    const edge = { left: 0, right: 0 };
    (bears || []).forEach((k, i) => { if (!k.done && Number.isFinite(k.groundY)) this._drawBear(k, this._label(i), view, zoom, timeMs, reducedMotion, edge); });
  }

  _drawBear(k, label, view, zoom, timeMs, reducedMotion, edge) {
    const g = this.gfx;
    const def = k.def, red = this.palette.danger ?? 0xff4060, amber = this.palette.amber ?? 0xffb347;
    const inv = 1 / (zoom > 0 ? zoom : 1);
    const onScreen = k.x > view.left - 30 && k.x < view.right + 30;
    if (!onScreen) {
      // Edge chevron in the bear's colours, with its short name: which bear, and from which side.
      const left = k.x < view.left;
      const ex = left ? view.left + 10 * inv : view.right - 10 * inv;
      const stack = edge[left ? 'left' : 'right']++ * 18 * inv;
      // Kept below the score block and above the bottom HUD row.
      const ey = Math.max(view.top + 80 * inv, Math.min(view.bottom - 40 * inv, k.groundY - 20 - stack));
      const d = (left ? 1 : -1) * 7 * inv;
      g.fillStyle(def.accent, 0.95).fillTriangle(ex - d, ey - 7 * inv, ex - d, ey + 7 * inv, ex + d * 0.6, ey);
      g.lineStyle(1.5 * inv, def.color === 0x15151b ? def.accent : def.color, 1).strokeTriangle(ex - d, ey - 7 * inv, ex - d, ey + 7 * inv, ex + d * 0.6, ey);
      label.setText(def.short).setTint(def.accent).setScale(inv).setOrigin(left ? 0 : 1, 0.5)
        .setPosition(ex + (left ? 12 : -12) * inv, ey).setVisible(true);
      return;
    }
    const x = k.x, y = k.groundY;
    let gx = 0;
    if (k.kind === 'kernelPanic' && k.phase === 'tele' && !reducedMotion) gx = (Math.floor(timeMs / 60) % 2 ? 2 : -2); // glitch jitter
    const run = reducedMotion ? 0 : Math.sin(timeMs / 70 + x * 0.02) * 3; // gallop
    const X = (lx) => x + lx + gx;
    // telegraph ring (before the drawing so the bear stays readable)
    if (k.phase === 'tele') {
      const real = k.kind !== 'kernelPanic' || k.real;
      const pulse = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(timeMs / 60);
      g.lineStyle(2, real ? red : amber, 0.9 * pulse).strokeCircle(X(0), y - 16, 30);
      g.fillStyle(real ? red : amber, 1).fillRect(X(-1), y - 58, 3, 10).fillRect(X(-1), y - 45, 3, 3); // "!"
      if (k.kind === 'blackIce' && Number.isFinite(k.targetX)) {
        // the landing spot it is sliding toward: a black-ice glint on the ground
        const ty = this.scene.terrain?.heightAt?.(k.targetX);
        if (Number.isFinite(ty)) g.lineStyle(2, def.accent, 0.9).lineBetween(k.targetX - 18, ty - 1, k.targetX + 18, ty - 1);
      }
    }
    if (k.phase === 'lunge' && !reducedMotion) {
      g.lineStyle(1.5, red, 0.6);
      for (let i = 0; i < 3; i++) g.lineBetween(X(-40 - i * 8), y - 10 - i * 6, X(-22 - i * 8), y - 10 - i * 6);
    }
    // Outline in a lighter tone of the bear's own colour (never the accent), so brown reads brown.
    const body = def.color, rim = def.rim ?? def.accent;
    g.fillStyle(body, 1);
    g.lineStyle(1.5, rim, 0.9);
    if (k.kind === 'bruteForce') {
      // GRIZZLY: big, heavy, a pronounced shoulder hump
      g.fillEllipse(X(0), y - 15, 46, 24).strokeEllipse(X(0), y - 15, 46, 24);
      g.fillCircle(X(-4), y - 27, 10).strokeCircle(X(-4), y - 27, 10);
      g.fillCircle(X(22), y - 20, 8).strokeCircle(X(22), y - 20, 8);
      g.fillCircle(X(18), y - 28, 2.5).fillCircle(X(25), y - 28, 2.5);
      g.fillStyle(0x3a2412, 1).fillCircle(X(29), y - 19, 2.5);
    } else if (k.kind === 'kernelPanic') {
      // POLAR: long, low body and a long neck reaching forward
      g.fillEllipse(X(-2), y - 13, 48, 18).strokeEllipse(X(-2), y - 13, 48, 18);
      g.fillEllipse(X(20), y - 18, 18, 9).strokeEllipse(X(20), y - 18, 18, 9);
      g.fillCircle(X(29), y - 20, 6).strokeCircle(X(29), y - 20, 6);
      g.fillCircle(X(26), y - 25, 1.8);
      g.fillStyle(0x10141c, 1).fillCircle(X(34), y - 19, 1.8);
    } else {
      // VERMONT BLACK BEAR: round, compact, tall rounded ears, tan muzzle
      g.fillEllipse(X(0), y - 15, 38, 24).strokeEllipse(X(0), y - 15, 38, 24);
      g.fillCircle(X(19), y - 21, 8).strokeCircle(X(19), y - 21, 8);
      g.fillCircle(X(14), y - 30, 3.6).strokeCircle(X(14), y - 30, 3.6);
      g.fillCircle(X(23), y - 30, 3.6).strokeCircle(X(23), y - 30, 3.6);
      g.fillStyle(0xc8a070, 1).fillEllipse(X(26), y - 19, 8, 6);
    }
    // legs (gallop)
    g.fillStyle(body, 1);
    for (const [lx, ph] of [[-14, 1], [-6, -1], [8, 1], [15, -1]]) g.fillRect(X(lx) - 2.5, y - 6 + ph * run * 0.3, 5, 6 - ph * run * 0.3);
    // name tag while it is a threat
    if (k.phase === 'tele' || k.phase === 'lunge') {
      label.setText(def.short).setTint(def.accent).setScale(inv).setOrigin(0.5, 1).setPosition(X(0), y - 62).setVisible(true);
    }
  }

  destroy() {
    this.gfx?.destroy();
    for (const l of this.labels) l.destroy();
    this.gfx = null;
    this.labels = [];
  }
}
