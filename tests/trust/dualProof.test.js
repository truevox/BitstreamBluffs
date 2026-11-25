/** #245. These fixtures model ALREADY authenticated backend receipts.
 * Fabricating a JSON fixture is not equivalent to establishing authority.
 */
import { adjudicateDualProof, DUAL_PROOF_FORMAT, DUAL_PROOF_VERSION } from '../../src/systems/trust/dualProof.js';
import { canonicalBytes } from '../../src/systems/replay/canonicalJson.js';
import { digestOfBytes } from '../../src/systems/replay/canonicalSha256.js';

const d = chr => `sha256:${chr.repeat(64)}`;
const clone = o => JSON.parse(JSON.stringify(o));
const request = () => ({
  format: DUAL_PROOF_FORMAT, version: DUAL_PROOF_VERSION,
  runId: 'run-20', buildId: 'build-20', rulesetId: d('a'), manifestDigest: d('b'), tapeDigest: d('c'),
  seed: 'terrain-seed-1', biomeMask: 15, lane: 'stock', score: 1000,
  endTick: 200, loadoutDigest: d('d'), assistance: 'human', intent: 'verified-public', challengeId: 'nonce-01',
});
const simulation = (r = request()) => ({
  kind: 'trusted-replay-execution', runId: r.runId, buildId: r.buildId, verifierBuildId:d('e'), verifiedCourse:{seed:r.seed,biomeMask:r.biomeMask,lane:r.lane,loadoutDigest:r.loadoutDigest}, score: r.score,
  endTick: r.endTick, tapeComplete: true, assistanceObserved: 'human',
  record: {outcome: 'match', verifiedUnder: r.rulesetId, verifierId: 'in-game', tapeDigest: r.tapeDigest, manifestDigest: r.manifestDigest},
});
const authorization = (r = request()) => ({
  kind: 'trusted-eligibility-receipt', status: 'authorized', runId: r.runId, buildId: r.buildId,
  rulesetId: r.rulesetId, seed: r.seed, biomeMask: r.biomeMask, lane: r.lane,
  loadoutDigest: r.loadoutDigest, manifestDigest:r.manifestDigest, tapeDigest:r.tapeDigest,
  score:r.score, endTick:r.endTick, challengeId: r.challengeId,
  challengeStatus: 'fresh', economyStatus: 'authorized', equipmentStatus: 'authorized', modeStatus: 'allowed', pinnedVerifierBuildId:d('e'),
});
const consent = (r = request()) => ({
  kind: 'trusted-consent-receipt', status: 'granted', runId: r.runId,
  manifestDigest:r.manifestDigest,tapeDigest:r.tapeDigest,score:r.score,endTick:r.endTick,
  seed:r.seed,biomeMask:r.biomeMask,lane:r.lane,loadoutDigest:r.loadoutDigest,intent:r.intent,
  scope: 'score-only', audienceGate: 'passed',
});
const good = (r = request()) => ({request: r, simulation: simulation(r), authorization: authorization(r), consent: consent(r)});
const run = (overrides = {}) => adjudicateDualProof({...good(), ...overrides});

const NO_RANK = v => {
  expect(v.verifiedRankEligible).toBe(false);
  expect(v.publicRewardEligible).toBe(false);
  expect(v.publication).not.toBe('verified-eligible');
};

describe('canonical dual-proof decision contract (#245)', () => {
  test('valid independently replayed and independently authorized stock run, plus consent/audience', () => {
    const result = run();
    expect(result).toMatchObject({
      format: DUAL_PROOF_FORMAT, version: DUAL_PROOF_VERSION,
      proof: {status:'valid',reason:'independent-replay-match'},
      eligibility: {status:'valid',reason:'trusted-eligibility-authorized'},
      competitiveness: {status:'valid',reason:'dual-proof-eligible'},
      privacy: {status:'valid',reason:'consented-for-public-score'},
      provenance: {simulationVerifierId:'in-game',pinnedVerifierBuildId:d('e'),verifiedUnder:d('a'),consentScope:'score-only'},
      publication:'verified-eligible',verifiedRankEligible:true,publicRewardEligible:true,provisionalLabel:null,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.proof)).toBe(true);
    expect(Object.isFrozen(result.provenance)).toBe(true);
    expect(canonicalBytes(result)).toBeInstanceOf(Uint8Array);
  });

  test.each(['stock','modded','official-daily','daily-draft'])('same adjudicator handles %s without collapsing lane', lane => {
    const r = {...request(),lane};
    expect(adjudicateDualProof(good(r)).publication).toBe('verified-eligible');
    const bad = good(r);bad.authorization.lane = lane === 'stock' ? 'modded' : 'stock';
    const verdict = adjudicateDualProof(bad);
    expect(verdict.eligibility).toEqual({status:'invalid',reason:'eligibility-identity-mismatch'});
    NO_RANK(verdict);
  });

  test('local request works without public consent but cannot publish or award public rankings', () => {
    const r={...request(),intent:'local'};
    const v=adjudicateDualProof({...good(r),consent:null});
    expect(v.proof.status).toBe('valid');expect(v.eligibility.status).toBe('valid');
    expect(v.privacy.reason).toBe('local-no-publication');expect(v.publication).toBe('none');NO_RANK(v);
    expect(adjudicateDualProof({request:r}).competitiveness.status).toBe('unverified');
  });

  test('explicit provisional public evidence is labelled UNVERIFIED, never ranked or rewarded', () => {
    const r={...request(),intent:'provisional-public'};
    const evidence={...good(r),simulation:null,authorization:null};
    const rejected=adjudicateDualProof(evidence);NO_RANK(rejected);expect(rejected.publication).toBe('none');
    const v=adjudicateDualProof({...evidence,allowProvisional:true});
    expect(v).toMatchObject({proof:{status:'unverified'},eligibility:{status:'unverified'},
      competitiveness:{status:'unverified'},publication:'provisional-unverified',provisionalLabel:'UNVERIFIED'});
    NO_RANK(v);
    const invalid={...good(r),allowProvisional:true};invalid.simulation.tapeComplete=false;
    const iv=adjudicateDualProof(invalid);expect(iv.competitiveness.status).toBe('invalid');
    expect(iv.publication).toBe('none');NO_RANK(iv);
    const blocked={...evidence,allowProvisional:true,consent:{...consent(r),audienceGate:'failed'}};
    expect(adjudicateDualProof(blocked).publication).toBe('none');
  });

  test('provisional request never silently escalates to verified publication despite both proofs', () => {
    const r={...request(),intent:'provisional-public'};
    const v=adjudicateDualProof({...good(r),allowProvisional:true});
    expect(v.competitiveness.status).toBe('valid');
    expect(v.publication).toBe('none');NO_RANK(v);
  });

  test('missing or incomplete authoritative proof never becomes valid even with a forged claimant wallet', () => {
    for (const x of [
      {simulation:null},
      {authorization:null},
      {simulation:{...simulation(),tapeComplete:false}},
      {simulation:{...simulation(),record:{...simulation().record,outcome:'diverged',firstDivergence:{tick:7}}}},
      {simulation:{...simulation(),score:1001}},
      {simulation:{...simulation(),endTick:199}},
      {simulation:{...simulation(),assistanceObserved:'tool-assisted'}},
      {simulation:{...simulation(),record:{...simulation().record,verified:true}}},
    ]) NO_RANK(run(x));
    expect(run({simulation:{...simulation(),tapeComplete:false}}).proof.reason).toBe('missing-complete-input-tape');
    expect(run({simulation:{...simulation(),score:1001}}).proof.reason).toBe('outcome-claim-mismatch');
    expect(run({simulation:{...simulation(),assistanceObserved:'tool-assisted'}}).proof.reason).toBe('assistance-misrepresented');
  });

  test('exact pinned executable verifier must match across two separately sourced reports', () => {
    const v=run({authorization:{...authorization(),pinnedVerifierBuildId:d('f')}});
    expect(v.eligibility).toEqual({status:'invalid',reason:'pinned-verifier-build-mismatch'});
    NO_RANK(v);
    const missing=run({simulation:{...simulation(),verifierBuildId:undefined}});
    expect(missing.proof.reason).toBe('malformed-input');NO_RANK(missing);
  });

  test('replayed manifest course/loadout are matched to entitlement, not claimed separately', () => {
    for(const field of ['seed','biomeMask','lane','loadoutDigest']){
      const altered={...simulation(),verifiedCourse:{...simulation().verifiedCourse,
        [field]:field==='biomeMask'?2:field==='lane'?'modded':field==='loadoutDigest'?d('f'):'other-seed'}};
      const verdict=run({simulation:altered});
      expect(verdict.proof.reason).toBe('replayed-course-or-loadout-mismatch');NO_RANK(verdict);
    }
    const forged=run({authorization:{...authorization(),manifestDigest:d('f')}});
    expect(forged.eligibility.reason).toBe('eligibility-identity-mismatch');NO_RANK(forged);
  });

  test('foreign inconclusive/refused reports cannot authorize provisional public publication', () => {
    const r={...request(),intent:'provisional-public'};
    for(const outcome of ['refused','consistent-with','inconclusive-legacy']){
      const s=simulation(r);
      s.record=outcome==='refused'
        ? {outcome,verifiedUnder:null,verifierId:null,tapeDigest:d('f'),manifestDigest:r.manifestDigest,reason:'unknown-ruleset'}
        : {...s.record,outcome,tapeDigest:d('f')};
      const v=adjudicateDualProof({...good(r),simulation:s,allowProvisional:true});
      expect(v.proof.status).toBe('invalid');expect(v.publication).toBe('none');NO_RANK(v);
    }
    const denied=simulation(r);denied.runId='other-run';denied.record.outcome='refused';
    denied.record.verifiedUnder=null;denied.record.verifierId=null;denied.record.reason='unknown-ruleset';
    const v=adjudicateDualProof({...good(r),simulation:denied,allowProvisional:true});
    expect(v.proof.status).toBe('invalid');NO_RANK(v);
  });

  test('pending entitlement with a mismatched verifier pin is invalid, not provisional', () => {
    const r={...request(),intent:'provisional-public'};
    const auth={...authorization(r),status:'pending',pinnedVerifierBuildId:d('f')};
    const v=adjudicateDualProof({...good(r),authorization:auth,allowProvisional:true});
    expect(v.eligibility.reason).toBe('pinned-verifier-build-mismatch');
    expect(v.competitiveness.status).toBe('invalid');expect(v.publication).toBe('none');NO_RANK(v);
  });

  test('bad manifest or ruleset rejection is invalid, while verifier unavailability remains inconclusive', () => {
    const r={...request(),intent:'provisional-public'};
    for(const reason of ['malformed-manifest','ruleset-field-mismatch','malformed-ruleset-id','null-ruleset-not-legacy','other-rejected']){
      const v=adjudicateDualProof({...good(r),allowProvisional:true,simulation:{...simulation(r),record:{
        outcome:'refused',verifiedUnder:null,verifierId:null,manifestDigest:r.manifestDigest,
        tapeDigest:r.tapeDigest,reason,claimedRulesetId:r.rulesetId}}});
      expect(v.proof.reason).toBe('verifier-rejected-evidence');
      expect(v.publication).toBe('none');NO_RANK(v);
    }
    for(const reason of ['unknown-ruleset','historical-verifier-required']){
      const v=adjudicateDualProof({...good(r),allowProvisional:true,simulation:{...simulation(r),record:{
        outcome:'refused',verifiedUnder:null,verifierId:null,manifestDigest:r.manifestDigest,
        tapeDigest:r.tapeDigest,reason,claimedRulesetId:r.rulesetId}}});
      expect(v.proof).toMatchObject({status:'inconclusive',reason:'verifier-unavailable'});
      expect(v.publication).toBe('provisional-unverified');NO_RANK(v);
    }
  });

  test('known assisted or mismatched course cannot claim provisional on a legacy replay', () => {
    const r={...request(),intent:'provisional-public'};
    const s={...simulation(r),assistanceObserved:'tool-assisted',record:{...simulation(r).record,outcome:'consistent-with'}};
    const v=adjudicateDualProof({...good(r),simulation:s,allowProvisional:true});
    expect(v.proof.reason).toBe('assistance-misrepresented');NO_RANK(v);
    const s2={...simulation(r),verifiedCourse:{...simulation(r).verifiedCourse,loadoutDigest:d('f')},
      record:{...simulation(r).record,outcome:'consistent-with'}};
    const v2=adjudicateDualProof({...good(r),simulation:s2,allowProvisional:true});
    expect(v2.proof.reason).toBe('replayed-course-or-loadout-mismatch');NO_RANK(v2);
  });

  test('known missing tape, changed score, and claimed ruleset mismatch block unavailable-verifier fallback', () => {
    const r={...request(),intent:'provisional-public'};
    const base={...simulation(r),record:{outcome:'refused',verifiedUnder:null,verifierId:null,
      manifestDigest:r.manifestDigest,tapeDigest:r.tapeDigest,reason:'unknown-ruleset',claimedRulesetId:r.rulesetId}};
    for(const bad of [
      {...base,tapeComplete:false},
      {...base,score:r.score+1},
      {...base,endTick:r.endTick+1},
      {...base,record:{...base.record,claimedRulesetId:d('f')}}
    ]){
      const v=adjudicateDualProof({...good(r),simulation:bad,allowProvisional:true});
      expect(v.proof.status).toBe('invalid');
      expect(v.publication).toBe('none');NO_RANK(v);
    }
  });

  test('an unavailable verifier refusal must explicitly name this exact ruleset', () => {
    const r={...request(),intent:'provisional-public'};
    const source=simulation(r);
    const rec={outcome:'refused',verifiedUnder:null,verifierId:null,
      manifestDigest:r.manifestDigest,tapeDigest:r.tapeDigest,reason:'unknown-ruleset'};
    for(const bad of [rec,{...rec,claimedRulesetId:d('f')},{...rec,claimedRulesetId:null}]){
      const v=adjudicateDualProof({...good(r),simulation:{...source,record:bad},allowProvisional:true});
      expect(v.proof.status).toBe('invalid');expect(v.publication).toBe('none');NO_RANK(v);
    }
    for (const reason of ['unknown-ruleset','historical-verifier-required']){
      const v=adjudicateDualProof({...good(r),simulation:{...source,record:{...rec,reason,claimedRulesetId:r.rulesetId}},allowProvisional:true});
      expect(v.proof.status).toBe('inconclusive');
      expect(v.publication).toBe('provisional-unverified');NO_RANK(v);
    }
  });

  test('self-declared nonhuman assistance never reaches a provisional human board even with no replay', () => {
    for (const assistance of ['ai','tool-assisted']){
      const r={...request(),intent:'provisional-public',assistance};
      const v=adjudicateDualProof({...good(r),simulation:null,allowProvisional:true});
      expect(v.proof).toMatchObject({status:'invalid',reason:'nonhuman-on-human-board'});
      expect(v.publication).toBe('none');NO_RANK(v);
    }
  });

  test('legitimate Unicode free-text seeds, spaces and emoji survive exact cross-source matching', () => {
    for(const seed of ['Snow Day','🌨️ Snow Hill','électricité','東京 山','double  gap']){
      const r={...request(),seed};
      const v=adjudicateDualProof(good(r));
      expect(v.publication).toBe('verified-eligible');
      const mismatch=good(r);mismatch.authorization.seed=seed+' ';
      NO_RANK(adjudicateDualProof(mismatch));
    }
    for(const seed of ['\u0000', 'newline\nseed', '\ud800', '\u2028', '']){
      NO_RANK(adjudicateDualProof(good({...request(),seed})));
    }
  });

  test('client edits cannot fabricate a signed entitlement or bypass a trusted challenge', () => {
    for(const [field,mut] of [
      ['runId','another-run'],['buildId','stale-build'],['rulesetId',d('f')],
      ['seed','another-seed'],['biomeMask',65535],['lane','modded'],
      ['loadoutDigest',d('e')],['manifestDigest',d('e')],['challengeId','old-nonce']
    ]){
      const r={...request(),[field]:mut};
      const v=adjudicateDualProof({...good(),request:r});
      NO_RANK(v);
      expect(v.eligibility.status).toBe('invalid');
    }
    for(const [field,mut] of [
      ['status','denied'],['challengeStatus','reused'],['challengeStatus','expired'],
      ['economyStatus','rejected'],['equipmentStatus','rejected'],['modeStatus','denied']
    ]){
      const v=run({authorization:{...authorization(),[field]:mut}});
      NO_RANK(v);expect(v.eligibility.status).toBe('invalid');
    }
    for(const [field,mut] of [
      ['status','pending'],['challengeStatus','missing'],['economyStatus','missing'],
      ['equipmentStatus','missing'],['modeStatus','missing']
    ]){
      const v=run({authorization:{...authorization(),[field]:mut}});
      NO_RANK(v);expect(v.eligibility.status).toBe('unverified');
    }
    const absent={...request(),challengeId:null};
    NO_RANK(adjudicateDualProof(good(absent)));
  });

  test('recomputed weak client digest cannot make an independently rejected outcome valid', () => {
    const r={...request(),score:222222,manifestDigest:d('8'),tapeDigest:d('9')};
    const v=adjudicateDualProof({...good(),request:r});
    NO_RANK(v);expect(v.proof.reason).toBe('simulation-identity-mismatch');
    const rehashed={...good(r),simulation:{...simulation(r),score:222221}};
    NO_RANK(adjudicateDualProof(rehashed));
  });

  test('legacy consistent-with, inconclusive-legacy and refusal cannot win a verified board', () => {
    for(const outcome of ['consistent-with','inconclusive-legacy']){
      const s=simulation();s.record.outcome=outcome;
      const v=run({simulation:s});NO_RANK(v);
      expect(v.proof.status).toBe('inconclusive');
    }
    const s=simulation();s.record={outcome:'refused',verifiedUnder:null,verifierId:null,
      tapeDigest:request().tapeDigest,manifestDigest:request().manifestDigest,reason:'unknown-ruleset',claimedRulesetId:request().rulesetId};
    const v=run({simulation:s});NO_RANK(v);expect(v.proof.status).toBe('inconclusive');
  });

  test('old trusted receipts cannot authorize altered score or tape for same run/manifest',()=>{
    const initial=request();
    const reusedAuthorization=authorization(initial),reusedConsent=consent(initial);
    for(const update of [
      {score:999999}, {tapeDigest:d('f')}, {endTick:201},
    ]){
      const second={...initial,...update};
      const v=adjudicateDualProof({...good(second),
        authorization:reusedAuthorization,consent:reusedConsent});
      expect(v.proof.status).toBe('valid'); // independently replayed claim B
      expect(v.eligibility).toEqual({status:'invalid',reason:'eligibility-identity-mismatch'});
      expect(v.privacy).toEqual({status:'invalid',reason:'consent-submission-mismatch'});
      NO_RANK(v);
    }
    const changedManifest={...initial,manifestDigest:d('f')};
    const v=adjudicateDualProof({...good(changedManifest),consent:reusedConsent});
    expect(v.privacy.reason).toBe('consent-submission-mismatch');NO_RANK(v);
    expect(adjudicateDualProof(good()).publication).toBe('verified-eligible');
  });

  test('provisional score consent cannot switch course, lane or loadout without new consent',()=>{
    const original={...request(),intent:'provisional-public'};
    const originalConsent=consent(original);
    for(const change of [{seed:'another-terrain'}, {biomeMask:0},
      {lane:'modded'}, {loadoutDigest:d('f')}]){
      const altered={...original,...change};
      const verdict=adjudicateDualProof({...good(altered),simulation:null,authorization:null,
        consent:originalConsent,allowProvisional:true});
      expect(verdict.privacy.reason).toBe('consent-submission-mismatch');
      NO_RANK(verdict);expect(verdict.publication).toBe('none');
    }
    expect(adjudicateDualProof({...good(original),simulation:null,authorization:null,
      allowProvisional:true}).publication).toBe('provisional-unverified');
  });

  test('one stable snapshot defeats time-varying programmatic Proxy receipts',()=>{
    const base=good();
    let reads=0;
    const shiftingRequest=new Proxy(base.request,{
      get(target,key,receiver){
        if(key==='lane')return (++reads%2)?'stock':'modded';
        return Reflect.get(target,key,receiver);
      }
    });
    const verdict=adjudicateDualProof({...base,request:shiftingRequest});
    // A snapshot may legitimately match the original receipt on its ONE
    // captured value. The invariant is that no later read changes lanes.
    expect(reads).toBe(1);
    expect(verdict.publication).toBe('verified-eligible');
    // A consent that changes across reads cannot defeat the snapshotted
    // course/lane equality gate either.
    let flips=0;
    const changingConsent=new Proxy(base.consent,{
      get(target,key,receiver){
        if(key==='lane')return (++flips%2)?'stock':'modded';
        return Reflect.get(target,key,receiver);
      }
    });
    const next=adjudicateDualProof({...base,consent:changingConsent});
    expect(['valid','invalid'].includes(next.privacy.status)).toBe(true);
    expect(flips).toBe(1); // read once, not at multiple policy stages
  });

  test('consent for provisional publication never authorizes verified publication', () => {
    const r=request();
    const wrong=consent({...r,intent:'provisional-public'});
    const v=adjudicateDualProof({...good(r),consent:wrong});
    expect(v.privacy).toEqual({status:'invalid',reason:'consent-intent-mismatch'});
    expect(v.publication).toBe('none');NO_RANK(v);
    const provisional={...r,intent:'provisional-public'};
    const wrong2=consent({...r,intent:'verified-public'});
    const v2=adjudicateDualProof({...good(provisional),simulation:null,consent:wrong2,allowProvisional:true});
    expect(v2.privacy.reason).toBe('consent-intent-mismatch');
    expect(v2.publication).toBe('none');NO_RANK(v2);
  });

  test('unavailable verifier may truthfully provide null executable digest, not a fabricated pin', () => {
    const r={...request(),intent:'provisional-public'};
    const source=simulation(r);
    for (const reason of ['unknown-ruleset','historical-verifier-required']){
      const record={outcome:'refused',verifiedUnder:null,verifierId:null,
        tapeDigest:r.tapeDigest,manifestDigest:r.manifestDigest,claimedRulesetId:r.rulesetId,reason};
      const v=adjudicateDualProof({...good(r),simulation:{...source,verifierBuildId:null,record},allowProvisional:true});
      expect(v.proof).toEqual({status:'inconclusive',reason:'verifier-unavailable'});
      expect(v.publication).toBe('provisional-unverified');NO_RANK(v);
    }
    const malformed=adjudicateDualProof({...good(r),simulation:{...source,verifierBuildId:null},allowProvisional:true});
    expect(malformed.proof.reason).toBe('malformed-input');NO_RANK(malformed);
    const wrong={outcome:'refused',verifiedUnder:null,verifierId:null,
      tapeDigest:r.tapeDigest,manifestDigest:r.manifestDigest,claimedRulesetId:r.rulesetId,reason:'malformed-manifest'};
    const invalid=adjudicateDualProof({...good(r),simulation:{...source,verifierBuildId:null,record:wrong},allowProvisional:true});
    expect(invalid.proof.status).toBe('invalid');NO_RANK(invalid);
  });

  test('privacy and child/audience gate are independent from a perfect simulation and wallet', () => {
    for(const c of [null,{...consent(),status:'denied'},{...consent(),status:'pending'},
      {...consent(),audienceGate:'failed'},{...consent(),audienceGate:'pending'},
      {...consent(),runId:'other-run'}]){
      const v=run({consent:c});
      expect(v.competitiveness.status).toBe('valid');
      expect(v.publication).toBe('none');NO_RANK(v);
    }
  });

  test('forged human claim is rejected when independent device/source evidence reports tool assistance', () => {
    const s={...simulation(),assistanceObserved:'tool-assisted'};
    const v=run({simulation:s});expect(v.proof.reason).toBe('assistance-misrepresented');NO_RANK(v);
    const r={...request(),assistance:'ai'};
    const v2=adjudicateDualProof(good(r));
    NO_RANK(v2);expect(v2.proof.reason).toBe('nonhuman-on-human-board');
    const s3={...simulation(r),assistanceObserved:'ai'};
    const v3=adjudicateDualProof({...good(r),simulation:s3});
    NO_RANK(v3);expect(v3.proof.reason).toBe('nonhuman-on-human-board');
  });

  test('unknown fields, client wallet/gear receipts, prototypes and unsupported versions fail closed', () => {
    const extras=[{wallet:999999},{verified:true},{serverReceipt:'I-signed-it'},
      {format:'other'},{version:2},{manifestDigest:'sha256:BAD'},{biomeMask:-1},
      {score:Infinity},{challengeId:'\u0000'}, {intent:'public'}];
    for(const extra of extras){const v=run({request:{...request(),...extra}});NO_RANK(v);expect(v.proof.reason).toBe('malformed-input');}
    const forgedReceipt={...authorization(),walletBalance:999999};
    expect(run({authorization:forgedReceipt}).eligibility.reason).toBe('malformed-input');
    const proto=Object.assign(Object.create({wallet:'secret'}),request());
    NO_RANK(run({request:proto}));
    const polluted=JSON.parse(JSON.stringify(request()).replace('"version":1','"version":1,"__proto__":{"verified":true}'));
    NO_RANK(run({request:polluted}));
    const invalidRecord={...simulation(),record:{...simulation().record,verified:true}};
    NO_RANK(run({simulation:invalidRecord}));
  });

  test('historical outcome bundle digest must equal pinned executable build, not just eligibility pin', () => {
    const historic={...simulation(),record:{...simulation().record,verifierId:d('f')}};
    const invalid=adjudicateDualProof({...good(),simulation:historic});
    expect(invalid.proof).toEqual({status:'invalid',reason:'verifier-bundle-digest-mismatch'});NO_RANK(invalid);
    const matched={...historic,verifierBuildId:d('f')};
    const authorized={...authorization(),pinnedVerifierBuildId:d('f')};
    const valid=adjudicateDualProof({...good(),simulation:matched,authorization:authorized});
    expect(valid.publication).toBe('verified-eligible');
    expect(valid.provenance.simulationVerifierId).toBe(d('f'));
  });

  test('hostile getters and throwing Proxies fail closed without exceptions or publication', () => {
    const requestGetter={...request()};
    Object.defineProperty(requestGetter,'score',{enumerable:true,get(){throw Error('hostile getter')}});
    const simGetter={...simulation()};
    Object.defineProperty(simGetter,'record',{enumerable:true,get(){throw Error('hostile record')}});
    const consentGetter={...consent()};
    Object.defineProperty(consentGetter,'status',{enumerable:true,get(){throw Error('hostile consent')}});
    const hostileProxy=new Proxy(request(),{getPrototypeOf(){throw Error('hostile proxy')}});
    const hostileOuter=new Proxy(good(),{get(){throw Error('hostile envelope')}});
    for(const input of [
      {...good(),request:requestGetter},
      {...good(),simulation:simGetter},
      {...good(),consent:consentGetter},
      {...good(),request:hostileProxy},
      hostileOuter
    ]){
      let verdict;
      expect(()=>{verdict=adjudicateDualProof(input);}).not.toThrow();
      expect(verdict.publication).toBe('none');NO_RANK(verdict);
      expect(['proof','eligibility','privacy'].some(k=>verdict[k].status==='invalid')).toBe(true);
    }
  });

  test('free peer and paid hosted routes use identical pure decision bytes, with zero payment leverage', () => {
    const source=good();
    const peer=adjudicateDualProof({...clone(source),route:'peer-free',fee:0});
    const paid=adjudicateDualProof({...clone(source),route:'hosted-paid',fee:1000});
    expect(canonicalBytes(peer)).toEqual(canonicalBytes(paid));
    expect(digestOfBytes(canonicalBytes(peer))).toBe(digestOfBytes(canonicalBytes(paid)));
    // Opaque client IDs never become a verifier identity, even when called 'trusted'.
    expect(Object.keys(peer).includes('verifierId')).toBe(false);
  });

  test('pinned canonical decision vectors prevent free/paid drift', () => {
    const vectors = [
      [good(), 'sha256:c5fa2ff5084bae52a6aa61decbba46498cb310562de63d8cd597f226ff21d2e7'],
      [{...good({...request(),intent:'local'}),consent:null}, 'sha256:af3f2bc0dbc1a1f9bea7dea13c6b3beccc781ab57b48d509286eaa367e0c9217'],
      [{...good(),simulation:null}, 'sha256:673179a4f7fa8dc8cd4af5a69d82ea99b69645751798a6204a6b23b55fa45e19'],
      [{...good(),consent:null}, 'sha256:e7af1207d22c030f5700c69f817ed317ee23029c2cbf70cc133cd1ab3e353e32'],
    ];
    for(const [fixture,expected] of vectors)
      expect(digestOfBytes(canonicalBytes(adjudicateDualProof(fixture)))).toBe(expected);
  });

  test('hostile outer shapes and attempted existing-verified-reference reversal fail closed', () => {
    for(const arg of [undefined,null,1,'hi',[],Object.create({request:request()})]){
      const v=adjudicateDualProof(arg);
      expect(v.proof.status).toBe('invalid'); NO_RANK(v);
    }
    // An attacker cannot insert 'verified reference' or a denial override into the claim.
    for(const field of ['verifiedReference','denyExistingReference','forceReject','forceApprove']){
      const v=run({request:{...request(),[field]:true}});
      expect(v.proof.status).toBe('invalid');NO_RANK(v);
    }
  });

  test('complete input, honest score, pinned verifier, and fresh nonce are each necessary', () => {
    const mutants = [
      {simulation:{...simulation(),record:{...simulation().record,manifestDigest:d('f')}}},
      {simulation:{...simulation(),record:{...simulation().record,tapeDigest:d('f')}}},
      {simulation:{...simulation(),record:{...simulation().record,verifiedUnder:d('f')}}},
      {simulation:{...simulation(),buildId:'old-game-build'}},
      {simulation:{...simulation(),runId:'another-run'}},
      {authorization:{...authorization(),pinnedVerifierBuildId:d('f')}},
      {authorization:{...authorization(),challengeStatus:'reused'}},
      {authorization:{...authorization(),challengeStatus:'expired'}},
      {authorization:{...authorization(),economyStatus:'rejected'}},
      {authorization:{...authorization(),equipmentStatus:'rejected'}},
      {authorization:{...authorization(),modeStatus:'denied'}},
    ];
    for(const mutant of mutants){
      const v=run(mutant); NO_RANK(v);
      expect(v.competitiveness.status).toBe('invalid');
    }
  });

  test('result is deterministic and stable across JSON property order; no time or network inputs', () => {
    const a=good();const reversed={};for(const k of Object.keys(a).reverse())reversed[k]=a[k];
    expect(canonicalBytes(adjudicateDualProof(a))).toEqual(canonicalBytes(adjudicateDualProof(reversed)));
    expect(JSON.stringify(adjudicateDualProof(a))).toBe(JSON.stringify(adjudicateDualProof(reversed)));
  });
});
