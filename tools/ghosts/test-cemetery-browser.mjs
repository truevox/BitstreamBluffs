/** #68 actual Phaser/Chromium local-only acceptance; fixture traces are labeled
 * synthetic test copies of a real stored tape, not new human performances.
 * Start Vite separately; GAME_URL required. No server writes or uploads.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
const url=process.env.GAME_URL;
if(!url)throw Error('GAME_URL required');
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/replay/v1/legacy-tape.json','utf8'));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
const errors=[],mutations=[];
try{
 const ctx=await browser.newContext({viewport:{width:960,height:540}});
 const page=await ctx.newPage();
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))mutations.push(r.method()+':'+r.url());});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScenes()?.[0]?.theme?.bind,{timeout:30000});
 const before=await page.evaluate(async tape=>{
  const [{GameOverScene},{CemeteryArchive},{REG}]=await Promise.all([
   import('/src/scenes/GameOverScene.js'),import('/src/systems/ghost/CemeteryArchive.js'),import('/src/constants.js')]);
  const scene=window.__bbGame.scene.getScenes()[0],registry=scene.registry;
  const save=registry.get(REG.SETTINGS)||{};
  window.__cemBaselineSettings=save;
  const archive=new CemeteryArchive(),course=()=>archive.list(tape.seed,tape.biomeMask);
  registry.set(REG.SETTINGS,{...save,cemeteryMontage:false});
  registry.set(REG.LAST_GHOST_TAPE,tape);
  // Actual GameOver capture policy, invoked on a non-scoring scene stub.
  GameOverScene.prototype._archiveCemeteryPose.call({registry,rec:{id:tape.runId}});
  return {offCount:(await course()).length,setting:registry.get(REG.SETTINGS).cemeteryMontage};
 },fixture);
 assert.equal(before.offCount,0,'OFF must never retain an attempt');
 const capture=await page.evaluate(async tape=>{
  const [{GameOverScene},{CemeteryArchive,CEMETERY_PER_COURSE},{REG}]=await Promise.all([
   import('/src/scenes/GameOverScene.js'),import('/src/systems/ghost/CemeteryArchive.js'),import('/src/constants.js')]);
  const scene=window.__bbGame.scene.getScenes()[0],registry=scene.registry,archive=new CemeteryArchive();
  registry.set(REG.SETTINGS,{...registry.get(REG.SETTINGS),cemeteryMontage:true});
  GameOverScene.prototype._archiveCemeteryPose.call({registry,rec:{id:tape.runId}});
  let first=[];
  for(let i=0;i<25;i++){
   first=await archive.list(tape.seed,tape.biomeMask);
   if(first.length)break;
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  if(first.length!==1)throw Error('GameOver did not capture opt-in actual tape '+first.length);
  for(let i=1;i<27;i++){
   const result=await archive.add({...tape,runId:`qa-cemetery-${String(i).padStart(3,'0')}`,distanceM:i*10});
   if(!result.ok)throw Error('fixture pose storage failed '+JSON.stringify(result));
  }
  const rows=await archive.list(tape.seed,tape.biomeMask);
  const other=await archive.list(tape.seed,tape.biomeMask+1);
  window.__cemQA={scene,archive,tape};
  return {first:!!first[0]?.trace,count:rows.length,limit:CEMETERY_PER_COURSE,
   sameCourse:rows.every(r=>r.seed===tape.seed&&r.biomeMask===tape.biomeMask),
   proofFieldsAbsent:rows.every(r=>!r.inputs&&!r.checkpoints&&!r.random&&!r.score),
   lastRunPresent:rows.some(r=>r.runId==='qa-cemetery-026'),oldestRemoved:!rows.some(r=>r.runId===tape.runId),
   otherCourse:other.length};
 },fixture);
 assert(capture.first&&capture.count===24&&capture.sameCourse&&capture.proofFieldsAbsent&&
  capture.lastRunPresent&&capture.oldestRemoved&&capture.otherCourse===0,JSON.stringify(capture));
 const opened=await page.evaluate(async()=>{
  const [{GhostFavoritesView},{CemeteryView},{REG}]=await Promise.all([
   import('/src/ui/GhostFavoritesView.js'),import('/src/ui/CemeteryView.js'),import('/src/constants.js')]);
  const {scene,archive,tape}=window.__cemQA;
  const library=scene.registry.get(REG.GHOSTS);
  let ghostView,view;
  const open=()=>{ghostView?.destroy();view=new CemeteryView(scene,scene.theme,{tape,archive,onClose:()=>{view.destroy();}});};
  ghostView=new GhostFavoritesView(scene,scene.theme,{library,tape,onClose:()=>ghostView.destroy(),onEvidence:()=>{},onCemetery:open});
  window.__cemQA.ghostView=ghostView;
  const n=ghostView.rows.length;
  ghostView.focus=n-1;
  ghostView.handleAction('down');const share=ghostView.focus===n;
  ghostView.handleAction('down');const evidence=ghostView.focus===n+1;
  ghostView.handleAction('down');const cemetery=ghostView.focus===n+2;
  const noOverlap=ghostView.archiveButton.x+ghostView.archiveButton.w<ghostView.cemeteryButton.x&&
   ghostView.cemeteryButton.x+ghostView.cemeteryButton.w<ghostView.shareBtn.x;
  ghostView._shareArmed=true;ghostView._shareLink='prepared-secret';
  ghostView.handleAction('confirm');
  window.__cemQA.view=view;
  return {share,evidence,cemetery,noOverlap,viewOpened:view instanceof CemeteryView,
   preparedLinkGone:ghostView._shareLink===null&&!ghostView._shareArmed};
 });
 assert(Object.values(opened).every(Boolean),JSON.stringify(opened));
 await page.waitForFunction(()=>window.__cemQA.view?._loaded===true,{timeout:15000});
 const playback=await page.evaluate(()=>{
  const {view,scene}=window.__cemQA;
  const n=view.entries.length,atStart=view.tick;
  view.handleAction('right');
  const scrubbed=view.tick;
  scene.registry.set('settings',{...scene.registry.get('settings'),reduceMotion:'on'});
  view.togglePlay();
  const reduced={playing:view.playing,label:view.playBtn.label.main.text};
  view._update(500);
  const afterReduced=view.tick;
  view.destroy();
  return {rows:n,atStart,scrubbed,reduced,afterReduced,disposed:!view.alive};
 });
 assert(playback.rows===24&&playback.scrubbed>playback.atStart&&
  playback.reduced.playing===false&&playback.reduced.label==='SCRUB'&&
  playback.afterReduced===playback.scrubbed&&playback.disposed,JSON.stringify(playback));
 const clearing=await page.evaluate(async()=>{
  const {scene,archive,tape}=window.__cemQA;
  const {CemeteryView}=await import('/src/ui/CemeteryView.js');
  const view=new CemeteryView(scene,scene.theme,{tape,archive,onClose:()=>view.destroy()});
  for(let i=0;i<40&&!view._loaded;i++)await new Promise(resolve=>setTimeout(resolve,25));
  if(!view._loaded)throw Error('Cemetery did not load before explicit clear');
  view.handleAction('down'); // keyboard focus CLEAR
  view.handleAction('confirm'); // first press only arms; must not delete
  const before=await archive.list(tape.seed,tape.biomeMask);
  const armed=view.clearBtn.label.main.text;
  view.handleAction('confirm'); // second press within bounded 4s clears just this course
  for(let i=0;i<40&&view._clearing;i++)await new Promise(resolve=>setTimeout(resolve,25));
  const after=await archive.list(tape.seed,tape.biomeMask);
  const status=view.status.main.text;
  const controlsDisabled=view.playBtn.disabled&&view.clearBtn.disabled;
  view.destroy();
  return {before:before.length,armed,after:after.length,status,controlsDisabled};
 });
 assert(clearing.before===24&&clearing.armed==='CONFIRM?'&&clearing.after===0&&
  clearing.status.includes('CLEARED')&&clearing.controlsDisabled,JSON.stringify(clearing));
 assert.deepEqual(errors,[]);
 assert.deepEqual(mutations,[]);
 console.log('PASS_CEMETERY_REAL_CHROMIUM',JSON.stringify({before,capture,opened,playback,clearing,
  errors,mutations,fixture:'historical taped poses copied with synthetic QA IDs; no human performance claim',
  noUpload:true,verifiedRanked:false}));
 await ctx.close();
}finally{await browser.close();}
