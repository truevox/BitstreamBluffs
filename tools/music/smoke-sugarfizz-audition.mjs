#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.SUGARFIZZ_URL||'http://127.0.0.1:18999/tools/music/sugarfizz-audition.html';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage(),errors=[];
	if(process.env.SUGARFIZZ_MOBILE==='1')
		await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
	page.on('pageerror',e=>errors.push(e.message));
	page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
	page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
	await page.goto(url,{waitUntil:'networkidle2',timeout:27000});
	for(const [id,text] of [['sweet-value','125%'],['fizz-value','150%'],
		['pop-value','130%'],['wrapper-value','90%']])
		assert.equal(await page.$eval('#'+id,e=>e.textContent),text);
	await page.click('#load');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Five original stereo'),{timeout:18000});
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Stop/);
	for(const [id,value,out] of [['sweet','165','sweet-value'],['fizz','175','fizz-value'],
		['pop-level','185','pop-value'],['wrapper-level','150','wrapper-value']]){
		await page.$eval('#'+id,(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},value);
		assert.equal(await page.$eval('#'+out,e=>e.textContent),value+'%');
	}
	await page.$eval('#speed',el=>{el.value='1750';el.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#speed-value',e=>e.textContent),'1750 px/s');
	await page.click('#solo');
	assert.equal(await page.$eval('#solo',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#dry');
	assert.equal(await page.$eval('#dry',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#dry');
	await page.click('#takeoff');
	assert.match(await page.$eval('#phase',e=>e.textContent),/Airborne/);
	await page.click('#land');
	assert.match(await page.$eval('#status',e=>e.textContent),/POP-KRRRRK/);
	await page.click('#wrapper');
	assert.match(await page.$eval('#status',e=>e.textContent),/CRRRT/);
	await page.click('#pop');
	assert.match(await page.$eval('#status',e=>e.textContent),/POP-KRRRRK/);
	await page.click('#solo');
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Play/);
	assert.deepEqual(errors,[]);
	console.log('CANDY_SUGARFIZZ_REAL_ORIGINAL_STEMS_CHROMIUM_PASS',url);
}finally{await browser.close();}
