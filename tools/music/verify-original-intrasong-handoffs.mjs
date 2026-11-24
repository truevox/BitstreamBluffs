#!/usr/bin/env node
/**
 * Independently reconstruct the 33-song original internal segment timeline
 * and verify ALL 579 manifest joins + the 99 observed real WebAudio joins.
 *
 * Reports and authentic OGG hashes stay owner-private. Read-only archive.
 * Mutate a DISPOSABLE in-memory report copy with QA_INJECT_BOUNDARY_GAP=1
 * to verify that independent validation genuinely fails closed.
 */
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,statSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join,sep} from 'node:path';
import {createHash} from 'node:crypto';

const original=process.env.BSB291_PRIVATE_AUDIO_ROOT;
const reports=process.env.REPORT_ROOT;
const output=process.env.REPORT_OUT;
if(!original||!reports||!output||existsSync(output))
	throw Error('Requires canonical private catalog, private reports and NEW immutable output path');
const root=realpathSync(resolve(original)),logs=resolve(reports);
const tracks=JSON.parse(readFileSync(join(root,'catalog.json'),'utf8')).tracks;
assert.equal(tracks.length,33,'This test requires exactly 33 original source tracks');
const roles=['vocals','drums','bass','guitar','piano','other'];
const sha=buf=>createHash('sha256').update(buf).digest('hex');
const report={format:'bsb-intrasong-33-track-579-manifest-99-webaudio-source-independent-v1',
	status:'INCOMPLETE',cases:[],structural:[],sourceEvidence:[],
	startedAt:new Date().toISOString(),
	limitations:[
		'99 real native WebAudio original-stem boundaries sampled first/middle/final per song after a QA-only transport seek; not continuous multi-minute playback or 579 live in-browser join checks',
		'All 579 internal boundaries reconstruct contiguous original 48-kHz manifest source frames; 3,672 original CORE OGG source files rehashed/read-only on disk.',
		'The real browser internally decoded the 594 original source buffers at the device rate and validated expected resampled durations; this verifier independently checks only the recorded source-start metadata against private original frame authority and cannot reconstruct the rendered output audio.',
		'This is not final-device PCM, calibrated true peak, beat/downbeat validation, sound-level audibility, adaptive alternate biome routing or low-end device profiling.',
		'All private original recordings and source/report hashes remain on the owner machine; never commit raw reports or OGG masters.'
	]};
try{
	const expectedFiles=new Map();
	const indexCases=new Map();
	const structural=[];
	const names=[];
	for(let i=0;i<33;i++){
		const n=i===0?1:Math.min(3,33-i);
		const start=i===0?0:1+Math.floor((i-1)/3)*3;
		// Index0 has its own immutable smoke report; all others live
		// in length-three or final length-two immutable batch reports.
		const file=i===0?'issue291-intrasong-sample-index0-v2-20261124.json':
			'issue291-original-intrasong-real-schedule-start-'+start+
			'-count-'+Math.min(3,33-start)+'-v1-20261124.json';
		if(!names.includes(file))names.push(file);
	}
	const batches=new Map();
	for(const file of names){
		const path=join(logs,file);
		assert.ok(existsSync(path),'Missing real game intra-segment audit '+file);
		const bytes=readFileSync(path);
		const batch=JSON.parse(bytes);
		assert.equal(batch.status,
			'PASS_NATIVE_REAL_ORIGINAL_INTRA_SEGMENT_SCHEDULING_NOT_FULL_SONG',
			'Original browser report failed: '+file);
		assert.deepEqual(batch.pageErrors,[],file+' page errors');
		assert.deepEqual(batch.httpErrors,[],file+' original-media HTTP errors');
		assert.equal(batch.cases.length,batch.count*3);
		assert.equal(batch.originalManifestStructuralBoundaries.length,batch.count);
		batches.set(file,batch);
		report.sourceEvidence.push({filename:file,sha256:sha(bytes),
			observedBoundaries:batch.cases.length});
	}
	const archiveFiles=new Map();
	for(let index=0;index<tracks.length;index++){
		const track=tracks[index];
		const manifestFile=resolve(root,track.manifest);
		assert.ok(manifestFile.startsWith(root+sep));
		const base=dirname(manifestFile);
		// The owner-private overlay intentionally symlinks each pack
		// to its canonical store. Bound every source to THAT resolved
		// pack directory, never to an arbitrary external symlink.
		const canonicalPack=realpathSync(base);
		const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
		assert.equal(manifest.id,track.id,'Original track ID/manifest mismatch');
		assert.equal(manifest.sampleRate,48000,'Original sample rate must be source 48k');
		assert.ok(manifest.segments.length>=3);
		assert.equal(manifest.segments[0].startFrame,0);
		const targets=[1,Math.floor(manifest.segments.length/2),manifest.segments.length-1];
		assert.equal(new Set(targets).size,3);
		let accumulated=0;
		for(let k=0;k<manifest.segments.length;k++){
			const s=manifest.segments[k];
			assert.equal(s.startFrame,accumulated,
				'Noncontiguous source frames index '+index+' segment '+k);
			assert.ok(Number.isSafeInteger(s.frames)&&s.frames>0);
			for(const role of roles){
				const rel=s.sources?.[role];
				assert.ok(typeof rel==='string'&&!rel.startsWith('/')&&
					!rel.includes('..')&&!rel.includes('\\'),
					'Unsafe/missing original core stem '+role);
				const filename=realpathSync(resolve(base,rel));
				assert.ok(filename.startsWith(canonicalPack+sep)&&filename.endsWith('.ogg'),
					'Original asset escaped the canonical private song pack');
				if(!archiveFiles.has(filename)){
					const st=statSync(filename);
					assert.ok(st.isFile()&&st.size>100,
						'Empty or invalid original OGG');
					const bytes=readFileSync(filename);
					archiveFiles.set(filename,{
						logicalOriginal:track.manifest.replace(/pack\.json$/,'')+rel,
						sha256:sha(bytes),bytes:bytes.length,
					});
				}
			}
			accumulated+=s.frames;
		}
		assert.equal(accumulated,manifest.frameCount,'Total original song frame authority');
		for(let j=1;j<manifest.segments.length;j++){
			const old=manifest.segments[j-1],next=manifest.segments[j];
			assert.equal(old.startFrame+old.frames,next.startFrame);
			structural.push({trackIndex:index,trackId:track.id,joinIndex:j,
				boundaryFrame:next.startFrame});
		}
		const file=index===0?'issue291-intrasong-sample-index0-v2-20261124.json':
			'issue291-original-intrasong-real-schedule-start-'+(1+Math.floor((index-1)/3)*3)+
			'-count-'+Math.min(3,33-(1+Math.floor((index-1)/3)*3))+'-v1-20261124.json';
		const batch=batches.get(file);
		assert.ok(batch,'No matching actual browser report '+file);
		const cases=batch.cases.filter(c=>c.trackIndex===index);
		assert.equal(cases.length,3,'Missing browser cases for original track '+index);
		for(const target of targets){
			const c=cases.find(c=>c.nextSegmentIndex===target);
			assert.ok(c,'Original intrasong boundary not actually tested '+index+' '+target);
			assert.equal(c.trackId,track.id);
			assert.equal(c.oldSegmentIndex,target-1);
			assert.equal(c.realBoundaryFrame,manifest.segments[target].startFrame);
			assert.ok(Math.abs(c.realBoundaryTime-c.realBoundaryFrame/manifest.sampleRate)<1e-8);
			assert.ok(Math.abs(c.qaResumeOffset-(c.realBoundaryTime-batch.leadSeconds))<.0001);
			assert.equal(c.originalRolesChecked,6);
			assert.equal(c.originalSourceScheduling.length,6);
			if(process.env.QA_INJECT_BOUNDARY_GAP==='1'&&index===0&&target===1){
				// DISPOSABLE report object only; no report or original OGG
				// file is changed. Independent verifier MUST fail closed.
				c.originalSourceScheduling[0].nextStartClock+=.250;
			}
			const byRole=new Map(c.originalSourceScheduling.map(x=>[x.role,x]));
			assert.equal(byRole.size,6,'Duplicated original role in browser report');
			let maxMs=0,baseClock=null,rate=null;
			for(const role of roles){
				const o=byRole.get(role);
				assert.ok(o,'Original source role missing '+role);
				const previous=manifest.segments[target-1],next=manifest.segments[target];
				assert.equal(o.originalSourceSampleRate,manifest.sampleRate);
				assert.ok(Number.isSafeInteger(o.sampleRate)&&o.sampleRate>=8000);
				if(rate===null)rate=o.sampleRate;
				assert.equal(o.sampleRate,rate,'Buffer source playback rate changed mid-song');
				const expectedPrevDeviceFrames=previous.frames*o.sampleRate/manifest.sampleRate;
				const expectedNextDeviceFrames=next.frames*o.sampleRate/manifest.sampleRate;
				assert.ok(Math.abs(o.previousDeviceFrames-expectedPrevDeviceFrames)<=1.5,
					'Previous actual original OGG decoded/truncated unexpectedly');
				assert.ok(Math.abs(o.nextDeviceFrames-expectedNextDeviceFrames)<=1.5,
					'Next original OGG decoded/truncated unexpectedly');
				const prevRemaining=previous.frames/manifest.sampleRate-o.previousScheduledOffset;
				assert.ok(prevRemaining>0&&prevRemaining<=batch.leadSeconds+.015,
					'Real source did not seek into previous original segment');
				assert.ok(Math.abs(o.previousStartClock+prevRemaining-o.previousStopClock)<.020,
					'Previous audio end was not scheduled at authentic boundary');
				const observedGap=o.nextStartClock-o.previousStopClock;
				assert.ok(Math.abs(observedGap)<.020,
					'REAL original intrasong source scheduled a gap/overlap >=20ms');
				assert.ok(Math.abs(Math.abs(observedGap)*1000-o.absoluteGapMs)<.0001,
					'Observed gap metric lied about actual source timestamps');
				if(baseClock===null)baseClock=o.nextStartClock;
				assert.ok(Math.abs(o.nextStartClock-baseClock)<.020,
					'Original six sources lost inter-role alignment');
				maxMs=Math.max(maxMs,Math.abs(observedGap)*1000);
			}
			assert.ok(Math.abs(maxMs-c.maxAbsGapMs)<.0001,
				'Reported per-case maximum gap is not the measured value');
			report.cases.push({index,trackId:track.id,
				joinIndex:target,frame:manifest.segments[target].startFrame,
				maxAbsOriginalSourceGapMs:maxMs,
				playbackSampleRate:rate,originalSourceSampleRate:manifest.sampleRate,
			});
		}
		report.structural.push({index,trackId:track.id,
			totalSourceFrames:manifest.frameCount,
			totalSegments:manifest.segments.length,
			manifestInternalJoins:manifest.segments.length-1});
	}
	assert.equal(structural.length,579,'Exact 33-song internal join count changed');
	assert.equal(report.cases.length,99,'Real browser internal joins missing');
	assert.equal(report.structural.length,33);
	const aggregateHash=createHash('sha256');
	for(const [name,detail] of [...archiveFiles.entries()].sort((a,b)=>a[0].localeCompare(b[0])))
		aggregateHash.update(JSON.stringify({relative:name.slice(root.length+1),
			sha256:detail.sha256,bytes:detail.bytes})+'\n');
	report.status='PASS_ALL33_ORIGINAL_INTRA_SEGMENT_WEBAUDIO_SCHEDULE_AND_579_MANIFEST_JOINS';
	report.summary={
		actualBrowserInternalHandoffs:99,originalSongIds:33,
		actualOriginalStemRoleComparisons:99*6,
		structuralManifestInternalJoins:579,
		originalSourceFilesRehashed:archiveFiles.size,
		originalSourceBytesRehashed:[...archiveFiles.values()].reduce((sum,x)=>sum+x.bytes,0),
		originalSourceHashInventoryDigest:aggregateHash.digest('hex'),
		maxActualOriginalStemScheduleGapMs:Math.max(...report.cases.map(x=>x.maxAbsOriginalSourceGapMs)),
		allSourceOriginalSampleRate:48000,
		sourceFilesNotModified:true,
	};
	console.log('ALL33_INTRA_SONG_INDEPENDENT_VERIFY',report.status,JSON.stringify(report.summary));
}catch(e){
	report.status='FAIL_OR_INCOMPLETE';report.error=String(e);
	console.error('ALL33_INTRA_SONG_INDEPENDENT_VERIFY_FAILED',String(e));
	process.exitCode=1;
}finally{
	report.completedAt=new Date().toISOString();
	writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
