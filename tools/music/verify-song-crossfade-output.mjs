/** Independently validate immutable report coverage against the private catalog.
 * This checks receipts/metrics, not a re-render or independent source-byte binding.
 */
import assert from 'node:assert/strict';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
export const PASS='PASS_CONTIGUOUS_V4_OVERLAP_PCM_NOT_MASTERED';
export function verifyCase(r,index,tracks){
 assert.equal(r.format,'bsb-crossfade-live-v4-output-v1');assert.equal(r.index,index);
 assert.equal(r.status,PASS);assert.equal(r.mode,'controlled-gameplay-dsp');
 assert.deepEqual(r.pageErrors,[]);assert.deepEqual(r.httpErrors,[]);
 const from=tracks[index].id,to=tracks[(index+1)%33].id;
 assert.equal(r.expected.from,from);assert.equal(r.expected.to,to);
 assert.equal(r.expected.biome,'debutmont');assert.equal(r.expected.vocals,true);
 const o=r.observed,f=o.fade,c=r.receipt,t=c.terminal,m=r.metrics;
 assert.equal(f.from,from);assert.equal(f.to,to);assert.equal(o.menuMode,false);
 assert.equal(f.start,o.clock);assert.ok(f.end-f.start>=1.9&&f.end-f.start<=4.05);
 for(const role of ['drums','bass','guitar','piano','other','vocals']){
  assert.ok(o.nodes.some(n=>n.role===role&&n.token===o.token-1&&n.end>f.start));
  assert.ok(o.nodes.some(n=>n.role===role&&n.token===o.token));
 }
 assert.equal(c.clean,true);assert.equal(t.quantumValidationVersion,4);assert.equal(t.armed,true);
 for(const n of [c.firstFrame,c.frames,c.rate,c.endFrame,t.finalQuantumStart,t.finalQuantumFrames])assert.ok(Number.isSafeInteger(n)&&n>=0);
 assert.ok(c.frames>0&&c.rate>0&&t.finalQuantumFrames>0);
 assert.equal(c.firstFrame,t.armFrame);assert.equal(c.endFrame,c.firstFrame+c.frames);
 assert.equal(c.endFrame,t.finalQuantumStart+t.finalQuantumFrames);assert.equal(c.endFrame,t.captureEndFrame);
 assert.ok(c.firstFrame/c.rate<=f.start-.25&&c.endFrame/c.rate>=f.end+.25);
 assert.equal(m.sampleRate,c.rate);assert.equal(m.channels,2);assert.equal(m.windowStartFrame,0);assert.equal(m.windowEndFrame,c.frames);assert.equal(m.samplesPerChannel,c.frames);
 for(const k of ['sampleClips','estimatedTrueClips4x','nonfiniteSamples'])assert.equal(m[k],0);
 for(const k of ['samplePeak','estimatedTruePeak4x'])assert.ok(Number.isFinite(m[k])&&m[k]>=0&&m[k]<1);
 assert.ok(Number.isFinite(m.estimatedTruePeakDbTp4x)&&m.estimatedTruePeakDbTp4x<0);
 assert.ok(Number.isFinite(r.ffmpeg.truePeakDbTp)&&r.ffmpeg.truePeakDbTp<0);
 assert.ok(Number.isFinite(r.overlapEnergy.min50msRms)&&r.overlapEnergy.min50msRms>=0);
 assert.ok(Number.isFinite(r.overlapEnergy.longestBelowMinus60DbSeconds)&&r.overlapEnergy.longestBelowMinus60DbSeconds>=0&&r.overlapEnergy.longestBelowMinus60DbSeconds<=f.end-f.start);
 return {index,from,to,overlap:f.end-f.start,beatAligned:f.beatAligned,seconds:c.frames/c.rate,peak:m.estimatedTruePeakDbTp4x,ffmpeg:r.ffmpeg.truePeakDbTp,quiet:r.overlapEnergy.longestBelowMinus60DbSeconds};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const {REPORT_ROOT,REPORT_OUT,BSB291_PRIVATE_AUDIO_ROOT}=process.env;
 const count=Number(process.env.QA_PREFIX_COUNT??33);
 assert.ok(REPORT_ROOT&&REPORT_OUT&&BSB291_PRIVATE_AUDIO_ROOT&&Number.isInteger(count)&&count>=1&&count<=33);
 const tracks=JSON.parse(readFileSync(join(BSB291_PRIVATE_AUDIO_ROOT,'catalog.json'))).tracks;
 assert.equal(tracks.length,33);assert.equal(new Set(tracks.map(t=>t.id)).size,33);
 const cases=[],rejected=[],evidence=[];
 for(let index=0;index<count;index++){
  let accepted=0;
  for(let attempt=1;attempt<=3;attempt++){
   const file='issue312-v4-overlap-index'+String(index).padStart(2,'0')+'-attempt'+attempt+'-20261124.json';
   const p=join(REPORT_ROOT,file);if(!existsSync(p))continue;
   const bytes=readFileSync(p),r=JSON.parse(bytes),sha256=createHash('sha256').update(bytes).digest('hex');
   assert.equal(r.index,index);assert.equal(r.format,'bsb-crossfade-live-v4-output-v1');
   if(r.status===PASS){assert.equal(accepted,0,'Duplicate accepted capture');cases.push(verifyCase(r,index,tracks));accepted++;evidence.push({file,sha256});}
   else {assert.equal(accepted,0,'Unexpected attempt after PASS');assert.equal(r.status,'INVALID_INSTRUMENT_CAPTURE');assert.ok(!r.metrics&&!r.ffmpeg&&r.error.includes('INSTRUMENT_CAPTURE:'));assert.deepEqual(r.pageErrors,[]);assert.deepEqual(r.httpErrors,[]);rejected.push({file,sha256,error:r.error});}
  }
  assert.equal(accepted,1,'Missing qualified capture index '+index);
 }
 const summary={count,beatAligned:cases.filter(c=>c.beatAligned).length,seconds:cases.reduce((s,c)=>s+c.seconds,0),worstPeak:Math.max(...cases.map(c=>c.peak)),worstFFmpeg:Math.max(...cases.map(c=>c.ffmpeg)),maxQuietSeconds:Math.max(...cases.map(c=>c.quiet)),minOverlap:Math.min(...cases.map(c=>c.overlap)),maxOverlap:Math.max(...cases.map(c=>c.overlap)),rejected:rejected.length};
 const result={format:'bsb-crossfade-v4-aggregate-v1',status:count===33?'PASS_FULL33_OVERLAP_PCM_NOT_MASTERED':'PASS_PARTIAL_OVERLAP_PCM_NOT_MASTERED',summary,cases,rejected,evidence};
 writeFileSync(REPORT_OUT,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(result.status,JSON.stringify(summary));
}
