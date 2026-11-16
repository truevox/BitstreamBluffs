import { chromium } from 'playwright';

const browser=await chromium.launch({
	headless:true,executablePath:'/usr/bin/chromium',
	args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader',
		'--autoplay-policy=no-user-gesture-required'],
});
const page=await browser.newPage({viewport:{width:1366,height:900}});
const errors=[],failed=[];
page.on('pageerror',error=>errors.push(String(error)));
page.on('response',res=>{if(res.status()>=400)failed.push([res.status(),res.url()]);});
await page.goto('http://192.168.86.223:8181/tools/music/audition-v3/',{waitUntil:'networkidle',timeout:30000});
await page.waitForFunction(()=>document.querySelectorAll('[data-voice]').length===2,{timeout:20000});
await page.locator('#play').click();
await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('Playing synchronized'),{timeout:30000});
await page.waitForTimeout(700);
await page.locator('[data-voice="vertigo-vents"]').click();
await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('Now playing'),{timeout:20000});
const v3=await page.locator('#current').textContent();
const positionBefore=await page.locator('#position').textContent();
await page.locator('#revision').click();
await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('Now playing'),{timeout:20000});
const v2=await page.locator('#current').textContent();
await page.locator('#revision').click();
await page.waitForFunction(()=>document.querySelector('#current')?.textContent?.includes('V1'),{timeout:20000});
const v1=await page.locator('#current').textContent();
const positionAfter=await page.locator('#position').textContent();
await page.locator('[data-voice="candy-cane-canyon"]').click();
await page.waitForFunction(()=>document.querySelector('#current')?.textContent?.includes('Hyperpop'),{timeout:20000});
await page.locator('#revision').click();
await page.waitForFunction(()=>document.querySelector('#current')?.textContent?.includes('V3'),{timeout:20000});
const candy=await page.locator('#current').textContent();
await page.locator('#original').click();
await page.waitForFunction(()=>document.querySelector('#current')?.textContent?.includes('original vocal'),{timeout:20000});
const original=await page.locator('#current').textContent();
await page.locator('#play').click();
const paused=await page.locator('#status').textContent();
await page.screenshot({path:'/tmp/bitstream-v3-audition.png',fullPage:true});
console.log(JSON.stringify({voices:await page.locator('[data-voice]').count(),
	v3,v2,v1,candy,original,positionBefore,positionAfter,paused,errors,failed},null,2));
await browser.close();
if(errors.length||failed.length||!v3.includes('V3')||!v2.includes('V2')||!v1.includes('V1')||
	!candy.includes('V3')||!original.includes('original vocal'))process.exitCode=1;
