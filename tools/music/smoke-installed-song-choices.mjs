#!/usr/bin/env node
/** Source-aware song picker smoke: no public phantom song choices before assets ship. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const url=process.env.GAME_URL||'http://127.0.0.1:8216/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle',
	'--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try {
	for(const count of [33,4]){
		const page=await browser.newPage();
		const errors=[];page.on('pageerror',e=>errors.push(e.message));
		if(count===4){
			await page.route('**/music/catalog.json',async route=>{
				const response=await route.fetch();
				const full=await response.json();
				assert.equal(full.tracks.length,33);
				await route.fulfill({response,json:{...full,tracks:full.tracks.slice(0,4)}});
			});
		}
		await page.goto(url,{waitUntil:'domcontentloaded'});
		await page.waitForFunction(n=>{
			const g=window.__bbGame;
			return g?.registry?.get('audioSynth')?._stemMusic?.catalog?.length===n &&
				g.scene.getScene('TitleScene')?.sys?.isActive();
		},count,{timeout:30000});
		const snapshot=await page.evaluate(()=>{
			const game=window.__bbGame,title=game.scene.getScene('TitleScene');
			title.menu.items.find(x=>x.label==='SETTINGS').onSelect();
			const settings=title.view;
			settings.menu.items.find(x=>x.label==='MANAGE SOUND').onSelect();
			const sound=settings.soundView;
			const item=sound.menu.items.find(x=>x.label.startsWith('SELECT TRACKS ('));
			if(!item)throw Error('Missing installed music picker');
			item.onSelect();
			const lib=sound.libraryView;
			const pages=[],names=[];
			const initial=lib.tracks.map(x=>x.id);
			const count=lib.tracks.length;
			for(let p=0;p<Math.ceil(count/8);p++){
				const rows=lib.menu.items.filter(x=>x.kind==='choice');
				pages.push(rows.length);
				names.push(...rows.map(r=>r.label));
				if(p+1<Math.ceil(count/8))lib._changePage(1);
			}
			return {menu:item.label,available:count,initial,pages,names,
				allKnown:game.registry.get('audioSynth').settings.musicEnabledSongs};
		});
		assert.equal(snapshot.available,count);
		assert.equal(snapshot.menu,'SELECT TRACKS ('+count+')');
		assert.deepEqual(snapshot.pages,count===4?[4]:[8,8,8,8,1]);
		assert.equal(new Set(snapshot.initial).size,count);
		assert.equal(snapshot.names.length,count);
		assert.deepEqual(errors,[]);
		console.log('INSTALLED_SONG_PICKER_PASS',JSON.stringify({installed:count,
			menu:snapshot.menu,pages:snapshot.pages,pageErrors:errors.length}));
		await page.close();
	}
} finally{await browser.close()}
