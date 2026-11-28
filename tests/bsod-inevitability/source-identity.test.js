/** #128: refuse source mixing between browser policies and final report. */
import { assertSourceUnchanged, readSourceIdentity, workingTreeState } from '../../tools/bsod-inevitability/lib/source-identity.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = 'a'.repeat(40);
const ID = `sha256:${'a'.repeat(64)}`;
const BASE = Object.freeze({
  gitSha: SHA, workingTreeClean: true, workingTreeSha256: ID,
  simRevision: 7, rulesetId: ID, buildId: ID,
  rulesetArtifactSha256: ID, packageVersion: '2.19.21',
});

describe('#128 real checkout source integrity', () => {
  test('read actual source, canonical ruleset, exact build and worktree fingerprint', async () => {
    const x = await readSourceIdentity(ROOT);
    expect(x).toEqual({
      gitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      workingTreeClean: expect.any(Boolean),
      workingTreeSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      simRevision: 7,
      rulesetId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      buildId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      rulesetArtifactSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      packageVersion: expect.any(String),
    });
    expect(assertSourceUnchanged(x, await readSourceIdentity(ROOT))).toBe(true);
  });
  test('identical snapshots pass', () => {
    expect(assertSourceUnchanged(BASE, { ...BASE })).toBe(true);
  });
  test.each([
    ['gitSha', 'b'.repeat(40)],
    ['workingTreeClean', false],
    ['workingTreeSha256', `sha256:${'b'.repeat(64)}`],
    ['simRevision', 8],
    ['rulesetId', `sha256:${'b'.repeat(64)}`],
    ['buildId', `sha256:${'b'.repeat(64)}`],
    ['rulesetArtifactSha256', `sha256:${'b'.repeat(64)}`],
    ['packageVersion', '0.0.0'],
    ['buildId', undefined],
  ])('changing %s refuses mixed-source data', (key, value) => {
    expect(() => assertSourceUnchanged(BASE, { ...BASE, [key]: value }, 'policy flip'))
      .toThrow(/policy flip.*source changed.*\(/);
  });
  test('missing source cannot be accepted as evidence', () => {
    expect(() => assertSourceUnchanged(null, BASE)).toThrow(/source identity is missing/);
    expect(() => assertSourceUnchanged(BASE, null)).toThrow(/source identity is missing/);
  });
});


describe('content-level dirty-source fingerprint (scratch Git repo, not production)', () => {
  test('detects two different untracked contents even with identical `?? filename` status', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bsb128-source-check-'));
    try {
      const git = (args) => execFileSync('git', args, { cwd: dir });
      git(['init', '-q']);
      git(['config', 'user.name', 'Test']);
      git(['config', 'user.email', 'test@example.com']);
      await writeFile(path.join(dir, 'base.txt'), 'baseline');
      git(['add', 'base.txt']);
      git(['commit', '-qm', 'test']);
      const clean = await workingTreeState(dir);
      expect(clean.workingTreeClean).toBe(true);
      await writeFile(path.join(dir, 'untracked.txt'), 'first');
      const first = await workingTreeState(dir);
      await writeFile(path.join(dir, 'untracked.txt'), 'second');
      const second = await workingTreeState(dir);
      expect(first.workingTreeClean).toBe(false);
      expect(second.workingTreeClean).toBe(false);
      expect(first.workingTreeSha256).not.toBe(second.workingTreeSha256);
      expect(() => assertSourceUnchanged({ ...BASE, ...first }, { ...BASE, ...second }))
        .toThrow(/workingTreeSha256/);
      await writeFile(path.join(dir, 'base.txt'), 'tracked change A');
      const trackedA = await workingTreeState(dir);
      await writeFile(path.join(dir, 'base.txt'), 'tracked change B');
      const trackedB = await workingTreeState(dir);
      expect(trackedA.workingTreeSha256).not.toBe(trackedB.workingTreeSha256);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
