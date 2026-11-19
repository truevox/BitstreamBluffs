/**
 * OWNER: UI engineer.
 * Menu backdrop mountain ridgelines as pure, periodic functions. Pure on purpose (no Phaser import):
 *
 *  - `tools/menu-art/generate-menu-art.mjs` rasterises these exact functions into the authored
 *    `public/assets/menu/mountains-*.svg` layers, and
 *  - `Backdrop` reads the SAME functions at runtime, both to draw the procedural fallback when an SVG
 *    failed to load and to put the attract-mode rider on the visible ridge.
 *
 * One source means the rider never floats above or sinks into the art, and a missing asset falls back to
 * the identical silhouette. Every profile is periodic over MENU_TERRAIN_PERIOD (the 480 px world width) so
 * the layers tile seamlessly as horizontally scrolling TileSprites.
 */

/** Horizontal period of every layer, in px. Equal to GAME_WIDTH so one texture tiles the screen exactly. */
export const MENU_TERRAIN_PERIOD = 480;

const TAU = Math.PI * 2;

/**
 * Layer geometry. `h` is the texture height; the ridge lives inside [top, h). Harmonics are integers so the
 * profile is periodic over the period. `ridged` folds a harmonic with |sin| for sharp, wire-frame peaks; the
 * near layer is left smooth so it reads as rolling foothills in front of the jagged ranges.
 * `speed` is the parallax scroll in px/s at warp 1 (far moves slowest).
 * @type {Readonly<Object<string,{h:number, top:number, amp:number, speed:number, ridged:boolean,
 *   harmonics:ReadonlyArray<[number, number, number]>}>>}
 */
export const MENU_LAYERS = Object.freeze({
  far: Object.freeze({
    h: 84, top: 4, amp: 66, speed: 3, ridged: true,
    harmonics: Object.freeze([[1, 0.5, 0.4], [2, 0.32, 2.1], [5, 0.12, 4.4], [13, 0.04, 1.3]]),
  }),
  mid: Object.freeze({
    h: 60, top: 6, amp: 46, speed: 8, ridged: true,
    harmonics: Object.freeze([[2, 0.5, 1.7], [3, 0.3, 0.2], [7, 0.12, 3.0], [17, 0.04, 5.1]]),
  }),
  near: Object.freeze({
    h: 36, top: 8, amp: 24, speed: 18, ridged: false,
    harmonics: Object.freeze([[2, 0.5, 2.6], [4, 0.3, 0.9], [7, 0.15, 4.0], [11, 0.05, 2.2]]),
  }),
});

/** Layer names, back to front (draw order). */
export const MENU_LAYER_ORDER = Object.freeze(['far', 'mid', 'near']);

/**
 * Normalised height 0..1 of a layer at x (any real x; wraps by the period).
 * @param {keyof MENU_LAYERS} name
 * @param {number} x
 * @returns {number}
 */
export function ridgeNorm(name, x) {
  const L = MENU_LAYERS[name];
  const raw = rawProfile(L, x);
  const [lo, hi] = rangeOf(name);
  // Remapped to the layer's own min..max over one period, so every layer uses its full amplitude: the sum
  // of harmonics never actually reaches 0 or 1, and unmapped it left flat, featureless valleys.
  const n = (raw - lo) / (hi - lo || 1);
  // A mild power curve deepens the valleys so peaks stand out against the horizon glow.
  return Math.pow(Math.min(1, Math.max(0, n)), L.ridged ? 1.25 : 1.1);
}

function rawProfile(L, x) {
  let sum = 0;
  let total = 0;
  for (const [k, a, ph] of L.harmonics) {
    const s = Math.sin((TAU * k * x) / MENU_TERRAIN_PERIOD + ph);
    // ridged: 1-|s| peaks sharply where s crosses zero, which is what gives the far ranges their crisp
    // crests; smooth: (s+1)/2 keeps the foothills round.
    sum += a * (L.ridged ? 1 - Math.abs(s) : (s + 1) / 2);
    total += a;
  }
  return sum / total;
}

/** @type {Map<string, [number, number]>} per-layer [min, max] of rawProfile over one period (lazy). */
const RANGES = new Map();
function rangeOf(name) {
  let r = RANGES.get(name);
  if (!r) {
    const L = MENU_LAYERS[name];
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = 0; x < MENU_TERRAIN_PERIOD; x++) {
      const v = rawProfile(L, x);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    r = [lo, hi];
    RANGES.set(name, r);
  }
  return r;
}

/**
 * Ridge Y of a layer at x, in texture pixels (0 = top of the layer texture). Integer, because the art is
 * rasterised per pixel column and the rider must stand on exactly the pixel the art drew.
 * @param {keyof MENU_LAYERS} name
 * @param {number} x
 * @returns {number}
 */
export function ridgeY(name, x) {
  const L = MENU_LAYERS[name];
  const xi = ((Math.floor(x) % MENU_TERRAIN_PERIOD) + MENU_TERRAIN_PERIOD) % MENU_TERRAIN_PERIOD;
  return Math.round(L.top + (1 - ridgeNorm(name, xi)) * L.amp);
}

/**
 * Ridge slope (radians, screen space: positive = descending to the right) around x, averaged over +-3 px so
 * a single stair step in the pixel ridge does not twitch the rider.
 * @param {keyof MENU_LAYERS} name
 * @param {number} x
 * @returns {number}
 */
export function ridgeSlope(name, x) {
  return Math.atan2(ridgeY(name, x + 3) - ridgeY(name, x - 3), 6);
}
