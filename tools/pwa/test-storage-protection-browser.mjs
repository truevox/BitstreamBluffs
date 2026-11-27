/** Real browser Settings -> Offline Music -> explicit persistent-storage request. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
const [dist,base='/']=process.argv.slice(2);
if(!dist||!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))throw Error('Usage: test-storage-protection-browser DIST BASE');
const root=fileURLToPath(new URL('../../',import.meta.url));let server,browser;
try{
 server=await preview({root,base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const receipts=[];
 for(const cfg of [
  {label:'desktop-denied',viewport:{width:1366,height:768},allowed:false},
  {label:'phone-touch-granted',viewport:{width:844,height:390},hasTouch:true,isMobile:true,allowed:true},
 ]){
  const ctx=await browser.newContext({viewport:cfg.viewport,hasTouch:!!cfg.hasTouch,isMobile:!!cfg.isMobile,serviceWorkers:'allow'}),p=await ctx.newPage(),errors=[];let derivatives=0;
  p.on('pageerror',e=>errors.push(e.message));ctx.on('request',r=>{if(r.url().includes('/music-variants/'))derivatives++;});
  await p.addInitScript(allowed=>{
   window.__persistCalls=0;
   Object.defineProperty(navigator.storage,'persisted',{configurable:true,value:async()=>false});
   Object.defineProperty(navigator.storage,'persist',{configurable:true,value:()=>{window.__persistCalls++;return Promise.resolve(allowed);}});
  },cfg.allowed);
  try{
   await p.goto(origin+base,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});await p.evaluate(()=>navigator.serviceWorker.ready);
   await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.registry?.get('offlineMusicDownloads'),null,{timeout:30000});
   const before=await p.evaluate(async()=>{
    const g=window.__bbGame,title=g.scene.getScene('TitleScene');
    const act=(m,label)=>{const i=m.items.findIndex(x=>x.label===label);if(i<0)throw Error('Missing '+label);m.setSelected(i,true);m.handleAction('confirm');};
    act(title.menu,'SETTINGS');act(title.view.menu,'MANAGE SOUND');const sound=title.view.soundView;act(sound.menu,'OFFLINE MUSIC');const v=sound.offlineView;
    for(let i=0;i<200&&(v.pending||v.controller.replanning||v.controller.state.status==='checking');i++)await new Promise(r=>setTimeout(r,50));
    if(v.pending||v.controller.state.status==='checking')throw Error('Status never ready');
    // Let the CRT panel's entrance animation settle before asserting physical
    // row geometry or deriving a pointer coordinate. Status readiness alone
    // does not mean its parent panel has reached its on-screen position.
    await new Promise(resolve=>setTimeout(resolve,650));
    const i=v.menu.items.findIndex(x=>x.label==='PROTECT OFFLINE FILES');if(i<0)throw Error('Missing storage protection action');
    const row=v.menu.rows[i],t=v.menu.getWorldTransformMatrix().transformPoint(row.zone.x+row.zone.width/2,row.zone.y+row.zone.height/2);
    const rect=document.querySelector('canvas').getBoundingClientRect(),displayWidth=g.scale.gameSize.width,displayHeight=g.scale.gameSize.height;
    const point={x:rect.left+t.x/displayWidth*rect.width,y:rect.top+t.y/displayHeight*rect.height};
    if(v.panel.y<0||v.panel.y+v.h>270||v.menu.y+(i+1)*v.menu.rowH>v.back.y)
     throw Error('Storage row overlaps panel boundary or BACK '+JSON.stringify({panelY:v.panel.y,
      panelH:v.h,menuY:v.menu.y,rowH:v.menu.rowH,index:i,backY:v.back.y}));
    return {point,mode:v.controller.mode,preState:v.controller.state.storageProtection,disabled:v.menu.items[i].disabled,persistCalls:window.__persistCalls};
   });
   console.log('BEFORE_STORAGE_CLICK',cfg.label,JSON.stringify(before));
   if(before.disabled||before.persistCalls!==0||derivatives!==0)throw Error('Storage prompt activated without consent '+JSON.stringify(before));
   // Geometry and click location were both measured after panel animation.
   if(cfg.hasTouch)await p.touchscreen.tap(before.point.x,before.point.y);else await p.mouse.click(before.point.x,before.point.y);
   await p.waitForFunction(()=>window.__persistCalls===1,null,{timeout:10000}).catch(async()=>{const debug=await p.evaluate(()=>{const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.offlineView;return {calls:window.__persistCalls,selected:v.menu.selected,pending:v.pending,status:v.controller.state.storageProtection,last:v.localNotice,btn:v.menu.items.find(x=>x.label==='PROTECT OFFLINE FILES')};});throw Error('Storage click did not activate '+JSON.stringify({device:cfg.label,before,debug,errors}));});
   const after=await p.evaluate(()=>{const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.offlineView;return {status:v.controller.state.storageProtection,notice:v.localNotice,disabled:v.menu.items.find(i=>i.label==='PROTECT OFFLINE FILES').disabled,persistCalls:window.__persistCalls,ready:v.controller.state.ready};});
   if(after.status!==(cfg.allowed?'granted':'denied')||after.disabled!==cfg.allowed||after.persistCalls!==1||errors.length||derivatives!==0)throw Error('Storage protection handling failed '+JSON.stringify({cfg,before,after,errors,derivatives}));
   receipts.push({device:cfg.label,before,after,derivatives,errors});
  }finally{await ctx.close();}
 }
 console.log('PASS_REAL_STORAGE_PROTECTION',JSON.stringify(receipts));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
