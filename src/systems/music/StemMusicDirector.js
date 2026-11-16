/**
 * Six-stem Web Audio jukebox; decoded chunks share one clock.
 * The master FLAC bank is never loaded by the browser.
 * Derived source keys (for example "voice:bitstream-bluffs") are allowed in packs.
 * Optional 'voice:<biome>' sources are mixed in dynamically when a pack provides them.
 */
import { CORE_STEMS, normalizeCatalog, normalizePack, resolveMusicAsset } from './MusicPack.js';
import { StemFXMixer } from './MusicFXGraph.js';
import { AdaptiveBiomeRouter } from './AdaptiveBiomeRouter.js';
import { voiceSourceForBiome, HOME_BIOME } from './BiomeVoices.js';
import { captionAt, nextBeatTime, normalizeCaptions } from './CaptionSequencer.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const sleepSafe = (promise) => Promise.resolve(promise).catch(() => null);

export class StemMusicDirector {
	constructor(audio, catalogUrl = '/music/catalog.json') {
		this.audio = audio;
		this.catalogUrl = catalogUrl;
		this.catalog = [];
		this.ready = false;
		this.started = false;
		this.disposed = false;
		this.trackIndex = 0;
		this.track = null;
		this.pack = null;
		this.packBase = '';
		this.clockStart = null;
		this.ctx = null;
		this.gains = new Map();
		this._stemUserLevels = new Map(CORE_STEMS.map(name => [name, 1]));
		this._effectSignatures = new Map();
		this.activeNodes = new Set();
		this.cache = new Map();
		this.scheduled = new Set();
		this.inflight = new Map();
		this.biome = HOME_BIOME;
		this.vocals = false;
		this.musicCaptions = false;
		this.captionWords = [];
		this.airborne = false;
		this._timer = null;
		this._token = 0;
		this._nextPromise = null;
		this._nextIndex = null;
		this._loading = null;
		this.initPromise = this._loadCatalog();
	}

	async _loadCatalog() {
		try {
			const response = await fetch(this.catalogUrl);
			if (!response.ok) return false; // No music installed: existing synth stays in service.
			const parsed = normalizeCatalog(await response.json());
			this.catalog = parsed.tracks;
			this.ready = this.catalog.length > 0;
			if (this.ready && this.onReady && !this.disposed) this.onReady();
			return this.ready;
		} catch {
			return false;
		}
	}

	attach(ctx, target) {
		if (this.ctx) return;
		this.ctx = ctx;
		this.bus = ctx.createGain();
		this.bus.connect(target);
		const lowMemory = typeof navigator !== 'undefined' &&
			Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 4;
		this.mixer = new StemFXMixer(ctx, this.bus, { roomQuality: lowMemory ? 'mobile' : 'standard' });
		this.mixer.selectBiome(this.biome);
		for (const name of CORE_STEMS) {
			const g = this.mixer.addSource(name, { gain: name === 'vocals' && !this.vocals ? 0 : 1 });
			this.gains.set(name, g);
		}
		// Optional 4x12 sources use only three additional reusable mixer buses.
		// Legacy packs do not create or play any alternate source.
		this.adaptive = new AdaptiveBiomeRouter(ctx, this.mixer,
			(index, path) => this._fetchAdaptiveSegment(index, path));
	}

	applySettings(settings) {
		if (!settings) return;
		this.musicCaptions = settings.musicCaptions === true;
		this.setVocals(settings.musicVocals === true);
	}

	setStemGain(name, gain) {
		if (!CORE_STEMS.includes(name) || name === 'vocals') return false;
		const level = clamp(Number(gain) || 0, 0, 1.5);
		this._stemUserLevels?.set(name, level);
		const changed = this.mixer?.setGain(name, level) || false;
		// Keep user-mix level consistent as an original stem is replaced.
		const featured = this.pack?.adaptive?.featuredStem;
		const alternate = name === 'bass' || name === 'drums' ? name :
			name === featured ? 'featured' : null;
		if (alternate) this.mixer?.setGain('adaptive:' + alternate, level);
		return changed;
	}

	setVocals(on) {
		this.vocals = !!on;
		this.mixer?.setGain('vocals', this.vocals ? 1 : 0, { time: 0.03 });
		this._refreshVoices();
	}

	setBiome(id) {
		this.biome = typeof id === 'string' && id ? id : HOME_BIOME;
		this._refreshVoices();
		this.mixer?.selectBiome(this.biome);
		this.adaptive?.setBiome(this.biome);
		if (this.started) this._pump();
	}

	_activeVoiceFor(pack) {
		const desired = voiceSourceForBiome(this.biome);
		if (pack?.sourceNames?.includes(desired)) return desired;
		// Until all mountain instruments are rendered, keep the home melody audible.
		const home = voiceSourceForBiome(HOME_BIOME);
		return pack?.sourceNames?.includes(home) ? home : null;
	}

	_refreshVoices() {
		if (!this.mixer) return;
		const active = this._activeVoiceFor(this.pack);
		for (const name of this.gains.keys()) {
			if (!name.startsWith('voice:')) continue;
			// Maxi's real voice replaces most of the synthetic melodic lead when enabled.
			this.mixer.setGain(name, name === active ? (this.vocals ? 0.18 : 1) : 0, { time: 0.22 });
		}
	}

	setAirborne(airborne) {
		const next = !!airborne;
		if (next === this.airborne) return;
		this.airborne = next;
		// New adaptive packs crossfade full original drums with an actual
		// airborne kit. The legacy 0.58 airborne duck remains unchanged.
		this.mixer?.setGain('drums', this.pack?.adaptive ? 1 :
			this.airborne ? 0.58 : 1, { motion: true, time: 0.12 });
		this.adaptive?.setAirborne(this.airborne);
		if (this.started) this._pump();
	}

	setSpeed(speedPxS) {
		// Effects marked speed-filter react without altering source playback rate.
		const normalized = clamp((Number(speedPxS) || 0) / 1000, 0, 1);
		this.mixer?.setEffectParam('other', 'speed-filter', 'frequency', 400 + normalized * 15000);
		this.adaptive?.setSpeed(speedPxS);
	}

	setCombo(multiplier = 1) {
		const level = clamp(1 + (Number(multiplier) - 1) * 0.05, 0.8, 1.25);
		this.mixer?.setGain('other', level, { motion: true, time: 0.09 });
		if (this.pack?.adaptive?.featuredStem === 'other') {
			this.mixer?.setGain('adaptive:featured', level, { motion: true, time: 0.09 });
		}
	}

	getEnergy() { return this.mixer?.energy() || { bass: 0, mid: 0, treble: 0 }; }

	currentCaption() {
		if (!this.musicCaptions || !this.pack || this.clockStart === null || !this.ctx) return null;
		return captionAt(this.captionWords, this.ctx.currentTime - this.clockStart);
	}

	nextBeat() {
		if (!this.pack || !this.ctx || this.clockStart === null) return 0;
		return nextBeatTime(this.clockStart, Math.max(0, this.ctx.currentTime - this.clockStart), this.pack.bpm);
	}

	_wantedNames(pack) {
		const names = [...CORE_STEMS];
		const voice = this._activeVoiceFor(pack);
		if (voice) names.push(voice);
		for (const name of Object.keys(pack?.layers || {})) {
			if (!names.includes(name)) names.push(name);
		}
		return names;
	}

	start() {
		if (this.disposed || !this.ready) return false;
		this.started = true;
		if (this.bus && this.ctx) this.bus.gain.setTargetAtTime(1, this.ctx.currentTime, 0.025);
		this._ensureRunning();
		return true;
	}

	onResume() {
		if (this.started) this._ensureRunning();
	}

	_ensureRunning() {
		if (!this.started || !this.ctx || this.ctx.state !== 'running') return;
		if (!this.pack && !this._loading) {
			this._loading = this._beginTrack(this.trackIndex, null).finally(() => { this._loading = null; });
		}
		if (!this._timer) this._timer = setInterval(() => { this._pump(); }, 75);
	}

	async _getTrack(index) {
		const track = this.catalog[index % this.catalog.length];
		const catalogBase = new URL(this.catalogUrl, window.location.href);
		const manifestUrl = resolveMusicAsset(catalogBase, track.manifest);
		const response = await fetch(manifestUrl);
		if (!response.ok) throw new Error('Cannot load music pack: ' + track.id);
		const pack = normalizePack(await response.json());
		if (pack.id !== track.id) throw new Error('Music pack ID mismatch');
		return { track, pack, base: manifestUrl };
	}

	async _preloadTrack(index) {
		const info = await this._getTrack(index);
		const buffers = new Map();
		await Promise.all(this._wantedNames(info.pack).map(async (name) => {
			const relative = info.pack.segments[0].sources[name];
			const response = await fetch(resolveMusicAsset(info.base, relative));
			if (!response.ok) throw new Error('Missing first segment: ' + name);
			const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
			buffers.set('0/' + name, buffer);
		}));
		return { ...info, buffers };
	}

	async _fetchSource(info, segmentIndex, sourceName, token) {
		const seg = info.pack.segments[segmentIndex];
		const relative = seg && seg.sources[sourceName];
		if (!relative || token !== this._token) return null;
		const key = String(segmentIndex) + '/' + sourceName;
		if (this.cache.has(key)) return this.cache.get(key);
		if (this.inflight.has(key)) return this.inflight.get(key);
		const promise = (async () => {
			const response = await fetch(resolveMusicAsset(info.base, relative));
			if (!response.ok) throw new Error('Missing stem ' + sourceName + ' in ' + info.track.id);
			const compressed = await response.arrayBuffer();
			const buffer = await this.ctx.decodeAudioData(compressed);
			if (token === this._token && !this.disposed) this.cache.set(key, buffer);
			return buffer;
		})();
		this.inflight.set(key, promise);
		try { return await promise; }
		finally { if (this.inflight.get(key) === promise) this.inflight.delete(key); }
	}

	// Biome assets are in the optional adaptive manifest map, not the 48
	// permanent segment sources. Cache by segment AND relative asset path;
	// source identity remains stable through biome switches.
	_syncAdaptiveUserLevels() {
		if (!this.pack?.adaptive || !this.mixer) return;
		const level = name => this._stemUserLevels?.get(name) ?? 1;
		this.mixer.setGain('adaptive:bass', level('bass'));
		this.mixer.setGain('adaptive:drums', level('drums'));
		this.mixer.setGain('adaptive:featured', level(this.pack.adaptive.featuredStem));
	}

	async _fetchAdaptiveSegment(index, path) {
		const token = this._token;
		if (!this.pack || this.clockStart === null || !this.pack.adaptive) return null;
		const key = String(index) + '/adaptive:' + path;
		if (this.cache.has(key)) return this.cache.get(key);
		if (this.inflight.has(key)) return this.inflight.get(key);
		const promise = (async () => {
			const response = await fetch(resolveMusicAsset(this.packBase, path));
			if (!response.ok) throw new Error('Missing optional adaptive source');
			const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
			if (token === this._token && !this.disposed) this.cache.set(key, buffer);
			return buffer;
		})();
		this.inflight.set(key, promise);
		try { return await promise; }
		finally { if (this.inflight.get(key) === promise) this.inflight.delete(key); }
	}

	async _beginTrack(index, desiredAt) {
		const token = ++this._token;
		this.cache.clear();
		this.inflight.clear();
		this.scheduled.clear();
		try {
			const info = this._nextIndex === index && this._nextPromise
				? await this._nextPromise : await this._getTrack(index);
			if (token !== this._token || this.disposed) return;
			if (!info) throw new Error('Next track could not be prepared');
			this.pack = info.pack;
			this.track = info.track;
			this.packBase = info.base;
			this.trackIndex = index;
			this.captionWords = [];
			for (const name of info.pack.sourceNames) {
				if (!this.gains.has(name)) {
					const initialGain = name.startsWith('voice:') ? 0 : CORE_STEMS.includes(name) ? 1 : 0;
					this.gains.set(name, this.mixer.addSource(name, { gain: initialGain }));
				}
				const effects = info.pack.effects[name] || [];
				const signature = JSON.stringify(effects);
				const previous = this._effectSignatures.get(name);
				if (previous !== signature) {
					this._effectSignatures.set(name, signature);
					// Default-empty chains already exist when a source is added.
					if (effects.length || (previous && previous !== '[]')) {
						this.mixer.replaceEffects(name, effects);
					}
				}
			}
			for (const name of info.pack.sourceNames) {
				this.mixer.setRoomSend(name, info.pack.roomSends[name]);
			}
			for (const [name, level] of Object.entries(info.pack.layers)) {
				this.mixer.setGain(name, level, { time: 0.1 });
			}
			this._refreshVoices();
			if (info.pack.captions) this._loadCaptions(info, token);
			this._nextPromise = null;
			this._nextIndex = null;
			if (info.buffers) {
				for (const [key, buffer] of info.buffers) this.cache.set(key, buffer);
			} else {
				await Promise.all(this._wantedNames(info.pack).map((s) => this._fetchSource(info, 0, s, token)));
			}
			if (token !== this._token || this.disposed) return;
			this.clockStart = Math.max(this.ctx.currentTime + 0.12, desiredAt || 0);
			this.adaptive?.configure(this.pack, this.clockStart,
				{ biome: this.biome, airborne: this.airborne });
			this._syncAdaptiveUserLevels();
			this.mixer?.setGain('drums', this.pack.adaptive ? 1 :
				this.airborne ? 0.58 : 1, { motion: true, time: 0.12 });
			this._pump();
		} catch (e) {
			if (token === this._token) {
				this.pack = null;
				this.lastError = String(e);
				this.started = false;
				if (this._timer) clearInterval(this._timer);
				this._timer = null;
				if (this.audio && this.audio.musicProviderFailed) this.audio.musicProviderFailed();
			}
		}
	}

	async _loadCaptions(info, token) {
		try {
			const response = await fetch(resolveMusicAsset(info.base, info.pack.captions));
			if (!response.ok) return;
			const parsed = normalizeCaptions(await response.json(), info.pack.duration);
			if (token === this._token && !this.disposed) this.captionWords = parsed.words;
		} catch { /* Missing/bad captions never silence the music. */ }
	}

	_scheduleSource(i, name, buffer) {
		const key = String(i) + '/' + name;
		if (!this.pack || !this.ctx || this.scheduled.has(key) || !buffer) return;
		const seg = this.pack.segments[i];
		const desired = this.clockStart + seg.startFrame / this.pack.sampleRate;
		const duration = seg.frames / this.pack.sampleRate;
		const now = this.ctx.currentTime;
		const late = Math.max(0, now + 0.02 - desired);
		if (late >= duration) { this.scheduled.add(key); return; }
		const dest = this.gains.get(name);
		if (!dest) return;
		const src = this.ctx.createBufferSource();
		src.buffer = buffer;
		src.connect(dest);
		this.activeNodes.add(src);
		src.onended = () => {
			this.activeNodes.delete(src);
			try { src.disconnect(); } catch {}
		};
		try {
			src.start(Math.max(desired, now + 0.02), late, Math.max(0.001, Math.min(duration - late, buffer.duration - late)));
			this.scheduled.add(key);
		} catch (e) {
			this.activeNodes.delete(src);
			try { src.disconnect(); } catch {}
			this.lastError = 'Schedule failed: ' + String(e);
		}
	}

	_pump() {
		if (!this.started || !this.pack || !this.ctx || this.ctx.state !== 'running' ||
			this.clockStart === null) return;
		const now = this.ctx.currentTime;
		const elapsed = now - this.clockStart;
		const duration = this.pack.duration;
		if (elapsed > duration - 15 && !this._nextPromise) {
			this._nextIndex = (this.trackIndex + 1) % this.catalog.length;
			this._nextPromise = this._preloadTrack(this._nextIndex).catch(() => null);
		}
		if (elapsed >= duration - 0.5) {
			if (!this._loading) {
				const nextIndex = (this.trackIndex + 1) % this.catalog.length;
				this._loading = this._beginTrack(nextIndex, this.clockStart + duration)
					.finally(() => { this._loading = null; });
			}
			return;
		}
		const info = { track: this.track, pack: this.pack, base: this.packBase };
		const token = this._token;
		this.adaptive?.pump();
		for (let i = 0; i < this.pack.segments.length; i++) {
			const seg = this.pack.segments[i];
			const begin = this.clockStart + seg.startFrame / this.pack.sampleRate;
			const end = begin + seg.frames / this.pack.sampleRate;
			if (end < now - 0.2) {
				const prefix = String(i) + '/';
				for (const key of this.cache.keys()) {
					if (key.startsWith(prefix)) this.cache.delete(key);
				}
				continue;
			}
			if (begin > now + 8) break;
			for (const name of this._wantedNames(this.pack)) {
				if (this.scheduled.has(String(i) + '/' + name)) continue;
				const cached = this.cache.get(String(i) + '/' + name);
				if (cached) this._scheduleSource(i, name, cached);
				else sleepSafe(this._fetchSource(info, i, name, token));
			}
		}
	}

	stop() {
		this.started = false;
		this._token++;
		if (this._timer) clearInterval(this._timer);
		this._timer = null;
		this._loading = null;
		this.adaptive?.reset();
		this.pack = null;
		this.clockStart = null;
		this.cache.clear();
		this.scheduled.clear();
		this._nextPromise = null;
		this._nextIndex = null;
		this.captionWords = [];
		// Stop queued sources, not just the timer: otherwise a rapid restart resurrects old audio.
		const now = this.ctx?.currentTime || 0;
		if (this.bus && this.ctx) this.bus.gain.setTargetAtTime(0, now, 0.01);
		for (const src of this.activeNodes) { try { src.stop(now + 0.04); } catch {} }
		this.activeNodes.clear();
	}

	destroy() {
		this.disposed = true;
		this.stop();
		this.adaptive?.destroy();
		this.mixer?.destroy();
		if (this.bus) this.bus.disconnect();
	}
}
