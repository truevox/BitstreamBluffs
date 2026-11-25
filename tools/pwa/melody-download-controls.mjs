/** Capability-injected preview controller. No downloads or transport changes on construction. */
import {R2DownloadControls} from './r2-download-controls.mjs';
import {activatePublishedMelody,appendVerifiedMelodyGroups} from './melody-tier-cache.mjs';
import {selectR2Tier} from './r2-tier-selection.mjs';
const modes=['high','space-saver','no-music'];
export class MelodyDownloadControls {
 constructor({plan,options,estimate,isStopped,activate=activatePublishedMelody,createQueue=o=>new R2DownloadControls(o),append=appendVerifiedMelodyGroups,mode='high',withStoppedTransport=null}){
  if(plan?.format!=='bb-melody-candidate-plan-v1'||!Array.isArray(plan.groups)||typeof isStopped!=='function'||!modes.includes(mode))throw Error('Invalid melody controller');
  this.plan=plan;this.append=append;this._appliedGroupIds=new Set();this._planRevision=0;this._contextRefreshTicket=null;this.replanning=null;this.options=options;this.withStoppedTransport=withStoppedTransport;this.boundaryWork=null;this.estimate=estimate;this.isStopped=isStopped;this.activate=activate;this.createQueue=createQueue;this.mode=mode;this.quality=null;this.running=null;this.queue=null;this.cancelled=false;this.queues={};this.state={status:'idle',mode,quality:null,ready:false,missingBytes:null,nextBiome:plan.nextBiome||null};
 }
 _set(x){this.state={...this.state,...x,mode:this.mode,quality:this.quality};return this.state;}
 _queue(q){if(!this.queues[q])this.queues[q]=this.createQueue({plan:{format:'bb-published-music-plan-v1',catalog:this.plan.catalog,groups:this.plan.groups.filter(g=>g.quality===q)},...this.options,estimate:this.estimate,onState:s=>{if(this.queue===this.queues[q])this._set({...s,qualityPhase:q});}});return this.queues[q];}
 async setMode(mode){if(this.running||this.replanning)throw Error('Download in progress');if(!modes.includes(mode))throw Error('Invalid music quality mode');this.mode=mode;return this.refresh();}
 /** Plan changes never download and never erase a verified recording cache.
  * An active transfer is cancelled; the newest context replaces older work. */
 /** An authoritative setting/profile event revokes unconfirmed consent NOW,
  * before asynchronous plan hashing. Existing consented transfers remain
  * running until the new plan is known to differ. */
 markContextChanged(){const ticket=++this._planRevision;this._contextRefreshTicket=ticket;this._set({planRevision:ticket});return ticket;}
 finishContextCheck(ticket){if(this._contextRefreshTicket===ticket)this._contextRefreshTicket=null;}
 _samePlan(next){const a=this.plan,b=next;return a.release===b.release&&a.nextBiome===b.nextBiome&&
  a.catalog?.url===b.catalog?.url&&a.catalog?.sha256===b.catalog?.sha256&&
  a.groups.length===b.groups.length&&a.groups.every((g,i)=>g.id===b.groups[i].id&&g.version===b.groups[i].version&&g.priority===b.groups[i].priority);}
 async replan(next,{contextTicket=null}={}){
  if(next?.format!=='bb-melody-candidate-plan-v1'||next.release!==this.plan.release||!Array.isArray(next.groups))throw Error('Invalid replacement melody plan');
  if(contextTicket!==null&&this._contextRefreshTicket!==contextTicket)return this.state;
  if(this._samePlan(next)){this.finishContextCheck(contextTicket);return this.state;}
  const generation=contextTicket??++this._planRevision;
  this.cancel();
  const previous=this.replanning;
  const pending=(async()=>{
   if(previous)await previous.catch(()=>{});
   if(this.running)await this.running.catch(()=>{});
   if(this.boundaryWork)await this.boundaryWork.catch(()=>{});
   if(generation!==this._planRevision)return this.state;
   this.plan=next;this.queues={};this.queue=null;this.cancelled=false;
   this._set({status:'checking',ready:false,missingBytes:null,prefetchStatus:null,nextBiome:next.nextBiome||null,planRevision:generation});
   await this.refresh({skipReplan:true});
   return this._extendActiveTier();
  })();
  this.replanning=pending;
  try{return await pending;}finally{if(this.replanning===pending)this.replanning=null;this.finishContextCheck(contextTicket);}
 }
 /** Extend the applied worker policy only with verified, newly-required URLs.
  * The worker cannot change quality or replace an already playing recording. */
 async _extendActiveTier(){
  if(!this.quality||!this.options?.worker)return this.state;
  const groups=this.plan.groups.filter(g=>g.priority==='required'&&g.quality===this.quality&&!this._appliedGroupIds.has(g.id));
  if(!groups.length)return this.state;
  try{
   const result=await this.append(groups,this.options);
   for(const id of result.groupIds||[])this._appliedGroupIds.add(id);
   this._set({tierExtensionStatus:result.added?'ready':'nothing-new',tierExtensionCount:result.added||0});
  }catch(e){
   this._set({tierExtensionStatus:'failed',ready:false,status:'tier-routing-unavailable',error:String(e.message||e)});
  }
  return this.state;
 }
 async refresh({skipReplan=false}={}){if(this.replanning&&!skipReplan)await this.replanning;if(this.running)return this.state;if(this.mode==='no-music')return this._set({status:'no-music',ready:false,missingBytes:0});const lite=await this._queue('lite').refresh();const full=this.mode==='high'?await this._queue('full').refresh():null;return this._set({status:lite.ready?(full&&!full.ready?'lite-ready':'ready'):lite.status,ready:lite.ready&&(!full||full.ready),missingBytes:(lite.missingBytes??0)+(full?.missingBytes??0),liteReady:lite.ready,fullReady:full?.ready===true});}
 start({consent=false}={}){if(this.replanning||this._contextRefreshTicket!==null)return Promise.reject(Error('Offline plan is refreshing'));if(consent!==true)return Promise.reject(Error('Explicit player download consent required'));if(this.running)return this.running;if(this.mode==='no-music')return Promise.resolve(this._set({status:'no-music',ready:false,missingBytes:0}));this.cancelled=false;this.running=(async()=>{try{this.queue=this._queue('lite');const lite=await this.queue.start({consent:true});if(!lite.ready||this.cancelled)return this._set({...lite,status:this.cancelled?'cancelled':lite.status});if(this.quality==='lite'&&(await this._extendActiveTier()).tierExtensionStatus==='failed')return this.state;if(this.mode==='high'){this.queue=this._queue('full');const full=await this.queue.start({consent:true});if(!full.ready||this.cancelled)return this._set({...full,status:this.cancelled?'cancelled':'lite-ready',ready:false,liteReady:true,fullReady:false,upgradeStatus:full.status,upgradeMissingBytes:full.missingBytes??null,availableBytes:full.availableBytes??null});}this._set({status:'ready',ready:true,liteReady:true,fullReady:this.mode==='high',missingBytes:0,upgradeStatus:null,upgradeMissingBytes:null});await this._extendActiveTier();return this.state;}catch(e){return this._set({status:'failed',ready:false,error:String(e.message||e)});}finally{this.queue=null;this.running=null;}})();return this.running;}
 /** User-confirmed, bounded next-biome lookahead. Never an automatic transfer.
  * All Lite groups get priority; remaining capacity may hold verified Full. */
 prefetch({consent=false,idle=false,maxBytes=32*1024*1024}={}){
  if(consent!==true)return Promise.reject(Error('Explicit next-biome prefetch consent required'));
  if(idle!==true)return Promise.reject(Error('Prefetch requires idle/preview context'));
  if(this.options?.connection?.saveData||/^(?:slow-)?2g$/.test(this.options?.connection?.effectiveType||''))return Promise.reject(Error('Save Data or slow connection prevents prefetch'));
  if(this.replanning||this._contextRefreshTicket!==null||this.running)return Promise.reject(Error('An offline transfer or refresh is active'));
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>128*1024*1024)return Promise.reject(Error('Invalid prefetch budget'));
  const biome=this.plan.nextBiome;
  if(!biome||this.mode==='no-music')return Promise.resolve(this._set({prefetchStatus:'not-applicable',prefetchBytes:0}));
  const candidates=this.plan.groups.filter(g=>g.priority==='bonus'&&g.originalId.endsWith(':lead:'+biome)&&['lite','full'].includes(g.quality));
  const ordered=[...candidates.filter(g=>g.quality==='lite'),...(this.mode==='high'?candidates.filter(g=>g.quality==='full'):[])];
  let bytes=0;const selected=[];
  for(const group of ordered){if(bytes+group.bytes>maxBytes)continue;selected.push({...group,priority:'required'});bytes+=group.bytes;}
  if(!selected.length)return Promise.resolve(this._set({prefetchStatus:'budget-too-small',prefetchBytes:0}));
  this.cancelled=false;
  const q=this.createQueue({plan:{format:'bb-published-music-plan-v1',catalog:this.plan.catalog,groups:selected},...this.options,estimate:this.estimate,onState:s=>{if(this.queue===q)this._set({prefetchStatus:s.status,prefetchBytesDone:s.completedBytes||0,prefetchBytes:bytes});}});
  this.queue=q;
  const pending=(async()=>{try{const result=await q.start({consent:true});this._set({prefetchStatus:result.ready?(selected.length===ordered.length?'ready':'partial'):result.status,prefetchBytes:bytes,prefetchGroups:selected.length,prefetchTotalGroups:ordered.length});return this.state;}finally{this.queue=null;this.running=null;}})();
  this.running=pending;return pending;
 }
 cancel(){this.cancelled=true;this.queue?.cancel();}
 /** Call from an actual playback-start boundary, while the transport owner
  * holds a start barrier through the worker acknowledgement. No downloads,
  * pauses, or forced restarts are initiated here. Without the capability this
  * deliberately does nothing; manual preview apply remains available. */
 beforePlayback(){
  if(this.boundaryWork)return this.boundaryWork;
  if(typeof this.withStoppedTransport!=='function'||this.running||!this.isStopped())return Promise.resolve({changed:false,reason:'await-boundary'});
  const pending=Promise.resolve().then(()=>this.withStoppedTransport(async()=>{
   if(this.running||!this.isStopped())return {changed:false,reason:'await-boundary'};
   const prior=this.quality;
   try{await this.apply();return {changed:prior!==this.quality,quality:this.quality};}
   catch(e){return {changed:false,reason:String(e.message||e)};}
  }));
  this.boundaryWork=pending.finally(()=>{this.boundaryWork=null;});return this.boundaryWork;
 }
 async apply(){if(this.running||!this.isStopped())throw Error('Stop music before changing quality');const lite=this.mode==='no-music'?false:(await this._queue('lite').refresh()).ready,full=this.mode==='high'&&(await this._queue('full').refresh()).ready;const next=selectR2Tier({mode:this.mode,current:this.quality,stopped:true,required:[{lite,full}]});if(next.quality===null&&this.mode!=='no-music')throw Error('Download Lite before applying quality');if(!this.isStopped())throw Error('Music restarted during verification');await this.activate(this.plan,next.quality,{...this.options,stopped:true});this.quality=next.quality;this._appliedGroupIds=new Set(this.plan.groups.filter(g=>g.priority==='required'&&g.quality===next.quality).map(g=>g.id));return this._set({applied:true,tierExtensionStatus:null});}
}
