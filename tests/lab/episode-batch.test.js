import {Rng} from '../../src/systems/Rng.js';
import {episodeSeed,runEpisodeBatch,EPISODE_BATCH_ABI,
 MAX_EPISODES_PER_BATCH} from '../../tools/lab/episode-batch.mjs';

const train=({seed,index})=>{
 const r=new Rng(seed);
 let score=0;
 for(let step=0;step<32;step++)score+=(r.int(0,25)*((step%7)+1));
 return {index,score,seed};
};

test('ABI and indexed seeds stable across count, request order, and root RNG consumption',()=>{
 expect(EPISODE_BATCH_ABI).toBe(1);
 const indices=[6,0,9,2,6];
 const seeds=indices.map(i=>episodeSeed('AI-LAB-CAMPAIGN',i));
 expect(seeds[0]).toBe(seeds[4]);
 expect(new Set(seeds.slice(0,4)).size).toBe(4);
 expect(seeds[1]).toBe(episodeSeed('AI-LAB-CAMPAIGN',0));
 expect(seeds[1]).not.toBe(episodeSeed('AI-LAB-CAMPAIGN-OTHER',0));
 const r=new Rng('AI-LAB-CAMPAIGN');for(let i=0;i<300;i++)r.next();
 expect(r.fork('lab/episode/v1/0').baseSeed).toBe(seeds[1]);
});

test('golden deterministic training result ignores callback delays and concurrency',async()=>{
 const baseline=await runEpisodeBatch({campaignSeed:'training-golden-v1',count:16,
  concurrency:1,runEpisode:({index,seed})=>train({index,seed})});
 expect(baseline.ok).toBe(true);
 for(const concurrency of [1,2,3,7,16]){
  let active=0,peak=0;
  const got=await runEpisodeBatch({campaignSeed:'training-golden-v1',count:16,concurrency,
   runEpisode:async({index,seed})=>{
    active++;peak=Math.max(peak,active);
    // Scheduling jitter is TEST-ONLY. The trainer's input is always just
    // index+independent RNG seed, never completion timestamps.
    await new Promise(done=>setTimeout(done,(index*17+3)%7));
    active--;return train({index,seed});
   }});
  expect(got).toEqual(baseline);
  expect(peak).toBeLessThanOrEqual(concurrency);
  expect(peak).toBeGreaterThan(0);
 }
 expect(baseline.results.map(r=>r.index)).toEqual(Array.from({length:16},(_,i)=>i));
 expect(baseline.results.every(r=>Number.isSafeInteger(r.score))).toBe(true);
});

test('a failing callback stops new admissions and returns no partial trainable result',async()=>{
 let called=0;
 const result=await runEpisodeBatch({campaignSeed:'failed',count:20,concurrency:3,
  runEpisode:async({index})=>{called++;if(index===1)throw Error('real episode failure');
   await Promise.resolve();return index;}});
 expect(result).toEqual({ok:false,code:'episode-failed'});
 expect(called).toBeLessThan(20);
 expect(result).not.toHaveProperty('results');
});

test('cancellation drains already admitted episodes and does not launch more',async()=>{
 const ctrl=new AbortController(),release=[];let started=0,completed=0;
 const pending=runEpisodeBatch({campaignSeed:'cancel',count:100,concurrency:3,signal:ctrl.signal,
  runEpisode:async({signal})=>{started++;
   await new Promise(done=>release.push(done));
   expect(signal.aborted).toBe(true);completed++;return 1;
  }});
 expect(started).toBe(3);
 ctrl.abort();release.forEach(done=>done());
 expect(await pending).toEqual({ok:false,code:'aborted'});
 expect(completed).toBe(3);expect(started).toBe(3);
});

test('aborted signal before launch dispatches nothing; empty batch is valid',async()=>{
 const c=new AbortController();c.abort();let calls=0;
 expect(await runEpisodeBatch({campaignSeed:'seed',count:4,concurrency:2,
  signal:c.signal,runEpisode:()=>{calls++;}})).toEqual({ok:false,code:'aborted'});
 expect(calls).toBe(0);
 expect(await runEpisodeBatch({campaignSeed:'seed',count:0,concurrency:1,
  runEpisode:()=>{calls++;}})).toEqual({ok:true,results:[]});
 expect(calls).toBe(0);
});

test('invalid cardinality, concurrency, seed, and callback cannot start work',async()=>{
 for(const patch of [
  {count:-1},{count:MAX_EPISODES_PER_BATCH+1},{count:2.1},
  {concurrency:0},{concurrency:33},{campaignSeed:''},{runEpisode:null},
 ]){
  await expect(runEpisodeBatch({campaignSeed:'x',count:4,concurrency:2,
   runEpisode:()=>1,...patch})).rejects.toThrow(TypeError);
 }
 expect(()=>episodeSeed('x',MAX_EPISODES_PER_BATCH)).toThrow(TypeError);
});
