import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root=process.env.GAME_URL||'http://100.115.120.66:8192/';
const browser=await chromium.launch({headless:true,
	args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
		'--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],failed=[];
page.on('pageerror',err=>errors.push(String(err)));
page.on('response',r=>{if(r.status()>=400)failed.push([r.status(),r.url()]);});
try {
	await page.goto(root,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>{
		const g=window.__bbGame;
		return !!g?.registry?.get('audioSynth') &&
			g.scene.getScene('TitleScene')?.sys?.isActive();
	},null,{timeout:40000});
	const settings=await page.evaluate(()=>{
		const game=window.__bbGame;
		const scene=game.scene.getScene('TitleScene');
		scene.menu.items.find(i=>i.label==='SETTINGS').onSelect();
		const view=scene.view;
		const labels=view.menu.items.map(i=>i.label);
		const wind=view.menu.items.find(i=>i.label==='SLED WIND');
		return {labels,wind:wind?.get(),songToggles:labels.filter(x=>x.startsWith('TRACK')).length,
			panelH:view.h};
	});
	console.log('SETTINGS_RAW',settings);
	assert.equal(settings.songToggles,0);
	assert.equal(settings.wind,1);
	assert.ok(settings.labels.includes('MANAGE SOUND'));
	assert.equal(settings.labels.filter(l=>l.endsWith('VOLUME')).length,3);
	assert.ok(settings.panelH<=200);
	console.log('SETTINGS_COMPRESSED_AND_FOURTH_WIND_SLIDER_PASS',settings);
	const manage=await page.evaluate(()=>{
		const game=window.__bbGame;
		const view=game.scene.getScene('TitleScene').view;
		view.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
		const sound=view.soundView;
		return {
			labels:sound.menu.items.map(i=>i.label),
			badge:sound.menu.rows.find(r=>r.badge)?.badge?.main?.text,
			price:sound.menu.items.find(i=>i.label.includes('UNLOCK ORIGINAL VOCALS'))?.label,
			voiceEnabled:game.registry.get('settings').musicVocals,
		};
	});
	assert.equal(manage.labels.filter(n=>n.startsWith('TRACK')).length,4);
	assert.ok(manage.labels.includes('MUSIC LAB'));
	assert.equal(manage.badge,'PRE-ALPHA');
	assert.equal(manage.voiceEnabled,false);
	assert.ok(manage.price?.includes('200 SHARDS'));
	console.log('MANAGE_SOUND_FOUR_SONGS_DYNAMIC_AND_VOCALS_UNLOCK_PASS',manage);
	await page.keyboard.press('x');
	await page.evaluate(()=>{
		const sound=window.__bbGame.scene.getScene('TitleScene').view.soundView;
		sound.menu.items.find(i=>i.label==='MUSIC LAB').onSelect();
	});
	await page.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView?.labView;
		return v?.lab?.ready && v.lab.pack && v.lab.activeNodes.size>=7;
	},null,{timeout:55000});
	const lab=await page.evaluate(()=>{
		const game=window.__bbGame;
		const lab=game.scene.getScene('TitleScene').view.soundView.labView;
		const director=lab.lab;
		return {
			sameDirectorImplementation:director.constructor===game.registry.get('audioSynth')._stemMusic.constructor,
			song:director.track.title,
			sourceCount:director.pack.sourceNames.length,
			decoded:lab.clockText.main.text,
			menu:lab.menu.items.map(i=>i.label),
			notLiveDirector:director!==game.registry.get('audioSynth')._stemMusic,
			sharedContext:director.ctx===game.registry.get('audioSynth').ctx,
			settingsUnchanged:game.registry.get('settings').dynamicOrchestra===false,
			labStarted:director.started,
		};
	});
	assert.equal(lab.sameDirectorImplementation,true);
	assert.equal(lab.notLiveDirector,true);
	assert.equal(lab.sharedContext,true);
	assert.equal(lab.sourceCount,18);
	assert.equal(lab.settingsUnchanged,true);
	assert.ok(lab.menu.includes('ISOLATE'));
	assert.ok(lab.menu.includes('SLED SPEED'));
	assert.ok(lab.menu.includes('BACK 10 SECONDS'));
	console.log('LAB_IDENTICAL_ENGINE_SANDBOX_PASS',lab);
	const playback=await page.evaluate(()=>{
		const view=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		view._dynamic(true);
		view._biome('crystal-cavern');
		view._air(true);
		view._speed(850);
		view._solo('BASS');
		const before=view.lab.clockStart;
		const ok=view.lab.seekTo(22);
		return {dynamic:view.lab.dynamicOrchestra,biome:view.lab.biome,
			airborne:view.lab.airborne,speed:view.lab.speedPxS,
			seek:ok,offset:Math.round(view.lab.ctx.currentTime-view.lab.clockStart),
			changedClock:view.lab.clockStart!==before,
			regularSettings:window.__bbGame.registry.get('settings').dynamicOrchestra,
			labAvailable:view.alive,
		};
	});
	assert.equal(playback.dynamic,true);
	assert.equal(playback.biome,'crystal-cavern');
	assert.equal(playback.airborne,true);
	assert.equal(playback.speed,850);
	assert.equal(playback.seek,true);
	assert.equal(playback.offset,22);
	assert.equal(playback.changedClock,true);
	assert.equal(playback.regularSettings,false);
	console.log('IN_GAME_LAB_BIOME_AIR_SPEED_REPLACEMENT_SEEK_PASS',playback);
	await page.evaluate(()=>{
		const game=window.__bbGame;
		const settings=game.scene.getScene('TitleScene').view;
		settings.soundView.labView.close();
		settings.soundView.close();
		return settings.soundView;
	});
	const cleanup=await page.evaluate(()=>{
		const g=window.__bbGame;
		const v=g.scene.getScene('TitleScene').view;
		return {labDestroyed:v.soundView===null,
			settingsStillOpen:v.alive,
			livePlaying:g.registry.get('audioSynth')._stemMusic.started,
			settingsStillOriginal:g.registry.get('settings').dynamicOrchestra===false};
	});
	assert.deepEqual(cleanup,{labDestroyed:true,settingsStillOpen:true,
		livePlaying:false,settingsStillOriginal:true});
	assert.deepEqual(errors,[]);
	assert.deepEqual(failed,[]);
	console.log('IN_GAME_LAB_CLEANUP_AND_NO_GAME_SETTING_WRITES_PASS',cleanup);
	console.log('BROWSER_SOUND_HUB_PASS');
} finally {await browser.close();}
