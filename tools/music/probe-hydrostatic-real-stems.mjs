#!/usr/bin/env node
/** Exact original MP3 stem sampling into Chromium WebAudio; no fake accompaniment. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.HYDROSTATIC_SOURCE_URL||'http://127.0.0.1:5173';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try {
	const page=await browser.newPage(),errors=[];
	page.on('pageerror',e=>errors.push(String(e)));
	await page.goto(base+'/tools/music/hydrostatic-audition.html',{waitUntil:'domcontentloaded'});
	const result=await page.evaluate(async()=>{
		const [{buildMusicChain},{orchestraPreset}]=await Promise.all([
			import('/src/systems/music/MusicFXGraph.js'),
			import('/src/systems/music/DynamicOrchestraPresets.js'),
		]);
		const live=new AudioContext({sampleRate:48000});
		const stems={};
		for(const role of ['drums','bass','guitar','piano','other']){
			let response=await fetch('/scrapheap-audition/'+role+'.mp3');
			if(!response.ok)response=await fetch('/public/scrapheap-audition/'+role+'.mp3');
			if(!response.ok)throw new Error('Missing source stem: '+role);
			stems[role]=await live.decodeAudioData(await response.arrayBuffer());
		}
		const sr=live.sampleRate,seconds=3,N=sr*seconds;
		await live.close();
		async function render(mode){
			const ctx=new OfflineAudioContext(2,N,sr),master=ctx.createGain();
			master.gain.value=.32;master.connect(ctx.destination);
			for(const role of Object.keys(stems)){
				const src=ctx.createBufferSource(),gain=ctx.createGain();
				src.buffer=stems[role];gain.gain.value=role==='drums'?.9:role==='bass'?.75:.65;
				src.connect(gain);
				if(mode==='dry')gain.connect(master);
				else {
					const chain=buildMusicChain(ctx,orchestraPreset('underwater-mountain',role),master);
					gain.connect(chain.input);
					const fx=chain.find('hydrostatic');
					if(mode!=='zero')fx.set('pressure',1,.40);
					if(mode==='relief')fx.set('pressure',.14,1.15);
					if(mode==='strongContrast')fx.set('contrast',2.2,.42);
					if(mode==='landingOff'&&role==='drums') {
						fx.set('waveStrength',0,.7);fx.set('impact',.85,1.5);
					}
					if(mode==='landing'&&role==='drums')fx.set('impact',.85,1.5);
					if(mode==='waveMaximum'&&role==='drums'){
						fx.set('waveStrength',2.4,.7);
						fx.set('impact',1,1.5);
					}
					if(mode==='waveStack'&&role==='drums'){
						fx.set('waveStrength',2.4,.7);
						for(const t of [1.5,1.56,1.62]) fx.set('impact',1,t);
					}
				}
				src.start(0);
			}
			return ctx.startRendering();
		}
		const modes=['dry','zero','deep','relief','landing','landingOff',
			'strongContrast','waveMaximum','waveStack'];
		const renders=await Promise.all(modes.map(render));
		const byMode=Object.fromEntries(modes.map((name,i)=>[name,renders[i]]));
		const {dry,zero,deep,relief,landing,landingOff,strongContrast,waveMaximum,waveStack}=byMode;
		const info=(buffer)=>{
			let sum=0,peak=0,finite=true;
			for(let ch=0;ch<2;ch++){
				const data=buffer.getChannelData(ch);
				for(let i=0;i<N;i++){
					const x=data[i];sum+=x*x;peak=Math.max(peak,Math.abs(x));
					if(!Number.isFinite(x))finite=false;
				}
			}
			return {rms:Math.sqrt(sum/(N*2)),peak,finite};
		};
		const diff=(a,b,start=1.65,stop=2.25)=>{
			const first=Math.floor(start*sr),last=Math.floor(stop*sr);
			let sum=0;
			for(let ch=0;ch<2;ch++){
				const aa=a.getChannelData(ch),bb=b.getChannelData(ch);
				for(let i=first;i<last;i++)sum+=(aa[i]-bb[i])**2;
			}
			return Math.sqrt(sum/(2*(last-first)));
		};
		return {
			...Object.fromEntries(modes.map(name=>[name,info(byMode[name])])),
			dryBypassDifference:diff(dry,zero),
			pressureDifference:diff(dry,deep),
			contrastDifference:diff(deep,strongContrast),
			reliefDifference:diff(deep,relief),
			impactDifference:diff(landing,deep,1.5,2.08),
			impactOffDifference:diff(landingOff,deep,1.5,2.08),
			maxImpactDifference:diff(waveMaximum,deep,1.5,2.08),
		};
	});
	console.log('HYDROSTATIC_FIVE_STEM_CHROMIUM',JSON.stringify(result));
	assert.deepEqual(errors,[]);
	for(const mode of ['dry','zero','deep','relief','landing','landingOff','strongContrast','waveMaximum','waveStack']){
		assert(result[mode].finite,mode+' samples should be finite');
		assert(result[mode].peak<.92,mode+' unexpected sampled peak');
	}
	assert(result.dryBypassDifference<.001,'zero pressure should be nearly dry-identical');
	assert(result.pressureDifference>.015,'deep pressure must be clearly distinct from dry');
	assert(result.reliefDifference>.015,'rising jump relief must clearly open the filtered sound');
	assert(result.contrastDifference>.001,'depth contrast slider must change the actual waveform');
	assert(result.impactDifference>.019,'landing pressure wave must cut through full original mix');
	assert(result.maxImpactDifference>result.impactDifference*1.2,'more wave strength should be audible');
	assert(result.impactOffDifference<.00001,'muted pressure wave must not secretly play');
} finally {await browser.close();}
