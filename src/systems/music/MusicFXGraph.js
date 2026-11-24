import { BiomeSpaceBus } from './BiomeSpaceBus.js';
import { BSOD_THREAT_STEMS, createBsodThreatProcessor } from './BsodThreatProcessor.js';
/**
 * Low-cost WebAudio processors. Types are trusted code, specifications are validated data.
 * Each returned chain owns its oscillators/connections and can be disposed independently.
 */
const clamp = (n, lo, hi, fallback = lo) =>
	Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : fallback;

export const MUSIC_PROCESSORS = Object.freeze([
	'gain', 'filter', 'pan', 'distortion', 'delay', 'tremolo', 'ring', 'convolution', 'analyser',
]);

function saturatorCurve(amount) {
	const curve = new Float32Array(2048);
	const drive = 1 + amount * 18;
	const denom = Math.tanh(drive);
	for (let i = 0; i < curve.length; i++) {
		const x = 2 * i / (curve.length - 1) - 1;
		curve[i] = Math.tanh(x * drive) / denom;
	}
	return curve;
}

function numericParam(param, value, at, smoothing = 0.025) {
	param.cancelScheduledValues(at);
	param.setTargetAtTime(value, at, smoothing);
}

function allocateEffect(ctx, raw) {
	if (!raw || typeof raw !== 'object' || !MUSIC_PROCESSORS.includes(raw.type)) {
		throw new Error('Unsupported music processor');
	}
	const owned = [];
	const lfos = [];
	const refs = {};
	const node = (n) => { owned.push(n); return n; };
	const input = node(ctx.createGain());
	const output = node(ctx.createGain());
	const param = (key, target, lo, hi, defaultValue) => {
		refs[key] = { target, lo, hi };
		target.value = clamp(raw[key], lo, hi, defaultValue);
	};
	switch (raw.type) {
		case 'gain': {
			param('gain', output.gain, 0, 2, 1);
			input.connect(output);
			break;
		}
		case 'filter': {
			const filter = node(ctx.createBiquadFilter());
			filter.type = ['lowpass','highpass','bandpass','notch','peaking','lowshelf','highshelf'].includes(raw.mode)
				? raw.mode : 'lowpass';
			param('frequency', filter.frequency, 20, Math.min(20000,ctx.sampleRate/2 - 10), 1000);
			param('Q', filter.Q, 0.05, 30, 0.7);
			param('gainDb', filter.gain, -24, 24, 0);
			input.connect(filter);
			filter.connect(output);
			break;
		}
		case 'pan': {
			if (!ctx.createStereoPanner) {
				input.connect(output);
				break;
			}
			const p = node(ctx.createStereoPanner());
			param('pan', p.pan, -1, 1, 0);
			input.connect(p);
			p.connect(output);
			break;
		}
		case 'distortion': {
			const shaper = node(ctx.createWaveShaper());
			shaper.curve = saturatorCurve(clamp(raw.amount, 0, 1, 0.3));
			shaper.oversample = '2x';
			input.connect(shaper);
			shaper.connect(output);
			break;
		}
		case 'delay': {
			const dry = node(ctx.createGain());
			const wet = node(ctx.createGain());
			const delayed = node(ctx.createDelay(2));
			const feedback = node(ctx.createGain());
			param('time', delayed.delayTime, 0.01, 1.5, 0.22);
			param('feedback', feedback.gain, 0, 0.85, 0.25);
			param('wet', wet.gain, 0, 1, 0.22);
			dry.gain.value = 1;
			input.connect(dry); dry.connect(output);
			input.connect(delayed); delayed.connect(wet); wet.connect(output);
			delayed.connect(feedback); feedback.connect(delayed);
			break;
		}
		case 'tremolo': {
			const depth = clamp(raw.depth, 0, 1, 0.55);
			const trem = node(ctx.createGain());
			trem.gain.value = 1 - depth / 2;
			const osc = node(ctx.createOscillator());
			osc.type = 'sine';
			param('rate', osc.frequency, 0.1, 30, 4);
			const modGain = node(ctx.createGain());
			modGain.gain.value = depth / 2;
			osc.connect(modGain); modGain.connect(trem.gain);
			input.connect(trem); trem.connect(output);
			osc.start(); lfos.push(osc);
			break;
		}
		case 'ring': {
			const carrier = node(ctx.createGain());
			carrier.gain.value = 0;
			const osc = node(ctx.createOscillator());
			osc.type = ['sine','square','triangle'].includes(raw.wave) ? raw.wave : 'sine';
			param('rate', osc.frequency, 1, 2500, 110);
			osc.connect(carrier.gain);
			input.connect(carrier); carrier.connect(output);
			osc.start(); lfos.push(osc);
			break;
		}
		case 'convolution': {
			const dry = node(ctx.createGain());
			const wet = node(ctx.createGain());
			const conv = node(ctx.createConvolver());
			conv.normalize = raw.normalize !== false;
			param('wet', wet.gain, 0, 1, 0.2);
			dry.gain.value = 1;
			input.connect(dry); dry.connect(output);
			input.connect(conv); conv.connect(wet); wet.connect(output);
			// IR buffer arrives asynchronously. Missing IR = dry-only sound.
			refs.impulse = { set: (buffer) => { conv.buffer = buffer || null; } };
			break;
		}
		case 'analyser': {
			const analyser = node(ctx.createAnalyser());
			analyser.fftSize = 2 ** Math.round(Math.log2(clamp(raw.fftSize, 256, 2048, 512)));
			input.connect(analyser); analyser.connect(output);
			refs.analyser = { node: analyser };
			break;
		}
		default:
			throw new Error('Unsupported processor');
	}
	return {
		type: raw.type,
		id: String(raw.id || raw.type),
		input, output, refs,
		set(key, value, at) {
			const ref = refs[key];
			if (!ref || !ref.target) return false;
			numericParam(ref.target, clamp(value, ref.lo, ref.hi), at);
			return true;
		},
		setImpulse(buffer) { return refs.impulse?.set(buffer); },
		dispose() {
			for (const osc of lfos) { try { osc.stop(); } catch {} }
			for (const n of owned) { try { n.disconnect(); } catch {} }
		},
	};
}

export function buildMusicChain(ctx, effects, output) {
	if (!Array.isArray(effects) || effects.length > 16) throw new Error('Invalid music FX chain');
	const input = ctx.createGain();
	const stages = [];
	let current = input;
	try {
		const seen = new Set();
		for (const spec of effects) {
			const effect = allocateEffect(ctx, spec);
			if (seen.has(effect.id)) { effect.dispose(); throw new Error('Duplicate music processor id'); }
			seen.add(effect.id);
			current.connect(effect.input);
			current = effect.output;
			stages.push(effect);
		}
		current.connect(output);
	} catch (e) {
		for (const stage of stages) stage.dispose();
		try { input.disconnect(); } catch {}
		throw e;
	}
	return {
		input, stages,
		find(id) { return stages.find(s => s.id === id); },
		dispose() {
			try { input.disconnect(); } catch {}
			for (const stage of stages) stage.dispose();
			try { current.disconnect(); } catch {}
		},
	};
}

/**
 * Extensible stem bus. Source keys are data, not hardcoded to Demucs labels.
 * Separate base gain and motion gain prevent gameplay ducking from destroying
 * user mix levels. Effect chains can be replaced with smooth audio crossfades.
 */
export class StemFXMixer {
	constructor(ctx, destination, { roomQuality = 'standard' } = {}) {
		this.ctx = ctx;
		this.destination = destination;
		this.sources = new Map();
		this.maxSources = 48;
		this.timers = new Set();
		this.analyser = ctx.createAnalyser();
		this.analyser.fftSize = 1024;
		this.analyser.smoothingTimeConstant = 0.65;
		this.analyser.connect(destination);
		this._spectrum = new Uint8Array(this.analyser.frequencyBinCount);
		this.mixInput = ctx.createGain();
		this.mixInput.connect(this.analyser);
		// A tiny four-hit count-in may borrow short percussion excerpts from
		// already decoded original drum audio. It shares THIS same bus and
		// music transport but bypasses original-source recovery mute gates.
		this.countInInput=ctx.createGain();
		this.countInInput.connect(this.mixInput);
		this.recoveryPlan=null;
		this.space = new BiomeSpaceBus(ctx, this.mixInput, { quality: roomQuality });
	}

	addSource(id, { gain = 1, effects = [] } = {}) {
		if (this.sources.has(id)) return this.sources.get(id).input;
		if (typeof id !== 'string' || !/^[\w:-]{1,100}$/.test(id) ||
			this.sources.size >= this.maxSources) throw new Error('Music source budget exceeded');
		const input = this.ctx.createGain();
		input.gain.value = clamp(gain, 0, 2, 1);
		const motion = this.ctx.createGain();
		input.connect(motion);
		// Separate the user's mix level and gameplay motion from adaptive
		// original↔replacement fades. Default gain=1 preserves legacy packs.
		const mix = this.ctx.createGain();
		mix.gain.value = 1;
		const recovery=this.ctx.createGain();
		recovery.gain.value=1;
		motion.connect(recovery);
		recovery.connect(mix);
		const output = this.ctx.createGain();
		// Only the three ORIGINAL accompaniment stems get BSOD corruption.
		// This permanent processor survives every biome FX replacement.
		const threat = BSOD_THREAT_STEMS.includes(id)
			? createBsodThreatProcessor(this.ctx, this.mixInput) : null;
		output.connect(threat?.input || this.mixInput);
		const chain = buildMusicChain(this.ctx, effects, output);
		mix.connect(chain.input);
		const send = this.ctx.createGain();
		const defaultRoomSend = id.startsWith('voice:') ? 0.38 :
			id === 'vocals' ? 0.12 : id === 'piano' ? 0.09 :
			id === 'guitar' || id === 'other' ? 0.04 : 0;
		send.gain.value = defaultRoomSend;
		mix.connect(send);
		send.connect(this.space.input);
		const source = { input, motion, recovery, mix, output, chain, send, threat, defaultRoomSend };
		this.sources.set(id, source);
		if(this.recoveryPlan)this._scheduleRecoveryGate(source,this.recoveryPlan);
		return input;
	}

	selectBiome(id) { return this.space.selectBiome(id); }

	setRoomSend(id, value) {
		const source = this.sources.get(id);
		if (!source) return false;
		numericParam(source.send.gain, value == null ? source.defaultRoomSend : clamp(value, 0, 1), this.ctx.currentTime, 0.15);
		return true;
	}

	/** Music-only crash gate, independent of user level, motion gain,
	 * original-vs-adaptive mix crossfade, and room send. ALL source
	 * channels are gated; exactly four short drum accents may use
	 * countInInput before the existing master/music compressor.
	 */
	_scheduleRecoveryGate(source,plan){
		const param=source.recovery.gain;
		const now=this.ctx.currentTime;
		param.cancelScheduledValues(now);
		param.setValueAtTime(param.value,now);
		if(now<plan.bandAt){
			param.linearRampToValueAtTime(0,Math.min(plan.bandAt,now+.014));
			param.setValueAtTime(0,plan.bandAt);
		}
		param.linearRampToValueAtTime(1,Math.max(now+.01,plan.bandAt+.055));
	}

	setRecoveryPlan(plan){
		if(!plan||!Number.isFinite(plan.bandAt)||
			plan.bandAt<=this.ctx.currentTime)return false;
		this.recoveryPlan=plan;
		for(const source of this.sources.values())this._scheduleRecoveryGate(source,plan);
		return true;
	}

	cancelRecoveryPlan(){
		this.recoveryPlan=null;
		const now=this.ctx.currentTime;
		for(const source of this.sources.values()){
			const param=source.recovery.gain;
			param.cancelScheduledValues(now);
			param.setValueAtTime(param.value,now);
			param.linearRampToValueAtTime(1,now+.04);
		}
	}

	setGain(id, value, { motion = false, time = 0.04 } = {}) {
		const src = this.sources.get(id);
		if (!src) return false;
		const param = motion ? src.motion.gain : src.input.gain;
		numericParam(param, clamp(value, 0, 2), this.ctx.currentTime, clamp(time, 0.005, 1, 0.04));
		return true;
	}

	/** Authoritative BSOD proximity on ORIGINAL guitar, piano, Other only. */
	setThreatLevel(id, proximity01) {
		return this.sources.get(id)?.threat?.setDanger(proximity01) || false;
	}

	setMixGain(id, value, { time = 0.20 } = {}) {
		const src = this.sources.get(id);
		if (!src) return false;
		const now = this.ctx.currentTime;
		const param = src.mix.gain;
		param.cancelScheduledValues(now);
		param.setValueAtTime(param.value, now);
		// An explicit 200ms crossfade duration, not a 200ms exponential
		// time constant (which takes ~1 second to actually finish).
		param.linearRampToValueAtTime(clamp(value, 0, 1),
			now + clamp(time, 0.005, 1, 0.20));
		return true;
	}

	setEffectParam(id, effectId, key, value) {
		const effect = this.sources.get(id)?.chain?.find(effectId);
		return effect ? effect.set(key, value, this.ctx.currentTime) : false;
	}

	setImpulse(id, effectId, buffer) {
		const effect = this.sources.get(id)?.chain?.find(effectId);
		if (!effect || effect.type !== 'convolution') return false;
		effect.setImpulse(buffer);
		return true;
	}

	replaceEffects(id, effects = [], fadeSeconds = 0.15) {
		const src = this.sources.get(id);
		if (!src) return false;
		const output = this.ctx.createGain();
		output.gain.value = 0;
		const chain = buildMusicChain(this.ctx, effects, output);
		output.connect(src.threat?.input || this.mixInput);
		src.mix.connect(chain.input);
		const previous = { chain: src.chain, output: src.output };
		src.chain = chain;
		src.output = output;
		const t = this.ctx.currentTime;
		const fade = clamp(fadeSeconds, 0.02, 2, 0.15);
		previous.output.gain.cancelScheduledValues(t);
		previous.output.gain.setValueAtTime(previous.output.gain.value, t);
		previous.output.gain.linearRampToValueAtTime(0, t + fade);
		output.gain.setValueAtTime(0, t);
		output.gain.linearRampToValueAtTime(1, t + fade);
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			try { src.mix.disconnect(previous.chain.input); } catch {}
			previous.chain.dispose();
			try { previous.output.disconnect(); } catch {}
		}, (fade + 0.15) * 1000);
		this.timers.add(timer);
		return true;
	}

	energy() {
		this.analyser.getByteFrequencyData(this._spectrum);
		const bands = [0, 0, 0], counts = [0, 0, 0];
		const hzPerBin = this.ctx.sampleRate / this.analyser.fftSize;
		for (let i = 1; i < this._spectrum.length; i++) {
			const hz = i * hzPerBin;
			const band = hz < 250 ? 0 : hz < 2500 ? 1 : 2;
			bands[band] += this._spectrum[i] / 255;
			counts[band]++;
		}
		return { bass: bands[0]/(counts[0]||1), mid: bands[1]/(counts[1]||1),
			treble: bands[2]/(counts[2]||1) };
	}

	destroy() {
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
		for (const src of this.sources.values()) {
			try { src.input.disconnect(); src.motion.disconnect(); src.recovery.disconnect(); src.mix.disconnect(); src.output.disconnect(); src.send.disconnect(); } catch {}
			src.chain.dispose();
			src.threat?.destroy();
		}
		this.sources.clear();
		this.space.destroy();
		this.countInInput.disconnect();
		this.mixInput.disconnect();
		this.analyser.disconnect();
	}
}
