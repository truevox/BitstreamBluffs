import {
	PEAK_KNEE,PEAK_MAX,masterPeakGuardSample,masterPeakGuardCurve,
	createMasterPeakGuard,finalSampleCeilingCurve,createFinalSampleCeiling,
} from '../../src/systems/music/MasterPeakGuard.js';

describe('shared music/SFX/wind final output peak guard',()=>{
	test('normal amplitudes are exactly linear and bipolar symmetric',()=>{
		for(const level of [0,.01,.1,.25,.5,.7,PEAK_KNEE]){
			expect(masterPeakGuardSample(level)).toBe(level);
			expect(masterPeakGuardSample(-level)).toBe(-level);
		}
	});
	test('upper knee is monotonic and bounded even for heavy overshoots',()=>{
		let previous=-1;
		for(let x=0;x<=5;x+=.005){
			const output=masterPeakGuardSample(x);
			expect(output).toBeGreaterThanOrEqual(previous);
			expect(output).toBeLessThan(PEAK_MAX+1e-9);
			expect(masterPeakGuardSample(-x)).toBeCloseTo(-output);
			previous=output;
		}
		expect(masterPeakGuardSample(1)).toBeGreaterThan(.87);
		expect(masterPeakGuardSample(1)).toBeLessThan(.89);
		expect(masterPeakGuardSample(1.06)).toBeLessThan(.89);
		expect(masterPeakGuardSample(NaN)).toBe(0);
	});
	test('WebAudio curve has a bounded ceiling and no out-of-range values',()=>{
		const curve=masterPeakGuardCurve();
		expect(curve).toBeInstanceOf(Float32Array);
		expect(curve.length).toBe(8192);
		expect(curve[0]).toBeLessThan(-.87);
		expect(curve.at(-1)).toBeGreaterThan(.87);
		for(const sample of curve){
			expect(Math.abs(sample)).toBeLessThan(PEAK_MAX);
		}
	});
	test('final sample-level stage is exactly bounded and unoversampled',()=>{
		const curve=finalSampleCeilingCurve(8192);
		expect(curve).toBeInstanceOf(Float32Array);
		expect(curve.length).toBe(8192);
		expect(curve[0]).toBeCloseTo(-PEAK_MAX);
		expect(curve.at(-1)).toBeCloseTo(PEAK_MAX);
		for(const x of curve)expect(Math.abs(x)).toBeLessThanOrEqual(PEAK_MAX+1e-7);
		const mock={curve:null,oversample:'4x'};
		const node=createFinalSampleCeiling({createWaveShaper:()=>mock});
		expect(node).toBe(mock);
		expect(node.oversample).toBe('none');
		expect(node.curve).toBeInstanceOf(Float32Array);
	});

	test('creates exactly one oversampled WaveShaper node for full output',()=>{
		const node={curve:null,oversample:'none'};
		const calls=[];
		const created=createMasterPeakGuard({
			createWaveShaper:()=>{calls.push(1);return node;},
		});
		expect(created).toBe(node);
		expect(calls).toHaveLength(1);
		expect(node.oversample).toBe('4x');
		expect(node.curve).toBeInstanceOf(Float32Array);
	});
});
