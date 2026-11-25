/** #68: opt-in, local-only, pose-trace graveyard. NOT an authoritative replay store.
 * Dedicated IDB database; never touches the five-ghost role cache, score ledger,
 * complete proof inputs, public ranking, account or network. Disable means NO new writes.
 */
import {courseKey,decodeTrace,tracePose,TRACE_EVERY} from './GhostTape.js';

export const CEMETERY_DB='bitstream-cemetery-poses';
export const CEMETERY_STORE='traces';
export const CEMETERY_VERSION=1;
export const CEMETERY_PER_COURSE=24;
export const CEMETERY_GLOBAL_LIMIT=128;
export const CEMETERY_FORMAT='bb-local-pose-montage-v1';
const MAX_TRACE_CHARACTERS=180000;

const errCode=e=>e?.name==='QuotaExceededError'?'quota-exceeded':'storage-unavailable';
const req2p=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IDB read failed'));});
const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IDB transaction aborted'));tx.onerror=()=>reject(tx.error||new Error('IDB transaction failed'));});

/** Only capture eligible ordinary, completed, explicitly opted-in native tape poses. */
export function cemeteryEntry(tape,now=Date.now()){
 if(!tape||tape.mode==='gym'||!['normal','daily','daily-draft'].includes(tape.mode)||
   typeof tape.seed!=='string'||!tape.seed||tape.seed.length>160||
   !Number.isSafeInteger(tape.biomeMask??0)||(tape.biomeMask??0)<0||(tape.biomeMask??0)>0xffffffff||
   typeof tape.runId!=='string'||!tape.runId||tape.runId.length>160||
   !Number.isSafeInteger(tape.endTick)||tape.endTick<4||tape.endTick>2000000||
   typeof tape.trace!=='string'||tape.trace.length<8||tape.trace.length>MAX_TRACE_CHARACTERS||
   !Number.isFinite(tape.distanceM)||tape.distanceM<0||!Number.isFinite(now)||now<0)
  return null;
 const points=decodeTrace(tape);
 if(points.length<6||points.length%3!==0||points.length>130000||
   ![...points].every(n=>Number.isFinite(n)&&Math.abs(n)<1e10))return null;
 const course=courseKey(tape.seed,tape.biomeMask||0);
 return {key:`${course}/${tape.runId}`,course,runId:tape.runId,
  seed:tape.seed,biomeMask:tape.biomeMask||0,mode:tape.mode,endTick:tape.endTick,
  distanceM:tape.distanceM,trace:tape.trace,recordedAt:now,format:CEMETERY_FORMAT};
}

const descending=(a,b)=>(b.recordedAt-a.recordedAt)||(a.key<b.key?-1:a.key>b.key?1:0);
/** Pure frame descriptor for a noninteractive, non-colliding multi-attempt overlay. */
export function cemeteryFrame(entries,tick){
 if(!Array.isArray(entries)||!Number.isFinite(tick)||tick<0)return [];
 return entries.slice(0,CEMETERY_PER_COURSE).flatMap((entry)=>{
  if(!entry||entry.format!==CEMETERY_FORMAT)return [];
  // UI may supply a validated decode cache; pure callers need no cache.
  const trace=entry.points instanceof Float32Array?entry.points:decodeTrace(entry),lastSample=trace.length/3*TRACE_EVERY;
  if(lastSample<TRACE_EVERY)return [];
  const died=tick>=entry.endTick;
  const effective=Math.min(tick,entry.endTick,lastSample);
  const pose=tracePose(trace,effective);
  return pose?[{runId:entry.runId,pose,died,atTick:effective,endTick:entry.endTick,
    distanceM:entry.distanceM}]:[];
 });
}

export class CemeteryArchive{
 constructor({idb=globalThis.indexedDB,perCourse=CEMETERY_PER_COURSE,globalLimit=CEMETERY_GLOBAL_LIMIT}={}){
  this.idb=idb;
  this.perCourse=Math.min(CEMETERY_PER_COURSE,Math.max(1,Math.floor(perCourse)));
  this.globalLimit=Math.min(CEMETERY_GLOBAL_LIMIT,Math.max(this.perCourse,Math.floor(globalLimit)));
 }
 async _open(){
  if(!this.idb)throw new Error('IndexedDB unavailable');
  return new Promise((resolve,reject)=>{
   const req=this.idb.open(CEMETERY_DB,CEMETERY_VERSION);
   req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(CEMETERY_STORE))db.createObjectStore(CEMETERY_STORE,{keyPath:'key'});};
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
   req.onblocked=()=>reject(new Error('IndexedDB upgrade blocked'));
  });
 }
 /** Atomic current-course/global retention trim; quota returns explicit failure. */
 async add(tape){
  const entry=cemeteryEntry(tape);
  if(!entry)return {ok:false,code:'invalid-trace'};
  let db;
  try{
   db=await this._open();
   const tx=db.transaction(CEMETERY_STORE,'readwrite'),store=tx.objectStore(CEMETERY_STORE),complete=done(tx);
   const req=store.getAll();
   req.onsuccess=()=>{
    try{
     const all=(req.result||[]).filter(r=>r&&r.key!==entry.key);
     // The newly recorded run wins even if multiple writes share Date.now()'s
     // millisecond. Never claim success while immediately evicting the new one.
     const keep=[entry,...all.sort(descending)];
     const per=new Map(),retained=[];
     for(const row of keep){
      const count=per.get(row.course)||0;
      if(count>=this.perCourse||retained.length>=this.globalLimit)continue;
      retained.push(row);per.set(row.course,count+1);
     }
     const accepted=new Set(retained.map(r=>r.key));
     store.put(entry);
     for(const row of all)if(!accepted.has(row.key))store.delete(row.key);
     // If an injected custom limit excludes the new run, remove it too.
     if(!accepted.has(entry.key))store.delete(entry.key);
    }catch(e){try{tx.abort();}catch{} }
   };
   await complete;
   return {ok:true,recorded:true,course:entry.course};
  }catch(e){return {ok:false,code:errCode(e)};}
  finally{db?.close?.();}
 }
 /** Explicit single-course deletion. Never touches the five ghost roles or
  * the separate protected evidence/archive, even when a course key matches. */
 async clearCourse(seed,biomeMask=0){
  if(typeof seed!=='string'||!seed||!Number.isSafeInteger(biomeMask)||biomeMask<0)
   return {ok:false,code:'invalid-course'};
  let db;
  try{
   db=await this._open();
   const tx=db.transaction(CEMETERY_STORE,'readwrite'),store=tx.objectStore(CEMETERY_STORE),complete=done(tx);
   const key=courseKey(seed,biomeMask);
   let removed=0;
   const req=store.getAll();
   req.onsuccess=()=>{
    for(const row of req.result||[])if(row?.course===key){store.delete(row.key);removed++;}
   };
   await complete;
   return {ok:true,removed};
  }catch(e){return {ok:false,code:errCode(e)};}
  finally{db?.close?.();}
 }
 /** Read a snapshot only; never implicitly retries or writes old records. */
 async list(seed,biomeMask=0){
  if(typeof seed!=='string'||!seed||!Number.isSafeInteger(biomeMask)||biomeMask<0)return [];
  let db;
  try{
   db=await this._open();
   const tx=db.transaction(CEMETERY_STORE,'readonly'),store=tx.objectStore(CEMETERY_STORE);
   const request=req2p(store.getAll()),complete=done(tx);
   const [all]=await Promise.all([request,complete]);
   const course=courseKey(seed,biomeMask);
   return (all||[]).filter(row=>row?.course===course&&row.format===CEMETERY_FORMAT&&
     cemeteryEntry(row,row.recordedAt)?.key===row.key).sort(descending).slice(0,this.perCourse);
  }catch{return [];}finally{db?.close?.();}
 }
}
