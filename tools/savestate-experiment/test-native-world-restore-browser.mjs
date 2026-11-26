/** Full internal world reconstruction in the real source game.
 * No player UI or persisted layout; the diagnostic graph is trusted QA data.
 * B is held at tick zero and simTick is forbidden during restore.
 */
import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
let vite,browser;
const errors=[];
try {
  vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true}});
  await vite.listen();
  const url='http://127.0.0.1:'+vite.httpServer.address().port+'/';
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
    headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const time=Date.UTC(2026,0,5,12);
  async function boot(ms) {
    const context=await browser.newContext({viewport:{width:960,height:540}});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.clock.setFixedTime(new Date(ms));
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
      typeof window.__bbGame.registry.get('currentBuildId')==='string',null,{timeout:60000});
    await page.evaluate(async()=>{
      const {createNativeRunSceneRestoreKit}=await import('/src/systems/savestate/RunSceneRestoreKit.js');
      const {captureCausalState}=await import('/src/systems/replay/fingerprintCapture.js');
      const {fingerprintState}=await import('/src/systems/replay/fingerprint.js');
      const g=window.__bbGame,r=g.scene.getScene('RunScene');
      g.loop.sleep();g.scene.getScene('TitleScene').startRun('sim-05@0');
      g.scene.stop('TitleScene');g.scene.start('RunScene');g.headlessStep(0,0);
      if(!r.sys.isActive()||r.simClock.tick!==0||!r.ghostRecorder||r.tapePlayer||r.unrankedPractice||
        r.appliedBoosts.length||r.upgradeRun.enabled||r.magnetsDrop||r.kodiaksOn)
        throw Error('not genuine stock tick-zero recording');
      r.inputRouter.poll=()=>({push:false,tilt:0,heli:0,tuck:false,hop:false,pressed:{}});
      const kit=createNativeRunSceneRestoreKit(window.Phaser);
      const fp=()=>fingerprintState(captureCausalState(r));
      window.__nativeWorld={g,r,kit,fp,t:0,
        stepTo(n){const frames=[];while(r.simClock.tick<n&&!r.crashed){
          this.t+=1000/120;g.headlessStep(this.t,1000/120);
          frames.push([r.simClock.tick,fp().combined]);
        }return frames;},
        reconstruct(snapshot,frameTime){
          if(r.simClock.tick!==0)throw Error('candidate advanced before restore');
          const proto=Object.getPrototypeOf(r),sim=proto.simTick;
          let calls=0;
          // If the restore invokes even one physics tick, this positive
          // control fails. No prefix resimulation can pass.
          proto.simTick=function(){calls++;throw Error('simulation during restore');};
          try{kit.restore(r,snapshot);}finally{proto.simTick=sim;}
          this.t=frameTime;
          return {tick:r.simClock.tick,calls,runId:r.runId,fingerprint:fp()};
        },
      };
    });
    return {context,page};
  }
  for(const captureTick of [481,936]) {
    const a=await boot(time),b=await boot(time+1000);
    try {
      const captured=await a.page.evaluate(tick=>{
        const p=window.__nativeWorld;p.stepTo(tick);
        if(p.r.simClock.tick!==tick||p.r.crashed)throw Error('source did not reach capture boundary');
        return {snapshot:p.kit.capture(p.r),frameTime:p.t};
      },captureTick);
      const before=await b.page.evaluate(()=>({tick:window.__nativeWorld.r.simClock.tick,
        fp:window.__nativeWorld.fp(),runId:window.__nativeWorld.r.runId}));
      assert.equal(before.tick,0);
      assert.notEqual(before.runId,captured.snapshot.ctx.runId);
      const negatives=await b.page.evaluate(({snapshot})=>{
        const p=window.__nativeWorld,before=JSON.stringify({fp:p.fp(),runId:p.r.runId,
          tick:p.r.simClock.tick,rec:p.r.ghostRecorder.lastTick});
        const controls={
          build:s=>s.ctx.buildId='sha256:'+'a'.repeat(64),
          tick:s=>s.ctx.tick++,
          clock:s=>s.clock.tick++,
          rng:s=>s.rng.streams.physicsScramble.baseSeed^=1,
          prefix:s=>s.world.recorder.recorder.inputs.shift(),
          retiredPool:s=>s.world.pool.push({}),
          unsafeField:s=>Object.defineProperty(s.world.game.score.__obj,'__proto__',{value:{polluted:true},enumerable:true}),
          missingConfig:s=>delete s.world.config.seed,
          missingSim:s=>delete s.world.game.score,
        };
        return Object.entries(controls).map(([name,mutate])=>{
          const bad=structuredClone(snapshot);mutate(bad);
          let error;try{p.kit.restore(p.r,bad);}catch(e){error=String(e.message);}
          const unchanged=before===JSON.stringify({fp:p.fp(),runId:p.r.runId,
            tick:p.r.simClock.tick,rec:p.r.ghostRecorder.lastTick});
          if(!error||!unchanged)throw Error('early refusal failed '+name+' '+error);
          return {name,error,unchanged};
        });
      },captured);
      if(captureTick===481){
        const measured=page=>page.evaluate(()=>{const p=window.__nativeWorld;return {fp:p.fp(),tick:p.r.simClock.tick,runId:p.r.runId};});
        const before=await Promise.all([a.page,b.page].map(measured));
        const c=await boot(time+2000);
        try{
          const refusal=await c.page.evaluate(({snapshot,frameTime})=>{
            snapshot.fingerprint.combined='xxh32x2:0000000000000000';
            try{window.__nativeWorld.reconstruct(snapshot,frameTime);return null;}
            catch(e){return {error:String(e.message),tick:window.__nativeWorld.r.simClock.tick};}
          },captured);
          assert.equal(refusal?.error,'native restore: reconstructed world mismatch; discard candidate');
          assert.equal(refusal.tick,captureTick);
        }finally{await c.context.close();}
        assert.deepEqual(await Promise.all([a.page,b.page].map(measured)),before);
        console.log('PASS_NATIVE_WORLD_LATE_DISCARD');
      }
      const restored=await b.page.evaluate(({snapshot,frameTime})=>window.__nativeWorld.reconstruct(snapshot,frameTime),captured);
      assert.equal(restored.tick,captureTick);
      assert.equal(restored.calls,0);
      assert.equal(restored.runId,captured.snapshot.ctx.runId);
      assert.deepEqual(restored.fingerprint,captured.snapshot.fingerprint);
      // Metadata for the original native run is restored; align the test
      // clocks for end timestamps without changing simulation state.
      await b.page.clock.setFixedTime(new Date(time));
      const terminal=page=>page.evaluate(()=>{
        const p=window.__nativeWorld,rec=p.r.ghostRecorder,frames=p.stepTo(2500);
        if(!p.r.crashed)throw Error('stock fixture did not reach native fatal tick');
        const record=p.g.registry.get('lastRecord'),tape=p.g.registry.get('lastGhostTape');
        if(!record||!tape||record.id!==p.r.runId||tape.runId!==p.r.runId)throw Error('native terminal result missing');
        return {frames,tick:p.r.simClock.tick,record,tape,fp:p.fp(),fingerprints:rec.fingerprints,
          fingerprintErrors:rec.fingerprintErrorCount};
      });
      const left=await terminal(a.page),right=await terminal(b.page);
      assert.deepEqual(right,left);
      assert.equal(left.fingerprintErrors,0);
      assert.ok(left.fingerprints.length>=4);
      assert.deepEqual(errors,[]);
      console.log('PASS_NATIVE_WORLD_RESTORE',JSON.stringify({captureTick,terminalTick:left.tick,
        suffixTicks:left.frames.length,tapeEndTick:left.tape.endTick,checkpoints:left.fingerprints.length,
        score:left.record.score,restoreSimTicks:restored.calls,negativeControls:negatives,
        exactNativeTape:true,exactNativeRecord:true,exactEverySuffixFingerprint:true,errors}));
    }finally{await a.context.close();await b.context.close();}
  }
}finally{await browser?.close();await vite?.close();}
