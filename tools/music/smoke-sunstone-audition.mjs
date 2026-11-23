#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.SUNSTONE_URL||'http://127.0.0.1:19006/tools/music/sunstone-audition.html';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:[
	'--no-sandbox','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage(),errors=[];
	if(process.env.SUNSTONE_MOBILE==='1')
		await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
	page.on('pageerror',e=>errors.push(e.message));
	page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
	page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
	await page.goto(url,{waitUntil:'networkidle2',timeout:26000});
	for(const [id,label] of [['resonance-value','125%'],['drift-value','100%'],
		['gust-value','120%'],['stone-value','115%'],['gravity-value','738 px/s²']])
		assert.equal(await page.$eval('#'+id,e=>e.textContent),label);
	await page.click('#load');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('All five original stereo'),
		{timeout:20000});
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Stop/);
	for(const [id,value,output] of [['resonance','170','resonance-value'],['drift','145','drift-value'],
		['gust-level','160','gust-value'],['stone-level','175','stone-value']]){
		await page.$eval('#'+id,(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},value);
		assert.equal(await page.$eval('#'+output,e=>e.textContent),value+'%');
	}
	// Ordinary jump outside thermal: field remains zero and NO gust.
	await page.click('#zone');
	await page.click('#takeoff');
	assert.match(await page.$eval('#status',e=>e.textContent),/no invented updraft gust/);
	assert.equal(await page.$eval('#loft',e=>e.textContent),'0%');
	await page.click('#zone');
	assert.match(await page.$eval('#status',e=>e.textContent),/WHOOO/);
	await page.$eval('#gravity',e=>{e.value='700';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#gravity-value',e=>e.textContent),'700 px/s²');
	await page.$eval('#ascent',e=>{e.value='900';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#ascent-value',e=>e.textContent),'900 px/s rising');
	assert.match(await page.$eval('#loft',e=>e.textContent),/[1-9]\d?%|100%/);
	await page.click('#dry');assert.equal(await page.$eval('#dry',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#dry');await page.click('#solo');
	assert.equal(await page.$eval('#solo',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#land');
	assert.match(await page.$eval('#status',e=>e.textContent),/TOK/);
	assert.equal(await page.$eval('#loft',e=>e.textContent),'0%');
	await page.click('#gust-test');assert.match(await page.$eval('#status',e=>e.textContent),/WHOOO/);
	await page.click('#stone-test');assert.match(await page.$eval('#status',e=>e.textContent),/TOK/);
	await page.click('#solo');await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Play/);
	assert.deepEqual(errors,[]);
	console.log('PYRAMID_SUNSTONE_REAL_ORIGINAL_STEMS_BROWSER_PASS',url);
}finally{await browser.close();}
