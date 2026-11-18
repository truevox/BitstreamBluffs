/** Gapless AudioWorklet QA on the actual shipped music/SFX/wind mix.
 * Worklet probes attach only as silent parallel sinks; output path unchanged.
 * The 4x sinc reconstruction is an estimated intersample peak, not certified
 * dBTP or a hardware/device resampling guarantee. Uses localhost secure origin.
 */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {PEAK_MAX} from '../../src/systems/music/MasterPeakGuard.js';
import {QA_PEAK_WORKLET_SOURCE} from './qa-continuous-peak-worklet.mjs';

const origin=process.env.GAME_URL||'http://127.0.0.1:8224/';
const hostname=new URL(origin).hostname;
assert.ok(['localhost','127.0.0.1','[::1]','::1'].includes(hostname),
	'AudioWorklet QA requires a trustworthy loopback origin');
const target=process.env.REPORT_OUT||
	'/home/hermes/experiments/bitstream-continuous-peak-20261118.json';
if(existsSync(target))throw Error('Refusing to overwrite QA evidence '+target);
const sha=b=>createHash('sha256').update(b).digest('hex');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1200,height:780}});
const errors=[],httpErrors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)httpErrors.push([r.status(),r.url()]);});
const delay=ms=>page.waitForTimeout(ms);
async function proveServedBuild(){
	const localHtml=readFileSync(new URL('../../dist/index.html',import.meta.url));
	const servedHtml=await (await page.request.get(origin)).body();
	assert.equal(sha(servedHtml),sha(localHtml),'Loopback served stale HTML');
	const jsAsset=/\bsrc=["'](\/assets\/[^"']+\.js)["']/.exec(localHtml.toString())?.[1];
	assert.ok(jsAsset,'Missing Vite entry script');
	const localJs=readFileSync(new URL('../../dist'+jsAsset,import.meta.url));
	const servedJs=await (await page.request.get(new URL(jsAsset,origin).href)).body();
	assert.equal(sha(localJs),sha(servedJs),'Loopback served stale JS');
	return {htmlSha256:sha(servedHtml),entryJsSha256:sha(servedJs),entryScript:jsAsset};
}
async function waitReady(){
	await page.waitForFunction(()=>{
		const d=window.__bbGame?.registry?.get('audioSynth')?._stemMusic;
		return d?.started&&d?.pack&&d.clockStart!==null&&
			d.ctx?.state==='running'&&d.activeNodes.size>=6;
	},null,{timeout:45000});
}
async function command(kind){
	return page.evaluate(async(kind)=>{
		const p=window.__bbQaContinuous;
		const id=++p.nextId;
		const result=await Promise.all(p.taps.map(t=>new Promise((resolve,reject)=>{
			const timeout=setTimeout(()=>reject(Error('QA worklet response timeout '+kind)),3000);
			const listener=ev=>{
				if(ev.data?.id!==id||ev.data?.kind!==kind)return;
				clearTimeout(timeout);t.worklet.port.removeEventListener('message',listener);
				resolve({name:t.name,...ev.data});
			};
			t.worklet.port.addEventListener('message',listener);
			t.worklet.port.postMessage({kind,id});
		})));
		if(kind==='snapshot'){
			const final=result.find(x=>x.name==='final');
			const coefficients=[.25,.5,.75].map(phase=>{
				let sum=0;const taps=[];
				for(let j=0;j<32;j++){
					const x=j-15-phase;
					const sinc=x===0?1:Math.sin(Math.PI*x)/(Math.PI*x);
					const window=.42+.5*Math.cos(Math.PI*x/16)+
						.08*Math.cos(2*Math.PI*x/16);
					const value=sinc*window;taps.push(value);sum+=value;
				}
				return taps.map(x=>x/sum);
			});
			for(let channel=0;channel<2;channel++){
				const pcm=final.pcm[channel],stats=final.stats.channels[channel];
				let reconstructedPeak=0,reconstructedAbove=0,evaluated=0;
				for(let start=0;start+32<=pcm.length;start++){
					for(const coeffs of coefficients){
						let amplitude=0;
						for(let j=0;j<32;j++)amplitude+=pcm[start+j]*coeffs[j];
						const magnitude=Math.abs(amplitude);
						reconstructedPeak=Math.max(reconstructedPeak,magnitude);
						if(magnitude>p.limit+2e-4)reconstructedAbove++;
						evaluated++;
					}
				}
				Object.assign(stats,{fractionalReconstructedPeak:reconstructedPeak,
					reconstructedPeak:Math.max(stats.peak,reconstructedPeak),
					reconstructedAbove,reconstructionEvaluations:evaluated});
			}
			final.stats.reconstruction='offline 4x-32tap Blackman-windowed sinc intersample estimate; NOT certified dBTP';
			delete final.pcm;
		}
		return result;
	},kind);
}
async function sampleWindow(label,{position,danger,menu=false,seconds=2}={}){
	const prepared=await page.evaluate(({position,danger,menu})=>{
		const game=window.__bbGame,a=game.registry.get('audioSynth'),d=a._stemMusic;
		if(menu){game.events.emit('bb:runEnd',{cause:'continuous-audio-qa'});}
		else{
			game.events.emit('bb:runStart',{seed:'continuous-audio-qa'});
			game.events.emit('bb:biomeEnter',{id:'crystal-cavern'});
			game.events.emit('bb:bsodStateChanged',{
				active:true,gapPx:danger?90:6000,wallSpeedPxS:410,
				worldTailwindPxS:danger?1250:850,
				sledVelocityXPxS:danger?250:850,
				relativeAirX:danger?1000:0,proximity01:danger,
				timeToImpactMs:danger?200:null,atmosphereDensity:1});
			a.setSpeed(danger?1050:650);a.setAirborne(!!danger);
			d.setCombo(danger?5:1);
		}
		if(!d.seekTo(position))throw Error('Seek rejected '+position);
		// Source vocals are switched on ONLY in this disposable browser's memory.
		d.setVocals(true);
		return {song:d.track.id,position,mode:a._musicMode,clock:d.clockStart};
	},{position,danger,menu});
	await waitReady();await delay(600);
	await command('reset');
	if(danger){
		await page.evaluate(()=>{
			const a=window.__bbGame.registry.get('audioSynth');
			window.__bbQaContinuous.sfxTimer=setInterval(()=>{
				for(const name of ['hop','trick','nearMiss','boost'])a.playSfx(name,{intensity:.95});
			},400);
		});
	}
	await delay(seconds*1000);
	await page.evaluate(()=>{
		if(window.__bbQaContinuous.sfxTimer){
			clearInterval(window.__bbQaContinuous.sfxTimer);
			window.__bbQaContinuous.sfxTimer=null;
		}
	});
	const captures=Object.fromEntries((await command('snapshot'))
		.map(x=>[x.name,x.stats]));
	assert.ok(Math.abs(captures.final.frames-captures.soft.frames)<=128,
		'Worklet taps differed by more than one processing quantum');
	for(const name of ['soft','final']){
		const stats=captures[name];
		// Flag render gaps in the final report, even if host scheduling is loaded.
		// Unlike a sampled analyser test this observes every worklet callback.
		assert.ok(stats.frames>=seconds*stats.sampleRate*.9,
			label+' '+name+' missing rendered frames');
		assert.ok(stats.quanta>100,label+' '+name+' too few processor quanta');
		if(name==='final'){
			assert.equal(stats.recordedFrames,stats.frames,
				label+' PCM capture truncated');
			assert.ok(stats.channels.every(c=>c.reconstructedPeak>0),
				label+' failed to run offline intersample reconstruction');
		}
		for(const [channel,s] of stats.channels.entries()){
			assert.equal(s.nonfinite,0,label+' '+name+' nonfinite channel '+channel);
			assert.ok(s.peak>0&&s.count===stats.frames,
				label+' '+name+' missing live signal on channel '+channel);
			if(name==='final')assert.ok(s.peak<=PEAK_MAX+2e-4&&s.above===0,
				label+' final sample ceiling violation '+channel+': '+s.peak);
		}
	}
	const summary={label,...prepared,seconds,
			soft:captures.soft,final:captures.final};
	console.log(captures.final.discontinuities||captures.soft.discontinuities?
		'CONTINUOUS_WINDOW_GAP':'CONTINUOUS_PEAK_PASS',label,'song',prepared.song,
			'frames',captures.final.frames,'maxSample',Math.max(...captures.final.channels.map(x=>x.peak)).toFixed(6),
			'approxReconstructedPeak',Math.max(...captures.final.channels.map(x=>x.reconstructedPeak)).toFixed(6),
			'softOverLimit',captures.soft.channels.reduce((n,x)=>n+x.above,0));
	return summary;
}
try{
	const servedBuild=await proveServedBuild();
	await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),
		null,{timeout:35000});
	await page.keyboard.press('x');
	await waitReady();
	const init=await page.evaluate(({source,limit})=>{
		const a=window.__bbGame.registry.get('audioSynth'),ctx=a.ctx;
		if(!ctx.audioWorklet)throw Error('AudioWorklet unavailable: requires localhost or HTTPS');
		return {audioSampleRate:ctx.sampleRate,secureContext:isSecureContext,
			firstSong:a._stemMusic.track.id};
	},{source:QA_PEAK_WORKLET_SOURCE,limit:PEAK_MAX});
	assert.equal(init.firstSong,'local-one-more-run-bitstream-bluffs');
	await page.evaluate(async({source,limit})=>{
		const a=window.__bbGame.registry.get('audioSynth'),ctx=a.ctx;
		const url=URL.createObjectURL(new Blob([source],{type:'application/javascript'}));
		try{await ctx.audioWorklet.addModule(url)}finally{URL.revokeObjectURL(url)}
		const taps=[];
		for(const [name,from] of [['soft',a.nodes.peakGuard],['final',a.nodes.finalSampleCeiling]]){
			const worklet=new AudioWorkletNode(ctx,'bb-qa-peak-probe-v2',{
				numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],
				channelCount:2,channelCountMode:'explicit',
				processorOptions:{limit,recordSamples:name==='final'}});
			const mute=ctx.createGain();mute.gain.value=0;
			from.connect(worklet);worklet.connect(mute);mute.connect(ctx.destination);
			worklet.port.start();taps.push({name,from,worklet,mute});
		}
		window.__bbQaContinuous={taps,nextId:0,sfxTimer:null,limit};
	},{source:QA_PEAK_WORKLET_SOURCE,limit:PEAK_MAX});
	const settings=await page.evaluate(()=>{
		const game=window.__bbGame,a=game.registry.get('audioSynth');
		const s={...game.registry.get('settings'),masterVolume:1,musicVolume:1,
			sfxVolume:1,windVolume:1,windEnabled:true,musicShuffle:false,
			dynamicOrchestra:false};
		a.applySettings(s);return s;
	});
	const entries=[];
	for(let index=0;index<4;index++){
		await waitReady();
		const info=await page.evaluate(()=>{
			const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
			return {song:d.track.id,duration:d.pack.duration};
		});
		const position=index%2===0?Math.max(8,info.duration*.25):
			Math.max(8,info.duration*.65);
		entries.push(await sampleWindow('song'+index+'-menu',{
			position,menu:true,danger:0,seconds:2}));
		entries.push(await sampleWindow('song'+index+'-nearwall',{
			position:position+3,menu:false,danger:.97,seconds:2}));
		const clockBefore=await page.evaluate(()=>{
			const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
			return {song:d.track.id,clock:d.clockStart};
		});
		const clockAfter=await page.evaluate(()=>{
			const game=window.__bbGame;
			game.events.emit('bb:runEnd',{cause:'QA-crash'});
			const d=game.registry.get('audioSynth')._stemMusic;
			return {song:d.track.id,clock:d.clockStart,
				voice:d._activeVoiceFor(d.pack),menu:d.menuMode};
		});
		assert.equal(clockBefore.song,clockAfter.song);
		assert.equal(clockBefore.clock,clockAfter.clock);
		assert.equal(clockAfter.voice,'voice:debumont');
		assert.equal(clockAfter.menu,true);
		console.log('CONTINUOUS_CLOCK_CRASH_PASS',info.song);
		if(index<3){
			await page.evaluate(()=>{
				if(!window.__bbGame.registry.get('audioSynth').jukeboxStep(1))
					throw Error('Next song rejected');
			});
			await page.waitForFunction(prev=>{
				const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
				return d.track?.id!==prev&&d.pack&&d.activeNodes.size>=6;
			},info.song,{timeout:45000});
		}
	}
	const distinct=[...new Set(entries.map(x=>x.song))];
	assert.equal(distinct.length,4);
	assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
	const report={format:'bitstream-qa-contiguous-web-audio-render-v1',
		status:entries.some(x=>x.final.discontinuities||x.soft.discontinuities)?
			'FAIL_RENDER_GAPS_REVIEW_RECORDED_EVIDENCE':
			'PASS_8_WINDOWS_NO_RENDER_GAPS_NOT_FULL_SONG',
		servedBuild,init,browserVersion:browser.version(),
		workletSourceSha256:sha(QA_PEAK_WORKLET_SOURCE),
		ceiling:PEAK_MAX,sourceCommit:execFileSync('git',['rev-parse','HEAD'],
			{cwd:new URL('../../',import.meta.url),encoding:'utf8'}).trim(),
		sourceSha256:Object.fromEntries([
			['AudioSynth.js','../../src/systems/AudioSynth.js'],
			['MasterPeakGuard.js','../../src/systems/music/MasterPeakGuard.js'],
		].map(([name,path])=>[name,sha(readFileSync(new URL(path,import.meta.url)))])),
		windows:entries,summary:{songs:distinct.length,windows:entries.length,
			totalRenderedFrames:entries.reduce((n,x)=>n+x.final.frames,0),
			renderGapWindows:entries.filter(x=>x.final.discontinuities||x.soft.discontinuities).length,
			missingRenderFrames:entries.reduce((n,x)=>n+x.final.missingFrames,0),
			overlappingRenderFrames:entries.reduce((n,x)=>n+x.final.overlappingFrames,0),
			maximumSamplePeak:Math.max(...entries.flatMap(x=>x.final.channels.map(c=>c.peak))),
			maximumReconstructedPeakEstimate:Math.max(...entries.flatMap(x=>x.final.channels.map(c=>c.reconstructedPeak))),
			softOverCeilingSamples:entries.reduce((n,x)=>n+x.soft.channels.reduce((m,c)=>m+c.above,0),0),
			finalOverCeilingSamples:entries.reduce((n,x)=>n+x.final.channels.reduce((m,c)=>m+c.above,0),0),
			intersampleEstimateAboveCeilingSamples:entries.reduce((n,x)=>
				n+x.final.channels.reduce((m,c)=>m+c.reconstructedAbove,0),0)} };
	writeFileSync(target,JSON.stringify(report,null,2)+'\n');
	console.log('CONTINUOUS_RENDER_AUDIT_RESULT',JSON.stringify(report.summary));
	if(report.summary.renderGapWindows>0)console.warn('RENDER_GAPS_DETECTED',
		JSON.stringify(entries.filter(x=>x.final.discontinuities||x.soft.discontinuities)
		.map(x=>({label:x.label,finalGaps:x.final.gaps,softGaps:x.soft.gaps}))));
	console.log('REPORT_SHA256',sha(readFileSync(target)));
	assert.equal(report.summary.renderGapWindows,0,'Real WebAudio render gaps detected; report persisted for diagnosis');
}finally{
	await page.evaluate(()=>{
		const p=window.__bbQaContinuous;
		if(!p)return;
		if(p.sfxTimer)clearInterval(p.sfxTimer);
		for(const {name,from,worklet,mute} of p.taps){
			try{from.disconnect(worklet)}catch{}
			try{worklet.disconnect()}catch{}
			try{mute.disconnect()}catch{}
			worklet.port.close();
		}
		delete window.__bbQaContinuous;
	}).catch(()=>{});
	await browser.close();
}
