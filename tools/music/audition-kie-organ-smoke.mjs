import {chromium} from 'playwright';
const browser=await chromium.launch({
	headless:true,executablePath:'/usr/bin/chromium',
	args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader',
		'--autoplay-policy=no-user-gesture-required'],
});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],failed=[];
page.on('pageerror',error=>errors.push(String(error)));
page.on('response',response=>{
	if(response.status()>=400)failed.push([response.status(),response.url()]);
});
const url='http://100.115.120.66:8181/tools/music/audition-kie-organ/';
await page.goto(url,{waitUntil:'networkidle',timeout:30000});
await page.waitForFunction(()=>document.querySelectorAll('.voice[data-voice]').length===3,{timeout:10000});
await page.locator('#play').click();
await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Playing synchronized'),{timeout:18000});
const names=[];
for(const voiceId of ['kie-organ-take-2','v3-church-organ','kie-organ-take-1']){
	await page.locator('[data-voice="'+voiceId+'"]').click();
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Now playing'),{timeout:18000});
	names.push(await page.locator('#current').textContent());
}
await page.locator('#original').click();
await page.waitForFunction(()=>document.querySelector('#current').textContent.includes('original vocal'),{timeout:15000});
const original=await page.locator('#current').textContent();
await page.locator('#play').click();
const paused=await page.locator('#status').textContent();
const stats=await page.evaluate(async()=>{
	const json=await(await fetch('/music-audition-kie-organ/gallery.json')).json();
	const ctx=new AudioContext();
	const durations=[];
	for(const name of [...json.voices.map(v=>v.file),json.originalVocal,json.backing]){
		const data=await(await fetch('/music-audition-kie-organ/'+name)).arrayBuffer();
		const decoded=await ctx.decodeAudioData(data);
		durations.push({name,duration:decoded.duration});
	}
	await ctx.close();
	const links=[...document.querySelectorAll('a[href$=".mp3"]')].map(x=>x.getAttribute('href'));
	return {durations,links};
});
for(const link of stats.links){
	const response=await page.request.get('http://100.115.120.66:8181'+link,{timeout:20000});
	if(!response.ok())failed.push([response.status(),link]);
}
console.log(JSON.stringify({names,original,paused,stats,errors,failed},null,2));
await browser.close();
if(errors.length||failed.length||names.length!==3||
	stats.durations.some(x=>Math.abs(x.duration-25)>.05)||
	stats.links.length!==2||
	!paused.includes('Paused'))process.exitCode=1;
