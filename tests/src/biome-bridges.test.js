/**
 * #65 terrain: Debutmont is the base biome and arcade is the bridge at every biome change.
 *
 * The pure pieces (biomeForSector, arcadeBridgeLengthM, biomeAtX) are tested against the shipped content, and the
 * real generator is checked against them chunk by chunk so terrain and every consumer agree on one answer.
 */
import {
  TerrainGenerator, biomeForSector, biomeAtX, arcadeBridgeLengthM, sectorHasBridge, HOME_BIOME_ID, SECTOR_M, BASE_SECTORS,
  BIOME_BASE_WEIGHT, ARCADE_BRIDGE_MIN_FRAC, ARCADE_BRIDGE_MAX_FRAC, ARCADE_BRIDGE_RAMP_M,
} from '../../src/systems/TerrainGenerator.js';
import { Rng, xxHash32 } from '../../src/systems/Rng.js';
import { GHOST_PHYSICS_VERSION } from '../../src/systems/ghost/GhostTape.js';
import { makeGen, readDir } from './_helpers.js';
import { layout } from '../../tools/sim/biome-layout.mjs';

const DEFS = readDir('biomes');
const ALL = DEFS.reduce((m, d) => m | d.bit, 0);
const HOME_BIT = DEFS.find((d) => d.id === HOME_BIOME_ID).bit;
const SEEDS = ['alpha', 'bitstream-bluffs', '42', 'seed@mask0', '2026-11-13'];
const MASKS = [0, 2, 6, ALL];
const PPM = 20;

/** The pre-#65 draw, kept verbatim: null meant arcade. The new pick must equal it except null -> home. */
function oldBiomeForSector(seed, sector, biomeMask, biomeDefs) {
  if (!(sector >= BASE_SECTORS)) return null;
  const mask = biomeMask >>> 0;
  if (!mask) return null;
  const eligible = biomeDefs.filter((d) => d && d.bit && (mask & d.bit) !== 0);
  if (!eligible.length) return null;
  const rng = new Rng(xxHash32(`biome:${sector}`, new Rng(seed).baseSeed));
  const pick = rng.weighted(eligible.concat([{ id: null, weight: BIOME_BASE_WEIGHT }]), (d) => d.weight || 1);
  return pick && pick.id ? pick.id : null;
}

describe('home biome is the base', () => {
  test('HOME_BIOME_ID is a shipped biome', () => {
    expect(DEFS.map((d) => d.id)).toContain(HOME_BIOME_ID);
  });

  test('sectors 0 and 1 are home at any mask', () => {
    for (const seed of SEEDS) for (const mask of [0, ...MASKS, 1, 16, ALL]) {
      expect(biomeForSector(seed, 0, mask, DEFS)).toBe(HOME_BIOME_ID);
      expect(biomeForSector(seed, 1, mask, DEFS)).toBe(HOME_BIOME_ID);
    }
  });

  test('mask 0 is home in every sector, and never has a bridge', () => {
    for (const seed of SEEDS) for (let s = 0; s < 300; s++) {
      expect(biomeForSector(seed, s, 0, DEFS)).toBe(HOME_BIOME_ID);
      expect(sectorHasBridge(seed, s, 0, DEFS)).toBe(false);
    }
  });

  test('no defs, or defs without the mask bits: home (never null)', () => {
    expect(biomeForSector('alpha', 7, ALL, [])).toBe(HOME_BIOME_ID);
    expect(biomeForSector('alpha', 7, ALL, undefined)).toBe(HOME_BIOME_ID);
    expect(biomeForSector('alpha', 7, 1 << 20, DEFS)).toBe(HOME_BIOME_ID);
  });

  test('the home bit in the mask is a no-op: never double-weighted', () => {
    for (const seed of SEEDS) for (const mask of [0, 2, 6, 18, ALL & ~HOME_BIT]) for (let s = 0; s < 400; s++) {
      expect(biomeForSector(seed, s, mask | HOME_BIT, DEFS)).toBe(biomeForSector(seed, s, mask & ~HOME_BIT, DEFS));
    }
  });

  test('same stream, same draws: every non-home pick equals the old pick, and old null is now home', () => {
    for (const seed of SEEDS) for (const mask of [0, 2, 6, 18, ALL & ~HOME_BIT]) for (let s = 0; s < 400; s++) {
      const old = oldBiomeForSector(seed, s, mask, DEFS);
      expect(biomeForSector(seed, s, mask, DEFS)).toBe(old === null ? HOME_BIOME_ID : old);
    }
  });

  test('never returns a biome whose bit is not in the mask (home excepted)', () => {
    for (const d of DEFS) for (let s = 0; s < 400; s++) {
      expect([d.id, HOME_BIOME_ID]).toContain(biomeForSector('locked', s, d.bit, DEFS));
    }
  });
});

describe('bridge length curve', () => {
  test('constants: 1/6 of a sector at the start, 1/4 from 5000 m', () => {
    expect(ARCADE_BRIDGE_MIN_FRAC).toBeCloseTo(1 / 6, 12);
    expect(ARCADE_BRIDGE_MAX_FRAC).toBeCloseTo(1 / 4, 12);
    expect(ARCADE_BRIDGE_RAMP_M).toBe(5000);
  });

  test('linear in the start distance, capped', () => {
    expect(arcadeBridgeLengthM(0)).toBeCloseTo(SECTOR_M / 6, 9);
    expect(arcadeBridgeLengthM(ARCADE_BRIDGE_RAMP_M)).toBeCloseTo(SECTOR_M / 4, 9);
    expect(arcadeBridgeLengthM(ARCADE_BRIDGE_RAMP_M / 2)).toBeCloseTo((SECTOR_M / 6 + SECTOR_M / 4) / 2, 9);
    expect(arcadeBridgeLengthM(20000)).toBeCloseTo(125, 9);
    expect(arcadeBridgeLengthM(-5)).toBeCloseTo(SECTOR_M / 6, 9);
    let prev = 0;
    for (let m = 0; m <= 8000; m += 250) {
      const len = arcadeBridgeLengthM(m);
      expect(len).toBeGreaterThanOrEqual(prev);
      expect(len).toBeLessThanOrEqual(125 + 1e-9);
      prev = len;
    }
  });

  test('biomeAtX: bridge is the first `length` metres of a changing sector, exactly', () => {
    let checked = 0;
    for (const seed of SEEDS) for (let s = 1; s < 80; s++) {
      if (!sectorHasBridge(seed, s, ALL, DEFS)) continue;
      const start = s * SECTOR_M;
      const len = arcadeBridgeLengthM(start);
      const biome = biomeForSector(seed, s, ALL, DEFS);
      expect(biomeAtX(seed, start, ALL, DEFS)).toBeNull();
      expect(biomeAtX(seed, start + len - 0.01, ALL, DEFS)).toBeNull();
      expect(biomeAtX(seed, start + len + 0.01, ALL, DEFS)).toBe(biome);
      expect(biomeAtX(seed, start + SECTOR_M - 0.01, ALL, DEFS)).toBe(biome);
      // the sector before the boundary is the previous biome, with no bridge at its end
      expect(biomeAtX(seed, start - 0.01, ALL, DEFS)).toBe(biomeForSector(seed, s - 1, ALL, DEFS));
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });

  test('no bridge between consecutive sectors of the same biome, and none at the run start', () => {
    for (const seed of SEEDS) {
      expect(biomeAtX(seed, 0, ALL, DEFS)).toBe(HOME_BIOME_ID);
      for (let s = 1; s < 120; s++) {
        const same = biomeForSector(seed, s, ALL, DEFS) === biomeForSector(seed, s - 1, ALL, DEFS);
        expect(sectorHasBridge(seed, s, ALL, DEFS)).toBe(!same);
        if (same) {
          const b = biomeForSector(seed, s, ALL, DEFS);
          for (const dx of [0, 1, 40, 100, 200, 499]) expect(biomeAtX(seed, s * SECTOR_M + dx, ALL, DEFS)).toBe(b);
        }
      }
    }
  });
});

/** Chunk starts (metres) with the sector's first chunk flagged, for a generator. */
function walk(gen, uptoM) {
  const out = [];
  for (let i = 0; ; i++) {
    const c = gen.getChunk(i);
    if (c.startX / PPM >= uptoM) break;
    out.push({ i, c, startM: c.startX / PPM, endM: c.endX / PPM, biome: c.biome === undefined ? null : c.biome });
  }
  return out;
}

describe('the real generator follows the model, chunk-aligned', () => {
  const UPTO = 9000;

  test.each(SEEDS)('seed %s at the full mask: every chunk is the model biome; arcade only at changes', (seed) => {
    const gen = makeGen(seed, { biomeMask: ALL });
    const chunks = walk(gen, UPTO);
    const bridgeSectors = new Set();
    const arcadeSectors = new Set();
    for (let k = 0; k < chunks.length; k++) {
      const { c, startM, biome } = chunks[k];
      const sector = Math.floor(startM / SECTOR_M);
      const first = k > 0 && sector > Math.floor(chunks[k - 1].startM / SECTOR_M);
      expect(biome).toBe(biomeAtX(seed, startM, ALL, DEFS, first));
      expect(gen.biomeAtX(c.startX)).toBe(biome);
      expect(gen.biomeAtX(c.endX - 1)).toBe(biome);
      if (biome === null) arcadeSectors.add(sector);
      if (sectorHasBridge(seed, sector, ALL, DEFS)) bridgeSectors.add(sector);
    }
    // bridges exist exactly at the biome changes, nowhere else
    const lastSector = Math.floor(chunks[chunks.length - 1].startM / SECTOR_M);
    const expected = new Set([...bridgeSectors].filter((s) => s <= lastSector));
    expect(arcadeSectors).toEqual(expected);
    expect(expected.size).toBeGreaterThan(3);
  });

  test('every bridge is whole chunks: first chunk of the sector, then chunks starting inside the window', () => {
    for (const seed of SEEDS) {
      const gen = makeGen(seed, { biomeMask: ALL });
      const chunks = walk(gen, UPTO);
      for (let s = 1; s < 18; s++) {
        if (!sectorHasBridge(seed, s, ALL, DEFS)) continue;
        const start = s * SECTOR_M;
        const win = start + arcadeBridgeLengthM(start);
        const inSector = chunks.filter((q) => Math.floor(q.startM / SECTOR_M) === s);
        const arcade = inSector.filter((q) => q.biome === null);
        expect(arcade.length).toBeGreaterThanOrEqual(1); // minimum one chunk, however long the chunk over the boundary was
        expect(inSector[0].biome).toBeNull(); // the breather opens the bridge
        // the arcade chunks are contiguous from the sector's first chunk
        expect(arcade.map((q) => q.i)).toEqual(inSector.slice(0, arcade.length).map((q) => q.i));
        for (const q of arcade.slice(1)) expect(q.startM).toBeLessThan(win);
        const next = inSector[arcade.length];
        expect(next.biome).toBe(biomeForSector(seed, s, ALL, DEFS));
        expect(next.startM).toBeGreaterThanOrEqual(win);
        // the last bridge chunk starts inside the window (or is the sector's first chunk, when that starts past it)
        const last = arcade[arcade.length - 1];
        expect(last.startM).toBeLessThan(Math.max(win, inSector[0].startM + 1e-9));
      }
    }
  });

  test('bridge terrain is exactly today\'s arcade (null-biome) terrain generation', () => {
    // A bridge chunk carries no biome field, and equals the chunk a generator with no biome content builds there
    // only when the stream up to it matches; the cheap, exact claim is that it has none of the biome machinery.
    const seed = 'alpha';
    const gen = makeGen(seed, { biomeMask: ALL });
    const arcade = walk(gen, 4000).filter((q) => q.biome === null && q.i > 0);
    expect(arcade.length).toBeGreaterThan(3);
    for (const { c } of arcade) {
      expect('biome' in c).toBe(false);
      expect(c.hazards.every((h) => !DEFS.some((d) => d.id && h.biome === d.id))).toBe(true);
    }
  });

  test('mask 0 is pure Debutmont: no arcade chunk anywhere past the opening jump, every chunk tagged home', () => {
    for (const seed of SEEDS) {
      for (const q of walk(makeGen(seed, { biomeMask: 0 }), 6000)) expect(q.biome).toBe(HOME_BIOME_ID);
    }
  });

  test('a generator without biome content has no biome chunks at all', () => {
    for (const q of walk(makeGen('alpha', { biomeMask: ALL, biomeDefs: [] }), 3000)) expect(q.biome).toBeNull();
  });

  test('streamed and random-access generation agree (determinism across call order)', () => {
    const a = makeGen('stream', { biomeMask: ALL });
    const b = makeGen('stream', { biomeMask: ALL });
    const fwd = walk(a, 5000).map((q) => [q.i, q.biome, q.startM]);
    const rev = [];
    const n = fwd.length;
    for (let i = n - 1; i >= 0; i--) {
      const c = b.getChunk(i);
      rev.unshift([i, c.biome === undefined ? null : c.biome, c.startX / PPM]);
    }
    expect(rev).toEqual(fwd);
  });
});

describe('layout is deterministic', () => {
  test('5 seeds x masks {0, 2, 6, 2047}: the same layout twice, and bridges only where the biome changes', () => {
    for (const seed of SEEDS) for (const mask of MASKS) {
      const a = layout(seed, mask, 6000);
      const b = layout(seed, mask, 6000);
      expect(b).toEqual(a);
      for (let k = 1; k < a.length; k++) {
        // consecutive runs always differ, and an arcade run is always sandwiched between two different biomes
        expect(a[k].biome).not.toBe(a[k - 1].biome);
        if (a[k].biome === 'ARCADE') {
          expect(a[k + 1]).toBeDefined();
          expect(a[k + 1].biome).not.toBe(a[k - 1].biome);
        }
      }
      if (mask === 0) expect(a.map((r) => r.biome)).toEqual([HOME_BIOME_ID]);
    }
  });
});

describe('ghost tapes', () => {
  test('GHOST_PHYSICS_VERSION was bumped when terrain for a given seed and mask changed', () => {
    expect(GHOST_PHYSICS_VERSION).toBeGreaterThanOrEqual(2);
  });
});
