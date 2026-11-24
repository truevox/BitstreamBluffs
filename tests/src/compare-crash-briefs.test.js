import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCrashBriefs, parseCrashBriefV1 } from '../../tools/sim/compare-crash-briefs.mjs';
import { crashBriefReport } from '../../tools/sim/replay-crash-brief.js';

const fixture = name => fileURLToPath(new URL(`../fixtures/crash-brief/${name}-v1.json`, import.meta.url));
const terrain = readFileSync(fixture('terrain'));
const packet = readFileSync(fixture('packet-spike'));
const raw = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const generated = (cause, hazardId, runs = 2, checks = 8) => raw(crashBriefReport({ cause, hazardId }, runs, checks));

test('compares genuine locally reproduced v1 briefs without exposing raw evidence', () => {
  const result = compareCrashBriefs(terrain, packet);
  expect(result).toStrictEqual({
    kind: 'local-replay-crash-brief-comparison', reportVersion: 1,
    scope: 'Redacted outcome agreement only; does not authenticate either brief, build, or run.',
    status: 'mismatch', observed: { category: 'terrain' }, reference: { category: 'hazard', hazardId: 'packetSpike' },
  });
  expect(compareCrashBriefs(packet, terrain)).toMatchObject({ status: 'mismatch', observed: result.reference, reference: result.observed });
  expect(compareCrashBriefs(packet, packet).status).toBe('match');
  expect(compareCrashBriefs(terrain, terrain).status).toBe('match');
  expect(JSON.stringify(result)).not.toMatch(/checkpoints|freshRuns|seed|inputRows|host-path|runId/);
});

test('compares only redacted signatures, never checkpoint or replay counts', () => {
  expect(compareCrashBriefs(packet, generated('hazard', 'packetSpike', 5, 180)).status).toBe('match');
  expect(compareCrashBriefs(terrain, generated('hazard', 'packetSpike', 2, 13)).status).toBe('mismatch');
  expect(compareCrashBriefs(packet, generated('hazard', 'rollingBoulder')).status).toBe('mismatch');
});

test('missing hazard IDs are inconclusive, not proof two hazards match', () => {
  const omitted = generated('hazard', 'private-unlisted-hazard');
  expect(parseCrashBriefV1(omitted)).toStrictEqual({ category: 'hazard' });
  expect(compareCrashBriefs(packet, omitted).status).toBe('inconclusive');
  expect(compareCrashBriefs(omitted, packet).status).toBe('inconclusive');
  expect(compareCrashBriefs(omitted, omitted).status).toBe('inconclusive');
  expect(compareCrashBriefs(omitted, terrain).status).toBe('mismatch');
});

const mutate = edit => {
  const value = JSON.parse(packet);
  edit(value);
  return raw(value);
};

test.each([
  ['top-level private metadata', () => mutate(x => { x.seed = 'private-seed'; })],
  ['nested local path', () => mutate(x => { x.crash.path = '/tmp/private-host-path'; })],
  ['arbitrary hazard identifier', () => mutate(x => { x.crash.hazardId = 'private-actor'; })],
  ['hazard ID on a nonhazard outcome', () => mutate(x => { x.crash.category = 'terrain'; })],
  ['invalid crash category', () => mutate(x => { x.crash.category = 'other'; })],
  ['unrecognized version', () => mutate(x => { x.reportVersion++; })],
  ['false verification claim', () => mutate(x => { x.build.independentlyVerified = true; })],
  ['changed safety scope', () => mutate(x => { x.scope = 'authenticated'; })],
  ['nonpassing local replay', () => mutate(x => { x.replay.savedRunsOrTapes = true; })],
  ['too few repeats', () => mutate(x => { x.replay.freshRuns = 1; })],
  ['too many repeats', () => mutate(x => { x.replay.freshRuns = 6; })],
  ['fractional checkpoint count', () => mutate(x => { x.replay.checkpointsCheckedPerRun = 1.5; })],
  ['no checkpoints', () => mutate(x => { x.replay.checkpointsCheckedPerRun = 0; })],
  ['too many checkpoints', () => mutate(x => { x.replay.checkpointsCheckedPerRun = 181; })],
  ['raw-tape-shaped input', () => raw({ format: 'bb-ghost-tape', inputs: [[1, 6, 0]] })],
  ['hidden duplicate key', () => Buffer.from(packet.toString().replace('"freshRuns": 2,', '"freshRuns": 99,\n    "freshRuns": 2,'))],
  ['different key order', () => raw(Object.fromEntries(Object.entries(JSON.parse(packet)).reverse()))],
  ['reformatted JSON', () => Buffer.from(JSON.stringify(JSON.parse(packet)))],
  ['missing final newline', () => packet.subarray(0, -1)],
  ['UTF-8 BOM', () => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), packet])],
  ['invalid UTF-8', () => Buffer.from([0xc3, 0x28])],
  ['enormous input', () => Buffer.alloc(4097, 32)],
])('rejects %s rather than admitting or echoing it', (_, bytes) => {
  expect(() => compareCrashBriefs(terrain, bytes())).toThrow('Expected unchanged #190 v1 crash-brief JSON.');
});

test('CLI requires two explicit bounded regular files and never echoes paths', () => {
  const cli = fileURLToPath(new URL('../../tools/sim/compare-crash-briefs.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 5000 });
  const dir = mkdtempSync(join(tmpdir(), 'bb-brief-private-path-'));
  const data = join(dir, 'do-not-echo-user-file.json');
  const args = ['--observed', fixture('terrain'), '--reference', data];
  const expectFailure = (failed, message) => {
    expect(failed).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining(message) });
    expect(failed.stderr).not.toContain(dir);
    expect(failed.stderr).not.toContain('do-not-echo');
  };
  try {
    writeFileSync(data, packet);
    const ok = run(...args);
    expect(ok).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(ok.stdout)).toStrictEqual(compareCrashBriefs(terrain, packet));
    expect(ok.stdout).not.toContain(dir);
    expect(run('--help')).toMatchObject({ status: 0, stderr: '', stdout: expect.stringContaining('Usage:') });
    expectFailure(run('--observed', data), 'Usage:');
    expectFailure(run(...args, '--reference', data), 'Usage:');
    expectFailure(run(...args, '--raw-tape', data), 'Usage:');
    expectFailure(run('--observed', data, '--reference', dir), 'Reference input must be a readable regular file');
    expectFailure(run(...args.slice(0, -1), join(dir, 'missing')), 'Reference input must be a readable regular file');
    writeFileSync(data, Buffer.alloc(4097, 32));
    expectFailure(run(...args), 'Reference input must be a readable regular file');
    writeFileSync(data, '');
    expectFailure(run(...args), 'Reference input must be a readable regular file');
    writeFileSync(data, '{"path":"/tmp/do-not-echo"}');
    expectFailure(run(...args), 'Expected unchanged #190 v1 crash-brief JSON.');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('opt-in match requirement exposes different exit codes without altering the JSON or diagnostics', () => {
  const cli = fileURLToPath(new URL('../../tools/sim/compare-crash-briefs.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 5000 });
  const dir = mkdtempSync(join(tmpdir(), 'bb-crash-match-'));
  const omitted = join(dir, 'private-observed.json');
  try {
    writeFileSync(omitted, generated('hazard', undefined));
    for (const [observed, reference, expected] of [
      [fixture('packet-spike'), fixture('packet-spike'), 0],
      [fixture('terrain'), fixture('packet-spike'), 2],
      [omitted, fixture('packet-spike'), 3],
      [fixture('packet-spike'), omitted, 3],
    ]) {
      const args = ['--observed', observed, '--reference', reference];
      const normal = run(...args), gated = run('--require-match', ...args);
      expect(normal).toMatchObject({ status: 0, stderr: '' });
      expect(gated).toMatchObject({ status: expected, stdout: normal.stdout, stderr: '' });
      expect(gated.stdout).not.toContain(dir);
    }
    const args = ['--observed', omitted, '--reference', fixture('packet-spike')];
    expect(run('--require-match', '--require-match', ...args)).toMatchObject({
      status: 1, stdout: '', stderr: expect.stringContaining('Usage:'),
    });
    writeFileSync(omitted, 'not a brief');
    const invalid = run('--require-match', ...args);
    expect(invalid).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('Expected unchanged') });
    expect(invalid.stderr).not.toContain(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
