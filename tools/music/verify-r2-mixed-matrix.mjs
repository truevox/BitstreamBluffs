/** Independently bind all sampled PCM reports to the immutable R2 publication
 * inventory. Read-only metadata fetches; no additional media downloads.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertMixedQaMetrics} from './assert-mixed-qa-metrics.js';
const [reportPath,inventoryPath]=process.argv.slice(2);
assert.ok(reportPath&&inventoryPath,'Usage: verify-r2-mixed-matrix.mjs REPORT INVENTORY');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const reportBytes=readFileSync(reportPath), inventoryBytes=readFileSync(inventoryPath);
const report=JSON.parse(reportBytes), inventory=JSON.parse(inventoryBytes);
const root='https://bsb-audio.bearcave.win/releases/20261124-69a6fb46/';
assert.equal(report.catalogUrl,root+'catalog.json');
assert.equal(report.sourceMode,'pinned-public-r2');
assert.equal(inventory.tracks,33);
assert.ok(inventory.publicBaseCommit.startsWith('69a6fb46'));
assert.equal(report.scenarios.length,33);
const phase=report.matrixPhase||'middle';
const position=['opening','middle','ending'].indexOf(phase);
assert.ok(position>=0,'Unknown matrix phase');
assert.deepEqual(report.browserErrors,[]);
assert.deepEqual(report.httpErrors,[]);
const objects=new Map(inventory.objects.map(o=>[o.key,o]));
assert.equal(objects.size,inventory.objects.length);
async function getJson(key){
 const response=await fetch(root+key,{redirect:'error',signal:AbortSignal.timeout(20000)});
 assert.ok(response.ok,key+' HTTP '+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());
 const expected=objects.get(key);
 assert.ok(expected,key+' absent from published inventory');
 assert.equal(bytes.length,expected.size,key+' length mismatch');
 assert.equal(sha(bytes),expected.sha256,key+' SHA mismatch');
 return JSON.parse(bytes);
}
const catalog=await getJson('catalog.json');
assert.equal(catalog.tracks.length,33);
const biomeOrder=['candy-cane-canyon','garbage-dump-glacier','vertigo-vents','crystal-cavern','bitstream-bluffs'];
const roles=['drums','bass','guitar','piano','other','vocals'];
let verified=0;
for(let i=0;i<33;i++){
 const track=catalog.tracks[i], result=report.scenarios[i];
 assert.equal(result.trackId,track.id);
 assert.match(track.manifest,/^packs\/[\w-]+\/pack\.json$/);
 assert.equal(result.sourceManifestUrl,root+track.manifest);
 assert.equal(result.biome,biomeOrder[(i+position+4)%biomeOrder.length]);
 assert.equal(result.test.profile,'crash-static-overlap');
 assert.equal(result.scenario,'mixed-game-stress');
 assert.equal(result.originalSourceCount,7);
 assert.equal(result.test.events.length,7);
 assert.equal(result.sampleRate,48000);
 assert.equal(result.channels,2);
 assert.equal(result.samplesPerChannel,result.windowEndFrame-result.windowStartFrame);
 assert.ok(Math.abs(result.test.windowSeconds-result.samplesPerChannel/48000)<1e-9);
 assert.equal(result.edgeFramesNotInterpolated,0);
 assert.ok(Math.abs(result.estimatedTruePeakDbTp4x-20*Math.log10(Math.max(1e-12,result.estimatedTruePeak4x)))<1e-8);

 assert.equal(result.productionGraph.productionPeakGuard,true);
 assert.equal(result.test.master,1);
 assert.equal(result.test.music,1);
 assert.equal(result.test.sfx,1);
 assert.equal(result.test.wind,1);
 const pack=await getJson(track.manifest);
 assert.equal(pack.id,track.id);
 const index=[0,Math.floor((pack.segments.length-1)/2),pack.segments.length-1][position];
 const segment=pack.segments[index];
 assert.equal(result.sourceSegment,index);
 assert.equal(result.sourceFrameStart,segment.startFrame);
 assert.equal(result.sourceSegmentFrames,segment.frames);
 if(phase!=='middle'){
  assert.equal(result.sourceWindowPosition,phase);
  assert.equal(result.sourcePlaybackStartFrame,7680);
  assert.equal(result.windowStartFrame,7680);
  assert.equal(result.windowEndFrame,184800);
  assert.equal(result.sourceOffsetFrames,phase==='ending'?Math.max(0,segment.frames-168000):0);
  if(phase==='ending'){
   assert.equal(segment.startFrame+segment.frames,pack.frameCount);
   assert.ok(result.sourcePlaybackStartFrame+segment.frames-result.sourceOffsetFrames<=result.windowEndFrame);
  }
 }
 const expectedRoles=[...roles,'voice:'+result.biome];
 assert.deepEqual(result.sourceRoles,expectedRoles);
 assert.deepEqual(Object.keys(result.sourceHashes).sort(),[...expectedRoles].sort());
 for(const role of expectedRoles){
  const key=track.manifest.slice(0,-'pack.json'.length)+segment.sources[role];
  const item=objects.get(key);
  assert.ok(item,'Missing publication inventory key '+key);
  assert.equal(result.sourceHashes[role],item.sha256,key+' source SHA mismatch');
  verified++;
 }
 // Reject rather than hide unsafe numerical results.
 assertMixedQaMetrics(result);
}
assert.equal(report.status,'PASS_SAMPLED_MIXED_OUTPUT_4X_ESTIMATE');
assert.equal(report.summary.songs,33);
assert.equal(report.summary.mixedCases,33);
assert.equal(report.summary.totalHashedSourceInputs,231);
for(const key of ['overUnityAllSamples','overUnityAllTruePeak4xFrames','pageErrors','httpErrors'])assert.equal(report.summary[key],0);
assert.equal(verified,231);
const worst=report.scenarios.reduce((a,b)=>b.estimatedTruePeak4x>a.estimatedTruePeak4x?b:a);
console.log('R2_MIXED_MATRIX_INVENTORY_VERIFIED',JSON.stringify({phase,tracks:33,verifiedMetadata:34,verifiedSourceHashes:verified,
 reportSha256:sha(reportBytes),inventorySha256:sha(inventoryBytes),worst:{trackId:worst.trackId,biome:worst.biome,segment:worst.sourceSegment,dBTP:worst.estimatedTruePeakDbTp4x},measuredSeconds:report.scenarios.reduce((sum,r)=>sum+r.test.windowSeconds,0)}));
