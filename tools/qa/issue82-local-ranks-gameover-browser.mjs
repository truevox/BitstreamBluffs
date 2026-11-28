/** #82/#78: Actual Chromium Game Over local-rank input, rendering and retry gate. */
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const vite = await createServer({server:{host:'127.0.0.1',port:0,strictPort:true}});
let browser;
try {
  await vite.listen();
  const port=vite.httpServer.address().port;
  browser=await chromium.launch({headless:true,args:[
    '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
  ]});
  const page=await browser.newPage({viewport:{width:1100,height:720}});
  const errors=[],requests=[];
  let captureRequests=false;
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('request',r=>{if(captureRequests)requests.push({method:r.method(),url:r.url()});});
  // Chromium automation has no physical pad. Exercise the *real MenuInput
  // polling path* with a standard-gamepad View/Select button 8 press.
  await page.addInitScript(()=>{
    window.__qaViewPressed=false;
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[{
      connected:true, axes:[0,0], buttons:Array.from({length:16},(_,i)=>({pressed:i===8&&window.__qaViewPressed})),
    }]});
  });
  await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:25000});
  await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('issue82-local-ranks'));
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('RunScene')&&
    window.__bbGame.scene.getScene('RunScene')?.sled?.body,null,{timeout:25000});
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene').simClock.tick>=140,
    null,{timeout:25000});
  await page.evaluate(()=>{
    const s=window.__bbGame.scene.getScene('RunScene');
    s.bsod.wallX=s.sled.body.bounds.min.x-2;
    s.bsod.wallSpeedPxS=10000;
  });
  await page.waitForFunction(()=>window.__bbGame.scene.isActive('GameOverScene'),null,{timeout:35000});
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene')?._reportBoardPending===false,
    null,{timeout:12000});
  await page.evaluate(()=>{
    const s=window.__bbGame.scene.getScene('GameOverScene');
    if(s.entry)s.skipEntry();
    s.skipReveal();
  });
  await page.waitForFunction(()=>!window.__bbGame.scene.getScene('GameOverScene')?.entry,
    null,{timeout:8000});
  const before=await page.evaluate(async()=>{
    const game=window.__bbGame,s=game.scene.getScene('GameOverScene');
    const history=await game.registry.get('saveStore').getRecentRuns(1000);
    return {runId:s.rec.id,seed:s.rec.seed,hasInitials:!!s.rec.initials,
      saved:history.some(h=>h.id===s.rec.id),
      buttonText:s.localRanksBtn?.label?.main?.text,
      reportText:s.reportBtn?.label?.main?.text,
      isGameOver:game.scene.isActive('GameOverScene')};
  });
  assert.equal(before.saved,true,'run must exist in real SaveStore history');
  assert.equal(before.hasInitials,false,'test the ordinary run, not initials-gated Top 10');
  assert.equal(before.buttonText,'RANKS L/VIEW');
  assert.equal(before.reportText,'REPORT R/RT');
  assert.equal(before.isGameOver,true);
  captureRequests=true;
  const clickPosition=await page.evaluate(()=>{
    const game=window.__bbGame,z=game.scene.getScene('GameOverScene').localRanksBtn.zone;
    const pt=z.getWorldTransformMatrix().transformPoint(z.width/2,z.height/2);
    const rect=game.canvas.getBoundingClientRect();
    return {x:rect.left+pt.x/game.scale.gameSize.width*rect.width,
      y:rect.top+pt.y/game.scale.gameSize.height*rect.height};
  });
  await page.mouse.click(clickPosition.x,clickPosition.y);
  await page.waitForFunction(()=>{
    const game=window.__bbGame,s=game.scene.getScene('GameOverScene');
    return game.scene.isActive('GameOverScene') &&
      s?.ghostView?.scope?.main?.text?.startsWith('BOARD:');
  },null,{timeout:10000});
  const shown=await page.evaluate(()=>{
    const s=window.__bbGame.scene.getScene('GameOverScene'),v=s.ghostView;
    return {scope:v.scope.main.text,summary:v.summary.main.text,first:v.cells[0].label.main.text,
      percentile:v.cells[0].percentile.main.text,count:v.cells[0].count.main.text,
      n:v.cells.length,frontier:v.frontier.main.text,runId:s.rec.id};
  });
  assert.match(shown.scope,/BOARD: CLEAN/);
  assert.match(shown.summary,/1 MATCHING HASH-CHECKED LOCAL RUN/);
  assert.equal(shown.first,'DISTANCE');
  assert.equal(shown.percentile,'N/A');
  assert.equal(shown.count,'1');
  assert.equal(shown.n,7);
  assert.match(shown.frontier,/PARETO: TOO FEW/);
  assert.equal(shown.runId,before.runId,'opening ranks cannot retry Game Over');
  await page.screenshot({path:'/tmp/bsb487-local-ranks-browser.png'});
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!window.__bbGame.scene.getScene('GameOverScene')?.ghostView,
    null,{timeout:6000});
  // Keyboard L should open exactly the same read-only view.
  await page.waitForTimeout(130);
  await page.keyboard.press('l');
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene')?.ghostView?.scope?.main?.text?.startsWith('BOARD:'),
    null,{timeout:6000});
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!window.__bbGame.scene.getScene('GameOverScene')?.ghostView,
    null,{timeout:6000});
  // Gamepad View/Select (button 8) must work, while RB remains instant retry.
  // Do not reuse Escape's still-draining InputRouter action as a new
  // controller gesture: a human releases one control before pressing another.
  await page.waitForTimeout(260);
  await page.evaluate(()=>window.__qaViewPressed=true);
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene')?.ghostView?.scope?.main?.text?.startsWith('BOARD:'),
    null,{timeout:6000});
  await page.evaluate(()=>window.__qaViewPressed=false);
  await page.keyboard.press(' ');
  await page.waitForFunction(()=>window.__bbGame.scene.isActive('RunScene') &&
    !window.__bbGame.scene.isActive('GameOverScene'),null,{timeout:12000});
  assert.equal(requests.filter(x=>x.method==='POST'||x.method==='PUT').length,0,
    'opening local rankings must not upload or modify any remote service');
  assert.deepEqual(errors,[], 'no browser page errors');
  console.log('REAL_GAMEOVER_LOCAL_RANKS_PASS',JSON.stringify({before,shown,clickPosition,networkRequests:requests.length}));
} finally {
  await browser?.close();
  await vite.close();
}
