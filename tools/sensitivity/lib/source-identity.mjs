/**
 * Developer-only source provenance for issue #130.
 * Derive from the actual checkout, never substitute self-attested environment values.
 * A digest of current.json alone is not a valid ruleset: the *existing* CLI
 * checks a fresh assembly, all build-ID causal inputs and source tripwire first.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const gitShaRE = /^[0-9a-f]{40}$/;
const digestRE = /^sha256:[0-9a-f]{64}$/;

/** Pure validation; acceptance tests can inject bad identities without spawning a browser. */
export function validateSourceIdentity({ sourceSha, gitStatus, pointer, buildId, env = {} }) {
  if (!gitShaRE.test(sourceSha)) throw new Error('missing exact Git source SHA');
  if (!pointer || !digestRE.test(pointer.rulesetId) || !Number.isInteger(pointer.simRevision) || pointer.simRevision < 1) {
    throw new Error('current.json lacks a canonical SHA256 ruleset or integer SIM revision');
  }
  if (!digestRE.test(buildId)) throw new Error('missing provable canonical build identity');
  for (const [k, actual] of [
    ['SENSITIVITY_SOURCE_SHA', sourceSha],
    ['SENSITIVITY_RULESET_ID', pointer.rulesetId],
    ['SENSITIVITY_SIM_REVISION', pointer.simRevision],
  ]) {
    if (env[k] != null && env[k] !== '' && String(env[k]) !== String(actual)) {
      throw new Error(`${k} disagrees with actual checkout; refusing self-attested provenance`);
    }
  }
  return {
    sourceSha, sourceTreeClean: gitStatus === '',
    rulesetId: pointer.rulesetId, simRevision: pointer.simRevision, buildId,
  };
}

export function readVerifiedSourceIdentity({ root, env = process.env }) {
  if (!root) throw new Error('source root required');
  const run = (file, args) => execFileSync(file, args, {
    cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  }).trim();
  const tool = path.join(root, 'tools/ruleset/build-ruleset.mjs');
  run(process.execPath, [tool, '--check-identity']);
  const out = run(process.execPath, [tool, '--identity']);
  const buildId = out.split('\n', 1)[0];
  const pointerBytes = readFileSync(path.join(root, 'tools/ruleset/current.json'));
  const pointer = JSON.parse(pointerBytes.toString('utf8'));
  const gitStatus = run('git', ['status', '--porcelain=v1']);
  return {
    ...validateSourceIdentity({
      sourceSha: run('git', ['rev-parse', 'HEAD']), gitStatus, pointer, buildId, env,
    }),
    rulesetArtifactSha256: `sha256:${createHash('sha256').update(pointerBytes).digest('hex')}`,
  };
}
