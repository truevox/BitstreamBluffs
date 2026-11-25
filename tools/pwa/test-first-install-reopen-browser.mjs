/** New installer sees a safe, truthful reopen hint before worker controls it. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
const [dist,base='/']=process.argv.slice(2);if(!dist)throw Error('Compiled PWA build required');
const root=fileURLToPath(new URL('../../',import.meta.url));let server,browser;
try{
 server=await preview({root,base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const url='http://127.0.0.1:'+server.httpServer.address().port+base;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'allow'}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
 const before=await p.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene'),act=(m,label)=>{const i=m.items.findIndex(x=>x.label===label);if(i<0)throw Error('Missing '+label);m.setSelected(i,true);m.handleAction('confirm');};
  act(t.menu,'SETTINGS');act(t.view.menu,'MANAGE SOUND');const labels=t.view.soundView.menu.items.map(x=>x.label);
  return{pending:g.registry.get('offlineMusicNeedsReopen'),controller:!!g.registry.get('offlineMusicDownloads'),labels};
 });
 if(!before.pending||before.controller||!before.labels.includes('OFFLINE: REOPEN APP TO ENABLE'))throw Error('No first-install hint '+JSON.stringify(before));
 await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload({waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>!!window.__bbGame?.registry?.get('offlineMusicDownloads')&&navigator.serviceWorker.controller,null,{timeout:30000});
 const after=await p.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene'),act=(m,label)=>{const i=m.items.findIndex(x=>x.label===label);if(i<0)throw Error('Missing '+label);m.setSelected(i,true);m.handleAction('confirm');};
  act(t.menu,'SETTINGS');act(t.view.menu,'MANAGE SOUND');const labels=t.view.soundView.menu.items.map(x=>x.label);
  return{pending:g.registry.get('offlineMusicNeedsReopen'),controller:!!g.registry.get('offlineMusicDownloads'),labels};
 });
 if(after.pending||!after.controller||!after.labels.includes('OFFLINE MUSIC')||after.labels.includes('OFFLINE: REOPEN APP TO ENABLE')||errors.length)throw Error('Reopen failed '+JSON.stringify({after,errors}));
 console.log('PASS_FIRST_INSTALL_REOPEN_HINT',JSON.stringify({before,after,errors}));
}finally{if(browser)await browser.close();if(server)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));}
