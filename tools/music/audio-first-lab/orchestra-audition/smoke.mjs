/**
 * Private orchestra-lab smoke test against the Tailnet-only web service.
 * No mutation of listening assets or publishing into the game.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.ORCHESTRA_LAB_URL || 'http://100.115.120.66:8186';
const catalogResponse = await fetch(url + '/catalog.json');
assert.equal(catalogResponse.status,200);
const catalog = await catalogResponse.json();
assert.equal(catalog.format,'bitstream-orchestra-auditions-v1');
assert.equal(catalog.songs.length,2);
assert.equal(catalog.biomes.length,11);

const paths = new Set(['/', '/index.html', '/app.js', '/catalog.json']);
for (const song of catalog.songs) {
	paths.add('/'+song.id+'/'+song.originalReference);
	paths.add('/'+song.id+'/'+song.vocals);
	for (const revision of ['articulation','orchestral','rhythm']) {
		paths.add('/revisions/'+revision+'/'+song.id+'/'+song.originalReference);
		paths.add('/revisions/'+revision+'/'+song.id+'/'+song.vocals);
	}
	for (const style of ['stock','aligned']) {
		paths.add('/revisions/accompaniment-'+style+'/'+song.id+'/'+song.originalReference);
		paths.add('/revisions/accompaniment-'+style+'/'+song.id+'/'+song.vocals);
	}
	for (const biome of catalog.biomes) {
		const variant = song.variants[biome.id];
		assert.ok(variant);
		for (const role of ['ground','air']) {
			paths.add('/'+song.id+'/'+variant[role]);
			for (const revision of ['articulation','orchestral','rhythm']) {
				paths.add('/revisions/'+revision+'/'+song.id+'/'+variant[role]);
			}
			for (const style of ['stock','aligned']) {
				paths.add('/revisions/accompaniment-'+style+'/'+song.id+'/'+variant[role]);
			}
		}
	}
}
// Tailnet forwarding is intentionally small; a burst of >190 requests
// exceeds its SSH channel budget. Run bounded HTTP checks in groups.
const allPaths = [...paths];
for (let i=0;i<allPaths.length;i+=8) {
	await Promise.all(allPaths.slice(i,i+8).map(async path => {
		const response = await fetch(url + path, {
			method:'HEAD',signal:AbortSignal.timeout(15000),
		});
		assert.equal(response.status,200,'Missing HEAD '+path);
	}));
}
console.log('LIBRARY_HTTP_CHECKS',paths.size,'PASS');

const browser = await chromium.launch({
	executablePath:'/usr/bin/chromium',headless:true,
	args:['--no-sandbox','--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const page = await browser.newPage();
page.on('pageerror',error => errors.push('JS '+String(error)));
page.on('response',response => {
	if (response.status() >= 400) errors.push('HTTP '+response.status()+' '+response.url());
});
try {
	await page.goto(url+'/',{waitUntil:'domcontentloaded'});
	await page.waitForFunction(() =>
		window.orchestraDebug?.state?.catalog?.biomes?.length===11,null,
		{timeout:18000});
	assert.equal(await page.locator('#song option').count(),2);
	assert.equal(await page.locator('#biomes button').count(),11);
	await page.click('#play');
	await page.waitForFunction(() => {
		const s=window.orchestraDebug.state;
		return s.playing && s.main && s.cache.has('revisions/rhythm/pope/debumont-air.ogg');
	},null,{timeout:18000});
	// Compare actual audio at the same song-clock position. The first
	// pass, envelope-only repair and new sounds are distinct choices.
	await page.click('button[data-revision="original"]');
	await page.waitForFunction(() => window.orchestraDebug.state.cache.has('pope/debumont-air.ogg'),null,{timeout:14000});
	await page.click('button[data-revision="articulation"]');
	await page.waitForFunction(() => window.orchestraDebug.state.cache.has('revisions/articulation/pope/debumont-air.ogg'),null,{timeout:14000});
	await page.click('button[data-revision="orchestral"]');
	await page.waitForFunction(() => window.orchestraDebug.state.revision==='orchestral',null,{timeout:14000});
	await page.click('button[data-revision="rhythm"]');
	await page.waitForFunction(() => window.orchestraDebug.state.cache.has('revisions/rhythm/pope/debumont-air.ogg'),null,{timeout:14000});
	// The three controls preserve the lead, bass and selected drum kit.
	await page.click('button[data-accompaniment="stock"]');
	await page.waitForFunction(() => window.orchestraDebug.state.cache.has('revisions/accompaniment-stock/pope/debumont-air.ogg'),null,{timeout:14000});
	assert.equal(await page.locator('button[data-accompaniment="stock"]').getAttribute('aria-pressed'),'true');
	await page.click('button[data-accompaniment="aligned"]');
	await page.waitForFunction(() => window.orchestraDebug.state.cache.has('revisions/accompaniment-aligned/pope/debumont-air.ogg'),null,{timeout:14000});
	await page.click('button[data-accompaniment="new"]');
	await page.waitForFunction(() => window.orchestraDebug.state.accompaniment==='new',null,{timeout:14000});
	await page.click('#original');
	await page.waitForFunction(() =>
		window.orchestraDebug.state.cache.has('pope/original-instrumental.ogg'),
		null,{timeout:13000});
	await page.click('#new');
	await page.click('#ground');
	await page.waitForFunction(() =>
		window.orchestraDebug.state.cache.has('revisions/rhythm/pope/debumont-ground.ogg'),
		null,{timeout:13000});
	await page.click('#vocal');
	await page.waitForFunction(() =>
		window.orchestraDebug.state.voice!==null,null,{timeout:13000});
	for(const biome of ['crystal-cavern','pyramid-peak','steampunk-slopes']){
		await page.click('button[data-biome="'+biome+'"]');
		await page.waitForFunction(b =>
			window.orchestraDebug.state.cache.has('revisions/rhythm/pope/'+b+'-ground.ogg'),
			biome,{timeout:14000});
	}
	await page.click('#air');
	await page.selectOption('#song','one-more-run');
	await page.waitForFunction(() =>
		window.orchestraDebug.state.song==='one-more-run' &&
		window.orchestraDebug.state.main!==null &&
		window.orchestraDebug.state.playing,null,{timeout:16000});
	for(const biome of ['candy-cane-canyon','micro-mountain','vertigo-vents']){
		await page.click('button[data-biome="'+biome+'"]');
		await page.waitForFunction(b =>
			window.orchestraDebug.state.cache.has('revisions/rhythm/one-more-run/'+b+'-air.ogg'),
			biome,{timeout:14000});
	}
	await page.click('button[data-accompaniment="stock"]');
	await page.waitForFunction(() => window.orchestraDebug.state.cache.has('revisions/accompaniment-stock/one-more-run/vertigo-vents-air.ogg'),null,{timeout:14000});
	await page.click('button[data-accompaniment="aligned"]');
	await page.waitForFunction(() => window.orchestraDebug.state.cache.has('revisions/accompaniment-aligned/one-more-run/vertigo-vents-air.ogg'),null,{timeout:14000});
	await page.click('button[data-accompaniment="new"]');
	await page.locator('#seek').fill('15');
	await page.locator('#seek').dispatchEvent('change');
	await page.waitForFunction(() =>
		window.orchestraDebug.state.playing &&
		window.orchestraDebug.state.position>=14.9,null,{timeout:12000});
	const state=await page.evaluate(()=>{
		const s=window.orchestraDebug.state;
		return {
			song:s.song,biome:s.biome,mode:s.arrangement,
			terrain:s.terrain,voice:s.vocals,playing:s.playing,
			cacheCount:s.cache.size,position:s.position,
		};
	});
	assert.equal(errors.length,0,errors.join('\n'));
	assert.equal(state.playing,true);
	assert.equal(state.voice,true);
	console.log('REAL_CHROMIUM_ORCHESTRA_TEST_PASS',JSON.stringify(state));
}finally{
	await browser.close();
}
