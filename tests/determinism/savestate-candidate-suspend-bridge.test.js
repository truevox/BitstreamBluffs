/** #424: strict format/layout registration only; NOT live Save/Resume. */
import {fakeIdb} from '../replay/fakeIdb.js';
import {canonicalBytes,parseCanonical} from '../../src/systems/replay/canonicalJson.js';
import {digestOf} from '../../src/systems/replay/canonicalSha256.js';
import {savestateLayoutIdOf} from '../../src/systems/savestate/layout.js';
import {snapshotEnvelopeBytes,inspectSnapshotEnvelope} from '../../src/systems/savestate/envelope.js';
import {LocalSuspendSlot} from '../../src/systems/savestate/localSuspendSlot.js';
import {SAVESTATE_LAYOUT_DESCRIPTOR,CANDIDATE_SECTION_KEYS} from '../../src/systems/savestate/layoutDeclaration.js';
import {CANDIDATE_SUSPEND_LAYOUT_ID,candidateSuspendLayout,
 candidateSuspendEnvelopeBytes,inspectCandidateSuspendEnvelope} from '../../src/systems/savestate/candidateSuspendEnvelope.js';
const H=c=>'sha256:'+c.repeat(64);
const runtime=()=>({gameVersion:'2.25.20',buildId:H('a'),
 physicsIdentity:{rulesetId:H('b'),simRevision:9},
 matterVersion:'0.20.0',savestateLayoutId:CANDIDATE_SUSPEND_LAYOUT_ID});
const candidate=(changes={})=>{
 const obj={kind:'bb-internal-candidate-file',version:1,runId:'local-run-481',
  tick:481,buildId:H('a'),rulesetId:H('b'),simRevision:9,seed:'sim-05@0',
  sections:Object.fromEntries(CANDIDATE_SECTION_KEYS.map(k=>[k,k==='clock'?{tick:481}:{}]))};
 return {...obj,...changes,integrity:digestOf({...obj,...changes})};
};
const uuid=i=>`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`;

test('layout registration is descriptor-bound and never reports trusted/restorable score authority',()=>{
 expect(savestateLayoutIdOf(SAVESTATE_LAYOUT_DESCRIPTOR)).toBe(CANDIDATE_SUSPEND_LAYOUT_ID);
 expect(Object.keys(SAVESTATE_LAYOUT_DESCRIPTOR.sections)).toEqual(['candidate']);
 const e=candidateSuspendEnvelopeBytes(canonicalBytes(candidate()),runtime());
 const checked=inspectSnapshotEnvelope(e,runtime(),candidateSuspendLayout);
 expect(checked).toMatchObject({ok:true,admission:'envelope-only'});
 expect(checked).not.toHaveProperty('trusted');
 expect(checked).not.toHaveProperty('restorable');
 expect(checked).not.toHaveProperty('verifiedRankEligible');
 const bridge=inspectCandidateSuspendEnvelope(e,runtime());
 expect(bridge).toMatchObject({ok:true,admission:'envelope-only',tick:481,runId:'local-run-481'});
 expect(bridge.candidateBytes).toEqual(canonicalBytes(candidate()));
});

test('invalid nested file, stale build, malformed sections or external purpose never enter storage',async()=>{
 const idb=fakeIdb(),slot=new LocalSuspendSlot({idb,uuid:()=>uuid(1)});
 const good=candidateSuspendEnvelopeBytes(canonicalBytes(candidate()),runtime());
 const c=candidate(),bad={...c,integrity:H('f')};
 expect(()=>candidateSuspendEnvelopeBytes(canonicalBytes(bad),runtime())).toThrow('invalid-candidate');
 expect(()=>candidateSuspendEnvelopeBytes(canonicalBytes(candidate({tick:482})),runtime())).toThrow();
 expect(()=>candidateSuspendEnvelopeBytes(canonicalBytes(candidate({buildId:H('c')})),runtime())).toThrow('identity-mismatch');
 expect(()=>candidateSuspendEnvelopeBytes(canonicalBytes(candidate({sections:{clock:{tick:481}}})),runtime())).toThrow();
 expect((await slot.put(good,runtime(),candidateSuspendLayout)).ok).toBe(true);
 const changed={...runtime(),buildId:H('c')};
 expect(await slot.claim(changed,candidateSuspendLayout)).toMatchObject({ok:false,code:'build-mismatch'});
 expect(await slot.claim(runtime(),null)).toMatchObject({ok:false,code:'unsupported-layout'});
 expect((await slot.claim(runtime(),candidateSuspendLayout)).ok).toBe(true);
});

test('a newly re-sealed wrapper with changed inner run/tick/identity fails before IDB mutation',async()=>{
 const good=candidateSuspendEnvelopeBytes(canonicalBytes(candidate()),runtime());
 for(const change of [
  e=>{e.tick=482;},
  e=>{e.runId='forged-new-run';},
  e=>{e.payload.sections.candidate.buildId=H('c');},
  e=>{e.payload.sections.candidate.sections.clock.tick=482;},
 ]){
  const e=parseCanonical(good);change(e);
  if(e.payload.sections.candidate.buildId===H('c')){
    const c=e.payload.sections.candidate;delete c.integrity;c.integrity=digestOf(c);
  }
  const resealed=snapshotEnvelopeBytes((({integrity,...unsigned})=>unsigned)(e));
  const check=inspectCandidateSuspendEnvelope(resealed,runtime());
  expect(check).toMatchObject({ok:false,code:'invalid-section'});
  const idb=fakeIdb(),slot=new LocalSuspendSlot({idb,uuid:()=>uuid(2)});
  expect(await slot.put(resealed,runtime(),candidateSuspendLayout)).toMatchObject({ok:false,code:'invalid-section'});
  expect(await slot.claim(runtime(),candidateSuspendLayout)).toEqual({ok:false,code:'empty'});
 }
});

test('atomic two-tab claim, explicit release and one-time consume preserve envelope-only status',async()=>{
 const idb=fakeIdb(),a=new LocalSuspendSlot({idb,uuid:()=>uuid(3)}),
  b=new LocalSuspendSlot({idb,uuid:()=>uuid(4)});
 const bytes=candidateSuspendEnvelopeBytes(canonicalBytes(candidate()),runtime());
 expect((await a.put(bytes,runtime(),candidateSuspendLayout)).ok).toBe(true);
 const [x,y]=await Promise.all([a.claim(runtime(),candidateSuspendLayout),b.claim(runtime(),candidateSuspendLayout)]);
 const winner=x.ok?x:y,owner=x.ok?a:b,loser=x.ok?b:a;
 expect([x,y].filter(z=>z.ok)).toHaveLength(1);
 expect(inspectCandidateSuspendEnvelope(winner.bytes,runtime()).ok).toBe(true);
 expect(await loser.claim(runtime(),candidateSuspendLayout)).toEqual({ok:false,code:'slot-claimed'});
 expect((await owner.release(winner.token)).ok).toBe(true);
 const retry=await loser.claim(runtime(),candidateSuspendLayout);
 expect(retry).toMatchObject({ok:true,admission:'envelope-only',claimed:true});
 expect((await loser.consume(retry.token)).ok).toBe(true);
 expect(await owner.claim(runtime(),candidateSuspendLayout)).toEqual({ok:false,code:'empty'});
});
