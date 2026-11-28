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
  const errors=[],requests=[],downloads=[];
  let watchReportTraffic=false;
  // This running game independently streams the original soundtrack. Do not
  // confuse its pre-existing, known OGG GETs with replay evidence uploads;
  // accept only exact-host music assets with no query parameters.
  const allowedMusicRequest=(req)=>{
    try{
      const u=new URL(req.url);
      return req.method==='GET' && u.origin==='https://bsb-audio.bearcave.win' &&
        /^\/releases\/[^/]+\/packs\/.+\.ogg$/.test(u.pathname) &&
        !u.search && !u.hash;
    }catch{return false;}
  };
  const assertPrivateNetwork=(runId,digest)=>{
    const unexpected=requests.filter(r=>!allowedMusicRequest(r));
    assert.deepEqual(unexpected,[],'REPORT/EXPORT cannot issue a network request except original music OGG GETs');
    for(const r of requests){
      assert.ok(!r.url.includes(runId),'run ID appeared in outbound URL');
      if(digest)assert.ok(!r.url.includes(digest),'replay digest appeared in outbound URL');
    }
  };
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('request',r=>{if(watchReportTraffic)requests.push({method:r.method(),url:r.url()});});
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
  assert.equal(before.btnLabel,'REPORT R/RT');
  assert.equal(before.modal,false);
  assert.deepEqual(downloads,[]);
  watchReportTraffic=true; // every HTTP method, including GET and HEAD
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
  assertPrivateNetwork(before.recordId,null);
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
  assertPrivateNetwork(before.recordId,downloaded.suggestedFilename().replace(/\.bbreplay$/,''));
  const afterExport=await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('GameOverScene').ghostView;
    return {status:v?.status?.main?.text,detail:v?.detail?.main?.text};
  });
  assert.match(afterExport.status,/LOCAL FILE EXPORT REQUESTED/);
  await page.evaluate(()=>window.__bbGame.scene.getScene('GameOverScene').ghostView.close());
  await page.waitForFunction(()=>!window.__bbGame.scene.getScene('GameOverScene').ghostView);
  await page.keyboard.press('r');
  await page.waitForFunction(()=>!!window.__bbGame.scene.getScene('GameOverScene').ghostView,
    null,{timeout:5000});
  assert.equal(downloads.length,1,'keyboard shortcut only opens the modal, not another export');
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
    s._reportBoardPending=true;
    s.reportBtn.setDisabled(true);
    const pendingRejected=s._reportButtonReady()===false;
    s._openLocalReport();
    const noPendingModal=!!s.ghostView===false;
    s._reportBoardPending=false;
    s.reportBtn.setDisabled(false);
    // Simulate the physical pointer's game coordinates while the panel
    // has already become visible but is not fully unfolded. It must be
    // consumed instead of launching a destructive Retry.
    const z=s.reportBtn.zone;
    const center=z.getWorldTransformMatrix().transformPoint(z.width/2,z.height/2);
    const oldRetry=s.retry,oldCancel=s._cancelShopAutoprompt;
    let retries=0,cancelled=0;
    s.retry=()=>{retries++;};
    s._cancelShopAutoprompt=()=>{cancelled++;};
    s.left.setAlpha(0.45);
    s._onPointer({x:center.x,y:center.y},[]);
    const partialConsumed=retries===0&&!s.ghostView;
    const partialCancelledPrompt=cancelled===1;
    // A completely invisible REPORT location is still blank background.
    s.left.setAlpha(0);
    s._onPointer({x:center.x,y:center.y},[]);
    const hiddenStillRetries=retries===1&&!s.ghostView;
    s.retry=oldRetry;
    s._cancelShopAutoprompt=oldCancel;
    s.left.setAlpha(savedAlpha);
    return {blocked,noModal,restored,hiddenRejected,noHiddenModal,
      pendingRejected,noPendingModal,partialConsumed,partialCancelledPrompt,hiddenStillRetries};
  });
  assert.deepEqual(guarded,{blocked:true,noModal:true,restored:true,
    hiddenRejected:true,noHiddenModal:true,pendingRejected:true,noPendingModal:true,
    partialConsumed:true,partialCancelledPrompt:true,hiddenStillRetries:true});
  assert.deepEqual(errors,[]);
  console.log('REAL_GAME_OVER_LOCAL_REPORT_EXPORT_PASS',before,opened,afterExport);
}finally{
  await browser?.close();
  await vite.close();
}
