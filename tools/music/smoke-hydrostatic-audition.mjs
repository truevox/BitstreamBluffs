#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.HYDROSTATIC_URL||'http://127.0.0.1:5173/tools/music/hydrostatic-audition.html';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try {
	const page=await browser.newPage(),errors=[];
	page.on('pageerror',e=>errors.push(String(e)));
	page.on('response',r=>{
		if(r.status()>=400&&/hydrostatic|scrapheap-audition|assets\//.test(r.url()))
			errors.push(r.status()+' '+r.url());
	});
	await page.goto(url,{waitUntil:'networkidle2',timeout:20000});
	await page.click('#load');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Ready.'),{timeout:15000});
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Stop/);
	assert.equal(await page.$eval('#contrast-value',e=>e.textContent),'190%');
	assert.equal(await page.$eval('#wave-value',e=>e.textContent),'150%');
	await page.$eval('#contrast',e=>{e.value='195';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#contrast-value',e=>e.textContent),'195%');
	await page.$eval('#wave',e=>{e.value='210';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#wave-value',e=>e.textContent),'210%');
	await page.click('#wave-hit');
	assert.match(await page.$eval('#status',e=>e.textContent),/WWHUMP/);
	await page.$eval('#contrast',e=>{e.value='190';e.dispatchEvent(new Event('input',{bubbles:true}));});
	await page.$eval('#wave',e=>{e.value='150';e.dispatchEvent(new Event('input',{bubbles:true}));});
	const terrain=async value=>page.$eval('#terrain',(e,value)=>{
		e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));
	},value);
	const stored=async()=>Number((await page.$eval('#stored-value',e=>e.textContent)).replace('%',''));
	const audible=async()=>Number((await page.$eval('#audible-value',e=>e.textContent)).replace('%',''));
	await terrain(800);
	const deep=await stored();
	assert(deep>=70,'deep terrain should accumulate pressure');
	await terrain(300);
	assert.equal(await stored(),deep,'uphill must NOT lower stored pressure');
	await page.click('#jump');
	assert.equal(await stored(),deep,'rising jump may not change stored pressure');
	const rising=await audible();
	assert(rising<deep*.6,'upward velocity should give audible relief');
	await page.click('#fall');
	assert((await audible())>rising,'falling should restore pressure');
	await page.click('#land');
	assert.equal(await audible(),deep,'landing restores full pressure');
	await page.click('#bypass');
	assert.equal(await page.$eval('#bypass',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#bypass');
	await page.click('#exit');
	assert.equal(await stored(),0,'explicit biome exit resets stored pressure');
	assert.equal(await audible(),0);
	assert.deepEqual(errors,[]);
	console.log('HYDROSTATIC_BROWSER_SMOKE_PASS',url);
} finally {await browser.close();}
