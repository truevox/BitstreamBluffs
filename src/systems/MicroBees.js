/**
 * Micro Mountain glow-up: the HUGE bees of the dew-drops backdrop. Pure, cosmetic only.
 *
 * SledHEAD canon (Marvin): Micro Mountain is the wild space Pete keeps for his bees, and the player rides it
 * as an RC micro sled drone. The bees are ordinary bees at ordinary bee size, so next to the micro rider they
 * are huge. They are pollinators going about their business: one or two on screen at most, drifting slowly,
 * wings a blur.
 *
 * WHY A SEPARATE PURE MODULE. Background.js is an entity; the placement, the motion and the drawn shape are
 * pure functions of (scrollX, timeMs, seed), so they live here where Jest can sweep them. Background only
 * appends `beePrimitives(beesAt(...))` to the dew-drops decor and draws them with its existing decor painter.
 *
 * RULES (tests/src/micro-bees.test.js):
 *  - no Phaser, window, Math.random or Date.now: layout from a seeded mulberry32, animation from scene time;
 *  - palette KEYS only and never `danger`, so colourblind mode and the biome palette apply and only hazards
 *    read as hazards;
 *  - low alpha (BEE_MAX_FILL_ALPHA / BEE_MAX_LINE_ALPHA) so a Dew Drop or a Royal Jelly Wax in front of a bee
 *    keeps its contrast;
 *  - inside the W6 decor bounds: 0..GAME_HEIGHT vertically, at most 96 px of overhang left and right;
 *  - zero gameplay effect: nothing here is read by the generator, the physics or the sim.
 */
import { GAME_WIDTH, GAME_HEIGHT } from '../constants.js';

/** Bees per tile. The tile is far wider than the screen, so each bee is on screen at most once: <= 2 visible. */
export const BEE_COUNT = 2;
/** Horizontal tile (layer px) the bees repeat over. */
export const BEE_TILE = 1800;
/** Parallax factor: slow, so a bee drifts past rather than whipping by at top speed. */
export const BEE_PARALLAX = 0.04;
/** A bee's full height (wing tip to feet) as a fraction of the screen height: "a quarter to a half". */
export const BEE_HEIGHT = Object.freeze([0.3, 0.4]);
/** The most any bee fill may add over the backdrop (the bg-coloured stripes excepted, they only darken). */
export const BEE_MAX_FILL_ALPHA = 0.1;
/** The most any bee line may add. */
export const BEE_MAX_LINE_ALPHA = 0.3;

/** A bee's geometry is in units of `u`, where the full height is 0.6 u (see beePrimitives). */
const HEIGHT_U = 0.6;
/** Half the widest extent of a bee in u (the stinger behind, the antennae in front), with a margin for the tilt. */
const HALF_W_U = 0.48;
/** The W6 decor overhang rule; the fade keeps the drawn bee inside it. */
const OVERHANG = 96;

/** mulberry32: visual-only, deterministic randomness (the same generator the backdrop decor uses). */
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The fixed per-seed bee layout. Pure: rebuilt on every call (a handful of PRNG draws), so the output can
 * never depend on what was drawn before.
 * @param {number} [seed=0] the backdrop's decor seed (Background.decorSeed)
 * @returns {Array<{id:number,x0:number,dir:1|-1,speed:number,y0:number,h:number,ph:number}>}
 */
export function beeLayout(seed = 0) {
  const s = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  const rnd = mulberry32((0xb33b ^ Math.imul(s, 0x9e3779b1)) >>> 0);
  const span = (lo, hi) => lo + rnd() * (hi - lo);
  const out = [];
  for (let i = 0; i < BEE_COUNT; i++) {
    const h = span(BEE_HEIGHT[0], BEE_HEIGHT[1]) * GAME_HEIGHT;
    out.push({
      id: i,
      // spread across the tile so the two are rarely on screen together
      x0: (i + span(0.1, 0.6)) * (BEE_TILE / BEE_COUNT),
      dir: rnd() < 0.5 ? -1 : 1,
      speed: span(7, 14), // px/s of its own, on top of the parallax drift
      // the body centre; leaves room for the wings above and the feet below at the largest size
      y0: span(0.42, 0.5) * GAME_HEIGHT,
      h,
      ph: rnd() * Math.PI * 2,
    });
  }
  return out;
}

/**
 * The bees on screen at one camera scroll and scene time. Pure.
 * @param {number} scrollX camera scroll X (world px)
 * @param {number} [timeMs=0] scene time
 * @param {number} [seed=0] layout seed
 * @returns {Array<{id:number,x:number,y:number,h:number,dir:1|-1,rot:number,flap:number,alpha:number}>}
 *   x/y the body centre on screen, h the full height in px, rot the body tilt (rad), flap the wing phase
 *   (rad), alpha 0..1 (fades in and out at the screen edges so a bee never pops)
 */
export function beesAt(scrollX, timeMs = 0, seed = 0) {
  const sx = Number.isFinite(scrollX) ? scrollX : 0;
  const t = Number.isFinite(timeMs) ? timeMs : 0;
  const out = [];
  for (const b of beeLayout(seed)) {
    const halfW = (b.h / HEIGHT_U) * HALF_W_U;
    // the widest the centre may go and still keep every point inside the overhang rule
    const edge = OVERHANG - halfW;
    let x = (b.x0 + b.dir * b.speed * (t / 1000) - sx * BEE_PARALLAX) % BEE_TILE;
    if (x < 0) x += BEE_TILE;
    x -= edge; // the tile starts at the left limit: x runs over [-edge, BEE_TILE - edge)
    if (x > GAME_WIDTH + edge) continue;
    // fade over the band where part of the bee is outside the screen
    const inL = (x + edge) / (halfW + edge);
    const inR = (GAME_WIDTH + edge - x) / (halfW + edge);
    const alpha = Math.max(0, Math.min(1, inL, inR));
    if (alpha <= 0.01) continue;
    out.push({
      id: b.id,
      x,
      y: b.y0 + Math.sin(t / 900 + b.ph) * 5,
      h: b.h,
      dir: b.dir,
      rot: Math.sin(t / 1300 + b.ph) * 0.07,
      flap: (t / 9 + b.ph) % (Math.PI * 2),
      alpha,
    });
  }
  return out;
}

/** Rotate local (lx, ly) by `rot` about the bee centre and mirror by `dir`. */
function place(bee, lx, ly) {
  const c = Math.cos(bee.rot);
  const s = Math.sin(bee.rot);
  const x = lx * bee.dir;
  return { x: bee.x + x * c - ly * s, y: bee.y + x * s + ly * c };
}

/** Closed ellipse in bee-local space, as screen points. */
function ellipse(bee, cx, cy, rx, ry, rot, n) {
  const pts = [];
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ex = Math.cos(a) * rx;
    const ey = Math.sin(a) * ry;
    pts.push(place(bee, cx + ex * cr - ey * sr, cy + ex * sr + ey * cr));
  }
  return pts;
}

/**
 * The drawable primitives for some bees, in the motifDecor format (`poly`, `line`, `circle`; a palette colour
 * KEY each, never `danger`), all at one decor `depth`, each tagged `bee: id`. Pure.
 *
 * Neon vector bee, side view, facing `dir`: two translucent wing blurs at the extremes of the stroke and a
 * rim on the current wing; a striped abdomen (amber outline, bg bands) with a stinger; a fuzzy thorax; a head
 * with an eye and antennae; two dangling legs. About 34 draw calls a bee.
 * @param {Array<Object>} bees from beesAt
 * @param {number} depth the decor depth to draw at (Background: after the last silhouette layer)
 * @returns {Array<Object>}
 */
export function beePrimitives(bees, depth) {
  const out = [];
  for (const bee of bees || []) {
    const u = bee.h / HEIGHT_U;
    const a = bee.alpha;
    const tag = { depth, bee: bee.id };
    const F = (v) => Math.min(BEE_MAX_FILL_ALPHA, v) * a;
    const Ln = (v) => Math.min(BEE_MAX_LINE_ALPHA, v) * a;
    // wings: attached on top of the thorax, swept back; two blurs at the ends of the stroke, a rim on the
    // current position (flap), so the wing reads as a fast blur rather than a solid shape
    const wx = -0.02 * u;
    const wy = -0.1 * u;
    const wing = (ang) => ellipse(bee, wx - Math.sin(ang) * 0.17 * u, wy - Math.cos(ang) * 0.17 * u, 0.075 * u, 0.17 * u, -ang, 12);
    out.push({ kind: 'poly', ...tag, color: 'text', fillAlpha: F(0.07), lineAlpha: 0, pts: wing(0.15) });
    out.push({ kind: 'poly', ...tag, color: 'cyan', fillAlpha: F(0.06), lineAlpha: 0, pts: wing(0.75) });
    out.push({ kind: 'poly', ...tag, color: 'cyan', fillAlpha: 0, lineAlpha: Ln(0.22), pts: wing(0.45 + Math.sin(bee.flap) * 0.3) });
    // abdomen: amber body and outline, three bg-coloured bands, a stinger at the tail
    const ax = -0.17 * u;
    const ay = 0.035 * u;
    const arx = 0.24 * u;
    const ary = 0.14 * u;
    const tilt = 0.12;
    out.push({ kind: 'poly', ...tag, color: 'amber', fillAlpha: F(0.1), lineAlpha: Ln(0.3), pts: ellipse(bee, ax, ay, arx, ary, tilt, 16) });
    for (const k of [-0.45, 0, 0.42]) {
      const w = 0.06;
      const band = [];
      for (const [fx, sy] of [[k - w, -1], [k + w, -1], [k + w, 1], [k - w, 1]]) {
        const hy = ary * Math.sqrt(Math.max(0, 1 - fx * fx)) * 0.92;
        const lx = fx * arx;
        const ly = sy * hy;
        band.push(place(bee, ax + lx * Math.cos(tilt) - ly * Math.sin(tilt), ay + lx * Math.sin(tilt) + ly * Math.cos(tilt)));
      }
      out.push({ kind: 'poly', ...tag, color: 'bg', fillAlpha: 0.45 * a, lineAlpha: 0, pts: band });
    }
    const tail = place(bee, ax - arx * Math.cos(tilt), ay - arx * Math.sin(tilt));
    const sting = place(bee, ax - (arx + 0.05 * u) * Math.cos(tilt), ay - (arx + 0.05 * u) * Math.sin(tilt) + 0.01 * u);
    out.push({ kind: 'line', ...tag, color: 'amber', alpha: Ln(0.3), width: 1, pts: [tail, sting] });
    // thorax: a fuzzy ball (text rim over a faint amber fill)
    out.push({ kind: 'poly', ...tag, color: 'amber', fillAlpha: F(0.08), lineAlpha: 0, pts: ellipse(bee, 0.04 * u, -0.01 * u, 0.1 * u, 0.095 * u, 0, 12) });
    out.push({ kind: 'poly', ...tag, color: 'text', fillAlpha: 0, lineAlpha: Ln(0.2), pts: ellipse(bee, 0.04 * u, -0.01 * u, 0.1 * u, 0.095 * u, 0, 12) });
    // head, eye, antennae
    const hx = 0.19 * u;
    const hy = 0.02 * u;
    out.push({ kind: 'poly', ...tag, color: 'amber', fillAlpha: 0, lineAlpha: Ln(0.28), pts: ellipse(bee, hx, hy, 0.065 * u, 0.075 * u, 0, 10) });
    const eye = place(bee, hx + 0.025 * u, hy - 0.015 * u);
    out.push({ kind: 'circle', ...tag, color: 'text', fillAlpha: F(0.1), lineAlpha: 0, x: eye.x, y: eye.y, r: Math.max(1, 0.025 * u) });
    const ab = place(bee, hx + 0.01 * u, hy - 0.07 * u);
    out.push({
      kind: 'line', ...tag, color: 'text', alpha: Ln(0.25), width: 1,
      pts: [place(bee, hx + 0.16 * u, hy - 0.17 * u), place(bee, hx + 0.1 * u, hy - 0.12 * u), ab, place(bee, hx + 0.21 * u, hy - 0.11 * u)],
    });
    // two legs dangling from the thorax, swaying a little with the flight
    const sway = Math.sin(bee.flap * 0.1) * 0.02 * u;
    for (const lx of [-0.01, 0.08]) {
      out.push({
        kind: 'line', ...tag, color: 'text', alpha: Ln(0.2), width: 1,
        pts: [place(bee, lx * u, 0.07 * u), place(bee, (lx - 0.03) * u + sway, 0.15 * u), place(bee, (lx - 0.01) * u + sway, 0.22 * u)],
      });
    }
  }
  return out;
}
