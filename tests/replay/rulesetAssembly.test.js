// Issue #123 / Replay Contract v1 section 7.1: ruleset assembly, the export registry and its anti-drift guards.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalBytes } from '../../src/systems/replay/canonicalJson.js';
import { digestOf } from '../../src/systems/replay/canonicalSha256.js';
import {
  DEFAULT_SOURCES, INPUT_PROTOCOL, RULESET_ID_RE, SIM_REVISION, assembleRuleset, assertRegistryShape, assertRulesetShape, parseRuleset, rulesetBytes, rulesetIdOf,
} from '../../src/systems/replay/ruleset.js';
import { RULESET_SOURCES, RulesetRegistryError, classifyExports } from '../../src/systems/replay/rulesetRegistry.js';
import { BOOSTS, BOOST_DEFS } from '../../src/systems/Boosts.js';
import { assembleFromDisk, checkPins, loadContentFromDisk, readEngineVersions, repoRoot } from '../../tools/ruleset/lib.mjs';

const root = repoRoot();
const built = assembleFromDisk(root);

describe('ruleset assembly', () => {
  test('SIM_REVISION is a hand-bumped integer starting at 1', () => {
    expect(Number.isSafeInteger(SIM_REVISION)).toBe(true);
    expect(SIM_REVISION).toBeGreaterThanOrEqual(1);
    expect(built.doc.simRevision).toBe(SIM_REVISION);
  });

  test('document has the contract blocks and a sha256 id computed from canonical bytes', () => {
    assertRulesetShape(built.doc);
    expect(Object.keys(built.doc).sort()).toEqual(['constants', 'content', 'engine', 'format', 'formatVersion', 'simRevision', 'tables', 'versions']);
    expect(built.rulesetId).toMatch(RULESET_ID_RE);
    expect(built.rulesetId).toBe(digestOf(built.doc));
    expect(built.bytes).toEqual(canonicalBytes(built.doc));
  });

  test('assembly is deterministic and independent of content key insertion order', () => {
    const content = loadContentFromDisk(root);
    const engineVersions = readEngineVersions(root);
    const reversed = {};
    for (const g of Object.keys(content).reverse()) {
      reversed[g] = {};
      for (const id of Object.keys(content[g]).reverse()) reversed[g][id] = content[g][id];
    }
    expect(rulesetIdOf(assembleRuleset({ content, engineVersions }))).toBe(built.rulesetId);
    expect(rulesetIdOf(assembleRuleset({ content: reversed, engineVersions }))).toBe(built.rulesetId);
  });

  test('engine block carries the Matter setup including gravity.x/scale, timeScale and constraintIterations', () => {
    expect(built.doc.engine).toEqual({
      phaser: '3.90.0',
      matter: '0.20.0',
      positionIterations: 8,
      velocityIterations: 6,
      constraintIterations: 2,
      gravity: { x: 0, y: 0.9, scale: 0.001 },
      timeScale: 1,
      maxPhysicsStepMs: 8,
    });
  });

  test('hidden literal screenWidthPx=480 (and the pxPerMeter default) reach the document via the registry', () => {
    expect(built.doc.constants.terrainGenerator.screenWidthPx).toBe(480);
    expect(built.doc.constants.terrainGenerator.pxPerMeterDefault).toBe(20);
  });

  test('every registry `at` path is present in the document; version constants land where the contract says', () => {
    const get = (p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), built.doc);
    for (const s of RULESET_SOURCES) {
      const decisions = [...Object.values(s.exports), ...Object.values(s.statics || {}).flatMap((m) => Object.values(m))];
      for (const d of decisions) for (const at of d.exclude === undefined ? [].concat(d.at) : []) expect([at, get(at)]).not.toEqual([at, undefined]);
    }
    expect(built.doc.versions).toMatchObject({ ghostPhysics: 1, runRandom: 1, kodiak: 2, draftRules: 2, tickHz: 120, inputProtocol: INPUT_PROTOCOL, ghostTapeFormat: { id: 'bb-ghost-tape', version: 1 } });
    expect(built.doc.tables.draft).toEqual({ budget: 1200, rulesVersion: 2 });
  });

  test('BOOSTS list mirrors BOOST_DEFS keys (justifies excluding BOOSTS)', () => {
    expect([...BOOSTS].sort()).toEqual(Object.keys(BOOST_DEFS).sort());
  });

  test('parseRuleset recomputes the id from canonical bytes and rejects non-canonical input', () => {
    const { doc, rulesetId } = parseRuleset(rulesetBytes(built.doc));
    expect(rulesetId).toBe(built.rulesetId);
    expect(doc.simRevision).toBe(SIM_REVISION);
    const pretty = Buffer.from(JSON.stringify(built.doc, null, 1));
    expect(() => parseRuleset(new Uint8Array(pretty))).toThrow();
  });
});

describe('export registry (new numeric export without registration fails)', () => {
  test('the registry is internally consistent and every real module is fully classified', () => {
    assertRegistryShape();
    for (const s of RULESET_SOURCES) {
      expect(classifyExports(s, DEFAULT_SOURCES[s.id])).toEqual({ unregistered: [], stale: [] });
    }
  });

  test.each(['terrainGenerator', 'hazardMotion', 'kodiaks'])('an unregistered new numeric export of %s fails assembly', (id) => {
    const content = loadContentFromDisk(root);
    const engineVersions = readEngineVersions(root);
    const withNew = { ...DEFAULT_SOURCES, [id]: { ...DEFAULT_SOURCES[id], BRAND_NEW_TUNING_PX: 123 } };
    expect(() => assembleRuleset({ content, engineVersions }, withNew)).toThrow(/unregistered-export.*BRAND_NEW_TUNING_PX/);
    const src = RULESET_SOURCES.find((s) => s.id === id);
    expect(classifyExports(src, withNew[id]).unregistered).toEqual(['BRAND_NEW_TUNING_PX']);
  });

  test('a new numeric ARRAY export and a new static on DailyPatch also fail', () => {
    const content = loadContentFromDisk(root);
    const engineVersions = readEngineVersions(root);
    const arr = { ...DEFAULT_SOURCES, terrainGenerator: { ...DEFAULT_SOURCES.terrainGenerator, NEW_BANDS: [1, 2] } };
    expect(() => assembleRuleset({ content, engineVersions }, arr)).toThrow(/unregistered-export/);
    class Patched extends DEFAULT_SOURCES.dailyPatch.DailyPatch {}
    Patched.EXTRA = [1];
    const patched = { ...DEFAULT_SOURCES, dailyPatch: { DailyPatch: Patched } };
    expect(() => assembleRuleset({ content, engineVersions }, patched)).toThrow(/unregistered-export.*DailyPatch\.EXTRA/);
  });

  test('a registered name the module stopped exporting is a stale entry and fails', () => {
    const content = loadContentFromDisk(root);
    const engineVersions = readEngineVersions(root);
    const { SECTOR_M, ...rest } = DEFAULT_SOURCES.terrainGenerator;
    void SECTOR_M;
    expect(() => assembleRuleset({ content, engineVersions }, { ...DEFAULT_SOURCES, terrainGenerator: rest })).toThrow(/stale-registry-entry.*SECTOR_M/);
  });

  test('a function or non-finite value hiding in a table cannot slip into the identity', () => {
    const content = loadContentFromDisk(root);
    const engineVersions = readEngineVersions(root);
    const bad = { ...DEFAULT_SOURCES, hazardMotion: { ...DEFAULT_SOURCES.hazardMotion, ROLL_STEP_MS: Infinity } };
    expect(() => assembleRuleset({ content, engineVersions }, bad)).toThrow(RulesetRegistryError);
  });

  test('every exclusion carries a reason', () => {
    for (const s of RULESET_SOURCES) {
      for (const [name, d] of Object.entries(s.exports)) {
        if (d.exclude !== undefined) expect([name, d.exclude.length >= 8]).toEqual([name, true]);
      }
    }
  });
});

describe('hidden literals and engine facts are pinned to source text', () => {
  test('every pin still holds (a failure means a causal literal moved: update the registry and bump SIM_REVISION)', () => {
    expect(checkPins(root)).toEqual([]);
  });
});

describe('purity of the new modules', () => {
  const files = fs.readdirSync(path.join(root, 'src/systems/replay')).filter((f) => /^ruleset.*\.js$/.test(f));
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  test.each(files)('%s has no clock, randomness, network, dynamic code or storage', (f) => {
    const code = strip(fs.readFileSync(path.join(root, 'src/systems/replay', f), 'utf8'));
    expect(code).not.toMatch(/\bDate\b|Math\.random|performance\.now|\beval\s*\(|new Function|\bfetch\s*\(|XMLHttpRequest|WebSocket|\bimport\s*\(|\brequire\s*\(|localStorage|indexedDB|child_process|from 'node:|from "fs"/);
    expect(code).not.toMatch(/from 'phaser'|from "phaser"/);
  });
});
