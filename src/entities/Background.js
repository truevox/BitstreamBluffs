/**
 * OWNER: gameplay engineer.
 * Parallax neon backdrop: gradient sky, twinkling starfield, striped synthwave sun, two wireframe mountain ridges and a
 * faint data grid. One screen-space Graphics redrawn each frame from the camera scroll. All layer positions are pure
 * functions of (scrollX * factor) so nothing accumulates and it stays stable at any distance (no pooled objects).
 */
import { GAME_WIDTH, GAME_HEIGHT } from '../constants.js';

const STAR_COUNT = 70;
const TILE = 960;

/** mulberry32 - visual-only randomness, deterministic so the sky is stable between runs. */
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Background {
  /**
   * @param {Phaser.Scene} scene
   * @param {Object<string,number>} palette
   */
  constructor(scene, palette) {
    this.scene = scene;
    this.palette = palette;
    this.gfx = scene.add.graphics().setScrollFactor(0).setDepth(-100);
    const rnd = mulberry32(0xb175);
    this.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push({ x: rnd() * TILE, y: rnd() * GAME_HEIGHT * 0.8, z: 0.02 + rnd() * 0.1, tw: rnd() * 6.28, s: rnd() < 0.15 ? 2 : 1 });
    }
  }

  /** @param {Object<string,number>} palette @returns {void} */
  setPalette(palette) {
    this.palette = palette;
  }

  _ridge(g, scrollX, factor, baseY, amp, seed, color, fillAlpha, lineAlpha) {
    const step = 8;
    const off = scrollX * factor;
    const pts = [{ x: 0, y: GAME_HEIGHT }];
    for (let sx = 0; sx <= GAME_WIDTH + step; sx += step) {
      const wx = sx + off;
      const h = Math.sin(wx * 0.011 + seed) * 0.55 + Math.sin(wx * 0.027 + seed * 2.3) * 0.3 + Math.sin(wx * 0.061 + seed * 4.1) * 0.15;
      // sharpen peaks a little (wireframe-mountain feel)
      const y = baseY - Math.abs(h) * amp - (h > 0 ? h * amp * 0.2 : 0);
      pts.push({ x: sx, y });
    }
    pts.push({ x: GAME_WIDTH + step, y: GAME_HEIGHT });
    g.fillStyle(this.palette.bg, 1);
    g.fillPoints(pts, true);
    g.fillStyle(color, fillAlpha);
    g.fillPoints(pts, true);
    g.lineStyle(1, color, lineAlpha);
    g.strokePoints(pts.slice(1, -1), false, false);
  }

  /**
   * @param {number} scrollX camera scroll X (world px).
   * @param {number} timeMs
   * @param {number} speedPxS rider speed (streaks the grid at high speed).
   * @returns {void}
   */
  update(scrollX, timeMs, speedPxS = 0) {
    const g = this.gfx;
    const p = this.palette;
    g.clear();
    // sky gradient (banded)
    const bands = 8;
    for (let i = 0; i < bands; i++) {
      const t = i / bands;
      g.fillStyle(p.magenta, 0.015 + 0.075 * t * t);
      g.fillRect(0, GAME_HEIGHT * (0.1 + 0.6 * t), GAME_WIDTH, (GAME_HEIGHT * 0.6) / bands + 1);
    }
    // stars
    for (const s of this.stars) {
      let x = (s.x - scrollX * s.z) % TILE;
      if (x < 0) x += TILE;
      if (x > GAME_WIDTH) continue;
      const a = 0.35 + 0.35 * Math.sin(timeMs / 600 + s.tw);
      g.fillStyle(s.s > 1 ? p.cyan : p.text, a);
      g.fillRect(Math.floor(x), Math.floor(s.y), s.s, s.s);
    }
    // striped sun
    const sunX = GAME_WIDTH * 0.72 - ((scrollX * 0.02) % 40);
    const sunY = GAME_HEIGHT * 0.27;
    const R = 40;
    for (let i = 0; i < 9; i++) {
      const y0 = sunY - R + (i * 2 * R) / 9;
      const y1 = y0 + (2 * R) / 9 - (i * 0.45 + 0.4);
      const mid = (y0 + y1) / 2;
      const dy = mid - sunY;
      if (Math.abs(dy) >= R) continue;
      const hw = Math.sqrt(R * R - dy * dy);
      g.fillStyle(i < 4 ? p.amber : p.magenta, 0.2 + i * 0.012);
      g.fillRect(sunX - hw, y0, hw * 2, Math.max(1, y1 - y0));
    }
    g.lineStyle(1, p.amber, 0.35);
    g.strokeCircle(sunX, sunY, R);
    // ridges
    this._ridge(g, scrollX, 0.1, GAME_HEIGHT * 0.5, 62, 1.3, p.magenta, 0.12, 0.55);
    this._ridge(g, scrollX, 0.22, GAME_HEIGHT * 0.6, 50, 4.2, p.cyan, 0.1, 0.45);
    // data grid (faint), vertical lines scroll with parallax, speed streaks stretch them
    const gs = 48;
    const gx = -((scrollX * 0.35) % gs);
    g.lineStyle(1, p.cyan, 0.05);
    for (let x = gx; x < GAME_WIDTH; x += gs) g.lineBetween(x, 0, x, GAME_HEIGHT);
    for (let y = 0; y < GAME_HEIGHT; y += gs) g.lineBetween(0, y, GAME_WIDTH, y);
    if (speedPxS > 500) {
      const k = Math.min(1, (speedPxS - 500) / 500);
      g.lineStyle(1, p.text, 0.08 * k);
      for (let i = 0; i < 10; i++) {
        const y = ((i * 97 + (timeMs * 0.3)) % GAME_HEIGHT);
        const x = ((i * 173 - scrollX * 0.6) % GAME_WIDTH + GAME_WIDTH) % GAME_WIDTH;
        g.lineBetween(x, y, x - 30 * k - 10, y);
      }
    }
  }

  /** @returns {void} */
  destroy() {
    if (this.gfx) this.gfx.destroy();
    this.gfx = null;
  }
}
