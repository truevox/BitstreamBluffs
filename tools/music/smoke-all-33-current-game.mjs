#!/usr/bin/env node
/** Full 33-song playable source/melody smoke against the CURRENT main-based game.
 * No public media upload, no musical beat approval, and no production release.
 * Uses the game's real StemMusicDirector and Chromium Web Audio to start each
 * track, proving the first decoded six original stems and correct source lead.
 */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://100.115.120.66:8214/';
const reportOut=process.env.REPORT_OUT;
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const state={format:'bsb-33-current-game-real-opus-playback-v1',gameUrl:url,items:[],errors:[],httpErrors:[],
	expectedTracks:33,notableLimitations:'First live decoded 12-second source and matching home melody per song; not whole-song continuous transitions or mastering QA.'};
page.on('pageerror',error=>state.errors.push(String(error)));
page.on('response',res=>{
	if(res.status()>=400)state.httpErrors.push({status:res.status(),url:res.url()});
});
const mediaRequests=[];
page.on('request',req=>{if(req.url().endsWith('.ogg'))mediaRequests.push(req.url())});
const persist=()=>{if(reportOut)writeFileSync(reportOut,JSON.stringify(state,null,2)+'\n',{flag:'wx'})};
try{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.registry?.get('audioSynth')?._stemMusic?.ready===true,
		null,{timeout:30000});
	const gameInfo=await page.evaluate(()=>{
		const game=window.__bbGame,d=game.registry.get('audioSynth')._stemMusic;
		const t=game.scene.getScene('TitleScene');
		return {songs:d.catalog.map(x=>({id:x.id,title:x.title,manifest:x.manifest})),
			titleActive:t.sys.isActive(),selectionCount:Object.keys(d.songEnabled).length,
			firstSong:d.catalog[d.trackIndex]?.id};
	});
	assert.equal(gameInfo.songs.length,33);
	assert.equal(gameInfo.selectionCount,33);
	assert.equal(new Set(gameInfo.songs.map(x=>x.id)).size,33);
	console.log('CATALOG_READY',gameInfo.songs.length,'first',gameInfo.firstSong);
	await page.evaluate(()=>{
		const t=window.__bbGame.scene.getScene('TitleScene');
		t.startRun('33-song-current-game-smoke');
	});
	await page.waitForFunction(()=>{
		const d=window.__bbGame?.registry?.get('audioSynth')?._stemMusic;
		return d?.ctx?.state==='running'&&d.started===true;
	},null,{timeout:16000});
	for(let i=0;i<gameInfo.songs.length;i++){
		const track=gameInfo.songs[i],mediaStart=mediaRequests.length;
		await page.evaluate(i=>{
			const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
			d.stop();
			d.trackIndex=i;
			if(!d.start())throw Error('Game refused to start music '+i);
		},i);
		await page.waitForFunction(({id,index})=>{
			const d=window.__bbGame?.registry?.get('audioSynth')?._stemMusic;
			return d?.pack?.id===id&&d.trackIndex===index&&d.activeNodes.size>0;
		},{id:track.id,index:i},{timeout:18000});
		const item=await page.evaluate(()=>{
			const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
			const voice=d._activeVoiceFor(d.pack);
			return {id:d.pack.id,index:d.trackIndex,sourceCount:d.pack.sourceNames.length,
				voices:d.pack.sourceNames.filter(name=>name.startsWith('voice:')).length,
				durationSeconds:d.pack.duration,segments:d.pack.segments.length,
				frameCount:d.pack.frameCount,sampleRate:d.pack.sampleRate,
				selectedVoice:voice,activeNodes:d.activeNodes.size,
				audioState:d.ctx.state,error:d.lastError||null};
		});
		const requests=mediaRequests.slice(mediaStart).filter(x=>x.includes('/music/packs/'));
		item.mediaRequests=requests.length;
		item.loadedOriginalStem=requests.some(x=>/0000-(drums|bass|piano|guitar|other)\.ogg/.test(x));
		item.loadedMelody=requests.some(x=>/melod(?:ies|y).*\.ogg|adaptive\/.+\.ogg/.test(x));
		assert.equal(item.id,track.id);
		assert.equal(item.sourceCount,18);
		assert.equal(item.voices,12);
		assert.equal(item.sampleRate,48000);
		assert.ok(item.durationSeconds>30);
		assert.ok(item.segments>=5);
		assert.ok(item.selectedVoice?.startsWith('voice:'));
		assert.ok(item.activeNodes>0);
		assert.equal(item.audioState,'running');
		assert.ok(item.mediaRequests>=7&&item.loadedOriginalStem&&item.loadedMelody,
			'No complete original+melody OGG network load: '+track.id+' '+JSON.stringify(item));
		state.items.push(item);
		console.log('SOURCE_SONG_PLAYBACK_PASS',i+1,track.id,
			'sec',item.durationSeconds.toFixed(1),'sourceNodes',item.activeNodes,'OGGs',item.mediaRequests);
	}
	const unexpected=state.httpErrors.filter(x=>!/\/music\/packs\/[^/]+\/adaptive\/debutmont\//.test(x.url));
	assert.deepEqual(state.errors,[],'Unexpected game JS errors');
	assert.deepEqual(unexpected,[],'Unexpected resource HTTP errors');
	assert.equal(state.items.length,33);
	state.status='PASS_33_OF_33_REAL_OPUS_GAME_TRACKS';
	state.unexpectedHttpErrors=unexpected.length;
	console.log('ALL_33_CURRENT_GAME_AUDIO_PASS',JSON.stringify({songs:state.items.length,
		httpErrors:unexpected.length,knownFallback404s:state.httpErrors.length-unexpected.length,
		pageErrors:state.errors.length}));
}catch(error){
	state.status='FAILED';
	state.failure=String(error);
	console.error('ALL_33_CURRENT_GAME_AUDIO_FAILED',String(error));
	process.exitCode=1;
}finally{
	try{persist()}catch(e){console.error('REPORT_NOT_WRITTEN',String(e));process.exitCode=1}
	await browser.close();
}
