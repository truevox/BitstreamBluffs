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
  a.favorites[0]=b.latest; // simulate corrupt stale metadata loaded from IDB
  const out=await lib.ghostsFor('exact-seed-A',7,{}, {simRevision:SIM_REVISION});
  const rows=await readGhostCourseRows(lib,{runId:a.latest,seed:a.seed,biomeMask:a.biomeMask});
  // Do not persist the deliberately corrupted in-memory fixture.
  return {originalRoles,visible:out.map(x=>x.runId),foreignRow:rows[2],courseCount:lib.courses.size};
 });
 assert.deepEqual(restart.visible,['ghost-local-A']);
 assert.equal(restart.foreignRow.info,'OTHER COURSE');
 assert.deepEqual(restart.originalRoles,[null,null,'ghost-local-A']);
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log(JSON.stringify({format:'bb56-real-chromium-course-isolation',source:origin,create,restart,errors,mutatingRequests:writes,noPhysicsOrRankClaims:true},null,2));
 await context.close();
}finally{await browser.close();}
