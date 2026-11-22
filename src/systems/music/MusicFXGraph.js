import { BiomeSpaceBus } from './BiomeSpaceBus.js';
import { BSOD_THREAT_STEMS, createBsodThreatProcessor } from './BsodThreatProcessor.js';
/**
 * Low-cost WebAudio processors. Types are trusted code, specifications are validated data.
 * Each returned chain owns its oscillators/connections and can be disposed independently.
 */
const clamp = (n, lo, hi, fallback = lo) =>
	Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : fallback;

export const MUSIC_PROCESSORS = Object.freeze([
	'gain', 'filter', 'pan', 'distortion', 'delay', 'tremolo', 'ring', 'convolution', 'analyser', 'snowpack', 'scrapheap',
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
	const disposers = [];
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
		case 'scrapheap': {
			// Inharmonic, source-excited junk-metal resonators on ORIGINAL drum audio.
			// No independently timed notes or invented beat grid: the recording
			// remains audible on the untouched dry path.
			const dry = node(ctx.createGain()), wet = node(ctx.createGain());
			const highpass = node(ctx.createBiquadFilter());
			highpass.type = 'highpass'; highpass.frequency.value = 185;
			const grit = node(ctx.createWaveShaper());
			grit.curve = saturatorCurve(0.16);
			grit.oversample = '2x';
			dry.gain.value = 1;
			input.connect(dry); dry.connect(output);
			input.connect(highpass); highpass.connect(grit);
			const pitches = [379, 743, 1327]; // intentionally inharmonic, not Crystal chords
			const delays = [.017, .043, .071];
			const weights = [1.14, .82, .64];
			for (let i = 0; i < pitches.length; i++) {
				const resonator = node(ctx.createBiquadFilter());
				resonator.type = 'bandpass';
				resonator.frequency.value = pitches[i];
				resonator.Q.value = 5.2 + i * 1.5;
				const shortEcho = node(ctx.createDelay(.2));
				shortEcho.delayTime.value = delays[i];
				const voice = node(ctx.createGain());
				voice.gain.value = weights[i];
				grit.connect(resonator);
				resonator.connect(shortEcho);
				shortEcho.connect(voice);
				voice.connect(wet);
			}
			wet.connect(output);
			let contact = clamp(raw.contact, 0, 1, 0);
			let burstEnd = -Infinity;
			// Stationary and airborne have genuinely zero metallic contact;
			// a fast ground run makes the inharmonic layer audible but bounded.
			const bed = () => contact * .80;
			wet.gain.value = bed();

			// A collision must sound like a collision EVEN BETWEEN drum hits.
			// The previous version merely amplified resonances already being
			// excited by the recording, which could be effectively silent.
			// One deterministic struck-metal sample is generated per graph,
			// then reused as a small, bounded, physical Foley one-shot.
			const strikeLength = Math.ceil(ctx.sampleRate * .42);
			const strike = ctx.createBuffer(1, strikeLength, ctx.sampleRate);
			const samples = strike.getChannelData(0);
			let seed = 0x5A17C0DE;
			for (let i = 0; i < strikeLength; i++) {
				const t = i / ctx.sampleRate;
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
				const noise = (seed / 2147483648 - 1) * Math.exp(-t * 52);
				const metal = .42 * Math.sin(2 * Math.PI * 379 * t) * Math.exp(-t * 12)
					+ .34 * Math.sin(2 * Math.PI * 743 * t) * Math.exp(-t * 18)
					+ .21 * Math.sin(2 * Math.PI * 1327 * t) * Math.exp(-t * 25)
					+ .12 * Math.sin(2 * Math.PI * 1919 * t) * Math.exp(-t * 30);
				const thunk = .20 * Math.sin(2 * Math.PI * 119 * t) * Math.exp(-t * 38);
				samples[i] = Math.tanh((noise * .50 + metal + thunk) * .85);
			}
			const activeStrikes = new Set();
			const strikeOnce = (strength, at) => {
				if (activeStrikes.size >= 4) {
					const oldest = activeStrikes.values().next().value;
					try { oldest.source.stop(); } catch {}
					oldest.cleanup();
				}
				const source = ctx.createBufferSource();
				const gain = ctx.createGain();
				source.buffer = strike;
				gain.gain.value = .25 + strength * .80;
				source.connect(gain); gain.connect(output);
				const entry = {
					source,
					cleanup() {
						try { source.disconnect(); } catch {}
						try { gain.disconnect(); } catch {}
						activeStrikes.delete(entry);
					},
				};
				activeStrikes.add(entry);
				source.onended = () => entry.cleanup();
				source.start(Math.max(at, ctx.currentTime));
			};
			disposers.push(() => {
				for (const entry of activeStrikes) {
					try { entry.source.stop(); } catch {}
					entry.cleanup();
				}
			});

			refs.contact = { set: (value, at) => {
				contact = clamp(value, 0, 1, 0);
				// Takeoff silences contact immediately and cancels impact tails.
				if (contact === 0) {
					burstEnd = -Infinity;
					numericParam(wet.gain, bed(), at, 0.035);
				} else {
					// Ground-speed updates adjust the recovery without an abrupt click.
					const when = Math.max(at, burstEnd);
					numericParam(wet.gain, bed(), when, 0.11);
				}
				return true;
			} };
			refs.impact = { set: (value, at) => {
				const impulse = clamp(value, 0, 1, 0);
				if (impulse <= 0) return false;
				const peak = Math.min(1.65, bed() + .82 * impulse);
				burstEnd = at + .13;
				wet.gain.cancelScheduledValues(at);
				wet.gain.setTargetAtTime(peak, at, .018);
				wet.gain.setTargetAtTime(bed(), burstEnd, .22);
				strikeOnce(impulse, at);
				return true;
			} };
			break;
		}
		case 'snowpack': {
			// Acoustic snow blanket: soften attacks, absorb highs, keep the low end.
			// Original samples and their timing remain completely untouched.
			const dry = node(ctx.createGain()), wet = node(ctx.createGain());
			const lowA = node(ctx.createBiquadFilter()), lowB = node(ctx.createBiquadFilter());
			const shelf = node(ctx.createBiquadFilter());
			const comp = node(ctx.createDynamicsCompressor());
			for (const filter of [lowA, lowB]) { filter.type = 'lowpass'; filter.Q.value = 0.707; }
			shelf.type = 'highshelf'; shelf.frequency.value = 1800; shelf.gain.value = -5;
			comp.threshold.value = -25; comp.ratio.value = 4;
			comp.knee.value = 9; comp.attack.value = 0.004; comp.release.value = 0.18;
			input.connect(dry); dry.connect(output);
			input.connect(lowA); lowA.connect(lowB); lowB.connect(shelf);
			shelf.connect(comp); comp.connect(wet); wet.connect(output);
			let previousDepth = clamp(raw.depth, 0, 1, 0);
			const depthTargets = depth => {
				const ceiling = Math.max(300, Math.min(14000, ctx.sampleRate / 2 - 20));
				const cutoff = Math.max(250, Math.min(ceiling, 10500 * Math.pow(0.085, depth)));
				return [[dry.gain, 1 - depth], [wet.gain, depth * 0.95],
					[lowA.frequency, cutoff], [lowB.frequency, cutoff * 1.12]];
			};
			const setDepth = (value, at, immediate = false) => {
				const depth = clamp(value, 0, 1, 0);
				// Leaving the snow clears quickly; ground-level snow settles slowly.
				const smoothing = depth < previousDepth ? 0.035 : 0.13;
				previousDepth = depth;
				for (const [target, targetValue] of depthTargets(depth)) {
					if (immediate) target.value = targetValue;
					else numericParam(target, targetValue, at, smoothing);
				}
				return true;
			};
			const landImpact = (value, at) => {
				const impact = clamp(value, 0, 1, 0);
				if (impact <= 0 || previousDepth <= 0) return false;
				// Touchdown abruptly buries the notes; the same effect then
				// returns toward its original ground setting. No timer or
				// new audio graph is created and a new jump cancels the tail.
				const peak = Math.min(1, previousDepth + (1 - previousDepth) * impact * 0.95);
				const baseline = depthTargets(previousDepth);
				const buried = depthTargets(peak);
				for (let i = 0; i < baseline.length; i++) {
					const target = baseline[i][0];
					target.cancelScheduledValues(at);
					target.setTargetAtTime(buried[i][1], at, 0.018);
					target.setTargetAtTime(baseline[i][1], at + 0.12, 0.24);
				}
				return true;
			};
			refs.depth = { set: (value, at) => setDepth(value, at) };
			refs.impact = { set: (value, at) => landImpact(value, at) };
			setDepth(raw.depth, ctx.currentTime, true);
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
			if (!ref) return false;
			if (ref.set) return ref.set(value, at);
			if (!ref.target) return false;
			numericParam(ref.target, clamp(value, ref.lo, ref.hi), at);
			return true;
		},
		setImpulse(buffer) { return refs.impulse?.set(buffer); },
		dispose() {
			for (const stop of disposers) { try { stop(); } catch {} }
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
