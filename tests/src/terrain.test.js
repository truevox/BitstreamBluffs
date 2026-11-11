import {
  TerrainGenerator, SPACING_PX, HAZARD_MIN_SPACING_PX, HAZARD_MIN_X_PX, CREST_TURN_DEG, NOISE_CREST_TURN_DEG, SHARP_TAGS, SECTOR_M,
  HAZARD_SOFT_PX, HAZARD_SAFE_PX, expectedSpeedPxS,
} from '../../src/systems/TerrainGenerator.js';
import { TERRAIN, PIXELS_PER_METER } from '../../src/constants.js';
import { makeGen, loadContent, segAngle, inGap, rollSim, findLaunches } from './_helpers.js';

const snap = (c) => JSON.parse(JSON.stringify(c));
const N = 300; // chunks examined in the bulk tests (several kilometres of track)

describe('TerrainGenerator determinism', () => {
  test('same seed => identical chunks', () => {
    const a = makeGen('alpha');
    const b = makeGen('alpha');
    for (let i = 0; i < 80; i++) expect(snap(a.getChunk(i))).toEqual(snap(b.getChunk(i)));
  });

  test('different seeds differ', () => {
    const a = makeGen('alpha');
    const b = makeGen('beta');
    let diff = 0;
    for (let i = 0; i < 20; i++) if (JSON.stringify(a.getChunk(i).points) !== JSON.stringify(b.getChunk(i).points)) diff++;
    expect(diff).toBeGreaterThanOrEqual(18);
  });

  test('getChunk is independent of call order', () => {
    const seq = makeGen('order');
    const rev = makeGen('order');
    const expected = [];
    for (let i = 0; i < 40; i++) expected.push(snap(seq.getChunk(i)));
    // jump far ahead first, then go backwards
    expect(snap(rev.getChunk(39))).toEqual(expected[39]);
    for (let i = 38; i >= 0; i--) expect(snap(rev.getChunk(i))).toEqual(expected[i]);
  });

  test('chunk content does not depend on content array order', () => {
    const c = loadContent();
    const a = makeGen('x', { chunkDefs: c.chunks });
    const b = makeGen('x', { chunkDefs: c.chunks.slice().reverse() });
    for (let i = 0; i < 30; i++) expect(snap(a.getChunk(i))).toEqual(snap(b.getChunk(i)));
  });

  test('hazard content changes do not change terrain shape', () => {
    const c = loadContent();
    const a = makeGen('shape');
    const b = makeGen('shape', { hazardDefs: {}, powerupDefs: {} });
    for (let i = 0; i < 40; i++) expect(a.getChunk(i).points).toEqual(b.getChunk(i).points);
  });

  test('throws for negative index', () => {
    expect(() => makeGen().getChunk(-1)).toThrow(RangeError);
  });

  test('works with no content at all (builtin fallback)', () => {
    const g = new TerrainGenerator({ seed: 's', chunkDefs: [], hazardDefs: {}, powerupDefs: {}, modDefs: {} });
    for (let i = 0; i < 20; i++) {
      const c = g.getChunk(i);
      expect(c.points.length).toBeGreaterThan(10);
      expect(c.hazards).toEqual([]);
    }
  });
});

describe('TerrainGenerator geometry guarantees', () => {
  const g = makeGen('geometry-seed');
  const chunks = [];
  for (let i = 0; i < N; i++) chunks.push(g.getChunk(i));

  test('chunk 0 starts at x=0 with a gentle run-in', () => {
    const c = chunks[0];
    expect(c.startX).toBe(0);
    expect(c.points[0]).toEqual({ x: 0, y: 0 });
    expect(g.getStartPosition()).toEqual({ x: 0, y: 0 });
    for (let i = 0; i < 20; i++) expect(Math.abs(segAngle(c.points, i))).toBeLessThan(25);
    expect(c.hazards).toEqual([]);
  });

  test('x strictly increasing, spacing within TERRAIN limits, startX/endX match points', () => {
    for (const c of chunks) {
      expect(c.startX).toBe(c.points[0].x);
      expect(c.endX).toBe(c.points[c.points.length - 1].x);
      for (let i = 0; i < c.points.length - 1; i++) {
        const dx = c.points[i + 1].x - c.points[i].x;
        if (dx < TERRAIN.minPointSpacingPx || dx > TERRAIN.maxPointSpacingPx) throw new Error(`bad spacing ${dx}`);
      }
    }
    expect(SPACING_PX).toBeGreaterThanOrEqual(TERRAIN.minPointSpacingPx);
  });

  test('chunk borders share the exact same point and slope is roughly continuous', () => {
    for (let i = 0; i < N - 1; i++) {
      const a = chunks[i];
      const b = chunks[i + 1];
      expect(b.index).toBe(a.index + 1);
      expect(b.points[0]).toEqual(a.points[a.points.length - 1]);
      const sa = segAngle(a.points, a.points.length - 2);
      const sb = segAngle(b.points, 0);
      if (Math.abs(sa - sb) > 12) throw new Error(`slope jump ${sa} -> ${sb} at chunk ${i}`);
    }
  });

  test('slope never exceeds TERRAIN.maxSlopeDeg (outside bridge gaps) and curvature is limited', () => {
    let maxDown = -Infinity;
    let maxUp = Infinity;
    for (const c of chunks) {
      let prev = null;
      for (let i = 0; i < c.points.length - 1; i++) {
        if (inGap(c, i)) { prev = null; continue; }
        const a = segAngle(c.points, i);
        maxDown = Math.max(maxDown, a);
        maxUp = Math.min(maxUp, a);
        if (prev !== null && Math.abs(a - prev) > 17.01) throw new Error(`kink ${prev}->${a}`);
        prev = a;
      }
    }
    expect(maxDown).toBeLessThan(TERRAIN.maxSlopeDeg);
    expect(maxUp).toBeGreaterThan(-TERRAIN.maxSlopeDeg);
    expect(maxDown).toBeLessThanOrEqual(42.0001);
  });

  test('gap interpolation lines are also below the max slope', () => {
    for (const c of chunks) {
      for (const gp of c.gaps) {
        const y0 = g.heightAt(gp.x0);
        const y1 = g.heightAt(gp.x1);
        const a = (Math.atan2(y1 - y0, gp.x1 - gp.x0) * 180) / Math.PI;
        expect(a).toBeLessThan(TERRAIN.maxSlopeDeg);
      }
    }
  });

  test('track is always downhill overall: every chunk descends, and every 4000 px window descends', () => {
    for (const c of chunks) expect(c.points[c.points.length - 1].y).toBeGreaterThan(c.points[0].y);
    for (let x = 0; x + 4000 < chunks[N - 1].startX; x += 500) {
      expect(g.heightAt(x + 4000) - g.heightAt(x)).toBeGreaterThan(150);
    }
  });

  test('all numbers are finite', () => {
    for (const c of chunks) for (const p of c.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  test('a mix of template kinds and defs is used (data driven)', () => {
    const defs = new Set(chunks.map((c) => c.defId));
    const kinds = new Set(chunks.map((c) => c.kind));
    expect(defs.size).toBeGreaterThanOrEqual(10);
    expect([...kinds].sort()).toEqual(['bridge', 'noise', 'spline']);
  });

  test('chunk defs respect minDistanceM', () => {
    const defs = Object.fromEntries(loadContent().chunks.map((d) => [d.id, d]));
    for (const c of chunks) if (c.defId !== 'gen-jump') expect(c.startX / PIXELS_PER_METER).toBeGreaterThanOrEqual(defs[c.defId].minDistanceM);
  });

  test('pack structure: noise zones appear, and are not adjacent to each other', () => {
    const noiseIdx = chunks.filter((c) => c.kind === 'noise').map((c) => c.index);
    expect(noiseIdx.length).toBeGreaterThan(5);
    for (let i = 1; i < noiseIdx.length; i++) expect(noiseIdx[i] - noiseIdx[i - 1]).toBeGreaterThan(1);
  });

  test('chunk length escalates over the run (spline chunks later in the track are longer on average)', () => {
    const len = (c) => c.endX - c.startX;
    const spl = chunks.filter((c) => c.kind === 'spline');
    const early = spl.filter((c) => c.index < 40);
    const late = spl.filter((c) => c.index > 200);
    const avg = (a) => a.reduce((s, c) => s + len(c) / 1, 0) / a.length;
    expect(avg(late)).toBeGreaterThan(avg(early));
  });
});

describe('TerrainGenerator invariants across many seeds', () => {
  test('continuity, slope limits, descent and spacing hold for 25 seeds x 400 chunks', () => {
    for (let s = 0; s < 25; s++) {
      const gen = makeGen('multi-' + s);
      let prev = null;
      for (let i = 0; i < 400; i++) {
        const c = gen.getChunk(i);
        if (prev) {
          expect(c.points[0]).toEqual(prev.points[prev.points.length - 1]);
          const d = Math.abs(segAngle(prev.points, prev.points.length - 2) - segAngle(c.points, 0));
          if (d > 12) throw new Error(`seed ${s} chunk ${i}: slope jump ${d}`);
        }
        if (!(c.points[c.points.length - 1].y > c.points[0].y)) throw new Error(`seed ${s} chunk ${i} does not descend`);
        for (let k = 0; k < c.points.length - 1; k++) {
          if (inGap(c, k)) continue;
          const a = segAngle(c.points, k);
          if (a >= TERRAIN.maxSlopeDeg || a <= -TERRAIN.maxSlopeDeg) throw new Error(`seed ${s} chunk ${i}: slope ${a}`);
          const dx = c.points[k + 1].x - c.points[k].x;
          if (dx < TERRAIN.minPointSpacingPx || dx > TERRAIN.maxPointSpacingPx) throw new Error('spacing');
        }
        prev = c;
      }
    }
  });
});

describe('TerrainGenerator spawns', () => {
  const g = makeGen('spawns-seed');
  const chunks = [];
  for (let i = 0; i < N; i++) chunks.push(g.getChunk(i));
  const content = loadContent();

  test('hazards: valid defs, sit on surface, never at the start, min distance and spacing respected', () => {
    const all = [];
    for (const c of chunks) {
      for (const h of c.hazards) {
        all.push(h);
        expect(content.hazards[h.defId]).toBeDefined();
        expect(h.x).toBeGreaterThanOrEqual(HAZARD_MIN_X_PX);
        expect(h.x).toBeGreaterThanOrEqual(c.startX);
        expect(h.x).toBeLessThanOrEqual(c.endX);
        expect(h.x / PIXELS_PER_METER).toBeGreaterThanOrEqual(content.hazards[h.defId].minDistanceM);
        expect(g.heightAt(h.x)).toBeCloseTo(h.y, 6);
        expect(Math.abs(h.rotationDeg)).toBeLessThan(30);
      }
    }
    expect(all.length).toBeGreaterThan(100);
    all.sort((a, b) => a.x - b.x);
    for (let i = 1; i < all.length; i++) expect(all[i].x - all[i - 1].x).toBeGreaterThanOrEqual(HAZARD_MIN_SPACING_PX - 1);
  });

  test('hazards are not placed on bridge chunks, in gaps, or on steep slopes', () => {
    for (const c of chunks) {
      if (c.kind === 'bridge') expect(c.hazards).toEqual([]);
      for (const h of c.hazards) {
        for (const gp of c.gaps) expect(h.x < gp.x0 || h.x > gp.x1).toBe(true);
        const slope = g.slopeDegAt(h.x);
        expect(slope).toBeLessThan(30);
        expect(slope).toBeGreaterThan(-17.5);
      }
    }
  });

  test('all hazard types eventually appear (weighted, data driven)', () => {
    const seen = new Set(chunks.flatMap((c) => c.hazards.map((h) => h.defId)));
    expect([...seen].sort()).toEqual(Object.keys(content.hazards).sort());
  });

  test('hazard density increases past 1000 m', () => {
    let early = 0;
    let late = 0;
    let earlyLen = 0;
    let lateLen = 0;
    for (let s = 0; s < 6; s++) {
      const gen = makeGen('density-' + s);
      for (let i = 0; i < 200; i++) {
        const c = gen.getChunk(i);
        const dM = c.startX / PIXELS_PER_METER;
        const len = c.endX - c.startX;
        if (dM > 150 && dM < 500) { early += c.hazards.length; earlyLen += len; }
        else if (dM > 4500) { late += c.hazards.length; lateLen += len; }
      }
    }
    expect(earlyLen).toBeGreaterThan(0);
    expect(lateLen).toBeGreaterThan(0);
    expect(late / lateLen).toBeGreaterThan((early / earlyLen) * 1.2);
  });

  test('power-ups: valid, lifted above ground, clear of hazards, probability falls with distance', () => {
    let nearCount = 0;
    let farCount = 0;
    let nearLen = 0;
    let farLen = 0;
    for (let s = 0; s < 8; s++) {
      const gen = makeGen('pu-' + s);
      for (let i = 0; i < 300; i++) {
        const c = gen.getChunk(i);
        const dM = c.startX / PIXELS_PER_METER;
        for (const p of c.powerups) {
          expect(content.powerups[p.defId]).toBeDefined();
          expect(p.y).toBeLessThan(gen.heightAt(p.x) - content.powerups[p.defId].radius);
          for (const h of c.hazards) expect(Math.abs(h.x - p.x)).toBeGreaterThanOrEqual(90);
        }
        const len = c.endX - c.startX;
        if (dM < 1000) { nearCount += c.powerups.length; nearLen += len; }
        else if (dM > 5000) { farCount += c.powerups.length; farLen += len; }
      }
    }
    expect(nearCount).toBeGreaterThan(5);
    expect(nearCount / nearLen).toBeGreaterThan((farCount / farLen) * 2);
  });

  test('zones: inside their chunk, valid mod ids, respect min distance, wirelessBridge only on bridges', () => {
    let seen = new Set();
    for (const c of chunks) {
      for (const z of c.zones) {
        seen.add(z.modId);
        expect(content.terrainMods[z.modId]).toBeDefined();
        expect(z.x0).toBeLessThan(z.x1);
        expect(z.x0).toBeGreaterThanOrEqual(c.startX);
        expect(z.x1).toBeLessThanOrEqual(c.endX);
        expect(z.x0 / PIXELS_PER_METER).toBeGreaterThanOrEqual(content.terrainMods[z.modId].minDistanceM - 1);
        if (z.modId === 'wirelessBridge') expect(c.kind).toBe('bridge');
        if (c.kind === 'bridge') expect(z.modId).toBe('wirelessBridge');
      }
    }
    expect([...seen].sort()).toEqual(['compression', 'highBandwidth', 'wirelessBridge']);
  });

  test('bridge chunks: gap on polyline points, bounce pad on solid ground before it, boost from def', () => {
    const bridges = chunks.filter((c) => c.kind === 'bridge');
    expect(bridges.length).toBeGreaterThan(3);
    for (const c of bridges) {
      expect(c.gaps.length).toBe(1);
      const { x0, x1 } = c.gaps[0];
      expect(c.points.some((p) => p.x === x0)).toBe(true);
      expect(c.points.some((p) => p.x === x1)).toBe(true);
      expect(x1 - x0).toBeLessThanOrEqual(224);
      expect(x1 - x0).toBeGreaterThanOrEqual(64);
      expect(c.bouncePads.length).toBeGreaterThanOrEqual(1);
      const def = content.chunks.find((d) => d.id === c.defId);
      for (const pad of c.bouncePads) {
        expect(pad.x + pad.width / 2).toBeLessThanOrEqual(x0);
        expect(pad.x - pad.width / 2).toBeGreaterThan(c.startX);
        expect(pad.boost).toBe(def.bridge.bounceBoost);
        expect(g.heightAt(pad.x)).toBeCloseTo(pad.y, 6);
      }
      // landing platform is solid and long enough after the gap
      expect(c.endX - x1).toBeGreaterThanOrEqual(14 * SPACING_PX - 1);
    }
  });

  test('bridge gaps are always jumpable: bounce pad launch at modest speed clears the gap', () => {
    const bridges = chunks.filter((c) => c.kind === 'bridge');
    for (const c of bridges) {
      const { x0, x1 } = c.gaps[0];
      const pad = c.bouncePads[0];
      for (const vx of [250, 400, 700]) {
        let x = pad.x;
        let y = pad.y;
        let vy = -pad.boost;
        const dt = 1 / 240;
        let guard = 0;
        while (x < x1 && guard++ < 10000) {
          x += vx * dt;
          vy += 900 * dt;
          y += vy * dt;
        }
        // at the far edge of the gap the sled must still be above the landing surface
        expect(y).toBeLessThan(g.heightAt(x1));
        expect(x0).toBeLessThan(x);
      }
    }
  });

  test('non-bridge chunks have no gaps or pads', () => {
    for (const c of chunks) if (c.kind !== 'bridge') { expect(c.gaps).toEqual([]); expect(c.bouncePads).toEqual([]); }
  });
});

describe('TerrainGenerator queries', () => {
  test('heightAt interpolates the polyline; slopeDegAt matches segment angle', () => {
    const g = makeGen('queries');
    g.update(0);
    const c = g.getActiveChunks()[0];
    for (let i = 0; i < c.points.length - 1; i += 7) {
      const a = c.points[i];
      const b = c.points[i + 1];
      expect(g.heightAt(a.x)).toBeCloseTo(a.y, 6);
      expect(g.heightAt((a.x + b.x) / 2)).toBeCloseTo((a.y + b.y) / 2, 6);
      expect(g.slopeDegAt((a.x + b.x) / 2)).toBeCloseTo(segAngle(c.points, i), 6);
    }
    expect(g.heightAt(c.endX)).toBeCloseTo(c.points[c.points.length - 1].y, 6);
  });

  test('heightAt works slightly ahead of the live window (extends, reported by next update)', () => {
    const g = makeGen('queries2');
    const ref = makeGen('queries2');
    g.update(0);
    const x = g.getActiveChunks().at(-1).endX + 1500;
    expect(g.heightAt(x)).toBeCloseTo(ref.heightAt(x), 6);
    const r = g.update(0);
    expect(r.added.length).toBeGreaterThan(0);
    expect(r.added.some((c) => c.startX <= x && c.endX >= x)).toBe(true);
  });

  test('heightAt works far ahead of and far behind the live window (temporary rebuild)', () => {
    const g = makeGen('queries3');
    const ref = makeGen('queries3');
    g.update(0);
    expect(g.heightAt(40000)).toBeCloseTo(ref.heightAt(40000), 6);
    for (let x = 0; x < 30000; x += 100) g.update(x);
    expect(g.heightAt(1000)).toBeCloseTo(ref.heightAt(1000), 6);
    expect(g.slopeDegAt(1000)).toBeCloseTo(ref.slopeDegAt(1000), 6);
    // live stream unaffected
    expect(g.getActiveChunks().every((c) => c.index > 5)).toBe(true);
  });

  test('getZonesAt returns the zones containing x', () => {
    const g = makeGen('zones-q');
    let checked = 0;
    for (let i = 0; i < 150 && checked < 5; i++) {
      const c = g.getChunk(i);
      for (const z of c.zones) {
        const mid = (z.x0 + z.x1) / 2;
        const zs = g.getZonesAt(mid);
        expect(zs.some((q) => q.modId === z.modId && q.x0 === z.x0)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(g.getZonesAt(-50)).toEqual([]);
  });

  test('negative x extrapolates and does not throw', () => {
    const g = makeGen('neg');
    expect(() => g.heightAt(-100)).not.toThrow();
    expect(g.getChunkAt(-1)).toBeNull();
  });
});

describe('TerrainGenerator difficulty', () => {
  const g = makeGen('diff');
  test('difficulty steps up once per 500 m sector and keeps rising toward the old baseline', () => {
    const base = g.difficultyAt(0);
    expect(g.difficultyAt(499)).toEqual(base);
    expect(base.sector).toBe(1);
    expect(base.slopeVariance).toBe(1);
    expect(base.hazardDensity).toBeCloseTo(0.8, 6);
    let prev = base;
    for (const d of [500, 1000, 1500, 2500, 4000]) {
      const cur = g.difficultyAt(d);
      expect(cur.sector).toBe(Math.floor(d / SECTOR_M) + 1);
      expect(cur.slopeVariance).toBeGreaterThan(prev.slopeVariance);
      expect(cur.hazardDensity).toBeGreaterThan(prev.hazardDensity);
      expect(cur.glitchFrequency).toBeGreaterThan(prev.glitchFrequency);
      expect(cur.noiseWeightMul).toBeGreaterThan(prev.noiseWeightMul);
      expect(cur.speedBudget).toBeGreaterThanOrEqual(prev.speedBudget);
      prev = cur;
    }
    // the old 1000 m ramp reached 2.1 / 4 by 4000 m; sector steps reach the same ceiling
    expect(g.difficultyAt(4000).hazardDensity).toBeGreaterThan(1.9);
    expect(g.difficultyAt(99999).hazardDensity).toBeCloseTo(2.1, 6);
  });

  test('slope variance makes late terrain bumpier', () => {
    const stdev = (gen, from, to) => {
      const a = [];
      for (let i = from; i < to; i++) {
        const c = gen.getChunk(i);
        if (c.kind !== 'spline' || c.defId === 'gen-jump') continue;
        for (let k = 0; k < c.points.length - 1; k++) a.push(segAngle(c.points, k));
      }
      const m = a.reduce((s, v) => s + v, 0) / a.length;
      return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
    };
    let early = 0;
    let late = 0;
    for (let s = 0; s < 4; s++) {
      const gen = makeGen('bumpy-' + s);
      early += stdev(gen, 2, 80);
      late += stdev(gen, 220, 300);
    }
    expect(late).toBeGreaterThan(early);
  });
});

describe('TerrainGenerator streaming and pooling', () => {
  test('update() keeps a 3-screen buffer ahead and drops chunks 2 screens behind', () => {
    const g = makeGen('stream');
    const known = new Set();
    let x = 0;
    for (let f = 0; f < 6000; f++) {
      x += 14; // ~840 px/s at 60 fps
      const { added, removed } = g.update(x);
      for (const c of added) {
        expect(known.has(c.index)).toBe(false);
        known.add(c.index);
      }
      for (const idx of removed) {
        expect(known.has(idx)).toBe(true);
        known.delete(idx);
      }
      const act = g.getActiveChunks();
      expect(act[act.length - 1].endX).toBeGreaterThanOrEqual(x + TERRAIN.bufferAheadScreens * 480);
      expect(act[0].endX).toBeGreaterThanOrEqual(x - TERRAIN.keepBehindScreens * 480 - 1);
      expect(act.length).toBeLessThan(12);
      expect(new Set(act.map((c) => c.index))).toEqual(known);
    }
    expect(x).toBeGreaterThan(80000);
  });

  test('first update generates the initial buffer starting at chunk 0', () => {
    const g = makeGen('first');
    const { added, removed } = g.update(0);
    expect(removed).toEqual([]);
    expect(added[0].index).toBe(0);
    expect(added[added.length - 1].endX).toBeGreaterThanOrEqual(3 * 480);
    expect(g.update(0).added).toEqual([]);
  });

  test('active chunks are contiguous in order', () => {
    const g = makeGen('contig');
    for (let x = 0; x < 50000; x += 37) g.update(x);
    const act = g.getActiveChunks();
    for (let i = 1; i < act.length; i++) {
      expect(act[i].index).toBe(act[i - 1].index + 1);
      expect(act[i].startX).toBe(act[i - 1].endX);
    }
  });

  test('chunk objects are recycled: allocations stay bounded over a very long run', () => {
    const g = makeGen('pool');
    let x = 0;
    let total = 0;
    for (let f = 0; f < 20000; f++) {
      x += 20;
      total += g.update(x).added.length;
    }
    expect(total).toBeGreaterThan(150);
    expect(g.stats.created).toBeLessThan(16);
    expect(g.stats.reused).toBeGreaterThan(total - 16);
    expect(g.pool.length).toBeLessThanOrEqual(6);
    expect(g.activeList.length).toBeLessThan(12);
    expect(g.active.size).toBe(g.activeList.length);
  });

  test('recycled chunk objects are not reused within the same update (consumers still hold them)', () => {
    const g = makeGen('late-reuse');
    let x = 0;
    for (let f = 0; f < 3000; f++) {
      x += 20;
      const before = new Set(g.getActiveChunks());
      const { added, removed } = g.update(x);
      if (removed.length) for (const c of added) expect(before.has(c)).toBe(false);
    }
  });

  test('a recycled chunk can be re-requested and regenerates identically', () => {
    const g = makeGen('regen');
    const first = [];
    let x = 0;
    for (let f = 0; f < 4000; f++) {
      x += 20;
      for (const c of g.update(x).added) if (c.index < 5) first[c.index] = snap(c);
    }
    expect(g.active.has(0)).toBe(false);
    for (let i = 0; i < 5; i++) expect(snap(g.getChunk(i))).toEqual(first[i]);
    // and the live stream is not disturbed by the re-request
    expect(g.getActiveChunks().every((c) => c.index > 4)).toBe(true);
  });

  test('streaming output equals random-access output', () => {
    const a = makeGen('same');
    const b = makeGen('same');
    let x = 0;
    for (let f = 0; f < 2000; f++) {
      x += 25;
      for (const c of a.update(x).added) expect(snap(c)).toEqual(snap(b.getChunk(c.index)));
    }
  });

  test('update() is cheap: well under a millisecond on average once streaming', () => {
    const g = makeGen('perf');
    let x = 0;
    for (let f = 0; f < 300; f++) { x += 15; g.update(x); }
    const t0 = performance.now();
    const frames = 5000;
    for (let f = 0; f < frames; f++) { x += 15; g.update(x); }
    const per = (performance.now() - t0) / frames;
    expect(per).toBeLessThan(0.5);
  });

  test('starting update far from the origin begins at the right chunk', () => {
    const g = makeGen('late-start');
    const ref = makeGen('late-start');
    const { added } = g.update(30000);
    expect(added[0].startX).toBeLessThanOrEqual(30000 - 2 * 480);
    expect(snap(added[0])).toEqual(snap(ref.getChunk(added[0].index)));
  });
});

describe('TerrainGenerator flow rules (QA: hands-off sleds used to stall in dips)', () => {
  const MAX_UP = 12;

  /** Points of the first `n` chunks, bridges excluded (their gap is a deliberate jump). */
  const solid = (g, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = g.getChunk(i);
      if (c.kind === 'bridge') continue;
      for (let k = 0; k < c.points.length; k++) out.push({ ...c.points[k], first: k === 0, chunk: c });
    }
    return out;
  };

  test('spline chunks never climb steeper than MAX_UP_DEG and no hill rises far above its valley', () => {
    let worstUp = 0;
    let worstRise = 0;
    for (let s = 0; s < 20; s++) {
      const g = makeGen('flow-' + s);
      for (let i = 0; i < 120; i++) {
        const c = g.getChunk(i);
        if (c.kind !== 'spline') continue;
        let valleyY = c.points[0].y;
        for (let k = 0; k < c.points.length - 1; k++) {
          worstUp = Math.max(worstUp, -segAngle(c.points, k));
          const y = c.points[k + 1].y;
          if (y > c.points[k].y) valleyY = Math.max(valleyY, y);
          else if (y < c.points[k].y) worstRise = Math.max(worstRise, valleyY - y);
        }
      }
    }
    expect(worstUp).toBeLessThanOrEqual(MAX_UP + 1e-6);
    // RISE_MAX_PX is 30 on the raw profile; the start-tangent blend and slope limiter reshape it a little
    expect(worstRise).toBeLessThanOrEqual(70);
  });

  test('a rolling point mass with typical drag never stalls on the first 1.5 km of 40 seeds', () => {
    // 1-D roll along the polyline: 65% of g*sin(slope) (Matter seam losses seen in QA), linear + quadratic drag.
    for (let s = 0; s < 40; s++) {
      const g = makeGen('roll-' + s);
      const pts = solid(g, 40).filter((p, i, a) => i === 0 || p.x > a[i - 1].x);
      let v = 90;
      let i = 0;
      let pos = pts[0].x;
      let below = 0;
      for (let t = 0; t < 120 && i < pts.length - 2 && pos < 1500 * PIXELS_PER_METER; t += 0.01) {
        const a = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
        v = Math.max(0, v + (900 * Math.sin(a) * 0.65 - 0.2 * v - 0.0003 * v * v) * 0.01);
        pos += v * Math.cos(a) * 0.01;
        while (i < pts.length - 2 && pos >= pts[i + 1].x) i++;
        below = v < 10 ? below + 0.01 : 0;
        if (below > 1) throw new Error(`seed ${s}: stalled at ${Math.round(pos / 20)} m`);
      }
    }
  });

  test('the first segment of every chunk turns by at most 12 degrees from the previous one (noise seams too)', () => {
    for (let s = 0; s < 10; s++) {
      const g = makeGen('seam-' + s);
      let prev = g.getChunk(0);
      for (let i = 1; i < 300; i++) {
        const c = g.getChunk(i);
        if (c.kind !== 'bridge' && prev.kind !== 'bridge') {
          expect(Math.abs(segAngle(prev.points, prev.points.length - 2) - segAngle(c.points, 0))).toBeLessThanOrEqual(12);
        }
        prev = c;
      }
    }
  });
});

describe('TerrainGenerator fun pass: gentle opening', () => {
  test('no crash hazards in the first 150 m (50 seeds), nothing at all in the first 80 m', () => {
    const { hazards } = loadContent();
    for (let sd = 0; sd < 50; sd++) {
      const g = makeGen('gentle-' + sd);
      for (let i = 0; i < 12; i++) {
        const c = g.getChunk(i);
        for (const h of c.hazards) {
          expect(h.x).toBeGreaterThanOrEqual(HAZARD_SOFT_PX);
          if (h.x < HAZARD_SAFE_PX) expect(hazards[h.defId].onHit.effect).not.toBe('crash');
        }
      }
    }
  });

  test('chunk 0 is a speed-building run into one easy jump with a long clean landing', () => {
    for (let sd = 0; sd < 30; sd++) {
      const g = makeGen('open-' + sd);
      const c = g.getChunk(0);
      expect(c.launches.length).toBe(1);
      const l = c.launches[0];
      expect(l.x).toBeLessThan(60 * PIXELS_PER_METER);
      expect(l.x).toBeGreaterThan(400);
      expect(l.airS).toBeGreaterThanOrEqual(0.5);
      expect(l.landX).not.toBeNull();
      // runs downhill all the way up to the lip
      for (let i = 0; i < Math.floor((l.x - 160) / SPACING_PX); i++) expect(segAngle(c.points, i)).toBeGreaterThan(5);
      // landing ramp: a down-slope under the landing point, then at least 240 px of runout in the same chunk
      expect(segAngle(c.points, Math.floor((l.landX - c.startX) / SPACING_PX))).toBeGreaterThan(20);
      expect(c.endX - l.landX).toBeGreaterThan(240);
      expect(c.hazards).toEqual([]);
    }
  });

  test('an independent ballistic check finds the first launch within 60 m', () => {
    for (let sd = 0; sd < 10; sd++) {
      const L = findLaunches(makeGen('first-' + sd), 6, 380, 0.5);
      expect(L.length).toBeGreaterThan(0);
      expect(L[0].x).toBeLessThan(60 * PIXELS_PER_METER);
    }
  });

  test('hazard density ramps in smoothly rather than at full density', () => {
    let early = 0;
    let earlyLen = 0;
    let mid = 0;
    let midLen = 0;
    for (let sd = 0; sd < 12; sd++) {
      const g = makeGen('ramp-' + sd);
      for (let i = 0; i < 60; i++) {
        const c = g.getChunk(i);
        const m = c.startX / PIXELS_PER_METER;
        if (m < 300) { early += c.hazards.length; earlyLen += c.endX - c.startX; }
        else if (m >= 1000 && m < 2500) { mid += c.hazards.length; midLen += c.endX - c.startX; }
      }
    }
    expect(mid / midLen).toBeGreaterThan((early / earlyLen) * 1.2);
  });
});

describe('TerrainGenerator fun pass: launches and crests', () => {
  const content = loadContent();
  const sharp = Object.fromEntries(content.chunks.map((d) => [d.id, (d.tags || []).some((t) => SHARP_TAGS.includes(t))]));
  sharp['gen-jump'] = true;

  test('launches happen every ~2000-3500 px on average and get airier with distance', () => {
    const xs = [];
    const earlyAir = [];
    const lateAir = [];
    for (let sd = 0; sd < 12; sd++) {
      const g = makeGen('launch-' + sd);
      let last = null;
      for (let i = 0; i < 80; i++) {
        for (const l of g.getChunk(i).launches) {
          if (last !== null) xs.push(l.x - last);
          last = l.x;
          (l.x / PIXELS_PER_METER < 800 ? earlyAir : lateAir).push(l.airS);
        }
      }
    }
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(1800);
    expect(mean).toBeLessThan(3800);
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(lateAir)).toBeGreaterThan(avg(earlyAir));
    expect(avg(lateAir)).toBeGreaterThan(0.9);
    expect(Math.max(...lateAir)).toBeLessThan(1.8);
  });

  test('generated jumps land on a down-slope inside the chunk', () => {
    for (let sd = 0; sd < 8; sd++) {
      const g = makeGen('land-' + sd);
      for (let i = 0; i < 80; i++) {
        const c = g.getChunk(i);
        if (c.defId !== 'gen-jump') continue;
        const l = c.launches[0];
        expect(l).toBeDefined();
        expect(l.landX).not.toBeNull();
        expect(segAngle(c.points, Math.floor((l.landX - c.startX) / SPACING_PX))).toBeGreaterThan(25);
      }
    }
  });

  test('landing zones are hazard free (this chunk and the next)', () => {
    for (let sd = 0; sd < 15; sd++) {
      const g = makeGen('zone-' + sd);
      for (let i = 0; i < 100; i++) {
        const c = g.getChunk(i);
        const next = g.getChunk(i + 1);
        for (const l of c.launches) {
          const end = (l.landX == null ? l.x + 700 : l.landX) + 100;
          for (const h of c.hazards.concat(next.hazards)) expect(h.x < l.x - 40 || h.x > end).toBe(true);
        }
      }
    }
  });

  test('ordinary terrain has round crests: slope never increases by more than CREST_TURN_DEG per segment', () => {
    let worstSpline = 0;
    let worstNoise = 0;
    let worstSharp = 0;
    for (let sd = 0; sd < 15; sd++) {
      const g = makeGen('crest-' + sd);
      for (let i = 0; i < 120; i++) {
        const c = g.getChunk(i);
        for (let k = 1; k < c.points.length - 1; k++) {
          if (inGap(c, k) || inGap(c, k - 1)) continue;
          const inc = segAngle(c.points, k) - segAngle(c.points, k - 1);
          if (c.kind === 'noise') worstNoise = Math.max(worstNoise, inc);
          else if (sharp[c.defId]) worstSharp = Math.max(worstSharp, inc);
          else worstSpline = Math.max(worstSpline, inc);
        }
      }
    }
    expect(worstSpline).toBeLessThanOrEqual(CREST_TURN_DEG + 1e-6);
    expect(worstNoise).toBeLessThanOrEqual(NOISE_CREST_TURN_DEG + 1e-6);
    expect(worstSharp).toBeGreaterThan(CREST_TURN_DEG * 2); // deliberate lips stay sharp
  });
});

describe('TerrainGenerator fun pass: sectors', () => {
  test('chunk.sector is 1-based and follows startX; each sector starts with a calm breather chunk', () => {
    const g = makeGen('sectors');
    let breathers = 0;
    let lastSector = 0;
    for (let i = 0; i < 200; i++) {
      const c = g.getChunk(i);
      expect(c.sector).toBe(Math.floor(c.startX / PIXELS_PER_METER / SECTOR_M) + 1);
      expect(c.sector).toBeGreaterThanOrEqual(lastSector);
      if (c.sector > lastSector && i > 0) {
        breathers++;
        expect(c.breather).toBe(true);
        expect(c.kind).toBe('spline');
        expect(c.defId).not.toBe('gen-jump');
        for (const h of c.hazards) expect(h.x - c.startX).toBeGreaterThan(1000);
      } else expect(c.breather).toBe(false);
      lastSector = c.sector;
    }
    expect(breathers).toBeGreaterThan(10);
  });

  test('hazards get denser sector by sector', () => {
    const dens = (from, to) => {
      let n = 0;
      let len = 0;
      for (let sd = 0; sd < 10; sd++) {
        const g = makeGen('sd-' + sd);
        for (let i = 0; i < 120; i++) {
          const c = g.getChunk(i);
          if (c.sector >= from && c.sector <= to) { n += c.hazards.length; len += c.endX - c.startX; }
        }
      }
      return n / len;
    };
    expect(dens(3, 4)).toBeGreaterThan(dens(1, 2));
    expect(dens(7, 9)).toBeGreaterThan(dens(3, 4));
  });
});

describe('TerrainGenerator fun pass: shards', () => {
  const content = loadContent();
  const hazardBox = (h) => {
    const d = content.hazards[h.defId];
    return { x0: h.x - d.size.w / 2, x1: h.x + d.size.w / 2, top: h.y - d.size.h };
  };

  test('shards are deterministic per seed and independent of call order', () => {
    const a = makeGen('sh-a');
    const b = makeGen('sh-a');
    for (let i = 59; i >= 0; i--) expect(snap(a.getChunk(i).shards)).toEqual(snap(b.getChunk(i).shards));
    const c = makeGen('sh-b');
    let diff = 0;
    for (let i = 0; i < 40; i++) if (JSON.stringify(a.getChunk(i).shards) !== JSON.stringify(c.getChunk(i).shards)) diff++;
    expect(diff).toBeGreaterThan(20);
  });

  test('shape: sorted by x, unique stable ids, 4-9 per group, inside the chunk, ~55-65 % of chunks', () => {
    let withShards = 0;
    let total = 0;
    const ids = new Set();
    for (let sd = 0; sd < 15; sd++) {
      const g = makeGen('shape-' + sd);
      for (let i = 0; i < 100; i++) {
        const c = g.getChunk(i);
        total++;
        expect(Array.isArray(c.shards)).toBe(true);
        if (!c.shards.length) continue;
        withShards++;
        expect(c.shards.length).toBeGreaterThanOrEqual(4);
        expect(c.shards.length).toBeLessThanOrEqual(9);
        c.shards.forEach((s, k) => {
          expect(s.id).toBe(`s${i}-${k}`);
          expect(ids.has(sd + s.id)).toBe(false);
          ids.add(sd + s.id);
          expect(s.x).toBeGreaterThanOrEqual(c.startX);
          expect(s.x).toBeLessThanOrEqual(c.endX);
          if (k) expect(s.x).toBeGreaterThan(c.shards[k - 1].x);
        });
      }
    }
    expect(withShards / total).toBeGreaterThan(0.5);
    expect(withShards / total).toBeLessThan(0.7);
  });

  test('every shard is above the surface and clear of hazard hit boxes', () => {
    for (let sd = 0; sd < 15; sd++) {
      const g = makeGen('clear-' + sd);
      for (let i = 0; i < 150; i++) {
        const c = g.getChunk(i);
        for (const s of c.shards) {
          expect(s.y).toBeLessThanOrEqual(g.heightAt(s.x) - 10);
          for (const h of c.hazards) {
            const b = hazardBox(h);
            expect(s.x >= b.x0 - 10 && s.x <= b.x1 + 10 && s.y >= b.top - 10).toBe(false);
          }
        }
      }
    }
  });

  test('arcs follow launches (shards sit on the ballistic line) and ground lines hug ~14 px above the surface', () => {
    let arcs = 0;
    let lines = 0;
    for (let sd = 0; sd < 10; sd++) {
      const g = makeGen('kind-' + sd);
      for (let i = 0; i < 100; i++) {
        const c = g.getChunk(i);
        if (c.shards.length < 4) continue;
        const heights = c.shards.map((s) => g.heightAt(s.x) - s.y);
        if (heights.every((h) => Math.abs(h - 14) <= 1.5)) lines++;
        else if (c.launches.length || c.bouncePads.length) arcs++;
      }
    }
    expect(arcs).toBeGreaterThan(20);
    expect(lines).toBeGreaterThan(5);
  });

  test('fewer free ground lines and more risky placements as distance grows', () => {
    const ratio = (lo, hi) => {
      let ground = 0;
      let other = 0;
      for (let sd = 0; sd < 25; sd++) {
        const g = makeGen('risk-' + sd);
        for (let i = 0; i < 160; i++) {
          const c = g.getChunk(i);
          const m = c.startX / PIXELS_PER_METER;
          if (m < lo || m >= hi || c.shards.length < 4 || c.launches.length || c.bouncePads.length) continue;
          const heights = c.shards.map((s) => g.heightAt(s.x) - s.y);
          if (heights.every((h) => Math.abs(h - 14) <= 1.5)) ground++;
          else other++;
        }
      }
      return ground / (ground + other);
    };
    expect(ratio(0, 1500)).toBeGreaterThan(ratio(4000, 99999));
  });

  test('chunk objects recycled by update() have their shards (and launches) reset', () => {
    const stream = makeGen('recycle');
    const fresh = makeGen('recycle');
    let x = 0;
    let checked = 0;
    for (let f = 0; f < 600; f++) {
      x += 120;
      stream.update(x);
      for (const c of stream.getActiveChunks()) {
        const ref = fresh.getChunk(c.index);
        expect(snap(c.shards)).toEqual(snap(ref.shards));
        expect(snap(c.launches)).toEqual(snap(ref.launches));
        expect(c.sector).toBe(ref.sector);
        checked++;
      }
    }
    expect(stream.stats.reused).toBeGreaterThan(5);
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('TerrainGenerator fun pass: anti-stall at any distance', () => {
  test('a rolling point mass never stalls on the first 10 000 m of 30 seeds', () => {
    for (let sd = 0; sd < 30; sd++) {
      const r = rollSim(makeGen('late-' + sd), 10000);
      if (r.stalledAtM !== null) throw new Error(`seed ${sd}: stalled at ${Math.round(r.stalledAtM)} m`);
      expect(r.reachedM).toBeGreaterThanOrEqual(10000);
    }
  });

  test('expected speed budget rises with distance and is capped', () => {
    expect(expectedSpeedPxS(0)).toBeLessThan(expectedSpeedPxS(1000));
    expect(expectedSpeedPxS(1e6)).toBeLessThanOrEqual(620);
  });
});
