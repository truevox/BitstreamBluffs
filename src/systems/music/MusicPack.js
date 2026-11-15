/** Validated, versioned music-pack data. No Phaser, DOM or I/O. */
export const CORE_STEMS = Object.freeze(['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']);
const validId = (s) => typeof s === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(s);
const safePath = (s) => typeof s === 'string' && s.length < 300 &&
  !s.startsWith('/') && !s.includes('..') && !s.includes('\\') &&
  /^[a-zA-Z0-9_.\/-]+$/.test(s);
const whole = (v) => Number.isSafeInteger(v) && v >= 0;
const effectTypes = new Set(['gain', 'filter', 'pan', 'distortion', 'delay', 'tremolo', 'ring', 'convolution', 'analyser']);

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
	if (baselineNames.length < CORE_STEMS.length || baselineNames.length > 48) throw new Error('Too many music sources');
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
		captions,
		bpm: beat,
	};
}

export function resolveMusicAsset(baseUrl, safeRelativePath) {
	if (!safePath(safeRelativePath)) throw new Error('Unsafe music asset path');
	return new URL(safeRelativePath, baseUrl).href;
}
