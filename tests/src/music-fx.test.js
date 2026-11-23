import { jest } from '@jest/globals';
import { buildMusicChain, StemFXMixer, MUSIC_PROCESSORS } from '../../src/systems/music/MusicFXGraph.js';

class Param {
	constructor() { this.value = 0; this.events = []; }
	cancelScheduledValues(at) { this.events.push(['cancel', at]); return this; }
	setValueAtTime(v) { this.value = v; return this; }
	linearRampToValueAtTime(v) { this.value = v; return this; }
	setTargetAtTime(v,at,smoothing) { this.value = v; this.events.push(['target',v,at,smoothing]); return this; }
}
class AudioNodeMock {
	constructor(type) {
		this.type = type; this.connections = []; this.closed = false;
		for (const key of ['gain', 'frequency', 'Q', 'pan', 'delayTime', 'threshold', 'ratio', 'knee', 'attack', 'release']) this[key] = new Param();
		this.fftSize = 512;
	}
	connect(node) { this.connections.push(node); return node; }
	disconnect() { this.connections = []; }
	start() { this.started = true; }
	stop() { this.stopped = true; }
	getByteFrequencyData(array) { array.fill(51); }
}
function fakeContext() {
	const names = ['Gain','BiquadFilter','StereoPanner','WaveShaper','Delay','Oscillator','Convolver','Analyser','DynamicsCompressor'];
	const ctx = { sampleRate: 48000, currentTime: 10 };
	for (const name of names) ctx['create' + name] = () => new AudioNodeMock(name);
	ctx.createBuffer = (channels,length) => {
		const data = Array.from({length:channels},()=>new Float32Array(length));
		return {length, getChannelData(ch) {return data[ch];}};
	};
	ctx._bufferSources = [];
	ctx.createBufferSource = () => {
		const src = new AudioNodeMock('BufferSource');
		ctx._bufferSources.push(src);
		return src;
	};
	ctx.createAnalyser = () => {
		const n = new AudioNodeMock('Analyser');
		n.frequencyBinCount = 512;
		return n;
	};
	return ctx;
}
describe('Modular cheap Web Audio processors', () => {
	test('registry includes every planned inexpensive processor family', () => {
		expect(MUSIC_PROCESSORS).toEqual(expect.arrayContaining([
			'gain','filter','pan','distortion','delay','tremolo','ring','convolution','analyser'
		]));
	});
	test('all processor types connect, parameterize and dispose', () => {
		const ctx = fakeContext(), output = ctx.createGain();
		const specs = MUSIC_PROCESSORS.map((type,i)=>({ id:'effect' + i, type,
			frequency:950, rate:6, wet:0.16, mode:'bandpass' }));
		const chain = buildMusicChain(ctx,specs,output);
		expect(chain.stages).toHaveLength(MUSIC_PROCESSORS.length);
		expect(chain.find('effect1').set('frequency',2500,ctx.currentTime)).toBe(true);
		expect(chain.find('effect1').refs.frequency.target.value).toBe(2500);
		const buffer = ctx.createBuffer(2,500);
		expect(chain.find('effect7').setImpulse(buffer)).toBeUndefined();
		expect(chain.find('effect7').refs.impulse).toBeDefined();
		chain.dispose();
	});
	test('Snowpack depth smoothly reshapes the original without altering transport', () => {
		const ctx = fakeContext();
		const chain = buildMusicChain(ctx, [{id:'snow',type:'snowpack',depth:0.95}], ctx.createGain());
		const snow = chain.find('snow');
		expect(snow).toBeDefined();
		expect(snow.refs.depth).toBeDefined();
		expect(snow.refs.impact).toBeDefined();
		expect(snow.set('depth',0.25,ctx.currentTime)).toBe(true);
		expect(snow.set('impact',0.8,ctx.currentTime)).toBe(true);
		expect(snow.set('impact',0,ctx.currentTime)).toBe(false);
		expect(snow.set('depth',-5,ctx.currentTime)).toBe(true);
		expect(snow.set('depth',Infinity,ctx.currentTime)).toBe(true);
		expect(snow.set('unapproved',0.5,ctx.currentTime)).toBe(false);
		chain.dispose();
	});

	test('Snowpack impact schedules bounded, two-stage burial and is cancelled by takeoff', () => {
		const ctx = fakeContext();
		const gains = [];
		const createGain = ctx.createGain;
		ctx.createGain = () => { const gain=createGain(); gains.push(gain); return gain; };
		const chain = buildMusicChain(ctx,[{id:'snow',type:'snowpack',depth:.72}],ctx.createGain());
		const snow = chain.find('snow');
		expect(snow.set('impact',1.5,ctx.currentTime)).toBe(true);
		const all = gains.flatMap(g=>g.gain.events);
		const attack = all.filter(e=>e[0]==='target' && e[2]===ctx.currentTime);
		const recovery = all.filter(e=>e[0]==='target' && e[2]===ctx.currentTime+.12);
		expect(attack).toHaveLength(2); // dry gain and wet gain, each bounded.
		expect(recovery).toHaveLength(2);
		for (const event of [...attack,...recovery]) expect(Number.isFinite(event[1])).toBe(true);
		const count = recovery.length;
		snow.set('depth',0,ctx.currentTime+.06); // Jump interrupts scheduled settling.
		expect(snow.set('impact',.8,ctx.currentTime+.07)).toBe(false);
		expect(recovery).toHaveLength(count);
		chain.dispose();
	});
	test('Scrapheap native graph reacts to contact and landing without replacing original audio', () => {
		const ctx = fakeContext();
		const source = ctx.createGain();
		const chain = buildMusicChain(ctx, [{id:'scrapheap',type:'scrapheap',contact:0.4}], ctx.createGain());
		const scrap = chain.find('scrapheap');
		expect(scrap.refs.contact).toBeDefined();
		expect(scrap.refs.impact).toBeDefined();
		expect(scrap.refs.splock).toBeDefined();
		source.connect(chain.input);
		expect(scrap.set('contact',0.7,ctx.currentTime)).toBe(true);
		expect(scrap.set('impact',0.9,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources).toHaveLength(1);
		expect(ctx._bufferSources[0].started).toBe(true);
		expect(ctx._bufferSources[0].buffer.length).toBeGreaterThan(10000);
		const waveform = ctx._bufferSources[0].buffer.getChannelData(0);
		expect(waveform.some(v=>Math.abs(v)>.01)).toBe(true);
		expect(waveform.every(Number.isFinite)).toBe(true);
		expect(waveform.every(v=>Math.abs(v)<=1)).toBe(true);
		const originalGain = ctx._bufferSources[0].connections[0].gain.value;
		expect(scrap.set('splock',1.6,ctx.currentTime)).toBe(true);
		expect(scrap.set('impact',.9,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources[1].connections[0].gain.value).toBeCloseTo(originalGain);
		expect(scrap.set('splock',0,ctx.currentTime)).toBe(true);
		expect(scrap.set('impact',.9,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources[2].connections[0].gain.value).toBe(0);
		expect(scrap.set('splock',1.2,ctx.currentTime)).toBe(true);
		expect(scrap.set('impact',-15,ctx.currentTime)).toBe(false);
		expect(ctx._bufferSources).toHaveLength(3);
		expect(scrap.set('impact',NaN,ctx.currentTime)).toBe(false);
		expect(scrap.set('impact',9e9,ctx.currentTime)).toBe(true);
		expect(scrap.set('contact',0,ctx.currentTime+.04)).toBe(true);
		expect(scrap.set('contact',Infinity,ctx.currentTime+.08)).toBe(true);
		for (let i = 0; i < 7; i++) scrap.set('impact',.7,ctx.currentTime+i*.02);
		expect(ctx._bufferSources).toHaveLength(11);
		chain.dispose();
		expect(ctx._bufferSources.at(-1).stopped).toBe(true);
	});
	test('Scrapheap takeoff produces a source-independent, bounded adhesive release only when signaled', () => {
		const ctx = fakeContext();
		const chain = buildMusicChain(ctx,[{id:'scrap',type:'scrapheap',contact:0}],ctx.createGain());
		const fx = chain.find('scrap');
		expect(fx.refs.takeoff).toBeDefined();
		expect(fx.set('takeoff',0,ctx.currentTime)).toBe(false);
		expect(fx.set('takeoff',NaN,ctx.currentTime)).toBe(false);
		expect(ctx._bufferSources).toHaveLength(0);
		expect(fx.set('takeoff',.65,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources).toHaveLength(1);
		const source=ctx._bufferSources[0];
		expect(source.started).toBe(true);
		expect(source.buffer.length).toBeGreaterThan(ctx.sampleRate*.18);
		expect(source.buffer.length).toBeLessThan(ctx.sampleRate*.36);
		const samples=source.buffer.getChannelData(0);
		expect(samples.some(x=>Math.abs(x)>.01)).toBe(true);
		expect(samples.every(Number.isFinite)).toBe(true);
		expect(samples.every(x=>Math.abs(x)<=1)).toBe(true);
		const originalTakeoffGain = source.connections[0].gain.value;
		expect(fx.refs.suction).toBeDefined();
		expect(fx.set('splock',0,ctx.currentTime)).toBe(true);
		expect(fx.set('takeoff',.65,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources.at(-1).connections[0].gain.value).toBeCloseTo(originalTakeoffGain);
		expect(fx.set('suction',2.4,ctx.currentTime)).toBe(true);
		expect(fx.set('takeoff',.65,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources.at(-1).connections[0].gain.value).toBeCloseTo(originalTakeoffGain*2.4/1.8);
		expect(fx.set('suction',0,ctx.currentTime)).toBe(true);
		expect(fx.set('takeoff',.65,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources.at(-1).connections[0].gain.value).toBe(0);
		expect(fx.set('suction',1.8,ctx.currentTime)).toBe(true);
		expect(fx.set('splock',1.6,ctx.currentTime)).toBe(true);
		for(let i=0;i<8;i++) fx.set('takeoff',1,ctx.currentTime+i*.02);
		expect(ctx._bufferSources.filter(x=>!x.stopped).length).toBeLessThanOrEqual(4);
		chain.dispose();
		expect(ctx._bufferSources.every(x=>x.stopped)).toBe(true);
	});
	test('rejects unknown processors and duplicate stable ids', () => {
		const ctx = fakeContext();
		expect(() => buildMusicChain(ctx,[{type:'unsafeScript',id:'bad'}],ctx.createGain())).toThrow();
		expect(() => buildMusicChain(ctx,[{type:'gain',id:'same'},{type:'pan',id:'same'}],ctx.createGain())).toThrow();
	});
	test('source-level gain, ducking, independent send, biome and chain replacement', () => {
		jest.useFakeTimers();
		try {
			const ctx = fakeContext(), bus=ctx.createGain();
			const mixer=new StemFXMixer(ctx,bus);
			mixer.addSource('drums');
			mixer.addSource('voice:bitstream-bluffs',{gain:0});
			expect(mixer.sources.size).toBe(2);
			expect(mixer.setGain('drums',0.5,{motion:true})).toBe(true);
			expect(mixer.sources.get('drums').motion.gain.value).toBe(0.5);
			expect(mixer.setRoomSend('drums',0.4)).toBe(true);
			expect(mixer.sources.get('drums').send.gain.value).toBe(0.4);
			expect(mixer.selectBiome('crystal-cavern')).toBe(true);
			expect(mixer.replaceEffects('drums',[{id:'speed-filter',type:'filter',mode:'lowpass'}])).toBe(true);
			expect(mixer.setEffectParam('drums','speed-filter','frequency',8000)).toBe(true);
			expect(mixer.energy().bass).toBeCloseTo(0.2,1);
			jest.advanceTimersByTime(5000);
			mixer.destroy();
		} finally { jest.useRealTimers(); }
	});
});
