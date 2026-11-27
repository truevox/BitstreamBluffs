/**
 * #424: manual-pause capture adapter for a future player Suspend action.
 * This does NOT save, resume or grant ranked/Verified status.
 *
 * The paused source keeps its transient UI pause flag; the canonical
 * candidate intentionally contains the playable, unpaused flag so a
 * fresh replacement RunScene can accept subsequent Pause inputs.
 */
import {createCandidateStateCodec} from './candidateState.js';

function supported(run) {
 if(!run||run.crashed||run.unrankedPractice||run.tapePlayer||
    run._replayTape||run.takeover||run.coachSim||run.guestPractice||
    run.bsodGym||run.dailyOfficial||run.modded||run.upgradeRun?.enabled||
    run.magnetsDrop||run.kodiaksOn||run.appliedBoosts?.length||
    !Number.isSafeInteger(run.simClock?.tick)||run.simClock.tick<=0||
    !run.ghostRecorder) return false;
 return true;
}

/** Conservative preflight for a menu affordance only; actual capture runs
 * this check again and serializes strictly under the paused-scene guard.
 */
export function canCaptureManualPauseCandidate(run){
 return supported(run)&&run._manualPausePending===true&&
  run.scene?.isPaused?.('RunScene')===true;
}

/** Return complete internal candidate bytes or throw before a storage write.
 * Only the transient manual-pause guard is normalized during capture;
 * the original scene's guard is always restored, even if the codec fails.
 */
export function captureManualPauseCandidate(run,Phaser) {
 if(!supported(run))throw Error('suspend:unsupported-active-run');
 if(run._manualPausePending!==true||!run.scene?.isPaused?.('RunScene'))
  throw Error('suspend:manual-pause-required');
 const tick=run.simClock.tick,original=run._manualPausePending;
 try {
  run._manualPausePending=false;
  const bytes=createCandidateStateCodec(Phaser).capture(run);
  if(run.simClock.tick!==tick)throw Error('suspend:tick-changed');
  return bytes;
 } finally {
  run._manualPausePending=original;
 }
}
