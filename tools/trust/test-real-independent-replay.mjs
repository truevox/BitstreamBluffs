/**
 * #135 private compiled-game replay experiment. Not an authenticated issuer:
 * the fixture is explicitly scripted, and no public or human verdict is made.
 * The independent page receives ONLY canonical evidence bytes-derived data.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {boot,recordRun,freshPage,closeHarness} from '../test-takeover-browser.mjs';
import {validateEvidenceBundle} from '../../src/systems/replay/manifest.js';
import {canonicalBytes} from '../../src/systems/replay/canonicalJson.js';

import {exerciseBoundAdmission} from './boundAdmissionFixture.mjs';
import {prepareReplayEvidence,compareReplayObservation} from '../../server/trust/replayEvidence.mjs';

const current=JSON.parse(readFileSync(new URL('../../tools/ruleset/current.json',import.meta.url),'utf8'));
const ruleset=JSON.parse(readFileSync(new URL('../../'+current.archivePath,import.meta.url),'utf8'));
const resolver=id=>id===current.rulesetId?ruleset:null;
export async function replay(bytes){
 const p=prepareReplayEvidence(bytes,{rulesetId:current.rulesetId,ruleset});if(!p.ok)return p;
 const V=await freshPage();
 try{
  const actual=await V.page.evaluate(({tape,expected})=>{
   const tk=window.__tk;
   tk.startRun(tape.seed);tk.R=tk.run().ghostRecorder.constructor;
   tk.g.scene.stop('RunScene');tk.g.registry.set('ghostReplay',tape);
   tk.g.scene.start('RunScene');tk.g.headlessStep(0,0);
   const r=tk.run(),head=r._ghostHeader();
   const f64=n=>{const d=new DataView(new ArrayBuffer(8));d.setFloat64(0,n);return 'f64:'+d.getBigUint64(0).toString(16).padStart(16,'0');};
   const start={pose:head.startPose.map(f64),rng:head.random.physicsScramble,initial:[head.bsod.leftEdgeX,head.bsod.initial.wallX,head.bsod.initial.wallSpeedPxS,head.bsod.initial.accelerationPxS2].map(f64)};
   const points=[];
   for(const [tick] of expected.checkpoints){
    const seek=r.seekTo(tick,{maxTicks:Infinity,stopOnCrash:true});
    if(seek.desync||seek.crashed||!seek.done)return {start,points,seek};
    points.push([tick,tk.fp(r).replace(/^xxh32x2:/,'')]);
   }
   // v1 GhostRecorder.lastTick is last completed nonfatal tick. The actual
   // fatal tick is endTick+1; reproduce it, not an arbitrary recording cutoff.
   const seek=r.seekTo(expected.endTick+1,{maxTicks:Infinity,stopOnCrash:true});
   const snap=r.score.getSnapshot();
   return {start,points,seek,score:Math.max(0,Math.round(snap.total)),distanceM:Math.floor(snap.distanceM),
      checked:r.tapePlayer.checked};
  },{tape:p.tape,expected:p.expected});
  assert.deepEqual(V.errors,[]);
  return compareReplayObservation(p.expected,actual);
 }finally{await V.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
try{
 await boot();
 const {P,rec,info}=await recordRun({seed:'A',fixture:'hazard'});
 const stored=await P.page.evaluate(async()=>{
  const status=window.__bbGame.registry.get('lastEvidenceStatus');
  if(!status.ok||!status.durable)throw Error('no durable live evidence '+JSON.stringify(status));
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('bitstream-replay-evidence');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{
    const row=await new Promise((resolve,reject)=>{const r=db.transaction('bundles','readonly').objectStore('bundles').get(status.digest);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return Array.from(row.bytes);
  }finally{db.close();}
 });
 await P.close();
 const bytes=Uint8Array.from(stored);
 if(process.env.BSB_PRIVATE_PEER_FIXTURE_PATH)writeFileSync(process.env.BSB_PRIVATE_PEER_FIXTURE_PATH,bytes);
 const checked=validateEvidenceBundle(bytes,resolver);
 assert.equal(checked.ok,true);
 console.log('SOURCE',JSON.stringify({actualCrashTick:rec.ticks,recordedEndTick:info.tape.endTick,score:info.tape.score,distance:info.tape.distanceM,claim:checked.bundle.claims,checkpoints:checked.bundle.checkpoints.length}));
 const positive=await replay(bytes);
 console.log('REAL_REPLAY',JSON.stringify(positive));
 if(process.env.BSB_PRIVATE_PEER_FIXTURE_PATH)writeFileSync(process.env.BSB_PRIVATE_PEER_FIXTURE_PATH.replace(/-evidence\.json$/,'-observation.json'),canonicalBytes(positive.actual));
 assert.equal(positive.ok,true);
 const forged=structuredClone(checked.bundle);forged.claims.score++;
 const denied=await replay(canonicalBytes(forged));
 console.log('FORGED_SCORE',JSON.stringify({ok:denied.ok,reason:denied.reason,observed:denied.actual?.score}));
 assert.equal(denied.ok,false);assert.equal(denied.reason,'divergence');
 const missing=structuredClone(checked.bundle);missing.checkpoints.pop();
 assert.equal((await replay(canonicalBytes(missing))).reason,'incomplete-checkpoints');
 const badFp=structuredClone(checked.bundle);badFp.checkpoints[0][1]='0'.repeat(16);
 assert.equal((await replay(canonicalBytes(badFp))).reason,'divergence');
 const badInput=structuredClone(checked.bundle);badInput.inputs[0][1]^=1;
 assert.equal((await replay(canonicalBytes(badInput))).reason,'invalid-evidence');
 console.log('PASS_REAL_REPLAY_NEGATIVES');
 exerciseBoundAdmission(bytes,{rulesetId:current.rulesetId,ruleset},info.tape.buildId);
}finally{await closeHarness();}
}
