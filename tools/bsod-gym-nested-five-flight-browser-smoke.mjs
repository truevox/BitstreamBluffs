import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
 '--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const url=process.env.GAME_URL||'http://100.115.120.66:8229/';

async function titleReady(){
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
}
try {
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await titleReady();
 const hidden=await page.evaluate(()=>{
  const g=window.__bbGame,store=g.registry.get('progression').store;
  g.registry.set('profile',store.save({...store.profile,bank:500,
   bsodGym:{discovered:true,owned:true}}));
  const t=g.scene.getScene('TitleScene');
  t.menu.items.find(i=>i.label==='PROFILE').onSelect();
  t.view._openShop();
  t.view.menu.items.find(i=>i.label==='PERMANENT UPGRADES').onSelect();
  const noSetup=!t.view.menu.items.some(i=>i.id==='bsodGymSetup');
  t._closeView();
  t.startRun('gym-only-matryoshka',0,{gym:true});
  return noSetup;
 });
 assert.equal(hidden,true);
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
 const earned=await page.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene'),store=g.registry.get('progression').store;
  const events=[];g.events.on('bb:gymSetupUnlocked',p=>events.push(p));
  const bluff=[];g.events.on('bb:bsodBluff',p=>bluff.push(p.chain));
  g.loop.stop();
  r.bsodBluffs.reset();r.sled.msSinceContact=1e5; // grounded is a getter
  r.sled.parachuteMs=330;r.sled.airBrakeActive=false;
  let simulatedMs=1000;
  const scoredBluff=()=>{
   const t=simulatedMs;simulatedMs+=1300;
   r.sled.msSinceContact=1e5;
   r.sled.parachuteMs=330;
   r.bsodState={...r.bsodState,active:true,gapPx:1000,
      relativeAirX:400,atmosphereDensity:1};
   r.runTimeMs=t;r.updateBsodBluff();
   r.bsodState={...r.bsodState,gapPx:220};
   r.runTimeMs=t+150;r.updateBsodBluff();
   r.bsodState={...r.bsodState,gapPx:460};
   r.sled.x+=330;r.runTimeMs=t+850;r.updateBsodBluff();
  };
  // A tempting cross-flight sum of five must NOT unlock anything.
  for(let i=0;i<4;i++)scoredBluff();
  const lockedAfterFour=!store.profile.bsodGym.advanced;
  r.sled.msSinceContact=0;r.bsodState={...r.bsodState,gapPx:600};
  r.runTimeMs=simulatedMs;r.updateBsodBluff(); // actual grounded tracker update
  for(let i=0;i<4;i++)scoredBluff();
  const lockedAfterLanding=!store.profile.bsodGym.advanced;
  r.resetBsodGym(); // any caught/restarted attempt must clear mastery progress
  const lockedAfterRetry=!store.profile.bsodGym.advanced;
  let lockedThroughFour=true;
  for(let i=0;i<5;i++){
   scoredBluff();
   if(i<4 && store.profile.bsodGym.advanced)lockedThroughFour=false;
  }
  return {lockedAfterFour,lockedAfterLanding,lockedAfterRetry,
    lockedThroughFour,chains:bluff,unlocks:events.length,
    profile:store.profile.bsodGym,bank:store.profile.bank,
    retryCount:r.gymRetries||0};
 });
 assert.equal(earned.lockedAfterFour,true);
 assert.equal(earned.lockedAfterLanding,true);
 assert.equal(earned.lockedAfterRetry,true);
 assert.equal(earned.lockedThroughFour,true);
 assert.deepEqual(earned.chains,[1,2,3,4,1,2,3,4,1,2,3,4,5]);
 assert.equal(earned.retryCount,1);
 assert.equal(earned.unlocks,1);
 assert.equal(earned.profile.advanced,true);
 assert.equal(earned.profile.owned,true);
 assert.equal(earned.bank,500);
 console.log('FIVE_TRUE_TRACKER_BLUFFS_IN_SINGLE_GYM_FLIGHT_UNLOCK_ONLY_AT_FIVE_PASS',earned);

 await page.reload({waitUntil:'domcontentloaded'});await titleReady();
 const set=await page.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene');
  const before=g.registry.get('profile').bsodGym;
  t.menu.items.find(i=>i.label==='PROFILE').onSelect();
  t.view._openShop();
  t.view.menu.items.find(i=>i.label==='PERMANENT UPGRADES').onSelect();
  const row=t.view.menu.items.find(i=>i.id==='bsodGymSetup');
  if(!row)throw Error('Earned hidden setup row missing after reload');
  row.onSelect();
  const view=t.view;
  const changes={gapPx:220,wallSpeedPxS:1500,launchHeightPx:1100,
    launchSpeedPxS:1000,launchRisePxS:-900};
  const ids=[];
  for(const [key,value] of Object.entries(changes)){
    const item=view.menu.items.find(i=>i.id===key);
    if(item?.kind!=='choice')throw Error('Missing selectable '+key);
    item.set(value);ids.push(key);
    if(item.get()!==value)throw Error('Setting failed to persist in menu '+key);
  }
  const profile=g.registry.get('profile').bsodGym;
  return {before,after:profile,selected:ids,hasStart:view.menu.items.some(i=>i.label==='START PRACTICE')};
 });
 assert.equal(set.before.advanced,true);
 assert.equal(set.hasStart,true);
 assert.deepEqual(set.selected,['gapPx','wallSpeedPxS','launchHeightPx','launchSpeedPxS','launchRisePxS']);
 assert.equal(set.after.setup.wallSpeedPxS,1500);
 assert.equal(set.after.setup.gapPx,220);
 console.log('ADVANCED_GYM_SETUP_VISIBLE_ONLY_AFTER_MASTERY_AND_WRITABLE_PASS',set);

 await page.reload({waitUntil:'domcontentloaded'});await titleReady();
 const saved=await page.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene');
  const setup=g.registry.get('profile').bsodGym.setup;
  t.startRun('gym-custom-matryoshka',0,{gym:true});
  return setup;
 });
 assert.equal(saved.wallSpeedPxS,1500);assert.equal(saved.gapPx,220);
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
 const run=await page.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');
  g.loop.stop();
  const first={gym:r.bsodGym,setup:r.gymSetup,wallSpeed:r.bsod.wallSpeedPxS,
   gap:r.bsodState.gapPx,acceleration:r.bsod.accelerationPxS2,level:g.registry.get('profile').level};
  const x=r.bsod.wallX;
  r.bsod.advance(16);
  return {first,advancesForward:r.bsod.wallX>x,
   speedIncreases:r.bsod.wallSpeedPxS>=first.wallSpeed};
 });
 assert.equal(run.first.gym,true);
 assert.equal(run.first.setup.wallSpeedPxS,1500);
 assert.equal(run.first.setup.gapPx,220);
 assert.ok(run.first.wallSpeed>=1500);
 assert.ok(Math.abs(run.first.gap-220)<40);
 assert.equal(run.advancesForward,true);
 assert.equal(run.speedIncreases,true);
 assert.deepEqual(errors,[]);
 console.log('PERSISTENT_ADVANCED_GYM_WILD_FORWARD_ONLY_WALL_TEST_PASS',run);
} finally {await browser.close();}
