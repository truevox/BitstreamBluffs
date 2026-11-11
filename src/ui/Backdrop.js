/**
 * OWNER: UI engineer.
 * Animated Tron-wireframe background: rolling neon hills over a perspective grid. Repainted each frame from
 * palette colours; call update(timeMs) from the scene's update(). No images.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants.js';

export class Backdrop {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{horizon?:number, alpha?:number, depth?:number}} [o]
   */
  constructor(scene, theme, o = {}) {
    this.theme = theme;
    this.horizon = o.horizon === undefined ? 196 : o.horizon;
    this.alpha = o.alpha === undefined ? 1 : o.alpha;
    this.g = scene.add.graphics().setDepth(o.depth === undefined ? -10 : o.depth);
    this.t = 0;
    this.draw(0);
  }

  /** @param {number} timeMs @returns {void} */
  update(timeMs) {
    this.draw(timeMs);
  }

  /** @param {number} timeMs @returns {void} */
  draw(timeMs) {
    const g = this.g;
    const pal = this.theme.pal;
    const hy = this.horizon;
    const a = this.alpha;
    g.clear();
    g.fillStyle(pal.bg, 1);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    // sun glow bands
    for (let i = 0; i < 5; i++) {
      g.fillStyle(pal.magenta, 0.05 * a);
      g.fillRect(0, hy - 8 - i * 10, GAME_WIDTH, 5);
    }
    // ground below horizon
    g.fillStyle(pal.bgAlt, 0.9);
    g.fillRect(0, hy, GAME_WIDTH, GAME_HEIGHT - hy);
    // perspective grid
    const scroll = (timeMs / 1000) * 0.5;
    g.lineStyle(1, pal.cyan, 0.28 * a);
    for (let i = 0; i < 9; i++) {
      const f = (i + (scroll % 1)) / 9;
      const y = Math.round(hy + (GAME_HEIGHT - hy) * f * f);
      g.lineBetween(0, y + 0.5, GAME_WIDTH, y + 0.5);
    }
    g.lineStyle(1, pal.cyan, 0.2 * a);
    for (let i = -10; i <= 10; i++) {
      g.lineBetween(GAME_WIDTH / 2 + i * 8, hy, GAME_WIDTH / 2 + i * 70, GAME_HEIGHT);
    }
    // two hill wireframe layers
    this._hills(g, timeMs, hy, 22, 0.012, 0.0004, pal.magenta, 0.5 * a);
    this._hills(g, timeMs, hy + 1, 12, 0.02, 0.0008, pal.lime, 0.35 * a);
    g.fillStyle(pal.cyan, 0.6 * a);
    g.fillRect(0, hy, GAME_WIDTH, 1);
  }

  _hills(g, t, base, amp, freq, speed, color, alpha) {
    g.lineStyle(1, color, alpha);
    g.beginPath();
    for (let x = 0; x <= GAME_WIDTH; x += 6) {
      const y = base - amp * (0.55 + 0.45 * Math.sin(x * freq + t * speed)) * (0.6 + 0.4 * Math.sin(x * freq * 0.37 + 1.3 + t * speed * 0.4));
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
  }

  /** @returns {void} */
  destroy() {
    if (this.g) this.g.destroy();
    this.g = null;
  }
}
