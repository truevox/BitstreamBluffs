/**
 * E7 (Marvin 2026-11-14, audit TERRAIN-1): a chunk that hosts a biome zone gets NO chunk-template zone, so a
 * biome mechanic can never be multiplied into its opposite (stickyPatch x highBandwidth made sticky ground
 * slippery; thermalUpdraft x compression made an updraft add gravity). Mask 0 is untouched (golden test).
 */
import { makeGen, loadContent, readDir } from './_helpers.js';
import { PhysicsTuner } from '../../src/systems/PhysicsTuner.js';

const BIOMES = readDir('biomes');
const MODS = loadContent().terrainMods;
const ALL_MASK = BIOMES.reduce((m, b) => m | b.bit, 0);
const BIOME_MODS = new Set(BIOMES.map((b) => b.mod));

describe('TERRAIN-1: a biome zone keeps its mechanic where it overlaps a chunk-template zone', () => {
  // Copied from audit/terrain tests/src/audit-terrain.test.js (red at e0ae90f / 8db8dee).
  test('TERRAIN-1: inside every biome zone the effective physics moves in the biome mechanic\'s direction', () => {
    const t = new PhysicsTuner();
    const base = t.getEffective({});
    const keys = ['gravityPxS2', 'groundResist'];
    const sign = (v) => (Math.abs(v) < 1e-9 ? 0 : Math.sign(v));
    const inverted = new Set();
    for (const seed of ['alpha', 'beta', 'gamma']) {
      const gen = makeGen(seed, { biomeMask: ALL_MASK });
      for (let i = 0; i < 300; i++) {
        const c = gen.getChunk(i);
        if (!c.biome) continue;
        const bmod = MODS[BIOMES.find((b) => b.id === c.biome).mod];
        const alone = t.getEffective({ zones: [bmod] });
        for (const z of c.zones) {
          if (z.modId !== bmod.id) continue;
          for (let x = z.x0; x <= z.x1; x += 16) {
            const here = t.getEffective({ zones: gen.getZonesAt(x).map((q) => MODS[q.modId]) });
            for (const k of keys) {
              const want = sign(alone[k] - base[k]);
              if (want !== 0 && sign(here[k] - base[k]) !== want) inverted.add(`${bmod.id}:${k}`);
            }
          }
        }
      }
    }
    expect([...inverted].sort()).toEqual([]);
  });
});

describe('E7: no template zone in a chunk that hosts a biome zone', () => {
  test('every chunk with a biome zone carries exactly that one zone; biome chunks without one may keep a template zone', () => {
    let hosts = 0;
    let templateOnly = 0;
    for (const seed of ['alpha', 'beta', 'gamma']) {
      const gen = makeGen(seed, { biomeMask: ALL_MASK });
      for (let i = 0; i < 300; i++) {
        const c = gen.getChunk(i);
        const biomeZones = c.zones.filter((z) => BIOME_MODS.has(z.modId));
        if (biomeZones.length) {
          hosts++;
          expect(c.zones.map((z) => z.modId)).toEqual([biomeZones[0].modId]);
        } else if (c.biome && c.zones.length) templateOnly++;
      }
    }
    expect(hosts).toBeGreaterThan(50);
    // the rule removes template zones only where a biome zone landed (25 % of biome chunks place none)
    expect(templateOnly).toBeGreaterThan(0);
  });
});
