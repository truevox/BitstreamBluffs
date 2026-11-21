#!/usr/bin/env node
/** Chromium E2E of original OGG fetch/decode/click playback, with hash-failure gate.
 *
 * In a sparse checkout, set BITSTREAM_FULL_SOURCE_PACK to an existing pack
 * directory that contains OGGs. This only reads files and serves localhost.
 * On a normal full checkout the OGGs are already inside public/.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BITSTREAM_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const packRelative = 'music/packs/33_local-one-more-run-bitstream-bluffs';
const originalPack = path.join(root, packRelative);
const alternate = process.env.BITSTREAM_FULL_SOURCE_PACK;
const sourcePack = alternate ? path.resolve(alternate) : originalPack;
const manifest = await readFile(path.join(originalPack,'pack.json'));
assert.equal(createHash('sha256').update(manifest).digest('hex'),
	createHash('sha256').update(await readFile(path.join(sourcePack,'pack.json'))).digest('hex'),
	'Existing full audio pack must exactly match sparse checkout manifest');
let tamperNextSource = false;
const oggRequests = [];
const mime = {'.html':'text/html','.json':'application/json','.js':'text/javascript',
	'.mjs':'text/javascript','.ogg':'audio/ogg'};
const server = createServer(async (req, res) => {
	const url = new URL(req.url || '/', 'http://127.0.0.1');
	let requestPath = decodeURIComponent(url.pathname).replace(/\/+$/,'');
	if (requestPath === '/music-review/downbeat-review') requestPath += '/index.html';
	if (requestPath.includes('..') || !requestPath.startsWith('/')) {
		res.writeHead(403).end(); return;
	}
	const isSource = requestPath.startsWith('/'+packRelative+'/') && requestPath.endsWith('.ogg');
	const local = path.resolve(isSource ? sourcePack : root,
		isSource ? path.basename(requestPath) : requestPath.slice(1));
	if (!local.startsWith((isSource ? sourcePack : root)+path.sep)) {
		res.writeHead(403).end(); return;
	}
	try {
		let bytes = await readFile(local);
		if (isSource) {
			oggRequests.push(requestPath);
			if (tamperNextSource) {
				bytes = Buffer.from(bytes); bytes[40] ^= 0xff;
				tamperNextSource = false;
			}
		}
		res.writeHead(200, {'content-type': mime[path.extname(requestPath)] || 'application/octet-stream'}).end(bytes);
	} catch { res.writeHead(404).end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
	browser = await chromium.launch({headless:true,
		executablePath:process.env.BITSTREAM_CHROMIUM || undefined,
		args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
	const page = await browser.newPage();
	const jsErrors = [];page.on('pageerror', error => jsErrors.push(error.message));
	await page.goto('http://127.0.0.1:'+server.address().port+'/music-review/downbeat-review/');
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent.startsWith('Ready:'));
	assert.match(await page.locator('#status').innerText(),/15 original-source research windows/);
	assert.match(await page.locator('#harmony').innerText(),/HARMONY CROSS-CHECK/);
	assert.match(await page.locator('#phaseEvidence').innerText(),/SOURCE PHASE CONTINUITY \(UNVERIFIED\)/);
	assert.match(await page.locator('#phaseEvidence').innerText(),/not verified musical beats/);
	await page.selectOption('#mix','drums');
	await page.locator('#play').click();
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('Playing original drums'));
	assert.equal(oggRequests.some(s=>s.endsWith('/0000-drums.ogg')),true);
	await page.locator('#offsets button').nth(2).click();
	assert.match(await page.locator('#candidate').innerText(),/bar-offset 2/);
	await page.selectOption('#window','10');
	await page.locator('#play').click();
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('Playing original drums'));
	assert.equal(oggRequests.some(s=>s.endsWith('/0010-drums.ogg')),true);
	await page.locator('#stop').click();
	await page.selectOption('#window','14');
	await page.selectOption('#mix','full');
	await page.locator('#play').click();
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('Playing original full'),null,{timeout:25000});
	assert.equal(oggRequests.filter(s=>s.includes('/0014-')).length,6);
	await page.locator('#stop').click();
	// Always fail closed on an actual OGG that differs from the source fingerprint.
	tamperNextSource = true;
	await page.selectOption('#window','9');
	await page.selectOption('#mix','drums');
	await page.locator('#play').click();
	await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('SHA-256 mismatch'),null,{timeout:20000});
	assert.match(await page.locator('#status').innerText(),/Playback unavailable: Original audio SHA-256 mismatch/);
	assert.deepEqual(jsErrors,[]);
	console.log('BROWSER_PASS real OGG decoded for opening, 120s and short ending; all six source stems; four-offset switch; exact source SHA tamper rejected; no JS errors');
	console.log('ORIGINAL_OGG_REQUESTS',oggRequests.length);
} finally {
	if (browser) await browser.close();
	await new Promise(resolve=>server.close(resolve));
}
