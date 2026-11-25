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
 await p.addInitScript(()=>{window.__ghostCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__ghostCopies.push(text);}}});});
 await p.goto(origin+'/',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:40000});
 await p.evaluate(natural=>window.__bbGame.scene.getScene('TitleScene').startRun(natural?'sim-05@0':'ghost-link-proof@0'),natural);
 await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('RunScene')&&window.__bbGame.scene.getScene('RunScene').sled?.body,null,{timeout:30000});
 if(!natural){
  await p.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene').simClock.tick>=140,null,{timeout:20000});
  await p.evaluate(()=>{const r=window.__bbGame.scene.getScene('RunScene');r.bsod.wallX=r.sled.body.bounds.min.x-2;r.bsod.wallSpeedPxS=10000;});
 }
 await p.waitForFunction(()=>window.__bbGame.registry.get('lastGhostTape')&&window.__bbGame.scene.isActive('GameOverScene'),null,{timeout:natural?75000:20000});
 // Actual Game Over ghost screen: first activation only discloses the
 // potential contents. Second activation explicitly copies the URL.
 await p.evaluate(()=>window.__bbGame.scene.getScene('GameOverScene')._openGhosts());
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene').ghostView?.shareBtn,null,{timeout:12000});
 await p.waitForTimeout(450);
 const target=await p.evaluate(()=>{
  const g=window.__bbGame,scene=g.scene.getScene('GameOverScene'),v=scene.ghostView,z=v.shareBtn.zone;
  const pt=z.getWorldTransformMatrix().transformPoint(z.width/2,z.height/2),rect=document.querySelector('canvas').getBoundingClientRect();
  return {x:rect.left+pt.x/g.scale.gameSize.width*rect.width,y:rect.top+pt.y/g.scale.gameSize.height*rect.height};
 });
 await p.mouse.click(target.x,target.y);
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene').ghostView?._shareArmed,null,{timeout:16000});
 const armed=await p.evaluate(()=>{const v=window.__bbGame.scene.getScene('GameOverScene').ghostView;return{armed:v._shareArmed,button:v.shareBtn.label.main.text,notice:v.status.main.text,copies:window.__ghostCopies.length};});
 if(!armed.armed||armed.copies!==0||!armed.notice?.includes('SHARES INPUTS'))throw Error('Share permission gate failed '+JSON.stringify(armed));
 // Any navigation away from SHARE must cancel the armed disclosure.
 const cancelled=await p.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('GameOverScene').ghostView;
  v.handleAction('up');v.handleAction('down');
  return {focus:v.focus,armed:v._shareArmed,button:v.shareBtn.label.main.text,copies:window.__ghostCopies.length};
 });
 if(cancelled.armed||cancelled.button!=='SHARE LINK'||cancelled.copies!==0)throw Error('Navigating away did not disarm share '+JSON.stringify(cancelled));
 await p.mouse.click(target.x,target.y);
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene').ghostView?._shareArmed,null,{timeout:15000});
 if(await p.evaluate(()=>window.__ghostCopies.length)!==0)throw Error('Disarmed share auto-copied');
 await p.mouse.click(target.x,target.y);
 await p.waitForFunction(()=>window.__ghostCopies.length===1,null,{timeout:8000});
 const ui=await p.evaluate(async()=>{const v=window.__bbGame.scene.getScene('GameOverScene').ghostView,copy=window.__ghostCopies[0];const{parseGhostLink}=await import('/src/systems/ghost/GhostLink.js');const unverified=await parseGhostLink(copy);return{copiedLength:copy.length,copies:window.__ghostCopies.length,armed:v._shareArmed,notice:v.status.main.text,trust:unverified.trust,credit:unverified.canCreditScore};});
 if(ui.copies!==1||ui.armed||ui.trust!=='unverified-local-practice'||ui.credit)throw Error('Explicit copy did not safely complete '+JSON.stringify(ui));
 // Genuine keyboard navigation also reaches SHARE, but no clipboard write
 // happens until a second explicit confirmation (Escape must disarm/close).
 await p.keyboard.press('ArrowUp');await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene').ghostView?._shareArmed,null,{timeout:12000});
 const keyboard=await p.evaluate(()=>{const v=window.__bbGame.scene.getScene('GameOverScene').ghostView;return{focus:v.focus,armed:v._shareArmed,copies:window.__ghostCopies.length};});
 if(!keyboard.armed||keyboard.copies!==1||keyboard.focus!==5)throw Error('Keyboard share consent failed '+JSON.stringify(keyboard));
 await p.keyboard.press('Escape');
 await p.waitForFunction(()=>!window.__bbGame.scene.getScene('GameOverScene').ghostView,null,{timeout:10000});
 if(await p.evaluate(()=>window.__ghostCopies.length)!==1)throw Error('Cancelled keyboard share copied unexpectedly');

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
 console.log('PASS_REAL_GHOST_LINK_ROUNDTRIP',JSON.stringify({result,armed,cancelled,ui,keyboard,errors}));
}finally{if(browser)await browser.close();if(vite)await vite.close();}
