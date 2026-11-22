/**
 * Twelve deterministic *designed* impulse responses, one per musical mountain.
 * These are placeholders for recorded/licensed room captures and special IRs.
 * The vacuum of Space Mountain deliberately sounds unreal; it is not physical acoustics.
 */
import { HOME_BIOME } from './BiomeVoices.js';

export const ROOM_PRESETS = Object.freeze({
	'bitstream-bluffs':       { seconds: 0.72, decay: 0.27, damping: 0.26, echoMs: 48, glitch: true },
	'debutmont':              { seconds: 0.48, decay: 0.18, damping: 0.15, echoMs: 32 },
	'garbage-dump-glacier':   { seconds: 1.45, decay: 0.55, damping: 0.65, echoMs: 113 },
	'pyramid-peak':          { seconds: 2.2, decay: 0.85, damping: 0.29, echoMs: 170 },
	'underwater-mountain':   { seconds: 1.4, decay: 0.52, damping: 0.93, echoMs: 95 },
	'crystal-cavern':        { seconds: 2.8, decay: 1.1, damping: 0.1, echoMs: 153 },
	'space-mountain':        { seconds: 3.0, decay: 1.15, damping: 0.43, echoMs: 240 },
	'candy-cane-canyon':     { seconds: 0.65, decay: 0.26, damping: 0.17, echoMs: 35 },
	'sky-jellyfish-mountain':{ seconds: 3.5, decay: 1.45, damping: 0.42, echoMs: 133 },
	'steampunk-slopes':      { seconds: 1.55, decay: 0.57, damping: 0.33, echoMs: 80 },
	'micro-mountain':        { seconds: 0.24, decay: 0.085, damping: 0.24, echoMs: 14 },
	'vertigo-vents':         { seconds: 2.65, decay: 1.04, damping: 0.72, echoMs: 195 },
});

function seedFor(text) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	return h >>> 0;
}

/** Build an offline-in-memory impulse. O(seconds * sampleRate), no model inference. */
export function createBiomeImpulse(ctx, id = HOME_BIOME, quality = 'standard') {
	const name = Object.prototype.hasOwnProperty.call(ROOM_PRESETS, id) ? id : HOME_BIOME;
	const preset = ROOM_PRESETS[name];
	const sr = ctx.sampleRate;
	const seconds = quality === 'mobile' ? Math.min(1.15, preset.seconds) : preset.seconds;
	const length = Math.max(128, Math.ceil(sr * seconds));
	const audio = ctx.createBuffer(2, length, sr);
	for (let ch = 0; ch < 2; ch++) {
		const samples = audio.getChannelData(ch);
		let rng = seedFor(name + ':' + ch), smooth = 0;
		for (let i = 0; i < length; i++) {
			rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
			const random = rng / 0xffffffff * 2 - 1;
			// Simple spectrum envelope and exponentially-decaying room tail.
			smooth = smooth * preset.damping + random * (1 - preset.damping);
			const decay = Math.exp(-i / (sr * preset.decay));
			const quantized = preset.glitch ? Math.floor(i / 32) * 32 : i;
			samples[i] = 0.06 * decay * (preset.glitch ? Math.sin(quantized * 0.022) * smooth : smooth);
		}
		// Distinct reflections, different left/right times for a stereo image.
		const echoFrames = sr * preset.echoMs / 1000;
		for (let k = 0; k < 5; k++) {
			const where = Math.round((k + 1) * echoFrames * (ch ? 1.043 : 1));
			if (where < length) samples[where] += Math.pow(0.55, k + 1) * (ch ? -0.4 : 0.4);
		}
		samples[0] += 0.65;
	}
	return audio;
}

export class ImpulseBank {
	constructor(ctx, capacity = 3) {
		this.ctx = ctx;
		this.capacity = Math.max(1, Math.min(6, capacity));
		this.cache = new Map();
	}
	get(id, quality = 'standard') {
		const key = String(id) + '/' + quality;
		if (this.cache.has(key)) {
			const buffer = this.cache.get(key);
			this.cache.delete(key);
			this.cache.set(key, buffer);
			return buffer;
		}
		const buffer = createBiomeImpulse(this.ctx, id, quality);
		this.cache.set(key, buffer);
		if (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value);
		return buffer;
	}
	clear() { this.cache.clear(); }
}
