import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const url=process.env.GAME_URL||'http://100.115.120.66:8188/';
const browser=await chromium.launch({headless:true,
	args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
		'--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],failed=[],audio=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{
	if(r.status()>=400)failed.push([r.status(),r.url()]);
	if(r.url().endsWith('.ogg'))audio.push(r.url());
});
try {
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>{
		const g=window.__bbGame;
		return g?.registry?.get('audioSynth')&&
			g.scene.getScene('TitleScene')?.sys?.isActive();
	},null,{timeout:35000});
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;
		return d?.ready&&d.catalog.length===4;
	},null,{timeout:20000});
	const setup=await page.evaluate(()=>{
		const g=window.__bbGame;
		const title=g.scene.getScene('TitleScene');
		title.menu.items.find(i=>i.label==='SETTINGS').onSelect();
		const view=title.view;
		const option=view.menu.items.find(i=>i.label==='DYNAMIC ORCHESTRA');
		const all=view.menu.items.filter(i=>i.label.startsWith('▶ '));
		const rowIndex=view.menu.items.indexOf(option);
		const badge=view.menu.rows[rowIndex]?.badge;
		return {dynamicPresent:!!option,dynamicDefault:option?.get(),
			badgeText:badge?.main?.text,badgeVisible:!!badge?.visible,
			badgeWithinRow:(view.menu.rows[rowIndex]?.badgeBox?.x +
				view.menu.rows[rowIndex]?.badgeBox?.w) < view.menu.w-62,
			fourSongs:all.length,rows:view.menu.items.length,
			fits:22+(view.menu.items.length-1)*16+16 <view.h-22};
	});
	assert.deepEqual(setup,{dynamicPresent:true,dynamicDefault:false,
		badgeText:'PRE-ALPHA',badgeVisible:true,badgeWithinRow:true,
		fourSongs:4,rows:12,fits:true});
	console.log('DYNAMIC_SETTINGS_VISIBLE_DEFAULT_OFF_PASS',setup);
	await page.evaluate(()=>{
		const g=window.__bbGame;
		g.scene.getScene('TitleScene')._closeView();
		window.__trackEvents=[];
		g.events.on('bb:musicTrackChanged',e=>window.__trackEvents.push(e));
	});
	await page.keyboard.press('x');
	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('true-orchestra-test'));
	await page.waitForFunction(()=>{
		const g=window.__bbGame;
		const d=g.registry?.get('audioSynth')?._stemMusic;
		return d?.pack&&d.activeNodes.size>=7;
	},null,{timeout:40000});
	const initial=await page.evaluate(()=>{
		const g=window.__bbGame;const d=g.registry.get('audioSynth')._stemMusic;
		const ui=g.scene.getScene('UIScene');
		return {song:d.track?.title,duration:d.pack?.duration,
			sourceNames:d.pack?.sourceNames.length,homeVoices:d.pack?.sourceNames.filter(n=>n.startsWith('voice:')).length,
			roles:Object.keys(d.pack.adaptive?.variants||{}),
			enabled:d.dynamicOrchestra,active:d.activeNodes.size,
			nowPlaying:ui.stripT?.main?.text,events:window.__trackEvents.length};
	});
	assert.equal(initial.enabled,false);
	assert.equal(initial.sourceNames,18);
	assert.equal(initial.homeVoices,12);
	assert.deepEqual(initial.roles.sort(),['bass','drums','featured','guitar','other','piano']);
	assert.ok(initial.duration>150);
	assert.ok(initial.events>=1);
	assert.ok(initial.nowPlaying?.includes('NOW PLAYING'));
	console.log('FOUR_SONGS_SOURCE_AND_12_REAL_BIOME_VOICES_PASS',initial);
	const off=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		d.setBiome('crystal-cavern');
		d.setSpeed(0);
		d.setAirborne(true);
		const mixer=d.mixer;
		return {clock:d.clockStart,enabled:d.dynamicOrchestra,
			replacementCurrent:[...d.adaptive.channels.values()].some(c=>!!c.current),
			bassMotion:mixer.sources.get('bass').motion.gain.value,
			drumsMotion:mixer.sources.get('drums').motion.gain.value,
			voice:d._activeVoiceFor(d.pack),
			originalEffects:Object.fromEntries(['guitar','piano','other','bass','drums']
				.map(n=>[n,mixer.sources.get(n).chain.stages.map(stage=>stage.id)])),
			originalRoomSends:Object.fromEntries(['guitar','piano','other','bass','drums']
				.map(n=>[n,mixer.sources.get(n).send.gain.value]))};
	});
	assert.equal(off.enabled,false);
	assert.equal(off.replacementCurrent,false);
	assert.equal(off.voice,'voice:crystal-cavern');
	for(const [stem,effects] of Object.entries(off.originalEffects)) {
		assert.ok(effects.length>0,'OFF bypassed source '+stem+' processing');
	}
	for(const stem of ['guitar','piano','other']) {
		assert.ok(off.originalRoomSends[stem]>0,'OFF muted source '+stem+' room bus');
	}
	console.log('DYNAMIC_OFF_SOURCE_INSTRUMENTS_STILL_PROCESSED_PASS',off);
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return [...d.activeNodes].length>=7&&d.cache.has('0/voice:crystal-cavern');
	},null,{timeout:30000});
	// Toggle as the real Settings event handler does; don't reset song.
	await page.evaluate(()=>{
		const g=window.__bbGame;const settings=g.registry.get('settings');
		settings.dynamicOrchestra=true;
		g.events.emit('bb:settingsChanged',{key:'dynamicOrchestra',
			value:true,settings});
	});
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		// Pope featured=Other; Guitar and Piano use independent source
		// resynthesis. Drum alternatives only become active in midair.
		return d.dynamicOrchestra&&
			['featured','bass','drums','guitar','piano'].every(
				role=>d.adaptive.channels.get(role)?.current?.live);
	},null,{timeout:35000});
	const on=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return {clock:d.clockStart,
			roles:Object.fromEntries(['featured','bass','drums','guitar','piano'].map(role=>[
				role,{biome:d.adaptive.channels.get(role)?.current?.biome,
					events:d.adaptive.channels.get(role)?.current?.scheduled?.size}])),
			originalMix:Object.fromEntries(['guitar','piano','other','bass','drums'].map(n=>[
				n,d.mixer.sources.get(n).mix.gain.value])),
			originalEffects:Object.fromEntries(['guitar','piano','other','bass','drums']
				.map(n=>[n,d.mixer.sources.get(n).chain.stages.map(stage=>stage.id)])),
		};
	});
	assert.equal(on.clock,off.clock,'Music clock changed when toggling ON');
	assert.deepEqual(on.originalEffects,off.originalEffects,
		'Toggling ON unexpectedly rebuilt or disabled original audio DSP');
	for (const role of ['featured','bass','drums','guitar','piano']) {
		assert.equal(on.roles[role].biome,'crystal-cavern');
		assert.ok(on.roles[role].events>=1);
	}
	console.log('TRUE_NEW_REPERFORMED_MOUNTAIN_AUDIO_ACTIVE_PASS',on);
	await page.evaluate(()=>{
		const g=window.__bbGame;const settings=g.registry.get('settings');
		settings.dynamicOrchestra=false;
		g.events.emit('bb:settingsChanged',{key:'dynamicOrchestra',
			value:false,settings});
	});
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return !d.dynamicOrchestra&&
			['featured','bass','drums','guitar','piano','other'].every(
				role=>!d.adaptive.channels.get(role)?.current);
	},null,{timeout:15000});
	const back=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return {clock:d.clockStart,
			sourceCount:d.activeNodes.size,
			originalEffects:Object.fromEntries(['guitar','piano','other','bass','drums']
				.map(n=>[n,d.mixer.sources.get(n).chain.stages.map(stage=>stage.id)])),
			originalRoomSends:Object.fromEntries(['guitar','piano','other','bass','drums']
				.map(n=>[n,d.mixer.sources.get(n).send.gain.value]))};
	});
	assert.equal(back.clock,off.clock,'Toggling OFF rewound soundtrack');
	assert.deepEqual(back.originalEffects,off.originalEffects,
		'OFF changed processing rather than only restoring original source recordings');
	for(const stem of ['guitar','piano','other']) {
		assert.ok(back.originalRoomSends[stem]>0,
			'Original '+stem+' room send was lost by toggling OFF');
	}
	console.log('DYNAMIC_OFF_RESTORES_PROCESSED_ORIGINALS_WITHOUT_REWIND_PASS',back);
	// ALL four off ALWAYS means absolute silence, regardless of dynamic.
	await page.evaluate(()=>{
		const g=window.__bbGame;const s=g.registry.get('settings');
		s.musicEnabledSongs=Object.fromEntries(Object.keys(s.musicEnabledSongs).map(k=>[k,false]));
		g.events.emit('bb:settingsChanged',{key:'musicEnabledSongs',
			value:s.musicEnabledSongs,settings:s});
	});
	const quiet=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth');
		return {playing:a._stemMusic.started,legacySynth:a._musicTimer!==null,
			sfxAvailable:!!a.nodes?.sfxBus};
	});
	assert.deepEqual(quiet,{playing:false,legacySynth:false,sfxAvailable:true});
	assert.equal(errors.length,0,'JavaScript: '+errors.join('; '));
	assert.equal(failed.length,0,'HTTP: '+JSON.stringify(failed.slice(0,10)));
	console.log('TRUE_FULL_DYNAMIC_ORCHESTRA_BROWSER_PASS',JSON.stringify({
		sourceCount:455,alternativeFiles:4290,audioRequests:audio.length,
		alternateRequests:audio.filter(n=>n.includes('/adaptive/')).length,
		silenceRule:quiet,errors,failed,
	}));
} finally {
	await browser.close();
}
