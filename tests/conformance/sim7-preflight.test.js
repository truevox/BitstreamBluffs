/** #249 SIM_REVISION 7 recording preflight; no current-version golden tapes committed. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FIXTURES, FIXTURES_SIM6, FIXTURES_SIM7 } from '../../tools/conformance/cross-engine-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sim6Dir = path.join(root, 'tools/conformance/fixtures/cross-engine-sim6');
const historicalDir = path.join(root, 'tools/conformance/fixtures/cross-engine');
const run = (fixtureSet, directory) => spawnSync(process.execPath, ['tools/conformance/cross-engine.mjs', 'fresh'], {
  cwd: root, timeout: 20000, encoding: 'utf8',
  env: { ...process.env, CE_FIXTURE_SET: fixtureSet, CE_TAPE_DIR: directory,
    ENGINES: 'chromium-headless-shell', FIXTURES: 'airbrake-pulse', GAME_URL: 'http://127.0.0.1:9/' },
});

test('SIM7 adds two real-AirBrake exercise definitions without changing older source fixtures', () => {
  expect(FIXTURES).toHaveLength(9);
  expect(FIXTURES_SIM6).toHaveLength(9);
  expect(FIXTURES_SIM7).toHaveLength(11);
  expect(FIXTURES_SIM7.slice(0, 9)).toEqual(FIXTURES_SIM6);
  expect(FIXTURES_SIM7.slice(0, 9).every((f,i) => f === FIXTURES_SIM6[i])).toBe(true);
  const additions = FIXTURES_SIM7.slice(9);
  expect(additions.map((f) => f.id)).toEqual(['airbrake-pulse', 'airbrake-canopy-overlap']);
  expect(additions.map((f) => f.style)).toEqual(['airbrakePulse', 'airbrakeOverlap']);
  expect(additions[0].seed).toBe(additions[1].seed); // paired terrain, different input policy
  expect(new Set(FIXTURES_SIM7.map((f) => f.id)).size).toBe(11);
  for (const f of additions) {
    expect(f.maxTicks).toBeGreaterThan(240);
    expect(f.covers).toEqual(expect.arrayContaining([expect.stringMatching(/AirBrake/)]));
  }
});

test('SIM7 strict verifier refuses authentic SIM6 metadata and historical directory before browser launch', () => {
  const s6 = JSON.parse(fs.readFileSync(path.join(sim6Dir, 'record-meta.json'), 'utf8'));
  expect(s6.fixtureSet).toBe('sim6');
  expect(s6.simRevision).toBe(6);
  let p=run('sim7',sim6Dir);
  expect(p.status).not.toBe(0);
  expect(p.stderr).toMatch(/SIM7 tape input metadata is missing or not a revision-7 recording/);
  expect(p.stderr).not.toMatch(/ECONNREFUSED/); // provenance failure comes first
  p=run('sim7',historicalDir);
  expect(p.status).not.toBe(0);
  expect(p.stderr).toMatch(/SIM7 tape input metadata is missing or not a revision-7 recording|SIM7 tape input needs source-stamped/);
  expect(p.stderr).not.toMatch(/ECONNREFUSED/);
});

test('SIM6 remains build-pinned, cannot be misread as current SIM7 even when tape bytes are genuine', () => {
  const p=run('sim6',sim6Dir);
  expect(p.status).not.toBe(0);
  expect(p.stderr).toMatch(/SIM6 tape metadata identifies a DIFFERENT game build/);
  expect(p.stderr).not.toMatch(/ECONNREFUSED/);
});
