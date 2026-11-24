#!/usr/bin/env node
/* Actual Chromium/WebAudio game DSP integration:
 * launch the real SIM8 game with private 33-song media, inspect every original
 * source chain, verify owner-listening layers precede event processors and clean
 * menus remove all live gameplay effects without restarting the music clock.
 * Not a surrogate music player, and no fabricated physics/beat events.
 */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://127.0.0.1:8219/';
const reportOut=process.env.REPORT_OUT;
const expected={
	'debutmont':{drums:['snowpack'],bass:['snowpack']},
	'garbage-dump-glacier':{drums:['scrapheap'],bass:['scrapPitchProbe']},
	'underwater-mountain':{drums:['hydrostatic'],bass:['hydrostatic']},
	'micro-mountain':{drums:['microbox'],bass:['microbox']},
	'crystal-cavern':{drums:['gain'],bass:['crystallattice']},
	'steampunk-slopes':{drums:['steamworks'],bass:['steamworks']},
	'sky-jellyfish-mountain':{drums:['spatialreach','jellybloom'],bass:['spatialreach','jellybloom']},
	'space-mountain':{drums:['spatialreach','biomebloom','orbitfield'],bass:['spatialreach','biomebloom','orbitfield']},
	'candy-cane-canyon':{drums:['characteredge','biomebloom','sugarfizz'],bass:['characteredge','biomebloom','sugarfizz']},
	'vertigo-vents':{drums:['characteredge','biomebloom','ventforge'],bass:['characteredge','biomebloom','ventforge']},
	'pyramid-peak':{drums:['spatialreach','sunstone'],bass:['spatialreach','sunstone']},
	'bitstream-bluffs':{drums:['biomebloom','arcadeglue'],bass:['biomebloom','arcadeglue']},
};
const report={format:'bsb-sim8-33-private-source-biome-dsp-v1',url,biomes:[],errors:[],unexpectedHttp:[],
	limitations:'In-game WebAudio DSP chain instantiation for all original sources and menu cleanup, not human listening or real terrain traversal of all 12 biomes.'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try{
	const page=await browser.newPage({viewport:{width:1280,height:800}});
	page.on('pageerror',e=>report.errors.push(e.message));
	page.on('response',r=>{
		if(r.status()>=400&&!(/\/music\/packs\/[^/]+\/adaptive\/debutmont\//.test(r.url())&&r.status()===404))
			report.unexpectedHttp.push([r.status(),r.url()]);
	});
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.registry?.get('audioSynth')?._stemMusic?.catalog?.length===33,
		null,{timeout:30000});
	await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('33-source-DSP-biomes'));
	await page.waitForFunction(()=>{
		const game=window.__bbGame,audio=game?.registry?.get('audioSynth'),d=audio?._stemMusic;
		return d?.ctx?.state==='running'&&d.pack?.sourceNames?.length===18&&
			d.activeNodes.size>0&&audio?._musicMode==='run'&&d.menuMode===false&&
			game.scene.getScene('RunScene')?.sys.isActive();
	},null,{timeout:30000});
	report.gameStart=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return {id:d.pack.id,voices:d.pack.sourceNames.filter(s=>s.startsWith('voice:')).length,
			sources:d.pack.sourceNames.length,clock:d.clockStart,currentTime:d.ctx.currentTime};
	});
	assert.equal(report.gameStart.voices,12);
	const ordered=Object.keys(expected);
	for(const biome of ordered){
		const snapshot=await page.evaluate(biome=>{
			const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
			d.setBiome(biome);
			d.setSpeed(1250);
			const roles=['bass','drums','guitar','piano','other'];
			const stages=Object.fromEntries(roles.map(role=>{
				const source=d.mixer.sources.get(role);
				if(!source)throw new Error('No original music source '+role);
				return [role,source.chain?.stages?.map(x=>({type:x.type,id:x.id}))];
			}));
			return {biome:d.biome,menuMode:d.menuMode,activeVoice:d._activeVoiceFor(d.pack),
				roles:stages,clock:d.clockStart,audioState:d.ctx.state,activeNodes:d.activeNodes.size,
				dynamicOrchestra:d.dynamicOrchestra,
				roomWetEnabled:d.mixer.space.wetEnabled};
		},biome);
		assert.equal(snapshot.biome,biome);
		assert.equal(snapshot.menuMode,false);
		assert.equal(snapshot.audioState,'running');
		assert.equal(snapshot.activeVoice,'voice:'+biome);
		assert.equal(snapshot.roomWetEnabled,true);
		for(const role of ['bass','drums']){
			const actual=snapshot.roles[role].map(x=>x.type);
			const declared=expected[biome][role];
			assert.deepEqual(actual.slice(0,declared.length),declared,
				'Missing original-stem processing '+biome+' '+role);
		}
		if(biome==='candy-cane-canyon'||biome==='vertigo-vents'||biome==='bitstream-bluffs'){
			for(const role of Object.keys(snapshot.roles)){
				const original=snapshot.roles[role].map(x=>x.type);
				assert.ok(original.includes(biome==='candy-cane-canyon'?'sugarfizz':
					biome==='vertigo-vents'?'ventforge':'arcadeglue'));
				assert.ok(original.includes('biomebloom'));
			}
		}
		if(biome==='garbage-dump-glacier'){
			// Native validated event processor only; cowbell is a
			// separate one-shot that cannot invent its own musical note.
			assert.ok(snapshot.roles.drums.some(x=>x.type==='scrapheap'));
			assert.ok(snapshot.roles.bass.some(x=>x.type==='scrapPitchProbe'));
		}
		report.biomes.push(snapshot);
		console.log('GAME_BIOME_ORIGINAL_SOURCE_DSP_PASS',biome,
			snapshot.roles.drums.map(s=>s.type).join('→'));
	}
	const menu=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		const before={clock:d.clockStart,track:d.track.id};
		d.setMenuMode(true);
		const stages=Object.fromEntries(['bass','drums','guitar','piano','other'].map(role=>
			[role,d.mixer.sources.get(role).chain.stages.map(e=>e.type)]));
		return {before,after:{clock:d.clockStart,track:d.track.id},
			menu:d.menuMode,roomWetEnabled:d.mixer.space.wetEnabled,stages};
	});
	assert.equal(menu.menu,true);
	assert.equal(menu.roomWetEnabled,false);
	assert.deepEqual(menu.before,menu.after,'Clean menu must not change song clock or track');
	for(const role of Object.keys(menu.stages))assert.deepEqual(menu.stages[role],[]);
	report.menu=menu;
	console.log('CLEAN_MENU_NO_DSP_NO_RESTART_PASS',JSON.stringify({clockPreserved:true,sourceCount:5}));
	assert.deepEqual(report.errors,[]);
	assert.deepEqual(report.unexpectedHttp,[]);
	assert.equal(report.biomes.length,12);
	report.status='PASS_ALL_12_BIOME_DSP_33_SONG_GAME';
	console.log(report.status,JSON.stringify({biomes:report.biomes.length,sourceRoles:5,pageErrors:0,
		unexpectedHttp:0,menuClean:true}));
}catch(error){
	report.status='FAIL';
	report.failure=String(error);
	console.error('GAME_BIOME_DSP_FAILED',report.failure);
	process.exitCode=1;
}finally{
	if(reportOut)try{
		writeFileSync(reportOut,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
	}catch(error){console.error('REPORT_FAILED',String(error));process.exitCode=1}
	await browser.close();
}
