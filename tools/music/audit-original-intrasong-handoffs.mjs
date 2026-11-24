#!/usr/bin/env node
/**
 * #291: real native StemMusicDirector internal SEGMENT boundaries,
 * not the separate previous song-to-song QA.
 *
 * Tests the 33 original songs' first, middle and final *internal* segment
 * handoffs by resuming ~2.5s before each boundary, then observing unmodified
 * audio-engine scheduling through that boundary in real browser time.
 *
 * No musical beat authority, no source/FX modifications, no master PCM
 * downloads, no media committed. Original audio remains owner-private.
 */
import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';

const origin=(process.env.GAME_URL||'http://127.0.0.1:8221').replace(/\/+$/,'');
const dest=process.env.REPORT_OUT;
const startIndex=Number(process.env.QA_START_INDEX??0);
const count=Number(process.env.QA_COUNT??1);
const lead=Number(process.env.QA_BOUNDARY_LEAD_SECONDS??2.5);
const mandatory=['vocals','drums','bass','guitar','piano','other'];
if(!dest||existsSync(dest))throw Error('Unique REPORT_OUT required');
if(!Number.isInteger(startIndex)||startIndex<0||startIndex>32||
	!Number.isInteger(count)||count<1||startIndex+count>33||
	!Number.isFinite(lead)||lead<1.8||lead>4.5)
	throw Error('Invalid original 33-song range or segment boundary lead');

const report={
	format:'bsb-actual-webaudio-original-intrasong-boundary-first-middle-last-v1',
	startIndex,count,leadSeconds:lead,cases:[],
	originalManifestStructuralBoundaries:[],httpErrors:[],pageErrors:[],
	startedAt:new Date().toISOString(),
	limitations:[
		'Original StemMusicDirector runs in Chromium with real original 33-song OGG packs, native WebAudio buffer scheduling and correct 48kHz manifest frame authority.',
		'QA deliberately seeks 2.5 seconds BEFORE each internal segment boundary using the existing transport resume offset; it does not play every full song uninterrupted.',
		'This tests original 6-channel source scheduling across 3 representative internal boundaries per song, not final speaker PCM, subjective fades or every one of 579 internal boundaries.',
		'All 579 manifest-level internal joins are separately validated for contiguous expected sample frames; not all 579 actual WebAudio crossings are exercised.',
		'Records include source IDs, scheduling timestamps, buffer sample rates and frame counts; no recorded copyrighted media or raw output.',
	]
};
const browser=await chromium.launch({headless:true,args:['--no-sandbox',
	'--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try{
	const page=await browser.newPage({viewport:{width:900,height:620}});
	page.on('pageerror',e=>report.pageErrors.push(String(e)));
	page.on('response',response=>{
		if(response.status()>=400&&!(
			response.status()===404&&
			/\/music\/packs\/[^/]+\/adaptive\/debutmont\//.test(response.url())
		)) report.httpErrors.push({status:response.status(),url:response.url()});
	});
	await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?._stemMusic?.ready&&
		window.__bbGame.scene.getScene('TitleScene')?.sys.isActive(),null,{timeout:35000});
	await page.keyboard.press('x');
	await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?.ctx?.state==='running',
		null,{timeout:25000});
	const init=await page.evaluate(()=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
		if(d.catalog.length!==33)throw Error('Original 33-song catalog unavailable');
		d.setMenuMode(true); // clean original sources, no audio FX changes
		const audit={events:[],call:null};
		window.__bbInternalBoundaryAudit=audit;
		const nativeStart=AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start=function(when=0,offset=0,duration){
			if(audit.call)audit.events.push({
				...audit.call,actualWhen:when,actualOffset:offset,
				actualDuration:duration??this.buffer?.duration,
				bufferFrames:this.buffer?.length,
				bufferDuration:this.buffer?.duration,
				sampleRate:this.buffer?.sampleRate,
				createdAt:d.ctx.currentTime,
			});
			return nativeStart.apply(this,arguments);
		};
		const nativeSchedule=d._scheduleSource;
		d._scheduleSource=function(index,name,buffer){
			audit.call={
				trackIndex:this.trackIndex,songId:this.pack?.id,
				segmentIndex:index,role:name,clockStart:this.clockStart,
				segmentStartFrame:this.pack?.segments[index]?.startFrame,
				segmentFrames:this.pack?.segments[index]?.frames,
			};
			try{return nativeSchedule.call(this,index,name,buffer)}
			finally{audit.call=null}
		};
		return {catalog:d.catalog.map(t=>({id:t.id,title:t.title})),
			ctxRate:d.ctx.sampleRate};
	});
	for(let index=startIndex;index<startIndex+count;index++){
		const expected=init.catalog[index];
		// Catalog/manifest data is read by production _getTrack().
		const meta=await page.evaluate(async index=>{
			const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
			const {track,pack}=await d._getTrack(index);
			const seg=pack.segments;
			const internal=[];
			for(let i=1;i<seg.length;i++){
				const prior=seg[i-1],next=seg[i];
				if(prior.startFrame+prior.frames!==next.startFrame)
					throw Error('Noncontiguous original source internal sample frames');
				internal.push({
					index:i,startFrame:next.startFrame,priorFrames:prior.frames,
					nextFrames:next.frames,time:next.startFrame/pack.sampleRate
				});
			}
			const candidates=[1,Math.floor(seg.length/2),seg.length-1];
			return {trackId:track.id,title:track.title,
				manifestSegmentCount:seg.length,
				sampleRate:pack.sampleRate,
				frameCount:pack.frameCount,
				duration:pack.duration,
				internal,candidates:[...new Set(candidates)]};
		},index);
		assert.equal(meta.trackId,expected.id);
		assert.equal(meta.internal.length,meta.manifestSegmentCount-1);
		assert.ok(meta.manifestSegmentCount>=3);
		report.originalManifestStructuralBoundaries.push({
			index,trackId:expected.id,segmentCount:meta.manifestSegmentCount,
			internalBoundaries:meta.internal.length,frameCount:meta.frameCount,
			sampleRate:meta.sampleRate
		});
		for(const target of meta.candidates){
			const targetSegment=meta.internal.find(s=>s.index===target);
			assert.ok(targetSegment);
			const setup=await page.evaluate(async({index,target,lead})=>{
				const d=window.__bbGame.registry.get('audioSynth')._stemMusic,
					log=window.__bbInternalBoundaryAudit;
				d.stop();
				log.events.length=0;
				d.trackIndex=index;
				const {pack}=await d._getTrack(index);
				if(pack.segments.length<=target)throw Error('Segment out of range');
				const boundary=pack.segments[target].startFrame/pack.sampleRate;
				const resume=boundary-lead;
				if(resume<=0)throw Error('Resume before original opening');
				d._resumeOffset=resume;
				if(!d.start())throw Error('Failed to start original song');
				return {boundary,resume,segmentIndex:target};
			},{index,target,lead});
			await page.waitForFunction(({index,target,id})=>{
				const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;
				const events=window.__bbInternalBoundaryAudit?.events||[];
				return d?.started&&d.trackIndex===index&&d.pack?.id===id&&
					!d._loading&&
					events.filter(e=>e.segmentIndex===target-1&&e.songId===id).length>=6&&
					events.filter(e=>e.segmentIndex===target&&e.songId===id).length>=6;
			},{index,target,id:expected.id},{timeout:38000});
			await page.waitForFunction(({target})=>{
				const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;
				return d?.ctx.currentTime >=
					d.clockStart+d.pack.segments[target].startFrame/d.pack.sampleRate+.30;
			},{target},{timeout:11000});
			const observed=await page.evaluate(({target,id})=>{
				const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
				const all=window.__bbInternalBoundaryAudit.events.filter(e=>e.songId===id);
				return {old:all.filter(e=>e.segmentIndex===target-1),
					next:all.filter(e=>e.segmentIndex===target),
					currentSongId:d.pack?.id,trackIndex:d.trackIndex,
					clockStart:d.clockStart,ctxTime:d.ctx.currentTime,
					scheduled:[...d.scheduled],
					lastError:d.lastError||null,started:d.started};
			},{target,id:expected.id});
			assert.equal(observed.currentSongId,expected.id);
			assert.equal(observed.trackIndex,index);
			assert.ok(observed.started&&observed.lastError===null);
			const old=new Map(observed.old.map(e=>[e.role,e]));
			const next=new Map(observed.next.map(e=>[e.role,e]));
			const timings=[];
			for(const role of mandatory){
				const a=old.get(role),b=next.get(role);
				assert.ok(a&&b,'Missing actual original source '+role+' index='+index+' boundary='+target);
				assert.equal(a.segmentStartFrame+targetSegment.priorFrames,
					b.segmentStartFrame,'Sample frame authority disagrees');
				assert.equal(a.sampleRate,b.sampleRate);
				assert.equal(a.sampleRate,init.ctxRate,
					'Original source decoded at wrong playback-device sample rate');
				// Original OGG metadata is 48 kHz; browser playback context
				// can be 44.1 kHz. DecodeAudioData RESAMPLES to AudioContext
				// sample rate. Verify duration within one device sample.
				const priorExpectedSeconds=targetSegment.priorFrames/meta.sampleRate;
				const nextExpectedSeconds=targetSegment.nextFrames/meta.sampleRate;
				assert.ok(Math.abs(a.bufferFrames/a.sampleRate-priorExpectedSeconds)
					<=1.5/a.sampleRate,
					'Original prior OGG was truncated or padded after resampling');
				assert.ok(Math.abs(b.bufferFrames/b.sampleRate-nextExpectedSeconds)
					<=1.5/b.sampleRate,
					'Original next OGG was truncated or padded after resampling');
				const oldEnd=a.actualWhen+a.actualDuration;
				const sampleGap=b.actualWhen-oldEnd;
				assert.ok(Math.abs(sampleGap)<.020,
					'Actual original stem scheduling gap >=20ms '+JSON.stringify({
						index,target,role,sampleGap,oldEnd,nextStart:b.actualWhen
					}));
				const expectedNext=observed.clockStart+targetSegment.time;
				assert.ok(Math.abs(b.actualWhen-expectedNext)<.020,
					'Next segment not at source-authoritative sample clock');
				assert.ok(a.actualOffset>0&&a.actualOffset<targetSegment.priorFrames/meta.sampleRate,
					'QA did not resume inside ORIGINAL previous segment');
				timings.push({role,previousDeviceFrames:a.bufferFrames,nextDeviceFrames:b.bufferFrames,
					originalSourceSampleRate:meta.sampleRate,sampleRate:a.sampleRate,
					previousStartClock:a.actualWhen,
					previousScheduledOffset:a.actualOffset,
					previousStopClock:oldEnd,
					nextStartClock:b.actualWhen,
					absoluteGapMs:Math.abs(sampleGap)*1000});
			}
			report.cases.push({
				trackIndex:index,trackId:expected.id,
				oldSegmentIndex:target-1,nextSegmentIndex:target,
				realBoundaryFrame:targetSegment.startFrame,
				realBoundaryTime:targetSegment.time,
				qaResumeOffset:setup.resume,
				originalRolesChecked:timings.length,
				maxAbsGapMs:Math.max(...timings.map(t=>t.absoluteGapMs)),
				originalSourceScheduling:timings
			});
			console.log('REAL_INTRA_SEGMENT_BOUNDARY_PASS',index,expected.id,
				'join',target-1,'->',target,
				'maxAbsGapMs',report.cases.at(-1).maxAbsGapMs.toFixed(4));
		}
	}
	assert.equal(report.pageErrors.length,0,'Original page errors');
	assert.equal(report.httpErrors.length,0,'Original media/HTTP errors');
	assert.equal(report.cases.length,count*3);
	report.status='PASS_NATIVE_REAL_ORIGINAL_INTRA_SEGMENT_SCHEDULING_NOT_FULL_SONG';
	report.summary={
		originalSongs:count,actualWebAudioInternalHandoffs:report.cases.length,
		actualOriginalSourceRoleComparisons:report.cases.length*6,
		structuralInternalSourceBoundaries:report.originalManifestStructuralBoundaries.reduce(
			(sum,x)=>sum+x.internalBoundaries,0),
		maxAbsScheduledGapMs:Math.max(...report.cases.map(x=>x.maxAbsGapMs)),
	};
	console.log('REAL_33_SONG_INTRA_SEGMENT_QA',report.status,JSON.stringify(report.summary));
}catch(e){
	report.status='FAIL_OR_INCOMPLETE';
	report.error=String(e);
	console.error('REAL_33_SONG_INTRA_SEGMENT_QA_FAILED',String(e));
	process.exitCode=1;
}finally{
	report.finishedAt=new Date().toISOString();
	writeFileSync(dest,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
	await browser.close();
}
