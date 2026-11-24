import { jest } from '@jest/globals';
import {
	GAME_SONGS, defaultSongSelection, sanitizeSongSelection,
	enabledSongIndices, nextEnabledSongIndex, hasEnabledSongs,
	songsForPage, songPageCount, SONGS_PER_PAGE, installedSongChoices,
} from '../../src/systems/music/MusicPlaylist.js';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';
import { AudioSynth } from '../../src/systems/AudioSynth.js';
import { defaultSettings, sanitizeSettings } from '../../src/systems/SaveStore.js';

const catalog = GAME_SONGS.map((item) => ({ id: item.id, title: item.label }));

describe('33-song owner playlist — explicit all-off SILENCE', () => {
	test('all 33 default enabled and persisted through SaveStore sanitation', () => {
		expect(GAME_SONGS).toHaveLength(33);
		expect(enabledSongIndices(catalog, defaultSettings().musicEnabledSongs)).toHaveLength(33);
		expect(sanitizeSettings({musicEnabledSongs:{[GAME_SONGS[1].id]:false}})
			.musicEnabledSongs[GAME_SONGS[1].id]).toBe(false);
	});
	test('unknown, malformed, and prototype-poisoned entries cannot disable songs', () => {
		const selection = sanitizeSongSelection({
			[GAME_SONGS[0].id]:false,[GAME_SONGS[2].id]:'false',
			__proto__:{fail:true},malicious:false,
		});
		expect(selection[GAME_SONGS[0].id]).toBe(false);
		expect(selection[GAME_SONGS[2].id]).toBe(true);
		expect(Object.keys(selection)).toHaveLength(33);
	});
	test('disabled songs are excluded, wrapping skips disabled entries', () => {
		const selection=Object.fromEntries(GAME_SONGS.map(s=>[s.id,false]));
		selection[GAME_SONGS[0].id]=true;
		selection[GAME_SONGS[32].id]=true;
		expect(enabledSongIndices(catalog,selection)).toEqual([0,32]);
		expect(nextEnabledSongIndex(catalog,selection,0)).toBe(32);
		expect(nextEnabledSongIndex(catalog,selection,32)).toBe(0);
	});
	test('pages expose all 33 tracks once without scrolling beyond panel',()=>{
		expect(songPageCount()).toBe(5);
		expect(SONGS_PER_PAGE).toBe(8);
		expect(Array.from({length:songPageCount()},(_,i)=>songsForPage(i)).flat()).toEqual(GAME_SONGS);
		expect(songsForPage(-1)).toEqual(GAME_SONGS.slice(0,8));
		expect(songsForPage(999)).toEqual(GAME_SONGS.slice(32));
	});
	test('public four-song catalog never displays phantom private tracks',()=>{
		const oldCatalog=GAME_SONGS.slice(0,4).map(song=>({id:song.id}));
		const choices=installedSongChoices(oldCatalog);
		expect(choices).toEqual(GAME_SONGS.slice(0,4));
		expect(songPageCount(choices)).toBe(1);
		expect(songsForPage(0,choices)).toHaveLength(4);
		expect(installedSongChoices(null)).toEqual(choices);
		expect(installedSongChoices(GAME_SONGS)).toEqual(GAME_SONGS);
	});
	test('all 33 disabled returns NO INDEX; no fallback, no random song', () => {
		const allOff=Object.fromEntries(GAME_SONGS.map(s=>[s.id,false]));
		expect(hasEnabledSongs(allOff)).toBe(false);
		expect(enabledSongIndices(catalog,allOff)).toEqual([]);
		expect(nextEnabledSongIndex(catalog,allOff)).toBe(-1);
		expect(nextEnabledSongIndex(catalog,allOff,2)).toBe(-1);
	});
	test('public all-off remains SILENT even when hidden private-song flags are enabled',()=>{
		const visible=GAME_SONGS.slice(0,4).map(song=>({id:song.id}));
		const selection=defaultSongSelection();
		for(const song of visible)selection[song.id]=false;
		expect(hasEnabledSongs(selection)).toBe(true); // hidden private choices are enabled
		expect(hasEnabledSongs(selection,visible)).toBe(false); // NONE are actually installed
		const privateCatalog=GAME_SONGS.map(song=>({id:song.id}));
		expect(hasEnabledSongs(selection,privateCatalog)).toBe(true);
		const audio=Object.create(AudioSynth.prototype);
		audio.settings={musicEnabledSongs:selection};
		audio._stemMusic={catalog:visible,stop:jest.fn()};
		audio._musicTimer=null;audio._arrCache=new Map();audio._musicWanted=false;
		audio._ensureCtx=jest.fn(()=>{throw Error('all visible songs OFF must never allocate audio');});
		audio._startScheduler=jest.fn();audio.nodes=null;
		expect(audio._hasEnabledSongs(selection)).toBe(false);
		audio.startMusic('public-all-off');
		expect(audio._stemMusic.stop).toHaveBeenCalledTimes(1);
		expect(audio._ensureCtx).not.toHaveBeenCalled();
		expect(audio._startScheduler).not.toHaveBeenCalled();
		// As soon as the private catalog is legitimately installed, those choices work.
		audio._stemMusic.catalog=privateCatalog;
		expect(audio._hasEnabledSongs(selection)).toBe(true);
	});
	test('private-only run initializes seeded procedural fallback before the catalog loads',()=>{
		const selection=defaultSongSelection();
		for(const item of GAME_SONGS.slice(0,4))selection[item.id]=false;
		const fake=()=>{
			const a=Object.create(AudioSynth.prototype);
			a.settings={musicEnabledSongs:selection};
			a._arrCache=new Map();a._stemMusic={catalog:GAME_SONGS.slice(0,4),
				stop:jest.fn(),ready:false,started:false};
			a._musicTimer=null;a._musicWanted=false;a._updateIntensity=jest.fn();
			a._ensureCtx=jest.fn(()=>true);
			a._activateStemMusic=jest.fn(()=>false);
			a._startScheduler=jest.fn();
			a.ctx={state:'running',currentTime:15};
			a.nodes={musicSrc:{gain:{cancelScheduledValues:jest.fn(),setTargetAtTime:jest.fn()}}};
			return a;
		};
		const a=fake(),b=fake();
		a.startMusic('private-only-run');
		b.startMusic('private-only-run');
		expect(a._musicWanted).toBe(true);
		expect(a._startScheduler).not.toHaveBeenCalled(); // still silent
		expect(a._ensureCtx).not.toHaveBeenCalled();
		expect(a._step).toBe(0);
		expect(a._progOrder).toHaveLength(4);
		expect(a._baseRng).toBeDefined();
		expect(a._arrangement(0)).toEqual(b._arrangement(0));
		// Later catalog discovery recognizes the actual installed source.
		a._stemMusic.catalog=GAME_SONGS;
		a.musicProviderFailed(); // real source failed; scheduler must now be safe
		expect(a._startScheduler).toHaveBeenCalledTimes(1);
		expect(()=>a._arrangement(1)).not.toThrow();
		expect(a._step).toBe(0);
	});
	test('four-song saved all-off migration never enables newly added songs',()=>{
		const legacyAllOff=Object.fromEntries(GAME_SONGS.slice(0,4).map(s=>[s.id,false]));
		expect(hasEnabledSongs(legacyAllOff)).toBe(false);
		expect(Object.values(sanitizeSongSelection(legacyAllOff)).every(v=>!v)).toBe(true);
	});
	test('director stops when the last song is disabled during playback', () => {
		const director=Object.create(StemMusicDirector.prototype);
		director.catalog=catalog;
		director.songEnabled=defaultSongSelection();
		director.started=true;
		director.track=catalog[0];
		director.stop=jest.fn(()=>{director.started=false;});
		const disabled=Object.fromEntries(GAME_SONGS.map(s=>[s.id,false]));
		director.setSongSelection(disabled);
		expect(director.stop).toHaveBeenCalledTimes(1);
		expect(director.started).toBe(false);
	});
	test('private-only menu selection waits for catalog readiness, then honors delayed initial autoplay',()=>{
		const audio=Object.create(AudioSynth.prototype);
		const selection=defaultSongSelection();
		for(const song of GAME_SONGS.slice(0,4))selection[song.id]=false;
		audio.settings={musicEnabledSongs:selection};
		audio._stemMusic={catalog:[],ready:false,transportPaused:false};
		audio._autoStartAttempted=false;audio._musicWanted=false;audio._menuAutoplayPending=false;
		audio._enterMenuMusic=jest.fn(()=>{audio._musicMode='menu';});
		audio._activateStemMusic=jest.fn(()=>true);
		audio.jukeboxPlay=jest.fn(()=>{audio._musicWanted=true;return true;});
		audio.startMenuMusic();
		expect(audio._autoStartAttempted).toBe(true);
		expect(audio._menuAutoplayPending).toBe(true);
		expect(audio.jukeboxPlay).not.toHaveBeenCalled();
		audio._stemMusic.catalog=catalog;
		audio._stemMusic.ready=true;
		audio._onStemCatalogReady();
		expect(audio.jukeboxPlay).toHaveBeenCalledTimes(1);
		expect(audio._menuAutoplayPending).toBe(false);
		// The same ready notification cannot replay an earlier pending intent.
		audio._onStemCatalogReady();
		expect(audio.jukeboxPlay).toHaveBeenCalledTimes(1);
	});
	test('menu autoplay pending intent is canceled by user pause or game start',()=>{
		const audio=Object.create(AudioSynth.prototype);
		const selection=defaultSongSelection();
		for(const song of GAME_SONGS.slice(0,4))selection[song.id]=false;
		audio.settings={musicEnabledSongs:selection};
		audio._stemMusic={catalog:[],ready:false,transportPaused:false,
			transportPause:jest.fn(()=>false),setBiome:jest.fn(),setMenuMode:jest.fn()};
		audio._autoStartAttempted=false;audio._musicWanted=false;
		audio._enterMenuMusic=jest.fn(()=>{audio._musicMode='menu';});
		audio._vinylJukeboxIntent=jest.fn();audio._activateStemMusic=jest.fn();
		audio.jukeboxPlay=jest.fn();
		audio.startMenuMusic();
		expect(audio._menuAutoplayPending).toBe(true);
		audio.jukeboxPause();
		expect(audio._menuAutoplayPending).toBe(false);
		audio._stemMusic.catalog=catalog;audio._stemMusic.ready=true;
		audio._onStemCatalogReady();
		expect(audio.jukeboxPlay).not.toHaveBeenCalled();
		audio._menuAutoplayPending=true;
		audio._onBsodState=jest.fn();audio._setPaused=jest.fn();
		audio.startMusic=jest.fn();
		audio._enterRunMusic('seed');
		expect(audio._menuAutoplayPending).toBe(false);
		audio._onStemCatalogReady();
		expect(audio.jukeboxPlay).not.toHaveBeenCalled();
	});
	test('public original-four menu fallback is still requested when catalog fetch has not completed',()=>{
		const audio=Object.create(AudioSynth.prototype);
		audio.settings={musicEnabledSongs:defaultSongSelection()};
		audio._stemMusic={catalog:[],ready:false};
		audio._autoStartAttempted=false;
		audio._enterMenuMusic=jest.fn(()=>{audio._musicMode='menu';});
		audio.jukeboxPlay=jest.fn();
		audio.startMenuMusic();
		expect(audio.jukeboxPlay).toHaveBeenCalledTimes(1);
		expect(audio._menuAutoplayPending).not.toBe(true);
	});
	test('AudioSynth.startMusic NEVER starts synth or stems in all-off mode', () => {
		const player=Object.create(AudioSynth.prototype);
		const disabled=Object.fromEntries(GAME_SONGS.map(s=>[s.id,false]));
		player.settings={musicEnabledSongs:disabled};
		player._stemMusic={stop:jest.fn()};
		player._musicTimer=null;
		player._arrCache=new Map();
		player._ensureCtx=jest.fn(()=>{throw new Error('Must not allocate audio for all-off mode');});
		player._startScheduler=jest.fn();
		player._musicWanted=false;
		player.nodes=null;
		player.startMusic('demo-seed');
		expect(player._stemMusic.stop).toHaveBeenCalledTimes(1);
		expect(player._ensureCtx).not.toHaveBeenCalled();
		expect(player._startScheduler).not.toHaveBeenCalled();
	});
});
