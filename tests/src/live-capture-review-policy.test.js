import {
	PASS_CAPTURE,INVALID_CAPTURE,AUDIO_LIMIT_FAILURE,
	classifyLiveCaptureAttempt,assertNoNonretryableAudioFailure
} from '../../tools/music/live-capture-review-policy.js';
function report(status=PASS_CAPTURE,patch={}){
	return {status,liveFinalMaster:{
		gaps:0,captureQuantumIntegrity:{checkedEveryQuantum:true,
			chronologyErrors:0,nextQuantumVerified:true},
		finalMasterMetrics:{samplePeak:.94,estimatedTruePeak4x:.95,
			sampleClips:0,estimatedTrueClips4x:0,nonfiniteSamples:0,...patch},
	}};
}
describe('#310 strict captured-audio review policy',()=>{
	test('verified PCM with valid quantum chronology can pass',()=>{
		expect(classifyLiveCaptureAttempt(report())).toBe(PASS_CAPTURE);
	});
	test.each([
		{sampleClips:1},
		{estimatedTrueClips4x:1},
		{samplePeak:1.01},
		{estimatedTruePeak4x:1.001},
		{nonfiniteSamples:1},
	])('physical output failure $sampleClips $estimatedTrueClips4x is never retryable',patch=>{
		const failed=report('FAIL_OR_INCOMPLETE',patch);
		expect(classifyLiveCaptureAttempt(failed)).toBe(AUDIO_LIMIT_FAILURE);
		expect(()=>assertNoNonretryableAudioFailure(failed)).toThrow(/DO NOT RETRY/);
	});
	test('valid audio failure followed by a PASS remains a permanent failure',()=>{
		const attempts=[report('FAIL_OR_INCOMPLETE',{sampleClips:3}),report()];
		expect(()=>attempts.forEach(assertNoNonretryableAudioFailure)).toThrow(/DO NOT RETRY/);
	});
	test('explicit instrument failure without actual measured PCM is retryable',()=>{
		expect(classifyLiveCaptureAttempt({status:INVALID_CAPTURE,
			error:'INSTRUMENT_CAPTURE: quantum gap'})).toBe(INVALID_CAPTURE);
	});
	test.each(['FAIL_OR_INCOMPLETE','INVALID_QA_OR_SOURCE','bogus',PASS_CAPTURE])(
		'legacy or unsupported report without verified quantum chronology fails closed: %s',status=>{
			expect(classifyLiveCaptureAttempt({status})).toBe('INVALID_QA_OR_SOURCE');
		}
	);
	test('pass without per-quantum evidence is rejected',()=>{
		const x=report();delete x.liveFinalMaster.captureQuantumIntegrity;
		expect(classifyLiveCaptureAttempt(x)).toBe('INVALID_QA_OR_SOURCE');
	});
	test('instrument status with valid measured PCM cannot hide measured clipping',()=>{
		const x=report(INVALID_CAPTURE,{estimatedTruePeak4x:1.2});
		expect(classifyLiveCaptureAttempt(x)).toBe(AUDIO_LIMIT_FAILURE);
	});
});
