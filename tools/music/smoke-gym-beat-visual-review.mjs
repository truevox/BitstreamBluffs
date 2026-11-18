/** Offline Chromium inspection of source-bound, research-only SVG HTML.
 * No network connection or audio file is made available to the browser.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const path=fileURLToPath(new URL('../../docs/music-review/one-more-run-timestamped-onsets-20261118.html',import.meta.url));
const html=readFileSync(path,'utf8');
assert.ok(html.includes('UNVERIFIED'));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
	const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
	const external=[];
	page.on('request',req=>{
		if(!req.url().startsWith('file://'))external.push(req.url());
	});
	const errors=[];
	page.on('pageerror',e=>errors.push(String(e)));
	await page.goto(pathToFileURL(path).href,{waitUntil:'load'});
	const snapshot=await page.evaluate(()=>{
		const evidence=JSON.parse(document.getElementById('unverified-source-provenance').textContent);
		const panels=[...document.querySelectorAll('section')];
		return {
			evidence,
			panels:panels.length,
			svgs:document.querySelectorAll('svg').length,
			waveforms:document.querySelectorAll('polyline').length,
			tickLanes:document.querySelectorAll('svg .accent-slow,svg .accent-fast,svg .accent-fft').length,
			panelRects:panels.map(p=>({
				width:p.querySelector('svg').getBoundingClientRect().width,
				height:p.querySelector('svg').getBoundingClientRect().height,
				heading:p.querySelector('h2').textContent,
			})),
			scripts:[...document.scripts].map(x=>x.type),
		};
	});
	assert.equal(snapshot.evidence.status,'UNVERIFIED_VISUAL_REVIEW_ONLY');
	assert.equal(snapshot.evidence.canAuthorizeGame,false);
	assert.equal(snapshot.evidence.windowCount,8);
	assert.equal(snapshot.panels,8);
	assert.equal(snapshot.svgs,8);
	assert.equal(snapshot.waveforms,24);
	assert.ok(snapshot.tickLanes>250);
	assert.ok(snapshot.panelRects.every(x=>x.width>1100&&x.height>380));
	assert.deepEqual(snapshot.scripts,['application/json']);
	assert.deepEqual(external,[]);
	assert.deepEqual(errors,[]);
	assert.equal(snapshot.evidence.originalWavSha256,
		'636bbd42f7ece1c085b4768f25fb0e65d7f29963a22a948e0b6e697ef0284721');
	console.log('GYM_EIGHT_SOURCE_BOUND_VISUAL_REVIEW_PASS',JSON.stringify({
		panels:snapshot.panels,svgs:snapshot.svgs,waveforms:snapshot.waveforms,
		beatHypothesisLines:snapshot.tickLanes,
		originalSha256:snapshot.evidence.originalWavSha256,
		noNetworkRequests:external.length===0,
		canAuthorizeGame:snapshot.evidence.canAuthorizeGame}));
}finally{await browser.close()}
