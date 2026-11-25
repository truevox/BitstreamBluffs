/** #69: admission for an UNTRUSTED guest's visual-only practice opponent.
 * A valid guest trace NEVER confers score/ownership/entitlement. This policy
 * accepts only already decoded, locally previewed current-SIM normal tapes.
 */
import {tapeCompatible} from './GhostLibrary.js';
import {decodeTrace} from './GhostTape.js';
import {SIM_REVISION} from '../replay/ruleset.js';

export function guestPracticeEligible(tape){
  if(!tape||typeof tape!=='object'||tape.mode!=='normal'||
    typeof tape.seed!=='string'||!tape.seed||tape.seed.length>160||
    !Number.isSafeInteger(tape.biomeMask)||tape.biomeMask<0||tape.biomeMask>0xffffffff||
    tape.simRevision!==SIM_REVISION||!tapeCompatible(tape)||
    !Number.isSafeInteger(tape.endTick)||tape.endTick<1||tape.endTick>2000000||
    !Array.isArray(tape.inputs)||tape.inputs.length>500000)return false;
  try {
    const points=decodeTrace(tape);
    if(!points||points.length<3||points.length%3!==0||points.length>3000000)return false;
    for(let i=0;i<points.length;i++)if(!Number.isFinite(points[i])||Math.abs(points[i])>1e10)return false;
    return true;
  }catch{return false;}
}

/** The Title must not reinterpret '@mask' INSIDE a shared literal seed. */
export function guestPracticeLaunch(tape){
  if(!guestPracticeEligible(tape))return null;
  return {seed:tape.seed,biomeMask:tape.biomeMask,tape};
}
