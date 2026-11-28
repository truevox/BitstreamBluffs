#!/usr/bin/env node
/** Browser proof: exact original OGG stem SHAs, source-time resonators, A/B,
 * simulated landings and corrupted source refusal. No persistent audio writes.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.BITSTREAM_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../public');
const packRelative='music/packs/33_local-one-more-run-bitstream-bluffs';
const originalPack=path.join(root,packRelative);
const originalSource=process.env.BITSTREAM_FULL_SOURCE_PACK ?
	path.resolve(process.env.BITSTREAM_FULL_SOURCE_PACK):originalPack;
const digest=x=>createHash('sha256').update(x).digest('hex');
assert.equal(digest(await readFile(path.join(originalPack,'pack.json'))),
	digest(await readFile(path.join(originalSource,'pack.json'))));
let corruptNextOgg=false;
const requests=[];
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
	'.json':'application/json','.ogg':'audio/ogg'};
const server=createServer(async(req,res)=>{
	const url=new URL(req.url||'/','http://127.0.0.1');
	let requestPath=decodeURIComponent(url.pathname).replace(/\/+$/,'');
	if(requestPath==='/music-review/crystal-harmony')requestPath+='/index.html';
	if(requestPath.includes('..')||!requestPath.startsWith('/')){
		res.writeHead(403).end();return;
	}
	const ogg=requestPath.startsWith('/'+packRelative+'/')&&requestPath.endsWith('.ogg');
	const base=ogg?originalSource:root;
	const file=path.resolve(base,ogg?path.basename(requestPath):requestPath.slice(1));
	if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
	try{
		let bytes=await readFile(file);
		if(ogg){
			requests.push(requestPath);
			if(corruptNextOgg){bytes=Buffer.from(bytes);bytes[52]^=0xff;corruptNextOgg=false;}
		}
		res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'}).end(bytes);
	}catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
let browser;
try{
	browser=await chromium.launch({headless:true,
		executablePath:process.env.BITSTREAM_CHROMIUM||undefined,
		args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
	const page=await browser.newPage();
	const errors=[];page.on('pageerror',e=>errors.push(e.message));
	await page.goto(`http://127.0.0.1:${server.address().port}/music-review/crystal-harmony/`);
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent.startsWith('Ready:'),null,{timeout:25000});
	assert.match(await page.locator('#source').innerText(),/699 250ms original-source/);
	assert.match(await page.locator('#source').innerText(),/no verified meter or tuning/);
	assert.equal(await page.locator('#passage').inputValue(),'6');
	await page.locator('#play').click();
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('Playing unchanged 6 source OGG stems'),null,{timeout:30000});
	assert.ok(requests.some(x=>x.endsWith('/0000-guitar.ogg')));
	assert.ok(requests.some(x=>x.endsWith('/0001-guitar.ogg')));
	assert.ok(requests.some(x=>x.endsWith('/0001-vocals.ogg')));
	assert.match(await page.locator('#now').innerText(),/Original-source time/);
	await page.locator('#shimmer').uncheck();
	assert.match(await page.locator('#status').innerText(),/shimmer OFF/);
	await page.locator('#shimmer').check();
	assert.match(await page.locator('#status').innerText(),/shimmer ON/);
	await page.locator('#wet').fill('70');
	assert.equal(await page.locator('#wetLabel').innerText(),'70%');
	await page.locator('#land').click();
	assert.match(await page.locator('#status').innerText(),/(Impact-scaled ORIGINAL-harmony bell|No confident source harmony)/);
	await page.locator('#stop').click();
	await page.selectOption('#passage','3');
	await page.selectOption('#mix','harmony');
	await page.locator('#play').click();
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('Playing unchanged 3 source OGG stems'),null,{timeout:30000});
	assert.ok(requests.some(x=>x.endsWith('/0003-piano.ogg')));
	assert.ok(requests.some(x=>x.endsWith('/0004-other.ogg')));
	await page.locator('#stop').click();
	// Choose a third *uncached* source passage, tampering with its first OGG.
	corruptNextOgg=true;
	await page.selectOption('#passage','1');
	await page.locator('#play').click();
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('SHA-256 mismatch'),null,{timeout:30000});
	assert.match(await page.locator('#status').innerText(),/Playback unavailable: Original source SHA-256 mismatch/);
	assert.deepEqual(errors,[]);
	console.log('CRYSTAL_BROWSER_PASS exact original OGG decode; cross-segment 16.4s original source; dry/wet live A/B; source-pitch landing bells; 45.7s multi-stem; tampered original OGG rejected; zero JS errors');
	console.log('OGG_REQUESTS',requests.length);
}finally{
	if(browser)await browser.close();
	await new Promise(done=>server.close(done));
}
