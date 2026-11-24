/** Inspect the ACTUAL six-stem + vocal live game graph at full music/master
 * slider levels. Adds passive zero-output analyser taps; no gameplay code
 * edits, no source transcodes, no user profile/save mutations or audio claim.
 * Measures selected near-song-start passages only, not every mix transition.
 */
import assert from 'node:assert/strict';
import {writeFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright';

const url=process.env.GAME_URL||'http://100.115.120.66:8206/';
const path=process.env.REPORT_OUT||'/home/hermes/experiments/bitstream-bsod-full-mix-live-20261118.json';
if(existsSync(path))throw Error('Cannot overwrite a prior evidence report: '+path);
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],failedHttp=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)failedHttp.push([r.status(),r.url()]);});
const snapshot=()=>page.evaluate(()=>{
	const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
	return {song:d.track?.id,index:d.trackIndex,started:d.started,
		clockStart:d.clockStart,position:d.clockStart!=null&&d.ctx?
		d.ctx.currentTime-d.clockStart:null,
		active:d.activeNodes.size,pack:d.pack?.id,
		danger:a._bsodDanger01,
		mode:a._musicMode,audioState:a.ctx?.state};
});
async function waitReady(){
	await page.waitForFunction(()=>{
		const d=window.__bbGame?.registry?.get('audioSynth')?._stemMusic;
		return d?.started&&d?.pack&&d?.ctx?.state==='running'&&
			d.activeNodes.size>=6&&d.clockStart!==null;
	},null,{timeout:45000});
}
async function sample(songId,danger){
	const info=await page.evaluate(async({danger})=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
		if(!d.seekTo(14))throw Error('Source track seek failed');
		const payload={active:true,gapPx:danger===0?6000:80,
			wallSpeedPxS:420,worldTailwindPxS:850,
			sledVelocityXPxS:850,relativeAirX:0,proximity01:danger,
			timeToImpactMs:danger===0?null:200,atmosphereDensity:1};
		g.events.emit('bb:bsodStateChanged',payload);
		return {songId:d.track.id,started:d.started};
	},{danger});
	assert.equal(info.songId,songId);
	await waitReady();
	await page.waitForTimeout(850); // time for both WebAudio smoothing and segment fetch
	return page.evaluate(async({danger})=>{
		const a=window.__bbGame.registry.get('audioSynth');
		const c=a.ctx,targets={music:a.nodes.musicBus,master:a.nodes.comp};
		const captures={};
		const inputs=[];
		for(const [name,source] of Object.entries(targets)){
			const analyser=c.createAnalyser();
			analyser.fftSize=2048;analyser.smoothingTimeConstant=0;
			const sink=c.createGain();sink.gain.value=0;
			source.connect(analyser);
			analyser.connect(sink);sink.connect(c.destination);
			inputs.push({source,analyser,sink});
			captures[name]={sumSquares:0,n:0,peak:0};
		}
		try{
			const length=2048;
			const series=new Map(inputs.map(({analyser})=>
				[analyser,new Float32Array(length)]));
			for(let tick=0;tick<48;tick++){
				for(const [name,input] of Object.entries(targets)){
					const target=inputs.find(x=>x.source===input);
					const buffer=series.get(target.analyser);
					target.analyser.getFloatTimeDomainData(buffer);
					for(const sample of buffer){
						const measure=captures[name];
						measure.sumSquares+=sample*sample;
						measure.peak=Math.max(measure.peak,Math.abs(sample));
						measure.n++;
					}
				}
				await new Promise(resolve=>setTimeout(resolve,25));
			}
			const result={danger,position:a._stemMusic.ctx.currentTime-a._stemMusic.clockStart};
			for(const [name,capture] of Object.entries(captures)){
				const rms=Math.sqrt(capture.sumSquares/capture.n);
				result[name]={peak:capture.peak,rms,
					peakDbfs:20*Math.log10(Math.max(capture.peak,1e-12)),
					rmsDbfs:20*Math.log10(Math.max(rms,1e-12)),
					samples:capture.n};
			}
			return result;
		}finally{
			for(const {source,analyser,sink} of inputs){
				try{source.disconnect(analyser)}catch{}
				try{analyser.disconnect()}catch{}
				try{sink.disconnect()}catch{}
			}
		}
	},{danger});
}
try{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),
		null,{timeout:30000});
	await page.keyboard.press('x');
	await waitReady();
	await page.evaluate(()=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth');
		const changed={...g.registry.get('settings'),
			masterVolume:1,musicVolume:1,sfxVolume:0,
			windVolume:0,windEnabled:false,
			musicVocals:false,dynamicOrchestra:false,
			musicShuffle:false};
		g.registry.set('settings',changed);
		g.events.emit('bb:settingsChanged',{settings:changed,
			key:'musicVolume',value:1});
		g.events.emit('bb:runStart',{seed:'mixed-program-audit'});
		g.events.emit('bb:biomeEnter',{id:'crystal-cavern'});
		a.setSpeed(850);
		a.setAirborne(false);
	});
	const entries=[];
	for(let i=0;i<4;i++){
		await waitReady();
		const initial=await snapshot();
		const clean=await sample(initial.song,0);
		const dangerous=await sample(initial.song,.97);
		entries.push({song:initial.song,clean,dangerous});
		console.log('MIXED_MUSIC_LEVELS',initial.song,
			'clean_peak',clean.music.peakDbfs.toFixed(2),
			'threat_peak',dangerous.music.peakDbfs.toFixed(2),
			'clean_master_peak',clean.master.peakDbfs.toFixed(2),
			'threat_master_peak',dangerous.master.peakDbfs.toFixed(2));
		if(i<3){
			const previous=initial.song;
			await page.evaluate(()=>{
				const a=window.__bbGame.registry.get('audioSynth');
				if(!a.jukeboxStep(1))throw Error('Real game transport rejected next');
			});
			await page.waitForFunction(prev=>{
				const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
				return d.track?.id!==prev&&!!d.pack&&d.activeNodes.size>=6;
			},previous,{timeout:40000});
		}
	}
	assert.equal(entries.length,4);
	assert.equal(new Set(entries.map(x=>x.song)).size,4);
	// Return to actual menu presentation without resetting the last song.
	await page.evaluate(()=>window.__bbGame.events.emit('bb:runEnd',{cause:'mix-audit-end'}));
	const menuState=await snapshot();
	assert.equal(menuState.mode,'menu');
	const menuSample=await sample(menuState.song,0);
	assert.ok(menuSample.music.peak>0&&menuSample.master.peak>0);
	assert.ok(menuSample.master.peak<=1.0);
	console.log('DEBUTMONT_MENU_MIX_PEAK_DBFS',menuSample.master.peakDbfs.toFixed(2));
	assert.deepEqual(errors,[]);assert.deepEqual(failedHttp,[]);
	const report={format:'bitstream-real-web-audio-master-sampled-headroom-v1',
		status:'sampling-only-not-full-mix-peak-proof-or-sonic-approval',
		gameOrigin:url,sliders:{masterVolume:1,musicVolume:1,sfxVolume:0,
			windVolume:0,windEnabled:false},
		sample:{perStateSamples:48*2048,intervalMs:25,seekSeconds:14},
		entries,menuSample};
	writeFileSync(path,JSON.stringify(report,null,2)+'\n');
	for(const x of entries){
		assert.ok(x.clean.music.peak>0&&x.clean.master.peak>0&&
			x.dangerous.music.peak>0&&x.dangerous.master.peak>0,
			'Missing actual live WebAudio signal: '+x.song);
		assert.ok(x.clean.master.peak<=1.0,
			'Measured clean master output clipped: '+x.song);
		assert.ok(x.dangerous.master.peak<=1.0,
			'Measured master output clipped during near-danger '+x.song);
	}
	console.log('SAMPLED_FOUR_SONGS_FULL_STEM_MIX_HEADROOM_PASS',
		entries.length,'results',path);
}finally{await browser.close()}
