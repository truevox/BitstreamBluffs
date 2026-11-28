/** Real browser: settings persistence, Reduce Motion lock, tick-indexed Phaser drone. */
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const vite=await createServer({server:{host:'127.0.0.1',port:8439,strictPort:true}});
let browser;
try{
  await vite.listen();
  const port=vite.httpServer.address().port;
  browser=await chromium.launch({headless:true,args:[
    '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
  ]});
  const page=await browser.newPage({viewport:{width:1100,height:720}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:25000});
  // Open the REAL native SettingsView and select Pulp; keyboard sends the
  // ordinary MenuInput event, which owns both persist and refresh.
  const opened=await page.evaluate(()=>{
    const t=window.__bbGame.scene.getScene('TitleScene');
    const i=t.menu.items.findIndex(x=>x.label==='SETTINGS');
    if(i<0)throw Error('No Settings action');
    t.menu.activate(i);
    const v=t.view;
    const j=v.menu.items.findIndex(x=>x.label==='PULP');
    if(j<0)throw Error('Pulp setting not shown');
    v.menu.setSelected(j);
    return {rowCount:v.menu.items.length,choice:v.menu.items[j].get(),
      panelHeight:v.h,hasNativeControl:v.menu.items[j].kind==='choice'};
  });
  assert.equal(opened.rowCount,18);
  assert.equal(opened.choice,'original');
  assert.equal(opened.panelHeight<=254,true);
  assert.equal(opened.hasNativeControl,true);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>window.__bbGame.registry.get('settings')?.pulp==='drone',null,{timeout:6000});
  const setting=await page.evaluate(()=>{
    const g=window.__bbGame,v=g.scene.getScene('TitleScene').view;
    return {stored:g.registry.get('settings')?.pulp,
      label:v.menu.items.find(x=>x.label==='PULP').get()};
  });
  assert.equal(setting.stored,'drone');
  assert.equal(setting.label,'drone');
  console.log('PULP_REAL_SETTINGS_SELECT_PASS',setting);
  // Non-reduced mode has only three selectable options; pressing Right
  // from 100% Pulp must WRAP to 99% Less, not stall on a ghost LOCKED item.
  await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    const i=v.menu.items.findIndex(x=>x.label==='PULP');
    v.menu._adjust(i,1);
  });
  const wrapped=await page.evaluate(()=>window.__bbGame.registry.get('settings')?.pulp);
  assert.equal(wrapped,'less');
  await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    v.menu._adjust(v.menu.items.findIndex(x=>x.label==='PULP'),-1);
  });
  assert.equal(await page.evaluate(()=>window.__bbGame.registry.get('settings')?.pulp),'drone');
  console.log('PULP_THREE_OPTION_WRAP_PASS');

  // Reduce Motion must override the player preference, explain its lock,
  // and reject even a physical attempt to change Pulp while locked.
  await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    v.menu.setSelected(v.menu.items.findIndex(x=>x.label==='REDUCE MOTION'));
  });
  await page.evaluate(()=>{const v=window.__bbGame.scene.getScene('TitleScene').view;v.menu._adjust(v.menu.selected,1);}); // AUTO -> ON using real MenuList
  await page.waitForFunction(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    return v.menu.items.find(x=>x.label==='PULP')?.get()==='locked';
  },null,{timeout:5000});
  await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    v.menu.setSelected(v.menu.items.findIndex(x=>x.label==='PULP'));
  });
  await page.keyboard.press('ArrowRight');
  const lock=await page.evaluate(()=>{
    const g=window.__bbGame,v=g.scene.getScene('TitleScene').view;
    return {display:v.menu.items.find(x=>x.label==='PULP').get(),
      saved:g.registry.get('settings')?.pulp,
      reduce:g.registry.get('settings')?.reduceMotion};
  });
  assert.deepEqual(lock,{display:'locked',saved:'drone',reduce:'on'});
  console.log('REDUCE_MOTION_PULP_LOCK_PASS',lock);
  await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    v.menu.setSelected(v.menu.items.findIndex(x=>x.label==='REDUCE MOTION'));
  });
  await page.evaluate(()=>{const v=window.__bbGame.scene.getScene('TitleScene').view;v.menu._adjust(v.menu.selected,1);}); // ON -> OFF
  await page.waitForFunction(()=>window.__bbGame.registry.get('settings')?.reduceMotion==='off');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:25000});
  const persisted=await page.evaluate(()=>window.__bbGame.registry.get('settings'));
  assert.equal(persisted.pulp,'drone');assert.equal(persisted.reduceMotion,'off');
  console.log('PULP_PERSISTENCE_RELOAD_PASS');

  // OS accessibility preferences can change while Settings is ALREADY
  // visible. The painted label must update without a keypress or reopening.
  await page.evaluate(()=>{
    const t=window.__bbGame.scene.getScene('TitleScene');
    t.menu.activate(t.menu.items.findIndex(x=>x.label==='SETTINGS'));
    const v=t.view,i=v.menu.items.findIndex(x=>x.label==='REDUCE MOTION');
    v.menu._adjust(i,1); // OFF -> AUTO
  });
  assert.equal(await page.evaluate(()=>window.__bbGame.registry.get('settings')?.reduceMotion),'auto');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    const i=v.menu.items.findIndex(x=>x.label==='PULP');
    return v.menu.rows[i].value?.main?.text?.includes('LOCKED');
  },null,{timeout:5000});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    const i=v.menu.items.findIndex(x=>x.label==='PULP');
    return v.menu.rows[i].value?.main?.text?.includes('100% PULP');
  },null,{timeout:5000});
  console.log('PULP_OS_MOTION_LIVE_LABEL_PASS');

  await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('pulp-browser-smoke'));
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('RunScene') &&
    window.__bbGame.scene.getScene('RunScene')?._cameraIntent?.mode==='drone',null,{timeout:25000});
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene').simClock.tick>=160,null,{timeout:25000});
  const real=await page.evaluate(()=>{
    const r=window.__bbGame.scene.getScene('RunScene');
    const camera=r.cameras.main,i=r._cameraIntent;
    return {tick:r.simClock.tick,mode:i.mode,zoom:camera.zoom,roll:camera.rotation,
      worldLookAhead:i.lookAhead,cameraX:camera.scrollX,playerX:r.sled.x};
  });
  assert.equal(real.mode,'drone');
  assert.ok(real.tick>=160);
  assert.ok(Math.abs(real.roll)>1e-5,'real Phaser camera must receive Pulp roll');
  assert.ok(real.worldLookAhead>=250);
  assert.ok(real.zoom>=.45&&real.zoom<=1.04);
  console.log('PULP_REAL_RUNSCENE_CAMERA_PASS',real);
  assert.deepEqual(errors,[],'no browser errors');
}finally{
  await browser?.close();
  await vite.close();
}
