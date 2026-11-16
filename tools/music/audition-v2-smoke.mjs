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
await page.goto('http://192.168.86.223:8181/tools/music/audition-v2/',{waitUntil:'networkidle',timeout:30000});
await page.waitForFunction(()=>document.querySelectorAll('[data-voice]').length===12,{timeout:20000});
await page.locator('#play').click();
await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('Playing synchronized'),{timeout:30000});
await page.waitForTimeout(700);
await page.locator('[data-voice="crystal-cavern"]').click();
await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('Now playing'),{timeout:20000});
const v2=await page.locator('#current').textContent();
const positionBefore=await page.locator('#position').textContent();
await page.locator('#revision').click();
await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('Now playing'),{timeout:20000});
const v1=await page.locator('#current').textContent();
const positionAfter=await page.locator('#position').textContent();
await page.locator('[data-voice="steampunk-slopes"]').click();
await page.waitForFunction(()=>document.querySelector('#current')?.textContent?.includes('calliope'),{timeout:20000});
await page.locator('#revision').click();
await page.waitForFunction(()=>document.querySelector('#current')?.textContent?.includes('V2'),{timeout:20000});
const steampunk=await page.locator('#current').textContent();
await page.locator('#original').click();
await page.waitForFunction(()=>document.querySelector('#current')?.textContent?.includes('original vocal'),{timeout:20000});
const original=await page.locator('#current').textContent();
await page.locator('#play').click();
const paused=await page.locator('#status').textContent();
await page.screenshot({path:'/tmp/bitstream-v2-audition.png',fullPage:true});
console.log(JSON.stringify({voices:await page.locator('[data-voice]').count(),
	v2,v1,steampunk,original,positionBefore,positionAfter,paused,errors,failed},null,2));
await browser.close();
if(errors.length||failed.length||!v2.includes('V2')||!v1.includes('V1')||
	!steampunk.includes('V2')||!original.includes('original vocal'))process.exitCode=1;
