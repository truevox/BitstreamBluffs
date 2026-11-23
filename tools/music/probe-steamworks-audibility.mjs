#!/usr/bin/env node
/** Original recorded OGG stems through real Chromium OfflineAudioContext.
 * Measures objective source difference, not a substitute for owner listening. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const target=process.env.STEAMWORKS_URL||'http://127.0.0.1:5173/tools/music/steamworks-audition.html';
const url=new URL(target);url.searchParams.set('qa','1');
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader',
		'--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage();
	await page.goto(url.href,{waitUntil:'networkidle2',timeout:24000});
	await page.click('#load');
	await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Ready:'),
		{timeout:16000});
	const data=await page.evaluate(async()=>{
		const api=window.__steamworksQA;
		const buffers=api.getBuffers();
		if(!api||!buffers)throw Error('No browser AudioBuffers loaded');
		const roles=['drums','bass','guitar','piano','other'];
		const gainFor=role=>role==='drums'?.9:role==='bass'?.75:.65;
		const rate=48000,seconds=3;
		async function render({dry=false,speed=0,airborne=false,onlyDrums=false}={}){
			const off=new OfflineAudioContext(2,rate*seconds,rate);
			for(const role of roles){
				if(onlyDrums&&role!=='drums')continue;
				const source=off.createBufferSource();source.buffer=buffers[role];
				const trim=off.createGain();trim.gain.value=gainFor(role);
				source.connect(trim);
				if(dry)trim.connect(off.destination);
				else{
					const chain=api.buildMusicChain(off,api.orchestraPreset('steampunk-slopes',role),off.destination);
					trim.connect(chain.input);
					const effect=chain.find('steamworks');
					effect.set('speed',speed,0);
					effect.set('airborne',airborne,0);
				}
				source.start(0);
			}
			const output=await off.startRendering();
			return [output.getChannelData(0),output.getChannelData(1)].map(ch=>Array.from(ch));
		}
		const rms=x=>Math.sqrt(x.reduce((a,v)=>a+v*v,0)/x.length);
		function compare(a,b){
			const dryRMS=rms(a[0]);
			const diff=new Float32Array(a[0].length);
			for(let i=0;i<diff.length;i++)diff[i]=b[0][i]-a[0][i];
			return {dryRMS:Number(dryRMS.toFixed(6)),diffRMS:Number(rms(diff).toFixed(6)),
				relativePercent:Number((100*rms(diff)/Math.max(dryRMS,1e-10)).toFixed(2)),
				processedPeak:Number(b[0].reduce((peak,v)=>Math.max(peak,Math.abs(v)),0).toFixed(6))};
		}
		const dry=await render({dry:true,onlyDrums:true});
		const slow=await render({speed:.18,onlyDrums:true});
		const fast=await render({speed:.94,onlyDrums:true});
		const air=await render({speed:.94,airborne:true,onlyDrums:true});
		const dryFull=await render({dry:true});
		const fastFull=await render({speed:.94});
		return {drumSlow:compare(dry,slow),drumFast:compare(dry,fast),
			drumAir:compare(dry,air),fullFast:compare(dryFull,fastFull),
			maxSample:{fullDry:dryFull[0].slice(0,30000).reduce((peak,v)=>Math.max(peak,Math.abs(v)),0),
				fullFast:fastFull[0].slice(0,30000).reduce((peak,v)=>Math.max(peak,Math.abs(v)),0)}};
	});
	assert(data.drumFast.relativePercent>data.drumSlow.relativePercent,
		'Gears do not become more audible as recorded sled speed grows');
	assert(data.drumFast.relativePercent>5,'High-speed gear DSP barely changes original drums');
	assert(data.drumAir.relativePercent<data.drumFast.relativePercent,
		'Airborne drive belt did not disengage');
	assert(data.fullFast.relativePercent>4,'Full five-stem original mix change is likely inaudible');
	console.log('STEAMWORKS_OFFLINE_ORIGINAL_STEM_AUDIO_PROBE_PASS',JSON.stringify(data));
}finally{await browser.close();}
