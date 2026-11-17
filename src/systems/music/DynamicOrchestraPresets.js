/** Lab-independent, small WebAudio presets for the full-song provisional melody.
 * OFF dynamic orchestra means the *lead* still changes character by biome,
 * while bass, drums, guitar, piano and other retain their ORIGINAL stems.
 * ON currently uses reversible biome FX on source stems; future full-length
 * replacement recordings can be added to the adaptive manifest independently.
 */
import { BIOME_IDS, HOME_BIOME } from './BiomeVoices.js';

const filter = (id, mode, frequency, Q = 0.7) => ({ type:'filter', id, mode, frequency, Q });
const distortion = amount => ({ type:'distortion', id:'color', amount });
const tremolo = (rate, depth) => ({ type:'tremolo', id:'motion', rate, depth });
const delay = (time, wet) => ({ type:'delay', id:'echo', time, wet, feedback:0.15 });

export function melodyPreset(biome) {
	switch (biome) {
		case 'debumont': return [filter('warm','lowpass',3200),tremolo(3.6,.12)];
		case 'garbage-dump-glacier': return [distortion(.31),filter('edge','highpass',420),tremolo(11,.24)];
		case 'pyramid-peak': return [distortion(.12),filter('brass','lowpass',4100,1.1)];
		case 'underwater-mountain': return [filter('submerged','lowpass',1400),delay(.22,.23)];
		case 'crystal-cavern': return [filter('crystal','highpass',650),delay(.29,.32)];
		case 'space-mountain': return [tremolo(5.8,.16),delay(.37,.27)];
		case 'candy-cane-canyon': return [distortion(.19),tremolo(9,.24)];
		case 'sky-jellyfish-mountain': return [filter('sky','lowpass',2600),tremolo(1.2,.21)];
		case 'steampunk-slopes': return [distortion(.17),tremolo(8.5,.23)];
		case 'micro-mountain': return [filter('tiny','highpass',1000),tremolo(10.5,.18)];
		case 'vertigo-vents': return [distortion(.44),filter('volcanic','lowpass',2900)];
		case HOME_BIOME: return [filter('arcade','lowpass',7000)];
		default: return [filter('arcade','lowpass',7000)];
	}
}

export function orchestraPreset(biome, stem) {
	if (!['bass','drums','guitar','piano','other'].includes(stem))
		throw new Error('Cannot apply orchestra effects to an unknown stem');
	if (!BIOME_IDS.includes(biome)) return [];
	const edge = {
		'debumont': 4200,'garbage-dump-glacier':6200,
		'pyramid-peak': 5100,'underwater-mountain':1800,
		'crystal-cavern':6800,'space-mountain':5700,
		'candy-cane-canyon':6900,'sky-jellyfish-mountain':3200,
		'steampunk-slopes':3800,'micro-mountain':7100,
		'vertigo-vents':3700,
	}[biome] || 5000;
	if (stem==='bass') {
		return [filter('shaped-bass','lowpass',Math.min(3000,edge*.55)),
			...(biome==='garbage-dump-glacier'||biome==='vertigo-vents'?[distortion(.18)]:[])];
	}
	if (stem==='drums') {
		return [filter('drum-color','lowpass',edge),
			...(biome==='steampunk-slopes'||biome==='micro-mountain'?[tremolo(6,.17)]:[])];
	}
	// Preserve source note timing, using only FX to make provisional
	// full-length instrument colors; artist-approved re-performances
	// will replace these with independent adaptive note stems later.
	return [filter('accompaniment-color','lowpass',edge),
		...(biome==='crystal-cavern'||biome==='space-mountain'?[delay(.19,.17)]:[]),
		...(biome==='garbage-dump-glacier'||biome==='vertigo-vents'?[distortion(.2)]:[])];
}
