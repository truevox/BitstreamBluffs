/** #69: Real SIM9 natural tape captured in Chromium, compressed URL-fragment round-trip. */
import {createServer} from 'vite';
import {chromium} from 'playwright';
const natural=process.env.BSB_LINK_NATURAL==='1';
let vite,browser;
try{
 vite=await createServer({base:'/',server:{host:'127.0.0.1',port:0,strictPort:true}});await vite.listen();
 const origin='http://127.0.0.1:'+vite.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({viewport:{width:1000,height:540}}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(origin+'/',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:40000});
 await p.evaluate(natural=>window.__bbGame.scene.getScene('TitleScene').startRun(natural?'sim-05@0':'ghost-link-proof@0'),natural);
 await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('RunScene')&&window.__bbGame.scene.getScene('RunScene').sled?.body,null,{timeout:30000});
 if(!natural){
  await p.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene').simClock.tick>=140,null,{timeout:20000});
  await p.evaluate(()=>{const r=window.__bbGame.scene.getScene('RunScene');r.bsod.wallX=r.sled.body.bounds.min.x-2;r.bsod.wallSpeedPxS=10000;});
 }
 await p.waitForFunction(()=>window.__bbGame.registry.get('lastGhostTape')&&window.__bbGame.scene.isActive('GameOverScene'),null,{timeout:natural?75000:20000});
 const result=await p.evaluate(async()=>{
  const game=window.__bbGame,tape=game.registry.get('lastGhostTape');
  const {createGhostLink,parseGhostLink,GhostLinkError}=await import('/src/systems/ghost/GhostLink.js');
  const t={id:tape.runId,seed:tape.seed,mode:tape.mode,simRevision:tape.simRevision,endTick:tape.endTick,traceLength:tape.trace.length,inputs:tape.inputs.length};
  let defaultStatus='ok';try{await createGhostLink(tape,location.href);}catch(e){if(e instanceof GhostLinkError)defaultStatus=e.code;else throw e;}
  const link=await createGhostLink(tape,location.href);const candidate=await parseGhostLink(link);
  if(candidate.trust!=='unverified-local-practice'||candidate.canCreditScore||candidate.canCreditWallet||candidate.tape.seed!==tape.seed||candidate.tape.trace!==tape.trace||candidate.tape.inputs.length!==tape.inputs.length||candidate.tape.runId===tape.runId)throw Error('Real tape link not preserved safely');
  return {original:t,linkLength:link.length,defaultStatus,decoded:{trust:candidate.trust,runId:candidate.tape.runId,seed:candidate.tape.seed,traceLength:candidate.tape.trace.length,inputs:candidate.tape.inputs.length,canCreditScore:candidate.canCreditScore}};
 });
 if(errors.length)throw Error('Browser errors '+JSON.stringify(errors));
 console.log('PASS_REAL_GHOST_LINK_ROUNDTRIP',JSON.stringify({result,errors}));
}finally{if(browser)await browser.close();if(vite)await vite.close();}
