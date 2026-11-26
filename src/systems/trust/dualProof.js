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
import { canonicalBytes, parseCanonical } from '../replay/canonicalJson.js';

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
  const descriptors = Object.getOwnPropertyDescriptors(o);
  if (actual.some(k => !OWN(descriptors[k], 'value'))) return false;
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
  // All public lanes in v1 are HUMAN; an admission cannot use a provisional
  // label to sneak in a self-declared AI or tool-assisted run.
  if (request.assistance !== 'human') return value('invalid', 'nonhuman-on-human-board');
  if (s === null || s === undefined) return TRUST.missing;
  if (!keys(s, ['kind', 'runId', 'buildId', 'verifierBuildId', 'verifiedCourse', 'score', 'endTick', 'tapeComplete', 'assistanceObserved', 'record']) ||
      s.kind !== 'trusted-replay-execution' || !bounded(s.runId) || !bounded(s.buildId) ||
      !(isDigest(s.verifierBuildId) || s.verifierBuildId === null) || !integer(s.score) || !integer(s.endTick) || typeof s.tapeComplete !== 'boolean' ||
      !ASSISTANCE.includes(s.assistanceObserved)) return TRUST.malformed;
  try { validateOutcomeRecord(s.record); } catch { return TRUST.malformed; }
  // For historical pinned bundles, the verifier ID IS the publisher bundle
  // content digest. A different executable hash is contradictory provenance.
  if (isDigest(s.record.verifierId) && s.record.verifierId !== s.verifierBuildId)
    return value('invalid', 'verifier-bundle-digest-mismatch');
  // A verifier that does not exist has no executable build digest. This is
  // legitimate ONLY for a refusal explicitly naming verifier unavailability.
  if (s.verifierBuildId === null &&
      !(s.record.outcome === 'refused' && UNAVAILABLE_VERIFIER.includes(s.record.reason)))
    return TRUST.malformed;
  // These identity fields exist even for a refusal or legacy verdict. A
  // refusal from some OTHER submission cannot trigger provisional publishing.
  if (s.runId !== request.runId || s.buildId !== request.buildId ||
      s.record.manifestDigest !== request.manifestDigest ||
      s.record.tapeDigest !== request.tapeDigest)
    return value('invalid', 'simulation-identity-mismatch');
  if (s.record.outcome !== 'refused' && s.record.verifiedUnder !== request.rulesetId)
    return value('invalid', 'simulation-ruleset-mismatch');
  if (s.record.outcome === 'refused' &&
      (!OWN(s.record, 'claimedRulesetId') || s.record.claimedRulesetId !== request.rulesetId))
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
    'loadoutDigest', 'manifestDigest', 'tapeDigest', 'score', 'endTick', 'challengeId', 'challengeStatus', 'economyStatus', 'equipmentStatus', 'modeStatus', 'pinnedVerifierBuildId'];
  if (!keys(a, req) || a.kind !== 'trusted-eligibility-receipt' ||
      !['authorized', 'denied', 'pending'].includes(a.status) ||
      !bounded(a.runId) || !bounded(a.buildId) || !isDigest(a.rulesetId) || !seedText(a.seed) ||
      !integer(a.biomeMask) || !LANES.includes(a.lane) || !isDigest(a.loadoutDigest) || !isDigest(a.manifestDigest) ||
      !isDigest(a.tapeDigest) || !integer(a.score) || !integer(a.endTick) ||
      !(a.challengeId === null || bounded(a.challengeId)) ||
      !['fresh', 'expired', 'reused', 'missing'].includes(a.challengeStatus) ||
      !['authorized', 'rejected', 'missing'].includes(a.economyStatus) ||
      !['authorized', 'rejected', 'missing'].includes(a.equipmentStatus) ||
      !['allowed', 'denied', 'missing'].includes(a.modeStatus) || !isDigest(a.pinnedVerifierBuildId)) return TRUST.malformed;
  for (const key of ['runId','buildId','rulesetId','seed','biomeMask','lane','loadoutDigest','manifestDigest','tapeDigest','score','endTick','challengeId'])
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
  if (!keys(c, ['kind', 'status', 'runId', 'manifestDigest', 'tapeDigest', 'score', 'endTick', 'seed', 'biomeMask', 'lane', 'loadoutDigest', 'intent', 'scope', 'audienceGate']) ||
      c.kind !== 'trusted-consent-receipt' ||
      !['granted','denied','pending'].includes(c.status) || !bounded(c.runId) ||
      !isDigest(c.manifestDigest) || !isDigest(c.tapeDigest) || !integer(c.score) || !integer(c.endTick) ||
      !seedText(c.seed) || !integer(c.biomeMask) || !LANES.includes(c.lane) || !isDigest(c.loadoutDigest) ||
      !['provisional-public','verified-public'].includes(c.intent) ||
      !['score-only', 'score-and-evidence'].includes(c.scope) ||
      !['passed','failed','pending'].includes(c.audienceGate)) return TRUST.malformed;
  if (c.runId !== request.runId) return value('invalid', 'consent-run-mismatch');
  if (c.manifestDigest !== request.manifestDigest || c.tapeDigest !== request.tapeDigest ||
      c.score !== request.score || c.endTick !== request.endTick ||
      c.seed !== request.seed || c.biomeMask !== request.biomeMask ||
      c.lane !== request.lane || c.loadoutDigest !== request.loadoutDigest)
    return value('invalid', 'consent-submission-mismatch');
  if (c.intent !== request.intent) return value('invalid', 'consent-intent-mismatch');
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
function adjudicateDualProofCore(input = {}) {
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

/**
 * Treat a trust decision as a snapshot, not a live object graph. Read each
 * property ONLY through its *own data descriptor*, copy that value into a
 * fresh plain JSON tree, then encode ONLY the copy. Do not JSON.stringify the
 * original: stateful Proxy `get` traps or inherited `toJSON` may change the
 * authorization/consent **after** validation, while still passing the first
 * descriptor traversal. Neither a property name nor an issuer label is proof
 * that the upstream adapter authenticated the original source.
 *
 * Be deliberately stricter than JSON.stringify: accessors, inherited fields,
 * symbol keys, sparse arrays, custom prototypes, cycles, nonfinite numbers,
 * negative zero and hidden own properties all fail closed. Budgets bound depth,
 * total nodes/keys and serialized size; the canonical encoder is run only on
 * our defensively reconstructed tree, never on the untrusted input object.
 */
const MAX_TRUST_BYTES = 256 * 1024;

function snapshotInput(input){
  const ancestors=new WeakSet();
  let budget=0, remaining=MAX_TRUST_BYTES;
  const charge=(size)=>{
    remaining-=size;
    if(remaining<0)throw new TypeError('oversized trust input');
  };
  // Count the quoted BB-CJSON token without allocating an escaped string.
  // Scan no further than the remaining budget; canonicalBytes still validates
  // the reconstructed value and is the source of truth for canonical bytes.
  const chargeString=(s)=>{
    charge(2); // quotes
    if(s.length>remaining)throw new TypeError('oversized trust string');
    for(let i=0;i<s.length;i++){
      const c=s.charCodeAt(i);
      if(c===0x22||c===0x5c||c===8||c===9||c===10||c===12||c===13)charge(2);
      else if(c<0x20)charge(6);
      else if(c<0x80)charge(1);
      else if(c<0x800)charge(2);
      else if(c>=0xd800&&c<=0xdbff){
        const tail=s.charCodeAt(++i);
        if(!(tail>=0xdc00&&tail<=0xdfff))throw new TypeError('invalid trust string');
        charge(4);
      }else{
        if(c>=0xdc00&&c<=0xdfff)throw new TypeError('invalid trust string');
        charge(3);
      }
    }
  };
  const copy=(v,depth)=>{
    if(++budget>12000||depth>16)throw new TypeError('unbounded trust input');
    if(v===null){charge(4);return v;}
    if(typeof v==='boolean'){charge(v?4:5);return v;}
    if(typeof v==='string'){chargeString(v);return v;}
    if(typeof v==='number'){
      if(!Number.isFinite(v)||Object.is(v,-0))throw new TypeError('invalid trust number');
      charge(String(v).length);
      return v;
    }
    if(typeof v!=='object'||ancestors.has(v))throw new TypeError('non-JSON trust input');
    const array=Array.isArray(v);
    // Arrays also need the native JSON-shaped prototype. Otherwise Array
    // subclasses or prototype-swizzled arrays bypass the object check.
    if(array){
      if(Object.getPrototypeOf(v)!==Array.prototype)throw new TypeError('exotic trust array');
    }else if(!isObj(v))throw new TypeError('exotic trust input');
    ancestors.add(v);
    try{
      const keys=Reflect.ownKeys(v);
      budget+=keys.length;
      if(keys.length>4096||budget>12000)throw new TypeError('oversized trust input');
      // Snapshot this node's descriptors before descending into any child.
      const descriptors=new Map();
      for(const key of keys){
        if(typeof key!=='string')throw new TypeError('symbol trust property');
        const d=Object.getOwnPropertyDescriptor(v,key);
        if(!d||!OWN(d,'value')||(!d.enumerable&&!(array&&key==='length')))
          throw new TypeError('accessor or hidden trust property');
        descriptors.set(key,d);
      }
      if(array){
        const size=descriptors.get('length')?.value;
        if(!Number.isSafeInteger(size)||size<0||size>4095||keys.length!==size+1)
          throw new TypeError('sparse or decorated trust array');
        charge(2+Math.max(0,size-1)); // brackets and commas
        const result=[];
        for(let i=0;i<size;i++){
          const d=descriptors.get(String(i));
          if(!d)throw new TypeError('sparse trust array');
          result.push(copy(d.value,depth+1));
        }
        return result;
      }
      charge(2+Math.max(0,keys.length-1)+keys.length); // braces, commas, colons
      const result=Object.create(null); // no Object.prototype.toJSON or prototype setters
      for(const key of keys){
        chargeString(key);
        const d=descriptors.get(key);
        Object.defineProperty(result,key,{value:copy(d.value,depth+1),
          enumerable:true,writable:true,configurable:true});
      }
      return result;
    }finally{ancestors.delete(v);}
  };
  const stable=copy(input,0);
  const encoded=canonicalBytes(stable);
  if(encoded.length!==MAX_TRUST_BYTES-remaining)throw new TypeError('trust input size mismatch');
  return parseCanonical(encoded);
}

/** Fail closed even when a programmatic caller supplies hostile objects,
 * proxies, throwing accessors or exotic prototypes instead of parsed JSON.
 * Unexpected property failures do not authorize a score and do not escape.
 */
export function adjudicateDualProof(input = {}) {
  try { return adjudicateDualProofCore(snapshotInput(input)); }
  catch {
    return Object.freeze({
      format: DUAL_PROOF_FORMAT, version: DUAL_PROOF_VERSION,
      proof: TRUST.malformed, eligibility: TRUST.malformed,
      competitiveness: TRUST.malformed, privacy: TRUST.malformed,
      provenance: Object.freeze({simulationVerifierId:null,pinnedVerifierBuildId:null,verifiedUnder:null,consentScope:null}),
      publication:'none', verifiedRankEligible:false, publicRewardEligible:false,
      provisionalLabel:null,
    });
  }
}
