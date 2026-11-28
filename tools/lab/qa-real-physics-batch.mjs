/** #134/#122 isolated REAL RunScene/Matter multi-episode Worker QA.
 * This is not the production training pool. No reward, writes or attestation.
 */
import {runEpisodeBatch} from './episode-batch.mjs';
import {evaluateLabWorkerBudget} from '../../src/systems/lab/LabResourceGovernor.js';

/** Sequential/parallel ordering comes solely from #134's approved scheduler.
 * Worker constructor is injectable; callers provide external, truthful
 * entitlement and hardware signals rather than fabricating capacity.
 */
export async function runRealPhysicsQaBatch({campaignSeed,count,requestedSlots,authorizedSlots,
 activeWorkers,rideActive,visibility='visible',hardwareConcurrency,
 deviceMemoryGiB,schoolPreset=false,signal,workerFactory,
 timeoutMs=12000}={}){
 const budget=evaluateLabWorkerBudget({authorizedSlots,requestedSlots,activeWorkers,
  rideActive,visibility,hardwareConcurrency,deviceMemoryGiB,schoolPreset});
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)
  throw new TypeError('Invalid real physics Worker timeout');
 if(signal?.aborted)return {ok:false,code:'aborted',budget};
 if(!budget.startsAvailable)return {ok:false,code:'admission-held',budget};
 const create=workerFactory??(()=>new Worker(new URL('./qa-real-physics-worker.mjs',import.meta.url),{type:'module'}));
 // Each independent task owns a worker. Deliberately QA-only: expensive worker
 // startup is not a proposed production worker reuse strategy.
 const runEpisode=({index,seed,signal:batchSignal})=>new Promise((resolve,reject)=>{
  let worker,timer,settled=false;
  const finish=(err,result)=>{
   if(settled)return;settled=true;
   clearTimeout(timer);batchSignal?.removeEventListener?.('abort',abort);
   try{worker?.terminate();}catch{}
   if(err)reject(err);else resolve(result);
  };
  const abort=()=>finish(Error('aborted'));
  if(batchSignal?.aborted){finish(Error('aborted'));return;}
  try{
   worker=create();
   if(!worker||typeof worker.postMessage!=='function'||typeof worker.terminate!=='function')
    throw Error('Worker unavailable');
   worker.onmessage=event=>{
    const data=event.data;
    if(data?.kind!=='physics-qa-result'||data.id!==index||
     data.result?.seed!==`lab-physics-v1/${seed}`||
     !Number.isSafeInteger(data.result?.tick)||!Array.isArray(data.result?.checkpoints))
     finish(Error('Untrusted physics Worker response'));
    else finish(null,data.result);
   };
   worker.onerror=()=>finish(Error('Physics Worker error'));
   worker.onmessageerror=()=>finish(Error('Physics Worker deserialization failure'));
   batchSignal?.addEventListener?.('abort',abort,{once:true});
   if(batchSignal?.aborted){abort();return;}
   timer=setTimeout(()=>finish(Error('Physics Worker timeout')),timeoutMs);
   worker.postMessage({kind:'run-physics-qa',id:index,spec:{
    seed:`lab-physics-v1/${seed}`,biomeMask:3,policy:'tricks',ticks:360}});
  }catch(err){finish(err);}
 });
 const response=await runEpisodeBatch({campaignSeed,count,
  concurrency:budget.startsAvailable,runEpisode,signal});
 return {...response,budget};
}
