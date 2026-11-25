/** #244 QA only: fresh live RunScene/Matter/Recorder envelopes from the CURRENT build.
 * Production causal modules are real; only Phaser rendering/DOM are inert.
 * Optional output is local-only for an independent real-Chromium IDB consumer.
 */
import fs from 'node:fs';
import {jest} from '@jest/globals';
const {installPhaserStub,createRun,stepRun}=await import('./headlessRun.js');
const {Phaser}=installPhaserStub(jest);
Phaser.VERSION='3.90.0';
const {RunScene}=await import('../../src/scenes/RunScene.js');
const {REG}=await import('../../src/constants.js');
const {buildRunEvidence,EVIDENCE_STATUS_KEY,EVIDENCE_STATUS_BY_RUN_KEY,EVIDENCE_ACTIVE_RUN_KEY}=await import('../../src/systems/replay/evidenceCapture.js');
const {bundleBytes,validateEvidenceBundle,bundleDigest}=await import('../../src/systems/replay/manifest.js');
const CURRENT=JSON.parse(fs.readFileSync('tools/ruleset/current.json','utf8'));
const RULESET={rulesetId:CURRENT.rulesetId,doc:JSON.parse(fs.readFileSync(CURRENT.archivePath,'utf8'))};
// Non-Daily runs still select rotating daily course physics at create().
// Freeze DATE ONLY so the SAME exact checkout stays byte-identical tomorrow;
// deferred evidence scheduling, promises, performance and rendering stay real.
const QA_DATE=Date.UTC(2026,10,25,12,0,0);
const UNFAKED=['hrtime','nextTick','performance','queueMicrotask','requestAnimationFrame',
 'cancelAnimationFrame','requestIdleCallback','cancelIdleCallback','setImmediate',
 'clearImmediate','setInterval','clearInterval','setTimeout','clearTimeout'];
beforeAll(()=>jest.useFakeTimers({now:QA_DATE,doNotFake:UNFAKED}));
afterAll(()=>jest.useRealTimers());
const waitStatus=async(registry,runId)=>{
 for(let i=0;i<150;i++){
  const byRun=registry.get(EVIDENCE_STATUS_BY_RUN_KEY);
  const state=byRun instanceof Map?byRun.get(runId):null;
  if(state)return state;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 throw new Error(`native evidence status for ${runId} never published`);
};
const casePlan=Array.from({length:12},(_,i)=>({
 seed:`FRESH244-${String(i+1).padStart(2,'0')}`,ticks:[600,1200,1800][i%3],level:i%2?8:1,
 upgraded:i%2===1,
 pattern:i%4,
}));
const padAt=(t,pattern)=>({
 push:t<500 || (pattern>1 && t%37<23),
 tilt: pattern===0 ? 0 : pattern===1 ? ((t%240)<50?0.2:0) : (t%151<67?0.25:-0.2),
 tuck:pattern>=2&&t%120>100,
 noAutoNudge:true,
 variableHop:true,
 hop:pattern>=1 && t%177===0,
 pressed:{hop:pattern>=1 && t%177===0},
});

test('fresh SIM9 live-run corpus creates valid complete current-build envelopes without capture omissions',async()=>{
 const output=[];
 for(const item of casePlan){
  const scene=createRun(RunScene,REG,{seed:item.seed,level:item.level,settings:{kodiakPacks:'mixed'},
   profile:item.upgraded?{upgradesEnabled:true,upgrades:{speed:1,hop:1,canopy:1}}:{}});
  scene.registry.set('currentRuleset',RULESET);
  const recorder=scene.ghostRecorder;
  expect(recorder).toBeTruthy();
  expect(scene.upgradeRun.enabled).toBe(item.upgraded);
  let terminalCause=null;
  const nativeDoCrash=scene.doCrash.bind(scene);
  scene.doCrash=(cause,...rest)=>{terminalCause=cause.cause;return nativeDoCrash(cause,...rest);};
  stepRun(scene,item.ticks,t=>padAt(t,item.pattern));
  const wasNaturalCrash=!!scene.crashed;
  if(!wasNaturalCrash){
    // Explicitly cause an actual fatal BSOD collision; never fabricate a
    // successful game-over outcome for an arbitrary recording cutoff.
    scene.bsod.wallX=scene.sled.body.bounds.min.x-2;
    scene.bsod.wallSpeedPxS=10000;
    stepRun(scene,12,t=>padAt(t,item.pattern));
  }
  expect(scene.crashed).toBe(true);
  expect(terminalCause).toBeTruthy();
  if(!wasNaturalCrash)expect(terminalCause).toBe('bsod');
  const ticks=recorder.lastTick;
  expect(ticks).toBeGreaterThanOrEqual(120);
  const expectedTicks=Array.from({length:Math.floor(ticks/120)},(_,i)=>(i+1)*120);
  // Consume the ACTUAL production doCrash -> _saveGhostTape -> GhostRecorder.finish,
  // not a synthesized "crash" record from a test-only tape constructor.
  const tape=scene.registry.get(REG.LAST_GHOST_TAPE);
  const record=scene.registry.get(REG.LAST_RECORD);
  expect(tape).toBeTruthy();
  expect(record?.cause).toBe('crash');
  expect(scene.ghostRecorder).toBeNull();
  const runId=tape.runId;
  expect(runId).toBe(record.id);
  expect(tape.endTick).toBe(ticks);
  expect(tape.checkpoints.map(row=>row[0])).toEqual(expectedTicks);
  expect(recorder.fingerprints.map(row=>row.tick)).toEqual(expectedTicks);
  expect(tape.upgradeRanks).toEqual(item.upgraded?{speed:1,hop:1,canopy:1}:null);
  const built=buildRunEvidence({tape,recorder,ruleset:RULESET});
  const bytes=bundleBytes(built.bundle);
  const check=validateEvidenceBundle(bytes,id=>id===RULESET.rulesetId?RULESET.doc:null);
  if(!check.ok)console.log('FRESH_INVALID',JSON.stringify({seed:item.seed,ticks,code:check.code,pointer:check.pointer,detail:check.detail,reasons:check.reasons,sceneCrashed:scene.crashed}));
  expect({ok:check.ok,outcome:check.outcome,detail:built.detail,errorCount:built.errorCount})
    .toEqual({ok:true,outcome:'valid',detail:'combined',errorCount:0});
  expect(tape.endTick).toBe(ticks);
  expect(built.bundle.manifest.causal.loadout.upgradeRanks).toEqual(item.upgraded?{speed:1,hop:1,canopy:1}:{});
  expect(built.bundle.checkpoints.map(row=>row[0])).toEqual(expectedTicks);
  expect(bytes.length).toBeGreaterThan(2000);
  // Native doCrash must actually call the production deferred evidence saver,
  // not merely publish a tape that this test happens to repackage itself.
  expect(scene.registry.get(EVIDENCE_ACTIVE_RUN_KEY)).toBe(runId);
  const nativeStatus=await waitStatus(scene.registry,runId);
  expect(nativeStatus).toMatchObject({ok:true,outcome:'valid',detail:'combined',
   digest:bundleDigest(bytes),runId});
  expect(scene.registry.get(EVIDENCE_STATUS_KEY)?.digest).toBe(nativeStatus.digest);
  output.push({seed:item.seed,runId,ticks,targetTicks:item.ticks,crashed:!!scene.crashed,
    level:item.level,pattern:item.pattern,upgraded:item.upgraded,terminalCause,naturalCrash:wasNaturalCrash,inputRows:tape.inputs.length,checkpoints:tape.checkpoints.length,
    bytes:bytes.length,digest:bundleDigest(bytes),base64:Buffer.from(bytes).toString('base64')});
 }
 expect(new Set(output.map(r=>r.digest)).size).toBe(casePlan.length);
 const lengths=output.map(r=>r.bytes).sort((a,b)=>a-b);
 console.log('FRESH_SIM9_CORPUS',JSON.stringify({count:output.length,ticks:output.map(r=>r.ticks),
  uniqueDigests:new Set(output.map(r=>r.digest)).size,totalBytes:lengths.reduce((a,b)=>a+b,0),
  minBytes:lengths[0],medianBytes:lengths[Math.floor(lengths.length/2)],maxBytes:lengths.at(-1),
  crashed:output.filter(r=>r.crashed).length,upgraded:output.filter(r=>r.upgraded).length,naturalCrashCount:output.filter(r=>r.naturalCrash).length,inputRows:output.map(r=>r.inputRows)}));
 if(process.env.BSB244_FRESH_CORPUS_OUT){
  fs.writeFileSync(process.env.BSB244_FRESH_CORPUS_OUT,JSON.stringify({
    format:'bb-qa-fresh-current-corpus',rulesetId:RULESET.rulesetId,rows:output}));
 }
},120000);
