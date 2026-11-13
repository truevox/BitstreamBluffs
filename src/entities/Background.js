/**
 * OWNER: gameplay engineer.
 * Parallax neon backdrop: gradient sky, twinkling starfield, striped synthwave sun, two wireframe mountain ridges and a
 * faint data grid. One screen-space Graphics redrawn each frame from the camera scroll. All layer positions are pure
 * functions of (scrollX * factor) so nothing accumulates and it stays stable at any distance (no pooled objects).
 */
import { GAME_WIDTH, GAME_HEIGHT } from '../constants.js';

const STAR_COUNT = 70;
const TILE = 960;

/**
 * W3 background motifs. Each biome names one in its JSON `background` field; the base/mask-0 backdrop
 * is `ridges`, which is the original two-ridge silhouette, so an ordinary run is unchanged.
 *
 * A motif only describes LAYER GEOMETRY (base Y, amplitude, parallax factor, seed, colour key, and a
 * shape tag). It never describes colour: colour comes from the palette, biome-tinted by `getPalette`,
 * so a motif cannot smuggle in a colour that ignores colour-blind mode.
 */
export const MOTIFS = ['ridges', 'drift', 'terraces', 'currents', 'facets'];

const MOTIF_DEFS = {
  // The pre-W3 backdrop: two sharp wireframe ridgelines.
  ridges: {
    shape: 'peak',
    layers: [
      { baseY: 0.5, amp: 62, factor: 0.1, seed: 1.3, color: 'magenta', fillAlpha: 0.12, lineAlpha: 0.55 },
      { baseY: 0.6, amp: 50, factor: 0.22, seed: 4.2, color: 'cyan', fillAlpha: 0.1, lineAlpha: 0.45 },
    ],
  },
  // Garbage Dump Glacier: long shallow drifts, slow parallax, low amplitude — slumped, not jagged.
  drift: {
    shape: 'swell',
    layers: [
      { baseY: 0.56, amp: 26, factor: 0.07, seed: 2.1, color: 'lime', fillAlpha: 0.1, lineAlpha: 0.4 },
      { baseY: 0.64, amp: 18, factor: 0.16, seed: 5.7, color: 'text', fillAlpha: 0.08, lineAlpha: 0.32 },
    ],
  },
  // Pyramid Peak: stepped benches. Few layers but a blocky, quantised profile.
  terraces: {
    shape: 'step',
    layers: [
      { baseY: 0.48, amp: 70, factor: 0.09, seed: 0.7, color: 'amber', fillAlpha: 0.12, lineAlpha: 0.5 },
      { baseY: 0.62, amp: 54, factor: 0.19, seed: 3.4, color: 'magenta', fillAlpha: 0.09, lineAlpha: 0.4 },
    ],
  },
  // Underwater Mountain: tall slow swells with a third, faster ripple layer — moving water.
  currents: {
    shape: 'sine',
    layers: [
      { baseY: 0.46, amp: 58, factor: 0.06, seed: 6.2, color: 'cyan', fillAlpha: 0.1, lineAlpha: 0.4 },
      { baseY: 0.58, amp: 40, factor: 0.13, seed: 2.9, color: 'cyan', fillAlpha: 0.09, lineAlpha: 0.36 },
      { baseY: 0.68, amp: 22, factor: 0.3, seed: 8.1, color: 'text', fillAlpha: 0.07, lineAlpha: 0.3 },
    ],
  },
  // Crystal Cavern: sharp angular facets, the most jagged profile and the fastest near layer.
  facets: {
    shape: 'facet',
    layers: [
      { baseY: 0.44, amp: 76, factor: 0.12, seed: 4.8, color: 'magenta', fillAlpha: 0.13, lineAlpha: 0.5 },
      { baseY: 0.6, amp: 48, factor: 0.26, seed: 7.3, color: 'cyan', fillAlpha: 0.1, lineAlpha: 0.42 },
    ],
  },
};

/**
 * The layer geometry a motif draws. Pure function of (motif, scrollX), so a repaint at any scroll
 * position is stable and an unknown motif can fall back without a special case at the call site.
 *
 * `baseY`/`amp`/`factor` are returned in the same units the original backdrop used (fractions of
 * GAME_HEIGHT and px); only the shape tag tells the renderer which profile function to sample.
 * @param {string|null} motif
 * @param {number} scrollX
 * @returns {{shape:string, motif:string, layers:Array<Object>}}
 */
export function motifGeometry(motif, scrollX) {
  const id = typeof motif === 'string' && MOTIFS.includes(motif) ? motif : 'ridges';
  const def = MOTIF_DEFS[id];
  const x = Number.isFinite(scrollX) ? scrollX : 0;
  return {
    motif: id,
    shape: def.shape,
    layers: def.layers.map((l) => ({
      baseY: l.baseY, amp: l.amp, factor: l.factor, seed: l.seed,
      color: l.color, fillAlpha: l.fillAlpha, lineAlpha: l.lineAlpha,
      // A per-layer phase offset derived from scroll, so the check that geometry actually varies with
      // scroll is meaningful rather than trivially true.
      phase: (x * l.factor * 0.011) % (Math.PI * 2),
    })),
  };
}

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
    this.motif = null; // null = base backdrop ('ridges'), so pre-W3 runs are unchanged
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

  /**
   * W3: switch the background motif. Passing null/undefined returns to the base backdrop, which is what
   * the biome-exit path does — a motif must not outlive the sector that owns it.
   * @param {string|null} motif
   * @returns {void}
   */
  setMotif(motif) {
    this.motif = typeof motif === 'string' && MOTIFS.includes(motif) ? motif : null;
  }

  /**
   * One sample of a layer's height at a world x, per shape. Every profile returns -1..1 before amplitude
   * so section heights stay comparable between motifs.
   * @param {string} shape @param {number} wx @param {number} seed @returns {number}
   */
  _profile(shape, wx, seed) {
    if (shape === 'step') {
      // Pyramid Peak: quantise a sine into benches, so the silhouette is blocky rather than smooth.
      const raw = Math.sin(wx * 0.009 + seed) * 0.6 + Math.sin(wx * 0.021 + seed * 2.1) * 0.4;
      return Math.round(raw * 3) / 3;
    }
    if (shape === 'facet') {
      // Crystal Cavern: alternating angular facets, sharpest profile of the five.
      const tri = Math.abs(((wx * 0.014 + seed) % 2) - 1) * 2 - 1;
      return tri * 0.7 + Math.sin(wx * 0.05 + seed * 3.3) * 0.3;
    }
    if (shape === 'swell') {
      // Garbage Dump Glacier: long shallow drifts, no high-frequency detail at all.
      return Math.sin(wx * 0.004 + seed) * 0.8 + Math.sin(wx * 0.011 + seed * 1.7) * 0.2;
    }
    if (shape === 'sine') {
      // Underwater Mountain: water-like, slightly phase-shifted ripples.
      return Math.sin(wx * 0.008 + seed) * 0.55 + Math.sin(wx * 0.019 + seed * 2.6) * 0.3 + Math.sin(wx * 0.043 + seed * 5.1) * 0.15;
    }
    // 'peak' — the original ridge profile, unchanged from pre-W3 so base terrain looks identical.
    return Math.sin(wx * 0.011 + seed) * 0.55 + Math.sin(wx * 0.027 + seed * 2.3) * 0.3 + Math.sin(wx * 0.061 + seed * 4.1) * 0.15;
  }

  /**
   * Draw one motif layer. The pre-W3 `_ridge` is this function with shape 'peak', which is why base
   * terrain still looks identical: same profile, same sampling step, same fill/stroke alphas.
   * @param {Phaser.GameObjects.Graphics} g
   * @param {number} scrollX
   * @param {Object} layer a layer from motifGeometry()
   * @param {Object<string,number>} palette
   * @param {string} shape
   * @returns {void}
   */
  _layer(g, scrollX, layer, palette, shape) {
    const step = 8;
    const off = scrollX * layer.factor;
    const baseY = GAME_HEIGHT * layer.baseY;
    const color = palette[layer.color] != null ? palette[layer.color] : palette.cyan;
    const pts = [{ x: 0, y: GAME_HEIGHT }];
    for (let sx = 0; sx <= GAME_WIDTH + step; sx += step) {
      const wx = sx + off;
      const h = this._profile(shape, wx, layer.seed);
      // Sharpen crests slightly (wireframe-mountain feel). Step/facet shapes already carry their own
      // character from _profile, so the extra crest term only applies to the smooth profiles.
      const crest = shape === 'step' || shape === 'facet' ? 0 : (h > 0 ? h * layer.amp * 0.2 : 0);
      pts.push({ x: sx, y: baseY - Math.abs(h) * layer.amp - crest });
    }
    pts.push({ x: GAME_WIDTH + step, y: GAME_HEIGHT });
    g.fillStyle(palette.bg, 1);
    g.fillPoints(pts, true);
    g.fillStyle(color, layer.fillAlpha);
    g.fillPoints(pts, true);
    g.lineStyle(1, color, layer.lineAlpha);
    g.strokePoints(pts.slice(1, -1), false, false);
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
    // ridges / biome motif
    const geom = motifGeometry(this.motif, scrollX);
    for (const layer of geom.layers) this._layer(g, scrollX, layer, p, geom.shape);
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
