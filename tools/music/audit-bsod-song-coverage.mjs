/** Repeatable, sparse whole-song *coverage* audit on real game WebAudio graph.
 * Samples five distinct segments of each of four songs at 0/.5/.97 danger,
 * plus a Debumont-menu passage. No new music engine, source changes, or saves.
 * Do not mistake selected-window sampling for full-duration peak verification.
 */
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const origin=process.env.GAME_URL||'http://100.115.120.66:8206/';
const dest=process.env.REPORT_OUT||
	'/home/hermes/experiments/bitstream-bsod-song-coverage-20261118.json';
if(existsSync(dest))throw Error('Refusing to overwrite source-grounded audit report: '+dest);
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],httpErrors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)httpErrors.push({status:r.status(),url:r.url()})});
const delay=ms=>page.waitForTimeout(ms);
const waitReady=async()=>page.waitForFunction(()=>{
	const a=window.__bbGame?.registry?.get('audioSynth');
	const d=a?._stemMusic;
	return d?.started&&d?.pack&&d.clockStart!==null&&
		d.ctx?.state==='running'&&d.activeNodes.size>=6;
},null,{timeout:45000});
function db(x){return 20*Math.log10(Math.max(x,1e-12));}
const checkConditions=(x,label)=>{
	for(const bus of ['music','master']){
		assert.ok(Number.isFinite(x[bus].peakDbfs)&&
			Number.isFinite(x[bus].rmsDbfs),'nonfinite '+label+'/'+bus);
		assert.ok(x[bus].rms>1e-7,'silent '+label+'/'+bus);
		assert.ok(x[bus].peak<=1,'clipped '+label+'/'+bus+' peak '+x[bus].peak);
	}
};
async function tapRead(position,danger,mode='run'){
	const prepared=await page.evaluate(({position,danger,mode})=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
		if(mode==='run'&&a._musicMode!=='run')g.events.emit('bb:runStart',{seed:'coverage-audit'});
		if(mode==='menu'&&a._musicMode!=='menu')g.events.emit('bb:runEnd',{cause:'coverage-audit'});
		if(mode==='run'){
			g.events.emit('bb:biomeEnter',{id:'crystal-cavern'});
			g.events.emit('bb:bsodStateChanged',{
				active:true,gapPx:danger?90:5000,
				wallSpeedPxS:400,worldTailwindPxS:850,sledVelocityXPxS:850,
				relativeAirX:0,proximity01:danger,
				atmosphereDensity:1,timeToImpactMs:danger?150:null,
			});
		}
		if(!d.seekTo(position))throw Error('Real music seek rejected '+position);
		return {song:d.track?.id,sourcePosition:position,mode:a._musicMode,
			clockAnchor:d.clockStart,expectedDanger:danger};
	},{position,danger,mode});
	await waitReady();
	// WebAudio smoother time constants <=.2 sec, but fetch/decode of an
	// as-yet-unused segment can take longer. This is a conservative warmup.
	await delay(850);
	const captured=await page.evaluate(async()=>{
		const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic,c=a.ctx;
		const buses={music:a.nodes.musicBus,master:a.nodes.finalSampleCeiling || a.nodes.peakGuard || a.nodes.comp};
		const taps=[];
		for(const [name,source] of Object.entries(buses)){
			const analyser=c.createAnalyser();
			analyser.fftSize=2048;analyser.smoothingTimeConstant=0;
			const sink=c.createGain();sink.gain.value=0;
			source.connect(analyser);
			analyser.connect(sink);sink.connect(c.destination);
			taps.push({name,source,analyser,sink,buffer:new Float32Array(2048)});
		}
		try{
			const captures=Object.fromEntries(taps.map(t=>[t.name,
				{maxPeak:0,energy:0,count:0}]));
			// Time-domain blocks overlap; it is a sampled RMS proxy,
			// and peak-of-samples, not sample-perfect full-duration reading.
			for(let tick=0;tick<36;tick++){
				for(const t of taps){
					t.analyser.getFloatTimeDomainData(t.buffer);
					const m=captures[t.name];
					for(const v of t.buffer){
						const abs=Math.abs(v);
						if(abs>m.maxPeak)m.maxPeak=abs;
						m.energy+=v*v;m.count++;
					}
				}
				await new Promise(resolve=>setTimeout(resolve,25));
			}
			const result={song:d.track.id,mode:a._musicMode,
				danger:a._bsodDanger01,
				positionEnd:c.currentTime-d.clockStart,
				activeNodeCount:d.activeNodes.size};
			for(const [name,m] of Object.entries(captures)){
				const rms=Math.sqrt(m.energy/m.count);
				result[name]={rms,peak:m.maxPeak,
					rmsDbfs:20*Math.log10(Math.max(rms,1e-12)),
					peakDbfs:20*Math.log10(Math.max(m.maxPeak,1e-12)),
					sampledFrames:m.count};
			}
			return result;
		}finally{
			for(const t of taps){
				try{t.source.disconnect(t.analyser)}catch{}
				try{t.analyser.disconnect()}catch{}
				try{t.sink.disconnect()}catch{}
			}
		}
	});
	assert.equal(captured.song,prepared.song);
	assert.equal(captured.mode,mode);
	if(mode==='run')assert.equal(captured.danger,danger);
	checkConditions(captured,mode+'/'+prepared.song+'/'+position+'/'+danger);
	return {...prepared,...captured};
}

try{
	await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene
		?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:35000});
	await page.keyboard.press('x');
	await waitReady();
	await page.evaluate(()=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth');
		const settings={...g.registry.get('settings'),masterVolume:1,
			musicVolume:1,sfxVolume:0,windVolume:0,windEnabled:false,
			musicVocals:false,dynamicOrchestra:false,musicShuffle:false};
		g.registry.set('settings',settings);
		g.events.emit('bb:settingsChanged',
			{settings,key:'musicVolume',value:1});
		g.events.emit('bb:runStart',{seed:'source-coverage-only'});
		g.events.emit('bb:biomeEnter',{id:'crystal-cavern'});
		a.setSpeed(850);
		a.setAirborne(false);
	});
	const entries=[];
	const dangerValues=[0,.5,.97];
	for(let songNumber=0;songNumber<4;songNumber++){
		await waitReady();
		const initial=await page.evaluate(()=>{
			const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
			const count=d.pack.segments.length;
			const indices=[0,Math.floor(count/4),Math.floor(count/2),
				Math.floor(count*3/4),count-1];
			const checkpoints=[...new Set(indices)].map(index=>{
				const seg=d.pack.segments[index];
				const seconds=(seg.startFrame+seg.frames*.5)/d.pack.sampleRate;
				return {index,seconds:Math.round(seconds*1000)/1000};
			});
			return {id:d.track.id,checkpoints,duration:d.pack.duration};
		});
		const windows=[];
		for(const {index,seconds} of initial.checkpoints){
			const states=[];
			for(const danger of dangerValues){
				const reading=await tapRead(seconds,danger);
				states.push(reading);
				console.log('SAMPLED_PASSAGE',initial.id,
					'segment',index,'second',seconds,'danger',danger,
					'masterPeakDbfs',reading.master.peakDbfs.toFixed(2),
					'masterRmsDbfs',reading.master.rmsDbfs.toFixed(2));
			}
			const nearMinusClean=states[2].master.rmsDbfs-states[0].master.rmsDbfs;
			windows.push({index,seconds,states,nearMinusCleanRmsDb:nearMinusClean});
		}
		entries.push({song:initial.id,trackSeconds:initial.duration,windows});
		console.log('SONG_COVERAGE_PASS',initial.id,
			'windows',windows.length,'dangerLevels',dangerValues.length);
		if(songNumber<3){
			const previous=initial.id;
			await page.evaluate(()=>{
				const a=window.__bbGame.registry.get('audioSynth');
				if(!a.jukeboxStep(1))throw Error('Real transport Next rejected');
			});
			await page.waitForFunction(prev=>{
				const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
				return d.track?.id!==prev&&d.pack&&d.activeNodes.size>=6;
			},previous,{timeout:45000});
		}
	}
	assert.equal(entries.length,4);
	assert.equal(new Set(entries.map(x=>x.song)).size,4);
	assert.equal(entries.reduce((n,x)=>n+x.windows.length,0),20);
	const beforeMenu=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return {id:d.track.id,clock:d.clockStart};
	});
	const menuState=await tapRead(18,0,'menu');
	const afterMenu=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return {id:d.track.id,clock:d.clockStart,voice:d._activeVoiceFor(d.pack)};
	});
	assert.equal(beforeMenu.id,afterMenu.id);
	assert.equal(afterMenu.voice,'voice:debumont');
	assert.ok(menuState.master.peak>0);
	// Seek explicitly updates clock anchors. Menu transition alone must not;
	// this audit tests that separately through the shipping scene smoke.
	assert.deepEqual(errors,[]);
	assert.deepEqual(httpErrors,[]);
	const all=entries.flatMap(s=>s.windows.flatMap(w=>w.states));
	const extremes=Object.fromEntries(dangerValues.map(danger=>{
		const rows=all.filter(x=>x.expectedDanger===danger);
		return [String(danger),{
			maxMasterPeakDbfs:Math.max(...rows.map(x=>x.master.peakDbfs)),
			minMasterRmsDbfs:Math.min(...rows.map(x=>x.master.rmsDbfs)),
			maxMusicPeakDbfs:Math.max(...rows.map(x=>x.music.peakDbfs)),
			count:rows.length,
		}];
	}));
	const acrossWindowChange=entries.flatMap(s=>s.windows.map(w=>w.nearMinusCleanRmsDb));
	const report={format:'bitstream-real-game-bsod-segment-coverage-v1',
		status:'20-sparse-windows-not-full-duration-listening-or-clipping-proof',
		origin,songs:entries.length,checkpoints:20,sampledStates:all.length,
		scope:'Music + post-compressor taps, maximum music/master sliders; no SFX/wind/vocals',
		session:{biome:'crystal-cavern',speedPxS:850,
			musicShuffle:false,dynamicOrchestra:false},
		sampling:{ticks:36,blockFrames:2048,intervalMs:25,
			settleMs:850,threeLevels:dangerValues},
		extremes,deltaRmsDb:{
			min:Math.min(...acrossWindowChange),max:Math.max(...acrossWindowChange),
		},entries,menuState};
	writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
	const digest=createHash('sha256').update(JSON.stringify(report)).digest('hex');
	console.log('TOTAL_SONG_COVERAGE_PASS',entries.length,
		'checkpoints',report.checkpoints,'states',report.sampledStates);
	console.log('SAMPLED_EXTREMES',JSON.stringify(extremes));
	console.log('SAMPLED_NEAR_MINUS_CLEAN_RMS_DB',
		JSON.stringify(report.deltaRmsDb));
	console.log('MENU_DEBUMONT_HEADROOM_PASS',
		menuState.master.peakDbfs.toFixed(2));
	console.log('EVIDENCE',dest,'OBJECT_SHA256',digest);
}finally{await browser.close();}
