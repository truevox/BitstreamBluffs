/** Browser-level negative-control for the gapless capture worklet.
 * Offline synthetic input deliberately exceeds the game's sample ceiling.
 * The probe must report both channels correctly and output absolute silence.
 * Requires the loopback trusted-origin preview, but no game source mutation.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {QA_PEAK_WORKLET_SOURCE} from './qa-continuous-peak-worklet.mjs';
const origin=process.env.GAME_URL||'http://127.0.0.1:8224/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
	const page=await browser.newPage();
	await page.goto(origin,{waitUntil:'domcontentloaded'});
	const evidence=await page.evaluate(async source=>{
		const rate=44100,duration=1,frames=rate*duration;
		const ctx=new OfflineAudioContext(2,frames,rate);
		const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
		try{await ctx.audioWorklet.addModule(url)}finally{URL.revokeObjectURL(url)}
		const probe=new AudioWorkletNode(ctx,'bb-qa-peak-probe-v2',{
			numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],
			channelCountMode:'explicit',channelCount:2,
			processorOptions:{limit:.89,recordSamples:true}});
		const buffer=ctx.createBuffer(2,frames,rate);
		for(let channel=0;channel<2;channel++){
			const data=buffer.getChannelData(channel);
			const amplitude=channel===0?.95:.3;
			for(let i=0;i<frames;i++)data[i]=amplitude*Math.sin(2*Math.PI*997*i/rate);
		}
		const sourceNode=ctx.createBufferSource();sourceNode.buffer=buffer;
		sourceNode.connect(probe);probe.connect(ctx.destination);sourceNode.start();
		const rendered=await ctx.startRendering();
		const result=await new Promise((resolve,reject)=>{
			const timeout=setTimeout(()=>reject(Error('Offline worklet did not reply')),3000);
			probe.port.onmessage=({data})=>{
				if(data?.kind==='snapshot'&&data.id===1){clearTimeout(timeout);resolve(data)}
			};
			probe.port.postMessage({kind:'snapshot',id:1});
		});
		probe.disconnect();probe.port.close();
		const outputPeaks=[0,0];
		for(let ch=0;ch<2;ch++)for(const v of rendered.getChannelData(ch))
			outputPeaks[ch]=Math.max(outputPeaks[ch],Math.abs(v));
		return {worklet:result.stats,recordedFirst:result.pcm[0][0],
			recordedSamples:result.pcm.map(x=>x.length),outputPeaks};
	},QA_PEAK_WORKLET_SOURCE);
	// WebAudio renders complete 128-frame quanta, including padded last quantum.
	assert.ok(evidence.worklet.frames>=44100&&evidence.worklet.frames<44100+128);
	assert.equal(evidence.worklet.discontinuities,0);
	assert.deepEqual(evidence.recordedSamples,[evidence.worklet.frames,evidence.worklet.frames]);
	assert.ok(evidence.worklet.channels[0].peak>.949);
	assert.ok(evidence.worklet.channels[0].above>0);
	assert.ok(evidence.worklet.channels[1].peak<.31);
	assert.equal(evidence.worklet.channels[1].above,0);
	assert.deepEqual(evidence.outputPeaks,[0,0],
		'QA probe must emit zero output, not audible or destructive audio');
	console.log('NEGATIVE_CONTROL_WORKLET_PASS',JSON.stringify({
		frames:evidence.worklet.frames,quanta:evidence.worklet.quanta,
		peaks:evidence.worklet.channels.map(x=>x.peak),
		above:evidence.worklet.channels.map(x=>x.above),
		outputPeaks:evidence.outputPeaks}));
}finally{await browser.close()}
