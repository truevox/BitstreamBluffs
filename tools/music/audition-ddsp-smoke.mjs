import { chromium } from 'playwright';

const url = 'http://100.115.120.66:8181/tools/music/audition-ddsp/';
const browser = await chromium.launch({
	headless:true, executablePath:'/usr/bin/chromium',
	args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader',
		'--autoplay-policy=no-user-gesture-required'],
});
const page=await browser.newPage({viewport:{width:1290,height:800}});
const errors=[],failed=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)failed.push([r.status(),r.url()]);});
await page.goto(url,{waitUntil:'networkidle',timeout:30000});
await page.waitForFunction(()=>document.querySelectorAll('.voice[data-voice]').length===6,{timeout:12000});
await page.locator('#play').click();
await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Playing synchronized'),{timeout:30000});
await page.waitForTimeout(1000);
const firstTime=Number(await page.locator('#seek').inputValue());
const names=[];
for(const id of ['ddsp-violin','ddsp-flute','ddsp-tenor-saxophone','benchmark-v3-organ','benchmark-v3-saw','ddsp-trumpet']){
	await page.locator('[data-voice="'+id+'"]').click();
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Now playing'),{timeout:12000});
	names.push(await page.locator('#current').textContent());
}
const lastTime=Number(await page.locator('#seek').inputValue());
await page.locator('#original').click();
await page.waitForFunction(()=>document.querySelector('#current').textContent.includes('original vocal'),{timeout:12000});
const original=await page.locator('#current').textContent();
await page.locator('#room').uncheck();
await page.locator('#backing').uncheck();
await page.locator('#play').click();
const paused=await page.locator('#status').textContent();
const report=await page.evaluate(async()=>{
	const manifest=await (await fetch('/music-audition-ddsp/gallery.json')).json();
	const ac=new AudioContext();
	const lengths=[];
	for(const file of [...manifest.voices.map(v=>v.file),manifest.backing,manifest.originalVocal]){
		const res=await fetch('/music-audition-ddsp/'+file);
		const buffer=await ac.decodeAudioData(await res.arrayBuffer());
		lengths.push({file,seconds:+buffer.duration.toFixed(3),rate:buffer.sampleRate});
	}
	await ac.close();
	return lengths;
});
console.log(JSON.stringify({count:names.length,names,firstTime,lastTime,original,paused,report,errors,failed},null,2));
await browser.close();
if(errors.length||failed.length||names.length!==6||firstTime>lastTime ||
	report.some(v=>Math.abs(v.seconds-25)>.05) || !paused.includes('Paused'))
	process.exitCode=1;
