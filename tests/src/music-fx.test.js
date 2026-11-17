import { jest } from '@jest/globals';
import { buildMusicChain, StemFXMixer, MUSIC_PROCESSORS } from '../../src/systems/music/MusicFXGraph.js';

class Param {
	constructor() { this.value = 0; }
	cancelScheduledValues() { return this; }
	setValueAtTime(v) { this.value = v; return this; }
	linearRampToValueAtTime(v) { this.value = v; return this; }
	setTargetAtTime(v) { this.value = v; return this; }
}
class AudioNodeMock {
	constructor(type) {
		this.type = type; this.connections = []; this.closed = false;
		for (const key of ['gain', 'frequency', 'Q', 'pan', 'delayTime']) this[key] = new Param();
		this.fftSize = 512;
	}
	connect(node) { this.connections.push(node); return node; }
	disconnect() { this.connections = []; }
	start() { this.started = true; }
	stop() { this.stopped = true; }
	getByteFrequencyData(array) { array.fill(51); }
}
function fakeContext() {
	const names = ['Gain','BiquadFilter','StereoPanner','WaveShaper','Delay','Oscillator','Convolver','Analyser'];
	const ctx = { sampleRate: 48000, currentTime: 10 };
	for (const name of names) ctx['create' + name] = () => new AudioNodeMock(name);
	ctx.createBuffer = (channels,length) => {
		const data = Array.from({length:channels},()=>new Float32Array(length));
		return {length, getChannelData(ch) {return data[ch];}};
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
