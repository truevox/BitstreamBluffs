#!/usr/bin/env node
/** Source-backed repeated browser renders, QA seed stability within PCM tolerance. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.QA_URL||'http://127.0.0.1:8220';
const b=await chromium.launch({headless:true,args:['--no-sandbox',
	'--use-gl=angle','--use-angle=swiftshader']});
try{
	const page=await b.newPage();
	await page.goto(base+'/tools/music/qa-mixed-final-output.html');
	await page.waitForFunction(()=>window.__mixedFinalAudioQA);
	const args={pack:'33_local-one-more-run-bitstream-bluffs',
		segmentIndex:12,biome:'garbage-dump-glacier',
		scenario:'mixed-game-stress',profile:'standard'};
	const a=await page.evaluate(x=>window.__mixedFinalAudioQA.render(x),args);
	const c=await page.evaluate(x=>window.__mixedFinalAudioQA.render(x),args);
	const metrics={};
	for(const key of ['samplePeak','estimatedTruePeak4x','rms']){
		metrics[key]=Math.abs(a[key]-c[key]);
		assert.ok(metrics[key]<1e-6,key+' exceeds 1ppm QA tolerance');
	}
	assert.deepEqual(a.sourceHashes,c.sourceHashes);
	assert.deepEqual(a.test.events,c.test.events);
	assert.equal(a.test.qaCosmeticSeed,0x2912026);
	assert.equal(a.productionGraph.productionPeakGuard,true);
	assert.equal(a.sampleClips,0);
	assert.equal(a.estimatedTrueClips4x,0);
	console.log('MIXED_SOURCE_REPLAY_NUMERIC_STABILITY_PASS',
		JSON.stringify({tolerance:1e-6,metricDeltas:metrics,
			hashedOriginalOggInputs:Object.keys(a.sourceHashes).length,
			seed:a.test.qaCosmeticSeed}));
}finally{await b.close()}
