#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';

const [target,...inputs]=process.argv.slice(2);
assert.ok(target&&inputs.length>=2,'Usage: node tools/music/merge-original-segment-spread-reports.mjs output.json pack1.json pack2.json ...');
const reports=inputs.map(input=>JSON.parse(readFileSync(input,'utf8')));
assert.ok(reports.every(r=>r.format==='bbs-original-ogg-game-music-bus-all-segments-v1'));
assert.ok(reports.every(r=>r.sampleRate===48000&&r.sampleSeconds===2.5));
const packs=new Set();
for(const report of reports){
 const members=new Set(report.segments.map(s=>s.pack));
 assert.equal(members.size,1,'Each input must be exactly one source pack');
 const [pack]=members;
 assert.ok(!packs.has(pack),'Duplicate pack '+pack);packs.add(pack);
 assert.equal(report.results.length,report.segments.length*4);
 assert.ok(report.results.every(r=>r.pack===pack));
}
const merged={...reports[0],
 source:'All original OGG song segments — aggregated immutable source-pack reports; 2.5s per segment × 4 risky biomes',
 segments:reports.flatMap(r=>r.segments),
 results:reports.flatMap(r=>r.results),
 constituentReports:inputs.map(input=>({name:basename(input),
  sha256:createHash('sha256').update(readFileSync(input)).digest('hex')}))};
writeFileSync(target,JSON.stringify(merged,null,2)+'\n',{flag:'wx'});
console.log('MERGED_SEGMENT_REPORTS',JSON.stringify({packs:[...packs],segments:merged.segments.length,scenarios:merged.results.length,target}));
