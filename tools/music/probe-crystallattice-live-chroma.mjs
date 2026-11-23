#!/usr/bin/env node
/** Live source-backed pitch confidence: real decoded bass MP3 in Chromium. */
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base=process.env.CRYSTAL_SOURCE_URL||'http://127.0.0.1:5173';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
	await page.goto(base+'/tools/music/crystallattice-audition.html',{waitUntil:'domcontentloaded'});
	const result=await page.evaluate(async()=>{
		const {confidentCrystalNotes}=await import('/src/systems/music/CrystalChroma.js');
		const ctx=new AudioContext({sampleRate:48000});await ctx.resume();
		let response=await fetch('/scrapheap-audition/bass.mp3');
		if(!response.ok)response=await fetch('/public/scrapheap-audition/bass.mp3');
		const buffer=await ctx.decodeAudioData(await response.arrayBuffer());
		const src=ctx.createBufferSource();src.buffer=buffer;src.loop=true;
		const analyser=ctx.createAnalyser();analyser.fftSize=4096;analyser.smoothingTimeConstant=.52;
		const monitor=ctx.createGain();monitor.gain.value=1e-7;
		src.connect(analyser);analyser.connect(monitor);monitor.connect(ctx.destination);
		src.start(ctx.currentTime+.03);
		const snapshots=[];
		for(let i=0;i<35;i++){
			await new Promise(r=>setTimeout(r,300));
			const db=new Float32Array(analyser.frequencyBinCount);
			analyser.getFloatFrequencyData(db);
			const notes=confidentCrystalNotes(db,{sampleRate:ctx.sampleRate,fftSize:analyser.fftSize});
			const peak=Math.max(...db);
			snapshots.push({atSec:Math.round((i+1)*.3*100)/100,peakDb:peak,ctxTime:ctx.currentTime,ctxState:ctx.state,bufferSec:buffer.duration,
				notes:notes.map(x=>[x.midi,Math.round(x.hz),Number(x.confidence.toFixed(2))])});
		}
		src.stop();await ctx.close();return snapshots;
	});
	console.log('CRYSTAL_REAL_BASS_LIVE_SPECTRAL_CONFIDENCE',JSON.stringify(result.filter((x,i)=>x.notes.length||i%4===0)));
	assert.deepEqual(errors,[]);
} finally{await browser.close();}
