import { jest } from '@jest/globals';
import { buildMusicChain, StemFXMixer, MUSIC_PROCESSORS } from '../../src/systems/music/MusicFXGraph.js';
import {orchestraPreset} from '../../src/systems/music/DynamicOrchestraPresets.js';

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
		for (const key of ['gain', 'frequency', 'Q', 'pan', 'delayTime', 'playbackRate', 'threshold', 'ratio', 'knee', 'attack', 'release']) this[key] = new Param();
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
	test('Original bass pitch probe monitors original audio without guessing or altering dry path',()=>{
		const ctx=fakeContext();
		const old=ctx.createAnalyser;
		ctx.createAnalyser=()=>{
			const analyser=old();analyser.fftSize=4096;analyser.frequencyBinCount=2048;
			analyser.getFloatFrequencyData=data=>{
				data.fill(-95);const bin=Math.round(440*4096/ctx.sampleRate);
				data[bin-1]=-30;data[bin]=-18;data[bin+1]=-29;
			};return analyser;
		};
		const mixer=new StemFXMixer(ctx,ctx.createGain());
		mixer.addSource('bass',{effects:orchestraPreset('garbage-dump-glacier','bass')});
		const notes=mixer.readEffect('bass','scrapPitchProbe','notes');
		expect(notes.map(n=>n.midi)).toContain(69);
		expect(mixer.readEffect('bass','scrapPitchProbe','missing')).toBe(null);
		mixer.destroy();
	});
	test('Metal clang requires verified current source pitch, keeps inharmonic partials and caps voices',()=>{
		const ctx=fakeContext();
		const fx=buildMusicChain(ctx,[{id:'scrapheap',type:'scrapheap',contact:.65}],ctx.createGain());
		const scrap=fx.find('scrapheap');
		expect(scrap.refs.pitchedClang).toBeDefined();
		expect(scrap.refs.clangLevel).toBeDefined();
		const valid={midi:69,hz:440,confidence:.3,strength:.72};
		expect(scrap.set('pitchedClang',{...valid,hz:446},ctx.currentTime)).toBe(false);
		expect(scrap.set('pitchedClang',{...valid,midi:200},ctx.currentTime)).toBe(false);
		expect(scrap.set('pitchedClang',null,ctx.currentTime)).toBe(false);
		expect(ctx._bufferSources).toHaveLength(0);
		expect(scrap.set('pitchedClang',valid,ctx.currentTime)).toBe(true);
		const first=ctx._bufferSources[0];
		expect(first.playbackRate.value).toBeCloseTo(1);
		const samples=first.buffer.getChannelData(0);
		expect(samples.every(Number.isFinite)).toBe(true);
		expect(samples.some(x=>Math.abs(x)>.1)).toBe(true);
		expect(scrap.set('clangLevel',2,ctx.currentTime)).toBe(true);
		for(let i=0;i<8;i++)scrap.set('pitchedClang',valid,ctx.currentTime+i*.03);
		expect(ctx._bufferSources.filter(x=>!x.stopped)).toHaveLength(3);
		expect(scrap.set('contact',0,ctx.currentTime)).toBe(true);
		expect(scrap.set('pitchedClang',valid,ctx.currentTime)).toBe(false);
		fx.dispose();
		expect(ctx._bufferSources.every(x=>x.stopped)).toBe(true);
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
		expect(source.buffer.length).toBeLessThan(ctx.sampleRate*.46);
		const samples=source.buffer.getChannelData(0);
		expect(samples.some(x=>Math.abs(x)>.01)).toBe(true);
		expect(samples.every(Number.isFinite)).toBe(true);
		expect(samples.every(x=>Math.abs(x)<=1)).toBe(true);
		const originalTakeoffGain = source.connections[0].gain.value;
		expect(fx.refs.suction).toBeDefined();
		expect(fx.refs.suctionStyle).toBeDefined();
		expect(fx.set('suctionStyle',1,ctx.currentTime)).toBe(true);
		expect(fx.set('takeoff',.65,ctx.currentTime)).toBe(true);
		const alternate = ctx._bufferSources.at(-1);
		expect(alternate.buffer).not.toBe(source.buffer);
		expect(alternate.buffer.getChannelData(0).every(Number.isFinite)).toBe(true);
		expect(fx.set('suctionStyle',NaN,ctx.currentTime)).toBe(false);
		expect(fx.set('suctionStyle',0,ctx.currentTime)).toBe(true);
		expect(fx.set('splock',0,ctx.currentTime)).toBe(true);
		expect(fx.set('takeoff',.65,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources.at(-1).connections[0].gain.value).toBeCloseTo(originalTakeoffGain);
		expect(fx.set('suction',2.4,ctx.currentTime)).toBe(true);
		expect(fx.set('takeoff',.65,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources.at(-1).connections[0].gain.value).toBeCloseTo(originalTakeoffGain*2.4/.8);
		expect(fx.set('suction',0,ctx.currentTime)).toBe(true);
		expect(fx.set('takeoff',.65,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources.at(-1).connections[0].gain.value).toBe(0);
		expect(fx.set('suction',.8,ctx.currentTime)).toBe(true);
		expect(fx.set('splock',1.6,ctx.currentTime)).toBe(true);
		for(let i=0;i<8;i++) fx.set('takeoff',1,ctx.currentTime+i*.02);
		expect(ctx._bufferSources.filter(x=>!x.stopped).length).toBeLessThanOrEqual(4);
		chain.dispose();
		expect(ctx._bufferSources.every(x=>x.stopped)).toBe(true);
	});
	test('Microbox native DSP opens on flight and bounded plastic-box shake has real samples',()=>{
		const ctx=fakeContext();
		const fx=buildMusicChain(ctx,[{id:'micro',type:'microbox',openness:0}],ctx.createGain());
		const box=fx.find('micro');
		expect(box.refs.boxiness).toBeDefined();
		expect(box.refs.openness).toBeDefined();
		expect(box.refs.impact).toBeDefined();
		expect(box.set('openness',1,ctx.currentTime)).toBe(true);
		expect(box.set('openness',NaN,ctx.currentTime)).toBe(false);
		expect(box.set('boxiness',1.5,ctx.currentTime)).toBe(true);
		expect(box.set('impact',0,ctx.currentTime)).toBe(false);
		expect(box.set('impact',.7,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources).toHaveLength(1);
		const waveform=ctx._bufferSources[0].buffer.getChannelData(0);
		expect(waveform.every(Number.isFinite)).toBe(true);
		expect(waveform.some(x=>Math.abs(x)>.01)).toBe(true);
		for(let i=0;i<8;i++)box.set('impact',1,ctx.currentTime+i*.013);
		expect(ctx._bufferSources.filter(x=>!x.stopped).length).toBeLessThanOrEqual(3);
		fx.dispose();
		expect(ctx._bufferSources.every(x=>x.stopped)).toBe(true);
	});
	test('Crystal Lattice uses original-source modal bank, never pitches notes without current chroma',()=>{
		const ctx=fakeContext(),osc=[];
		const original=ctx.createOscillator;
		ctx.createOscillator=()=>{const node=original();osc.push(node);return node;};
		const source=ctx.createGain();
		const fx=buildMusicChain(ctx,[{id:'crystal',type:'crystallattice',detectChroma:true}],ctx.createGain());
		const crystal=fx.find('crystal');source.connect(fx.input);
		expect(crystal.refs.openness).toBeDefined();
		expect(crystal.refs.strength).toBeDefined();
		expect(crystal.refs.chroma).toBeDefined();
		expect(crystal.set('openness',1,ctx.currentTime)).toBe(true);
		expect(crystal.set('openness',NaN,ctx.currentTime)).toBe(false);
		expect(crystal.set('strength',.8,ctx.currentTime)).toBe(true);
		expect(crystal.set('impact',0,ctx.currentTime)).toBe(false);
		// The fake analyser lacks real measured source notes: never fake one.
		expect(crystal.set('impact',.9,ctx.currentTime)).toBe(true);
		expect(osc).toHaveLength(0);
		fx.dispose();
	});
	test('Crystal Lattice emits only confident current analyser pitch and disposes all cascade voices',()=>{
		const ctx=fakeContext(),osc=[];
		const original=ctx.createOscillator,originalAnalyser=ctx.createAnalyser;
		ctx.createOscillator=()=>{const node=original();osc.push(node);return node;};
		ctx.createAnalyser=()=>{
			const node=originalAnalyser();node.frequencyBinCount=2048;
			node.getFloatFrequencyData=db=>{
				db.fill(-98);
				const target=Math.round(440*4096/ctx.sampleRate);
				db[target]=-22;db[target-1]=-33;db[target+1]=-31;
			};
			return node;
		};
		const fx=buildMusicChain(ctx,[{id:'crystal',type:'crystallattice',detectChroma:true}],ctx.createGain());
		const c=fx.find('crystal');
		expect(c.refs.chroma.read().map(n=>n.midi)).toEqual([69]);
		expect(c.set('impact',.95,ctx.currentTime)).toBe(true);
		expect(osc).toHaveLength(1);
		expect(osc[0].frequency.value).toBeCloseTo(440);
		expect(osc[0].started).toBe(true);
		expect(osc[0].stopped).toBe(true);
		for(let n=0;n<8;n++)c.set('impact',1,ctx.currentTime+n*.05);
		expect(osc.filter(x=>x.connections.length)).toHaveLength(4);
		fx.dispose();
		expect(osc.every(x=>x.stopped&&!x.connections.length)).toBe(true);
	});
	test('Hydrostatic native DSP has bounded pressure automation, real landing pulse and cleanup',()=>{

		const ctx=fakeContext();
		const fx=buildMusicChain(ctx,[{id:'h',type:'hydrostatic',pressure:0}],ctx.createGain());
		const hydro=fx.find('h');
		expect(hydro.refs.pressure).toBeDefined();
		expect(hydro.refs.impact).toBeDefined();
		expect(hydro.refs.contrast).toBeDefined();
		expect(hydro.refs.waveStrength).toBeDefined();
		// Provisional owner-liked audition setting: 60% wave while pressure remains 190%.
		expect(hydro.set('contrast',2.2,ctx.currentTime)).toBe(true);
		expect(hydro.set('contrast',NaN,ctx.currentTime)).toBe(false);
		expect(hydro.set('contrast',1.45,ctx.currentTime)).toBe(true);
		expect(hydro.set('waveStrength',NaN,ctx.currentTime)).toBe(false);
		expect(hydro.set('pressure',.75,ctx.currentTime)).toBe(true);
		expect(hydro.set('pressure',NaN,ctx.currentTime)).toBe(false);
		expect(hydro.set('impact',0,ctx.currentTime)).toBe(false);
		expect(hydro.set('impact',NaN,ctx.currentTime)).toBe(false);
		expect(hydro.set('impact',.8,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources).toHaveLength(1);
		expect(ctx._bufferSources[0].connections[0].gain.value).toBeGreaterThan(.35);
		expect(ctx._bufferSources[0].connections[0].gain.value).toBeLessThan(.5);
		const waveform=ctx._bufferSources[0].buffer.getChannelData(0);
		expect(waveform.every(Number.isFinite)).toBe(true);
		expect(waveform.every(v=>Math.abs(v)<=1)).toBe(true);
		expect(waveform.some(v=>Math.abs(v)>.01)).toBe(true);
		expect(waveform.length).toBeGreaterThan(ctx.sampleRate*.5);
		expect(hydro.set('waveStrength',0,ctx.currentTime)).toBe(true);
		expect(hydro.set('impact',.8,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources.at(-1).connections[0].gain.value).toBe(0);
		expect(hydro.set('waveStrength',2.4,ctx.currentTime)).toBe(true);
		expect(hydro.set('impact',.8,ctx.currentTime)).toBe(true);
		expect(ctx._bufferSources.at(-1).connections[0].gain.value).toBeGreaterThan(1.5);
		expect(ctx._bufferSources.at(-1).connections[0].gain.value).toBeLessThanOrEqual(1.9);
		for(let i=0;i<8;i++)hydro.set('impact',1,ctx.currentTime+i*.015);
		expect(ctx._bufferSources.filter(source=>!source.stopped).length).toBeLessThanOrEqual(3);
		fx.dispose();
		expect(ctx._bufferSources.every(source=>source.stopped)).toBe(true);
	});
	test('rejects unknown processors and duplicate stable ids', () => {
		const ctx = fakeContext();
		expect(() => buildMusicChain(ctx,[{type:'unsafeScript',id:'bad'}],ctx.createGain())).toThrow();
		expect(() => buildMusicChain(ctx,[{type:'gain',id:'same'},{type:'pan',id:'same'}],ctx.createGain())).toThrow();
	});
	test('rapid biome crossfades cap retired graphs and destroy cleans pending voices without timers',()=>{
		jest.useFakeTimers();
		try {
			const ctx=fakeContext(),mixer=new StemFXMixer(ctx,ctx.createGain());
			mixer.addSource('drums',{effects:[{id:'old',type:'gain',gain:1}]});
			const oldest=mixer.sources.get('drums').chain;
			const originalDispose=jest.spyOn(oldest,'dispose');
			mixer.replaceEffects('drums',[{id:'garbage',type:'scrapheap',contact:.5}],.18);
			const garbage=mixer.sources.get('drums').chain;
			const garbageDispose=jest.spyOn(garbage,'dispose');
			mixer.replaceEffects('drums',[{id:'snow',type:'snowpack',depth:.72}],.18);
			mixer.replaceEffects('drums',[{id:'water',type:'hydrostatic',pressure:.6}],.18);
			mixer.replaceEffects('drums',[{id:'micro',type:'microbox',openness:0}],.18);
			mixer.replaceEffects('drums',[{id:'crystal',type:'crystallattice',strength:1.5}],.18);
			expect(mixer.retiringEffects.size).toBeLessThanOrEqual(3);
			expect(originalDispose).toHaveBeenCalledTimes(1);
			expect(garbageDispose).toHaveBeenCalledTimes(1);
			const waiting=[...mixer.retiringEffects];
			const waitingDisposals=waiting.map(entry=>jest.spyOn(entry.chain,'dispose'));
			mixer.destroy();
			expect(mixer.retiringEffects.size).toBe(0);
			expect(mixer.timers.size).toBe(0);
			for (const dispose of waitingDisposals)expect(dispose).toHaveBeenCalledTimes(1);
			// No old timer can disconnect twice or perform deferred audio work.
			jest.runOnlyPendingTimers();
			for (const dispose of waitingDisposals)expect(dispose).toHaveBeenCalledTimes(1);
		} finally {jest.useRealTimers();}
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
