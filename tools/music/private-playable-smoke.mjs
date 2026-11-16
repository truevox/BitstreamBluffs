#!/usr/bin/env node
/**
 * Browser QA for the actual PRIVATE game, NOT a standalone audio audition.
 * 2 real in-game music packs, all 12 biome voices, audio-context playback,
 * live voice switching, mid-play song swap and normal game run.
 */
import { chromium } from 'playwright';

const origin=process.env.BB_PROOF_URL || 'http://100.115.120.66:8184';
const browser=await chromium.launch({
	headless:true,executablePath:'/usr/bin/chromium',
	args:[
		'--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required',
		'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
		'--ignore-gpu-blocklist',
	],
});
const errors=[];
const page=await browser.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',e=>errors.push('JS: '+e.message));
page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url());});
const audio=()=>page.evaluate(()=>{
	const game=window.__bbGame;
	const a=game?.registry?.get('audioSynth');
	const p=a?._musicProvider;
	const seg=p?.pack?.segments?.[0];
	return {
		sceneTitle:game?.scene?.isActive('TitleScene')||false,
		sceneRun:game?.scene?.isActive('RunScene')||false,
		catalogReady:!!p?.ready,
		tracks:p?.catalog?.map(t=>t.id)||[],
		track:p?.track?.id||null,
		pack:p?.pack?.id||null,
		packFrames:p?.pack?.frameCount||null,
		sources:p?.pack?.sourceNames||[],
		ctx:p?.ctx?.state||null,
		started:!!p?.started,
		activeNodes:p?.activeNodes?.size||0,
		currentVoice:p?.biome||null,
		wanted:p?.pack?p._wantedNames(p.pack):[],
		scheduled:[...(p?.scheduled||[])].filter(x=>x.includes('voice:')).slice(0,12),
		error:p?.lastError||null,
	};
});
try{
	await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:25000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),{timeout:55000});
	await page.waitForFunction(()=>window.__bbGame?.registry?.get('audioSynth')?._musicProvider?.ready,{timeout:30000});
	console.log('READY',JSON.stringify(await audio()));
	const cat=await page.request.get(origin+'/music/catalog.json');
	const tracks=(await cat.json()).tracks;
	if(tracks.length!==2)throw Error('expected 2 private music tracks, got '+tracks.length);
	const audioUrls=[];
	for(const track of tracks){
		const res=await page.request.get(origin+'/music/'+track.manifest);
		if(!res.ok())throw Error('manifest unavailable '+track.id);
		const manifest=await res.json();
		if(manifest.segments.some(seg=>Object.keys(seg.sources).length!==18))throw Error('Not all voices present for '+track.id);
		audioUrls.push({id:track.id,segments:manifest.segments.length,frameCount:manifest.frameCount,sources:Object.keys(manifest.segments[0].sources).length});
		for(const [i,seg] of manifest.segments.entries()){
			if(i!==0 && i!==Math.floor(manifest.segments.length/2) && i!==manifest.segments.length-1)continue;
			for(const name of ['vocals','drums','voice:vertigo-vents','voice:crystal-cavern']){
				const path=origin+'/music/'+track.manifest.split('/').slice(0,-1).join('/')+'/'+seg.sources[name];
				const response=await page.request.head(path,{timeout:15000});
				if(!response.ok())throw Error('Missing '+name+' '+path+' HTTP '+response.status());
			}
		}
	}
	console.log('PACK_VALIDATION',JSON.stringify(audioUrls));
	await page.locator('#bb-proof-play').click();
	await page.waitForFunction(()=>{
		const p=window.__bbGame?.registry?.get('audioSynth')?._musicProvider;
		return p?.pack?.id==='FEsxYVStla4' && p.pack.sourceNames.length===18 &&
			p.ctx?.state==='running' && p.activeNodes.size>0;
	},{timeout:40000});
	console.log('POPE_PLAYING',JSON.stringify(await audio()));
	await page.locator('#bb-proof-mountain').selectOption('crystal-cavern');
	await page.waitForFunction(()=>{
		const p=window.__bbGame?.registry?.get('audioSynth')?._musicProvider;
		return p?.biome==='crystal-cavern' && p._wantedNames(p.pack).includes('voice:crystal-cavern');
	},{timeout:12000});
	await page.waitForTimeout(1600);
	console.log('MOUNTAIN_CHANGED',JSON.stringify(await audio()));
	await page.locator('#bb-proof-track').selectOption('one-more-run-bitstream-bluffs');
	await page.waitForFunction(()=>{
		const p=window.__bbGame?.registry?.get('audioSynth')?._musicProvider;
		return p?.track?.id==='one-more-run-bitstream-bluffs' &&
			p.pack?.frameCount===8380800 && p.activeNodes.size>0;
	},{timeout:40000});
	console.log('ONE_MORE_RUN_PLAYING',JSON.stringify(await audio()));
	await page.locator('#bb-proof-mountain').selectOption('vertigo-vents');
	await page.waitForFunction(()=>{
		const p=window.__bbGame?.registry?.get('audioSynth')?._musicProvider;
		return p?.biome==='vertigo-vents';
	},{timeout:12000});
	await page.screenshot({path:'/tmp/bitstream-game-music-private-playing.png'});
	console.log('SWITCHED_BACK_TO_ORGAN',JSON.stringify(await audio()));
	await page.evaluate(()=>document.activeElement.blur());
	await page.keyboard.press('Enter');
	await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('RunScene'),{timeout:15000});
	await page.waitForTimeout(1500);
	console.log('RUNSCENE_PLAYING',JSON.stringify(await audio()));
	const final=await audio();
	if(final.error||final.sources.length!==18||final.track!=='one-more-run-bitstream-bluffs'||
		!final.sceneRun||!final.started||final.ctx!=='running'||final.activeNodes<1)
		throw Error('Actual game music integration unhealthy: '+JSON.stringify(final));
	if(errors.length)throw Error('Browser console or HTTP errors: '+JSON.stringify(errors));
	console.log('PASS_REAL_PLAYABLE_TWO_SONG_12_VOICE',JSON.stringify({
		browserErrors:errors.length,packSummaries:audioUrls,
		finalTrack:final.track,voices:12,runScene:final.sceneRun,
		activeNodes:final.activeNodes
	}));
}finally{
	await browser.close();
}
