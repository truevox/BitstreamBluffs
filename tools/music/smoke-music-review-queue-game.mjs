import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const url=process.env.GAME_URL||'http://100.115.120.66:8199/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
	'--enable-webgl','--ignore-gpu-blocklist']});

const open=async page=>{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});
	await page.waitForFunction(
		()=>window.__bbGame?.scene.getScene('TitleScene')?.sys.isActive(),
		null,{timeout:40000});
	await page.keyboard.press('x');
	await page.evaluate(()=>{
		const t=window.__bbGame.scene.getScene('TitleScene');
		t.menu.items.find(i=>i.label==='SETTINGS').onSelect();
		t.view.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
		t.view.soundView.menu.items.find(i=>i.label==='MUSIC LAB').onSelect();
	});
};
const waitReview=async(page,id)=>page.waitForFunction(
	expected=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v?.score?.songId===expected &&
			v?.experimentalScore?.songId===expected &&
			v?.reviewQueue?.songId===expected && v.lab.pack?.id===expected &&
			v.lab.activeNodes.size>=7;
	},id,{timeout:45000});
const pointer=async(page,x,y)=>{
	const p=await page.evaluate(({x,y})=>{
		const r=window.__bbGame.canvas.getBoundingClientRect();
		return {x:r.left+x/480*r.width,y:r.top+y/270*r.height};
	},{x,y});
	await page.mouse.click(p.x,p.y);
};

try{
	const page=await browser.newPage({
		viewport:{width:1280,height:800},acceptDownloads:true});
	const errors=[];
	page.on('pageerror',e=>errors.push(String(e)));
	await open(page);
	await waitReview(page,'FEsxYVStla4');
	const initial=await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return {song:v.reviewQueue.songId,
			status:v.reviewQueue.status,rows:v.reviewQueue.excerpts.length,
			songId:v.lab.track.id,soundStarted:v.lab.started,
			replacements:v.dynamic,baseScore:v.score.scoreHash,
			candidateScore:v.experimentalScore.scoreHash,
			originalSave:JSON.stringify(Object.fromEntries(Object.entries(localStorage)))};
	});
	assert.equal(initial.rows,3);
	assert.equal(initial.replacements,false);
	assert.equal(initial.soundStarted,true);
	assert.equal(initial.status,'machine-ranked-disagreement-not-human-verified');
	console.log('REAL_GAME_SOURCE_BOUND_REVIEW_SHORTLIST_PASS',initial.song);

	// Visit each song's ranked shortlist using actual next-suspect
	// control. No rendering selection or persistent audio changes.
	const songIds=['FEsxYVStla4','local-one-more-run-bitstream-bluffs',
		'WRBGQUqD54U','FYImnz5-hXs'];
	const totals=[3,9,3,5];
	let seen=0;
	for(let songIndex=0;songIndex<songIds.length;songIndex++){
		if(songIndex>0){
			await page.evaluate(index=>window.__bbGame.scene.getScene('TitleScene').view.soundView.labView._song(index),songIndex);
			await waitReview(page,songIds[songIndex]);
		}
		await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').view.soundView.labView._openInspector());
		await page.waitForFunction(()=>!!window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector,null,{timeout:12000});
		await page.waitForTimeout(500); // Phaser display/input tree needs a rendered frame after rebuilt panels
		for(let i=0;i<totals[songIndex];i++){
			const row=await page.evaluate(index=>{
				const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
				return v.reviewQueue.excerpts[index];
			},i);
			await pointer(page,6+352+50,7+158+6);
			await page.waitForFunction(index=>{
				const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
				return v.inspector?.reviewIndex===index &&
					v.inspector?.role===v.reviewQueue.excerpts[index].role &&
					v.inspector?.comparison===true;
			},i,{timeout:8000});
			const state=await page.evaluate(()=>{
				const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
				const i=v.inspector;
				return {
					index:i.reviewIndex,role:i.role,
					comparison:i.comparison,follow:i.follow,
					anchorFrame:i.anchorFrame,
					clockFrame:v._clockFrame(),sourceSong:v.score.songId,
					topic:v.reviewQueue.excerpts[i.reviewIndex],
					audioStarted:v.lab.started,
					originalScoreHash:v.score.scoreHash,
					candidateScoreHash:v.experimentalScore.scoreHash,
					draftEdits:i.draft.count,description:i.message,
					viewWindowStart:i.windowStart,
				};
			});
			assert.equal(state.role,row.role);
			assert.equal(state.follow,false);
			assert.equal(state.comparison,true);
			assert.equal(state.audioStarted,true);
			assert.equal(state.draftEdits,0);
			assert.ok(state.anchorFrame>=row.startFrame);
			assert.ok(state.anchorFrame<=row.endFrame);
			assert.ok(state.viewWindowStart>=0);
			assert.ok(state.description.includes('UNVERIFIED RANK'));
			assert.equal(state.topic.id,row.id);
			seen++;
		}
		// Cycling loops within this song and cannot jump to another song.
		await pointer(page,6+352+50,7+158+6);
		const wrapped=await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector.reviewIndex);
		assert.equal(wrapped,0);
		const track=await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.lab.track.id);
		assert.equal(track,songIds[songIndex]);
		if(songIndex===3){
			await page.keyboard.press('n');
			await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view.soundView.labView.inspector?.reviewIndex===1,null,{timeout:7000});
			console.log('KEYBOARD_N_ACTUAL_GAME_REVIEW_NEXT_ACTION_PASS');
		}
		await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').view.soundView.labView._closeInspector());
		console.log('REAL_GAME_MACHINE_REVIEW_SEEKS_ALL_SUSPECT_PASS',
			songIds[songIndex],totals[songIndex]);
	}
	assert.equal(seen,20);
	const final=await page.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return {replacements:v.dynamic,markers:v.markers.length,
			drafts:v.drafts.size,settingsSave:JSON.stringify(
				Object.fromEntries(Object.entries(localStorage)))};
	});
	assert.equal(final.replacements,false);
	assert.equal(final.markers,0);
	assert.equal(final.drafts,4);
	assert.equal(final.settingsSave,initial.originalSave);
	assert.deepEqual(errors,[]);
	await page.close();
	console.log('ALL_20_MACHINE_SHORTLIST_SEEKS_USED_REAL_SANDBOX_ENGINE_NO_PROFILE_CHANGES_PASS');

	// A corrupt review file must never appear as an actionable shortlist,
	// yet the original release score, V2 overlay and audio must survive.
	const corrupt=await browser.newPage({viewport:{width:1280,height:800}});
	const corruptErrors=[];
	corrupt.on('pageerror',e=>corruptErrors.push(String(e)));
	await corrupt.route('**/music/packs/01_FEsxYVStla4/review-queue-v1.json',
		async route=>{
			const res=await route.fetch();
			const raw=await res.json();
			raw.baselineScoreHash='f'.repeat(64);
			await route.fulfill({response:res,body:JSON.stringify(raw)});
		});
	await open(corrupt);
	await corrupt.waitForFunction(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return v?.reviewStatus?.startsWith('REVIEW SHORTLIST REJECTED:')&&
			v?.score&&v?.experimentalScore&&v.lab.started;
	},null,{timeout:45000});
	await corrupt.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').view.soundView.labView._openInspector());
	const invalid=await corrupt.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return {status:v.reviewStatus,queue:v.reviewQueue,disabled:v.inspector.reviewButton.disabled,
			originalScore:v.score.scoreHash,candidateScore:v.experimentalScore.scoreHash,
			audio:v.lab.started};
	});
	assert.equal(invalid.queue,null);
	assert.equal(invalid.disabled,true);
	assert.equal(invalid.audio,true);
	assert.deepEqual(corruptErrors,[]);
	console.log('CORRUPT_REVIEW_HASH_FAILS_CLOSED_AND_LEAVES_MUSIC_RUNNING_PASS');
	await corrupt.close();

	// Delayed response for A cannot contaminate new song B.
	const race=await browser.newPage({viewport:{width:1280,height:800}});
	const raceErrors=[];
	race.on('pageerror',e=>raceErrors.push(String(e)));
	let release,requested;
	const hold=new Promise(resolve=>release=resolve);
	const started=new Promise(resolve=>requested=resolve);
	await race.route('**/music/packs/01_FEsxYVStla4/review-queue-v1.json',
		async route=>{requested();await hold;await route.continue();});
	await open(race);
	await Promise.race([started,new Promise((_,reject)=>setTimeout(
		()=>reject(Error('Never fetched Pope review queue')),15000))]);
	await race.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').view.soundView.labView._song(1));
	await waitReview(race,'local-one-more-run-bitstream-bluffs');
	release();
	await race.waitForTimeout(600);
	const resolved=await race.evaluate(()=>{
		const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
		return {song:v.lab.track.id,score:v.score.songId,
			candidate:v.experimentalScore.songId,review:v.reviewQueue.songId,
			excerpts:v.reviewQueue.excerpts.length,audio:v.lab.started};
	});
	assert.equal(resolved.song,'local-one-more-run-bitstream-bluffs');
	assert.equal(resolved.score,resolved.song);
	assert.equal(resolved.candidate,resolved.song);
	assert.equal(resolved.review,resolved.song);
	assert.equal(resolved.excerpts,9);
	assert.equal(resolved.audio,true);
	assert.deepEqual(raceErrors,[]);
	console.log('STALE_PREVIOUS_SONG_SHORTLIST_CANNOT_CONTAMINATE_NEW_SONG_PASS');
	await race.close();
	console.log('ALL_IN_GAME_REVIEW_QUEUE_REAL_CHROMIUM_TESTS_PASS');
}finally{await browser.close();}
