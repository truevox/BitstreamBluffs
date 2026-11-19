/**
 * OWNER: UI engineer.
 * Menu backdrop, synthwave v2: gradient sky, twinkling stars with the odd shooting star, a striped retro sun
 * whose slice gaps scroll, three parallax mountain ranges, a bright perspective grid floor, and an
 * attract-mode rider carving along the foothills (with the occasional hop and flip). `warp()` accelerates
 * the grid and ranges for a launch (START RUN).
 *
 * API (unchanged from v1, so Title, Game Over and anything else keep working):
 *   new Backdrop(scene, theme, {horizon?, alpha?, depth?})   then update(timeMs) every frame, destroy() when done.
 * Added: warp(o?) -> ms, and `reduced` (read-only: reduce motion is in effect this frame).
 *
 * Art: the sun, its glow, the mountain layers and the rider are authored SVGs (ui/MenuArt.js), white or
 * greyscale and tinted from the palette inside theme.bind, so colour-blind mode and UI themes apply. Any
 * texture that did not load falls back to a procedural drawing of the same thing (the mountains from the
 * very same MenuTerrain ridge functions the art was rasterised from).
 *
 * Reduce motion (Motion.isReducedMotion, read every frame so the setting applies live): stars hold still,
 * no shooting stars, the sun slices and the ranges stop, the grid creeps at a fraction of its speed, the
 * rider stays parked on the ridge without hops, and warp() is a no-op.
 *
 * Depth: every layer sits at `depth` + a small fraction (default -10), i.e. behind all menu content.
 * `alpha` scales the accent layers (sun, ranges, grid, rider) but not the sky, as v1 did.
 */
import { GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { artImage, artTileSprite, bindTint, mixColor, RIDER_ORIGIN } from './MenuArt.js';
import { MENU_LAYERS, MENU_LAYER_ORDER, MENU_TERRAIN_PERIOD, ridgeY, ridgeSlope } from './MenuTerrain.js';
import { isReducedMotion, Ease, clamp01, lerp } from './Motion.js';

const STAR_COUNT = 84;
const SUN_D = 112;
/** Phaser.BlendModes.ADD; a literal so this module does not need Phaser itself. */
const BLEND_ADD = 1;
/** Rider: which range it rides, and its hop timing. */
const RIDER_LAYER = 'near';
const HOP_MS = 950;

/** mulberry32: deterministic star field (same sky every visit). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Backdrop {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{horizon?:number, alpha?:number, depth?:number}} [o]
   */
  constructor(scene, theme, o = {}) {
    this.scene = scene;
    this.theme = theme;
    this.horizon = o.horizon === undefined ? 196 : o.horizon;
    this.alpha = o.alpha === undefined ? 1 : o.alpha;
    const d = o.depth === undefined ? -10 : o.depth;
    const hy = this.horizon;
    this.lastT = null;
    this.t = 0;
    this.reduced = false;
    // scroll state accumulates (warp changes the rate, so position is not a pure function of time)
    this.gridPhase = 0;
    this.layerScroll = { far: 0, mid: 0, near: 0 };
    this.sunPhase = 0;
    this.warpFrom = 0;
    this.warpMs = 0;
    /** @type {number[]} sky colour per row 0..horizon, for the sun's slice gaps */
    this.skyRows = [];

    this.sky = scene.add.graphics().setDepth(d);
    this.starsG = scene.add.graphics().setDepth(d + 0.01);
    this._makeStars();

    // --- sun: glow + disc (art or fallback) + the slice gaps overdrawn in sky colour
    this.sunX = GAME_WIDTH / 2;
    // high enough that the far range bites into the slices rather than hiding them
    this.sunY = hy - Math.round(SUN_D * 0.55);
    this.sunGlow = artImage(scene, 'sunGlow', this.sunX, this.sunY, {
      theme, tint: 'magenta', alpha: 0.32 * this.alpha, depth: d + 0.02, blend: BLEND_ADD,
    });
    this.sun = artImage(scene, 'sun', this.sunX, this.sunY, {
      theme, tint: (pal) => [pal.amber, pal.amber, pal.magenta, pal.magenta], alpha: this.alpha, depth: d + 0.03,
    });
    this.sunG = scene.add.graphics().setDepth(d + 0.04);

    // --- mountains, back to front. Each layer's bottom row sits on the horizon line.
    // Ranges stay opaque (a translucent range let the sun show through the rock); `alpha` dims them toward
    // the sky instead. The violet is derived from the palette so colour-blind mode moves it too.
    const a = this.alpha;
    const tints = {
      far: (pal) => mixColor(pal.bg, pal.magenta, a),
      mid: (pal) => mixColor(pal.bg, mixColor(pal.magenta, pal.cyan, 0.45), a),
      near: (pal) => mixColor(pal.bg, pal.cyan, a),
    };
    this.layers = {};
    let ld = d + 0.05;
    for (const name of MENU_LAYER_ORDER) {
      const L = MENU_LAYERS[name];
      const top = hy - L.h + 1;
      const key = name === 'far' ? 'mountainsFar' : name === 'mid' ? 'mountainsMid' : 'mountainsNear';
      const sprite = artTileSprite(scene, key, 0, top, GAME_WIDTH, L.h, { theme, tint: tints[name], depth: ld });
      // fallback: the same ridge, drawn per frame
      const fallback = sprite ? null : scene.add.graphics().setDepth(ld);
      this.layers[name] = { sprite, fallback, top, tint: tints[name] };
      ld += 0.01;
      if (name === RIDER_LAYER) {
        this._makeRider(ld);
        ld += 0.01;
      }
    }

    // --- ground + grid in front of everything
    this.ground = scene.add.graphics().setDepth(ld + 0.01);
    this.g = this.ground; // v1 exposed its single Graphics as `g`; kept for anyone holding on to it

    this._unbind = theme.bind((pal) => this._paintSky(pal));
    this.update(0);
  }

  // ------------------------------------------------------------------ construction helpers

  _makeStars() {
    const r = rng(0x5eed5);
    const maxY = Math.max(20, this.horizon - 24);
    this.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const big = r() < 0.12;
      this.stars.push({
        x: Math.floor(r() * GAME_WIDTH),
        // denser toward the top, thinning into the horizon glow
        y: Math.floor(Math.pow(r(), 1.5) * maxY),
        big,
        hue: r() < 0.7 ? 'text' : r() < 0.5 ? 'cyan' : 'magenta',
        speed: 0.6 + r() * 1.6,
        phase: r() * Math.PI * 2,
      });
    }
    this.shooting = null;
    this.nextShootAt = 3000 + r() * 4000;
    this.rand = rng(0xc0ffee);
  }

  _makeRider(depth) {
    const scene = this.scene;
    const parts = [
      ['riderBase', null],
      ['riderSled', (pal) => pal.cyan],
      ['riderBody', (pal) => pal.magenta],
      ['riderHelmet', (pal) => pal.amber],
    ];
    const imgs = [];
    for (const [name, tint] of parts) {
      const img = artImage(scene, name, 0, 0, {
        theme: this.theme, tint: tint || undefined, originX: RIDER_ORIGIN.x, originY: RIDER_ORIGIN.y, depth,
      });
      if (!img) break;
      imgs.push(img);
    }
    if (imgs.length === parts.length) {
      this.riderParts = imgs;
      this.riderG = null;
    } else {
      // fallback: a tiny procedural sled + rider in local space, positioned/rotated as one Graphics
      for (const img of imgs) img.destroy();
      this.riderParts = null;
      this.riderG = scene.add.graphics().setDepth(depth);
      this._riderUnbind = this.theme.bind((pal) => {
        const g = this.riderG;
        if (!g) return;
        g.clear();
        g.fillStyle(pal.bg, 1);
        g.fillRect(-11, -4, 22, 4);
        g.fillStyle(pal.cyan, 1);
        g.fillRect(-10, -2, 19, 1);
        g.fillRect(-10, -4, 18, 1);
        g.fillRect(9, -3, 1, 1);
        g.fillStyle(pal.magenta, 1);
        g.fillRect(-5, -11, 4, 6);
        g.fillRect(-1, -7, 5, 2);
        g.fillStyle(pal.amber, 1);
        g.fillRect(-3, -15, 4, 4);
      });
    }
    this.riderX = 330;
    this.hopStart = -1;
    this.nextHopAt = 5000;
  }

  // ------------------------------------------------------------------ painting

  /** Static sky: per-row gradient from bg at the top through a deep violet to a magenta-hot horizon. */
  _paintSky(pal) {
    const g = this.sky;
    if (!g) return;
    const hy = this.horizon;
    g.clear();
    g.fillStyle(pal.bg, 1);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    const mid = mixColor(pal.bg, mixColor(pal.magenta, pal.cyan, 0.3), 0.16);
    const hot = mixColor(pal.bg, pal.magenta, 0.42);
    this.skyRows = [];
    for (let y = 0; y <= hy; y++) {
      const t = y / Math.max(1, hy);
      // stays dark for the top third, then warms quickly toward the horizon
      const c = t < 0.45 ? mixColor(pal.bg, mid, Ease.inQuad(t / 0.45)) : mixColor(mid, hot, Ease.inQuad((t - 0.45) / 0.55));
      this.skyRows[y] = c;
      g.fillStyle(c, 1);
      g.fillRect(0, y, GAME_WIDTH, 1);
    }
    this.groundBase = pal.bgAlt;
    this.groundHaze = mixColor(pal.bgAlt, pal.magenta, 0.2);
    // the sun's fallback disc and gaps depend on the sky colour, so repaint the dynamic layers now
    if (this.lastT !== null) this._drawDynamic(this.t, 0);
  }

  /**
   * Accelerate the grid and ranges for a launch: a quick ramp to ~9x, held until the scene moves on.
   * No-op under reduce motion.
   * @param {{duration?:number}} [o] ramp duration (default 700 ms)
   * @returns {number} the ramp duration in ms (0 when reduced), so a caller can time its scene change
   */
  warp(o = {}) {
    if (isReducedMotion(this.scene)) return 0;
    this.warpFrom = this.t;
    this.warpMs = o.duration || 700;
    return this.warpMs;
  }

  /** Current speed multiplier from warp(). */
  _warpFactor() {
    if (!this.warpMs || this.reduced) return 1;
    return lerp(1, 9, Ease.inCubic(clamp01((this.t - this.warpFrom) / this.warpMs)));
  }

  /** @param {number} timeMs @returns {void} */
  update(timeMs) {
    if (!this.sky) return;
    const dt = this.lastT === null ? 0 : Math.min(100, Math.max(0, timeMs - this.lastT));
    this.lastT = timeMs;
    this.t = timeMs;
    this.reduced = isReducedMotion(this.scene);
    const warp = this._warpFactor();
    const s = dt / 1000;
    if (!this.reduced) {
      for (const name of MENU_LAYER_ORDER) this.layerScroll[name] += MENU_LAYERS[name].speed * warp * s;
      this.sunPhase += 5 * s;
    }
    // the grid keeps a slow creep even when reduced: a frozen floor reads as a hung game
    this.gridPhase += (this.reduced ? 0.08 : 0.6) * warp * s;
    this._drawDynamic(timeMs, dt);
  }

  /** v1 name, kept: redraw at a time. @param {number} timeMs */
  draw(timeMs) {
    this.update(timeMs);
  }

  _drawDynamic(t, dt) {
    const pal = this.theme.pal;
    this._drawStars(pal, t, dt);
    this._drawSun(pal);
    for (const name of MENU_LAYER_ORDER) {
      const L = this.layers[name];
      const off = Math.floor(this.layerScroll[name]) % MENU_TERRAIN_PERIOD;
      if (L.sprite) L.sprite.tilePositionX = off;
      else if (L.fallback) this._drawRangeFallback(L.fallback, name, off, L.top, L.tint(pal), pal);
    }
    this._drawRider(pal, t, dt);
    this._drawGrid(pal, t);
  }

  _drawStars(pal, t, dt) {
    const g = this.starsG;
    g.clear();
    const a = this.alpha;
    for (const st of this.stars) {
      const tw = this.reduced ? 0.7 : 0.5 + 0.5 * Math.sin(t * 0.001 * st.speed + st.phase);
      const c = pal[st.hue];
      if (st.big) {
        g.fillStyle(c, (0.35 + 0.6 * tw) * a);
        g.fillRect(st.x, st.y, 1, 1);
        // a cross-shaped twinkle on the bright ones
        if (tw > 0.75) {
          g.fillStyle(c, 0.35 * (tw - 0.75) * 4 * a);
          g.fillRect(st.x - 1, st.y, 3, 1);
          g.fillRect(st.x, st.y - 1, 1, 3);
        }
      } else {
        g.fillStyle(c, (0.15 + 0.45 * tw) * a);
        g.fillRect(st.x, st.y, 1, 1);
      }
    }
    // shooting star: a short diagonal streak with a fading tail, every few seconds
    if (this.reduced) { this.shooting = null; return; }
    if (!this.shooting && t >= this.nextShootAt) {
      const r = this.rand;
      this.shooting = { x: 60 + r() * (GAME_WIDTH - 120), y: 6 + r() * (this.horizon * 0.35), born: t, vx: -(180 + r() * 120), vy: 70 + r() * 40 };
      this.nextShootAt = t + 5000 + r() * 7000;
    }
    const sh = this.shooting;
    if (sh) {
      const age = (t - sh.born) / 1000;
      if (age > 0.7) { this.shooting = null; return; }
      const life = 1 - age / 0.7;
      const hx = sh.x + sh.vx * age;
      const hy = sh.y + sh.vy * age;
      for (let i = 0; i < 14; i++) {
        const k = i / 14;
        g.fillStyle(i === 0 ? pal.text : pal.cyan, (1 - k) * life * a);
        g.fillRect(Math.round(hx - sh.vx * 0.04 * k), Math.round(hy - sh.vy * 0.04 * k), 1, 1);
      }
    }
  }

  _drawSun(pal) {
    const g = this.sunG;
    g.clear();
    const r = SUN_D / 2;
    const top = Math.round(this.sunY - r);
    const cx = this.sunX;
    const chord = (y) => {
      const dy = y + 0.5 - this.sunY;
      return dy * dy >= r * r ? 0 : Math.sqrt(r * r - dy * dy);
    };
    if (!this.sun) {
      // fallback disc: amber top to magenta bottom, row by row
      for (let y = top; y < top + SUN_D && y <= this.horizon; y++) {
        const hw = chord(y);
        if (hw <= 0) continue;
        g.fillStyle(mixColor(pal.amber, pal.magenta, (y - top) / SUN_D), this.alpha);
        g.fillRect(Math.round(cx - hw), y, Math.round(hw * 2), 1);
      }
    }
    // slice gaps over the lower 60% of the disc, thickening toward the bottom and drifting downward
    const start = top + Math.round(SUN_D * 0.4);
    const end = top + SUN_D;
    const P = 9;
    const off = this.sunPhase % P;
    for (let y0 = start - P + off; y0 < end; y0 += P) {
      const f = clamp01((y0 - start) / (end - start));
      const thick = Math.max(1, Math.round(1 + f * 5));
      for (let y = Math.round(y0); y < Math.round(y0) + thick; y++) {
        if (y < start || y >= end || y > this.horizon) continue;
        const hw = chord(y);
        if (hw <= 0) continue;
        g.fillStyle(this.skyRows[y] !== undefined ? this.skyRows[y] : pal.bg, 1);
        g.fillRect(Math.floor(cx - hw) - 1, y, Math.ceil(hw * 2) + 2, 1);
      }
    }
  }

  /** Procedural stand-in for a mountain layer whose SVG did not load: the same ridge, rim and body. */
  _drawRangeFallback(g, name, off, top, color, pal) {
    g.clear();
    const L = MENU_LAYERS[name];
    let prev = top + ridgeY(name, off - 1);
    for (let x = 0; x < GAME_WIDTH; x++) {
      const y = top + ridgeY(name, x + off);
      // opaque body (like the art), then a rim that spans to the previous column so steep slopes stay joined
      g.fillStyle(mixColor(pal.bg, color, 0.22), 1);
      g.fillRect(x, y, 1, top + L.h - y);
      g.fillStyle(color, 1);
      g.fillRect(x, Math.min(y, prev + 1), 1, Math.max(1, Math.abs(y - prev)));
      prev = y;
    }
  }

  _drawRider(pal, t, dt) {
    if (!this.riderParts && !this.riderG) return;
    const L = this.layers[RIDER_LAYER];
    // drift slowly back and forth across the right half so the carve reads as speed changes
    if (!this.reduced) this.riderX = 320 + 60 * Math.sin(t / 7000);
    const worldX = this.riderX + Math.floor(this.layerScroll[RIDER_LAYER]);
    let y = L.top + ridgeY(RIDER_LAYER, worldX);
    let rot = ridgeSlope(RIDER_LAYER, worldX);
    // the hop: a parabola with a full backflip, every 6-10 s
    if (!this.reduced) {
      if (this.hopStart < 0 && t >= this.nextHopAt) {
        this.hopStart = t;
        this.nextHopAt = t + 6000 + this.rand() * 4000;
      }
      if (this.hopStart >= 0) {
        const p = (t - this.hopStart) / HOP_MS;
        if (p >= 1) this.hopStart = -1;
        else {
          y -= Math.round(16 * 4 * p * (1 - p));
          rot -= Math.PI * 2 * Ease.inOutCubic(p);
        }
      }
    } else this.hopStart = -1;
    const objs = this.riderParts || [this.riderG];
    for (const o of objs) {
      o.setPosition(Math.round(this.riderX), y);
      o.setRotation(rot);
      o.setAlpha(this.alpha);
    }
  }

  _drawGrid(pal, t) {
    const g = this.ground;
    g.clear();
    const hy = this.horizon;
    const a = this.alpha;
    const depthH = GAME_HEIGHT - hy;
    const warpGlow = clamp01((this._warpFactor() - 1) / 8);
    // The floor is opaque and in front of the sun and ranges: it hides the disc's lower part below the
    // horizon, which is what sets the sun "into" the grid.
    g.fillStyle(this.groundBase === undefined ? pal.bgAlt : this.groundBase, 1);
    g.fillRect(0, hy + 1, GAME_WIDTH, depthH);
    g.fillStyle(this.groundHaze === undefined ? pal.bgAlt : this.groundHaze, 1);
    g.fillRect(0, hy + 1, GAME_WIDTH, 4);
    g.fillStyle(this.groundHaze === undefined ? pal.bgAlt : this.groundHaze, 0.5);
    g.fillRect(0, hy + 5, GAME_WIDTH, 4);
    // horizontal lines: perspective spacing (quadratic), fading in from the horizon, brighter with warp
    const rows = 12;
    const ph = this.gridPhase % 1;
    for (let i = 0; i < rows; i++) {
      const f = (i + ph) / rows;
      const y = Math.round(hy + depthH * f * f);
      if (y <= hy) continue;
      g.fillStyle(pal.cyan, (0.12 + 0.55 * f + 0.25 * warpGlow) * a);
      g.fillRect(0, y, GAME_WIDTH, 1);
    }
    // vertical lines converging on the vanishing point at the sun's centre column
    const vx = this.sunX;
    for (let i = -14; i <= 14; i++) {
      const x1 = vx + i * 46;
      g.lineStyle(1, pal.cyan, (0.18 + 0.1 * (1 - Math.abs(i) / 14) + 0.2 * warpGlow) * a);
      g.lineBetween(vx + i * 6, hy + 1, x1, GAME_HEIGHT);
    }
    // the horizon: hot magenta under a crisp cyan line, with a soft glow above
    g.fillStyle(pal.magenta, 0.18 * a);
    g.fillRect(0, hy - 2, GAME_WIDTH, 2);
    g.fillStyle(pal.cyan, 0.9 * a);
    g.fillRect(0, hy, GAME_WIDTH, 1);
    g.fillStyle(pal.magenta, 0.5 * a);
    g.fillRect(0, hy + 1, GAME_WIDTH, 1);
  }

  /** @returns {void} */
  destroy() {
    if (this._unbind) this._unbind();
    this._unbind = null;
    if (this._riderUnbind) this._riderUnbind();
    this._riderUnbind = null;
    const kill = (o) => { if (o && o.scene) o.destroy(); };
    kill(this.sky); kill(this.starsG); kill(this.sunGlow); kill(this.sun); kill(this.sunG); kill(this.ground);
    for (const name of MENU_LAYER_ORDER) {
      const L = this.layers && this.layers[name];
      if (L) { kill(L.sprite); kill(L.fallback); }
    }
    for (const o of this.riderParts || []) kill(o);
    kill(this.riderG);
    this.sky = null;
    this.g = null;
    this.ground = null;
  }
}
