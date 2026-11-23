#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.VENTFORGE_URL||'http://127.0.0.1:18997/tools/music/ventforge-audition.html';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage(),errors=[];
	if(process.env.VENTFORGE_MOBILE==='1')
		await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
	page.on('pageerror',e=>errors.push(e.message));
	page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
	page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
	await page.goto(url,{waitUntil:'networkidle2',timeout:25000});
	for(const [id,text] of [['rumble-value','125%'],['shimmer-value','125%'],
		['blast-value','130%'],['crust-value','80%']])
		assert.equal(await page.$eval('#'+id,e=>e.textContent),text);
	await page.click('#load');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Original five stereo'),
		{timeout:20000});
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Stop/);
	for(const [id,value] of [['rumble','170'],['shimmer','185'],['blast','190'],['crust','155']]){
		await page.$eval('#'+id,(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},value);
		assert.equal(await page.$eval('#'+id+'-value',e=>e.textContent),value+'%');
	}
	await page.$eval('#rising',e=>{e.value='1300';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#rising-value',e=>e.textContent),'1300 px/s upward');
	await page.click('#solo');
	assert.equal(await page.$eval('#solo',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#takeoff');
	assert.match(await page.$eval('#status',e=>e.textContent),/does NOT fire a geyser/);
	await page.click('#erupt');
	assert.match(await page.$eval('#status',e=>e.textContent),/WHUUMMP/);
	await page.click('#land');
	assert.match(await page.$eval('#status',e=>e.textContent),/KRAK-KRR/);
	await page.click('#dry');
	assert.equal(await page.$eval('#dry',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#dry');
	await page.click('#solo');
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Play/);
	assert.deepEqual(errors,[]);
	console.log('VENTFORGE_ORIGINAL_STEM_REAL_CHROMIUM_AUDITION_PASS',url);
}finally{await browser.close();}
