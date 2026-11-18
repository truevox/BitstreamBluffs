/** Browser OfflineAudioContext acoustic-envelope QA for the SAME production
 * TurntableScratch class. Does not play through real speakers or mutate songs.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const source=readFileSync(new URL('../../src/systems/music/TurntableScratch.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage();
  const report=await page.evaluate(async code=>{
    const {TurntableScratch,VINYL_SCRATCH_SECONDS}=await import(
      'data:text/javascript;charset=utf-8,'+encodeURIComponent(code));
    async function render(direction,{cancel=false,dispose=false,volume=1}={}) {
      const rate=44100;
      const ctx=new OfflineAudioContext(2,rate,rate);
      const buf=ctx.createBuffer(1,rate*2,rate);
      const data=buf.getChannelData(0);
      let seed=12345;
      for(let i=0;i<data.length;i++) {
        seed=(Math.imul(1664525,seed)+1013904223)>>>0;
        data[i]=(seed/0xFFFFFFFF)*2-1;
      }
      const bus=ctx.createGain();
      bus.gain.value=.55;
      bus.connect(ctx.destination);
      const fx=new TurntableScratch(ctx,buf,bus);
      let duration=fx.play(direction,volume);
      if(cancel) duration=fx.play(direction==='pause'?'resume':'pause',volume);
      if(dispose)fx.destroy();
      const result=await ctx.startRendering();
      const pcm=result.getChannelData(0);
      const right=result.getChannelData(1);
      const rms=(start,end)=>{
        let energy=0,count=0;
        for(let i=Math.floor(start*rate);i<Math.ceil(end*rate);i++){
          energy+=pcm[i]*pcm[i];count++;
        }
        return Math.sqrt(energy/count);
      };
      const derivative=(start,end)=>{
        let dx=0,sample=0;
        for(let i=Math.floor(start*rate)+1;i<Math.ceil(end*rate);i++){
          dx+=Math.abs(pcm[i]-pcm[i-1]);sample+=Math.abs(pcm[i]);
        }
        return dx/Math.max(sample,1e-9);
      };
      let max=0,tail=0,finite=true,channelDiff=0;
      for(let i=0;i<pcm.length;i++){
        max=Math.max(max,Math.abs(pcm[i]));
        if(i>=rate*.26)tail=Math.max(tail,Math.abs(pcm[i]));
        if(!Number.isFinite(pcm[i]))finite=false;
        channelDiff=Math.max(channelDiff,Math.abs(pcm[i]-right[i]));
      }
      return {direction,cancel,dispose,duration,peak:max,post260msPeak:tail,
        finite,channelDiff,
        rmsEarly:rms(.02,.065),rmsLate:rms(.145,.19),
        brightnessEarly:derivative(.02,.065),brightnessLate:derivative(.145,.19),
        firstSamples:Array.from(pcm.slice(0,8)),
        }; // only summaries return, never audio files
    }
    const descending=await render('pause');
    const rising=await render('resume');
    const muted=await render('pause',{volume:0});
    const canceled=await render('pause',{cancel:true});
    const disposed=await render('pause',{dispose:true});
    return {descending,rising,muted,canceled,disposed,duration:VINYL_SCRATCH_SECONDS};
  },source);
  console.log('VINYL_OFFLINE_ANALYSIS',JSON.stringify(report));
  for (const x of [report.descending,report.rising,report.canceled]) {
    assert.equal(x.finite,true);
    assert.ok(x.peak>0.005&&x.peak<0.22,
      x.direction+' should be audible only when music enabled and bounded');
    assert.ok(x.rmsEarly>0.001&&x.rmsLate>0.001,
      x.direction+' must have an actual transient envelope');
    assert.ok(x.post260msPeak<1e-6,
      x.direction+' left nonzero audio after the 205ms gesture');
    assert.equal(x.channelDiff,0,'one-shot scratch should remain centered');
  }
  assert.equal(report.duration,.205);
  assert.equal(report.muted.peak,0);
  assert.equal(report.disposed.peak,0);
  assert.ok(report.descending.brightnessEarly >
    report.descending.brightnessLate * 1.35,
    'pause vinyl must perceptually darken toward silence');
  assert.ok(report.rising.brightnessLate >
    report.rising.brightnessEarly * 1.35,
    'resume vinyl must brighten back toward playing');
  assert.ok(Math.abs(report.descending.brightnessEarly-report.rising.brightnessEarly)>.01,
    'pause and resume waveforms should be measurably different');
  console.log('VINYL_OFFLINE_WEBAUDIO_PASS',JSON.stringify(report));
} finally {await browser.close();}
