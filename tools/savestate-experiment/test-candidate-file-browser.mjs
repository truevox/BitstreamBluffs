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
const pausedCapture=process.argv.includes('--paused-capture');
const reopenProof=process.argv.includes('--suspend-reopen');
const sceneRoundtrip=process.argv.includes('--scene-roundtrip');
const ownedStage=process.argv.includes('--owned-stage');
const suspendEnvelope=process.argv.includes('--suspend-envelope')||reopenProof;
try{
 scratch=await mkdtemp(join(tmpdir(),'bb-candidate-file-'));
 vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true,watch:null,hmr:false}});
 await vite.listen();
 const url='http://127.0.0.1:'+vite.httpServer.address().port+'/';
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
  headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 async function boot(ms,existingContext=null){
  const context=existingContext||await browser.newContext({viewport:{width:960,height:540}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date(ms));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
   typeof window.__bbGame.registry.get('currentBuildId')==='string',null,{timeout:60000});
  await page.evaluate(async()=>{
   const {createCandidateStateCodec}=await import('/src/systems/savestate/candidateState.js');
   const {captureManualPauseCandidate}=await import('/src/systems/savestate/pausedCandidate.js');
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
    capturePaused(){return new TextDecoder().decode(captureManualPauseCandidate(r,window.Phaser));},
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
 for(const tick of [481,936]){
  const a=await boot(time),b=await boot(time+1000);
  try{
   const cap=await a.page.evaluate(({tick,pausedCapture})=>{
    const p=window.__candidate;p.stepTo(tick);
    if(p.r.simClock.tick!==tick||p.r.crashed)throw Error('capture boundary');
    if(pausedCapture){
     p.r.pauseRun();
     // Phaser queues scene pause/launch until its next game step; advance
     // the scene manager with zero delta, never the causal 120 Hz clock.
     p.g.headlessStep(p.t,0);
     if(!p.r.scene.isPaused('RunScene')||!p.r._manualPausePending)
      throw Error('actual native pause not established '+JSON.stringify({pending:p.r._manualPausePending,
       status:p.r.sys?.settings?.status,scenePaused:p.r.scene.isPaused('RunScene'),
       pauseActive:p.g.scene.isActive('PauseScene'),pausePending:p.g.scene.isSleeping('PauseScene')}));
    }
    const captured=pausedCapture?p.capturePaused():p.capture();
    if(pausedCapture&&p.r._manualPausePending!==true)throw Error('pause source flag changed by capture');
    return {wire:captured,frameTime:p.t,fp:p.fp(),runId:p.r.runId,
      pending:p.r._manualPausePending,paused:p.r.scene.isPaused('RunScene')};
   },{tick,pausedCapture});
   if(pausedCapture){
    // Source resumes its original manual pause without advancing a sim tick.
    const resumed=await a.page.evaluate(()=>{
     const p=window.__candidate,r=p.r,ps=r.scene.get('PauseScene');
     ps._doResume();
     p.g.headlessStep(p.t,0);
     return {pending:r._manualPausePending,paused:r.scene.isPaused('RunScene')};
    });
    if(resumed.pending||resumed.paused)throw Error('source manual resume did not clear pause state');
   }
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
   if(sceneRoundtrip){
    // A separately tested, research-only Phaser SceneManager roundtrip:
    // leave the original active RunScene, make Title active, then stage a NEW
    // tick-zero RunScene while Title remains active, restore and consume before
    // publishing the continuation. No player menu is connected.
    const titlePhase=await a.page.evaluate(async raw=>{
     const p=window.__candidate,g=p.g;
     const [{candidateSuspendEnvelopeBytes,candidateSuspendLayout},
      {loadCurrentBuildDescriptor},{LocalSuspendSlot}]=await Promise.all([
      import('/src/systems/savestate/candidateSuspendEnvelope.js'),
      import('/src/systems/savestate/runtimeIdentity.js'),
      import('/src/systems/savestate/localSuspendSlot.js')]);
     const identity=await loadCurrentBuildDescriptor(),slot=new LocalSuspendSlot();
     const saved=await slot.put(candidateSuspendEnvelopeBytes(new TextEncoder().encode(raw),identity),
      identity,candidateSuspendLayout);
     if(!saved.ok)throw Error('same-scene suspend failed '+JSON.stringify(saved));
     const oldTick=p.r.simClock.tick;
     g.scene.stop('PauseScene');g.scene.stop('UIScene');g.scene.stop('RunScene');
     g.scene.start('TitleScene');g.headlessStep(p.t,0);
     const active={title:g.scene.isActive('TitleScene'),run:g.scene.isActive('RunScene'),
      ui:g.scene.isActive('UIScene')};
     if(!active.title||active.run)throw Error('source scene failed to reach title '+JSON.stringify(active));
     return {oldTick,active,saved:saved.saved};
    },wire);
    assert.equal(titlePhase.oldTick,tick);
    assert.equal(titlePhase.saved,true);
    const roundtrip=await a.page.evaluate(async ({frameTime,expectedTick,ownedStage})=>{
     const p=window.__candidate,g=p.g;
     const [{inspectCandidateSuspendEnvelope,candidateSuspendLayout},
      {loadCurrentBuildDescriptor},{LocalSuspendSlot}]=await Promise.all([
      import('/src/systems/savestate/candidateSuspendEnvelope.js'),
      import('/src/systems/savestate/runtimeIdentity.js'),
      import('/src/systems/savestate/localSuspendSlot.js')]);
     const identity=await loadCurrentBuildDescriptor(),slot=new LocalSuspendSlot();
     const {EVT}=await import('/src/events.js');
     let startEvents=0;
     g.events.on(EVT.RUN_START,()=>{startEvents++;});
     const stageFresh=async()=>{
      if(ownedStage){
       // The actual RunScene.create private one-shot staging capability:
       // SceneManager invokes Systems.CREATE after create returns, and the
       // application code pauses/hides the scene before any sim update.
       const {armPrivateRunSceneStage}=await import('/src/systems/savestate/privateStageOwnership.js');
       const arm=armPrivateRunSceneStage(g);
       try{
        g.scene.start('RunScene');g.headlessStep(p.t,0);
        const dest=await arm.ready;
        if(dest!==p.r)throw Error('private scene stage returned wrong RunScene');
       }catch(e){arm.cancel();throw e;}
      }else{
       // Old control: a synchronous test-owned manual observer suppression.
       const restore=p.r._muteForSeek();
       try{g.scene.start('RunScene');g.headlessStep(p.t,0);}
       finally{restore();}
       g.scene.stop('UIScene');
       g.scene.pause('RunScene');
       p.r.sys.setVisible(false);
      }
      if(!g.scene.isActive('TitleScene')||!g.scene.isPaused('RunScene')||
       p.r.simClock.tick!==0||startEvents!==0)
       throw Error('staging published or advanced before validation '+JSON.stringify({
        tick:p.r.simClock.tick,startEvents,title:g.scene.isActive('TitleScene'),
        paused:g.scene.isPaused('RunScene')}));
     };
     let failedStagingDiscarded=false;
     if(expectedTick===481){
      // Deliberately fail AFTER the native restore mutates a disposable stage.
      // Title remains active; the partially restored Run/UIScene must be
      // destroyed BEFORE the exact holder releases its original one-use slot.
      const held=await slot.claim(identity,candidateSuspendLayout);
      if(!held.ok)throw Error('late-failure proof could not hold slot '+JSON.stringify(held));
      const admitted=inspectCandidateSuspendEnvelope(held.bytes,identity);
      if(!admitted.ok)throw Error('late-failure candidate admission');
      await stageFresh();
      let lateError=null;
      try{p.restore(new TextDecoder().decode(admitted.candidateBytes),frameTime,true);}
      catch(e){lateError=String(e.message);}
      if(lateError!=='native restore: reconstructed world mismatch; discard candidate')
       throw Error('late restore was not reliably refused '+lateError);
      g.scene.stop('UIScene');g.scene.stop('RunScene');
      if(!g.scene.isActive('TitleScene')||g.scene.isActive('RunScene'))
       throw Error('discarded scene remained player-visible');
      const released=await slot.release(held.token);
      if(!released.ok)throw Error('discarded scene could not release held slot '+released.code);
      const hint=await slot.peek(identity,candidateSuspendLayout);
      if(!hint.ok||hint.status!=='ready')throw Error('discard/retry lost ready slot');
      failedStagingDiscarded=true;
     }
     const claim=await slot.claim(identity,candidateSuspendLayout);
     if(!claim.ok)throw Error('same-scene claim failed '+JSON.stringify(claim));
     const prepared=inspectCandidateSuspendEnvelope(claim.bytes,identity);
     if(!prepared.ok||prepared.admission!=='envelope-only')throw Error('same-scene candidate rejected');
     const input=new TextDecoder().decode(prepared.candidateBytes);
     await stageFresh();
     const r=p.r,staging={title:g.scene.isActive('TitleScene'),
      paused:g.scene.isPaused('RunScene'),tick:r.simClock?.tick,startEvents};
     let exact;
     try{
      exact=p.restore(input,frameTime);
      if(!exact.exact||exact.calls!==0||exact.tick!==expectedTick)
       throw Error('staging native reconstruction diverged');
      const consumed=await slot.consume(claim.token);
      if(!consumed.ok)throw Error('staging cannot commit until single-use consume '+consumed.code);
      if(startEvents!==0||!g.scene.isActive('TitleScene')||!g.scene.isPaused('RunScene'))
       throw Error('precommit side effects escaped staging');
      // Commit only AFTER the immutable one-use slot was successfully
      // consumed: publish input/HUD/music observers once, not on staging.
      g.scene.stop('TitleScene');
      r.sys.setVisible(true);
      r.scene.launch('UIScene');
      g.scene.resume('RunScene');
      g.events.emit(EVT.RUN_START,{runId:r.runId,seed:r.seed,startedAt:r.startedAt,
       dailyOfficial:r.dailyOfficial,dailyMode:r.dailyMode,gym:r.bsodGym===true,
       practice:r.unrankedPractice===true,resumed:true});
      if(startEvents!==1)throw Error('commit did not publish exactly one run start');
      return {staging,tick:exact.tick,calls:exact.calls,visible:r.sys.settings.visible,
       titleAfter:g.scene.isActive('TitleScene'),runAfter:g.scene.isActive('RunScene'),
       startEvents,consumed:consumed.consumed,exact:exact.exact,fp:exact.fp,failedStagingDiscarded};
     }catch(e){
      g.scene.stop('UIScene');g.scene.stop('RunScene');
      // A late validation failure never publishes the partially restored Run.
      // Only the verified holder can release after the staging scene is gone.
      await slot.release(claim.token);
      throw e;
     }
    },{frameTime:cap.frameTime,expectedTick:tick,ownedStage});
    assert.equal(roundtrip.tick,tick);assert.equal(roundtrip.calls,0);
    assert.equal(roundtrip.titleAfter,false);assert.equal(roundtrip.runAfter,true);
    assert.equal(roundtrip.consumed,true);assert.deepEqual(roundtrip.fp,cap.fp);
    assert.equal(roundtrip.startEvents,1);
    assert.equal(roundtrip.staging.startEvents,0);
    assert.equal(roundtrip.staging.paused,true);
    assert.equal(roundtrip.failedStagingDiscarded,tick===481);
    console.log('PASS_ACTUAL_PHASER_SCENE_LIFECYCLE_ROUNDTRIP',
     JSON.stringify({tick,abandonedOldRun:true,titleEntered:true,
      stagedAtTickZero:true,preparedBeforeTitleStopped:true,zeroSimTicks:true,
      oneUseConsumedBeforeActivation:true,privateStagingCapability:ownedStage,startEventsBeforeCommit:0,
      startEventsAfterCommit:1,lateFailureRollbackRetried:tick===481,exact:true}));
   }
   // Optional #424 real IndexedDB format bridge. Claim now, but consume ONLY
   // after the same fresh native world restoration is observed successful.
   let resumeWire=wire;
   if(suspendEnvelope){
    const prepared=await b.page.evaluate(async raw=>{
     const [{candidateSuspendEnvelopeBytes,candidateSuspendLayout},
      {loadCurrentBuildDescriptor},{LocalSuspendSlot}]=await Promise.all([
      import('/src/systems/savestate/candidateSuspendEnvelope.js'),
      import('/src/systems/savestate/runtimeIdentity.js'),
      import('/src/systems/savestate/localSuspendSlot.js')]);
     const identity=await loadCurrentBuildDescriptor(),slot=new LocalSuspendSlot();
     if(identity.buildId!==window.__candidate.g.registry.get('currentBuildId'))
      throw Error('browser identity mismatch');
     const bytes=candidateSuspendEnvelopeBytes(new TextEncoder().encode(raw),identity);
     const stored=await slot.put(bytes,identity,candidateSuspendLayout);
     if(!stored.ok)throw Error('candidate slot write failed '+stored.code);
     return {saved:stored.saved,bytes:stored.bytes};
    },wire);
    assert.equal(prepared.saved,true);
    if(reopenProof){
     // Destroy the original page and create a new page in the SAME storage
     // partition. The new page has not received a candidate or claim token.
     await b.page.close();
     b.page=(await boot(time+1000,b.context)).page;
     assert.equal(await b.page.evaluate(()=>window.__candidate.r.simClock.tick),0);
    }
    const claimed=await b.page.evaluate(async()=>{
     const [{inspectCandidateSuspendEnvelope,candidateSuspendLayout},
      {loadCurrentBuildDescriptor},{LocalSuspendSlot}]=await Promise.all([
      import('/src/systems/savestate/candidateSuspendEnvelope.js'),
      import('/src/systems/savestate/runtimeIdentity.js'),
      import('/src/systems/savestate/localSuspendSlot.js')]);
     const identity=await loadCurrentBuildDescriptor(),slot=new LocalSuspendSlot();
     if(identity.buildId!==window.__candidate.g.registry.get('currentBuildId'))
      throw Error('reopen build identity mismatch');
     const claim=await slot.claim(identity,candidateSuspendLayout);
     if(!claim.ok)throw Error('candidate slot claim failed '+claim.code);
     const competitor=await new LocalSuspendSlot().claim(identity,candidateSuspendLayout);
     if(competitor.code!=='slot-claimed')throw Error('two-owner protection failed '+JSON.stringify(competitor));
     const admitted=inspectCandidateSuspendEnvelope(claim.bytes,identity);
     if(!admitted.ok||admitted.admission!=='envelope-only')throw Error('candidate envelope admission');
     window.__localClaim={slot,token:claim.token,identity,layout:candidateSuspendLayout};
     return {wire:new TextDecoder().decode(admitted.candidateBytes),admission:admitted.admission,competitor:competitor.code};
    });
    assert.equal(claimed.wire,wire);
    assert.equal(claimed.admission,'envelope-only');
    assert.equal(claimed.competitor,'slot-claimed');
    resumeWire=claimed.wire;
   }
   const result=await b.page.evaluate(({wire,frameTime})=>window.__candidate.restore(wire,frameTime),
    {wire:resumeWire,frameTime:cap.frameTime});
   if(suspendEnvelope){
    const consumed=await b.page.evaluate(async()=>{
     const {slot,token,identity,layout}=window.__localClaim;
     const result=await slot.consume(token),next=await slot.claim(identity,layout);
     return {result,next};
    });
    assert.deepEqual(consumed,{result:{ok:true,consumed:true},next:{ok:false,code:'empty'}});
    console.log(reopenProof?'PASS_REOPENED_IDB_CANDIDATE_ONE_USE':'PASS_IDB_CANDIDATE_ONE_USE',
     JSON.stringify({tick,bytes:Buffer.byteLength(wire),admission:'envelope-only',
      reopenedFreshPage:reopenProof,competitorClaimRefused:true,consumedAfterRestore:true}));
   }
   assert.equal(result.tick,tick);assert.equal(result.calls,0);assert.equal(result.exact,true);
   if(pausedCapture){
    const rePaused=await b.page.evaluate(()=>{
     const p=window.__candidate,r=p.r,beforeTick=r.simClock.tick;
     if(r._manualPausePending||r.scene.isPaused('RunScene'))throw Error('fresh resume remained paused');
     r.pauseRun();
     p.g.headlessStep(p.t,0);
     if(!r._manualPausePending||!r.scene.isPaused('RunScene')||!p.g.scene.isActive('PauseScene'))
      throw Error('freshly resumed run refused a new manual PauseScene');
     r.scene.get('PauseScene')._doResume();
     p.g.headlessStep(p.t,0);
     return {beforeTick,afterTick:r.simClock.tick,pending:r._manualPausePending,
      paused:r.scene.isPaused('RunScene')};
    });
    assert.equal(rePaused.beforeTick,tick);
    assert.equal(rePaused.afterTick,tick,'re-pause must not simulate a single causal tick');
    assert.equal(rePaused.pending,false,'re-pause must clear transient guard');
    assert.equal(rePaused.paused,false,'re-pause must return to active simulation');
    console.log('PASS_REPAUSE_AFTER_FRESH_REOPEN',JSON.stringify({tick,zeroSimTicks:true,
     resumedCanPauseAgain:true}));
   }
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
