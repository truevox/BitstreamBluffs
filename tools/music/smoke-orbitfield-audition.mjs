#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const url=process.env.ORBITFIELD_URL||'http://127.0.0.1:19003/tools/music/orbitfield-audition.html';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:[
	'--no-sandbox','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try{
	const page=await browser.newPage(),errors=[];
	if(process.env.ORBITFIELD_MOBILE==='1')
		await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
	page.on('pageerror',e=>errors.push(e.message));
	page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
	page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
	await page.goto(url,{waitUntil:'networkidle2',timeout:25000});
	for(const [id,text] of [['spread-value','115%'],['drift-value','100%'],
		['shock-value','125%'],['airlock-value','80%'],['gravity-value','630 px/s²']])
		assert.equal(await page.$eval('#'+id,e=>e.textContent),text);
	await page.click('#load');
	await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Five original recordings ready'),
		{timeout:19000});
	await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Stop/);
	for(const [id,value,out] of [['spread','155','spread-value'],['drift','170','drift-value'],
		['shock','165','shock-value'],['airlock','125','airlock-value']]){
		await page.$eval('#'+id,(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},value);
		assert.equal(await page.$eval('#'+out,e=>e.textContent),value+'%');
	}
	await page.click('#takeoff');
	assert.match(await page.$eval('#phase',e=>e.textContent),/Orbiting/);
	await page.$eval('#altitude',e=>{e.value='700';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#altitude-value',e=>e.textContent),'700 px');
	assert.match(await page.$eval('#openness',e=>e.textContent),/[1-9]\d?%|100%/);
	await page.$eval('#gravity',e=>{e.value='500';e.dispatchEvent(new Event('input',{bubbles:true}));});
	assert.equal(await page.$eval('#gravity-value',e=>e.textContent),'500 px/s²');
	await page.click('#dry');
	assert.equal(await page.$eval('#dry',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#dry');
	await page.click('#solo');
	assert.equal(await page.$eval('#solo',e=>e.getAttribute('aria-pressed')),'true');
	await page.click('#land');
	assert.match(await page.$eval('#status',e=>e.textContent),/WHUUMM/);
	assert.equal(await page.$eval('#openness',e=>e.textContent),'0%');
	await page.click('#eject-test');
	assert.match(await page.$eval('#status',e=>e.textContent),/PFFT/);
	await page.click('#reentry-test');
	assert.match(await page.$eval('#status',e=>e.textContent),/WHUUMM/);
	await page.click('#solo');await page.click('#play');
	assert.match(await page.$eval('#play',e=>e.textContent),/Play/);
	assert.deepEqual(errors,[]);
	console.log('SPACE_ORBITFIELD_REAL_ORIGINAL_STEMS_BROWSER_PASS',url);
}finally{await browser.close();}
