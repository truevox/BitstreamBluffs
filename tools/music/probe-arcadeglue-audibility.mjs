#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.ARCADEGLUE_URL||
	'http://127.0.0.1:19008/tools/music/arcadeglue-audition.html?qa=1';
const browser=await puppeteer.launch({
	executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']
});
try{
	const page=await browser.newPage(),errors=[];
	page.on('pageerror',e=>errors.push(e.message));
	page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
	page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
	await page.goto(url.includes('?')?url:url+'?qa=1',{waitUntil:'networkidle2'});
	await page.click('#load');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes(
		'Five synchronized original stereo recordings ready'),{timeout:18000});
	const report=await page.evaluate(async()=>{
		const {buildMusicChain,orchestraPreset,getBuffers}=window.__arcadeglueQA;
		const buffers=getBuffers(),roles=['drums','bass','guitar','piano','other'];
		const sampleRate=48000,seconds=3.5,frames=Math.ceil(seconds*sampleRate);
		const mixGain=role=>role==='drums'?.9:role==='bass'?.75:.65;
		async function render(mode,progress,intensity=1.25,chop=1.2){
			const ctx=new OfflineAudioContext(2,frames,sampleRate);
			const mix=ctx.createGain();mix.gain.value=.55;mix.connect(ctx.destination);
			const chains=[];
			for(const role of roles){
				const src=ctx.createBufferSource();src.buffer=buffers[role];
				const level=ctx.createGain();level.gain.value=mixGain(role);
				src.connect(level);
				if(mode==='dry')level.connect(mix);
				else{
					const chain=buildMusicChain(ctx,orchestraPreset('bitstream-bluffs',role),mix);
					chains.push(chain);level.connect(chain.input);
					const stage=chain.find('arcadeglue');
					stage.set('bridge',mode==='bridge',0);
					stage.set('progress',progress,0);
					stage.set('intensity',intensity,0);
					stage.set('chop',chop,0);
				}
				src.start(0);
			}
			const result=await ctx.startRendering();
			const copy=[...Array(2)].map((_,i)=>Float32Array.from(result.getChannelData(i)));
			for(const chain of chains)chain.dispose();
			return copy;
		}
		const dry=await render('dry',0);
		function rms(src){
			let total=0,peak=0,over=0;
			for(const ch of src)for(const val of ch){total+=val*val;
				peak=Math.max(peak,Math.abs(val));
				if(Math.abs(val)>1)over++;
			}
			return {rms:Math.sqrt(total/(2*frames)),samplePeak:peak,overUnity:over};
		}
		const dryStats=rms(dry),results={dry:dryStats};
		for(const [name,mode,progress,intensity] of [
			['bridge0','bridge',0,1.25],['bridge25','bridge',.25,1.25],
			['bridge50','bridge',.50,1.25],['bridge75','bridge',.75,1.25],
			['bridge100','bridge',1,1.25],['standalone','standalone',0,1.25],
			['highStandalone','standalone',0,2.0],['zeroIntensity','standalone',0,0]
		]){
			const rendered=await render(mode,progress,intensity);
			let delta=0,differencePeak=0;
			for(let ch=0;ch<2;ch++)for(let i=0;i<frames;i++){
				const d=rendered[ch][i]-dry[ch][i];
				delta+=d*d;differencePeak=Math.max(differencePeak,Math.abs(d));
			}
			results[name]={...rms(rendered),deltaRms:Math.sqrt(delta/(2*frames)),
				deltaPercentOfDry:100*Math.sqrt(delta/(2*frames))/dryStats.rms,
				differencePeak};
		}
		return results;
	});
	console.log('ARCADE_ORIGINAL_OGG_48KHZ_MEASURED',JSON.stringify(report));
	assert.equal(report.dry.overUnity,0);
	for(const [name,s] of Object.entries(report)){
		if(name==='dry')continue;
		assert.equal(s.overUnity,0,'Original OGG preview clipping '+name);
	}
	assert(report.standalone.deltaPercentOfDry>14,
		'Standalone Arcade too subtle against original song');
	assert(report.highStandalone.deltaPercentOfDry>report.standalone.deltaPercentOfDry*1.15,
		'Intensity slider 200% must audibly exceed 125%');
	assert(report.zeroIntensity.deltaPercentOfDry<.03,
		'Arcade intensity 0 must return exact original recorded music');
	assert(report.bridge50.deltaPercentOfDry>10,
		'Arcade corridor middle should sound distinct');
	assert(report.bridge0.deltaPercentOfDry<report.bridge50.deltaPercentOfDry*.5,
		'Outgoing dissolve not measurably softer than center Arcade');
	assert(report.bridge100.deltaPercentOfDry<report.bridge50.deltaPercentOfDry*.5,
		'Incoming rebuild not measurably softer than center Arcade');
	assert(Math.abs(report.standalone.deltaPercentOfDry-
		report.bridge50.deltaPercentOfDry)<1,
		'Standalone and full bridge center must share one identical Arcade identity');
	assert.deepEqual(errors,[]);
	console.log('ARCADE_TWO_ROLE_REAL_OGG_SAMPLE_HEADROOM_AUDIBILITY_PASS');
}finally{await browser.close();}
