#!/usr/bin/env node
/** Combine independently saved source-verification reports, fail closed on
 * missing/duplicate original songs, segments, hashes, incomplete QA or source
 * mismatches. Only private numeric evidence is written, never original audio.
 */
import assert from 'node:assert/strict';
import {readFileSync,existsSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const directory=process.env.REPORT_ROOT;
const catalogRoot=process.env.BSB291_PRIVATE_AUDIO_ROOT;
const out=process.env.REPORT_OUT;
if(!directory||!catalogRoot||!out||existsSync(out))
	throw Error('Require private report folder, private media catalog and NEW output');
const path=resolve(directory),media=realpathSync(catalogRoot);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const tracks=JSON.parse(readFileSync(join(media,'catalog.json'),'utf8')).tracks;
assert.equal(tracks.length,33);
const files=[
	'issue291-alloriginal-48k-decode-song0-smoke-v1-20261124.json',
	...[1,9,17,25].map(start=>
		'issue291-alloriginal-48k-decode-start-'+start+'-count-8-v1-20261124.json')
];
const result={format:'bsb-all-original33-3672-ogg-browser-frameexact-source-independent-v1',
	status:'INCOMPLETE',sourceReports:[],tracks:[],
	limitations:[
		'The five read-only original OGG browser-decode reports are immutable private evidence and were generated in Chromium with a 48kHz AudioContext.',
		'Every source browser-side SHA-256 was independently matched against its canonical owner-private OGG file and exact decoded source frames; aggregation verifies all original track IDs and count boundaries and original manifests.',
		'This tests all 3,672 ORIGINAL SIX STEM OGG files, NOT the 12-per-song melody-voice overlays or optional legacy adaptive variants.',
		'No claim of continuous multi-minute game playback, final audio-master fidelity, calibrated loudness/true peak, source rights or owner taste.'
	]};
try{
	const seen=new Set();
	for(const file of files){
		const filename=join(path,file);
		assert.ok(existsSync(filename),'Missing Chromium decoder source report '+file);
		const bytes=readFileSync(filename);
		const r=JSON.parse(bytes);
		assert.equal(r.status,'PASS_ALL_ORIGINAL_STEM_OGGS_CHROMIUM_DECODED_48KHZ_SOURCE_VERIFIED',
			'Not a pass source report '+file);
		assert.deepEqual(r.pageErrors,[],'Unexpected browser script error');
		assert.deepEqual(r.httpErrors,[],'Missing original OGG HTTP source');
		assert.ok(r.tracks.length===r.count&&r.count>0);
		assert.equal(r.summary.originalSourceOggFiles,r.summary.segments*6);
		assert.equal(r.summary.allSourceFilesIndependentlySHA256,true);
		assert.equal(r.summary.all48kDecodedFrameExact,true);
		for(const t of r.tracks){
			assert.ok(!seen.has(t.index),'Duplicate source song index '+t.index);
			seen.add(t.index);
			assert.equal(tracks[t.index]?.id,t.trackId);
			const manifest=JSON.parse(readFileSync(join(media,tracks[t.index].manifest),'utf8'));
			assert.equal(t.segmentCount,manifest.segments.length);
			assert.equal(t.originalSourceOggFiles,t.segmentCount*6);
			assert.equal(t.allBrowserDecoded48kFramesExact,true);
			assert.match(t.originalSourceShaInventory,/^[0-9a-f]{64}$/);
			result.tracks.push({...t});
		}
		result.sourceReports.push({filename:file,sha256:digest(bytes),
			originalSongs:r.tracks.length,
			originalSegments:r.summary.segments,
			originalOggFiles:r.summary.originalSourceOggFiles});
	}
	assert.equal(seen.size,33,'Missing original 33-song Chromium source decode');
	assert.equal(result.tracks.reduce((sum,x)=>sum+x.segmentCount,0),612);
	assert.equal(result.tracks.reduce((sum,x)=>sum+x.originalSourceOggFiles,0),3672);
	result.tracks.sort((a,b)=>a.index-b.index);
	for(let i=0;i<33;i++)assert.equal(result.tracks[i].index,i);
	if(process.env.QA_INJECT_DECODER_MISMATCH==='1')result.tracks[0].segmentCount++;
	for(let i=0;i<33;i++){
		const p=JSON.parse(readFileSync(join(media,tracks[i].manifest),'utf8'));
		assert.equal(result.tracks[i].segmentCount,p.segments.length,
			'Browser-decoder report no longer agrees with canonical private source manifest');
	}
	result.status='PASS_ALL33_3672_ORIGINAL_CHROMIUM_DECODE_AND_INDEPENDENT_SOURCE';
	result.summary={
		originalSongs:33,originalSegments:612,originalSourceOGGs:3672,
		sourceReportCount:5,allIndependentShaVerified:true,
		allChromium48kDecodedFramesExact:true,
	};
	console.log('ALL33_3672_ORIGINAL_SOURCE_DECODER_AGGREGATE_PASS',JSON.stringify(result.summary));
}catch(e){
	result.status='FAIL_OR_INCOMPLETE';result.error=String(e);
	console.error('ALL33_ORIGINAL_SOURCE_DECODER_AGGREGATE_FAILED',String(e));
	process.exitCode=1;
}finally{
	result.completedAt=new Date().toISOString();
	writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
}
