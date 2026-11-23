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
	'gain', 'filter', 'pan', 'distortion', 'delay', 'tremolo', 'ring', 'convolution', 'analyser', 'snowpack', 'scrapheap', 'hydrostatic', 'microbox', 'crystallattice',
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
			// Limiter ONLY on newly generated crystal wash, never on the
			// protected dry instrument path or song clock.
			const wetLimiter=node(ctx.createDynamicsCompressor());
			wetLimiter.threshold.value=-16;wetLimiter.knee.value=8;
			wetLimiter.ratio.value=4;wetLimiter.attack.value=.008;
			wetLimiter.release.value=.19;
			wet.connect(wetLimiter);wetLimiter.connect(output);
			let strength=clamp(raw.strength,0,2,1);
			let openness=clamp(raw.openness,0,1,0);
			const apply=(at,immediate=false)=>{
				const level=(.55+.80*openness)*strength;
				const pairs=[[wet.gain,level],[dry.gain,1-.075*openness]];
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
				strength=clamp(value,0,2,1);apply(at);return true;
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
