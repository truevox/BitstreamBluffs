/** Private original-media real game crossfade smoke, not mastering/listening approval. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://127.0.0.1:8220/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try{
	const page=await browser.newPage({viewport:{width:1080,height:720}});
	const errors=[];
	page.on('pageerror',e=>errors.push(String(e)));
	await page.goto(url,{waitUntil:'domcontentloaded'});
	await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?._stemMusic?.ready&&window.__bbGame.scene.getScene('TitleScene')?.sys.isActive(),null,{timeout:30000});
	await page.keyboard.press('x');
	await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?.ctx?.state==='running',null,{timeout:30000});
	const count=await page.evaluate(async()=>{
		const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;
		if(a.settings.musicCrossfade!==true||d.crossfadeEnabled!==true)throw Error('Owner-approved default ON missing');
		await d._gridRequest;
		d.setMenuMode(true);d.setShuffle(false);d.setDynamicOrchestra(false);
		return d.transitionGrids.size;
	});
	assert.equal(count,33);
	for(const index of [0,32,1]){
		if(index===1){
			await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('crossfade-dsp-qa'));
			await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.sys.isActive(),null,{timeout:20000});
			await page.evaluate(()=>{const g=window.__bbGame;g.loop.stop();g.registry.get('audioSynth')._stemMusic.setMenuMode(false);});
		}
		const expected=await page.evaluate(async index=>{
			const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
			d.stop();d.lastCrossfade=null;d.trackIndex=index;
			const info=await d._getTrack(index);
			d._resumeOffset=info.pack.duration-7.5;d.start();
			return {from:info.track.id,to:d.catalog[(index+1)%33].id};
		},index);
		await page.waitForFunction(()=>!!window.__bbGame.registry.get('audioSynth')._stemMusic.lastCrossfade,null,{timeout:30000});
		const observed=await page.evaluate(()=>{
			const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
			return {fade:d.lastCrossfade,clock:d.clockStart,now:d.ctx.currentTime,token:d._token,menuMode:d.menuMode,
				nodes:[...d._sourceEnvelopes.values()].map(({role,token,end})=>({role,token,end}))};
		});
		assert.equal(observed.menuMode,index!==1);
		assert.equal(observed.fade.from,expected.from);assert.equal(observed.fade.to,expected.to);
		assert.ok(observed.fade.end-observed.fade.start>=1.9&&observed.fade.end-observed.fade.start<=4.05);
		assert.equal(observed.clock,observed.fade.start);
		for(const role of ['drums','bass','guitar','piano','other','vocals']){
			assert.ok(observed.nodes.some(n=>n.role===role&&n.token===observed.token-1&&n.end>observed.fade.start),'Missing outgoing '+role);
			assert.ok(observed.nodes.some(n=>n.role===role&&n.token===observed.token),'Missing incoming '+role);
		}
		await page.waitForFunction(()=>{const d=window.__bbGame.registry.get('audioSynth')._stemMusic;return d.ctx.currentTime>d.lastCrossfade.end+.3},null,{timeout:10000});
		const clean=await page.evaluate(()=>{const d=window.__bbGame.registry.get('audioSynth')._stemMusic;return [...d._sourceEnvelopes.values()].every(n=>n.token===d._token);});
		assert.ok(clean,'Outgoing nodes remain after transition');
		console.log('REAL_GAME_CROSSFADE_PASS',JSON.stringify({index,...observed.fade,overlapSeconds:observed.fade.end-observed.fade.start}));
	}
	const off=await page.evaluate(()=>{const a=window.__bbGame.registry.get('audioSynth');a.applySettings({...a.settings,musicCrossfade:false});return {settings:a.settings.musicCrossfade,director:a._stemMusic.crossfadeEnabled};});
	assert.deepEqual(off,{settings:false,director:false});
	assert.deepEqual(errors,[]);
}finally{await browser.close();}
