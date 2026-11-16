/**
 * Private, non-publishing real Chromium/WebAudio smoke of 4x12 source routing.
 * Uses temporary per-song manifests and SYMLINKS to existing 32s Ogg clips,
 * never changes media bytes, game files, or the audible private A/B lab.
 * Run with BITSTREAM_PRIVATE_AUDIO_SITE=/absolute/path/to/private/site
 * node tools/music/audio-first-lab/smoke_adaptive_browser.mjs
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const privateSite = process.env.BITSTREAM_PRIVATE_AUDIO_SITE;
if (!privateSite || !path.isAbsolute(privateSite)) {
	throw new Error('BITSTREAM_PRIVATE_AUDIO_SITE must be an absolute private directory');
}
const source = path.join(privateSite,'pope');
const tracks = ['vocals','drums','bass','guitar','piano','other'];
const biomes = ['bitstream-bluffs','debumont','garbage-dump-glacier',
	'pyramid-peak','underwater-mountain','crystal-cavern','space-mountain',
	'candy-cane-canyon','sky-jellyfish-mountain','steampunk-slopes',
	'micro-mountain','vertigo-vents'];
const segmented = process.argv.includes('--segments') ||
	process.argv.includes('--missing-second-segment');
const omitSegment = process.argv.includes('--missing-second-segment');
const execFileAsync = promisify(execFile);
const temp = await fs.mkdtemp(path.join(os.tmpdir(),'bitstream-adaptive-browser-'));
let browser=null,server=null;
const errors=[];
try {
	await fs.access(path.join(source,'original','other.ogg'));
	await fs.symlink(source,path.join(temp,'pope'),'dir');
	const sources = Object.fromEntries(tracks.map(name =>
		[name,'pope/original/'+name+'.ogg']));
	for (const biome of biomes) {
		sources['voice:'+biome] = 'pope/melody/'+biome+'.ogg';
	}
	const variants = {};
	for (const role of ['bass','drums','featured']) {
		const family = {};
		const dirname = role==='bass'?'bass':role==='drums'?'drums-sampled':'featured-sampled';
		for (const biome of biomes.slice(1)) {
			family[biome] = ['pope/'+dirname+'/'+biome+'.ogg'];
		}
		variants[role]=family;
	}
	let segments=[{startFrame:0,frames:48000*32,sources}];
	if (segmented) {
		// Trim the approved private 32s clips only into NEW temporary files,
		// with real compressed audio and exactly the same song frame grid.
		// No master or audition media is ever rewritten.
		const originals=new Set([
			...Object.values(sources).filter(file =>
				file.startsWith('pope/original/') ||
				['debumont','candy-cane-canyon','bitstream-bluffs']
					.some(biome=>file==='pope/melody/'+biome+'.ogg')),
		]);
		for (const role of ['bass','drums','featured']) {
			for (const biome of ['debumont','candy-cane-canyon']) {
				originals.add(variants[role][biome][0]);
			}
		}
		const segmentPath = (file,index) =>
			'segments/'+file.replaceAll('/','__').replace(/\.ogg$/,
				'-'+index+'.ogg');
		await fs.mkdir(path.join(temp,'segments'));
		// Serial rendering prevents stress on the audio preview service
		// and produces a predictable reproducible two-chunk test bank.
		for (const file of originals) {
			for (let index=0;index<2;index++) {
				if (omitSegment && index===1 &&
					file==='pope/featured-sampled/debumont.ogg') continue;
				await execFileAsync('ffmpeg',[
					'-nostdin','-hide_banner','-loglevel','error',
					'-ss',String(index*8),'-i',path.join(temp,file),
					'-t','8','-ac','2','-ar','48000',
					'-c:a','libopus','-b:a','96k','-y',
					path.join(temp,segmentPath(file,index)),
				],{timeout:20000});
			}
		}
		segments=[0,1].map(index=>({
			startFrame:index*8*48000,frames:8*48000,
			sources:Object.fromEntries(Object.entries(sources)
				.map(([role,file])=>[role,segmentPath(file,index)])),
		}));
		for (const role of ['bass','drums','featured']) {
			for (const [biome,files] of Object.entries(variants[role])) {
				variants[role][biome]=[0,1].map(index=>segmentPath(files[0],index));
			}
		}
	}
	const pack = {
		format:'bitstream-music-pack-v1',id:'private-adaptive-smoke',
		sampleRate:48000,frameCount:segmented ? 48000*16 : 48000*32,
		segments,
		adaptive:{featuredStem:'other',variants},
	};
	const catalog = {
		format:'bitstream-music-catalog-v1',
		tracks:[{id:pack.id,title:'Private adaptive routing integration proof',manifest:'pack.json'}],
	};
	await fs.writeFile(path.join(temp,'pack.json'),JSON.stringify(pack,null,2));
	await fs.writeFile(path.join(temp,'catalog.json'),JSON.stringify(catalog,null,2));
	const app=express();
	app.get('/',(req,res)=>res.type('html').send('<!doctype html><title>Private adaptive smoke</title><p>Headless test only</p>'));
	app.use('/src',express.static(path.join(repo,'src')));
	app.use('/proof',express.static(temp));
	server=await new Promise(resolve=>{
		const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));
	});
	const port=server.address().port;
	browser=await chromium.launch({
		executablePath:'/usr/bin/chromium',headless:true,
		args:['--no-sandbox','--autoplay-policy=no-user-gesture-required'],
	});
	const page=await browser.newPage();
	page.on('pageerror',error=>errors.push('JS: '+String(error)));
	const expectedMissing=[];
	page.on('response',response=>{
		if (response.status()<400) return;
		if (omitSegment && response.status()===404 &&
			response.url().endsWith(
				'pope__featured-sampled__debumont-1.ogg')) {
			expectedMissing.push(response.url());
			return;
		}
		errors.push('HTTP '+response.status()+': '+response.url());
	});
	await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
	const initial=await page.evaluate(async()=>{
		const {StemMusicDirector}=await import('/src/systems/music/StemMusicDirector.js');
		const ctx=new AudioContext({latencyHint:'interactive'});
		const player=new StemMusicDirector(null,'/proof/catalog.json');
		await player.initPromise;
		player.attach(ctx,ctx.destination);
		player.setBiome('debumont');
		await ctx.resume();
		player.start();
		window.__test={ctx,player};
		return {ready:player.ready,codec:ctx.sampleRate};
	});
	if(!initial.ready)throw new Error('Browser could not load private adaptive catalog');
	const wait=async(name,check)=>{
		try{
			await page.waitForFunction(check,null,{timeout:25000,interval:100});
		}catch(e){
			const snapshot=await page.evaluate(()=>{
				const p=window.__test?.player;
				return {error:p?.lastError,adaptiveError:p?.adaptive?.lastError,
					scheduled:[...(p?.scheduled||[])],biome:p?.biome,
					packAdaptive:!!p?.pack?.adaptive};
			});
			throw new Error(name+' timeout: '+JSON.stringify(snapshot)+'; '+String(e));
		}
	};
	const state=()=>page.evaluate(()=>{
		const p=window.__test.player;
		const tracks=['vocals','drums','bass','guitar','piano','other'];
		return {
			biome:p.biome,airborne:p.airborne,
			pack:!!p.pack?.adaptive,corePresent:tracks.every(name=>p.gains.has(name)),
			mixerBusCount:p.mixer.sources.size,
			originalMix:Object.fromEntries(tracks.map(name=>
				[name,p.mixer.sources.get(name).mix.gain.value])),
			activeVariants:Object.fromEntries(['bass','drums','featured'].map(role=>
				[role,p.adaptive.channels.get(role)?.current?.biome??null])),
			scheduled:[...p.scheduled].filter(key=>key.startsWith('0/')),
		};
	});
	await wait('debumont bass and featured playback',()=>{
		const p=window.__test.player;
		return p.pack?.adaptive && p.adaptive.channels.get('bass')?.current?.biome==='debumont'
			&&p.adaptive.channels.get('featured')?.current?.biome==='debumont'
			&&p.scheduled.has('0/piano')&&p.scheduled.has('0/guitar');
	});
	const before=await state();
	await page.evaluate(()=>window.__test.player.setAirborne(true));
	await wait('real airborne kit',()=>{
		const p=window.__test.player;
		return p.adaptive.channels.get('drums')?.current?.biome==='debumont';
	});
	await page.evaluate(()=>window.__test.player.setBiome('candy-cane-canyon'));
	await wait('biome instrument swap',()=>{
		const p=window.__test.player;
		return p.adaptive.channels.get('bass')?.current?.biome==='candy-cane-canyon'
			&&p.adaptive.channels.get('featured')?.current?.biome==='candy-cane-canyon';
	});
	const switched=await state();
	await page.evaluate(()=>window.__test.player.setAirborne(false));
	await wait('landing source return',()=>{
		const p=window.__test.player;
		return p.adaptive.channels.get('drums')?.current===null;
	});
	await page.evaluate(()=>window.__test.player.setBiome('bitstream-bluffs'));
	await page.waitForTimeout(350);
	const home=await state();
	console.log('ADAPTIVE_BROWSER_STATES',JSON.stringify({before,switched,home,errors}));
	if (!before.corePresent||!switched.corePresent||!home.corePresent) {
		throw new Error('A mandatory core audio stem became unavailable');
	}
	if (before.originalMix.guitar<.99||before.originalMix.piano<.99||
		switched.originalMix.guitar<.99||switched.originalMix.piano<.99) {
		throw new Error('One of the two unfeatured original streams was muted');
	}
	if (home.originalMix.bass<.99||home.originalMix.other<.99||
		home.originalMix.drums<.99) {
		throw new Error('Home did not restore original stem routing');
	}
	if (home.mixerBusCount>24) throw new Error('Unbounded mixer nodes');
	let secondSegment=null;
	if (segmented) {
		await page.evaluate(()=>window.__test.player.setBiome('debumont'));
		await wait('second segment originals and no unfeatured losses',()=>{
			const p=window.__test.player;
			return p.ctx.currentTime-p.clockStart>8.35 &&
				['vocals','drums','bass','guitar','piano','other']
					.every(name=>p.scheduled.has('1/'+name));
		});
		secondSegment=await page.evaluate(()=>{
			const p=window.__test.player;
			return {time:p.ctx.currentTime-p.clockStart,
				unfeatured:Object.fromEntries(['guitar','piano'].map(name=>
					[name,p.mixer.sources.get(name).mix.gain.value])),
				originalFeatured:p.mixer.sources.get('other').mix.gain.value,
				featuredSecondScheduled:p.adaptive.channels.get('featured')
					?.current?.scheduled.has(1)??false,
				activeFeatured:p.adaptive.channels.get('featured')
					?.current?.biome??null,
				loaded:p.scheduled.has('1/other'),
				adaptiveError:p.adaptive.lastError??null};
		});
		if (secondSegment.unfeatured.guitar<.99 ||
			secondSegment.unfeatured.piano<.99 ||
			!secondSegment.loaded) {
			throw new Error('An unchanged audio stream stopped at the song-chunk boundary');
		}
		if (omitSegment) {
			if (expectedMissing.length<1 || expectedMissing.length>5 ||
				secondSegment.originalFeatured<.99 ||
				secondSegment.activeFeatured!==null) {
				throw new Error('Missing second-segment instrument did not fall back safely');
			}
		} else if (!secondSegment.featuredSecondScheduled ||
			secondSegment.activeFeatured!=='debumont') {
			throw new Error('Valid second-segment instrument failed to continue');
		}
	}
	if (errors.length) throw new Error('Browser runtime errors: '+errors.join('; '));
	const report={pass:true,originalTracks:6,featured:'other',
		originalUnfeaturedTracks:['guitar','piano'],before,switched,home,
		segmented,omitSegment,secondSegment,expectedMissingCount:expectedMissing.length,
		registeredSources:home.mixerBusCount,errorCount:errors.length};
	console.log('REAL_BROWSER_ADAPTIVE_SMOKE',JSON.stringify(report));
	await page.evaluate(async()=>{
		window.__test.player.destroy();
		await window.__test.ctx.close();
	});
}finally{
	if(browser)await browser.close();
	if(server)await new Promise(resolve=>server.close(resolve));
	await fs.rm(temp,{recursive:true,force:true});
}
