/**
 * Marvin decision 3 (audit ACH-3 / ACH-6): a biome is ENCOUNTERED when the sled actually reaches one of its
 * sectors, and COMPLETED when the sled rides one of its sectors from start to end without its run-ending
 * crash inside it. Pure detection lives in src/systems/BiomeDiscovery.js; these tests pin it against the
 * real generator's `biomeForSector`, so detection and the drawn terrain can never disagree. Debutmont is the base
 * biome (#65): encountered from sector 0 at any mask; arcade bridges are never recorded.
 */
import fs from 'fs';
import path from 'path';
import {
  BIOME_IDS, sectorOfX, detectBiomeVisits, sanitizeBiomeProgress, mergeBiomeVisits,
} from '../../src/systems/BiomeDiscovery.js';
import { biomeForSector, sectorHasBridge, arcadeBridgeLengthM, HOME_BIOME_ID, SECTOR_M, BASE_SECTORS } from '../../src/systems/TerrainGenerator.js';
import { loadContent } from './_helpers.js';

const CONTENT = loadContent();
const DEFS = Object.values(CONTENT.biomes);
const PPM = 20;
const SECTOR_PX = SECTOR_M * PPM;
const LEVELS = JSON.parse(fs.readFileSync(path.resolve('src/data/progression/levels.json'), 'utf8'));

/** First seed whose 0-based sector 2 is `id` at mask `bit`, searched deterministically. */
function seedWithSector2(id, bit, sector = BASE_SECTORS) {
  for (let i = 0; i < 500; i++) {
    const seed = `d3-${id}-${i}`;
    if (biomeForSector(seed, sector, bit, DEFS) === id) return seed;
  }
  throw new Error(`no seed puts ${id} at sector ${sector}`);
}

describe('BIOME_IDS: the known biome id list', () => {
  test('is exactly the shipped biome JSON ids, in the level table biomeOrder', () => {
    const shipped = fs.readdirSync(path.resolve('src/data/biomes')).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.resolve('src/data/biomes', f), 'utf8')).id).sort();
    expect([...BIOME_IDS].sort()).toEqual(shipped);
    expect([...BIOME_IDS]).toEqual(LEVELS.biomeOrder);
  });
});

describe('sectorOfX: the same 0-based sector rule as TerrainGenerator._sectorOf', () => {
  test('boundaries at every SECTOR_M metres', () => {
    expect(sectorOfX(0, PPM)).toBe(0);
    expect(sectorOfX(SECTOR_PX - 1, PPM)).toBe(0);
    expect(sectorOfX(SECTOR_PX, PPM)).toBe(1);
    expect(sectorOfX(2 * SECTOR_PX + 5, PPM)).toBe(2);
  });
});

describe('detectBiomeVisits', () => {
  // Sectors 0-1 are Debutmont (the home biome), sector 2 is Crystal Cavern, so a bridge opens sector 2 (#65).
  const seed = seedWithSector2('crystal-cavern', 16);
  const base = { seed, biomeMask: 16, biomeDefs: DEFS, pxPerMeter: PPM };
  const HOME = HOME_BIOME_ID;

  test('the home biome is encountered from sector 0, even at mask 0 (arcade is never recorded)', () => {
    const v0 = detectBiomeVisits({ ...base, biomeMask: 0, furthestX: 10, crashX: 10 });
    expect(v0).toEqual({ encountered: [HOME], completed: [] });
    const v1 = detectBiomeVisits({ ...base, biomeMask: 0, furthestX: 40 * SECTOR_PX, crashX: 40 * SECTOR_PX });
    expect(v1).toEqual({ encountered: [HOME], completed: [HOME] });
  });

  test('a run that never reaches sector 2 encounters only the home biome', () => {
    const v = detectBiomeVisits({ ...base, furthestX: 2 * SECTOR_PX - 1, crashX: 2 * SECTOR_PX - 1 });
    expect(v).toEqual({ encountered: [HOME], completed: [HOME] });
  });

  test('still inside the arcade bridge that opens the biome sector: the biome is not encountered yet', () => {
    expect(sectorHasBridge(seed, 2, 16, DEFS)).toBe(true);
    const inBridge = detectBiomeVisits({ ...base, furthestX: 2 * SECTOR_PX + 10, crashX: 2 * SECTOR_PX + 10 });
    expect(inBridge.encountered).toEqual([HOME]);
    const bridgeEnd = 2 * SECTOR_PX + arcadeBridgeLengthM(2 * SECTOR_M) * PPM;
    expect(detectBiomeVisits({ ...base, furthestX: bridgeEnd - 1, crashX: bridgeEnd - 1 }).encountered).toEqual([HOME]);
    expect(detectBiomeVisits({ ...base, furthestX: bridgeEnd + 1, crashX: bridgeEnd + 1 }).encountered).toEqual([HOME, 'crystal-cavern']);
  });

  test('past the bridge the biome is encountered; crashing inside it does not complete it', () => {
    const x = 2 * SECTOR_PX + SECTOR_PX / 2;
    const v = detectBiomeVisits({ ...base, furthestX: x, crashX: x });
    expect(v).toEqual({ encountered: [HOME, 'crystal-cavern'], completed: [HOME] });
  });

  test('riding the whole sector through to its end completes it', () => {
    const x = 3 * SECTOR_PX + 10;
    const v = detectBiomeVisits({ ...base, furthestX: x, crashX: x });
    expect(v.encountered).toContain('crystal-cavern');
    expect(v.completed).toContain('crystal-cavern');
  });

  test('a run-ending crash back inside an earlier biome sector voids that sector (respawned behind)', () => {
    // The sled reached sector 3 before, but its fatal crash is in sector 2.
    const v = detectBiomeVisits({ ...base, furthestX: 3 * SECTOR_PX + 10, crashX: 2 * SECTOR_PX + 50 });
    expect(v.encountered).toContain('crystal-cavern');
    expect(v.completed).not.toContain('crystal-cavern');
  });

  test('every sector up to the furthest x is checked, matching biomeForSector one by one', () => {
    const seed2 = 'd3-scan';
    const mask = 1 | 2 | 4 | 8;
    const furthestX = 20 * SECTOR_PX + SECTOR_PX / 2; // past any bridge into sector 20
    const v = detectBiomeVisits({ seed: seed2, biomeMask: mask, biomeDefs: DEFS, pxPerMeter: PPM, furthestX, crashX: furthestX });
    const enc = new Set();
    const comp = new Set();
    for (let s = 0; s <= 20; s++) {
      const id = biomeForSector(seed2, s, mask, DEFS);
      enc.add(id); if (s < 20) comp.add(id);
    }
    expect(new Set(v.encountered)).toEqual(enc);
    expect(new Set(v.completed)).toEqual(comp);
    expect(enc.size).toBeGreaterThan(1); // the scan is not vacuous
  });

  test('arcade (null) is never recorded, whatever the mask or distance', () => {
    for (const mask of [0, 2, 0x7ff]) {
      const v = detectBiomeVisits({ seed: 'd3-arcade', biomeMask: mask, biomeDefs: DEFS, pxPerMeter: PPM, furthestX: 60 * SECTOR_PX, crashX: 60 * SECTOR_PX });
      for (const id of [...v.encountered, ...v.completed]) expect(BIOME_IDS).toContain(id);
    }
  });

  test('output is in canonical BIOME_IDS order, deduplicated', () => {
    const v = detectBiomeVisits({ seed: 'd3-order', biomeMask: 0x7ff, biomeDefs: DEFS, pxPerMeter: PPM, furthestX: 60 * SECTOR_PX, crashX: 60 * SECTOR_PX });
    const order = (list) => list.map((id) => BIOME_IDS.indexOf(id));
    expect(order(v.encountered)).toEqual([...order(v.encountered)].sort((a, b) => a - b));
    expect(new Set(v.encountered).size).toBe(v.encountered.length);
    expect(v.completed.every((id) => v.encountered.includes(id))).toBe(true);
  });

  test('junk input degrades to empty rather than throwing', () => {
    expect(detectBiomeVisits()).toEqual({ encountered: [], completed: [] });
    expect(detectBiomeVisits({ seed: 'x', biomeMask: 1, biomeDefs: DEFS, furthestX: NaN })).toEqual({ encountered: [], completed: [] });
  });
});

describe('sanitizeBiomeProgress / mergeBiomeVisits', () => {
  test('keeps only known ids, dedupes, canonical order, completed is a subset of encountered', () => {
    const p = sanitizeBiomeProgress({ encountered: ['pyramid-peak', 'nope', 'debumont', 'debumont', 7], completed: ['vertigo-vents', 'bogus'] });
    expect(p).toEqual({ encountered: ['debumont', 'pyramid-peak', 'vertigo-vents'], completed: ['vertigo-vents'] });
  });

  test('anything that is not an object reads as empty sets', () => {
    for (const raw of [undefined, null, 'x', 3, []]) expect(sanitizeBiomeProgress(raw)).toEqual({ encountered: [], completed: [] });
  });

  test('merge is a union and never removes what was already recorded', () => {
    const a = { encountered: ['debumont'], completed: ['debumont'] };
    const m = mergeBiomeVisits(a, { encountered: ['pyramid-peak'], completed: [] });
    expect(m).toEqual({ encountered: ['debumont', 'pyramid-peak'], completed: ['debumont'] });
    expect(a).toEqual({ encountered: ['debumont'], completed: ['debumont'] }); // input untouched
  });
});
