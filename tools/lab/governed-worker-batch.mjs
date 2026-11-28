/** #453/#134: admission AND cancellation bridge around the REAL #134
 * browser Worker transport. Still a Rng DIAGNOSTIC, NOT #122 SimWorld.
 * Requires explicit owner-authorized slots and honest active-worker count.
 * No score/payment/Verified/training authority or app-side auto boot.
 */
import {evaluateLabWorkerBudget,readBrowserLabSignals} from '../../src/systems/lab/LabResourceGovernor.js';
import {runBrowserWorkerBatch} from './worker-episode-batch.mjs';

const denied=budget=>({ok:false,code:'admission-held',budget});
// Per-module, per-tab reservations. Another invocation cannot spend a slot
// already committed to a batch even when both callers report activeWorkers=0.
// This is NOT a cross-tab or Steam Cloud entitlement lock.
let reservedWorkerSlots=0;
const isVisible=documentRef=>{
 try{if(documentRef?.visibilityState==='visible')return true;
  if(documentRef?.visibilityState==='hidden')return false;
  return documentRef?.hidden===false;}
 catch{return false;}
};

export async function runGovernedBrowserWorkerBatch({
 campaignSeed,count,authorizedSlots,requestedSlots,activeWorkers,rideActive,
 schoolPreset=false,signal,rideStartSignal,
 navigatorRef=globalThis.navigator,documentRef=globalThis.document,
 workerFactory,timeoutMs,
}={}){
 // Missing/invalid authorization is a programmer error, not permission to
 // default to three Steam Sim-Slots or fabricate available worker count.
 if(!Number.isSafeInteger(authorizedSlots)||!Number.isSafeInteger(requestedSlots)||
  !Number.isSafeInteger(activeWorkers)||typeof rideActive!=='boolean'||
  (rideStartSignal!==undefined&&(!rideStartSignal||typeof rideStartSignal.aborted!=='boolean'))||
  (signal!==undefined&&(!signal||typeof signal.aborted!=='boolean')))
  throw new TypeError('Explicit Lab slots, active workers, Ride state and signals required');
 if(signal?.aborted||rideStartSignal?.aborted)return {ok:false,code:'aborted'};
 const sampled=await readBrowserLabSignals({navigatorRef,documentRef});
 // Visibility may change while an async Battery API resolves: sample again
 // immediately before admission rather than trusting an earlier value.
 let visibility=sampled.visibility;
 try{
  if(documentRef?.visibilityState==='hidden')visibility='hidden';
  else if(documentRef?.visibilityState==='visible')visibility='visible';
  else if(documentRef?.hidden===true)visibility='hidden';
 }catch{visibility='unknown';}
 const budget=evaluateLabWorkerBudget({authorizedSlots,requestedSlots,
  activeWorkers,rideActive,schoolPreset,visibility,
  hardwareConcurrency:sampled.hardwareConcurrency,
  deviceMemoryGiB:sampled.deviceMemoryGiB,
  batteryLevel:sampled.batteryLevel,batteryCharging:sampled.batteryCharging,
  pressure:sampled.pressure});
 if(signal?.aborted||rideStartSignal?.aborted)return {ok:false,code:'aborted'};
 const admittedLanes=Math.min(budget.startsAvailable,
  Math.max(0,budget.admissionLimit-reservedWorkerSlots));
 if(admittedLanes===0)return denied(budget);
 reservedWorkerSlots+=admittedLanes; // synchronized before any more awaits
 const ctrl=new AbortController();
 const abort=()=>ctrl.abort();
 const onVisibility=()=>{
  if(!isVisible(documentRef))abort();
 };
 try{
  signal?.addEventListener?.('abort',abort,{once:true});
  rideStartSignal?.addEventListener?.('abort',abort,{once:true});
  documentRef?.addEventListener?.('visibilitychange',onVisibility);
  if(signal?.aborted||rideStartSignal?.aborted)abort();
  onVisibility(); // Fail closed if state changed during listener wiring.
  if(ctrl.signal.aborted)return {ok:false,code:'aborted'};
  const result=await runBrowserWorkerBatch({campaignSeed,count,
   concurrency:admittedLanes,signal:ctrl.signal,
   ...(workerFactory!==undefined?{workerFactory}:{}),
   ...(timeoutMs!==undefined?{timeoutMs}:{})});
  return {...result,budget};
 }finally{
  reservedWorkerSlots-=admittedLanes;
  ctrl.abort();
  signal?.removeEventListener?.('abort',abort);
  rideStartSignal?.removeEventListener?.('abort',abort);
  documentRef?.removeEventListener?.('visibilitychange',onVisibility);
 }
}
