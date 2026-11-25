/** #56: real Chromium IndexedDB fail-closed course isolation acceptance. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const origin=process.env.GAME_URL;
if(!origin)throw Error('GAME_URL required');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const context=await browser.newContext(),pages=[await context.newPage(),await context.newPage()],errors=[],writes=[];
 for(const p of pages){p.on('pageerror',e=>errors.push(String(e)));p.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push({method:r.method(),url:r.url()});});await p.goto(origin,{waitUntil:'domcontentloaded'});}
 const create=await pages[0].evaluate(async()=>{
  const [{GhostLibrary},{GHOST_TAPE_FORMAT,GHOST_TAPE_VERSION,GHOST_PHYSICS_VERSION},{SIM_TICK_HZ},{SIM_REVISION}]=await Promise.all([
   import('/src/systems/ghost/GhostLibrary.js'),import('/src/systems/ghost/GhostTape.js'),import('/src/systems/SimClock.js'),import('/src/systems/replay/ruleset.js')]);
  const tape=(runId,seed,biomeMask,distanceM)=>({format:GHOST_TAPE_FORMAT,version:GHOST_TAPE_VERSION,physicsVersion:GHOST_PHYSICS_VERSION,simTickHz:SIM_TICK_HZ,simRevision:SIM_REVISION,
   runId,seed,biomeMask,distanceM,mode:'normal',endedAt:42,trace:'AAAAAAAAAAAAAAAA',inputs:[[1,0,0]],endTick:1});
  const store=new GhostLibrary();await store.init();
  const a=tape('ghost-local-A','exact-seed-A',7,13),b=tape('ghost-foreign-B','exact-seed-B',7,99),c=tape('ghost-foreign-C','exact-seed-A',8,105);
  for(const entry of [a,b,c]){const saved=await store.saveRun(entry);if(!saved)throw Error('cannot save fixture '+entry.runId);}
  const noForeignSeed=await store.setFavorite('exact-seed-A',7,0,b.runId);
  const noForeignMask=await store.setFavorite('exact-seed-A',7,1,c.runId);
  const yes=await store.setFavorite('exact-seed-A',7,2,a.runId);
  const wrongToggle=await store.setShow('exact-seed-A',7,'fav3',false);
  const legitimate=await store.ghostsFor('exact-seed-A',7,{}, {simRevision:SIM_REVISION});
  return {rejectedSeed:noForeignSeed===null,rejectedMask:noForeignMask===null,acceptedSame:!!yes,
   wrongToggle:wrongToggle===null,visible:legitimate.map(x=>x.runId),roles:store.course('exact-seed-A',7).favorites,
   tapeCount:store.tapes.size};
 });
 assert.deepEqual(create.visible,['ghost-local-A']);
 assert.equal(create.rejectedSeed,true);assert.equal(create.rejectedMask,true);assert.equal(create.acceptedSame,true);assert.equal(create.wrongToggle,true);
 const restart=await pages[1].evaluate(async()=>{
  const [{GhostLibrary},{readGhostCourseRows},{SIM_REVISION}]=await Promise.all([
   import('/src/systems/ghost/GhostLibrary.js'),import('/src/ui/ghost-course-rows.js'),import('/src/systems/replay/ruleset.js')]);
  const lib=new GhostLibrary();await lib.init();
  const a=lib.course('exact-seed-A',7),b=lib.course('exact-seed-B',7),c=lib.course('exact-seed-A',8);
  if(!a||!b||!c)throw Error('expected persisted courses missing');
  const originalRoles=[...a.favorites];
  // Corrupt the PERSISTED course role, not just the cache, to prove the
  // authoritative IDB reader still filters a foreign ghost.
  await new Promise((resolve,reject)=>{
    const tx=lib._db.transaction('courses','readwrite');
    tx.objectStore('courses').put({...a,favorites:[b.latest,...a.favorites.slice(1)]});
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
  });
  const out=await lib.ghostsFor('exact-seed-A',7,{}, {simRevision:SIM_REVISION});
  const rows=await readGhostCourseRows(lib,{runId:a.latest,seed:a.seed,biomeMask:a.biomeMask});
  // Do not persist the deliberately corrupted in-memory fixture.
  return {originalRoles,visible:out.map(x=>x.runId),foreignRow:rows[2],courseCount:lib.courses.size};
 });
 assert.deepEqual(restart.visible,['ghost-local-A']);
 assert.equal(restart.foreignRow.info,'OTHER COURSE');
 assert.deepEqual(restart.originalRoles,[null,null,'ghost-local-A']);
 // Reproduce the exact same-tab and cross-tab lost-update races found in code
 // review, now under REAL IndexedDB's serializable readwrite transactions.
 const raceSetups=await Promise.all(pages.map(p=>p.evaluate(async()=>{
   const {GhostLibrary}=await import('/src/systems/ghost/GhostLibrary.js');
   const lib=new GhostLibrary();await lib.init();globalThis.__ghostRaceLibrary=lib;
   return lib.backend;
 })));
 assert.deepEqual(raceSetups,['idb','idb']);
 const collision=await Promise.all(pages.map((p,i)=>p.evaluate(async i=>{
   const lib=globalThis.__ghostRaceLibrary;
   const result=await lib.saveRun({runId:'race-same-id',seed:i?'race-seed-B':'race-seed-A',biomeMask:i,
     mode:'normal',simRevision:9,distanceM:20+i,endedAt:1});
   return result?.key || null;
 },i)));
 assert.equal(collision.filter(Boolean).length,1,'only one course may claim a shared global run ID');
 const collisionDisk=await pages[0].evaluate(async()=>{
   const {GhostLibrary}=await import('/src/systems/ghost/GhostLibrary.js');
   const lib=new GhostLibrary();await lib.init();
   const tape=await lib.getTape('race-same-id');
   return {courseKey:tape?.seed,seedA:!!lib.course('race-seed-A',0),seedB:!!lib.course('race-seed-B',1)};
 });
 assert.equal(collisionDisk.courseKey,collision[0]?'race-seed-A':'race-seed-B');
 assert.equal(Number(collisionDisk.seedA)+Number(collisionDisk.seedB),1);
 // Race a pin against an incoming Latest that previously overwrote the old
 // role array and deleted the pinned tape from the authoritative DB.
 await pages[0].evaluate(async()=>{
   const {GhostLibrary}=await import('/src/systems/ghost/GhostLibrary.js');
   const lib=new GhostLibrary();await lib.init();
   const tape=(runId,distanceM)=>({runId,seed:'race-favorites',biomeMask:0,mode:'normal',simRevision:9,distanceM,endedAt:1});
   await lib.saveRun(tape('race-best',100));
   await lib.saveRun(tape('race-prior-latest',20));
 });
 await Promise.all(pages.map(p=>p.evaluate(async()=>{
   const {GhostLibrary}=await import('/src/systems/ghost/GhostLibrary.js');
   const lib=new GhostLibrary();await lib.init();globalThis.__ghostRaceLibrary=lib;
 })));
 const outcomes=await Promise.all([
   pages[0].evaluate(async()=>Boolean(await globalThis.__ghostRaceLibrary.setFavorite('race-favorites',0,0,'race-prior-latest'))),
   pages[1].evaluate(async()=>Boolean(await globalThis.__ghostRaceLibrary.saveRun({runId:'race-next',seed:'race-favorites',biomeMask:0,mode:'normal',simRevision:9,distanceM:30,endedAt:2}))),
 ]);
 assert.deepEqual(outcomes,[true,true],'both valid independent changes should commit');
 const pinned=await pages[1].evaluate(async()=>{
   const {GhostLibrary}=await import('/src/systems/ghost/GhostLibrary.js');
   const lib=new GhostLibrary();await lib.init();
   const course=lib.course('race-favorites',0);
   return {latest:course.latest,best:course.best,slot:course.favorites[0],
     tapePresent:Boolean(await lib.getTape('race-prior-latest'))};
 });
 assert.deepEqual(pinned,{latest:'race-next',best:'race-best',slot:'race-prior-latest',tapePresent:true});
 const refreshedPanel=await pages[0].evaluate(async()=>{
   const {readGhostCourseRows}=await import('/src/ui/ghost-course-rows.js');
   const lib=globalThis.__ghostRaceLibrary;
   const rows=await readGhostCourseRows(lib,{seed:'race-favorites',biomeMask:0,runId:'race-next'});
   const course=lib.course('race-favorites',0);
   return {latest:course.latest,slot:course.favorites[0],rows:rows.length};
 });
 assert.deepEqual(refreshedPanel,{latest:'race-next',slot:'race-prior-latest',rows:5},'Game Over must refresh stale role metadata from other tab');
 // A concurrent visibility preference must not overwrite the other tab's
 // newly added Favorite. Both writes target the same persisted course row.
 const toggles=await Promise.all([
   pages[0].evaluate(async()=>Boolean(await globalThis.__ghostRaceLibrary.setShow('race-favorites',0,'best',false))),
   pages[1].evaluate(async()=>Boolean(await globalThis.__ghostRaceLibrary.setFavorite('race-favorites',0,1,'race-best'))),
 ]);
 assert.deepEqual(toggles,[true,true]);
 const final=await pages[0].evaluate(async()=>{
   const {GhostLibrary}=await import('/src/systems/ghost/GhostLibrary.js');
   const lib=new GhostLibrary();await lib.init();
   const course=lib.course('race-favorites',0);
   return {showBest:course.show.best,slotA:course.favorites[0],slotB:course.favorites[1],latest:course.latest};
 });
 assert.deepEqual(final,{showBest:false,slotA:'race-prior-latest',slotB:'race-best',latest:'race-next'});
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log(JSON.stringify({format:'bb56-real-chromium-course-isolation',source:origin,create,restart,collision,collisionDisk,pinned,refreshedPanel,final,errors,mutatingRequests:writes,noPhysicsOrRankClaims:true},null,2));
 await context.close();
}finally{await browser.close();}
