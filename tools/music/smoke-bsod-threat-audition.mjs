/** Private sound-design A/B sandbox: browser smoke, no music pipeline approval. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin=process.env.AUDITION_URL||'http://100.115.120.66:8208/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
]});
const page=await browser.newPage({viewport:{width:1100,height:900}});
const errors=[],badHttp=[];
page.on('pageerror',error=>errors.push(String(error)));
page.on('response',r=>{if(r.status()>=400)badHttp.push([r.status(),r.url()])});
try{
	await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>document.querySelector('#song option')?.value, null,{timeout:30000});
	const first=await page.locator('#song').inputValue();
	assert.equal(first,'local-one-more-run-bitstream-bluffs');
	assert.ok((await page.locator('#passage option').count())>=3);
	assert.equal(await page.locator('#danger-value').textContent(),'0%');
	console.log('AUDITION_FIRST_SONG_AND_PASSAGE_CHOICES_PASS');

	await page.locator('#play').click();
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent
		?.startsWith('Playing 6 original stems'),null,{timeout:40000});
	await page.locator('#threat').click();
	assert.equal(await page.locator('#danger-value').textContent(),'97%');
	await page.locator('#clean').click();
	assert.equal(await page.locator('#danger-value').textContent(),'0%');
	await page.locator('#danger').fill('63');
	assert.equal(await page.locator('#danger-value').textContent(),'63%');
	console.log('AUDITION_SIX_REAL_STEMS_AND_LIVE_A_B_DANGER_CONTROLS_PASS');

	await page.locator('#passage').selectOption({index:2});
	assert.match(await page.locator('#status').textContent(),/Press Play/);
	await page.locator('#play').click();
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent
		?.startsWith('Playing 6 original stems'),null,{timeout:40000});
	await page.locator('#melody').selectOption('voice:debutmont');
	await page.locator('#play').click();
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent
		?.startsWith('Playing 6 original stems'),null,{timeout:40000});
	console.log('AUDITION_LATE_PASSAGE_AND_DEBUTMONT_SOURCE_PASS');

	await page.locator('#song').selectOption('WRBGQUqD54U');
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent
		?.includes('Loaded song choices'),null,{timeout:30000});
	await page.locator('#play').click();
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent
		?.startsWith('Playing 6 original stems'),null,{timeout:40000});
	await page.locator('#stop').click();
	assert.equal(await page.locator('#status').textContent(),'Stopped.');
	assert.deepEqual(errors,[]);
	assert.deepEqual(badHttp,[]);
	console.log('AUDITION_CHANGED_SONG_PAUSE_STOP_AND_NO_BROWSER_ERRORS_PASS');
	console.log('PRIVATE_SOUND_DESIGN_AB_BROWSER_SMOKE_PASS',origin);
} finally {await browser.close();}
