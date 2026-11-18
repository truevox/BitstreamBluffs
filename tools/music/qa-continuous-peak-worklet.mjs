/** QA-only AudioWorklet: lightweight gapless stereo sample capture.
 * Captures in a bounded buffer, never oversamples on the realtime audio thread.
 * Captured samples are analyzed later on the browser main thread.
 * The probe is a zero-output PARALLEL sink, never in the game output path.
 */
export const QA_PEAK_WORKLET_NAME='bb-qa-peak-probe-v2';
export const QA_PEAK_WORKLET_SOURCE=String.raw`
class BBQAPeakProbe extends AudioWorkletProcessor {
	constructor(options){
		super();
		this.limit=Number(options.processorOptions?.limit)||0.89;
		this.recordSamples=options.processorOptions?.recordSamples===true;
		this.capacity=Math.round(sampleRate*3.5);
		this.audio=this.recordSamples?
			[new Float32Array(this.capacity),new Float32Array(this.capacity)]:null;
		this._reset();
		this.port.onmessage=({data})=>{
			if(data?.kind==='reset'){
				this._reset();this.port.postMessage({kind:'reset',id:data.id});
			}else if(data?.kind==='snapshot'){
				const payload={kind:'snapshot',id:data.id,stats:this._snapshot()};
				if(this.recordSamples){
					payload.pcm=this.audio.map(ch=>ch.slice(0,this.recordedFrames));
					this.port.postMessage(payload,payload.pcm.map(ch=>ch.buffer));
				}else this.port.postMessage(payload);
			}
		};
	}
	_reset(){
		this.samples=[{peak:0,energy:0,count:0,above:0,nonfinite:0},
			{peak:0,energy:0,count:0,above:0,nonfinite:0}];
		this.quanta=0;this.frames=0;this.recordedFrames=0;
		this.startFrame=null;this.endFrame=null;this.discontinuities=0;
		this.missingFrames=0;this.overlappingFrames=0;this.gaps=[];
	}
	_snapshot(){
		return {quanta:this.quanta,frames:this.frames,startFrame:this.startFrame,
			endFrame:this.endFrame,discontinuities:this.discontinuities,
			missingFrames:this.missingFrames,overlappingFrames:this.overlappingFrames,
			gaps:this.gaps,sampleRate,recordedFrames:this.recordedFrames,
			channels:this.samples.map(s=>({...s,rms:Math.sqrt(s.energy/Math.max(1,s.count))}))};
	}
	process(inputs,outputs){
		for(const channel of outputs[0]||[])channel.fill(0);
		const input=inputs[0]||[];
		const n=input[0]?.length||0;
		if(n===0)return true;
		if(this.endFrame!==null&&this.endFrame!==currentFrame){
			const delta=currentFrame-this.endFrame;
			this.discontinuities++;
			if(delta>0)this.missingFrames+=delta;
			else this.overlappingFrames-=delta;
			if(this.gaps.length<16)this.gaps.push({expected:this.endFrame,
				observed:currentFrame,delta});
		}
		if(this.startFrame===null)this.startFrame=currentFrame;
		this.endFrame=currentFrame+n;this.quanta++;this.frames+=n;
		for(let i=0;i<n;i++){
			for(let channel=0;channel<2;channel++){
				const raw=input[channel]?.[i]??0;
				const s=this.samples[channel];
				const valid=Number.isFinite(raw),v=valid?raw:0;
				if(!valid)s.nonfinite++;
				const magnitude=Math.abs(v);
				s.peak=Math.max(s.peak,magnitude);
				s.energy+=v*v;s.count++;
				if(magnitude>this.limit+2e-4)s.above++;
				if(this.recordSamples&&this.recordedFrames<this.capacity)
					this.audio[channel][this.recordedFrames]=v;
			}
			if(this.recordSamples&&this.recordedFrames<this.capacity)this.recordedFrames++;
		}
		return true;
	}
}
registerProcessor('bb-qa-peak-probe-v2',BBQAPeakProbe);
`;
