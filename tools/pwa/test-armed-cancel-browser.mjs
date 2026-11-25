/** Real compiled-game menu acceptance: consent arming is always reversible. */
import {preview} from 'vite';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const [dist,base='/']=process.argv.slice(2);if(!dist)throw Error('Built PWA required');
const root=fileURLToPath(new URL('../../',import.meta.url));let server,browser;
try{
 server=await preview({root,base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage(),errors=[];let derivativeRequests=0;
 page.on('pageerror',e=>errors.push(e.message));context.on('request',r=>{if(r.url().includes('/music-variants/'))derivativeRequests++;});
 await page.goto(origin+base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.registry?.get('offlineMusicDownloads'),null,{timeout:30000});
 const result=await page.evaluate(async()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene'),act=(menu,label)=>{const i=menu.items.findIndex(x=>x.label===label);if(i<0)throw Error('Missing menu action '+label);menu.setSelected(i,true);menu.handleAction('confirm');};
  act(t.menu,'SETTINGS');act(t.view.menu,'MANAGE SOUND');const sound=t.view.soundView;act(sound.menu,'OFFLINE MUSIC');const view=sound.offlineView;
  for(let i=0;i<200&&(view.pending||view.controller.replanning||view.controller.state.status==='checking');i++)await new Promise(r=>setTimeout(r,50));
  if(view.pending||view.controller.state.status!=='download-required')throw Error('Menu never became available');
  const button=label=>view.menu.items.find(x=>x.label===label);
  act(view.menu,'DOWNLOAD / REPAIR');if(!view.armed||button('CONFIRM DOWNLOAD').disabled||button('CANCEL DOWNLOAD').disabled)throw Error('Cannot cancel armed download');
  act(view.menu,'CANCEL DOWNLOAD');if(view.armed||!button('CONFIRM DOWNLOAD').disabled)throw Error('Cancelled download stayed armed');
  act(view.menu,'PRELOAD NEXT BIOME');if(!view.armedPrefetch||button('CONFIRM PREFETCH').disabled||button('CANCEL DOWNLOAD').disabled)throw Error('Cannot cancel armed prefetch');
  act(view.menu,'CANCEL DOWNLOAD');if(view.armedPrefetch||!button('CONFIRM PREFETCH').disabled)throw Error('Cancelled prefetch stayed armed');
  return {mode:view.controller.mode,state:view.controller.state.status,downloadCancelled:true,prefetchCancelled:true};
 });
 if(errors.length||derivativeRequests)throw Error('Unexpected transfer or page error: '+JSON.stringify({errors,derivativeRequests}));
 console.log('PASS_REAL_ARMED_CONSENT_CANCEL',JSON.stringify({result,errors,derivativeRequests}));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
