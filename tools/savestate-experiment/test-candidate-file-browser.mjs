/** Entire candidate goes through one canonical file. No raw diagnostic graph
 * leaves the source context, and the candidate receives no run input prefix
 * except the native recorder section (no simulation during reconstruction).
 * This is internal QA, not a registered production save or player action.
 */
import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
let vite,browser,scratch;
const errors=[],time=Date.UTC(2026,0,5,12);
try{
 scratch=await mkdtemp(join(tmpdir(),'bb-candidate-file-'));
 vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true,watch:null,hmr:false}});
 await vite.listen();
 const url='http://127.0.0.1:'+vite.httpServer.address().port+'/';
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
  headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 async function newContext(){
  const context=await browser.newContext({viewport:{width:960,height:540},serviceWorkers:'block'});
  // QA runs must not send synthetic playtest telemetry or any other external requests.
  await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
  return context;
 }
 async function boot(ms,shared){
  const context=shared||await newContext(),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date(ms));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
   typeof window.__bbGame.registry.get('currentBuildId')==='string',null,{timeout:60000});
  await page.evaluate(async()=>{
   const {createCandidateStateCodec}=await import('/src/systems/savestate/candidateState.js');
   const {createNativeRunSceneRestoreKit}=await import('/src/systems/savestate/RunSceneRestoreKit.js');
   const {captureCausalState}=await import('/src/systems/replay/fingerprintCapture.js');
   const {fingerprintState}=await import('/src/systems/replay/fingerprint.js');
   const {canonicalBytes,parseCanonical}=await import('/src/systems/replay/canonicalJson.js');
   const {digestOf}=await import('/src/systems/replay/canonicalSha256.js');
   const g=window.__bbGame,r=g.scene.getScene('RunScene');
   g.loop.sleep();g.scene.getScene('TitleScene').startRun('sim-05@0');
   g.scene.stop('TitleScene');g.scene.start('RunScene');g.headlessStep(0,0);
   if(!r.sys.isActive()||r.simClock.tick!==0||!r.ghostRecorder||r.tapePlayer||r.unrankedPractice||
    r.appliedBoosts.length||r.upgradeRun.enabled||r.magnetsDrop||r.kodiaksOn)throw Error('not stock run');
   r.inputRouter.poll=()=>({push:false,tilt:0,heli:0,tuck:false,hop:false,pressed:{}});
   const codec=createCandidateStateCodec(window.Phaser),kit=createNativeRunSceneRestoreKit(window.Phaser);
   const fp=()=>fingerprintState(captureCausalState(r)),encode=x=>new TextEncoder().encode(x);
   const signature=()=>JSON.stringify({fp:fp(),runId:r.runId,tick:r.simClock.tick,rec:r.ghostRecorder.lastTick});
   window.__candidate={g,r,codec,kit,fp,signature,t:0,
    capture(){return new TextDecoder().decode(codec.capture(r));},
    stepTo(n){const out=[];while(r.simClock.tick<n&&!r.crashed){this.t+=1000/120;g.headlessStep(this.t,1000/120);out.push([r.simClock.tick,fp().combined]);}return out;},
    negative(wire){
     const before=signature(),controls={
      checksum:f=>{f.tick++;return false;},
      build:f=>f.buildId='sha256:'+'b'.repeat(64),
      seed:f=>f.seed='other',
      missingSection:f=>delete f.sections.remainder,
      wrongClock:f=>f.sections.clock.tick++,
      wrongRng:f=>f.sections.rng.streams.physicsScramble.baseSeed^=1,
      missingPrefix:f=>f.sections.recorder.recorder.inputs.shift(),
      foreignTerrain:f=>f.sections.terrain.boundsDigest='sha256:'+'c'.repeat(64),
      foreignConfig:f=>f.sections.remainder.configDigest='sha256:'+'d'.repeat(64),
      badTimer:f=>f.sections.remainder.state.slowMs='f64:fff0000000000000',
      wrongBody:f=>f.sections.entities.state.sled.fields.body='hazard:1:0',
      wrongNode:f=>f.sections.entities.state.sled.id=f.sections.subsystems.state.score.id,
     };
     return Object.entries(controls).map(([name,change])=>{
      const f=parseCanonical(encode(wire)),reseal=change(f)!==false;
      if(reseal){delete f.integrity;f.integrity=digestOf(f);}
      let error;try{codec.prepare(r,canonicalBytes(f));}catch(e){error=String(e.message);}
      if(!error||signature()!==before)throw Error('failed candidate refusal '+name);
      return {name,error};
     });
    },
    restore(wire,frameTime,late=false){
     if(r.simClock.tick!==0)throw Error('candidate already advanced');
     const before=signature(),snap=codec.prepare(r,encode(wire));
     if(signature()!==before)throw Error('prepare mutated fresh scene');
     if(late)snap.fingerprint.combined='xxh32x2:0000000000000000';
     const proto=Object.getPrototypeOf(r),sim=proto.simTick;let calls=0;
     proto.simTick=function(){calls++;throw Error('simulation during restoration');};
     try{kit.restore(r,snap);}finally{proto.simTick=sim;}
     this.t=frameTime;
     if(r.sled.random!==r.runRandom||r.hints.done!==r.tutDone)throw Error('alias lost');
     const exact=this.capture()===wire;
     if(!exact)throw Error('complete candidate recapture bytes differ');
     return {tick:r.simClock.tick,calls,exact,fp:fp(),runId:r.runId};
    },
    terminal(){
     const recorder=r.ghostRecorder,frames=this.stepTo(2500),record=g.registry.get('lastRecord'),tape=g.registry.get('lastGhostTape');
     if(!r.crashed||record?.id!==r.runId||tape?.runId!==r.runId)throw Error('native terminal missing');
     return {frames,tick:r.simClock.tick,record,tape,fp:fp(),fingerprints:recorder.fingerprints,
      fingerprintErrors:recorder.fingerprintErrorCount};
    }
   };
  });
  return {context,page};
 }
 if(process.argv.includes('--suspend-slot')){
  const context=await newContext(),tick=936;
  try{
   const a=await boot(time,context);
   const source=await a.page.evaluate(async tick=>{
    const p=window.__candidate;
    const {LocalSuspendSlot}=await import('/src/systems/savestate/localSuspendSlot.js');
    const {createCandidateLayoutRegistration,sealSuspendCandidate}=await import('/src/systems/savestate/candidateAdmission.js');
    const {loadCurrentBuildDescriptor}=await import('/src/systems/savestate/runtimeIdentity.js');
    const identity=await loadCurrentBuildDescriptor(),layout=createCandidateLayoutRegistration(window.Phaser.Physics.Matter.Matter);
    p.stepTo(tick);
    const file=p.codec.capture(p.r),envelope=sealSuspendCandidate(file,identity,layout);
    const saved=await new LocalSuspendSlot().put(envelope,identity,layout);
    if(!saved.ok)throw Error('actual save admission '+JSON.stringify(saved));
    return {saved,frameTime:p.t,signature:p.signature(),runId:p.r.runId};
   },tick);
   assert.equal(source.saved.tick,tick);
   async function resume(page,fail){
    return page.evaluate(async({frameTime,fail})=>{
     const p=window.__candidate;
     const {LocalSuspendSlot}=await import('/src/systems/savestate/localSuspendSlot.js');
     const {createCandidateLayoutRegistration}=await import('/src/systems/savestate/candidateAdmission.js');
     const {loadCurrentBuildDescriptor}=await import('/src/systems/savestate/runtimeIdentity.js');
     const {resumeLocalSuspend}=await import('/src/systems/savestate/suspendTransaction.js');
     const identity=await loadCurrentBuildDescriptor(),layout=createCandidateLayoutRegistration(window.Phaser.Physics.Matter.Matter);
     const slot=new LocalSuspendSlot(),consume=slot.consume.bind(slot);
     let staged=0,published=false,discarded=false,durable=false,restoreTicks=null;
     slot.consume=async token=>{const result=await consume(token);durable=result.ok&&result.consumed;return result;};
     const result=await resumeLocalSuspend({slot,identity,layout,createStage:meta=>{
      staged++;
      if(meta.tick!==936||meta.seed!=='sim-05')throw Error('claim setup');
      return {
       isQuarantined:()=>!published&&!discarded&&!p.g.loop.running,
       restore:file=>{const r=p.restore(new TextDecoder().decode(file),frameTime,fail);restoreTicks=r.calls;},
       capture:()=>p.codec.capture(p.r),
       discard:()=>{
        // Each tab has its own game/JS/Matter realm. Stop the isolated run
        // permanently; do not leave a partially restored scene callable.
        p.g.scene.stop('RunScene');p.g.headlessStep(0,0);p.g.loop.sleep();
        discarded=!p.r.sys.isActive()&&!published;
        if(discarded)p.stepTo=()=>{throw Error('discarded');};
        return discarded;
       },
       publish:()=>{if(!durable||published||discarded)throw Error('premature publish');published=true;return true;},
      };
     }});
     return {result,staged,published,discarded,durable,restoreTicks,tick:p.r.simClock?.tick};
    },{frameTime:source.frameTime,fail});
   }
   const b=await boot(time+1000,context);
   const failed=await resume(b.page,true);
   assert.equal(failed.result.claimState,'released',JSON.stringify(failed));
   assert.equal(failed.discarded,true);assert.equal(failed.published,false);
   assert.equal(await a.page.evaluate(()=>window.__candidate.signature()),source.signature);
   await b.page.close();
   const c=await boot(time+2000,context),d=await boot(time+3000,context);
   const results=await Promise.all([resume(c.page,false),resume(d.page,false)]);
   assert.equal(results.filter(x=>x.result.ok).length,1,JSON.stringify(results));
   assert.equal(results.reduce((n,x)=>n+x.staged,0),1);
   const index=results.findIndex(x=>x.result.ok),winner=[c,d][index],loser=[c,d][1-index];
   const won=results[index];assert.equal(won.published,true);assert.equal(won.durable,true);
   assert.equal(won.restoreTicks,0);assert.equal(won.tick,tick);
   assert.equal(won.result.runId,source.runId);
   assert.equal(results[1-index].published,false);
   assert.match(results[1-index].result.code,/slot-claimed|empty/);
   const empty=await loser.page.evaluate(async()=>{
    const {LocalSuspendSlot}=await import('/src/systems/savestate/localSuspendSlot.js');
    return new LocalSuspendSlot().claim(null,null);
   });
   assert.equal(empty.code,'empty');
   assert.equal(await a.page.evaluate(()=>window.__candidate.signature()),source.signature);
   await winner.page.clock.setFixedTime(new Date(time));
   const terminal=p=>p.evaluate(()=>window.__candidate.terminal());
   const left=await terminal(a.page),right=await terminal(winner.page);
   assert.deepEqual(right,left);assert.deepEqual(errors,[]);
   console.log('PASS_REAL_SUSPEND_TRANSACTION',JSON.stringify({tick,envelopeBytes:source.saved.bytes,
    failed,results,empty:empty.code,sourceUnchangedBeforePublish:true,suffixTicks:left.frames.length,
    terminalTick:left.tick,exactTerminal:true,errors}));
  }finally{await context.close();}
 }else for(const tick of [481,936]){
  const a=await boot(time),b=await boot(time+1000);
  try{
   const cap=await a.page.evaluate(tick=>{
    const p=window.__candidate;p.stepTo(tick);
    if(p.r.simClock.tick!==tick||p.r.crashed)throw Error('capture boundary');
    return {wire:p.capture(),frameTime:p.t,fp:p.fp(),runId:p.r.runId};
   },tick);
   const path=join(scratch,'candidate-'+tick+'.bbcandidate');
   await writeFile(path,cap.wire,{flag:'wx'});const wire=await readFile(path,'utf8');
   const negatives=await b.page.evaluate(w=>window.__candidate.negative(w),wire);
   if(tick===481){
    const c=await boot(time+2000);
    try{
     const err=await c.page.evaluate(({wire,frameTime})=>{
      try{window.__candidate.restore(wire,frameTime,true);return null;}catch(e){return String(e.message);}
     },{wire,frameTime:cap.frameTime});
     assert.equal(err,'native restore: reconstructed world mismatch; discard candidate');
    }finally{await c.context.close();}
   }
   const result=await b.page.evaluate(({wire,frameTime})=>window.__candidate.restore(wire,frameTime),{wire,frameTime:cap.frameTime});
   assert.equal(result.tick,tick);assert.equal(result.calls,0);assert.equal(result.exact,true);
   assert.deepEqual(result.fp,cap.fp);assert.equal(result.runId,cap.runId);
   await b.page.clock.setFixedTime(new Date(time));
   const terminal=page=>page.evaluate(()=>window.__candidate.terminal());
   const left=await terminal(a.page),right=await terminal(b.page);
   assert.deepEqual(right,left);assert.equal(left.fingerprintErrors,0);assert.deepEqual(errors,[]);
   console.log('PASS_COMPLETE_CANDIDATE_FILE',JSON.stringify({tick,bytes:Buffer.byteLength(wire),
    exactWholeFileRecapture:result.exact,restoreSimTicks:result.calls,negativeControls:negatives,
    suffixTicks:left.frames.length,terminalTick:left.tick,tapeEndTick:left.tape.endTick,score:left.record.score,
    exactNativeTape:true,exactNativeRecord:true,errors}));
  }finally{await a.context.close();await b.context.close();}
 }
}finally{await browser?.close();await vite?.close();if(scratch)await rm(scratch,{recursive:true,force:true});}
