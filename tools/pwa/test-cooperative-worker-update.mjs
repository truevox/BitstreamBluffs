/** Real Chromium worker lifecycle; fixture uses actual page updater and generated worker. */
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {renderOfflineWorker} from './build-offline-worker.mjs';
const base='/BitstreamBluffs/';
const hash=x=>createHash('sha256').update(x).digest('hex');
const {outputFiles}=await build({stdin:{contents:`
import {installPwaUpdater} from './src/systems/PwaUpdater.js';
const title={starting:false,view:null,input:{enabled:true},input_:{enabled:true}};
const save={backend:'idb',runs:[],_runWrites:new Map()};
const ghosts={backend:'idb',pendingWrites:0}, attempts={kind:'idb',pendingWrites:0};
const values={saveStore:save,ghostLibrary:ghosts,attemptHistory:attempts};
window.fixture={title,save,ghosts,attempts,active:false};
const game={scene:{isActive:k=>k==='TitleScene'?!fixture.active:k==='RunScene'&&fixture.active,isPaused:()=>false,getScene:()=>title},registry:{get:k=>values[k]},events:{once:()=>{}}};
navigator.serviceWorker.register('/BitstreamBluffs/sw.js',{scope:'/BitstreamBluffs/',updateViaCache:'none'}).then(reg=>{window.reg=reg;installPwaUpdater(game,reg);});
`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
const app=outputFiles[0].text;
function release(id){
 const html=`<!doctype html><title>${id}</title><script src="${base}assets/main-${id}.js"></script>`,js=`window.release=${JSON.stringify(id)};\n${app}`;
 const files=new Map([[base+'index.html',html],[base+'assets/main-'+id+'.js',js]]);
 const entries=[...files].map(([path,body])=>({path,sha256:hash(body),bytes:Buffer.byteLength(body)}));
 return {id,files,worker:renderOfflineWorker({base,entries,version:hash(JSON.stringify(entries)).slice(0,20)})};
}
const a=release('a'),b=release('b'),c=release('c');let current=a;
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');if(path===base+'sw.js'){res.setHeader('Content-Type','text/javascript');return res.end(current.worker);}const body=current.files.get(path===base?base+'index.html':path);if(body===undefined){res.statusCode=404;return res.end('missing');}res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');res.end(body);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
let browser;
const assert=(v,m)=>{if(!v)throw Error(m);};
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({serviceWorkers:'allow'});
 ctx.on('serviceworker',w=>w.on('console',m=>console.log('worker:',m.text())));
 const p=await ctx.newPage();p.on('pageerror',e=>console.log('page error',e.message));
 await p.goto(origin+base);await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();
 await p.waitForFunction(()=>window.reg&&navigator.serviceWorker.controller&&window.release==='a');
 const q=await ctx.newPage();await q.goto(origin+base);await q.waitForFunction(()=>window.reg&&navigator.serviceWorker.controller&&window.release==='a');
 await p.evaluate(()=>localStorage.setItem('save-sentinel','keep'));
 await q.evaluate(()=>{fixture.active=true;});
 current=b;
 await p.evaluate(()=>reg.update());
 await p.waitForFunction(()=>reg.waiting?.state==='installed');
 await p.getByRole('button',{name:'Update Bitstream Bluffs'}).click();
 await p.waitForFunction(()=>!fixture.title.starting&&document.querySelector('button').textContent==='Update now');
 assert(await q.evaluate(()=>release==='a'&&fixture.active),'active run interrupted');
 assert(await p.evaluate(()=>reg.waiting?.state==='installed'&&release==='a'),'waiting worker activated despite active client');
 console.log('PASS active sibling blocks manual update');
 await q.evaluate(()=>{fixture.active=false;fixture.ghosts.pendingWrites=1;});
 await p.getByRole('button',{name:'Update Bitstream Bluffs'}).click();
 await p.waitForFunction(()=>!fixture.title.starting&&document.querySelector('button').textContent==='Update now');
 assert(await p.evaluate(()=>reg.waiting?.state==='installed'),'pending write did not block');
 console.log('PASS pending write blocks update');
 await q.evaluate(()=>{fixture.ghosts.pendingWrites=0;});
 await p.getByRole('button',{name:'Update Bitstream Bluffs'}).click();
 await Promise.all([p,q].map(page=>page.waitForFunction(()=>window.release==='b'&&window.reg,null,{timeout:20000})));
 assert(await p.evaluate(()=>localStorage.getItem('save-sentinel')==='keep'),'save lost');
 console.log('PASS manual two-tab update preserves save');
 current=c;await p.evaluate(()=>reg.update());
 await p.waitForFunction(()=>reg.waiting?.state==='installed');
 await Promise.all([p,q].map(page=>page.waitForFunction(()=>window.release==='c'&&window.reg,null,{timeout:25000})));
 assert(await p.evaluate(()=>localStorage.getItem('save-sentinel')==='keep'),'save lost on auto update');
 console.log('PASS automatic update');
 await ctx.setOffline(true);await p.reload();await p.waitForFunction(()=>window.release==='c');
 console.log('PASS offline reopen after update');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
