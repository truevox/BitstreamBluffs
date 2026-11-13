/**
 * W3 — the biome `background` motif reaches the renderer.
 *
 * CC Friday's finding: `background` (`ridges`/`drift`/`terraces`/`currents`/`facets`) is declared in
 * every biome file and read by nothing, so a biome looked identical to base terrain apart from colour.
 * That is half the "skin" half of W3's deliverable.
 *
 * The failures worth guarding, in order of how easy they are to ship:
 *   1. An unknown/missing motif must fall back to the base backdrop, never draw nothing. A blank sky is
 *      worse than a plain one, and the base path already works.
 *   2. The motif must be RESTORED on exit. A tint or silhouette that outlives its sector means the
 *      player is looking at terrain they are not on — CC Friday asked for revert explicitly.
 *   3. Each motif must actually change the geometry it draws. Five motifs that all render the base
 *      ridge are five no-ops with five names, which is precisely the bug this file exists for.
 *
 * Geometry is asserted through `motifGeometry`, a pure function, rather than by pixel-diffing, because
 * the point is that the *shape* differs per motif — a screenshot would only prove something was drawn.
 */
import { motifGeometry, MOTIFS } from '../../src/entities/Background.js';

describe('background motifs exist and are distinct', () => {
  test('every motif the biome files name is a real motif', () => {
    for (const id of ['ridges', 'drift', 'terraces', 'currents', 'facets']) {
      expect({ id, known: MOTIFS.includes(id) }).toMatchObject({ id, known: true });
    }
  });

  test('each motif produces a different silhouette from the others', () => {
    // Compare the sampled layer profile of every pair. Any two identical motifs would mean one of the
    // five biomes still looks like another.
    const sig = (m) => JSON.stringify(motifGeometry(m, 1234));
    const seen = new Map();
    for (const m of MOTIFS) seen.set(sig(m), [...(seen.get(sig(m)) || []), m]);
    const dupes = [...seen.values()].filter((g) => g.length > 1);
    expect(dupes).toEqual([]);
  });

  test('an unknown motif falls back to the base backdrop instead of drawing nothing', () => {
    // A typo in a JSON file, or a W6 biome naming a motif that has not shipped.
    for (const bad of ['nope', '', null, undefined, 42, 'RIDGES']) {
      const g = motifGeometry(bad, 500);
      expect({ bad, layers: Array.isArray(g.layers) && g.layers.length }).toMatchObject({ bad, layers: 2 });
    }
  });

  test('base terrain (no biome) draws exactly the pre-W3 backdrop', () => {
    // The golden rule of this campaign: mask 0 must be untouched. The base motif is the original two
    // ridges, so anything else here would be a visual regression on every existing run.
    expect(motifGeometry(null, 500)).toEqual(motifGeometry('ridges', 500));
    expect(motifGeometry('ridges', 500).layers.length).toBe(2);
  });

  test('the geometry is a pure function of (motif, scrollX)', () => {
    // Pure so a repaint at any scroll position is stable and repeatable — the same reason the original
    // backdrop made every layer position a function of scrollX.
    expect(motifGeometry('drift', 900)).toEqual(motifGeometry('drift', 900));
    expect(motifGeometry('drift', 900)).not.toEqual(motifGeometry('drift', 901));
  });

  test('motif geometry is finite at extreme scroll positions', () => {
    // Far into a long run the scroll offset is large; a NaN here would draw nothing at all.
    for (const m of MOTIFS) {
      for (const x of [0, 1, 99999, 12_345_678]) {
        const g = motifGeometry(m, x);
        const ok = g.layers.every((l) => Number.isFinite(l.baseY) && Number.isFinite(l.amp) && Number.isFinite(l.factor));
        expect({ m, x, ok }).toMatchObject({ m, x, ok: true });
      }
    }
  });
});
