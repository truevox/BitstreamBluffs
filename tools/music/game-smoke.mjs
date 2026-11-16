import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',
	args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage();
const errors=[], failed=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)failed.push([r.status(),r.url()]);});
await page.goto('http://127.0.0.1:5173/',{waitUntil:'networkidle',timeout:30000});
await page.waitForFunction(()=>!!window.__bbGame?.registry?.get('audioSynth'));
await page.waitForTimeout(500);
await page.evaluate(async()=>{
	const g=window.__bbGame, audio=g.registry.get('audioSynth');
	audio.unlock();
	await audio._musicProvider.initPromise;
	g.scene.getScene('TitleScene').startRun('POPE-ENGINE-TEST');
});
await page.waitForTimeout(3200);
const results=await page.evaluate(async()=>{
	const g=window.__bbGame, a=g.registry.get('audioSynth'), m=a._musicProvider;
	const before={current:g.scene.getScenes(true).map(s=>s.scene.key),title:m.track?.title,
		scheduled:m.scheduled.size,ctx:a.ctx?.state,biome:m.biome,sfxContextShared:m.ctx===a.ctx};
	const {updateSetting}=await import('/src/services.js');
	updateSetting(g,'musicVocals',true); updateSetting(g,'musicCaptions',true);
	a.setAirborne(true);
	a.setSpeed(800);
	m.setBiome('crystal-cavern');
	return {before,after:{vocals:m.vocals,captions:m.musicCaptions,biome:m.biome,
		room:m.mixer?.space?.active?.id,drumsMotion:m.mixer?.sources.get('drums')?.motion?.gain?.value,
		activeVoice:m._activeVoiceFor(m.pack),fx:m.mixer?.sources.get('other')?.chain?.stages?.map(s=>s.id),
		energy:m.getEnergy(),word:m.currentCaption(),
		sceneHUD:!!g.scene.getScene('UIScene').lyricCaption},settings:g.registry.get('settings')};
});
console.log(JSON.stringify({results,errors,failed},null,2));
await browser.close();
if(errors.length||failed.length||results.before.scheduled<6||!results.after.sceneHUD||
	!results.after.vocals||results.after.activeVoice!=='voice:bitstream-bluffs'){
	process.exitCode=1;
}
