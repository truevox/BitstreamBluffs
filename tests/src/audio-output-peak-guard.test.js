import {jest} from '@jest/globals';
import {
	PEAK_GUARD_KNEE,PEAK_GUARD_CEILING,PEAK_GUARD_POINTS,
	peakGuardTransfer,createPeakGuardCurve,createOutputPeakGuard
} from '../../src/systems/music/OutputPeakGuard.js';

describe('final original-music/SFX output soft peak backstop',()=>{
	test('draft v2 constants are the exact reviewed candidate, not v1',()=>{
		expect(PEAK_GUARD_KNEE).toBe(.74);
		expect(PEAK_GUARD_CEILING).toBe(.82);
		expect(peakGuardTransfer(.70)).toBe(.70);
		expect(peakGuardTransfer(.80)).toBeLessThan(.80);
		expect(peakGuardTransfer(1)).toBeLessThan(.82);
	});
	test('the entire normal music band is EXACTLY transparent, including sign',()=>{
		for(const value of [0,-0,1e-8,-1e-8,.125,-.125,.33,-.33,
			.5,-.5,.73,-.73,PEAK_GUARD_KNEE,-PEAK_GUARD_KNEE])
			expect(peakGuardTransfer(value)).toBe(value);
	});
	test('continuous symmetric C1 soft knee, bounded at digital full scale',()=>{
		const near=PEAK_GUARD_KNEE+0.00001;
		const jump=peakGuardTransfer(near)-PEAK_GUARD_KNEE;
		expect(jump).toBeGreaterThan(0);
		expect(jump).toBeLessThan(.00001001);
		for(const peak of [.9,.95,1,1.08,1.439,2,5,100]){
			const output=peakGuardTransfer(peak);
			expect(output).toBeGreaterThanOrEqual(PEAK_GUARD_KNEE);
			expect(output).toBeLessThanOrEqual(PEAK_GUARD_CEILING);
			expect(peakGuardTransfer(-peak)).toBe(-output);
		}
		expect(peakGuardTransfer(NaN)).toBe(0);
		expect(peakGuardTransfer(Infinity)).toBe(0);
	});
	test('large deterministic monotonic curve is exactly odd and bounded',()=>{
		const curve=createPeakGuardCurve();
		expect(curve).toBeInstanceOf(Float32Array);
		expect(curve.length).toBe(PEAK_GUARD_POINTS);
		expect(curve[(curve.length-1)/2]).toBe(0);
		for(let i=0;i<curve.length;i++){
			expect(Number.isFinite(curve[i])).toBe(true);
			expect(Math.abs(curve[i])).toBeLessThan(PEAK_GUARD_CEILING);
			if(i>0)expect(curve[i]).toBeGreaterThan(curve[i-1]);
			expect(curve[i]).toBeCloseTo(-curve[curve.length-1-i],6);
		}
	});
	test('one reusable Web Audio node, only native output stage, 2x antialias',()=>{
		const shaper={curve:null,oversample:'none'};
		const ctx={createWaveShaper:jest.fn(()=>shaper)};
		expect(createOutputPeakGuard(ctx)).toBe(shaper);
		expect(ctx.createWaveShaper).toHaveBeenCalledTimes(1);
		expect(shaper.curve.length).toBe(PEAK_GUARD_POINTS);
		expect(shaper.oversample).toBe('2x');
	});
});
