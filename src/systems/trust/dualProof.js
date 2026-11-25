/**
 * #245: pure transport-neutral PUBLIC trust-policy decision function.
 *
 * SECURITY BOUNDARY: a JSON `kind` or `issuer` is NOT authentication.
 * `simulation`, `authorization` and `consent` MUST be supplied only by an
 * independently authenticated infrastructure adapter. Never pass these
 * from the browser, a user claim, a replay manifest, or a self-signed hash.
 * The output is a candidate verdict, not a wallet grant or publication action.
 * NO IO, time, network, storage, identity creation, or leaderboard updates.
 */
import { validateOutcomeRecord } from '../replay/rulesetVerifier.js';

export const DUAL_PROOF_FORMAT = 'bb-dual-proof';
export const DUAL_PROOF_VERSION = 1;
export const VERDICT_STATUSES = Object.freeze(['valid', 'invalid', 'inconclusive', 'unverified']);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LANES = ['stock', 'modded', 'official-daily', 'daily-draft'];
const ASSISTANCE = ['human', 'tool-assisted', 'ai'];
const INTENTS = ['local', 'provisional-public', 'verified-public'];
const OWN = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = o => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
const keys = (o, req, optional = []) => {
  if (!isObj(o)) return false;
  const actual = Object.keys(o);
  return actual.length >= req.length && actual.length <= req.length + optional.length &&
    req.every(k => OWN(o, k)) && actual.every(k => req.includes(k) || optional.includes(k));
};
const isDigest = s => typeof s === 'string' && DIGEST.test(s);
const bounded = (s, n = 120) => typeof s === 'string' && s.length > 0 && s.length <= n &&
  /^[\w.\-:@/]+$/.test(s);
// SeedView accepts ordinary free text; do not impose identifier syntax on
// real terrain seeds. Preserve exact Unicode bytes but reject control chars,
// unpaired UTF-16 surrogates and line separators before canonical hashing.
const seedText = s => typeof s === 'string' && s.length > 0 && s.length <= 120 &&
  !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(s);
const integer = n => Number.isSafeInteger(n) && n >= 0;
const UNAVAILABLE_VERIFIER = Object.freeze(['unknown-ruleset', 'historical-verifier-required']);
const value = (status, reason) => Object.freeze({status, reason});
const TRUST = Object.freeze({
  malformed: value('invalid', 'malformed-input'),
  missing: value('unverified', 'trusted-evidence-missing'),
});

function validRequest(r) {
  const req = ['format', 'version', 'runId', 'buildId', 'rulesetId', 'manifestDigest', 'tapeDigest',
    'seed', 'biomeMask', 'lane', 'score', 'endTick', 'loadoutDigest', 'assistance', 'intent', 'challengeId'];
  return keys(r, req) && r.format === DUAL_PROOF_FORMAT && r.version === DUAL_PROOF_VERSION &&
    bounded(r.runId) && bounded(r.buildId) && isDigest(r.rulesetId) &&
    isDigest(r.manifestDigest) && isDigest(r.tapeDigest) && isDigest(r.loadoutDigest) &&
    seedText(r.seed) && integer(r.biomeMask) && r.biomeMask <= 0xffffffff &&
    integer(r.score) && integer(r.endTick) && LANES.includes(r.lane) &&
    ASSISTANCE.includes(r.assistance) && INTENTS.includes(r.intent) &&
    (r.challengeId === null || bounded(r.challengeId));
}

function simulationVerdict(request, s) {
  if (s === null || s === undefined) return TRUST.missing;
  if (!keys(s, ['kind', 'runId', 'buildId', 'verifierBuildId', 'verifiedCourse', 'score', 'endTick', 'tapeComplete', 'assistanceObserved', 'record']) ||
      s.kind !== 'trusted-replay-execution' || !bounded(s.runId) || !bounded(s.buildId) ||
      !isDigest(s.verifierBuildId) || !integer(s.score) || !integer(s.endTick) || typeof s.tapeComplete !== 'boolean' ||
      !ASSISTANCE.includes(s.assistanceObserved)) return TRUST.malformed;
  try { validateOutcomeRecord(s.record); } catch { return TRUST.malformed; }
  // These identity fields exist even for a refusal or legacy verdict. A
  // refusal from some OTHER submission cannot trigger provisional publishing.
  if (s.runId !== request.runId || s.buildId !== request.buildId ||
      s.record.manifestDigest !== request.manifestDigest ||
      s.record.tapeDigest !== request.tapeDigest)
    return value('invalid', 'simulation-identity-mismatch');
  if (s.record.outcome !== 'refused' && s.record.verifiedUnder !== request.rulesetId)
    return value('invalid', 'simulation-ruleset-mismatch');
  if (s.record.outcome === 'refused' && s.record.claimedRulesetId !== undefined &&
      s.record.claimedRulesetId !== request.rulesetId)
    return value('invalid', 'simulation-ruleset-mismatch');
  // Independently observed assistance and parsed course identity are known
  // facts even when a verifier CANNOT run. Inconclusive ≠ permission to
  // publish a known misrepresented human or loadout claim.
  if (!keys(s.verifiedCourse, ['seed','biomeMask','lane','loadoutDigest']) ||
      !seedText(s.verifiedCourse.seed) || !integer(s.verifiedCourse.biomeMask) ||
      !LANES.includes(s.verifiedCourse.lane) || !isDigest(s.verifiedCourse.loadoutDigest))
    return TRUST.malformed;
  for (const field of ['seed','biomeMask','lane','loadoutDigest'])
    if (s.verifiedCourse[field] !== request[field])
      return value('invalid', 'replayed-course-or-loadout-mismatch');
  if (s.assistanceObserved !== request.assistance)
    return value('invalid', 'assistance-misrepresented');
  if (s.assistanceObserved !== 'human') return value('invalid', 'nonhuman-on-human-board');
  if (!s.tapeComplete) return value('invalid', 'missing-complete-input-tape');
  if (s.score !== request.score || s.endTick !== request.endTick)
    return value('invalid', 'outcome-claim-mismatch');
  if (s.record.outcome === 'refused')
    return UNAVAILABLE_VERIFIER.includes(s.record.reason)
      ? value('inconclusive', 'verifier-unavailable')
      : value('invalid', 'verifier-rejected-evidence');
  if (s.record.outcome === 'consistent-with' || s.record.outcome === 'inconclusive-legacy')
    return value('inconclusive', 'legacy-not-independent-proof');
  if (s.record.outcome === 'diverged') return value('invalid', 'simulation-diverged');
  return value('valid', 'independent-replay-match');
}

function eligibilityVerdict(request, a) {
  if (a === null || a === undefined) return TRUST.missing;
  const req = ['kind', 'status', 'runId', 'buildId', 'rulesetId', 'seed', 'biomeMask', 'lane',
    'loadoutDigest', 'manifestDigest', 'challengeId', 'challengeStatus', 'economyStatus', 'equipmentStatus', 'modeStatus', 'pinnedVerifierBuildId'];
  if (!keys(a, req) || a.kind !== 'trusted-eligibility-receipt' ||
      !['authorized', 'denied', 'pending'].includes(a.status) ||
      !bounded(a.runId) || !bounded(a.buildId) || !isDigest(a.rulesetId) || !seedText(a.seed) ||
      !integer(a.biomeMask) || !LANES.includes(a.lane) || !isDigest(a.loadoutDigest) || !isDigest(a.manifestDigest) ||
      !(a.challengeId === null || bounded(a.challengeId)) ||
      !['fresh', 'expired', 'reused', 'missing'].includes(a.challengeStatus) ||
      !['authorized', 'rejected', 'missing'].includes(a.economyStatus) ||
      !['authorized', 'rejected', 'missing'].includes(a.equipmentStatus) ||
      !['allowed', 'denied', 'missing'].includes(a.modeStatus) || !isDigest(a.pinnedVerifierBuildId)) return TRUST.malformed;
  for (const key of ['runId','buildId','rulesetId','seed','biomeMask','lane','loadoutDigest','manifestDigest','challengeId'])
    if (a[key] !== request[key]) return value('invalid', 'eligibility-identity-mismatch');
  if (a.status === 'denied' || a.economyStatus === 'rejected' ||
      a.equipmentStatus === 'rejected' || a.modeStatus === 'denied')
    return value('invalid', 'trusted-eligibility-denied');
  if (a.challengeStatus === 'reused' || a.challengeStatus === 'expired')
    return value('invalid', 'challenge-not-fresh');
  if (a.status === 'pending' || a.challengeStatus !== 'fresh' ||
      a.economyStatus !== 'authorized' || a.equipmentStatus !== 'authorized' ||
      a.modeStatus !== 'allowed') return value('unverified', 'authorization-incomplete');
  if (request.challengeId === null) return value('unverified', 'challenge-required');
  return value('valid', 'trusted-eligibility-authorized');
}

function privacyVerdict(request, c) {
  if (request.intent === 'local') return value('valid', 'local-no-publication');
  if (c === null || c === undefined) return TRUST.missing;
  if (!keys(c, ['kind', 'status', 'runId', 'scope', 'audienceGate']) ||
      c.kind !== 'trusted-consent-receipt' ||
      !['granted','denied','pending'].includes(c.status) || !bounded(c.runId) ||
      !['score-only', 'score-and-evidence'].includes(c.scope) ||
      !['passed','failed','pending'].includes(c.audienceGate)) return TRUST.malformed;
  if (c.runId !== request.runId) return value('invalid', 'consent-run-mismatch');
  if (c.status === 'denied' || c.audienceGate === 'failed') return value('invalid', 'consent-or-audience-denied');
  if (c.status !== 'granted' || c.audienceGate !== 'passed')
    return value('unverified', 'consent-or-audience-pending');
  return value('valid', 'consented-for-public-score');
}

/**
 * Reusable decision core for both future free peer and paid hosted verification.
 * Input values are **already authenticated separate sources**; this library
 * cannot authenticate their origin. Never call it with user-created receipts.
 * `allowProvisional` is TRUSTED server policy (default false), not client input.
 */
export function adjudicateDualProof(input = {}) {
  const {request, simulation = null, authorization = null, consent = null, allowProvisional = false} = isObj(input) ? input : {};
  const requestOk = validRequest(request);
  // Even an invalid or hostile claim produces one stable bounded verdict.
  const sim = requestOk ? simulationVerdict(request, simulation) : TRUST.malformed;
  let eligible = requestOk ? eligibilityVerdict(request, authorization) : TRUST.malformed;
  // Independent source receipts must agree on the exact executable verifier.
  // Never infer this from the claimed game's buildId or client manifest.
  if (sim.status !== 'invalid' && sim.status !== 'unverified' &&
      eligible.status !== 'invalid' && simulation && authorization &&
      isDigest(simulation.verifierBuildId) && isDigest(authorization.pinnedVerifierBuildId) &&
      simulation.verifierBuildId !== authorization.pinnedVerifierBuildId)
    eligible = value('invalid', 'pinned-verifier-build-mismatch');
  const privacy = requestOk ? privacyVerdict(request, consent) : TRUST.malformed;
  let competitive;
  if (sim.status === 'invalid') competitive = value('invalid', `simulation:${sim.reason}`);
  else if (eligible.status === 'invalid') competitive = value('invalid', `eligibility:${eligible.reason}`);
  else if (sim.status === 'inconclusive') competitive = value('inconclusive', `simulation:${sim.reason}`);
  else if (sim.status === 'unverified' || eligible.status === 'unverified')
    competitive = value('unverified', 'both-independent-proofs-required');
  else competitive = value('valid', 'dual-proof-eligible');
  // Never publish or award a public rank without explicit privacy/audience.
  const publicAllowed = requestOk && request.intent !== 'local' && privacy.status === 'valid';
  let publication = 'none';
  if (publicAllowed && request.intent === 'verified-public' && competitive.status === 'valid')
    publication = 'verified-eligible';
  else if (publicAllowed && request.intent === 'provisional-public' && allowProvisional === true &&
      (competitive.status === 'unverified' || competitive.status === 'inconclusive'))
    publication = 'provisional-unverified';
  // Provenance describes the vetted input references, NOT signatures or proof
  // that their issuer was authenticated. Authentication is an adapter duty.
  const provenance = Object.freeze({
    simulationVerifierId: sim.status === 'valid' ? simulation.record.verifierId : null,
    pinnedVerifierBuildId: sim.status === 'valid' && eligible.status === 'valid' ? simulation.verifierBuildId : null,
    verifiedUnder: sim.status === 'valid' ? simulation.record.verifiedUnder : null,
    consentScope: privacy.status === 'valid' && request.intent !== 'local' ? consent.scope : null,
  });
  // Status describes candidate admission, not storage, publication or actual payout.
  return Object.freeze({
    format: DUAL_PROOF_FORMAT, version: DUAL_PROOF_VERSION,
    proof: sim, eligibility: eligible, competitiveness: competitive, privacy, provenance,
    publication, verifiedRankEligible: publication === 'verified-eligible',
    publicRewardEligible: publication === 'verified-eligible',
    provisionalLabel: publication === 'provisional-unverified' ? 'UNVERIFIED' : null,
  });
}
