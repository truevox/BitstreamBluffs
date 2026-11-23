#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.CRYSTAL_URL||'http://127.0.0.1:5173/tools/music/crystallattice-audition.html';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try {
	const page=await browser.newPage(),errors=[];
	if(process.env.CRYSTAL_MOBILE==='1')
		await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2});
	page.on('pageerror',e=>errors.push(String(e)));
	page.on('response',r=>{
		if(r.status()>=400&&/crystal|scrapheap-audition|assets\//.test(r.url()))
			errors.push(r.status()+' '+r.url());
	});
	await page.goto(url,{waitUntil:'networkidle2',timeout:22000});
	await page.click('#load');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Ready.'),{timeout:17000});
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Stop/);
	await page.$eval('#strength',e=>{e.value='170';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#strength-value',e=>e.textContent),'170%');
	await page.click('#takeoff');
	assert.match(await page.$eval('#open-value',e=>e.textContent),/100%/);
	await page.click('#scan');
	assert.match(await page.$eval('#chroma-result',e=>e.textContent),/bass|No confident/);
	await page.click('#land');
	assert.match(await page.$eval('#open-value',e=>e.textContent),/0%/);
	assert.match(await page.$eval('#status',e=>e.textContent),/Landing/);
	await page.click('#impact');
	await page.click('#dry');
	assert.equal(await page.$eval('#dry',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#dry');
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Play/);
	assert.deepEqual(errors,[]);
	console.log('CRYSTALLATTICE_CHROMIUM_BROWSER_SMOKE_PASS',url);
} finally {await browser.close();}
