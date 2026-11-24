import {classifyLiveFailure,isRetryableInstrumentFailure} from '../../tools/music/classify-live-qa-failure.js';

test('valid clipping never becomes a retryable diagnostic failure',()=>{
  const clips={sampleClips:2,estimatedTrueClips4x:0,nonfiniteSamples:0,estimatedTruePeak4x:.99};
  const status=classifyLiveFailure(new Error('Estimated output exceeds ceiling'),clips);
  expect(status).toBe('VALID_CAPTURE_AUDIO_LIMIT_FAILURE');
  expect(isRetryableInstrumentFailure({status,error:'Missing live PCM',liveFinalMaster:{finalMasterMetrics:clips}})).toBe(false);
});
test('estimated intersample overs and nonfinite results are nonretryable',()=>{
  for(const metrics of [
    {sampleClips:0,estimatedTrueClips4x:1,nonfiniteSamples:0,estimatedTruePeak4x:1.001},
    {sampleClips:0,estimatedTrueClips4x:0,nonfiniteSamples:2,estimatedTruePeak4x:.9},
  ])expect(classifyLiveFailure('bad output',metrics)).toBe('VALID_CAPTURE_AUDIO_LIMIT_FAILURE');
});
test('explicit instrument continuity failure alone is retryable',()=>{
  expect(isRetryableInstrumentFailure({status:'INVALID_INSTRUMENT_CAPTURE',error:'Missing live PCM near crash'})).toBe(true);
});
test('ambiguous legacy failures and misclassified reports fail closed',()=>{
  for(const report of [
    {status:'FAIL_OR_INCOMPLETE',error:'Missing live PCM near crash'},
    {status:'INVALID_INSTRUMENT_CAPTURE',error:'real output clipping measured'},
    {status:'INVALID_INSTRUMENT_CAPTURE',error:'Missing live PCM',liveFinalMaster:{finalMasterMetrics:{sampleClips:2}}},
    {status:'VALID_CAPTURE_AUDIO_LIMIT_FAILURE',error:'Missing live PCM'},
  ])expect(isRetryableInstrumentFailure(report)).toBe(false);
});
