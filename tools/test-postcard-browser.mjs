/** #67 compiled-game sender/recipient acceptance proof. Shares #72's real browser harness. */
import assert from 'node:assert/strict';
import { boot, closeHarness, freshPage, recordRun, launchTakeoverInPage, seekToReady, until, sameStorage } from './test-takeover-browser.mjs';
import { buildTakeoverDescriptor } from '../src/systems/replay/Takeover.js';
import { decodePostcard, decodeReply, encodePostcard } from '../src/systems/replay/Postcard.js';
import { replyReplayTape, judgeReply } from '../src/systems/replay/PostcardVerify.js';

const pass = (label, condition) => { assert.ok(condition, label); console.log('PASS '+label); };
const key = (page, code, letter) => page.evaluate(({code,letter}) => {
  for (const type of ['keydown','keyup']) window.dispatchEvent(new KeyboardEvent(type,{code,key:letter,keyCode:letter.toUpperCase().charCodeAt(0),which:letter.toUpperCase().charCodeAt(0),bubbles:true,cancelable:true}));
}, {code,letter});
async function openCode(page, code) {
  await key(page,'KeyO','o');
  assert.ok(await until(page,'(tk)=>!!tk.g.scene.getScene("TitleScene").view?.box',120),'Title O opens postcard input');
  await page.evaluate(async (code) => {
    const view = window.__tk.g.scene.getScene('TitleScene').view;
    view.box.setValue(code);
    await view.open();
    return {status:view.status?.main?.text, starting:window.__tk.g.scene.getScene('TitleScene').starting};
  },code).then(r=>console.log('OPEN',JSON.stringify(r)));
}
async function stepUntilReady(page) {
  const running=await until(page,'(tk)=>tk.g.scene.isActive("RunScene") && !!tk.run().takeover',500);
  if(!running) console.log('LAUNCH DEBUG',await page.evaluate(()=>{const tk=window.__tk,t=tk.g.scene.getScene('TitleScene');return {scenes:tk.scenes(),starting:t.starting,view:t.view?.status?.main?.text,errors:tk.errors,takeover:tk.reg('takeoverDescriptor')?.source,notice:tk.reg('takeoverNotice'),time:t.time.now,t:tk.t};}));
  assert.ok(running,'Title launched RunScene');
  return seekToReady(page);
}
async function attempt(page, buttons) {
  return page.evaluate(async (buttons) => {
    const tk=window.__tk;
    tk.key('Space',true); tk.step(1); tk.key('Space',false);
    for(let i=0;i<1500 && !tk.g.scene.isActive('TakeoverEndScene');i++){
      tk.hold(new Set(buttons)); tk.step(1);
    }
    tk.releaseAll();
    const end=tk.g.scene.getScene('TakeoverEndScene');
    if(!tk.g.scene.isActive('TakeoverEndScene')) throw Error('did not end');
    let code=null;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async s=>{code=s;}}});
    const reply=await end.copyReply();
    return {outcome:end.outcome,code,reply,unranked:!tk.events.some(e=>e.name==='runEnd'),source:end.descriptor.source};
  },buttons);
}
await boot();
try {
  const {P:sender,rec,info}=await recordRun();
  const N=info.tape.endTick-300;
  const sb=await sender.page.evaluate(()=>window.__tk.snapshot());
  await launchTakeoverInPage(sender.page,buildTakeoverDescriptor({tape:info.tape,tick:N,source:'last-run'}));
  pass('sender READY',await seekToReady(sender.page)==='ready');
  await key(sender.page,'KeyP','p');
  await sender.page.waitForFunction(()=>window.__tk.g.scene.getScene('UIScene').postcardReady?.view?.share?.code);
  const code=await sender.page.evaluate(()=>window.__tk.g.scene.getScene('UIScene').postcardReady.view.box.getValue());
  const decoded=await decodePostcard(code);
  pass('READY P produces a real postcard',decoded.ok && decoded.postcard.startTick===N && decoded.postcard.fingerprintAtStart===rec.fps[N]);
  const pc=decoded.postcard;
  await sender.page.evaluate(()=>window.__tk.g.scene.getScene('UIScene').postcardReady.view.close());
  pass('sender unchanged storage',sameStorage(sb,await sender.page.evaluate(()=>window.__tk.snapshot())));
  await sender.close();
  const P=await freshPage();
  await P.page.waitForLoadState('networkidle');
  const requests=[];
  P.page.on('request',r=>requests.push({type:r.resourceType(),url:r.url()}));
  const before=await P.page.evaluate(()=>window.__tk.snapshot());
  await openCode(P.page,code);
  try { await P.page.waitForFunction(()=>window.__tk.g.scene.isActive('RunScene') && !!window.__tk.run().takeover, null, {timeout:10000}); }
  catch(e) {
    console.log('RECIPIENT DEBUG',JSON.stringify(await P.page.evaluate(()=>{const tk=window.__tk,t=tk.g.scene.getScene('TitleScene'),r=tk.run();return {scenes:tk.scenes(),events:tk.events,errors:tk.errors,starting:t.starting,view:t.view?.status?.main?.text,phase:r?.takeover?.phase,abort:r?.takeover?.abort,notice:tk.reg('takeoverNotice'),pending:tk.reg('takeoverDescriptor')?.source,loop:tk.g.loop.running};})));
    console.log('PAGE ERRORS',P.errors);
    throw e;
  }
  await P.page.evaluate(()=>{const tk=window.__tk;tk.t=tk.g.loop.now;tk.g.loop.sleep();});
  pass('fresh recipient opens via Title O and verifies fingerprint',await stepUntilReady(P.page)==='ready');
  const checkReady=()=>P.page.evaluate(()=>{const r=window.__tk.run();return {tick:r.simClock.tick,challenge:r.takeover.descriptor.postcard.challenge,fp:r.takeover.descriptor.expectedFingerprint,unranked:r.unrankedPractice};});
  const a=await checkReady();
  pass('challenge and tick preserved',a.tick===N&&a.unranked&&a.fp===pc.fingerprintAtStart&&JSON.stringify(a.challenge)===JSON.stringify(pc.challenge));
  const outcomes=[];
  for (const buttons of [[],['push'],['hop']]) {
    if(outcomes.length){
      await P.page.evaluate(()=>{const tk=window.__tk;tk.g.scene.getScene('TakeoverEndScene').retry();tk.step(1);});
      pass('retry returns to READY',await stepUntilReady(P.page)==='ready');
      assert.deepEqual(await checkReady(),a);
    }
    const r=await attempt(P.page,buttons);
    pass('attempt ends unranked with reply',r.unranked&&r.source==='postcard'&&r.reply.ok&&!!r.code&&['crashed','survived'].includes(r.outcome.result));
    const reply=await decodeReply(r.code);
    pass('reply decodes and binds to postcard',reply.ok&&reply.reply.postcardDigest===pc.digest);
    outcomes.push({result:r.outcome.result,reply:reply.reply});
  }
  pass('recipient unchanged storage',sameStorage(before,await P.page.evaluate(()=>window.__tk.snapshot())));
  console.log('REQUESTS',JSON.stringify(requests));
  console.log('OUTCOMES',JSON.stringify(outcomes.map(o=>o.result)));
  pass('no outbound requests or XHR/fetch/beacon',requests.every(r=>new URL(r.url).hostname==='127.0.0.1'&&!['xhr','fetch','ping','websocket'].includes(r.type)));
  pass('no browser exceptions',P.errors.length===0);
  console.log('OUTCOMES',JSON.stringify(outcomes.map(o=>o.result)));
  await P.close();
} finally {await closeHarness();}
