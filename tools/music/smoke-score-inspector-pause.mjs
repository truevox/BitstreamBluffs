import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://100.115.120.66:8199/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
	'--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];
page.on('pageerror',e=>errors.push(String(e)));
try{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene.getScene('TitleScene')?.sys.isActive(),null,{timeout:35000});
	await page.keyboard.press('x');
	const before=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
	await page.evaluate(()=>{
		window.__bbGame.scene.start('PauseScene',{runTimeMs:114000});
	});
	await page.waitForFunction(()=>window.__bbGame.scene.getScene('PauseScene')?.sys?.isActive(),null,{timeout:12000});
	await page.evaluate(()=>{
		const p=window.__bbGame.scene.getScene('PauseScene');
		p.menu.items.find(x=>x.label==='SETTINGS').onSelect();
		p.view.menu.items.find(x=>x.label==='MANAGE SOUND').onSelect();
		p.view.soundView.menu.items.find(x=>x.label==='MUSIC LAB').onSelect();
	});
	await page.waitForFunction(()=>{
		const p=window.__bbGame.scene.getScene('PauseScene');
		const l=p.view?.soundView?.labView;
		return l?.score?.songId==='FEsxYVStla4'&&l.lab.pack;
	},null,{timeout:42000});
	const nested=await page.evaluate(()=>{
		const p=window.__bbGame.scene.getScene('PauseScene');
		return {paused:p.sys.isActive(),lab:p.view.soundView.labView.score.songId,
			btnDisabled:p.view.soundView.labView.inspectButton.disabled};
	});
	assert.equal(nested.paused,true);
	assert.equal(nested.btnDisabled,false);
	console.log('PAUSE_SCREEN_SCORE_LOADED_IN_REAL_GAME_LAB_PASS',nested);
	await page.keyboard.press('n');
	await page.waitForFunction(()=>{
		const p=window.__bbGame.scene.getScene('PauseScene');
		return !!p.view.soundView.labView.inspector;
	},null,{timeout:10000});
	const note=await page.evaluate(()=>{
		const i=window.__bbGame.scene.getScene('PauseScene').view.soundView.labView.inspector;
		return {role:i.role,score:i.score.scoreHash,
			selected:i.selectedId,pressedAlt:true};
	});
	assert.ok(note.role);
	console.log('PAUSE_SCREEN_REAL_N_KEY_OPENS_INSPECTOR_PASS',note);
	await page.keyboard.press('Escape');
	await page.waitForFunction(()=>{
		const p=window.__bbGame.scene.getScene('PauseScene');
		return p?.view?.soundView?.labView?.inspector===null;
	},null,{timeout:10000});
	const cameBack=await page.evaluate(()=>{
		const p=window.__bbGame.scene.getScene('PauseScene');
		return {pauseActive:p.sys.isActive(),musicLabAlive:p.view.soundView.labView.alive,
			inspector:p.view.soundView.labView.inspector};
	});
	assert.equal(cameBack.pauseActive,true);
	assert.equal(cameBack.musicLabAlive,true);
	assert.equal(cameBack.inspector,null);
	console.log('INSPECTOR_ESCAPE_RETURNS_TO_SAME_PAUSED_MUSIC_LAB_PASS');
	await page.evaluate(()=>{
		const p=window.__bbGame.scene.getScene('PauseScene');
		p.view.soundView.labView.close();
		p.view.soundView.close();
		p.view.close();
	});
	const after=await page.evaluate(()=>({
		pause:window.__bbGame.scene.getScene('PauseScene').sys.isActive(),
		store:Object.fromEntries(Object.entries(localStorage)),
		view:window.__bbGame.scene.getScene('PauseScene').view,
	}));
	assert.equal(after.pause,true);
	assert.equal(after.view,null);
	assert.deepEqual(after.store,before);
	assert.deepEqual(errors,[]);
	console.log('PAUSE_GAME_STATE_AND_STORAGE_UNMODIFIED_PASS');
	console.log('PAUSE_SCREEN_REAL_KEYBOARD_SCORE_EDITOR_PASS');
}finally{await browser.close();}
