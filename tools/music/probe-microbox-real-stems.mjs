#!/usr/bin/env node
/** Chromium actual original instrumental stems + real existing bee positions. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.MICROBOX_SOURCE_URL||'http://127.0.0.1:5173';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
	await page.goto(base+'/tools/music/microbox-audition.html',{waitUntil:'domcontentloaded'});
	const result=await page.evaluate(async()=>{
		const [{buildMusicChain},{orchestraPreset},{MicroBeeAudio},{beesAt},{GAME_WIDTH}]=await Promise.all([
			import('/src/systems/music/MusicFXGraph.js'),
			import('/src/systems/music/DynamicOrchestraPresets.js'),
			import('/src/systems/music/MicroBeeAudio.js'),
			import('/src/systems/MicroBees.js'),
			import('/src/constants.js'),
		]);
		const live=new AudioContext({sampleRate:48000}),stems={};
		for(const role of ['drums','bass','guitar','piano','other']){
			let response=await fetch('/scrapheap-audition/'+role+'.mp3');
			if(!response.ok)response=await fetch('/public/scrapheap-audition/'+role+'.mp3');
			if(!response.ok)throw new Error('Missing original stem '+role);
			stems[role]=await live.decodeAudioData(await response.arrayBuffer());
		}
		const seconds=3,sr=live.sampleRate,N=seconds*sr;await live.close();
		async function render(mode){
			const ctx=new OfflineAudioContext(2,N,sr),master=ctx.createGain();master.gain.value=.32;
			master.connect(ctx.destination);
			for(const role of Object.keys(stems)){
				const source=ctx.createBufferSource(),gain=ctx.createGain();
				source.buffer=stems[role];gain.gain.value=role==='drums'?.9:role==='bass'?.75:.65;
				source.connect(gain);
				if(mode==='dry')gain.connect(master);
				else{
					const chain=buildMusicChain(ctx,orchestraPreset('micro-mountain',role),master);
					gain.connect(chain.input);
					if(mode==='open')chain.find('microbox').set('openness',1,.35);
					if(mode==='shake'&&role==='drums')chain.find('microbox').set('impact',.9,1.3);
				}
				source.start(0);
			}
			return ctx.startRendering();
		}
		async function beeRender(riderScreenX){
			const ctx=new OfflineAudioContext(2,N,sr),gain=ctx.createGain();
			gain.gain.value=.32;gain.connect(ctx.destination);
			const bee=new MicroBeeAudio(ctx,gain);
			bee.setPositions(beesAt(0,5000,0),{enabled:true,playerScreenX:riderScreenX});
			return ctx.startRendering();
		}
		const [dry,closed,open,shake,beeLeft,beeRight]=await Promise.all([
			render('dry'),render('closed'),render('open'),render('shake'),
			beeRender(0),beeRender(GAME_WIDTH),
		]);
		function stats(buf){let sum=0,peak=0,finite=true,channels=[];
			for(let c=0;c<2;c++){let channelSum=0;const data=buf.getChannelData(c);
				for(let i=0;i<N;i++){const v=data[i];channelSum+=v*v;
					peak=Math.max(peak,Math.abs(v));if(!Number.isFinite(v))finite=false;}
				channels.push(Math.sqrt(channelSum/N));sum+=channelSum;
			}return {rms:Math.sqrt(sum/(2*N)),peak,finite,channels};}
		function diff(a,b,start=.75,stop=2.35){const first=Math.floor(start*sr),last=Math.floor(stop*sr);
			let sum=0;for(let c=0;c<2;c++){const aa=a.getChannelData(c),bb=b.getChannelData(c);
				for(let i=first;i<last;i++)sum+=(aa[i]-bb[i])**2;}
			return Math.sqrt(sum/(2*(last-first)));}
		return {dry:stats(dry),closed:stats(closed),open:stats(open),shake:stats(shake),
			beeLeft:stats(beeLeft),beeRight:stats(beeRight),
			closedDifference:diff(dry,closed),flightDifference:diff(closed,open),
			shakeDifference:diff(shake,closed,1.3,1.7)};
	});
	console.log('MICROBOX_REAL_FIVE_STEMS_CHROMIUM',JSON.stringify(result));
	assert.deepEqual(errors,[]);
	for(const mode of ['dry','closed','open','shake','beeLeft','beeRight']){
		assert(result[mode].finite,mode+' contains nonfinite output');
		assert(result[mode].peak<.92,mode+' sampled peak unexpected');
	}
	assert(result.closedDifference>.004,'miniature enclosure not audible in full mix');
	assert(result.flightDifference>.004,'flight must clearly open the room');
	assert(result.shakeDifference>.0015,'landing must trigger real audible box rattle');
	assert(result.beeLeft.rms>.0001&&result.beeRight.rms>.0001,'existing visual bee must be audible');
	assert(result.beeLeft.channels[1]>result.beeLeft.channels[0],
		'bee must pan right of left-positioned rider');
	assert(result.beeRight.channels[0]>result.beeRight.channels[1],
		'bee must pan left of right-positioned rider');
}finally{await browser.close();}
