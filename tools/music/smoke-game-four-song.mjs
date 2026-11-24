import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url=process.env.GAME_URL||'http://127.0.0.1:8228/';
const browser=await chromium.launch({
	headless:true,args:['--no-sandbox','--use-gl=angle',
		'--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist'],
});
const context=await browser.newContext({
	viewport:{width:1280,height:800},
});
const page=await context.newPage();
const pageErrors=[],badResources=[],audioResponses=[];
page.on('pageerror',error=>pageErrors.push(error.message));
page.on('response',resp=>{
	if(resp.status()>=400)badResources.push([resp.status(),resp.url()]);
	if(resp.url().endsWith('.ogg'))audioResponses.push(resp.status());
});
try {
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
	await page.waitForFunction(()=>{
		const game=window.__bbGame;
		return game?.registry?.get('audioSynth') &&
			game.scene.getScene('TitleScene')?.sys?.isActive();
	},null,{timeout:35000});
	await page.waitForFunction(()=>{
		const a=window.__bbGame.registry.get('audioSynth');
		return a?._stemMusic?.ready&&a._stemMusic.catalog.length===4;
	},null,{timeout:20000});
	const names=await page.evaluate(()=>{
		const game=window.__bbGame;
		const title=game.scene.getScene('TitleScene');
		title.menu.items.find(i=>i.label==='SETTINGS').onSelect();
		title.view.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
		const sound=title.view.soundView;
		sound.menu.items.find(i=>i.label.startsWith('SELECT TRACKS')).onSelect();
		const view=sound.libraryView;
		return {
			songs:game.registry.get('audioSynth')._stemMusic.catalog.map(t=>t.title),
			items:view.menu.items.filter(t=>t.kind==='choice').map(t=>t.label),
			geometry:{panelY:view.panel.y,h:view.h,lastRow:33+view.menu.items.length*16,
				backY:view.h-22},
		};
	});
	assert.equal(names.songs.length,4);
	assert.equal(names.items.length,4);
	assert.ok(names.geometry.lastRow<names.geometry.backY,'Settings menu overlaps Done');
	console.log('SETTINGS_SONG_CHOICES',names);
	// Close Settings and trigger the browser's genuine autoplay gesture.
	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene')._closeView());
	await page.keyboard.press('x');
	await page.evaluate(()=>{
		window.__musicEvents=[];
		const g=window.__bbGame;
		g.events.on('bb:musicTrackChanged',p=>window.__musicEvents.push(p));
		g.scene.getScene('TitleScene').startRun('four-song-private-smoke');
	});
	await page.waitForFunction(()=>{
		const audio=window.__bbGame.registry.get('audioSynth');
		return window.__bbGame.scene.getScene('RunScene')?.sys?.isActive()&&
			window.__bbGame.scene.getScene('UIScene')?.sys?.isActive()&&
			audio?._stemMusic?.pack&&audio._stemMusic.activeNodes.size>0;
	},null,{timeout:35000});
	await page.evaluate(()=>{if(!window.__bbGame.registry.get('audioSynth').jukeboxStep(1))throw Error('Track change failed');});
	await page.waitForFunction(()=>{const g=window.__bbGame,d=g.registry.get('audioSynth')._stemMusic;return !d._loading&&d.activeNodes.size>=6&&g.scene.getScene('RunScene').songBillboard?.active&&g.scene.getScene('RunScene').songBillboard.trackId===d.track?.id;},null,{timeout:35000});
	const playing=await page.evaluate(()=>{
		const g=window.__bbGame;
		const audio=g.registry.get('audioSynth');
		const ui=g.scene.getScene('UIScene');
		return {
			track:audio._stemMusic.track?.title,
			id:audio._stemMusic.track?.id,
			duration:audio._stemMusic.pack?.duration,
			ready:audio._stemMusic.ready,
			activeStemNodes:audio._stemMusic.activeNodes.size,
			musicEvents:window.__musicEvents,
			hudActive:ui.sys.isActive(),
			billboardActive:g.scene.getScene('RunScene').songBillboard?.active,
			billboardTitle:g.scene.getScene('RunScene').songBillboard?.titleFull,
			billboardId:g.scene.getScene('RunScene').songBillboard?.trackId,
			volume:audio.settings.musicVolume,
		};
	});
	assert.ok(playing.musicEvents?.length>=1,'No Now Playing event');
	assert.ok(playing.hudActive,'HUD not active');
	assert.equal(playing.billboardActive,true,'Now Playing billboard missing');
	assert.equal(playing.billboardId,playing.id);
	assert.equal(playing.billboardTitle,playing.track.toUpperCase().trim());
	assert.ok(playing.musicEvents.some(e=>e.id===playing.id),'No actual current-song change event');
	assert.ok(playing.activeStemNodes>=1,'No sample playback');
	assert.ok(playing.duration>150,'Not full-length music');
	console.log('LIVE_SIX_STEM_MUSIC_AND_BILLBOARD_PASS',playing);
	// Disable EVERY song live and verify no procedural fallback or stem
	// playback even though the game itself remains alive.
	const quiet=await page.evaluate(()=>{
		const g=window.__bbGame;
		const audio=g.registry.get('audioSynth');
		const settings=g.registry.get('settings');
		settings.musicEnabledSongs=Object.fromEntries(
			Object.keys(settings.musicEnabledSongs).map(k=>[k,false]));
		g.events.emit('bb:settingsChanged',{
			key:'musicEnabledSongs',value:settings.musicEnabledSongs,settings,
		});
		return {
			trackStarted:audio._stemMusic.started,
			synthSchedulerActive:audio._musicTimer!==null,
			activeStemNodes:audio._stemMusic.activeNodes.size,
			sfxBusExists:!!audio.nodes?.sfxBus,
		};
	});
	assert.equal(quiet.trackStarted,false,'All disabled still playing music');
	assert.equal(quiet.synthSchedulerActive,false,'All disabled enabled procedural synth');
	assert.equal(quiet.activeStemNodes,0,'All disabled left stem nodes active');
	assert.equal(quiet.sfxBusExists,true,'Disabling music disabled SFX graph');
	console.log('ALL_FOUR_OFF_SILENCE_WITH_SFX_PASS',quiet);
	// Changing selection back to one song while running must restore the
	// selected *named* track instead of random synth fallback.
	await page.evaluate(()=>{
		const g=window.__bbGame;
		const settings=g.registry.get('settings');
		settings.musicEnabledSongs['FYImnz5-hXs']=true;
		g.events.emit('bb:settingsChanged',{
			key:'musicEnabledSongs',value:settings.musicEnabledSongs,settings,
		});
	});
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.pack?.id==='FYImnz5-hXs' && d.activeNodes.size>0;
	},null,{timeout:25000});
	console.log('ONE_SONG_REENABLE_PLAYS_VARMONT_PASS');
	// Persist the player's ALL-OFF choice, reload the entire game, and
	// verify the next run is truly silent, not merely momentarily muted.
	await page.evaluate(()=>{
		const g=window.__bbGame;
		const settings=g.registry.get('settings');
		settings.musicEnabledSongs=Object.fromEntries(
			Object.keys(settings.musicEnabledSongs).map(k=>[k,false]));
		g.registry.get('saveStore').saveSettings(settings);
	});
	await page.reload({waitUntil:'domcontentloaded',timeout:20000});
	await page.waitForFunction(()=>{
		const g=window.__bbGame;
		return g?.registry?.get('audioSynth')&&g.scene.getScene('TitleScene')?.sys?.isActive();
	},null,{timeout:30000});
	await page.keyboard.press('x');
	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('all-off-after-reload'));
	await page.waitForFunction(()=>{
		const g=window.__bbGame;
		return g?.scene?.getScene('RunScene')?.sys?.isActive() &&
			g.registry.get('audioSynth')._musicWanted;
	},null,{timeout:18000});
	const persisted=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth');
		return {
			allOff:Object.values(a.settings.musicEnabledSongs).every(v=>v===false),
			stemPlaying:a._stemMusic.started,
			proceduralPlaying:a._musicTimer!==null,
			sfxAvailable:!!a.nodes?.sfxBus,
		};
	});
	assert.deepEqual(persisted,{allOff:true,stemPlaying:false,
		proceduralPlaying:false,sfxAvailable:true});
	console.log('ALL_SONGS_OFF_PERSIST_AFTER_RELOAD_PASS',persisted);
	assert.equal(pageErrors.length,0,'Browser exceptions: '+pageErrors.join('; '));
	assert.equal(badResources.length,0,'Bad resources: '+JSON.stringify(badResources));
	assert.ok(audioResponses.length>=12,'Insufficient real Opus fetches');
	console.log('REAL_BROWSER_PASS',JSON.stringify({
		audioFetches:audioResponses.length,pageErrors,badResources,
	}));
} finally {
	await browser.close();
}
