/** Controlled real WebAudio transport regression, not a physics collision or mastering audit.
 * Use a private loopback original-media overlay, with default empty transition grid.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://127.0.0.1:8220/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
	const page=await browser.newPage({viewport:{width:1080,height:720}}),errors=[];
	page.on('pageerror',e=>errors.push(String(e)));
	await page.goto(url,{waitUntil:'domcontentloaded'});
	await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?._stemMusic?.ready&&window.__bbGame.scene.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
	await page.keyboard.press('x');
	await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?.ctx?.state==='running',null,{timeout:30000});
	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('review-recovery-arcade'));
	await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.sys.isActive(),null,{timeout:30000});
	await page.evaluate(async()=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
		g.loop.stop(); await d._gridRequest;
		d.setMenuMode(false);d.setShuffle(false);d.setDynamicOrchestra(false);
		if(d.transitionGrids.size!==0)throw Error('Use empty transition grid for fixed-time regression');
		d.stop();d.lastCrossfade=null;d.trackIndex=0;
		const info=await d._getTrack(0);
		d._resumeOffset=info.pack.duration-6;d.start();
	});
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.started&&!d._loading&&d.activeNodes.size>=6&&d._nextPrepared&&
			d.ctx.currentTime-d.clockStart>d.pack.duration-5.5;
	},null,{timeout:25000});
	const crash=await page.evaluate(()=>{
		const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
		const now=d.ctx.currentTime,remaining=d.clockStart+d.pack.duration-now;
		g.events.emit('bb:runStart',{runId:'review-tail',seed:'controlled-audio-event'});
		g.events.emit('bb:crash',{negated:false,fatal:true,runId:'review-tail',cause:'controlled-audio-event'});
		g.events.emit('bb:runEnd',{record:{id:'review-tail',cause:'crash'}});
		return {remaining,now,token:d._token,clock:d.clockStart,track:d.track.id,status:a.getFatalCountInStatus(),sources:a._fatalCountIn.sources.length};
	});
	assert.equal(crash.status.active,true);assert.equal(crash.sources,4);
	assert.ok(crash.remaining>crash.status.bandAt-crash.now+.55,'not enough recovery time before normal boundary');
	assert.ok(crash.status.bandAt>crash.clock+await page.evaluate(()=>window.__bbGame.registry.get('audioSynth')._stemMusic.pack.duration)-2.8,'recovery must span early fade window');
	await page.waitForFunction(t=>window.__bbGame.registry.get('audioSynth').ctx.currentTime>t,crash.status.bandAt+.07,{timeout:12000});
	const recovered=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
		return {token:d._token,clock:d.clockStart,track:d.track.id,fade:d.lastCrossfade,status:a.getFatalCountInStatus(),sources:a._fatalCountIn.sources.length};
	});
	assert.equal(recovered.token,crash.token);assert.equal(recovered.clock,crash.clock);
	assert.equal(recovered.track,crash.track);assert.equal(recovered.fade,null);
	assert.equal(recovered.status.stage,'full-band');assert.equal(recovered.status.active,false);assert.equal(recovered.sources,4);
	console.log('NEAR_END_REAL_ORIGINAL_COUNTIN_COMPLETES_PASS',JSON.stringify({crash,recovered}));
	await page.waitForFunction(id=>{const d=window.__bbGame.registry.get('audioSynth')._stemMusic;return d.track?.id!==id&&!d._loading&&d.activeNodes.size>=6;},crash.track,{timeout:15000});
	const arcade=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
		d.setMenuMode(false);d.setBiome('bitstream-bluffs');d.setArcadeTransition({bridge:true,progress:.12});
		const before={id:d.track.id,token:d._token,clock:d.clockStart};
		d.setMenuMode(true);
		const clean=['bass','drums','guitar','piano','other'].every(role=>!d.mixer.sources.get(role).chain.find('arcadeglue'));
		const calls=[],original=d.mixer.setEffectParam;
		d.mixer.setEffectParam=function(role,effect,key,value){const ok=original.call(this,role,effect,key,value);if(effect==='arcadeglue')calls.push({role,key,value,ok});return ok;};
		try{d.setMenuMode(false);d.setArcadeTransition({bridge:true,progress:.12});}
		finally{d.mixer.setEffectParam=original;}
		return {before,after:{id:d.track.id,token:d._token,clock:d.clockStart},clean,calls};
	});
	assert.deepEqual(arcade.before,arcade.after);assert.equal(arcade.clean,true);
	for(const role of ['bass','drums','guitar','piano','other']){
		assert.ok(arcade.calls.some(c=>c.role===role&&c.key==='bridge'&&c.value===true&&c.ok));
		assert.ok(arcade.calls.some(c=>c.role===role&&c.key==='progress'&&c.value===.12&&c.ok));
	}
	console.log('SAME_SONG_ARCADE_REAL_CHAIN_REHYDRATION_PASS',JSON.stringify(arcade));
	await page.evaluate(async()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		d.setMenuMode(true);d.stop();d.lastCrossfade=null;d.trackIndex=1;
		const info=await d._getTrack(1);d._resumeOffset=info.pack.duration-7.5;d.start();
	});
	await page.waitForFunction(()=>!!window.__bbGame.registry.get('audioSynth')._stemMusic.lastCrossfade,null,{timeout:30000});
	console.log('ORDINARY_CROSSFADE_AFTER_RECOVERY_PASS',await page.evaluate(()=>window.__bbGame.registry.get('audioSynth')._stemMusic.lastCrossfade));
	assert.deepEqual(errors,[]);
}finally{await browser.close();}
