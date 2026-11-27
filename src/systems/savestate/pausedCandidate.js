/**
 * #424: manual-pause capture adapter for a future player Suspend action.
 * This does NOT save, resume or grant ranked/Verified status.
 *
 * The paused source keeps its transient UI pause flag; the canonical
 * candidate intentionally contains the playable, unpaused flag so a
 * fresh replacement RunScene can accept subsequent Pause inputs.
 */
import {createCandidateStateCodec} from './candidateState.js';

/** A single fail-closed eligibility list powers both the actual capture guard
 * and the read-only Pause explanation. No UI hint ever attempts a save.
 * Reasons are conservative: the first disqualifying state wins.
 */
function unsupportedReason(run) {
 if(!run)return 'NO ACTIVE RUN';
 if(run.crashed)return 'CRASHED RUN';
 if(run.unrankedPractice)return 'UNRANKED PRACTICE';
 if(run.tapePlayer||run._replayTape)return 'REPLAY MODE';
 if(run.takeover)return 'REPLAY TAKEOVER';
 if(run.coachSim)return 'COACH SIMULATION';
 if(run.guestPractice)return 'GUEST PRACTICE';
 if(run.bsodGym)return 'BSOD GYM';
 if(run.dailyOfficial)return 'OFFICIAL DAILY';
 if(run.upgradeRun?.enabled)return 'UPGRADED RUN';
 // Some high-level profiles enable magnets AND Kodiaks. Show the more
 // specific combination, not an arbitrary generic magnet diagnosis.
 if(run.kodiaksOn)return 'KODIAKS ENABLED';
 if(run.magnetsDrop)return 'MAGNETS ENABLED';
 if(run.appliedBoosts?.length)return 'BOOSTED RUN';
 // `modded` is also true for some specific upgrade/hazard configurations.
 // Report the actionable specific restriction before this broad fallback.
 if(run.modded)return 'MODDED RUN';
 if(!Number.isSafeInteger(run.simClock?.tick)||run.simClock.tick<=0)
  return 'INVALID RUN TICK';
 if(!run.ghostRecorder)return 'NO GHOST RECORDER';
 return null;
}
const supported=run=>unsupportedReason(run)===null;

/** Human-readable, non-authoritative reason for a hidden Suspend action.
 * Null is allowed only for a genuinely eligible, manually paused source.
 */
export function manualSuspendUnavailableReason(run){
 const unsupported=unsupportedReason(run);
 if(unsupported!==null)return unsupported;
 if(run._manualPausePending!==true||run.scene?.isPaused?.('RunScene')!==true)
  return 'MANUAL PAUSE REQUIRED';
 return null;
}

/** Conservative preflight for the menu affordance. Actual capture repeats
 * all guards before touching the current native causal state or storage.
 */
export function canCaptureManualPauseCandidate(run){
 return manualSuspendUnavailableReason(run)===null;
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
