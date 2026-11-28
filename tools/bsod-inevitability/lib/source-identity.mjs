/**
 * #128 experimental-source attestation. Pin both the committed revision and
 * the actual working-tree content, including untracked (non-ignored) files.
 * A PR SHA alone cannot identify executable source while files are dirty.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const sha = (b) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const node = (root, args) => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const stampPattern = /^sha256:[0-9a-f]{64}$/;

/** Capture a deterministic digest of all tracked diffs and each untracked file. */
export async function workingTreeState(root) {
  const status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root });
  const patch = execFileSync('git', ['diff', 'HEAD', '--binary', '--no-ext-diff'], { cwd: root });
  const filenames = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root })
    .toString('utf8').split('\0').filter(Boolean).sort();
  const hasher = createHash('sha256').update(status).update(patch);
  for (const filename of filenames) {
    hasher.update(Buffer.from(filename, 'utf8'));
    hasher.update(Buffer.from([0]));
    hasher.update(await readFile(path.join(root, filename)));
  }
  return { workingTreeClean: status.length === 0, workingTreeSha256: `sha256:${hasher.digest('hex')}` };
}

export async function readSourceIdentity(root) {
  node(root, ['tools/ruleset/build-ruleset.mjs', '--check-identity']);
  const buildId = node(root, ['tools/ruleset/build-ruleset.mjs', '--identity']).match(/^sha256:[a-f0-9]{64}/m)?.[0];
  if (!buildId) throw new Error('cannot establish canonical build identity');
  const rulesetFile = await readFile(path.join(root, 'tools/ruleset/current.json'));
  const ruleset = JSON.parse(rulesetFile.toString('utf8'));
  if (!stampPattern.test(ruleset.rulesetId) || !Number.isInteger(ruleset.simRevision) || ruleset.simRevision < 1) {
    throw new Error('missing canonical current ruleset / positive SIM revision');
  }
  const gitSha = git(root, ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(gitSha)) throw new Error('missing exact checkout Git commit');
  const tree = await workingTreeState(root);
  return {
    gitSha, ...tree,
    simRevision: ruleset.simRevision, rulesetId: ruleset.rulesetId, buildId,
    rulesetArtifactSha256: sha(rulesetFile),
    packageVersion: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version,
  };
}

/** Pure fail-closed comparator for negative tests. */
export function assertSourceUnchanged(expected, current, context = 'experiment') {
  if (!expected || !current) throw new Error(`${context}: source identity is missing`);
  const keys = [
    'gitSha', 'workingTreeClean', 'workingTreeSha256', 'simRevision',
    'rulesetId', 'buildId', 'rulesetArtifactSha256', 'packageVersion',
  ];
  for (const key of keys) {
    if (expected[key] == null || current[key] == null || expected[key] !== current[key]) {
      throw new Error(`${context}: source changed or metadata missing (${key}); refusing mixed-source report`);
    }
  }
  return true;
}
