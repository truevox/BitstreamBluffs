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
const cases=[[1,'vertigo-vents'],[4,'candy-cane-canyon'],[25,'garbage-dump-glacier'],[26,'vertigo-vents'],[31,'vertigo-vents']];
const result={format:'bsb-r2-offline-paired-crossfade-v1',inventorySha256:sha(inventoryBytes),cases:[],errors:[],status:'INVALID_INCOMPLETE'};
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
  const r=await page.evaluate(args=>window.__mixedFinalAudioQA.renderPairedCrossfade(args),{from,to,biome});
  assert.equal(r.from,from.id);assert.equal(r.to,to.id);assert.equal(r.biome,biome);
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
 assert.deepEqual(result.errors,[]);result.status='PASS_OFFLINE_PAIRED_SAMPLED_NOT_MASTERED';
}catch(e){result.error=String(e);console.error(e);process.exitCode=1;}
finally{await browser.close();writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
