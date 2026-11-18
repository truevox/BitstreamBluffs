import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];
page.on('pageerror', e=>errors.push(String(e)));
try {
 await page.goto(process.env.GAME_URL||'http://100.115.120.66:8213/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 const initial=await page.evaluate(()=>{
  const g=window.__bbGame,ps=g.registry.get('progression'),t=g.scene.getScene('TitleScene');
  if(!ps?.store) throw Error('Progression store not booted');
  const paid=ps.store.save({...ps.store.profile,bank:250});
  g.registry.set('profile',paid);
  t.menu.items.find(x=>x.label==='PROFILE').onSelect();
  const pv=t.view;
  if(!pv?._openShop) throw Error('Profile shop navigation missing');
  pv._openShop();
  const shop=t.view;
  const l=shop.menu.items.find(x=>x.label==='PERMANENT UPGRADES');
  if(!l)throw Error('Permanent Upgrades link missing');
  l.onSelect();
  const rows=shop.menu.items.map(x=>({label:x.label,sub:x.sub,kind:x.kind}));
  return {page:shop.upgradePage,rows,bank:paid.bank};
 });
 assert.equal(initial.page,true);
 assert.ok(initial.rows.some(x=>x.label==='UPGRADE MODE'));
 assert.ok(initial.rows.some(x=>x.label.includes('RACE SPEED R0')));
 assert.equal(initial.bank,250);
 console.log('UPGRADE_SHOP_VISIBLE_PASS',initial);
 const purchase=await page.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene'),shop=t.view;
  const before=g.registry.get('profile');
  const target=shop.menu.items.find(x=>x.id==='speed');
  if(!target?.onSelect)throw Error('No upgrade purchase action');
  target.onSelect();
  const after=g.registry.get('profile');
  const menu=shop.menu.items;
  return {spent:before.bank-after.bank,rank:after.upgrades.speed,enabled:after.upgradesEnabled,
    speedLabel:menu.find(x=>x.id==='speed')?.label,modeRow:menu.find(x=>x.label==='UPGRADE MODE')?.kind};
 });
 assert.equal(purchase.spent,28);
 assert.equal(purchase.rank,1);
 assert.equal(purchase.enabled,false);
 assert.ok(purchase.speedLabel.includes('R1'));
 console.log('UPGRADE_PURCHASE_PERSIST_PASS',purchase);
 const run=await page.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene'),shop=t.view;
  const toggle=shop.menu.items.find(x=>x.label==='UPGRADE MODE');
  toggle.set(true);
  const on=g.registry.get('profile').upgradesEnabled;
  const back=shop.menu.items.find(x=>x.label.includes('BACK TO SHOP'));
  back.onSelect();
  const shopRestored=shop.upgradePage===false && shop.menu.items.some(x=>x.label==='PERMANENT UPGRADES');
  t._closeView();
  t.startRun('upgrades-real-browser-test');
  return {enabled:on,shopRestored};
 });
 assert.equal(run.enabled,true);
 assert.equal(run.shopRestored,true);
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:20000});
 const actual=await page.evaluate(()=>{
  const r=window.__bbGame.scene.getScene('RunScene');
  return {modded:r.modded,rank:r.upgradeRun.ranks.speed,
    effect:r.upgradeFx.speedMul,canopyFuel:r.sled.canopyFuelFullMs,bsodAccel:r.bsod.accelerationPxS2};
 });
 assert.equal(actual.modded,true);
 assert.equal(actual.rank,1);
 assert.ok(actual.effect>1);
 assert.deepEqual(errors,[]);
 console.log('UPGRADE_GAMEPLAY_APPLIED_PASS',{...run,...actual});
 // Real gameplay collision must persist the actual ranks and MODDED flag,
 // rather than merely presenting boosted physics while writing a clean record.
 await page.evaluate(()=>{
  const r=window.__bbGame.scene.getScene('RunScene');
  r.bsod.wallX=r.sled.body.bounds.min.x-2;
  r.bsod.wallSpeedPxS=10000;
 });
 await page.waitForFunction(()=>window.__bbGame?.registry?.get('lastRecord')?.hashV===3,
   null,{timeout:10000});
 const record=await page.evaluate(()=>{
  const rec=window.__bbGame.registry.get('lastRecord');
  return {hashV:rec.hashV,modded:rec.modded,ranks:rec.upgradeRanks,
    ledgerHash:rec.ledgerHash,dailyOfficial:rec.dailyOfficial};
 });
 assert.equal(record.modded,true);
 assert.equal(record.ranks.speed,1);
 assert.equal(record.dailyOfficial,false);
 assert.match(record.ledgerHash,/^[0-9a-f]{8}$/);
 assert.deepEqual(errors,[]);
 console.log('UPGRADED_RUN_RECORD_PERSISTED_PASS',record);

} finally {await browser.close();}
