import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

/** Genuine release-engine sidecars, no separate standalone audio lab. */
const url=process.env.GAME_URL||'http://100.115.120.66:8199/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
	'--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800},acceptDownloads:true});
const pageErrors=[],httpFailures=[];
page.on('pageerror',error=>pageErrors.push(String(error)));
page.on('response',response=>{
	if(response.status()>=400)httpFailures.push([response.status(),response.url()]);
});
try{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:35000});
	await page.keyboard.press('x');
	await page.evaluate(()=>{
		const title=window.__bbGame.scene.getScene('TitleScene');
		title.menu.items.find(i=>i.label==='SETTINGS').onSelect();
		title.view.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
		title.view.soundView.menu.items.find(i=>i.label==='MUSIC LAB').onSelect();
	});
	await page.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v?.score?.songId==='FEsxYVStla4'&&v.lab.pack&&v.lab.activeNodes.size>=7;
	},null,{timeout:45000});
	const stateBefore=await page.evaluate(()=>{
		const g=window.__bbGame, v=g.scene.getScene('TitleScene').view.soundView.labView;
		return {
			score:v.score.scoreHash,
			song:v.score.songId,
			originalFrameCount:v.lab.pack.frameCount,
			musicPackUsesHash:v.lab.pack.performance.scoreHash===v.score.scoreHash,
			track:v.lab.track.title,
			last:v.markerStatus,
			gameSave:Object.fromEntries(Object.entries(localStorage)),
			stemMusicLive:g.registry.get('audioSynth')._stemMusic.started,
			markers:v.markers.length,
		};
	});
	assert.equal(stateBefore.musicPackUsesHash,true);
	assert.equal(stateBefore.markers,0);
	assert.equal(stateBefore.stemMusicLive,false);
	console.log('POPE_SCORE_FROM_PRODUCTION_ENGINE_HASH_PIN_MATCH_PASS',
		{song:stateBefore.song,hash:stateBefore.score.slice(0,16)});

	const markers=[];
	for(let idx=0;idx<4;idx++){
		if(idx>0){
			await page.evaluate(i=>
				window.__bbGame.scene.getScene('TitleScene').view.soundView.labView._song(i),idx);
			await page.waitForFunction(index=>{
				const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
				return v.songIndex===index&&v.score?.songId===v.lab.catalog[index].id&&
					v.lab.pack?.id===v.lab.catalog[index].id;
			},idx,{timeout:45000});
		}
		const seek=await page.evaluate(index=>{
			const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
			v._solo('DRUMS');
			return v.lab.seekTo(60+index*10);
		},idx);
		assert.equal(seek,true);
		await page.waitForFunction(()=>{
			const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
			return v.lab?.activeNodes.size>=7;
		},null,{timeout:30000});
		const evidence=await page.evaluate(()=>{
			const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
			v._tick();
			v._markIssue();
			const recent=v.markers.at(-1);
			const hits=v.score.events.drums.length;
			return {
				seek:true,
				hash:v.score.scoreHash,
				scoreId:v.score.songId,
				track:v.lab.track.id,
				clockFrame:recent.frame,
				status:v.scoreText.main.text,
				nearbyIds:recent.nearbySourceEventIds,
				drumHypotheses:hits,
				sourceAudioCount:v.lab.activeNodes.size,
				unchanged:window.__bbGame.registry.get('settings').dynamicOrchestra===false,
			};
		});
		assert.equal(evidence.seek,true);
		assert.equal(evidence.unchanged,true);
		assert.equal(evidence.scoreId,evidence.track);
		assert.ok(evidence.hash.length===64);
		assert.ok(evidence.clockFrame>2500000);
		assert.ok(evidence.status.includes('SCORE'));
		assert.ok(evidence.drumHypotheses>100);
		assert.ok(evidence.sourceAudioCount>=7);
		markers.push(evidence);
		console.log('REAL_GAME_LAB_SCORE_AND_SUSPECT_MARK_PASS',idx,
			evidence.scoreId,'timeframe',evidence.clockFrame,
			'near',evidence.nearbyIds.length);
	}
	assert.equal(new Set(markers.map(e=>e.hash)).size,4);
	const downloadPromise=page.waitForEvent('download',{timeout:15000});
	await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		v.exportButton.zone.emit('pointerdown');
	});
	const download=await downloadPromise;
	const data=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
	assert.equal(data.format,'bitstream-music-issue-markers-v1');
	assert.equal(data.count,4);
	assert.equal(data.markers.length,4);
	assert.equal(new Set(data.markers.map(m=>m.scoreHash)).size,4);
	assert.ok(data.markers.every(m=>m.kind==='subjective-suspected-issue-not-gold-truth'));
	assert.ok(data.markers.every(m=>m.roles.join(',')==='drums'));
	console.log('BROWSER_DOWNLOAD_EXACTLY_FOUR_SOURCE_PINNED_NOT_GOLD_MARKS_PASS',{
		count:data.count,selected:data.markers.map(m=>m.songId),
		name:download.suggestedFilename()});

	await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		v.clearButton.zone.emit('pointerdown');
	});
	const cleaned=await page.evaluate(()=>{
		const g=window.__bbGame;
		const v=g.scene.getScene('TitleScene').view.soundView.labView;
		return {markers:v.markers.length,
			exportDisabled:v.exportButton.disabled,clearDisabled:v.clearButton.disabled};
	});
	assert.deepEqual(cleaned,{markers:0,exportDisabled:true,clearDisabled:true});
	await page.evaluate(()=>{
		const title=window.__bbGame.scene.getScene('TitleScene');
		title.view.soundView.labView.close();
		title.view.soundView.close();
	});
	const final=await page.evaluate(()=>{
		const g=window.__bbGame;
		return {gameSave:Object.fromEntries(Object.entries(localStorage)),
			liveMusic:g.registry.get('audioSynth')._stemMusic.started,
			settings:g.registry.get('settings').dynamicOrchestra,
			labGone:!g.scene.getScene('TitleScene').view.soundView};
	});
	assert.deepEqual(final.gameSave,stateBefore.gameSave);
	assert.equal(final.settings,false);
	assert.equal(final.liveMusic,false);
	assert.equal(final.labGone,true);
	assert.deepEqual(pageErrors,[]);
	assert.deepEqual(httpFailures,[]);
	console.log('GAME_STATE_AND_PROFILE_PRESERVED_AFTER_SCORED_LAB_PASS');
	console.log('ALL_FOUR_SCORED_SONGS_ACTUAL_GAME_BROWSER_PASS');
}finally{await browser.close();}
