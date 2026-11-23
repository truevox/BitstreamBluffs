/** Independent non-destructive processing presets for source-stem playback.
 * They are active regardless of Dynamic Orchestra ON/OFF.
 * OFF disables re-performed replacement stems, NOT filtering, ambience,
 * distortion, tremolo, EQ, speed controls or other processing of originals.
 * The separately synthesized biome-specific lead stays active in both modes.
 */
import { BIOME_IDS, HOME_BIOME } from './BiomeVoices.js';
import { canonicalBiomeId } from '../../data/biomeAliases.js';

const filter = (id, mode, frequency, Q = 0.7) => ({ type:'filter', id, mode, frequency, Q });
const distortion = amount => ({ type:'distortion', id:'color', amount });
const tremolo = (rate, depth) => ({ type:'tremolo', id:'motion', rate, depth });
const delay = (time, wet) => ({ type:'delay', id:'echo', time, wet, feedback:0.15 });

export function melodyPreset(biome) {
	switch (canonicalBiomeId(biome)) {
		case 'debutmont': return [filter('warm','lowpass',3200),tremolo(3.6,.12)];
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
	biome=canonicalBiomeId(biome); // legacy "debumont" remains safely accepted
	if (!['bass','drums','guitar','piano','other'].includes(stem))
		throw new Error('Cannot apply orchestra effects to an unknown stem');
	if (!BIOME_IDS.includes(biome)) return [];
	// Powdery snow muffles the original performance without changing its notes or timing.
	// Bass retains some warmth; jumping temporarily removes this effect in the director.
	if (biome === 'debutmont') return [{ type:'snowpack', id:'snowpack',
		depth: stem === 'bass' ? .56 : .72 }];
	if (biome === 'candy-cane-canyon') return [{type:'sugarfizz',id:'sugarfizz',
		speed:0,airborne:false,sweetness:1.25,fizz:1.5,popLevel:1.3,wrapperLevel:.9}];
	if (biome === 'vertigo-vents') return [{type:'ventforge',id:'ventforge',
		rumble:1.25,shimmer:1.25,updraft:0,blast:1.3,crust:.8}];
	if (biome === 'sky-jellyfish-mountain') return [{type:'jellybloom',id:'jellybloom',
		airborne:false,buoyancy:1.35,floatRate:1,spring:1.30,liftLevel:.95}];
	if (biome === 'steampunk-slopes') return [{type:'steamworks',id:'steamworks',
		weight:stem==='drums'?1:stem==='bass'?.85:.48,
		speed:0,airborne:false,intensity:1.25,steam:1.5,impactWeight:1.35,accentWeight:1.0}];
	if (biome === 'underwater-mountain') return [{type:'hydrostatic',id:'hydrostatic',
		pressure:0,sensitivity:stem==='bass'?.68:1}];
	if (biome === 'micro-mountain') return [{type:'microbox',id:'microbox',
		openness:0,boxiness:1.35,impactWeight:1}];
	if (biome === 'crystal-cavern' && ['bass','guitar','piano','other'].includes(stem))
		return [{type:'crystallattice',id:'crystallattice',strength:1.5,openness:0,airBloom:1.6,
			detectChroma:stem==='bass',bassFeed:stem==='bass'}];
	if (biome === 'crystal-cavern' && stem==='drums')
		return [{type:'gain',id:'crystalPercussion',gain:1}];
	const edge = {
		'debutmont': 4200,'garbage-dump-glacier':6200,
		'pyramid-peak': 5100,'underwater-mountain':1800,
		'crystal-cavern':6800,'space-mountain':5700,
		'candy-cane-canyon':6900,'sky-jellyfish-mountain':3200,
		'steampunk-slopes':3800,'micro-mountain':7100,
		'vertigo-vents':3700,
	}[biome] || 5000;
	if (stem==='bass') {
		return [
			// The original bass is analysed BEFORE its existing FX. The
			// analyser is read only when an irregular on-pitch clang is due.
			...(biome==='garbage-dump-glacier'?[{type:'scrapPitchProbe',id:'scrapPitchProbe'}]:[]),
			filter('shaped-bass','lowpass',Math.min(3000,edge*.55)),
			...(biome==='garbage-dump-glacier'||biome==='vertigo-vents'?[distortion(.18)]:[])];
	}
	if (stem==='drums') {
		// Garbage retains a genuinely unfiltered original drum path; metal
		// coloration happens only in Scrapheap's parallel resonant wet send.
		if (biome==='garbage-dump-glacier')
			return [{type:'scrapheap',id:'scrapheap',contact:0}];
		return [filter('drum-color','lowpass',edge),
			...(biome==='steampunk-slopes'||biome==='micro-mountain'?[tremolo(6,.17)]:[])];
	}
	// Never replace, retrigger, rescore or move source note attacks here.
	// These are purely effects on the *original* waveform and apply
	// even when the separate re-performance playback is switched OFF.
	return [filter('accompaniment-color','lowpass',edge),
		...(biome==='crystal-cavern'||biome==='space-mountain'?[delay(.19,.17)]:[]),
		...(biome==='garbage-dump-glacier'||biome==='vertigo-vents'?[distortion(.2)]:[])];
}
