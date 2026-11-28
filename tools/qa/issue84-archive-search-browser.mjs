/** Browser proof: actual native Shop and DOM search, local sharing, no deletion. */
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true}});
let browser;
try {
  await vite.listen();
  const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
  const ctx=await browser.newContext({viewport:{width:1100,height:720},permissions:['clipboard-read','clipboard-write']});
  const page=await ctx.newPage();
  const errors=[],writes=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('request',r=>{if(['POST','PUT','DELETE'].includes(r.method()))writes.push([r.method(),r.url()]);});
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:25000});
  await page.evaluate(async()=>{
    const g=window.__bbGame,s=g.scene.getScene('TitleScene');
    const {ShopView}=await import('/src/ui/Views.js');
    const {courseKey}=await import('/src/systems/ghost/GhostTape.js');
    const courses=[['ALPHA-GAP',7],['SAFE-LINE',0],['GAMMA-GAP',15]];
    // The normal archive read API remains wired, but this test supplies a
    // detached read-only fixture without changing the user's saved archives.
    const records=courses.map(([seed,biomeMask])=>({key:courseKey(seed,biomeMask),seed,biomeMask,
      favorites:seed==='SAFE-LINE'?['owned-favorite',null,null]:[null,null,null],lastPlayedAt:1}));
    const view=new ShopView(s,s.theme,{onClose:()=>s._closeView()});
    s._openView(view);
    view._archiveLibrary=()=>({listArchiveCourses:async()=>records,deleteArchiveCourse:()=>{throw new Error('Unexpected deletion');}});
    await view._openArchiveManager();
  });
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene')?.view?.archivePage===true);
  const starting=await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    return {length:v.archives.length,label:v._layout.rows.find(r=>r.key==='archiveHeader')?.label,
      pager:v._layout.rows.find(r=>r.key==='archivePager')?.label};
  });
  assert.equal(starting.length,3);
  assert.match(starting.pager,/FIND SEED/);
  await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').view._openArchiveSearch());
  await page.waitForSelector('input[aria-label="SEED / @MASK / #FAV"]',{timeout:5000});
  await page.locator('input[aria-label="SEED / @MASK / #FAV"]').fill('gap');
  await page.locator('input[aria-label="SEED / @MASK / #FAV"]').press('Enter');
  await page.waitForFunction(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    return v.archiveQuery==='gap' && !v.archiveSearchBox;
  });
  const filtered=await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    return {rows:v._layout.rows.filter(r=>r.kind==='archiveEntry').map(r=>r.label),
      header:v._layout.rows.find(r=>r.key==='archiveHeader')?.label};
  });
  assert.equal(filtered.rows.length,2);
  assert.ok(filtered.rows.some(r=>r.includes('ALPHA-GAP')));
  assert.ok(filtered.rows.some(r=>r.includes('GAMMA-GAP')));
  assert.match(filtered.header,/2\/3/);
  await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    v._selectArchive(v.archives[0].key);
  });
  await page.waitForFunction(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    return !!v._layout.rows.find(r=>r.kind==='archiveShare');
  });
  const selected=await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    return {share:v._layout.rows.find(r=>r.kind==='archiveShare')?.label,
      confirm:v._layout.rows.find(r=>r.kind==='archiveConfirm')?.label};
  });
  assert.equal(selected.share,'COPY SELECTED SEED + MASK');
  assert.match(selected.confirm,/CONFIRM DELETE/);
  await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').view._copySelectedArchive());
  await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene').view.archiveNotice.includes('COPIED'),null,{timeout:5000});
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'ALPHA-GAP@7');
  await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').view._openArchiveSearch());
  await page.locator('input[aria-label="SEED / @MASK / #FAV"]').fill('#fav');
  await page.locator('input[aria-label="SEED / @MASK / #FAV"]').press('Enter');
  const fav=await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view;
    return {query:v.archiveQuery,rows:v._layout.rows.filter(r=>r.kind==='archiveEntry').map(r=>r.label),
      confirm:v._layout.rows.some(r=>r.kind==='archiveConfirm')};
  });
  assert.equal(fav.rows.length,1);
  assert.match(fav.rows[0],/SAFE-LINE/);
  assert.equal(fav.confirm,false);
  assert.deepEqual(writes,[]);
  assert.deepEqual(errors,[]);
  console.log('REAL_COURSE_ARCHIVE_SEARCH_PASS',JSON.stringify({starting,filtered,selected,fav}));
} finally {await browser?.close();await vite.close();}
