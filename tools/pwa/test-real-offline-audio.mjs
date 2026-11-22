/** #172 isolated real-Opus offline playback proof; never registers live worker. */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildRealMusicGroupManifest } from './music-integrity-groups.mjs';
import { generateOfflineWorker } from './build-offline-worker.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const media=resolve(process.env.BSB_MEDIA_PUBLIC_ROOT||resolve(root,'public'));
const dist=resolve(root,'dist');
const catalog=JSON.parse(await readFile(resolve(media,'music/catalog.json'),'utf8'));
const packs={};
for(const track of catalog.tracks)
	packs[track.id]=JSON.parse(await readFile(resolve(media,'music',track.manifest),'utf8'));
const chosen=catalog.tracks.find(x=>x.title.includes('One More Run'))||catalog.tracks[0];
const selection=Object.fromEntries(catalog.tracks.map(x=>[x.id,x.id===chosen.id]));
const plan=await buildRealMusicGroupManifest(media,catalog,packs,{
	selection,unlockedBiomeIds:[],enabledBiomeIds:[],dynamicOrchestra:false,prefetchNextBiome:false,
});
if(plan.groups.length!==2||plan.groups.some(g=>g.priority!=='required'))
	throw Error('Expected one base and one real Debumont lead group');
await generateOfflineWorker(dist);
console.log('TEST PLAN',JSON.stringify({song:chosen.title,
	groups:plan.groups.map(g=>({id:g.id,files:g.entries.length,MiB:(g.totalBytes/1048576).toFixed(2)})),
	MiB:(plan.requiredBytes/1048576).toFixed(2)}));
const mimetypes={'.js':'text/javascript','.mjs':'text/javascript','.cjs':'text/javascript','.css':'text/css',
	'.html':'text/html','.json':'application/json','.webmanifest':'application/manifest+json',
	'.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.ogg':'audio/ogg'};
const server=createServer(async(req,res)=>{
	try{
		const url=new URL(req.url,'http://localhost');
		const path=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
		if(path.includes('..')||path.includes('\\')||!path.startsWith('/'))throw Error('Bad path');
		const fromMedia=path.startsWith('/music/packs/')&&path.endsWith('.ogg');
		const source=path.startsWith('/tools/pwa/')?root:fromMedia?media:dist;
		const abs=resolve(source,path.slice(1));
		if(!abs.startsWith(source+sep))throw Error('Path escape');
		const info=await stat(abs);
		if(!info.isFile())throw Error('Not a file');
		res.writeHead(200,{'Content-Type':mimetypes[extname(abs)]||'application/octet-stream',
			'Content-Length':String(info.size),'Cache-Control':'no-store'});
		createReadStream(abs).pipe(res);
	}catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port;
let browser;
try{
	browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',
		headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required',
			'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
	const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1000,height:540}});
	const page=await context.newPage();
	const errors=[];
	page.on('pageerror',e=>errors.push(e.message));
	await page.goto(url,{waitUntil:'domcontentloaded'});
	await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
	await page.evaluate(async()=>{
		await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
		await navigator.serviceWorker.ready;
	});
	await page.reload({waitUntil:'domcontentloaded'});
	await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
	if(!await page.evaluate(()=>!!navigator.serviceWorker.controller))
		throw Error('Worker did not control page');
	console.log('WORKER CONTROLS GAME');
	for(const group of plan.groups){
		const output=await page.evaluate(async g=>{
			const {downloadRealSong,isRealSongDownloaded}=await import('/tools/pwa/music-cache-prototype.mjs');
			const opts={storage:caches,origin:location.origin,subtle:crypto.subtle,
				fetcher:fetch.bind(window),concurrency:6};
			const result=await downloadRealSong(g,opts);
			const complete=await isRealSongDownloaded(g,opts);
			navigator.serviceWorker.controller?.postMessage({type:'bb-music-cache-updated'});
			return {result,complete};
		},group);
		if(!output.complete)throw Error('Failed verified original song group: '+group.id);
		console.log('DOWNLOADED',JSON.stringify({group:group.id,...output}));
	}
	await context.setOffline(true);
	await page.reload({waitUntil:'domcontentloaded'});
	await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
	const musicStarted=await page.evaluate(selection=>{
		const audio=window.__bbGame.registry.get('audioSynth');
		if(!audio)throw Error('Game did not create its live AudioSynth');
		audio.applySettings({...audio.settings,musicEnabledSongs:selection,dynamicOrchestra:false});
		const returned=audio.jukeboxPlay();
		return {returned,audioState:audio.ctx?.state,musicReady:audio._stemMusic.ready,
			selected:audio._stemMusic.songEnabled,started:audio._stemMusic.started};
	},selection);
	await page.waitForFunction(target=>{
		const player=window.__bbGame.registry.get('audioSynth')?._stemMusic;
		return player?.track?.id===target&&player?.clockStart!==null&&player?.cache?.size>=7;
	},chosen.id,{timeout:30000});
	const live=await page.evaluate(()=>{
		const a=window.__bbGame.registry.get('audioSynth');const p=a._stemMusic;
		return {track:p.track?.id,started:p.started,clockStart:p.clockStart,
			decodedStemCount:p.cache.size,decodedStemKeys:[...p.cache.keys()].slice(0,12),
			transportState:p.transportSnapshot().state,ctxState:a.ctx?.state,
			proceduralTimerActive:!!a._musicTimer};
	});
	console.log('LIVE ORIGINAL MUSIC ENGINE OFFLINE',JSON.stringify({musicStarted,live}));
	if(live.track!==chosen.id||live.ctxState!=='running'||live.decodedStemCount<7||
		live.proceduralTimerActive)throw Error('Game did not run real stem engine offline');
	const stem=plan.groups.find(g=>g.kind==='base').entries.find(e=>e.url.endsWith('0000-drums.ogg'));
	const lead=plan.groups.find(g=>g.kind==='lead').entries.find(e=>e.url.includes('debumont'));
	if(!stem||!lead)throw Error('Real drum stem or biome melody not present');
	const disabledTrack=catalog.tracks.find(x=>x.id!==chosen.id);
	const disabled='/music/'+disabledTrack.manifest.replace('pack.json','0000-drums.ogg');
	const actual=await page.evaluate(async({stem,lead,disabled})=>{
		const check=async entry=>{
			const response=await fetch(entry.url,{cache:'no-store'});
			const bytes=await response.arrayBuffer();
			const digest=await crypto.subtle.digest('SHA-256',bytes);
			const hex=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
			const ctx=new AudioContext();
			const decoded=await ctx.decodeAudioData(bytes.slice(0));
			await ctx.close();
			return {status:response.status,bytes:bytes.byteLength,shaMatched:hex===entry.sha256,
				sampleRate:decoded.sampleRate,channels:decoded.numberOfChannels,duration:decoded.duration};
		};
		const unused=await fetch(disabled).catch(()=>({status:0}));
		return {titleReady:window.__bbGame.scene.isActive('TitleScene'),
			controlled:!!navigator.serviceWorker.controller,
			recordedDrums:await check(stem),recordedLead:await check(lead),unusedTrackStatus:unused.status};
	},{stem,lead,disabled});
	console.log('REAL OFFLINE AUDIO',JSON.stringify({...actual,errors},null,2));
	if(!actual.titleReady||!actual.controlled||!actual.recordedDrums.shaMatched||
		!actual.recordedLead.shaMatched||actual.recordedDrums.channels<1||
		actual.recordedLead.channels<1||actual.unusedTrackStatus!==503||errors.length)
		throw Error('Offline original recordings were not verified');
	// Cache eviction must invalidate the ENTIRE lead group, not quietly
	// serve other files from a partially missing recorded soundtrack.
	const leadGroup=plan.groups.find(g=>g.kind==='lead');
	const eviction=await page.evaluate(async ({leadGroup,unrelated})=>{
		const cache=await caches.open('bb-real-music-v1-'+leadGroup.id+'-'+leadGroup.version);
		const removed=await cache.delete(new URL(leadGroup.entries[0].url,location.origin).href);
		navigator.serviceWorker.controller?.postMessage({type:'bb-music-cache-updated'});
		await new Promise(resolve=>setTimeout(resolve,100));
		const complete=(await Promise.all(leadGroup.entries.map(e=>cache.match(new URL(e.url,location.origin).href)))).every(Boolean);
		const response=await fetch(unrelated,{cache:'no-store'});
		return {removed,complete,status:response.status};
	},{leadGroup,unrelated:leadGroup.entries.at(-1).url});
	console.log('EVICTED ORIGINAL GROUP',JSON.stringify(eviction));
	if(!eviction.removed||eviction.complete||eviction.status!==503)
		throw Error('Incomplete original audio cache was incorrectly accepted');
	await context.close();
}finally{
	await browser?.close();
	await new Promise(r=>server.close(r));
}
