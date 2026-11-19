/** Real game Chromium visual evidence (no saved settings or actual audio export). */
import fs from 'node:fs';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://127.0.0.1:8249/';
const output='docs/music-review';
const mixer=output+'/music-lab-six-role-mixer-final-20261118.png';
const waveform=output+'/music-lab-score-ogg-waveform-final-20261118.png';
for(const f of [mixer,waveform])if(fs.existsSync(f))throw Error('Refusing to overwrite existing screenshot: '+f);
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:810},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:40000});
  await page.keyboard.press('x');
  await page.evaluate(()=>{
    const t=window.__bbGame.scene.getScene('TitleScene');
    t.menu.items.find(i=>i.label==='SETTINGS').onSelect();
    t.view.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
    t.view.soundView.menu.items.find(i=>i.label==='MUSIC LAB').onSelect();
  });
  await page.waitForFunction(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view?.soundView?.labView;
    return !!v?.score?.songId&&v.lab.pack&&v.lab.activeNodes.size>=6;
  },null,{timeout:45000});
  await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
    v._setStemLevel('bass',1.35);
    v._setStemLevel('guitar',.35);
    v._openMixer();
  });
  await page.waitForTimeout(180);
  await page.locator('canvas').screenshot({path:mixer});
  console.log('ACTUAL_SIX_STEM_SANDBOX_MIXER_SCREENSHOT',mixer,fs.statSync(mixer).size);
  await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
    v._closeMixer();v._resetStemMix();
    v._jump(59.5);
  });
  await page.waitForFunction(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
    return v._clockFrame()>2800000&&v.lab.activeNodes.size>=6;
  },null,{timeout:30000});
  await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
    v._openInspector();v.inspector.setRole('bass');
  });
  await page.waitForFunction(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
    return v.inspector?.waveformCoverage>.4&&v.inspector._hitBoxes.length>0;
  },null,{timeout:10000});
  const noteEvidence=await page.evaluate(()=>{
    const v=window.__bbGame.scene.getScene('TitleScene').view.soundView.labView;
    return {role:v.inspector.role,noteCandidates:v.inspector._hitBoxes.length,
      oggCoverage:v.inspector.waveformCoverage,songId:v.score.songId,
      scoreHash:v.score.scoreHash,windowStart:v.inspector.windowStart,
      sourceName:v.inspector.waveformSource};
  });
  await page.locator('canvas').screenshot({path:waveform});
  console.log('ACTUAL_ORIGINAL_OGG_PCM_AND_MIDI_CANDIDATE_SCORE_INSPECTOR',
    waveform,fs.statSync(waveform).size,JSON.stringify(noteEvidence));
  if(errors.length)throw Error('Browser errors: '+errors.join('; '));
}finally{await browser.close()}
