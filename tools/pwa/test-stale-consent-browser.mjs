/** Real menu/registry smoke: an old confirmation never authorizes a changed plan. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
const dist=process.argv[2];if(!dist)throw Error('Built candidate required');
const root=fileURLToPath(new URL('../../',import.meta.url)),base='/BitstreamBluffs/';let browser,server;
try{
 server=await preview({root,base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});const url='http://127.0.0.1:'+server.httpServer.address().port+base;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'allow'}),page=await ctx.newPage(),errors=[];let derivativeRequests=0;ctx.on('request',r=>{if(r.url().includes('/music-variants/'))derivativeRequests++;});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__bbGame?.registry.get('offlineMusicDownloads')&&window.__bbGame.scene.isActive('TitleScene'),null,{timeout:30000});
 const receipt=await page.evaluate(async()=>{
  const game=window.__bbGame,controller=game.registry.get('offlineMusicDownloads'),title=game.scene.getScene('TitleScene');
  const activate=(menu,label)=>{const i=menu.items.findIndex(x=>x.label===label);if(i<0)throw Error('Missing menu item '+label);menu.setSelected(i,true);menu.handleAction('confirm');};
  const wait=async test=>{for(let i=0;i<200;i++){if(test())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+JSON.stringify(controller.state));};
  activate(title.menu,'SETTINGS');activate(title.view.menu,'MANAGE SOUND');const sound=title.view.soundView;activate(sound.menu,'OFFLINE MUSIC');const view=sound.offlineView;await wait(()=>!view.pending&&controller.state.status==='download-required');
  activate(view.menu,'DOWNLOAD / REPAIR');if(!view.armed||view.menu.items.find(i=>i.label==='CONFIRM DOWNLOAD').disabled)throw Error('Did not arm download');
  const firstNext=controller.plan.nextBiome,old=game.registry.get('profile');const next={...old,unlocked:{...old.unlocked,biomes:[...new Set([...(old.unlocked?.biomes||[]),firstNext])]}};
  const rev=controller._planRevision;game.registry.set('profile',next);await wait(()=>controller._planRevision>rev&&!controller.replanning&&!controller._contextRefreshTicket);
  view._paint();if(view.armed||!view.menu.items.find(i=>i.label==='CONFIRM DOWNLOAD').disabled)throw Error('Stale download stayed armed');
  activate(view.menu,'CONFIRM DOWNLOAD');if(controller.running)throw Error('Stale download transferred');
  activate(view.menu,'PRELOAD NEXT BIOME');if(!view.armedPrefetch)throw Error('Next biome did not arm');
  const prefetchNext=controller.plan.nextBiome;const more={...next,unlocked:{...next.unlocked,biomes:[...new Set([...next.unlocked.biomes,prefetchNext])]}};
  const rev2=controller._planRevision;game.registry.set('profile',more);await wait(()=>controller._planRevision>rev2&&!controller.replanning&&!controller._contextRefreshTicket);view._paint();
  if(view.armedPrefetch||!view.menu.items.find(i=>i.label==='CONFIRM PREFETCH').disabled)throw Error('Stale prefetch stayed armed');activate(view.menu,'CONFIRM PREFETCH');if(controller.running)throw Error('Stale prefetch transferred');
  return {initialNextBiome:firstNext,changedNextBiome:prefetchNext,newNextBiome:controller.plan.nextBiome,revision:controller._planRevision,ready:controller.state.ready,oldDownloadRejected:true,oldPrefetchRejected:true};
 });
 if(derivativeRequests!==0||errors.length)throw Error('Unexpected transfers or page errors: '+JSON.stringify({derivativeRequests,errors}));
 console.log('PASS_STALE_CONSENT_BROWSER',JSON.stringify({receipt,derivativeRequests,errors}));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
