/** Validated, versioned music-pack data. No Phaser, DOM or I/O. */
import { BIOME_IDS, HOME_BIOME } from './BiomeVoices.js';
export const CORE_STEMS = Object.freeze(['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']);
const validId = (s) => typeof s === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(s);
const safePath = (s) => typeof s === 'string' && s.length < 300 &&
  !s.startsWith('/') && !s.includes('..') && !s.includes('\\') &&
  /^[a-zA-Z0-9_.\/-]+$/.test(s);
const whole = (v) => Number.isSafeInteger(v) && v >= 0;
const effectTypes = new Set(['gain', 'filter', 'pan', 'distortion', 'delay', 'tremolo', 'ring', 'convolution', 'analyser']);

const ADAPTIVE_FAMILIES = Object.freeze(['bass', 'drums', 'featured', 'guitar', 'piano', 'other']);
const FEATURE_STEMS = Object.freeze(['guitar', 'piano', 'other']);

/**
 * Biome-specific files are indexed separately from the 48 permanent pack
 * source IDs. Each role uses one reusable mix bus; its individual instrument
 * recordings may come from any synthesis, sampling or sound-design method.
 * Variant arrays are complete segment-aligned safe relative paths.
 */
function normalizeAdaptive(raw, count) {
	if (raw === undefined) return null;
	if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
		!FEATURE_STEMS.includes(raw.featuredStem) ||
		!raw.variants || typeof raw.variants !== 'object' ||
		Array.isArray(raw.variants)) {
		throw new Error('Invalid adaptive music map');
	}
	const variants = Object.create(null);
	for (const role of Object.keys(raw.variants)) {
		if (!ADAPTIVE_FAMILIES.includes(role)) throw new Error('Unknown adaptive role');
	}
	for (const role of ADAPTIVE_FAMILIES) {
		const biomeFiles = raw.variants[role] ?? {};
		if (!biomeFiles || typeof biomeFiles !== 'object' ||
			Array.isArray(biomeFiles)) throw new Error('Invalid adaptive variants');
		const mapping = Object.create(null);
		for (const [biome, files] of Object.entries(biomeFiles)) {
			if (biome === HOME_BIOME || !BIOME_IDS.includes(biome) ||
				!Array.isArray(files) || files.length !== count ||
				!files.every(safePath)) {
				throw new Error('Invalid biome audio segment mapping');
			}
			mapping[biome] = files.slice();
		}
		variants[role] = mapping;
	}
	return { featuredStem: raw.featuredStem, variants };
}

export function normalizeCatalog(raw) {
	if (!raw || raw.format !== 'bitstream-music-catalog-v1' || !Array.isArray(raw.tracks) || raw.tracks.length > 500) {
		throw new Error('Invalid music catalog');
	}
	const seen = new Set();
	const tracks = raw.tracks.map((track) => {
		if (!validId(track.id) || !safePath(track.manifest) || seen.has(track.id)) {
			throw new Error('Invalid catalog track');
		}
		seen.add(track.id);
		return { id: track.id, title: String(track.title || track.id).slice(0, 200), manifest: track.manifest };
	});
	return { tracks };
}

export function normalizePack(raw) {
	if (!raw || raw.format !== 'bitstream-music-pack-v1' || !validId(raw.id) ||
		!whole(raw.frameCount) || raw.frameCount < 1 || !whole(raw.sampleRate) ||
		raw.sampleRate < 8000 || raw.sampleRate > 192000 ||
		!Array.isArray(raw.segments) || raw.segments.length < 1 || raw.segments.length > 5000) {
		throw new Error('Invalid music pack');
	}
	let cursor = 0;
	const baselineNames = Object.keys(raw.segments[0]?.sources || {}).sort();
	if (baselineNames.length < CORE_STEMS.length ||
		baselineNames.length > (raw.adaptive === undefined ? 48 : 42)) {
		// Adaptive packs reserve SIX reusable mixer buses (featured, bass, drums, plus individual source guitar/piano/other).
		throw new Error('Too many music sources');
	}
	const segments = raw.segments.map((seg) => {
		if (!whole(seg.startFrame) || !whole(seg.frames) || seg.frames < 1 || seg.startFrame !== cursor ||
			!seg.sources || typeof seg.sources !== 'object') {
			throw new Error('Noncontiguous music segment');
		}
		if (Object.keys(seg.sources).sort().join('|') !== baselineNames.join('|')) throw new Error('Stem names change between segments');
		for (const name of CORE_STEMS) {
			if (!safePath(seg.sources[name])) throw new Error('Missing or unsafe stem: ' + name);
		}
		const sources = {};
		for (const [name, path] of Object.entries(seg.sources)) {
			if (!validId(name) || !safePath(path)) throw new Error('Unsafe music source');
			sources[name] = path;
		}
		cursor += seg.frames;
		return { startFrame: seg.startFrame, frames: seg.frames, sources };
	});
	if (cursor !== raw.frameCount) throw new Error('Music pack frame count mismatch');
	const effects = Object.create(null);
	if (raw.effects !== undefined) {
		if (!raw.effects || typeof raw.effects !== 'object' || Array.isArray(raw.effects)) throw new Error('Invalid effects map');
		for (const [name, stages] of Object.entries(raw.effects)) {
			if (!baselineNames.includes(name) || !Array.isArray(stages) || stages.length > 16) {
				throw new Error('Invalid source FX preset');
			}
			const ids = new Set();
			effects[name] = stages.map(stage => {
				if (!stage || !effectTypes.has(stage.type) || !validId(stage.id || stage.type) ||
					ids.has(stage.id || stage.type)) throw new Error('Invalid music processor');
				ids.add(stage.id || stage.type);
				return { ...stage };
			});
		}
	}
	const roomSends = Object.create(null);
	if (raw.roomSends !== undefined) {
		if (!raw.roomSends || typeof raw.roomSends !== 'object' ||
			Array.isArray(raw.roomSends)) throw new Error('Invalid room sends');
		for (const [name, value] of Object.entries(raw.roomSends)) {
			if (!baselineNames.includes(name) || !Number.isFinite(value) ||
				value < 0 || value > 1) throw new Error('Invalid room send level');
			roomSends[name] = value;
		}
	}
	// Optional always-on extra texture buses. Derived assets need no special engine code.
	const layers = Object.create(null);
	if (raw.layers !== undefined) {
		if (!raw.layers || typeof raw.layers !== 'object' || Array.isArray(raw.layers)) {
			throw new Error('Invalid derived layer map');
		}
		for (const [name, level] of Object.entries(raw.layers)) {
			if (!baselineNames.includes(name) || CORE_STEMS.includes(name) ||
				name.startsWith('voice:') || !Number.isFinite(level) || level < 0 || level > 1.5) {
				throw new Error('Invalid derived layer');
			}
			layers[name] = level;
		}
	}
	const captions = raw.captions === undefined ? null : raw.captions;
	if (captions !== null && !safePath(captions)) throw new Error('Invalid caption asset');
	// This is diagnostic metadata. It never changes normal playback routing.
	// An explicit expected content hash ties the score to this song revision.
	const score=raw.performance;
	if(score!==undefined && (!score||typeof score!=='object'||
		Array.isArray(score)||!safePath(score.path)||
		!/^[0-9a-f]{64}$/.test(score.scoreHash)))
		throw new Error('Invalid performance score asset');
	const performance=score===undefined?null:{
		path:score.path,scoreHash:score.scoreHash,
	};
	// The V2 file is an OPTIONAL, unverified comparison timeline. It is
	// intentionally NOT a music stem, rendering asset, or selection input.
	const experiment=raw.experimentalPerformance;
	if(experiment!==undefined && (
		!experiment||typeof experiment!=='object'||
		Array.isArray(experiment)||!safePath(experiment.path)||
		!/^[0-9a-f]{64}$/.test(experiment.scoreHash)||
		!/^[0-9a-f]{64}$/.test(experiment.parentScoreHash)||
		experiment.parentScoreHash!==performance?.scoreHash)){
		throw new Error('Invalid experimental performance comparison');
	}
	const experimentalPerformance=experiment===undefined?null:{
		path:experiment.path,scoreHash:experiment.scoreHash,
		parentScoreHash:experiment.parentScoreHash,
	};
	// Machine disagreement is a future human review queue, not gold and
	// not an audio or music playback asset.
	const review=raw.diagnosticReviewQueue;
	if(review!==undefined&&(!review||typeof review!=='object'||
		Array.isArray(review)||!safePath(review.path)||
		!/^[0-9a-f]{64}$/.test(review.baselineScoreHash)||
		!/^[0-9a-f]{64}$/.test(review.experimentalScoreHash)||
		review.baselineScoreHash!==performance?.scoreHash||
		review.experimentalScoreHash!==experimentalPerformance?.scoreHash)){
		throw new Error('Invalid non-gold review queue descriptor');
	}
	const diagnosticReviewQueue=review===undefined?null:{
		path:review.path,baselineScoreHash:review.baselineScoreHash,
		experimentalScoreHash:review.experimentalScoreHash,
	};
	const tempo = Number(raw.tempo);
	const beat = Number.isFinite(tempo) && tempo >= 30 && tempo <= 350 ? tempo : null;
	return {
		id: raw.id,
		title: String(raw.title || raw.id).slice(0, 200),
		sampleRate: raw.sampleRate,
		frameCount: raw.frameCount,
		duration: raw.frameCount / raw.sampleRate,
		segments,
		sourceNames: baselineNames,
		effects,
		roomSends,
		layers,
		adaptive: normalizeAdaptive(raw.adaptive, segments.length),
		performance,
		experimentalPerformance,
		diagnosticReviewQueue,
		captions,
		bpm: beat,
	};
}

export function resolveMusicAsset(baseUrl, safeRelativePath) {
	if (!safePath(safeRelativePath)) throw new Error('Unsafe music asset path');
	return new URL(safeRelativePath, baseUrl).href;
}
