/** Capability-injected preview controller. No downloads or transport changes on construction. */
import {R2DownloadControls} from './r2-download-controls.mjs';
import {activatePublishedMelody} from './melody-tier-cache.mjs';
import {selectR2Tier} from './r2-tier-selection.mjs';
const modes=['high','space-saver','no-music'];
export class MelodyDownloadControls {
 constructor({plan,options,estimate,isStopped,activate=activatePublishedMelody,createQueue=o=>new R2DownloadControls(o),mode='high',withStoppedTransport=null}){
  if(plan?.format!=='bb-melody-candidate-plan-v1'||!Array.isArray(plan.groups)||typeof isStopped!=='function'||!modes.includes(mode))throw Error('Invalid melody controller');
  this.plan=plan;this.options=options;this.withStoppedTransport=withStoppedTransport;this.boundaryWork=null;this.estimate=estimate;this.isStopped=isStopped;this.activate=activate;this.createQueue=createQueue;this.mode=mode;this.quality=null;this.running=null;this.queue=null;this.cancelled=false;this.queues={};this.state={status:'idle',mode,quality:null,ready:false,missingBytes:null};
 }
 _set(x){this.state={...this.state,...x,mode:this.mode,quality:this.quality};return this.state;}
 _queue(q){if(!this.queues[q])this.queues[q]=this.createQueue({plan:{format:'bb-published-music-plan-v1',catalog:this.plan.catalog,groups:this.plan.groups.filter(g=>g.quality===q)},...this.options,estimate:this.estimate,onState:s=>{if(this.queue===this.queues[q])this._set({...s,qualityPhase:q});}});return this.queues[q];}
 async setMode(mode){if(this.running)throw Error('Download in progress');if(!modes.includes(mode))throw Error('Invalid music quality mode');this.mode=mode;return this.refresh();}
 async refresh(){if(this.running)return this.state;if(this.mode==='no-music')return this._set({status:'no-music',ready:false,missingBytes:0});const lite=await this._queue('lite').refresh();const full=this.mode==='high'?await this._queue('full').refresh():null;return this._set({status:lite.ready?(full&&!full.ready?'lite-ready':'ready'):lite.status,ready:lite.ready&&(!full||full.ready),missingBytes:(lite.missingBytes??0)+(full?.missingBytes??0),liteReady:lite.ready,fullReady:full?.ready===true});}
 start({consent=false}={}){if(consent!==true)return Promise.reject(Error('Explicit player download consent required'));if(this.running)return this.running;if(this.mode==='no-music')return Promise.resolve(this._set({status:'no-music',ready:false,missingBytes:0}));this.cancelled=false;this.running=(async()=>{try{this.queue=this._queue('lite');const lite=await this.queue.start({consent:true});if(!lite.ready||this.cancelled)return this._set({...lite,status:this.cancelled?'cancelled':lite.status});if(this.mode==='high'){this.queue=this._queue('full');const full=await this.queue.start({consent:true});if(!full.ready||this.cancelled)return this._set({...full,status:this.cancelled?'cancelled':'lite-ready',ready:false,liteReady:true,fullReady:false,upgradeStatus:full.status});}return this._set({status:'ready',ready:true,liteReady:true,fullReady:this.mode==='high',missingBytes:0});}catch(e){return this._set({status:'failed',ready:false,error:String(e.message||e)});}finally{this.queue=null;this.running=null;}})();return this.running;}
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
 async apply(){if(this.running||!this.isStopped())throw Error('Stop music before changing quality');const lite=this.mode==='no-music'?false:(await this._queue('lite').refresh()).ready,full=this.mode==='high'&&(await this._queue('full').refresh()).ready;const next=selectR2Tier({mode:this.mode,current:this.quality,stopped:true,required:[{lite,full}]});if(next.quality===null&&this.mode!=='no-music')throw Error('Download Lite before applying quality');if(!this.isStopped())throw Error('Music restarted during verification');await this.activate(this.plan,next.quality,{...this.options,stopped:true});this.quality=next.quality;return this._set({applied:true});}
}
