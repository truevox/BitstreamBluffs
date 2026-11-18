import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { bsodThreatParameters, createBsodThreatProcessor } from '../../src/systems/music/BsodThreatProcessor.js';
import { StemFXMixer } from '../../src/systems/music/MusicFXGraph.js';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';
import { AudioSynth } from '../../src/systems/AudioSynth.js';
import { EVT } from '../../src/events.js';

class Param {
	constructor(value=0){this.value=value;this.calls=[];}
	cancelScheduledValues(){return this;}
	setValueAtTime(value){this.value=value;return this;}
	linearRampToValueAtTime(value){this.value=value;return this;}
	setTargetAtTime(value){this.value=value;this.calls.push(value);return this;}
}
class Node {
	constructor(kind){
		this.kind=kind;this.connections=[];this.stopCount=0;
		for(const name of ['gain','frequency','Q','delayTime','pan'])
			this[name]=new Param();
		this.fftSize=512;this.frequencyBinCount=256;
	}
	connect(n){this.connections.push(n);return n;}
	disconnect(){this.connections=[];}
	start(){this.started=true;}
	stop(){this.stopCount++;}
	getByteFrequencyData(arr){arr.fill(0);}
}
function fakeContext(){
	const ctx={sampleRate:48000,currentTime:5};
	for(const type of ['Gain','BiquadFilter','WaveShaper','Delay','Oscillator',
		'Convolver','Analyser','StereoPanner'])
		ctx['create'+type]=()=>new Node(type);
	ctx.createBuffer=(channels,length)=>({length,getChannelData:()=>new Float32Array(length)});
	return ctx;
}
describe('real BSOD proximity: original accompaniment corruption only',()=>{
	test('pure danger map is monotonic, bounded and neutral in the distant safe zone',()=>{
		const absent=bsodThreatParameters(NaN);
		expect(absent.blend).toBe(0);
		expect(bsodThreatParameters(-7).blend).toBe(0);
		expect(bsodThreatParameters(.08).blend).toBe(0);
		const mid=bsodThreatParameters(.62),near=bsodThreatParameters(1);
		expect(bsodThreatParameters(0).midMakeup).toBe(1);
		expect(bsodThreatParameters(.5).midMakeup).toBeGreaterThan(1.18);
		expect(bsodThreatParameters(.5).midMakeup).toBeLessThan(1.21);
		expect(bsodThreatParameters(1).midMakeup).toBeCloseTo(1);
		expect(mid.blend).toBeGreaterThan(0);
		expect(near.blend).toBeGreaterThan(mid.blend);
		expect(near.cutoffHz).toBeLessThan(mid.cutoffHz);
		expect(near.tremoloDepth).toBeGreaterThan(mid.tremoloDepth);
		expect(near.blend).toBeLessThan(1);
		expect(bsodThreatParameters(Infinity).blend).toBe(0);
	});

	test('calibrated waveshaper cannot reproduce the old ~11 dB small-signal boost',()=>{
		const ctx=fakeContext(),effect=createBsodThreatProcessor(ctx,ctx.createGain());
		const curve=effect.shaper.curve;
		const near=(index)=>({
			x:index*2/(curve.length-1)-1,
			y:curve[index],
		});
		const tiny=near(1034);
		const smallSignalGain=tiny.y/tiny.x;
		expect(smallSignalGain).toBeGreaterThan(1);
		expect(smallSignalGain).toBeLessThan(1.65);
		expect(Math.abs(curve[curve.length-1])).toBeLessThan(.34);
		effect.destroy();
	});

	test('static DSP remains dry at a distance, corrupts as danger approaches, recovers',()=>{
		const ctx=fakeContext(),dest=ctx.createGain();
		const effect=createBsodThreatProcessor(ctx,dest);
		expect(effect.dry.gain.value).toBe(1);
		expect(effect.wet.gain.value).toBe(0);
		expect(effect.osc.started).toBe(true);
		expect(effect.setDanger(.04)).toBe(true);
		expect(effect.wet.gain.value).toBe(0);
		expect(effect.setDanger(.99)).toBe(true);
		expect(effect.wet.gain.value).toBeGreaterThan(.75);
		expect(effect.filter.frequency.value).toBeLessThan(3000);
		expect(effect.mod.gain.value).toBeGreaterThan(.15);
		expect(effect.mixGain.gain.value).toBeGreaterThanOrEqual(1);
		const count=effect.wet.gain.calls.length;
		expect(effect.setDanger(.99)).toBe(false);
		expect(effect.wet.gain.calls).toHaveLength(count);
		expect(effect.setDanger(0)).toBe(true);
		expect(effect.dry.gain.value).toBe(1);
		expect(effect.wet.gain.value).toBe(0);
		expect(effect.mixGain.gain.value).toBe(1);
		effect.destroy();effect.destroy();
		expect(effect.osc.stopCount).toBe(1);
		expect(effect.setDanger(1)).toBe(false);
	});

	test('only original guitar/piano/Other get processors; biome FX crossfades preserve them',()=>{
		const ctx=fakeContext(),mixer=new StemFXMixer(ctx,ctx.createGain());
		for(const stem of ['guitar','piano','other','bass','drums','vocals',
			'voice:pyramid-peak','adaptive:featured'])mixer.addSource(stem);
		for(const stem of ['guitar','piano','other']){
			const src=mixer.sources.get(stem);
			expect(src.threat).toBeDefined();
			expect(src.output.connections).toContain(src.threat.input);
			expect(mixer.setThreatLevel(stem,.95)).toBe(true);
			expect(src.threat.wet.gain.value).toBeGreaterThan(.5);
			const retained=src.threat;
			expect(mixer.replaceEffects(stem,[{type:'filter',
				id:'biome-color',mode:'lowpass',frequency:4400}])).toBe(true);
			expect(src.threat).toBe(retained);
			expect(src.output.connections).toContain(retained.input);
		}
		for(const stem of ['bass','drums','vocals','voice:pyramid-peak','adaptive:featured']){
			expect(mixer.sources.get(stem).threat).toBeNull();
			expect(mixer.setThreatLevel(stem,1)).toBe(false);
		}
		const original=mixer.sources.get('guitar').threat;
		mixer.destroy();
		expect(original.osc.stopCount).toBe(1);
	});
	test('menu restores clean accompaniment; original track clock and biome lead are untouched',()=>{
		const d=Object.create(StemMusicDirector.prototype);
		d.menuMode=false;d.bsodDanger=0;d.biome='crystal-cavern';
		d.clockStart=19.75;d.trackIndex=2;d.started=false;
		d.gains=new Map(['guitar','piano','other'].map(s=>[s,{}]));
		d._timbreSignatures=new Map();
		d.pack={sourceNames:['voice:debumont','voice:crystal-cavern']};
		d.mixer={setThreatLevel:jest.fn(),setGain:jest.fn(),
			replaceEffects:jest.fn(),setRoomSend:jest.fn(),selectBiome:jest.fn(),
			setEffectParam:jest.fn()};
		d.adaptive={setEnabled:jest.fn(),setBiome:jest.fn(),
			setAirborne:jest.fn(),setSpeed:jest.fn()};
		d.setBsodDanger(.9);
		expect(d.bsodDanger).toBe(.9);
		expect(d.mixer.setThreatLevel).toHaveBeenCalledTimes(3);
		for(const stem of ['guitar','piano','other'])
			expect(d.mixer.setThreatLevel).toHaveBeenCalledWith(stem,.9);
		d.setMenuMode(true);
		expect(d.bsodDanger).toBe(0);
		for(const stem of ['guitar','piano','other'])
			expect(d.mixer.setThreatLevel).toHaveBeenCalledWith(stem,0);
		expect(d.clockStart).toBe(19.75);
		expect(d.trackIndex).toBe(2);
		expect(d._activeVoiceFor(d.pack)).toBe('voice:debumont');
		d.setBsodDanger(.95);
		expect(d.bsodDanger).toBe(0);
		d.setMenuMode(false);
		expect(d._activeVoiceFor(d.pack)).toBe('voice:crystal-cavern');
	});

	test('authoritative event: quiet relative air may still mean maximal music threat',()=>{
		const events=new EventEmitter(),audio=new AudioSynth({events});
		const param=()=>({setTargetAtTime:jest.fn()});
		audio.ctx={currentTime:5,close:jest.fn()};
		audio.nodes={windGain:{gain:param()},windFilter:{frequency:param()}};
		audio.settings={windEnabled:false,windVolume:0};
		const music=jest.spyOn(audio._stemMusic,'setBsodDanger');
		events.emit(EVT.BSOD_STATE_CHANGED,{
			active:true,atmosphereDensity:1,proximity01:.95,
			relativeAirX:0,worldTailwindPxS:400,sledVelocityXPxS:400,
		});
		expect(audio._bsodDanger01).toBe(.95);
		expect(audio.nodes.windGain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0,5,.08);
		expect(music).toHaveBeenLastCalledWith(.95);
		events.emit(EVT.RUN_END,{cause:'crash'});
		expect(music).toHaveBeenLastCalledWith(0);
		expect(audio._musicMode).toBe('menu');
		events.emit(EVT.BSOD_STATE_CHANGED,{
			active:true,atmosphereDensity:1,proximity01:1,relativeAirX:1000,
		});
		expect(music).toHaveBeenLastCalledWith(0);
		audio.destroy();
	});
});
