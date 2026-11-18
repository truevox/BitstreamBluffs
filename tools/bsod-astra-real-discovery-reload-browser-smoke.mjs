import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const origin=process.env.GAME_URL||'http://100.115.120.66:8225/';
try {
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),
    null,{timeout:30000});
  const pre=await page.evaluate(()=>{
    const g=window.__bbGame,svc=g.registry.get('progression');
    const prof=svc.store.save({...svc.store.profile,bank:500,bsodGym:{discovered:false,owned:false}});
    g.registry.set('profile',prof);
    const t=g.scene.getScene('TitleScene');
    t.menu.items.find(i=>i.label==='PROFILE').onSelect();
    t.view._openShop();
    t.view.menu.items.find(i=>i.label==='PERMANENT UPGRADES').onSelect();
    const hidden=!t.view.menu.items.some(i=>i.id==='bsodGym');
    t._closeView();
    t.startRun('gym-true-matter-discovery');
    return {hidden,bank:svc.store.profile.bank};
  });
  assert.equal(pre.hidden,true);
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),
    null,{timeout:30000});

  const flight=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled;
    const svc=g.registry.get('progression');
    const near=[],bluffs=[];
    g.events.on('bb:nearMiss',p=>near.push({...p}));
    g.events.on('bb:bsodBluff',p=>bluffs.push({...p}));
    g.loop.stop();
    const x=s.x+140;
    s.canopyFuelFullMs=880;
    s.setPose(x,r.terrain.heightAt(x)-1050,0,570,-360);
    r.bsod.wallX=s.body.bounds.min.x-230;
    r.bsod.wallSpeedPxS=600;
    r.bsod.accelerationPxS2=1.15;
    r.bsodBluffs.reset();r.bsodCaught=false;r.pendingCrash=null;
    r.hitStopMs=0;r.slowmoMs=0;r.blinkMs=0;
    const pad={parachute:false,airBrake:false,hop:false,brake:false,
      tilt:0,heli:0,pressed:{hop:false,pause:false,reset:false}};
    r.inputRouter={poll:()=>pad,setEnabled(){}};
    let frames=0,minGap=230;
    for(;frames<360 && !r.crashed && bluffs.length===0;frames++){
      pad.airBrake=frames<10;
      pad.parachute=frames>=10;
      g.headlessStep(12000+frames*1000/60,1000/60);
      if(Number.isFinite(r.bsodState?.gapPx))minGap=Math.min(minGap,r.bsodState.gapPx);
    }
    const profile=svc.store.profile;
    return {frames,minGap,crashed:r.crashed,realMatter:!!r.sled.body,
      earned:bluffs.length,chains:bluffs.map(x=>x.chain),
      near:near.map(x=>({points:x.points,gymDiscovered:x.gymDiscovered||false})),
      profileGym:profile.bsodGym,bank:profile.bank,
      airborne:!s.grounded};
  });
  assert.equal(flight.realMatter,true);
  assert.equal(flight.crashed,false);
  assert.equal(flight.earned,1);
  assert.equal(flight.profileGym.discovered,true);
  assert.equal(flight.profileGym.owned,false);
  assert.equal(flight.bank,500);
  assert.equal(flight.near.filter(x=>x.gymDiscovered).length,1);
  console.log('TRUE_MATTER_SCORED_FIRST_BLUFF_REVEALS_HIDDEN_GYM_PASS',flight);

  // Force an actual browser reload; an in-memory flag is not evidence of
  // persisted discovery or atomic one-time ownership/purchase.
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),
    null,{timeout:30000});
  const purchased=await page.evaluate(()=>{
    const g=window.__bbGame,t=g.scene.getScene('TitleScene');
    const svc=g.registry.get('progression');
    const discovered=svc.store.profile.bsodGym.discovered;
    t.menu.items.find(i=>i.label==='PROFILE').onSelect();
    t.view._openShop();
    t.view.menu.items.find(i=>i.label==='PERMANENT UPGRADES').onSelect();
    const row=t.view.menu.items.find(i=>i.id==='bsodGym');
    if(!row)throw Error('Gym missing after reload');
    const before={label:row.label,state:row.sub,bank:svc.store.profile.bank};
    row.onSelect();
    const next=t.view.menu.items.find(i=>i.id==='bsodGym');
    return {discovered,before,after:{state:next.sub,bank:svc.store.profile.bank,
      gym:svc.store.profile.bsodGym}};
  });
  assert.equal(purchased.discovered,true);
  assert.match(purchased.before.state,/LOCKED/);
  assert.equal(purchased.before.bank,500);
  assert.equal(purchased.after.bank,300);
  assert.equal(purchased.after.state,'ENTER');
  assert.deepEqual(purchased.after.gym,{discovered:true,owned:true});
  console.log('PHYSICAL_BLUFF_DISCOVERY_SURVIVES_RELOAD_ATOMIC_SHOP_PURCHASE_PASS',purchased);

  await page.evaluate(()=>{
    const t=window.__bbGame.scene.getScene('TitleScene');
    t.view.menu.items.find(i=>i.id==='bsodGym').onSelect();
  });
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive()
    && window.__bbGame.scene.getScene('RunScene').bsodGym===true,
    null,{timeout:30000});
  const gym=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    const initial={bank:g.registry.get('profile').bank,
      lifetime:JSON.stringify(g.registry.get('profile').lifetime),
      record:g.registry.get('lastRecord')};
    g.loop.stop();
    r.bsod.wallX=r.sled.body.bounds.min.x+12;r.bsod.wallSpeedPxS=10000;
    g.headlessStep(35000,16.67);g.headlessStep(35016,16.67);
    return {gym:r.bsodGym,retries:r.gymRetries,crashed:r.crashed,
      bankSame:g.registry.get('profile').bank===initial.bank,
      lifetimeSame:JSON.stringify(g.registry.get('profile').lifetime)===initial.lifetime,
      recordSame:g.registry.get('lastRecord')===initial.record};
  });
  assert.equal(gym.gym,true);assert.ok(gym.retries>=1);
  assert.equal(gym.crashed,false);
  assert.equal(gym.bankSame,true);
  assert.equal(gym.lifetimeSame,true);
  assert.equal(gym.recordSame,true);
  assert.deepEqual(errors,[]);
  console.log('PHYSICAL_FIRST_BLUFF_TO_PAID_REAL_GYM_PRACTICE_FULL_FLOW_PASS',gym);
} finally {await browser.close();}
