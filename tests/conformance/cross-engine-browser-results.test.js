/** #236: pin actual independent Chromium/Firefox/WebKit v6 browser evidence, not made-up green rows. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '../..');
const dir = path.join(root, 'tools/conformance/fixtures/cross-engine-sim6/browser-results');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const report = (name) => {
  const bytes = fs.readFileSync(path.join(dir, name));
  expect(hash(bytes)).toBe(manifest.fileSha256[name]);
  const result = JSON.parse(bytes.toString('utf8'));
  expect(result.gitSha).toBe(manifest.recordingSourceGitSha);
  return result;
};
const freshNames = ['fresh-final-chromium-firefox.json', 'fresh-final-webkit.json'];
const matrixNames = ['matrix-final-chromium-firefox.json', 'matrix-final-webkit.json'];

const bad = (row) => !!row.error || row.firstCausalDivergentTick != null || row.firstDivergentTick != null ||
  row.tapeDesyncTick != null || row.tapeDesync != null || row.lengthMismatch != null ||
  row.outcomeMatchesRef === false || row.outcomeEqualsReference === false;

const fixtureNames = ['cruise-baseline', 'fifth-run-in-session', 'collision-heavy',
  'chunk-biome-boundaries', 'bsod-pursuit-catch', 'airborne-tricks', 'parachute-airbrake',
  'kodiaks-on', 'daily-practice-rule'];

test('every fresh-context browser run is real, source-stamped, and has 0 causal or checkpoint mismatches', () => {
  expect(manifest.format).toBe('bsb-cross-engine-browser-evidence-v1');
  const rows = freshNames.flatMap((file) => report(file).rows);
  expect(rows).toHaveLength(27);
  expect(manifest.freshRows).toBe(27);
  expect(new Set(rows.map((row) => row.engine))).toEqual(new Set(['chromium-headless-shell', 'firefox', 'webkit']));
  expect(rows.filter(bad)).toEqual([]);
  const keys = rows.map((row) => `${row.engine}|${row.hz}|${row.fixture}`);
  expect(new Set(keys).size).toBe(27);
  for (const engine of ['chromium-headless-shell', 'firefox', 'webkit']) {
    expect(rows.filter((row) => row.engine === engine).map((row) => row.fixture)).toEqual(fixtureNames);
  }
  for (const row of rows) {
    expect(row.hz).toBe(120);
    expect(row.checkpointsChecked).toBeGreaterThan(0);
    expect(row.outcomeEqualsReference).toBe(true);
  }
});

test('multi-cadence 2-session browser matrix contains all 96 distinct cells, with no false passes', () => {
  const runs = matrixNames.map(report);
  const rows = runs.flatMap((run) => run.rows);
  expect(rows).toHaveLength(128);
  expect(manifest.matrixRows).toBe(128);
  for (const run of runs) {
    expect(run.authoritative).toBe(false);
    expect(run.diagnostic).toBe(true);
    expect(run.sessionsPerCell).toBe(2);
    expect(run.cadencesHz).toEqual([30, 60, 120, 144]);
    expect(run.rows).toHaveLength(64);
  }
  expect(rows.filter(bad)).toEqual([]);
  // Two independent runner reports repeat Chromium reference cells; this is
  // intentional and must not inflate the distinct cell claim.
  const unique = new Set(rows.map((row) => `${row.engine}|${row.hz}|${row.session}|${row.run}|${row.fixture}`));
  expect(unique.size).toBe(96);
  expect(manifest.matrixUniqueEngineRows).toBe(96);
  const engines = [...new Set(rows.map((row) => row.engine))].sort();
  expect(engines).toEqual(['chromium-headless-shell', 'firefox', 'webkit']);
  for (const engine of engines) for (const hz of [30, 60, 120, 144]) for (const session of [1, 2]) {
    for (const fixture of ['chunk-biome-boundaries', 'kodiaks-on', 'daily-practice-rule', 'chunk-biome-boundaries (repeat of run 1)']) {
      expect([...unique]).toContain(`${engine}|${hz}|${session}|${fixture === 'chunk-biome-boundaries' ? 1 : fixture === 'kodiaks-on' ? 2 : fixture === 'daily-practice-rule' ? 3 : 4}|${fixture}`);
    }
  }
  for (const row of rows) {
    expect(row.checkpointsChecked).toBeGreaterThan(0);
    expect(row.outcomeMatchesRef).toBe(true);
  }
});

test('both browser runners refer to the very same source, tapes and compiled build', () => {
  const reports = [...freshNames, ...matrixNames].map(report);
  expect(manifest.recordingSourceGitSha).toBe('35ad8ac36d4f05a5866a81bf305aee2d600544cc');
  expect(manifest.gameVersion).toBe('2.19.21');
  expect(manifest.simRevision).toBe(6);
  expect(manifest.rulesetId).toBe('sha256:03c7d7c987c2523ae61c1e4dc4c47699b21069d2355bdabdedcf3d0fb85bcb6b');
  expect(manifest.buildId).toBe('sha256:a3f069ee7d73e5229fdafd374b6ccc5e53d6342ff8255e66b152556c72a74d41');
  const first = reports[0].fingerprint;
  for (const result of reports.slice(1)) {
    expect(result.fingerprint.buildIndexSha).toBe(first.buildIndexSha);
    expect(result.fingerprint.pageJs).toBe(first.pageJs);
    for (const [fixture, tapeDigest] of Object.entries(result.fingerprint.tapes)) {
      // The narrow cadence matrix intentionally selects just three of the
      // nine full fresh-context fixtures; compare the shared source digests.
      expect(first.tapes[fixture]).toBe(tapeDigest);
    }
  }
  expect(Object.keys(first.tapes)).toHaveLength(9);
});
