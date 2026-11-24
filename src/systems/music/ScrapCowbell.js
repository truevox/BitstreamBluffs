/**
 * Extra source-pitched junkyard cowbell heard and liked at 200%.
 * Unlike an accompaniment or an arbitrary synthetic note, this can sound
 * ONLY after the existing real-bass pitch probe validates, schedules and
 * successfully emits its original on-pitch Scrap Clang.
 *
 * The five original source recordings, takeoff/landing SPLORP, clock,
 * collision and simulation inputs are not modified. No DOM dependencies.
 */
const clamp=(v,a,b)=>Number.isFinite(v)?Math.max(a,Math.min(b,v)):a;

export function createVerifiedScrapCowbell(ctx,destination,{level=2}={}) {
	if(!ctx||!destination)throw Error('Scrap cowbell requires real Web Audio destination');
	const owned=[],alloc=fn=>{const n=fn();owned.push(n);return n;};
	const baseHz=440,length=Math.ceil(ctx.sampleRate*.82);
	const buffer=ctx.createBuffer(1,length,ctx.sampleRate),wave=buffer.getChannelData(0);
	for(let i=0;i<wave.length;i++){
		const t=i/ctx.sampleRate,attack=1-Math.exp(-t*490);
		const ring=.47*Math.sin(2*Math.PI*baseHz*t)*Math.exp(-t*5.2)
			+.37*Math.sin(2*Math.PI*baseHz*1.47*t)*Math.exp(-t*8.4)
			+.29*Math.sin(2*Math.PI*baseHz*2.56*t)*Math.exp(-t*11)
			+.12*Math.sin(2*Math.PI*baseHz*4.32*t)*Math.exp(-t*19);
		const struck=.12*Math.sin(2*Math.PI*baseHz*6.81*t)*Math.exp(-t*52);
		wave[i]=Math.tanh((ring+struck)*attack*1.35);
	}
	const gain=alloc(()=>ctx.createGain());
	gain.gain.value=clamp(level,0,2)*.265;
	const limiter=alloc(()=>ctx.createDynamicsCompressor());
	limiter.threshold.value=-14;limiter.ratio.value=7;
	limiter.attack.value=.002;limiter.release.value=.1;
	gain.connect(limiter);limiter.connect(destination);
	const tails=[{delay:.011,pan:-.63,level:.22},{delay:.031,pan:.67,level:.16}]
		.map(v=>{
			const delay=alloc(()=>ctx.createDelay(.07));delay.delayTime.value=v.delay;
			const pan=typeof ctx.createStereoPanner==='function'?
				alloc(()=>ctx.createStereoPanner()):alloc(()=>ctx.createGain());
			if(pan.pan)pan.pan.value=v.pan;
			const levelNode=alloc(()=>ctx.createGain());levelNode.gain.value=v.level;
			delay.connect(pan);pan.connect(levelNode);levelNode.connect(gain);
			return delay;
		});
	const playing=new Set();
	let played=0,disposed=false;
	function cleanup(entry) {
		try{entry.source.disconnect()}catch{}
		try{entry.strength.disconnect()}catch{}
		playing.delete(entry);
	}
	function play(candidate,at=ctx.currentTime) {
		if(disposed||!candidate||!Number.isFinite(candidate.hz)||
			candidate.hz<60||candidate.hz>1500||!Number.isInteger(candidate.midi)||
			!Number.isFinite(candidate.confidence)||candidate.confidence<0||
			!Number.isFinite(candidate.strength)||candidate.strength<=0)return false;
		if(playing.size>=3){
			const old=playing.values().next().value;
			try{old.source.stop()}catch{}
			cleanup(old);
		}
		const source=ctx.createBufferSource(),strength=ctx.createGain();
		source.buffer=buffer;
		source.playbackRate.value=candidate.hz/baseHz;
		strength.gain.value=.27+.31*clamp(candidate.strength,0,1);
		source.connect(strength);strength.connect(gain);
		for(const tail of tails)strength.connect(tail);
		const entry={source,strength};playing.add(entry);
		source.onended=()=>cleanup(entry);
		source.start(Math.max(ctx.currentTime,Number.isFinite(at)?at:ctx.currentTime));
		played++;
		return true;
	}
	function dispose(){
		if(disposed)return;
		disposed=true;
		for(const entry of playing){try{entry.source.stop()}catch{}cleanup(entry)}
		for(const node of owned)try{node.disconnect()}catch{}
	}
	return {play,dispose,played:()=>played,active:()=>playing.size};
}
