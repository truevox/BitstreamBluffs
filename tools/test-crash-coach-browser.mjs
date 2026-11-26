/** #66: real Game Over C path, hidden real-engine search and original-tape practice. */
import assert from 'node:assert/strict';
import { boot, closeHarness, freshPage, recordRun, seekToReady, until, sameStorage } from './test-takeover-browser.mjs';
const pass=(label,ok)=>{assert.ok(ok,label);console.log('PASS '+label);};
await boot();
try {
  const hazard=process.env.BSB_COACH_CASE==='hazard';
  const {P,rec,info}=await recordRun(hazard?{seed:'A',fixture:'hazard'}:{});
  console.log('RECORDING',info.tape.seed,rec.ticks,info.lastCrash.cause,info.lastCrash.hazardId);
  pass('expected real crash cause',info.lastCrash.cause===(hazard?'hazard':'bsod'));
  const page=P.page;
  for(let i=0;i<4;i++){
    await page.evaluate(()=>{const tk=window.__tk,go=tk.g.scene.getScene('GameOverScene');go.skipReveal();tk.step(40);if(go.entry){tk.key('Escape',true);tk.key('Escape',false);tk.step(5);}});
    await page.waitForTimeout(150);
  }
  const before=await page.evaluate(()=>window.__tk.snapshot());
  await page.evaluate((hazard)=>{
    const tk=window.__tk;
    tk.events.length=0;
    window.__coachProof={timings:[],result:null};
    window.__bbCoachTest={
      budget:hazard?8:3,timeBudgetMs:25000,
      wrapSimulate:sim=>async(...args)=>{const t=performance.now();try{return await sim(...args);}finally{window.__coachProof.timings.push(performance.now()-t);}},
      onResult:r=>window.__coachProof.result=r,
    };
    for(const type of ['keydown','keyup']) window.dispatchEvent(new KeyboardEvent(type,{code:'KeyC',key:'c',keyCode:67,which:67,bubbles:true,cancelable:true}));
    tk.step(5);
  },hazard);
  pass('Game Over C opens Coach',await page.evaluate(()=>!!window.__tk.g.scene.getScene('GameOverScene').coachView));
  const result=await page.evaluate(async()=>{
    const tk=window.__tk;
    const deadline=performance.now()+45000;
    while(!window.__coachProof.result&&performance.now()<deadline){
      tk.step(1);
      await new Promise(r=>setTimeout(r,0));
      if(tk.g.scene.getScene('GameOverScene').coachView?.failure) break;
    }
    const v=tk.g.scene.getScene('GameOverScene').coachView;
    return {result:window.__coachProof.result,timings:window.__coachProof.timings,failure:v?.failure,scenes:tk.scenes(),cause:v?.cause,errors:tk.errors};
  });
  console.log('COACH',JSON.stringify({timings:result.timings,failure:result.failure,scenes:result.scenes,errors:result.errors,summary:result.result?.summary,searched:result.result?.searched,errorsCount:result.result?.errors,cause:result.cause}));
  pass('real engine searched candidates',!!result.result&&result.result.searched>0&&result.result.errors<result.result.searched);
  if(hazard){
    pass('hazard candidate survives twice',result.result.survivors.length>0);
    const survivor=result.result.survivors[0];
    console.log('SURVIVOR',survivor.id,JSON.stringify(survivor.finalFingerprint));
    const V=await freshPage();
    const independent=await V.page.evaluate(({tape,tick})=>{
      const tk=window.__tk;tk.startRun(tape.seed);tk.R=tk.run().ghostRecorder.constructor;
      tk.g.scene.stop('RunScene');tk.g.scene.start('RunScene',{coachSim:{kind:'bb-coach-sim',tape,token:'independent',live:{cancelled:false}}});tk.g.headlessStep(0,0);
      const r=tk.run(),v=r.seekTo(tick,{stopOnCrash:true,maxTicks:Infinity});
      return {done:v.done,crashed:!!v.crashed,fp:tk.fp(r),tick:r.simClock.tick};
    },{tape:survivor.tape,tick:result.result.untilTick});
    pass('third fresh compiled replay confirms survivor',independent.done&&!independent.crashed&&independent.fp===survivor.finalFingerprint.hash&&independent.tick===survivor.finalFingerprint.tick);
    await V.close();
  }
  pass('no survivor without re-validation',result.result.survivors.every(s=>s.validated&&!!s.finalFingerprint));
  pass('no ranked run while searching',await page.evaluate(()=>!window.__tk.events.some(e=>e.name==='runStart'||e.name==='runEnd')));
  pass('storage unchanged after search',sameStorage(before,await page.evaluate(()=>window.__tk.snapshot())));
  await page.evaluate(async()=>{const tk=window.__tk;tk.g.scene.getScene('GameOverScene').coachView.practice();for(let i=0;i<20;i++){tk.step(1);await new Promise(r=>setTimeout(r,0));}});
  const launched=await page.evaluate(async()=>{const tk=window.__tk;const deadline=performance.now()+5000;while(performance.now()<deadline){if(tk.g.scene.isActive('RunScene')&&tk.run().takeover)return true;tk.step(1);await new Promise(r=>setTimeout(r,0));}return false;});
  if(!launched) console.log('PRACTICE DEBUG',JSON.stringify(await page.evaluate(()=>{const tk=window.__tk,go=tk.g.scene.getScene('GameOverScene'),r=tk.run();return {scenes:tk.scenes(),leaving:go.leaving,entry:!!go.entry,coach:!!go.coachView,canPractice:go.coachView?.canPractice,coachSim:r.coachSim?.created,notice:tk.reg('takeoverNotice'),pending:tk.reg('takeoverDescriptor')?.source,events:tk.events.slice(-6),errors:tk.errors};})),P.errors);
  pass('practice launches',launched);
  pass('practice READY',await seekToReady(page)==='ready');
  const ready=await page.evaluate(()=>{const tk=window.__tk,r=tk.run();return {tick:r.simClock.tick,fp:tk.fp(),unranked:r.unrankedPractice,source:r.takeover.descriptor.source,visible:r.sys.settings.visible};});
  pass('practice original fingerprint, visible and unranked',ready.tick===result.result.branchTick&&ready.fp===rec.fps[ready.tick]&&ready.unranked&&ready.visible&&ready.source==='coach');
  pass('storage unchanged after practice',sameStorage(before,await page.evaluate(()=>window.__tk.snapshot())));
  pass('no browser errors',P.errors.length===0);
  await P.close();
}finally{await closeHarness();}
