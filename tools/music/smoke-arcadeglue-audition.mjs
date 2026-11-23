#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.ARCADEGLUE_URL||
	'http://127.0.0.1:19008/tools/music/arcadeglue-audition.html';
const browser=await puppeteer.launch({
	executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--enable-unsafe-swiftshader',
		'--autoplay-policy=no-user-gesture-required']
});
try{
	const page=await browser.newPage(),errors=[];
	if(process.env.ARCADEGLUE_MOBILE==='1')
		await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
	page.on('pageerror',e=>errors.push(e.message));
	page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
	page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
	await page.goto(url,{waitUntil:'networkidle2',timeout:26000});
	assert.equal(await page.$eval('#mode',e=>e.value),'standalone');
	assert.equal(await page.$eval('#intensity-value',e=>e.textContent),'125%');
	assert.equal(await page.$eval('#chop-value',e=>e.textContent),'120%');
	await page.click('#load');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes(
		'Five synchronized original stereo recordings ready'),{timeout:18000});
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Stop/);
	await page.$eval('#intensity',e=>{e.value='155';
		e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#intensity-value',e=>e.textContent),'155%');
	await page.$eval('#chop',e=>{e.value='165';
		e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#chop-value',e=>e.textContent),'165%');
	await page.$eval('#menu',e=>e.click());
	assert.equal(await page.$eval('#menu',e=>e.getAttribute('aria-pressed')),'true');
	assert.equal(await page.$eval('#dry',e=>e.disabled),true);
	assert.match(await page.$eval('#status',e=>e.textContent),/750ms/);
	await page.$eval('#menu',e=>e.click());
	assert.equal(await page.$eval('#menu',e=>e.getAttribute('aria-pressed')),'false');
	assert.equal(await page.$eval('#dry',e=>e.disabled),false);
	assert.match(await page.$eval('#status',e=>e.textContent),/750ms/);
	await page.click('#dry');
	assert.equal(await page.$eval('#dry',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#dry');
	await page.click('#solo');
	assert.equal(await page.$eval('#solo',e=>e.getAttribute('aria-pressed')),'true');
	await page.select('#mode','bridge');
	assert.match(await page.$eval('#progress-help',e=>e.textContent),/True bridge mode/);
	for(const [id,percent,phrase] of [
		['from','0%','OUTGOING BIOME DISSOLVES'],
		['middle','50%','FULL ARCADE CORRIDOR'],
		['to','100%','INCOMING BIOME RECONSTRUCTS']
	]){
		await page.$eval('#'+id,e=>e.click());
		assert.equal(await page.$eval('#progress-value',e=>e.textContent),percent);
		assert.equal(await page.$eval('#now',e=>e.textContent),phrase);
	}
	await page.$eval('#progress',e=>{e.value='36';
		e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#progress-value',e=>e.textContent),'36%');
	await page.select('#mode','standalone');
	assert.equal(await page.$eval('#now',e=>e.textContent),'ARCADE AS ITS OWN BIOME');
	assert.equal(await page.$eval('#progress',e=>e.disabled),true);
	await page.$eval('#solo',e=>e.click());
	await page.$eval('#play',e=>e.click());
	assert.match(await page.$eval('#play',e=>e.textContent),/Play/);
	assert.deepEqual(errors,[]);
	console.log('ARCADE_GLUE_AND_STANDALONE_REAL_ORIGINAL_STEMS_CHROMIUM_PASS',url);
}finally{await browser.close();}
