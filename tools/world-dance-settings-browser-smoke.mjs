/** Issue #36: exercise the REAL title Settings choice controls and persistence
 * in Chromium. Does not touch player state outside this disposable profile.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle',
 '--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const url=process.env.GAME_URL||'http://127.0.0.1:8286/';
async function open(){
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 return page.evaluate(()=>{
  const t=window.__bbGame.scene.getScene('TitleScene');
  const i=t.menu.items.findIndex(x=>x.label==='SETTINGS');
  if(i<0)throw Error('SETTINGS missing from main menu');
  t.menu.activate(i);
  const v=t.view;
  if(!v?.menu?.items?.some(x=>x.label==='WORLD DANCE'))throw Error('WORLD DANCE setting absent');
  const box={y:v.panel.y,h:v.panel.h,labels:v.menu.items.map(x=>x.label)};
  if(box.y<0||box.y+box.h>270)throw Error('Settings panel clipped: '+JSON.stringify(box));
  return box;
 });
}
async function change(label,next){
 return page.evaluate(({label,next})=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene'),v=t.view;
  const i=v.menu.items.findIndex(x=>x.label===label);
  if(i<0)throw Error('Missing setting '+label);
  for(let attempt=0;attempt<4;attempt++){
   if(v.menu.items[i].get()===next)break;
   v.menu._adjust(i,1); // real menu code, calls services.updateSetting
  }
  if(v.menu.items[i].get()!==next)throw Error('Could not select '+next);
  return {value:v.menu.items[i].get(),setting:g.registry.get('settings'),index:i};
 },{label,next});
}
try{
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
 const panel=await open();
 assert.equal(panel.labels.length,14);
 const dance=await change('WORLD DANCE',false);
 assert.equal(dance.value,false);
 assert.equal(dance.setting.worldDance,false);
 await change('REDUCE MOTION','on');
 await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene')._closeView());
 await page.reload({waitUntil:'domcontentloaded'});
 await open();
 const saved=await page.evaluate(()=>window.__bbGame.registry.get('settings'));
 assert.equal(saved.worldDance,false);
 assert.equal(saved.reduceMotion,'on');
 await change('WORLD DANCE',true);
 await change('REDUCE MOTION','off');
 await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene')._closeView());
 await page.reload({waitUntil:'domcontentloaded'});
 await open();
 const restored=await page.evaluate(()=>window.__bbGame.registry.get('settings'));
 assert.equal(restored.worldDance,true);
 assert.equal(restored.reduceMotion,'off');
 assert.deepEqual(errors,[]);
 console.log('WORLD_DANCE_SETTINGS_PERSISTENT_MENU_14_ROWS_PASS',JSON.stringify({panel,saved:{worldDance:saved.worldDance,reduceMotion:saved.reduceMotion},restored:{worldDance:restored.worldDance,reduceMotion:restored.reduceMotion}}));
}finally{await browser.close();}
