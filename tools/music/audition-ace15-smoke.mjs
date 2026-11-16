import {chromium} from 'playwright';
const browser=await chromium.launch({
	headless:true,executablePath:'/usr/bin/chromium',
	args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader',
		'--autoplay-policy=no-user-gesture-required'],
});
const page=await browser.newPage({viewport:{width:1340,height:900}});
const errors=[],failed=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)failed.push([r.status(),r.url()]);});
const base='http://100.115.120.66:8181';
await page.goto(base+'/tools/music/audition-ace15/',{
	waitUntil:'networkidle',timeout:30000,
});
await page.waitForFunction(()=>document.querySelectorAll('.voice[data-voice]').length===7,{timeout:12000});
await page.locator('#play').click();
await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Playing synchronized'),{timeout:30000});
const names=[];
for(const id of ['ace-organ-s70','kie-organ-1','kie-organ-2','v3-church-organ','ace-holo-s90','ace-holo-s70','ace-organ-s90']){
	await page.locator('[data-voice="'+id+'"]').click();
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Now playing'),{timeout:18000});
	names.push(await page.locator('#current').textContent());
}
await page.locator('#original').click();
await page.waitForFunction(()=>document.querySelector('#current').textContent.includes('original vocal'),{timeout:18000});
const original=await page.locator('#current').textContent();
await page.locator('#backing').uncheck();
await page.locator('#room').uncheck();
await page.locator('#play').click();
const paused=await page.locator('#status').textContent();
const clipReport=await page.evaluate(async()=>{
	const gallery=await (await fetch('/music-audition-ace15/gallery.json')).json();
	const context=new AudioContext();
	const result=[];
	for(const f of [...gallery.voices.map(x=>x.file),gallery.backing,gallery.originalVocal]){
		const response=await fetch('/music-audition-ace15/'+f);
		const audio=await context.decodeAudioData(await response.arrayBuffer());
		result.push({file:f,duration:+audio.duration.toFixed(3),rate:audio.sampleRate,
			meanGain:+(Math.sqrt(audio.getChannelData(0).reduce((sum,x)=>sum+x*x,0)/audio.length)).toFixed(6)});
	}
	await context.close();
	const fullLinks=[...document.querySelectorAll('a[href$="-full.ogg"], a[href$="-full.mp3"]')].map(x=>x.getAttribute('href'));
	return {result,fullLinks};
});
for(const link of clipReport.fullLinks){
	const response=await page.request.head(base+link,{timeout:15000});
	if(!response.ok())failed.push([response.status(),link]);
}
console.log(JSON.stringify({selected:names,original,paused,clipReport,errors,failed},null,2));
await browser.close();
if(names.length!==7||clipReport.result.length!==9||
	clipReport.result.some(x=>Math.abs(x.duration-25)>.05)||
	clipReport.fullLinks.length!==6||
	!paused.includes('Paused')||errors.length||failed.length)process.exitCode=1;
