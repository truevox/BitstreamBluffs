import {assessBrainRevision as assess,BRAIN_REVISION_POLICY_ABI} from '../../src/systems/brain/brainRevisionPolicy.js';
const current={storedSimRevision:9,currentSimRevision:9,storedModelAbi:'draft-test-1',
 currentModelAbi:'draft-test-1',hasTrustedEvaluation:true};
test('same installed SIM_REVISION and model ABI only admits previously trusted metadata',()=>{
 expect(BRAIN_REVISION_POLICY_ABI).toBe(1);
 expect(assess(current)).toMatchObject({ok:true,reason:'current',
  stats:'current-by-metadata-only',idle:'requires-independent-eligibility'});
 expect(assess({...current,hasTrustedEvaluation:false})).toMatchObject({
  ok:true,reason:'evaluation-missing',stats:'stale',idle:'baseline',
  reevaluation:'required-before-use'});
});
test('SIM_REVISION bump preserves opaque weights but marks stats stale and forces Idle fallback',()=>{
 const original={...current};
 const old=assess({...current,currentSimRevision:10});
 expect(old).toEqual({ok:true,reason:'sim-revision-changed',
  weights:'retain-untrusted',stats:'stale',idle:'baseline',
  reevaluation:'required-before-use'});
 expect(current).toEqual(original);
 // No automatic promotion of historical fitness by copying its label forward.
 expect(assess({...current,currentSimRevision:11,hasTrustedEvaluation:false}).stats).toBe('stale');
});
test('SIM_REVISION downgrade also forbids fitness authority',()=>{
 expect(assess({...current,currentSimRevision:8})).toMatchObject({
  reason:'sim-revision-changed',stats:'stale',idle:'baseline'});
});
test('model ABI mismatch blocks evaluation and Idle even when revision matches',()=>{
 expect(assess({...current,currentModelAbi:'future-brain-2'})).toMatchObject({ok:false,
  reason:'model-abi-incompatible',stats:'stale',
  reevaluation:'blocked-pending-validation',idle:'baseline'});
});
test('no implicit trust from missing, corrupted, or unversioned metadata',()=>{
 for(const patch of [{storedSimRevision:undefined},{storedSimRevision:0},
  {storedSimRevision:'9'},{storedSimRevision:NaN},{storedModelAbi:null},
  {storedModelAbi:Infinity},{storedModelAbi:1},
  {currentModelAbi:1},{storedModelAbi:'../../unsafe'},{currentModelAbi:''},{currentSimRevision:undefined},
  {currentSimRevision:1.5}]){
  const v=assess({...current,...patch});
  expect(v.ok).toBe(false);expect(v.stats).toBe('stale');
  expect(v.idle).toBe('baseline');
 }
});
test('neither caller-modified booleans nor unknown fields can bypass required model ABI',()=>{
 expect(assess({...current,hasTrustedEvaluation:1}).stats).toBe('stale');
 expect(assess({...current,currentModelAbi:'future-brain-2',forceCurrent:true,hasTrustedEvaluation:true}).ok).toBe(false);
});
test('frozen stable decisions never mutate source metadata or learned bytes',()=>{
 const original=Object.freeze({...current});
 const a=assess(original),b=assess(original);
 expect(a).toEqual(b);expect(Object.isFrozen(a)).toBe(true);
 expect(original.currentSimRevision).toBe(9);
});
