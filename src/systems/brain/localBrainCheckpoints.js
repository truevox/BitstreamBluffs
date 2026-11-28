/** #451: fail-closed, LOCAL-ONLY, unprivileged Lab checkpoint substrate.
 *
 * A complete model/optimizer/queue/RNG snapshot is committed as ONE IDB row;
 * no learner is wired to this substrate yet. In particular, valid JSON is NOT
 * a validated model, trained policy, authorized reward, or Verified claim.
 * Files enter only a quarantined syntax lane until #24's model ABI exists.
 */
import {preflightBrainJson,BRAIN_PREFLIGHT_LIMITS} from './brainFilePreflight.js';

export const LAB_CHECKPOINT_DB='bb-lab-checkpoint-v1';
export const LAB_CHECKPOINT_STORE='checkpoints';
export const LAB_CHECKPOINT_ABI=1;
const ACTIVE='active',QUARANTINE='quarantine';
export const LAB_CHECKPOINT_ADVISORY_MARKER='bb.lab.checkpoint.v1.ever-saved';
const fail=code=>({ok:false,code});
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const failure=e=>e?.name==='QuotaExceededError'?'quota-exceeded':'storage-unavailable';

/** Syntax-safe, bounded storage envelope only. Never executes a brain. */
export function inspectLabCheckpoint(input){
 const parsed=preflightBrainJson(input);
 if(!parsed.ok)return parsed;
 const t=parsed.tree;
 if(t.format!=='bb-lab-checkpoint'||t.version!==LAB_CHECKPOINT_ABI||
  !Number.isSafeInteger(t.simRevision)||t.simRevision<1||
  typeof t.modelAbi!=='string'||!/^[a-zA-Z0-9._-]{1,128}$/.test(t.modelAbi)||
  !Number.isSafeInteger(t.generation)||t.generation<0||
  !isObject(t.brain)||!isObject(t.optimizer)||!Array.isArray(t.queue)||!isObject(t.rng)||
  Object.keys(t).some(k=>!['format','version','simRevision','modelAbi','generation',
   'brain','optimizer','queue','rng'].includes(k)))return fail('checkpoint-layout');
 const canonical=new TextEncoder().encode(JSON.stringify(t));
 if(!canonical.length||canonical.length>BRAIN_PREFLIGHT_LIMITS.maxBytes)return fail('file-too-large');
 return {ok:true,admission:'storage-only',bytes:canonical,
  simRevision:t.simRevision,modelAbi:t.modelAbi,generation:t.generation};
}

async function digest(bytes,cryptoRef){
 if(typeof cryptoRef?.subtle?.digest!=='function')throw Error('no crypto digest');
 const result=await cryptoRef.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(result),v=>v.toString(16).padStart(2,'0')).join('');
}

/** Always surface volatile-memory-only writes as FAILED durable saves.
 * A pending export stays available if the browser refuses/evicts storage.
 */
export class LocalBrainCheckpoints{
 constructor({idb=globalThis.indexedDB,storage=globalThis.navigator?.storage,
  cryptoRef=globalThis.crypto,markerStore=globalThis.localStorage}={}){
  this.idb=idb;this.storage=storage;this.cryptoRef=cryptoRef;
  this.markerStore=markerStore;
  this.pending=null;this.persistAttempt=null;this.saving=false;
 }
 async _open(){
  if(typeof this.idb?.open!=='function')throw Error('IndexedDB unavailable');
  return new Promise((resolve,reject)=>{
   let req;
   try{req=this.idb.open(LAB_CHECKPOINT_DB,1);}catch(e){reject(e);return;}
   req.onupgradeneeded=()=>{
    if(!req.result.objectStoreNames.contains(LAB_CHECKPOINT_STORE))
     req.result.createObjectStore(LAB_CHECKPOINT_STORE,{keyPath:'id'});
   };
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||Error('cannot open checkpoint DB'));
   req.onblocked=()=>reject(Error('checkpoint DB blocked'));
  });
 }
 async _persistence(){
  if(this.persistAttempt)return this.persistAttempt;
  // Only the first attempted save requests durable storage this session.
  this.persistAttempt=(async()=>{
   if(typeof this.storage?.persist!=='function')return 'unavailable';
   try{
    if(typeof this.storage.persisted==='function'&&await this.storage.persisted())return 'granted';
    return await this.storage.persist()?'granted':'refused';
   }catch{return 'unavailable';}
  })();
  return this.persistAttempt;
 }
 async _write(row){
  let db;
  try{
   db=await this._open();
   const tx=db.transaction(LAB_CHECKPOINT_STORE,'readwrite');
   const store=tx.objectStore(LAB_CHECKPOINT_STORE);
   let verdict=fail('storage-unavailable');
   const finished=new Promise((resolve,reject)=>{
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error||Error('checkpoint aborted'));
    tx.onerror=()=>reject(tx.error||Error('checkpoint transaction failed'));
   });
   const req=store.get(row.id);
   req.onsuccess=()=>{
    try{
     const prev=req.result;
     // No silent AI downgrade, cross-model replacement or revision migration.
     if(row.id===ACTIVE&&prev&&prev.modelAbi!==row.modelAbi)
      verdict=fail('model-abi-mismatch');
     else if(row.id===ACTIVE&&prev&&prev.simRevision!==row.simRevision)
      verdict=fail('sim-revision-mismatch');
     else if(row.id===ACTIVE&&prev&&prev.generation>row.generation)
      verdict=fail('stale-generation');
     else{store.put(row);verdict={ok:true};}
    }catch{try{tx.abort();}catch{}}
   };
   await finished;
   return verdict;
  }catch(e){return fail(failure(e));}
  finally{db?.close?.();}
 }
 /** No in-memory-only success status is allowed. `pending` is EXPORTABLE but
  * never durable until the real transaction completes.
  */
 async save(input){
  if(this.saving)return fail('save-in-progress');
  this.saving=true;
  try{return await this._save(input);}
  finally{this.saving=false;}
 }
 async _save(input){
  const inspected=inspectLabCheckpoint(input);
  if(!inspected.ok)return inspected;
  const stable=Uint8Array.from(inspected.bytes);
  this.pending=stable;
  let checksum;
  try{checksum=await digest(stable,this.cryptoRef);}catch{return {ok:false,code:'checksum-unavailable',durability:'memory-only',canExport:true};}
  const persistence=await this._persistence();
  const result=await this._write({id:ACTIVE,bytes:Uint8Array.from(stable),sha256:checksum,
   simRevision:inspected.simRevision,modelAbi:inspected.modelAbi,generation:inspected.generation});
  if(!result.ok)return {...result,durability:'memory-only',canExport:true,
   warning:'CHECKPOINT NOT SAVED — EXPORT YOUR BRAIN NOW'};
  if(this.pending===stable)this.pending=null;
  // Advisory only. If IndexedDB disappears while localStorage survives, warn
  // rather than presenting an empty brain as a normal first-run experience.
  // The marker is NOT an independent backup and cannot survive all evictions.
  try{this.markerStore?.setItem(LAB_CHECKPOINT_ADVISORY_MARKER,'1');}catch{}
  return {ok:true,saved:true,admission:'storage-only',
   durability:persistence==='granted'?'persistent-storage':'best-effort',
   warning:persistence==='granted'?null:
    'BROWSER MAY EVICT THIS BRAIN — EXPORT A BACKUP',
   persistence,bytes:inspected.bytes.length,sha256:checksum};
 }
 async _read(id){
  let db;
  try{
   db=await this._open();
   const tx=db.transaction(LAB_CHECKPOINT_STORE,'readonly');
   let row=null;
   const finished=new Promise((resolve,reject)=>{
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(tx.error||Error('checkpoint read aborted'));
    tx.onerror=()=>reject(tx.error||Error('checkpoint read failed'));
   });
   const req=tx.objectStore(LAB_CHECKPOINT_STORE).get(id);
   req.onsuccess=()=>{row=req.result||null;};
   await finished;
   if(!row)return fail('empty');
   if(!(row.bytes instanceof Uint8Array)||!row.bytes.length||
    row.bytes.byteLength>BRAIN_PREFLIGHT_LIMITS.maxBytes)return fail('invalid-bytes');
   const bytes=Uint8Array.from(row.bytes);
   if((await digest(bytes,this.cryptoRef))!==row.sha256)return fail('integrity-mismatch');
   const inspected=inspectLabCheckpoint(bytes);
   if(!inspected.ok||row.simRevision!==inspected.simRevision||
    row.modelAbi!==inspected.modelAbi||row.generation!==inspected.generation)
    return fail('checkpoint-mismatch');
   return {ok:true,admission:id===QUARANTINE?'quarantine-only':'storage-only',
    bytes,simRevision:inspected.simRevision,modelAbi:inspected.modelAbi,
    generation:inspected.generation};
  }catch(e){return fail(failure(e));}
  finally{db?.close?.();}
 }
 async read(){
  const record=await this._read(ACTIVE);
  if(record.code!=='empty')return record;
  try{
   if(this.markerStore?.getItem(LAB_CHECKPOINT_ADVISORY_MARKER)==='1')
    return {ok:false,code:'checkpoint-missing-after-save',
     warning:'BRAIN CHECKPOINT MISSING — RESTORE AN EXPORTED BACKUP'};
  }catch{}
  return record;
 }
 /** Export returns a DETACHED snapshot, including after a failed disk write.
  * The caller must perform actual download on a separate user gesture.
  */
 async export({pending=false}={}){
  if(pending){
   return this.pending?{ok:true,bytes:Uint8Array.from(this.pending),
    warning:'NOT SAVED IN BROWSER — DOWNLOAD REQUIRED'}:fail('no-pending-export');
  }
  const record=await this.read();
  return record.ok?{ok:true,bytes:record.bytes,admission:'storage-only'}:record;
 }
 /** Import is deliberately INERT until a reviewed #24 model ABI validator
  * exists. It never overwrites an existing trained checkpoint or runs code.
  * Preserved quarantine is a separate single atomic IDB record.
  */
 async importForReview(input){
  const inspected=inspectLabCheckpoint(input);
  if(!inspected.ok)return inspected;
  let checksum;
  try{checksum=await digest(inspected.bytes,this.cryptoRef);}catch{return fail('checksum-unavailable');}
  const result=await this._write({id:QUARANTINE,bytes:Uint8Array.from(inspected.bytes),
   sha256:checksum,simRevision:inspected.simRevision,
   modelAbi:inspected.modelAbi,generation:inspected.generation});
  return result.ok?{ok:true,admission:'quarantine-only',saved:true,
   warning:'FILE STORED FOR REVIEW — NOT A RUNNABLE BRAIN'}:result;
 }
 async readQuarantine(){return this._read(QUARANTINE);}
}

/** Must be called directly by a genuine user gesture. Successful result means
 * the BROWSER DOWNLOAD WAS REQUESTED, not that a file is safely on disk.
 */
export function requestLabCheckpointDownload(input,{
 documentRef=globalThis.document,urlRef=globalThis.URL,BlobCtor=globalThis.Blob,
 deferRevoke=cb=>globalThis.setTimeout(cb,60000),
 now=()=>new Date(),
}={}){
 const inspected=inspectLabCheckpoint(input);
 if(!inspected.ok)return inspected;
 if(!documentRef?.body||typeof urlRef?.createObjectURL!=='function'||
  typeof BlobCtor!=='function')return fail('download-unavailable');
 let link=null,url=null;
 try{
  const blob=new BlobCtor([Uint8Array.from(inspected.bytes)],
   {type:'application/octet-stream'});
  url=urlRef.createObjectURL(blob);
  link=documentRef.createElement('a');
  link.href=url;
  link.download='bitstream-bluffs-brain-'+now().toISOString().replace(/[.:]/g,'-')+'.bbbrain';
  link.style.display='none';
  documentRef.body.appendChild(link);
  link.click();
  return {ok:true,requested:true,admission:'backup-file-only'};
 }catch{return fail('download-unavailable');}
 finally{
  try{link?.remove();}catch{}
  if(url)try{deferRevoke(()=>urlRef.revokeObjectURL(url));}catch{}
 }
}
