#!/usr/bin/env node
/** Headless real-Chromium OfflineAudioContext original OGG report.
 * Checks original song source recordings only; not the real final mixer,
 * mastering compressor, room convolution or full-song true peak.
 */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import puppeteer from 'puppeteer';
const url=process.env.CROSS_PACK_URL||
	'http://127.0.0.1:19008/tools/music/cross-pack-original-stem-audit.html';
const packs=['01_FEsxYVStla4','03_WRBGQUqD54U',
	'31_FYImnz5-hXs','33_local-one-more-run-bitstream-bluffs'];
const browser=await puppeteer.launch({
	executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--enable-unsafe-swiftshader',
		'--autoplay-policy=no-user-gesture-required']
});
try{
	const page=await browser.newPage(),errors=[];
	page.setDefaultTimeout(90000);
	page.on('pageerror',e=>errors.push(e.message));
	page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
	await page.goto(url,{waitUntil:'networkidle2',timeout:25000});
	await page.waitForFunction(()=>!!window.__crossPackOriginalAudioQA,{timeout:18000});
	const report=await page.evaluate(async packs=>
		await window.__crossPackOriginalAudioQA.audit(packs),packs);
	assert.equal(report.length,4);
	const worst=[];
	for(const song of report){
		assert.equal(song.cases.length,12);
		assert(song.cases.every(m=>m.dry.finite&&m.dry.overUnitySampleCount===0),
			'Dry original pack contains broken/nonfinite sample or peak');
		worst.push(...song.cases.map(m=>({
			pack:song.pack,track:song.trackId,biome:m.biome,
			samplePeak:Number(m.samplePeak.toFixed(5)),
			rms:Number(m.rms.toFixed(5)),
			dryPeak:Number(m.dry.samplePeak.toFixed(5)),
			dryRms:Number(m.dry.rms.toFixed(5)),
			peakRelativeDry:Number(m.peakRelativeDry.toFixed(3)),
			rmsRelativeDry:Number(m.rmsRelativeDry.toFixed(3)),
			overUnity:m.overUnitySampleCount,finite:m.finite
		})));
	}
	assert.deepEqual(errors,[]);
	assert(worst.every(row=>row.finite),'Nonfinite original-source DSP sample');
	assert(worst.every(row=>row.overUnity===0),'Original-stem precompressor preview samples clipped');
	console.log('FOUR_PACK_TWELVE_IDENTITY_ORIGINAL_SOURCE_PRECOMPRESSOR_OGG_REPORT',
		JSON.stringify({songs:report.map(({pack,trackId})=>({pack,trackId})),
			worst:worst.sort((a,b)=>b.samplePeak-a.samplePeak).slice(0,22),
			totalCases:worst.length,overUnityCases:worst.filter(w=>w.overUnity>0).length}));
	const risk=worst.filter(row=>row.overUnity>0);
	if(risk.length){
		console.log('PRECOMPRESSOR_PEAK_REVIEW_REQUIRED',JSON.stringify(risk));
	}
	if(process.env.CROSS_PACK_REPORT){
		writeFileSync(process.env.CROSS_PACK_REPORT,JSON.stringify({
			format:'bbs-original-stem-precompressor-headroom-audit-v1',
			sampleSeconds:2.5,source:'original archived OGG segment 0000',
			notes:'Dry and processed cases for each biome use the SAME original melodic lead. Browser OfflineAudioContext at 48k stereo with fixed TEST gains and NO final real-game compressor, room/SFX or mobile output.',
			renderedDryAndProcessedCases:report.length*12*2,
			results:report
		},null,2)+'\n','utf8');
	}
	console.log('CROSS_PACK_ORIGINAL_OGG_AUDIT_RENDER_PASS');
}finally{await browser.close();}
