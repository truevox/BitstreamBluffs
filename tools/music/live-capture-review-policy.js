/**
 * #310 reviewer P1 policy: an independently valid actual clipping reading
 * is NEVER retriable just because a later recording looks better.
 * Fail all unsupported / legacy statuses closed.
 */
export const PASS_CAPTURE='PASS_ACTUAL_PHYSICS_BSOD_FULL_OUTPUT_4X_ESTIMATE_NOT_MASTERED';
export const INVALID_CAPTURE='INVALID_INSTRUMENT_CAPTURE';
export const AUDIO_LIMIT_FAILURE='VALID_CAPTURE_AUDIO_LIMIT_FAILURE';

export function classifyLiveCaptureAttempt(report) {
	if(!report||typeof report!=='object')return 'INVALID_QA_OR_SOURCE';
	const live=report.liveFinalMaster;
	const meter=live?.finalMasterMetrics;
	const complete=!!meter && live?.gaps===0 &&
		live?.captureQuantumIntegrity?.checkedEveryQuantum===true &&
		live?.captureQuantumIntegrity?.chronologyErrors===0 &&
		live?.captureQuantumIntegrity?.nextQuantumVerified===true &&
		Number.isFinite(meter.samplePeak)&&Number.isFinite(meter.estimatedTruePeak4x)&&
		Number.isSafeInteger(meter.sampleClips)&&
		Number.isSafeInteger(meter.estimatedTrueClips4x)&&
		Number.isSafeInteger(meter.nonfiniteSamples);
	// Detect even a mislabeled failing report which contains a valid
	// above-unity reading; never retry over physical audio failure.
	if(complete&&(meter.sampleClips>0||meter.estimatedTrueClips4x>0||
		meter.nonfiniteSamples>0||meter.samplePeak>=1||meter.estimatedTruePeak4x>=1))
		return AUDIO_LIMIT_FAILURE;
	if(report.status===AUDIO_LIMIT_FAILURE) return AUDIO_LIMIT_FAILURE;
	if(report.status===PASS_CAPTURE)
		return complete?PASS_CAPTURE:'INVALID_QA_OR_SOURCE';
	if(report.status===INVALID_CAPTURE&&!meter){
        // A quantum capture fault is retryable ONLY if it was the sole
        // failure; real page/source loading failures may not disappear
        // behind a cleaner second recording.
        const unexpected=(report.unexpectedHttp||[]).filter(({status,url})=>
            !(status===404&&/\/music\/packs\/[^/]+\/adaptive\/debutmont\//.test(url||'')));
        if(!Array.isArray(report.errors)||report.errors.length||unexpected.length||
            !/INSTRUMENT_CAPTURE|quantum gap|Missing live PCM|Unrecoverable gap|Worklet did not finish capture/i.test(String(report.error)))
            return 'INVALID_QA_OR_SOURCE';
        return INVALID_CAPTURE;
    }
	// Any unclassified/incomplete report or legacy "FAIL_OR_INCOMPLETE"
	// requires a human diagnosis and cannot be silently retried as QA.
	return 'INVALID_QA_OR_SOURCE';
}

export function assertNoNonretryableAudioFailure(report) {
	const classified=classifyLiveCaptureAttempt(report);
	if(classified===AUDIO_LIMIT_FAILURE)
		throw Error('VALID_CAPTURE_AUDIO_LIMIT_FAILURE: physical clipping or estimated true-peak over; DO NOT RETRY AWAY');
	if(classified==='INVALID_QA_OR_SOURCE')
		throw Error('INVALID_QA_OR_SOURCE: unsupported or ambiguous capture report');
	return classified;
}
