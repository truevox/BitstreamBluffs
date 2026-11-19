/** Real Chromium integration: separate Daily lanes and independent persisted
 * Draft preset, without normal shard spending or purchased upgrades.
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const base=process.env.GAME_URL||'http://127.0.0.1:8268/';
try{
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 // Through the real keyboard: Title menu row one -> Daily menu modal.
 await page.keyboard.press('ArrowDown',{delay:50});
 await page.keyboard.press('Enter',{delay:50});
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene')?.view?.constructor.name==='DailyModesView',null,{timeout:10000});
 const choice=await page.evaluate(()=>{
  const t=window.__bbGame.scene.getScene('TitleScene');
  return {rows:t.view.menu.items.map(x=>x.label),budget:t.view.panel?.list?.length};
 });
 assert.deepEqual(choice.rows,['DAILY CLASSIC','DAILY DRAFT','BUILD / REBUILD DRAFT','DAILY DRAFT BOARD']);
 await page.keyboard.press('ArrowDown',{delay:35});
 await page.waitForTimeout(120);
 await page.keyboard.press('ArrowDown',{delay:35});
 await page.waitForTimeout(120);
 const selected=await page.evaluate(()=>({index:window.__bbGame.scene.getScene('TitleScene').view.menu.selected,items:window.__bbGame.scene.getScene('TitleScene').view.menu.items.map(x=>x.label)}));
 console.log('DRAFT_CHOICES_NAV_PROBE',JSON.stringify(selected));
 await page.keyboard.press('Enter',{delay:45});
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene')?.view?.constructor.name==='DailyDraftEditorView',null,{timeout:10000});
 const before=await page.evaluate(()=>{
  const g=window.__bbGame,p=g.registry.get('progression').store.profile;
  return {bank:p.bank,owned:p.upgrades.speed,rank:p.dailyDraft.ranks.canopy};
 });
 // Select canopy via keyboard, increment three times through action router.
 for(let i=0;i<3;i++){await page.keyboard.press('ArrowDown',{delay:25});await page.waitForTimeout(115);}
 for(let i=0;i<3;i++){await page.keyboard.press('ArrowRight',{delay:25});await page.waitForTimeout(115);}
 const configured=await page.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene'),p=g.registry.get('progression').store.profile;
  return {selected:t.view.selected,rank:p.dailyDraft.ranks.canopy,
   credits:t.view.remaining.main.text,bank:p.bank,owned:p.upgrades.speed};
 });
 assert.equal(configured.selected,3);
 assert.equal(configured.rank,3);
 assert.equal(configured.bank,before.bank);
 assert.equal(configured.owned,before.owned);
 assert.ok(configured.credits.includes('LEFT'));
 console.log('DAILY_DRAFT_KEYBOARD_EDITOR_PERSISTS_NO_SHARD_SPEND_PASS',configured);
 // The daily preset survives an actual full game reload.
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 const saved=await page.evaluate(()=>window.__bbGame.registry.get('progression').store.profile.dailyDraft.ranks.canopy);
 assert.equal(saved,3);
 // Enter the Daily mode picker and launch the ranked Draft lane.
 await page.keyboard.press('ArrowDown',{delay:30});
 await page.keyboard.press('Enter',{delay:30});
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene')?.view?.constructor.name==='DailyModesView',null,{timeout:10000});
 await page.keyboard.press('ArrowDown',{delay:30});
 await page.keyboard.press('Enter',{delay:30});
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.sys?.isActive(),null,{timeout:25000});
 const launch=await page.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene'),p=g.registry.get('progression').store.profile;
  return {dailyOfficial:r.dailyOfficial,mode:r.dailyMode,
   rank:r.upgradeRun.ranks.canopy,boosted:r.boostFx.modded,
   upgraded:r.upgradeRun.enabled,bank:p.bank,owned:p.upgrades.speed};
 });
 assert.equal(launch.dailyOfficial,true);
 assert.equal(launch.mode,'draft');
 assert.equal(launch.rank,3);
 assert.equal(launch.upgraded,true);
 assert.equal(launch.boosted,false);
 assert.equal(launch.bank,before.bank);
 assert.equal(launch.owned,before.owned);
 console.log('DAILY_DRAFT_REAL_RUN_USES_ONLY_1200_BUDGET_SNAPSHOT_PASS',launch);
 const record=await page.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');
  g.loop.stop();
  r.bsod.wallX=r.sled.body.bounds.min.x+12;
  r.bsod.wallSpeedPxS=10000;
  g.headlessStep(8000,16.67);g.headlessStep(8017,16.67);
  return g.registry.get('lastRecord');
 });
 assert.equal(record.hashV,4);
 assert.equal(record.dailyMode,'draft');
 assert.equal(record.draftRulesVersion,1);
 assert.equal(record.draftBudget,1200);
 assert.equal(record.upgradeRanks.canopy,3);
 assert.equal(record.dailyOfficial,true);
 assert.equal(record.modded,true);
 assert.equal(record.boosts.length,0);
 assert.equal(record.ledgerHash.length,8);
 console.log('DAILY_DRAFT_FATAL_RUN_HAS_VERSIONED_V4_HASHED_MODE_PASS',{
  hash:record.ledgerHash,rank:record.upgradeRanks.canopy,mode:record.dailyMode});
 // The real Game Over right-side board is the DRAFT board, never CLEAN or MODDED.
 await page.evaluate(()=>{
  const g=window.__bbGame;for(let i=0;i<25;i++)g.headlessStep(9000+i*50,50);
 });
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('GameOverScene')?.sys?.isActive(),null,{timeout:15000});
 await page.waitForTimeout(200);
 const over=await page.evaluate(()=>{
  const s=window.__bbGame.scene.getScene('GameOverScene');
  return {recordMode:s.rec.dailyMode,title:s.right.titleText?.main?.text||s.right.title?.main?.text||'',entry:!!s.entry};
 });
 assert.equal(over.recordMode,'draft');
 console.log('DAILY_DRAFT_GAMEOVER_LEADERBOARD_MODE_PASS',over);
 // Enter initials using the same storage API as GameOver, then inspect the
 // dedicated leaderboard from Title. No fake clean/modded score may appear.
 await page.evaluate(async()=>{
  const g=window.__bbGame,save=g.registry.get('saveStore'),r=g.registry.get('lastRecord');
  await save.setInitials(r.id,'DRA');
 });
 const board=await page.evaluate(async()=>{
  const g=window.__bbGame,save=g.registry.get('saveStore');
  const [d,c,m]=await Promise.all([
    save.getDailyDraftLeaderboard(10,new Date()),save.getLeaderboard(10),save.getModdedLeaderboard(10)]);
  return {draft:d.map(x=>x.id),classic:c.map(x=>x.id),modded:m.map(x=>x.id)};
 });
 assert.ok(board.draft.includes(record.id));
 assert.ok(!board.classic.includes(record.id));
 assert.ok(!board.modded.includes(record.id));
 console.log('DAILY_DRAFT_ONLY_ON_ITS_OWN_RANKED_BOARD_PASS',board);
 await page.evaluate(()=>{
  const g=window.__bbGame;g.scene.getScene('GameOverScene').toTitle();
  for(let i=0;i<6;i++)g.headlessStep(14000+i*16.7,16.7);
 });
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene')?.sys?.isActive(),null,{timeout:15000});
 await page.evaluate(()=>{
  const t=window.__bbGame.scene.getScene('TitleScene');
  t._openDailyModes();t.view.menu.activate(3);
 });
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('TitleScene')?.view?.constructor.name==='DailyDraftLeaderboardView',null,{timeout:10000});
 await page.waitForTimeout(200);
 const shown=await page.evaluate(()=>{
  const t=window.__bbGame.scene.getScene('TitleScene');
  return {title:t.view.panel.titleText?.main?.text||'',cells:t.view.board?.cells?.map(x=>x?.main?.text)||[]};
 });
 assert.equal(shown.title,"DAILY DRAFT // TODAY'S TOP 10");
 assert.ok(shown.cells.includes('DRA'),'Actual Draft initials must render on the daily board');
 console.log('DAILY_DRAFT_RANKING_VIEW_RENDERS_ACTUAL_INITIALS_PASS',shown);
 // Even if this account owns expensive permanent upgrades, the Classic
 // official Daily must ignore them AND must not inherit the Draft preset.
 await page.evaluate(()=>{
  const g=window.__bbGame,t=g.scene.getScene('TitleScene'),s=g.registry.get('progression').store;
  const p=s.profile;
  s.save({...p,upgradesEnabled:true,upgrades:{...p.upgrades,speed:14},
    boosts:{...p.boosts,headStart:true},unlocked:{...p.unlocked,
      boosts:{...p.unlocked.boosts,headStart:8}}});
  g.registry.set('profile',s.profile);
  t.view.close();
  if(t.view?.constructor?.name!=='DailyModesView')throw Error('Back did not restore Daily choices');
  t.view.menu.activate(0);
  // The prior fatal-scene test stopped RAF for deterministic 950ms advancement.
  // Explicitly flush its queued Title -> RunScene transition.
  for(let i=0;i<6;i++)g.headlessStep(17000+i*16.7,16.7);
 });
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.sys?.isActive(),null,{timeout:8000});
 const classic=await page.evaluate(()=>{
  const g=window.__bbGame,r=g.scene.getScene('RunScene');
  return {mode:r.dailyMode,daily:r.dailyOfficial,
    rank:r.upgradeRun.ranks.speed||0,enabled:r.upgradeRun.enabled,
    boost:r.boostFx.modded,modded:r.modded};
 });
 assert.equal(classic.mode,'classic');
 assert.equal(classic.daily,true);
 assert.equal(classic.rank,0);
 assert.equal(classic.enabled,false);
 assert.equal(classic.boost,false);
 assert.equal(classic.modded,false);
 console.log('DAILY_CLASSIC_IGNORES_PERMANENT_UPGRADES_AND_BOOSTS_PASS',classic);
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
