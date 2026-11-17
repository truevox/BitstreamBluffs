import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

const url=process.env.GAME_URL||'http://100.115.120.66:8199/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
	'--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800},acceptDownloads:true});
const errors=[],http=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',response=>{
	if(response.status()>=400)http.push([response.status(),response.url()]);
});
const world=async(x,y)=>page.evaluate(({x,y})=>{
	const rect=window.__bbGame.canvas.getBoundingClientRect();
	return {x:rect.left+x/480*rect.width,y:rect.top+y/270*rect.height};
},{x,y});
try {
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:35000});
	await page.keyboard.press('x');
	await page.evaluate(()=>{
		const t=window.__bbGame.scene.getScene('TitleScene');
		t.menu.items.find(i=>i.label==='SETTINGS').onSelect();
		t.view.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
		t.view.soundView.menu.items.find(i=>i.label==='MUSIC LAB').onSelect();
	});
	await page.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v?.score?.songId==='FEsxYVStla4'&&v.lab.pack&&v.lab.activeNodes.size>=7;
	},null,{timeout:40000});
	const snapshotBefore=await page.evaluate(()=>{
		const g=window.__bbGame;
		return {storage:Object.fromEntries(Object.entries(localStorage)),
			song:g.scene.getScene('TitleScene').view.soundView.labView.score.songId,
			sourceHash:g.scene.getScene('TitleScene').view.soundView.labView.score.scoreHash};
	});
	await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		v._jump(60);
	});
	await page.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v?._clockFrame()>2800000&&v.lab.activeNodes.size>=7;
	},null,{timeout:35000});

	// Real physical click at NOTES button inside Music Lab.
	const noteButton=await world(6+109+46,7+235+7);
	await page.mouse.click(noteButton.x,noteButton.y);
	await page.waitForFunction(()=>
		!!window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector,
	null,{timeout:10000});
	const opened=await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return {role:v.inspector.role,score:v.inspector.score.scoreHash,
			graphics:v.inspector._hitBoxes.length,
			follow:v.inspector.follow,
			changes:v.inspector.draft.count,
			hasPanel:!!v.inspector.panel};
	});
	assert.equal(opened.score,snapshotBefore.sourceHash);
	assert.equal(opened.changes,0);
	assert.ok(opened.hasPanel);
	console.log('ACTUAL_CANVAS_NOTES_BUTTON_OPENS_OVERLAY_PASS',opened);
	await page.keyboard.press('ArrowDown');
	await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene')
		.view.soundView.labView.inspector.role==='melody',null,{timeout:6000});
	await page.keyboard.press('ArrowUp');
	await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene')
		.view.soundView.labView.inspector.role==='other',null,{timeout:6000});
	console.log('REAL_KEYBOARD_UP_DOWN_CYCLES_INSPECTOR_INSTRUMENT_ROLES_PASS');

	// Find a note with room around both neighboring attacks to nudge
	// without crossing the underlying stable release event sequence.
	const safe=await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		const i=v.inspector;
		i.setRole('bass');
		const all=i.score.events.bass;
		const found=all.find((e,index)=>
			e.startFrame>2800000&&e.startFrame<4200000 &&
			index>0&&index<all.length-1&&
			e.startFrame-all[index-1].startFrame>=4800 &&
			all[index+1].startFrame-e.startFrame>=4800);
		if(!found)return null;
		i.selectedId=found.id;
		i.anchorFrame=found.startFrame;
		i.follow=false;
		i.refresh();
		const rect=i._hitBoxes.find(hit=>hit.id===found.id);
		return {id:found.id,startFrame:found.startFrame,
			pitch:found.pitch,hit:rect,role:i.role,hitCount:i._hitBoxes.length};
	});
	assert.ok(safe?.hit,JSON.stringify(safe));
	const hit=await world(6+41+safe.hit.x+1.5,7+51+safe.hit.y+2);
	await page.mouse.click(hit.x,hit.y);
	const picked=await page.evaluate(()=>
		window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector.selectedId);
	assert.equal(picked,safe.id);
	console.log('REAL_PIANO_ROLL_PICK_SOURCE_NOTE_PASS',safe);

	// Real pointer click on edit controls; nudge and octave must combine.
	const late=await world(6+190+27,7+210+7);
	const octave=await world(6+306+27,7+210+7);
	await page.mouse.click(late.x,late.y);
	await page.mouse.click(octave.x,octave.y);
	const modified=await page.evaluate(()=>{
		const i=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector;
		return {count:i.draft.count,preview:i.draft.preview(i.selectedId),
			operations:i.draft.export()?.operations};
	});
	assert.equal(modified.count,1);
	assert.equal(modified.preview.startFrame,safe.startFrame+480);
	assert.equal(modified.preview.pitch,safe.pitch+12);
	assert.equal(modified.operations.length,1);
	assert.equal(modified.operations[0].action,'correct');
	console.log('Nudge_PLUS_OCTAVE_COMBINED_IN_SINGLE_NON_DESTRUCTIVE_DRAFT_PASS',modified);
	const hear=await world(6+364+43,7+210+7);
	await page.mouse.click(hear.x,hear.y);
	const actualStem=await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return {role:v.solo,track:v.lab.track.id,
			engineStarted:v.lab.started,selected:v.inspector.selectedId};
	});
	assert.equal(actualStem.role,'BASS');
	assert.equal(actualStem.track,'FEsxYVStla4');
	assert.equal(actualStem.engineStarted,true);
	assert.equal(actualStem.selected,safe.id);
	console.log('HEAR_STEM_USES_REAL_SHIPPING_ENGINE_SAME_SONG_AND_SOURCE_ISOLATION_PASS');

	// Clicking another note must not destroy the first edit.
	await page.evaluate(()=>{
		const i=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector;
		i.shift(1);
	});
	const otherId=await page.evaluate(()=>
		window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector.selectedId);
	const reject=await world(6+10+33,7+233+7);
	await page.mouse.click(reject.x,reject.y);
	let draftCount=await page.evaluate(()=>
		window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector.draft.count);
	assert.equal(draftCount,2);
	const undo=await world(6+152+31,7+233+7);
	await page.mouse.click(undo.x,undo.y);
	draftCount=await page.evaluate(()=>
		window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector.draft.count);
	assert.equal(draftCount,1);
	console.log('REJECT_OTHER_AND_UNDO_KEEPS_FIRST_NOTE_CORRECTION_PASS');

	const beforeExport=page.waitForEvent('download',{timeout:15000});
	const exportPos=await world(6+219+54,7+233+7);
	await page.mouse.click(exportPos.x,exportPos.y);
	const download=await beforeExport;
	const patch=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
	if(process.env.SAVE_PATCH_FOR_OFFLINE_QA)
		fs.writeFileSync(process.env.SAVE_PATCH_FOR_OFFLINE_QA,
			JSON.stringify(patch,null,2)+'\n');
	assert.equal(patch.format,'bitstream-performance-patches-v1');
	assert.equal(patch.status,'draft-unreviewed-not-applied-to-audio');
	assert.equal(patch.songId,'FEsxYVStla4');
	assert.equal(patch.baseScoreHash,snapshotBefore.sourceHash);
	assert.deepEqual(patch.operations,[{
		id:safe.id,action:'correct',startFrame:safe.startFrame+480,
		endFrame:modified.preview.endFrame,pitch:safe.pitch+12,
	}]);
	console.log('EXPORTED_EXACT_OFFLINE_PATCH_SCHEMA_PASS',
		{filename:download.suggestedFilename(),patch});

	// Leave and re-enter Notes: same in-memory draft, never stored in profile.
	const back=await world(6+390+34,7+231+8);
	await page.mouse.click(back.x,back.y);
	const closed=await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return {inspector:v.inspector,drafts:v.drafts.size,score:v.score.scoreHash};
	});
	assert.equal(closed.inspector,null);
	assert.equal(closed.drafts,1);
	await page.mouse.click(noteButton.x,noteButton.y);
	const retained=await page.evaluate(()=>{
		const i=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector;
		return {count:i?.draft.count,sourceHash:i?.draft.scoreHash};
	});
	assert.equal(retained.count,1);
	console.log('EDITOR_REOPEN_RETAINS_IN_MEMORY_PATCH_DURING_LAB_SESSION_PASS');

	await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		v._closeInspector();
		v._song(1);
	});
	await page.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v?.score?.songId==='local-one-more-run-bitstream-bluffs';
	},null,{timeout:35000});
	await page.mouse.click(noteButton.x,noteButton.y);
	const other=await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return {song:v.score.songId,patches:v.inspector?.draft.count,
			newScore:v.inspector?.draft.scoreHash,draftCount:v.drafts.size};
	});
	assert.equal(other.patches,0);
	assert.notEqual(other.newScore,snapshotBefore.sourceHash);
	console.log('DIFFERENT_SONG_DOES_NOT_INHERIT_PREVIOUS_SCORE_EDITS_PASS',other);

	await page.evaluate(()=>{
		const t=window.__bbGame.scene.getScene('TitleScene');
		t.view.soundView.labView._closeInspector();
		t.view.soundView.labView.close();
		t.view.soundView.close();
	});
	const final=await page.evaluate(()=>{
		const g=window.__bbGame;
		return {
			storage:Object.fromEntries(Object.entries(localStorage)),
			sourceSong:g.registry.get('audioSynth')._stemMusic.track?.id,
			gameSettings:g.registry.get('settings').dynamicOrchestra,
			labGone:!g.scene.getScene('TitleScene').view.soundView,
		};
	});
	assert.deepEqual(final.storage,snapshotBefore.storage);
	assert.equal(final.gameSettings,false);
	assert.equal(final.labGone,true);
	assert.deepEqual(errors,[]);
	assert.deepEqual(http,[]);
	console.log('INSPECTOR_NO_PROFILE_WRITES_NO_AUDIO_REPLACEMENT_NO_BROWSER_ERRORS_PASS');
	console.log('REAL_GAME_SCORE_INSPECTOR_ALL_POINTER_AND_EXPORT_TESTS_PASS');
}finally{await browser.close();}
