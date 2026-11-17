import { jest } from '@jest/globals';
import {
	GAME_SONGS, defaultSongSelection, sanitizeSongSelection,
	enabledSongIndices, nextEnabledSongIndex, hasEnabledSongs,
} from '../../src/systems/music/MusicPlaylist.js';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';
import { AudioSynth } from '../../src/systems/AudioSynth.js';
import { defaultSettings, sanitizeSettings } from '../../src/systems/SaveStore.js';

const catalog = GAME_SONGS.map((item) => ({ id: item.id, title: item.label }));

describe('Four-song owner playlist — explicit all-off SILENCE', () => {
	test('all four default enabled and persisted through SaveStore sanitation', () => {
		expect(GAME_SONGS).toHaveLength(4);
		expect(enabledSongIndices(catalog, defaultSettings().musicEnabledSongs)).toEqual([0,1,2,3]);
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
		expect(Object.keys(selection)).toHaveLength(4);
	});
	test('disabled songs are excluded, wrapping skips disabled entries', () => {
		const selection = defaultSongSelection();
		selection[GAME_SONGS[1].id] = false;
		selection[GAME_SONGS[2].id] = false;
		expect(enabledSongIndices(catalog,selection)).toEqual([0,3]);
		expect(nextEnabledSongIndex(catalog,selection,0)).toBe(3);
		expect(nextEnabledSongIndex(catalog,selection,3)).toBe(0);
	});
	test('all four disabled returns NO INDEX; no fallback, no random song', () => {
		const allOff=Object.fromEntries(GAME_SONGS.map(s=>[s.id,false]));
		expect(hasEnabledSongs(allOff)).toBe(false);
		expect(enabledSongIndices(catalog,allOff)).toEqual([]);
		expect(nextEnabledSongIndex(catalog,allOff)).toBe(-1);
		expect(nextEnabledSongIndex(catalog,allOff,2)).toBe(-1);
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
