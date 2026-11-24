#!/usr/bin/env node
/**
 * #291: independently decode EVERY original 48-kHz segment OGG for the
 * core six original stems. 33 songs, 612 segments, 3,672 source OGGs.
 * Chromium fetch+decode at source 48k, plus Node SHA-256 canonical disk
 * readback and exact frame comparison. Read-only, private, no PCM export.
 */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const origin=(process.env.GAME_URL||'http://127.0.0.1:8221').replace(/\/+$/,'');
const media=process.env.BSB291_PRIVATE_AUDIO_ROOT;
const out=process.env.REPORT_OUT;
const start=Number(process.env.QA_START_INDEX??0);
const count=Number(process.env.QA_COUNT??1);
if(!media||!out||existsSync(out)||!Number.isInteger(start)||start<0||
	!Number.isInteger(count)||count<1||start+count>33)
	throw Error('Require private original archive, unique report, valid 33-source song range');
const root=realpathSync(resolve(media));
const tracks=JSON.parse(readFileSync(join(root,'catalog.json'),'utf8')).tracks;
assert.equal(tracks.length,33);
const roles=['vocals','drums','bass','guitar','piano','other'];
const hash=buf=>createHash('sha256').update(buf).digest('hex');
const report={format:'bitstream-all33-original-ogg-48khz-chromium-decode-sha-v1',
	start,count,status:'INCOMPLETE',tracks:[],sourceEvidence:[],
	pageErrors:[],httpErrors:[],startedAt:new Date().toISOString(),
	limitations:[
		'Every original core 48-kHz OGG file is actually fetched and decoded by Chromium and compared to a local independent canonical file SHA-256; this validates source files, not final post-FX game output.',
		'Chromium uses a 48-kHz AudioContext to avoid device-default 44.1-kHz resampling; live output still uses device rate and separate QA.',
		'Core six original stems only, not all adaptive biome override OGGs or derived per-biome melody variants.',
		'Files are never copied/exported/altered; report is private metadata and may include original filenames/hashes.',
	]};
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist'
]});
try{
	const page=await browser.newPage();
	page.on('pageerror',e=>report.pageErrors.push(String(e)));
	page.on('response',r=>{
		if(r.status()>=400)report.httpErrors.push({status:r.status(),url:r.url()});
	});
	await page.goto(origin+'/tools/music/qa-mixed-final-output.html',
		{waitUntil:'load',timeout:30000});
	const browserResults=await page.evaluate(async({start,count})=>{
		const response=await fetch('/music/catalog.json');
		if(!response.ok)throw Error('Private 33-original catalog missing');
		const catalog=await response.json();
		if(catalog.tracks.length!==33)throw Error('Catalog no longer has 33 originals');
		const ctx=new AudioContext({sampleRate:48000});
		const hex=d=>Array.from(new Uint8Array(d),
			b=>b.toString(16).padStart(2,'0')).join('');
		const results=[];
		for(let index=start;index<start+count;index++){
			const track=catalog.tracks[index];
			const manifestURL=new URL('/music/'+track.manifest,location.origin);
			const resp=await fetch(manifestURL);
			if(!resp.ok)throw Error('Original manifest HTTP '+resp.status+' '+track.id);
			const manifest=await resp.json();
			if(manifest.id!==track.id||manifest.sampleRate!==48000)
				throw Error('Original pack/source mismatch '+track.id);
			let cursor=0,observed=[];
			for(let j=0;j<manifest.segments.length;j++){
				const segment=manifest.segments[j];
				if(segment.startFrame!==cursor)throw Error('Non-contiguous source frames');
				const sources=['vocals','drums','bass','guitar','piano','other'];
				// Concurrent at most six original files. Never retain PCM
				// after checking this segment's actual decoder output.
				const rows=await Promise.all(sources.map(async role=>{
					const rel=segment.sources?.[role];
					if(!rel)throw Error('Missing source '+role+' '+track.id);
					const url=new URL(rel,manifestURL);
					const r=await fetch(url);
					if(!r.ok)throw Error('Original media HTTP '+r.status+' '+url);
					const bytes=await r.arrayBuffer();
					const digest=hex(await crypto.subtle.digest('SHA-256',bytes));
					const encodedLength=bytes.byteLength;
					const decoded=await ctx.decodeAudioData(bytes.slice(0));
					if(decoded.sampleRate!==48000||decoded.length!==segment.frames||
						decoded.numberOfChannels<1||decoded.numberOfChannels>2)
						throw Error('ORIGINAL_OGG_BAD_DECODE '+track.id+'/'+j+'/'+role+
							' expected '+segment.frames+' got '+decoded.length+
							' sample rate '+decoded.sampleRate);
					return {segmentIndex:j,role,rel,frames:decoded.length,
						sampleRate:decoded.sampleRate,channels:decoded.numberOfChannels,
						encodedBytes:encodedLength,sha256:digest};
				}));
				observed.push(...rows);
				cursor+=segment.frames;
			}
			if(cursor!==manifest.frameCount)throw Error('Full original frame count mismatch');
			results.push({index,trackId:track.id,manifest:track.manifest,
				segmentCount:manifest.segments.length,frameCount:manifest.frameCount,
				observed});
		}
		await ctx.close();
		return results;
	},{start,count});
	for(const result of browserResults){
		const track=tracks[result.index];
		assert.equal(track.id,result.trackId);
		assert.equal(track.manifest,result.manifest);
		const packFile=resolve(root,track.manifest);
		assert.ok(packFile.startsWith(root+sep));
		const physicalPack=realpathSync(dirname(packFile));
		const pack=JSON.parse(readFileSync(packFile,'utf8'));
		assert.equal(pack.id,track.id);
		assert.equal(result.segmentCount,pack.segments.length);
		assert.equal(result.frameCount,pack.frameCount);
		assert.equal(result.observed.length,pack.segments.length*6);
		const aggregate=createHash('sha256');
		for(const observed of result.observed){
			const seg=pack.segments[observed.segmentIndex];
			assert.ok(seg);
			assert.ok(roles.includes(observed.role));
			assert.equal(seg.frames,observed.frames);
			assert.equal(observed.sampleRate,48000);
			assert.ok(observed.channels===1||observed.channels===2);
			assert.equal(observed.rel,seg.sources[observed.role]);
			assert.ok(!observed.rel.startsWith('/')&&!observed.rel.includes('..')&&
				!observed.rel.includes('\\'));
			const source=realpathSync(resolve(dirname(packFile),observed.rel));
			assert.ok(source.startsWith(physicalPack+sep)&&source.endsWith('.ogg'),
				'Original OGG escaped canonical song pack');
			const st=statSync(source);
			assert.ok(st.isFile()&&st.size>100);
			const local=readFileSync(source);
			const localHash=hash(local);
			assert.equal(observed.encodedBytes,local.length,
				'Decoded source bytes differ from canonical private disk');
			assert.equal(observed.sha256,localHash,
				'Browser original OGG bytes differ from canonical private source');
			aggregate.update(observed.segmentIndex+'/'+observed.role+'/'+localHash+'\n');
		}
		report.tracks.push({index:result.index,trackId:track.id,
			segmentCount:pack.segments.length,originalSourceOggFiles:result.observed.length,
			allBrowserDecoded48kFramesExact:true,
			originalSourceShaInventory:aggregate.digest('hex')});
		console.log('ALL_ORIGINAL_OGG_SEGMENTS_DECODED_SOURCE_VERIFIED',
			result.index,track.id,'segments',pack.segments.length,
			'original_OGG',result.observed.length);
	}
	assert.equal(report.tracks.length,count);
	assert.equal(report.pageErrors.length,0);
	assert.equal(report.httpErrors.length,0);
	report.status='PASS_ALL_ORIGINAL_STEM_OGGS_CHROMIUM_DECODED_48KHZ_SOURCE_VERIFIED';
	report.summary={songs:count,
		segments:report.tracks.reduce((sum,x)=>sum+x.segmentCount,0),
		originalSourceOggFiles:report.tracks.reduce((sum,x)=>sum+x.originalSourceOggFiles,0),
		allSourceFilesIndependentlySHA256:true,all48kDecodedFrameExact:true};
	console.log('ALL_ORIGINAL_SOURCE_FILES_VERIFIED',
		report.status,JSON.stringify(report.summary));
}catch(e){
	report.status='FAIL_OR_INCOMPLETE';report.error=String(e);
	console.error('ALL_ORIGINAL_SOURCE_FILES_VERIFY_FAILED',String(e));
	process.exitCode=1;
}finally{
	report.finishedAt=new Date().toISOString();
	writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
	await browser.close();
}
