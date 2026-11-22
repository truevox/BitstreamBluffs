/**
 * #65 presentation: the arcade bridge look model (systems/BiomeTransition.js) and the generator query it keys on
 * (TerrainGenerator.bridgeSpanAt). Pure, position-keyed, deterministic: no time, no state, no RNG.
 */
import fs from 'fs';
import {
  DISSOLVE_FRAC, REBUILD_FRAC, VEIL_CELL_PX, BAYER8, bridgeProgress, bridgeLook, veilCovers, hash01,
} from '../../src/systems/BiomeTransition.js';
import { HOME_BIOME_ID } from '../../src/systems/TerrainGenerator.js';
import { makeGen, readDir } from './_helpers.js';

const SPAN = { startX: 1000, endX: 2000, fromId: 'debutmont', toId: 'garbage-dump-glacier' };
const at = (t, enabled = true) => bridgeLook(SPAN, SPAN.startX + t * (SPAN.endX - SPAN.startX), null, enabled);

describe('bridge look: dissolve, arcade, reconstruct', () => {
  test('the shares are a quarter each', () => {
    expect(DISSOLVE_FRAC).toBe(0.25);
    expect(REBUILD_FRAC).toBe(0.25);
  });

  test('progress is 0 at the start and 1 at the end', () => {
    expect(bridgeProgress(SPAN, 1000)).toBe(0);
    expect(bridgeProgress(SPAN, 2000)).toBe(1);
    expect(bridgeProgress(SPAN, 1500)).toBe(0.5);
    expect(bridgeProgress({ startX: 5, endX: 5 }, 9)).toBe(0); // a degenerate span never divides by zero
  });

  test('off a bridge there is no veil and the look is the generator\'s biome', () => {
    expect(bridgeLook(null, 123, 'debutmont', true)).toEqual({ veil: 0, lookId: 'debutmont', t: -1 });
    expect(bridgeLook(null, 123, 'debutmont', false)).toEqual({ veil: 0, lookId: 'debutmont', t: -1 });
  });

  test('the first quarter dissolves the outgoing biome: veil 0 -> 1, outgoing look', () => {
    expect(at(0)).toMatchObject({ veil: 0, lookId: 'debutmont' });
    expect(at(0.125)).toMatchObject({ veil: 0.5, lookId: 'debutmont' });
    expect(at(0.24).veil).toBeCloseTo(0.96, 6);
    expect(at(0.24).lookId).toBe('debutmont');
  });

  test('the middle is pure arcade: full veil, no biome look', () => {
    for (const t of [0.25, 0.4, 0.5, 0.6, 0.75]) expect(at(t)).toMatchObject({ veil: 1, lookId: null });
  });

  test('the last quarter reconstructs the incoming biome: veil 1 -> 0, incoming look', () => {
    expect(at(0.76).lookId).toBe('garbage-dump-glacier');
    expect(at(0.875)).toMatchObject({ veil: 0.5, lookId: 'garbage-dump-glacier' });
    expect(at(1)).toMatchObject({ veil: 0, lookId: 'garbage-dump-glacier' });
  });

  test('the look only changes while the veil is full (no pop shows)', () => {
    let prev = at(0);
    for (let i = 1; i <= 1000; i++) {
      const cur = at(i / 1000);
      // sampled every 0.1 % of the bridge: the frame before a flip is within a hair of full (>= 63/64 of the blocks)
      if (cur.lookId !== prev.lookId) { expect(prev.veil).toBeGreaterThanOrEqual(63 / 64); expect(cur.veil).toBeGreaterThanOrEqual(63 / 64); }
      prev = cur;
    }
  });

  test('the veil never decreases through the dissolve and never increases through the reconstruct', () => {
    let prev = at(0).veil;
    for (let i = 1; i <= 250; i++) { const v = at(i / 1000).veil; expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    prev = at(0.75).veil;
    for (let i = 751; i <= 1000; i++) { const v = at(i / 1000).veil; expect(v).toBeLessThanOrEqual(prev); prev = v; }
  });

  test('reduced motion / effects off is the hard cut: the veil is simply on, the look is the generator\'s', () => {
    for (const t of [0, 0.1, 0.5, 0.9, 1]) expect(at(t, false)).toMatchObject({ veil: 1, lookId: null });
    expect(bridgeLook(SPAN, 1100, null, false).lookId).toBeNull();
  });

  test('pure: the same inputs give the same answer in any order (no time, no accumulated state)', () => {
    const ts = [0.9, 0.1, 0.5, 0.3, 0.8, 0.1, 0.9];
    const first = ts.map((t) => at(t));
    const again = [...ts].reverse().map((t) => at(t)).reverse();
    expect(again).toEqual(first);
  });
});

describe('veil blocks: ordered dither', () => {
  test('BAYER8 is a permutation of 0..63', () => {
    expect(BAYER8.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });

  test('the block size divides the 480 px width', () => {
    expect(480 % VEIL_CELL_PX).toBe(0);
  });

  test('coverage 0 covers nothing, 1 covers everything, and each step adds blocks without removing any', () => {
    const covered = (c) => { const s = new Set(); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (veilCovers(x, y, c)) s.add(`${x},${y}`); return s; };
    expect(covered(0).size).toBe(0);
    expect(covered(1).size).toBe(64);
    let prev = covered(0);
    for (let k = 1; k <= 64; k++) {
      const cur = covered(k / 64);
      for (const p of prev) expect(cur.has(p)).toBe(true);
      expect(cur.size).toBe(k);
      prev = cur;
    }
  });

  test('hash01 is in [0, 1) and platform-stable', () => {
    for (let i = 0; i < 500; i++) { const h = hash01(i, 77); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(1); }
    expect(hash01(1, 2)).toBe(hash01(1, 2));
    expect(hash01(1, 2)).not.toBe(hash01(2, 1));
  });
});

describe('TerrainGenerator.bridgeSpanAt agrees with the terrain', () => {
  const ALL = readDir('biomes').reduce((m, d) => m | d.bit, 0);
  const cases = [['alpha', 2], ['alpha', ALL], ['bitstream-bluffs', ALL], ['shots65-d', 2], ['42', 6]];

  test.each(cases)('seed %s mask %i: spans cover exactly the arcade stretches, with the right neighbours', (seed, mask) => {
    const gen = makeGen(seed, { biomeMask: mask });
    const limit = 5200 * 20;
    let bridges = 0;
    for (let x = 0; x < limit; x += 40) {
      const id = gen.biomeAtX(x);
      const span = gen.bridgeSpanAt(x);
      if (id !== null) { expect(span).toBeNull(); continue; }
      expect(span).not.toBeNull();
      expect(span.startX).toBeLessThanOrEqual(x);
      expect(span.endX).toBeGreaterThan(x);
      // inside: arcade all the way; just outside: the neighbours it reports
      expect(gen.biomeAtX(span.startX)).toBeNull();
      expect(gen.biomeAtX(span.endX - 1)).toBeNull();
      if (span.startX > 0) expect(gen.biomeAtX(span.startX - 1)).toBe(span.fromId);
      expect(gen.biomeAtX(span.endX)).toBe(span.toId);
      expect(span.fromId).not.toBe(span.toId);
      expect(span.fromId).not.toBeNull();
      expect(span.toId).not.toBeNull();
      bridges++;
    }
    if (mask === 2 || mask === ALL) expect(bridges).toBeGreaterThan(0);
  });

  test('a mask-0 run has no bridges at all', () => {
    const gen = makeGen('alpha', { biomeMask: 0 });
    for (let x = 0; x < 60000; x += 200) expect(gen.bridgeSpanAt(x)).toBeNull();
  });

  test('a generator with no biome content has no bridges (null is not a bridge there)', () => {
    const gen = makeGen('alpha', { biomeMask: 2, biomeDefs: [] });
    expect(gen.bridgeSpanAt(5000)).toBeNull();
  });

  test('every span is a whole run of chunks and starts a biome change: from the home biome or another', () => {
    const gen = makeGen('shots65-d', { biomeMask: 2 });
    const span = gen.bridgeSpanAt(1100 * 20);
    expect(span).not.toBeNull();
    expect([HOME_BIOME_ID, 'garbage-dump-glacier']).toContain(span.fromId);
    expect(span.endX - span.startX).toBeGreaterThan(40 * 20);
    expect(span.endX - span.startX).toBeLessThan(200 * 20);
  });
});

describe('purity of the presentation modules', () => {
  const read = (p) => fs.readFileSync(p, 'utf8');
  test.each(['src/systems/BiomeTransition.js', 'src/entities/BiomeFx.js'])('%s uses no wall clock, no Math.random and no gameplay stream', (file) => {
    const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/Date\.now|new Date|performance\.now/);
    expect(src).not.toMatch(/RunRandom|from '.*\/Rng\.js'|PhysicsTuner|ScoreManager|TerrainGenerator/);
  });
});
