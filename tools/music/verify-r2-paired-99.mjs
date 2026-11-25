/** Cross-check paired post-compressor curve experiment against independently
 * verified production reports, without re-rendering or manipulating samples.
 * Each original and experimental report is expected to be source-bound first
 * using verify-r2-mixed-matrix.mjs.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const dir=process.argv[2];assert.ok(dir,'Usage: verify-r2-paired-99.mjs REPORT_DIRECTORY');
const sha=x=>createHash('sha256').update(x).digest('hex');
const candidate={knee:.74,ceiling:.82};
let samples=0,sourceChecks=0,below=0,clips=0,overs=0;
let maxRmsChange=0,worst=null;
const evidence=[];
for(const phase of ['opening','middle','ending']){
 const originalBytes=readFileSync(join(dir,phase+'-pass-a.json'));
 const pairedBytes=readFileSync(join(dir,phase+'-paired-74-82.json'));
 const baseline=JSON.parse(originalBytes),report=JSON.parse(pairedBytes);
 assert.equal(report.status,'PASS_SAMPLED_MIXED_OUTPUT_4X_ESTIMATE');
 assert.equal(report.sourceMode,'pinned-public-r2');
 assert.equal(report.matrixPhase,phase);
 assert.deepEqual(report.candidateSpec,candidate);
 assert.deepEqual(report.browserErrors,[]);assert.deepEqual(report.httpErrors,[]);
 assert.equal(baseline.scenarios.length,33);assert.equal(report.scenarios.length,33);
 assert.equal(report.candidateReview.sampledCases,33);
 let misses=0;
 for(let i=0;i<33;i++){
  const x=baseline.scenarios[i],r=report.scenarios[i],c=r.pairedHeadroom?.metrics;
  for(const field of ['trackId','sourceSegment','sourceFrameStart','sourceSegmentFrames','sourceOffsetFrames','sourceManifestUrl','biome','scenario'])
   assert.equal(r[field],field==='sourceOffsetFrames'&&x[field]===undefined?0:x[field],phase+' index '+i+' '+field);
  assert.deepEqual(r.sourceHashes,x.sourceHashes,phase+' index '+i+' source');
  assert.deepEqual(r.test.events,x.test.events,phase+' index '+i+' events');
  assert.equal(r.pairedHeadroom.knee,candidate.knee);
  assert.equal(r.pairedHeadroom.ceiling,candidate.ceiling);
  for(const field of ['samplePeak','estimatedTruePeak4x','rms']){
   const error=Math.abs(r[field]-x[field]);
   assert.ok(error<2e-5,'Baseline changed '+phase+' index '+i+' '+field+' error '+error);
  }
  for(const field of ['sampleRate','channels','windowStartFrame','windowEndFrame','samplesPerChannel'])
   assert.equal(c[field],r[field],phase+' '+i+' candidate '+field);
  assert.equal(c.nonfiniteSamples,0);
  clips+=c.sampleClips;overs+=c.estimatedTrueClips4x;
  assert.equal(c.sampleClips,0);assert.equal(c.estimatedTrueClips4x,0);
  if(c.estimatedTruePeakDbTp4x>-1)misses++;else below++;
  const change=Math.abs(20*Math.log10(c.rms/r.rms));
  assert.ok(Number.isFinite(change));
  maxRmsChange=Math.max(maxRmsChange,change);
  if(!worst||c.estimatedTruePeakDbTp4x>worst.estimatedDbtp)
   worst={phase,index:i,trackId:r.trackId,biome:r.biome,estimatedDbtp:c.estimatedTruePeakDbTp4x};
  samples++;sourceChecks+=Object.keys(r.sourceHashes).length;
 }
 assert.equal(report.candidateReview.targetMisses,misses);
 assert.equal(report.candidateReview.clips,0);assert.equal(report.candidateReview.estimatedOvers,0);
 assert.equal(report.candidateReview.maxEstimatedDbtp,Math.max(...report.scenarios.map(x=>x.pairedHeadroom.metrics.estimatedTruePeakDbTp4x)));
 assert.ok(Math.abs(report.candidateReview.maxAbsRmsDeltaDb-
    Math.max(...report.scenarios.map(x=>Math.abs(20*Math.log10(x.pairedHeadroom.metrics.rms/x.rms)))))<1e-10);
 evidence.push({phase,baselineSha256:sha(originalBytes),pairedSha256:sha(pairedBytes),targetMisses:misses});
}
assert.equal(samples,99);
assert.equal(sourceChecks,693);
const summary={candidate,sampledWindows:samples,sourceHashChecks:sourceChecks,
  candidateBelowMinus1Dbtp:below,clips,estimatedOvers:overs,worst,maxAbsRmsDeltaDb:maxRmsChange,evidence};
console.log('R2_PAIRED_99_BASELINE_AND_CANDIDATE_VERIFIED',JSON.stringify(summary));
if(process.env.QA_REQUIRE_MINUS_1==='1')assert.equal(below,99,'Candidate misses preferred -1 dBTP target');
