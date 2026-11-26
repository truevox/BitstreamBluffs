/** #67 compiled-game sender/recipient acceptance proof. Shares #72's real browser harness. */
import assert from 'node:assert/strict';
import { boot, closeHarness, freshPage, recordRun, launchTakeoverInPage, seekToReady, until, sameStorage, padSchedule } from './test-takeover-browser.mjs';
import { buildTakeoverDescriptor } from '../src/systems/replay/Takeover.js';
import { decodePostcard, decodeReply, encodePostcard, postcardWire, createReply, encodeReply } from '../src/systems/replay/Postcard.js';
import { digestOf } from '../src/systems/replay/canonicalSha256.js';
import { defaultSongSelection } from '../src/systems/music/MusicPlaylist.js';
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
async function attempt(page, buttons, schedule = null) {
  return page.evaluate(async ({buttons,schedule}) => {
    const tk=window.__tk;
    tk.key('Space',true); tk.step(1); tk.key('Space',false);
    for(let i=0;i<1500 && !tk.g.scene.isActive('TakeoverEndScene');i++){
      const next=schedule?.[i];
      tk.hold(new Set(next?.names ?? buttons), next?.edgeHop); tk.step(1);
    }
    tk.releaseAll();
    const end=tk.g.scene.getScene('TakeoverEndScene');
    if(!tk.g.scene.isActive('TakeoverEndScene')) throw Error('did not end');
    let code=null;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async s=>{code=s;}}});
    const reply=await end.copyReply();
    return {outcome:end.outcome,code,reply,unranked:!tk.events.some(e=>e.name==='runEnd'),source:end.descriptor.source};
  },{buttons,schedule});
}
await boot();
try {
  const {P:sender,rec,info}=await recordRun();
  const N=info.tape.endTick-1100;
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
  // Prove offline gameplay under the existing user-selectable ALL OFF playlist.
  // The normal enabled soundtrack streams media independently of postcards.
  await P.page.evaluate(selection=>{const tk=window.__tk,a=tk.reg('audioSynth');a.applySettings({...tk.reg('settings'),musicEnabledSongs:selection});a.stopMusic();},Object.fromEntries(Object.keys(defaultSongSelection()).map(id=>[id,false])));
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
  for (const [buttons,schedule] of [[[],padSchedule(info.tape,N)],[[],null],[['hop'],null]]) {
    if(outcomes.length){
      await P.page.evaluate(()=>{const tk=window.__tk;tk.g.scene.getScene('TakeoverEndScene').retry();tk.step(1);});
      pass('retry returns to READY',await stepUntilReady(P.page)==='ready');
      assert.deepEqual(await checkReady(),a);
    }
    const r=await attempt(P.page,buttons,schedule);
    pass('attempt ends unranked with reply',r.unranked&&r.source==='postcard'&&r.reply.ok&&!!r.code&&['crashed','survived'].includes(r.outcome.result));
    const reply=await decodeReply(r.code);
    pass('reply decodes and binds to postcard',reply.ok&&reply.reply.postcardDigest===pc.digest);
    outcomes.push({result:r.outcome.result,reply:reply.reply,code:r.code});
  }
  pass('recipient unchanged storage',sameStorage(before,await P.page.evaluate(()=>window.__tk.snapshot())));
  console.log('REQUESTS',JSON.stringify(requests));
  console.log('OUTCOMES',JSON.stringify(outcomes.map(o=>o.result)));
  pass('offline playlist: no outbound requests or XHR/fetch/beacon',requests.every(r=>new URL(r.url).hostname==='127.0.0.1'&&!['xhr','fetch','ping','websocket'].includes(r.type)));
  pass('no browser exceptions',P.errors.length===0);
  console.log('OUTCOMES',JSON.stringify(outcomes.map(o=>o.result)));
  await P.close();
  pass('original input schedule survives full challenge',outcomes[0].result==='survived');
  // Independently drive compiled RunScene with the full replay tape.
  for(const o of outcomes){
    const V=await freshPage();
    const observation=await V.page.evaluate(({tape,pc})=>{
      const tk=window.__tk;tk.startRun(tape.seed);tk.R=tk.run().ghostRecorder.constructor;
      tk.g.scene.stop('RunScene');tk.g.registry.set('ghostReplay',tape);
      tk.g.scene.start('RunScene');tk.g.headlessStep(0,0);
      const r=tk.run(),a=r.seekTo(pc.startTick,{verify:false,maxTicks:Infinity});
      const startFingerprint=a.done&&!a.crashed?tk.fp(r):null;
      const b=r.seekTo(pc.startTick+pc.windowTicks,{verify:false,maxTicks:Infinity});
      return {prefixDone:!!a.done,prefixCrashed:!!a.crashed,startFingerprint,endTick:b.tick,endDone:!!b.done,endCrashed:!!b.crashed};
    },{tape:replyReplayTape(pc,o.reply),pc});
    const verdict=judgeReply(pc,o.reply,observation);
    pass('fresh compiled reply replay confirms '+o.result,verdict.ok&&verdict.outcome===o.result);
    const lie=createReply({postcard:pc,outcome:o.result==='survived'?'crashed':'survived',crashOffsetTicks:o.result==='survived'?pc.windowTicks:null,suffix:o.reply.suffix});
    pass('forged outcome refused by engine',lie.ok&&!judgeReply(pc,lie.reply,observation).ok);
    pass('corrupted reply rejected',!(await decodeReply(o.code.slice(0,8)+'!'+o.code.slice(9))).ok);
    await V.close();
  }
  // Re-sign a validly encoded but wrong start fingerprint, plus another build.
  const resign=async p=>{const {digest,...rest}=postcardWire(p);return encodePostcard({...p,digest:digestOf(rest)});};
  const other='sha256:'+'f'.repeat(64);
  const negatives=[['corrupt',code.slice(0,8)+'!'+code.slice(9)],['other-build',await resign({...pc,buildId:other,header:{...pc.header,buildId:other}})],['wrong-fingerprint',await resign({...pc,fingerprintAtStart:'xxh32x2:0000000000000000'})]];
  // A distant input edit can legitimately reconverge by N; use a changed
  // final applied pad so the last-pad causal fingerprint must differ.
  const mutated=pc.prefix.map(row=>[...row]);
  const at=mutated.reduce((n,row)=>n+row[0],0);
  const last=mutated.at(-1)??[0,0,0];
  const changedTilt=last[2]===127?-127:127;
  if(at===pc.startTick)last[2]=changedTilt;
  else mutated.push([pc.startTick-at,last[1]&~(63<<12),changedTilt]);
  assert.notDeepEqual(mutated,pc.prefix);
  const altered=await resign({...pc,prefix:mutated});
  pass('mutated prefix is structurally valid', (await decodePostcard(altered)).ok);
  negatives.push(['mutated-prefix',altered]);
  for(const [label,bad] of negatives){
    const V=await freshPage();
    await openCode(V.page,bad);
    await V.page.evaluate(async()=>{const tk=window.__tk;tk.g.loop.sleep();for(let i=0;i<1000;i++){tk.step(1);if(i%20===0)await new Promise(r=>setTimeout(r,0));}});
    const verdict=await V.page.evaluate(()=>{const tk=window.__tk;return {title:tk.g.scene.isActive('TitleScene'),ranked:tk.events.some(e=>e.name==='runStart'&&!e.p.practice),ready:tk.run()?.takeover?.phase==='ready',status:tk.g.scene.getScene('TitleScene').view?.status?.main?.text};});
    console.log('NEGATIVE',label,JSON.stringify(verdict));pass(label+' fails closed',verdict.title&&!verdict.ranked&&!verdict.ready);
    await V.close();
  }
} finally {await closeHarness();}
