#!/usr/bin/env node
/**
 * Independent disk OGG source readback + actual game event and PCM envelope
 * verification for real-physics BSOD collisions sampled at the live final
 * post-guard Web Audio output. Fails closed on any missing source/report.
 *
 * Original OGG assets and private final PCM never leave the owner's machine.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {classifyLiveCaptureAttempt,assertNoNonretryableAudioFailure,
	PASS_CAPTURE,INVALID_CAPTURE} from './live-capture-review-policy.js';
import {selectEightLiveReports} from './select-eight-live-reports.js';
const mediaRoot=process.env.BSB291_PRIVATE_AUDIO_ROOT;
const reportRoot=process.env.REPORT_ROOT;
const output=process.env.REPORT_OUT;
if(!mediaRoot||!reportRoot||!output||existsSync(output))
	throw Error('Set private original media, private reports and UNIQUE destination');
const source=resolve(mediaRoot),reports=resolve(reportRoot);
const catalog=JSON.parse(readFileSync(join(source,'catalog.json'),'utf8'));
assert.equal(catalog.tracks.length,33);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const originalVocalFullSeven=[
	{index:0,file:'issue291-real-physics-final-master-index0-vocals-v2-20261124.json',vocals:true},
	...[1,2,4,10,20,30].map(i=>({
		index:i,file:'issue291-real-physics-final-master-index-'+String(i).padStart(2,'0')+'-vocals-v1-20261124.json',
		vocals:true
	})),
];
const full33=process.env.QA_FULL33==='1';
const strictReview=process.env.QA_REVIEW_STRICT==='1';
const rejectedAttempts=[];
const partial=process.env.QA_V4_PREFIX_COUNT;
if(partial!==undefined&&(!full33||!strictReview||!/^([1-9]|[12][0-9]|3[0-2])$/.test(partial)))
	throw Error('QA_V4_PREFIX_COUNT requires strict v4 mode and a prefix count 1..32');
const targetCount=partial===undefined?33:Number(partial);
const chosenFull33=full33?Array.from({length:targetCount},(_,index)=>{
	// ALL 33 indexes must use fresh quantum-v4 terminal-verified reports.
	// v2 and the earlier chunk-only captures remain immutable historical
	// evidence and must NEVER be grandfathered into this aggregate.
	const id=String(index).padStart(2,'0');
	let selected=null;
	for(let attempt=1;attempt<=3;attempt++){
		const filename=strictReview?
			'issue291-qualified-v4-live-index-'+id+'-attempt'+attempt+'-20261124.json':
			'issue291-real-bsod-live-full33-index-'+id+'-attempt-'+attempt+'-20261124.json';
		const path=join(reports,filename);
		if(!existsSync(path))continue;
		const bytes=readFileSync(path);
		const item=JSON.parse(bytes);
		// Critically inspect EVERY attempt, even AFTER finding a PASS.
		// Any complete capture with an audio-limit failure aborts the
		// whole source audit; retries are only for instrument invalidity.
		const result=assertNoNonretryableAudioFailure(item);
		if(result===PASS_CAPTURE){
			if(selected)throw Error('Multiple ambiguous passing live captures of original '+id);
			selected={index,file:filename,vocals:true};
		}else if(result===INVALID_CAPTURE){
			rejectedAttempts.push({index,attempt,filename,sha256:sha(bytes),
				status:result,reason:String(item.error).slice(0,240)});
		}else throw Error('Invalid unrecognized capture type '+filename);
	}
	assert.ok(selected,'Missing valid source-verified game collision for song '+id);
	return selected;
}):null;
const sequence=full33?chosenFull33:selectEightLiveReports([
	...originalVocalFullSeven,
	{index:0,file:'issue291-real-physics-final-master-index0-vocals-off-v4-20261124.json',vocals:false}
],process.env.QA_EIGHT_REPORT_FILES);
const checked=[],sourceFiles=new Map(),reportEvidence=[];
for(const {index,file,vocals} of sequence){
	const src=join(reports,file);
	assert.ok(existsSync(src),'Original live physics audit report missing '+src);
	const bytes=readFileSync(src);
	const r=JSON.parse(bytes);
	assert.equal(classifyLiveCaptureAttempt(r),PASS_CAPTURE,
		'No validated per-render-quantum chronology or measured audio limit failure');
	assert.equal(r.songIndex,index);
	assert.equal(r.testOriginalVocalsUnlockedInDisposableBrowser,vocals,
		'Audio was not recorded with requested genuine vocal unlock');
	assert.equal(r.errors?.length,0);
	assert.equal(r.unexpectedHttp?.length,0);
	assert.ok(r.mediaRequests>=7,'Original sources not fetched from the game');
	const actual=catalog.tracks[index];
	assert.equal(r.pre.songId,actual.id);
	assert.equal(r.pre.trackId,actual.id);
	assert.equal(r.pre.sourceCount,18);
	assert.ok(r.pre.originalRoles.includes('drums'));
	assert.equal(r.pre.testUserGains.vocals,vocals);
	assert.equal(r.pre.testUserGains.enabled,true);
	for(const gain of ['master','music','sfx','wind'])
		assert.equal(r.pre.testUserGains[gain],1);
	assert.equal(r.pre.outputGuard,'WaveShaperNode');
	assert.equal(r.pre.workletTap,'AudioWorkletNode');
	const crash=r.realPhysicsCollision;
	assert.equal(crash.after.trackId,actual.id);
	assert.equal(crash.after.crashed,true);
	assert.equal(crash.after.bsodCaught,true);
	assert.equal(crash.before.clockStart,crash.after.clockStart);
	assert.equal(crash.before.token,crash.after.token);
	assert.equal(crash.countIn.timingKind,'synthetic-unverified');
	assert.equal(crash.countIn.verified,false);
	assert.equal(crash.countIn.scheduledDrumAccents,4);
	assert.equal(crash.countIn.drumSource,'original-decoded-ogg-drums');
	assert.equal(crash.countIn.beatOnsets.length,4);
	assert.ok(crash.events.some(e=>e.name==='crash'&&e.fatal===true&&
		e.negated===false&&e.cause==='bsod'));
	assert.ok(crash.events.some(e=>e.name==='end'));
	assert.ok(crash.events.some(e=>e.name==='bsod'&&e.proximity===1&&
		e.relativeAirX>0));
	const drum=r.actualOriginalDrum;
	assert.equal(drum.trackId,actual.id);
	assert.equal(drum.manifest,actual.manifest);
	assert.equal(drum.sourceSegment,crash.countIn.sourceSegment);
	assert.equal(drum.sourceFetchProvenance,'game-original-response-clone-v2',
		'Source hash must be from the actual game decoder fetch response');
	assert.match(drum.originalOggSha256,/^[a-f0-9]{64}$/);
	const packPath=resolve(source,actual.manifest.replace(/\/pack\.json$/,''));
	const manifest=JSON.parse(readFileSync(join(packPath,'pack.json'),'utf8'));
	assert.equal(manifest.id,actual.id);
	const expectedRel=manifest.segments[drum.sourceSegment].sources.drums;
	assert.equal(drum.relativeOggPath,expectedRel);
	const oggPath=resolve(packPath,expectedRel);
	assert.ok(oggPath.startsWith(packPath+sep)&&oggPath.endsWith('.ogg')&&
		existsSync(oggPath),'Original sampled drum source not present');
	if(!sourceFiles.has(oggPath)){
		const onDisk=readFileSync(oggPath);
		sourceFiles.set(oggPath,{sha256:sha(onDisk),bytes:onDisk.length});
	}
	const fileBytes=sourceFiles.get(oggPath);
	assert.equal(drum.originalOggSha256,fileBytes.sha256,'Real crash OGG bytes do not match source archive');
	assert.equal(drum.originalOggBytes,fileBytes.bytes);
	const live=r.liveFinalMaster;
	assert.equal(live.songId,actual.id);
	assert.equal(live.sourceId,actual.id);
	assert.equal(live.clockStart,crash.before.clockStart);
	assert.equal(live.gaps,0);
	assert.equal(live.captureContinuityVersion,4,
		'Missing quantum-v4 qualified arm and terminal proof: recapture required');
	assert.equal(live.captureArmFrame,live.firstFrame,
		'Recording must begin EXACTLY at its qualified sample-clock arm');
	assert.ok(Number.isSafeInteger(live.startupWarmupGapsExcludedBeforeArm)&&
		live.startupWarmupGapsExcludedBeforeArm>=0);
	assert.equal(live.discardedStartupChunks,0,
		'No recorded sample may be discarded after qualified arm');
	assert.deepEqual(live.captureQuantumIntegrity,{
		checkedEveryQuantum:true,chronologyErrors:0,nextQuantumVerified:true
	});
	assert.ok(live.chunks>=50);
	assert.ok(live.duration>3.0);
	assert.equal(live.sampleRate,r.pre.audioSampleRate);
	assert.equal(live.originalMediaRoles,18);
	assert.ok(live.clockOfFirstFrame<=crash.after.audioCurrentTime-.14);
	assert.ok(live.clockOfLastFrame>=crash.countIn.bandAt+.15);
	assert.equal(live.frames,
		Math.round(live.duration*live.sampleRate));
	assert.ok(live.discardedStartupChunks<=2);
	for(const gap of live.discardedStartupGapDetails||[]){
		assert.ok(gap.index<=2&&gap.at<crash.after.audioCurrentTime-.15,
			'Unacceptable late post-guard PCM gap');
	}
	assert.equal(live.originalDrumSourceScheduled,true);
	assert.equal(live.isolatedOriginalDrumAudibilityVerified,false);
	const meter=live.finalMasterMetrics;
	assert.equal(meter.nonfiniteSamples,0);
	assert.equal(meter.sampleClips,0);
	assert.equal(meter.estimatedTrueClips4x,0);
	assert.ok(meter.samplePeak>=0&&meter.samplePeak<1);
	assert.ok(meter.estimatedTruePeak4x>=meter.samplePeak-1e-8);
	assert.ok(meter.estimatedTruePeak4x<1);
	assert.equal(meter.sampleRate,live.sampleRate);
	assert.equal(meter.channels,2);
	assert.equal(meter.windowStartFrame,0);
	assert.equal(meter.windowEndFrame,live.frames);
	assert.equal(meter.samplesPerChannel,live.frames);
	assert.equal(live.captureEndFrame,live.firstFrame+live.frames);
	assert.equal(live.captureEndFrame,live.finalQuantumStart+live.finalQuantumFrames);
	for(let i=1;i<=4;i++){
		const hit=live.countInMasterWindows['drum'+i];
		assert.ok(hit&&hit.rms>.0002&&hit.samplesPerChannel>1000,
			'No non-silent master window at scheduled crash beat '+i);
	}
	checked.push({
		songIndex:index,trackId:actual.id,vocals,
		sampleRate:live.sampleRate,liveOutputSeconds:live.duration,
		outputPeak4x:meter.estimatedTruePeak4x,
		dbTp4x:meter.estimatedTruePeakDbTp4x,
		startupWarmupGapsExcludedBeforeArm:live.startupWarmupGapsExcludedBeforeArm,
		captureContinuityVersion:live.captureContinuityVersion,
		scheduledDrumHits:4,originalDrumSourceSha256:fileBytes.sha256,
	});
	reportEvidence.push({file,sha256:sha(bytes)});
}
assert.equal(checked.length,full33?targetCount:8);
const worst=checked.reduce((a,b)=>a.outputPeak4x>=b.outputPeak4x?a:b);
const summary={
	liveGameRealPhysicsCases:checked.length,
	distinctOriginalSongIds:new Set(checked.map(x=>x.trackId)).size,
	vocalsUnlockedCases:checked.filter(x=>x.vocals).length,
	vocalsLockedControlCases:checked.filter(x=>!x.vocals).length,
	originalRecordedDrumSourcesScheduled:checked.length*4,
	independentlyVerifiedDrumOggSources:sourceFiles.size,
	noPostStartupPcmGaps:true,
	sampleClips:0,estimated4xOvers:0,nonfiniteSamples:0,
	worstEstimated4xDbTp:worst.dbTp4x,
	worstEstimated4xTruePeak:worst.outputPeak4x,
	worstTrackId:worst.trackId,
};
summary.rejectedCaptureAttempts=rejectedAttempts.length;
const aggregate={
	format:full33?'bitstream-genuine-physics-bsod-live-output-v4-first-original-source-4x-audit-v2':
		'bitstream-genuine-physics-bsod-live-output-original-ogg-4x-audit-v1',
	status:full33?(targetCount===33?'PASS_33_QUANTUM_V4_GENUINE_PHYSICS_BSOD_FINAL_MASTER_SAMPLED_NOT_MASTERED':
		'PASS_PARTIAL_QUANTUM_V4_GENUINE_PHYSICS_BSOD_FINAL_MASTER_SAMPLED_NOT_MASTERED'):
		'PASS_REAL_GAME_BSOD_FINAL_MASTER_SAMPLE_NOT_RELEASE_CERTIFIED',
	summary,checked,reportEvidence,rejectedAttempts,
	notes:[
		'This is an actual physics-resolved BSOD collision after QA accelerates and positions the authoritative real wall. It is not a natural player/replay trajectory.',
		'True final PCM captured read-only after game production OutputPeakGuard by silent-output AudioWorklet. Startup diagnostic gaps discarded only before collision; every counted crash interval is contiguous.',
		'Original drum source OGG is SHA-256 verified and four hits are scheduled; non-silent full-master windows alone do NOT prove each isolated drum was audible over wind/crash tails.',
		'Each case uses one 33-song original first segment, naturally starting in Debutmont. Strict v4 mode covers the exact configured prefix (all 33 by default); not a coverage claim for full-length tracks or all 12 game biomes.',
		'The four recorded original drum excerpts use the production count-in synthetic-unverified grid; original beats have NOT been certified.',
		'Browser audio context playback at native device sample rate (usually 44.1 kHz); 4x sinc estimate is not an independent mastering reference.',
		'Fresh v4 captures only: no historical v2/v3 clean reports are accepted. Each capture first qualifies a consecutive 450ms startup period, then arms exactly at the first recorded sample. ONLY PRE-ARM activation gaps are excluded; EVERY sample after arming must be contiguous, including pre-impact, recovery and the terminal verified quantum. Every captured native sample is metered. Valid measured clipping permanently fails the aggregate; only instrument-invalid captures are retryable.',
		'Four drum sounds are verified as source-original and scheduled; non-silent master windows DO NOT isolate the drum from wind/crash/room and must not be called verified drum audibility.',
		'Do not change approved sound mixes, release music, merge a draft PR or close issue #291 solely because these samples pass.',
	],
};
writeFileSync(output,JSON.stringify(aggregate,null,2)+'\n',{flag:'wx'});
console.log('LIVE_ACTUAL_PHYSICS_POST_GUARD_SOURCE_INDEPENDENT_AUDIT',
	aggregate.status,JSON.stringify(summary),'report',output);
