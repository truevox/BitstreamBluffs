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
export const MOTIFS = [
  'ridges', 'drift', 'terraces', 'currents', 'facets',
  // Audit T1: the six W6 backdrops. Each has a silhouette shape AND a decor pass (motifDecor), because a
  // starfield, a jellyfish or a gear cannot be told apart by a ridgeline alone.
  'stars', 'candy-stripes', 'jellyfish', 'brass-pipes', 'dew-drops', 'vents',
];

/** Shapes whose profile already carries its own character, so _layer adds no crest-sharpening term. */
const CRESTLESS = new Set(['step', 'facet', 'crater', 'gumdrop', 'cloud', 'works', 'moss', 'cone']);

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
  // Space Mountain: a low crater horizon (bowls with raised rims) under a dense starfield and a ringed planet.
  stars: {
    shape: 'crater',
    layers: [
      { baseY: 0.62, amp: 52, factor: 0.06, seed: 2.6, color: 'magenta', fillAlpha: 0.1, lineAlpha: 0.45 },
      { baseY: 0.76, amp: 40, factor: 0.17, seed: 5.3, color: 'cyan', fillAlpha: 0.09, lineAlpha: 0.42 },
    ],
  },
  // Candy Cane Canyon: round gumdrop hills under a candy-striped sky, canes and lollipops on the ridges.
  'candy-stripes': {
    shape: 'gumdrop',
    layers: [
      { baseY: 0.52, amp: 60, factor: 0.09, seed: 1.9, color: 'magenta', fillAlpha: 0.12, lineAlpha: 0.5 },
      { baseY: 0.66, amp: 40, factor: 0.2, seed: 4.4, color: 'text', fillAlpha: 0.08, lineAlpha: 0.38 },
    ],
  },
  // Sky Jellyfish Mountain: billowing cloud banks with jellyfish drifting in the sky above them.
  jellyfish: {
    shape: 'cloud',
    layers: [
      { baseY: 0.58, amp: 44, factor: 0.05, seed: 3.1, color: 'cyan', fillAlpha: 0.09, lineAlpha: 0.38 },
      { baseY: 0.7, amp: 30, factor: 0.14, seed: 6.6, color: 'text', fillAlpha: 0.07, lineAlpha: 0.32 },
    ],
  },
  // Steampunk Slopes: a blocky factory skyline with chimneys, gears turning behind it, a brass pipe run.
  'brass-pipes': {
    shape: 'works',
    layers: [
      { baseY: 0.5, amp: 66, factor: 0.1, seed: 2.2, color: 'amber', fillAlpha: 0.12, lineAlpha: 0.5 },
      { baseY: 0.66, amp: 44, factor: 0.22, seed: 5.9, color: 'magenta', fillAlpha: 0.09, lineAlpha: 0.4 },
    ],
  },
  // Micro Mountain: soft moss lumps, giant grass blades, big dew drops that catch the light.
  'dew-drops': {
    shape: 'moss',
    layers: [
      { baseY: 0.6, amp: 40, factor: 0.07, seed: 1.1, color: 'lime', fillAlpha: 0.1, lineAlpha: 0.42 },
      { baseY: 0.72, amp: 30, factor: 0.18, seed: 7.7, color: 'cyan', fillAlpha: 0.08, lineAlpha: 0.36 },
    ],
  },
  // Vertigo Vents: flat-topped volcanic cones, each vent glowing amber with a smoke plume rising from it.
  vents: {
    shape: 'cone',
    layers: [
      { baseY: 0.6, amp: 70, factor: 0.08, seed: 3.7, color: 'magenta', fillAlpha: 0.12, lineAlpha: 0.48 },
      { baseY: 0.74, amp: 40, factor: 0.2, seed: 8.4, color: 'amber', fillAlpha: 0.09, lineAlpha: 0.4 },
    ],
  },
};

/** Integer hash of (n, seed) to [0, 1). Pure, platform-stable (Math.imul), used for per-cell variety. */
function hash01(n, seed) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((seed | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Vent cone cell width (px of layer space); the plume decor finds cone tops from the same constant. */
const CONE_W = 230;

/**
 * One sample of a layer's height at a layer-space x, per shape. Pure. Every profile returns roughly
 * -1..1 (the W6 shapes 0..1) before amplitude, so section heights stay comparable between motifs.
 * @param {string} shape @param {number} wx @param {number} seed @returns {number}
 */
export function motifProfile(shape, wx, seed) {
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
  if (shape === 'crater') {
    // Space Mountain: a flat plain cut by bowls with raised rims, one crater per 150 px cell at most.
    const f = (wx + seed * 97) / 150;
    const c = Math.floor(f);
    const u = f - c;
    let h = 0.45 + 0.03 * Math.sin(wx * 0.02 + seed);
    if (hash01(c, seed * 1000) < 0.8) {
      const r = 0.22 + 0.16 * hash01(c + 7919, seed * 1000);
      const t = (u - 0.5) / r;
      if (Math.abs(t) < 1) h -= 0.4 * (1 - t * t);
      h += 0.3 * Math.exp(-(((Math.abs(t) - 1) / 0.24) ** 2));
    }
    return clamp01(h);
  }
  if (shape === 'gumdrop') {
    // Candy Cane Canyon: broad round domes with pinched valleys (a root of |sin| flattens the tops).
    return Math.abs(Math.sin(wx * 0.0105 + seed)) ** 0.45 * 0.85 + Math.abs(Math.sin(wx * 0.031 + seed * 2)) * 0.1;
  }
  if (shape === 'cloud') {
    // Sky Jellyfish Mountain: scalloped billows, two |sin| octaves so every crest is a puff.
    return 0.25 + Math.abs(Math.sin(wx * 0.017 + seed)) * 0.45 + Math.abs(Math.sin(wx * 0.041 + seed * 1.9)) * 0.3;
  }
  if (shape === 'works') {
    // Steampunk Slopes: flat-roofed blocks at quantised heights, some with a chimney stack.
    const f = (wx + seed * 53) / 44;
    const c = Math.floor(f);
    const u = f - c;
    let h = 0.25 + 0.5 * (Math.round(hash01(c, seed * 1000) * 4) / 4);
    if (hash01(c + 104729, seed * 1000) > 0.62 && u > 0.3 && u < 0.56) h += 0.3;
    return clamp01(h);
  }
  if (shape === 'moss') {
    // Micro Mountain: soft lumpy moss, never sharp.
    return 0.42 + Math.sin(wx * 0.0065 + seed) * 0.22 + Math.abs(Math.sin(wx * 0.029 + seed * 1.3)) * 0.22;
  }
  if (shape === 'cone') {
    // Vertigo Vents: volcanic cones with a flat top and a small vent notch in the middle.
    const f = (wx + seed * 71) / CONE_W;
    const c = Math.floor(f);
    const d = Math.abs(2 * (f - c) - 1);
    const hv = 0.7 + 0.3 * hash01(c, seed * 1000);
    let h = 0.08 + Math.max(0, Math.min(1 - d * 1.5, 0.8)) * hv;
    if (d < 0.07) h -= 0.05;
    return clamp01(h);
  }
  // 'peak' — the original ridge profile, unchanged from pre-W3 so base terrain looks identical.
  return Math.sin(wx * 0.011 + seed) * 0.55 + Math.sin(wx * 0.027 + seed * 2.3) * 0.3 + Math.sin(wx * 0.061 + seed * 4.1) * 0.15;
}

/** Screen y of a layer's silhouette at screen x (same expression _layer draws, minus the 8 px sampling). */
function layerYAt(shape, layer, scrollX, sx) {
  const h = motifProfile(shape, sx + scrollX * layer.factor, layer.seed);
  const crest = CRESTLESS.has(shape) ? 0 : (h > 0 ? h * layer.amp * 0.2 : 0);
  return GAME_HEIGHT * layer.baseY - Math.abs(h) * layer.amp - crest;
}

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

/** Horizontal tile the decor items repeat over; wider than the screen so nothing pops at the seams. */
const DECOR_TILE = 960;
/** Items are emitted only while their anchor is within this many px of the screen. */
const DECOR_MARGIN = 40;
/** Per-motif base seed for the decor layout (any fixed odd number; changing one re-lays that motif). */
const DECOR_SEEDS = {
  stars: 0x5ca7, 'candy-stripes': 0xc4d1, jellyfish: 0x1e11, 'brass-pipes': 0xb4a5, 'dew-drops': 0xde3d, vents: 0x7e57,
};
const EMPTY_DECOR = Object.freeze([]);

/** Screen x of an item anchored at tile x `x0` scrolling at `factor`, or null if it is off screen. */
function tileX(x0, scrollX, factor) {
  let x = (x0 - scrollX * factor) % DECOR_TILE;
  if (x < 0) x += DECOR_TILE;
  x -= DECOR_MARGIN;
  return x > GAME_WIDTH + DECOR_MARGIN ? null : x;
}

/** Fixed per-(motif, seed) item layout, generated once from mulberry32 and memoised (never Math.random). */
const layoutCache = new Map();
function decorLayout(motif, seed) {
  const key = `${motif}|${seed}`;
  let lay = layoutCache.get(key);
  if (lay) return lay;
  const rnd = mulberry32((DECOR_SEEDS[motif] ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0);
  const items = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  const span = (lo, hi) => lo + rnd() * (hi - lo);
  if (motif === 'stars') {
    lay = {
      stars: items(36, () => ({ x0: rnd() * DECOR_TILE, y: span(4, GAME_HEIGHT * 0.5), f: span(0.01, 0.05), tw: rnd() * 6.28, bright: rnd() < 0.2 })),
      planet: { x0: span(200, 700), y: span(GAME_HEIGHT * 0.16, GAME_HEIGHT * 0.26), r: span(11, 15), tilt: span(-0.45, -0.15) },
    };
  } else if (motif === 'candy-stripes') {
    lay = {
      canes: items(6, (i) => ({ x0: (i + rnd() * 0.7) * (DECOR_TILE / 6), h: span(30, 44), flip: rnd() < 0.5 })),
      pops: items(5, (i) => ({ x0: (i + rnd() * 0.7) * (DECOR_TILE / 5), r: span(8, 12), stick: span(18, 26), color: ['magenta', 'amber', 'lime'][i % 3], ph: rnd() * 6.28 })),
    };
  } else if (motif === 'jellyfish') {
    lay = {
      jellies: items(7, (i) => {
        const size = span(7, 14);
        return { x0: (i + rnd() * 0.6) * (DECOR_TILE / 7), y: span(GAME_HEIGHT * 0.15, GAME_HEIGHT * 0.4), s: size, f: 0.03 + ((size - 7) / 7) * 0.06, color: ['magenta', 'cyan', 'lime'][i % 3], ph: rnd() * 6.28 };
      }),
    };
  } else if (motif === 'brass-pipes') {
    lay = {
      gears: items(4, (i) => ({ x0: (i + rnd() * 0.6) * (DECOR_TILE / 4), y: span(GAME_HEIGHT * 0.2, GAME_HEIGHT * 0.28), r: span(15, 24), ph: rnd() * 6.28, dir: i % 2 ? -1 : 1 })),
      pipeY: GAME_HEIGHT * 0.555,
      drops: items(15, () => rnd() < 0.3),
    };
  } else if (motif === 'dew-drops') {
    const blade = (layer, lo, hi) => (i, n) => ({ layer, x0: (i + rnd() * 0.8) * (DECOR_TILE / n), h: span(lo, hi), w: span(5, 8) * (hi / 70), lean: span(-18, 18), drop: rnd() < 0.75, dt: span(0.45, 0.8), ph: rnd() * 6.28 });
    const far = blade(0, 34, 60);
    const near = blade(1, 62, 100);
    lay = { blades: [...items(6, (i) => far(i, 6)), ...items(5, (i) => near(i, 5))] };
  } else if (motif === 'vents') {
    lay = { ph: rnd() * 6.28, wind: span(0.6, 1.2) };
  } else {
    lay = null;
  }
  if (layoutCache.size > 64) layoutCache.clear();
  layoutCache.set(key, lay);
  return lay;
}

/** Points of an ellipse (closed polygon) centred at (cx, cy), rotated by `rot`. */
function ellipsePts(cx, cy, rx, ry, rot, n) {
  const pts = [];
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ex = Math.cos(a) * rx;
    const ey = Math.sin(a) * ry;
    pts.push({ x: cx + ex * cr - ey * sr, y: cy + ex * sr + ey * cr });
  }
  return pts;
}

/**
 * Audit T1: the decor a W6 motif draws on top of its silhouette — the things that make the backdrop read
 * as its biome (stars and a ringed planet, candy canes, jellyfish, gears and pipes, dew drops, vent smoke).
 * The five batch-1 motifs and the base backdrop have none, so their draw calls are unchanged.
 *
 * Pure function of (motif, scrollX, timeMs, seed): the item layout comes from a seeded mulberry32 and all
 * animation from `timeMs` (scene time), never Math.random or Date.now, so a repaint is repeatable.
 * Like motifGeometry it never names a colour, only a palette KEY, and never `danger`: hazards must stay the
 * only thing on screen drawn in the hazard colour.
 *
 * Each primitive has `depth`: -1 = in the sky (before every layer), k = right after silhouette layer k.
 * Kinds: `poly` {pts, fillAlpha, lineAlpha}, `line` {pts (open polyline), alpha, width},
 * `circle` {x, y, r, fillAlpha, lineAlpha}, `rect` {x, y, w, h, alpha}; all carry `color` (a palette key).
 * @param {string|null} motif
 * @param {number} scrollX camera scroll X (world px)
 * @param {number} [timeMs=0] scene time
 * @param {number} [seed=0] layout seed (Background uses 0; any integer gives a different but stable layout)
 * @returns {ReadonlyArray<Object>} primitives in draw order
 */
export function motifDecor(motif, scrollX, timeMs = 0, seed = 0) {
  if (typeof motif !== 'string' || !DECOR_SEEDS[motif] || !MOTIFS.includes(motif)) return EMPTY_DECOR;
  const sx = Number.isFinite(scrollX) ? scrollX : 0;
  const t = Number.isFinite(timeMs) ? timeMs : 0;
  const lay = decorLayout(motif, Number.isFinite(seed) ? Math.trunc(seed) : 0);
  const def = MOTIF_DEFS[motif];
  const out = [];
  const W = GAME_WIDTH;
  const H = GAME_HEIGHT;

  if (motif === 'stars') {
    for (const st of lay.stars) {
      const x = tileX(st.x0, sx, st.f);
      if (x === null || x < -2 || x > W + 2) continue;
      const alpha = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t / 450 + st.tw));
      if (st.bright) {
        out.push({ kind: 'line', depth: -1, color: 'cyan', alpha, width: 1, pts: [{ x: x - 3, y: st.y }, { x: x + 3, y: st.y }] });
        out.push({ kind: 'line', depth: -1, color: 'cyan', alpha, width: 1, pts: [{ x, y: st.y - 3 }, { x, y: st.y + 3 }] });
      } else {
        out.push({ kind: 'rect', depth: -1, color: 'text', alpha, x: Math.floor(x), y: Math.floor(st.y), w: 1, h: 1 });
      }
    }
    const pl = lay.planet;
    const px = tileX(pl.x0, sx, 0.012);
    if (px !== null) {
      out.push({ kind: 'circle', depth: -1, color: 'lime', fillAlpha: 0.2, lineAlpha: 0.6, x: px, y: pl.y, r: pl.r });
      out.push({ kind: 'poly', depth: -1, color: 'amber', fillAlpha: 0, lineAlpha: 0.65, pts: ellipsePts(px, pl.y, pl.r * 1.9, pl.r * 0.42, pl.tilt, 20) });
    }
  } else if (motif === 'candy-stripes') {
    // Candy-cane sky: slanted alternating bands across the upper sky, scrolling slowly.
    const P = 28;
    const yb = H * 0.5;
    const K = yb * 0.4;
    const off = sx * 0.04;
    // First band whose top edge reaches the screen; the last one must cover the bottom-right corner,
    // which the slant pushes K px to the left of its top edge.
    for (let k = Math.floor(off / P); ; k++) {
      const x = k * P - off;
      if (x > W + K) break;
      out.push({
        kind: 'poly', depth: -1, color: k % 2 === 0 ? 'magenta' : 'text', fillAlpha: 0.05, lineAlpha: 0,
        pts: [{ x, y: 0 }, { x: x + P, y: 0 }, { x: x + P - K, y: yb }, { x: x - K, y: yb }],
      });
    }
    // Candy canes standing on the far ridge: a striped stick and hook, drawn as alternating segments.
    const L0 = def.layers[0];
    for (const c of lay.canes) {
      const x = tileX(c.x0, sx, L0.factor);
      if (x === null) continue;
      const yB = layerYAt(def.shape, L0, sx, x) + 2;
      const top = yB - c.h;
      const dir = c.flip ? -1 : 1;
      const path = [];
      for (let y = yB; y > top; y -= 5) path.push({ x, y });
      for (let i = 0; i <= 6; i++) {
        const a = Math.PI - (i / 6) * Math.PI;
        path.push({ x: x + dir * (6 + Math.cos(a) * 6), y: top - Math.sin(a) * 6 });
      }
      path.push({ x: x + dir * 12, y: top + 5 });
      // One white stroke for the whole cane, then a red stripe on every other segment.
      out.push({ kind: 'line', depth: 0, color: 'text', alpha: 0.7, width: 3, pts: path });
      for (let i = 0; i < path.length - 1; i += 2) {
        out.push({ kind: 'line', depth: 0, color: 'magenta', alpha: 0.8, width: 3, pts: [path[i], path[i + 1]] });
      }
    }
    // Lollipops on the near ridge: stick, disc, and a slowly turning spiral.
    const L1 = def.layers[1];
    for (const lp of lay.pops) {
      const x = tileX(lp.x0, sx, L1.factor);
      if (x === null) continue;
      const yB = layerYAt(def.shape, L1, sx, x) + 2;
      const cy = yB - lp.stick - lp.r;
      out.push({ kind: 'line', depth: 1, color: 'text', alpha: 0.55, width: 2, pts: [{ x, y: yB }, { x, y: cy + lp.r }] });
      out.push({ kind: 'circle', depth: 1, color: lp.color, fillAlpha: 0.32, lineAlpha: 0.75, x, y: cy, r: lp.r });
      const spiral = [];
      const spin = t * 0.001 + lp.ph;
      for (let i = 0; i <= 16; i++) {
        const a = spin + (i / 16) * Math.PI * 3.5;
        const rr = (i / 16) * lp.r * 0.85;
        spiral.push({ x: x + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
      }
      out.push({ kind: 'line', depth: 1, color: 'text', alpha: 0.6, width: 1, pts: spiral });
    }
  } else if (motif === 'jellyfish') {
    for (const j of lay.jellies) {
      const x = tileX(j.x0, sx, j.f);
      if (x === null) continue;
      const pulse = 1 + 0.08 * Math.sin(t / 520 + j.ph);
      const y = j.y + Math.sin(t / 1400 + j.ph) * 5;
      const rx = j.s * pulse;
      const ry = (j.s * 0.8) / pulse;
      const bell = [];
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI + (i / 10) * Math.PI;
        bell.push({ x: x + Math.cos(a) * rx, y: y + Math.sin(a) * ry });
      }
      // Scalloped skirt along the bottom of the bell.
      for (let i = 1; i < 5; i++) bell.push({ x: x + rx - (i / 5) * 2 * rx, y: y + (i % 2 ? 2 : 0) });
      out.push({ kind: 'poly', depth: -1, color: j.color, fillAlpha: 0.22, lineAlpha: 0.6, pts: bell });
      for (let k = 0; k < 4; k++) {
        const bx = x - rx * 0.6 + (k / 3) * rx * 1.2;
        const len = j.s * 2.2;
        const tend = [];
        for (let i = 0; i <= 5; i++) {
          const u = i / 5;
          tend.push({ x: bx + Math.sin(t / 650 + j.ph + k * 0.7 + u * 3) * u * 3, y: y + 2 + u * len });
        }
        out.push({ kind: 'line', depth: -1, color: j.color, alpha: 0.45, width: 1, pts: tend });
      }
    }
  } else if (motif === 'brass-pipes') {
    // Gears turning behind the factory roofline (scene time drives the rotation).
    for (const gr of lay.gears) {
      const x = tileX(gr.x0, sx, 0.06);
      if (x === null) continue;
      const teeth = Math.max(6, Math.round(gr.r / 2.4));
      const rot = gr.ph + gr.dir * t * (0.012 / gr.r);
      const pts = [];
      for (let i = 0; i < teeth; i++) {
        const a = rot + (i / teeth) * Math.PI * 2;
        const st = (Math.PI * 2) / teeth;
        pts.push({ x: x + Math.cos(a) * gr.r, y: gr.y + Math.sin(a) * gr.r });
        pts.push({ x: x + Math.cos(a + st * 0.15) * (gr.r + 4), y: gr.y + Math.sin(a + st * 0.15) * (gr.r + 4) });
        pts.push({ x: x + Math.cos(a + st * 0.45) * (gr.r + 4), y: gr.y + Math.sin(a + st * 0.45) * (gr.r + 4) });
        pts.push({ x: x + Math.cos(a + st * 0.6) * gr.r, y: gr.y + Math.sin(a + st * 0.6) * gr.r });
      }
      out.push({ kind: 'poly', depth: -1, color: 'amber', fillAlpha: 0.16, lineAlpha: 0.55, pts });
      out.push({ kind: 'circle', depth: -1, color: 'amber', fillAlpha: 0, lineAlpha: 0.55, x, y: gr.y, r: gr.r * 0.38 });
    }
    // A brass pipe run in front of the far roofline: pipe, highlight, flanges, and some drop pipes.
    const L0 = def.layers[0];
    const py = lay.pipeY;
    out.push({ kind: 'line', depth: 0, color: 'amber', alpha: 0.5, width: 4, pts: [{ x: -4, y: py }, { x: W + 4, y: py }] });
    out.push({ kind: 'line', depth: 0, color: 'text', alpha: 0.22, width: 1, pts: [{ x: -4, y: py - 1 }, { x: W + 4, y: py - 1 }] });
    const FL = 64;
    const off = sx * L0.factor;
    const k0 = Math.floor(off / FL);
    for (let k = k0; ; k++) {
      const x = k * FL - off;
      if (x > W + 4) break;
      out.push({ kind: 'rect', depth: 0, color: 'amber', alpha: 0.6, x: x - 2, y: py - 4, w: 4, h: 8 });
      if (lay.drops[((k % 15) + 15) % 15]) {
        const yb = H * 0.68;
        out.push({ kind: 'line', depth: 0, color: 'amber', alpha: 0.45, width: 3, pts: [{ x: x + 10, y: py }, { x: x + 10, y: yb }] });
        out.push({ kind: 'circle', depth: 0, color: 'amber', fillAlpha: 0.4, lineAlpha: 0.6, x: x + 10, y: py, r: 3 });
      }
    }
  } else if (motif === 'dew-drops') {
    for (const b of lay.blades) {
      const L = def.layers[b.layer];
      const x = tileX(b.x0, sx, L.factor);
      if (x === null) continue;
      const yB = layerYAt(def.shape, L, sx, x) + 3;
      const centre = (u) => ({ x: x + b.lean * u * u, y: yB - b.h * u });
      const left = [];
      const right = [];
      for (let i = 0; i <= 5; i++) {
        const u = i / 5;
        const c = centre(u);
        const hw = b.w * (1 - u);
        left.push({ x: c.x - hw, y: c.y });
        right.push({ x: c.x + hw, y: c.y });
      }
      out.push({ kind: 'poly', depth: b.layer, color: 'lime', fillAlpha: 0.18, lineAlpha: 0.5, pts: [...left, ...right.reverse()] });
      if (b.drop) {
        const c = centre(b.dt);
        const r = 3.5 + b.h / 16;
        const dx = c.x + (b.lean >= 0 ? -1 : 1) * b.w * (1 - b.dt) * 0.4;
        const dy = c.y - r * 0.6;
        out.push({ kind: 'circle', depth: b.layer, color: 'cyan', fillAlpha: 0.3, lineAlpha: 0.75, x: dx, y: dy, r });
        out.push({ kind: 'circle', depth: b.layer, color: 'text', fillAlpha: 0.5 + 0.4 * Math.sin(t / 900 + b.ph), lineAlpha: 0, x: dx - r * 0.35, y: dy - r * 0.35, r: Math.max(1, r * 0.3) });
      }
    }
  } else if (motif === 'vents') {
    // A plume over every active cone, on the same layer as its cone, so the near ridge hides far smoke.
    def.layers.forEach((L, li) => {
      const s71 = L.seed * 71;
      const off = sx * L.factor;
      const c0 = Math.floor((off - DECOR_MARGIN + s71) / CONE_W);
      const c1 = Math.floor((off + W + DECOR_MARGIN + s71) / CONE_W);
      const plumeH = li === 0 ? 58 : 44;
      for (let c = c0; c <= c1; c++) {
        if (hash01(c, L.seed * 1000 + 17) < 0.25) continue;
        const cx = (c + 0.5) * CONE_W - s71 - off;
        if (cx < -60 || cx > W + 60) continue;
        const top = layerYAt(def.shape, L, sx, cx) + 1;
        out.push({ kind: 'circle', depth: li, color: 'amber', fillAlpha: 0.35, lineAlpha: 0, x: cx, y: top, r: 4 });
        const cell = hash01(c, 4242);
        for (let k = 0; k < 6; k++) {
          const age = (((t / 3800 + k / 6 + cell) % 1) + 1) % 1;
          out.push({
            kind: 'circle', depth: li, color: 'text', fillAlpha: 0.3 * (1 - age), lineAlpha: 0,
            x: cx + age * 14 * lay.wind + Math.sin(age * 5 + lay.ph + c) * 3,
            y: top - 4 - age * plumeH,
            r: (2.5 + age * 8) * (li === 0 ? 1 : 0.8),
          });
        }
      }
    });
  }
  return out;
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
    this.decorSeed = 0; // layout seed for motifDecor; fixed so a biome's backdrop looks the same every run
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
    return motifProfile(shape, wx, seed);
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
      const crest = CRESTLESS.has(shape) ? 0 : (h > 0 ? h * layer.amp * 0.2 : 0);
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

  /**
   * Draw the decor primitives at one depth (see motifDecor). Colour keys resolve through the palette the
   * same way _layer's do, so colour-blind mode and biome tints apply to decor too.
   * @param {Phaser.GameObjects.Graphics} g
   * @param {ReadonlyArray<Object>} decor
   * @param {number} depth
   * @param {Object<string,number>} palette
   * @returns {void}
   */
  _decor(g, decor, depth, palette) {
    for (const d of decor) {
      if (d.depth !== depth) continue;
      const color = palette[d.color] != null ? palette[d.color] : palette.cyan;
      if (d.kind === 'rect') {
        g.fillStyle(color, d.alpha);
        g.fillRect(d.x, d.y, d.w, d.h);
      } else if (d.kind === 'line') {
        g.lineStyle(d.width, color, d.alpha);
        if (d.pts.length === 2) g.lineBetween(d.pts[0].x, d.pts[0].y, d.pts[1].x, d.pts[1].y);
        else g.strokePoints(d.pts, false, false);
      } else if (d.kind === 'circle') {
        if (d.fillAlpha > 0) {
          g.fillStyle(color, d.fillAlpha);
          g.fillCircle(d.x, d.y, d.r);
        }
        if (d.lineAlpha > 0) {
          g.lineStyle(1, color, d.lineAlpha);
          g.strokeCircle(d.x, d.y, d.r);
        }
      } else if (d.kind === 'poly') {
        if (d.fillAlpha > 0) {
          g.fillStyle(color, d.fillAlpha);
          g.fillPoints(d.pts, true);
        }
        if (d.lineAlpha > 0) {
          g.lineStyle(1, color, d.lineAlpha);
          g.strokePoints(d.pts, true, true);
        }
      }
    }
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
    // Audit T1: W6 motifs add decor between/over their layers. The base backdrop and the batch-1 motifs
    // have none, so their draw calls are exactly what they were.
    const decor = this.motif ? motifDecor(this.motif, scrollX, timeMs, this.decorSeed) : EMPTY_DECOR;
    if (decor.length) this._decor(g, decor, -1, p);
    for (let i = 0; i < geom.layers.length; i++) {
      this._layer(g, scrollX, geom.layers[i], p, geom.shape);
      if (decor.length) this._decor(g, decor, i, p);
    }
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
