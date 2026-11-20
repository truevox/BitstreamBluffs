/** PR #52 review fix: on touch devices the minimap must never sit under the
 * on-screen buttons (iPad-like and phone-like landscape viewports).
 *   GAME_URL=http://127.0.0.1:8293/ node tools/hud-minimap-touch-browser-smoke.mjs
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const url=process.env.GAME_URL||'http://127.0.0.1:8293/';
const hit=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try{
 for(const [name,viewport] of [['tablet',{width:1024,height:768}],['phone',{width:844,height:390}]]){
  const ctx=await browser.newContext({viewport,hasTouch:true,isMobile:true});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('hud-touch-check'));
  await page.waitForFunction(()=>{const ui=window.__bbGame.scene.getScene('UIScene');
   return ui?.touchRects?.length>0&&ui.minimap?.rect;},null,{timeout:30000});
  const samples=[];
  for(let i=0;i<10;i++){
   await page.waitForTimeout(300);
   samples.push(await page.evaluate(()=>{const ui=window.__bbGame.scene.getScene('UIScene');
    return {touch:ui.touchRects,map:ui.minimap.rect&&{...ui.minimap.rect}};}));
  }
  for(const s of samples){
   if(!s.map)continue;
   const bad=s.touch.filter(t=>hit(s.map,t));
   assert.equal(bad.length,0,`${name}: minimap ${JSON.stringify(s.map)} under touch buttons ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(errors,[]);
  const last=samples.at(-1);
  console.log('HUD_MINIMAP_TOUCH_PASS',name,JSON.stringify({map:last.map,touch:last.touch.map(t=>({x:Math.round(t.x),y:Math.round(t.y),w:Math.round(t.w),h:Math.round(t.h)}))}));
  if(process.env.SHOT_DIR)await page.screenshot({path:`${process.env.SHOT_DIR}/touch-${name}.png`});
  await ctx.close();
 }
}finally{await browser.close();}
