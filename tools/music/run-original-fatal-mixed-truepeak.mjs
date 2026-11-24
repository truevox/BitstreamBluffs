#!/usr/bin/env node
/**
 * Source-bound production FatalCrashCountIn native WebAudio headroom
 * versus an otherwise identical original song + SFX/wind/static control.
 * Real FatalCrashCountIn.start + original recorded drum excerpt,
 * never a fabricated MIDI beat or placeholder recording.
 */
import assert from 'node:assert/strict';
import {assertSafeFatalPair} from './fatal-qa-peak-gate.js';
import {existsSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const url=process.env.QA_URL||'http://127.0.0.1:8220';
const output=process.env.REPORT_OUT;
const songIndex=Number(process.env.QA_SONG_INDEX);
const full33=process.env.QA_ALL_33==='1';
if(!output||existsSync(output))throw Error('Provide unique immutable REPORT_OUT');
if(!Number.isInteger(songIndex)||songIndex<0||songIndex>(full33?32:3))
	throw Error('QA_SONG_INDEX out of range for requested source-library coverage');
const report={
	format:'bitstream-native-original-drums-fatal-countin-final-mixed-4x-v1',
	qaUrl:url,songIndex,full33,startedAt:new Date().toISOString(),cases:[],
	limitations:[
		'This invokes the real original-drum FatalCrashCountIn.start; only its WebAudio running-state check is served by a test facade because OfflineAudioContext.suspend keeps native state suspended while scheduling',
		'Count-in timing remains SYNTHETIC UNVERIFIED; no source beat-grid verification, musical downbeat or release tempo authority',
		'Audio input is authentic original OGG; song excerpts, not uninterrupted full songs',
		'All collision, static, wind and event times are scripted QA events, not actual gameplay replays',
		'48-tap 4x sinc intersample estimate is not a certified ITU-R BS.1770 meter or release mastering',
	]};
const browser=await chromium.launch({headless:true,args:['--no-sandbox',
	'--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
	'--ignore-gpu-blocklist']});
const errors=[],httpErrors=[];
try{
	const page=await browser.newPage({viewport:{width:1000,height:700}});
	page.on('pageerror',e=>errors.push(String(e)));
	page.on('response',r=>{if(r.status()>=400)httpErrors.push({status:r.status(),url:r.url()})});
	await page.goto(url+'/tools/music/qa-mixed-final-output.html',{waitUntil:'load',timeout:30000});
	await page.waitForFunction(()=>window.__mixedFinalAudioQA?.compareOriginalFatal,
		null,{timeout:30000});
	const songs=await page.evaluate(async()=>{
		const r=await fetch('/music/catalog.json');
		if(!r.ok)throw Error('No private original source catalog');
		const catalog=await r.json();
		assertLocal(catalog?.tracks?.length===33,'Expected original 33-song catalog');
		return catalog.tracks.map(t=>({id:t.id,title:t.title,
			pack:t.manifest.split('/')[1]}));
		function assertLocal(ok,text){if(!ok)throw Error(text)}
	});
	const song=songs[songIndex];
	const count=await page.evaluate(async pack=>{
		const r=await fetch('/music/packs/'+pack+'/pack.json');
		if(!r.ok)throw Error('Missing original song pack');
		return (await r.json()).segments.length;
	},song.pack);
	assert.ok(count>=3);
	const indices=full33?[0]:[0,Math.floor((count-1)/2),count-1];
	for(const segment of indices){
		for(const biome of full33?['garbage-dump-glacier']:
			['garbage-dump-glacier','vertigo-vents']){
			console.log('NATIVE_SOURCE_FATAL_STRESS_START',songIndex,song.id,segment,biome);
			const item=await page.evaluate(args=>
				window.__mixedFinalAudioQA.compareOriginalFatal(args),
				{pack:song.pack,segmentIndex:segment,biome});
			assert.equal(item.trackId,song.id);
			assert.equal(item.sourceSegment,segment);
			assert.equal(item.originalSourceCount,7);
			assert.equal(item.includeCountIn,true);
			assert.equal(item.countIn?.drumSource,'original-decoded-ogg-drums');
			assert.equal(item.countIn?.scheduledDrumAccents,4);
			assert.equal(item.countIn?.verified,false);
			assert.equal(item.countIn?.timingKind,'synthetic-unverified');
			assert.equal(item.countIn?.originalDrumSourceSha256.length,64);
			assert.equal(item.peakGate,true);
			assert.equal(item.qaCosmeticSeed,0x2912026);
			assert.equal(item.offlineSchedulingStateFacade,true);
			assert.equal(item.countInVsRealOriginalNoCountIn.length,4);
			for(const hit of item.countInVsRealOriginalNoCountIn){
				assert.ok(hit.positiveRms>.0001,'Original beat missing from final PCM');
				assert.ok(hit.pcmDifferenceRms>.001,
					'Real original-drum treatment did not change final output at hit '+hit.beat);
			}
			for(let i=1;i<item.countIn.beatOnsets.length;i++)
				assert.ok(Math.abs(item.countIn.beatOnsets[i]-
					item.countIn.beatOnsets[i-1]-.5)<1e-9);
			assert.deepEqual(item.control.sourceHashes,item.sourceHashes);
			assert.equal(item.control.countIn,null);
			assertSafeFatalPair(item); // both positive and no-count-in original-stereo controls
			assert.equal(item.sampleClips,0,'Actual count-in composite samples clipped');
			assert.equal(item.estimatedTrueClips4x,0,'Count-in 4x true peak overs');
			assert.equal(item.nonfiniteSamples,0);
			assert.ok(item.estimatedTruePeak4x<1,'Final count-in true peak not safe');
			report.cases.push(item);
			console.log('NATIVE_ORIGINAL_FATAL_SOURCE_4X_PASS',song.title,segment,biome,
				'hits',item.countIn.scheduledDrumAccents,
				'minHitDelta',Math.min(...item.countInVsRealOriginalNoCountIn
					.map(x=>x.pcmDifferenceRms)).toFixed(5),
				'peakDbTp',item.estimatedTruePeakDbTp4x.toFixed(3));
		}
	}
	assert.equal(report.cases.length,full33?1:6);
	assert.deepEqual(errors,[]);
	assert.deepEqual(httpErrors,[]);
	const high=report.cases.reduce((a,b)=>
		b.estimatedTruePeak4x>a.estimatedTruePeak4x?b:a);
	report.status=full33?'PASS_ONE_NATIVE_ORIGINAL_DRUM_FATAL_MIXED_CASE_NOT_MASTERED':
		'PASS_SIX_NATIVE_ORIGINAL_DRUM_FATAL_MIXED_CASES_NOT_MASTERED';
	report.summary={songId:song.id,cases:report.cases.length,
		actualOriginalDrumHits:report.cases.length*4,
		controls:report.cases.length,sourceInputs:report.cases.reduce((a,x)=>
			a+Object.keys(x.sourceHashes).length,0),
		minControlPcmDifferenceRms:Math.min(...report.cases.flatMap(x=>
			x.countInVsRealOriginalNoCountIn.map(y=>y.pcmDifferenceRms))),
		maxEstimated4xTruePeak:high.estimatedTruePeak4x,
		maxEstimated4xDbTp:high.estimatedTruePeakDbTp4x,
		maxCase:{songId:high.trackId,biome:high.biome,segment:high.sourceSegment},
		httpErrors:0,pageErrors:0};
	console.log(full33?'ONE_LIBRARY_NATIVE_FATAL_MIX_PASS':'SIX_NATIVE_ORIGINAL_FATAL_MIXES_PASS',JSON.stringify(report.summary));
}catch(error){
	report.status='FAIL_OR_INCOMPLETE';
	report.error=String(error);
	report.httpErrors=httpErrors;report.pageErrors=errors;
	console.error('NATIVE_ORIGINAL_FATAL_MIXED_FAIL',String(error));
	process.exitCode=1;
}finally{
	report.completedAt=new Date().toISOString();
	writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
	await browser.close();
}
