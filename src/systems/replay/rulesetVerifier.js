/**
 * Verifier selection and outcome records (Replay Contract v1, sections 7.3 and 7.4; issue #123).
 *
 * `resolveVerifier(manifest, registry)` decides WHICH verifier may examine a manifest. It never runs one. A manifest
 * is only ever examined under the ruleset it names: an unknown or unrunnable ruleset is a refusal, never a fallback to
 * "the current one". The registry holds publisher-supplied data only: ruleset documents (id always recomputed from the
 * canonical bytes) and the allowlist of publisher-built verifier-bundle digests. Nothing in this module loads, imports,
 * evaluates or executes a verifier bundle; callers that later run an allowlisted bundle do so outside this module.
 *
 * Pure: no Phaser, no clock, no randomness, no network.
 */
import { CJSONError, canonicalize } from './canonicalJson.js';
import { RULESET_ID_RE, assertRulesetShape, parseRuleset, rulesetIdOf } from './ruleset.js';
import { RulesetRegistryError } from './rulesetRegistry.js';

export const IN_GAME_VERIFIER = 'in-game';

/** Stable refusal reasons. The first two are the contract's (7.3); the rest are malformed-input refusals. */
export const REFUSAL = Object.freeze({
  UNKNOWN_RULESET: 'unknown-ruleset',
  HISTORICAL_VERIFIER_REQUIRED: 'historical-verifier-required',
  MALFORMED_MANIFEST: 'malformed-manifest',
  MALFORMED_RULESET_ID: 'malformed-ruleset-id',
  NULL_RULESET_NOT_LEGACY: 'null-ruleset-not-legacy',
  RULESET_FIELD_MISMATCH: 'ruleset-field-mismatch',
});

export const OUTCOMES = Object.freeze(['match', 'diverged', 'consistent-with', 'inconclusive-legacy', 'refused']);
const RUN_OUTCOMES = ['match', 'diverged'];
const LEGACY_OUTCOMES = ['consistent-with', 'inconclusive-legacy'];

const DIGEST_RE = RULESET_ID_RE; // same `sha256:<64 hex>` shape for every Tier A digest
const isDigest = (s) => typeof s === 'string' && DIGEST_RE.test(s);

function loadRuleset(entry) {
  const r = entry && entry.ruleset;
  if (r instanceof Uint8Array || ArrayBuffer.isView(r)) return parseRuleset(r);
  return { doc: assertRulesetShape(r), rulesetId: rulesetIdOf(r) };
}

/**
 * Build a ruleset registry.
 *
 * @param {Object} o
 * @param {{ruleset:(Object|Uint8Array)}} o.current   the ruleset THIS build implements; verified by the in-game verifier.
 * @param {Array<{ruleset:(Object|Uint8Array), verifierId?:(string|null)}>} [o.archive] older rulesets. `verifierId` is
 *        the digest of the publisher-built historical verifier bundle that can reproduce it, or null when only the
 *        ruleset document itself is archived (preservation without a runnable verifier).
 * @param {string[]} [o.verifierAllowlist] digests of publisher-built bundles the publisher has allowlisted (the registry
 *        holds digests only, never bundle bytes). A digest naming a bundle that is not on this list is NEVER selected.
 * @returns {Readonly<{currentId:string, get:function(string):(Object|null), ids:function():string[], isAllowlisted:function(string):boolean}>}
 * @throws {RulesetRegistryError}
 */
export function createRulesetRegistry({ current, archive = [], verifierAllowlist = [] }) {
  const entries = new Map();
  const cur = loadRuleset(current);
  entries.set(cur.rulesetId, Object.freeze({ rulesetId: cur.rulesetId, ruleset: cur.doc, simRevision: cur.doc.simRevision, verifierId: IN_GAME_VERIFIER, current: true }));
  for (const a of archive) {
    const { doc, rulesetId } = loadRuleset(a);
    if (entries.has(rulesetId)) throw new RulesetRegistryError('duplicate-ruleset', rulesetId);
    const verifierId = a.verifierId === undefined ? null : a.verifierId;
    if (verifierId !== null && !isDigest(verifierId)) throw new RulesetRegistryError('bad-verifier-id', String(verifierId));
    entries.set(rulesetId, Object.freeze({ rulesetId, ruleset: doc, simRevision: doc.simRevision, verifierId, current: false }));
  }
  for (const d of verifierAllowlist) if (!isDigest(d)) throw new RulesetRegistryError('bad-verifier-id', String(d));
  const allow = new Set(verifierAllowlist);
  return Object.freeze({
    currentId: cur.rulesetId,
    get: (id) => (typeof id === 'string' && entries.has(id) ? entries.get(id) : null),
    ids: () => [...entries.keys()].sort(),
    isAllowlisted: (digest) => allow.has(digest),
  });
}

const refusal = (reason, rulesetId, extra = {}) => Object.freeze({ status: 'refused', reason, rulesetId: rulesetId === undefined ? null : rulesetId, verifierId: null, ...extra });

const sameEngine = (a, b) => !!a && !!b && a.phaser === b.phaser && a.matter === b.matter;

/**
 * Decide which verifier may examine `manifest` (7.3).
 *
 * Results (frozen plain objects, `status` first):
 * - `{status:'run', rulesetId, simRevision, verifierId, historical}`: examine under exactly that ruleset. `verifierId` is
 *   `'in-game'` for the current ruleset, else the allowlisted historical bundle digest (`historical:true`).
 * - `{status:'legacy-only', verifiedUnder, verifierId:'in-game', allowedOutcomes}`: a legacy-derived manifest (null
 *   ruleset). Only a verifier that declares its own ruleset may look, and only `consistent-with` / `inconclusive-legacy`
 *   can come out (5.3).
 * - `{status:'refused', reason, rulesetId, verifierId, ...}`: `unknown-ruleset`, `historical-verifier-required` (names the
 *   needed bundle digest, or null when none is archived), or a malformed-input reason. Never falls back to the current ruleset.
 *
 * @param {Object} manifest a parsed bb-replay-manifest (only `causal.sim` and `info.provenance` are read)
 * @param {ReturnType<typeof createRulesetRegistry>} registry
 */
export function resolveVerifier(manifest, registry) {
  const sim = manifest && manifest.causal && manifest.causal.sim;
  if (!manifest || typeof manifest !== 'object' || !sim || typeof sim !== 'object' || !('rulesetId' in sim)) {
    return refusal(REFUSAL.MALFORMED_MANIFEST, null, { detail: 'causal.sim.rulesetId is required (null only for legacy-derived manifests)' });
  }
  const id = sim.rulesetId;
  if (id === null) {
    const provenance = manifest.info && manifest.info.provenance;
    if (provenance !== 'legacy-derived') {
      return refusal(REFUSAL.NULL_RULESET_NOT_LEGACY, null, { detail: 'a null rulesetId is only legal when info.provenance is legacy-derived' });
    }
    return Object.freeze({
      status: 'legacy-only',
      verifiedUnder: registry.currentId,
      verifierId: IN_GAME_VERIFIER,
      allowedOutcomes: Object.freeze([...LEGACY_OUTCOMES]),
    });
  }
  if (!isDigest(id)) return refusal(REFUSAL.MALFORMED_RULESET_ID, null, { detail: 'rulesetId must be sha256:<64 lowercase hex>' });
  const entry = registry.get(id);
  if (!entry) return refusal(REFUSAL.UNKNOWN_RULESET, id, { detail: 'no ruleset with this id is registered; the current ruleset is never tried instead' });

  // Consistency copies (4.3: required whenever rulesetId is non-null; null only on legacy-derived manifests). A missing one
  // is a malformed manifest; a disagreement with the ruleset it names is a refusal, not a mismatch.
  const doc = entry.ruleset;
  if (!Number.isSafeInteger(sim.simRevision)) return refusal(REFUSAL.MALFORMED_MANIFEST, id, { field: 'simRevision', detail: 'causal.sim.simRevision is required with a non-null rulesetId' });
  if (!Number.isSafeInteger(sim.tickHz)) return refusal(REFUSAL.MALFORMED_MANIFEST, id, { field: 'tickHz', detail: 'causal.sim.tickHz is required with a non-null rulesetId' });
  if (!sim.engine || typeof sim.engine !== 'object') return refusal(REFUSAL.MALFORMED_MANIFEST, id, { field: 'engine', detail: 'causal.sim.engine is required with a non-null rulesetId' });
  if (sim.simRevision !== entry.simRevision) return refusal(REFUSAL.RULESET_FIELD_MISMATCH, id, { field: 'simRevision' });
  if (sim.tickHz !== doc.versions.tickHz) return refusal(REFUSAL.RULESET_FIELD_MISMATCH, id, { field: 'tickHz' });
  if (!sameEngine(sim.engine, doc.engine)) return refusal(REFUSAL.RULESET_FIELD_MISMATCH, id, { field: 'engine' });

  if (entry.current) {
    return Object.freeze({ status: 'run', rulesetId: id, simRevision: entry.simRevision, verifierId: IN_GAME_VERIFIER, historical: false });
  }
  if (entry.verifierId === null) {
    return refusal(REFUSAL.HISTORICAL_VERIFIER_REQUIRED, id, { verifierId: null, detail: 'ruleset is archived but no verifier bundle is registered for it' });
  }
  if (!registry.isAllowlisted(entry.verifierId)) {
    return refusal(REFUSAL.HISTORICAL_VERIFIER_REQUIRED, id, { verifierId: entry.verifierId, detail: 'the verifier bundle for this ruleset is not on the allowlist (absent or unreviewed)' });
  }
  return Object.freeze({ status: 'run', rulesetId: id, simRevision: entry.simRevision, verifierId: entry.verifierId, historical: true });
}

const OUTCOME_KEYS = new Set(['outcome', 'verifiedUnder', 'verifierId', 'tapeDigest', 'manifestDigest', 'firstDivergence', 'reason', 'claimedRulesetId']);

function failOutcome(code, detail) {
  throw new RulesetRegistryError(`bad-outcome-record:${code}`, detail);
}

/**
 * Check an outcome record (as built here, or read back from storage). There is no boolean `verified`: a record is a
 * statement by a named verifier. Unknown keys (a stray `verified: true` included) are rejected.
 * @param {Object} rec
 * @returns {Object} rec
 * @throws {RulesetRegistryError}
 */
export function validateOutcomeRecord(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) failOutcome('shape', 'not an object');
  for (const k of Object.keys(rec)) if (!OUTCOME_KEYS.has(k)) failOutcome('unknown-key', k);
  if (!OUTCOMES.includes(rec.outcome)) failOutcome('outcome', String(rec.outcome));
  if (!isDigest(rec.tapeDigest)) failOutcome('tapeDigest', 'sha256:<hex> required');
  if (!isDigest(rec.manifestDigest)) failOutcome('manifestDigest', 'sha256:<hex> required');
  if (rec.outcome === 'refused') {
    if (rec.verifiedUnder !== null || rec.verifierId !== null) failOutcome('refused', 'a refusal has no verifier: verifiedUnder and verifierId must be null');
    if (typeof rec.reason !== 'string' || !rec.reason) failOutcome('refused', 'reason required');
    if (rec.firstDivergence !== undefined) failOutcome('refused', 'firstDivergence is not allowed');
    return rec;
  }
  if ('reason' in rec || 'claimedRulesetId' in rec) failOutcome('unexpected', 'reason/claimedRulesetId belong to refusals');
  if (!isDigest(rec.verifiedUnder)) failOutcome('verifiedUnder', 'a rulesetId is required: every statement names its ruleset');
  if (typeof rec.verifierId !== 'string' || !(rec.verifierId === IN_GAME_VERIFIER || isDigest(rec.verifierId))) failOutcome('verifierId', 'in-game or a bundle digest');
  if (rec.firstDivergence !== undefined) {
    if (rec.outcome !== 'diverged') failOutcome('firstDivergence', 'only a diverged outcome carries one');
    if (rec.firstDivergence === null || typeof rec.firstDivergence !== 'object') failOutcome('firstDivergence', 'object required');
    try {
      canonicalize(rec.firstDivergence);
    } catch (e) {
      if (e instanceof CJSONError) failOutcome('firstDivergence', e.message);
      throw e;
    }
  }
  return rec;
}

/**
 * Build an outcome record (7.4) from a resolution and a result. The record names the ruleset and verifier from the
 * RESOLUTION (never from the manifest's claim), so it cannot attribute a result to a verifier that did not produce it.
 *
 * @param {Object} o
 * @param {string} o.outcome `match`/`diverged` (resolution.status 'run'), `consistent-with`/`inconclusive-legacy`
 *        (resolution.status 'legacy-only'), or `refused` (resolution.status 'refused').
 * @param {ReturnType<typeof resolveVerifier>} o.resolution
 * @param {string} o.tapeDigest
 * @param {string} o.manifestDigest
 * @param {Object} [o.firstDivergence] CompareResult, `diverged` only
 * @returns {Readonly<Object>}
 */
export function makeOutcomeRecord({ outcome, resolution, tapeDigest, manifestDigest, firstDivergence }) {
  if (!resolution || typeof resolution !== 'object') failOutcome('resolution', 'required');
  let rec;
  if (resolution.status === 'refused') {
    if (outcome !== 'refused') failOutcome('outcome', `a refused resolution can only produce outcome "refused", not "${outcome}"`);
    rec = { outcome, verifiedUnder: null, verifierId: null, tapeDigest, manifestDigest, reason: resolution.reason };
    if (resolution.rulesetId) rec.claimedRulesetId = resolution.rulesetId;
  } else if (resolution.status === 'run') {
    if (!RUN_OUTCOMES.includes(outcome)) failOutcome('outcome', `a run resolution produces match or diverged, not "${outcome}"`);
    rec = { outcome, verifiedUnder: resolution.rulesetId, verifierId: resolution.verifierId, tapeDigest, manifestDigest };
  } else if (resolution.status === 'legacy-only') {
    if (!LEGACY_OUTCOMES.includes(outcome)) failOutcome('outcome', `a legacy manifest can only be consistent-with or inconclusive-legacy, not "${outcome}"`);
    rec = { outcome, verifiedUnder: resolution.verifiedUnder, verifierId: resolution.verifierId, tapeDigest, manifestDigest };
  } else failOutcome('resolution', `unknown status ${resolution.status}`);
  if (firstDivergence !== undefined) rec.firstDivergence = firstDivergence;
  validateOutcomeRecord(rec);
  return Object.freeze(rec);
}
