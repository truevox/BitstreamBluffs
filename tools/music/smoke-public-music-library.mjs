/** Real public catalog, disposable browser settings. Requires committed OGGs
 * in the local built app. No private catalog, synthetic grid or production
 * storage. Exercise the actual Settings -> Manage Sound -> Music Library. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],http=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('response',r=>{if(r.status()>=400)http.push([r.status(),r.url()]);});
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:8228/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?._stemMusic?.ready&&window.__bbGame.scene.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 await page.keyboard.press('x');
 await page.waitForFunction(()=>{const d=window.__bbGame.registry.get('audioSynth')._stemMusic;return d.started&&d.pack&&d.activeNodes.size>=6},null,{timeout:30000});
 const result=await page.evaluate(()=>{
  const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic,s=g.scene.getScene('TitleScene');
  s.menu.items.find(i=>i.label==='SETTINGS').onSelect();
  s.view.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
  const sound=s.view.soundView;
  const fade=sound.menu.items.find(i=>i.label==='SONG CROSSFADE');
  const def=fade.get();fade.set(false);const off={ui:fade.get(),runtime:d.crossfadeEnabled};
  sound.menu.items.find(i=>i.label.startsWith('SELECT TRACKS')).onSelect();
  const library=sound.libraryView,rows=library.menu.items.filter(i=>i.kind==='choice');
  const ids=library.tracks.map(t=>t.id);
  const before=rows.map(i=>({label:i.label,enabled:i.get()}));
  for(const row of rows)row.set(false);
  const quiet={started:d.started,nodes:d.activeNodes.size,procedural:a._musicTimer!==null,sfx:!!a.nodes.sfxBus,hiddenOn:Object.entries(d.songEnabled).filter(([id,on])=>!ids.includes(id)&&on).length};
  rows[3].set(true);
  const selected=d.songEnabled[ids[3]]===true;
  return {def,off,ids,before,quiet,selected,expected:ids[3]};
 });
 assert.equal(result.def,true);assert.deepEqual(result.off,{ui:false,runtime:false});
 assert.equal(result.ids.length,4);assert.equal(result.before.length,4);assert.equal(result.quiet.started,false);assert.equal(result.quiet.nodes,0);assert.equal(result.quiet.procedural,false);assert.equal(result.quiet.sfx,true);assert.equal(result.quiet.hiddenOn,29);
 assert.equal(result.selected,true);
 await page.waitForFunction(id=>{const d=window.__bbGame.registry.get('audioSynth')._stemMusic;return d.pack?.id===id&&d.activeNodes.size>=6},result.expected,{timeout:30000});
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?._stemMusic?.ready&&window.__bbGame.scene.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 const reload=await page.evaluate(()=>{const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic;return {fade:a.settings.musicCrossfade,runtime:d.crossfadeEnabled,enabled:d.catalog.filter(t=>a.settings.musicEnabledSongs[t.id]!==false).map(t=>t.id)}});
 assert.deepEqual(reload,{fade:false,runtime:false,enabled:[result.expected]});assert.deepEqual(errors,[]);assert.deepEqual(http,[]);
 console.log('PUBLIC_CURRENT_LIBRARY_REAL_UI_PASS',JSON.stringify({result,reload,errors,http}));
}finally{await browser.close();}
