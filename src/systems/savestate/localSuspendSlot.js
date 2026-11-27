/** #119: LOCAL-ONLY single-use suspend-slot transaction boundary.
 *
 * Inert until a trusted production snapshot *layout*, strict Matter fresh-world
 * restore and complete GhostRecorder tick-zero continuation are shipped.
 * This module NEVER accepts an envelope as a trusted, restorable run: the
 * existing inspector only returns `admission: envelope-only`.
 *
 * One slot per browser database. Claimed slots stay held across tab crashes
 * (no unsafe TTL/retry); the trusted caller must explicitly release after an
 * unchanged failed restore or consume only after a successful fresh restore.
 * This is a local concurrency protocol, NOT cryptographic anti-cheat or a
 * defense against manually copied browser storage.
 */
import {MAX_OUTPUT_BYTES} from '../replay/canonicalJson.js';
import {inspectSnapshotEnvelope} from './envelope.js';

export const SUSPEND_SLOT_DB='bb-single-use-suspend-v1';
export const SUSPEND_SLOT_STORE='slots';
export const SUSPEND_SLOT_DB_VERSION=1;
export const SUSPEND_SLOT_KEY='local-suspend';

const failure=e=>e?.name==='QuotaExceededError'?'quota-exceeded':'storage-unavailable';

/** Format-only admission shared by non-claiming UI previews and atomic claims.
 * No digest, layout or build identity can authenticate a stored run.
 */
function inspectStoredReady(row,expectedIdentity,layout){
 if(!(row.bytes instanceof Uint8Array))return {ok:false,code:'invalid-bytes'};
 const inspected=inspectSnapshotEnvelope(row.bytes,expectedIdentity,layout);
 if(!inspected.ok)return {ok:false,code:inspected.code,pointer:inspected.pointer};
 if(inspected.admission!=='envelope-only'||inspected.envelope.purpose!=='suspend'||
    row.integrity!==inspected.envelope.integrity||
    row.runId!==inspected.envelope.runId||row.tick!==inspected.envelope.tick||
    row.buildId!==inspected.envelope.build.buildId)
  return {ok:false,code:'binding-mismatch'};
 return {ok:true,admission:'envelope-only',runId:inspected.envelope.runId,tick:inspected.envelope.tick};
}
const incompatibleCodes=new Set(['missing-runtime-identity','unsupported-layout','unsupported-format-version',
 'build-mismatch','physics-mismatch','matter-mismatch','layout-mismatch']);

export class LocalSuspendSlot{
 constructor({idb=globalThis.indexedDB,
  uuid=()=>globalThis.crypto?.randomUUID?.()}={}){
  this.idb=idb;
  this.uuid=uuid;
 }
 async _open(){
  if(!this.idb||typeof this.idb.open!=='function')throw Error('indexedDB unavailable');
  return new Promise((resolve,reject)=>{
   let req;
   try{req=this.idb.open(SUSPEND_SLOT_DB,SUSPEND_SLOT_DB_VERSION);}
   catch(e){reject(e);return;}
   req.onupgradeneeded=()=>{
    const db=req.result;
    if(!db.objectStoreNames.contains(SUSPEND_SLOT_STORE))
     db.createObjectStore(SUSPEND_SLOT_STORE,{keyPath:'id'});
   };
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||Error('IDB open failed'));
   req.onblocked=()=>reject(Error('IDB upgrade blocked'));
  });
 }
 /** Serializes an entire read/verify/change through a single readwrite IDB
  * transaction. No asynchronous work occurs between get.onsuccess and put,
  * so another tab cannot claim the same ready slot.
  */
 async _modify(fn){
  let db;
  try{
   db=await this._open();
   const tx=db.transaction(SUSPEND_SLOT_STORE,'readwrite');
   const store=tx.objectStore(SUSPEND_SLOT_STORE);
   let verdict={ok:false,code:'storage-unavailable'};
   const done=new Promise((resolve,reject)=>{
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error||Error('transaction aborted'));
    tx.onerror=()=>reject(tx.error||Error('transaction error'));
   });
   const request=store.get(SUSPEND_SLOT_KEY);
   request.onsuccess=()=>{
    try{verdict=fn(store,request.result||null);}
    catch(e){verdict={ok:false,code:'transaction-error'};try{tx.abort();}catch{}}
   };
   await done;
   return verdict;
  }catch(e){return {ok:false,code:failure(e)};}
  finally{db?.close?.();}
 }
 /** Read-only presentation hint, never a reservation or a restore capability.
  * The display may become stale the instant another tab claims this READY slot.
  * Neither sealed bytes nor ownership tokens are exposed to UI callers.
  */
 async peek(expectedIdentity,layout){
  let db;
  try{
   db=await this._open();
   const tx=db.transaction(SUSPEND_SLOT_STORE,'readonly');
   let row=null;
   const done=new Promise((resolve,reject)=>{
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error||Error('transaction aborted'));
    tx.onerror=()=>reject(tx.error||Error('transaction error'));
   });
   const request=tx.objectStore(SUSPEND_SLOT_STORE).get(SUSPEND_SLOT_KEY);
   request.onsuccess=()=>{row=request.result||null;};
   await done;
   // Parse/validate the detached IDB snapshot AFTER the readonly transaction
   // closes; a large candidate must not hold up another tab's atomic claim.
   try{
    if(!row)return {ok:true,status:'empty'};
    if(row.status==='claimed')return {ok:true,status:'claimed'};
    if(row.status!=='ready')return {ok:false,status:'corrupt',code:'invalid-slot-state'};
    const checked=inspectStoredReady(row,expectedIdentity,layout);
    return checked.ok?{ok:true,status:'ready',admission:'envelope-only',
     runId:checked.runId,tick:checked.tick}:
     {ok:false,status:incompatibleCodes.has(checked.code)?'incompatible':'corrupt',
      code:checked.code};
   }catch{return {ok:false,status:'corrupt',code:'inspection-failed'};}
  }catch(e){return {ok:false,status:'unavailable',code:failure(e)};}
  finally{db?.close?.();}
 }
 /** Explicitly keep a *pure-format-admitted* suspended envelope. The caller
  * must supply the expected exact-build identity and trusted shipped schema;
  * no default production registration is provided by the current game.
  */
 async put(bytes,expectedIdentity,layout,{replace=false}={}){
  if(!(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>MAX_OUTPUT_BYTES)
   return {ok:false,code:'invalid-bytes'};
  // COPY FIRST: caller mutation after validation must not change stored bytes.
  const stable=Uint8Array.from(bytes);
  const inspected=inspectSnapshotEnvelope(stable,expectedIdentity,layout);
  if(!inspected.ok)return {ok:false,code:inspected.code,pointer:inspected.pointer};
  if(inspected.admission!=='envelope-only'||inspected.envelope.purpose!=='suspend')
   return {ok:false,code:'not-suspend'};
  const {runId,tick,integrity}=inspected.envelope;
  const record={id:SUSPEND_SLOT_KEY,status:'ready',bytes:stable,runId,tick,
   integrity,buildId:inspected.envelope.build.buildId};
  return this._modify((store,current)=>{
   // Unknown persisted state is not a replaceable READY slot. Otherwise a
   // corrupt/migrated record could be silently destroyed by replace:true.
   if(current&&current.status!=='ready'&&current.status!=='claimed')
    return {ok:false,code:'invalid-slot-state'};
   if(current?.status==='claimed')return {ok:false,code:'slot-claimed'};
   if(current&&!replace)return {ok:false,code:'slot-occupied'};
   store.put(record);
   return {ok:true,admission:'envelope-only',saved:true,runId,tick,bytes:stable.length};
  });
 }
 /** Read-only availability for player UI. Never claims, consumes or removes
  * a slot; claim() must still revalidate atomically on explicit Resume.
  * A crashed/claimed slot stays claimed, not silently retried or erased.
  */
 async peek(expectedIdentity,layout){
  return this._modify((_store,current)=>{
   if(!current)return {ok:true,status:'empty'};
   if(current.status!=='ready')return {ok:true,status:'claimed'};
   if(!(current.bytes instanceof Uint8Array))return {ok:false,code:'invalid-bytes'};
   const inspected=inspectSnapshotEnvelope(current.bytes,expectedIdentity,layout);
   if(!inspected.ok)return {ok:false,code:inspected.code,pointer:inspected.pointer};
   if(inspected.admission!=='envelope-only'||inspected.envelope.purpose!=='suspend'||
    current.integrity!==inspected.envelope.integrity||
    current.runId!==inspected.envelope.runId||current.tick!==inspected.envelope.tick||
    current.buildId!==inspected.envelope.build.buildId)
    return {ok:false,code:'binding-mismatch'};
   return {ok:true,status:'ready',runId:current.runId,tick:current.tick};
  });
 }

 /** Exact-build/layout validation happens inside the same atomic claim
  * transaction, before any mutation. A stale/invalid/incomplete envelope is
  * LEFT untouched and never returned as a live-world restore capability.
  */
 async claim(expectedIdentity,layout){
  let claimToken;
  try{claimToken=this.uuid();}catch{return {ok:false,code:'secure-token-unavailable'};}
  if(typeof claimToken!=='string'||!/^[a-f0-9-]{36}$/i.test(claimToken))
   return {ok:false,code:'secure-token-unavailable'};
  return this._modify((store,current)=>{
   if(!current)return {ok:false,code:'empty'};
   if(current.status!=='ready')return {ok:false,code:'slot-claimed'};
   const checked=inspectStoredReady(current,expectedIdentity,layout);
   if(!checked.ok)return checked;
   store.put({...current,status:'claimed',claimedBy:claimToken});
   return {ok:true,admission:'envelope-only',claimed:true,token:claimToken,
    bytes:Uint8Array.from(current.bytes),runId:current.runId,tick:current.tick};
  });
 }
 /** Called ONLY after a trusted future runtime has actually restored the
  * world/recorder correctly; consumes the slot once. Stale tokens cannot
  * delete a newer ready or separately claimed record.
  */
 async consume(token){
  if(!token||typeof token!=='string')return {ok:false,code:'invalid-token'};
  return this._modify((store,current)=>{
   if(!current)return {ok:false,code:'empty'};
   if(current.status!=='claimed'||current.claimedBy!==token)
    return {ok:false,code:'claim-mismatch'};
   store.delete(SUSPEND_SLOT_KEY);
   return {ok:true,consumed:true};
  });
 }
 /** On *provably unchanged* failed restore, the owner of this claim may
  * release the slot for retry. A browser crash intentionally leaves it held
  * (no automatic lease expiry that could accidentally resume in two tabs).
  */
 async release(token){
  if(!token||typeof token!=='string')return {ok:false,code:'invalid-token'};
  return this._modify((store,current)=>{
   if(!current)return {ok:false,code:'empty'};
   if(current.status!=='claimed'||current.claimedBy!==token)
    return {ok:false,code:'claim-mismatch'};
   const next={...current,status:'ready'};
   delete next.claimedBy;
   store.put(next);
   return {ok:true,released:true};
  });
 }
 /** Explicit cleanup for an unused ready slot; never steals another tab's
  * in-progress claim or changes a scoring/ghost/evidence database.
  */
 async clearReady(){
  return this._modify((store,current)=>{
   if(!current)return {ok:true,cleared:false};
   if(current.status!=='ready')return {ok:false,code:'slot-claimed'};
   store.delete(SUSPEND_SLOT_KEY);
   return {ok:true,cleared:true};
  });
 }
}
