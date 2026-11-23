#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.SCRAP_CLANG_URL||'http://127.0.0.1:5173/tools/music/scrap-clangs-audition.html';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage(),errors=[];
	if(process.env.SCRAP_CLANG_MOBILE==='1')
		await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2});
	page.on('pageerror',e=>errors.push(String(e)));
	page.on('response',r=>{
		if(r.status()>=400&&/scrap-clangs|scrapheap-audition|assets\//.test(r.url()))
			errors.push(r.status()+' '+r.url());
	});
	await page.goto(url,{waitUntil:'networkidle2',timeout:23000});
	await page.click('#load');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('loaded'),{timeout:17000});
	await page.click('#phrase');
	assert.match(await page.$eval('#play',e=>e.textContent),/Stop/);
	assert.equal(await page.$eval('#splock-value',e=>e.textContent),'160%');
	assert.equal(await page.$eval('#suction-value',e=>e.textContent),'80%');
	assert.equal(await page.$eval('#clang-level-value',e=>e.textContent),'100%');
	await page.click('#auto-clangs');
	assert.equal(await page.$eval('#auto-clangs',e=>e.getAttribute('aria-pressed')),'false');
	await page.waitForFunction(()=>{
		document.querySelector('#scan-pitch').click();
		return document.querySelector('#pitch-status').textContent.includes('Current original-bass spectral');
	},{polling:130,timeout:4500});
	const pitch=await page.$eval('#pitch-status',e=>e.textContent);
	assert.match(pitch,/MIDI/);
	await page.click('#pitch-hit');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('KLANG'),
		{polling:120,timeout:5200});
	await page.$eval('#clang-level',e=>{e.value='170';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#clang-level-value',e=>e.textContent),'170%');
	await page.$eval('#clang-density',e=>{e.value='150';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#clang-density-value',e=>e.textContent),'150%');
	await page.click('#auto-clangs');
	assert.equal(await page.$eval('#auto-clangs',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#takeoff');
	assert.equal(await page.$eval('#pitch-hit',e=>e.disabled),true);
	await page.click('#hard');
	assert.equal(await page.$eval('#pitch-hit',e=>e.disabled),false);
	await page.click('#bypass');
	assert.equal(await page.$eval('#bypass',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#bypass');
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Play/);
	assert.deepEqual(errors,[]);
	console.log('SCRAP_ON_PITCH_CHROMIUM_BROWSER_SMOKE_PASS',url);
}finally{await browser.close();}
