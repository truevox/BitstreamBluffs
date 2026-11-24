/**
 * Audit T1 — the six W6 backdrops are drawn, distinct, bounded, deterministic and hazard-safe.
 *
 * The W6 biome files named six backgrounds (stars, candy-stripes, jellyfish, brass-pipes, dew-drops,
 * vents) that did not exist, so six biomes drew base ridges. biome-background.test.js now proves every
 * named id is a real motif; this file proves each one actually LOOKS like something:
 *   - its silhouette profile differs from the base ridge profile;
 *   - its decor pass (motifDecor) emits primitives, repeatably for one seed, differently for another;
 *   - everything stays on screen (480x270 plus a small margin);
 *   - nothing is drawn in the `danger` colour (hazards must stay the only thing that reads as a hazard),
 *     checked both on the pure geometry and on the real renderer's draw calls;
 *   - the draw cost per frame stays within a small multiple of the base backdrop.
 */
import { motifGeometry, motifDecor, motifProfile, MOTIFS, Background } from '../../src/entities/Background.js';
import { GAME_WIDTH, GAME_HEIGHT, PALETTE_KEYS } from '../../src/constants.js';
import { readDir } from './_helpers.js';

const BATCH1 = ['ridges', 'drift', 'terraces', 'currents', 'facets'];
const W6 = [...new Set(readDir('biomes').map((b) => b.background))].filter((id) => !BATCH1.includes(id)).sort();
const SCROLLS = [0, 137, 480, 1001, 2500, 7777, 40_000, 123_456, 12_345_678];
const TIMES = [0, 250, 1600, 9999];
const XM = 96; // decor anchored just off screen may overhang this far (gear teeth, cane hooks, ring)

/** Every point a primitive touches, for the bounds check. */
function pointsOf(d) {
  if (d.kind === 'circle') return [{ x: d.x, y: d.y }];
  if (d.kind === 'rect') return [{ x: d.x, y: d.y }, { x: d.x + d.w, y: d.y + d.h }];
  return d.pts;
}

/** A Graphics stand-in that records every call and the colour it was made with. */
function recordingScene() {
  const calls = [];
  const gfx = new Proxy({}, {
    get(_, name) {
      if (name === 'setScrollFactor' || name === 'setDepth') return () => gfx;
      return (...args) => { calls.push([name, ...args]); return gfx; };
    },
  });
  return { scene: { add: { graphics: () => gfx } }, calls };
}

// A palette where every key is a distinct value, `danger` a sentinel no other key shares.
const DANGER = 0xdead01;
const PAL = { bg: 0x010101, bgAlt: 0x020202, cyan: 0x030303, magenta: 0x040404, lime: 0x050505, amber: 0x060606, text: 0x070707, danger: DANGER };

function drawLog(motif, scrollX, timeMs) {
  const { scene, calls } = recordingScene();
  const bg = new Background(scene, PAL);
  bg.setMotif(motif);
  bg.update(scrollX, timeMs, 0);
  return calls;
}

describe('audit T1: the W6 backdrops', () => {
  test('the biome files name exactly six backdrops beyond the batch-1 five', () => {
    expect(W6).toEqual(['brass-pipes', 'candy-stripes', 'dew-drops', 'jellyfish', 'stars', 'vents']);
    for (const id of W6) expect(MOTIFS).toContain(id);
  });

  test.each(W6)('%s: its silhouette shape is its own, not the base ridge profile', (id) => {
    const g = motifGeometry(id, 0);
    expect(g.motif).toBe(id);
    expect(g.layers.length).toBeGreaterThanOrEqual(2);
    // Sample the profile across a screen and a half: a shape that fell through to 'peak' would match it.
    const L = g.layers[0];
    let diff = 0;
    for (let x = 0; x < 720; x += 8) diff += Math.abs(motifProfile(g.shape, x, L.seed) - motifProfile('peak', x, L.seed));
    expect(diff).toBeGreaterThan(5);
    for (let x = -500; x < 5000; x += 13) {
      const h = motifProfile(g.shape, x, L.seed);
      expect(Number.isFinite(h) && h >= 0 && h <= 1).toBe(true);
    }
  });

  test('the six silhouettes are six different shapes', () => {
    const shapes = W6.map((id) => motifGeometry(id, 0).shape);
    expect(new Set(shapes).size).toBe(6);
    expect(shapes).not.toContain('peak');
  });

  test.each(W6)('%s: the decor pass draws something on every screen', (id) => {
    for (const x of SCROLLS) {
      const d = motifDecor(id, x, 1000);
      expect({ id, x, n: d.length >= 4 }).toEqual({ id, x, n: true });
    }
  });

  test.each(W6)('%s: decor is deterministic per seed and differs between seeds', (id) => {
    for (const x of [0, 2500, 123_456]) {
      expect(motifDecor(id, x, 700, 0)).toEqual(motifDecor(id, x, 700, 0));
      expect(motifDecor(id, x, 700, 9)).toEqual(motifDecor(id, x, 700, 9));
    }
    // A different seed lays the items out differently on at least one screen.
    const differs = SCROLLS.some((x) => JSON.stringify(motifDecor(id, x, 700, 0)) !== JSON.stringify(motifDecor(id, x, 700, 9)));
    expect(differs).toBe(true);
  });

  test.each(W6)('%s: it animates from scene time, and only from scene time', (id) => {
    // Same time => same frame (no Math.random / Date.now); different time => something moved.
    const moved = SCROLLS.some((x) => JSON.stringify(motifDecor(id, x, 0)) !== JSON.stringify(motifDecor(id, x, 1234)));
    expect(moved).toBe(true);
    const a = motifDecor(id, 5000, 4321);
    const b = motifDecor(id, 5000, 4321);
    expect(a).toEqual(b);
  });

  test.each(W6)('%s: every decor primitive stays on screen', (id) => {
    for (const x of SCROLLS) {
      for (const t of TIMES) {
        for (const d of motifDecor(id, x, t)) {
          for (const p of pointsOf(d)) {
            const ok = Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -XM && p.x <= GAME_WIDTH + XM && p.y >= 0 && p.y <= GAME_HEIGHT;
            if (!ok) throw new Error(`${id} @scroll ${x} t ${t}: ${d.kind} point (${p.x}, ${p.y}) off screen`);
          }
          if (d.kind === 'circle') expect(d.r > 0 && d.r < 40).toBe(true);
        }
      }
    }
  });

  test.each(W6)('%s: the silhouette stays inside the frame', (id) => {
    for (const x of SCROLLS) {
      const g = motifGeometry(id, x);
      for (const L of g.layers) {
        for (let sx = 0; sx <= GAME_WIDTH; sx += 8) {
          const y = GAME_HEIGHT * L.baseY - Math.abs(motifProfile(g.shape, sx + x * L.factor, L.seed)) * L.amp;
          expect(y > 0 && y < GAME_HEIGHT).toBe(true);
        }
      }
    }
  });

  test.each(W6)('%s: only palette keys, never the danger colour', (id) => {
    const keys = new Set(motifGeometry(id, 0).layers.map((l) => l.color));
    for (const x of SCROLLS) for (const t of TIMES) for (const d of motifDecor(id, x, t)) keys.add(d.color);
    for (const k of keys) expect(PALETTE_KEYS).toContain(k);
    expect(keys.has('danger')).toBe(false);
  });

  test('batch-1 motifs and the base backdrop have no decor (their draws are unchanged)', () => {
    for (const id of [...BATCH1, null, undefined, 'nope']) expect(motifDecor(id, 500, 500)).toEqual([]);
  });
});

describe('audit T1: the renderer draws the W6 backdrops', () => {
  const baseCalls = drawLog(null, 2500, 1000);

  test('the base backdrop draws the same calls as ridges and uses no decor primitives', () => {
    expect(drawLog('ridges', 2500, 1000)).toEqual(baseCalls);
    expect(baseCalls.some((c) => c[0] === 'fillCircle')).toBe(false);
  });

  test.each(W6)('%s: the frame differs from the base frame and includes its decor', (id) => {
    for (const x of [0, 2500, 123_456]) {
      const calls = drawLog(id, x, 1000);
      expect(calls).not.toEqual(drawLog(null, x, 1000));
      // Each decor primitive costs at least one draw call beyond the two silhouette layers.
      const geomOnly = drawLog(null, x, 1000).length;
      expect(calls.length).toBeGreaterThan(geomOnly + motifDecor(id, x, 1000).length);
    }
  });

  test.each([...MOTIFS, null])('%s: no draw call uses the danger colour', (id) => {
    for (const x of [0, 777, 2500, 123_456]) {
      for (const t of TIMES) {
        for (const c of drawLog(id, x, t)) {
          if (c[0] === 'fillStyle') expect(c[1]).not.toBe(DANGER);
          if (c[0] === 'lineStyle') expect(c[2]).not.toBe(DANGER);
        }
      }
    }
  });

  test.each(W6)('%s: draw cost stays within 2.5x the base backdrop on every screen', (id) => {
    // The backdrop is redrawn every frame (no cache), so the guard is calls per frame. Sweep a long
    // stretch of run, not a handful of positions: item density varies along the tile.
    const xs = [...SCROLLS];
    for (let x = 0; x < 60_000; x += 997) xs.push(x);
    let worst = 0;
    let most = 0;
    for (const x of xs) {
      for (const t of [0, 1600]) {
        worst = Math.max(worst, drawLog(id, x, t).length / drawLog(null, x, t).length);
        most = Math.max(most, motifDecor(id, x, t).length);
      }
    }
    expect(worst).toBeLessThanOrEqual(2.5);
    expect(most).toBeLessThanOrEqual(80);
  });
});
