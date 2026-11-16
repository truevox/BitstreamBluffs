import { chromium } from 'playwright';

const browser = await chromium.launch({
	headless: true,
	executablePath: '/usr/bin/chromium',
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
const network = [];
page.on('pageerror', e=>errors.push(String(e)));
page.on('response', r=>{ if(r.status()>=400)network.push([r.status(), r.url()]); });
await page.goto('http://127.0.0.1:5173/', {waitUntil:'networkidle', timeout:30000});
await page.waitForFunction(() => !!window.__bbGame?.registry?.get('audioSynth'), {timeout:30000});
await page.waitForTimeout(1000);
const before = await page.evaluate(async () => {
	const game = window.__bbGame, audio=game.registry.get('audioSynth');
	if (!audio._musicProvider?.ready) await audio._musicProvider.initPromise;
	audio.unlock();
	audio.startMusic('test-music');
	return {providerReady:audio._musicProvider?.ready,ctxState:audio.ctx?.state, musicWanted:audio._musicWanted};
});
await page.waitForTimeout(4700);
const after=await page.evaluate(()=>{
	const game=window.__bbGame,a=game.registry.get('audioSynth'),m=a._musicProvider;
	return {ready:m?.ready, title:m?.track?.title, segmentCount:m?.pack?.segments.length, scheduled:m?.scheduled.size,
		decoded:m?.cache.size, ctxState:a.ctx?.state, clockStart:m?.clockStart,
		playing:!!m?.started,error:m?.lastError,method:'six-stem'};
});
console.log(JSON.stringify({before,after,errors,network},null,2));
await browser.close();
