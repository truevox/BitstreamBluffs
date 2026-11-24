import { jest } from '@jest/globals';
import { createVerifiedScrapCowbell } from '../../src/systems/music/ScrapCowbell.js';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';
import { ScrapPitchCadence } from '../../src/systems/music/ScrapPitchCadence.js';

function makeAudioContext(){
	const allocations=[],started=[];
	class Param {
		constructor(){this.value=0}
		setTargetAtTime(v){this.value=v}
	}
	class Node {
		constructor(name){this.name=name;this.gain=new Param();this.delayTime=new Param();
			this.pan=new Param();this.playbackRate=new Param();this.threshold=new Param();
			this.ratio=new Param();this.attack=new Param();this.release=new Param();this.connections=[]}
		connect(node){this.connections.push(node);return node}
		disconnect(){this.connections=[];this.disconnected=true}
		start(at=0){this.started=true;this.startAt=at;started.push(this)}
		stop(){this.stopped=true}
	}
	const ctx={sampleRate:48000,currentTime:10,allocations,started,
		createBuffer:(channels,length)=>{
			const audio=Array.from({length:channels},()=>new Float32Array(length));
			return {length,getChannelData:(channel)=>audio[channel]};
		}};
	for(const kind of ['Gain','DynamicsCompressor','StereoPanner','Delay','BufferSource'])
		ctx['create'+kind]=(...args)=>{
			const n=new Node(kind);allocations.push(n);return n;
		};
	return ctx;
}
const candidate={midi:60,hz:261.6255653005986,confidence:.8,strength:.7};

describe('Source-verified cowbell is bounded accompaniment to REAL scrap clangs, not a separate note engine',()=>{
	test('invalid or uncertain source candidates never generate a cowbell',()=>{
		const ctx=makeAudioContext(),output=ctx.createGain();
		const c=createVerifiedScrapCowbell(ctx,output,{level:2});
		expect(c.play(null)).toBe(false);
		expect(c.play({ ...candidate,hz:Infinity })).toBe(false);
		expect(c.play({ ...candidate,confidence:NaN })).toBe(false);
		expect(c.play({ ...candidate,strength:0 })).toBe(false);
		expect(c.play({ ...candidate,midi:60.5 })).toBe(false);
		expect(c.play({ ...candidate,hz:40 })).toBe(false);
		expect(c.played()).toBe(0);
		expect(ctx.started).toHaveLength(0);
		c.dispose();
	});
	test('one measured source candidate plays its own pitch, 200% level, original-like inharmonic body; max 3 live notes',()=>{
		const ctx=makeAudioContext(),output=ctx.createGain();
		const c=createVerifiedScrapCowbell(ctx,output,{level:2});
		expect(c.play(candidate,10.15)).toBe(true);
		expect(c.played()).toBe(1);
		expect(c.active()).toBe(1);
		expect(ctx.started.at(-1).playbackRate.value).toBeCloseTo(candidate.hz/440,9);
		expect(ctx.started.at(-1).startAt).toBe(10.15);
		expect(ctx.allocations.filter(n=>n.name==='Gain').some(n=>n.gain.value===.53)).toBe(true);
		for(let i=0;i<5;i++)expect(c.play(candidate)).toBe(true);
		expect(c.active()).toBeLessThanOrEqual(3);
		expect(ctx.started.some(n=>n.stopped)).toBe(true);
		c.dispose();
		expect(c.active()).toBe(0);
		expect(ctx.started.every(n=>n.stopped)).toBe(true);
		expect(c.play(candidate)).toBe(false);
		c.dispose();
	});
	test('game Director adds cowbell only AFTER a verified original bass clang successfully plays',()=>{
		const ctx=makeAudioContext(),bus=ctx.createGain();
		const d=Object.create(StemMusicDirector.prototype);
		d.started=true;d.transportPaused=false;d.menuMode=false;d.airborne=false;
		d.biome='garbage-dump-glacier';d.speedPxS=1200;d.ctx=ctx;d.bus=bus;
		d.scrapPitch=new ScrapPitchCadence();d.scrapCowbell=null;
		const actual={...candidate};
		d.scrapPitch.next=jest.fn(()=>actual);
		d.mixer={readEffect:jest.fn(()=>[actual]),setEffectParam:jest.fn(()=>false)};
		expect(d._maybeScrapPitchClang(ctx.currentTime)).toBe(false);
		expect(d.scrapCowbell).toBe(null);
		expect(d.scrapPitch.next).toHaveBeenCalledWith(ctx.currentTime,expect.any(Number),expect.any(Function),1.8);
		d.mixer.setEffectParam.mockReturnValue(true);
		expect(d._maybeScrapPitchClang(ctx.currentTime)).toBe(true);
		expect(d.scrapCowbell?.played()).toBe(1);
		expect(d.scrapCowbell?.active()).toBe(1);
		d.scrapCowbell.dispose();d.scrapCowbell=null;
		// Menus, airborne and missing confidence never fabricate notes.
		d.menuMode=true;expect(d._maybeScrapPitchClang(ctx.currentTime)).toBe(false);
		d.menuMode=false;d.airborne=true;expect(d._maybeScrapPitchClang(ctx.currentTime)).toBe(false);
		d.airborne=false;d.scrapPitch.next=jest.fn(()=>null);
		expect(d._maybeScrapPitchClang(ctx.currentTime)).toBe(false);
		expect(d.scrapCowbell).toBeNull();
	});
});
