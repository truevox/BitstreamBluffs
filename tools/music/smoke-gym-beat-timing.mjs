/** Actual Chromium / real OGG clock Gym API smoke. The test-only injected
 * synthetic grid validates API clock wiring, NOT musical correctness and
 * NEVER ships in the release catalog. Actual catalog always fails closed.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://127.0.0.1:8228/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
	'--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const failures=[];
page.on('pageerror',error=>failures.push(String(error)));
try{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),
		null,{timeout:30000});
	await page.keyboard.press('x');
	await page.waitForFunction(()=>{
		const a=window.__bbGame.registry.get('audioSynth');
		return a?._stemMusic?.ready&&a._stemMusic.catalog.length===4;
	},null,{timeout:25000});
	await page.waitForFunction(()=>{
		const j=window.__bbGame.scene.getScene('TitleScene').jukebox;
		return j?.buttons?.[1]&&!j.buttons[1].disabled;
	},null,{timeout:15000});
	await page.evaluate(()=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a?._stemMusic;
		// Some integrations already start music after the real keyboard gesture.
		// Clicking PLAY again would toggle it OFF and hang this smoke test.
		if(d?.started&&d.activeNodes?.size>=6)return;
		const j=g.scene.getScene('TitleScene').jukebox;
		if(!j?.buttons?.[1]?.zone)throw Error('Missing title jukebox Play');
		j.buttons[1].zone.emit('pointerdown');
	});
	await page.waitForFunction(()=>{
		const a=window.__bbGame.registry.get('audioSynth'),d=a?._stemMusic;
		return d?.started&&d.pack&&d.ctx?.state==='running'&&d.activeNodes.size>=6;
	},null,{timeout:45000});
	// The older main baseline can open the jukebox at catalog index zero;
	// explicitly navigate to One More Run for a source-bound clock test.
	await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth');
		if(a._stemMusic.track?.id!=='local-one-more-run-bitstream-bluffs')
			if(!a.jukeboxStep(1))throw Error('Could not select One More Run');
	});
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.track?.id==='local-one-more-run-bitstream-bluffs'&&
			d.pack?.id===d.track.id&&d.activeNodes.size>=6&&!d._loading;
	},null,{timeout:40000});
	const original=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
		return {trackId:d.track.id,sampleRate:d.pack.sampleRate,
			duration:d.pack.duration,original:a.getBeatTiming(),
			clock:d.clockStart,sourceFrameCount:d.pack.frameCount};
	});
	assert.equal(original.trackId,'local-one-more-run-bitstream-bluffs');
	assert.equal(original.original.trusted,false);
	assert.equal(original.original.release,'immediate');
	console.log('REAL_RELEASE_CATALOG_UNVERIFIED_FALLBACK_PASS',original.original);
	const cases=await page.evaluate(async()=>{
		const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic,
			rate=d.pack.sampleRate,len=d.pack.frameCount,duration=d.pack.duration;
		const data={format:'bitstream-beat-grid-v1',trackId:d.track.id,
			sourceSampleRate:rate,sourceFrameCount:len,sourceSha256:'a'.repeat(64),
			version:'TEST_ONLY_FAKE_GRID_DO_NOT_SHIP',status:'verified',confidence:.99,
			review:{humanSpotCheck:'passed',independentCheck:'passed'},
			sections:[{startFrame:0,endFrame:len,status:'verified',confidence:.98,
				pulseFrames:Array.from({length:Math.floor((duration-.2)/.5)},(_,i)=>
					Math.round((.14+.5*i)*rate))}]};
		a._beatGrids={[d.track.id]:data};
		const go=async(seconds)=>{
			if(!d.seekTo(seconds))throw Error('Real playback seek failed: '+seconds);
			// A far-away seek must fetch and decode an actual OGG segment.
			// Do not mistake async fetching for a faulty beat clock.
			const deadline=performance.now()+25000;
			let last;
			do {
				last=a.getBeatTiming();
				if(last.trusted)return last;
				await new Promise(resolve=>setTimeout(resolve,85));
			}while(performance.now()<deadline);
			throw Error('Seek playback never became beat-eligible: '+seconds+' '+JSON.stringify({
				last,loading:!!d._loading,active:d.activeNodes.size,started:d.started,
				ctxState:d.ctx.state,error:d.lastError}));
		};
		const first=await go(.04),middle=await go(80.04),
			last=await go(duration-2.46);
		const identity=a.getBeatTiming();
		const revision=identity.transportRevision;
		const offbeat=(d.seekTo(81.19),a.getBeatTiming({maxWaitMs:0}));
		const muted=(a.settings.musicVolume=0,a.getBeatTiming());
		a.settings.musicVolume=.6;
		const suspended=(await a.ctx.suspend(),a.getBeatTiming());
		await a.ctx.resume();
		const afterResume=a.getBeatTiming();
		const stale=(await go(20.01),a.getBeatTiming({expectedRevision:revision}));
		const now=a.getBeatTiming();
		const old=d.transportPaused;d.transportPaused=true;
		const paused=a.getBeatTiming();d.transportPaused=old;
		const missing=(d._token++,a.isBeatTimingCurrent(now));
		delete a._beatGrids;
		const afterDelete=a.getBeatTiming();
		return {first,middle,last,offbeat,muted,suspended,afterResume,stale,
			paused,missing,afterDelete,realTrack:d.track.id,duration};
	});
	console.log('GYM_BEAT_BROWSER_CASES',JSON.stringify(cases));
	for(const key of ['first','middle','last']){
		const result=cases[key];
		assert.equal(result.trusted,true,key+' not trusted under QA synthetic grid');
		assert.ok(result.waitMs>=0&&result.waitMs<=300,key+' wait too long');
		assert.ok(result.dueAudioTime>=result.audioContextTime-0.002);
		assert.equal(result.gridVersion,'TEST_ONLY_FAKE_GRID_DO_NOT_SHIP');
	}
	for(const key of ['offbeat','muted','suspended','stale','paused','afterDelete'])
		assert.equal(cases[key].trusted,false,key+' should fail closed');
	assert.equal(cases.missing,false);
	// A real mid-READY jukebox skip must invalidate the OLD song immediately.
	const swapped=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
		const sourceId=d.track.id;
		const {sampleRate,frameCount}=d.pack;
		d.seekTo(30);
		const before=a.getBeatTiming(); // shipping catalog is still unverified
		const revision=d._token+':'+sourceId+':'+d.clockStart;
		if(!a.jukeboxStep(1))throw Error('Real mid-READY track swap failed');
		const after=a.getBeatTiming({expectedRevision:revision});
		return {sourceId,revision,after,sourceFrames:frameCount,sampleRate};
	});
	assert.equal(swapped.after.trusted,false);
	await page.waitForFunction(beforeId=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.track?.id!==beforeId&&d.pack?.id===d.track?.id;
	},swapped.sourceId,{timeout:40000});
	const newTrack=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth');
		return {id:a._stemMusic.track.id,now:a.getBeatTiming()};
	});
	assert.equal(newTrack.now.trusted,false);
	console.log('REAL_TRACK_SWAP_MID_READY_IMMEDIATE_RELEASE_PASS',JSON.stringify({
			old:swapped.sourceId,new:newTrack.id,after:swapped.after}));
	console.log('REAL_OGG_WEB_AUDIO_CLOCK_BEGIN_MIDDLE_END_PASS',
		JSON.stringify({first:cases.first,middle:cases.middle,last:cases.last}));
	console.log('REAL_TRANSPORT_SEEK_PAUSE_SUSPEND_MUTE_REVISION_PASS',
		JSON.stringify({muted:cases.muted,suspended:cases.suspended,
			stale:cases.stale,paused:cases.paused,missing:cases.missing,
			releaseCatalog:cases.afterDelete}));
	assert.deepEqual(failures,[]);
	console.log('GYM_BEAT_REAL_BROWSER_SMOKE_PASS');
}finally{await browser.close()}
