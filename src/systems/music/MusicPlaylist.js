/** Four-song owner-selected rotation: One More Run first per fresh load, then sequential/shuffled. All disabled = SILENCE. */
export const GAME_SONGS = Object.freeze([
	{ id: 'FEsxYVStla4', label: 'POPE LEO' },
	{ id: 'local-one-more-run-bitstream-bluffs', label: 'ONE MORE RUN' },
	{ id: 'WRBGQUqD54U', label: 'RUNS OUT OF CODE' },
	{ id: 'FYImnz5-hXs', label: 'VARMONT IS SAVED' },
]);
export const FIRST_SONG_ID = 'local-one-more-run-bitstream-bluffs';
export const defaultSongSelection = () => Object.fromEntries(GAME_SONGS.map(song => [song.id, true]));
export function sanitizeSongSelection(input) {
	const defaults = defaultSongSelection();
	if (!input || typeof input !== 'object' || Array.isArray(input)) return defaults;
	for (const song of GAME_SONGS) {
		if (typeof input[song.id] === 'boolean') defaults[song.id] = input[song.id];
	}
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
export function shuffledSongRound(catalog, selection, currentIndex, random=Math.random) {
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
