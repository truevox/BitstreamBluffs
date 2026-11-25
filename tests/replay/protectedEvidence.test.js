/** #244: protected full replay inputs are independent from the five cosmetic ghost roles. */
import { EvidenceStore, EVIDENCE_DB, EVIDENCE_REFS, EVIDENCE_DB_VERSION } from '../../src/systems/replay/evidenceStore.js';
import { GhostLibrary, courseGhostRuns } from '../../src/systems/ghost/GhostLibrary.js';
import { evidenceBundle, legacyManifestFromTape, bundleDigest, bundleBytes } from '../../src/systems/replay/manifest.js';
import { legacyTape } from './manifestFixtures.js';
import { fakeIdb } from './fakeIdb.js';

const bundle = () => evidenceBundle({ manifest: legacyManifestFromTape(legacyTape()), tape: legacyTape() });
const RUN = 'proof-run-1';
const seededStore = async (idb = fakeIdb(), id = RUN) => {
  const store = await new EvidenceStore({ idb, storage: null }).init();
  const digest = await store.put(bundle(), { runId:id });
  return { store, digest, idb };
};

const req2p = req => new Promise((resolve,reject)=>{
  req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
});
const transactionDone = tx => new Promise((resolve,reject)=>{
  tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error); tx.onerror=()=>reject(tx.error);
});

beforeEach(() => expect(EVIDENCE_DB_VERSION).toBe(2));

describe('protected local evidence references (#244)', () => {
  test('candidate/submitted/pinned roles share one immutable bundle, counts survive restart and require explicit release', async () => {
    const {store,digest,idb}=await seededStore();
    expect(store.protectedCount(digest)).toBe(0);
    const c=await store.protect(digest,{runId:RUN,role:'candidate'});
    expect(c).toMatchObject({digest,runId:RUN,role:'candidate',durable:true,count:1});
    expect(c.seed).toBe(legacyTape().seed);
    expect(c.biomeMask).toBe(legacyTape().biomeMask);
    const c2=await store.protect(digest,{runId:RUN,role:'candidate'});
    expect(c2.key).toBe(c.key);
    expect(store.protectedCount(digest)).toBe(1); // idempotent duplicate
    const submitted=await store.protect(digest,{runId:RUN,role:'submitted'});
    const pinned=await store.protect(digest,{runId:RUN,role:'pinned'});
    expect(store.protectedCount(digest)).toBe(3);
    await expect(store.remove(digest)).rejects.toMatchObject({code:'protected-evidence'});
    const restarted=await new EvidenceStore({idb,storage:null}).init();
    expect(restarted.listProtections().map(r=>r.role)).toEqual(['candidate','pinned','submitted']);
    expect(restarted.protectedCount(digest)).toBe(3);
    const record=await restarted.getProtected(pinned.key);
    expect(record.reference).toMatchObject({runId:RUN,role:'pinned',digest});
    expect(Buffer.from(record.bytes).equals(Buffer.from(bundleBytes(bundle())))).toBe(true);
    expect(await restarted.unprotect(c.key)).toBe(true);
    expect(await restarted.unprotect(submitted.key)).toBe(true);
    expect(await restarted.unprotect(pinned.key)).toBe(true);
    expect(restarted.protectedCount(digest)).toBe(0);
    expect(await restarted.get(digest)).not.toBeNull(); // unpin alone doesn't delete the bytes
    await restarted.remove(digest); // separate explicit deletion
    expect(await restarted.get(digest)).toBeNull();
  });

  test('cannot protect a different run id or overwrite saved index with an opaque foreign run id', async () => {
    const {store,digest,idb}=await seededStore();
    await expect(store.protect(digest,{runId:'forged',role:'pinned'})).rejects.toMatchObject({code:'run-id-mismatch'});
    await expect(store.put(bundle(),{runId:'forged'})).rejects.toMatchObject({code:'run-id-conflict'});
    await expect(store.protect(digest,{runId:RUN,role:'other-role'})).rejects.toMatchObject({code:'invalid-protection'});
    await expect(store.protect(digest,{runId:'',role:'pinned'})).rejects.toMatchObject({code:'invalid-protection'});
    expect((await new EvidenceStore({idb,storage:null}).init()).listProtections()).toEqual([]);
  });

  test('ghost Latest/Best/favorites churn cannot collect protected authoritative proof inputs', async () => {
    const idb=fakeIdb();
    const {store,digest}=await seededStore(idb);
    const pinned=await store.protect(digest,{runId:RUN,role:'pinned'});
    const prev=globalThis.indexedDB;globalThis.indexedDB=idb;
    try{
      const lib=new GhostLibrary(); await lib.init();
      const mk=(runId,distanceM)=>({...legacyTape(),runId,seed:'S1',biomeMask:7,mode:'normal',distanceM});
      await lib.saveRun(mk('g1',100)); await lib.saveRun(mk('g2',5));
      await lib.setFavorite('S1',7,0,'g2');
      await lib.saveRun(mk('g3',7));
      await lib.setFavorite('S1',7,1,'g3');
      await lib.saveRun(mk('g4',8));
      expect(courseGhostRuns(lib.course('S1',7))).toHaveLength(4);
      await lib.setFavorite('S1',7,0,null);
      await lib.saveRun(mk('g5',9));
      expect(await lib.getTape('g2')).toBeNull(); // cosmetic cache collected by design
      expect(courseGhostRuns(lib.course('S1',7))).toHaveLength(3); // never displays protected refs
      const restarted=await new EvidenceStore({idb,storage:null}).init();
      expect(restarted.protectedCount(digest)).toBe(1);
      expect((await restarted.getProtected(pinned.key)).bytes).toEqual(bundleBytes(bundle()));
      await expect(restarted.remove(digest)).rejects.toMatchObject({code:'protected-evidence'});
    } finally {globalThis.indexedDB=prev;}
  });

  test('quota and aborted protection transactions leave no phantom reference and keep original bytes', async () => {
    const {store,digest,idb}=await seededStore();
    idb.hooks.failPut=Object.assign(new Error('full'),{name:'QuotaExceededError'});
    await expect(store.protect(digest,{runId:RUN,role:'pinned'})).rejects.toMatchObject({code:'quota-exceeded'});
    expect(store.protectedCount(digest)).toBe(0);
    expect((await new EvidenceStore({idb,storage:null}).init()).listProtections()).toEqual([]);
    expect(await store.get(digest)).not.toBeNull();
    idb.hooks.failPut=null;
    const first=await store.protect(digest,{runId:RUN,role:'pinned'});
    idb.hooks.failDelete=new Error('disk unavailable');
    await expect(store.unprotect(first.key)).rejects.toMatchObject({code:'write-failed'});
    expect(store.protectedCount(digest)).toBe(1);
    await expect(store.remove(digest)).rejects.toMatchObject({code:'protected-evidence'});
    idb.hooks.failDelete=null;
    await store.unprotect(first.key);
    idb.hooks.failDelete=new Error('disk unavailable');
    await expect(store.remove(digest)).rejects.toMatchObject({code:'write-failed'});
    expect(store.has(digest)).toBe(true);
    expect((await new EvidenceStore({idb,storage:null}).init()).has(digest)).toBe(true);
    idb.hooks.failDelete=null;
    await store.remove(digest);
  });

  test('second tab reference added after first tab opened blocks a stale delete atomically', async () => {
    const {store,digest,idb}=await seededStore();
    const stale=await new EvidenceStore({idb,storage:null}).init();
    const r=await store.protect(digest,{runId:RUN,role:'submitted'});
    expect(stale.protectedCount(digest)).toBe(0); // stale in-memory cache
    await expect(stale.remove(digest)).rejects.toMatchObject({code:'protected-evidence'});
    expect(stale.has(digest)).toBe(true);
    expect((await new EvidenceStore({idb,storage:null}).init()).has(digest)).toBe(true);
    expect(r.role).toBe('submitted');
  });

  test('a stale tab cannot silently unpin a changed role reference', async () => {
    const {store,digest,idb}=await seededStore();
    const old=await store.protect(digest,{runId:RUN,role:'pinned'});
    const stale=await new EvidenceStore({idb,storage:null}).init();
    // Simulate another authorized tab replacing the same local role key;
    // the stale tab must not delete the new record merely by matching its key.
    const db=await req2p(idb.open(EVIDENCE_DB,EVIDENCE_DB_VERSION));
    const tx=db.transaction(EVIDENCE_REFS,'readwrite'); const done=transactionDone(tx);
    tx.objectStore(EVIDENCE_REFS).put({...old,digest:'sha256:'+'1'.repeat(64)});
    await done;
    await expect(stale.unprotect(old.key)).rejects.toMatchObject({code:'stale-protection'});
    expect(stale.protectedCount(digest)).toBe(1);
    const current=await new EvidenceStore({idb,storage:null}).init();
    expect(current.listProtections()[0].digest).toBe('sha256:'+'1'.repeat(64));
  });

  test('memory-only or pending evidence cannot be represented as durable protected storage', async () => {
    const memory=await new EvidenceStore({idb:null,storage:null}).init();
    const d=await memory.put(bundle(),{runId:RUN});
    await expect(memory.protect(d,{runId:RUN,role:'candidate'})).rejects.toMatchObject({code:'not-durable'});
    expect(memory.durable).toBe(false);
    const {store,idb}=await seededStore();
    idb.hooks.failPut=new Error('disk failure');
    const other={...bundle(),claims:{...bundle().claims,score:11}};
    const otherDigest=bundleDigest(other);
    await expect(store.put(other,{runId:'other'})).rejects.toMatchObject({code:'write-failed'});
    await expect(store.protect(otherDigest,{runId:'other',role:'pinned'})).rejects.toMatchObject({code:'not-durable'});
  });

  test('read checks retained bytes integrity; browser data clear is reported as loss, never magically restored', async () => {
    const {store,digest,idb}=await seededStore();
    const ref=await store.protect(digest,{runId:RUN,role:'pinned'});
    const db=await req2p(idb.open(EVIDENCE_DB,EVIDENCE_DB_VERSION));
    const tx=db.transaction('bundles','readwrite');const done=transactionDone(tx);
    const corrupt=Uint8Array.from(bundleBytes(bundle()));corrupt[40]^=0xff;
    tx.objectStore('bundles').put({digest,bytes:corrupt});await done;
    await expect(store.getProtected(ref.key)).rejects.toMatchObject({code:'corrupt-record'});
    const cleared=await new EvidenceStore({idb:fakeIdb(),storage:null}).init();
    expect(cleared.listProtections()).toEqual([]);
    expect(await cleared.getProtected(ref.key)).toBeNull();
    expect(cleared.durable).toBe(true); // EMPTY database can be durable; NOT a proof of surviving browser storage clear
  });

  test('v1 database upgrades in place to v2 without overwriting existing index/bundle', async () => {
    const idb=fakeIdb();
    const old=await new Promise((resolve,reject)=>{
      const req=idb.open(EVIDENCE_DB,1);
      req.onupgradeneeded=()=>{
        req.result.createObjectStore('bundles',{keyPath:'digest'});
        req.result.createObjectStore('index',{keyPath:'digest'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
    const d=bundleDigest(bundle()),bytes=bundleBytes(bundle());
    const tx=old.transaction(['bundles','index'],'readwrite');const done=transactionDone(tx);
    tx.objectStore('bundles').put({digest:d,bytes});
    tx.objectStore('index').put({digest:d,size:bytes.length,runId:RUN,seq:1});
    await done;
    const upgraded=await new EvidenceStore({idb,storage:null}).init();
    expect(upgraded.backend).toBe('idb');expect(upgraded.list()).toEqual([{digest:d,runId:RUN,size:bytes.length}]);
    expect(await upgraded.get(d)).toEqual(bytes);
    const ref=await upgraded.protect(d,{runId:RUN,role:'candidate'});
    const re=await new EvidenceStore({idb,storage:null}).init();
    expect(re.listProtections().map(r=>r.key)).toEqual([ref.key]);
    expect(EVIDENCE_REFS).toBe('protectedRefs');
  });
});
