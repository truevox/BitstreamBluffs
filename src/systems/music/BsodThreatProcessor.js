/** Music-only BSOD threat processor.
 * Live guitar/piano/Other original stems pass through here. Far = dry,
 * approach = dark/unstable/pitch-preserving filtered distortion+tremolo.
 * There is no timer, pursuit model, source replay or music note guessing.
 */
export const BSOD_THREAT_STEMS = Object.freeze(['guitar','piano','other']);
const clamp01 = n => Number.isFinite(n) ? Math.max(0,Math.min(1,n)) : 0;

export function bsodThreatParameters(proximity01) {
	const proximity=clamp01(proximity01);
	// A small safe zone prevents distant hiss, then a slow onset and strong
	// final warning. Unapproved musical intensity: audit/listen before release.
	const u=clamp01((proximity-.08)/.92);
	const ramp=u*u*(3-2*u);
	return { proximity, blend: .84*ramp, cutoffHz: 16000-13800*ramp,
		tremoloHz: 3+10*ramp, tremoloDepth: .47*ramp,
		// Mid-stage parallel paths partially cancel in some real stems.
		// A gentle bell-shaped gain restores a stable approach, not an end boost.
		midMakeup: 1+.20*Math.sin(Math.PI*ramp) };
}

function distortionCurve() {
	const curve=new Float32Array(2048);
	// Calibrated makeup normalization: original unnormalized waveshaping
	// amplified the real 12-stem source set by 5.6-11.4 dB; full unity
	// small-signal normalization reduced some stems by 7 dB. This makeup
	// balances both without returning to the original loudness spike.
	const drive=4.7,denom=3.0;
	for(let i=0;i<curve.length;i++){
		const x=i*2/(curve.length-1)-1;
		curve[i]=Math.tanh(drive*x)/denom;
	}
	return curve;
}

const smooth=(param,value,now,seconds=.14)=>{
	param.cancelScheduledValues(now);
	param.setTargetAtTime(value,now,seconds);
};
/** A static chain with dynamic AudioParams: no DSP graph churn per frame.
 * Routed AFTER ordinary biome FX, so current song clock and replacements are
 * untouched. Only original accompaniment buses have this optional chain.
 */
export function createBsodThreatProcessor(ctx,output) {
	const input=ctx.createGain();
	const dry=ctx.createGain(),wet=ctx.createGain();
	const shaper=ctx.createWaveShaper();
	const mixGain=ctx.createGain();
	const filter=ctx.createBiquadFilter();
	const trem=ctx.createGain(),osc=ctx.createOscillator();
	const mod=ctx.createGain();
	dry.gain.value=1;
	wet.gain.value=0;
	mixGain.gain.value=1;
	trem.gain.value=1;
	filter.type='lowpass';
	filter.frequency.value=16000;
	filter.Q.value=.7;
	shaper.curve=distortionCurve();
	shaper.oversample='2x';
	osc.type='sine';
	osc.frequency.value=3;
	mod.gain.value=0;
	input.connect(dry);dry.connect(mixGain);
	input.connect(shaper);shaper.connect(filter);
	filter.connect(trem);trem.connect(wet);wet.connect(mixGain);
	mixGain.connect(output);
	osc.connect(mod);mod.connect(trem.gain);
	osc.start();
	let last=0,destroyed=false;
	return {
		input,dry,wet,filter,shaper,trem,osc,mod,mixGain,
		get danger(){return last;},
		setDanger(value) {
			if(destroyed)return false;
			const p=bsodThreatParameters(value);
			if(Math.abs(p.proximity-last)<.025 &&
				!(p.proximity===0 && last!==0))return false;
			last=p.proximity;
			const t=ctx.currentTime;
			smooth(dry.gain,1-p.blend,t);
			smooth(wet.gain,p.blend,t);
			smooth(mixGain.gain,p.midMakeup,t,.2);
			smooth(filter.frequency,p.cutoffHz,t,.2);
			smooth(osc.frequency,p.tremoloHz,t,.2);
			smooth(trem.gain,1-p.tremoloDepth/2,t);
			smooth(mod.gain,p.tremoloDepth/2,t);
			return true;
		},
		destroy(){
			if(destroyed)return;
			destroyed=true;
			try{osc.stop();}catch{}
			for(const node of [input,dry,wet,shaper,filter,trem,osc,mod,mixGain]){
				try{node.disconnect();}catch{}
			}
		},
	};
}
