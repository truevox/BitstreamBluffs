#!/usr/bin/env node
/** Real integrated production-build Chromium boot, scene transition and frames.
 * This is a smoke test, not a listening test or production merge approval. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.BSB_INTEGRATION_GAME_URL||'http://127.0.0.1:18989/';
const browser=await puppeteer.launch({
	executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader',
		'--use-gl=angle','--use-angle=swiftshader','--autoplay-policy=no-user-gesture-required'],
});
try{
	const page=await browser.newPage(),errors=[],missing=[],audioResponses=[];
	page.on('response',r=>{
		if(r.url().endsWith('.ogg'))audioResponses.push({status:r.status(),url:r.url()});
		if(r.status()>=400)missing.push(r.status()+' '+r.url());
	});
	await page.setViewport({width:1280,height:800,deviceScaleFactor:1});
	page.on('pageerror',e=>errors.push(String(e)));
	page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource:'))errors.push(m.text());});
	await page.goto(url,{waitUntil:'networkidle2',timeout:28000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.isActive?.('TitleScene'),
		{timeout:23000});
	const initial=await page.evaluate(()=>({
		title:window.__bbGame.scene.isActive('TitleScene'),
		canvas:!!document.querySelector('#game-container canvas'),
		webgl:window.__bbGame.renderer.type,
	}));
	assert(initial.title&&initial.canvas);
	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('music-stack-smoke',0));
	await page.waitForFunction(()=>window.__bbGame?.scene?.isActive?.('RunScene'),
		{timeout:25000});
	await new Promise(resolve=>setTimeout(resolve,1100));
	const running=await page.evaluate(()=>{
		const game=window.__bbGame,scene=game.scene.getScene('RunScene');
		return {active:game.scene.isActive('RunScene'),alive:!!scene.sled,
			background:!!scene.bg,worldDance:!!scene.worldDance,
			biomeFx:!!scene.biomeFx,terrain:!!scene.terrain,
			audio:!!scene.registry.get('audioSynth'),scrollX:scene.cameras.main.scrollX,
			music:(()=>{const a=scene.registry.get('audioSynth'),m=a?._stemMusic;
				return {started:!!m?.started,hasPack:!!m?.pack,
					trackId:m?.track?.id||null,lastError:m?.lastError||null,
					cacheCount:m?.cache?.size||0};})()};
	});
	assert(running.active&&running.alive&&running.background&&running.worldDance&&running.biomeFx&&running.audio);
	console.log('BBS_GAME_ASSET_MISSING',JSON.stringify(missing));
	if(process.env.BSB_REQUIRE_MUSIC==='1'){
		const missed=missing.filter(x=>x.includes('.ogg'));
		for(const message of missed){
			// A canonical filename miss is intentional only when the very same
			// physical original recording succeeds at its archived old path.
			assert.match(message,/404 .*\/adaptive\/debutmont\/[^/]+\.ogg$/);
			const fallbackUrl=message.slice(4).replace('/adaptive/debutmont/','/adaptive/debumont/');
			assert(audioResponses.some(r=>r.url===fallbackUrl&&r.status===200),
				'No successful legacy file for '+message);
		}
		assert(running.music?.started&&running.music?.hasPack,
			'Music pack did not start after source compatibility fallback');
		assert(running.music?.cacheCount>0,'Decoded original source audio never entered the cache');
	}
	let switched=null;
	if(process.env.BSB_CYCLE_BIOMES==='1'){
		switched=await page.evaluate(()=>{
			const audio=window.__bbGame.scene.getScene('RunScene').registry.get('audioSynth');
			const director=audio?._stemMusic;
			if(!director?.started||!director?.pack||!director?.mixer)
				throw new Error('No real decoded source recording before biome cycle');
			const clock=director.clockStart,results=[];
			const cases=[['debumont','snowpack'],['garbage-dump-glacier','scrapheap'],
				['underwater-mountain','hydrostatic'],['micro-mountain','microbox'],
				['crystal-cavern','crystallattice'],['steampunk-slopes','steamworks'],
				['sky-jellyfish-mountain','jellybloom'],['vertigo-vents','ventforge']];
			for(const [biome,effect] of cases){
				director.setBiome(biome);
				director.setSpeed(800);
				director.setAirborne(true);
				director.onLanding({quality:'good',hard:true,impactSpeedPxS:650});
				director.setAirborne(false);
				if(biome==='vertigo-vents'){
					const ordinary=director.setGeyserMotion({beforeCooldownMs:0,afterCooldownMs:0,
						launchAvailable:true,vy:-700});
					if(ordinary)throw new Error('Normal airborne state falsely triggered a geyser');
					const geyser=director.setGeyserMotion({beforeCooldownMs:0,afterCooldownMs:891,
						launchAvailable:true,vy:-620});
					if(!geyser)throw new Error('Real physics cooldown edge failed to trigger eruption');
				}
				const target=biome==='crystal-cavern'?'bass':'drums';
				const chain=director.mixer.sources.get(target)?.chain;
				const ids=chain?.stages?.map(s=>s.id)||[];
				results.push({requested:biome,canonical:director.biome,effect,
					active:ids.includes(effect),stemsLoaded:director.cache?.size||0});
			}
			director.setBiome('debutmont');
			return {clockPreserved:director.clockStart===clock,results,
				retiring:director.mixer.retiringEffects?.size||0,
				timerCount:director.mixer.timers?.size||0};
		});
		assert(switched.clockPreserved,'Biome changes mutated song playback clock');
		for(const result of switched.results)
			assert(result.active,'Missing live effect: '+JSON.stringify(result));
		assert.equal(switched.results[0].canonical,'debutmont');
		assert(switched.retiring<=48,'Rapid audio graph crossfade budget exceeded');
		// Every retired chain must actually disconnect after its short fade,
		// not merely stay retained in the Web Audio graph indefinitely.
		await page.waitForFunction(()=>{
			const m=window.__bbGame.scene.getScene('RunScene').registry.get('audioSynth')?._stemMusic;
			return m?.mixer?.retiringEffects?.size===0;
		},{timeout:4000});
		switched.retiredAfterFade=await page.evaluate(()=>{
			const m=window.__bbGame.scene.getScene('RunScene').registry.get('audioSynth')?._stemMusic;
			return m?.mixer?.retiringEffects?.size;
		});
		assert.equal(switched.retiredAfterFade,0);
	}
	assert.deepEqual(errors,[]);
	console.log('BBS_EIGHT_BIOME_REAL_GAME_CHROMIUM_SMOKE_PASS',JSON.stringify({initial,running,switched}));
}finally{await browser.close();}
