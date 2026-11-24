#!/usr/bin/env node
/**
 * Independent on-disk private source rehash + four immutable per-song
 * browser QA report merger. Nothing copied into Git. Refuses omissions,
 * duplicate cases, changed source OGGs and overlapping report paths.
 */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {assertMixedQaMetrics} from './assert-mixed-qa-metrics.js';
const root=process.env.BSB291_PRIVATE_AUDIO_ROOT;
const output=process.env.REPORT_OUT;
if(!root||!output||existsSync(output))throw Error('Private source root and unique REPORT_OUT required');
const source=resolve(root);
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const catalog=readJson(join(source,'catalog.json'));
assert.equal(catalog.tracks.length,33);
const origin=join(source,'..');
const inputDir=process.env.REPORT_ROOT||origin;
const sourceSuffix=process.env.BSB291_BATCH_SUFFIX||'20261124';
if(!/^[a-zA-Z0-9_-]+$/.test(sourceSuffix))throw Error('Invalid immutable report name suffix');
const songs=catalog.tracks.slice(0,4);
const caseMap=new Map(),reports=[],fingerprinted=new Map(),sourceFiles=[];
for(let i=0;i<4;i++){
	const file=join(inputDir,'issue291-mixed-sim8-extended-song-'+i+'-'+sourceSuffix+'.json');
	assert.ok(existsSync(file),'Missing immutable song-batch report '+i);
	const bytes=readFileSync(file);
	const r=JSON.parse(bytes);
	assert.equal(r.status,'PASS_SAMPLED_MIXED_OUTPUT_4X_ESTIMATE');
	assert.equal(r.scenarios.length,12,'Each song must cover 3 segments x 4 risk biomes');
	assert.equal(r.summary.songs,1);
	assert.equal(r.summary.pageErrors,0);
	assert.equal(r.summary.httpErrors,0);
	const song=songs[i];
	const base=join(source,'packs',song.manifest.split('/')[1]);
	const manifest=readJson(join(base,'pack.json'));
	const indices=[0,Math.floor((manifest.segments.length-1)/2),manifest.segments.length-1];
	const sampledBiomes=['garbage-dump-glacier','vertigo-vents','crystal-cavern','bitstream-bluffs'];
	for(const scenario of r.scenarios){
		assert.equal(scenario.trackId,song.id);
		assert.equal(scenario.scenario,'mixed-game-stress');
		assert.ok(indices.includes(scenario.sourceSegment));
		assert.ok(sampledBiomes.includes(scenario.biome));
		const key=i+':'+scenario.sourceSegment+':'+scenario.biome;
		assert.ok(!caseMap.has(key),'Duplicated original mixed-output case '+key);
		caseMap.set(key,scenario);
		assert.equal(scenario.sourceRoles.length,7);
		assert.equal(scenario.originalSourceCount,7);
		assert.equal(scenario.test.qaCosmeticSeed,0x2912026);
		assert.equal(scenario.test.events.length,6);
		assert.equal(scenario.productionGraph.productionPeakGuard,true);
		assert.equal(scenario.originalVocalFxAndRoomSendsFromPack,true,
			'Historic pre-correction offline mix cannot be accepted');
		assertMixedQaMetrics(scenario);
		assert.ok(scenario.estimatedTruePeak4x>=scenario.samplePeak-1e-7);
		// Independent READ of the canonical, unchanged original OGG
		// source files; not the QA renderer's hash calculation.
		const segment=manifest.segments[scenario.sourceSegment];
		assert.equal(segment.startFrame,scenario.sourceFrameStart);
		for(const [role,expected] of Object.entries(scenario.sourceHashes)){
			const relative=segment.sources[role];
			assert.ok(typeof relative==='string'&&relative.length>0);
			const filePath=resolve(base,relative);
			assert.ok(filePath.startsWith(base+sep)&&existsSync(filePath),
				'Missing immutable source '+filePath);
			if(!fingerprinted.has(filePath)){
				const actual=digest(readFileSync(filePath));
				fingerprinted.set(filePath,actual);
				sourceFiles.push({pack:scenario.pack,segment:scenario.sourceSegment,role,sha256:actual});
			}
			assert.equal(fingerprinted.get(filePath),expected,
				'Chromium decode did not use exact original disk bytes '+filePath);
		}
		assert.equal(Object.keys(scenario.sourceHashes).length,7);
	}
	reports.push({songId:song.id,path:file,sha256:digest(bytes),cases:r.scenarios.length});
}
assert.equal(caseMap.size,48,'Missing source-verified mixed-output case');
for(let i=0;i<4;i++){
	const base=join(source,'packs',songs[i].manifest.split('/')[1]);
	const pack=readJson(join(base,'pack.json'));
	const indices=[0,Math.floor((pack.segments.length-1)/2),pack.segments.length-1];
	for(const index of indices)for(const biome of [
		'garbage-dump-glacier','vertigo-vents','crystal-cavern','bitstream-bluffs'
	]){
		assert.ok(caseMap.has(i+':'+index+':'+biome));
	}
}
const cases=[...caseMap.values()],max=cases.reduce((a,b)=>
	b.estimatedTruePeak4x>a.estimatedTruePeak4x?b:a);
const metrics={
	mixedCases:cases.length,songs:4,biomes:4,segmentsPerSong:3,
	independentOriginalOggHashes:fingerprinted.size,
	verifiedOriginalSourceInputs:cases.reduce((a,c)=>a+Object.keys(c.sourceHashes).length,0),
	overUnitySamples:cases.reduce((a,c)=>a+c.sampleClips,0),
	overUnityEstimated4xTruePeakFrames:cases.reduce((a,c)=>a+c.estimatedTrueClips4x,0),
	nonfiniteSamples:cases.reduce((a,c)=>a+c.nonfiniteSamples,0),
	maxSamplePeak:Math.max(...cases.map(c=>c.samplePeak)),
	maxEstimated4xTruePeak:max.estimatedTruePeak4x,
	maxEstimated4xDbTp:max.estimatedTruePeakDbTp4x,
	maxCase:{trackId:max.trackId,biome:max.biome,segment:max.sourceSegment},
	lessThan1DbTruePeakHeadroom:max.estimatedTruePeakDbTp4x>-1,
};
// Optional second, independent stressed timeline overlaps an EXTRA
// native static burst with crash SFX while BSOD wind persists. The first
// 48-case reports are untouched, and both report versions remain immutable.
const overlapFile=process.env.QA_OVERLAP_REPORT||null;
let overlapSummary=null;
if(overlapFile){
	const bytes=readFileSync(overlapFile),o=JSON.parse(bytes);
	assert.equal(o.status,'PASS_SAMPLED_MIXED_OUTPUT_4X_ESTIMATE');
	assert.equal(o.scenarios.length,4);
	const checkUnique=new Set();
	for(const v of o.scenarios){
		assert.equal(v.test.profile,'crash-static-overlap');
		assert.equal(v.test.events.length,7);
		assert.deepEqual(v.test.events.map(e=>e.action),[
			'bsod-wind','hop','static-glitch','hard-landing',
			'hazardScramble','static-glitch','fatal-crash-sfx']);
		assert.equal(v.originalSourceCount,7);
		assert.equal(v.test.qaCosmeticSeed,0x2912026);
		assert.equal(v.originalVocalFxAndRoomSendsFromPack,true,
			'Historic overlap mix lacks pack vocal FX and room sends');
		const song=songs.find(x=>x.id===v.trackId);
		assert.ok(song&&!checkUnique.has(song.id));
		checkUnique.add(song.id);
		const base=join(source,'packs',song.manifest.split('/')[1]);
		const manifest=readJson(join(base,'pack.json'));
		for(const [role,expected] of Object.entries(v.sourceHashes)){
			const rel=manifest.segments[v.sourceSegment].sources[role];
			assert.ok(rel);
			const file=resolve(base,rel);
			assert.ok(file.startsWith(base+sep)&&existsSync(file));
			if(!fingerprinted.has(file))fingerprinted.set(file,digest(readFileSync(file)));
			assert.equal(fingerprinted.get(file),expected);
		}
		assert.equal(Object.keys(v.sourceHashes).length,7);
		assertMixedQaMetrics(v);
	}
	overlapSummary={
		cases:4,originalSourceInputs:28,
		peak:Math.max(...o.scenarios.map(x=>x.estimatedTruePeak4x)),
		peakDbTp:Math.max(...o.scenarios.map(x=>x.estimatedTruePeakDbTp4x)),
		clippedSamples:o.scenarios.reduce((a,x)=>a+x.sampleClips,0),
		estimatedTruePeakOvers:o.scenarios.reduce((a,x)=>a+x.estimatedTrueClips4x,0),
		sourceReportSha256:digest(bytes),
	};
	assert.equal(overlapSummary.clippedSamples,0);
	assert.equal(overlapSummary.estimatedTruePeakOvers,0);
}
const status=metrics.overUnitySamples||metrics.overUnityEstimated4xTruePeakFrames?
	'FAIL_OUTPUT_PEAK':'PASS_SAMPLED_MIXED_OUTPUT_NOT_MASTERED';
const report={format:'bitstream-sim8-original-48-plus-4-overlap-mixed-audio-4x-report-v2',
	status,metrics,overlapSummary,sourceProvenance:'sha256 of exact READ ONLY canonical original OGG bytes, checked independently against per-render Chromium digest',
	inputReports:reports,sourceFiles,
	coverage:'4 actual original 6-stem songs x 3 song sections x 4 hardest-impact biomes, real original voice and original vocals at maximum user volumes; 6 native gameplay SFX/wind/static events per scenario at scripted times, native AudioSynth master/comp/guard, 4x 48-tap estimate',
	limitations:[
		'4.1s sampled excerpt per segment, no full-song continuous transitions or other 29 song coverage',
		'Stress events scripted at exact audio times, NOT authentic replays or triggered hazard physics',
		'Peak meter is a finite-window 4x sinc estimate; NOT certified ITU true-peak compliance',
		'Original drum four-beat fatal count-in and low-end device performance untested',
		'No human listening/mastering approval; close issue #291 ONLY after those are satisfied',
	],
};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log('MIXED_48_PLUS_OPTIONAL_OVERLAP_SOURCE_REHASH',status,
	JSON.stringify(metrics),'report',output);
if(status.startsWith('FAIL'))process.exitCode=1;
