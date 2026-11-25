/** Real A->retirement across two tabs: keep saves and all caches, return online site. */
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
const [oldPath,newPath,base='/']=process.argv.slice(2);
if(!oldPath||!newPath||!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))throw Error('Usage: retire-browser PWA_DIST ROLLBACK_DIST BASE');
const roots={a:resolve(oldPath),b:resolve(newPath)};let version='a';
const [aHtml,bHtml]=await Promise.all(Object.values(roots).map(dir=>readFile(resolve(dir,'index.html'),'utf8')));
const source=h=>h.match(/main-[A-Za-z0-9_-]+\.js/)?.[0];
if(!source(aHtml)||!source(bHtml)||source(aHtml)===source(bHtml))throw Error('Expected two different compiled game bundles');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.bin':'application/octet-stream'};
const server=createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost'),path=u.pathname===base?base+'index.html':u.pathname;
 if(!path.startsWith(base)){res.writeHead(404).end();return;}
 const rel=path.slice(base.length),dir=roots[version],target=resolve(dir,rel);
 if(!rel||rel.split('/').some(x=>!x||x==='.'||x==='..')||!target.startsWith(dir+sep)){res.writeHead(403).end();return;}
 try{if(!(await stat(target)).isFile())throw Error('not file');res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream','Cache-Control':'no-store'}).end(await readFile(target));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 const cat=await fetch('https://bsb-audio.bearcave.win/releases/20261124-melody-only-748a0670/catalog.json').then(r=>r.json());
 const song=cat.tracks.find(t=>t.title.includes('One More Run'))||cat.tracks[0],selection=Object.fromEntries(cat.tracks.map(x=>[x.id,x.id===song.id]));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'allow'}),errors=[];
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(sel=>{if(!localStorage.getItem('bb.settings'))localStorage.setItem('bb.settings',JSON.stringify({musicEnabledSongs:sel,offlineMusicQuality:'space-saver'}));},selection);
 await p.goto(origin+base,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:30000});await p.evaluate(()=>navigator.serviceWorker.ready);
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&navigator.serviceWorker.controller,null,{timeout:30000});
 await p.evaluate(async()=>{const g=window.__bbGame,c=g.registry.get('offlineMusicDownloads'),a=g.registry.get('audioSynth');const s=await c.start({consent:true});if(!s.ready)throw Error('Lite install failed');a.stopMusic();await c.apply();localStorage.setItem('bb-retire-save','keep-all-data');});
 const before=await p.evaluate(async()=>({musicCaches:(await caches.keys()).filter(x=>x.startsWith('bb-r2-recordings')),shells:(await caches.keys()).filter(x=>x.startsWith('bitstream-shell-v1-')),script:document.querySelector('script[type="module"]')?.src}));
 if(before.musicCaches.length<2||before.shells.length!==1||!before.script.includes(source(aHtml)))throw Error('No original controlled music app');
 const q=await ctx.newPage();q.on('pageerror',e=>errors.push(e.message));await q.goto(origin+base,{waitUntil:'domcontentloaded'});await q.waitForFunction(()=>navigator.serviceWorker.controller&&window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:30000});
 version='b';const update=await p.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();for(let i=0;i<200;i++){if(reg.waiting?.state==='installed')return true;await new Promise(r=>setTimeout(r,100));}return false;});
 if(!update)throw Error('Safe retiring worker did not enter waiting state');
 await p.close();const one=await q.evaluate(async()=>({waiting:(await navigator.serviceWorker.getRegistration()).waiting?.state,save:localStorage.getItem('bb-retire-save')}));
 if(one.waiting!=='installed'||one.save!=='keep-all-data')throw Error('Retired before last old client closed');
 await q.close();await new Promise(r=>setTimeout(r,650));
 const afterPage=await ctx.newPage();afterPage.on('pageerror',e=>errors.push(e.message));await afterPage.goto(origin+base,{waitUntil:'domcontentloaded'});await afterPage.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:30000});
 const after=await afterPage.evaluate(async()=>({script:document.querySelector('script[type="module"]')?.src,controller:!!navigator.serviceWorker.controller,registered:!!(await navigator.serviceWorker.getRegistration()),preview:!!window.__bbGame.registry.get('offlineMusicDownloads'),save:localStorage.getItem('bb-retire-save'),musicCaches:(await caches.keys()).filter(x=>x.startsWith('bb-r2-recordings')),shells:(await caches.keys()).filter(x=>x.startsWith('bitstream-shell-v1-'))}));
 if(!after.script.includes(source(bHtml))||after.controller||after.registered||after.preview||after.save!=='keep-all-data'||before.musicCaches.some(c=>!after.musicCaches.includes(c))||before.shells.some(c=>!after.shells.includes(c))||errors.length)throw Error('Non-destructive retirement failed '+JSON.stringify({before,one,after,errors}));
 console.log('PASS_REAL_SAFE_PWA_RETIRE',JSON.stringify({before,one,after,errors}));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
