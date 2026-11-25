/** #69 portable large-ghost file fallback: real Chromium/Phaser pointer,
 * native download + OS file chooser, explicit consent, hostile import.
 * Fixture copies deterministic synthetic inputs and is NOT a human result.
 * GAME_URL=http://127.0.0.1:18395/ node tools/test-real-ghost-file-browser.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL;
if(!url)throw Error('GAME_URL required');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bsb69-file-qa-'));
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.CHROMIUM_EXECUTABLE||undefined});
const mobile=process.env.BSB_LINK_MOBILE==='1';
const viewport=mobile?{viewport:{width:412,height:915},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:960,height:540}};
const errors=[],requests=[];
const attach=p=>{
 p.on('pageerror',e=>errors.push(e.message));
 p.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))requests.push(r.method()+':'+r.url());});
};
const locationFor=async(p,sceneName,object,prop)=>p.evaluate(({sceneName,object,prop})=>{
 const g=window.__bbGame,s=g.scene.getScene(sceneName),v=window[object],zone=v[prop].zone;
 const pt=zone.getWorldTransformMatrix().transformPoint(zone.width/2,zone.height/2),rect=document.querySelector('canvas').getBoundingClientRect();
 return {x:rect.left+pt.x/g.scale.gameSize.width*rect.width,y:rect.top+pt.y/g.scale.gameSize.height*rect.height};
},{sceneName,object,prop});
try{
 const producer=await browser.newContext({acceptDownloads:true,...viewport});
 const p=await producer.newPage();attach(p);
 await p.goto(url,{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&window.__bbGame.scene.getScene('TitleScene')?.theme?.bind,null,{timeout:30000});
 const prepared=await p.evaluate(async()=>{
  const [{GhostFavoritesView},{GHOST_TAPE_FORMAT,GHOST_TAPE_VERSION,GHOST_PHYSICS_VERSION},
   {RUN_RANDOM_VERSION},{SIM_REVISION},{SIM_TICK_HZ},{REG}]=await Promise.all([
   import('/src/ui/GhostFavoritesView.js'),import('/src/systems/ghost/GhostTape.js'),
   import('/src/systems/RunRandom.js'),import('/src/systems/replay/ruleset.js'),
   import('/src/systems/SimClock.js'),import('/src/constants.js')]);
  const g=window.__bbGame,s=g.scene.getScene('TitleScene'),count=1900;
  const floats=new Float32Array([42,170,0,55,180,.1]);
  const trace=btoa(String.fromCharCode(...new Uint8Array(floats.buffer)));
  const tape={format:GHOST_TAPE_FORMAT,version:GHOST_TAPE_VERSION,physicsVersion:GHOST_PHYSICS_VERSION,
   simTickHz:SIM_TICK_HZ,runRandomVersion:RUN_RANDOM_VERSION,edgeRows:'every-tick',
   seed:'file-fallback-qa',biomeMask:0,simRevision:SIM_REVISION,mode:'normal',
   dailyRuleId:null,dailyRuleSource:'seed-date',syncLevel:1,
   bsod:{leftEdgeX:30,initial:{wallX:-4500,wallSpeedPxS:300,accelerationPxS2:4}},
   controlLayout:'tricksRight',boosts:[],upgradeRanks:null,magnetsDrop:false,kodiaksOn:false,kodiakPackMode:'same',kodiakVersion:3,
   startPose:[42,170,0,0,0,0],random:{version:RUN_RANDOM_VERSION,physicsScramble:1,visualSled:2,visualFx:3,visualCamera:4},
   distanceM:12,score:24,cause:'crash',endTick:count+20,
   inputs:Array.from({length:count},(_,i)=>[1,Math.imul(i+117,2654435761)>>>0,(i*71%255)-127]),
   checkpoints:[],trace,runId:'qa-human-unverified',startedAt:123456,endedAt:123999,
   ownerName:'NEVER_EXPORT',privateToken:'DO_NOT_EXPORT',wallet:{shards:1000000}};
  window.__fileSourceTape=tape;
  const view=new GhostFavoritesView(s,s.theme,{library:g.registry.get(REG.GHOSTS),tape,onClose:()=>view.destroy()});
  window.__producerGhostView=view;
  return {count:tape.inputs.length,shareLabel:view.shareBtn.label.main.text};
 });
 assert.equal(prepared.count,1900);
 const point=()=>locationFor(p,'TitleScene','__producerGhostView','shareBtn');
 let pos=null,firstState=null;
 for(let attempt=0;attempt<5;attempt++){
  pos=await point();await p.mouse.move(pos.x,pos.y);await p.mouse.click(pos.x,pos.y);
  await p.waitForTimeout(650);
  firstState=await p.evaluate(()=>{const v=window.__producerGhostView;
   return {armed:v?._shareArmed,busy:v?._shareBusy,status:v?.status?.main?.text,
    label:v?.shareBtn?.label?.main?.text,disabled:v?.shareBtn?.disabled,
    zoneActive:!!v?.shareBtn?.zone?.scene};});
  if(firstState.armed||firstState.status?.includes('TOO BIG'))break;
 }
 if(!firstState?.armed)throw Error('Real producer mouse did not arm file '+JSON.stringify({firstState,pos}));
 const armed=await p.evaluate(()=>{
  const v=window.__producerGhostView;
  return {armed:v._shareArmed,label:v.shareBtn.label.main.text,notice:v.status.main.text,
   hasFile:v._shareFile instanceof Uint8Array,hasLink:!!v._shareLink};
 });
 assert(armed.armed&&armed.label==='SAVE FILE'&&armed.notice.includes('INPUTS + SCORE')&&armed.hasFile&&!armed.hasLink,JSON.stringify(armed));
 const downloadPromise=p.waitForEvent('download',{timeout:18000});
 pos=await point();await p.mouse.click(pos.x,pos.y);
 const download=await downloadPromise;
 const filePath=await download.path(),file=fs.readFileSync(filePath);
 assert(download.suggestedFilename().endsWith('.bbghost'));
 assert(file.byteLength>6000&&file.byteLength<20100);
 const saved=await p.evaluate(()=>({label:window.__producerGhostView.shareBtn.label.main.text,
  status:window.__producerGhostView.status.main.text}));
 assert(saved.label==='SHARE LINK'&&saved.status.includes('DOWNLOAD REQUESTED'));
 const tampered=Buffer.from(file);tampered[tampered.length-1]^=1;
 const tamperedFile=path.join(temp,'tampered.bbghost');fs.writeFileSync(tamperedFile,tampered);
 const oversizedFile=path.join(temp,'too-large.bbghost');fs.writeFileSync(oversizedFile,Buffer.alloc(20100));
 const recipient=await browser.newContext({acceptDownloads:false,...viewport});
 const q=await recipient.newPage();attach(q);
 await q.goto(url,{waitUntil:'domcontentloaded'});
 await q.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&window.__bbGame.scene.getScene('TitleScene')?.theme?.bind,null,{timeout:30000});
 const initial=await q.evaluate(async()=>{
  const [{GhostLinkView},{REG}]=await Promise.all([import('/src/ui/GhostLinkView.js'),import('/src/constants.js')]);
  const g=window.__bbGame,s=g.scene.getScene('TitleScene');
  const view=new GhostLinkView(s,s.theme,{onClose:()=>view.destroy(),onPractice:()=>{window.__unrankedOnly=true;}});
  window.__recipientGhostView=view;
  const store=g.registry.get(REG.SAVE_STORE),lib=g.registry.get(REG.GHOSTS);
  return {fileInputs:document.querySelectorAll('input[type=file]').length,
   runs:store.runs?.length||0,courses:lib.courses?.size||0,tapes:lib.tapes?.size||0,autoPreview:!!view.preview};
 });
 assert(initial.fileInputs===1&&!initial.autoPreview);
 const filePos=()=>locationFor(q,'TitleScene','__recipientGhostView','fileBtn');
 await q.evaluate(()=>{
  const v=window.__recipientGhostView;
  window.__fileDebug={pressed:0,opened:0,nativeClicks:0};
  v.fileBtn.zone.on('pointerdown',()=>window.__fileDebug.pressed++);
  const originalOpen=v._openFilePicker.bind(v);
  v._openFilePicker=function(){window.__fileDebug.opened++;return originalOpen();};
  const originalClick=v._fileInput.click.bind(v._fileInput);
  v._fileInput.click=function(){window.__fileDebug.nativeClicks++;return originalClick();};
 });
 const choose=async filepath=>{
  await q.waitForTimeout(550);
  const chooserPromise=q.waitForEvent('filechooser',{timeout:5000});
  const pt=await filePos();await q.mouse.move(pt.x,pt.y);await q.mouse.click(pt.x,pt.y);
  let chooser;
  try{chooser=await chooserPromise;}
  catch(e){
   const detail=await q.evaluate(()=>{
    const v=window.__recipientGhostView,z=v.fileBtn.zone;
    return {debug:window.__fileDebug,disabled:v.fileBtn.disabled,alive:v.alive,
     text:v.status.main.text,inputPresent:!!v._fileInput,
     pos:{panel:{x:v.panel.x,y:v.panel.y,scaleX:v.panel.scaleX,scaleY:v.panel.scaleY},button:{x:v.fileBtn.x,y:v.fileBtn.y,w:z.width,h:z.height}},
     inputCount:document.querySelectorAll('input[type=file]').length};
   });
   throw Error('Native file chooser never opened '+JSON.stringify({detail,pt,error:e.message}));
  }
  await chooser.setFiles(filepath);
 };
 await choose(filePath);
 await q.waitForFunction(()=>window.__recipientGhostView?.preview?.count>0,null,{timeout:12000});
 const imported=await q.evaluate(()=>{
  const g=window.__bbGame,v=window.__recipientGhostView,lib=g.registry.get('ghostLibrary'),store=g.registry.get('saveStore');
  return {status:v.status.main.text,inputs:v.tape.inputs.length,seed:v.tape.seed,
   runId:v.tape.runId,score:v.tape.score,practiceEnabled:!v.practiceBtn.disabled,
   privateFields:['ownerName','privateToken','wallet'].some(k=>Object.hasOwn(v.tape,k)),
   runs:store.runs?.length||0,courses:lib.courses?.size||0,tapes:lib.tapes?.size||0,
   activeRun:g.scene.isActive('RunScene')};
 });
 assert(imported.inputs===1900&&imported.seed==='file-fallback-qa'&&imported.runId.startsWith('shared:')&&
  imported.practiceEnabled&&!imported.privateFields&&!imported.activeRun&&
  imported.runs===initial.runs&&imported.courses===initial.courses&&imported.tapes===initial.tapes,JSON.stringify(imported));
 await choose(tamperedFile);
 await q.waitForFunction(()=>window.__recipientGhostView?.status?.main?.text?.includes('DAMAGED'),null,{timeout:12000});
 const corrupt=await q.evaluate(()=>({loaded:!!window.__recipientGhostView?.tape,
  status:window.__recipientGhostView?.status?.main?.text}));
 assert(!corrupt.loaded);
 await choose(oversizedFile);
 await q.waitForFunction(()=>window.__recipientGhostView?.status?.main?.text?.includes('TOO LARGE'),null,{timeout:12000});
 const oversized=await q.evaluate(()=>({loaded:!!window.__recipientGhostView?.tape,
  status:window.__recipientGhostView?.status?.main?.text}));
 assert(!oversized.loaded);
 const teardown=await q.evaluate(()=>{window.__recipientGhostView.destroy();return {
  inputCount:document.querySelectorAll('input[type=file]').length,
  preview:!!window.__recipientGhostView.preview};});
 assert(teardown.inputCount===0&&!teardown.preview);
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 console.log('PASS_GHOST_FILE_REAL_CHROMIUM',JSON.stringify({prepared,armed,
  filename:download.suggestedFilename(),fileBytes:file.byteLength,saved,
  initial,imported,corrupt,oversized,teardown,errors,requests,
  trust:'unverified-practice-only',externalUploads:0,syntheticLongInput:true,mobile}));
 await recipient.close();await producer.close();
}finally{await browser.close();fs.rmSync(temp,{recursive:true,force:true});}
