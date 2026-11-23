#!/usr/bin/env node
/** Real Chromium original-source audio lab, normal + mobile viewport. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.JELLYBLOOM_URL||'http://127.0.0.1:18995/tools/music/jellybloom-audition.html';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:[
	'--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader',
	'--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage(),errors=[];
	if(process.env.JELLYBLOOM_MOBILE==='1')
		await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2});
	page.on('pageerror',error=>errors.push(String(error)));
	page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
	page.on('response',res=>{if(res.status()>=400)errors.push(res.status()+' '+res.url());});
	await page.goto(url,{waitUntil:'networkidle2',timeout:27000});
	for(const [id,text] of [['buoyancy-value','135%'],['float-value','100%'],
		['spring-value','130%'],['lift-value','95%']])
		assert.equal(await page.$eval('#'+id,e=>e.textContent),text);
	await page.click('#load');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Loaded all five'),
		{timeout:20000});
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Stop/);
	for(const [id,value,text] of [['buoyancy','180','180%'],['float','165','165%'],
		['spring','170','170%'],['lift-level','145','145%']]){
		await page.$eval('#'+id,(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},value);
		const out=id==='lift-level'?'lift-value':id==='float'?'float-value':id+'-value';
		assert.equal(await page.$eval('#'+out,e=>e.textContent),text);
	}
	await page.click('#takeoff');
	assert.match(await page.$eval('#phase',e=>e.textContent),/Floating/);
	await page.click('#dry');
	assert.equal(await page.$eval('#dry',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#dry');
	await page.click('#land');
	assert.match(await page.$eval('#phase',e=>e.textContent),/Grounded/);
	assert.match(await page.$eval('#status',e=>e.textContent),/BWOOOING/);
	await page.click('#solo');
	assert.equal(await page.$eval('#solo',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#impact');
	assert.match(await page.$eval('#status',e=>e.textContent),/BWOOOING/);
	await page.click('#lift');
	assert.match(await page.$eval('#status',e=>e.textContent),/FWOOO/);
	await page.click('#solo');
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Play/);
	assert.deepEqual(errors,[]);
	console.log('JELLYBLOOM_REAL_ORIGINAL_STEMS_CHROMIUM_SMOKE_PASS',url);
}finally{await browser.close();}
