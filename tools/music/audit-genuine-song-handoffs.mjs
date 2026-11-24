#!/usr/bin/env node
/**
 * #291: Real 33-song current-engine end->next handoff, with a QA-only
 * resume offset near each song end. No production transport code changes,
 * no synthetic audio, no source-master file copies.
 *
 * Captures ACTUAL AudioBufferSourceNode.start() times of all original stems
 * in the real StemMusicDirector._scheduleSource() call path, including
 * the last source segment and next track's first. Native song clock,
 * timer, preload, Vite path and WebAudio decoding remain authoritative.
 * We do NOT claim to have listened to whole 3-4 minute songs.
 */
import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const url=(process.env.GAME_URL||'http://127.0.0.1:8221').replace(/\/+$/,'');
const out=process.env.REPORT_OUT;
const startIndex=Number(process.env.QA_START_INDEX??0);
const count=Number(process.env.QA_COUNT??2);
const leadSeconds=Number(process.env.QA_END_LEAD_SECONDS??4.5);
if(!out||existsSync(out))throw Error('Unique REPORT_OUT required');
if(!Number.isInteger(startIndex)||startIndex<0||startIndex>32||
	!Number.isInteger(count)||count<1||startIndex+count>33||
	!Number.isFinite(leadSeconds)||leadSeconds<3.2||leadSeconds>11)
	throw Error('Invalid original song run range/lead seconds');
const report={format:'bsb-real-33-song-native-end-handoff-schedules-v1',
	startIndex,count,leadSeconds,
	startedAt:new Date().toISOString(),cases:[],httpErrors:[],pageErrors:[],
	limitations:[
		'This uses the genuine production song engine, actual original OGG and WebAudio scheduling, and real elapsed time through the ending; test-only starting offset seeks to 4.5 seconds BEFORE the original ending to avoid waiting hours.',
		'Measurements are sample-clock start/end scheduling math from actual native AudioBufferSourceNode.start calls; this is not independent proof of real ear-level sound during a complete song.',
		'The next-track 0-buffer decoded and mixed through the authentic game StemMusicDirector; source 0 original audio is not a fabricated test sound.',
		'Gap threshold is 0.20s source scheduling across track boundary, not a claim of an artist-approved intentional musical crossfade.',
		'Original songs are private, none copied into Git; report contains event timing and IDs only.',
	]};
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
	'--enable-webgl','--ignore-gpu-blocklist'
]});
try{
	const page=await browser.newPage({viewport:{width:1080,height:720}});
	page.on('pageerror',e=>report.pageErrors.push(String(e)));
	page.on('response',r=>{
		if(r.status()>=400&&!(/\/music\/packs\/[^/]+\/adaptive\/debutmont\//.test(r.url())&&r.status()===404))
			report.httpErrors.push({status:r.status(),url:r.url()});
	});
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?._stemMusic?.ready&&
		window.__bbGame.scene.getScene('TitleScene')?.sys.isActive(),null,{timeout:30000});
	await page.keyboard.press('x');
	await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?.ctx?.state==='running',
		null,{timeout:30000});
	const ready=await page.evaluate(()=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
		const songs=d.catalog.map(t=>({id:t.id,title:t.title}));
		if(songs.length!==33)throw Error('Not 33 original songs');
		// Use production clean-menu mode so a source/voice not encoded
		// for a selected biome cannot create a false mandatory mismatch.
		a.applySettings({...a.settings,masterVolume:1,musicVolume:1,sfxVolume:1,
			windVolume:1,windEnabled:true});
		d.setMenuMode(true);
		const audit={events:[],calls:[],call:null};
		window.__bbHandoffAudit=audit;
		const nativeStart=AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start=function(when=0,offset=0,duration){
			if(audit.call){
				audit.events.push({...audit.call,
					actualWhen:when,actualOffset:offset,
					actualDuration:duration??this.buffer.duration,
					bufferDuration:this.buffer?.duration,
					sampleRate:this.buffer?.sampleRate,
					createdAt:d.ctx.currentTime,
				});
			}
			return nativeStart.apply(this,arguments);
		};
		const nativeSchedule=d._scheduleSource;
		d._scheduleSource=function(index,name,buffer){
			audit.call={songId:this.pack?.id,trackIndex:this.trackIndex,
				segmentIndex:index,role:name,
				startFrame:this.pack?.segments[index]?.startFrame,
				frames:this.pack?.segments[index]?.frames,
				songDuration:this.pack?.duration,
				clockStart:this.clockStart};
			try{return nativeSchedule.call(this,index,name,buffer)}
			finally{audit.call=null}
		};
		return {songs,ctxRate:a.ctx.sampleRate};
	});
	assert.equal(ready.songs.length,33);
	for(let index=startIndex;index<startIndex+count;index++){
		const expected=ready.songs[index];
		const expectedNext=ready.songs[(index+1)%33];
		console.log('NATIVE_ORIGINAL_SONG_END_HANDOFF_START',index,expected.id,
			'TO',expectedNext.id);
		const prepared=await page.evaluate(async args=>{
			const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic,
				log=window.__bbHandoffAudit;
			log.events.length=0;
			d.stop();
			// The first pack manifest is decoded using production logic;
			// then use existing resume offset to enter 4.5s before end,
			// so full natural end-of-track transition still occurs.
			d.trackIndex=args.index;
			const desc=await d._getTrack(args.index);
			const songDuration=desc.pack.duration;
			if(songDuration<=args.leadSeconds+5)throw Error('Unrealistic short song');
			const last=desc.pack.segments.at(-1);
			d._resumeOffset=songDuration-args.leadSeconds;
			if(!d.start())throw Error('Failed to start actual song near its end');
			return {originalId:desc.pack.id,originalTitle:desc.track.title,
				originalSegments:desc.pack.segments.length,
				lastSegmentStartSeconds:last.startFrame/desc.pack.sampleRate,
				songDuration,sourceRoles:desc.pack.sourceNames.length};
		},{index,leadSeconds});
		assert.equal(prepared.originalId,expected.id);
		await page.waitForFunction(({index,expectedId})=>{
			const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;
			return d?.started&&d.pack?.id===expectedId&&
				d.trackIndex===index&&d.activeNodes.size>=6&&!d._loading;
		},{index,expectedId:expected.id},{timeout:42000});
		const base=await page.evaluate(()=>{
			const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
			return {ctxNow:d.ctx.currentTime,clockStart:d.clockStart,
				songId:d.pack.id,trackToken:d._token,duration:d.pack.duration,
				scheduled:[...d.scheduled],lastError:d.lastError||null};
		});
		await page.waitForFunction(({expectedNextId,nextIndex})=>{
			const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;
			return d?.started&&d.pack?.id===expectedNextId&&
				d.trackIndex===nextIndex&&d.activeNodes.size>=6&&!d._loading;
		},{expectedNextId:expectedNext.id,nextIndex:(index+1)%33},{timeout:19000});
		await page.waitForTimeout(220);
		const end=await page.evaluate(({originalId,nextId})=>{
			const d=window.__bbGame.registry.get('audioSynth')._stemMusic,
				log=window.__bbHandoffAudit;
			const old=log.events.filter(e=>e.songId===originalId);
			const now=log.events.filter(e=>e.songId===nextId);
			const oldLast=Math.max(...old.map(e=>e.segmentIndex));
			const ending=old.filter(e=>e.segmentIndex===oldLast);
			const opening=now.filter(e=>e.segmentIndex===0);
			return {
				actualTrack:d.pack?.id,ctxNow:d.ctx.currentTime,
				clockStart:d.clockStart,trackToken:d._token,
				musicRunning:d.started,sourceNodes:d.activeNodes.size,
				oldLastSegment:oldLast,
				oldLastSegmentSources:ending,
				newFirstSegmentSources:opening,
				oldScheduledSourceCount:old.length,newScheduledSourceCount:now.length,
				lastError:d.lastError||null,
			};
		},{originalId:expected.id,nextId:expectedNext.id});
		assert.equal(end.actualTrack,expectedNext.id);
		assert.ok(end.oldLastSegmentSources.length>=6,
			'Missing original last segment scheduled audio '+index);
		assert.ok(end.newFirstSegmentSources.length>=6,
			'Missing NEXT original first segment scheduled audio '+index);
		assert.equal(end.oldLastSegment,prepared.originalSegments-1);
		const mandatory=['drums','bass','guitar','piano','other','vocals'];
		const oldRoles=new Map(end.oldLastSegmentSources.map(x=>[x.role,x]));
		const newRoles=new Map(end.newFirstSegmentSources.map(x=>[x.role,x]));
		const aligned=[];
		for(const name of mandatory){
			const prev=oldRoles.get(name),next=newRoles.get(name);
			assert.ok(prev&&next,'Missing mandatory original song role '+name);
			const oldAbsoluteEnd=prev.actualWhen+prev.actualDuration;
			const gapSeconds=next.actualWhen-oldAbsoluteEnd;
			const sampleClocks={
				role:name,oldSourceIndex:prev.segmentIndex,
				oldSourceStart:prev.actualWhen,oldSourceEnd:oldAbsoluteEnd,
				newSourceStart:next.actualWhen,gapSeconds,
				oldSrcDuration:prev.actualDuration,newSrcDuration:next.actualDuration,
				originalSampleRate:prev.sampleRate,nextSampleRate:next.sampleRate,
			};
			assert.ok(Math.abs(gapSeconds)<.02,
				'Original source transport gap/overlap >=20ms '+index+' '+JSON.stringify(sampleClocks));
			aligned.push(sampleClocks);
		}
		assert.ok(end.trackToken>base.trackToken,'Next song transport never advanced');
		assert.ok(end.musicRunning&&end.sourceNodes>=6);
		assert.ok(!end.lastError,'Source loader reported failure '+end.lastError);
		const summary={index,sourceId:expected.id,nextSongIndex:(index+1)%33,
			nextSourceId:expectedNext.id,sourceSongDuration:prepared.songDuration,
			sourceSegmentCount:prepared.originalSegments,
			oldSourceCalls:end.oldScheduledSourceCount,
			newSourceCalls:end.newScheduledSourceCount,
			actualOldEndClock:base.clockStart+prepared.songDuration,
			actualNewSongClock:end.clockStart,
			gapAtSongClock:end.clockStart-(base.clockStart+prepared.songDuration),
			mandatorySourceBoundaryTimings:aligned,
			maxAbsSourceGapMs:Math.max(...aligned.map(x=>Math.abs(x.gapSeconds)))*1000,
		};
		assert.ok(Math.abs(summary.gapAtSongClock)<.02,
			'Source song master clocks not aligned '+JSON.stringify(summary));
		report.cases.push(summary);
		console.log('REAL_ORIGINAL_WEBAUDIO_SONG_HANDOFF_PASS',
			index,expected.id,'->',expectedNext.id,
			'gapMaxMs',summary.maxAbsSourceGapMs.toFixed(2),
			'transportClockDeltaMs',(summary.gapAtSongClock*1000).toFixed(2));
	}
	assert.equal(report.pageErrors.length,0);
	assert.equal(report.httpErrors.length,0);
	assert.equal(report.cases.length,count);
	report.status='PASS_REAL_SONG_HANDOFF_SCHEDULES_NOT_CONTINUOUS_MASTERING';
	report.summary={cases:report.cases.length,originalSourceRoles:6,
		maxSourceGapMs:Math.max(...report.cases.map(x=>x.maxAbsSourceGapMs)),
		maxClockShiftMs:Math.max(...report.cases.map(x=>Math.abs(x.gapAtSongClock)))*1000};
	console.log('ACTUAL_REAL_WEBAUDIO_SONG_HANDOFFS',report.status,JSON.stringify(report.summary));
}catch(e){
	report.status='FAIL_OR_INCOMPLETE';
	report.error=String(e);
	console.error('ACTUAL_REAL_WEBAUDIO_SONG_HANDOFF_FAILED',String(e));
	process.exitCode=1;
}finally{
	report.completedAt=new Date().toISOString();
	writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
	await browser.close();
}
