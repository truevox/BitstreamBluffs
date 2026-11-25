/** Same-input master guard experiment; no production curve change. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {assertMixedQaMetrics} from './assert-mixed-qa-metrics.js';
const [input,out]=process.argv.slice(2);
assert.ok(input&&out&&!existsSync(out));
const bytes=readFileSync(input),report=JSON.parse(bytes);
assert.equal(report.matrixPhase,'ending');
assert.equal(report.scenarios.length,33);
assert.equal(report.status,'PASS_SAMPLED_MIXED_OUTPUT_4X_ESTIMATE');
const cases=report.scenarios.filter(x=>x.estimatedTruePeakDbTp4x>-1);
assert.equal(cases.length,5);
const result={format:'bsb-r2-hot-ending-paired-master-v1',sourceReportSha256:createHash('sha256').update(bytes).digest('hex'),cases:[],status:'INVALID_INCOMPLETE',errors:[]};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 page.on('pageerror',e=>result.errors.push(String(e)));
 page.on('response',r=>{if(r.status()>=400)result.errors.push('HTTP '+r.status()+' '+r.url())});
 await page.goto('http://127.0.0.1:18244/tools/music/qa-mixed-final-output.html');
 await page.waitForFunction(()=>window.__mixedFinalAudioQA);
 for(const original of cases){
  const r=await page.evaluate(args=>window.__mixedFinalAudioQA.render(args),{pack:original.pack,segmentIndex:original.sourceSegment,biome:original.biome,scenario:'mixed-game-stress',profile:'crash-static-overlap',manifestUrl:original.sourceManifestUrl,windowPosition:'ending',pairedHeadroom:true});
  assert.deepEqual(r.sourceHashes,original.sourceHashes);
  assert.deepEqual(r.test.events,original.test.events);
  assert.equal(r.sourceOffsetFrames,original.sourceOffsetFrames);
  for(const k of ['samplePeak','estimatedTruePeak4x','rms'])assert.ok(Math.abs(r[k]-original[k])<1e-6,'Baseline mismatch '+k);
  const candidate=r.pairedHeadroom.metrics;
  const entry={trackId:r.trackId,biome:r.biome,segment:r.sourceSegment,hashes:r.sourceHashes,baseline:{samplePeak:r.samplePeak,truePeak:r.estimatedTruePeak4x,dbtp:r.estimatedTruePeakDbTp4x,rms:r.rms},candidate,deltaDb: candidate.estimatedTruePeakDbTp4x-r.estimatedTruePeakDbTp4x,rmsDeltaDb:20*Math.log10(candidate.rms/r.rms)};
  result.cases.push(entry);
  assertMixedQaMetrics(r);assertMixedQaMetrics(candidate);
  console.log('PAIRED_ENDING',JSON.stringify({track:r.trackId,biome:r.biome,baseline:entry.baseline.dbtp,candidate:candidate.estimatedTruePeakDbTp4x,delta:entry.deltaDb,rmsDelta:entry.rmsDeltaDb}));
 }
 assert.deepEqual(result.errors,[]);
 result.status='PASS_PAIRED_SAMPLED_NOT_MASTERED';
}catch(e){result.error=String(e);console.error(e);process.exitCode=1;}
finally{await browser.close();writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
