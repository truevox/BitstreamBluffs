/** Audition-only cowbell layered ONLY on successfully verified original-bass-pitch clangs.
 * Generates inharmonic metallic overtones, not new notes or separate timing.
 * The production game graph and existing native SPLORP/clangs are unchanged.
 */
export function attachAuditionCowbell(ctx,processedBus,slider) {
	if(!ctx||!processedBus||!slider)throw Error('Invalid source-verified cowbell audition');
	const nodes=[],make=fn=>{const n=fn();nodes.push(n);return n;};
	const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.82),ctx.sampleRate),wave=buffer.getChannelData(0);
	const rate=440;
	for(let i=0;i<wave.length;i++){
		const t=i/ctx.sampleRate,attack=1-Math.exp(-t*490);
		const ring=.47*Math.sin(2*Math.PI*rate*t)*Math.exp(-t*5.2)
			+.37*Math.sin(2*Math.PI*rate*1.47*t)*Math.exp(-t*8.4)
			+.29*Math.sin(2*Math.PI*rate*2.56*t)*Math.exp(-t*11)
			+.12*Math.sin(2*Math.PI*rate*4.32*t)*Math.exp(-t*19);
		const struck=.12*Math.sin(2*Math.PI*rate*6.81*t)*Math.exp(-t*52);
		wave[i]=Math.tanh((ring+struck)*attack*1.35);
	}
	const master=make(()=>ctx.createGain());master.gain.value=0;
	const limiter=make(()=>ctx.createDynamicsCompressor());
	limiter.threshold.value=-14;limiter.ratio.value=7;
	limiter.attack.value=.002;limiter.release.value=.1;
	master.connect(limiter);limiter.connect(processedBus);
	const tails=[{delay:.011,pan:-.63,level:.22},{delay:.031,pan:.67,level:.16}];
	const buses=tails.map(t=>{
		const delay=make(()=>ctx.createDelay(.07));delay.delayTime.value=t.delay;
		const pan=make(()=>ctx.createStereoPanner());pan.pan.value=t.pan;
		const attenuator=make(()=>ctx.createGain());attenuator.gain.value=t.level;
		delay.connect(pan);pan.connect(attenuator);attenuator.connect(master);
		return delay;
	});
	let count=0;
	const playing=new Set();
	const update=()=>{
		const x=Math.max(0,Math.min(200,Number(slider.value)||0));
		master.gain.setTargetAtTime(x*.00265,ctx.currentTime,.025);
		const label=document.getElementById('cowbell-value');
		if(label)label.textContent=x+'%';
	};
	slider.addEventListener('input',update);update();
	function play(candidate){
		if(!candidate||!Number.isFinite(candidate.hz)||candidate.hz<60||candidate.hz>1500||
			!Number.isInteger(candidate.midi)||!Number.isFinite(candidate.confidence)||
			candidate.confidence<0||!Number.isFinite(candidate.strength)||candidate.strength<=0)return false;
		if(Number(slider.value)<=0)return false;
		if(playing.size>=3){const old=playing.values().next().value;
			try{old.stop()}catch{};old.disconnect();playing.delete(old);}
		const source=ctx.createBufferSource();source.buffer=buffer;source.playbackRate.value=candidate.hz/rate;
		const strength=ctx.createGain();strength.gain.value=.27+.31*Math.min(1,candidate.strength);
		source.connect(strength);strength.connect(master);
		for(const bus of buses)strength.connect(bus);
		playing.add(source);source.onended=()=>{playing.delete(source);
			try{source.disconnect()}catch{};try{strength.disconnect()}catch{};
		};
		source.start();count++;return true;
	}
	return {play,played:()=>count,dispose(){
		slider.removeEventListener('input',update);
		for(const src of playing){try{src.stop()}catch{};try{src.disconnect()}catch{}}
		playing.clear();for(const n of nodes)try{n.disconnect()}catch{}
	}};
}
