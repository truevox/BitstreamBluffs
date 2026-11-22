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
	await page.click('#takeoff');
	assert.equal(await page.$eval('#hard', e=>e.disabled),false);
	await page.click('#hard');
	assert.match(await page.$eval('#status', e=>e.textContent),/Hard landing/);
	await page.click('#bypass');
	assert.equal(await page.$eval('#bypass',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#bypass');
	await page.$eval('#speed', e=> { e.value='1120';e.dispatchEvent(new Event('input',{bubbles:true})); });
	await page.click('#takeoff');
	await page.click('#soft');
	assert.match(await page.$eval('#status', e=>e.textContent),/Soft landing/);
	assert.deepEqual(errors,[]);
	console.log('SCRAPHEAP_LIVE_BROWSER_SMOKE_PASS',url);
} finally {
	await browser.close();
}
