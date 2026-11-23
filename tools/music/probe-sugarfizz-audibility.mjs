#!/usr/bin/env node
/** True original OGG sample re-rendering in Chromium OfflineAudioContext.
 * Objective signal difference and sample peak only; not perceptual approval. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const raw=process.env.SUGARFIZZ_URL||'http://127.0.0.1:18999/tools/music/sugarfizz-audition.html';
const url=new URL(raw);url.searchParams.set('qa','1');
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:[
	'--no-sandbox','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage();
	await page.goto(url.href,{waitUntil:'networkidle2',timeout:24000});
	await page.click('#load');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Five original stereo'),
		{timeout:18000});
	const result=await page.evaluate(async()=>{
		const api=window.__sugarfizzQA,buffers=api?.getBuffers();
		if(!api||!buffers)throw Error('Candy Sugar Fizz audio diagnostic did not load five original buffers');
		const roles=['drums','bass','guitar','piano','other'];
		const gainFor=role=>role==='drums'?.9:role==='bass'?.75:.65;
		const rate=48000,seconds=3.5;
		async function render({dry=false,speed=0,airborne=false,event=null,eventKind="pop",silence=false}={}){
			const offline=new OfflineAudioContext(2,Math.ceil(rate*seconds),rate);
			for(const role of roles){
				if(silence&&role!=='drums')continue;
				const fx=api.orchestraPreset('candy-cane-canyon',role);
				const chain=dry?null:api.buildMusicChain(offline,
					fx.map(x=>({...x,speed,airborne})),offline.destination);
				if(!silence){
					const source=offline.createBufferSource();source.buffer=buffers[role];
					const gain=offline.createGain();gain.gain.value=gainFor(role);
					source.connect(gain);gain.connect(dry?offline.destination:chain.input);
					source.start(0);
				}
				if(event&&role==='drums')chain.find('sugarfizz').set(eventKind,event,1.35);
			}
			const rendered=await offline.startRendering();
			return [rendered.getChannelData(0),rendered.getChannelData(1)].map(ch=>Array.from(ch));
		}
		function stats(samples){
			let sum=0,peak=0;
			for(const channel of samples)for(const v of channel){sum+=v*v;peak=Math.max(peak,Math.abs(v));}
			return {rms:Math.sqrt(sum/(samples[0].length*samples.length)),peak};
		}
		function difference(a,b){
			const diff=a.map((channel,ch)=>channel.map((v,i)=>b[ch][i]-v));
			const data=stats(diff),reference=stats(a);
			return {dryRMS:reference.rms,diffRMS:data.rms,
				percent:100*data.rms/Math.max(reference.rms,1e-9),peak:stats(b).peak};
		}
		const dry=await render({dry:true});
		const ground=await render();
		const flight=await render({speed:.95});
		const fastAir=await render({speed:.95,airborne:true});
		const eruption=await render({event:.85});
		const rockyLanding=await render({event:.85,eventKind:"wrapper"});
		const pureImpact=await render({event:1,silence:true});
		const rockOnly=await render({event:1,eventKind:"wrapper",silence:true});
		return {dry:stats(dry),ground:difference(dry,ground),
			flight:difference(dry,flight),
			fastAir:difference(dry,fastAir),
			groundVsFlight:difference(ground,flight),
			landingPop:difference(ground,eruption),
			wrapperSnap:difference(ground,rockyLanding),
			sourceIndependentWrapper:stats(rockOnly),
			sourceIndependentPop:stats(pureImpact)};
	});
	console.log('CANDY_TESTED_LEVELS',JSON.stringify(result));
	for(const [label,data] of Object.entries(result)){
		for(const value of Object.values(data))assert(Number.isFinite(value),label+' contains nonfinite samples');
	}
	assert(result.flight.percent>result.ground.percent,
		'Actual sled speed did not increase source-fed fizz');
	assert(result.groundVsFlight.percent>4,'High-speed sugar fizz too subtle for audition');
	assert(result.sourceIndependentPop.rms>.004&&result.sourceIndependentWrapper.rms>.001,
		'A real candy landing is silent between recorded drum attacks');
	assert(result.landingPop.diffRMS>.005,'Candy Pop Rocks landing is too subtle in recorded mix');
	assert(result.flight.peak<1&&result.fastAir.peak<1&&result.landingPop.peak<1&&result.wrapperSnap.peak<1,
		'Original excerpt sample peak exceeded unity in offline Chromium test');
	console.log('SUGARFIZZ_ORIGINAL_OGG_AUDIO_PROBE_PASS',JSON.stringify(result));
}finally{await browser.close();}
