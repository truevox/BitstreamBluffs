/**
 * OWNER: gameplay engineer. Phaser-free and pure (no Math.random, no Date): unit-tested in tests/src/biome-transition.test.js.
 *
 * #65 presentation: the look of an arcade bridge. A bridge is a short corridor the sled rides through. Over its first
 * DISSOLVE_FRAC the outgoing biome's look dissolves into a pixel grid (the "veil" covers the backdrop block by block);
 * the middle is pure arcade; over the last REBUILD_FRAC the incoming biome's look is revealed again as the veil lifts.
 *
 * Everything here is a pure function of (the bridge's span, the sled's x): no time, no accumulated state, no RNG, so a
 * frame is the same at any frame rate and after any pause, and nothing here can reach terrain, physics, hazards or score.
 * Only the look is decided here (which biome's palette/motif the world wears, and how much of the screen the veil
 * covers); what the generator says the biome is stays the answer for BIOME_ENTER, discovery, music and gameplay.
 */

/** Share of the bridge (from its start) over which the outgoing look dissolves. */
export const DISSOLVE_FRAC = 0.25;
/** Share of the bridge (up to its end) over which the incoming look is reconstructed. */
export const REBUILD_FRAC = 0.25;

/** Side of one veil block, px. 16 divides 480 exactly (30 columns); 270 / 16 = 17 rows (the last is clipped). */
export const VEIL_CELL_PX = 16;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * How far along a bridge x is, 0 at its start to 1 at its end (unclamped outside).
 * @param {{startX:number, endX:number}} span
 * @param {number} x world px
 * @returns {number}
 */
export function bridgeProgress(span, x) {
  const len = span.endX - span.startX;
  return len > 0 ? (x - span.startX) / len : 0;
}

/**
 * The look at world x.
 *
 *   t < DISSOLVE_FRAC            outgoing biome, veil rising 0 -> 1
 *   DISSOLVE_FRAC <= t <= 1 - REBUILD_FRAC   arcade, veil 1 (the look changes under full coverage, so no pop shows)
 *   t > 1 - REBUILD_FRAC         incoming biome, veil falling 1 -> 0
 *
 * `enabled` false (reduced motion, or effects off) is the hard cut: the veil is simply on for the whole bridge and the
 * look is whatever the generator says (arcade), exactly the pre-dissolve behaviour.
 *
 * @param {{startX:number, endX:number, fromId:string|null, toId:string|null}|null} span the bridge containing x (TerrainGenerator.bridgeSpanAt), or null
 * @param {number} x world px (the sled's)
 * @param {string|null} plainId the generator's own biome at x (biomeAtX): what the look is outside any bridge
 * @param {boolean} enabled false = hard cut
 * @returns {{veil:number, lookId:string|null, t:number}} veil 0..1 (share of blocks covered), lookId (null = arcade), t progress (-1 off a bridge)
 */
export function bridgeLook(span, x, plainId, enabled) {
  if (!span) return { veil: 0, lookId: plainId, t: -1 };
  const t = bridgeProgress(span, x);
  if (!enabled) return { veil: 1, lookId: plainId, t };
  const dissolveEnd = DISSOLVE_FRAC;
  const rebuildStart = 1 - REBUILD_FRAC;
  if (t < dissolveEnd) return { veil: clamp01(t / DISSOLVE_FRAC), lookId: span.fromId, t };
  if (t > rebuildStart) return { veil: clamp01((1 - t) / REBUILD_FRAC), lookId: span.toId, t };
  return { veil: 1, lookId: null, t };
}

// ------------------------------------------------------------------------------------------------ dither

/** 8x8 Bayer matrix (values 0..63), built from the 2x2 base: the classic ordered-dither threshold map. */
export const BAYER8 = (() => {
  let m = [[0, 2], [3, 1]];
  for (let n = 2; n < 8; n *= 2) {
    const next = [];
    for (let y = 0; y < n * 2; y++) {
      const row = [];
      for (let x = 0; x < n * 2; x++) {
        const q = m[y % n][x % n];
        row.push(4 * q + [[0, 2], [3, 1]][Math.floor(y / n)][Math.floor(x / n)]);
      }
      next.push(row);
    }
    m = next;
  }
  return Object.freeze(m.map((r) => Object.freeze(r)));
})();

/**
 * Is block (ix, iy) covered at this coverage? Ordered dither: coverage c covers the blocks whose Bayer threshold is
 * below c, so coverage only ever adds blocks as it rises (the dissolve never flickers) and 0 / 1 are exactly none / all.
 * @param {number} ix @param {number} iy block column / row
 * @param {number} coverage 0..1
 * @returns {boolean}
 */
export function veilCovers(ix, iy, coverage) {
  return (BAYER8[iy & 7][ix & 7] + 0.5) / 64 < coverage;
}

// ------------------------------------------------------------------------------------------------ cosmetic hash

/**
 * Integer hash of (n, seed) to [0, 1): the same one the backdrops use for per-cell variety. Pure and platform-stable.
 * @param {number} n @param {number} seed @returns {number}
 */
export function hash01(n, seed) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((seed | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
