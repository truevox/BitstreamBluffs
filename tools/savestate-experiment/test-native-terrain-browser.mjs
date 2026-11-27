/** Native terrain recipe disk transport, independent source-game contexts.
 * Detached generator reconstruction only: never attach to a live Matter
 * scene or leave stale entity/spawn aliases. Full scene parity is separate.
 */
import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
let vite,browser,scratch;
const errors=[];
try{
 scratch=await mkdtemp(join(tmpdir(),'bb-terrain-state-'));
 vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true}});
 await vite.listen();
 const url='http://127.0.0.1:'+vite.httpServer.address().port+'/';
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,
 args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const time=Date.UTC(2026,0,5,12);
 async function boot(ms){
  const context=await browser.newContext({viewport:{width:960,height:540}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date(ms));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
   typeof window.__bbGame.registry.get('currentBuildId')==='string',null,{timeout:60000});
  await page.evaluate(async()=>{
   const api=await import('/src/systems/savestate/terrainState.js');
   const {chunkDigestOf}=await import('/src/systems/replay/fingerprintCapture.js');
   const g=window.__bbGame,r=g.scene.getScene('RunScene');
   g.loop.sleep();g.scene.getScene('TitleScene').startRun('sim-05@0');
   g.scene.stop('TitleScene');g.scene.start('RunScene');g.headlessStep(0,0);
   if(!r.sys.isActive()||r.simClock.tick!==0||!r.ghostRecorder||r.tapePlayer||r.unrankedPractice)
    throw Error('not a genuine normal run');
   r.inputRouter.poll=()=>({push:false,tilt:0,heli:0,tuck:false,hop:false,pressed:{}});
   const serialize=(t,q,m,ctx)=>new TextDecoder().decode(api.captureTerrainState(t,q,m,ctx));
   const live=()=>({terrain:r.terrain,queue:r._chunkQueue,meshOrder:[...r.mesh.chunks.keys()]});
   const identity=()=>({runId:r.runId,tick:r.simClock.tick,buildId:g.registry.get('currentBuildId')});
   function probe(state,positions,ctx){
    const t=state.terrain,q=state.queue,m=new Set(state.meshOrder),out=[];
    for(const x of positions){
     const heights=[x,x+100,x+20000,100,x-10].map(p=>[t.heightAt(p),t.slopeDegAt(p)]);
     const {added,removed}=t.update(x);
     for(const i of removed){q.delete(i);m.delete(i);}
     for(const c of added)q.set(c.index,c);
     for(const [i,c] of q)if(c.startX<x+1200){m.add(i);q.delete(i);}
     out.push({heights,added:added.map(c=>[c.index,chunkDigestOf(c)]),removed,
      active:t.activeList.map(c=>[c.index,chunkDigestOf(c)])});
    }
    return {out,wire:serialize(t,q,[...m],ctx)};
   }
   window.__terrainProof={r,api,serialize,live,identity,probe,
    stepTo(n){let t=0;while(r.simClock.tick<n&&!r.crashed){t+=1000/120;g.headlessStep(t,1000/120);}return r.simClock.tick;}};
  });
  return {context,page};
 }
 for(const tick of [481,936]){
  const a=await boot(time),b=await boot(time+1000);
  try{
   const cap=await a.page.evaluate(tick=>{
    const p=window.__terrainProof;
    if(p.stepTo(tick)!==tick||p.r.crashed)throw Error('capture boundary');
    const s=p.live(),ctx=p.identity();
    const wire=p.serialize(s.terrain,s.queue,s.meshOrder,ctx);
    return {wire,ctx,x:p.r.sled.x,active:s.terrain.activeList.length,pool:s.terrain.pool.length,
     release:s.terrain._pendingRelease.length,mesh:s.meshOrder.length,queued:s.queue.size};
   },tick);
   const path=join(scratch,'terrain-'+tick+'.bbterrain');
   await writeFile(path,cap.wire,{flag:'wx'});const wire=await readFile(path,'utf8');
   const positions=Array.from({length:20},(_,i)=>cap.x+200+i*551);
   const dest=await b.page.evaluate(({wire,ctx,positions})=>{
    const p=window.__terrainProof,s=p.live(),before=p.serialize(s.terrain,s.queue,s.meshOrder,p.identity());
    const detached=p.api.restoreTerrainState(new TextEncoder().encode(wire),p.r.createTerrainGenerator().options,ctx);
    const exact=p.serialize(detached.terrain,detached.queue,detached.meshOrder,ctx)===wire;
    const alias=[...detached.queue].every(([i,c])=>detached.terrain.active.get(i)===c)&&
     detached.terrain.activeList.every(c=>detached.terrain.active.get(c.index)===c);
    const result=p.probe(detached,positions,ctx);
    return {exact,alias,result,liveUnchanged:before===p.serialize(s.terrain,s.queue,s.meshOrder,p.identity()),tick:p.r.simClock.tick};
   },{wire,ctx:cap.ctx,positions});
   assert.equal(dest.exact,true);assert.equal(dest.alias,true);assert.equal(dest.liveUnchanged,true);assert.equal(dest.tick,0);
   // Dedicated QA contexts, no gameplay ticks during the terrain query
   // suffix. Source is disposed after its destructive streaming probe.
   const source=await a.page.evaluate(({ctx,positions})=>{const p=window.__terrainProof;return p.probe(p.live(),positions,ctx);},{ctx:cap.ctx,positions});
   assert.deepEqual(dest.result,source);assert.deepEqual(errors,[]);
   console.log('PASS_NATIVE_TERRAIN_DISK',JSON.stringify({tick,wireBytes:Buffer.byteLength(wire),active:cap.active,
    mesh:cap.mesh,queued:cap.queued,pool:cap.pool,release:cap.release,exactRecapture:dest.exact,
    exactAliases:dest.alias,queryBatches:positions.length,liveCandidateUnchanged:dest.liveUnchanged,errors}));
  }finally{await a.context.close();await b.context.close();}
 }
}finally{await browser?.close();await vite?.close();if(scratch)await rm(scratch,{recursive:true,force:true});}
