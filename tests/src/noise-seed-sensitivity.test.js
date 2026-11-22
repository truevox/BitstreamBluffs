import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_PANEL_BYTES } from '../../tools/sim/daily-shortlist.js';
import { NOISE_PROFILES, summarizeNoise } from '../../tools/sim/human-noise.js';
import { compareNoiseSensitivity, MAX_NOISE_PANELS } from '../../tools/sim/noise-seed-sensitivity.js';

const BUILD = 'A'.repeat(40);
const PROFILES = ['ideal', 'steady', 'distracted'];
const PASS = 'maxM', CRASH = 'crash:alarm', TIMEOUT = 'timeout';
const raw = (panel) => Buffer.from(JSON.stringify(panel));
const compare = (...panels) => compareNoiseSensitivity(panels.map(raw), { buildCommit: BUILD });
const summarize = (panel) => Object.fromEntries(Object.keys(panel.settings.profiles).map((name) =>
  [name, summarizeNoise(panel.results.filter((cell) => cell.humanNoise.profile === name))]));

function cell(seed, profile, endReason, offset) {
  const frames = endReason === TIMEOUT ? 60 : 20;
  const crashed = endReason === CRASH;
  return {
    seed, endReason, outcome: endReason === PASS ? 'pass' : crashed ? 'crash' : 'timeout',
    distM: endReason === PASS ? 500 : 250, simSec: Number((frames / 60).toFixed(2)), frames, score: 987654321,
    humanNoise: {
      profile, version: 1, frameHz: 60,
      stats: { intents: 0, missed: 0, sent: 0, coalesced: 0, delayFrames: 0, pendingAtEnd: false },
      input: { format: 'bb-ghost-tape', version: 1, tickHz: 120, ticks: 2 * frames - Number(crashed), rows: [[1, 6, 0]] },
      final: { position: [123456789 + offset, 2], angle: 0.25, velocity: [3, 4], angularVelocity: 0, score: 987654321, physicsRng: 99 },
    },
    trace: endReason === TIMEOUT ? [[4, 3, 2, 1]] : [],
    verification: { seededRepeat: true, inputPlayback: true },
  };
}

function panel(noiseSeed, { profiles = PROFILES, scenarios = { 'sim-b': [PASS, CRASH, CRASH], 'sim-a': [TIMEOUT, PASS, CRASH] } } = {}) {
  const seeds = Object.keys(scenarios);
  const fixture = {
    kind: 'local-tool-assisted-bot-panel', verify: true,
    settings: { seeds, noiseSeed, policy: 'hop', passDistanceM: 500, maxSec: 1,
      biomeMask: 0, rule: 'none', hopLeadMs: 380,
      profiles: Object.fromEntries(profiles.map((name) => [name, { ...NOISE_PROFILES[name] }])) },
    results: seeds.flatMap((seed, j) => profiles.map((name) => cell(seed, name, scenarios[seed][PROFILES.indexOf(name)], j))),
  };
  fixture.summary = summarize(fixture);
  return fixture;
}

test('counts all matched courses, reports direction of pass flips across labels, and exports no trial details', () => {
  const first = panel('a');
  const second = panel('b', { scenarios: { 'sim-b': [PASS, PASS, CRASH], 'sim-a': [TIMEOUT, CRASH, PASS] } });
  const third = panel('c', { scenarios: { 'sim-b': [PASS, PASS, TIMEOUT], 'sim-a': [TIMEOUT, PASS, PASS] } });
  const result = compare(third, first, second);
  expect(result).toMatchObject({
    kind: 'local-noise-seed-sensitivity', version: 1, scope: expect.stringContaining('descriptive'),
    provenance: { assertedGitCommit: BUILD.toLowerCase(), buildVerified: false, panelVerification: expect.stringContaining('runner-reported') },
    matched: { courseCount: 2, passDistanceM: 500, maxSec: 1 },
  });
  expect(result.profiles).toEqual([
    { profile: 'ideal', counts: ['a', 'b', 'c'].map((noiseSeed) => ({ noiseSeed, pass: 1, nonPass: 1 })), flips: [] },
    { profile: 'steady', counts: [{ noiseSeed: 'a', pass: 1, nonPass: 1 }, { noiseSeed: 'b', pass: 1, nonPass: 1 }, { noiseSeed: 'c', pass: 2, nonPass: 0 }],
      flips: [{ courseSeed: 'sim-a', passNoiseSeeds: ['a', 'c'] }, { courseSeed: 'sim-b', passNoiseSeeds: ['b', 'c'] }] },
    { profile: 'distracted', counts: [{ noiseSeed: 'a', pass: 0, nonPass: 2 }, { noiseSeed: 'b', pass: 1, nonPass: 1 }, { noiseSeed: 'c', pass: 1, nonPass: 1 }],
      flips: [{ courseSeed: 'sim-a', passNoiseSeeds: ['b', 'c'] }] },
  ]);
  expect(JSON.stringify(result)).not.toMatch(/987654321|123456789|bb-ghost-tape|physicsRng|"(trace|rows|score|endReason|position|velocity|simSec|shortlist)"|crash:alarm/);
  expect(compare(first, second, third)).toEqual(result);
});

test('normalizes course, profile, result and JSON object order without treating no-change as missing', () => {
  const a = panel('a', { profiles: ['ideal', 'distracted'] });
  const b = panel('b', { profiles: ['distracted', 'ideal'] });
  b.settings.seeds.reverse();
  b.results.reverse();
  b.results = b.results.map((entry) => Object.fromEntries(Object.entries(entry).reverse()));
  expect(compare(a, b).profiles.map(({ profile, flips }) => ({ profile, flips }))).toEqual([
    { profile: 'ideal', flips: [] }, { profile: 'distracted', flips: [] },
  ]);
});

test.each([
  ['tag', (p) => { p.kind = 'local-tool-assisted-fatigue-bot-panel'; }],
  ['version', (p) => { p.results[0].humanNoise.version = 2; }],
  ['panel verification', (p) => { p.verify = false; }],
  ['cell verification', (p) => { p.results[0].verification.inputPlayback = false; }],
  ['missing cell', (p) => { p.results.pop(); }],
  ['duplicate cell', (p) => { p.results[1] = p.results[0]; }],
  ['invalid input', (p) => { p.results[0].humanNoise.input.rows = [[0, 3, 0]]; }],
  ['invalid summary', (p) => { p.summary.steady.pass = 27; }],
])('reuses strict classic validator: rejects %s', (_, change) => {
  const a = panel('a'), b = panel('b');
  change(b);
  expect(() => compare(a, b)).toThrow('Panel 2: expected a complete classic v1 bot panel with successful --verify');
});

test.each([
  ['pass threshold', (p) => { p.settings.passDistanceM = 499; }],
  ['time limit', (p) => { p.settings.maxSec = .9999; }],
  ['hop lead', (p) => { p.settings.hopLeadMs++; }],
  ['biome mask', (p) => { p.settings.biomeMask++; }],
  ['movement rule', (p) => { p.settings.rule = 'heavyPackets'; }],
])('rejects a matched-settings mismatch: %s', (_, change) => {
  const a = panel('a'), b = panel('b');
  change(b);
  expect(() => compare(a, b)).toThrow('course seeds, profiles, and run settings must match');
});

test('rejects different course or profile identity even when each input is complete', () => {
  const a = panel('a');
  const otherCourse = panel('b', { scenarios: { 'sim-c': [PASS, CRASH, CRASH], 'sim-a': [TIMEOUT, PASS, CRASH] } });
  const fewerProfiles = panel('b', { profiles: ['ideal', 'steady'] });
  for (const b of [otherCourse, fewerProfiles]) {
    expect(() => compare(a, b)).toThrow('course seeds, profiles, and run settings must match');
  }
});

test.each([
  ['unrecognized settings', (p) => { p.settings.anotherInputPolicy = true; }],
  ['unrecognized provenance shape', (p) => { p.unverifiedBuild = 'earlier'; }],
])('rejects otherwise valid panel with %s', (_, change) => {
  const a = panel('a'), b = panel('b');
  change(b);
  expect(() => compare(a, b)).toThrow('unexpected classic v1 panel fields');
});

test.each([
  ['input rows', (p) => { p.results[0].humanNoise.input.rows[0][1]++; }],
  ['final position', (p) => { p.results[0].humanNoise.final.position[0]++; }],
  ['final RNG', (p) => { p.results[0].humanNoise.final.physicsRng++; }],
  ['trace', (p) => { p.results[3].trace[0][0]++; }],
  ['final score', (p) => { p.results[0].score++; }],
  ['same aggregate with controls swapped between courses', (p) => {
    [p.results[0].seed, p.results[3].seed] = [p.results[3].seed, p.results[0].seed];
  }],
])('rejects raw ideal control divergence despite equal aggregate passes: %s', (_, change) => {
  const a = panel('a'), b = panel('b');
  change(b);
  expect(() => compare(a, b)).toThrow('recorded ideal control differs for a matched course');
});

test('rejects duplicate labels and labels containing paths without echoing the input', () => {
  expect(() => compare(panel('same'), panel('same'))).toThrow('must be distinct');
  const invalid = panel('distinct');
  invalid.settings.noiseSeed = '/tmp/private-user-path';
  expect(() => compare(panel('first'), invalid)).toThrow(/^Panel 2: use simple course and reaction IDs/);
});

test('bounds pure byte ingestion and requires full explicit build pin', () => {
  const a = raw(panel('a')), b = raw(panel('b'));
  for (const buildCommit of [undefined, 'main', 'a'.repeat(39), 'z'.repeat(40)]) {
    expect(() => compareNoiseSensitivity([a, b], { buildCommit })).toThrow('full 40-hex');
  }
  for (const panels of [[a], Array(MAX_NOISE_PANELS + 1).fill(a)]) {
    expect(() => compareNoiseSensitivity(panels, { buildCommit: BUILD })).toThrow('Provide 2–8');
  }
  for (const bytes of [Buffer.alloc(MAX_PANEL_BYTES + 1), Buffer.alloc(0), JSON.stringify(panel('b'))]) {
    expect(() => compareNoiseSensitivity([a, bytes], { buildCommit: BUILD })).toThrow('1 byte to 4 MiB');
  }
  expect(() => compareNoiseSensitivity([a, Buffer.from([0xff])], { buildCommit: BUILD })).toThrow('UTF-8 JSON');
  const maxSize = Buffer.concat([b, Buffer.alloc(MAX_PANEL_BYTES - b.length, 32)]);
  expect(compareNoiseSensitivity([a, maxSize], { buildCommit: BUILD }).sources[1].sha256).toBe(createHash('sha256').update(maxSize).digest('hex'));
  expect(compareNoiseSensitivity(Array.from({ length: MAX_NOISE_PANELS }, (_, i) => raw(panel(`label-${i}`))), { buildCommit: BUILD }).sources).toHaveLength(MAX_NOISE_PANELS);
});

test('CLI hashes exact raw bytes and produces deterministic output, suppressing data and paths on errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-noise-comparison-'));
  const fileA = join(dir, 'private-label-a.json'), fileB = join(dir, 'private-label-b.json');
  const a = Buffer.from(`  ${JSON.stringify(panel('a'))}\n\n`), b = raw(panel('b'));
  const cli = (...args) => spawnSync(process.execPath, ['tools/sim/compare-noise-seeds.mjs', ...args], { encoding: 'utf8', timeout: 4000 });
  const run = (first = fileA, second = fileB) => cli('--panel', first, '--build', BUILD, '--panel', second);
  const failed = (result, message) => {
    expect(result).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining(message) });
    expect(result.stderr).not.toContain(dir);
  };
  try {
    writeFileSync(fileA, a);
    writeFileSync(fileB, b);
    const result = run();
    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(run(fileB, fileA).stdout).toBe(result.stdout);
    expect(JSON.parse(result.stdout).sources).toEqual([['a', a], ['b', b]].map(([noiseSeed, bytes]) =>
      ({ noiseSeed, sha256: createHash('sha256').update(bytes).digest('hex') })));
    expect(cli('--help')).toMatchObject({ status: 0, stderr: '', stdout: expect.stringContaining('Usage:') });
    failed(cli('--panel', fileA, '--panel', fileB), 'full 40-hex');
    failed(cli('--panel', fileA, '--build', BUILD), 'Provide 2–8');
    failed(cli('--build', BUILD, ...Array(MAX_NOISE_PANELS + 1).fill(['--panel', fileA]).flat()), 'Provide 2–8');
    failed(run(fileA, fileA), 'must be distinct');
    failed(run(fileA, dir), 'regular local panel file');
    failed(run(fileA, join(dir, 'private-missing.json')), 'could not open');
    writeFileSync(fileB, Buffer.from([0xff]));
    failed(run(), 'UTF-8 JSON');
    writeFileSync(fileB, Buffer.alloc(MAX_PANEL_BYTES + 1));
    failed(run(), '4 MiB panel limit');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
