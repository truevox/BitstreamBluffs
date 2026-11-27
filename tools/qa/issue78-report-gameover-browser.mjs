/** #78: Real Game Over exposes a local-only report without upload or silent export. */
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true}});
let browser;
try{
  await vite.listen();
  const port=vite.httpServer.address().port;
  browser=await chromium.launch({headless:true,args:[
    '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
  ]});
  const page=await browser.newPage({viewport:{width:1100,height:720},acceptDownloads:true});
  const errors=[],uploads=[],downloads=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))uploads.push(r.method()+' '+r.url());});
  page.on('download',d=>downloads.push(d.suggestedFilename()));
  await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:25000});
  await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('issue78-local-report'));
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('RunScene')&&
    window.__bbGame.scene.getScene('RunScene')?.sled?.body,null,{timeout:25000});
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene').simClock.tick>=140,
    null,{timeout:25000});
  await page.evaluate(()=>{const r=window.__bbGame.scene.getScene('RunScene');
    r.bsod.wallX=r.sled.body.bounds.min.x-2;r.bsod.wallSpeedPxS=10000;});
  await page.waitForFunction(()=>window.__bbGame.registry.get('lastGhostTape')&&
    window.__bbGame.scene.isActive('GameOverScene'),null,{timeout:35000});
  // Saving/validating replay evidence is deferred after the fatal tick.
  // A correct Game Over can predate the archive; wait for the run-matched
  // capture status rather than racing a manual REFRESH requirement.
  await page.waitForFunction(()=>{
    const g=window.__bbGame,runId=g.registry.get('lastGhostTape')?.runId;
    const status=g.registry.get('evidenceStatusByRun')?.get(runId);
    return status?.runId===runId && status.ok===true &&
      typeof status.digest==='string';
  },null,{timeout:20000});
  await page.waitForFunction(()=>{
    const s=window.__bbGame.scene.getScene('GameOverScene');
    return s?._reportButtonReady() === true;
  },null,{timeout:12000});
  const before=await page.evaluate(()=>{
    const g=window.__bbGame,s=g.scene.getScene('GameOverScene');
    return {recordId:s.rec.id,tapeId:g.registry.get('lastGhostTape')?.runId,
      report:!!s.reportBtn,ghost:!!s.ghostBtn,modal:!!s.ghostView,
      btnLabel:s.reportBtn?.label?.main?.text,
      status:g.registry.get('lastEvidenceStatus')?.code||null};
  });
  assert.equal(before.recordId,before.tapeId);
  assert.equal(before.report,true);
  assert.equal(before.btnLabel,'REPORT');
  assert.equal(before.modal,false);
  assert.deepEqual(downloads,[]);
  // Actual rendered Button pointer target, not calling the scene action.
  const pos=await page.evaluate(()=>{
    const g=window.__bbGame,z=g.scene.getScene('GameOverScene').reportBtn.zone;
    const pt=z.getWorldTransformMatrix().transformPoint(z.width/2,z.height/2);
    const rect=g.canvas.getBoundingClientRect();
    return {x:rect.left+pt.x/g.scale.gameSize.width*rect.width,
      y:rect.top+pt.y/g.scale.gameSize.height*rect.height};
  });
  await page.mouse.click(pos.x,pos.y);
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene').ghostView?.digestText,
    null,{timeout:10000});
  const opened=await page.evaluate(()=>{
    const s=window.__bbGame.scene.getScene('GameOverScene'),v=s.ghostView;
    return {title:v.panel?.titleText?.main?.text,modal:!!v,
      sameRun:v.tape?.runId===s.rec.id,exportButton:v.buttons[1].label.main.text,
      privateLabel:v.panel?.list?.some?.(o=>o.main?.text?.includes('PRIVATE TO THIS DEVICE'))||false,
      status:v.status.main.text};
  });
  assert.equal(opened.sameRun,true);
  assert.equal(opened.exportButton,'EXPORT');
  assert.equal(opened.title,'LOCAL REPLAY EVIDENCE');
  assert.deepEqual(downloads,[],'opening report must not auto-download evidence');
  assert.deepEqual(uploads,[],'opening report must not upload data');
  await page.waitForFunction(()=>{
    const v=window.__bbGame.scene.getScene('GameOverScene').ghostView;
    return v?.buttons?.[1]?.disabled===false;
  },null,{timeout:12000});
  // The View's CRT open animation changes hit zones until it settles.
  await page.waitForFunction(()=>{
    const v=window.__bbGame.scene.getScene('GameOverScene').ghostView,p=v?.panel;
    return p?.alpha===1 && p?.scaleX===1 && p?.scaleY===1 &&
      p.y===Math.round((270-v.h)/2);
  },null,{timeout:15000});
  // A separate, conscious EXPORT click must download canonical existing bytes.
  const exportPos=await page.evaluate(()=>{
    const g=window.__bbGame,v=g.scene.getScene('GameOverScene').ghostView;
    const z=v.buttons[1].zone,p=z.getWorldTransformMatrix().transformPoint(z.width/2,z.height/2);
    const rect=g.canvas.getBoundingClientRect();
    return {x:rect.left+p.x/g.scale.gameSize.width*rect.width,
      y:rect.top+p.y/g.scale.gameSize.height*rect.height};
  });
  await page.mouse.move(exportPos.x,exportPos.y);
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene').ghostView?.buttons[1]?.hover,
    null,{timeout:3000});
  const downloadPromise=page.waitForEvent('download',{timeout:10000});
  await page.mouse.click(exportPos.x,exportPos.y);
  const downloaded=await downloadPromise;
  assert.match(downloaded.suggestedFilename(),/^[a-f0-9]{64}\.bbreplay$/i);
  assert.equal(downloads.length,1);
  assert.deepEqual(uploads,[]);
  const afterExport=await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('GameOverScene').ghostView;
    return {status:v?.status?.main?.text,detail:v?.detail?.main?.text};
  });
  assert.match(afterExport.status,/LOCAL FILE EXPORT REQUESTED/);
  await page.evaluate(()=>window.__bbGame.scene.getScene('GameOverScene').ghostView.close());
  await page.waitForFunction(()=>!window.__bbGame.scene.getScene('GameOverScene').ghostView);
  // A real initials input owns Enter/Escape while active. REPORT must be
  // disabled rather than opening a modal behind its raw keyboard handler.
  const guarded=await page.evaluate(()=>{
    const s=window.__bbGame.scene.getScene('GameOverScene');
    s._showEntry();
    const blocked=!!s.entry && s.reportBtn.disabled===true;
    s._openLocalReport();
    const noModal=!!s.ghostView===false;
    s.skipEntry();
    const restored=s.reportBtn.disabled===false;
    const savedAlpha=s.left.alpha;
    s.left.setAlpha(0);
    const hiddenRejected=s._reportButtonReady()===false;
    s._openLocalReport();
    const noHiddenModal=!!s.ghostView===false;
    s.left.setAlpha(savedAlpha);
    return {blocked,noModal,restored,hiddenRejected,noHiddenModal};
  });
  assert.deepEqual(guarded,{blocked:true,noModal:true,restored:true,
    hiddenRejected:true,noHiddenModal:true});
  assert.deepEqual(errors,[]);
  console.log('REAL_GAME_OVER_LOCAL_REPORT_EXPORT_PASS',before,opened,afterExport);
}finally{
  await browser?.close();
  await vite.close();
}
