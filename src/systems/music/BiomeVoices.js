/**
 * The 12 mountain voice *identities*.
 * The sounds themselves are offline-rendered and supplied as optional pack sources.
 * Each voice is a first-class route: "voice:<id>".
 *
 * These art-direction presets are proposals, not hard-coded sound synthesis.
 */
export const HOME_BIOME = 'bitstream-bluffs';
export const BIOME_VOICES = Object.freeze({
	'bitstream-bluffs': { instrument: 'glitch-chip vocoder', environment: 'virtual-arcade', family: 'speech-synth' },
	'debumont': { instrument: 'warm SNES woodwind', environment: 'winter-cabin', family: 'sampled-wavetable' },
	'garbage-dump-glacier': { instrument: 'corrupt speech chip', environment: 'drain-tunnel', family: 'glitch-vocoder' },
	'pyramid-peak': { instrument: 'FM brass', environment: 'stone-chamber', family: 'fm' },
	'underwater-mountain': { instrument: 'liquid glass harmonica', environment: 'submerged', family: 'formant' },
	'crystal-cavern': { instrument: 'crystal bell choir', environment: 'crystal-cavern', family: 'fm' },
	'space-mountain': { instrument: 'expressive theremin', environment: 'cosmic-void', family: 'continuous' },
	'candy-cane-canyon': { instrument: 'candy hyperpop', environment: 'plastic-reflections', family: 'chip-hyperpop' },
	'sky-jellyfish-mountain': { instrument: 'vowel choir', environment: 'floating-cathedral', family: 'vocal-formant' },
	'steampunk-slopes': { instrument: 'mechanical calliope', environment: 'iron-factory', family: 'organ' },
	'micro-mountain': { instrument: 'toybox music-box', environment: 'tiny-wooden-room', family: 'plucked' },
	'vertigo-vents': { instrument: 'distorted pipe organ', environment: 'volcanic-chamber', family: 'organ' },
});

export const BIOME_IDS = Object.freeze(Object.keys(BIOME_VOICES));
export function voiceSourceForBiome(id) {
	const selected = Object.prototype.hasOwnProperty.call(BIOME_VOICES, id) ? id : HOME_BIOME;
	return 'voice:' + selected;
}
