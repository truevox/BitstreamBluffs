/** Public-release beat metadata, deliberately FAIL CLOSED.
 * No song is marked verified until actual pulse phase and regular quarter-note
 * division pass TWO independent checks including an accountable listening/spot
 * check. Detected attack timestamps are not musical beat proof.
 * Later verified entries must carry SHA-256 of the ORIGINAL source performance.
 */
import {BEAT_GRID_FORMAT} from './BeatGridTiming.js';
const ids=[
	'local-one-more-run-bitstream-bluffs',
	'WRBGQUqD54U',
	'FYImnz5-hXs',
	'FEsxYVStla4',
];
export const RELEASE_BEAT_GRIDS=Object.freeze(Object.fromEntries(ids.map(id=>[id,
	Object.freeze({format:BEAT_GRID_FORMAT,trackId:id,status:'unverified',
		review:Object.freeze({humanSpotCheck:'pending',independentCheck:'pending'}),
		confidence:0,sections:Object.freeze([]),
		note:'Beat phase is not established. BPM/score onsets are not beat evidence.'})])));
