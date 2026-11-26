/** #56: real two-tab Chromium IndexedDB course-capacity + explicit delete. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL;
if(!url)throw Error('GAME_URL required');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const context=await browser.newContext();
 const a=await context.newPage(),b=await context.newPage(),errors=[],writes=[];
 for(const page of [a,b]){
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push({method:r.method(),url:r.url()});});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:35000});
  await page.evaluate(async()=>{
   const {GhostLibrary}=await import('/src/systems/ghost/GhostLibrary.js');
   const lib=new GhostLibrary();await lib.init();lib.setArchiveLimit(8);
   globalThis.__archiveLib=lib;
  });
 }
 const prefix=await a.evaluate(async()=>{
  const lib=globalThis.__archiveLib;
  const tape=(i)=>({runId:'archive-id-'+i,seed:'archive-course-'+i,biomeMask:3,
   mode:'normal',simRevision:9,distanceM:100+i,endedAt:100+i,
   trace:'AAAAAAAAAAAAAAAA',inputs:[[1,0,0]],endTick:1});
  for(let i=0;i<7;i++)if(!await lib.saveRun(tape(i)))throw Error('could not fill course '+i);
  await lib.setFavorite('archive-course-0',3,0,'archive-id-0');
  const c=lib.course('archive-course-0',3);
  return {saved:lib.courses.size,favorite:c.favorites[0],status:lib.archiveStatus()};
 });
 assert.equal(prefix.saved,7);assert.equal(prefix.favorite,'archive-id-0');
 // Refresh page B so its own IDB map sees tab A's seven courses.
 await b.evaluate(async()=>{await globalThis.__archiveLib.listArchiveCourses();});
 const race=await Promise.all([a,b].map((p,i)=>p.evaluate(async i=>{
  const lib=globalThis.__archiveLib;
  const tape={runId:'archive-race-id-'+i,seed:'archive-race-'+i,biomeMask:3,
   mode:'normal',simRevision:9,distanceM:100,endedAt:100,trace:'AAAA',inputs:[[1,0,0]],endTick:1};
  const success=!!await lib.saveRun(tape);
  return {success,lastFailure:lib.lastArchiveFailure,used:lib.courses.size};
 },i)));
 assert.equal(race.filter(x=>x.success).length,1,'two tabs raced last course slot');
 const after=await a.evaluate(async()=>{
  const lib=globalThis.__archiveLib;
  const all=await lib.listArchiveCourses();
  const extra=await lib.saveRun({runId:'archive-denied',seed:'archive-ninth',biomeMask:3,
   mode:'normal',simRevision:9,distanceM:100,endedAt:100,trace:'AAAA',inputs:[[1,0,0]],endTick:1});
  const same=await lib.saveRun({runId:'archive-new-same',seed:'archive-course-0',biomeMask:3,
   mode:'normal',simRevision:9,distanceM:200,endedAt:200,trace:'AAAA',inputs:[[1,0,0]],endTick:1});
  const old=await lib.getTape('archive-id-0');
  return {count:all.length,extra:!!extra,same:!!same,old:!!old,favorite:lib.course('archive-course-0',3).favorites[0],failure:lib.lastArchiveFailure};
 });
 assert.equal(after.count,8);assert.equal(after.extra,false);assert.equal(after.same,true);
 assert.equal(after.old,true);assert.equal(after.favorite,'archive-id-0');
 const upgrade=await a.evaluate(async()=>{
  const lib=globalThis.__archiveLib;
  const {ProfileStore}=await import('/src/systems/ProfileStore.js');
  const {archiveCapacity}=await import('/src/systems/ghost/CourseArchiveCapacity.js');
  const store=new ProfileStore();store.load();
  if(!store.archiveLegacyInitialized)store.ensureCourseArchiveLegacy(8);
  store.save({...store.profile,bank:100});
  const tx=store.buyCourseArchiveSlot();
  if(!tx.ok)throw Error('purchase did not persist');
  lib.setArchiveLimit(archiveCapacity(tx.profile));
  const tape={runId:'archive-now-permitted',seed:'archive-ninth',biomeMask:3,mode:'normal',simRevision:9,
   distanceM:100,endedAt:100,trace:'AAAA',inputs:[[1,0,0]],endTick:1};
  const saved=await lib.saveRun(tape);
  const reopened=new ProfileStore();reopened.load();
  return {bought:tx.ok,persisted:reopened.profile.courseArchive.purchased,
   bank:reopened.profile.bank,slots:archiveCapacity(reopened.profile),saved:!!saved,count:(await lib.listArchiveCourses()).length};
 });
 assert.deepEqual(upgrade,{bought:true,persisted:1,bank:60,slots:9,saved:true,count:9});
 const deleted=await a.evaluate(async()=>{
  const lib=globalThis.__archiveLib;
  const initial=await lib.getTape('archive-id-1');
  const removed=await lib.deleteArchiveCourse('archive-course-1|00000003');
  const left=await lib.getTape('archive-id-1');
  return {initial:!!initial,removed,left:!!left,used:(await lib.listArchiveCourses()).length,
   otherFavorite:lib.course('archive-course-0',3).favorites[0]};
 });
 assert.deepEqual(deleted,{initial:true,removed:true,left:false,used:8,otherFavorite:'archive-id-0'});
 // Real browser scene/UI: the Shop permanent-upgrades page exposes the slot
 // purchase and manager; deletion is impossible until a separate CONFIRM row
 // is explicitly selected. The reader is the active game's own library.
 const ui=await a.evaluate(async()=>{
  const [{ShopView},{REG},{archiveCapacity}]=await Promise.all([
   import('/src/ui/Views.js'),import('/src/constants.js'),import('/src/systems/ghost/CourseArchiveCapacity.js')]);
  const game=window.__bbGame,scene=game.scene.getScene('TitleScene');
  const service=game.registry.get(REG.PROGRESSION);
  service.store.load();game.registry.set(REG.PROFILE,service.store.profile);
  const lib=game.registry.get(REG.GHOSTS);
  lib.setArchiveLimit(archiveCapacity(service.store.profile));
  const view=new ShopView(scene,scene.theme,{onClose:()=>{}});
  view._showUpgrades();
  const purchaseRow=view._layout.rows.find(r=>r.kind==='archiveBuy');
  if(!purchaseRow)throw Error('course archive purchase missing from Shop');
  await view._openArchiveManager();
  const beforeRows=view._layout.rows;
  const first=beforeRows.find(r=>r.kind==='archiveEntry');
  if(!first)throw Error('archived courses not listed');
  const noDeleteBeforeSelection=!beforeRows.some(r=>r.kind==='archiveConfirm');
  const target='archive-course-3|00000003';
  view._selectArchive(target);
  const distinctConfirm=view._layout.rows.some(r=>r.kind==='archiveConfirm'&&r.archiveKey===target);
  const before=(await lib.listArchiveCourses()).length;
  await view._deleteSelectedArchive();
  const after=(await lib.listArchiveCourses()).length;
  const status=view.archiveNotice;
  view.destroy();
  return {purchaseLabel:purchaseRow.label,purchaseState:purchaseRow.state,
   noDeleteBeforeSelection,distinctConfirm,before,after,status};
 });
 assert.equal(ui.noDeleteBeforeSelection,true);
 assert.equal(ui.distinctConfirm,true);
 assert.equal(ui.after,ui.before-1);
 assert.ok(ui.status.startsWith('ARCHIVE DELETED'),JSON.stringify(ui));
 assert.equal(errors.length,0,`page errors: ${errors.join(';')}`);
 assert.equal(writes.length,0,`unexpected network writes: ${JSON.stringify(writes)}`);
 console.log('PASS_REAL_COURSE_ARCHIVE_TWO_TAB',JSON.stringify({prefix,race,after,upgrade,deleted,ui,errors,writes}));
} finally {await browser.close();}
