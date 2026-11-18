import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const scenarios=[
 {label:'fresh',on:true,ranks:{},active:false},
 {label:'purchased-disabled',on:false,ranks:{canopy:12,bsodGrace:15,speed:8,hop:6},active:false},
 {label:'purchased-enabled',on:true,ranks:{canopy:12,bsodGrace:15,speed:8,hop:6,flip:5,airbrake:8,divebomb:4},active:true},
 {label:'high-rank',on:true,ranks:{canopy:80,bsodGrace:80,speed:50,hop:50,flip:50,airbrake:50,divebomb:50},active:true},
];
try {
 for(const cfg of scenarios){
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  try {
   await page.goto(process.env.GAME_URL||'http://100.115.120.66:8227/',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
   await page.evaluate(({on,ranks,label})=>{
    const g=window.__bbGame,store=g.registry.get('progression').store;
    g.registry.set('profile',store.save({...store.profile,bank:700,upgradesEnabled:on,upgrades:{...store.profile.upgrades,...ranks},bsodGym:{discovered:true,owned:true}}));
    g.scene.getScene('TitleScene').startRun('real-loadout-'+label,0,{gym:true});
   },cfg);
   await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
   const state=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled;
    g.loop.stop();
    const pre={active:r.upgradeRun.enabled,ranks:r.upgradeRun.ranks,fx:r.upgradeFx,chase:r.gymChase,fuel:s.canopyFuelFullMs,accel:r.bsod.accelerationPxS2};
    const stored=g.registry.get('profile'),bank=stored.bank,oldRecord=g.registry.get('lastRecord'),lifetime=JSON.stringify(stored.lifetime);
    r.bsod.wallX=s.body.bounds.min.x+12;r.bsod.wallSpeedPxS=10000;
    g.headlessStep(5000,16.67);g.headlessStep(5017,16.67);
    return {pre,after:{retries:r.gymRetries||0,fuel:s.canopyFuelFullMs,remaining:s.parachuteFuelMs,accel:r.bsod.accelerationPxS2,bank:g.registry.get('profile').bank,recordSame:g.registry.get('lastRecord')===oldRecord,lifetimeSame:JSON.stringify(g.registry.get('profile').lifetime)===lifetime,crashed:r.crashed},bank};
   });
   assert.equal(state.pre.active,cfg.active);
   assert.equal(state.pre.fuel,state.pre.chase.parachuteFuelMs);
   assert.equal(state.pre.accel,state.pre.chase.accelerationPxS2);
   assert.equal(state.after.fuel,state.pre.fuel);
   assert.equal(state.after.accel,state.pre.accel);
   assert.ok(Math.abs(state.after.remaining-state.pre.fuel)<2);
   assert.ok(state.after.retries>=1);assert.equal(state.after.crashed,false);
   assert.equal(state.bank,700);assert.equal(state.after.bank,700);
   assert.equal(state.after.recordSame,true);assert.equal(state.after.lifetimeSame,true);
   if(cfg.active){assert.ok(state.pre.fuel>1500);assert.ok(state.pre.accel<0.65);}
   else{assert.equal(state.pre.fuel,1500);assert.equal(state.pre.accel,0.65);assert.deepEqual(state.pre.ranks,{});}
   assert.deepEqual(errors,[]);
   console.log('OWNER_GYM_LOADOUT_BROWSER_PASS',JSON.stringify({scenario:cfg.label,active:state.pre.active,fuelMs:state.pre.fuel,accelerationPxS2:state.pre.accel,retries:state.after.retries}));
  } finally {await page.close();}
 }
} finally {await browser.close();}
console.log('ALL_REAL_PLAYER_LOADOUT_SCENARIOS_PASS');
