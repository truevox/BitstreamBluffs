import { spawnSync } from 'node:child_process';
import { TerrainGenerator, blindClearAheadPx } from '../../src/systems/TerrainGenerator.js';
import { scanBlindClearance, validateOriginWindow } from '../../tools/sim/terrain-preflight.js';
import { loadContent } from './_helpers.js';

const content = loadContent();
const generator = (seed, biomeMask = 16) => new TerrainGenerator({
  seed, biomeMask, chunkDefs: content.chunks, hazardDefs: content.hazards, powerupDefs: content.powerups,
  modDefs: content.terrainMods, biomeDefs: Object.values(content.biomes),
});
const scan = (seed, fromChunk, chunkCount = 1, mask = 16) =>
  scanBlindClearance(generator(seed, mask), content.hazards, { fromChunk, chunkCount });
const wallTo = (result, x, id) => result.findings.find(({ source, target }) => source.worldXPx === x && target.hazardId === id);

const runCLI = (...args) => spawnSync(process.execPath, ['tools/sim/terrain-preflight.mjs', ...args], { encoding: 'utf8' });

// re-pinned for #65: Debutmont base + arcade bridges. The seeds' terrain moved (new base biome, bridged biome changes), so
// the cases were re-found with the same scan (mask 16, chunks 0-255) and keep their intent: a window found past the origin
// crop, one hazard pair inside the nominal blind window and one outside it, and a two-chunk lookahead. fair15 and fair4 kept
// their seeds. terrain-lint-417 no longer has a two-chunk case, so that row is terrain-lint-1 (also two chunks ahead,
// just outside the nominal window).
test.each([
  ['fair15', 28, 57021, 29, 57548, 'packetSpike', 527, 1312, true],
  ['fair4', 119, 267176, 120, 267814, 'packetSpike', 638, 1428, true],
  ['terrain-lint-1', 95, 207609, 97, 209032, 'packetSpike', 1423, 1428, false],
])('production geometry: %s detects exact window past the origin crop', (seed, i, x, j, next, hazardId, gap, clearance, nominal) => {
  const result = scan(seed, i);
  expect(result).toMatchObject({ seed, biomeMask: 16, pixelsPerMeter: 20, originWindow: { fromChunk: i, endChunkExclusive: i + 1 } });
  expect(result.lookahead.additionalChunks).toBeGreaterThanOrEqual(j - i);
  const finding = wallTo(result, x, hazardId);
  expect(finding).toMatchObject({
    source: { hazardId: 'shatterWall', chunkIndex: i, worldXPx: x, placement: 'ground', generatorDistanceM: x / 20 },
    target: { hazardId, chunkIndex: j, worldXPx: next, generatorDistanceM: next / 20, motionKind: null },
    separationPx: gap, separationM: gap / 20, clearAheadPx: clearance, withinNominalBlind: nominal, crossChunk: true,
  });
  expect(Number.isFinite(finding.source.worldYPx)).toBe(true);
  expect(Number.isFinite(finding.target.worldYPx)).toBe(true);
  expect(wallTo(scan(seed, i, 4), x, hazardId)).toEqual(finding);
  expect(scan(seed, i, 1, 0).findings).toEqual([]);
});

test('preserves every pair in stable downstream order rather than reporting only the closest', () => {
  expect(scan('fair4', 119).findings.map(({ target, separationPx, withinNominalBlind }) =>
    [target.worldXPx, separationPx, withinNominalBlind])).toEqual([
    [267814, 638, true], [268534, 1358, false],
  ]);
});

test('strictly forward, inclusive clearance at a chunk boundary, and no lookahead-only origins', () => {
  const x = 100, ppm = 20;
  const blind = { id: 'wall', placement: 'air', onHit: { effect: 'blind', durationMs: 1200 } };
  const clearance = blindClearAheadPx(blind.onHit, x / ppm);
  const border = x + clearance;
  const def = { wall: blind, roll: { id: 'roll', motion: { kind: 'roll' } }, gate: { id: 'gate', motion: { kind: 'gate' } } };
  const at = (defId, x) => ({ defId, x, y: 20 });
  const chunks = [
    { index: 0, startX: 0, endX: border, hazards: [at('wall', x), at('roll', x), at('roll', x - 1), at('gate', x + 2)] },
    { index: 1, startX: border, endX: border + 200, hazards: [at('roll', border + 1), at('wall', border + 100), at('roll', border)] },
  ];
  const result = scanBlindClearance({ seed: 'fixture', biomeMask: 0, ppm, crashHazardIds: new Set(['roll', 'gate']),
    getChunk: (i) => chunks[i] }, def, { chunkCount: 1 });
  expect(result.lookahead).toEqual({ additionalChunks: 1, endInspectedChunkExclusive: 2, throughWorldXPx: border + 200 });
  expect(result.blindSpawnCount).toBe(1);
  expect(result.findings.map(({ source, target, separationPx, crossChunk }) =>
    [source.placement, target.motionKind, separationPx, crossChunk])).toEqual([
    ['air', 'gate', 2, false], ['air', 'roll', clearance, true],
  ]);
});

test('rejects a malformed range or failed lookahead rather than returning a falsely clear result', () => {
  expect(() => validateOriginWindow(4096, 1)).toThrow(/exclusive end/);
  expect(() => validateOriginWindow(0, 257)).toThrow(/origin chunks/);
  expect(() => validateOriginWindow(-1, 1)).toThrow(/origin chunks/);
  expect(() => validateOriginWindow(0, 0)).toThrow(/origin chunks/);
  const terrain = { seed: 'fixture', biomeMask: 0, ppm: 20, crashHazardIds: new Set(), getChunk: (i) => ({
    index: i, startX: i, endX: i + 1, hazards: i === 0 ? [{ defId: 'wall', x: 0, y: 0 }] : [],
  }) };
  expect(() => scanBlindClearance(terrain, { wall: { onHit: { effect: 'blind' } } }, { chunkCount: 1 })).toThrow(/lookahead exceeded/);
  expect(() => scanBlindClearance({ ...terrain, getChunk: (i) => ({ ...terrain.getChunk(i), startX: 2 * i, endX: 2 * i + 1 }) },
    { wall: { onHit: { effect: 'blind' } } }, { chunkCount: 1 })).toThrow(/noncontiguous/);
});

test('CLI emits stable JSON with fingerprinted loaded sources and no output on invalid input', () => {
  const args = ['--seed', 'fair15', '--mask', '16', '--from-chunk', '28', '--chunks', '1'];
  const one = runCLI(...args), two = runCLI(...args);
  expect(one).toMatchObject({ status: 0, stderr: '' });
  expect(two.stdout).toBe(one.stdout);
  expect(JSON.parse(one.stdout).provenance).toMatchObject({ algorithm: 'sha256-framed-relative-path-file-bytes-v1',
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/), files: expect.any(Number),
    generatorFiles: expect.arrayContaining(['src/systems/TerrainGenerator.js']),
    contentGlobs: expect.arrayContaining(['src/data/hazards/*.json']) });
  const literal = runCLI('--seed', '--literal', '--mask', '0', '--chunks', '1');
  expect(literal.status).toBe(0);
  expect(JSON.parse(literal.stdout).seed).toBe('--literal');
  for (const bad of [[], ['--seed', 'x'], ['--seed', 'x', '--mask', '4294967296'], ['--seed', 'x', '--mask', '0x10'],
    ['--seed', 'x', '--mask', '16', '--mask', '0'], ['--seed', 'x', '--mask', '16', '--chunks', '257'],
    ['--seed', 'x', '--mask', '16', '--from-chunk', '4096'], ['--seed', '\n', '--mask', '0'],
    ['--seed', 'x', '--mask', '16', '--out', 'path']]) {
    expect(runCLI(...bad)).toMatchObject({ status: 1, stdout: '', stderr: expect.stringMatching(/^Terrain preflight:/) });
  }
});
