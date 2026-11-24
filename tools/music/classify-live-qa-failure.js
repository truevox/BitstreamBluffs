/** Fail-closed classification for final-output audio QA.
 * Real measured clipping must NEVER be dismissed as a retryable recording glitch.
 * Ambiguous failures remain non-retryable until explicitly diagnosed.
 */
export function classifyLiveFailure(error,metrics){
  if(metrics&&(metrics.sampleClips>0||metrics.estimatedTrueClips4x>0||
    metrics.nonfiniteSamples>0||metrics.estimatedTruePeak4x>=1))
    return 'VALID_CAPTURE_AUDIO_LIMIT_FAILURE';
  if(/INVALID_INSTRUMENT_CAPTURE|Missing live PCM|Unrecoverable gap|Worklet did not finish capture/.test(String(error))&&
    !metrics)
    return 'INVALID_INSTRUMENT_CAPTURE';
  return 'FAIL_OR_INCOMPLETE';
}

export function hasUnexpectedHttpFailures(report){
  return (report?.unexpectedHttp||[]).some(({status,url})=>
    !(status===404 && /\/music\/packs\/[^/]+\/adaptive\/debutmont\//.test(url||'')));
}

export function isRetryableInstrumentFailure(report){
  return report?.status==='INVALID_INSTRUMENT_CAPTURE' &&
    Array.isArray(report.errors) && report.errors.length===0 &&
    !hasUnexpectedHttpFailures(report) &&
    !report.liveFinalMaster?.finalMasterMetrics &&
    typeof report.error==='string' &&
    classifyLiveFailure(report.error,null)==='INVALID_INSTRUMENT_CAPTURE';
}
