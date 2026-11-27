/** #424 real two-version PWA worker update: a valid old exact-build READY
 * save must remain byte-for-byte intact and unusable (never auto-consumed)
 * after update; explicit two-click discard is the only deletion path.
 *
 * Old release fixture uses same v2.25.30 source/identity but its test-only
 * build preserves class names, since the *shipped* v30 minifier could not
 * create a valid stock READY save. The B release is the current compiled PWA.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
const [a,b,...flags]=process.argv.slice(2);
const realV31=flags.includes('--real-v31');
const realV32=flags.includes('--real-v32');
const realV33=flags.includes('--real-v33');
assert([realV31,realV32,realV33].filter(Boolean).length<=1,'choose one exact old-build fixture');
assert(a&&b,'Usage: node script OLD_KEEP_NAMES_FIXTURE NEW_V231_DIST');
const roots={a:resolve(a),b:resolve(b)};
const html=await Promise.all([readFile(resolve(roots.a,'index.html'),'utf8'),
 readFile(resolve(roots.b,'index.html'),'utf8')]);
const main=h=>h.match(/main-[A-Za-z0-9_-]+\.js/)?.[0];
assert(main(html[0])&&main(html[1])&&main(html[0])!==main(html[1]),'distinct compiled bundles required');
const errors=[],external=[];
let version='a',server,browser;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
 '.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2',
 '.webmanifest':'application/manifest+json','.bin':'application/octet-stream'};
const slot=async page=>page.evaluate(async()=>{
 const request=indexedDB.open('bb-single-use-suspend-v1',1);
 return new Promise((yes,no)=>{
  request.onsuccess=()=>{
   const db=request.result,tx=db.transaction('slots','readonly'),read=tx.objectStore('slots').get('local-suspend');
   read.onsuccess=async()=>{
    const row=read.result||null;db.close();
    if(!row){yes(null);return;}
    const digest=await crypto.subtle.digest('SHA-256',row.bytes);
    yes({status:row.status,runId:row.runId,tick:row.tick,buildId:row.buildId,
     integrity:row.integrity,length:row.bytes.length,
     sha256:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')});
   };
   read.onerror=()=>{db.close();no(read.error);};
  };
  request.onerror=()=>no(request.error);
 });
});
try{
 server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local.invalid').pathname,rel=path==='/'?'index.html':path.slice(1);
  const dir=roots[version],target=resolve(dir,rel);
  if(!rel||rel.split('/').some(k=>!k||k==='.'||k==='..')||!target.startsWith(dir+sep)){
   res.writeHead(403).end();return;
  }
  try{
   if(!(await stat(target)).isFile())throw Error('missing');
   res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream','Cache-Control':'no-store'}).end(await readFile(target));
  }catch{res.writeHead(404).end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),
  headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({serviceWorkers:'allow',viewport:{width:960,height:540}});
 await ctx.route('**/*',route=>{
  if(route.request().url().startsWith(origin+'/'))return route.continue();
  external.push(route.request().method()+':'+route.request().url());
  return route.abort();
 });
 const watch=p=>p.on('pageerror',err=>errors.push(err.message));
 const p=await ctx.newPage();watch(p);
 await p.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene'),null,{timeout:60000});
 await p.evaluate(()=>navigator.serviceWorker.ready);
 await p.reload({waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&navigator.serviceWorker.controller,null,{timeout:30000});
 const old=await p.evaluate(()=>({
  version:window.__bbGame.registry.get('gameVersion'),
  buildId:window.__bbGame.registry.get('currentBuildId'),
  bundle:document.querySelector('script[type="module"][src*="main-"]')?.src,
 }));
 assert(old.bundle?.includes(main(html[0])),'A bundle not loaded');
 await p.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('crossrelease-suspend-qa'));
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('RunScene')&&
  window.__bbGame.scene.getScene('RunScene').simClock?.tick>=180,null,{timeout:80000});
 await p.evaluate(()=>window.__bbGame.scene.getScene('RunScene').pauseRun());
 await p.waitForFunction(()=>window.__bbGame.scene.isActive('PauseScene')&&
  window.__bbGame.scene.getScene('PauseScene').canSuspend===true,null,{timeout:20000});
 await p.waitForTimeout(650);
 const source=await p.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene'),
   pause=g.scene.getScene('PauseScene');
  const index=pause.menu.items.findIndex(k=>k.label==='SUSPEND RUN');
  if(index<0)throw Error('Old native Suspend menu missing');
  const zone=pause.menu.rows[index].zone,
   point=zone.getWorldTransformMatrix().transformPoint(zone.width/2,zone.height/2),
   rect=g.canvas.getBoundingClientRect();
  return {runId:r.runId,tick:r.simClock.tick,
   pointer:{x:rect.x+point.x*rect.width/g.scale.gameSize.width,
    y:rect.y+point.y*rect.height/g.scale.gameSize.height}};
 });
 await p.mouse.click(source.pointer.x,source.pointer.y);
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  window.__bbGame.scene.getScene('TitleScene')._suspendReady===true,null,{timeout:30000});
 const stored=await slot(p);
 assert(stored?.status==='ready'&&stored.runId===source.runId&&
  stored.tick===source.tick&&stored.buildId===old.buildId,'old valid READY slot unavailable');
 const q=await ctx.newPage();watch(q);
 await q.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await q.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  navigator.serviceWorker.controller,null,{timeout:30000});
 version='b';
 const waiting=await p.evaluate(async()=>{
  const r=await navigator.serviceWorker.getRegistration();await r.update();
  for(let i=0;i<200;i++){
   if(r.waiting?.state==='installed')return {waiting:true,active:r.active?.state};
   await new Promise(done=>setTimeout(done,100));
  }
  return {waiting:false};
 });
 assert(waiting.waiting,'B worker never entered waiting state');
 assert.deepEqual(await slot(p),stored,'worker update silently changed old slot');
 await p.reload({waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&navigator.serviceWorker.controller&&
  window.__bbGame.scene.getScene('TitleScene')._suspendStatus==='ready',null,{timeout:30000});
 const preservedA=await p.evaluate(()=>({
  script:document.querySelector('script[type="module"][src*="main-"]')?.src,
  status:window.__bbGame.scene.getScene('TitleScene')._suspendStatus,
 }));
 assert(preservedA.script.includes(main(html[0]))&&preservedA.status==='ready',
  'live old tab switched code before safe worker transition');
 await p.close();
 const held=await q.evaluate(async()=>({
  waiting:(await navigator.serviceWorker.getRegistration())?.waiting?.state,
  status:window.__bbGame.scene.getScene('TitleScene')._suspendStatus,
 }));
 assert(held.waiting==='installed','B activated before last A page closed');
 await q.close();
 await new Promise(done=>setTimeout(done,700));
 await ctx.setOffline(true);
 const cold=await ctx.newPage();watch(cold);
 await cold.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:30000});
 await cold.waitForFunction(()=>window.__bbGame?.scene.isActive('TitleScene')&&
  navigator.serviceWorker.controller&&
  window.__bbGame.scene.getScene('TitleScene')._suspendStatus==='incompatible',
 null,{timeout:30000});
 const incompatible=await cold.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene'),b=t.suspendButton,
   pt=b.getWorldTransformMatrix().transformPoint(b.w/2,b.h/2),
   rect=g.canvas.getBoundingClientRect();
  return {bundle:document.querySelector('script[type="module"][src*="main-"]')?.src,
   button:b.label.main.text,ready:t._suspendReady,
   pointer:{x:rect.x+pt.x*rect.width/g.scale.gameSize.width,
    y:rect.y+pt.y*rect.height/g.scale.gameSize.height}};
 });
 assert(incompatible.bundle.includes(main(html[1]))&&
  incompatible.button==='CLEAR OLD SAVE'&&incompatible.ready!==true,'old READY mistakenly admitted by new build');
 assert.deepEqual(await slot(cold),stored,'B updated or erased incompatible old save silently');
 await cold.mouse.click(incompatible.pointer.x,incompatible.pointer.y);
 await cold.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene')._suspendConfirm===true,null,{timeout:10000});
 const first=await cold.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').suspendButton.label.main.text);
 assert(first==='CONFIRM ERASE','no explicit discard confirmation');
 assert.deepEqual(await slot(cold),stored,'first click erased old save');
 await cold.mouse.click(incompatible.pointer.x,incompatible.pointer.y);
 await cold.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene')._suspendStatus==='empty',null,{timeout:15000});
 assert.equal(await slot(cold),null,'confirmed discard did not clear READY save');
 assert.deepEqual(errors,[]);
 assert(!external.some(x=>!x.startsWith('GET:')&&!x.startsWith('HEAD:')),'test attempted outbound mutation');
 console.log('PASS_OLD_READY_PRESERVED_ON_COMPILED_OFFLINE_PWA_UPGRADE',JSON.stringify({
  oldBuild:old.buildId,newBundle:main(html[1]),source:{runId:source.runId,tick:source.tick},
  stored,waiting,preservedA,held,
  coldOffline:true,incompatible:{button:incompatible.button,ready:incompatible.ready},
  preservedByteIdenticalBeforeErasure:true,firstClickOnlyConfirms:true,
  secondClickExplicitlyErases:true,errors,external,
  caveat:realV33?'Actual merged v2.25.33 platform contract source to current exact-build PWA; no synthetic fixture.'
   :realV32?'Actual shipped v2.25.32 to current exact-build PWA; no synthetic fixture.'
   :realV31?'Actual shipped v2.25.31 to current exact-build PWA; no synthetic fixture.'
   :'V30 fixture uses test-only keepNames to create a valid pre-hotfix READY blob',
 }));
 await ctx.close();
}finally{
 await browser?.close();
 if(server)await new Promise(done=>server.close(done));
}
