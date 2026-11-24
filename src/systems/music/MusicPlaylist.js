import { cosmeticRandom } from '../CosmeticRandom.js';
import { SONG_ROSTER } from './FullSongRoster.js';
/** Full 33-song catalog; preserving original first-four order in settings. */
export const GAME_SONGS = SONG_ROSTER;
export const SONGS_PER_PAGE = 8;
/** Only show selectable songs that have actual installed source media.
 * The public four-song catalog remains four until private recordings are approved
 * for release; a 33-song private catalog exposes all 33. No phantom entries.
 */
export const installedSongChoices = (catalog) => {
	if (!Array.isArray(catalog) || !catalog.length) return GAME_SONGS.slice(0, 4);
	const installed = new Set(catalog.map(track => track.id));
	return GAME_SONGS.filter(song => installed.has(song.id));
};
export const songPageCount = (songs = GAME_SONGS) =>
	Math.max(1,Math.ceil(songs.length / SONGS_PER_PAGE));
export const songsForPage = (page, songs = GAME_SONGS) => {
	const current = Math.max(0,Math.min(songPageCount(songs)-1,Math.floor(Number(page)||0)));
	return songs.slice(current*SONGS_PER_PAGE,(current+1)*SONGS_PER_PAGE);
};
export const FIRST_SONG_ID = 'local-one-more-run-bitstream-bluffs';
export const defaultSongSelection = () => Object.fromEntries(GAME_SONGS.map(song => [song.id, true]));
export function sanitizeSongSelection(input) {
	const defaults = defaultSongSelection();
	if (!input || typeof input !== 'object' || Array.isArray(input)) return defaults;
	for (const song of GAME_SONGS) {
		if (typeof input[song.id] === 'boolean') defaults[song.id] = input[song.id];
	}
	// Preserve a user's explicit 'ALL OFF' state created under the four-song
	// version. Otherwise 29 newly enabled songs would start without permission.
	const legacy=GAME_SONGS.slice(0,4);
	const savedLegacyAllOff=legacy.every(song=>input[song.id]===false);
	const hasNewBoolean=GAME_SONGS.slice(4).some(song=>typeof input[song.id]==='boolean');
	if(savedLegacyAllOff&&!hasNewBoolean)
		for(const song of GAME_SONGS.slice(4))defaults[song.id]=false;
	return defaults;
}
export function enabledSongIndices(catalog, selection) {
	const enabled = sanitizeSongSelection(selection);
	if (!Array.isArray(catalog)) return [];
	return catalog.flatMap((track, i) => enabled[track.id] === true ? [i] : []);
}
export function nextEnabledSongIndex(catalog, selection, previousIndex = -1) {
	const indices = enabledSongIndices(catalog, selection);
	if (!indices.length) return -1;
	return indices.find(i => i > previousIndex) ?? indices[0];
}
/** Build a shuffled round of enabled tracks; never repeat the current one when alternatives exist. */
export function shuffledSongRound(catalog, selection, currentIndex, random=()=>cosmeticRandom('audio/shuffle').next()) {
	const enabled=enabledSongIndices(catalog,selection);
	if(enabled.length<2)return enabled;
	const choices=enabled.filter(index=>index!==currentIndex);
	for(let i=choices.length-1;i>0;i--){
		const raw=Number(random());
		const pick=Number.isFinite(raw)?Math.max(0,Math.min(0.999999999,raw)):0;
		const j=Math.floor(pick*(i+1));
		[choices[i],choices[j]]=[choices[j],choices[i]];
	}
	return choices;
}

export function hasEnabledSongs(selection) {
	return GAME_SONGS.some(song => sanitizeSongSelection(selection)[song.id]);
}
