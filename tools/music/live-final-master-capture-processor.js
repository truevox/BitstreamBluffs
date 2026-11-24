/**
 * Test-only read-only final stereo PCM capture from the actual live game
 * output peak guard. NEVER alters the game's original output. Connected on
 * a separate zero-gain diagnostics branch. Do not put master PCM in Git.
 *
 * Worklet flushes 1024-frame stereo chunks for low overhead; reports exact
 * sample-clock frame numbers rather than estimating from JS wall time.
 */
class BsbLiveFinalMasterTap extends AudioWorkletProcessor {
	constructor(options) {
		super();
		this.frames = 0;
		this.left = new Float32Array(1024);
		this.right = new Float32Array(1024);
		this.firstFrame = 0;
		this.nextQuantumFrame = null;
		// Opt-in v3 startup qualification. The read-only diagnostic graph
		// may be parked for a few quanta immediately after AudioWorklet
		// activation. Exclude ONLY those quanta BEFORE measurement arms;
		// after arming EVERY quantum is still strictly checked.
		this.warmupFramesRequired=Math.max(0,
			Math.floor(options?.processorOptions?.stableWarmupFrames??0));
		this.armed=this.warmupFramesRequired===0;
		this.stableWarmupFrames=0;
		this.warmupGaps=0;
		this.armFrame=this.armed?0:null;
		this.active = true;
		this.port.onmessage = ({data})=>{
			if(data?.type==='stop'&&this.active)this.stopRequested=true;
		};
	}
	flush(){
		if(!this.frames)return;
		const l = this.left.slice(0,this.frames);
		const r = this.right.slice(0,this.frames);
		this.port.postMessage({
			type:'pcm',frame:this.firstFrame,frames:this.frames,
			sampleRate,left:l,right:r
		},[l.buffer,r.buffer]);
		this.frames=0;
	}
	process(inputs,outputs){
		// This node is deliberately side-chained through a gain of zero;
		// its output is always silent and cannot amplify the soundtrack.
		const input=inputs[0];
		if(this.active){
			const quantumFrames=input?.[0]?.length??outputs[0]?.[0]?.length??128;
			const good=!!input?.[0]&&Number.isSafeInteger(currentFrame)&&
				Number.isSafeInteger(quantumFrames)&&quantumFrames>0;
			const continuous=good&&(this.nextQuantumFrame===null||
				currentFrame===this.nextQuantumFrame);
			if(this.stopRequested&&!this.armed){
				this.active=false;
				this.port.postMessage({type:'stopped',sampleRate,
					quantumValidationVersion:4,armed:false,armFrame:null});
			}else if(!this.armed){
				// Never put warmup frames into evidence, even if there
				// were no visible gaps. A full contiguous duration must
				// be observed BEFORE measurement begins.
				if(!continuous){
					this.stableWarmupFrames=0;this.warmupGaps++;
				}else this.stableWarmupFrames+=quantumFrames;
				if(good)this.nextQuantumFrame=currentFrame+quantumFrames;
				else this.nextQuantumFrame=null;
				if(this.stableWarmupFrames>=this.warmupFramesRequired){
					this.armed=true;
					this.armFrame=this.nextQuantumFrame;
					this.port.postMessage({type:'armed',armFrame:this.armFrame,
						warmupGaps:this.warmupGaps,stableWarmupFrames:this.stableWarmupFrames});
				}
			}else if(!continuous){
				this.flush();
				this.port.postMessage({type:'discontinuity',
					expected:this.nextQuantumFrame,
					actual:currentFrame,
					delta:this.nextQuantumFrame===null?null:currentFrame-this.nextQuantumFrame,
					quantumFrames,
					reason:!input?.[0]?'missing-input':'render-quantum-discontinuity'});
				this.active=false;
			}else{
				this.nextQuantumFrame=currentFrame+quantumFrames;
				for(let i=0;i<quantumFrames;i++){
					if(this.frames===0)this.firstFrame=currentFrame+i;
					this.left[this.frames]=input[0][i];
					this.right[this.frames]=input[1]?.[i]??input[0][i];
					this.frames++;
					if(this.frames===this.left.length)this.flush();
				}
				// Confirm the next actual quantum AFTER the stop request and
				// retain its PCM. A missing terminal quantum fails above.
				if(this.stopRequested){
					this.flush();this.active=false;
					this.port.postMessage({type:'stopped',sampleRate,
						quantumValidationVersion:4,armed:this.armed,
						armFrame:this.armFrame,warmupGaps:this.warmupGaps,
						finalQuantumStart:currentFrame,finalQuantumFrames:quantumFrames,
						captureEndFrame:this.nextQuantumFrame});
				}
			}
		}
		for(const output of outputs){
			for(const channel of output)channel.fill(0);
		}
		return true;
	}
}
registerProcessor('bsb-live-final-master-tap',BsbLiveFinalMasterTap);
