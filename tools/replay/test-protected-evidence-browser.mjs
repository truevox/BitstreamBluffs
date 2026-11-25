/** #244 — REAL browser IndexedDB acceptance; no external network, writes only browser test profile.
 * Run with local Vite already serving this exact worktree: GAME_URL=http://127.0.0.1:18261/ node tools/replay/test-protected-evidence-browser.mjs
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin=process.env.GAME_URL || 'http://127.0.0.1:18261/';
const tape=JSON.parse(fs.readFileSync('tests/fixtures/replay/v1/legacy-tape.json','utf8'));
const reports=[];
const runId='browser-evidence-qa';
const digestPrefix='sha256:';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const context=await browser.newContext();
  const a=await context.newPage(),b=await context.newPage();
  await Promise.all([a.goto(origin,{waitUntil:'domcontentloaded'}),b.goto(origin,{waitUntil:'domcontentloaded'})]);
  const init=await a.evaluate(async({tape,runId})=>{
    const [{EvidenceStore},{evidenceBundle,legacyManifestFromTape}]=await Promise.all([
      import('/src/systems/replay/evidenceStore.js'),import('/src/systems/replay/manifest.js')]);
    const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
    const bundle=evidenceBundle({manifest:legacyManifestFromTape(tape),tape});
    const digest=await store.put(bundle,{runId});
    const candidate=await store.protect(digest,{runId,role:'candidate'});
    globalThis.__evidenceQa={store,bundle,digest,candidate};
    return {backend:store.backend,durable:store.durable,digest,candidate};
  },{tape,runId});
  assert.equal(init.backend,'idb');assert.equal(init.durable,true);
  assert.equal(init.digest.startsWith(digestPrefix),true);
  assert.equal(init.candidate.count,1);
  reports.push({case:'chromium-real-idb-save-pin',result:'PASS',digest:init.digest});

  // Read the protected role from another tab and attempt an opaque run-ID spoof.
  const hostile=await b.evaluate(async({runId,refKey})=>{
    const store=globalThis.__evidenceQaOther?.store;
    const {EvidenceStore}=await import('/src/systems/replay/evidenceStore.js');
    const active=store || await new EvidenceStore({idb:indexedDB,storage:null}).init();
    globalThis.__evidenceQaOther={store:active};
    const got=await active.getProtected(refKey);
    let code='wrongly-accepted';
    try{await active.put(got.bytes,{runId:'forged-run'});}catch(e){code=e.code;}
    return {backend:active.backend,durable:active.durable,bytes:got.bytes.length,code};
  },{runId,refKey:init.candidate.key});
  assert.equal(hostile.code,'run-id-conflict');
  reports.push({case:'chromium-real-idb-reopen-and-run-id-spoof-rejected',result:'PASS',bytes:hostile.bytes});

  const stale=await a.evaluate(async()=>{
    const {store,candidate,digest}=globalThis.__evidenceQa;
    await store.unprotect(candidate.key);
    return {count:store.protectedCount(digest),retained:await store.get(digest)!==null};
  });
  assert.equal(stale.count,0);assert.equal(stale.retained,true);
  const staleRead=await b.evaluate(async(key)=>{
    try{await globalThis.__evidenceQaOther.store.getProtected(key);return 'wrongly-returned';}
    catch(e){return e.code;}
  },init.candidate.key);
  assert.equal(staleRead,'stale-protection');
  reports.push({case:'chromium-real-idb-stale-cross-tab-role-rejected',result:'PASS'});

  const pinned=await a.evaluate(async({digest,runId})=>{
    const {store}=globalThis.__evidenceQa;
    const pinned=await store.protect(digest,{runId,role:'pinned'});
    return pinned;
  },{digest:init.digest,runId});
  assert.equal(pinned.count,1);
  const denied=await b.evaluate(async digest=>{
    const store=globalThis.__evidenceQaOther.store;
    try{await store.remove(digest);return 'wrongly-removed';}
    catch(e){return e.code;}
  },init.digest);
  assert.equal(denied,'protected-evidence');
  reports.push({case:'chromium-real-idb-cross-tab-delete-atomic',result:'PASS'});

  const restarted=await context.newPage(); await restarted.goto(origin,{waitUntil:'domcontentloaded'});
  const afterRestart=await restarted.evaluate(async({key,digest})=>{
    const {EvidenceStore}=await import('/src/systems/replay/evidenceStore.js');
    const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
    const got=await store.getProtected(key);
    await store.unprotect(key);
    await store.remove(digest);
    return {bytes:got.bytes.length,refsNow:store.listProtections().length,remaining:await store.get(digest)};
  },{key:pinned.key,digest:init.digest});
  assert.equal(afterRestart.bytes,hostile.bytes);assert.equal(afterRestart.refsNow,0);assert.equal(afterRestart.remaining,null);
  reports.push({case:'chromium-real-idb-restart-unpin-explicit-delete',result:'PASS'});
  await context.close();

  // Fresh browser context: recreate old v1 schema and retain a blocking v1 handle.
  const blockedContext=await browser.newContext();
  const old=await blockedContext.newPage(),upgrade=await blockedContext.newPage();
  await Promise.all([old.goto(origin,{waitUntil:'domcontentloaded'}),upgrade.goto(origin,{waitUntil:'domcontentloaded'})]);
  const opened=await old.evaluate(async()=>{
    const req=indexedDB.open('bitstream-replay-evidence',1);
    req.onupgradeneeded=()=>{
      req.result.createObjectStore('bundles',{keyPath:'digest'});
      req.result.createObjectStore('index',{keyPath:'digest'});
    };
    const db=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    globalThis.__blockedLegacyDB=db;
    return db.version;
  });
  assert.equal(opened,1);
  const memory=await upgrade.evaluate(async()=>{
    const {EvidenceStore}=await import('/src/systems/replay/evidenceStore.js');
    const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
    return {backend:store.backend,durable:store.durable,code:store.lastError?.code};
  });
  assert.equal(memory.backend,'memory');assert.equal(memory.durable,false);assert.equal(memory.code,'read-failed');
  await old.evaluate(()=>globalThis.__blockedLegacyDB.close());
  await upgrade.waitForTimeout(100);
  const recovered=await upgrade.evaluate(async()=>{
    const {EvidenceStore}=await import('/src/systems/replay/evidenceStore.js');
    const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
    return {backend:store.backend,durable:store.durable};
  });
  assert.equal(recovered.backend,'idb');assert.equal(recovered.durable,true);
  reports.push({case:'chromium-real-idb-blocked-v1-upgrade-fails-closed-and-recovers',result:'PASS'});
  await blockedContext.close();

  // Real IndexedDB cross-tab delete barrier, not merely fake-IDB atomicity.
  // Model a previously failed session-only capture by inserting validated
  // canonical bytes into the TEST store's pending queue, never into IDB.
  const deletionContext=await browser.newContext();
  const pendingPage=await deletionContext.newPage(),ownerPage=await deletionContext.newPage();
  await Promise.all([pendingPage.goto(origin,{waitUntil:'domcontentloaded'}),ownerPage.goto(origin,{waitUntil:'domcontentloaded'})]);
  const staged=await pendingPage.evaluate(async tape=>{
    const [{EvidenceStore},{evidenceBundle,legacyManifestFromTape,bundleDigest,bundleBytes}]=await Promise.all([
      import('/src/systems/replay/evidenceStore.js'),import('/src/systems/replay/manifest.js')]);
    const target=evidenceBundle({manifest:legacyManifestFromTape(tape),tape});
    const bytes=bundleBytes(target),digest=bundleDigest(target);
    const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
    store.pending.set(digest,bytes);
    store.pendingMeta.set(digest,{digest,runId:'stale-tab-original',size:bytes.length,seq:1});
    globalThis.__staleDeleteQa={store,target,digest};
    return digest;
  },tape);
  const erased=await ownerPage.evaluate(async({tape,digest})=>{
    const [{EvidenceStore},{evidenceBundle,legacyManifestFromTape}]=await Promise.all([
      import('/src/systems/replay/evidenceStore.js'),import('/src/systems/replay/manifest.js')]);
    const store=await new EvidenceStore({idb:indexedDB,storage:null}).init();
    const target=evidenceBundle({manifest:legacyManifestFromTape(tape),tape});
    await store.put(target,{archiveOnly:true});
    await store.remove(digest);
    return await store.inspectBundle(digest);
  },{tape,digest:staged});
  assert.deepEqual(erased,{readable:false,durable:false,runBound:false});
  const blocked=await pendingPage.evaluate(async()=>{
    const {store,target,digest}=globalThis.__staleDeleteQa;
    await store.put({...target,claims:{...target.claims,score:777}},{runId:'unrelated-new-save'});
    return {unsafe:store._unsafePending.has(digest),pending:store.pending.has(digest)};
  });
  assert.equal(blocked.unsafe,true);assert.equal(blocked.pending,true);
  const persisted=await ownerPage.evaluate(async digest=>{
    const {EvidenceStore}=await import('/src/systems/replay/evidenceStore.js');
    return new EvidenceStore({idb:indexedDB,storage:null}).init().then(s=>s.inspectBundle(digest));
  },staged);
  assert.deepEqual(persisted,{readable:false,durable:false,runBound:false});
  reports.push({case:'chromium-real-idb-cross-tab-delete-tombstone-blocks-stale-autoflush',result:'PASS'});
  await deletionContext.close();

  console.log(JSON.stringify({format:'bb-protected-evidence-browser-qa',checks:reports.length,reports,source:origin,headlessChromium:true,NO_UPLOAD:true},null,2));
} finally { await browser.close(); }
