/**
 * Six-stem Web Audio jukebox; decoded chunks share one clock.
 * The master FLAC bank is never loaded by the browser.
 * Derived source keys (for example "voice:bitstream-bluffs") are allowed in packs.
 * Optional 'voice:<biome>' sources are mixed in dynamically when a pack provides them.
 */
import { CORE_STEMS, normalizeCatalog, normalizePack, resolveMusicAsset, fetchMusicAssetResponse } from './MusicPack.js';
import { StemFXMixer } from './MusicFXGraph.js';
import { AdaptiveBiomeRouter } from './AdaptiveBiomeRouter.js';
import { voiceSourceForBiome, HOME_BIOME } from './BiomeVoices.js';
import { canonicalBiomeId } from '../../data/biomeAliases.js';
import { captionAt, nextBeatTime, normalizeCaptions } from './CaptionSequencer.js';
import { FIRST_SONG_ID, defaultSongSelection, sanitizeSongSelection, nextEnabledSongIndex, enabledSongIndices, shuffledSongRound } from './MusicPlaylist.js';
import { melodyPreset, orchestraPreset } from './DynamicOrchestraPresets.js';
import { snowpackImpactFromLanding } from './SnowpackImpact.js';
import { contactFromMotion, impactFromLanding } from './MusicPhysicsSignals.js';
import { HydrostaticPressure } from './HydrostaticPressure.js';
import { ScrapPitchCadence } from './ScrapPitchCadence.js';
import { MicroBeeAudio } from './MicroBeeAudio.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const sleepSafe = (promise) => Promise.resolve(promise).catch(() => null);

export class StemMusicDirector {
	constructor(audio, catalogUrl = '/music/catalog.json') {
		this.audio = audio;
		this.catalogUrl = catalogUrl;
		this.catalog = [];
		this.songEnabled = defaultSongSelection();
		this.shuffleEnabled = false;
		this._shuffleRemaining = [];
		this.menuMode = false;
		this.bsodDanger = 0;
		this.dynamicOrchestra = false;
		this.speedPxS = 0;
		this._timbreSignatures = new Map();
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
		// Physical Debumont folder may still use the legacy spelling in
		// original archived music packs even though the logical ID is canonical.
		this._legacyDebutmontPacks = new Set();
		this.scheduled = new Set();
		this.inflight = new Map();
		this.biome = HOME_BIOME;
		this.vocals = false;
		this.musicCaptions = false;
		this.captionWords = [];
		this.airborne = false;
		this._pendingSnowImpact = 0;
		this._pendingScrapImpact = 0;
		this._pendingHydroImpact = 0;
		this._pendingMicroImpact = 0;
		this._pendingCrystalImpact = 0;
		this._pendingSteamImpact = 0;
		this._pendingJellyImpact = 0;
		this._pendingVentCrust = 0;
		this._pendingCandyImpact = 0;
		this._steamLastSent = NaN;
		this._candyLastSpeed = NaN;
		this.microBees = null;
		this.hydrostatic = new HydrostaticPressure();
		this._hydroLastSent = NaN;
		this._ventLastLift=NaN;
		this._scrapContactLast = NaN;
		this.scrapPitch = new ScrapPitchCadence();
		this._timer = null;
		this._token = 0;
		this._nextPromise = null;
		this._nextIndex = null;
		this._loading = null;
		this.transportPaused = false;
		this._resumeOffset = 0;
		this._resumeGateAt = null; // precise first audible frame after manual pause
		this._transportHistory = [];
		this._lastPlayed = null;
		this._skipHistoryOnce = false;
		this.initPromise = this._loadCatalog();
	}

	async _loadCatalog() {
		try {
			const response = await fetch(this.catalogUrl);
			if (!response.ok) return false; // No music installed: existing synth stays in service.
			const parsed = normalizeCatalog(await response.json());
			this.catalog = parsed.tracks;
			// A fresh game begins with One More Run, including with shuffle enabled.
			const opening = this.catalog.findIndex(song => song.id === FIRST_SONG_ID);
			if (opening >= 0) this.trackIndex = opening;
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
		// Instantiate the two bee voices only if Micro has visible bees.
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
		this.vocalGain = clamp(Number(settings.vocalGain ?? 1),0,1);
		this.melodyWithVocalsGain = clamp(Number(settings.melodyWithVocalsGain ?? 0.18),0,1);
		this.setVocals(settings.musicVocals === true);
		this.setSongSelection(settings.musicEnabledSongs);
		this.setShuffle(settings.musicShuffle === true);
		this.setDynamicOrchestra(settings.dynamicOrchestra === true);
	}

	setSongSelection(selection) {
		const selected = sanitizeSongSelection(selection);
		const changed = JSON.stringify(selected) !== JSON.stringify(this.songEnabled);
		this.songEnabled = selected;
		if (!changed) return;
		this._shuffleRemaining = [];
		this._nextIndex = null;
		this._nextPromise = null;
		if (this.transportPaused) {
			const next = nextEnabledSongIndex(this.catalog, this.songEnabled, -1);
			if(next<0){this.stop();return;}
			if(this.songEnabled[this.catalog[this.trackIndex]?.id]===false){
				this.trackIndex=next;
				this._resumeOffset=0;
			}
			return;
		}
		if (!this.started) return;
		const next = nextEnabledSongIndex(this.catalog, this.songEnabled, -1);
		if (next < 0) {
			// Crucially NO procedural fallback: the owner's all-off setting
			// means absolutely no music, while the SFX graph remains active.
			this.stop();
			return;
		}
		if (!this.track || this.songEnabled[this.track.id] === false) {
			this.stop();
			this.start();
		}
	}

	setDynamicOrchestra(on) {
		const next = on === true;
		if (next === this.dynamicOrchestra) return;
		this.dynamicOrchestra = next;
		// The user toggle governs *replacement recordings only*. All
		// processing of original stem audio (FX, room, speed and dynamics)
		// remains active in either mode and must not be rebuilt here.
		this.adaptive?.setEnabled(next && !this.menuMode);
	}

	setShuffle(on) {
		const next = on === true;
		if (this.shuffleEnabled === next) return;
		this.shuffleEnabled = next;
		this._shuffleRemaining = [];
		this._nextIndex = null;
		this._nextPromise = null;
	}

	/** Preserve the song clock while menus use unprocessed originals and Debutmont lead. */
	setMenuMode(on) {
		const next = on === true;
		if (this.menuMode === next) return;
		this.menuMode = next;
		if (next) {
			this._pendingSnowImpact = 0;
			this._pendingScrapImpact = 0;
			this.scrapPitch?.resetTiming();
			this._pendingMicroImpact = 0;
			this._pendingCrystalImpact = 0;
			this._pendingSteamImpact = 0;
		this._pendingJellyImpact = 0;
		this._pendingVentCrust = 0;
		this._pendingCandyImpact = 0;
			this._steamLastSent = NaN;
			this.microBees?.dispose();
			this.microBees=null;
		}
		if (next) {
			// Menus restore all three original accompaniments to clean DSP.
			this.setBsodDanger(0);
			this.setAirborne(false);
			this.setCombo(1);
			this.setSpeed(0);
		}
		this._refreshVoices();
		this.mixer?.selectBiome(next ? HOME_BIOME : this.biome);
		this.adaptive?.setBiome(next ? HOME_BIOME : this.biome);
		this.adaptive?.setEnabled(this.dynamicOrchestra && !next);
		this._applyMusicTimbres(true);
	}

	/** The real physical BSOD proximity drives only accompaniment corruption.
	 * The wind signal is independent and only AudioSynth reads airflow.
	 */
	setBsodDanger(proximity01) {
		this.bsodDanger = this.menuMode || !Number.isFinite(proximity01) ? 0 :
			Math.max(0, Math.min(1, proximity01));
		for (const stem of ['guitar','piano','other'])
			this.mixer?.setThreatLevel?.(stem, this.bsodDanger);
	}

	/** Original stem processing runs INDEPENDENTLY of the Dynamic
	 * Orchestra toggle: source-stem filtering, coloration, room sends,
	 * speed-dependent ducking and FX are all legitimate in OFF mode.
	 * The only mode-gated action is the AdaptiveBiomeRouter replacing
	 * an original instrumental source with its re-performed alternative.
	 * The separately synthesized biome melody stays active in BOTH modes.
	 */
	_applyMusicTimbres(force=false) {
		if (!this.mixer || !this.gains) return;
		const lead = this._activeVoiceFor(this.pack);
		const sourceNames = ['bass','drums','guitar','piano','other'];
		if (lead) sourceNames.push(lead);
		for (const name of sourceNames) {
			if (!this.gains.has(name)) continue;
			const effects = name===lead ? melodyPreset(this.menuMode ? 'debutmont' : this.biome) :
				this.menuMode ? [] : orchestraPreset(this.biome,name);
			const key = JSON.stringify(effects);
			if (force || this._timbreSignatures.get(name)!==key) {
				// A rider entering Debumont while airborne is above the powder already.
				// Keep the cached signature based on GROUND effects so jumps don't rebuild FX graphs.
				const initial = this.airborne && !this.menuMode &&
					(this.biome === 'debutmont' || this.biome === 'micro-mountain' ||
					this.biome === 'crystal-cavern' || this.biome === 'steampunk-slopes' ||
					this.biome === 'sky-jellyfish-mountain' || this.biome === 'candy-cane-canyon')
					? effects.map(e => e.type==='snowpack' ? {...e,depth:0} :
						e.type==='microbox' || e.type==='crystallattice' ? {...e,openness:1} :
						e.type==='steamworks' ? {...e,airborne:true} :
						e.type==='jellybloom' ? {...e,airborne:true} :
						e.type==='sugarfizz' ? {...e,airborne:true} :
						e.id==='crystalPercussion' ? {...e,gain:.48} : e) : effects;
				this.mixer.replaceEffects(name,initial,.18);
				this._timbreSignatures.set(name,key);
			}
			// Restore each source's normal biome room send in either
			// mode. Muting reverb when the toggle is OFF would wrongly
			// disable legitimate processing of the ORIGINAL recordings.
			this.mixer.setRoomSend(name,this.menuMode ? 0 : null);
		}
		this._applyScrapContact(true);
		this._steamLastSent = NaN;
		this._applySteamSpeed(true);
		this._candyLastSpeed=NaN;
		this._applyCandySpeed(true);
	}

	_nextEnabledIndex(previous = -1) {
		if (!this.shuffleEnabled || previous < 0)
			return nextEnabledSongIndex(this.catalog, this.songEnabled, previous);
		if (!this._shuffleRemaining?.length)
			this._shuffleRemaining = shuffledSongRound(this.catalog, this.songEnabled, previous);
		return this._shuffleRemaining[0] ?? -1;
	}

	_consumeShuffledIndex(index) {
		if (this.shuffleEnabled)
			this._shuffleRemaining = (this._shuffleRemaining || []).filter(i => i !== index);
	}

	setStemGain(name, gain) {
		if (!CORE_STEMS.includes(name) || name === 'vocals') return false;
		const level = clamp(Number(gain) || 0, 0, 1.5);
		this._stemUserLevels?.set(name, level);
		const changed = this.mixer?.setGain(name, level) || false;
		// Keep user-mix level consistent as an original stem is replaced.
		const featured = this.pack?.adaptive?.featuredStem;
		const alternate = name === 'bass' || name === 'drums' ? name :
			name === featured ? 'featured' :
			['guitar','piano','other'].includes(name) ? name : null;
		if (alternate) this.mixer?.setGain('adaptive:' + alternate, level);
		return changed;
	}

	setVocals(on) {
		this.vocals = !!on;
		this.mixer?.setGain('vocals', this.vocals ? (this.vocalGain ?? 1) : 0, { time: 0.03 });
		this._refreshVoices();
	}

	setBiome(id) {
		const next = typeof id === 'string' && id ? canonicalBiomeId(id) : HOME_BIOME;
		// Reset only on confirmed boundaries; aliases resolve BEFORE comparing.
		if (next !== this.biome &&
			(next === 'underwater-mountain' || this.biome === 'underwater-mountain')) {
			this.hydrostatic?.reset();
			this._hydroLastSent = NaN;
			this._pendingHydroImpact = 0;
		}
		if (next !== this.biome &&
			(next === 'garbage-dump-glacier' || this.biome === 'garbage-dump-glacier'))
			this.scrapPitch?.reset();
		this.biome = next;
		if (this.biome !== 'debutmont') this._pendingSnowImpact = 0;
		if (this.biome !== 'crystal-cavern') this._pendingCrystalImpact = 0;
		if (this.biome !== 'garbage-dump-glacier') this._pendingScrapImpact = 0;
		if (this.biome !== 'garbage-dump-glacier') this.scrapPitch?.resetTiming();
		if (this.biome !== 'steampunk-slopes') this._pendingSteamImpact=0;
		if (this.biome !== 'sky-jellyfish-mountain') this._pendingJellyImpact=0;
		if (this.biome !== 'vertigo-vents') this._pendingVentCrust=0;
		if (this.biome !== 'candy-cane-canyon') this._pendingCandyImpact=0;
		this._candyLastSpeed=NaN;
		this._ventLastLift=NaN;
		this._steamLastSent=NaN;
		if(this.biome!=='steampunk-slopes')this._lastSteamMusicAccentMs=-Infinity;
		if (this.biome !== 'micro-mountain') {
			this._pendingMicroImpact=0;
			this.microBees?.dispose();
			this.microBees=null;
		}
		this._scrapContactLast = NaN;
		// Reapplying the same biome must NOT postpone the next musical clang.
		this._refreshVoices();
		this.mixer?.selectBiome(this.menuMode ? HOME_BIOME : this.biome);
		this.adaptive?.setBiome(this.menuMode ? HOME_BIOME : this.biome);
		this._applyMusicTimbres();
		if (this.started) this._pump();
	}

	_activeVoiceFor(pack) {
		const desired = voiceSourceForBiome(this.menuMode ? 'debutmont' : this.biome);
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
			this.mixer.setGain(name,name === active ?
				(this.vocals ? (this.melodyWithVocalsGain ?? .18) : 1) : 0,
				{ time: 0.22 });
		}
	}

	/** Landing pulses may arrive either side of the per-frame grounded update. */
	onLanding(landing) {
		if (this.menuMode) return;
		if (this.biome === 'debutmont') {
			const impulse = snowpackImpactFromLanding(landing);
			if (impulse <= 0) return;
			this._pendingSnowImpact = Math.max(this._pendingSnowImpact || 0, impulse);
			if (!this.airborne) this._applySnowImpact();
		} else if (this.biome === 'garbage-dump-glacier') {
			const impulse = impactFromLanding(landing);
			if (impulse <= 0) return;
			this._pendingScrapImpact = Math.max(this._pendingScrapImpact || 0, impulse);
			if (!this.airborne) this._applyScrapImpact();
		} else if (this.biome === 'crystal-cavern') {
			const impulse=impactFromLanding(landing);
			if(impulse<=0)return;
			this._pendingCrystalImpact=Math.max(this._pendingCrystalImpact||0,impulse);
			if(!this.airborne)this._applyCrystalImpact();
		} else if (this.biome === 'micro-mountain') {
			const impulse=impactFromLanding(landing);
			if(impulse<=0)return;
			this._pendingMicroImpact=Math.max(this._pendingMicroImpact||0,impulse);
			if(!this.airborne)this._applyMicroImpact();
		} else if (this.biome === 'underwater-mountain') {
			const impulse = impactFromLanding(landing);
			if (impulse <= 0) return;
			this._pendingHydroImpact = Math.max(this._pendingHydroImpact || 0,impulse);
			if (!this.airborne) this._applyHydroImpact();
		} else if (this.biome === 'steampunk-slopes') {
			const impulse=impactFromLanding(landing);
			if(impulse<=0)return;
			this._pendingSteamImpact=Math.max(this._pendingSteamImpact||0,impulse);
			if(!this.airborne)this._applySteamImpact();
		} else if (this.biome === 'candy-cane-canyon') {
			if(this.transportPaused)return;
			const impulse=impactFromLanding(landing);
			if(impulse<=0)return;
			this._pendingCandyImpact=Math.max(this._pendingCandyImpact||0,impulse);
			if(!this.airborne)this._applyCandyImpact();
		} else if (this.biome === 'vertigo-vents') {
			const impulse=impactFromLanding(landing);
			if(impulse<=0)return;
			this._pendingVentCrust=Math.max(this._pendingVentCrust||0,impulse);
			if(!this.airborne)this._applyVentCrust();
		} else if (this.biome === 'sky-jellyfish-mountain') {
			const impulse=impactFromLanding(landing);
			if(impulse<=0)return;
			this._pendingJellyImpact=Math.max(this._pendingJellyImpact||0,impulse);
			if(!this.airborne)this._applyJellyImpact();
		}
	}

	/** Read actual physics cooldown before and after SAME SIM TICK.
	 * The geyser engine sets this cooldown only when the vent really fires.
	 * Airborne alone is never sufficient to create an eruption.
	 * The values are read-only after authoritative stepWorld, not inferred
	 * from the synthetic beat or a timer.
	 */
	setGeyserMotion(snapshot){
		if(!this.started||this.menuMode||this.transportPaused||this.biome!=='vertigo-vents'||
			!snapshot||typeof snapshot!=='object')return false;
		const {beforeCooldownMs:before,afterCooldownMs:after,vy,launchAvailable}=snapshot;
		if(!Number.isFinite(before)||!Number.isFinite(after)||before<0||after<0||
			!Number.isFinite(vy)||typeof launchAvailable!=='boolean')return false;
		const rise=Math.max(0,Math.min(1,-vy/1600));
		if(!Number.isFinite(this._ventLastLift)||
			Math.abs(rise-this._ventLastLift)>.035){
			this._ventLastLift=rise;
			for(const stem of ['bass','drums','guitar','piano','other'])
				this.mixer?.setEffectParam(stem,'ventforge','updraft',rise);
		}
		const fired=launchAvailable&&after>before+80&&after>200;
		if(fired)this.mixer?.setEffectParam('drums','ventforge','eruption',
			Math.max(.55,rise));
		return fired;
	}
	_applyVentCrust(){
		const impulse=this._pendingVentCrust||0;
		this._pendingVentCrust=0;
		if(impulse>0&&!this.menuMode&&this.biome==='vertigo-vents')
			this.mixer?.setEffectParam('drums','ventforge','crustImpact',impulse);
	}

	/** Real original-stem Candy Cane sugar fizz follows actual rider speed.
	 * Never synthesize a beat or modify Sugar Rush physics/steering.
	 */
	_applyCandySpeed(force=false){
		if(this.menuMode||this.biome!=='candy-cane-canyon')return;
		const speed=Math.min(1,Math.max(0,this.speedPxS/1800));
		if(!force&&Number.isFinite(this._candyLastSpeed)&&
			Math.abs(speed-this._candyLastSpeed)<.035)return;
		this._candyLastSpeed=speed;
		for(const stem of ['bass','drums','guitar','piano','other'])
			this.mixer?.setEffectParam(stem,'sugarfizz','speed',speed);
	}
	_applyCandyImpact(){
		const impulse=this._pendingCandyImpact||0;
		this._pendingCandyImpact=0;
		if(impulse>0&&!this.menuMode&&!this.transportPaused&&this.biome==='candy-cane-canyon')
			this.mixer?.setEffectParam('drums','sugarfizz','pop',impulse);
	}

	/** Jelly elastic impacts only trigger for actual noncrash touchdown.
	 * Pending impact may arrive before the authoritative grounded edge. */
	_applyJellyImpact(){
		const impulse=this._pendingJellyImpact||0;
		this._pendingJellyImpact=0;
		if(impulse>0&&!this.menuMode&&this.biome==='sky-jellyfish-mountain')
			this.mixer?.setEffectParam('drums','jellybloom','impact',impulse);
	}

	/**
	 * A real original-mix transient detected by the WorldDance presentation
	 * envelope may make the same decorative gear audibly tick. This NEVER
	 * consumes the synthetic/unverified meter and never authorizes gameplay.
	 * Only the live audio engine's own revision-matched sample qualifies.
	 */
	onSteampunkMusicAccent(sample){
		if(!this.started||this.transportPaused||this.menuMode||this.airborne||
			this.biome!=='steampunk-slopes'||!sample||
			!Number.isFinite(sample.timeMs)||
			!Number.isFinite(sample.bass)||!Number.isFinite(sample.mid)||
			!this.track||sample.revision!==String(this._token)+':'+this.track.id+':'+this.clockStart||
			sample.timeMs-this._lastSteamMusicAccentMs<165)return false;
		this._lastSteamMusicAccentMs=sample.timeMs;
		const strength=Math.max(.18,Math.min(1,.76*sample.bass+.24*sample.mid));
		return this.mixer?.setEffectParam('drums','steamworks','musicAccent',strength)===true;
	}

	_applySteamSpeed(force=false){
		if(this.menuMode||this.biome!=='steampunk-slopes')return;
		const speed=clamp(this.speedPxS/1600,0,1);
		if(!force&&Number.isFinite(this._steamLastSent)&&
			Math.abs(speed-this._steamLastSent)<.025)return;
		this._steamLastSent=speed;
		for(const stem of ['bass','drums','guitar','piano','other'])
			this.mixer?.setEffectParam(stem,'steamworks','speed',speed);
	}

	_applySteamImpact(){
		const impulse=this._pendingSteamImpact||0;
		this._pendingSteamImpact=0;
		if(impulse<=0||this.menuMode||this.biome!=='steampunk-slopes')return;
		this.mixer?.setEffectParam('drums','steamworks','impact',impulse);
	}

	_applySnowImpact() {
		const impulse = this._pendingSnowImpact || 0;
		this._pendingSnowImpact = 0;
		if (impulse <= 0 || this.menuMode || this.biome !== 'debutmont') return;
		for (const stem of ['bass','drums','guitar','piano','other'])
			this.mixer?.setEffectParam(stem,'snowpack','impact',impulse);
	}

	_applyScrapContact(force = false) {
		if (this.biome !== 'garbage-dump-glacier' || this.menuMode) return;
		const contact = contactFromMotion(this.speedPxS, !this.airborne);
		if (!force && Number.isFinite(this._scrapContactLast) &&
			Math.abs(contact - this._scrapContactLast) < .04) return;
		this._scrapContactLast = contact;
		this.mixer?.setEffectParam('drums', 'scrapheap', 'contact', contact);
	}

	/**
	 * Seeded irregular source-consonant junk clangs. Called by the EXISTING
	 * music pump; no new timer, guessed song key or off-grid scoring changes.
	 * The bass analyser is only read at a due time, not each 75ms tick.
	 */
	_maybeScrapPitchClang(now){
		if(!Number.isFinite(now)||!this.started||this.transportPaused||
			this.menuMode||this.biome!=='garbage-dump-glacier'||this.airborne)
			return false;
		const contact=contactFromMotion(this.speedPxS,true);
		if(contact<.16)return false;
		const candidate=this.scrapPitch?.next(now,contact,
			()=>this.mixer?.readEffect?.('bass','scrapPitchProbe','notes'));
		if(!candidate)return false;
		return this.mixer?.setEffectParam('drums','scrapheap','pitchedClang',candidate)===true;
	}

	_applyScrapImpact() {
		const impulse = this._pendingScrapImpact || 0;
		this._pendingScrapImpact = 0;
		if (impulse <= 0 || this.menuMode || this.biome !== 'garbage-dump-glacier') return;
		this.mixer?.setEffectParam('drums', 'scrapheap', 'impact', impulse);
	}

	/** True terrain elevation and rider motion from the real sim, never fake depth. */
	setHydrostaticMotion({terrainY,riderY,vy,grounded}={}) {
		if (this.menuMode || this.biome !== 'underwater-mountain') return false;
		if (!this.hydrostatic) this.hydrostatic = new HydrostaticPressure();
		const state = this.hydrostatic.update({terrainY,riderY,vy,grounded});
		if (!state.valid) return false;
		if (!Number.isFinite(this._hydroLastSent) ||
			Math.abs(state.audiblePressure01-this._hydroLastSent) >= .018) {
			this._hydroLastSent=state.audiblePressure01;
			for (const stem of ['bass','drums','guitar','piano','other'])
				this.mixer?.setEffectParam(stem,'hydrostatic','pressure',state.audiblePressure01);
		}
		return true;
	}

	_applyHydroImpact() {
		const impulse = this._pendingHydroImpact || 0;
		this._pendingHydroImpact = 0;
		if (impulse > 0 && !this.menuMode && this.biome === 'underwater-mountain')
			this.mixer?.setEffectParam('drums','hydrostatic','impact',impulse);
	}

	/** Actual existing Micro Mountain bee screen positions: no new bee RNG. */
	setMicroBees(bees,playerScreenX){
		if(this.menuMode||this.biome!=='micro-mountain'||!this.started){
			this.microBees?.setPositions([],{enabled:false});
			return false;
		}
		if(!this.microBees&&this.ctx&&this.bus&&Array.isArray(bees)&&bees.length)
			this.microBees=new MicroBeeAudio(this.ctx,this.bus);
		return this.microBees?.setPositions(bees,{enabled:true,playerScreenX})||false;
	}

	_applyCrystalImpact(){
		const impulse=this._pendingCrystalImpact||0;
		this._pendingCrystalImpact=0;
		if(impulse>0&&!this.menuMode&&this.biome==='crystal-cavern')
			this.mixer?.setEffectParam('bass','crystallattice','impact',impulse);
	}

	_applyMicroImpact(){
		const impulse=this._pendingMicroImpact||0;
		this._pendingMicroImpact=0;
		if(impulse>0&&!this.menuMode&&this.biome==='micro-mountain')
			this.mixer?.setEffectParam('drums','microbox','impact',impulse);
	}

	setAirborne(airborne) {
		const next = !this.menuMode && !!airborne;
		if (next === this.airborne) return;
		// Emit precisely once at the authoritative grounded→airborne edge.
		// Ground speed is the real physical proxy; no invented dirt or MIDI notes.
		// Suppress in menus and all non-Garbage biomes.
		if (next && !this.menuMode && this.biome === 'garbage-dump-glacier') {
			const speedContact = contactFromMotion(this.speedPxS, true);
			this.mixer?.setEffectParam('drums','scrapheap','takeoff',
				Math.max(.18,speedContact));
		}
		if(next&&!this.menuMode&&this.biome==='steampunk-slopes')
			this.mixer?.setEffectParam('drums','steamworks','release',
				Math.max(.18,clamp(this.speedPxS/1600,0,1)));
		if(next&&!this.menuMode&&!this.transportPaused&&this.biome==='candy-cane-canyon')
			this.mixer?.setEffectParam('other','sugarfizz','wrapper',
				Math.max(.2,Math.min(1,this.speedPxS/1800)));
		if(next&&!this.menuMode&&this.biome==='sky-jellyfish-mountain')
			this.mixer?.setEffectParam('other','jellybloom','lift',.80);
		this.airborne = next;
		if(this.biome==='candy-cane-canyon'&&!this.menuMode)
			for(const stem of ['bass','drums','guitar','piano','other'])
				this.mixer?.setEffectParam(stem,'sugarfizz','airborne',next);
		if(this.biome==='sky-jellyfish-mountain'&&!this.menuMode)
			for(const stem of ['bass','drums','guitar','piano','other'])
				this.mixer?.setEffectParam(stem,'jellybloom','airborne',next);
		if(this.biome==='steampunk-slopes'&&!this.menuMode)
			for(const stem of ['bass','drums','guitar','piano','other'])
				this.mixer?.setEffectParam(stem,'steamworks','airborne',next);
		// As the rider clears the snow, the original instruments open up; landing
		// restores Powdery without changing playback, beat timing or the music clock.
		if (this.biome === 'debutmont') {
			for (const stem of ['bass','drums','guitar','piano','other']) {
				const depth = next ? 0 : orchestraPreset('debutmont',stem)[0].depth;
				this.mixer?.setEffectParam(stem,'snowpack','depth',depth);
			}
			if (!next) this._applySnowImpact();
		}
		this._applyScrapContact(true);
		if(next&&this.biome==='garbage-dump-glacier')this.scrapPitch?.resetTiming();
		if (!next) {
			this._applyScrapImpact();
			this._applyHydroImpact();
			this._applyMicroImpact();
			this._applyCrystalImpact();
			this._applySteamImpact();
			this._applyJellyImpact();
			this._applyVentCrust();
			this._applyCandyImpact();
		}
		if(this.biome==='crystal-cavern'&&!this.menuMode){
			for(const stem of ['bass','guitar','piano','other'])
				this.mixer?.setEffectParam(stem,'crystallattice','openness',next?1:0);
			this.mixer?.setEffectParam('drums','crystalPercussion','gain',next?.48:1);
		}
		if(this.biome==='micro-mountain'&&!this.menuMode)
			for(const stem of ['bass','drums','guitar','piano','other'])
				this.mixer?.setEffectParam(stem,'microbox','openness',next?1:0);
		// New adaptive packs crossfade full original drums with an actual
		// airborne kit. The legacy 0.58 airborne duck remains unchanged.
		// Airborne ducking applies to the ORIGINAL stem regardless
		// of orchestra mode or availability of alternate kit assets.
		this.mixer?.setGain('drums', this.airborne ? .22 : 1,
			{ motion: true, time: .15 });
		// Actual alternate air drums also soften rather than becoming
		// a permanent full-volume replacement under a low source bed.
		this.mixer?.setGain('adaptive:drums', this.airborne ? .38 : 1,
			{ motion: true, time: .15 });
		this.adaptive?.setAirborne(this.airborne);
		if (this.started) this._pump();
	}

	setSpeed(speedPxS) {
		if (this.menuMode) speedPxS = 0;
		// Effects marked speed-filter react without altering source playback rate.
		const normalized = clamp((Number(speedPxS) || 0) / 1000, 0, 1);
		this.mixer?.setEffectParam('other', 'speed-filter', 'frequency', 400 + normalized * 15000);
		this.speedPxS = Math.max(0, Number(speedPxS)||0);
		this._applyScrapContact();
		this._applySteamSpeed();
		this._applyCandySpeed();
		const speedGain = this.menuMode ? 1 : clamp(.2+this.speedPxS/850,.2,1.18);
		this.mixer?.setGain('bass',speedGain,{motion:true,time:.16});
		this.mixer?.setGain('adaptive:bass',speedGain,{motion:true,time:.16});
		this.adaptive?.setSpeed(speedPxS);
	}

	setCombo(multiplier = 1) {
		if (this.menuMode) multiplier = 1;
		const level = clamp(1 + (Number(multiplier) - 1) * 0.05, 0.8, 1.25);
		this.mixer?.setGain('other', level, { motion: true, time: 0.09 });
		if (this.pack?.adaptive) {
			const role=this.pack.adaptive.featuredStem === 'other' ? 'featured' : 'other';
			this.mixer?.setGain('adaptive:'+role, level, { motion: true, time: 0.09 });
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
		const first = this._nextEnabledIndex(-1);
		if (first < 0) { this.stop(); return false; }
		if (!this.catalog[this.trackIndex] ||
			this.songEnabled[this.catalog[this.trackIndex].id] === false)
			this.trackIndex = first;
		this.transportPaused = false;
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
		const next = this._nextEnabledIndex(-1);
		if (next < 0) { this.stop(); return; }
		if (!this.pack && !this._loading) {
			const index = this.songEnabled[this.catalog[this.trackIndex]?.id] !== false
				? this.trackIndex : next;
			const offset=this._resumeOffset;
			this._resumeOffset=0;
			const pending=this._beginTrack(index,null,offset);
			this._loading=pending;
			pending.finally(()=>{if(this._loading===pending)this._loading=null;});
		}
		if (!this._timer) this._timer = setInterval(() => { this._pump(); }, 75);
	}

	async _fetchOriginalMusicResponse(packBase,relative){
		const key=String(packBase);
		const {response,usedLegacy}=await fetchMusicAssetResponse(packBase,relative,{
			preferLegacy:this._legacyDebutmontPacks?.has(key)===true,
		});
		if(usedLegacy)this._legacyDebutmontPacks?.add(key);
		return response;
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
			const response = await this._fetchOriginalMusicResponse(info.base,relative);
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
			const response = await this._fetchOriginalMusicResponse(info.base,relative);
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
		for (const stem of ['guitar','piano','other']) {
			if (stem!==this.pack.adaptive.featuredStem)
				this.mixer.setGain('adaptive:'+stem,level(stem));
		}
	}

	async _fetchAdaptiveSegment(index, path) {
		const token = this._token;
		if (!this.pack || this.clockStart === null || !this.pack.adaptive) return null;
		const key = String(index) + '/adaptive:' + path;
		if (this.cache.has(key)) return this.cache.get(key);
		if (this.inflight.has(key)) return this.inflight.get(key);
		const promise = (async () => {
			const response = await this._fetchOriginalMusicResponse(this.packBase,path);
			if (!response.ok) throw new Error('Missing optional adaptive source');
			const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
			if (token === this._token && !this.disposed) this.cache.set(key, buffer);
			return buffer;
		})();
		this.inflight.set(key, promise);
		try { return await promise; }
		finally { if (this.inflight.get(key) === promise) this.inflight.delete(key); }
	}

	async _beginTrack(index, desiredAt, offsetSeconds=0) {
		if (index < 0 || !this.catalog[index] ||
			this.songEnabled[this.catalog[index].id] === false) {
			if (this._nextEnabledIndex(-1) < 0) this.stop();
			return;
		}
		const token = ++this._token;
		this.cache.clear();
		this.inflight.clear();
		this.scheduled.clear();
		try {
			const info = this._nextIndex === index && this._nextPromise
				? await this._nextPromise : await this._getTrack(index);
			if (token !== this._token || this.disposed) return;
			if (!info) throw new Error('Next track could not be prepared');
			if (this.songEnabled[info.track.id] === false) {
				const next = this._nextEnabledIndex(-1);
				if (next < 0) this.stop();
				else if (next !== index) this._beginTrack(next, null);
				return;
			}
			// Record history when a track actually begins, not when a stale
			// async request *intended* to begin one.
			if(this.track?.id && this.track.id!==info.track.id){
				this._lastPlayed={id:this.track.id,title:this.track.title};
				if(!this._skipHistoryOnce){
					this._transportHistory.push({id:this.track.id,title:this.track.title});
					if(this._transportHistory.length>12)this._transportHistory.shift();
				}
			}
			this._skipHistoryOnce=false;
			this.pack = info.pack;
			this.track = info.track;
			this.packBase = info.base;
			this.trackIndex = index;
			this._consumeShuffledIndex(index);
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
			this._timbreSignatures.clear();
			this._applyMusicTimbres(true);
			if (info.pack.captions) this._loadCaptions(info, token);
			this._nextPromise = null;
			this._nextIndex = null;
			if (info.buffers) {
				for (const [key, buffer] of info.buffers) this.cache.set(key, buffer);
			} else {
				await Promise.all(this._wantedNames(info.pack).map((s) => this._fetchSource(info, 0, s, token)));
			}
			if (token !== this._token || this.disposed) return;
			const actualResumeOffset=clamp(Number(offsetSeconds)||0,0,
				Math.max(0,this.pack.duration-.1));
			const firstSourceTime=Math.max(this.ctx.currentTime+.12,desiredAt||0);
			this.clockStart=firstSourceTime-actualResumeOffset;
			// For normal track-start this is a no-op. For a manual pause resume,
			// offsets MUST begin on this first sound frame, never 100ms before it
			// just because buffers were fetched early in the WebAudio scheduler.
			this._resumeGateAt=actualResumeOffset>0 ? firstSourceTime : null;
			this.adaptive?.configure(this.pack, this.clockStart,
				{ biome: this.menuMode ? HOME_BIOME : this.biome, airborne: this.airborne });
			this.adaptive?.setEnabled(this.dynamicOrchestra && !this.menuMode);
			this._syncAdaptiveUserLevels();
			this.mixer?.setGain('drums',this.airborne ? .22 : 1,
				{ motion:true,time:.15 });
			this.mixer?.setGain('adaptive:drums',this.airborne ? .38 : 1,
				{ motion:true,time:.15 });
			this.setSpeed(this.speedPxS);
			this._pump();
			if (this.onTrackStarted) this.onTrackStarted({
				id: this.track.id, title: this.track.title, index: this.trackIndex,
			});
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
		const firstAllowed=Math.max(desired,now+.02,this._resumeGateAt??0);
		const late = Math.max(0,firstAllowed-desired);
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
			src.start(firstAllowed, late,
				Math.max(0.001, Math.min(duration-late,buffer.duration-late)));
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
		this._maybeScrapPitchClang(now);
		const elapsed = now - this.clockStart;
		const duration = this.pack.duration;
		if (elapsed > duration - 15 && !this._nextPromise) {
			this._nextIndex = this._nextEnabledIndex(this.trackIndex);
			if (this._nextIndex >= 0)
				this._nextPromise = this._preloadTrack(this._nextIndex).catch(() => null);
		}
		if (elapsed >= duration - 0.5) {
			if (!this._loading) {
				const nextIndex = this._nextEnabledIndex(this.trackIndex);
				if (nextIndex < 0) { this.stop(); return; }
				const pending=this._beginTrack(nextIndex,this.clockStart+duration);
				this._loading=pending;
				pending.finally(()=>{if(this._loading===pending)this._loading=null;});
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

	/** One canonical transport for Title, Pause, and Game-Over. These
	 * screens never instantiate a second audio player or own a playback
	 * clock. Browser AudioContext suspension is distinct from user pause.
	 */
	transportSnapshot() {
		const enabled=enabledSongIndices(this.catalog,this.songEnabled);
		const current=this.catalog[this.trackIndex]||null;
		const index=enabled.includes(this.trackIndex) ? this.trackIndex : enabled[0];
		const upcoming=[];
		if(enabled.length && index!==undefined){
			if (this.shuffleEnabled) {
				this._nextEnabledIndex(index);
				for (const next of (this._shuffleRemaining || []).slice(0,2))
					upcoming.push(this.catalog[next]);
			} else {
				let cursor=enabled.indexOf(index);
				for(let i=0;i<Math.min(2,enabled.length);i++){
					cursor=(cursor+1)%enabled.length;
					upcoming.push(this.catalog[enabled[cursor]]);
				}
			}
		}
		return {
			state:!enabled.length?'stopped':
				this.transportPaused?'paused':
				this.started?(this.pack?'playing':'loading'):'stopped',
			current: enabled.length ? (current||this.track) : null,
			previous:this._lastPlayed||this._transportHistory.at(-1)||null,
			upcoming,
			position:this.transportPaused?this._resumeOffset:
				this.started&&this.ctx&&this.clockStart!==null?
					// A manually resumed source is scheduled slightly in the future.
					// Don't show its saved position moving BACKWARD during that silent
					// pre-start window; audio itself already has the exact-frame gate.
					Math.max(0,Math.max(this.ctx.currentTime,
						this._resumeGateAt??this.ctx.currentTime)-this.clockStart):0,
			audioSuspended:this.ctx?.state==='suspended',
		};
	}

	transportPause() {
		if(!this.started)return false;
		const position=this.pack&&this.ctx&&this.clockStart!==null?
			clamp(this.ctx.currentTime-this.clockStart,0,
				Math.max(0,this.pack.duration-.1)):0;
		this.stop();
		this._resumeOffset=position;
		this.transportPaused=true;
		return true;
	}

	transportPlay() {
		if(this.disposed||!this.ready||this._nextEnabledIndex(-1)<0)
			return false;
		if(this.started)return true;
		return this.start();
	}

	/** Previous takes the actual last-played song where possible; if
	 * there is no history, wrap to the preceding enabled playlist slot.
	 * Paused intent is retained across skips; only Play resumes sound.
	 */
	transportStep(direction) {
		if(this.disposed||!this.ready)return false;
		const enabled=enabledSongIndices(this.catalog,this.songEnabled);
		if(!enabled.length){this.stop();return false;}
		const wasPaused=this.transportPaused;
		const current=enabled.includes(this.trackIndex)?
			enabled.indexOf(this.trackIndex):0;
		let target;
		if(direction<0){
			while(this._transportHistory.length){
				const previous=this._transportHistory.pop();
				const found=this.catalog.findIndex(t=>t.id===previous.id);
				if(enabled.includes(found)){target=found;break;}
			}
			if(target===undefined)target=enabled[(current+enabled.length-1)%enabled.length];
			this._skipHistoryOnce=true;
		}else{
			target=this.shuffleEnabled ? this._nextEnabledIndex(this.trackIndex) :
				enabled[(current+1)%enabled.length];
			this._skipHistoryOnce=false;
		}
		this.stop();
		this.trackIndex=target;
		this._resumeOffset=0;
		if(wasPaused){this.transportPaused=true;return true;}
		return this.start();
	}

	/** Real-engine passage seek used by the in-game lab.
	 * This changes the actual WebAudio clock anchor, invalidates pending
	 * network/decoder requests, and reconfigures adaptive replacement
	 * instruments at the same sample position. Never creates a second
	 * score or playback engine. It does not affect persistent settings.
	 */
	seekTo(seconds) {
		if (!this.started || !this.pack || !this.ctx ||
			this.ctx.state !== 'running') return false;
		if (!Number.isFinite(seconds)) return false;
		const position = clamp(seconds, 0, Math.max(0, this.pack.duration-0.1));
		const t = this.ctx.currentTime;
		this.bus.gain.cancelScheduledValues(t);
		this.bus.gain.setTargetAtTime(0,t,.007);
		++this._token; // all older fetches are now stale
		for(const src of this.activeNodes){
			try {src.stop(t+.014);} catch {}
		}
		this.activeNodes.clear();
		this.scheduled.clear();
		this.inflight.clear();
		this._nextPromise=null;
		this._nextIndex=null;
		this.clockStart=t+.085-position;
		this._resumeGateAt=null; // an explicit seek owns a separate transport generation
		this.adaptive?.reset();
		this.adaptive?.configure(this.pack,this.clockStart,{
			biome:this.menuMode ? HOME_BIOME : this.biome,airborne:this.airborne,
		});
		this.adaptive?.setEnabled(this.dynamicOrchestra && !this.menuMode);
		this._syncAdaptiveUserLevels();
		this.bus.gain.setTargetAtTime(1,t+.045,.018);
		this._pump();
		return true;
	}

	stop() {
		this.started = false;
		this.microBees?.setPositions([],{enabled:false});
		this.transportPaused=false;
		this._resumeOffset=0;
		this._resumeGateAt=null;
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
		this.microBees?.dispose();
		this.mixer?.destroy();
		if (this.bus) this.bus.disconnect();
	}
}
