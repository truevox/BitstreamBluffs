#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';

const [file,archive=process.env.MUSIC_PACK_ARCHIVE||'/home/hermes/.local/share/bitstream-static-music-v1/packs']=process.argv.slice(2);
assert.ok(file,'Usage: node tools/music/verify-original-segment-spread-report.mjs report.json [private pack archive]');
const report=JSON.parse(readFileSync(file,'utf8'));
const allSegments=report.format==='bbs-original-ogg-game-music-bus-all-segments-v1';
assert.ok(allSegments||report.format==='bbs-original-ogg-game-music-bus-segment-spread-v1');
assert.equal(report.sampleRate,48000);
assert.equal(report.sampleSeconds,2.5);
assert.ok(report.segments.length>0);
assert.equal(report.results.length,report.segments.length*4);
const folder=resolve(archive);
const packs=new Map();
for(const segment of report.segments){
 assert.ok(Number.isSafeInteger(segment.segmentIndex));
 assert.ok(segment.segmentIndex>=0&&segment.segmentIndex<segment.segmentCount);
 const list=packs.get(segment.pack)||[];list.push(segment.segmentIndex);packs.set(segment.pack,list);
 const packJson=JSON.parse(readFileSync(join(folder,segment.pack,'pack.json'),'utf8'));
 const source=packJson.segments[segment.segmentIndex];
 assert.equal(segment.startFrame,source.startFrame);
 assert.equal(segment.sourceFrames,source.frames);
 assert.equal(segment.segmentCount,packJson.segments.length);
 for(const [key,actualHash] of Object.entries(segment.sourceSha256)){
  assert.match(actualHash,/^[0-9a-f]{64}$/);
  let filename=source.sources[key]||(key==='voice:debutmont'?source.sources['voice:debumont']:null);
  assert.ok(filename,'Source missing '+segment.pack+'/'+segment.segmentIndex+'/'+key);
  if(filename.startsWith('adaptive/debutmont/'))
   filename=filename.replace('adaptive/debutmont/','adaptive/debumont/');
  const digest=createHash('sha256').update(readFileSync(join(folder,segment.pack,filename))).digest('hex');
  assert.equal(actualHash,digest,`Original-source provenance mismatch ${segment.pack}/${segment.segmentIndex}/${key}`);
 }
 assert.equal(Object.keys(segment.sourceSha256).length,18);
}
assert.ok(packs.size>=1&&packs.size<=4);
for(const [pack,indices] of packs){
 const count=JSON.parse(readFileSync(join(folder,pack,'pack.json'),'utf8')).segments.length;
 assert.deepEqual(indices,allSegments?Array.from({length:count},(_,i)=>i):
  [0,Math.floor((count-1)/2),count-1]);
}
for(const row of report.results){
 assert.ok(packs.get(row.pack)?.includes(row.segmentIndex));
 assert.ok(['garbage-dump-glacier','vertigo-vents','crystal-cavern','bitstream-bluffs'].includes(row.biome));
 assert.equal(row.scenario,'maximum-music-with-vocals');
 assert.ok(Number.isFinite(row.rms)&&Number.isFinite(row.samplePeak));
 assert.ok(row.samplePeak>0&&row.samplePeak<.98);
 assert.equal(row.nonfiniteSamples,0);
 assert.equal(row.overUnitySamples,0);
 assert.equal(row.nearUnitySamples,0);
}
console.log('SOURCE_BOUND_SEGMENT_SPREAD_PASS',JSON.stringify({
 packs:packs.size,sourceSegments:report.segments.length,
 originalsHashed:report.segments.reduce((n,s)=>n+Object.keys(s.sourceSha256).length,0),
 scenarios:report.results.length,maxPeak:Math.max(...report.results.map(r=>r.samplePeak)),
 reportSha256:createHash('sha256').update(readFileSync(file)).digest('hex')
}));
