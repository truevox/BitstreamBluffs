#!/usr/bin/env node
/** Real Chromium rendering using unchanged five original 20-second MP3 stems. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.SCRAP_CLANG_SOURCE_URL||'http://127.0.0.1:5173';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
	await page.goto(base+'/tools/music/scrap-clangs-audition.html',{waitUntil:'domcontentloaded'});
	const result=await page.evaluate(async()=>{
		const [{buildMusicChain},{orchestraPreset}]=await Promise.all([
			import('/src/systems/music/MusicFXGraph.js'),
			import('/src/systems/music/DynamicOrchestraPresets.js')]);
		const live=new AudioContext({sampleRate:48000}),stems={};
		for(const role of ['drums','bass','guitar','piano','other']){
			let res=await fetch('/scrapheap-audition/'+role+'.mp3');
			if(!res.ok)res=await fetch('/public/scrapheap-audition/'+role+'.mp3');
			if(!res.ok)throw new Error('Source recording '+role+' missing');
			stems[role]=await live.decodeAudioData(await res.arrayBuffer());
		}
		const sr=live.sampleRate,seconds=5,N=sr*seconds;await live.close();
		async function render(mode){
			const ctx=new OfflineAudioContext(2,N,sr),master=ctx.createGain();
			master.gain.value=.32;master.connect(ctx.destination);
			for(const role of Object.keys(stems)){
				const src=ctx.createBufferSource(),gain=ctx.createGain();
				src.buffer=stems[role];gain.gain.value=role==='drums'?.9:role==='bass'?.75:.65;
				src.connect(gain);
				if(mode==='dry')gain.connect(master);
				else{
					const chain=buildMusicChain(ctx,orchestraPreset('garbage-dump-glacier',role),master);
					gain.connect(chain.input);
					if(role==='drums'){
						const effect=chain.find('scrapheap');
						effect.set('contact',.55,.1);
						if(['clang','maxClang','tripleClang'].includes(mode)){
							if(mode!=='clang')effect.set('clangLevel',2,.7);
							// MIDI 65/349 Hz is observed as a *real source spectral
							// candidate around 3.3sec* by independent Chrome live FFT.
							const note={midi:65,hz:349.2282314330039,confidence:.31,strength:.65};
							const times=mode==='tripleClang'?[3.3,3.35,3.4]:[3.3];
							for(const t of times)effect.set('pitchedClang',note,t);
						}
					}
				}
				src.start(0);
			}
			return ctx.startRendering();
		}
		const modes=['dry','processed','clang','maxClang','tripleClang'];
		const rendered=await Promise.all(modes.map(render));
		const byMode=Object.fromEntries(modes.map((k,i)=>[k,rendered[i]]));
		const stats=buffer=>{let energy=0,peak=0,finite=true;
			for(let c=0;c<2;c++){const data=buffer.getChannelData(c);
				for(let i=0;i<N;i++){const v=data[i];energy+=v*v;
					peak=Math.max(peak,Math.abs(v));if(!Number.isFinite(v))finite=false;}}
			return {rms:Math.sqrt(energy/(2*N)),peak,finite};};
		const diff=(a,b,start=3.3,stop=3.95)=>{
			let energy=0;const x=byMode[a],y=byMode[b];
			const lo=Math.floor(start*sr),hi=Math.floor(stop*sr);
			for(let c=0;c<2;c++){const aa=x.getChannelData(c),bb=y.getChannelData(c);
				for(let i=lo;i<hi;i++)energy+=(aa[i]-bb[i])**2;}
			return Math.sqrt(energy/(2*(hi-lo)));};
		return {...Object.fromEntries(modes.map(k=>[k,stats(byMode[k])])),
			clangDifference:diff('clang','processed'),
			maxDifference:diff('maxClang','processed'),
			tripleDifference:diff('tripleClang','processed')};
	});
	console.log('SCRAP_REAL_FIVE_STEM_IN_PITCH_CHROME',JSON.stringify(result));
	assert.deepEqual(errors,[]);
	for(const mode of ['dry','processed','clang','maxClang','tripleClang']){
		assert(result[mode].finite,mode+' nonfinite samples');
		assert(result[mode].peak<.95,mode+' sampled peak exceeds headroom');
	}
	assert(result.clangDifference>.006,'new verified-pitch clang too quiet in original full mix');
	assert(result.maxDifference>result.clangDifference*1.25,'clang gain does not affect audible signal');
}finally{await browser.close();}
