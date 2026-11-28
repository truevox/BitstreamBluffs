/** #134: actual browser module Worker transport for deterministic #134 batch
 * scheduler. NO trained brains, no actual SimWorld, no virtual currency,
 * no external services. Own-site defaults to one worker/Sim-Slot.
 */
import {runEpisodeBatch,MAX_SIMULTANEOUS_EPISODES,MAX_EPISODES_PER_BATCH} from './episode-batch.mjs';

export const LAB_WORKER_TRANSPORT_ABI=1;
const bad=()=>({ok:false,code:'worker-unavailable'});
const validScore=r=>r&&r.kind==='lab-result'&&Number.isSafeInteger(r.id)&&
 Number.isSafeInteger(r.index)&&Number.isSafeInteger(r.seed)&&Number.isSafeInteger(r.score)&&r.score>=0;

/** WorkerFactory is injectable for fault tests. Real production-like mode uses
 * module URL resolved by Vite, never eval or Blob code. Every batch owns the
 * workers; all are terminated after success, cancellation or failure.
 */
export async function runBrowserWorkerBatch({campaignSeed,count,concurrency=1,signal,
 workerFactory=()=>new Worker(new URL('./worker-probe.js',import.meta.url),{type:'module'}),
 timeoutMs=15000}={}){
 // Validate parameters BEFORE allocating any browser workers.
 if(typeof workerFactory!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000||
  !Number.isSafeInteger(concurrency)||concurrency<1||concurrency>MAX_SIMULTANEOUS_EPISODES||
  typeof campaignSeed!=='string'||!campaignSeed||campaignSeed.length>256||
  !Number.isSafeInteger(count)||count<0||count>MAX_EPISODES_PER_BATCH||
  (signal!==undefined&&(!signal||typeof signal.aborted!=='boolean')))
  throw new TypeError('Invalid worker transport configuration');
 // Use the scheduler's original strict contract, including the empty batch,
 // while avoiding unnecessary Worker startup for a pre-aborted request.
 if(signal?.aborted)return {ok:false,code:'aborted'};
 const workers=[];const idle=[];const waiting=[];const active=new Map();
 const terminated=new WeakSet();
 const stopWorker=worker=>{if(terminated.has(worker))return;terminated.add(worker);
  try{worker.terminate();}catch{}};
 let closed=false,id=0;
 const settle=(worker,problem,result)=>{
  const flight=active.get(worker);
  if(!flight)return;
  active.delete(worker);
  clearTimeout(flight.timer);
  if(problem){
   // A failed or untrusted worker is quarantined, not reused for later jobs.
   closed=true;flight.reject(new Error(problem));
   for(const queued of waiting.splice(0))queued.reject(Error('worker-failed'));
   for(const [other,pending] of active){active.delete(other);clearTimeout(pending.timer);
    pending.reject(Error('worker-failed'));}
   for(const w of workers)stopWorker(w)
  }else{
   flight.resolve(result);
   if(!closed){idle.push(worker);flush();}
  }
 };
 const flush=()=>{
  while(!closed&&idle.length&&waiting.length){
   const worker=idle.pop(),flight=waiting.shift();
   if(signal?.aborted){flight.reject(Error('aborted'));idle.push(worker);continue;}
   active.set(worker,flight);
   flight.timer=setTimeout(()=>settle(worker,'timeout'),timeoutMs);
   try{worker.postMessage({kind:'lab-probe',id:flight.id,index:flight.index,seed:flight.seed});}
   catch{settle(worker,'post-failed');}
  }
 };
 const runEpisode=({index,seed})=>new Promise((resolve,reject)=>{
  if(closed||signal?.aborted){reject(Error('aborted'));return;}
  waiting.push({id:id++,index,seed,resolve,reject,timer:null});flush();
 });
 const abort=()=>{
  closed=true;
  for(const flight of waiting.splice(0))flight.reject(Error('aborted'));
  for(const [worker,flight] of active){
   active.delete(worker);clearTimeout(flight.timer);flight.reject(Error('aborted'));
  }
  for(const worker of workers)stopWorker(worker)
 };
 try{
  if(count>0){
   for(let i=0;i<Math.min(concurrency,count);i++){
    const worker=workerFactory(i);
    if(!worker||typeof worker.postMessage!=='function'||typeof worker.terminate!=='function'||
     typeof worker.addEventListener!=='function')return bad();
    workers.push(worker);idle.push(worker);
    worker.addEventListener('message',event=>{
     const flight=active.get(worker);
     if(!flight)return;
     const data=event.data;
     if(!validScore(data)||data.id!==flight.id||data.index!==flight.index||data.seed!==flight.seed)
      settle(worker,'bad-result');
     else settle(worker,null,{index:data.index,seed:data.seed,score:data.score});
    });
    worker.addEventListener('error',()=>settle(worker,'worker-error'));
    worker.addEventListener('messageerror',()=>settle(worker,'message-error'));
   }
  }
  signal?.addEventListener?.('abort',abort,{once:true});
  // runEpisodeBatch is the authoritative index/seed/order/abort logic.
  return await runEpisodeBatch({campaignSeed,count,concurrency,runEpisode,signal});
 }catch{return bad();}
 finally{
  closed=true;
  signal?.removeEventListener?.('abort',abort);
  for(const flight of waiting.splice(0))flight.reject(Error('closed'));
  for(const [worker,flight] of active){
   active.delete(worker);clearTimeout(flight.timer);flight.reject(Error('closed'));
  }
  for(const worker of workers)stopWorker(worker)
 }
}
