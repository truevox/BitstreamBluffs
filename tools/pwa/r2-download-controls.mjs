/** Consent-first original-quality download controller. UI/transport integration is separate.
 * Never starts on construction, preference selection, or readiness inspection. */
import {downloadR2Group,inspectR2Group,inspectR2GroupFast,catalogCacheGroup} from './r2-cache.mjs';
const isQuotaExceeded=e=>e?.name==='QuotaExceededError'||e?.name==='NS_ERROR_DOM_QUOTA_REACHED'||e?.code===22;
export class R2DownloadControls {
 constructor({plan,storage,origin,scope,subtle,fetcher,estimate,onState=()=>{},download=downloadR2Group,inspect=inspectR2Group}){
  if(plan?.format!=='bb-published-music-plan-v1'||!Array.isArray(plan.groups)||!plan.catalog||typeof estimate!=='function')throw Error('Expected published recording plan and quota estimator');
  this.plan=plan;this.opts={storage,origin,scope,subtle,fetcher};this.estimate=estimate;this.onState=onState;this.download=download;this.inspect=inspect;this.running=null;this.abort=null;this.state={status:'idle',ready:false,missingBytes:null,completedBytes:0,totalBytes:0};
 }
 _set(next){this.state={...this.state,...next};this.onState({...this.state});}
 async _groups(includeBonus=false){return [await catalogCacheGroup(this.plan.catalog,this.opts.subtle),...this.plan.groups.filter(g=>g.priority==='required'||(includeBonus&&g.priority==='bonus'))];}
 async _check(groups){
  const knownCacheNames=typeof this.opts.storage?.keys==='function'
    ?new Set(await this.opts.storage.keys()):null;
  const states=await Promise.all(groups.map(g=>this.inspect(g,{...this.opts,knownCacheNames})));
  return {ready:states.every(x=>x.ready),missingBytes:states.reduce((n,x)=>n+x.missingBytes,0)};
 }
 /** Short stopped-to-play admission; cannot claim deep integrity. The worker
  * validates SHA-256 for every audio file it actually serves. */
 async quickReady(){
  if(!this.plan.groups.some(g=>g.priority==='required'))return false;
  const groups=await this._groups(),knownCacheNames=typeof this.opts.storage?.keys==='function'
    ?new Set(await this.opts.storage.keys()):null;
  const results=await Promise.all(groups.map(g=>inspectR2GroupFast(g,{...this.opts,knownCacheNames})));
  return results.every(r=>r.ready);
 }
 async refresh(){if(this.running)return this.state;if(!this.plan.groups.some(g=>g.priority==='required')){this._set({status:'no-music',ready:false,missingBytes:0});return this.state;}const x=await this._check(await this._groups());if(!this.running)this._set({...x,status:x.ready?'ready':'download-required'});return this.state;}
 start({consent=false,includeBonus=false}={}){
  if(consent!==true)return Promise.reject(Error('Explicit player download consent required'));
  if(this.running)return this.running;
  if(!this.plan.groups.some(g=>g.priority==='required')){this._set({status:'no-music',ready:false,missingBytes:0,completedBytes:0,totalBytes:0});return Promise.resolve(this.state);}
  const ac=new AbortController();this.abort=ac;
  const checkAbort=()=>{if(ac.signal.aborted)throw Error('Cancelled');};
  this._set({status:'checking',ready:false,error:null,completedBytes:0,totalBytes:0});
  this.running=(async()=>{try{
   const required=await this._groups(),groups=await this._groups(includeBonus);checkAbort();
   const total=groups.reduce((n,g)=>n+g.entries.reduce((a,e)=>a+e.bytes,0),0),all=await this._check(groups);checkAbort();
   if(all.missingBytes===0&&all.ready){this._set({status:'ready',ready:true,missingBytes:0,completedBytes:total,totalBytes:total});return this.state;}
   const space=await this.estimate();checkAbort();
   // A missing or unreliable estimate never silently starts a large transfer.
   if(!Number.isFinite(space?.quota)||!Number.isFinite(space?.usage)||space.usage<0||space.quota<space.usage)throw Error('Storage estimate unavailable');
   const available=space.quota-space.usage,reserve=Math.min(16*1024*1024,Math.ceil(space.quota*.05));
   if(all.missingBytes>0&&all.missingBytes+reserve>available){this._set({status:'insufficient-storage',missingBytes:all.missingBytes,availableBytes:available,totalBytes:total});return this.state;}
   this._set({status:'downloading',missingBytes:all.missingBytes,totalBytes:total});let done=0;
   for(const g of groups){checkAbort();await this.download(g,{...this.opts,consent:true,signal:ac.signal,onProgress:p=>{if(!ac.signal.aborted)this._set({completedBytes:done+p.bytes});}});checkAbort();done+=g.entries.reduce((a,e)=>a+e.bytes,0);this._set({completedBytes:done});}
   const verified=await this._check(required);checkAbort();this._set({...verified,status:verified.ready?'ready':'download-required'});
  }catch(e){
    if(ac.signal.aborted)this._set({status:'cancelled',ready:false,error:null});
    else if(isQuotaExceeded(e)){
     // CacheStorage.put may exhaust the device after an optimistic estimate.
     // Keep already-verified objects; do not delete any cache or retry without
     // another explicit confirmation after the player frees space.
     const remaining=await this._check(await this._groups()).catch(()=>null);
     const space=await Promise.resolve().then(()=>this.estimate()).catch(()=>null);
     this._set({status:'insufficient-storage',ready:false,
      missingBytes:remaining?.missingBytes??this.state.missingBytes,
      availableBytes:Number.isFinite(space?.quota)&&Number.isFinite(space?.usage)
       ?Math.max(0,space.quota-space.usage):null,
      error:'Storage quota reached; verified recordings retained. Free space and retry.'});
    }else this._set({status:'failed',ready:false,error:String(e.message||e)});
   }finally{this.abort=null;this.running=null;}return this.state;})();return this.running;
 }
 cancel(){this.abort?.abort();}
}
