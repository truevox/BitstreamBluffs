/** #424 manual Pause -> durable one-use slot -> retire source.
 *
 * This is a deliberate player action, NOT automatic background saving.
 * There must never be a live source run and a supposedly "suspended"
 * run concurrently after a successful write. Fail-closed: if retirement
 * cannot be proven, the host keeps the original PAUSED and locked.
 * No UI is registered by importing this module.
 */
import {captureManualPauseCandidate} from './pausedCandidate.js';
import {candidateSuspendEnvelopeBytes,candidateSuspendLayout} from './candidateSuspendEnvelope.js';
import {LocalSuspendSlot} from './localSuspendSlot.js';

const bool=v=>v===true;
const paused=run=>!!run&&run._manualPausePending===true&&
 run.scene?.isPaused?.('RunScene')===true&&
 Number.isSafeInteger(run.simClock?.tick)&&run.simClock.tick>0;
const negative=(code,extra={})=>({ok:false,code,...extra});
/** Only explicit pre-write refusals or a proven aborted transaction can
 * release the original pause. A lost acknowledgement MAY follow a commit. */
const NO_WRITE=new Set([
 'quota-exceeded','slot-occupied','slot-claimed','invalid-slot-state',
 'invalid-bytes','unsupported-layout','not-suspend','missing-runtime-identity',
 'build-mismatch','physics-mismatch','matter-mismatch','layout-mismatch',
 'invalid-section','digest-mismatch','invalid-envelope',
]);

/**
 * @param {object} opts
 * @param {RunScene} opts.run - genuinely paused native run
 * @param {object} opts.Phaser - trusted shipped Phaser
 * @param {object} opts.identity - current exact build descriptor
 * @param {LocalSuspendSlot} [opts.slot] - existing one-use IndexedDB store
 * @param {function} opts.retire - sync, host-owned scene-stop operation,
 *   returns TRUE only if original RunScene can no longer execute.
 *
 * Returns NO eligibility, rank, wallet or public-proof claim.
 */
export async function suspendPausedSource({
 run,Phaser,identity,slot=new LocalSuspendSlot(),retire,
}={}){
 if(!paused(run)||typeof retire!=='function')return negative('not-paused');
 // No IndexedDB API: no transaction could have started. Safe to unlock
 // without touching a captured causal state.
 if(slot instanceof LocalSuspendSlot&&(!slot.idb||typeof slot.idb.open!=='function'))
  return negative('storage-unavailable');
 const initial=run.simClock.tick;
 let candidate,envelope;
 try{
  candidate=captureManualPauseCandidate(run,Phaser);
  envelope=candidateSuspendEnvelopeBytes(candidate,identity);
  if(!paused(run)||run.simClock.tick!==initial)return negative('source-moved');
 }catch{return negative('capture-refused');}
 return commitPausedSource({run,initial,envelope,slot,identity,retire});
}
/** Internal commit seam: supplied bytes MUST already be strictly envelope-sealed
 * by the trusted capture method above. Not an external game-file entrypoint. */
export async function commitPausedSource({run,initial,envelope,slot,identity,retire}){
 let saved;
 try{saved=await slot.put(envelope,identity,candidateSuspendLayout);}
 catch{return negative('write-outcome-unknown',{locked:true});}
 if(!bool(saved?.ok)||!bool(saved.saved)){
  const code=saved?.code||'unknown';
  return NO_WRITE.has(code)?negative(code)
   :negative('write-outcome-unknown',{locked:true,cause:code});
 }
 // No more IO allowed between the durable slot commit and source
 // retirement. Even an unexpected source movement must retire the
 // source rather than allowing a double-play of the checkpoint.
 let left=false;
 try{left=retire()===true;}catch{left=false;}
 if(!left)return negative('source-retirement-uncertain',{saved:true,locked:true,runId:saved.runId,tick:saved.tick});
 return {ok:true,saved:true,retired:true,runId:saved.runId,tick:saved.tick,bytes:saved.bytes};
}
