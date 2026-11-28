/** #452: strict compatibility/fitness freshness decision boundary.
 * This is NOT the #24 model ABI validator, a brain loader, or a fitness source.
 * Keep learned weights as opaque local material; never trust stale statistics.
 */
export const BRAIN_REVISION_POLICY_ABI=1;
const integer=n=>Number.isSafeInteger(n)&&n>0;
const fail=reason=>Object.freeze({
 ok:false,reason,weights:'retain-untrusted',stats:'stale',
 idle:'baseline',reevaluation:'blocked-pending-validation',
});
/**
 * Receives ONLY metadata from a previously bounded #450 preflight + eventual
 * #24 model-ABI validator. Does not read, copy, execute, or mutate weights.
 * Explicit current model ABI and current SIM_REVISION MUST come from the
 * trusted installed game/trainer, not the imported brain document.
 * `fitness` is an opaque identifier for stats checked elsewhere, not a score.
 */
export function assessBrainRevision({storedSimRevision,storedModelAbi,
 currentSimRevision,currentModelAbi,hasTrustedEvaluation=false}={}){
 if(!integer(currentSimRevision)||!integer(currentModelAbi))
  return fail('unavailable-current-identity');
 if(!integer(storedSimRevision)||!integer(storedModelAbi))
  return fail('invalid-brain-identity');
 if(storedModelAbi!==currentModelAbi)
  return fail('model-abi-incompatible');
 if(storedSimRevision!==currentSimRevision)
  return Object.freeze({ok:true,reason:'sim-revision-changed',
   weights:'retain-untrusted',stats:'stale',idle:'baseline',
   reevaluation:'required-before-use'});
 if(hasTrustedEvaluation!==true)
  return Object.freeze({ok:true,reason:'evaluation-missing',
   weights:'retain-untrusted',stats:'stale',idle:'baseline',
   reevaluation:'required-before-use'});
 return Object.freeze({ok:true,reason:'current',weights:'retain-untrusted',
  stats:'current-by-metadata-only',idle:'requires-independent-eligibility',
  reevaluation:'not-required-by-revision'});
}
