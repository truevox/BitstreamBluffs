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
import {FatalCrashCountIn,findOriginalDrumAccent,planFatalCountIn} from '../../src/systems/music/FatalCrashCountIn.js';

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
			role==='vocals'?(originals.manifest.effects?.[role]||[]):
			role.startsWith('voice:')?melodyPreset(biome):
			[...sourceOnlyExtras(biome,role),...orchestraPreset(biome,role)];
		const gain=role==='vocals'?1:role.startsWith('voice:')?.18:1;
		const input=mixer.addSource(role,{gain,effects});
		if(mode!=='dry-originals'&&(role==='vocals'||role.startsWith('voice:')))
			mixer.setRoomSend(role,originals.manifest.roomSends?.[role]??null);
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
	const rendering=ctx.startRendering();
	// An event handler can reject while OfflineAudioContext is suspended;
	// awaiting rendering first would hang forever on that error.
	const pcm=await Promise.race([rendering,
		Promise.all(programs.map(x=>x.promise)).then(()=>rendering)]);
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

/**
 * Dedicated native crash count-in master-output stress:
 * instantiate the genuine FatalCrashCountIn class with genuine original
 * recorded drum buffer, original stem recovery gates, native vinyl scratch,
 * and native AudioSynth SFX/wind/static. No surrogate drum taps.
 *
 * OfflineAudioContext.suspend() holds the graph at the exact stress-time.
 * Production FatalCrashCountIn.start() correctly requires a running LIVE
 * AudioContext. For scheduling ONLY, a QA facade reports 'running' while
 * forwarding all native WebAudio constructors/methods to the suspended
 * real OfflineAudioContext. This never changes the production class;
 * audio is actually produced by the genuine nodes upon ctx.resume().
 */
function offlineSchedulingFacade(ctx){
	return new Proxy(ctx,{
		get(target,key){
			if(key==='state')return 'running'; // offline scheduling moment
			const value=Reflect.get(target,key,target);
			return typeof value==='function'?value.bind(target):value;
		}
	});
}
const FATAL_RATE_SECONDS=5.55;
const FATAL_AT=.72;
const FATAL_EVENTS=Object.freeze([
	{at:.28,action:'bsod-wind'},
	{at:.47,action:'hop'},
	{at:FATAL_AT,action:'crash-and-source-countin'},
	{at:1.20,action:'static-glitch'},
	{at:2.40,action:'hazardScramble'},
	{at:3.38,action:'hard-landing'},
]);
function momentEnergy(pcm,start,end){
	const from=Math.max(0,Math.round(start*pcm.sampleRate));
	const last=Math.min(pcm.length,Math.round(end*pcm.sampleRate));
	if(last<=from)throw Error('Invalid original drum hit measure');
	let sum=0,peak=0;
	for(let c=0;c<2;c++){
		const data=pcm.getChannelData(c);
		for(let i=from;i<last;i++){
			const n=data[i];sum+=n*n;peak=Math.max(peak,Math.abs(n));
		}
	}
	return {rms:Math.sqrt(sum/(2*(last-from))),samplePeak:peak};
}
async function renderOriginalFatal({pack,segmentIndex=0,biome='garbage-dump-glacier',
	includeCountIn=true,internalPcm=false}={}){
	if(typeof includeCountIn!=='boolean')throw Error('Invalid count-in condition');
	const original=await decodeOriginals(pack,segmentIndex,biome);
	const ctx=new OfflineAudioContext(2,Math.round(FATAL_RATE_SECONDS*RATE),RATE);
	seedCosmeticRandom(QA_COSMETIC_SEED);
	const a=actualAudioSynthGraph(ctx);
	const mixer=setOriginalSourceMix(ctx,a,original,{biome,mode:'mixed-game-stress'});
	const facade=offlineSchedulingFacade(ctx);
	const countIn=new FatalCrashCountIn(facade,mixer,a._vinylScratch);
	const drum=original.sources.get('drums');
	const cache=new Map([[segmentIndex+'/drums',drum]]);
	const extraDrumHashes={};
	const packBase=new URL('/music/packs/'+pack+'/',location.origin).href;
	// Native FatalCrashCountIn.prepare() can warm an audible original
	// drum segment 1..3 when an original song begins nearly drumless.
	// Implement its source fetch adapter using ONLY the original pack
	// manifest and exact original OGG bytes, never synthetic accents.
	const fetchOriginalDrum=async(info,index,role,token)=>{
		if(token!==1||role!=='drums'||!Number.isInteger(index)||
			index<0||index>=original.manifest.segments.length)
			throw Error('Invalid native original drum warmup');
		const ref=original.manifest.segments[index].sources.drums;
		if(!ref)throw Error('Missing original OGG drum segment');
		const {response}=await fetchMusicAssetResponse(packBase,ref);
		if(!response.ok)throw Error('Cannot decode original fallback drums');
		const bytes=await response.arrayBuffer();
		const digest=await crypto.subtle.digest('SHA-256',bytes);
		extraDrumHashes[index]=[...new Uint8Array(digest)]
			.map(v=>v.toString(16).padStart(2,'0')).join('');
		const decoder=new AudioContext();
		try{cache.set(index+'/drums',await decoder.decodeAudioData(bytes))}
		finally{await decoder.close()}
		return cache.get(index+'/drums');
	};
	const d={
		ctx:facade,pack:original.manifest,track:{id:original.manifest.id},
		cache,packBase,clockStart:START-original.segment.startFrame/RATE,
		started:true,transportPaused:false,
		activeNodes:{size:7},mixer,_loading:false,_token:1,
		_fetchSource:fetchOriginalDrum,
	};
	let selected=null,program=null;
	const events=FATAL_EVENTS.map(item=>ctx.suspend(item.at).then(async()=>{
		switch(item.action){
			case 'bsod-wind':
				a._onBsodState({active:true,relativeAirX:1800,
					atmosphereDensity:1,proximity01:.98,timeToImpactMs:250});
				break;
			case 'hop':a.playSfx('hop');break;
			case 'crash-and-source-countin':
				a.playSfx('crash');
				// The exact original MIDI-like 0.5s plan is synthetic,
				// unverified, but every *sound* comes from source OGG.
				if(includeCountIn){
					if(!findOriginalDrumAccent(d))
						await countIn.prepare(d);
					selected=findOriginalDrumAccent(d);
					if(!selected)throw Error('Original recorded drums lack a usable attack, including native original-pack warmup');
					program=countIn.start(d,{
						timingKind:'synthetic-unverified',runId:'qa-real-original-drum'
					});
					if(!program||program.scheduledDrumAccents!==4||
						program.drumSource!=='original-decoded-ogg-drums')
						throw Error('Native real-source fatal count-in did not schedule all four hits');
					if(countIn.sources.length!==4||
						countIn.sources.some(src=>src.buffer!==selected.buffer))
						throw Error('Count-in tried a surrogate source instead of original OGG');
				}
				break;
			case 'static-glitch':a.glitch('static',950,.92);break;
			case 'hazardScramble':a.playSfx('hazardScramble');break;
			case 'hard-landing':a._onLanding({quality:'sloppy',hard:true});break;
			default:throw Error('Unexpected fatal sound event');
		}
		await ctx.resume();
	}));
	const rendering=ctx.startRendering();
	// Propagate missing real-drum or event-scheduling failures immediately,
	// even when their suspend handler never reached ctx.resume().
	const pcm=await Promise.race([rendering,Promise.all(events).then(()=>rendering)]);
	if(includeCountIn&&!program)throw Error('Missing source drum count-in evidence');
	const measured=measureFourTimesTruePeak(pcm,{
		startFrame:Math.floor(.18*RATE),endFrame:Math.floor(5.40*RATE)});
	const plan=program||planFatalCountIn(FATAL_AT);
	if(!plan||plan.beatOnsets?.length!==4)throw Error('Invalid independent source-count-in timing plan');
	const hitWindows=plan.beatOnsets.map(at=>momentEnergy(pcm,at+.012,at+.12));
	const silenceWindow=momentEnergy(pcm,plan.silenceStart+.1,plan.drumsStart-.1);
	const fullBandWindow=momentEnergy(pcm,plan.bandAt+.2,plan.bandAt+.4);
	const analysis={
		trackId:original.manifest.id,pack,biome,sourceSegment:segmentIndex,
		sourceFrameStart:original.segment.startFrame,sourceHashes:original.hashes,
		originalSourceCount:original.roles.length,
		originalDrumSha256:original.hashes.drums,
		extraOriginalDrumHashes:extraDrumHashes,
		includeCountIn,qaCosmeticSeed:QA_COSMETIC_SEED,
		audioSource:'original decoded OGG drums, real FatalCrashCountIn.start native class',
		offlineSchedulingStateFacade:true,
		countIn:program?{
			sourceSegment:program.sourceSegment,sourceOffset:program.sourceOffset,
			drumSource:program.drumSource,scheduledDrumAccents:program.scheduledDrumAccents,
			verified:program.verified,timingKind:program.timingKind,
			beatOnsets:program.beatOnsets,silenceStart:program.silenceStart,
			drumsStart:program.drumsStart,bandAt:program.bandAt,
			originalDrumOnsetScore:selected.onsetScore,
			originalDrumExcerptSeconds:selected.excerptSeconds,
			originalDrumSourceSha256:selected.segmentIndex===segmentIndex?
				original.hashes.drums:extraDrumHashes[selected.segmentIndex],
		}:null,
		hitWindows,silenceWindow,fullBandWindow,
		peakGate:a.nodes.peakGuard instanceof WaveShaperNode,
		events:FATAL_EVENTS.map(e=>({at:e.at,action:e.action})),
		...measured
	};
	countIn.destroy();mixer.destroy();a._vinylScratch?.destroy();
	return internalPcm?{analysis,pcm}:analysis;
}
function pcmWindowDifferenceRms(a,b,start,end){
	const from=Math.floor(start*a.sampleRate),to=Math.floor(end*a.sampleRate);
	if(a.sampleRate!==b.sampleRate||a.length!==b.length||
		from<0||to>a.length||to<=from)throw Error('Mismatched native comparison PCM');
	let squares=0;
	for(let ch=0;ch<2;ch++){
		const left=a.getChannelData(ch),right=b.getChannelData(ch);
		for(let i=from;i<to;i++)squares+=(left[i]-right[i])**2;
	}
	return Math.sqrt(squares/(2*(to-from)));
}
async function compareOriginalFatal(args={}){
	const positive=await renderOriginalFatal({...args,includeCountIn:true,internalPcm:true});
	const control=await renderOriginalFatal({...args,includeCountIn:false,internalPcm:true});
	if(positive.analysis.trackId!==control.analysis.trackId||
		positive.analysis.sourceSegment!==control.analysis.sourceSegment)
		throw Error('Mismatched source identity in original-drum control');
	const plan=positive.analysis.countIn;
	const windows=plan.beatOnsets.map((time,i)=>({
		beat:i+1,at:time,positiveRms:positive.analysis.hitWindows[i].rms,
		controlRms:control.analysis.hitWindows[i].rms,
		pcmDifferenceRms:pcmWindowDifferenceRms(positive.pcm,control.pcm,time+.012,time+.12),
	}));
	return {...positive.analysis,
		control:{samplePeak:control.analysis.samplePeak,
			estimatedTruePeak4x:control.analysis.estimatedTruePeak4x,
			estimatedTruePeakDbTp4x:control.analysis.estimatedTruePeakDbTp4x,
			sourceHashes:control.analysis.sourceHashes,
			countIn:control.analysis.countIn,
			hitWindows:control.analysis.hitWindows},
		countInVsRealOriginalNoCountIn:windows};
}
window.__mixedFinalAudioQA=Object.freeze({
	render,renderOriginalFatal,compareOriginalFatal,measureFourTimesTruePeak,EVENTS,FXS,FATAL_EVENTS});
