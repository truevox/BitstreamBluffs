import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try {
  await page.goto(process.env.GAME_URL||'http://100.115.120.66:8219/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  const before=await page.evaluate(()=>{
    const g=window.__bbGame,svc=g.registry.get('progression');
    svc.store.save({...svc.store.profile,bank:500,bsodGym:{discovered:false,owned:false}});
    g.registry.set('profile',svc.store.profile);
    const t=g.scene.getScene('TitleScene');
    t.menu.items.find(i=>i.label==='PROFILE').onSelect();
    t.view._openShop();
    t.view.menu.items.find(i=>i.label==='PERMANENT UPGRADES').onSelect();
    const secrets=t.view.menu.items.filter(i=>/GYM|BLUFF|SURFING|REFILL/i.test(i.label||''));
    t._closeView();
    t.startRun('bsod-gym-discovery-smoke');
    return {secrets,bank:svc.store.profile.bank,discovered:svc.store.profile.bsodGym.discovered};
  });
  assert.equal(before.secrets.length,0);
  assert.equal(before.discovered,false);
  console.log('UNDISCOVERED_SHOP_SECRET_PASS',before);
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
  const discover=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),svc=g.registry.get('progression');
    const events=[];g.events.on('bb:nearMiss',e=>events.push({...e}));
    const x=r.sled.x, oldState=r.bsodState;
    r.bsodBluffs.reset();
    r.sled.msSinceContact=999;r.sled.parachuteMs=330;r.sled.airBrakeActive=false;
    r.bsodState={...oldState,active:true,gapPx:1000,relativeAirX:400,atmosphereDensity:1};
    r.runTimeMs=0;r.updateBsodBluff();
    r.bsodState={...r.bsodState,gapPx:220};r.runTimeMs=100;r.updateBsodBluff();
    r.sled.x=x+330;r.bsodState={...r.bsodState,gapPx:460};r.runTimeMs=850;r.updateBsodBluff();
    const discovered=svc.store.profile.bsodGym.discovered;
    const count=events.filter(e=>e.gymDiscovered).length;
    r.sled.x=x; r.bsodState=oldState;
    r.scene.start('TitleScene');
    return {discovered,count,event:events[0]?.hazardType,bank:svc.store.profile.bank};
  });
  assert.equal(discover.discovered,true);
  assert.equal(discover.count,1);
  assert.equal(discover.bank,500);
  console.log('ONE_TRUE_BLUFF_DISCOVERS_GYM_PASS',discover);
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  const shop=await page.evaluate(()=>{
    const g=window.__bbGame,t=g.scene.getScene('TitleScene');
    t.menu.items.find(i=>i.label==='PROFILE').onSelect();
    t.view._openShop();t.view.menu.items.find(i=>i.label==='PERMANENT UPGRADES').onSelect();
    const row=t.view.menu.items.find(i=>i.id==='bsodGym');
    if(!row)throw Error('Discovered gym missing from shop');
    const initial={label:row.label,sub:row.sub,disabled:row.disabled};
    row.onSelect();
    const owned=g.registry.get('profile').bsodGym;
    const final=t.view.menu.items.find(i=>i.id==='bsodGym');
    return {initial,owned,after:{sub:final.sub,disabled:final.disabled},bank:g.registry.get('profile').bank};
  });
  assert.match(shop.initial.sub,/LOCKED/);
  assert.deepEqual(shop.owned,{discovered:true,owned:true});
  assert.equal(shop.after.sub,'ENTER');
  assert.equal(shop.bank,300);
  console.log('LOCKED_GYM_PAID_UNLOCK_PASS',shop);
  await page.evaluate(()=>{
    const g=window.__bbGame,t=g.scene.getScene('TitleScene');
    t.view.menu.items.find(i=>i.id==='bsodGym').onSelect();
  });
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
  const live=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    g.loop.stop();
    for(let i=0;i<20;i++)g.headlessStep(100+i*50,50);
    if(r.gymReadyMs!==0)throw Error('First READY did not release');
    const savedBefore=g.registry.get('lastRecord');
    const bankBefore=g.registry.get('profile').bank;
    const lifetimeBefore=JSON.stringify(g.registry.get('profile').lifetime);
    r.bsod.wallX=r.sled.body.bounds.min.x+10;
    r.bsod.wallSpeedPxS=10000;
    g.headlessStep(6000,16.67);g.headlessStep(6017,16.67);
    return {gym:r.bsodGym,retries:r.gymRetries||0,crashed:r.crashed,
      savedSame:g.registry.get('lastRecord')===savedBefore,
      bankSame:g.registry.get('profile').bank===bankBefore,
      lifetimeSame:JSON.stringify(g.registry.get('profile').lifetime)===lifetimeBefore,
      gap:r.bsodState?.gapPx,wallSpeed:r.bsod.wallSpeedPxS,seed:r.seed};
  });
  assert.equal(live.gym,true);
  assert.ok(live.retries>=1);
  assert.equal(live.crashed,false);
  assert.equal(live.savedSame,true);
  assert.equal(live.bankSame,true);
  assert.equal(live.lifetimeSame,true);
  assert.ok(live.gap>0);
  assert.deepEqual(errors,[]);
  console.log('BSOD_GYM_INFINITE_RETRY_NO_REWARDS_PASS',live);
} finally {await browser.close();}
