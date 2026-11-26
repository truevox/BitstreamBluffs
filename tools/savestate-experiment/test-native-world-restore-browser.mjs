/** Full internal world reconstruction in the real source game.
 * No player UI or persisted layout; the diagnostic graph is trusted QA data.
 * B is held at tick zero and simTick is forbidden during restore.
 */
import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const matterWire=process.argv.includes('--matter-section');
const entityWire=process.argv.includes('--entity-section');
const sceneWire=process.argv.includes('--scene-subsystems');
const terrainWire=process.argv.includes('--terrain-section');
if(terrainWire&&(!matterWire||!entityWire||!sceneWire))throw Error('terrain integration requires other typed sections');
let scratch;
let vite,browser;
const errors=[];
try {
  if(matterWire||entityWire||sceneWire)scratch=await mkdtemp(join(tmpdir(),'bb-matter-section-'));
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
      const {encodeMatterState,decodeMatterState}=await import('/src/systems/savestate/matterState.js');
      const {encodeEntityState,decodeEntityState,ENTITY_STATE_FIELDS}=await import('/src/systems/savestate/entityState.js');
      const {encodeSceneSubsystemState,decodeSceneSubsystemState,SCENE_SUBSYSTEM_FIELDS}=await import('/src/systems/savestate/sceneSubsystemState.js');
      const {captureTerrainState,restoreTerrainState}=await import('/src/systems/savestate/terrainState.js');
      const {validateSectionBindings}=await import('/src/systems/savestate/sectionBindings.js');
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
      const matterContext=snapshot=>({runId:snapshot.ctx.runId,tick:snapshot.ctx.tick,buildId:snapshot.ctx.buildId});
      const Matter=window.Phaser.Physics.Matter.Matter;
      const entityContext=snapshot=>({...matterContext(snapshot),randomId:snapshot.world.game.runRandom.__id});
      const sceneContext=snapshot=>({...matterContext(snapshot),seed:r.seed});
      const earlyKeys=['simClock','runRandom','terrain','_chunkQueue'];
      window.__nativeWorld={g,r,kit,fp,t:0,
        encodeTerrain(snapshot){
          return new TextDecoder().decode(captureTerrainState(r.terrain,r._chunkQueue,[...r.mesh.chunks.keys()],matterContext(snapshot)));
        },
        stripTerrain(snapshot){
          // Confirm native regeneration's graph order on the source too.
          const early=kit.projectEarly(r,snapshot.clock,snapshot.rng,r.terrain,r._chunkQueue,[...r.collectedPowerups]);
          for(const k of [...earlyKeys,'collectedPowerups'])
            if(JSON.stringify(early[k])!==JSON.stringify(snapshot.world.game[k]))
              throw Error('source early projection differs: '+k);
          for(const k of earlyKeys)delete snapshot.world.game[k];
        },
        decodeTerrain(snapshot,wire){
          if(wire===undefined)return;
          if(earlyKeys.some(k=>Object.hasOwn(snapshot.world.game,k)))throw Error('raw terrain bypassed byte transport');
          const prepared=restoreTerrainState(new TextEncoder().encode(wire),r.createTerrainGenerator().options,matterContext(snapshot));
          if(JSON.stringify(prepared.meshOrder)!==JSON.stringify(snapshot.world.meshOrder))throw Error('terrain mesh order mismatch');
          const early=kit.projectEarly(r,snapshot.clock,snapshot.rng,prepared.terrain,prepared.queue,[]);
          // The entity section provides the actual collected set. Its node ID
          // must coincide with the deterministic placeholder's position.
          this.collectedNodeId=early.collectedPowerups.__id;
          for(const k of earlyKeys)snapshot.world.game[k]=early[k];
        },
        verifyBindings(snapshot){
          if(snapshot.world.game.collectedPowerups.__id!==this.collectedNodeId)throw Error('collected set node mismatch');
          validateSectionBindings(snapshot.world.game,snapshot.world.matter,snapshot.world.meshOrder);
        },
        encodeScene(snapshot){
          return new TextDecoder().decode(encodeSceneSubsystemState(snapshot.world.game,sceneContext(snapshot)));
        },
        stripScene(snapshot){
          for(const k of SCENE_SUBSYSTEM_FIELDS)delete snapshot.world.game[k];
        },
        decodeScene(snapshot,wire){
          if(wire===undefined)return;
          if(SCENE_SUBSYSTEM_FIELDS.some(k=>Object.hasOwn(snapshot.world.game,k)))throw Error('raw subsystems bypassed byte transport');
          Object.assign(snapshot.world.game,decodeSceneSubsystemState(new TextEncoder().encode(wire),sceneContext(snapshot)));
          if(this.encodeScene(snapshot)!==wire)throw Error('subsystem wire mismatch');
        },
        encodeEntities(snapshot){
          return new TextDecoder().decode(encodeEntityState(snapshot.world.game,entityContext(snapshot)));
        },
        stripEntities(snapshot){
          for(const k of ENTITY_STATE_FIELDS)delete snapshot.world.game[k];
        },
        decodeEntities(snapshot,wire){
          if(wire===undefined)return;
          if(ENTITY_STATE_FIELDS.some(k=>Object.hasOwn(snapshot.world.game,k)))throw Error('raw entities bypassed byte transport');
          Object.assign(snapshot.world.game,decodeEntityState(new TextEncoder().encode(wire),entityContext(snapshot)));
          if(this.encodeEntities(snapshot)!==wire)throw Error('entity wire mismatch');
        },
        encodeMatter(snapshot){
          return new TextDecoder().decode(encodeMatterState(snapshot.world.matter,matterContext(snapshot),Matter));
        },
        decodeMatter(snapshot,wire){
          if(wire===undefined)return;
          if(Object.hasOwn(snapshot.world,'matter'))throw Error('raw Matter bypassed byte transport');
          snapshot.world.matter=decodeMatterState(new TextEncoder().encode(wire),matterContext(snapshot),Matter);
          if(this.encodeMatter(snapshot)!==wire)throw Error('Matter wire mismatch');
        },
        stepTo(n){const frames=[];while(r.simClock.tick<n&&!r.crashed){
          this.t+=1000/120;g.headlessStep(this.t,1000/120);
          frames.push([r.simClock.tick,fp().combined]);
        }return frames;},
        reconstruct(snapshot,frameTime,wire,entities,subWire,terrain){
          this.decodeMatter(snapshot,wire);
          this.decodeTerrain(snapshot,terrain);
          this.decodeEntities(snapshot,entities);
          this.decodeScene(snapshot,subWire);
          if(terrain!==undefined)this.verifyBindings(snapshot);
          if(r.simClock.tick!==0)throw Error('candidate advanced before restore');
          const proto=Object.getPrototypeOf(r),sim=proto.simTick;
          let calls=0;
          // If the restore invokes even one physics tick, this positive
          // control fails. No prefix resimulation can pass.
          proto.simTick=function(){calls++;throw Error('simulation during restore');};
          try{kit.restore(r,snapshot);}finally{proto.simTick=sim;}
          this.t=frameTime;
          const exactMatter=wire===undefined?null:this.encodeMatter(kit.capture(r))===wire;
          if(wire!==undefined&&!exactMatter)throw Error('restored Matter bytes differ');
          if(r.sled.random!==r.runRandom)throw Error('sled RNG alias lost');
          const exactScene=subWire===undefined?null:this.encodeScene(kit.capture(r))===subWire;
          if(subWire!==undefined&&!exactScene)throw Error('restored scene subsystem bytes differ');
          if(r.hints.done!==r.tutDone)throw Error('tutorial alias lost');
          const exactTerrain=terrain===undefined?null:this.encodeTerrain(kit.capture(r))===terrain;
          if(terrain!==undefined&&!exactTerrain)throw Error('restored terrain bytes differ');
          return {tick:r.simClock.tick,calls,runId:r.runId,fingerprint:fp(),exactMatter,exactScene,exactTerrain};
        },
      };
    });
    return {context,page};
  }
  for(const captureTick of [481,936]) {
    const a=await boot(time),b=await boot(time+1000);
    try {
      const captured=await a.page.evaluate(({tick,matterWire,entityWire,sceneWire,terrainWire})=>{
        const p=window.__nativeWorld;p.stepTo(tick);
        if(p.r.simClock.tick!==tick||p.r.crashed)throw Error('source did not reach capture boundary');
        const snapshot=p.kit.capture(p.r);
        const retired=snapshot.world.matter.detectorOrder.filter(k=>typeof k==='object').length;
        const bodies=Object.keys(snapshot.world.matter.bodies).length;
        const wire=matterWire?p.encodeMatter(snapshot):undefined;
        if(matterWire)delete snapshot.world.matter;
        const entities=entityWire?p.encodeEntities(snapshot):undefined;
        const terrain=terrainWire?p.encodeTerrain(snapshot):undefined;
        if(terrainWire)p.stripTerrain(snapshot);
        if(entityWire)p.stripEntities(snapshot);
        const subWire=sceneWire?p.encodeScene(snapshot):undefined;
        if(sceneWire)p.stripScene(snapshot);
        return {snapshot,frameTime:p.t,wire,entities,subWire,terrain,retired,bodies};
      },{tick:captureTick,matterWire,entityWire,sceneWire,terrainWire});
      if(matterWire){
        const path=join(scratch,'matter-'+captureTick+'.bbmatter');
        // Real byte transport through a file; B receives no raw Matter data.
        await writeFile(path,captured.wire,{flag:'wx'});
        captured.wire=await readFile(path,'utf8');
        assert.equal(Object.hasOwn(captured.snapshot.world,'matter'),false);
        if(captureTick===936)assert.ok(captured.retired>0,'retired detector witness missing');
      }
      if(entityWire){
        const path=join(scratch,'entities-'+captureTick+'.bbentities');
        await writeFile(path,captured.entities,{flag:'wx'});
        captured.entities=await readFile(path,'utf8');
      }
      if(sceneWire){
        const path=join(scratch,'scene-'+captureTick+'.bbsubsystems');
        await writeFile(path,captured.subWire,{flag:'wx'});
        captured.subWire=await readFile(path,'utf8');
      }
      if(terrainWire){
        const path=join(scratch,'terrain-'+captureTick+'.bbterrain');
        await writeFile(path,captured.terrain,{flag:'wx'});
        captured.terrain=await readFile(path,'utf8');
        assert.equal(Object.hasOwn(captured.snapshot.world.game,'terrain'),false);
      }
      const before=await b.page.evaluate(()=>({tick:window.__nativeWorld.r.simClock.tick,
        fp:window.__nativeWorld.fp(),runId:window.__nativeWorld.r.runId}));
      assert.equal(before.tick,0);
      assert.notEqual(before.runId,captured.snapshot.ctx.runId);
      const negatives=await b.page.evaluate(({snapshot,wire,entities,subWire,terrain})=>{
        const p=window.__nativeWorld; p.decodeMatter(snapshot,wire);p.decodeTerrain(snapshot,terrain);p.decodeEntities(snapshot,entities);p.decodeScene(snapshot,subWire);if(terrain!==undefined)p.verifyBindings(snapshot);
        const before=JSON.stringify({fp:p.fp(),runId:p.r.runId,
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
          const refusal=await c.page.evaluate(({snapshot,frameTime,wire,entities,subWire,terrain})=>{
            snapshot.fingerprint.combined='xxh32x2:0000000000000000';
            try{window.__nativeWorld.reconstruct(snapshot,frameTime,wire,entities,subWire,terrain);return null;}
            catch(e){return {error:String(e.message),tick:window.__nativeWorld.r.simClock.tick};}
          },captured);
          assert.equal(refusal?.error,'native restore: reconstructed world mismatch; discard candidate');
          assert.equal(refusal.tick,captureTick);
        }finally{await c.context.close();}
        assert.deepEqual(await Promise.all([a.page,b.page].map(measured)),before);
        console.log('PASS_NATIVE_WORLD_LATE_DISCARD');
      }
      const restored=await b.page.evaluate(({snapshot,frameTime,wire,entities,subWire,terrain})=>window.__nativeWorld.reconstruct(snapshot,frameTime,wire,entities,subWire,terrain),captured);
      assert.equal(restored.tick,captureTick);
      assert.equal(restored.calls,0);
      if(matterWire)assert.equal(restored.exactMatter,true);
      if(sceneWire)assert.equal(restored.exactScene,true);
      if(terrainWire)assert.equal(restored.exactTerrain,true);
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
        exactNativeTape:true,exactNativeRecord:true,exactEverySuffixFingerprint:true,errors,
        matterWireBytes:matterWire?Buffer.byteLength(captured.wire):null,exactMatterRecapture:restored.exactMatter,
        bodies:captured.bodies,retiredDetector:captured.retired,entityWireBytes:entityWire?Buffer.byteLength(captured.entities):null,sceneWireBytes:sceneWire?Buffer.byteLength(captured.subWire):null,exactSceneRecapture:restored.exactScene,terrainWireBytes:terrainWire?Buffer.byteLength(captured.terrain):null,exactTerrainRecapture:restored.exactTerrain}));
    }finally{await a.context.close();await b.context.close();}
  }
}finally{await browser?.close();await vite?.close();if(scratch)await rm(scratch,{recursive:true,force:true});}
