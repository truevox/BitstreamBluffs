/** #134 real module Worker transport probe — deliberately NOT SimWorld.
 * The computation is the same deterministic Rng golden workload as the
 * scheduler foundation. The trainer must replace this with #122-certified
 * real game physics before ANY brain learns from worker episode results.
 */
import {Rng} from '../../src/systems/Rng.js';

self.onmessage=event=>{
 const msg=event.data;
 if(!msg||msg.kind!=='lab-probe' || !Number.isSafeInteger(msg.id)||msg.id<0||
  !Number.isSafeInteger(msg.index)||msg.index<0||
  !Number.isSafeInteger(msg.seed)||msg.seed<0||msg.seed>0xffffffff){
  self.postMessage({kind:'lab-error',id:Number.isSafeInteger(msg?.id)?msg.id:-1});
  return;
 }
 const r=new Rng(msg.seed);let score=0;
 for(let step=0;step<32;step++)score+=r.int(0,25)*((step%7)+1);
 self.postMessage({kind:'lab-result',id:msg.id,index:msg.index,seed:msg.seed,score});
};
