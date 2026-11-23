/** Internal browser QA: original stereo recordings, not synthetic fixture audio.
 *  Unlike a real game output, there is intentionally NO final compressor,
 *  room convolution, player volume, or SFX. Report precompressor risk only.
 */
import {buildMusicChain} from '../../src/systems/music/MusicFXGraph.js';
import {orchestraPreset,melodyPreset} from '../../src/systems/music/DynamicOrchestraPresets.js';
const ROLES=['drums','bass','guitar','piano','other'];
export const BIOMES=[
	'debutmont','garbage-dump-glacier','underwater-mountain',
	'micro-mountain','crystal-cavern','steampunk-slopes',
	'sky-jellyfish-mountain','vertigo-vents','candy-cane-canyon',
	'space-mountain','pyramid-peak','bitstream-bluffs'
];
const sourceGain=role=>role==='drums'?.9:role==='bass'?.75:.65;
// These gains are explicit TEST assumptions, not inferred real mix settings.
// The original game has additional user volumes, sends, adaptive mix,
// original vocals, dynamics compressor, and gameplay SFX.
const TEST_MASTER=.55,TEST_LEAD=.75;
const SECONDS=2.5,SAMPLE_RATE=48000;

export async function load(pack){
	if(!/^[a-zA-Z0-9_-]+$/.test(pack))throw Error('Invalid test pack id');
	const manifestResponse=await fetch('/music/packs/'+pack+'/pack.json');
	if(!manifestResponse.ok)throw Error('No original source pack '+pack);
	const manifest=await manifestResponse.json();
	const sourceTable=manifest.segments?.[0]?.sources;
	if(!sourceTable)throw Error('Missing first segment sources '+pack);
	const keys=new Set([...ROLES,'vocals',...BIOMES.map(b=>'voice:'+b)]);
	const ctx=new AudioContext();
	try{
		const decoded=new Map();
		for(const key of keys){
			const relative=sourceTable[key];
			if(!relative)throw Error('Missing '+key+' in '+pack);
			// The build manifest canonicalizes the Debutmont key/path, but
			// the immutable archive still stores adaptive/debumont. The
			// real music loader already has this supported legacy alias.
			const archivedPath=relative.startsWith('adaptive/debutmont/')?
				relative.replace('adaptive/debutmont/','adaptive/debumont/'):relative;
			const response=await fetch('/music/packs/'+pack+'/'+archivedPath);
			if(!response.ok)throw Error('Missing original OGG '+pack+'/'+archivedPath+' HTTP '+response.status);
			decoded.set(key,await ctx.decodeAudioData(await response.arrayBuffer()));
		}
		return {decoded,pack,id:manifest.id};
	}finally{await ctx.close();}
}
function metrics(buffer){
	let energy=0,peak=0,over=0,finite=true;
	for(let channel=0;channel<2;channel++){
		const data=buffer.getChannelData(channel);
		for(const sample of data){
			if(!Number.isFinite(sample))finite=false;
			const abs=Math.abs(sample);
			energy+=sample*sample;
			if(abs>peak)peak=abs;
			if(abs>1)over++;
		}
	}
	return {rms:Math.sqrt(energy/(buffer.length*2)),samplePeak:peak,
		overUnitySampleCount:over,finite};
}
async function render(pack,biome,processed){
	const frames=Math.ceil(SECONDS*SAMPLE_RATE);
	const ctx=new OfflineAudioContext(2,frames,SAMPLE_RATE);
	const master=ctx.createGain();master.gain.value=TEST_MASTER;master.connect(ctx.destination);
	const chains=[];
	const push=(role,fxSpecs,level)=>{
		const buffer=pack.decoded.get(role);
		if(!buffer)throw Error('No decoded source '+pack.pack+'/'+role);
		const source=ctx.createBufferSource(),gain=ctx.createGain();
		gain.gain.value=level;
		source.buffer=buffer;source.connect(gain);
		if(fxSpecs){
			const chain=buildMusicChain(ctx,fxSpecs,master);
			chains.push(chain);gain.connect(chain.input);
			// Test a strong physical source processing state, not a fake beat.
			const effect=chain.stages[0],id=effect?.id;
			const fields={
				snowpack:{depth:1.0},scrapheap:{contact:1.0},
				hydrostatic:{pressure:1.0},microbox:{openness:1.0},
				crystallattice:{openness:1.0},steamworks:{airborne:true},
				jellybloom:{airborne:true},ventforge:{strength:1.0},
				sugarfizz:{speed:1.0,airborne:true},
				orbitfield:{weightless:1.0,lowGravity:.5},
				sunstone:{loft:1.0},arcadeglue:{bridge:false,intensity:1.25}
			}[id]||{};
			for(const [key,value] of Object.entries(fields)){
				if(effect?.refs?.[key])effect.set(key,value,0);
			}
		}else gain.connect(master);
		source.start(0);
	};
	for(const role of ROLES)
		push(role,processed?orchestraPreset(biome,role):null,sourceGain(role));
	const voice='voice:'+biome;
	push(voice,processed?melodyPreset(biome):null,TEST_LEAD);
	const result=await ctx.startRendering();
	for(const chain of chains)chain.dispose();
	return metrics(result);
}
async function audit(packs){
	const reports=[];
	for(const packId of packs){
		const song=await load(packId);
		const cases=[];
		for(const biome of BIOMES){
			// Compare the SAME ORIGINAL lead and all five source stems in
			// this biome with and without DSP, not a different biome's lead.
			const dry=await render(song,biome,false);
			const data=await render(song,biome,true);
			cases.push({biome,dry,...data,peakRelativeDry:dry.samplePeak>0?
				data.samplePeak/dry.samplePeak:null,
				rmsRelativeDry:dry.rms>0?data.rms/dry.rms:null});
		}
		reports.push({pack:packId,trackId:song.id,
			test: {durationSeconds:SECONDS,sampleRate:SAMPLE_RATE,
				master:TEST_MASTER,voiceLead:TEST_LEAD,
				roleGains:Object.fromEntries(ROLES.map(role=>[role,sourceGain(role)]))},
			cases});
	}
	return reports;
}
window.__crossPackOriginalAudioQA=Object.freeze({audit});
