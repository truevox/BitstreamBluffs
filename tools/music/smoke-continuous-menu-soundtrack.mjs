/** Actual Chromium: first-song autoplay intent, WebAudio, menu/run continuity,
 * persisted shuffle, and unchanged Music Lab navigation entry.
 * Test ONLY on an isolated preview build, never an active public deployment.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url=process.env.GAME_URL || 'http://100.115.120.66:8197/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
	'--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],http=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)http.push([r.status(),r.url()]);});

const state=()=>page.evaluate(()=>{
	const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
	return {mode:a._musicMode,requested:a._musicWanted,
		autoplayAttempt:a._autoStartAttempted,
		id:d.catalog[d.trackIndex]?.id||null,
		now:d.track?.id||null,trackIndex:d.trackIndex,
		menuMode:d.menuMode,voice:d._activeVoiceFor(d.pack),
		started:d.started,packReady:!!d.pack,
		position:d.ctx&&d.clockStart!=null?d.ctx.currentTime-d.clockStart:null,
		clockStart:d.clockStart,shuffle:d.shuffleEnabled,
		audioState:a.ctx?.state||'not-created',
		musicShuffling:g.registry.get('settings')?.musicShuffle===true,
		melodyStemGain:d.mixer?.sources.get('voice:debutmont')?.input?.gain?.value,
	};
});
try{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),
		null,{timeout:35000});
	await page.waitForFunction(()=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth');
		return a?._autoStartAttempted===true&&a._stemMusic.ready===true;
	},null,{timeout:35000});
	const fresh=await state();
	assert.equal(fresh.id,'local-one-more-run-bitstream-bluffs');
	assert.equal(fresh.autoplayAttempt,true);
	assert.equal(fresh.mode,'menu');
	assert.equal(fresh.menuMode,true);
	console.log('BOOT_ONE_MORE_RUN_REQUESTED_PASS',fresh);

	// Browser autoplay policy requires a real user gesture on some origins.
	await page.keyboard.press('x');
	await page.waitForFunction(()=>{
		const a=window.__bbGame.registry.get('audioSynth');
		return a._stemMusic.started&&a._stemMusic.pack&&
			a._stemMusic.track?.id==='local-one-more-run-bitstream-bluffs'&&
			a._stemMusic.clockStart!==null&&
			a._stemMusic.activeNodes.size>=6&&
			a.ctx?.state==='running';
	},null,{timeout:45000});
	const playing=await state();
	assert.equal(playing.voice,'voice:debutmont');
	assert.equal(playing.menuMode,true);
	assert.equal(playing.now,'local-one-more-run-bitstream-bluffs');
	console.log('ONE_MORE_RUN_PLAYING_DEBUTMONT_MENU_PASS',playing);

	// Real game event listeners, not separate music director.
	await page.evaluate(()=>{
		const g=window.__bbGame;
		g.events.emit('bb:runStart',{seed:'preview-transition-no-actual-run'});
	});
	const inRun=await state();
	assert.equal(inRun.now,playing.now);
	assert.equal(inRun.trackIndex,playing.trackIndex);
	assert.equal(inRun.clockStart,playing.clockStart);
	assert.equal(inRun.mode,'run');
	await page.evaluate(()=>window.__bbGame.events.emit('bb:biomeEnter',{id:'crystal-cavern'}));
	const biome=await state();
	assert.equal(biome.voice,'voice:crystal-cavern');
	await page.evaluate(()=>window.__bbGame.events.emit('bb:runEnd',{cause:'crash'}));
	const afterCrash=await state();
	assert.equal(afterCrash.clockStart,playing.clockStart);
	assert.equal(afterCrash.now,playing.now);
	assert.equal(afterCrash.menuMode,true);
	assert.equal(afterCrash.voice,'voice:debutmont');
	await page.waitForTimeout(650);
	const continuing=await state();
	assert.ok(continuing.position>afterCrash.position+0.35);
	console.log('CRASH_NO_RESTART_MUSIC_CLOCK_CONTINUES_PASS',
		{before:playing.position,afterCrash:afterCrash.position,afterWait:continuing.position});

	// Use actual Settings UI's own setter, saved through updateSetting.
	const ui=await page.evaluate(()=>{
		const scene=window.__bbGame.scene.getScene('TitleScene');
		const item=scene.menu.items.find(x=>x.label==='SETTINGS');
		if(!item)throw Error('No SETTINGS');
		item.onSelect();
		const manager=scene.view.menu.items.find(x=>x.label==='MANAGE SOUND');
		if(!manager)throw Error('No MANAGE SOUND');
		manager.onSelect();
		const sound=scene.view.soundView;
		const shuffle=sound.menu.items.find(x=>x.label==='SHUFFLE SONGS');
		const lab=sound.menu.items.find(x=>x.label==='MUSIC LAB');
		if(!shuffle||!lab)throw Error('Missing SOUND UI setting or lab');
		shuffle.set(true);
		return {shuffleValue:shuffle.get(),settingsVisible:!!scene.view,
			soundVisible:!!sound,labLabel:lab.label,
			persisted:window.__bbGame.registry.get('settings').musicShuffle};
	});
	assert.deepEqual(ui,{shuffleValue:true,settingsVisible:true,soundVisible:true,
		labLabel:'MUSIC LAB',persisted:true});
	assert.equal((await state()).shuffle,true);
	console.log('SETTINGS_SOUND_SHUFFLE_AND_LAB_ENTRY_PASS',ui);

	// A refreshed session starts One More Run again, without forgetting shuffle.
	await page.reload({waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>{
		const g=window.__bbGame,a=g?.registry?.get('audioSynth');
		return a?._autoStartAttempted&&a._stemMusic.ready;
	},null,{timeout:35000});
	const reloaded=await state();
	assert.equal(reloaded.id,'local-one-more-run-bitstream-bluffs');
	assert.equal(reloaded.shuffle,true);
	assert.equal(reloaded.musicShuffling,true);
	assert.equal(reloaded.menuMode,true);
	console.log('NEXT_SESSION_ONE_MORE_RUN_SHUFFLE_PERSISTENCE_PASS',reloaded);
	assert.deepEqual(errors,[]);
	assert.deepEqual(http,[]);
	console.log('ALL_REAL_BROWSER_CONTINUOUS_SOUNDTRACK_SMOKES_PASSED');
} finally {
	await browser.close();
}
