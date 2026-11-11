/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Neon ribbon behind the sled; hue shifts with speed (cyan -> lime -> amber -> magenta, via the palette so the
 * colour-blind palette works). Two layers: a tapered Graphics ribbon built from the last N positions, plus a
 * Phaser 3.60+ particle emitter (`scene.add.particles(x, y, texture, config)`) for sparks. The spark texture is
 * generated at runtime (no image assets).
 */
const TEX_KEY = 'bb-spark';
const MAX_POINTS = 30;

function lerpColor(a, b, t) {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

export class TrailParticles {
  /**
   * @param {Phaser.Scene} scene
   * @param {Object<string,number>} palette
   */
  constructor(scene, palette) {
    this.scene = scene;
    this.palette = palette;
    this.points = [];
    this.destroyed = false;
    this.speedRef = 900;

    if (!scene.textures.exists(TEX_KEY)) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 3, 3);
      g.generateTexture(TEX_KEY, 3, 3);
      g.destroy();
    }
    this.gfx = scene.add.graphics().setDepth(15);
    this.emitter = scene.add.particles(0, 0, TEX_KEY, {
      lifespan: { min: 280, max: 620 },
      speed: { min: 4, max: 46 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.4, end: 0 },
      alpha: { start: 0.95, end: 0 },
      blendMode: 'ADD',
      emitting: false,
    });
    this.emitter.setDepth(14);
  }

  /** @param {Object<string,number>} palette @returns {void} */
  setPalette(palette) {
    this.palette = palette;
  }

  /**
   * Colour for a given speed: cyan (slow) -> lime -> amber -> magenta (fast).
   * @param {number} speedPxS
   * @returns {number} 0xRRGGBB
   */
  colorForSpeed(speedPxS) {
    const p = this.palette;
    const stops = [p.cyan, p.lime, p.amber, p.magenta];
    const t = Math.min(0.9999, Math.max(0, speedPxS / this.speedRef)) * (stops.length - 1);
    const i = Math.floor(t);
    return lerpColor(stops[i], stops[i + 1], t - i);
  }

  /**
   * @param {number} x sled world x (trail anchor).
   * @param {number} y sled world y (trail anchor).
   * @param {number} speedPxS
   * @returns {void}
   */
  update(x, y, speedPxS) {
    if (this.destroyed) return;
    const pts = this.points;
    pts.push({ x, y, s: speedPxS });
    if (pts.length > MAX_POINTS) pts.shift();

    const col = this.colorForSpeed(speedPxS);
    const g = this.gfx;
    g.clear();
    const n = pts.length;
    for (let i = 1; i < n; i++) {
      const t = i / (n - 1); // 0 tail -> 1 head
      const a = pts[i - 1];
      const b = pts[i];
      const c = this.colorForSpeed(b.s);
      const wMax = 2 + Math.min(3, speedPxS / 300);
      g.lineStyle(wMax * t * 2.4, c, 0.14 * t);
      g.lineBetween(a.x, a.y, b.x, b.y);
      g.lineStyle(Math.max(0.6, wMax * t), c, 0.9 * t);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }

    if (speedPxS > 40) {
      this.emitter.setParticleTint(col);
      const count = speedPxS > 450 ? 2 : 1;
      this.emitter.emitParticleAt(x, y, count);
    }
  }

  /** Forget the ribbon (after a respawn teleport). @returns {void} */
  reset() {
    this.points.length = 0;
    if (this.gfx) this.gfx.clear();
  }

  /** @returns {void} */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.emitter) this.emitter.destroy();
    if (this.gfx) this.gfx.destroy();
    this.emitter = null;
    this.gfx = null;
    this.points.length = 0;
  }
}
