/**
 * Deterministic 4x band-limited intersample-peak *estimate* for raw 48 kHz
 * stereo PCM. Windowed-sinc interpolation uses 48 original samples around
 * each tested fractional position, DC-normalized per fractional phase.
 *
 * This is NOT an ITU-R BS.1770 certified true-peak meter: no calibrated
 * mastering compliance, 4x and finite-window approximation only.
 * Never pretend 0.965 *sample* ceiling guarantees <0 dBTP.
 */
export const TRUE_PEAK_OVERSAMPLE=4;
const RADIUS=24;
const PHASES=Object.freeze([.25,.5,.75]);
const sinc=x=>Math.abs(x)<1e-12?1:Math.sin(Math.PI*x)/(Math.PI*x);
const COEFFS=PHASES.map(phase=>{
	const c=[];
	let sum=0;
	for(let k=-RADIUS+1;k<=RADIUS;k++){
		const distance=k-phase;
		const window=Math.abs(distance)<RADIUS?
			(0.5+0.5*Math.cos(Math.PI*distance/RADIUS)):0;
		const v=sinc(distance)*window;
		c.push(v);sum+=v;
	}
	return Float64Array.from(c,x=>x/sum);
});

export function measureFourTimesTruePeak(buffer,{
	startFrame=0,endFrame=buffer?.length,
}={}){
	if(!buffer||typeof buffer.getChannelData!=='function'||
		!Number.isInteger(buffer.numberOfChannels)||buffer.numberOfChannels<1||
		!Number.isInteger(startFrame)||!Number.isInteger(endFrame)||
		startFrame<0||endFrame>buffer.length||endFrame<=startFrame)
		throw Error('Invalid true-peak PCM window');
	const numChannels=Math.min(2,buffer.numberOfChannels);
	const count=endFrame-startFrame;
	let sum=0,samplePeak=0,estimatedTruePeak=0,nonfiniteSamples=0;
	let sampleClips=0,estimatedTrueClips=0,peakFrame=0,peakPhase=0;
	for(let channel=0;channel<numChannels;channel++){
		const pcm=buffer.getChannelData(channel);
		for(let i=startFrame;i<endFrame;i++){
			const value=pcm[i];
			if(!Number.isFinite(value)){nonfiniteSamples++;continue;}
			const a=Math.abs(value);
			sum+=value*value;
			if(a>samplePeak)samplePeak=a;
			if(a>estimatedTruePeak){estimatedTruePeak=a;peakFrame=i;peakPhase=0;}
			if(a>1)sampleClips++;
			// The full 48-tap interpolator needs both adjacent sides. The
			// edge frames still contribute to sample-peak, but cannot
			// claim full-band intersample coverage.
			if(i<RADIUS||i+RADIUS>=pcm.length)continue;
			for(let p=0;p<COEFFS.length;p++){
				const taps=COEFFS[p];
				let v=0;
				for(let j=0;j<taps.length;j++)v+=pcm[i+j-RADIUS+1]*taps[j];
				const magnitude=Math.abs(v);
				if(magnitude>estimatedTruePeak){
					estimatedTruePeak=magnitude;peakFrame=i;peakPhase=(p+1)/4;
				}
				if(magnitude>1)estimatedTrueClips++;
			}
		}
	}
	const toDb=value=>20*Math.log10(Math.max(1e-12,value));
	return Object.freeze({
		sampleRate:buffer.sampleRate,channels:numChannels,windowStartFrame:startFrame,
		windowEndFrame:endFrame,samplesPerChannel:count,
		samplePeak,estimatedTruePeak4x:estimatedTruePeak,
		samplePeakDbFs:toDb(samplePeak),estimatedTruePeakDbTp4x:toDb(estimatedTruePeak),
		interSampleOvershootDb:toDb(estimatedTruePeak)-toDb(samplePeak),
		sampleClips,estimatedTrueClips4x:estimatedTrueClips,
		nonfiniteSamples,rms:Math.sqrt(sum/(numChannels*count)),
		peakFrame,peakPhase,edgeFramesNotInterpolated:Math.min(count,Math.max(0,RADIUS-startFrame)+
			Math.max(0,endFrame-(buffer.length-RADIUS))),
		method:'4x 48-tap per-phase DC-normalized Hann-windowed-sinc; finite-bandwidth ESTIMATE, not certified BS.1770',
	});
}
