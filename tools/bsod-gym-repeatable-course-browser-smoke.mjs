import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try {
 await page.goto(process.env.GAME_URL||'http://100.115.120.66:8229/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 await page.evaluate(()=>{
   const g=window.__bbGame,store=g.registry.get('progression').store;
   g.registry.set('profile',store.save({...store.profile,bank:550,
     bsodGym:{discovered:true,owned:true},
     boosts:{errorCorrection:true,headStart:true},
     unlocked:{...store.profile.unlocked,boosts:{errorCorrection:15,headStart:8}}}));
   g.scene.getScene('TitleScene').startRun('repeated-exact-gym-track',0,{gym:true});
 });
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
 const result=await page.evaluate(()=>{
   const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled;
   g.loop.stop();
   for(let i=0;i<20;i++)g.headlessStep(100+i*50,50);
   if(r.gymReadyMs!==0)throw Error('First READY did not release');
   const profile=g.registry.get('profile');
   const prior={startX:r.gymStartX,worldIndex:r.terrain.getActiveChunks()[0].index,
     firstChunk:[...r.mesh.chunks.keys()][0],physicalBodies:r.mesh.bodyCount,
     shardCount:[...r.shardField.byChunk.values()].reduce((a,v)=>a+v.length,0),
     shield:r.shieldCharges,wallSpeed:r.bsod.wallSpeedPxS,
     bank:profile.bank,record:g.registry.get('lastRecord'),
     lifetime:JSON.stringify(profile.lifetime)};
   const farX=20000;
   s.setPose(farX,r.terrain.heightAt(farX)-260,0,280,-330);
   r.streamTerrain(farX);
   r.streamTerrain(farX); // first jump buffers ahead; second tick releases old chunks
   const far={firstChunk:[...r.mesh.chunks.keys()][0],
     firstGenerator:r.terrain.getActiveChunks()[0].index};
   r.collectedPowerups.add('0:0');
   const originalShard=r.shardField.byChunk.values().next().value?.[0];
   if(originalShard)r.shardField.collected.add(originalShard.id);
   r.shieldCharges=0;
   // Force actual post-physics collision; Gym must reset EVERYTHING.
   r.bsod.wallX=s.body.bounds.min.x+12;r.bsod.wallSpeedPxS=10000;
   g.headlessStep(10000,16.67);g.headlessStep(10017,16.67);
   const after={retry:r.gymRetries,remaining:r.gymReadyMs,
     x:s.x,startX:r.gymStartX,
     firstChunk:[...r.mesh.chunks.keys()][0],
     firstGenerator:r.terrain.getActiveChunks()[0].index,
     physicalBodies:r.mesh.bodyCount,
     shardCount:[...r.shardField.byChunk.values()].reduce((a,v)=>a+v.length,0),
     collectedShards:r.shardField.collected.size,collectedPowerups:r.collectedPowerups.size,
     shield:r.shieldCharges,openingMs:r.runTimeMs-r.gymAttemptStartTimeMs,
     bank:g.registry.get('profile').bank,
     recordSame:g.registry.get('lastRecord')===prior.record,
     lifetimeSame:JSON.stringify(g.registry.get('profile').lifetime)===prior.lifetime};
   return {prior,far,after,hasHeadStart:r.appliedBoosts.includes('headStart'),
     hasShield:r.appliedBoosts.includes('errorCorrection')};
 });
 console.log('COURSE_RESET_DIAGNOSTIC',JSON.stringify(result));
 assert.equal(result.prior.worldIndex,0);
 assert.ok(result.far.firstChunk>0);
 assert.ok(result.far.firstGenerator>0);
 assert.equal(result.after.retry,1);
 assert.ok(result.after.remaining>950);
 assert.ok(Math.abs(result.after.x-result.prior.startX)<5); // Matter compound COM vs pose origin
 assert.equal(result.after.firstChunk,0);
 assert.equal(result.after.firstGenerator,0);
 assert.equal(result.after.physicalBodies,result.prior.physicalBodies);
 assert.equal(result.after.shardCount,result.prior.shardCount);
 assert.equal(result.after.collectedShards,0);
 assert.equal(result.after.collectedPowerups,0);
 assert.equal(result.after.shield,result.prior.shield);
 assert.ok(result.after.shield>0);
 assert.equal(result.after.openingMs,0);
 assert.equal(result.hasHeadStart,true);
 assert.equal(result.hasShield,true);
 assert.equal(result.after.bank,result.prior.bank);
 assert.equal(result.after.recordSame,true);
 assert.equal(result.after.lifetimeSame,true);
 assert.deepEqual(errors,[]);
 console.log('GYM_RETRY_REGENERATES_ORIGINAL_TERRAIN_HAZARDS_SHARDS_AND_BOOSTS_PASS',result);
} finally {await browser.close();}
