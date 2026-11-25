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
    expect(c2.generation).toBe(c.generation);
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

  test('concurrent tabs cannot rebind one digest to another run after protection', async () => {
    const idb=fakeIdb();
    const first=await new EvidenceStore({idb,storage:null}).init();
    const second=await new EvidenceStore({idb,storage:null}).init(); // stale index, loaded before the write
    const digest=await first.put(bundle(),{runId:'true-local-run'});
    const held=await first.protect(digest,{runId:'true-local-run',role:'pinned'});
    await expect(second.put(bundle(),{runId:'different-local-run'})).rejects.toMatchObject({code:'run-id-conflict'});
    expect(second.has(digest)).toBe(false); // losing write does not poison local index
    const re=await new EvidenceStore({idb,storage:null}).init();
    expect(re.list()[0].runId).toBe('true-local-run');
    expect(re.protectedCount(digest)).toBe(1);
    expect((await re.getProtected(held.key)).reference.runId).toBe('true-local-run');
  });

  test('stale cache cannot permanently block an already unpinned durable bundle deletion', async () => {
    const {store,digest,idb}=await seededStore();
    const held=await store.protect(digest,{runId:RUN,role:'candidate'});
    const stale=await new EvidenceStore({idb,storage:null}).init();
    await store.unprotect(held.key);
    expect(stale.protectedCount(digest)).toBe(1); // known stale cache
    await stale.remove(digest); // persisted refs, not stale cache, decide
    expect((await new EvidenceStore({idb,storage:null}).init()).has(digest)).toBe(false);
  });

  test('stale-tab getProtected fails closed rather than returning an obsolete unpinned role', async () => {
    const {store,digest,idb}=await seededStore();
    const held=await store.protect(digest,{runId:RUN,role:'candidate'});
    const stale=await new EvidenceStore({idb,storage:null}).init();
    await store.unprotect(held.key);
    expect(await store.get(digest)).not.toBeNull();
    await expect(stale.getProtected(held.key)).rejects.toMatchObject({code:'stale-protection'});
    expect((await new EvidenceStore({idb,storage:null}).init()).listProtections()).toEqual([]);
  });

  test('blocked upgrade closes a late success connection after memory fallback', async () => {
    let req;
    let closed=0;
    const blocked={open(){req={}; Promise.resolve().then(()=>req.onblocked()); return req;}};
    const s=await new EvidenceStore({idb:blocked,storage:null}).init();
    expect(s.backend).toBe('memory');
    expect(s.lastError.code).toBe('read-failed');
    req.result={close(){closed++}};
    req.onsuccess();
    expect(closed).toBe(1);
  });

  test('transactional fake IDB serializes simultaneous writes to the same store', async () => {
    const idb=fakeIdb();
    const db=await req2p(idb.open('serialized-check',1));
    // Open a fresh test DB with the correct schema via a second explicit upgrade.
    const upgraded=await new Promise((resolve,reject)=>{
      const r=idb.open('serialized-check',2);
      r.onupgradeneeded=()=>r.result.createObjectStore('rows',{keyPath:'id'});
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
    expect(db).toBeDefined();
    const a=upgraded.transaction('rows','readwrite');
    const b=upgraded.transaction('rows','readwrite');
    const ad=transactionDone(a),bd=transactionDone(b);
    a.objectStore('rows').put({id:1});b.objectStore('rows').put({id:2});
    await Promise.all([ad,bd]);
    const rd=upgraded.transaction('rows','readonly');
    const rows=await req2p(rd.objectStore('rows').getAll());
    expect(rows).toEqual([{id:1},{id:2}]);
  });

  test('overlapping puts in one tab retain the winning durable cache entry after conflict', async () => {
    const idb=fakeIdb();
    const s=await new EvidenceStore({idb,storage:null}).init();
    const a=s.put(bundle(),{runId:'run-A'});
    const b=s.put(bundle(),{runId:'run-B'});
    const outcomes=await Promise.allSettled([a,b]);
    expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter(o=>o.status==='rejected').map(o=>o.reason.code)).toEqual(['run-id-conflict']);
    const digest=bundleDigest(bundle());
    expect(s.has(digest)).toBe(true);
    expect(await s.get(digest)).toEqual(bundleBytes(bundle()));
    const re=await new EvidenceStore({idb,storage:null}).init();
    expect(s.list()[0].runId).toBe(re.list()[0].runId);
  });

  test('durable write follows persisted run binding when cached entry was deleted/replaced in another tab', async () => {
    const idb=fakeIdb();
    const a=await new EvidenceStore({idb,storage:null}).init();
    const digest=await a.put(bundle(),{runId:'old-run'});
    const stale=await new EvidenceStore({idb,storage:null}).init();
    await a.remove(digest);
    const current=await new EvidenceStore({idb,storage:null}).init();
    await current.put(bundle(),{runId:'new-run'});
    expect(await stale.put(bundle(),{runId:'new-run'})).toBe(digest);
    expect(await stale.put(bundle())).toBe(digest); // no explicit run ID: adopt persisted
    expect(stale.list()[0].runId).toBe('new-run');
    expect((await new EvidenceStore({idb,storage:null}).init()).list()[0].runId).toBe('new-run');
  });

  test('unresolved pending run conflict cannot block unrelated pending evidence flush', async () => {
    const idb=fakeIdb();
    const s=await new EvidenceStore({idb,storage:null}).init();
    const changed=score=>({...bundle(),claims:{...bundle().claims,score}});
    const p1=changed(11),p2=changed(22),p3=changed(33);
    idb.hooks.failPut=new Error('disk busy');
    await expect(s.put(p1,{runId:'pending-A'})).rejects.toMatchObject({code:'write-failed'});
    await expect(s.put(p2,{runId:'pending-2'})).rejects.toMatchObject({code:'write-failed'});
    expect(s.pending.size).toBe(2);
    idb.hooks.failPut=null;
    const other=await new EvidenceStore({idb,storage:null}).init();
    await other.put(p1,{runId:'persisted-B'});
    await s.put(p3,{runId:'new-3'}); // retries both; the first conflict must not starve p2
    const re=await new EvidenceStore({idb,storage:null}).init();
    expect(re.has(bundleDigest(p2))).toBe(true);
    expect(re.has(bundleDigest(p3))).toBe(true);
    expect(re.list().find(v=>v.digest===bundleDigest(p1)).runId).toBe('persisted-B');
    expect(s.pending.has(bundleDigest(p1))).toBe(true); // unresolved memory-only bytes are not silently lost
    expect(s.pending.has(bundleDigest(p2))).toBe(false);
    expect(s.durable).toBe(false);
    expect(s.lastError.code).toBe('run-id-conflict');
  });

  test('versionchange closes connection and immediately marks store non-durable', async () => {
    const {store,digest}=await seededStore();
    expect(store.durable).toBe(true);
    const db=store._db;
    db.onversionchange();
    expect(store.backend).toBe('memory');
    expect(store.durable).toBe(false);
    expect(store.lastError.code).toBe('read-failed');
    await expect(store.protect(digest,{runId:RUN,role:'candidate'})).rejects.toMatchObject({code:'not-durable'});
  });

  test('reinit after cleared browser storage drops stale indices and protected references', async () => {
    const idb=fakeIdb();
    const a=await new EvidenceStore({idb,storage:null}).init();
    const digest=await a.put(bundle(),{runId:RUN});
    const ref=await a.protect(digest,{runId:RUN,role:'pinned'});
    expect(a.has(digest)).toBe(true);
    expect(a.protectedCount(digest)).toBe(1);
    // IndexedDB's database deletion/clear is represented by a fresh factory
    // when the old handle was already invalidated by versionchange.
    a._db.onversionchange();
    a._idb=fakeIdb();
    await a.init();
    expect(a.backend).toBe('idb');
    expect(a.durable).toBe(true);
    expect(a.has(digest)).toBe(false);
    expect(a.listProtections()).toEqual([]);
    expect(await a.getProtected(ref.key)).toBeNull();
  });

  test('a failed duplicate write with no runId retains a previously saved binding', async () => {
    const {store,digest,idb}=await seededStore();
    idb.hooks.failPut=Object.assign(new Error('quota'),{name:'QuotaExceededError'});
    await expect(store.put(bundle())).rejects.toMatchObject({code:'quota-exceeded'});
    expect(store.index.get(digest).runId).toBe(RUN);
    expect(store.has(digest)).toBe(true);
    idb.hooks.failPut=null;
    const ref=await store.protect(digest,{runId:RUN,role:'pinned'}).catch(e=>e);
    // A new successful write can flush the session-only duplicate before pinning.
    if(ref instanceof Error){
      expect(ref.code).toBe('not-durable');
      await store.put(bundle(),{runId:RUN});
      expect((await store.protect(digest,{runId:RUN,role:'pinned'})).count).toBe(1);
    } else expect(ref.count).toBe(1);
  });

  test('retry retains explicit run binding when prior evidence was unbound and write failed', async () => {
    const idb=fakeIdb();
    const s=await new EvidenceStore({idb,storage:null}).init();
    const digest=await s.put(bundle()); // old unbound index row
    expect(s.index.get(digest).runId).toBeNull();
    idb.hooks.failPut=Object.assign(new Error('quota'),{name:'QuotaExceededError'});
    await expect(s.put(bundle(),{runId:'later-bound'})).rejects.toMatchObject({code:'quota-exceeded'});
    expect(s.pendingMeta.get(digest).runId).toBe('later-bound');
    idb.hooks.failPut=null;
    const another={...bundle(),claims:{...bundle().claims,score:107}};
    await s.put(another,{runId:'new-run'}); // flushes original request with exact run binding
    const re=await new EvidenceStore({idb,storage:null}).init();
    expect(re.index.get(digest).runId).toBe('later-bound');
    expect(s.pending.has(digest)).toBe(false);
    expect(s.pendingMeta.has(digest)).toBe(false);
  });

  test('explicit remove while another put triggers flush never resurrects a pending bundle', async () => {
    const idb=fakeIdb();
    const s=await new EvidenceStore({idb,storage:null}).init();
    const one={...bundle(),claims:{...bundle().claims,score:111}};
    const two={...bundle(),claims:{...bundle().claims,score:222}};
    idb.hooks.failPut=new Error('write temporarily failed');
    await expect(s.put(one,{runId:'pending-delete'})).rejects.toMatchObject({code:'write-failed'});
    const digest=bundleDigest(one);
    expect(s.pending.has(digest)).toBe(true);
    idb.hooks.failPut=null;
    const writer=s.put(two,{runId:'independent'});
    const remover=s.remove(digest);
    await Promise.all([writer,remover]);
    expect(s.pending.has(digest)).toBe(false);
    expect(s.pendingMeta.has(digest)).toBe(false);
    expect(s.has(digest)).toBe(false);
    const re=await new EvidenceStore({idb,storage:null}).init();
    expect(re.has(digest)).toBe(false);
    expect(re.has(bundleDigest(two))).toBe(true);
  });

  test('reinit does not let a foreign persisted binding override pending run identity', async () => {
    const idb=fakeIdb();
    const s=await new EvidenceStore({idb,storage:null}).init();
    idb.hooks.failPut=new Error('temporary storage failure');
    await expect(s.put(bundle(),{runId:'pending-original'})).rejects.toMatchObject({code:'write-failed'});
    const digest=bundleDigest(bundle());
    idb.hooks.failPut=null;
    const other=await new EvidenceStore({idb,storage:null}).init();
    await other.put(bundle(),{runId:'foreign-persisted'});
    await s.init();
    expect(s.index.get(digest).runId).toBe('foreign-persisted');
    expect(s.pendingMeta.get(digest).runId).toBe('pending-original');
    const another={...bundle(),claims:{...bundle().claims,score:407}};
    await s.put(another,{runId:'unrelated'}); // persisted conflict is not downgraded
    const re=await new EvidenceStore({idb,storage:null}).init();
    expect(re.index.get(digest).runId).toBe('foreign-persisted');
    expect(re.has(bundleDigest(another))).toBe(true);
    expect(s.pending.has(digest)).toBe(true);
    expect(s.lastError.code).toBe('run-id-conflict');
  });

  test('overlapping explicit and unbound writes never discard the explicit pending run claim', async () => {
    const idb=fakeIdb();
    const store=await new EvidenceStore({idb,storage:null}).init();
    const d=bundleDigest(bundle());
    idb.hooks.failPut=v=>v?.runId==='claimed-A'?new Error('targeted failure'):null;
    const first=store.put(bundle(),{runId:'claimed-A'});
    const second=store.put(bundle());
    const [a,b]=await Promise.allSettled([first,second]);
    expect(a.status).toBe('rejected'); expect(a.reason.code).toBe('write-failed');
    expect(b.status).toBe('fulfilled');
    expect(store.pendingMeta.get(d).runId).toBe('claimed-A');
    expect(store.pending.has(d)).toBe(true);
    idb.hooks.failPut=null;
    const unrelated={...bundle(),claims:{...bundle().claims,score:507}};
    await store.put(unrelated,{runId:'another-run'}); // flushes exact pending A binding
    const reopened=await new EvidenceStore({idb,storage:null}).init();
    expect(reopened.index.get(d).runId).toBe('claimed-A');
    expect(store.pending.has(d)).toBe(false);
  });

  test('index and protection references are loaded in one readonly transaction snapshot', async () => {
    const idb=fakeIdb();
    const s=await new EvidenceStore({idb,storage:null}).init();
    const d=await s.put(bundle(),{runId:RUN});
    await s.protect(d,{runId:RUN,role:'candidate'});
    const events=[];
    idb.hooks.onTransaction=(names,mode)=>events.push({names,mode});
    const reopened=await new EvidenceStore({idb,storage:null}).init();
    expect(reopened.protectedCount(d)).toBe(1);
    expect(reopened.has(d)).toBe(true);
    expect(events.filter(v=>v.mode==='readonly')).toEqual([
      {names:['index','protectedRefs'],mode:'readonly'},
    ]);
  });

  test('database version change makes explicit deletion refuse until a real durable reopen', async () => {
    const {store,digest,idb}=await seededStore();
    store._db.onversionchange();
    await expect(store.remove(digest)).rejects.toMatchObject({code:'not-durable'});
    expect(store.has(digest)).toBe(true);
    await store.init();
    expect(store.durable).toBe(true);
    await store.remove(digest);
    const re=await new EvidenceStore({idb,storage:null}).init();
    expect(re.has(digest)).toBe(false);
  });

  test('two failed overlapping writes preserve the one explicit pending run claim', async () => {
    const idb=fakeIdb();
    const store=await new EvidenceStore({idb,storage:null}).init();
    idb.hooks.failPut=new Error('offline');
    const explicit=store.put(bundle(),{runId:'explicit-first'});
    const unbound=store.put(bundle());
    const outcomes=await Promise.allSettled([explicit,unbound]);
    expect(outcomes.map(x=>x.status)).toEqual(['rejected','rejected']);
    const digest=bundleDigest(bundle());
    expect(store.pendingMeta.get(digest).runId).toBe('explicit-first');
    idb.hooks.failPut=null;
    const other={...bundle(),claims:{...bundle().claims,score:607}};
    await store.put(other,{runId:'separate'});
    expect((await new EvidenceStore({idb,storage:null}).init()).index.get(digest).runId).toBe('explicit-first');
  });

  test('failed redundant unbound write never retries or steals a later persisted run binding', async () => {
    const idb=fakeIdb();
    const old=await new EvidenceStore({idb,storage:null}).init();
    const digest=await old.put(bundle(),{runId:'stale-A'});
    idb.hooks.failPut=new Error('quota');
    await expect(old.put(bundle())).rejects.toMatchObject({code:'write-failed'});
    // Redundant failed writes must not become resurrection-capable pending work.
    expect(old.pending.has(digest)).toBe(false);
    expect(old.pendingMeta.has(digest)).toBe(false);
    idb.hooks.failPut=null;
    const fresh=await new EvidenceStore({idb,storage:null}).init();
    await fresh.remove(digest);
    await fresh.put(bundle(),{runId:'current-B'});
    expect(await old.put(bundle())).toBe(digest);
    expect(old.index.get(digest).runId).toBe('current-B');
    expect((await new EvidenceStore({idb,storage:null}).init()).index.get(digest).runId).toBe('current-B');
  });

  test('successful durable deletion clears stale cached protection rows too', async () => {
    const {store,digest,idb}=await seededStore();
    const ref=await store.protect(digest,{runId:RUN,role:'pinned'});
    const stale=await new EvidenceStore({idb,storage:null}).init();
    expect(stale.protectedCount(digest)).toBe(1);
    await store.unprotect(ref.key);
    await stale.remove(digest);
    expect(stale.protectedCount(digest)).toBe(0);
    expect(stale.listProtections()).toEqual([]);
    expect(stale.has(digest)).toBe(false);
  });

  test('per-bundle durability is independent of unrelated failed session-only writes', async () => {
    const idb=fakeIdb();
    const store=await new EvidenceStore({idb,storage:null}).init();
    const persisted=await store.put(bundle(),{runId:RUN});
    expect(await store.isBundleDurable(persisted)).toBe(true);
    const different={...bundle(),claims:{...bundle().claims,score:802}};
    const otherDigest=bundleDigest(different);
    idb.hooks.failPut=new Error('disk full');
    await expect(store.put(different,{runId:'failed-run'})).rejects.toMatchObject({code:'write-failed'});
    expect(store.durable).toBe(false);
    expect(await store.isBundleDurable(persisted)).toBe(true);
    expect(await store.isBundleDurable(otherDigest)).toBe(false);
    store._db.onversionchange();
    expect(await store.isBundleDurable(persisted)).toBe(false);
  });

  test('cross-tab protect counts the real persisted roles, not the stale local snapshot',async()=>{
    const idb=fakeIdb();
    const one=await new EvidenceStore({idb,storage:null}).init();
    const digest=await one.put(bundle(),{runId:RUN});
    const two=await new EvidenceStore({idb,storage:null}).init();
    const candidate=await one.protect(digest,{runId:RUN,role:'candidate'});
    expect(candidate.count).toBe(1);
    const pinned=await two.protect(digest,{runId:RUN,role:'pinned'});
    expect(pinned.count).toBe(2);
    expect(two.protectedCount(digest)).toBe(1); // demonstrably stale
    expect(await two.persistedProtectedCount(digest)).toBe(2);
    await one.unprotect(candidate.key);
    expect(await two.persistedProtectedCount(digest)).toBe(1);
  });

  test('request+transaction read failures fall back without claiming a durable archive',async()=>{
    const idb=fakeIdb();
    idb.hooks.failGetAll=new Error('IDB read denied');
    const errors=[];
    const store=await new EvidenceStore({idb,storage:null,onError:e=>errors.push(e.code)}).init();
    expect(store.backend).toBe('memory');
    expect(store.durable).toBe(false);
    expect(store.lastError.code).toBe('read-failed');
    expect(errors).toEqual(['read-failed']);
    idb.hooks.failGetAll=null;
    await store.init();
    expect(store.backend).toBe('idb');
  });

  test('archive-only import succeeds when a pending run claim conflicts with another tab',async()=>{
    const idb=fakeIdb();
    const first=await new EvidenceStore({idb,storage:null}).init();
    idb.hooks.failPut=new Error('disk offline');
    await expect(first.put(bundle(),{runId:'pending-run-A'})).rejects.toMatchObject({code:'write-failed'});
    idb.hooks.failPut=null;
    const other=await new EvidenceStore({idb,storage:null}).init();
    const digest=await other.put(bundle(),{runId:'persisted-run-B'});
    const imported=await first.importBundle(bundleBytes(bundle()),{expectedDigest:digest});
    expect(imported).toBe(digest);
    expect(await first.isBundleDurable(digest)).toBe(true);
    expect(first.pendingMeta.get(digest).runId).toBe('pending-run-A');
    expect((await new EvidenceStore({idb,storage:null}).init()).index.get(digest).runId).toBe('persisted-run-B');
  });

  test('durability read errors are caught and failed init closes the opened connection',async()=>{
    const idb=fakeIdb();
    const store=await new EvidenceStore({idb,storage:null}).init();
    const digest=await store.put(bundle(),{runId:RUN});
    idb.hooks.failGet=new Error('read request denied');
    expect(await store.isBundleDurable(digest)).toBe(false);
    idb.hooks.failGet=null;
    idb.hooks.failGetAll=new Error('initial snapshot broken');
    const next=await new EvidenceStore({idb,storage:null}).init();
    expect(next.backend).toBe('memory');
    expect(idb.hooks.closeCount).toBeGreaterThan(0);
  });

  test('persisted count is part of the committing protection transaction',async()=>{
    const {store,digest,idb}=await seededStore();
    const before=await store.persistedProtectedCount(digest);
    expect(before).toBe(0);
    const held=await store.protect(digest,{runId:RUN,role:'pinned'});
    expect(held.count).toBe(1);
    idb.hooks.failGetAll=new Error('subsequent reads denied');
    // The committed role was already reported; a later failed count read
    // cannot retroactively report the successful pin as a failed operation.
    expect(held.durable).toBe(true);
    idb.hooks.failGetAll=null;
    expect(await store.persistedProtectedCount(digest)).toBe(1);
  });

  test('unexpected IDB close invalidates durability and allows reopening without page reload',async()=>{
    const {store,digest,idb}=await seededStore();
    expect(store.durable).toBe(true);
    store._db.onclose(); // simulates force-closed browser storage connection
    expect(store.backend).toBe('memory');
    expect(store.durable).toBe(false);
    await store.init();
    expect(store.backend).toBe('idb');
    expect(store.durable).toBe(true);
    expect(await store.get(digest)).toEqual(bundleBytes(bundle()));
  });

  test('local protection accepts a canonical older-ruleset bundle without certifying gameplay',async()=>{
    const idb=fakeIdb();
    const { liveTape,liveManifest,ruleset,rulesetOf }=await import('./manifestFixtures.js');
    const store=await new EvidenceStore({idb,storage:null,rulesetResolver:rulesetOf(ruleset())}).init();
    const tape=liveTape(),manifest=liveManifest({tape,checkpoints:{algo:null,detail:'none',schemas:null}});
    const payload=evidenceBundle({manifest,tape});
    // Tape was recorded and indexed under an earlier executable/ruleset.
    const digest=await store.put(bundleBytes(payload),{runId:'historical-local'});
    store.rulesetResolver=()=>null; // the newer game no longer knows that ruleset
    const held=await store.protect(digest,{runId:'historical-local',role:'pinned'});
    expect(held).toMatchObject({count:1,durable:true,runId:'historical-local'});
  });

  test('duplicate archive import in memory mode preserves prior bound original run ID',async()=>{
    const store=await new EvidenceStore({idb:null,storage:null}).init();
    const digest=await store.put(bundle(),{runId:'original'});
    await store.importBundle(bundleBytes(bundle()),{expectedDigest:digest});
    expect(store.index.get(digest).runId).toBe('original');
    expect(store.pendingMeta.get(digest).runId).toBe('original');
    expect(store.list()[0].runId).toBe('original');
  });

  test('reinitialization closes prior opened connection instead of accumulating handles',async()=>{
    const idb=fakeIdb();
    const store=await new EvidenceStore({idb,storage:null}).init();
    const db=store._db;
    const before=idb.hooks.closeCount;
    await store.init();
    expect(store._db).not.toBe(db);
    expect(idb.hooks.closeCount).toBe(before+1);
    expect(store.backend).toBe('idb');
  });

  test('recovering IndexedDB automatically flushes session-only evidence without waiting for another run',async()=>{
    const idb=fakeIdb();
    const store=await new EvidenceStore({idb:{open(){throw new Error('blocked upgrade');}},storage:null}).init();
    expect(store.backend).toBe('memory');
    const digest=await store.put(bundle(),{runId:RUN});
    expect(store.pending.has(digest)).toBe(true);
    expect(store.durable).toBe(false);
    store._idb=idb;
    await store.init();
    expect(store.backend).toBe('idb');
    expect(store.pending.has(digest)).toBe(false);
    expect(store.durable).toBe(true);
    expect((await new EvidenceStore({idb,storage:null}).init()).index.get(digest).runId).toBe(RUN);
    const held=await store.protect(digest,{runId:RUN,role:'pinned'});
    expect(held.count).toBe(1);
  });

  test('stale tab cannot unpin a recreated same-digest and same-role reference (ABA)',async()=>{
    const {store,digest,idb}=await seededStore();
    const first=await store.protect(digest,{runId:RUN,role:'pinned'});
    expect(first.generation).toMatch(/^[0-9a-f]{32}$/);
    const stale=await new EvidenceStore({idb,storage:null}).init();
    await store.unprotect(first.key);
    const recreated=await store.protect(digest,{runId:RUN,role:'pinned'});
    expect(recreated.key).toBe(first.key);
    expect(recreated.generation).not.toBe(first.generation);
    await expect(stale.unprotect(first.key)).rejects.toMatchObject({code:'stale-protection'});
    await expect(stale.getProtected(first.key)).rejects.toMatchObject({code:'stale-protection'});
    const re=await new EvidenceStore({idb,storage:null}).init();
    expect(re.protectedCount(digest)).toBe(1);
    expect(re.listProtections()[0].generation).toBe(recreated.generation);
    await expect(re.remove(digest)).rejects.toMatchObject({code:'protected-evidence'});
  });

  test('durable run binding is checked from persisted row rather than stale in-memory index',async()=>{
    const {store,digest,idb}=await seededStore();
    expect(await store.isBundleDurable(digest,{runId:RUN})).toBe(true);
    expect(await store.isBundleDurable(digest,{runId:'forged-other'})).toBe(false);
    const stale=await new EvidenceStore({idb,storage:null}).init();
    await store.remove(digest);
    const fresh=await new EvidenceStore({idb,storage:null}).init();
    await fresh.put(bundle(),{runId:'replacement-run'});
    expect(stale.index.get(digest).runId).toBe(RUN); // stale cached run ID
    expect(await stale.isBundleDurable(digest,{runId:RUN})).toBe(false);
    expect(await stale.isBundleDurable(digest,{runId:'replacement-run'})).toBe(true);
  });

  test('another tab can protect a newly saved run without trusting its stale index',async()=>{
    const idb=fakeIdb();
    const stale=await new EvidenceStore({idb,storage:null}).init();
    const writer=await new EvidenceStore({idb,storage:null}).init();
    const digest=await writer.put(bundle(),{runId:'cross-tab-new-run'});
    expect(stale.index.has(digest)).toBe(false);
    const held=await stale.protect(digest,{runId:'cross-tab-new-run',role:'pinned'});
    expect(held).toMatchObject({durable:true,count:1,runId:'cross-tab-new-run'});
    expect(stale.index.get(digest).runId).toBe('cross-tab-new-run');
    expect((await new EvidenceStore({idb,storage:null}).init()).protectedCount(digest)).toBe(1);
  });

  test('closed then cleared DB never recovers a stale run ID through archive-only import',async()=>{
    const old=fakeIdb();
    const store=await new EvidenceStore({idb:old,storage:null}).init();
    const digest=await store.put(bundle(),{runId:'vanished-previous-run'});
    store._db.onclose(); // forced close + browser storage cleared outside this tab
    store._idb=fakeIdb();
    await store.importBundle(bundleBytes(bundle()),{expectedDigest:digest});
    expect(store.pendingMeta.get(digest)?.runId).toBeNull();
    await store.init(); // automatic flush
    expect((await new EvidenceStore({idb:store._idb,storage:null}).init()).index.get(digest).runId).toBeNull();
    await expect(store.protect(digest,{runId:'vanished-previous-run',role:'pinned'})).rejects.toMatchObject({code:'run-id-mismatch'});
  });

  test('explicit UI generation snapshot refuses unpin after refreshed cache adopts replacement role',async()=>{
    const idb=fakeIdb(),store=await new EvidenceStore({idb,storage:null}).init();
    const digest=await store.put(bundle(),{runId:RUN});
    const original=await store.protect(digest,{runId:RUN,role:'pinned'});
    const other=await new EvidenceStore({idb,storage:null}).init();
    await other.unprotect(original.key);
    const replacement=await other.protect(digest,{runId:RUN,role:'pinned'});
    expect(replacement.generation).not.toBe(original.generation);
    await store.persistedProtections(digest); // refresh cache, not displayed UI
    expect(store.protections.get(original.key).generation).toBe(replacement.generation);
    await expect(store.unprotect(original.key,{expectedGeneration:original.generation})).rejects.toMatchObject({code:'stale-protection'});
    expect(await store.persistedProtectedCount(digest)).toBe(1);
    expect((await new EvidenceStore({idb,storage:null}).init()).listProtections()[0].generation).toBe(replacement.generation);
  });

  test('P1 forged prevalidated digest cannot overwrite pinned canonical evidence bytes',async()=>{
    const {store,digest,idb}=await seededStore();
    const pinned=await store.protect(digest,{runId:RUN,role:'pinned'});
    const original=await store.getProtected(pinned.key);
    expect(original.bytes).toEqual(bundleBytes(bundle()));
    const tampered=Uint8Array.from(bundleBytes(bundle()));
    tampered[43]^=0x01;
    await expect(store.put(tampered,{runId:RUN},{ok:true,bundleDigest:digest})).rejects.toMatchObject({code:'invalid-bundle'});
    const validButDifferent={...bundle(),claims:{...bundle().claims,score:bundle().claims.score+19}};
    expect(bundleDigest(validButDifferent)).not.toBe(digest);
    await expect(store.put(validButDifferent,{runId:RUN},{ok:true,bundleDigest:digest})).rejects.toMatchObject({code:'validation-hint-mismatch'});
    expect(await store.isBundleDurable(digest,{runId:RUN})).toBe(true);
    expect((await store.getProtected(pinned.key)).bytes).toEqual(original.bytes);
    const restarted=await new EvidenceStore({idb,storage:null}).init();
    expect((await restarted.getProtected(pinned.key)).bytes).toEqual(original.bytes);
    expect(restarted.list().map(r=>r.digest)).toEqual([digest]);
    expect(restarted.protectedCount(digest)).toBe(1);
  });

  test('failed redundant duplicate never resurrects evidence another tab explicitly deletes',async()=>{
    const idb=fakeIdb(),a=await new EvidenceStore({idb,storage:null}).init();
    const digest=await a.put(bundle(),{runId:RUN});
    const b=await new EvidenceStore({idb,storage:null}).init();
    idb.hooks.failPut=new Error('duplicate update denied');
    await expect(a.put(bundle(),{runId:RUN})).rejects.toMatchObject({code:'write-failed'});
    expect(a.pending.has(digest)).toBe(false);
    idb.hooks.failPut=null;
    await b.remove(digest);
    await a.init(); // automatic recovery must NOT resurrect a deleted digest
    expect((await new EvidenceStore({idb,storage:null}).init()).has(digest)).toBe(false);
  });

  test('a previous durable record remains protectable despite stale pending duplicate bytes',async()=>{
    const idb=fakeIdb(),s=await new EvidenceStore({idb,storage:null}).init();
    const digest=await s.put(bundle(),{runId:RUN});
    s.pending.set(digest,bundleBytes(bundle()));
    s.pendingMeta.set(digest,s.index.get(digest));
    expect(s.durable).toBe(false);
    expect(await s.isBundleDurable(digest,{runId:RUN})).toBe(true);
    const ref=await s.protect(digest,{runId:RUN,role:'pinned'});
    expect(ref).toMatchObject({count:1,durable:true});
    expect(await s.persistedProtectedCount(digest)).toBe(1);
  });

  test('forced close and cleared DB allows a fresh explicit run binding, never stale cached identity',async()=>{
    const idb=fakeIdb(),s=await new EvidenceStore({idb,storage:null}).init();
    const digest=await s.put(bundle(),{runId:'vanished-old-run'});
    s._db.onclose();
    s._idb=fakeIdb();
    await expect(s.put(bundle(),{runId:'new-after-clear'})).resolves.toBe(digest);
    expect(s.pendingMeta.get(digest).runId).toBe('new-after-clear');
    await s.init();
    const persisted=await new EvidenceStore({idb:s._idb,storage:null}).init();
    expect(persisted.index.get(digest).runId).toBe('new-after-clear');
    await expect(s.protect(digest,{runId:'vanished-old-run',role:'pinned'})).rejects.toMatchObject({code:'run-id-mismatch'});
    expect((await s.protect(digest,{runId:'new-after-clear',role:'pinned'})).count).toBe(1);
  });

  test('single-snapshot inspection avoids triple hashing and Refresh retries quota-failed evidence',async()=>{
    const idb=fakeIdb(),s=await new EvidenceStore({idb,storage:null}).init();
    const newBundle={...bundle(),claims:{...bundle().claims,score:991}};
    const digest=bundleDigest(newBundle);
    idb.hooks.failPut=new Error('quota');
    await expect(s.put(newBundle,{runId:'quota-run'})).rejects.toMatchObject({code:'write-failed'});
    expect(await s.inspectBundle(digest,{runId:'quota-run'})).toEqual({readable:true,durable:false,runBound:false});
    idb.hooks.failPut=null;
    const receipt=await s.retryPending();
    expect(receipt).toMatchObject({attempted:1,recovered:1,remaining:0});
    const seen=[];idb.hooks.onTransaction=(names,mode)=>seen.push({names,mode});
    const status=await s.inspectBundle(digest,{runId:'quota-run'});
    idb.hooks.onTransaction=null;
    expect(status).toEqual({readable:true,durable:true,runBound:true});
    expect(seen.filter(x=>x.mode==='readonly')).toEqual([{names:['index','bundles'],mode:'readonly'}]);
    expect(await s.isBundleDurable(digest,{runId:'incorrect'})).toBe(false);
  });

  test('failed duplicate from stale tab with no cached index never resurrects cross-tab deletion',async()=>{
    const idb=fakeIdb(),stale=await new EvidenceStore({idb,storage:null}).init();
    const writer=await new EvidenceStore({idb,storage:null}).init();
    const digest=await writer.put(bundle(),{runId:RUN});
    expect(stale.has(digest)).toBe(false);
    idb.hooks.failPut=new Error('write of stale-tab duplicate failed');
    await expect(stale.put(bundle(),{runId:RUN})).rejects.toMatchObject({code:'write-failed'});
    expect(stale.pending.has(digest)).toBe(false);
    idb.hooks.failPut=null;
    await writer.remove(digest);
    await stale.init();
    expect(stale.has(digest)).toBe(false);
    expect((await new EvidenceStore({idb,storage:null}).init()).has(digest)).toBe(false);
  });

  test('a stale tab can export inspected persisted evidence without an initial local index entry',async()=>{
    const idb=fakeIdb(),stale=await new EvidenceStore({idb,storage:null}).init();
    const writer=await new EvidenceStore({idb,storage:null}).init();
    const digest=await writer.put(bundle(),{runId:RUN});
    expect(stale.has(digest)).toBe(false);
    expect(await stale.inspectBundle(digest,{runId:RUN})).toEqual({readable:true,durable:true,runBound:true});
    const exported=await stale.exportBundle(digest);
    expect(exported.digest).toBe(digest);
    expect(exported.bytes).toEqual(bundleBytes(bundle()));
    expect(stale.index.get(digest).runId).toBe(RUN);
  });

  test('archive inspection reads durability and protected count in one atomic IDB snapshot',async()=>{
    const {store,digest,idb}=await seededStore();
    const pinned=await store.protect(digest,{runId:RUN,role:'pinned'});
    const events=[];idb.hooks.onTransaction=(names,mode)=>events.push({names,mode});
    expect(await store.inspectBundle(digest,{runId:RUN,withProtections:true})).toEqual({readable:true,durable:true,runBound:true,protectionCount:1});
    expect(events.filter(x=>x.mode==='readonly')).toEqual([{names:['index','bundles','protectedRefs'],mode:'readonly'}]);
    idb.hooks.onTransaction=null;
    await store.unprotect(pinned.key);
    await store.remove(digest);
    expect(await store.inspectBundle(digest,{withProtections:true})).toEqual({readable:false,durable:false,runBound:false,protectionCount:0});
  });

  test('concurrent retries coalesce: a second queued retry cannot resurrect cross-tab deletion',async()=>{
    const idb=fakeIdb(),a=await new EvidenceStore({idb,storage:null}).init();
    idb.hooks.failPut=new Error('quota');
    await expect(a.put(bundle(),{runId:RUN})).rejects.toMatchObject({code:'write-failed'});
    const digest=bundleDigest(bundle());
    idb.hooks.failPut=null;
    const b=await new EvidenceStore({idb,storage:null}).init();
    const [first,second]=await Promise.all([
      a.retryPending({digest}),
      a.retryPending({digest}),
      b.remove(digest),
    ]).then(([one,two])=>[one,two]);
    expect(first.attempted+second.attempted).toBe(1);
    expect(a.pending.has(digest)).toBe(false);
    expect((await new EvidenceStore({idb,storage:null}).init()).has(digest)).toBe(false);
  });

  test('Refresh retries a small chosen digest before an older quota-failed bundle',async()=>{
    const idb=fakeIdb(),s=await new EvidenceStore({idb,storage:null}).init();
    const old={...bundle(),claims:{...bundle().claims,score:721}};
    const young={...bundle(),claims:{...bundle().claims,score:722}};
    const oldDigest=bundleDigest(old),youngDigest=bundleDigest(young);
    idb.hooks.failPut=new Error('offline');
    await expect(s.put(old,{runId:'older'})).rejects.toMatchObject({code:'write-failed'});
    await expect(s.put(young,{runId:'current'})).rejects.toMatchObject({code:'write-failed'});
    idb.hooks.failPut=v=>v?.digest===oldDigest?new Error('older too big for remaining quota'):null;
    const receipt=await s.retryPending({digest:youngDigest});
    expect(receipt).toMatchObject({recovered:1,remaining:1});
    expect(await s.isBundleDurable(youngDigest,{runId:'current'})).toBe(true);
    expect(s.pending.has(oldDigest)).toBe(true);
    expect(s.pending.has(youngDigest)).toBe(false);
  });

  test('explicit retry reconnects blocked IDB and counts only writes actually attempted',async()=>{
    const idb=fakeIdb();
    const s=await new EvidenceStore({idb:{open(){throw new Error('upgrade blocked');}},storage:null}).init();
    const digest=await s.put(bundle(),{runId:RUN});
    expect(s.pending.size).toBe(1);
    expect(await s.retryPending({digest})).toMatchObject({attempted:0,recovered:0,remaining:1});
    s._idb=idb;
    expect(await s.retryPending({digest})).toMatchObject({attempted:1,recovered:1,remaining:0});
    expect(s.backend).toBe('idb');
    expect((await new EvidenceStore({idb,storage:null}).init()).has(digest)).toBe(true);
  });

  test('an uncertain IndexedDB read keeps bytes exportable but never auto-resurrects after deletion',async()=>{
    const idb=fakeIdb(),a=await new EvidenceStore({idb,storage:null}).init();
    const digest=await a.put(bundle(),{runId:RUN});
    const b=await new EvidenceStore({idb,storage:null}).init();
    idb.hooks.failGet=new Error('unexpected IDB read failure');
    await expect(a.put(bundle(),{runId:RUN})).rejects.toMatchObject({code:'write-failed'});
    expect(a.pending.has(digest)).toBe(true); // can still export this session
    expect(a._unsafePending.has(digest)).toBe(true); // cannot auto-retry
    idb.hooks.failGet=null;
    await b.remove(digest);
    expect(await a.retryPending({digest})).toMatchObject({attempted:0,recovered:0,remaining:1});
    expect((await new EvidenceStore({idb,storage:null}).init()).has(digest)).toBe(false);
    expect((await a.exportBundle(digest)).bytes).toEqual(bundleBytes(bundle()));
    await a.init();
    expect((await new EvidenceStore({idb,storage:null}).init()).has(digest)).toBe(false);
  });

  test('concurrent initializations share one IDB open and close superseded handles',async()=>{
    const idb=fakeIdb();let opens=0;
    const factory={open(...args){opens++;return idb.open(...args);}};
    const s=new EvidenceStore({idb:factory,storage:null});
    await Promise.all([s.init(),s.init(),s.init()]);
    expect(opens).toBe(1);
    expect(s.backend).toBe('idb');
    const old=s._db;
    await s.init();
    expect(opens).toBe(2);
    expect(s._db).not.toBe(old);
    expect(idb.hooks.closeCount).toBe(1);
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
