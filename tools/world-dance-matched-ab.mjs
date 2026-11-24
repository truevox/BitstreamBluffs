/** Capture paired frames from one real rendered game state and live original
 * soundtrack. The OFF arm redraws only presentation at zero dance, then
 * restores it before the next actual game step. No second audio transport,
 * no synthetic FFT/beat data, no source audio in output.
 * Run on loopback with a complete public catalog; output stays local. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://127.0.0.1:8220/';
assert.equal(new URL(url).hostname,'127.0.0.1','Loopback only');
const out=process.env.REPORT_OUT;
assert.ok(out,'Set REPORT_OUT to a new local directory');
mkdirSync(out,{recursive:false});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:960,height:600},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?._stemMusic?.ready&&window.__bbGame.scene.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 await page.keyboard.press('x');
 await page.waitForFunction(()=>{const d=window.__bbGame.registry.get('audioSynth')._stemMusic;return d.started&&d.pack&&d.activeNodes.size>=6&&!d._loading;},null,{timeout:35000});
 await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('world-dance-ogg'));
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
 // Stop the automatic loop only for paired capture. Advance the actual
 // gameplay with normal Game.step and realistic bounded deltas.
 await page.evaluate(()=>{const g=window.__bbGame;g.loop.stop();});
 const frames=[];
 const started=Date.now();
 for(let i=0;i<96;i++){
  const pair=await page.evaluate(()=>{
   const g=window.__bbGame,r=g.scene.getScene('RunScene'),a=g.registry.get('audioSynth'),d=a._stemMusic;
   if(!r?.sys.isActive()||r.crashed)return null;
   const renderer=g.renderer,canvas=g.canvas;
   g.step(performance.now(),1000/24);
   if(!r.sys.isActive()||r.crashed)return null;
   const p=r.worldDance.visualStrength,cam=r.cameras.main,t=r.runTimeMs,speed=r.sled.speed,veil=r._veil||0;
   const sample=a.getWorldDanceSample(),meter=a.getSyntheticMeterTiming();
   const before={x:r.sled.x,y:r.sled.y,runTime:r.runTimeMs,clock:d.clockStart,token:d._token,zoom:cam.zoom,scroll:cam.scrollX,track:d.track.id,skin:r.bg.skin,nearY:r.biomeFx.ridgeNear?.y};
   const pairCanvas=document.createElement('canvas');pairCanvas.width=canvas.width*2;pairCanvas.height=canvas.height;
   const c=pairCanvas.getContext('2d');
   c.drawImage(canvas,canvas.width,0);
   const render=()=>{renderer.preRender();g.scene.render(renderer);renderer.postRender();};
   // Identical world/camera/time, only the dance geometry changes.
   r.bg.update(cam.scrollX,t,speed,0);r.biomeFx.update(cam.scrollX,t,veil,false);
   render();c.drawImage(canvas,0,0);
   r.bg.update(cam.scrollX,t,speed,p);r.biomeFx.update(cam.scrollX,t,veil,false);
   render();
   const after={x:r.sled.x,y:r.sled.y,runTime:r.runTimeMs,clock:d.clockStart,token:d._token,zoom:cam.zoom,scroll:cam.scrollX,track:d.track.id,skin:r.bg.skin,nearY:r.biomeFx.ridgeNear?.y};
   return {png:pairCanvas.toDataURL('image/png').split(',')[1],before,after,p,sample,meter,audioTime:d.ctx.currentTime,width:canvas.width,height:canvas.height};
  });
  if(!pair)break;
  assert.deepEqual(pair.before,pair.after,'Paired presentation draw changed matched world or transport');
  const {png,...meta}=pair;
  const filename=String(i).padStart(3,'0')+'.png';
  writeFileSync(join(out,filename),Buffer.from(png,'base64'),{flag:'wx'});
  frames.push({filename,wallMs:Date.now()-started,...meta});
  await page.waitForTimeout(20);
 }
 assert.ok(frames.length>=24,'Not enough live matched pairs');
 assert.ok(frames.filter(f=>f.sample).length>=24,'Original analyzer unavailable');
 assert.ok(frames.some(f=>f.p>.1),'No measurable dance');
 assert.ok(frames.some(f=>f.before.nearY<=88),'Near ridge never reaches readable displacement');
 assert.deepEqual(errors,[]);
 const report={format:'world-dance-matched-pairs-v1',mode:'controlled stepped live gameplay, same-frame redraw, silent',frames};
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
 console.log('MATCHED_REAL_GAME_AB_CAPTURE_PASS',JSON.stringify({frames:frames.length,first:frames[0].before,last:frames.at(-1).before,peak:Math.max(...frames.map(f=>f.p)),native:[frames[0].width,frames[0].height],audioSpan:frames.at(-1).audioTime-frames[0].audioTime,errors}));
}finally{await browser.close();}
