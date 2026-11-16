import { chromium } from 'playwright';

const url = process.env.AUDITION_URL || 'http://192.168.86.223:8181/tools/music/audition/';
const browser = await chromium.launch({
	headless: true, executablePath: '/usr/bin/chromium',
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], missing = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('response', response => { if (response.status() >= 400) missing.push([response.status(),response.url()]); });
await page.goto(url,{waitUntil:'networkidle',timeout:30000});
await page.waitForFunction(() => document.querySelectorAll('.voice[data-voice]').length === 12);
const initial = await page.locator('#status').textContent();
await page.locator('#play').click();
await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Playing synchronized'),{timeout:30000});
await page.waitForTimeout(900);
await page.locator('[data-voice="pyramid-peak"]').click();
await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Now playing'),{timeout:30000});
const pyramid = await page.locator('#current').textContent();
await page.locator('#original').click();
await page.waitForFunction(() => document.querySelector('#current').textContent.includes('original vocal'),{timeout:30000});
const original = await page.locator('#current').textContent();
await page.locator('#backing').uncheck();
await page.locator('#room').uncheck();
await page.locator('#play').click();
const paused = await page.locator('#status').textContent();
const values = await page.evaluate(async () => {
	const gallery = await (await fetch('/music-audition/gallery.json')).json();
	const context = new AudioContext();
	const files = gallery.voices.map(v=>v.file);
	const decoded = [];
	for(const file of files) {
		const response = await fetch('/music-audition/'+file);
		const buffer = await context.decodeAudioData(await response.arrayBuffer());
		decoded.push({name:file,duration:buffer.duration,rate:buffer.sampleRate,channels:buffer.numberOfChannels});
	}
	await context.close();
	return decoded;
});
console.log(JSON.stringify({
	initial,pyramid,original,paused,count:values.length,
	durations:values.map(x=>[x.name,Number(x.duration.toFixed(3))]),
	errors,missing,
},null,2));
await browser.close();
if(values.length!==12 || values.some(v=>v.duration<24.95 || v.duration>25.15) ||
	errors.length || missing.length || !pyramid.includes('FM brass') || !paused.includes('Paused'))process.exitCode=1;
