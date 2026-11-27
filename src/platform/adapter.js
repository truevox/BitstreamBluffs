/** #441: small, side-effect-free platform contract. Gameplay must never call an
 * ad/ownership SDK or platform-specific storage implementation directly.
 * No adapter result is proof of public score, payment, or Verified status.
 */
export const PLATFORM_ABI=1;
export const PLATFORM_TARGETS=Object.freeze(['web','crazygames','steam','fake']);
export const REWARD_STATES=Object.freeze(['completed','closed-early','no-ad','blocked','busy','unavailable']);
const badKey=key=>typeof key!=='string'||key.length<1||key.length>128||!/^[a-zA-Z0-9._/-]+$/.test(key);
const unavailable=()=>({ok:false,code:'unavailable'});
const deniedReward=()=>({status:'unavailable'});
const deniedOwnership=()=>({status:'unavailable'});
const storageFailure=e=>e?.name==='QuotaExceededError'?{ok:false,code:'quota-exceeded'}:unavailable();
const NAMESPACE='bb.platform.v1.';

function webStorage(provider){
 const store=()=>{try{return typeof provider==='function'?provider():provider;}catch{return null;}};
 const keyOf=key=>NAMESPACE+key;
 return Object.freeze({
  async read(key){
   if(badKey(key))return {ok:false,code:'invalid-key'};
   try{const s=store();if(!s)return unavailable();const value=s.getItem(keyOf(key));
    return {ok:true,found:value!==null,value:value===null?null:value};}
   catch(e){return storageFailure(e);}
  },
  async write(key,value){
   if(badKey(key))return {ok:false,code:'invalid-key'};
   if(typeof value!=='string')return {ok:false,code:'invalid-value'};
   try{const s=store();if(!s)return unavailable();s.setItem(keyOf(key),value);return {ok:true};}
   catch(e){return storageFailure(e);}
  },
  async remove(key){
   if(badKey(key))return {ok:false,code:'invalid-key'};
   try{const s=store();if(!s)return unavailable();s.removeItem(keyOf(key));return {ok:true};}
   catch(e){return storageFailure(e);}
  },
 });
}
function absentStorage(){return Object.freeze({
 read:async key=>badKey(key)?{ok:false,code:'invalid-key'}:unavailable(),
 write:async(key,value)=>badKey(key)?{ok:false,code:'invalid-key'}:typeof value!=='string'?{ok:false,code:'invalid-value'}:unavailable(),
 remove:async key=>badKey(key)?{ok:false,code:'invalid-key'}:unavailable(),
});}
function adapter(id,capabilities,storage,ownership,requestReward){
 return Object.freeze({id,abi:PLATFORM_ABI,capabilities:Object.freeze({...capabilities}),
  storage,ownership:Object.freeze({get:ownership}),requestReward});
}

/** Own website: local non-authoritative storage, absolutely NO rewarded ads. */
export function createWebPlatform({storage=()=>globalThis.localStorage}={}){
 return adapter('web',{storage:true,ownership:false,rewards:false},webStorage(storage),deniedOwnership,deniedReward);
}
/** Future SDK ports remain explicitly unavailable until their implementations
 * pass the SAME contract tests. Never simulate a paid entitlement or a reward.
 */
export function createDeferredPlatform(id){
 if(!['crazygames','steam'].includes(id))throw new TypeError('Unknown deferred platform');
 return adapter(id,{storage:false,ownership:false,rewards:false},absentStorage(),deniedOwnership,deniedReward);
}
/** Test-only deterministic fake; no browser APIs, billing, or ad SDK. */
export function createFakePlatform({rewards=['no-ad'],owned=[],storageEnabled=true}={}){
 const map=new Map(),seq=[...rewards],entitlements=new Set(owned);
 const storage=storageEnabled?webStorage(()=>({
  getItem:key=>map.has(key)?map.get(key):null,
  setItem:(key,value)=>{map.set(key,value);},
  removeItem:key=>{map.delete(key);},
 })):absentStorage();
 let busy=false;
 const requestReward=async request=>{
  if(!request||typeof request.placement!=='string'||!request.placement||request.placement.length>128)
   return {status:'blocked'};
  if(busy)return {status:'busy'};
  busy=true;
  try{
   const outcome=seq.length?seq.shift():'no-ad';
   const status=typeof outcome==='function'?await outcome(request):outcome;
   return {status:REWARD_STATES.includes(status)?status:'blocked'};
  }catch{return {status:'blocked'};}
  finally{busy=false;}
 };
 return adapter('fake',{storage:storageEnabled,ownership:true,rewards:true},storage,
  async id=>typeof id==='string'&&id.length>0&&id.length<=128?
   {status:entitlements.has(id)?'owned':'not-owned'}:deniedOwnership(),requestReward);
}
/** Web is the ONLY live implementation currently selected by production boot. */
export function createPlatformForTarget(id='web',options={}){
 if(id==='web')return createWebPlatform(options);
 if(id==='fake')return createFakePlatform(options);
 return createDeferredPlatform(id);
}
/** Validate the object shape before registry handoff; no privileged actions. */
export function isPlatformAdapter(a){
 return !!a&&PLATFORM_TARGETS.includes(a.id)&&a.abi===PLATFORM_ABI&&
  !!a.capabilities&&['storage','ownership','rewards'].every(k=>typeof a.capabilities[k]==='boolean')&&
  ['read','write','remove'].every(k=>typeof a.storage?.[k]==='function')&&
  typeof a.ownership?.get==='function'&&typeof a.requestReward==='function';
}
