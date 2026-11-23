#!/usr/bin/env node
/** Real built-game Chrome test: gameplay DSP -> original clean menu ->
 * gameplay DSP, both 0.75 s crossfades and one continuous source clock.
 * Normal manual Pause uses the existing exact-frame vinyl freeze; when
 * the pause jukebox plays the menu mode is clean.
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const url=process.env.BSB_INTEGRATION_GAME_URL||'http://127.0.0.1:19008/';
const browser=await puppeteer.launch({
	executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader',
		'--use-gl=angle','--use-angle=swiftshader',
		'--autoplay-policy=no-user-gesture-required']
});
try{
	const page=await browser.newPage(),errors=[],missing=[];
	page.on('pageerror',e=>errors.push(String(e)));
	page.on('response',r=>{if(r.status()>=400)missing.push(r.status()+' '+r.url());});
	await page.setViewport({width:1280,height:800,deviceScaleFactor:1});
	await page.goto(url,{waitUntil:'networkidle2',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.isActive?.('TitleScene'),
		{timeout:25000});
	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene')
		.startRun('menu-crossfade-test',0));
	await page.waitForFunction(()=>window.__bbGame?.scene?.isActive?.('RunScene'),
		{timeout:25000});
	await page.waitForFunction(()=>{
		const a=window.__bbGame.scene.getScene('RunScene').registry.get('audioSynth');
		return !!a?._stemMusic?.started && !!a?._stemMusic?.mixer &&
			(a._stemMusic.cache?.size||0)>0;
	},{timeout:23000});
	const result=await page.evaluate(()=>{
		const game=window.__bbGame,scene=game.scene.getScene('RunScene');
		const a=scene.registry.get('audioSynth'),d=a._stemMusic,mixer=d.mixer;
		if(!d.started||!d.pack)throw Error('Original song was not loaded');
		d.setBiome('crystal-cavern');
		const dryNames=['drums','bass','guitar','piano','other'];
		const before={
			clockStart:d.clockStart,trackIndex:d.trackIndex,trackId:d.track?.id,
			musicBiome:d.biome,mode:a._musicMode,
			processed:dryNames.every(id=>mixer.sources.get(id)?.chain?.stages?.length>0)
		};
		const calls=[];
		const original=mixer.replaceEffects.bind(mixer);
		mixer.replaceEffects=(...args)=>{
			calls.push({id:args[0],effects:args[1].map(e=>e.type),fade:args[2]});
			return original(...args);
		};
		try{
			a._enterMenuMusic();
			const menu={
				mode:a._musicMode,menuMode:d.menuMode,clockStart:d.clockStart,
				trackIndex:d.trackIndex,trackId:d.track?.id,
				clean:dryNames.every(id=>mixer.sources.get(id)?.chain?.stages?.length===0),
				voiceClean:[...mixer.sources.entries()]
					.filter(([name])=>name.startsWith('voice:')&&d.gains.has(name))
					.every(([,src])=>src.chain?.stages?.length===0),
				vocalsSendZero:!!mixer.sources.get('vocals'),
				calls:calls.slice()
			};
			calls.length=0;
			a._enterRunMusic('menu-crossfade-test');
			const run={
				mode:a._musicMode,menuMode:d.menuMode,
				musicBiome:d.biome,clockStart:d.clockStart,
				trackIndex:d.trackIndex,trackId:d.track?.id,
				processed:dryNames.every(id=>
					mixer.sources.get(id)?.chain?.stages?.some(s=>s.type==='snowpack')),
				calls:calls.slice(),retiring:mixer.retiringEffects.size
			};
			return {before,menu,run};
		}finally{mixer.replaceEffects=original;}
	});
	assert.equal(result.before.mode,'run');
	assert.equal(result.before.musicBiome,'crystal-cavern');
	assert(result.before.processed,'No real original-stem gameplay processing found');
	assert.equal(result.menu.mode,'menu');
	assert.equal(result.menu.menuMode,true);
	assert(result.menu.clean,'Menu still has instrumental gameplay processors');
	assert(result.menu.voiceClean,'Menu still has one or more melodic-lead processors');
	assert.equal(result.menu.calls.length>=5,true);
	for(const call of result.menu.calls){
		assert.deepEqual(call.effects,[],'Menu retained a source effect on '+call.id);
		assert.equal(call.fade,.75,'Menu entry fade wrong on '+call.id);
	}
	assert.equal(result.run.mode,'run');
	assert.equal(result.run.musicBiome,'debutmont');
	assert.equal(result.run.menuMode,false);
	assert(result.run.processed,'Resume did not reinstate Debutmont snowpack source processing');
	for(const call of result.run.calls){
		assert.equal(call.fade,.75,'Returning to run fade wrong on '+call.id);
	}
	for(const key of ['clockStart','trackIndex','trackId']){
		assert.equal(result.menu[key],result.before[key],key+' changed entering clean menu');
		assert.equal(result.run[key],result.before[key],key+' changed resuming gameplay');
	}
	await page.waitForFunction(()=>{
		const d=window.__bbGame.scene.getScene('RunScene')
			.registry.get('audioSynth')?._stemMusic;
		return d?.mixer?.retiringEffects?.size===0;
	},{timeout:7000});
	assert.deepEqual(errors,[]);
	// Existing source library can attempt the known legacy miss followed
	// immediately by a successful archived file. No other missing assets.
	const invalid=missing.filter(x=>!(/404 .*\/adaptive\/debutmont\/[^/]+\.ogg$/.test(x)));
	assert.deepEqual(invalid,[],'Unresolved game assets: '+JSON.stringify(invalid));
	console.log('CLEAN_SIX_SOURCE_MENU_750MS_CHROME_REAL_GAME_PASS',JSON.stringify(result));
}finally{await browser.close();}
