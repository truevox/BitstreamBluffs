#!/usr/bin/env node
/** Independently re-open original OGG disk bytes for every 33-song count-in
 * master stress-case and compare 7 Chromium source hashes + any original
 * native fallback-drum preload. No source data enters Git or public server.
 */
import assert from 'node:assert/strict';
import {assertSafeFatalPair} from './fatal-qa-peak-gate.js';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.env.BSB291_PRIVATE_AUDIO_ROOT;
const dir=process.env.REPORT_ROOT;
const output=process.env.REPORT_OUT;
if(!root||!dir||!output||existsSync(output))throw Error('Require private source root, reports, and unique output');
const media=resolve(root);
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const catalog=readJson(join(media,'catalog.json'));
assert.equal(catalog.tracks.length,33);
const audited=[],sourceFiles=new Map(),reports=[];
const errors=[];
for(let index=0;index<33;index++){
	const track=catalog.tracks[index];
	const id=String(index).padStart(2,'0');
	const file=join(dir,'issue291-full33-fatal-mixed-song-'+id+'-v1-20261124.json');
	assert.ok(existsSync(file),'Missing ORIGINAL 33-song report at '+index);
	const bytes=readFileSync(file),report=JSON.parse(bytes);
	assert.equal(report.songIndex,index);
	assert.equal(report.full33,true);
	assert.equal(report.status,'PASS_ONE_NATIVE_ORIGINAL_DRUM_FATAL_MIXED_CASE_NOT_MASTERED');
	assert.equal(report.cases.length,1);
	const result=report.cases[0];
	assert.equal(result.trackId,track.id);
	assert.equal(result.sourceSegment,0);
	assert.equal(result.biome,'garbage-dump-glacier');
	assert.equal(result.includeCountIn,true);
	assert.equal(result.originalSourceCount,7);
	assert.equal(result.peakGate,true);
	assert.equal(result.offlineSchedulingStateFacade,true);
	assert.equal(result.qaCosmeticSeed,0x2912026);
	assert.equal(result.countIn.drumSource,'original-decoded-ogg-drums');
	assert.equal(result.countIn.scheduledDrumAccents,4);
	assert.equal(result.countIn.verified,false);
	assert.equal(result.countIn.timingKind,'synthetic-unverified');
	assert.equal(result.countIn.beatOnsets.length,4);
	assert.equal(result.countInVsRealOriginalNoCountIn.length,4);
	assert.equal(result.control.countIn,null);
	assert.deepEqual(result.control.sourceHashes,result.sourceHashes);
	assertSafeFatalPair(result);
	assert.equal(result.sampleClips,0);
	assert.equal(result.estimatedTrueClips4x,0);
	assert.equal(result.nonfiniteSamples,0);
	assert.ok(result.estimatedTruePeak4x<1);
	assert.ok(result.countIn.originalDrumOnsetScore>.015);
	assert.ok(result.countIn.originalDrumExcerptSeconds>=.06);
	const packBase=resolve(media,track.manifest.replace(/\/pack\.json$/,''));
	const manifest=readJson(join(packBase,'pack.json'));
	assert.equal(manifest.id,track.id);
	assert.equal(result.sourceFrameStart,manifest.segments[0].startFrame);
	function diskHash(rel){
		const name=resolve(packBase,rel);
		assert.ok(name.startsWith(packBase+sep)&&name.endsWith('.ogg')&&existsSync(name));
		if(!sourceFiles.has(name))sourceFiles.set(name,sha(readFileSync(name)));
		return sourceFiles.get(name);
	}
	for(const [role,expected] of Object.entries(result.sourceHashes)){
		const relative=manifest.segments[0].sources[role];
		assert.ok(relative,'Missing actual original source role '+role);
		assert.equal(diskHash(relative),expected,
			'Chromium input did not match original local OGG bytes at '+id+'/'+role);
	}
	assert.equal(Object.keys(result.sourceHashes).length,7);
	assert.equal(result.sourceHashes.drums,result.originalDrumSha256);
	const selected=result.countIn.sourceSegment;
	assert.ok(Number.isInteger(selected)&&selected>=0&&selected<manifest.segments.length);
	assert.equal(diskHash(manifest.segments[selected].sources.drums),
		result.countIn.originalDrumSourceSha256,
		'Four native original drum hits not tied to authentic local bytes for song '+id);
	for(const [idx,expected] of Object.entries(result.extraOriginalDrumHashes)){
		assert.equal(diskHash(manifest.segments[Number(idx)].sources.drums),expected,
			'Native original drum warmup failed independent disk hash '+id);
	}
	for(let i=0;i<4;i++){
		const hit=result.countInVsRealOriginalNoCountIn[i];
		assert.equal(hit.beat,i+1);
		assert.ok(Math.abs(hit.at-result.countIn.beatOnsets[i])<1e-9);
		assert.ok(hit.positiveRms>.0001);
		assert.ok(hit.pcmDifferenceRms>.001,
			'4 original sample accents should measurably affect final mix '+id+'/'+i);
		if(i)assert.ok(Math.abs(hit.at-result.countIn.beatOnsets[i-1]-.5)<1e-9);
	}
	audited.push(result);
	reports.push({songId:track.id,index,sha256:sha(bytes),path:file});
}
assert.equal(audited.length,33);
const max=audited.reduce((a,b)=>a.estimatedTruePeak4x>=b.estimatedTruePeak4x?a:b);
const summary={
	uniqueOriginalSongs:33,sourceSegmentIndex:0,biome:'garbage-dump-glacier',
	realFatalCountInStressRenders:33,pairedControlRenders:33,
	originalRecordedDrumOnsets:132,
	verifiedOriginalSevenStemInputs:231,
	uniqueOriginalOggFilesIndependentlyHashed:sourceFiles.size,
	nativeFallbackDrumWarmupSongs:audited.filter(r=>
		Object.keys(r.extraOriginalDrumHashes).length>0).length,
	originalDrumClips:audited.reduce((a,x)=>a+x.sampleClips,0),
	estimated4xOvers:audited.reduce((a,x)=>a+x.estimatedTrueClips4x,0),
	nonfiniteSamples:audited.reduce((a,x)=>a+x.nonfiniteSamples,0),
	minHitVersusControlPcmDifferenceRms:Math.min(...audited.flatMap(x=>
		x.countInVsRealOriginalNoCountIn.map(y=>y.pcmDifferenceRms))),
	maxSamplePeak:Math.max(...audited.map(x=>x.samplePeak)),
	maxEstimated4xTruePeak:max.estimatedTruePeak4x,
	maxEstimated4xDbTp:max.estimatedTruePeakDbTp4x,
	maxCase:{trackId:max.trackId,sourceSegment:max.sourceSegment,biome:max.biome},
};
const aggregate={
	format:'bbs-full33-native-original-source-countin-vs-control-mixed-master-audit-v1',
	status:'PASS_33_ORIGINAL_SOURCE_FATAL_COUNTIN_MIXES_NOT_MASTERED',summary,
	sources:'Independent SHA-256 from unchanged canonical original local OGG files for all input roles and every selected preloaded drum',
	reports,
	limits:[
		'Only ORIGINAL source segment 0 from each 33-song pack and Garbage Dump Glacier, not all song segments or biomes',
		'Production original FatalCrashCountIn.start used a narrow test-only running-state facade during exact OfflineAudioContext suspended scheduling',
		'Synthetic UNVERIFIED original four-hit timing is NOT an original downbeat, source-verified tempo or rhythm publication',
		'Paired no-count-in differences include genuine original band recovery gating as well as the four OGG drum hits',
		'Stress sound events scripted through real SFX/wind/static methods, not actual physics-based replay',
		'4× sinc true-peak is an estimated PCM reconstruction, not independently calibrated ITU BS.1770',
		'Human listening and platform CPU, full 33-song continuous performance, crossfades and musical dynamics remain outstanding',
	]};
writeFileSync(output,JSON.stringify(aggregate,null,2)+'\n',{flag:'wx'});
console.log('FULL33_ORIGINAL_FATAL_MASTER_INDEPENDENT_OGG_HASH_VERIFY',
	aggregate.status,JSON.stringify(summary),'output',output);
