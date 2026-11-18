import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { AudioSynth } from '../../src/systems/AudioSynth.js';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';
import { FIRST_SONG_ID, GAME_SONGS, defaultSongSelection, shuffledSongRound } from '../../src/systems/music/MusicPlaylist.js';
import { SaveStore, sanitizeSettings, defaultSettings } from '../../src/systems/SaveStore.js';
import { EVT } from '../../src/events.js';

const catalog = GAME_SONGS.map(s => ({ id:s.id, title:s.label, manifest:'packs/'+s.id+'/pack.json' }));
const gains = () => ({setTargetAtTime:jest.fn(),cancelScheduledValues:jest.fn()});

function audioFixture(){
	const events = new EventEmitter();
	const audio = new AudioSynth({events});
	audio.ctx={currentTime:100,state:'running',close:jest.fn()};
	audio.nodes={musicFilter:{frequency:gains()},musicSrc:{gain:gains()},
		windGain:{gain:gains()},windFilter:{frequency:gains()},
		dry:{gain:gains()},wet:{gain:gains()},gate:{gain:gains()},
		staticGain:{gain:gains()}};
	audio.settings={...defaultSettings()};
	audio._stemMusic.started=true;
	audio._stemMusic.ready=true;
	audio._stemMusic.trackIndex=1;
	audio._stemMusic.clockStart=80;
	audio._stemMusic.pack={sourceNames:['voice:debumont','voice:bitstream-bluffs']};
	audio._stemMusic.mixer=null;
	audio._musicWanted=true;
	audio.startMusic=jest.fn();
	return {audio,events};
}

describe('continuous soundtrack and saved shuffle',()=>{
	test('shuffle setting sanitizes and survives a new SaveStore session',()=>{
		expect(defaultSettings().musicShuffle).toBe(false);
		expect(sanitizeSettings({musicShuffle:'true'}).musicShuffle).toBe(false);
		expect(sanitizeSettings({musicShuffle:true}).musicShuffle).toBe(true);
		const old=globalThis.localStorage;
		const values=new Map();
		globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
		try {
			const a=new SaveStore();
			a.saveSettings({...defaultSettings(),musicShuffle:true});
			expect(new SaveStore().loadSettings().musicShuffle).toBe(true);
			a.saveSettings({...defaultSettings(),musicShuffle:false});
			expect(new SaveStore().loadSettings().musicShuffle).toBe(false);
		} finally {if(old===undefined)delete globalThis.localStorage; else globalThis.localStorage=old;}
	});
	test('first catalog track is always One More Run, including with shuffle on',async()=>{
		const old=globalThis.fetch;
		globalThis.fetch=jest.fn(async()=>({ok:true,json:async()=>({
			format:'bitstream-music-catalog-v1',tracks:catalog})}));
		try {
			const d=new StemMusicDirector(null);
			d.setShuffle(true);
			expect(await d.initPromise).toBe(true);
			expect(d.catalog[d.trackIndex].id).toBe(FIRST_SONG_ID);
			d.destroy();
		} finally {globalThis.fetch=old;}
	});
	test('shuffle round excludes disabled tracks and avoids within-round repeats',()=>{
		const selected=defaultSongSelection();
		const first=catalog.findIndex(s=>s.id===FIRST_SONG_ID);
		const round=shuffledSongRound(catalog,selected,first,()=>0);
		expect(round).toHaveLength(3);
		expect(new Set(round).size).toBe(3);
		expect(round).not.toContain(first);
		selected[catalog[3].id]=false;
		expect(shuffledSongRound(catalog,selected,first,()=>0)).toHaveLength(2);
		selected[catalog[0].id]=false;
		expect(shuffledSongRound(catalog,selected,first)).toEqual([2]);
		selected[catalog[2].id]=false;
		expect(shuffledSongRound(catalog,selected,first)).toEqual([first]);
	});
	test('shuffle previews do not reshuffle, and manual skips consume the actual queue',()=>{
		const d=Object.create(StemMusicDirector.prototype);
		d.catalog=catalog;d.songEnabled=defaultSongSelection();
		d.shuffleEnabled=true;d._shuffleRemaining=[];
		d.trackIndex=1;
		let current=1;const seen=new Set();
		for(let i=0;i<3;i++){
			const next=d._nextEnabledIndex(current);
			expect(next).toBe(d._nextEnabledIndex(current));
			expect(next).not.toBe(current);
			expect(seen.has(next)).toBe(false);
			seen.add(next);
			d._consumeShuffledIndex(next);
			current=next;
		}
		expect(seen.size).toBe(3);
		expect(d._nextEnabledIndex(current)).not.toBe(current);
	});
	test('menu uses Debumont voice and dry original stems with no gameplay motion',()=>{
		const d=Object.create(StemMusicDirector.prototype);
		d.menuMode=false;d.biome='crystal-cavern';d.speedPxS=930;
		d.airborne=true;d.dynamicOrchestra=true;d.vocals=false;d.started=true;
		d.pack={sourceNames:['voice:debumont','voice:crystal-cavern','voice:bitstream-bluffs']};
		d.gains=new Map([...['bass','drums','guitar','piano','other',...d.pack.sourceNames]
			.map(s=>[s,{}])]);
		d._timbreSignatures=new Map();
		d.mixer={setGain:jest.fn(),setEffectParam:jest.fn(),replaceEffects:jest.fn(),
			setRoomSend:jest.fn(),selectBiome:jest.fn()};
		d.adaptive={setAirborne:jest.fn(),setBiome:jest.fn(),setEnabled:jest.fn(),
			setSpeed:jest.fn()};
		d.setMenuMode(true);
		expect(d._activeVoiceFor(d.pack)).toBe('voice:debumont');
		expect(d.mixer.replaceEffects).toHaveBeenCalledWith('bass',[],0.18);
		expect(d.mixer.setRoomSend).toHaveBeenCalledWith('drums',0);
		expect(d.adaptive.setEnabled).toHaveBeenCalledWith(false);
		expect(d.mixer.setGain).toHaveBeenCalledWith('bass',1,
			{motion:true,time:.16});
		expect(d.speedPxS).toBe(0);
		expect(d.airborne).toBe(false);
		d.setSpeed(1000);
		d.setAirborne(true);
		expect(d.speedPxS).toBe(0);
		expect(d.airborne).toBe(false);
		d.setMenuMode(false);
		expect(d._activeVoiceFor(d.pack)).toBe('voice:crystal-cavern');
		expect(d.adaptive.setEnabled).toHaveBeenLastCalledWith(true);
	});
	test('RUN_END, abort, title and pause retain song position and reset wind/motion',()=>{
		const {audio,events}=audioFixture();
		const d=audio._stemMusic;
		const priorStart=d.clockStart,priorIndex=d.trackIndex;
		const stop=jest.spyOn(audio,'stopMusic');
		events.emit(EVT.RUN_START,{seed:'seed1'});
		expect(audio._musicMode).toBe('run');
		expect(audio.startMusic).not.toHaveBeenCalled();
		events.emit(EVT.BSOD_STATE_CHANGED,{active:true,atmosphereDensity:1,
			relativeAirX:800,proximity01:.9});
		expect(audio._windActive).toBe(true);
		events.emit(EVT.RUN_END,{});
		expect(audio._musicMode).toBe('menu');
		expect(audio._windActive).toBe(false);
		expect(audio._bsodDanger01).toBe(0);
		expect(d.menuMode).toBe(true);
		expect(audio.nodes.musicFilter.frequency.setTargetAtTime)
			.toHaveBeenLastCalledWith(18000,100,.05);
		expect(audio.nodes.musicSrc.gain.setTargetAtTime)
			.toHaveBeenLastCalledWith(0,100,.05);
		expect(stop).not.toHaveBeenCalled();
		events.emit(EVT.RUN_START,{seed:'seed2'});
		expect(audio.startMusic).not.toHaveBeenCalled();
		events.emit(EVT.GAME_PAUSE,{});
		expect(audio._musicMode).toBe('menu');
		expect(audio._paused).toBe(true);
		events.emit(EVT.GAME_RESUME,{});
		expect(audio._musicMode).toBe('run');
		expect(audio._paused).toBe(false);
		events.emit(EVT.RUN_ABORT,{});
		expect(d.clockStart).toBe(priorStart);
		expect(d.trackIndex).toBe(priorIndex);
		expect(d.started).toBe(true);
		expect(stop).not.toHaveBeenCalled();
		audio.destroy();
	});
	test('on game over the current song finishes before the normal next song starts',async()=>{
		const {audio,events}=audioFixture();
		const d=audio._stemMusic;
		d.catalog=catalog;
		d.songEnabled=defaultSongSelection();
		d.track=catalog[1];
		d.trackIndex=1;
		d.ctx=audio.ctx;
		d.ctx.currentTime=900;
		d.clockStart=800;
		d.pack={sourceNames:['voice:debumont','voice:bitstream-bluffs'],duration:180,segments:[]};
		d.started=true;
		d.disposed=false;
		d.shuffleEnabled=false;
		d._nextPromise=null;
		d._nextIndex=null;
		d._loading=null;
		const startNext=jest.spyOn(d,'_beginTrack').mockResolvedValue(undefined);
		const prefetch=jest.spyOn(d,'_preloadTrack').mockResolvedValue(null);
		const oldClock=d.clockStart;
		events.emit(EVT.RUN_END,{cause:'crash'});
		expect(d.clockStart).toBe(oldClock);
		expect(d.trackIndex).toBe(1);
		d._pump();
		expect(startNext).not.toHaveBeenCalled();
		expect(prefetch).not.toHaveBeenCalled();
		d.ctx.currentTime=966;
		d._pump();
		expect(startNext).not.toHaveBeenCalled();
		expect(prefetch).toHaveBeenCalledTimes(1);
		d.ctx.currentTime=979.6;
		d._pump();
		expect(startNext).toHaveBeenCalledTimes(1);
		expect(startNext).toHaveBeenCalledWith(2,980);
		await d._loading;
		audio.destroy();
	});
	test('title requests playback only once and honors browser unlock flow',()=>{
		const {audio}=audioFixture();
		const play=jest.spyOn(audio,'jukeboxPlay').mockReturnValue(true);
		audio.startMenuMusic();audio.startMenuMusic();
		expect(play).toHaveBeenCalledTimes(1);
		expect(audio._autoStartAttempted).toBe(true);
		expect(audio._musicMode).toBe('menu');
		audio.destroy();
	});
});
