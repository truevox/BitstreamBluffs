/** #69: Real SIM9 natural tape captured in Chromium, compressed URL-fragment round-trip. */
import {createServer,preview} from 'vite';
import {resolve} from 'node:path';
import {createGhostLink,parseGhostLink,GhostLinkError} from '../src/systems/ghost/GhostLink.js';
import {chromium} from 'playwright';
const natural=process.env.BSB_LINK_NATURAL==='1',base=process.env.BSB_LINK_BASE||'/';
const mobile=process.env.BSB_LINK_MOBILE==='1';
let vite,browser;
try{
 const dist=process.env.BSB_LINK_DIST;
 if(dist) vite=await preview({root:process.cwd(),base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 else {vite=await createServer({base,server:{host:'127.0.0.1',port:0,strictPort:true}});await vite.listen();}
 const origin='http://127.0.0.1:'+vite.httpServer.address().port+base;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext(mobile?{viewport:{width:412,height:915},deviceScaleFactor:2,isMobile:true,hasTouch:true}: {viewport:{width:1000,height:540}}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{window.__ghostCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__ghostCopies.push(text);}}});});
 await p.goto(origin,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:40000});
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
 const ui=await p.evaluate(()=>{const v=window.__bbGame.scene.getScene('GameOverScene').ghostView,copy=window.__ghostCopies[0];return{copiedLength:copy.length,copies:window.__ghostCopies.length,armed:v._shareArmed,notice:v.status.main.text,copy};});
 const copiedCandidate=await parseGhostLink(ui.copy);
 if(ui.copies!==1||ui.armed||copiedCandidate.trust!=='unverified-local-practice'||copiedCandidate.canCreditScore)throw Error('Explicit copy did not safely complete '+JSON.stringify(ui));
 // Genuine keyboard navigation also reaches SHARE, but no clipboard write
 // happens until a second explicit confirmation (Escape must disarm/close).
 await p.keyboard.press('ArrowUp');await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene').ghostView?._shareArmed,null,{timeout:12000});
 const keyboard=await p.evaluate(()=>{const v=window.__bbGame.scene.getScene('GameOverScene').ghostView;return{focus:v.focus,armed:v._shareArmed,copies:window.__ghostCopies.length};});
 if(!keyboard.armed||keyboard.copies!==1||keyboard.focus!==5)throw Error('Keyboard share consent failed '+JSON.stringify(keyboard));
 await p.keyboard.press('Escape');
 await p.waitForFunction(()=>!window.__bbGame.scene.getScene('GameOverScene').ghostView,null,{timeout:10000});
 if(await p.evaluate(()=>window.__ghostCopies.length)!==1)throw Error('Cancelled keyboard share copied unexpectedly');

 const original=await p.evaluate(()=>window.__bbGame.registry.get('lastGhostTape'));
 const defaultLink=await createGhostLink(original,origin);
 const candidate=await parseGhostLink(defaultLink);
 if(candidate.trust!=='unverified-local-practice'||candidate.canCreditScore||candidate.canCreditWallet||
  candidate.tape.seed!==original.seed||candidate.tape.trace!==original.trace||
  candidate.tape.inputs.length!==original.inputs.length||candidate.tape.runId===original.runId)
  throw Error('Real tape link not preserved safely');
 const result={original:{id:original.runId,seed:original.seed,mode:original.mode,
  simRevision:original.simRevision,endTick:original.endTick,traceLength:original.trace.length,
  inputs:original.inputs.length},linkLength:defaultLink.length,defaultStatus:'ok',decoded:{
   trust:candidate.trust,runId:candidate.tape.runId,seed:candidate.tape.seed,
   traceLength:candidate.tape.trace.length,inputs:candidate.tape.inputs.length,
   canCreditScore:candidate.canCreditScore}};
 // Explicit incoming-link path: Title -> Enter Seed -> Open Ghost Link.
 // A valid URL in a text box must not parse or persist until PREVIEW.
 await p.evaluate(()=>window.__bbGame.scene.getScene('GameOverScene').toTitle());
 await p.waitForFunction(()=>window.__bbGame.scene.isActive('TitleScene'),null,{timeout:14000});
 await p.evaluate(()=>window.__bbGame.scene.getScene('TitleScene')._openSeed());
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.ghostLinkBtn,null,{timeout:8000});
 const clickPoint=async(which)=>p.evaluate(which=>{
  const g=window.__bbGame,s=g.scene.getScene('TitleScene'),v=s.view,z=v[which].zone,
   pt=z.getWorldTransformMatrix().transformPoint(z.width/2,z.height/2),rect=document.querySelector('canvas').getBoundingClientRect();
  return {x:rect.left+pt.x/g.scale.gameSize.width*rect.width,y:rect.top+pt.y/g.scale.gameSize.height*rect.height};
 },which);
 const openPoint=await clickPoint('ghostLinkBtn');
 await p.waitForTimeout(500);
 await p.mouse.click(openPoint.x,openPoint.y);
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.previewBtn,null,{timeout:8000});
 const beforehand=await p.evaluate(()=>{
  const g=window.__bbGame,v=g.scene.getScene('TitleScene').view,lib=g.registry.get('ghostLibrary'),store=g.registry.get('saveStore');
  return {loaded:!!v.tape,preview:!!v.preview,courses:lib?.courses?.size,tapes:lib?.tapes?.size,runs:store?.runs?.length};
 });
 if(beforehand.loaded||beforehand.preview)throw Error('Guest auto-imported without consent '+JSON.stringify(beforehand));
 await p.locator('textarea').fill(await p.evaluate(()=>window.__ghostCopies[0]));
 const filled=await p.evaluate(()=>({loaded:!!window.__bbGame.scene.getScene('TitleScene').view?.tape,field:document.querySelector('textarea')?.value.length}));
 if(filled.loaded||filled.field!==ui.copiedLength)throw Error('Filling input performed an implicit import '+JSON.stringify(filled));
 // Press the genuine on-screen PREVIEW button.
 const previewPoint=await clickPoint('previewBtn');
 await p.waitForTimeout(750);
 await p.mouse.click(previewPoint.x,previewPoint.y);
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.preview?.count>0,null,{timeout:12000});
 const previewed=await p.evaluate(()=>{
  const g=window.__bbGame,v=g.scene.getScene('TitleScene').view,lib=g.registry.get('ghostLibrary'),store=g.registry.get('saveStore');
  return {loaded:!!v.tape,count:v.preview?.count,traceX:v.preview?.trace[0],status:v.status.main.text,
   courses:lib?.courses?.size,tapes:lib?.tapes?.size,runs:store?.runs?.length};
 });
 if(!previewed.count||!previewed.status.includes('UNVERIFIED')||previewed.courses!==beforehand.courses||
    previewed.tapes!==beforehand.tapes||previewed.runs!==beforehand.runs)
  throw Error('Preview mutated normal records or failed '+JSON.stringify({beforehand,previewed}));
 const nextPoint=await clickPoint('nextBtn');
 await p.mouse.click(nextPoint.x,nextPoint.y);
 const scrub=await p.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  return {cursor:v.cursor,position:v.position.main.text};
 });
 if(!(scrub.cursor>0)||!scrub.position.includes('UNRANKED'))throw Error('Trace scrub failed '+JSON.stringify(scrub));
 // The paste textarea owns keyboard focus: Ctrl+Right/Left must still scrub,
 // and Ctrl+Shift+Enter must start/pause visual playback without a run.
 await p.locator('textarea').focus();
 await p.keyboard.press('Control+ArrowRight');
 const keyboardScrub=await p.evaluate(()=>({cursor:window.__bbGame.scene.getScene('TitleScene').view?.cursor}));
 if(!(keyboardScrub.cursor>scrub.cursor))throw Error('Keyboard paste-field scrub failed '+JSON.stringify(keyboardScrub));
 await p.keyboard.press('Control+Shift+Enter');
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.playing===true,null,{timeout:8000});
 await p.keyboard.press('Control+Shift+Enter');
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.playing===false,null,{timeout:8000});

 const watchPoint=await clickPoint('playBtn');
 await p.mouse.click(watchPoint.x,watchPoint.y);
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.playing===true,null,{timeout:8000});
 await p.waitForTimeout(500);
 const watching=await p.evaluate(()=>{
  const g=window.__bbGame,v=g.scene.getScene('TitleScene').view;
  return {cursor:v.cursor,playing:v.playing,status:v.status.main.text,running:g.scene.isActive('RunScene')};
 });
 if(watching.cursor<=scrub.cursor||watching.running||!watching.playing)
  throw Error('Read-only guest watch did not advance '+JSON.stringify({scrub,watching}));
 await p.mouse.click(watchPoint.x,watchPoint.y);
 const paused=await p.evaluate(()=>({playing:window.__bbGame.scene.getScene('TitleScene').view?.playing}));
 if(paused.playing)throw Error('Guest playback cannot be paused');
 // Both explicit and live-updated reduced-motion policies must stop animation
 // and keep manual scrubbing available, never start a RunScene.
 const motion=await p.evaluate(()=>{const g=window.__bbGame,settings=g.registry.get('settings');
  const prev=settings.reduceMotion;settings.reduceMotion='on';return prev;});
 await p.mouse.click(watchPoint.x,watchPoint.y);
 const reduced=await p.evaluate(()=>{const v=window.__bbGame.scene.getScene('TitleScene').view;
  return {playing:v.playing,status:v.status.main.text,position:v.position.main.text};});
 if(reduced.playing||!reduced.status.includes('REDUCED MOTION'))
  throw Error('Reduced motion allowed continuous ghost animation '+JSON.stringify(reduced));
 await p.evaluate(prev=>{window.__bbGame.registry.get('settings').reduceMotion=prev;},motion);
 // A malformed replacement cannot leave the previously valid guest selected.
 await p.locator('textarea').fill('https://simulate.sledhead.ing/#bbghost=1.malformed');
 await p.mouse.click(previewPoint.x,previewPoint.y);
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.status?.main?.text?.includes('INCOMPATIBLE'),null,{timeout:10000});
 const invalid=await p.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  return {loaded:!!v.tape,preview:!!v.preview,status:v.status.main.text};
 });
 if(invalid.loaded||invalid.preview)throw Error('Invalid second URL retained prior valid tape '+JSON.stringify(invalid));
 await p.keyboard.press('Escape');
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.ghostLinkBtn,null,{timeout:9000});
 if(await p.locator('textarea').count())throw Error('Guest paste textarea leaked after close');
 // A recipient can visit the shared URL directly. Arrival must NOT auto-parse,
 // persist, or start a guest run; only OPEN GHOST LINK offers the preview.
 const copiedUrl=await p.evaluate(()=>window.__ghostCopies[0]);
 const recipient=await ctx.newPage(),recipientErrors=[];
 recipient.on('pageerror',e=>recipientErrors.push(e.message));
 await recipient.goto(copiedUrl,{waitUntil:'domcontentloaded'});
 await recipient.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:30000});
 const landed=await recipient.evaluate(()=>{
  const g=window.__bbGame,s=g.scene.getScene('TitleScene');
  return {hash:location.hash.startsWith('#bbghost='),view:!!s.view,running:g.scene.isActive('RunScene'),
    hint:s.menu.items.find(x=>x.label==='ENTER SEED')?.sub};
 });
 if(!landed.hash||landed.view||landed.running||!landed.hint.includes('GHOST'))
  throw Error('A URL fragment caused automatic guest activity '+JSON.stringify(landed));
 await recipient.evaluate(()=>window.__bbGame.scene.getScene('TitleScene')._openSeed());
 await recipient.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.ghostLinkBtn,null,{timeout:8000});
 await recipient.locator('input').focus();
 await recipient.keyboard.press('Shift+Enter');
 await recipient.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.previewBtn,null,{timeout:8000});
 const direct=await recipient.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  return {prefilled:v.box.getValue()===location.href,loaded:!!v.tape,
   status:v.status.main.text,length:v.box.getValue().length};
 });
 if(!direct.prefilled||direct.loaded||direct.length!==copiedUrl.length)
  throw Error('Arrived ghost was auto-imported or failed to prefill '+JSON.stringify(direct));
 await recipient.keyboard.press('Control+Enter');
 await recipient.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.preview?.count>0,null,{timeout:12000});
 const accepted=await recipient.evaluate(()=>{
  const g=window.__bbGame,v=g.scene.getScene('TitleScene').view;
  return {status:v.status.main.text,points:v.preview?.count,unverified:!v.tape?.runId?.startsWith('private:'),
   running:g.scene.isActive('RunScene')};
 });
 if(!accepted.points||!accepted.unverified||accepted.running||recipientErrors.length)
  throw Error('Direct hash preview unexpectedly launched gameplay '+JSON.stringify({accepted,recipientErrors}));
 await recipient.close();

 if(errors.length)throw Error('Browser errors '+JSON.stringify(errors));
 console.log('PASS_REAL_GHOST_LINK_ROUNDTRIP',JSON.stringify({result,armed,cancelled,ui:{...ui,copy:undefined,trust:copiedCandidate.trust,credit:copiedCandidate.canCreditScore},keyboard,beforehand,filled,previewed,scrub,keyboardScrub,watching,paused,reduced,invalid,landed,direct,accepted,errors,recipientErrors}));
}finally{if(browser)await browser.close();if(vite){if(typeof vite.close==='function')await vite.close();
else if(vite.httpServer)await new Promise((r,j)=>vite.httpServer.close(e=>e?j(e):r()));}}
