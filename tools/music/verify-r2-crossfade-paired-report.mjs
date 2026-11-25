/** Independently verify a pinned public R2 33-crossfade paired report.
 * No browser execution and no audio downloads: binds metadata and decoded
 * source hashes to the original immutable publication inventory.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertMixedQaMetrics} from './assert-mixed-qa-metrics.js';
const [reportPath,inventoryPath]=process.argv.slice(2);
assert.ok(reportPath&&inventoryPath,'Usage: verify-r2-crossfade-paired-report.mjs REPORT INVENTORY');
const sha=x=>createHash('sha256').update(x).digest('hex');
const bytes=readFileSync(reportPath),report=JSON.parse(bytes);
const invBytes=readFileSync(inventoryPath),inventory=JSON.parse(invBytes);
const root='https://bsb-audio.bearcave.win/releases/20261124-69a6fb46/';
assert.equal(report.format,'bsb-r2-offline-paired-crossfade-v1');
assert.equal(report.status,'PASS_OFFLINE_PAIRED_SAMPLED_NOT_MASTERED');
assert.equal(report.coverage,'all-33-transitions');
assert.deepEqual(report.errors,[]);
assert.equal(report.inventorySha256,sha(invBytes));
assert.equal(inventory.tracks,33);
assert.equal(report.cases.length,33);
const spec=report.candidateSpec;
assert.ok(Number.isFinite(spec?.knee)&&spec.knee>=.6&&spec.knee<.9);
assert.ok(Number.isFinite(spec.ceiling)&&spec.ceiling<=.9&&spec.ceiling-spec.knee>=.02);
const objects=new Map(inventory.objects.map(x=>[x.key,x]));
assert.equal(objects.size,inventory.objects.length);
async function meta(key){
 const response=await fetch(root+key,{redirect:'error',signal:AbortSignal.timeout(20000)});
 assert.ok(response.ok,'HTTP '+response.status+' '+key);
 const data=Buffer.from(await response.arrayBuffer()), expected=objects.get(key);
 assert.ok(expected,'Missing metadata inventory key '+key);
 assert.equal(data.length,expected.size,'Size mismatch '+key);
 assert.equal(sha(data),expected.sha256,'SHA mismatch '+key);
 return JSON.parse(data);
}
const catalog=await meta('catalog.json');
assert.equal(catalog.tracks.length,33);
assert.equal(new Set(catalog.tracks.map(t=>t.id)).size,33);
const risk=['candy-cane-canyon','garbage-dump-glacier','vertigo-vents','crystal-cavern','bitstream-bluffs'];
const special=new Map([[1,'vertigo-vents'],[4,'candy-cane-canyon'],[25,'garbage-dump-glacier'],[26,'vertigo-vents'],[31,'vertigo-vents']]);
const roles=['drums','bass','guitar','piano','other','vocals'];
let checked=0;
for(let i=0;i<33;i++){
 const x=report.cases[i],from=catalog.tracks[i],to=catalog.tracks[(i+1)%33];
 assert.equal(x.index,i);
 assert.equal(x.from,from.id);assert.equal(x.to,to.id);
 assert.equal(x.biome,special.get(i)||risk[i%risk.length]);
 assert.deepEqual(x.candidateSpec,spec);
 assert.equal(x.plan.beatAligned,false);
 assert.ok(Math.abs(x.plan.duration-2.8)<1e-8);
 assert.ok(Math.abs(x.fadeEnd-x.fadeStart-2.8)<1e-8);
 assert.ok(x.receipts.length>=2);
 let count=0;
 for(const track of [from,to]){
  assert.match(track.manifest,/^packs\/[\w-]+\/pack\.json$/);
  const m=await meta(track.manifest);
  assert.equal(m.id,track.id);assert.equal(m.sampleRate,48000);
  const lo=track===from?m.frameCount-182400:0;
  const hi=track===from?m.frameCount:182400;
  let cursor=lo;
  for(const receipt of x.receipts.filter(r=>r.id===track.id)){
   assert.equal(receipt.manifestUrl,root+track.manifest);
   const seg=m.segments[receipt.segment];
   assert.ok(seg,'Missing segment');
   assert.equal(receipt.first,cursor);
   assert.equal(receipt.first,Math.max(lo,seg.startFrame));
   assert.equal(receipt.last,Math.min(hi,seg.startFrame+seg.frames));
   assert.ok(receipt.last>receipt.first);
   cursor=receipt.last;
   const expectedRoles=[...roles,'voice:'+x.biome];
   assert.deepEqual(Object.keys(receipt.hashes).sort(),expectedRoles.sort());
   for(const role of expectedRoles){
    const key=track.manifest.slice(0,-'pack.json'.length)+seg.sources[role];
    assert.equal(receipt.hashes[role],objects.get(key)?.sha256,key+' source SHA mismatch');
    count++;
   }
  }
  assert.equal(cursor,hi);
 }
 assert.equal(count,x.verifiedSourceHashes);
 checked+=count;
 for(const metrics of [x.baseline,x.candidate]){
  assertMixedQaMetrics(metrics);
  assert.equal(metrics.sampleRate,48000);assert.equal(metrics.channels,2);
  assert.equal(metrics.samplesPerChannel,230400);
  assert.equal(metrics.windowEndFrame-metrics.windowStartFrame,230400);
  assert.equal(metrics.edgeFramesNotInterpolated,0);
  assert.ok(Math.abs(metrics.estimatedTruePeakDbTp4x-20*Math.log10(Math.max(1e-12,metrics.estimatedTruePeak4x)))<1e-8);
 }
 assert.ok(Math.abs(x.deltaDb-(x.candidate.estimatedTruePeakDbTp4x-x.baseline.estimatedTruePeakDbTp4x))<1e-8);
 assert.ok(Math.abs(x.rmsDeltaDb-20*Math.log10(x.candidate.rms/x.baseline.rms))<1e-8);
}
const worst=report.cases.reduce((a,b)=>b.candidate.estimatedTruePeakDbTp4x>a.candidate.estimatedTruePeakDbTp4x?b:a);
const belowTarget=report.cases.filter(x=>x.candidate.estimatedTruePeakDbTp4x<=-1).length;
console.log('PINNED_R2_PAIRED_CROSSFADE_VERIFIED',JSON.stringify({
 candidateSpec:spec,transitions:33,sourceHashChecks:checked,metadataShaChecks:34,
 seconds:33*4.8,reportSha256:sha(bytes),inventorySha256:sha(invBytes),
 belowMinus1Dbtp:belowTarget,worst:{index:worst.index,from:worst.from,biome:worst.biome,estimatedDbtp:worst.candidate.estimatedTruePeakDbTp4x},
 maxAbsRmsDeltaDb:Math.max(...report.cases.map(x=>Math.abs(x.rmsDeltaDb)))
}));
if(process.env.QA_REQUIRE_MINUS_1==='1')assert.equal(belowTarget,33,'Candidate misses -1 dBTP target');
