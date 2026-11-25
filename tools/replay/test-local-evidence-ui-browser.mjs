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
const record=s=>{results.push(s);console.log('QA_STEP',results.length,s);};
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
 record('panel renders after Phaser theme-ready gate');
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
 record('explicit Keep/Unpin changes durable IndexedDB reference');
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
 record('Refresh follows persisted pin/unpin from another browser tab');
 const oneHash=await p.evaluate(async()=>{
  const {view,store}=window.__qaEvidence;
  const get=store.get, oldDurable=store.isBundleDurable;
  store.get=async()=>{throw new Error('Refresh must not call full-byte get');};
  store.isBundleDurable=async()=>{throw new Error('Refresh must not repeat durability hashing');};
  try{
    await view._refresh();
    return {exportEnabled:view.buttons[1].disabled===false,keepEnabled:view.buttons[0].disabled===false};
  }finally{store.get=get;store.isBundleDurable=oldDurable;await view._refresh();}
 });
 assert(oneHash.exportEnabled && oneHash.keepEnabled);
 record('Refresh uses one atomic replay inspection instead of repeated full-bundle hashing');

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
 record('verified bundle remains exportable when pin index lookup fails');

 const staleRefresh=await p.evaluate(async()=>{
  const {view,store,digest}=window.__qaEvidence;
  const original=store.inspectBundle.bind(store);
  let signal,release;
  const started=new Promise(resolve=>{signal=resolve;});
  let intercepted=false;
  store.inspectBundle=(...args)=>{
    if(intercepted)return original(...args); // follow-up reconciliation must not inherit the old delayed read
    intercepted=true;
    signal();return new Promise(resolve=>{release=async()=>resolve(await original(...args));});
  };
  try{
    const refreshing=view._refresh();
    await started;
    // Force the pending guard true ONLY after the user's original Refresh has
    // already passed its retry point. An automatic reconciliation must not
    // reinterpret an Import action as permission for another disk write.
    const wasPendingHas=store.pending.has;
    const retryPending=store.retryPending;
    let unintendedRetries=0;
    store.pending.has=()=>true;
    store.retryPending=async()=>{unintendedRetries++;throw new Error('implicit write during archive action');};
    try{
      await view._run(async()=>{view._show('IMPORTED LOCAL EVIDENCE — UNVERIFIED','RECENT USER ACTION');});
    }finally{store.pending.has=wasPendingHas;store.retryPending=retryPending;}
    await release();await refreshing;
    return {status:view.status.main.text,detail:view.detail.main.text,unintendedRetries,
      keepEnabled:view.buttons[0].disabled===false,exportEnabled:view.buttons[1].disabled===false};
  }finally{store.inspectBundle=original;await view._refresh();}
 });
 assert(staleRefresh.status.includes('IMPORTED LOCAL EVIDENCE'));
 assert(staleRefresh.keepEnabled && staleRefresh.exportEnabled);
 assert.equal(staleRefresh.unintendedRetries,0);
 record('late Refresh reconciles without implicit disk retry or disabled controls');

 const failedReconcile=await p.evaluate(async()=>{
  const {view,store}=window.__qaEvidence;
  const originalInspect=store.inspectBundle.bind(store);
  const originalRefs=store.persistedProtections.bind(store);
  let signal,release,intercepted=false;
  const started=new Promise(resolve=>{signal=resolve;});
  store.inspectBundle=(...args)=>{
    if(intercepted)return originalInspect(...args);
    intercepted=true;signal();
    return new Promise(resolve=>{release=async()=>resolve(await originalInspect(...args));});
  };
  try{
    const refreshing=view._refresh();
    await started;
    store.persistedProtections=async()=>{throw new Error('injected reference read failure');};
    await view._run(async()=>view._show('IMPORTED LOCAL EVIDENCE — UNVERIFIED','NEWER ACTION'));
    const result={status:view.status.main.text,keepDisabled:view.buttons[0].disabled,
      exportEnabled:!view.buttons[1].disabled};
    await release();await refreshing;
    return result;
  }finally{
    store.inspectBundle=originalInspect;
    store.persistedProtections=originalRefs;
    await view._refresh();
  }
 });
 assert(failedReconcile.status.includes('PIN STATUS UNAVAILABLE'));
 assert(failedReconcile.keepDisabled && failedReconcile.exportEnabled);
 record('reconciliation failure keeps storage warning visible rather than restoring stale success');

 const keepSourceWarning=await p.evaluate(async()=>{
  const {view,store}=window.__qaEvidence;
  const originalInspect=store.inspectBundle.bind(store);
  const originalRefs=store.persistedProtections.bind(store);
  let signal,release,intercepted=false;
  const started=new Promise(resolve=>{signal=resolve;});
  store.inspectBundle=(...args)=>{
    if(intercepted)return originalInspect(...args);
    intercepted=true;signal();
    return new Promise(resolve=>{release=async()=>resolve(await originalInspect(...args));});
  };
  try{
    const refreshing=view._refresh();await started;
    store.persistedProtections=async()=>{throw new Error('injected archive index failure');};
    await view._run(async()=>view._show('IMPORTED LOCAL EVIDENCE — UNVERIFIED','KEEP ORIGINAL FILE — IMPORT NOT DURABLE'));
    const out={status:view.status.main.text,details:view.detail.main.text};
    await release();await refreshing;
    return out;
  }finally{
    store.inspectBundle=originalInspect;store.persistedProtections=originalRefs;
    await view._refresh();
  }
 });
 assert(keepSourceWarning.status.includes('KEEP ORIGINAL FILE'));
 assert(keepSourceWarning.details.includes('IMPORT UNCONFIRMED'));
 assert(keepSourceWarning.details.includes('PIN STATUS UNKNOWN'));
 record('unconfirmed import retains KEEP ORIGINAL FILE alongside pin-index warning');

 const exportAfterInterruptedImport=await p.evaluate(async()=>{
  const {view,store}=window.__qaEvidence;
  const originalInspect=store.inspectBundle.bind(store);
  let signal,release,intercepted=false;
  const started=new Promise(resolve=>{signal=resolve;});
  store.inspectBundle=(...args)=>{
    if(intercepted)return Promise.resolve({readable:true,durable:false,runBound:false});
    intercepted=true;signal();
    return new Promise(resolve=>{release=async()=>resolve(await originalInspect(...args));});
  };
  try{
    const refreshing=view._refresh();await started;
    await view._run(async()=>view._show('KEEP ORIGINAL FILE','IMPORT STORAGE NOT CONFIRMED — DO NOT DELETE SOURCE'));
    const result={status:view.status.main.text,detail:view.detail.main.text,
      exportEnabled:!view.buttons[1].disabled};
    await release();await refreshing;
    return result;
  }finally{store.inspectBundle=originalInspect;await view._refresh();}
 });
 assert(exportAfterInterruptedImport.status.includes('KEEP ORIGINAL FILE'));
 assert(exportAfterInterruptedImport.detail.includes('IMPORT UNCONFIRMED'));
 assert(exportAfterInterruptedImport.detail.includes('EXPORT RUN NOW'));
 assert(exportAfterInterruptedImport.exportEnabled);
 record('unconfirmed import preserves EXPORT RUN NOW when current-run proof is memory-only');

 const unboundExport=await p.evaluate(async()=>{
  const {view,store}=window.__qaEvidence;
  const originalInspect=store.inspectBundle.bind(store);
  let signal,release,intercepted=false;
  const started=new Promise(resolve=>{signal=resolve;});
  store.inspectBundle=(...args)=>{
    if(intercepted)return Promise.resolve({readable:true,durable:true,runBound:false});
    intercepted=true;signal();
    return new Promise(resolve=>{release=async()=>resolve(await originalInspect(...args));});
  };
  try{
    const refreshing=view._refresh();await started;
    await view._run(async()=>view._show('KEEP ORIGINAL FILE','IMPORT STORAGE NOT CONFIRMED — DO NOT DELETE SOURCE'));
    const result={status:view.status.main.text,detail:view.detail.main.text,
      keepDisabled:view.buttons[0].disabled,exportEnabled:!view.buttons[1].disabled};
    await release();await refreshing;
    return result;
  }finally{store.inspectBundle=originalInspect;await view._refresh();}
 });
 assert(unboundExport.status.includes('KEEP ORIGINAL FILE'));
 assert(unboundExport.detail.includes('RUN UNBOUND'));
 assert(unboundExport.detail.includes('EXPORT ONLY'));
 assert(unboundExport.keepDisabled && unboundExport.exportEnabled);
 record('unconfirmed import distinguishes unbound durable run from memory-only export urgency');

 const vanishedPin=await p.evaluate(async()=>{
  const {view,store,digest}=window.__qaEvidence;
  await view._refresh();
  await view._keepOrUnpin(); // establish a real local pin
  const original=view.actions.unpin.bind(view.actions);
  view.actions.unpin=async()=>({ok:false});
  try{
    await view._keepOrUnpin();
    return {message:view.status.main.text,count:await store.persistedProtectedCount(digest),
      button:view.buttons[0].label.main.text};
  }finally{view.actions.unpin=original;
    const refs=await store.persistedProtections(digest);
    for(const ref of refs)if(ref.role==='pinned')await store.unprotect(ref.key);
    await view._refresh();}
 });
 assert(vanishedPin.message.includes('PIN STATUS CHANGED'));
 assert(!vanishedPin.message.includes('PIN REMOVED'));
 assert.equal(vanishedPin.count,1);
 assert.equal(vanishedPin.button,'UNPIN');
 record('Unpin false receipt refuses to report deletion or flip button label');

 const actualStalePin=await p.evaluate(async()=>{
  const {view,store,digest}=window.__qaEvidence;
  await view._refresh();await view._keepOrUnpin();
  const pinned=await store.persistedProtections(digest);
  for(const ref of pinned)if(ref.role==='pinned')await store.unprotect(ref.key);
  // Deliberately do NOT refresh before clicking the stale Unpin button.
  await view._keepOrUnpin();
  const out={label:view.buttons[0].label.main.text,status:view.status.main.text,
    remaining:await store.persistedProtectedCount(digest)};
  await view._refresh();return out;
 });
 assert.equal(actualStalePin.label,'KEEP');
 assert(actualStalePin.status.includes('PIN STATUS CHANGED'));
 assert.equal(actualStalePin.remaining,0);
 record('actual cross-tab stale Unpin reconciles KEEP label without a manual Refresh');

 const foreignStalePin=await p.evaluate(async()=>{
  const {view,store,digest}=window.__qaEvidence;
  const {EvidenceStore}=await import('/src/systems/replay/evidenceStore.js');
  await view._refresh();await view._keepOrUnpin();
  const refs=await store.persistedProtections(digest);
  const external=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  for(const ref of refs)if(ref.role==='pinned')await external.unprotect(ref.key);
  // This store still has its OLD cached generation. Its unprotect throws.
  await view._keepOrUnpin();
  const out={label:view.buttons[0].label.main.text,status:view.status.main.text,
    remaining:await external.persistedProtectedCount(digest)};
  await view._refresh();return out;
 });
 assert.equal(foreignStalePin.label,'KEEP');
 assert(foreignStalePin.status.includes('PIN STATUS CHANGED'));
 assert.equal(foreignStalePin.remaining,0);
 record('thrown stale-protection from a second tab also reconciles Unpin immediately');

 // Browser download must be triggered only when Export is explicitly clicked.
 const downloadPromise=p.waitForEvent('download',{timeout:15000});
 await p.evaluate(()=>window.__qaEvidence.view._export());
 const download=await downloadPromise;
 const downloadPath=await download.path();
 const exported=fs.readFileSync(downloadPath);
 assert.equal(download.suggestedFilename(),`${initial.digest.slice(7)}.bbreplay`);
 assert(exported.length>2000);
 record('explicit Export triggers digest-named local .bbreplay download');
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
 record('native picker returns keyboard focus to game after selecting a file');
 assert(imported.msg.includes('UNVERIFIED'));
 assert.equal(imported.count,0);
 record('explicit file picker imports local-only data, stays unverified/unpinned');
 const renamed=await p.evaluate(async({name,bytes})=>{
  const {view}=window.__qaEvidence;
  const digest=name.replace(/\.bbreplay$/i,' (1).bbreplay');
  const file=new File([new Uint8Array(bytes)],digest,{type:'application/octet-stream'});
  await view._processImportFile(file);
  return {name:file.name,status:view.status.main.text};
 },{name:download.suggestedFilename(),bytes:[...exported]});
 assert(renamed.name.endsWith(' (1).bbreplay') && renamed.status.includes('UNVERIFIED'));
 record('browser collision-suffixed copy of exported replay imports after SHA verification');

 const stale=await p.evaluate(()=>{
  const {scene,statusKey,view}=window.__qaEvidence;
  scene.registry.set(statusKey,{ok:true,runId:'some-prior-run',digest:'sha256:'+'f'.repeat(64)});
  return view._captureStatus();
 });
 assert.equal(stale,null);
 record('stale prior-run capture cannot be pinned as current run');
 const busyInput=await p.evaluate(async()=>{
  const {view}=window.__qaEvidence;
  let release;
  const task=view._run(()=>new Promise(resolve=>{release=resolve;}));
  const blocked=view._nativeInput?.disabled===true;
  release();await task;
  return {blocked,reEnabled:view._nativeInput?.disabled===false};
 });
 assert(busyInput.blocked && busyInput.reEnabled);
 record('native picker is disabled during in-flight archive operations');

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
  scene.registry.set(statusKey,{ok:false,runId:'ui-smoke-run',digest,code:'quota-exceeded',durable:false});
  try {
    await view._refresh(); // quota fault is STILL active; recovery must fail closed
    return {failed,digest,keepDisabled:view.buttons[0].disabled,exportDisabled:view.buttons[1].disabled,
      message:view.status.main.text,pending:store.pending.has(digest)};
  } finally {store._writeDurable=original;}

 });
 assert(memory.failed && memory.pending && memory.keepDisabled && !memory.exportDisabled && memory.message.includes('EXPORT NOW'));
 const memoryDownloadWait=p.waitForEvent('download',{timeout:15000});
 await p.evaluate(()=>window.__qaEvidence.view._export());
 const memoryDownload=await memoryDownloadWait;
 assert.equal(memoryDownload.suggestedFilename(),`${memory.digest.slice(7)}.bbreplay`);
 assert(fs.readFileSync(await memoryDownload.path()).length>2000);
 record('quota-failed memory-only canonical input remains explicitly exportable but cannot be pinned');
 const recovered=await p.evaluate(async missingDigest=>{
  const {view,store}=window.__qaEvidence;
  await view._refresh(); // NO unrelated new run should be needed to retry quota bytes
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
 record('Refresh alone retries quota-failed bytes and enables run-bound Keep/Unpin');
 const priority=await p.evaluate(async()=>{
  const {view,store,scene,statusKey,legacyTape}=window.__qaEvidence;
  const {evidenceBundle,legacyManifestFromTape,bundleDigest}=await import('/src/systems/replay/manifest.js');
  const base=evidenceBundle({manifest:legacyManifestFromTape(legacyTape),tape:legacyTape});
  const older={...base,claims:{...base.claims,score:base.claims.score+401}};
  const current={...base,claims:{...base.claims,score:base.claims.score+402}};
  const oldDigest=bundleDigest(older),currentDigest=bundleDigest(current);
  const priorStatus=scene.registry.get(statusKey),originalWrite=store._writeDurable;
  store._writeDurable=async()=>{throw new Error('temporary simulated quota');};
  try{
    await store.put(older,{runId:'older-pending'}).catch(()=>{});
    await store.put(current,{runId:'ui-smoke-run'}).catch(()=>{});
  }finally{
    // The older source remains quota-blocked, but the current smaller source
    // can now fit. This tests prioritized retry ordering, not quota sizes.
    store._writeDurable=(record,...rest)=>record.digest===oldDigest
      ?Promise.reject(new Error('older source still quota blocked'))
      :originalWrite.call(store,record,...rest);
  }
  try{
    scene.registry.set(statusKey,{ok:false,runId:'ui-smoke-run',digest:currentDigest,code:'quota-exceeded',durable:false});
    await view._refresh();
    return {currentDurable:await store.isBundleDurable(currentDigest,{runId:'ui-smoke-run'}),
      olderPending:store.pending.has(oldDigest),currentPending:store.pending.has(currentDigest),
      keepEnabled:view.buttons[0].disabled===false,message:view.status.main.text};
  }finally{
    store._writeDurable=originalWrite;scene.registry.set(statusKey,priorStatus);
    await view._refresh();
  }
 });
 assert(priority.currentDurable && priority.olderPending && !priority.currentPending && priority.keepEnabled);
 record('Refresh prioritizes current run over older still-quota-blocked pending evidence');



 const displayGeneration=await p.evaluate(async()=>{
  const {view,store,digest,scene,statusKey}=window.__qaEvidence;
  const {EvidenceStore}=await import('/src/systems/replay/evidenceStore.js');
  // The current run returns to a successful capture for this interaction.
  scene.registry.set(statusKey,{ok:true,runId:'ui-smoke-run',digest,durable:true});
  await view._refresh();
  const other=await new EvidenceStore({idb:indexedDB,storage:null}).init();
  const first=await other.protect(digest,{runId:'ui-smoke-run',role:'pinned'});
  await view._refresh();
  const shown=view.displayedPin;
  await other.unprotect(first.key);
  const replacement=await other.protect(digest,{runId:'ui-smoke-run',role:'pinned'});
  await store.persistedProtections(digest); // cache takes NEW generation
  await view._keepOrUnpin(); // must refuse without touching the replacement
  const denied=view.status.main.text;
  const stillProtected=await other.persistedProtectedCount(digest);
  await other.unprotect(replacement.key);
  await view._refresh();
  return {shownGeneration:shown?.generation,firstGeneration:first.generation,
    replacementGeneration:replacement.generation,denied,stillProtected};
 });
 assert.equal(displayGeneration.shownGeneration,displayGeneration.firstGeneration);
 assert.notEqual(displayGeneration.shownGeneration,displayGeneration.replacementGeneration);
 assert.equal(displayGeneration.stillProtected,1);
 assert(displayGeneration.denied.includes('PIN STATUS CHANGED'));
 record('Unpin preserves displayed generation and refuses replacement pin after cache refresh');

 const nativeKeys=await p.evaluate(()=>{
  const {view,scene}=window.__qaEvidence;
  const prevMenu=scene.input_;
  const stub={rawKeyHandler:null};scene.input_=stub;
  const input=view._nativeInput;
  const heard=[];
  const listener=e=>heard.push(e.key);
  window.addEventListener('keydown',listener);
  input.focus();
  const guardInstalled=typeof stub.rawKeyHandler==='function';
  for(const key of [' ','Enter'])input.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  input.blur();
  const restored=stub.rawKeyHandler===null;
  window.removeEventListener('keydown',listener);
  scene.input_=prevMenu;
  return {guardInstalled,restored,heard};
 });
 assert(nativeKeys.guardInstalled && nativeKeys.restored && nativeKeys.heard.length===0);
 record('native picker suppresses Space/Enter game shortcuts without disabling browser activation');

 const importQuota=await p.evaluate(async()=>{
  const {view}=window.__qaEvidence;
  const actions=await view._getActions();
  const real=actions.import;
  actions.import=async()=>{throw Object.assign(new Error('test quota'),{code:'quota-exceeded'});};
  try{
    const file=new File(['quota-stub'],'a'.repeat(64)+'.bbreplay',{type:'application/octet-stream'});
    await view._processImportFile(file);
    return {message:view.status.main.text,detail:view.detail.main.text};
  }finally{actions.import=real;await view._refresh();}
 });
 assert(importQuota.message.includes('KEEP ORIGINAL FILE'));
 record('quota failure on imported file explicitly warns to keep original source');

 const reconnected=await p.evaluate(async()=>{
  const {view,store}=window.__qaEvidence;
  store._db.onclose(); // site-data change forced the connection closed
  const before=store.backend;
  await view._refresh(); // explicit recovery gesture
  return {before,after:store.backend,exportEnabled:!view.buttons[1].disabled};
 });
 assert.equal(reconnected.before,'memory');
 assert.equal(reconnected.after,'idb');
 assert(reconnected.exportEnabled);
 record('Refresh automatically reopens previously closed IndexedDB and recovers local evidence');

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
 record('GameOver Ghost Favorites → Local Evidence → Ghost Favorites/close navigation');
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
 record('Escape from focused native input closes panel and cleans up DOM');

 assert.deepEqual(errors,[]);
 await p.screenshot({path:'/tmp/bsb244-local-evidence-ui-browser.png'});
 console.log(JSON.stringify({format:'bsb-244-real-phaser-local-ui',checks:results.length,results,downloadBytes:exported.length,noUpload:true,errors,localURL:url},null,2));
} finally {await browser.close()}
