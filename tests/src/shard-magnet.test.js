// Shard Magnet (owner request 2026-11-20): pull, upgrade softcap, placement outside the terrain output.
import fs from 'fs';
import { magnetStrength, pullStep, magnetSpawn } from '../../src/systems/ShardMagnet.js';
import { upgradeEffects, upgradeBenefit, UPGRADE_CATALOG } from '../../src/systems/PermanentUpgrades.js';
import { DRAFT_UPGRADES, validDraftRanks, sanitizeDraftRanks, draftActiveRanks } from '../../src/systems/DailyDraft.js';

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

  test('strength comes from the MAGNET PULL upgrade with diminishing returns to a soft cap, not from time', () => {
    const r0 = magnetStrength(def.effect, upgradeEffects({}).magnetMul);
    const r10 = magnetStrength(def.effect, upgradeEffects({ magnet: 10 }).magnetMul);
    const rBig = magnetStrength(def.effect, upgradeEffects({ magnet: 1e6 }).magnetMul);
    expect(r0.radius).toBe(def.effect.pullRadiusPx);
    expect(r10.radius).toBeGreaterThan(r0.radius);
    expect(rBig.radius).toBeLessThan(def.effect.pullRadiusPx * 2.5);
    expect(upgradeBenefit('magnet', 3) - upgradeBenefit('magnet', 2)).toBeLessThan(upgradeBenefit('magnet', 2) - upgradeBenefit('magnet', 1));
    expect(fs.readFileSync('src/systems/ShardMagnet.js', 'utf8')).not.toMatch(/msLeft|elapsed|durationMs \*/);
  });

  test('the Daily Draft catalogue is unchanged (seven upgrades); MAGNET PULL never enters it', () => {
    expect(UPGRADE_CATALOG.map((u) => u.id)).toContain('magnet');
    expect(DRAFT_UPGRADES.map((u) => u.id)).not.toContain('magnet');
    expect(DRAFT_UPGRADES).toHaveLength(7);
    expect(validDraftRanks({ magnet: 3 })).toBe(false);
    expect(validDraftRanks({ magnet: 0, canopy: 2 })).toBe(true);
    expect(sanitizeDraftRanks({ magnet: 9 }).magnet).toBe(0);
    expect(draftActiveRanks({ magnet: 9, hop: 1 })).toEqual({ hop: 1 });
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
