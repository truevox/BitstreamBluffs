// Issue #123 / Contract 7.3-7.4: verifier selection and outcome records. Selection only: nothing is executed.
import { digestOfBytes } from '../../src/systems/replay/canonicalSha256.js';
import { utf8Encode } from '../../src/systems/replay/canonicalJson.js';
import { rulesetIdOf, rulesetBytes } from '../../src/systems/replay/ruleset.js';
import {
  IN_GAME_VERIFIER, OUTCOMES, REFUSAL, createRulesetRegistry, makeOutcomeRecord, resolveVerifier, validateOutcomeRecord,
} from '../../src/systems/replay/rulesetVerifier.js';
import { assembleFromDisk, repoRoot } from '../../tools/ruleset/lib.mjs';

const { doc: current, rulesetId: currentId } = assembleFromDisk(repoRoot());
const clone = (d) => JSON.parse(JSON.stringify(d));
const old = clone(current);
old.simRevision = 0 + current.simRevision + 1; // a different revision: its own identity
const oldId = rulesetIdOf(old);
const unknownDoc = clone(current);
unknownDoc.constants.physics.gravityPxS2 = 901;
const unknownId = rulesetIdOf(unknownDoc);
const bundle = digestOfBytes(utf8Encode('publisher-built verifier bundle for old ruleset'));
const sha = (t) => digestOfBytes(utf8Encode(t));
const tapeDigest = sha('tape');
const manifestDigest = sha('manifest');

const manifest = (rulesetId, extra = {}) => ({
  format: 'bb-replay-manifest',
  causal: { sim: { rulesetId, simRevision: null, tickHz: null, engine: null, ...extra } },
  info: { provenance: rulesetId === null ? 'legacy-derived' : 'live-recording' },
});

describe('createRulesetRegistry', () => {
  test('recomputes ids from the document; a duplicate ruleset or a malformed verifier digest is rejected', () => {
    const reg = createRulesetRegistry({ current: { ruleset: current }, archive: [{ ruleset: old, verifierId: bundle }], verifierAllowlist: [bundle] });
    expect(reg.currentId).toBe(currentId);
    expect(reg.ids()).toEqual([currentId, oldId].sort());
    expect(reg.get(oldId)).toMatchObject({ current: false, verifierId: bundle, simRevision: old.simRevision });
    expect(() => createRulesetRegistry({ current: { ruleset: current }, archive: [{ ruleset: current }] })).toThrow(/duplicate-ruleset/);
    expect(() => createRulesetRegistry({ current: { ruleset: current }, archive: [{ ruleset: old, verifierId: 'abc' }] })).toThrow(/bad-verifier-id/);
    expect(() => createRulesetRegistry({ current: { ruleset: current }, verifierAllowlist: ['nope'] })).toThrow(/bad-verifier-id/);
  });
  test('accepts canonical bytes and still derives the id from them', () => {
    const reg = createRulesetRegistry({ current: { ruleset: rulesetBytes(current) } });
    expect(reg.currentId).toBe(currentId);
  });
});

describe('resolveVerifier (7.3)', () => {
  const reg = createRulesetRegistry({
    current: { ruleset: current },
    archive: [{ ruleset: old, verifierId: bundle }, { ruleset: unknownDoc, verifierId: null }],
    verifierAllowlist: [bundle],
  });

  test('current ruleset: run with the in-game verifier', () => {
    expect(resolveVerifier(manifest(currentId), reg)).toEqual({ status: 'run', rulesetId: currentId, simRevision: current.simRevision, verifierId: IN_GAME_VERIFIER, historical: false });
  });

  test('archived ruleset with an allowlisted historical verifier: run under it, labelled with that ruleset', () => {
    expect(resolveVerifier(manifest(oldId), reg)).toEqual({ status: 'run', rulesetId: oldId, simRevision: old.simRevision, verifierId: bundle, historical: true });
  });

  test('an id that is not registered is refused, never "tried" under the current ruleset', () => {
    const r = resolveVerifier(manifest(sha('some other ruleset')), reg);
    expect(r).toMatchObject({ status: 'refused', reason: REFUSAL.UNKNOWN_RULESET, verifierId: null });
    expect(r.verifiedUnder).toBeUndefined();
  });

  test('archived ruleset whose verifier is not allowlisted: historical-verifier-required naming the bundle digest', () => {
    const noAllow = createRulesetRegistry({ current: { ruleset: current }, archive: [{ ruleset: old, verifierId: bundle }] });
    expect(resolveVerifier(manifest(oldId), noAllow)).toMatchObject({ status: 'refused', reason: REFUSAL.HISTORICAL_VERIFIER_REQUIRED, rulesetId: oldId, verifierId: bundle });
  });

  test('archived ruleset with no verifier bundle at all: historical-verifier-required with a null verifier', () => {
    expect(resolveVerifier(manifest(unknownId), reg)).toMatchObject({ status: 'refused', reason: REFUSAL.HISTORICAL_VERIFIER_REQUIRED, rulesetId: unknownId, verifierId: null });
  });

  test('legacy (null rulesetId, legacy-derived): only the declared current verifier, only legacy outcomes', () => {
    const r = resolveVerifier(manifest(null), reg);
    expect(r).toEqual({ status: 'legacy-only', verifiedUnder: currentId, verifierId: IN_GAME_VERIFIER, allowedOutcomes: ['consistent-with', 'inconclusive-legacy'] });
  });

  test('null ruleset on a non-legacy manifest, malformed id, malformed manifest: refused', () => {
    const m = manifest(null);
    m.info.provenance = 'live-recording';
    expect(resolveVerifier(m, reg).reason).toBe(REFUSAL.NULL_RULESET_NOT_LEGACY);
    expect(resolveVerifier(manifest('sha256:XYZ'), reg).reason).toBe(REFUSAL.MALFORMED_RULESET_ID);
    expect(resolveVerifier(manifest(currentId.toUpperCase()), reg).reason).toBe(REFUSAL.MALFORMED_RULESET_ID);
    for (const bad of [null, {}, { causal: {} }, { causal: { sim: {} } }, 'x']) expect(resolveVerifier(bad, reg).reason).toBe(REFUSAL.MALFORMED_MANIFEST);
  });

  test('consistency copies in the manifest that disagree with the named ruleset are refusals, not mismatches', () => {
    expect(resolveVerifier(manifest(currentId, { simRevision: current.simRevision + 5 }), reg)).toMatchObject({ reason: REFUSAL.RULESET_FIELD_MISMATCH, field: 'simRevision' });
    expect(resolveVerifier(manifest(currentId, { tickHz: 60 }), reg)).toMatchObject({ reason: REFUSAL.RULESET_FIELD_MISMATCH, field: 'tickHz' });
    expect(resolveVerifier(manifest(currentId, { engine: { phaser: '3.90.0', matter: '9.9.9' } }), reg)).toMatchObject({ field: 'engine' });
    expect(resolveVerifier(manifest(currentId, { simRevision: current.simRevision, tickHz: 120, engine: { phaser: '3.90.0', matter: '0.20.0' } }), reg).status).toBe('run');
  });

  test('resolutions are frozen', () => {
    expect(Object.isFrozen(resolveVerifier(manifest(currentId), reg))).toBe(true);
  });
});

describe('outcome record (7.4): no boolean verified, always a named ruleset and verifier', () => {
  const reg = createRulesetRegistry({ current: { ruleset: current }, archive: [{ ruleset: old, verifierId: bundle }], verifierAllowlist: [bundle] });
  const base = { tapeDigest, manifestDigest };

  test('match/diverged take ruleset and verifier from the resolution', () => {
    const res = resolveVerifier(manifest(oldId), reg);
    const rec = makeOutcomeRecord({ outcome: 'match', resolution: res, ...base });
    expect(rec).toEqual({ outcome: 'match', verifiedUnder: oldId, verifierId: bundle, ...base });
    const div = makeOutcomeRecord({ outcome: 'diverged', resolution: res, ...base, firstDivergence: { tick: 240, subsystem: 'sledPose' } });
    expect(div.firstDivergence).toEqual({ tick: 240, subsystem: 'sledPose' });
    expect('verified' in rec).toBe(false);
    expect(Object.isFrozen(rec)).toBe(true);
  });

  test('legacy and refused outcomes', () => {
    const legacy = makeOutcomeRecord({ outcome: 'consistent-with', resolution: resolveVerifier(manifest(null), reg), ...base });
    expect(legacy).toMatchObject({ outcome: 'consistent-with', verifiedUnder: currentId, verifierId: IN_GAME_VERIFIER });
    const refused = makeOutcomeRecord({ outcome: 'refused', resolution: resolveVerifier(manifest(sha('zzz')), reg), ...base });
    expect(refused).toMatchObject({ outcome: 'refused', verifiedUnder: null, verifierId: null, reason: REFUSAL.UNKNOWN_RULESET });
  });

  test('an outcome that the resolution does not permit is rejected', () => {
    const run = resolveVerifier(manifest(currentId), reg);
    const legacy = resolveVerifier(manifest(null), reg);
    const refused = resolveVerifier(manifest(sha('q')), reg);
    expect(() => makeOutcomeRecord({ outcome: 'consistent-with', resolution: run, ...base })).toThrow(/bad-outcome-record/);
    expect(() => makeOutcomeRecord({ outcome: 'match', resolution: legacy, ...base })).toThrow(/bad-outcome-record/);
    expect(() => makeOutcomeRecord({ outcome: 'match', resolution: refused, ...base })).toThrow(/bad-outcome-record/);
    expect(() => makeOutcomeRecord({ outcome: 'verified', resolution: run, ...base })).toThrow(/bad-outcome-record/);
    expect(() => makeOutcomeRecord({ outcome: 'match', resolution: run, tapeDigest: 'x', manifestDigest })).toThrow(/tapeDigest/);
    expect(() => makeOutcomeRecord({ outcome: 'match', resolution: run, ...base, firstDivergence: { a: 1 } })).toThrow(/firstDivergence/);
  });

  test('validateOutcomeRecord rejects a boolean `verified`, unknown keys and missing rulesets', () => {
    const ok = { outcome: 'match', verifiedUnder: currentId, verifierId: IN_GAME_VERIFIER, ...base };
    expect(validateOutcomeRecord(ok)).toBe(ok);
    expect(() => validateOutcomeRecord({ ...ok, verified: true })).toThrow(/unknown-key/);
    expect(() => validateOutcomeRecord({ ...ok, verifiedUnder: null })).toThrow(/verifiedUnder/);
    expect(() => validateOutcomeRecord({ ...ok, verifierId: 'whatever' })).toThrow(/verifierId/);
    expect(() => validateOutcomeRecord({ ...ok, outcome: 'true' })).toThrow(/outcome/);
    expect(OUTCOMES).not.toContain('verified');
  });
});

describe('selection never runs anything', () => {
  test('the registry exposes data and predicates only', () => {
    const reg = createRulesetRegistry({ current: { ruleset: current } });
    for (const v of Object.values(reg)) expect(['string', 'function']).toContain(typeof v);
    expect(Object.keys(reg).sort()).toEqual(['currentId', 'get', 'ids', 'isAllowlisted']);
  });
});
