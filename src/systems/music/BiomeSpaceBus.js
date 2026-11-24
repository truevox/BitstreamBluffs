/**
 * Cheap, shared, send-only convolution room. Two spaces crossfade at a time.
 * Each source chooses how much enters this bus; the clean mix remains separate.
 */
import { ImpulseBank, ROOM_PRESETS } from './ImpulseBank.js';
import { HOME_BIOME } from './BiomeVoices.js';

export class BiomeSpaceBus {
	constructor(ctx, destination, { quality = 'standard', wet = 0.22 } = {}) {
		this.ctx = ctx;
		this.destination = destination;
		this.quality = quality;
		this.wet = wet;
		this.bank = new ImpulseBank(ctx, 3);
		this.input = ctx.createGain();
		// One global post-reverb gate. Per-source sends are lowered in
		// menus too, but already-excited room impulse tails can survive
		// those sends. Fade this output as well so the actual menu mix
		// becomes truly dry after the same 750ms transition.
		this.outputGate = ctx.createGain();
		this.outputGate.gain.value = 1;
		this.outputGate.connect(destination);
		this.wetEnabled = true;
		this.active = null;
		this.paths = new Set();
		this.timers = new Set();
		this.selectBiome(HOME_BIOME, 0.01);
	}

	selectBiome(id, fade = 0.55) {
		const next = Object.prototype.hasOwnProperty.call(ROOM_PRESETS, id) ? id : HOME_BIOME;
		if (this.active?.id === next) return false;
		const c = this.ctx;
		const convolver = c.createConvolver();
		convolver.normalize = true;
		convolver.buffer = this.bank.get(next, this.quality);
		const gain = c.createGain();
		gain.gain.value = 0;
		this.input.connect(convolver);
		convolver.connect(gain);
		gain.connect(this.outputGate);
		const route = { id: next, convolver, gain };
		this.paths.add(route);
		const start = c.currentTime, seconds = Math.min(2, Math.max(0.01, fade));
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(this.wet, start + seconds);
		if (this.active) {
			const old = this.active;
			old.gain.gain.cancelScheduledValues(start);
			old.gain.gain.setValueAtTime(old.gain.gain.value, start);
			old.gain.gain.linearRampToValueAtTime(0, start + seconds);
			const timer = setTimeout(() => {
				this.timers.delete(timer);
				this.paths.delete(old);
				try { this.input.disconnect(old.convolver); } catch {}
				try { old.convolver.disconnect(); old.gain.disconnect(); } catch {}
			}, (seconds + Math.min(4, ROOM_PRESETS[old.id].seconds)) * 1000);
			this.timers.add(timer);
		}
		this.active = route;
		// Fast biome changes must not accumulate unbounded live convolvers.
		if (this.paths.size > 3) {
			for (const obsolete of [...this.paths].slice(0, this.paths.size - 3)) {
				this.paths.delete(obsolete);
				try { this.input.disconnect(obsolete.convolver); } catch {}
				try { obsolete.convolver.disconnect(); obsolete.gain.disconnect(); } catch {}
			}
		}
		return true;
	}

	/** No room-convolution tail may spill into clean menu playback.
	 * Hold the exact in-flight gain on rapid reversals before scheduling
	 * the next bounded fade. A single gate applies to old AND new rooms.
	 */
	setWetEnabled(enabled, fadeSeconds = .75) {
		if (typeof enabled !== 'boolean' || this.wetEnabled === enabled)
			return false;
		this.wetEnabled = enabled;
		const t = this.ctx.currentTime;
		const param = this.outputGate.gain;
		if (typeof param.cancelAndHoldAtTime === 'function')
			param.cancelAndHoldAtTime(t);
		else {
			param.cancelScheduledValues(t);
			param.setValueAtTime(param.value,t);
		}
		param.linearRampToValueAtTime(enabled ? 1 : 0,
			t + Math.max(.02,Math.min(2,Number.isFinite(fadeSeconds)?fadeSeconds:.75)));
		return true;
	}

	destroy() {
		for (const t of this.timers) clearTimeout(t);
		this.timers.clear();
		for (const route of this.paths) {
			try { this.input.disconnect(route.convolver); route.convolver.disconnect(); route.gain.disconnect(); } catch {}
		}
		this.paths.clear();
		this.input.disconnect();
		this.outputGate.disconnect();
		this.bank.clear();
	}
}
