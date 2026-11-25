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
  window.__qaEvidence={view,store,digest,scene,statusKey:EVIDENCE_STATUS_KEY};
  scene.registry.set(EVIDENCE_STATUS_KEY,{ok:true,runId:'ui-smoke-run',digest,durable:true});
  await view._refresh();
  return {alive:view.alive,digest,labels:view.buttons.map(b=>b.label.main.text),message:view.status.main.text,depth:view.panel.depth};
 },tape);
 assert(initial.alive && initial.depth>=500 && initial.labels.join(',')==='KEEP,EXPORT,IMPORT,REFRESH');
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
 // Browser download must be triggered only when Export is explicitly clicked.
 const downloadPromise=p.waitForEvent('download',{timeout:15000});
 await p.evaluate(()=>window.__qaEvidence.view._export());
 const download=await downloadPromise;
 const downloadPath=await download.path();
 const exported=fs.readFileSync(downloadPath);
 assert.equal(download.suggestedFilename(),`${initial.digest.slice(7)}.bbreplay`);
 assert(exported.length>2000);
 results.push('explicit Export triggers digest-named local .bbreplay download');
 // Input must open synchronously in the click action, before awaiting file bytes.
 const fileChooserPromise=p.waitForEvent('filechooser',{timeout:15000});
 const importer=p.evaluate(()=>window.__qaEvidence.view._import());
 const chooser=await fileChooserPromise;
 await chooser.setFiles({name:download.suggestedFilename(),mimeType:'application/octet-stream',buffer:exported});
 await importer;
 const imported=await p.evaluate(()=>({msg:window.__qaEvidence.view.status.main.text,count:window.__qaEvidence.store.protectedCount(window.__qaEvidence.digest)}));
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
 const navigation=await p.evaluate(async t=>{
  const [{GameOverScene},{GhostFavoritesView},{REG}]=await Promise.all([
    import('/src/scenes/GameOverScene.js'),import('/src/ui/GhostFavoritesView.js'),import('/src/constants.js')]);
  const {scene,view}=window.__qaEvidence;
  view.destroy();
  const tape={...t,runId:'ui-smoke-run',distanceM:1200};
  scene.registry.set(REG.LAST_GHOST_TAPE,tape);
  scene.rec={id:'ui-smoke-run'};scene.alive=true;scene.leaving=false;
  for(const method of ['_openEvidenceView','_returnToGhosts','_closeGhosts'])
    scene[method]=GameOverScene.prototype[method].bind(scene);
  scene.ghostView=new GhostFavoritesView(scene,scene.theme,{library:scene.registry.get(REG.GHOSTS),tape,
    onClose:()=>scene._closeGhosts(),onEvidence:()=>scene._openEvidenceView()});
  const ghostOpen=scene.ghostView instanceof GhostFavoritesView;
  scene._openEvidenceView();
  const evidenceOpen=!!scene.ghostView?._captureStatus;
  scene._returnToGhosts();
  const ghostReturned=scene.ghostView instanceof GhostFavoritesView;
  scene._closeGhosts();
  return {ghostOpen,evidenceOpen,ghostReturned,closed:!scene.ghostView};
 },tape);
 assert(navigation.ghostOpen && navigation.evidenceOpen && navigation.ghostReturned && navigation.closed);
 results.push('GameOver Ghost Favorites → Local Evidence → Ghost Favorites/close navigation');
 assert.deepEqual(errors,[]);
 await p.screenshot({path:'/tmp/bsb244-local-evidence-ui-browser.png'});
 console.log(JSON.stringify({format:'bsb-244-real-phaser-local-ui',checks:results.length,results,downloadBytes:exported.length,noUpload:true,errors,localURL:url},null,2));
} finally {await browser.close()}
