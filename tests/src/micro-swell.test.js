/**
 * Audit T2: Micro Mountain's dew swell must be IN the ground the sled rides.
 *
 * Before this fix the swell was added only by TerrainGenerator.heightAt. The chunk points, which drive the Matter
 * collider and the drawn edge (TerrainMesh) and slopeDegAt, were raw. In the built game the sled tracked the raw
 * collider (sd 1.9 px) and not the swelled heightAt (sd 9.5 px), so the swell was unfelt and every heightAt reader
 * (void check, air forecast, safe respawn) disagreed with the real ground by up to the amplitude.
 *
 * Now the swell displaces the points inside each dewSwell zone, with a raised-cosine taper at both zone edges
 * (`terrainSwell.taperPx`), and heightAt is the plain polyline again. These tests pin ONE surface:
 * points == heightAt == slopeDegAt, the displacement is really there, it starts and ends smoothly, and every
 * spawn sits on the swelled ground.
 */
import fs from 'fs';
import { makeGen, loadContent } from './_helpers.js';

const MICRO = 512;
const SEEDS = ['alpha', 'beta', 'swell'];
const CHUNKS = 120;
const CONTENT = loadContent();
const DEW = JSON.parse(fs.readFileSync('src/data/terrainMods/dew-swell.json', 'utf8'));
const SW = DEW.terrainSwell;

/** Linear interpolation of the chunk polyline: exactly the surface TerrainMesh builds colliders from. */
function polylineY(chunk, x) {
  const p = chunk.points;
  let i = 0;
  while (i < p.length - 2 && p[i + 1].x < x) i++;
  const a = p[i];
  const b = p[i + 1];
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/** Slope (deg) of polyline segment i. */
const segDeg = (p, i) => (Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x) * 180) / Math.PI;

/** Every dew-swell zone in the first `n` chunks of a Micro-only run. */
function swellZones(seed, overrides = {}, n = CHUNKS) {
  const gen = makeGen(seed, { biomeMask: MICRO, ...overrides });
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = gen.getChunk(i);
    for (const z of c.zones) if (z.modId === 'dewSwell') out.push({ c, z, i });
  }
  return { gen, out };
}

/** The same run with the swell switched off in content: same zones, raw geometry. */
function modsWithSwell(terrainSwell) {
  const mods = { ...CONTENT.terrainMods, dewSwell: { ...CONTENT.terrainMods.dewSwell } };
  if (terrainSwell) mods.dewSwell.terrainSwell = terrainSwell;
  else delete mods.dewSwell.terrainSwell;
  return mods;
}

/**
 * Chunk `index` of `gen`'s run, rebuilt with the swell switched off in content (raw geometry, same zones). A whole
 * no-swell RUN drifts after the first swelled chunk (the swell moves lips, so later bounds get another sinceLaunch /
 * noHazX); copying the swelled run's bounds builds the twin from the identical bound.
 */
function rawTwin(gen, index, terrainSwell = null) {
  const twin = makeGen(gen.seed, { biomeMask: MICRO, modDefs: modsWithSwell(terrainSwell) });
  twin.bounds = gen.bounds.slice(0, index + 1).map((b) => ({ ...b }));
  return twin.getChunk(index);
}

describe('T2 (audit, copied from audit/terrain tests/src/audit-terrain.test.js): dewSwell reaches the surface the sled rides', () => {
  test('T2: heightAt agrees with the collider polyline (chunk.points) inside a dew-swell zone', () => {
    const { gen, out } = swellZones('alpha');
    expect(out.length).toBeGreaterThan(0);
    let maxDelta = 0;
    for (const { c, z } of out) {
      for (let x = z.x0; x <= z.x1; x += 4) maxDelta = Math.max(maxDelta, Math.abs(gen.heightAt(x) - polylineY(c, x)));
    }
    expect(maxDelta).toBeLessThan(0.5);
  });

  test('T2: heightAt is continuous at a dew-swell zone edge (no vertical step)', () => {
    const { gen, out } = swellZones('alpha');
    let maxStep = 0;
    for (const { z } of out) maxStep = Math.max(maxStep, Math.abs(gen.heightAt(z.x1) - gen.heightAt(z.x1 + 0.001)));
    expect(maxStep).toBeLessThan(1);
  });
});

describe('Micro swell: one surface for collider, edge, heightAt and slopeDegAt', () => {
  test('heightAt equals the polyline inside every swell zone (3 seeds, within 0.5 px)', () => {
    for (const seed of SEEDS) {
      const { gen, out } = swellZones(seed);
      expect(out.length).toBeGreaterThan(5);
      let maxDelta = 0;
      for (const { c, z } of out) {
        for (let x = z.x0 - 40; x <= z.x1 + 40; x += 3) maxDelta = Math.max(maxDelta, Math.abs(gen.heightAt(x) - polylineY(c, x)));
      }
      expect(maxDelta).toBeLessThan(0.5);
    }
  });

  test('slopeDegAt is the slope of the polyline segment under x, and the heightAt chord off the vertices agrees', () => {
    for (const seed of SEEDS) {
      const { gen, out } = swellZones(seed);
      let segErr = 0;
      let chordErr = 0;
      for (const { c, z } of out) {
        const p = c.points;
        for (let x = z.x0 + 3; x <= z.x1 - 3; x += 2.5) {
          const i = Math.min(p.length - 2, Math.floor((x - c.startX) / 16));
          segErr = Math.max(segErr, Math.abs(gen.slopeDegAt(x) - segDeg(p, i)));
          // A +-1 px chord that straddles a vertex measures the mean of two segments; that is not a disagreement.
          const off = (x - c.startX) % 16;
          if (off > 1.01 && off < 14.99) {
            const fromHeight = (Math.atan2(gen.heightAt(x + 1) - gen.heightAt(x - 1), 2) * 180) / Math.PI;
            chordErr = Math.max(chordErr, Math.abs(fromHeight - gen.slopeDegAt(x)));
          }
        }
      }
      expect(segErr).toBeLessThan(1e-9);
      expect(chordErr).toBeLessThan(1);
    }
  });

  test('heightAt is continuous at both zone edges, and the swell fades in and out with no kink', () => {
    for (const seed of SEEDS) {
      const { gen, out } = swellZones(seed);
      let maxStep = 0;
      let edgeDisp = 0;
      let edgeTurn = 0;
      let innerTurn = 0;
      for (let k = 0; k < out.length; k++) {
        const { c, z, i } = out[k];
        for (const e of [z.x0, z.x1]) maxStep = Math.max(maxStep, Math.abs(gen.heightAt(e) - gen.heightAt(e + 0.001)), Math.abs(gen.heightAt(e) - gen.heightAt(e - 0.001)));
        // Turn the swell ADDS at each vertex (swelled turn minus raw turn). Within one segment of an edge the window has
        // barely opened, so the displacement is ~1 px and the added turn is well under the swell's own crest turn.
        // Without a taper the edge is a 26 px step: an added turn near 90 deg (measured 87).
        const p = c.points;
        const raw = rawTwin(gen, i).points;
        for (let j = 1; j < p.length - 1; j++) {
          const added = Math.abs(segDeg(p, j) - segDeg(p, j - 1) - (segDeg(raw, j) - segDeg(raw, j - 1)));
          const fromEdge = Math.min(Math.abs(p[j].x - z.x0), Math.abs(p[j].x - z.x1));
          if (fromEdge <= 16) {
            edgeTurn = Math.max(edgeTurn, added);
            edgeDisp = Math.max(edgeDisp, Math.abs(p[j].y - raw[j].y));
          } else if (p[j].x > z.x0 && p[j].x < z.x1) innerTurn = Math.max(innerTurn, added);
        }
      }
      expect(maxStep).toBeLessThan(0.01);
      expect(edgeDisp).toBeLessThan(1.5);
      expect(edgeTurn).toBeLessThan(0.5 * innerTurn);
    }
  });
});

describe('Micro swell: the displacement is really in the points', () => {
  test('the raw twin of a swelled chunk has the same zones and the same x grid (displacement is the only difference)', () => {
    const { gen, out } = swellZones('beta');
    for (const { c, i } of out) {
      const raw = rawTwin(gen, i);
      expect(raw.zones).toEqual(c.zones);
      expect(raw.points.map((p) => p.x)).toEqual(c.points.map((p) => p.x));
      expect(raw.points[0].y).toBe(c.points[0].y);
      expect(raw.points[raw.points.length - 1].y).toBe(c.points[c.points.length - 1].y);
    }
  });

  test('peak-to-peak of the displacement is about 2 x amplitude in the zone middle, and zero outside zones', () => {
    for (const seed of SEEDS) {
      const { gen, out } = swellZones(seed);
      const raws = out.map(({ i }) => rawTwin(gen, i));
      let checked = 0;
      let outside = 0;
      for (let k = 0; k < out.length; k++) {
        const { c, z } = out[k];
        const raw = raws[k].points;
        const taper = Math.min(SW.taperPx, (z.x1 - z.x0) / 2);
        let lo = Infinity;
        let hi = -Infinity;
        c.points.forEach((pt, j) => {
          const d = pt.y - raw[j].y;
          if (pt.x < z.x0 || pt.x > z.x1) outside = Math.max(outside, Math.abs(d));
          else if (pt.x >= z.x0 + taper && pt.x <= z.x1 - taper) { lo = Math.min(lo, d); hi = Math.max(hi, d); }
          expect(Math.abs(d)).toBeLessThanOrEqual(SW.amplitudePx + 1e-9);
        });
        if (z.x1 - z.x0 - 2 * taper >= SW.periodPx) {
          checked++;
          expect(hi - lo).toBeGreaterThan(0.9 * 2 * SW.amplitudePx);
        }
      }
      expect(checked).toBeGreaterThan(0);
      expect(outside).toBe(0);
      // the read side sees it too: heightAt swings by ~2A around the raw line in the zone middle
      const { c, z } = out.find(({ z: q }) => q.x1 - q.x0 - 2 * Math.min(SW.taperPx, (q.x1 - q.x0) / 2) >= SW.periodPx);
      const k = out.findIndex((o) => o.z === z);
      let lo = Infinity;
      let hi = -Infinity;
      for (let x = z.x0 + SW.taperPx; x <= z.x1 - SW.taperPx; x += 2) {
        const d = gen.heightAt(x) - polylineY(raws[k], x);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      expect(hi - lo).toBeGreaterThan(0.9 * 2 * SW.amplitudePx);
      expect(c.biome).toBe('micro-mountain');
    }
  });

  test('dew-swell.json declares a taper the code reads: no taper puts the step back at the zone end', () => {
    expect(SW.taperPx).toBeGreaterThan(0);
    expect(SW.taperPx).toBeLessThanOrEqual(DEW.lengthPx[0] / 2);
    const noTaper = swellZones('alpha', { modDefs: modsWithSwell({ ...SW, taperPx: 0 }) });
    let edge = 0;
    noTaper.out.forEach(({ c, z, i }) => {
      const raw = rawTwin(noTaper.gen, i).points;
      c.points.forEach((pt, j) => {
        if (pt.x >= z.x1 - 16 && pt.x <= z.x1) edge = Math.max(edge, Math.abs(pt.y - raw[j].y));
      });
    });
    expect(edge).toBeGreaterThan(5);
  });

  test('same seed + mask gives identical terrain twice', () => {
    const a = makeGen('swell', { biomeMask: MICRO });
    const b = makeGen('swell', { biomeMask: MICRO });
    for (let i = 0; i < 150; i++) expect(JSON.stringify(b.getChunk(i))).toBe(JSON.stringify(a.getChunk(i)));
    // and streaming (pooled chunk objects, any call order) builds the same points
    const s = makeGen('swell', { biomeMask: MICRO });
    for (let x = 0; x < 120000; x += 400) s.update(x);
    for (const c of s.getActiveChunks()) expect(JSON.stringify(c)).toBe(JSON.stringify(a.getChunk(c.index)));
  });
});

describe('Micro swell: spawns sit on the swelled ground', () => {
  const AIR = new Set(Object.values(CONTENT.hazards).filter((h) => h.placement === 'air').map((h) => h.id));

  test('ground hazards, pads, power-ups and shards in Micro chunks use the swelled polyline', () => {
    for (const seed of SEEDS) {
      const { gen } = swellZones(seed);
      for (let i = 0; i < CHUNKS; i++) {
        const c = gen.getChunk(i);
        if (c.biome !== 'micro-mountain') continue;
        for (const h of c.hazards) {
          if (AIR.has(h.defId)) continue;
          expect(Math.abs(h.y - polylineY(c, h.x))).toBeLessThan(0.5);
          const j = Math.min(c.points.length - 2, Math.floor((h.x - c.startX) / 16));
          expect(Math.abs(h.rotationDeg - segDeg(c.points, j))).toBeLessThan(1e-6);
          // clearance rule: a readable slope, on the ground the sled meets
          expect(h.rotationDeg).toBeGreaterThan(-12);
          expect(h.rotationDeg).toBeLessThan(28);
        }
        for (const p of c.bouncePads) expect(Math.abs(p.y - polylineY(c, p.x))).toBeLessThan(0.5);
        for (const p of c.powerups) expect(p.y).toBeLessThan(polylineY(c, p.x) - 20);
        for (const s of c.shards) expect(s.y).toBeLessThanOrEqual(polylineY(c, s.x) - 12 + 0.5);
      }
    }
  });
});
