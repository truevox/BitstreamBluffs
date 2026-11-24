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
		this.expectedFrame = null;
		this.active = true;
		this.port.onmessage = ({data})=>{
			if(data?.type==='stop') {
				this.flush();
				this.active=false;
				this.port.postMessage({type:'stopped',sampleRate});
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
		if(this.active&&input?.[0]){
			// Validate every render quantum BEFORE buffering: a missing or
			// duplicated 128-frame block inside a 1024-frame chunk must not
			// be hidden by chunk timestamps or compensating discontinuities.
			if(this.expectedFrame!==null&&currentFrame!==this.expectedFrame){
				this.port.postMessage({type:'discontinuity',actual:currentFrame,
					expected:this.expectedFrame,delta:currentFrame-this.expectedFrame});
				this.active=false;
			}
			if(this.active)this.expectedFrame=currentFrame+input[0].length;
		}
		if(this.active&&input?.[0]){
			for(let i=0;i<input[0].length;i++){
				if(this.frames===0)this.firstFrame=currentFrame+i;
				this.left[this.frames]=input[0][i];
				this.right[this.frames]=input[1]?.[i]??input[0][i];
				this.frames++;
				if(this.frames===this.left.length)this.flush();
			}
		}
		for(const output of outputs){
			for(const channel of output)channel.fill(0);
		}
		return true;
	}
}
registerProcessor('bsb-live-final-master-tap',BsbLiveFinalMasterTap);
