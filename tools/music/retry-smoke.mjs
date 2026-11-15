import { chromium } from 'playwright';
const browser = await chromium.launch({
	headless: true,
	executablePath: '/usr/bin/chromium',
	args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader','--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [], network = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('response', r => { if (r.status() >= 400) network.push([r.status(), r.url()]); });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => !!window.__bbGame?.registry?.get('audioSynth'));
await page.evaluate(async () => {
	const audio = window.__bbGame.registry.get('audioSynth');
	await audio._musicProvider.initPromise;
	audio.unlock();
	audio.startMusic('first');
});
await page.waitForTimeout(11300);
const report = await page.evaluate(async () => {
	const game = window.__bbGame;
	const audio = game.registry.get('audioSynth');
	const music = audio._musicProvider;
	const first = { time: music.clockStart, segment0: music.scheduled.has('0/drums'),
		segment1: music.scheduled.has('1/drums'), playing: music.started };
	const { EVT } = await import('/src/events.js');
	game.events.emit(EVT.RUN_END, { cause:'test' });
	game.events.emit(EVT.RUN_START, { seed:'second' });
	const second = { time: music.clockStart, playing: music.started, biome: music.biome };
	game.events.emit(EVT.RUN_ABORT, { reason:'quit' });
	return { first, second, afterAbort: {time:music.clockStart, playing:music.started} };
});
await browser.close();
console.log(JSON.stringify({ report, errors, network }, null, 2));
if (errors.length || network.length || !report.first.segment0 || !report.first.segment1 ||
	report.first.time !== report.second.time || !report.second.playing ||
	report.afterAbort.time !== report.first.time || !report.afterAbort.playing) process.exitCode = 1;
