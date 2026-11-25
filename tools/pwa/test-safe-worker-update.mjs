/** Real Chromium lifecycle gate, isolated localhost fixture; never registers publicly. */
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {renderOfflineWorker} from './build-offline-worker.mjs';
const base='/BitstreamBluffs/';
const hash=x=>createHash('sha256').update(x).digest('hex');
function release(id){const html=`<!doctype html><title>${id}</title><script src="${base}assets/main-${id}.js"></script>`,js=`window.release=${JSON.stringify(id)}`;const files=new Map([[base+'index.html',html],[base+'assets/main-'+id+'.js',js]]);const entries=[...files].map(([path,body])=>({path,sha256:hash(body),bytes:Buffer.byteLength(body)}));return {id,files,worker:renderOfflineWorker({base,entries,version:hash(JSON.stringify(entries)).slice(0,20)})};}
const a=release('a'),b=release('b'),c=release('c');let current=a,corrupt=false;
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');if(path===base+'sw.js'){res.setHeader('Content-Type','text/javascript');return res.end(current.worker);}const body=current.files.get(path===base?base+'index.html':path);if(body===undefined){res.statusCode=404;return res.end('missing');}res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');res.end(corrupt&&path.endsWith('.js')?'broken':body);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
let browser;
const assert=(v,m)=>{if(!v)throw Error(m);};
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({serviceWorkers:'allow'});
 const p=await ctx.newPage();await p.goto(origin+base);await p.evaluate(async base=>{await navigator.serviceWorker.register(base+'sw.js',{scope:base,updateViaCache:'none'});await navigator.serviceWorker.ready;},base);await p.reload();await p.waitForFunction(()=>!!navigator.serviceWorker.controller&&window.release==='a');
 const q=await ctx.newPage();await q.goto(origin+base);await q.waitForFunction(()=>!!navigator.serviceWorker.controller&&window.release==='a');
 await p.evaluate(()=>{localStorage.setItem('bb-test-save','keep');window.activeRun={tick:42};});
 const before=await p.evaluate(()=>caches.keys());assert(before.length===1,'initial cache count');
 async function update(page){return page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();return new Promise((ok,fail)=>{const timer=setTimeout(()=>fail(Error('update timeout')),15000);const finish=state=>{clearTimeout(timer);ok(state);};reg.addEventListener('updatefound',()=>{const w=reg.installing;const changed=()=>{if(w.state==='redundant'||w.state==='installed')finish(w.state);};w.addEventListener('statechange',changed);changed();},{once:true});reg.update().catch(e=>{clearTimeout(timer);fail(e);});});});}
 current=b;corrupt=true;assert(await update(p)==='redundant','corrupt update must fail install');
 const failed=await p.evaluate(async()=>({keys:await caches.keys(),run:window.activeRun.tick,save:localStorage.getItem('bb-test-save'),version:await(await fetch('assets/main-a.js')).text()}));assert(JSON.stringify(failed.keys)===JSON.stringify(before)&&failed.run===42&&failed.save==='keep'&&failed.version.includes('"a"'),'failed install harmed old client');
 current=c;corrupt=false;assert(await update(p)==='installed','valid update must wait');
 const waiting=await p.evaluate(async()=>({waiting:(await navigator.serviceWorker.getRegistration()).waiting?.state,run:window.activeRun.tick,keys:await caches.keys(),old:await(await fetch('assets/main-a.js')).text()}));assert(waiting.waiting==='installed'&&waiting.run===42&&waiting.keys.length===2&&waiting.old.includes('"a"'),'valid update replaced active run');
 await p.close();assert(await q.evaluate(async()=>window.release==='a'&&(await navigator.serviceWorker.getRegistration()).waiting?.state==='installed'),'second client did not hold update');await q.close();
 await ctx.setOffline(true);const cold=await ctx.newPage();await cold.goto(origin+base);await cold.waitForFunction(()=>window.release==='c'&&!!navigator.serviceWorker.controller);const after=await cold.evaluate(async()=>({release:window.release,save:localStorage.getItem('bb-test-save'),keys:await caches.keys()}));assert(after.release==='c'&&after.save==='keep'&&after.keys.length===2,'cold update or saved data failed');console.log('PASS_SAFE_WORKER_UPDATE',JSON.stringify({before,failed,waiting,after}));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
