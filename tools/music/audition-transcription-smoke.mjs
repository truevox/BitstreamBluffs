import {chromium} from 'playwright';

const base='http://100.115.120.66:8181';
const browser=await chromium.launch({
	headless:true,
	executablePath:'/usr/bin/chromium',
	args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader',
		'--autoplay-policy=no-user-gesture-required'],
});
const page=await browser.newPage({viewport:{width:1240,height:800}});
const errors=[],failed=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)failed.push([r.status(),r.url()]);});
await page.goto(base+'/tools/music/audition-transcription/',{waitUntil:'networkidle',timeout:30000});
await page.waitForFunction(()=>document.querySelectorAll('.voice[data-voice]').length===6,{timeout:12000});
const noBacking=await page.locator('#backing').isChecked();
const noRoom=await page.locator('#room').isChecked();
await page.locator('#play').click();
await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Playing synchronized'),{timeout:30000});
const selected=[];
for(const id of ['organ-sheet-v3-expressive','organ-sheet-down12','organ-sheet-original','organ-basic-monophonic','organ-v3-reference','organ-sheet-v3-gentle']){
	await page.locator('[data-voice="'+id+'"]').click();
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Now playing'),{timeout:12000});
	selected.push(await page.locator('#current').textContent());
}
await page.locator('#original').click();
await page.waitForFunction(()=>document.querySelector('#current').textContent.includes('original vocal'),{timeout:12000});
const original=await page.locator('#current').textContent();
const decoded=await page.evaluate(async ()=>{
	const m=await (await fetch('/music-transcription-audition/gallery.json')).json();
	const context=new AudioContext();
	const result=[];
	for(const name of [...m.voices.map(v=>v.file),m.originalVocal,m.backing]){
		const response=await fetch('/music-transcription-audition/'+name);
		const bytes=await response.arrayBuffer();
		const audio=await context.decodeAudioData(bytes);
		result.push({name,duration:+audio.duration.toFixed(3),rate:audio.sampleRate});
	}
	await context.close();
	return result;
});
await page.locator('#play').click();
const paused=await page.locator('#status').textContent();
console.log(JSON.stringify({selected,original,decoded,paused,noBacking,noRoom,errors,failed},null,2));
await browser.close();
if(selected.length!==6||decoded.length!==8||decoded.some(x=>Math.abs(x.duration-25)>.05)
	||!original.includes('Maxi')||noBacking||noRoom||errors.length||failed.length||!paused.includes('Paused'))
	process.exitCode=1;
