/**
 * Optional adaptive-backing playback for four-family / twelve-biome packs.
 *
 * All SIX original stems remain scheduled by StemMusicDirector. Three shared
 * buses receive replacements for bass, airborne drums and ONE featured source.
 * The melody continues to use the existing sampled voice:<biome> assets.
 * Variant files can be authored with ANY instrument renderer, not just GM.
 *
 * Sessions are bounded to two per family (current and transitioning).
 * A failed or slow variant fetch never mutes its original source.
 */
import { HOME_BIOME } from './BiomeVoices.js';
import { canonicalBiomeId } from '../../data/biomeAliases.js';

export const ADAPTIVE_FAMILIES = Object.freeze(['bass', 'drums', 'featured', 'guitar', 'piano', 'other']);
const FADE_SECONDS = 0.20;

const clamped = (v, low, high) => Math.max(low, Math.min(high, v));

export class AdaptiveBiomeRouter {
	constructor(ctx, mixer, loadBuffer) {
		this.ctx = ctx;
		this.mixer = mixer;
		this.loadBuffer = loadBuffer;
		this.pack = null;
		this.clockStart = null;
		this.biome = HOME_BIOME;
		this.airborne = false;
		// Standalone router callers retain the legacy enabled default.
		// StemMusicDirector sets the actual user toggle on every track.
		this.enabled = true;
		this.speed = null;
		this.channels = new Map();
		this.retired = new Set();
		this.generation = 0;
		this.timers = new Set();
		this.attached = false;
	}

	_attach() {
		if (this.attached) return;
		for (const role of ADAPTIVE_FAMILIES) {
			this.mixer.addSource('adaptive:' + role, { gain: 1 });
		}
		this.attached = true;
	}

	configure(pack, clockStart, { biome = this.biome, airborne = this.airborne } = {}) {
		this.reset();
		this.pack = pack?.adaptive ? pack : null;
		this.clockStart = Number.isFinite(clockStart) ? clockStart : null;
		this.biome = canonicalBiomeId(biome);
		this.airborne = !!airborne;
		if (!this.pack) return;
		this._attach();
		for (const role of ADAPTIVE_FAMILIES) {
			this.channels.set(role, { current: null, pending: null });
		}
		this._applySpeed();
		this._reconcile();
	}

	setEnabled(on) {
		this.enabled = on === true;
		this._reconcile();
	}

	setBiome(id) {
		this.biome = canonicalBiomeId(id) || HOME_BIOME;
		this._reconcile();
	}

	setAirborne(value) {
		this.airborne = !!value;
		this._reconcile();
	}

	setSpeed(value) {
		this.speed = Math.max(0, Number(value) || 0);
		this._applySpeed();
	}

	_applySpeed() {
		if (!this.pack || this.speed === null) return;
		const speedGain = clamped(0.28 + this.speed / 820, 0.28, 1.35);
		this.mixer.setGain('adaptive:bass', speedGain, { motion: true, time: .16 });
	}

	_original(role) {
		return role === 'featured' ? this.pack.adaptive.featuredStem : role;
	}

	_variant(role) {
		const variants = this.pack?.adaptive?.variants?.[role];
		if (!this.enabled || !variants || this.biome === HOME_BIOME) return null;
		// The featured part already has its own adaptive bus. Don't
		// simultaneously route that same source into a second named bus.
		if (['guitar','piano','other'].includes(role) &&
			this.pack.adaptive.featuredStem===role) return null;
		if (role === 'drums' && !this.airborne) return null;
		return variants[this.biome] ? this.biome : null;
	}

	_setOriginal(role, value) {
		const name = this._original(role);
		if (name) this.mixer.setMixGain(name, value, { time: FADE_SECONDS });
		// In adaptive mode the original drum bed is full-strength on the ground.
		// Unlike the legacy no-adaptive behavior, airborne means a real alternate.
	}

	_makeSession(role, biome) {
		const input = this.mixer.addSource('adaptive:' + role, { gain: 1 });
		if (!input) throw new Error('Adaptive bus missing: ' + role);
		const gain = this.ctx.createGain();
		gain.gain.value = 0;
		gain.connect(input);
		return { role, biome, gain, scheduled: new Set(), inflight: new Set(),
			failures: new Map(), nodes: new Set(), generation: ++this.generation,
			live: false, dead: false };
	}

	_ramp(session, value, at = this.ctx.currentTime) {
		const p = session.gain.gain;
		p.cancelScheduledValues(at);
		p.setValueAtTime(p.value, at);
		p.linearRampToValueAtTime(value, at + FADE_SECONDS);
	}

	_retire(session, { immediate = false } = {}) {
		if (!session || (session.dead && !immediate)) return;
		session.dead = true;
		this.retired.delete(session);
		if (immediate) {
			for (const node of session.nodes) {
				try { node.stop(); } catch {}
				try { node.disconnect(); } catch {}
			}
			session.nodes.clear();
			try { session.gain.disconnect(); } catch {}
			return;
		}
		// Only one retiring session per family. Rapid switches reclaim the
		// oldest voice rather than leaking a mixer/audio-source fleet.
		for (const old of [...this.retired]) {
			if (old.role === session.role) this._retire(old, { immediate: true });
		}
		this._ramp(session, 0);
		const until = this.ctx.currentTime + FADE_SECONDS + .02;
		for (const node of session.nodes) {
			try { node.stop(until); } catch {}
		}
		this.retired.add(session);
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			this._retire(session, { immediate: true });
		}, Math.ceil((FADE_SECONDS + .08) * 1000));
		this.timers.add(timer);
	}

	_reconcile() {
		if (!this.pack) return;
		for (const role of ADAPTIVE_FAMILIES) {
			const channel = this.channels.get(role);
			const wanted = this._variant(role);
			if (!wanted) {
				// Do NOT restart the source fade on every 75ms audio pump.
				// A repeated setMixGain(1) would cancel the in-progress
				// WebAudio automation and keep the original half-muted.
				if (channel.current || channel.pending) this._setOriginal(role, 1);
				this._retire(channel.current);
				this._retire(channel.pending, { immediate: true });
				channel.current = null;
				channel.pending = null;
				continue;
			}
			if (channel.current?.biome === wanted) {
				if (channel.pending) this._retire(channel.pending, { immediate: true });
				channel.pending = null;
				continue;
			}
			if (channel.pending?.biome === wanted) continue;
			// At most current and pending for each family (plus short fades).
			if (channel.pending) this._retire(channel.pending, { immediate: true });
			for (const old of [...this.retired]) {
				if (old.role === role) this._retire(old, { immediate: true });
			}
			channel.pending = this._makeSession(role, wanted);
		}
	}

	_promote(role, session) {
		const channel = this.channels.get(role);
		if (!channel || channel.pending !== session || session.dead) return;
		const previous = channel.current;
		channel.current = session;
		channel.pending = null;
		session.live = true;
		this._ramp(session, 1);
		this._setOriginal(role, 0);
		if (previous) this._retire(previous);
	}

	_schedule(session, index, buffer) {
		if (session.dead || !this.pack || this.clockStart === null ||
			session.scheduled.has(index)) return;
		const seg = this.pack.segments[index];
		const desired = this.clockStart + seg.startFrame / this.pack.sampleRate;
		const duration = seg.frames / this.pack.sampleRate;
		const now = this.ctx.currentTime;
		const start = Math.max(desired, now + .025);
		const offset = start - desired;
		// Lossy codec padding of a few milliseconds is normal, but an
		// incorrectly segmented replacement must never be mistaken for
		// a complete synced chunk.
		if (!buffer || !Number.isFinite(buffer.duration) ||
			buffer.duration + .04 < duration) {
			throw new Error('Adaptive asset shorter than source music segment');
		}
		const playLength = Math.min(duration - offset, buffer.duration - offset);
		if (!Number.isFinite(playLength) || playLength < .01) {
			throw new Error('Adaptive asset shorter than the required song-clock segment');
		}
		const node = this.ctx.createBufferSource();
		node.buffer = buffer;
		node.connect(session.gain);
		node.onended = () => {
			session.nodes.delete(node);
			try { node.disconnect(); } catch {}
		};
		try {
			node.start(start, offset, playLength);
			session.nodes.add(node);
			session.scheduled.add(index);
			// Never fade away the original before audio is actually schedulable.
			// Do not fade out the original a quarter-second before a
			// future song segment or first track chunk has even begun.
			if (!session.live && start <= now + .05) this._promote(session.role, session);
		} catch (error) {
			try { node.disconnect(); } catch {}
			throw error;
		}
	}

	pump() {
		if (!this.pack || this.clockStart === null || this.ctx.state !== 'running') return;
		this._reconcile();
		const now = this.ctx.currentTime;
		for (const role of ADAPTIVE_FAMILIES) {
			const pending = this.channels.get(role)?.pending;
			if (pending && !pending.dead && pending.scheduled.size) {
				for (const index of pending.scheduled) {
					const seg = this.pack.segments[index];
					const begin = this.clockStart + seg.startFrame / this.pack.sampleRate;
					const end = begin + seg.frames / this.pack.sampleRate;
					if (begin <= now + .05 && end > now + .025) {
						this._promote(role, pending);
						break;
					}
				}
			}
		}
		for (const role of ADAPTIVE_FAMILIES) {
			const channel = this.channels.get(role);
			if (channel.current && !channel.current.dead) {
				const covered = [...channel.current.scheduled].some(index => {
					const seg = this.pack.segments[index];
					const begin = this.clockStart + seg.startFrame / this.pack.sampleRate;
					const end = begin + seg.frames / this.pack.sampleRate;
					return begin <= now + .05 && end > now + .025;
				});
				if (!covered) {
					this._setOriginal(role, 1);
					this._ramp(channel.current, 0);
					channel.current.live = false;
					if (!channel.pending) channel.pending = channel.current;
					else this._retire(channel.current);
					channel.current = null;
				}
			}
			for (const session of [channel.current, channel.pending]) {
				if (!session || session.dead) continue;
				const paths = this.pack.adaptive.variants[role]?.[session.biome];
				if (!paths) continue;
				for (let index = 0; index < this.pack.segments.length; index++) {
					const seg = this.pack.segments[index];
					const start = this.clockStart + seg.startFrame / this.pack.sampleRate;
					const end = start + seg.frames / this.pack.sampleRate;
					if (end < now + .025 || start > now + 8) continue;
					if (session.scheduled.has(index) || session.inflight.has(index)) continue;
					if ((session.failures.get(index)?.retryAt ?? 0) > now) continue;
					session.inflight.add(index);
					Promise.resolve().then(() => {
						if (session.dead || !this.pack) return null;
						return this.loadBuffer(index, paths[index]);
					})
						.then(buffer => {
							if (buffer && !session.dead && this.pack) {
								session.failures.delete(index);
								this._schedule(session, index, buffer);
							}
						})
						.catch(error => {
							this.lastError = String(error);
							const attempts = (session.failures.get(index)?.attempts ?? 0) + 1;
							// Bound missing-asset request rates; a 404 must never be
							// retried on every 75-ms audio pump.
							session.failures.set(index, {
								attempts, retryAt: this.ctx.currentTime +
									Math.min(16, Math.pow(2, attempts)),
							});
							const channel = this.channels.get(role);
							// Prefetch failure for a LATER chunk must not
							// interrupt the current healthy music chunk.
							// The coverage guard restores the original at
							// the boundary if that file remains unavailable.
							const failingSegment = this.pack?.segments[index];
							const nearFailure = !failingSegment ||
								this.clockStart + failingSegment.startFrame /
								this.pack.sampleRate <= this.ctx.currentTime + .12;
							if (!nearFailure) return;
							// A failed destination must not leave the PREVIOUS
							// mountain instrument playing indefinitely.
							if (!session.dead && channel?.current === session) {
								this._setOriginal(role, 1);
								this._ramp(session, 0);
								session.live = false;
								channel.current = null;
								if (channel.pending) this._retire(channel.pending, { immediate: true });
								channel.pending = session;
							} else if (!session.dead && channel?.pending === session &&
								channel.current) {
								this._setOriginal(role, 1);
								this._retire(channel.current);
								channel.current = null;
							}
						})
						.finally(() => session.inflight.delete(index));
				}
			}
		}
	}

	reset() {
		for (const channel of this.channels.values()) {
			this._retire(channel.current, { immediate: true });
			this._retire(channel.pending, { immediate: true });
		}
		for (const old of this.retired) this._retire(old, { immediate: true });
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
		this.retired.clear();
		if (this.pack) {
			for (const role of ADAPTIVE_FAMILIES) this._setOriginal(role, 1);
		}
		this.channels.clear();
		if (this.pack && this.speed !== null) {
			this.mixer.setGain('bass', 1, { motion: true, time: .16 });
		}
		this.pack = null;
		this.clockStart = null;
	}

	destroy() {
		this.reset();
	}
}
