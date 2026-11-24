// Issue #123 review S1: exported (and RunScene top-level) causal constants must change rulesetId; no sim module may
// export constants unclassified.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SOURCES, assembleRuleset, rulesetIdOf } from '../../src/systems/replay/ruleset.js';
import {
  NON_CAUSAL_MODULES, RULESET_SOURCES, SOURCE_EXTRACTS, classifyExtract, scanNumericConsts,
} from '../../src/systems/replay/rulesetRegistry.js';
import { ATTESTATION_RE, attestationProblem, loadContentFromDisk, readEngineVersions, readSourceTexts, repoRoot, writeTripwire, readTripwire, TRIPWIRE_PATH } from '../../tools/ruleset/lib.mjs';
import { LAST_RELEASED_SIM_REVISION, SIM_REVISION } from '../../src/systems/replay/ruleset.js';

const root = repoRoot();
const content = loadContentFromDisk(root);
const engineVersions = readEngineVersions(root);
const sourceTexts = readSourceTexts(root);
const idOf = (sources = DEFAULT_SOURCES, texts = sourceTexts) => rulesetIdOf(assembleRuleset({ content, engineVersions, sourceTexts: texts }, sources));
const base = idOf();
const withExport = (id, name, mutate) => ({ ...DEFAULT_SOURCES, [id]: { ...DEFAULT_SOURCES[id], [name]: mutate(DEFAULT_SOURCES[id][name]) } });

describe('editing an exported causal constant changes rulesetId (reviewer repro cases)', () => {
  test.each([
    ['trickTracker', 'PERFECT_ANGLE_DEG', (v) => v + 1],
    ['trickTracker', 'CRASH_IMPACT_PX_S', (v) => v - 100],
    ['biomeEffects', 'GUST_MAX_PX_S', (v) => v + 10],
    ['wards', 'WARD_MAX_MS', (v) => v + 1000],
    ['shardMagnet', 'MAGNET_MIN_SYNC_LEVEL', (v) => v + 1],
    ['bsodBluffTracker', 'BLUFF', (v) => ({ ...v, armGapPx: v.armGapPx + 1 })],
    ['biomeEffects', 'SPRING_REBOUND_MAX_SHARE', (v) => v + 0.01],
    ['biomeEffects', 'TIMED_POWERUP_DEFAULT_MS', (v) => ({ ...v, glide: (v.glide || 0) + 1 })],
    ['shardMagnet', 'MAGNET_HOLE_OFFSET', (v) => ({ ...v, x: (v.x || 0) + 1 })],
  ])('%s.%s', (mod, name, mutate) => {
    expect(idOf(withExport(mod, name, mutate))).not.toBe(base);
  });

  test('every trickTracker / biomeEffects / wards constant is in the document', () => {
    const doc = assembleRuleset({ content, engineVersions, sourceTexts });
    expect(Object.keys(doc.constants.trickTracker)).toHaveLength(11);
    expect(Object.keys(doc.constants.wards).sort()).toEqual(['WARD_MAX_MS', 'WARD_MAX_SPEED_FACTOR', 'WARD_MIN_MS']);
    expect(doc.constants.biomeEffects.GUST_MAX_PX_S).toBe(DEFAULT_SOURCES.biomeEffects.GUST_MAX_PX_S);
    expect(doc.constants.bsodBluff.BLUFF).toEqual(JSON.parse(JSON.stringify(DEFAULT_SOURCES.bsodBluffTracker.BLUFF)));
  });
});

describe('RunScene / Sled / TerrainMesh constants by source extraction (these modules cannot be imported in node)', () => {
  const edit = (file, from, to) => ({ ...sourceTexts, [file]: sourceTexts[file].replace(from, to) });
  test.each([
    ['src/scenes/RunScene.js', /const SLOWMO_CAP_MS = 3000;/, 'const SLOWMO_CAP_MS = 3001;'],
    ['src/scenes/RunScene.js', /const SPAWN_RUNIN_PX = 44;/, 'const SPAWN_RUNIN_PX = 45;'],
    ['src/scenes/RunScene.js', /const SAFE_HISTORY_MS = 3000;/, 'const SAFE_HISTORY_MS = 2999;'],
    ['src/scenes/RunScene.js', /const SAFE_SAMPLE_EVERY_MS = 120;/, 'const SAFE_SAMPLE_EVERY_MS = 121;'],
    ['src/entities/TerrainMesh.js', /export const COLLIDER_DEPTH = 64;/, 'export const COLLIDER_DEPTH = 65;'],
    ['src/entities/Sled.js', /SENSOR: 0x0004/, 'SENSOR: 0x0008'],
  ])('%s: %s', (file, from, to) => {
    const texts = edit(file, from, to);
    expect(texts[file]).not.toBe(sourceTexts[file]);
    expect(idOf(DEFAULT_SOURCES, texts)).not.toBe(base);
  });

  test('presentation constants in RunScene (hints, camera) do not change the id', () => {
    expect(idOf(DEFAULT_SOURCES, edit('src/scenes/RunScene.js', /const HOP_HINT_LEAD_S = 1.2;/, 'const HOP_HINT_LEAD_S = 9;'))).toBe(base);
  });

  test('a NEW top-level numeric constant in an extracted file fails assembly until classified; a vanished one is stale', () => {
    const added = edit('src/scenes/RunScene.js', /const SPAWN_RUNIN_PX = 44;/, 'const SPAWN_RUNIN_PX = 44;\nconst BRAND_NEW_SPAWN_PX = 3;');
    expect(() => idOf(DEFAULT_SOURCES, added)).toThrow(/unregistered-export.*BRAND_NEW_SPAWN_PX/);
    const removed = edit('src/scenes/RunScene.js', /const SLOWMO_CAP_MS = 3000;\n/, '');
    expect(() => idOf(DEFAULT_SOURCES, removed)).toThrow(/stale-registry-entry.*SLOWMO_CAP_MS/);
    const { 'src/scenes/RunScene.js': _gone, ...missing } = sourceTexts;
    void _gone;
    expect(() => idOf(DEFAULT_SOURCES, missing)).toThrow(/missing-source-text/);
  });

  test('every extract entry is complete against the real files', () => {
    for (const ex of SOURCE_EXTRACTS) expect(classifyExtract(ex, sourceTexts[ex.file])).toEqual({ unregistered: [], stale: [] });
  });

  test('scanNumericConsts reads literals, arrays and frozen objects, ignores computed values (no eval)', () => {
    const text = [
      'const A = 5;', 'export const B = -1.5e2;', 'const C = [1, 2, 3];', 'export const D = Object.freeze({ X: 0x0001, Y: 2 });',
      'const E = Math.min(950, T.x);', 'const F = "str";', 'const G = Math.PI / 180;', '  const H = 4;', 'const I = 7; // trailing note',
    ].join('\n');
    expect(scanNumericConsts(text)).toEqual({ A: 5, B: -150, C: [1, 2, 3], D: { X: 1, Y: 2 }, I: 7 });
  });
});

describe('guard: no sim-imported module under src/systems or src/entities exports constants unclassified', () => {
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const reachable = () => {
    const seen = new Set();
    const queue = ['src/scenes/RunScene.js'];
    while (queue.length) {
      const f = queue.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      for (const m of text.matchAll(/(?:import|export)[^'"`;]*?from\s+['"](\.[^'"]+)['"]/g)) {
        const p = rel(path.join(root, path.dirname(f), m[1]));
        if (p.endsWith('.js') && fs.existsSync(path.join(root, p))) queue.push(p);
      }
    }
    return [...seen].sort();
  };
  const exportsData = (text) => [...text.matchAll(/^export (?:const|let) ([A-Za-z0-9_]+)\s*=\s*(.{0,60})/gm)]
    .filter((m) => !/^(async\b|function\b|class\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(m[2])).map((m) => m[1]);

  const classified = new Set([
    ...RULESET_SOURCES.map((s) => s.file),
    ...SOURCE_EXTRACTS.map((e) => e.file),
    ...NON_CAUSAL_MODULES.map((n) => n.file),
    'src/constants.js',
  ]);

  test('every reachable module that exports a constant is registered, extracted or on the NON_CAUSAL list', () => {
    const unclassified = reachable()
      .filter((f) => /^src\/(systems|entities)\//.test(f) && !f.startsWith('src/systems/replay/'))
      .filter((f) => exportsData(fs.readFileSync(path.join(root, f), 'utf8')).length > 0)
      .filter((f) => !classified.has(f));
    expect(unclassified).toEqual([]);
  });

  test('NON_CAUSAL entries exist, carry a reason, and are not also registered', () => {
    const registered = new Set([...RULESET_SOURCES.map((s) => s.file), ...SOURCE_EXTRACTS.map((e) => e.file)]);
    for (const n of NON_CAUSAL_MODULES) {
      expect(fs.existsSync(path.join(root, n.file))).toBe(true);
      expect(n.reason.length).toBeGreaterThanOrEqual(8);
      expect(registered.has(n.file)).toBe(false);
    }
  });

  test('every registered source file exists and is reachable from sim code', () => {
    const reach = new Set(reachable());
    for (const s of [...RULESET_SOURCES, ...SOURCE_EXTRACTS]) {
      expect(fs.existsSync(path.join(root, s.file))).toBe(true);
      expect([s.file, reach.has(s.file) || s.file === 'src/constants.js']).toEqual([s.file, true]);
    }
  });
});

describe('tripwire attestation categories', () => {
  const mk = (tripSim) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-'));
    fs.mkdirSync(path.join(dir, 'tools/ruleset'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.js'), 'one');
    fs.writeFileSync(path.join(dir, TRIPWIRE_PATH), JSON.stringify({ simRevision: tripSim, files: { 'a.js': 'sha256:' + '0'.repeat(64) } }));
    return dir;
  };
  test('there are exactly three categories and each needs a reason', () => {
    for (const ok of ['no-behavior-change: harmless refactor', 'sim-revision-bumped: tuck drag changed', 'behavior-change-unreleased: -0 tilt normalized (sign of zero only)']) expect(ATTESTATION_RE.test(ok)).toBe(true);
    for (const bad of ['no-behavior-change:', 'no-behavior-change: short', 'bumped: long enough reason', 'behavior-change-unreleased:x', 'sim-revision-bumped: NOT']) expect(ATTESTATION_RE.test(bad)).toBe(false);
  });
  test('no-behavior-change: accepted whatever the revisions', () => {
    expect(attestationProblem('no-behavior-change: harmless refactor', { simRevision: 3, prevSimRevision: 3, lastReleased: 3 })).toBeNull();
    const dir = mk(SIM_REVISION);
    expect(writeTripwire(dir, 'no-behavior-change: harmless refactor', ['a.js']).wrote).toBe(true);
  });
  test('sim-revision-bumped: SIM_REVISION must actually exceed the previously committed artifact', () => {
    expect(attestationProblem('sim-revision-bumped: tuck drag changed', { simRevision: 2, prevSimRevision: 1 })).toBeNull();
    expect(attestationProblem('sim-revision-bumped: tuck drag changed', { simRevision: 2, prevSimRevision: 2 })).toMatch(/needs SIM_REVISION/);
    expect(attestationProblem('sim-revision-bumped: tuck drag changed', { simRevision: 1, prevSimRevision: 2 })).toMatch(/needs SIM_REVISION/);
    expect(() => writeTripwire(mk(SIM_REVISION), 'sim-revision-bumped: did a thing here', ['a.js'])).toThrow(/needs SIM_REVISION/);
    expect(writeTripwire(mk(SIM_REVISION - 1), 'sim-revision-bumped: behavior changed', ['a.js']).wrote).toBe(true);
  });
  test('behavior-change-unreleased: valid only while SIM_REVISION is above the last released revision', () => {
    const msg = 'behavior-change-unreleased: -0 tilt normalized (sign of zero only)';
    expect(LAST_RELEASED_SIM_REVISION).toBe(8); // SIM9 remains unreleased
    expect(SIM_REVISION).toBe(LAST_RELEASED_SIM_REVISION + 1);
    expect(attestationProblem(msg, { simRevision: 1, prevSimRevision: 1, lastReleased: 0 })).toBeNull();
    expect(attestationProblem(msg, { simRevision: 2, prevSimRevision: 1, lastReleased: 1 })).toBeNull();
    expect(attestationProblem(msg, { simRevision: 1, prevSimRevision: 1, lastReleased: 1 })).toMatch(/only valid while/);
    // writeTripwire judges against the live SIM_REVISION: rejected once it equals the released one, accepted while above it.
    const attempt = () => writeTripwire(mk(SIM_REVISION), msg, ['a.js']);
    if (SIM_REVISION > LAST_RELEASED_SIM_REVISION) expect(attempt().wrote).toBe(true);
    else expect(attempt).toThrow(/only valid while/);
  });
  test('released revision does not accept behavior-change-unreleased', () => {
    expect(attestationProblem('behavior-change-unreleased: reason text here', {
      simRevision: LAST_RELEASED_SIM_REVISION, prevSimRevision: LAST_RELEASED_SIM_REVISION, lastReleased: LAST_RELEASED_SIM_REVISION,
    })).toMatch(/only valid while/);
  });
});
