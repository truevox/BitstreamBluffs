#!/usr/bin/env node
/**
 * Offline independent OGG readback of the real production original-drum
 * fatal count-in plus native SFX/wind/room/master stress evidence.
 * Never manufactures source data or modifies a local master.
 */
import assert from 'node:assert/strict';
import {assertSafeFatalPair} from './fatal-qa-peak-gate.js';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.env.BSB291_PRIVATE_AUDIO_ROOT;
const reportsDir=process.env.REPORT_ROOT;
const output=process.env.REPORT_OUT;
if(!root||!reportsDir||!output||existsSync(output))
	throw Error('Must specify canonical private source, report directory and UNIQUE output path');
const source=resolve(root);
const readJson=p=>JSON.parse(readFileSync(p,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const catalog=readJson(join(source,'catalog.json'));
assert.equal(catalog.tracks.length,33);
const songs=catalog.tracks.slice(0,4);
const hashCache=new Map(),results=[],inputs=[];
const baselineName=index=>index===1?
	'issue291-original-fatal-mixed-song-1-test-v1-20261124.json':
	'issue291-original-fatal-mixed-song-'+index+'-v1-20261124.json';
function originalFileBytes(packRoot,relative){
	const path=resolve(packRoot,relative);
	assert.ok(path.startsWith(packRoot+sep),'Untrusted original OGG relative path');
	assert.ok(path.endsWith('.ogg')&&existsSync(path),'No local source OGG '+path);
	if(!hashCache.has(path))hashCache.set(path,sha(readFileSync(path)));
	return hashCache.get(path);
}
for(let index=0;index<4;index++){
	const file=join(reportsDir,baselineName(index));
	assert.ok(existsSync(file),'Missing original fatal-audio source report '+index);
	const bytes=readFileSync(file);
	const report=JSON.parse(bytes);
	assert.equal(report.status,'PASS_SIX_NATIVE_ORIGINAL_DRUM_FATAL_MIXED_CASES_NOT_MASTERED');
	assert.equal(report.songIndex,index);
	assert.equal(report.cases.length,6);
	const song=songs[index];
	const packRoot=resolve(source,song.manifest.replace(/\/pack\.json$/,''));
	const manifest=readJson(join(packRoot,'pack.json'));
	assert.equal(manifest.id,song.id);
	const segments=[0,Math.floor((manifest.segments.length-1)/2),
		manifest.segments.length-1];
	const seen=new Set();
	for(const item of report.cases){
		assert.equal(item.trackId,song.id);
		assert.ok(segments.includes(item.sourceSegment));
		assert.ok(['garbage-dump-glacier','vertigo-vents'].includes(item.biome));
		const key=item.sourceSegment+'/'+item.biome;
		assert.ok(!seen.has(key),'Duplicate original case '+key);
		seen.add(key);
		assert.equal(item.sourceFrameStart,
			manifest.segments[item.sourceSegment].startFrame);
		assert.equal(item.qaCosmeticSeed,0x2912026);
		assert.equal(item.originalSourceCount,7);
		assert.equal(item.peakGate,true);
		assert.equal(item.offlineSchedulingStateFacade,true);
		assert.equal(item.countIn.drumSource,'original-decoded-ogg-drums');
		assert.equal(item.countIn.verified,false);
		assert.equal(item.countIn.timingKind,'synthetic-unverified');
		assert.equal(item.countIn.scheduledDrumAccents,4);
		assert.equal(item.countIn.beatOnsets.length,4);
		assert.equal(item.countInVsRealOriginalNoCountIn.length,4);
		assert.equal(item.control.countIn,null);
		assert.deepEqual(item.sourceHashes,item.control.sourceHashes);
		assertSafeFatalPair(item);
		assert.equal(item.sourceHashes.drums,item.originalDrumSha256);
		assert.equal(item.nonfiniteSamples,0);
		assert.equal(item.sampleClips,0);
		assert.equal(item.estimatedTrueClips4x,0);
		assert.ok(item.samplePeak<1&&item.estimatedTruePeak4x<1);
		for(const [role,expected] of Object.entries(item.sourceHashes)){
			const name=manifest.segments[item.sourceSegment].sources[role];
			assert.equal(originalFileBytes(packRoot,name),expected,
				'Chromium original OGG bytes mismatch '+song.id+'/'+role);
			inputs.push({song:song.id,segment:item.sourceSegment,role,
				originalSha256:expected});
		}
		assert.equal(Object.keys(item.sourceHashes).length,7);
		const drumSegment=item.countIn.sourceSegment;
		assert.ok(Number.isInteger(drumSegment)&&drumSegment>=0&&
			drumSegment<manifest.segments.length);
		const expectedDrumHash=originalFileBytes(packRoot,
			manifest.segments[drumSegment].sources.drums);
		assert.equal(item.countIn.originalDrumSourceSha256,expectedDrumHash,
			'Real four-hit drum buffer not tied to its original verified recorded OGG');
		const extra=item.extraOriginalDrumHashes;
		for(const [seg,hash] of Object.entries(extra))
			assert.equal(originalFileBytes(packRoot,manifest.segments[Number(seg)].sources.drums),
				hash,'Native warmup original drum source does not match disk');
		assert.ok(item.countIn.originalDrumOnsetScore>.015);
		assert.ok(item.countIn.originalDrumExcerptSeconds>=.06);
		for(let beat=0;beat<4;beat++){
			const measured=item.countInVsRealOriginalNoCountIn[beat];
			assert.equal(measured.beat,beat+1);
			assert.ok(Math.abs(measured.at-item.countIn.beatOnsets[beat])<1e-9);
			assert.ok(measured.positiveRms>.0001);
			assert.ok(measured.pcmDifferenceRms>.001);
			if(beat)assert.ok(Math.abs(measured.at-
				item.countIn.beatOnsets[beat-1]-.5)<1e-9);
		}
		results.push(item);
	}
	assert.equal(seen.size,6);
}
assert.equal(results.length,24);
const worst=results.reduce((a,b)=>a.estimatedTruePeak4x>b.estimatedTruePeak4x?a:b);
const minDelta=Math.min(...results.flatMap(r=>
	r.countInVsRealOriginalNoCountIn.map(w=>w.pcmDifferenceRms)));
const summary={
	originalSongs:4,sourceBiomes:2,segmentsPerSong:3,
	fatalCountInCases:24,pairedNoCountInControls:24,
	verifiedOriginalAudioSourceInputs:inputs.length,
	independentlyHashedUniqueOGGFiles:hashCache.size,
	fourBeatOriginalDrumEvents:96,
	all96NativeCountInHitsDifferFromControl:minDelta>.001,
	minPcmDifferenceRmsPerOriginalDrumHit:minDelta,
	sampleClips:results.reduce((a,r)=>a+r.sampleClips,0),
	estimated4xOvers:results.reduce((a,r)=>a+r.estimatedTrueClips4x,0),
	nonfiniteSamples:results.reduce((a,r)=>a+r.nonfiniteSamples,0),
	maxSamplePeak:Math.max(...results.map(r=>r.samplePeak)),
	maxEstimated4xTruePeak:worst.estimatedTruePeak4x,
	maxEstimatedDbTp4x:worst.estimatedTruePeakDbTp4x,
	maxCase:{trackId:worst.trackId,segment:worst.sourceSegment,biome:worst.biome},
	};
const info={
	format:'bitstream-native-fatal-original-drum-real-master-24-mixes-independent-original-ogg-audit-v1',
	status:summary.sampleClips||summary.estimated4xOvers||summary.nonfiniteSamples?
		'FAIL_CLIP_OR_NAN':'PASS_24_NATIVE_FATAL_DRUM_STRESS_NOT_MASTERED',
	summary,
	sources:'Separate SHA-256 reads from canonical local original OGG bytes, both normal seven-stem sources and original drum count-in attack (including any native prepare warmup)',
	limitations:[
		'Real production FatalCrashCountIn.start was invoked using test-only running-state facade when OfflineAudioContext was suspended at an exact scripted audio time',
		'Four count-in beat intervals are explicitly synthetic-unverified and not a trustworthy original musical beat grid',
		'Positive/control difference includes production music-recovery gating as well as original four recorded drum impacts',
		'Offline test events are scripted, not measured from actual terrain/player/BSOD movement',
		'4x true-peak is an approximate sinc reconstruction, not a certified mastering meter',
		'Only first four original source songs, two biomes and first/middle/last segment, not all 33 or full-song audio',
	],
	inputReports:[],
};
for(let i=0;i<4;i++){
	const path=join(reportsDir,baselineName(i));
	info.inputReports.push({songId:songs[i].id,file:path,
		sha256:sha(readFileSync(path)),cases:6});
}
writeFileSync(output,JSON.stringify(info,null,2)+'\n',{flag:'wx'});
console.log('NATIVE_FATAL_COUNTIN_24_CASES_INDEPENDENT_SOURCE_VERIFIED',
	info.status,JSON.stringify(summary),'report',output);
if(info.status.startsWith('FAIL'))process.exitCode=1;
