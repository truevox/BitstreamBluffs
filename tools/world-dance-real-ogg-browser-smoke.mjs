/** Issue #33 — original-OGG, real-Chromium world dance gate.
 * No artificial beat clock, forced sample, synthetic FFT, or saved profile edits.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
 '--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const url=process.env.GAME_URL||'http://127.0.0.1:8283/';
const snap=()=>page.evaluate(()=>{
 const g=window.__bbGame,a=g.registry.get('audioSynth'),r=g.scene.getScene('RunScene'),d=a?._stemMusic;
 return {sample:a?.getWorldDanceSample?.()||null,pulse:r?.worldDance?.pulse||0,
  intensity:r?.worldDance?.intensity||0,strength:r?.worldDance?.strength||0,
  drewEllipse:r?.bg?.__danceProbe?.ellipse||0,
  lastEllipse:r?.bg?.__danceProbe?.lastEllipse||null,
  runActive:r?.sys?.isActive(),musicStarted:d?.started,stemNodes:d?.activeNodes?.size,
  trackId:d?.track?.id,musicTimeMs:(a?.ctx?.currentTime||0)*1000,
  sceneMotion:r?.settings?.reduceMotion};
});
try{
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 await page.keyboard.press('x');
 await page.waitForFunction(()=>{
  const a=window.__bbGame.registry.get('audioSynth');
  return a?._stemMusic?.ready&&a.ctx?.state==='running';
 },null,{timeout:30000});
 await page.evaluate(()=>{
  const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
  if(!d.started&&!d.transportPaused){
   const btn=g.scene.getScene('TitleScene').jukebox?.buttons?.[1]?.zone;
   if(!btn)throw Error('Missing jukebox play button');
   btn.emit('pointerdown');
  }
 });
 await page.waitForFunction(()=>{
  const a=window.__bbGame.registry.get('audioSynth');
  return a?._stemMusic?.started&&a._stemMusic?.activeNodes?.size>=6&&
   a._stemMusic.pack&&!a._stemMusic._loading;
 },null,{timeout:45000});
 await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('world-dance-ogg'));
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.sys?.isActive(),null,{timeout:20000});
 const initial=await snap();assert.equal(initial.runActive,true);assert.ok(initial.trackId);
 await page.evaluate(()=>{
  const b=window.__bbGame.scene.getScene('RunScene').bg,g=b.gfx;
  b.__danceProbe={ellipse:0,lastEllipse:null,circle:0};
  const ellipse=g.strokeEllipse.bind(g),circle=g.strokeCircle.bind(g);
  g.strokeEllipse=(...args)=>{
   b.__danceProbe.ellipse++;b.__danceProbe.lastEllipse=args;
   return ellipse(...args);
  };
  g.strokeCircle=(...args)=>{b.__danceProbe.circle++;return circle(...args);};
 });
 const samples=[];
 for(let i=0;i<115;i++){
  await page.waitForTimeout(65);
  samples.push(await snap());
 }
 const valid=samples.filter(s=>s.sample);
 const pulses=valid.filter(s=>s.pulse>0.02);
 const peak=Math.max(...valid.map(s=>s.strength));
 const minIntensity=Math.min(...valid.map(s=>s.intensity));
 const maxIntensity=Math.max(...valid.map(s=>s.intensity));
 const bassRange=[Math.min(...valid.map(s=>s.sample.bass)),Math.max(...valid.map(s=>s.sample.bass))];
 const midRange=[Math.min(...valid.map(s=>s.sample.mid)),Math.max(...valid.map(s=>s.sample.mid))];
 console.log('REAL_OGG_MUSICAL_REACTIVITY',JSON.stringify({n:valid.length,pulses:pulses.length,peak,
  minIntensity,maxIntensity,bassRange,midRange,trackId:initial.trackId,
  ellipses:valid.at(-1)?.drewEllipse,lastEllipse:valid.at(-1)?.lastEllipse,
  sample:valid.slice(0,5)}));
 assert.ok(valid.length>65,'Music sampler did not receive a sustained real OGG track');
 assert.ok(bassRange[1]>bassRange[0]||midRange[1]>midRange[0],'Analyser signal did not vary');
 assert.ok(peak>0.04,'World never responded to real music accents');
 assert.ok(valid.at(-1)?.drewEllipse>20,'Real rendered graphics never squashed the sun');
 assert.ok(maxIntensity>minIntensity+.02,'World intensity did not follow the recording');
 await page.evaluate(()=>{
  const a=window.__bbGame.registry.get('audioSynth');
  a.settings.musicVolume=0;
 });
 await page.waitForTimeout(160);
 const muted=await snap();
 assert.equal(muted.sample,null);assert.equal(muted.strength,0);
 await page.evaluate(()=>{
  window.__bbGame.registry.get('audioSynth').settings.musicVolume=.6;
 });
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForTimeout(220);
 const reduced=await page.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene'),a=g.registry.get('audioSynth');
  return {reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
    cachedQuery:r._worldDanceMotionQuery?.matches,
    sample:a.getWorldDanceSample()!=null,strength:r.worldDance.strength};
 });
 assert.equal(reduced.reduced,true);
 assert.equal(reduced.cachedQuery,true);
 assert.equal(reduced.strength,0);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>window.__bbGame.scene.getScene('RunScene').settings.worldDance=false);
 await page.waitForTimeout(160);
 const disabled=await snap();
 assert.equal(disabled.strength,0);
 console.log('MUTE_OS_REDUCED_MOTION_AND_IN_GAME_OFF_GATES_PASS',JSON.stringify({muted,reduced,disabled}));
 assert.deepEqual(errors,[]);
 console.log('WORLD_DANCE_REAL_OGG_BROWSER_PASS');
}finally{await browser.close()}
