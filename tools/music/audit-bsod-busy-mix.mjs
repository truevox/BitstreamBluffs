/**
 * Real-game busy-mix, sound-on stress audit. It uses a fresh Chromium profile,
 * the shipped music director, authoritative BSOD event, real source vocals
 * (test-only entitlement bypass), environmental wind, and actual SFX player.
 * The only graph additions are zero-output analyser taps. No source edits.
 * This samples selected passages, not every frame of every complete song.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { PEAK_MAX } from '../../src/systems/music/MasterPeakGuard.js';

const origin=process.env.GAME_URL||'http://100.115.120.66:8206/';
const dest=process.env.REPORT_OUT||
	'/home/hermes/experiments/bitstream-bsod-busy-mix-20261118.json';
if(existsSync(dest))throw Error('Immutable report path exists: '+dest);
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
]});
const page=await browser.newPage({viewport:{width:1200,height:780}});
const pageErrors=[],badHttp=[];
page.on('pageerror',e=>pageErrors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)badHttp.push([r.status(),r.url()])});
const sha=buf=>createHash('sha256').update(buf).digest('hex');
// Hard-bind every report to the exact production JS/HTML bytes actually
// served, rather than trusting source-checkout hashes or a guessed commit.
async function verifyServedBuild(){
	const localHtml=readFileSync(new URL('../../dist/index.html',import.meta.url));
	const htmlResponse=await page.request.get(origin);
	assert.equal(htmlResponse.status(),200,'QA origin did not serve index');
	const remoteHtml=await htmlResponse.body();
	assert.equal(sha(remoteHtml),sha(localHtml),'Served HTML differs from local build');
	const asset=/\bsrc=["'](\/assets\/[^"']+\.js)["']/.exec(localHtml.toString('utf8'))?.[1];
	assert.ok(asset,'No built entry JS found in local index');
	const localJs=readFileSync(new URL('../../dist'+asset,import.meta.url));
	const jsResponse=await page.request.get(new URL(asset,origin).href);
	assert.equal(jsResponse.status(),200,'QA entry module unavailable');
	const remoteJs=await jsResponse.body();
	assert.equal(sha(remoteJs),sha(localJs),'Served JavaScript differs from local build');
	return {servedOrigin:origin,script:asset,htmlSha256:sha(remoteHtml),
		entryJsSha256:sha(remoteJs),entryBytes:remoteJs.length};
}
const waitReady=()=>page.waitForFunction(()=>{
	const a=window.__bbGame?.registry?.get('audioSynth'),d=a?._stemMusic;
	return d?.started&&d.pack&&d.activeNodes.size>=6&&
		d.clockStart!==null&&d.ctx?.state==='running';
},null,{timeout:45000});
function assertPeak(sample,label){
	for(const key of ['music','wind','sfx','master','masterL','masterR']){
		const x=sample[key];
		assert.ok(Number.isFinite(x.rms)&&Number.isFinite(x.peak),
			label+' non-finite signal '+key);
		// Internal sum buses may legitimately exceed unity before the master
		// compressor. We record (rather than mask) post-master overshoots.
	}
	for(const key of ['master','masterL','masterR'])
		assert.ok(sample[key].peak<=PEAK_MAX+2e-4,
			label+' '+key+' exceeded final sample ceiling '+sample[key].peak);
	assert.ok(sample.master.rms>1e-6, label+' suspiciously silent master');
}
async function measure(position,mode){
	const p=await page.evaluate(({position,mode})=>{
		const game=window.__bbGame, a=game.registry.get('audioSynth');
		const d=a._stemMusic;
		if(!d.seekTo(position))throw Error('Seek refused '+position);
		// Music director reapplies entitlement settings on a new track.
		// Re-enable the vocals bus only inside this disposable QA browser.
		d.setVocals(true);
		const busy=mode==='busy';
		const g=game.events;
		g.emit('bb:bsodStateChanged',{
			active:true,gapPx:busy?50:5000,wallSpeedPxS:400,
			worldTailwindPxS:busy?1250:850,sledVelocityXPxS:busy?250:850,
			relativeAirX:busy?1000:0,proximity01:busy?.97:0,
			timeToImpactMs:busy?100:null,atmosphereDensity:1});
		a.setSpeed(busy?1100:650);
		a.setAirborne(busy);
		d.setCombo(busy?5:1);
		return {song:d.track.id,mode:a._musicMode,sourcePosition:position,
			clockAnchor:d.clockStart};
	},{position,mode});
	await waitReady();
	await page.waitForTimeout(900);
	const observed=await page.evaluate(async({mode,ceiling})=>{
		const a=window.__bbGame.registry.get('audioSynth');
		const d=a._stemMusic,c=a.ctx;
		const taps=[];
		for(const [name,source] of Object.entries({
			music:a.nodes.musicBus,wind:a.nodes.windGain,
			sfx:a.nodes.sfxBus,preGuard:a.nodes.comp,
			softGuard:a.nodes.peakGuard,
			master:a.nodes.finalSampleCeiling || a.nodes.peakGuard || a.nodes.comp,
		})){
			const analyser=c.createAnalyser();
			analyser.fftSize=2048;analyser.smoothingTimeConstant=0;
			const sink=c.createGain();sink.gain.value=0;
			source.connect(analyser);analyser.connect(sink);sink.connect(c.destination);
			taps.push({name,source,analyser,sink,arr:new Float32Array(2048)});
		}
		// Default AnalyserNode downmixes stereo; protect against a hot L/R
		// channel being concealed by opposite-polarity stereo cancellation.
		const stageOutputs=[['master',a.nodes.finalSampleCeiling],
			['soft',a.nodes.peakGuard]];
		if(stageOutputs.some(([,source])=>!source))
			throw Error('Missing final safety stage');
		const splitters=[];
		for(const [prefix,source] of stageOutputs){
			const splitter=c.createChannelSplitter(2);
			source.connect(splitter);splitters.push({source,splitter});
			for(let channel=0;channel<2;channel++){
				const analyser=c.createAnalyser();
				analyser.fftSize=2048;analyser.smoothingTimeConstant=0;
				const sink=c.createGain();sink.gain.value=0;
				splitter.connect(analyser,channel,0);
				analyser.connect(sink);sink.connect(c.destination);
				taps.push({name:prefix+(channel?'R':'L'),
					source:splitter,analyser,sink,arr:new Float32Array(2048)});
			}
		}
		try{
			const stats=Object.fromEntries(taps.map(t=>
				[t.name,{peak:0,energy:0,n:0,overCeilingSamples:0}]));
			const sfx=['hop','trick','nearMiss','landPerfect','boost','landHard'];
			for(let t=0;t<44;t++){
				if(mode==='busy'&&t%8===0)
					a.playSfx(sfx[Math.floor(t/8)%sfx.length],{intensity:.9});
				for(const tap of taps){
					tap.analyser.getFloatTimeDomainData(tap.arr);
					const st=stats[tap.name];
					for(const v of tap.arr){
						st.peak=Math.max(st.peak,Math.abs(v));st.energy+=v*v;st.n++;
						if(Math.abs(v)>ceiling+2e-4)st.overCeilingSamples++;
					}
				}
				await new Promise(r=>setTimeout(r,25));
			}
			const levels={};
			for(const [name,st] of Object.entries(stats)){
				const rms=Math.sqrt(st.energy/st.n);
				levels[name]={peak:st.peak,rms,
					peakDbfs:20*Math.log10(Math.max(st.peak,1e-12)),
					rmsDbfs:20*Math.log10(Math.max(rms,1e-12)),
					sampledFrames:st.n,overCeilingSamples:st.overCeilingSamples,
					aboveCeilingFraction:st.overCeilingSamples/st.n};
			}
			return {song:d.track.id,mode:a._musicMode,danger:a._bsodDanger01,
				relativeAir:a._windRelativePxS,windGain:a.nodes.windGain.gain.value,
				vocalsEnabled:d.vocals,menu:d.menuMode,
				positionEnd:c.currentTime-d.clockStart,
				...levels};
		}finally{
			for(const t of taps){
				try{t.source.disconnect(t.analyser)}catch{}
				try{t.analyser.disconnect()}catch{}
				try{t.sink.disconnect()}catch{}
			}
			for(const {source,splitter} of splitters){
				try{source.disconnect(splitter)}catch{}
				try{splitter.disconnect()}catch{}
			}
		}
	},{mode,ceiling:PEAK_MAX});
	assert.equal(p.song,observed.song);
	assertPeak(observed,p.song+'/'+position+'/'+mode);
	return {...p,...observed};
}
try{
	const servedBuild=await verifyServedBuild();
	await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene
		?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:35000});
	await page.keyboard.press('x');
	await waitReady();
	const browserInfo={version:browser.version(),
		audioSampleRate:await page.evaluate(()=>window.__bbGame.registry.get('audioSynth').ctx.sampleRate)};
	const init=await page.evaluate(()=>{
		const g=window.__bbGame, a=g.registry.get('audioSynth'),d=a._stemMusic;
		// Fresh, non-persistent browser only. This DIRECTLY enables the existing
		// vocals bus for QA; it does NOT grant an account's paid shard unlock.
		const settings={...g.registry.get('settings'),
			masterVolume:1,musicVolume:1,sfxVolume:1,windVolume:1,
			windEnabled:true,dynamicOrchestra:false,musicShuffle:false};
		a.applySettings(settings);
		d.setVocals(true);
		g.events.emit('bb:runStart',{seed:'busy-mix-qa'});
		g.events.emit('bb:biomeEnter',{id:'crystal-cavern'});
		return {initialSong:d.track.id,vocalsEnabled:d.vocals,
			stems:d._wantedNames(d.pack),
			sfxVolume:a.settings.sfxVolume,windVolume:a.settings.windVolume};
	});
	assert.equal(init.vocalsEnabled,true);
	assert.ok(init.stems.includes('vocals'));
	const entries=[];
	for(let i=0;i<4;i++){
		await waitReady();
		const info=await page.evaluate(()=>{
			const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
			const s=d.pack.segments,count=s.length;
			const indices=[0,Math.floor(count/2),count-1];
			return {song:d.track.id,positions:indices.map(index=>{
				const seg=s[index],at=(seg.startFrame+seg.frames*.45)/d.pack.sampleRate;
				return {index,seconds:Math.round(at*1000)/1000};
			})};
		});
		const windows=[];
		for(const {index,seconds} of info.positions){
			const normal=await measure(seconds,'normal');
			const busy=await measure(seconds,'busy');
			assert.equal(busy.danger,.97);
			assert.equal(busy.relativeAir,1000);
			assert.equal(busy.vocalsEnabled,true);
			assert.ok(busy.wind.rms>1e-6,'Missing wind audio '+info.song);
			assert.ok(busy.sfx.rms>1e-6,'Missing SFX audio '+info.song);
			assert.ok(busy.masterL.rms>1e-6&&busy.masterR.rms>1e-6,
				'Missing one stereo output channel '+info.song);
			const x={index,seconds,normal,busy};
			windows.push(x);
			console.log('STRESS_WINDOW_PASS',info.song,'seg',index,
				'normalPeak',normal.master.peakDbfs.toFixed(2),
				'busyPeak',busy.master.peakDbfs.toFixed(2),
				'sfxPeak',busy.sfx.peakDbfs.toFixed(2));
		}
		entries.push({song:info.song,windows});
		if(i<3){
			const prev=info.song;
			await page.evaluate(()=>{
				const a=window.__bbGame.registry.get('audioSynth');
				if(!a.jukeboxStep(1))throw Error('Next track refused');
			});
			await page.waitForFunction(prev=>{
				const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
				return d.track?.id!==prev&&d.pack&&d.activeNodes.size>=6;
			},prev,{timeout:45000});
		}
	}
	// A crash plays crash SFX, resets wind/threat, and keeps the current song.
	const before=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return {song:d.track.id,clock:d.clockStart};
	});
	await page.evaluate(()=>{
		const game=window.__bbGame;
		game.events.emit('bb:runEnd',{cause:'crash'});
		game.events.emit('bb:crash',{cause:'bsod'});
	});
	await page.waitForTimeout(1000);
	const after=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
		return {song:d.track.id,clock:d.clockStart,
			menu:d.menuMode,voice:d._activeVoiceFor(d.pack),
			danger:a._bsodDanger01,windGain:a.nodes.windGain.gain.value,
			vocals:d.vocals};
	});
	assert.equal(after.song,before.song);
	assert.equal(after.clock,before.clock);
	assert.equal(after.voice,'voice:debumont');
	assert.equal(after.menu,true);
	assert.equal(after.danger,0);
	assert.ok(after.windGain<.001);
	assert.deepEqual(pageErrors,[]);
	assert.deepEqual(badHttp,[]);
	const all=entries.flatMap(e=>e.windows);
	const max=(key,mode)=>Math.max(...all.map(x=>x[mode][key].peakDbfs));
	const clipCases=all.flatMap(row=>['normal','busy'].flatMap(mode=>
		['master','masterL','masterR'].flatMap(channel=>
			(!Number.isFinite(row[mode][channel].peak)||row[mode][channel].peak>PEAK_MAX+2e-4)?[{song:row.busy.song,position:row.seconds,
				mode,channel,masterPeak:row[mode][channel].peak,
				peakDbfs:row[mode][channel].peakDbfs}]:[])));
	const report={format:'bitstream-busy-live-stereo-mix-v2',
		status:'twelve-sampled-passages-with-vocals-wind-sfx-not-full-song-proof',
		baseCommit:'cd38ad14552725f1558ca24f1ea23ec48f50bd98',
		servedBuild,browserInfo,
		sourceSha256:Object.fromEntries([
			['AudioSynth.js','../../src/systems/AudioSynth.js'],
			['MasterPeakGuard.js','../../src/systems/music/MasterPeakGuard.js'],
		].map(([name,relative])=>[name,createHash('sha256')
			.update(readFileSync(new URL(relative,import.meta.url))).digest('hex')])),
		origin,settings:{master:1,music:1,sfx:1,wind:1,
			dynamicOrchestra:false,vocalsDirectTestEnable:true},
		stressEvents:'real playSfx (hop,trick,nearMiss,landPerfect,boost,landHard) every 8 ticks',
		counts:{songs:4,positions:all.length,states:all.length*2},
		clipCases,clipStatus:clipCases.length?'FAIL':'PASS',
		extremes:{normalMasterPeakDbfs:max('master','normal'),
			busyMasterPeakDbfs:max('master','busy'),
			busyWindPeakDbfs:max('wind','busy'),
			busySfxPeakDbfs:max('sfx','busy'),
			busyPreGuardPeakDbfs:max('preGuard','busy'),
			busySoftGuardPeakDbfs:max('softGuard','busy'),
			busyLeftPeakDbfs:max('masterL','busy'),
			busyRightPeakDbfs:max('masterR','busy'),
			busySoftLeftPeakDbfs:max('softL','busy'),
			busySoftRightPeakDbfs:max('softR','busy')},
		guardActivity:{statesWithSoftOverCeiling:all.filter(row=>
			['normal','busy'].some(mode=>row[mode].softL.overCeilingSamples>0||
				row[mode].softR.overCeilingSamples>0)).length,
			maxSoftFraction:Math.max(...all.flatMap(row=>['normal','busy'].flatMap(mode=>
				[row[mode].softL.aboveCeilingFraction,row[mode].softR.aboveCeilingFraction]))),
			maxFinalFraction:Math.max(...all.flatMap(row=>['normal','busy'].flatMap(mode=>
				[row[mode].masterL.aboveCeilingFraction,row[mode].masterR.aboveCeilingFraction])))},
		afterCrash:after,entries};
	writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
	console.log('BUSY_MIX_SCENARIOS_COMPLETE',JSON.stringify(report.extremes));
	console.log('POST_COMPRESSOR_CLIPPING',JSON.stringify(clipCases));
	console.log('CRASH_RESET_AND_SONG_CLOCK_PASS',JSON.stringify(after));
	console.log('REPORT_SHA256',createHash('sha256')
		.update(JSON.stringify(report)).digest('hex'));
	assert.equal(clipCases.length,0,'Final-stereo samples exceeded bounded ceiling');
}finally{await browser.close();}
