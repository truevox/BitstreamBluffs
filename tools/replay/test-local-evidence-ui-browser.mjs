/** Real Phaser canvas / Chromium integration for local-only replay evidence controls.
 * Start Vite for the exact worktree first; no public upload, profile write or reward.
 * GAME_URL=http://127.0.0.1:18262/ node tools/replay/test-local-evidence-ui-browser.mjs
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const url=process.env.GAME_URL||'http://127.0.0.1:18262/';
const tape=JSON.parse(fs.readFileSync('tests/fixtures/replay/v1/legacy-tape.json','utf8'));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];
try {
 const p=await browser.newPage({acceptDownloads:true});const errors=[];
 p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(url,{waitUntil:'domcontentloaded'});
 // Do NOT race the TitleScene constructor; this smoke drives the actual
 // Phaser UI objects after scene boot, not arbitrary DOM painting.
 await p.waitForFunction(()=>window.__bbGame?.scene?.getScenes()?.[0]?.theme?.bind,{timeout:20000});
 const initial=await p.evaluate(async t=>{
  const [{sharedEvidenceStore,EVIDENCE_STATUS_KEY},{ReplayEvidenceView},{evidenceBundle,legacyManifestFromTape}]=await Promise.all([
    import('/src/systems/replay/evidenceCapture.js'),import('/src/ui/ReplayEvidenceView.js'),import('/src/systems/replay/manifest.js')]);
  const scene=window.__bbGame.scene.getScenes()[0],store=await sharedEvidenceStore();
  const digest=await store.put(evidenceBundle({manifest:legacyManifestFromTape(t),tape:t}),{runId:'ui-smoke-run'});
  const view=new ReplayEvidenceView(scene,scene.theme,{tape:{runId:'ui-smoke-run'},onClose:()=>view.destroy()});
  window.__qaEvidence={view,store,digest,scene,statusKey:EVIDENCE_STATUS_KEY,legacyTape:t,initiallyDisabled:view.buttons[0].disabled};
  scene.registry.set(EVIDENCE_STATUS_KEY,{ok:true,runId:'ui-smoke-run',digest,durable:true});
  await view._refresh();
  window.__qaEvidence.store=view.actions?.store || store; // Vite HMR can duplicate module singleton instances
  return {alive:view.alive,digest,labels:view.buttons.map(b=>b.label.main.text),message:view.status.main.text,depth:view.panel.depth,initiallyDisabled:window.__qaEvidence.initiallyDisabled};
 },tape);
 assert(initial.alive && initial.initiallyDisabled && initial.depth>=500 && initial.labels.join(',')==='KEEP,EXPORT,IMPORT,REFRESH');
 assert(initial.message.includes('SAVED LOCALLY'));
 results.push('panel renders after Phaser theme-ready gate');
 const keep=await p.evaluate(async()=>{
  const {view,store,digest}=window.__qaEvidence;
  await view._keepOrUnpin();
  return {count:store.protectedCount(digest),label:view.buttons[0].label.main.text,message:view.status.main.text};
 });
 assert.equal(keep.count,1);assert.equal(keep.label,'UNPIN');
 const unpin=await p.evaluate(async()=>{
  const {view,store,digest}=window.__qaEvidence;
  await view._keepOrUnpin();
  return {count:store.protectedCount(digest),label:view.buttons[0].label.main.text,message:view.status.main.text};
 });
 assert.equal(unpin.count,0);assert.equal(unpin.label,'KEEP');
 results.push('explicit Keep/Unpin changes durable IndexedDB reference');
 const foreignPin=await p.evaluate(async()=>{
  const {view,store,digest}=window.__qaEvidence;
  const {EvidenceStore}=await import('/src/systems/replay/evidenceStore.js');
  const tab=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  const held=await tab.protect(digest,{runId:'ui-smoke-run',role:'pinned'});
  const cachedBefore=store.protectedCount(digest);
  await view._refresh();
  const afterPin=view.buttons[0].label.main.text;
  await tab.unprotect(held.key);
  await view._refresh();
  return {cachedBefore,afterPin,afterUnpin:view.buttons[0].label.main.text};
 });
 assert.equal(foreignPin.cachedBefore,0);
 assert.equal(foreignPin.afterPin,'UNPIN');
 assert.equal(foreignPin.afterUnpin,'KEEP');
 results.push('Refresh follows persisted pin/unpin from another browser tab');
 const failedRefs=await p.evaluate(async()=>{
  const {view,store}=window.__qaEvidence;
  const original=store.persistedProtections;
  store.persistedProtections=async()=>{throw new Error('test: protection index temporarily unavailable');};
  try {
    await view._refresh();
    return {exportEnabled:view.buttons[1].disabled===false,
      keepDisabled:view.buttons[0].disabled===true,
      status:view.status.main.text};
  } finally {store.persistedProtections=original;await view._refresh();}
 });
 assert(failedRefs.exportEnabled && failedRefs.keepDisabled && failedRefs.status.includes('EXPORT WORKS'));
 results.push('verified bundle remains exportable when pin index lookup fails');

 const staleRefresh=await p.evaluate(async()=>{
  const {view,store,digest}=window.__qaEvidence;
  const original=store.get.bind(store);
  let signal,release;
  const started=new Promise(resolve=>{signal=resolve;});
  store.get=()=>{signal();return new Promise(resolve=>{release=async()=>resolve(await original(digest));});};
  try{
    const refreshing=view._refresh();
    await started;
    await view._run(async()=>{view._show('IMPORTED LOCAL EVIDENCE — UNVERIFIED','RECENT USER ACTION');});
    await release();await refreshing;
    return {status:view.status.main.text,detail:view.detail.main.text};
  }finally{store.get=original;await view._refresh();}
 });
 assert(staleRefresh.status.includes('IMPORTED LOCAL EVIDENCE'));
 results.push('late Refresh result cannot overwrite newer Import action feedback');


 // Browser download must be triggered only when Export is explicitly clicked.
 const downloadPromise=p.waitForEvent('download',{timeout:15000});
 await p.evaluate(()=>window.__qaEvidence.view._export());
 const download=await downloadPromise;
 const downloadPath=await download.path();
 const exported=fs.readFileSync(downloadPath);
 assert.equal(download.suggestedFilename(),`${initial.digest.slice(7)}.bbreplay`);
 assert(exported.length>2000);
 results.push('explicit Export triggers digest-named local .bbreplay download');
 // A real native input overlays the Phaser button. Click its actual DOM
 // hit target, not a synthetic Phaser/gamepad event with no browser activation.
 const nativeFile=p.locator('input[data-role="replay-evidence-import"]');
 assert.equal(await nativeFile.count(),1);
 const fileChooserPromise=p.waitForEvent('filechooser',{timeout:15000});
 await nativeFile.click({force:true});
 const chooser=await fileChooserPromise;
 await chooser.setFiles({name:download.suggestedFilename(),mimeType:'application/octet-stream',buffer:exported});
 await p.waitForFunction(()=>window.__qaEvidence.view.status.main.text.includes('UNVERIFIED'),{timeout:15000});
 const imported=await p.evaluate(()=>({msg:window.__qaEvidence.view.status.main.text,count:window.__qaEvidence.store.protectedCount(window.__qaEvidence.digest)}));
 const nativeFocus=await p.evaluate(()=>document.activeElement?.getAttribute('data-role'));
 assert.notEqual(nativeFocus,'replay-evidence-import');
 results.push('native picker returns keyboard focus to game after selecting a file');
 assert(imported.msg.includes('UNVERIFIED'));
 assert.equal(imported.count,0);
 results.push('explicit file picker imports local-only data, stays unverified/unpinned');
 const stale=await p.evaluate(()=>{
  const {scene,statusKey,view}=window.__qaEvidence;
  scene.registry.set(statusKey,{ok:true,runId:'some-prior-run',digest:'sha256:'+'f'.repeat(64)});
  return view._captureStatus();
 });
 assert.equal(stale,null);
 results.push('stale prior-run capture cannot be pinned as current run');
 const busyInput=await p.evaluate(async()=>{
  const {view}=window.__qaEvidence;
  let release;
  const task=view._run(()=>new Promise(resolve=>{release=resolve;}));
  const blocked=view._nativeInput?.disabled===true;
  release();await task;
  return {blocked,reEnabled:view._nativeInput?.disabled===false};
 });
 assert(busyInput.blocked && busyInput.reEnabled);
 results.push('native picker is disabled during in-flight archive operations');

 const memory=await p.evaluate(async()=>{
  const {view,store,scene,statusKey}=window.__qaEvidence;
  const {evidenceBundle,legacyManifestFromTape,bundleDigest}=await import('/src/systems/replay/manifest.js');
  const tape=window.__qaEvidence.legacyTape;
  const current=evidenceBundle({manifest:legacyManifestFromTape(tape),tape});
  const changed={...current,claims:{...current.claims,score:current.claims.score+5}};
  const digest=bundleDigest(changed);
  const original=store._writeDurable;
  store._writeDurable=async()=>{throw Object.assign(new Error('test quota exceeded'),{name:'QuotaExceededError'});};
  let failed=false;
  try{await store.put(changed,{runId:'ui-smoke-run'});}catch(e){failed=e.code==='quota-exceeded';}
  store._writeDurable=original;
  scene.registry.set(statusKey,{ok:false,runId:'ui-smoke-run',digest,code:'quota-exceeded',durable:false});
  await view._refresh();
  return {failed,digest,keepDisabled:view.buttons[0].disabled,exportDisabled:view.buttons[1].disabled,
    message:view.status.main.text,pending:store.pending.has(digest)};
 });
 assert(memory.failed && memory.pending && memory.keepDisabled && !memory.exportDisabled && memory.message.includes('EXPORT NOW'));
 const memoryDownloadWait=p.waitForEvent('download',{timeout:15000});
 await p.evaluate(()=>window.__qaEvidence.view._export());
 const memoryDownload=await memoryDownloadWait;
 assert.equal(memoryDownload.suggestedFilename(),`${memory.digest.slice(7)}.bbreplay`);
 assert(fs.readFileSync(await memoryDownload.path()).length>2000);
 results.push('quota-failed memory-only canonical input remains explicitly exportable but cannot be pinned');
 const recovered=await p.evaluate(async missingDigest=>{
  const {view,store}=window.__qaEvidence;
  const {evidenceBundle,legacyManifestFromTape}=await import('/src/systems/replay/manifest.js');
  const tape=window.__qaEvidence.legacyTape;
  const base=evidenceBundle({manifest:legacyManifestFromTape(tape),tape});
  const different={...base,claims:{...base.claims,score:base.claims.score+6}};
  await store.put(different,{runId:'unrelated-success'}); // flush previous failed write
  await view._refresh();
  const durable=await store.isBundleDurable(missingDigest,{runId:'ui-smoke-run'});
  const enabled=view.buttons[0].disabled===false;
  const message=view.status.main.text;
  if(enabled){
    await view._keepOrUnpin();
    const afterPin=store.protectedCount(missingDigest);
    await view._keepOrUnpin();
    return {durable,enabled,message,afterPin,afterUnpin:store.protectedCount(missingDigest)};
  }
  return {durable,enabled,message};
 },memory.digest);
 assert(recovered.durable && recovered.enabled && recovered.message.includes('RECOVERED'));
 assert.equal(recovered.afterPin,1);
 assert.equal(recovered.afterUnpin,0);
 results.push('once quota-failed capture becomes durable under exact run ID, Refresh enables Keep/Unpin');


 const navigation=await p.evaluate(async t=>{
  const [{GameOverScene},{GhostFavoritesView},{REG},{GhostLibrary}]=await Promise.all([
    import('/src/scenes/GameOverScene.js'),import('/src/ui/GhostFavoritesView.js'),import('/src/constants.js'),
    import('/src/systems/ghost/GhostLibrary.js')]);
  const {scene,view}=window.__qaEvidence;
  view.destroy();
  const tape={...t,runId:'ui-smoke-run',distanceM:1200};
  scene.registry.set(REG.LAST_GHOST_TAPE,tape);
  if(!scene.registry.get(REG.GHOSTS)){const lib=new GhostLibrary();await lib.init();scene.registry.set(REG.GHOSTS,lib);}
  scene.rec={id:'ui-smoke-run'};scene.alive=true;scene.leaving=false;
  for(const method of ['_openEvidenceView','_returnToGhosts','_closeGhosts'])
    scene[method]=GameOverScene.prototype[method].bind(scene);
  scene.ghostView=new GhostFavoritesView(scene,scene.theme,{library:scene.registry.get(REG.GHOSTS),tape,
    onClose:()=>scene._closeGhosts(),onEvidence:()=>scene._openEvidenceView()});
  const ghostOpen=scene.ghostView instanceof GhostFavoritesView;
  scene.ghostView.focus=scene.ghostView.rows.length-1;
  scene.ghostView.handleAction('down'); // real keyboard/gamepad path
  const archiveFocused=scene.ghostView.focus===scene.ghostView.rows.length;
  scene.ghostView.handleAction('confirm');
  const evidenceOpen=!!scene.ghostView?._captureStatus;
  scene._returnToGhosts();
  const ghostReturned=scene.ghostView?.constructor?.name==='GhostFavoritesView';
  scene._closeGhosts();
  return {ghostOpen,archiveFocused,evidenceOpen,ghostReturned,closed:!scene.ghostView,
    nativeInputsAfterClose:document.querySelectorAll('input[data-role="replay-evidence-import"]').length};
 },tape);
 assert(navigation.ghostOpen && navigation.archiveFocused && navigation.evidenceOpen && navigation.ghostReturned && navigation.closed && navigation.nativeInputsAfterClose===0);
 results.push('GameOver Ghost Favorites → Local Evidence → Ghost Favorites/close navigation');
 await p.evaluate(async()=>{
  const {ReplayEvidenceView}=await import('/src/ui/ReplayEvidenceView.js');
  const {scene}=window.__qaEvidence;
  const view=new ReplayEvidenceView(scene,scene.theme,{tape:{runId:'ui-smoke-run'},onClose:()=>view.destroy()});
  window.__qaEscapeView=view;
 });
 const escapeInput=p.locator('input[data-role="replay-evidence-import"]');
 await escapeInput.focus();
 assert.equal(await escapeInput.evaluate(e=>document.activeElement===e),true);
 await p.keyboard.press('Escape');
 const esc=await p.evaluate(()=>({alive:window.__qaEscapeView.alive,
   remaining:document.querySelectorAll('input[data-role="replay-evidence-import"]').length}));
 assert(!esc.alive && esc.remaining===0);
 results.push('Escape from focused native input closes panel and cleans up DOM');

 assert.deepEqual(errors,[]);
 await p.screenshot({path:'/tmp/bsb244-local-evidence-ui-browser.png'});
 console.log(JSON.stringify({format:'bsb-244-real-phaser-local-ui',checks:results.length,results,downloadBytes:exported.length,noUpload:true,errors,localURL:url},null,2));
} finally {await browser.close()}
