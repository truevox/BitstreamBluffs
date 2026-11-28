/** #134: QA-only measured REAL RunScene/Matter worker throughput.
 * No training, no reward, no model trust or entitlement grant. Concurrency
 * 2/4 is DIAGNOSTIC, never a web Sim-Slot entitlement (web baseline = 1).
 * A separate independently pinned #491 golden physics check must run first.
 */
const LEVELS=Object.freeze([1,2,4]);
const REPEATS=4;
const TIMEOUT_MS=30000;
const round=n=>Math.round(n*100)/100;
const percentile=(values,p)=>values.length?
 values.slice().sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)]:null;

/** Real Chromium Worker starts; results independently checked against exact
 * compiled browser main-thread #491 reports incl native causal fingerprints.
 * The reported RAF gaps are ONLY headless foreground-callback scheduling hints.
 * Browser Worker memory/thermals/physical Chromebook remain unmeasured.
 */
export async function measureRealPhysicsWorkerThroughput({spawn,cases,expected,
 workerCountLevels=LEVELS,requestAnimationFrameRef=globalThis.requestAnimationFrame,
 cancelAnimationFrameRef=globalThis.cancelAnimationFrame,
 performanceRef=globalThis.performance}={}){
 if(typeof spawn!=='function'||!Array.isArray(cases)||cases.length!==3||
  !Array.isArray(expected)||expected.length!==cases.length||
  !Array.isArray(workerCountLevels)||workerCountLevels.some(n=>![1,2,4].includes(n))||
  typeof performanceRef?.now!=='function')
  throw new TypeError('Invalid real-physics throughput QA inputs');
 const reports=[];
 for(const lanes of workerCountLevels){
  // Every lane gets a *real* module Worker, not an async Promise on one JS
  // main thread. The same 12 episodes and same order-independent golden
  // physics workload are compared at 1, 2 and 4 concurrent worker lanes.
  const workers=[];
  let active=0,peak=0,finished=0,raf=null,rafPrevious=null;
  const frameGaps=[],latencies=[],outputs=new Array(cases.length*REPEATS);
  const startedAt=performanceRef.now();
  let metric=null,terminationRequests=0;
  try{
   for(let i=0;i<lanes;i++)workers.push(spawn());
   if(typeof requestAnimationFrameRef==='function'){
    const frame=ts=>{
     if(rafPrevious!==null&&Number.isFinite(ts-rafPrevious)&&ts>=rafPrevious)
      frameGaps.push(ts-rafPrevious);
     rafPrevious=ts;
     raf=requestAnimationFrameRef(frame);
    };
    raf=requestAnimationFrameRef(frame);
   }
   const doJob=(worker,index)=>new Promise((resolve,reject)=>{
    const id=index+1, spec=cases[index%cases.length];
    const started=performanceRef.now();let settled=false;
    const cleanup=()=>{
     if(settled)return false;settled=true;
     clearTimeout(timeout);
     worker.removeEventListener('message',message);
     worker.removeEventListener('error',onError);
     worker.removeEventListener('messageerror',onMessageError);
     return true;
    };
    const message=e=>{
     if(!cleanup())return;
     const got=e.data;
     if(got?.kind!=='physics-qa-result'||got.id!==id||
       JSON.stringify(got.result)!==JSON.stringify(expected[index%cases.length])){
      reject(new Error('Real physics Worker result/golden mismatch for job '+index));return;
     }
     latencies.push(performanceRef.now()-started);
     outputs[index]=got.result;finished++;
     resolve();
    };
    const onError=e=>{if(cleanup())reject(Error('Real Worker error: '+e.message));};
    const onMessageError=()=>{if(cleanup())reject(Error('Worker message decode failed'));};
    const timeout=setTimeout(()=>{if(cleanup())reject(Error('Real physics Worker timeout for job '+index));},TIMEOUT_MS);
    worker.addEventListener('message',message);
    worker.addEventListener('error',onError);
    worker.addEventListener('messageerror',onMessageError);
    try{worker.postMessage({kind:'run-physics-qa',id,spec});}
    catch(e){if(cleanup())reject(e);}
   });
   await Promise.all(workers.map(async(worker,lane)=>{
    for(let index=lane;index<outputs.length;index+=lanes){
     active++;peak=Math.max(peak,active);
     try{await doJob(worker,index);}finally{active--;}
    }
   }));
   const end=performanceRef.now(),elapsedMs=end-startedAt;
   if(finished!==outputs.length||!outputs.every(Boolean)||peak!==lanes||elapsedMs<=0)
    throw new Error('Incomplete actual concurrent physics workload');
   const actualTicks=outputs.reduce((sum,x)=>sum+x.tick,0);
   const expectedTicks=REPEATS*expected.reduce((sum,x)=>sum+x.tick,0);
   if(actualTicks!==expectedTicks)throw Error('Real physics ticks dropped/duplicated');
   metric={lanes,workersStarted:lanes,peakActiveTasks:peak,
    jobs:finished,actualTicks,simulatedSeconds:round(actualTicks/120),
    elapsedMs:round(elapsedMs),throughputTicksPerWallSec:round(actualTicks*1000/elapsedMs),
    meanJobMs:round(latencies.reduce((a,b)=>a+b,0)/latencies.length),
    p95JobMs:round(percentile(latencies,.95)),
    foregroundRafSamples:frameGaps.length,
    foregroundRafP95GapMs:frameGaps.length?round(percentile(frameGaps,.95)):null,
    foregroundRafMaxGapMs:frameGaps.length?round(Math.max(...frameGaps)):null,
    memoryMiB:null,thermalC:null,
    caveat:'QA headless Chromium: foreground RAF only; per-worker memory and real Ride/Chromebook response NOT measured.'};
  }finally{
   if(raf!==null&&typeof cancelAnimationFrameRef==='function')cancelAnimationFrameRef(raf);
   for(const worker of workers){worker.terminate();terminationRequests++;}
  }
  if(metric){metric.workerTerminationRequests=terminationRequests;reports.push(metric);}
 }
 return Object.freeze({version:1,results:reports,workerCountLevels,
  baseWebAuthorizedSimSlots:1,
  applicability:'QA only, real RunScene/Matter in compiled Chromium Workers; no licensed slots or AI training'});
}
