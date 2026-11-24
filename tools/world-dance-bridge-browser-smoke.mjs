/** Production browser regression for generator-owned bridge transitions and EQ.
 * Scripted sled placements, NOT an uninterrupted human playthrough.
 * No forced look, forced veil, fake analyser data or production-state changes.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://127.0.0.1:18240/';
assert.equal(new URL(url).hostname,'127.0.0.1');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:960,height:600}});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 await page.keyboard.press('x');
 await page.waitForFunction(()=>{const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;return d?.started&&d.pack&&d.activeNodes.size>=6&&!d._loading;},null,{timeout:45000});
 await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('beegate0@512'));
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
 const span=await page.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');
  g.loop.stop();
  r.settings.reduceMotion='off';r.settings.worldDance=true;
  for(let x=18000;x<40000;x+=100){
   const s=r.terrain.bridgeSpanAt(x);
   if(s?.toId==='micro-mountain')return s;
  }
  return null;
 });
 assert.ok(span,'Expected generated bridge into Micro Mountain');
 const points=[-.04,.10,.20,.35,.60,.80,.90,1.04];
 const snapshots=[];
 for(const fraction of points){
  const result=await page.evaluate(({span,fraction})=>{
   const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled;
   const x=span.startX+(span.endX-span.startX)*fraction;
   r.streamTerrain(x);const angle=r.slopeAt(x);
   s.setPose(x,r.terrain.heightAt(x)-25,angle,0,0);
   s.invulnerableMs=600000;
   g.step(performance.now(),1000/60);
   const f=r.biomeFx;
   return {fraction,x:s.x,biome:r.terrain.biomeAtX(s.x),look:r._lookId,motif:r.bg.motif,veil:r._veil,fxVeil:f.veil,sunVisible:f.arcSun.visible,skyline:f.arcSkyline.visible,towers:f.arcTowers.filter(s=>s.visible).length,crashed:r.crashed,active:r.sys.isActive()};
  },{span,fraction});
  snapshots.push(result);
  assert.ok(result.active&&!result.crashed,'Run stopped at '+fraction);
  assert.equal(result.fxVeil,result.veil);
 }
 console.log('GENERATOR_OWNED_BRIDGE',JSON.stringify({span,snapshots}));
 assert.equal(snapshots[0].veil,0);
 assert.ok(snapshots[1].veil>0&&snapshots[1].veil<.6);
 assert.ok(snapshots[2].veil>.6&&snapshots[2].veil<1);
 assert.equal(snapshots[3].veil,1);
 assert.equal(snapshots[4].veil,1);
 assert.ok(snapshots[5].veil>.6&&snapshots[5].veil<1);
 assert.ok(snapshots[6].veil>0&&snapshots[6].veil<.6);
 assert.equal(snapshots[7].veil,0);
 assert.equal(snapshots[7].motif,'dew-drops');
 assert.equal(snapshots[7].towers,0);
 assert.equal(snapshots[7].sunVisible,false);
 assert.ok(snapshots.slice(2,6).some(s=>s.towers>0),'No real EQ response in actual bridge');
 // CPU/render submission comparison: no capture or readback, alternating
 // matched OFF/ON batches on the same actual bridge and held real band sample.
 const timings=await page.evaluate(({span})=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled;
  const x=(span.startX+span.endX)/2;
  r.streamTerrain(x);s.setPose(x,r.terrain.heightAt(x)-25,r.slopeAt(x),0,0);
  s.invulnerableMs=600000;g.step(performance.now(),1000/60);
  const f=r.biomeFx,cam=r.cameras.main,t=r.runTimeMs,veil=r._veil;
  const strength=r.worldDance.visualStrength,bands=[...r.worldDance.skylineBands];
  if(!bands.some(v=>v>.01))throw Error('No actual analyzer energy for render probe');
  const renderer=g.renderer;
  const render=(on)=>{
   r.bg.update(cam.scrollX,t,s.speed,on?strength:0);
   f.update(cam.scrollX,t,veil,false,on?bands:null);
   renderer.preRender();g.scene.render(renderer);renderer.postRender();
  };
  const batches=[];
  for(let i=0;i<4;i++){
   for(const on of i%2?[true,false]:[false,true]){
    for(let j=0;j<6;j++)render(on);
    const start=performance.now();
    for(let j=0;j<45;j++)render(on);
    // Wait for WebGL work to complete; not a full frame/presentation benchmark.
    renderer.gl?.finish();
    batches.push({on,msPerDraw:(performance.now()-start)/45});
   }
  }
  render(false);
  return {bands,batches,neutral:f.arcSkyline.visible&&f.arcTowers.every(v=>!v.visible)};
 },{span});
 assert.ok(timings.neutral);
 assert.ok(timings.batches.every(b=>Number.isFinite(b.msPerDraw)&&b.msPerDraw>0));
 console.log('SOFTWARE_RENDER_PROBE_NOT_CHROMEBOOK_FPS',JSON.stringify(timings));
 assert.deepEqual(errors,[]);
 console.log('WORLD_DANCE_GENERATED_BRIDGE_PASS');
}finally{await browser.close();}
