import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {resolve} from 'node:path';

function liveCapture(processorOptions){
	const messages=[],ports=[];
	let TestClass;
	class AudioWorkletProcessor {
		constructor(){
			this.port={
				postMessage:(msg)=>messages.push(msg),
				onmessage:null
			};
			ports.push(this.port);
		}
	}
	const scope={AudioWorkletProcessor,Float32Array,Number,Math,
		currentFrame:0,sampleRate:44100,
		registerProcessor:(name,ctor)=>{
			expect(name).toBe('bsb-live-final-master-tap');TestClass=ctor;
		}};
	const source=readFileSync(resolve('tools/music/live-final-master-capture-processor.js'),'utf8');
	runInNewContext(source,scope);
	const tap=new TestClass({processorOptions});
	const process=(frame,frames=128)=>{
		scope.currentFrame=frame;
		const input=[Float32Array.from({length:frames},()=>.125),
			Float32Array.from({length:frames},()=>-.125)];
		const out=[new Float32Array(frames),new Float32Array(frames)];
		expect(tap.process([input],[out])).toBe(true);
		expect(out[0].every(n=>n===0)).toBe(true);
		expect(out[1].every(n=>n===0)).toBe(true);
	};
	return {tap,messages,port:ports[0],process,
		getErrors:()=>messages.filter(m=>m.type==='discontinuity')};
}
describe('live final-output AudioWorklet quantum integrity',()=>{
	test('eight contiguous 128-frame quanta become one exact 1024-frame PCM packet',()=>{
		const a=liveCapture();
		for(let i=0;i<8;i++)a.process(4096+i*128);
		expect(a.getErrors()).toHaveLength(0);
		const pcm=a.messages.filter(m=>m.type==='pcm');
		expect(pcm).toHaveLength(1);
		expect(pcm[0].frame).toBe(4096);
		expect(pcm[0].frames).toBe(1024);
		expect(pcm[0].left[0]).toBeCloseTo(.125);
		expect(pcm[0].right[1023]).toBeCloseTo(-.125);
	});
	test('one missing 128-frame render quantum fails before packet completion',()=>{
		const a=liveCapture();
		a.process(0);a.process(128);a.process(384);
		expect(a.getErrors()).toHaveLength(1);
		expect(a.getErrors()[0]).toMatchObject({
			expected:256,actual:384,quantumFrames:128
		});
		expect(a.tap.active).toBe(false);
	});
	test('one repeated/overlapping 128-frame quantum fails before packet completion',()=>{
		const a=liveCapture();
		a.process(0);a.process(128);a.process(128);
		expect(a.getErrors()).toHaveLength(1);
		expect(a.getErrors()[0]).toMatchObject({expected:256,actual:128});
	});
	test('compensating missing and overlapping quantum can never mask corruption',()=>{
		const a=liveCapture();
		a.process(0);a.process(128);a.process(384);a.process(384);
		for(let i=4;i<8;i++)a.process(i*128);
		expect(a.getErrors()).toHaveLength(1);
		expect(a.tap.active).toBe(false);
	});
	test('missing input fails closed, no silent substitution',()=>{
		const a=liveCapture();
		a.process(0);
		a.tap.process([[]],[[new Float32Array(128),new Float32Array(128)]]);
		expect(a.getErrors()).toHaveLength(1);
		expect(a.getErrors()[0].reason).toBe('missing-input');
	});
	test('v3 warmup startup gap is excluded before arming; strict measurement then stays contiguous',()=>{
		const a=liveCapture({stableWarmupFrames:384});
		a.process(0);a.process(384); // 128->384 startup dropout, NOT captured
		a.process(512);a.process(640);a.process(768);
		const arm=a.messages.find(m=>m.type==='armed');
		expect(arm).toMatchObject({armFrame:896,warmupGaps:1});
		expect(a.messages.filter(m=>m.type==='pcm')).toHaveLength(0);
		a.process(896);a.process(1024);
		a.port.onmessage({data:{type:'stop'}});
		a.process(1152);
		const pcm=a.messages.find(m=>m.type==='pcm');
		expect(pcm).toMatchObject({frame:896,frames:384});
		expect(a.getErrors()).toHaveLength(0);
		expect(a.messages.at(-1)).toMatchObject({
			type:'stopped',quantumValidationVersion:4,
			armed:true,armFrame:896,warmupGaps:1,finalQuantumStart:1152,finalQuantumFrames:128,captureEndFrame:1280
		});
	});
	test('v3 post-arming gap aborts even if startup had a harmless excluded gap',()=>{
		const a=liveCapture({stableWarmupFrames:256});
		a.process(0);a.process(256); // startup gap resets warmup
		a.process(384);a.process(512); // arm after 512, at 640
		expect(a.messages.find(m=>m.type==='armed').armFrame).toBe(640);
		a.process(640);
		a.process(896); // expected 768, fatal after armed
		expect(a.getErrors()).toHaveLength(1);
		expect(a.getErrors()[0]).toMatchObject({expected:768,actual:896});
		expect(a.tap.active).toBe(false);
	});
	test('v3 stop before qualified arm never asserts the recording was valid',()=>{
		const a=liveCapture({stableWarmupFrames:1024});
		a.process(0);
		a.port.onmessage({data:{type:'stop'}});
		a.process(128);
		expect(a.messages.at(-1)).toMatchObject({
			type:'stopped',quantumValidationVersion:4,armed:false,armFrame:null
		});
	});
	test('stop flushes a partial chunk with an exact audio sample timestamp',()=>{
		const a=liveCapture();
		a.process(1000);a.process(1128);
		a.port.onmessage({data:{type:'stop'}});
		a.process(1256);
		expect(a.messages.find(m=>m.type==='pcm')).toMatchObject({
			frame:1000,frames:384
		});
		expect(a.messages.at(-1).type).toBe('stopped');
	});
});

test('missing terminal quantum never produces a successful stop receipt',()=>{
	const a=liveCapture({stableWarmupFrames:128});
	a.process(0);a.process(128);
	a.port.onmessage({data:{type:'stop'}});
	expect(a.messages.some(m=>m.type==='stopped')).toBe(false);
	a.process(384); // expected 256
	expect(a.getErrors()[0]).toMatchObject({expected:256,actual:384});
	expect(a.messages.some(m=>m.type==='stopped')).toBe(false);
});
