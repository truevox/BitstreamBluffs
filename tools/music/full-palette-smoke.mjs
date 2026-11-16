import { chromium } from 'playwright';
const base='http://100.115.120.66:8181';
const errors=[];
const results=[];
const browser=await chromium.launch({
	headless:true,executablePath:'/usr/bin/chromium',
	args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'],
});
for(const song of ['pope','one-more-run']){
	const page=await browser.newPage({viewport:{width:1440,height:900}});
	const bad=[];
	page.on('pageerror',e=>bad.push(['JS',String(e)]));
	page.on('response',r=>{if(r.status()>=400)bad.push(['HTTP',r.status(),r.url()]);});
	const url=base+'/tools/music/audition-full-'+song+'/';
	await page.goto(url,{waitUntil:'networkidle',timeout:35000});
	await page.waitForFunction(()=>document.querySelectorAll('.voice[data-voice]').length===12,{timeout:15000});
	const defaultSelection=await page.locator('.voice.active').getAttribute('data-voice');
	const duration=await page.locator('#duration').innerText();
	const gallery=await (await page.request.get(base+'/music-full-'+song+'/gallery.json')).json();
	const urls=[gallery.backing,gallery.originalVocal,...gallery.voices.map(v=>v.file)];
	for(const file of urls){
		const r=await page.request.head(base+'/music-full-'+song+'/'+file,{timeout:15000});
		if(!r.ok()) bad.push(['FILE',file,r.status()]);
	}
	const backing=await page.locator('#backing').isChecked();
	const room=await page.locator('#room').isChecked();
	await page.locator('#play').click();
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Playing synchronized stems'),{timeout:60000});
	const started=await page.locator('#status').innerText();
	const targets=['space-mountain','pyramid-peak','crystal-cavern','vertigo-vents'];
	const switched=[];
	for(const id of targets){
		await page.locator('.voice[data-voice="'+id+'"]').click();
		await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Now playing'),{timeout:45000});
		switched.push(await page.locator('#current').innerText());
	}
	await page.locator('#original').click();
	await page.waitForFunction(()=>document.querySelector('#current').textContent.includes('Maxi'),{timeout:45000});
	const original=await page.locator('#current').innerText();
	await page.locator('#backing').check();
	await page.locator('#room').check();
	await page.locator('#play').click();
	const paused=await page.locator('#status').innerText();
	results.push({song,url,voices:gallery.voices.length,duration,defaultSelection,
		backingInitial:backing,roomInitial:room,started,switched,original,paused,
		assetsVerified:urls.length,errors:bad});
	console.log('CHECKED',song,JSON.stringify(results[results.length-1]));
	await page.close();
}
await browser.close();
console.log('SUMMARY',JSON.stringify(results,null,2));
if(results.length!==2||results.some(x=>x.voices!==12||x.defaultSelection!=='vertigo-vents'||
	x.backingInitial||x.roomInitial||x.switched.length!==4||x.errors.length||
	!x.started.includes('Playing synchronized stems')||!x.paused.includes('Paused')))process.exitCode=1;
