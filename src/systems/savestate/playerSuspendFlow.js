/**
 * #424 local-only, stock/base-biome, one-use player Suspend/Resume transaction.
 * No player data leaves this browser. This is NOT public Verified/rank proof.
 * Exact current build and canonical native scene codec are both mandatory.
 */
import {loadCurrentBuildDescriptor} from './runtimeIdentity.js';
import {LocalSuspendSlot} from './localSuspendSlot.js';
import {candidateSuspendLayout,candidateSuspendEnvelopeBytes,
 inspectCandidateSuspendEnvelope} from './candidateSuspendEnvelope.js';
import {captureManualPauseCandidate} from './pausedCandidate.js';
import {createCandidateStateCodec} from './candidateState.js';
import {parseCanonical} from '../replay/canonicalJson.js';

const error=e=>e?.message||'local-suspend:unavailable';
const fail=(code)=>({ok:false,code});

// Keep instructions specific; no silent old-version migration or slot eviction.
export function suspendMessage(code){
 const messages={
  empty:'NO SUSPENDED RUN',ready:'SUSPENDED RUN READY',
  claimed:'SAVE LOCKED IN ANOTHER TAB',
  'slot-claimed':'SAVE LOCKED - DO NOT CLEAR',
  'slot-occupied':'SAVED RUN EXISTS - RESUME FIRST',
  'quota-exceeded':'STORAGE FULL - RUN NOT SAVED',
  'storage-unavailable':'STORAGE BLOCKED - RUN NOT SAVED',
  'build-mismatch':'SAVE IS FROM ANOTHER VERSION',
  'unsupported-layout':'SAVE FORMAT NOT SUPPORTED',
  'invalid-bytes':'SAVE DAMAGED - NOT ERASED',
  'binding-mismatch':'SAVE INCONSISTENT - NOT ERASED',
  'identity-unavailable':'BUILD ID UNAVAILABLE',
  'resume:nonbase':'ONLY BASE BIOME SAVES SUPPORTED',
  'suspend:unsupported-active-run':'ONLY STOCK BASE RUNS CAN SUSPEND',
  'suspend:manual-pause-required':'PAUSE RUN BEFORE SUSPEND',
  'resume:invalid':'SUSPEND CANNOT BE RESTORED',
  'resume:consume-failed':'SUSPEND LOCKED - NOT ERASABLE',
  'resume:scene-failed':'RESTORE REFUSED - SLOT KEPT',
 };
 return messages[code]||('SUSPEND ERROR: '+String(code||'UNKNOWN').slice(0,48));
}

async function currentIdentity(run,loader){
 try{
  const identity=await loader();
  if(!identity?.buildId||run?.registry?.get?.('currentBuildId')&&
      identity.buildId!==run.registry.get('currentBuildId')) return fail('identity-unavailable');
  return {ok:true,identity};
 }catch{return fail('identity-unavailable');}
}

/** Observe storage without claiming or changing it, for Title menu display. */
export async function peekPlayerSuspend({slot=new LocalSuspendSlot(),identityLoader=loadCurrentBuildDescriptor}={}){
 const id=await currentIdentity(null,identityLoader);
 return id.ok?slot.peek(id.identity,candidateSuspendLayout):id;
}

/** Explicit destructive cleanup of a READY, incompatible/corrupt save.
 * Never auto-erase or steal CLAIMED tokens; requires double player consent
 * at the Title UI, not triggered on opening game or version mismatch.
 */
export async function discardPlayerSuspend({slot=new LocalSuspendSlot()}={}){
 try{return await slot.clearReady();}
 catch{return fail('storage-unavailable');}
}

/** While the actual RunScene is paused, preserve an immutable canonical full
 * candidate inside the existing atomically owned single-use IndexedDB slot.
 * Never overwrite existing data; a failed save leaves the original live run.
 */
export async function savePlayerSuspend(run,Phaser,{slot=new LocalSuspendSlot(),identityLoader=loadCurrentBuildDescriptor}={}){
 const id=await currentIdentity(run,identityLoader);
 if(!id.ok)return id;
 let bytes;
 try{
  const candidate=captureManualPauseCandidate(run,Phaser);
  bytes=candidateSuspendEnvelopeBytes(candidate,id.identity);
 }catch(e){return fail(error(e));}
 return slot.put(bytes,id.identity,candidateSuspendLayout);
}

/** Claim exactly once, with atomic validation before any navigation away from
 * Title. The caller must stage a disposable fresh RunScene, then consume only
 * after full native zero-tick restoration succeeds. */
export async function claimPlayerSuspend({slot=new LocalSuspendSlot(),identityLoader=loadCurrentBuildDescriptor}={}){
 const id=await currentIdentity(null,identityLoader);
 if(!id.ok)return id;
 const claim=await slot.claim(id.identity,candidateSuspendLayout);
 if(!claim.ok)return claim;
 const inspected=inspectCandidateSuspendEnvelope(claim.bytes,id.identity);
 if(!inspected.ok){
  const released=await slot.release(claim.token);
  return fail(released.ok?inspected.code:'slot-claimed');
 }
 let source;
 try{source=parseCanonical(inspected.candidateBytes);}catch{source=null;}
 // Initial supported scope: basic base-biome runs only. Do not guess a
 // biome mask, loadout or special mode from unreviewed stored fields.
 if(!source||typeof source.seed!=='string'||!source.seed||source.seed.length>256){
  const released=await slot.release(claim.token);
  return fail(released.ok?'resume:invalid':'slot-claimed');
 }
 return {ok:true,token:claim.token,slot,identity:id.identity,
  bytes:Uint8Array.from(claim.bytes),candidateBytes:Uint8Array.from(inspected.candidateBytes),
  seed:source.seed,runId:source.runId,tick:source.tick,biomeMask:0};
}

/** Restore source into a FRESH, invisible and non-ticking RunScene. Caller
 * owns the Phaser lifecycle and must discard scene on any error; this helper
 * never starts a scene or grants game awards. Returns only after successful
 * storage consume, preventing two-tab duplication. */
export async function restorePlayerSuspend(run,Phaser,claim){
 if(!run||!claim?.slot||!claim?.token||!(claim.candidateBytes instanceof Uint8Array))
  return fail('resume:invalid');
 const id=await currentIdentity(run,()=>Promise.resolve(claim.identity));
 if(!id.ok)return id;
 if(run.simClock?.tick!==0||run.seed!==claim.seed||run.biomeMask!==0)
  return fail('resume:nonbase');
 try{
  const verify=inspectCandidateSuspendEnvelope(claim.bytes,id.identity);
  if(!verify.ok)return fail(verify.code);
  const codec=createCandidateStateCodec(Phaser);
  // Codec.prepare checks the complete eight-section schema, source profile
  // configuration, Matter/native links and recorder before mutable restore.
  codec.prepare(run,claim.candidateBytes);
  codec.restore(run,claim.candidateBytes);
  if(run.simClock.tick!==claim.tick||run.runId!==claim.runId)
   return fail('resume:scene-failed');
  const consumed=await claim.slot.consume(claim.token);
  if(!consumed.ok)return fail('resume:consume-failed');
  return {ok:true,restored:true,tick:run.simClock.tick,runId:run.runId};
 }catch(e){return fail('resume:scene-failed');}
}
