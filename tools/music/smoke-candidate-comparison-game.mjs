import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://100.115.120.66:8199/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
	'--ignore-gpu-blocklist']});
const errors=[];
const gotoLab=async page=>{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:35000});
	await page.keyboard.press('x');
	await page.evaluate(()=>{
		const t=window.__bbGame.scene.getScene('TitleScene');
		t.menu.items.find(i=>i.label==='SETTINGS').onSelect();
		t.view.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
		t.view.soundView.menu.items.find(i=>i.label==='MUSIC LAB').onSelect();
	});
};
const state=async page=>page.evaluate(()=>{
	const game=window.__bbGame;
	const v=game.scene.getScene('TitleScene').view.soundView.labView;
	return {
		score:v.score?.scoreHash,
		candidate:v.experimentalScore?.scoreHash,
		candidateStatus:v.experimentalStatus,
		track:v.lab.track?.id,
		packScore:v.lab.pack?.performance?.scoreHash,
		packCandidate:v.lab.pack?.experimentalPerformance?.scoreHash,
		audioNodes:v.lab.activeNodes.size,
		enginePlaying:v.lab.started,
		dynamic:game.registry.get('settings').dynamicOrchestra,
		markers:v.markers.length,
		inspector:!!v.inspector,
		comparison:v.inspector?.comparison,
		draftCount:v.inspector?.draft.count,
	};
});
try{
	const page=await browser.newPage({viewport:{width:1280,height:800}});
	page.on('pageerror',e=>errors.push(String(e)));
	await gotoLab(page);
	await page.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v?.score&&v.experimentalScore&&v.lab.activeNodes.size>=7;
	},null,{timeout:45000});
	const a=await state(page);
	assert.equal(a.score,a.packScore);
	assert.equal(a.candidate,a.packCandidate);
	assert.notEqual(a.score,a.candidate);
	assert.equal(a.dynamic,false);
	assert.equal(a.markers,0);
	assert.equal(a.enginePlaying,true);
	console.log('ACTUAL_GAME_LOADS_DISTINCT_HASH_PINNED_RELEASE_AND_EXPERIMENTAL_SCORES_PASS',a);
	const before=await page.evaluate(()=>JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
	await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		v._openInspector();
	});
	const beforeDisplay=await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return {compare:v.inspector.comparison,
			enabled:!v.inspector.controls.compare.disabled,
			selection:v.inspector.selectedId,
			song:v.score.songId};
	});
	assert.equal(beforeDisplay.compare,false);
	assert.equal(beforeDisplay.enabled,true);
	const point=await page.evaluate(()=>{
		const rect=window.__bbGame.canvas.getBoundingClientRect();
		return {x:rect.left+(6+286+20)/480*rect.width,
			y:rect.top+(7+233+7)/270*rect.height};
	});
	await page.mouse.click(point.x,point.y);
	await page.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v?.inspector?.comparison===true;
	},null,{timeout:6000});
	const visual=await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		const i=v.inspector;
		i.setRole('piano');
		const viewportStart=i.windowStart;
		return {
			enabled:i.comparison,
			candidateId:v.experimentalScore.songId,
			baseId:v.score.songId,
			button:i.controls.compare.label,
			message:i.helpLine.main.text,
			role:i.role,
			draftCount:i.draft.count,
			releaseEvents:i._events().length,
			candidateEvents:v.experimentalScore.events.piano.length,
			hitBoxes:i._hitBoxes.length,
			originalStemSource:v.lab.pack.sourceNames.includes('piano'),
			audioPlaying:v.lab.started,
			originalTrack:v.lab.track.id,
		};
	});
	assert.equal(visual.enabled,true);
	assert.equal(visual.role,'piano');
	assert.equal(visual.draftCount,0);
	assert.equal(visual.originalStemSource,true);
	assert.equal(visual.audioPlaying,true);
	assert.equal(visual.candidateId,visual.baseId);
	assert.notEqual(visual.releaseEvents,visual.candidateEvents);
	assert.ok(visual.message.includes('EXPERIMENTAL'));
	console.log('SCORE_INSPECTOR_REAL_MOUSE_TOGGLE_PINK_V2_READ_ONLY_VISUAL_PASS',visual);
	await page.mouse.click(point.x,point.y);
	await page.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v?.inspector?.comparison===false;
	},null,{timeout:6000});
	assert.equal((await state(page)).comparison,false);
	console.log('COMPARE_ON_OFF_NEVER_EDITED_SCORE_OR_AUDIO_PASS');
	await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		v._closeInspector();
		v.close();
	});
	assert.equal(await page.evaluate(()=>JSON.stringify(
		Object.fromEntries(Object.entries(localStorage)))),before);
	await page.close();

	const corrupted=await browser.newPage({viewport:{width:1280,height:800}});
	corrupted.on('pageerror',e=>errors.push(String(e)));
	await corrupted.route('**/music/packs/01_FEsxYVStla4/performance-candidate-v2.json',
		async route=>{
			const res=await route.fetch();
			const raw=await res.json();
			raw.provenance.evidence.parentScoreHash='f'.repeat(64);
			await route.fulfill({response:res,body:JSON.stringify(raw)});
		});
	await gotoLab(corrupted);
	await corrupted.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v?.score&&v?.experimentalStatus.startsWith('V2 REJECTED')&&
			v.lab.activeNodes.size>=7;
	},null,{timeout:45000});
	const invalid=await state(corrupted);
	assert.equal(invalid.candidate,undefined);
	assert.equal(invalid.score,invalid.packScore);
	assert.equal(invalid.enginePlaying,true);
	console.log('CORRUPT_PARENT_HASH_REJECTS_EXPERIMENT_BUT_GAME_AUDIO_CONTINUES_PASS',invalid);
	await corrupted.close();

	const race=await browser.newPage({viewport:{width:1280,height:800}});
	race.on('pageerror',e=>errors.push(String(e)));
	let release,arrived;
	const hold=new Promise(resolve=>release=resolve);
	const entered=new Promise(resolve=>arrived=resolve);
	await race.route('**/music/packs/01_FEsxYVStla4/performance-candidate-v2.json',
		async route=>{arrived();await hold;await route.continue();});
	await gotoLab(race);
	await Promise.race([entered,new Promise((_,reject)=>setTimeout(
		()=>reject(Error('never fetched candidate A')),18000))]);
	await race.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		v._song(1);
	});
	await race.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v.score?.songId==='local-one-more-run-bitstream-bluffs'&&
			v.experimentalScore?.songId===v.score.songId&&
			v.lab.pack?.id===v.score.songId;
	},null,{timeout:40000});
	release();
	await race.waitForTimeout(500);
	const raced=await state(race);
	assert.equal(raced.track,'local-one-more-run-bitstream-bluffs');
	assert.equal(raced.score,raced.packScore);
	assert.equal(raced.candidate,raced.packCandidate);
	assert.equal(raced.enginePlaying,true);
	console.log('DELAYED_EXPERIMENT_A_NEVER_OVERWRITES_SONG_B_DIAGNOSTICS_PASS',raced);
	await race.close();
	assert.deepEqual(errors,[]);
	console.log('LIVE_GAME_UNREVIEWED_CANDIDATE_COMPARISON_ALL_BROWSER_TESTS_PASS');
}finally{await browser.close();}
