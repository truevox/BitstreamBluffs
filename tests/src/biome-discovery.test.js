/**
 * Marvin decision 3 (audit ACH-3 / ACH-6): a biome is ENCOUNTERED when the sled actually reaches one of its
 * sectors, and COMPLETED when the sled rides one of its sectors from start to end without its run-ending
 * crash inside it. Pure detection lives in src/systems/BiomeDiscovery.js; these tests pin it against the
 * real generator's `biomeForSector`, so detection and the drawn terrain can never disagree.
 */
import fs from 'fs';
import path from 'path';
import {
  BIOME_IDS, sectorOfX, detectBiomeVisits, sanitizeBiomeProgress, mergeBiomeVisits,
} from '../../src/systems/BiomeDiscovery.js';
import { biomeForSector, SECTOR_M, BASE_SECTORS } from '../../src/systems/TerrainGenerator.js';
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
  const seed = seedWithSector2('debutmont', 1);
  const base = { seed, biomeMask: 1, biomeDefs: DEFS, pxPerMeter: PPM };

  test('a run that never reaches sector 2 encounters nothing', () => {
    const v = detectBiomeVisits({ ...base, furthestX: 2 * SECTOR_PX - 1, crashX: 2 * SECTOR_PX - 1 });
    expect(v).toEqual({ encountered: [], completed: [] });
  });

  test('reaching the biome sector encounters it; crashing inside it does not complete it', () => {
    const v = detectBiomeVisits({ ...base, furthestX: 2 * SECTOR_PX + 10, crashX: 2 * SECTOR_PX + 10 });
    expect(v).toEqual({ encountered: ['debutmont'], completed: [] });
  });

  test('riding the whole sector through to its end completes it', () => {
    const x = 3 * SECTOR_PX + 10;
    const v = detectBiomeVisits({ ...base, furthestX: x, crashX: x });
    expect(v.encountered).toContain('debutmont');
    expect(v.completed).toContain('debutmont');
  });

  test('a run-ending crash back inside an earlier biome sector voids that sector (respawned behind)', () => {
    // The sled reached sector 3 before, but its fatal crash is in sector 2.
    const v = detectBiomeVisits({ ...base, furthestX: 3 * SECTOR_PX + 10, crashX: 2 * SECTOR_PX + 50 });
    expect(v.encountered).toContain('debutmont');
    expect(v.completed).not.toContain('debutmont');
  });

  test('every sector up to the furthest x is checked, matching biomeForSector one by one', () => {
    const seed2 = 'd3-scan';
    const mask = 1 | 2 | 4 | 8;
    const furthestX = 20 * SECTOR_PX + 3;
    const v = detectBiomeVisits({ seed: seed2, biomeMask: mask, biomeDefs: DEFS, pxPerMeter: PPM, furthestX, crashX: furthestX });
    const enc = new Set();
    const comp = new Set();
    for (let s = 0; s <= 20; s++) {
      const id = biomeForSector(seed2, s, mask, DEFS);
      if (id) { enc.add(id); if (s < 20) comp.add(id); }
    }
    expect(new Set(v.encountered)).toEqual(enc);
    expect(new Set(v.completed)).toEqual(comp);
    expect(enc.size).toBeGreaterThan(1); // the scan is not vacuous
  });

  test('mask 0 never encounters anything', () => {
    const v = detectBiomeVisits({ ...base, biomeMask: 0, furthestX: 40 * SECTOR_PX, crashX: 40 * SECTOR_PX });
    expect(v).toEqual({ encountered: [], completed: [] });
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
    const p = sanitizeBiomeProgress({ encountered: ['pyramid-peak', 'nope', 'debutmont', 'debutmont', 7], completed: ['vertigo-vents', 'bogus'] });
    expect(p).toEqual({ encountered: ['debutmont', 'pyramid-peak', 'vertigo-vents'], completed: ['vertigo-vents'] });
  });

  test('anything that is not an object reads as empty sets', () => {
    for (const raw of [undefined, null, 'x', 3, []]) expect(sanitizeBiomeProgress(raw)).toEqual({ encountered: [], completed: [] });
  });

  test('merge is a union and never removes what was already recorded', () => {
    const a = { encountered: ['debutmont'], completed: ['debutmont'] };
    const m = mergeBiomeVisits(a, { encountered: ['pyramid-peak'], completed: [] });
    expect(m).toEqual({ encountered: ['debutmont', 'pyramid-peak'], completed: ['debutmont'] });
    expect(a).toEqual({ encountered: ['debutmont'], completed: ['debutmont'] }); // input untouched
  });
});
