#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.STEAMWORKS_URL||'http://127.0.0.1:5173/tools/music/steamworks-audition.html';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader',
		'--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage(),errors=[];
	if(process.env.STEAMWORKS_MOBILE==='1')await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2});
	page.on('pageerror',e=>errors.push(String(e)));
	page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
	page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
	await page.goto(url,{waitUntil:'networkidle2',timeout:25000});
	assert.equal(await page.$eval('#weight-value',e=>e.textContent),'125%');
	assert.equal(await page.$eval('#steam-value',e=>e.textContent),'150%');
	assert.equal(await page.$eval('#metal-value',e=>e.textContent),'135%');
	assert.equal(await page.$eval('#accent-value',e=>e.textContent),'100%');
	assert.equal(await page.$eval('#speed-value',e=>e.textContent),'900 px/s');
	await page.click('#load');
	await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Ready:'),
		{timeout:16000});
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Stop/);
	await page.waitForFunction(()=>document.getElementById('accent-status').textContent.includes('Original recording accents:'),
		{polling:150,timeout:10000});
	const actual=await page.$eval('#accent-status',e=>e.textContent);
	assert.match(actual,/audible gear clicks: [1-9]/); // actual source-driven, not manual test

	await page.$eval('#speed',e=>{e.value='1500';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#speed-value',e=>e.textContent),'1500 px/s');
	assert.match(await page.$eval('#cycle',e=>e.textContent),/9\.4 cycles\/s/);
	await page.$eval('#weight',e=>{e.value='165';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#weight-value',e=>e.textContent),'165%');
	await page.$eval('#steam',e=>{e.value='180';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#steam-value',e=>e.textContent),'180%');
	await page.$eval('#metal',e=>{e.value='190';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#metal-value',e=>e.textContent),'190%');
	await page.click('#solo');
	assert.equal(await page.$eval('#solo',e=>e.getAttribute('aria-pressed')),'true');
	await page.$eval('#accent',e=>{e.value='170';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#accent-value',e=>e.textContent),'170%');
	await page.click('#auto-accent');
	assert.equal(await page.$eval('#auto-accent',e=>e.getAttribute('aria-pressed')),'false');
	await page.click('#auto-accent');
	await page.click('#accent-hit');
	assert.match(await page.$eval('#status',e=>e.textContent),/TIK!/);
	await page.click('#takeoff');
	assert.match(await page.$eval('#phase',e=>e.textContent),/Airborne/);
	await page.click('#land');
	assert.match(await page.$eval('#phase',e=>e.textContent),/Grounded/);
	await page.click('#vent');
	assert.match(await page.$eval('#status',e=>e.textContent),/PSSHHHHT/);
	await page.click('#impact');
	assert.match(await page.$eval('#status',e=>e.textContent),/KLA-CHUNK/);
	await page.click('#dry');
	assert.equal(await page.$eval('#dry',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#dry');
	await page.click('#solo');
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Play/);
	assert.deepEqual(errors,[]);
	console.log('STEAMWORKS_REAL_ORIGINAL_OGG_CHROMIUM_SMOKE_PASS',url);
}finally{await browser.close();}
