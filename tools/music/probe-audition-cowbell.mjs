#!/usr/bin/env node
/** Real browser cowbell output: sound only for verified candidate + slider enabled.
 * Also triggers a source-measured bass note through the actual Scrap audition.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.AUDITION_URL||'http://100.115.120.66:8212';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage();
	const errors=[];page.on('pageerror',e=>errors.push(e.message));
	await page.goto(base+'/tools/music/scrap-clangs-audition.html?qa=1');
	await page.click('#load');
	await page.waitForFunction(()=>!document.querySelector('#play').disabled,null,{timeout:18000});
	const result=await page.evaluate(async()=>{
		const qa=window.__scrapClangQA,slider=document.getElementById('cowbell');
		if(!qa)throw Error('Audition-only test hook absent');
		async function render(amount,invalid=false){
			const ctx=new OfflineAudioContext(2,Math.ceil(48000*1.5),48000);
			const bus=ctx.createGain();bus.connect(ctx.destination);
			const original=slider.value;slider.value=String(amount);
			const bell=qa.attachAuditionCowbell(ctx,bus,slider);
			const candidate=invalid?{midi:69,hz:440,confidence:-1,strength:1}:{midi:60,hz:261.625565,confidence:.92,strength:1};
			const triggered=bell.play(candidate);
			const sound=await ctx.startRendering();bell.dispose();slider.value=original;
			let sum=0,peak=0;
			for(let ch=0;ch<2;ch++)for(const value of sound.getChannelData(ch)){
				sum+=value*value;peak=Math.max(peak,Math.abs(value));
			}
			return {triggered,rms:Math.sqrt(sum/(sound.length*2)),peak};
		}
		return {off:await render(0),on:await render(175),invalid:await render(175,true)};
	});
	console.log('COWBELL_LEVELS',JSON.stringify(result));
	assert.equal(result.off.triggered,false);
	assert.equal(result.off.rms,0);
	assert.equal(result.invalid.triggered,false);
	assert.equal(result.invalid.rms,0);
	assert.equal(result.on.triggered,true);
	assert.ok(result.on.rms>.01&&result.on.peak<.95,'Cowbell audibility and headroom gate');
	await page.click('#play');
	// Live source bass analysis, not a hardcoded note. Repeated scans span live source audio.
	let actual=false,pitch='';
	for(let i=0;i<10;i++){
		await page.locator('#scan-pitch').click();
		pitch=await page.locator('#pitch-status').innerText();
		if(pitch.includes('spectral candidates:')){
			await page.locator('#pitch-hit').click();
			const status=await page.locator('#status').innerText();
			if(status.includes('KLANG!')){actual=true;assert.ok(status.includes('Extra cowbell'),'Manual clang failed to play added cowbell');console.log('LIVE_ORIGINAL_BASS_COWBELL_TRIGGER_PASS',status);break;}
		}
		await page.waitForTimeout(250);
	}
	assert.ok(actual,'No source-pitch measured clang successfully triggered');
	assert.deepEqual(errors,[]);
	console.log('SOURCE_GATED_COWBELL_PASS',JSON.stringify({pitch,status:'live bass pitch found and valid manual note played',errors}));
}finally{await browser.close()}
