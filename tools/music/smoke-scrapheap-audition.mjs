#!/usr/bin/env node
/**
 * Smoke the production Scrapheap audition against a running Vite/Netlify site.
 * SCRAPHEAP_URL=http://127.0.0.1:5173/tools/music/scrapheap-audition.html node tools/music/smoke-scrapheap-audition.mjs
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const url = process.env.SCRAPHEAP_URL || 'http://127.0.0.1:5173/tools/music/scrapheap-audition.html';
const browser = await puppeteer.launch({
	executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	page.on('response', response => {
		if (response.status() >= 400 && /scrapheap-audition|assets\//.test(response.url()))
			errors.push(response.status() + ' ' + response.url());
	});
	await page.goto(url, {waitUntil:'networkidle2',timeout:20000});
	await page.click('#load');
	await page.waitForFunction(() => document.querySelector('#status').textContent.includes('loaded.'), {timeout:15000});
	await page.click('#play');
	assert.match(await page.$eval('#play', e=>e.textContent), /Stop/);
	await page.click('#solo');
	assert.equal(await page.$eval('#solo', e=>e.getAttribute('aria-pressed')),'true');
	assert.equal(await page.$eval('#splock-value', e=>e.textContent),'160%');
	assert.equal(await page.$eval('#suction-value', e=>e.textContent),'80%');
	await page.select('#suction-texture','1');
	assert.match(await page.$eval('#status',e=>e.textContent),/Texture B/);
	await page.click('#suction-hit');
	assert.match(await page.$eval('#status', e=>e.textContent),/SLLLORP/);
	await page.select('#suction-texture','0');
	assert.match(await page.$eval('#status',e=>e.textContent),/Texture A/);
	await page.$eval('#suction',e=>{e.value='240';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#suction-value', e=>e.textContent),'240%');
	assert.equal(await page.$eval('#splock-value', e=>e.textContent),'160%');
	await page.click('#suction-hit');
	assert.match(await page.$eval('#status', e=>e.textContent),/SLLLORP/);
	await page.$eval('#suction',e=>{e.value='80';e.dispatchEvent(new Event('input',{bubbles:true}));});
	await page.click('#takeoff');
	assert.match(await page.$eval('#status', e=>e.textContent),/SLLLORP/);
	assert.equal(await page.$eval('#hard', e=>e.disabled),false);
	await page.click('#hard');
	assert.match(await page.$eval('#status', e=>e.textContent),/Hard landing/);
	await page.$eval('#splock', e=> { e.value='155'; e.dispatchEvent(new Event('input',{bubbles:true})); });
	assert.equal(await page.$eval('#splock-value',e=>e.textContent),'155%');
	await page.click('#splock-hit');
	assert.match(await page.$eval('#status', e=>e.textContent),/SPLORP/);
	await page.click('#bypass');
	assert.equal(await page.$eval('#bypass',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#bypass');
	await page.click('#solo');
	assert.equal(await page.$eval('#solo', e=>e.getAttribute('aria-pressed')),'false');
	await page.$eval('#speed', e=> { e.value='1120';e.dispatchEvent(new Event('input',{bubbles:true})); });
	// Scrolling between the upper mixer controls and lower landing buttons
	// can race Puppeteer's synthesized clicks (human clicks are much slower).
	// Center the physical controls and assert their actual state transitions.
	await page.$eval('#takeoff', e => e.scrollIntoView({block:'center',behavior:'instant'}));
	await new Promise(resolve=>setTimeout(resolve,150));
	await page.click('#takeoff');
	assert.match(await page.$eval('#status', e=>e.textContent),/SLLLORP/);
	assert.equal(await page.$eval('#soft', e=>e.disabled),false);
	await page.click('#soft');
	assert.equal(await page.$eval('#soft', e=>e.disabled),true);
	assert.match(await page.$eval('#status', e=>e.textContent),/Soft landing/);
	assert.deepEqual(errors,[]);
	console.log('SCRAPHEAP_LIVE_BROWSER_SMOKE_PASS',url);
} finally {
	await browser.close();
}
