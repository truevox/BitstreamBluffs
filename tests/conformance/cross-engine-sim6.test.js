/** #236: immutable SIM_REVISION 6 fixture set, with independently verifiable provenance. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { FIXTURES, FIXTURES_SIM6 } from '../../tools/conformance/cross-engine-fixtures.mjs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const current = path.join(root, 'tools', 'conformance', 'fixtures', 'cross-engine-sim6');
const historical = path.join(root, 'tools', 'conformance', 'fixtures', 'cross-engine');
const metadata = JSON.parse(fs.readFileSync(path.join(current, 'record-meta.json'), 'utf8'));
const provenance = JSON.parse(fs.readFileSync(path.join(current, 'provenance-v1.json'), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

const IDS = [
  'cruise-baseline', 'fifth-run-in-session', 'collision-heavy',
  'chunk-biome-boundaries', 'bsod-pursuit-catch', 'airborne-tricks',
  'parachute-airbrake', 'kodiaks-on', 'daily-practice-rule',
];

test('the v6 fixture set is separately anchored to source, ruleset and exact build identity', () => {
  expect(provenance.format).toBe('bsb-cross-engine-replay-fixture-provenance-v1');
  expect(provenance.sourceGitSha).toBe('35ad8ac36d4f05a5866a81bf305aee2d600544cc');
  expect(metadata.gitSha).toBe(provenance.sourceGitSha);
  expect(metadata.format).toBe('bb-cross-engine-record-meta');
  expect(metadata.formatVersion).toBe(2);
  expect(metadata.fixtureSet).toBe('sim6');
  expect(metadata.buildId).toBe(provenance.buildId);
  expect(metadata.rulesetId).toBe(provenance.rulesetId);
  expect(provenance.gameVersion).toBe('2.19.21');
  expect(provenance.simRevision).toBe(6);
  expect(provenance.rulesetId).toBe('sha256:03c7d7c987c2523ae61c1e4dc4c47699b21069d2355bdabdedcf3d0fb85bcb6b');
  expect(provenance.buildId).toBe('sha256:a3f069ee7d73e5229fdafd374b6ccc5e53d6342ff8255e66b152556c72a74d41');
  expect(provenance.recordingHz).toBe(120);
  expect(provenance.recordingEngine).toBe('chromium-headless-shell');
  expect(provenance.fixtureIds).toEqual(IDS);
  expect(metadata.fixtures.map((f) => f.id)).toEqual(IDS);
  expect(fs.existsSync(path.join(historical, 'record-meta.json'))).toBe(true);
});

test('every committed source-stamped tape is pinned byte-for-byte and has SIM_REVISION 6', () => {
  for (const id of IDS) {
    const filename = `${id}.tape.json`;
    const bytes = fs.readFileSync(path.join(current, filename));
    expect(hash(bytes)).toBe(provenance.fileSha256[filename]);
    const tape = JSON.parse(bytes.toString('utf8'));
    expect(tape.format).toBe('bb-ghost-tape');
    expect(tape.simRevision).toBe(6);
    expect(tape.inputs.length).toBeGreaterThan(0);
    expect(tape.checkpoints.length).toBeGreaterThan(0);
    expect(tape.seed).toMatch(/^[A-Za-z0-9-]+$/);
  }
  expect(hash(fs.readFileSync(path.join(current, 'record-meta.json')))).toBe(provenance.fileSha256['record-meta.json']);
  expect(Object.keys(provenance.fileSha256)).toHaveLength(IDS.length + 1);
});

test('all nine recorded live/fresh and moved-date checks passed, with no silent errors', () => {
  for (const fixture of metadata.fixtures) {
    expect(fixture.liveVsFreshContextReplay.ok).toBe(true);
    expect(fixture.liveVsFreshContextReplay.desync).toBeNull();
    expect(fixture.dateIndependence.ok).toBe(true);
    expect(fixture.dateIndependence.desync).toBeNull();
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.checkpoints).toBeGreaterThan(0);
    expect(provenance.recordingChecks[fixture.id].freshReplayPassed).toBe(true);
    expect(provenance.recordingChecks[fixture.id].dateIndependencePassed).toBe(true);
  }
});

test('the older historical tapes remain separate evidence, not a rewritten v6 alias', () => {
  const old = JSON.parse(fs.readFileSync(path.join(historical, 'chunk-biome-boundaries.tape.json')));
  const newer = JSON.parse(fs.readFileSync(path.join(current, 'chunk-biome-boundaries.tape.json')));
  expect(old.simRevision).toBeUndefined();
  expect(newer.simRevision).toBe(6);
  expect(old.endTick).not.toBe(newer.endTick);
  expect(old.distanceM).not.toBe(newer.distanceM);
  expect(provenance.coverageCaveats).toEqual(expect.arrayContaining([expect.stringMatching(/Playwright WebKit.*not Safari/i)]));
});

test('the Kodiak v6 recording actually covers an active pack, without falsely claiming collision', () => {
  const fixture = metadata.fixtures.find((x) => x.id === 'kodiaks-on');
  expect(fixture.outcome.stats.kodiaksOn).toBe(true);
  expect(fixture.outcome.stats.kodiakTicks).toBeGreaterThan(1000);
  expect(fixture.outcome.distanceM).toBeGreaterThan(1000);
  expect(provenance.coverageCaveats).toEqual(expect.arrayContaining([expect.stringMatching(/presence, not necessarily a bear-sled collision/)]));
});

test('the sim6-only Kodiak route reaches real packs without changing ANY historical fixture definition', () => {
  expect(FIXTURES).toHaveLength(9);
  expect(FIXTURES_SIM6).toHaveLength(9);
  const oldKodiak = FIXTURES.find((f) => f.id === 'kodiaks-on');
  const newKodiak = FIXTURES_SIM6.find((f) => f.id === 'kodiaks-on');
  expect(oldKodiak.seed).toBe('CE120-KODIAK');
  expect(newKodiak.seed).toBe('CE120-KODIAK-B');
  expect(newKodiak.maxTicks).toBe(oldKodiak.maxTicks);
  for (const old of FIXTURES.filter((f) => f.id !== 'kodiaks-on')) {
    expect(FIXTURES_SIM6.find((f) => f.id === old.id)).toBe(old);
  }
});
