// Issue #209: cache provenance for the portable-math experiment matrix. The old runner reused any file at
// .cache/<cfg>/<engine>/<fixture>.json with a bare `if (existsSync(p)) return;`, so a resumed run could count a cell
// measured on an older build, tape, ruleset or math library as a fresh experiment. These tests pin the fail-closed
// rules: a cell is reusable only when its recorded provenance identity ties it to exactly the active source build,
// served game content, ruleset, math closure, fixture tape, harness code and browser runtime.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PROVENANCE_FORMAT,
  PROVENANCE_FORMAT_VERSION,
  REQUIRED_PARTS,
  ENVIRONMENT_PARTS,
  BUILD_PARTS,
  makeProvenance,
  classifyCell,
  stableStringify,
  sha256,
  extractAssetRefs,
  isUnpinnedAssetRef,
  buildServedIdentity,
  stampCell,
  cellPayloadProblem,
  cellCoordinatesProblem,
  provenanceProblem,
} from '../../tools/determinism/portable-math/cache-provenance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const experimentSource = fs.readFileSync(path.join(root, 'tools/determinism/portable-math/experiment.mjs'), 'utf8');

const digest = (label) => sha256(`fixture:${label}`);
const baseParts = () => ({
  sourceCommit: 'a'.repeat(40),
  sourceDirty: false,
  sourceTreeDigest: digest('source-tree'),
  rulesetId: `sha256:${'b'.repeat(64)}`,
  simRevision: 5,
  rulesetCurrentSha: digest('ruleset-current'),
  mathLockDigest: `sha256:${'c'.repeat(64)}`,
  pmathSha: digest('pmath'),
  tapeSha: digest('tape'),
  fixtureSha: digest('fixture'),
  harnessSha: digest('harness'),
  gameUrl: 'http://localhost:8442/',
  gameServedIdentity: digest('served'),
  engineName: 'chromium',
  engineVersion: '157.0.0.0',
  engineExecutable: '/opt/pw-browsers/chromium_headless_shell-157/chrome-headless-shell',
  hz: 120,
  configKey: 'native:{"ops":[],"mode":"global"}',
  noprobe: false,
});
const cellFor = (provenance) => stampCell({ cfg: 'native', engine: 'chromium', fixture: 'cruise-baseline', hz: 120, ticks: 1, digests: Buffer.alloc(32).toString('base64'), raw: Buffer.alloc(48).toString('base64'), provenance, outcome: { ticks: 1, distanceM: 5, score: 0 }, simMs: 4, loopMs: 6 });

describe('provenance identity is complete or absent', () => {
  test('a complete record has an identity and is proven', () => {
    const p = makeProvenance(baseParts());
    expect(p.format).toBe(PROVENANCE_FORMAT);
    expect(p.formatVersion).toBe(PROVENANCE_FORMAT_VERSION);
    expect(p.proven).toBe(true);
    expect(p.missing).toEqual([]);
    expect(p.identity).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(p.environmentId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(p.buildId).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('identity is stable under key order and changes for every required part', () => {
    const parts = baseParts();
    const a = makeProvenance(parts);
    const shuffled = Object.fromEntries(Object.entries(parts).reverse());
    expect(makeProvenance(shuffled).identity).toBe(a.identity);
    for (const k of REQUIRED_PARTS) {
      const mutated = { ...parts };
      if (typeof mutated[k] === 'boolean') mutated[k] = !mutated[k];
      else if (typeof mutated[k] === 'number') mutated[k] = mutated[k] + 1;
      else mutated[k] = `${mutated[k]}-changed`;
      expect(makeProvenance(mutated).identity).not.toBe(a.identity);
    }
  });

  test('the environment identity ignores config/engine/fixture so cross-engine and cross-config cells stay comparable', () => {
    const a = makeProvenance(baseParts());
    const b = makeProvenance({ ...baseParts(), engineName: 'firefox', engineVersion: '159.0', engineExecutable: '/opt/pw-browsers/firefox/firefox', configKey: 'all' });
    expect(a.identity).not.toBe(b.identity);
    expect(a.environmentId).toBe(b.environmentId);
    expect(a.buildId).toBe(b.buildId);
    expect(ENVIRONMENT_PARTS).not.toContain('engineName');
    expect(BUILD_PARTS).not.toContain('configKey');
  });

  test('a missing required part fails closed: no identity, proven false, part named', () => {
    const p = makeProvenance({ ...baseParts(), tapeSha: null });
    expect(p.proven).toBe(false);
    expect(p.identity).toBeNull();
    expect(p.environmentId).toBeNull();
    expect(p.missing).toContain('tapeSha');
  });

  test('an unproven served build (e.g. a dev server whose module graph is not pinned) has no identity', () => {
    const p = makeProvenance({ ...baseParts(), gameServedIdentity: null });
    expect(p.proven).toBe(false);
    expect(p.identity).toBeNull();
    expect(p.missing).toContain('gameServedIdentity');
  });
});

describe('cache acceptance is fail-closed', () => {
  test('no cached file means run, never count', () => {
    const d = classifyCell(null, makeProvenance(baseParts()));
    expect(d).toMatchObject({ reuse: false, action: 'run', reason: 'no-cached-cell' });
  });

  test('an old cell with no provenance record is never reused (the pre-#209 format)', () => {
    const d = classifyCell({ cfg: 'native', engine: 'chromium', fixture: 'cruise-baseline', ticks: 1, digests: 'AAAA' }, makeProvenance(baseParts()));
    expect(d).toMatchObject({ reuse: false, action: 'run', reason: 'missing-provenance' });
  });

  test('a wrong-build digest is rerun and names the differing part', () => {
    const cached = makeProvenance(baseParts());
    const active = makeProvenance({ ...baseParts(), sourceTreeDigest: digest('different-source-tree') });
    const d = classifyCell(cellFor(cached), active);
    expect(d).toMatchObject({ reuse: false, action: 'run', reason: 'identity-mismatch' });
    expect(d.mismatchParts).toContain('sourceTreeDigest');
    expect(d.mismatchParts).not.toContain('tapeSha');
  });

  test('a wrong-tape digest is rerun and names the differing part', () => {
    const cached = makeProvenance(baseParts());
    const active = makeProvenance({ ...baseParts(), tapeSha: digest('re-recorded-tape') });
    const d = classifyCell(cellFor(cached), active);
    expect(d).toMatchObject({ reuse: false, action: 'run', reason: 'identity-mismatch' });
    expect(d.mismatchParts).toContain('tapeSha');
  });

  test('a different engine, ruleset, math closure or browser runtime all invalidate', () => {
    const active = makeProvenance(baseParts());
    for (const patch of [
      { engineVersion: '158.0.0.0' },
      { rulesetId: `sha256:${'d'.repeat(64)}` },
      { mathLockDigest: `sha256:${'e'.repeat(64)}` },
      { pmathSha: digest('other-pmath') },
      { harnessSha: digest('other-harness') },
      { gameServedIdentity: digest('other-served-build') },
      { hz: 60 },
      { noprobe: true },
      { simRevision: 6 },
    ]) {
      expect(classifyCell(cellFor(active), makeProvenance({ ...baseParts(), ...patch })).reuse).toBe(false);
    }
  });

  test('an unproven active environment can never satisfy a cache hit', () => {
    const cached = makeProvenance(baseParts());
    const active = makeProvenance({ ...baseParts(), gameServedIdentity: null });
    const d = classifyCell(cellFor(cached), active);
    expect(d).toMatchObject({ reuse: false, action: 'run', reason: 'current-identity-unproven' });
  });

  test('a cell recorded while the environment was unproven is never reused even if its identity matches', () => {
    const active = makeProvenance(baseParts());
    const cached = { ...active, proven: false };
    const d = classifyCell(cellFor(cached), active);
    expect(d).toMatchObject({ reuse: false, action: 'run', reason: 'cached-identity-unproven' });
  });

  test('a malformed but identity-matching cell is rerun', () => {
    const active = makeProvenance(baseParts());
    const d = classifyCell({ provenance: active, ticks: null, digests: null }, active);
    expect(d).toMatchObject({ reuse: false, action: 'run', reason: 'malformed-cache' });
  });

  test('tampered provenance fields cannot retain a forged matching identity', () => {
    const active = makeProvenance(baseParts());
    const malformed = { ...active, parts: { ...active.parts, tapeSha: digest('forged') } };
    expect(classifyCell(cellFor(malformed), active)).toMatchObject({ reuse: false, reason: 'invalid-provenance-record' });
  });

  test('shortened or forged measurement payloads can never be reused', () => {
    const active = makeProvenance(baseParts());
    const original = cellFor(active);
    expect(cellPayloadProblem(original)).toBeNull();
    for (const mutation of [
      { digests: 'AAAAAA==' },
      { raw: 'AAAAAA==' },
      { digests: 'not-base64' },
      { payloadSha: '0'.repeat(64) },
      { outcome: { ...original.outcome, score: 15 } },
    ]) {
      const corrupted = { ...original, ...mutation };
      expect(classifyCell(corrupted, active)).toMatchObject({ reuse: false, reason: 'malformed-cache' });
    }
    const validButWrongLength = stampCell({ ...original, ticks: 2401, digests: 'AAAAAA==' });
    expect(classifyCell(validButWrongLength, active)).toMatchObject({ reuse: false, reason: 'malformed-cache' });
  });

  test('a report cannot label a cached Chromium or foreign-tape cell as another engine/fixture', () => {
    const parts = baseParts();
    const active = makeProvenance(parts);
    const cell = cellFor(active);
    const expected = {
      cfg: 'native', engine: 'chromium', fixture: 'cruise-baseline', hz: 120,
      configKey: parts.configKey, fixtureSha: parts.fixtureSha, tapeSha: parts.tapeSha, noprobe: false,
    };
    expect(cellCoordinatesProblem(cell, expected)).toBeNull();
    for (const patch of [
      { engine: 'firefox' }, { fixture: 'collision-heavy' }, { cfg: 'all' },
      { tapeSha: digest('new-tape') }, { fixtureSha: digest('new-fixture') },
      { configKey: 'all' }, { noprobe: true },
    ]) expect(cellCoordinatesProblem(cell, { ...expected, ...patch })).toMatch(/mismatch/);
  });

  test('strict report provenance refuses missing or forged format and version even when hash matches', () => {
    const p = makeProvenance(baseParts());
    expect(provenanceProblem(p)).toBeNull();
    for (const malformed of [
      { ...p, format: 'other' },
      { ...p, formatVersion: 999 },
      { ...p, formatVersion: undefined },
      { ...p, proven: false },
      { ...p, parts: { ...p.parts, tapeSha: digest('changed') } },
    ]) expect(provenanceProblem(malformed)).not.toBeNull();
  });

  test('a valid same-identity resume is the only reuse path', () => {
    const active = makeProvenance(baseParts());
    const d = classifyCell(cellFor(active), active);
    expect(d).toMatchObject({ reuse: true, action: 'reuse', reason: 'identity-match', identity: active.identity });
    expect(d.environmentId).toBe(active.environmentId);
  });

  test('unreadable cache JSON is rerun, not counted', () => {
    expect(classifyCell('{not json', makeProvenance(baseParts()))).toMatchObject({ reuse: false, reason: 'unreadable-cache' });
  });
});

describe('served game content identity', () => {
  test('extracts scripts, modulepreloads and stylesheets from a built index', () => {
    const html = '<html><head><link rel="stylesheet" href="/assets/index-1.css"><link rel="modulepreload" href="/assets/vendor-2.js"></head>'
      + '<body><script type="module" crossorigin src="/assets/index-3.js"></script><script type="application/json">{}</script></body></html>';
    expect(extractAssetRefs(html)).toEqual(['/assets/index-3.js', '/assets/index-1.css', '/assets/vendor-2.js']);
  });

  test('a vite dev server module graph is unpinned and cannot prove the served build', () => {
    const html = '<script type="module" src="/@vite/client"></script><script type="module" src="/src/main.js"></script>';
    const refs = extractAssetRefs(html);
    expect(refs.some(isUnpinnedAssetRef)).toBe(true);
    expect(buildServedIdentity({ indexSha: digest('dev-index'), assets: refs.map((url) => ({ url, sha: null })) })).toMatchObject({ proven: false, identity: null });
  });

  test('a content-hashed built asset set is proven', () => {
    const r = buildServedIdentity({
      indexSha: digest('built-index'),
      assets: [
        { url: '/assets/index-3.js', sha: digest('asset-js'), bytes: 100 },
        { url: '/assets/index-1.css', sha: digest('asset-css'), bytes: 10 },
      ],
    });
    expect(r.proven).toBe(true);
    expect(r.identity).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('an external or unhashed asset is not proven', () => {
    expect(buildServedIdentity({ indexSha: digest('i'), assets: [{ url: 'https://cdn.example/x.js', sha: null }] })).toMatchObject({ proven: false, identity: null });
    expect(buildServedIdentity({ indexSha: digest('i'), assets: [] })).toMatchObject({ proven: false, identity: null });
  });

  test('asset order does not change the served identity', () => {
    const a = buildServedIdentity({ indexSha: digest('i'), assets: [{ url: '/b.js', sha: digest('b') }, { url: '/a.js', sha: digest('a') }] });
    const b = buildServedIdentity({ indexSha: digest('i'), assets: [{ url: '/a.js', sha: digest('a') }, { url: '/b.js', sha: digest('b') }] });
    expect(a.identity).toBe(b.identity);
  });
});

describe('the runner actually uses the provenance gate (revert-sensitive)', () => {
  test('loaded portable math bundle is checked against fresh on-disk executable closure', () => {
    expect(experimentSource).toContain('const diskPmathScriptSha = () => sha256(pmathScript())');
    expect(experimentSource).toMatch(/diskPmathScriptSha\(\) !== bootPmathScriptSha/g);
    expect((experimentSource.match(/diskPmathScriptSha\(\) !== bootPmathScriptSha/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('experiment.mjs imports the helper and classifies a preexisting cell before reuse', () => {
    expect(experimentSource).toMatch(/from\s+'\.\/cache-provenance\.mjs'/);
    expect(experimentSource).toContain('classifyCell(');
  });

  test('the old silent cache hit is gone', () => {
    expect(experimentSource).not.toMatch(/if\s*\(\s*existsSync\(p\)\s*\)\s*return\s*;/);
  });

  test('a measured cell is written with its provenance, and report refuses to compare across environments', () => {
    expect(experimentSource).toMatch(/provenance:\s*expected/);
    expect(experimentSource).toContain('environmentId');
    expect(experimentSource).toContain("reason: 'identity-mismatch'");
  });
});
