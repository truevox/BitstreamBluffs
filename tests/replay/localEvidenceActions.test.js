import { LocalEvidenceActions, inspectLocalEvidenceImport } from '../../src/systems/replay/localEvidenceActions.js';
import { EvidenceStore } from '../../src/systems/replay/evidenceStore.js';
import { evidenceBundle,legacyManifestFromTape,bundleBytes,bundleDigest } from '../../src/systems/replay/manifest.js';
import { legacyTape } from './manifestFixtures.js';
import { fakeIdb } from './fakeIdb.js';
import { MAX_OUTPUT_BYTES } from '../../src/systems/replay/canonicalJson.js';

const bundle = () => evidenceBundle({manifest:legacyManifestFromTape(legacyTape()),tape:legacyTape()});
const bytes=()=>bundleBytes(bundle());
const digest=()=>bundleDigest(bundle());
const ready=async()=>{
  const idb=fakeIdb(),store=await new EvidenceStore({idb,storage:null}).init();
  const d=await store.put(bundle(),{runId:'intentional-local-run'});
  return {store,idb,d,control:new LocalEvidenceActions(store)};
};

describe('#244 explicit local Keep/Unpin/Export/Import controls (no network or public rank)',()=>{
  test('byte-exact import inspection accepts archive only, never claims a legitimate public score',()=>{
    const result=inspectLocalEvidenceImport(bytes(),{expectedDigest:digest()});
    expect(result).toMatchObject({ok:true,digest:digest(),buildIdentityVerified:false,replayVerified:false,
      publicRankEligible:false,status:'LOCAL ARCHIVE ONLY — UNVERIFIED',rulesetRelation:'legacy-no-ruleset'});
    expect(result.seed).toBe(legacyTape().seed);
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('corruption, missing original digest, unsupported format and noncanonical bytes are refused before storage',async()=>{
    expect(inspectLocalEvidenceImport(bytes(),{}).code).toBe('digest-required');
    expect(inspectLocalEvidenceImport('not bytes',{expectedDigest:digest()}).code).toBe('invalid-bytes');
    const mutated=Uint8Array.from(bytes());mutated[12]^=0xff;
    expect(inspectLocalEvidenceImport(mutated,{expectedDigest:digest()}).code).toBe('digest-mismatch');
    const padded=Buffer.from(Buffer.from(bytes()).toString('utf8')+'\n');
    expect(inspectLocalEvidenceImport(padded,{expectedDigest:bundleDigest(padded)}).code).toBe('not-canonical');
    const {control,store}=await ready();
    await expect(control.import(mutated,{expectedDigest:digest()})).rejects.toMatchObject({code:'digest-mismatch'});
    expect(store.list()).toHaveLength(1);
  });
  test('a matching declared ruleset is NOT an authenticated exact build or gameplay verification',()=>{
    const legacy=inspectLocalEvidenceImport(bytes(),{expectedDigest:digest(),currentRulesetId:'sha256:'+'a'.repeat(64)});
    expect(legacy.rulesetRelation).toBe('legacy-no-ruleset');expect(legacy.publicRankEligible).toBe(false);
  });
  test('explicit KEEP pins existing run ID locally and requests persistence only on user action',async()=>{
    const {store,d}=await ready();let called=0;
    store.requestPersistence=async()=>{called++;return false;};
    const control=new LocalEvidenceActions(store);
    expect(called).toBe(0);
    const held=await control.keep({digest:d,runId:'intentional-local-run',role:'pinned'});
    expect(called).toBe(1);
    expect(held).toMatchObject({ok:true,localDurable:true,browserPersistence:false,publicRankEligible:false});
    expect(store.protectedCount(d)).toBe(1);
    await expect(control.keep({digest:d,runId:'foreign-run'})).rejects.toMatchObject({code:'run-id-mismatch'});
    const unpinned=await control.unpin(held.reference.key);
    expect(unpinned).toEqual({ok:true,retainedBytes:true,publicRankEligible:false});
    expect(await store.get(d)).not.toBeNull();
  });
  test('export prepares local canonical bytes; import uses caller-known digest and does not pin or claim an original run',async()=>{
    const {control,d,store}=await ready();
    const exported=await control.export(d);
    expect(exported).toMatchObject({digest:d,filename:`${d.slice(7)}.bbreplay`,localOnly:true,publicRankEligible:false});
    const other=await new EvidenceStore({idb:fakeIdb(),storage:null}).init();
    const receiver=new LocalEvidenceActions(other);
    const imported=await receiver.import(exported.bytes,{expectedDigest:d});
    expect(imported).toMatchObject({ok:true,digest:d,localDurable:true,newlyProtected:false,protectionCount:0,alreadyProtected:false,publicRankEligible:false});
    expect(imported.inspection.status).toContain('UNVERIFIED');
    expect(other.listProtections()).toEqual([]);
    expect(other.index.get(d).runId).toBeNull();
    expect(await other.get(d)).toEqual(exported.bytes);
    expect(store.protectedCount(d)).toBe(0);
  });
  test('oversized file refuses BEFORE hashing and unsupported typed-array views return stable errors',()=>{
    const oversized=new Uint8Array(MAX_OUTPUT_BYTES+1);
    expect(inspectLocalEvidenceImport(oversized,{expectedDigest:digest()})).toEqual({ok:false,code:'too-large'});
    for(const typed of [new Int8Array(bytes()),new Uint8ClampedArray(bytes()),new DataView(bytes().buffer)])
      expect(inspectLocalEvidenceImport(typed,{expectedDigest:digest()})).toEqual({ok:false,code:'invalid-bytes'});
  });

  test('re-importing a pinned digest does NOT misreport the existing retained reference',async()=>{
    const {control,d,store}=await ready();
    await control.keep({digest:d,runId:'intentional-local-run'});
    const rec=await control.import(bytes(),{expectedDigest:d});
    expect(rec).toMatchObject({newlyProtected:false,alreadyProtected:true,protectionCount:1,publicRankEligible:false});
    expect(store.protectedCount(d)).toBe(1);
  });

  test('a durable import remains durable despite another unrelated memory-only pending bundle',async()=>{
    const idb=fakeIdb();const store=await new EvidenceStore({idb,storage:null}).init();
    const action=new LocalEvidenceActions(store);
    const other={...bundle(),claims:{...bundle().claims,score:930}};
    idb.hooks.failPut=new Error('quota');
    await expect(store.put(other,{runId:'failed'})).rejects.toMatchObject({code:'write-failed'});
    idb.hooks.failPut=null;
    // Force a persisted run-ID conflict for pending other: it cannot flush.
    const separate=await new EvidenceStore({idb,storage:null}).init();
    await separate.put(other,{runId:'foreign'});
    const result=await action.import(bytes(),{expectedDigest:digest()});
    expect(result.localDurable).toBe(true);
    expect(store.durable).toBe(false);
    expect(result.publicRankEligible).toBe(false);
  });

  test('reimport status reads persisted protection across two tabs, not stale cached counts',async()=>{
    const idb=fakeIdb();
    const source=await new EvidenceStore({idb,storage:null}).init();
    const d=await source.put(bundle(),{runId:'shared'});
    const importing=await new EvidenceStore({idb,storage:null}).init(); // stale from now on
    const held=await source.protect(d,{runId:'shared',role:'pinned'});
    expect(importing.protectedCount(d)).toBe(0);
    const control=new LocalEvidenceActions(importing);
    const one=await control.import(bytes(),{expectedDigest:d});
    expect(one).toMatchObject({protectionCount:1,alreadyProtected:true,newlyProtected:false});
    await source.unprotect(held.key);
    const two=await control.import(bytes(),{expectedDigest:d});
    expect(two).toMatchObject({protectionCount:0,alreadyProtected:false,newlyProtected:false});
  });

  test('imported local evidence on denied storage remains clearly non-durable, never silently protected',async()=>{
    const memory=await new EvidenceStore({idb:null,storage:null}).init();
    const action=new LocalEvidenceActions(memory);
    const imported=await action.import(bytes(),{expectedDigest:digest()});
    expect(imported.localDurable).toBe(false);
    expect(imported.newlyProtected).toBe(false);
    expect(memory.listProtections()).toEqual([]);
  });
});
