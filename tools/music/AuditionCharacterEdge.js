/**
 * Audition-only EXTRA tonal character on the original instrumental sources.
 * Connect the post-stem-level music signal to `input`, NOT the FX output bus:
 * the FX output includes physical takeoff/landing/eruption one-shots, and
 * the user's approved event signals MUST bypass this tonal processing.
 *
 * The slider starts at zero; zero = exact original audition signal. The
 * layer is source-excited, never invents melody/notes, and has fixed damping
 * and a compressor to avoid huge peaks when several sources sum.
 */
export function attachAuditionCharacterEdge(ctx, fxBus, slider, kind) {
	if(!ctx || !fxBus || !slider || !['candy','heat'].includes(kind))
		throw Error('Bad audition character graph');
	const nodes=[];
	const make=fn=>{const n=fn();nodes.push(n);return n;};
	const input=make(()=>ctx.createGain());
	const highpass=make(()=>ctx.createBiquadFilter());
	highpass.type='highpass';highpass.frequency.value=kind==='candy'?340:230;
	const shaper=make(()=>ctx.createWaveShaper());
	shaper.oversample='2x';
	const curve=new Float32Array(4097);
	const drive=kind==='candy'?3.7:7.0;
	const normalize=Math.tanh(drive);
	for(let i=0;i<curve.length;i++){
		const x=2*i/(curve.length-1)-1;
		curve[i]=Math.tanh(x*drive)/normalize;
	}
	shaper.curve=curve;
	const wet=make(()=>ctx.createGain());wet.gain.value=0;
	const protector=make(()=>ctx.createDynamicsCompressor());
	protector.threshold.value=-20;protector.knee.value=8;
	protector.ratio.value=7;protector.attack.value=.003;protector.release.value=.12;
	input.connect(highpass);highpass.connect(shaper);
	const lfos=[];
	let apply;
	if(kind==='candy'){
		// Original-source musical sugar: bright nonlinear glaze, short
		// bubbly stereo shimmer and an elastic treble sweep (no MIDI notes).
		const treble=make(()=>ctx.createBiquadFilter());
		treble.type='highshelf';treble.frequency.value=1750;treble.gain.value=5.5;
		shaper.connect(treble);
		const branches=[];
		for(let i=0;i<2;i++){
			const filter=make(()=>ctx.createBiquadFilter());
			filter.type='bandpass';filter.frequency.value=i?3300:2100;filter.Q.value=i?1.2:.85;
			const delay=make(()=>ctx.createDelay(.2));delay.delayTime.value=i?.047:.024;
			const pan=make(()=>ctx.createStereoPanner());pan.pan.value=i?.68:-.68;
			const lfo=make(()=>ctx.createOscillator());lfo.type='sine';
			lfo.frequency.value=i?.86:.63;
			const mod=make(()=>ctx.createGain());mod.gain.value=i?.012:.008;
			lfo.connect(mod);mod.connect(delay.delayTime);
			lfo.start();lfos.push(lfo);
			treble.connect(filter);filter.connect(delay);delay.connect(pan);pan.connect(wet);
			branches.push({filter,lfo});
		}
		apply=amount=>{
			for(let i=0;i<branches.length;i++){
				branches[i].filter.frequency.setTargetAtTime((i?3300:2100)+(i?1600:1200)*amount,ctx.currentTime,.12);
				branches[i].lfo.frequency.setTargetAtTime((i?.86:.63)+amount*(i?2.7:1.6),ctx.currentTime,.12);
			}
			wet.gain.setTargetAtTime(.92*amount,ctx.currentTime,.055);
		};
	}else{
		// Volcanic heat-haze: overdriven original mids go through TWO
		// asymmetrically phased 'wah' resonant filters. Bass stays clean,
		// no event samples enter this processor, LFOs are not musical beats.
		const branches=[];
		for(let i=0;i<2;i++){
			const filter=make(()=>ctx.createBiquadFilter());
			filter.type='bandpass';filter.Q.value=.72;
			filter.frequency.value=i?1850:870;
			const pan=make(()=>ctx.createStereoPanner());pan.pan.value=i?.54:-.54;
			const lfo=make(()=>ctx.createOscillator());lfo.type='sine';
			lfo.frequency.value=i?.34:.46;
			const depth=make(()=>ctx.createGain());depth.gain.value=250;
			lfo.connect(depth);depth.connect(filter.frequency);
			lfo.start();lfos.push(lfo);
			shaper.connect(filter);filter.connect(pan);pan.connect(wet);
			branches.push({filter,lfo,depth});
		}
		apply=amount=>{
			for(let i=0;i<branches.length;i++){
				const {filter,lfo,depth}=branches[i];
				filter.Q.setTargetAtTime(.7+.95*amount,ctx.currentTime,.12);
				filter.frequency.setTargetAtTime((i?1750:950)+amount*(i?580:370),ctx.currentTime,.12);
				lfo.frequency.setTargetAtTime((i?.34:.46)+(i?.3:.26)*amount,ctx.currentTime,.12);
				depth.gain.setTargetAtTime((i?530:370)*(.45+.95*amount),ctx.currentTime,.12);
			}
			wet.gain.setTargetAtTime(.77*amount,ctx.currentTime,.055);
		};
	}
	wet.connect(protector);protector.connect(fxBus);
	const update=()=>{
		const value=Math.min(200,Math.max(0,Number(slider.value)||0));
		apply(value/200);
		const output=document.getElementById(kind==='candy'?'candy-character-value':'heat-wah-value');
		if(output)output.textContent=value+'%';
	};
	slider.addEventListener('input',update);update();
	return {input,dispose(){
		slider.removeEventListener('input',update);
		for(const osc of lfos)try{osc.stop()}catch{}
		for(const node of nodes)try{node.disconnect()}catch{}
	}};
}
