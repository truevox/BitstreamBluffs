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
const source=fs.readFileSync(path.join(root,'tools/conformance/cross-engine-page.js'),'utf8');
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
  await p.addInitScript(`(() => {const R=Date, base=R.parse('2026-11-21T12:00:00Z'), t0=R.now(); function D(...a){return a.length?new R(...a):new R(base+R.now()-t0)} D.prototype=R.prototype;D.now=()=>base+R.now()-t0;D.parse=R.parse;D.UTC=R.UTC;window.Date=D})()`);
  await p.addInitScript(source);
  const response=await p.goto(url,{waitUntil:'domcontentloaded'});
  assert.equal(response.status(),200);
  await p.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive()&&window.__ce,null,{timeout:60000});
  return {p,context,errors};
}
async function run(p,{hz,markers}){
  return p.evaluate(async({hz,markers})=>{
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
    const shown={best:null,death:null};let deferredBest=0,deferredDeath=0,unjoined=0;
    const real=run.renderFrame;
    // Actual RunScene.renderFrame/BestMarker/LastDeathMarker are invoked. This
    // wrapper reads presentation state only, never changes input or terrain.
    run.renderFrame=function(...args){
      const out=real.apply(this,args);
      if(!this.sled||!this.mesh)return out;
      for(const [label,key] of [['best','bestMarker'],['death','deathMarker']]){
        const m=this[key];if(!m)continue;
        const joined=[...this.mesh.chunks.values()].some(c=>m.x>=c.startX&&m.x<=c.endX);
        if(!joined&&m.y==null&&m.x-this.sled.x<=2600){if(label==='best')deferredBest++;else deferredDeath++;}
        if(!joined&&m.y!=null&&!shown[label])unjoined++;
        if(m.y!=null&&!shown[label])shown[label]={tick:this.simClock.tick,joined,visible:m.label?.visible};
      }
      return out;
    };
    try{
      const out=await window.__ce.play({seed,hz,style:'cruise',params:{},maxTicks:2400,kodiaks:false,raster:false});
      return {outcome:out.outcome,digests:out.digests,raw:out.raw,marker: {shown,deferredBest,deferredDeath,unjoined}};
    }finally{run.renderFrame=real;}
  },{hz,markers});
}
try {
  for(const hz of hzValues){
    const base=await page();const marker=await page();
    try {
      const a=await run(base.p,{hz,markers:false});
      const b=await run(marker.p,{hz,markers:true});
      const c=await run(marker.p,{hz,markers:true});
      assert.deepEqual(base.errors,[]);
      assert.deepEqual(marker.errors,[]);
      assert(b.marker.shown.best?.joined&&b.marker.shown.best?.visible);
      assert(b.marker.shown.death?.joined&&b.marker.shown.death?.visible);
      assert(b.marker.deferredBest>0&&b.marker.deferredDeath>0&&b.marker.unjoined===0);
      assert(c.marker.shown.best?.joined&&c.marker.shown.death?.joined);
      const one=[a,b,c];
      for(const item of one){
        assert(item.digests.length>=2400,'expected 2400 causal diagnostic samples');
        assert.deepEqual(item.outcome,a.outcome,`outcome mismatch at ${hz}Hz`);
        assert.deepEqual(item.digests,a.digests,`causal digest mismatch at ${hz}Hz`);
        assert.deepEqual(item.raw,a.raw,`raw debug-state mismatch at ${hz}Hz`);
      }
      const record={hz,rows:3,causalSha:sha(a.digests),rawSha:sha(a.raw),outcome:a.outcome,
        markerFirstShown:b.marker.shown,repeatMarkerFirstShown:c.marker.shown,
        deferred:{best:b.marker.deferredBest,death:b.marker.deferredDeath},errors:[]};
      results.push(record);
      console.log(`PASS ${hz}Hz: fresh no-marker == fresh marker == same-page repeat marker, ${a.digests.length} causal samples, ${record.causalSha.slice(0,12)}`);
    }finally{await base.context.close();await marker.context.close();}
  }
  if(process.env.OUT)fs.writeFileSync(process.env.OUT,JSON.stringify({identity,url,results},null,2)+'\n',{flag:'wx'});
  console.log(`PASS #253 all ${results.length*3} real Chromium render/cadence/run-position cells; no marker-dependent causal state`);
}finally{await browser.close();}
