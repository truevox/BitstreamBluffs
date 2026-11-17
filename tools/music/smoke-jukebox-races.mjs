import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const url=process.env.GAME_URL||'http://100.115.120.66:8195/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
	'--enable-webgl','--ignore-gpu-blocklist']});
const errors=[];
try{
	const page=await browser.newPage({viewport:{width:1280,height:800}});
	page.on('request',req=>{if(req.url().includes('pack.json'))console.log('PACK_REQUEST',req.url());});
	page.on('pageerror',e=>errors.push(String(e)));
	let releaseA,enteredA;
	const waitA=new Promise(resolve=>releaseA=resolve);
	const holdSeen=new Promise(resolve=>enteredA=resolve);
	await page.route('**/music/packs/01_FEsxYVStla4/pack.json',
		async route=>{
			enteredA();
			await waitA;
			await route.continue();
		});
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:35000});
	await page.waitForFunction(()=>!window.__bbGame.scene.getScene('TitleScene').jukebox.buttons[1].disabled,null,{timeout:25000});
	await page.keyboard.press('x');
	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').jukebox.buttons[1].zone.emit('pointerdown'));
	await page.waitForTimeout(1600);
	console.log('BEFORE_REQUEST_HOLD',await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
		return {ready:d.ready,state:a.jukeboxSnapshot().state,started:d.started,
			loading:!!d._loading,error:d.lastError,musicWanted:a._musicWanted,
			catalog:d.catalog.length};
	}));
	await Promise.race([holdSeen,new Promise((_,reject)=>setTimeout(()=>reject(Error('A not requested')),15000))]);
	const whileA=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return {started:d.started,index:d.trackIndex,pack:!!d.pack,loading:!!d._loading};
	});
	assert.equal(whileA.index,0);
	assert.equal(whileA.loading,true);
	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').jukebox.buttons[2].zone.emit('pointerdown'));
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return !!d.pack&&d.trackIndex===1&&d.activeNodes.size>=7;
	},null,{timeout:40000});
	releaseA();
	await page.waitForTimeout(450);
	const afterA=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return {index:d.trackIndex,track:d.track?.title,started:d.started,
			nodes:d.activeNodes.size,now:d.transportSnapshot().current?.title};
	});
	assert.equal(afterA.index,1);
	assert.ok(afterA.track.includes('One More Run'));
	assert.ok(afterA.now.includes('One More Run'));
	assert.equal(afterA.started,true);
	console.log('DELAYED_A_SKIPPED_TO_B_LATE_RESPONSE_NEVER_RESTORES_A_PASS',{whileA,afterA});
	const seek=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return {ok:d.seekTo(11.96),clock:d.clockStart,now:d.ctx.currentTime};
	});
	assert.equal(seek.ok,true);
	await page.waitForTimeout(160);
	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').jukebox.buttons[1].zone.emit('pointerdown'));
	const paused=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return {state:d.transportSnapshot().state,position:d.transportSnapshot().position,nodes:d.activeNodes.size};
	});
	assert.equal(paused.state,'paused');
	assert.ok(paused.position>11.85&&paused.position<12.8);
	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').jukebox.buttons[1].zone.emit('pointerdown'));
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.started&&d.pack&&d.activeNodes.size>=7;
	},null,{timeout:40000});
	const resumed=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		const pos=d.transportSnapshot().position;
		const seg=d.pack.segments.find(s=>s.startFrame<=pos*48000&&s.startFrame+s.frames>pos*48000);
		return {state:d.transportSnapshot().state,position:pos,
			segment:seg?.startFrame/48000,segments:d.pack.segments.length};
	});
	assert.equal(resumed.state,'playing');
	assert.ok(resumed.position>paused.position-.4&&resumed.position<paused.position+2);
	console.log('OPUS_12_SECOND_BOUNDARY_PAUSE_AND_RESUME_POSITION_PASS',{paused,resumed});
	await page.close();

	// Fresh browser profile and an actual mouse event must unlock the
	// suspended WebAudio context in a user gesture, without a preceding key.
	const fresh=await browser.newPage({viewport:{width:1280,height:800}});
	fresh.on('pageerror',e=>errors.push(String(e)));
	await fresh.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await fresh.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:35000});
	await fresh.waitForFunction(()=>!window.__bbGame.scene.getScene('TitleScene').jukebox.buttons[1].disabled,null,{timeout:25000});
	const point=await fresh.evaluate(()=>{
		const r=window.__bbGame.canvas.getBoundingClientRect();
		return {x:r.left+(335+2+35+16.5)/480*r.width,
			y:r.top+(61+14+7)/270*r.height};
	});
	await fresh.mouse.click(point.x,point.y);
	await fresh.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.ctx?.state==='running'&&d.pack&&d.activeNodes.size>=7;
	},null,{timeout:45000});
	const freshState=await fresh.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth');
		return {state:a.ctx.state,transport:a.jukeboxSnapshot().state,
			musicWanted:a._musicWanted,track:a.jukeboxSnapshot().current?.title};
	});
	assert.equal(freshState.state,'running');
	assert.equal(freshState.transport,'playing');
	assert.equal(freshState.musicWanted,true);
	console.log('FRESH_BROWSER_ACTUAL_POINTER_GESTURE_STARTS_WEB_AUDIO_PASS',freshState);
	await fresh.close();
	assert.deepEqual(errors,[]);
	console.log('ASTRA_HIGH_RISK_ASYNC_AND_BOUNDARY_TESTS_PASS');
}finally{await browser.close();}
