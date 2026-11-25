/** Source-bound offline comparison, distinct from live capture evidence. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {assertMixedQaMetrics} from './assert-mixed-qa-metrics.js';
const [inventoryPath,out]=process.argv.slice(2);
assert.ok(inventoryPath&&out&&!existsSync(out));
const root='https://bsb-audio.bearcave.win/releases/20261124-69a6fb46/';
const inventoryBytes=readFileSync(inventoryPath),inventory=JSON.parse(inventoryBytes);
const sha=x=>createHash('sha256').update(x).digest('hex');
const objects=new Map(inventory.objects.map(x=>[x.key,x]));
assert.equal(objects.size,inventory.objects.length);
async function metadata(key){
 const response=await fetch(root+key);assert.ok(response.ok);
 const b=Buffer.from(await response.arrayBuffer());assert.equal(sha(b),objects.get(key)?.sha256);
 return JSON.parse(b);
}
const catalog=await metadata('catalog.json');
assert.equal(catalog.tracks.length,33);
const risk=['candy-cane-canyon','garbage-dump-glacier','vertigo-vents','crystal-cavern','bitstream-bluffs'];
const hot=new Map([[1,'vertigo-vents'],[4,'candy-cane-canyon'],[25,'garbage-dump-glacier'],[26,'vertigo-vents'],[31,'vertigo-vents']]);
const all=process.env.QA_ALL_33==='1';
const candidateKnee=Number(process.env.QA_KNEE??'.78');
const candidateCeiling=Number(process.env.QA_CEILING??'.88');
assert.ok(Number.isFinite(candidateKnee)&&Number.isFinite(candidateCeiling)&&candidateKnee>=.6&&candidateCeiling<=.9&&candidateCeiling-candidateKnee>=.02);
const selected=process.env.QA_ONLY_INDICES?.split(',').map(Number);
if(selected)assert.ok(selected.length>0&&selected.every(i=>Number.isInteger(i)&&i>=0&&i<33)&&new Set(selected).size===selected.length);
const allCases=all?Array.from({length:33},(_,i)=>[i,hot.get(i)||risk[i%risk.length]]):[...hot];
const cases=selected?allCases.filter(([i])=>selected.includes(i)):allCases;
assert.equal(cases.length,selected?selected.length:all?33:5);
assert.equal(new Set(cases.map(c=>c[0])).size,cases.length);
const result={format:'bsb-r2-offline-paired-crossfade-v1',candidateSpec:{knee:candidateKnee,ceiling:candidateCeiling},coverage:selected?'selected-transitions':all?'all-33-transitions':'five-hot-transitions',inventorySha256:sha(inventoryBytes),cases:[],errors:[],status:'INVALID_INCOMPLETE'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 page.on('pageerror',e=>result.errors.push(String(e)));
 page.on('response',r=>{if(r.status()>=400)result.errors.push('HTTP '+r.status()+' '+r.url());});
 await page.goto('http://127.0.0.1:18244/tools/music/qa-mixed-final-output.html');
 await page.waitForFunction(()=>window.__mixedFinalAudioQA?.renderPairedCrossfade);
 for(const [index,biome] of cases){
  const from=catalog.tracks[index],to=catalog.tracks[(index+1)%33];
  const [a,b]=await Promise.all([metadata(from.manifest),metadata(to.manifest)]);
  const r=await page.evaluate(args=>window.__mixedFinalAudioQA.renderPairedCrossfade(args),{from,to,biome,candidateKnee,candidateCeiling});
  assert.equal(r.from,from.id);assert.equal(r.to,to.id);assert.equal(r.biome,biome);
  assert.deepEqual(r.candidateSpec,result.candidateSpec);
  assert.ok(Math.abs(r.plan.duration-2.8)<1e-8);assert.equal(r.plan.beatAligned,false);
  const roles=['drums','bass','guitar','piano','other','vocals','voice:'+biome];
  let checked=0;
  for(const [track,m,lo,hi] of [[from,a,a.frameCount-182400,a.frameCount],[to,b,0,182400]]){
   let cursor=lo;
   for(const receipt of r.receipts.filter(x=>x.id===track.id)){
    const seg=m.segments[receipt.segment];assert.equal(receipt.manifestUrl,root+track.manifest);
    assert.equal(receipt.first,cursor);assert.equal(receipt.first,Math.max(lo,seg.startFrame));
    assert.equal(receipt.last,Math.min(hi,seg.startFrame+seg.frames));cursor=receipt.last;
    assert.deepEqual(Object.keys(receipt.hashes).sort(),[...roles].sort());
    for(const role of roles){const key=track.manifest.slice(0,-9)+seg.sources[role];assert.equal(receipt.hashes[role],objects.get(key)?.sha256);checked++;}
   }
   assert.equal(cursor,hi);
  }
  result.cases.push({...r,index,verifiedSourceHashes:checked});
  assertMixedQaMetrics(r.baseline);assertMixedQaMetrics(r.candidate);
  console.log('OFFLINE_PAIRED',JSON.stringify({index,biome,baseline:r.baseline.estimatedTruePeakDbTp4x,candidate:r.candidate.estimatedTruePeakDbTp4x,rmsDeltaDb:r.rmsDeltaDb,checked}));
 }
 assert.deepEqual(result.errors,[]);
 assert.equal(result.cases.length,cases.length);
 assert.ok(result.cases.every(c=>c.baseline.estimatedTruePeakDbTp4x<0&&c.candidate.estimatedTruePeakDbTp4x<0));
 result.status='PASS_OFFLINE_PAIRED_SAMPLED_NOT_MASTERED';
}catch(e){result.error=String(e);console.error(e);process.exitCode=1;}
finally{await browser.close();writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
