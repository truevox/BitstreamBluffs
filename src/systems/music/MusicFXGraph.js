import { BiomeSpaceBus } from './BiomeSpaceBus.js';
import { BSOD_THREAT_STEMS, createBsodThreatProcessor } from './BsodThreatProcessor.js';
import { CRYSTAL_MIDI_LOW, CRYSTAL_MIDI_HIGH, crystalHz, confidentCrystalNotes } from './CrystalChroma.js';
/**
 * Low-cost WebAudio processors. Types are trusted code, specifications are validated data.
 * Each returned chain owns its oscillators/connections and can be disposed independently.
 */
const clamp = (n, lo, hi, fallback = lo) =>
	Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : fallback;

export const MUSIC_PROCESSORS = Object.freeze([
	'gain', 'filter', 'pan', 'distortion', 'delay', 'tremolo', 'ring', 'convolution', 'analyser', 'snowpack', 'scrapheap', 'hydrostatic', 'microbox', 'crystallattice', 'scrapPitchProbe', 'steamworks', 'jellybloom', 'ventforge', 'sugarfizz',
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
		case 'scrapPitchProbe': {
			// Non-destructive view of the EXISTING original bass stem. A small
			// inaudible analyser tap gives safe real-source spectral candidates
			// when the grounded Scrapheap scheduler requests one. No timers.
			input.connect(output);
			const analyser=node(ctx.createAnalyser());analyser.fftSize=4096;
			analyser.smoothingTimeConstant=.52;
			const monitor=node(ctx.createGain());monitor.gain.value=1e-7;
			input.connect(analyser);analyser.connect(monitor);monitor.connect(output);
			const spectrum=new Float32Array(analyser.frequencyBinCount);
			refs.notes={read:()=>{
				if(typeof analyser.getFloatFrequencyData!=='function')return [];
				analyser.getFloatFrequencyData(spectrum);
				return confidentCrystalNotes(spectrum,{sampleRate:ctx.sampleRate,
					fftSize:analyser.fftSize,maxNotes:2});
			}};
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
			// Owner-approved extra weight on the physical impact only; contact-bed
			// loudness and the original drum recording remain unchanged.
			let splock = clamp(raw.splock, 0, 1.6, 1.6);
			// Takeoff volume is independent of the already-owner-approved landing.
			let suction = clamp(raw.suction, 0, 2.4, .8);
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
				const white = seed / 2147483648 - 1;
				const noise = white * Math.exp(-t * 52);
				const metal = .42 * Math.sin(2 * Math.PI * 379 * t) * Math.exp(-t * 12)
					+ .34 * Math.sin(2 * Math.PI * 743 * t) * Math.exp(-t * 18)
					+ .21 * Math.sin(2 * Math.PI * 1327 * t) * Math.exp(-t * 25)
					+ .12 * Math.sin(2 * Math.PI * 1919 * t) * Math.exp(-t * 30);
				// Thick, slightly descending hollow knock: the 'splock' under
				// the metal. Small delayed clacks suggest loose scrap scattering.
				const thunk = .35 * Math.sin(2 * Math.PI * (148 * t - 95 * t * t)) * Math.exp(-t * 31);
				const hollow = .30 * Math.sin(2 * Math.PI * (235 * t - 160 * t * t)) * Math.exp(-t * 24);
				// A sticky suction that gathers before it breaks free: fast upward
				// formant-like pitch glide, a rounded lip-pop, then small wet bits.
				// This is synthetic impact texture, NOT music or an extra song stem.
				const sip = Math.sin(2 * Math.PI * (94 * t + 520 * t * t - 350 * t * t * t));
				const sipEnvelope = Math.max(0, Math.min(1, t / .014)) * Math.exp(-t * 18);
				const suction = .33 * sip * sipEnvelope;
				const lip = .28 * Math.sin(2 * Math.PI * 173 * Math.max(0,t-.060))
					* (t >= .060 ? Math.exp(-(t-.060)*61) : 0);
				let debris = 0;
				for (const lag of [.042, .097, .151]) {
					if (t < lag) continue;
					const since = t - lag;
					debris += (.19 * white + .13 * Math.sin(2 * Math.PI * 870 * since))
						* Math.exp(-since * 105) * (1 - lag * 2.5);
				}
				samples[i] = Math.tanh((noise * .50 + metal * .85 + thunk + hollow + suction + lip + debris) * .85);
			}
			// Separate pitched junk-metal clang. Its FUNDAMENTAL comes from
			// confidently measured original bass frequencies, never a guessed
			// song key. Detuned/inharmonic UPPER PARTIALS preserve junkyard
			// identity rather than copying Crystal's pure glass bell sound.
			const clangBaseHz=440, clangLength=Math.ceil(ctx.sampleRate*.62);
			const clangBuffer=ctx.createBuffer(1,clangLength,ctx.sampleRate);
			const clangData=clangBuffer.getChannelData(0);
			let clangNoiseSeed=0xC1A90617;
			for(let i=0;i<clangLength;i++){
				const t=i/ctx.sampleRate;
				clangNoiseSeed=(Math.imul(clangNoiseSeed,1664525)+1013904223)>>>0;
				const noise=clangNoiseSeed/2147483648-1;
				const metal=.56*Math.sin(2*Math.PI*clangBaseHz*t)*Math.exp(-t*11)
					+.30*Math.sin(2*Math.PI*clangBaseHz*2.67*t)*Math.exp(-t*19)
					+.19*Math.sin(2*Math.PI*clangBaseHz*4.15*t)*Math.exp(-t*30);
				const ragged=noise*.13*Math.exp(-t*38);
				const chitter=t>.09?.12*Math.sin(2*Math.PI*1760*(t-.09))*Math.exp(-(t-.09)*64):0;
				clangData[i]=Math.tanh((metal+ragged+chitter)*1.1);
			}
			let clangLevel=clamp(raw.clangLevel,0,2,1.0);
			const activeClangs=new Set();
			const cleanClang=entry=>{
				try{entry.source.disconnect();}catch{}
				try{entry.gain.disconnect();}catch{}
				activeClangs.delete(entry);
			};
			const pitchClang=(candidate,at)=>{
				if(!candidate||!Number.isInteger(candidate.midi)||
					candidate.midi<CRYSTAL_MIDI_LOW||candidate.midi>CRYSTAL_MIDI_HIGH||
					!Number.isFinite(candidate.hz)||
					Math.abs(candidate.hz-crystalHz(candidate.midi))>.001||
					!Number.isFinite(candidate.confidence)||candidate.confidence<0||
					!Number.isFinite(candidate.strength)||candidate.strength<=0||
					contact<=.12||clangLevel<=0)return false;
				if(activeClangs.size>=3){const old=activeClangs.values().next().value;
					try{old.source.stop();}catch{}cleanClang(old);}
				const source=ctx.createBufferSource(),gain=ctx.createGain();
				source.buffer=clangBuffer;
				source.playbackRate.value=candidate.hz/clangBaseHz;
				const strength=clamp(candidate.strength,0,1,0);
				gain.gain.value=(.23+.24*strength)*clangLevel;
				source.connect(gain);gain.connect(output);
				const entry={source,gain};activeClangs.add(entry);
				source.onended=()=>cleanClang(entry);
				source.start(Math.max(ctx.currentTime,Number.isFinite(at)?at:ctx.currentTime));
				return true;
			};
			refs.pitchedClang={set:(value,at)=>pitchClang(value,at)};
			refs.clangLevel={set:value=>{
				if(!Number.isFinite(value))return false;
				clangLevel=clamp(value,0,2,1.0);return true;
			}};
			disposers.push(()=>{for(const entry of activeClangs){
				try{entry.source.stop();}catch{}cleanClang(entry);
			}});

			// Audition two materially different procedural suction textures.
			// The previous takeoff was mostly a pitched electronic glissando:
			// louder, but not convincingly wet. Here *filtered aspirated noise*
			// leads; tiny gurgles and a lip break are supporting details.
			// Everything is deterministic, precomputed and voice-capped.
			const suctionLength = Math.ceil(ctx.sampleRate * .43);
			const suctionBuffers = [];
			for (let style = 0; style < 2; style++) {
				const buffer = ctx.createBuffer(1, suctionLength, ctx.sampleRate);
				const data = buffer.getChannelData(0);
				let seed = style === 0 ? 0x14DDB337 : 0x7B00B1E5;
				let low = 0, mid = 0, sub = 0;
				for (let i = 0; i < suctionLength; i++) {
					const t = i / ctx.sampleRate;
					seed = (Math.imul(seed,1664525) + 1013904223) >>> 0;
					const white = seed / 2147483648 - 1;
					const progress = Math.min(1,t/.32);
					const opening = Math.min(1,t/.032);
					const release = Math.max(0,Math.min(1,(.40-t)/.13));
					const envelope = opening * release;
					// Simulated pressure change: noisy seal → narrow resonant
					// wet hiss → sudden break. Distinct cutoffs produce a
					// genuine timbral sweep, not just a louder sine wave.
					const base = style === 0 ? 300 : 165;
					const target = style === 0 ? 2350 : 1100;
					const cutoff = base + (target-base)*progress*progress;
					const lpf = 1 - Math.exp(-2*Math.PI*cutoff/ctx.sampleRate);
					const midf = 1 - Math.exp(-2*Math.PI*(cutoff*2.1)/ctx.sampleRate);
					const subf = 1 - Math.exp(-2*Math.PI*125/ctx.sampleRate);
					low += lpf*(white-low);
					mid += midf*(white-mid);
					sub += subf*(white-sub);
					const squish = (mid-low*.92)*1.65 + (low-sub)*.42;
					const flutter = style === 0 ?
						(.85 + .15*Math.sin(2*Math.PI*32*t)) :
						(.72 + .28*Math.sin(2*Math.PI*(19*t + 14*t*t)));
					let gulp = 0;
					if (style === 1) {
						// Several falling sticky bubble voids, not one musical note.
						for (const lag of [.070,.154,.235]) {
							const dt = t-lag;
							if (dt < 0) continue;
							gulp += .28*Math.sin(2*Math.PI*(205*dt-590*dt*dt))
								*Math.exp(-dt*39);
						}
					}
					const sealT = t-(style === 0 ? .265 : .315);
					// Rapid pressure release, with short low thop and moist tick.
					const breakPop = sealT < 0 ? 0 :
						(.42*Math.sin(2*Math.PI*(205*sealT-260*sealT*sealT))
						+ .35*white)*Math.exp(-sealT*65);
					const wet = squish*flutter*envelope*(style === 0 ? 1.15 : .98);
					data[i] = Math.tanh((wet + gulp + breakPop)*1.5);
				}
				suctionBuffers.push(buffer);
			}
			let suctionStyle = clamp(raw.suctionStyle,0,1,0) >= .5 ? 1 : 0;
			const activeStrikes = new Set();
			const playPhysical = (buffer, gainValue, at) => {
				if (activeStrikes.size >= 4) {
					const oldest = activeStrikes.values().next().value;
					try { oldest.source.stop(); } catch {}
					oldest.cleanup();
				}
				const source = ctx.createBufferSource();
				const gain = ctx.createGain();
				source.buffer = buffer;
				gain.gain.value = gainValue;
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
			const strikeOnce = (strength, at) =>
				playPhysical(strike, (.25 + strength * .80) * splock, at);
			const takeoffOnce = (strength, at) =>
				playPhysical(suctionBuffers[suctionStyle], (.28 + strength * .34) * suction * (suctionStyle === 0 ? .68 : 1), at);
			disposers.push(() => {
				for (const entry of activeStrikes) {
					try { entry.source.stop(); } catch {}
					entry.cleanup();
				}
			});

			refs.splock = { set: value => {
				splock = clamp(value, 0, 1.6, 1.6);
				return true;
			} };
			refs.suction = { set: value => {
				suction = clamp(value, 0, 2.4, .8);
				return true;
			} };
			refs.suctionStyle = { set: value => {
				if (!Number.isFinite(Number(value))) return false;
				suctionStyle = clamp(value,0,1,0) >= .5 ? 1 : 0;
				return true;
			} };
			refs.takeoff = { set: (value, at) => {
				const release = clamp(value, 0, 1, 0);
				if (release <= 0) return false;
				takeoffOnce(release, at);
				return true;
			} };
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
		case 'crystallattice': {
			// Consonant crystal modes are excited by ONLY the original source
			// waveform; no fake note sequencer and no MIDI stem rewriting.
			// Three harmonic instruments x 24 modes = bounded 72 biquads.
			// Drums and bass are separate (no white-noise crystal chords).
			const dry=node(ctx.createGain());dry.gain.value=1;
			input.connect(dry);dry.connect(output);
			const modal=node(ctx.createGain());
			const bassFeed=raw.bassFeed===true;
			// The actual Pope sample contains strong bass but virtually silent
			// guitar/piano/other. Include source bass overtones explicitly;
			// without that, this effect would be numerically inaudible.
			// Keep a 100%-untouched dry bass and saturate ONLY its wet send.
			let excitation=input;
			if(bassFeed){
				const pre=node(ctx.createGain());pre.gain.value=2.3;
				const bright=node(ctx.createWaveShaper());
				bright.curve=saturatorCurve(.14);bright.oversample='2x';
				input.connect(pre);pre.connect(bright);excitation=bright;
			}
			const lo=bassFeed?48:CRYSTAL_MIDI_LOW;
			const hi=bassFeed?71:CRYSTAL_MIDI_HIGH;
			for(let midi=lo;midi<=hi;midi++){
				const band=node(ctx.createBiquadFilter());band.type='bandpass';
				band.frequency.value=crystalHz(midi);band.Q.value=bassFeed?12:23;
				const trim=node(ctx.createGain());trim.gain.value=bassFeed?.45:.115;
				excitation.connect(band);band.connect(trim);trim.connect(modal);
			}
			const delay=node(ctx.createDelay(.4));delay.delayTime.value=.116;
			const damping=node(ctx.createBiquadFilter());
			damping.type='lowpass';damping.frequency.value=4800;damping.Q.value=.65;
			const feedback=node(ctx.createGain());feedback.gain.value=.69;
			modal.connect(delay);delay.connect(damping);damping.connect(feedback);
			feedback.connect(delay);
			const modalMix=node(ctx.createGain());
			modal.connect(modalMix);delay.connect(modalMix);
			const bloom=node(ctx.createGain());bloom.gain.value=1;
			modalMix.connect(bloom);
			const wet=node(ctx.createGain());bloom.connect(wet);
			// A distinctly airborne *bright crystal shimmer*, not just drums
			// disappearing or the entire song becoming louder. Only the
			// source-fed modal wet path excites these upper harmonics.
			const airyDrive=node(ctx.createGain());airyDrive.gain.value=2.0;
			const sparkle=node(ctx.createWaveShaper());
			sparkle.curve=saturatorCurve(.035);sparkle.oversample='2x';
			const sparkleHi=node(ctx.createBiquadFilter());
			sparkleHi.type='highpass';sparkleHi.frequency.value=950;
			const sparkleDelay=node(ctx.createDelay(.35));sparkleDelay.delayTime.value=.173;
			const sparkleGain=node(ctx.createGain());sparkleGain.gain.value=0;
			modalMix.connect(airyDrive);airyDrive.connect(sparkle);
			sparkle.connect(sparkleHi);sparkleHi.connect(sparkleDelay);
			sparkleDelay.connect(sparkleGain);sparkleGain.connect(wet);
			// Limiter ONLY on newly generated crystal wash, never on the
			// protected dry instrument path or song clock.
			const wetLimiter=node(ctx.createDynamicsCompressor());
			wetLimiter.threshold.value=-16;wetLimiter.knee.value=8;
			wetLimiter.ratio.value=4;wetLimiter.attack.value=.008;
			wetLimiter.release.value=.19;
			wet.connect(wetLimiter);wetLimiter.connect(output);
			let strength=clamp(raw.strength,0,2,1.5);
			let openness=clamp(raw.openness,0,1,0);
			let airBloom=clamp(raw.airBloom,0,2.5,1.6);
			const apply=(at,immediate=false)=>{
				// Ground remains exactly the owner-liked 150%-resonance mix.
				// Takeoff opens wet tail, increases bright harmonics and makes
				// sustained modes ring longer even if drums are left unchanged.
				const level=(.55+1.08*openness)*strength;
				const pairs=[[wet.gain,level],[dry.gain,1],
					[sparkleGain.gain,openness*airBloom*.85],
					[feedback.gain,.60+.18*openness],
					[damping.frequency,4800+2100*openness]];
				for(const [target,value] of pairs){
					if(immediate)target.value=value;
					else numericParam(target,value,at,.12);
				}
			};
			apply(ctx.currentTime,true);
			refs.openness={set:(value,at)=>{
				if(!Number.isFinite(value))return false;
				openness=clamp(value,0,1,0);apply(at);return true;
			}};
			refs.strength={set:(value,at)=>{
				if(!Number.isFinite(value))return false;
				strength=clamp(value,0,2,1.5);apply(at);return true;
			}};
			refs.airBloom={set:(value,at)=>{
				if(!Number.isFinite(value))return false;
				airBloom=clamp(value,0,2.5,1.6);apply(at);return true;
			}};
			// Spectral monitoring only on the source bass stem. It is sampled
			// during genuine landing events, not per frame. Without confident
			// CURRENT source pitches, don't launch any pitched crystal tone.
			let monitor=null, spectrum=null, lastNotes=[];
			if(raw.detectChroma===true&&typeof ctx.createAnalyser==='function'){
				monitor=node(ctx.createAnalyser());monitor.fftSize=4096;
				monitor.smoothingTimeConstant=.52;
				// Tiny nonzero monitor return prevents browsers from optimizing away
				// the otherwise-silent analyser branch. -140dB is inaudible.
				const silent=node(ctx.createGain());silent.gain.value=1e-7;
				input.connect(monitor);monitor.connect(silent);silent.connect(output);
				spectrum=new Float32Array(monitor.frequencyBinCount);
			}
			const scan=()=>{
				if(!monitor||typeof monitor.getFloatFrequencyData!=='function'){
					lastNotes=[];return lastNotes;
				}
				monitor.getFloatFrequencyData(spectrum);
				lastNotes=confidentCrystalNotes(spectrum,{sampleRate:ctx.sampleRate,
					fftSize:monitor.fftSize,maxNotes:2});
				return lastNotes;
			};
			refs.chroma={read:()=>scan(),get last(){return lastNotes;}};
			const active=new Set();
			const disposeTone=(entry)=>{
				try{entry.source.disconnect();}catch{}
				try{entry.gain.disconnect();}catch{}
				active.delete(entry);
			};
			refs.impact={set:(value,at)=>{
				const impulse=clamp(value,0,1,0);
				if(impulse<=0)return false;
				const now=Math.max(ctx.currentTime,Number.isFinite(at)?at:ctx.currentTime);
				// Always swell the source-fed modes at physical impact. If the
				// source is silent this cannot manufacture a fake crystal chord.
				bloom.gain.cancelScheduledValues(now);
				bloom.gain.setTargetAtTime(1+impulse*.95,now,.02);
				bloom.gain.setTargetAtTime(1,now+.13,.27);
				const selected=scan();
				for(let i=0;i<selected.length;i++){
					if(active.size>=4){const old=active.values().next().value;
						try{old.source.stop();}catch{}disposeTone(old);}
					const source=ctx.createOscillator(),gain=ctx.createGain();
					source.type='sine';source.frequency.value=selected[i].hz;
					const offset=.055*i;
					gain.gain.value=0;
					gain.gain.setValueAtTime(0,now+offset);
					gain.gain.setTargetAtTime((.022+.026*impulse)*Math.max(.2,selected[i].confidence),
						now+offset,.018);
					gain.gain.setTargetAtTime(0,now+offset+.13,.27);
					source.connect(gain);gain.connect(output);
					const entry={source,gain};active.add(entry);
					source.onended=()=>disposeTone(entry);
					source.start(now+offset);
					source.stop(now+offset+1.4);
				}
				return true;
			}};
			disposers.push(()=>{for(const entry of active){
				try{entry.source.stop();}catch{}disposeTone(entry);
			}});
			break;
		}
		case 'sugarfizz': {
			// Candy Cane Canyon: original recorded stems always remain at
			// UNITY dry gain. Sugar Rush is the real SPEED/airborne mechanic.
			// Add only source-excited bright/fizzy accents: no MIDI rewrite,
			// no invented tempo grid and no new tuned melody.
			const dry=node(ctx.createGain());dry.gain.value=1;
			input.connect(dry);dry.connect(output);
			const sweet=node(ctx.createBiquadFilter());sweet.type='bandpass';
			sweet.frequency.value=3400;sweet.Q.value=.85;
			const candyGain=node(ctx.createGain());
			input.connect(sweet);sweet.connect(candyGain);candyGain.connect(output);
			const brittle=node(ctx.createBiquadFilter());brittle.type='highpass';
			brittle.frequency.value=5400;brittle.Q.value=.65;
			const fizzGain=node(ctx.createGain());
			input.connect(brittle);brittle.connect(fizzGain);fizzGain.connect(output);
			const fizzOsc=node(ctx.createOscillator());fizzOsc.type='sine';fizzOsc.frequency.value=2;
			const fizzyTrem=node(ctx.createGain());fizzyTrem.gain.value=.03;
			fizzOsc.connect(fizzyTrem);fizzyTrem.connect(fizzGain.gain);
			fizzOsc.start();lfos.push(fizzOsc);
			let speed=clamp(raw.speed,0,1,0);
			let airborne=raw.airborne===true;
			let sweetness=clamp(raw.sweetness,0,2,1.25);
			let fizz=clamp(raw.fizz,0,2,1.5);
			let popLevel=clamp(raw.popLevel,0,2,1.3);
			let wrapperLevel=clamp(raw.wrapperLevel,0,2,.9);
			const apply=(at,immediate=false)=>{
				// Low speed = lighter sugar coating. Fast actual sled =
				// sweet sparkle, fizzy high frequencies and faster bubbles.
				const envelope=.14+.77*speed;
				for(const [target,value] of [
					[candyGain.gain,sweetness*envelope],
					[fizzGain.gain,fizz*(.045+.36*speed)*(airborne?.55:1)],
					[fizzOsc.frequency,1.7+speed*11],
					[fizzyTrem.gain,.02+.06*fizz*speed],
					[sweet.frequency,2900+2200*speed],
					[brittle.frequency,airborne?3900:5300]]){
					if(immediate)target.value=value;
					else numericParam(target,value,at,.10);
				}
			};
			apply(ctx.currentTime,true);
			const control=(key,low,hi,def,setValue)=>{
				refs[key]={set:(v,at)=>{if(!Number.isFinite(v))return false;
					setValue(clamp(v,low,hi,def));apply(at);return true;}};
			};
			control('speed',0,1,0,v=>speed=v);
			control('sweetness',0,2,1.25,v=>sweetness=v);
			control('fizz',0,2,1.5,v=>fizz=v);
			refs.airborne={set:(v,at)=>{if(typeof v!=='boolean'&&v!==0&&v!==1)return false;
				airborne=!!v;apply(at);return true;}};
			refs.popLevel={set:v=>{if(!Number.isFinite(v))return false;
				popLevel=clamp(v,0,2,1.3);return true;}};
			refs.wrapperLevel={set:v=>{if(!Number.isFinite(v))return false;
				wrapperLevel=clamp(v,0,2,.9);return true;}};
			const makeEvent=kind=>{
				const duration=kind==='pop'?.51:.24;
				const frames=Math.ceil(ctx.sampleRate*duration);
				const buffer=ctx.createBuffer(1,frames,ctx.sampleRate);
				const data=buffer.getChannelData(0);
				let seed=kind==='pop'?0x5A9A3253:0xE1A55AC9,smoothed=0;
				for(let i=0;i<frames;i++){
					const t=i/ctx.sampleRate;
					seed=(Math.imul(seed,1664525)+1013904223)>>>0;
					const white=seed/2147483648-1;
					smoothed=.9*smoothed+.1*white;
					let value=0;
					if(kind==='pop'){
						// A handful of candy-crackle bursts, not a sampled beat,
						// pitched musical sequence or sticky Garbage SPLORP.
						const thunk=.26*Math.sin(2*Math.PI*(205*t-135*t*t))*Math.exp(-t*26);
						let pops=0;
						for(const [lag,weight] of [[0,1],[.048,.73],[.105,.51],[.183,.31],[.289,.18]]){
							if(t<lag)continue;
							const age=t-lag;
							pops+=weight*(white*.65-smoothed*.18)*Math.exp(-age*90);
						}
						value=thunk+pops*.7;
					}else{
						// Short crinkle of brittle cellophane on *real* takeoff.
						const sharp=(white-smoothed)*Math.exp(-t*30);
						const tear=(Math.sin(2*Math.PI*(860*t-100*t*t)))*Math.exp(-t*39);
						value=.63*sharp+.09*tear;
					}
					data[i]=Math.tanh(value*.86);
				}
				return buffer;
			};
			const pop=makeEvent('pop'),wrap=makeEvent('wrapper');
			const voices=new Set();
			const release=item=>{
				if(!voices.delete(item))return;
				try{item.source.disconnect();}catch{}
				try{item.gain.disconnect();}catch{}
			};
			const trigger=(kind,value,at)=>{
				if(!Number.isFinite(value)||value<=0)return false;
				const weight=kind==='pop'?popLevel:wrapperLevel;
				if(weight<=0)return false;
				if(voices.size>=3){const old=voices.values().next().value;
					try{old.source.stop();}catch{}release(old);}
				const source=ctx.createBufferSource(),gain=ctx.createGain();
				source.buffer=kind==='pop'?pop:wrap;
				gain.gain.value=Math.min(1.4,(kind==='pop'?.68:.46)*weight*
					(.3+.7*clamp(value,0,1,0)));
				source.connect(gain);gain.connect(output);
				const voice={source,gain};voices.add(voice);
				source.onended=()=>release(voice);
				source.start(Math.max(ctx.currentTime,Number.isFinite(at)?at:ctx.currentTime));
				return true;
			};
			refs.pop={set:(v,at)=>trigger('pop',v,at)};
			refs.wrapper={set:(v,at)=>trigger('wrapper',v,at)};
			disposers.push(()=>{for(const voice of [...voices]){
				try{voice.source.stop();}catch{}release(voice);
			}});
			break;
		}
		case 'ventforge': {
			// Original recording stays on a unity dry path. Geothermal
			// rumble and rising hot-air shimmer are source-excited.
			const dry=node(ctx.createGain());dry.gain.value=1;
			input.connect(dry);dry.connect(output);
			const low=node(ctx.createBiquadFilter());low.type='lowpass';low.frequency.value=480;
			const grit=node(ctx.createWaveShaper());grit.curve=saturatorCurve(.14);grit.oversample='2x';
			const ground=node(ctx.createGain());
			input.connect(low);low.connect(grit);grit.connect(ground);ground.connect(output);
			const air=node(ctx.createBiquadFilter());air.type='bandpass';
			air.frequency.value=1300;air.Q.value=.75;
			const hot=node(ctx.createGain());
			input.connect(air);air.connect(hot);hot.connect(output);
			const lfo=node(ctx.createOscillator());lfo.type='sine';lfo.frequency.value=7.3;
			const depth=node(ctx.createGain());depth.gain.value=.10;
			lfo.connect(depth);depth.connect(hot.gain);lfo.start();lfos.push(lfo);
			let rumble=clamp(raw.rumble,0,2,1.25);
			let shimmer=clamp(raw.shimmer,0,2,1.25);
			let blast=clamp(raw.blast,0,2,1.3);
			let crust=clamp(raw.crust,0,2,.8);
			let updraft=clamp(raw.updraft,0,1,0);
			const apply=(at,instant=false)=>{
				for(const [target,value] of [
					[ground.gain,.10*rumble],
					[low.frequency,480+300*updraft],
					[hot.gain,shimmer*(.1+.32*updraft)],
					[depth.gain,.04+.07*shimmer],
					[air.frequency,1100+2200*updraft]]){
					if(instant)target.value=value;
					else numericParam(target,value,at,.085);
				}
			};
			apply(ctx.currentTime,true);
			const control=(key,lo,hi,fallback,setter)=>{
				refs[key]={set:(v,at)=>{if(!Number.isFinite(v))return false;
					setter(clamp(v,lo,hi,fallback));apply(at);return true;}};
			};
			control('rumble',0,2,1.25,v=>rumble=v);
			control('shimmer',0,2,1.25,v=>shimmer=v);
			control('updraft',0,1,0,v=>updraft=v);
			refs.blast={set:v=>{if(!Number.isFinite(v))return false;blast=clamp(v,0,2,1.3);return true;}};
			refs.crust={set:v=>{if(!Number.isFinite(v))return false;crust=clamp(v,0,2,.8);return true;}};
			// Physical geyser eruption and real touchdown: short deterministic
			// reusable buffers, no song notes, RNG or separate beat grid.
			const makeEvent=kind=>{
				const frames=Math.ceil(ctx.sampleRate*(kind==='eruption'?.86:.34));
				const buffer=ctx.createBuffer(1,frames,ctx.sampleRate);
				const data=buffer.getChannelData(0);
				let seed=kind==='eruption'?0xE123A517:0xC2A57117,filtered=0;
				for(let i=0;i<frames;i++){
					const t=i/ctx.sampleRate;
					seed=(Math.imul(seed,1664525)+1013904223)>>>0;
					const white=seed/2147483648-1;
					filtered=.95*filtered+.05*white;
					let sample=0;
					if(kind==='eruption'){
						const envelope=(1-Math.exp(-t*65))*Math.exp(-t*4.5);
						const sub=Math.sin(2*Math.PI*(95*t-32*t*t))*Math.exp(-t*7);
						const whistle=Math.sin(2*Math.PI*(320*t+245*t*t))*Math.exp(-t*9);
						sample=.51*sub+envelope*(.53*white+.62*filtered+.14*whistle);
					}else{
						sample=.34*Math.sin(2*Math.PI*(155*t-105*t*t))*Math.exp(-t*27);
						for(const lag of [0,.029,.066,.119]){
							if(t<lag)continue;
							const dt=t-lag;
							sample+=(.18*white+.07*Math.sin(2*Math.PI*730*dt))*Math.exp(-dt*92);
						}
					}
					data[i]=Math.tanh(sample*.84);
				}
				return buffer;
			};
			const erupt=makeEvent('eruption'),rocks=makeEvent('rocks');
			const voices=new Set();
			const cleanup=item=>{
				if(!voices.delete(item))return;
				try{item.source.disconnect();}catch{}
				try{item.gain.disconnect();}catch{}
			};
			const fire=(kind,strength,at)=>{
				if(!Number.isFinite(strength)||strength<=0)return false;
				const weight=kind==='eruption'?blast:crust;
				if(weight<=0)return false;
				if(voices.size>=3){const old=voices.values().next().value;
					try{old.source.stop();}catch{}cleanup(old);}
				const source=ctx.createBufferSource(),gain=ctx.createGain();
				source.buffer=kind==='eruption'?erupt:rocks;
				gain.gain.value=Math.min(1.4,(kind==='eruption'?.55:.72)*weight*
					(.25+.75*clamp(strength,0,1,0)));
				source.connect(gain);gain.connect(output);
				const item={source,gain};voices.add(item);
				source.onended=()=>cleanup(item);
				source.start(Math.max(ctx.currentTime,Number.isFinite(at)?at:ctx.currentTime));
				return true;
			};
			refs.eruption={set:(v,at)=>fire('eruption',v,at)};
			refs.crustImpact={set:(v,at)=>fire('rocks',v,at)};
			disposers.push(()=>{for(const voice of [...voices]){
				try{voice.source.stop();}catch{}cleanup(voice);
			}});
			break;
		}
		case 'jellybloom': {
			// Sky Jellyfish Mountain: an elastic, diaphanous *source-fed*
			// stereo chorus on the actual original recorded instrument.
			// No new score, harmonic notes, tempo clock or extra melody.
			const dry=node(ctx.createGain());dry.gain.value=1;
			input.connect(dry);dry.connect(output);
			const hip=node(ctx.createBiquadFilter());hip.type='highpass';hip.frequency.value=130;
			const low=node(ctx.createBiquadFilter());low.type='lowpass';low.Q.value=.63;
			input.connect(hip);hip.connect(low);
			const taps=[],drifts=[];
			let floatRate=clamp(raw.floatRate,.25,2.0,1);
			for(let i=0;i<2;i++){
				const delay=node(ctx.createDelay(.12));delay.delayTime.value=i? .047:.028;
				const trem=node(ctx.createGain());
				const pan=node(ctx.createStereoPanner());pan.pan.value=i?.58:-.58;
				const drift=node(ctx.createOscillator());drift.type='sine';
				drift.frequency.value=(i?.43:.33)*floatRate;
				const modulation=node(ctx.createGain());modulation.gain.value=i?.005:.004;
				drift.connect(modulation);modulation.connect(delay.delayTime);
				drift.start();lfos.push(drift);drifts.push(drift);
				low.connect(delay);delay.connect(trem);trem.connect(pan);pan.connect(output);
				taps.push(trem);
			}
			let airborne=raw.airborne===true;
			let buoyancy=clamp(raw.buoyancy,0,2,1.35);
			let spring=clamp(raw.spring,0,2,1.3);
			let liftLevel=clamp(raw.liftLevel,0,2,.95);
			const apply=(at,immediate=false)=>{
				const values=[[low.frequency,airborne?12500:4700],
					...taps.map((tap,i)=>[tap.gain,
						(airborne?.37:.19)*buoyancy*(i?.75:1)])];
				for(const [target,value] of values){
					if(immediate)target.value=value;
					else numericParam(target,value,at,airborne?.14:.2);
				}
			};
			apply(ctx.currentTime,true);
			refs.airborne={set:(v,at)=>{
				if(typeof v!=='boolean'&&v!==0&&v!==1)return false;
				airborne=!!v;apply(at);return true;}};
			refs.buoyancy={set:(v,at)=>{if(!Number.isFinite(v))return false;
				buoyancy=clamp(v,0,2,1.35);apply(at);return true;}};
			refs.floatRate={set:(v,at)=>{if(!Number.isFinite(v))return false;
				floatRate=clamp(v,.25,2,1);
				for(let i=0;i<drifts.length;i++)numericParam(drifts[i].frequency,(i?.43:.33)*floatRate,at,.1);
				return true;}};
			refs.spring={set:v=>{if(!Number.isFinite(v))return false;
				spring=clamp(v,0,2,1.3);return true;}};
			refs.liftLevel={set:v=>{if(!Number.isFinite(v))return false;
				liftLevel=clamp(v,0,2,.95);return true;}};
			// One deterministic elastic membrane and gentle jelly-gel lift
			// waveform each, rendered once per graph. Physical event samples
			// *may* sound with quiet stems; never fabricate musical rhythm.
			const makeEvent=kind=>{
				const duration=kind==='impact'?.77:.39;
				const frames=Math.ceil(ctx.sampleRate*duration);
				const buffer=ctx.createBuffer(1,frames,ctx.sampleRate);
				const data=buffer.getChannelData(0);
				let seed=kind==='impact'?0xB011C310:0xA11F5EA5,lowNoise=0;
				for(let i=0;i<frames;i++){
					const t=i/ctx.sampleRate;
					seed=(Math.imul(seed,1664525)+1013904223)>>>0;
					const white=seed/2147483648-1;
					lowNoise=.93*lowNoise+.07*white;
					let value=0;
					if(kind==='impact'){
						// A downward-sliding elastic resonator with two increasingly
						// quiet gelatin reverberations, *not* a scale/note line.
						const membrane=Math.sin(2*Math.PI*(252*t-92*t*t))
							+.26*Math.sin(2*Math.PI*(415*t-151*t*t));
						const decay=Math.exp(-t*10.2);
						let after=0;
						for(const [delay,amplitude] of [[.14,.26],[.305,.1]]){
							if(t<delay)continue;
							const dt=t-delay;
							after+=amplitude*Math.sin(2*Math.PI*(220*dt-64*dt*dt))*Math.exp(-dt*14);
						}
						value=(membrane*decay*.68+after+lowNoise*Math.exp(-t*37)*.17);
					}else{
						const rise=Math.min(1,t/.038),fade=Math.exp(-t*11);
						const float=Math.sin(2*Math.PI*(165*t+215*t*t))*.18;
						const wispy=(white-lowNoise)*.22+lowNoise*.36;
						value=(float+wispy)*rise*fade;
					}
					data[i]=Math.tanh(value*.86);
				}
				return buffer;
			};
			const impactBuffer=makeEvent('impact');
			const liftBuffer=makeEvent('lift');
			const voices=new Set();
			const releaseVoice=voice=>{if(!voices.delete(voice))return;
				try{voice.source.disconnect();}catch{}
				try{voice.level.disconnect();}catch{}
			};
			const fire=(kind,value,at)=>{
				if(!Number.isFinite(value)||value<=0)return false;
				const weight=kind==='impact'?spring:liftLevel;
				if(weight<=0)return false;
				if(voices.size>=3){const old=voices.values().next().value;
					try{old.source.stop();}catch{}releaseVoice(old);}
				const source=ctx.createBufferSource(),level=ctx.createGain();
				source.buffer=kind==='impact'?impactBuffer:liftBuffer;
				level.gain.value=Math.min(1.6,(kind==='impact'?.32:.22)*
					(.25+.75*clamp(value,0,1,0))*weight);
				source.connect(level);level.connect(output);
				const voice={source,level};voices.add(voice);
				source.onended=()=>releaseVoice(voice);
				source.start(Math.max(ctx.currentTime,Number.isFinite(at)?at:ctx.currentTime));
				return true;
			};
			refs.impact={set:(v,at)=>fire('impact',v,at)};
			refs.lift={set:(v,at)=>fire('lift',v,at)};
			disposers.push(()=>{for(const voice of [...voices]){
				try{voice.source.stop();}catch{}releaseVoice(voice);
			}});
			break;
		}
		case 'steamworks': {
			// Steampunk Slopes: the ORIGINAL recorded waveform drives every
			// rolling gear and piston pulse, never a new MIDI/percussion grid.
			// A separate short physical steam vent / landing gear clash may
			// sound between recorded attacks, but only on real motion edges.
			const dry=node(ctx.createGain()); dry.gain.value=1;
			input.connect(dry); dry.connect(output);
			const band=node(ctx.createBiquadFilter());band.type='bandpass';
			band.frequency.value=540;band.Q.value=.7;
			const color=node(ctx.createWaveShaper());
			color.curve=saturatorCurve(.075);color.oversample='2x';
			const wet=node(ctx.createGain());
			input.connect(band);band.connect(color);color.connect(wet);wet.connect(output);
			const motor=node(ctx.createOscillator());motor.type='sine';
			const pulse=node(ctx.createGain());
			motor.connect(pulse);pulse.connect(wet.gain);
			motor.start();lfos.push(motor);
			const roleWeight=clamp(raw.weight,.1,1.2,.7);
			let speed=clamp(raw.speed,0,1,0),airborne=raw.airborne===true;
			let intensity=clamp(raw.intensity,0,2,1);
			let steam=clamp(raw.steam,0,2,1);
			let impactWeight=clamp(raw.impactWeight,0,2,1);
			let accentWeight=clamp(raw.accentWeight,0,2,1);
			const apply=(at,instant=false)=>{
				// Chuff frequency follows actual sled speed, NOT the beat grid.
				// Flight disengages the drive belt but preserves the dry music.
				const coupling=airborne?.07:1;
				const amount=roleWeight*intensity*coupling*(.10+.68*speed);
				const values=[[motor.frequency,1.5+8.4*speed],
					[wet.gain,amount],[pulse.gain,amount*.42],
					[band.frequency,400+390*speed+(airborne?450:0)]];
				for(const [target,value] of values){
					if(instant)target.value=value;
					else numericParam(target,value,at,.065);
				}
			};
			apply(ctx.currentTime,true);
			refs.speed={set:(v,at)=>{if(!Number.isFinite(v))return false;
				speed=clamp(v,0,1,0);apply(at);return true;}};
			refs.airborne={set:(v,at)=>{if(typeof v!=='boolean'&&v!==0&&v!==1)return false;
				airborne=!!v;apply(at);return true;}};
			refs.intensity={set:(v,at)=>{if(!Number.isFinite(v))return false;
				intensity=clamp(v,0,2,1);apply(at);return true;}};
			refs.steam={set:v=>{if(!Number.isFinite(v))return false;
				steam=clamp(v,0,2,1);return true;}};
			refs.impactWeight={set:v=>{if(!Number.isFinite(v))return false;
				impactWeight=clamp(v,0,2,1);return true;}};
			refs.accentWeight={set:v=>{if(!Number.isFinite(v))return false;
				accentWeight=clamp(v,0,2,1);return true;}};

			// Precompute bounded source-independent mechanical Foley only once
			// per graph. Deterministic samples, no oscillators/timers per frame.
			const makeBuffer=(seconds,kind)=>{
				const frames=Math.ceil(ctx.sampleRate*seconds);
				const buffer=ctx.createBuffer(1,frames,ctx.sampleRate);
				const data=buffer.getChannelData(0);
				let seed=kind==='vent'?0x5EA5C113:0x6EA2C014;
				let low=0;
				for(let i=0;i<frames;i++){
					const t=i/ctx.sampleRate;
					seed=(Math.imul(seed,1664525)+1013904223)>>>0;
					const white=seed/2147483648-1;
					let sound=0;
					if(kind==='vent'){
						// Rising steam pressure jets from a narrow valve, ending
						// with a crisp pressure release. Not a tonal glissando.
						low=.91*low+.09*white;
						const hiss=(white-low)*.55+low*.65;
						const open=Math.min(1,t/.016);
						const decay=Math.exp(-t*8.5);
						const lip=.18*Math.sin(2*Math.PI*255*(t-.11))*(t>=.11?Math.exp(-(t-.11)*48):0);
						sound=hiss*open*decay*.85+lip;
					} else {
						// Gear teeth bite, big bell-metal cavity, short uneven
						// sprocket rattle: mechanically inharmonic, not a song note.
						const clang=.46*Math.sin(2*Math.PI*310*t)*Math.exp(-t*16)
							+.27*Math.sin(2*Math.PI*681*t)*Math.exp(-t*22)
							+.15*Math.sin(2*Math.PI*1139*t)*Math.exp(-t*36);
						const thunk=.36*Math.sin(2*Math.PI*(155*t-125*t*t))*Math.exp(-t*29);
						let clicks=0;
						for(const offset of [0,.039,.083,.148]){
							const dt=t-offset;if(dt<0)continue;
							clicks+=(.19*white+.12*Math.sin(2*Math.PI*1430*dt))*Math.exp(-dt*108);
						}
						sound=clang+thunk+clicks;
					}
					data[i]=Math.tanh(sound*.88);
				}
				return buffer;
			};
			const vent=makeBuffer(.42,'vent'),clash=makeBuffer(.36,'clash');
			// Tiny actual-recording-accent sprocket tooth. Unlike the landing
			// clash this is a short dry tick (not a note or unverified metronome).
			// Nothing is scheduled unless real original-mix energy rises enough
			// to trip the same WorldDance visual accent envelope.
			const tooth=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.092),ctx.sampleRate);
			const teeth=tooth.getChannelData(0);
			let toothSeed=0x7E371A11;
			for(let i=0;i<teeth.length;i++){
				const t=i/ctx.sampleRate;
				toothSeed=(Math.imul(toothSeed,1664525)+1013904223)>>>0;
				const noise=toothSeed/2147483648-1;
				teeth[i]=Math.tanh((.52*Math.sin(2*Math.PI*1020*t)
					+.25*Math.sin(2*Math.PI*1930*t)+.26*noise)*Math.exp(-t*91));
			}
			const active=new Set();
			const cleanup=item=>{
				try{item.source.disconnect();}catch{}
				try{item.gain.disconnect();}catch{}
				active.delete(item);
			};
			const fire=(kind,strength,at)=>{
				if(!Number.isFinite(strength)||strength<=0)return false;
				const factor=kind==='vent'?steam:impactWeight;
				if(factor<=0)return false;
				if(active.size>=3){const oldest=active.values().next().value;
					try{oldest.source.stop();}catch{}cleanup(oldest);}
				const source=ctx.createBufferSource(),gain=ctx.createGain();
				source.buffer=kind==='vent'?vent:clash;
				gain.gain.value=Math.min(1.7,(kind==='vent'?.21+.33*clamp(strength,0,1,0):
					.26+.44*clamp(strength,0,1,0))*factor);
				source.connect(gain);gain.connect(output);
				const item={source,gain};active.add(item);
				source.onended=()=>cleanup(item);
				source.start(Math.max(ctx.currentTime,Number.isFinite(at)?at:ctx.currentTime));
				return true;
			};
			refs.release={set:(value,at)=>fire('vent',value,at)};
			refs.impact={set:(value,at)=>fire('clash',value,at)};
			refs.musicAccent={set:(value,at)=>{
				if(!Number.isFinite(value)||value<=0||accentWeight<=0||airborne||speed<.08)return false;
				if(active.size>=3){const old=active.values().next().value;
					try{old.source.stop();}catch{}cleanup(old);}
				const source=ctx.createBufferSource(),gain=ctx.createGain();
				source.buffer=tooth;
				gain.gain.value=Math.min(.55,(.06+.19*clamp(value,0,1,0))*accentWeight);
				source.connect(gain);gain.connect(output);
				const item={source,gain};active.add(item);
				source.onended=()=>cleanup(item);
				source.start(Math.max(ctx.currentTime,Number.isFinite(at)?at:ctx.currentTime));
				return true;
			}};
			disposers.push(()=>{for(const item of active){
				try{item.source.stop();}catch{}cleanup(item);
			}});
			break;
		}
		case 'microbox': {
			// Five original instrument stems become an RC-diorama soundtrack:
			// compact, band-limited resonant plastic enclosure on the ground;
			// when the rider flies, the virtual lid opens and reflections decay.
			const hip = node(ctx.createBiquadFilter()), lop = node(ctx.createBiquadFilter());
			hip.type='highpass';hip.Q.value=.707;
			lop.type='lowpass';lop.Q.value=.83;
			const direct = node(ctx.createGain());
			input.connect(hip);hip.connect(lop);lop.connect(direct);direct.connect(output);
			const taps=[];
			for (const [seconds,level] of [[.011,.58],[.026,.37]]) {
				const delay=node(ctx.createDelay(.1));delay.delayTime.value=seconds;
				const tap=node(ctx.createGain());
				lop.connect(delay);delay.connect(tap);tap.connect(output);
				taps.push({tap,level});
			}
			let boxiness=clamp(raw.boxiness,0,1.8,1.35);
			let openness=clamp(raw.openness,0,1,0);
			let impactWeight=clamp(raw.impactWeight,0,2,1);
			const apply=(at,immediate=false)=>{
				const closed=(1-openness)*boxiness;
				const params=[
					[hip.frequency,Math.max(75,90+320*closed)],
					[lop.frequency,Math.min(18000,16000*Math.pow(.22,closed))],
					[direct.gain,Math.min(2.3,1+.66*closed)],
					...taps.map(({tap,level})=>[tap.gain,level*closed*.35]),
				];
				for(const [param,value] of params){
					if(immediate)param.value=value;
					else numericParam(param,value,at,.07);
				}
			};
			apply(ctx.currentTime,true);
			refs.openness={set:(value,at)=>{
				if(!Number.isFinite(value))return false;
				openness=clamp(value,0,1,0);apply(at);return true;
			}};
			refs.boxiness={set:(value,at)=>{
				if(!Number.isFinite(value))return false;
				boxiness=clamp(value,0,1.8,1.35);apply(at);return true;
			}};
			refs.impactWeight={set:value=>{
				if(!Number.isFinite(value))return false;
				impactWeight=clamp(value,0,2,1);return true;
			}};
			// Distinct deterministic plastic-box shake at physical landing.
			// Not a new song note, and audible even between drum attacks.
			const length=Math.ceil(ctx.sampleRate*.32);
			const buffer=ctx.createBuffer(1,length,ctx.sampleRate);
			const samples=buffer.getChannelData(0);
			let seed=0xB0551234;
			for(let i=0;i<length;i++){
				const t=i/ctx.sampleRate;
				seed=(Math.imul(seed,1664525)+1013904223)>>>0;
				const hiss=(seed/2147483648-1);
				let clack=0;
				for(const lag of [0,.046,.107,.185]){
					const dt=t-lag;if(dt<0)continue;
					clack+=(.32*Math.sin(2*Math.PI*(420*dt-210*dt*dt))+.15*hiss)
						*Math.exp(-dt*68);
				}
				samples[i]=Math.tanh(clack*.84);
			}
			const active=new Set();
			refs.impact={set:(value,at)=>{
				const strength=clamp(value,0,1,0);
				if(strength<=0)return false;
				if(active.size>=3){const old=active.values().next().value;
					try{old.source.stop();}catch{}old.cleanup();}
				const source=ctx.createBufferSource(),gain=ctx.createGain();
				source.buffer=buffer;gain.gain.value=Math.min(1.2,(.13+.24*strength)*impactWeight);
				source.connect(gain);gain.connect(output);
				const item={source,cleanup(){try{source.disconnect();}catch{}
					try{gain.disconnect();}catch{}active.delete(item);}};
				active.add(item);source.onended=()=>item.cleanup();
				source.start(Math.max(ctx.currentTime,Number.isFinite(at)?at:ctx.currentTime));return true;
			}};
			disposers.push(()=>{for(const item of active){
				try{item.source.stop();}catch{}item.cleanup();
			}});
			break;
		}
		case 'hydrostatic': {
			// Warm physical hydrostatic envelope over the ORIGINAL recording.
			// Pressure is accumulated by HydrostaticPressure outside the FX graph;
			// this graph owns only instantaneous audible presentation.
			const dry = node(ctx.createGain()), wet = node(ctx.createGain());
			const low = node(ctx.createBiquadFilter()), low2 = node(ctx.createBiquadFilter());
			const warmth = node(ctx.createBiquadFilter());
			for (const f of [low,low2]) { f.type='lowpass'; f.Q.value=.707; }
			warmth.type='peaking'; warmth.frequency.value=320; warmth.Q.value=.8;
			input.connect(dry); dry.connect(output);
			input.connect(low); low.connect(low2); low2.connect(warmth);
			warmth.connect(wet); wet.connect(output);
			const sensitivity = clamp(raw.sensitivity, .3, 1, 1);
			let contrast = clamp(raw.contrast, .6, 2.2, 1.9);
			let waveStrength = clamp(raw.waveStrength, 0, 2.4, .6);
			let currentPressure = clamp(raw.pressure, 0, 1, 0);
			const apply = (p,at,immediate=false) => {
				currentPressure = clamp(p,0,1,0);
				const pressure = currentPressure*sensitivity;
				// The former deep sound leaked 26% of the entire dry signal and
				// reached only ~1.3kHz. More distinct enclosed/pressure character:
				// deep: a filtered wet performance with tiny intelligibility anchor,
				// rising: brisk, reversible brightening. Depth still remains monotonic
				// in HydrostaticPressure; this slider adjusts timbre, NOT memory.
				const cutoff = 14000*Math.pow(.06,Math.pow(pressure,.85)*(.65+.38*contrast));
				const dryAnchor = Math.max(.035,1-pressure*(.84+.05*contrast));
				const settings = [[dry.gain,dryAnchor],[wet.gain,pressure*(.92+.06*(contrast-1))],
					[low.frequency,cutoff],[low2.frequency,cutoff*1.12],
					[warmth.gain,pressure*(3.5+contrast)]];
				for (const [param,value] of settings) {
					if (immediate) param.value=value;
					else numericParam(param,value,at,.065);
				}
			};
			apply(currentPressure,ctx.currentTime,true);
			refs.pressure={set:(value,at)=>{
				if (!Number.isFinite(value)) return false;
				apply(value,at);
				return true;
			}};
			refs.contrast={set:(value,at)=>{
				if (!Number.isFinite(value)) return false;
				contrast=clamp(value,.6,2.2,1.9);
				apply(currentPressure,at);
				return true;
			}};
			refs.waveStrength={set:value=>{
				if (!Number.isFinite(value)) return false;
				waveStrength=clamp(value,0,2.4,.6);
				return true;
			}};
			// Physically motivated pressure shock: low-mid water-hammer thump,
			// a noisy accelerating rush, then five separating air bubbles.
			// A deeper 95Hz-only tick was invisible under five original stems;
			// the 140–500Hz body is audible on ordinary speakers, too.
			// Deterministic, derived Foley; never an extra musical instrument.
			const length=Math.ceil(ctx.sampleRate*.58);
			const wave=ctx.createBuffer(1,length,ctx.sampleRate);
			const data=wave.getChannelData(0);
			let seed=0x735EA123,wetNoise=0;
			for(let i=0;i<length;i++) {
				const t=i/ctx.sampleRate;
				seed=(Math.imul(seed,1664525)+1013904223)>>>0;
				const noise=seed/2147483648-1;
				wetNoise=wetNoise*.78+noise*.22;
				const thump=.74*Math.sin(2*Math.PI*(145*t-75*t*t))*Math.exp(-t*18);
				const bloom=.46*Math.sin(2*Math.PI*(300*t-110*t*t))*Math.exp(-t*15);
				const rush=(wetNoise*.44+noise*.13)*Math.exp(-t*12);
				let bubbles=0;
				for (const lag of [.067,.142,.224,.329,.427]) {
					const dt=t-lag;
					if (dt<0) continue;
					bubbles+=.32*Math.sin(2*Math.PI*(490*dt-580*dt*dt))
						*Math.exp(-dt*47);
				}
				data[i]=Math.tanh((thump+bloom+rush+bubbles)*.98);
			}
			const active=new Set();
			refs.impact={set:(value,at)=>{
				const strength=clamp(value,0,1,0);
				if(strength<=0) return false;
				if(active.size>=3) {
					const previous=active.values().next().value;
					try {previous.source.stop();}catch{}
					previous.cleanup();
				}
				const source=ctx.createBufferSource(),gain=ctx.createGain();
				source.buffer=wave;
				gain.gain.value=Math.min(1.9,(.30+.52*strength)*waveStrength);
				source.connect(gain);gain.connect(output);
				const entry={source,cleanup(){
					try{source.disconnect();}catch{}
					try{gain.disconnect();}catch{}
					active.delete(entry);
				}};
				active.add(entry);source.onended=()=>entry.cleanup();
				source.start(Math.max(ctx.currentTime,Number.isFinite(at)?at:ctx.currentTime));
				return true;
			}};
			disposers.push(()=>{for(const entry of active){
				try{entry.source.stop();}catch{}
				entry.cleanup();
			}});
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
		// Graphs being crossfaded out must remain owned even if the mixer
		// is destroyed before the delayed cleanup callback executes.
		this.retiringEffects = new Set();
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

	/** Read an ANALYSER readout only on explicit scheduled physical event. */
	readEffect(id,effectId,key){
		const ref=this.sources.get(id)?.chain?.find(effectId)?.refs?.[key];
		return typeof ref?.read==='function'?ref.read():null;
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
		const retired = { src, ...previous, timer: null };
		const cleanup = () => {
			if (!this.retiringEffects.delete(retired)) return;
			clearTimeout(retired.timer);
			this.timers.delete(retired.timer);
			try { retired.src.mix.disconnect(retired.chain.input); } catch {}
			retired.chain.dispose();
			try { retired.output.disconnect(); } catch {}
		};
		retired.cleanup = cleanup;
		this.retiringEffects.add(retired);
		retired.timer = setTimeout(cleanup, (fade + 0.15) * 1000);
		this.timers.add(retired.timer);
		// Rapid repeated switching must not leave unbounded overlapping
		// chains alive while their fades wait for a future wall-clock tick.
		const sourceRetiring = [...this.retiringEffects].filter(entry => entry.src === src);
		for (const old of sourceRetiring.slice(0, -3)) old.cleanup();
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
		// Clearing timers alone would strand previous fading effect graphs,
		// including any short oscillator/sample voices. Dispose them now.
		for (const retired of [...this.retiringEffects]) retired.cleanup();
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
