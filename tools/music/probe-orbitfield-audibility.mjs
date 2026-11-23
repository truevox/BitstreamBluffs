#!/usr/bin/env node
/** True original OGG sample re-rendering in Chromium OfflineAudioContext.
 * Objective signal difference and sample peak only; not perceptual approval. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const raw=process.env.ORBITFIELD_URL||'http://127.0.0.1:19003/tools/music/orbitfield-audition.html';
const url=new URL(raw);url.searchParams.set('qa','1');
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:[
	'--no-sandbox','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage();
	await page.goto(url.href,{waitUntil:'networkidle2',timeout:24000});
	await page.click('#load');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Five original recordings ready'),
		{timeout:18000});
	const result=await page.evaluate(async()=>{
		const api=window.__orbitfieldQA,buffers=api?.getBuffers();
		if(!api||!buffers)throw Error('Space Mountain orbital audio diagnostic did not load five original buffers');
		const roles=['drums','bass','guitar','piano','other'];
		const gainFor=role=>role==='drums'?.9:role==='bass'?.75:.65;
		const rate=48000,seconds=3.5;
		async function render({dry=false,weightless=0,lowGravity=0,event=null,eventKind="reentry",silence=false}={}){
			const offline=new OfflineAudioContext(2,Math.ceil(rate*seconds),rate);
			for(const role of roles){
				if(silence&&role!==(eventKind==='eject'?'other':'drums'))continue;
				const fx=api.orchestraPreset('space-mountain',role);
				const chain=dry?null:api.buildMusicChain(offline,
					fx.map(x=>({...x,weightless,lowGravity})),offline.destination);
				if(!silence){
					const source=offline.createBufferSource();source.buffer=buffers[role];
					const gain=offline.createGain();gain.gain.value=gainFor(role);
					source.connect(gain);gain.connect(dry?offline.destination:chain.input);
					source.start(0);
				}
				if(event&&role===(eventKind==='eject'?'other':'drums'))chain.find('orbitfield').set(eventKind,event,1.35);
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
		const flight=await render({weightless:.85,lowGravity:.3});
		const fastAir=await render({weightless:1,lowGravity:.5});
		const eruption=await render({event:.85});
		const rockyLanding=await render({event:.85,eventKind:"eject"});
		const pureImpact=await render({event:1,silence:true});
		const rockOnly=await render({event:1,eventKind:"eject",silence:true});
		return {dry:stats(dry),ground:difference(dry,ground),
			flight:difference(dry,flight),
			fastAir:difference(dry,fastAir),
			groundVsFlight:difference(ground,flight),
			landingReentry:difference(ground,eruption),
			takeoffAirlock:difference(ground,rockyLanding),
			sourceIndependentEject:stats(rockOnly),
			sourceIndependentReentry:stats(pureImpact)};
	});
	console.log('SPACE_TESTED_LEVELS',JSON.stringify(result));
	for(const [label,data] of Object.entries(result)){
		for(const value of Object.values(data))assert(Number.isFinite(value),label+' contains nonfinite samples');
	}
	assert(result.flight.percent>result.ground.percent,
		'Original stereo field did not expand with actual altitude');
	assert(result.groundVsFlight.percent>4,'Zero-gravity spatial-field source diff too subtle for audition');
	assert(result.sourceIndependentReentry.rms>.004&&result.sourceIndependentEject.rms>.001,
		'A real space reentry is silent between recorded drum attacks');
	assert(result.landingReentry.diffRMS>.005,'Space re-entry physical shock is too subtle in recorded mix');
	assert(result.flight.peak<1&&result.fastAir.peak<1&&result.landingReentry.peak<1&&result.takeoffAirlock.peak<1,
		'Original excerpt sample peak exceeded unity in offline Chromium test');
	console.log('ORBITFIELD_ORIGINAL_OGG_AUDIO_PROBE_PASS',JSON.stringify(result));
}finally{await browser.close();}
