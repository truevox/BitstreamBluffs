import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const root=process.env.GAME_URL||'http://100.115.120.66:8198/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
	'--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const failures=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)failures.push([r.status(),r.url()]);});
try{
	await page.goto(root,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:35000});
	const verified=await page.evaluate(async()=>{
		const catalog=await(await fetch('/music/catalog.json')).json();
		const ac=new AudioContext({sampleRate:48000});
		const status=[];
		for(const track of catalog.tracks){
			const manifest=await(await fetch('/music/'+track.manifest)).json();
			const directory='/music/'+track.manifest.split('/').slice(0,-1).join('/')+'/';
			const positions=[0,Math.floor(manifest.segments.length/2),
				manifest.segments.length-1];
			for(const index of positions){
				const seg=manifest.segments[index];
				const roles=[
					['ORIGINAL DRUMS',seg.sources.drums],
					['BIOME MELODY',seg.sources['voice:crystal-cavern']],
					...Object.entries(manifest.adaptive.variants)
						.filter(([role,variants])=>variants['crystal-cavern'])
						.map(([role,variants])=>[role,variants['crystal-cavern'][index]]),
				];
				for(const [name,file] of roles){
					const url=directory+file;
					const response=await fetch(url);
					if(!response.ok)throw new Error('HTTP '+response.status+' '+url);
					const data=await response.arrayBuffer();
					const pcm=await ac.decodeAudioData(data);
					if(pcm.length!==seg.frames)throw new Error('BROWSER_DECODE_FRAME_MISMATCH '+url+
						': '+pcm.length+' expected '+seg.frames);
					status.push({track:track.id,position:index,name,frames:pcm.length});
				}
			}
			console.log('DECODER',track.id,'length',manifest.frameCount);
		}
		await ac.close();
		return status;
	});
	assert.ok(verified.length>=70);
	assert.equal(new Set(verified.map(row=>row.track)).size,4);
	console.log('CHROME_WEB_AUDIO_DECODE_SAMPLE_EXACT_PASS',{
		verifiedSegments:verified.length,first:verified[0],last:verified.at(-1),
	});
	await page.keyboard.press('x');
	await page.evaluate(()=>{
		const game=window.__bbGame;
		game.scene.getScene('TitleScene').startRun('opus-fixed-production-smoke');
	});
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.ready&&d.pack&&d.activeNodes.size>=7;
	},null,{timeout:40000});
	await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		d.setBiome('crystal-cavern');
		d.setAirborne(true);
		d.setDynamicOrchestra(true);
	});
	await page.waitForFunction(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return ['featured','bass','drums','guitar','piano','other']
			.every(role=>{
				const family=d.adaptive.channels.get(role);
				return !d.pack.adaptive.variants[role]['crystal-cavern'] ||
					(!!family.current?.live);
			});
	},null,{timeout:32000});
	const gameplay=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return {song:d.track.title,sourceNodes:d.activeNodes.size,
			replacements:[...d.adaptive.channels.values()]
				.filter(role=>role.current?.live).length,
			duration:d.pack.duration};
	});
	assert.ok(gameplay.replacements>=5);
	assert.deepEqual(errors,[]);
	assert.deepEqual(failures,[]);
	console.log('REAL_SHIPPING_ENGINE_WITH_FIXED_ASSETS_PASS',gameplay);
}finally{await browser.close();}
