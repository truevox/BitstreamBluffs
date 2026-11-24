/** Audition-only source-fed stereo spaces, built on a biome's processed music.
 * This is deliberately NOT imported by the actual game. The input MUST be
 * wired to ORIGINAL STEM MUSIC only, never the chain output that contains
 * physical event sounds. The output goes to the existing effects bus, so
 * Compare dry still silences the added spatial field. At 0% it is silent;
 * original recordings, original-stem DSP, FX event levels and physics stay put.
 * Long delays have fixed feedback < 0.84 with bandwidth rolled off at every lap.
 */
const configs=Object.freeze({
	jelly:Object.freeze({
		taps:[{base:.24,extra:.14,pan:-.92,feedback:.38,feedbackExtra:.20,center:4400},
			{base:.46,extra:.29,pan:.92,feedback:.38,feedbackExtra:.25,center:3400}],
		highpass:260,lowpass:7300,wetMax:.38,
	}),
	space:Object.freeze({
		taps:[{base:.55,extra:.30,pan:-.89,feedback:.47,feedbackExtra:.30,center:5800},
			{base:1.06,extra:.62,pan:.89,feedback:.49,feedbackExtra:.33,center:4700}],
		highpass:200,lowpass:7600,wetMax:.36,
	}),
	stone:Object.freeze({
		taps:[{base:.12,extra:.10,pan:-.68,feedback:.25,feedbackExtra:.27,center:750},
			{base:.28,extra:.18,pan:.68,feedback:.27,feedbackExtra:.29,center:1590}],
		highpass:220,lowpass:5600,wetMax:.54,
	}),
});

export function attachAuditionSpatialReach(ctx,fxBus,slider,kind) {
	const config=configs[kind];
	if(!ctx||!fxBus||!slider||!config)throw Error('Invalid audition spatial configuration');
	const nodes=[];
	const create=fn=>{const n=fn();nodes.push(n);return n;};
	const input=create(()=>ctx.createGain());
	const hp=create(()=>ctx.createBiquadFilter());hp.type='highpass';hp.frequency.value=config.highpass;
	const lp=create(()=>ctx.createBiquadFilter());lp.type='lowpass';lp.frequency.value=config.lowpass;
	const output=create(()=>ctx.createGain());output.gain.value=0;
	const compressor=create(()=>ctx.createDynamicsCompressor());
	compressor.threshold.value=-11;compressor.knee.value=4;
	compressor.ratio.value=8;compressor.attack.value=.004;compressor.release.value=.18;
	input.connect(hp);hp.connect(lp);output.connect(compressor);compressor.connect(fxBus);
	const taps=config.taps.map(spec=>{
		const delay=create(()=>ctx.createDelay(2.2));delay.delayTime.value=spec.base;
		const tone=create(()=>ctx.createBiquadFilter());
		if(kind==='stone'){
			tone.type='bandpass';tone.frequency.value=spec.center;tone.Q.value=2.4;
		}else{
			tone.type='lowpass';tone.frequency.value=spec.center;tone.Q.value=.67;
		}
		const feedback=create(()=>ctx.createGain());feedback.gain.value=spec.feedback;
		const pan=typeof ctx.createStereoPanner==='function'?create(()=>ctx.createStereoPanner()):null;
		if(pan)pan.pan.value=spec.pan;
		lp.connect(delay);delay.connect(tone);tone.connect(feedback);feedback.connect(delay);
		if(pan){tone.connect(pan);pan.connect(output);}else tone.connect(output);
		return {delay,feedback,spec};
	});
	const update=()=>{
		// Stone's existing resonance slider drove a nearly inaudible grounded
		// filter. Preserve the user's 125% default EXACTLY; only >125% adds
		// experimental, distinctly audible sandstone chamber resonances.
		const value=Math.max(0,Math.min(200,Number(slider.value)||0));
		const progress=kind==='stone'?Math.max(0,(value-125)/75):value/200;
		const now=ctx.currentTime;
		output.gain.setTargetAtTime(config.wetMax*progress,now,.045);
		for(const {delay,feedback,spec} of taps){
			delay.delayTime.setTargetAtTime(spec.base+progress*spec.extra,now,.14);
			feedback.gain.setTargetAtTime(Math.min(.83,spec.feedback+progress*spec.feedbackExtra),now,.06);
		}
		if(kind!=='stone'){
			const label=document.getElementById(kind==='jelly'?'reach-value':'echo-tail-value');
			if(label)label.textContent=value+'%';
		}
	};
	slider.addEventListener('input',update);update();
	return {input,dispose(){
		slider.removeEventListener('input',update);
		for(const n of nodes)try{n.disconnect()}catch{}
	},test:{kind,taps:config.taps.length,maxWet:config.wetMax}};
}
