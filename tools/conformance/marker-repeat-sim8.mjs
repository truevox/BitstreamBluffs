#!/usr/bin/env node
/** #253: built-game, marker-on/off exact-causal repeat test (no gameplay bypass).
 *  GAME_URL=http://127.0.0.1:4198/ node tools/conformance/marker-repeat-sim8.mjs
 *  Requires npm run build + a server serving THAT dist, and Playwright Chromium.
 *  Recorded hashes are diagnostic, not canonical verifier proofs.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
// Compile from THIS exact clean checkout. A stale dist from another HEAD must
// never acquire the current source identity just by matching the served HTML.
const sourceStatus=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(sourceStatus,'','source worktree must be clean for stamped acceptance');
const testedHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert(/^[a-f0-9]{40}$/.test(testedHead),'cannot attest exact commit SHA');
execFileSync('npm',['run','build'],{cwd:root,timeout:120000,stdio:'pipe'});
const source=fs.readFileSync(path.join(root,'tools/conformance/cross-engine-page.js'),'utf8');
const expectedHtml=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
const entryPath=/<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(expectedHtml)?.[1];
assert(entryPath,'compiled game entry module not found');
const expectedEntry=fs.readFileSync(path.join(root,'dist',entryPath.slice(1)));
const expectedJsFiles=new Map(fs.readdirSync(path.join(root,'dist/assets'))
  .filter(x=>x.endsWith('.js'))
  .map(x=>['/assets/'+x,fs.readFileSync(path.join(root,'dist/assets',x))]));
assert(expectedJsFiles.has(entryPath),'compiled entry not in expected JS assets');
const url=process.env.GAME_URL || 'http://127.0.0.1:4198/';
const hzValues=(process.env.HZ||'30,60,120,144').split(',').map(Number);
assert(hzValues.every(v=>Number.isFinite(v)&&v>=30&&v<=240));
const sha=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity=execFileSync(process.execPath,['tools/ruleset/build-ruleset.mjs','--identity'],{cwd:root,encoding:'utf8'}).trim();
execFileSync(process.execPath,['tools/ruleset/build-ruleset.mjs','--check-identity'],{cwd:root,stdio:'pipe'});
const results=[];
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
async function page() {
  const context=await browser.newContext({viewport:{width:960,height:540}});
  const p=await context.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(String(e)));
  // Observe Chromium's ACTUAL response bodies, including dynamically imported
  // runtime ruleset chunks. A separate p.request.get() proves nothing about
  // what the browser itself executed; this listener runs BEFORE navigation.
  const observed=new Map();
  const reads=[];
  let responseReadError=null;
  p.on('response',response=>{
    const requested=new URL(response.url());
    if(requested.origin!==new URL(url).origin ||
        !requested.pathname.startsWith('/assets/') || !requested.pathname.endsWith('.js'))return;
    const read=(async()=>{
      assert.equal(response.status(),200,`failed browser JS response ${requested.pathname}`);
      const expected=expectedJsFiles.get(requested.pathname);
      assert(expected,`browser requested unknown compiled JS asset: ${requested.pathname}`);
      const actual=await response.body();
      assert.deepEqual(actual,expected,`BROWSER EXECUTED DIFFERENT JS: ${requested.pathname}`);
      const digest=createHash('sha256').update(actual).digest('hex');
      const prior=observed.get(requested.pathname);
      assert(!prior||prior===digest,`inconsistent browser JS content for ${requested.pathname}`);
      observed.set(requested.pathname,digest);
    })();
    // A timed-out run closes its browser context while network responses may
    // still be pending. Attach rejection handling NOW, not later at the gate,
    // so context teardown never triggers an unhandled Node.js rejection.
    reads.push(read.catch(error=>{responseReadError ||= error;}));
  });
  async function verifyActualLoadedScripts({expectRuntime=false}={}){
    // page.on('response') captures the response used by Chromium, not a
    // separately issued request. Repeat after play() to cover lazy imports.
    await Promise.all(reads);
    if(responseReadError)throw responseReadError;
    assert(observed.has(entryPath),'Chromium never fetched the expected game entry module');
    if(expectRuntime)assert([...observed.keys()].some(x=>x.includes('runtimeRuleset-')),
      'the dynamically imported runtime ruleset was not observed');
    return Object.fromEntries([...observed].sort());
  }
  await p.addInitScript(`(() => {const R=Date, base=R.parse('2026-11-21T12:00:00Z'), t0=R.now(); function D(...a){return a.length?new R(...a):new R(base+R.now()-t0)} D.prototype=R.prototype;D.now=()=>base+R.now()-t0;D.parse=R.parse;D.UTC=R.UTC;window.Date=D})()`);
  await p.addInitScript(() => { window.__ceMarkerCachePure=true; }); // read-only diagnostic, does not mask causal subsystems
  await p.addInitScript(source);
  const response=await p.goto(url,{waitUntil:'domcontentloaded'});
  assert.equal(response.status(),200);
  assert.equal(await response.text(),expectedHtml,'served game index does not match local built dist/index.html');
  await p.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive()&&window.__ce,null,{timeout:60000});
  await verifyActualLoadedScripts();
  return {p,context,errors,verifyActualLoadedScripts};
}
async function run(p,{hz,markers,maxTicks=2400,raster=false,rasterLastFrames=0}){
  return p.evaluate(async({hz,markers,maxTicks,raster,rasterLastFrames})=>{
    const g=window.__bbGame,run=g.scene.getScene('RunScene');
    const seed='CE120-CRUISE',markerDistM=350,markerX=50+20*markerDistM;
    if(markers){
      const store=g.registry.get('saveStore');
      if(!store||!Array.isArray(store.runs))throw Error('saveStore.runs unavailable');
      if(!store.runs.some(r=>r.distanceM===markerDistM&&r.seed===seed))store.runs.push({distanceM:markerDistM,modded:false,seed,dailyMode:'classic'});
      g.registry.set('lastCrash',{seed,biomeMask:0,x:markerX,distM:markerDistM,runId:'marker-replay',cause:'hazard'});
    }else{
      g.registry.set('lastCrash',null);
      g.registry.get('saveStore').runs=[];
    }
    const shown={best:null,death:null},onscreen={best:null,death:null};
    let deferredBest=0,deferredDeath=0,unjoined=0,markerUpdates=0,generatorReads=0,cacheMutations=0;
    const real=run.renderFrame;
    const instrumented=new WeakSet(),originalUpdates=new Map();
    // Wrap BOTH real marker updates to detect even cache-only generator reads
    // before the post-tick diagnostic sampler could potentially overwrite them.
    // Never change the physics/marker result or suppress the actual labels.
    run.renderFrame=function(...args){
      if(this.sled&&this.mesh){
        for(const key of ['bestMarker','deathMarker']){
          const marker=this[key];
          if(!marker||instrumented.has(marker))continue;
          instrumented.add(marker);
          const actual=marker.update;
          originalUpdates.set(marker,actual);
          const scene=this;
          marker.update=function(...params){
            const terrain=scene.terrain, beforeCache=terrain._lastChunk,
              beforeQueue=terrain._pendingAdded.length,beforeActive=terrain.activeList.length;
            const oldHeight=terrain.heightAt;
            terrain.heightAt=function(...hArgs){generatorReads++;return oldHeight.apply(this,hArgs);};
            let value;
            try{value=actual.apply(this,params);}finally{terrain.heightAt=oldHeight;}
            markerUpdates++;
            if(terrain._lastChunk!==beforeCache||terrain._pendingAdded.length!==beforeQueue||
               terrain.activeList.length!==beforeActive)cacheMutations++;
            return value;
          };
        }
      }
      const out=real.apply(this,args);
      if(!this.sled||!this.mesh)return out;
      for(const [label,key] of [['best','bestMarker'],['death','deathMarker']]){
        const m=this[key];if(!m)continue;
        const joined=[...this.mesh.chunks.values()].some(c=>m.x>=c.startX&&m.x<=c.endX);
        if(!joined&&m.y==null&&m.x-this.sled.x<=2600){if(label==='best')deferredBest++;else deferredDeath++;}
        if(!joined&&m.y!=null&&!shown[label])unjoined++;
        if(m.y!=null&&!shown[label])shown[label]={tick:this.simClock.tick,joined,visible:m.label?.visible};
        // A visible Phaser Text must also intersect the actual game camera;
        // raster smoke enables the renderer and captures screenshots separately.
        if(m.y!=null&&m.label?.visible&&!onscreen[label]&&m.label.getBounds){
          const rect=m.label.getBounds(),v=this.cameras.main.worldView;
          if(rect.right>v.x&&rect.x<v.right&&rect.bottom>v.y&&rect.y<v.bottom)
            onscreen[label]={tick:this.simClock.tick,bounds:{x:rect.x,y:rect.y,w:rect.width,h:rect.height}};
        }
      }
      return out;
    };
    try{
      const out=await window.__ce.play({seed,hz,style:'cruise',params:{},maxTicks,kodiaks:false,raster,rasterLastFrames});
      const capturedFrame={};
      if(raster){
        const v=run.cameras.main.worldView;
        for(const [label,key] of [['best','bestMarker'],['death','deathMarker']]){
          const m=run[key],rect=m?.label?.getBounds?.();
          capturedFrame[label]=!!(m?.label?.visible&&rect && rect.right>v.x&&rect.x<v.right&&
            rect.bottom>v.y&&rect.y<v.bottom);
        }
      }
      return {outcome:out.outcome,digests:out.digests,raw:out.raw,
        marker:{shown,onscreen,capturedFrame,deferredBest,deferredDeath,unjoined,markerUpdates,generatorReads,cacheMutations}};
    }finally{
      run.renderFrame=real;
      for(const [m,update] of originalUpdates)m.update=update;
    }
  },{hz,markers,maxTicks,raster,rasterLastFrames});
}
const RUN_TIMEOUT_MS=Number(process.env.RUN_TIMEOUT_MS||45000);
assert(Number.isInteger(RUN_TIMEOUT_MS)&&RUN_TIMEOUT_MS>0&&RUN_TIMEOUT_MS<=180000,
  'RUN_TIMEOUT_MS must be an integer in (0,180000]');
async function runBounded(session,options) {
  // The underlying conformance bootRun polls with requestAnimationFrame. If
  // that scene transition stalls there is otherwise NO rejection from evaluate.
  // Closing the whole context interrupts Chromium's pending page.evaluate.
  // Report exact cadence/policy and already observed browser page errors.
  let timer;
  const stop=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      void session.context.close().catch(()=>{});
      reject(new Error(`SIM8 browser run timeout after ${RUN_TIMEOUT_MS}ms: `+
        `cadence=${options.hz}Hz markers=${options.markers} raster=${!!options.raster}; `+
        `page errors: ${session.errors.length?session.errors.join(' | '):'none reported'}`));
    },RUN_TIMEOUT_MS);
  });
  try {return await Promise.race([run(session.p,options),stop]);}
  finally {clearTimeout(timer);}
}
try {
  for(const hz of hzValues){
    const base=await page();const marker=await page();
    try {
      const a=await runBounded(base,{hz,markers:false});
      const b=await runBounded(marker,{hz,markers:true});
      const c=await runBounded(marker,{hz,markers:true});
      const baseJs=await base.verifyActualLoadedScripts({expectRuntime:true});
      const markerJs=await marker.verifyActualLoadedScripts({expectRuntime:true});
      assert.deepEqual(baseJs,markerJs,'marker mode loads a different compiled JS graph');
      assert.deepEqual(base.errors,[]);
      assert.deepEqual(marker.errors,[]);
      assert(b.marker.shown.best?.joined&&b.marker.shown.best?.visible);
      assert(b.marker.shown.death?.joined&&b.marker.shown.death?.visible);
      assert(b.marker.deferredBest>0&&b.marker.deferredDeath>0&&b.marker.unjoined===0);
      assert(b.marker.markerUpdates>0 && b.marker.generatorReads===0 && b.marker.cacheMutations===0);
      assert(c.marker.markerUpdates>0 && c.marker.generatorReads===0 && c.marker.cacheMutations===0);
      assert(c.marker.shown.best?.joined&&c.marker.shown.death?.joined);
      const one=[a,b,c];
      for(const item of one){
        assert(item.digests.length>=2400,'expected 2400 causal diagnostic samples');
        assert.deepEqual(item.outcome,a.outcome,`outcome mismatch at ${hz}Hz`);
        assert.deepEqual(item.digests,a.digests,`causal digest mismatch at ${hz}Hz`);
        assert.deepEqual(item.raw,a.raw,`raw debug-state mismatch at ${hz}Hz`);
      }
      const record={hz,rows:3,causalSha:sha(a.digests),rawSha:sha(a.raw),outcome:a.outcome,
        executedJs:baseJs,
        markerGeneratorReads:b.marker.generatorReads,markerCacheMutations:b.marker.cacheMutations,
        markerFirstShown:b.marker.shown,repeatMarkerFirstShown:c.marker.shown,
        deferred:{best:b.marker.deferredBest,death:b.marker.deferredDeath},errors:[]};
      results.push(record);
      console.log(`PASS ${hz}Hz: fresh no-marker == fresh marker == same-page repeat marker, ${a.digests.length} causal samples, ${record.causalSha.slice(0,12)}`);
    }finally{await base.context.close();await marker.context.close();}
  }
  // Separate REAL RASTER check. The 12-run fast matrix suppresses only GPU
  // presentation; this pair renders the actual canvas and captures both
  // images at a matching tick while the gate labels should be on screen.
  let rasterEvidence=null;
  if(process.env.RASTER==='1'){
    const normal=await page(),marked=await page();
    try{
      const hz=120,maxTicks=Number(process.env.RASTER_TICKS||1600);
      const a=await runBounded(normal,{hz,markers:false,maxTicks,raster:true,rasterLastFrames:4});
      const b=await runBounded(marked,{hz,markers:true,maxTicks,raster:true,rasterLastFrames:4});
      const normalJs=await normal.verifyActualLoadedScripts({expectRuntime:true});
      const markedJs=await marked.verifyActualLoadedScripts({expectRuntime:true});
      assert.deepEqual(normalJs,markedJs,'raster mode loaded a different compiled JS graph');
      assert.deepEqual(normal.errors,[]);
      assert.deepEqual(marked.errors,[]);
      assert.deepEqual(a.outcome,b.outcome);
      assert.deepEqual(a.digests,b.digests);
      assert.equal(b.marker.generatorReads,0);
      assert.equal(b.marker.cacheMutations,0);
      assert(b.marker.shown.best?.visible&&b.marker.shown.death?.visible,'both labels must be visible game objects');
      assert(b.marker.onscreen.best&&b.marker.onscreen.death,'both labels must intersect camera during genuine rendered frames');
      assert(b.marker.capturedFrame.best&&b.marker.capturedFrame.death,
        'both label text bounds must intersect camera ON THE FRAME BEING CAPTURED');
      // Camera shake draws a NEW cosmetic RNG offset even for dt=0: an
      // identical simulation tick may otherwise move the whole screenshot
      // several pixels between visibility toggles. Stabilize ONLY the local
      // test camera after all causal comparisons, never production physics.
      await marked.p.evaluate(()=>{
        const run=window.__bbGame.scene.getScene('RunScene');
        const tick=run.simClock.tick;
        run.shakeAmp=0;
        run.updateCamera(0);
        if(run.simClock.tick!==tick)throw Error('Raster camera stabilization advanced simulation');
      });
      // Pixel proof of EACH label, not merely the gate poles. Hide only one
      // Phaser text object at a time, re-render the SAME camera with zero
      // simulation delta, and compare a tightly clipped text region. The
      // marker pole and all other scenery remain unchanged; the tick must not
      // advance. This catches visible-but-not-painted labels.
      const clipRegions=await marked.p.evaluate(()=>{
        const g=window.__bbGame,run=g.scene.getScene('RunScene');
        const view=run.cameras.main.worldView;
        const canvasRect=g.canvas.getBoundingClientRect();
        const scaleX=canvasRect.width/view.width,scaleY=canvasRect.height/view.height;
        const regions={};
        for(const [label,key] of [['best','bestMarker'],['death','deathMarker']]){
          const m=run[key],r=m.label.getBounds();
          const x=Math.max(0,Math.floor(canvasRect.x+(r.x-view.x)*scaleX-2));
          const y=Math.max(0,Math.floor(canvasRect.y+(r.y-view.y)*scaleY-2));
          const right=Math.min(window.innerWidth,Math.ceil(canvasRect.x+(r.right-view.x)*scaleX+2));
          const bottom=Math.min(window.innerHeight,Math.ceil(canvasRect.y+(r.bottom-view.y)*scaleY+2));
          if(!(right>x+6&&bottom>y+6))throw Error(`${label} has no screen-space text region`);
          regions[label]={x,y,width:right-x,height:bottom-y};
        }
        return regions;
      });
      const labelPixelProof={};
      const renderWithoutSim=async(label,visible)=>marked.p.evaluate(({label,visible})=>{
        const g=window.__bbGame,run=g.scene.getScene('RunScene');
        const before=run.simClock.tick;
        run[label==='best'?'bestMarker':'deathMarker'].label.setVisible(visible);
        g.step(g.loop.now,0);
        if(run.simClock.tick!==before)throw Error('Visibility-only raster test advanced simulation');
      },{label,visible});
      for(const label of ['best','death']){
        const clip=clipRegions[label];
        // Establish the same zero-simulation-frame rendering baseline used
        // for the hidden and restored captures. The bounded replay's final
        // frame may precede Phaser camera/label presentation settlement.
        await renderWithoutSim(label,true);
        const visiblePixels=await marked.p.screenshot({clip});
        await renderWithoutSim(label,false);
        const hiddenPixels=await marked.p.screenshot({clip});
        assert(!visiblePixels.equals(hiddenPixels),`${label} text pixels did not change when only that label was hidden`);
        await renderWithoutSim(label,true);
        const restoredPixels=await marked.p.screenshot({clip});
        // Developer diagnostic only: preserve the three crops when this strict
        // byte-equality gate fails, so a real mismatch can be inspected.
        if(!visiblePixels.equals(restoredPixels)){
          for(const [stage,png] of [['visible',visiblePixels],['hidden',hiddenPixels],['restored',restoredPixels]])
            fs.writeFileSync(`/tmp/bsb253-${label}-${stage}.png`,png);
        }
        assert(visiblePixels.equals(restoredPixels),`${label} pixel crop not restored after zero-tick rerender`);
        const bytesSha=(buf)=>createHash('sha256').update(buf).digest('hex');
        labelPixelProof[label]={clip,visibleSha:bytesSha(visiblePixels),hiddenSha:bytesSha(hiddenPixels),restored:true};
        if(process.env.RASTER_OUT){
          fs.writeFileSync(`${process.env.RASTER_OUT}-${label}-visible.png`,visiblePixels,{flag:'wx'});
          fs.writeFileSync(`${process.env.RASTER_OUT}-${label}-hidden.png`,hiddenPixels,{flag:'wx'});
        }
      }
      const screenshotA=await normal.p.screenshot(),screenshotB=await marked.p.screenshot();
      assert.notEqual(createHash('sha256').update(screenshotA).digest('hex'),
        createHash('sha256').update(screenshotB).digest('hex'),'actual raster buffers must differ with both markers');
      if(process.env.RASTER_OUT){
        fs.writeFileSync(`${process.env.RASTER_OUT}-normal.png`,screenshotA,{flag:'wx'});
        fs.writeFileSync(`${process.env.RASTER_OUT}-markers.png`,screenshotB,{flag:'wx'});
      }
      rasterEvidence={hz,maxTicks,executedJs:markedJs,markerOnscreen:b.marker.onscreen,
        capturedFrame:b.marker.capturedFrame,labelPixelProof,
        normalPngSha:createHash('sha256').update(screenshotA).digest('hex'),
        markerPngSha:createHash('sha256').update(screenshotB).digest('hex'),
        markerGeneratorReads:b.marker.generatorReads,markerCacheMutations:b.marker.cacheMutations};
      console.log(`PASS actual raster ${hz}Hz@${maxTicks}: both marker labels intersect camera, real images differ, zero marker generator reads`);
    }finally{await normal.context.close();await marked.context.close();}
  }

  if(process.env.OUT)fs.writeFileSync(process.env.OUT,JSON.stringify({testedHead,identity,url,distIndexSha:sha(expectedHtml),distEntrySha:createHash('sha256').update(expectedEntry).digest('hex'),
    freshlyBuilt:true,readOnlyDerivedProbe:true,results,rasterEvidence},null,2)+'\n',{flag:'wx'});
  console.log(`PASS #253 all ${results.length*3} real Chromium render/cadence/run-position cells; no marker-dependent causal state`);
}finally{await browser.close();}
