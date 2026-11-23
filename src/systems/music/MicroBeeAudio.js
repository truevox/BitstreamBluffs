/**
 * Tiny player, GIANT bees: independent physical stereo ambience linked to the
 * EXISTING background bee positions. Does not synthesize music, drive physics,
 * change the music transport, or simulate extra bees. Two bounded voices max.
 */
import { GAME_WIDTH } from '../../constants.js';
const clamp=(value,lo,hi,fallback=lo)=>Number.isFinite(value)
	? Math.min(hi,Math.max(lo,value)):fallback;

export class MicroBeeAudio {
	constructor(ctx,target){
		this.ctx=ctx;
		this.voices=[];
		this.intensity=1.5;
		// Native AudioParam objects are not guaranteed to be extensible.
		// Store last scheduled values separately; no per-frame event growth.
		this._lastTargets=new WeakMap();
		// Optional older WebAudio API must never break the existing music mixer.
		if(typeof ctx.createStereoPanner!=='function'){
			this.disposed=false;
			return;
		}
		for(let id=0;id<2;id++){
			const source=ctx.createOscillator();source.type='sawtooth';
			source.frequency.value=138+id*29;
			const filter=ctx.createBiquadFilter();filter.type='lowpass';
			filter.frequency.value=870;filter.Q.value=.6;
			const pan=ctx.createStereoPanner();pan.pan.value=0;
			const level=ctx.createGain();level.gain.value=0;
			source.connect(filter);filter.connect(pan);pan.connect(level);
			level.connect(target);source.start();
			this.voices.push({id,source,filter,pan,level});
		}
		this.disposed=false;
	}
	setIntensity(value){
		this.intensity=clamp(value,0,2,1.5);
	}
	/** `bees` must be the `beesAt` readout used by the SAME video frame. */
	setPositions(bees=[],{enabled=false,playerScreenX=GAME_WIDTH/2}={}){
		if(this.disposed)return false;
		const byId=new Map();
		if(enabled&&Array.isArray(bees))for(const b of bees){
			if(!b||!Number.isInteger(b.id)||b.id<0||b.id>=2||
				!Number.isFinite(b.x)||!Number.isFinite(b.alpha))continue;
			byId.set(b.id,b);
		}
		const now=this.ctx.currentTime;
		const schedule=(param,target,seconds,threshold)=>{
			const prior=this._lastTargets.get(param);
			if(Number.isFinite(prior) && Math.abs(prior-target)<threshold)return;
			this._lastTargets.set(param,target);
			param.cancelScheduledValues(now);
			param.setTargetAtTime(target,now,seconds);
		};
		for(const voice of this.voices){
			const b=byId.get(voice.id);
			const relative=b?clamp((b.x-playerScreenX)/(GAME_WIDTH*.49),-1,1,0):0;
			const proximity=b?1-.52*Math.abs(relative):0;
			// The visual's edge alpha is also the buzz's fade envelope.
			const volume=b?clamp(b.alpha,0,1)*proximity*this.intensity*.014:0;
			schedule(voice.pan.pan,relative,.09,.015);
			schedule(voice.level.gain,volume,.085,.00012);
			schedule(voice.filter.frequency,900+(1-Math.abs(relative))*360,.12,8);
		}
		return true;
	}
	dispose(){
		if(this.disposed)return;
		this.disposed=true;
		for(const voice of this.voices){
			try{voice.source.stop();}catch{}
			for(const node of [voice.source,voice.filter,voice.pan,voice.level]){
				try{node.disconnect();}catch{}
			}
		}
		this.voices.length=0;
	}
}
