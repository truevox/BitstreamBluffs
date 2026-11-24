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
  pixelSun:r?.bg?.__danceProbe?.pixelSun||null,skin:r?.bg?.skin,
  nearRidgeY:r?.biomeFx?.ridgeNear?.y,farRidgeY:r?.biomeFx?.ridgeFar?.y,
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
  if(!['playing','loading'].includes(a.jukeboxSnapshot().state)&&!d.started&&!d.transportPaused){
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
  b.__danceProbe={ellipse:0,lastEllipse:null,circle:0,pixelSun:null};
  const update=b.update,fill=g.fillRect.bind(g);
  let measuring=false,stripes=[];
  g.fillRect=(...args)=>{if(measuring&&stripes.length<9&&args[2]>=24&&args[2]<=120&&args[3]>0&&args[3]<=12)stripes.push(args);return fill(...args);};
  b.update=function(...args){stripes=[];measuring=this.skin==='pixel';try{return update.apply(this,args);}finally{measuring=false;if(stripes.length===9)b.__danceProbe.pixelSun={width:Math.max(...stripes.map(s=>s[2])),height:stripes.at(-1)[1]+stripes.at(-1)[3]-stripes[0][1]};}};
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
 const pixel=valid.filter(s=>s.skin==='pixel'&&s.pixelSun);
 const ridge=valid.filter(s=>Number.isFinite(s.nearRidgeY));
 console.log('ACTUAL_RENDER_GEOMETRY',JSON.stringify({pixelWidths:[...new Set(pixel.map(s=>s.pixelSun.width))],pixelHeights:[...new Set(pixel.map(s=>s.pixelSun.height))],nearRidgeYs:[...new Set(ridge.map(s=>s.nearRidgeY))],ellipses:valid.at(-1)?.drewEllipse}));
 assert.ok(valid.at(-1)?.drewEllipse>20||new Set(pixel.map(s=>s.pixelSun.width)).size>=2||new Set(pixel.map(s=>s.pixelSun.height)).size>=2,'No actual sun geometry response');
 if(pixel.length>20)assert.ok(new Set(ridge.map(s=>s.nearRidgeY)).size>=2,'Pixel ridge never moved');
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
 // The game's persisted setting is a three-way string, NOT a boolean.
 // Explicit ON must defeat a no-reduce OS; explicit OFF must override an
 // OS reduction request, just like the new menu/title animation does.
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{
  const g=window.__bbGame;
  g.registry.get('settings').reduceMotion='on';
  g.registry.get('settings').worldDance=true;
 });
 await page.waitForTimeout(160);
 const forcedReduced=await snap();
 assert.equal(forcedReduced.strength,0);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>window.__bbGame.registry.get('settings').reduceMotion='off');
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.worldDance?.strength>0.03,null,{timeout:6500});
 const forceAllowed=await snap();
 assert.ok(forceAllowed.strength>0.03);
 await page.evaluate(()=>window.__bbGame.registry.get('settings').worldDance=false);
 await page.waitForTimeout(160);
 const disabled=await snap();
 assert.equal(disabled.strength,0);
 console.log('MUTE_REDUCED_MOTION_OVERRIDE_AND_OFF_SWITCH_GATES_PASS',
  JSON.stringify({muted,reduced,forcedReduced,forceAllowed,disabled}));
 assert.deepEqual(errors,[]);
 console.log('WORLD_DANCE_REAL_OGG_BROWSER_PASS');
}finally{await browser.close()}
