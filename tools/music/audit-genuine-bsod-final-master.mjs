#!/usr/bin/env node
/**
 * ISSUE #291 / READ-ONLY live game output audit:
 * source-authentic 33-song music and ACTUAL simulation BSOD collision,
 * CRASH subscriber, FatalCrashCountIn.start, native SFX/wind/static and
 * original master -> compressor -> OutputPeakGuard -> PCM AudioWorklet.
 *
 * Uses NO scripted AudioSynth crash/SFX/counterfeit OGG events. To reach a
 * collision quickly the browser QA intentionally moves the real BSOD wall
 * near the sled and speeds it, then advances the REAL physics via
 * game.headlessStep. This is an accelerated actual collision, not a
 * natural player replay or a random gameplay stress distribution.
 */
import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const base=process.env.GAME_URL||'http://127.0.0.1:8221/';
const output=process.env.REPORT_OUT;
const songIndex=Number(process.env.QA_SONG_INDEX||0);
const testUnlockVocals=process.env.QA_ORIGINAL_VOCALS==='1';
if(!output||existsSync(output))throw Error('REPORT_OUT must be a new immutable JSON file');
if(!Number.isInteger(songIndex)||songIndex<0||songIndex>32)
	throw Error('QA_SONG_INDEX must be between 0 and 32');
const report={
	format:'bsb-live-sim8-genuine-bsod-physics-final-master-worklet-4x-v1',
	songIndex,url:base,startedAt:new Date().toISOString(),
	limitations:[
		'Real live game Web Audio, peak guard and read-only AudioWorklet PCM, not offline scripted AudioSynth events',
		'BSOD collision itself is accelerated by QA positioning/speed of the real wall before calling real physics headlessStep; not organically played or recorded player input',
		'Captures limited seconds of one original track, not full 33-song continuous audio or each biome',
		'4x Hann-windowed-sinc intersample estimate is NOT a calibrated mastering BS.1770 meter',
		'Quantum-v3 begins recording only AFTER a 450ms strictly contiguous warmup; startup worklet activation gaps are excluded BEFORE arming, while EVERY post-arm quantum must remain continuous, without filling or overlooking gaps',
		'Non-silent master audio during four original drum source onsets does not establish that those drums were independently audible above wind and other program audio; only scheduled source identity is verified',
		'AudioWorklet is a read-only sidechain with silent output to destination; live AudioContext device/platform timing affects observed signal',
		'No private PCM or source media is stored in this public code repository; report includes only analysis metrics and event identities',
	]
};
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
	'--enable-webgl','--ignore-gpu-blocklist',
	'--autoplay-policy=no-user-gesture-required',
]});
const errors=[],httpErrors=[],mediaRequests=[];
try{
	const page=await browser.newPage({viewport:{width:1280,height:800}});
	// Install read-only provenance before game initialization/OGG decoding.
	await page.addInitScript({path:new URL('./observe-original-ogg-fetch.js',import.meta.url).pathname});
	page.on('pageerror',e=>errors.push(String(e)));
	page.on('response',res=>{
		if(res.status()>=400)httpErrors.push({status:res.status(),url:res.url()});
	});
	page.on('request',req=>{
		if(req.url().endsWith('.ogg'))mediaRequests.push(req.url());
	});
	await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>
		window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive() &&
		window.__bbGame.registry.get('audioSynth')?._stemMusic?.ready,
		null,{timeout:30000});
	await page.keyboard.press('x');
	await page.waitForFunction(()=>
		window.__bbGame?.registry?.get('audioSynth')?.ctx?.state==='running',
		null,{timeout:20000});
	// Start an unchanged original song selection from the real 33 catalog;
	// no synthetic MIDI or test-substitute stem player.
	await page.evaluate(({index,testUnlockVocals})=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
		if(d.catalog.length!==33)throw Error('Original 33-song catalog not available');
		if(testUnlockVocals){
			// Genuine vocal unlock gate, but only in this throwaway browser
			// registry instance. Do NOT mutate the player's real profile.
			const profile=g.registry.get('profile')||{};
			g.registry.set('profile',{...profile,unlocked:{
				...profile.unlocked,musicVocals:true}});
		}
		// Max-volume QA settings on the disposable browser only.
		// Owner-approved per-biome FX and source recordings stay unchanged.
		a.applySettings({...a.settings,masterVolume:1,musicVolume:1,
			sfxVolume:1,windVolume:1,windEnabled:true,musicVocals:testUnlockVocals,
			vocalGain:1,melodyWithVocalsGain:.18});
		d.stop();
		d.trackIndex=index;
		if(!d.start())throw Error('Cannot start authentic song '+index);
	},{index:songIndex,testUnlockVocals});
	await page.waitForFunction(index=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.started&&d.pack&&d.trackIndex===index&&d.activeNodes.size>=6&&
			!d._loading&&d.ctx.state==='running';
	},songIndex,{timeout:50000});
	await page.evaluate(()=>{
		const g=window.__bbGame;
		window.__bbFinalAuditEvents=[];
		for(const [name,event] of [
			['bsod','bb:bsodStateChanged'],['crash','bb:crash'],['end','bb:runEnd'],
			['start','bb:runStart'],['landing','bb:landing']
		])g.events.on(event,p=>{
			const a=g.registry.get('audioSynth'),c=a?.ctx;
			window.__bbFinalAuditEvents.push({
				name,ctxTime:c?.currentTime,simMs:g.scene.getScene('RunScene')?.runTimeMs,
				cause:p?.cause??null,fatal:p?.fatal??null,
				negated:p?.negated??null,
				proximity:p?.proximity01??null,
				relativeAirX:p?.relativeAirX??null,
			});
		});
		g.scene.getScene('TitleScene').startRun('real-bsod-output-audit');
	});
	await page.waitForFunction(()=>
		window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive() &&
		window.__bbGame.registry.get('audioSynth')?._stemMusic?.started,
		null,{timeout:25000});
	// Install tap at the actual final output, after its last soft ceiling.
	// Captured PCM never goes into an audible output: tap -> zero gain -> dest.
	const pre=await page.evaluate(async()=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth'),
			d=a._stemMusic,c=a.ctx;
		if(!a.nodes.peakGuard||c.state!=='running'||!d.pack)
			throw Error('Cannot attach live post-guard capture');
		await c.audioWorklet.addModule('/tools/music/live-final-master-capture-processor.js');
		const tap=new AudioWorkletNode(c,'bsb-live-final-master-tap',{
			numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],
			channelCount:2,channelCountMode:'explicit',
			processorOptions:{stableWarmupFrames:Math.round(c.sampleRate*.45)}
		});
		const silent=c.createGain();silent.gain.value=0;
		a.nodes.peakGuard.connect(tap);
		tap.connect(silent);silent.connect(c.destination);
		const chunks=[];
		const state={chunks,stopped:false,chronologyErrors:[],
			armed:false,armFrame:null,warmupGaps:null,
			sampleRate:c.sampleRate,installedAt:c.currentTime};
		tap.port.onmessage=e=>{
			const msg=e.data;
			if(msg?.type==='pcm')chunks.push(msg);
			if(msg?.type==='discontinuity')state.chronologyErrors.push(msg);
			if(msg?.type==='armed'){
				state.armed=true;state.armFrame=msg.armFrame;
				state.warmupGaps=msg.warmupGaps;
			}
			if(msg?.type==='stopped'){
				state.stopped=true;
				state.quantumValidationVersion=msg.quantumValidationVersion;
			}
		};
		window.__bbLiveFinalAudit={tap,silent,state};
		return {songId:d.pack.id,trackId:d.track.id,
			currentBiome:d.biome,sourceCount:d.pack.sourceNames.length,
			originalRoles:[...d.mixer.sources.keys()],
			audioSampleRate:c.sampleRate,clockStart:d.clockStart,
			trackToken:d._token,roomActive:d.mixer.space.wetEnabled,
			outputGuard:a.nodes.peakGuard.constructor.name,
			workletTap:tap.constructor.name,
			mediaRequestsSoFar:0,
			testUserGains:{master:a.settings.masterVolume,
				music:a.settings.musicVolume,sfx:a.settings.sfxVolume,
				wind:a.settings.windVolume,enabled:a.settings.windEnabled,
				vocals:a.settings.musicVocals},
		};
	});
	assert.ok(pre.outputGuard.includes('WaveShaper'));
	assert.equal(pre.sourceCount,18);
	assert.ok(pre.originalRoles.includes('drums'));
	for(const key of ['master','music','sfx','wind'])
		assert.equal(pre.testUserGains[key],1,'Owner QA max-volume '+key);
	assert.equal(pre.testUserGains.enabled,true);
	assert.equal(pre.testUserGains.vocals,testUnlockVocals,
		'Original vocals did not honor the disposable QA profile toggle');
	console.log('REAL_GAME_POST_GUARD_TAP',JSON.stringify(pre));
	// Start the physics collision ONLY once the AUDIO CLOCK has truly
	// advanced at least 300ms beyond the first qualified armed frame.
	// Playwright timers alone are not tied to the WebAudio render clock.
	try{
		await page.waitForFunction(()=>{
			const state=window.__bbLiveFinalAudit?.state;
			const ctx=window.__bbGame?.registry.get('audioSynth')?.ctx;
			return !!ctx&&state?.armed===true&&
				ctx.currentTime>=state.armFrame/ctx.sampleRate+.30&&
				state.chunks.length>=8&&!state.chronologyErrors.length;
		},null,{timeout:18000});
	}catch(error){
		// Lack of a 450ms uninterrupted STARTUP window is a diagnostic
		// arm failure, NOT a measured audio peak or original source
		// problem. But refuse this explanation if the game or media
		// source simultaneously failed.
		const state=await page.evaluate(()=>{
			const x=window.__bbLiveFinalAudit?.state;
			const a=window.__bbGame?.registry.get('audioSynth');
			return {armed:x?.armed,armFrame:x?.armFrame,
				warmupGaps:x?.warmupGaps,quantumErrors:x?.chronologyErrors?.length,
				chunks:x?.chunks?.length,audioState:a?.ctx?.state,
				songStarted:a?._stemMusic?.started,musicError:a?._stemMusic?.lastError};
		});
		const badHttp=httpErrors.filter(({status,url})=>!
			(status===404&&/\/music\/packs\/[^/]+\/adaptive\/debutmont\//.test(url)));
		if(errors.length||badHttp.length||!state.songStarted||state.musicError)
			throw Error('QA_OR_SOURCE: Cannot arm due concurrent game/media failure: '+
				JSON.stringify({errors,badHttp,state}));
		throw Error('INSTRUMENT_CAPTURE: Qualified startup arm unavailable: '+
			JSON.stringify(state)+'; original '+String(error).slice(0,100));
	}
	const captureReady=await page.evaluate(()=>{
		const state=window.__bbLiveFinalAudit.state;
		const ctx=window.__bbGame.registry.get('audioSynth').ctx;
		return {armFrame:state.armFrame,armTime:state.armFrame/ctx.sampleRate,
			currentTime:ctx.currentTime,
			preCrashSeconds:ctx.currentTime-state.armFrame/ctx.sampleRate,
			bufferedChunks:state.chunks.length,warmupGaps:state.warmupGaps};
	});
	console.log('QUALIFIED_V3_PRECRASH_SAMPLE_CLOCK',JSON.stringify(captureReady));
	const crash=await page.evaluate(()=>{
		const g=window.__bbGame,r=g.scene.getScene('RunScene'),
			a=g.registry.get('audioSynth'),d=a._stemMusic;
		const before={runTimeMs:r.runTimeMs,sourcePosition:a.jukeboxSnapshot().position,
			sledLeft:r.sled.body.bounds.min.x,
			wallLeft:r.bsod.wallX,
			songId:d.pack.id,
			audioCurrentTime:a.ctx.currentTime,clockStart:d.clockStart,
			token:d._token};
		// Only QA modifications: force a REAL collision soon through the
		// existing simulation; do NOT emit CRASH or call AudioSynth directly.
		g.loop.stop();
		r.bsod.wallX=r.sled.body.bounds.min.x+12;
		r.bsod.wallSpeedPxS=10000;
		g.headlessStep(8000,16.67);
		g.headlessStep(8017,16.67);
		if(!r.crashed||!r.bsodCaught)
			throw Error('BSOD collision did not occur in actual game physics');
		const countin=a.getFatalCountInStatus();
		if(!countin?.active||countin.scheduledDrumAccents!==4)
			throw Error('Real game crash did not schedule four original drum hits');
		return {
			before,after:{runTimeMs:r.runTimeMs,crashed:r.crashed,
				bsodCaught:r.bsodCaught,reason:r.pendingCrash?.cause??'resolved',
				trackId:d.pack.id,token:d._token,clockStart:d.clockStart,
				originalDrumAudioSegment:countin.sourceSegment,
				originalDrumSource:countin.drumSource,
				originalDrumSourceOffset:countin.sourceOffset,
				audioCurrentTime:a.ctx.currentTime},
			countIn:{
				runId:countin.runId,startAudioTime:countin.startAudioTime,
				sourceSegment:countin.sourceSegment,
				drumSource:countin.drumSource,
				scheduledDrumAccents:countin.scheduledDrumAccents,
				beatOnsets:countin.beatOnsets,
				bandAt:countin.bandAt,timingKind:countin.timingKind,
				verified:countin.verified
			},
			events:window.__bbFinalAuditEvents,
		};
	});
	assert.equal(crash.after.crashed,true);
	assert.equal(crash.after.bsodCaught,true);
	assert.equal(crash.countIn.scheduledDrumAccents,4);
	assert.equal(crash.countIn.verified,false);
	assert.equal(crash.countIn.timingKind,'synthetic-unverified');
	assert.equal(crash.before.clockStart,crash.after.clockStart);
	assert.equal(crash.before.token,crash.after.token);
	assert.ok(crash.events.some(e=>e.name==='crash'&&e.fatal===true&&e.negated===false));
	assert.ok(crash.events.some(e=>e.name==='end'));
	assert.ok(crash.events.some(e=>e.name==='bsod'&&e.proximity===1),
		'No real BSOD peak wall threat actually observed');
	// Tie the real count-in's native original-drum segment to the exact
	// private, unmodified OGG bytes, with SHA-256 from WebCrypto in Chromium.
	// Independent Node verification rereads it directly from the source
	// archive, so this is NOT a test fixture or replacement drum.
	const originalDrum=await page.evaluate(async info=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		const track=d.catalog.find(x=>x.id===info.trackId);
		if(!track?.manifest)throw Error('Original pack provenance missing');
		const url=new URL('/music/'+track.manifest,location.origin);
		const r=await fetch(url);
		if(!r.ok)throw Error('Original OGG manifest HTTP '+r.status);
		const manifest=await r.json();
		if(manifest.id!==info.trackId)throw Error('Original OGG manifest identity mismatch');
		const rel=manifest.segments?.[info.segment]?.sources?.drums;
		if(!rel)throw Error('Actual count-in original drum is absent');
		const srcUrl=new URL(rel,url);
        const fetched=window.__bbOriginalOggFetchProof;
        if(!fetched||fetched.protocol!=='game-original-response-clone-v2')
            throw Error('Missing pre-game original-response provenance hook');
        await Promise.all(fetched.pending);
        const observed=fetched.records.get(srcUrl.pathname);
        if(!observed)throw Error('No original game-decoding fetch for drum '+srcUrl.pathname);
        // All four fatal count-in nodes must use the same actual cached
        // AudioBuffer obtained from the production game's source fetch.
        const cached=d.cache?.get(info.segment+'/drums');
        const playing=window.__bbGame.registry.get('audioSynth')._fatalCountIn?.sources;
        if(!cached||playing?.length!==4||!playing.every(src=>src.buffer===cached))
            throw Error('Fatal source buffers do not match game decoded original drum cache');
		return {trackId:track.id,manifest:track.manifest,
			sourceSegment:info.segment,relativeOggPath:rel,
            originalOggSha256:observed.sha256,originalOggBytes:observed.bytes,
            sourceFetchProvenance:fetched.protocol,sourceSampleRate:manifest.sampleRate};
	},{trackId:crash.after.trackId,segment:crash.countIn.sourceSegment});
	assert.equal(originalDrum.trackId,pre.trackId);
	assert.equal(originalDrum.sourceSegment,crash.countIn.sourceSegment);
	assert.match(originalDrum.originalOggSha256,/^[0-9a-f]{64}$/);
	console.log('REAL_CRASH_ORIGINAL_OGG_SOURCE_FINGERPRINT',
		JSON.stringify({trackId:originalDrum.trackId,drumSegment:originalDrum.sourceSegment,
			sha256:originalDrum.originalOggSha256,bytes:originalDrum.originalOggBytes}));
	console.log('REAL_GAME_PHYSICS_BSOD_CRASH_COUNTIN',JSON.stringify({
		trackId:crash.after.trackId,source:crash.countIn.drumSource,
		audioTime:crash.after.audioCurrentTime,drumHits:4,
		events:crash.events.map(e=>e.name),syntheticTiming:crash.countIn.verified===false
	}));
	await page.waitForFunction(()=>
		window.__bbGame.registry.get('audioSynth')?.getFatalCountInStatus()?.stage==='full-band' &&
		!window.__bbGame.registry.get('audioSynth')?.getFatalCountInStatus()?.active,
		null,{timeout:11500});
	await page.waitForTimeout(300);
	const measured=await page.evaluate(async collision=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth'),
			d=a._stemMusic,installed=window.__bbLiveFinalAudit;
		installed.tap.port.postMessage({type:'stop'});
		const until=Date.now()+1700;
		while(!installed.state.stopped&&Date.now()<until)
			await new Promise(resolve=>setTimeout(resolve,30));
		if(!installed.state.stopped)throw Error('INSTRUMENT_CAPTURE: Worklet did not finish capture');
		if(installed.state.quantumValidationVersion!==3||
			!installed.state.armed||
			!Number.isSafeInteger(installed.state.armFrame))
			throw Error('INSTRUMENT_CAPTURE: Missing qualified quantum-v3 arm proof');
		installed.tap.disconnect();installed.silent.disconnect();
		a.nodes.peakGuard.disconnect(installed.tap);
		if(installed.state.chronologyErrors.length)
			throw Error('INSTRUMENT_CAPTURE: per-quantum chronology '+JSON.stringify(
				installed.state.chronologyErrors.slice(0,3)));
		const allChunks=installed.state.chunks;
		if(allChunks.length<50)throw Error('INSTRUMENT_CAPTURE: No genuine final PCM chunks from actual game');
		const sampleRate=installed.state.sampleRate;
		// Startup samples are never recorded before arming. Any missing
		// sample AFTER the qualified arm is non-retryable within this
		// instrument capture; no gap healing or post-hoc exclusion.
		const gapDetails=[];
		const tailIndex=0;
		for(let i=1;i<allChunks.length;i++){
			const prev=allChunks[i-1],curr=allChunks[i];
			const expected=prev.frame+prev.frames;
			if(curr.frame!==expected)
				throw Error('INSTRUMENT_CAPTURE: Armed PCM discontinuity '+JSON.stringify({
					index:i,actual:curr.frame,expected,delta:curr.frame-expected}));
		}
		const chunks=allChunks;
		const firstFrame=chunks[0].frame;
		if(firstFrame!==installed.state.armFrame)
			throw Error('INSTRUMENT_CAPTURE: First sample not the qualified arm frame');
		const gapToCrash=collision.after.audioCurrentTime-firstFrame/sampleRate;
		if(gapToCrash<.14)throw Error('INSTRUMENT_CAPTURE: No 140ms pre-crash CONTIGUOUS live output: '+gapToCrash);
		const frames=chunks.reduce((sum,chunk)=>sum+chunk.frames,0);
		if(frames<sampleRate*2)throw Error('INSTRUMENT_CAPTURE: Captured fewer than 2 seconds of final game output');
		const left=new Float32Array(frames),right=new Float32Array(frames);
		let off=0,priorEnd=firstFrame;
		for(const chunk of chunks){
			if(chunk.frame!==priorEnd)
				throw Error('INSTRUMENT_CAPTURE: Unrecoverable gap inside final crash output: '+JSON.stringify({
					actual:chunk.frame,expected:priorEnd}));
			if(chunk.sampleRate!==sampleRate)throw Error('INSTRUMENT_CAPTURE: Variable audio sample rate');
			left.set(chunk.left,off);right.set(chunk.right,off);
			off+=chunk.frames;priorEnd=chunk.frame+chunk.frames;
		}
		if(priorEnd/sampleRate<collision.countIn.bandAt+.15)
			throw Error('INSTRUMENT_CAPTURE: Capture ended before authentic original band recovery');
		const {measureFourTimesTruePeak}=await import('/tools/music/estimate-true-peak-4x.js');
		const pcm={sampleRate,numberOfChannels:2,length:frames,
			getChannelData:channel=>channel===0?left:right};
		const result=measureFourTimesTruePeak(pcm,{
			startFrame:Math.min(48,Math.round(frames*.01)),
			endFrame:frames-Math.min(48,Math.round(frames*.01))
		});
		const origin=firstFrame/sampleRate;
		const clockWindows=crashTimes=>{
			const out={};
			for(const [name,at] of Object.entries(crashTimes)){
				const begin=Math.round((at+.012-origin)*sampleRate);
				const end=Math.round((at+.115-origin)*sampleRate);
				if(begin<0||end>frames)throw Error('INSTRUMENT_CAPTURE: Real original drum window outside live PCM');
				let sum=0,peak=0;
				for(let i=begin;i<end;i++){
					const l=left[i],r=right[i];sum+=l*l+r*r;
					peak=Math.max(peak,Math.abs(l),Math.abs(r));
				}
				out[name]={rms:Math.sqrt(sum/(2*(end-begin))),peak,
					samplesPerChannel:end-begin};
			}
			return out;
		};
		const plan=a.getFatalCountInStatus();
		return {
			songId:d.pack.id,sourceId:d.track.id,clockStart:d.clockStart,
			sampleRate,originalMediaRoles:d.pack.sourceNames.length,
			tapAt:installed.state.installedAt,firstFrame,
			chunks:chunks.length,frames,gaps:0,duration:frames/sampleRate,
			captureContinuityVersion:installed.state.quantumValidationVersion,
			captureArmFrame:installed.state.armFrame,
			startupWarmupGapsExcludedBeforeArm:installed.state.warmupGaps,
			captureQuantumIntegrity:{checkedEveryQuantum:true,
				chronologyErrors:installed.state.chronologyErrors.length,
				nextQuantumVerified:true},
			discardedStartupChunks:tailIndex,discardedStartupGapDetails:gapDetails,
			clockOfFirstFrame:origin,clockOfLastFrame:priorEnd/sampleRate,
			countInMasterWindows:clockWindows(
				Object.fromEntries(plan.beatOnsets.map((t,i)=>['drum'+(i+1),t]))),
			finalMasterMetrics:result,
			eventLog:window.__bbFinalAuditEvents,
			originalDrumSourceScheduled:true,
			isolatedOriginalDrumAudibilityVerified:false,
		};
	},crash);
	// Persist valid observed PCM metrics before validating any audio limit.
	// A measured clip MUST survive the final failure report and must not be
	// reclassified as a retryable instrument fault.
	report.liveFinalMaster=measured;
	assert.equal(measured.gaps,0);
	assert.ok(measured.duration>3);
	assert.equal(measured.sourceId,pre.trackId);
	assert.equal(measured.clockStart,pre.clockStart);
	assert.ok(measured.chunks>=50);
	// Preserve COMPLETE measured audio-limit failures in report JSON;
	// do not mislabel them as missing measurement or retry them away.
	const metered=measured.finalMasterMetrics;
	const audioLimitFailed=metered.sampleClips>0||
		metered.estimatedTrueClips4x>0||metered.nonfiniteSamples>0||
		metered.samplePeak>=1||metered.estimatedTruePeak4x>=1;
	for(const i of [1,2,3,4]){
		const hit=measured.countInMasterWindows['drum'+i];
		assert.ok(hit.samplesPerChannel>1000&&hit.rms>.0002);
	}
	const unexpected=httpErrors.filter(({status,url})=>
		!(status===404&&/\/music\/packs\/[^/]+\/adaptive\/debutmont\//.test(url)));
	assert.deepEqual(errors,[]);
	assert.deepEqual(unexpected,[]);
	report.testOriginalVocalsUnlockedInDisposableBrowser=testUnlockVocals;
	report.pre=pre;
	report.realPhysicsCollision=crash;
	report.actualOriginalDrum=originalDrum;
	report.liveFinalMaster=measured;
	report.errors=errors;
	report.unexpectedHttp=unexpected;
	report.mediaRequests=mediaRequests.length;
	report.status=audioLimitFailed?'VALID_CAPTURE_AUDIO_LIMIT_FAILURE':
		'PASS_ACTUAL_PHYSICS_BSOD_FULL_OUTPUT_4X_ESTIMATE_NOT_MASTERED';
	if(audioLimitFailed)process.exitCode=2;
	console.log(audioLimitFailed?'REAL_PHYSICS_BSOD_VALID_AUDIO_LIMIT_FAILURE':
		'REAL_PHYSICS_BSOD_LIVE_FINAL_OUTPUT_PASS',JSON.stringify({
		songId:measured.songId,duration:measured.duration.toFixed(3),
		scheduledOriginalDrumSourceHits:4,
		samplePeak:measured.finalMasterMetrics.samplePeak,
		estimatedTruePeak4x:measured.finalMasterMetrics.estimatedTruePeak4x,
		estimatedDbTp:measured.finalMasterMetrics.estimatedTruePeakDbTp4x,
		sampleClips:metered.sampleClips,truePeakEstimatedOvers:metered.estimatedTrueClips4x,
		peakGuard:'production',readOnlyTap:'AudioWorklet',httpErrors:0
	}));
}catch(error){
	const meter=report.liveFinalMaster?.finalMasterMetrics;
	const hadAudioLimit=!!meter && (
		meter.sampleClips>0||meter.estimatedTrueClips4x>0||
		meter.nonfiniteSamples>0||meter.samplePeak>=1||
		meter.estimatedTruePeak4x>=1
	);
	report.status=hadAudioLimit?'VALID_CAPTURE_AUDIO_LIMIT_FAILURE':
		String(error).includes('INSTRUMENT_CAPTURE:')?
			'INVALID_INSTRUMENT_CAPTURE':'INVALID_QA_OR_SOURCE';
	report.error=String(error);
	report.errors=errors;
	report.unexpectedHttp=httpErrors;
	console.error('REAL_PHYSICS_BSOD_LIVE_FINAL_OUTPUT_FAILURE',String(error));
	process.exitCode=1;
}finally{
	report.completedAt=new Date().toISOString();
	writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
	await browser.close();
}
