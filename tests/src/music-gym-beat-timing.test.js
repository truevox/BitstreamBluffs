import {jest} from '@jest/globals';
import {validateBeatGrid,nextVerifiedPulse,BEAT_GRID_FORMAT} from '../../src/systems/music/BeatGridTiming.js';
import {RELEASE_BEAT_GRIDS} from '../../src/systems/music/BeatGridCatalog.js';
import {AudioSynth} from '../../src/systems/AudioSynth.js';
const rate=48000,seconds=10,frames=rate*seconds;
const pack={id:'example-track',sampleRate:rate,frameCount:frames,duration:seconds};
const hash='a'.repeat(64);
const grid=()=>({format:BEAT_GRID_FORMAT,trackId:pack.id,version:'source-verified-v1',
	sourceSha256:hash,sourceSampleRate:rate,sourceFrameCount:frames,
	status:'verified',confidence:.97,
	review:{humanSpotCheck:'passed',independentCheck:'passed'},
	sections:[{startFrame:0,endFrame:rate*4,status:'verified',confidence:.96,
		pulseFrames:Array.from({length:8},(_,i)=>Math.round((.14+.5*i)*rate))},
		{startFrame:rate*4,endFrame:rate*6,status:'uncertain',confidence:.1,pulseFrames:[]},
		{startFrame:rate*6,endFrame:frames,status:'verified',confidence:.94,
		pulseFrames:[6.19,6.65,7.10,7.58,8.05,8.54,9.02,9.49]
			.map(v=>Math.round(v*rate))}]});
function harness(overrides={}){
	const ctx={currentTime:20.0,state:'running'};
	const d={started:true,transportPaused:false,_loading:null,track:{id:pack.id},pack,
		clockStart:18.86,ctx,activeNodes:new Set([{}]),_token:8,songEnabled:{[pack.id]:true}};
	const a=Object.create(AudioSynth.prototype);
	Object.assign(a,{ctx,settings:{masterVolume:1,musicVolume:.6,musicEnabledSongs:{'FEsxYVStla4':true}},
		_musicWanted:true,_stemMusic:d,_beatGrids:{[pack.id]:grid()},_paused:false,
		unavailable:false,_destroyed:false},overrides);
	return {a,d,ctx};
}

describe('source-verified beat grid gates',()=>{
	test('real four released tracks FAIL CLOSED, not fabricated from BPM or onsets',()=>{
		for(const [id,data] of Object.entries(RELEASE_BEAT_GRIDS)){
			expect(data.trackId).toBe(id);
			expect(validateBeatGrid(data,{id,sampleRate:48000,frameCount:480000}).trusted).toBe(false);
		}
	});
	test('explicit source metadata, dual signoff and confidence mandatory',()=>{
		const g=grid();expect(validateBeatGrid(g,pack).trusted).toBe(true);
		for(const patch of [
			{status:'candidate'},{sourceSha256:'not-a-sha'},
			{sourceSampleRate:44100},{sourceFrameCount:frames-1},
			{review:{humanSpotCheck:'pending',independentCheck:'passed'}},
			{review:{humanSpotCheck:'passed',independentCheck:'pending'}},
			{confidence:.899}])
			expect(validateBeatGrid({...g,...patch},pack).trusted).toBe(false);
	});
	test('bad order, cross-section beats, half/upbeat guesses and gap bridges rejected',()=>{
		const g=grid();
		for(const bad of [
			{...g.sections[0],pulseFrames:[10000,9999]},
			{...g.sections[0],pulseFrames:[10000,rate*4]},
			{...g.sections[0],pulseFrames:[10000,13000]},
			{...g.sections[0],endFrame:rate*3.9},
		]){
			expect(validateBeatGrid({...g,sections:[bad,...g.sections.slice(1)]},pack).trusted).toBe(false);
		}
	});
	test('phase-aware first/mid/end explicit quarter pulses, unusual tempo changes',()=>{
		const valid=validateBeatGrid(grid(),pack);expect(valid.trusted).toBe(true);
		let p=nextVerifiedPulse(valid,.04);expect(p.beatFrame).toBe(Math.round(.14*rate));
		expect(p.waitMs).toBeCloseTo(100,3);
		p=nextVerifiedPulse(valid,2.5);expect(p.beatFrame).toBe(Math.round(2.64*rate));
		p=nextVerifiedPulse(valid,9.30);expect(p.beatFrame).toBe(Math.round(9.49*rate));
		expect(nextVerifiedPulse(valid,4.9).trusted).toBe(false);
		expect(nextVerifiedPulse(valid,9.51).trusted).toBe(false);
		expect(nextVerifiedPulse(valid,.25,.3).trusted).toBe(false);
	});
	test('never exceeds a 300 ms delay, including malicious maxWaitMs',()=>{
		const valid=validateBeatGrid(grid(),pack);
		expect(nextVerifiedPulse(valid,.2,9999).trusted).toBe(false);
		expect(nextVerifiedPulse(valid,.2,301).trusted).toBe(false);
		expect(nextVerifiedPulse(valid,.2,0).trusted).toBe(false);
		const ok=nextVerifiedPulse(valid,.34,300);
		expect(ok.beatSeconds).toBeCloseTo(.64);
		expect(ok.waitMs).toBeCloseTo(300);
	});
});

describe('public AudioSynth Gym beat clock API',()=>{
	test('no started transport, no grid, muted master/music, paused context all release now',()=>{
		const {a,d,ctx}=harness();
		let x=a.getBeatTiming();expect(x.trusted).toBe(true);
		const scenarios=[
			x=>x.a._beatGrids={},x=>x.a.settings.masterVolume=0,
			x=>x.a.settings.musicVolume=0,x=>x.a._musicWanted=false,
			x=>x.d.transportPaused=true,x=>x.ctx.state='suspended',
			x=>x.d.activeNodes.clear(),x=>x.d._loading=Promise.resolve(),
			x=>x.d.track=null,x=>x.a.settings.musicEnabledSongs=Object.fromEntries(
				Object.keys(RELEASE_BEAT_GRIDS).map(id=>[id,false])),
			x=>x.a._paused=true];
		for(const change of scenarios){const h=harness();change(h);
			expect(h.a.getBeatTiming().trusted).toBe(false);
		}
	});
	test('timing uses WebAudio currentTime and source-recording frames, not 60/BPM',()=>{
		const {a,ctx}=harness();
		ctx.currentTime=20; // position=1.14, beat at 1.14
		const snapshot=a.getBeatTiming();
		expect(snapshot.trusted).toBe(true);
		expect(snapshot.beatFrame).toBe(Math.round(1.14*rate));
		expect(snapshot.waitMs).toBeCloseTo(0);
		expect(snapshot.dueAudioTime).toBeCloseTo(20);
		expect(snapshot.transportRevision).toBe('8:example-track:18.86');
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(a.isBeatTimingCurrent(snapshot)).toBe(true);
	});
	test('at 200 ms before pulse holds until beat; timeline identity guards seek/reentry/track change',()=>{
		const h=harness();h.ctx.currentTime=19.96; // p=1.10; next beat p=1.14
		const snap=h.a.getBeatTiming();expect(snap.trusted).toBe(true);
		expect(snap.waitMs).toBeCloseTo(40);
		h.ctx.currentTime=snap.dueAudioTime;
		expect(h.a.isBeatTimingCurrent(snap)).toBe(true);
		h.ctx.currentTime=snap.dueAudioTime+.08;
		expect(h.a.isBeatTimingCurrent(snap)).toBe(false);
		h.ctx.currentTime=snap.dueAudioTime;
		for(const change of [x=>x.d._token++,x=>x.d.clockStart+=.03,
			x=>x.d.track={id:'new-song'},x=>x.d.transportPaused=true,
			x=>x.ctx.state='suspended',x=>x.a.settings.musicVolume=0]){
			const fresh=harness();fresh.ctx.currentTime=19.96;
			const token=fresh.a.getBeatTiming();fresh.ctx.currentTime=token.dueAudioTime;
			change(fresh);expect(fresh.a.isBeatTimingCurrent(token)).toBe(false);
		}
	});
	test('expected transport revision prevents stale READY hold; no throw with missing audio',()=>{
		const {a,d}=harness();const initial=a.getBeatTiming();
		expect(a.getBeatTiming({expectedRevision:'wrong'}).trusted).toBe(false);
		d._token++;
		expect(a.getBeatTiming({expectedRevision:initial.transportRevision}).trusted).toBe(false);
		expect(Object.create(AudioSynth.prototype).getBeatTiming()).toMatchObject({trusted:false,release:'immediate'});
		expect(a.isBeatTimingCurrent({trusted:false})).toBe(false);
	});
});
