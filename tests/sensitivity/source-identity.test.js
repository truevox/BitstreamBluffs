/** #130: source provenance is derived from canonical artifacts, not env guesses. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVerifiedSourceIdentity, validateSourceIdentity } from '../../tools/sensitivity/lib/source-identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ID = `sha256:${'a'.repeat(64)}`;
const BUILD = `sha256:${'b'.repeat(64)}`;
const SHA = 'e'.repeat(40);
const input = (over = {}) => ({
  sourceSha: SHA, gitStatus: '', pointer: { rulesetId: ID, simRevision: 6 }, buildId: BUILD,
  env: {}, ...over,
});

describe('validateSourceIdentity — fail closed; env pins are assertions only', () => {
  test('clean canonical source identity has integer SIM revision and content hash', () => {
    expect(validateSourceIdentity(input())).toEqual({
      sourceSha: SHA, sourceTreeClean: true, rulesetId: ID, simRevision: 6, buildId: BUILD,
    });
  });
  test('dirty worktree is prominently marked, never silently attested as clean', () => {
    expect(validateSourceIdentity(input({ gitStatus: '?? tests/sensitivity/\n' })).sourceTreeClean).toBe(false);
  });
  test.each(['SENSITIVITY_SOURCE_SHA', 'SENSITIVITY_RULESET_ID', 'SENSITIVITY_SIM_REVISION'])(
    '%s may not substitute a stale or fabricated source identity', (key) => {
      expect(() => validateSourceIdentity(input({ env: { [key]: 'forged-value' } })))
        .toThrow(/disagrees with actual checkout/);
    },
  );
  test('matching optional external assertions do not override actual values', () => {
    const actual = validateSourceIdentity(input({ env: {
      SENSITIVITY_SOURCE_SHA: SHA, SENSITIVITY_RULESET_ID: ID, SENSITIVITY_SIM_REVISION: '6',
    } }));
    expect(actual).toEqual(validateSourceIdentity(input()));
  });
  test.each([null, undefined, 'bsb-ruleset@legacy', 'sha256:abc', 123])(
    'noncanonical ruleset pointer %s is rejected', (value) => {
      expect(() => validateSourceIdentity(input({ pointer: { rulesetId: value, simRevision: 6 } })))
        .toThrow(/canonical SHA256 ruleset/);
    },
  );
  test.each([null, '6', 0, -1, 6.5])('invalid SIM revision %s is rejected', (value) => {
    expect(() => validateSourceIdentity(input({ pointer: { rulesetId: ID, simRevision: value } })))
      .toThrow(/integer SIM revision/);
  });
  test('missing or fake build/source identity is rejected', () => {
    expect(() => validateSourceIdentity(input({ buildId: null }))).toThrow(/build identity/);
    expect(() => validateSourceIdentity(input({ sourceSha: 'fake' }))).toThrow(/Git source SHA/);
  });
});

describe('real checkout provenance integration', () => {
  test('derive SHA, SIM revision, ruleset and exact build ID from this source checkout', () => {
    const identity = readVerifiedSourceIdentity({ root: ROOT, env: {} });
    expect(identity).toMatchObject({
      sourceSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      simRevision: 6,
      rulesetId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      buildId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      rulesetArtifactSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });
  test('real checkout rejects a wrong optional ruleset pin before any simulator starts', () => {
    expect(() => readVerifiedSourceIdentity({ root: ROOT, env: { SENSITIVITY_RULESET_ID: 'bsb-ruleset@notcanonical' } }))
      .toThrow(/disagrees with actual checkout/);
  });
});
