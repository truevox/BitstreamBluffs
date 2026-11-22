#!/usr/bin/env node
/** Measured Web Audio OfflineAudioContext render of unmodified source OGG stems.
 * Uses THE SAME source clock and shared DSP graph as the live Crystal audition.
 * Gate sample clipping, wet/dry discontinuity, excessive level changes; no WAV writes.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.BITSTREAM_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../public');
const packRelative='music/packs/33_local-one-more-run-bitstream-bluffs';
const fullSource=process.env.BITSTREAM_FULL_SOURCE_PACK ? path.resolve(process.env.BITSTREAM_FULL_SOURCE_PACK) : path.resolve(root,packRelative);
const manifest=await readFile(path.join(root,packRelative,'pack.json'));
assert.equal(createHash('sha256').update(manifest).digest('hex'),
	createHash('sha256').update(await readFile(path.join(fullSource,'pack.json'))).digest('hex'));
const media={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.ogg':'audio/ogg','.html':'text/html'};
const server=createServer(async(req,res)=>{
	const url=new URL(req.url||'/','http://127.0.0.1');
	const requestPath=decodeURIComponent(url.pathname);
	if(requestPath.includes('..') || !requestPath.startsWith('/')) {res.writeHead(403).end();return;}
	const ogg=requestPath.startsWith('/'+packRelative+'/')&&requestPath.endsWith('.ogg');
	const base=ogg?fullSource:root;
	const file=path.resolve(base,ogg?path.basename(requestPath):requestPath.slice(1));
	if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
	try{res.writeHead(200,{'content-type':media[path.extname(file)]||'application/octet-stream'}).end(await readFile(file));}
	catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
let browser;
try{
	browser=await chromium.launch({headless:true,executablePath:process.env.BITSTREAM_CHROMIUM||undefined,
		args:['--no-sandbox','--disable-dev-shm-usage']});
	const page=await browser.newPage();
	const errors=[];page.on('pageerror',e=>errors.push(e.message));
	await page.goto(`http://127.0.0.1:${server.address().port}/music-review/crystal-harmony/index.html`);
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent.startsWith('Ready:'),null,{timeout:20000});
	const results=await page.evaluate(async()=>{
		const [{createCrystalGraph,synthesizeLanding}, {resonanceNotes,rowAtSourceTime},
			{sourceClipSlices,sourceStemURL}]=await Promise.all([
			import('/music-review/crystal-harmony/graph.mjs'),
			import('/music-review/crystal-harmony/resonators.mjs'),
			import('/music-review/downbeat-review/clock.mjs')]);
		const [pack,packet,harmony]=await Promise.all([
			fetch('/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json').then(x=>x.json()),
			fetch('/music-review/downbeat-review/candidates.json').then(x=>x.json()),
			fetch('/music-review/crystal-harmony/harmony.json').then(x=>x.json())]);
		const decoder=new AudioContext({sampleRate:48000});
		const buffers=new Map();
		const roles=['vocals','drums','bass','guitar','piano','other'];
		for(const si of Array.from({length:15},(_,i)=>i)){
			for(const role of roles){
				const sha=packet.windows[si]?.originalStemHashesSha256?.[role];
				if(!sha)throw Error('Missing source fingerprint');
				const bytes=await fetch(sourceStemURL(pack,si,role)).then(x=>x.arrayBuffer());
				const got=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
					.map(v=>v.toString(16).padStart(2,'0')).join('');
				if(got!==sha)throw Error('Source OGG SHA mismatch: '+si+' '+role);
				buffers.set(`${si}:${role}`,await decoder.decodeAudioData(bytes));
			}
		}
		await decoder.close();
		const rms=x=>Math.sqrt(x.reduce((sum,v)=>sum+v*v,0)/x.length);
		const metrics=(render)=>{
			const n=render.length,c=render.numberOfChannels;
			let peak=0,sum=0,maxDelta=0,clipped=0,mono=0;
			for(let ch=0;ch<c;ch++){
				const samples=render.getChannelData(ch);
				for(let i=0;i<n;i++){
					const x=samples[i];peak=Math.max(peak,Math.abs(x));sum+=x*x;
					if(Math.abs(x)>=.9999)clipped++;
					if(i>0)maxDelta=Math.max(maxDelta,Math.abs(x-samples[i-1]));
				}
			}
			const left=render.getChannelData(0),right=render.getChannelData(1);
			for(let i=0;i<n;i++){const m=(left[i]+right[i])*.5;mono+=m*m;}
			return {peak:Math.round(peak*1e6)/1e6,rms:Math.round(Math.sqrt(sum/(n*c))*1e6)/1e6,
				maxAdjacentSampleDelta:Math.round(maxDelta*1e6)/1e6,clippedFrames:clipped,
				monoRms:Math.round(Math.sqrt(mono/n)*1e6)/1e6};
		};
		const render=async(startS,endS,wet,landing=false,toggle=false)=>{
			const len=endS-startS;
			const ctx=new OfflineAudioContext(2,Math.ceil((len+1.5)*48000),48000);
			const at=.1;
			const graph=createCrystalGraph(ctx,{destination:ctx.destination,harmony,
				sourceStart:startS,sourceEnd:endS,startAt:at,dryGain:.23,wetMix:wet});
			if(toggle){
				graph.wetControl.gain.setValueAtTime(0,at);
				graph.wetControl.gain.setTargetAtTime(.20,at+2,.045);
				graph.wetControl.gain.setTargetAtTime(0,at+5,.045);
			}
			const slices=sourceClipSlices(pack,startS,endS);
			for(const slice of slices){
				for(const role of roles){
					const buffer=buffers.get(`${slice.segmentIndex}:${role}`);
					if(!buffer)throw Error('Missing original audio buffer');
					const node=ctx.createBufferSource();node.buffer=buffer;
					node.connect(graph.dry);
					if(['guitar','piano','other'].includes(role))node.connect(graph.input);
					const time=at+slice.clipOffsetSeconds;
					const duration=Math.min(slice.durationSeconds,buffer.duration-slice.bufferOffsetSeconds);
					node.start(time,slice.bufferOffsetSeconds,duration);
				}
			}
			let landingNotesScheduled=0;
			if(landing){
				const sourceTime=startS+len*.47;
				const notes=resonanceNotes(rowAtSourceTime(harmony,sourceTime));
				if(notes.length){
					landingNotesScheduled=notes.length;
					synthesizeLanding(ctx,graph,notes,1,at+len*.47);
				}
			}
			const began=performance.now();
			const result=await ctx.startRendering();
			return {...metrics(result),renderTimeMs:Math.round(performance.now()-began),
				channelCount:result.numberOfChannels,landingNotesScheduled,toggle,originalSourceStart:startS,
				originalSourceEnd:endS,wet,landing,changeCount:graph.changeCount,
				// We only measure the dry/wet difference in precisely matched regions.
				rendered:result};
		};
		const out=[];
		if(packet.suggestedSourcePassages.length!==12 || packet.suggestedSourcePassages.some(p=>!p.candidateOnly||p.humanVerified))
			throw Error('Unexpected passage coverage / candidate verification promotion');
		for(const [start,end] of packet.suggestedSourcePassages.map(p=>p.suggestedListenRangeSeconds)){
			const dry=await render(start,end,0);
			const normal=await render(start,end,.20);
			const max=await render(start,end,.55,true);
			const toggled=await render(start,end,0,false,true);
			const compare=(a,b)=>{
				let sum=0,peak=0,delta=0;
				for(let ch=0;ch<2;ch++){
					const x=a.rendered.getChannelData(ch),y=b.rendered.getChannelData(ch);
					for(let i=0;i<x.length;i++){
						const d=y[i]-x[i];sum+=d*d;peak=Math.max(peak,Math.abs(d));
						if(i>0)delta=Math.max(delta,Math.abs(d-(y[i-1]-x[i-1])));
					}
				}
				return {wetDifferenceRms:Math.round(Math.sqrt(sum/(2*a.rendered.length))*1e6)/1e6,
					wetDifferencePeak:Math.round(peak*1e6)/1e6,
					wetResidualMaxAdjacentDelta:Math.round(delta*1e6)/1e6};
			};
			const compareNormal=compare(dry,normal),compareMax=compare(dry,max),
				compareToggle=compare(dry,toggled);
			out.push({range:[start,end],dry:{...dry,rendered:undefined},
				normal:{...normal,rendered:undefined},
				maxLanding:{...max,rendered:undefined},
				toggle:{...toggled,rendered:undefined},
				...{compareNormal,compareMax,compareToggle}});
		}
		return out;
	});
	console.log('OFFLINE_AUDIO_METRICS',JSON.stringify(results,null,2));
	assert.equal(errors.length,0,'No Chromium page errors');
	// Browser render wall time is nondeterministic; Chromium DSP can also
	// differ by 1e-6 at adjacent-sample/floating-point limits. Store numeric
	// METRICS at a disclosed 1e-4 precision, while full 6-place diagnostics
	// remain in console output. This does not assert bit-identical PCM.
	const stableMetrics=({renderTimeMs,...sampleMeasurements})=>Object.fromEntries(
		Object.entries(sampleMeasurements).map(([k,v])=>[k,typeof v==='number'
			?Math.round(v*10000)/10000:v]));
	const stableDifference=value=>Object.fromEntries(Object.entries(value).map(([k,v])=>
		[k,typeof v==='number'?Math.round(v*10000)/10000:v]));
	const report={format:'bsb-original-ogg-crystal-graph-offline-measured-audio-v1',
		status:'RESEARCH_MEASURED_NOT_APPROVED_SOUND_OR_TRUE_PEAK',
		originalSourceManifestSha256:createHash('sha256').update(manifest).digest('hex'),
		sourceHarmonySidecarSha256:createHash('sha256').update(await readFile(path.join(root,'music-review/crystal-harmony/harmony.json'))).digest('hex'),
		sharedAudioGraphSha256:createHash('sha256').update(await readFile(path.join(root,'music-review/crystal-harmony/graph.mjs'))).digest('hex'),
		originalStemSha256Count:15*6,
		analysisWindowCount:results.length,
		offlineRenderCount:results.length*4,
		method:'The EXACT shared createCrystalGraph + synthesizeLanding as in WebAudio lab; original SHA-verified six OGG stems decoded by Chromium; stereo offline 48000Hz, source-clock slice across OGG segments, 1.5s effect tail, 3 render variants per passage',
		channelCount:2,sampleRate:48000,reportedMetricResolutionFullScale:0.0001,
		variants:['original dry wet=0','original + normal research shimmer wet=.20','original + max allowed shimmer wet=.55 and one impact=1 manually requested bell; if harmony weak, no actual bell notes emitted','wet=.0 to .20 at 2s, then .20 to .0 at 5s, 45ms target smoothing as in live shimmer toggle'],
		limitations:['Sample peak not true peak; no intersample oversampling/limiter guarantee','Overall unweighted RMS level difference is not LUFS or perceptual loudness','Small sample-to-sample wet delta is a click heuristic, not human auditory verification','Offline browser render wall-clock on CT223 is not mobile runtime CPU or memory benchmark','No game source transport, player impacts or biome crossfades exercised','No formal owner ear review or verified harmonic chords/beat grid'],
		passages:results.map(r=>({range:r.range,dry:stableMetrics(r.dry),normal:stableMetrics(r.normal),
			maxLanding:stableMetrics(r.maxLanding),toggle:stableMetrics(r.toggle),
			compareNormal:stableDifference(r.compareNormal),compareMax:stableDifference(r.compareMax),
			compareToggle:stableDifference(r.compareToggle)}))};
	if(process.env.BSB_CRYSTAL_QA_OUT){
		await writeFile(process.env.BSB_CRYSTAL_QA_OUT,JSON.stringify(report,null,2)+'\n');
	}

	for(const row of results){
		assert.equal(row.dry.clippedFrames,0);
		assert.equal(row.normal.clippedFrames,0);
		assert.equal(row.maxLanding.clippedFrames,0);
		assert.equal(row.toggle.clippedFrames,0);
		assert.ok(row.maxLanding.peak<.98,'Rendering near full-scale: '+JSON.stringify(row.range));
		assert.ok(row.normal.peak<.9,'Normal wet clipping risk');
		assert.ok(row.compareNormal.wetDifferenceRms>.00001,'No effect measurable');
		assert.ok(row.compareMax.wetResidualMaxAdjacentDelta<.06,'Wet output has sharp discontinuity');
		assert.ok(row.compareToggle.wetResidualMaxAdjacentDelta<.06,'Dry/wet toggle causes sharp sample jump');
		assert.ok(row.normal.rms<=row.dry.rms*1.35,'Normal shimmer increased overall signal level excessively');
		assert.ok(row.maxLanding.rms<=row.dry.rms*1.8,'Max shimmer plus landing increased overall signal level excessively');
		assert.ok(row.normal.monoRms>row.normal.rms*.4,'Wet stereo folds to near-silence in mono');
	}
	console.log('OFFLINE_AUDIO_QUALITY_PASS source-checked stereo original OGG; Dry/normal/max+landing graph actual shared DSP; no clipping or large wet discontinuities');
}finally{
	if(browser)await browser.close();
	await new Promise(done=>server.close(done));
}
