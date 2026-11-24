/**
 * Source-bound final-master OFFLINE Chromium audio evidence.
 * Reuses *production* AudioSynth._buildGraph(), production AudioSynth
 * playSfx/glitch/BSOD-wind APIs, original StemFXMixer and owner FX presets.
 * Scripted SFX timestamps are synthetic stress cases, NOT claimed to be
 * replay/physics-derived events. No game source gets modified.
 */
import {AudioSynth} from '../../src/systems/AudioSynth.js';
import {seedCosmeticRandom} from '../../src/systems/CosmeticRandom.js';
import {StemFXMixer} from '../../src/systems/music/MusicFXGraph.js';
import {orchestraPreset,melodyPreset,sourceOnlyExtras}
	from '../../src/systems/music/DynamicOrchestraPresets.js';
import {fetchMusicAssetResponse}
	from '../../src/systems/music/MusicPack.js';
import {measureFourTimesTruePeak} from './estimate-true-peak-4x.js';

const RATE=48000,RENDER_SECONDS=4.1,START=.16;
const QA_COSMETIC_SEED=0x2912026;
const ORIGINALS=['drums','bass','guitar','piano','other'];
const ALL_ROLES=[...ORIGINALS,'vocals'];
const FXS=Object.freeze({
	garbage:'garbage-dump-glacier',
	vertigo:'vertigo-vents',
	crystal:'crystal-cavern',
	arcade:'bitstream-bluffs'
});
const EVENTS=[
	{at:.38,action:'bsod-wind',note:'real AudioSynth._onBsodState, normalized relative air >=1'},
	{at:.62,action:'hop',note:'real AudioSynth.playSfx'},
	{at:1.10,action:'static-glitch',note:'real AudioSynth.glitch static at .92 intensity'},
	{at:1.68,action:'hard-landing',note:'real AudioSynth._onLanding; genuine SFX formula, scripted test time'},
	{at:2.34,action:'hazardScramble',note:'real AudioSynth.playSfx'},
	{at:2.82,action:'fatal-crash-sfx',note:'real AudioSynth.playSfx crash (not complete count-in)'},
];
const db=x=>20*Math.log10(Math.max(1e-12,x));
async function decodeOriginals(pack,segmentIndex,biome){
	if(!/^[\w-]{1,100}$/.test(pack)||!Number.isInteger(segmentIndex)||
		segmentIndex<0||segmentIndex>30||!Object.values(FXS).includes(biome))
		throw Error('Untrusted pack, segment or biome');
	const packBase=new URL('/music/packs/'+pack+'/',location.origin).href;
	const manifestResponse=await fetch(packBase+'pack.json');
	if(!manifestResponse.ok)throw Error('Original manifest unavailable');
	const manifest=await manifestResponse.json();
	const segment=manifest.segments?.[segmentIndex];
	if(!segment||!segment.sources)throw Error('No actual original source segment');
	const roles=[...ALL_ROLES,'voice:'+biome];
	const ctx=new AudioContext();
	const sources=new Map(),hashes={};
	try{
		for(const role of roles){
			const rel=segment.sources[role];
			if(!rel)throw Error('Missing authentic source: '+role);
			const {response}=await fetchMusicAssetResponse(packBase,rel);
			if(!response.ok)throw Error('Original OGG HTTP '+response.status+' '+role);
			const bytes=await response.arrayBuffer();
			const digest=await crypto.subtle.digest('SHA-256',bytes);
			hashes[role]=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
			sources.set(role,await ctx.decodeAudioData(bytes));
		}
	}finally{await ctx.close()}
	return {manifest,segment,segmentIndex,biome,sources,hashes,
		originalSourceVerified:true,roles};
}
function actualAudioSynthGraph(ctx){
	// Use the PRODUCTION graph: music + SFX + wind -> mix, static -> master,
	// master -> production compressor -> production OutputPeakGuard -> output.
	const a=Object.create(AudioSynth.prototype);
	a.ctx=ctx;
	a._stemMusic={attach(){},mixer:null};
	a.settings={masterVolume:1,musicVolume:1,sfxVolume:1,
		windVolume:1,windEnabled:true,musicVocals:true};
	a._lastSfx={};a._musicMode='run';a._paused=false;
	a._windActive=false;a._windRelativePxS=0;a._windAtmosphere=0;
	a._bsodDanger01=0;
	a._ready=()=>true; // OfflineAudioContext is 'suspended' until render.
	a._buildGraph();
	a.nodes.master.gain.value=1;
	a.nodes.musicBus.gain.value=.55;
	a.nodes.sfxBus.gain.value=.9;
	return a;
}
function setOriginalSourceMix(ctx,a,originals,{biome,mode}){
	const mixer=new StemFXMixer(ctx,a.nodes.musicFilter,{roomQuality:'standard'});
	mixer.selectBiome(biome);
	a._stemMusic.mixer=mixer;
	if(mode==='music-only')mixer.setRoomWetEnabled(true);
	for(const role of originals.roles){
		const source=originals.sources.get(role);
		const effects=mode==='dry-originals'?[]:
			role==='vocals'?[]:
			role.startsWith('voice:')?melodyPreset(biome):
			[...sourceOnlyExtras(biome,role),...orchestraPreset(biome,role)];
		const gain=role==='vocals'?1:role.startsWith('voice:')?.18:1;
		const input=mixer.addSource(role,{gain,effects});
		const playback=ctx.createBufferSource();
		playback.buffer=source;
		playback.connect(input);
		playback.start(START);
	}
	return mixer;
}
async function render({pack,segmentIndex=0,biome,scenario='mixed-game-stress',
	profile='standard'}){
	if(!['mixed-game-stress','music-only','sfx-wind-only'].includes(scenario))
		throw Error('Unknown QA scenario');
	if(!['standard','crash-static-overlap'].includes(profile))throw Error('Invalid QA profile');
	const original=await decodeOriginals(pack,segmentIndex,biome);
	const ctx=new OfflineAudioContext(2,Math.round(RENDER_SECONDS*RATE),RATE);
	// Pin only the presentational wind/SFX noise for repeatable source QA.
	// Does not seed or advance gameplay RNG or touch normal game sessions.
	seedCosmeticRandom(QA_COSMETIC_SEED);
	const a=actualAudioSynthGraph(ctx);
	const mixer=scenario==='sfx-wind-only'?null:setOriginalSourceMix(ctx,a,original,
		{biome,mode:scenario});
	let installedAudioSources=original.roles.length;
	if(scenario==='sfx-wind-only')installedAudioSources=0;
	const sent=[];
	// Gameplay events scheduled through REAL AudioSynth methods at the
	// corresponding OfflineAudioContext time. Source bass/stems are authentic
	// OGG; scripted SFX event times are not claimed to be real replay events.
	const timeline=profile==='crash-static-overlap'?[
		...EVENTS.slice(0,5),
		{at:2.62,action:'static-glitch',note:'Second genuine AudioSynth.glitch overlaps crash SFX and sustained BSOD wind'},
		EVENTS[5],
	]:EVENTS;
	const programs=scenario==='music-only'?[]:timeline.map(item=>({
		item,
		promise:ctx.suspend(item.at).then(async()=>{
			if(item.action==='bsod-wind'){
				a._onBsodState({active:true,relativeAirX:1800,
					atmosphereDensity:1,proximity01:.98,timeToImpactMs:250});
			}else if(item.action==='static-glitch'){
				a.glitch('static',950,.92);
			}else if(item.action==='hard-landing'){
				a._onLanding({quality:'sloppy',hard:true});
			}else if(item.action==='fatal-crash-sfx'){
				a.playSfx('crash');
			}else a.playSfx(item.action);
			sent.push({at:item.at,action:item.action,ctxTime:ctx.currentTime});
			await ctx.resume();
		}),
	}));
	const pcm=await ctx.startRendering();
	await Promise.all(programs.map(x=>x.promise));
	const window=measureFourTimesTruePeak(pcm,{
		startFrame:Math.floor(.20*RATE),
		endFrame:Math.floor(3.85*RATE),
	});
	mixer?.destroy();
	return {pack,trackId:original.manifest.id,sourceSegment:segmentIndex,
		sourceFrameStart:original.segment.startFrame,biome,scenario,
		sourceHashes:original.hashes,sourceRoles:original.roles,
		originalSourceCount:installedAudioSources,
		productionGraph:{
			AudioSynthBuildGraph:a.nodes.master instanceof GainNode,
			productionSfx:a.nodes.sfxBus instanceof GainNode,
			productionWind:a.nodes.windGain instanceof GainNode,
			productionStatic:a.nodes.staticGain instanceof GainNode,
			productionCompressor:a.nodes.comp instanceof DynamicsCompressorNode,
			productionPeakGuard:a.nodes.peakGuard instanceof WaveShaperNode &&
				a.nodes.peakGuard.curve instanceof Float32Array,
			// WebAudio does not expose an API to introspect cable topology;
			// the original AudioSynth._buildGraph() above owns connections.
			postCompressorGuardNodeActive:a.nodes.peakGuard?.numberOfOutputs===1,
		},
		test:{profile,qaCosmeticSeed:QA_COSMETIC_SEED,renderSeconds:RENDER_SECONDS,windowSeconds:3.65,sampleRate:RATE,
			master:1,music:scenario==='sfx-wind-only'?0:1,
			sfx:scenario==='music-only'?0:1,wind:scenario==='music-only'?0:1,
			originalVocals:true,originalMelodyWithVocalsGain:.18,
			eventOrigin:'scripted OFFLINE stress timeline, not authoritative physics/replay',
			events:sent},
		...window,sourceFingerprintInputs:Object.keys(original.hashes).length,
	};
}
window.__mixedFinalAudioQA=Object.freeze({render,measureFourTimesTruePeak,EVENTS,FXS});
