import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://100.115.120.66:8199/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
try{
	const page=await browser.newPage({viewport:{width:1280,height:800}});
	const errors=[];
	page.on('pageerror',error=>errors.push(String(error)));
	let releaseA,enteredA;
	const hold=new Promise(resolve=>releaseA=resolve);
	const requested=new Promise(resolve=>enteredA=resolve);
	await page.route('**/music/packs/01_FEsxYVStla4/performance.json',
		async route=>{
			enteredA();
			await hold;
			await route.continue();
		});
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:35000});
	await page.keyboard.press('x');
	await page.evaluate(()=>{
		const t=window.__bbGame.scene.getScene('TitleScene');
		t.menu.items.find(x=>x.label==='SETTINGS').onSelect();
		t.view.menu.items.find(x=>x.label==='MANAGE SOUND').onSelect();
		t.view.soundView.menu.items.find(x=>x.label==='MUSIC LAB').onSelect();
	});
	await Promise.race([requested,new Promise((_,reject)=>setTimeout(
		()=>reject(Error('Score A not fetched')),20000))]);
	const atA=await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return {songIndex:v.songIndex,status:v.scoreStatus,score:v.score};
	});
	assert.equal(atA.songIndex,0);
	assert.equal(atA.score,null);
	await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		v._song(1);
	});
	await page.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v.score?.songId==='local-one-more-run-bitstream-bluffs' &&
			v.lab.pack?.id===v.score.songId;
	},null,{timeout:35000});
	releaseA();
	await page.waitForTimeout(550);
	const after=await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return {song:v.lab.track.id,score:v.score?.songId,
			status:v.scoreStatus,hash:v.score?.scoreHash};
	});
	assert.equal(after.song,'local-one-more-run-bitstream-bluffs');
	assert.equal(after.score,after.song);
	assert.equal(after.hash,'de3cb9b095e183c9996b1edec22bc870f3d2bdbf3502c67615f9a687aa32529c');
	console.log('SCORE_A_DELAYED_AFTER_TRACK_B_NEVER_CORRUPTS_B_DIAGNOSTICS_PASS',after);
	await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		v.close();
	});
	assert.deepEqual(errors,[]);
	await page.close();

	const invalid=await browser.newPage({viewport:{width:1280,height:800}});
	const e2=[];
	invalid.on('pageerror',e=>e2.push(String(e)));
	await invalid.route('**/music/packs/01_FEsxYVStla4/performance.json',
		async route=>{
			const response=await route.fetch();
			const body=await response.json();
			body.scoreHash='f'.repeat(64);
			await route.fulfill({response,body:JSON.stringify(body)});
		});
	await invalid.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await invalid.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:35000});
	await invalid.keyboard.press('x');
	await invalid.evaluate(()=>{
		const t=window.__bbGame.scene.getScene('TitleScene');
		t.menu.items.find(x=>x.label==='SETTINGS').onSelect();
		t.view.menu.items.find(x=>x.label==='MANAGE SOUND').onSelect();
		t.view.soundView.menu.items.find(x=>x.label==='MUSIC LAB').onSelect();
	});
	await invalid.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v.scoreStatus.startsWith('SCORE REJECTED:') &&
			v.lab.pack&&v.lab.activeNodes.size>=7;
	},null,{timeout:42000});
	const broken=await invalid.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return {score:v.score,error:v.scoreStatus,playing:v.lab.started,
			instrumentNodes:v.lab.activeNodes.size};
	});
	assert.equal(broken.score,null);
	assert.equal(broken.playing,true);
	assert.ok(broken.instrumentNodes>=7);
	console.log('INVALID_SCORE_REVISION_REJECTED_AUDIO_CONTINUES_UNMODIFIED_PASS',{
		error:broken.error,nodes:broken.instrumentNodes});
	assert.deepEqual(e2,[]);
	await invalid.close();
	console.log('ALL_PERFORMANCE_SCORE_RACE_AND_FAIL_CLOSED_TESTS_PASS');
}finally{await browser.close();}
