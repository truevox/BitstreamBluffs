import {
	PASS_CAPTURE,INVALID_CAPTURE,AUDIO_LIMIT_FAILURE,
	classifyLiveCaptureAttempt,assertNoNonretryableAudioFailure
} from '../../tools/music/live-capture-review-policy.js';
function report(status=PASS_CAPTURE,patch={}){
	return {status,liveFinalMaster:{
		gaps:0,captureContinuityVersion:4,captureArmFrame:4096,
		frames:1024,captureEndFrame:5120,finalQuantumStart:4992,finalQuantumFrames:128,
		firstFrame:4096,startupWarmupGapsExcludedBeforeArm:1,
		discardedStartupChunks:0,
		captureQuantumIntegrity:{checkedEveryQuantum:true,
			chronologyErrors:0,nextQuantumVerified:true},
		finalMasterMetrics:{samplePeak:.94,estimatedTruePeak4x:.95,
			sampleClips:0,estimatedTrueClips4x:0,nonfiniteSamples:0,
			windowStartFrame:0,windowEndFrame:1024,samplesPerChannel:1024,...patch},
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
			error:'INSTRUMENT_CAPTURE: quantum gap',errors:[],unexpectedHttp:[]})).toBe(INVALID_CAPTURE);
	});
	test.each(['FAIL_OR_INCOMPLETE','INVALID_QA_OR_SOURCE','bogus',PASS_CAPTURE])(
		'legacy or unsupported report without verified quantum chronology fails closed: %s',status=>{
			expect(classifyLiveCaptureAttempt({status})).toBe('INVALID_QA_OR_SOURCE');
		}
	);
	test('a historic v2 clean report does NOT count as a v3 validated PASS',()=>{
		const x=report();x.liveFinalMaster.captureContinuityVersion=2;
		expect(classifyLiveCaptureAttempt(x)).toBe('INVALID_QA_OR_SOURCE');
	});
	test('a historic v2 report with actual measured clipping STILL permanently fails',()=>{
		const x=report('FAIL_OR_INCOMPLETE',{sampleClips:1});
		x.liveFinalMaster.captureContinuityVersion=2;
		expect(classifyLiveCaptureAttempt(x)).toBe(AUDIO_LIMIT_FAILURE);
		expect(()=>assertNoNonretryableAudioFailure(x)).toThrow(/DO NOT RETRY/);
	});
	test('arming proof must match the very first captured audio sample',()=>{
		const x=report();x.liveFinalMaster.firstFrame+=128;
		expect(classifyLiveCaptureAttempt(x)).toBe('INVALID_QA_OR_SOURCE');
	});
	test('discarding even a single post-arm PCM chunk invalidates evidence',()=>{
		const x=report();x.liveFinalMaster.discardedStartupChunks=1;
		expect(classifyLiveCaptureAttempt(x)).toBe('INVALID_QA_OR_SOURCE');
	});
	test('pass without per-quantum evidence is rejected',()=>{
		const x=report();delete x.liveFinalMaster.captureQuantumIntegrity;
		expect(classifyLiveCaptureAttempt(x)).toBe('INVALID_QA_OR_SOURCE');
	});
	test('instrument status with valid measured PCM cannot hide measured clipping',()=>{
		const x=report(INVALID_CAPTURE,{estimatedTruePeak4x:1.2});
		expect(classifyLiveCaptureAttempt(x)).toBe(AUDIO_LIMIT_FAILURE);
	});
});

test('never discard an instrument gap when the same run had browser or source errors',()=>{
  const base={status:INVALID_CAPTURE,error:'INSTRUMENT_CAPTURE: quantum gap',errors:[],unexpectedHttp:[]};
  for(const extra of [
    {errors:['TypeError: crashed in game']},
    {unexpectedHttp:[{status:500,url:'http://127.0.0.1/music/packs/a/drums.ogg'}]},
    {error:'Unexplained source replacement'},
  ])expect(classifyLiveCaptureAttempt({...base,...extra})).toBe('INVALID_QA_OR_SOURCE');
  expect(classifyLiveCaptureAttempt({...base,unexpectedHttp:[{status:404,url:'http://127.0.0.1/music/packs/a/adaptive/debutmont/missing.ogg'}]})).toBe(INVALID_CAPTURE);
});

test('v3, truncated edge meter, and inconsistent final quantum cannot pass v4',()=>{
	for(const patch of [
		{captureContinuityVersion:3},{captureEndFrame:4992},
		{finalQuantumStart:4864},{finalMasterMetrics:{...report().liveFinalMaster.finalMasterMetrics,windowStartFrame:48}},
	]){
		const x=report();Object.assign(x.liveFinalMaster,patch);
		expect(classifyLiveCaptureAttempt(x)).toBe('INVALID_QA_OR_SOURCE');
	}
});
