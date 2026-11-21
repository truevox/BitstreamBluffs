// Issue #123 / Contract 7.1: the recursive non-sim denylist for content.* and tables.*, proven against the real data and
// the real TerrainGenerator.
import { utf8Encode } from '../../src/systems/replay/canonicalJson.js';
import { sha256Hex } from '../../src/systems/replay/canonicalSha256.js';
import { CONTENT_GROUPS, EXTRA_NON_SIM_KEYS, NON_SIM_KEYS, RULESET_SOURCES, countKeys, keyPaths, omitKeysFor, projectData } from '../../src/systems/replay/rulesetRegistry.js';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator.js';
import { DEFAULT_SOURCES, assembleRuleset, rulesetIdOf } from '../../src/systems/replay/ruleset.js';
import { assembleFromDisk, loadContentFromDisk, readEngineVersions, repoRoot } from '../../tools/ruleset/lib.mjs';
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
  test('every scoped non-sim key matches at least one real key in its own scope (none dead)', () => {
    const scopes = { ...Object.fromEntries(CONTENT_GROUPS.map((g) => [g, full[g]])), ...tableSources };
    for (const table of [NON_SIM_KEYS, EXTRA_NON_SIM_KEYS]) {
      for (const [scope, keys] of Object.entries(table)) {
        for (const k of Object.keys(keys)) expect([scope, k, countKeys(scopes[scope], [k])[k] > 0]).toEqual([scope, k, true]);
      }
    }
  });
  test('economy keys are NOT denylisted anywhere: basePrice/priceScale feed Draft legality (draftCost)', () => {
    for (const table of [NON_SIM_KEYS, EXTRA_NON_SIM_KEYS]) {
      for (const keys of Object.values(table)) expect(Object.keys(keys)).not.toEqual(expect.arrayContaining(['basePrice']));
    }
    expect(keyPaths(doc.tables.upgradeCatalog)).toEqual(expect.arrayContaining(['[].basePrice', '[].priceScale']));
  });
  test('scoping: a denylisted name in one scope cannot hide the same key in another', () => {
    expect(omitKeysFor('upgradeCatalog')).not.toContain('name');
    expect(omitKeysFor('chunks')).toEqual([]);
    expect(omitKeysFor('powerups')).not.toContain('name');
  });
  test('no denylisted key survives in its own scope of the document', () => {
    const scopeData = { ...Object.fromEntries(CONTENT_GROUPS.map((g) => [g, doc.content[g]])), dailyRules: doc.tables.dailyRules, boostDefs: doc.tables.boostDefs, upgradeCatalog: doc.tables.upgradeCatalog, kodiakDefs: doc.constants.kodiak.KODIAK_DEFS };
    for (const [scope, data] of Object.entries(scopeData)) {
      const present = countKeys(data, [...omitKeysFor(scope)]);
      expect([scope, Object.values(present).reduce((a, b) => a + b, 0)]).toEqual([scope, 0]);
    }
  });
  test('tables keep exactly the causal columns (curveK/cap and the price columns stay; only the label goes)', () => {
    expect(keyPaths(doc.tables.upgradeCatalog)).toEqual(['[].basePrice', '[].cap', '[].curveK', '[].id', '[].priceScale']);
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
  test('changing an UPGRADE_CATALOG basePrice or priceScale changes the rulesetId (Draft legality is competition identity)', () => {
    const content = loadContentFromDisk(root);
    const engineVersions = readEngineVersions(root);
    const base = rulesetIdOf(assembleRuleset({ content, engineVersions }));
    expect(base).toBe(rulesetIdOf(doc));
    for (const field of ['basePrice', 'priceScale']) {
      const bumped = UPGRADE_CATALOG.map((u, i) => (i === 0 ? { ...u, [field]: u[field] + 1 } : u));
      const sources = { ...DEFAULT_SOURCES, permanentUpgrades: { ...DEFAULT_SOURCES.permanentUpgrades, UPGRADE_CATALOG: bumped } };
      expect(rulesetIdOf(assembleRuleset({ content, engineVersions }, sources))).not.toBe(base);
    }
    // label stays cosmetic
    const relabelled = UPGRADE_CATALOG.map((u, i) => (i === 0 ? { ...u, label: 'RENAMED' } : u));
    const same = { ...DEFAULT_SOURCES, permanentUpgrades: { ...DEFAULT_SOURCES.permanentUpgrades, UPGRADE_CATALOG: relabelled } };
    expect(rulesetIdOf(assembleRuleset({ content, engineVersions }, same))).toBe(base);
  });
  test('registry omit lists are derived from the same sets', () => {
    const omitted = RULESET_SOURCES.flatMap((s) => [...Object.values(s.exports), ...Object.values(s.statics || {}).flatMap((m) => Object.values(m))]).filter((d) => d.omit);
    for (const d of omitted) expect(d.omit.length).toBeGreaterThan(0);
    expect(omitKeysFor('hazards')).toEqual(expect.arrayContaining(['shapeKey', 'colorKey', 'name']));
    expect(omitKeysFor('upgradeCatalog')).toEqual(['label']);
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
