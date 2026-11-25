#!/usr/bin/env node
/** Real original-OGG / production master mixed-output QA, no source mutation. */
import assert from 'node:assert/strict';
import {mixedOverlapCases} from './mixed-overlap-cases.js';
import {existsSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {auditVerdictExitCode} from './audit-verdict-exit.js';
const base=(process.env.QA_URL||'http://127.0.0.1:8220').replace(/\/+$/,'');
const dest=process.env.REPORT_OUT;
if(!dest||existsSync(dest))throw Error('Unique REPORT_OUT required; no existing evidence overwrite');
const published=process.env.QA_R2==='1';
const catalogUrl=published?'https://bsb-audio.bearcave.win/releases/20261124-69a6fb46/catalog.json':'/music/catalog.json';
const highRisk=['candy-cane-canyon','garbage-dump-glacier','vertigo-vents','crystal-cavern','bitstream-bluffs'];
const phase=process.env.QA_R2_PHASE||'middle';
if(!['opening','middle','ending'].includes(phase)||(!published&&phase!=='middle'))throw Error('Invalid R2 phase');
const position=['opening','middle','ending'].indexOf(phase);
const publicScenarios=Array.from({length:33},(_,songIndex)=>({
	songIndex,position,biome:highRisk[(songIndex+position+4)%highRisk.length],
	scenario:'mixed-game-stress',profile:'crash-static-overlap',
}));
const allScenarios=published?publicScenarios:process.env.QA_EXTENDED==='1'?
	[0,1,2,3].flatMap(songIndex=>[0,1,2].flatMap(position=>
		['garbage-dump-glacier','vertigo-vents','crystal-cavern','bitstream-bluffs']
			.map(biome=>({songIndex,position,biome,scenario:'mixed-game-stress'})))):
[
	{songIndex:1,segment:12,biome:'garbage-dump-glacier',scenario:'mixed-game-stress'},
	{songIndex:1,segment:12,biome:'garbage-dump-glacier',scenario:'music-only'},
	{songIndex:1,segment:12,biome:'garbage-dump-glacier',scenario:'sfx-wind-only'},
	{songIndex:0,segment:0,biome:'vertigo-vents',scenario:'mixed-game-stress'},
	{songIndex:2,segment:3,biome:'crystal-cavern',scenario:'mixed-game-stress'},
	{songIndex:3,segment:4,biome:'bitstream-bluffs',scenario:'mixed-game-stress'},
];
const songFilter=process.env.QA_SONG_INDEX==null?null:Number(process.env.QA_SONG_INDEX);
if(songFilter!==null&&(!Number.isInteger(songFilter)||songFilter<0||songFilter>(published?32:3)))
	throw Error('Invalid QA_SONG_INDEX for selected catalog mode');
const overlap=process.env.QA_OVERLAP==='1';
if(published&&overlap)throw Error('Published matrix already includes crash/static overlap');
const scenarios=overlap?
	mixedOverlapCases():
	songFilter===null?allScenarios:allScenarios.filter(x=>x.songIndex===songFilter);
if(!scenarios.length)throw Error('No source scenario selected');
const results=[],errors=[],httpErrors=[];
const report={format:'bitstream-sim8-original-mixed-output-4x-estimate-v1',
	referenceUrl:base,catalogUrl,sourceMode:published?'pinned-public-r2':'local-private',matrixPhase:published?phase:null,startedAt:new Date().toISOString(),
	scenarios:results,method:'Actual AudioSynth._buildGraph, SFX/wind/static APIs, real original source stems, full post-compressor peak guard; cosmetic noise seeded to fixed 0x2912026 for repeatability; 48kHz OfflineAudioContext, 48-tap 4x intersample estimate',
	limitations:[
		'Scripted stress SFX event schedule; NOT actual terrain traversal or replay',
		'4.1s excerpt from each selected segment; NOT complete 33 songs or segment transitions',
		'Does not include four-beat original-drum FatalCrashCountIn, only native crash SFX',
		'4x finite-window estimate is NOT a certified ITU BS.1770 true-peak meter',
		'No ChromeOS/Android CPU testing, no human mix approval',
	]};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle',
	'--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist',
	'--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage({viewport:{width:900,height:600}});
	page.on('pageerror',e=>errors.push(String(e)));
	page.on('response',r=>{if(r.status()>=400)httpErrors.push({status:r.status(),url:r.url()})});
	await page.goto(base+'/tools/music/qa-mixed-final-output.html',{waitUntil:'load',timeout:30000});
	await page.waitForFunction(()=>!!window.__mixedFinalAudioQA,null,{timeout:20000});
	const songs=await page.evaluate(async catalogUrl=>{
		const r=await fetch(catalogUrl);
		if(!r.ok)throw Error('Private original music catalog not found');
		const c=await r.json();
		return c.tracks.map(x=>({id:x.id,title:x.title,pack:x.manifest.split('/')[1],manifestUrl:new URL(x.manifest,new URL(catalogUrl,location.href)).href}));
	},catalogUrl);
	assert.equal(songs.length,33);
	// Resolve beginning/middle/last from the REAL pack metadata rather
	// than assuming all four original songs have equal segment counts.
	const segmentsByPack=new Map();
	for(const item of scenarios){
		if(item.position==null)continue;
		const song=songs[item.songIndex];
		if(!segmentsByPack.has(song.pack)){
			const count=await page.evaluate(async manifestUrl=>{
				const r=await fetch(manifestUrl);
				if(!r.ok)throw Error('Cannot inspect original pack');
				const m=await r.json();
				return m.segments?.length;
			},song.manifestUrl);
			assert.ok(count>=3);
			segmentsByPack.set(song.pack,count);
		}
		const count=segmentsByPack.get(song.pack);
		item.segment=[0,Math.floor((count-1)/2),count-1][item.position];
	}
	for(const [i,task] of scenarios.entries()){
		const song=songs[task.songIndex];
		console.log('MIXED_SOURCE_START',i+1,'/',scenarios.length,
			song.title,task.biome,task.scenario,'segment',task.segment);
		const r=await page.evaluate(args=>window.__mixedFinalAudioQA.render(args),{
			pack:song.pack,segmentIndex:task.segment,biome:task.biome,scenario:task.scenario,profile:task.profile||'standard',manifestUrl:published?song.manifestUrl:null,windowPosition:published&&phase!=='middle'?phase:'legacy'});
		assert.equal(r.trackId,song.id);
		if(published)assert.equal(r.sourceManifestUrl,song.manifestUrl);
		assert.equal(r.productionGraph.productionPeakGuard,true);
		assert.equal(r.originalSourceCount,task.scenario==='sfx-wind-only'?0:7);
		assert.equal(r.nonfiniteSamples,0);
		assert.equal(r.test.qaCosmeticSeed,0x2912026);
		assert.ok(r.estimatedTruePeak4x>=r.samplePeak-1e-9);
		assert.equal(r.test.events.length,task.scenario==='music-only'?0:task.profile==='crash-static-overlap'?7:6);
		results.push(r);
		console.log('MIXED_SOURCE_RESULT',i+1,
			'sample',r.samplePeak.toFixed(6),
			'4xTP',r.estimatedTruePeak4x.toFixed(6),
			'dBTP',r.estimatedTruePeakDbTp4x.toFixed(2),
			'over',r.sampleClips,'4xOver',r.estimatedTrueClips4x);
	}
	const mixed=results.filter(x=>x.scenario==='mixed-game-stress');
	const worst=mixed.reduce((a,b)=>b.estimatedTruePeak4x>a.estimatedTruePeak4x?b:a);
	report.scenarios=results;
	report.highestMixed={trackId:worst.trackId,biome:worst.biome,segment:worst.sourceSegment,
		samplePeak:worst.samplePeak,estimatedTruePeak4x:worst.estimatedTruePeak4x,
		estimatedTruePeakDbTp4x:worst.estimatedTruePeakDbTp4x};
	report.summary={songs:new Set(mixed.map(x=>x.trackId)).size,mixedCases:mixed.length,
		allCases:results.length,
		overUnityAllSamples:results.reduce((a,x)=>a+x.sampleClips,0),
		overUnityAllTruePeak4xFrames:results.reduce((a,x)=>a+x.estimatedTrueClips4x,0),
		overUnityMixedSamples:mixed.reduce((a,x)=>a+x.sampleClips,0),
		overUnityMixedTruePeak4xFrames:mixed.reduce((a,x)=>a+x.estimatedTrueClips4x,0),
		totalHashedSourceInputs:results.reduce((a,x)=>a+Object.keys(x.sourceHashes).length,0),
		pageErrors:errors.length,httpErrors:httpErrors.length};
	report.status=errors.length||httpErrors.length?'INVALID_BROWSER_OR_HTTP_ERRORS':
		report.summary.overUnityAllSamples?'FAILED_SAMPLE_PEAK':
		report.summary.overUnityAllTruePeak4xFrames?'FAILED_ESTIMATED_4X_TRUE_PEAK':
        results.some(x=>!Number.isFinite(x.samplePeak)||x.samplePeak>=1)?'FAILED_SAMPLE_PEAK':
        results.some(x=>!Number.isFinite(x.estimatedTruePeak4x)||x.estimatedTruePeak4x>=1)?'FAILED_ESTIMATED_4X_TRUE_PEAK':
        'PASS_SAMPLED_MIXED_OUTPUT_4X_ESTIMATE';
	report.browserErrors=errors;report.httpErrors=httpErrors;
	process.exitCode=auditVerdictExitCode(report.status);
	console.log('MIXED_OUTPUT_AUDIT',report.status,JSON.stringify(report.summary),
		'max_dBTP',report.highestMixed.estimatedTruePeakDbTp4x.toFixed(2));
}catch(error){
	report.status='INVALID_INCOMPLETE';
	report.failure=String(error);
	report.browserErrors=errors;report.httpErrors=httpErrors;
	console.error('MIXED_OUTPUT_AUDIT_FAILED',String(error));
	process.exitCode=1;
}finally{
	report.completedAt=new Date().toISOString();
	writeFileSync(dest,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
	await browser.close();
}
