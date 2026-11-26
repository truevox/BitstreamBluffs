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
 // Same CRT animation on the sender side. A fixed wall-clock delay is
 // not a rendered-frame guarantee on a saturated Chromium runner.
 await p.waitForFunction(()=>{
  const v=window.__bbGame.scene.getScene('GameOverScene').ghostView,panel=v?.panel;
  return v?.alive&&v.shareBtn?.zone?.scene&&panel.alpha===1&&panel.scaleX===1&&panel.scaleY===1&&panel.y===Math.round((270-v.h)/2);
 },null,{timeout:15000});
 // Source could be opened with an untrusted path/query; sharing must never
 // copy either into the URL sent to a friend.
 await p.evaluate(()=>history.replaceState(null,'',location.pathname+'my-private-route/?session=secret-session-token'));
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
 const sharedAddress=new URL(ui.copy);
 if(sharedAddress.pathname!==base||sharedAddress.search||sharedAddress.href.includes('private-route')||
    sharedAddress.href.includes('secret-session-token'))
   throw Error('Public share link exposed current private path/query '+sharedAddress.href.slice(0,120));
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
 // The title menu uses an entrance tween. A click can hit the prior
 // translucent scene on a slower runner. Reacquire the real active button
 // center and observe the destination before ANY retry, never issuing extra
 // pointer events after it opens.
 let openedGuest=false;
 for(let attempt=0;attempt<4;attempt++){
  await p.waitForTimeout(420);
  const openPoint=await clickPoint('ghostLinkBtn');
  await p.mouse.click(openPoint.x,openPoint.y);
  try{
   await p.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.previewBtn,null,{timeout:2500});
   openedGuest=true;break;
  }catch{
   if(await p.evaluate(()=>Boolean(window.__bbGame.scene.getScene('TitleScene').view?.previewBtn))){openedGuest=true;break;}
  }
 }
 if(!openedGuest)throw Error('Open Ghost Link did not respond after genuine pointer attempts');
 const beforehand=await p.evaluate(()=>{
  const g=window.__bbGame,v=g.scene.getScene('TitleScene').view,lib=g.registry.get('ghostLibrary'),store=g.registry.get('saveStore');
  return {loaded:!!v.tape,preview:!!v.preview,courses:lib?.courses?.size,tapes:lib?.tapes?.size,runs:store?.runs?.length};
 });
 if(beforehand.loaded||beforehand.preview)throw Error('Guest auto-imported without consent '+JSON.stringify(beforehand));
 await p.locator('textarea').fill(await p.evaluate(()=>window.__ghostCopies[0]));
 const filled=await p.evaluate(()=>({loaded:!!window.__bbGame.scene.getScene('TitleScene').view?.tape,field:document.querySelector('textarea')?.value.length}));
 if(filled.loaded||filled.field!==ui.copiedLength)throw Error('Filling input performed an implicit import '+JSON.stringify(filled));
 // Press the genuine on-screen PREVIEW button. Mobile/CI display scaling
 // and Phaser panel transitions can move its real hit zone between sampling
 // and pointerdown. Never fake a preview, invoke its handler, or claim success
 // until the actual rendered button has accepted a real Playwright click.
 let previewAccepted=false;
 for(let attempt=0;attempt<4;attempt++){
  const ready=await p.evaluate(()=>{
   const v=window.__bbGame.scene.getScene('TitleScene')?.view;
   return {preview:!!v?.preview?.count,busy:v?.busy===true,button:!!v?.previewBtn?.zone?.scene};
  });
  if(ready.preview){previewAccepted=true;break;}
  if(!ready.button)throw Error('PREVIEW button disappeared before pointer consent');
  if(ready.busy){
   // An already accepted asynchronous preview should settle before we
   // consider sending another gesture; retries must not cancel valid work.
   await p.waitForTimeout(1600);
   continue;
  }
  const previewPoint=await clickPoint('previewBtn');
  await p.mouse.move(previewPoint.x,previewPoint.y);
  await p.mouse.click(previewPoint.x,previewPoint.y);
  try{
   await p.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.preview?.count>0,null,{timeout:3300});
   previewAccepted=true;break;
  }catch(e){if(e.name!=='TimeoutError')throw e;}
 }
 if(!previewAccepted){
  const state=await p.evaluate(()=>{
   const v=window.__bbGame.scene.getScene('TitleScene')?.view;
   return {status:v?.status?.main?.text,disabled:v?.previewBtn?.disabled,
    previewCount:v?.preview?.count||0,button:!!v?.previewBtn?.zone?.scene};
  });
  throw Error('Real PREVIEW pointer never produced a decoded guest after four bounded attempts '+JSON.stringify(state));
 }
 const previewed=await p.evaluate(()=>{
  const g=window.__bbGame,v=g.scene.getScene('TitleScene').view,lib=g.registry.get('ghostLibrary'),store=g.registry.get('saveStore');
  return {loaded:!!v.tape,count:v.preview?.count,localCount:v.localPreview?.count,localRole:v.localRole,traceX:v.preview?.trace[0],status:v.status.main.text,
   courses:lib?.courses?.size,tapes:lib?.tapes?.size,runs:store?.runs?.length};
 });
 if(!previewed.count||!previewed.localCount||!previewed.status.includes('LOCAL BEST')||previewed.courses!==beforehand.courses||
    previewed.tapes!==beforehand.tapes||previewed.runs!==beforehand.runs)
  throw Error('Preview mutated normal records or failed '+JSON.stringify({beforehand,previewed}));
 const nextPoint=await clickPoint('nextBtn');
 await p.mouse.click(nextPoint.x,nextPoint.y);
 const scrub=await p.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  return {cursor:v.cursor,position:v.position.main.text,localCount:v.localPreview?.count};
 });
 if(!(scrub.cursor>0)||!scrub.position.includes('UNRANKED')||!scrub.position.includes('GAP'))throw Error('Guest/local comparison scrub failed '+JSON.stringify(scrub));
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
 // Same seed + mask is insufficient: Normal vs Daily cannot show a fake
 // local head-to-head. Guest preview remains available, unverified and read-only.
 const wrongMode=await createGhostLink({...original,mode:'daily',dailyRuleId:'other-day',
  dailyRuleSource:'rotation'},origin);
 await p.locator('textarea').fill(wrongMode);
 await p.keyboard.press('Control+Enter');
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.preview?.count>0,null,{timeout:12000});
 const incompatible=await p.evaluate(()=>{
  const g=window.__bbGame,v=g.scene.getScene('TitleScene').view,lib=g.registry.get('ghostLibrary'),store=g.registry.get('saveStore');
  return {status:v.status.main.text,local:!!v.localPreview,guest:!!v.preview,
   courses:lib?.courses?.size,tapes:lib?.tapes?.size,runs:store?.runs?.length};
 });
 if(!incompatible.guest||incompatible.local||!incompatible.status.includes('LOCAL RULES DIFFER')||
    incompatible.courses!==beforehand.courses||incompatible.tapes!==beforehand.tapes||
    incompatible.runs!==beforehand.runs)
  throw Error('Incompatible local course falsely compared or modified saves '+JSON.stringify(incompatible));
 // Adversarial self-authored link: anyone can invent a high score and shift
 // all input trace positions by +5 metres. The viewer MUST compare visually
 // while never granting score, evidence or local-ghost identity.
 const shiftedTrace=Buffer.from(original.trace,'base64');
 for(let i=0;i<shiftedTrace.length;i+=12)
  shiftedTrace.writeFloatLE(shiftedTrace.readFloatLE(i)+100,i);
 const fake=await createGhostLink({...original,score:99999999,
   trace:shiftedTrace.toString('base64')},origin);
 const fakeCandidate=await parseGhostLink(fake);
 if(fakeCandidate.canCreditScore||fakeCandidate.canCreditWallet||fakeCandidate.canSubmitOfficial)
  throw Error('Forged URL unexpectedly gained entitlement');
 await p.locator('textarea').fill(fake);
 await p.keyboard.press('Control+Enter');
 await p.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.preview?.count>0,null,{timeout:12000});
 const forged=await p.evaluate(()=>{
  const g=window.__bbGame,v=g.scene.getScene('TitleScene').view,lib=g.registry.get('ghostLibrary'),store=g.registry.get('saveStore');
  return {status:v.status.main.text,position:v.position.main.text,localRole:v.localRole,
   courses:lib?.courses?.size,tapes:lib?.tapes?.size,runs:store?.runs?.length};
 });
 if(!forged.position.includes('GAP +5M')||!forged.status.includes('UNVERIFIED')||
  forged.runs!==beforehand.runs||forged.tapes!==beforehand.tapes)
  throw Error('Forged guest score affected local evidence or compare rendering '+JSON.stringify(forged));
 // Typing in the paste field must IMMEDIATELY invalidate a previously
 // accepted guest, even before the user presses PREVIEW again.
 await p.locator('textarea').fill('https://simulate.sledhead.ing/#bbghost=1.malformed');
 const edited=await p.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  return {loaded:!!v.tape,local:!!v.localPreview,playing:v.playing,
   busy:v.busy,status:v.status.main.text};
 });
 if(edited.loaded||edited.local||edited.playing||edited.busy||!edited.status.includes('LINK CHANGED'))
  throw Error('Edited untrusted field retained previous guest '+JSON.stringify(edited));
 // Delay the optional local-library READ after successful parsing. Editing
 // during this await must invalidate the generation and never resurrect the
 // prior guest when the old async work finally resolves.
 await p.evaluate(()=>{
  const lib=window.__bbGame.registry.get('ghostLibrary');
  window.__originalGuestLookup=lib.ghostsFor.bind(lib);
  lib.ghostsFor=()=>new Promise(resolve=>{window.__guestLookupResolve=resolve;});
 });
 await p.locator('textarea').fill(ui.copy);
 await p.keyboard.press('Control+Enter');
 await p.waitForFunction(()=>typeof window.__guestLookupResolve==='function',null,{timeout:10000});
 await p.locator('textarea').fill('https://simulate.sledhead.ing/#bbghost=1.malformed');
 const pendingEdit=await p.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  const lib=window.__bbGame.registry.get('ghostLibrary');
  window.__guestLookupResolve([]);
  lib.ghostsFor=window.__originalGuestLookup;
  return {loaded:!!v.tape,busy:v.busy,preview:!!v.preview,status:v.status.main.text};
 });
 await p.waitForTimeout(150);
 const stale=await p.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  return {loaded:!!v.tape,preview:!!v.preview,status:v.status.main.text};
 });
 if(pendingEdit.busy||pendingEdit.loaded||stale.loaded||stale.preview||
   !stale.status.includes('LINK CHANGED'))
  throw Error('Stale async guest validation restored edited-away content '+JSON.stringify({pendingEdit,stale}));
 const invalidPreviewPoint=await clickPoint('previewBtn');
 await p.mouse.click(invalidPreviewPoint.x,invalidPreviewPoint.y);
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
 const recipientCtx=await browser.newContext(mobile?{viewport:{width:412,height:915},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1000,height:540}});
 const recipient=await recipientCtx.newPage(),recipientErrors=[];
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
 // The failing CI path is the mobile opt-in race. Freeze the real CRT open
 // tween before constructing this view, then hold it partway open until the
 // stable-target wait observes and rejects the moving geometry below.
 const slowRaceOpen=mobile&&process.env.BSB_GUEST_PRACTICE==='1';
 if(slowRaceOpen)await recipient.evaluate(()=>{
  const t=window.__bbGame.scene.getScene('TitleScene');
  window.__raceOldTweens=t.tweens.getTweens();
  t.tweens.timeScale=0;
 });
 await recipient.keyboard.press('Shift+Enter');
 await recipient.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.previewBtn,null,{timeout:8000});
 const direct=await recipient.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  return {prefilled:v.box.getValue()===location.href,loaded:!!v.tape,
   status:v.status.main.text,length:v.box.getValue().length};
 });
 if(!direct.prefilled||direct.loaded||direct.length!==copiedUrl.length)
  throw Error('Arrived ghost was auto-imported or failed to prefill '+JSON.stringify(direct));
 await recipient.locator('textarea').focus();
 await recipient.keyboard.press('Control+Enter');
 await recipient.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.preview?.count>0,null,{timeout:12000});
 const accepted=await recipient.evaluate(()=>{
  const g=window.__bbGame,v=g.scene.getScene('TitleScene').view;
  return {status:v.status.main.text,points:v.preview?.count,localCount:v.localPreview?.count||0,unverified:!v.tape?.runId?.startsWith('private:'),
   running:g.scene.isActive('RunScene')};
 });
 if(!accepted.points||accepted.localCount!==0||!accepted.unverified||accepted.running||recipientErrors.length)
  throw Error('Direct hash preview unexpectedly launched gameplay '+JSON.stringify({accepted,recipientErrors}));
 let practiceAcceptance=null;
 if(process.env.BSB_GUEST_PRACTICE==='1'){
  // Authoritative denial proof on a genuine freshly decoded incoming link.
  const before=await recipient.evaluate(async()=>{
   const g=window.__bbGame,r=g.registry,s=r.get('saveStore'),p=r.get('progression'),lib=r.get('ghostLibrary');
   window.__practiceEvents=[];
   g.events.on('bb:runEnd',()=>window.__practiceEvents.push('RUN_END'));
   g.events.on('bb:runAbort',v=>window.__practiceEvents.push('RUN_ABORT:'+v.reason));
   return {runs:JSON.stringify(await s.getRecentRuns(1000)),profile:JSON.stringify(p.store.profile),
    courses:lib.courses.size,tapes:lib.tapes.size,lastRecord:r.get('lastRecord')?.id||null,
    lastTape:r.get('lastGhostTape')?.runId||null};
  });
  // The preview can finish while the CRT opening animation is still moving
  // the panel (even while alpha is zero). Never sample a hitbox during that
  // transition: a stale Race coordinate can hit BACK instead. Preserve the
  // actual view identity and require a stable, visible canvas hit target.
  await recipient.evaluate(()=>{
   const t=window.__bbGame.scene.getScene('TitleScene'),v=t.view;
   window.__raceView=v;
   window.__racePointerTrace=[];
   const record=(kind,p)=>{if(window.__racePointerTrace.length<16)window.__racePointerTrace.push({kind,x:p?.x,y:p?.y});};
   v.practiceBtn.zone.on('pointerdown',p=>record('race',p));
   v.back.zone.on('pointerdown',p=>record('back',p));
   v.panel.once('destroy',()=>record('destroy'));
  });
  if(slowRaceOpen){
   // Recreate the measured red geometry using Phaser's actual open tween.
   // At ~0.74 scale the nominal full-size Race center lies inside BACK.
   // Do not click the stale coordinates: the production test must WAIT.
   const held=await recipient.evaluate(()=>{
    const g=window.__bbGame,t=g.scene.getScene('TitleScene'),v=t.view;
    const tween=t.tweens.getTweens().find(x=>!window.__raceOldTweens.includes(x)&&x.data?.[0]?.duration===260);
    if(!tween)throw Error('Missing real Ghost CRT open tween');
    const center=b=>{const z=b.zone;return z.getWorldTransformMatrix().transformPoint(z.width/2,z.height/2);};
    const stale=center(v.practiceBtn);
    t.tweens.timeScale=1;
    try{tween.seek(122,1,true);}finally{t.tweens.timeScale=0;}
    const back=center(v.back);
    const backZone=v.back.zone,scale=v.panel.scaleY;
    return {scale,alpha:v.panel.alpha,stale:{x:stale.x,y:stale.y},back:{x:back.x,y:back.y},
     staleHitsBack:Math.abs(stale.x-back.x)<backZone.width/2&&Math.abs(stale.y-back.y)<backZone.height*scale/2};
   });
   if(!(held.scale>0&&held.scale<1)||!held.staleHitsBack)
    throw Error('Slow-open control did not reproduce stale Race -> BACK geometry '+JSON.stringify(held));
   console.log('RACE_SLOW_OPEN_CONTROL',JSON.stringify(held));
  }
  const raceState=()=>recipient.evaluate(()=>{
   const g=window.__bbGame,t=g.scene.getScene('TitleScene'),v=t.view,original=window.__raceView;
   return {armed:v?.practiceArmed===true,text:v?.status?.main?.text||null,
    label:v?.practiceBtn?.label?.main?.text||null,view:!!v,sameView:v===original,
    alive:v?.alive===true,zone:!!v?.practiceBtn?.zone?.scene,
    disabled:v?.practiceBtn?.disabled,busy:v?.busy,alpha:v?.panel?.alpha,
    scaleY:v?.panel?.scaleY,panelY:v?.panel?.y,
    running:g.scene.isActive('RunScene'),starting:t.starting===true,trace:window.__racePointerTrace};
  });
  const practicePoint=async()=>{
   // Check consecutive rendered frames, not elapsed wall-clock time. Slow
   // Chromium may take much longer than the 260 ms animation duration.
   await recipient.evaluate(()=>{window.__raceStable={key:null,frames:0,blocked:0};});
   await recipient.waitForFunction(()=>{
    const g=window.__bbGame,t=g.scene.getScene('TitleScene'),v=t.view,z=v?.practiceBtn?.zone,panel=v?.panel;
    if(v!==window.__raceView||!v?.alive||!z?.scene||t.starting||g.scene.isActive('RunScene'))
     throw Error('Guest preview replaced before explicit consent');
    if(v.busy||v.practiceBtn.disabled||panel.alpha!==1||panel.scaleX!==1||panel.scaleY!==1||panel.y!==18){
     window.__raceStable={key:null,frames:0,blocked:window.__raceStable.blocked+1};return false;
    }
    const p=z.getWorldTransformMatrix().transformPoint(z.width/2,z.height/2),r=g.canvas.getBoundingClientRect();
    const point={x:r.left+p.x/g.scale.gameSize.width*r.width,y:r.top+p.y/g.scale.gameSize.height*r.height};
    if(document.elementFromPoint(point.x,point.y)!==g.canvas){
     window.__raceStable={key:null,frames:0,blocked:window.__raceStable.blocked+1};return false;
    }
    const key=JSON.stringify({point,left:r.left,top:r.top,width:r.width,height:r.height});
    const old=window.__raceStable;
    window.__raceStable={key,frames:old.key===key?old.frames+1:1,point,blocked:old.blocked};
    return window.__raceStable.frames>=3;
   },null,{timeout:15000,polling:'raf'}).catch(async e=>{
    throw Error('Race Guest never became a stable rendered target '+JSON.stringify(await raceState()),{cause:e});
   });
   return recipient.evaluate(()=>window.__raceStable.point);
  };
  const allowed=await raceState();
  if(allowed.disabled||!allowed.sameView||!allowed.zone)throw Error('Eligible NORMAL guest was refused by practice policy '+JSON.stringify(allowed));
  // Exactly ONE first activation. Wait for observed consent, never retry a
  // click which might still be queued and then count as a confirmation.
  const firstPointPromise=practicePoint();
  if(slowRaceOpen){
   // Confirm the actual wait has refused at least one partial-open frame
   // before letting the real animation finish. No synthetic consent.
   try{
    await recipient.waitForFunction(()=>window.__raceStable?.blocked>0,null,{timeout:8000});
    console.log('PASS_RACE_TARGET_REJECTS_PARTIAL_OPEN');
   }finally{
    await recipient.evaluate(()=>{window.__bbGame.scene.getScene('TitleScene').tweens.timeScale=1;});
   }
  }
  const firstPoint=await firstPointPromise;
  await recipient.mouse.click(firstPoint.x,firstPoint.y);
  await recipient.waitForFunction(()=>{
   const g=window.__bbGame,t=g.scene.getScene('TitleScene'),v=t.view;
   return v?.practiceArmed===true||v!==window.__raceView||t.starting||g.scene.isActive('RunScene');
  },null,{timeout:10000}).catch(async e=>{
   throw Error('First Race Guest click did not arm '+JSON.stringify(await raceState()),{cause:e});
  });
  const armedRace=await raceState();
  if(!armedRace.sameView||!armedRace.alive||!armedRace.zone||!armedRace.armed||armedRace.running||armedRace.starting||
     !armedRace.text?.includes('NO XP')||armedRace.label!=='CONFIRM RACE'||
     armedRace.trace.filter(x=>x.kind==='race').length!==1||armedRace.trace.some(x=>x.kind==='back'||x.kind==='destroy'))
   throw Error('Unranked double-consent gate failed '+JSON.stringify(armedRace));
  // A fresh rendered hitbox and an explicitly distinct second click.
  const confirmPoint=await practicePoint();
  await recipient.mouse.click(confirmPoint.x,confirmPoint.y);
  await recipient.waitForFunction(()=>window.__bbGame?.scene?.isActive('RunScene')&&
    window.__bbGame.scene.getScene('RunScene').guestPractice===true&&
    window.__bbGame.scene.getScene('RunScene').sled?.body,null,{timeout:40000});
  const live=await recipient.evaluate(()=>{
   const g=window.__bbGame,r=g.scene.getScene('RunScene'),ui=g.scene.getScene('UIScene');
   return {seed:r.seed,mask:r.biomeMask,practice:r.guestPractice,recorder:!!r.ghostRecorder,
    tapePlayer:!!r.tapePlayer,ghosts:r.ghostRiders?.length,guestRoles:r.ghostRiders?.[0]?.roles,
    dailyOfficial:r.dailyOfficial,registryPending:!!g.registry.get('guestPracticeTape'),
    tag:ui?.practiceTag?.visible,tagText:ui?.practiceTag?.main?.text};
  });
  if(live.seed!==copiedCandidate.tape.seed||live.mask!==copiedCandidate.tape.biomeMask||
     live.recorder||live.tapePlayer||live.ghosts!==1||live.guestRoles?.[0]!=='guest'||
     live.dailyOfficial||live.registryPending||!live.tag)
   throw Error('Guest run admitted to ranking/replay or not visible '+JSON.stringify(live));
  // Both the short-URL and local-file guest transport share this RunScene
  // admission: session hints may change in RAM but cannot consume device-wide
  // normal-play tutorial progress or the tuck reminder limit.
  const guestHints=await recipient.evaluate(()=>{
   const r=window.__bbGame.scene.getScene('RunScene');
   localStorage.removeItem('bb.tutorialDone');
   localStorage.removeItem('bb.tuckShows');
   r.tutDone.delete('push');r.tutDoneId('push');
   r.applyHintEvents([{id:'tuck',show:true}]);
   return {inMemoryDone:r.tutDone.has('push'),inMemoryShows:r.tuckShows,
    tutorial:localStorage.getItem('bb.tutorialDone'),tuck:localStorage.getItem('bb.tuckShows')};
  });
  if(!guestHints.inMemoryDone||guestHints.inMemoryShows<1||guestHints.tutorial!==null||guestHints.tuck!==null)
   throw Error('Short-link guest practice leaked device tutorial/tuck history '+JSON.stringify(guestHints));
  console.log('PASS_SHORT_GHOST_PRACTICE_HINTS_EPHEMERAL',JSON.stringify(guestHints));
  await recipient.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene').simClock.tick>=85,null,{timeout:30000});
  const tick=await recipient.evaluate(()=>{
   const r=window.__bbGame.scene.getScene('RunScene');
   return {tick:r.simClock.tick,visible:r.ghostRiders?.[0]?.visible,runId:r.runId};
  });
  if(!tick.visible)throw Error('Guest trace was not drawn during live player control '+JSON.stringify(tick));
  await recipient.evaluate(()=>{const r=window.__bbGame.scene.getScene('RunScene');
    r.bsod.wallX=r.sled.body.bounds.min.x-2;r.bsod.wallSpeedPxS=10000;});
  await recipient.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
    !window.__bbGame.scene.isActive('RunScene'),null,{timeout:25000});
  const after=await recipient.evaluate(async()=>{
   const g=window.__bbGame,r=g.registry,s=r.get('saveStore'),p=r.get('progression'),lib=r.get('ghostLibrary');
   return {runs:JSON.stringify(await s.getRecentRuns(1000)),profile:JSON.stringify(p.store.profile),
    courses:lib.courses.size,tapes:lib.tapes.size,lastRecord:r.get('lastRecord')?.id||null,
    lastTape:r.get('lastGhostTape')?.runId||null,
    events:window.__practiceEvents,gameOver:g.scene.isActive('GameOverScene')};
  });
  const guestHintDisk=await recipient.evaluate(()=>({
   tutorial:localStorage.getItem('bb.tutorialDone'),tuck:localStorage.getItem('bb.tuckShows')
  }));
  if(guestHintDisk.tutorial!==null||guestHintDisk.tuck!==null)
   throw Error('Short-link guest practice wrote first-run hints after exit '+JSON.stringify(guestHintDisk));
  const {events,gameOver,...durable}=after;
  if(JSON.stringify(durable)!==JSON.stringify(before)||events.includes('RUN_END')||
     !events.includes('RUN_ABORT:guest-practice-ended')||gameOver)
   throw Error('Guest run mutated persistent profile/records or leaked ranked end '+JSON.stringify({before,after}));
  practiceAcceptance={before:{runs:before.runs,profileBytes:before.profile.length,courses:before.courses,tapes:before.tapes},
   armedRace,live,guestHints,tick,after:{runs:after.runs,profileBytes:after.profile.length,courses:after.courses,tapes:after.tapes,
   events,gameOver},zeroDurableMutation:true};
  if(process.env.BSB_GUEST_PRACTICE_RESTART==='1'){
   // Reopen the SAME verified link, then restart/quit through genuine PauseScene
   // lifecycle. Neither restart nor ordinary Title launch may inherit ranking.
   await recipient.evaluate(()=>window.__bbGame.scene.getScene('TitleScene')._openGhostLink());
   await recipient.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.practiceBtn,null,{timeout:10000});
   await recipient.keyboard.press('Control+Enter');
   await recipient.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.preview?.count>0,null,{timeout:14000});
   // The textbox owns a native keyboard shortcut; Ctrl+Alt+Enter must arm,
   // then a SECOND chord must start. Avoid Chrome's reserved Ctrl+Shift+R.
   let keyboardArmed=false,keyboardAttempts=0;
   for(;keyboardAttempts<5;keyboardAttempts++){
    // The first native text-input event after the closing scene's animation
    // sometimes goes to the previous focus owner in Chromium/CI. Refocus and
    // observe the actual armed UI after each real shortcut; never send a
    // second chord once the first confirmation is accepted.
    await recipient.locator('textarea').focus();
    await recipient.waitForTimeout(160);
    await recipient.keyboard.press('Control+Alt+Enter');
    keyboardArmed=await recipient.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').view?.practiceArmed===true);
    if(keyboardArmed)break;
   }
   if(!keyboardArmed)throw Error('Native Ctrl+Alt+Enter never armed guest after 5 real key events');
   if(await recipient.evaluate(()=>window.__bbGame.scene.isActive('RunScene')))
    throw Error('Keyboard guest race started before a second consent');
   await recipient.keyboard.press('Control+Alt+Enter');
   await recipient.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene')&&
     window.__bbGame.scene.getScene('RunScene').guestPractice===true,null,{timeout:40000});
   await recipient.evaluate(()=>window.__bbGame.scene.getScene('RunScene').pauseRun());
   await recipient.waitForFunction(()=>window.__bbGame.scene.isActive('PauseScene'),null,{timeout:12000});
   const paused=await recipient.evaluate(()=>{
    const g=window.__bbGame,p=g.scene.getScene('PauseScene');
    return {guest:p.guestPractice,gymUi:p.gymPractice,runActive:g.scene.isActive('RunScene'),
      uiTitle:p.panel?.title?.main?.text||null};
   });
   if(!paused.guest||!paused.gymUi)throw Error('Pause failed to label guest as unranked '+JSON.stringify(paused));
   await recipient.evaluate(()=>window.__bbGame.scene.getScene('PauseScene').restart());
   await recipient.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene')&&
     window.__bbGame.scene.getScene('RunScene').guestPractice===true&&
     window.__bbGame.scene.getScene('RunScene').sled?.body,null,{timeout:40000});
   const restarted=await recipient.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    return {practice:r.guestPractice,guest:r.ghostRiders?.length,recorder:!!r.ghostRecorder,
      scoreEvents:window.__practiceEvents.filter(e=>e==='RUN_END').length};
   });
   if(!restarted.practice||restarted.guest!==1||restarted.recorder||restarted.scoreEvents)
    throw Error('Pause restart promoted guest to ranked run '+JSON.stringify(restarted));
   await recipient.evaluate(()=>window.__bbGame.scene.getScene('RunScene').pauseRun());
   await recipient.waitForFunction(()=>window.__bbGame.scene.isActive('PauseScene'),null,{timeout:12000});
   await recipient.evaluate(()=>window.__bbGame.scene.getScene('PauseScene').quit());
   await recipient.waitForFunction(()=>window.__bbGame.scene.isActive('TitleScene')&&
     !window.__bbGame.scene.isActive('RunScene'),null,{timeout:20000});
   await recipient.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('normal-after-guest'));
   await recipient.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene')&&
     window.__bbGame.scene.getScene('RunScene').sled?.body,null,{timeout:40000});
   const normal=await recipient.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    return {seed:r.seed,practice:r.guestPractice,recorder:!!r.ghostRecorder,
      guestRiders:r.ghostRiders?.length,registryPending:!!g.registry.get('guestPracticeTape')};
   });
   if(normal.seed!=='normal-after-guest'||normal.practice||!normal.recorder||
      normal.registryPending)throw Error('Ordinary run inherited guest practice state '+JSON.stringify(normal));
   practiceAcceptance.pauseRestart={paused,restarted,normal};
  }
 }
 await recipient.close();await recipientCtx.close();

 if(errors.length)throw Error('Browser errors '+JSON.stringify(errors));
 console.log('PASS_REAL_GHOST_LINK_ROUNDTRIP',JSON.stringify({result,armed,cancelled,ui:{...ui,copy:undefined,trust:copiedCandidate.trust,credit:copiedCandidate.canCreditScore},keyboard,beforehand,filled,previewed,scrub,keyboardScrub,watching,paused,reduced,incompatible,forged,edited,pendingEdit,stale,invalid,landed,direct,accepted,practiceAcceptance,errors,recipientErrors}));
}finally{if(browser)await browser.close();if(vite){if(typeof vite.close==='function')await vite.close();
else if(vite.httpServer)await new Promise((r,j)=>vite.httpServer.close(e=>e?j(e):r()));}}
