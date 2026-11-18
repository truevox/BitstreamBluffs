import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const url = process.env.GAME_URL || 'http://100.115.120.66:8229/';
const browser = await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
  '--enable-webgl','--ignore-gpu-blocklist',
]});
const page = await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];
page.on('pageerror',error=>errors.push(String(error)));
async function titleReady(){
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
}
try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await titleReady();
  const locked=await page.evaluate(()=>{
    const g=window.__bbGame,store=g.registry.get('progression').store;
    g.registry.set('profile',store.save({...store.profile,bank:500,
      bsodGym:{discovered:true,owned:true}}));
    const t=g.scene.getScene('TitleScene');
    t.menu.items.find(i=>i.label==='PROFILE').onSelect();
    t.view._openShop();
    t.view.menu.items.find(i=>i.label==='PERMANENT UPGRADES').onSelect();
    const view=t.view;
    const rowVisible=view.menu.items.some(i=>i.id==='bsodGymSetup');
    view._showGymSetup(); // direct forbidden invocation must also be harmless.
    return {rowVisible,setupPage:view.gymSetupPage};
  });
  assert.deepEqual(locked,{rowVisible:false,setupPage:false});

  // This is an isolated UI interaction fixture, NOT a shortcut for earning
  // the five scored Bluffs; separate tests prove that milestone's origin.
  await page.evaluate(()=>{
    const g=window.__bbGame,store=g.registry.get('progression').store;
    const saved=store.save({...store.profile,bsodGym:{
      discovered:true,owned:true,advanced:true,
    }});
    g.registry.set('profile',saved);
    const t=g.scene.getScene('TitleScene');
    t.view._showUpgrades();
  });
  const keyboard=await page.evaluate(()=>{
    const g=window.__bbGame,t=g.scene.getScene('TitleScene'),view=t.view;
    const index=view.menu.items.findIndex(i=>i.id==='bsodGymSetup');
    if(index<0)throw Error('Missing setup action after milestone');
    view.menu.setSelected(index,true);
    const activated=view.handleAction('confirm');
    if(activated!==true || !view.gymSetupPage)throw Error('Setup menu did not open via confirm');
    const items=view.menu.items;
    const row=items.findIndex(i=>i.id==='wallSpeedPxS');
    view.menu.setSelected(row,true);
    const before=items[row].get();
    const labels=items[row].options.map(o=>o.label);
    const handled=view.handleAction('right');
    const next=items[row].get();
    view.handleAction('left');
    const reversed=items[row].get();
    const bankBefore=g.registry.get('profile').bank;
    const gapIndex=items.findIndex(i=>i.id==='gapPx');
    view.menu.setSelected(gapIndex,true);
    const start=items[gapIndex].get();
    view.handleAction('confirm');
    const picked=items[gapIndex].get();
    const stored=g.registry.get('profile').bsodGym.setup;
    const bankAfter=g.registry.get('profile').bank;
    const visibleRow=view.menu.rows.filter(x=>x.value).length===5;
    // Exercise the real nested BACK controls and preserve category context.
    view.menu.items.find(i=>i.label==='← BACK TO UPGRADES').onSelect();
    view.menu.items.find(i=>i.label==='← BACK TO SHOP').onSelect();
    view._turnPage(1);
    view._turnPage(1);
    const pageBefore=view.page;
    view.menu.items.find(i=>i.label==='PERMANENT UPGRADES').onSelect();
    view.menu.items.find(i=>i.id==='bsodGymSetup').onSelect();
    view.menu.items.find(i=>i.label==='← BACK TO UPGRADES').onSelect();
    view.menu.items.find(i=>i.label==='← BACK TO SHOP').onSelect();
    return {
      opened:true,handled,labels,before,next,reversed,
      start,picked,stored,bankBefore,bankAfter,visibleRow,
      pageBefore,pageAfter:view.page,
    };
  });
  assert.equal(keyboard.opened,true);
  assert.equal(keyboard.handled,true);
  assert.notEqual(keyboard.next,keyboard.before);
  assert.equal(keyboard.reversed,keyboard.before);
  assert.notEqual(keyboard.picked,keyboard.start);
  assert.equal(keyboard.picked,keyboard.stored.gapPx);
  assert.equal(keyboard.bankAfter,keyboard.bankBefore);
  assert.equal(keyboard.visibleRow,true);
  assert.equal(keyboard.pageBefore,2);
  assert.equal(keyboard.pageAfter,keyboard.pageBefore);
  console.log('GYM_SETUP_KEYBOARD_MENU_CHOICE_SELECT_AND_REVERSE_PASS',keyboard);

  await page.reload({waitUntil:'domcontentloaded'});
  await titleReady();
  const reloaded=await page.evaluate(()=>{
    const g=window.__bbGame,profile=g.registry.get('profile'),t=g.scene.getScene('TitleScene');
    t.menu.items.find(i=>i.label==='PROFILE').onSelect();
    t.view._openShop();
    t.view.menu.items.find(i=>i.label==='PERMANENT UPGRADES').onSelect();
    const setupRow=t.view.menu.items.find(i=>i.id==='bsodGymSetup');
    if(!setupRow)throw Error('Lost nested milestone after page reload');
    setupRow.onSelect();
    const view=t.view;
    const gap=view.menu.items.find(i=>i.id==='gapPx').get();
    const start=view.menu.items.findIndex(i=>i.label==='START PRACTICE');
    view.menu.setSelected(start,true);
    view.handleAction('confirm');
    return {gap,profileSetup:profile.bsodGym.setup,
      advanced:profile.bsodGym.advanced,owned:profile.bsodGym.owned};
  });
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
  const run=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    return {gym:r.bsodGym,initialReady:r.gymReadyMs,
      gap:r.gymSetup.gapPx,wallSpeed:r.gymSetup.wallSpeedPxS,
      activeUpgrades:r.upgradeRun.enabled};
  });
  assert.equal(reloaded.advanced,true);
  assert.equal(reloaded.owned,true);
  assert.equal(run.gym,true);
  assert.ok(run.initialReady>0);
  assert.equal(run.gap,reloaded.gap);
  assert.equal(run.gap,reloaded.profileSetup.gapPx);
  assert.deepEqual(errors,[]);
  console.log('GYM_SETUP_REAL_KEYBOARD_ACTION_RELOAD_AND_ENTER_PRACTICE_PASS',{reloaded,run});
} finally {await browser.close();}
