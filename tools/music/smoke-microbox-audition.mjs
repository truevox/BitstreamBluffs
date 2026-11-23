#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.MICROBOX_URL||'http://127.0.0.1:5173/tools/music/microbox-audition.html';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage(),errors=[];
	page.on('pageerror',e=>errors.push(String(e)));
	page.on('response',r=>{
		if(r.status()>=400&&/microbox|scrapheap-audition|assets\//.test(r.url()))
			errors.push(r.status()+' '+r.url());
	});
	await page.goto(url,{waitUntil:'networkidle2',timeout:22000});
	assert.equal(await page.$eval('#bee-status',e=>e.textContent.includes('Bee 0')),true);
	await page.click('#load');
	await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Ready:'),{timeout:16000});
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Stop/);
	await page.$eval('#box',e=>{e.value='160';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#box-value',e=>e.textContent),'160%');
	await page.click('#takeoff');
	assert.match(await page.$eval('#open-value',e=>e.textContent),/100%/);
	await page.click('#land');
	assert.match(await page.$eval('#open-value',e=>e.textContent),/0%/);
	await page.click('#impact');
	assert.match(await page.$eval('#status',e=>e.textContent),/KLOCK/);
	await page.$eval('#bees',e=>{e.value='180';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#bees-value',e=>e.textContent),'180%');
	await page.$eval('#rider',e=>{e.value='90';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#rider-value',e=>e.textContent),'90%');
	await page.$eval('#camera',e=>{e.value='6000';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.match(await page.$eval('#bee-status',e=>e.textContent),/No background bee/);
	await page.$eval('#camera',e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.match(await page.$eval('#bee-status',e=>e.textContent),/Bee 0/);
	await page.click('#dry');
	assert.equal(await page.$eval('#dry',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#dry');
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Play/);
	assert.deepEqual(errors,[]);
	console.log('MICROBOX_CHROMIUM_BROWSER_SMOKE_PASS',url);
}finally{await browser.close();}
