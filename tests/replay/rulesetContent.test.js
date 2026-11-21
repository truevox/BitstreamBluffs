// Issue #123 / Contract 7.1: the recursive non-sim denylist for content.* and tables.*, proven against the real data and
// the real TerrainGenerator.
import { utf8Encode } from '../../src/systems/replay/canonicalJson.js';
import { sha256Hex } from '../../src/systems/replay/canonicalSha256.js';
import { CONTENT_GROUPS, EXTRA_NON_SIM_KEYS, NON_SIM_KEYS, RULESET_SOURCES, countKeys, keyPaths, omitKeysFor, projectData } from '../../src/systems/replay/rulesetRegistry.js';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator.js';
import { assembleFromDisk, loadContentFromDisk, repoRoot } from '../../tools/ruleset/lib.mjs';
import { BOOST_DEFS } from '../../src/systems/Boosts.js';
import { UPGRADE_CATALOG } from '../../src/systems/PermanentUpgrades.js';
import { DailyPatch } from '../../src/systems/DailyPatch.js';
import { KODIAK_DEFS } from '../../src/systems/Kodiaks.js';

const root = repoRoot();
const full = loadContentFromDisk(root);
const { doc } = assembleFromDisk(root);

describe('projectData', () => {
  test('removes denylisted keys at any depth, including inside arrays, and never mutates the input', () => {
    const input = { name: 'x', a: { name: 'y', keep: 1, list: [{ name: 'z', keep: 2 }] } };
    const copy = JSON.parse(JSON.stringify(input));
    expect(projectData(input, ['name'])).toEqual({ a: { keep: 1, list: [{ keep: 2 }] } });
    expect(input).toEqual(copy);
  });
  test('rejects functions, undefined, NaN and class instances', () => {
    for (const bad of [() => 1, undefined, NaN, new Map(), Symbol('s')]) expect(() => projectData({ v: bad })).toThrow();
  });
});

describe('denylist entries are real (none dead) and everything else stays included', () => {
  const tableSources = {
    dailyRules: DailyPatch.RULES,
    boostDefs: BOOST_DEFS,
    upgradeCatalog: UPGRADE_CATALOG,
    kodiakDefs: KODIAK_DEFS,
  };
  test('each contract key matches at least one real key somewhere in content or tables', () => {
    const all = { ...full, ...tableSources };
    for (const key of Object.keys(NON_SIM_KEYS)) {
      const n = Object.values(all).reduce((s, v) => s + countKeys(v, [key])[key], 0);
      expect([key, n > 0]).toEqual([key, true]);
    }
  });
  test('each group-scoped extra key matches at least one real key in its group', () => {
    for (const [group, keys] of Object.entries(EXTRA_NON_SIM_KEYS)) {
      const data = full[group] || tableSources[group];
      for (const k of Object.keys(keys)) expect([group, k, countKeys(data, [k])[k] > 0]).toEqual([group, k, true]);
    }
  });
  test('no denylisted key survives anywhere in the document', () => {
    const bad = new Set(Object.keys(NON_SIM_KEYS));
    for (const g of CONTENT_GROUPS) for (const k of Object.keys(EXTRA_NON_SIM_KEYS[g] || {})) bad.add(k);
    for (const k of Object.keys(EXTRA_NON_SIM_KEYS.kodiakDefs)) bad.add(k);
    const surviving = keyPaths({ content: doc.content, tables: doc.tables, kodiak: doc.constants.kodiak }).filter((p) => bad.has(p.split('.').pop().replace('[]', '')));
    expect(surviving).toEqual([]);
  });
  test('tables keep exactly the causal columns (curveK/cap stay; label/price columns go)', () => {
    expect(keyPaths(doc.tables.upgradeCatalog)).toEqual(['[].cap', '[].curveK', '[].id']);
    expect(keyPaths(doc.tables.dailyRules)).toEqual(expect.arrayContaining(['[].id']));
    expect(keyPaths(doc.tables.dailyRules).some((p) => /name|description/.test(p))).toBe(false);
    expect(Object.keys(doc.tables.boostDefs.headStart).sort()).toEqual(['id', 'openingFadeMs', 'openingMs', 'openingSpeedMul', 'speedFactor']);
    expect(Object.keys(doc.tables.boostDefs.errorCorrection).sort()).toEqual(['id', 'shieldCharges']);
    expect(Object.keys(doc.constants.kodiak.KODIAK_DEFS.blackIce).sort()).toEqual(['from', 'id', 'kind', 'onHit']);
  });
  test('inventory of included content key paths (a new key shows up here: classify it causal, or add a denylist entry)', () => {
    const inv = Object.fromEntries(CONTENT_GROUPS.map((g) => [g, keyPaths(Object.values(doc.content[g]))]));
    expect(inv).toEqual({
      chunks: [
        '[].bridge.bounceBoost',
        '[].bridge.gapPx',
        '[].controlPoints[].x',
        '[].controlPoints[].y',
        '[].id',
        '[].kind',
        '[].lengthPx',
        '[].minDistanceM',
        '[].modIds[]',
        '[].noise.amplitudePx',
        '[].noise.frequency',
        '[].noise.meanSlopeDeg',
        '[].noise.octaves',
        '[].tags[]',
        '[].weight',
      ],
      hazards: [
        '[].biome',
        '[].id',
        '[].minDistanceM',
        '[].motion.dir',
        '[].motion.kind',
        '[].motion.openMs',
        '[].motion.periodMs',
        '[].motion.rangePx',
        '[].motion.speedPxS',
        '[].onHit.durationMs',
        '[].onHit.effect',
        '[].onHit.impulsePxS[]',
        '[].onHit.speedFactor',
        '[].onHit.visibility',
        '[].placement',
        '[].size.h',
        '[].size.w',
        '[].spawn.baseChance',
        '[].weight',
      ],
      powerups: [
        '[].biome',
        '[].effect.bounceMul',
        '[].effect.charges',
        '[].effect.durationMs',
        '[].effect.effects[]',
        '[].effect.frictionMul',
        '[].effect.hazards[]',
        '[].effect.kind',
        '[].effect.landingToleranceDeg',
        '[].effect.mods[]',
        '[].effect.pullPxS',
        '[].effect.pullRadiusPx',
        '[].effect.speedFactor',
        '[].effect.timeScale',
        '[].id',
        '[].placement',
        '[].radius',
        '[].spawn.baseChance',
        '[].spawn.distanceDecayM',
      ],
      terrainMods: [
        '[].direction',
        '[].id',
        '[].launch.cooldownMs',
        '[].launch.velocityPxS',
        '[].lengthPx[]',
        '[].minDistanceM',
        '[].physics.beltDrivePxS2',
        '[].physics.bounceMul',
        '[].physics.frictionMul',
        '[].physics.gravityMul',
        '[].physics.landingRebound',
        '[].physics.pushForceMul',
        '[].physics.speedMul',
        '[].physics.steerMul',
        '[].scoreMul',
        '[].terrainSwell.amplitudePx',
        '[].terrainSwell.periodPx',
        '[].terrainSwell.taperPx',
        '[].weight',
      ],
      biomes: [
        '[].bit',
        '[].chunks[]',
        '[].id',
        '[].mod',
      ],
    });
  });
  test('registry omit lists are derived from the same sets', () => {
    const omitted = RULESET_SOURCES.flatMap((s) => [...Object.values(s.exports), ...Object.values(s.statics || {}).flatMap((m) => Object.values(m))]).filter((d) => d.omit);
    for (const d of omitted) expect(d.omit.every((k) => k in NON_SIM_KEYS || k in EXTRA_NON_SIM_KEYS.kodiakDefs)).toBe(true);
    expect(omitKeysFor('hazards')).toEqual(expect.arrayContaining(['shapeKey', 'colorKey', 'name']));
  });
});

describe('the denylisted content keys really are non-causal: terrain is identical from full JSON and from the projection', () => {
  const gen = (c, seed, biomeMask, n) => {
    const g = new TerrainGenerator({
      seed,
      chunkDefs: Object.values(c.chunks),
      hazardDefs: c.hazards,
      powerupDefs: c.powerups,
      modDefs: c.terrainMods,
      biomeDefs: Object.values(c.biomes),
      biomeMask,
    });
    const chunks = [];
    for (let i = 0; i < n; i++) chunks.push(g.getChunk(i));
    return sha256Hex(utf8Encode(JSON.stringify(chunks)));
  };
  const cases = [
    ['alpha', 0], ['alpha', 2047], ['daily-2026-11-21', 2047], ['seed 42', 1 | 16 | 1024], ['bravo', 64 | 128 | 512],
  ];
  test.each(cases)('seed %j, biomeMask %i', (seed, mask) => {
    expect(gen(doc.content, seed, mask, 160)).toBe(gen(full, seed, mask, 160));
  });
  test('control: a causal edit (hazard size) does change the terrain, so the comparison is sensitive', () => {
    const edited = JSON.parse(JSON.stringify(doc.content));
    edited.hazards.packetSpike.size.w += 7;
    edited.hazards.packetSpike.weight += 1;
    expect(gen(edited, 'alpha', 0, 160)).not.toBe(gen(doc.content, 'alpha', 0, 160));
  });
});
