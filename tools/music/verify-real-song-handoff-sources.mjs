#!/usr/bin/env node
/**
 * Independent Chromium source decode + local canonical original OGG readback
 * at each of the 33 real-game original-song transitions. This is a source
 * integrity and exact decoded frame count test, not full-song listening.
 *
 * No copyrighted OGG bytes committed, downloaded out of machine, or
 * copied into the public application.
 */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const url=(process.env.GAME_URL||'http://127.0.0.1:8221').replace(/\/+$/,'');
const media=process.env.BSB291_PRIVATE_AUDIO_ROOT;
const reportRoot=process.env.REPORT_ROOT;
const out=process.env.REPORT_OUT;
if(!media||!reportRoot||!out||existsSync(out))
	throw Error('Set canonical private original archive, report folder and UNIQUE result path');
const source=resolve(media);
const catalog=JSON.parse(readFileSync(join(source,'catalog.json'),'utf8'));
assert.equal(catalog.tracks.length,33);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const CORE=['drums','bass','guitar','piano','other','vocals'];
const cases=[],rawSources=[];
let report={format:'bsb-33-real-webaudio-song-handoff-boundary-source-verified-v1',
	status:'INCOMPLETE',cases,sourceFiles:rawSources,
	limitations:[
		'Actual native 33-song end-of-track handoff schedule cases are independently read from exclusive-create private reports; this verifies real original terminal/next-opening OGGs at precisely those schedules',
		'All six original recorded source roles are fetched and decoded in Chromium with 48kHz AudioContext and matched to the exact private on-disk OGG SHA-256 and expected frames',
		'Tests last and first segment per transition only, NOT every intra-song segment or continuous multi-minute playback',
		'An exact source-frame count prevents hidden 6.5ms Opus truncation but is NOT itself proof of intentional artist-approved track-to-track fade/no silence',
		'Browser scheduling timing gaps are source timestamps, not a calibrated continuous stereo output loudness or true-peak meter',
		'Recorded dry source energy proxies are root-sum-square of per-original-stem RMS in half-second windows, not summing actual waveform, not final mixed output, not proof of an unwanted fade; quiet songs may be artistically intentional',
	]};
const browser=await chromium.launch({headless:true,args:['--no-sandbox',
	'--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
	'--ignore-gpu-blocklist']});
try{
	const page=await browser.newPage();
	await page.goto(url+'/tools/music/qa-mixed-final-output.html',{waitUntil:'load',timeout:30000});
	const browserResults=await page.evaluate(async()=>{
		const c=await(await fetch('/music/catalog.json')).json();
		if(c.tracks.length!==33)throw Error('Private 33-song catalog missing');
		const ctx=new AudioContext({sampleRate:48000});
		const hex=bytes=>Array.from(new Uint8Array(bytes),
			v=>v.toString(16).padStart(2,'0')).join('');
		const manifests=[];
		for(let i=0;i<33;i++){
			const track=c.tracks[i];
			const url=new URL('/music/'+track.manifest,location.origin);
			const r=await fetch(url);
			if(!r.ok)throw Error('No original manifest '+track.id);
			const data=await r.json();
			if(data.id!==track.id)throw Error('Manifest source identity differs');
			manifests.push({track,manifest:data,url:url.href});
		}
		const records=[];
		const roles=['drums','bass','guitar','piano','other','vocals'];
		for(let i=0;i<33;i++){
			const old=manifests[i],next=manifests[(i+1)%33];
			const sources=[
				...roles.map(role=>({role,side:'ending',songIndex:i,
					track:old.track,pack:old.manifest,base:old.url,
					segment:old.manifest.segments.at(-1),
					segmentIndex:old.manifest.segments.length-1})),
				...roles.map(role=>({role,side:'opening',songIndex:(i+1)%33,
					track:next.track,pack:next.manifest,base:next.url,
					segment:next.manifest.segments[0],segmentIndex:0})),
			];
			const result=await Promise.all(sources.map(async src=>{
				const rel=src.segment.sources[src.role];
				if(!rel)throw Error('No original source '+src.role);
				const u=new URL(rel,src.base);
				const response=await fetch(u);
				if(!response.ok)throw Error('Original OGG HTTP '+response.status+' '+u);
				const bytes=await response.arrayBuffer();
				// decodeAudioData TAKES OWNERSHIP and DETACHES its input
				// ArrayBuffer. Preserve encoded bytes and length before
				// handing a COPY to the decoder; the original stays
				// available for independent private archive verification.
				const encodedLength=bytes.byteLength;
				const digest=hex(await crypto.subtle.digest('SHA-256',bytes));
				const decoded=await ctx.decodeAudioData(bytes.slice(0));
				if(decoded.sampleRate!==48000||
					decoded.length!==src.segment.frames||
					decoded.numberOfChannels<1)
					throw Error('SOURCE_FRAME_OR_SAMPLE_RATE_MISMATCH '+src.track.id+
						' '+src.side+' '+src.role+': '+decoded.length+
						' expected '+src.segment.frames);
				// Measure original 0.5-second SOURCE energy at boundaries.
				// This is a dry STEM RMS proxy, not post-FX mastered LUFS
				// or proof that an artistic fade is undesirable.
				const windowFrames=Math.min(24000,Math.floor(decoded.length/2));
				const rms=(start,end)=>{
					let sum=0,n=0;
					for(let channel=0;channel<decoded.numberOfChannels;channel++){
						const samples=decoded.getChannelData(channel);
						for(let k=start;k<end;k++){sum+=samples[k]*samples[k];n++}
					}
					return n?Math.sqrt(sum/n):0;
				};
				const lastHalfSecondRms=rms(decoded.length-windowFrames,decoded.length);
				const previousHalfSecondRms=rms(decoded.length-2*windowFrames,
					decoded.length-windowFrames);
				const firstHalfSecondRms=rms(0,windowFrames);
				return {songIndex:src.songIndex,trackId:src.track.id,
					manifest:src.track.manifest,role:src.role,side:src.side,
					segmentIndex:src.segmentIndex,
					expectedFrames:src.segment.frames,decodedFrames:decoded.length,
					sourceSampleRate:decoded.sampleRate,channels:decoded.numberOfChannels,
					oggBytes:encodedLength,sha256:digest,
					relativeOriginalOgg:rel,
					firstHalfSecondRms,lastHalfSecondRms,previousHalfSecondRms,
					energyWindowFrames:windowFrames};
			}));
			records.push({index:i,nextIndex:(i+1)%33,
				endingTrackId:old.track.id,openingTrackId:next.track.id,
				sources:result});
		}
		await ctx.close();
		return records;
	});
	assert.equal(browserResults.length,33);
	// Negative control: deliberately corrupt a copied, in-memory
	// browser-side digest; the canonical private file is NEVER modified.
	if(process.env.QA_INJECT_BAD_ORIGINAL_SHA==='1')
		browserResults[0].sources[0].sha256='0'.repeat(64);
	const sourceFiles=new Map();
	for(const b of browserResults){
		const i=b.index;
		assert.equal(b.nextIndex,(i+1)%33);
		const hcase=i<2?
			{file:'issue291-real-song-handoffs-smoke-0-1-20261124.json',index:i}:
			i<12?{file:'issue291-real-original-song-handoffs-start-2-count-10-v1-20261124.json',index:i-2}:
			i<22?{file:'issue291-real-original-song-handoffs-start-12-count-10-v1-20261124.json',index:i-12}:
			{file:'issue291-real-original-song-handoffs-start-22-count-11-v1-20261124.json',index:i-22};
		const path=join(reportRoot,hcase.file);
		assert.ok(existsSync(path),'Missing native real song scheduler report '+path);
		const batch=JSON.parse(readFileSync(path,'utf8'));
		assert.equal(batch.status,'PASS_REAL_SONG_HANDOFF_SCHEDULES_NOT_CONTINUOUS_MASTERING');
		const schedule=batch.cases[hcase.index];
		assert.equal(schedule.index,i);
		assert.equal(schedule.sourceId,b.endingTrackId);
		assert.equal(schedule.nextSourceId,b.openingTrackId);
		assert.equal(schedule.mandatorySourceBoundaryTimings.length,6);
		assert.ok(schedule.maxAbsSourceGapMs<20);
		assert.ok(Math.abs(schedule.gapAtSongClock)<.02);
		assert.equal(b.sources.length,12);
		const sourceRecords=[];
		for(const s of b.sources){
			assert.ok(CORE.includes(s.role));
			assert.equal(s.expectedFrames,s.decodedFrames);
			assert.equal(s.sourceSampleRate,48000);
			assert.match(s.sha256,/^[0-9a-f]{64}$/);
			const sourceTrack=catalog.tracks[s.songIndex];
			assert.equal(s.trackId,sourceTrack.id);
			assert.equal(s.manifest,sourceTrack.manifest);
			const base=resolve(source,sourceTrack.manifest.replace(/\/pack\.json$/,''));
			const manifest=JSON.parse(readFileSync(join(base,'pack.json'),'utf8'));
			const seg=manifest.segments[s.segmentIndex];
			assert.equal(seg.frames,s.expectedFrames);
			assert.equal(seg.sources[s.role],s.relativeOriginalOgg);
			const ogg=resolve(base,s.relativeOriginalOgg);
			assert.ok(ogg.startsWith(base+sep)&&ogg.endsWith('.ogg')&&existsSync(ogg));
			if(!sourceFiles.has(ogg)){
				const bytes=readFileSync(ogg);
				sourceFiles.set(ogg,{sha256:hash(bytes),bytes:bytes.length});
			}
			const disk=sourceFiles.get(ogg);
			assert.equal(disk.sha256,s.sha256,'Browser original source diverges from canonical disk '+ogg);
			assert.equal(disk.bytes,s.oggBytes);
			for(const key of ['firstHalfSecondRms','lastHalfSecondRms',
				'previousHalfSecondRms']){
				assert.ok(Number.isFinite(s[key])&&s[key]>=0&&s[key]<=1,
					'Nonfinite or invalid original source energy '+key);
			}
			sourceRecords.push({role:s.role,side:s.side,songId:s.trackId,
				segmentIndex:s.segmentIndex,frames:s.decodedFrames,sha256:s.sha256,
				firstHalfSecondRms:s.firstHalfSecondRms,
				previousHalfSecondRms:s.previousHalfSecondRms,
				lastHalfSecondRms:s.lastHalfSecondRms});
		}
		const estimateCombinedRms=(which,metric)=>
			Math.sqrt(sourceRecords.filter(x=>x.side===which)
				.reduce((sum,x)=>sum+x[metric]**2,0));
		const last=estimateCombinedRms('ending','lastHalfSecondRms');
		const penultimate=estimateCombinedRms('ending','previousHalfSecondRms');
		const nextFirst=estimateCombinedRms('opening','firstHalfSecondRms');
		cases.push({
			index:i,endingTrackId:b.endingTrackId,openingTrackId:b.openingTrackId,
			maxAbsSourceGapMs:schedule.maxAbsSourceGapMs,
			gapAtSongClockMs:schedule.gapAtSongClock*1000,
			endingLastHalfSecondRmsProxy:last,
			endingPreviousHalfSecondRmsProxy:penultimate,
			endingHalfSecondEnergyRatio:penultimate>1e-8?last/penultimate:null,
			nextOpeningHalfSecondRmsProxy:nextFirst,
			originalBrowserOggSourceHashes:sourceRecords,
		});
	}
	assert.equal(cases.length,33);
	const maxGap=Math.max(...cases.map(c=>c.maxAbsSourceGapMs));
	const absDrift=Math.max(...cases.map(c=>Math.abs(c.gapAtSongClockMs)));
	assert.ok(maxGap<20&&absDrift<20);
	report.status='PASS_33_REAL_SONG_BOUNDARY_SOURCE_AND_SCHEDULER_AUDIT_NOT_MASTERED';
	report.summary={
		transitionCases:33,realOriginalSourceRolesPerSide:6,
		independentlyVerifiedBrowserOggSourceUsages:396,
		uniqueCanonicalOriginalOggFiles:sourceFiles.size,
		allDecodedAudioSegmentsFrameExact:true,
		dryOriginalEndingTailEnergyProxiesComputed:true,
		endsUnder20PercentOfPriorHalfSecond:cases.filter(c=>
			c.endingHalfSecondEnergyRatio!==null&&
			c.endingHalfSecondEnergyRatio<.2).map(c=>c.index),
		maxScheduledOriginalSourceGapMs:maxGap,
		maxSongClockDriftMs:absDrift,
		originalSourceSampleRate:48000,
	};
	console.log('ALL33_REAL_WEBAUDIO_SOURCE_FRAME_AND_HANDOFF_PASS',
		JSON.stringify(report.summary));
}catch(e){
	report.status='FAIL_OR_INCOMPLETE';
	report.error=String(e);
	console.error('REAL_WEBAUDIO_33_BOUNDARY_SOURCE_VERIFY_FAILED',String(e));
	process.exitCode=1;
}finally{
	report.completedAt=new Date().toISOString();
	writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
	await browser.close();
}
