/**
 * #424 one-use local suspend ENVELOPE bridge (format and layout only).
 * Never returns a restorable or trusted claim. A real runtime must prepare
 * an isolated fresh scene and perform the one-use consume transaction.
 */
import {canonicalBytes,parseCanonical,asUint8Array} from '../replay/canonicalJson.js';
import {digestOf} from '../replay/canonicalSha256.js';
import {savestateLayoutIdOf} from './layout.js';
import {snapshotEnvelopeBytes,inspectSnapshotEnvelope} from './envelope.js';
import {SAVESTATE_LAYOUT_DESCRIPTOR,CANDIDATE_SECTION_KEYS} from './layoutDeclaration.js';

const HASH=/^sha256:[0-9a-f]{64}$/;
const RUN=/^[A-Za-z0-9_.:-]{1,96}$/;
const HEADER=SAVESTATE_LAYOUT_DESCRIPTOR.sections.candidate.header;
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const unsigned=c=>Object.fromEntries(HEADER.filter(k=>k!=='integrity').map(k=>[k,c[k]]));
const valid=c=>{
 if(!exact(c,HEADER)||c.kind!=='bb-internal-candidate-file'||c.version!==1||
    typeof c.runId!=='string'||!RUN.test(c.runId)||!Number.isSafeInteger(c.tick)||
    c.tick<=0||!HASH.test(c.buildId)||!HASH.test(c.rulesetId)||
    !Number.isSafeInteger(c.simRevision)||c.simRevision<1||
    typeof c.seed!=='string'||c.seed.length===0||c.seed.length>256||
    !exact(c.sections,CANDIDATE_SECTION_KEYS)||!HASH.test(c.integrity))
  return false;
 try{return digestOf(unsigned(c))===c.integrity&&c.sections.clock?.tick===c.tick;}
 catch{return false;}
};

/** Strict outer manifest and SHA-256 seal only; per-class schemas and causal
 * authoritativeness must be checked by createCandidateStateCodec.prepare().
 */
export const candidateSuspendLayout=Object.freeze({
 descriptor:SAVESTATE_LAYOUT_DESCRIPTOR,
 validateSections:(sections,envelope)=>exact(sections,['candidate'])&&valid(sections.candidate)&&
  envelope?.runId===sections.candidate.runId&&envelope?.tick===sections.candidate.tick&&
  envelope?.build?.buildId===sections.candidate.buildId&&
  envelope?.build?.physicsIdentity?.rulesetId===sections.candidate.rulesetId&&
  envelope?.build?.physicsIdentity?.simRevision===sections.candidate.simRevision,
});
export const CANDIDATE_SUSPEND_LAYOUT_ID=savestateLayoutIdOf(SAVESTATE_LAYOUT_DESCRIPTOR);
const match=(candidate,identity)=>identity&&
 identity.savestateLayoutId===CANDIDATE_SUSPEND_LAYOUT_ID&&
 candidate.buildId===identity.buildId&&
 candidate.rulesetId===identity.physicsIdentity?.rulesetId&&
 candidate.simRevision===identity.physicsIdentity?.simRevision;

/** Only a trusted local capture caller may construct a single-use envelope. */
export function candidateSuspendEnvelopeBytes(candidateBytes,expectedIdentity){
 const candidate=parseCanonical(asUint8Array(candidateBytes,'candidate bytes'));
 if(!valid(candidate))throw Error('candidate-suspend:invalid-candidate');
 if(!match(candidate,expectedIdentity))throw Error('candidate-suspend:identity-mismatch');
 return snapshotEnvelopeBytes({
  kind:'bb-savestate-cache',version:1,purpose:'suspend',build:expectedIdentity,
  runId:candidate.runId,tick:candidate.tick,payload:{sections:{candidate}},
 });
}

/** Inspects bounded saved bytes; does NOT validate a live Matter continuation.
 * Do NOT treat admission:'envelope-only' as success/Verified/score authority.
 */
export function inspectCandidateSuspendEnvelope(bytes,expectedIdentity){
 const inspected=inspectSnapshotEnvelope(bytes,expectedIdentity,candidateSuspendLayout);
 if(!inspected.ok)return inspected;
 const {envelope}=inspected,candidate=envelope.payload.sections.candidate;
 if(!valid(candidate)||!match(candidate,expectedIdentity)||
   envelope.runId!==candidate.runId||envelope.tick!==candidate.tick)
  return {ok:false,code:'candidate-binding-mismatch'};
 return {ok:true,admission:'envelope-only',candidateBytes:canonicalBytes(candidate),
  runId:candidate.runId,tick:candidate.tick};
}
