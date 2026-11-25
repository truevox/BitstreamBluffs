/** #68: opt-in, local-only, pose-trace graveyard. NOT an authoritative replay store.
 * Dedicated IDB database; never touches the five-ghost role cache, score ledger,
 * complete proof inputs, public ranking, account or network. Disable means NO new writes.
 */
import {courseKey,decodeTrace,tracePose,TRACE_EVERY} from './GhostTape.js';
import {CEMETERY_DEFAULT_ATTEMPTS,CEMETERY_MAX_ATTEMPTS,CEMETERY_RENDER_LIMIT,
 CEMETERY_TOTAL_BYTE_BUDGET,CEMETERY_ENTRY_TRACE_CHARS,cemeteryKeepCount} from './CemeteryPolicy.js';

export const CEMETERY_CAPTURE_STATUS_KEY='bb:cemetery-pose-capture';
export const CEMETERY_DB='bitstream-cemetery-poses';
export const CEMETERY_STORE='traces';
export const CEMETERY_VERSION=1;
export const CEMETERY_PER_COURSE=CEMETERY_MAX_ATTEMPTS; // absolute safe upper bound, NOT the default
export const CEMETERY_GLOBAL_LIMIT=128;
export const CEMETERY_FORMAT='bb-local-pose-montage-v1';
const MAX_TRACE_CHARACTERS=CEMETERY_ENTRY_TRACE_CHARS;

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

// `ordinal` is assigned inside an IndexedDB readwrite transaction, so
// several tabs or timestamp ties still order attempts by actual committed
// insertion, not lexical run ID or low-resolution wall clock.
const descending=(a,b)=>(Number(b.ordinal||0)-Number(a.ordinal||0))||
 (b.recordedAt-a.recordedAt)||(a.key<b.key?-1:a.key>b.key?1:0);
/** Conservative UTF-16 IndexedDB footprint estimate including row metadata.
 * Browser quotas are separate and can reject even a budget-compliant write.
 */
export const cemeteryEntryBytes=e=>2*e.trace.length+2*((e.seed||'').length+(e.runId||'').length)+512;

function retainNewest(rows,perCourse,globalLimit,byteBudget){
 const per=new Map(),kept=[];let bytes=0;
 for(const row of rows){
  if(!row||row.format!==CEMETERY_FORMAT||typeof row.key!=='string'||
    typeof row.course!=='string'||typeof row.trace!=='string'||
    row.trace.length>MAX_TRACE_CHARACTERS||!Number.isFinite(row.recordedAt))continue;
  const count=per.get(row.course)||0,size=cemeteryEntryBytes(row);
  if(count>=perCourse||kept.length>=globalLimit||bytes+size>byteBudget)continue;
  kept.push(row);per.set(row.course,count+1);bytes+=size;
 }
 return {kept,bytes};
}
/** Pure frame descriptor for a noninteractive, non-colliding multi-attempt overlay. */
export function cemeteryFrame(entries,tick){
 if(!Array.isArray(entries)||!Number.isFinite(tick)||tick<0)return [];
 return entries.slice(0,CEMETERY_RENDER_LIMIT).flatMap((entry)=>{
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
 constructor({idb=globalThis.indexedDB,perCourse=CEMETERY_DEFAULT_ATTEMPTS,
   globalLimit=CEMETERY_GLOBAL_LIMIT,byteBudget=CEMETERY_TOTAL_BYTE_BUDGET}={}){
  this.idb=idb;
  this.perCourse=cemeteryKeepCount(perCourse);
  this.globalLimit=Math.min(CEMETERY_GLOBAL_LIMIT,Math.max(this.perCourse,Math.floor(globalLimit)||0));
  this.byteBudget=Math.min(CEMETERY_TOTAL_BYTE_BUDGET,Math.max(1,Math.floor(byteBudget)||0));
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
  if(this.perCourse===0)return {ok:false,code:'disabled'};
  const entry=cemeteryEntry(tape);
  if(!entry)return {ok:false,code:'invalid-trace'};
  if(cemeteryEntryBytes(entry)>this.byteBudget)return {ok:false,code:'trace-exceeds-budget'};
  let db;
  try{
   db=await this._open();
   const tx=db.transaction(CEMETERY_STORE,'readwrite'),store=tx.objectStore(CEMETERY_STORE),complete=done(tx);
   const req=store.getAll();
   req.onsuccess=()=>{
    try{
     const prior=req.result||[];
     const all=prior.filter(r=>r&&r.key!==entry.key);
     // Readwrite transactions serialize this computation across tabs.
     // Existing versions without an ordinal remain ordered by timestamp.
     entry.ordinal=Math.max(0,...prior.map(r=>Number.isSafeInteger(r?.ordinal)?r.ordinal:0))+1;
     const keep=[entry,...all.sort(descending)];
     const {kept}=retainNewest(keep,this.perCourse,this.globalLimit,this.byteBudget);
     const accepted=new Set(kept.map(r=>r.key));
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
 /** Apply a LOWER Settings limit immediately; oldest pose-only history is
  * evicted before newer history. Zero deletes this archive only, never favorite
  * ghosts or replay evidence. Same readwrite IDB transaction is crash-atomic.
  */
 async trim(){
  let db;
  try{
   db=await this._open();
   const tx=db.transaction(CEMETERY_STORE,'readwrite'),store=tx.objectStore(CEMETERY_STORE),complete=done(tx);
   let removed=0,retained=0;
   const req=store.getAll();
   req.onsuccess=()=>{
    try{
     const all=(req.result||[]).filter(r=>r&&typeof r.key==='string').sort(descending);
     const {kept}=retainNewest(all,this.perCourse,this.globalLimit,this.byteBudget);
     const keys=new Set(kept.map(r=>r.key));retained=kept.length;
     for(const row of all)if(!keys.has(row.key)){store.delete(row.key);removed++;}
    }catch{try{tx.abort();}catch{}}
   };
   await complete;
   return {ok:true,removed,retained};
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
     cemeteryEntry(row,row.recordedAt)?.key===row.key).sort(descending).slice(0,CEMETERY_MAX_ATTEMPTS);
  }catch{return [];}finally{db?.close?.();}
 }
}
