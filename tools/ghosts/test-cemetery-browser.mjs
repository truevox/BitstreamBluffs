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
  registry.set(REG.SETTINGS,{...save,cemeteryKeep:0});
  registry.set(REG.LAST_GHOST_TAPE,tape);
  // Actual GameOver capture policy, invoked on a non-scoring scene stub.
  GameOverScene.prototype._archiveCemeteryPose.call({registry,rec:{id:tape.runId,cause:'crash'}});
  return {offCount:(await course()).length,setting:registry.get(REG.SETTINGS).cemeteryKeep};
 },fixture);
 assert.equal(before.offCount,0,'OFF must never retain an attempt');
 const capture=await page.evaluate(async tape=>{
  const [{GameOverScene},{CemeteryArchive,CEMETERY_PER_COURSE},{REG}]=await Promise.all([
   import('/src/scenes/GameOverScene.js'),import('/src/systems/ghost/CemeteryArchive.js'),import('/src/constants.js')]);
  const scene=window.__bbGame.scene.getScenes()[0],registry=scene.registry,archive=new CemeteryArchive({perCourse:24});
  registry.set(REG.SETTINGS,{...registry.get(REG.SETTINGS),cemeteryKeep:24});
  GameOverScene.prototype._archiveCemeteryPose.call({registry,rec:{id:tape.runId,cause:'crash'}});
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
 assert(playback.rows===12&&playback.scrubbed>playback.atStart&&
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
 const settingsCheck=await page.evaluate(async()=>{
  const [{SettingsView},{CemeteryArchive},{REG}]=await Promise.all([
   import('/src/ui/Views.js'),import('/src/systems/ghost/CemeteryArchive.js'),import('/src/constants.js')]);
  const {scene,tape}=window.__cemQA;
  const archived=new CemeteryArchive({perCourse:24});
  const seed='qa-settings-adjustment';
  for(let i=0;i<8;i++){
   const added=await archived.add({...tape,seed,runId:'change-'+i});
   if(!added.ok)throw Error('Could not seed settings test '+JSON.stringify(added));
  }
  const view=new SettingsView(scene,scene.theme,{onClose:()=>{}}),item=view.menu.items.find(x=>x.label==='PAST ATTEMPTS');
  if(!item)throw Error('Player numeric/stepper row is missing');
  const initial=item.get(),choices=item.options.map(x=>x.value);
  // Real Settings action callback: lower 24->5 trims this separate history.
  item.set(5);
  let five=[];
  for(let i=0;i<60;i++){
   five=await archived.list(seed,tape.biomeMask);
   if(five.length===5)break;
   await new Promise(resolve=>setTimeout(resolve,40));
  }
  const reducedTo=five.map(r=>r.runId).sort();
  item.set(7); // raising the limit cannot restore evicted attempts
  const raisedExisting=(await archived.list(seed,tape.biomeMask)).length;
  const afterRaise=new CemeteryArchive({perCourse:7});
  for(let i=8;i<10;i++)await afterRaise.add({...tape,seed,runId:'change-'+i});
  const raisedSaved=(await afterRaise.list(seed,tape.biomeMask)).length;
  item.set(0);
  let zero=[];
  for(let i=0;i<60;i++){
   zero=await archived.list(seed,tape.biomeMask);
   if(zero.length===0)break;
   await new Promise(resolve=>setTimeout(resolve,40));
  }
  const disabled=await new CemeteryArchive({perCourse:0}).add({...tape,seed,runId:'disabled-new'});
  const zeroLabel=item.options[0].label,finalValue=item.get();
  view.destroy();
  return {initial,choices:choices.length,min:choices[0],max:choices.at(-1),reducedTo,
   raisedExisting,raisedSaved,zeroRemaining:zero.length,disabled,zeroLabel,finalValue};
 });
 assert(settingsCheck.initial===24&&settingsCheck.choices===25&&settingsCheck.min===0&&settingsCheck.max===24&&
  settingsCheck.reducedTo.join(',')==='change-3,change-4,change-5,change-6,change-7'&&
  settingsCheck.raisedExisting===5&&settingsCheck.raisedSaved===7&&settingsCheck.zeroRemaining===0&&
  settingsCheck.disabled.code==='disabled'&&settingsCheck.zeroLabel.includes('ERASE')&&settingsCheck.finalValue===0,
  JSON.stringify(settingsCheck));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
 const persisted=await page.evaluate(async()=>{
  const [{REG},{CemeteryArchive}]=await Promise.all([
   import('/src/constants.js'),import('/src/systems/ghost/CemeteryArchive.js')]);
  const g=window.__bbGame,s=g.registry.get(REG.SETTINGS);
  return {count:s.cemeteryKeep,traces:(await new CemeteryArchive().list('qa-settings-adjustment',7)).length};
 });
 assert.deepEqual(persisted,{count:0,traces:0});
 const storageStatus=await page.evaluate(async tape=>{
  const [{CemeteryView},{CEMETERY_CAPTURE_STATUS_KEY,CemeteryArchive}]=await Promise.all([
   import('/src/ui/CemeteryView.js'),import('/src/systems/ghost/CemeteryArchive.js')]);
  const scene=window.__bbGame.scene.getScenes()[0];
  scene.registry.set(CEMETERY_CAPTURE_STATUS_KEY,{runId:tape.runId,ok:false,code:'quota-exceeded'});
  const view=new CemeteryView(scene,scene.theme,{tape,archive:new CemeteryArchive(),onClose:()=>view.destroy()});
  for(let i=0;i<50&&!view._loaded;i++)await new Promise(resolve=>setTimeout(resolve,25));
  const quota=view.status.main.text;
  view.destroy();
  scene.registry.set(CEMETERY_CAPTURE_STATUS_KEY,{runId:tape.runId,ok:false,code:'storage-unavailable'});
  const unavailable=new CemeteryView(scene,scene.theme,{tape,archive:new CemeteryArchive(),onClose:()=>unavailable.destroy()});
  for(let i=0;i<50&&!unavailable._loaded;i++)await new Promise(resolve=>setTimeout(resolve,25));
  const noStorage=unavailable.status.main.text;
  unavailable.destroy();
  return {quota,noStorage};
 },fixture);
 assert(storageStatus.quota.includes('STORAGE LIMIT')&&storageStatus.noStorage.includes('STORAGE UNAVAILABLE'),JSON.stringify(storageStatus));
 assert.deepEqual(errors,[]);
 assert.deepEqual(mutations,[]);
 console.log('PASS_CEMETERY_REAL_CHROMIUM',JSON.stringify({before,capture,opened,playback,clearing,settingsCheck,persisted,storageStatus,
  errors,mutations,fixture:'historical taped poses copied with synthetic QA IDs; no human performance claim',
  noUpload:true,verifiedRanked:false}));
 await ctx.close();
}finally{await browser.close();}
