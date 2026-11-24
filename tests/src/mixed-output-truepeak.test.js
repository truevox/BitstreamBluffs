import {measureFourTimesTruePeak, TRUE_PEAK_OVERSAMPLE}
	from '../../tools/music/estimate-true-peak-4x.js';

function audio(sampleRate,length,fn) {
	const data=Array.from({length:2},(_,ch)=>Float32Array.from(
		{length},(_,i)=>fn(i,ch)));
	return {sampleRate,numberOfChannels:2,length,
		getChannelData:ch=>data[ch]};
}
describe('4x band-limited intersample QA, strictly separate from game mastering',()=>{
	test('silence has exactly zero peak, RMS and overs',()=>{
		const p=measureFourTimesTruePeak(audio(48000,240,()=>0));
		expect(TRUE_PEAK_OVERSAMPLE).toBe(4);
		expect(p.samplePeak).toBe(0);
		expect(p.estimatedTruePeak4x).toBe(0);
		expect(p.sampleClips).toBe(0);
		expect(p.estimatedTrueClips4x).toBe(0);
		expect(p.nonfiniteSamples).toBe(0);
	});
	test('bandlimited reconstruction exposes peaks between sample ticks',()=>{
		const hz=8000,rate=48000,amp=.9,phase=Math.PI/4;
		const a=audio(rate,3000,i=>amp*Math.sin(2*Math.PI*hz*i/rate+phase));
		const p=measureFourTimesTruePeak(a,{startFrame:64,endFrame:2400});
		expect(p.samplePeak).toBeLessThan(.88);
		expect(p.estimatedTruePeak4x).toBeGreaterThan(p.samplePeak+.025);
		expect(p.estimatedTruePeak4x).toBeGreaterThan(.895);
		expect(p.estimatedTruePeak4x).toBeLessThan(.92);
		expect(p.interSampleOvershootDb).toBeGreaterThan(.1);
		expect(p.edgeFramesNotInterpolated).toBe(0);
	});
	test('intersample reconstruction can exceed unity when all native samples are below unity',()=>{
		const hz=8000,rate=48000,amp=1.03,phase=Math.PI/4;
		const p=measureFourTimesTruePeak(audio(rate,3000,i=>
			amp*Math.sin(2*Math.PI*hz*i/rate+phase)),
			{startFrame:64,endFrame:2300});
		expect(p.samplePeak).toBeLessThan(1);
		expect(p.sampleClips).toBe(0);
		expect(p.estimatedTruePeak4x).toBeGreaterThan(1);
		expect(p.estimatedTrueClips4x).toBeGreaterThan(0);
	});
	test('deliberately clipped samples and nonfinite samples never hide in averaged RMS',()=>{
		const p=measureFourTimesTruePeak(audio(48000,250,
			i=>i===100?1.1:i===101?NaN:0));
		expect(p.sampleClips).toBe(2);
		expect(p.nonfiniteSamples).toBe(2);
		expect(p.samplePeak).toBeGreaterThan(1);
	});
	test('rejects invalid source data or invalid windows',()=>{
		const a=audio(48000,200,()=>0);
		expect(()=>measureFourTimesTruePeak(a,{startFrame:200,endFrame:220})).toThrow();
		expect(()=>measureFourTimesTruePeak(a,{startFrame:3,endFrame:3})).toThrow();
		expect(()=>measureFourTimesTruePeak(null)).toThrow();
	});
});
