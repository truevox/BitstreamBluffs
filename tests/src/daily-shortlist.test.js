import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDailyShortlist, MAX_PANEL_BYTES } from '../../tools/sim/daily-shortlist.js';
import { NOISE_PROFILES, summarizeNoise } from '../../tools/sim/human-noise.js';

const pin = { sourceSha256: 'f'.repeat(64), buildCommit: 'a'.repeat(40) };
const profileNames = ['ideal', 'steady', 'distracted'];
const PASS = 'maxM', CRASH = 'crash:hazard', TIMEOUT = 'timeout';

function trial(seed, profile, endReason) {
  const frames = endReason === TIMEOUT ? 601 : 60;
  const crashed = endReason === CRASH;
  const ticks = 2 * frames - Number(crashed);
  return {
    seed, endReason, outcome: endReason === PASS ? 'pass' : crashed ? 'crash' : 'timeout',
    distM: endReason !== TIMEOUT ? 500 : 250, simSec: Number((frames / 60).toFixed(2)), frames, score: 987654321,
    humanNoise: {
      profile, version: 1, frameHz: 60,
      stats: { intents: 0, missed: 0, sent: 0, coalesced: 0, delayFrames: 0, pendingAtEnd: false },
      input: { format: 'bb-ghost-tape', version: 1, tickHz: 120, ticks, rows: [[1, 6, 0]] },
      final: { position: [123456789, 2], angle: 0.25, velocity: [3, 4], angularVelocity: 0, score: 987654321, physicsRng: 99 },
    },
    trace: Array.from({ length: Math.floor(frames / 60) }, (_, i) => [0, 1, 2, i]),
    verification: { seededRepeat: true, inputPlayback: true },
  };
}

function panel({
  profiles = profileNames,
  scenarios = { 'sim-b': [PASS, PASS, CRASH], 'sim-a': [PASS, TIMEOUT, CRASH], 'sim-c': [CRASH, CRASH, CRASH],
    'sim-d': [PASS, PASS, PASS], 'sim-e': [CRASH, PASS, CRASH] },
} = {}) {
  const seeds = Object.keys(scenarios);
  const results = seeds.flatMap((seed) => profiles.map((name, i) => trial(seed, name, scenarios[seed][i])));
  return {
    kind: 'local-tool-assisted-bot-panel', verify: true,
    settings: { seeds, noiseSeed: 'synthetic-input-label', policy: 'hop', passDistanceM: 500, maxSec: 10,
      biomeMask: 3, rule: 'heavyPackets', hopLeadMs: 380,
      profiles: Object.fromEntries(profiles.map((name) => [name, { ...NOISE_PROFILES[name] }])) },
    results,
    summary: Object.fromEntries(profiles.map((name) => [name, summarizeNoise(results.filter((c) => c.humanNoise.profile === name))])),
  };
}

test('shortlists unranked outcome contrast, not score or distance, and retains controls without raw evidence', () => {
  const report = createDailyShortlist(panel(), pin);
  expect(report.shortlist).toEqual(['sim-a', 'sim-b']);
  expect(report.seeds.map(({ observation }) => observation)).toEqual([
    'profile-outcomes-differ', 'profile-outcomes-differ', 'ideal-did-not-pass', 'all-tested-profiles-passed', 'ideal-did-not-pass',
  ]);
  expect(report.seeds[0].trials.map(({ outcome, endReason }) => [outcome, endReason])).toEqual([
    ['pass', PASS], ['timeout', TIMEOUT], ['crash', CRASH],
  ]);
  expect(report.source).toMatchObject({ sha256: pin.sourceSha256, assertedGitCommit: pin.buildCommit, buildVerified: false, checkedCells: 15 });
  const serialized = JSON.stringify(report);
  expect(serialized).not.toMatch(/987654321|123456789|bb-ghost-tape|physicsRng|angularVelocity|"rows"|"trace"|"score"/);
});

test('normalizes both axis orders with deterministic code-unit ordering', () => {
  const first = panel({ scenarios: { zebra: [PASS, CRASH, CRASH], 'Éclair': [PASS, PASS, CRASH], alpha: [PASS, CRASH, CRASH], Beta: [PASS, CRASH, CRASH] } });
  const second = panel({ scenarios: { Beta: [PASS, CRASH, CRASH], zebra: [PASS, CRASH, CRASH], 'Éclair': [PASS, PASS, CRASH], alpha: [PASS, CRASH, CRASH] } });
  second.results.reverse();
  second.settings.profiles = Object.fromEntries(Object.entries(second.settings.profiles).reverse());
  const normalized = createDailyShortlist(first, pin);
  expect(normalized.shortlist).toEqual(['Beta', 'alpha', 'zebra', 'Éclair']);
  expect(JSON.stringify(createDailyShortlist(second, pin))).toBe(JSON.stringify(normalized));
});

test('accepts a two-profile panel with legitimate fixed-step deadline rounding and no candidates', () => {
  const report = createDailyShortlist(panel({ profiles: ['distracted', 'ideal'], scenarios: { plateau: [TIMEOUT, TIMEOUT] } }), pin);
  expect(report.shortlist).toEqual([]);
  expect(report.summary.ideal.timeout).toBe(1);
  expect(report.seeds[0].trials[0]).toMatchObject({ simulatedSeconds: 10.02, fixedTicks: 1202 });
});

test('allows a crash on the crossing frame and a pass whose distance rounds down', () => {
  const fixture = panel({ profiles: ['ideal', 'steady'], scenarios: { cliff: [PASS, CRASH] } });
  fixture.settings.passDistanceM = 500.04;
  fixture.results[1].distM = 500.1;
  expect(createDailyShortlist(fixture, pin).shortlist).toEqual(['cliff']);
});

test.each([
  ['wrong kind', (p) => { p.kind = 'legacy'; }],
  ['unverified panel', (p) => { p.verify = null; }],
  ['nonboolean panel flag', (p) => { p.verify = 'true'; }],
  ['missing repeat flag', (p) => { delete p.results[1].verification.seededRepeat; }],
  ['failed playback', (p) => { p.results[1].verification.inputPlayback = false; }],
  ['nonboolean cell flag', (p) => { p.results[1].verification.inputPlayback = 1; }],
  ['duplicate seed declarations', (p) => { p.settings.seeds[0] = p.settings.seeds[1]; }],
  ['duplicate entries hiding missing cell', (p) => { p.results[1] = p.results[0]; }],
  ['missing entry', (p) => { p.results.pop(); }],
  ['excess entry', (p) => { p.results.push(p.results[0]); }],
  ['undeclared seed', (p) => { p.results[1].seed = 'other'; }],
  ['undeclared profile', (p) => { p.results[1].humanNoise.profile = 'human'; }],
  ['wrong profile type', (p) => { p.results[0].humanNoise.profile = ['ideal']; }],
  ['no control profile', (p) => { delete p.settings.profiles.ideal; }],
  ['different profile settings', (p) => { p.settings.profiles.steady.missRate = 0; }],
  ['different policy', (p) => { p.settings.policy = 'handsOff'; }],
  ['different model version', (p) => { p.results[1].humanNoise.version = 2; }],
  ['unsupported rule', (p) => { p.settings.rule = 'unknown'; }],
  ['ambiguous mask', (p) => { p.settings.biomeMask = -1; }],
  ['wrong tick codec', (p) => { p.results[1].humanNoise.input.version = 0; }],
  ['missing evidence', (p) => { delete p.results[0].humanNoise.input.rows; }],
  ['invalid encoding', (p) => { p.results[0].humanNoise.input.rows[0][1] = 0xc0000; }],
  ['tick overflow', (p) => { p.results[0].humanNoise.input.rows.push([120, 7, 1]); }],
  ['tick/frame disagreement', (p) => { p.results[0].humanNoise.input.ticks = 12; }],
  ['invalid observation', (p) => { p.results[0].humanNoise.final.position[0] = null; }],
  ['too many samples', (p) => { p.results[0].trace.push([1, 2, 3, 4]); }],
  ['inconsistent noise counts', (p) => { p.results[1].humanNoise.stats.sent++; }],
  ['nonfinite time', (p) => { p.results[0].simSec = Infinity; }],
  ['pass below threshold', (p) => { p.results[0].distM = 470; }],
  ['contradictory terminal outcome', (p) => { p.results[0].outcome = 'crash'; }],
  ['unrecognized end reason', (p) => { p.results[0].endReason = 'error'; }],
  ['contradictory profile summary', (p) => { p.summary.ideal.pass = 0; }],
])('rejects instead of quietly counting a failure: %s', (_, mutate) => {
  const fixture = panel();
  mutate(fixture);
  expect(() => createDailyShortlist(fixture, pin)).toThrow(TypeError);
});

test('requires a full asserted build commit and a source hash', () => {
  expect(() => createDailyShortlist(panel(), { ...pin, buildCommit: 'main' })).toThrow(/40-hex/);
  expect(() => createDailyShortlist(panel(), { ...pin, sourceSha256: 'trusted' })).toThrow(/SHA-256/);
});

test('CLI hashes the exact file bytes, writes JSON only on success, and bounds regular input files', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'bb-shortlist-test-'));
  const file = join(tmp, 'fixture.json');
  const cli = (...args) => spawnSync(process.execPath, ['tools/sim/shortlist-daily.mjs', ...args], { encoding: 'utf8' });
  const run = (p = file) => cli('--panel', p, '--build', pin.buildCommit);
  const raw = Buffer.from(`  ${JSON.stringify(panel())}\n\n`);
  try {
    writeFileSync(file, raw);
    const one = run(), two = run();
    expect(one.status).toBe(0);
    expect(one.stderr).toBe('');
    expect(two.stdout).toBe(one.stdout);
    expect(JSON.parse(one.stdout).source.sha256).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(cli('--panel', file).stdout).toBe('');
    const fatigue = panel();
    fatigue.kind = 'local-tool-assisted-fatigue-bot-panel';
    fatigue.results.forEach((cell) => { cell.humanNoise.version = 2; });
    writeFileSync(file, JSON.stringify(fatigue));
    expect(run()).toMatchObject({
      status: 1, stdout: '',
      stderr: 'Shortlist: Fatigue panels (noise model v2) are not supported by the classic-only shortlist. ' +
        'Rerun the #126 bot panel with --verify and without --fatigue.\n',
    });
    const unverifiedClassic = panel();
    unverifiedClassic.verify = false;
    writeFileSync(file, JSON.stringify(unverifiedClassic));
    expect(run()).toMatchObject({
      status: 1, stdout: '', stderr: 'Shortlist: Use a local #126 bot panel produced with successful --verify\n',
    });
    expect(run(tmp)).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('regular local panel file') });
    writeFileSync(file, Buffer.from([255]));
    expect(run()).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('UTF-8 JSON') });
    writeFileSync(file, Buffer.alloc(MAX_PANEL_BYTES + 1));
    expect(run()).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('4 MiB limit') });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
