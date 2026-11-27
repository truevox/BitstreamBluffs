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
const suspendEnvelope=process.argv.includes('--suspend-envelope')||reopenProof;
try{
 scratch=await mkdtemp(join(tmpdir(),'bb-candidate-file-'));
 vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true,watch:null,hmr:false}});
 await vite.listen();
 const url='http://127.0.0.1:'+vite.httpServer.address().port+'/';
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
  headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 async function boot(ms,existingContext=null){
  const context=existingContext||await browser.newContext({viewport:{width:960,height:540},serviceWorkers:'block'});
  if(!existingContext)await context.route('**/*',route=>{
   const target=new URL(route.request().url());
   if(target.origin===new URL(url).origin)return route.continue();
   return route.abort();
  });
  const page=await context.newPage();
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
  const src=await boot(time),reference=await boot(time);
  let dest;
  try {
   const orig=await src.page.evaluate(async tick=>{
    const p=window.__candidate;p.stepTo(tick);
    if(p.r.simClock.tick!==tick||p.r.crashed)throw Error('source boundary');
    const initial={fp:p.fp(),runId:p.r.runId,clock:p.r.simClock.tick,signature:p.signature(),t:p.t};
    p.r.pauseRun();p.g.headlessStep(p.t,0);
    if(!p.r.scene.isPaused('RunScene')||!p.r._manualPausePending)
     throw Error('native manual pause unavailable');
    const pause=p.r.scene.get('PauseScene');
    let occupiedRefusal=null;
    if(tick===481){
     const [{candidateSuspendEnvelopeBytes,candidateSuspendLayout},
      {LocalSuspendSlot},{loadCurrentBuildDescriptor}]=await Promise.all([
      import('/src/systems/savestate/candidateSuspendEnvelope.js'),
      import('/src/systems/savestate/localSuspendSlot.js'),
      import('/src/systems/savestate/runtimeIdentity.js')]);
     const identity=await loadCurrentBuildDescriptor(),slot=new LocalSuspendSlot();
     const candidate=p.capturePaused();
     const envelope=candidateSuspendEnvelopeBytes(new TextEncoder().encode(candidate),identity);
     const first=await slot.put(envelope,identity,candidateSuspendLayout);
     if(!first.ok)throw Error('test occupancy setup failed');
     occupiedRefusal=await pause._suspendRun();
     if(occupiedRefusal.ok||occupiedRefusal.code!=='slot-occupied'||pause.leaving||
        !p.r.scene.isPaused('RunScene')||p.r.simClock.tick!==tick)
      throw Error('occupied slot aborted source or unlocked pause '+JSON.stringify(occupiedRefusal));
     const cleared=await slot.clearReady();
     if(!cleared.ok||!cleared.cleared)throw Error('occupied precheck cleanup failed');
    }
    const result=await pause._suspendRun();
    p.g.headlessStep(p.t,0);
    const title=p.g.scene.isActive('TitleScene');
    const runActive=p.g.scene.isActive('RunScene'),pauseActive=p.g.scene.isActive('PauseScene');
    if(!result.ok||!title||runActive||pauseActive)throw Error('real source retirement failed '+JSON.stringify({result,title,runActive,pauseActive}));
    const {LocalSuspendSlot}=await import('/src/systems/savestate/localSuspendSlot.js');
    const {candidateSuspendLayout}=await import('/src/systems/savestate/candidateSuspendEnvelope.js');
    const {loadCurrentBuildDescriptor}=await import('/src/systems/savestate/runtimeIdentity.js');
    const identity=await loadCurrentBuildDescriptor();
    const claimed=await new LocalSuspendSlot().claim(identity,candidateSuspendLayout);
    if(!claimed.ok)throw Error('actual source slot missing '+JSON.stringify(claimed));
    const competitor=await new LocalSuspendSlot().claim(identity,candidateSuspendLayout);
    if(competitor.code!=='slot-claimed')throw Error('duplicate claim '+JSON.stringify(competitor));
    const released=await new LocalSuspendSlot().release(claimed.token);
    if(!released.ok)throw Error('test precheck release failed');
    return {...initial,result,title,runActive,pauseActive,slotBytes:claimed.bytes.length,occupiedRefusal};
   },tick);
   assert.equal(orig.result.saved,true);assert.equal(orig.result.retired,true);
   const ref=await reference.page.evaluate(tick=>{
    const p=window.__candidate;p.stepTo(tick);
    return {fp:p.fp(),runId:p.r.runId,clock:p.r.simClock.tick};
   },tick);
   assert.equal(ref.clock,tick);assert.equal(orig.clock,tick);
   assert.deepEqual(orig.fp,ref.fp);assert.equal(orig.runId,ref.runId);
   // Real source browser page dies, and reopened *new* page in the same
   // browser storage context claims the durable save without source state.
   await src.page.close();
   dest=await boot(time+1000,src.context);
   const claim=await dest.page.evaluate(async()=>{
    const [{candidateSuspendLayout,inspectCandidateSuspendEnvelope},
      {LocalSuspendSlot},{loadCurrentBuildDescriptor}]=await Promise.all([
      import('/src/systems/savestate/candidateSuspendEnvelope.js'),
      import('/src/systems/savestate/localSuspendSlot.js'),
      import('/src/systems/savestate/runtimeIdentity.js')]);
    const identity=await loadCurrentBuildDescriptor(),slot=new LocalSuspendSlot();
    const claimed=await slot.claim(identity,candidateSuspendLayout);
    if(!claimed.ok)throw Error('resume claim failed: '+JSON.stringify(claimed));
    const competitor=await new LocalSuspendSlot().claim(identity,candidateSuspendLayout);
    if(competitor.code!=='slot-claimed')throw Error('duplicate resume claim not blocked');
    const admitted=inspectCandidateSuspendEnvelope(claimed.bytes,identity);
    if(!admitted.ok)throw Error('candidate envelope invalid');
    window.__pauseClaim={slot,token:claimed.token,identity,layout:candidateSuspendLayout};
    return {wire:new TextDecoder().decode(admitted.candidateBytes),tick:claimed.tick,
      runId:claimed.runId,bytes:claimed.bytes.length};
   });
   assert.equal(claim.tick,tick);assert.equal(claim.runId,orig.runId);
   const result=await dest.page.evaluate(({wire,frameTime})=>window.__candidate.restore(wire,frameTime),
     {wire:claim.wire,frameTime:orig.t});
   assert.equal(result.calls,0);assert.equal(result.exact,true);
   assert.equal(result.tick,tick);assert.deepEqual(result.fp,orig.fp);
   const settled=await dest.page.evaluate(async()=>{
    const {slot,token,identity,layout}=window.__pauseClaim;
    const consumed=await slot.consume(token),next=await slot.claim(identity,layout);
    return {consumed,next,pending:window.__candidate.r._manualPausePending};
   });
   assert.deepEqual(settled.consumed,{ok:true,consumed:true});
   assert.deepEqual(settled.next,{ok:false,code:'empty'});
   assert.equal(settled.pending,false);
   await dest.page.clock.setFixedTime(new Date(time));
   const terminal=page=>page.evaluate(()=>window.__candidate.terminal());
   const left=await terminal(reference.page),right=await terminal(dest.page);
   assert.deepEqual(right,left);assert.equal(left.fingerprintErrors,0);
   assert.deepEqual(errors,[]);
   console.log('PASS_PAUSE_SOURCE_SAVE_RETIRE_REOPEN',JSON.stringify({
    tick,bytes:claim.bytes,sourceTitle:orig.title,sourceRunStopped:!orig.runActive,
    sourcePauseStopped:!orig.pauseActive,retiredAfterDurableSave:true,occupiedRetryPassed:tick===481?orig.occupiedRefusal?.code==='slot-occupied':null,originalPageClosed:true,
    newPageSameStorage:true,competingClaimRefused:true,oneUseConsumed:true,
    nextPauseUnblocked:!settled.pending,restoreSimTicks:result.calls,suffixTicks:left.frames.length,
    fatalTick:left.tick,exactTapeAndRecord:true,errors,
   }));
  }finally{
   await src.context.close();
   await reference.context.close();
  }
 }
}finally{await browser?.close();await vite?.close();if(scratch)await rm(scratch,{recursive:true,force:true});}
