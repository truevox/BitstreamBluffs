/** Actual Chromium: independent BSOD musical danger and relative airflow.
 * No fake chase simulation; emit the authoritative gameplay event contract.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://100.115.120.66:8202/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox',
	'--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],http=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)http.push([r.status(),r.url()]);});
const state=()=>page.evaluate(()=>{
	const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
	const stem=id=>{
		const s=d.mixer?.sources.get(id);
		return {threat:!!s?.threat,level:s?.threat?.danger??null,
			dry:s?.threat?.dry.gain.value??null,
			wet:s?.threat?.wet.gain.value??null,
			cutoff:s?.threat?.filter.frequency.value??null,
			tremoloDepth:s?.threat?.mod.gain.value??null};
	};
	return {song:d.track?.id,clock:d.clockStart,mode:a._musicMode,
		menu:d.menuMode,voice:d._activeVoiceFor(d.pack),
		danger:a._bsodDanger01,wind:a.nodes?.windGain?.gain.value,
		guitar:stem('guitar'),piano:stem('piano'),other:stem('other'),
		bass:stem('bass'),drums:stem('drums'),
		melody:stem('voice:debumont'),audio:d.ctx?.state};
});
try{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
	await page.keyboard.press('x');
	await page.waitForFunction(()=>{
		const d=window.__bbGame?.registry?.get('audioSynth')?._stemMusic;
		return d?.started&&d?.pack&&d?.clockStart!=null&&d.activeNodes.size>=6;
	},null,{timeout:45000});
	const menu=await state();
	assert.equal(menu.song,'local-one-more-run-bitstream-bluffs');
	assert.equal(menu.menu,true);
	assert.equal(menu.voice,'voice:debumont');
	for(const name of ['guitar','piano','other']){
		assert.equal(menu[name].threat,true);
		assert.equal(menu[name].wet,0);
	}
	for(const name of ['bass','drums','melody'])
		assert.equal(menu[name].threat,false);
	console.log('MENU_CLEAN_MUSIC_ONLY_THREAT_BUSES_PRESENT_PASS',JSON.stringify(menu));
	await page.evaluate(()=>{
		const g=window.__bbGame;
		g.events.emit('bb:runStart',{seed:'bsod-music-preview'});
		g.events.emit('bb:biomeEnter',{id:'crystal-cavern'});
		g.events.emit('bb:bsodStateChanged',{
			active:true,gapPx:70,wallSpeedPxS:440,
			worldTailwindPxS:850,sledVelocityXPxS:850,relativeAirX:0,
			proximity01:.97,timeToImpactMs:160,atmosphereDensity:1});
	});
	await page.waitForFunction(()=>{
		const d=window.__bbGame?.registry?.get("audioSynth")?._stemMusic;
		return ["guitar","piano","other"].every(id=>
			d?.mixer?.sources?.get(id)?.threat?.filter?.frequency?.value<3500);
	},null,{timeout:5000}); // Real AudioParams smooth asynchronously; do not assume a fixed wall clock.
	const dangerous=await state();
	console.log("DANGEROUS_WEB_AUDIO_READBACK",JSON.stringify(dangerous));
	assert.equal(dangerous.song,menu.song);
	assert.equal(dangerous.clock,menu.clock);
	assert.equal(dangerous.menu,false);
	assert.equal(dangerous.voice,'voice:crystal-cavern');
	assert.equal(dangerous.danger,.97);
	assert.ok(dangerous.wind<.01);
	for(const name of ['guitar','piano','other']){
		assert.ok(dangerous[name].wet>.6,name+' not corrupted');
		assert.ok(dangerous[name].dry<.4,name+' remained dry');
		assert.ok(dangerous[name].cutoff<3500,name+' filter not dark');
	}
	assert.equal(dangerous.bass.threat,false);
	assert.equal(dangerous.drums.threat,false);
	console.log('CLOSE_BSOD_QUIET_WIND_CORRUPTED_ORIGINAL_ACCOMPANIMENT_PASS',
		{danger:dangerous.danger,wind:dangerous.wind,
			guitar:dangerous.guitar,piano:dangerous.piano,other:dangerous.other});
	await page.evaluate(()=>{
		const g=window.__bbGame;
		g.events.emit('bb:bsodStateChanged',{
			active:true,gapPx:9000,wallSpeedPxS:440,
			worldTailwindPxS:1200,sledVelocityXPxS:200,relativeAirX:1000,
			proximity01:0,timeToImpactMs:null,atmosphereDensity:1});
	});
	await page.waitForTimeout(850);
	const escaped=await state();
	console.log('ESCAPE_SMOOTHING_DETAILS',JSON.stringify(escaped));
	assert.equal(escaped.danger,0);
	assert.ok(escaped.wind>.06);
	for(const name of ['guitar','piano','other']){
		assert.ok(escaped[name].wet<.02);
		assert.ok(escaped[name].dry>.98);
	}
	console.log('ESCAPE_RESTORES_CLEAN_MUSIC_AND_LOUD_RELATIVE_WIND_PASS');
	await page.evaluate(()=>{
		const g=window.__bbGame;
		g.events.emit('bb:bsodStateChanged',{
			active:true,gapPx:80,wallSpeedPxS:400,
			worldTailwindPxS:0,sledVelocityXPxS:0,relativeAirX:0,
			proximity01:.95,timeToImpactMs:200,atmosphereDensity:0});
	});
	await page.waitForTimeout(850);
	const vacuum=await state();
	assert.ok(vacuum.wind<.01);
	assert.ok(vacuum.guitar.wet>.6);
	console.log('VACUUM_NO_WIND_BUT_BSOD_DANGER_MUSIC_THREAT_PASS');
	await page.evaluate(()=>window.__bbGame.events.emit('bb:runEnd',{cause:'crash'}));
	// Chrome AudioParam setTargetAtTime is an exponential *approach*, not an
	// instantaneous switch. Wait for the real wet/dry audio parameters to
	// converge rather than assuming a fixed 570ms under shared CI load.
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return ['guitar','piano','other'].every(name=>{
			const p=d.mixer?.sources.get(name)?.threat;
			return p&&p.dry.gain.value>.98&&p.wet.gain.value<.02;
		});
	},null,{timeout:7000});
	const after=await state();
	assert.equal(after.clock,menu.clock);
	assert.equal(after.song,menu.song);
	assert.equal(after.menu,true);
	assert.equal(after.voice,'voice:debumont');
	assert.equal(after.danger,0);
	assert.ok(after.wind<.01);
	for(const name of ['guitar','piano','other']){
		assert.ok(after[name].dry>.98);
		assert.ok(after[name].wet<.02);
	}
	console.log('CRASH_KEEPS_SONG_CLOCK_AND_RESTORES_UNCORRUPTED_MENU_PASS',
		{song:after.song,clock:after.clock,voice:after.voice});
	assert.deepEqual(errors,[]);
	assert.deepEqual(http,[]);
	console.log('REAL_CHROMIUM_MUSIC_ONLY_BSOD_DANGER_DSP_GATE_PASS');
}finally{await browser.close();}
