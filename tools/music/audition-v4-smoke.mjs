import { chromium } from 'playwright';

const browser=await chromium.launch({
	headless:true,executablePath:'/usr/bin/chromium',
	args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader',
		'--autoplay-policy=no-user-gesture-required'],
});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const errors=[],missing=[];
page.on('pageerror',error=>errors.push(String(error)));
page.on('response',res=>{if(res.status()>=400)missing.push([res.status(),res.url()]);});
await page.goto('http://100.115.120.66:8181/tools/music/audition-v4/',
	{waitUntil:'networkidle',timeout:30000});
await page.waitForFunction(()=>document.querySelectorAll('[data-voice]').length===2,{timeout:10000});
const initial=await page.locator('#current').textContent();
await page.locator('#play').click();
await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Playing synchronized'),{timeout:30000});
await page.locator('[data-voice="vertigo-vents"]').click();
await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Now playing'),{timeout:30000});
const history=[];
history.push(await page.locator('#current').textContent());
for(const version of ['V3','V2','V1','V4']){
	await page.locator('#revision').click();
	await page.waitForFunction(v=>document.querySelector('#current')?.textContent.endsWith(v),
		version,{timeout:10000});
	history.push(await page.locator('#current').textContent());
}
await page.locator('[data-voice="candy-cane-canyon"]').click();
await page.waitForFunction(()=>document.querySelector('#current')?.textContent.includes('saw'),{timeout:10000});
await page.locator('#original').click();
await page.waitForFunction(()=>document.querySelector('#current')?.textContent.includes('original vocal'),{timeout:10000});
const original=await page.locator('#current').textContent();
await page.locator('#play').click();
const paused=await page.locator('#status').textContent();
const durations=await page.evaluate(async()=>{
	const x=await(await fetch('/music-audition-v4/gallery.json')).json();
	const c=new AudioContext();
	const ret=[];
	for(const f of x.voices.flatMap(v=>[v.file,v.v3file])){
		const bytes=await(await fetch('/music-audition-v4/'+f)).arrayBuffer();
		const decoded=await c.decodeAudioData(bytes);
		ret.push([f,+decoded.duration.toFixed(3)]);
	}
	await c.close();
	return ret;
});
console.log(JSON.stringify({
	initial,history,original,paused,durations,
	errors,missing,
},null,2));
await browser.close();
if(errors.length||missing.length||history.length!==5||
	durations.some(x=>Math.abs(x[1]-25)>.05)||
	!history[0].includes('V4')||!paused.includes('Paused'))process.exitCode=1;
