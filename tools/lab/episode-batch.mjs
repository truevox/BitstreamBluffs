/** #134: deterministic, bounded episode dispatch substrate (NO Web Worker yet).
 * The production trainer must supply actual certified #122 SimWorld episodes.
 * No timestamps, global RNG calls, rewards, score/Verified authority or writes.
 */
import {Rng} from '../../src/systems/Rng.js';

export const EPISODE_BATCH_ABI=1;
export const MAX_EPISODES_PER_BATCH=10000;
export const MAX_SIMULTANEOUS_EPISODES=32;

/** Independent original-seed fork. Completion/dispatch order never enters it. */
export function episodeSeed(campaignSeed,index){
 if(!(typeof campaignSeed==='string'&&campaignSeed.length>=1&&campaignSeed.length<=256)||
   !Number.isSafeInteger(index)||index<0||index>=MAX_EPISODES_PER_BATCH)
  throw new TypeError('Invalid deterministic episode seed or index');
 return new Rng(campaignSeed).fork('lab/episode/v1/'+index).baseSeed;
}

/**
 * Run at most `concurrency` independent episode callbacks at once.
 * `runEpisode` owns the actual sim/worker; this only dispatches and aggregates.
 * A callback receives a frozen {index, seed, signal} with a per-index uint32 RNG
 * seed. Completion order cannot influence future seeds, results or index order.
 * On abort/failure: finish existing in-flight callbacks, dispatch nothing new,
 * return NO partial results and leave durable state decisions to the caller.
 * Callbacks MUST cooperate with AbortSignal and never credit gameplay rewards.
 */
export async function runEpisodeBatch({campaignSeed,count,concurrency,runEpisode,signal}={}){
 if(typeof campaignSeed!=='string'||campaignSeed.length<1||campaignSeed.length>256||
  !Number.isSafeInteger(count)||count<0||count>MAX_EPISODES_PER_BATCH||
  !Number.isSafeInteger(concurrency)||concurrency<1||concurrency>MAX_SIMULTANEOUS_EPISODES||
  typeof runEpisode!=='function'||
  (signal!==undefined&&(!signal||typeof signal.aborted!=='boolean')))
  throw new TypeError('Invalid episode batch contract');
 if(signal?.aborted)return {ok:false,code:'aborted'};
 const outputs=new Array(count);
 let next=0,failed=false;
 const lane=async()=>{
  while(!failed&&!signal?.aborted){
   const index=next++;
   if(index>=count)return;
   const spec=Object.freeze({index,seed:episodeSeed(campaignSeed,index),signal});
   try{outputs[index]=await runEpisode(spec);}
   catch{failed=true;return;}
  }
 };
 // Always drain already-dispatched callbacks. Never race an abort against an
 // untracked still-running simulation which could mutate external state.
 await Promise.all(Array.from({length:Math.min(concurrency,count)},()=>lane()));
 if(signal?.aborted)return {ok:false,code:'aborted'};
 if(failed)return {ok:false,code:'episode-failed'};
 return {ok:true,results:outputs};
}
