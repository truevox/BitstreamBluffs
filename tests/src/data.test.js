// Validates the JSON content authored by core-logic against the documented schemas.
import { PALETTE_KEYS } from '../../src/constants.js';
import { readDir, loadContent } from './_helpers.js';

const chunks = readDir('chunks');
const mods = readDir('terrainMods');

describe('chunk templates', () => {
  test('ids are unique and files carry required fields', () => {
    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of chunks) {
      expect(['spline', 'noise', 'bridge']).toContain(c.kind);
      expect(c.weight).toBeGreaterThan(0);
      expect(c.minDistanceM).toBeGreaterThanOrEqual(0);
      expect(c.lengthPx).toBeGreaterThanOrEqual(400);
      expect(Array.isArray(c.tags)).toBe(true);
    }
  });

  test('at least 8 spline templates, plus noise and bridge kinds', () => {
    expect(chunks.filter((c) => c.kind === 'spline').length).toBeGreaterThanOrEqual(8);
    expect(chunks.filter((c) => c.kind === 'noise').length).toBeGreaterThanOrEqual(1);
    expect(chunks.filter((c) => c.kind === 'bridge').length).toBeGreaterThanOrEqual(1);
  });

  test('variety: rollers, kickers, big air, step-downs, long carves, bridges are all present', () => {
    const tags = new Set(chunks.flatMap((c) => c.tags));
    for (const t of ['roller', 'kicker', 'big-air', 'steps', 'carve', 'gap']) expect(tags).toContain(t);
  });

  test('spline control points: x in [0,1] non-decreasing from 0 to 1, y finite, net downhill', () => {
    for (const c of chunks.filter((d) => d.kind === 'spline' || d.kind === 'bridge')) {
      const p = c.controlPoints;
      expect(p.length).toBeGreaterThanOrEqual(2);
      expect(p.length).toBeLessThanOrEqual(15);
      expect(p[0]).toEqual({ x: 0, y: 0 });
      expect(p[p.length - 1].x).toBe(1);
      for (let i = 0; i < p.length; i++) {
        expect(p[i].x).toBeGreaterThanOrEqual(0);
        expect(p[i].x).toBeLessThanOrEqual(1);
        expect(Number.isFinite(p[i].y)).toBe(true);
        if (i) expect(p[i].x).toBeGreaterThan(p[i - 1].x);
      }
      expect(p[p.length - 1].y).toBeGreaterThan(0);
      // nominal slope of the template stays inside the generator's limits
      for (let i = 1; i < p.length; i++) {
        const deg = (Math.atan2(p[i].y - p[i - 1].y, (p[i].x - p[i - 1].x) * c.lengthPx) * 180) / Math.PI;
        expect(deg).toBeLessThan(55);
        expect(deg).toBeGreaterThan(-45);
      }
    }
  });

  test('noise and bridge params are sane', () => {
    for (const c of chunks.filter((d) => d.kind === 'noise')) {
      expect(c.noise.amplitudePx).toBeGreaterThan(0);
      expect(c.noise.frequency).toBeGreaterThan(0);
      expect(c.noise.octaves).toBeGreaterThanOrEqual(1);
      expect(c.noise.meanSlopeDeg).toBeGreaterThan(3);
      expect(c.noise.meanSlopeDeg).toBeLessThan(30);
    }
    for (const c of chunks.filter((d) => d.kind === 'bridge')) {
      expect(c.bridge.gapPx).toBeGreaterThanOrEqual(64);
      expect(c.bridge.gapPx).toBeLessThanOrEqual(224);
      expect(c.bridge.bounceBoost).toBeGreaterThan(300);
      expect(c.lengthPx).toBeGreaterThanOrEqual(c.bridge.gapPx * 3);
    }
  });

  test('there is always an early-game template (minDistanceM 0) and intro tags exist', () => {
    expect(chunks.filter((c) => c.kind === 'spline' && c.minDistanceM === 0).length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.tags.includes('intro'))).toBe(true);
    // no noise zone or bridge before 150 m
    for (const c of chunks.filter((d) => d.kind !== 'spline')) expect(c.minDistanceM).toBeGreaterThanOrEqual(150);
  });

  test('modIds reference existing terrain mods', () => {
    const ids = new Set(mods.map((m) => m.id));
    for (const c of chunks) for (const id of c.modIds || []) expect(ids).toContain(id);
  });
});

describe('terrain mods', () => {
  test('the three documented mods exist with schema fields and valid palette keys', () => {
    // The three base mods are pinned by name: they back existing chunk templates, so removing or
    // renaming one is a content break. Biome mods (W3) are additive, so this asserts containment
    // rather than an exact list - W3 adds five, W6 will add six more.
    expect(mods.map((m) => m.id)).toEqual(expect.arrayContaining(['compression', 'highBandwidth', 'wirelessBridge']));
    for (const m of mods) {
      expect(PALETTE_KEYS).toContain(m.colorKey);
      expect(m.weight).toBeGreaterThan(0);
      expect(m.minDistanceM).toBeGreaterThanOrEqual(0);
      expect(m.lengthPx).toHaveLength(2);
      expect(m.lengthPx[0]).toBeLessThanOrEqual(m.lengthPx[1]);
      // A mod must do SOMETHING: either physics (the original contract) or a scoring multiplier
      // (W3's Crystal Cavern echo). A mod with neither would be a zone the player cannot feel.
      const physical = Object.keys(m.physics || {}).length > 0;
      const scoring = Number.isFinite(m.scoreMul) && m.scoreMul > 1;
      expect({ id: m.id, acts: physical || scoring }).toMatchObject({ id: m.id, acts: true });
    }
  });

  test('physics direction matches the doc: high bandwidth = low friction, compression = more gravity', () => {
    const byId = Object.fromEntries(mods.map((m) => [m.id, m]));
    expect(byId.highBandwidth.physics.frictionMul).toBeLessThan(1);
    expect(byId.compression.physics.gravityMul).toBeGreaterThan(1);
    expect(byId.wirelessBridge.physics.bounceMul).toBeGreaterThan(1);
  });

  test('hazard defs follow the schema; the air hazard is a crash hazard from >= 1500 m', () => {
    const hazards = readDir('hazards');
    const ids = hazards.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const h of hazards) {
      expect(typeof h.shapeKey).toBe('string');
      expect(h.size.w).toBeGreaterThan(0);
      expect(h.size.h).toBeGreaterThan(0);
      expect(['crash', 'slow', 'scramble']).toContain(h.onHit.effect);
      expect(h.weight).toBeGreaterThan(0);
      expect(h.minDistanceM).toBeGreaterThanOrEqual(0);
      expect(['ground', 'air']).toContain(h.placement);
      expect(PALETTE_KEYS).toContain(h.colorKey);
    }
    const air = hazards.filter((h) => h.placement === 'air');
    expect(air.map((h) => h.id)).toEqual(['roguePacket']);
    expect(air[0].onHit.effect).toBe('crash');
    expect(air[0].minDistanceM).toBeGreaterThanOrEqual(1500);
  });

  test('loadContent exposes every group', () => {
    const c = loadContent();
    expect(c.chunks.length).toBe(chunks.length);
    expect(Object.keys(c.hazards).sort()).toEqual(['garbageDataVent', 'glitchChasm', 'overflowFirewall', 'packetSpike', 'roguePacket']);
    expect(Object.keys(c.powerups).sort()).toEqual(['clockPulse', 'hashedBackup', 'packetBurst']);
  });
});
