/** Single-use local suspend transaction. No automatic UI installation.
 * The trusted scene host MUST provide a genuinely quarantined disposable
 * candidate (no simulation, input, rewards, audio or publication while
 * staged) and prove disposal on every pre-consumption failure.
 *
 * IndexedDB and live scene publication cannot be one ACID transaction:
 * consume durably FIRST, then publish. If publication fails or the tab
 * dies after consume, the save is spent. Never reinsert or auto-retry.
 */
import {openSuspendCandidate} from './candidateAdmission.js';

const sameBytes=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&a.length===b.length&&a.every((x,i)=>x===b[i]);
const bad=(code,claimState,extra={})=>({ok:false,code,claimState,...extra});
const good=(c)=>({ok:true,code:'resumed',claimState:'consumed',runId:c.runId,tick:c.tick});
const method=(o,k)=>typeof o?.[k]==='function';
async function discarded(stage){
 try{return method(stage,'discard')&&(await stage.discard())===true;}
 catch{return false;}
}
/**
 * Only a trusted host may supply createStage. The host's discard() must
 * prove that the candidate can never execute or publish and that the
 * prior world is unchanged. Do not substitute a mutable live RunScene.
 * The stage must expose:
 *  restore(file) - restore while quarantined (no simulation).
 *  capture() - canonical whole-file recapture of the staged scene.
 *  isQuarantined() - positive liveness/publication gate, checked twice.
 *  discard() - explicit, verified permanent disposal.
 *  publish() - synchronous activation ONLY after durable consumption.
 */
export async function resumeLocalSuspend({slot,identity,layout,createStage}){
 if(!method(slot,'claim')||!method(slot,'release')||!method(slot,'consume')||typeof createStage!=='function')
  return bad('invalid-host','unclaimed');
 let claim;
 try{claim=await slot.claim(identity,layout);}catch{return bad('claim-uncertain','unknown');}
 if(claim?.ok!==true)return bad(claim?.code||'claim-failed','unclaimed');
 if(claim.admission!=='envelope-only'||typeof claim.token!=='string'||!claim.token||!(claim.bytes instanceof Uint8Array))
  return bad('invalid-claim','held');
 let stage;
 async function failBeforeConsume(code){
  if(!await discarded(stage))return bad(code,'held',{discarded:false});
  let released;try{released=await slot.release(claim.token);}catch{return bad('release-uncertain','unknown',{discarded:true});}
  return released?.ok===true&&released.released===true
   ?bad(code,'released',{discarded:true}):bad(released?.code||'release-failed','held',{discarded:true,cause:code});
 }
 let opened;
 try{opened=openSuspendCandidate(claim.bytes,identity,layout);
  if(opened.runId!==claim.runId||opened.tick!==claim.tick)throw Error('claim binding');}
 catch{
  // No candidate has been created; no live state can have changed.
  try{
   const released=await slot.release(claim.token);
   return released?.ok===true&&released.released===true?bad('invalid-envelope','released'):bad('release-failed','held');
  }catch{return bad('release-uncertain','unknown');}
 }
 try{
  stage=await createStage(Object.freeze({runId:opened.runId,tick:opened.tick,seed:opened.seed}));
  if(!['restore','capture','isQuarantined','discard','publish'].every(k=>method(stage,k))||stage.isQuarantined()!==true)
   throw Error('invalid quarantine');
  // Keep our own immutable reference copy. A stage may not change the
  // expected file by mutating its input buffer.
  await stage.restore(Uint8Array.from(opened.file));
  if(stage.isQuarantined()!==true)throw Error('quarantine lost');
  const recaptured=await stage.capture();
  if(!sameBytes(recaptured,opened.file)||stage.isQuarantined()!==true)throw Error('recapture mismatch');
 }catch{return failBeforeConsume('restore-refused');}
 // Do not release after an uncertain consume. A crash/disconnect may have
 // committed the deletion even though the response never arrived.
 let consumed;
 try{consumed=await slot.consume(claim.token);}catch{
  return bad('consume-uncertain','unknown',{discarded:await discarded(stage)});
 }
 if(consumed?.ok!==true||consumed.consumed!==true)
  return bad(consumed?.code||'consume-failed','held',{discarded:await discarded(stage)});
 // No asynchronous gap between final quarantine check and synchronous
 // publication. Host is responsible for preventing work while quarantined.
 try{
  if(stage.isQuarantined()!==true||stage.publish()!==true)throw Error('publish refused');
  return good(opened);
 }catch{
  return bad('publish-failed','consumed',{discarded:await discarded(stage)});
 }
}
