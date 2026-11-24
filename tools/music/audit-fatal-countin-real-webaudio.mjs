import assert from 'node:assert/strict';
import {chromium} from 'playwright';

/** Measure the rendered ORIGINAL OGG scratch, silence, four source-drum
 * accents, and resumed band in real Chromium WebAudio without speakers.
 * Synthetic beat plan is QA ONLY and never a source-verified beat grid.
 */
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
  '--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const url=process.env.GAME_URL||'http://127.0.0.1:8251/';
try{
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  await page.keyboard.press('x');
  await page.waitForFunction(()=>window.__bbGame.registry.get('audioSynth')?._stemMusic?.ready,
    null,{timeout:30000});
  await page.evaluate(()=>{
    const g=window.__bbGame,a=g.registry.get('audioSynth');
    if(!a._stemMusic.started&&!a._stemMusic.transportPaused)
      g.scene.getScene('TitleScene').jukebox.buttons[1].zone.emit('pointerdown');
  });
  await page.waitForFunction(()=>{
    const d=window.__bbGame.registry.get('audioSynth')?._stemMusic;
    return d?.started&&d.pack&&d.activeNodes.size>=6&&!d._loading;
  },null,{timeout:45000});
  await page.evaluate(()=>{
    const g=window.__bbGame,a=g.registry.get('audioSynth'),c=a.ctx;
    // Test-only mute of unrelated SFX, wind and FX. It does not persist
    // these settings and does not modify source OGG assets or song transport.
    a.applySettings({...a.settings,sfxVolume:0,windEnabled:false,musicVolume:.8,masterVolume:.8});
    const meter=c.createAnalyser();meter.fftSize=1024;
    const silentTap=c.createGain();silentTap.gain.value=0;
    a.nodes.musicBus.connect(meter);meter.connect(silentTap);
    silentTap.connect(c.destination);
    const bytes=new Float32Array(meter.fftSize);
    const samples=[];
    window.__musicWaveAudit={meter,silentTap,samples,
      timer:setInterval(()=>{
        meter.getFloatTimeDomainData(bytes);
        let power=0,peak=0;
        for(const v of bytes){power+=v*v;peak=Math.max(peak,Math.abs(v));}
        samples.push([c.currentTime,Math.sqrt(power/bytes.length),peak]);
      },14)};
    g.scene.getScene('TitleScene').startRun('countin-source-waveform-audit');
  });
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
  await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    g.loop.stop();
    r.bsod.wallX=r.sled.body.bounds.min.x+12;
    r.bsod.wallSpeedPxS=10000;
    g.headlessStep(8000,16.67);g.headlessStep(8017,16.67);
    if(!r.crashed||!r.bsodCaught)throw Error('No actual fatal BSOD collision');
  });
  await page.waitForFunction(()=>{
    const a=window.__bbGame.registry.get('audioSynth'),s=a.getFatalCountInStatus();
    return s?.stage==='full-band'&&!s.active;
  },null,{timeout:8500});
  await page.waitForTimeout(300);
  const measurement=await page.evaluate(()=>{
    const a=window.__bbGame.registry.get('audioSynth');
    const {samples,timer,meter,silentTap}=window.__musicWaveAudit;
    clearInterval(timer);
    const plan=a.getFatalCountInStatus();
    try{meter.disconnect();silentTap.disconnect();}catch{}
    const slices=[
      ['scratch',plan.startAudioTime+.025,plan.silenceStart-.025],
      ['silence',plan.silenceStart+.15,plan.drumsStart-.12],
      ['drum1',plan.beatOnsets[0]+.014,plan.beatOnsets[0]+.11],
      ['drum2',plan.beatOnsets[1]+.014,plan.beatOnsets[1]+.11],
      ['drum3',plan.beatOnsets[2]+.014,plan.beatOnsets[2]+.11],
      ['drum4',plan.beatOnsets[3]+.014,plan.beatOnsets[3]+.11],
      ['between1and2',plan.beatOnsets[0]+.24,plan.beatOnsets[1]-.07],
      ['fullBand',plan.bandAt+.1,plan.bandAt+.35],
    ];
    const series=Object.fromEntries(slices.map(([name,lo,hi])=>{
      const x=samples.filter(([t])=>t>=lo&&t<=hi);
      const rms=x.length ? Math.sqrt(x.reduce((acc,v)=>acc+v[1]**2,0)/x.length):0;
      return [name,{n:x.length,rms,peak:Math.max(0,...x.map(v=>v[2]))}];
    }));
    return {plan,series,totalSamples:samples.length,
      position:a.jukeboxSnapshot().position,track:a._stemMusic.track.id,
      note:'Music bus after original OGG + scratch, before independent master; synthetic grid unverified'};
  });
  for(const name of ['scratch','silence','drum1','drum2','drum3','drum4','between1and2','fullBand'])
    assert.ok(measurement.series[name].n>=2,`Missing real WebAudio measurement for ${name}`);
  assert.equal(measurement.plan.verified,false);
  assert.equal(measurement.plan.scheduledDrumAccents,4);
  const silence=measurement.series.silence.rms;
  assert.ok(silence<.04,'Band did not go sufficiently silent '+JSON.stringify(measurement.series));
  for(let i=1;i<=4;i++){
    const signal=measurement.series[`drum${i}`].rms;
    assert.ok(signal>Math.max(.001,silence*1.5),
      `Drum accent ${i} not audible above quiet background: `+JSON.stringify(measurement.series));
  }
  assert.ok(measurement.series.fullBand.rms>silence*2,
    'Real original band did not recover above silence baseline');
  assert.deepEqual(errors,[]);
  console.log('FATAL_REAL_OGG_WEBAUDIO_ACTUAL_AUDIO_SCRATCH_SILENCE_FOUR_DRUM_HITS_BAND_PASS',
    JSON.stringify(measurement));
}finally{await browser.close()}
