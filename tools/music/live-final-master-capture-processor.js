/**
 * Test-only read-only final stereo PCM capture from the actual live game
 * output peak guard. NEVER alters the game's original output. Connected on
 * a separate zero-gain diagnostics branch. Do not put master PCM in Git.
 *
 * Worklet flushes 1024-frame stereo chunks for low overhead; reports exact
 * sample-clock frame numbers rather than estimating from JS wall time.
 */
class BsbLiveFinalMasterTap extends AudioWorkletProcessor {
	constructor() {
		super();
		this.frames = 0;
		this.left = new Float32Array(1024);
		this.right = new Float32Array(1024);
		this.firstFrame = 0;
		this.nextQuantumFrame = null;
		this.active = true;
		this.port.onmessage = ({data})=>{
			if(data?.type==='stop') {
				this.flush();
				this.active=false;
				this.port.postMessage({type:'stopped',sampleRate,quantumValidationVersion:2});
			}
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
			if(!input?.[0]||!Number.isSafeInteger(currentFrame)||
				!Number.isSafeInteger(quantumFrames)||quantumFrames<1||
				(this.nextQuantumFrame!==null&&currentFrame!==this.nextQuantumFrame)){
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
			}
		}
		for(const output of outputs){
			for(const channel of output)channel.fill(0);
		}
		return true;
	}
}
registerProcessor('bsb-live-final-master-tap',BsbLiveFinalMasterTap);
