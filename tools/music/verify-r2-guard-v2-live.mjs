/** Independently validate six qualified headless-Chromium v2 final-output
 * crossfades and preserve all invalid instrument attempts. No PCM stored in
 * repo. The exact candidate build identity is recorded separately because
 * the live capture protocol cannot cryptographically attest source bundles.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {verifyCase} from './verify-song-crossfade-output.mjs';
const [dir,inventoryPath]=process.argv.slice(2);
assert.ok(dir&&inventoryPath,'Usage: verify-r2-guard-v2-live.mjs REPORT_DIRECTORY PUBLISHED_INVENTORY');
const sha=x=>createHash('sha256').update(x).digest('hex');
const root='https://bsb-audio.bearcave.win/releases/20261124-69a6fb46/';
const inv=JSON.parse(readFileSync(inventoryPath));
assert.equal(inv.tracks,33);
const catalogResponse=await fetch(root+'catalog.json',{redirect:'error',signal:AbortSignal.timeout(20000)});
assert.ok(catalogResponse.ok);
const catalogBytes=Buffer.from(await catalogResponse.arrayBuffer());
assert.equal(sha(catalogBytes),inv.objects.find(o=>o.key==='catalog.json')?.sha256);
const tracks=JSON.parse(catalogBytes).tracks;
assert.equal(tracks.length,33);
const selected=[[0,'a'],[1,'a'],[4,'a'],[25,'b'],[26,'c'],[31,'a']];
const invalid=[[25,'a'],[26,'a'],[26,'b']];
let seconds=0,worst=null;
const accepted=[];
for(const [index,attempt] of selected){
 const file=`guard-v2-live-${index}-${attempt}.json`;
 const bytes=readFileSync(join(dir,file)),report=JSON.parse(bytes);
 const verified=verifyCase(report,index,tracks);
 assert.ok(verified.peak<=-1,`Below target ${file}`);
 assert.ok(verified.ffmpeg<=-1,`FFmpeg below target ${file}`);
 assert.equal(verified.quiet,0);
 assert.equal(verified.beatAligned,false);
 assert.ok(Math.abs(verified.overlap-2.8)<1e-9);
 seconds+=verified.seconds;
 accepted.push({file,sha256:sha(bytes),peak:verified.peak,ffmpeg:verified.ffmpeg,seconds:verified.seconds});
 if(!worst||verified.peak>worst.peak)worst={index,peak:verified.peak,ffmpeg:verified.ffmpeg};
}
const rejected=[];
for(const [index,attempt] of invalid){
 const file=`guard-v2-live-${index}-${attempt}.json`;
 const bytes=readFileSync(join(dir,file)),r=JSON.parse(bytes);
 assert.equal(r.status,'INVALID_INSTRUMENT_CAPTURE');
 assert.ok(!r.metrics&&!r.ffmpeg);
 assert.deepEqual(r.pageErrors,[]);assert.deepEqual(r.httpErrors,[]);
 assert.match(String(r.error),/INSTRUMENT_CAPTURE:.*(?:discontinuity|quantum gap)/);
 rejected.push({file,sha256:sha(bytes)});
}
assert.equal(accepted.length,6);assert.equal(rejected.length,3);
console.log('R2_GUARD_V2_LIVE_6_VERIFIED',JSON.stringify({
 qualified:accepted.length,invalidRetained:rejected.length,
 totalContinuousSeconds:seconds,worst,accepted,rejected,
 limitations:'Headless Chromium on local isolated candidate build; cannot attest bundle identity from report; not physical Chromebook or full playlist/audio mastering certification'
}));
