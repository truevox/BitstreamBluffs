// Shard Magnet (owner request 2026-11-20): pull, upgrade softcap, placement outside the terrain output.
import fs from 'fs';
import { magnetStrength, pullStep, magnetSpawn, magnetsDropFor, MAGNET_MIN_SYNC_LEVEL } from '../../src/systems/ShardMagnet.js';
import { upgradeEffects, upgradeBenefit, UPGRADE_CATALOG } from '../../src/systems/PermanentUpgrades.js';
import { DRAFT_UPGRADES, DRAFT_RULES_VERSION, validDraftRanks, draftActiveRanks } from '../../src/systems/DailyDraft.js';

const def = JSON.parse(fs.readFileSync('src/data/powerups/shard-magnet.json', 'utf8'));
const chunk = (index, extra = {}) => ({ index, startX: index * 1600, endX: index * 1600 + 1600, hazards: [], gaps: [], powerups: [], ...extra });

describe('shard magnet', () => {
  test('pull: shards inside the radius move toward the rider, faster near the centre, never overshoot', () => {
    expect(pullStep(300, 0, 0, 0, 96, 360, 16)).toBeNull();
    const rim = pullStep(90, 0, 0, 0, 96, 360, 16), near = pullStep(20, 0, 0, 0, 96, 360, 16);
    expect(rim.x).toBeLessThan(90);
    expect(20 - near.x).toBeGreaterThan(90 - rim.x);
    expect(pullStep(2, 0, 0, 0, 96, 360, 1000)).toEqual({ x: 0, y: 0 });
  });

  test('Magnitude, Measure and Myriad: unlimited ranks, diminishing returns, soft caps; never time on screen', () => {
    const fx = (r) => upgradeEffects(r);
    expect(fx({}).magnetMul).toBe(1);
    expect(fx({}).magnetDurationMul).toBe(1);
    expect(fx({}).magnetSpawnMul).toBe(1);
    expect(magnetStrength(def.effect, fx({ magnetMagnitude: 10 }).magnetMul).radius).toBeGreaterThan(def.effect.pullRadiusPx);
    expect(magnetStrength(def.effect, fx({ magnetMagnitude: 1e6 }).magnetMul).radius).toBeLessThan(def.effect.pullRadiusPx * 2.5);
    expect(fx({ magnetMeasure: 1e6 }).magnetDurationMul).toBeLessThan(2);
    expect(fx({ magnetMyriad: 1e6 }).magnetSpawnMul).toBeLessThan(2);
    for (const id of ['magnetMagnitude', 'magnetMeasure', 'magnetMyriad'])
      expect(upgradeBenefit(id, 3) - upgradeBenefit(id, 2)).toBeLessThan(upgradeBenefit(id, 2) - upgradeBenefit(id, 1));
    expect(fs.readFileSync('src/systems/ShardMagnet.js', 'utf8')).not.toMatch(/msLeft|elapsed|durationMs \*/);
  });

  test('all three magnet upgrades are in the Daily Draft (rules v2)', () => {
    expect(DRAFT_RULES_VERSION).toBe(2);
    expect(DRAFT_UPGRADES.map((u) => u.id)).toEqual(UPGRADE_CATALOG.map((u) => u.id));
    expect(DRAFT_UPGRADES.map((u) => u.id)).toEqual(expect.arrayContaining(['magnetMagnitude', 'magnetMeasure', 'magnetMyriad']));
    expect(validDraftRanks({ magnetMagnitude: 3, magnetMyriad: 1 })).toBe(true);
    expect(draftActiveRanks({ magnetMeasure: 2 })).toEqual({ magnetMeasure: 2 });
  });

  test('magnets drop from Sync Level 5 in ordinary runs, and on every Daily regardless of level', () => {
    expect(MAGNET_MIN_SYNC_LEVEL).toBe(5);
    expect(magnetsDropFor({ level: 4 })).toBe(false);
    expect(magnetsDropFor({ level: 5 })).toBe(true);
    expect(magnetsDropFor({ level: 1, daily: true })).toBe(true);
    expect(magnetsDropFor({})).toBe(false);
  });

  test('MYRIAD MAGNETS raises how many chunks get a magnet, deterministically', () => {
    const flat = () => 500;
    const count = (mul) => Array.from({ length: 80 }, (_, i) => magnetSpawn('MYR', chunk(i + 1), def, flat, 30, mul)).filter(Boolean).length;
    expect(count(2)).toBeGreaterThan(count(1));
    expect(count(2)).toBe(count(2));
  });

  test('placement: deterministic per seed and chunk, clear of hazards and pickups, and some chunks get one', () => {
    const flat = () => 500;
    const a = [], b = [];
    for (let i = 1; i <= 60; i++) { a.push(magnetSpawn('SEED', chunk(i), def, flat, 30)); b.push(magnetSpawn('SEED', chunk(i), def, flat, 30)); }
    expect(a).toEqual(b);
    const placed = a.filter(Boolean);
    expect(placed.length).toBeGreaterThan(3);
    expect(placed.length).toBeLessThan(40);
    for (const p of placed) expect(p.y).toBeLessThan(500);
    const at = placed[0], idx = a.indexOf(at) + 1;
    expect(magnetSpawn('SEED', chunk(idx, { hazards: [{ x: at.x + 30 }] }), def, flat, 30)).toBeNull();
    expect(magnetSpawn('SEED', chunk(idx, { powerups: [{ x: at.x - 60 }] }), def, flat, 30)).toBeNull();
    expect(magnetSpawn('OTHER', chunk(idx), def, flat, 30)).not.toEqual(at);
  });

  test('terrain output stays bit-identical: magnets are excluded from the generator pool', () => {
    expect(def.placement).toBe('own');
    expect(fs.readFileSync('src/systems/TerrainGenerator.js', 'utf8')).toMatch(/allPowerups\.filter\(\(p\) => !p\.biome && p\.placement !== 'own'\)/);
  });
});
