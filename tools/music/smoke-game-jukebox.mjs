import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const url=process.env.GAME_URL||'http://100.115.120.66:8195/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
	'--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],http=[];
page.on('pageerror',error=>errors.push(String(error)));
page.on('response',r=>{if(r.status()>=400)http.push([r.status(),r.url()]);});
try{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:35000});
	await page.keyboard.press('x'); // actual user gesture for Web Audio
	const title=await page.evaluate(()=>{
		const scene=window.__bbGame.scene.getScene('TitleScene');
		const j=scene.jukebox;
		j._toggleQueue();
		return {exists:!!j,now:j.now.main.text,
			buttons:j.buttons.map(b=>b.label.main.text),
			queueLast:j.queueTexts.last.main.text,
			queueNext:j.queueTexts.next.main.text,
			current:j.audio.jukeboxSnapshot().current?.title};
	});
	assert.equal(title.exists,true);
	assert.equal(title.buttons[0],'PREV');
	assert.ok(['PLAY','PAUSE'].includes(title.buttons[1]));
	assert.deepEqual(title.buttons.slice(2),['NEXT','LIST']);
	assert.ok(title.queueNext.startsWith('NEXT:'));
	console.log('TITLE_JUKEBOX_VISIBLE_LAST_NOW_NEXT_QUEUE_PASS',title);
	// The catalog loads asynchronously. Do not press a legitimately
	// disabled PLAY button and then mistake that for audio failure.
	await page.waitForFunction(()=>{
		const j=window.__bbGame.scene.getScene('TitleScene').jukebox;
		return j&&!j.buttons[1].disabled&&!!j.audio.jukeboxSnapshot().current;
	},null,{timeout:30000});

	// The soundtrack starts on load; only press PLAY if the browser deferred it.
	await page.evaluate(()=>{
		const audio=window.__bbGame.registry.get('audioSynth');
		if (!audio._stemMusic.started && !audio._stemMusic.transportPaused)
			audio.jukeboxPlay();
	});
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.started&&d.pack&&d.activeNodes.size>=7;
	},null,{timeout:40000});
	const before=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth');
		return {state:a.jukeboxSnapshot().state,song:a.jukeboxSnapshot().current?.title,
			position:a.jukeboxSnapshot().position,trackIndex:a._stemMusic.trackIndex,
			active:a._stemMusic.activeNodes.size,livePlayer:a._stemMusic.constructor.name};
	});
	assert.equal(before.state,'playing');
	console.log('TITLE_PLAY_ACTUAL_STEM_ENGINE_PASS',before);

	await page.waitForTimeout(550);
	await page.evaluate(()=>{
		window.__bbGame.scene.getScene('TitleScene').jukebox.buttons[1].zone.emit('pointerdown');
	});
	const paused=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
		return {state:a.jukeboxSnapshot().state,position:a.jukeboxSnapshot().position,
			started:d.started,paused:d.transportPaused,
			pausedIndex:d.trackIndex};
	});
	assert.equal(paused.state,'paused');
	assert.equal(paused.started,false);
	assert.equal(paused.paused,true);
	await page.waitForTimeout(400);
	const stayed=await page.evaluate(()=>window.__bbGame.registry.get('audioSynth').jukeboxSnapshot().position);
	assert.ok(Math.abs(stayed-paused.position)<.04);
	console.log('USER_PAUSE_DOES_NOT_ADVANCE_CLOCK_PASS',paused);

	await page.evaluate(()=>{
		window.__bbGame.scene.getScene('TitleScene').jukebox.buttons[1].zone.emit('pointerdown');
	});
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.started && !!d.pack && d.activeNodes.size>=7;
	},null,{timeout:45000});
	const resumed=await page.evaluate(()=>window.__bbGame.registry.get('audioSynth').jukeboxSnapshot());
	assert.equal(resumed.state,'playing');
	assert.ok(resumed.position>paused.position-.4 && resumed.position<paused.position+2,
		'Playback lost paused offset: '+JSON.stringify({paused:paused.position,resumed:resumed.position}));
	console.log('RESUME_FROM_SAME_SAMPLE_CLOCK_POSITION_PASS',{paused:paused.position,resumed:resumed.position});

	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').jukebox.buttons[2].zone.emit('pointerdown'));
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.trackIndex===2 && !!d.pack;
	},null,{timeout:35000});
	const next=await page.evaluate(()=>window.__bbGame.registry.get('audioSynth').jukeboxSnapshot());
	assert.equal(next.current.title.includes('Every Hacker'),true);
	assert.ok(next.previous?.title.includes('One More Run'));
	console.log('NEXT_AND_LAST_HISTORY_PASS',{now:next.current.title,previous:next.previous.title,
		after:next.upcoming.map(s=>s.title)});

	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').jukebox.buttons[0].zone.emit('pointerdown'));
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.trackIndex===1&&!!d.pack;
	},null,{timeout:35000});
	console.log('PREVIOUS_RETURNS_LAST_PLAYED_SONG_PASS');

	// Disabled songs can never be silently reintroduced by the transport.
	await page.evaluate(()=>{
		const g=window.__bbGame;
		const off=Object.fromEntries(g.registry.get('audioSynth')._stemMusic.catalog.map(t=>[t.id,false]));
		const s=g.registry.get('settings');s.musicEnabledSongs=off;
		g.events.emit('bb:settingsChanged',{key:'musicEnabledSongs',value:off,settings:s});
	});
	// Use public updateSetting semantics via registry/save event handled by
	// AudioSynth; the shared director must stop even if a node is queued.
	const off=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth');
		return {state:a.jukeboxSnapshot().state,active:a._stemMusic.activeNodes.size,
			enabled:Object.values(a._stemMusic.songEnabled)};
	});
	console.log('ALL_SONGS_OFF_STATE',off);
	assert.ok(off.enabled.every(x=>x===false));
	// Real BSOD relative airflow still drives environmental audio if all songs are OFF.
	await page.evaluate(()=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth');
		a.setSpeed(1000); // title speed alone is silent
		g.events.emit('bb:runStart',{seed:'wind-bus-check'});
		g.events.emit('bb:bsodStateChanged',{active:true,relativeAirX:1000,
			atmosphereDensity:1,proximity01:.8});
		a.playSfx('uiMove');
	});
	await page.waitForTimeout(350);
	const hiss=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth');
		return {wind:a.nodes.windGain.gain.value,
			sfx:a.nodes.sfxBus.gain.value,
			music:a._stemMusic.activeNodes.size};
	});
	assert.ok(hiss.wind>.06,'All-off incorrectly silenced authoritative BSOD wind');
	assert.ok(hiss.sfx>.5,'All-off incorrectly muted sound effects');
	assert.equal(hiss.music,0);
	await page.evaluate(()=>{
		const g=window.__bbGame,s=g.registry.get('settings');
		s.windVolume=0;
		g.events.emit('bb:settingsChanged',{key:'windVolume',value:0,settings:s});
	});
	await page.waitForTimeout(350);
	const windMuted=await page.evaluate(
		()=>window.__bbGame.registry.get('audioSynth').nodes.windGain.gain.value);
	assert.ok(windMuted<.02,'Dedicated wind slider failed to mute whoosh');
	console.log('FOURTH_SLED_HISS_SLIDER_INDEPENDENT_OF_ALL_OFF_MUSIC_AND_SFX_PASS',
		{hiss,windMuted});

	// Restore for subsequent scene QA.
	await page.evaluate(()=>{
		const g=window.__bbGame;
		const on=Object.fromEntries(g.registry.get('audioSynth')._stemMusic.catalog.map(t=>[t.id,true]));
		const s=g.registry.get('settings');s.musicEnabledSongs=on;
		g.events.emit('bb:settingsChanged',{key:'musicEnabledSongs',value:on,settings:s});
		g.events.emit('bb:runEnd',{cause:'preview-reset'});
		g.scene.start('PauseScene',{runTimeMs:0});
	});
	await page.waitForFunction(()=>window.__bbGame.scene.getScene('PauseScene')?.sys?.isActive(),null,{timeout:12000});
	const pause=await page.evaluate(()=>{
		const s=window.__bbGame.scene.getScene('PauseScene');
		s.jukebox._toggleQueue();
		return {active:s.sys.isActive(),controls:s.jukebox.buttons.map(b=>b.label.main.text),
			queue:!!s.jukebox.queue,
			samePlayer:s.jukebox.audio._stemMusic===window.__bbGame.registry.get('audioSynth')._stemMusic};
	});
	assert.equal(pause.active,true);
	assert.equal(pause.samePlayer,true);
	console.log('PAUSE_SCREEN_SHARED_JUKEBOX_PASS',pause);

	await page.evaluate(()=>window.__bbGame.scene.start('GameOverScene'));
	await page.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene')?.sys?.isActive(),null,{timeout:18000});
	const over=await page.evaluate(()=>{
		const s=window.__bbGame.scene.getScene('GameOverScene');
		s.jukebox._toggleQueue();
		return {active:s.sys.isActive(),queue:!!s.jukebox.queue,
			samePlayer:s.jukebox.audio._stemMusic===window.__bbGame.registry.get('audioSynth')._stemMusic};
	});
	assert.equal(over.active,true);
	assert.equal(over.samePlayer,true);
	console.log('GAME_OVER_SCREEN_SHARED_JUKEBOX_PASS',over);
	// A real pointer on the jukebox must not trigger GameOver's retry.
	await page.evaluate(()=>window.__bbGame.scene.getScene('GameOverScene').jukebox._toggleQueue());
	const coords=await page.evaluate(()=>{
		const rect=window.__bbGame.canvas.getBoundingClientRect();
		const locate=(x,y)=>({x:rect.left+x/480*rect.width,
			y:rect.top+y/270*rect.height});
		return {list:locate(335+2+3*35+16.5,4+14+7),
			queueBackground:locate(252,181)};
	});
	await page.mouse.click(coords.list.x,coords.list.y);
	await page.waitForTimeout(70);
	const clicked=await page.evaluate(()=>{
		const game=window.__bbGame;
		return {gameOver:game.scene.getScene('GameOverScene').sys.isActive(),
			queue:!!game.scene.getScene('GameOverScene').jukebox.queue};
	});
	assert.deepEqual(clicked,{gameOver:true,queue:true});
	await page.mouse.click(coords.queueBackground.x,coords.queueBackground.y);
	await page.waitForTimeout(70);
	assert.equal(await page.evaluate(
		()=>window.__bbGame.scene.getScene('GameOverScene').sys.isActive()),true);
	console.log('PHYSICAL_JUKEBOX_POINTER_DOES_NOT_RETRY_GAMEOVER_PASS');
	assert.deepEqual(errors,[]);
	assert.deepEqual(http,[]);
	console.log('REAL_BROWSER_THREE_SCREEN_JUKEBOX_PASS');
}finally{await browser.close();}
