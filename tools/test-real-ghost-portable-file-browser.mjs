/** #69 — genuine local download + native chooser + unranked guest practice.
 * Uses a real short normal run as the donor. Its trace is lengthened with
 * finite deterministic synthetic samples to exercise the >8k transport gate,
 * NOT to claim an authoritative long-played game result. */
import {createServer,preview} from 'vite';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createGhostLink,parseGhostFile,createGhostFile,GHOST_LINK_MAX_URL} from '../src/systems/ghost/GhostLink.js';

const base=process.env.BSB_LINK_BASE||'/';
const mobile=process.env.BSB_LINK_MOBILE==='1';
let server,browser;
try{
 const dist=process.env.BSB_LINK_DIST;
 if(dist)server=await preview({root:process.cwd(),base,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 else{server=await createServer({base,server:{host:'127.0.0.1',port:0,strictPort:true}});await server.listen();}
 const origin='http://127.0.0.1:'+server.httpServer.address().port+base;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({acceptDownloads:true,...(mobile?
  {viewport:{width:412,height:915},deviceScaleFactor:2,isMobile:true,hasTouch:true}:
  {viewport:{width:1000,height:540}})});
 const page=await context.newPage(),errors=[],remoteReads=[],remoteWrites=[],downloads=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('download',d=>downloads.push(d.suggestedFilename()));
 await page.addInitScript(()=>{
  window.__portableCopies=[];
  Object.defineProperty(navigator,'clipboard',{configurable:true,
   value:{writeText:async text=>window.__portableCopies.push(text)}});
 });
 await page.route('**/*',r=>{
  const u=new URL(r.request().url());
  if(u.origin!==new URL(origin).origin){
   // Existing game audio requests are ordinary GETs; neither share nor import
   // may send a cross-origin write or an external request with a body.
   const req=r.request();
   if(!['GET','HEAD'].includes(req.method())||req.postDataBuffer())remoteWrites.push({origin:u.origin,method:req.method()});
   else remoteReads.push({origin:u.origin,method:req.method()});
   return r.abort();
  }
  return r.continue();
 });
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:45000});
 await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('portable-file-proof@0'));
 await page.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene')&&window.__bbGame.scene.getScene('RunScene').sled?.body,null,{timeout:35000});
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene').simClock.tick>=145,null,{timeout:30000});
 await page.evaluate(()=>{const r=window.__bbGame.scene.getScene('RunScene');r.bsod.wallX=r.sled.body.bounds.min.x-2;r.bsod.wallSpeedPxS=10000;});
 await page.waitForFunction(()=>window.__bbGame.scene.isActive('GameOverScene')&&window.__bbGame.registry.get('lastGhostTape'),null,{timeout:35000});
 await page.evaluate(()=>window.__bbGame.scene.getScene('GameOverScene')._openGhosts());
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene').ghostView?.shareBtn,null,{timeout:14000});
 await page.waitForTimeout(450);
 const long=await page.evaluate(()=>{
  const g=window.__bbGame,v=g.scene.getScene('GameOverScene').ghostView;
  const original=v.tape;
  let seed=0x31415926;
  const r=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/2**32;};
  const points=new Float32Array(1200*3);
  for(let i=0;i<points.length;i++)points[i]=r()*(i%3===0?10000:i%3===1?3000:6.28);
  const bytes=new Uint8Array(points.buffer);
  let b64='';for(let i=0;i<bytes.length;i+=8192)b64+=String.fromCharCode(...bytes.subarray(i,i+8192));
  // This modified tape is synthetic browser test data, never user evidence.
  const synthetic={...original,trace:btoa(b64),endTick:6000,checkpoints:[],
   ownerName:'PRIVATE_DO_NOT_EXPORT',privateToken:'TOP_SECRET',wallet:{shards:99999}};
  v.tape=synthetic;
  return synthetic;
 });
 try{await createGhostLink(long,origin);throw Error('Synthetic large ghost unexpectedly fit 8192-char URL');}
 catch(e){if(e?.code!=='url-too-long')throw e;}
 const donorFile=await createGhostFile(long);
 if(donorFile.bytes.length<=6000)throw Error('Long fixture is not convincingly large');
 const clickShare=async()=>{
  const point=await page.evaluate(()=>{
   const g=window.__bbGame,v=g.scene.getScene('GameOverScene').ghostView,z=v.shareBtn.zone;
   const p=z.getWorldTransformMatrix().transformPoint(z.width/2,z.height/2),r=document.querySelector('canvas').getBoundingClientRect();
   return {x:r.left+p.x/g.scale.gameSize.width*r.width,y:r.top+p.y/g.scale.gameSize.height*r.height};
  });
  await page.mouse.click(point.x,point.y);
 };
 let first=null;
 for(let i=0;i<4;i++){
  await clickShare();await page.waitForTimeout(600);
  first=await page.evaluate(()=>{const v=window.__bbGame.scene.getScene('GameOverScene').ghostView;
   return {armed:v._shareArmed,label:v.shareBtn.label.main.text,status:v.status.main.text,copies:window.__portableCopies.length};});
  if(first.armed)break;
 }
 if(!first?.armed||first.label!=='SAVE FILE'||!first.status.includes('INPUTS + SCORE')||
  first.copies!==0||downloads.length)throw Error('Large file double-consent initial gate failed '+JSON.stringify(first));
 // Navigate away to cancel; no download, upload, clipboard write or stale intent.
 await page.evaluate(()=>{const v=window.__bbGame.scene.getScene('GameOverScene').ghostView;
  v.handleAction('up');v.handleAction('down');});
 const canceled=await page.evaluate(()=>{const v=window.__bbGame.scene.getScene('GameOverScene').ghostView;
  return {armed:v._shareArmed,label:v.shareBtn.label.main.text};});
 if(canceled.armed||canceled.label!=='SHARE LINK'||downloads.length)throw Error('Cancel retained file export authorization');
 for(let i=0;i<4;i++){
  await clickShare();await page.waitForTimeout(600);
  if(await page.evaluate(()=>window.__bbGame.scene.getScene('GameOverScene').ghostView?._shareArmed))break;
 }
 if(!await page.evaluate(()=>window.__bbGame.scene.getScene('GameOverScene').ghostView?._shareArmed))throw Error('Cannot arm file export again');
 if(downloads.length||await page.evaluate(()=>window.__portableCopies.length))throw Error('File copied/downloaded before second consent');
 const downloadEvent=page.waitForEvent('download',{timeout:18000});
 await clickShare();
 const download=await downloadEvent;
 const actualBytes=new Uint8Array(await readFile(await download.path()));
 const parsed=await parseGhostFile(actualBytes);
 if(download.suggestedFilename()!==donorFile.filename||parsed.tape.trace!==long.trace||
  parsed.tape.runId===long.runId||!parsed.tape.runId.startsWith('shared:')||
  parsed.canCreditScore||parsed.canCreditWallet||parsed.canSubmitOfficial||
  'ownerName' in parsed.tape||'privateToken' in parsed.tape||'wallet' in parsed.tape||
  await page.evaluate(()=>window.__portableCopies.length))
  throw Error('Downloaded ghost file failed privacy/identity/integrity validation');
 const saved=await page.evaluate(async()=>{
  const g=window.__bbGame,r=g.registry,s=r.get('saveStore'),p=r.get('progression'),lib=r.get('ghostLibrary');
  return {runs:JSON.stringify(await s.getRecentRuns(1000)),profile:JSON.stringify(p.store.profile),
   courses:lib.courses.size,tapes:lib.tapes.size,lastRecord:r.get('lastRecord')?.id||null};
 });
 // Recipient must explicitly open the Title view and select the native picker.
 await page.evaluate(()=>window.__bbGame.scene.getScene('GameOverScene').toTitle());
 await page.waitForFunction(()=>window.__bbGame.scene.isActive('TitleScene'),null,{timeout:16000});
 await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene')._openGhostLink());
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.fileInput,null,{timeout:8000});
 if(await page.evaluate(()=>Boolean(window.__bbGame.scene.getScene('TitleScene').view.preview)))throw Error('File was previewed without explicit local choice');
 const fileSelector='input[data-role="ghost-file-import"]';
 async function choose(bytes,{viaKeyboard=false}={}){
  const chooserEvent=page.waitForEvent('filechooser',{timeout:10000});
  if(viaKeyboard){
   await page.locator(fileSelector).focus();
   await page.keyboard.press('Space'); // native File input, not a game shortcut
  }else await page.locator(fileSelector).click();
  const chooser=await chooserEvent;
  await chooser.setFiles({name:'bitstream-ghost.bbghost',mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
 }
 await choose(actualBytes);
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.preview?.count===1200,null,{timeout:15000});
 const visible=await page.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  return {count:v.preview?.count,guestRunId:v.tape?.runId,seed:v.tape?.seed,
   score:v.tape?.score,canRace:!v.practiceBtn.disabled,status:v.status.main.text};
 });
 if(visible.guestRunId!==parsed.tape.runId||visible.seed!==parsed.tape.seed||!visible.canRace||
  !visible.status.includes('UNVERIFIED'))throw Error('Native file picker failed unverified visual preview '+JSON.stringify(visible));
 // A canceled native picker must not leave a PREVIOUS race's second-click consent armed.
 // This is a UI event regression, not a simulated file trust result: an OS file chooser has no selected file.
 const staleConsent=await page.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  v.startGuestPractice();
  const before={armed:v.practiceArmed,label:v.practiceBtn.label.main.text};
  v.fileInput.dispatchEvent(new Event('cancel'));
  return {before,after:{armed:v.practiceArmed,label:v.practiceBtn.label.main.text,
   preview:!!v.preview,status:v.status.main.text}};
 });
 if(!staleConsent.before.armed||staleConsent.after.armed||staleConsent.after.label!=='RACE GUEST'||
  !staleConsent.after.preview||!staleConsent.after.status.includes('CANCELLED'))
  throw Error('Canceled local file chooser left stale RACE GUEST consent '+JSON.stringify(staleConsent));
 console.log('PASS_GHOST_FILE_CANCEL_DISARMS_PRACTICE');
 // Starting a new native chooser must also revoke a prepared race BEFORE
 // a browser-specific cancel event arrives (or if the browser omits cancel).
 const pickerOpen=await page.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  v.startGuestPractice();
  const before=v.practiceArmed;
  v.fileInput.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  return {before,armed:v.practiceArmed,label:v.practiceBtn.label.main.text,preview:!!v.preview};
 });
 if(!pickerOpen.before||pickerOpen.armed||pickerOpen.label!=='RACE GUEST'||!pickerOpen.preview)
  throw Error('Opening local file chooser retained prior RACE consent '+JSON.stringify(pickerOpen));
 console.log('PASS_GHOST_FILE_PICKER_OPEN_DISARMS_PRACTICE');
 // A corrupt replacement MUST clear the prior preview and disarm practice.
 const corrupt=actualBytes.slice();corrupt[corrupt.length-3]^=0x04;
 await choose(corrupt,{viaKeyboard:true});
 await page.waitForFunction(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  return v?.preview===null&&!v.busy&&v.status.main.text.includes('DAMAGED');
 },null,{timeout:15000});
 const rejected=await page.evaluate(()=>{
  const v=window.__bbGame.scene.getScene('TitleScene').view;
  return {status:v.status.main.text,canRace:!v.practiceBtn.disabled,preview:!!v.preview};
 });
 if(rejected.canRace||rejected.preview)throw Error('Corrupt file retained previous guest authorization '+JSON.stringify(rejected));
 await choose(actualBytes);
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view?.preview?.count===1200,null,{timeout:15000});
 // Two distinct actions are required. The desktop path uses the real
 // browser keyboard: a second keydown while Enter is held is auto-repeat.
 if(!mobile){
  await page.evaluate(()=>{
   const v=window.__bbGame.scene.getScene('TitleScene').view;
   v.box.focus();
  });
  const assertArmed=async()=>{
   const state=await page.evaluate(()=>{
    const g=window.__bbGame,v=g.scene.getScene('TitleScene').view;
    return {armed:v?.practiceArmed===true,preview:v?.preview?.count,
     busy:v?.busy,run:g.scene.isActive('RunScene')};
   });
   if(!state.armed||state.preview!==1200||state.busy||state.run)
    throw Error('Expected armed guest preview with no run or preview reload '+JSON.stringify(state));
  };
  await page.keyboard.down('Control');
  await page.keyboard.down('Alt');
  await page.keyboard.down('Enter');
  await assertArmed();
  await page.keyboard.down('Enter');
  await assertArmed();
  await page.keyboard.up('Enter');
  await assertArmed();
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await page.keyboard.up('Alt');
  await page.keyboard.up('Control');
 }else{
  const racePoint=await page.evaluate(()=>{
   const g=window.__bbGame,v=g.scene.getScene('TitleScene').view,z=v.practiceBtn.zone,
    p=z.getWorldTransformMatrix().transformPoint(z.width/2,z.height/2),r=document.querySelector('canvas').getBoundingClientRect();
   return {x:r.left+p.x/g.scale.gameSize.width*r.width,y:r.top+p.y/g.scale.gameSize.height*r.height};
  });
  let armed=false;
  for(let i=0;i<4;i++){
   await page.mouse.click(racePoint.x,racePoint.y);await page.waitForTimeout(400);
   armed=await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').view?.practiceArmed===true);
   if(armed)break;
   if(await page.evaluate(()=>window.__bbGame.scene.isActive('RunScene')))throw Error('Practice started before observed first consent');
  }
  if(!armed)throw Error('File practice first consent did not register');
  await page.mouse.click(racePoint.x,racePoint.y);
 }
 await page.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene')&&window.__bbGame.scene.getScene('RunScene').guestPractice===true,
  null,{timeout:35000});
 const run=await page.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');
  return {practice:r.guestPractice,recorder:!!r.ghostRecorder,
   ghostRoles:r.ghostRiders?.[0]?.roles,guestCount:r.ghostRiders?.length};
 });
 if(!run.practice||run.recorder||run.guestCount!==1||run.ghostRoles?.[0]!=='guest')
  throw Error('File imported as ranked run or invisible opponent '+JSON.stringify(run));
 // Two other practice-only writes must NEVER consume first-run progression:
 // tutorial completions and the device-wide tuck hint show counter.
 const practiceHints=await page.evaluate(()=>{
  const r=window.__bbGame.scene.getScene('RunScene');
  localStorage.removeItem('bb.tutorialDone');
  localStorage.removeItem('bb.tuckShows');
  r.tutDone.delete('push');
  r.tutDoneId('push');
  r.applyHintEvents([{id:'tuck',show:true}]);
  return {inGuestPractice:r.guestPractice===true,
   inMemoryDone:r.tutDone.has('push'),inMemoryShows:r.tuckShows,
   persistedTutorial:localStorage.getItem('bb.tutorialDone'),
   persistedTuck:localStorage.getItem('bb.tuckShows')};
 });
 if(!practiceHints.inGuestPractice||!practiceHints.inMemoryDone||practiceHints.inMemoryShows<1||
  practiceHints.persistedTutorial!==null||practiceHints.persistedTuck!==null)
  throw Error('UNRANKED guest practice wrote first-run hint state '+JSON.stringify(practiceHints));
 console.log('PASS_GHOST_FILE_PRACTICE_HINTS_EPHEMERAL',JSON.stringify(practiceHints));
 await page.evaluate(()=>{const r=window.__bbGame.scene.getScene('RunScene');r.bsod.wallX=r.sled.body.bounds.min.x-2;r.bsod.wallSpeedPxS=10000;});
 await page.waitForFunction(()=>window.__bbGame.scene.isActive('TitleScene')&&
  !window.__bbGame.scene.isActive('RunScene'),null,{timeout:25000});
 const after=await page.evaluate(async()=>{
  const g=window.__bbGame,r=g.registry,s=r.get('saveStore'),p=r.get('progression'),lib=r.get('ghostLibrary');
  return {runs:JSON.stringify(await s.getRecentRuns(1000)),profile:JSON.stringify(p.store.profile),
   courses:lib.courses.size,tapes:lib.tapes.size,lastRecord:r.get('lastRecord')?.id||null};
 });
 if(JSON.stringify(after)!==JSON.stringify(saved)||errors.length||remoteWrites.length)
  throw Error('File guest practice altered saved data or attempted upload '+JSON.stringify({saved,after,errors,remoteReads,remoteWrites}));
 const afterGuestHints=await page.evaluate(()=>({
  tutorial:localStorage.getItem('bb.tutorialDone'),
  tuck:localStorage.getItem('bb.tuckShows')
 }));
 if(afterGuestHints.tutorial!==null||afterGuestHints.tuck!==null)
  throw Error('Guest practice persisted first-run hint history after exiting '+JSON.stringify(afterGuestHints));
 // Positive control: normal play must still persist both hints; otherwise a
 // blanket localStorage stub would make the practice denial falsely green.
 await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('normal-hints-after-guest@0'));
 await page.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene')&&
  window.__bbGame.scene.getScene('RunScene').sled?.body,null,{timeout:35000});
 const normalHints=await page.evaluate(()=>{
  const r=window.__bbGame.scene.getScene('RunScene');
  localStorage.removeItem('bb.tutorialDone');localStorage.removeItem('bb.tuckShows');
  r.tutDone.delete('push');r.tutDoneId('push');
  r.applyHintEvents([{id:'tuck',show:true}]);
  return {practice:r.guestPractice,tutorial:localStorage.getItem('bb.tutorialDone'),
   tuck:localStorage.getItem('bb.tuckShows')};
 });
 if(normalHints.practice||!JSON.parse(normalHints.tutorial||'[]').includes('push')||
  !(Number(normalHints.tuck)>0))throw Error('Normal-play tutorial persistence regressed '+JSON.stringify(normalHints));
 console.log('PASS_NORMAL_PLAY_HINTS_STILL_PERSIST',JSON.stringify(normalHints));
 console.log('PASS_REAL_GHOST_FILE',JSON.stringify({mode:mobile?'412x915-mobile':'desktop',
  bytes:actualBytes.length,sourcePoints:1200,first,canceled,visible,rejected,run,
  zeroSavedMutation:true,blockedExternalGets:remoteReads.length,externalWrites:remoteWrites.length,pageErrors:errors.length}));
 await context.close();
}finally{await browser?.close();await server?.close();}
