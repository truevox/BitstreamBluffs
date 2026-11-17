/** Four-song owner-selected rotation. All disabled = SILENCE, never synth fallback. */
export const GAME_SONGS = Object.freeze([
	{ id: 'FEsxYVStla4', label: 'POPE LEO' },
	{ id: 'local-one-more-run-bitstream-bluffs', label: 'ONE MORE RUN' },
	{ id: 'WRBGQUqD54U', label: 'RUNS OUT OF CODE' },
	{ id: 'FYImnz5-hXs', label: 'VARMONT IS SAVED' },
]);
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
export function hasEnabledSongs(selection) {
	return GAME_SONGS.some(song => sanitizeSongSelection(selection)[song.id]);
}
