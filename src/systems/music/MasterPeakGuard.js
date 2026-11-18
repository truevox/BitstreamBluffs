/**
 * Shared final-output safety guard. A compressor is NOT a brickwall limiter:
 * its envelope reacts too slowly to guarantee a 0 dBFS peak ceiling when
 * several music/SFX/wind sources overlap. This waveshaper is linear through
 * almost all normal levels and uses a gentle upper soft knee for peaks.
 *
 * Exact parameters are provisional music-engineering values, not a claim
 * of human-approved tone, full-song peak coverage or intersample true-peak.
 */
export const PEAK_KNEE = 0.82;
export const PEAK_WIDTH = 0.07;
export const PEAK_MAX = PEAK_KNEE+PEAK_WIDTH; // 0.89, ~ -1.01 dBFS ceiling

export function masterPeakGuardSample(x){
	if(!Number.isFinite(x))return 0;
	const sign=Math.sign(x),amount=Math.abs(x);
	if(amount<=PEAK_KNEE)return x;
	const out=PEAK_KNEE+PEAK_WIDTH*
		(1-Math.exp(-(amount-PEAK_KNEE)/PEAK_WIDTH));
	return sign*Math.min(PEAK_MAX,out);
}

export function masterPeakGuardCurve(points=8192){
	const curve=new Float32Array(points);
	for(let i=0;i<points;i++){
		const x=i*2/(points-1)-1;
		curve[i]=masterPeakGuardSample(x);
	}
	return curve;
}

export function createMasterPeakGuard(ctx){
	const node=ctx.createWaveShaper();
	node.curve=masterPeakGuardCurve();
	node.oversample='4x';
	return node;
}
