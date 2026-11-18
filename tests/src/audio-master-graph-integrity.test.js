import { jest } from '@jest/globals';
import { AudioSynth } from '../../src/systems/AudioSynth.js';

function mockContext(){
	let id=0;
	const nodes=[];
	const node=(type)=>{
		const o={type,id:++id,links:[],connect:jest.fn(function(dest){o.links.push(dest);return dest;}),
			disconnect:jest.fn(),start:jest.fn(),stop:jest.fn(),
			gain:{value:0},frequency:{value:0},Q:{value:0},ratio:{value:0},threshold:{value:0}};
		nodes.push(o);return o;
	};
	const destination=node('destination');
	const ctx={destination,sampleRate:48000,currentTime:0,state:'running',
		createGain:()=>node('gain'),createDynamicsCompressor:()=>node('compressor'),
		createWaveShaper:()=>node('shaper'),createBiquadFilter:()=>node('filter'),
		createBufferSource:()=>node('source'),createBuffer:(_ch,len)=>({getChannelData:()=>new Float32Array(len)}),
		close:jest.fn(()=>Promise.resolve())};
	return {ctx,nodes};
}

function paths(from,dest,seen=new Set()){
	if(from===dest)return [[from]];
	if(seen.has(from))return [];
	const next=new Set(seen);next.add(from);
	return (from.links||[]).flatMap(x=>paths(x,dest,next).map(p=>[from,...p]));
}

describe('master graph final sample-ceiling integrity',()=>{
	test('all audible buses reach destination ONLY through compressor, soft shaper and final ceiling',()=>{
		const {ctx,nodes}=mockContext();
		const a=Object.create(AudioSynth.prototype);
		a.ctx=ctx;a._stemMusic={attach:jest.fn()};
		a._buildGraph();
		const n=a.nodes;
		expect(a._stemMusic.attach).toHaveBeenCalledWith(ctx,n.musicFilter);
		expect(n.comp.links).toEqual([n.peakGuard]);
		expect(n.peakGuard.links).toEqual([n.finalSampleCeiling]);
		expect(n.finalSampleCeiling.links).toEqual([ctx.destination]);
		expect(n.peakGuard.oversample).toBe('4x');
		expect(n.finalSampleCeiling.oversample).toBe('none');
		expect(nodes.flatMap(x=>x.links.map(y=>[x,y])).filter(([,to])=>to===ctx.destination))
			.toEqual([[n.finalSampleCeiling,ctx.destination]]);
		for(const bus of ['musicBus','sfxBus','windGain','staticGain']){
			const routed=paths(n[bus],ctx.destination);
			expect(routed.length).toBeGreaterThan(0);
			for(const route of routed){
				const ids=route.map(x=>x.id);
				expect(ids.indexOf(n.comp.id)).toBeGreaterThan(-1);
				expect(ids.indexOf(n.peakGuard.id)).toBeGreaterThan(ids.indexOf(n.comp.id));
				expect(ids.indexOf(n.finalSampleCeiling.id)).toBeGreaterThan(ids.indexOf(n.peakGuard.id));
			}
		}
	});
	test('failed partial graph closes lost AudioContext and disposes director',async()=>{
		const old=window.AudioContext;
		const close=jest.fn(()=>Promise.resolve());
		window.AudioContext=class {constructor(){this.close=close;}createGain(){throw Error('injected graph failure');}};
		try{
			const a=Object.create(AudioSynth.prototype);
			a.ctx=null;a.unavailable=false;a._destroyed=false;
			a._stemMusic={destroy:jest.fn()};
			expect(a._ensureCtx()).toBe(false);
			expect(close).toHaveBeenCalledTimes(1);
			expect(a._stemMusic.destroy).toHaveBeenCalledTimes(1);
			expect(a.ctx).toBeNull();expect(a.nodes).toBeNull();
			expect(a.unavailable).toBe(true);
		}finally{if(old===undefined)delete window.AudioContext;else window.AudioContext=old;}
	});
});
