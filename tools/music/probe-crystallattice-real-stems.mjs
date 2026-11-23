#!/usr/bin/env node
/** Chromium rendered actual original music, crystal resonances vs dry and flight. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.CRYSTAL_SOURCE_URL||'http://127.0.0.1:5173';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try {
	const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
	await page.goto(base+'/tools/music/crystallattice-audition.html',{waitUntil:'domcontentloaded'});
	const result=await page.evaluate(async()=>{
		const [{buildMusicChain},{orchestraPreset}]=await Promise.all([
			import('/src/systems/music/MusicFXGraph.js'),
			import('/src/systems/music/DynamicOrchestraPresets.js'),
		]);
		const ac=new AudioContext({sampleRate:48000}),stems={};
		for(const role of ['drums','bass','guitar','piano','other']){
			let response=await fetch('/scrapheap-audition/'+role+'.mp3');
			if(!response.ok)response=await fetch('/public/scrapheap-audition/'+role+'.mp3');
			if(!response.ok)throw new Error('Missing original '+role+' stem');
			stems[role]=await ac.decodeAudioData(await response.arrayBuffer());
		}
		const sr=ac.sampleRate,seconds=5,N=sr*seconds;await ac.close();
		async function render(mode){
			const ctx=new OfflineAudioContext(2,N,sr),master=ctx.createGain();
			master.gain.value=.32;master.connect(ctx.destination);
			for(const role of Object.keys(stems)){
				const src=ctx.createBufferSource(),vol=ctx.createGain();
				src.buffer=stems[role];vol.gain.value=role==='drums'?.9:role==='bass'?.75:.65;
				src.connect(vol);
				if(mode==='dry')vol.connect(master);
				else{
					const fx=buildMusicChain(ctx,orchestraPreset('crystal-cavern',role),master);
					vol.connect(fx.input);
					if(['airborne','maxBloom','bloomOnly','airborneWithoutShimmer'].includes(mode)){
						if(role==='drums'&&['airborne','maxBloom'].includes(mode))fx.find('crystalPercussion').set('gain',.48,.2);
						else if(['bass','guitar','piano','other'].includes(role))
							fx.find('crystallattice').set('openness',1,.2);
					}
					if(mode==='maxBloom'&&['bass','guitar','piano','other'].includes(role)){
						const crystal=fx.find('crystallattice');
						crystal.set('strength',2,.25);crystal.set('airBloom',2.5,.25);
					}
					if(mode==='airborneWithoutShimmer'&&['bass','guitar','piano','other'].includes(role))
						fx.find('crystallattice').set('airBloom',0,.25);
					if(mode==='impact'&&role==='bass')fx.find('crystallattice').set('impact',.9,3.2);
					if(mode==='silentLattice'&&['bass','guitar','piano','other'].includes(role))
						fx.find('crystallattice').set('strength',0,.2);
				}
				src.start(0);
			}
			return ctx.startRendering();
		}
		const modes=['dry','silentLattice','ground','airborne','impact','maxBloom','bloomOnly','airborneWithoutShimmer'];
		const buffers=await Promise.all(modes.map(render));
		const out=Object.fromEntries(modes.map((mode,i)=>[mode,buffers[i]]));
		const stats=buffer=>{let energy=0,peak=0,finite=true;for(let c=0;c<2;c++){
			const data=buffer.getChannelData(c);
			for(let i=0;i<N;i++){const v=data[i];energy+=v*v;
				peak=Math.max(peak,Math.abs(v));if(!Number.isFinite(v))finite=false;}}
			return {rms:Math.sqrt(energy/(2*N)),peak,finite};};
		const diff=(x,y,start=.75,stop=2.4)=>{
			const a=out[x],b=out[y],first=Math.floor(start*sr),last=Math.floor(stop*sr);
			let energy=0;for(let c=0;c<2;c++){
				const aa=a.getChannelData(c),bb=b.getChannelData(c);
				for(let i=first;i<last;i++)energy+=(aa[i]-bb[i])**2;
			}return Math.sqrt(energy/(2*(last-first)));
		};
		return {...Object.fromEntries(modes.map(mode=>[mode,stats(out[mode])])),
			resonanceVsSilent:diff('ground','silentLattice'),
			groundVsDry:diff('ground','dry'),
			flightVsGround:diff('airborne','ground'),
			airBloomWithoutDrumDuck:diff('bloomOnly','ground'),
			sparkleDifference:diff('bloomOnly','airborneWithoutShimmer'),
			landingSourceSwelling:diff('impact','ground',3.2,3.85)};
	});
	console.log('CRYSTALLATTICE_REAL_FIVE_STEMS_CHROMIUM',JSON.stringify(result));
	assert.deepEqual(errors,[]);
	for(const mode of ['dry','silentLattice','ground','airborne','impact','maxBloom','bloomOnly','airborneWithoutShimmer']){
		assert(result[mode].finite,mode+' contains NaN/Inf');
		assert(result[mode].peak<.92,mode+' unexpected peak');
	}
	assert(result.resonanceVsSilent>.001,'original harmonic stems do not excite lattice audibly');
	assert(result.flightVsGround>.004,'flight must open lattice and change drums');
	assert(result.airBloomWithoutDrumDuck>.008,'air bloom must be audible with unchanged drums');
	assert(result.sparkleDifference>.003,'new upper shimmer must be distinct independently of wet loudness');
	assert(result.landingSourceSwelling>.001,'landing must excite the source-fed modes');
} finally {await browser.close();}
